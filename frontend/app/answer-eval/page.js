"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import MainMenu from "../components/MainMenu";
import Icon from "../components/Icon";
import { apiFetch } from "../lib/auth";
import { useCredits } from "../lib/credits";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "";

function fmtTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function fmtDayHeading(iso) {
  if (!iso) return "Undated";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "Undated";
  return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}

function dayKey(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
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
  const { requireCredits, refreshCredits } = useCredits();
  const [view, setView] = useState("list"); // "list" | "submit" | "detail"
  const [file, setFile] = useState(null);
  const [question, setQuestion] = useState("");
  const [subject, setSubject] = useState("");
  const [maxMarks, setMaxMarks] = useState("");
  const [status, setStatus] = useState("idle"); // idle | uploading | submitted | loading | completed | failed
  const [data, setData] = useState(null);        // result currently shown
  const [error, setError] = useState("");
  const [list, setList] = useState([]);
  const [listLoading, setListLoading] = useState(false);

  // Search / filter
  const [searchQ, setSearchQ] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const loadList = useCallback(async (filters = {}) => {
    if (!API_BASE_URL) return;
    setListLoading(true);
    try {
      const params = new URLSearchParams();
      const q = filters.q ?? searchQ;
      const from = filters.from ?? fromDate;
      const to = filters.to ?? toDate;
      if (q && q.trim()) params.set("q", q.trim());
      if (from) params.set("from_date", from);
      if (to) params.set("to_date", to);
      const suffix = params.toString() ? `?${params.toString()}` : "";
      const res = await apiFetch(`${API_BASE_URL}/answer-eval${suffix}`);
      if (res.ok) setList((await res.json()).evaluations || []);
    } catch (_) {} finally {
      setListLoading(false);
    }
  }, [searchQ, fromDate, toDate]);

  useEffect(() => { loadList({ q: "", from: "", to: "" }); }, []); // initial full list

  // Group the listing by submission day (newest day first).
  const groupedList = useMemo(() => {
    const groups = new Map();
    list.forEach((it) => {
      const key = dayKey(it.created_at) || "undated";
      if (!groups.has(key)) groups.set(key, { key, iso: it.created_at, items: [] });
      groups.get(key).items.push(it);
    });
    return Array.from(groups.values());
  }, [list]);

  const runSearch = () => loadList();
  const clearSearch = () => { setSearchQ(""); setFromDate(""); setToDate(""); loadList({ q: "", from: "", to: "" }); };

  const start = async () => {
    if (!file) { setError("Choose a PDF of your answer first."); return; }
    // In-memory affordability gate — don't even fire the upload if it can't be paid for.
    if (!requireCredits("answer_eval")) return;
    setError("");
    setData(null);
    setStatus("uploading");
    try {
      const contentType = file.type || "application/pdf";
      // Question + marks are captured now so the upload-triggered worker can evaluate
      // without any further call.
      const pre = await apiFetch(`${API_BASE_URL}/answer-eval/presign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: file.name,
          content_type: contentType,
          question: question.trim(),
          subject: subject.trim(),
          max_marks: Number(maxMarks) || 0,
        }),
      });
      if (pre.status === 402) { setStatus("idle"); return; } // popup already shown
      if (!pre.ok) throw new Error(await pre.text());
      const { eval_id, upload_url, auto_evaluate } = await pre.json();

      const put = await fetch(upload_url, { method: "PUT", headers: { "Content-Type": contentType }, body: file });
      if (!put.ok) throw new Error(`Upload failed: ${put.status}`);

      // With an S3 upload-trigger wired up (prod), the object-created event drives
      // evaluation — don't call /evaluate. Otherwise (local/dev) kick it manually.
      if (!auto_evaluate) {
        await apiFetch(`${API_BASE_URL}/answer-eval/${eval_id}/evaluate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        }).catch(() => {});
      }
      // No polling — evaluation runs in the background. It shows up in "My Answers"
      // once done; the user just refreshes / reopens it.
      setStatus("submitted");
      setFile(null);
      setQuestion("");
      setSubject("");
      setMaxMarks("");
      refreshCredits();
      loadList({ q: "", from: "", to: "" });
    } catch (err) {
      setError(`Could not submit: ${String(err.message || err)}`);
      setStatus("failed");
    }
  };

  const openEval = async (id) => {
    setError("");
    setView("detail");
    setData(null);
    setStatus("loading");
    try {
      const res = await apiFetch(`${API_BASE_URL}/answer-eval/${id}`);
      const d = await res.json();
      setData(d);
      setStatus(d.status === "completed" ? "completed" : d.status);
    } catch (err) {
      setError(`Could not load: ${String(err.message || err)}`);
    }
  };

  const openSubmit = () => { setView("submit"); setError(""); setStatus("idle"); };
  const backToList = () => { setView("list"); setData(null); setError(""); loadList(); };

  const busy = status === "uploading";

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
            {error ? <p className="api-state error">{error}</p> : null}

            {/* ── SUBMIT VIEW ── */}
            {view === "submit" ? (
              <>
                <button className="ae-back" onClick={backToList}><Icon name="arrow-left" size={16} /> All answers</button>
                <h2 className="ae-submit-title">Submit a new question</h2>
                <div className="ae-form">
                  <label className="ae-file">
                    <input type="file" accept="application/pdf" onChange={(e) => setFile(e.target.files?.[0] || null)} disabled={busy} />
                    <span>{file ? file.name : "Choose answer PDF…"}</span>
                  </label>

                  <div className="ae-field">
                    <label className="ae-label">Subject</label>
                    <input
                      className="ae-input"
                      placeholder="e.g. Polity, Geography, Ethics"
                      value={subject}
                      onChange={(e) => setSubject(e.target.value)}
                      disabled={busy}
                    />
                  </div>

                  <div className="ae-field">
                    <label className="ae-label">Question</label>
                    <textarea
                      className="ae-input ae-textarea"
                      placeholder="Paste the question (optional — leave blank to auto-detect from the PDF)"
                      rows={3}
                      value={question}
                      onChange={(e) => setQuestion(e.target.value)}
                      disabled={busy}
                    />
                  </div>

                  <div className="ae-field ae-field-narrow">
                    <label className="ae-label">Max marks</label>
                    <input
                      className="ae-input"
                      type="number"
                      placeholder="e.g. 10 / 15"
                      value={maxMarks}
                      onChange={(e) => setMaxMarks(e.target.value)}
                      disabled={busy}
                    />
                  </div>

                  <button className="btn-ticket" onClick={start} disabled={busy || !file}>
                    {status === "uploading" ? "Submitting…" : "Submit for evaluation"}
                  </button>
                </div>

                {status === "uploading" ? (
                  <div className="ae-loading"><div className="ae-spinner" /><span>Uploading your answer…</span></div>
                ) : null}

                {status === "submitted" ? (
                  <div className="ae-submitted">
                    <Icon name="check-circle" size={16} /> Submitted! Your answer is being evaluated in the background.
                    Head back to the list and refresh in a bit to see the marks and comments.
                  </div>
                ) : null}
              </>
            ) : null}

            {/* ── DETAIL VIEW ── */}
            {view === "detail" ? (
              <>
                <button className="ae-back" onClick={backToList}><Icon name="arrow-left" size={16} /> All answers</button>
                {status === "loading" ? (
                  <div className="ae-loading"><div className="ae-spinner" /><span>Loading…</span></div>
                ) : data?.result ? (
                  <EvalResult data={data} />
                ) : data?.status === "failed" ? (
                  <p className="day-state">Evaluation failed{data?.error ? `: ${data.error}` : ""}.</p>
                ) : (
                  <p className="day-state">Still evaluating — refresh in a bit to see the result.</p>
                )}
              </>
            ) : null}

            {/* ── LIST VIEW ── */}
            {view === "list" ? (
              <>
                <div className="ae-search">
                  <div className="ae-search-field">
                    <Icon name="search" size={15} />
                    <input
                      className="ae-search-input"
                      placeholder="Search by subject / keyword…"
                      value={searchQ}
                      onChange={(e) => setSearchQ(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") runSearch(); }}
                    />
                  </div>
                  <label className="ae-date-field">From
                    <input type="date" className="ae-date-input" value={fromDate} max={toDate || undefined}
                      onChange={(e) => setFromDate(e.target.value)} />
                  </label>
                  <label className="ae-date-field">To
                    <input type="date" className="ae-date-input" value={toDate} min={fromDate || undefined}
                      onChange={(e) => setToDate(e.target.value)} />
                  </label>
                  <button className="btn-day" onClick={runSearch}>Search</button>
                  {(searchQ || fromDate || toDate) ? <button className="btn-cancel" onClick={clearSearch}>Clear</button> : null}
                </div>

                <button className="ae-history-item ae-list-new" onClick={openSubmit}>
                  <span className="ae-new-icon"><Icon name="plus" size={20} /></span>
                  <span className="ae-hist-main">
                    <span className="ae-hist-name">Submit a new question</span>
                    <span className="ae-hist-date">Upload a Mains answer PDF for examiner-style marking.</span>
                  </span>
                  <Icon name="chevron-right" size={18} />
                </button>

                {listLoading ? <p className="day-state">Loading…</p> : null}
                {!listLoading && list.length === 0 ? (
                  <p className="day-state">No evaluated answers{searchQ || fromDate || toDate ? " match your search" : " yet"}.</p>
                ) : null}

                {groupedList.map((group) => (
                  <div key={group.key} className="ae-day-group">
                    <div className="ae-day-heading">{fmtDayHeading(group.iso)}</div>
                    {group.items.map((it) => (
                      <button key={it.eval_id} className="ae-history-item" onClick={() => openEval(it.eval_id)}>
                        <span className="ae-hist-main">
                          <span className="ae-hist-name">
                            {it.subject?.trim() ? <span className="ae-subject-chip">{it.subject.trim()}</span> : null}
                            {it.question?.trim() || it.filename}
                          </span>
                          <span className="ae-hist-date">{it.filename} · {fmtTime(it.created_at)}</span>
                        </span>
                        <span className="ae-hist-meta">
                          {it.status === "completed"
                            ? `${it.total_awarded}/${it.total_max}`
                            : it.status === "failed" ? "failed" : "processing…"}
                        </span>
                      </button>
                    ))}
                  </div>
                ))}
              </>
            ) : null}
          </>
        )}
      </section>
    </main>
  );
}
