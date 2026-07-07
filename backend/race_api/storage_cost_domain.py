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
from typing import Any, Dict
from zoneinfo import ZoneInfo

from .context import logger, pdf_docs_collection, settings, users_collection
from .storage_domain import recompute_storage_bytes

_BYTES_PER_GB = 1024 ** 3


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _days_in_current_month() -> int:
    tz = ZoneInfo(settings()["app_timezone"])
    now = datetime.now(tz)
    return monthrange(now.year, now.month)[1]


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
