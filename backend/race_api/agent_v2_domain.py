from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
import re
from typing import Any, Dict, Iterable, List, Tuple

from pymongo import ASCENDING, DESCENDING

from .constants import PLAYERS
from .context import (
    activity_ledger_collection,
    agent_v2_daily_aggregates_collection,
    content_files_collection,
    current_date_str,
    events_collection,
    logger,
    sessions_collection,
)
from .pdf_search_domain import search_pdf
from .race_domain import get_state_payload

_agent_v2_indexes_ensured = False


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _parse_date(value: str | None, fallback: str | None = None) -> str:
    raw = (value or "").strip()
    if raw:
        return datetime.strptime(raw, "%Y-%m-%d").date().isoformat()
    if fallback:
        return datetime.strptime(fallback, "%Y-%m-%d").date().isoformat()
    return current_date_str()


def _date_range(from_date: str, to_date: str) -> List[str]:
    start = datetime.strptime(from_date, "%Y-%m-%d").date()
    end = datetime.strptime(to_date, "%Y-%m-%d").date()
    if start > end:
        raise ValueError("from date must be <= to date")
    out: List[str] = []
    cur = start
    while cur <= end:
        out.append(cur.isoformat())
        cur += timedelta(days=1)
    return out


def _days_since(date_str: str, ref_date: str) -> int:
    if not date_str:
        return 0
    a = datetime.strptime(date_str[:10], "%Y-%m-%d").date()
    b = datetime.strptime(ref_date[:10], "%Y-%m-%d").date()
    return max(0, (b - a).days)


def _contains(text: str, q: str) -> bool:
    return q in (text or "").lower()


def _safe_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def ensure_agent_v2_indexes() -> None:
    global _agent_v2_indexes_ensured
    if _agent_v2_indexes_ensured:
        return
    coll = agent_v2_daily_aggregates_collection()
    coll.create_index([("user_id", ASCENDING), ("date", DESCENDING)], unique=True)
    coll.create_index([("date", DESCENDING)])
    coll.create_index([("updated_at", DESCENDING)])
    _agent_v2_indexes_ensured = True


def _aggregate_id(user_id: str, date_str: str) -> str:
    return f"agent_v2_agg:{user_id}:{date_str}"


def compute_user_daily_aggregate(user_id: str, date_str: str) -> Dict[str, Any]:
    uid = (user_id or "").strip()
    if not uid:
        raise ValueError("Invalid user_id")
    d = _parse_date(date_str)

    event_counts = {
        "new_class_count": 0,
        "revision_count": 0,
        "test_count": 0,
        "ticket_count": 0,
    }
    points_total = 0
    for row in events_collection().find({"player_id": uid, "date": d}, {"event_type": 1, "points": 1}):
        event_type = str(row.get("event_type", "") or "")
        points_total += _safe_int(row.get("points", 0), 0)
        if event_type == "new_class":
            event_counts["new_class_count"] += 1
        elif event_type == "revision":
            event_counts["revision_count"] += 1
        elif event_type == "test_completed":
            event_counts["test_count"] += 1
        elif event_type == "ticket_resolved":
            event_counts["ticket_count"] += 1

    session_minutes = 0
    session_count = 0
    for row in sessions_collection().find(
        {"doc_type": "study_session", "user_id": uid, "date": d, "status": "stopped"},
        {"total_time_minutes": 1},
    ):
        session_count += 1
        session_minutes += max(0, _safe_int(row.get("total_time_minutes", 0), 0))

    extras_minutes = 0
    extras_updates = 0
    for row in activity_ledger_collection().find(
        {"doc_type": "activity_ledger_event", "user_id": uid, "date": d, "activity_type": "extras_update"},
        {"duration_minutes": 1},
    ):
        extras_updates += 1
        extras_minutes += max(0, _safe_int(row.get("duration_minutes", 0), 0))

    event_count = sum(event_counts.values())
    practice_count = event_counts["test_count"] + event_counts["ticket_count"]

    return {
        "_id": _aggregate_id(uid, d),
        "doc_type": "agent_v2_daily_aggregate",
        "user_id": uid,
        "date": d,
        "points_total": points_total,
        "event_count": event_count,
        "new_class_count": event_counts["new_class_count"],
        "revision_count": event_counts["revision_count"],
        "test_count": event_counts["test_count"],
        "ticket_count": event_counts["ticket_count"],
        "practice_count": practice_count,
        "session_count": session_count,
        "session_minutes": session_minutes,
        "extras_updates": extras_updates,
        "extras_minutes": extras_minutes,
        "active": bool(event_count > 0 or session_minutes > 0 or extras_updates > 0),
        "updated_at": _now(),
    }


def refresh_daily_aggregate(user_id: str, date_str: str) -> Dict[str, Any]:
    ensure_agent_v2_indexes()
    doc = compute_user_daily_aggregate(user_id, date_str)
    agent_v2_daily_aggregates_collection().update_one({"_id": doc["_id"]}, {"$set": doc}, upsert=True)
    return doc


def refresh_daily_aggregates_for_date(date_str: str) -> Dict[str, Any]:
    d = _parse_date(date_str)
    docs = [refresh_daily_aggregate(uid, d) for uid in PLAYERS]
    return {"date": d, "updated": len(docs), "aggregates": docs}


def rebuild_daily_aggregates_payload(
    from_date: str | None,
    to_date: str | None,
    user_id: str | None = None,
) -> Dict[str, Any]:
    today = current_date_str()
    end = _parse_date(to_date, fallback=today)
    start = _parse_date(from_date, fallback=end)
    users = [user_id.strip()] if (user_id or "").strip() else list(PLAYERS)
    if not users:
        users = list(PLAYERS)

    ensure_agent_v2_indexes()
    dates = _date_range(start, end)
    updated = 0
    for d in dates:
        for uid in users:
            refresh_daily_aggregate(uid, d)
            updated += 1
    return {
        "message": "agent-v2 aggregates rebuilt",
        "from": start,
        "to": end,
        "users": users,
        "dates": len(dates),
        "updated_docs": updated,
    }


def _load_aggregate_docs(user_id: str, from_date: str, to_date: str) -> List[Dict[str, Any]]:
    uid = (user_id or "").strip()
    if not uid:
        raise ValueError("Invalid user_id")
    ensure_agent_v2_indexes()
    dates = _date_range(from_date, to_date)
    coll = agent_v2_daily_aggregates_collection()
    existing = list(coll.find({"user_id": uid, "date": {"$gte": from_date, "$lte": to_date}}))
    by_date = {str(row.get("date", "")): row for row in existing if row.get("date")}
    out: List[Dict[str, Any]] = []
    for d in dates:
        row = by_date.get(d)
        if not row:
            row = refresh_daily_aggregate(uid, d)
        out.append(row)
    return out


def _group_key(date_str: str, group_by: str) -> str:
    d = datetime.strptime(date_str, "%Y-%m-%d").date()
    mode = (group_by or "day").strip().lower()
    if mode == "week":
        iso = d.isocalendar()
        return f"{iso.year}-W{iso.week:02d}"
    if mode == "month":
        return d.strftime("%Y-%m")
    return date_str


def report_period_payload(
    user_id: str,
    from_date: str,
    to_date: str,
    group_by: str = "day",
    x_days: int = 7,
    y_days: int = 15,
) -> Dict[str, Any]:
    uid = (user_id or "").strip()
    if not uid:
        raise ValueError("Invalid user_id")
    start = _parse_date(from_date)
    end = _parse_date(to_date)
    mode = (group_by or "day").strip().lower()
    if mode not in {"day", "week", "month"}:
        raise ValueError("group_by must be day, week or month")

    rows = _load_aggregate_docs(uid, start, end)
    grouped: Dict[str, Dict[str, Any]] = {}
    for row in rows:
        key = _group_key(str(row.get("date", "")), mode)
        if key not in grouped:
            grouped[key] = {
                "bucket": key,
                "days": 0,
                "active_days": 0,
                "points_total": 0,
                "event_count": 0,
                "new_class_count": 0,
                "revision_count": 0,
                "practice_count": 0,
                "session_minutes": 0,
                "extras_minutes": 0,
            }
        g = grouped[key]
        g["days"] += 1
        g["active_days"] += 1 if row.get("active") else 0
        g["points_total"] += _safe_int(row.get("points_total", 0))
        g["event_count"] += _safe_int(row.get("event_count", 0))
        g["new_class_count"] += _safe_int(row.get("new_class_count", 0))
        g["revision_count"] += _safe_int(row.get("revision_count", 0))
        g["practice_count"] += _safe_int(row.get("practice_count", 0))
        g["session_minutes"] += _safe_int(row.get("session_minutes", 0))
        g["extras_minutes"] += _safe_int(row.get("extras_minutes", 0))

    total_points = sum(_safe_int(row.get("points_total", 0)) for row in rows)
    active_days = sum(1 for row in rows if row.get("active"))
    avg_points = round(total_points / max(1, len(rows)), 2)
    longest_streak = 0
    cur_streak = 0
    for row in rows:
        if row.get("active"):
            cur_streak += 1
            longest_streak = max(longest_streak, cur_streak)
        else:
            cur_streak = 0

    subject_counts: Dict[str, int] = {}
    for row in events_collection().find(
        {"player_id": uid, "date": {"$gte": start, "$lte": end}},
        {"subject": 1, "event_type": 1},
    ):
        if str(row.get("event_type", "")) not in {"new_class", "revision"}:
            continue
        subject = str(row.get("subject", "") or "").strip()
        if not subject:
            continue
        subject_counts[subject] = subject_counts.get(subject, 0) + 1

    top_progressed = sorted(
        [{"subject": k, "activity_count": v} for k, v in subject_counts.items()],
        key=lambda x: x["activity_count"],
        reverse=True,
    )[:5]

    return {
        "user_id": uid,
        "from": start,
        "to": end,
        "group_by": mode,
        "summary": {
            "days": len(rows),
            "active_days": active_days,
            "total_points": total_points,
            "avg_points_per_day": avg_points,
            "longest_active_streak": longest_streak,
            "session_minutes": sum(_safe_int(row.get("session_minutes", 0)) for row in rows),
            "event_count": sum(_safe_int(row.get("event_count", 0)) for row in rows),
        },
        "buckets": [grouped[k] for k in sorted(grouped.keys())],
        "most_progressed_subjects": top_progressed,
    }


def recommendations_next_actions_payload(
    user_id: str,
    duration_min: int = 60,
    mode: str = "supportive",
    limit: int = 5,
    x_days: int = 7,
    y_days: int = 15,
) -> Dict[str, Any]:
    uid = (user_id or "").strip()
    if not uid:
        raise ValueError("Invalid user_id")
    duration = max(15, min(int(duration_min or 60), 720))
    lim = max(1, min(int(limit or 5), 20))
    style = (mode or "supportive").strip().lower()
    if style not in {"supportive", "strict", "balanced"}:
        style = "supportive"

    today = current_date_str()
    last_7_start = (datetime.strptime(today, "%Y-%m-%d").date() - timedelta(days=6)).isoformat()
    recent_rows = _load_aggregate_docs(uid, last_7_start, today)
    recent_practice = sum(_safe_int(row.get("practice_count", 0)) for row in recent_rows)
    recent_revision = sum(_safe_int(row.get("revision_count", 0)) for row in recent_rows)
    recent_study = sum(_safe_int(row.get("new_class_count", 0)) for row in recent_rows)

    items: List[Dict[str, Any]] = []

    if recent_practice < 3:
        items.append(
            {
                "type": "practice",
                "priority": 70,
                "eta_min": min(35, duration),
                "title": "Attempt one test / ticket recall sprint",
                "reason": "Practice volume is low in the last 7 days",
            }
        )
    if recent_revision < recent_study:
        items.append(
            {
                "type": "revision",
                "priority": 65,
                "eta_min": min(30, duration),
                "title": "Close revision debt on latest classes",
                "reason": "Study pace is ahead of revision pace",
            }
        )
    if not items:
        items.append(
            {
                "type": "study",
                "priority": 50,
                "eta_min": min(45, duration),
                "title": "Do one focused study block",
                "reason": "Maintain momentum",
            }
        )

    items.sort(key=lambda row: int(row.get("priority", 0)), reverse=True)
    return {
        "user_id": uid,
        "mode": style,
        "duration_min": duration,
        "generated_at": _now(),
        "recent_7d": {
            "study": recent_study,
            "revision": recent_revision,
            "practice": recent_practice,
        },
        "actions": items[:lim],
    }


def agent_context_payload(
    user_id: str,
    date_value: str | None = None,
    lookback_days: int = 14,
    x_days: int = 7,
    y_days: int = 15,
) -> Dict[str, Any]:
    uid = (user_id or "").strip()
    if not uid:
        raise ValueError("Invalid user_id")
    target_date = _parse_date(date_value, fallback=current_date_str())
    days = max(1, min(int(lookback_days or 14), 365))
    start_date = (datetime.strptime(target_date, "%Y-%m-%d").date() - timedelta(days=days - 1)).isoformat()
    rows = _load_aggregate_docs(uid, start_date, target_date)
    today_row = rows[-1] if rows else refresh_daily_aggregate(uid, target_date)
    recommendations = recommendations_next_actions_payload(uid, duration_min=60, mode="balanced", limit=5, x_days=x_days, y_days=y_days)

    return {
        "user_id": uid,
        "date": target_date,
        "lookback_days": days,
        "today": today_row,
        "recent": {
            "points_total": sum(_safe_int(row.get("points_total", 0)) for row in rows),
            "active_days": sum(1 for row in rows if row.get("active")),
            "study": sum(_safe_int(row.get("new_class_count", 0)) for row in rows),
            "revision": sum(_safe_int(row.get("revision_count", 0)) for row in rows),
            "practice": sum(_safe_int(row.get("practice_count", 0)) for row in rows),
            "session_minutes": sum(_safe_int(row.get("session_minutes", 0)) for row in rows),
        },
        "next_actions": recommendations.get("actions", []),
    }


def _parse_types(raw: str | None) -> List[str]:
    if not raw:
        return ["content"]
    allowed = {"content"}
    out = []
    for token in str(raw).split(","):
        item = token.strip().lower()
        if item in allowed and item not in out:
            out.append(item)
    return out or ["content"]


def search_unified_payload(
    q: str,
    user_id: str,
    course: str | None = None,
    types: str | None = None,
    limit: int = 20,
) -> Dict[str, Any]:
    query = (q or "").strip()
    if not query:
        raise ValueError("q is required")
    uid = (user_id or "").strip()
    if not uid:
        raise ValueError("Invalid user_id")
    lim = max(1, min(int(limit or 20), 100))
    ql = query.lower()
    requested = set(_parse_types(types))
    results: List[Dict[str, Any]] = []
    seen = set()

    def add_result(result: Dict[str, Any]) -> None:
        rid = str(result.get("id", ""))
        if not rid or rid in seen:
            return
        seen.add(rid)
        results.append(result)

    if "content" in requested:
        rx = re.compile(re.escape(query), re.IGNORECASE)
        content_filter: Dict[str, Any] = {"status": {"$in": ["ready", "uploading"]}, "name": {"$regex": rx}}
        if uid:
            content_filter["user_id"] = uid
        for row in content_files_collection().find(
            content_filter,
            {"name": 1, "content_type": 1, "updated_at": 1, "searchable": 1, "searchable_course": 1},
        ).sort("updated_at", DESCENDING).limit(lim):
            name = str(row.get("name", "") or "")
            add_result(
                {
                    "id": f"content:{row.get('_id', '')}",
                    "type": "content",
                    "score": 95 if name.lower().startswith(ql) else 80,
                    "title": name,
                    "subtitle": str(row.get("content_type", "") or ""),
                    "meta": {
                        "file_id": row.get("_id"),
                        "searchable": bool(row.get("searchable")),
                        "searchable_course": row.get("searchable_course", ""),
                        "updated_at": row.get("updated_at", ""),
                    },
                }
            )
        try:
            pdf = search_pdf(query, min(10, lim), course, user_id=uid)
            for row in pdf.get("results", []):
                add_result(
                    {
                        "id": f"pdf:{row.get('doc_id', '')}:{row.get('page_number', '')}",
                        "type": "content",
                        "score": int(round(float(row.get("score", 0) or 0) * 100)),
                        "title": str(row.get("file_name", "") or "PDF"),
                        "subtitle": str(row.get("snippet", "") or ""),
                        "meta": {
                            "doc_id": row.get("doc_id", ""),
                            "page_number": row.get("page_number"),
                            "course": row.get("course", ""),
                            "pdf_url": row.get("pdf_url", ""),
                        },
                    }
                )
        except Exception as err:  # noqa: BLE001
            logger.warning("agent-v2 unified search skipped pdf vector search: %s", err)

    results.sort(key=lambda row: int(row.get("score", 0)), reverse=True)
    return {
        "q": query,
        "user_id": uid,
        "types": sorted(requested),
        "count": len(results[:lim]),
        "results": results[:lim],
    }


def search_suggest_payload(user_id: str, q: str | None = None, limit: int = 12) -> Dict[str, Any]:
    uid = (user_id or "").strip()
    if not uid:
        raise ValueError("Invalid user_id")
    query = (q or "").strip().lower()
    lim = max(1, min(int(limit or 12), 50))

    suggestions: Dict[Tuple[str, str], Dict[str, Any]] = {}

    def add(text: str, kind: str, weight: int = 1) -> None:
        value = (text or "").strip()
        if not value:
            return
        if query and query not in value.lower():
            return
        key = (value.lower(), kind)
        if key not in suggestions:
            suggestions[key] = {"text": value, "type": kind, "score": 0}
        suggestions[key]["score"] += max(1, int(weight))

    for row in events_collection().find({"player_id": uid}, {"subject": 1, "topic": 1, "source": 1, "test_name": 1}).sort("created_at", -1).limit(500):
        add(str(row.get("subject", "") or ""), "subject", 3)
        add(str(row.get("topic", "") or ""), "topic", 2)
        add(str(row.get("source", "") or ""), "source", 2)
        add(str(row.get("test_name", "") or ""), "test", 2)

    content_suggest_filter: Dict[str, Any] = {"status": "ready"}
    if uid:
        content_suggest_filter["user_id"] = uid
    for row in content_files_collection().find(content_suggest_filter, {"name": 1}).sort("updated_at", -1).limit(200):
        add(str(row.get("name", "") or ""), "content", 1)

    items = list(suggestions.values())
    items.sort(key=lambda row: (-int(row.get("score", 0)), str(row.get("text", "")).lower()))
    return {"user_id": uid, "q": query, "count": len(items[:lim]), "suggestions": items[:lim]}


def state_range_payload(
    from_date: str,
    to_date: str,
    user_id: str | None = None,
    include_history: bool = False,
) -> Dict[str, Any]:
    start = _parse_date(from_date)
    end = _parse_date(to_date)
    dates = _date_range(start, end)
    uid = (user_id or "").strip()

    if uid:
        rows = _load_aggregate_docs(uid, start, end)
        return {
            "from": start,
            "to": end,
            "user_id": uid,
            "count": len(rows),
            "days": rows,
        }

    states = []
    for d in dates:
        state = get_state_payload(d)
        if not include_history:
            state = {**state, "history": {}}
        states.append(state)
    return {"from": start, "to": end, "count": len(states), "states": states}

