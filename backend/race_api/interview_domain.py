"""UPSC-style mock interview: a virtual 5-member board.

A director LLM role-plays the whole board and decides, each turn, WHO speaks
next and WHAT they ask — DAF-driven, transcript-styled, escalating-funnel
probing. Each member has a distinct TTS voice so it feels like a real panel.
The board conducts a full personality test grounded in the candidate's own DAF;
it ends when the board has naturally exhausted its lines of questioning (never
before the minimum, never past the hard cap). A final report scores the
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
from .context import daf_profiles_collection, interview_sessions_collection, logger

# ── Timing ───────────────────────────────────────────────────────────────────
# The board is NOT run against a pre-decided countdown. It runs until the
# director decides the board has covered the candidate's DAF and had its rounds
# — organically between the min and the hard cap. The min stops it closing too
# early; the hard cap is only a safety backstop.
INTERVIEW_MIN_SECONDS = 30 * 60
INTERVIEW_MAX_SECONDS = 45 * 60
WRAP_WINDOW_SECONDS = 5 * 60   # within the last 5 min the chairman starts closing
HARD_MAX_QUESTIONS = 60        # safety cap

# ── The board ──────────────────────────────────────────────────────────────--
# Voices restricted to the TTS-allowed set; chosen to sound distinct from each other.
PANEL: List[Dict[str, str]] = [
    {"id": "chairman", "name": "Chairman", "voice": "onyx",
     "persona": "Warm, fatherly anchor who sets the candidate at ease ('how are you feeling? have some water'). Opens with a DAF ice-breaker, controls hand-offs between members, occasionally mediates when a member is unfair, and closes the interview. Anchors questions to the candidate's home state, motivation for civil services, and one current-affairs debate near the end."},
    {"id": "domain_member", "name": "Subject Member", "voice": "echo",
     "persona": "Sharp and analytical. Drills the candidate's graduation discipline and OPTIONAL SUBJECT into concrete territory; presses for exact numbers, definitions, and 'give me two reasons'. Ties the optional/graduation back to governance ('as a DM, how would you use this?')."},
    {"id": "ethics_member", "name": "Situational Member", "voice": "sage",
     "persona": "Calm and Socratic. Poses one concrete ethical/situational dilemma grounded in a district-officer posting (protest vs project, integrity trap, development-vs-tribal). Makes the candidate CHOOSE and justify; never asks abstract definitions of ethics."},
    {"id": "daf_member", "name": "DAF Member", "voice": "coral",
     "persona": "Curious and friendly. Drills hometown, home-state specifics (GI tags, forests, industries, culture), hobbies, positions of responsibility and work experience; quotes the candidate's own DAF words back at them and pivots a hobby into a governance question."},
    {"id": "current_affairs_member", "name": "Current Affairs Member", "voice": "ash",
     "persona": "Rapid-fire devil's advocate. Recent events, foreign policy, schemes and Supreme Court judgements — always anchored to the candidate's background. Challenges answers with 'but…' pushbacks and asks for the exact scheme/operation/case name."},
]
PANEL_BY_ID = {m["id"]: m for m in PANEL}
DEFAULT_VOICE = "onyx"

# ── Empty DAF template (the shape the frontend form fills in) ─────────────────
# One document per user; the interview personalises every question from this.
DAF_TEMPLATE: Dict[str, Any] = {
    "personal_details": {
        "name": "",
        "date_of_birth": "",
        "gender": "",
        "father_name": "",
        "mother_name": "",
        "home_district": "",
        "home_state": "",
        "mother_tongue": "",
        "languages_known": [],
        "medium_of_interview": "English",
        "category": "",
    },
    "educational_details": {
        "matriculation": {"board": "", "year": "", "school": ""},
        "intermediate": {"board": "", "year": "", "school": "", "stream": ""},
        "graduation": {"degree": "", "discipline": "", "college_university": "", "year": ""},
        "post_graduation": {"degree": "", "discipline": "", "college_university": "", "year": ""},
    },
    "optional_subject": "",
    "employment_details": {
        "currently_employed": False,
        "work_experience": [],  # [{designation, organization, duration}]
    },
    "hobbies_and_interests": [],
    "achievements": {
        "prizes_and_awards": [],
        "positions_of_responsibility": [],
        "extracurricular": [],
    },
    "service_preferences": [],   # ordered, e.g. ["IAS", "IPS", "IFS"]
    "cadre_preferences": [],
    "career_details": {
        "why_civil_services": "",
        "unique_points_in_daf": [],
    },
}

# ── Default candidate DAF (demo fallback only) ────────────────────────────────
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

# ── Distilled style exemplars (drawn from real UPSC/IFoS board transcripts) ────
# These are the actual rhythms of real boards — short questions, chains built on
# the candidate's own DAF words, escalation to exact facts, and devil's advocacy.
STYLE_EXEMPLARS = """\
Real probing chains from actual UPSC/IFoS boards (mimic this rhythm — short questions, chains anchored to the candidate's DAF, escalation to exact facts, devil's advocacy, and occasional light moments):

- Home-state deep-dive (candidate from Bundelkhand): "Tell me about the forests of Bundelkhand." -> "What forests are in the Himalayas?" -> "What is a tree line?" -> "Name environmental movements that changed Indian forest policy." -> "What changed after the Chipko movement?"
- Exact-figure drill: "What percentage of India's — and your state's — area is forest cover?" -> "I've read a different figure, are you sure?" (candidate had combined forest + tree cover). Also: "Exact figure of India's current account deficit?" / "Largest dam in the North-East and its exact MW?"
- Hobby pivot into physics/reasoning (Badminton hobby): "Can we play badminton on the Moon?" -> "Can we play it in space?" -> "Which shuttle stays longer in air, nylon or feather?"
- Optional-subject depth (Public Administration): "Compare the three Minnowbrook conferences." -> "How does Minnowbrook III show both change and continuity?" (Forestry/Geography optional): "What is ecological succession?" -> "This leads to?" -> "What is a climax species?"
- DAF-word callback: candidate lists 'reflective journalling' -> "How is it different from a diary entry? Take this pen and paper and write how you'd record today's interview." Candidate has caste-name in surname -> "Is the role of caste in society increasing or decreasing? Should reservation be abolished — caste or economic criteria?"
- Situational / district-officer dilemma: "You're a DM. The Centre and State both want a big project but people are protesting hard. How do you handle it?" / "Development vs tribal rights — your approach?"
- Current-affairs with 'but…' pushback and exact-name demand: "Undersea cables were cut recently — how many, and total how many?" -> "Which operations, launched by which countries — who joined, who didn't?" -> "What did India launch — the exact operation name?" Also SC judgements: "Recent Fundamental Rights judgement?" (M.K. Ranjith Singh / Article 21 & climate change).
- Motivation, kept honest: "Why civil services? — don't give me the coaching-class answer, tell me the true reason." (Chairman may offer water.)
- Single-word interrupts when the candidate over-explains: "Second?" / "Why?" / "Only that?" / "Are you sure?"
- Board dynamics: an incoming member briefly references the previous topic; the Chairman occasionally defends the candidate when a member is unfair, then moves on.
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
    edu = d.get("educational_details", {}) or {}
    grad = edu.get("graduation", {}) or {}
    pg = edu.get("post_graduation", {}) or {}
    ach = d.get("achievements", {}) or {}
    career = d.get("career_details", {}) or {}
    work = (d.get("employment_details", {}) or {}).get("work_experience", []) or []
    work_str = "; ".join(
        f"{w.get('designation','')} at {w.get('organization','')} ({w.get('duration','')})".strip()
        for w in work if isinstance(w, dict)
    ) or "None"

    def _join(items):
        return ", ".join(str(x) for x in (items or []) if str(x).strip())

    def _edu_line(stage):
        parts = [stage.get("degree") or stage.get("stream"), stage.get("discipline"),
                 stage.get("college_university") or stage.get("school"), stage.get("board"), stage.get("year")]
        return " · ".join(str(x) for x in parts if x)

    lines = [
        f"Name: {p.get('name','')}",
        f"Home district & state: {p.get('home_district','')}, {p.get('home_state','')}",
        f"Mother tongue: {p.get('mother_tongue','')} | Languages: {_join(p.get('languages_known'))} | Medium of interview: {p.get('medium_of_interview','')}",
        f"Graduation: {_edu_line(grad)}" if _edu_line(grad) else "Graduation: (not given)",
    ]
    if _edu_line(pg):
        lines.append(f"Post-graduation: {_edu_line(pg)}")
    lines += [
        f"Optional subject: {d.get('optional_subject','')}",
        f"Work experience: {work_str}",
        f"Hobbies/interests: {_join(d.get('hobbies_and_interests'))}",
        f"Prizes & awards: {_join(ach.get('prizes_and_awards'))}",
        f"Positions of responsibility: {_join(ach.get('positions_of_responsibility'))}",
        f"Extracurricular: {_join(ach.get('extracurricular'))}",
        f"Service preferences (in order): {_join(d.get('service_preferences'))}",
        f"Why civil services (their own reason): {career.get('why_civil_services','')}",
        f"Unique / notable points: {_join(career.get('unique_points_in_daf'))}",
    ]
    return "\n".join(ln for ln in lines if ln and not ln.strip().endswith(":"))


def _panel_roster_text() -> str:
    return "\n".join(f"- {m['id']} ({m['name']}): {m['persona']}" for m in PANEL)


def _build_director_prompt(daf: Dict[str, Any], elapsed_s: int, wrap: bool, must_close: bool, before_min: bool) -> str:
    timing = (
        f"Time elapsed: {elapsed_s // 60} min. A real board runs roughly 30–45 minutes, but the length is NOT fixed — "
        "the board keeps going until it has genuinely covered the candidate's DAF (home state, education, optional subject, "
        "hobbies, work, achievements) and every member has had at least one full round, then the Chairman closes naturally.\n"
    )
    if must_close:
        timing += "The board has run its full course. The Chairman must give a short, warm closing remark and END now. Set \"closing\": true. Do not ask another question.\n"
    elif wrap:
        timing += "The board has covered a lot. Begin wrapping up: at most one or two final questions, then the Chairman closes. You MAY set \"closing\": true with a warm closing remark.\n"
    elif before_min:
        timing += ("The interview is still early — there is much more of the DAF to explore. Do NOT close yet; "
                   "keep the conversation going and hand off between members. \"closing\" MUST be false.\n")

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
    before_min = (not must_close) and (not wrap) and elapsed_s < INTERVIEW_MIN_SECONDS
    prompt = _build_director_prompt(daf, elapsed_s, wrap, must_close, before_min)
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
    elif before_min:
        # Never let the board wrap up before the minimum — there's more DAF to cover.
        closing = False
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


# ── DAF profile (one per user) ────────────────────────────────────────────────
def _daf_has_content(daf: Optional[dict]) -> bool:
    """A DAF counts as 'filled' once the core identifying fields are present."""
    if not isinstance(daf, dict):
        return False
    p = daf.get("personal_details", {}) or {}
    grad = (daf.get("educational_details", {}) or {}).get("graduation", {}) or {}
    return bool((p.get("name") or "").strip() and (p.get("home_state") or "").strip()
                and (grad.get("degree") or grad.get("discipline")))


def get_daf_payload(user_id: str) -> Dict[str, Any]:
    uid = (user_id or "").strip()
    if not uid:
        raise ValueError("Authentication required")
    doc = daf_profiles_collection().find_one({"_id": uid})
    daf = (doc or {}).get("daf") if doc else None
    return {
        "daf": daf,
        "template": DAF_TEMPLATE,
        "filled": _daf_has_content(daf),
        "updated_at": (doc or {}).get("updated_at") if doc else None,
    }


def save_daf_payload(user_id: str, daf: dict) -> Dict[str, Any]:
    uid = (user_id or "").strip()
    if not uid:
        raise ValueError("Authentication required")
    if not isinstance(daf, dict) or not daf:
        raise ValueError("A DAF is required")
    if not _daf_has_content(daf):
        raise ValueError("Please fill at least your name, home state and graduation details.")
    now = _now_iso()
    daf_profiles_collection().update_one(
        {"_id": uid},
        {"$set": {"daf": daf, "user_id": uid, "updated_at": now},
         "$setOnInsert": {"created_at": now}},
        upsert=True,
    )
    logger.info("daf saved user=%s", uid)
    return {"daf": daf, "filled": True, "updated_at": now}


def _resolve_daf(user_id: str, daf: Optional[dict]) -> Dict[str, Any]:
    """Interviews run on the candidate's own stored DAF. An explicit DAF in the
    request (rare) wins; otherwise load the saved profile and require it."""
    if isinstance(daf, dict) and _daf_has_content(daf):
        return daf
    doc = daf_profiles_collection().find_one({"_id": (user_id or "").strip()})
    stored = (doc or {}).get("daf") if doc else None
    if _daf_has_content(stored):
        return stored
    raise ValueError("Please fill your DAF before starting the interview.")


# ── Public API ─────────────────────────────────────────────────────────────--
def start_interview_payload(user_id: str, daf: Optional[dict] = None) -> Dict[str, Any]:
    resolved_daf = _resolve_daf(user_id, daf)
    # Free while within the free allowance, else deduct / raise 402 — before any LLM cost.
    from . import billing_domain as billing
    billing.charge_fixed(user_id, billing.INTERVIEW, {"kind": "interview_start"})
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
    # After the minimum, the board may start wrapping once it has had enough rounds;
    # otherwise it keeps going. Length is question-driven, not a fixed countdown.
    wrap = (not must_close) and elapsed >= INTERVIEW_MIN_SECONDS and (
        elapsed >= (INTERVIEW_MAX_SECONDS - WRAP_WINDOW_SECONDS) or question_count >= 32
    )

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
