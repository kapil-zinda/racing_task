"use client";

import "./interview.css";
import { useCallback, useEffect, useRef, useState } from "react";
import MainMenu from "../components/MainMenu";
import Icon from "../components/Icon";
import { apiFetch, useAuth } from "../lib/auth";
import { useCredits } from "../lib/credits";
import { confirmDialog } from "../lib/dialog";
import DafForm from "./DafForm";
import styles from "./page.module.css";
import { friendlyApiError } from "../lib/errors";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "";

const QUALITY_LABELS = {
  mental_alertness: "Mental alertness",
  assimilation: "Power of assimilation",
  logical_exposition: "Clear & logical exposition",
  balance_of_judgement: "Balance of judgement",
  depth_of_interest: "Depth & variety of interest",
  social_leadership: "Social cohesion & leadership",
  integrity: "Intellectual & moral integrity",
};

function fmt(total) {
  const s = Math.max(0, Math.floor(total));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

function fmtDateTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
}

const blobToBase64 = (blob) =>
  new Promise((resolve) => {
    const r = new FileReader();
    r.onloadend = () => resolve(String(r.result).split(",")[1] || "");
    r.readAsDataURL(blob);
  });

// ── Shared report renderer (used by live "report" state and the detail view) ──
function ReportView({ report }) {
  if (!report) return null;
  return (
    <div className="iv-report">
      {report.overall ? (
        <div className="iv-overall">
          <div className={`display-num ${styles.overallNum}`}>
            {report.overall.score}
            <span className={styles.overallDen}>/10</span>
          </div>
          <p>{report.overall.verdict}</p>
        </div>
      ) : null}

      {report.qualities ? (
        <div className="iv-qualities">
          {Object.entries(QUALITY_LABELS).map(([key, label]) => {
            const q = report.qualities[key] || {};
            const score = Number(q.score || 0);
            return (
              <div key={key} className="iv-quality">
                <div className="iv-quality-head"><span>{label}</span><strong>{score}/10</strong></div>
                <div className="iv-q-bar"><div className="iv-q-fill" style={{ width: `${score * 10}%` }} /></div>
                {q.note ? <p className="iv-quality-note">{q.note}</p> : null}
              </div>
            );
          })}
        </div>
      ) : null}

      {report.confidence ? (
        <div className="iv-block"><h3>Confidence: {report.confidence.score}/100</h3><p>{report.confidence.note}</p></div>
      ) : null}
      {Array.isArray(report.interest_areas) && report.interest_areas.length ? (
        <div className="iv-block"><h3>Interest areas</h3><p>{report.interest_areas.join(", ")}</p></div>
      ) : null}
      {Array.isArray(report.strengths) && report.strengths.length ? (
        <div className="iv-block"><h3>Strengths</h3><ul>{report.strengths.map((s, i) => <li key={i}>{s}</li>)}</ul></div>
      ) : null}
      {Array.isArray(report.improvements) && report.improvements.length ? (
        <div className="iv-block"><h3>Areas to improve</h3><ul>{report.improvements.map((s, i) => <li key={i}>{s}</li>)}</ul></div>
      ) : null}
      {Array.isArray(report.contradictions) && report.contradictions.length ? (
        <div className="iv-block"><h3>Contradictions noticed</h3><ul>{report.contradictions.map((s, i) => <li key={i}>{s}</li>)}</ul></div>
      ) : null}
      {report.signals ? (
        <p className="iv-signals">
          {report.signals.answers} answers · avg {report.signals.avg_words_per_answer} words ·
          {report.signals.total_filler_words} filler words
          {report.signals.avg_response_latency_ms ? ` · avg ${Math.round(report.signals.avg_response_latency_ms / 1000)}s to respond` : ""}
        </p>
      ) : null}
    </div>
  );
}

// Pair up the stored messages into question → answer blocks for the detail view.
function QuestionByQuestion({ messages = [], panel = [] }) {
  const memberName = (id) => panel.find((m) => m.id === id)?.name || "Board";
  const blocks = [];
  let current = null;
  messages.forEach((m) => {
    if (m.role === "assistant") {
      if (current) blocks.push(current);
      current = { question: m.content, member: m.panel_member, answer: "" };
    } else if (m.role === "user") {
      if (!current) current = { question: "", member: "", answer: "" };
      current.answer = m.content;
      blocks.push(current);
      current = null;
    }
  });
  if (current) blocks.push(current);
  if (!blocks.length) return null;
  return (
    <div className="iv-qbq">
      <h3>Question by question</h3>
      {blocks.map((b, i) => (
        <div key={i} className="iv-qbq-item">
          <div className="iv-qbq-q">
            <span className="iv-q-who">{memberName(b.member)}</span>
            <p>{b.question}</p>
          </div>
          {b.answer ? (
            <div className="iv-qbq-a"><span className="iv-q-who">Your answer</span><p>{b.answer}</p></div>
          ) : <p className="iv-qbq-noans">No answer recorded.</p>}
        </div>
      ))}
    </div>
  );
}

// ── Read-only DAF summary ─────────────────────────────────────────────────────
function DafSummary({ daf }) {
  if (!daf) return null;
  const p = daf.personal_details || {};
  const edu = daf.educational_details || {};
  const grad = edu.graduation || {};
  const pg = edu.post_graduation || {};
  const ach = daf.achievements || {};
  const career = daf.career_details || {};
  const work = (daf.employment_details || {}).work_experience || [];
  const join = (a) => (a || []).filter((x) => String(x).trim()).join(", ");
  const eduLine = (s) => [s.degree || s.stream, s.discipline, s.college_university || s.school, s.board, s.year]
    .filter(Boolean).join(" · ");

  const Row = ({ label, value }) => (value ? (
    <div className="daf-view-row"><span className="daf-view-k">{label}</span><span className="daf-view-v">{value}</span></div>
  ) : null);

  return (
    <div className="daf-view">
      <div className="daf-view-group">
        <h3><Icon name="user" size={15} /> Personal</h3>
        <Row label="Name" value={p.name} />
        <Row label="Home" value={[p.home_district, p.home_state].filter(Boolean).join(", ")} />
        <Row label="Mother tongue" value={p.mother_tongue} />
        <Row label="Languages" value={join(p.languages_known)} />
        <Row label="Medium of interview" value={p.medium_of_interview} />
        <Row label="Category" value={p.category} />
      </div>
      <div className="daf-view-group">
        <h3><Icon name="book" size={15} /> Education</h3>
        <Row label="Graduation" value={eduLine(grad)} />
        <Row label="Post-graduation" value={eduLine(pg)} />
        <Row label="Class 12" value={eduLine(edu.intermediate || {})} />
        <Row label="Optional subject" value={daf.optional_subject} />
      </div>
      {work.length ? (
        <div className="daf-view-group">
          <h3><Icon name="target" size={15} /> Work experience</h3>
          {work.map((w, i) => (
            <Row key={i} label={w.designation || "Role"} value={[w.organization, w.duration].filter(Boolean).join(" · ")} />
          ))}
        </div>
      ) : null}
      <div className="daf-view-group">
        <h3><Icon name="sparkles" size={15} /> Hobbies &amp; achievements</h3>
        <Row label="Hobbies" value={join(daf.hobbies_and_interests)} />
        <Row label="Prizes & awards" value={join(ach.prizes_and_awards)} />
        <Row label="Positions" value={join(ach.positions_of_responsibility)} />
        <Row label="Extracurricular" value={join(ach.extracurricular)} />
      </div>
      <div className="daf-view-group">
        <h3><Icon name="clipboard" size={15} /> Preferences &amp; motivation</h3>
        <Row label="Service preferences" value={join(daf.service_preferences)} />
        <Row label="Cadre preferences" value={join(daf.cadre_preferences)} />
        <Row label="Why civil services" value={career.why_civil_services} />
        <Row label="Unique points" value={join(career.unique_points_in_daf)} />
      </div>
    </div>
  );
}

export default function InterviewPage() {
  useAuth();
  const { requireCredits, refreshCredits } = useCredits();
  const [mode, setMode] = useState("list"); // list | live | detail | daf
  const [interviews, setInterviews] = useState([]);
  const [listLoading, setListLoading] = useState(false);

  // detail view
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // DAF
  const [daf, setDaf] = useState(null);
  const [dafFilled, setDafFilled] = useState(false);
  const [dafUpdatedAt, setDafUpdatedAt] = useState(null);
  const [dafEditing, setDafEditing] = useState(false);
  const [dafSaving, setDafSaving] = useState(false);
  const [dafError, setDafError] = useState("");

  // live interview
  const [status, setStatus] = useState("idle"); // idle | briefing | starting | active | ended | report
  const [micTest, setMicTest] = useState("idle"); // idle | testing | ok | fail
  const [micTestNote, setMicTestNote] = useState("");
  const [panel, setPanel] = useState([]);
  const [sessionId, setSessionId] = useState("");
  const [activeMember, setActiveMember] = useState("");
  const [question, setQuestion] = useState("");
  const [turns, setTurns] = useState([]);
  const [micOn, setMicOn] = useState(false);
  const [liveTranscript, setLiveTranscript] = useState("");
  const [busy, setBusy] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [chatOpen, setChatOpen] = useState(true);
  const [error, setError] = useState("");
  const [report, setReport] = useState(null);

  const startRef = useRef(0);
  const questionShownRef = useRef(0);
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const streamRef = useRef(null);
  const audioRef = useRef(null);
  const recognitionRef = useRef(null);
  const finalCaptionRef = useRef("");

  const loadInterviews = useCallback(async () => {
    if (!API_BASE_URL) return;
    setListLoading(true);
    setError("");
    try {
      const res = await apiFetch(`${API_BASE_URL}/interview`);
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setInterviews(Array.isArray(data.interviews) ? data.interviews : []);
    } catch (_) {
      setError("Your past interviews couldn't be loaded — check your connection and refresh.");
    } finally {
      setListLoading(false);
    }
  }, []);

  const loadDaf = useCallback(async () => {
    if (!API_BASE_URL) return;
    try {
      const res = await apiFetch(`${API_BASE_URL}/interview/daf`);
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setDaf(data.daf || null);
      setDafFilled(!!data.filled);
      setDafUpdatedAt(data.updated_at || null);
    } catch (_) {
      // Non-fatal: the list still works; DAF simply reads as unfilled.
    }
  }, []);

  useEffect(() => { loadInterviews(); loadDaf(); }, [loadInterviews, loadDaf]);

  useEffect(() => {
    if (status !== "active") return undefined;
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - startRef.current) / 1000)), 1000);
    return () => clearInterval(id);
  }, [status]);

  useEffect(() => () => {
    try { audioRef.current?.pause(); } catch (_) {}
    try { recognitionRef.current?.stop(); } catch (_) {}
    streamRef.current?.getTracks?.().forEach((t) => t.stop());
  }, []);

  const playAudio = (audio) => {
    if (!audio?.base64) return;
    try {
      const src = `data:${audio.mime_type || "audio/mpeg"};base64,${audio.base64}`;
      const a = new Audio(src);
      audioRef.current = a;
      setSpeaking(true);
      a.onended = () => setSpeaking(false);
      a.onerror = () => setSpeaking(false);
      a.play().catch(() => setSpeaking(false));
    } catch (_) {
      setSpeaking(false);
    }
  };

  const memberName = (id) => panel.find((m) => m.id === id)?.name || "Board";
  // "Member 3" → "3", "Chairman" → "C". Keeps the numbered members visually distinct.
  const badgeFor = (name) => {
    const m = /(\d+)\s*$/.exec(name || "");
    return m ? m[1] : (name || "B").charAt(0).toUpperCase();
  };
  const memberInitial = (id) => badgeFor(memberName(id));

  const saveDaf = async (nextDaf) => {
    setDafSaving(true);
    setDafError("");
    try {
      const res = await apiFetch(`${API_BASE_URL}/interview/daf`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ daf: nextDaf }),
      });
      if (!res.ok) {
        let msg = await res.text();
        try { msg = JSON.parse(msg).detail || msg; } catch (_) {}
        throw new Error(msg);
      }
      const data = await res.json();
      setDaf(data.daf || nextDaf);
      setDafFilled(true);
      setDafUpdatedAt(data.updated_at || null);
      setDafEditing(false);
    } catch (err) {
      setDafError(friendlyApiError(err));
    } finally {
      setDafSaving(false);
    }
  };

  const openDaf = () => { setError(""); setDafError(""); setDafEditing(false); setMode("daf"); };

  // Step 1: the briefing. Shown before any credit is spent — the session only
  // starts when the candidate presses "Enter the interview" below.
  const startInterview = () => {
    if (!dafFilled) {
      setError("");
      setDafEditing(!daf); // straight to the form if there's nothing yet
      setMode("daf");
      return;
    }
    if (!requireCredits("interview")) return;
    setError("");
    setMicTest("idle");
    setMicTestNote("");
    setMode("live");
    setStatus("briefing");
  };

  // Briefing mic check: ask for the mic once and release it immediately.
  const testMicrophone = async () => {
    setMicTest("testing");
    setMicTestNote("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      setMicTest("ok");
    } catch (err) {
      const name = err?.name || "";
      setMicTest("fail");
      setMicTestNote(
        name === "NotAllowedError" || name === "PermissionDeniedError"
          ? "Microphone access is blocked. Allow the microphone for this site in your browser settings, then test again."
          : name === "NotFoundError" || name === "DevicesNotFoundError"
            ? "No microphone was found. Plug one in or pick an input device in your system settings, then test again."
            : "We couldn't reach your microphone. Close other apps that may be using it, then test again."
      );
    }
  };

  // Step 2: actually convene the board (this is where the credit is spent).
  const beginInterview = async () => {
    if (!requireCredits("interview")) return;
    setError("");
    setReport(null);
    setTurns([]);
    setLiveTranscript("");
    setChatOpen(true);
    setMode("live");
    setStatus("starting");
    try {
      const res = await apiFetch(`${API_BASE_URL}/interview/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (res.status === 402) { setStatus("idle"); setMode("list"); return; } // popup shown
      if (!res.ok) {
        let msg = await res.text();
        try { msg = JSON.parse(msg).detail || msg; } catch (_) {}
        throw new Error(msg);
      }
      const data = await res.json();
      setPanel(data.panel || []);
      setSessionId(data.session_id);
      setActiveMember(data.panel_member);
      setQuestion(data.question);
      setTurns([{ role: "assistant", member: data.panel_member, text: data.question }]);
      startRef.current = Date.now();
      questionShownRef.current = Date.now();
      setElapsed(0);
      setStatus("active");
      refreshCredits();
      playAudio(data.audio);
    } catch (_) {
      setError("The board couldn't be convened — check your connection and try again.");
      setStatus("idle");
      setMode("list");
    }
  };

  const submitAnswer = async (payload) => {
    if (!sessionId || busy) return;
    setBusy(true);
    setError("");
    try {
      const latency_ms = Date.now() - questionShownRef.current;
      const res = await apiFetch(`${API_BASE_URL}/interview/${sessionId}/answer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, latency_ms }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setTurns((t) => [
        ...t,
        { role: "user", text: data.transcript || "(answer)" },
        { role: "assistant", member: data.panel_member, text: data.question },
      ]);
      setActiveMember(data.panel_member);
      setQuestion(data.question);
      setLiveTranscript("");
      questionShownRef.current = Date.now();
      playAudio(data.audio);
      if (data.ended) setStatus("ended");
    } catch (_) {
      setError("Your answer didn't reach the board — check your connection and try once more.");
    } finally {
      setBusy(false);
    }
  };

  // Best-effort live captions while the candidate speaks (browser SpeechRecognition).
  const startCaptions = () => {
    const SR = typeof window !== "undefined" && (window.SpeechRecognition || window.webkitSpeechRecognition);
    if (!SR) return;
    try {
      const rec = new SR();
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = "en-IN";
      finalCaptionRef.current = "";
      rec.onresult = (e) => {
        let interim = "";
        for (let i = e.resultIndex; i < e.results.length; i += 1) {
          const chunk = e.results[i][0].transcript;
          if (e.results[i].isFinal) finalCaptionRef.current += chunk + " ";
          else interim += chunk;
        }
        setLiveTranscript((finalCaptionRef.current + interim).trim());
      };
      rec.onerror = () => {};
      recognitionRef.current = rec;
      rec.start();
    } catch (_) {}
  };

  const stopCaptions = () => {
    try { recognitionRef.current?.stop(); } catch (_) {}
    recognitionRef.current = null;
  };

  const startRecording = async () => {
    setError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      streamRef.current = stream;
      chunksRef.current = [];
      const rec = new MediaRecorder(stream);
      recorderRef.current = rec;
      rec.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunksRef.current.push(e.data); };
      rec.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" });
        stream.getTracks().forEach((t) => t.stop());
        if (blob.size === 0) return;
        const b64 = await blobToBase64(blob);
        await submitAnswer({ audio_base64: b64, audio_mime_type: blob.type || "audio/webm" });
      };
      rec.start();
      setMicOn(true);
      setLiveTranscript("");
      startCaptions();
    } catch (_) {
      setError("We couldn't reach your microphone. Check the browser permission, then tap the mic again.");
    }
  };

  const stopRecording = () => {
    stopCaptions();
    try { recorderRef.current?.stop(); } catch (_) {}
    setMicOn(false);
  };

  // The single mic control: unmute to answer, mute to send.
  const toggleMic = () => {
    if (busy || speaking) return;
    if (micOn) stopRecording();
    else startRecording();
  };

  const fetchReport = async () => {
    if (!sessionId) return;
    setBusy(true);
    setError("");
    try {
      const res = await apiFetch(`${API_BASE_URL}/interview/${sessionId}/report`, { method: "POST" });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setReport(data.report || {});
      setStatus("report");
    } catch (_) {
      setError("Your report couldn't be prepared just now — give it a moment and try again.");
    } finally {
      setBusy(false);
    }
  };

  const endEarly = async () => {
    if (!(await confirmDialog({ title: "End interview", message: "End the interview now and get your evaluation?", confirmLabel: "End & evaluate" }))) return;
    if (micOn) stopRecording();
    setStatus("ended");
    await fetchReport();
  };

  const openDetail = async (id) => {
    if (!id) return;
    setMode("detail");
    setDetail(null);
    setDetailLoading(true);
    setError("");
    try {
      const res = await apiFetch(`${API_BASE_URL}/interview/${id}`);
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setDetail(data.session || null);
    } catch (_) {
      setError("This interview couldn't be opened — go back and try again.");
    } finally {
      setDetailLoading(false);
    }
  };

  const backToList = () => {
    try { audioRef.current?.pause(); } catch (_) {}
    if (micOn) stopRecording();
    setMode("list");
    setStatus("idle");
    setSessionId("");
    setDetail(null);
    loadInterviews();
  };

  // ── Live interview stage ────────────────────────────────────────────────────
  const renderLive = () => {
    if (status === "briefing") {
      return (
        <div className={styles.briefWrap}>
          <div className={styles.briefCard}>
            <h2 className={styles.briefTitle}>Before you face the board</h2>
            <p className={styles.briefSub}>A quick word before the session begins.</p>
            <ul className={styles.briefList}>
              <li>
                <Icon name="clock" size={16} />
                <span>The board decides the length — typically 30 to 45 minutes. There&apos;s no countdown; stay until they close.</span>
              </li>
              <li>
                <Icon name="mic" size={16} />
                <span>You answer by voice. Unmute to speak; mute again to send your answer to the board.</span>
              </li>
              <li>
                <Icon name="chat" size={16} />
                <span>Live captions appear as you speak, so you can see what the board hears.</span>
              </li>
              <li>
                <Icon name="volume" size={16} />
                <span>Find a quiet room — background noise makes your answers harder to hear.</span>
              </li>
              <li>
                <Icon name="scale" size={16} />
                <span>The board stays neutral on purpose — no praise, no reaction either way. That&apos;s how the real panel behaves, not a sign of how you&apos;re doing. Your written report afterward is the real read.</span>
              </li>
            </ul>
            <div className={styles.micTest} aria-live="polite">
              {micTest === "ok" ? (
                <p className={styles.micOk}><Icon name="check-circle" size={16} /> Microphone ready</p>
              ) : (
                <>
                  {micTest === "fail" ? (
                    <p className={styles.micFail}><Icon name="warning" size={16} /> {micTestNote}</p>
                  ) : null}
                  <button className={styles.micTestBtn} onClick={testMicrophone} disabled={micTest === "testing"}>
                    <Icon name="mic" size={16} />
                    {micTest === "testing" ? "Checking your microphone…" : micTest === "fail" ? "Test again" : "Test your microphone"}
                  </button>
                </>
              )}
            </div>
            <div className={styles.briefActions}>
              <button className={styles.enterBtn} onClick={beginInterview} disabled={micTest !== "ok"}>
                <Icon name="gavel" size={16} /> Enter the interview
              </button>
              <button className="btn-cancel" onClick={backToList}>Not now</button>
            </div>
            {micTest !== "ok" ? (
              <p className={styles.enterHint}>Test your microphone first — the board can&apos;t hear you without it.</p>
            ) : null}
          </div>
        </div>
      );
    }
    if (status === "starting") {
      return (
        <div className={styles.assembleWrap}>
          <div className={styles.assembleCard}>
            <div className={styles.seatRow}>
              {["Chairman", "Member 1", "Member 2", "Member 3", "Member 4"].map((role, i) => (
                <div key={role} className={styles.seat} style={{ animationDelay: `${i * 0.3}s` }}>
                  <span className={styles.seatAvatar}>{badgeFor(role)}</span>
                  <span className={styles.seatRole}>{role}</span>
                </div>
              ))}
            </div>
            <p className={styles.assembleLine} aria-live="polite">The board is taking their seats…</p>
          </div>
        </div>
      );
    }
    if (status === "report" && report) {
      return (
        <>
          <h2 className="iv-report-title">Evaluation</h2>
          <ReportView report={report} />
          <QuestionByQuestion
            messages={turns.map((t) => ({ role: t.role, panel_member: t.member, content: t.text }))}
            panel={panel}
          />
          <div className="iv-controls">
            <button className="btn-day" onClick={startInterview}><Icon name="refresh" size={16} /> New interview</button>
            <button className="btn-cancel" onClick={backToList}>Back to interviews</button>
          </div>
        </>
      );
    }

    // active / ended: the panel stage
    return (
      <div className={`ivx-stage ${chatOpen ? "chat-open" : ""}`}>
        <div className="ivx-main">
          <div className="ivx-topbar">
            <span className="ivx-elapsed"><Icon name="clock" size={15} /> {fmt(elapsed)}</span>
            <div className="ivx-panelrow">
              {panel.map((m) => (
                <div key={m.id} className={`ivx-pill ${activeMember === m.id ? "active" : ""}`} title={m.name}>
                  <span className="ivx-pill-dot">{badgeFor(m.name)}</span>
                  <span className="ivx-pill-name">{m.name}</span>
                </div>
              ))}
            </div>
            <button className="ivx-chat-toggle" onClick={() => setChatOpen((v) => !v)}>
              <Icon name="chat" size={15} /> Transcript
              <span className="ivx-chat-count">{turns.length}</span>
            </button>
          </div>

          <div className="ivx-center">
            <div className={`ivx-avatar ${speaking ? "speaking" : ""}`}>
              <span>{memberInitial(activeMember)}</span>
            </div>
            <div className="ivx-active-name">
              {memberName(activeMember)}
              <span className="ivx-active-tag">{speaking ? "speaking…" : status === "ended" ? "" : "asking"}</span>
            </div>

            {status === "ended" ? (
              <div className="ivx-question ended" aria-live="polite">
                <p>{question}</p>
                <div className={styles.concluded}>
                  <p className={styles.concludedLead}>
                    That&apos;s a full board interview — {Math.max(1, Math.round(elapsed / 60))} minutes.
                  </p>
                  <p className={styles.concludedSub}>Your report is being prepared.</p>
                  <p className={styles.concludedNote}>
                    However neutral the room felt, that was by design — it&apos;s not a signal of how you did. The report below is the real assessment.
                  </p>
                </div>
                <button className="btn-day" onClick={fetchReport} disabled={busy}>
                  <Icon name="clipboard" size={16} /> {busy ? "Evaluating…" : "View my evaluation"}
                </button>
              </div>
            ) : (
              <>
                <div className="ivx-question" aria-live="polite">
                  <span className="iv-q-who">{memberName(activeMember)}</span>
                  <p className="ivx-q-text">{question}</p>
                </div>

                {(micOn || liveTranscript || busy) ? (
                  <div className={`ivx-answer ${micOn ? "live" : ""} ${busy ? "processing" : ""}`}>
                    <span className="iv-q-who">{busy ? "Sending your answer" : "You"}</span>
                    <p>{liveTranscript || (micOn ? "Listening… speak your answer." : busy ? "The board is considering your answer…" : "")}</p>
                  </div>
                ) : null}
              </>
            )}
          </div>

          {status === "active" ? (
            <div className="ivx-controls">
              <button
                className={`meet-ctrl ${micOn ? "ctrl-live" : "ctrl-muted"}`}
                onClick={toggleMic}
                disabled={busy || speaking}
                title={micOn ? "Mute & send answer" : "Unmute to answer"}
                aria-label={micOn ? "Mute to send your answer to the board" : "Unmute to answer; mute again to send"}
              >
                <Icon name={micOn ? "mic" : "mic-off"} size={20} />
              </button>
              <span className="ivx-ctrl-hint" role="status" aria-live="polite">
                {speaking ? "The board is speaking…" : busy ? "Sending…" : micOn ? "Recording — tap to send" : "Tap the mic to answer"}
              </span>
              <button className="meet-end" onClick={endEarly} disabled={busy} title="End interview">
                <Icon name="phone-off" size={18} /> End
              </button>
            </div>
          ) : null}
        </div>

        {chatOpen ? (
          <aside className="ivx-chat">
            <div className="ivx-chat-head">
              <span>Conversation</span>
              <button className="ivx-chat-close" onClick={() => setChatOpen(false)} aria-label="Hide transcript"><Icon name="x" size={16} /></button>
            </div>
            <div className="ivx-chat-body">
              {turns.map((t, i) => (
                <div key={i} className={`iv-turn ${t.role}`}>
                  <span className="iv-turn-who">{t.role === "user" ? "You" : memberName(t.member)}</span>
                  <p>{t.text}</p>
                </div>
              ))}
              {micOn && liveTranscript ? (
                <div className="iv-turn user pending">
                  <span className="iv-turn-who">You (speaking)</span>
                  <p>{liveTranscript}</p>
                </div>
              ) : null}
            </div>
          </aside>
        ) : null}
      </div>
    );
  };

  return (
    <main className="app-shell">
      <div className="bg-orb orb-1" />
      <div className="bg-orb orb-2" />
      <header className="hero">
        <MainMenu active="interview" />
        <div className="iv-hero-row">
          <div>
            <h1>UPSC Interview Panel</h1>
            <p className="subtext">A virtual five-member board that interviews you on your own DAF. Speak your answers.</p>
          </div>
          {mode === "list" ? (
            <button className="iv-daf-btn" onClick={openDaf}>
              <Icon name="file" size={16} /> {dafFilled ? "View DAF" : "Fill your DAF"}
            </button>
          ) : null}
        </div>
      </header>

      <section className="milestone-panel">
        {!API_BASE_URL ? (
          <p className="api-state warn">Backend URL needed for the interview.</p>
        ) : (
          <>
            {error ? <p className="api-state error">{error}</p> : null}

            {/* ── LIST VIEW ── */}
            {mode === "list" ? (
              <div className="iv-list">
                <button className="iv-list-item iv-list-new" onClick={startInterview}>
                  <span className="iv-list-new-icon"><Icon name="plus" size={22} /></span>
                  <span className="iv-list-new-text">
                    <strong>Start a new interview</strong>
                    <span>{dafFilled
                      ? "Face the virtual board and get a full personality-test evaluation."
                      : "Fill your DAF first — the board will interview you on it."}</span>
                  </span>
                </button>

                {listLoading ? <p className="day-state">Loading interviews…</p> : null}
                {!listLoading && interviews.length === 0 ? (
                  <p className="iv-empty">No interviews yet. Start your first one above.</p>
                ) : null}
                {interviews.map((it) => (
                  <button key={it.session_id} className="iv-list-item" onClick={() => openDetail(it.session_id)}>
                    <span className="iv-list-main">
                      <strong>{fmtDateTime(it.created_at)}</strong>
                      <span className="iv-list-sub">
                        {it.question_count} question{it.question_count === 1 ? "" : "s"}
                        {" · "}
                        <span className={`iv-status iv-status-${it.status}`}>
                          {it.status === "active" ? "interrupted" : it.status}
                        </span>
                      </span>
                    </span>
                    <span className="iv-list-score">
                      {it.overall_score != null ? (
                        <span className="iv-list-score-num">{it.overall_score}/10</span>
                      ) : it.status === "active" ? (
                        <span className={styles.interruptedTag}>No report</span>
                      ) : (
                        <span className="iv-list-score-num muted">—</span>
                      )}
                      <Icon name="chevron-right" size={18} />
                    </span>
                  </button>
                ))}
              </div>
            ) : null}

            {/* ── DAF VIEW / EDIT ── */}
            {mode === "daf" ? (
              dafEditing ? (
                <DafForm
                  initial={daf}
                  saving={dafSaving}
                  error={dafError}
                  onSave={saveDaf}
                  onCancel={() => (daf ? setDafEditing(false) : backToList())}
                />
              ) : (
                <div className="daf-view-wrap">
                  <div className="iv-hero-row">
                    <button className="iv-back" onClick={backToList}><Icon name="arrow-left" size={16} /> Back to interviews</button>
                    <button className="btn-day" onClick={() => { setDafError(""); setDafEditing(true); }}>
                      <Icon name="edit" size={15} /> {daf ? "Update DAF" : "Fill DAF"}
                    </button>
                  </div>
                  {daf ? (
                    <>
                      <div className="daf-view-head">
                        <h2>Your DAF</h2>
                        {dafUpdatedAt ? <span className="daf-updated">Updated {fmtDateTime(dafUpdatedAt)}</span> : null}
                      </div>
                      <DafSummary daf={daf} />
                      <div className="iv-controls">
                        <button className="btn-day" onClick={() => { setMode("list"); setTimeout(startInterview, 0); }}>
                          <Icon name="gavel" size={16} /> Start interview
                        </button>
                      </div>
                    </>
                  ) : (
                    <p className="iv-empty">You haven&apos;t filled your DAF yet. Click <strong>Fill DAF</strong> above to begin.</p>
                  )}
                </div>
              )
            ) : null}

            {/* ── DETAIL VIEW ── */}
            {mode === "detail" ? (
              <div className="iv-detail">
                <button className="iv-back" onClick={backToList}><Icon name="arrow-left" size={16} /> Back to interviews</button>
                {detailLoading ? <p className="day-state">Loading…</p> : null}
                {!detailLoading && detail ? (
                  <>
                    <div className="iv-detail-head">
                      <h2>Interview · {fmtDateTime(detail.started_at)}</h2>
                    </div>
                    {detail.report ? (
                      <ReportView report={detail.report} />
                    ) : detail.status === "active" ? (
                      <div className={styles.interruptedNote}>
                        <Icon name="warning" size={16} />
                        <div>
                          <p>This session was interrupted and can&apos;t be resumed yet.</p>
                          <p>The questions and answers below were saved, but the board never issued a report.</p>
                        </div>
                      </div>
                    ) : (
                      <p className="iv-empty">This interview has no evaluation report.</p>
                    )}
                    <QuestionByQuestion messages={detail.messages || []} panel={detail.panel || []} />
                  </>
                ) : null}
              </div>
            ) : null}

            {/* ── LIVE INTERVIEW ── */}
            {mode === "live" ? renderLive() : null}
          </>
        )}
      </section>
    </main>
  );
}
