"use client";

import "./answer-eval.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import MainMenu from "../components/MainMenu";
import Icon from "../components/Icon";
import AnswerEvalMarkupViewer from "../components/AnswerEvalMarkupViewer";
import AnswerEvalReport from "../components/AnswerEvalReport";
import { apiFetch } from "../lib/auth";
import { useCredits } from "../lib/credits";
import styles from "./page.module.css";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "";
const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25 MB
const POLL_INTERVAL_MS = 8000;
const POLL_MAX_MS = 10 * 60 * 1000; // stop polling after ~10 minutes
const MARK_PRESETS = [10, 15, 20];
const LANGUAGE_SUGGESTIONS = ["English", "Hindi"];
const TIPS = [
  { icon: "image", title: "Good lighting", text: "Scan or photograph in bright, even light — avoid shadows on your answer sheet." },
  { icon: "layers", title: "All pages in order", text: "Include every page of your answer, combined into a single PDF in order." },
  { icon: "edit", title: "Clear question numbers", text: "Write question numbers clearly so the AI can match your answers accurately." },
  { icon: "pencil", title: "Dark ink", text: "Use dark blue or black ink. Light pencil marks may not be picked up well." },
];

const SUBMIT_FAILED_COPY =
  "The evaluation could not be completed. Your credits were not consumed for failed runs — please try again.";

// Lazy pdf.js loader (same pattern as PdfHighlightViewer.js) — used only for the
// pre-submit page-count + first-page thumbnail preview.
let _pdfjs = null;
function getPdfJs() {
  if (!_pdfjs) {
    _pdfjs = import("pdfjs-dist").then((lib) => {
      lib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
      return lib;
    });
  }
  return _pdfjs;
}

function copyText(text) {
  if (!text) return;
  try { navigator.clipboard?.writeText(text); } catch (_) {}
}

// Qualitative band shown next to the total score, mirrors the section labels.
function bandLabel(pct) {
  if (isNaN(pct)) return "";
  if (pct >= 80) return "Excellent";
  if (pct >= 65) return "Good Attempt";
  if (pct >= 40) return "Average";
  return "Needs Work";
}

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

// Score band: <40% red tint, 40–65% gold tint, >65% mint tint.
function scoreBandClass(awarded, max) {
  const a = Number(awarded);
  const m = Number(max);
  if (!m || isNaN(a)) return "";
  const pct = (a / m) * 100;
  if (pct < 40) return styles.scoreLow;
  if (pct <= 65) return styles.scoreMid;
  return styles.scoreHigh;
}

function isLowScore(awarded, max) {
  const m = Number(max);
  return m > 0 && (Number(awarded) / m) * 100 < 40;
}

function StatusCard() {
  return (
    <div className={styles.statusCard} role="status">
      <div className={styles.statusTitle}>
        <Icon name="clock" size={16} /> Evaluating your answer
      </div>
      <p className={styles.statusSub}>Usually takes a few minutes. You can stay here — the result will appear on its own.</p>
      <div className={styles.shimmerBar} />
    </div>
  );
}

function ListSkeleton() {
  return (
    <div aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <div key={i} className={styles.skeletonRow}>
          <span className={styles.skelLine} />
          <span className={styles.skelLineShort} />
        </div>
      ))}
    </div>
  );
}

function SectionCard({ sec }) {
  const p = Number(sec.max_marks) ? (Number(sec.awarded_marks) / Number(sec.max_marks)) * 100 : 0;
  const name = (sec.name || "").replace(/^\w/, (c) => c.toUpperCase());
  const labelClass = /excellent|good/i.test(sec.label || "") ? "good" : /needs/i.test(sec.label || "") ? "needs" : "avg";
  return (
    <div className="ae-section-card">
      <div className="ae-section-head">
        <span className="ae-section-name">{name}</span>
        {sec.label ? <span className={`ae-section-label ${labelClass}`}>{sec.label}</span> : null}
        <span className={`ae-section-marks ${scoreBandClass(sec.awarded_marks, sec.max_marks)}`}>{sec.awarded_marks}/{sec.max_marks}</span>
      </div>
      <div className="ae-section-bar"><div className="ae-section-bar-fill" style={{ width: `${p}%` }} /></div>
      {sec.remark ? <p className="ae-section-remark">{sec.remark}</p> : null}
      {(sec.strengths || []).length ? (
        <div className="ae-section-col">
          <h5>What you did well</h5>
          <ul className="ae-strengths-list">{sec.strengths.map((s, i) => <li key={i}>✓ {s}</li>)}</ul>
        </div>
      ) : null}
      {(sec.improvements || []).length ? (
        <div className="ae-section-col">
          <h5>Where to focus</h5>
          {sec.improvements.map((im, i) => (
            <div key={i} className="ae-improve-item">
              <strong>{im.issue}</strong>
              {im.explanation ? <p>{im.explanation}</p> : null}
              {im.model_sentence ? (
                <div className="ae-model-sentence">
                  <span>{im.model_sentence}</span>
                  <button onClick={() => copyText(im.model_sentence)} title="Copy"><Icon name="copy" size={12} /></button>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function MetricBar({ label, score, max = 10 }) {
  const p = max ? (Number(score) / max) * 100 : 0;
  return (
    <div className="ae-metric-row">
      <span className="ae-metric-label">{label}</span>
      <div className="ae-metric-track"><div className="ae-metric-fill" style={{ width: `${p}%` }} /></div>
      <span className="ae-metric-score">{score}/{max}</span>
    </div>
  );
}

function QuestionResult({ q, index, multi }) {
  return (
    <div className="ae-question">
      <div className="ae-q-head">
        <strong>{multi ? `Q${index + 1}` : "Result"}</strong>
        <span className={`ae-q-mark ${scoreBandClass(q.awarded_marks, q.max_marks)}`}>{q.awarded_marks}/{q.max_marks}</span>
        {q.word_count ? <span className="ae-q-words"><Icon name="edit" size={12} /> {q.word_count} words</span> : null}
      </div>
      {q.question_text ? <p className="ae-q-text">{q.question_text}</p> : null}

      {(q.sections || []).length ? (
        <>
          <div className="ae-equation">
            {q.sections.map((sec, i) => (
              <span key={i}>
                {i > 0 ? <span className="ae-equation-op">+</span> : null}
                <span className="ae-equation-val">{sec.awarded_marks}</span>
              </span>
            ))}
            <span className="ae-equation-op">=</span>
            <span className="ae-equation-total">{q.awarded_marks}/{q.max_marks}</span>
          </div>
          <div className="ae-section-list">
            {q.sections.map((sec, i) => <SectionCard key={i} sec={sec} />)}
          </div>
        </>
      ) : null}

      {(q.core_metrics || []).length || (q.subject_metrics || []).length ? (
        <div className="ae-metric-block">
          <h4>Metric Breakdown</h4>
          {(q.core_metrics || []).length ? (
            <div className="ae-metric-group">
              <span className="ae-metric-group-title">Core parameters</span>
              {q.core_metrics.map((m, i) => <MetricBar key={i} label={m.name} score={m.score} />)}
            </div>
          ) : null}
          {(q.subject_metrics || []).length ? (
            <div className="ae-metric-group">
              <span className="ae-metric-group-title">Subject-specific</span>
              {q.subject_metrics.map((m, i) => <MetricBar key={i} label={m.name} score={m.score} />)}
            </div>
          ) : null}
        </div>
      ) : null}

      {(q.missing_keywords || []).length ? (
        <div className="ae-block">
          <h3>Key Terms You Missed</h3>
          <div className="ae-keyword-list">
            {q.missing_keywords.map((kw, i) => (
              <div key={i} className="ae-keyword-card">
                <span className="ae-keyword-term">{kw.term}</span>
                {kw.why ? <span className="ae-keyword-why">{kw.why}</span> : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {q.next_attempt_focus?.issue ? (
        <div className="ae-focus-card">
          <div className="ae-focus-head">
            <Icon name="target" size={14} /> Next Attempt Focus
            {q.next_attempt_focus.section ? (
              <span className="ae-focus-tag">
                {q.next_attempt_focus.section.toUpperCase()}
                {q.next_attempt_focus.marks_impact ? ` · -${q.next_attempt_focus.marks_impact} marks` : ""}
              </span>
            ) : null}
          </div>
          <p className="ae-focus-quote">&ldquo;{q.next_attempt_focus.issue}&rdquo;</p>
          {q.next_attempt_focus.model_sentence ? (
            <div className="ae-model-sentence">
              <span>{q.next_attempt_focus.model_sentence}</span>
              <button onClick={() => copyText(q.next_attempt_focus.model_sentence)} title="Copy"><Icon name="copy" size={12} /></button>
            </div>
          ) : null}
        </div>
      ) : null}

      {q.model_answer && (q.model_answer.introduction || q.model_answer.body || q.model_answer.conclusion) ? (
        <div className="ae-model-answer">
          <div className="ae-model-answer-head">
            <span><Icon name="sparkles" size={14} /> Model Answer</span>
            <button
              className="ae-copy-btn"
              onClick={() => copyText(
                [q.model_answer.introduction, q.model_answer.body, q.model_answer.conclusion].filter(Boolean).join("\n\n")
              )}
            >
              <Icon name="copy" size={13} /> Copy Text
            </button>
          </div>
          {q.model_answer.introduction ? <div className="ae-model-answer-part"><h5>Introduction</h5><p>{q.model_answer.introduction}</p></div> : null}
          {q.model_answer.body ? <div className="ae-model-answer-part"><h5>Body</h5><p>{q.model_answer.body}</p></div> : null}
          {q.model_answer.conclusion ? <div className="ae-model-answer-part"><h5>Conclusion</h5><p>{q.model_answer.conclusion}</p></div> : null}
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
    </div>
  );
}

function EvalResult({ data }) {
  const result = data?.result;
  if (!result) return null;
  const low = isLowScore(result.total_awarded, result.total_max);
  const pct = result.total_max ? (Number(result.total_awarded) / Number(result.total_max)) * 100 : NaN;
  const questions = result.questions || [];
  const totalWords = questions.reduce((s, q) => s + (Number(q.word_count) || 0), 0);
  const multi = questions.length > 1;

  return (
    <div className="ae-result">
      <div className="ae-score">
        <div className={`ae-score-num ${scoreBandClass(result.total_awarded, result.total_max)}`}>
          {result.total_awarded}<span>/{result.total_max}</span>
        </div>
        {!isNaN(pct) ? <span className="ae-band-label">{bandLabel(pct)}</span> : null}
        {totalWords ? <span className="ae-word-count">{totalWords} words</span> : null}
        <div className="ae-actions">
          <AnswerEvalReport data={data} />
          {data.marked_download_url ? (
            <a className="ae-pdf-btn primary" href={data.marked_download_url}>
              <Icon name="download" size={15} /> Download marked PDF
            </a>
          ) : null}
        </div>
        {low ? <p className={styles.scoreTip}>Focus on the examiner&apos;s &lsquo;missing&rsquo; comments first.</p> : null}
      </div>

      {result.overall_remark ? (
        <div className="ae-block"><h3>Examiner remark</h3><p>{result.overall_remark}</p></div>
      ) : null}

      {questions.map((q, i) => <QuestionResult key={i} q={q} index={i} multi={multi} />)}

      {(result.strengths || []).length ? (
        <div className="ae-block"><h3>Strengths</h3><ul>{result.strengths.map((s, i) => <li key={i}>{s}</li>)}</ul></div>
      ) : null}
      {(result.improvements || []).length ? (
        <div className="ae-block"><h3>Improvements</h3><ul>{result.improvements.map((s, i) => <li key={i}>{s}</li>)}</ul></div>
      ) : null}

      {(data.marked_url || data.original_url) ? (
        <AnswerEvalMarkupViewer url={data.marked_url || data.original_url} questions={questions} />
      ) : null}
    </div>
  );
}

export default function AnswerEvalPage() {
  const { requireCredits, refreshCredits, costOf, credits } = useCredits();
  const [view, setView] = useState("list"); // "list" | "submit" | "detail"
  const [file, setFile] = useState(null);
  const [fileError, setFileError] = useState("");
  const [question, setQuestion] = useState("");
  const [subject, setSubject] = useState("");
  const [maxMarks, setMaxMarks] = useState("");
  const [hasDiagrams, setHasDiagrams] = useState(true);
  const [language, setLanguage] = useState("English");
  const [pageCount, setPageCount] = useState(0);
  const [thumbUrl, setThumbUrl] = useState("");
  const [status, setStatus] = useState("idle"); // idle | uploading | failed | loading | completed | processing…
  const [data, setData] = useState(null);        // result currently shown in detail view
  const [error, setError] = useState("");
  const [list, setList] = useState([]);
  const [listLoading, setListLoading] = useState(false);

  // Post-submit completion loop: poll the existing detail endpoint until the
  // evaluation completes/fails (or ~10 min pass), then surface the result.
  const [pollId, setPollId] = useState(null);
  const [pollStatus, setPollStatus] = useState(null); // null | "polling" | "done" | "failed" | "timeout"
  const [pollData, setPollData] = useState(null);      // finished evaluation doc
  const pollStartRef = useRef(0);
  const detailIdRef = useRef(null);

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

  const beginPolling = useCallback((id) => {
    pollStartRef.current = Date.now();
    setPollData(null);
    setPollStatus("polling");
    setPollId(id);
  }, []);

  const stopPolling = useCallback(() => {
    setPollId(null);
    setPollStatus(null);
    setPollData(null);
  }, []);

  useEffect(() => {
    if (!pollId || !API_BASE_URL) return undefined;
    let cancelled = false;

    const tick = async () => {
      if (cancelled) return;
      if (Date.now() - pollStartRef.current > POLL_MAX_MS) {
        setPollId(null);
        setPollStatus("timeout");
        return;
      }
      try {
        const res = await apiFetch(`${API_BASE_URL}/answer-eval/${pollId}`);
        if (!res.ok || cancelled) return;
        const d = await res.json();
        if (d.status === "completed" || d.status === "failed") {
          if (cancelled) return;
          setPollId(null);
          setPollStatus(d.status === "completed" ? "done" : "failed");
          setPollData({ ...d, eval_id: d.eval_id || pollId });
          // If the user is looking at this evaluation's detail view, swap in the result.
          if (detailIdRef.current === pollId) setData(d);
          loadList({ q: "", from: "", to: "" });
        }
      } catch (_) {
        // transient network error — keep polling
      }
    };

    const timer = setInterval(tick, POLL_INTERVAL_MS);
    tick();
    return () => { cancelled = true; clearInterval(timer); };
  }, [pollId]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // Best-effort client-side page-count + first-page thumbnail, purely a submit-time
  // sanity check for the candidate — never blocks submission if it fails.
  const loadPdfPreview = useCallback(async (f) => {
    setPageCount(0);
    setThumbUrl("");
    try {
      const pdfjs = await getPdfJs();
      const buf = await f.arrayBuffer();
      const doc = await pdfjs.getDocument({ data: buf }).promise;
      setPageCount(doc.numPages);
      const page = await doc.getPage(1);
      const viewport = page.getViewport({ scale: 0.45 });
      const canvas = document.createElement("canvas");
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
      setThumbUrl(canvas.toDataURL("image/png"));
      doc.destroy();
    } catch (_) {
      // thumbnail is a nicety, not required for submit
    }
  }, []);

  const onFileChange = (e) => {
    const f = e.target.files?.[0] || null;
    setFileError("");
    if (!f) { setFile(null); setPageCount(0); setThumbUrl(""); return; }
    const isPdf = f.type === "application/pdf" || /\.pdf$/i.test(f.name);
    if (!isPdf) {
      setFile(null);
      setFileError("That doesn't look like a PDF. Please choose a .pdf file.");
      e.target.value = "";
      return;
    }
    if (f.size > MAX_FILE_BYTES) {
      setFile(null);
      setFileError("That file is over 25 MB. Please compress it or split it into smaller PDFs.");
      e.target.value = "";
      return;
    }
    setFile(f);
    loadPdfPreview(f);
  };

  // Cost hint near submit — free allowance first, then the per-question price.
  const evalCost = costOf("answer_eval");
  const freeRemaining = Number(credits?.free?.answer_eval?.remaining ?? 0);
  const costHint = freeRemaining > 0
    ? `Uses 1 free evaluation — ${freeRemaining} remaining.`
    : evalCost > 0
      ? `Costs $${evalCost.toFixed(2)} per detected question, from your credit balance.`
      : "Billed per detected question once your free evaluations are used.";

  const start = async () => {
    if (!file) { setFileError("Choose a PDF of your answer first."); return; }
    // In-memory affordability gate — don't even fire the upload if it can't be paid for.
    if (!requireCredits("answer_eval")) return;
    setError("");
    setFileError("");
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
          has_diagrams: hasDiagrams,
          language: language.trim() || "English",
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
      // Evaluation runs in the background — poll the detail endpoint and keep the
      // user informed here rather than sending them off to refresh the list.
      setStatus("idle");
      setFile(null);
      setQuestion("");
      setSubject("");
      setMaxMarks("");
      setHasDiagrams(true);
      setLanguage("English");
      setPageCount(0);
      setThumbUrl("");
      refreshCredits();
      loadList({ q: "", from: "", to: "" });
      beginPolling(eval_id);
    } catch (_) {
      setError(SUBMIT_FAILED_COPY);
      setStatus("failed");
    }
  };

  const openEval = async (id) => {
    setError("");
    setView("detail");
    setData(null);
    setStatus("loading");
    detailIdRef.current = id;
    if (pollId !== id) stopPolling();
    try {
      const res = await apiFetch(`${API_BASE_URL}/answer-eval/${id}`);
      if (!res.ok) throw new Error(String(res.status));
      const d = await res.json();
      setData(d);
      setStatus(d.status === "completed" ? "completed" : d.status);
      // Still in flight — keep the user informed instead of asking them to refresh.
      if (d.status !== "completed" && d.status !== "failed") beginPolling(id);
    } catch (_) {
      setStatus("idle");
      setError("We couldn't load this evaluation. Please check your connection and try again.");
    }
  };

  const openSubmit = () => {
    setView("submit");
    setError("");
    setFileError("");
    setStatus("idle");
    detailIdRef.current = null;
    stopPolling();
  };
  const backToList = () => {
    setView("list");
    setData(null);
    setError("");
    setStatus("idle");
    detailIdRef.current = null;
    stopPolling();
    loadList();
  };
  const retrySubmit = () => { setError(""); setStatus("idle"); setPollStatus(null); setPollData(null); };

  const busy = status === "uploading";
  const showSubmitForm = view === "submit" && status !== "failed" && !pollStatus;

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
            {/* ── SUBMIT VIEW ── */}
            {view === "submit" ? (
              <>
                <button className="ae-back" onClick={backToList}><Icon name="arrow-left" size={16} /> All answers</button>
                <h2 className="ae-submit-title">Submit a new question</h2>

                {showSubmitForm ? (
                  <div className={styles.form}>
                    <div className="ae-field">
                      <label className="ae-label" htmlFor="ae-file-input">Answer PDF</label>
                      <label className="ae-file" htmlFor="ae-file-input">
                        <input
                          id="ae-file-input"
                          type="file"
                          accept="application/pdf,.pdf"
                          onChange={onFileChange}
                          disabled={busy}
                        />
                        <span>{file ? file.name : "Choose answer PDF…"}</span>
                      </label>
                      <p className={styles.hint}>PDF only, up to 25 MB. One PDF can hold several questions.</p>
                      {fileError ? <p className={styles.fileError} role="alert">{fileError}</p> : null}
                      {file && thumbUrl ? (
                        <div className="ae-file-preview">
                          <img src={thumbUrl} alt="First page preview" className="ae-file-thumb" />
                          <div className="ae-file-meta">
                            <span>{file.name}</span>
                            <span>{(file.size / (1024 * 1024)).toFixed(1)} MB{pageCount ? ` · ${pageCount} page${pageCount === 1 ? "" : "s"}` : ""}</span>
                          </div>
                        </div>
                      ) : null}
                    </div>

                    <div className="ae-field">
                      <label className="ae-label" htmlFor="ae-subject">Subject</label>
                      <input
                        id="ae-subject"
                        className="ae-input"
                        placeholder="e.g. Polity, Geography, Ethics"
                        value={subject}
                        onChange={(e) => setSubject(e.target.value)}
                        disabled={busy}
                      />
                    </div>

                    <div className="ae-field">
                      <label className="ae-label" htmlFor="ae-language">Answer in</label>
                      <input
                        id="ae-language"
                        className="ae-input"
                        list="ae-language-suggestions"
                        placeholder="English"
                        value={language}
                        onChange={(e) => setLanguage(e.target.value)}
                        disabled={busy}
                      />
                      <datalist id="ae-language-suggestions">
                        {LANGUAGE_SUGGESTIONS.map((l) => <option key={l} value={l} />)}
                      </datalist>
                    </div>

                    <div className="ae-field">
                      <label className="ae-label" htmlFor="ae-question">Question</label>
                      <textarea
                        id="ae-question"
                        className="ae-input ae-textarea"
                        placeholder="Paste the question here"
                        rows={3}
                        value={question}
                        onChange={(e) => setQuestion(e.target.value)}
                        disabled={busy}
                      />
                      <p className={styles.hint}>Optional — leave blank and the question is detected from your PDF.</p>
                    </div>

                    <div className="ae-field ae-field-narrow">
                      <label className="ae-label" htmlFor="ae-max-marks">Max marks</label>
                      <div className="ae-preset-row">
                        {MARK_PRESETS.map((m) => (
                          <button
                            key={m}
                            type="button"
                            className={`ae-preset-chip ${Number(maxMarks) === m ? "active" : ""}`}
                            onClick={() => setMaxMarks(String(m))}
                            disabled={busy}
                          >
                            {m}
                          </button>
                        ))}
                      </div>
                      <input
                        id="ae-max-marks"
                        className="ae-input"
                        type="number"
                        min="0"
                        placeholder="Custom"
                        value={maxMarks}
                        onChange={(e) => setMaxMarks(e.target.value)}
                        disabled={busy}
                      />
                      <p className={styles.hint}>Optional — leave blank to detect from the paper.</p>
                    </div>

                    <div className="ae-field">
                      <label className="ae-label">Diagrams, maps or flowcharts in your answer?</label>
                      <div className="ae-preset-row">
                        <button
                          type="button"
                          className={`ae-preset-chip ${hasDiagrams ? "active" : ""}`}
                          onClick={() => setHasDiagrams(true)}
                          disabled={busy}
                        >
                          Yes, evaluate
                        </button>
                        <button
                          type="button"
                          className={`ae-preset-chip ${!hasDiagrams ? "active" : ""}`}
                          onClick={() => setHasDiagrams(false)}
                          disabled={busy}
                        >
                          No, exclude
                        </button>
                      </div>
                    </div>

                    <button className={styles.submitBtn} onClick={start} disabled={busy || !file}>
                      {busy ? "Submitting…" : "Submit for evaluation"}
                    </button>
                    <span className={styles.costHint}><Icon name="wallet" size={13} /> {costHint}</span>

                    <div className="ae-tips-card">
                      <h4><Icon name="idea" size={14} /> Tips for Best Results</h4>
                      <div className="ae-tips-grid">
                        {TIPS.map((t) => (
                          <div key={t.title} className="ae-tip">
                            <Icon name={t.icon} size={15} />
                            <div>
                              <strong>{t.title}</strong>
                              <p>{t.text}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : null}

                {busy ? (
                  <div className="ae-loading"><div className="ae-spinner" /><span>Uploading your answer…</span></div>
                ) : null}

                {status === "failed" ? (
                  <div className={styles.errorCard} role="alert">
                    <span>{SUBMIT_FAILED_COPY}</span>
                    <button className={styles.retryBtn} onClick={retrySubmit}>
                      <Icon name="refresh" size={14} /> Try again
                    </button>
                  </div>
                ) : null}

                {pollStatus === "polling" ? <StatusCard /> : null}

                {pollStatus === "timeout" ? (
                  <div className={styles.statusCard}>
                    <div className={styles.statusTitle}><Icon name="clock" size={16} /> Still evaluating</div>
                    <p className={styles.statusSub}>
                      This one is taking longer than usual. Your answer is safe — it will appear in the list once marked.
                    </p>
                    <button className={styles.retryBtn} onClick={backToList} style={{ marginTop: 12 }}>
                      <Icon name="arrow-left" size={14} /> Back to all answers
                    </button>
                  </div>
                ) : null}

                {pollStatus === "failed" ? (
                  <div className={styles.errorCard} role="alert">
                    <span>{SUBMIT_FAILED_COPY}</span>
                    <button className={styles.retryBtn} onClick={retrySubmit}>
                      <Icon name="refresh" size={14} /> Try again
                    </button>
                  </div>
                ) : null}

                {pollStatus === "done" && pollData ? (
                  <>
                    <div className={styles.successNote}>
                      <Icon name="check-circle" size={16} /> Marked PDF ready — here&apos;s your result.
                    </div>
                    <EvalResult data={pollData} />
                    <button className={styles.retryBtn} onClick={retrySubmit} style={{ marginTop: 14 }}>
                      <Icon name="plus" size={14} /> Submit another answer
                    </button>
                  </>
                ) : null}
              </>
            ) : null}

            {/* ── DETAIL VIEW ── */}
            {view === "detail" ? (
              <>
                <button className="ae-back" onClick={backToList}><Icon name="arrow-left" size={16} /> All answers</button>
                {error ? (
                  <div className={styles.errorCard} role="alert">
                    <span>{error}</span>
                    <button className={styles.retryBtn} onClick={() => openEval(detailIdRef.current)}>
                      <Icon name="refresh" size={14} /> Retry
                    </button>
                  </div>
                ) : status === "loading" ? (
                  <div className="ae-loading"><div className="ae-spinner" /><span>Loading…</span></div>
                ) : data?.result ? (
                  <EvalResult data={data} />
                ) : data?.status === "failed" ? (
                  <div className={styles.errorCard} role="alert">
                    <span>{SUBMIT_FAILED_COPY}</span>
                    <button className={styles.retryBtn} onClick={openSubmit}>
                      <Icon name="refresh" size={14} /> Submit again
                    </button>
                  </div>
                ) : data && pollStatus === "timeout" ? (
                  <div className={styles.statusCard}>
                    <div className={styles.statusTitle}><Icon name="clock" size={16} /> Still evaluating</div>
                    <p className={styles.statusSub}>
                      This one is taking longer than usual. Your answer is safe — check back in a few minutes.
                    </p>
                  </div>
                ) : data ? (
                  <StatusCard />
                ) : null}
              </>
            ) : null}

            {/* ── LIST VIEW ── */}
            {view === "list" ? (
              <>
                {error ? <p className="api-state error">{error}</p> : null}

                {pollStatus === "polling" ? <StatusCard /> : null}
                {pollStatus === "done" && pollData ? (
                  <div className={styles.successNote}>
                    <Icon name="check-circle" size={16} /> Marked PDF ready.
                    <button className={styles.successLink} onClick={() => openEval(pollData.eval_id)}>
                      View the result
                    </button>
                  </div>
                ) : null}

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

                {listLoading ? <ListSkeleton /> : null}
                {!listLoading && list.length === 0 ? (
                  searchQ || fromDate || toDate ? (
                    <p className="day-state">No evaluated answers match your search.</p>
                  ) : (
                    <div className={styles.emptyState}>
                      Upload your first Mains answer — you&apos;ll get it back with red-ink marks and margin comments.
                    </div>
                  )
                ) : null}

                {!listLoading && groupedList.map((group) => (
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
                        <span className={`ae-hist-meta ${it.status === "completed" ? scoreBandClass(it.total_awarded, it.total_max) : ""}`}>
                          {it.status === "completed"
                            ? `${it.total_awarded}/${it.total_max}`
                            : it.status === "failed" ? "failed" : "evaluating…"}
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
