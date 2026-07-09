import json
import os
from datetime import datetime, timezone
from typing import Any, Dict, List

import boto3
from bson import ObjectId

from db import (
    current_date_str,
    live_study_sessions_collection,
    study_group_members_collection,
    users_collection,
    websocket_connections_collection,
)

_ACTIVE_STATUSES = ["running", "paused"]
RECENT_WINDOW_SECONDS = 3600  # mirrors race_api/group_domain.py's classification


def _user_name(user_id: str) -> str:
    try:
        user = users_collection().find_one({"_id": ObjectId(user_id)})
    except Exception:  # noqa: BLE001
        user = None
    return (user or {}).get("name") or "Member"


def _management_client():
    endpoint = os.environ.get("WEBSOCKET_API_ENDPOINT", "")
    if not endpoint:
        raise RuntimeError("WEBSOCKET_API_ENDPOINT is not configured (https://{api-id}.execute-api.{region}.amazonaws.com/{stage})")
    return boto3.client("apigatewaymanagementapi", endpoint_url=endpoint)


def _group_member_rows(group_id: str, member_ids: List[str]) -> List[Dict[str, Any]]:
    """Mirrors race_api/group_domain.py's get_group_live_status: one row per
    member (not just active ones), status active/recent/off, sorted by today's
    tracked seconds — kept in lockstep so the REST poll and the websocket push
    always agree on shape."""
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
    for uid in member_ids:
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
    return rows


def run_broadcast_tick() -> Dict[str, Any]:
    """Invoked every minute by an EventBridge rule. Pushes each group's current
    live-status payload to every connected member of that group. Complements
    (does not replace) the REST GET /groups/{id}/live-status poll — this is
    the near-real-time layer on top of it."""
    active_docs = list(
        live_study_sessions_collection().find(
            {"status": {"$in": _ACTIVE_STATUSES}, "group_id": {"$ne": None}},
            {"group_id": 1},
        )
    )
    if not active_docs:
        return {"groups_notified": 0, "pushes": 0, "stale_cleaned": 0}

    group_ids = sorted({d["group_id"] for d in active_docs})
    client = _management_client()
    pushes = 0
    stale_connections: List[str] = []

    for group_id in group_ids:
        member_ids = [
            m["user_id"] for m in study_group_members_collection().find({"group_id": group_id}, {"user_id": 1})
        ]
        if not member_ids:
            continue

        payload = {
            "type": "group_live_status",
            "group_id": group_id,
            "members": _group_member_rows(group_id, member_ids),
        }
        data = json.dumps(payload).encode("utf-8")

        for conn in websocket_connections_collection().find({"user_id": {"$in": member_ids}}):
            try:
                client.post_to_connection(ConnectionId=conn["_id"], Data=data)
                pushes += 1
            except client.exceptions.GoneException:
                stale_connections.append(conn["_id"])
            except Exception:  # noqa: BLE001
                pass  # best-effort push; one bad connection shouldn't fail the tick

    if stale_connections:
        websocket_connections_collection().delete_many({"_id": {"$in": stale_connections}})

    return {"groups_notified": len(group_ids), "pushes": pushes, "stale_cleaned": len(stale_connections)}
