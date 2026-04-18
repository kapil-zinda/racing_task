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
from .mission_domain import get_or_create_mission, mission_progress_payload, mission_selector_options
from .pdf_search_domain import search_pdf
from .race_domain import build_syllabus_payload, get_state_payload

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
    uid = (user_id or "").strip().lower()
    if uid not in PLAYERS:
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
    users = [user_id.strip().lower()] if (user_id or "").strip() else list(PLAYERS)
    if users and users[0] and users[0] not in PLAYERS:
        raise ValueError("Invalid user_id")
    users = [u for u in users if u in PLAYERS]
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
    uid = (user_id or "").strip().lower()
    if uid not in PLAYERS:
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


def _revision_gaps_raw(user_id: str, x_days: int = 7, y_days: int = 15, reference_date: str | None = None) -> Dict[str, Any]:
    uid = (user_id or "").strip().lower()
    if uid not in PLAYERS:
        raise ValueError("Invalid user_id")
    x = max(1, int(x_days or 7))
    y = max(1, int(y_days or 15))
    ref = _parse_date(reference_date, fallback=current_date_str())
    syllabus = build_syllabus_payload(uid)

    not_started: List[Dict[str, Any]] = []
    missing_first: List[Dict[str, Any]] = []
    missing_second: List[Dict[str, Any]] = []

    for exam_node in syllabus.get("exams", []):
        exam = str(exam_node.get("exam", "") or "")
        for subject_node in exam_node.get("subjects", []):
            subject = str(subject_node.get("subject", "") or "")
            for topic_node in subject_node.get("topics", []):
                topic = str(topic_node.get("topic", "") or "")
                class_date = str(topic_node.get("class_study_first_date", "") or "")
                first_rev = str(topic_node.get("first_revision_date", "") or "")
                second_rev = str(topic_node.get("second_revision_date", "") or "")
                base = {"exam": exam, "subject": subject, "topic": topic}
                if not class_date:
                    not_started.append(base)
                    continue
                if not first_rev:
                    overdue = _days_since(class_date, ref)
                    if overdue >= x:
                        missing_first.append({**base, "class_date": class_date, "days_overdue": overdue})
                    continue
                if not second_rev:
                    overdue = _days_since(first_rev, ref)
                    if overdue >= y:
                        missing_second.append({**base, "first_revision_date": first_rev, "days_overdue": overdue})

    missing_first.sort(key=lambda row: row.get("days_overdue", 0), reverse=True)
    missing_second.sort(key=lambda row: row.get("days_overdue", 0), reverse=True)
    return {
        "user_id": uid,
        "reference_date": ref,
        "x_days": x,
        "y_days": y,
        "counts": {
            "not_started": len(not_started),
            "missing_first_revision": len(missing_first),
            "missing_second_revision": len(missing_second),
        },
        "not_started": not_started,
        "missing_first_revision": missing_first,
        "missing_second_revision": missing_second,
    }


def report_revision_gaps_payload(
    user_id: str,
    x_days: int = 7,
    y_days: int = 15,
    limit: int = 200,
    reference_date: str | None = None,
) -> Dict[str, Any]:
    out = _revision_gaps_raw(user_id, x_days=x_days, y_days=y_days, reference_date=reference_date)
    lim = max(1, min(int(limit or 200), 1000))
    out["not_started"] = out["not_started"][:lim]
    out["missing_first_revision"] = out["missing_first_revision"][:lim]
    out["missing_second_revision"] = out["missing_second_revision"][:lim]
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
    uid = (user_id or "").strip().lower()
    if uid not in PLAYERS:
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

    syllabus = build_syllabus_payload(uid)
    all_subjects = {
        str(subject_node.get("subject", "")).strip()
        for exam_node in syllabus.get("exams", [])
        for subject_node in exam_node.get("subjects", [])
        if str(subject_node.get("subject", "")).strip()
    }
    ignored_subjects = sorted(
        [{"subject": s, "activity_count": subject_counts.get(s, 0)} for s in all_subjects if subject_counts.get(s, 0) == 0],
        key=lambda x: x["subject"].lower(),
    )[:5]

    gaps = _revision_gaps_raw(uid, x_days=x_days, y_days=y_days, reference_date=end)

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
        "ignored_subjects": ignored_subjects,
        "revision_gaps_counts": gaps.get("counts", {}),
    }


def recommendations_next_actions_payload(
    user_id: str,
    duration_min: int = 60,
    mode: str = "supportive",
    limit: int = 5,
    x_days: int = 7,
    y_days: int = 15,
) -> Dict[str, Any]:
    uid = (user_id or "").strip().lower()
    if uid not in PLAYERS:
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

    gaps = _revision_gaps_raw(uid, x_days=x_days, y_days=y_days, reference_date=today)
    items: List[Dict[str, Any]] = []

    if gaps["missing_second_revision"]:
        t = gaps["missing_second_revision"][0]
        items.append(
            {
                "type": "revision",
                "priority": 100,
                "eta_min": min(45, duration),
                "title": f"Second revision: {t['subject']} - {t['topic']}",
                "reason": f"Overdue by {t.get('days_overdue', 0)} days",
            }
        )
    if gaps["missing_first_revision"]:
        t = gaps["missing_first_revision"][0]
        items.append(
            {
                "type": "revision",
                "priority": 90,
                "eta_min": min(40, duration),
                "title": f"First revision: {t['subject']} - {t['topic']}",
                "reason": f"Overdue by {t.get('days_overdue', 0)} days",
            }
        )
    if gaps["not_started"]:
        t = gaps["not_started"][0]
        items.append(
            {
                "type": "study",
                "priority": 80,
                "eta_min": min(50, duration),
                "title": f"Start topic: {t['subject']} - {t['topic']}",
                "reason": "Not started yet",
            }
        )
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
    uid = (user_id or "").strip().lower()
    if uid not in PLAYERS:
        raise ValueError("Invalid user_id")
    target_date = _parse_date(date_value, fallback=current_date_str())
    days = max(1, min(int(lookback_days or 14), 365))
    start_date = (datetime.strptime(target_date, "%Y-%m-%d").date() - timedelta(days=days - 1)).isoformat()
    rows = _load_aggregate_docs(uid, start_date, target_date)
    today_row = rows[-1] if rows else refresh_daily_aggregate(uid, target_date)
    mission = get_or_create_mission(uid)
    mission_progress = mission_progress_payload(uid, days)
    revision_gaps = report_revision_gaps_payload(uid, x_days=x_days, y_days=y_days, limit=100, reference_date=target_date)
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
        "mission": mission,
        "mission_progress": mission_progress,
        "revision_gaps": revision_gaps.get("counts", {}),
        "next_actions": recommendations.get("actions", []),
    }


def _parse_types(raw: str | None) -> List[str]:
    if not raw:
        return ["content", "syllabus", "mission", "tests"]
    allowed = {"content", "syllabus", "mission", "tests"}
    out = []
    for token in str(raw).split(","):
        item = token.strip().lower()
        if item in allowed and item not in out:
            out.append(item)
    return out or ["content", "syllabus", "mission", "tests"]


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
    uid = (user_id or "").strip().lower()
    if uid not in PLAYERS:
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
        for row in content_files_collection().find(
            {"status": {"$in": ["ready", "uploading"]}, "name": {"$regex": rx}},
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
            pdf = search_pdf(query, min(10, lim), course)
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

    syllabus_payload = build_syllabus_payload(uid) if requested.intersection({"syllabus", "tests"}) else {"exams": []}
    if "syllabus" in requested:
        for exam_node in syllabus_payload.get("exams", []):
            exam = str(exam_node.get("exam", "") or "")
            for subject_node in exam_node.get("subjects", []):
                subject = str(subject_node.get("subject", "") or "")
                for topic_node in subject_node.get("topics", []):
                    topic = str(topic_node.get("topic", "") or "")
                    blob = f"{exam} {subject} {topic}".lower()
                    if not _contains(blob, ql):
                        continue
                    add_result(
                        {
                            "id": f"syllabus:{exam}:{subject}:{topic}",
                            "type": "syllabus",
                            "score": 88 if topic.lower().startswith(ql) else 72,
                            "title": topic,
                            "subtitle": f"{exam} / {subject}",
                            "meta": {
                                "exam": exam,
                                "subject": subject,
                                "topic": topic,
                                "class_date": topic_node.get("class_study_first_date", ""),
                                "first_revision_date": topic_node.get("first_revision_date", ""),
                                "second_revision_date": topic_node.get("second_revision_date", ""),
                            },
                        }
                    )

    if "tests" in requested:
        for exam_node in syllabus_payload.get("exams", []):
            exam = str(exam_node.get("exam", "") or "")
            for source_node in exam_node.get("tests", []):
                source = str(source_node.get("source", "") or "")
                for test_node in source_node.get("tests", []):
                    test_name = str(test_node.get("test_name", "") or "")
                    test_number = str(test_node.get("test_number", "") or "")
                    blob = f"{exam} {source} {test_name} {test_number}".lower()
                    if not _contains(blob, ql):
                        continue
                    add_result(
                        {
                            "id": f"test:{exam}:{source}:{test_number}:{test_name}",
                            "type": "tests",
                            "score": 84 if test_name.lower().startswith(ql) else 68,
                            "title": test_name or f"Test {test_number}",
                            "subtitle": f"{exam} / {source} / #{test_number}",
                            "meta": {
                                "exam": exam,
                                "source": source,
                                "test_number": test_number,
                                "test_given_date": test_node.get("test_given_date", ""),
                                "analysis_done_date": test_node.get("analysis_done_date", ""),
                                "revision_date": test_node.get("revision_date", ""),
                                "second_revision_date": test_node.get("second_revision_date", ""),
                            },
                        }
                    )

    if "mission" in requested:
        mission = get_or_create_mission(uid)
        plan = mission.get("plan", {}) if isinstance(mission.get("plan"), dict) else {}
        for row in plan.get("courses", []) if isinstance(plan.get("courses"), list) else []:
            course_name = str(row.get("course_name", "") or "")
            subject_name = str(row.get("subject_name", "") or "")
            text = f"{course_name} {subject_name}".lower()
            if _contains(text, ql):
                add_result(
                    {
                        "id": f"mission:course:{course_name}:{subject_name}",
                        "type": "mission",
                        "score": 70,
                        "title": subject_name or course_name,
                        "subtitle": f"Course plan: {course_name}",
                        "meta": row,
                    }
                )
        for row in plan.get("books", []) if isinstance(plan.get("books"), list) else []:
            book_name = str(row.get("book_name", "") or "")
            if _contains(book_name.lower(), ql):
                add_result(
                    {
                        "id": f"mission:book:{book_name}",
                        "type": "mission",
                        "score": 66,
                        "title": book_name,
                        "subtitle": "Book plan",
                        "meta": row,
                    }
                )
        for row in plan.get("random", []) if isinstance(plan.get("random"), list) else []:
            source = str(row.get("source", "") or "")
            topic_name = str(row.get("topic_name", "") or "")
            if _contains(f"{source} {topic_name}".lower(), ql):
                add_result(
                    {
                        "id": f"mission:random:{source}:{topic_name}",
                        "type": "mission",
                        "score": 64,
                        "title": topic_name,
                        "subtitle": f"Random plan: {source}",
                        "meta": row,
                    }
                )

    results.sort(key=lambda row: int(row.get("score", 0)), reverse=True)
    return {
        "q": query,
        "user_id": uid,
        "types": sorted(requested),
        "count": len(results[:lim]),
        "results": results[:lim],
    }


def search_suggest_payload(user_id: str, q: str | None = None, limit: int = 12) -> Dict[str, Any]:
    uid = (user_id or "").strip().lower()
    if uid not in PLAYERS:
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

    syllabus = build_syllabus_payload(uid)
    for exam_node in syllabus.get("exams", []):
        add(str(exam_node.get("exam", "") or ""), "exam", 1)
        for subject_node in exam_node.get("subjects", []):
            add(str(subject_node.get("subject", "") or ""), "subject", 1)
            for topic_node in subject_node.get("topics", []):
                add(str(topic_node.get("topic", "") or ""), "topic", 1)
        for source_node in exam_node.get("tests", []):
            add(str(source_node.get("source", "") or ""), "source", 1)
            for test_node in source_node.get("tests", []):
                add(str(test_node.get("test_name", "") or ""), "test", 1)

    mission_opts = mission_selector_options(uid)
    for opt in mission_opts.get("exam_options", []):
        add(str(opt.get("label", "") or ""), "exam", 1)
    for exam_name, rows in (mission_opts.get("catalog", {}) or {}).items():
        add(str(exam_name), "exam", 1)
        for row in rows:
            add(str(row.get("subject", "") or ""), "subject", 1)
            for topic in row.get("topics", []) if isinstance(row.get("topics"), list) else []:
                add(str(topic), "topic", 1)

    for row in content_files_collection().find({"status": "ready"}, {"name": 1}).sort("updated_at", -1).limit(200):
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
    uid = (user_id or "").strip().lower()
    if uid and uid not in PLAYERS:
        raise ValueError("Invalid user_id")

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

