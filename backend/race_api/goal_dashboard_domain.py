"""Universal Goal OS — home dashboard aggregate (across all of a user's goals).

Powers the goals home: streaks, activity heatmap, today-vs-yesterday and this-week-vs-
last-week comparisons, and today's outstanding leaf tasks (for the "free your mind" hero).
All computed on demand from goal_activity + goal_nodes.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List

from .context import goal_activity_collection, goal_nodes_collection, goals_collection
from .goal_domain import _uid, ensure_goal_indexes, iso_to_local_date, local_today

_ACTION_TYPES = ["node_updated", "metric_incremented", "node_created", "nodes_bulk_created"]


def _activity_by_date(user_id: str, days: int = 180, tz_offset: int = 0) -> Dict[str, int]:
    # Fetch a slightly wider UTC window so nothing is dropped when shifting to local days.
    since = (datetime.now(timezone.utc) - timedelta(days=days + 1)).isoformat()
    goal_ids = [str(g["_id"]) for g in goals_collection().find({"user_id": user_id}, {"_id": 1})]
    if not goal_ids:
        return {}
    out: Dict[str, int] = {}
    for a in goal_activity_collection().find(
        {"goal_id": {"$in": goal_ids}, "created_at": {"$gte": since}, "action": {"$in": _ACTION_TYPES}},
        {"created_at": 1},
    ):
        d = iso_to_local_date(a.get("created_at"), tz_offset)
        if d:
            out[d] = out.get(d, 0) + 1
    return out


def _streaks(active_dates: set, tz_offset: int = 0) -> Dict[str, int]:
    """Current + longest streak (consecutive days with activity). Current streak counts
    back from today; if today has none but yesterday does, the streak is still alive."""
    if not active_dates:
        return {"current": 0, "longest": 0}
    today = local_today(tz_offset)

    current = 0
    cursor = today
    if today.isoformat() not in active_dates and (today - timedelta(days=1)).isoformat() in active_dates:
        cursor = today - timedelta(days=1)
    while cursor.isoformat() in active_dates:
        current += 1
        cursor -= timedelta(days=1)

    longest = 0
    run = 0
    prev = None
    for d in sorted(active_dates):
        cur = datetime.fromisoformat(d).date()
        run = run + 1 if (prev and (cur - prev).days == 1) else 1
        longest = max(longest, run)
        prev = cur
    return {"current": current, "longest": longest}


def _last_n_days_counts(activity: Dict[str, int], n: int, offset: int = 0, tz_offset: int = 0) -> List[Dict[str, Any]]:
    today = local_today(tz_offset)
    out = []
    for i in range(n - 1, -1, -1):
        d = today - timedelta(days=i + offset)
        out.append({"date": d.isoformat(), "label": d.strftime("%a"), "count": activity.get(d.isoformat(), 0)})
    return out


def _today_tasks(user_id: str, limit: int = 6) -> List[Dict[str, Any]]:
    """Outstanding leaf tasks across active goals — the 'thoughts' to clear today."""
    goals = list(goals_collection().find({"user_id": user_id, "status": {"$ne": "archived"}}, {"_id": 1, "name": 1, "icon": 1}))
    gmap = {str(g["_id"]): g for g in goals}
    if not gmap:
        return []
    nodes = list(goal_nodes_collection().find({"goal_id": {"$in": list(gmap.keys())}}))
    title_by_id = {str(n["_id"]): n.get("title", "") for n in nodes}
    child_parents = {n.get("parent_id") for n in nodes if n.get("parent_id")}
    leaves = [n for n in nodes if str(n["_id"]) not in child_parents]
    pending = [n for n in leaves if float(n.get("progress", 0) or 0) < 100 and n.get("status") not in {"skipped", "done"}]
    pending.sort(key=lambda n: (n.get("status") != "in_progress", float(n.get("progress", 0) or 0)))
    out = []
    for n in pending[: max(1, min(int(limit or 6), 12))]:
        g = gmap.get(n.get("goal_id"), {})
        parent_title = title_by_id.get(n.get("parent_id"), "") if n.get("parent_id") else ""
        out.append({
            "id": str(n["_id"]), "goal_id": n.get("goal_id"), "title": n.get("title", ""),
            "parent_title": parent_title,
            "progress": round(float(n.get("progress", 0) or 0), 1),
            "goal_name": g.get("name", ""), "goal_icon": g.get("icon", "🎯"),
        })
    return out


def dashboard(user_id: str, tz_offset: int = 0) -> Dict[str, Any]:
    ensure_goal_indexes()
    uid = _uid(user_id)
    activity = _activity_by_date(uid, 180, tz_offset)
    active_dates = {d for d, c in activity.items() if c > 0}
    streaks = _streaks(active_dates, tz_offset)

    today = local_today(tz_offset)
    yesterday = today - timedelta(days=1)

    goals = list(goals_collection().find({"user_id": uid}))
    active = [g for g in goals if g.get("status") == "active"]
    avg = round(sum(float(g.get("progress", 0) or 0) for g in active) / len(active), 1) if active else 0.0

    # Per-goal progress (combined "progress by goal" chart).
    goals_progress = [
        {"id": str(g["_id"]), "name": g.get("name", ""), "icon": g.get("icon", "🎯"),
         "progress": round(float(g.get("progress", 0) or 0), 1), "status": g.get("status", "active")}
        for g in sorted(goals, key=lambda x: float(x.get("progress", 0) or 0), reverse=True)
    ]

    # Combined status distribution across every node of every goal.
    goal_ids = [str(g["_id"]) for g in goals]
    status_distribution: Dict[str, int] = {}
    if goal_ids:
        for n in goal_nodes_collection().find({"goal_id": {"$in": goal_ids}}, {"status": 1}):
            s = n.get("status", "todo")
            status_distribution[s] = status_distribution.get(s, 0) + 1

    return {
        "activity_by_date": activity,
        "streak_current": streaks["current"],
        "streak_longest": streaks["longest"],
        "today_count": activity.get(today.isoformat(), 0),
        "yesterday_count": activity.get(yesterday.isoformat(), 0),
        "this_week": _last_n_days_counts(activity, 7, 0, tz_offset),
        "last_week": _last_n_days_counts(activity, 7, 7, tz_offset),
        "today_tasks": _today_tasks(uid),
        "goal_count": len(goals),
        "active_count": len(active),
        "avg_progress": avg,
        "goals_progress": goals_progress,
        "status_distribution": status_distribution,
    }
