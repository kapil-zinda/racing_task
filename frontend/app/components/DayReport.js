"use client";

import { useRef, useState } from "react";
import Icon from "./Icon";
import { apiFetch } from "../lib/auth";
import { friendlyApiError } from "../lib/errors";
import { cssVar } from "../lib/theme";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "";

// Section accents come from theme tokens, resolved to literal hex at render
// time via secColor() — several call sites append alpha suffixes ("1a"/"22")
// to the hex string, so a raw var() won't do.
const SECTIONS = [
  { key: "time_spend", label: "Time spent", icon: "clock", token: "--blue-text", fallback: "#60a5fa" },
  { key: "goals", label: "Goals", icon: "target", token: "--indigo-text", fallback: "#a5b4fc" },
  { key: "qna", label: "QnA", icon: "chat", token: "--mint-text", fallback: "#4ade80" },
  { key: "answer_eval", label: "Answer evaluation", icon: "answer-eval", token: "--gold-text", fallback: "#fbbf24" },
  { key: "interview", label: "Interview", icon: "gavel", token: "--red-text", fallback: "#f87171" },
  { key: "mindmap", label: "Mind maps", icon: "brain", token: "--indigo-soft", fallback: "#c7d2fe" },
];
const SECTION_BY_KEY = Object.fromEntries(SECTIONS.map((s) => [s.key, s]));

const secColor = (s) => cssVar(s.token, s.fallback);

const todayStr = () => new Date().toISOString().slice(0, 10);

function fmtMins(m) {
  const t = Math.max(0, Math.round(m || 0));
  const h = Math.floor(t / 60);
  const min = t % 60;
  if (h && min) return `${h}h ${min}m`;
  if (h) return `${h}h`;
  return `${min}m`;
}

function prettyDate(d) {
  const dt = new Date(`${d}T00:00:00`);
  if (Number.isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

// A single headline stat tile used in the summary strip.
function statFor(key, s) {
  if (!s || s.error) return null;
  switch (key) {
    case "time_spend": return { value: fmtMins(s.total_minutes), label: `${(s.entries || []).length} entries logged` };
    case "goals": return { value: s.total_updates ?? 0, label: `across ${(s.items || []).length} goal${(s.items || []).length === 1 ? "" : "s"}` };
    case "qna": return { value: s.questions_asked ?? 0, label: `${s.sessions || 0} session${s.sessions === 1 ? "" : "s"}` };
    case "answer_eval": return { value: s.count ?? 0, label: s.total_max ? `${s.total_awarded}/${s.total_max} marks` : "evaluated" };
    case "interview": return { value: s.count ?? 0, label: "interviews taken" };
    case "mindmap": return { value: s.count ?? 0, label: "mind maps touched" };
    default: return null;
  }
}

export default function DayReport({ open, onClose }) {
  const [date, setDate] = useState(todayStr());
  const [picked, setPicked] = useState(() => new Set(SECTIONS.map((s) => s.key)));
  const [phase, setPhase] = useState("select"); // select | working | done
  const [statusMsg, setStatusMsg] = useState("");
  const [error, setError] = useState("");
  const [report, setReport] = useState(null);
  const reportRef = useRef(null);

  if (!open) return null;

  const toggle = (key) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const selectedKeys = () => SECTIONS.map((s) => s.key).filter((k) => picked.has(k));

  const buildPdf = async (data) => {
    const [{ default: html2canvas }, jspdf] = await Promise.all([
      import("html2canvas"),
      import("jspdf"),
    ]);
    const JsPDF = jspdf.jsPDF || jspdf.default;
    // Wait one frame so the hidden report node is fully laid out.
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const node = reportRef.current;
    if (!node) throw new Error("Report render failed");

    // Page background follows the active theme (the report node styles are
    // theme tokens too, resolved by html2canvas from computed styles).
    const pageBg = cssVar("--bg", "#0b0f1a");
    const canvas = await html2canvas(node, { scale: 2, backgroundColor: pageBg, useCORS: true, logging: false });
    const pdf = new JsPDF("p", "pt", "a4");
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const imgW = pageW;
    const imgH = (canvas.height * imgW) / canvas.width;
    const imgData = canvas.toDataURL("image/jpeg", 0.95);

    let heightLeft = imgH;
    let position = 0;
    pdf.setFillColor(pageBg);
    pdf.rect(0, 0, pageW, pageH, "F");
    pdf.addImage(imgData, "JPEG", 0, position, imgW, imgH);
    heightLeft -= pageH;
    while (heightLeft > 0) {
      position -= pageH;
      pdf.addPage();
      pdf.setFillColor(pageBg);
      pdf.rect(0, 0, pageW, pageH, "F");
      pdf.addImage(imgData, "JPEG", 0, position, imgW, imgH);
      heightLeft -= pageH;
    }
    pdf.save(`racing-task-report-${data.date}.pdf`);
  };

  const generate = async () => {
    const keys = selectedKeys();
    if (!keys.length) { setError("Pick at least one section."); return; }
    setError("");
    setPhase("working");
    setStatusMsg("Gathering your day…");
    try {
      const res = await apiFetch(`${API_BASE_URL}/report/day?date=${encodeURIComponent(date)}&sections=${keys.join(",")}`);
      if (!res.ok) {
        let msg = await res.text();
        try { msg = JSON.parse(msg).detail || msg; } catch (_) {}
        throw new Error(msg);
      }
      const data = await res.json();
      setReport(data);
      setStatusMsg("Designing your PDF…");
      await buildPdf(data);
      setPhase("done");
      setStatusMsg("");
    } catch (err) {
      setError(friendlyApiError(err));
      setPhase("select");
      setStatusMsg("");
    }
  };

  const activeKeys = report ? SECTIONS.map((s) => s.key).filter((k) => report.sections && report.sections[k]) : selectedKeys();

  return (
    <div className="task-modal-overlay" role="dialog" aria-modal="true">
      <div className="rpt-modal">
        <div className="rpt-modal-head">
          <div>
            <h3>Report of the day</h3>
            <p>Pick what to include — we&apos;ll fetch today&apos;s work and build a downloadable PDF.</p>
          </div>
          <button className="rpt-close" onClick={onClose} aria-label="Close"><Icon name="x" size={18} /></button>
        </div>

        <label className="rpt-date">
          <span>Date</span>
          <input type="date" className="task-select" value={date} max={todayStr()} onChange={(e) => setDate(e.target.value)} />
        </label>

        <div className="rpt-picker">
          {SECTIONS.map((s) => {
            const on = picked.has(s.key);
            return (
              <button
                key={s.key}
                type="button"
                className={`rpt-chip ${on ? "on" : ""}`}
                style={on ? { borderColor: secColor(s), boxShadow: `0 0 0 1px ${secColor(s)}55` } : undefined}
                onClick={() => toggle(s.key)}
              >
                <span className="rpt-chip-ic" style={{ color: secColor(s) }}><Icon name={s.icon} size={17} /></span>
                <span className="rpt-chip-label">{s.label}</span>
                <span className={`rpt-chip-tick ${on ? "on" : ""}`} style={on ? { background: secColor(s), borderColor: secColor(s) } : undefined}>
                  {on ? <Icon name="check" size={12} /> : null}
                </span>
              </button>
            );
          })}
        </div>

        {error ? <p className="api-state error rpt-error">{error}</p> : null}

        <div className="rpt-actions">
          <button className="btn-day secondary" onClick={onClose} disabled={phase === "working"}>Close</button>
          <button className="btn-new" onClick={generate} disabled={phase === "working" || picked.size === 0}>
            {phase === "working" ? (statusMsg || "Working…") : (<><Icon name="download" size={15} /> Generate PDF</>)}
          </button>
        </div>
        {phase === "done" ? <p className="rpt-done"><Icon name="check-circle" size={14} /> Downloaded. Generate again for another day.</p> : null}
      </div>

      {/* Off-screen printable report — rasterised into the PDF. */}
      {report ? (
        <div className="rpt-offscreen" aria-hidden="true">
          <div className="rpt-doc" ref={reportRef}>
            <ReportBody report={report} keys={activeKeys} />
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ── The printable document ────────────────────────────────────────────────────
function ReportBody({ report, keys }) {
  const S = report.sections || {};
  const stats = keys.map((k) => ({ k, meta: SECTION_BY_KEY[k], stat: statFor(k, S[k]) })).filter((x) => x.stat);
  return (
    <div style={styles.doc}>
      <div style={styles.headerBar} />
      <div style={styles.header}>
        <div>
          <div style={styles.brand}>RACING&nbsp;TASK</div>
          <div style={styles.title}>Report of the Day</div>
        </div>
        <div style={styles.dateBox}>{prettyDate(report.date)}</div>
      </div>

      {stats.length ? (
        <div style={styles.statRow}>
          {stats.map(({ k, meta, stat }) => (
            <div key={k} style={{ ...styles.statTile, borderTop: `3px solid ${secColor(meta)}` }}>
              <div style={{ ...styles.statValue, color: secColor(meta) }}>{stat.value}</div>
              <div style={styles.statName}>{meta.label}</div>
              <div style={styles.statSub}>{stat.label}</div>
            </div>
          ))}
        </div>
      ) : null}

      {keys.map((k) => (
        <Section key={k} k={k} data={S[k]} />
      ))}

      <div style={styles.footer}>Generated by Racing Task · {prettyDate(report.date)}</div>
    </div>
  );
}

function SectionShell({ meta, children }) {
  return (
    <div style={styles.section}>
      <div style={{ ...styles.sectionHead, background: `${secColor(meta)}1a`, borderLeft: `4px solid ${secColor(meta)}` }}>
        <span style={{ color: secColor(meta), display: "inline-flex" }}><Icon name={meta.icon} size={18} /></span>
        <span style={styles.sectionTitle}>{meta.label}</span>
      </div>
      <div style={styles.sectionBody}>{children}</div>
    </div>
  );
}

function EmptyLine({ text }) {
  return <div style={styles.empty}>{text}</div>;
}

function Section({ k, data }) {
  const meta = SECTION_BY_KEY[k];
  if (!data || data.error) return <SectionShell meta={meta}><EmptyLine text="Couldn't load this section." /></SectionShell>;

  if (k === "time_spend") {
    const entries = data.entries || [];
    return (
      <SectionShell meta={meta}>
        <div style={styles.pillRow}>
          <span style={{ ...styles.pill, background: `${secColor(meta)}22`, color: secColor(meta) }}>Total {fmtMins(data.total_minutes)}</span>
          {(data.by_category || []).map((c) => (
            <span key={c.category} style={styles.pillGhost}>{c.category} · {fmtMins(c.minutes)}</span>
          ))}
        </div>
        {entries.length ? (
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Activity</th>
                <th style={styles.th}>Category</th>
                <th style={styles.thR}>Time</th>
                <th style={styles.thR}>Duration</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e, i) => (
                <tr key={i} style={i % 2 ? styles.trAlt : undefined}>
                  <td style={styles.td}>{e.title}</td>
                  <td style={styles.tdMuted}>{e.category}</td>
                  <td style={styles.tdR}>{e.start_time && e.end_time ? `${e.start_time}–${e.end_time}` : "—"}</td>
                  <td style={{ ...styles.tdR, color: secColor(meta), fontWeight: 700 }}>{fmtMins(e.duration_minutes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <EmptyLine text="No time entries logged for this day." />}
      </SectionShell>
    );
  }

  if (k === "goals") {
    const items = data.items || [];
    return (
      <SectionShell meta={meta}>
        {items.length ? items.map((g, i) => (
          <div key={i} style={styles.goalBlock}>
            <div style={{ ...styles.goalName, color: secColor(meta) }}>{g.goal}</div>
            <ul style={styles.ul}>
              {(g.tasks || []).map((t, j) => (
                <li key={j} style={styles.li}>
                  <span style={styles.liDot(secColor(meta))} />
                  <span>{t.title}{t.new_value ? <span style={styles.liMuted}> → {t.new_value}</span> : null}</span>
                </li>
              ))}
            </ul>
          </div>
        )) : <EmptyLine text="No goal progress recorded today." />}
      </SectionShell>
    );
  }

  if (k === "qna") {
    return (
      <SectionShell meta={meta}>
        <div style={styles.bigStatRow}>
          <div style={styles.bigStat}><div style={{ ...styles.bigNum, color: secColor(meta) }}>{data.questions_asked || 0}</div><div style={styles.bigLabel}>questions asked</div></div>
          <div style={styles.bigStat}><div style={{ ...styles.bigNum, color: secColor(meta) }}>{data.sessions || 0}</div><div style={styles.bigLabel}>study sessions</div></div>
        </div>
      </SectionShell>
    );
  }

  if (k === "answer_eval") {
    const items = data.items || [];
    return (
      <SectionShell meta={meta}>
        <div style={styles.pillRow}>
          <span style={{ ...styles.pill, background: `${secColor(meta)}22`, color: secColor(meta) }}>{data.count} evaluated</span>
          {data.total_max ? <span style={styles.pillGhost}>{data.total_awarded}/{data.total_max} total marks</span> : null}
        </div>
        {items.length ? items.map((it, i) => (
          <div key={i} style={styles.evalCard}>
            <div style={styles.evalHead}>
              <span style={styles.evalName}>{it.subject || it.filename}</span>
              {it.total_max ? <span style={{ ...styles.evalScore, color: secColor(meta) }}>{it.total_awarded}/{it.total_max}</span> : <span style={styles.evalPending}>{it.status}</span>}
            </div>
            {(it.questions || []).map((q, j) => (
              <div key={j} style={styles.evalQ}>
                <span style={styles.evalQText}>Q{j + 1}. {q.question_text || "Question"}</span>
                <span style={styles.evalQMark}>{q.awarded_marks ?? "—"}/{q.max_marks ?? "—"}</span>
              </div>
            ))}
          </div>
        )) : <EmptyLine text="No answers evaluated today." />}
      </SectionShell>
    );
  }

  if (k === "interview") {
    const items = data.items || [];
    return (
      <SectionShell meta={meta}>
        <div style={styles.pillRow}>
          <span style={{ ...styles.pill, background: `${secColor(meta)}22`, color: secColor(meta) }}>{data.count} interview{data.count === 1 ? "" : "s"}</span>
        </div>
        {items.length ? items.map((it, i) => (
          <div key={i} style={styles.evalCard}>
            <div style={styles.evalHead}>
              <span style={styles.evalName}>{it.question_count} questions · {it.status}</span>
              {it.overall_score != null ? <span style={{ ...styles.evalScore, color: secColor(meta) }}>{it.overall_score}/10</span> : <span style={styles.evalPending}>no rating</span>}
            </div>
            {it.verdict ? <div style={styles.verdict}>{it.verdict}</div> : null}
          </div>
        )) : <EmptyLine text="No interviews taken today." />}
      </SectionShell>
    );
  }

  if (k === "mindmap") {
    const items = data.items || [];
    return (
      <SectionShell meta={meta}>
        {items.length ? (
          <div style={styles.tagWrap}>
            {items.map((m, i) => (
              <span key={i} style={{ ...styles.mmTag, borderColor: `${secColor(meta)}55` }}>
                {m.title}{m.created ? <span style={{ color: secColor(meta) }}> · new</span> : null}
              </span>
            ))}
          </div>
        ) : <EmptyLine text="No mind maps created or edited today." />}
      </SectionShell>
    );
  }

  return null;
}

// Inline styles for the rasterised node. Theme tokens via var() are fine:
// html2canvas reads *computed* styles, where vars are already resolved —
// so the PDF follows whatever palette/mode/font is active.
const INK = "var(--text)";
const MUTED = "var(--muted)";
const CARD = "var(--card)";
const SUNK = "var(--sunken)";
const styles = {
  doc: { width: 820, background: "var(--bg)", color: INK, fontFamily: "var(--app-font, var(--font-manrope)), Manrope, Segoe UI, Arial, sans-serif", padding: "0 0 28px" },
  headerBar: { height: 8, background: "var(--brand-gradient)" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "flex-end", padding: "28px 34px 22px" },
  brand: { fontFamily: "var(--font-bebas), Impact, sans-serif", letterSpacing: 2, fontSize: 20, color: MUTED },
  title: { fontFamily: "var(--font-bebas), Impact, sans-serif", fontSize: 46, lineHeight: 1, color: "var(--text-bright)", marginTop: 4 },
  dateBox: { fontSize: 13, color: INK, background: SUNK, border: "1px solid var(--card-border)", borderRadius: 999, padding: "8px 16px" },
  statRow: { display: "flex", flexWrap: "wrap", gap: 12, padding: "0 34px 8px" },
  statTile: { flex: "1 1 150px", minWidth: 150, background: CARD, border: "1px solid var(--card-border)", borderRadius: 14, padding: "16px 16px 14px" },
  statValue: { fontFamily: "var(--font-bebas), Impact, sans-serif", fontSize: 40, lineHeight: 1 },
  statName: { fontSize: 13, fontWeight: 700, color: "var(--text-bright)", marginTop: 6 },
  statSub: { fontSize: 12, color: MUTED, marginTop: 2 },

  section: { margin: "18px 34px 0", background: CARD, border: "1px solid var(--card-border)", borderRadius: 16, overflow: "hidden" },
  sectionHead: { display: "flex", alignItems: "center", gap: 10, padding: "12px 18px" },
  sectionTitle: { fontSize: 16, fontWeight: 800, color: "var(--text-bright)" },
  sectionBody: { padding: "16px 18px" },
  empty: { fontSize: 13, color: MUTED, fontStyle: "italic" },

  pillRow: { display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 },
  pill: { fontSize: 12, fontWeight: 800, padding: "5px 12px", borderRadius: 999 },
  pillGhost: { fontSize: 12, fontWeight: 600, padding: "5px 12px", borderRadius: 999, background: SUNK, color: INK, border: "1px solid var(--card-border)" },

  table: { width: "100%", borderCollapse: "collapse", fontSize: 13 },
  th: { textAlign: "left", color: MUTED, fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, padding: "6px 8px", borderBottom: "1px solid var(--card-border)" },
  thR: { textAlign: "right", color: MUTED, fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, padding: "6px 8px", borderBottom: "1px solid var(--card-border)" },
  td: { padding: "8px", color: INK, borderBottom: "1px solid rgba(var(--veil-rgb), 0.08)" },
  tdMuted: { padding: "8px", color: MUTED, borderBottom: "1px solid rgba(var(--veil-rgb), 0.08)" },
  tdR: { padding: "8px", textAlign: "right", color: INK, borderBottom: "1px solid rgba(var(--veil-rgb), 0.08)" },
  trAlt: { background: "rgba(var(--veil-rgb), 0.03)" },

  goalBlock: { marginBottom: 12 },
  goalName: { fontSize: 14, fontWeight: 800, marginBottom: 6 },
  ul: { listStyle: "none", padding: 0, margin: 0 },
  li: { display: "flex", alignItems: "flex-start", gap: 8, fontSize: 13, color: INK, padding: "3px 0" },
  liDot: (c) => ({ width: 7, height: 7, borderRadius: 999, background: c, marginTop: 6, flex: "none" }),
  liMuted: { color: MUTED },

  bigStatRow: { display: "flex", gap: 24 },
  bigStat: { textAlign: "center" },
  bigNum: { fontFamily: "var(--font-bebas), Impact, sans-serif", fontSize: 52, lineHeight: 1 },
  bigLabel: { fontSize: 12, color: MUTED, marginTop: 2 },

  evalCard: { background: SUNK, border: "1px solid var(--card-border)", borderRadius: 12, padding: "12px 14px", marginBottom: 10 },
  evalHead: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 },
  evalName: { fontSize: 14, fontWeight: 700, color: "var(--text-bright)" },
  evalScore: { fontFamily: "var(--font-bebas), Impact, sans-serif", fontSize: 26 },
  evalPending: { fontSize: 12, color: MUTED, textTransform: "capitalize" },
  evalQ: { display: "flex", justifyContent: "space-between", gap: 10, fontSize: 12.5, color: INK, padding: "3px 0", borderTop: "1px solid rgba(var(--veil-rgb), 0.08)" },
  evalQText: { flex: 1 },
  evalQMark: { fontWeight: 800, color: "var(--text-bright)", whiteSpace: "nowrap" },
  verdict: { fontSize: 12.5, color: MUTED, lineHeight: 1.5 },

  tagWrap: { display: "flex", flexWrap: "wrap", gap: 8 },
  mmTag: { fontSize: 13, color: INK, background: SUNK, border: "1px solid var(--card-border)", borderRadius: 999, padding: "6px 14px" },

  footer: { textAlign: "center", fontSize: 11, color: MUTED, marginTop: 22 },
};
