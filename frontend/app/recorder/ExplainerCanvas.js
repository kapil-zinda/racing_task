"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { friendlyApiError } from "../lib/errors";

const CANVAS_W = 1280;
const CANVAS_H = 720;
const BG = "#0d0d1a";
const PAGE_GAP = 24; // pixels between pages in scroll view

let _pdfJsPromise = null;
function getPdfJs() {
  if (!_pdfJsPromise) {
    _pdfJsPromise = import("pdfjs-dist").then((lib) => {
      lib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
      return lib;
    }).catch((err) => {
      console.error("[ExplainerCanvas] pdfjs load failed:", err);
      throw err;
    });
  }
  return _pdfJsPromise;
}

function fmtDur(s) {
  const t = Math.max(0, s);
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}

function bestMime() {
  for (const m of ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"]) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(m)) return m;
  }
  return "video/webm";
}

function ExplainerCanvas({ files, fileIdx, zoom, onZoomChange, onRecorded, onRecordingChange }, ref) {
  const canvasRef      = useRef(null);
  const pdfDocRef      = useRef(null);
  const imgRef         = useRef(null);
  const mediaRecRef    = useRef(null);
  const chunksRef      = useRef([]);
  const micStreamRef   = useRef(null);
  const timerRef       = useRef(null);
  const zoomRef        = useRef(zoom);
  const scrollYRef     = useRef(0);           // smooth scroll offset (>= 0)
  const panRef         = useRef({ x: 0, y: 0 }); // image pan only
  const dragRef        = useRef(null);
  const pinchRef       = useRef(null);
  const touchRef       = useRef(null);
  const startTimeRef   = useRef(0);
  const pageHeightsRef = useRef([]);          // natural fit-heights at zoom=1
  const pageCacheRef   = useRef(new Map());   // "pageNum_zoom" -> HTMLCanvasElement
  const drawPendingRef = useRef(false);

  const [totalPages, setTotalPages]   = useState(0);
  const [currentPage, setCurrentPage] = useState(1); // indicator only
  const [isRecording, setIsRecording] = useState(false);
  const [duration, setDuration]       = useState(0);
  const [recError, setRecError]       = useState("");
  const [, tick] = useState(0);

  useEffect(() => { zoomRef.current = zoom; pageCacheRef.current = new Map(); draw(); }, [zoom]); // eslint-disable-line

  // ── helpers ──────────────────────────────────────────────────────────────
  function getTotalContentHeight(z) {
    const heights = pageHeightsRef.current;
    if (!heights.length) return 0;
    return heights.reduce((s, h) => s + Math.ceil(h * z), 0) + PAGE_GAP * (heights.length - 1);
  }

  function clampScroll(y, z) {
    const max = Math.max(0, getTotalContentHeight(z) - CANVAS_H);
    return Math.max(0, Math.min(max, y));
  }

  // Which page number is nearest the center of the viewport?
  function getVisiblePage(scrollY, z) {
    const heights = pageHeightsRef.current;
    if (!heights.length) return 1;
    let y = 0;
    const mid = scrollY + CANVAS_H / 2;
    for (let i = 0; i < heights.length; i++) {
      const h = Math.ceil(heights[i] * z);
      if (mid <= y + h) return i + 1;
      y += h + PAGE_GAP;
    }
    return heights.length;
  }

  // ── draw ─────────────────────────────────────────────────────────────────
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    const z   = zoomRef.current;
    const doc = pdfDocRef.current;
    const heights = pageHeightsRef.current;

    if (doc && heights.length > 0) {
      const scrollY = scrollYRef.current;
      let contentY = 0;

      for (let i = 0; i < heights.length; i++) {
        const pageNum = i + 1;
        const pageH   = Math.ceil(heights[i] * z);
        const yOnCanvas = contentY - scrollY;

        // skip pages fully outside viewport
        if (yOnCanvas + pageH < 0 || yOnCanvas > CANVAS_H) {
          contentY += pageH + PAGE_GAP;
          continue;
        }

        const cacheKey = `${pageNum}_${z.toFixed(2)}`;

        if (pageCacheRef.current.has(cacheKey)) {
          ctx.drawImage(pageCacheRef.current.get(cacheKey), 0, yOnCanvas);
        } else {
          // placeholder while async render runs
          ctx.fillStyle = "#1a1a2e";
          ctx.fillRect(0, Math.max(0, yOnCanvas), CANVAS_W,
            Math.min(pageH, CANVAS_H - Math.max(0, yOnCanvas)));

          if (!drawPendingRef.current) {
            drawPendingRef.current = true;
            (async () => {
              try {
                const pg  = await doc.getPage(pageNum);
                const vp0 = pg.getViewport({ scale: 1 });
                const fit = CANVAS_W / vp0.width;
                const vp  = pg.getViewport({ scale: fit * z });
                const tmp = document.createElement("canvas");
                tmp.width  = Math.ceil(vp.width);
                tmp.height = Math.ceil(vp.height);
                const task = pg.render({ canvasContext: tmp.getContext("2d"), viewport: vp });
                await (task.promise ?? task);
                pageCacheRef.current.set(cacheKey, tmp);
              } catch (e) {
                console.error("[ExplainerCanvas] page render error", e);
              } finally {
                drawPendingRef.current = false;
                draw();
              }
            })();
          }
        }

        contentY += pageH + PAGE_GAP;
      }
      return;
    }

    // Image
    const { x: px, y: py } = panRef.current;
    if (imgRef.current) {
      const img  = imgRef.current;
      const base = Math.min(CANVAS_W / img.naturalWidth, CANVAS_H / img.naturalHeight);
      const dw   = img.naturalWidth  * base * z;
      const dh   = img.naturalHeight * base * z;
      ctx.drawImage(img, (CANVAS_W - dw) / 2 + px, (CANVAS_H - dh) / 2 + py, dw, dh);
    } else {
      ctx.fillStyle = "#1e1b4b";
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
      ctx.fillStyle = "#4b5563";
      ctx.font      = "24px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("Add a PDF or image to preview here", CANVAS_W / 2, CANVAS_H / 2);
    }
  }, []); // eslint-disable-line

  // ── load file ────────────────────────────────────────────────────────────
  useEffect(() => {
    const f = files[fileIdx];
    pdfDocRef.current    = null;
    imgRef.current       = null;
    scrollYRef.current   = 0;
    panRef.current       = { x: 0, y: 0 };
    pageHeightsRef.current = [];
    pageCacheRef.current = new Map();
    setTotalPages(0);
    setCurrentPage(1);

    if (!f) { draw(); return; }

    if (f.kind === "pdf") {
      getPdfJs().then(async (lib) => {
        const doc = await lib.getDocument({ url: f.url, withCredentials: false }).promise;
        pdfDocRef.current = doc;
        setTotalPages(doc.numPages);

        // Pre-compute natural display heights for all pages
        const heights = [];
        for (let i = 1; i <= doc.numPages; i++) {
          const pg  = await doc.getPage(i);
          const vp0 = pg.getViewport({ scale: 1 });
          heights.push(Math.ceil((vp0.height / vp0.width) * CANVAS_W));
        }
        pageHeightsRef.current = heights;
        draw();
      }).catch((err) => { console.error("[ExplainerCanvas] PDF load error:", err); draw(); });
    } else {
      const img = new Image();
      img.onload  = () => { imgRef.current = img; draw(); };
      img.onerror = () => draw();
      img.src     = f.url;
    }
  }, [files, fileIdx, draw]);

  // ── mouse drag (scroll on PDF, pan on image) ─────────────────────────────
  const onMouseDown = (e) => {
    dragRef.current = {
      sx: e.clientX, sy: e.clientY,
      scrollY: scrollYRef.current,
      px: panRef.current.x, py: panRef.current.y,
    };
    tick((n) => n + 1);
  };
  const onMouseMove = (e) => {
    if (!dragRef.current) return;
    if (pdfDocRef.current) {
      const dy = dragRef.current.sy - e.clientY; // drag up = scroll down
      scrollYRef.current = clampScroll(dragRef.current.scrollY + dy, zoomRef.current);
      setCurrentPage(getVisiblePage(scrollYRef.current, zoomRef.current));
    } else {
      panRef.current = {
        x: dragRef.current.px + (e.clientX - dragRef.current.sx),
        y: dragRef.current.py + (e.clientY - dragRef.current.sy),
      };
    }
    draw();
  };
  const onMouseUp = () => { dragRef.current = null; tick((n) => n + 1); };

  // ── touch: single = scroll/pan, two-finger = pinch-zoom ──────────────────
  const onTouchStart = (e) => {
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      pinchRef.current = { dist: Math.hypot(dx, dy), zoom: zoomRef.current };
      touchRef.current = null;
    } else {
      pinchRef.current = null;
      const t = e.touches[0];
      touchRef.current = {
        sx: t.clientX, sy: t.clientY,
        scrollY: scrollYRef.current,
        px: panRef.current.x, py: panRef.current.y,
      };
    }
  };
  const onTouchMove = (e) => {
    e.preventDefault();
    if (e.touches.length === 2 && pinchRef.current) {
      const dx   = e.touches[0].clientX - e.touches[1].clientX;
      const dy   = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.hypot(dx, dy);
      const next = Math.max(0.25, Math.min(5, parseFloat((pinchRef.current.zoom * dist / pinchRef.current.dist).toFixed(2))));
      onZoomChange(next);
      return;
    }
    if (!touchRef.current) return;
    const t = e.touches[0];
    if (pdfDocRef.current) {
      const dy = touchRef.current.sy - t.clientY;
      scrollYRef.current = clampScroll(touchRef.current.scrollY + dy, zoomRef.current);
      setCurrentPage(getVisiblePage(scrollYRef.current, zoomRef.current));
    } else {
      panRef.current = {
        x: touchRef.current.px + (t.clientX - touchRef.current.sx),
        y: touchRef.current.py + (t.clientY - touchRef.current.sy),
      };
    }
    draw();
  };
  const onTouchEnd = () => { touchRef.current = null; pinchRef.current = null; };

  // ── wheel: ctrl/meta = zoom, plain = scroll ───────────────────────────────
  const onWheel = (e) => {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      const delta = e.deltaY < 0 ? 0.1 : -0.1;
      const next  = Math.max(0.25, Math.min(5, parseFloat((zoomRef.current + delta).toFixed(2))));
      onZoomChange(next);
      return;
    }
    if (pdfDocRef.current) {
      const speed = e.deltaMode === 1 ? 40 : 1; // line mode vs pixel mode
      scrollYRef.current = clampScroll(scrollYRef.current + e.deltaY * speed, zoomRef.current);
      setCurrentPage(getVisiblePage(scrollYRef.current, zoomRef.current));
      draw();
    }
  };

  // ── recording ─────────────────────────────────────────────────────────────
  const startRecord = async () => {
    const canvas = canvasRef.current;
    if (!canvas || isRecording) return;
    setRecError("");
    try {
      const micStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      micStreamRef.current = micStream;
      const videoStream = canvas.captureStream(30);
      const combined    = new MediaStream([...videoStream.getVideoTracks(), ...micStream.getAudioTracks()]);
      const mime        = bestMime();
      chunksRef.current = [];
      const rec = new MediaRecorder(combined, { mimeType: mime });
      rec.ondataavailable = (ev) => { if (ev.data.size > 0) chunksRef.current.push(ev.data); };
      rec.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mime });
        const secs = Math.round((Date.now() - startTimeRef.current) / 1000);
        onRecorded(blob, secs);
        micStream.getTracks().forEach((t) => t.stop());
      };
      rec.start(500);
      mediaRecRef.current  = rec;
      startTimeRef.current = Date.now();
      setIsRecording(true);
      onRecordingChange?.(true);
      setDuration(0);
      timerRef.current = setInterval(() => setDuration((d) => d + 1), 1000);
    } catch (err) {
      setRecError(`Mic access failed — ${friendlyApiError(err)}`);
    }
  };

  const stopRecord = () => {
    if (mediaRecRef.current?.state !== "inactive") mediaRecRef.current?.stop();
    clearInterval(timerRef.current);
    setIsRecording(false);
    onRecordingChange?.(false);
    setDuration(0);
  };

  useImperativeHandle(ref, () => ({ startRecord, stopRecord, isRecording }));

  // Non-passive wheel + touch listeners
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.addEventListener("wheel",      onWheel,      { passive: false });
    canvas.addEventListener("touchstart", onTouchStart, { passive: false });
    canvas.addEventListener("touchmove",  onTouchMove,  { passive: false });
    canvas.addEventListener("touchend",   onTouchEnd,   { passive: false });
    return () => {
      canvas.removeEventListener("wheel",      onWheel);
      canvas.removeEventListener("touchstart", onTouchStart);
      canvas.removeEventListener("touchmove",  onTouchMove);
      canvas.removeEventListener("touchend",   onTouchEnd);
    };
  }); // no dep array — fresh closures each render

  // Cleanup on unmount
  useEffect(() => () => {
    clearInterval(timerRef.current);
    micStreamRef.current?.getTracks().forEach((t) => t.stop());
    if (mediaRecRef.current?.state !== "inactive") mediaRecRef.current?.stop();
  }, []);

  const isDragging = Boolean(dragRef.current);

  return (
    <div className="exp-wrap">
      <canvas
        ref={canvasRef}
        width={CANVAS_W}
        height={CANVAS_H}
        className="exp-canvas"
        style={{ cursor: isDragging ? "grabbing" : "grab" }}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
      />

      <div className="exp-overlay-bar">
        {totalPages > 0 && (
          <span className="exp-page-num">
            {currentPage} / {totalPages}
          </span>
        )}
        {(recError || isRecording) ? (
          <div className="exp-rec-area">
            {recError && <span className="exp-rec-err">{recError}</span>}
            {isRecording && (
              <span className="exp-rec-time">
                <span className="exp-rec-dot" /> {fmtDur(duration)}
              </span>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default forwardRef(ExplainerCanvas);
