"""Razorpay Standard Checkout — order creation + payment signature verification.

Follows the codebase's stdlib-urllib REST style (see ``upstash_vector.py``) instead of
pulling in the ``razorpay`` SDK, and stores every order/payment in the ``payments``
MongoDB collection so the full lifecycle (created -> paid / failed) is auditable.

Flow (Razorpay Standard Web Checkout):
  1. Frontend asks the backend to create an order (amount in paise).
  2. Backend calls ``POST https://api.razorpay.com/v1/orders`` (HTTP Basic auth with
     KEY_ID:KEY_SECRET) and persists a ``created`` payment record.
  3. Frontend opens the Razorpay modal with the returned ``order_id`` + public KEY_ID.
  4. On success Razorpay hands the frontend {payment_id, order_id, signature}; the backend
     recomputes HMAC-SHA256(order_id|payment_id, KEY_SECRET) and only marks the record
     ``paid`` when the signatures match.

KEY_SECRET never leaves the server. Reference:
https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/integration-steps/
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
from datetime import datetime, timezone
from typing import Any, Dict, Optional
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from fastapi import HTTPException
from pymongo import ASCENDING, DESCENDING

from .context import logger, payments_collection, settings

RAZORPAY_ORDERS_URL = "https://api.razorpay.com/v1/orders"
MIN_AMOUNT_PAISE = 100

_payment_indexes_ensured = False


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _credentials() -> tuple[str, str]:
    cfg = settings()
    key_id = (cfg.get("razorpay_key_id") or "").strip()
    key_secret = (cfg.get("razorpay_key_secret") or "").strip()
    if not key_id or not key_secret:
        # Misconfiguration, not a client error — surface as 500.
        raise HTTPException(
            status_code=500,
            detail="Razorpay is not configured (RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET)",
        )
    return key_id, key_secret


def ensure_payment_indexes() -> None:
    global _payment_indexes_ensured
    if _payment_indexes_ensured:
        return
    coll = payments_collection()
    coll.create_index([("order_id", ASCENDING)], unique=True)
    coll.create_index([("payment_id", ASCENDING)])
    coll.create_index([("user_id", ASCENDING), ("created_at", DESCENDING)])
    coll.create_index([("status", ASCENDING), ("created_at", DESCENDING)])
    _payment_indexes_ensured = True


def _razorpay_create_order(amount: int, currency: str, receipt: str) -> Dict[str, Any]:
    """Call Razorpay's create-order API with HTTP Basic auth. Raises HTTPException on failure."""
    key_id, key_secret = _credentials()
    token = base64.b64encode(f"{key_id}:{key_secret}".encode("utf-8")).decode("ascii")
    body = json.dumps({"amount": amount, "currency": currency, "receipt": receipt}).encode("utf-8")
    request = Request(
        RAZORPAY_ORDERS_URL,
        data=body,
        headers={"Authorization": f"Basic {token}", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urlopen(request, timeout=30) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except HTTPError as err:
        detail = err.read().decode("utf-8", errors="ignore")
        if err.code in (401, 403):
            logger.warning("Razorpay auth failed (HTTP %s): %s", err.code, detail)
            raise HTTPException(status_code=401, detail="Razorpay authentication failed") from err
        logger.error("Razorpay create-order failed (HTTP %s): %s", err.code, detail)
        raise HTTPException(status_code=500, detail="Failed to create Razorpay order") from err
    except URLError as err:
        logger.error("Razorpay create-order network error: %s", err.reason)
        raise HTTPException(status_code=500, detail="Failed to reach Razorpay") from err


def create_order_payload(
    amount: int,
    currency: str = "INR",
    receipt: str = "",
    *,
    notes: Optional[Dict[str, Any]] = None,
    user_id: str = "",
) -> Dict[str, Any]:
    """Create a Razorpay order and persist it. Returns the fields the frontend checkout needs."""
    try:
        amount = int(amount)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="amount must be an integer number of paise")
    if amount < MIN_AMOUNT_PAISE:
        raise HTTPException(status_code=400, detail=f"amount must be at least {MIN_AMOUNT_PAISE} paise")

    currency = (currency or "INR").strip().upper() or "INR"
    receipt = (receipt or f"rcpt_{int(datetime.now(timezone.utc).timestamp())}").strip()[:40]

    order = _razorpay_create_order(amount, currency, receipt)
    order_id = order.get("id")
    if not order_id:
        logger.error("Razorpay returned no order id: %s", order)
        raise HTTPException(status_code=500, detail="Razorpay did not return an order id")

    ensure_payment_indexes()
    key_id, _ = _credentials()
    now = _now()
    payments_collection().update_one(
        {"order_id": order_id},
        {
            "$set": {
                "order_id": order_id,
                "user_id": (user_id or "").strip(),
                "amount": amount,
                "currency": currency,
                "receipt": receipt,
                "status": "created",
                "notes": notes if isinstance(notes, dict) else {},
                "razorpay_order": order,
                "updated_at": now,
            },
            "$setOnInsert": {"created_at": now, "payment_id": "", "signature": ""},
        },
        upsert=True,
    )

    return {
        "order_id": order_id,
        "amount": amount,
        "currency": currency,
        "receipt": receipt,
        "key_id": key_id,
    }


def _expected_signature(order_id: str, payment_id: str) -> str:
    _, key_secret = _credentials()
    message = f"{order_id}|{payment_id}".encode("utf-8")
    return hmac.new(key_secret.encode("utf-8"), message, hashlib.sha256).hexdigest()


def verify_payment_payload(
    razorpay_order_id: str,
    razorpay_payment_id: str,
    razorpay_signature: str,
    *,
    user_id: str = "",
) -> Dict[str, Any]:
    """Verify the checkout signature. Marks the payment ``paid`` only on a match.

    Returns {"verified": True, ...} on success; raises HTTPException(400) on missing fields
    or a signature mismatch (the record is flagged ``verification_failed`` and never ``paid``).
    """
    order_id = (razorpay_order_id or "").strip()
    payment_id = (razorpay_payment_id or "").strip()
    signature = (razorpay_signature or "").strip()
    if not order_id or not payment_id or not signature:
        raise HTTPException(
            status_code=400,
            detail="razorpay_order_id, razorpay_payment_id and razorpay_signature are required",
        )

    expected = _expected_signature(order_id, payment_id)
    matched = hmac.compare_digest(expected, signature)
    now = _now()

    ensure_payment_indexes()
    if not matched:
        payments_collection().update_one(
            {"order_id": order_id},
            {"$set": {
                "status": "verification_failed",
                "payment_id": payment_id,
                "signature": signature,
                "updated_at": now,
            }},
        )
        logger.warning("Payment signature mismatch for order %s (payment %s)", order_id, payment_id)
        raise HTTPException(status_code=400, detail="Payment signature verification failed")

    paid_fields: Dict[str, Any] = {
        "status": "paid",
        "payment_id": payment_id,
        "signature": signature,
        "verified_at": now,
        "updated_at": now,
    }
    # Only overwrite user_id when this request carries one, so we never clobber the owner
    # recorded at order-creation time with an anonymous verify call.
    uid = (user_id or "").strip()
    if uid:
        paid_fields["user_id"] = uid
    result = payments_collection().update_one({"order_id": order_id}, {"$set": paid_fields})

    if result.matched_count == 0:
        # Signature is valid but we have no record of this order — accept, but log for auditing.
        logger.warning("Verified payment for unknown order %s; inserting record", order_id)
        payments_collection().update_one(
            {"order_id": order_id},
            {
                "$set": {
                    "order_id": order_id,
                    "payment_id": payment_id,
                    "signature": signature,
                    "status": "paid",
                    "user_id": (user_id or "").strip(),
                    "verified_at": now,
                    "updated_at": now,
                },
                "$setOnInsert": {"created_at": now},
            },
            upsert=True,
        )

    return {
        "verified": True,
        "order_id": order_id,
        "payment_id": payment_id,
        "status": "paid",
    }


def credit_balance_payload(user_id: str = "") -> Dict[str, Any]:
    """Credit balance for a user, derived from verified (``paid``) payments.

    Credits are 1:1 with rupees paid, so balance_paise is the sum of paid amounts and
    the frontend renders balance_paise / 100 as the rupee balance.
    """
    ensure_payment_indexes()
    match: Dict[str, Any] = {"status": "paid"}
    uid = (user_id or "").strip()
    match["user_id"] = uid if uid else ""
    agg = list(
        payments_collection().aggregate(
            [
                {"$match": match},
                {"$group": {"_id": None, "total_paise": {"$sum": "$amount"}, "payments": {"$sum": 1}}},
            ]
        )
    )
    total_paise = int(agg[0]["total_paise"]) if agg else 0
    payments = int(agg[0]["payments"]) if agg else 0
    return {
        "balance_paise": total_paise,
        "balance_rupees": round(total_paise / 100, 2),
        "currency": "INR",
        "payments": payments,
    }
