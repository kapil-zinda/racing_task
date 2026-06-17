import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List

from bson import ObjectId
from pymongo import DESCENDING

from .context import journeys_collection

_STRUCTURE_MAX_DEPTH = 6
_STRUCTURE_MAX_NODES = 500
_COUNTERS_MAX_PER_NODE = 20


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _uid(user_id: str) -> str:
    uid = (user_id or "").strip()
    if not uid:
        raise ValueError("Invalid user_id")
    return uid


def _normalize_counters(raw: Any) -> List[Dict[str, Any]]:
    if not isinstance(raw, list):
        return []
    result: List[Dict[str, Any]] = []
    seen: set = set()
    for item in raw:
        if len(result) >= _COUNTERS_MAX_PER_NODE:
            break
        if not isinstance(item, dict):
            continue
        key = str(item.get("key") or "").strip()
        if not key or key in seen:
            continue
        try:
            count = int(item.get("count", 0))
        except (TypeError, ValueError):
            count = 0
        seen.add(key)
        result.append({"key": key, "count": max(0, count)})
    return result


def _normalize_structure_nodes(nodes: Any, depth: int = 0, counter: List[int] | None = None) -> List[Dict[str, Any]]:
    if counter is None:
        counter = [0]
    result: List[Dict[str, Any]] = []
    if not isinstance(nodes, list) or depth >= _STRUCTURE_MAX_DEPTH:
        return result
    for node in nodes:
        if counter[0] >= _STRUCTURE_MAX_NODES:
            break
        if not isinstance(node, dict):
            continue
        label = str(node.get("label") or "").strip()
        if not label:
            continue
        counter[0] += 1
        node_id = str(node.get("id") or "").strip() or uuid.uuid4().hex
        children = _normalize_structure_nodes(node.get("children"), depth + 1, counter)
        counters = _normalize_counters(node.get("counters"))
        result.append({"id": node_id, "label": label, "children": children, "counters": counters})
    return result


def _normalize_plan(raw: Dict[str, Any] | None) -> Dict[str, Any]:
    source = raw if isinstance(raw, dict) else {}
    return {"structure": _normalize_structure_nodes(source.get("structure"))}


def list_journeys(user_id: str) -> List[Dict[str, Any]]:
    uid = _uid(user_id)
    docs = list(journeys_collection().find({"user_id": uid}).sort("created_at", DESCENDING))
    for doc in docs:
        doc["id"] = str(doc.pop("_id"))
        doc.pop("user_id", None)
    return docs


def create_journey(user_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    uid = _uid(user_id)
    title = (payload.get("title") or "").strip()
    if not title:
        raise ValueError("Title required")
    target_date = (payload.get("target_date") or "").strip()
    now = _now()
    doc = {
        "user_id": uid,
        "title": title,
        "target_date": target_date,
        "status": "active",
        "icon": "🎯",
        "category": "General",
        "plan": _normalize_plan(payload.get("plan")),
        "created_at": now,
        "updated_at": now,
    }
    result = journeys_collection().insert_one(doc)
    doc["id"] = str(result.inserted_id)
    doc.pop("_id", None)
    doc.pop("user_id", None)
    return doc


def update_journey(user_id: str, journey_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    uid = _uid(user_id)
    try:
        oid = ObjectId(journey_id)
    except Exception:
        raise ValueError("Invalid journey id")
    existing = journeys_collection().find_one({"_id": oid, "user_id": uid})
    if not existing:
        raise LookupError("Journey not found")

    update: Dict[str, Any] = {"updated_at": _now()}

    if "title" in payload:
        title = (payload.get("title") or "").strip()
        if not title:
            raise ValueError("Title required")
        update["title"] = title

    if "target_date" in payload:
        update["target_date"] = (payload.get("target_date") or "").strip()

    if "status" in payload:
        status = (payload.get("status") or "").strip().lower()
        if status not in {"active", "paused"}:
            raise ValueError("Invalid status")
        update["status"] = status

    if "plan" in payload:
        update["plan"] = _normalize_plan(payload.get("plan"))

    journeys_collection().update_one({"_id": oid}, {"$set": update})
    doc = journeys_collection().find_one({"_id": oid}) or {**existing, **update}
    doc["id"] = str(doc.pop("_id"))
    doc.pop("user_id", None)
    return doc


def delete_journey(user_id: str, journey_id: str) -> Dict[str, Any]:
    uid = _uid(user_id)
    try:
        oid = ObjectId(journey_id)
    except Exception:
        raise ValueError("Invalid journey id")
    result = journeys_collection().delete_one({"_id": oid, "user_id": uid})
    return {"deleted": result.deleted_count > 0}
