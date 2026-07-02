"""Universal Goal OS — node attachments (PDF/image/video/audio/links).

Files are stored in the same object storage as content (B2/S3) via a presigned PUT;
links are stored as metadata only. Attachment metadata lives in goal_attachments.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict

from bson import ObjectId

from .context import (
    goal_attachments_collection,
    goal_nodes_collection,
    goals_collection,
    sanitize_key_part,
    settings,
    storage_client,
)
from .goal_domain import _uid, ensure_goal_indexes

_ALLOWED_TYPES = {"pdf", "image", "video", "audio", "link", "file"}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _bucket() -> str:
    b = (settings().get("content_bucket") or "").strip()
    if not b:
        raise RuntimeError("CONTENT_BUCKET is not configured")
    return b


def _owned_node(user_id: str, node_id: str) -> Dict[str, Any]:
    n = goal_nodes_collection().find_one({"_id": ObjectId(node_id), "user_id": user_id})
    if not n:
        raise LookupError("Node not found")
    return n


def list_attachments(user_id: str, node_id: str) -> Dict[str, Any]:
    ensure_goal_indexes()
    uid = _uid(user_id)
    _owned_node(uid, node_id)
    rows = list(goal_attachments_collection().find({"node_id": node_id}).sort("created_at", -1))
    return {"attachments": [{
        "id": str(r["_id"]), "type": r.get("type"), "name": r.get("name"),
        "url": r.get("url"), "key": r.get("key"), "size": r.get("size", 0),
    } for r in rows]}


def presign_attachment(user_id: str, node_id: str, name: str, content_type: str = "") -> Dict[str, Any]:
    """Presign a PUT for uploading a file attachment to a node."""
    ensure_goal_indexes()
    uid = _uid(user_id)
    node = _owned_node(uid, node_id)
    safe = sanitize_key_part(name or "file")
    key = f"goal-attachments/{uid}/{node_id}/{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}_{safe}"
    url = storage_client().generate_presigned_url(
        "put_object", Params={"Bucket": _bucket(), "Key": key}, ExpiresIn=3600
    )
    return {"upload_url": url, "key": key, "bucket": _bucket(), "goal_id": node.get("goal_id")}


def create_attachment(user_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    """Record attachment metadata (after upload) or a link."""
    ensure_goal_indexes()
    uid = _uid(user_id)
    node_id = str(payload.get("node_id") or "").strip()
    if not node_id:
        raise ValueError("node_id is required")
    node = _owned_node(uid, node_id)
    a_type = str(payload.get("type") or "file").strip().lower()
    if a_type not in _ALLOWED_TYPES:
        a_type = "file"
    url = str(payload.get("url") or "").strip()
    key = str(payload.get("key") or "").strip()
    if a_type == "link" and not url:
        raise ValueError("url is required for a link attachment")
    if a_type != "link" and not key and not url:
        raise ValueError("key (uploaded object) or url is required")
    doc = {
        "goal_id": node.get("goal_id"), "node_id": node_id, "user_id": uid,
        "type": a_type, "name": str(payload.get("name") or "").strip() or "attachment",
        "url": url, "key": key, "size": int(payload.get("size") or 0), "created_at": _now(),
    }
    res = goal_attachments_collection().insert_one(doc)
    doc["id"] = str(res.inserted_id)
    doc.pop("_id", None)
    return doc


def delete_attachment(user_id: str, attachment_id: str) -> Dict[str, Any]:
    uid = _uid(user_id)
    res = goal_attachments_collection().delete_one({"_id": ObjectId(attachment_id), "user_id": uid})
    return {"deleted": res.deleted_count > 0}
