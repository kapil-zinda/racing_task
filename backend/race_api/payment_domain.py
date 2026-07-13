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


def _mark_paid(order_id: str, payment_id: str, signature: str, *, user_id: str = "") -> Dict[str, Any]:
    """Stamp an existing ``created`` order record as ``paid`` and credit its USD value.

    Shared by both the browser-return verify path and the webhook, so there's one source
    of truth for "how do we credit a payment" and no drift between the two. Idempotent:
    if the order is already ``paid``, this is a no-op (handles webhook + browser-return
    both firing for the same payment). Requires an existing order record — never creates
    one, so a signature valid for an order this app never created can't mint credit.
    """
    now = _now()
    existing = payments_collection().find_one({"order_id": order_id})
    if not existing:
        logger.warning("Payment verified for unknown order %s; refusing to credit", order_id)
        raise HTTPException(status_code=400, detail="Unknown order")
    if existing.get("status") == "paid":
        return {"verified": True, "order_id": order_id, "payment_id": existing.get("payment_id", payment_id), "status": "paid"}

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

    purpose = (existing.get("notes") or {}).get("purpose", "topup")
    if purpose == "plan":
        # Plan purchase: activate the subscription instead of crediting the wallet
        # (crediting it too would double-count the same payment as both a plan and
        # top-up credits).
        payments_collection().update_one({"order_id": order_id}, {"$set": paid_fields})
        from . import plans_domain

        plans_domain.activate_subscription_from_order({**existing, **paid_fields, "order_id": order_id})
        return {"verified": True, "order_id": order_id, "payment_id": payment_id, "status": "paid", "purpose": "plan"}

    # Stamp the USD value this payment credits (surface currency is USD; Razorpay took
    # INR). Derived from the stored order amount so it can't be tampered client-side.
    rate = float(settings().get("usd_to_inr") or 88)
    amount_paise = int(existing.get("amount", 0) or 0)
    credit_usd = round((amount_paise / 100.0) / rate, 4) if rate else 0.0
    paid_fields["credit_usd"] = credit_usd
    payments_collection().update_one({"order_id": order_id}, {"$set": paid_fields})

    # Keep the cached wallet balance in step with the payments ledger. The
    # already-paid short-circuit above makes this idempotent across the
    # webhook + browser-return double fire.
    if credit_usd:
        from . import billing_domain

        billing_domain.adjust_balance_cache(paid_fields.get("user_id") or existing.get("user_id", ""), credit_usd)

    return {"verified": True, "order_id": order_id, "payment_id": payment_id, "status": "paid"}


def verify_payment_payload(
    razorpay_order_id: str,
    razorpay_payment_id: str,
    razorpay_signature: str,
    *,
    user_id: str = "",
) -> Dict[str, Any]:
    """Verify the checkout signature. Marks the payment ``paid`` only on a match.

    Returns {"verified": True, ...} on success; raises HTTPException(400) on missing fields,
    a signature mismatch (the record is flagged ``verification_failed`` and never ``paid``),
    or an unknown order (a valid signature for an order this app never created).
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

    ensure_payment_indexes()
    if not matched:
        payments_collection().update_one(
            {"order_id": order_id},
            {"$set": {
                "status": "verification_failed",
                "payment_id": payment_id,
                "signature": signature,
                "updated_at": _now(),
            }},
        )
        logger.warning("Payment signature mismatch for order %s (payment %s)", order_id, payment_id)
        raise HTTPException(status_code=400, detail="Payment signature verification failed")

    return _mark_paid(order_id, payment_id, signature, user_id=user_id)


def verify_webhook_payload(raw_body: bytes, signature: str) -> Dict[str, Any]:
    """Verify + reconcile a Razorpay webhook call (``payment.captured``).

    Uses the same manual-HMAC style as checkout verification, against the separate
    webhook secret configured in the Razorpay dashboard. Idempotent via ``_mark_paid``.
    """
    secret = (settings().get("razorpay_webhook_secret") or "").strip()
    if not secret:
        logger.error("Razorpay webhook received but RAZORPAY_WEBHOOK_SECRET is not configured")
        raise HTTPException(status_code=500, detail="Webhook is not configured")

    expected = hmac.new(secret.encode("utf-8"), raw_body, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, (signature or "").strip()):
        logger.warning("Razorpay webhook signature mismatch")
        raise HTTPException(status_code=400, detail="Invalid webhook signature")

    try:
        event = json.loads(raw_body.decode("utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError) as err:
        raise HTTPException(status_code=400, detail="Invalid webhook body") from err

    event_type = event.get("event", "")
    if event_type != "payment.captured":
        # Ack anything we don't act on so Razorpay doesn't retry it forever.
        return {"handled": False, "event": event_type}

    payment_entity = (
        (event.get("payload") or {}).get("payment", {}).get("entity", {})
    )
    order_id = (payment_entity.get("order_id") or "").strip()
    payment_id = (payment_entity.get("id") or "").strip()
    if not order_id or not payment_id:
        raise HTTPException(status_code=400, detail="Webhook payload missing order_id/payment_id")

    ensure_payment_indexes()
    result = _mark_paid(order_id, payment_id, signature)
    return {"handled": True, **result}


def credit_balance_payload(user_id: str = "") -> Dict[str, Any]:
    """Credits summary for a user, in USD — balance, spend breakdown, and free-tier usage.

    Surface currency is USD; Razorpay top-ups are converted at ``usd_to_inr`` and the
    credited USD is stamped on each paid payment (see ``verify_payment_payload``).
    """
    ensure_payment_indexes()
    from . import billing_domain as billing

    return billing.summary_payload((user_id or "").strip())
