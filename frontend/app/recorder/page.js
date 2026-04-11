"use client";

import { useEffect, useRef, useState } from "react";
import MainMenu from "../components/MainMenu";
import ActivityInternalMenu from "../components/ActivityInternalMenu";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "";
const NOTICE_TTL_MS = 15000;
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
const EXAM_CATALOG = {
  prelims: [
    "Latest Current Affairs",
    "Static GK",
    "History of India and Indian National Movement",
    "Indian and World Geography",
    "Physical Geography",
    "Social Geography",
    "Economic Geography",
    "Indian Polity and Governance",
    "Constitution",
    "Public Policy Rights",
    "Political System",
    "Rights Issues",
    "Panchayati Raj",
    "Economic and Social Development",
    "Sustainable Development",
    "Poverty",
    "Inclusion",
    "Demographics",
    "Social Sector Initiatives",
    "Environment and Ecology",
    "Biodiversity",
    "Climate Change",
    "Science and Technology"
  ].map((subject) => ({ subject, topics: ["General"] })),
  mains: [
    "History",
    "Modern",
    "World History",
    "Art & Culture",
    "Indian Heritage and Culture",
    "Geography",
    "Human Geography",
    "World Physical Geography",
    "Society",
    "Salient Features of Indian Society",
    "Polity",
    "Indian Constitution & its features, amendments, provisions and bodies",
    "Governance",
    "Social Justice",
    "International Relations",
    "Technology",
    "Economic Development",
    "Biodiversity",
    "Environment",
    "Security",
    "Disaster Management",
    "Ethics",
    "Integrity",
    "Aptitude"
  ].map((subject) => ({ subject, topics: ["General"] })),
  csat: [
    "Comprehension",
    "Interpersonal Skills Including Communication Skills",
    "Logical Reasoning and Analytical Ability",
    "Decision Making and Problem Solving",
    "General Mental Ability",
    "Basic Numeracy",
    "Data Interpretation",
    "English Language Comprehension Skills"
  ].map((subject) => ({ subject, topics: ["General"] })),
  sociology_1: [
    {
      subject: "Sociology - The Discipline",
      topics: [
        "Modernity and social changes in Europe and emergence of Sociology",
        "Scope of the subject and comparison with other social sciences",
        "Sociology and common sense"
      ]
    },
    {
      subject: "Sociology as Science",
      topics: [
        "Science, scientific method, and critique",
        "Major theoretical strands of research methodology",
        "Positivism and its critique",
        "Fact value and objectivity",
        "Non-positivist methodologies"
      ]
    },
    {
      subject: "Research Methods and Analysis",
      topics: [
        "Qualitative and quantitative methods",
        "Techniques of data collection",
        "Variables, sampling, hypothesis, reliability, and validity"
      ]
    },
    {
      subject: "Sociological Thinkers",
      topics: [
        "Karl Marx - historical materialism, mode of production, alienation, class struggle",
        "Emile Durkheim - division of labour, social fact, suicide, religion and society",
        "Max Weber - social action, ideal types, authority, bureaucracy, protestant ethics",
        "Talcott Parsons - social system, pattern variables",
        "Robert K. Merton - latent/manifest functions, deviance, reference groups",
        "Mead - self and identity"
      ]
    },
    {
      subject: "Stratification and Mobility",
      topics: [
        "Equality, inequality, hierarchy, exclusion, poverty, deprivation",
        "Structural functionalist, Marxist and Weberian theories",
        "Class, status groups, gender, ethnicity, race",
        "Open/closed systems and types/sources/causes of mobility"
      ]
    },
    {
      subject: "Works and Economic Life",
      topics: [
        "Work in slave, feudal and industrial capitalist societies",
        "Formal and informal organisation of work",
        "Labour and society"
      ]
    },
    {
      subject: "Politics and Society",
      topics: [
        "Sociological theories of power",
        "Power elite, bureaucracy, pressure groups, political parties",
        "Nation, state, citizenship, democracy, civil society, ideology",
        "Protest, agitation, social movements, collective action, revolution"
      ]
    },
    {
      subject: "Religion and Society",
      topics: [
        "Sociological theories of religion",
        "Animism, monism, pluralism, sects, cults",
        "Religion and science, secularisation, revivalism, fundamentalism"
      ]
    },
    {
      subject: "Systems of Kinship",
      topics: [
        "Family, household, marriage",
        "Types and forms of family",
        "Lineage and descent",
        "Patriarchy and sexual division of labour",
        "Contemporary trends"
      ]
    },
    {
      subject: "Social Change in Modern Society",
      topics: [
        "Sociological theories of social change",
        "Development and dependency",
        "Agents of social change",
        "Education and social change",
        "Science, technology, and social change"
      ]
    }
  ],
  sociology_2: [
    {
      subject: "Perspectives on the Study of Indian Society",
      topics: [
        "Indology (G.S. Ghure)",
        "Structural functionalism (M. N. Srinivas)",
        "Marxist sociology (A. R. Desai)"
      ]
    },
    {
      subject: "Impact of Colonial Rule on Indian Society",
      topics: [
        "Social background of Indian nationalism",
        "Modernization of Indian tradition",
        "Protests and movements during colonial period",
        "Social reforms"
      ]
    },
    {
      subject: "Rural and Agrarian Social Structure",
      topics: [
        "Idea of Indian village and village studies",
        "Evolution of land tenure system and land reforms"
      ]
    },
    {
      subject: "Caste System",
      topics: [
        "Perspectives - Ghurye, Srinivas, Dumont, Beteille",
        "Features of caste system",
        "Untouchability - forms and perspectives"
      ]
    },
    {
      subject: "Tribal Communities in India",
      topics: [
        "Definitional problems",
        "Geographical spread",
        "Colonial policies and tribes",
        "Integration and autonomy issues"
      ]
    },
    {
      subject: "Social Classes in India",
      topics: [
        "Agrarian class structure",
        "Industrial class structure",
        "Middle classes in India"
      ]
    },
    {
      subject: "Systems of Kinship in India",
      topics: [
        "Lineage and descent in India",
        "Types of kinship systems",
        "Family and marriage in India",
        "Household dimensions",
        "Patriarchy, entitlements, sexual division of labour"
      ]
    },
    {
      subject: "Religion and Society",
      topics: [
        "Religious communities in India",
        "Problems of religious minorities"
      ]
    },
    {
      subject: "Visions of Social Change in India",
      topics: [
        "Development planning and mixed economy",
        "Constitution, law and social change",
        "Education and social change"
      ]
    },
    {
      subject: "Rural and Agrarian Transformation in India",
      topics: [
        "Rural development programmes and cooperatives",
        "Green revolution and social change",
        "Changing agricultural production modes",
        "Rural labour, bondage, migration"
      ]
    },
    {
      subject: "Industrialization and Urbanisation in India",
      topics: [
        "Evolution of modern industry",
        "Growth of urban settlements",
        "Working class structure and mobilisation",
        "Informal sector and child labour",
        "Slums and urban deprivation"
      ]
    },
    {
      subject: "Politics and Society",
      topics: [
        "Nation, democracy, citizenship",
        "Political parties, pressure groups, elite",
        "Regionalism and decentralisation",
        "Secularization"
      ]
    },
    {
      subject: "Social Movements in Modern India",
      topics: [
        "Peasants and farmers movements",
        "Womens movement",
        "Backward classes and Dalit movements",
        "Environmental movements",
        "Ethnicity and identity movements"
      ]
    },
    {
      subject: "Population Dynamics",
      topics: [
        "Population size, growth, composition, distribution",
        "Birth, death, migration",
        "Population policy and family planning",
        "Ageing, sex ratios, infant mortality, reproductive health"
      ]
    },
    {
      subject: "Challenges of Social Transformation",
      topics: [
        "Crisis of development, displacement, sustainability",
        "Poverty, deprivation, inequalities",
        "Violence against women",
        "Caste conflicts",
        "Ethnic conflicts, communalism, revivalism",
        "Illiteracy and educational disparities"
      ]
    }
  ]
};

const getSubjectsForExam = (examType) => (EXAM_CATALOG[examType] || []).map((entry) => entry.subject);

const getTopicsForSelection = (examType, subject) => {
  const found = (EXAM_CATALOG[examType] || []).find((entry) => entry.subject === subject);
  return found?.topics || [];
};
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

export default function RecorderPage() {
  const defaultSubject = getSubjectsForExam("prelims")[0] || "";
  const defaultTopic = getTopicsForSelection("prelims", defaultSubject)[0] || "";
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
    if (sessionForm.recorder_type === "pdf_explainer") {
      setSessionError("For PDF Explainer, use the Done button after selecting PDF/image and audio.");
      return;
    }
    setSessionError("");
    const subject = (selectedSubjectValue || "").trim();
    const topic = (selectedTopicValue || "").trim();
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
        recorder_type: sessionForm.recorder_type,
        notes,
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
      setPlaybackUrls({ audio: "", video: "", screen: "", attachment: "" });
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
      screen: createEmptyMultipartState(),
      attachment: createEmptyMultipartState()
    };
    setSelectedSession(session);
    setTimerState({ running: false, startedAt: 0, baseElapsed: session?.elapsed_seconds || 0 });
    setPlaybackUrls({ audio: "", video: "", screen: "", attachment: "" });
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
        screen: createEmptyMultipartState(),
        attachment: createEmptyMultipartState()
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

  const uploadMediaForSession = async (sessionId, mediaType, input, fallbackName = "") => {
    if (!API_BASE_URL || !sessionId || !input) return;
    const inputName = input.name || fallbackName || `${mediaType}.webm`;
    const extension = inputName.split(".").pop()?.toLowerCase() || "webm";
    const contentType = input.type || "application/octet-stream";
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
      const rec = new MediaRecorder(mic, { mimeType: "audio/webm" });
      rec.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) explainerRecorderChunksRef.current.push(e.data);
      };
      rec.onstop = () => {
        const blob = new Blob(explainerRecorderChunksRef.current, { type: "audio/webm" });
        setExplainerRecordedBlob(blob.size > 0 ? blob : null);
        (explainerRecorderStreamRef.current?.getTracks?.() || []).forEach((t) => t.stop());
        explainerRecorderStreamRef.current = null;
        setExplainerRecorderStatus("stopped");
      };
      explainerRecorderRef.current = rec;
      rec.start(500);
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
    const subject = (selectedSubjectValue || "").trim();
    const topic = (selectedTopicValue || "").trim();
    const notes = sessionForm.notes.trim();
    if (!subject || !topic || !notes) {
      setSessionError("Subject, topic, and notes are required.");
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
      const payload = {
        user_id: sessionForm.user_id,
        subject,
        topic,
        session_type: sessionForm.session_type,
        recorder_type: "pdf_explainer",
        notes,
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
      const sessionId = createData.session?._id;
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
        setSelectedSession(oneData.session || createData.session);
      } else {
        setSelectedSession(createData.session);
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
  const statusPriority = { started: 0, resumed: 0, paused: 1, created: 2, stopped: 3 };
  const effectiveExamType = sessionForm.exam_type === OTHER_VALUE ? sessionForm.exam_type_other.trim().toLowerCase() : sessionForm.exam_type;
  const currentSubjectOptions = effectiveExamType ? getSubjectsForExam(effectiveExamType) : [];
  const effectiveSubject = sessionForm.subject === OTHER_VALUE ? sessionForm.subject_other.trim() : sessionForm.subject;
  const currentTopicOptions = effectiveExamType && effectiveSubject ? getTopicsForSelection(effectiveExamType, effectiveSubject) : [];
  const selectedSubjectValue = sessionForm.subject === OTHER_VALUE ? sessionForm.subject_other : sessionForm.subject;
  const selectedTopicValue = sessionForm.topic === OTHER_VALUE ? sessionForm.topic_other : sessionForm.topic;
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
            <div className="session-form-grid">
              <select className="task-select" value={sessionForm.user_id} onChange={(e) => setSessionForm((p) => ({ ...p, user_id: e.target.value }))}>
                <option value="kapil">Kapil</option>
                <option value="divya">Divya</option>
              </select>
              <select
                className="task-select"
                value={sessionForm.exam_type}
                onChange={(e) => {
                  const nextExam = e.target.value;
                  const nextExamForCatalog = nextExam === OTHER_VALUE ? "" : nextExam;
                  const nextSubjects = nextExamForCatalog ? getSubjectsForExam(nextExamForCatalog) : [];
                  const nextSubject = nextExam === OTHER_VALUE ? OTHER_VALUE : (nextSubjects[0] || OTHER_VALUE);
                  const nextTopics = nextExamForCatalog && nextSubject !== OTHER_VALUE
                    ? getTopicsForSelection(nextExamForCatalog, nextSubject)
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
                <option value="prelims">Prelims</option>
                <option value="mains">Mains</option>
                <option value="csat">CSAT</option>
                <option value="sociology_1">Sociology 1</option>
                <option value="sociology_2">Sociology 2</option>
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
                    : getTopicsForSelection(effectiveExamType, nextSubject);
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
                    {canStart ? <button className="btn-day" onClick={startSession}>Start</button> : null}
                    {canPause ? <button className="btn-day secondary" onClick={pauseSession}>Pause</button> : null}
                    {canResume ? <button className="btn-day" onClick={resumeSession}>Resume</button> : null}
                    {canStop ? <button className="btn-ticket" onClick={stopSession}>Stop</button> : null}
                  </div>
                )}
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
                <button
                  key={session._id}
                  className={`session-item ${selectedSession?._id === session._id ? "active" : ""} ${["started", "resumed", "paused"].includes(session.status) ? "running" : ""}`}
                  onClick={() => selectSession(session)}
                >
                  <strong>{session.subject}</strong> - {session.topic} ({session.session_type}, {capitalize(getRecorderType(session)).replace("_", " ")}) [{session.user_id || "user"} | {session.date}]
                </button>
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
