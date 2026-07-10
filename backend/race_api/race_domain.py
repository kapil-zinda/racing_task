from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List

from pymongo import ASCENDING, DESCENDING

from .constants import ACTION_LABELS, MILESTONES, PLAYERS, POINTS_MAP
from .context import (
    activity_ledger_collection,
    current_date_str,
    day_doc_id,
    events_collection,
    race_collection,
    sessions_collection,
)
from .ledger_domain import log_activity

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


def _canonicalize_event_fields(user_id: str, fields: Dict[str, str], cache: Dict[str, Dict[str, Dict[str, set[str]]]]) -> Dict[str, str]:
    # No catalog to canonicalize against (mission/syllabus removed) — pass fields through as-is.
    return fields


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
    catalog_cache: Dict[str, Dict[str, Dict[str, set[str]]]] = {}
    cursor = events_collection().find({"date": date_str}).sort("created_at", -1)
    for event in cursor:
        player = event.get("player_id")
        if player not in history:
            continue
        detail = event.get("detail", "")
        action_type = event.get("event_type", "")
        if action_type in {"new_class", "revision"}:
            raw_fields = event.get("fields") if isinstance(event.get("fields"), dict) else _event_fields_from_detail(detail)
            original_exam = (raw_fields.get("exam") or "").strip().lower()
            fixed_fields = _canonicalize_event_fields(player, raw_fields, catalog_cache)
            remapped_exam = (fixed_fields.get("exam") or "").strip().lower()
            if original_exam and remapped_exam and original_exam != remapped_exam:
                # Skip legacy cross-bucket mixed entries in timeline rendering.
                continue
            exam = (fixed_fields.get("exam") or "").strip()
            subject = (fixed_fields.get("subject") or "").strip()
            topic = (fixed_fields.get("topic") or "").strip()
            note = (fixed_fields.get("note") or "").strip()
            work = (fixed_fields.get("work_type") or "").strip().lower()
            if exam and subject and topic:
                if action_type == "new_class":
                    detail = f"exam:{exam} | subject:{subject} | topic:{topic} | work:{work or 'study'}"
                else:
                    detail = f"exam:{exam} | subject:{subject} | topic:{topic}"
                if note:
                    detail = f"{detail} | note:{note}"
        history[player].append(
            {
                "event_id": str(event.get("_id", "")),
                "action_type": action_type,
                "action_label": event.get("action_label", ""),
                "detail": detail,
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
        "test_name": fields.get("test_name", ""),
        "stage": fields.get("stage", ""),
        "note": fields.get("note", ""),
        "fields": fields,
    }
    events_collection().insert_one(event_doc)
    event_id = str(event_doc.get("_id", ""))
    log_activity(
        player_id,
        f"points_{action_type}",
        points=POINTS_MAP[action_type],
        count=1,
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
            "race_event_id": event_id,
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


def _delete_ledger_for_race_event(event_doc: Dict[str, Any]) -> None:
    event_id = str(event_doc.get("_id", ""))
    if not event_id:
        return
    coll = activity_ledger_collection()
    # Preferred path for newer events (direct linkage by race_event_id).
    result = coll.delete_many({"meta.race_event_id": event_id})
    if (result.deleted_count or 0) > 0:
        return
    # Backward-compatible fallback for old events without race_event_id link.
    player = str(event_doc.get("player_id", "")).strip().lower()
    event_type = str(event_doc.get("event_type", "")).strip().lower()
    created_at = str(event_doc.get("created_at", "")).strip()
    if not player or not event_type or not created_at:
        return
    coll.delete_many(
        {
            "user_id": player,
            "activity_type": f"points_{event_type}",
            "created_at": created_at,
        }
    )


def delete_points_event_payload(event_id: str) -> Dict[str, Any]:
    ensure_indexes()
    eid = (event_id or "").strip()
    if not eid:
        raise ValueError("event_id is required")
    from bson import ObjectId

    try:
        oid = ObjectId(eid)
    except Exception as err:  # noqa: BLE001
        raise ValueError("Invalid event_id") from err

    doc = events_collection().find_one({"_id": oid, "doc_type": "race_event"})
    if not doc:
        raise LookupError("Event not found")
    today = current_date_str()
    event_date = str(doc.get("date") or "").strip()
    if event_date != today:
        raise ValueError("Only today's entries can be deleted")

    events_collection().delete_one({"_id": oid})
    _delete_ledger_for_race_event(doc)

    points = _aggregate_points_for_date(today)
    daily_state = _upsert_daily_state(today, points)
    history = _history_for_date(today)
    return {
        "message": "Entry deleted",
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
