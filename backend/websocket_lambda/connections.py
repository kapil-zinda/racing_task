from datetime import datetime, timezone
from typing import Any, Dict

from auth import resolve_user_id
from db import websocket_connections_collection


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def handle_connect(event: Dict[str, Any]) -> Dict[str, Any]:
    connection_id = event["requestContext"]["connectionId"]
    query = event.get("queryStringParameters") or {}
    user_id = resolve_user_id(query.get("api_key", ""))
    if not user_id:
        return {"statusCode": 401, "body": "Unauthorized: invalid or missing api_key"}

    now = _now_iso()
    websocket_connections_collection().update_one(
        {"_id": connection_id},
        {"$set": {"user_id": user_id, "connected_at": now, "last_seen": now}},
        upsert=True,
    )
    return {"statusCode": 200, "body": "Connected"}


def handle_disconnect(event: Dict[str, Any]) -> Dict[str, Any]:
    connection_id = event["requestContext"]["connectionId"]
    websocket_connections_collection().delete_one({"_id": connection_id})
    return {"statusCode": 200, "body": "Disconnected"}


def handle_default(event: Dict[str, Any]) -> Dict[str, Any]:
    """Handles any client->server message on the open socket. v1 only needs a
    keepalive (bump last_seen); the per-minute broadcast tick is the primary
    data-push mechanism, not client-sent messages."""
    connection_id = event["requestContext"]["connectionId"]
    websocket_connections_collection().update_one(
        {"_id": connection_id}, {"$set": {"last_seen": _now_iso()}}
    )
    return {"statusCode": 200, "body": "ok"}
