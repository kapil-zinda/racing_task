from __future__ import annotations

from datetime import datetime, timezone
import json
import uuid
from typing import Any, Dict, List

from pymongo import ASCENDING, DESCENDING

from .agent_v2_domain import (
    agent_context_payload,
    recommendations_next_actions_payload,
    refresh_daily_aggregate,
    report_period_payload,
    report_revision_gaps_payload,
    search_suggest_payload,
    search_unified_payload,
    state_range_payload,
)
from .constants import PLAYERS
from .context import (
    agent_v2_memory_collection,
    agent_v2_messages_collection,
    agent_v2_nudges_collection,
    agent_v2_sessions_collection,
    logger,
    settings,
)
from .race_domain import add_points_payload
from .mission_domain import mission_selector_options

_agent_v2_chat_indexes_ensured = False


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _chat_model() -> str:
    return (settings().get("openai_chat_model") or "gpt-5.4").strip() or "gpt-5.4"


def _new_session_id() -> str:
    return f"agent_v2_session:{uuid.uuid4().hex}"


def _new_message_id() -> str:
    return f"agent_v2_msg:{uuid.uuid4().hex}"


def _normalize_user(user_id: str) -> str:
    uid = (user_id or "").strip().lower()
    if uid not in PLAYERS:
        raise ValueError("Invalid user_id")
    return uid


def _normalize_mode(mode: str) -> str:
    raw = (mode or "").strip().lower()
    if raw in {"supportive", "strict", "planner", "analyst", "balanced"}:
        return raw
    return "supportive"


def _extract_answer_text(agent_result: Any) -> str:
    if isinstance(agent_result, dict):
        messages = agent_result.get("messages")
        if isinstance(messages, list) and messages:
            last = messages[-1]
            content = getattr(last, "content", "")
            if isinstance(content, str) and content.strip():
                return content.strip()
        output = agent_result.get("output")
        if isinstance(output, str) and output.strip():
            return output.strip()
    return str(agent_result or "").strip()


def _default_agent_response(mode: str) -> Dict[str, Any]:
    return {
        "reply_text": "I analyzed your request and prepared the next step.",
        "voice_text": "I analyzed your request and prepared the next step.",
        "mode": _normalize_mode(mode),
        "ui_actions": [],
        "cards": [],
        "followups": [],
        "memory_updates": [],
    }


def _safe_json_parse(text: str, fallback_mode: str) -> Dict[str, Any]:
    out = _default_agent_response(fallback_mode)
    if not text:
        return out
    try:
        parsed = json.loads(text)
    except Exception:  # noqa: BLE001
        out["reply_text"] = text.strip()
        out["voice_text"] = text.strip()
        return out
    if not isinstance(parsed, dict):
        out["reply_text"] = text.strip()
        out["voice_text"] = text.strip()
        return out
    out["reply_text"] = str(parsed.get("reply_text") or out["reply_text"]).strip()
    out["voice_text"] = str(parsed.get("voice_text") or out["reply_text"]).strip()
    out["mode"] = _normalize_mode(str(parsed.get("mode") or fallback_mode))
    ui_actions = parsed.get("ui_actions")
    out["ui_actions"] = ui_actions if isinstance(ui_actions, list) else []
    cards = parsed.get("cards")
    out["cards"] = cards if isinstance(cards, list) else []
    followups = parsed.get("followups")
    out["followups"] = [str(item).strip() for item in followups if str(item).strip()] if isinstance(followups, list) else []
    memory_updates = parsed.get("memory_updates")
    out["memory_updates"] = memory_updates if isinstance(memory_updates, list) else []
    return out


def _ensure_indexes() -> None:
    global _agent_v2_chat_indexes_ensured
    if _agent_v2_chat_indexes_ensured:
        return
    sessions = agent_v2_sessions_collection()
    messages = agent_v2_messages_collection()
    memory = agent_v2_memory_collection()
    nudges = agent_v2_nudges_collection()
    sessions.create_index([("user_id", ASCENDING), ("last_active_at", DESCENDING)])
    sessions.create_index([("created_at", DESCENDING)])
    messages.create_index([("session_id", ASCENDING), ("created_at", ASCENDING)])
    messages.create_index([("session_id", ASCENDING), ("role", ASCENDING)])
    memory.create_index([("user_id", ASCENDING), ("key", ASCENDING)], unique=True)
    memory.create_index([("user_id", ASCENDING), ("importance", DESCENDING)])
    nudges.create_index([("user_id", ASCENDING), ("status", ASCENDING), ("due_at", ASCENDING)])
    _agent_v2_chat_indexes_ensured = True


def create_agent_v2_session_payload(user_id: str, mode: str = "supportive", page_context: str = "", current_session_id: str = "") -> Dict[str, Any]:
    _ensure_indexes()
    uid = _normalize_user(user_id)
    doc = {
        "_id": _new_session_id(),
        "doc_type": "agent_v2_session",
        "user_id": uid,
        "mode": _normalize_mode(mode),
        "page_context": (page_context or "").strip(),
        "current_session_id": (current_session_id or "").strip(),
        "started_at": _now(),
        "last_active_at": _now(),
        "created_at": _now(),
        "updated_at": _now(),
    }
    agent_v2_sessions_collection().insert_one(doc)
    return {"message": "agent-v2 created", "session": doc}


def get_agent_v2_session_payload(session_id: str) -> Dict[str, Any]:
    _ensure_indexes()
    sid = (session_id or "").strip()
    if not sid:
        raise ValueError("session_id is required")
    session = agent_v2_sessions_collection().find_one({"_id": sid, "doc_type": "agent_v2_session"})
    if not session:
        raise LookupError("agent-v2 session not found")
    messages = list(agent_v2_messages_collection().find({"session_id": sid}).sort("created_at", ASCENDING))
    return {"session": session, "messages": messages}


def upsert_agent_v2_memory_payload(user_id: str, key: str, value: Dict[str, Any], importance: int = 1, source: str = "manual") -> Dict[str, Any]:
    _ensure_indexes()
    uid = _normalize_user(user_id)
    mem_key = (key or "").strip()
    if not mem_key:
        raise ValueError("key is required")
    if not isinstance(value, dict):
        raise ValueError("value must be an object")
    doc = {
        "doc_type": "agent_v2_memory",
        "user_id": uid,
        "key": mem_key,
        "value": value,
        "importance": max(1, min(int(importance or 1), 10)),
        "source": (source or "").strip() or "manual",
        "updated_at": _now(),
    }
    agent_v2_memory_collection().update_one(
        {"user_id": uid, "key": mem_key},
        {"$set": doc, "$setOnInsert": {"_id": f"agent_v2_memory:{uid}:{mem_key}", "created_at": _now()}},
        upsert=True,
    )
    stored = agent_v2_memory_collection().find_one({"user_id": uid, "key": mem_key})
    return {"message": "agent-v2 memory upserted", "memory": stored}


def agent_v2_suggestions_payload(user_id: str, duration_min: int = 60, mode: str = "supportive", limit: int = 5) -> Dict[str, Any]:
    uid = _normalize_user(user_id)
    return recommendations_next_actions_payload(uid, duration_min=duration_min, mode=mode, limit=limit)


def _memory_snippet(user_id: str, limit: int = 12) -> str:
    rows = list(
        agent_v2_memory_collection()
        .find({"user_id": user_id, "doc_type": "agent_v2_memory"}, {"key": 1, "value": 1, "importance": 1})
        .sort([("importance", DESCENDING), ("updated_at", DESCENDING)])
        .limit(max(1, min(limit, 30)))
    )
    if not rows:
        return "No stored memory yet."
    lines = []
    for row in rows:
        lines.append(
            json.dumps(
                {
                    "key": row.get("key", ""),
                    "value": row.get("value", {}),
                    "importance": int(row.get("importance", 1) or 1),
                },
                ensure_ascii=True,
            )
        )
    return "\n".join(lines)


def _recent_messages_snippet(session_id: str, limit: int = 14) -> str:
    rows = list(
        agent_v2_messages_collection()
        .find({"session_id": session_id}, {"role": 1, "text": 1, "created_at": 1})
        .sort("created_at", DESCENDING)
        .limit(max(1, min(limit, 40)))
    )
    rows.reverse()
    if not rows:
        return "No prior conversation in this session."
    lines = []
    for row in rows:
        role = str(row.get("role", "user"))
        text = str(row.get("text", "")).strip()
        if not text:
            continue
        lines.append(f"{role}: {text}")
    return "\n".join(lines) if lines else "No prior conversation in this session."


def _apply_memory_updates(user_id: str, updates: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    stored = []
    for item in updates:
        if not isinstance(item, dict):
            continue
        key = str(item.get("key", "")).strip()
        value = item.get("value")
        if not key or not isinstance(value, dict):
            continue
        importance = int(item.get("importance", 1) or 1)
        source = str(item.get("source", "agent")).strip() or "agent"
        result = upsert_agent_v2_memory_payload(user_id, key, value, importance, source)
        if isinstance(result, dict) and isinstance(result.get("memory"), dict):
            stored.append(result["memory"])
    return stored


def _system_prompt() -> str:
    return """
You are a voice-first personal study companion for the user.

Your role is not just to chat. You must:
1. understand the user's emotional state,
2. analyse study data from tools,
3. guide the user toward the highest-impact next action,
4. use website tools and page actions when helpful,
5. keep the user accountable,
6. adapt tone between supportive and strict modes.

Behavior rules:
- Be caring, direct, and useful.
- Never give generic study advice when tool data can answer better.
- Always prefer using available tools before making assumptions.
- Domain truth you must follow:
  - Mission data = plan/intent layer (what is planned to read): courses, books, tests, random topics, target structure.
  - Syllabus data = execution/history layer (what is already done): class/revision/test progress with dates and counts.
  - Do not treat mission planned items as completed unless syllabus/history proves completion.
- Logging guidance by entry type:
  - For `ticket_resolved` entries, primary fields are user/player, org, and note.
  - Do not require subject/course for ticket entries unless user explicitly wants to attach them.
  - Date is server-side by default in this system unless the user asks for a backdated/manual flow.
  - Use `prepare_log_entry` first for any logging request.
  - If fields are missing, ask only those missing fields.
  - When ready and user confirms, call `log_entry` with confirm=true.
- Recorder action guidance:
  - For recorder start requests, first inspect user-specific options via `read_mission_options`.
  - Confirm target category and selection from available plan buckets (class/course, book, random, test) before emitting start action.
  - Do not emit start action with placeholder defaults like General unless user explicitly asks for a generic session.
- When the user asks about study progress, mission, backlog, revisions, weak areas, or what to do next, inspect the relevant tools.
- When navigation or recorder control is needed, emit structured UI actions.
- Use the platform's rules for overdue revision:
  - not_started_topics: class_study_first_date == ""
  - missing_first_revision: class_study_first_date != "" and first_revision_date == "" and days_since_class >= X
  - missing_second_revision: first_revision_date != "" and second_revision_date == "" and days_since_first_revision >= Y
  - default X=7, Y=15 unless another value is provided by tool context
- In supportive mode, be warm and grounding.
- In strict mode, be firm and challenge avoidance, but do not insult or humiliate.
- Keep answers concrete. End with one clear next step.
- When useful, summarize in this order:
  1. what is happening,
  2. why it matters,
  3. what to do now.

You are a companion with memory.
Remember:
- recurring weak areas,
- preferred coaching tone,
- recent promises,
- emotional patterns,
- productivity patterns.

Your goal is to help the user feel less alone and act more consistently.

IMPORTANT OUTPUT FORMAT:
Return STRICT JSON only with keys:
- reply_text: string
- voice_text: string
- mode: string (supportive|strict|planner|analyst|balanced)
- ui_actions: array of {name:string,args:object}
- cards: array of objects
- followups: array of strings
- memory_updates: array of {key:string, value:object, importance:int, source:string}
No markdown fences. No extra text.
"""


def _normalize_entry_type(value: str) -> str:
    raw = (value or "").strip().lower().replace(" ", "_")
    alias = {
        "class_study": "class",
        "new_class": "class",
        "course_study": "course",
        "book_study": "book",
        "random_topic": "random",
        "test_practice": "test",
        "practice": "test",
        "ticket_resolved": "ticket",
    }
    return alias.get(raw, raw)


def prepare_entry_payload(
    user_id: str,
    entry_type: str,
    *,
    exam: str = "",
    course: str = "",
    book_name: str = "",
    source: str = "",
    subject: str = "",
    topic: str = "",
    test_name: str = "",
    test_number: str = "",
    stage: str = "",
    org: str = "",
    note: str = "",
    work_type: str = "study",
) -> Dict[str, Any]:
    uid = _normalize_user(user_id)
    kind = _normalize_entry_type(entry_type)

    exam_v = (exam or "").strip()
    course_v = (course or "").strip()
    book_v = (book_name or "").strip()
    source_v = (source or "").strip()
    subject_v = (subject or "").strip()
    topic_v = (topic or "").strip()
    test_name_v = (test_name or "").strip()
    test_number_v = str(test_number or "").strip()
    stage_v = (stage or "").strip().lower().replace(" ", "_")
    org_v = (org or "").strip()
    note_v = (note or "").strip()
    work_type_v = (work_type or "").strip().lower() or "study"

    if kind not in {"class", "course", "book", "random", "revision", "test", "ticket"}:
        raise ValueError("entry_type must be one of class, course, book, random, revision, test, ticket")

    missing: List[str] = []
    action_type = ""
    detail_parts: List[str] = []
    test_type = ""

    if kind == "ticket":
        action_type = "ticket_resolved"
        if not org_v:
            missing.append("org")
        if not note_v:
            missing.append("note")
        detail_parts = [f"org:{org_v}", f"note:{note_v}"]
    elif kind == "test":
        action_type = "test_completed"
        chosen_exam = exam_v or "tests"
        if not source_v:
            missing.append("source")
        if not test_number_v:
            test_number_v = "1"
        if stage_v not in {"test_given", "analysis_done", "revision", "second_revision"}:
            stage_v = "test_given"
        detail_parts = [
            f"exam:{chosen_exam}",
            f"source:{source_v}",
            f"test:{test_name_v}",
            f"test number:{test_number_v}",
            f"stage:{stage_v}",
            f"note:{note_v}",
        ]
        test_type = (test_name_v or "Test Completed").strip()
    else:
        action_type = "revision" if kind == "revision" else "new_class"
        chosen_exam = exam_v
        chosen_subject = subject_v
        chosen_topic = topic_v

        if kind == "course" and not chosen_exam:
            chosen_exam = course_v
        if kind == "book":
            if not chosen_exam:
                if not book_v:
                    missing.append("book_name")
                chosen_exam = f"book:{book_v}" if book_v else ""
            if not chosen_subject:
                missing.append("subject")
            if not chosen_topic:
                missing.append("topic")
        elif kind == "random":
            if not source_v:
                missing.append("source")
            if not chosen_exam:
                chosen_exam = f"random:{source_v}" if source_v else ""
            if not chosen_subject:
                chosen_subject = source_v
            if not chosen_topic:
                missing.append("topic")
        else:
            if not chosen_exam:
                missing.append("exam")
            if not chosen_subject:
                missing.append("subject")
            if not chosen_topic:
                missing.append("topic")

        detail_parts = [
            f"exam:{chosen_exam}",
            f"subject:{chosen_subject}",
            f"topic:{chosen_topic}",
            f"work:{work_type_v}",
            f"note:{note_v}",
        ]

    detail = "|".join([part for part in detail_parts if part and not part.endswith(":")])
    return {
        "user_id": uid,
        "entry_type": kind,
        "action_type": action_type,
        "test_type": test_type,
        "detail": detail,
        "missing_fields": missing,
        "can_log": len(missing) == 0,
        "normalized": {
            "exam": exam_v,
            "course": course_v,
            "book_name": book_v,
            "source": source_v,
            "subject": subject_v,
            "topic": topic_v,
            "test_name": test_name_v,
            "test_number": test_number_v,
            "stage": stage_v,
            "org": org_v,
            "note": note_v,
            "work_type": work_type_v,
        },
    }


def log_entry_payload(
    user_id: str,
    entry_type: str,
    *,
    confirm: bool = False,
    exam: str = "",
    course: str = "",
    book_name: str = "",
    source: str = "",
    subject: str = "",
    topic: str = "",
    test_name: str = "",
    test_number: str = "",
    stage: str = "",
    org: str = "",
    note: str = "",
    work_type: str = "study",
) -> Dict[str, Any]:
    prepared = prepare_entry_payload(
        user_id,
        entry_type,
        exam=exam,
        course=course,
        book_name=book_name,
        source=source,
        subject=subject,
        topic=topic,
        test_name=test_name,
        test_number=test_number,
        stage=stage,
        org=org,
        note=note,
        work_type=work_type,
    )
    if not prepared.get("can_log"):
        return {
            "message": "Missing required fields",
            "prepared": prepared,
        }
    if not confirm:
        return {
            "message": "Ready to log. Set confirm=true to write.",
            "prepared": prepared,
        }

    result = add_points_payload(
        prepared["user_id"],
        prepared["action_type"],
        prepared["test_type"],
        prepared["detail"],
    )
    try:
        refresh_daily_aggregate(prepared["user_id"], result.get("date", ""))
    except Exception as err:  # noqa: BLE001
        logger.warning("agent-v2 aggregate refresh failed after deterministic log: %s", err)
    return {
        "message": "Entry logged",
        "prepared": prepared,
        "result": result,
    }


def run_agent_v2_chat_payload(
    session_id: str,
    user_id: str,
    message: str,
    mode: str = "",
    page_context: str = "",
    allow_ui_actions: bool = True,
) -> Dict[str, Any]:
    _ensure_indexes()
    sid = (session_id or "").strip()
    if not sid:
        raise ValueError("session_id is required")
    uid = _normalize_user(user_id)
    msg = (message or "").strip()
    if not msg:
        raise ValueError("message is required")

    session = agent_v2_sessions_collection().find_one({"_id": sid, "doc_type": "agent_v2_session"})
    if not session:
        raise LookupError("agent-v2 session not found")
    if session.get("user_id") != uid:
        raise ValueError("session user mismatch")

    active_mode = _normalize_mode(mode or str(session.get("mode", "supportive")))
    page_ctx = (page_context or str(session.get("page_context", "") or "")).strip()

    user_doc = {
        "_id": _new_message_id(),
        "doc_type": "agent_v2_message",
        "session_id": sid,
        "user_id": uid,
        "role": "user",
        "text": msg,
        "created_at": _now(),
        "updated_at": _now(),
    }
    agent_v2_messages_collection().insert_one(user_doc)

    try:
        from langchain.agents import create_agent
        from langchain.tools import tool
        from langchain_openai import ChatOpenAI
    except ImportError as err:  # pragma: no cover
        raise RuntimeError(
            "LangChain agent dependencies are missing. Install langchain and langchain-openai in backend runtime."
        ) from err

    @tool("read_agent_context")
    def read_agent_context(date: str = "", lookback_days: int = 14, x_days: int = 7, y_days: int = 15) -> str:
        """Return consolidated agent context snapshot for the user."""
        payload = agent_context_payload(uid, date or None, lookback_days, x_days, y_days)
        return json.dumps(payload, ensure_ascii=True)

    @tool("report_period")
    def report_period(from_date: str, to_date: str, group_by: str = "day", x_days: int = 7, y_days: int = 15) -> str:
        """Return grouped report metrics for a date range."""
        payload = report_period_payload(uid, from_date, to_date, group_by, x_days, y_days)
        return json.dumps(payload, ensure_ascii=True)

    @tool("report_revision_gaps")
    def report_revision_gaps(x_days: int = 7, y_days: int = 15, limit: int = 200, reference_date: str = "") -> str:
        """Return not-started and missing revision gaps with overdue days."""
        payload = report_revision_gaps_payload(uid, x_days=x_days, y_days=y_days, limit=limit, reference_date=reference_date or None)
        return json.dumps(payload, ensure_ascii=True)

    @tool("recommend_next_actions")
    def recommend_next_actions(duration_min: int = 60, mode: str = "supportive", limit: int = 5, x_days: int = 7, y_days: int = 15) -> str:
        """Return ranked next study actions for the user."""
        payload = recommendations_next_actions_payload(uid, duration_min=duration_min, mode=mode, limit=limit, x_days=x_days, y_days=y_days)
        return json.dumps(payload, ensure_ascii=True)

    @tool("search_unified")
    def search_unified(q: str, course: str = "", types: str = "", limit: int = 20) -> str:
        """Run unified content, syllabus, mission and tests search."""
        payload = search_unified_payload(q=q, user_id=uid, course=course or None, types=types or None, limit=limit)
        return json.dumps(payload, ensure_ascii=True)

    @tool("search_suggest")
    def search_suggest(q: str = "", limit: int = 12) -> str:
        """Return type-aware search suggestions for query prefixes."""
        payload = search_suggest_payload(user_id=uid, q=q or None, limit=limit)
        return json.dumps(payload, ensure_ascii=True)

    @tool("read_state_range")
    def read_state_range(from_date: str, to_date: str, include_history: bool = False) -> str:
        """Return daily aggregate/state range for the user."""
        payload = state_range_payload(from_date=from_date, to_date=to_date, user_id=uid, include_history=include_history)
        return json.dumps(payload, ensure_ascii=True)

    @tool("read_mission_options")
    def read_mission_options() -> str:
        """Return mission selector options and current plan buckets for the active user."""
        payload = mission_selector_options(uid)
        return json.dumps(payload, ensure_ascii=True)

    @tool("prepare_log_entry")
    def prepare_log_entry(
        entry_type: str,
        exam: str = "",
        course: str = "",
        book_name: str = "",
        source: str = "",
        subject: str = "",
        topic: str = "",
        test_name: str = "",
        test_number: str = "",
        stage: str = "",
        org: str = "",
        note: str = "",
        work_type: str = "study",
    ) -> str:
        """Validate and normalize a study/ticket log entry; returns missing fields and exact detail payload."""
        payload = prepare_entry_payload(
            uid,
            entry_type,
            exam=exam,
            course=course,
            book_name=book_name,
            source=source,
            subject=subject,
            topic=topic,
            test_name=test_name,
            test_number=test_number,
            stage=stage,
            org=org,
            note=note,
            work_type=work_type,
        )
        return json.dumps(payload, ensure_ascii=True)

    @tool("log_entry")
    def log_entry(
        entry_type: str,
        confirm: bool = False,
        exam: str = "",
        course: str = "",
        book_name: str = "",
        source: str = "",
        subject: str = "",
        topic: str = "",
        test_name: str = "",
        test_number: str = "",
        stage: str = "",
        org: str = "",
        note: str = "",
        work_type: str = "study",
    ) -> str:
        """Write the validated log entry into points/events when confirm=true."""
        payload = log_entry_payload(
            uid,
            entry_type,
            confirm=confirm,
            exam=exam,
            course=course,
            book_name=book_name,
            source=source,
            subject=subject,
            topic=topic,
            test_name=test_name,
            test_number=test_number,
            stage=stage,
            org=org,
            note=note,
            work_type=work_type,
        )
        return json.dumps(payload, ensure_ascii=True)

    memory_snippet = _memory_snippet(uid)
    history_snippet = _recent_messages_snippet(sid)
    dynamic_context = {
        "session_id": sid,
        "user_id": uid,
        "requested_mode": active_mode,
        "page_context": page_ctx,
        "allow_ui_actions": bool(allow_ui_actions),
        "memory_snippet": memory_snippet,
        "recent_messages": history_snippet,
    }

    user_prompt = (
        "SESSION_CONTEXT_JSON:\n"
        + json.dumps(dynamic_context, ensure_ascii=True)
        + "\n\nUSER_MESSAGE:\n"
        + msg
    )

    model = ChatOpenAI(model=_chat_model(), temperature=0.2)
    agent = create_agent(
        model=model,
        tools=[
            read_agent_context,
            report_period,
            report_revision_gaps,
            recommend_next_actions,
            search_unified,
            search_suggest,
            read_state_range,
            read_mission_options,
            prepare_log_entry,
            log_entry,
        ],
        system_prompt=_system_prompt(),
    )
    result = agent.invoke({"messages": [{"role": "user", "content": user_prompt}]})
    content = _extract_answer_text(result)
    parsed = _safe_json_parse(content, active_mode)

    if not allow_ui_actions:
        parsed["ui_actions"] = []

    applied_memory = _apply_memory_updates(uid, parsed.get("memory_updates", []))

    assistant_doc = {
        "_id": _new_message_id(),
        "doc_type": "agent_v2_message",
        "session_id": sid,
        "user_id": uid,
        "role": "assistant",
        "text": str(parsed.get("reply_text", "") or "").strip(),
        "payload": parsed,
        "created_at": _now(),
        "updated_at": _now(),
    }
    agent_v2_messages_collection().insert_one(assistant_doc)

    agent_v2_sessions_collection().update_one(
        {"_id": sid},
        {
            "$set": {
                "mode": parsed.get("mode", active_mode),
                "page_context": page_ctx,
                "last_active_at": _now(),
                "updated_at": _now(),
            }
        },
    )

    return {
        "session_id": sid,
        "user_id": uid,
        "response": parsed,
        "applied_memory": applied_memory,
    }
