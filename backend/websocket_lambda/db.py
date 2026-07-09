"""Standalone Mongo access for the websocket Lambda.

Deliberately independent from race_api/context.py: this function is deployed
separately (own zip, own Lambda) and only needs pymongo, not the whole
fastapi/mangum stack, so cold starts stay fast. Mirrors the same
lazy-singleton-client + env-driven-collection-name pattern as race_api/context.py."""

import os
from datetime import datetime
from typing import Any, Dict
from zoneinfo import ZoneInfo

from pymongo import MongoClient

_mongo_client = None


def _settings() -> Dict[str, Any]:
    return {
        "mongodb_uri": os.getenv("MONGODB_URI", ""),
        "mongodb_db": os.getenv("MONGODB_DB", "racing_challenge"),
        "websocket_connections_collection": os.getenv(
            "MONGODB_WEBSOCKET_CONNECTIONS_COLLECTION", "websocket_connections"
        ),
        "live_study_sessions_collection": os.getenv(
            "MONGODB_LIVE_STUDY_SESSIONS_COLLECTION", "live_study_sessions"
        ),
        "study_groups_collection": os.getenv("MONGODB_STUDY_GROUPS_COLLECTION", "study_groups"),
        "study_group_members_collection": os.getenv(
            "MONGODB_STUDY_GROUP_MEMBERS_COLLECTION", "study_group_members"
        ),
        "users_collection": os.getenv("MONGODB_USERS_COLLECTION", "users"),
        "app_timezone": os.getenv("APP_TIMEZONE", "Asia/Kolkata"),
    }


def current_date_str() -> str:
    """Mirrors race_api/context.py's current_date_str() — kept independent since
    this Lambda has no dependency on the race_api package."""
    tz = ZoneInfo(_settings()["app_timezone"])
    return datetime.now(tz).date().isoformat()


def _mongo() -> MongoClient:
    global _mongo_client
    cfg = _settings()
    if not cfg["mongodb_uri"]:
        raise RuntimeError("MONGODB_URI is not configured")
    if _mongo_client is None:
        _mongo_client = MongoClient(cfg["mongodb_uri"], serverSelectionTimeoutMS=5000)
    return _mongo_client


def _col(name_key: str):
    cfg = _settings()
    return _mongo()[cfg["mongodb_db"]][cfg[name_key]]


def websocket_connections_collection():
    return _col("websocket_connections_collection")


def live_study_sessions_collection():
    return _col("live_study_sessions_collection")


def study_groups_collection():
    return _col("study_groups_collection")


def study_group_members_collection():
    return _col("study_group_members_collection")


def users_collection():
    return _col("users_collection")
