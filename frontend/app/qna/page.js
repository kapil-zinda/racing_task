"use client";

import { useEffect, useRef, useState } from "react";
import MainMenu from "../components/MainMenu";
import ResourceInternalMenu from "../components/ResourceInternalMenu";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "";
const NOTICE_TTL_MS = 15000;
const GLOBAL_USER_STORAGE_KEY = "global_user_id";

function readGlobalUser() {
  if (typeof window === "undefined") return "kapil";
  const raw = (window.localStorage.getItem(GLOBAL_USER_STORAGE_KEY) || "kapil").toLowerCase().trim();
  return raw === "divya" ? "divya" : "kapil";
}

function renderAnswerWithInlineCitations(text, sources, onOpenSource) {
  const raw = String(text || "");
  const regex = /\{([^}]+)\}<source\s+(\d+)>/gi;
  const nodes = [];
  let last = 0;
  let match;
  while ((match = regex.exec(raw)) !== null) {
    const start = match.index;
    const end = regex.lastIndex;
    if (start > last) {
      nodes.push(raw.slice(last, start));
    }
    const label = match[1];
    const sourceIndex = Number(match[2] || 0);
    const src = Array.isArray(sources)
      ? sources.find((s) => Number(s?.index || 0) === sourceIndex) || null
      : null;
    nodes.push(
      <button
        key={`cite-${start}-${sourceIndex}`}
        className="qna-inline-cite"
        onClick={() => src && onOpenSource(src)}
        disabled={!src}
        title={src ? `Open source (${sourceIndex})` : `Source ${sourceIndex} unavailable`}
      >
        {label}
      </button>,
    );
    last = end;
  }
  if (last < raw.length) {
    nodes.push(raw.slice(last));
  }
  return nodes.length ? nodes : raw;
}

export default function QnaPage() {
  const [selectedUserId, setSelectedUserId] = useState("kapil");
  const [sessions, setSessions] = useState([]);
  const [selectedSessionId, setSelectedSessionId] = useState("");
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [error, setError] = useState("");
  const [messages, setMessages] = useState([]);
  const [sourcesOpenByMessage, setSourcesOpenByMessage] = useState({});
  const [sourcePopup, setSourcePopup] = useState({ open: false, source: null });
  const chatBottomRef = useRef(null);

  useEffect(() => {
    if (!error) return;
    const id = setTimeout(() => setError(""), NOTICE_TTL_MS);
    return () => clearTimeout(id);
  }, [error]);

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, asking]);

  const loadMessages = async (sessionId) => {
    if (!API_BASE_URL || !sessionId) return;
    setLoadingMessages(true);
    setError("");
    try {
      const res = await fetch(`${API_BASE_URL}/qna/sessions/${encodeURIComponent(sessionId)}/messages`);
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`Load messages failed: ${res.status} ${txt}`);
      }
      const data = await res.json();
      setMessages(data.messages || []);
      setSourcesOpenByMessage({});
      setSourcePopup({ open: false, source: null });
    } catch (err) {
      setError(String(err.message || err));
      setMessages([]);
    } finally {
      setLoadingMessages(false);
    }
  };

  const createSession = async (userId, title = "") => {
    if (!API_BASE_URL) return null;
    const res = await fetch(`${API_BASE_URL}/qna/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: userId, title }),
    });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`Create session failed: ${res.status} ${txt}`);
    }
    const data = await res.json();
    return data.session || null;
  };

  const loadSessions = async (userId) => {
    if (!API_BASE_URL) return;
    setLoadingSessions(true);
    setError("");
    try {
      const res = await fetch(`${API_BASE_URL}/qna/sessions?user_id=${encodeURIComponent(userId)}`);
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`Load sessions failed: ${res.status} ${txt}`);
      }
      const data = await res.json();
      let rows = data.sessions || [];
      if (!rows.length) {
        const created = await createSession(userId, "New Chat");
        rows = created ? [created] : [];
      }
      setSessions(rows);
      const sid = rows[0]?._id || "";
      setSelectedSessionId(sid);
      if (sid) await loadMessages(sid);
      else setMessages([]);
    } catch (err) {
      setError(String(err.message || err));
      setSessions([]);
      setSelectedSessionId("");
      setMessages([]);
    } finally {
      setLoadingSessions(false);
    }
  };

  useEffect(() => {
    const user = readGlobalUser();
    setSelectedUserId(user);
    loadSessions(user);
    const handler = () => {
      const next = readGlobalUser();
      setSelectedUserId(next);
      loadSessions(next);
    };
    window.addEventListener("global-user-change", handler);
    return () => window.removeEventListener("global-user-change", handler);
  }, []);

  const onCreateNewChat = async () => {
    if (!API_BASE_URL) return;
    try {
      const created = await createSession(selectedUserId, "New Chat");
      if (!created?._id) return;
      const nextSessions = [created, ...sessions];
      setSessions(nextSessions);
      setSelectedSessionId(created._id);
      setMessages([]);
      setSourcesOpenByMessage({});
      setSourcePopup({ open: false, source: null });
    } catch (err) {
      setError(String(err.message || err));
    }
  };

  const selectSession = async (sessionId) => {
    if (!sessionId || sessionId === selectedSessionId) return;
    setSelectedSessionId(sessionId);
    await loadMessages(sessionId);
  };

  const askQuestion = async () => {
    const q = question.trim();
    if (!q || !API_BASE_URL || !selectedSessionId) return;
    const userMessage = {
      _id: `tmp-user-${Date.now()}`,
      role: "user",
      text: q,
      sources: [],
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMessage]);
    setQuestion("");
    setAsking(true);
    setError("");
    try {
      const res = await fetch(`${API_BASE_URL}/qna/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: selectedSessionId,
          question: q,
          course: "",
          limit: 8,
        }),
      });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`QnA failed: ${res.status} ${txt}`);
      }
      const data = await res.json();
      const assistantMsg = data.assistant_message || null;
      if (assistantMsg) {
        setMessages((prev) => [...prev, assistantMsg]);
      }
      const session = data.session || null;
      if (session?._id) {
        setSessions((prev) => {
          const others = prev.filter((s) => s._id !== session._id);
          return [session, ...others];
        });
      } else {
        await loadSessions(selectedUserId);
      }
    } catch (err) {
      setError(String(err.message || err));
      setMessages((prev) => [
        ...prev,
        {
          _id: `tmp-assistant-error-${Date.now()}`,
          role: "assistant",
          text: "I could not answer this question right now.",
          sources: [],
          created_at: new Date().toISOString(),
        },
      ]);
    } finally {
      setAsking(false);
    }
  };

  const toggleSourcesForMessage = (messageId) => {
    setSourcesOpenByMessage((prev) => ({ ...prev, [messageId]: !prev[messageId] }));
  };

  const openSourcePopup = (source) => {
    if (!source) return;
    setSourcePopup({ open: true, source });
  };

  const closeSourcePopup = () => {
    setSourcePopup({ open: false, source: null });
  };

  return (
    <main className="app-shell">
      <div className="bg-orb orb-1" />
      <div className="bg-orb orb-2" />

      <header className="hero">
        <MainMenu active="qna" />
        <ResourceInternalMenu active="qna" />
      </header>

      <section className="pdf-search-single">
        <article className="milestone-panel">
          {!API_BASE_URL ? <p className="api-state warn">Set NEXT_PUBLIC_API_BASE_URL first.</p> : null}
          {error ? <p className="api-state error">{error}</p> : null}
          <div className="qna-layout">
            <aside className="qna-sessions">
              <div className="qna-sessions-head">
                <h3>Chats • {selectedUserId.toUpperCase()}</h3>
                <button className="btn-day secondary" onClick={onCreateNewChat}>New</button>
              </div>
              {loadingSessions ? <p className="day-state">Loading sessions...</p> : null}
              <div className="qna-sessions-list">
                {sessions.map((s) => (
                  <button
                    key={s._id}
                    className={`qna-session-item ${selectedSessionId === s._id ? "active" : ""}`}
                    onClick={() => selectSession(s._id)}
                  >
                    <div className="qna-session-title">{s.title || "New Chat"}</div>
                    <div className="qna-session-sub">{s.last_question || "No questions yet"}</div>
                  </button>
                ))}
              </div>
            </aside>

            <div className="qna-main">
              <div className="qna-chat-shell">
                <div className="qna-chat-list">
                  {loadingMessages ? <p className="day-state">Loading messages...</p> : null}
                  {!loadingMessages && messages.length === 0 ? (
                    <div className="history-item">
                      <div className="history-detail">Start by asking a question from your saved content.</div>
                    </div>
                  ) : null}
                  {messages.map((msg) => (
                    <div key={msg._id || `${msg.role}-${msg.created_at}`} className={`qna-msg qna-msg-${msg.role}`}>
                      <div className="qna-msg-bubble">
                        <div className="qna-msg-text" style={{ whiteSpace: "pre-wrap" }}>
                          {msg.role === "assistant"
                            ? renderAnswerWithInlineCitations(msg.text, msg.sources, openSourcePopup)
                            : msg.text}
                        </div>
                        {msg.role === "assistant" && Array.isArray(msg.sources) && msg.sources.length > 0 ? (
                          <div className="qna-source-chip-wrap">
                            <button className="crumb-btn" onClick={() => toggleSourcesForMessage(msg._id)}>
                              Sources ({msg.sources.length})
                            </button>
                            {sourcesOpenByMessage[msg._id]
                              ? msg.sources.map((src, idx) => (
                                  <button
                                    key={`${msg._id || "msg"}-${src.doc_id}-${src.page_number}-${idx}`}
                                    className="crumb-btn"
                                    onClick={() => openSourcePopup(src)}
                                    title={src.snippet || "Open source"}
                                  >
                                    [{src.index}] {src.file_name} • p.{src.page_number}
                                  </button>
                                ))
                              : null}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  ))}
                  {asking ? (
                    <div className="qna-msg qna-msg-assistant">
                      <div className="qna-msg-bubble">
                        <div className="qna-msg-text">Thinking...</div>
                      </div>
                    </div>
                  ) : null}
                  <div ref={chatBottomRef} />
                </div>
                <div className="qna-chat-input">
                  <textarea
                    className="task-textarea"
                    placeholder="Ask anything from your saved content..."
                    value={question}
                    onChange={(e) => setQuestion(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        askQuestion();
                      }
                    }}
                  />
                  <button className="btn-day" disabled={!question.trim() || asking || !API_BASE_URL || !selectedSessionId} onClick={askQuestion}>
                    {asking ? "Thinking..." : "Send"}
                  </button>
                </div>
              </div>
            </div>
          </div>

        </article>
      </section>

      {sourcePopup.open && sourcePopup.source ? (
        <div className="task-modal-overlay" onClick={closeSourcePopup}>
          <div className="task-modal content-preview-modal" onClick={(e) => e.stopPropagation()}>
            <div className="search-viewer-head">
              <h2 style={{ margin: 0, fontSize: 18 }}>
                {sourcePopup.source.file_name} • p.{sourcePopup.source.page_number}
              </h2>
              <button className="btn-day secondary" onClick={closeSourcePopup}>Close</button>
            </div>
            <div className="search-viewer-wrap search-viewer-wide">
              {sourcePopup.source.source_type === "image" ? (
                <img
                  className="content-preview-image"
                  src={sourcePopup.source.source_url}
                  alt={sourcePopup.source.file_name || "source"}
                />
              ) : (
                <iframe
                  title="QnA Source Viewer"
                  className="search-viewer"
                  src={`${sourcePopup.source.source_url}#page=${sourcePopup.source.page_number}&view=FitH`}
                />
              )}
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
