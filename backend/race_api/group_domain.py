from __future__ import annotations

import random
import string
from datetime import datetime, timezone
from typing import Any, Dict, List

from bson import ObjectId
from pymongo import ASCENDING

from .context import (
    current_date_str,
    live_study_sessions_collection,
    logger,
    study_group_id,
    study_group_members_collection,
    study_groups_collection,
    users_collection,
)

RECENT_WINDOW_SECONDS = 3600  # "stopped studying in the last hour" — off icon + clock

_ACTIVE_STATUSES = {"running", "paused"}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _uid(user_id: str) -> str:
    uid = (user_id or "").strip()
    if not uid:
        raise ValueError("Invalid user_id")
    return uid


def _ensure_indexes() -> None:
    study_groups_collection().create_index([("join_code", ASCENDING)], unique=True, background=True)
    study_group_members_collection().create_index(
        [("group_id", ASCENDING), ("user_id", ASCENDING)], unique=True, background=True
    )
    study_group_members_collection().create_index([("user_id", ASCENDING)], background=True)


def init_group_service() -> None:
    try:
        _ensure_indexes()
        logger.info("Study group indexes ensured")
    except Exception as exc:  # noqa: BLE001
        logger.warning("Study group index setup failed: %s", exc)


def _gen_join_code() -> str:
    alphabet = string.ascii_uppercase + string.digits
    return "".join(random.choice(alphabet) for _ in range(6))


def _user_name(user_id: str) -> str:
    try:
        user = users_collection().find_one({"_id": ObjectId(user_id)})
    except Exception:  # noqa: BLE001
        user = None
    return (user or {}).get("name") or "Member"


def create_group(user_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    uid = _uid(user_id)
    name = (payload.get("name") or "").strip()
    if not name:
        raise ValueError("Group name is required")

    join_code = _gen_join_code()
    for _ in range(5):
        if not study_groups_collection().find_one({"join_code": join_code}):
            break
        join_code = _gen_join_code()

    now = _now_iso()
    doc = {
        "_id": study_group_id(),
        "name": name,
        "description": (payload.get("description") or "").strip(),
        "category_focus": (payload.get("category_focus") or "").strip() or None,
        "owner_user_id": uid,
        "join_code": join_code,
        "is_public": bool(payload.get("is_public", True)),
        "member_count": 1,
        "created_at": now,
        "updated_at": now,
    }
    study_groups_collection().insert_one(doc)
    study_group_members_collection().insert_one(
        {"group_id": doc["_id"], "user_id": uid, "role": "owner", "joined_at": now}
    )
    logger.info("study group created id=%s owner=%s name=%r", doc["_id"], uid, name)
    return {"group": doc}


def search_groups(user_id: str, q: str = "", category: str = "", limit: int = 20, skip: int = 0) -> Dict[str, Any]:
    _uid(user_id)
    query: Dict[str, Any] = {"is_public": True}
    q = (q or "").strip()
    if q:
        query["name"] = {"$regex": q, "$options": "i"}
    category = (category or "").strip()
    if category:
        query["category_focus"] = category
    docs = list(
        study_groups_collection()
        .find(query)
        .sort("member_count", -1)
        .skip(max(0, int(skip)))
        .limit(max(1, min(100, int(limit))))
    )
    return {"groups": docs}


def list_my_groups(user_id: str) -> Dict[str, Any]:
    uid = _uid(user_id)
    memberships = list(study_group_members_collection().find({"user_id": uid}))
    group_ids = [m["group_id"] for m in memberships]
    if not group_ids:
        return {"groups": []}
    groups = list(study_groups_collection().find({"_id": {"$in": group_ids}}))
    return {"groups": groups}


def join_group(user_id: str, group_id: str, join_code: str = "") -> Dict[str, Any]:
    uid = _uid(user_id)
    group = study_groups_collection().find_one({"_id": group_id})
    if not group:
        raise LookupError("Group not found")
    if not group.get("is_public") and group.get("join_code") != (join_code or "").strip().upper():
        raise ValueError("Invalid join code for this private group")
    return _join(uid, group)


def join_group_by_code(user_id: str, join_code: str) -> Dict[str, Any]:
    uid = _uid(user_id)
    code = (join_code or "").strip().upper()
    if not code:
        raise ValueError("join_code is required")
    group = study_groups_collection().find_one({"join_code": code})
    if not group:
        raise LookupError("No group found for this code")
    return _join(uid, group)


def _join(uid: str, group: Dict[str, Any]) -> Dict[str, Any]:
    if study_group_members_collection().find_one({"group_id": group["_id"], "user_id": uid}):
        return {"group": group, "already_member": True}
    now = _now_iso()
    study_group_members_collection().insert_one(
        {"group_id": group["_id"], "user_id": uid, "role": "member", "joined_at": now}
    )
    study_groups_collection().update_one({"_id": group["_id"]}, {"$inc": {"member_count": 1}, "$set": {"updated_at": now}})
    updated = study_groups_collection().find_one({"_id": group["_id"]})
    logger.info("user=%s joined group=%s", uid, group["_id"])
    return {"group": updated}


def leave_group(user_id: str, group_id: str) -> Dict[str, Any]:
    uid = _uid(user_id)
    result = study_group_members_collection().delete_one({"group_id": group_id, "user_id": uid})
    if result.deleted_count:
        study_groups_collection().update_one(
            {"_id": group_id}, {"$inc": {"member_count": -1}, "$set": {"updated_at": _now_iso()}}
        )
    return {"left": result.deleted_count > 0}


def get_group(user_id: str, group_id: str) -> Dict[str, Any]:
    _uid(user_id)
    group = study_groups_collection().find_one({"_id": group_id})
    if not group:
        raise LookupError("Group not found")
    # Membership docs carry a Mongo ObjectId _id (unlike group docs' string ids),
    # which FastAPI can't JSON-encode — project it out.
    members = list(study_group_members_collection().find({"group_id": group_id}, {"_id": 0}))
    for m in members:
        m["name"] = _user_name(m["user_id"])
    return {"group": group, "members": members}


def get_group_live_status(user_id: str, group_id: str) -> Dict[str, Any]:
    """One row per group member (not just active ones): `status` is "active" (a
    session is running right now), "recent" (stopped/paused within the last hour
    — off icon + clock), or "off" (nothing recent). Sorted by today's tracked
    time, decreasing, so the busiest studiers surface first."""
    _uid(user_id)
    if not study_groups_collection().find_one({"_id": group_id}):
        raise LookupError("Group not found")
    members = list(study_group_members_collection().find({"group_id": group_id}))
    member_ids = [m["user_id"] for m in members]
    if not member_ids:
        return {"members": []}

    today = current_date_str()
    docs = live_study_sessions_collection().find(
        {"group_id": group_id, "user_id": {"$in": member_ids}, "date": today}
    )
    by_user: Dict[str, Dict[str, Any]] = {}
    for d in docs:
        uid = d["user_id"]
        agg = by_user.setdefault(uid, {"today_seconds": 0, "active": False, "last_at": "", "category": None})
        agg["today_seconds"] += max(0, int(d.get("elapsed_seconds", 0)))
        candidate_at = d.get("last_heartbeat") or d.get("stopped_at") or d.get("started_at") or ""
        if candidate_at and candidate_at > agg["last_at"]:
            agg["last_at"] = candidate_at
            agg["category"] = d.get("category")
        if d.get("status") == "running":
            agg["active"] = True

    now_ts = datetime.now(timezone.utc).timestamp()
    rows: List[Dict[str, Any]] = []
    for m in members:
        uid = m["user_id"]
        agg = by_user.get(uid, {"today_seconds": 0, "active": False, "last_at": "", "category": None})
        if agg["active"]:
            status = "active"
        elif agg["last_at"]:
            try:
                last_ts = datetime.fromisoformat(agg["last_at"]).timestamp()
            except Exception:  # noqa: BLE001
                last_ts = 0
            status = "recent" if (now_ts - last_ts) <= RECENT_WINDOW_SECONDS else "off"
        else:
            status = "off"
        rows.append(
            {
                "user_id": uid,
                "name": _user_name(uid),
                "category": agg["category"],
                "status": status,
                "today_seconds": agg["today_seconds"],
                "last_active_at": agg["last_at"] or None,
            }
        )
    rows.sort(key=lambda r: r["today_seconds"], reverse=True)
    return {"members": rows}
