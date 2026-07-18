from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from pymongo import ASCENDING

from .activity_tracker_domain import get_activities, get_activities_summary
from .context import (
    current_date_str,
    live_session_id,
    live_study_sessions_collection,
    logger,
    settings,
    study_group_members_collection,
)

_ACTIVE_STATUSES = {"running", "paused"}

# One "completed sand timer" = this many seconds of tracked focus time. A session
# contributes floor(elapsed_seconds / POMODORO_SECONDS) completed timers, so the
# cumulative count is derived straight from recorded live time (retroactive,
# tamper-consistent, and correct offline once heartbeats sync).
POMODORO_SECONDS = 25 * 60


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _uid(user_id: str) -> str:
    uid = (user_id or "").strip()
    if not uid:
        raise ValueError("Invalid user_id")
    return uid


def _ensure_indexes() -> None:
    col = live_study_sessions_collection()
    col.create_index([("user_id", ASCENDING), ("status", ASCENDING)], background=True)
    col.create_index([("group_id", ASCENDING), ("status", ASCENDING)], background=True)
    col.create_index([("last_heartbeat", ASCENDING)], background=True)


def init_live_session_service() -> None:
    try:
        _ensure_indexes()
        logger.info("Live session indexes ensured")
    except Exception as exc:  # noqa: BLE001
        logger.warning("Live session index setup failed: %s", exc)


def _resolve_group_id(user_id: str) -> Optional[str]:
    membership = study_group_members_collection().find_one({"user_id": user_id})
    return membership.get("group_id") if membership else None


def start_live_session(user_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    uid = _uid(user_id)
    reap_stale_live_sessions(uid)

    existing = live_study_sessions_collection().find_one({"user_id": uid, "status": {"$in": list(_ACTIVE_STATUSES)}})
    if existing:
        raise ValueError("A live session is already running. Stop or resume it before starting a new one.")

    category = (payload.get("category") or "Study").strip()
    title = (payload.get("title") or "").strip()
    local_date = (payload.get("local_date") or "").strip()
    now = _now_iso()
    doc = {
        "_id": live_session_id(),
        "user_id": uid,
        "group_id": _resolve_group_id(uid),
        "category": category,
        "title": title,
        "date": local_date or current_date_str(),
        "status": "running",
        "started_at": now,
        "stopped_at": None,
        "elapsed_seconds": 0,
        "paused_seconds": 0,
        "foreground": True,
        "last_heartbeat": now,
        "events": [{"type": "started", "at": now, "elapsed_seconds": 0}],
        "created_at": now,
        "updated_at": now,
    }
    live_study_sessions_collection().insert_one(doc)
    logger.info("live session started id=%s user=%s category=%s", doc["_id"], uid, category)
    return {"session": doc}


def _get_owned_session(user_id: str, session_id_value: str) -> Dict[str, Any]:
    doc = live_study_sessions_collection().find_one({"_id": session_id_value, "user_id": user_id})
    if not doc:
        raise LookupError("Live session not found")
    return doc


def heartbeat_live_session(user_id: str, session_id_value: str, elapsed_seconds: int, foreground: bool = True) -> Dict[str, Any]:
    uid = _uid(user_id)
    doc = _get_owned_session(uid, session_id_value)
    if doc.get("status") != "running":
        raise ValueError("Session is not running")
    now = _now_iso()
    live_study_sessions_collection().update_one(
        {"_id": session_id_value},
        {"$set": {"elapsed_seconds": max(0, int(elapsed_seconds)), "foreground": bool(foreground), "last_heartbeat": now, "updated_at": now}},
    )
    return {"message": "ok", "at": now}


def _transition(
    user_id: str,
    session_id_value: str,
    *,
    to_status: str,
    elapsed_seconds: int,
    reason: str,
    from_statuses: set,
) -> Dict[str, Any]:
    uid = _uid(user_id)
    collection = live_study_sessions_collection()
    doc = _get_owned_session(uid, session_id_value)
    current = doc.get("status")
    if current not in from_statuses:
        raise ValueError(f"Invalid transition: {current} -> {to_status}")

    now = _now_iso()
    elapsed = max(0, int(elapsed_seconds))
    event: Dict[str, Any] = {"type": to_status, "at": now, "elapsed_seconds": elapsed}
    if reason:
        event["reason"] = reason

    update_fields: Dict[str, Any] = {
        "status": to_status,
        "elapsed_seconds": elapsed,
        "foreground": reason != "backgrounded",
        "updated_at": now,
    }

    if to_status == "paused":
        # Stop expecting heartbeats while paused — the reaper only watches "running".
        update_fields["last_heartbeat"] = now
    elif to_status == "running":
        # Resuming: add the time spent paused to paused_seconds using the last
        # paused-type event as the reference point.
        paused_events = [e for e in doc.get("events", []) if e.get("type") == "paused"]
        if paused_events:
            last_paused_at = paused_events[-1].get("at")
            try:
                paused_span = (datetime.fromisoformat(now) - datetime.fromisoformat(last_paused_at)).total_seconds()
                update_fields["paused_seconds"] = max(0, int(doc.get("paused_seconds", 0))) + max(0, int(paused_span))
            except Exception:  # noqa: BLE001
                pass
        update_fields["last_heartbeat"] = now
    elif to_status == "stopped":
        update_fields["stopped_at"] = now

    collection.update_one({"_id": session_id_value}, {"$set": update_fields, "$push": {"events": event}})
    updated = collection.find_one({"_id": session_id_value})
    logger.info("live session %s -> %s id=%s user=%s reason=%s", current, to_status, session_id_value, uid, reason)
    return {"session": updated}


def pause_live_session(user_id: str, session_id_value: str, elapsed_seconds: int, reason: str = "manual") -> Dict[str, Any]:
    return _transition(
        user_id, session_id_value, to_status="paused", elapsed_seconds=elapsed_seconds, reason=reason,
        from_statuses={"running"},
    )


def resume_live_session(user_id: str, session_id_value: str, elapsed_seconds: int, reason: str = "manual") -> Dict[str, Any]:
    return _transition(
        user_id, session_id_value, to_status="running", elapsed_seconds=elapsed_seconds, reason=reason,
        from_statuses={"paused"},
    )


def stop_live_session(user_id: str, session_id_value: str, elapsed_seconds: int) -> Dict[str, Any]:
    return _transition(
        user_id, session_id_value, to_status="stopped", elapsed_seconds=elapsed_seconds, reason="user_stopped",
        from_statuses={"running", "paused"},
    )


def get_active_live_session(user_id: str) -> Dict[str, Any]:
    uid = _uid(user_id)
    reap_stale_live_sessions(uid)
    doc = live_study_sessions_collection().find_one({"user_id": uid, "status": {"$in": list(_ACTIVE_STATUSES)}})
    return {"session": doc}


def completed_pomodoros_for_users(user_ids: List[str]) -> Dict[str, int]:
    """Map of user_id -> total completed sand timers (floor(elapsed/25min) summed
    per session) across all of their sessions, in a single aggregation so a group
    view can badge every member without scanning history per row."""
    ids = [u for u in {(uid or "").strip() for uid in user_ids} if u]
    if not ids:
        return {}
    pipeline = [
        {"$match": {"user_id": {"$in": ids}}},
        {
            "$group": {
                "_id": "$user_id",
                "pomodoros": {
                    "$sum": {"$floor": {"$divide": [{"$ifNull": ["$elapsed_seconds", 0]}, POMODORO_SECONDS]}}
                },
            }
        },
    ]
    out: Dict[str, int] = {}
    for row in live_study_sessions_collection().aggregate(pipeline):
        out[row["_id"]] = max(0, int(row.get("pomodoros", 0)))
    return out


def completed_pomodoros_for_user(user_id: str) -> int:
    uid = _uid(user_id)
    return completed_pomodoros_for_users([uid]).get(uid, 0)


def get_live_stats(user_id: str) -> Dict[str, Any]:
    """Lightweight per-user totals for the Home badge: lifetime completed sand
    timers plus today's tracked seconds/timers."""
    uid = _uid(user_id)
    today = current_date_str()
    today_seconds = 0
    for d in live_study_sessions_collection().find({"user_id": uid, "date": today}):
        today_seconds += max(0, int(d.get("elapsed_seconds", 0)))
    return {
        "completed_pomodoros": completed_pomodoros_for_user(uid),
        "today_seconds": today_seconds,
        "today_pomodoros": today_seconds // POMODORO_SECONDS,
        "pomodoro_seconds": POMODORO_SECONDS,
    }


def reap_stale_live_sessions(user_id: Optional[str] = None) -> Dict[str, Any]:
    """A running session with no heartbeat for LIVE_SESSION_STALE_SECONDS is
    assumed crashed/killed (AppState should already have paused it on a normal
    background) and is force-paused so the user can resume or stop it next time
    they open the app — never silently truncated to "stopped"."""
    collection = live_study_sessions_collection()
    cutoff = datetime.now(timezone.utc).timestamp() - settings()["live_session_stale_seconds"]
    query: Dict[str, Any] = {"status": "running"}
    if user_id:
        query["user_id"] = user_id

    reaped: List[str] = []
    for doc in collection.find(query):
        ref = doc.get("last_heartbeat") or doc.get("started_at") or doc.get("created_at") or ""
        try:
            ref_ts = datetime.fromisoformat(str(ref)).timestamp() if ref else 0
        except Exception:  # noqa: BLE001
            ref_ts = 0
        if ref_ts and ref_ts > cutoff:
            continue  # still alive
        now = _now_iso()
        collection.update_one(
            {"_id": doc["_id"]},
            {
                "$set": {"status": "paused", "last_heartbeat": now, "updated_at": now},
                "$push": {
                    "events": {
                        "type": "paused",
                        "at": now,
                        "elapsed_seconds": doc.get("elapsed_seconds", 0),
                        "reason": "auto_paused_stale_heartbeat",
                    }
                },
            },
        )
        reaped.append(doc["_id"])
    if reaped:
        logger.info("live session reaper paused %d stale session(s): %s", len(reaped), reaped)
    return {"reaped": reaped, "count": len(reaped)}


def _day_focus_stats(user_id: str, date: str) -> Dict[str, Any]:
    """tracked = sum of elapsed_seconds across the day's live sessions (client-
    reported foreground time — pauses, whether manual or AppState-triggered on
    backgrounding, are never added to it). other = summed, PER SESSION, (that
    session's own span - its tracked time) — i.e. only counts backgrounded/
    other-app time *while a timer was open*, never the gap between two unrelated
    sessions later stopped and started again the same day. day_span is the sum
    of each session's own span, purely informational."""
    docs = list(live_study_sessions_collection().find({"user_id": user_id, "date": date}))
    if not docs:
        return {"tracked_seconds": 0, "day_span_seconds": 0, "other_seconds": 0}
    tracked_total = 0
    span_total = 0
    other_total = 0
    for d in docs:
        tracked = max(0, int(d.get("elapsed_seconds", 0)))
        tracked_total += tracked
        started_at = d.get("started_at")
        if d.get("stopped_at"):
            ended_at = d["stopped_at"]
        elif d.get("status") in _ACTIVE_STATUSES:
            ended_at = _now_iso()  # still open — count up to now
        else:
            ended_at = d.get("last_heartbeat")
        if not started_at or not ended_at:
            span_total += tracked
            continue
        try:
            span = max(0, int((datetime.fromisoformat(ended_at) - datetime.fromisoformat(started_at)).total_seconds()))
        except Exception:  # noqa: BLE001
            span = tracked
        span_total += span
        other_total += max(0, span - tracked)
    return {"tracked_seconds": tracked_total, "day_span_seconds": span_total, "other_seconds": other_total}


def _shares_group(user_a: str, user_b: str, group_id: str) -> bool:
    if user_a == user_b:
        return True
    found = {
        m["user_id"]
        for m in study_group_members_collection().find(
            {"group_id": group_id, "user_id": {"$in": [user_a, user_b]}}
        )
    }
    return user_a in found and user_b in found


def get_member_month_overview(viewer_user_id: str, group_id: str, target_user_id: str, month: str) -> Dict[str, Any]:
    """Per-day total minutes for target_user_id within `month` (YYYY-MM), gated on
    the viewer sharing a group with the target — live-session stats are only ever
    surfaced to shared-group members, never globally."""
    viewer = _uid(viewer_user_id)
    target = _uid(target_user_id)
    if not _shares_group(viewer, target, group_id):
        raise PermissionError("Not a member of this group")
    month = (month or "").strip()
    try:
        year_s, month_s = month.split("-")
        year, mon = int(year_s), int(month_s)
    except Exception as exc:  # noqa: BLE001
        raise ValueError("month must be YYYY-MM") from exc
    start = f"{year:04d}-{mon:02d}-01"
    end = f"{year+1:04d}-01-01" if mon == 12 else f"{year:04d}-{mon+1:02d}-01"
    docs = live_study_sessions_collection().find(
        {"user_id": target, "status": "stopped", "date": {"$gte": start, "$lt": end}}
    )
    by_day: Dict[str, int] = {}
    for d in docs:
        by_day[d["date"]] = by_day.get(d["date"], 0) + max(0, int(d.get("elapsed_seconds", 0)))
    days = [{"date": k, "total_minutes": round(v / 60, 1)} for k, v in sorted(by_day.items())]
    return {"month": month, "days": days}


def get_member_day_focus(viewer_user_id: str, group_id: str, target_user_id: str, date: str) -> Dict[str, Any]:
    viewer = _uid(viewer_user_id)
    target = _uid(target_user_id)
    if not _shares_group(viewer, target, group_id):
        raise PermissionError("Not a member of this group")
    day = (date or "").strip() or current_date_str()
    return {"date": day, **_day_focus_stats(target, day)}


def _iso_to_local_hhmm(iso: str, tz_offset_min: int = 0) -> str:
    """UTC ISO timestamp -> local "HH:MM", using the client's JS getTimezoneOffset()
    convention (UTC-minus-local, e.g. IST = -330) — same pattern as
    goal_domain.iso_to_local_date."""
    if not iso:
        return ""
    try:
        dt = datetime.fromisoformat(str(iso).replace("Z", "+00:00"))
    except ValueError:
        return str(iso)[11:16]
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    local = dt.astimezone(timezone.utc) - timedelta(minutes=int(tz_offset_min or 0))
    return local.strftime("%H:%M")


def _activity_row_from_live(doc: Dict[str, Any], tz_offset_min: int = 0) -> Dict[str, Any]:
    started = _iso_to_local_hhmm(doc.get("started_at"), tz_offset_min)
    stopped = _iso_to_local_hhmm(doc.get("stopped_at"), tz_offset_min)
    return {
        "id": doc["_id"],
        "title": doc.get("title") or doc.get("category") or "Live session",
        "date": doc.get("date"),
        "start_time": started,
        "end_time": stopped,
        "category": doc.get("category"),
        "note": "",
        "duration_minutes": max(0, int(doc.get("elapsed_seconds", 0)) // 60),
        "source": "live",
    }


def get_day_full(user_id: str, date: str, tz_offset_min: int = 0) -> Dict[str, Any]:
    uid = _uid(user_id)
    day = (date or "").strip() or current_date_str()
    manual = [{**a, "source": "manual"} for a in get_activities(uid, day)]
    live_docs = live_study_sessions_collection().find({"user_id": uid, "date": day, "status": "stopped"})
    live_rows = [_activity_row_from_live(d, tz_offset_min) for d in live_docs]
    activities = sorted(manual + live_rows, key=lambda a: a.get("start_time") or "")
    active = get_active_live_session(uid).get("session")
    return {"activities": activities, "active_session": active, "focus": _day_focus_stats(uid, day)}


def get_day_full_summary(user_id: str, start_date: str, end_date: str, tz_offset_min: int = 0) -> Dict[str, Any]:
    uid = _uid(user_id)
    summary = get_activities_summary(uid, start_date, end_date)
    start = summary.get("start_date")
    end = summary.get("end_date")
    summary.setdefault("focused_minutes", 0)
    summary.setdefault("other_minutes", 0)
    live_docs = list(
        live_study_sessions_collection().find(
            {"user_id": uid, "status": "stopped", "date": {"$gte": start, "$lte": end}}
        )
    )
    if not live_docs:
        return summary

    by_date: Dict[str, List[Dict[str, Any]]] = {}
    for d in live_docs:
        by_date.setdefault(d["date"], []).append(d)

    daily_breakdown = {row["date"]: row for row in summary.get("daily_breakdown", [])}
    for date_key, docs in by_date.items():
        minutes = sum(max(0, int(d.get("elapsed_seconds", 0)) // 60) for d in docs)
        summary["total_minutes"] = summary.get("total_minutes", 0) + minutes
        for d in docs:
            cat = d.get("category") or "Study"
            cat_minutes = max(0, int(d.get("elapsed_seconds", 0)) // 60)
            summary.setdefault("by_category", {})
            summary["by_category"][cat] = summary["by_category"].get(cat, 0) + cat_minutes
        row = daily_breakdown.get(date_key)
        if row is None:
            row = {"date": date_key, "total_minutes": 0, "by_category": {}, "activities": []}
            daily_breakdown[date_key] = row
            summary.setdefault("daily_breakdown", []).append(row)
        row["total_minutes"] = row.get("total_minutes", 0) + minutes
        for d in docs:
            cat = d.get("category") or "Study"
            cat_minutes = max(0, int(d.get("elapsed_seconds", 0)) // 60)
            row.setdefault("by_category", {})
            row["by_category"][cat] = row["by_category"].get(cat, 0) + cat_minutes
            row.setdefault("activities", []).append(_activity_row_from_live(d, tz_offset_min))

    focused_total = 0.0
    other_total = 0.0
    for date_key in by_date:
        focus = _day_focus_stats(uid, date_key)
        row = daily_breakdown.get(date_key)
        if row is not None:
            row["focused_minutes"] = round(focus["tracked_seconds"] / 60, 1)
            row["other_minutes"] = round(focus["other_seconds"] / 60, 1)
        focused_total += focus["tracked_seconds"]
        other_total += focus["other_seconds"]
    summary["focused_minutes"] = round(focused_total / 60, 1)
    summary["other_minutes"] = round(other_total / 60, 1)

    summary["daily_breakdown"] = sorted(summary.get("daily_breakdown", []), key=lambda d: d["date"])
    summary["days_tracked"] = len(summary["daily_breakdown"])
    summary["total_hours"] = round(summary.get("total_minutes", 0) / 60, 2)
    days_tracked = summary["days_tracked"] or 1
    summary["average_per_day"] = round(summary.get("total_minutes", 0) / days_tracked, 1)
    return summary
