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

# Configure the app logger once. Honour LOG_LEVEL (default INFO). Use our own
# handler + format and disable propagation so logs appear locally and in
# CloudWatch (Lambda) without duplicating through the root handler.
_log_level = (os.environ.get("LOG_LEVEL", "INFO") or "INFO").upper()
logger.setLevel(getattr(logging, _log_level, logging.INFO))
if not logger.handlers:
    _handler = logging.StreamHandler()
    _handler.setFormatter(
        logging.Formatter("%(asctime)s %(levelname)s [race-api] %(message)s", "%Y-%m-%d %H:%M:%S")
    )
    logger.addHandler(_handler)
    logger.propagate = False


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
        "mongodb_interview_sessions_collection": os.getenv("MONGODB_INTERVIEW_SESSIONS_COLLECTION", "interview_sessions"),
        "mongodb_answer_evaluations_collection": os.getenv("MONGODB_ANSWER_EVALUATIONS_COLLECTION", "answer_evaluations"),
        "mongodb_user_usage_collection": os.getenv("MONGODB_USER_USAGE_COLLECTION", "user_usage"),
        "app_timezone": os.getenv("APP_TIMEZONE", "Asia/Kolkata"),
        "aws_region": os.getenv("AWS_REGION", "ap-south-1"),
        "recording_bucket": os.getenv("RECORDING_BUCKET", ""),
        "pdf_search_bucket": os.getenv("PDF_SEARCH_BUCKET", os.getenv("RECORDING_BUCKET", "")),
        "pdf_search_prefix": os.getenv("PDF_SEARCH_PREFIX", "pdf-search"),
        "content_bucket": os.getenv("CONTENT_BUCKET", os.getenv("RECORDING_BUCKET", "")),
        "content_prefix": os.getenv("CONTENT_PREFIX", "content"),
        # Backblaze B2 (S3-compatible) for recordings + content. When set, these
        # buckets live on B2; PDF-search / answer-eval OCR stay on AWS S3 (Textract).
        "b2_endpoint": os.getenv("B2_ENDPOINT", ""),          # e.g. https://s3.us-west-004.backblazeb2.com
        "b2_region": os.getenv("B2_REGION", "us-west-004"),
        "b2_key_id": os.getenv("B2_KEY_ID", ""),
        "b2_application_key": os.getenv("B2_APPLICATION_KEY", ""),
        "openai_api_key": os.getenv("OPENAI_API_KEY", ""),
        "openai_chat_model": os.getenv("OPENAI_CHAT_MODEL", "gpt-5.4"),
        "openai_realtime_model": os.getenv("OPENAI_REALTIME_MODEL", "gpt-realtime"),
        "openai_realtime_voice": os.getenv("OPENAI_REALTIME_VOICE", "marin"),
        "openai_transcription_model": os.getenv("OPENAI_TRANSCRIPTION_MODEL", "gpt-4o-mini-transcribe"),
        "openai_tts_model": os.getenv("OPENAI_TTS_MODEL", "gpt-4o-mini-tts"),
        "openai_tts_voice": os.getenv("OPENAI_TTS_VOICE", "alloy"),
        "openai_embeddings_model": os.getenv("OPENAI_EMBEDDINGS_MODEL", "text-embedding-3-large"),
        "openai_embeddings_dimensions": os.getenv("OPENAI_EMBEDDINGS_DIMENSIONS", "1536"),
        "mongodb_pdf_vector_index_name": os.getenv("MONGODB_PDF_VECTOR_INDEX_NAME", "pdf_embedding_index"),
        # Upstash Vector (REST) — replaces MongoDB Atlas vector search for PDF search.
        # The Upstash index must be created with dimensions == openai_embeddings_dimensions.
        "upstash_vector_rest_url": os.getenv("UPSTASH_VECTOR_REST_URL", ""),
        "upstash_vector_rest_token": os.getenv("UPSTASH_VECTOR_REST_TOKEN", ""),
        "answer_eval_s3_trigger": os.getenv("ANSWER_EVAL_S3_TRIGGER", "false").lower() == "true",
        "user_storage_limit_gb": os.getenv("USER_STORAGE_LIMIT_GB", "10"),
        "textract_enabled": os.getenv("TEXTRACT_ENABLED", "1"),
        "textract_poll_seconds": os.getenv("TEXTRACT_POLL_SECONDS", "2"),
        "textract_timeout_seconds": os.getenv("TEXTRACT_TIMEOUT_SECONDS", "900"),
        "mongodb_users_collection": os.getenv("MONGODB_USERS_COLLECTION", "users"),
        "mongodb_otps_collection": os.getenv("MONGODB_OTPS_COLLECTION", "otps"),
        "auth_required": os.getenv("AUTH_REQUIRED", "false").lower() == "true",
        "resend_api_key": os.getenv("RESEND_API_KEY", ""),
        "mongodb_day_activities_collection": os.getenv("MONGODB_DAY_ACTIVITIES_COLLECTION", "day_activities"),
        "mongodb_activity_categories_collection": os.getenv("MONGODB_ACTIVITY_CATEGORIES_COLLECTION", "activity_categories"),
        "mongodb_mindmaps_collection": os.getenv("MONGODB_MINDMAPS_COLLECTION", "mindmaps"),
        # Universal Goal OS — generic, metadata-driven collections (replaces journeys).
        "mongodb_goals_collection": os.getenv("MONGODB_GOALS_COLLECTION", "goals"),
        "mongodb_goal_nodes_collection": os.getenv("MONGODB_GOAL_NODES_COLLECTION", "goal_nodes"),
        "mongodb_goal_metrics_collection": os.getenv("MONGODB_GOAL_METRICS_COLLECTION", "goal_metrics"),
        "mongodb_goal_activity_collection": os.getenv("MONGODB_GOAL_ACTIVITY_COLLECTION", "goal_activity"),
        "mongodb_goal_attachments_collection": os.getenv("MONGODB_GOAL_ATTACHMENTS_COLLECTION", "goal_attachments"),
        "mongodb_goal_dependencies_collection": os.getenv("MONGODB_GOAL_DEPENDENCIES_COLLECTION", "goal_dependencies"),
        "mongodb_goal_recurring_collection": os.getenv("MONGODB_GOAL_RECURRING_COLLECTION", "goal_recurring_rules"),
        "mongodb_goal_reminders_collection": os.getenv("MONGODB_GOAL_REMINDERS_COLLECTION", "goal_reminders"),
        "mongodb_goal_templates_collection": os.getenv("MONGODB_GOAL_TEMPLATES_COLLECTION", "goal_templates"),
        "mongodb_payments_collection": os.getenv("MONGODB_PAYMENTS_COLLECTION", "payments"),
        "mongodb_credit_ledger_collection": os.getenv("MONGODB_CREDIT_LEDGER_COLLECTION", "credit_ledger"),
        # Razorpay Standard Checkout. KEY_ID is safe to expose to the frontend;
        # KEY_SECRET must stay server-side (used for order creation + signature verify).
        "razorpay_key_id": os.getenv("RAZORPAY_KEY_ID", ""),
        "razorpay_key_secret": os.getenv("RAZORPAY_KEY_SECRET", ""),
        # --- Billing / credits (all money is USD on the surface; Razorpay charges INR) ---
        "usd_to_inr": float(os.getenv("USD_TO_INR", "88")),
        "price_answer_eval_usd": float(os.getenv("PRICE_ANSWER_EVAL_USD", "0.05")),
        "price_interview_usd": float(os.getenv("PRICE_INTERVIEW_USD", "0.20")),
        "price_vector_search_usd": float(os.getenv("PRICE_VECTOR_SEARCH_USD", "0.01")),
        "llm_markup": float(os.getenv("LLM_MARKUP", "1.5")),
        "llm_usd_per_1k_tokens": float(os.getenv("LLM_USD_PER_1K_TOKENS", "0.005")),
        "free_answer_eval": int(os.getenv("FREE_ANSWER_EVAL", "5")),
        "free_interview": int(os.getenv("FREE_INTERVIEW", "2")),
        "free_vector_search": int(os.getenv("FREE_VECTOR_SEARCH", "100")),
        "free_qna": int(os.getenv("FREE_QNA", "0")),
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


def interview_sessions_collection():
    cfg = settings()
    return _mongo()[cfg["mongodb_db"]][cfg["mongodb_interview_sessions_collection"]]


def answer_evaluations_collection():
    cfg = settings()
    return _mongo()[cfg["mongodb_db"]][cfg["mongodb_answer_evaluations_collection"]]


def user_usage_collection():
    cfg = settings()
    return _mongo()[cfg["mongodb_db"]][cfg["mongodb_user_usage_collection"]]


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


def users_collection():
    cfg = settings()
    return _mongo()[cfg["mongodb_db"]][cfg["mongodb_users_collection"]]


def otps_collection():
    cfg = settings()
    return _mongo()[cfg["mongodb_db"]][cfg["mongodb_otps_collection"]]


def day_activities_collection():
    cfg = settings()
    return _mongo()[cfg["mongodb_db"]][cfg["mongodb_day_activities_collection"]]


def activity_categories_collection():
    cfg = settings()
    return _mongo()[cfg["mongodb_db"]][cfg["mongodb_activity_categories_collection"]]


def mindmaps_collection():
    cfg = settings()
    return _mongo()[cfg["mongodb_db"]][cfg["mongodb_mindmaps_collection"]]


def credit_ledger_collection():
    cfg = settings()
    return _mongo()[cfg["mongodb_db"]][cfg["mongodb_credit_ledger_collection"]]


# --- Universal Goal OS collections ---

def goals_collection():
    cfg = settings()
    return _mongo()[cfg["mongodb_db"]][cfg["mongodb_goals_collection"]]


def goal_nodes_collection():
    cfg = settings()
    return _mongo()[cfg["mongodb_db"]][cfg["mongodb_goal_nodes_collection"]]


def goal_metrics_collection():
    cfg = settings()
    return _mongo()[cfg["mongodb_db"]][cfg["mongodb_goal_metrics_collection"]]


def goal_activity_collection():
    cfg = settings()
    return _mongo()[cfg["mongodb_db"]][cfg["mongodb_goal_activity_collection"]]


def goal_attachments_collection():
    cfg = settings()
    return _mongo()[cfg["mongodb_db"]][cfg["mongodb_goal_attachments_collection"]]


def goal_dependencies_collection():
    cfg = settings()
    return _mongo()[cfg["mongodb_db"]][cfg["mongodb_goal_dependencies_collection"]]


def goal_recurring_collection():
    cfg = settings()
    return _mongo()[cfg["mongodb_db"]][cfg["mongodb_goal_recurring_collection"]]


def goal_reminders_collection():
    cfg = settings()
    return _mongo()[cfg["mongodb_db"]][cfg["mongodb_goal_reminders_collection"]]


def goal_templates_collection():
    cfg = settings()
    return _mongo()[cfg["mongodb_db"]][cfg["mongodb_goal_templates_collection"]]


def payments_collection():
    cfg = settings()
    return _mongo()[cfg["mongodb_db"]][cfg["mongodb_payments_collection"]]


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


def _b2_configured() -> bool:
    cfg = settings()
    return bool((cfg.get("b2_endpoint") or "").strip() and (cfg.get("b2_key_id") or "").strip())


def _b2_endpoint_url() -> str:
    """Normalized B2 endpoint. Accepts the value with or without a scheme
    (botocore rejects a scheme-less endpoint, e.g. `s3.us-east-005.backblazeb2.com`)."""
    raw = (settings().get("b2_endpoint") or "").strip().rstrip("/")
    if raw and "://" not in raw:
        raw = f"https://{raw}"
    return raw


def storage_client():
    """S3-compatible client for recordings + content. Uses Backblaze B2 when the
    B2_* vars are set; otherwise falls back to AWS S3 (so existing setups are
    unaffected). Textract-backed features keep using s3_client() (AWS-only)."""
    if boto3 is None:
        raise RuntimeError("boto3 is not installed")
    if not _b2_configured():
        return s3_client()
    cfg = settings()
    from botocore.config import Config

    return boto3.client(
        "s3",
        endpoint_url=_b2_endpoint_url(),
        region_name=(cfg.get("b2_region") or "us-west-004").strip(),
        aws_access_key_id=cfg["b2_key_id"].strip(),
        aws_secret_access_key=(cfg.get("b2_application_key") or "").strip(),
        config=Config(signature_version="s3v4", s3={"addressing_style": "virtual"}),
    )


def storage_object_url(bucket: str, key: str) -> str:
    """Public-style object URL for the storage backend (informational; playback and
    downloads use presigned URLs)."""
    cfg = settings()
    if _b2_configured():
        scheme, _, host = _b2_endpoint_url().partition("://")
        return f"{scheme}://{bucket}.{host}/{key}"
    return f"https://{bucket}.s3.{cfg['aws_region']}.amazonaws.com/{key}"


def textract_client():
    cfg = settings()
    if boto3 is None:
        raise RuntimeError("boto3 is not installed")
    region = cfg["aws_region"]
    return boto3.client("textract", region_name=region)


def lambda_client():
    cfg = settings()
    if boto3 is None:
        raise RuntimeError("boto3 is not installed")
    return boto3.client("lambda", region_name=cfg["aws_region"])


def current_lambda_function_name() -> str:
    """The running Lambda's own name, or empty string when not on Lambda."""
    return os.environ.get("AWS_LAMBDA_FUNCTION_NAME", "")


def sanitize_key_part(value: str) -> str:
    return quote((value or "").strip().replace(" ", "_"), safe="_-")


def session_media_key(doc: Dict[str, Any], media_type: str, ext: str) -> str:
    user_id = sanitize_key_part(doc.get("user_id", ""))
    date_part = sanitize_key_part(doc.get("date", current_date_str()))
    subject_part = sanitize_key_part(doc.get("subject", "general"))
    if user_id:
        return f"study-sessions/{user_id}/{date_part}/{subject_part}/{doc.get('_id')}/{media_type}.{ext}"
    return f"study-sessions/{date_part}/{subject_part}/{doc.get('_id')}/{media_type}.{ext}"


def session_media_chunk_prefix(doc: Dict[str, Any], media_type: str) -> str:
    """S3 prefix where the per-chunk recording objects live before concatenation."""
    user_id = sanitize_key_part(doc.get("user_id", ""))
    date_part = sanitize_key_part(doc.get("date", current_date_str()))
    subject_part = sanitize_key_part(doc.get("subject", "general"))
    if user_id:
        return f"study-sessions/{user_id}/{date_part}/{subject_part}/{doc.get('_id')}/{media_type}_chunks/"
    return f"study-sessions/{date_part}/{subject_part}/{doc.get('_id')}/{media_type}_chunks/"


def session_media_chunk_key(doc: Dict[str, Any], media_type: str, seq: int) -> str:
    return f"{session_media_chunk_prefix(doc, media_type)}{int(seq):08d}.part"
