from collections import OrderedDict
from datetime import datetime, timezone
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
    if stage not in {"test_given", "revision", "second_revision"}:
        stage = ""

    return {
        "exam": (parsed.get("exam") or "").strip(),
        "subject": (parsed.get("subject") or "").strip(),
        "topic": (parsed.get("topic") or "").strip(),
        "note": (parsed.get("note") or "").strip(),
        "source": (parsed.get("source") or "").strip(),
        "org": (parsed.get("org") or "").strip(),
        "test_number": (
            parsed.get("test number")
            or parsed.get("test_number")
            or parsed.get("test")
            or ""
        ).strip(),
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


def build_syllabus_payload(user_id: str) -> Dict[str, Any]:
    ensure_indexes()
    tree: "OrderedDict[str, Dict[str, Any]]" = OrderedDict()

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

        if action_type in {"new_class", "revision"}:
            topic_node = ensure_topic_node(ensure_exam_node(tree, exam), subject, topic)
            if action_type == "new_class":
                append_unique(topic_node["class_study_dates"], created_date)
            else:
                append_unique(topic_node["revision_dates"], created_date)
            if note:
                append_unique(topic_node["notes"], note)
            continue

        if action_type == "test_completed":
            exam_node = ensure_exam_node(tree, exam)
            source = (fields.get("source") or "General").strip() or "General"
            test_number = (fields.get("test_number") or "1").strip() or "1"
            stage_raw = (fields.get("stage") or "test_given").strip().lower().replace(" ", "_")
            if stage_raw not in {"test_given", "revision", "second_revision"}:
                stage_raw = "test_given"
            test_note = (fields.get("note") or "").strip()

            if source not in exam_node["tests"]:
                exam_node["tests"][source] = OrderedDict()
            if test_number not in exam_node["tests"][source]:
                exam_node["tests"][source][test_number] = {
                    "test_number": test_number,
                    "note": test_note,
                    "test_given_date": "",
                    "revision_date": "",
                    "second_revision_date": "",
                }
            entry = exam_node["tests"][source][test_number]
            if test_note:
                entry["note"] = test_note
            if stage_raw == "test_given":
                entry["test_given_date"] = entry["test_given_date"] or created_date
            elif stage_raw == "revision":
                entry["revision_date"] = entry["revision_date"] or created_date
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
        subject = (session.get("subject") or "General").strip() or "General"
        topic = (session.get("topic") or "General").strip() or "General"
        exam = find_exam_for_subject_topic(tree, subject, topic)
        topic_node = ensure_topic_node(ensure_exam_node(tree, exam), subject, topic)

        uploads = session.get("uploads", {}) or {}
        has_recording = any(
            isinstance(info, dict) and (info.get("key") or info.get("object_url"))
            for info in uploads.values()
        )
        if not has_recording:
            continue

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
                test_items.append(
                    {
                        "test_number": str(test_number),
                        "note": test_node.get("note", ""),
                        "test_given_date": test_node.get("test_given_date", ""),
                        "revision_date": test_node.get("revision_date", ""),
                        "second_revision_date": test_node.get("second_revision_date", ""),
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
        "stage": fields.get("stage", ""),
        "note": fields.get("note", ""),
        "fields": fields,
    }
    events_collection().insert_one(event_doc)

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
