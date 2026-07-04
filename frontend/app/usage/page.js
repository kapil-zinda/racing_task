"use client";
// Usage & limits — storage consumed and LLM tokens spent, from GET /storage.
// Also shows a Credits balance (from verified Razorpay payments) with an Add-credit button.

import { useCallback, useEffect, useState } from "react";
import { apiFetch, useAuth } from "../lib/auth";
import MainMenu from "../components/MainMenu";
import RazorpayCheckout from "../components/RazorpayCheckout";
import Icon from "../components/Icon";
import { getCredits } from "../lib/paymentApi";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "";

function fmtNum(n) {
  return Number(n || 0).toLocaleString();
}

export default function UsagePage() {
  const { auth } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [credits, setCredits] = useState(null);
  const [creditRupees, setCreditRupees] = useState("100");
  const [payStatus, setPayStatus] = useState(null); // { kind, message, detail }

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const res = await apiFetch(`${API_BASE_URL}/storage`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.detail || `HTTP ${res.status}`);
      setData(body);
    } catch (err) {
      setError(String(err.message || err));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadCredits = useCallback(async () => {
    try {
      setCredits(await getCredits());
    } catch (_) {
      // Non-fatal: the credits card just shows a dash until this succeeds.
    }
  }, []);

  useEffect(() => { load(); loadCredits(); }, [load, loadCredits]);

  const usedGb = data?.used_gb ?? 0;
  const limitGb = data?.limit_gb ?? 0;
  const pct = limitGb > 0 ? Math.min(100, Math.round((usedGb / limitGb) * 100)) : 0;
  const totalTokens = (data?.search_llm_tokens || 0) + (data?.qna_llm_tokens || 0);

  const creditAmountPaise = Math.round(Number(creditRupees || 0) * 100);
  const validCredit = Number.isFinite(creditAmountPaise) && creditAmountPaise >= 100;
  const prefill = auth ? { name: auth.name || "", email: auth.email || "" } : {};

  return (
    <div className="goal-page">
      <MainMenu active="usage" />
      <div className="goal-container">
        <header className="goal-header">
          <div><h1>Usage & limits</h1><p className="goal-sub">What you've consumed so far this account.</p></div>
          <button className="goal-btn ghost" onClick={() => { load(); loadCredits(); }}>↻ Refresh</button>
        </header>

        {error && <div className="goal-error">{error}</div>}
        {loading ? <div className="goal-empty">Loading…</div> : data && (
          <>
            <section className="usage-card">
              <div className="usage-card-head">
                <h3>Storage</h3>
                <span className="usage-big">{usedGb} GB <span className="usage-of">of {limitGb} GB</span></span>
              </div>
              <div className="goal-progress-bar" style={{ height: 12 }}>
                <span style={{ width: `${pct}%`, background: pct > 90 ? "#ef4444" : pct > 70 ? "#f59e0b" : "#6366f1" }} />
              </div>
              <div className="usage-sub-row">
                <span>{pct}% used</span>
                <span>{(data.available_bytes / (1024 ** 3)).toFixed(2)} GB free</span>
              </div>
              <p className="goal-hint">Counts content, recordings and PDF-search files (answer-eval PDFs excluded).</p>
            </section>

            <section className="usage-card" style={{ marginTop: 20 }}>
              <div className="usage-card-head">
                <h3><Icon name="payment" /> Credits</h3>
                <span className="usage-big">
                  ₹{credits ? credits.balance_rupees.toFixed(2) : "—"}
                  {credits ? <span className="usage-of">from {credits.payments} payment{credits.payments === 1 ? "" : "s"}</span> : null}
                </span>
              </div>

              <div className="goal-field-row" style={{ alignItems: "flex-end", marginTop: 12 }}>
                <label className="goal-field" style={{ maxWidth: 180 }}>
                  <span>Add amount (₹)</span>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={creditRupees}
                    onChange={(e) => setCreditRupees(e.target.value)}
                    placeholder="100"
                  />
                </label>
                <RazorpayCheckout
                  amount={creditAmountPaise}
                  currency="INR"
                  description={`Add ₹${validCredit ? (creditAmountPaise / 100).toFixed(2) : "0"} credit`}
                  notes={{ purpose: "credits" }}
                  prefill={prefill}
                  disabled={!validCredit}
                  label="Add credit"
                  onSuccess={(result) => {
                    setPayStatus({ kind: "success", message: "Credit added", detail: `Payment ID: ${result.payment_id}` });
                    loadCredits();
                  }}
                  onFailure={(err) => setPayStatus({ kind: "error", message: "Payment failed", detail: String(err.message || err) })}
                  onDismiss={() => setPayStatus({ kind: "info", message: "Checkout cancelled", detail: "" })}
                />
              </div>
              <p className="goal-hint" style={{ marginTop: 10 }}>Minimum ₹1 (100 paise). Credits are 1:1 with rupees paid, added after the payment is verified.</p>

              {payStatus && (
                <div
                  className={payStatus.kind === "error" ? "goal-error" : ""}
                  style={
                    payStatus.kind === "error"
                      ? { marginTop: 12 }
                      : {
                          marginTop: 12,
                          padding: "10px 12px",
                          borderRadius: 10,
                          fontSize: 14,
                          border: "1px solid",
                          borderColor: payStatus.kind === "success" ? "#1f7a44" : "#2b3348",
                          background: payStatus.kind === "success" ? "#0f2318" : "#0e1320",
                          color: payStatus.kind === "success" ? "#4ade80" : "#8b95a7",
                        }
                  }
                >
                  <strong>{payStatus.message}</strong>
                  {payStatus.detail ? <div style={{ marginTop: 4, fontSize: 13, opacity: 0.85 }}>{payStatus.detail}</div> : null}
                </div>
              )}
            </section>

            <section className="goal-stat-row" style={{ marginTop: 20 }}>
              <div className="goal-stat"><span className="goal-stat-num">{fmtNum(totalTokens)}</span><span className="goal-stat-lbl">LLM tokens total</span></div>
              <div className="goal-stat"><span className="goal-stat-num">{fmtNum(data.search_llm_tokens)}</span><span className="goal-stat-lbl">Search tokens</span></div>
              <div className="goal-stat"><span className="goal-stat-num">{fmtNum(data.qna_llm_tokens)}</span><span className="goal-stat-lbl">QnA tokens</span></div>
              <div className="goal-stat"><span className="goal-stat-num">{fmtNum(data.answers_evaluated)}</span><span className="goal-stat-lbl">Answers evaluated</span></div>
              <div className="goal-stat"><span className="goal-stat-num">{fmtNum(data.interviews_taken)}</span><span className="goal-stat-lbl">Interviews taken</span></div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
