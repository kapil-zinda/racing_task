"""Daily storage cost calculation (INR) — EventBridge cron task `storage_cost_daily`.

Every user gets 10 GB free storage; storage beyond that is billed at
`price_storage_inr_per_gb_month`, prorated to a daily charge. Documents marked
Searchable (indexed into the vector DB, i.e. rows in `pdf_docs_collection`) incur
an additional daily charge at `price_vector_inr_per_gb_month`, on top of the
regular storage charge.

This is a standalone INR record appended to each user's `billingHistory` array —
it does not interact with the USD `credit_ledger`/balance system in billing_domain.py.
"""

from calendar import monthrange
from datetime import datetime, timezone
from typing import Any, Dict, List
from zoneinfo import ZoneInfo

from bson import ObjectId

from .context import logger, pdf_docs_collection, settings, users_collection
from .storage_domain import recompute_storage_bytes

_BYTES_PER_GB = 1024 ** 3


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _ist_now() -> datetime:
    return datetime.now(ZoneInfo(settings()["app_timezone"]))


def _days_in_current_month() -> int:
    now = _ist_now()
    return monthrange(now.year, now.month)[1]


def _ist_date_str(timestamp: str) -> str:
    """Parse an ISO timestamp (as stored in billingHistory) and return its IST calendar date."""
    try:
        ts = datetime.fromisoformat(timestamp)
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)
    except (TypeError, ValueError):
        return ""
    return ts.astimezone(ZoneInfo(settings()["app_timezone"])).date().isoformat()


def _free_storage_gb() -> float:
    try:
        return float(settings().get("user_storage_limit_gb") or 10)
    except (TypeError, ValueError):
        return 10.0


def _searchable_storage_bytes(user_id: str) -> int:
    try:
        for row in pdf_docs_collection().aggregate([
            {"$match": {"user_id": user_id}},
            {"$group": {"_id": None, "s": {"$sum": {"$ifNull": ["$size", 0]}}}},
        ]):
            return int(row.get("s", 0) or 0)
    except Exception:
        logger.exception("searchable storage aggregate failed for %s", user_id)
    return 0


def storage_cost_history_payload(user_id: str, days: int = 30) -> Dict[str, Any]:
    """Daily/monthly storage cost for the Usage page — grouped from `billingHistory`."""
    uid = (user_id or "").strip()
    today_str = _ist_now().date().isoformat()
    month_prefix = today_str[:7]  # "YYYY-MM"

    by_date: Dict[str, Dict[str, float]] = {}
    if uid:
        try:
            doc = users_collection().find_one({"_id": ObjectId(uid)}, {"billingHistory": 1}) or {}
        except Exception:
            doc = {}
        for entry in doc.get("billingHistory") or []:
            date_str = _ist_date_str(str(entry.get("timestamp", "")))
            if not date_str:
                continue
            row = by_date.setdefault(date_str, {"cost": 0.0, "additionalCost": 0.0})
            row["cost"] += float(entry.get("cost", 0) or 0)
            row["additionalCost"] += float(entry.get("additionalCost", 0) or 0)

    def _row(date_str: str) -> Dict[str, Any]:
        r = by_date.get(date_str, {"cost": 0.0, "additionalCost": 0.0})
        cost = round(r["cost"], 2)
        additional = round(r["additionalCost"], 2)
        return {"date": date_str, "cost": cost, "additionalCost": additional, "total": round(cost + additional, 2)}

    this_month = {"cost": 0.0, "additionalCost": 0.0}
    for date_str, r in by_date.items():
        if date_str.startswith(month_prefix):
            this_month["cost"] += r["cost"]
            this_month["additionalCost"] += r["additionalCost"]
    this_month_cost = round(this_month["cost"], 2)
    this_month_additional = round(this_month["additionalCost"], 2)

    ordered_dates: List[str] = sorted(by_date.keys())[-days:] if days > 0 else sorted(by_date.keys())

    return {
        "today": _row(today_str),
        "thisMonth": {
            "cost": this_month_cost,
            "additionalCost": this_month_additional,
            "total": round(this_month_cost + this_month_additional, 2),
        },
        "history": [_row(d) for d in ordered_dates],
    }


def run_storage_cost_task() -> Dict[str, Any]:
    cfg = settings()
    price_storage = float(cfg.get("price_storage_inr_per_gb_month") or 0)
    price_vector = float(cfg.get("price_vector_inr_per_gb_month") or 0)
    free_gb = _free_storage_gb()
    days = _days_in_current_month()

    results = []
    processed = 0
    for user in users_collection().find({}, {"_id": 1}):
        uid = str(user["_id"])
        try:
            total_gb = recompute_storage_bytes(uid) / _BYTES_PER_GB
            searchable_gb = _searchable_storage_bytes(uid) / _BYTES_PER_GB
            billable_gb = max(0.0, total_gb - free_gb)

            storage_cost_today = billable_gb * price_storage / days
            vector_cost_today = searchable_gb * price_vector / days
            total_cost_today = storage_cost_today + vector_cost_today

            storage_cost_today = round(storage_cost_today, 2)
            vector_cost_today = round(vector_cost_today, 2)
            total_cost_today = round(total_cost_today, 2)

            if storage_cost_today or vector_cost_today:
                users_collection().update_one(
                    {"_id": user["_id"]},
                    {
                        "$push": {
                            "billingHistory": {
                                "timestamp": _now_iso(),
                                "cost": storage_cost_today,
                                "additionalCost": vector_cost_today,
                            }
                        }
                    },
                )

            results.append(
                {
                    "userId": uid,
                    "storageUsedGB": round(total_gb, 3),
                    "freeStorageGB": round(free_gb, 3),
                    "billableStorageGB": round(billable_gb, 3),
                    "searchableStorageGB": round(searchable_gb, 3),
                    "storageCostToday": storage_cost_today,
                    "vectorCostToday": vector_cost_today,
                    "totalCostToday": total_cost_today,
                }
            )
            processed += 1
        except Exception:
            logger.exception("storage cost computation failed for user %s", uid)

    logger.info("run_storage_cost_task: processedUsers=%s", processed)
    return {"processedUsers": processed, "results": results}
