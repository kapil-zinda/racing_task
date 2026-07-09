"use client";

import { useRef, useState } from "react";
import Icon from "./Icon";

function pctOf(awarded, max) {
  const a = Number(awarded), m = Number(max);
  return m ? Math.max(0, Math.min(100, (a / m) * 100)) : 0;
}
function bandLabel(p) {
  if (p >= 80) return "Excellent";
  if (p >= 65) return "Good Attempt";
  if (p >= 40) return "Average";
  return "Needs Work";
}
function bandColor(p) {
  if (p >= 80) return "#80ed99";
  if (p >= 65) return "#72ddf7";
  if (p >= 40) return "#ffd166";
  return "#ff6b6b";
}

// Off-screen branded report — rasterised into a downloadable PDF, separate from the
// "Download marked PDF" button (which stays on the backend's baked red-ink PDF).
export default function AnswerEvalReport({ data }) {
  const [busy, setBusy] = useState(false);
  const reportRef = useRef(null);
  const result = data?.result;
  if (!result) return null;

  const buildPdf = async () => {
    const [{ default: html2canvas }, jspdf] = await Promise.all([
      import("html2canvas"),
      import("jspdf"),
    ]);
    const JsPDF = jspdf.jsPDF || jspdf.default;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const node = reportRef.current;
    if (!node) return;

    const canvas = await html2canvas(node, { scale: 2, backgroundColor: "#0b0f1a", useCORS: true, logging: false });
    const pdf = new JsPDF("p", "pt", "a4");
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const imgW = pageW;
    const imgH = (canvas.height * imgW) / canvas.width;
    const imgData = canvas.toDataURL("image/jpeg", 0.95);

    let heightLeft = imgH;
    let position = 0;
    pdf.setFillColor(11, 15, 26);
    pdf.rect(0, 0, pageW, pageH, "F");
    pdf.addImage(imgData, "JPEG", 0, position, imgW, imgH);
    heightLeft -= pageH;
    while (heightLeft > 0) {
      position -= pageH;
      pdf.addPage();
      pdf.setFillColor(11, 15, 26);
      pdf.rect(0, 0, pageW, pageH, "F");
      pdf.addImage(imgData, "JPEG", 0, position, imgW, imgH);
      heightLeft -= pageH;
    }
    const slug = (data.eval_id || "evaluation-report").replace(/[^a-z0-9]+/gi, "-");
    pdf.save(`${slug}.pdf`);
  };

  const onClick = async () => {
    setBusy(true);
    try { await buildPdf(); } catch (_) { /* best-effort export */ } finally { setBusy(false); }
  };

  return (
    <>
      <button className="ae-pdf-btn" onClick={onClick} disabled={busy}>
        <Icon name="download" size={15} /> {busy ? "Building…" : "Download report"}
      </button>
      <div className="rpt-offscreen" aria-hidden="true">
        <div ref={reportRef}>
          <ReportBody data={data} result={result} />
        </div>
      </div>
    </>
  );
}

function ReportBody({ data, result }) {
  const p = pctOf(result.total_awarded, result.total_max);
  const color = bandColor(p);
  const questions = result.questions || [];
  const totalWords = questions.reduce((s, q) => s + (Number(q.word_count) || 0), 0);

  return (
    <div style={styles.doc}>
      <div style={styles.headerBar} />
      <div style={styles.header}>
        <div>
          <div style={styles.brand}>RACING&nbsp;TASK</div>
          <div style={styles.title}>Evaluation Report</div>
          {questions[0]?.question_text ? <div style={styles.subtitle}>{questions[0].question_text}</div> : null}
        </div>
        <div style={styles.scoreBox}>
          <div style={{ ...styles.scoreNum, color }}>{result.total_awarded}<span style={styles.scoreMax}>/{result.total_max}</span></div>
          <div style={{ ...styles.scoreBand, color, borderColor: `${color}55`, background: `${color}1a` }}>{bandLabel(p)}</div>
        </div>
      </div>

      <div style={styles.metaRow}>
        {totalWords ? <span style={styles.metaChip}>{totalWords} words</span> : null}
        <span style={styles.metaChip}>{questions.length} question{questions.length === 1 ? "" : "s"}</span>
        {data.filename ? <span style={styles.metaChip}>{data.filename}</span> : null}
      </div>

      {result.overall_remark ? (
        <div style={styles.quote}>
          <div style={styles.quoteLabel}>Mentor Feedback</div>
          <div style={styles.quoteText}>{result.overall_remark}</div>
        </div>
      ) : null}

      {questions.map((q, qi) => (
        <QuestionBlock key={qi} q={q} index={qi} multi={questions.length > 1} />
      ))}

      <div style={styles.footer}>Racing Task · Evaluation Report</div>
    </div>
  );
}

function QuestionBlock({ q, index, multi }) {
  const sections = q.sections || [];
  return (
    <div style={styles.qBlock}>
      {multi ? (
        <div style={styles.qHead}>
          <span style={styles.qLabel}>Question {index + 1}</span>
          <span style={styles.qMark}>{q.awarded_marks}/{q.max_marks}</span>
        </div>
      ) : null}

      {sections.length ? (
        <div style={styles.section}>
          <div style={styles.sectionHead}>Detailed Analysis</div>
          <div style={styles.sectionBody}>
            {sections.map((sec, si) => {
              const sp = pctOf(sec.awarded_marks, sec.max_marks);
              const sc = bandColor(sp);
              return (
                <div key={si} style={styles.secCard}>
                  <div style={styles.secHead}>
                    <span style={styles.secName}>{(sec.name || "").replace(/^\w/, (c) => c.toUpperCase())}</span>
                    <span style={{ ...styles.secMark, color: sc }}>{sec.awarded_marks}/{sec.max_marks}</span>
                  </div>
                  <div style={styles.secBar}><div style={{ ...styles.secBarFill, width: `${sp}%`, background: sc }} /></div>
                  {sec.remark ? <div style={styles.secRemark}>{sec.remark}</div> : null}
                  <div style={styles.secCols}>
                    <div>
                      <div style={styles.colHead}>Strengths</div>
                      {(sec.strengths || []).length ? (sec.strengths || []).map((s, i) => (
                        <div key={i} style={styles.strengthLine}>+ {s}</div>
                      )) : <div style={styles.emptyLine}>No strengths noted</div>}
                    </div>
                    <div>
                      <div style={styles.colHead}>Areas to Improve</div>
                      {(sec.improvements || []).length ? (sec.improvements || []).map((im, i) => (
                        <div key={i} style={styles.improveLine}>! {im.issue}</div>
                      )) : <div style={styles.emptyLine}>No improvements noted</div>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {q.next_attempt_focus?.issue ? (
        <div style={styles.section}>
          <div style={styles.sectionHead}>
            Next Attempt Focus
            {q.next_attempt_focus.section ? (
              <span style={styles.focusTag}>
                {(q.next_attempt_focus.section || "").toUpperCase()}
                {q.next_attempt_focus.marks_impact ? ` · -${q.next_attempt_focus.marks_impact} marks` : ""}
              </span>
            ) : null}
          </div>
          <div style={styles.sectionBody}>
            <div style={styles.focusQuote}>{q.next_attempt_focus.issue}</div>
            {q.next_attempt_focus.model_sentence ? (
              <div style={styles.exampleBox}>
                <div style={styles.exampleLabel}>Example</div>
                {q.next_attempt_focus.model_sentence}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {(q.missing_keywords || []).length ? (
        <div style={styles.section}>
          <div style={styles.sectionHead}>Missing Keywords</div>
          <div style={styles.sectionBody}>
            {q.missing_keywords.map((kw, i) => (
              <div key={i} style={styles.kwRow}>
                <span style={styles.kwTerm}>{kw.term}</span>
                <span style={styles.kwWhy}>{kw.why}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

const INK = "#e7ecf5";
const MUTED = "#8b95a7";
const CARD = "#131826";
const SUNK = "#0e1320";
const styles = {
  doc: { width: 820, background: "#0b0f1a", color: INK, fontFamily: "Manrope, Segoe UI, Arial, sans-serif", padding: "0 0 28px" },
  headerBar: { height: 8, background: "linear-gradient(90deg,#ffd166,#72ddf7,#818cf8,#80ed99)" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", padding: "28px 34px 18px", gap: 20 },
  brand: { fontFamily: "var(--font-bebas), Impact, sans-serif", letterSpacing: 2, fontSize: 18, color: MUTED },
  title: { fontFamily: "var(--font-bebas), Impact, sans-serif", fontSize: 38, lineHeight: 1, color: "#fff", marginTop: 4 },
  subtitle: { fontSize: 13, color: MUTED, marginTop: 8, maxWidth: 420, lineHeight: 1.5 },
  scoreBox: { textAlign: "right", flex: "none" },
  scoreNum: { fontFamily: "var(--font-bebas), Impact, sans-serif", fontSize: 44, lineHeight: 1 },
  scoreMax: { fontSize: 18, color: MUTED, fontWeight: 600 },
  scoreBand: { display: "inline-block", marginTop: 8, fontSize: 11, fontWeight: 800, letterSpacing: 0.5, textTransform: "uppercase", padding: "4px 12px", borderRadius: 999, border: "1px solid" },

  metaRow: { display: "flex", flexWrap: "wrap", gap: 8, padding: "0 34px 16px" },
  metaChip: { fontSize: 12, fontWeight: 600, padding: "5px 12px", borderRadius: 999, background: SUNK, color: INK, border: "1px solid #222a3d" },

  quote: { margin: "0 34px 18px", padding: "14px 18px", background: CARD, borderLeft: "4px solid #818cf8", borderRadius: 10 },
  quoteLabel: { fontSize: 11, fontWeight: 800, color: "#a5b4fc", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 },
  quoteText: { fontSize: 13.5, color: INK, lineHeight: 1.55, fontStyle: "italic" },

  qBlock: { margin: "0 0 6px" },
  qHead: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0 34px 10px" },
  qLabel: { fontSize: 14, fontWeight: 800, color: "#fff" },
  qMark: { fontFamily: "var(--font-bebas), Impact, sans-serif", fontSize: 22, color: "#ffd166" },

  section: { margin: "0 34px 18px", background: CARD, border: "1px solid #222a3d", borderRadius: 16, overflow: "hidden" },
  sectionHead: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 18px", fontSize: 15, fontWeight: 800, color: "#fff", borderBottom: "1px solid #222a3d" },
  sectionBody: { padding: "14px 18px" },
  focusTag: { fontSize: 11, fontWeight: 700, color: "#a5b4fc", background: "rgba(129,140,248,0.14)", borderRadius: 999, padding: "3px 10px" },
  focusQuote: { fontSize: 13.5, color: INK, lineHeight: 1.55, fontStyle: "italic", marginBottom: 10 },
  exampleBox: { background: SUNK, border: "1px solid #222a3d", borderRadius: 10, padding: "10px 14px", fontSize: 12.5, color: MUTED, lineHeight: 1.55 },
  exampleLabel: { fontSize: 10, fontWeight: 800, color: "#72ddf7", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 },

  secCard: { padding: "12px 0", borderBottom: "1px solid #1a2233" },
  secHead: { display: "flex", justifyContent: "space-between", alignItems: "center" },
  secName: { fontSize: 13.5, fontWeight: 800, color: "#fff" },
  secMark: { fontFamily: "var(--font-bebas), Impact, sans-serif", fontSize: 18 },
  secBar: { height: 5, borderRadius: 999, background: "rgba(255,255,255,0.08)", margin: "6px 0 8px", overflow: "hidden" },
  secBarFill: { height: "100%", borderRadius: 999 },
  secRemark: { fontSize: 12.5, color: MUTED, lineHeight: 1.5, marginBottom: 8 },
  secCols: { display: "flex", gap: 24 },
  colHead: { fontSize: 10.5, fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.5, color: MUTED, marginBottom: 4 },
  strengthLine: { fontSize: 12, color: "#80ed99", padding: "2px 0" },
  improveLine: { fontSize: 12, color: "#ffd166", padding: "2px 0" },
  emptyLine: { fontSize: 12, color: MUTED, fontStyle: "italic" },

  kwRow: { display: "flex", gap: 10, fontSize: 12.5, padding: "6px 0", borderTop: "1px solid #1a2233" },
  kwTerm: { fontWeight: 800, color: "#c4b5fd", flex: "0 0 140px" },
  kwWhy: { color: MUTED, flex: 1, lineHeight: 1.5 },

  footer: { textAlign: "center", fontSize: 11, color: MUTED, marginTop: 10 },
};
