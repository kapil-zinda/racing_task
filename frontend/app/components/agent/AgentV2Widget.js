"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  getAgentRealtimeToken,
  logAgentEntry,
  prepareAgentEntry,
  readAgentContext,
  readMissionOptions,
  searchUnified,
} from "../../lib/agent/agentBridge";
import { AGENT_RECORDER_STATUS_EVENT } from "../../lib/agent/constants";
import { executeAgentActions } from "../../lib/agent/actionExecutor";

const IDLE_NUDGE_MS = 120000;
const AUTO_SLEEP_MS = 300000;

export default function AgentV2Widget() {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState("idle");
  const [recorderRunning, setRecorderRunning] = useState(false);
  const [userSpeaking, setUserSpeaking] = useState(false);
  const [agentSpeaking, setAgentSpeaking] = useState(false);
  const [sleepNote, setSleepNote] = useState("");

  const pcRef = useRef(null);
  const dcRef = useRef(null);
  const localStreamRef = useRef(null);
  const remoteAudioRef = useRef(null);
  const processedCallIdsRef = useRef(new Set());
  const latestActivityAtRef = useRef(Date.now());
  const nudgeTimerRef = useRef(null);
  const mountedRef = useRef(false);

  const userAudioContextRef = useRef(null);
  const userAnalyserRef = useRef(null);
  const userDataRef = useRef(null);
  const userRafRef = useRef(0);

  const agentAudioContextRef = useRef(null);
  const agentAnalyserRef = useRef(null);
  const agentDataRef = useRef(null);
  const agentRafRef = useRef(0);

  const markActivity = () => {
    latestActivityAtRef.current = Date.now();
  };

  const parseJsonSafe = (raw) => {
    try {
      return JSON.parse(raw);
    } catch (_) {
      return null;
    }
  };

  const sendDataEvent = (payload) => {
    const dc = dcRef.current;
    if (!dc || dc.readyState !== "open") return false;
    dc.send(JSON.stringify(payload));
    return true;
  };

  const sendRealtimeText = (text) => {
    const content = String(text || "").trim();
    if (!content) return;
    markActivity();
    sendDataEvent({
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: content }],
      },
    });
    sendDataEvent({ type: "response.create" });
  };

  const stopSpeechMonitor = (who) => {
    if (who === "user") {
      if (userRafRef.current) cancelAnimationFrame(userRafRef.current);
      userRafRef.current = 0;
      userAnalyserRef.current = null;
      userDataRef.current = null;
      if (userAudioContextRef.current) {
        userAudioContextRef.current.close().catch(() => {});
      }
      userAudioContextRef.current = null;
      setUserSpeaking(false);
      return;
    }
    if (agentRafRef.current) cancelAnimationFrame(agentRafRef.current);
    agentRafRef.current = 0;
    agentAnalyserRef.current = null;
    agentDataRef.current = null;
    if (agentAudioContextRef.current) {
      agentAudioContextRef.current.close().catch(() => {});
    }
    agentAudioContextRef.current = null;
    setAgentSpeaking(false);
  };

  const startSpeechMonitor = (stream, who) => {
    if (typeof window === "undefined" || !stream) return;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;

    stopSpeechMonitor(who);

    const audioCtx = new AudioCtx();
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 512;
    const source = audioCtx.createMediaStreamSource(stream);
    source.connect(analyser);
    const data = new Uint8Array(analyser.fftSize);

    let lastActive = false;
    const threshold = who === "user" ? 0.038 : 0.03;

    const tick = () => {
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i += 1) {
        const normalized = (data[i] - 128) / 128;
        sum += normalized * normalized;
      }
      const rms = Math.sqrt(sum / data.length);
      const active = rms >= threshold;
      if (active !== lastActive) {
        if (who === "user") setUserSpeaking(active);
        else setAgentSpeaking(active);
        lastActive = active;
      }
      if (active) markActivity();
      const raf = requestAnimationFrame(tick);
      if (who === "user") userRafRef.current = raf;
      else agentRafRef.current = raf;
    };

    if (who === "user") {
      userAudioContextRef.current = audioCtx;
      userAnalyserRef.current = analyser;
      userDataRef.current = data;
      userRafRef.current = requestAnimationFrame(tick);
      return;
    }

    agentAudioContextRef.current = audioCtx;
    agentAnalyserRef.current = analyser;
    agentDataRef.current = data;
    agentRafRef.current = requestAnimationFrame(tick);
  };

  const completeFunctionCall = async (callId, name, argsJson) => {
    if (!callId || processedCallIdsRef.current.has(callId)) return;
    processedCallIdsRef.current.add(callId);
    const parsedArgs = parseJsonSafe(argsJson || "{}") || {};
    let output = { ok: true };
    const functionName = String(name || "").trim();
    try {
      if (functionName === "read_mission_options") {
        output = await readMissionOptions();
      } else if (functionName === "read_agent_context") {
        output = await readAgentContext(parsedArgs);
      } else if (functionName === "search_unified") {
        output = await searchUnified(parsedArgs);
      } else if (functionName === "prepare_log_entry") {
        output = await prepareAgentEntry(parsedArgs);
      } else if (functionName === "log_entry") {
        output = await logAgentEntry(parsedArgs);
      } else {
        await executeAgentActions([{ name: functionName, args: parsedArgs }], { router, pathname });
        output = { ok: true, action: functionName };
      }
    } catch (err) {
      output = { ok: false, error: String(err?.message || err), function: functionName };
    }
    sendDataEvent({
      type: "conversation.item.create",
      item: {
        type: "function_call_output",
        call_id: callId,
        output: JSON.stringify(output),
      },
    });
    sendDataEvent({ type: "response.create" });
  };

  const teardownRealtime = () => {
    const dc = dcRef.current;
    if (dc) {
      try {
        dc.close();
      } catch (_) {}
    }
    dcRef.current = null;

    const pc = pcRef.current;
    if (pc) {
      try {
        pc.close();
      } catch (_) {}
    }
    pcRef.current = null;

    const stream = localStreamRef.current;
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
    }
    localStreamRef.current = null;

    if (remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = null;
      remoteAudioRef.current = null;
    }

    stopSpeechMonitor("user");
    stopSpeechMonitor("agent");
    processedCallIdsRef.current = new Set();
    setStatus("idle");
  };

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      teardownRealtime();
      if (nudgeTimerRef.current) window.clearInterval(nudgeTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const applyStatus = (raw) => {
      const value = String(raw || "").trim().toLowerCase();
      const running = value === "started" || value === "resumed";
      setRecorderRunning(running);
      if (running) {
        setSleepNote("Recorder is running. Agent is switched off.");
        setOpen(false);
      }
    };
    const onStatus = (event) => applyStatus(event?.detail?.status || "");
    window.addEventListener(AGENT_RECORDER_STATUS_EVENT, onStatus);
    try {
      const raw = window.sessionStorage.getItem("agent_v2_recorder_status");
      if (raw) {
        const parsed = JSON.parse(raw);
        applyStatus(parsed?.status || "");
      }
    } catch (_) {}
    return () => window.removeEventListener(AGENT_RECORDER_STATUS_EVENT, onStatus);
  }, []);

  useEffect(() => {
    if (!open) {
      teardownRealtime();
      return;
    }
    let cancelled = false;
    const connectRealtime = async () => {
      try {
        setStatus("connecting");
        setSleepNote("");
        const tokenPayload = await getAgentRealtimeToken({ pageContext: pathname || "" });
        const secretObj = tokenPayload?.client_secret || {};
        const ephemeralKey = String(secretObj?.value || tokenPayload?.value || "").trim();
        if (!ephemeralKey) throw new Error("No ephemeral realtime key returned");

        const pc = new RTCPeerConnection();
        const remoteAudio = document.createElement("audio");
        remoteAudio.autoplay = true;
        pc.ontrack = (event) => {
          const remoteStream = event.streams[0];
          remoteAudio.srcObject = remoteStream;
          startSpeechMonitor(remoteStream, "agent");
        };

        const localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));
        startSpeechMonitor(localStream, "user");
        const dc = pc.createDataChannel("oai-events");

        dc.onopen = () => {
          if (cancelled) return;
          setStatus("live");
        };
        dc.onmessage = async (event) => {
          const payload = parseJsonSafe(String(event?.data || ""));
          if (!payload || typeof payload !== "object") return;
          const type = String(payload.type || "");
          if (type === "conversation.item.input_audio_transcription.delta") {
            markActivity();
            return;
          }
          if (type === "conversation.item.input_audio_transcription.completed") {
            const text = String(payload.transcript || "").trim();
            if (text) markActivity();
            return;
          }
          if (type === "response.function_call_arguments.done") {
            await completeFunctionCall(
              String(payload.call_id || payload.item_id || ""),
              String(payload.name || ""),
              String(payload.arguments || "{}")
            );
            return;
          }
          if (type === "response.output_item.done") {
            const item = payload.item || {};
            if (item?.type === "function_call") {
              await completeFunctionCall(
                String(item.call_id || item.id || ""),
                String(item.name || ""),
                String(item.arguments || "{}")
              );
            }
          }
        };
        dc.onerror = () => {
          if (!cancelled) setStatus("error");
        };

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        const sdpRes = await fetch("https://api.openai.com/v1/realtime/calls", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${ephemeralKey}`,
            "Content-Type": "application/sdp",
          },
          body: offer.sdp,
        });
        const answerSdp = await sdpRes.text();
        if (!sdpRes.ok) throw new Error(`Realtime SDP failed: ${sdpRes.status} ${answerSdp}`);
        await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });

        if (cancelled) {
          try {
            pc.close();
          } catch (_) {}
          return;
        }
        pcRef.current = pc;
        dcRef.current = dc;
        localStreamRef.current = localStream;
        remoteAudioRef.current = remoteAudio;
      } catch (err) {
        setStatus("error");
        teardownRealtime();
      }
    };

    connectRealtime();
    return () => {
      cancelled = true;
      teardownRealtime();
    };
  }, [open, pathname]);

  useEffect(() => {
    nudgeTimerRef.current = window.setInterval(() => {
      const now = Date.now();
      const idleMs = now - latestActivityAtRef.current;
      if (!mountedRef.current || !open || status !== "live") return;
      if (idleMs >= AUTO_SLEEP_MS) {
        setSleepNote("Agent slept after 5 minutes of silence.");
        setOpen(false);
        return;
      }
      if (pathname === "/recorder") return;
      if (idleMs < IDLE_NUDGE_MS) return;
      markActivity();
      sendRealtimeText("If user is idle, make a short warm check-in in one line.");
    }, 15000);
    return () => {
      if (nudgeTimerRef.current) window.clearInterval(nudgeTimerRef.current);
    };
  }, [open, status, pathname]);

  const statusText =
    status === "live"
      ? "Listening"
      : status === "connecting"
        ? "Connecting"
        : status === "error"
          ? "Connection issue"
          : "Sleeping";

  return (
    <div className="agent-v2-wrap">
      <button
        className="agent-v2-fab animal"
        onClick={() => {
          if (recorderRunning) return;
          setOpen((v) => !v);
        }}
        aria-label="Voice Animal Agent"
        disabled={recorderRunning}
      >
        <span className="animal-icon">🐰</span>
      </button>
      {open ? (
        <div className="agent-v2-panel animal-only">
          <div className="pet-stage">
            <div className={`pet-bunny ${userSpeaking ? "user-speaking" : ""} ${agentSpeaking ? "agent-speaking" : ""}`}>
              <span className="pet-ear left" />
              <span className="pet-ear right" />
              <span className="pet-face">
                <span className="pet-eye left" />
                <span className="pet-eye right" />
                <span className="pet-nose" />
                <span className="pet-mouth" />
              </span>
            </div>
          </div>
          <div className="pet-status-row">
            <span className={`pet-dot ${status === "live" ? "live" : status === "connecting" ? "connecting" : "idle"}`} />
            <span className="agent-v2-state">{statusText}</span>
          </div>
        </div>
      ) : null}
      {!open && sleepNote ? <div className="agent-v2-sleep-note">{sleepNote}</div> : null}
    </div>
  );
}
