"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "";
const SESSION_MEDIA_TYPES = ["audio", "video", "screen"];
const MULTIPART_MIN_PART_BYTES = 5 * 1024 * 1024;

function formatTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function formatDuration(totalSeconds) {
  const sec = Math.max(0, Number(totalSeconds) || 0);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return [h, m, s].map((v) => String(v).padStart(2, "0")).join(":");
}

function capitalize(value) {
  if (!value) return "";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function createEmptyMultipartState() {
  return {
    initialized: false,
    mediaType: "",
    contentType: "",
    extension: "webm",
    uploadId: "",
    key: "",
    nextPartNumber: 1,
    pendingParts: [],
    pendingBytes: 0,
    completedParts: [],
    queue: Promise.resolve(),
    failed: false
  };
}

export default function RecorderPage() {
  const [sessionForm, setSessionForm] = useState({
    user_id: "kapil",
    subject: "",
    topic: "",
    session_type: "study",
    notes: "",
    modes: ["audio", "video", "screen"]
  });
  const [sessionList, setSessionList] = useState([]);
  const [sessionLoading, setSessionLoading] = useState(false);
  const [sessionError, setSessionError] = useState("");
  const [selectedSession, setSelectedSession] = useState(null);
  const [timerState, setTimerState] = useState({ running: false, startedAt: 0, baseElapsed: 0 });
  const [nowTick, setNowTick] = useState(Date.now());
  const [playbackUrls, setPlaybackUrls] = useState({ audio: "", video: "", screen: "" });
  const [liveControls, setLiveControls] = useState({
    micMuted: false,
    cameraOff: false,
    sharingScreen: false
  });
  const recorderRefs = useRef({});
  const streamRefs = useRef({});
  const multipartUploadsRef = useRef({
    audio: createEmptyMultipartState(),
    video: createEmptyMultipartState(),
    screen: createEmptyMultipartState()
  });
  const cameraPreviewRef = useRef(null);
  const screenPreviewRef = useRef(null);
  const combinedPreviewRef = useRef(null);
  const sourceVideoRefs = useRef({});
  const compositeCanvasRef = useRef(null);
  const compositeStreamRef = useRef(null);
  const compositeDrawRef = useRef(0);
  const audioContextRef = useRef(null);
  const audioDestinationRef = useRef(null);
  const audioSourceNodesRef = useRef([]);
  const audioVizCanvasRef = useRef(null);
  const audioVizContextRef = useRef(null);
  const audioVizAnalyserRef = useRef(null);
  const audioVizSourceRef = useRef(null);
  const audioVizDataRef = useRef(null);
  const audioVizDrawRef = useRef(0);

  useEffect(() => {
    if (!timerState.running) return;
    const id = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, [timerState.running]);

  useEffect(() => () => {
    stopAndReleaseStreams();
  }, []);

  useEffect(() => {
    bindPreview(cameraPreviewRef, streamRefs.current.video || null);
    bindPreview(screenPreviewRef, streamRefs.current.screen || null);
    bindPreview(combinedPreviewRef, compositeStreamRef.current || null);
  }, [selectedSession?.status, selectedSession?._id, timerState.running, liveControls.sharingScreen]);

  const stopAudioVisualizer = () => {
    if (audioVizDrawRef.current) {
      cancelAnimationFrame(audioVizDrawRef.current);
      audioVizDrawRef.current = 0;
    }
    if (audioVizSourceRef.current) {
      try {
        audioVizSourceRef.current.disconnect();
      } catch (_) {}
      audioVizSourceRef.current = null;
    }
    if (audioVizContextRef.current) {
      audioVizContextRef.current.close().catch(() => {});
      audioVizContextRef.current = null;
    }
    audioVizAnalyserRef.current = null;
    audioVizDataRef.current = null;
    const canvas = audioVizCanvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#0b1020";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
  };

  const startAudioVisualizer = (stream) => {
    if (!stream) return;
    stopAudioVisualizer();
    const canvas = audioVizCanvasRef.current;
    if (!canvas) return;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx2d = canvas.getContext("2d");
    const audioCtx = new AudioCtx();
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.82;
    const source = audioCtx.createMediaStreamSource(stream);
    source.connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);

    audioVizContextRef.current = audioCtx;
    audioVizAnalyserRef.current = analyser;
    audioVizSourceRef.current = source;
    audioVizDataRef.current = data;

    const render = () => {
      analyser.getByteFrequencyData(data);
      ctx2d.fillStyle = "#0b1020";
      ctx2d.fillRect(0, 0, canvas.width, canvas.height);
      const bars = 32;
      const gap = 4;
      const barW = (canvas.width - (bars + 1) * gap) / bars;
      for (let i = 0; i < bars; i += 1) {
        const v = data[Math.floor((i / bars) * data.length)] / 255;
        const barH = Math.max(6, Math.floor(v * (canvas.height - 20)));
        const x = gap + i * (barW + gap);
        const y = canvas.height - barH - 10;
        const grad = ctx2d.createLinearGradient(0, y, 0, y + barH);
        grad.addColorStop(0, "#72ddf7");
        grad.addColorStop(1, "#10b981");
        ctx2d.fillStyle = grad;
        ctx2d.fillRect(x, y, barW, barH);
      }
      audioVizDrawRef.current = requestAnimationFrame(render);
    };
    render();
  };

  const fetchSessions = async (userValue = sessionForm.user_id) => {
    if (!API_BASE_URL || !userValue) return;
    setSessionLoading(true);
    setSessionError("");
    try {
      const res = await fetch(`${API_BASE_URL}/sessions?user_id=${encodeURIComponent(userValue)}`);
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`Sessions API failed: ${res.status} ${txt}`);
      }
      const data = await res.json();
      setSessionList(data.sessions || []);
      if (selectedSession) {
        const refreshed = (data.sessions || []).find((s) => s._id === selectedSession._id);
        if (refreshed) setSelectedSession(refreshed);
      }
    } catch (err) {
      setSessionError(String(err.message || err));
    } finally {
      setSessionLoading(false);
    }
  };

  const createSession = async () => {
    if (!API_BASE_URL) return;
    setSessionError("");
    const subject = sessionForm.subject.trim();
    const topic = sessionForm.topic.trim();
    const notes = sessionForm.notes.trim();
    if (!subject || !topic || !notes) {
      setSessionError("Subject, topic, and notes are required.");
      return;
    }
    try {
      const payload = {
        user_id: sessionForm.user_id,
        subject,
        topic,
        session_type: sessionForm.session_type,
        notes,
        modes: sessionForm.modes
      };
      const res = await fetch(`${API_BASE_URL}/sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`Create session failed: ${res.status} ${txt}`);
      }
      const data = await res.json();
      setSelectedSession(data.session);
      setTimerState({ running: false, startedAt: 0, baseElapsed: data.session?.elapsed_seconds || 0 });
      setPlaybackUrls({ audio: "", video: "", screen: "" });
      await fetchSessions(sessionForm.user_id);
    } catch (err) {
      setSessionError(String(err.message || err));
    }
  };

  const selectSession = (session) => {
    stopAndReleaseStreams();
    recorderRefs.current = {};
    multipartUploadsRef.current = {
      audio: createEmptyMultipartState(),
      video: createEmptyMultipartState(),
      screen: createEmptyMultipartState()
    };
    setSelectedSession(session);
    setTimerState({ running: false, startedAt: 0, baseElapsed: session?.elapsed_seconds || 0 });
    setPlaybackUrls({ audio: "", video: "", screen: "" });
  };

  const stopAndReleaseStreams = () => {
    stopAudioVisualizer();
    if (compositeDrawRef.current) {
      cancelAnimationFrame(compositeDrawRef.current);
      compositeDrawRef.current = 0;
    }
    if (compositeStreamRef.current) {
      (compositeStreamRef.current.getTracks?.() || []).forEach((t) => t.stop());
      compositeStreamRef.current = null;
    }
    audioSourceNodesRef.current.forEach((node) => {
      try {
        node.disconnect();
      } catch (_) {}
    });
    audioSourceNodesRef.current = [];
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
      audioDestinationRef.current = null;
    }
    Object.values(streamRefs.current).forEach((stream) => {
      (stream?.getTracks?.() || []).forEach((t) => t.stop());
    });
    streamRefs.current = {};
    if (cameraPreviewRef.current) cameraPreviewRef.current.srcObject = null;
    if (screenPreviewRef.current) screenPreviewRef.current.srcObject = null;
    if (combinedPreviewRef.current) combinedPreviewRef.current.srcObject = null;
    sourceVideoRefs.current = {};
    compositeCanvasRef.current = null;
    setLiveControls({ micMuted: false, cameraOff: false, sharingScreen: false });
  };

  const stopRecordersOnly = async () => {
    const entries = Object.entries(recorderRefs.current);
    if (entries.length === 0) return;
    await Promise.all(entries.map(([, rec]) => new Promise((resolve) => {
      if (!rec || rec.state === "inactive") return resolve();
      rec.onstop = () => resolve();
      try {
        rec.stop();
      } catch (_) {
        resolve();
      }
    })));
  };

  const getMimeForMode = (mode) => (mode === "audio" ? "audio/webm" : "video/webm");

  const isCompositeMode = (modes = []) => modes.includes("video") && modes.includes("screen");

  const bindPreview = (ref, stream) => {
    if (!ref.current) return;
    ref.current.srcObject = stream || null;
    if (stream) ref.current.play?.().catch(() => {});
  };

  const getSourceVideo = (key, stream) => {
    if (!stream) return null;
    let el = sourceVideoRefs.current[key];
    if (!el) {
      el = document.createElement("video");
      el.muted = true;
      el.playsInline = true;
      sourceVideoRefs.current[key] = el;
    }
    if (el.srcObject !== stream) {
      el.srcObject = stream;
      el.play?.().catch(() => {});
    }
    return el;
  };

  const getExtensionFromContentType = (contentType = "") => {
    if (contentType.includes("mp4")) return "mp4";
    if (contentType.includes("ogg")) return "ogg";
    return "webm";
  };

  const resetMultipartStateForMode = (mode) => {
    multipartUploadsRef.current[mode] = createEmptyMultipartState();
    multipartUploadsRef.current[mode].mediaType = mode;
  };

  const enqueueMultipartTask = (mode, task) => {
    const state = multipartUploadsRef.current[mode];
    state.queue = state.queue
      .then(task)
      .catch((err) => {
        state.failed = true;
        const msg = String(err?.message || err);
        if (msg.includes("RECORDING_BUCKET is not configured")) {
          setSessionError("Upload is disabled: backend RECORDING_BUCKET is not configured.");
        } else {
          setSessionError(`Multipart upload failed (${mode}): ${msg}`);
        }
      });
    return state.queue;
  };

  const ensureMultipartInitialized = async (mode, contentType) => {
    const state = multipartUploadsRef.current[mode];
    if (state.initialized) return state;
    if (!API_BASE_URL || !selectedSession?._id) {
      throw new Error("Session not ready for multipart upload");
    }

    const extension = getExtensionFromContentType(contentType || getMimeForMode(mode));
    const res = await fetch(`${API_BASE_URL}/sessions/${selectedSession._id}/multipart/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        media_type: mode,
        content_type: contentType || getMimeForMode(mode),
        extension
      })
    });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`Multipart start failed: ${res.status} ${txt}`);
    }
    const data = await res.json();
    state.initialized = true;
    state.mediaType = mode;
    state.contentType = contentType || getMimeForMode(mode);
    state.extension = extension;
    state.uploadId = data.upload_id || "";
    state.key = data.key || "";
    return state;
  };

  const uploadOneMultipartPart = async (mode, blob) => {
    const state = multipartUploadsRef.current[mode];
    if (!blob || blob.size === 0 || state.failed) return;
    await ensureMultipartInitialized(mode, blob.type || getMimeForMode(mode));
    const partNumber = state.nextPartNumber;

    const presignRes = await fetch(`${API_BASE_URL}/sessions/${selectedSession._id}/multipart/presign-part`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        media_type: mode,
        upload_id: state.uploadId,
        part_number: partNumber
      })
    });
    if (!presignRes.ok) {
      const txt = await presignRes.text();
      throw new Error(`Multipart presign part failed: ${presignRes.status} ${txt}`);
    }
    const presignData = await presignRes.json();
    const putRes = await fetch(presignData.upload_url, { method: "PUT", body: blob });
    if (!putRes.ok) {
      throw new Error(`Multipart part upload failed: ${putRes.status}`);
    }
    const rawEtag = putRes.headers.get("ETag") || "";
    if (!rawEtag) {
      throw new Error("S3 did not expose ETag header. Configure bucket CORS ExposeHeaders to include ETag.");
    }
    const etag = rawEtag;
    state.completedParts.push({ part_number: partNumber, etag });
    state.nextPartNumber += 1;
  };

  const flushMultipartBuffer = (mode, force = false) => enqueueMultipartTask(mode, async () => {
    const state = multipartUploadsRef.current[mode];
    if (state.failed) return;
    if (!force && state.pendingBytes < MULTIPART_MIN_PART_BYTES) return;
    if (state.pendingBytes <= 0 || state.pendingParts.length === 0) return;

    const partBlob = new Blob(state.pendingParts, { type: state.contentType || getMimeForMode(mode) });
    state.pendingParts = [];
    state.pendingBytes = 0;
    await uploadOneMultipartPart(mode, partBlob);
  });

  const handleRecorderChunk = (mode, chunk) => {
    if (!chunk || chunk.size === 0) return;
    const state = multipartUploadsRef.current[mode];
    if (state.failed) return;
    if (!state.contentType) {
      state.contentType = chunk.type || getMimeForMode(mode);
      state.extension = getExtensionFromContentType(state.contentType);
    }
    state.pendingParts.push(chunk);
    state.pendingBytes += chunk.size;
    if (state.pendingBytes >= MULTIPART_MIN_PART_BYTES) {
      flushMultipartBuffer(mode, false);
    }
  };

  const completeMultipartForMode = async (mode) => {
    const state = multipartUploadsRef.current[mode];
    await state.queue;
    await flushMultipartBuffer(mode, true);
    await state.queue;

    if (state.failed || !state.initialized) return;
    if (state.completedParts.length === 0) return;

    const completeRes = await fetch(`${API_BASE_URL}/sessions/${selectedSession._id}/multipart/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        media_type: mode,
        upload_id: state.uploadId,
        parts: state.completedParts
      })
    });
    if (!completeRes.ok) {
      const txt = await completeRes.text();
      throw new Error(`Multipart complete failed: ${completeRes.status} ${txt}`);
    }
  };

  const abortMultipartForMode = async (mode) => {
    const state = multipartUploadsRef.current[mode];
    if (!state.initialized || !state.uploadId) return;
    try {
      await fetch(`${API_BASE_URL}/sessions/${selectedSession._id}/multipart/abort`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          media_type: mode,
          upload_id: state.uploadId
        })
      });
    } catch (_) {}
  };

  const createRecorderForMode = (mode, stream) => {
    if (!stream) return;
    resetMultipartStateForMode(mode);
    const rec = new MediaRecorder(stream, { mimeType: getMimeForMode(mode) });
    rec.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) handleRecorderChunk(mode, e.data);
    };
    recorderRefs.current[mode] = rec;
    rec.start(1000);
  };

  const connectStreamAudioToComposite = (stream) => {
    if (!stream || !audioContextRef.current || !audioDestinationRef.current) return;
    if (!stream.getAudioTracks?.().length) return;
    const node = audioContextRef.current.createMediaStreamSource(stream);
    node.connect(audioDestinationRef.current);
    audioSourceNodesRef.current.push(node);
  };

  const startCompositeRecorder = () => {
    if (compositeStreamRef.current) return;

    const canvas = document.createElement("canvas");
    canvas.width = 1280;
    canvas.height = 720;
    compositeCanvasRef.current = canvas;
    const ctx = canvas.getContext("2d");

    const drawAvatarTile = (x, y, w, h, name) => {
      const initial = (name || "R").charAt(0).toUpperCase();
      const radius = Math.max(28, Math.floor(Math.min(w, h) * 0.18));
      const cx = x + Math.floor(w / 2);
      const cy = y + Math.floor(h / 2) - 16;
      ctx.fillStyle = "#1d4ed8";
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#ffffff";
      ctx.font = `bold ${Math.floor(radius * 0.9)}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(initial, cx, cy + 1);
      ctx.fillStyle = "#dbeafe";
      ctx.font = "600 22px sans-serif";
      ctx.fillText(name || "Recorder", cx, cy + radius + 28);
    };

    const drawFrame = () => {
      const camStream = streamRefs.current.video;
      const scrStream = streamRefs.current.screen;
      const camVideo = getSourceVideo("camera", camStream);
      const scrVideo = getSourceVideo("screen", scrStream);
      const hasScreen = Boolean(scrStream?.getVideoTracks?.().length);
      const camTrack = camStream?.getVideoTracks?.()[0];
      const hasCamera = Boolean(camTrack);
      const hasCameraActive = Boolean(camTrack?.enabled);
      const recorderName = capitalize(selectedSession?.user_id || sessionForm.user_id || "Recorder");

      ctx.fillStyle = "#0b1020";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      if (hasScreen && scrVideo && scrVideo.readyState >= 2) {
        const leftW = Math.floor((canvas.width * 3) / 4);
        const rightW = canvas.width - leftW;
        ctx.drawImage(scrVideo, 0, 0, leftW, canvas.height);
        if (hasCamera && hasCameraActive && camVideo && camVideo.readyState >= 2) {
          const camH = Math.floor(canvas.height / 2);
          const camY = Math.floor((canvas.height - camH) / 2);
          ctx.fillStyle = "#0f1830";
          ctx.fillRect(leftW, 0, rightW, canvas.height);
          ctx.drawImage(camVideo, leftW, camY, rightW, camH);
        } else {
          ctx.fillStyle = "#111a30";
          ctx.fillRect(leftW, 0, rightW, canvas.height);
          drawAvatarTile(leftW, 0, rightW, canvas.height, recorderName);
        }
      } else if (hasCamera && hasCameraActive && camVideo && camVideo.readyState >= 2) {
        ctx.drawImage(camVideo, 0, 0, canvas.width, canvas.height);
      } else if (hasCamera && !hasCameraActive) {
        ctx.fillStyle = "#111a30";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        drawAvatarTile(0, 0, canvas.width, canvas.height, recorderName);
      } else {
        ctx.fillStyle = "#9fb4e6";
        ctx.font = "28px sans-serif";
        ctx.fillText("Waiting for camera/screen...", 36, 70);
      }
      compositeDrawRef.current = requestAnimationFrame(drawFrame);
    };
    drawFrame();

    const composed = canvas.captureStream(24);
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (AudioCtx) {
      audioContextRef.current = new AudioCtx();
      audioDestinationRef.current = audioContextRef.current.createMediaStreamDestination();
      connectStreamAudioToComposite(streamRefs.current.audio);
      connectStreamAudioToComposite(streamRefs.current.screen);
      audioDestinationRef.current.stream.getAudioTracks().forEach((track) => composed.addTrack(track));
    }

    compositeStreamRef.current = composed;
    bindPreview(combinedPreviewRef, composed);
    createRecorderForMode("screen", composed);
  };

  const stopSingleRecorder = async (mode) => {
    const rec = recorderRefs.current[mode];
    if (!rec || rec.state === "inactive") return;
    await new Promise((resolve) => {
      rec.onstop = () => resolve();
      try {
        rec.stop();
      } catch (_) {
        resolve();
      }
    });
  };

  const stopScreenShare = async () => {
    if (!isCompositeMode(selectedSession?.modes || [])) {
      await stopSingleRecorder("screen");
    }
    const screenStream = streamRefs.current.screen;
    (screenStream?.getTracks?.() || []).forEach((t) => t.stop());
    delete streamRefs.current.screen;
    if (!isCompositeMode(selectedSession?.modes || [])) {
      delete recorderRefs.current.screen;
    }
    bindPreview(screenPreviewRef, null);
    setLiveControls((prev) => ({ ...prev, sharingScreen: false }));
  };

  const startScreenShare = async () => {
    if (!selectedSession?.modes?.includes("screen")) return;
    if (streamRefs.current.screen) return;
    const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    streamRefs.current.screen = screenStream;
    if (isCompositeMode(selectedSession?.modes || [])) {
      connectStreamAudioToComposite(screenStream);
    } else {
      createRecorderForMode("screen", screenStream);
    }
    if (selectedSession?.status === "paused" && recorderRefs.current.screen?.state === "recording") {
      recorderRefs.current.screen.pause();
    }
    bindPreview(screenPreviewRef, screenStream);
    const [videoTrack] = screenStream.getVideoTracks();
    if (videoTrack) {
      videoTrack.onended = () => {
        stopScreenShare().catch(() => {});
      };
    }
    setLiveControls((prev) => ({ ...prev, sharingScreen: true }));
  };

  const initRecorders = async (modes) => {
    recorderRefs.current = {};
    multipartUploadsRef.current = {
      audio: createEmptyMultipartState(),
      video: createEmptyMultipartState(),
      screen: createEmptyMultipartState()
    };
    const unique = Array.from(new Set(modes || []));
    const needMic = unique.includes("audio") || unique.includes("video") || unique.includes("screen");
    if (needMic) {
      streamRefs.current.audio = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    }
    if (unique.includes("audio") && streamRefs.current.audio) createRecorderForMode("audio", streamRefs.current.audio);

    if (unique.includes("video")) {
      const videoStream = await navigator.mediaDevices.getUserMedia({ audio: false, video: true });
      streamRefs.current.video = videoStream;
      bindPreview(cameraPreviewRef, videoStream);
      if (!unique.includes("screen")) {
        const videoTracks = videoStream.getVideoTracks?.() || [];
        const micTracks = (streamRefs.current.audio?.getAudioTracks?.() || []);
        const videoRecordStream = new MediaStream([...videoTracks, ...micTracks]);
        createRecorderForMode("video", videoRecordStream);
      }
    } else {
      bindPreview(cameraPreviewRef, null);
    }
    if (isCompositeMode(unique)) {
      startCompositeRecorder();
    }
    if (!unique.includes("screen")) bindPreview(screenPreviewRef, null);
    if (unique.length === 1 && unique.includes("audio")) {
      startAudioVisualizer(streamRefs.current.audio);
    } else {
      stopAudioVisualizer();
    }
    setLiveControls({ micMuted: false, cameraOff: false, sharingScreen: false });
  };

  const pushSessionStatus = async (status) => {
    if (!API_BASE_URL || !selectedSession?._id) return;
    const elapsed = timerState.running
      ? timerState.baseElapsed + Math.floor((Date.now() - timerState.startedAt) / 1000)
      : timerState.baseElapsed;
    try {
      const res = await fetch(`${API_BASE_URL}/sessions/${selectedSession._id}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, elapsed_seconds: elapsed })
      });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`Status update failed: ${res.status} ${txt}`);
      }
      const data = await res.json();
      setSelectedSession(data.session);
      setTimerState({ running: false, startedAt: 0, baseElapsed: data.session?.elapsed_seconds || elapsed });
      await fetchSessions(selectedSession?.user_id || sessionForm.user_id);
    } catch (err) {
      setSessionError(String(err.message || err));
    }
  };

  const startSession = async () => {
    if (!selectedSession || selectedSession.status === "stopped") return;
    setSessionError("");
    if (!selectedSession.subject?.trim() || !selectedSession.topic?.trim() || !selectedSession.notes?.trim()) {
      setSessionError("Subject, topic, and notes are required to start a session.");
      return;
    }
    try {
      await initRecorders(selectedSession.modes || []);
    } catch (err) {
      stopAndReleaseStreams();
      setSessionError(`Recorder permission/device error: ${String(err.message || err)}`);
      return;
    }
    await pushSessionStatus("started");
    setTimerState({ running: true, startedAt: Date.now(), baseElapsed: selectedSession.elapsed_seconds || 0 });
  };

  const pauseSession = async () => {
    if (!selectedSession || !["started", "resumed"].includes(selectedSession.status)) return;
    Object.values(recorderRefs.current).forEach((rec) => {
      if (rec && rec.state === "recording") rec.pause();
    });
    await pushSessionStatus("paused");
  };

  const resumeSession = async () => {
    if (!selectedSession || selectedSession.status !== "paused") return;
    Object.values(recorderRefs.current).forEach((rec) => {
      if (rec && rec.state === "paused") rec.resume();
    });
    await pushSessionStatus("resumed");
    const base = selectedSession.elapsed_seconds || timerState.baseElapsed || 0;
    setTimerState({ running: true, startedAt: Date.now(), baseElapsed: base });
  };

  const stopSession = async () => {
    if (!selectedSession || !["started", "paused", "resumed"].includes(selectedSession.status)) return;
    try {
      Object.values(recorderRefs.current).forEach((rec) => {
        if (rec && rec.state !== "inactive") {
          try {
            rec.requestData();
          } catch (_) {}
        }
      });
      await stopRecordersOnly();
      await Promise.all(SESSION_MEDIA_TYPES.map(async (mode) => {
        try {
          await completeMultipartForMode(mode);
        } catch (err) {
          await abortMultipartForMode(mode);
          throw err;
        }
      }));
      stopAndReleaseStreams();
      recorderRefs.current = {};
      multipartUploadsRef.current = {
        audio: createEmptyMultipartState(),
        video: createEmptyMultipartState(),
        screen: createEmptyMultipartState()
      };
      await pushSessionStatus("stopped");
    } catch (err) {
      setSessionError(String(err.message || err));
    }
  };

  const toggleMute = () => {
    const nextMuted = !liveControls.micMuted;
    ["audio", "video", "screen"].forEach((key) => {
      const stream = streamRefs.current[key];
      (stream?.getAudioTracks?.() || []).forEach((track) => {
        track.enabled = !nextMuted;
      });
    });
    setLiveControls((prev) => ({ ...prev, micMuted: nextMuted }));
  };

  const toggleCamera = () => {
    const camStream = streamRefs.current.video;
    if (!camStream) return;
    const nextCameraOff = !liveControls.cameraOff;
    (camStream.getVideoTracks() || []).forEach((track) => {
      track.enabled = !nextCameraOff;
    });
    setLiveControls((prev) => ({ ...prev, cameraOff: nextCameraOff }));
  };

  const toggleScreenShare = async () => {
    try {
      if (liveControls.sharingScreen) {
        await stopScreenShare();
      } else {
        await startScreenShare();
      }
    } catch (err) {
      setSessionError(`Screen share error: ${String(err.message || err)}`);
    }
  };

  const loadPlayback = async (mediaType) => {
    if (!API_BASE_URL || !selectedSession?._id) return;
    try {
      const res = await fetch(
        `${API_BASE_URL}/sessions/${selectedSession._id}/playback-url?media_type=${encodeURIComponent(mediaType)}`
      );
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`Playback URL failed: ${res.status} ${txt}`);
      }
      const data = await res.json();
      setPlaybackUrls((prev) => ({ ...prev, [mediaType]: data.playback_url || "" }));
    } catch (err) {
      setSessionError(`Playback failed for ${mediaType}: ${String(err.message || err)}`);
    }
  };

  const elapsedDisplay = timerState.running
    ? timerState.baseElapsed + Math.floor((nowTick - timerState.startedAt) / 1000)
    : timerState.baseElapsed;
  const sessionStatus = selectedSession?.status || "created";
  const isClosed = sessionStatus === "stopped";
  const canStart = sessionStatus === "created";
  const canPause = sessionStatus === "started" || sessionStatus === "resumed";
  const canResume = sessionStatus === "paused";
  const canStop = sessionStatus === "started" || sessionStatus === "paused" || sessionStatus === "resumed";
  const selectedModes = selectedSession?.modes || [];
  const hasVideoMode = selectedModes.includes("video");
  const hasScreenMode = selectedModes.includes("screen");
  const hasAudioMode = selectedModes.includes("audio") || hasVideoMode || hasScreenMode;
  const isMeetMerged = hasVideoMode && hasScreenMode;
  const canUseLiveControls = canPause || canResume;
  const recorderLabel = capitalize(selectedSession?.user_id || sessionForm.user_id || "Recorder");
  const recorderInitial = recorderLabel.charAt(0) || "R";
  const uploadedMedia = SESSION_MEDIA_TYPES.filter((m) => Boolean((selectedSession?.uploads?.[m] || {}).key));
  const statusPriority = { started: 0, resumed: 0, paused: 1, created: 2, stopped: 3 };
  const orderedSessionList = [...sessionList].sort((a, b) => {
    if (selectedSession?._id && a._id === selectedSession._id) return -1;
    if (selectedSession?._id && b._id === selectedSession._id) return 1;
    const aRank = statusPriority[a.status] ?? 9;
    const bRank = statusPriority[b.status] ?? 9;
    if (aRank !== bRank) return aRank - bRank;
    const aAt = Date.parse(a.updated_at || a.created_at || 0) || 0;
    const bAt = Date.parse(b.updated_at || b.created_at || 0) || 0;
    return bAt - aAt;
  });

  return (
    <main className="app-shell">
      <div className="bg-orb orb-1" />
      <div className="bg-orb orb-2" />
      <header className="hero">
        <div className="top-nav-links">
          <Link href="/" className="top-nav-link">Home</Link>
          <Link href="/recorder" className="top-nav-link active">Recorder</Link>
        </div>
        <p className="badge">Live Recorder</p>
        <h1>Session Recorder</h1>
        <p className="subtext">Create, run, and upload study recording sessions.</p>
      </header>

      <section className="milestone-panel session-panel">
        {!API_BASE_URL ? (
          <p className="api-state warn">Backend URL needed for session recorder APIs.</p>
        ) : (
          <>
            <div className="session-form-grid">
              <select className="task-select" value={sessionForm.user_id} onChange={(e) => setSessionForm((p) => ({ ...p, user_id: e.target.value }))}>
                <option value="kapil">Kapil</option>
                <option value="divya">Divya</option>
              </select>
              <input className="task-select" placeholder="Subject" value={sessionForm.subject} onChange={(e) => setSessionForm((p) => ({ ...p, subject: e.target.value }))} />
              <input className="task-select" placeholder="Topic" value={sessionForm.topic} onChange={(e) => setSessionForm((p) => ({ ...p, topic: e.target.value }))} />
              <select className="task-select" value={sessionForm.session_type} onChange={(e) => setSessionForm((p) => ({ ...p, session_type: e.target.value }))}>
                <option value="study">Study</option>
                <option value="revision">Revision</option>
              </select>
            </div>
            <div className="mode-row">
              {SESSION_MEDIA_TYPES.map((m) => (
                <label key={m} className="mode-chip">
                  <input
                    type="checkbox"
                    checked={sessionForm.modes.includes(m)}
                    onChange={(e) => {
                      setSessionForm((p) => ({
                        ...p,
                        modes: e.target.checked ? [...p.modes, m] : p.modes.filter((x) => x !== m)
                      }));
                    }}
                  />
                  {m}
                </label>
              ))}
            </div>
            <textarea className="task-textarea" placeholder="Notes" value={sessionForm.notes} onChange={(e) => setSessionForm((p) => ({ ...p, notes: e.target.value }))} />
            <div className="task-modal-actions">
              <button className="btn-day" onClick={createSession}>Create Session</button>
              <button className="btn-day secondary" onClick={() => fetchSessions(sessionForm.user_id)}>Load Sessions</button>
            </div>
            {sessionError ? <p className="api-state error">{sessionError}</p> : null}
            {sessionLoading ? <p className="day-state">Loading sessions...</p> : null}

            {selectedSession ? (
              <div className="session-detail">
                <h3>Selected Session</h3>
                <p>
                  {(selectedSession.user_id || "user").toUpperCase()} | {selectedSession.subject} | {selectedSession.topic} | {selectedSession.date}
                  {" | Start: "}
                  {selectedSession.start_time ? formatTime(selectedSession.start_time) : "Auto on Start"}
                </p>
                <p>Status: {selectedSession.status} | Elapsed: {formatDuration(elapsedDisplay)}</p>
                <p>Total Minutes: {selectedSession.total_time_minutes || 0}</p>
                {selectedModes.length === 0 ? (
                  <div className="timer-only-display">
                    <span className="timer-only-label">Study Timer</span>
                    <strong className="timer-only-time">{formatDuration(elapsedDisplay)}</strong>
                  </div>
                ) : null}
                {isClosed ? (
                  <p className="day-state">This session is closed. Create a new session to record again.</p>
                ) : (
                  <div className="task-modal-actions">
                    {canStart ? <button className="btn-day" onClick={startSession}>Start</button> : null}
                    {canPause ? <button className="btn-day secondary" onClick={pauseSession}>Pause</button> : null}
                    {canResume ? <button className="btn-day" onClick={resumeSession}>Resume</button> : null}
                    {canStop ? <button className="btn-ticket" onClick={stopSession}>Stop</button> : null}
                  </div>
                )}
                {!isClosed && (hasVideoMode || hasScreenMode) ? (
                  hasVideoMode && hasScreenMode ? (
                    <div className="preview-grid">
                      <div className="preview-card">
                        <h4>Meet Layout Preview (Screen 3:1 Video)</h4>
                        <video ref={combinedPreviewRef} className="live-preview" muted autoPlay playsInline />
                        {!canUseLiveControls ? <p className="day-state">Preview starts after you click Start.</p> : null}
                      </div>
                    </div>
                  ) : (
                    <div className="preview-grid">
                      {hasVideoMode ? (
                        <div className="preview-card">
                          <h4>Camera Preview</h4>
                          <div className="preview-frame">
                            <video ref={cameraPreviewRef} className="live-preview" muted autoPlay playsInline />
                            {liveControls.cameraOff ? (
                              <div className="camera-off-placeholder">
                                <div className="camera-off-avatar">{recorderInitial}</div>
                                <p className="camera-off-name">{recorderLabel}</p>
                              </div>
                            ) : null}
                          </div>
                          {!canUseLiveControls ? <p className="day-state">Preview starts after you click Start.</p> : null}
                        </div>
                      ) : null}
                      {hasScreenMode ? (
                        <div className="preview-card">
                          <h4>Screen Preview</h4>
                          <video ref={screenPreviewRef} className="live-preview" muted autoPlay playsInline />
                          {!canUseLiveControls ? <p className="day-state">Preview starts after you click Start.</p> : null}
                        </div>
                      ) : null}
                    </div>
                  )
                ) : null}
                {!isClosed && hasAudioMode && !hasVideoMode && !hasScreenMode ? (
                  <div className="preview-grid">
                    <div className="preview-card">
                      <h4>Audio Preview</h4>
                      <canvas ref={audioVizCanvasRef} className="audio-visualizer" width={760} height={180} />
                      {!canUseLiveControls ? <p className="day-state">Preview starts after you click Start.</p> : null}
                    </div>
                  </div>
                ) : null}
                {canUseLiveControls ? (
                  <div className="icon-controls-row">
                    {hasAudioMode ? (
                      <button
                        className={`icon-toggle-btn ${liveControls.micMuted ? "inactive" : "active"}`}
                        onClick={toggleMute}
                        title={liveControls.micMuted ? "Unmute" : "Mute"}
                        aria-label={liveControls.micMuted ? "Unmute" : "Mute"}
                      >
                        <span className="icon-symbol" aria-hidden="true">🎤</span>
                        {liveControls.micMuted ? <span className="icon-cross" aria-hidden="true">✕</span> : null}
                      </button>
                    ) : null}
                    {hasVideoMode ? (
                      <button
                        className={`icon-toggle-btn ${liveControls.cameraOff ? "inactive" : "active"}`}
                        onClick={toggleCamera}
                        title={liveControls.cameraOff ? "Start Video" : "Stop Video"}
                        aria-label={liveControls.cameraOff ? "Start Video" : "Stop Video"}
                      >
                        <span className="icon-symbol" aria-hidden="true">📹</span>
                        {liveControls.cameraOff ? <span className="icon-cross" aria-hidden="true">✕</span> : null}
                      </button>
                    ) : null}
                    {hasScreenMode ? (
                      <button
                        className={`icon-toggle-btn ${liveControls.sharingScreen ? "active" : "inactive"}`}
                        onClick={toggleScreenShare}
                        title={liveControls.sharingScreen ? "Stop Screen Share" : "Share Screen"}
                        aria-label={liveControls.sharingScreen ? "Stop Screen Share" : "Share Screen"}
                      >
                        <span className="icon-symbol" aria-hidden="true">🖥️</span>
                        {!liveControls.sharingScreen ? <span className="icon-cross" aria-hidden="true">✕</span> : null}
                      </button>
                    ) : null}
                  </div>
                ) : null}
                {uploadedMedia.length > 0 ? (
                  <div className="recording-players">
                    <h4>Session Recordings</h4>
                    <div className="recording-player-list">
                      {uploadedMedia.map((m) => (
                        <div className="recording-player-item" key={m}>
                          <div className="recording-player-head">
                            <strong>{m.toUpperCase()}</strong>
                            {!playbackUrls[m] ? (
                              <button className="btn-day secondary" onClick={() => loadPlayback(m)}>
                                Load
                              </button>
                            ) : null}
                          </div>
                          {playbackUrls[m] ? (
                            m === "audio" ? (
                              <audio className="session-player" controls src={playbackUrls[m]} />
                            ) : (
                              <video className="session-player" controls src={playbackUrls[m]} />
                            )
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="session-list">
              {orderedSessionList.map((session) => (
                <button
                  key={session._id}
                  className={`session-item ${selectedSession?._id === session._id ? "active" : ""} ${["started", "resumed", "paused"].includes(session.status) ? "running" : ""}`}
                  onClick={() => selectSession(session)}
                >
                  <strong>{session.subject}</strong> - {session.topic} ({session.session_type}) [{session.user_id || "user"} | {session.date}]
                </button>
              ))}
            </div>
          </>
        )}
      </section>
    </main>
  );
}
