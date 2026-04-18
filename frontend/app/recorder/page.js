"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import MainMenu from "../components/MainMenu";
import ActivityInternalMenu from "../components/ActivityInternalMenu";
import { AGENT_PENDING_RECORDER_ACTION_KEY, AGENT_RECORDER_EVENT, AGENT_RECORDER_STATUS_EVENT } from "../lib/agent/constants";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "";
const NOTICE_TTL_MS = 15000;
const MULTIPART_COMPLETE_RETRIES = 3;
const MULTIPART_COMPLETE_RETRY_DELAY_MS = 1200;
const RECORDER_FLUSH_INTERVAL_MS = 1500;
const MULTIPART_FILE_PART_BYTES = 6 * 1024 * 1024;
const GLOBAL_USER_STORAGE_KEY = "global_user_id";
const SESSION_MEDIA_TYPES = ["audio", "video", "screen", "attachment"];
const RECORDER_TYPES = [
  { value: "time", label: "Time" },
  { value: "audio", label: "Audio" },
  { value: "video", label: "Video" },
  { value: "call", label: "Call (Video + Screen)" },
  { value: "pdf_explainer", label: "PDF Explainer" },
  { value: "uploader", label: "Uploader" }
];
const OTHER_VALUE = "__other__";
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

function getRecorderType(session) {
  if (session?.recorder_type) return session.recorder_type;
  const modes = session?.modes || [];
  if (modes.includes("video") && modes.includes("screen")) return "call";
  if (modes.includes("video")) return "video";
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
    user_id: "kapil",
    exam_type: "prelims",
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
  const [sessionLoading, setSessionLoading] = useState(false);
  const [sessionError, setSessionError] = useState("");
  const [deletingSessionIds, setDeletingSessionIds] = useState({});
  const [openSessionMenuId, setOpenSessionMenuId] = useState("");
  const [pendingFinalizeModes, setPendingFinalizeModes] = useState([]);
  const [finalizeRetrying, setFinalizeRetrying] = useState(false);
  const [selectedSession, setSelectedSession] = useState(null);
  const [timerState, setTimerState] = useState({ running: false, startedAt: 0, baseElapsed: 0 });
  const [nowTick, setNowTick] = useState(Date.now());
  const [playbackUrls, setPlaybackUrls] = useState({ audio: "", video: "", screen: "", attachment: "" });
  const [playbackRates, setPlaybackRates] = useState({ video: 1, screen: 1 });
  const [explainerModalOpen, setExplainerModalOpen] = useState(false);
  const [uploadFiles, setUploadFiles] = useState({ uploader: null, explainerAttachment: null, explainerAudio: null });
  const [explainerAudioSource, setExplainerAudioSource] = useState("upload");
  const [explainerRecorderStatus, setExplainerRecorderStatus] = useState("idle");
  const [explainerRecordedBlob, setExplainerRecordedBlob] = useState(null);
  const [explainerDoneLoading, setExplainerDoneLoading] = useState(false);
  const [explainerAttachmentPreviewUrl, setExplainerAttachmentPreviewUrl] = useState("");
  const [explainerUploadedAudioPreviewUrl, setExplainerUploadedAudioPreviewUrl] = useState("");
  const [explainerRecordedAudioPreviewUrl, setExplainerRecordedAudioPreviewUrl] = useState("");
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
  const explainerRecorderRef = useRef(null);
  const explainerRecorderStreamRef = useRef(null);
  const explainerRecorderChunksRef = useRef([]);
  const recorderFlushTimersRef = useRef({});

  const applyGlobalUser = async (nextUser) => {
    const user = nextUser === "divya" ? "divya" : "kapil";
    setSessionForm((p) => ({ ...p, user_id: user }));
    if (API_BASE_URL) {
      setMissionSelectorLoading(true);
      try {
        const optionsRes = await fetch(`${API_BASE_URL}/mission/options?user_id=${encodeURIComponent(user)}`);
        if (optionsRes.ok) {
          const optionsData = await optionsRes.json();
          setMissionSelector({ exam_options: optionsData.exam_options || [], catalog: optionsData.catalog || {}, plan: optionsData.plan || {} });
        } else {
          setMissionSelector({ exam_options: [], catalog: {}, plan: {} });
        }
      } catch (_) {
        setMissionSelector({ exam_options: [], catalog: {}, plan: {} });
      } finally {
        setMissionSelectorLoading(false);
      }
    } else {
      setMissionSelector({ exam_options: [], catalog: {}, plan: {} });
      setMissionSelectorLoading(false);
    }
    await fetchSessions(user);
  };

  useEffect(() => {
    if (!timerState.running) return;
    const id = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, [timerState.running]);

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
    if (typeof window === "undefined") return;
    const initialUser = (window.localStorage.getItem(GLOBAL_USER_STORAGE_KEY) || "kapil").toLowerCase() === "divya" ? "divya" : "kapil";
    applyGlobalUser(initialUser).catch(() => {});
    const onGlobalUser = (e) => {
      const nextUser = e?.detail?.userId;
      applyGlobalUser(nextUser).catch(() => {});
    };
    window.addEventListener("global-user-change", onGlobalUser);
    return () => window.removeEventListener("global-user-change", onGlobalUser);
  }, []);

  useEffect(() => {
    if (!activeExamOptions.length) return;
    const validExamValues = new Set(activeExamOptions.map((o) => o.value));
    setSessionForm((prev) => {
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
    if (!uploadFiles.explainerAttachment) {
      setExplainerAttachmentPreviewUrl("");
      return;
    }
    const url = URL.createObjectURL(uploadFiles.explainerAttachment);
    setExplainerAttachmentPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [uploadFiles.explainerAttachment]);

  useEffect(() => {
    if (!uploadFiles.explainerAudio) {
      setExplainerUploadedAudioPreviewUrl("");
      return;
    }
    const url = URL.createObjectURL(uploadFiles.explainerAudio);
    setExplainerUploadedAudioPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [uploadFiles.explainerAudio]);

  useEffect(() => {
    if (!explainerRecordedBlob) {
      setExplainerRecordedAudioPreviewUrl("");
      return;
    }
    const url = URL.createObjectURL(explainerRecordedBlob);
    setExplainerRecordedAudioPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [explainerRecordedBlob]);

  useEffect(() => () => {
    if (explainerRecorderRef.current && explainerRecorderRef.current.state !== "inactive") {
      try {
        explainerRecorderRef.current.stop();
      } catch (_) {}
    }
    (explainerRecorderStreamRef.current?.getTracks?.() || []).forEach((t) => t.stop());
  }, []);

  useEffect(() => {
    bindPreview(cameraPreviewRef, streamRefs.current.video || null);
    bindPreview(screenPreviewRef, streamRefs.current.screen || null);
    bindPreview(combinedPreviewRef, compositeStreamRef.current || null);
  }, [selectedSession?.status, selectedSession?._id, timerState.running, liveControls.sharingScreen]);

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

  const fetchSessions = async (userValue = sessionForm.user_id) => {
    if (!API_BASE_URL || !userValue) return [];
    setSessionLoading(true);
    setSessionError("");
    try {
      const res = await fetch(`${API_BASE_URL}/sessions?user_id=${encodeURIComponent(userValue)}`);
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`Sessions API failed: ${res.status} ${txt}`);
      }
      const data = await res.json();
      const sessions = (Array.isArray(data.sessions) ? data.sessions : [])
        .map((row) => normalizeSessionDoc(row))
        .filter((row) => Boolean(row?._id));
      setSessionList(sessions);
      if (selectedSession) {
        const selectedId = resolveSessionId(selectedSession);
        const refreshed = sessions.find((s) => s._id === selectedId);
        if (refreshed) setSelectedSession(refreshed);
      }
      return sessions;
    } catch (err) {
      setSessionError(String(err.message || err));
      return [];
    } finally {
      setSessionLoading(false);
    }
  };

  const createSession = async () => {
    if (!API_BASE_URL) return;
    if (sessionForm.recorder_type === "pdf_explainer") {
      setSessionError("For PDF Explainer, use the Done button after selecting PDF/image and audio.");
      return;
    }
    setSessionError("");
    const { subject, topic } = buildSessionSubjectTopic();
    const notes = sessionForm.notes.trim();
    if (!subject || !topic) {
      setSessionError("Subject and topic are required.");
      return;
    }
    try {
      const testRef = buildSessionTestRef();
      const payload = {
        user_id: sessionForm.user_id,
        subject,
        topic,
        session_type: sessionForm.session_type,
        recorder_type: sessionForm.recorder_type,
        notes,
        ...testRef,
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
      const normalized = normalizeSessionDoc(data.session);
      if (!normalized?._id) {
        throw new Error("Create session failed: session id missing in response");
      }
      setSelectedSession(normalized);
      setPendingFinalizeModes([]);
      setTimerState({ running: false, startedAt: 0, baseElapsed: normalized?.elapsed_seconds || 0 });
      setPlaybackUrls({ audio: "", video: "", screen: "", attachment: "" });
      await fetchSessions(sessionForm.user_id);
    } catch (err) {
      setSessionError(String(err.message || err));
    }
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
      const shouldStopAndSwitch = window.confirm(
        "Current session is active in this tab. Stop it, upload final part, and switch to selected session?"
      );
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
    setTimerState({ running: false, startedAt: 0, baseElapsed: normalized?.elapsed_seconds || 0 });
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
      const res = await fetch(`${API_BASE_URL}/sessions/${sid}/delete`, { method: "POST" });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`Delete session failed: ${res.status} ${txt}`);
      }
      if (resolveSessionId(selectedSession) === sid) {
        setSelectedSession(null);
        setPendingFinalizeModes([]);
        setTimerState({ running: false, startedAt: 0, baseElapsed: 0 });
        setPlaybackUrls({ audio: "", video: "", screen: "", attachment: "" });
        broadcastRecorderStatus("idle");
      }
      await fetchSessions(session?.user_id || sessionForm.user_id);
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

    let lastErr = null;
    for (let attempt = 1; attempt <= MULTIPART_COMPLETE_RETRIES; attempt += 1) {
      const completeRes = await fetch(`${API_BASE_URL}/sessions/${selectedSession._id}/multipart/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          media_type: mode,
          upload_id: state.uploadId,
          parts: state.completedParts
        })
      });
      if (completeRes.ok) {
        return;
      }
      const txt = await completeRes.text();
      lastErr = new Error(`Multipart complete failed: ${completeRes.status} ${txt}`);
      if (attempt < MULTIPART_COMPLETE_RETRIES) {
        await new Promise((resolve) => setTimeout(resolve, MULTIPART_COMPLETE_RETRY_DELAY_MS * attempt));
      }
    }
    throw lastErr || new Error("Multipart complete failed");
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
    const mimeType = getMimeForMode(mode);
    const rec = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
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
    rec.onerror = () => {
      clearFlushTimer();
    };
    recorderRefs.current[mode] = rec;
    rec.start();
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
      screen: createEmptyMultipartState(),
      attachment: createEmptyMultipartState()
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

  const pushSessionStatus = async (status, options = {}, sessionOverride = null) => {
    const activeSession = normalizeSessionDoc(sessionOverride || selectedSession);
    const sid = resolveSessionId(activeSession);
    if (!API_BASE_URL || !sid) return;
    const elapsed = timerState.running
      ? timerState.baseElapsed + Math.floor((Date.now() - timerState.startedAt) / 1000)
      : timerState.baseElapsed;
    try {
      const res = await fetch(`${API_BASE_URL}/sessions/${sid}/status`, {
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
      if (updatedSession?._id) {
        setSelectedSession(updatedSession);
      }
      broadcastRecorderStatus(updatedSession?.status || status);
      setTimerState({ running: false, startedAt: 0, baseElapsed: updatedSession?.elapsed_seconds || elapsed });
      await fetchSessions(updatedSession?.user_id || activeSession?.user_id || sessionForm.user_id);
    } catch (err) {
      setSessionError(String(err.message || err));
      throw err;
    }
  };

  const startSession = async (sessionOverride = null) => {
    let activeSession = sessionOverride || selectedSession;
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
        const oneRes = await fetch(`${API_BASE_URL}/sessions/${activeSessionId}`);
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

    try {
      await initRecorders(activeSession.modes || []);
    } catch (err) {
      stopAndReleaseStreams();
      setSessionError(`Recorder permission/device error: ${String(err.message || err)}`);
      return;
    }
    try {
      await pushSessionStatus("started", {}, activeSession);
    } catch (err) {
      const msg = String(err?.message || err || "");
      const conflict = msg.includes("Another session is active in another tab/device");
      if (conflict) {
        const shouldForceStop = window.confirm(
          "In another tab/device, you have recorder on. Are you willing to stop previous session to continue here?"
        );
        if (!shouldForceStop) {
          stopAndReleaseStreams();
          recorderRefs.current = {};
          return;
        }
        try {
          await pushSessionStatus("started", { forceStopPrevious: true }, activeSession);
        } catch (_) {
          stopAndReleaseStreams();
          recorderRefs.current = {};
          return;
        }
      } else {
        stopAndReleaseStreams();
        recorderRefs.current = {};
        return;
      }
    }
    setTimerState({ running: true, startedAt: Date.now(), baseElapsed: activeSession?.elapsed_seconds || 0 });
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
    setTimerState({ running: true, startedAt: Date.now(), baseElapsed: base });
  };

  const stopSession = async () => {
    if (!selectedSession || !["started", "paused", "resumed"].includes(selectedSession.status)) return true;
    try {
      Object.values(recorderRefs.current).forEach((rec) => {
        if (rec && rec.state !== "inactive") {
          try {
            rec.requestData();
          } catch (_) {}
        }
      });
      await stopRecordersOnly();
      const failedModes = [];
      await Promise.all(SESSION_MEDIA_TYPES.map(async (mode) => {
        try {
          await completeMultipartForMode(mode);
        } catch (_) {
          failedModes.push(mode);
        }
      }));
      stopAndReleaseStreams();
      recorderRefs.current = {};
      try {
        await pushSessionStatus("stopped");
      } catch (_) {}
      if (failedModes.length === 0) {
        multipartUploadsRef.current = {
          audio: createEmptyMultipartState(),
          video: createEmptyMultipartState(),
          screen: createEmptyMultipartState(),
          attachment: createEmptyMultipartState()
        };
        setPendingFinalizeModes([]);
        return true;
      } else {
        setPendingFinalizeModes(failedModes);
        setSessionError(
          `Session stopped, but final upload step failed for: ${failedModes.join(", ")}. Use "Retry Pending Uploads".`
        );
        return false;
      }
    } catch (err) {
      setSessionError(String(err.message || err));
      return false;
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
        const fetched = await fetchSessions(sessionForm.user_id);
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
          user_id: sessionForm.user_id,
          subject: resolvedSubject,
          topic: resolvedTopic,
          session_type: ["study", "revision", "analysis", "test"].includes(sessionType) ? sessionType : "study",
          recorder_type: recorderType || "audio",
          notes: incomingNotes || `Agent-triggered ${recorderType || "audio"} session`,
        };
        const res = await fetch(`${API_BASE_URL}/sessions`, {
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
          await fetchSessions(sessionForm.user_id);
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
  }, [selectedSession, sessionList, sessionForm.user_id]);

  const retryPendingUploads = async () => {
    if (!selectedSession?._id || pendingFinalizeModes.length === 0) return;
    setFinalizeRetrying(true);
    try {
      const failedModes = [];
      for (const mode of pendingFinalizeModes) {
        try {
          await completeMultipartForMode(mode);
        } catch (_) {
          failedModes.push(mode);
        }
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
        setPendingFinalizeModes(failedModes);
        setSessionError(`Retry still pending for: ${failedModes.join(", ")}`);
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

  const uploadMediaForSession = async (sessionId, mediaType, input, fallbackName = "") => {
    if (!API_BASE_URL || !sessionId || !input) return;
    const inputName = input.name || fallbackName || `${mediaType}.webm`;
    const extension = inputName.split(".").pop()?.toLowerCase() || "webm";
    const contentType = input.type || "application/octet-stream";

    const uploadMediaMultipart = async () => {
      const startRes = await fetch(`${API_BASE_URL}/sessions/${sessionId}/multipart/start`, {
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

          const presignRes = await fetch(`${API_BASE_URL}/sessions/${sessionId}/multipart/presign-part`, {
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

        const completeRes = await fetch(`${API_BASE_URL}/sessions/${sessionId}/multipart/complete`, {
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
          await fetch(`${API_BASE_URL}/sessions/${sessionId}/multipart/abort`, {
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

    const presignRes = await fetch(`${API_BASE_URL}/sessions/${sessionId}/presign`, {
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

  const handleUploaderSubmit = async () => {
    try {
      const file = uploadFiles.uploader;
      if (!file) {
        setSessionError("Select an audio/video file first.");
        return;
      }
      if (!selectedSession?._id) {
        setSessionError("Please select a session first.");
        return;
      }
      const mediaType = (file.type || "").startsWith("audio/") ? "audio" : "video";
      await uploadMediaForSession(selectedSession._id, mediaType, file, file.name);
      setUploadFiles((prev) => ({ ...prev, uploader: null }));
      await fetchSessions(selectedSession?.user_id || sessionForm.user_id);
      await loadPlayback(mediaType);
    } catch (err) {
      setSessionError(String(err.message || err));
    }
  };

  const startExplainerAudioRecord = async () => {
    try {
      if (explainerRecorderStatus === "recording" || explainerRecorderStatus === "paused") return;
      const mic = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      explainerRecorderStreamRef.current = mic;
      explainerRecorderChunksRef.current = [];
      setExplainerRecordedBlob(null);
      const explainerMime = getMimeForMode("audio");
      const rec = explainerMime ? new MediaRecorder(mic, { mimeType: explainerMime }) : new MediaRecorder(mic);
      rec.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) explainerRecorderChunksRef.current.push(e.data);
      };
      rec.onstop = () => {
        const blob = new Blob(explainerRecorderChunksRef.current, { type: explainerMime || "audio/webm" });
        setExplainerRecordedBlob(blob.size > 0 ? blob : null);
        (explainerRecorderStreamRef.current?.getTracks?.() || []).forEach((t) => t.stop());
        explainerRecorderStreamRef.current = null;
        setExplainerRecorderStatus("stopped");
      };
      explainerRecorderRef.current = rec;
      rec.start();
      setExplainerRecorderStatus("recording");
      setSessionError("");
    } catch (err) {
      setSessionError(`Audio record failed: ${String(err.message || err)}`);
    }
  };

  const pauseExplainerAudioRecord = () => {
    const rec = explainerRecorderRef.current;
    if (!rec || rec.state !== "recording") return;
    try {
      rec.pause();
      setExplainerRecorderStatus("paused");
    } catch (_) {}
  };

  const resumeExplainerAudioRecord = () => {
    const rec = explainerRecorderRef.current;
    if (!rec || rec.state !== "paused") return;
    try {
      rec.resume();
      setExplainerRecorderStatus("recording");
    } catch (_) {}
  };

  const stopExplainerAudioRecord = async () => {
    const rec = explainerRecorderRef.current;
    if (!rec || rec.state === "inactive") {
      setExplainerRecorderStatus("stopped");
      return;
    }
    await new Promise((resolve) => {
      rec.addEventListener("stop", () => resolve(), { once: true });
      try {
        rec.stop();
      } catch (_) {
        resolve();
      }
    });
  };

  const createExplainerSessionWithUploads = async () => {
    if (!API_BASE_URL) return;
    const { subject, topic } = buildSessionSubjectTopic();
    const notes = sessionForm.notes.trim();
    if (!subject || !topic) {
      setSessionError("Subject and topic are required.");
      return;
    }
    if (!uploadFiles.explainerAttachment) {
      setSessionError("Please select PDF/image for explainer.");
      return;
    }
    const hasUploadAudio = explainerAudioSource === "upload" && uploadFiles.explainerAudio;
    const hasRecordedAudio = explainerAudioSource === "record" && explainerRecordedBlob;
    if (!hasUploadAudio && !hasRecordedAudio) {
      setSessionError("Please upload audio or record audio for explainer.");
      return;
    }
    try {
      setExplainerDoneLoading(true);
      setSessionError("");
      const testRef = buildSessionTestRef();
      const payload = {
        user_id: sessionForm.user_id,
        subject,
        topic,
        session_type: sessionForm.session_type,
        recorder_type: "pdf_explainer",
        notes,
        ...testRef,
      };
      const createRes = await fetch(`${API_BASE_URL}/sessions`, {
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
      await uploadMediaForSession(sessionId, "attachment", uploadFiles.explainerAttachment, uploadFiles.explainerAttachment.name);
      if (hasUploadAudio) {
        await uploadMediaForSession(sessionId, "audio", uploadFiles.explainerAudio, uploadFiles.explainerAudio.name);
      } else if (hasRecordedAudio) {
        await uploadMediaForSession(sessionId, "audio", explainerRecordedBlob, "explainer-audio.webm");
      }

      const oneRes = await fetch(`${API_BASE_URL}/sessions/${sessionId}`);
      if (oneRes.ok) {
        const oneData = await oneRes.json();
        setSelectedSession(normalizeSessionDoc(oneData.session || createData.session));
      } else {
        setSelectedSession(normalizeSessionDoc(createData.session));
      }
      setTimerState({ running: false, startedAt: 0, baseElapsed: createData.session?.elapsed_seconds || 0 });
      await fetchSessions(sessionForm.user_id);
      setUploadFiles((prev) => ({ ...prev, explainerAttachment: null, explainerAudio: null }));
      setExplainerRecordedBlob(null);
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
  const sessionStatus = selectedSession?.status || "created";
  const isClosed = sessionStatus === "stopped";
  const canStart = sessionStatus === "created";
  const canPause = sessionStatus === "started" || sessionStatus === "resumed";
  const canResume = sessionStatus === "paused";
  const canStop = sessionStatus === "started" || sessionStatus === "paused" || sessionStatus === "resumed";
  const selectedModes = selectedSession?.modes || [];
  const selectedRecorderType = getRecorderType(selectedSession);
  const hasVideoMode = selectedModes.includes("video");
  const hasScreenMode = selectedModes.includes("screen");
  const hasAudioMode = selectedModes.includes("audio") || hasVideoMode || hasScreenMode;
  const canUseLiveControls = canPause || canResume;
  const recorderLabel = capitalize(selectedSession?.user_id || sessionForm.user_id || "Recorder");
  const recorderInitial = recorderLabel.charAt(0) || "R";
  const uploadedMedia = SESSION_MEDIA_TYPES.filter((m) => Boolean((selectedSession?.uploads?.[m] || {}).key));
  const attachmentKey = selectedSession?.uploads?.attachment?.key || "";
  const attachmentKind = getAttachmentKindFromKey(attachmentKey);
  const explainerAttachmentKind = getAttachmentKindFromName(uploadFiles.explainerAttachment?.name || "");
  const explainerAttachmentReady = Boolean(uploadFiles.explainerAttachment);
  const explainerAudioReady = explainerAudioSource === "upload"
    ? Boolean(uploadFiles.explainerAudio)
    : Boolean(explainerRecordedBlob);
  const explainerDoneReady = explainerAttachmentReady && explainerAudioReady;
  const effectiveExamType = sessionForm.exam_type === OTHER_VALUE ? sessionForm.exam_type_other.trim().toLowerCase() : sessionForm.exam_type;
  const currentSubjectOptions = effectiveExamType ? getSubjectsForExam(effectiveExamType, activeCatalog) : [];
  const effectiveSubject = sessionForm.subject === OTHER_VALUE ? sessionForm.subject_other.trim() : sessionForm.subject;
  const currentTopicOptions = effectiveExamType && effectiveSubject ? getTopicsForSelection(effectiveExamType, effectiveSubject, activeCatalog) : [];
  const selectedSubjectValue = sessionForm.subject === OTHER_VALUE ? sessionForm.subject_other : sessionForm.subject;
  const selectedTopicValue = sessionForm.topic === OTHER_VALUE ? sessionForm.topic_other : sessionForm.topic;
  // Keep list order stable as returned by backend (created_at desc),
  // so selecting a session in viewer does not reshuffle the list.
  const orderedSessionList = sessionList;

  return (
    <main className="app-shell">
      <div className="bg-orb orb-1" />
      <div className="bg-orb orb-2" />
      <header className="hero">
        <MainMenu active="recorder" />
        <ActivityInternalMenu active="recorder" />
        <h1>Session Recorder</h1>
        <p className="subtext">Create, run, and upload study recording sessions.</p>
      </header>

      <section className="milestone-panel session-panel">
        {!API_BASE_URL ? (
          <p className="api-state warn">Backend URL needed for session recorder APIs.</p>
        ) : (
          <>
            {missionSelectorLoading ? (
              <p className="day-state">Loading mission options...</p>
            ) : activeExamOptions.length === 0 ? (
              <p className="api-state warn">Mission options not available for this user yet.</p>
            ) : (
              <>
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
              <select className="task-select" value={sessionForm.recorder_type} onChange={(e) => setSessionForm((p) => ({ ...p, recorder_type: e.target.value }))}>
                {RECORDER_TYPES.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
            {sessionForm.recorder_type === "pdf_explainer" ? (
              <div className="explainer-setup-card">
                <h4>Explainer Setup</h4>
                <div className="recording-player-item explainer-live-preview-card">
                  <div className="recording-player-head">
                    <strong>LIVE EXPLAINER PREVIEW</strong>
                  </div>
                  <div className="explainer-viewer">
                    {explainerAttachmentKind === "pdf" && explainerAttachmentPreviewUrl ? (
                      <iframe title="Selected PDF Preview" src={explainerAttachmentPreviewUrl} className="explainer-asset" />
                    ) : null}
                    {explainerAttachmentKind === "image" && explainerAttachmentPreviewUrl ? (
                      <img src={explainerAttachmentPreviewUrl} alt="Selected explainer" className="explainer-asset" />
                    ) : null}
                    {!explainerAttachmentPreviewUrl ? (
                      <p className="day-state">Select PDF/image to preview here.</p>
                    ) : null}
                  </div>
                  <div className="explainer-audio-wrap">
                    {explainerAudioSource === "upload" && explainerUploadedAudioPreviewUrl ? (
                      <audio className="session-player" controls src={explainerUploadedAudioPreviewUrl} />
                    ) : null}
                    {explainerAudioSource === "record" && explainerRecordedAudioPreviewUrl ? (
                      <audio className="session-player" controls src={explainerRecordedAudioPreviewUrl} />
                    ) : null}
                    {!explainerAudioReady ? (
                      <p className="day-state">Add/upload voice to preview audio here.</p>
                    ) : null}
                  </div>
                </div>
                <div className="upload-inline-grid">
                  <div className="upload-inline-item">
                    <label>Select PDF / Image</label>
                    <input
                      className="task-select"
                      type="file"
                      accept="application/pdf,image/*"
                      onChange={(e) => {
                        setUploadFiles((prev) => ({ ...prev, explainerAttachment: e.target.files?.[0] || null }));
                      }}
                    />
                  </div>
                  <div className="upload-inline-item">
                    <label>Audio Source</label>
                    <div className="mode-row">
                      <button
                        className={`btn-day secondary ${explainerAudioSource === "upload" ? "selected-chip" : ""}`}
                        onClick={async () => {
                          if (["recording", "paused"].includes(explainerRecorderStatus)) {
                            await stopExplainerAudioRecord();
                          }
                          setExplainerAudioSource("upload");
                          setExplainerRecorderStatus("idle");
                        }}
                      >
                        Upload Audio
                      </button>
                      <button
                        className={`btn-day secondary ${explainerAudioSource === "record" ? "selected-chip" : ""}`}
                        onClick={() => {
                          setExplainerAudioSource("record");
                          setUploadFiles((prev) => ({ ...prev, explainerAudio: null }));
                        }}
                      >
                        Record Audio
                      </button>
                    </div>
                    {explainerAudioSource === "upload" ? (
                      <input
                        className="task-select"
                        type="file"
                        accept="audio/*"
                        onChange={(e) => {
                          setUploadFiles((prev) => ({ ...prev, explainerAudio: e.target.files?.[0] || null }));
                          setExplainerRecordedBlob(null);
                          setExplainerRecorderStatus("idle");
                        }}
                      />
                    ) : (
                      <div className="task-modal-actions explainer-recorder-actions">
                        <button className="btn-day secondary" onClick={startExplainerAudioRecord} disabled={explainerRecorderStatus === "recording" || explainerRecorderStatus === "paused"}>
                          Start
                        </button>
                        <button className="btn-day secondary" onClick={pauseExplainerAudioRecord} disabled={explainerRecorderStatus !== "recording"}>
                          Pause
                        </button>
                        <button className="btn-day secondary" onClick={resumeExplainerAudioRecord} disabled={explainerRecorderStatus !== "paused"}>
                          Resume
                        </button>
                        <button className="btn-ticket" onClick={stopExplainerAudioRecord} disabled={!["recording", "paused"].includes(explainerRecorderStatus)}>
                          Stop
                        </button>
                      </div>
                    )}
                    {explainerAudioSource === "record" ? (
                      <p className="day-state">Recorder Status: {capitalize(explainerRecorderStatus)}</p>
                    ) : null}
                  </div>
                </div>
                <div className="explainer-checklist">
                  <span className={`explainer-check-item ${explainerAttachmentReady ? "done" : "pending"}`}>
                    {explainerAttachmentReady ? "PDF/Image ✓" : "PDF/Image ✗"}
                  </span>
                  <span className={`explainer-check-item ${explainerAudioReady ? "done" : "pending"}`}>
                    {explainerAudioReady ? "Audio ✓" : "Audio ✗"}
                  </span>
                </div>
              </div>
            ) : null}
            <textarea className="task-textarea" placeholder="Notes" value={sessionForm.notes} onChange={(e) => setSessionForm((p) => ({ ...p, notes: e.target.value }))} />
            <div className="task-modal-actions">
              {sessionForm.recorder_type === "pdf_explainer" ? (
                <button className="btn-day" disabled={!explainerDoneReady || explainerDoneLoading} onClick={createExplainerSessionWithUploads}>
                  {explainerDoneLoading ? "Saving..." : "Done"}
                </button>
              ) : (
                <button className="btn-day" onClick={createSession}>Create Session</button>
              )}
              <button className="btn-day secondary" onClick={() => fetchSessions(sessionForm.user_id)}>Load Sessions</button>
            </div>
              </>
            )}
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
                <p>Recorder: {capitalize(selectedRecorderType).replace("_", " ")}</p>
                <p>Status: {selectedSession.status} | Elapsed: {formatDuration(elapsedDisplay)}</p>
                <p>Total Minutes: {selectedSession.total_time_minutes || 0}</p>
                {selectedModes.length === 0 ? (
                  <div className="timer-only-display">
                    <span className="timer-only-label">Study Timer</span>
                    <strong className="timer-only-time">{formatDuration(elapsedDisplay)}</strong>
                  </div>
                ) : null}
                {isClosed || selectedRecorderType === "pdf_explainer" ? (
                  <p className="day-state">
                    {selectedRecorderType === "pdf_explainer"
                      ? "Explainer session is already prepared. Use the Explainer Player below."
                      : "This session is closed. Create a new session to record again."}
                  </p>
                ) : (
                  <div className="task-modal-actions">
                    {canStart ? <button className="btn-day" onClick={() => startSession()}>Start</button> : null}
                    {canPause ? <button className="btn-day secondary" onClick={pauseSession}>Pause</button> : null}
                    {canResume ? <button className="btn-day" onClick={resumeSession}>Resume</button> : null}
                    {canStop ? (
                      <button className="btn-ticket" onClick={stopSession}>
                        {selectedRecorderType === "audio" ? "End" : "Stop"}
                      </button>
                    ) : null}
                  </div>
                )}
                {pendingFinalizeModes.length > 0 ? (
                  <div className="task-modal-actions">
                    <button className="btn-day" onClick={retryPendingUploads} disabled={finalizeRetrying}>
                      {finalizeRetrying ? "Retrying..." : `Retry Pending Uploads (${pendingFinalizeModes.join(", ")})`}
                    </button>
                  </div>
                ) : null}
                {selectedRecorderType === "uploader" ? (
                  <div className="upload-inline-grid">
                    <div className="upload-inline-item">
                      <label>Upload Audio/Video</label>
                      <input
                        className="task-select"
                        type="file"
                        accept="audio/*,video/*"
                        onChange={(e) => setUploadFiles((prev) => ({ ...prev, uploader: e.target.files?.[0] || null }))}
                      />
                      <button className="btn-day secondary" onClick={handleUploaderSubmit}>Upload Media</button>
                    </div>
                  </div>
                ) : null}
                {!isClosed && selectedRecorderType !== "pdf_explainer" && (hasVideoMode || hasScreenMode) ? (
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
                {!isClosed && selectedRecorderType !== "pdf_explainer" && hasAudioMode && !hasVideoMode && !hasScreenMode ? (
                  <div className="preview-grid">
                    <div className="preview-card">
                      <h4>Audio Preview</h4>
                      <canvas ref={audioVizCanvasRef} className="audio-visualizer" width={760} height={180} />
                      {!canUseLiveControls ? <p className="day-state">Preview starts after you click Start.</p> : null}
                    </div>
                  </div>
                ) : null}
                {canUseLiveControls && selectedRecorderType !== "pdf_explainer" ? (
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
                      {selectedRecorderType === "pdf_explainer" ? (
                        <div className="recording-player-item">
                          <div className="recording-player-head">
                            <strong>EXPLAINER PLAYER</strong>
                          </div>
                          <div className="explainer-viewer">
                            {attachmentKind === "pdf" && playbackUrls.attachment ? (
                              <iframe title="Explainer PDF" src={playbackUrls.attachment} className="explainer-asset" />
                            ) : null}
                            {attachmentKind === "image" && playbackUrls.attachment ? (
                              <img src={playbackUrls.attachment} alt="Explainer" className="explainer-asset" />
                            ) : null}
                            {!playbackUrls.attachment ? (
                              <p className="day-state">Loading explainer file...</p>
                            ) : null}
                          </div>
                          <div className="explainer-audio-wrap">
                            {playbackUrls.audio ? (
                              <audio className="session-player" controls preload="metadata" src={playbackUrls.audio} />
                            ) : (
                              <p className="day-state">Loading explainer audio...</p>
                            )}
                          </div>
                        </div>
                      ) : null}
                      {uploadedMedia.map((m) => (
                        selectedRecorderType === "pdf_explainer" ? null : (
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
                              <audio className="session-player" controls preload="metadata" src={playbackUrls[m]} />
                            ) : m === "attachment" ? (
                              <a className="btn-day secondary" href={playbackUrls[m]} target="_blank" rel="noreferrer">Open Attachment</a>
                            ) : (
                              <>
                                <video
                                  id={`player-${m}`}
                                  className="session-player"
                                  controls
                                  preload="metadata"
                                  playsInline
                                  src={playbackUrls[m]}
                                />
                                <div className="player-tools">
                                  <label>
                                    Speed:
                                    <select
                                      className="task-select speed-select"
                                      value={String(playbackRates[m] || 1)}
                                      onChange={(e) => {
                                        const rate = Number(e.target.value);
                                        const el = document.getElementById(`player-${m}`);
                                        if (el) el.playbackRate = rate;
                                        setPlaybackRates((prev) => ({ ...prev, [m]: rate }));
                                      }}
                                    >
                                      <option value="0.5">0.5x</option>
                                      <option value="0.75">0.75x</option>
                                      <option value="1">1x</option>
                                      <option value="1.25">1.25x</option>
                                      <option value="1.5">1.5x</option>
                                      <option value="2">2x</option>
                                    </select>
                                  </label>
                                </div>
                              </>
                            )
                          ) : null}
                        </div>
                        )
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="session-list">
              {orderedSessionList.map((session) => (
                <div
                  key={session._id}
                  className="session-item-row"
                >
                  <button
                    className={`session-item ${selectedSession?._id === session._id ? "active" : ""} ${["started", "resumed", "paused"].includes(session.status) ? "running" : ""}`}
                    onClick={() => selectSession(session)}
                  >
                    <strong>{session.subject}</strong> - {session.topic} ({session.session_type}, {capitalize(getRecorderType(session)).replace("_", " ")}) [{session.user_id || "user"} | {session.date}]
                  </button>
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
                          className="menu-item session-menu-delete"
                          onClick={() => deleteSession(session)}
                          disabled={Boolean(deletingSessionIds[session._id]) || ["started", "resumed", "paused"].includes(session.status)}
                          title={["started", "resumed", "paused"].includes(session.status) ? "Stop session before deleting" : "Delete session from app data (keeps S3 file)"}
                        >
                          {deletingSessionIds[session._id] ? "Deleting..." : "Delete Session"}
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </section>
      {explainerModalOpen ? (
        <div className="task-modal-overlay" onClick={() => setExplainerModalOpen(false)}>
          <div className="task-modal explainer-modal" onClick={(e) => e.stopPropagation()}>
            <div className="recording-player-head">
              <h3>PDF Explainer Player</h3>
              <button className="btn-cancel" onClick={() => setExplainerModalOpen(false)}>Close</button>
            </div>
            <div className="explainer-viewer">
              {attachmentKind === "pdf" && playbackUrls.attachment ? (
                <iframe title="Explainer PDF" src={playbackUrls.attachment} className="explainer-asset" />
              ) : null}
              {attachmentKind === "image" && playbackUrls.attachment ? (
                <img src={playbackUrls.attachment} alt="Explainer" className="explainer-asset" />
              ) : null}
              {attachmentKind === "other" ? (
                <p className="day-state">Upload PDF/image to preview here.</p>
              ) : null}
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
