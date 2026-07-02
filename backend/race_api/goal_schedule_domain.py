"""Universal Goal OS — reminders, recurring rules, and notifications.

Reminders/recurring rules are stored per goal/node. A scheduled Lambda (EventBridge cron)
calls `run_due_reminders()` to flip due reminders to "notified" and materialise the next
occurrence of recurring rules — no long-running workers.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List

from bson import ObjectId

from .context import (
    goal_recurring_collection,
    goal_reminders_collection,
    goals_collection,
    logger,
)
from .goal_domain import _uid, ensure_goal_indexes


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _owned_goal(user_id: str, goal_id: str) -> Dict[str, Any]:
    doc = goals_collection().find_one({"_id": ObjectId(goal_id), "user_id": user_id})
    if not doc:
        raise LookupError("Goal not found")
    return doc


# --- Reminders ---

def list_reminders(user_id: str, goal_id: str = "") -> Dict[str, Any]:
    ensure_goal_indexes()
    uid = _uid(user_id)
    q: Dict[str, Any] = {"user_id": uid}
    if goal_id:
        _owned_goal(uid, goal_id)
        q["goal_id"] = goal_id
    rows = list(goal_reminders_collection().find(q).sort("time", 1))
    return {"reminders": [{
        "id": str(r["_id"]), "goal_id": r.get("goal_id"), "node_id": r.get("node_id"),
        "time": r.get("time"), "type": r.get("type"), "status": r.get("status"),
    } for r in rows]}


def create_reminder(user_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    ensure_goal_indexes()
    uid = _uid(user_id)
    goal_id = str(payload.get("goal_id") or "").strip()
    when = str(payload.get("time") or "").strip()
    if not goal_id or not when:
        raise ValueError("goal_id and time are required")
    _owned_goal(uid, goal_id)
    doc = {
        "user_id": uid, "goal_id": goal_id,
        "node_id": (str(payload.get("node_id")).strip() if payload.get("node_id") else None),
        "time": when, "type": str(payload.get("type") or "reminder").strip(),
        "status": "pending", "created_at": _now(),
    }
    res = goal_reminders_collection().insert_one(doc)
    doc["id"] = str(res.inserted_id)
    doc.pop("_id", None)
    return doc


def delete_reminder(user_id: str, reminder_id: str) -> Dict[str, Any]:
    uid = _uid(user_id)
    res = goal_reminders_collection().delete_one({"_id": ObjectId(reminder_id), "user_id": uid})
    return {"deleted": res.deleted_count > 0}


def list_notifications(user_id: str) -> Dict[str, Any]:
    """Reminders that have fired (status=notified) and any overdue pending ones."""
    ensure_goal_indexes()
    uid = _uid(user_id)
    now = _now()
    rows = list(goal_reminders_collection().find({
        "user_id": uid,
        "$or": [{"status": "notified"}, {"status": "pending", "time": {"$lte": now}}],
    }).sort("time", -1).limit(50))
    return {"notifications": [{
        "id": str(r["_id"]), "goal_id": r.get("goal_id"), "node_id": r.get("node_id"),
        "time": r.get("time"), "type": r.get("type"), "status": r.get("status"),
    } for r in rows]}


# --- Recurring rules ---

def list_recurring(user_id: str, goal_id: str) -> Dict[str, Any]:
    ensure_goal_indexes()
    uid = _uid(user_id)
    _owned_goal(uid, goal_id)
    rows = list(goal_recurring_collection().find({"goal_id": goal_id}))
    return {"recurring": [{
        "id": str(r["_id"]), "goal_id": r.get("goal_id"), "node_id": r.get("node_id"),
        "frequency": r.get("frequency"), "cron": r.get("cron"),
        "start_date": r.get("start_date"), "end_date": r.get("end_date"),
    } for r in rows]}


def create_recurring(user_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    ensure_goal_indexes()
    uid = _uid(user_id)
    goal_id = str(payload.get("goal_id") or "").strip()
    frequency = str(payload.get("frequency") or "").strip().lower()
    if not goal_id or frequency not in {"daily", "weekly", "monthly"}:
        raise ValueError("goal_id and frequency (daily|weekly|monthly) are required")
    _owned_goal(uid, goal_id)
    doc = {
        "user_id": uid, "goal_id": goal_id,
        "node_id": (str(payload.get("node_id")).strip() if payload.get("node_id") else None),
        "frequency": frequency, "cron": str(payload.get("cron") or "").strip(),
        "start_date": str(payload.get("start_date") or "").strip(),
        "end_date": str(payload.get("end_date") or "").strip(),
        "last_run": None, "created_at": _now(),
    }
    res = goal_recurring_collection().insert_one(doc)
    doc["id"] = str(res.inserted_id)
    doc.pop("_id", None)
    return doc


def delete_recurring(user_id: str, rule_id: str) -> Dict[str, Any]:
    uid = _uid(user_id)
    res = goal_recurring_collection().delete_one({"_id": ObjectId(rule_id), "user_id": uid})
    return {"deleted": res.deleted_count > 0}


# --- Scheduled runner (called by EventBridge-triggered Lambda) ---

def run_due_reminders() -> Dict[str, Any]:
    """Flip due pending reminders to 'notified' and spawn reminders for due recurring rules.
    Idempotent-ish: recurring rules record `last_run` date to avoid duplicate same-day spawns.
    """
    ensure_goal_indexes()
    now_dt = datetime.now(timezone.utc)
    now = now_dt.isoformat()
    today = now[:10]

    fired = goal_reminders_collection().update_many(
        {"status": "pending", "time": {"$lte": now}}, {"$set": {"status": "notified"}}
    )

    spawned = 0
    for rule in goal_recurring_collection().find({"$or": [{"last_run": None}, {"last_run": {"$lt": today}}]}):
        freq = rule.get("frequency")
        last = rule.get("last_run")
        due = False
        if freq == "daily":
            due = True
        elif freq == "weekly":
            due = (last is None) or (now_dt - datetime.fromisoformat(last)).days >= 7
        elif freq == "monthly":
            due = (last is None) or (now_dt - datetime.fromisoformat(last)).days >= 28
        if not due:
            continue
        goal_reminders_collection().insert_one({
            "user_id": rule.get("user_id"), "goal_id": rule.get("goal_id"),
            "node_id": rule.get("node_id"), "time": now, "type": f"recurring:{freq}",
            "status": "pending", "created_at": now,
        })
        goal_recurring_collection().update_one({"_id": rule["_id"]}, {"$set": {"last_run": today}})
        spawned += 1

    logger.info("run_due_reminders: fired=%s spawned=%s", fired.modified_count, spawned)
    return {"reminders_fired": fired.modified_count, "recurring_spawned": spawned}
