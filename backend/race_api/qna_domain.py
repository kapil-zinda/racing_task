import json
import re
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from pymongo import ASCENDING, DESCENDING

from .constants import PLAYERS
from .context import qna_messages_collection, qna_sessions_collection, settings
from .pdf_search_domain import search_pdf

_qna_indexes_ensured = False


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _chat_model() -> str:
    return (settings().get("openai_chat_model") or "gpt-5.4").strip() or "gpt-5.4"


def _new_session_id() -> str:
    return f"qna_session:{uuid.uuid4().hex}"


def _new_message_id() -> str:
    return f"qna_msg:{uuid.uuid4().hex}"


def _ensure_qna_indexes() -> None:
    global _qna_indexes_ensured
    if _qna_indexes_ensured:
        return
    sessions = qna_sessions_collection()
    messages = qna_messages_collection()
    sessions.create_index([("user_id", ASCENDING), ("updated_at", DESCENDING)])
    sessions.create_index([("created_at", DESCENDING)])
    messages.create_index([("session_id", ASCENDING), ("created_at", ASCENDING)])
    messages.create_index([("session_id", ASCENDING), ("role", ASCENDING)])
    _qna_indexes_ensured = True


def _validate_user(user_id: str) -> str:
    uid = (user_id or "").strip()
    if not uid:
        raise ValueError("Invalid user_id")
    return uid


def _normalize_indices(raw: Any, max_len: int) -> List[int]:
    if not isinstance(raw, list):
        return []
    out: List[int] = []
    for value in raw:
        try:
            idx = int(value)
        except Exception:  # noqa: BLE001
            continue
        if 1 <= idx <= max_len and idx not in out:
            out.append(idx)
    return out


def _normalize_citation_lines(raw: Any, max_len: int) -> List[Dict[str, Any]]:
    if not isinstance(raw, list):
        return []
    out: List[Dict[str, Any]] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        text = str(item.get("text") or "").strip()
        if not text:
            continue
        try:
            source_index = int(item.get("source_index"))
        except Exception:  # noqa: BLE001
            continue
        if 1 <= source_index <= max_len:
            out.append({"text": text, "source_index": source_index})
    return out


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


def _openai_api_key() -> str:
    return (settings().get("openai_api_key") or "").strip()


def _invoke_openai_text(system_prompt: str, user_content: str) -> str:
    api_key = _openai_api_key()
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY is not configured")

    try:
        from openai import OpenAI
    except ImportError as err:  # pragma: no cover
        raise RuntimeError("OpenAI dependency is missing. Install openai in the backend environment.") from err

    client = OpenAI(api_key=api_key)
    model = _chat_model()
    try:
        response = client.responses.create(
            model=model,
            input=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_content},
            ],
        )
        text = getattr(response, "output_text", "") or ""
        if text.strip():
            return text.strip()
    except Exception:
        # Some older deployment models may still be chat-completions only.
        pass

    response = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_content},
        ],
    )
    choices = getattr(response, "choices", []) or []
    if choices:
        message = getattr(choices[0], "message", None)
        content = getattr(message, "content", "") if message is not None else ""
        if content:
            return str(content).strip()
    return ""


def _message_text(message: Dict[str, Any], max_chars: int = 900) -> str:
    text = re.sub(r"\s+", " ", str(message.get("text") or "").strip())
    if len(text) <= max_chars:
        return text
    return f"{text[:max_chars].rstrip()}..."


def _conversation_history_text(messages: List[Dict[str, Any]]) -> str:
    if not messages:
        return "No prior conversation in this chat."
    lines: List[str] = []
    for msg in messages[-16:]:
        role = str(msg.get("role") or "").strip().lower()
        if role not in {"user", "assistant"}:
            continue
        label = "User" if role == "user" else "Assistant"
        text = _message_text(msg)
        if text:
            lines.append(f"{label}: {text}")
    return "\n".join(lines) if lines else "No prior conversation in this chat."


def _retrieval_query(question: str, messages: List[Dict[str, Any]]) -> str:
    parts: List[str] = []
    for msg in messages[-8:]:
        if str(msg.get("role") or "").strip().lower() != "user":
            continue
        text = _message_text(msg, max_chars=180)
        if text:
            parts.append(text)
    parts.append((question or "").strip())
    query = " ".join(parts)
    query = re.sub(r"\s+", " ", query).strip()
    return query[:1200] or (question or "").strip()


def _fallback_title(question: str) -> str:
    clean = re.sub(r"\s+", " ", (question or "").strip())
    clean = re.sub(r"[<>[\]{}]", "", clean).strip(" .,:;!?\"'")
    if not clean:
        return "Study Chat"
    words = clean.split()
    title = " ".join(words[:7]).strip()
    if len(title) > 60:
        title = title[:60].rsplit(" ", 1)[0].strip() or title[:60].strip()
    return title or "Study Chat"


def _clean_generated_title(raw: str, fallback: str) -> str:
    title = re.sub(r"\s+", " ", str(raw or "").strip())
    title = re.sub(r"^(title\s*:\s*)", "", title, flags=re.IGNORECASE).strip()
    title = title.strip("`*_# \t\r\n\"'")
    title = re.sub(r"[<>[\]{}]", "", title).strip(" .,:;!?\"'")
    if not title or title.lower() in {"new chat", "chat", "untitled"}:
        return fallback
    words = title.split()
    if len(words) > 7:
        title = " ".join(words[:7])
    if len(title) > 60:
        title = title[:60].rsplit(" ", 1)[0].strip() or title[:60].strip()
    return title or fallback


def _should_generate_title(session: Dict[str, Any]) -> bool:
    title = str(session.get("title") or "").strip()
    auto = bool(session.get("title_auto_generated", False))
    message_count = int(session.get("message_count", 0) or 0)
    if not title or title.lower() == "new chat":
        return True
    return auto and message_count <= 6


def _generate_session_title(question: str, answer: str, previous_messages: List[Dict[str, Any]]) -> str:
    fallback = _fallback_title(question)
    history = _conversation_history_text(previous_messages[-6:])
    system_prompt = (
        "You create short names for study chat sessions. "
        "Return only the title text. Use 3 to 7 words. Do not use quotes, markdown, or punctuation at the end."
    )
    user_content = (
        "Create a short chat title for this study conversation.\n"
        "Rules: 3 to 7 words, no quotes, no punctuation at the end, no prefix, not 'New Chat'.\n\n"
        f"Previous conversation:\n{history}\n\n"
        f"Latest user question: {question}\n\n"
        f"Assistant answer summary/source-grounded answer:\n{_message_text({'text': answer}, max_chars=700)}"
    )
    try:
        return _clean_generated_title(_invoke_openai_text(system_prompt, user_content), fallback)
    except Exception:  # noqa: BLE001
        return fallback


def _run_grounded_answer(
    question: str,
    course: str = "",
    limit: int = 8,
    user_id: str = "",
    conversation_messages: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    q = (question or "").strip()
    if not q:
        raise ValueError("question is required")
    lim = max(3, min(int(limit or 8), 12))
    history_messages = conversation_messages or []
    history_text = _conversation_history_text(history_messages)
    search_query = _retrieval_query(q, history_messages)

    source_payload = search_pdf(search_query, lim, course, user_id=user_id)
    raw_sources = source_payload.get("results", []) or []
    if not raw_sources:
        return {
            "question": q,
            "answer": "I could not find relevant references in your indexed content.",
            "course": source_payload.get("course", "global"),
            "sources": [],
            "used_source_indices": [],
            "retrieval_query": search_query,
        }

    numbered_sources: List[Dict[str, Any]] = []
    for idx, src in enumerate(raw_sources, start=1):
        numbered_sources.append(
            {
                "index": idx,
                "doc_id": src.get("doc_id", ""),
                "file_name": src.get("file_name", ""),
                "course": src.get("course", ""),
                "course_label": src.get("course_label", src.get("course", "")),
                "page_number": int(src.get("page_number", 1) or 1),
                "snippet": src.get("snippet", ""),
                "pdf_url": src.get("pdf_url", ""),
                "source_url": src.get("pdf_url", ""),
                "source_type": "pdf",
            }
        )

    sources_json = json.dumps(numbered_sources, ensure_ascii=True)

    system_prompt = """
    You are a UPSC preparation buddy who helps the user study from available sources in a clear, conversational, exam-oriented way.

    Your tone should feel like a serious, helpful study partner — not like a search engine, not like a robotic assistant, and not like a generic chatbot.
    Speak naturally, simply, and in a way that helps revision and understanding.

    YOUR ROLE
    - Help the user understand topics from the available sources.
    - Answer like a UPSC preparation companion would explain to a friend.
    - Keep the language natural, clear, and study-focused.
    - Make answers feel human, smooth, and useful for preparation.
    - Do not sound mechanical.

    GROUNDING RULE
    - You must answer only from retrieved searchable PDF source chunks.
    - Retrieved searchable PDF source chunks are the only factual source of truth.
    - Conversation history is context only. Use it to understand follow-up questions and references like "it", "this", or "the above".
    - Never treat conversation history as factual support unless the same fact is supported by retrieved PDF source chunks.
    - Do not invent facts.
    - Do not add outside knowledge unless it is clearly supported by the retrieved material.
    - If the sources are incomplete, say so honestly and clearly.

    AVAILABLE SOURCES
    - The user message will include numbered source chunks retrieved from the user's searchable PDF index.
    - Use only those numbered source chunks for factual claims.
    - If the retrieved chunks are weak, incomplete, or off-topic, say what is missing instead of filling gaps.

    SEARCH MINDSET
    While searching, think like a sincere UPSC study partner:
    - What exact thing is the user trying to understand?
    - What sub-parts are needed for a proper answer?
    - What terms might appear differently in source material?
    - What supporting context is needed so the answer becomes useful for revision?

    ANSWER STYLE
    Your answer should:
    - feel conversational and human
    - sound like a UPSC preparation friend explaining the topic
    - be concise but meaningful
    - be easy to revise from
    - directly answer the user's doubt
    - avoid robotic phrasing
    - avoid sounding like “according to search results…” unless absolutely necessary

    GOOD STYLE EXAMPLE
    Instead of:
    “This topic refers to X. It has three features.”
    Say things like:
    “Simply put, this means X.”
    “The easiest way to understand it is this…”
    “In UPSC terms, you can remember it under three parts…”
    “The core point here is…”
    “If asked in exam language, you can write…”

    Do not overdo casual language. Stay serious, respectful, and exam-focused.

    CITATION RULE
    Cite important supported claims inline using exactly this format:
    {supporting_text}<source n>

    Do not use [n] style citations.
    Do not dump citations everywhere.
    Use citations for the important factual or defining points.

    SOURCE HANDLING
    - Use only supported claims.
    - Prefer directly relevant sources.
    - If multiple sources are needed, combine them carefully.
    - If sources disagree, mention that briefly and honestly.
    - Never fabricate source numbers, quotes, or links.

    WHEN SOURCES ARE INSUFFICIENT
    If the sources do not fully answer the question:
    - say that clearly
    - mention what part is missing
    - still provide whatever is supported
    - do not pretend certainty

    QUALITY CHECK BEFORE FINAL ANSWER
    Before giving the final answer, make sure:
    - You covered the important parts of the question.
    - The answer sounds natural and conversational.
    - The answer is useful for UPSC preparation.
    - Important claims are supported by sources.
    - Citations are attached to the important supported parts.

    OUTPUT FORMAT
    Return STRICT JSON only with these keys:
    - answer: string
    - source_indices: array of ints
    - answer_lines: array of objects with:
    - text: string
    - source_index: int

    OUTPUT REQUIREMENTS
    - `answer` should contain the final conversational UPSC-style answer with inline citations.
    - `source_indices` should contain only the sources actually used.
    - `answer_lines` should contain grounded factual lines only.
    - Each answer_lines entry must map one supported line to one source index.
    - Do not output markdown fences.
    - Do not output any text outside the JSON.

    PRIORITY ORDER
    1. proper retrieval
    2. grounded answer
    3. conversational UPSC-buddy style
    4. useful exam-oriented clarity
    5. strict JSON format
    """

    user_content = (
        "Conversation history for context only:\n"
        f"{history_text}\n\n"
        "Current user question:\n"
        f"{q}\n\n"
        "Retrieved searchable PDF source chunks as JSON:\n"
        f"{sources_json}\n\n"
        "Important: answer the current question using only the retrieved searchable PDF sources."
    )
    content = _invoke_openai_text(system_prompt, user_content)

    parsed_answer = content
    used_indices: List[int] = []
    citation_lines: List[Dict[str, Any]] = []
    try:
        parsed = json.loads(content)
        if isinstance(parsed, dict):
            candidate_answer = parsed.get("answer")
            if isinstance(candidate_answer, str) and candidate_answer.strip():
                parsed_answer = candidate_answer.strip()
            used_indices = _normalize_indices(parsed.get("source_indices"), len(numbered_sources))
            citation_lines = _normalize_citation_lines(parsed.get("answer_lines"), len(numbered_sources))
    except Exception:  # noqa: BLE001
        used_indices = []
        citation_lines = []

    if not used_indices:
        used_indices = [src["index"] for src in numbered_sources[: min(3, len(numbered_sources))]]
    used_sources = [src for src in numbered_sources if src["index"] in set(used_indices)]
    if not citation_lines and parsed_answer:
        first_source = used_indices[0] if used_indices else 1
        lines = [ln.strip() for ln in parsed_answer.split("\n") if ln.strip()]
        citation_lines = [{"text": ln, "source_index": first_source} for ln in lines]

    # Normalize old-style [n] citations into requested <source n> style when possible.
    parsed_answer = re.sub(r"\[(\d+)\]", r"<source \1>", parsed_answer)

    return {
        "question": q,
        "answer": parsed_answer,
        "course": source_payload.get("course", "global"),
        "sources": used_sources,
        "used_source_indices": used_indices,
        "citation_lines": citation_lines,
        "retrieval_query": search_query,
    }


def create_qna_session(user_id: str, title: str = "") -> Dict[str, Any]:
    _ensure_qna_indexes()
    uid = _validate_user(user_id)
    now = _now()
    sid = _new_session_id()
    clean_title = (title or "").strip() or "New Chat"
    title_auto_generated = not clean_title or clean_title.lower() == "new chat"
    doc = {
        "_id": sid,
        "doc_type": "qna_session",
        "user_id": uid,
        "title": clean_title,
        "title_auto_generated": title_auto_generated,
        "title_source_message_count": 0,
        "last_question": "",
        "message_count": 0,
        "created_at": now,
        "updated_at": now,
    }
    qna_sessions_collection().insert_one(doc)
    return {"session": doc}


def list_qna_sessions(user_id: str) -> Dict[str, Any]:
    _ensure_qna_indexes()
    uid = _validate_user(user_id)
    sessions = list(
        qna_sessions_collection()
        .find({"doc_type": "qna_session", "user_id": uid})
        .sort("updated_at", -1)
    )
    return {"sessions": sessions}


def get_qna_messages(session_id: str, user_id: str) -> Dict[str, Any]:
    _ensure_qna_indexes()
    sid = (session_id or "").strip()
    uid = _validate_user(user_id)
    if not sid:
        raise ValueError("session_id is required")
    session = qna_sessions_collection().find_one({"_id": sid, "doc_type": "qna_session", "user_id": uid})
    if not session:
        raise LookupError("QnA session not found")
    messages = list(
        qna_messages_collection()
        .find({"session_id": sid, "doc_type": "qna_message"})
        .sort("created_at", 1)
    )
    return {"session": session, "messages": messages}


def ask_qna_in_session(session_id: str, question: str, course: str = "", limit: int = 8, user_id: str = "") -> Dict[str, Any]:
    _ensure_qna_indexes()
    sid = (session_id or "").strip()
    uid = _validate_user(user_id)
    if not sid:
        raise ValueError("session_id is required")
    session = qna_sessions_collection().find_one({"_id": sid, "doc_type": "qna_session", "user_id": uid})
    if not session:
        raise LookupError("QnA session not found")
    q = (question or "").strip()
    if not q:
        raise ValueError("question is required")

    previous_messages = list(
        qna_messages_collection()
        .find({"session_id": sid, "doc_type": "qna_message"})
        .sort("created_at", 1)
    )

    grounded = _run_grounded_answer(q, course, limit, user_id=uid, conversation_messages=previous_messages)
    now = _now()
    user_msg = {
        "_id": _new_message_id(),
        "doc_type": "qna_message",
        "session_id": sid,
        "role": "user",
        "text": q,
        "sources": [],
        "created_at": now,
    }
    qna_messages_collection().insert_one(user_msg)
    assistant_msg = {
        "_id": _new_message_id(),
        "doc_type": "qna_message",
        "session_id": sid,
        "role": "assistant",
        "text": grounded.get("answer", ""),
        "sources": grounded.get("sources", []),
        "citation_lines": grounded.get("citation_lines", []),
        "created_at": _now(),
    }
    qna_messages_collection().insert_one(assistant_msg)

    new_message_count = int(session.get("message_count", 0) or 0) + 2
    session_set = {
        "last_question": q,
        "updated_at": _now(),
    }
    if _should_generate_title(session):
        session_set["title"] = _generate_session_title(q, assistant_msg["text"], previous_messages)
        session_set["title_auto_generated"] = True
        session_set["title_source_message_count"] = new_message_count

    qna_sessions_collection().update_one(
        {"_id": sid},
        {
            "$set": session_set,
            "$inc": {"message_count": 2},
        },
    )
    updated_session = qna_sessions_collection().find_one({"_id": sid})
    return {
        "session": updated_session,
        "user_message": user_msg,
        "assistant_message": assistant_msg,
        "answer": assistant_msg["text"],
        "sources": assistant_msg["sources"],
        "used_source_indices": grounded.get("used_source_indices", []),
        "citation_lines": grounded.get("citation_lines", []),
    }
