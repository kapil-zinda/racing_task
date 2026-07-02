"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Load pdf.js once; worker is served from /public (same as ExplainerCanvas).
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

function queryTerms(q) {
  return Array.from(
    new Set(
      (q || "")
        .toLowerCase()
        .split(/\s+/)
        .map((t) => t.replace(/[^\p{L}\p{N}]/gu, ""))
        .filter((t) => t.length >= 2)
    )
  );
}

export default function PdfHighlightViewer({ url, page = 1, query = "" }) {
  const canvasRef = useRef(null);
  const layerRef = useRef(null);
  const scrollRef = useRef(null);
  const pdfRef = useRef(null);
  const renderTaskRef = useRef(null);

  const [numPages, setNumPages] = useState(0);
  const [current, setCurrent] = useState(page);
  const [scale, setScale] = useState(1.3);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [matches, setMatches] = useState(0);

  // Load the document whenever the URL changes.
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
        setCurrent(Math.min(Math.max(1, page), doc.numPages));
      } catch (_) {
        if (!cancelled) setError("Could not load this PDF.");
      }
    })();
    return () => {
      cancelled = true;
      try { pdfRef.current?.destroy?.(); } catch (_) {}
      pdfRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  // Jump to the matched page when the selection (page prop) changes.
  useEffect(() => {
    if (numPages) setCurrent(Math.min(Math.max(1, page), numPages));
  }, [page, numPages]);

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

      // Highlight query terms by overlaying boxes on matching text items.
      layer.innerHTML = "";
      const terms = queryTerms(query);
      let count = 0;
      if (terms.length) {
        const tc = await p.getTextContent();
        for (const item of tc.items) {
          const s = (item.str || "").toLowerCase();
          if (!s.trim() || !terms.some((t) => s.includes(t))) continue;
          const m = pdfjs.Util.transform(viewport.transform, item.transform);
          const fontHeight = Math.hypot(m[1], m[3]) || (item.height || 0) * scale || 10;
          const box = document.createElement("div");
          box.className = "pdfhl-mark";
          box.style.left = `${m[4]}px`;
          box.style.top = `${m[5] - fontHeight}px`;
          box.style.width = `${(item.width || 0) * scale}px`;
          box.style.height = `${fontHeight * 1.25}px`;
          layer.appendChild(box);
          count += 1;
        }
      }
      setMatches(count);

      const first = layer.querySelector(".pdfhl-mark");
      if (first && scrollRef.current) {
        scrollRef.current.scrollTop = Math.max(0, parseFloat(first.style.top) - 90);
      }
    } catch (e) {
      if (e?.name !== "RenderingCancelledException") setError("Failed to render this page.");
    } finally {
      setLoading(false);
    }
  }, [current, scale, query]);

  useEffect(() => { renderPage(); }, [renderPage, numPages]);

  const go = (delta) => setCurrent((c) => Math.min(Math.max(1, c + delta), numPages || 1));

  return (
    <div className="pdfhl">
      <div className="pdfhl-toolbar">
        <div className="pdfhl-nav">
          <button className="pdfhl-btn" onClick={() => go(-1)} disabled={current <= 1}>‹</button>
          <span className="pdfhl-page">
            Page {current}{numPages ? ` / ${numPages}` : ""}
          </span>
          <button className="pdfhl-btn" onClick={() => go(1)} disabled={numPages ? current >= numPages : true}>›</button>
        </div>
        <div className="pdfhl-right">
          {query ? <span className="pdfhl-matches">{matches} match{matches === 1 ? "" : "es"} on page</span> : null}
          <button className="pdfhl-btn" onClick={() => setScale((s) => Math.max(0.6, +(s - 0.2).toFixed(2)))}>−</button>
          <button className="pdfhl-btn" onClick={() => setScale((s) => Math.min(3, +(s + 0.2).toFixed(2)))}>+</button>
        </div>
      </div>
      <div className="pdfhl-scroll" ref={scrollRef}>
        {error ? <div className="pdfhl-msg">{error}</div> : null}
        <div className="pdfhl-stage">
          <canvas ref={canvasRef} className="pdfhl-canvas" />
          <div ref={layerRef} className="pdfhl-layer" />
          {loading ? <div className="pdfhl-loading"><div className="ae-spinner" /></div> : null}
        </div>
      </div>
    </div>
  );
}
