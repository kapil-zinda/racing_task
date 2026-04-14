from datetime import datetime, timezone
import uuid
from typing import Any, Dict, List

from pymongo import ASCENDING

from .constants import PLAYERS
from .context import extras_collection
from .ledger_domain import log_activity
from .mission_domain import get_active_mission_id

_extras_indexes_ensured = False


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _doc_id(user_id: str) -> str:
    return f"extras:{user_id}"


def _ensure_indexes() -> None:
    global _extras_indexes_ensured
    if _extras_indexes_ensured:
        return
    coll = extras_collection()
    coll.create_index([("user_id", ASCENDING)], unique=True)
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


def get_extras_payload(user_id: str) -> Dict[str, Any]:
    uid = (user_id or "").strip().lower()
    if uid not in PLAYERS:
        raise ValueError("Invalid user_id")
    _ensure_indexes()
    doc = extras_collection().find_one({"_id": _doc_id(uid)})
    rows = [ _normalize_row(r) for r in (doc.get("rows", []) if isinstance(doc, dict) else []) ]
    return {"user_id": uid, "rows": rows}


def save_extras_payload(user_id: str, rows: List[Dict[str, Any]]) -> Dict[str, Any]:
    uid = (user_id or "").strip().lower()
    if uid not in PLAYERS:
        raise ValueError("Invalid user_id")
    _ensure_indexes()
    normalized_rows = [_normalize_row(r) for r in (rows or [])]
    total_minutes = sum(_duration_to_minutes(r.get("duration", "")) for r in normalized_rows)
    kind_counts: Dict[str, int] = {}
    for row in normalized_rows:
        kind = str(row.get("kind", "") or "").strip().lower() or "unknown"
        kind_counts[kind] = kind_counts.get(kind, 0) + 1
    extras_collection().update_one(
        {"_id": _doc_id(uid)},
        {
            "$set": {
                "user_id": uid,
                "rows": normalized_rows,
                "updated_at": _now(),
            },
            "$setOnInsert": {"created_at": _now()},
        },
        upsert=True,
    )
    mission_id = get_active_mission_id(uid)
    log_activity(
        uid,
        "extras_update",
        count=len(normalized_rows),
        duration_minutes=total_minutes,
        mission_id=mission_id,
        meta={"kind_counts": kind_counts},
    )
    return {"message": "Extras saved", "user_id": uid, "rows": normalized_rows}
