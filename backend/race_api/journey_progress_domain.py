from datetime import datetime, timezone
from typing import Any, Dict

from bson import ObjectId

from .context import journey_progress_collection, journeys_collection

_MAX_HISTORY = 5000


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _uid(user_id: str) -> str:
    uid = (user_id or "").strip()
    if not uid:
        raise ValueError("Invalid user_id")
    return uid


def _oid(journey_id: str) -> ObjectId:
    try:
        return ObjectId(journey_id)
    except Exception:
        raise ValueError("Invalid journey id")


def _assert_owns_journey(uid: str, journey_id: str) -> ObjectId:
    oid = _oid(journey_id)
    if not journeys_collection().find_one({"_id": oid, "user_id": uid}):
        raise LookupError("Journey not found")
    return oid


def _public(doc: Dict[str, Any] | None) -> Dict[str, Any]:
    if not doc:
        return {"completions": [], "history": []}
    return {
        "completions": doc.get("completions") or [],
        "history": doc.get("history") or [],
    }


def get_journey_progress(user_id: str, journey_id: str) -> Dict[str, Any]:
    uid = _uid(user_id)
    _assert_owns_journey(uid, journey_id)
    doc = journey_progress_collection().find_one({"user_id": uid, "journey_id": journey_id})
    return _public(doc)


def record_progress_action(user_id: str, journey_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    uid = _uid(user_id)
    _assert_owns_journey(uid, journey_id)

    node_id = str(payload.get("node_id") or "").strip()
    if not node_id:
        raise ValueError("node_id required")
    counter_key = str(payload.get("counter_key") or "").strip()
    if not counter_key:
        raise ValueError("counter_key required")
    try:
        occurrence = int(payload.get("occurrence"))
    except (TypeError, ValueError):
        raise ValueError("Invalid occurrence")
    if occurrence < 1:
        raise ValueError("Invalid occurrence")
    action = str(payload.get("action") or "").strip().lower()
    if action not in {"done", "undo"}:
        raise ValueError("Invalid action")
    node_label = str(payload.get("node_label") or "").strip()

    now = _now()
    coll = journey_progress_collection()
    key = {"user_id": uid, "journey_id": journey_id}

    coll.update_one(
        key,
        {"$setOnInsert": {**key, "completions": [], "history": [], "created_at": now}},
        upsert=True,
    )

    # Always remove any existing completion record for this occurrence first (keeps it idempotent).
    coll.update_one(
        key,
        {
            "$pull": {
                "completions": {
                    "node_id": node_id,
                    "counter_key": counter_key,
                    "occurrence": occurrence,
                }
            }
        },
    )

    update: Dict[str, Any] = {"$set": {"updated_at": now}}
    if action == "done":
        update["$push"] = {
            "completions": {
                "node_id": node_id,
                "counter_key": counter_key,
                "occurrence": occurrence,
                "updated_at": now,
            },
            "history": {
                "$each": [
                    {
                        "node_id": node_id,
                        "node_label": node_label,
                        "counter_key": counter_key,
                        "occurrence": occurrence,
                        "action": "done",
                        "timestamp": now,
                    }
                ],
                "$slice": -_MAX_HISTORY,
            },
        }
    else:
        update["$push"] = {
            "history": {
                "$each": [
                    {
                        "node_id": node_id,
                        "node_label": node_label,
                        "counter_key": counter_key,
                        "occurrence": occurrence,
                        "action": "undo",
                        "timestamp": now,
                    }
                ],
                "$slice": -_MAX_HISTORY,
            }
        }

    coll.update_one(key, update)
    return _public(coll.find_one(key))
