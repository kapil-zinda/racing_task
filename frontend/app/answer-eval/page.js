"use client";

import { useEffect, useRef, useState } from "react";
import MainMenu from "../components/MainMenu";
import { apiFetch } from "../lib/auth";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "";

export default function AnswerEvalPage() {
  const [file, setFile] = useState(null);
  const [question, setQuestion] = useState("");
  const [maxMarks, setMaxMarks] = useState("");
  const [status, setStatus] = useState("idle"); // idle | uploading | processing | completed | failed
  const [evalId, setEvalId] = useState("");
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [list, setList] = useState([]);
  const pollRef = useRef(null);

  const loadList = async () => {
    if (!API_BASE_URL) return;
    try {
      const res = await apiFetch(`${API_BASE_URL}/answer-eval`);
      if (res.ok) setList((await res.json()).evaluations || []);
    } catch (_) {}
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
      setEvalId(eval_id);

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
        // ran inline (local dev)
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
    setStatus("processing");
    const res = await apiFetch(`${API_BASE_URL}/answer-eval/${id}`);
    const d = await res.json();
    setEvalId(id);
    setData(d);
    setStatus(d.status === "completed" ? "completed" : d.status);
    if (d.status !== "completed") pollUntilDone(id);
  };

  const result = data?.result;
  const busy = status === "uploading" || status === "processing";

  return (
    <main className="app-shell">
      <div className="bg-orb orb-1" />
      <div className="bg-orb orb-2" />
      <header className="hero">
        <MainMenu active="answer-eval" />
        <h1>Mains Answer Evaluation</h1>
        <p className="subtext">Upload your answer PDF. The examiner reads it, marks it UPSC-style, and writes comments back onto the PDF.</p>
      </header>

      <section className="milestone-panel">
        {!API_BASE_URL ? (
          <p className="api-state warn">Backend URL needed.</p>
        ) : (
          <>
            {error ? <p className="api-state error">{error}</p> : null}

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

            {status === "completed" && result ? (
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

                {data.marked_url ? (
                  <iframe className="ae-pdf" src={data.marked_url} title="Marked answer" />
                ) : null}
              </div>
            ) : null}

            {list.length ? (
              <div className="ae-history">
                <h3>Past evaluations</h3>
                {list.map((it) => (
                  <button key={it.eval_id} className="ae-history-item" onClick={() => openEval(it.eval_id)}>
                    <span className="ae-hist-name">{it.filename}</span>
                    <span className="ae-hist-meta">
                      {it.status === "completed" ? `${it.total_awarded}/${it.total_max}` : it.status}
                    </span>
                  </button>
                ))}
              </div>
            ) : null}
          </>
        )}
      </section>
    </main>
  );
}
