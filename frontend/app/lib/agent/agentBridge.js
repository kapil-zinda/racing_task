import { AGENT_SESSION_STORAGE_KEY } from "./constants";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "";
const GLOBAL_USER_STORAGE_KEY = "global_user_id";

function readUser() {
  if (typeof window === "undefined") return "kapil";
  const raw = (window.localStorage.getItem(GLOBAL_USER_STORAGE_KEY) || "kapil").trim().toLowerCase();
  return raw === "divya" ? "divya" : "kapil";
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
