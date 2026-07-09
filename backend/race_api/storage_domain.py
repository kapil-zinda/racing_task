"""Per-user usage table (`user_usage`) — one document per user.

Tracks, as running counters:
- storage_bytes      : content + recordings + PDF-search (NOT answer-eval)
- answers_evaluated  : number of Mains answers evaluated
- search_llm_tokens  : LLM tokens spent on search
- qna_llm_tokens     : LLM tokens spent on QnA

Counters are incremented at each mutation point (upload complete, delete, eval done,
LLM call). On first access the storage counter is backfilled from existing data so
pre-existing content/recordings/PDFs are counted.
"""

from datetime import datetime, timezone
from typing import Any, Dict

from .context import (
    content_files_collection,
    interview_sessions_collection,
    logger,
    pdf_docs_collection,
    sessions_collection,
    settings,
    user_usage_collection,
)


def _interviews_taken(user_id: str) -> int:
    try:
        return int(interview_sessions_collection().count_documents(
            {"doc_type": "interview_session", "user_id": (user_id or "").strip()}
        ))
    except Exception:
        logger.exception("interview count failed")
        return 0


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _limit_bytes() -> int:
    try:
        gb = float(settings().get("user_storage_limit_gb") or 10)
    except (TypeError, ValueError):
        gb = 10.0
    return int(gb * 1024 * 1024 * 1024)


def _sum_size(collection, match: Dict[str, Any]) -> int:
    try:
        for row in collection.aggregate([
            {"$match": match},
            {"$group": {"_id": None, "s": {"$sum": {"$ifNull": ["$size", 0]}}}},
        ]):
            return int(row.get("s", 0) or 0)
    except Exception:
        logger.exception("usage size aggregate failed")
    return 0


def recompute_storage_bytes(user_id: str) -> int:
    """Sum current storage from source collections (used to seed / repair the counter)."""
    uid = (user_id or "").strip()
    if not uid:
        return 0
    total = 0
    total += _sum_size(content_files_collection(), {"user_id": uid, "status": {"$ne": "deleted"}})
    total += _sum_size(pdf_docs_collection(), {"user_id": uid})
    try:
        for doc in sessions_collection().find({"doc_type": "study_session", "user_id": uid}, {"uploads": 1}):
            for info in (doc.get("uploads") or {}).values():
                if isinstance(info, dict):
                    total += int(info.get("bytes", 0) or 0)
    except Exception:
        logger.exception("usage storage (recordings) failed")
    return total


def _ensure_doc(user_id: str) -> Dict[str, Any]:
    uid = (user_id or "").strip()
    if not uid:
        return {}
    coll = user_usage_collection()
    doc = coll.find_one({"_id": uid})
    if doc:
        return doc
    # First time: seed storage from existing data so old files count.
    seed = {
        "_id": uid,
        "user_id": uid,
        "storage_bytes": recompute_storage_bytes(uid),
        "answers_evaluated": 0,
        "search_llm_tokens": 0,
        "qna_llm_tokens": 0,
        "search_queries": 0,
        "qna_questions": 0,
        "created_at": _now(),
        "updated_at": _now(),
    }
    coll.update_one({"_id": uid}, {"$setOnInsert": seed}, upsert=True)
    return coll.find_one({"_id": uid}) or seed


def get_usage(user_id: str) -> Dict[str, Any]:
    return _ensure_doc(user_id)


def _incr(user_id: str, field: str, delta: int) -> None:
    uid = (user_id or "").strip()
    if not uid or not delta:
        return
    _ensure_doc(uid)
    try:
        user_usage_collection().update_one(
            {"_id": uid}, {"$inc": {field: int(delta)}, "$set": {"updated_at": _now()}}
        )
    except Exception:
        logger.exception("usage increment failed (%s)", field)


def incr_storage(user_id: str, delta_bytes: int) -> None:
    _incr(user_id, "storage_bytes", int(delta_bytes or 0))


def incr_answers_evaluated(user_id: str, n: int = 1) -> None:
    _incr(user_id, "answers_evaluated", int(n or 0))


def add_llm_tokens(user_id: str, feature: str, tokens: int) -> None:
    field = "search_llm_tokens" if str(feature).strip().lower() == "search" else "qna_llm_tokens"
    _incr(user_id, field, int(tokens or 0))


def incr_search_queries(user_id: str, n: int = 1) -> None:
    _incr(user_id, "search_queries", int(n or 0))


def incr_qna_questions(user_id: str, n: int = 1) -> None:
    _incr(user_id, "qna_questions", int(n or 0))


def incr_goal_ai_generations(user_id: str, n: int = 1) -> None:
    _incr(user_id, "goal_ai_generations", int(n or 0))


def storage_status_payload(user_id: str) -> Dict[str, Any]:
    doc = get_usage(user_id)
    used = max(0, int(doc.get("storage_bytes", 0) or 0))
    limit = _limit_bytes()
    return {
        "used_bytes": used,
        "limit_bytes": limit,
        "available_bytes": max(0, limit - used),
        "used_gb": round(used / (1024 ** 3), 3),
        "limit_gb": round(limit / (1024 ** 3), 2),
        "answers_evaluated": int(doc.get("answers_evaluated", 0) or 0),
        "interviews_taken": _interviews_taken(user_id),
        "search_llm_tokens": int(doc.get("search_llm_tokens", 0) or 0),
        "qna_llm_tokens": int(doc.get("qna_llm_tokens", 0) or 0),
        "search_queries": int(doc.get("search_queries", 0) or 0),
        "qna_questions": int(doc.get("qna_questions", 0) or 0),
    }


def assert_storage_available(user_id: str, incoming_bytes: int = 0) -> None:
    """Raise ValueError (-> HTTP 400) if this upload would exceed the user's quota."""
    doc = get_usage(user_id)
    used = max(0, int(doc.get("storage_bytes", 0) or 0))
    limit = _limit_bytes()
    if used + max(0, int(incoming_bytes or 0)) > limit:
        raise ValueError(
            f"Storage limit reached: using {used / (1024 ** 3):.2f} GB of "
            f"{limit / (1024 ** 3):.0f} GB. Delete some recordings, content or PDFs to free space."
        )
