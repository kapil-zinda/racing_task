from collections import OrderedDict
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List

from pymongo import ASCENDING, DESCENDING

from .constants import ACTION_LABELS, MILESTONES, PLAYERS, POINTS_MAP
from .context import (
    current_date_str,
    day_doc_id,
    events_collection,
    race_collection,
    sessions_collection,
)
from .ledger_domain import log_activity
from .mission_domain import get_active_mission_id, get_or_create_mission

_indexes_ensured = False


def ensure_indexes() -> None:
    global _indexes_ensured
    if _indexes_ensured:
        return

    events = events_collection()
    events.create_index([("date", DESCENDING), ("player_id", ASCENDING), ("created_at", DESCENDING)])
    events.create_index([("player_id", ASCENDING), ("event_type", ASCENDING), ("date", DESCENDING)])
    events.create_index([("player_id", ASCENDING), ("exam", ASCENDING), ("subject", ASCENDING), ("topic", ASCENDING)])
    events.create_index([("player_id", ASCENDING), ("source", ASCENDING), ("test_number", ASCENDING), ("stage", ASCENDING)])

    race = race_collection()
    race.create_index([("date", DESCENDING)], name="date_desc_idx")

    sessions = sessions_collection()
    sessions.create_index([("doc_type", ASCENDING), ("user_id", ASCENDING), ("date", DESCENDING)])
    sessions.create_index([("doc_type", ASCENDING), ("user_id", ASCENDING), ("subject", ASCENDING), ("topic", ASCENDING)])

    _indexes_ensured = True


def default_daily_state_doc_for_date(date_str: str) -> Dict[str, Any]:
    return {
        "_id": day_doc_id(date_str),
        "date": date_str,
        "points": {player: 0 for player in PLAYERS},
        "reached": {player: [] for player in PLAYERS},
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }


def _normalize_points(points: Dict[str, Any] | None) -> Dict[str, int]:
    result = {player: 0 for player in PLAYERS}
    raw = points if isinstance(points, dict) else {}
    for player in PLAYERS:
        value = raw.get(player, 0)
        try:
            result[player] = int(value)
        except (TypeError, ValueError):
            result[player] = 0
    return result


def _reached_from_points(points: Dict[str, int]) -> Dict[str, List[int]]:
    reached = {player: [] for player in PLAYERS}
    for player in PLAYERS:
        for milestone in MILESTONES:
            if points[player] >= milestone["points"]:
                reached[player].append(milestone["points"])
    return reached


def normalize_daily_state(doc: Dict[str, Any]) -> Dict[str, Any]:
    points = _normalize_points(doc.get("points"))
    reached = doc.get("reached") if isinstance(doc.get("reached"), dict) else {}
    out_reached = {player: [] for player in PLAYERS}
    for player in PLAYERS:
        marks = reached.get(player, []) if isinstance(reached.get(player), list) else []
        out_reached[player] = [m for m in marks if isinstance(m, int)]

    if not any(out_reached[player] for player in PLAYERS):
        out_reached = _reached_from_points(points)

    return {
        "_id": doc.get("_id", ""),
        "date": doc.get("date", ""),
        "points": points,
        "reached": out_reached,
        "updated_at": doc.get("updated_at", ""),
    }


def date_only(value: str) -> str:
    if not isinstance(value, str) or not value:
        return ""
    return value[:10]


def append_unique(items: List[str], value: str) -> None:
    if value and value not in items:
        items.append(value)


def sort_dates(values: List[str]) -> List[str]:
    return sorted([v for v in values if isinstance(v, str) and v])


def parse_detail_fields(detail: str) -> Dict[str, str]:
    result: Dict[str, str] = {}
    if not isinstance(detail, str):
        return result
    for chunk in [part.strip() for part in detail.split("|")]:
        if ":" not in chunk:
            continue
        key, value = chunk.split(":", 1)
        result[key.strip().lower()] = value.strip()
    return result


def _event_fields_from_detail(detail: str) -> Dict[str, str]:
    parsed = parse_detail_fields(detail)
    stage = (parsed.get("stage") or "").strip().lower().replace(" ", "_")
    if stage not in {"test_given", "analysis_done", "revision", "second_revision"}:
        stage = ""

    return {
        "exam": (parsed.get("exam") or "").strip(),
        "subject": (parsed.get("subject") or "").strip(),
        "topic": (parsed.get("topic") or "").strip(),
        "note": (parsed.get("note") or "").strip(),
        "work_type": (parsed.get("work") or parsed.get("work_type") or "").strip().lower(),
        "source": (parsed.get("source") or "").strip(),
        "org": (parsed.get("org") or "").strip(),
        "test_number": (
            parsed.get("test number")
            or parsed.get("test_number")
            or ""
        ).strip(),
        "test_name": (parsed.get("test") or parsed.get("test_name") or "").strip(),
        "stage": stage,
    }


def _has_events_for_date(date_str: str) -> bool:
    return events_collection().count_documents({"date": date_str}, limit=1) > 0


def _aggregate_points_for_date(date_str: str) -> Dict[str, int]:
    points = {player: 0 for player in PLAYERS}
    pipeline = [
        {"$match": {"date": date_str}},
        {"$group": {"_id": "$player_id", "points": {"$sum": "$points"}}},
    ]
    for row in events_collection().aggregate(pipeline):
        player = row.get("_id")
        if player in points:
            points[player] = int(row.get("points", 0) or 0)
    return points


def _history_for_date(date_str: str) -> Dict[str, List[Dict[str, Any]]]:
    history = {player: [] for player in PLAYERS}
    cursor = events_collection().find({"date": date_str}).sort("created_at", -1)
    for event in cursor:
        player = event.get("player_id")
        if player not in history:
            continue
        history[player].append(
            {
                "action_type": event.get("event_type", ""),
                "action_label": event.get("action_label", ""),
                "detail": event.get("detail", ""),
                "points": int(event.get("points", 0) or 0),
                "created_at": event.get("created_at", ""),
            }
        )
    return history


def _upsert_daily_state(date_str: str, points: Dict[str, int]) -> Dict[str, Any]:
    doc = {
        "_id": day_doc_id(date_str),
        "date": date_str,
        "points": _normalize_points(points),
        "reached": _reached_from_points(_normalize_points(points)),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    race_collection().update_one({"_id": doc["_id"]}, {"$set": doc}, upsert=True)
    return doc


def _get_daily_state(date_str: str, persist_if_missing: bool) -> Dict[str, Any]:
    ensure_indexes()
    has_events = _has_events_for_date(date_str)
    if has_events:
        points = _aggregate_points_for_date(date_str)
        return _upsert_daily_state(date_str, points)

    existing = race_collection().find_one({"_id": day_doc_id(date_str)})
    if existing:
        return normalize_daily_state(existing)

    if persist_if_missing:
        return _upsert_daily_state(date_str, {player: 0 for player in PLAYERS})

    return default_daily_state_doc_for_date(date_str)


def winner_counts() -> Dict[str, int]:
    ensure_indexes()
    counts = {"kapil": 0, "divya": 0, "tie": 0}

    race_dates = set(
        d for d in race_collection().distinct("date") if isinstance(d, str) and d
    )
    event_dates = set(
        d for d in events_collection().distinct("date") if isinstance(d, str) and d
    )
    all_dates = sorted(race_dates | event_dates)

    for date_str in all_dates:
        points = _aggregate_points_for_date(date_str)
        if not _has_events_for_date(date_str):
            doc = race_collection().find_one({"_id": day_doc_id(date_str)})
            points = _normalize_points((doc or {}).get("points", {}))

        kapil_points = points.get("kapil", 0)
        divya_points = points.get("divya", 0)
        if kapil_points > divya_points:
            counts["kapil"] += 1
        elif divya_points > kapil_points:
            counts["divya"] += 1
        else:
            counts["tie"] += 1

    return counts


def available_dates() -> List[str]:
    ensure_indexes()
    race_dates = set(
        d for d in race_collection().distinct("date") if isinstance(d, str) and d
    )
    event_dates = set(
        d for d in events_collection().distinct("date") if isinstance(d, str) and d
    )
    return sorted(race_dates | event_dates, reverse=True)


def ensure_exam_node(tree: "OrderedDict[str, Dict[str, Any]]", exam: str) -> Dict[str, Any]:
    exam_key = (exam or "General").strip() or "General"
    if exam_key not in tree:
        tree[exam_key] = {
            "exam": exam_key,
            "subjects": OrderedDict(),
            "tests": OrderedDict(),
            "tickets": OrderedDict(),
        }
    return tree[exam_key]


def ensure_topic_node(exam_node: Dict[str, Any], subject: str, topic: str) -> Dict[str, Any]:
    subject_key = (subject or "General").strip() or "General"
    topic_key = (topic or "General").strip() or "General"
    subjects = exam_node["subjects"]
    if subject_key not in subjects:
        subjects[subject_key] = {"subject": subject_key, "topics": OrderedDict()}
    topic_map = subjects[subject_key]["topics"]
    if topic_key not in topic_map:
        topic_map[topic_key] = {
            "topic": topic_key,
            "class_study_dates": [],
            "revision_dates": [],
            "revision_limit": 5,
            "note_dates": [],
            "notes": [],
            "recording_dates": [],
            "recordings": [],
        }
    return topic_map[topic_key]


def find_exam_for_subject_topic(tree: "OrderedDict[str, Dict[str, Any]]", subject: str, topic: str) -> str:
    subject_key = (subject or "").strip()
    topic_key = (topic or "").strip()
    for exam_key, exam_node in tree.items():
        subject_node = exam_node.get("subjects", {}).get(subject_key)
        if not subject_node:
            continue
        if topic_key in subject_node.get("topics", {}):
            return exam_key
    return "General"


def _norm_key(value: str) -> str:
    return (value or "").strip().lower()


def _build_revision_limits(user_id: str) -> Dict[str, Dict[str, int]]:
    mission = get_or_create_mission(user_id)
    plan = mission.get("plan", {}) if isinstance(mission.get("plan"), dict) else {}
    courses = plan.get("courses", []) if isinstance(plan.get("courses"), list) else []
    books = plan.get("books", []) if isinstance(plan.get("books"), list) else []
    random_rows = plan.get("random", []) if isinstance(plan.get("random"), list) else []

    course_limits: Dict[str, int] = {}
    for row in courses:
        if not isinstance(row, dict):
            continue
        course_name = _norm_key(str(row.get("course_name") or ""))
        subject_name = _norm_key(str(row.get("subject_name") or ""))
        if not course_name or not subject_name:
            continue
        try:
            revision_count = max(0, min(5, int(row.get("revision_count", 1) or 1)))
        except (TypeError, ValueError):
            revision_count = 1
        course_limits[f"{course_name}||{subject_name}"] = revision_count

    book_limits: Dict[str, int] = {}
    for row in books:
        if not isinstance(row, dict):
            continue
        book_name = _norm_key(str(row.get("book_name") or ""))
        if not book_name:
            continue
        try:
            revision_count = max(0, min(5, int(row.get("revision_count", 1) or 1)))
        except (TypeError, ValueError):
            revision_count = 1
        book_limits[book_name] = revision_count

    random_limits: Dict[str, int] = {}
    for row in random_rows:
        if not isinstance(row, dict):
            continue
        source_name = _norm_key(str(row.get("source") or ""))
        topic_name = _norm_key(str(row.get("topic_name") or ""))
        if not source_name or not topic_name:
            continue
        try:
            revision_count = max(0, min(5, int(row.get("revision_count", 1) or 1)))
        except (TypeError, ValueError):
            revision_count = 1
        random_limits[f"{source_name}||{topic_name}"] = revision_count

    return {
        "course": course_limits,
        "book": book_limits,
        "random": random_limits,
    }


def _topic_revision_limit(exam: str, subject: str, topic: str, limits: Dict[str, Dict[str, int]]) -> int:
    exam_key = _norm_key(exam)
    subject_key = _norm_key(subject)
    topic_key = _norm_key(topic)

    if exam_key.startswith("random:"):
        value = limits.get("random", {}).get(f"{subject_key}||{topic_key}")
        if isinstance(value, int):
            return max(0, min(5, value))

    if exam_key.startswith("book:"):
        value = limits.get("book", {}).get(subject_key)
        if isinstance(value, int):
            return max(0, min(5, value))

    value = limits.get("course", {}).get(f"{exam_key}||{subject_key}")
    if isinstance(value, int):
        return max(0, min(5, value))
    return 5


def build_syllabus_payload(user_id: str) -> Dict[str, Any]:
    ensure_indexes()
    tree: "OrderedDict[str, Dict[str, Any]]" = OrderedDict()
    revision_limits = _build_revision_limits(user_id)
    test_recordings_by_source_number: Dict[str, Dict[str, List[Dict[str, Any]]]] = {}
    test_recordings_by_source_name: Dict[str, Dict[str, List[Dict[str, Any]]]] = {}

    event_cursor = events_collection().find({"player_id": user_id}).sort("created_at", ASCENDING)
    for event in event_cursor:
        action_type = event.get("event_type", "")
        created_date = event.get("date") or date_only(event.get("created_at", ""))
        detail = event.get("detail", "") or ""
        fields = event.get("fields") if isinstance(event.get("fields"), dict) else _event_fields_from_detail(detail)

        exam = (fields.get("exam") or "General").strip() or "General"
        subject = (fields.get("subject") or "General").strip() or "General"
        topic = (fields.get("topic") or "General").strip() or "General"
        note = (fields.get("note") or "").strip()
        work_type = (fields.get("work_type") or "").strip().lower()

        if action_type in {"new_class", "revision"}:
            topic_node = ensure_topic_node(ensure_exam_node(tree, exam), subject, topic)
            revision_limit = _topic_revision_limit(exam, subject, topic, revision_limits)
            topic_node["revision_limit"] = revision_limit
            if action_type == "new_class":
                append_unique(topic_node["class_study_dates"], created_date)
            else:
                # Revision progression is event-order based:
                # 1st revision event -> first revision, 2nd -> second revision.
                # Keep duplicate dates as separate entries so same-day two revisions are counted.
                # Cap tracked revisions at 5. Beyond this, points can still be counted from events,
                # but syllabus progression won't add extra revision entries.
                if created_date and len(topic_node["revision_dates"]) < max(0, revision_limit):
                    topic_node["revision_dates"].append(created_date)
            if action_type == "new_class" and work_type == "notes":
                append_unique(topic_node["note_dates"], created_date)
            if note:
                append_unique(topic_node["notes"], note)
            continue

        if action_type == "test_completed":
            exam_node = ensure_exam_node(tree, exam)
            source = (fields.get("source") or "General").strip() or "General"
            test_number = (fields.get("test_number") or "1").strip() or "1"
            stage_raw = (fields.get("stage") or "test_given").strip().lower().replace(" ", "_")
            if stage_raw not in {"test_given", "analysis_done", "revision", "second_revision"}:
                stage_raw = "test_given"
            test_note = (fields.get("note") or "").strip()
            test_name = (fields.get("test_name") or "").strip()

            if source not in exam_node["tests"]:
                exam_node["tests"][source] = OrderedDict()
            if test_number not in exam_node["tests"][source]:
                exam_node["tests"][source][test_number] = {
                    "test_name": test_name,
                    "test_number": test_number,
                    "note": test_note,
                    "test_given_date": "",
                    "analysis_done_date": "",
                    "revision_date": "",
                    "second_revision_date": "",
                }
            entry = exam_node["tests"][source][test_number]
            if test_name:
                entry["test_name"] = test_name
            if test_note:
                entry["note"] = test_note
            if stage_raw == "test_given":
                entry["test_given_date"] = entry["test_given_date"] or created_date
            elif stage_raw == "analysis_done":
                entry["analysis_done_date"] = entry["analysis_done_date"] or created_date
            elif stage_raw == "revision":
                if not entry.get("revision_date"):
                    entry["revision_date"] = created_date
                elif not entry.get("second_revision_date"):
                    entry["second_revision_date"] = created_date
            else:
                entry["second_revision_date"] = entry["second_revision_date"] or created_date
            continue

        if action_type == "ticket_resolved":
            exam_node = ensure_exam_node(tree, exam)
            org = (fields.get("org") or fields.get("source") or "General").strip() or "General"
            note_value = (fields.get("note") or "").strip() or detail.strip() or "Ticket resolved"
            if org not in exam_node["tickets"]:
                exam_node["tickets"][org] = []
            exam_node["tickets"][org].append({"note": note_value, "date": created_date})

    sessions = sessions_collection().find({"doc_type": "study_session", "user_id": user_id})
    for session in sessions:
        uploads = session.get("uploads", {}) or {}
        has_recording = any(
            isinstance(info, dict) and (info.get("key") or info.get("object_url"))
            for info in uploads.values()
        )
        if not has_recording:
            continue

        subject = (session.get("subject") or "General").strip() or "General"
        topic = (session.get("topic") or "General").strip() or "General"
        rec_date = (
            date_only(session.get("stopped_at", ""))
            or date_only(session.get("updated_at", ""))
            or date_only(session.get("created_at", ""))
            or session.get("date", "")
        )
        append_unique(topic_node["recording_dates"], rec_date)
        recording_entry = {
            "note": (session.get("notes") or "").strip(),
            "date": rec_date,
            "session_id": session.get("_id", ""),
            "media_types": [],
            "default_media_type": "",
        }
        for mt in ("video", "screen", "audio", "attachment"):
            info = uploads.get(mt)
            if isinstance(info, dict) and (info.get("key") or info.get("object_url")):
                recording_entry["media_types"].append(mt)
        recording_entry["default_media_type"] = (
            recording_entry["media_types"][0] if recording_entry["media_types"] else ""
        )

        test_ref = session.get("test_ref") if isinstance(session.get("test_ref"), dict) else {}
        test_source = (test_ref.get("source") or "").strip()
        test_name = (test_ref.get("test_name") or "").strip()
        test_number = str(test_ref.get("test_number") or "").strip()
        if test_source:
            if test_number:
                test_recordings_by_source_number.setdefault(test_source, {}).setdefault(test_number, []).append(recording_entry)
            if test_name:
                test_recordings_by_source_name.setdefault(test_source, {}).setdefault(test_name.lower(), []).append(recording_entry)
            continue

        exam = find_exam_for_subject_topic(tree, subject, topic)
        topic_node = ensure_topic_node(ensure_exam_node(tree, exam), subject, topic)
        key = f"{recording_entry['note']}::{recording_entry['date']}::{recording_entry['session_id']}"
        seen = {
            f"{(r.get('note') or '').strip()}::{r.get('date', '')}::{r.get('session_id', '')}"
            for r in topic_node["recordings"]
        }
        if key not in seen:
            topic_node["recordings"].append(recording_entry)

    exams: List[Dict[str, Any]] = []
    for exam_key, exam_node in tree.items():
        subjects_out: List[Dict[str, Any]] = []
        for subject_key, subject_node in exam_node["subjects"].items():
            topics_out: List[Dict[str, Any]] = []
            for topic_key, topic_node in subject_node["topics"].items():
                class_dates = sort_dates(topic_node.get("class_study_dates", []))
                revision_dates = sort_dates(topic_node.get("revision_dates", []))
                note_dates = sort_dates(topic_node.get("note_dates", []))
                recording_dates = sort_dates(topic_node.get("recording_dates", []))
                recordings = sorted(
                    [r for r in topic_node.get("recordings", []) if isinstance(r, dict)],
                    key=lambda item: item.get("date", ""),
                )
                topics_out.append(
                    {
                        "topic": topic_key,
                        "class_study_first_date": class_dates[0] if class_dates else "",
                        "first_revision_date": revision_dates[0] if len(revision_dates) > 0 else "",
                        "second_revision_date": revision_dates[1] if len(revision_dates) > 1 else "",
                        "third_revision_date": revision_dates[2] if len(revision_dates) > 2 else "",
                        "fourth_revision_date": revision_dates[3] if len(revision_dates) > 3 else "",
                        "fifth_revision_date": revision_dates[4] if len(revision_dates) > 4 else "",
                        "revision_dates": revision_dates,
                        "revision_count": len(revision_dates),
                        "revision_limit": int(topic_node.get("revision_limit", 5) or 5),
                        "note_first_date": note_dates[0] if note_dates else "",
                        "note_dates": note_dates,
                        "recording_dates": recording_dates,
                        "recordings": recordings,
                        "notes": topic_node.get("notes", []),
                    }
                )
            subjects_out.append({"subject": subject_key, "topics": sorted(topics_out, key=lambda item: item["topic"].lower())})

        tests_out: List[Dict[str, Any]] = []
        for source, tests_map in exam_node["tests"].items():
            test_items: List[Dict[str, Any]] = []
            for test_number, test_node in tests_map.items():
                source_recordings_by_number = test_recordings_by_source_number.get(source, {})
                source_recordings_by_name = test_recordings_by_source_name.get(source, {})
                linked_recordings = source_recordings_by_number.get(str(test_number), [])
                if not linked_recordings:
                    linked_recordings = source_recordings_by_name.get((test_node.get("test_name") or "").strip().lower(), [])
                test_items.append(
                    {
                        "test_name": test_node.get("test_name", ""),
                        "test_number": str(test_number),
                        "note": test_node.get("note", ""),
                        "test_given_date": test_node.get("test_given_date", ""),
                        "analysis_done_date": test_node.get("analysis_done_date", ""),
                        "revision_date": test_node.get("revision_date", ""),
                        "second_revision_date": test_node.get("second_revision_date", ""),
                        "recordings": linked_recordings,
                    }
                )
            tests_out.append(
                {
                    "source": source,
                    "tests": sorted(
                        test_items,
                        key=lambda item: (0, int(item["test_number"]))
                        if str(item["test_number"]).isdigit()
                        else (1, str(item["test_number"]).lower()),
                    ),
                }
            )

        tickets_out: List[Dict[str, Any]] = []
        for org, ticket_rows in exam_node.get("tickets", {}).items():
            rows = sorted(
                [row for row in ticket_rows if isinstance(row, dict)],
                key=lambda item: item.get("date", ""),
                reverse=True,
            )
            tickets_out.append({"org": org, "tickets": rows})

        exams.append(
            {
                "exam": exam_key,
                "subjects": sorted(subjects_out, key=lambda item: item["subject"].lower()),
                "tests": sorted(tests_out, key=lambda item: item["source"].lower()),
                "tickets": sorted(tickets_out, key=lambda item: item["org"].lower()),
            }
        )

    exams = sorted(exams, key=lambda item: item["exam"].lower())
    return {"user_id": user_id, "generated_at": datetime.now(timezone.utc).isoformat(), "exams": exams}


def get_state_payload(date: str | None) -> Dict[str, Any]:
    today = current_date_str()
    selected_date = date or today
    editable = selected_date == today

    state = _get_daily_state(selected_date, persist_if_missing=editable)
    history = _history_for_date(selected_date)

    return {
        "date": selected_date,
        "today": today,
        "editable": editable,
        "points": _normalize_points(state.get("points", {})),
        "reached": state.get("reached", _reached_from_points(_normalize_points(state.get("points", {})))),
        "history": history,
        "milestones": MILESTONES,
        "winner_counts": winner_counts(),
    }


def get_days_payload() -> Dict[str, Any]:
    today = current_date_str()
    _get_daily_state(today, persist_if_missing=True)

    dates = available_dates()
    if today not in dates:
        dates = [today] + dates

    return {"today": today, "dates": sorted(set(dates), reverse=True), "winner_counts": winner_counts()}


def build_mission_control_payload(user_id: str, lookback_days: int = 90) -> Dict[str, Any]:
    ensure_indexes()
    capped_lookback = max(14, min(int(lookback_days or 90), 365))
    today = current_date_str()
    start_date = (datetime.strptime(today, "%Y-%m-%d") - timedelta(days=capped_lookback - 1)).strftime("%Y-%m-%d")

    pipeline = [
        {
            "$match": {
                "player_id": user_id,
                "date": {"$gte": start_date, "$lte": today},
            }
        },
        {
            "$group": {
                "_id": {"date": "$date", "event_type": "$event_type"},
                "count": {"$sum": 1},
            }
        },
    ]

    activity_by_date: Dict[str, Dict[str, int]] = {}
    for row in events_collection().aggregate(pipeline):
        key = row.get("_id", {})
        date_key = key.get("date", "")
        event_type = key.get("event_type", "")
        if not date_key:
            continue
        if date_key not in activity_by_date:
            activity_by_date[date_key] = {"study": 0, "revision": 0, "practice": 0}
        if event_type == "new_class":
            activity_by_date[date_key]["study"] += int(row.get("count", 0) or 0)
        elif event_type == "revision":
            activity_by_date[date_key]["revision"] += int(row.get("count", 0) or 0)
        elif event_type in {"test_completed", "ticket_resolved"}:
            activity_by_date[date_key]["practice"] += int(row.get("count", 0) or 0)

    return {
        "user_id": user_id,
        "today": today,
        "lookback_days": capped_lookback,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "syllabus": build_syllabus_payload(user_id),
        "activity_by_date": activity_by_date,
    }


def add_points_payload(player_id: str, action_type: str, test_type: str, detail: str) -> Dict[str, Any]:
    ensure_indexes()
    today = current_date_str()
    created_at = datetime.now(timezone.utc).isoformat()

    action_label = ACTION_LABELS[action_type]
    clean_test_type = (test_type or "").strip()
    clean_detail = (detail or "").strip()
    if action_type == "test_completed" and clean_test_type:
        action_label = clean_test_type

    fields = _event_fields_from_detail(clean_detail)

    event_doc = {
        "doc_type": "race_event",
        "date": today,
        "player_id": player_id,
        "event_type": action_type,
        "action_label": action_label,
        "detail": clean_detail or action_label,
        "points": POINTS_MAP[action_type],
        "created_at": created_at,
        "exam": fields.get("exam", ""),
        "subject": fields.get("subject", ""),
        "topic": fields.get("topic", ""),
        "source": fields.get("source", ""),
        "org": fields.get("org", ""),
        "test_number": fields.get("test_number", ""),
        "test_name": fields.get("test_name", ""),
        "stage": fields.get("stage", ""),
        "note": fields.get("note", ""),
        "fields": fields,
    }
    events_collection().insert_one(event_doc)
    mission_id = get_active_mission_id(player_id)
    log_activity(
        player_id,
        f"points_{action_type}",
        points=POINTS_MAP[action_type],
        count=1,
        mission_id=mission_id,
        created_at=created_at,
        meta={
            "event_type": action_type,
            "exam": fields.get("exam", ""),
            "subject": fields.get("subject", ""),
            "topic": fields.get("topic", ""),
            "source": fields.get("source", ""),
            "test_name": fields.get("test_name", ""),
            "org": fields.get("org", ""),
            "stage": fields.get("stage", ""),
        },
    )

    points = _aggregate_points_for_date(today)
    daily_state = _upsert_daily_state(today, points)
    history = _history_for_date(today)

    return {
        "message": "Points updated",
        "date": today,
        "editable": True,
        "points": daily_state["points"],
        "reached": daily_state["reached"],
        "history": history,
        "winner_counts": winner_counts(),
    }


def reset_race_payload() -> Dict[str, Any]:
    ensure_indexes()
    today = current_date_str()
    events_collection().delete_many({"date": today})

    zero_points = {player: 0 for player in PLAYERS}
    daily_state = _upsert_daily_state(today, zero_points)
    history = {player: [] for player in PLAYERS}

    return {
        "message": "Race reset",
        "date": today,
        "editable": True,
        "points": daily_state["points"],
        "reached": daily_state["reached"],
        "history": history,
        "winner_counts": winner_counts(),
    }
