"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import MainMenu from "../components/MainMenu";
import PdfHighlightViewer from "../components/PdfHighlightViewer";
import { apiFetch } from "../lib/auth";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "";
const NOTICE_TTL_MS = 15000;
const COURSE_OPTIONS = [
  { value: "sfg_level_1", label: "SFG Level 1" },
  { value: "sfg_level_2", label: "SFG Level 2" },
  { value: "level_up_pmp", label: "Level Up PMP" },
  { value: "spectrum", label: "Spectrum" },
  { value: "laxmikant", label: "Laxmikant" },
];

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
  const [query, setQuery] = useState("");
  const [searchCourse, setSearchCourse] = useState("");
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
    if (!error) return;
    const id = setTimeout(() => setError(""), NOTICE_TTL_MS);
    return () => clearTimeout(id);
  }, [error]);

  const runSearch = async () => {
    if (!API_BASE_URL) return;
    const q = query.trim();
    if (!q) return;
    setSearching(true);
    setError("");
    setSelected(null);
    try {
      const params = new URLSearchParams({ q, limit: "30" });
      if (searchCourse) params.set("course", searchCourse);
      const res = await apiFetch(`${API_BASE_URL}/pdf-search/query?${params.toString()}`);
      if (!res.ok) throw new Error(`Search failed: ${res.status} ${await res.text()}`);
      const data = await res.json();
      const rows = data.results || [];
      setResults(rows);
      setSearched(true);
      if (rows.length) setSelected(rows[0]);
    } catch (err) {
      setError(String(err.message || err));
      setResults([]);
      setSearched(true);
    } finally {
      setSearching(false);
    }
  };

  const pdfCount = useMemo(() => new Set(results.map((r) => r.doc_id)).size, [results]);

  const toggleFullscreen = async () => {
    try {
      const node = viewerWrapRef.current;
      if (!node) return;
      if (!document.fullscreenElement) await node.requestFullscreen();
      else await document.exitFullscreen();
    } catch (err) {
      setError(`Fullscreen failed: ${String(err.message || err)}`);
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
          <select className="kf-course" value={searchCourse} onChange={(e) => setSearchCourse(e.target.value)}>
            <option value="">All courses</option>
            {COURSE_OPTIONS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
          <div className="kf-input-wrap">
            <span className="kf-search-icon">🔍</span>
            <input
              className="kf-input"
              placeholder="Search your PDFs — e.g. pseudo force, fundamental rights…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") runSearch(); }}
            />
          </div>
          <button className="btn-ticket kf-go" disabled={!API_BASE_URL || searching || !query.trim()} onClick={runSearch}>
            {searching ? "Searching…" : "Search"}
          </button>
        </div>

        {error ? <p className="api-state error">{error}</p> : null}
        {searched ? (
          <p className="kf-count">{results.length} matches across {pdfCount} PDF{pdfCount === 1 ? "" : "s"}</p>
        ) : null}

        {/* Two-pane: results | viewer */}
        <div className="kf-body">
          <div className="kf-results">
            {searching ? (
              <div className="kf-empty"><div className="ae-spinner" /><span>Searching…</span></div>
            ) : !searched ? (
              <div className="kf-empty kf-empty-hint">Type a query and hit Search to find passages in your PDFs.</div>
            ) : results.length === 0 ? (
              <div className="kf-empty">No matches. Try different words or another course.</div>
            ) : (
              results.map((row, idx) => (
                <button
                  key={`${row.doc_id}-${row.page_number}-${idx}`}
                  className={`kf-hit ${sameHit(selected, row) ? "active" : ""}`}
                  onClick={() => setSelected(row)}
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
