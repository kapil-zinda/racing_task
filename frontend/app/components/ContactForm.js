"use client";
// Public contact form → POST /contact (backend emails the owner via Resend).

import { useState } from "react";
import { useAuth } from "../lib/auth";
import { friendlyApiError } from "../lib/errors";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "";

export default function ContactForm() {
  const { auth } = useAuth();
  const [form, setForm] = useState({
    name: auth?.name || "",
    email: auth?.email || "",
    message: "",
  });
  const [status, setStatus] = useState(null); // { kind, text }
  const [sending, setSending] = useState(false);

  const field = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    if (!API_BASE_URL) { setStatus({ kind: "error", text: "Messaging is not configured." }); return; }
    if (!form.message.trim()) { setStatus({ kind: "error", text: "Please write a message." }); return; }
    setSending(true);
    setStatus(null);
    try {
      const res = await fetch(`${API_BASE_URL}/contact`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.detail || `HTTP ${res.status}`);
      setStatus({ kind: "success", text: data?.message || "Thanks — your message has been sent." });
      setForm((f) => ({ ...f, message: "" }));
    } catch (err) {
      setStatus({ kind: "error", text: `Could not send: ${friendlyApiError(err)}` });
    } finally {
      setSending(false);
    }
  };

  return (
    <form className="lp-form" onSubmit={submit}>
      <label>
        Name
        <input type="text" value={form.name} onChange={field("name")} placeholder="Your name" autoComplete="name" />
      </label>
      <label>
        Email
        <input type="email" value={form.email} onChange={field("email")} placeholder="you@example.com" required autoComplete="email" />
      </label>
      <label>
        Message
        <textarea value={form.message} onChange={field("message")} placeholder="Share feedback or ask a question…" required />
      </label>
      <button className="lp-btn primary lg" type="submit" disabled={sending}>
        {sending ? "Sending…" : "Send message"}
      </button>
      {status ? <p className={`lp-form-note ${status.kind}`}>{status.text}</p> : null}
    </form>
  );
}
