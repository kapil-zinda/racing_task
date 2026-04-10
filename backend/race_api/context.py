import logging
import os
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Dict
from urllib.parse import quote
from zoneinfo import ZoneInfo

from dotenv import load_dotenv
from pymongo import MongoClient

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(dotenv_path=BASE_DIR / ".env", override=True)

try:
    import boto3
except ImportError:  # pragma: no cover - runtime packaging concern
    boto3 = None

_mongo_client = None
logger = logging.getLogger("race-api")


def session_id() -> str:
    return f"session:{uuid.uuid4().hex}"


def settings() -> Dict[str, Any]:
    return {
        "race_doc_id": os.getenv("RACE_DOC_ID", "kapil_divya_race"),
        "mongodb_uri": os.getenv("MONGODB_URI", ""),
        "mongodb_db": os.getenv("MONGODB_DB", "racing_challenge"),
        "mongodb_collection": os.getenv("MONGODB_COLLECTION", "race_state"),
        "mongodb_events_collection": os.getenv("MONGODB_EVENTS_COLLECTION", "race_events"),
        "mongodb_sessions_collection": os.getenv("MONGODB_SESSIONS_COLLECTION", "study_sessions"),
        "app_timezone": os.getenv("APP_TIMEZONE", "Asia/Kolkata"),
        "aws_region": os.getenv("AWS_REGION", "ap-south-1"),
        "recording_bucket": os.getenv("RECORDING_BUCKET", ""),
    }


def current_date_str() -> str:
    tz = ZoneInfo(settings()["app_timezone"])
    return datetime.now(tz).date().isoformat()


def day_doc_id(date_str: str) -> str:
    return f"{settings()['race_doc_id']}:{date_str}"


def _mongo() -> MongoClient:
    global _mongo_client
    mongodb_uri = settings()["mongodb_uri"]
    if not mongodb_uri:
        raise RuntimeError("MONGODB_URI is not configured")
    if _mongo_client is None:
        _mongo_client = MongoClient(mongodb_uri, serverSelectionTimeoutMS=5000)
    return _mongo_client


def race_collection():
    cfg = settings()
    return _mongo()[cfg["mongodb_db"]][cfg["mongodb_collection"]]


def sessions_collection():
    cfg = settings()
    return _mongo()[cfg["mongodb_db"]][cfg["mongodb_sessions_collection"]]


def events_collection():
    cfg = settings()
    return _mongo()[cfg["mongodb_db"]][cfg["mongodb_events_collection"]]


def s3_client():
    cfg = settings()
    if boto3 is None:
        raise RuntimeError("boto3 is not installed")
    region = cfg["aws_region"]
    return boto3.client(
        "s3",
        region_name=region,
        endpoint_url=f"https://s3.{region}.amazonaws.com",
    )


def sanitize_key_part(value: str) -> str:
    return quote((value or "").strip().replace(" ", "_"), safe="_-")


def session_media_key(doc: Dict[str, Any], media_type: str, ext: str) -> str:
    date_part = sanitize_key_part(doc.get("date", current_date_str()))
    subject_part = sanitize_key_part(doc.get("subject", "general"))
    return f"study-sessions/{date_part}/{subject_part}/{doc.get('_id')}/{media_type}.{ext}"
