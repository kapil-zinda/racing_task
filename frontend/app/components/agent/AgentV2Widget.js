"use client";

import { useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { sendAgentChat } from "../../lib/agent/agentBridge";
import { executeAgentActions } from "../../lib/agent/actionExecutor";

const QUICK_ACTIONS = [
  "What should I do right now?",
  "Analyze my week and give top 3 corrections.",
  "Open mission page and show overdue revisions.",
  "Open recorder and start session.",
];

export default function AgentV2Widget() {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [mode, setMode] = useState("supportive");
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState([
    { role: "assistant", text: "I am ready. Ask for plan, report, or actions." },
  ]);

  const canSend = useMemo(() => !busy && input.trim().length > 0, [busy, input]);

  const speak = (text) => {
    if (typeof window === "undefined") return;
    const phrase = String(text || "").trim();
    if (!phrase || !window.speechSynthesis) return;
    try {
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(phrase);
      utter.rate = 1;
      window.speechSynthesis.speak(utter);
    } catch (_) {}
  };

  const runChat = async (text) => {
    const userText = String(text || "").trim();
    if (!userText || busy) return;
    setBusy(true);
    setMessages((prev) => [...prev, { role: "user", text: userText }]);
    try {
      const data = await sendAgentChat({
        message: userText,
        mode,
        pageContext: pathname || "",
        allowUiActions: true,
      });
      const response = data?.response || {};
      const reply = String(response.reply_text || "Done.");
      setMessages((prev) => [...prev, { role: "assistant", text: reply }]);
      speak(response.voice_text || reply);
      await executeAgentActions(response.ui_actions || [], { router, pathname });
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", text: `Agent error: ${String(err?.message || err)}` },
      ]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="agent-v2-wrap">
      <button className="agent-v2-fab" onClick={() => setOpen((v) => !v)} aria-label="Agent">
        Agent
      </button>
      {open ? (
        <div className="agent-v2-panel">
          <div className="agent-v2-head">
            <strong>Agent V2</strong>
            <select
              className="agent-v2-mode"
              value={mode}
              onChange={(e) => setMode(e.target.value)}
              disabled={busy}
            >
              <option value="supportive">Supportive</option>
              <option value="strict">Strict</option>
              <option value="planner">Planner</option>
              <option value="analyst">Analyst</option>
              <option value="balanced">Balanced</option>
            </select>
          </div>

          <div className="agent-v2-quick">
            {QUICK_ACTIONS.map((q) => (
              <button key={q} className="agent-v2-chip" disabled={busy} onClick={() => runChat(q)}>
                {q}
              </button>
            ))}
          </div>

          <div className="agent-v2-log">
            {messages.map((m, idx) => (
              <div key={`m-${idx}`} className={`agent-v2-msg ${m.role === "user" ? "user" : "assistant"}`}>
                {m.text}
              </div>
            ))}
          </div>

          <div className="agent-v2-input-row">
            <textarea
              className="agent-v2-input"
              placeholder="Ask for report, suggestion, or action..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              rows={3}
              disabled={busy}
            />
            <button
              className="btn-day"
              disabled={!canSend}
              onClick={async () => {
                const text = input.trim();
                setInput("");
                await runChat(text);
              }}
            >
              {busy ? "Thinking..." : "Send"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

