"""Universal Goal OS — analytics aggregation + calendar.

All aggregates are computed on demand (no rollup workers) from goal_nodes / goal_metrics /
goal_activity, shaped for the frontend Plotly charts (donut, treemap, heatmap, bar, rings).
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List

from bson import ObjectId

from .context import (
    goal_activity_collection,
    goal_metrics_collection,
    goal_nodes_collection,
    goal_reminders_collection,
    goals_collection,
)
from .goal_domain import _uid, ensure_goal_indexes


def _owned_goal(user_id: str, goal_id: str) -> Dict[str, Any]:
    doc = goals_collection().find_one({"_id": ObjectId(goal_id), "user_id": user_id})
    if not doc:
        raise LookupError("Goal not found")
    return doc


def analytics(user_id: str, goal_id: str) -> Dict[str, Any]:
    ensure_goal_indexes()
    uid = _uid(user_id)
    goal = _owned_goal(uid, goal_id)
    nodes = list(goal_nodes_collection().find({"goal_id": goal_id}))

    # Status distribution (donut).
    status_counts: Dict[str, int] = {}
    for n in nodes:
        s = n.get("status", "todo")
        status_counts[s] = status_counts.get(s, 0) + 1

    # Progress grouped by node type (bar / treemap).
    by_type: Dict[str, List[float]] = {}
    for n in nodes:
        t = (n.get("type") or "Untyped").strip() or "Untyped"
        by_type.setdefault(t, []).append(float(n.get("progress", 0) or 0))
    progress_by_type = [
        {"type": t, "avg_progress": round(sum(v) / len(v), 1), "count": len(v)}
        for t, v in sorted(by_type.items())
    ]

    # Top-level node progress (treemap / bars).
    roots = [n for n in nodes if not n.get("parent_id")]
    node_progress = [
        {"title": n.get("title", ""), "progress": round(float(n.get("progress", 0) or 0), 1),
         "weight": float(n.get("weight", 1) or 1)}
        for n in sorted(roots, key=lambda x: x.get("order", 0))
    ]

    # Leaves done vs total (rings).
    child_parents = set(n.get("parent_id") for n in nodes if n.get("parent_id"))
    leaves = [n for n in nodes if str(n["_id"]) not in child_parents]
    leaves_done = sum(1 for n in leaves if float(n.get("progress", 0) or 0) >= 100)

    # Activity by date (heatmap / line), last 120 days.
    since = (datetime.now(timezone.utc) - timedelta(days=120)).isoformat()
    activity_by_date: Dict[str, int] = {}
    for a in goal_activity_collection().find(
        {"goal_id": goal_id, "created_at": {"$gte": since},
         "action": {"$in": ["node_updated", "metric_incremented", "node_created", "nodes_bulk_created"]}},
        {"created_at": 1},
    ):
        d = (a.get("created_at") or "")[:10]
        if d:
            activity_by_date[d] = activity_by_date.get(d, 0) + 1

    # Metric completion totals.
    metrics = list(goal_metrics_collection().find({"goal_id": goal_id}))
    metric_summary = [
        {"name": m.get("name", ""), "current": float(m.get("current_value", 0) or 0),
         "target": float(m.get("target_value", 0) or 0)}
        for m in metrics
    ]

    return {
        "goal_id": goal_id,
        "overall_progress": round(float(goal.get("progress", 0) or 0), 1),
        "total_nodes": len(nodes),
        "leaves_total": len(leaves),
        "leaves_done": leaves_done,
        "status_distribution": status_counts,
        "progress_by_type": progress_by_type,
        "node_progress": node_progress,
        "activity_by_date": activity_by_date,
        "metric_summary": metric_summary,
    }


def calendar(user_id: str, goal_id: str = "") -> Dict[str, Any]:
    """Calendar feed: reminders + activity counts by date. Scoped to one goal or all."""
    ensure_goal_indexes()
    uid = _uid(user_id)
    q: Dict[str, Any] = {"user_id": uid}
    if goal_id:
        _owned_goal(uid, goal_id)
        q = {"goal_id": goal_id}

    since = (datetime.now(timezone.utc) - timedelta(days=120)).isoformat()
    act_q = {**({"goal_id": goal_id} if goal_id else {}), "created_at": {"$gte": since}}
    activity_by_date: Dict[str, int] = {}
    for a in goal_activity_collection().find(act_q, {"created_at": 1}):
        d = (a.get("created_at") or "")[:10]
        if d:
            activity_by_date[d] = activity_by_date.get(d, 0) + 1

    reminders = list(goal_reminders_collection().find({**q, "status": {"$ne": "done"}}).sort("time", 1))
    return {
        "activity_by_date": activity_by_date,
        "reminders": [{"id": str(r["_id"]), "goal_id": r.get("goal_id"), "node_id": r.get("node_id"),
                       "time": r.get("time"), "type": r.get("type"), "status": r.get("status")}
                      for r in reminders],
    }
