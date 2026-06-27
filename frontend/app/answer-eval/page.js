"use client";

import { useEffect, useRef, useState } from "react";
import MainMenu from "../components/MainMenu";
import { apiFetch } from "../lib/auth";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "";

function fmtDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function EvalResult({ data }) {
  const result = data?.result;
  if (!result) return null;
  return (
    <div className="ae-result">
      <div className="ae-score">
        <div className="ae-score-num">{result.total_awarded}<span>/{result.total_max}</span></div>
        <div className="ae-actions">
          {data.marked_url ? <a className="btn-day" href={data.marked_url} target="_blank" rel="noreferrer">Open marked PDF</a> : null}
          {data.marked_download_url ? <a className="btn-day" href={data.marked_download_url}>Download marked PDF</a> : null}
        </div>
      </div>

      {result.overall_remark ? (
        <div className="ae-block"><h3>Examiner remark</h3><p>{result.overall_remark}</p></div>
      ) : null}

      {(result.questions || []).map((q, i) => (
        <div key={i} className="ae-question">
          <div className="ae-q-head">
            <strong>Q{i + 1}</strong>
            <span className="ae-q-mark">{q.awarded_marks}/{q.max_marks}</span>
          </div>
          {q.question_text ? <p className="ae-q-text">{q.question_text}</p> : null}
          {q.breakdown ? (
            <div className="ae-breakdown">
              {Object.entries(q.breakdown).map(([k, v]) => (
                <span key={k} className="ae-chip">{k}: {v}</span>
              ))}
            </div>
          ) : null}
          {(q.comments || []).length ? (
            <ul className="ae-comments">
              {q.comments.map((c, j) => (
                <li key={j} className={`ae-comment ${c.tag || ""}`}>
                  <span className="ae-comment-page">p{c.page}</span> {c.text}
                </li>
              ))}
            </ul>
          ) : null}
          {(q.points_missed || []).length ? (
            <div className="ae-block"><h4>Points missed</h4><ul>{q.points_missed.map((p, k) => <li key={k}>{p}</li>)}</ul></div>
          ) : null}
        </div>
      ))}

      {(result.strengths || []).length ? (
        <div className="ae-block"><h3>Strengths</h3><ul>{result.strengths.map((s, i) => <li key={i}>{s}</li>)}</ul></div>
      ) : null}
      {(result.improvements || []).length ? (
        <div className="ae-block"><h3>Improvements</h3><ul>{result.improvements.map((s, i) => <li key={i}>{s}</li>)}</ul></div>
      ) : null}

      {data.marked_url ? <iframe className="ae-pdf" src={data.marked_url} title="Marked answer" /> : null}
    </div>
  );
}

export default function AnswerEvalPage() {
  const [tab, setTab] = useState("submit"); // "submit" | "answers"
  const [file, setFile] = useState(null);
  const [question, setQuestion] = useState("");
  const [maxMarks, setMaxMarks] = useState("");
  const [status, setStatus] = useState("idle"); // idle | uploading | processing | completed | failed
  const [data, setData] = useState(null);        // result currently shown
  const [detail, setDetail] = useState(false);   // showing a specific eval inside My Answers
  const [error, setError] = useState("");
  const [list, setList] = useState([]);
  const [listLoading, setListLoading] = useState(false);
  const pollRef = useRef(null);

  const loadList = async () => {
    if (!API_BASE_URL) return;
    setListLoading(true);
    try {
      const res = await apiFetch(`${API_BASE_URL}/answer-eval`);
      if (res.ok) setList((await res.json()).evaluations || []);
    } catch (_) {} finally {
      setListLoading(false);
    }
  };

  useEffect(() => { loadList(); return () => { if (pollRef.current) clearInterval(pollRef.current); }; }, []);

  const pollUntilDone = (id) => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const res = await apiFetch(`${API_BASE_URL}/answer-eval/${id}`);
        if (!res.ok) return;
        const d = await res.json();
        if (d.status === "completed" || d.status === "failed") {
          clearInterval(pollRef.current);
          pollRef.current = null;
          setData(d);
          setStatus(d.status);
          if (d.status === "failed") setError(d.error || "Evaluation failed");
          loadList();
        }
      } catch (_) {}
    }, 3000);
  };

  const start = async () => {
    if (!file) { setError("Choose a PDF of your answer first."); return; }
    setError("");
    setData(null);
    setDetail(false);
    setStatus("uploading");
    try {
      const contentType = file.type || "application/pdf";
      const pre = await apiFetch(`${API_BASE_URL}/answer-eval/presign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: file.name, content_type: contentType }),
      });
      if (!pre.ok) throw new Error(await pre.text());
      const { eval_id, upload_url } = await pre.json();

      const put = await fetch(upload_url, { method: "PUT", headers: { "Content-Type": contentType }, body: file });
      if (!put.ok) throw new Error(`Upload failed: ${put.status}`);

      setStatus("processing");
      const ev = await apiFetch(`${API_BASE_URL}/answer-eval/${eval_id}/evaluate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: question.trim(), max_marks: Number(maxMarks) || 0 }),
      });
      if (!ev.ok) throw new Error(await ev.text());
      const evData = await ev.json();
      if (evData.status === "completed" && evData.result) {
        const got = await apiFetch(`${API_BASE_URL}/answer-eval/${eval_id}`);
        setData(await got.json());
        setStatus("completed");
        loadList();
      } else {
        pollUntilDone(eval_id);
      }
    } catch (err) {
      setError(`Could not evaluate: ${String(err.message || err)}`);
      setStatus("failed");
    }
  };

  const openEval = async (id) => {
    setError("");
    setDetail(true);
    setData(null);
    setStatus("processing");
    try {
      const res = await apiFetch(`${API_BASE_URL}/answer-eval/${id}`);
      const d = await res.json();
      setData(d);
      setStatus(d.status === "completed" ? "completed" : d.status);
      if (d.status !== "completed" && d.status !== "failed") pollUntilDone(id);
    } catch (err) {
      setError(`Could not load: ${String(err.message || err)}`);
    }
  };

  const switchTab = (t) => {
    setTab(t);
    setError("");
    if (t === "answers") { setDetail(false); loadList(); }
  };

  const busy = status === "uploading" || status === "processing";

  return (
    <main className="app-shell">
      <div className="bg-orb orb-1" />
      <div className="bg-orb orb-2" />
      <header className="hero">
        <MainMenu active="answer-eval" />
        <h1>Mains Answer Evaluation</h1>
        <p className="subtext">Upload your answer PDF. The examiner reads it, marks it UPSC-style, and writes red-ink comments back onto the PDF.</p>
      </header>

      <section className="milestone-panel">
        {!API_BASE_URL ? (
          <p className="api-state warn">Backend URL needed.</p>
        ) : (
          <>
            <div className="session-tabs ae-tabs">
              <button className={`session-tab ${tab === "submit" ? "active" : ""}`} onClick={() => switchTab("submit")}>
                Submit Question
              </button>
              <button className={`session-tab ${tab === "answers" ? "active" : ""}`} onClick={() => switchTab("answers")}>
                My Answers
              </button>
            </div>

            {error ? <p className="api-state error">{error}</p> : null}

            {/* ── Submit Question tab ── */}
            {tab === "submit" ? (
              <>
                <div className="ae-form">
                  <label className="ae-file">
                    <input type="file" accept="application/pdf" onChange={(e) => setFile(e.target.files?.[0] || null)} disabled={busy} />
                    <span>{file ? file.name : "Choose answer PDF…"}</span>
                  </label>
                  <input
                    className="task-input"
                    placeholder="Question (optional — leave blank to auto-detect from the PDF)"
                    value={question}
                    onChange={(e) => setQuestion(e.target.value)}
                    disabled={busy}
                  />
                  <input
                    className="task-input ae-marks"
                    type="number"
                    placeholder="Max marks (e.g. 10 / 15)"
                    value={maxMarks}
                    onChange={(e) => setMaxMarks(e.target.value)}
                    disabled={busy}
                  />
                  <button className="btn-ticket" onClick={start} disabled={busy || !file}>
                    {status === "uploading" ? "Uploading…" : status === "processing" ? "Evaluating…" : "Evaluate"}
                  </button>
                </div>

                {busy ? (
                  <div className="ae-loading">
                    <div className="ae-spinner" />
                    <span>{status === "uploading" ? "Uploading your answer…" : "The examiner is reading and marking your answer (OCR + evaluation)…"}</span>
                  </div>
                ) : null}

                {status === "completed" && !detail && data?.result ? <EvalResult data={data} /> : null}
              </>
            ) : null}

            {/* ── My Answers tab ── */}
            {tab === "answers" ? (
              detail ? (
                <>
                  <button className="btn-cancel ae-back" onClick={() => { setDetail(false); setData(null); }}>← All answers</button>
                  {busy ? (
                    <div className="ae-loading"><div className="ae-spinner" /><span>Loading evaluation…</span></div>
                  ) : data?.result ? (
                    <EvalResult data={data} />
                  ) : (
                    <p className="day-state">This answer is still {data?.status || "processing"}.</p>
                  )}
                </>
              ) : (
                <>
                  {listLoading ? <p className="day-state">Loading…</p> : null}
                  {!listLoading && list.length === 0 ? <p className="day-state">No evaluated answers yet. Submit one from the “Submit Question” tab.</p> : null}
                  {list.map((it) => (
                    <button key={it.eval_id} className="ae-history-item" onClick={() => openEval(it.eval_id)}>
                      <span className="ae-hist-main">
                        <span className="ae-hist-name">{it.filename}</span>
                        <span className="ae-hist-date">{fmtDate(it.created_at)}</span>
                      </span>
                      <span className="ae-hist-meta">
                        {it.status === "completed"
                          ? `${it.total_awarded}/${it.total_max}`
                          : it.status === "failed" ? "failed" : "processing…"}
                      </span>
                    </button>
                  ))}
                </>
              )
            ) : null}
          </>
        )}
      </section>
    </main>
  );
}
