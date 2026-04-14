"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import MainMenu from "../components/MainMenu";
import ResourceInternalMenu from "../components/ResourceInternalMenu";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "";
const NOTICE_TTL_MS = 15000;
const COURSE_OPTIONS = [
  { value: "sfg_level_1", label: "SFG Level 1" },
  { value: "sfg_level_2", label: "SFG Level 2" },
  { value: "level_up_pmp", label: "Level Up PMP" },
  { value: "spectrum", label: "Spectrum" },
  { value: "laxmikant", label: "Laxmikant" },
];

export default function PdfSearchPage() {
  const [query, setQuery] = useState("");
  const [searchCourse, setSearchCourse] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState([]);
  const [searchError, setSearchError] = useState("");
  const [selectedResult, setSelectedResult] = useState(null);
  const [viewerInstanceKey, setViewerInstanceKey] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const viewerWrapRef = useRef(null);

  useEffect(() => {
    const onFullscreenChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", onFullscreenChange);
    };
  }, []);

  useEffect(() => {
    if (!searchError) return;
    const id = setTimeout(() => setSearchError(""), NOTICE_TTL_MS);
    return () => clearTimeout(id);
  }, [searchError]);

  const runSearch = async () => {
    if (!API_BASE_URL) return;
    const q = query.trim();
    if (!q) return;
    setSearching(true);
    setSearchError("");
    setSelectedResult(null);
    setViewerInstanceKey((v) => v + 1);
    try {
      const params = new URLSearchParams({ q, limit: "30" });
      if (searchCourse) params.set("course", searchCourse);
      const res = await fetch(`${API_BASE_URL}/pdf-search/query?${params.toString()}`);
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`Search failed: ${res.status} ${txt}`);
      }
      const data = await res.json();
      setSearchResults(data.results || []);
      if ((data.results || []).length > 0) {
        setSelectedResult(data.results[0]);
        setViewerInstanceKey((v) => v + 1);
      }
    } catch (err) {
      setSearchError(String(err.message || err));
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  };

  const groupedCount = useMemo(() => {
    const set = new Set(searchResults.map((r) => r.doc_id));
    return set.size;
  }, [searchResults]);

  const selectResult = (row) => {
    setSelectedResult(row);
    setViewerInstanceKey((v) => v + 1);
  };

  const toggleViewerFullscreen = async () => {
    try {
      const node = viewerWrapRef.current;
      if (!node) return;
      if (!document.fullscreenElement) {
        await node.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch (err) {
      setSearchError(`Fullscreen failed: ${String(err.message || err)}`);
    }
  };

  return (
    <main className="app-shell">
      <div className="bg-orb orb-1" />
      <div className="bg-orb orb-2" />

      <header className="hero">
        <MainMenu active="search" />
        <ResourceInternalMenu active="search" />
        <h1>Knowledge Finder</h1>
        <p className="subtext">Search indexed PDFs and open directly on matched page.</p>
      </header>

      <section className="pdf-search-single">
        <article className="milestone-panel">
          <h2>Search PDFs</h2>
          {!API_BASE_URL ? <p className="api-state warn">Set NEXT_PUBLIC_API_BASE_URL first.</p> : null}
          <div className="session-form-grid">
            <select
              className="task-select"
              value={searchCourse}
              onChange={(e) => setSearchCourse(e.target.value)}
            >
              <option value="">Global Search (All Courses)</option>
              {COURSE_OPTIONS.map((course) => (
                <option key={course.value} value={course.value}>{course.label}</option>
              ))}
            </select>
            <input
              className="task-select"
              placeholder="Type keyword, e.g. pseudo force"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") runSearch();
              }}
            />
            <button className="btn-day" disabled={!API_BASE_URL || searching || !query.trim()} onClick={runSearch}>
              {searching ? "Searching..." : "Search"}
            </button>
          </div>
          {searchError ? <p className="api-state error">{searchError}</p> : null}
          <p className="day-state">Results: {searchResults.length} hits in {groupedCount} PDFs.</p>

          <div className="history-list">
            {searchResults.length === 0 ? (
              <div className="history-item">
                <div className="history-detail">No search results yet.</div>
              </div>
            ) : (
              searchResults.map((row, idx) => {
                const rowKey = `${row.doc_id}-${row.page_number}-${idx}`;
                const isSelected =
                  selectedResult &&
                  selectedResult.doc_id === row.doc_id &&
                  selectedResult.page_number === row.page_number &&
                  selectedResult.file_name === row.file_name &&
                  selectedResult.course === row.course;

                return (
                  <div key={rowKey}>
                    <button
                      className={`history-item search-hit ${isSelected ? "search-hit-active" : ""}`}
                      onClick={() => selectResult(row)}
                    >
                      <div className="history-top">
                        <span className="history-action">
                          {row.file_name || "PDF"} {row.course_label ? `• ${row.course_label}` : ""}
                        </span>
                        <span className="history-points">Page {row.page_number}</span>
                      </div>
                      <div className="history-detail">{row.snippet || "Matched content"}</div>
                    </button>

                    {isSelected ? (
                      <div className="history-item" style={{ marginTop: 8 }}>
                        <div className="search-viewer-head">
                          <h2 style={{ margin: 0, fontSize: 18 }}>PDF Viewer</h2>
                          <button className="btn-day secondary" onClick={toggleViewerFullscreen}>
                            {isFullscreen ? "Exit Full Screen" : "Full Screen"}
                          </button>
                        </div>
                        <p className="day-state" style={{ marginBottom: 8 }}>
                          {row.file_name} • Opening at page {row.page_number}
                        </p>
                        <div className="search-viewer-wrap search-viewer-wide" ref={viewerWrapRef}>
                          <iframe
                            key={`${viewerInstanceKey}-${row.doc_id}-${row.page_number}`}
                            title="PDF Viewer"
                            className="search-viewer"
                            src={`${row.pdf_url}#page=${row.page_number}&view=FitH`}
                          />
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })
            )}
          </div>
        </article>
      </section>

    </main>
  );
}
