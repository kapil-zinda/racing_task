"""Pricing plans — Free / Pro / Max, on top of the pay-per-use credit system.

Plans are **manual, non-auto-renewing period passes**: a user pays once (via the
existing Razorpay order + webhook flow in ``payment_domain``) for one month or one
year, gets that plan's quota for the period, then must re-purchase — there's no
recurring mandate/auto-charge.

The Free tier isn't a row in ``PLAN_CATALOG``; it's derived from the existing
``settings()`` free_* env vars and ``user_storage_limit_gb``, so free-tier behaviour
(and its single source of truth) is unchanged from before plans existed.

Quota precedence, enforced from ``billing_domain``: active plan quota for this
period -> lifetime free allowance -> pay-per-use credit balance.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional

from .context import logger, settings, subscriptions_collection

PLAN_CATALOG: Dict[str, Dict[str, Any]] = {
    "pro": {
        "name": "Pro",
        "storage_gb": 25,
        "quota": {"interview": 5, "answer_eval": 30, "qna": 100},
        "monthly": {"price_inr": 499, "strike_inr": 699, "save_pct": 28},
        "annual": {"price_inr": 4999, "strike_inr": 6499, "save_pct": 23},
    },
    "max": {
        "name": "Max",
        "storage_gb": 50,
        "quota": {"interview": 15, "answer_eval": 60, "qna": None},  # None = unlimited
        "monthly": {"price_inr": 999, "strike_inr": 1249, "save_pct": 20},
        "annual": {"price_inr": 8999, "strike_inr": 13999, "save_pct": 35},
    },
}
_INTERVALS = ("monthly", "annual")
_PERIOD_DAYS = {"monthly": 30, "annual": 365}

_subscription_indexes_ensured = False


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _now_iso() -> str:
    return _now().isoformat()


def ensure_subscription_indexes() -> None:
    global _subscription_indexes_ensured
    if _subscription_indexes_ensured:
        return
    try:
        coll = subscriptions_collection()
        coll.create_index([("user_id", 1), ("period_end", -1)])
        coll.create_index([("order_id", 1)], unique=True)
    except Exception:
        logger.exception("Subscription index setup failed")
    _subscription_indexes_ensured = True


def _free_plan_block() -> Dict[str, Any]:
    cfg = settings()
    return {
        "name": "Free",
        "storage_gb": float(cfg.get("user_storage_limit_gb") or 5),
        "quota": {
            "interview": int(cfg.get("free_interview") or 0),
            "answer_eval": int(cfg.get("free_answer_eval") or 0),
            "qna": int(cfg.get("free_qna") or 0),
        },
    }


def list_plans_payload() -> Dict[str, Any]:
    """Public plan catalog for the pricing page. No auth required."""
    plans = {"free": _free_plan_block()}
    for key, plan in PLAN_CATALOG.items():
        plans[key] = {
            "name": plan["name"],
            "storage_gb": plan["storage_gb"],
            "quota": plan["quota"],
            "monthly": plan["monthly"],
            "annual": plan["annual"],
        }
    return {"plans": plans}


def _validate_plan_interval(plan: str, interval: str) -> Dict[str, Any]:
    if plan not in PLAN_CATALOG:
        raise ValueError(f"Unknown plan '{plan}'")
    if interval not in _INTERVALS:
        raise ValueError(f"Unknown interval '{interval}'")
    return PLAN_CATALOG[plan]


def current_subscription(user_id: str) -> Optional[Dict[str, Any]]:
    """The active (unexpired) subscription doc for this user, else None (= free tier)."""
    uid = (user_id or "").strip()
    if not uid:
        return None
    ensure_subscription_indexes()
    doc = subscriptions_collection().find_one(
        {"user_id": uid, "period_end": {"$gte": _now_iso()}},
        sort=[("period_end", -1)],
    )
    return doc


def current_subscription_payload(user_id: str) -> Dict[str, Any]:
    sub = current_subscription(user_id)
    if not sub:
        return {"plan": "free", "interval": None, "period_end": None, "quota": None, "usage": None}
    quota = sub.get("quota") or {}
    usage = sub.get("usage") or {}

    def block(kind: str) -> Dict[str, Any]:
        limit = quota.get(kind)
        used = int(usage.get(kind, 0) or 0)
        if limit is None:
            return {"limit": None, "used": used, "remaining": None}
        return {"limit": limit, "used": used, "remaining": max(0, int(limit) - used)}

    return {
        "plan": sub.get("plan"),
        "interval": sub.get("interval"),
        "period_start": sub.get("period_start"),
        "period_end": sub.get("period_end"),
        "storage_gb": sub.get("storage_gb"),
        "quota": {
            "interview": block("interview"),
            "answer_eval": block("answer_eval"),
            "qna": block("qna"),
        },
    }


def create_plan_order_payload(user_id: str, plan: str, interval: str) -> Dict[str, Any]:
    """Create a Razorpay order for a plan purchase, reusing the existing order/webhook flow."""
    catalog_plan = _validate_plan_interval(plan, interval)
    price_inr = int(catalog_plan[interval]["price_inr"])
    amount_paise = price_inr * 100

    from . import payment_domain

    return payment_domain.create_order_payload(
        amount_paise,
        "INR",
        receipt=f"plan_{plan}_{interval}_{user_id}"[:40],
        notes={"purpose": "plan", "plan": plan, "interval": interval, "user_id": user_id},
        user_id=user_id,
    )


def activate_subscription_from_order(order_doc: Dict[str, Any]) -> Dict[str, Any]:
    """Turn a paid 'plan' order into an active subscription. Called from
    ``payment_domain._mark_paid`` once — never invented outside a paid order."""
    notes = order_doc.get("notes") or {}
    plan = notes.get("plan")
    interval = notes.get("interval")
    user_id = (notes.get("user_id") or order_doc.get("user_id") or "").strip()
    catalog_plan = _validate_plan_interval(plan, interval)

    now = _now()
    period_end = now + timedelta(days=_PERIOD_DAYS[interval])
    doc = {
        "user_id": user_id,
        "plan": plan,
        "interval": interval,
        "period_start": now.isoformat(),
        "period_end": period_end.isoformat(),
        "quota": dict(catalog_plan["quota"]),
        "usage": {"interview": 0, "answer_eval": 0, "qna": 0},
        "storage_gb": catalog_plan["storage_gb"],
        "order_id": order_doc.get("order_id"),
        "created_at": now.isoformat(),
        "updated_at": now.isoformat(),
    }
    ensure_subscription_indexes()
    subscriptions_collection().insert_one(doc)
    logger.info("Activated %s/%s subscription for user %s", plan, interval, user_id)
    return doc


def has_quota_remaining(user_id: str, kind: str, units: int = 1) -> bool:
    """Read-only check for pre-flight gating (no charge). See ``consume_quota``."""
    sub = current_subscription(user_id)
    if not sub:
        return False
    quota = sub.get("quota") or {}
    if kind not in quota:
        return False
    limit = quota[kind]
    if limit is None:
        return True
    used = int((sub.get("usage") or {}).get(kind, 0) or 0)
    return used + units <= int(limit)


def consume_quota(user_id: str, kind: str, units: int = 1) -> bool:
    """Atomically consume ``units`` of ``kind`` from the active plan's quota, if any
    remains. Returns True if covered by the plan (nothing else should be charged)."""
    sub = current_subscription(user_id)
    if not sub:
        return False
    quota = sub.get("quota") or {}
    if kind not in quota:
        return False
    limit = quota[kind]
    if limit is None:
        # Explicit None means unlimited for this kind on this plan (e.g. Max QnA).
        subscriptions_collection().update_one({"_id": sub["_id"]}, {"$inc": {f"usage.{kind}": units}})
        return True
    used = int((sub.get("usage") or {}).get(kind, 0) or 0)
    if used + units > int(limit):
        return False
    result = subscriptions_collection().update_one(
        {"_id": sub["_id"], f"usage.{kind}": used},
        {"$inc": {f"usage.{kind}": units}},
    )
    return result.modified_count == 1


def storage_limit_gb(user_id: str) -> float:
    sub = current_subscription(user_id)
    if sub and sub.get("storage_gb") is not None:
        return float(sub["storage_gb"])
    return float(settings().get("user_storage_limit_gb") or 5)
