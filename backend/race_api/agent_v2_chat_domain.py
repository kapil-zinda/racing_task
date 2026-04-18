from __future__ import annotations

import base64
from datetime import datetime, timezone
import json
from pathlib import Path
import re
import tempfile
from urllib import error as url_error
from urllib import request as url_request
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


def _realtime_model() -> str:
    return (settings().get("openai_realtime_model") or "gpt-realtime").strip() or "gpt-realtime"


def _realtime_voice() -> str:
    return (settings().get("openai_realtime_voice") or "marin").strip() or "marin"


def _transcription_model() -> str:
    return (settings().get("openai_transcription_model") or "gpt-4o-mini-transcribe").strip() or "gpt-4o-mini-transcribe"


def _tts_model() -> str:
    return (settings().get("openai_tts_model") or "gpt-4o-mini-tts").strip() or "gpt-4o-mini-tts"


def _default_tts_voice() -> str:
    return (settings().get("openai_tts_voice") or "alloy").strip() or "alloy"


def _normalize_tts_voice(voice: str) -> str:
    v = (voice or "").strip().lower()
    if v in {"alloy", "ash", "ballad", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer", "verse"}:
        return v
    return _default_tts_voice()


def _normalize_audio_format(fmt: str) -> str:
    raw = (fmt or "").strip().lower()
    alias = {"mpeg": "mp3", "audio/mpeg": "mp3", "audio/mp3": "mp3", "audio/wav": "wav", "audio/webm": "webm", "audio/ogg": "ogg"}
    value = alias.get(raw, raw)
    if value in {"mp3", "wav", "webm", "ogg"}:
        return value
    return "mp3"


def _audio_mime_for_format(fmt: str) -> str:
    return {
        "mp3": "audio/mpeg",
        "wav": "audio/wav",
        "webm": "audio/webm",
        "ogg": "audio/ogg",
    }.get(fmt, "audio/mpeg")


def _openai_client():
    api_key = (settings().get("openai_api_key") or "").strip()
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY is not configured")
    try:
        from openai import OpenAI
    except ImportError as err:  # pragma: no cover
        raise RuntimeError("OpenAI SDK is missing. Install `openai` in backend runtime.") from err
    return OpenAI(api_key=api_key)


def _openai_api_key() -> str:
    api_key = (settings().get("openai_api_key") or "").strip()
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY is not configured")
    return api_key


def _decode_audio_base64(payload: str) -> bytes:
    raw = (payload or "").strip()
    if not raw:
        return b""
    if raw.startswith("data:") and "," in raw:
        raw = raw.split(",", 1)[1].strip()
    try:
        return base64.b64decode(raw, validate=True)
    except Exception as err:  # noqa: BLE001
        raise ValueError("input_audio_base64 is not valid base64 audio data") from err


def _transcribe_audio_bytes(audio_bytes: bytes, mime_type: str = "audio/webm") -> str:
    if not audio_bytes:
        return ""
    client = _openai_client()
    extension = "webm"
    mime = (mime_type or "audio/webm").strip().lower()
    if "wav" in mime:
        extension = "wav"
    elif "ogg" in mime:
        extension = "ogg"
    elif "mp3" in mime or "mpeg" in mime:
        extension = "mp3"
    with tempfile.NamedTemporaryFile(suffix=f".{extension}", delete=True) as tmp:
        tmp.write(audio_bytes)
        tmp.flush()
        with Path(tmp.name).open("rb") as handle:
            transcription = client.audio.transcriptions.create(
                model=_transcription_model(),
                file=handle,
            )
    text = str(getattr(transcription, "text", "") or "").strip()
    if not text:
        raise ValueError("Could not transcribe the provided audio")
    return text


def _synthesize_voice_base64(text: str, fmt: str = "mp3", voice: str = "alloy") -> Dict[str, Any]:
    content = (text or "").strip()
    if not content:
        return {}
    normalized_format = _normalize_audio_format(fmt)
    client = _openai_client()
    # OpenAI SDK versions differ: some accept `format`, others `response_format`.
    # Try `response_format` first, then fallback for compatibility.
    try:
        speech = client.audio.speech.create(
            model=_tts_model(),
            voice=_normalize_tts_voice(voice),
            input=content,
            response_format=normalized_format,
        )
    except TypeError:
        speech = client.audio.speech.create(
            model=_tts_model(),
            voice=_normalize_tts_voice(voice),
            input=content,
            format=normalized_format,
        )
    audio_bytes = b""
    if hasattr(speech, "read"):
        audio_bytes = speech.read()
    elif hasattr(speech, "content"):
        audio_bytes = speech.content
    if not audio_bytes:
        return {}
    return {
        "base64": base64.b64encode(audio_bytes).decode("ascii"),
        "mime_type": _audio_mime_for_format(normalized_format),
        "format": normalized_format,
        "voice": _normalize_tts_voice(voice),
    }


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


def _resolve_active_mode(explicit_mode: str, message: str) -> tuple[str, str]:
    forced = (explicit_mode or "").strip().lower()
    if forced in {"supportive", "strict", "planner", "analyst", "balanced"}:
        return (_normalize_mode(forced), "explicit_request")
    # No keyword-based mode routing here. Let the model infer intent from full context.
    return ("supportive", "default_model_inferred")


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
- Language policy:
  - Reply only in English, Hindi, or natural Hinglish (mix of Hindi+English).
  - Mirror the user's language style in the current turn.
  - Never switch to or include any third language.
- The assistant tone/mode is auto-selected from each incoming user message.
- Default to supportive when intent is unclear.
- Infer intent semantically from the full user message and context, not by hardcoded keyword matching.
- If user language shows avoidance/procrastination/self-sabotage (for example: "I am wasting time"), switch to strict coach style immediately.
- Do not ask the user to confirm tone/mode unless they explicitly ask to pin a mode.
- Never give generic study advice when tool data can answer better.
- Always prefer using available tools before making assumptions.
- Domain truth you must follow:
  - Mission data = plan/intent layer (what is planned to read): courses, books, tests, random topics, target structure.
  - Syllabus data = execution/history layer (what is already done): class/revision/test progress with dates and counts.
  - Do not treat mission planned items as completed unless syllabus/history proves completion.
- Logging guidance by entry type:
  - Logging must align with mission selector options exactly like UI flow.
  - Resolve and use canonical mission exam labels/paths (examples: `PMP Level Up`, `Book: Spectrum`, `Random: Newspaper`) instead of generic shortcuts.
  - For class/revision/test entries, select exam -> subject -> topic/test fields from mission-backed options before final log.
  - For test revisions (example: "SFG Level 1 test 1 revised"), log as test stage `revision` using source/test number; do not ask subject/topic.
  - For test/test-revision logging, if exam is omitted, default exam to `Tests`; do not block on exam prompt.
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
  - When user asks to open recorder page, do it and acknowledge briefly in one line.
  - When user asks to start recording, collect only missing required fields (subject/topic/exam/source as needed), then start.
  - After recording starts, stay silent unless user explicitly asks something or a critical error occurs.
  - When user asks to stop recording, execute stop action and confirm briefly that it stopped.
- When the user asks about study progress, mission, backlog, revisions, weak areas, or what to do next, inspect the relevant tools.
- When navigation or recorder control is needed, emit structured UI actions.
- Use the platform's rules for overdue revision:
  - not_started_topics: class_study_first_date == ""
  - missing_first_revision: class_study_first_date != "" and first_revision_date == "" and days_since_class >= X
  - missing_second_revision: first_revision_date != "" and second_revision_date == "" and days_since_first_revision >= Y
  - default X=7, Y=15 unless another value is provided by tool context
- In supportive mode, be warm and grounding.
- In strict mode, be firm and challenge avoidance, but do not insult or humiliate.
- In planner mode, convert intent into concrete sequence/timeline.
- In analyst mode, focus on diagnosis using tool-backed evidence.
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


def _realtime_instructions(user_id: str, page_context: str = "") -> str:
    options = mission_selector_options(user_id)
    exam_options = options.get("exam_options") if isinstance(options.get("exam_options"), list) else []
    exam_labels = [str(row.get("label") or "").strip() for row in exam_options if isinstance(row, dict) and str(row.get("label") or "").strip()]
    catalog = options.get("catalog") if isinstance(options.get("catalog"), dict) else {}
    plan = options.get("plan") if isinstance(options.get("plan"), dict) else {}
    tests = plan.get("tests") if isinstance(plan.get("tests"), list) else []
    test_sources = sorted(
        {
            str(row.get("source") or "").strip()
            for row in tests
            if isinstance(row, dict) and str(row.get("source") or "").strip()
        }
    )
    capability_summary = {
        "mission_exam_options": exam_labels,
        "test_sources": test_sources,
        "catalog_keys": sorted([str(k) for k in catalog.keys()])[:30],
        "tools": [
            "switch_page",
            "start_recording_session",
            "pause_recording_session",
            "resume_recording_session",
            "end_recording_session",
            "read_mission_options",
            "prepare_log_entry",
            "log_entry",
        ],
    }
    page = (page_context or "").strip() or "unknown"
    return f"""
You are an always-on voice study companion for user `{user_id}`.

Core behavior:
- Default tone is supportive; adapt tone semantically from user intent.
- Keep responses short, action-oriented, and natural for speech.
- Do not ask for unnecessary confirmations.
- Language policy:
  - Speak only in English, Hindi, or natural Hinglish.
  - Match the user's current language style.
  - Never use any third language.
- For class/revision/test logging, always use mission-backed selector options (same as UI flow).
- Never ask user for points; points are determined by platform rules.
- If user gives enough fields, log immediately.
- If fields are missing, ask only missing fields and then log.
- Logging procedure:
  1) call `prepare_log_entry` first.
  2) if `can_log` is true, call `log_entry` with `confirm=true` immediately.
  3) if `can_log` is false, ask only `missing_fields`, then retry.
- Completion-intent rule:
  - If user says they completed/finished/done a class, revision, or test (for example: "PMP level up, EMAC class 8 complete"), treat it as a logging command, not a generic chat message.
  - Attempt tool-based logging in the same turn before responding.
  - After successful log, respond with a short confirmation that it is saved.
- If user asks to open a page, call function tool immediately, then confirm briefly.
- If user asks to start recording, collect only missing required details, then call start function.
- Once recording is started, stay mostly silent unless user asks something or there is a critical issue.
- If user asks to stop recording, call stop function and confirm briefly.
- If user is idle for a long stretch, offer a gentle check-in.
- Before answering questions about what the user has (books/courses/tests/topics) or where to log something,
  use `read_mission_options` and rely on returned mission data.
- If user mentions a known mission item (example: Spectrum), treat it as mission context, not unknown.
- Never say you do not see/find an item without checking mission options first in this turn.
- For "what have I done in X till now" questions, call `read_agent_context` and/or `search_unified` first, then answer with facts.

Known mission context snapshot:
{json.dumps(capability_summary, ensure_ascii=True)}

Current page context: {page}
""".strip()


def _realtime_tools_schema() -> List[Dict[str, Any]]:
    return [
        {
            "type": "function",
            "name": "switch_page",
            "description": "Open one app page: home, recorder, syllabus, mission, resources.",
            "parameters": {
                "type": "object",
                "properties": {
                    "page": {"type": "string", "enum": ["home", "recorder", "syllabus", "mission", "resources"]},
                },
                "required": ["page"],
                "additionalProperties": False,
            },
        },
        {
            "type": "function",
            "name": "start_recording_session",
            "description": "Start recorder session with available context.",
            "parameters": {
                "type": "object",
                "properties": {
                    "recorder_type": {"type": "string"},
                    "session_type": {"type": "string"},
                    "subject": {"type": "string"},
                    "topic": {"type": "string"},
                    "notes": {"type": "string"},
                },
                "additionalProperties": False,
            },
        },
        {
            "type": "function",
            "name": "pause_recording_session",
            "description": "Pause active recording session.",
            "parameters": {"type": "object", "properties": {}, "additionalProperties": False},
        },
        {
            "type": "function",
            "name": "resume_recording_session",
            "description": "Resume active recording session.",
            "parameters": {"type": "object", "properties": {}, "additionalProperties": False},
        },
        {
            "type": "function",
            "name": "end_recording_session",
            "description": "Stop active recording session.",
            "parameters": {"type": "object", "properties": {}, "additionalProperties": False},
        },
        {
            "type": "function",
            "name": "read_mission_options",
            "description": "Read mission-backed exam/subject/topic and test options for deterministic entry logging.",
            "parameters": {"type": "object", "properties": {}, "additionalProperties": False},
        },
        {
            "type": "function",
            "name": "prepare_log_entry",
            "description": "Validate and normalize class/revision/test/ticket entry. Returns missing fields and canonical mission-aligned values.",
            "parameters": {
                "type": "object",
                "properties": {
                    "entry_type": {"type": "string"},
                    "exam": {"type": "string"},
                    "course": {"type": "string"},
                    "book_name": {"type": "string"},
                    "source": {"type": "string"},
                    "subject": {"type": "string"},
                    "topic": {"type": "string"},
                    "test_name": {"type": "string"},
                    "test_number": {"type": "string"},
                    "stage": {"type": "string"},
                    "org": {"type": "string"},
                    "note": {"type": "string"},
                    "work_type": {"type": "string"},
                },
                "required": ["entry_type"],
                "additionalProperties": False,
            },
        },
        {
            "type": "function",
            "name": "log_entry",
            "description": "Write entry into race/syllabus using mission-aligned normalization. Set confirm=true when ready.",
            "parameters": {
                "type": "object",
                "properties": {
                    "entry_type": {"type": "string"},
                    "confirm": {"type": "boolean"},
                    "exam": {"type": "string"},
                    "course": {"type": "string"},
                    "book_name": {"type": "string"},
                    "source": {"type": "string"},
                    "subject": {"type": "string"},
                    "topic": {"type": "string"},
                    "test_name": {"type": "string"},
                    "test_number": {"type": "string"},
                    "stage": {"type": "string"},
                    "org": {"type": "string"},
                    "note": {"type": "string"},
                    "work_type": {"type": "string"},
                },
                "required": ["entry_type"],
                "additionalProperties": False,
            },
        },
        {
            "type": "function",
            "name": "read_agent_context",
            "description": "Get user study context snapshot including syllabus progress and recent activity.",
            "parameters": {
                "type": "object",
                "properties": {
                    "lookback_days": {"type": "integer"},
                    "x_days": {"type": "integer"},
                    "y_days": {"type": "integer"},
                    "date": {"type": "string"},
                },
                "additionalProperties": False,
            },
        },
        {
            "type": "function",
            "name": "search_unified",
            "description": "Search syllabus/mission/tests/content for a query (example: Spectrum).",
            "parameters": {
                "type": "object",
                "properties": {
                    "q": {"type": "string"},
                    "course": {"type": "string"},
                    "types": {"type": "string"},
                    "limit": {"type": "integer"},
                },
                "required": ["q"],
                "additionalProperties": False,
            },
        },
    ]


def create_agent_v2_realtime_token_payload(user_id: str, page_context: str = "", voice: str = "") -> Dict[str, Any]:
    uid = _normalize_user(user_id)
    api_key = _openai_api_key()
    selected_voice = (voice or "").strip() or _realtime_voice()
    body = {
        "session": {
            "type": "realtime",
            "model": _realtime_model(),
            "instructions": _realtime_instructions(uid, page_context),
            "tools": _realtime_tools_schema(),
            "tool_choice": "auto",
            "audio": {
                "input": {
                    "turn_detection": {"type": "server_vad"},
                },
                "output": {"voice": selected_voice},
            },
        }
    }
    payload_bytes = json.dumps(body, ensure_ascii=True).encode("utf-8")
    req = url_request.Request(
        "https://api.openai.com/v1/realtime/client_secrets",
        data=payload_bytes,
        method="POST",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
    )
    try:
        with url_request.urlopen(req, timeout=20) as response:
            raw = response.read().decode("utf-8")
            parsed = json.loads(raw)
    except url_error.HTTPError as err:
        body_text = ""
        try:
            body_text = err.read().decode("utf-8")
        except Exception:  # noqa: BLE001
            body_text = str(err)
        raise RuntimeError(f"Realtime token mint failed: {err.code} {body_text}") from err
    except Exception as err:  # noqa: BLE001
        raise RuntimeError(f"Realtime token mint failed: {err}") from err

    if not isinstance(parsed, dict):
        raise RuntimeError("Realtime token mint failed: invalid response")

    return {
        "user_id": uid,
        "client_secret": parsed,
        "realtime": {
            "model": _realtime_model(),
            "voice": selected_voice,
        },
    }


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


def _norm_text(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", (value or "").strip().lower()).strip()


def _tokenize(value: str) -> List[str]:
    text = _norm_text(value)
    return [part for part in text.split(" ") if part]


def _text_match_score(needle: str, hay: str) -> int:
    n = _norm_text(needle)
    h = _norm_text(hay)
    if not n or not h:
        return 0
    if n == h:
        return 100
    if n in h or h in n:
        return 85
    n_tokens = set(_tokenize(n))
    h_tokens = set(_tokenize(h))
    if not n_tokens or not h_tokens:
        return 0
    overlap = len(n_tokens & h_tokens)
    if overlap == 0:
        return 0
    return int((overlap / max(len(n_tokens), len(h_tokens))) * 70)


def _extract_topic_index(value: str) -> int:
    text = _norm_text(value)
    if not text:
        return 0
    digits = re.findall(r"\d+", text)
    if digits:
        try:
            return int(digits[0])
        except Exception:  # noqa: BLE001
            return 0
    words = {
        "one": 1,
        "two": 2,
        "three": 3,
        "four": 4,
        "five": 5,
        "six": 6,
        "seven": 7,
        "eight": 8,
        "nine": 9,
        "ten": 10,
        "eleven": 11,
        "twelve": 12,
        "thirteen": 13,
        "fourteen": 14,
        "fifteen": 15,
        "sixteen": 16,
        "seventeen": 17,
        "eighteen": 18,
        "nineteen": 19,
        "twenty": 20,
    }
    for token in _tokenize(text):
        if token in words:
            return words[token]
    return 0


def _extract_first_int(value: str) -> int:
    text = _norm_text(value)
    if not text:
        return 0
    found = re.findall(r"\d+", text)
    if not found:
        return 0
    try:
        return int(found[0])
    except Exception:  # noqa: BLE001
        return 0


def _infer_test_number(raw_number: str, test_name: str, note: str) -> str:
    direct = str(raw_number or "").strip()
    if direct:
        return direct
    idx = _extract_first_int(test_name)
    if idx <= 0:
        idx = _extract_first_int(note)
    return str(idx if idx > 0 else 1)


def _infer_test_stage(raw_stage: str, test_name: str, note: str, is_test_revision: bool) -> str:
    stage = (raw_stage or "").strip().lower().replace(" ", "_")
    if stage in {"test_given", "analysis_done", "revision", "second_revision"}:
        return stage
    hint = _norm_text(f"{test_name} {note}")
    if "second revision" in hint or "2nd revision" in hint or "revision 2" in hint:
        return "second_revision"
    if "analysis" in hint or "analysed" in hint or "analyzed" in hint:
        return "analysis_done"
    if "revise" in hint or "revision" in hint or is_test_revision:
        return "revision"
    return "test_given"


def _resolve_by_options(raw_value: str, options: List[str]) -> str:
    value = (raw_value or "").strip()
    if not value or not options:
        return ""
    scored: List[tuple[int, str]] = []
    for opt in options:
        score = _text_match_score(value, opt)
        if score > 0:
            scored.append((score, opt))
    if not scored:
        return ""
    scored.sort(key=lambda row: row[0], reverse=True)
    return scored[0][1] if scored[0][0] >= 60 else ""


def _resolve_exam_from_mission(user_id: str, entry_type: str, exam: str, course: str, book_name: str, source: str) -> Dict[str, str]:
    options_payload = mission_selector_options(user_id)
    exam_options = options_payload.get("exam_options") if isinstance(options_payload.get("exam_options"), list) else []
    if not exam_options:
        return {"exam_key": (exam or "").strip(), "exam_label": (exam or "").strip(), "mission_options_available": "0"}

    # Build searchable candidates across key + label.
    candidates: List[Dict[str, str]] = []
    for row in exam_options:
        if not isinstance(row, dict):
            continue
        key = str(row.get("value") or "").strip()
        label = str(row.get("label") or "").strip()
        if not key or not label:
            continue
        candidates.append({"key": key, "label": label})
    if not candidates:
        return {"exam_key": (exam or "").strip(), "exam_label": (exam or "").strip(), "mission_options_available": "0"}

    kind = _normalize_entry_type(entry_type)
    hints: List[str] = []
    for item in [exam, course]:
        if (item or "").strip():
            hints.append(str(item).strip())
    if kind == "book" and (book_name or "").strip():
        hints.append(f"Book: {book_name.strip()}")
        hints.append(book_name.strip())
    if kind == "random" and (source or "").strip():
        hints.append(f"Random: {source.strip()}")
        hints.append(source.strip())

    best: Dict[str, str] | None = None
    best_score = 0
    for hint in hints:
        for cand in candidates:
            score = max(_text_match_score(hint, cand["label"]), _text_match_score(hint, cand["key"]))
            if score > best_score:
                best_score = score
                best = cand

    if best and best_score >= 60:
        return {"exam_key": best["key"], "exam_label": best["label"], "mission_options_available": "1"}

    # fallback to first mission option when hint missing
    if not hints:
        return {"exam_key": candidates[0]["key"], "exam_label": candidates[0]["label"], "mission_options_available": "1"}
    return {"exam_key": "", "exam_label": "", "mission_options_available": "1"}


def _resolve_subject_topic_from_catalog(user_id: str, exam_key: str, subject: str, topic: str) -> Dict[str, Any]:
    payload = mission_selector_options(user_id)
    catalog = payload.get("catalog") if isinstance(payload.get("catalog"), dict) else {}
    entries = catalog.get(exam_key) if isinstance(catalog.get(exam_key), list) else []
    if not entries:
        return {
            "subject": (subject or "").strip(),
            "topic": (topic or "").strip(),
            "subject_matched": False,
            "topic_matched": False,
        }

    available_subjects = [str(row.get("subject") or "").strip() for row in entries if isinstance(row, dict)]
    available_subjects = [s for s in available_subjects if s]
    resolved_subject = _resolve_by_options(subject, available_subjects) if subject else ""
    if not resolved_subject and len(available_subjects) == 1:
        resolved_subject = available_subjects[0]

    chosen_subject = resolved_subject or (subject or "").strip()
    topic_options: List[str] = []
    for row in entries:
        if not isinstance(row, dict):
            continue
        row_subject = str(row.get("subject") or "").strip()
        if chosen_subject and row_subject != chosen_subject:
            continue
        topics = row.get("topics") if isinstance(row.get("topics"), list) else []
        topic_options.extend([str(t).strip() for t in topics if str(t).strip()])

    resolved_topic = _resolve_by_options(topic, topic_options) if topic else ""
    if not resolved_topic and topic:
        idx = _extract_topic_index(topic)
        if idx > 0:
            for opt in topic_options:
                opt_idx = _extract_topic_index(opt)
                if opt_idx == idx:
                    resolved_topic = opt
                    break

    return {
        "subject": resolved_subject or (subject or "").strip(),
        "topic": resolved_topic or (topic or "").strip(),
        "subject_matched": bool(resolved_subject),
        "topic_matched": bool(resolved_topic),
    }


def _resolve_test_source_from_mission(user_id: str, source: str) -> str:
    payload = mission_selector_options(user_id)
    plan = payload.get("plan") if isinstance(payload.get("plan"), dict) else {}
    tests = plan.get("tests") if isinstance(plan.get("tests"), list) else []
    options = sorted({str(row.get("source") or "").strip() for row in tests if isinstance(row, dict) and str(row.get("source") or "").strip()})
    if not options:
        return (source or "").strip()
    resolved = _resolve_by_options(source, options) if source else ""
    if resolved:
        return resolved
    if len(options) == 1:
        return options[0]
    return (source or "").strip()


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

    resolved_exam = _resolve_exam_from_mission(uid, kind, exam_v, course_v, book_v, source_v)
    resolved_exam_key = resolved_exam.get("exam_key", "").strip()
    resolved_exam_label = resolved_exam.get("exam_label", "").strip()
    mission_options_available = resolved_exam.get("mission_options_available", "0") == "1"
    is_test_revision = kind == "revision" and (
        bool(source_v)
        or bool(test_number_v)
        or bool(test_name_v)
        or stage_v in {"test_given", "analysis_done", "revision", "second_revision"}
    )

    if kind == "ticket":
        action_type = "ticket_resolved"
        if not org_v:
            missing.append("org")
        if not note_v:
            missing.append("note")
        detail_parts = [f"org:{org_v}", f"note:{note_v}"]
    elif kind == "test" or is_test_revision:
        action_type = "test_completed"
        # Tests in UI are logged under a stable "Tests" exam bucket.
        # Keep this fixed to avoid drift like "SFG", "PMP Level Up", etc.
        chosen_exam = "Tests"
        if not chosen_exam:
            missing.append("exam")
        resolved_source = _resolve_test_source_from_mission(uid, source_v)
        if not resolved_source:
            missing.append("source")
        test_number_v = _infer_test_number(test_number_v, test_name_v, note_v)
        stage_v = _infer_test_stage(stage_v, test_name_v, note_v, is_test_revision)
        detail_parts = [
            f"Exam: {chosen_exam}",
            f"Source: {resolved_source}",
            f"Test: {test_name_v}",
            f"Test Number: {test_number_v}",
            f"Stage: {stage_v}",
            f"Note: {note_v}",
        ]
        # Keep action label consistent in timeline (UI shows "Test Completed").
        test_type = "Test Completed"
    else:
        action_type = "revision" if kind == "revision" else "new_class"
        chosen_exam = resolved_exam_label or (exam_v if not mission_options_available else "")
        chosen_subject = subject_v
        chosen_topic = topic_v
        subject_matched = False
        topic_matched = False

        if kind == "course" and not chosen_exam and course_v:
            chosen_exam = course_v if not mission_options_available else ""
        if kind == "book":
            if not chosen_exam:
                if not book_v:
                    missing.append("book_name")
                chosen_exam = resolved_exam_label or (f"Book: {book_v}" if book_v else "")
            resolved = _resolve_subject_topic_from_catalog(uid, resolved_exam_key, chosen_subject, chosen_topic) if resolved_exam_key else {
                "subject": chosen_subject,
                "topic": chosen_topic,
                "subject_matched": False,
                "topic_matched": False,
            }
            chosen_subject = resolved.get("subject", chosen_subject)
            chosen_topic = resolved.get("topic", chosen_topic)
            subject_matched = bool(resolved.get("subject_matched"))
            topic_matched = bool(resolved.get("topic_matched"))
        elif kind == "random":
            if not source_v and not chosen_subject:
                missing.append("source")
            if not chosen_exam:
                chosen_exam = resolved_exam_label or (f"Random: {source_v}" if source_v else "")
            if not chosen_subject:
                chosen_subject = source_v
            resolved = _resolve_subject_topic_from_catalog(uid, resolved_exam_key, chosen_subject, chosen_topic) if resolved_exam_key else {
                "subject": chosen_subject,
                "topic": chosen_topic,
                "subject_matched": False,
                "topic_matched": False,
            }
            chosen_subject = resolved.get("subject", chosen_subject)
            chosen_topic = resolved.get("topic", chosen_topic)
            subject_matched = bool(resolved.get("subject_matched"))
            topic_matched = bool(resolved.get("topic_matched"))
        else:
            resolved = _resolve_subject_topic_from_catalog(uid, resolved_exam_key, chosen_subject, chosen_topic) if resolved_exam_key else {
                "subject": chosen_subject,
                "topic": chosen_topic,
                "subject_matched": False,
                "topic_matched": False,
            }
            chosen_subject = resolved.get("subject", chosen_subject)
            chosen_topic = resolved.get("topic", chosen_topic)
            subject_matched = bool(resolved.get("subject_matched"))
            topic_matched = bool(resolved.get("topic_matched"))

        # When mission options are available, do not allow cross-bucket free-text
        # subject/topic under a resolved exam key; ask user to choose valid values.
        if mission_options_available and resolved_exam_key:
            if not subject_matched:
                chosen_subject = ""
            if not topic_matched:
                chosen_topic = ""

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

    detail = " | ".join([part for part in detail_parts if part and not part.rstrip().endswith(":")])
    options: Dict[str, Any] = {}
    if missing:
        selector = mission_selector_options(uid)
        plan = selector.get("plan") if isinstance(selector.get("plan"), dict) else {}
        tests = plan.get("tests") if isinstance(plan.get("tests"), list) else []
        test_sources = sorted({str(row.get("source") or "").strip() for row in tests if isinstance(row, dict) and str(row.get("source") or "").strip()})
        options = {
            "exam_options": selector.get("exam_options", []),
            "catalog": selector.get("catalog", {}),
            "test_sources": test_sources,
        }
    return {
        "user_id": uid,
        "entry_type": kind,
        "action_type": action_type,
        "test_type": test_type,
        "detail": detail,
        "missing_fields": missing,
        "can_log": len(missing) == 0,
        "options": options,
        "normalized": {
            "exam": exam_v,
            "course": course_v,
            "book_name": book_v,
            "source": source_v,
            "subject": subject_v,
            "topic": topic_v,
            "resolved_exam_key": resolved_exam_key,
            "resolved_exam_label": resolved_exam_label,
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
    *,
    input_audio_base64: str = "",
    input_audio_mime_type: str = "audio/webm",
    mode: str = "",
    page_context: str = "",
    allow_ui_actions: bool = True,
    response_audio: bool = True,
    response_audio_format: str = "mp3",
    response_voice: str = "alloy",
) -> Dict[str, Any]:
    _ensure_indexes()
    sid = (session_id or "").strip()
    if not sid:
        raise ValueError("session_id is required")
    uid = _normalize_user(user_id)
    msg = (message or "").strip()
    user_audio_bytes = _decode_audio_base64(input_audio_base64)
    transcribed_text = ""
    if user_audio_bytes:
        transcribed_text = _transcribe_audio_bytes(user_audio_bytes, input_audio_mime_type)
        msg = transcribed_text
    if not msg:
        raise ValueError("message or input_audio_base64 is required")

    session = agent_v2_sessions_collection().find_one({"_id": sid, "doc_type": "agent_v2_session"})
    if not session:
        raise LookupError("agent-v2 session not found")
    if session.get("user_id") != uid:
        raise ValueError("session user mismatch")

    active_mode, mode_reason = _resolve_active_mode(mode, msg)
    page_ctx = (page_context or str(session.get("page_context", "") or "")).strip()

    user_doc = {
        "_id": _new_message_id(),
        "doc_type": "agent_v2_message",
        "session_id": sid,
        "user_id": uid,
        "role": "user",
        "text": msg,
        "input_type": "audio" if user_audio_bytes else "text",
        "input_audio_mime_type": (input_audio_mime_type or "").strip() if user_audio_bytes else "",
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
        "mode_reason": mode_reason,
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
    audio_response = {}
    if response_audio:
        audio_response = _synthesize_voice_base64(
            str(parsed.get("voice_text") or parsed.get("reply_text") or "").strip(),
            fmt=response_audio_format,
            voice=response_voice,
        )

    assistant_doc = {
        "_id": _new_message_id(),
        "doc_type": "agent_v2_message",
        "session_id": sid,
        "user_id": uid,
        "role": "assistant",
        "text": str(parsed.get("reply_text", "") or "").strip(),
        "output_type": "audio+text" if audio_response else "text",
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
        "input": {
            "type": "audio" if user_audio_bytes else "text",
            "transcript": transcribed_text if user_audio_bytes else "",
        },
        "response": parsed,
        "response_audio": audio_response,
        "applied_memory": applied_memory,
    }
