"use client";

import { useEffect, useRef, useState } from "react";
import MainMenu from "../components/MainMenu";
import { apiFetch, useAuth } from "../lib/auth";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "";
const MAX_SECONDS = 30 * 60;

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

const blobToBase64 = (blob) =>
  new Promise((resolve) => {
    const r = new FileReader();
    r.onloadend = () => resolve(String(r.result).split(",")[1] || "");
    r.readAsDataURL(blob);
  });

export default function InterviewPage() {
  const { auth } = useAuth();
  const [status, setStatus] = useState("idle"); // idle | starting | active | ended | report
  const [panel, setPanel] = useState([]);
  const [sessionId, setSessionId] = useState("");
  const [activeMember, setActiveMember] = useState("");
  const [question, setQuestion] = useState("");
  const [turns, setTurns] = useState([]); // {role:"assistant"|"user", member?, text}
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState("");
  const [report, setReport] = useState(null);
  const [textAnswer, setTextAnswer] = useState("");

  const startRef = useRef(0);
  const questionShownRef = useRef(0);
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const streamRef = useRef(null);
  const audioRef = useRef(null);

  useEffect(() => {
    if (status !== "active") return undefined;
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - startRef.current) / 1000)), 1000);
    return () => clearInterval(id);
  }, [status]);

  useEffect(() => () => {
    try { audioRef.current?.pause(); } catch (_) {}
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

  const startInterview = async () => {
    setError("");
    setReport(null);
    setTurns([]);
    setStatus("starting");
    try {
      const res = await apiFetch(`${API_BASE_URL}/interview/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error(await res.text());
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
      playAudio(data.audio);
    } catch (err) {
      setError(`Could not start interview: ${String(err.message || err)}`);
      setStatus("idle");
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
        { role: "user", text: data.transcript || payload.text || "(answer)" },
        { role: "assistant", member: data.panel_member, text: data.question },
      ]);
      setActiveMember(data.panel_member);
      setQuestion(data.question);
      questionShownRef.current = Date.now();
      playAudio(data.audio);
      if (data.ended) setStatus("ended");
    } catch (err) {
      setError(`Answer failed: ${String(err.message || err)}`);
    } finally {
      setBusy(false);
    }
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
      setRecording(true);
    } catch (err) {
      setError(`Microphone error: ${String(err.message || err)}`);
    }
  };

  const stopRecording = () => {
    try { recorderRef.current?.stop(); } catch (_) {}
    setRecording(false);
  };

  const sendText = async () => {
    const t = textAnswer.trim();
    if (!t) return;
    setTextAnswer("");
    await submitAnswer({ text: t });
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
    } catch (err) {
      setError(`Could not generate report: ${String(err.message || err)}`);
    } finally {
      setBusy(false);
    }
  };

  const endEarly = async () => {
    if (!window.confirm("End the interview now and get your evaluation?")) return;
    setStatus("ended");
    await fetchReport();
  };

  const remaining = Math.max(0, MAX_SECONDS - elapsed);
  const timePct = Math.min(100, (elapsed / MAX_SECONDS) * 100);

  return (
    <main className="app-shell">
      <div className="bg-orb orb-1" />
      <div className="bg-orb orb-2" />
      <header className="hero">
        <MainMenu active="interview" />
        <h1>UPSC Interview Panel</h1>
        <p className="subtext">A virtual five-member board. Speak your answers — the interview runs 20–30 minutes.</p>
      </header>

      <section className="milestone-panel">
        {!API_BASE_URL ? (
          <p className="api-state warn">Backend URL needed for the interview.</p>
        ) : (
          <>
            {error ? <p className="api-state error">{error}</p> : null}

            {status === "idle" || status === "starting" ? (
              <div className="iv-start">
                <p className="iv-intro">
                  The board (Chairman + four members) will question you on your background, current affairs,
                  ethics and your optional subject — just like the real personality test. Find a quiet room and
                  allow the microphone.
                </p>
                <button className="btn-ticket" onClick={startInterview} disabled={status === "starting"}>
                  {status === "starting" ? "Assembling the board…" : "▶ Begin Interview"}
                </button>
              </div>
            ) : null}

            {status !== "idle" && status !== "starting" ? (
              <>
                {/* Timer */}
                <div className="iv-timer">
                  <div className="iv-timer-row">
                    <span className="iv-clock">{fmt(elapsed)}</span>
                    <span className="iv-clock-sub">/ {fmt(MAX_SECONDS)} · {status === "active" ? `~${fmt(remaining)} left` : "ended"}</span>
                  </div>
                  <div className="iv-timer-bar"><div className="iv-timer-fill" style={{ width: `${timePct}%` }} /></div>
                </div>

                {/* Panel */}
                <div className="iv-panel">
                  {panel.map((m) => (
                    <div key={m.id} className={`iv-member ${activeMember === m.id ? "active" : ""} ${activeMember === m.id && speaking ? "speaking" : ""}`}>
                      <div className="iv-avatar">{m.name.charAt(0)}</div>
                      <div className="iv-member-name">{m.name}</div>
                      {activeMember === m.id ? <div className="iv-member-tag">{speaking ? "speaking…" : "asking"}</div> : null}
                    </div>
                  ))}
                </div>

                {/* Current question */}
                {status === "active" || status === "ended" ? (
                  <div className="iv-question">
                    <span className="iv-q-who">{memberName(activeMember)}</span>
                    <p className="iv-q-text">{question}</p>
                  </div>
                ) : null}

                {/* Controls */}
                {status === "active" ? (
                  <div className="iv-controls">
                    {!recording ? (
                      <button className="btn-ticket" onClick={startRecording} disabled={busy || speaking}>
                        🎙️ {busy ? "Sending…" : speaking ? "Listening to the board…" : "Answer"}
                      </button>
                    ) : (
                      <button className="meet-end" onClick={stopRecording}>■ Done answering</button>
                    )}
                    <div className="iv-text-fallback">
                      <input
                        className="task-input"
                        placeholder="…or type your answer"
                        value={textAnswer}
                        onChange={(e) => setTextAnswer(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") sendText(); }}
                        disabled={busy || recording}
                      />
                      <button className="btn-day" onClick={sendText} disabled={busy || recording || !textAnswer.trim()}>Send</button>
                    </div>
                    <button className="btn-cancel iv-end-early" onClick={endEarly} disabled={busy}>End &amp; evaluate</button>
                  </div>
                ) : null}

                {status === "ended" ? (
                  <div className="iv-controls">
                    <p className="iv-intro">The interview has concluded.</p>
                    <button className="btn-ticket" onClick={fetchReport} disabled={busy}>
                      {busy ? "Evaluating…" : "📋 View my evaluation"}
                    </button>
                  </div>
                ) : null}

                {/* Transcript */}
                {turns.length > 0 && status !== "report" ? (
                  <div className="iv-transcript">
                    {turns.map((t, i) => (
                      <div key={i} className={`iv-turn ${t.role}`}>
                        <span className="iv-turn-who">{t.role === "user" ? "You" : memberName(t.member)}</span>
                        <p>{t.text}</p>
                      </div>
                    ))}
                  </div>
                ) : null}

                {/* Report */}
                {status === "report" && report ? (
                  <div className="iv-report">
                    <h2>Evaluation</h2>
                    {report.overall ? (
                      <div className="iv-overall">
                        <div className="iv-overall-score">{report.overall.score}/10</div>
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
                              <div className="iv-quality-head">
                                <span>{label}</span><strong>{score}/10</strong>
                              </div>
                              <div className="iv-q-bar"><div className="iv-q-fill" style={{ width: `${score * 10}%` }} /></div>
                              {q.note ? <p className="iv-quality-note">{q.note}</p> : null}
                            </div>
                          );
                        })}
                      </div>
                    ) : null}

                    {report.confidence ? (
                      <div className="iv-block">
                        <h3>Confidence: {report.confidence.score}/100</h3>
                        <p>{report.confidence.note}</p>
                      </div>
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

                    <button className="btn-ticket" onClick={startInterview}>↻ New interview</button>
                  </div>
                ) : null}
              </>
            ) : null}
          </>
        )}
      </section>
    </main>
  );
}
