"""Universal Goal OS — top-level Goal CRUD and shared helpers.

Everything in the Goal OS is generic and metadata-driven: a `goals` document holds
goal-level metadata, and the recursive tree lives in `goal_nodes` (one document per
node, adjacency list). See goal_node_domain.py and goal_progress_engine.py.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from bson import ObjectId
from pymongo import ASCENDING, DESCENDING, TEXT

from .context import (
    goal_activity_collection,
    goal_metrics_collection,
    goal_nodes_collection,
    goals_collection,
    logger,
)

GOAL_STATUSES = {"active", "paused", "completed", "archived"}
_indexes_ready = False


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _uid(user_id: str) -> str:
    uid = (user_id or "").strip()
    if not uid:
        raise ValueError("Invalid user_id")
    return uid


def _oid(value: str, label: str = "id") -> ObjectId:
    try:
        return ObjectId(value)
    except Exception:
        raise ValueError(f"Invalid {label}")


def ensure_goal_indexes() -> None:
    global _indexes_ready
    if _indexes_ready:
        return
    goals_collection().create_index([("user_id", ASCENDING), ("updated_at", DESCENDING)])
    nodes = goal_nodes_collection()
    nodes.create_index([("goal_id", ASCENDING), ("parent_id", ASCENDING), ("order", ASCENDING)])
    nodes.create_index([("goal_id", ASCENDING), ("path", ASCENDING)])
    nodes.create_index([("goal_id", ASCENDING), ("status", ASCENDING)])
    nodes.create_index([("user_id", ASCENDING)])
    try:
        nodes.create_index([("title", TEXT), ("description", TEXT)])
    except Exception:  # noqa: BLE001 — text index may already exist with different spec
        logger.exception("goal_nodes text index create skipped")
    goal_metrics_collection().create_index([("node_id", ASCENDING)])
    goal_metrics_collection().create_index([("goal_id", ASCENDING)])
    goal_activity_collection().create_index([("goal_id", ASCENDING), ("created_at", DESCENDING)])
    _indexes_ready = True


def _clean_str(value: Any, default: str = "") -> str:
    return str(value).strip() if isinstance(value, (str, int, float)) else default


def _public_goal(doc: Dict[str, Any]) -> Dict[str, Any]:
    doc = dict(doc)
    doc["id"] = str(doc.pop("_id"))
    doc.pop("user_id", None)
    return doc


def _assert_goal(user_id: str, goal_id: str) -> Dict[str, Any]:
    doc = goals_collection().find_one({"_id": _oid(goal_id, "goal id"), "user_id": user_id})
    if not doc:
        raise LookupError("Goal not found")
    return doc


def list_goals(user_id: str) -> Dict[str, Any]:
    ensure_goal_indexes()
    uid = _uid(user_id)
    docs = list(goals_collection().find({"user_id": uid}).sort("updated_at", DESCENDING))
    return {"goals": [_public_goal(d) for d in docs]}


def get_goal(user_id: str, goal_id: str) -> Dict[str, Any]:
    ensure_goal_indexes()
    uid = _uid(user_id)
    return _public_goal(_assert_goal(uid, goal_id))


def create_goal(user_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    ensure_goal_indexes()
    uid = _uid(user_id)
    name = _clean_str(payload.get("name"))
    if not name:
        raise ValueError("name is required")
    now = _now()
    doc = {
        "user_id": uid,
        "name": name,
        "description": _clean_str(payload.get("description")),
        "icon": _clean_str(payload.get("icon")) or "🎯",
        "cover_image": _clean_str(payload.get("cover_image")),
        "color": _clean_str(payload.get("color")) or "#6366f1",
        "status": "active",
        "category": _clean_str(payload.get("category")) or "General",
        "priority": _clean_str(payload.get("priority")) or "medium",
        "start_date": _clean_str(payload.get("start_date")),
        "end_date": _clean_str(payload.get("end_date")),
        "visibility": _clean_str(payload.get("visibility")) or "private",
        "progress": 0.0,
        "estimated_hours": float(payload.get("estimated_hours") or 0),
        "actual_hours": float(payload.get("actual_hours") or 0),
        "settings": payload.get("settings") if isinstance(payload.get("settings"), dict) else {},
        "created_at": now,
        "updated_at": now,
    }
    result = goals_collection().insert_one(doc)
    doc["_id"] = result.inserted_id
    return _public_goal(doc)


_EDITABLE_FIELDS = {
    "name", "description", "icon", "cover_image", "color", "category", "priority",
    "start_date", "end_date", "visibility", "estimated_hours", "actual_hours", "settings",
}


def update_goal(user_id: str, goal_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    ensure_goal_indexes()
    uid = _uid(user_id)
    oid = _oid(goal_id, "goal id")
    _assert_goal(uid, goal_id)
    update: Dict[str, Any] = {"updated_at": _now()}
    for field in _EDITABLE_FIELDS:
        if field not in payload:
            continue
        if field in {"estimated_hours", "actual_hours"}:
            update[field] = float(payload.get(field) or 0)
        elif field == "settings":
            update[field] = payload[field] if isinstance(payload[field], dict) else {}
        else:
            update[field] = _clean_str(payload.get(field))
    if "name" in update and not update["name"]:
        raise ValueError("name is required")
    if "status" in payload:
        status = _clean_str(payload.get("status")).lower()
        if status not in GOAL_STATUSES:
            raise ValueError(f"status must be one of: {', '.join(sorted(GOAL_STATUSES))}")
        update["status"] = status
    goals_collection().update_one({"_id": oid}, {"$set": update})
    return _public_goal(goals_collection().find_one({"_id": oid}))


def delete_goal(user_id: str, goal_id: str) -> Dict[str, Any]:
    """Delete a goal and all of its dependent documents (nodes, metrics, activity)."""
    ensure_goal_indexes()
    uid = _uid(user_id)
    _assert_goal(uid, goal_id)
    goal_nodes_collection().delete_many({"goal_id": goal_id, "user_id": uid})
    goal_metrics_collection().delete_many({"goal_id": goal_id})
    goal_activity_collection().delete_many({"goal_id": goal_id})
    result = goals_collection().delete_one({"_id": _oid(goal_id, "goal id"), "user_id": uid})
    return {"deleted": result.deleted_count > 0}


def log_activity(goal_id: str, node_id: Optional[str], action: str, performed_by: str,
                 old_value: Any = None, new_value: Any = None) -> None:
    """Append an entry to the goal activity log. Best-effort; never blocks a mutation."""
    try:
        goal_activity_collection().insert_one({
            "goal_id": goal_id,
            "node_id": node_id,
            "action": action,
            "old_value": old_value,
            "new_value": new_value,
            "performed_by": performed_by,
            "created_at": _now(),
        })
    except Exception:  # noqa: BLE001
        logger.exception("goal activity log failed (%s)", action)


def get_activity(user_id: str, goal_id: str, limit: int = 100) -> Dict[str, Any]:
    ensure_goal_indexes()
    uid = _uid(user_id)
    _assert_goal(uid, goal_id)
    lim = max(1, min(int(limit or 100), 500))
    rows = list(
        goal_activity_collection()
        .find({"goal_id": goal_id})
        .sort("created_at", DESCENDING)
        .limit(lim)
    )
    for r in rows:
        r["id"] = str(r.pop("_id"))
    return {"activity": rows}
