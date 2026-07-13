"use client";

import "./search.css";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import MainMenu from "../components/MainMenu";
import Icon from "../components/Icon";
import PdfHighlightViewer from "../components/PdfHighlightViewer";
import { apiFetch } from "../lib/auth";
import { useCredits } from "../lib/credits";
import { listGoals } from "../lib/goalApi";
import { friendlyApiError } from "../lib/errors";
import styles from "./search.module.css";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "";
const NOTICE_TTL_MS = 15000;

// Highlight query terms inside a snippet.
function highlightSnippet(text, query) {
  const terms = Array.from(
    new Set((query || "").toLowerCase().split(/\s+/).map((t) => t.replace(/[^\p{L}\p{N}]/gu, "")).filter((t) => t.length >= 2))
  );
  if (!terms.length || !text) return text;
  const re = new RegExp(`(${terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
  return text.split(re).map((part, i) =>
    terms.includes(part.toLowerCase()) ? <mark key={i} className="kf-mark">{part}</mark> : part
  );
}

function sameHit(a, b) {
  return a && b && a.doc_id === b.doc_id && a.page_number === b.page_number && a.file_name === b.file_name;
}

export default function PdfSearchPage() {
  const { credits, requireCredits, refreshCredits } = useCredits();
  const [query, setQuery] = useState("");
  const [searchCourse, setSearchCourse] = useState("");
  const [goals, setGoals] = useState([]);
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState([]);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(null);
  const [searched, setSearched] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const viewerWrapRef = useRef(null);

  useEffect(() => {
    const onFs = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  useEffect(() => {
    listGoals().then((d) => setGoals(d.goals || [])).catch(() => {});
  }, []);

  useEffect(() => {
    if (!error) return;
    const id = setTimeout(() => setError(""), NOTICE_TTL_MS);
    return () => clearTimeout(id);
  }, [error]);

  const runSearch = async () => {
    if (!API_BASE_URL) return;
    const q = query.trim();
    if (!q) return;
    if (!requireCredits("vector_search")) return;
    setSearching(true);
    setError("");
    setSelected(null);
    try {
      const params = new URLSearchParams({ q, limit: "30" });
      if (searchCourse) params.set("course", searchCourse);
      const res = await apiFetch(`${API_BASE_URL}/pdf-search/query?${params.toString()}`);
      if (res.status === 402) return; // credits popup already shown
      if (!res.ok) throw new Error(`Search failed: ${res.status} ${await res.text()}`);
      const data = await res.json();
      const rows = data.results || [];
      resultsMintedAt.current = Date.now();
      setResults(rows);
      setSearched(true);
      refreshCredits();
      if (rows.length) setSelected(rows[0]);
    } catch (err) {
      setError(friendlyApiError(err));
      setResults([]);
      setSearched(true);
    } finally {
      setSearching(false);
    }
  };

  // Result URLs are presigned for 1 hour; if this tab sat idle past that,
  // clicking a hit re-resolves a fresh link by doc_id instead of 403ing.
  const resultsMintedAt = useRef(0);
  const URL_FRESH_MS = 45 * 60 * 1000;

  const selectHit = async (row) => {
    if (!row?.doc_id || Date.now() - resultsMintedAt.current < URL_FRESH_MS) {
      setSelected(row);
      return;
    }
    try {
      const res = await apiFetch(`${API_BASE_URL}/pdf-search/doc-url?doc_id=${encodeURIComponent(row.doc_id)}`);
      if (res.ok) {
        const data = await res.json();
        if (data?.url) { setSelected({ ...row, pdf_url: data.url }); return; }
      }
    } catch (_) {
      /* fall through to the stored URL */
    }
    setSelected(row);
  };

  const pdfCount = useMemo(() => new Set(results.map((r) => r.doc_id)).size, [results]);

  // Cost hint: free-tier allowance first, then the per-search price.
  const costHint = useMemo(() => {
    if (!credits) return "";
    const free = credits.free?.vector_search;
    if (free?.limit > 0 && free.remaining > 0) {
      return free.used > 0
        ? `Your first ${free.limit} searches are free — ${free.remaining} left.`
        : `Your first ${free.limit} searches are free.`;
    }
    const price = Number(credits.pricing?.vector_search_usd ?? 0);
    if (price > 0) return `Each search costs $${price.toFixed(2)} from your balance.`;
    return "";
  }, [credits]);

  const toggleFullscreen = async () => {
    try {
      const node = viewerWrapRef.current;
      if (!node) return;
      if (!document.fullscreenElement) await node.requestFullscreen();
      else await document.exitFullscreen();
    } catch (err) {
      setError(`Fullscreen failed: ${friendlyApiError(err)}`);
    }
  };

  return (
    <main className="app-shell">
      <div className="bg-orb orb-1" />
      <div className="bg-orb orb-2" />

      <header className="hero">
        <MainMenu active="search" />
        <h1>Knowledge Finder</h1>
        <p className="subtext">Search your indexed PDFs — jump to the exact page with the match highlighted.</p>
      </header>

      <section className="milestone-panel kf-panel">
        {!API_BASE_URL ? <p className="api-state warn">Set NEXT_PUBLIC_API_BASE_URL first.</p> : null}

        {/* Search bar */}
        <div className="kf-searchbar">
          <select className="task-select kf-course" value={searchCourse} onChange={(e) => setSearchCourse(e.target.value)}>
            <option value="">All goals</option>
            {goals.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
          <div className="kf-input-wrap">
            <span className="kf-search-icon"><Icon name="search" /></span>
            <input
              className="kf-input"
              placeholder="Search your PDFs — e.g. pseudo force, fundamental rights…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") runSearch(); }}
            />
          </div>
          <button className={`${styles.searchBtn} kf-go`} disabled={!API_BASE_URL || searching || !query.trim()} onClick={runSearch}>
            {searching ? "Searching…" : "Search"}
          </button>
        </div>
        {costHint ? <p className={styles.costHint}>{costHint}</p> : null}

        {error ? <p className="api-state error" role="alert">{error}</p> : null}
        {searched ? (
          <p className="kf-count">{results.length} matches across {pdfCount} PDF{pdfCount === 1 ? "" : "s"}</p>
        ) : null}

        {/* Two-pane: results | viewer */}
        <div className="kf-body">
          <div className="kf-results">
            {searching ? (
              <div className="kf-empty"><div className="ae-spinner" /><span>Searching…</span></div>
            ) : !searched ? (
              <div className="kf-empty kf-empty-hint">
                Type a query and hit Search to find passages in your PDFs — you&rsquo;ll jump straight to the matching page.
              </div>
            ) : results.length === 0 ? (
              <div className="kf-empty">
                <span>No matches for &ldquo;{query.trim()}&rdquo;.</span>
                <span>
                  Try broader or different words, widen the scope to all goals, or check the file is
                  indexed in{" "}
                  <Link href="/content" className={styles.emptyLink}>Content</Link>{" "}
                  (file menu → Make Searchable).
                </span>
              </div>
            ) : (
              results.map((row, idx) => (
                <button
                  key={`${row.doc_id}-${row.page_number}-${idx}`}
                  className={`kf-hit ${sameHit(selected, row) ? "active" : ""}`}
                  onClick={() => selectHit(row)}
                >
                  <div className="kf-hit-head">
                    <span className="kf-hit-file">{row.file_name || "PDF"}</span>
                    <span className="kf-hit-page">p{row.page_number}</span>
                  </div>
                  {row.course_label ? <span className="kf-hit-course">{row.course_label}</span> : null}
                  <div className="kf-hit-snippet">{highlightSnippet(row.snippet || "Matched content", query)}</div>
                </button>
              ))
            )}
          </div>

          <div className="kf-viewer" ref={viewerWrapRef}>
            {selected ? (
              <>
                <div className="kf-viewer-head">
                  <div className="kf-viewer-title">
                    <strong>{selected.file_name}</strong>
                    <span>match on page {selected.page_number}</span>
                  </div>
                  <button className="btn-day kf-fs" onClick={toggleFullscreen}>
                    {isFullscreen ? "Exit full screen" : "Full screen"}
                  </button>
                </div>
                <PdfHighlightViewer
                  key={`${selected.doc_id}-${selected.page_number}`}
                  url={selected.pdf_url}
                  page={selected.page_number}
                  query={query}
                />
              </>
            ) : (
              <div className="kf-viewer-empty">Select a result to open the PDF with the match highlighted.</div>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
