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
        "mongodb_pdf_docs_collection": os.getenv("MONGODB_PDF_DOCS_COLLECTION", "pdf_search_docs"),
        "mongodb_pdf_pages_collection": os.getenv("MONGODB_PDF_PAGES_COLLECTION", "pdf_search_pages"),
        "mongodb_content_folders_collection": os.getenv("MONGODB_CONTENT_FOLDERS_COLLECTION", "content_folders"),
        "mongodb_content_files_collection": os.getenv("MONGODB_CONTENT_FILES_COLLECTION", "content_files"),
        "mongodb_extras_collection": os.getenv("MONGODB_EXTRAS_COLLECTION", "home_extras"),
        "mongodb_qna_sessions_collection": os.getenv("MONGODB_QNA_SESSIONS_COLLECTION", "qna_sessions"),
        "mongodb_qna_messages_collection": os.getenv("MONGODB_QNA_MESSAGES_COLLECTION", "qna_messages"),
        "mongodb_missions_collection": os.getenv("MONGODB_MISSIONS_COLLECTION", "missions"),
        "mongodb_activity_ledger_collection": os.getenv("MONGODB_ACTIVITY_LEDGER_COLLECTION", "activity_ledger"),
        "mongodb_agent_v2_daily_aggregates_collection": os.getenv(
            "MONGODB_AGENT_V2_DAILY_AGGREGATES_COLLECTION",
            "agent_v2_daily_aggregates",
        ),
        "mongodb_agent_v2_sessions_collection": os.getenv("MONGODB_AGENT_V2_SESSIONS_COLLECTION", "agent_v2_sessions"),
        "mongodb_agent_v2_messages_collection": os.getenv("MONGODB_AGENT_V2_MESSAGES_COLLECTION", "agent_v2_messages"),
        "mongodb_agent_v2_memory_collection": os.getenv("MONGODB_AGENT_V2_MEMORY_COLLECTION", "agent_v2_memory"),
        "mongodb_agent_v2_nudges_collection": os.getenv("MONGODB_AGENT_V2_NUDGES_COLLECTION", "agent_v2_nudges"),
        "app_timezone": os.getenv("APP_TIMEZONE", "Asia/Kolkata"),
        "aws_region": os.getenv("AWS_REGION", "ap-south-1"),
        "recording_bucket": os.getenv("RECORDING_BUCKET", ""),
        "pdf_search_bucket": os.getenv("PDF_SEARCH_BUCKET", os.getenv("RECORDING_BUCKET", "")),
        "pdf_search_prefix": os.getenv("PDF_SEARCH_PREFIX", "pdf-search"),
        "content_bucket": os.getenv("CONTENT_BUCKET", os.getenv("RECORDING_BUCKET", "")),
        "content_prefix": os.getenv("CONTENT_PREFIX", "content"),
        "openai_api_key": os.getenv("OPENAI_API_KEY", ""),
        "openai_chat_model": os.getenv("OPENAI_CHAT_MODEL", "gpt-5.4"),
        "openai_realtime_model": os.getenv("OPENAI_REALTIME_MODEL", "gpt-realtime"),
        "openai_realtime_voice": os.getenv("OPENAI_REALTIME_VOICE", "marin"),
        "openai_transcription_model": os.getenv("OPENAI_TRANSCRIPTION_MODEL", "gpt-4o-mini-transcribe"),
        "openai_tts_model": os.getenv("OPENAI_TTS_MODEL", "gpt-4o-mini-tts"),
        "openai_tts_voice": os.getenv("OPENAI_TTS_VOICE", "alloy"),
        "openai_embeddings_model": os.getenv("OPENAI_EMBEDDINGS_MODEL", "text-embedding-3-large"),
        "openai_embeddings_dimensions": os.getenv("OPENAI_EMBEDDINGS_DIMENSIONS", "512"),
        "mongodb_pdf_vector_index_name": os.getenv("MONGODB_PDF_VECTOR_INDEX_NAME", "pdf_embedding_index"),
        "textract_enabled": os.getenv("TEXTRACT_ENABLED", "1"),
        "textract_poll_seconds": os.getenv("TEXTRACT_POLL_SECONDS", "2"),
        "textract_timeout_seconds": os.getenv("TEXTRACT_TIMEOUT_SECONDS", "900"),
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


def pdf_docs_collection():
    cfg = settings()
    return _mongo()[cfg["mongodb_db"]][cfg["mongodb_pdf_docs_collection"]]


def pdf_pages_collection():
    cfg = settings()
    return _mongo()[cfg["mongodb_db"]][cfg["mongodb_pdf_pages_collection"]]


def content_folders_collection():
    cfg = settings()
    return _mongo()[cfg["mongodb_db"]][cfg["mongodb_content_folders_collection"]]


def content_files_collection():
    cfg = settings()
    return _mongo()[cfg["mongodb_db"]][cfg["mongodb_content_files_collection"]]


def extras_collection():
    cfg = settings()
    return _mongo()[cfg["mongodb_db"]][cfg["mongodb_extras_collection"]]


def qna_sessions_collection():
    cfg = settings()
    return _mongo()[cfg["mongodb_db"]][cfg["mongodb_qna_sessions_collection"]]


def qna_messages_collection():
    cfg = settings()
    return _mongo()[cfg["mongodb_db"]][cfg["mongodb_qna_messages_collection"]]


def missions_collection():
    cfg = settings()
    return _mongo()[cfg["mongodb_db"]][cfg["mongodb_missions_collection"]]


def activity_ledger_collection():
    cfg = settings()
    return _mongo()[cfg["mongodb_db"]][cfg["mongodb_activity_ledger_collection"]]


def agent_v2_daily_aggregates_collection():
    cfg = settings()
    return _mongo()[cfg["mongodb_db"]][cfg["mongodb_agent_v2_daily_aggregates_collection"]]


def agent_v2_sessions_collection():
    cfg = settings()
    return _mongo()[cfg["mongodb_db"]][cfg["mongodb_agent_v2_sessions_collection"]]


def agent_v2_messages_collection():
    cfg = settings()
    return _mongo()[cfg["mongodb_db"]][cfg["mongodb_agent_v2_messages_collection"]]


def agent_v2_memory_collection():
    cfg = settings()
    return _mongo()[cfg["mongodb_db"]][cfg["mongodb_agent_v2_memory_collection"]]


def agent_v2_nudges_collection():
    cfg = settings()
    return _mongo()[cfg["mongodb_db"]][cfg["mongodb_agent_v2_nudges_collection"]]


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


def textract_client():
    cfg = settings()
    if boto3 is None:
        raise RuntimeError("boto3 is not installed")
    region = cfg["aws_region"]
    return boto3.client("textract", region_name=region)


def sanitize_key_part(value: str) -> str:
    return quote((value or "").strip().replace(" ", "_"), safe="_-")


def session_media_key(doc: Dict[str, Any], media_type: str, ext: str) -> str:
    date_part = sanitize_key_part(doc.get("date", current_date_str()))
    subject_part = sanitize_key_part(doc.get("subject", "general"))
    return f"study-sessions/{date_part}/{subject_part}/{doc.get('_id')}/{media_type}.{ext}"
