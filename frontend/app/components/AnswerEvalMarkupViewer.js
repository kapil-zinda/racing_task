"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Icon from "./Icon";

// Same lazy pdf.js loader pattern as PdfHighlightViewer.js.
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

const TAG_LABEL = { good: "Strong point", missing: "Missing", improve: "Area to improve", section: "Section score" };

function normalize(s) {
  return (s || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function rectsOverlap(a, b) {
  return !(a.left + a.width < b.left || b.left + b.width < a.left || a.top + a.height < b.top || b.top + b.height < a.top);
}

// Nudges a badge upward off any previously-placed badge on the same page so
// numbered markers never sit exactly on top of one another.
function placeBadge(placed, desiredLeft, desiredTop, w, h) {
  let left = desiredLeft;
  let top = desiredTop;
  let attempts = 0;
  while (attempts < 10 && placed.some((r) => rectsOverlap({ left, top, width: w, height: h }, r))) {
    top -= h + 3;
    attempts += 1;
  }
  placed.push({ left, top, width: w, height: h });
  return { left, top };
}

// Flatten a question's comments + section start-markers into one highlight list,
// keyed by page (1-based). Each item carries either a server-computed bbox
// (normalized 0-1, from Textract geometry — used for scanned/handwritten answers)
// or a bare `quote` to be located client-side against the PDF's own text layer
// (works for typed PDFs, which have no server-side OCR geometry).
function buildHighlights(questions) {
  const byPage = new Map();
  const push = (page, item) => {
    if (!page) return;
    if (!byPage.has(page)) byPage.set(page, []);
    byPage.get(page).push(item);
  };
  (questions || []).forEach((q, qi) => {
    (q.comments || []).forEach((c, ci) => {
      const page = c.bbox?.page || c.page;
      push(page, {
        key: `q${qi}-c${ci}`,
        tag: c.tag || "improve",
        text: c.text || "",
        quote: c.quote || "",
        bbox: c.bbox || null,
      });
    });
    (q.sections || []).forEach((sec, si) => {
      const page = sec.start_bbox?.page || sec.start_page;
      if (!page) return;
      const name = (sec.name || "").replace(/^\w/, (c) => c.toUpperCase());
      push(page, {
        key: `q${qi}-s${si}`,
        tag: "section",
        text: `${name}: ${sec.awarded_marks}/${sec.max_marks}`,
        quote: sec.start_quote || "",
        bbox: sec.start_bbox || null,
      });
    });
  });
  return byPage;
}

export default function AnswerEvalMarkupViewer({ url, questions }) {
  const canvasRef = useRef(null);
  const layerRef = useRef(null);
  const scrollRef = useRef(null);
  const pdfRef = useRef(null);
  const renderTaskRef = useRef(null);

  const [numPages, setNumPages] = useState(0);
  const [current, setCurrent] = useState(1);
  const [scale, setScale] = useState(1.2);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showMarkup, setShowMarkup] = useState(true);
  const [activeKey, setActiveKey] = useState(null);

  const highlightsByPage = useMemo(() => buildHighlights(questions), [questions]);
  const currentHighlights = highlightsByPage.get(current) || [];

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    setNumPages(0);
    (async () => {
      try {
        const pdfjs = await getPdfJs();
        const doc = await pdfjs.getDocument({ url }).promise;
        if (cancelled) return;
        pdfRef.current = doc;
        setNumPages(doc.numPages);
        setCurrent((c) => Math.min(Math.max(1, c), doc.numPages));
      } catch (_) {
        if (!cancelled) setError("Could not load this PDF.");
      }
    })();
    return () => {
      cancelled = true;
      try { pdfRef.current?.destroy?.(); } catch (_) {}
      pdfRef.current = null;
    };
  }, [url]);

  const renderPage = useCallback(async () => {
    const doc = pdfRef.current;
    const canvas = canvasRef.current;
    const layer = layerRef.current;
    if (!doc || !canvas || !layer || !current) return;
    setLoading(true);
    try {
      const pdfjs = await getPdfJs();
      const p = await doc.getPage(current);
      const outputScale = window.devicePixelRatio || 1;
      const viewport = p.getViewport({ scale });

      canvas.width = Math.floor(viewport.width * outputScale);
      canvas.height = Math.floor(viewport.height * outputScale);
      canvas.style.width = `${Math.floor(viewport.width)}px`;
      canvas.style.height = `${Math.floor(viewport.height)}px`;
      layer.style.width = `${Math.floor(viewport.width)}px`;
      layer.style.height = `${Math.floor(viewport.height)}px`;

      if (renderTaskRef.current) { try { renderTaskRef.current.cancel(); } catch (_) {} }
      const ctx = canvas.getContext("2d");
      const task = p.render({
        canvasContext: ctx,
        viewport,
        transform: outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : undefined,
      });
      renderTaskRef.current = task;
      await task.promise;

      layer.innerHTML = "";
      const items = highlightsByPage.get(current) || [];
      if (items.length) {
        // Text layer is only present for typed PDFs — needed as a fallback for
        // highlights that arrived without a server-computed bbox (scanned/handwritten
        // pages always carry bbox already; typed pages never do).
        let textItems = null;
        if (items.some((it) => !it.bbox)) {
          try {
            const tc = await p.getTextContent();
            textItems = tc.items;
          } catch (_) {
            textItems = [];
          }
        }

        const placedBadges = [];
        items.forEach((it, idx) => {
          let rect = null;
          if (it.bbox) {
            rect = {
              left: it.bbox.left * viewport.width,
              top: it.bbox.top * viewport.height,
              width: Math.max(it.bbox.width * viewport.width, 20),
              height: Math.max(it.bbox.height * viewport.height, 12),
            };
          } else if (it.quote && textItems) {
            rect = locateQuoteInTextLayer(textItems, it.quote, viewport, scale, pdfjs);
          }
          if (!rect) return;
          const tagClass = `ae-mark-${it.tag}`;
          const isActive = it.key === activeKey;

          // Thin underline traces the exact quoted span without covering the text.
          const bar = document.createElement("div");
          bar.className = `ae-mark-bar ${tagClass} ${isActive ? "ae-mark-active" : ""}`;
          bar.style.left = `${rect.left}px`;
          bar.style.top = `${rect.top + rect.height}px`;
          bar.style.width = `${Math.max(rect.width, 10)}px`;
          layer.appendChild(bar);

          // Numbered badge is the always-visible label (no hover needed), nudged
          // off any nearby badge so overlapping quotes don't collide visually.
          const badgeSize = 18;
          const { left: bLeft, top: bTop } = placeBadge(
            placedBadges,
            rect.left - 2,
            rect.top - badgeSize - 3,
            badgeSize,
            badgeSize
          );
          const badge = document.createElement("div");
          badge.className = `ae-mark-badge ${tagClass} ${isActive ? "ae-mark-active" : ""}`;
          badge.style.left = `${bLeft}px`;
          badge.style.top = `${bTop}px`;
          badge.style.pointerEvents = "auto";
          badge.textContent = String(idx + 1);
          badge.title = it.text;
          badge.onmouseenter = () => setActiveKey(it.key);
          badge.onmouseleave = () => setActiveKey(null);
          layer.appendChild(badge);
        });
      }
    } catch (e) {
      if (e?.name !== "RenderingCancelledException") setError("Failed to render this page.");
    } finally {
      setLoading(false);
    }
  }, [current, scale, highlightsByPage, activeKey]);

  useEffect(() => { renderPage(); }, [renderPage, numPages]);

  const go = (delta) => setCurrent((c) => Math.min(Math.max(1, c + delta), numPages || 1));

  return (
    <div className="ae-markup">
      <div className="ae-markup-head">
        <span className="ae-markup-title"><Icon name="pencil" size={14} /> Examiner&apos;s Markup</span>
        <span className="ae-markup-count">{numPages ? `${numPages} page${numPages === 1 ? "" : "s"}` : ""}</span>
        <button className="ae-markup-toggle" onClick={() => setShowMarkup((v) => !v)}>
          {showMarkup ? "Hide markup" : "Show markup"}
        </button>
      </div>

      {showMarkup ? (
        <div className="ae-markup-legend">
          <span className="ae-legend-item"><i className="ae-legend-dot good" /> Strong point</span>
          <span className="ae-legend-item"><i className="ae-legend-dot improve" /> Area to improve</span>
          <span className="ae-legend-item"><i className="ae-legend-dot missing" /> Missing</span>
          <span className="ae-legend-item"><i className="ae-legend-dot section" /> Section score</span>
        </div>
      ) : null}

      <div className="pdfhl">
        <div className="pdfhl-toolbar">
          <div className="pdfhl-nav">
            <button className="pdfhl-btn" onClick={() => go(-1)} disabled={current <= 1}>‹</button>
            <span className="pdfhl-page">Page {current}{numPages ? ` / ${numPages}` : ""}</span>
            <button className="pdfhl-btn" onClick={() => go(1)} disabled={numPages ? current >= numPages : true}>›</button>
          </div>
          <div className="pdfhl-right">
            <button className="pdfhl-btn" onClick={() => setScale((s) => Math.max(0.6, +(s - 0.2).toFixed(2)))}>−</button>
            <button className="pdfhl-btn" onClick={() => setScale((s) => Math.min(3, +(s + 0.2).toFixed(2)))}>+</button>
          </div>
        </div>
        <div className="pdfhl-scroll" ref={scrollRef}>
          {error ? <div className="pdfhl-msg">{error}</div> : null}
          <div className="pdfhl-stage">
            <canvas ref={canvasRef} className="pdfhl-canvas" />
            <div ref={layerRef} className={`pdfhl-layer ae-mark-layer ${showMarkup ? "" : "ae-mark-hidden"}`} />
            {loading ? <div className="pdfhl-loading"><div className="ae-spinner" /></div> : null}
          </div>
        </div>
      </div>

      {showMarkup && currentHighlights.length ? (
        <ul className="ae-markup-list">
          {currentHighlights.map((it, idx) => (
            <li
              key={it.key}
              className={`ae-markup-list-item ae-mark-${it.tag} ${it.key === activeKey ? "ae-mark-active" : ""}`}
              onMouseEnter={() => setActiveKey(it.key)}
              onMouseLeave={() => setActiveKey(null)}
            >
              <span className={`ae-markup-num ae-mark-${it.tag}`}>{idx + 1}</span>
              <span className="ae-markup-tag">{TAG_LABEL[it.tag] || it.tag}</span>
              {it.text}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

// Best-effort: find a short quoted phrase inside a typed PDF's own text layer (only
// pages with real text content reach here — scanned/handwritten pages always carry a
// server-computed bbox already and never call this). Concatenates text items in
// document order, does a normalized substring search, then unions the transformed
// boxes of every item overlapping the match.
function locateQuoteInTextLayer(textItems, quote, viewport, scale, pdfjs) {
  const q = normalize(quote);
  if (!q || !textItems?.length) return null;

  let offset = 0;
  const spans = [];
  let joined = "";
  for (const item of textItems) {
    const s = normalize(item.str);
    if (!s) continue;
    if (joined) joined += " ";
    const start = joined.length;
    joined += s;
    spans.push({ item, start, end: joined.length });
  }
  const idx = joined.indexOf(q);
  if (idx === -1) return null;
  const matchEnd = idx + q.length;
  const hit = spans.filter((sp) => sp.end > idx && sp.start < matchEnd);
  if (!hit.length) return null;

  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  for (const { item } of hit) {
    const m = pdfjs.Util.transform(viewport.transform, item.transform);
    const fontHeight = Math.hypot(m[1], m[3]) || (item.height || 0) * scale || 10;
    const x = m[4];
    const y = m[5] - fontHeight;
    const w = (item.width || 0) * scale;
    left = Math.min(left, x);
    top = Math.min(top, y);
    right = Math.max(right, x + w);
    bottom = Math.max(bottom, y + fontHeight * 1.25);
  }
  if (!isFinite(left)) return null;
  return { left, top, width: right - left, height: bottom - top };
}
