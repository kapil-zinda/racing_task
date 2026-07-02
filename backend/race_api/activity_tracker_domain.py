from datetime import datetime, timezone
from typing import Any, Dict, List

from bson import ObjectId
from pymongo import ASCENDING

from .context import activity_categories_collection, day_activities_collection

_DEFAULT_CATEGORIES = [
    {"name": "Study", "color": "#6366f1"},
    {"name": "Exercise", "color": "#10b981"},
    {"name": "Time Wasted", "color": "#ef4444"},
    {"name": "Break", "color": "#94a3b8"},
]


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _uid(user_id: str) -> str:
    uid = (user_id or "").strip()
    if not uid:
        raise ValueError("Invalid user_id")
    return uid


def _calc_duration(start_time: str, end_time: str) -> int:
    try:
        sh, sm = map(int, start_time.split(":"))
        eh, em = map(int, end_time.split(":"))
        diff = (eh * 60 + em) - (sh * 60 + sm)
        if diff < 0:
            diff += 24 * 60
        return max(0, diff)
    except Exception:
        return 0


def get_categories(user_id: str) -> List[Dict[str, Any]]:
    uid = _uid(user_id)
    cats = list(activity_categories_collection().find({"user_id": uid}, {"_id": 0, "user_id": 0}))
    if not cats:
        now = _now()
        activity_categories_collection().insert_many(
            [{"user_id": uid, "name": c["name"], "color": c["color"], "created_at": now} for c in _DEFAULT_CATEGORIES]
        )
        return [{"name": c["name"], "color": c["color"]} for c in _DEFAULT_CATEGORIES]
    return [{"name": c["name"], "color": c.get("color", "#6366f1")} for c in cats]


def create_category(user_id: str, name: str, color: str) -> Dict[str, Any]:
    uid = _uid(user_id)
    name = (name or "").strip()
    if not name:
        raise ValueError("Category name required")
    color = (color or "#6366f1").strip()
    if activity_categories_collection().find_one({"user_id": uid, "name": name}):
        raise ValueError(f"Category '{name}' already exists")
    activity_categories_collection().insert_one(
        {"user_id": uid, "name": name, "color": color, "created_at": _now()}
    )
    return {"name": name, "color": color}


def delete_category(user_id: str, name: str) -> Dict[str, Any]:
    uid = _uid(user_id)
    result = activity_categories_collection().delete_one({"user_id": uid, "name": (name or "").strip()})
    return {"deleted": result.deleted_count > 0}


def get_activities(user_id: str, date: str) -> List[Dict[str, Any]]:
    uid = _uid(user_id)
    date = (date or "").strip() or datetime.now(timezone.utc).date().isoformat()
    docs = list(
        day_activities_collection()
        .find({"user_id": uid, "date": date}, {"user_id": 0})
        .sort("start_time", ASCENDING)
    )
    for doc in docs:
        doc["id"] = str(doc.pop("_id"))
    return docs


def create_activity(user_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    uid = _uid(user_id)
    title = (payload.get("title") or "").strip()
    if not title:
        raise ValueError("Title required")
    start_time = (payload.get("start_time") or "").strip()
    end_time = (payload.get("end_time") or "").strip()
    category = (payload.get("category") or "Study").strip()
    note = (payload.get("note") or "").strip()
    date = (payload.get("date") or "").strip() or datetime.now(timezone.utc).date().isoformat()
    duration_minutes = _calc_duration(start_time, end_time) if start_time and end_time else 0
    now = _now()
    doc = {
        "user_id": uid,
        "title": title,
        "date": date,
        "start_time": start_time,
        "end_time": end_time,
        "category": category,
        "note": note,
        "duration_minutes": duration_minutes,
        "created_at": now,
        "updated_at": now,
    }
    result = day_activities_collection().insert_one(doc)
    return {k: v for k, v in {**doc, "id": str(result.inserted_id)}.items() if k not in ("user_id", "_id")}


def update_activity(user_id: str, activity_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    uid = _uid(user_id)
    try:
        oid = ObjectId(activity_id)
    except Exception:
        raise ValueError("Invalid activity id")
    existing = day_activities_collection().find_one({"_id": oid, "user_id": uid})
    if not existing:
        raise LookupError("Activity not found")
    title = (payload.get("title") or existing.get("title", "")).strip()
    start_time = (payload.get("start_time") if "start_time" in payload else existing.get("start_time", "")) or ""
    end_time = (payload.get("end_time") if "end_time" in payload else existing.get("end_time", "")) or ""
    category = (payload.get("category") or existing.get("category", "Study")).strip()
    note = ((payload.get("note") if "note" in payload else existing.get("note", "")) or "").strip()
    date = (payload.get("date") or existing.get("date", "")).strip()
    duration_minutes = _calc_duration(str(start_time).strip(), str(end_time).strip()) if start_time and end_time else 0
    update = {
        "title": title,
        "start_time": str(start_time).strip(),
        "end_time": str(end_time).strip(),
        "category": category,
        "note": note,
        "date": date,
        "duration_minutes": duration_minutes,
        "updated_at": _now(),
    }
    day_activities_collection().update_one({"_id": oid}, {"$set": update})
    return {**update, "id": activity_id}


def get_activities_summary(user_id: str, start_date: str, end_date: str) -> Dict[str, Any]:
    uid = _uid(user_id)
    today = datetime.now(timezone.utc).date().isoformat()
    end = (end_date or "").strip() or today
    start = (start_date or "").strip() or end
    if start > end:
        start, end = end, start
    docs = list(
        day_activities_collection()
        .find({"user_id": uid, "date": {"$gte": start, "$lte": end}}, {"user_id": 0})
        .sort([("date", ASCENDING), ("start_time", ASCENDING)])
    )
    daily: Dict[str, Dict[str, Any]] = {}
    by_category: Dict[str, int] = {}
    total_minutes = 0
    for doc in docs:
        doc["id"] = str(doc.pop("_id"))
        date = doc.get("date") or ""
        day = daily.setdefault(date, {"date": date, "total_minutes": 0, "by_category": {}, "activities": []})
        mins = int(doc.get("duration_minutes") or 0)
        cat = doc.get("category") or "Other"
        day["total_minutes"] += mins
        day["by_category"][cat] = day["by_category"].get(cat, 0) + mins
        day["activities"].append(doc)
        by_category[cat] = by_category.get(cat, 0) + mins
        total_minutes += mins
    breakdown = sorted(daily.values(), key=lambda d: d["date"])
    days_tracked = len(breakdown)
    return {
        "start_date": start,
        "end_date": end,
        "days_tracked": days_tracked,
        "total_minutes": total_minutes,
        "total_hours": round(total_minutes / 60, 2),
        "by_category": by_category,
        "average_per_day": round(total_minutes / days_tracked, 1) if days_tracked else 0,
        "daily_breakdown": breakdown,
    }


def delete_activity(user_id: str, activity_id: str) -> Dict[str, Any]:
    uid = _uid(user_id)
    try:
        oid = ObjectId(activity_id)
    except Exception:
        raise ValueError("Invalid activity id")
    result = day_activities_collection().delete_one({"_id": oid, "user_id": uid})
    return {"deleted": result.deleted_count > 0}
