import { AGENT_SESSION_STORAGE_KEY } from "./constants";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "";
const GLOBAL_USER_STORAGE_KEY = "global_user_id";

function readUser() {
  if (typeof window === "undefined") return "kapil";
  const raw = (window.localStorage.getItem(GLOBAL_USER_STORAGE_KEY) || "kapil").trim().toLowerCase();
  return raw === "divya" ? "divya" : "kapil";
}

export function getCurrentAgentUserId() {
  return readUser();
}

function readSessionMap() {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(AGENT_SESSION_STORAGE_KEY) || "{}";
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (_) {
    return {};
  }
}

function writeSessionMap(map) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(AGENT_SESSION_STORAGE_KEY, JSON.stringify(map || {}));
  } catch (_) {}
}

async function ensureSession(userId) {
  if (!API_BASE_URL) throw new Error("NEXT_PUBLIC_API_BASE_URL is missing");
  const map = readSessionMap();
  if (map[userId]) return map[userId];
  const res = await fetch(`${API_BASE_URL}/agent-v2/create-agent`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user_id: userId, mode: "supportive" }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Create agent failed: ${res.status} ${txt}`);
  }
  const data = await res.json();
  const sessionId = data?.session?._id;
  if (!sessionId) throw new Error("Create agent returned no session id");
  const next = { ...map, [userId]: sessionId };
  writeSessionMap(next);
  return sessionId;
}

export async function sendAgentChat({
  message = "",
  mode = "",
  pageContext = "",
  allowUiActions = true,
  inputAudioBase64 = "",
  inputAudioMimeType = "audio/webm",
  responseAudio = true,
  responseAudioFormat = "mp3",
  responseVoice = "alloy",
}) {
  const userId = readUser();
  const sessionId = await ensureSession(userId);
  const res = await fetch(`${API_BASE_URL}/agent-v2/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      session_id: sessionId,
      user_id: userId,
      message,
      input_audio_base64: inputAudioBase64,
      input_audio_mime_type: inputAudioMimeType,
      mode,
      page_context: pageContext,
      allow_ui_actions: Boolean(allowUiActions),
      response_audio: Boolean(responseAudio),
      response_audio_format: responseAudioFormat,
      response_voice: responseVoice,
    }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Agent chat failed: ${res.status} ${txt}`);
  }
  return res.json();
}

export async function getAgentRealtimeToken({ pageContext = "", voice = "" } = {}) {
  const userId = readUser();
  if (!API_BASE_URL) throw new Error("NEXT_PUBLIC_API_BASE_URL is missing");
  const res = await fetch(`${API_BASE_URL}/agent-v2/realtime/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      user_id: userId,
      page_context: pageContext,
      voice,
    }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Realtime token failed: ${res.status} ${txt}`);
  }
  return res.json();
}

export async function readMissionOptions() {
  const userId = readUser();
  if (!API_BASE_URL) throw new Error("NEXT_PUBLIC_API_BASE_URL is missing");
  const res = await fetch(`${API_BASE_URL}/mission/options?user_id=${encodeURIComponent(userId)}`);
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Mission options failed: ${res.status} ${txt}`);
  }
  return res.json();
}

export async function prepareAgentEntry(input = {}) {
  const userId = readUser();
  if (!API_BASE_URL) throw new Error("NEXT_PUBLIC_API_BASE_URL is missing");
  const res = await fetch(`${API_BASE_URL}/agent-v2/entries/prepare`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      user_id: userId,
      entry_type: input.entry_type || "",
      exam: input.exam || "",
      course: input.course || "",
      book_name: input.book_name || "",
      source: input.source || "",
      subject: input.subject || "",
      topic: input.topic || "",
      test_name: input.test_name || "",
      test_number: input.test_number || "",
      stage: input.stage || "",
      org: input.org || "",
      note: input.note || "",
      work_type: input.work_type || "study",
      confirm: false,
    }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Prepare entry failed: ${res.status} ${txt}`);
  }
  return res.json();
}

export async function logAgentEntry(input = {}) {
  const userId = readUser();
  if (!API_BASE_URL) throw new Error("NEXT_PUBLIC_API_BASE_URL is missing");
  const res = await fetch(`${API_BASE_URL}/agent-v2/entries/log`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      user_id: userId,
      entry_type: input.entry_type || "",
      exam: input.exam || "",
      course: input.course || "",
      book_name: input.book_name || "",
      source: input.source || "",
      subject: input.subject || "",
      topic: input.topic || "",
      test_name: input.test_name || "",
      test_number: input.test_number || "",
      stage: input.stage || "",
      org: input.org || "",
      note: input.note || "",
      work_type: input.work_type || "study",
      confirm: input.confirm !== false,
    }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Log entry failed: ${res.status} ${txt}`);
  }
  return res.json();
}

export async function readAgentContext(input = {}) {
  const userId = readUser();
  if (!API_BASE_URL) throw new Error("NEXT_PUBLIC_API_BASE_URL is missing");
  const params = new URLSearchParams();
  params.set("user_id", userId);
  if (input.date) params.set("date", String(input.date));
  if (input.lookback_days != null) params.set("lookback_days", String(input.lookback_days));
  if (input.x_days != null) params.set("x_days", String(input.x_days));
  if (input.y_days != null) params.set("y_days", String(input.y_days));
  const res = await fetch(`${API_BASE_URL}/agent-v2/context?${params.toString()}`);
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Agent context failed: ${res.status} ${txt}`);
  }
  return res.json();
}

export async function searchUnified(input = {}) {
  const userId = readUser();
  if (!API_BASE_URL) throw new Error("NEXT_PUBLIC_API_BASE_URL is missing");
  const q = String(input.q || "").trim();
  if (!q) throw new Error("search_unified requires q");
  const params = new URLSearchParams();
  params.set("user_id", userId);
  params.set("q", q);
  if (input.course) params.set("course", String(input.course));
  if (input.types) params.set("types", String(input.types));
  if (input.limit != null) params.set("limit", String(input.limit));
  const res = await fetch(`${API_BASE_URL}/agent-v2/search/unified?${params.toString()}`);
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Search unified failed: ${res.status} ${txt}`);
  }
  return res.json();
}
