"""Mongo-backed fixed-window rate limiting.

Lambda invocations don't share memory, so an in-memory counter is unreliable across
concurrent/sequential requests. Mongo is already the shared backend, and already has a
TTL-index pattern for exactly this (see ``otps_collection`` / ``auth_service._ensure_indexes``),
so this reuses that instead of standing up a new external dependency (e.g. Redis).
"""

from __future__ import annotations

import time

from fastapi import HTTPException
from pymongo import ASCENDING, ReturnDocument

from .context import logger, rate_limits_collection

_indexes_ensured = False


def _ensure_indexes() -> None:
    global _indexes_ensured
    if _indexes_ensured:
        return
    try:
        rate_limits_collection().create_index([("expires_at", ASCENDING)], expireAfterSeconds=0, background=True)
    except Exception:
        logger.exception("rate_limits index creation failed")
    _indexes_ensured = True


def check_rate_limit(key: str, limit: int, window_seconds: int) -> None:
    """Raise HTTP 429 if ``key`` has exceeded ``limit`` requests in the current
    ``window_seconds`` fixed window. Fails open (never blocks a request) on Mongo errors —
    a rate limiter that takes down the app on a DB hiccup is worse than no rate limiter.
    """
    _ensure_indexes()
    now = time.time()
    bucket = int(now // window_seconds)
    doc_id = f"{key}:{window_seconds}:{bucket}"
    expires_at = time.time() + window_seconds + 5
    try:
        result = rate_limits_collection().find_one_and_update(
            {"_id": doc_id},
            {"$inc": {"count": 1}, "$setOnInsert": {"expires_at": expires_at}},
            upsert=True,
            return_document=ReturnDocument.AFTER,
        )
    except Exception:
        logger.exception("rate limit check failed for key=%s (failing open)", key)
        return
    count = int((result or {}).get("count", 1))
    if count > limit:
        raise HTTPException(status_code=429, detail="Too many requests, slow down.")
