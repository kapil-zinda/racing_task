from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List

from bson import ObjectId

from .activity_tracker_domain import _DEFAULT_CATEGORIES
from .context import current_date_str, live_study_sessions_collection, study_groups_collection, users_collection


def _uid(user_id: str) -> str:
    uid = (user_id or "").strip()
    if not uid:
        raise ValueError("Invalid user_id")
    return uid


def _user_name(user_id: str) -> str:
    try:
        user = users_collection().find_one({"_id": ObjectId(user_id)})
    except Exception:  # noqa: BLE001
        user = None
    return (user or {}).get("name") or "Member"


def _date_range_for_period(period: str) -> Dict[str, str]:
    today = current_date_str()
    if period == "today":
        return {"$gte": today, "$lte": today}
    if period == "week":
        start = (datetime.fromisoformat(today) - timedelta(days=6)).date().isoformat()
        return {"$gte": start, "$lte": today}
    return {"$gte": "0000-00-00", "$lte": today}  # all-time


def _rank_rows(match: Dict[str, Any]) -> List[Dict[str, Any]]:
    pipeline = [
        {"$match": match},
        {"$group": {"_id": "$user_id", "total_seconds": {"$sum": "$elapsed_seconds"}}},
        {"$sort": {"total_seconds": -1}},
    ]
    rows = list(live_study_sessions_collection().aggregate(pipeline))
    total = len(rows)
    result = []
    for idx, row in enumerate(rows):
        rank = idx + 1
        result.append(
            {
                "user_id": row["_id"],
                "name": _user_name(row["_id"]),
                "total_minutes": max(0, int(row.get("total_seconds", 0)) // 60),
                "rank": rank,
                "percentile": round(100 * (1 - (rank - 1) / total), 1) if total else 100.0,
            }
        )
    return result


def group_leaderboard(user_id: str, group_id: str, period: str = "week", category: str = "") -> Dict[str, Any]:
    uid = _uid(user_id)
    if not study_groups_collection().find_one({"_id": group_id}):
        raise LookupError("Group not found")
    match: Dict[str, Any] = {"group_id": group_id, "status": "stopped", "date": _date_range_for_period(period)}
    category = (category or "").strip()
    if category:
        match["category"] = category
    rows = _rank_rows(match)
    me = next((r for r in rows if r["user_id"] == uid), None)
    return {"period": period, "category": category or None, "rows": rows, "me": me}


def global_leaderboard(user_id: str, period: str = "week", category: str = "") -> Dict[str, Any]:
    uid = _uid(user_id)
    match: Dict[str, Any] = {"status": "stopped", "date": _date_range_for_period(period)}
    category = (category or "").strip()
    if category:
        match["category"] = category
    rows = _rank_rows(match)
    me = next((r for r in rows if r["user_id"] == uid), None)
    return {"period": period, "category": category or None, "rows": rows[:500], "me": me}


def list_leaderboard_categories(user_id: str) -> Dict[str, Any]:
    _uid(user_id)
    names = [c["name"] for c in _DEFAULT_CATEGORIES]
    focuses = study_groups_collection().distinct("category_focus")
    for f in focuses:
        if f and f not in names:
            names.append(f)
    return {"categories": names}
