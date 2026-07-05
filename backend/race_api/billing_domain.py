"""Credits & billing — the money layer on top of usage.

Everything the user sees is **USD**. Razorpay top-ups are charged in INR and
converted at ``usd_to_inr``; the USD value credited is stamped on each paid payment.

Balance (USD) = sum(credited USD on paid payments) − sum(charge ledger, USD).

Billable actions and their free allowances (per user, lifetime):

    answer_eval    $0.05   first 5 free
    interview      $0.20   first 2 free
    vector_search  $0.01   first 100 free
    qna            1.5 × the LLM token cost of the question   (free_qna free, default 0)

Free-tier usage is derived from the running counters in ``storage_domain`` (and the
interview count), so "free" is decided from how many of that action ran *before* this
one. Once the free allowance is spent, an action requires enough balance or raises
``InsufficientCreditsError`` (surfaced as HTTP 402 with a structured detail).
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, Optional

from .context import (
    credit_ledger_collection,
    interview_sessions_collection,
    logger,
    payments_collection,
    settings,
    user_usage_collection,
)

# Ledger "kind" values.
ANSWER_EVAL = "answer_eval"
INTERVIEW = "interview"
VECTOR_SEARCH = "vector_search"
QNA = "qna"

_FIXED_PRICE_KEYS = {
    ANSWER_EVAL: "price_answer_eval_usd",
    INTERVIEW: "price_interview_usd",
    VECTOR_SEARCH: "price_vector_search_usd",
}
_FREE_KEYS = {
    ANSWER_EVAL: "free_answer_eval",
    INTERVIEW: "free_interview",
    VECTOR_SEARCH: "free_vector_search",
    QNA: "free_qna",
}


class InsufficientCreditsError(Exception):
    """Raised when a billable action can't be covered by free quota or balance."""

    def __init__(self, action: str, required_usd: float, balance_usd: float):
        self.action = action
        self.required_usd = round(float(required_usd), 4)
        self.balance_usd = round(float(balance_usd), 4)
        super().__init__(
            f"Insufficient credits for {action}: need ${self.required_usd:.2f}, "
            f"balance ${self.balance_usd:.2f}"
        )


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _uid(user_id: str) -> str:
    return (user_id or "").strip()


# ----------------------------------------------------------------------------- balances

def _payment_to_usd(doc: Dict[str, Any], rate: float) -> float:
    """USD credited by a paid payment: the stamped value, else amount(paise)/100 / rate."""
    if doc.get("credit_usd") is not None:
        try:
            return float(doc["credit_usd"])
        except (TypeError, ValueError):
            pass
    paise = int(doc.get("amount", 0) or 0)
    return (paise / 100.0) / rate if rate else 0.0


def added_usd(user_id: str) -> float:
    uid = _uid(user_id)
    if not uid:
        return 0.0
    rate = float(settings().get("usd_to_inr") or 88)
    total = 0.0
    try:
        for doc in payments_collection().find({"user_id": uid, "status": "paid"}, {"amount": 1, "credit_usd": 1}):
            total += _payment_to_usd(doc, rate)
    except Exception:
        logger.exception("added_usd aggregation failed for %s", uid)
    return round(total, 4)


def spent_usd(user_id: str) -> float:
    return round(sum(spent_breakdown(user_id).values()), 4)


def spent_breakdown(user_id: str) -> Dict[str, float]:
    uid = _uid(user_id)
    out = {ANSWER_EVAL: 0.0, INTERVIEW: 0.0, VECTOR_SEARCH: 0.0, QNA: 0.0}
    if not uid:
        return out
    try:
        for row in credit_ledger_collection().aggregate([
            {"$match": {"user_id": uid, "type": "charge"}},
            {"$group": {"_id": "$kind", "usd": {"$sum": "$usd"}}},
        ]):
            out[str(row.get("_id"))] = round(float(row.get("usd", 0) or 0), 4)
    except Exception:
        logger.exception("spent_breakdown aggregation failed for %s", uid)
    return out


def balance_usd(user_id: str) -> float:
    return round(added_usd(user_id) - spent_usd(user_id), 4)


# ----------------------------------------------------------------------------- free tier

def _free_used(user_id: str) -> Dict[str, int]:
    """How many of each action the user has already done (drives free-tier logic)."""
    uid = _uid(user_id)
    usage = user_usage_collection().find_one({"_id": uid}) or {}
    try:
        interviews = int(interview_sessions_collection().count_documents(
            {"doc_type": "interview_session", "user_id": uid}
        ))
    except Exception:
        interviews = 0
    return {
        ANSWER_EVAL: int(usage.get("answers_evaluated", 0) or 0),
        INTERVIEW: interviews,
        VECTOR_SEARCH: int(usage.get("search_queries", 0) or 0),
        QNA: int(usage.get("qna_questions", 0) or 0),
    }


def _free_limit(kind: str) -> int:
    return int(settings().get(_FREE_KEYS[kind], 0) or 0)


def _record(user_id: str, entry_type: str, kind: str, usd: float, meta: Optional[Dict[str, Any]] = None) -> None:
    try:
        credit_ledger_collection().insert_one({
            "user_id": _uid(user_id),
            "type": entry_type,      # "charge"
            "kind": kind,
            "usd": round(float(usd), 6),
            "meta": meta or {},
            "created_at": _now(),
        })
    except Exception:
        logger.exception("credit ledger record failed (%s/%s)", entry_type, kind)


# ----------------------------------------------------------------------------- charging

def charge_fixed(user_id: str, kind: str, meta: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Charge a fixed-price action (answer_eval / interview / vector_search).

    Free while the user is within the free allowance; otherwise deducts the price or
    raises InsufficientCreditsError. Returns {"free": bool, "charged_usd": float}.
    """
    uid = _uid(user_id)
    price = float(settings().get(_FIXED_PRICE_KEYS[kind]) or 0)
    used = _free_used(uid).get(kind, 0)
    if used < _free_limit(kind):
        return {"free": True, "charged_usd": 0.0}
    bal = balance_usd(uid)
    if bal < price:
        raise InsufficientCreditsError(kind, price, bal)
    _record(uid, "charge", kind, price, meta)
    return {"free": False, "charged_usd": price}


def ensure_can_afford(user_id: str, kind: str) -> None:
    """Pre-flight for a fixed-price action: raise if it can't be covered. No charge."""
    uid = _uid(user_id)
    price = float(settings().get(_FIXED_PRICE_KEYS[kind]) or 0)
    if _free_used(uid).get(kind, 0) < _free_limit(kind):
        return
    bal = balance_usd(uid)
    if bal < price:
        raise InsufficientCreditsError(kind, price, bal)


def ensure_can_qna(user_id: str) -> bool:
    """Pre-flight for a QnA question. Returns True if this one is free.

    Raises InsufficientCreditsError when the free allowance is spent and the balance is
    non-positive (QnA is charged on actual LLM cost, so we only require some credit).
    """
    uid = _uid(user_id)
    if _free_used(uid).get(QNA, 0) < _free_limit(QNA):
        return True
    bal = balance_usd(uid)
    if bal <= 0:
        raise InsufficientCreditsError(QNA, 0.0, bal)
    return False


def charge_llm(user_id: str, tokens: int, meta: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Charge a QnA question at markup × the LLM token cost. No-op when this one is free."""
    uid = _uid(user_id)
    if _free_used(uid).get(QNA, 0) < _free_limit(QNA):
        return {"free": True, "charged_usd": 0.0}
    cfg = settings()
    per_1k = float(cfg.get("llm_usd_per_1k_tokens") or 0)
    markup = float(cfg.get("llm_markup") or 1)
    usd = (int(tokens or 0) / 1000.0) * per_1k * markup
    if usd > 0:
        _record(uid, "charge", QNA, usd, {**(meta or {}), "tokens": int(tokens or 0)})
    return {"free": False, "charged_usd": round(usd, 6)}


# ----------------------------------------------------------------------------- summary

def summary_payload(user_id: str) -> Dict[str, Any]:
    """Everything the Usage page needs to render credits, spend, and free tiers (USD)."""
    uid = _uid(user_id)
    cfg = settings()
    added = added_usd(uid)
    breakdown = spent_breakdown(uid)
    spent = round(sum(breakdown.values()), 4)
    used = _free_used(uid)

    def free_block(kind: str) -> Dict[str, int]:
        limit = _free_limit(kind)
        u = used.get(kind, 0)
        return {"limit": limit, "used": u, "remaining": max(0, limit - u)}

    try:
        payments = int(payments_collection().count_documents({"user_id": uid, "status": "paid"}))
    except Exception:
        payments = 0

    return {
        "currency": "USD",
        "balance_usd": round(added - spent, 4),
        "added_usd": added,
        "spent_usd": spent,
        "payments": payments,
        "usd_to_inr": float(cfg.get("usd_to_inr") or 88),
        "pricing": {
            "answer_eval_usd": float(cfg.get("price_answer_eval_usd") or 0),
            "interview_usd": float(cfg.get("price_interview_usd") or 0),
            "vector_search_usd": float(cfg.get("price_vector_search_usd") or 0),
        },
        "free": {
            "answer_eval": free_block(ANSWER_EVAL),
            "interview": free_block(INTERVIEW),
            "vector_search": free_block(VECTOR_SEARCH),
        },
        "spent_breakdown": {
            "answer_eval_usd": breakdown[ANSWER_EVAL],
            "interview_usd": breakdown[INTERVIEW],
            "vector_search_usd": breakdown[VECTOR_SEARCH],
            "qna_usd": breakdown[QNA],
        },
    }
