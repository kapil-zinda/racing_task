"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import MainMenu from "../components/MainMenu";
import Icon from "../components/Icon";
import ExplainerCanvas from "./ExplainerCanvas";
import { confirmDialog } from "../lib/dialog";
import { AGENT_PENDING_RECORDER_ACTION_KEY, AGENT_RECORDER_EVENT, AGENT_RECORDER_STATUS_EVENT } from "../lib/agent/constants";
import { apiFetch, useAuth } from "../lib/auth";


const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "";
const NOTICE_TTL_MS = 15000;
const MULTIPART_PART_UPLOAD_RETRIES = 2;
// Network-loss handling while recording.
const OFFLINE_BUFFER_CAP_BYTES = 5 * 1024 * 1024; // accumulate up to ~5 MB, then pause capture
const OFFLINE_MAX_MS = 2 * 60 * 1000;             // give up & stop after 2 min offline
const OFFLINE_RETRY_INTERVAL_MS = 5000;           // re-attempt uploads every 5s while offline
const HEARTBEAT_INTERVAL_MS = 90 * 1000;          // tell the backend we're alive
// One chunk = one presigned PUT, so a longer interval means far fewer presign
// requests and less main-thread churn (smoother video), at the cost of a slightly
// larger "last few seconds" loss window if the tab dies.
const RECORDER_FLUSH_INTERVAL_MS = 5000;
const MULTIPART_FILE_PART_BYTES = 6 * 1024 * 1024;
const SESSION_MEDIA_TYPES = ["audio", "video", "screen", "attachment"];

const RECORDER_TYPES = [
  { value: "time", label: "Time recording" },
  { value: "audio", label: "Audio recording" },
  { value: "video", label: "Video recording" },
  { value: "screen", label: "Screen recording" },
  { value: "call", label: "Call recording" },
  { value: "pdf_explainer", label: "PDF Explainer" },
  { value: "uploader", label: "Uploader recording" }
];
const OTHER_VALUE = "__other__";
const SIMP_RECORD_VALUE = "simp_record";
const getSubjectsForExam = (examType, catalog = {}) => (catalog[examType] || []).map((entry) => entry.subject);

const getTopicsForSelection = (examType, subject, catalog = {}) => {
  const found = (catalog[examType] || []).find((entry) => entry.subject === subject);
  return found?.topics || [];
};
const getExamOptionsFromCatalog = (catalog = {}) =>
  Object.keys(catalog || {}).map((key) => ({ value: key, label: key.replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase()) }));
const MULTIPART_MIN_PART_BYTES = 5 * 1024 * 1024;

function buildTestsCatalogFromPlan(testPlanRows) {
  const bySource = new Map();
  (Array.isArray(testPlanRows) ? testPlanRows : []).forEach((row) => {
    const source = String(row?.source || "").trim();
    if (!source) return;
    const testName = String(row?.test_name || "").trim() || "Test";
    const count = Math.max(1, Number(row?.number_of_tests || 1));
    if (!bySource.has(source)) bySource.set(source, []);
    const list = bySource.get(source);
    for (let i = 1; i <= count; i += 1) {
      list.push(`${testName} ${i}`);
    }
  });
  const out = [];
  [...bySource.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .forEach(([source, topics]) => {
      out.push({ subject: source, topics: [...new Set(topics)] });
    });
  return out;
}


function formatDuration(totalSeconds) {
  const sec = Math.max(0, Number(totalSeconds) || 0);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return [h, m, s].map((v) => String(v).padStart(2, "0")).join(":");
}

function getSessionDurationSeconds(session) {
  const elapsed = Number(session?.elapsed_seconds || 0);
  if (elapsed > 0) return elapsed;
  const mins = Number(session?.total_time_minutes || 0);
  return mins > 0 ? mins * 60 : 0;
}

function isSessionFinalizing(session) {
  const uploads = session?.uploads || {};
  return SESSION_MEDIA_TYPES.some((m) => uploads?.[m]?.status === "processing");
}

function fmtSecs(s) {
  const t = Math.floor(s || 0);
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
}

function capitalize(value) {
  if (!value) return "";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function getRecorderType(session) {
  if (session?.recorder_type) return session.recorder_type;
  const modes = session?.modes || [];
  if (modes.includes("video") && modes.includes("screen")) return "call";
  if (modes.includes("video")) return "video";
  if (modes.includes("screen")) return "screen";
  if (modes.includes("audio")) return "audio";
  return "time";
}

function getAttachmentKindFromKey(key = "") {
  const lower = key.toLowerCase();
  if (lower.endsWith(".pdf")) return "pdf";
  if (/\.(png|jpg|jpeg|webp|gif|bmp|svg)$/.test(lower)) return "image";
  return "other";
}

function getAttachmentKindFromName(name = "") {
  const lower = name.toLowerCase();
  if (lower.endsWith(".pdf")) return "pdf";
  if (/\.(png|jpg|jpeg|webp|gif|bmp|svg)$/.test(lower)) return "image";
  return "other";
}

function createEmptyMultipartState() {
  return {
    // Live recording uploads each MediaRecorder chunk immediately as its own S3
    // object (durable within ~1.5s), then a backend concat stitches them into the
    // final file on stop. No client-side 5 MB buffering, no silent data loss.
    contentType: "",
    extension: "webm",
    seq: 0,            // next chunk sequence number (0-based, recording order)
    uploadedChunks: 0,
    failedChunks: 0,
    hasChunks: false,
    queue: Promise.resolve(),
    failed: false
  };
}

function resolveSessionId(session) {
  return String(session?._id || session?.id || session?.session_id || "").trim();
}

function normalizeSessionDoc(session) {
  if (!session || typeof session !== "object") return null;
  const sid = resolveSessionId(session);
  return {
    ...session,
    _id: sid,
  };
}

function broadcastRecorderStatus(status) {
  if (typeof window === "undefined") return;
  const value = String(status || "").trim().toLowerCase();
  const payload = { status: value, at: Date.now() };
  try {
    window.sessionStorage.setItem("agent_v2_recorder_status", JSON.stringify(payload));
  } catch (_) {}
  window.dispatchEvent(new CustomEvent(AGENT_RECORDER_STATUS_EVENT, { detail: payload }));
}

export default function RecorderPage() {
  const { auth } = useAuth();
  const defaultSubject = "";
  const defaultTopic = "";
  const [missionSelector, setMissionSelector] = useState({ exam_options: [], catalog: {}, plan: {} });
  const [missionSelectorLoading, setMissionSelectorLoading] = useState(Boolean(API_BASE_URL));
  const missionTestPlan = useMemo(
    () => (Array.isArray(missionSelector?.plan?.tests) ? missionSelector.plan.tests : []),
    [missionSelector?.plan?.tests],
  );
  const activeCatalog = useMemo(() => {
    const base = Object.keys(missionSelector.catalog || {}).length ? missionSelector.catalog : {};
    const testsCatalog = buildTestsCatalogFromPlan(missionTestPlan);
    if (!testsCatalog.length) return base;
    return { ...base, tests: testsCatalog };
  }, [missionSelector.catalog, missionTestPlan]);
  const activeExamOptions = useMemo(
    () => (
      (() => {
        const fromMission = Array.isArray(missionSelector.exam_options) ? [...missionSelector.exam_options] : [];
        const hasTests = fromMission.some((opt) => String(opt?.value || "") === "tests");
        const testsAvailable = Array.isArray(activeCatalog.tests) && activeCatalog.tests.length > 0;
        if (fromMission.length) {
          if (testsAvailable && !hasTests) {
            fromMission.push({ value: "tests", label: "Tests" });
          }
          return fromMission;
        }
        return getExamOptionsFromCatalog(activeCatalog);
      })()
    ),
    [missionSelector.exam_options, activeCatalog],
  );
  const [sessionForm, setSessionForm] = useState({
    exam_type: SIMP_RECORD_VALUE,
    subject: defaultSubject,
    topic: defaultTopic,
    exam_type_other: "",
    subject_other: "",
    topic_other: "",
    session_type: "study",
    recorder_type: "call",
    notes: "",
  });
  const [sessionList, setSessionList] = useState([]);
  const [listScope, setListScope] = useState("all"); // "all" | "today" | "simple"
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [recordView, setRecordView] = useState("full"); // "full" | "float"
  const [recorderArming, setRecorderArming] = useState(false); // overlay mounted before streams bind
  const [stopping, setStopping] = useState(false); // finalizing upload after Stop pressed
  const stoppingRef = useRef(false); // synchronous guard against double-Stop
  // Per-mode live upload health so the user always knows recording is being saved:
  // mode -> "saving" | "saved" | "error".
  const [uploadHealth, setUploadHealth] = useState({});
  const markUpload = (mode, status) => setUploadHealth((prev) => ({ ...prev, [mode]: status }));
  // Network-loss state: while uploads are failing we buffer chunks, show a blocking
  // overlay, and stop after OFFLINE_MAX_MS if it never recovers.
  const [uploadOffline, setUploadOffline] = useState(false);
  const [offlineStopped, setOfflineStopped] = useState(false); // popup after auto-stop
  const offlineRef = useRef(false);
  const offlineSinceRef = useRef(0);
  const offlineBufferRef = useRef([]); // [{ mode, seq, blob }]
  const offlineBytesRef = useRef(0);
  const offlineTimerRef = useRef(0);
  const offlineTickBusyRef = useRef(false);
  const offlinePausedRef = useRef(false); // recorders paused to bound the buffer
  const [floatPos, setFloatPos] = useState(null); // {x, y} when dragged
  const [playerModal, setPlayerModal] = useState({ open: false, mediaType: "", url: "", title: "", loading: false, streaming: false });
  const [playerRate, setPlayerRate] = useState(1);
  const [playerPlaying, setPlayerPlaying] = useState(false);
  const [playerCurrentTime, setPlayerCurrentTime] = useState(0);
  const [playerDuration, setPlayerDuration] = useState(0);
  const [playerVolume, setPlayerVolume] = useState(1);
  const playerMediaRef = useRef(null);
  const playerWrapRef = useRef(null);
  const playerMediaSourceRef = useRef(null);
  const playerStreamAbortRef = useRef(null);
  const [sessionLoading, setSessionLoading] = useState(false);
  const [sessionError, setSessionError] = useState("");
  const [deletingSessionIds, setDeletingSessionIds] = useState({});
  const [openSessionMenuId, setOpenSessionMenuId] = useState("");
  const [pendingFinalizeModes, setPendingFinalizeModes] = useState([]);
  const [finalizeRetrying, setFinalizeRetrying] = useState(false);
  const [selectedSession, setSelectedSession] = useState(null);
  const [timerState, setTimerState] = useState({ running: false, startedAt: 0, baseElapsed: 0 });
  // Mirror timerState in a ref so status pushes read the live value synchronously
  // — React state is still stale within the same handler (e.g. create-and-start a
  // second session right after stopping the first would otherwise post the first
  // session's elapsed time).
  const timerStateRef = useRef({ running: false, startedAt: 0, baseElapsed: 0 });
  const commitTimerState = (next) => {
    timerStateRef.current = next;
    setTimerState(next);
  };
  const [nowTick, setNowTick] = useState(Date.now());
  const [playbackUrls, setPlaybackUrls] = useState({ audio: "", video: "", screen: "", attachment: "" });
  const [explainerModalOpen, setExplainerModalOpen] = useState(false);
  const [uploadFiles, setUploadFiles] = useState({ uploader: null, explainerAttachment: null, explainerAudio: null });
  const [explainerDoneLoading, setExplainerDoneLoading] = useState(false);
  const [explainerFiles, setExplainerFiles] = useState([]);
  const [explainerFileIdx, setExplainerFileIdx] = useState(0);
  const [explainerZoom, setExplainerZoom] = useState(1);
  const [explainerVideoBlob, setExplainerVideoBlob] = useState(null);
  const [explainerFrameOpen, setExplainerFrameOpen] = useState(false);
  const [explainerRecording, setExplainerRecording] = useState(false);
  const explainerCanvasRef = useRef(null);
  const explainerFileInputRef = useRef(null);
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
    screen: createEmptyMultipartState(),
    attachment: createEmptyMultipartState()
  });
  const recordingBoxRef = useRef(null);
  // Always holds the active session, so multipart-upload callbacks created during
  // initRecorders never read a stale `selectedSession` (e.g. on create-and-start).
  const selectedSessionRef = useRef(null);
  // The session currently being recorded. Set once at start and untouched by UI
  // selection / list refreshes, so recorder chunks always upload to the right
  // session even if selectedSession briefly changes underneath.
  const recordingSessionIdRef = useRef("");
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
  const recorderFlushTimersRef = useRef({});

  useEffect(() => {
    if (!timerState.running) return;
    const id = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, [timerState.running]);

  // While any session is still being concatenated server-side, refresh the list
  // so its "Finalizing…" flips to playable once the final file is ready.
  useEffect(() => {
    if (!sessionList.some((s) => isSessionFinalizing(s))) return undefined;
    const id = setInterval(() => { fetchSessions(); }, 4000);
    return () => clearInterval(id);
  }, [sessionList]);

  // Heartbeat: tell the backend this device is still recording, so its reaper
  // doesn't treat the session as abandoned. The backend auto-finalizes a session
  // with no heartbeat for ~5 min (closed tab / crash / lost connection).
  useEffect(() => {
    const active = ["started", "resumed"].includes(selectedSession?.status);
    const sid = selectedSession?._id;
    if (!API_BASE_URL || !active || !sid) return undefined;
    const beat = () => { apiFetch(`${API_BASE_URL}/sessions/${sid}/heartbeat`, { method: "POST" }).catch(() => {}); };
    beat();
    const id = setInterval(beat, HEARTBEAT_INTERVAL_MS);
    return () => clearInterval(id);
  }, [selectedSession?.status, selectedSession?._id]);

  useEffect(() => {
    if (!sessionError) return;
    const id = setTimeout(() => setSessionError(""), NOTICE_TTL_MS);
    return () => clearTimeout(id);
  }, [sessionError]);

  useEffect(() => {
    if (!selectedSession?.status) return;
    broadcastRecorderStatus(selectedSession.status);
  }, [selectedSession?.status]);

  useEffect(() => {
    if (!openSessionMenuId || typeof document === "undefined") return undefined;
    const onDocClick = () => setOpenSessionMenuId("");
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, [openSessionMenuId]);

  useEffect(() => {
    if (!API_BASE_URL) return;
    apiFetch(`${API_BASE_URL}/mission/options`)
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(data => {
        setMissionSelector({ exam_options: data.exam_options || [], catalog: data.catalog || {}, plan: data.plan || {} });
      })
      .catch(() => {});
    fetchSessions();
  }, [API_BASE_URL]);

  useEffect(() => {
    if (!activeExamOptions.length) return;
    const validExamValues = new Set(activeExamOptions.map((o) => o.value));
    setSessionForm((prev) => {
      if (prev.exam_type === SIMP_RECORD_VALUE) return prev;
      const nextExam = validExamValues.has(prev.exam_type) ? prev.exam_type : activeExamOptions[0].value;
      const subjects = getSubjectsForExam(nextExam, activeCatalog);
      const nextSubject = subjects.includes(prev.subject) ? prev.subject : (subjects[0] || OTHER_VALUE);
      const topics = nextSubject === OTHER_VALUE ? [] : getTopicsForSelection(nextExam, nextSubject, activeCatalog);
      const nextTopic = topics.includes(prev.topic) ? prev.topic : (topics[0] || OTHER_VALUE);
      if (nextExam === prev.exam_type && nextSubject === prev.subject && nextTopic === prev.topic) {
        return prev;
      }
      return { ...prev, exam_type: nextExam, subject: nextSubject, topic: nextTopic };
    });
  }, [activeExamOptions, activeCatalog]);

  useEffect(() => {
    const hasPending = pendingFinalizeModes.length > 0;
    if (!hasPending) return;
    const currentStatus = selectedSession?.status || "created";
    const hasActiveSession = ["started", "resumed", "paused"].includes(currentStatus);
    const hasPendingFinalize = pendingFinalizeModes.length > 0;
    if (!hasActiveSession && !hasPendingFinalize) return;
    const onBeforeUnload = (e) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [pendingFinalizeModes, selectedSession?.status]);

  useEffect(() => {
    const onDocClick = (e) => {
      const currentStatus = selectedSession?.status || "created";
      const hasActiveSession = ["started", "resumed", "paused"].includes(currentStatus);
      const hasPendingFinalize = pendingFinalizeModes.length > 0;
      if (!hasActiveSession && !hasPendingFinalize) return;

      const anchor = e.target?.closest?.("a[href]");
      if (!anchor) return;

      const href = anchor.getAttribute("href") || "";
      if (!href || href.startsWith("#")) return;

      let targetUrl;
      try {
        targetUrl = new URL(href, window.location.href);
      } catch (_) {
        return;
      }
      if (targetUrl.origin !== window.location.origin) return;
      if (targetUrl.pathname === "/recorder") return;

      e.preventDefault();
      e.stopPropagation();
      window.open(targetUrl.toString(), "_blank", "noopener,noreferrer");
      setSessionError("Opened in a new tab so recording continues here.");
    };

    document.addEventListener("click", onDocClick, true);
    return () => document.removeEventListener("click", onDocClick, true);
  }, [selectedSession?.status, pendingFinalizeModes]);

  useEffect(() => () => {
    stopAndReleaseStreams();
  }, []);

  useEffect(() => {
    const onVisibilityChange = () => {
      if (!document.hidden && audioContextRef.current?.state === "suspended") {
        audioContextRef.current.resume().catch(() => {});
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, []);




  useEffect(() => {
    selectedSessionRef.current = selectedSession;
  }, [selectedSession]);

  useEffect(() => {
    bindPreview(cameraPreviewRef, streamRefs.current.video || null);
    bindPreview(screenPreviewRef, streamRefs.current.screen || null);
    bindPreview(combinedPreviewRef, compositeStreamRef.current || null);
  }, [selectedSession?.status, selectedSession?._id, timerState.running, liveControls.sharingScreen, liveControls.cameraOff]);

  // The live preview/visualizer now live inside the recording overlay, which mounts only
  // once recording is active and remounts its nodes when toggling fullscreen/float — so
  // rebind streams and restart the audio visualizer whenever that happens.
  useEffect(() => {
    const active = ["started", "paused", "resumed"].includes(selectedSession?.status);
    if (!active) return;
    bindPreview(cameraPreviewRef, streamRefs.current.video || null);
    bindPreview(screenPreviewRef, streamRefs.current.screen || null);
    bindPreview(combinedPreviewRef, compositeStreamRef.current || null);
    const modes = selectedSession?.modes || [];
    const audioOnly = modes.includes("audio") && !modes.includes("video") && !modes.includes("screen");
    if (audioOnly && streamRefs.current.audio && audioVizCanvasRef.current) {
      startAudioVisualizer(streamRefs.current.audio);
    }
  }, [selectedSession?.status, selectedSession?._id, recordView]);

  useEffect(() => {
    if (!selectedSession?._id) return;
    if (getRecorderType(selectedSession) !== "pdf_explainer") return;
    const hasAttachment = Boolean(selectedSession?.uploads?.attachment?.key);
    const hasAudio = Boolean(selectedSession?.uploads?.audio?.key);
    if (hasAttachment && !playbackUrls.attachment) {
      loadPlayback("attachment");
    }
    if (hasAudio && !playbackUrls.audio) {
      loadPlayback("audio");
    }
  }, [selectedSession?._id, selectedSession?.uploads?.attachment?.key, selectedSession?.uploads?.audio?.key]);

  // Drive MSE streaming once the player has a URL for a streamable recording.
  useEffect(() => {
    if (!playerModal.open || !playerModal.streaming || !playerModal.url) return undefined;
    const el = playerMediaRef.current;
    if (!el) return undefined;
    const started = attachMseStream(el, playerModal.url);
    if (!started) {
      el.src = playerModal.url;
      el.play?.().catch(() => {});
    }
    return () => {
      teardownPlayerStream();
    };
  }, [playerModal.open, playerModal.streaming, playerModal.url]);

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

  const buildSessionSubjectTopic = () => {
    if (sessionForm.exam_type === SIMP_RECORD_VALUE) {
      // Simple Record mode: only record_type + record_note are filled, so
      // auto-fill subject/topic (backend requires them) from the note.
      const note = (sessionForm.notes || "").trim();
      return { subject: "Simple Record", topic: note ? note.slice(0, 60) : "Quick Record" };
    }
    const subject = (selectedSubjectValue || "").trim();
    const topic = (selectedTopicValue || "").trim();
    return { subject, topic };
  };

  const buildSessionTestRef = () => {
    if (effectiveExamType !== "tests") return { test_source: "", test_name: "", test_number: "" };
    const source = (selectedSubjectValue || "").trim();
    const topic = (selectedTopicValue || "").trim();
    if (!source || !topic) return { test_source: "", test_name: "", test_number: "" };

    const match = topic.match(/^(.*?)(?:\s+(\d+))?$/);
    const maybeName = (match?.[1] || topic).trim();
    const maybeNumber = (match?.[2] || "").trim();
    return {
      test_source: source,
      test_name: maybeName || topic,
      test_number: maybeNumber,
    };
  };

  const fetchSessions = async (scopeValue = listScope) => {
    if (!API_BASE_URL) return [];
    setSessionLoading(true);
    setSessionError("");
    try {
      const scopeQuery = scopeValue === "simple" ? "?scope=simple" : scopeValue === "today" ? "" : "?scope=all";
      const res = await apiFetch(`${API_BASE_URL}/sessions${scopeQuery}`);
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`Sessions API failed: ${res.status} ${txt}`);
      }
      const data = await res.json();
      const sessions = (Array.isArray(data.sessions) ? data.sessions : [])
        .map((row) => normalizeSessionDoc(row))
        .filter((row) => Boolean(row?._id));
      setSessionList(sessions);
      // Reconcile against the LATEST selected session, not the stale closure
      // value — otherwise a fetchSessions() fired right after switching sessions
      // would revert selectedSession (and the recording ref) to the old one.
      setSelectedSession((prev) => {
        if (!prev) return prev;
        const refreshed = sessions.find((s) => s._id === resolveSessionId(prev));
        return refreshed || prev;
      });
      return sessions;
    } catch (err) {
      setSessionError(String(err.message || err));
      return [];
    } finally {
      setSessionLoading(false);
    }
  };

  const createSession = async () => {
    if (!API_BASE_URL) return null;
    if (sessionForm.recorder_type === "pdf_explainer") {
      setSessionError("For PDF Explainer, use the Done button after selecting PDF/image and audio.");
      return null;
    }
    setSessionError("");
    const { subject, topic } = buildSessionSubjectTopic();
    const notes = sessionForm.notes.trim();
    if (!subject || !topic) {
      setSessionError("Subject and topic are required.");
      return null;
    }
    try {
      const testRef = buildSessionTestRef();
      const payload = {
        subject,
        topic,
        session_type: sessionForm.session_type,
        recorder_type: sessionForm.recorder_type,
        notes,
        simple_record: sessionForm.exam_type === SIMP_RECORD_VALUE,
        ...testRef,
      };
      const res = await apiFetch(`${API_BASE_URL}/sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`Create session failed: ${res.status} ${txt}`);
      }
      const data = await res.json();
      const normalized = normalizeSessionDoc(data.session);
      if (!normalized?._id) {
        throw new Error("Create session failed: session id missing in response");
      }
      setSelectedSession(normalized);
      setPendingFinalizeModes([]);
      commitTimerState({ running: false, startedAt: 0, baseElapsed: normalized?.elapsed_seconds || 0 });
      setPlaybackUrls({ audio: "", video: "", screen: "", attachment: "" });
      await fetchSessions();
      return normalized;
    } catch (err) {
      setSessionError(String(err.message || err));
      return null;
    }
  };

  // Create a live session and immediately begin recording (no idle "created" entry).
  const createAndStart = async () => {
    // Preflight BEFORE creating, so declining doesn't leave a rough "created" entry.
    // fetchSessions also reaps stale ones, so only genuinely-active recordings remain.
    let forceStart = false;
    const sessions = await fetchSessions();
    const activeElsewhere = (sessions || []).find((s) =>
      ["started", "resumed", "paused"].includes(s?.status)
    );
    if (activeElsewhere) {
      const ok = await confirmDialog({
        title: "Recording in progress",
        message: "A recording is already going on another device. Stop it and start a new recording here?",
        confirmLabel: "Stop & start here",
      });
      if (!ok) {
        setSessionError("Recording not started — the other device's recording is still running.");
        return;
      }
      forceStart = true;
    }
    const created = await createSession();
    if (!created?._id) return;
    setCreateModalOpen(false);
    setRecordView("full");
    setFloatPos(null);
    await startSession(created, { forceStart });
  };

  const openExplainerFrame = () => {
    const { subject, topic } = buildSessionSubjectTopic();
    if (!subject || !topic) {
      setSessionError("Subject and topic are required.");
      return;
    }
    setCreateModalOpen(false);
    setExplainerFrameOpen(true);
  };

  // Uploader flow: create the session and upload the chosen file in one step.
  const createAndUpload = async () => {
    const file = uploadFiles.uploader;
    if (!file) {
      setSessionError("Select an audio/video file to upload first.");
      return;
    }
    const created = await createSession();
    if (!created?._id) return;
    try {
      const mediaType = (file.type || "").startsWith("audio/") ? "audio" : "video";
      await uploadMediaForSession(created._id, mediaType, file, file.name);
      setUploadFiles((prev) => ({ ...prev, uploader: null }));
      await fetchSessions();
      setCreateModalOpen(false);
    } catch (err) {
      setSessionError(String(err.message || err));
    }
  };

  const enterPip = async () => {
    let videoEl = null;
    if (hasVideoMode && hasScreenMode) videoEl = combinedPreviewRef.current;
    else if (hasVideoMode) videoEl = cameraPreviewRef.current;
    else if (hasScreenMode) videoEl = screenPreviewRef.current;
    if (!videoEl) {
      setSessionError("Picture-in-Picture is available for video/screen/call recordings.");
      return;
    }
    try {
      if (typeof document !== "undefined" && document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else {
        await videoEl.requestPictureInPicture();
      }
    } catch (err) {
      setSessionError(`Picture-in-Picture failed: ${String(err.message || err)}`);
    }
  };

  // Drag the floating recorder window (pointer capture keeps it smooth across the page).
  const onFloatPointerDown = (e) => {
    if (recordView !== "float") return;
    const box = recordingBoxRef.current;
    if (!box) return;
    const rect = box.getBoundingClientRect();
    const offX = e.clientX - rect.left;
    const offY = e.clientY - rect.top;
    const onMove = (ev) => {
      const x = Math.max(0, Math.min(window.innerWidth - rect.width, ev.clientX - offX));
      const y = Math.max(0, Math.min(window.innerHeight - rect.height, ev.clientY - offY));
      setFloatPos({ x, y });
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const hasLocalRecordingInThisTab = () => {
    if (timerState.running) return true;
    return Object.values(recorderRefs.current || {}).some((rec) => rec && rec.state && rec.state !== "inactive");
  };

  const selectSession = async (session) => {
    const normalized = normalizeSessionDoc(session);
    if (!normalized?._id) return;
    if (selectedSession?._id && normalized._id === selectedSession._id) {
      return;
    }
    const currentStatus = selectedSession?.status || "created";
    const isCurrentActive = ["started", "paused", "resumed"].includes(currentStatus);
    if (isCurrentActive && selectedSession?._id && hasLocalRecordingInThisTab()) {
      const shouldStopAndSwitch = await confirmDialog({
        title: "Switch session",
        message: "Current session is active in this tab. Stop it, upload final part, and switch to selected session?",
        confirmLabel: "Stop & switch",
      });
      if (!shouldStopAndSwitch) return;
      const stoppedCleanly = await stopSession();
      if (!stoppedCleanly) {
        setSessionError("Finalize pending for current session. Please retry pending uploads before switching.");
        return;
      }
    }

    stopAndReleaseStreams();
    recorderRefs.current = {};
    multipartUploadsRef.current = {
      audio: createEmptyMultipartState(),
      video: createEmptyMultipartState(),
      screen: createEmptyMultipartState(),
      attachment: createEmptyMultipartState()
    };
    setSelectedSession(normalized);
    setPendingFinalizeModes([]);
    commitTimerState({ running: false, startedAt: 0, baseElapsed: normalized?.elapsed_seconds || 0 });
    setPlaybackUrls({ audio: "", video: "", screen: "", attachment: "" });
  };

  const deleteSession = async (session) => {
    const sid = resolveSessionId(session);
    if (!API_BASE_URL || !sid) return;
    setOpenSessionMenuId("");
    if (["started", "resumed", "paused"].includes(session?.status)) {
      setSessionError("Stop this recording session before deleting it.");
      return;
    }
    const confirmed = window.confirm("Delete this recording session from app history? Recording files in S3 will be kept.");
    if (!confirmed) return;

    setSessionError("");
    setDeletingSessionIds((prev) => ({ ...prev, [sid]: true }));
    try {
      const res = await apiFetch(`${API_BASE_URL}/sessions/${sid}/delete`, { method: "POST" });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`Delete session failed: ${res.status} ${txt}`);
      }
      if (resolveSessionId(selectedSession) === sid) {
        setSelectedSession(null);
        setPendingFinalizeModes([]);
        commitTimerState({ running: false, startedAt: 0, baseElapsed: 0 });
        setPlaybackUrls({ audio: "", video: "", screen: "", attachment: "" });
        broadcastRecorderStatus("idle");
      }
      await fetchSessions();
    } catch (err) {
      setSessionError(String(err.message || err));
    } finally {
      setDeletingSessionIds((prev) => {
        const next = { ...prev };
        delete next[sid];
        return next;
      });
    }
  };

  const stopAndReleaseStreams = () => {
    stopAudioVisualizer();
    if (offlineTimerRef.current) { clearInterval(offlineTimerRef.current); offlineTimerRef.current = 0; }
    offlineRef.current = false;
    offlinePausedRef.current = false;
    setUploadOffline(false);
    if (compositeDrawRef.current) {
      clearInterval(compositeDrawRef.current);
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
    Object.values(recorderFlushTimersRef.current || {}).forEach((timerId) => {
      if (timerId) clearInterval(timerId);
    });
    recorderFlushTimersRef.current = {};
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

  const pickSupportedMime = (candidates = []) => {
    if (typeof window === "undefined" || typeof MediaRecorder === "undefined") return "";
    const list = Array.isArray(candidates) ? candidates : [];
    for (const mime of list) {
      const value = String(mime || "").trim();
      if (!value) continue;
      try {
        if (MediaRecorder.isTypeSupported(value)) return value;
      } catch (_) {}
    }
    return "";
  };

  const getMimeForMode = (mode) => {
    if (mode === "audio") {
      return (
        pickSupportedMime([
          "audio/webm;codecs=opus",
          "audio/webm",
          "audio/ogg;codecs=opus",
          "audio/mp4",
        ]) || "audio/webm"
      );
    }
    return (
      pickSupportedMime([
        "video/webm;codecs=vp9,opus",
        "video/webm;codecs=vp8,opus",
        "video/webm",
        "video/mp4",
      ]) || "video/webm"
    );
  };

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

  const enqueueModeTask = (mode, task) => {
    const state = multipartUploadsRef.current[mode];
    state.queue = state.queue
      .then(task)
      .catch((err) => {
        state.failed = true;
        markUpload(mode, "error");
        const msg = String(err?.message || err);
        if (msg.includes("RECORDING_BUCKET is not configured")) {
          setSessionError("Upload is disabled: backend RECORDING_BUCKET is not configured.");
        } else {
          setSessionError(`Recording upload failed (${mode}): ${msg}`);
        }
      });
    return state.queue;
  };

  // Upload one recorder chunk as its own S3 object (presigned PUT). Retries
  // transient failures so a blip doesn't lose the chunk; no ETag/CORS dependency
  // since these are plain objects, not multipart parts.
  const uploadChunkObject = async (mode, seq, blob) => {
    const state = multipartUploadsRef.current[mode];
    if (!blob || blob.size === 0) return;
    const activeId = recordingSessionIdRef.current || selectedSessionRef.current?._id || selectedSession?._id;
    if (!API_BASE_URL || !activeId) throw new Error("Session not ready for chunk upload");
    const contentType = state.contentType || blob.type || getMimeForMode(mode);

    markUpload(mode, "saving");
    let lastErr = null;
    for (let attempt = 1; attempt <= MULTIPART_PART_UPLOAD_RETRIES; attempt += 1) {
      try {
        const presignRes = await apiFetch(`${API_BASE_URL}/sessions/${activeId}/chunk/presign-url`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ media_type: mode, seq, content_type: contentType })
        });
        if (!presignRes.ok) {
          const txt = await presignRes.text();
          throw new Error(`Chunk presign failed: ${presignRes.status} ${txt}`);
        }
        const presignData = await presignRes.json();
        const putRes = await fetch(presignData.upload_url, {
          method: "PUT",
          headers: { "Content-Type": contentType },
          body: blob
        });
        if (!putRes.ok) {
          throw new Error(`Chunk PUT failed: ${putRes.status}`);
        }
        state.uploadedChunks += 1;
        markUpload(mode, "saved");
        return;
      } catch (err) {
        lastErr = err;
        console.warn(`[recorder] chunk upload failed ${mode} seq ${seq} (attempt ${attempt})`, err);
        if (attempt < MULTIPART_PART_UPLOAD_RETRIES) {
          await new Promise((r) => setTimeout(r, 800 * attempt));
        }
      }
    }
    throw lastErr || new Error("Chunk upload failed");
  };

  // Hold a chunk we couldn't upload. Once the buffer passes the cap we pause the
  // recorders so it can't grow without bound while we're offline.
  const bufferOfflineChunk = (item) => {
    offlineBufferRef.current.push(item);
    offlineBytesRef.current += item.blob.size;
    markUpload(item.mode, "error");
    if (offlineBytesRef.current >= OFFLINE_BUFFER_CAP_BYTES && !offlinePausedRef.current) {
      offlinePausedRef.current = true;
      Object.values(recorderRefs.current).forEach((rec) => {
        try { if (rec && rec.state === "recording") rec.pause(); } catch (_) {}
      });
    }
  };

  const exitOfflineMode = (resume) => {
    if (offlineTimerRef.current) { clearInterval(offlineTimerRef.current); offlineTimerRef.current = 0; }
    offlineRef.current = false;
    offlineSinceRef.current = 0;
    setUploadOffline(false);
    if (resume && offlinePausedRef.current) {
      offlinePausedRef.current = false;
      Object.values(recorderRefs.current).forEach((rec) => {
        try { if (rec && rec.state === "paused") rec.resume(); } catch (_) {}
      });
    } else {
      offlinePausedRef.current = false;
    }
  };

  // Periodic tick while offline: retry the buffered chunks; if they all upload we
  // recover and resume; if we've been offline past the limit, give up and stop.
  // Short attention beeps (no asset needed) — played when a recording is auto-stopped
  // due to a prolonged internet outage.
  const playWarningSound = () => {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      const beep = (start, freq) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = freq;
        const t0 = ctx.currentTime + start;
        gain.gain.setValueAtTime(0.0001, t0);
        gain.gain.exponentialRampToValueAtTime(0.35, t0 + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.35);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(t0);
        osc.stop(t0 + 0.4);
      };
      beep(0, 880);
      beep(0.45, 660);
      beep(0.9, 880);
      setTimeout(() => ctx.close().catch(() => {}), 1700);
    } catch (_) {}
  };

  const offlineTick = async () => {
    if (offlineTickBusyRef.current) return;
    offlineTickBusyRef.current = true;
    try {
      if (Date.now() - offlineSinceRef.current >= OFFLINE_MAX_MS) {
        console.warn("[recorder] offline > limit — stopping and salvaging");
        exitOfflineMode(false);
        offlineBufferRef.current = [];
        offlineBytesRef.current = 0;
        playWarningSound();
        setOfflineStopped(true);
        await stopSession();
        return;
      }
      while (offlineBufferRef.current.length > 0) {
        const item = offlineBufferRef.current[0];
        try {
          await uploadChunkObject(item.mode, item.seq, item.blob);
          offlineBufferRef.current.shift();
          offlineBytesRef.current -= item.blob.size;
        } catch (_) {
          return; // still offline; wait for the next tick
        }
      }
      // Buffer drained → connection is back.
      console.log("[recorder] connection recovered — resuming");
      exitOfflineMode(true);
    } finally {
      offlineTickBusyRef.current = false;
    }
  };

  const enterOfflineMode = () => {
    if (offlineRef.current) return;
    offlineRef.current = true;
    offlineSinceRef.current = Date.now();
    setUploadOffline(true);
    offlineTimerRef.current = setInterval(() => { offlineTick(); }, OFFLINE_RETRY_INTERVAL_MS);
  };

  const handleRecorderChunk = (mode, chunk) => {
    if (!chunk || chunk.size === 0) return;
    const state = multipartUploadsRef.current[mode];
    if (state.failed) return;
    if (!state.contentType) {
      state.contentType = chunk.type || getMimeForMode(mode);
      state.extension = getExtensionFromContentType(state.contentType);
    }
    const seq = state.seq;
    state.seq += 1;
    state.hasChunks = true;
    const item = { mode, seq, blob: chunk };
    console.log(`[recorder] chunk ${mode} seq=${seq} +${chunk.size}B sid=${recordingSessionIdRef.current}`);
    if (offlineRef.current) {
      bufferOfflineChunk(item);
      return;
    }
    enqueueModeTask(mode, async () => {
      try {
        await uploadChunkObject(mode, seq, chunk);
      } catch (err) {
        bufferOfflineChunk(item);
        enterOfflineMode();
      }
    });
  };

  // After recording stops: drain pending chunk uploads, then ask the backend to
  // concatenate them into the final object. The concat runs async on Lambda and
  // the caller polls waitForConcatComplete().
  const finalizeChunkConcat = async (mode) => {
    const state = multipartUploadsRef.current[mode];
    await state.queue;
    if (!state.hasChunks) return { triggered: false };
    if (state.failed || state.failedChunks > 0) {
      throw new Error(`Some ${mode} chunks failed to upload (${state.failedChunks}); cannot finalize cleanly`);
    }
    const activeId = recordingSessionIdRef.current || selectedSessionRef.current?._id || selectedSession?._id;
    const res = await apiFetch(`${API_BASE_URL}/sessions/${activeId}/chunks/concat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        media_type: mode,
        content_type: state.contentType || getMimeForMode(mode),
        extension: state.extension || getExtensionFromContentType(state.contentType)
      })
    });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`Concat trigger failed: ${res.status} ${txt}`);
    }
    return { triggered: true };
  };

  // Poll the session until every concatenating mode reaches "completed" (or one
  // reports "failed"). The backend concat is async, so we wait on its result.
  const waitForConcatComplete = async (modes, { timeoutMs = 5 * 60 * 1000, intervalMs = 2500 } = {}) => {
    const activeId = recordingSessionIdRef.current || selectedSessionRef.current?._id || selectedSession?._id;
    if (!API_BASE_URL || !activeId || modes.length === 0) return { ok: true, failed: [] };
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      let doc = null;
      try {
        const res = await apiFetch(`${API_BASE_URL}/sessions/${activeId}`);
        if (res.ok) doc = (await res.json())?.session;
      } catch (_) {}
      const uploads = doc?.uploads || {};
      const failed = modes.filter((m) => uploads[m]?.status === "failed");
      const done = modes.filter((m) => uploads[m]?.status === "completed");
      if (failed.length > 0) return { ok: false, failed };
      if (done.length === modes.length) return { ok: true, failed: [] };
      await new Promise((r) => setTimeout(r, intervalMs));
    }
    return { ok: false, failed: modes, timedOut: true };
  };

  const createRecorderForMode = (mode, stream) => {
    if (!stream) {
      console.warn(`[recorder] createRecorderForMode(${mode}): no stream`);
      return;
    }
    resetMultipartStateForMode(mode);
    const mimeType = getMimeForMode(mode);
    // Explicit bitrates: default browser bitrates can be low and cause blocky/laggy
    // video and thin/noisy audio. 128 kbps audio + ~3 Mbps video is clean for study
    // recordings without bloating the file.
    const opts = { audioBitsPerSecond: 128000 };
    if (mode !== "audio") opts.videoBitsPerSecond = 3000000;
    if (mimeType) opts.mimeType = mimeType;
    let rec;
    try {
      rec = new MediaRecorder(stream, opts);
    } catch (_) {
      rec = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    }
    const clearFlushTimer = () => {
      const timerId = recorderFlushTimersRef.current[mode];
      if (timerId) clearInterval(timerId);
      delete recorderFlushTimersRef.current[mode];
    };
    rec.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) handleRecorderChunk(mode, e.data);
    };
    rec.onstop = () => {
      clearFlushTimer();
    };
    rec.onerror = (e) => {
      console.error(`[recorder] MediaRecorder error (${mode})`, e?.error || e);
      clearFlushTimer();
    };
    recorderRefs.current[mode] = rec;
    rec.start();
    console.log(`[recorder] createRecorderForMode(${mode}) started, state=${rec.state}, mime=${mimeType}`);
    // We avoid MediaRecorder timeslice due to duplicate-timeline issues on some browsers.
    // Instead, force periodic chunk emission while recording.
    recorderFlushTimersRef.current[mode] = setInterval(() => {
      try {
        if (rec.state === "recording") rec.requestData();
      } catch (_) {}
    }, RECORDER_FLUSH_INTERVAL_MS);
  };

  const connectStreamAudioToComposite = (stream) => {
    if (!stream || !audioContextRef.current || !audioDestinationRef.current) return;
    if (!stream.getAudioTracks?.().length) return;
    const node = audioContextRef.current.createMediaStreamSource(stream);
    node.connect(audioDestinationRef.current);
    audioSourceNodesRef.current.push(node);
  };

  // System/tab audio only arrives if the user ticked "Share audio" in the picker —
  // and the browser/OS supports it (Chrome captures tab audio; full system audio
  // isn't exposed on macOS). Tell the user when it didn't come through.
  const warnIfNoSystemAudio = (screenStream) => {
    if (!screenStream?.getAudioTracks?.().length) {
      setSessionError(
        "Screen captured without system audio. To record it, pick a Chrome tab and tick \"Share tab audio\" in the dialog (full system audio can't be captured on macOS)."
      );
    }
  };

  // Canvas-backed recorder. drawFrame handles all cases: screen+camera PiP (call),
  // camera full (video), and an avatar placeholder when the camera is off — so the
  // recorded file shows the placeholder instead of black frames.
  const startCompositeRecorder = (targetMode = "screen") => {
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

    // object-fit: contain — fit the whole source inside the box, letterboxed.
    const drawContain = (video, dx, dy, dw, dh) => {
      const vw = video.videoWidth || dw;
      const vh = video.videoHeight || dh;
      const scale = Math.min(dw / vw, dh / vh) || 1;
      const w = vw * scale;
      const h = vh * scale;
      ctx.drawImage(video, dx + (dw - w) / 2, dy + (dh - h) / 2, w, h);
    };

    // object-fit: cover — fill the box, cropping overflow; optionally mirror to
    // match the on-screen self-view (transform: scaleX(-1)).
    const drawCover = (video, dx, dy, dw, dh, mirror = false) => {
      const vw = video.videoWidth || dw;
      const vh = video.videoHeight || dh;
      const scale = Math.max(dw / vw, dh / vh) || 1;
      const w = vw * scale;
      const h = vh * scale;
      const x = dx + (dw - w) / 2;
      const y = dy + (dh - h) / 2;
      if (mirror) {
        ctx.save();
        ctx.translate(2 * dx + dw, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(video, x, y, w, h);
        ctx.restore();
      } else {
        ctx.drawImage(video, x, y, w, h);
      }
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
      const recorderName = capitalize(auth?.name || "Recorder");

      ctx.fillStyle = "#0b1020";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      if (hasScreen && scrVideo && scrVideo.readyState >= 2) {
        // Screen fills the whole frame (letterboxed); the camera floats as a
        // small picture-in-picture in the bottom-right — mirroring the on-screen
        // layout, so the recording matches exactly what the user is watching.
        drawContain(scrVideo, 0, 0, canvas.width, canvas.height);

        const pipW = Math.round(canvas.width * 0.22);
        const pipH = Math.round((pipW * 9) / 16);
        const margin = Math.round(canvas.width * 0.018);
        const pipX = canvas.width - pipW - margin;
        const pipY = canvas.height - pipH - margin;

        ctx.save();
        ctx.beginPath();
        ctx.rect(pipX, pipY, pipW, pipH);
        ctx.clip();
        ctx.fillStyle = "#1e2130";
        ctx.fillRect(pipX, pipY, pipW, pipH);
        if (hasCamera && hasCameraActive && camVideo && camVideo.readyState >= 2) {
          drawCover(camVideo, pipX, pipY, pipW, pipH, true);
        } else {
          drawAvatarTile(pipX, pipY, pipW, pipH, recorderName);
        }
        ctx.restore();
        ctx.strokeStyle = "rgba(255,255,255,0.3)";
        ctx.lineWidth = 2;
        ctx.strokeRect(pipX, pipY, pipW, pipH);
      } else if (hasCamera && hasCameraActive && camVideo && camVideo.readyState >= 2) {
        drawCover(camVideo, 0, 0, canvas.width, canvas.height, true);
      } else if (hasCamera && !hasCameraActive) {
        ctx.fillStyle = "#111a30";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        drawAvatarTile(0, 0, canvas.width, canvas.height, recorderName);
      } else {
        ctx.fillStyle = "#9fb4e6";
        ctx.font = "28px sans-serif";
        ctx.fillText("Waiting for camera/screen...", 36, 70);
      }
    };
    compositeDrawRef.current = setInterval(drawFrame, Math.floor(1000 / 30));

    const composed = canvas.captureStream(30);
    const micTracks = streamRefs.current.audio?.getAudioTracks?.() || [];
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    // A call ("screen" target) shares its screen/tab audio LATER via the Share button,
    // so it must always set up the Web-Audio mixer now — otherwise startScreenShare's
    // connectStreamAudioToComposite has nowhere to route the tab audio and it's lost.
    // Video-only never gains a second source, so it uses the clean raw mic track.
    const needsMixer = targetMode !== "video";
    if (needsMixer && AudioCtx) {
      audioContextRef.current = new AudioCtx();
      audioDestinationRef.current = audioContextRef.current.createMediaStreamDestination();
      connectStreamAudioToComposite(streamRefs.current.audio); // mic now
      connectStreamAudioToComposite(streamRefs.current.screen); // tab/system audio if already shared
      audioDestinationRef.current.stream.getAudioTracks().forEach((track) => composed.addTrack(track));
    } else if (micTracks.length) {
      composed.addTrack(micTracks[0]);
    }

    compositeStreamRef.current = composed;
    bindPreview(combinedPreviewRef, composed);
    createRecorderForMode(targetMode, composed);
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
    warnIfNoSystemAudio(screenStream);
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

  // Screen-only recorder: record the (already-captured) screen together with the
  // mic and the tab/system audio, mixed into a single track.
  const startScreenOnlyRecorder = async () => {
    const screenStream = streamRefs.current.screen;
    if (!screenStream) return;
    const videoTracks = screenStream.getVideoTracks();
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    let recordStream;
    if (AudioCtx) {
      audioContextRef.current = new AudioCtx();
      audioDestinationRef.current = audioContextRef.current.createMediaStreamDestination();
      connectStreamAudioToComposite(streamRefs.current.audio); // mic
      connectStreamAudioToComposite(screenStream); // system/tab audio
      recordStream = new MediaStream([...videoTracks, ...audioDestinationRef.current.stream.getAudioTracks()]);
    } else {
      const micTracks = streamRefs.current.audio?.getAudioTracks?.() || [];
      recordStream = new MediaStream([...videoTracks, ...screenStream.getAudioTracks(), ...micTracks]);
    }
    bindPreview(screenPreviewRef, screenStream);
    createRecorderForMode("screen", recordStream);
    const [videoTrack] = videoTracks;
    if (videoTrack) {
      // Browser's own "Stop sharing" ends the recording session.
      videoTrack.onended = () => { stopSession().catch(() => {}); };
    }
  };

  const initRecorders = async (modes) => {
    // Release anything left over from a previous session (e.g. starting a video
    // recording right after a call) so the new session starts clean — otherwise
    // the old composite loop and AudioContext keep running and break the new
    // preview and live controls.
    stopAndReleaseStreams();
    recorderRefs.current = {};
    multipartUploadsRef.current = {
      audio: createEmptyMultipartState(),
      video: createEmptyMultipartState(),
      screen: createEmptyMultipartState(),
      attachment: createEmptyMultipartState()
    };
    setUploadHealth({});
    if (offlineTimerRef.current) { clearInterval(offlineTimerRef.current); offlineTimerRef.current = 0; }
    offlineRef.current = false;
    offlineSinceRef.current = 0;
    offlineBufferRef.current = [];
    offlineBytesRef.current = 0;
    offlinePausedRef.current = false;
    setUploadOffline(false);
    setOfflineStopped(false);
    const unique = Array.from(new Set(modes || []));
    const screenOnly = unique.includes("screen") && !unique.includes("video");
    console.log("[recorder] initRecorders modes=", unique, "screenOnly=", screenOnly);
    // Capture the screen first, while the click's user-activation is still fresh
    // (the mic permission prompt below can otherwise expire it and getDisplayMedia
    // would throw).
    if (screenOnly) {
      streamRefs.current.screen = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      warnIfNoSystemAudio(streamRefs.current.screen);
    }
    const needMic = unique.includes("audio") || unique.includes("video") || unique.includes("screen");
    if (needMic) {
      // Capture raw mic — browser voice-call DSP (noise suppression / AGC / echo
      // cancellation) muffles the voice and pumps the gain, which sounds worse for
      // a recording. The earlier "noise" was the Web-Audio resampling, now avoided.
      streamRefs.current.audio = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        video: false,
      });
    }
    if (unique.includes("audio") && streamRefs.current.audio) createRecorderForMode("audio", streamRefs.current.audio);

    if (unique.includes("video")) {
      const videoStream = await navigator.mediaDevices.getUserMedia({ audio: false, video: true });
      streamRefs.current.video = videoStream;
      videoStream.getVideoTracks().forEach((t) => { t.enabled = false; });
      bindPreview(cameraPreviewRef, videoStream);
      if (!unique.includes("screen")) {
        // Record through a canvas so a cam-off placeholder (avatar) ends up in the
        // file instead of black frames.
        startCompositeRecorder("video");
      }
    } else {
      bindPreview(cameraPreviewRef, null);
    }
    if (isCompositeMode(unique)) {
      startCompositeRecorder();
    } else if (screenOnly) {
      await startScreenOnlyRecorder();
    }
    if (!unique.includes("screen")) bindPreview(screenPreviewRef, null);
    if (unique.length === 1 && unique.includes("audio")) {
      startAudioVisualizer(streamRefs.current.audio);
    } else {
      stopAudioVisualizer();
    }
    setLiveControls({ micMuted: false, cameraOff: unique.includes("video"), sharingScreen: screenOnly });
    console.log(
      "[recorder] initRecorders done. streams=", Object.keys(streamRefs.current),
      "recorders=", Object.entries(recorderRefs.current).map(([m, r]) => `${m}:${r?.state}`)
    );
  };

  const pushSessionStatus = async (status, options = {}, sessionOverride = null) => {
    const activeSession = normalizeSessionDoc(sessionOverride || selectedSession);
    const sid = resolveSessionId(activeSession);
    if (!API_BASE_URL || !sid) return;
    const t = timerStateRef.current;
    const elapsed = t.running
      ? t.baseElapsed + Math.floor((Date.now() - t.startedAt) / 1000)
      : t.baseElapsed;
    console.log(`[recorder] pushSessionStatus -> ${status} sid=${sid} elapsed=${elapsed} force=${Boolean(options.forceStopPrevious)}`);
    try {
      const res = await apiFetch(`${API_BASE_URL}/sessions/${sid}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status,
          elapsed_seconds: elapsed,
          force_stop_previous: Boolean(options.forceStopPrevious)
        })
      });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`Status update failed: ${res.status} ${txt}`);
      }
      const data = await res.json();
      const updatedSession = normalizeSessionDoc(data?.session);
      console.log(`[recorder] pushSessionStatus ${status} OK -> backend status=${updatedSession?.status}`);
      if (updatedSession?._id) {
        setSelectedSession(updatedSession);
      }
      broadcastRecorderStatus(updatedSession?.status || status);
      commitTimerState({ running: false, startedAt: 0, baseElapsed: updatedSession?.elapsed_seconds || elapsed });
      await fetchSessions();
    } catch (err) {
      setSessionError(String(err.message || err));
      throw err;
    }
  };

  const startSession = async (sessionOverride = null, options = {}) => {
    let activeSession = sessionOverride || selectedSession;
    console.log("[recorder] startSession sid=", resolveSessionId(activeSession), "status=", activeSession?.status, "modes=", activeSession?.modes);
    if (!activeSession) {
      setSessionError("No active session selected. Create/select a session first.");
      return;
    }
    if (activeSession.status === "stopped") {
      setSessionError("Selected session is already stopped. Create a new session.");
      return;
    }
    setSessionError("");
    const activeSessionId = resolveSessionId(activeSession);
    if (!activeSessionId) {
      setSessionError("Session id is missing. Please reselect or recreate session.");
      return;
    }

    // Trust persisted session data for start flow; creation already validates subject/topic.
    // Refresh once to avoid stale local state, but do not hard-block on local text fields.
    if (API_BASE_URL) {
      try {
        const oneRes = await apiFetch(`${API_BASE_URL}/sessions/${activeSessionId}`);
        if (oneRes.ok) {
          const oneData = await oneRes.json();
          const latest = normalizeSessionDoc(oneData?.session);
          if (latest?._id) {
            activeSession = latest;
            setSelectedSession(latest);
          }
        }
      } catch (_) {}
    }

    // Make the active session id available to recorder chunk callbacks synchronously,
    // before React re-renders (create-and-start runs faster than a render cycle).
    selectedSessionRef.current = activeSession;
    recordingSessionIdRef.current = resolveSessionId(activeSession);
    // Mount the recording overlay NOW (synchronously) so its preview <video> elements
    // exist before initRecorders binds the media streams to them.
    flushSync(() => setRecorderArming(true));
    try {
      await initRecorders(activeSession.modes || []);
    } catch (err) {
      stopAndReleaseStreams();
      setRecorderArming(false);
      setSessionError(`Recorder permission/device error: ${String(err.message || err)}`);
      return;
    }
    // forceStart is set when the caller already confirmed taking over an active
    // recording (preflight), so we don't prompt again here.
    const forceStart = Boolean(options.forceStart);
    try {
      await pushSessionStatus("started", { forceStopPrevious: forceStart }, activeSession);
    } catch (err) {
      const msg = String(err?.message || err || "");
      const conflict = msg.includes("Another session is active");
      if (conflict) {
        // A recording became active elsewhere between preflight and now. Ask before
        // taking over — never silently stop the other recording.
        const confirmStop = await confirmDialog({
          title: "Recording in progress",
          message: "A recording is already going on another device. Do you want to stop that ongoing recording and start here?",
          confirmLabel: "Stop & start here",
        });
        if (!confirmStop) {
          stopAndReleaseStreams();
          recorderRefs.current = {};
          setRecorderArming(false);
          setSessionError("Recording not started — the other device's recording is still running.");
          return;
        }
        try {
          await pushSessionStatus("started", { forceStopPrevious: true }, activeSession);
        } catch (err2) {
          stopAndReleaseStreams();
          recorderRefs.current = {};
          setRecorderArming(false);
          setSessionError(`Could not start recording: ${String(err2?.message || err2)}`);
          return;
        }
      } else {
        stopAndReleaseStreams();
        recorderRefs.current = {};
        setRecorderArming(false);
        setSessionError(`Could not start recording: ${msg}`);
        return;
      }
    }
    setRecorderArming(false);
    commitTimerState({ running: true, startedAt: Date.now(), baseElapsed: activeSession?.elapsed_seconds || 0 });
  };

  const pauseSession = async () => {
    if (!selectedSession || !["started", "resumed"].includes(selectedSession.status)) return;
    Object.values(recorderRefs.current).forEach((rec) => {
      if (rec && rec.state === "recording") rec.pause();
    });
    try {
      await pushSessionStatus("paused");
    } catch (_) {}
  };

  const resumeSession = async () => {
    if (!selectedSession || selectedSession.status !== "paused") return;
    Object.values(recorderRefs.current).forEach((rec) => {
      if (rec && rec.state === "paused") rec.resume();
    });
    try {
      await pushSessionStatus("resumed");
    } catch (_) {}
    const base = selectedSession?.elapsed_seconds || timerState.baseElapsed || 0;
    commitTimerState({ running: true, startedAt: Date.now(), baseElapsed: base });
  };

  const stopSession = async () => {
    console.log("[recorder] stopSession sid=", selectedSession?._id, "status=", selectedSession?.status);
    if (stoppingRef.current) return true; // ignore repeat Stop clicks while finalizing
    if (!selectedSession || !["started", "paused", "resumed"].includes(selectedSession.status)) return true;
    stoppingRef.current = true;
    setStopping(true);
    try {
      Object.values(recorderRefs.current).forEach((rec) => {
        if (rec && rec.state !== "inactive") {
          try {
            rec.requestData();
          } catch (_) {}
        }
      });
      await stopRecordersOnly();
      console.log(
        "[recorder] recorders stopped; chunks per mode=",
        SESSION_MEDIA_TYPES.map((m) => `${m}:${multipartUploadsRef.current[m]?.uploadedChunks || 0}/${(multipartUploadsRef.current[m]?.uploadedChunks || 0) + (multipartUploadsRef.current[m]?.failedChunks || 0)}`)
      );
      // Drain pending chunk uploads, then trigger server-side concat per mode.
      const failedModes = [];
      await Promise.all(SESSION_MEDIA_TYPES.map(async (mode) => {
        try {
          await finalizeChunkConcat(mode);
        } catch (err) {
          console.error(`[recorder] finalizeChunkConcat(${mode}) failed`, err);
          failedModes.push(mode);
        }
      }));
      stopAndReleaseStreams();
      recorderRefs.current = {};
      let stoppedOk = false;
      for (let attempt = 1; attempt <= 3 && !stoppedOk; attempt += 1) {
        try {
          await pushSessionStatus("stopped");
          stoppedOk = true;
        } catch (err) {
          console.warn(`[recorder] stop push failed (attempt ${attempt})`, err);
          if (attempt < 3) await new Promise((r) => setTimeout(r, 700 * attempt));
        }
      }
      if (!stoppedOk) {
        // Reflect stopped locally so the overlay can't get stuck on a session the
        // backend still thinks is active; the next start will force-stop it.
        setSelectedSession((prev) => (prev ? { ...prev, status: "stopped" } : prev));
        broadcastRecorderStatus("stopped");
      }
      // The chunks are already durably in S3, so we DON'T block the UI on the
      // server-side concat (it can take minutes for a long recording). The list
      // shows a "Finalizing…" badge per session until the final file is ready.
      if (failedModes.length === 0) {
        multipartUploadsRef.current = {
          audio: createEmptyMultipartState(),
          video: createEmptyMultipartState(),
          screen: createEmptyMultipartState(),
          attachment: createEmptyMultipartState()
        };
        setPendingFinalizeModes([]);
        await fetchSessions();
        return true;
      } else {
        const uniqueFailed = [...new Set(failedModes)];
        setPendingFinalizeModes(uniqueFailed);
        setSessionError(
          `Session stopped, but saving failed for: ${uniqueFailed.join(", ")}. Use "Retry Pending Uploads".`
        );
        return false;
      }
    } catch (err) {
      setSessionError(String(err.message || err));
      return false;
    } finally {
      stoppingRef.current = false;
      setStopping(false);
    }
  };

  const executeAgentRecorderAction = async (payload) => {
    const actionName = String(payload?.name || "").trim();
    const args = payload?.args && typeof payload.args === "object" ? payload.args : {};
    if (!actionName) return;
    if (!["start_recording_session", "pause_recording_session", "resume_recording_session", "end_recording_session"].includes(actionName)) {
      return;
    }
    const requestedSessionId = String(args?.session_id || "").trim();
    let activeSession = selectedSession;
    if (requestedSessionId && selectedSession?._id !== requestedSessionId) {
      const direct = (sessionList || []).find((row) => row?._id === requestedSessionId);
      if (direct) {
        await selectSession(direct);
        activeSession = direct;
      } else {
        const fetched = await fetchSessions();
        const latest = (fetched || []).find((row) => row?._id === requestedSessionId);
        if (latest) {
          await selectSession(latest);
          activeSession = latest;
        }
      }
    }
    if (actionName === "start_recording_session") {
      if (!activeSession || activeSession.status === "stopped") {
        if (!API_BASE_URL) {
          setSessionError("Backend API URL is required to create/start recording session.");
          return;
        }
        const recorderType = String(args?.recorder_type || "audio").trim().toLowerCase();
        const sessionType = String(args?.session_type || "study").trim().toLowerCase();
        const incomingSubject = String(args?.subject || "").trim();
        const incomingTopic = String(args?.topic || "").trim();
        const incomingNotes = String(args?.notes || "").trim();
        const fallback = buildSessionSubjectTopic();
        const resolvedSubject = incomingSubject || fallback.subject || "";
        const resolvedTopic = incomingTopic || fallback.topic || "";

        if (!resolvedSubject || !resolvedTopic) {
          const plan = missionSelector?.plan && typeof missionSelector.plan === "object" ? missionSelector.plan : {};
          const courseCount = Array.isArray(plan.courses) ? plan.courses.length : 0;
          const bookCount = Array.isArray(plan.books) ? plan.books.length : 0;
          const randomCount = Array.isArray(plan.random) ? plan.random.length : 0;
          const testCount = Array.isArray(plan.tests) ? plan.tests.length : 0;
          setSessionError(
            `Agent needs confirmation before start. Pick subject/topic from your plan (courses:${courseCount}, books:${bookCount}, random:${randomCount}, tests:${testCount}) and retry.`
          );
          return;
        }

        const payloadBody = {
          subject: resolvedSubject,
          topic: resolvedTopic,
          session_type: ["study", "revision", "analysis", "test"].includes(sessionType) ? sessionType : "study",
          recorder_type: recorderType || "audio",
          notes: incomingNotes || `Agent-triggered ${recorderType || "audio"} session`,
        };
        const res = await apiFetch(`${API_BASE_URL}/sessions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payloadBody),
        });
        if (!res.ok) {
          const txt = await res.text();
          setSessionError(`Agent create session failed: ${res.status} ${txt}`);
          return;
        }
        const data = await res.json();
        const createdSession = normalizeSessionDoc(data?.session);
        if (createdSession?._id) {
          activeSession = createdSession;
          setSelectedSession(activeSession);
          await fetchSessions();
        } else {
          setSessionError("Agent create session failed: session id missing in response.");
          return;
        }
      }
      await startSession(activeSession);
    }
    if (actionName === "pause_recording_session") await pauseSession();
    if (actionName === "resume_recording_session") await resumeSession();
    if (actionName === "end_recording_session") await stopSession();
  };

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const onAgentAction = (event) => {
      const payload = event?.detail || {};
      executeAgentRecorderAction(payload).catch((err) => {
        setSessionError(`Agent action failed: ${String(err?.message || err)}`);
      });
    };
    window.addEventListener(AGENT_RECORDER_EVENT, onAgentAction);
    try {
      const raw = window.sessionStorage.getItem(AGENT_PENDING_RECORDER_ACTION_KEY);
      if (raw) {
        const payload = JSON.parse(raw);
        window.sessionStorage.removeItem(AGENT_PENDING_RECORDER_ACTION_KEY);
        executeAgentRecorderAction(payload).catch((err) => {
          setSessionError(`Agent action failed: ${String(err?.message || err)}`);
        });
      }
    } catch (_) {}
    return () => window.removeEventListener(AGENT_RECORDER_EVENT, onAgentAction);
  }, [selectedSession, sessionList]);

  const retryPendingUploads = async () => {
    if (!selectedSession?._id || pendingFinalizeModes.length === 0) return;
    setFinalizeRetrying(true);
    try {
      const failedModes = [];
      const triggeredModes = [];
      for (const mode of pendingFinalizeModes) {
        try {
          const r = await finalizeChunkConcat(mode);
          if (r.triggered) triggeredModes.push(mode);
        } catch (_) {
          failedModes.push(mode);
        }
      }
      if (triggeredModes.length > 0) {
        const { ok, failed } = await waitForConcatComplete(triggeredModes);
        if (!ok) failedModes.push(...failed);
      }
      if (failedModes.length === 0) {
        multipartUploadsRef.current = {
          audio: createEmptyMultipartState(),
          video: createEmptyMultipartState(),
          screen: createEmptyMultipartState(),
          attachment: createEmptyMultipartState()
        };
        setPendingFinalizeModes([]);
        setSessionError("");
      } else {
        const uniqueFailed = [...new Set(failedModes)];
        setPendingFinalizeModes(uniqueFailed);
        setSessionError(`Retry still pending for: ${uniqueFailed.join(", ")}`);
      }
    } catch (err) {
      setSessionError(String(err.message || err));
    } finally {
      setFinalizeRetrying(false);
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
    // Turning the camera back on: rebind the stream so the preview surface
    // actually re-renders frames (a plain play() can stay black after the
    // track was disabled), not just resume playback.
    if (!nextCameraOff) {
      bindPreview(cameraPreviewRef, camStream);
    }
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
      const res = await apiFetch(
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

  const fetchPlaybackUrl = async (sessionIdValue, mediaType) => {
    if (!API_BASE_URL || !sessionIdValue || !mediaType) return "";
    const res = await apiFetch(
      `${API_BASE_URL}/sessions/${sessionIdValue}/playback-url?media_type=${encodeURIComponent(mediaType)}`
    );
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`Playback URL failed: ${res.status} ${txt}`);
    }
    const data = await res.json();
    return data.playback_url || "";
  };

  // Pick the main recording to play for a session (screen/composite first, then video, then audio).
  const getPrimaryPlaybackType = (session) => {
    const uploads = session?.uploads || {};
    for (const m of ["screen", "video", "audio"]) {
      if (uploads[m]?.key) return m;
    }
    if (uploads.attachment?.key) return "attachment";
    return "";
  };

  const openPlayer = async (session, forcedType = "") => {
    const sid = resolveSessionId(session);
    if (!sid) return;
    const mediaType = forcedType || getPrimaryPlaybackType(session);
    if (!mediaType) {
      setSessionError("No recording available to play for this session yet.");
      return;
    }
    // WebM recordings (everything except uploaded mp4 / audio / attachments) are
    // streamed through MediaSource so playback starts immediately and buffers as
    // it goes, instead of the browser downloading the whole file first.
    const key = String(session?.uploads?.[mediaType]?.key || "");
    const streaming = mediaType !== "audio" && mediaType !== "attachment" && /\.webm$/i.test(key);
    const title = `${session.subject || "Session"}${session.topic ? ` — ${session.topic}` : ""}`;
    setPlayerRate(1);
    setPlayerModal({ open: true, sid, mediaType, url: "", title, loading: true, streaming });
    try {
      const url = await fetchPlaybackUrl(sid, mediaType);
      setPlayerModal({ open: true, sid, mediaType, url, title, loading: false, streaming });
    } catch (err) {
      setPlayerModal({ open: false, sid: "", mediaType: "", url: "", title: "", loading: false, streaming: false });
      setSessionError(`Playback failed: ${String(err.message || err)}`);
    }
  };

  // Force a browser download (presigned URL carries Content-Disposition: attachment),
  // so it saves the file instead of opening it in a new tab.
  const triggerDownload = async (sid, mediaType) => {
    if (!API_BASE_URL || !sid || !mediaType) {
      setSessionError("No recording available to download yet.");
      return;
    }
    try {
      const res = await apiFetch(
        `${API_BASE_URL}/sessions/${sid}/playback-url?media_type=${encodeURIComponent(mediaType)}&download=1`
      );
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      const a = document.createElement("a");
      a.href = data.playback_url;
      a.download = "";
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (err) {
      setSessionError(`Download failed: ${String(err.message || err)}`);
    }
  };

  const downloadRecording = (session) => {
    setOpenSessionMenuId("");
    return triggerDownload(resolveSessionId(session), getPrimaryPlaybackType(session));
  };

  const editSessionNote = async (session) => {
    const sid = resolveSessionId(session);
    if (!sid) return;
    setOpenSessionMenuId("");
    const next = window.prompt("Edit note for this recording:", session?.notes || "");
    if (next === null) return; // cancelled
    try {
      const res = await apiFetch(`${API_BASE_URL}/sessions/${sid}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: next.trim() }),
      });
      if (!res.ok) throw new Error(await res.text());
      await fetchSessions();
    } catch (err) {
      setSessionError(`Could not update note: ${String(err.message || err)}`);
    }
  };

  const teardownPlayerStream = () => {
    if (playerStreamAbortRef.current) {
      try { playerStreamAbortRef.current.abort(); } catch (_) {}
      playerStreamAbortRef.current = null;
    }
    const ms = playerMediaSourceRef.current;
    if (ms) {
      try { if (ms.readyState === "open") ms.endOfStream(); } catch (_) {}
      playerMediaSourceRef.current = null;
    }
  };

  // Stream a WebM recording into the <video> element via MediaSource Extensions:
  // fetch the object as a readable stream and append chunks to a SourceBuffer so
  // playback can start before the file is fully downloaded. Returns false (so the
  // caller falls back to a plain src=url) if MSE / the codec isn't supported.
  const attachMseStream = (videoEl, url) => {
    if (typeof window === "undefined" || typeof MediaSource === "undefined") return false;
    const candidates = [
      'video/webm; codecs="vp9,opus"',
      'video/webm; codecs="vp8,opus"',
      'video/webm; codecs="vp9"',
      'video/webm; codecs="vp8"',
      "video/webm",
    ];
    let mime = "";
    for (const c of candidates) {
      try { if (MediaSource.isTypeSupported(c)) { mime = c; break; } } catch (_) {}
    }
    if (!mime) return false;

    const mediaSource = new MediaSource();
    playerMediaSourceRef.current = mediaSource;
    const controller = new AbortController();
    playerStreamAbortRef.current = controller;
    videoEl.src = URL.createObjectURL(mediaSource);
    videoEl.play?.().catch(() => {});

    const onSourceOpen = async () => {
      let sb;
      try {
        sb = mediaSource.addSourceBuffer(mime);
      } catch (_) {
        try { videoEl.src = url; videoEl.play?.().catch(() => {}); } catch (_) {}
        return;
      }
      const waitIdle = () => (sb.updating
        ? new Promise((r) => sb.addEventListener("updateend", r, { once: true }))
        : Promise.resolve());
      const appendChunk = async (chunk) => {
        for (let attempt = 0; attempt < 5; attempt += 1) {
          try {
            await waitIdle();
            sb.appendBuffer(chunk);
            await waitIdle();
            return;
          } catch (err) {
            if (err?.name !== "QuotaExceededError") throw err;
            // SourceBuffer full: evict the portion already played, or wait for
            // playback to drain the buffer ahead of the current position.
            const cur = videoEl.currentTime || 0;
            if (sb.buffered.length && sb.buffered.start(0) < cur - 6) {
              await waitIdle();
              try { sb.remove(sb.buffered.start(0), cur - 5); } catch (_) {}
              await waitIdle();
            } else {
              await new Promise((r) => setTimeout(r, 400));
            }
          }
        }
      };
      try {
        const resp = await fetch(url, { signal: controller.signal });
        if (!resp.ok || !resp.body) throw new Error(`stream fetch ${resp.status}`);
        const reader = resp.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value && value.byteLength) await appendChunk(value);
        }
        await waitIdle();
        if (mediaSource.readyState === "open") {
          try { mediaSource.endOfStream(); } catch (_) {}
        }
      } catch (err) {
        if (err && err.name === "AbortError") return;
        // On any streaming failure, fall back to plain progressive playback.
        try { if (mediaSource.readyState === "open") mediaSource.endOfStream(); } catch (_) {}
        try {
          const t = videoEl.currentTime || 0;
          videoEl.src = url;
          videoEl.currentTime = t;
          videoEl.play?.().catch(() => {});
        } catch (_) {}
      }
    };
    mediaSource.addEventListener("sourceopen", onSourceOpen, { once: true });
    return true;
  };

  const closePlayer = () => {
    teardownPlayerStream();
    const el = playerMediaRef.current;
    if (el) {
      try { el.pause(); } catch (_) {}
      try { el.removeAttribute("src"); el.load?.(); } catch (_) {}
    }
    if (typeof document !== "undefined" && document.fullscreenElement) {
      document.exitFullscreen?.().catch(() => {});
    }
    setPlayerModal({ open: false, mediaType: "", url: "", title: "", loading: false, streaming: false });
    setPlayerPlaying(false);
    setPlayerCurrentTime(0);
    setPlayerDuration(0);
  };

  const togglePlayerPlay = () => {
    const el = playerMediaRef.current;
    if (!el) return;
    if (el.paused) { el.play?.().catch(() => {}); setPlayerPlaying(true); }
    else { el.pause?.(); setPlayerPlaying(false); }
  };

  const onPlayerTimeUpdate = () => {
    const el = playerMediaRef.current;
    if (el) setPlayerCurrentTime(el.currentTime);
  };
  const onPlayerDurationChange = () => {
    const el = playerMediaRef.current;
    if (el) setPlayerDuration(isFinite(el.duration) ? el.duration : 0);
  };
  const onPlayerSeek = (e) => {
    const el = playerMediaRef.current;
    if (el) el.currentTime = Number(e.target.value);
    setPlayerCurrentTime(Number(e.target.value));
  };
  const onPlayerVolume = (e) => {
    const v = Number(e.target.value);
    setPlayerVolume(v);
    if (playerMediaRef.current) playerMediaRef.current.volume = v;
  };

  const changePlayerSpeed = (rate) => {
    const el = playerMediaRef.current;
    if (el) el.playbackRate = rate;
    setPlayerRate(rate);
  };

  const togglePlayerFullscreen = () => {
    const target = playerModal.mediaType === "audio"
      ? playerWrapRef.current
      : (playerMediaRef.current || playerWrapRef.current);
    if (!target) return;
    if (typeof document !== "undefined" && document.fullscreenElement) {
      document.exitFullscreen?.().catch(() => {});
    } else {
      target.requestFullscreen?.().catch(() => {});
    }
  };

  const uploadMediaForSession = async (sessionId, mediaType, input, fallbackName = "") => {
    if (!API_BASE_URL || !sessionId || !input) return;
    const inputName = input.name || fallbackName || `${mediaType}.webm`;
    const extension = inputName.split(".").pop()?.toLowerCase() || "webm";
    const contentType = input.type || "application/octet-stream";

    const uploadMediaMultipart = async () => {
      const startRes = await apiFetch(`${API_BASE_URL}/sessions/${sessionId}/multipart/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          media_type: mediaType,
          content_type: contentType,
          extension
        })
      });
      if (!startRes.ok) {
        const txt = await startRes.text();
        throw new Error(`Multipart start failed: ${startRes.status} ${txt}`);
      }
      const startData = await startRes.json();
      const uploadId = String(startData?.upload_id || "").trim();
      if (!uploadId) throw new Error("Multipart start failed: upload_id missing.");

      const size = Number(input.size || 0);
      const parts = [];
      let partNumber = 1;
      let offset = 0;

      try {
        while (offset < size) {
          const nextOffset = Math.min(offset + MULTIPART_FILE_PART_BYTES, size);
          const chunk = input.slice(offset, nextOffset);

          const presignRes = await apiFetch(`${API_BASE_URL}/sessions/${sessionId}/multipart/presign-part`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              media_type: mediaType,
              upload_id: uploadId,
              part_number: partNumber
            })
          });
          if (!presignRes.ok) {
            const txt = await presignRes.text();
            throw new Error(`Multipart presign part failed: ${presignRes.status} ${txt}`);
          }
          const presignData = await presignRes.json();
          const putRes = await fetch(presignData.upload_url, {
            method: "PUT",
            body: chunk
          });
          if (!putRes.ok) {
            throw new Error(`Multipart part upload failed: ${putRes.status}`);
          }
          const etag = putRes.headers.get("ETag") || "";
          if (!etag) {
            throw new Error("S3 did not expose ETag header. Configure bucket CORS ExposeHeaders to include ETag.");
          }
          parts.push({ part_number: partNumber, etag });
          partNumber += 1;
          offset = nextOffset;
        }

        const completeRes = await apiFetch(`${API_BASE_URL}/sessions/${sessionId}/multipart/complete`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            media_type: mediaType,
            upload_id: uploadId,
            parts
          })
        });
        if (!completeRes.ok) {
          const txt = await completeRes.text();
          throw new Error(`Multipart complete failed: ${completeRes.status} ${txt}`);
        }
      } catch (err) {
        try {
          await apiFetch(`${API_BASE_URL}/sessions/${sessionId}/multipart/abort`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              media_type: mediaType,
              upload_id: uploadId
            })
          });
        } catch (_) {}
        throw err;
      }
    };

    if (Number(input.size || 0) >= MULTIPART_MIN_PART_BYTES) {
      await uploadMediaMultipart();
      return;
    }

    const presignRes = await apiFetch(`${API_BASE_URL}/sessions/${sessionId}/presign`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        media_type: mediaType,
        content_type: contentType,
        extension
      })
    });
    if (!presignRes.ok) {
      const txt = await presignRes.text();
      throw new Error(`Presign failed: ${presignRes.status} ${txt}`);
    }
    const presignData = await presignRes.json();
    const uploadRes = await fetch(presignData.upload_url, {
      method: "PUT",
      headers: { "Content-Type": contentType },
      body: input
    });
    if (!uploadRes.ok) throw new Error(`Upload failed: ${uploadRes.status}`);
  };


  const createExplainerSessionWithUploads = async () => {
    if (!API_BASE_URL) return;
    const { subject, topic } = buildSessionSubjectTopic();
    const notes = sessionForm.notes.trim();
    if (!subject || !topic) {
      setSessionError("Subject and topic are required.");
      return;
    }
    if (explainerFiles.length === 0) {
      setSessionError("Please add at least one PDF/image for explainer.");
      return;
    }
    if (!explainerVideoBlob) {
      setSessionError("Please record your explanation first (Record button on the canvas).");
      return;
    }
    try {
      setExplainerDoneLoading(true);
      setSessionError("");
      const testRef = buildSessionTestRef();
      const payload = {
        subject,
        topic,
        session_type: sessionForm.session_type,
        recorder_type: "pdf_explainer",
        notes,
        simple_record: sessionForm.exam_type === SIMP_RECORD_VALUE,
        ...testRef,
      };
      const createRes = await apiFetch(`${API_BASE_URL}/sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!createRes.ok) {
        const txt = await createRes.text();
        throw new Error(`Create session failed: ${createRes.status} ${txt}`);
      }
      const createData = await createRes.json();
      const sessionId = resolveSessionId(createData.session);
      if (!sessionId) throw new Error("Session id missing in create response");
      // Upload the canvas video recording (contains both video + audio)
      await uploadMediaForSession(sessionId, "screen", explainerVideoBlob, "explainer-recording.webm");
      // Upload the current PDF/image as the attachment for reference
      const currentFile = explainerFiles[explainerFileIdx];
      if (currentFile?.file) {
        await uploadMediaForSession(sessionId, "attachment", currentFile.file, currentFile.name);
      }
      const oneRes = await apiFetch(`${API_BASE_URL}/sessions/${sessionId}`);
      if (oneRes.ok) {
        const oneData = await oneRes.json();
        setSelectedSession(normalizeSessionDoc(oneData.session || createData.session));
      } else {
        setSelectedSession(normalizeSessionDoc(createData.session));
      }
      commitTimerState({ running: false, startedAt: 0, baseElapsed: createData.session?.elapsed_seconds || 0 });
      await fetchSessions();
      setExplainerFiles([]);
      setExplainerFileIdx(0);
      setExplainerVideoBlob(null);
      setUploadFiles((prev) => ({ ...prev, explainerAttachment: null, explainerAudio: null }));
      setPlaybackUrls({ audio: "", video: "", screen: "", attachment: "" });
    } catch (err) {
      setSessionError(String(err.message || err));
    } finally {
      setExplainerDoneLoading(false);
    }
  };

  const openExplainerPopup = async () => {
    try {
      if (!playbackUrls.attachment) await loadPlayback("attachment");
      if (!playbackUrls.audio) await loadPlayback("audio");
      setExplainerModalOpen(true);
    } catch (_) {}
  };

  const elapsedDisplay = timerState.running
    ? timerState.baseElapsed + Math.floor((nowTick - timerState.startedAt) / 1000)
    : timerState.baseElapsed;
  const offlineRemainingSecs = uploadOffline
    ? Math.max(0, Math.ceil((OFFLINE_MAX_MS - (nowTick - offlineSinceRef.current)) / 1000))
    : 0;
  // Roll the per-mode upload health into a single banner: any error wins, else
  // any in-flight = "saving", else if anything has saved = "saved".
  const uploadHealthValues = Object.values(uploadHealth);
  const uploadIndicator = uploadHealthValues.includes("error")
    ? { cls: "error", label: <><Icon name="warning" size={14} /> Not saving — check connection</> }
    : uploadHealthValues.includes("saving")
    ? { cls: "saving", label: <><Icon name="upload" size={14} /> Saving…</> }
    : uploadHealthValues.includes("saved")
    ? { cls: "saved", label: <><Icon name="check" size={14} /> Saved</> }
    : null;
  const sessionStatus = selectedSession?.status || "created";
  const isClosed = sessionStatus === "stopped";
  const canPause = sessionStatus === "started" || sessionStatus === "resumed";
  const canResume = sessionStatus === "paused";
  const canStop = sessionStatus === "started" || sessionStatus === "paused" || sessionStatus === "resumed";
  const isRecordingActive = ["started", "paused", "resumed"].includes(sessionStatus);
  const selectedModes = selectedSession?.modes || [];
  const selectedRecorderType = getRecorderType(selectedSession);
  const hasVideoMode = selectedModes.includes("video");
  const hasScreenMode = selectedModes.includes("screen");
  const hasAudioMode = selectedModes.includes("audio") || hasVideoMode || hasScreenMode;
  const canUseLiveControls = canPause || canResume;
  const recorderLabel = capitalize(auth?.name || "Recorder");
  const recorderInitial = recorderLabel.charAt(0) || "R";
  const attachmentKey = selectedSession?.uploads?.attachment?.key || "";
  const attachmentKind = getAttachmentKindFromKey(attachmentKey);
  const explainerAttachmentReady = explainerFiles.length > 0;
  const explainerDoneReady = explainerAttachmentReady && Boolean(explainerVideoBlob);
  const isSimpRecord = sessionForm.exam_type === SIMP_RECORD_VALUE;
  const effectiveExamType = sessionForm.exam_type === OTHER_VALUE ? sessionForm.exam_type_other.trim().toLowerCase() : sessionForm.exam_type;
  const currentSubjectOptions = effectiveExamType ? getSubjectsForExam(effectiveExamType, activeCatalog) : [];
  const effectiveSubject = sessionForm.subject === OTHER_VALUE ? sessionForm.subject_other.trim() : sessionForm.subject;
  const currentTopicOptions = effectiveExamType && effectiveSubject ? getTopicsForSelection(effectiveExamType, effectiveSubject, activeCatalog) : [];
  const selectedSubjectValue = sessionForm.subject === OTHER_VALUE ? sessionForm.subject_other : sessionForm.subject;
  const selectedTopicValue = sessionForm.topic === OTHER_VALUE ? sessionForm.topic_other : sessionForm.topic;
  // Always present newest-first by created_at, deterministically, so selecting or
  // running a previous session never reshuffles the list.
  // The session this device is actively recording (if any) — used to hide
  // sessions that are running on a *different* device from this device's list.
  const myActiveRecordingId =
    isRecordingActive && hasLocalRecordingInThisTab() ? resolveSessionId(selectedSession) : "";

  const orderedSessionList = useMemo(() => {
    return [...sessionList]
      .filter((s) => {
        const active = ["started", "resumed", "paused"].includes(s?.status);
        // Hide recordings active on another device/tab; only show the one this
        // device is recording (or non-active sessions).
        return !active || resolveSessionId(s) === myActiveRecordingId;
      })
      .sort((a, b) => {
        const ta = Date.parse(a?.created_at || "") || 0;
        const tb = Date.parse(b?.created_at || "") || 0;
        return tb - ta;
      });
  }, [sessionList, myActiveRecordingId]);

  // Group all recordings by their day for the day-wise listing.
  const groupedSessions = useMemo(() => {
    const groups = new Map();
    orderedSessionList.forEach((s) => {
      const key = s?.date || (s?.created_at || "").slice(0, 10) || "undated";
      if (!groups.has(key)) groups.set(key, { key, items: [] });
      groups.get(key).items.push(s);
    });
    return Array.from(groups.values()).sort((a, b) => (a.key < b.key ? 1 : -1));
  }, [orderedSessionList]);

  const fmtDayHeading = (key) => {
    if (!key || key === "undated") return "Undated";
    const d = new Date(`${key}T00:00:00`);
    if (Number.isNaN(d.getTime())) return key;
    return d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
  };

  return (
    <main className="app-shell">
      <div className="bg-orb orb-1" />
      <div className="bg-orb orb-2" />
      <header className="hero">
        <MainMenu active="recorder" />
        <h1>Session Recorder</h1>
        <p className="subtext">Create, run, and upload study recording sessions.</p>
      </header>

      <section className="milestone-panel session-panel">
        {!API_BASE_URL ? (
          <p className="api-state warn">Backend URL needed for session recorder APIs.</p>
        ) : (
          <>
            <div className="session-toolbar">
              <h2 className="session-list-title">All recordings</h2>
              <button className="btn-ticket record-btn" onClick={() => setCreateModalOpen(true)}>
                <span className="record-dot" aria-hidden="true" /> Record
              </button>
            </div>
            {sessionError ? <p className="api-state error">{sessionError}</p> : null}
            {sessionLoading ? <p className="day-state">Loading sessions...</p> : null}
            {pendingFinalizeModes.length > 0 ? (
              <div className="task-modal-actions" style={{ justifyContent: "flex-start" }}>
                <button className="btn-day" onClick={retryPendingUploads} disabled={finalizeRetrying}>
                  {finalizeRetrying ? "Retrying..." : `Retry Pending Uploads (${pendingFinalizeModes.join(", ")})`}
                </button>
              </div>
            ) : null}
            {createModalOpen ? (
            <div className="task-modal-overlay" onClick={() => setCreateModalOpen(false)}>
            <div className="task-modal create-modal" onClick={(e) => e.stopPropagation()}>
            <div className="recording-player-head media-modal-head">
              <h3>New Recording</h3>
              <button className="btn-cancel" onClick={() => setCreateModalOpen(false)}>Close</button>
            </div>
            {missionSelectorLoading ? <p className="day-state">Loading mission options...</p> : null}
            <div className="session-form-grid">
              <select
                className="task-select"
                value={sessionForm.exam_type}
                onChange={(e) => {
                  const nextExam = e.target.value;
                  const nextExamForCatalog = nextExam === OTHER_VALUE ? "" : nextExam;
                  const nextSubjects = nextExamForCatalog ? getSubjectsForExam(nextExamForCatalog, activeCatalog) : [];
                  const nextSubject = nextExam === OTHER_VALUE ? OTHER_VALUE : (nextSubjects[0] || OTHER_VALUE);
                  const nextTopics = nextExamForCatalog && nextSubject !== OTHER_VALUE
                    ? getTopicsForSelection(nextExamForCatalog, nextSubject, activeCatalog)
                    : [];
                  setSessionForm((p) => {
                    const nextState = {
                      ...p,
                      exam_type: nextExam,
                      subject: nextSubject,
                      topic: nextTopics[0] || OTHER_VALUE,
                    };
                    if (nextExam !== OTHER_VALUE) {
                      nextState.exam_type_other = "";
                    }
                    if (nextSubject !== OTHER_VALUE) {
                      nextState.subject_other = "";
                    }
                    if ((nextTopics[0] || OTHER_VALUE) !== OTHER_VALUE) {
                      nextState.topic_other = "";
                    }
                    return nextState;
                  });
                }}
              >
                <option value={SIMP_RECORD_VALUE}>Simple Record</option>
                {activeExamOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
                <option value={OTHER_VALUE}>Other</option>
              </select>
              {sessionForm.exam_type === OTHER_VALUE ? (
                <input
                  className="task-select"
                  placeholder="Type custom exam"
                  value={sessionForm.exam_type_other}
                  onChange={(e) => setSessionForm((p) => ({ ...p, exam_type_other: e.target.value, subject: OTHER_VALUE, topic: OTHER_VALUE }))}
                />
              ) : null}
              {!isSimpRecord ? (
              <>
              <select
                className="task-select"
                value={sessionForm.subject}
                onChange={(e) => {
                  const nextSubject = e.target.value;
                  const nextTopics = nextSubject === OTHER_VALUE
                    ? []
                    : getTopicsForSelection(effectiveExamType, nextSubject, activeCatalog);
                  setSessionForm((p) => {
                    const nextState = { ...p, subject: nextSubject, topic: nextTopics[0] || OTHER_VALUE };
                    if (nextSubject !== OTHER_VALUE) {
                      nextState.subject_other = "";
                    }
                    if ((nextTopics[0] || OTHER_VALUE) !== OTHER_VALUE) {
                      nextState.topic_other = "";
                    }
                    return nextState;
                  });
                }}
              >
                {currentSubjectOptions.map((subj) => (
                  <option key={subj} value={subj}>{subj}</option>
                ))}
                <option value={OTHER_VALUE}>Other</option>
              </select>
              {sessionForm.subject === OTHER_VALUE ? (
                <input
                  className="task-select"
                  placeholder="Type custom subject"
                  value={sessionForm.subject_other}
                  onChange={(e) => setSessionForm((p) => ({ ...p, subject_other: e.target.value, topic: OTHER_VALUE }))}
                />
              ) : null}
              <select
                className="task-select"
                value={sessionForm.topic}
                onChange={(e) => setSessionForm((p) => ({ ...p, topic: e.target.value }))}
              >
                {currentTopicOptions.map((topic) => (
                  <option key={topic} value={topic}>{topic}</option>
                ))}
                <option value={OTHER_VALUE}>Other</option>
              </select>
              {sessionForm.topic === OTHER_VALUE ? (
                <input
                  className="task-select"
                  placeholder="Type custom topic"
                  value={sessionForm.topic_other}
                  onChange={(e) => setSessionForm((p) => ({ ...p, topic_other: e.target.value }))}
                />
              ) : null}
              <select className="task-select" value={sessionForm.session_type} onChange={(e) => setSessionForm((p) => ({ ...p, session_type: e.target.value }))}>
                <option value="study">Study</option>
                <option value="revision">Revision</option>
                <option value="analysis">Analysis</option>
              </select>
              </>
              ) : null}
              <select className="task-select" value={sessionForm.recorder_type} onChange={(e) => setSessionForm((p) => ({ ...p, recorder_type: e.target.value }))}>
                {RECORDER_TYPES.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
            {sessionForm.recorder_type === "pdf_explainer" ? (
              <p className="day-state" style={{ margin: "4px 0" }}>
                After saving subject &amp; topic, the canvas will open for recording.
              </p>
            ) : null}
            {sessionForm.recorder_type === "uploader" ? (
              <div className="upload-inline-grid">
                <div className="upload-inline-item">
                  <label>Upload Audio/Video</label>
                  <input
                    className="task-select"
                    type="file"
                    accept="audio/*,video/*"
                    onChange={(e) => setUploadFiles((prev) => ({ ...prev, uploader: e.target.files?.[0] || null }))}
                  />
                </div>
              </div>
            ) : null}
            <textarea className="task-textarea" placeholder={isSimpRecord ? "Record note" : "Notes"} value={sessionForm.notes} onChange={(e) => setSessionForm((p) => ({ ...p, notes: e.target.value }))} />
            <div className="task-modal-actions">
              {sessionForm.recorder_type === "pdf_explainer" ? (
                <button className="btn-ticket" onClick={openExplainerFrame}>● Open Canvas</button>
              ) : sessionForm.recorder_type === "uploader" ? (
                <button className="btn-day" onClick={createAndUpload}>Create &amp; Upload</button>
              ) : (
                <button className="btn-ticket" onClick={createAndStart}>● Create &amp; Record</button>
              )}
            </div>
            </div>
            </div>
            ) : null}

            {isRecordingActive || recorderArming ? (
              <div
                className={`meet-overlay recording-${recordView}`}
                ref={recordingBoxRef}
                style={recordView === "float" && floatPos ? { left: floatPos.x, top: floatPos.y, right: "auto", bottom: "auto" } : undefined}
              >
                {/* Top bar */}
                <div className="meet-topbar" onPointerDown={recordView === "float" ? onFloatPointerDown : undefined}>
                  <div className="meet-topbar-left">
                    <span className="record-dot live" />
                    <span className="meet-elapsed">{formatDuration(elapsedDisplay)}</span>
                    <span className="meet-session-name">{recorderLabel}</span>
                    {uploadIndicator ? (
                      <span className={`meet-upload-status ${uploadIndicator.cls}`}>{uploadIndicator.label}</span>
                    ) : null}
                  </div>
                  <div className="meet-topbar-right" onPointerDown={(e) => e.stopPropagation()}>
                    {hasVideoMode || hasScreenMode ? (
                      <button className="meet-icon-sm" onClick={enterPip} title="Picture-in-Picture">⧉</button>
                    ) : null}
                    {recordView === "full" ? (
                      <button className="meet-icon-sm" onClick={() => setRecordView("float")} title="Float"><Icon name="fullscreen" size={15} /></button>
                    ) : (
                      <button className="meet-icon-sm" onClick={() => setRecordView("full")} title="Fullscreen"><Icon name="fullscreen" size={15} /></button>
                    )}
                  </div>
                </div>

                {/* Main stage */}
                <div className="meet-stage">
                  {/* Timer-only */}
                  {selectedModes.length === 0 ? (
                    <div className="meet-timer-stage">
                      <strong className="meet-big-timer">{formatDuration(elapsedDisplay)}</strong>
                      <span className="meet-timer-label">Study Timer</span>
                    </div>
                  ) : null}

                  {/* Audio only */}
                  {!isClosed && hasAudioMode && !hasVideoMode && !hasScreenMode ? (
                    <div className="meet-audio-stage">
                      <canvas ref={audioVizCanvasRef} className="meet-audio-viz" width={900} height={220} />
                      <div className="meet-audio-name">
                        <div className="meet-avatar-sm">{recorderInitial}</div>
                        {recorderLabel}
                      </div>
                    </div>
                  ) : null}

                  {/* Screen only */}
                  {!isClosed && hasScreenMode && !hasVideoMode ? (
                    <div className="meet-vcall-stage screen-active">
                      <video ref={screenPreviewRef} className="meet-screen-video" muted autoPlay playsInline />
                    </div>
                  ) : null}

                  {/* Video / call stage — camera always stays in DOM to preserve srcObject */}
                  {!isClosed && hasVideoMode ? (
                    <div className={`meet-vcall-stage${hasScreenMode && liveControls.sharingScreen ? " screen-active" : ""}`}>
                      {hasScreenMode ? (
                        <video ref={screenPreviewRef} className="meet-screen-video" muted autoPlay playsInline />
                      ) : null}
                      <div className={`meet-vcam${liveControls.cameraOff ? " cam-off" : ""}`}>
                        <video ref={cameraPreviewRef} muted autoPlay playsInline />
                        {liveControls.cameraOff ? (
                          <div className="meet-vcam-off">
                            <div className="meet-avatar">{recorderInitial}</div>
                            <span className="meet-cam-off-name">{recorderLabel}</span>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                </div>

                {/* Bottom toolbar */}
                <div className="meet-toolbar">
                  {canUseLiveControls && selectedRecorderType !== "pdf_explainer" ? (
                    <>
                      {hasAudioMode ? (
                        <button className={`meet-ctrl${liveControls.micMuted ? " ctrl-muted" : ""}`} onClick={toggleMute}
                          title={liveControls.micMuted ? "Unmute microphone" : "Mute microphone"}>
                          {liveControls.micMuted ? (
                            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <line x1="1" y1="1" x2="23" y2="23"/>
                              <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V5a3 3 0 0 0-5.94-.6"/>
                              <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"/>
                              <line x1="12" y1="19" x2="12" y2="22"/>
                              <line x1="8" y1="22" x2="16" y2="22"/>
                            </svg>
                          ) : (
                            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/>
                              <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                              <line x1="12" y1="19" x2="12" y2="22"/>
                              <line x1="8" y1="22" x2="16" y2="22"/>
                            </svg>
                          )}
                        </button>
                      ) : null}
                      {hasVideoMode ? (
                        <button className={`meet-ctrl${liveControls.cameraOff ? " ctrl-muted" : ""}`} onClick={toggleCamera}
                          title={liveControls.cameraOff ? "Turn on camera" : "Turn off camera"}>
                          {liveControls.cameraOff ? (
                            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M16 16v1a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2m5.66 0H14a2 2 0 0 1 2 2v3.34l1 1L23 7v10"/>
                              <line x1="1" y1="1" x2="23" y2="23"/>
                            </svg>
                          ) : (
                            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <polygon points="23 7 16 12 23 17 23 7"/>
                              <rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
                            </svg>
                          )}
                        </button>
                      ) : null}
                      {hasScreenMode && hasVideoMode ? (
                        <button className={`meet-ctrl${!liveControls.sharingScreen ? " ctrl-muted" : ""}`} onClick={toggleScreenShare}
                          title={liveControls.sharingScreen ? "Stop sharing screen" : "Share screen"}>
                          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <rect x="2" y="3" width="20" height="14" rx="2" ry="2"/>
                            <line x1="8" y1="21" x2="16" y2="21"/>
                            <line x1="12" y1="17" x2="12" y2="21"/>
                          </svg>
                        </button>
                      ) : null}
                    </>
                  ) : null}
                  {canPause ? (
                    <button className="meet-ctrl ctrl-neutral" onClick={pauseSession} title="Pause recording">
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="6" y="4" width="4" height="16"/>
                        <rect x="14" y="4" width="4" height="16"/>
                      </svg>
                    </button>
                  ) : null}
                  {canResume ? (
                    <button className="meet-ctrl ctrl-neutral" onClick={resumeSession} title="Resume recording">
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polygon points="5 3 19 12 5 21 5 3"/>
                      </svg>
                    </button>
                  ) : null}
                  {canStop ? (
                    <button className="meet-end" onClick={stopSession} disabled={stopping}>
                      {stopping ? "Finalizing…" : (selectedRecorderType === "audio" ? "End" : "Stop")}
                    </button>
                  ) : null}
                </div>
              </div>
            ) : null}

            {/* Explainer meet-frame */}
            {explainerFrameOpen ? (
              <div className="meet-overlay recording-full">
                {/* Top bar */}
                <div className="meet-topbar">
                  <div className="meet-topbar-left">
                    <span className="record-dot live" />
                    <span className="meet-elapsed">PDF Explainer</span>
                    {explainerFiles.length > 0 ? (
                      <div className="meet-exp-chips">
                        {explainerFiles.map((f, i) => (
                          <button key={i}
                            className={`meet-exp-chip${i === explainerFileIdx ? " active" : ""}`}
                            onClick={() => { setExplainerFileIdx(i); setUploadFiles((p) => ({ ...p, explainerAttachment: f.file })); }}>
                            {f.name}
                            <span className="meet-exp-chip-del" onClick={(e) => { e.stopPropagation();
                              setExplainerFiles((prev) => {
                                const next = prev.filter((_, j) => j !== i);
                                const newIdx = Math.min(explainerFileIdx, Math.max(0, next.length - 1));
                                setExplainerFileIdx(newIdx);
                                if (next.length > 0) setUploadFiles((p) => ({ ...p, explainerAttachment: next[newIdx]?.file || null }));
                                else setUploadFiles((p) => ({ ...p, explainerAttachment: null }));
                                return next;
                              });
                            }}><Icon name="close" size={14} /></span>
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  <div className="meet-topbar-right">
                    <button className="meet-icon-sm" onClick={() => setExplainerFrameOpen(false)} title="Close"><Icon name="close" size={14} /></button>
                  </div>
                </div>

                {/* Stage */}
                <div className="meet-stage">
                  {explainerFiles.length === 0 ? (
                    <button className="meet-upload-prompt" onClick={() => explainerFileInputRef.current?.click()}>
                      <Icon name="document" size={14} /> Upload PDF or Image to begin
                    </button>
                  ) : (
                    <ExplainerCanvas
                      ref={explainerCanvasRef}
                      files={explainerFiles}
                      fileIdx={explainerFileIdx}
                      zoom={explainerZoom}
                      onZoomChange={setExplainerZoom}
                      onRecordingChange={setExplainerRecording}
                      onRecorded={(blob) => {
                        setExplainerVideoBlob(blob);
                        setUploadFiles((p) => ({ ...p, explainerAttachment: explainerFiles[explainerFileIdx]?.file || null }));
                      }}
                    />
                  )}
                </div>

                {/* Toolbar */}
                <div className="meet-toolbar">
                  <label className="meet-ctrl" title="Upload PDF / Image" style={{ cursor: "pointer" }}>
                    <Icon name="document" size={14} />
                    <input
                      ref={explainerFileInputRef}
                      type="file"
                      accept="application/pdf,image/*"
                      style={{ display: "none" }}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        const url = URL.createObjectURL(file);
                        const kind = getAttachmentKindFromName(file.name);
                        setExplainerFiles((prev) => {
                          const next = [...prev, { file, url, kind, name: file.name }];
                          setExplainerFileIdx(next.length - 1);
                          return next;
                        });
                        setUploadFiles((prev) => ({ ...prev, explainerAttachment: file }));
                        e.target.value = "";
                      }}
                    />
                  </label>
                  {explainerFiles.length > 0 ? (
                    !explainerRecording ? (
                      <button className="meet-ctrl" style={{ background: "rgba(239,68,68,0.18)", fontSize: 18 }}
                        onClick={() => explainerCanvasRef.current?.startRecord()} title="Start recording">
                        <Icon name="record" size={15} />
                      </button>
                    ) : (
                      <button className="meet-ctrl ctrl-muted" style={{ fontSize: 18 }}
                        onClick={() => explainerCanvasRef.current?.stopRecord()} title="Stop recording">
                        <Icon name="stop" size={15} />
                      </button>
                    )
                  ) : null}
                  {explainerVideoBlob ? (
                    <span className="meet-exp-ready"><Icon name="check" size={14} /> {(explainerVideoBlob.size / 1024 / 1024).toFixed(1)} MB</span>
                  ) : null}
                  <button
                    className="meet-end"
                    disabled={!explainerDoneReady || explainerDoneLoading}
                    onClick={async () => { await createExplainerSessionWithUploads(); setExplainerFrameOpen(false); }}
                  >
                    {explainerDoneLoading ? "Saving…" : "Done"}
                  </button>
                </div>
              </div>
            ) : null}

            {orderedSessionList.length === 0 ? (
              <p className="day-state">No recordings yet. Tap <b>Record</b> to start your first one.</p>
            ) : (
              groupedSessions.map((group) => (
              <div key={group.key} className="session-day-group">
                <div className="session-day-heading">{fmtDayHeading(group.key)}</div>
                <div className="session-grid">
                {group.items.map((session) => {
                  const running = ["started", "resumed", "paused"].includes(session.status);
                  const finalizing = isSessionFinalizing(session);
                  const canPlay = Boolean(getPrimaryPlaybackType(session)) && !finalizing;
                  const durationSecs = getSessionDurationSeconds(session);
                  return (
                    <div
                      key={session._id}
                      className={`session-card ${selectedSession?._id === session._id ? "active" : ""} ${running ? "running" : ""}`}
                      onClick={() => selectSession(session)}
                    >
                      <div className="session-card-head">
                        <strong className="session-card-title">{session.subject}</strong>
                        <div className="session-actions" onClick={(e) => e.stopPropagation()}>
                          <button
                            className="ellipsis-btn session-ellipsis-btn"
                            onClick={() => setOpenSessionMenuId((prev) => (prev === session._id ? "" : session._id))}
                            aria-label="Open session actions"
                            title="Session actions"
                          >
                            ⋮
                          </button>
                          {openSessionMenuId === session._id ? (
                            <div className="menu-dropdown session-actions-menu">
                              <button
                                className="menu-item"
                                onClick={() => editSessionNote(session)}
                              >
                                Edit Note
                              </button>
                              <button
                                className="menu-item"
                                onClick={() => downloadRecording(session)}
                                disabled={!canPlay}
                                title={canPlay ? "Download recording" : "No recording available yet"}
                              >
                                Download
                              </button>
                              <button
                                className="menu-item session-menu-delete"
                                onClick={() => deleteSession(session)}
                                disabled={Boolean(deletingSessionIds[session._id]) || running}
                                title={running ? "Stop session before deleting" : "Delete session from app data (keeps S3 file)"}
                              >
                                {deletingSessionIds[session._id] ? "Deleting..." : "Delete Session"}
                              </button>
                            </div>
                          ) : null}
                        </div>
                      </div>
                      <p className="session-card-topic">{session.topic}</p>
                      <div className="session-card-meta">
                        <span className="session-chip">{capitalize(getRecorderType(session)).replace("_", " ")}</span>
                        <span className="session-chip">{session.session_type}</span>
                        {durationSecs > 0 ? <span className="session-chip"><Icon name="timer" size={14} /> {formatDuration(durationSecs)}</span> : null}
                      </div>
                      {session.notes ? <p className="session-card-note"><Icon name="note" size={14} /> {session.notes}</p> : null}
                      <div className="session-card-actions" onClick={(e) => e.stopPropagation()}>
                        <button
                          className="btn-day"
                          onClick={() => openPlayer(session)}
                          disabled={!canPlay}
                          title={canPlay ? "Play recording" : (finalizing ? "Finalizing recording…" : "No recording uploaded yet")}
                        >
                          {finalizing ? <><Icon name="clock" size={15} /> Finalizing…</> : <><Icon name="play" size={15} /> Play</>}
                        </button>
                      </div>
                    </div>
                  );
                })}
                </div>
              </div>
              ))
            )}
          </>
        )}
      </section>
      {uploadOffline ? (
        <div className="offline-overlay">
          <div className="offline-card">
            <div className="offline-spinner" />
            <h3 className="offline-title">Internet problem — not able to upload</h3>
            <p className="offline-sub">
              Recording is buffered and paused. Trying to reconnect…
            </p>
            <p className="offline-countdown">
              Will stop &amp; save what we have in <strong>{formatDuration(offlineRemainingSecs)}</strong>
            </p>
          </div>
        </div>
      ) : null}
      {offlineStopped ? (
        <div className="offline-overlay">
          <div className="offline-card">
            <div className="offline-stop-icon"><Icon name="warning" size={14} /></div>
            <h3 className="offline-title">Recording stopped</h3>
            <p className="offline-sub">
              Your internet was down for too long, so the recording was stopped and
              saved up to the last point that uploaded.
            </p>
            <button className="btn-day" onClick={() => setOfflineStopped(false)}>OK</button>
          </div>
        </div>
      ) : null}
      {playerModal.open ? (
        <div className="vlc-backdrop" onClick={closePlayer}>
          <div className="vlc-player" onClick={(e) => e.stopPropagation()}>
            {/* Title bar */}
            <div className="vlc-titlebar">
              <span className="vlc-title">{playerModal.title || "Player"}</span>
              <button className="vlc-close-btn" onClick={closePlayer}><Icon name="close" size={14} /></button>
            </div>
            {/* Media area */}
            <div className="vlc-media-area" ref={playerWrapRef}>
              {playerModal.loading ? (
                <div className="vlc-placeholder">Loading recording…</div>
              ) : playerModal.url ? (
                playerModal.mediaType === "audio" ? (
                  <>
                    <audio
                      ref={playerMediaRef}
                      src={playerModal.url}
                      autoPlay
                      preload="metadata"
                      onTimeUpdate={onPlayerTimeUpdate}
                      onDurationChange={onPlayerDurationChange}
                      onPlay={() => setPlayerPlaying(true)}
                      onPause={() => setPlayerPlaying(false)}
                    />
                    <div className="vlc-audio-vis">
                      <div className="vlc-pulse-rings">
                        {[0, 1, 2, 3].map((i) => (
                          <span key={i} className="vlc-ring"
                            style={{ width: `${44 + i * 32}px`, height: `${44 + i * 32}px`, animationDelay: `${i * 0.4}s`, animationPlayState: playerPlaying ? "running" : "paused" }} />
                        ))}
                        <span className="vlc-ring-note"><Icon name="music" size={14} /></span>
                      </div>
                      <div className="vlc-audio-title">{playerModal.title}</div>
                    </div>
                  </>
                ) : (
                  <video
                    ref={playerMediaRef}
                    className="vlc-video-el"
                    src={playerModal.streaming ? undefined : playerModal.url}
                    autoPlay
                    playsInline
                    preload="metadata"
                    onTimeUpdate={onPlayerTimeUpdate}
                    onDurationChange={onPlayerDurationChange}
                    onPlay={() => setPlayerPlaying(true)}
                    onPause={() => setPlayerPlaying(false)}
                  />
                )
              ) : (
                <div className="vlc-placeholder">No playable media.</div>
              )}
            </div>
            {/* Controls */}
            {!playerModal.loading && playerModal.url ? (
              <div className="vlc-controls">
                <div className="vlc-seek-row">
                  <input type="range" className="vlc-seek" min="0" max={playerDuration || 0} step="0.5"
                    value={playerCurrentTime} onChange={onPlayerSeek} />
                  <span className="vlc-time">{fmtSecs(playerCurrentTime)} / {fmtSecs(playerDuration)}</span>
                </div>
                <div className="vlc-btn-row">
                  <button className="vlc-btn vlc-play-btn" onClick={togglePlayerPlay}>
                    {playerPlaying ? <Icon name="pause" size={15} /> : <Icon name="play" size={15} />}
                  </button>
                  <div className="vlc-vol-group">
                    <span><Icon name="audio" size={15} /></span>
                    <input type="range" className="vlc-vol" min="0" max="1" step="0.05"
                      value={playerVolume} onChange={onPlayerVolume} />
                  </div>
                  <select className="vlc-speed-sel" value={String(playerRate)}
                    onChange={(e) => changePlayerSpeed(Number(e.target.value))}>
                    <option value="0.5">0.5×</option>
                    <option value="0.75">0.75×</option>
                    <option value="1">1×</option>
                    <option value="1.25">1.25×</option>
                    <option value="1.5">1.5×</option>
                    <option value="2">2×</option>
                  </select>
                  <button className="vlc-btn" onClick={togglePlayerFullscreen} title="Fullscreen"><Icon name="fullscreen" size={15} /></button>
                  <button className="vlc-btn" onClick={() => triggerDownload(playerModal.sid, playerModal.mediaType)} title="Download"><Icon name="download" size={14} /></button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
      {explainerModalOpen ? (
        <div className="task-modal-overlay" onClick={() => setExplainerModalOpen(false)}>
          <div className="task-modal explainer-modal" onClick={(e) => e.stopPropagation()}>
            <div className="recording-player-head">
              <h3>PDF Explainer</h3>
              <button className="btn-cancel" onClick={() => setExplainerModalOpen(false)}>Close</button>
            </div>
            <div className="explainer-zoom-bar">
              <button className="vlc-btn" onClick={() => setExplainerZoom((z) => Math.max(0.25, +(z - 0.1).toFixed(2)))}>−</button>
              <span className="explainer-zoom-val">{Math.round(explainerZoom * 100)}%</span>
              <button className="vlc-btn" onClick={() => setExplainerZoom((z) => Math.min(4, +(z + 0.1).toFixed(2)))}>+</button>
              <button className="vlc-btn" onClick={() => setExplainerZoom(1)}>Reset</button>
            </div>
            <div className="explainer-viewer explainer-viewer-scroll">
              <div style={{ transform: `scale(${explainerZoom})`, transformOrigin: "top center", transition: "transform 0.15s" }}>
                {attachmentKind === "pdf" && playbackUrls.attachment ? (
                  <iframe title="Explainer PDF" src={playbackUrls.attachment} className="explainer-asset" />
                ) : attachmentKind === "image" && playbackUrls.attachment ? (
                  <img src={playbackUrls.attachment} alt="Explainer" className="explainer-asset" />
                ) : (
                  <p className="day-state">Upload PDF/image to preview here.</p>
                )}
              </div>
            </div>
            <div className="explainer-audio-wrap">
              {playbackUrls.audio ? (
                <audio className="session-player" controls preload="metadata" src={playbackUrls.audio} />
              ) : (
                <button className="btn-day secondary" onClick={() => loadPlayback("audio")}>Load Audio</button>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
