from datetime import datetime, timedelta, timezone
from typing import Any, Dict

from pymongo import ASCENDING, DESCENDING

from .constants import PLAYERS
from .context import activity_ledger_collection, current_date_str

_ledger_indexes_ensured = False


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def ensure_ledger_indexes() -> None:
    global _ledger_indexes_ensured
    if _ledger_indexes_ensured:
        return
    coll = activity_ledger_collection()
    coll.create_index([("user_id", ASCENDING), ("created_at", DESCENDING)])
    coll.create_index([("user_id", ASCENDING), ("date", DESCENDING)])
    coll.create_index([("user_id", ASCENDING), ("mission_id", ASCENDING), ("created_at", DESCENDING)])
    coll.create_index([("activity_type", ASCENDING), ("created_at", DESCENDING)])
    _ledger_indexes_ensured = True


def log_activity(
    user_id: str,
    activity_type: str,
    *,
    points: int = 0,
    count: int = 0,
    duration_minutes: int = 0,
    mission_id: str = "",
    meta: Dict[str, Any] | None = None,
    created_at: str | None = None,
) -> None:
    uid = (user_id or "").strip().lower()
    if uid not in PLAYERS:
        return
    at = (created_at or "").strip() or _now()
    date_value = at[:10] if len(at) >= 10 else current_date_str()
    ensure_ledger_indexes()
    activity_ledger_collection().insert_one(
        {
            "doc_type": "activity_ledger_event",
            "user_id": uid,
            "activity_type": (activity_type or "").strip() or "unknown",
            "date": date_value,
            "created_at": at,
            "points": int(points or 0),
            "count": int(count or 0),
            "duration_minutes": max(0, int(duration_minutes or 0)),
            "mission_id": (mission_id or "").strip(),
            "meta": meta if isinstance(meta, dict) else {},
            "updated_at": _now(),
        }
    )


def mission_window_summary(user_id: str, mission_id: str, lookback_days: int = 90) -> Dict[str, Any]:
    uid = (user_id or "").strip().lower()
    if uid not in PLAYERS:
        raise ValueError("Invalid user_id")
    ensure_ledger_indexes()
    days = max(14, min(int(lookback_days or 90), 365))
    start_dt = datetime.now(timezone.utc) - timedelta(days=days - 1)
    start_date = start_dt.date().isoformat()

    match: Dict[str, Any] = {
        "user_id": uid,
        "date": {"$gte": start_date},
    }
    mission_key = (mission_id or "").strip()
    if mission_key:
        match["mission_id"] = mission_key

    by_type: Dict[str, Dict[str, int]] = {}
    for row in activity_ledger_collection().aggregate(
        [
            {"$match": match},
            {
                "$group": {
                    "_id": "$activity_type",
                    "events": {"$sum": 1},
                    "points": {"$sum": "$points"},
                    "count": {"$sum": "$count"},
                    "duration_minutes": {"$sum": "$duration_minutes"},
                }
            },
        ]
    ):
        key = str(row.get("_id") or "unknown")
        by_type[key] = {
            "events": int(row.get("events", 0) or 0),
            "points": int(row.get("points", 0) or 0),
            "count": int(row.get("count", 0) or 0),
            "duration_minutes": int(row.get("duration_minutes", 0) or 0),
        }

    per_day: Dict[str, Dict[str, int]] = {}
    for row in activity_ledger_collection().aggregate(
        [
            {"$match": match},
            {
                "$group": {
                    "_id": "$date",
                    "events": {"$sum": 1},
                    "points": {"$sum": "$points"},
                    "count": {"$sum": "$count"},
                    "duration_minutes": {"$sum": "$duration_minutes"},
                }
            },
            {"$sort": {"_id": 1}},
        ]
    ):
        day = str(row.get("_id") or "")
        if not day:
            continue
        per_day[day] = {
            "events": int(row.get("events", 0) or 0),
            "points": int(row.get("points", 0) or 0),
            "count": int(row.get("count", 0) or 0),
            "duration_minutes": int(row.get("duration_minutes", 0) or 0),
        }

    totals = {"events": 0, "points": 0, "count": 0, "duration_minutes": 0}
    for value in by_type.values():
        totals["events"] += int(value.get("events", 0))
        totals["points"] += int(value.get("points", 0))
        totals["count"] += int(value.get("count", 0))
        totals["duration_minutes"] += int(value.get("duration_minutes", 0))

    return {
        "user_id": uid,
        "mission_id": mission_key,
        "lookback_days": days,
        "start_date": start_date,
        "by_type": by_type,
        "per_day": per_day,
        "totals": totals,
    }
