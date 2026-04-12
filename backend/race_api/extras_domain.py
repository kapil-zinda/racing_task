from datetime import datetime, timezone
import uuid
from typing import Any, Dict, List

from pymongo import ASCENDING

from .constants import PLAYERS
from .context import extras_collection

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
    return {"message": "Extras saved", "user_id": uid, "rows": normalized_rows}

