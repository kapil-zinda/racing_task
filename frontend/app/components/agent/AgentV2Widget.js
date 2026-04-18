"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { getAgentRealtimeToken } from "../../lib/agent/agentBridge";
import { executeAgentActions } from "../../lib/agent/actionExecutor";

const QUICK_ACTIONS = [
  "What is my next best task now?",
  "Show overdue revisions and open mission page.",
  "Open recorder and start a focused session.",
];

export default function AgentV2Widget() {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [status, setStatus] = useState("idle");
  const [liveTranscript, setLiveTranscript] = useState("");
  const [messages, setMessages] = useState([]);
  const pcRef = useRef(null);
  const dcRef = useRef(null);
  const localStreamRef = useRef(null);
  const remoteAudioRef = useRef(null);
  const assistantDeltaRef = useRef("");
  const processedCallIdsRef = useRef(new Set());
  const latestActivityAtRef = useRef(Date.now());
  const nudgeTimerRef = useRef(null);
  const mountedRef = useRef(false);

  const canSend = useMemo(() => status === "live" && input.trim().length > 0, [status, input]);

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

  const extractAssistantText = (item) => {
    if (!item || !Array.isArray(item.content)) return "";
    const parts = [];
    for (const content of item.content) {
      const transcript = String(content?.transcript || "").trim();
      const text = String(content?.text || "").trim();
      if (transcript) parts.push(transcript);
      else if (text) parts.push(text);
    }
    return parts.join(" ").trim();
  };

  const sendDataEvent = (payload) => {
    const dc = dcRef.current;
    if (!dc || dc.readyState !== "open") return false;
    dc.send(JSON.stringify(payload));
    return true;
  };

  const sendRealtimeText = (text, { displayUser = true } = {}) => {
    const content = String(text || "").trim();
    if (!content) return;
    markActivity();
    if (displayUser) {
      setMessages((prev) => [...prev, { role: "user", text: content }]);
    }
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

  const completeFunctionCall = async (callId, name, argsJson) => {
    if (!callId || processedCallIdsRef.current.has(callId)) return;
    processedCallIdsRef.current.add(callId);
    const parsedArgs = parseJsonSafe(argsJson || "{}") || {};
    await executeAgentActions([{ name: name || "", args: parsedArgs }], { router, pathname });
    sendDataEvent({
      type: "conversation.item.create",
      item: {
        type: "function_call_output",
        call_id: callId,
        output: JSON.stringify({ ok: true }),
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
    setStatus("idle");
    setLiveTranscript("");
    assistantDeltaRef.current = "";
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
    if (!open) {
      teardownRealtime();
      return;
    }
    let cancelled = false;
    const connectRealtime = async () => {
      try {
        setStatus("connecting");
        const tokenPayload = await getAgentRealtimeToken({ pageContext: pathname || "" });
        const secretObj = tokenPayload?.client_secret || {};
        const ephemeralKey =
          String(secretObj?.value || tokenPayload?.value || tokenPayload?.client_secret?.value || "").trim();
        if (!ephemeralKey) throw new Error("No ephemeral realtime key returned");

        const pc = new RTCPeerConnection();
        const remoteAudio = document.createElement("audio");
        remoteAudio.autoplay = true;
        pc.ontrack = (event) => {
          remoteAudio.srcObject = event.streams[0];
        };
        const localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));
        const dc = pc.createDataChannel("oai-events");

        dc.onopen = () => {
          if (cancelled) return;
          setStatus("live");
          sendDataEvent({
            type: "session.update",
            session: { instructions: `Current page context: ${pathname || "/"}` },
          });
        };
        dc.onmessage = async (event) => {
          const payload = parseJsonSafe(String(event?.data || ""));
          if (!payload || typeof payload !== "object") return;
          const type = String(payload.type || "");
          if (type === "conversation.item.input_audio_transcription.delta") {
            setLiveTranscript(String(payload.delta || "").trim());
            markActivity();
            return;
          }
          if (type === "conversation.item.input_audio_transcription.completed") {
            const text = String(payload.transcript || "").trim();
            setLiveTranscript("");
            if (text) {
              markActivity();
              setMessages((prev) => [...prev, { role: "user", text }]);
            }
            return;
          }
          if (type === "response.audio_transcript.delta" || type === "response.output_text.delta") {
            assistantDeltaRef.current = `${assistantDeltaRef.current}${String(payload.delta || "")}`;
            return;
          }
          if (type === "response.audio_transcript.done" || type === "response.output_text.done") {
            const finalText = String(payload.transcript || payload.text || assistantDeltaRef.current || "").trim();
            assistantDeltaRef.current = "";
            if (finalText) {
              markActivity();
              setMessages((prev) => [...prev, { role: "assistant", text: finalText }]);
            }
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
              return;
            }
            if (item?.type === "message" && String(item.role || "") === "assistant") {
              const text = extractAssistantText(item);
              if (text) {
                markActivity();
                setMessages((prev) => [...prev, { role: "assistant", text }]);
              }
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
        if (!sdpRes.ok) {
          throw new Error(`Realtime SDP failed: ${sdpRes.status} ${answerSdp}`);
        }
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
        setMessages((prev) => [
          ...prev,
          { role: "assistant", text: `Realtime error: ${String(err?.message || err)}` },
        ]);
        teardownRealtime();
      }
    };
    connectRealtime();
    return () => {
      cancelled = true;
      teardownRealtime();
    };
  }, [open]);

  useEffect(() => {
    if (status !== "live") return;
    sendDataEvent({
      type: "session.update",
      session: { instructions: `Current page context: ${pathname || "/"}` },
    });
  }, [pathname, status]);

  useEffect(() => {
    nudgeTimerRef.current = window.setInterval(() => {
      const now = Date.now();
      const idleMs = now - latestActivityAtRef.current;
      if (!mountedRef.current || !open || status !== "live" || pathname === "/recorder") return;
      if (idleMs < 120000) return;
      markActivity();
      sendRealtimeText("If user is idle, make a short warm check-in in one line.", { displayUser: false });
    }, 15000);
    return () => {
      if (nudgeTimerRef.current) window.clearInterval(nudgeTimerRef.current);
    };
  }, [open, status, pathname]);

  return (
    <div className="agent-v2-wrap">
      <button className="agent-v2-fab" onClick={() => setOpen((v) => !v)} aria-label="Agent">
        Voice Agent
      </button>
      {open ? (
        <div className="agent-v2-panel">
          <div className="agent-v2-head">
            <strong>Agent Live</strong>
            <span className="agent-v2-state">
              {status === "live" ? "Listening live" : status === "connecting" ? "Connecting..." : status === "error" ? "Connection error" : "Idle"}
            </span>
          </div>

          <div className="agent-v2-quick">
            {QUICK_ACTIONS.map((q) => (
              <button key={q} className="agent-v2-chip" disabled={status !== "live"} onClick={() => sendRealtimeText(q)}>
                {q}
              </button>
            ))}
          </div>

          <div className="agent-v2-log">
            {!messages.length ? <div className="agent-v2-empty">Listening is live while this panel is open. Speak naturally.</div> : null}
            {liveTranscript ? <div className="agent-v2-live">You: {liveTranscript}</div> : null}
            {messages.map((m, idx) => (
              <div key={`m-${idx}`} className={`agent-v2-msg ${m.role === "user" ? "user" : "assistant"}`}>
                {m.text}
                {m.audioSrc ? <audio className="agent-v2-audio" controls src={m.audioSrc} preload="none" /> : null}
              </div>
            ))}
          </div>

          <div className="agent-v2-input-row">
            <textarea
              className="agent-v2-input"
              placeholder="Or type your request..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              rows={3}
              disabled={status !== "live"}
            />
            <button
              className="btn-day"
              disabled={!canSend}
              onClick={async () => {
                const text = input.trim();
                setInput("");
                sendRealtimeText(text);
              }}
            >
              {status === "connecting" ? "Connecting..." : "Send"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
