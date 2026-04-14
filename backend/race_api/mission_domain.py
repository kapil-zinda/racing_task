from datetime import datetime, timedelta, timezone
import re
from typing import Any, Dict, List

from pymongo import ASCENDING

from .constants import PLAYERS
from .context import missions_collection
from .ledger_domain import mission_window_summary

_mission_indexes_ensured = False


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _mission_id(user_id: str) -> str:
    return f"mission:{user_id}"


def _default_target_date() -> str:
    return (datetime.now(timezone.utc) + timedelta(days=120)).date().isoformat()


def _default_mission(user_id: str) -> Dict[str, Any]:
    return {
        "_id": _mission_id(user_id),
        "user_id": user_id,
        "title": "UPSC Selection Mission",
        "target_date": _default_target_date(),
        "status": "active",
        "weights": {
            "study": 30,
            "revision": 30,
            "practice": 25,
            "sessions": 10,
            "extras": 5,
        },
        "targets": {
            "study_count": 120,
            "revision_count": 120,
            "practice_count": 80,
            "session_minutes": 6000,
            "extras_positive_minutes": 1200,
        },
        "plan": {
            "courses": [],
            "books": [],
            "random": [],
            "tests": [],
        },
        "created_at": _now(),
        "updated_at": _now(),
    }


def ensure_mission_indexes() -> None:
    global _mission_indexes_ensured
    if _mission_indexes_ensured:
        return
    coll = missions_collection()
    coll.create_index([("user_id", ASCENDING)], unique=True)
    _mission_indexes_ensured = True


def _normalize_user(user_id: str) -> str:
    uid = (user_id or "").strip().lower()
    if uid not in PLAYERS:
        raise ValueError("Invalid user_id")
    return uid


def _normalize_weights(raw: Dict[str, Any] | None) -> Dict[str, int]:
    base = _default_mission("kapil")["weights"]
    out: Dict[str, int] = {}
    source = raw if isinstance(raw, dict) else {}
    for key, default_value in base.items():
        try:
            out[key] = max(0, int(source.get(key, default_value)))
        except (TypeError, ValueError):
            out[key] = int(default_value)
    total = sum(out.values()) or 1
    if total != 100:
        # Normalize to 100 while preserving rough distribution.
        normalized: Dict[str, int] = {}
        running = 0
        keys = list(out.keys())
        for key in keys[:-1]:
            value = int(round((out[key] / total) * 100))
            normalized[key] = value
            running += value
        normalized[keys[-1]] = max(0, 100 - running)
        return normalized
    return out


def _normalize_targets(raw: Dict[str, Any] | None) -> Dict[str, int]:
    base = _default_mission("kapil")["targets"]
    out: Dict[str, int] = {}
    source = raw if isinstance(raw, dict) else {}
    for key, default_value in base.items():
        try:
            out[key] = max(1, int(source.get(key, default_value)))
        except (TypeError, ValueError):
            out[key] = int(default_value)
    return out


def _slug(value: str) -> str:
    text = re.sub(r"[^a-z0-9]+", "_", (value or "").strip().lower())
    return text.strip("_") or "general"


def _normalize_plan(raw: Dict[str, Any] | None) -> Dict[str, List[Dict[str, Any]]]:
    source = raw if isinstance(raw, dict) else {}
    courses_in = source.get("courses", [])
    books_in = source.get("books", [])
    random_in = source.get("random", [])
    tests_in = source.get("tests", [])

    courses: List[Dict[str, Any]] = []
    if isinstance(courses_in, list):
        for row in courses_in:
            if not isinstance(row, dict):
                continue
            course_name = str(row.get("course_name") or "").strip()
            subject_name_raw = str(row.get("subject_name") or "").strip()
            subject_names = [s.strip() for s in subject_name_raw.split(",") if s.strip()]
            if not course_name or not subject_names:
                continue
            try:
                class_count = max(1, int(row.get("class_count", 1) or 1))
            except (TypeError, ValueError):
                class_count = 1
            try:
                revision_count = max(0, int(row.get("revision_count", 1) or 1))
            except (TypeError, ValueError):
                revision_count = 1
            revision_count = min(5, revision_count)
            for subject_name in subject_names:
                courses.append(
                    {
                        "course_name": course_name,
                        "subject_name": subject_name,
                        "class_count": class_count,
                        "revision_count": revision_count,
                    }
                )

    books: List[Dict[str, Any]] = []
    if isinstance(books_in, list):
        for row in books_in:
            if not isinstance(row, dict):
                continue
            book_name = str(row.get("book_name") or "").strip()
            if not book_name:
                continue
            try:
                chapter_count = max(1, int(row.get("chapter_count", 1) or 1))
            except (TypeError, ValueError):
                chapter_count = 1
            try:
                revision_count = max(0, int(row.get("revision_count", 1) or 1))
            except (TypeError, ValueError):
                revision_count = 1
            revision_count = min(5, revision_count)
            books.append(
                {
                    "book_name": book_name,
                    "chapter_count": chapter_count,
                    "revision_count": revision_count,
                }
            )

    random_rows: List[Dict[str, Any]] = []
    if isinstance(random_in, list):
        for row in random_in:
            if not isinstance(row, dict):
                continue
            source_name = str(row.get("source") or "").strip()
            topic_name = str(row.get("topic_name") or "").strip()
            if not source_name or not topic_name:
                continue
            try:
                revision_count = max(0, int(row.get("revision_count", 1) or 1))
            except (TypeError, ValueError):
                revision_count = 1
            revision_count = min(5, revision_count)
            random_rows.append(
                {
                    "source": source_name,
                    "topic_name": topic_name,
                    "revision_count": revision_count,
                    "read_required": bool(row.get("read_required", True)),
                    "notes_required": bool(row.get("notes_required", True)),
                }
            )
    tests: List[Dict[str, Any]] = []
    if isinstance(tests_in, list):
        for row in tests_in:
            if not isinstance(row, dict):
                continue
            test_name = str(row.get("test_name") or "").strip()
            source_name = str(row.get("source") or "").strip()
            if not test_name or not source_name:
                continue
            try:
                number_of_tests = max(1, int(row.get("number_of_tests", 1) or 1))
            except (TypeError, ValueError):
                number_of_tests = 1
            try:
                revisions = max(0, int(row.get("revisions", 0) or 0))
            except (TypeError, ValueError):
                revisions = 0
            revisions = min(5, revisions)
            tests.append(
                {
                    "test_name": test_name,
                    "source": source_name,
                    "number_of_tests": number_of_tests,
                    "test_given": number_of_tests,
                    "analysis_done": number_of_tests,
                    "revisions": revisions,
                }
            )

    return {"courses": courses, "books": books, "random": random_rows, "tests": tests}


def mission_selector_options(user_id: str) -> Dict[str, Any]:
    mission = get_or_create_mission(user_id)
    plan = _normalize_plan(mission.get("plan"))

    catalog: Dict[str, List[Dict[str, Any]]] = {}
    exam_options: List[Dict[str, str]] = []

    course_group: Dict[str, Dict[str, Any]] = {}
    for row in plan["courses"]:
        course_name = row["course_name"]
        subject_name = row["subject_name"]
        class_count = int(row["class_count"])
        key = f"course_{_slug(course_name)}"
        if key not in course_group:
            course_group[key] = {"label": course_name, "subjects": {}}
        subjects = course_group[key]["subjects"]
        topics = [f"Class {i}" for i in range(1, class_count + 1)]
        existing = subjects.get(subject_name, [])
        subjects[subject_name] = list(dict.fromkeys(existing + topics))

    for key, value in course_group.items():
        exam_options.append({"value": key, "label": value["label"]})
        catalog[key] = [
            {"subject": subject_name, "topics": topics}
            for subject_name, topics in sorted(value["subjects"].items(), key=lambda item: item[0].lower())
        ]

    for row in plan["books"]:
        book_name = row["book_name"]
        key = f"book_{_slug(book_name)}"
        topics = [f"Chapter {i}" for i in range(1, int(row["chapter_count"]) + 1)]
        exam_options.append({"value": key, "label": f"Book: {book_name}"})
        catalog[key] = [{"subject": book_name, "topics": topics}]

    random_group: Dict[str, List[str]] = {}
    for row in plan["random"]:
        source_name = row["source"]
        random_group.setdefault(source_name, [])
        random_group[source_name].append(row["topic_name"])
    for source_name, topics in sorted(random_group.items(), key=lambda item: item[0].lower()):
        key = f"random_{_slug(source_name)}"
        exam_options.append({"value": key, "label": f"Random: {source_name}"})
        catalog[key] = [{"subject": source_name, "topics": list(dict.fromkeys(topics))}]

    return {
        "mission_id": mission.get("_id", ""),
        "exam_options": exam_options,
        "catalog": catalog,
        "plan": plan,
    }


def get_or_create_mission(user_id: str) -> Dict[str, Any]:
    uid = _normalize_user(user_id)
    ensure_mission_indexes()
    coll = missions_collection()
    doc = coll.find_one({"_id": _mission_id(uid)})
    if doc:
        return doc
    default_doc = _default_mission(uid)
    coll.insert_one(default_doc)
    return default_doc


def get_active_mission_id(user_id: str) -> str:
    mission = get_or_create_mission(user_id)
    if (mission.get("status") or "").strip().lower() != "active":
        return ""
    return str(mission.get("_id") or "")


def upsert_mission(
    user_id: str,
    *,
    title: str,
    target_date: str,
    status: str,
    weights: Dict[str, Any] | None,
    targets: Dict[str, Any] | None,
    plan: Dict[str, Any] | None,
) -> Dict[str, Any]:
    uid = _normalize_user(user_id)
    ensure_mission_indexes()
    mission = get_or_create_mission(uid)
    next_title = (title or "").strip() or mission.get("title") or "UPSC Selection Mission"
    next_target_date = (target_date or "").strip() or mission.get("target_date") or _default_target_date()
    next_status = (status or "").strip().lower() or mission.get("status") or "active"
    if next_status not in {"active", "paused"}:
        next_status = "active"

    next_weights = _normalize_weights(weights if weights is not None else mission.get("weights"))
    next_targets = _normalize_targets(targets if targets is not None else mission.get("targets"))
    next_plan = _normalize_plan(plan if plan is not None else mission.get("plan"))

    doc = {
        "_id": _mission_id(uid),
        "user_id": uid,
        "title": next_title,
        "target_date": next_target_date,
        "status": next_status,
        "weights": next_weights,
        "targets": next_targets,
        "plan": next_plan,
        "updated_at": _now(),
    }
    missions_collection().update_one(
        {"_id": doc["_id"]},
        {"$set": doc, "$setOnInsert": {"created_at": _now()}},
        upsert=True,
    )
    return missions_collection().find_one({"_id": doc["_id"]}) or doc


def mission_progress_payload(user_id: str, lookback_days: int = 90) -> Dict[str, Any]:
    mission = get_or_create_mission(user_id)
    mid = get_active_mission_id(user_id)
    summary = mission_window_summary(user_id, mid, lookback_days)
    by_type = summary["by_type"]

    study_count = int(by_type.get("points_new_class", {}).get("count", 0))
    revision_count = int(by_type.get("points_revision", {}).get("count", 0))
    practice_count = int(
        by_type.get("points_test_completed", {}).get("count", 0)
        + by_type.get("points_ticket_resolved", {}).get("count", 0)
    )
    session_minutes = int(by_type.get("session_stopped", {}).get("duration_minutes", 0))
    # extras_update entries carry minutes in duration_minutes; keep it as soft metric.
    extras_minutes = int(by_type.get("extras_update", {}).get("duration_minutes", 0))

    targets = mission.get("targets", {}) if isinstance(mission.get("targets"), dict) else {}
    target_study = max(1, int(targets.get("study_count", 120) or 120))
    target_revision = max(1, int(targets.get("revision_count", 120) or 120))
    target_practice = max(1, int(targets.get("practice_count", 80) or 80))
    target_sessions = max(1, int(targets.get("session_minutes", 6000) or 6000))
    target_extras = max(1, int(targets.get("extras_positive_minutes", 1200) or 1200))

    comp_study = min(100, round((study_count / target_study) * 100))
    comp_revision = min(100, round((revision_count / target_revision) * 100))
    comp_practice = min(100, round((practice_count / target_practice) * 100))
    comp_sessions = min(100, round((session_minutes / target_sessions) * 100))
    comp_extras = min(100, round((extras_minutes / target_extras) * 100))

    weights = mission.get("weights", {}) if isinstance(mission.get("weights"), dict) else {}
    w_study = int(weights.get("study", 30) or 30)
    w_revision = int(weights.get("revision", 30) or 30)
    w_practice = int(weights.get("practice", 25) or 25)
    w_sessions = int(weights.get("sessions", 10) or 10)
    w_extras = int(weights.get("extras", 5) or 5)
    total_weight = max(1, w_study + w_revision + w_practice + w_sessions + w_extras)
    weighted_score = round(
        (
            comp_study * w_study
            + comp_revision * w_revision
            + comp_practice * w_practice
            + comp_sessions * w_sessions
            + comp_extras * w_extras
        )
        / total_weight
    )

    return {
        "mission_id": mission.get("_id", ""),
        "lookback_days": summary.get("lookback_days", lookback_days),
        "progress_score": int(weighted_score),
        "totals": {
            "study_count": study_count,
            "revision_count": revision_count,
            "practice_count": practice_count,
            "session_minutes": session_minutes,
            "extras_minutes": extras_minutes,
            "ledger_events": int(summary.get("totals", {}).get("events", 0) or 0),
        },
        "completion": {
            "study": comp_study,
            "revision": comp_revision,
            "practice": comp_practice,
            "sessions": comp_sessions,
            "extras": comp_extras,
        },
    }
