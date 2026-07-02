"""Universal Goal OS — Metric CRUD + increment.

A Metric belongs to a node (`node_id`) and tracks a measurable quantity toward a
target (e.g. Videos 12/30, Pages 40/500). Repeatable "counters" from the old journey
model map here: target_value = N, current_value increments as the user marks progress.

Any metric change recomputes the owning node upward, so nodes in `metric` or `formula`
progress mode reflect the new values immediately.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, Optional

from bson import ObjectId

from .context import goal_metrics_collection, goal_nodes_collection
from .goal_domain import _uid, ensure_goal_indexes, log_activity
from .goal_progress_engine import recompute_upward


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _oid(value: str, label: str = "metric id") -> ObjectId:
    try:
        return ObjectId(value)
    except Exception:
        raise ValueError(f"Invalid {label}")


def _num(value: Any, default: Optional[float] = None) -> Optional[float]:
    if value is None or value == "":
        return default
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _owned_node(user_id: str, node_id: str) -> Dict[str, Any]:
    node = goal_nodes_collection().find_one({"_id": _oid(node_id, "node_id"), "user_id": user_id})
    if not node:
        raise LookupError("Node not found")
    return node


def _owned_metric(user_id: str, metric_id: str) -> Dict[str, Any]:
    metric = goal_metrics_collection().find_one({"_id": _oid(metric_id)})
    if not metric:
        raise LookupError("Metric not found")
    # Ownership is enforced via the metric's node.
    _owned_node(user_id, metric["node_id"])
    return metric


def _public(doc: Dict[str, Any]) -> Dict[str, Any]:
    doc = dict(doc)
    doc["id"] = str(doc.pop("_id"))
    return doc


def _clamp_to_bounds(metric: Dict[str, Any], value: float) -> float:
    lo = metric.get("min_value")
    hi = metric.get("max_value")
    # When no explicit max is set, the target acts as the ceiling so a counter can't
    # exceed its goal (e.g. 10/10, never 14/10).
    if hi is None:
        target = metric.get("target_value")
        if target is not None and float(target) > 0:
            hi = target
    if lo is not None:
        value = max(float(lo), value)
    if hi is not None:
        value = min(float(hi), value)
    return max(0.0, value)


def list_metrics(user_id: str, node_id: str) -> Dict[str, Any]:
    ensure_goal_indexes()
    uid = _uid(user_id)
    _owned_node(uid, node_id)
    rows = list(goal_metrics_collection().find({"node_id": node_id}).sort("created_at", 1))
    return {"metrics": [_public(r) for r in rows]}


def create_metric(user_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    ensure_goal_indexes()
    uid = _uid(user_id)
    node_id = str(payload.get("node_id") or "").strip()
    if not node_id:
        raise ValueError("node_id is required")
    node = _owned_node(uid, node_id)
    name = str(payload.get("name") or "").strip()
    if not name:
        raise ValueError("name is required")
    now = _now()
    doc = {
        "goal_id": node["goal_id"],
        "node_id": node_id,
        "user_id": uid,
        "name": name,
        "type": str(payload.get("type") or "number").strip(),
        "unit": str(payload.get("unit") or "").strip(),
        "target_value": _num(payload.get("target_value"), 0.0),
        "current_value": _num(payload.get("current_value"), 0.0),
        "min_value": _num(payload.get("min_value"), None),
        "max_value": _num(payload.get("max_value"), None),
        "created_at": now,
        "updated_at": now,
    }
    result = goal_metrics_collection().insert_one(doc)
    doc["_id"] = result.inserted_id
    log_activity(node["goal_id"], node_id, "metric_created", uid, new_value=name)
    recompute_upward(node["goal_id"], node_id)
    return _public(doc)


_EDITABLE = {"name", "type", "unit", "target_value", "current_value", "min_value", "max_value"}


def update_metric(user_id: str, metric_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    ensure_goal_indexes()
    uid = _uid(user_id)
    metric = _owned_metric(uid, metric_id)
    update: Dict[str, Any] = {"updated_at": _now()}
    for field in _EDITABLE:
        if field not in payload:
            continue
        if field in {"name", "type", "unit"}:
            update[field] = str(payload.get(field) or "").strip()
        else:
            update[field] = _num(payload.get(field), None)
    if "name" in update and not update["name"]:
        raise ValueError("name is required")
    goal_metrics_collection().update_one({"_id": metric["_id"]}, {"$set": update})
    recompute_upward(metric["goal_id"], metric["node_id"])
    return _public(goal_metrics_collection().find_one({"_id": metric["_id"]}))


def increment_metric(user_id: str, metric_id: str, delta: float = 1.0) -> Dict[str, Any]:
    """Add `delta` (may be negative) to a metric's current_value, clamped to bounds.

    This is the primary "marking" action for metric-tracked work.
    """
    ensure_goal_indexes()
    uid = _uid(user_id)
    metric = _owned_metric(uid, metric_id)
    old_value = float(metric.get("current_value") or 0)
    new_value = _clamp_to_bounds(metric, old_value + float(delta or 0))
    goal_metrics_collection().update_one(
        {"_id": metric["_id"]}, {"$set": {"current_value": new_value, "updated_at": _now()}}
    )
    log_activity(metric["goal_id"], metric["node_id"], "metric_incremented", uid,
                 old_value=old_value, new_value=new_value)
    recompute_upward(metric["goal_id"], metric["node_id"])
    return _public(goal_metrics_collection().find_one({"_id": metric["_id"]}))


def delete_metric(user_id: str, metric_id: str) -> Dict[str, Any]:
    ensure_goal_indexes()
    uid = _uid(user_id)
    metric = _owned_metric(uid, metric_id)
    goal_metrics_collection().delete_one({"_id": metric["_id"]})
    log_activity(metric["goal_id"], metric["node_id"], "metric_deleted", uid, old_value=metric.get("name"))
    recompute_upward(metric["goal_id"], metric["node_id"])
    return {"deleted": True, "metric_id": metric_id}
