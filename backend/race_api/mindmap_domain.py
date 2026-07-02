from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from bson import ObjectId
from pymongo import DESCENDING

from .context import mindmaps_collection


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _uid(user_id: str) -> str:
    uid = (user_id or "").strip()
    if not uid:
        raise ValueError("Invalid user_id")
    return uid


def _oid(map_id: str) -> ObjectId:
    try:
        return ObjectId(map_id)
    except Exception:
        raise ValueError("Invalid mind map id")


def _summary(doc: Dict[str, Any]) -> Dict[str, Any]:
    markdown = str(doc.get("markdown") or "")
    outline_items = doc.get("outlineItems")
    return {
        "id": str(doc["_id"]),
        "title": doc.get("title") or "Untitled Mind Map",
        "updatedAt": doc.get("updatedAt") or doc.get("createdAt") or "",
        "createdAt": doc.get("createdAt") or "",
        "itemCount": len(outline_items) if isinstance(outline_items, list) else 0,
        "preview": " ".join(markdown.split())[:140],
    }


def _full(doc: Dict[str, Any]) -> Dict[str, Any]:
    out = _summary(doc)
    out.update(
        {
            "markdown": doc.get("markdown") or "",
            "outlineItems": doc.get("outlineItems") or [],
            "tree": doc.get("tree"),
        }
    )
    return out


def _build_document(payload: Dict[str, Any], is_update: bool = False) -> Dict[str, Any]:
    title = str(payload.get("title") or "Untitled Mind Map").strip() or "Untitled Mind Map"
    outline_items = payload.get("outlineItems")
    tree = payload.get("tree")
    document: Dict[str, Any] = {
        "title": title[:160],
        "markdown": str(payload.get("markdown") or "").strip(),
        "outlineItems": outline_items if isinstance(outline_items, list) else [],
        "tree": tree if isinstance(tree, dict) else None,
        "updatedAt": _now(),
    }
    if not is_update:
        document["createdAt"] = document["updatedAt"]
    return document


def list_mindmaps(user_id: str, limit: int = 5, offset: int = 0) -> Dict[str, Any]:
    uid = _uid(user_id)
    limit = max(1, min(int(limit or 5), 50))
    offset = max(0, int(offset or 0))
    collection = mindmaps_collection()
    total = collection.count_documents({"user_id": uid})
    docs = (
        collection.find(
            {"user_id": uid},
            {"title": 1, "updatedAt": 1, "createdAt": 1, "markdown": 1, "outlineItems": 1},
        )
        .sort("updatedAt", DESCENDING)
        .skip(offset)
        .limit(limit)
    )
    maps = [_summary(doc) for doc in docs]
    next_offset = offset + len(maps)
    return {
        "maps": maps,
        "offset": offset,
        "limit": limit,
        "nextOffset": next_offset,
        "hasMore": next_offset < total,
        "total": total,
    }


def get_mindmap(user_id: str, map_id: str) -> Dict[str, Any]:
    uid = _uid(user_id)
    doc = mindmaps_collection().find_one({"_id": _oid(map_id), "user_id": uid})
    if not doc:
        raise LookupError("Mind map not found")
    return {"map": _full(doc)}


def create_mindmap(user_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    uid = _uid(user_id)
    document = _build_document(payload)
    document["user_id"] = uid
    result = mindmaps_collection().insert_one(document)
    created = mindmaps_collection().find_one({"_id": result.inserted_id})
    return {"map": _full(created)}


def update_mindmap(user_id: str, map_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    uid = _uid(user_id)
    oid = _oid(map_id)
    document = _build_document(payload, is_update=True)
    result = mindmaps_collection().update_one({"_id": oid, "user_id": uid}, {"$set": document})
    if result.matched_count == 0:
        raise LookupError("Mind map not found")
    updated = mindmaps_collection().find_one({"_id": oid})
    return {"map": _full(updated)}


def delete_mindmap(user_id: str, map_id: str) -> Dict[str, Any]:
    uid = _uid(user_id)
    result = mindmaps_collection().delete_one({"_id": _oid(map_id), "user_id": uid})
    return {"deleted": result.deleted_count > 0}
