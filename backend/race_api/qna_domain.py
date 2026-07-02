from __future__ import annotations

import json
import re
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from pymongo import ASCENDING, DESCENDING

from .constants import PLAYERS
from .context import logger, qna_messages_collection, qna_sessions_collection, settings
from .pdf_search_domain import _normalize_course, search_pdf

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


def _message_text(message: Dict[str, Any], max_chars: int = 500) -> str:
    text = re.sub(r"\s+", " ", str(message.get("text") or "").strip())
    if len(text) <= max_chars:
        return text
    return f"{text[:max_chars].rstrip()}..."


def _conversation_history_text(messages: List[Dict[str, Any]]) -> str:
    lines: List[str] = []
    for msg in messages[-12:]:
        role = str(msg.get("role") or "").strip().lower()
        if role not in {"user", "assistant"}:
            continue
        text = _message_text(msg)
        if text:
            lines.append(f"{'User' if role == 'user' else 'Assistant'}: {text}")
    return "\n".join(lines) if lines else "No prior conversation in this chat."


def _retrieval_query(question: str, messages: List[Dict[str, Any]]) -> str:
    previous_user_questions = [
        _message_text(msg, max_chars=160)
        for msg in messages[-6:]
        if str(msg.get("role") or "").strip().lower() == "user"
    ]
    query = " ".join([*previous_user_questions, (question or "").strip()])
    return re.sub(r"\s+", " ", query).strip()[:1000] or (question or "").strip()


def _fallback_title(question: str) -> str:
    clean = re.sub(r"\s+", " ", (question or "").strip()).strip(" .,:;!?\"'")
    if not clean:
        return "Study Chat"
    title = " ".join(clean.split()[:7])
    if len(title) > 60:
        title = title[:60].rsplit(" ", 1)[0].strip() or title[:60].strip()
    return title or "Study Chat"


def _should_update_title(session: Dict[str, Any]) -> bool:
    title = str(session.get("title") or "").strip().lower()
    return not title or title == "new chat"


def _run_grounded_answer(
    question: str,
    course: str = "",
    limit: int = 8,
    user_id: str = "",
    conversation_messages: List[Dict[str, Any]] | None = None,
) -> Dict[str, Any]:
    q = (question or "").strip()
    if not q:
        raise ValueError("question is required")
    lim = max(3, min(int(limit or 8), 12))
    history_messages = conversation_messages or []
    history_text = _conversation_history_text(history_messages)
    search_query = _retrieval_query(q, history_messages)

    try:
        from langchain.agents import create_agent
        from langchain.tools import tool
        from langchain_openai import ChatOpenAI
    except ImportError as err:  # pragma: no cover
        raise RuntimeError(
            "LangChain QnA dependencies are missing. Install langchain and langchain-openai in the Lambda layer."
        ) from err

    # Sources are discovered by the agent through the search tool below, not pre-fetched.
    # We keep a registry so each retrieved chunk gets a stable index the model can cite
    # as <source n>, and so we can map those citations back to full source records after
    # the run. The same chunk (doc + page) reuses its index across repeated searches.
    source_registry: List[Dict[str, Any]] = []
    seen_keys: Dict[str, int] = {}

    @tool
    def search_reference_content(query: str) -> str:
        """Search the user's indexed reference material (their searchable PDFs) and
        return matching source chunks as JSON.

        Pass a focused, self-contained query. Resolve pronouns and follow-ups into a
        standalone question FIRST — e.g. turn "what about now?" into "What is the user's
        current role?" — because the search matches meaning, not the literal words.
        Call this multiple times with different phrasings or sub-questions if the first
        results are weak or only partially cover the question.

        Each returned chunk has an integer `index`. Cite supported claims inline as
        <source n> using those indices. Only chunks returned by this tool may be used as
        factual sources.
        """
        found = search_pdf((query or "").strip(), lim, course, user_id=user_id, include_text=True)
        results = found.get("results", []) or []
        numbered: List[Dict[str, Any]] = []
        for src in results:
            key = f"{src.get('doc_id', '')}::{int(src.get('page_number', 0) or 0)}"
            idx = seen_keys.get(key)
            if idx is None:
                idx = len(source_registry) + 1
                seen_keys[key] = idx
                source_registry.append(
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
            numbered.append(
                {
                    "index": idx,
                    "file_name": src.get("file_name", ""),
                    "page_number": int(src.get("page_number", 1) or 1),
                    "course_label": src.get("course_label", src.get("course", "")),
                    # Full page text so the model grounds on complete context, not a 240-char snippet.
                    "text": src.get("text") or src.get("snippet", ""),
                }
            )
        if not numbered:
            return json.dumps(
                {
                    "results": [],
                    "note": "No matching reference chunks were found for this query. Try a different phrasing or narrower sub-questions; if nothing is found, tell the user the material is unavailable.",
                }
            )
        return json.dumps({"results": numbered}, ensure_ascii=True)

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
    - You must answer only from retrieved sources.
    - Conversation history is only for understanding follow-up questions.
    - Do not use conversation history as factual source material unless retrieved sources support it.
    - Do not invent facts.
    - Do not add outside knowledge unless it is clearly supported by the retrieved material.
    - If the sources are incomplete, say so honestly and clearly.

    HOW TO GET SOURCES
    - You have one tool: search_reference_content(query). It searches the user's indexed
      PDFs and returns numbered source chunks. It is your ONLY source of facts.
    - You MUST call it at least once before answering. The conversation history is only
      for understanding the question — never treat it as factual source material.
    - Before searching, rewrite the user's question into a focused, standalone query.
      Resolve pronouns and follow-ups (e.g. "what about now?" -> "What is the user's
      current role?"). The search matches meaning, not literal words.
    - If the first results are weak, incomplete, or off-topic, call the tool again with
      different phrasing, or with separate sub-queries for the parts you still need.
    - Use only the chunks returned by the tool for factual claims. If, after searching,
      the material still does not cover the question, say clearly what is missing instead
      of filling gaps with outside knowledge.

    SEARCH MINDSET
    Before and between searches, think like a sincere UPSC study partner:
    - What exact thing is the user trying to understand?
    - What sub-parts are needed for a proper answer?
    - What terms might appear differently in the source material?
    - What supporting context makes the answer genuinely useful for revision?

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

    model = ChatOpenAI(model=_chat_model(), temperature=0)
    agent = create_agent(model=model, tools=[search_reference_content], system_prompt=system_prompt)
    user_content = (
        "Conversation history (for understanding the question only, not a source of facts):\n"
        f"{history_text}\n\n"
        "Current user question:\n"
        f"{q}\n\n"
        "First call search_reference_content with a focused, standalone query, then "
        "answer using only the chunks it returns."
    )
    result = agent.invoke({"messages": [{"role": "user", "content": user_content}]})
    content = _extract_answer_text(result)
    llm_tokens = _sum_llm_tokens(result)

    parsed_answer = content
    used_indices: List[int] = []
    citation_lines: List[Dict[str, Any]] = []
    try:
        parsed = json.loads(content)
        if isinstance(parsed, dict):
            candidate_answer = parsed.get("answer")
            if isinstance(candidate_answer, str) and candidate_answer.strip():
                parsed_answer = candidate_answer.strip()
            used_indices = _normalize_indices(parsed.get("source_indices"), len(source_registry))
            citation_lines = _normalize_citation_lines(parsed.get("answer_lines"), len(source_registry))
    except Exception:  # noqa: BLE001
        used_indices = []
        citation_lines = []

    if not used_indices:
        used_indices = [src["index"] for src in source_registry[: min(3, len(source_registry))]]
    used_sources = [src for src in source_registry if src["index"] in set(used_indices)]
    if not citation_lines and parsed_answer:
        first_source = used_indices[0] if used_indices else 1
        lines = [ln.strip() for ln in parsed_answer.split("\n") if ln.strip()]
        citation_lines = [{"text": ln, "source_index": first_source} for ln in lines]

    # Normalize old-style [n] citations into requested <source n> style when possible.
    parsed_answer = re.sub(r"\[(\d+)\]", r"<source \1>", parsed_answer)

    return {
        "question": q,
        "answer": parsed_answer,
        "course": _normalize_course(course) or "global",
        "sources": used_sources,
        "used_source_indices": used_indices,
        "citation_lines": citation_lines,
        "retrieval_query": search_query,
        "llm_tokens": llm_tokens,
    }


def _sum_llm_tokens(result: Any) -> int:
    total = 0
    for m in (result or {}).get("messages", []) or []:
        um = getattr(m, "usage_metadata", None)
        if isinstance(um, dict):
            total += int(um.get("total_tokens", 0) or 0)
            continue
        rm = getattr(m, "response_metadata", None) or {}
        tu = rm.get("token_usage") or rm.get("usage") or {}
        total += int((tu or {}).get("total_tokens", 0) or 0)
    return total


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

    grounded = _run_grounded_answer(q, course, limit, user_id=uid, conversation_messages=previous_messages)
    try:
        from .storage_domain import add_llm_tokens
        add_llm_tokens(uid, "qna", grounded.get("llm_tokens", 0))
    except Exception:
        logger.exception("usage add_llm_tokens (qna) failed")
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

    session_set = {
        "last_question": q,
        "updated_at": _now(),
    }
    if _should_update_title(session):
        session_set["title"] = _fallback_title(q)

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
