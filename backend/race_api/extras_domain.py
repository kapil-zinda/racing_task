from __future__ import annotations

from datetime import datetime, timezone
import uuid
from typing import Any, Dict, List

from pymongo import ASCENDING

from .constants import PLAYERS
from .context import current_date_str, extra_categories_collection, extras_collection
from .ledger_domain import log_activity
from .mission_domain import get_active_mission_id

_extras_indexes_ensured = False

_DEFAULT_EXTRA_CATEGORIES = [
    {"name": "Time waste", "color": "#94A3B8"},
    {"name": "Danger", "color": "#F43F5E"},
    {"name": "Necessary", "color": "#0EA5E9"},
    {"name": "Coursework", "color": "#10B981"},
    {"name": "Random", "color": "#8B5CF6"},
    {"name": "Sleep", "color": "#4338CA"},
]


def get_extra_categories(user_id: str) -> List[Dict[str, Any]]:
    uid = (user_id or "").strip()
    if not uid:
        raise ValueError("Invalid user_id")
    cats = list(extra_categories_collection().find({"user_id": uid}, {"_id": 0, "user_id": 0}))
    if not cats:
        now = _now()
        extra_categories_collection().insert_many(
            [{"user_id": uid, "name": c["name"], "color": c["color"], "created_at": now} for c in _DEFAULT_EXTRA_CATEGORIES]
        )
        return [{"name": c["name"], "color": c["color"]} for c in _DEFAULT_EXTRA_CATEGORIES]
    return [{"name": c["name"], "color": c.get("color", "#94A3B8")} for c in cats]


def create_extra_category(user_id: str, name: str, color: str) -> Dict[str, Any]:
    uid = (user_id or "").strip()
    if not uid:
        raise ValueError("Invalid user_id")
    name = (name or "").strip()
    if not name:
        raise ValueError("Category name required")
    color = (color or "#94A3B8").strip()
    if extra_categories_collection().find_one({"user_id": uid, "name": name}):
        raise ValueError(f"Category '{name}' already exists")
    extra_categories_collection().insert_one({"user_id": uid, "name": name, "color": color, "created_at": _now()})
    return {"name": name, "color": color}


def delete_extra_category(user_id: str, name: str) -> Dict[str, Any]:
    uid = (user_id or "").strip()
    if not uid:
        raise ValueError("Invalid user_id")
    result = extra_categories_collection().delete_one({"user_id": uid, "name": (name or "").strip()})
    return {"deleted": result.deleted_count > 0}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _normalize_date(value: str | None) -> str:
    raw = str(value or "").strip()
    if len(raw) >= 10:
        return raw[:10]
    return current_date_str()


def _doc_id(user_id: str, date_value: str) -> str:
    return f"extras:{user_id}:{date_value}"


def _legacy_doc_id(user_id: str) -> str:
    return f"extras:{user_id}"


def _ensure_indexes() -> None:
    global _extras_indexes_ensured
    if _extras_indexes_ensured:
        return
    coll = extras_collection()
    try:
        coll.drop_index("user_id_1")
    except Exception:  # noqa: BLE001
        pass
    coll.create_index([("user_id", ASCENDING), ("date", ASCENDING)], unique=True, name="user_date_unique_idx")
    coll.create_index([("user_id", ASCENDING), ("updated_at", ASCENDING)])
    _extras_indexes_ensured = True


def _normalize_row(row: Any) -> Dict[str, str]:
    if not isinstance(row, dict):
        row = {}
    rid = str(row.get("id") or f"extra:{uuid.uuid4().hex}").strip()
    title = str(row.get("title") or "").strip()
    link = str(row.get("link") or "").strip()
    kind = str(row.get("kind") or "").strip()
    duration = str(row.get("duration") or "").strip()
    return {
        "id": rid,
        "title": title,
        "link": link,
        "kind": kind,
        "duration": duration,
    }


def _duration_to_minutes(raw: str) -> int:
    value = str(raw or "").strip().lower()
    if not value:
        return 0
    if value.isdigit():
        return max(0, int(value))
    if ":" in value:
        parts = [p.strip() for p in value.split(":")]
        if len(parts) == 2 and all(p.isdigit() for p in parts):
            return max(0, int(parts[0]) * 60 + int(parts[1]))
        if len(parts) == 3 and all(p.isdigit() for p in parts):
            return max(0, int(parts[0]) * 60 + int(parts[1]) + (1 if int(parts[2]) > 0 else 0))
    minutes = 0
    num = ""
    for ch in value:
        if ch.isdigit():
            num += ch
            continue
        if ch == "h" and num:
            minutes += int(num) * 60
            num = ""
        elif ch == "m" and num:
            minutes += int(num)
            num = ""
        elif ch in {" ", ","}:
            continue
        else:
            num = ""
    return max(0, minutes)


def get_extras_payload(user_id: str, date_value: str | None = None) -> Dict[str, Any]:
    uid = (user_id or "").strip()
    if not uid:
        raise ValueError("Invalid user_id")
    day = _normalize_date(date_value)
    _ensure_indexes()
    doc = extras_collection().find_one({"_id": _doc_id(uid, day)})
    if not doc and day == current_date_str():
        doc = extras_collection().find_one({"_id": _legacy_doc_id(uid)})
    rows = [ _normalize_row(r) for r in (doc.get("rows", []) if isinstance(doc, dict) else []) ]
    return {"user_id": uid, "date": day, "rows": rows}


def save_extras_payload(user_id: str, rows: List[Dict[str, Any]], date_value: str | None = None) -> Dict[str, Any]:
    uid = (user_id or "").strip()
    if not uid:
        raise ValueError("Invalid user_id")
    day = _normalize_date(date_value)
    _ensure_indexes()
    normalized_rows = [_normalize_row(r) for r in (rows or [])]
    total_minutes = sum(_duration_to_minutes(r.get("duration", "")) for r in normalized_rows)
    kind_counts: Dict[str, int] = {}
    for row in normalized_rows:
        kind = str(row.get("kind", "") or "").strip().lower() or "unknown"
        kind_counts[kind] = kind_counts.get(kind, 0) + 1
    extras_collection().update_one(
        {"_id": _doc_id(uid, day)},
        {
            "$set": {
                "user_id": uid,
                "date": day,
                "rows": normalized_rows,
                "updated_at": _now(),
            },
            "$setOnInsert": {"created_at": _now()},
        },
        upsert=True,
    )
    if day == current_date_str():
        mission_id = get_active_mission_id(uid)
        log_activity(
            uid,
            "extras_update",
            count=len(normalized_rows),
            duration_minutes=total_minutes,
            mission_id=mission_id,
            meta={"kind_counts": kind_counts},
        )
    return {"message": "Extras saved", "user_id": uid, "date": day, "rows": normalized_rows}
