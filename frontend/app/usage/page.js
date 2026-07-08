"use client";
// Usage & credits. All money is shown in USD. Credits come from the in-memory store
// (GET /payments/credits); storage + activity counts come from GET /storage. Top-ups
// go through Razorpay in INR, converted from the USD amount at the server's rate.

import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { apiFetch, useAuth } from "../lib/auth";
import { useCredits } from "../lib/credits";
import MainMenu from "../components/MainMenu";
import RazorpayCheckout from "../components/RazorpayCheckout";
import Icon from "../components/Icon";

const Plot = dynamic(() => import("react-plotly.js"), { ssr: false });

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "";

const fmtUsd = (n) => `$${Number(n || 0).toFixed(2)}`;
const fmtInr = (n) => `₹${Number(n || 0).toFixed(2)}`;
const fmtNum = (n) => Number(n || 0).toLocaleString();

const CHART_DARK = {
  paper_bgcolor: "rgba(0,0,0,0)", plot_bgcolor: "rgba(0,0,0,0)",
  font: { color: "#c7cede" }, margin: { t: 10, r: 10, b: 40, l: 40 },
  barmode: "stack",
  legend: { orientation: "h", y: -0.2 },
};

export default function UsagePage() {
  const { auth } = useAuth();
  const { credits, refreshCredits } = useCredits();

  const [storage, setStorage] = useState(null);
  const [costHistory, setCostHistory] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [addUsd, setAddUsd] = useState("5");
  const [payStatus, setPayStatus] = useState(null);

  const loadStorage = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const res = await apiFetch(`${API_BASE_URL}/storage`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.detail || `HTTP ${res.status}`);
      setStorage(body);
    } catch (err) {
      setError(String(err.message || err));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadCostHistory = useCallback(async () => {
    try {
      const res = await apiFetch(`${API_BASE_URL}/storage/cost-history`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.detail || `HTTP ${res.status}`);
      setCostHistory(body);
    } catch (err) {
      setError(String(err.message || err));
    }
  }, []);

  useEffect(() => { loadStorage(); loadCostHistory(); refreshCredits(); }, [loadStorage, loadCostHistory, refreshCredits]);

  const refreshAll = () => { loadStorage(); loadCostHistory(); refreshCredits(); };

  const history_ = costHistory?.history || [];

  // Storage
  const usedGb = storage?.used_gb ?? 0;
  const limitGb = storage?.limit_gb ?? 0;
  const pct = limitGb > 0 ? Math.min(100, Math.round((usedGb / limitGb) * 100)) : 0;

  // Credits
  const balance = credits?.balance_usd ?? 0;
  const added = credits?.added_usd ?? 0;
  const spent = credits?.spent_usd ?? 0;
  const rate = credits?.usd_to_inr ?? 88;
  const pricing = credits?.pricing || {};
  const free = credits?.free || {};
  const spentBreak = credits?.spent_breakdown || {};

  // Top-up: USD → INR paise for Razorpay.
  const addUsdNum = Number(addUsd || 0);
  const paise = Math.round(addUsdNum * rate * 100);
  const validAdd = Number.isFinite(paise) && addUsdNum >= 1;
  const prefill = auth ? { name: auth.name || "", email: auth.email || "" } : {};

  // Per-action rows for the plan card.
  const actions = [
    { key: "answer_eval", label: "Answer evaluation", icon: "file", price: pricing.answer_eval_usd, unit: "each" },
    { key: "interview", label: "Mock interview", icon: "interview", price: pricing.interview_usd, unit: "each" },
    { key: "vector_search", label: "Search query", icon: "search", price: pricing.vector_search_usd, unit: "per query" },
    { key: "qna", label: "QnA question", icon: "chat", price: null, unit: "usage-based" },
  ];

  return (
    <div className="goal-page">
      <MainMenu active="usage" />
      <div className="goal-container">
        <header className="goal-header">
          <div>
            <h1>Usage &amp; credits</h1>
            <p className="goal-sub">Your balance, what you&apos;ve used, and what actions cost.</p>
          </div>
          <button className="goal-btn ghost" onClick={refreshAll}><Icon name="refresh" size={15} /> Refresh</button>
        </header>

        {error && <div className="goal-error">{error}</div>}

        {/* Credits hero */}
        <section className="usage-credit-card">
          <div className="usage-credit-main">
            <span className="usage-credit-label"><Icon name="wallet" size={15} /> Credit balance</span>
            <span className="usage-credit-balance">{fmtUsd(balance)}</span>
            <div className="usage-credit-meta">
              <span><b>{fmtUsd(added)}</b> added</span>
              <span className="dot">·</span>
              <span><b>{fmtUsd(spent)}</b> spent</span>
              {credits?.payments ? <><span className="dot">·</span><span>{credits.payments} top-up{credits.payments === 1 ? "" : "s"}</span></> : null}
            </div>
          </div>

          <div className="usage-topup">
            <label className="usage-topup-field">
              <span>Add credits (USD)</span>
              <div className="usage-topup-input">
                <span className="usage-topup-dollar">$</span>
                <input type="number" min="1" step="1" value={addUsd}
                  onChange={(e) => setAddUsd(e.target.value)} placeholder="5" />
              </div>
            </label>
            <RazorpayCheckout
              amount={paise}
              currency="INR"
              description={`Add ${fmtUsd(validAdd ? addUsdNum : 0)} credit`}
              notes={{ purpose: "credits", usd: validAdd ? addUsdNum : 0 }}
              prefill={prefill}
              disabled={!validAdd}
              label="Add credits"
              onSuccess={() => {
                setPayStatus({ kind: "success", message: "Credits added" });
                if (typeof window !== "undefined") window.dispatchEvent(new Event("credits-changed"));
                refreshAll();
              }}
              onFailure={(err) => setPayStatus({ kind: "error", message: `Payment failed: ${String(err.message || err)}` })}
              onDismiss={() => setPayStatus({ kind: "info", message: "Checkout cancelled" })}
            />
          </div>

          {payStatus && (
            <div className={`usage-pay-note ${payStatus.kind}`}>{payStatus.message}</div>
          )}
        </section>

        {/* Plan: prices + free allowances */}
        <section className="usage-card">
          <div className="usage-card-head"><h3>Actions &amp; pricing</h3></div>
          <ul className="usage-plan">
            {actions.map((a) => {
              const f = free[a.key];
              return (
                <li key={a.key} className="usage-plan-row">
                  <span className="usage-plan-icon"><Icon name={a.icon} size={18} /></span>
                  <span className="usage-plan-label">{a.label}</span>
                  {f ? (
                    <span className={`usage-plan-free ${f.remaining > 0 ? "on" : ""}`}>
                      {f.remaining > 0 ? `${f.remaining} of ${f.limit} free left` : `${f.limit} free used`}
                    </span>
                  ) : <span className="usage-plan-free" />}
                  <span className="usage-plan-price">
                    {a.price != null ? fmtUsd(a.price) : "—"}
                    <small>{a.unit}</small>
                  </span>
                </li>
              );
            })}
          </ul>
        </section>

        {/* Spend breakdown */}
        <section className="usage-card">
          <div className="usage-card-head"><h3>Spend so far</h3><span className="usage-of">{fmtUsd(spent)} total</span></div>
          <div className="usage-spend-grid">
            <div className="usage-spend"><span>{fmtUsd(spentBreak.answer_eval_usd)}</span><small>Answer eval</small></div>
            <div className="usage-spend"><span>{fmtUsd(spentBreak.interview_usd)}</span><small>Interviews</small></div>
            <div className="usage-spend"><span>{fmtUsd(spentBreak.vector_search_usd)}</span><small>Search</small></div>
            <div className="usage-spend"><span>{fmtUsd(spentBreak.qna_usd)}</span><small>QnA</small></div>
          </div>
        </section>

        {/* Storage */}
        {loading ? <div className="goal-empty">Loading…</div> : storage && (
          <>
            <section className="usage-card">
              <div className="usage-card-head">
                <h3>Storage</h3>
                <span className="usage-of">{usedGb} GB of {limitGb} GB</span>
              </div>
              <div className="goal-progress-bar" style={{ height: 12 }}>
                <span style={{ width: `${pct}%`, background: pct > 90 ? "var(--red)" : pct > 70 ? "var(--gold)" : "var(--indigo, #6366f1)" }} />
              </div>
              <div className="usage-sub-row">
                <span>{pct}% used</span>
                <span>{(storage.available_bytes / (1024 ** 3)).toFixed(2)} GB free</span>
              </div>
              <p className="goal-hint">Counts content, recordings and PDF-search files (answer-eval PDFs excluded).</p>
            </section>

            <section className="goal-stat-row">
              <div className="goal-stat"><span className="goal-stat-num">{fmtNum(storage.answers_evaluated)}</span><span className="goal-stat-lbl">Answers evaluated</span></div>
              <div className="goal-stat"><span className="goal-stat-num">{fmtNum(storage.interviews_taken)}</span><span className="goal-stat-lbl">Interviews taken</span></div>
              <div className="goal-stat"><span className="goal-stat-num">{fmtNum(storage.search_queries)}</span><span className="goal-stat-lbl">Searches run</span></div>
              <div className="goal-stat"><span className="goal-stat-num">{fmtNum(storage.qna_questions)}</span><span className="goal-stat-lbl">QnA questions</span></div>
            </section>
          </>
        )}

        {/* Storage cost (INR) — from billingHistory */}
        {costHistory && (
          <section className="usage-card">
            <div className="usage-card-head">
              <h3>Storage cost</h3>
              <span className="usage-of">{fmtInr(costHistory.thisMonth?.total)} this month</span>
            </div>

            <div className="goal-stat-row" style={{ marginBottom: history_.length ? 20 : 0 }}>
              <div className="goal-stat">
                <span className="goal-stat-num">{fmtInr(costHistory.today?.total)}</span>
                <span className="goal-stat-lbl">Today ({fmtInr(costHistory.today?.cost)} storage + {fmtInr(costHistory.today?.additionalCost)} vector)</span>
              </div>
              <div className="goal-stat">
                <span className="goal-stat-num">{fmtInr(costHistory.thisMonth?.total)}</span>
                <span className="goal-stat-lbl">This month ({fmtInr(costHistory.thisMonth?.cost)} storage + {fmtInr(costHistory.thisMonth?.additionalCost)} vector)</span>
              </div>
            </div>

            {history_.length ? (
              <Plot
                data={[
                  { type: "bar", name: "Storage", x: history_.map((h) => h.date), y: history_.map((h) => h.cost), marker: { color: "#6366f1" } },
                  { type: "bar", name: "Searchable / vector", x: history_.map((h) => h.date), y: history_.map((h) => h.additionalCost), marker: { color: "#ec4899" } },
                ]}
                layout={{ ...CHART_DARK, height: 260 }}
                config={{ displayModeBar: false, responsive: true }}
                style={{ width: "100%" }}
              />
            ) : (
              <div className="goal-empty sm">No storage charges yet.</div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
