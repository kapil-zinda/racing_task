"""Universal Goal OS — GoalNode CRUD (the recursive tree).

One document per node (adjacency list). Each node stores `parent_id` (None for a
top-level node), a root-first `path` array of ancestor ids, `depth`, and an `order`
float for sibling ordering. This supports lazy subtree loading and node counts up to
~1k per goal without hitting Mongo's document size limit.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from bson import ObjectId

from .context import goal_metrics_collection, goal_nodes_collection, goals_collection
from .goal_domain import _uid, ensure_goal_indexes, log_activity
from .goal_progress_engine import recompute_goal_rollup, recompute_upward

_MAX_NODES_PER_GOAL = 1000
_MAX_DEPTH = 12
NODE_STATUSES = {"todo", "in_progress", "done", "blocked", "skipped"}
PROGRESS_MODES = {"children_weighted", "formula", "metric", "boolean", "manual"}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _oid(value: str, label: str = "node id") -> ObjectId:
    try:
        return ObjectId(value)
    except Exception:
        raise ValueError(f"Invalid {label}")


def _assert_goal(user_id: str, goal_id: str) -> Dict[str, Any]:
    doc = goals_collection().find_one({"_id": _oid(goal_id, "goal id"), "user_id": user_id})
    if not doc:
        raise LookupError("Goal not found")
    return doc


def _public_node(doc: Dict[str, Any]) -> Dict[str, Any]:
    doc = dict(doc)
    doc["id"] = str(doc.pop("_id"))
    doc.pop("user_id", None)
    return doc


def _child_count(goal_id: str, node_id: str) -> int:
    return goal_nodes_collection().count_documents({"goal_id": goal_id, "parent_id": node_id})


def create_node(user_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    ensure_goal_indexes()
    uid = _uid(user_id)
    goal_id = str(payload.get("goal_id") or "").strip()
    if not goal_id:
        raise ValueError("goal_id is required")
    _assert_goal(uid, goal_id)

    title = str(payload.get("title") or "").strip()
    if not title:
        raise ValueError("title is required")

    if goal_nodes_collection().count_documents({"goal_id": goal_id}) >= _MAX_NODES_PER_GOAL:
        raise ValueError(f"Goal node limit reached ({_MAX_NODES_PER_GOAL})")

    parent_id = payload.get("parent_id")
    parent_id = str(parent_id).strip() if parent_id else None
    path: List[str] = []
    depth = 0
    if parent_id:
        parent = goal_nodes_collection().find_one({"_id": _oid(parent_id, "parent_id"), "goal_id": goal_id})
        if not parent:
            raise LookupError("Parent node not found")
        path = list(parent.get("path", []) or []) + [parent_id]
        depth = len(path)
        if depth > _MAX_DEPTH:
            raise ValueError(f"Max nesting depth exceeded ({_MAX_DEPTH})")

    order = payload.get("order")
    if order is None:
        last = list(
            goal_nodes_collection()
            .find({"goal_id": goal_id, "parent_id": parent_id}, {"order": 1})
            .sort("order", -1)
            .limit(1)
        )
        order = (float(last[0].get("order", 0)) + 1.0) if last else 0.0

    mode = str(payload.get("progress_mode") or "children_weighted").strip().lower()
    if mode not in PROGRESS_MODES:
        mode = "children_weighted"
    status = str(payload.get("status") or "todo").strip().lower()
    if status not in NODE_STATUSES:
        status = "todo"

    now = _now()
    doc = {
        "goal_id": goal_id,
        "user_id": uid,
        "parent_id": parent_id,
        "path": path,
        "depth": depth,
        "order": float(order),
        "title": title,
        "description": str(payload.get("description") or "").strip(),
        "type": str(payload.get("type") or "").strip(),
        "status": status,
        "weight": float(payload.get("weight") or 1),
        "estimated_value": payload.get("estimated_value"),
        "actual_value": payload.get("actual_value"),
        "unit": str(payload.get("unit") or "").strip(),
        "progress": 0.0,
        "progress_mode": mode,
        "formula": str(payload.get("formula") or "").strip(),
        "metadata": payload.get("metadata") if isinstance(payload.get("metadata"), dict) else {},
        "created_at": now,
        "updated_at": now,
    }
    result = goal_nodes_collection().insert_one(doc)
    doc["_id"] = result.inserted_id
    node_id = str(result.inserted_id)
    log_activity(goal_id, node_id, "node_created", uid, new_value=title)
    # A new child can change a parent's rollup; recompute upward from this node.
    recompute_upward(goal_id, node_id)
    return _public_node(goal_nodes_collection().find_one({"_id": result.inserted_id}))


def _resolve_titles(payload: Dict[str, Any]) -> List[str]:
    """Build the list of child titles from either an explicit `titles` list or a
    `name_pattern` + `count` (+ optional `start`). `{n}` in the pattern is the index."""
    explicit = payload.get("titles")
    if isinstance(explicit, list) and explicit:
        titles = [str(t).strip() for t in explicit if str(t).strip()]
    else:
        pattern = str(payload.get("name_pattern") or "").strip()
        count = int(payload.get("count") or 0)
        start = int(payload.get("start") or 1)
        if not pattern or count <= 0:
            raise ValueError("Provide either 'titles' or 'name_pattern' + 'count'")
        if "{n}" not in pattern:
            pattern = pattern + " {n}"
        titles = [pattern.replace("{n}", str(start + i)) for i in range(count)]
    if not titles:
        raise ValueError("No child titles to create")
    if len(titles) > 500:
        raise ValueError("Cannot bulk-create more than 500 children at once")
    return titles


def bulk_create_children(user_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    """Create many identical sibling nodes under one parent, each with the SAME metric
    template. Example: parent "History", 14 children "Class 1..14", each with metrics
    Video(1), Notes(1), Revision(4). Defined once, applied to all.
    """
    ensure_goal_indexes()
    uid = _uid(user_id)
    goal_id = str(payload.get("goal_id") or "").strip()
    if not goal_id:
        raise ValueError("goal_id is required")
    _assert_goal(uid, goal_id)

    titles = _resolve_titles(payload)

    parent_id = payload.get("parent_id")
    parent_id = str(parent_id).strip() if parent_id else None
    path: List[str] = []
    if parent_id:
        parent = goal_nodes_collection().find_one({"_id": _oid(parent_id, "parent_id"), "goal_id": goal_id})
        if not parent:
            raise LookupError("Parent node not found")
        path = list(parent.get("path", []) or []) + [parent_id]
        if len(path) > _MAX_DEPTH:
            raise ValueError(f"Max nesting depth exceeded ({_MAX_DEPTH})")
    depth = len(path)

    existing = goal_nodes_collection().count_documents({"goal_id": goal_id})
    if existing + len(titles) > _MAX_NODES_PER_GOAL:
        raise ValueError(f"Goal node limit reached ({_MAX_NODES_PER_GOAL})")

    metric_defs = payload.get("metrics") if isinstance(payload.get("metrics"), list) else []
    metric_defs = [m for m in metric_defs if isinstance(m, dict) and str(m.get("name") or "").strip()]

    # Children with a metric template default to metric-mode so the metrics drive
    # progress; otherwise a plain leaf (boolean on status).
    default_mode = "metric" if metric_defs else "boolean"
    mode = str(payload.get("progress_mode") or default_mode).strip().lower()
    if mode not in PROGRESS_MODES:
        mode = default_mode
    node_type = str(payload.get("type") or "").strip()
    weight = float(payload.get("weight") or 1)

    last = list(
        goal_nodes_collection()
        .find({"goal_id": goal_id, "parent_id": parent_id}, {"order": 1})
        .sort("order", -1).limit(1)
    )
    next_order = (float(last[0].get("order", 0)) + 1.0) if last else 0.0

    now = _now()
    created_ids: List[str] = []
    for title in titles:
        node_doc = {
            "goal_id": goal_id, "user_id": uid, "parent_id": parent_id, "path": path,
            "depth": depth, "order": next_order, "title": title, "description": "",
            "type": node_type, "status": "todo", "weight": weight,
            "estimated_value": None, "actual_value": None, "unit": "", "progress": 0.0,
            "progress_mode": mode, "formula": "", "metadata": {},
            "created_at": now, "updated_at": now,
        }
        next_order += 1.0
        node_id = str(goal_nodes_collection().insert_one(node_doc).inserted_id)
        created_ids.append(node_id)
        for md in metric_defs:
            goal_metrics_collection().insert_one({
                "goal_id": goal_id, "node_id": node_id, "user_id": uid,
                "name": str(md.get("name")).strip(),
                "type": str(md.get("type") or "number").strip(),
                "unit": str(md.get("unit") or "").strip(),
                "target_value": float(md.get("target_value") or 0),
                "current_value": 0.0,
                "min_value": None, "max_value": None,
                "created_at": now, "updated_at": now,
            })

    log_activity(goal_id, parent_id, "nodes_bulk_created", uid, new_value=len(created_ids))
    # One recompute pass instead of per-node: parent chain (or goal rollup for top-level).
    if parent_id:
        recompute_upward(goal_id, parent_id)
    else:
        recompute_goal_rollup(goal_id)
    return {"created": len(created_ids), "node_ids": created_ids}


_EDITABLE = {"title", "description", "type", "weight", "estimated_value", "actual_value",
             "unit", "formula", "metadata", "order"}


def update_node(user_id: str, node_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    ensure_goal_indexes()
    uid = _uid(user_id)
    node = goal_nodes_collection().find_one({"_id": _oid(node_id), "user_id": uid})
    if not node:
        raise LookupError("Node not found")
    goal_id = node["goal_id"]

    update: Dict[str, Any] = {"updated_at": _now()}
    for field in _EDITABLE:
        if field not in payload:
            continue
        if field == "weight":
            update[field] = float(payload.get(field) or 1)
        elif field == "order":
            update[field] = float(payload.get(field) or 0)
        elif field == "metadata":
            update[field] = payload[field] if isinstance(payload[field], dict) else {}
        elif field in {"estimated_value", "actual_value"}:
            update[field] = payload.get(field)
        else:
            update[field] = str(payload.get(field) or "").strip()
    if "title" in update and not update["title"]:
        raise ValueError("title is required")

    affects_progress = False
    if "status" in payload:
        status = str(payload.get("status") or "").strip().lower()
        if status not in NODE_STATUSES:
            raise ValueError(f"status must be one of: {', '.join(sorted(NODE_STATUSES))}")
        update["status"] = status
        affects_progress = True
    if "progress_mode" in payload:
        mode = str(payload.get("progress_mode") or "").strip().lower()
        if mode not in PROGRESS_MODES:
            raise ValueError(f"progress_mode must be one of: {', '.join(sorted(PROGRESS_MODES))}")
        update["progress_mode"] = mode
        affects_progress = True
    if "progress" in payload:  # only meaningful for manual mode
        update["progress"] = max(0.0, min(100.0, float(payload.get("progress") or 0)))
        affects_progress = True

    goal_nodes_collection().update_one({"_id": node["_id"]}, {"$set": update})
    log_activity(goal_id, node_id, "node_updated", uid,
                 old_value=node.get("status"), new_value=update.get("status"))
    if affects_progress or "weight" in update or "formula" in update:
        recompute_upward(goal_id, node_id)
    return _public_node(goal_nodes_collection().find_one({"_id": node["_id"]}))


def delete_node(user_id: str, node_id: str) -> Dict[str, Any]:
    """Delete a node and its entire subtree (plus their metrics)."""
    ensure_goal_indexes()
    uid = _uid(user_id)
    node = goal_nodes_collection().find_one({"_id": _oid(node_id), "user_id": uid})
    if not node:
        raise LookupError("Node not found")
    goal_id = node["goal_id"]
    parent_id = node.get("parent_id")

    # Subtree = the node itself plus every node whose path contains it.
    subtree_ids = [node["_id"]]
    for descendant in goal_nodes_collection().find({"goal_id": goal_id, "path": node_id}, {"_id": 1}):
        subtree_ids.append(descendant["_id"])
    str_ids = [str(i) for i in subtree_ids]
    goal_metrics_collection().delete_many({"node_id": {"$in": str_ids}})
    result = goal_nodes_collection().delete_many({"_id": {"$in": subtree_ids}})
    log_activity(goal_id, node_id, "node_deleted", uid, old_value=node.get("title"))

    # Recompute the former parent (or the goal rollup for a top-level node).
    if parent_id:
        recompute_upward(goal_id, parent_id)
    else:
        recompute_goal_rollup(goal_id)
    return {"deleted": int(result.deleted_count), "node_id": node_id}


def move_node(user_id: str, node_id: str, new_parent_id: Optional[str], order: Optional[float]) -> Dict[str, Any]:
    """Reparent/reorder a node, rewriting path/depth for it and its whole subtree."""
    ensure_goal_indexes()
    uid = _uid(user_id)
    node = goal_nodes_collection().find_one({"_id": _oid(node_id), "user_id": uid})
    if not node:
        raise LookupError("Node not found")
    goal_id = node["goal_id"]
    old_parent_id = node.get("parent_id")

    new_parent_id = str(new_parent_id).strip() if new_parent_id else None
    new_path: List[str] = []
    if new_parent_id:
        if new_parent_id == node_id:
            raise ValueError("A node cannot be its own parent")
        parent = goal_nodes_collection().find_one({"_id": _oid(new_parent_id, "parent_id"), "goal_id": goal_id})
        if not parent:
            raise LookupError("Target parent not found")
        # Prevent moving a node into its own subtree.
        if node_id in (parent.get("path", []) or []):
            raise ValueError("Cannot move a node into its own descendant")
        new_path = list(parent.get("path", []) or []) + [new_parent_id]

    new_depth = len(new_path)
    if new_depth > _MAX_DEPTH:
        raise ValueError(f"Max nesting depth exceeded ({_MAX_DEPTH})")

    set_fields: Dict[str, Any] = {
        "parent_id": new_parent_id, "path": new_path, "depth": new_depth, "updated_at": _now(),
    }
    if order is not None:
        set_fields["order"] = float(order)
    goal_nodes_collection().update_one({"_id": node["_id"]}, {"$set": set_fields})

    # Rewrite every descendant's path/depth: swap the old ancestor-prefix for the new one.
    old_prefix = list(node.get("path", []) or []) + [node_id]
    new_prefix = new_path + [node_id]
    for desc in goal_nodes_collection().find({"goal_id": goal_id, "path": node_id}):
        d_path = list(desc.get("path", []) or [])
        # Replace the leading old_prefix with new_prefix.
        tail = d_path[len(old_prefix):] if d_path[: len(old_prefix)] == old_prefix else d_path
        rebuilt = new_prefix + tail
        goal_nodes_collection().update_one(
            {"_id": desc["_id"]},
            {"$set": {"path": rebuilt, "depth": len(rebuilt), "updated_at": _now()}},
        )

    log_activity(goal_id, node_id, "node_moved", uid, old_value=old_parent_id, new_value=new_parent_id)
    # Both the old and new parent chains need recomputing.
    if old_parent_id:
        recompute_upward(goal_id, old_parent_id)
    recompute_upward(goal_id, node_id)
    if not new_parent_id or not old_parent_id:
        recompute_goal_rollup(goal_id)
    return _public_node(goal_nodes_collection().find_one({"_id": node["_id"]}))


def get_tree(user_id: str, goal_id: str, parent_id: Optional[str] = None, depth: int = 0) -> Dict[str, Any]:
    """Fetch a goal's tree.

    - depth=0 (default): return ALL nodes for the goal as a flat list (client builds the
      tree). Fine for <=1k nodes.
    - depth>0: lazy mode — return only descendants of `parent_id` down to `depth` levels,
      each annotated with `has_children` so the UI can show expanders.
    """
    ensure_goal_indexes()
    uid = _uid(user_id)
    _assert_goal(uid, goal_id)
    coll = goal_nodes_collection()

    if depth <= 0 and not parent_id:
        nodes = list(coll.find({"goal_id": goal_id}).sort([("depth", 1), ("order", 1)]))
        return {"goal_id": goal_id, "nodes": [_public_node(n) for n in nodes], "mode": "full"}

    base_depth = 0
    if parent_id:
        parent = coll.find_one({"_id": _oid(parent_id, "parent_id"), "goal_id": goal_id})
        if not parent:
            raise LookupError("Parent node not found")
        base_depth = int(parent.get("depth", 0)) + 1
        query = {"goal_id": goal_id, "path": parent_id}
    else:
        query = {"goal_id": goal_id, "parent_id": None}

    max_depth = base_depth + max(1, int(depth)) - 1
    nodes = list(
        coll.find({**query, "depth": {"$lte": max_depth}}).sort([("depth", 1), ("order", 1)])
    )
    out = []
    for n in nodes:
        pub = _public_node(n)
        pub["has_children"] = _child_count(goal_id, pub["id"]) > 0
        out.append(pub)
    return {"goal_id": goal_id, "parent_id": parent_id, "nodes": out, "mode": "lazy"}
