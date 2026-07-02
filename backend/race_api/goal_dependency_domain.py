"""Universal Goal OS — node dependencies (e.g. "Lecture 2 depends on Lecture 1")."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List

from bson import ObjectId

from .context import goal_dependencies_collection, goal_nodes_collection, goals_collection
from .goal_domain import _uid, ensure_goal_indexes


def _owned_goal(user_id: str, goal_id: str) -> Dict[str, Any]:
    doc = goals_collection().find_one({"_id": ObjectId(goal_id), "user_id": user_id})
    if not doc:
        raise LookupError("Goal not found")
    return doc


def _node_in_goal(goal_id: str, node_id: str) -> None:
    if not goal_nodes_collection().find_one({"_id": ObjectId(node_id), "goal_id": goal_id}):
        raise LookupError(f"Node {node_id} not found in goal")


def _would_cycle(goal_id: str, source: str, target: str) -> bool:
    """True if adding source->target creates a cycle (target already reaches source)."""
    coll = goal_dependencies_collection()
    seen = set()
    stack = [target]
    while stack:
        cur = stack.pop()
        if cur == source:
            return True
        if cur in seen:
            continue
        seen.add(cur)
        for dep in coll.find({"goal_id": goal_id, "source_node_id": cur}, {"target_node_id": 1}):
            stack.append(dep["target_node_id"])
    return False


def list_dependencies(user_id: str, goal_id: str) -> Dict[str, Any]:
    ensure_goal_indexes()
    uid = _uid(user_id)
    _owned_goal(uid, goal_id)
    rows = list(goal_dependencies_collection().find({"goal_id": goal_id}))
    return {"dependencies": [{
        "id": str(r["_id"]), "source_node_id": r.get("source_node_id"),
        "target_node_id": r.get("target_node_id"), "dependency_type": r.get("dependency_type", "blocks"),
    } for r in rows]}


def create_dependency(user_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    ensure_goal_indexes()
    uid = _uid(user_id)
    goal_id = str(payload.get("goal_id") or "").strip()
    source = str(payload.get("source_node_id") or "").strip()
    target = str(payload.get("target_node_id") or "").strip()
    if not (goal_id and source and target):
        raise ValueError("goal_id, source_node_id and target_node_id are required")
    if source == target:
        raise ValueError("A node cannot depend on itself")
    _owned_goal(uid, goal_id)
    _node_in_goal(goal_id, source)
    _node_in_goal(goal_id, target)
    if _would_cycle(goal_id, source, target):
        raise ValueError("This dependency would create a cycle")
    doc = {
        "goal_id": goal_id, "source_node_id": source, "target_node_id": target,
        "dependency_type": str(payload.get("dependency_type") or "blocks").strip(),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    res = goal_dependencies_collection().insert_one(doc)
    doc["id"] = str(res.inserted_id)
    doc.pop("_id", None)
    return doc


def delete_dependency(user_id: str, dep_id: str) -> Dict[str, Any]:
    ensure_goal_indexes()
    uid = _uid(user_id)
    dep = goal_dependencies_collection().find_one({"_id": ObjectId(dep_id)})
    if not dep:
        raise LookupError("Dependency not found")
    _owned_goal(uid, dep["goal_id"])
    goal_dependencies_collection().delete_one({"_id": dep["_id"]})
    return {"deleted": True, "id": dep_id}
