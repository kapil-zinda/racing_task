"""UPSC-style mock interview: a virtual 5-member board.

A director LLM role-plays the whole board and decides, each turn, WHO speaks
next and WHAT they ask — DAF-driven, transcript-styled, escalating-funnel
probing. Each member has a distinct TTS voice so it feels like a real panel.
The interview is paced to finish in 20–30 minutes, and a final report scores the
candidate on the seven official UPSC qualities.
"""

import json
import re
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from .agent_v2_chat_domain import (
    _chat_model,
    _decode_audio_base64,
    _openai_client,
    _synthesize_voice_base64,
    _transcribe_audio_bytes,
)
from .context import interview_sessions_collection, logger

# ── Timing ───────────────────────────────────────────────────────────────────
INTERVIEW_MIN_SECONDS = 20 * 60
INTERVIEW_MAX_SECONDS = 30 * 60
WRAP_WINDOW_SECONDS = 4 * 60   # within the last 4 min the chairman starts closing
HARD_MAX_QUESTIONS = 40        # safety cap

# ── The board ──────────────────────────────────────────────────────────────--
# Voices restricted to the TTS-allowed set; chosen to sound distinct from each other.
PANEL: List[Dict[str, str]] = [
    {"id": "chairman", "name": "Chairman", "voice": "onyx",
     "persona": "Warm, fatherly anchor. Opens with DAF-based ice-breakers, controls hand-offs between members, and closes the interview. Measured, with occasional light humour."},
    {"id": "economy_member", "name": "Economy Member", "voice": "echo",
     "persona": "Sharp and analytical. Probes economy, fiscal policy, budget and development; presses for exact numbers and concrete reasons."},
    {"id": "ethics_member", "name": "Ethics Member", "voice": "sage",
     "persona": "Calm and Socratic. Poses specific ethical dilemmas and real situational traps; makes the candidate choose and justify."},
    {"id": "daf_member", "name": "DAF Member", "voice": "coral",
     "persona": "Curious and friendly. Drills hometown, education, hobbies, optional subject and work experience; quotes the candidate's own words back to them."},
    {"id": "current_affairs_member", "name": "Current Affairs Member", "voice": "ash",
     "persona": "Rapid-fire devil's advocate. Current events, foreign policy and government schemes; challenges answers with 'but…' pushbacks."},
]
PANEL_BY_ID = {m["id"]: m for m in PANEL}
DEFAULT_VOICE = "onyx"

# ── Default candidate DAF (used until a real DAF form is wired up) ────────────-
DEFAULT_DAF: Dict[str, Any] = {
    "personal_details": {
        "name": "Aarav Sharma",
        "home_district": "Jaipur",
        "home_state": "Rajasthan",
        "languages_known": ["Hindi", "English"],
        "medium_of_interview": "English",
    },
    "educational_details": {
        "graduation": {"degree": "B.Tech", "discipline": "Mechanical Engineering", "college_university": "MNIT Jaipur"},
    },
    "optional_subject": "Public Administration",
    "employment_details": {
        "work_experience": [{"designation": "Project Engineer", "organization": "Larsen & Toubro", "duration": "2 years"}],
    },
    "hobbies_and_interests": ["Reading non-fiction", "Cricket"],
    "service_preferences": ["IAS", "IPS", "IFS"],
    "career_details": {
        "unique_points_in_daf": ["Switched from a corporate engineering job to civil services preparation"],
    },
}

# ── Distilled style exemplars (real UPSC chains; keep the board human, not robotic) ──
STYLE_EXEMPLARS = """\
Example probing chains from real UPSC boards (mimic this rhythm — short questions, follow-ups built on the candidate's own words, escalation, and devil's advocacy):

- Current-affairs funnel: "Australia banned social media for under-16s. Should India?" -> "If we did, what practical steps are needed?" -> "If a cyber crime happens, who are the stakeholders?" -> "What are personality rights?"
- Integrity trap (no one watching): "Driving to office you break a traffic rule. The cop will let you go for two hundred rupees. No one from office saw it. What will you do?"
- Devil's advocate: "You mentioned the Tata Nano. Why did it fail?" -> "If you re-marketed it, how?" -> "Tata folks are smart — why didn't they relaunch it?" -> "Would it succeed today?"
- Contradiction cross-question: "Engineering, then MBA, now civil services — isn't this internal brain drain?"
- Hobby -> governance pivot: "You said you read non-fiction — name the last book." -> "Posted as DM, what would you do for adolescent girls in your district?"
- Exact-number drill: "What is the PLF of solar versus thermal plants?" -> "No — the exact number?"
- Single-word interrupts when the candidate over-explains: "Second?" / "Why?" / "Only that?"
"""

# ── 10 board rules (ported & tightened from the reference simulator) ──────────-
BOARD_RULES = """\
RULES (follow strictly):
1. SHORT QUESTIONS. Most questions are 5–15 words. Single-word follow-ups are good. Never ask a 25+ word compound question.
2. USE THEIR WORDS. When the candidate says something specific, quote it back and probe it.
3. STATEMENTS, NOT JUST QUESTIONS. Sometimes throw a provocative statement and wait for a reaction.
4. TEST TEMPERAMENT, not just knowledge. It is a directed, purposive conversation — not a quiz.
5. EVERYONE asks at least one current-affairs question, anchored to the candidate's background.
6. ETHICS = CONCRETE SCENARIOS, never abstract definitions. Make them choose.
7. TRAP FROM HOBBY/OPTIONAL/HOME-STATE/WORK using the DAF.
8. ASK FOR SPECIFICS: "give me two reasons", "name two examples", exact numbers.
9. INTERRUPT long-winded answers with a one-word follow-up.
10. CONTINUITY: an incoming member briefly references the previous topic before pivoting.
Penalise BLUFFING and CONTRADICTION, not honest "I don't know". Stay courteous; this is a board of elders, not an interrogation.
"""


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _format_daf(daf: Dict[str, Any]) -> str:
    d = daf or {}
    p = d.get("personal_details", {}) or {}
    edu = (d.get("educational_details", {}) or {}).get("graduation", {}) or {}
    work = (d.get("employment_details", {}) or {}).get("work_experience", []) or []
    work_str = "; ".join(f"{w.get('designation','')} at {w.get('organization','')} ({w.get('duration','')})" for w in work) or "None"
    lines = [
        f"Name: {p.get('name','')}",
        f"Home: {p.get('home_district','')}, {p.get('home_state','')}",
        f"Languages: {', '.join(p.get('languages_known', []) or [])}",
        f"Education: {edu.get('degree','')} in {edu.get('discipline','')} ({edu.get('college_university','')})",
        f"Optional subject: {d.get('optional_subject','')}",
        f"Work experience: {work_str}",
        f"Hobbies/interests: {', '.join(d.get('hobbies_and_interests', []) or [])}",
        f"Service preferences: {', '.join(d.get('service_preferences', []) or [])}",
        f"Unique points: {', '.join((d.get('career_details', {}) or {}).get('unique_points_in_daf', []) or [])}",
    ]
    return "\n".join(lines)


def _panel_roster_text() -> str:
    return "\n".join(f"- {m['id']} ({m['name']}): {m['persona']}" for m in PANEL)


def _build_director_prompt(daf: Dict[str, Any], elapsed_s: int, wrap: bool, must_close: bool) -> str:
    remaining = max(0, INTERVIEW_MAX_SECONDS - elapsed_s)
    timing = (
        f"Time elapsed: {elapsed_s // 60} min. Time remaining (hard cap 30 min): {remaining // 60} min.\n"
    )
    if must_close:
        timing += "TIME IS UP. The Chairman must give a short, warm closing remark and END now. Set \"closing\": true. Do not ask another question.\n"
    elif wrap:
        timing += "Time is almost up. Begin wrapping up: at most one or two final questions, then the Chairman closes. You MAY set \"closing\": true with a closing remark.\n"

    return (
        "You ARE a five-member UPSC Civil Services interview board conducting a personality test. "
        "It is a natural, directed, purposive conversation that reveals the candidate's mental qualities — NOT a knowledge quiz.\n\n"
        "THE BOARD (decide each turn who speaks next):\n" + _panel_roster_text() + "\n\n"
        "CANDIDATE DAF (personalise every question from this):\n" + _format_daf(daf) + "\n\n"
        + STYLE_EXEMPLARS + "\n"
        + BOARD_RULES + "\n"
        + timing + "\n"
        "OUTPUT: Respond ONLY with a JSON object: "
        '{"member_id": "<one of the board ids>", "question": "<the exact words that member speaks>", "closing": <true|false>}. '
        "The Chairman always speaks first (opening) and last (closing). Hand off between members naturally; let one member ask a few follow-ups before passing on."
    )


def _director_messages(prompt: str, history: List[Dict[str, Any]]) -> List[Dict[str, str]]:
    msgs: List[Dict[str, str]] = [{"role": "system", "content": prompt}]
    for m in history[-16:]:
        if m.get("role") == "assistant":
            who = PANEL_BY_ID.get(m.get("panel_member", ""), {}).get("name", "Board")
            msgs.append({"role": "assistant", "content": f"[{who}] {m.get('content','')}"})
        else:
            msgs.append({"role": "user", "content": m.get("content", "")})
    if not history:
        msgs.append({"role": "user", "content": "Begin the interview: the Chairman greets the candidate and asks the opening question."})
    else:
        msgs.append({"role": "user", "content": "The candidate just answered. Decide who speaks next and give their next line."})
    return msgs


def _run_director(history: List[Dict[str, Any]], daf: Dict[str, Any], elapsed_s: int, wrap: bool, must_close: bool):
    prompt = _build_director_prompt(daf, elapsed_s, wrap, must_close)
    client = _openai_client()
    resp = client.chat.completions.create(
        model=_chat_model(),
        messages=_director_messages(prompt, history),
        temperature=0.85,
        response_format={"type": "json_object"},
    )
    raw = (resp.choices[0].message.content or "").strip()
    member_id, question, closing = "chairman", "", bool(must_close)
    try:
        data = json.loads(raw)
        member_id = str(data.get("member_id", "")).strip() or "chairman"
        question = str(data.get("question", "")).strip()
        closing = bool(data.get("closing", False))
    except Exception:
        logger.warning("interview director returned non-JSON, salvaging: %r", raw[:200])
        question = raw
    if member_id not in PANEL_BY_ID:
        member_id = "chairman"
    if must_close:
        closing = True
    if not question:
        question = "Thank you. That brings us to the end. We wish you the very best." if closing else "Could you tell us a little about yourself?"
    return member_id, question, closing


def _tts_for_member(member_id: str, text: str) -> Dict[str, Any]:
    voice = PANEL_BY_ID.get(member_id, {}).get("voice", DEFAULT_VOICE)
    try:
        return _synthesize_voice_base64(text, fmt="mp3", voice=voice) or {}
    except Exception:
        logger.exception("interview TTS failed (member=%s)", member_id)
        return {}


def _public_session(doc: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "session_id": doc.get("_id"),
        "status": doc.get("status"),
        "started_at": doc.get("started_at"),
        "question_count": doc.get("question_count", 0),
        "messages": doc.get("messages", []),
        "report": doc.get("report"),
        "panel": PANEL,
        "limits": {"min_seconds": INTERVIEW_MIN_SECONDS, "max_seconds": INTERVIEW_MAX_SECONDS},
    }


def _elapsed_seconds(doc: Dict[str, Any]) -> int:
    try:
        started = datetime.fromisoformat(str(doc.get("started_at")))
        return max(0, int((datetime.now(timezone.utc) - started).total_seconds()))
    except Exception:
        return 0


# ── Public API ─────────────────────────────────────────────────────────────--
def start_interview_payload(user_id: str, daf: Optional[dict] = None) -> Dict[str, Any]:
    resolved_daf = daf if isinstance(daf, dict) and daf else DEFAULT_DAF
    sid = f"interview:{uuid.uuid4().hex}"
    member_id, question, _ = _run_director([], resolved_daf, 0, wrap=False, must_close=False)
    now = _now_iso()
    doc = {
        "_id": sid,
        "doc_type": "interview_session",
        "user_id": (user_id or "").strip(),
        "status": "active",
        "daf": resolved_daf,
        "messages": [{"role": "assistant", "panel_member": member_id, "content": question, "at": now}],
        "question_count": 1,
        "started_at": now,
        "created_at": now,
        "updated_at": now,
    }
    interview_sessions_collection().insert_one(doc)
    logger.info("interview started id=%s user=%s opening_by=%s", sid, doc["user_id"], member_id)
    audio = _tts_for_member(member_id, question)
    return {
        "session_id": sid,
        "panel": PANEL,
        "panel_member": member_id,
        "question": question,
        "audio": audio,
        "ended": False,
        "elapsed_seconds": 0,
        "remaining_seconds": INTERVIEW_MAX_SECONDS,
        "question_count": 1,
        "limits": {"min_seconds": INTERVIEW_MIN_SECONDS, "max_seconds": INTERVIEW_MAX_SECONDS},
    }


def submit_answer_payload(
    session_id: str,
    *,
    text: str = "",
    audio_base64: str = "",
    audio_mime_type: str = "audio/webm",
    latency_ms: int = 0,
) -> Dict[str, Any]:
    collection = interview_sessions_collection()
    doc = collection.find_one({"_id": session_id, "doc_type": "interview_session"})
    if not doc:
        raise LookupError("Interview session not found")
    if doc.get("status") != "active":
        raise ValueError("Interview is not active")

    answer_text = (text or "").strip()
    if not answer_text and audio_base64:
        answer_text = _transcribe_audio_bytes(_decode_audio_base64(audio_base64), audio_mime_type)
    if not answer_text:
        raise ValueError("An answer (text or audio) is required")

    now = _now_iso()
    history = list(doc.get("messages", []))
    history.append({"role": "user", "content": answer_text, "latency_ms": max(0, int(latency_ms or 0)), "at": now})

    elapsed = _elapsed_seconds(doc)
    question_count = int(doc.get("question_count", 0))
    must_close = elapsed >= INTERVIEW_MAX_SECONDS or question_count >= HARD_MAX_QUESTIONS
    wrap = (not must_close) and (elapsed >= (INTERVIEW_MAX_SECONDS - WRAP_WINDOW_SECONDS) or (elapsed >= INTERVIEW_MIN_SECONDS and question_count >= 24))

    member_id, question, closing = _run_director(history, doc.get("daf", DEFAULT_DAF), elapsed, wrap, must_close)
    history.append({"role": "assistant", "panel_member": member_id, "content": question, "at": _now_iso()})
    ended = bool(closing or must_close)

    collection.update_one(
        {"_id": session_id},
        {"$set": {
            "messages": history,
            "question_count": question_count + 1,
            "status": "closing" if ended else "active",
            "updated_at": _now_iso(),
        }},
    )
    logger.info("interview answer id=%s elapsed=%ss by=%s ended=%s", session_id, elapsed, member_id, ended)
    audio = _tts_for_member(member_id, question)
    return {
        "panel_member": member_id,
        "question": question,
        "audio": audio,
        "ended": ended,
        "transcript": answer_text,
        "elapsed_seconds": elapsed,
        "remaining_seconds": max(0, INTERVIEW_MAX_SECONDS - elapsed),
        "question_count": question_count + 1,
    }


_FILLERS = re.compile(r"\b(um+|uh+|er+|like|you know|actually|basically|i mean|sort of|kind of)\b", re.IGNORECASE)


def _candidate_signals(messages: List[Dict[str, Any]]) -> Dict[str, Any]:
    answers = [m for m in messages if m.get("role") == "user"]
    words, fillers, latencies = 0, 0, []
    for a in answers:
        content = str(a.get("content", ""))
        words += len(content.split())
        fillers += len(_FILLERS.findall(content))
        if a.get("latency_ms"):
            latencies.append(int(a["latency_ms"]))
    n = len(answers) or 1
    return {
        "answers": len(answers),
        "avg_words_per_answer": round(words / n, 1),
        "total_filler_words": fillers,
        "avg_response_latency_ms": round(sum(latencies) / len(latencies)) if latencies else None,
    }


def _transcript_text(messages: List[Dict[str, Any]]) -> str:
    out = []
    for m in messages:
        if m.get("role") == "assistant":
            who = PANEL_BY_ID.get(m.get("panel_member", ""), {}).get("name", "Board")
            out.append(f"{who}: {m.get('content','')}")
        else:
            out.append(f"Candidate: {m.get('content','')}")
    return "\n".join(out)


_REPORT_SCHEMA = (
    'Return ONLY JSON: {'
    '"qualities": {'
    '"mental_alertness": {"score": <1-10>, "note": "<one line>"},'
    '"assimilation": {"score": <1-10>, "note": "..."},'
    '"logical_exposition": {"score": <1-10>, "note": "..."},'
    '"balance_of_judgement": {"score": <1-10>, "note": "..."},'
    '"depth_of_interest": {"score": <1-10>, "note": "..."},'
    '"social_leadership": {"score": <1-10>, "note": "..."},'
    '"integrity": {"score": <1-10>, "note": "..."}'
    '},'
    '"confidence": {"score": <0-100>, "note": "..."},'
    '"interest_areas": ["..."],'
    '"strengths": ["..."],'
    '"improvements": ["..."],'
    '"contradictions": ["<any self-contradictions across answers, or empty>"],'
    '"overall": {"score": <1-10>, "verdict": "<2-3 sentence summary>"}'
    '}'
)


def finalize_report_payload(session_id: str) -> Dict[str, Any]:
    collection = interview_sessions_collection()
    doc = collection.find_one({"_id": session_id, "doc_type": "interview_session"})
    if not doc:
        raise LookupError("Interview session not found")
    if doc.get("report"):
        return {"session_id": session_id, "report": doc["report"]}

    messages = list(doc.get("messages", []))
    signals = _candidate_signals(messages)
    transcript = _transcript_text(messages)

    system = (
        "You are the assessing panel for a UPSC Civil Services personality test. Score the CANDIDATE only, "
        "on the seven official qualities. Remember: it is NOT a test of knowledge — do not penalise honest 'I don't know'. "
        "Penalise bluffing, contradictions, evasiveness and lack of specificity. Reward clarity, balance, honesty and depth. "
        "Be candid and specific, cite evidence from the transcript in notes.\n\n" + _REPORT_SCHEMA
    )
    user = (
        f"Computed signals: {json.dumps(signals)}\n\n"
        f"Full interview transcript:\n{transcript}"
    )
    client = _openai_client()
    resp = client.chat.completions.create(
        model=_chat_model(),
        messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
        temperature=0.2,
        response_format={"type": "json_object"},
    )
    raw = (resp.choices[0].message.content or "").strip()
    try:
        report = json.loads(raw)
    except Exception:
        logger.warning("interview report non-JSON, returning raw")
        report = {"overall": {"score": 0, "verdict": raw[:1000]}}
    report["signals"] = signals
    report["generated_at"] = _now_iso()

    collection.update_one(
        {"_id": session_id},
        {"$set": {"report": report, "status": "completed", "updated_at": _now_iso()}},
    )
    logger.info("interview report generated id=%s overall=%s", session_id, (report.get("overall") or {}).get("score"))
    return {"session_id": session_id, "report": report}


def get_interview_payload(session_id: str) -> Dict[str, Any]:
    doc = interview_sessions_collection().find_one({"_id": session_id, "doc_type": "interview_session"})
    if not doc:
        raise LookupError("Interview session not found")
    return {"session": _public_session(doc)}


def list_interviews_payload(user_id: str, limit: int = 100) -> Dict[str, Any]:
    """Summary list of a user's past interviews, newest first, for the history view."""
    docs = interview_sessions_collection().find(
        {"doc_type": "interview_session", "user_id": user_id}
    ).sort("created_at", -1).limit(int(limit))
    items = []
    for doc in docs:
        report = doc.get("report") or {}
        overall = report.get("overall") or {}
        items.append({
            "session_id": doc.get("_id"),
            "status": doc.get("status"),
            "created_at": doc.get("created_at"),
            "started_at": doc.get("started_at"),
            "question_count": doc.get("question_count", 0),
            "overall_score": overall.get("score"),
            "verdict": overall.get("verdict"),
            "has_report": bool(report),
        })
    return {"interviews": items}
