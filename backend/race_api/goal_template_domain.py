"""Universal Goal OS — templates.

A template is a stored JSON schema (goal metadata + node tree with metric templates),
using the SAME node shape as AI generation. Templates can be built-in (shipped) or
user-saved (snapshotted from an existing goal), and instantiating one creates a new goal
with the full tree.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List

from bson import ObjectId

from .context import goal_metrics_collection, goal_nodes_collection, goal_templates_collection, goals_collection
from .goal_ai_domain import _insert_ai_nodes
from .goal_domain import _uid, create_goal, ensure_goal_indexes
from .goal_progress_engine import recompute_full_goal

# Built-in templates. Small, practical starting trees; users customise after instantiating.
BUILTIN_TEMPLATES: List[Dict[str, Any]] = [
    {
        "id": "builtin:upsc", "name": "UPSC Preparation", "icon": "📚", "category": "Study",
        "description": "GS papers → subjects → lectures with Video/Notes/Revision/MCQ.",
        "schema": {"name": "UPSC Preparation", "icon": "📚", "category": "Study", "nodes": [
            {"title": "GS Paper 1", "type": "Paper", "children": [
                {"title": "History", "type": "Subject", "children": [
                    {"title": "Lecture 1", "type": "Lecture", "metrics": [
                        {"name": "Video", "target_value": 1}, {"name": "Notes", "target_value": 1},
                        {"name": "Revision", "target_value": 3}, {"name": "MCQ", "target_value": 1}]},
                ]},
                {"title": "Geography", "type": "Subject", "children": []},
            ]},
        ]},
    },
    {
        "id": "builtin:gym", "name": "Gym Program", "icon": "💪", "category": "Fitness",
        "description": "Weekly split → days → exercises with set targets.",
        "schema": {"name": "Gym Program", "icon": "💪", "category": "Fitness", "nodes": [
            {"title": "Week 1", "type": "Week", "children": [
                {"title": "Push Day", "type": "Day", "children": [
                    {"title": "Bench Press", "type": "Exercise", "metrics": [{"name": "Sets", "target_value": 4}]},
                ]},
            ]},
        ]},
    },
    {
        "id": "builtin:reading", "name": "Reading List", "icon": "📖", "category": "Reading",
        "description": "Books → chapters.",
        "schema": {"name": "Reading List", "icon": "📖", "category": "Reading", "nodes": [
            {"title": "Book 1", "type": "Book", "children": [
                {"title": "Chapter 1", "type": "Chapter", "metrics": [{"name": "Pages", "target_value": 20}]},
            ]},
        ]},
    },
    {
        "id": "builtin:habit", "name": "Daily Habits", "icon": "🔥", "category": "Habit",
        "description": "A set of daily habits to check off.",
        "schema": {"name": "Daily Habits", "icon": "🔥", "category": "Habit", "nodes": [
            {"title": "Drink water", "type": "Habit"}, {"title": "Exercise", "type": "Habit"},
            {"title": "Read", "type": "Habit"},
        ]},
    },
]


def _template_card(doc: Dict[str, Any]) -> Dict[str, Any]:
    nodes = (doc.get("schema") or {}).get("nodes") or []
    def count(ns):
        return sum(1 + count(n.get("children") or []) for n in ns)
    return {
        "id": doc.get("id") or str(doc.get("_id")),
        "name": doc.get("name", ""),
        "description": doc.get("description", ""),
        "icon": doc.get("icon") or (doc.get("schema") or {}).get("icon") or "🎯",
        "category": doc.get("category", ""),
        "node_count": count(nodes),
        "builtin": str(doc.get("id", "")).startswith("builtin:"),
    }


def list_templates(user_id: str) -> Dict[str, Any]:
    ensure_goal_indexes()
    uid = _uid(user_id)
    mine = list(goal_templates_collection().find({"owner_id": uid}).sort("created_at", -1))
    return {"templates": [_template_card(t) for t in BUILTIN_TEMPLATES] + [_template_card(t) for t in mine]}


def _snapshot_nodes(goal_id: str, parent_id: Any) -> List[Dict[str, Any]]:
    rows = list(goal_nodes_collection().find({"goal_id": goal_id, "parent_id": parent_id}).sort("order", 1))
    out = []
    for r in rows:
        node_id = str(r["_id"])
        metrics = list(goal_metrics_collection().find({"node_id": node_id}))
        out.append({
            "title": r.get("title", ""), "type": r.get("type", ""),
            "metrics": [{"name": m.get("name"), "target_value": m.get("target_value", 0), "unit": m.get("unit", "")}
                        for m in metrics],
            "children": _snapshot_nodes(goal_id, node_id),
        })
    return out


def create_template_from_goal(user_id: str, goal_id: str, name: str = "") -> Dict[str, Any]:
    ensure_goal_indexes()
    uid = _uid(user_id)
    goal = goals_collection().find_one({"_id": ObjectId(goal_id), "user_id": uid})
    if not goal:
        raise LookupError("Goal not found")
    now = datetime.now(timezone.utc).isoformat()
    schema = {
        "name": goal.get("name", ""), "icon": goal.get("icon", "🎯"),
        "category": goal.get("category", ""), "nodes": _snapshot_nodes(goal_id, None),
    }
    doc = {
        "owner_id": uid, "name": (name or goal.get("name") or "Template").strip(),
        "description": goal.get("description", ""), "icon": goal.get("icon", "🎯"),
        "category": goal.get("category", ""), "thumbnail": "", "visibility": "private",
        "schema": schema, "created_at": now, "updated_at": now,
    }
    result = goal_templates_collection().insert_one(doc)
    doc["_id"] = result.inserted_id
    return _template_card(doc)


def _resolve_schema(user_id: str, template_id: str) -> Dict[str, Any]:
    if str(template_id).startswith("builtin:"):
        for t in BUILTIN_TEMPLATES:
            if t["id"] == template_id:
                return t["schema"]
        raise LookupError("Template not found")
    doc = goal_templates_collection().find_one({"_id": ObjectId(template_id), "owner_id": user_id})
    if not doc:
        raise LookupError("Template not found")
    return doc.get("schema") or {}


def use_template(user_id: str, template_id: str, name_override: str = "") -> Dict[str, Any]:
    ensure_goal_indexes()
    uid = _uid(user_id)
    schema = _resolve_schema(uid, template_id)
    goal = create_goal(uid, {
        "name": (name_override or schema.get("name") or "New goal").strip(),
        "icon": schema.get("icon") or "🎯", "category": schema.get("category") or "General",
    })
    now = datetime.now(timezone.utc).isoformat()
    _insert_ai_nodes(goal["id"], uid, schema.get("nodes") or [], None, [], 0, now, [0])
    recompute_full_goal(goal["id"])
    return {"goal_id": goal["id"], "goal": goal}


def delete_template(user_id: str, template_id: str) -> Dict[str, Any]:
    uid = _uid(user_id)
    if str(template_id).startswith("builtin:"):
        raise ValueError("Built-in templates cannot be deleted")
    res = goal_templates_collection().delete_one({"_id": ObjectId(template_id), "owner_id": uid})
    return {"deleted": res.deleted_count > 0}
