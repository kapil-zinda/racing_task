"use client";
// Usage & credits. All money is shown in USD. Credits come from the in-memory store
// (GET /payments/credits); storage + activity counts come from GET /storage. Top-ups
// go through Razorpay in INR, converted from the USD amount at the server's rate.

import { useCallback, useEffect, useState } from "react";
import { apiFetch, useAuth } from "../lib/auth";
import { useCredits } from "../lib/credits";
import MainMenu from "../components/MainMenu";
import RazorpayCheckout from "../components/RazorpayCheckout";
import Icon from "../components/Icon";
import { friendlyApiError } from "../lib/errors";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "";

const fmtUsd = (n) => `$${Number(n || 0).toFixed(2)}`;
const fmtNum = (n) => Number(n || 0).toLocaleString();
const fmtInr = (n) => `₹${Math.round(Number(n || 0)).toLocaleString("en-IN")}`;

export default function UsagePage() {
  const { auth } = useAuth();
  const { credits, refreshCredits } = useCredits();

  const [storage, setStorage] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [addUsd, setAddUsd] = useState("5");
  const [payStatus, setPayStatus] = useState(null);
  const [topupConfirm, setTopupConfirm] = useState(null); // { usd, inr } after a verified payment

  const loadStorage = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const res = await apiFetch(`${API_BASE_URL}/storage`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.detail || `HTTP ${res.status}`);
      setStorage(body);
    } catch (err) {
      setError(friendlyApiError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadStorage(); refreshCredits(); }, [loadStorage, refreshCredits]);

  const refreshAll = () => { loadStorage(); refreshCredits(); };

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

  // Live ₹ preview of the top-up, using the server's rate — no surprises at checkout.
  const inrPreview = validAdd ? addUsdNum * rate : 0;

  // Per-action rows for the plan card. `note` replaces the price column for
  // usage-based actions with a human explanation.
  const actions = [
    { key: "answer_eval", label: "Answer evaluation", icon: "file", price: pricing.answer_eval_usd, unit: "each" },
    { key: "interview", label: "Mock interview", icon: "interview", price: pricing.interview_usd, unit: "each" },
    { key: "vector_search", label: "Search query", icon: "search", price: pricing.vector_search_usd, unit: "per query" },
    { key: "qna", label: "QnA question", icon: "chat", price: null, note: "Billed by answer length — typically a few cents" },
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
            {credits ? (
              <>
                <span className="usage-credit-balance">{fmtUsd(balance)}</span>
                <span className="usage-balance-inr">≈ {fmtInr(balance * rate)} at today&apos;s rate</span>
              </>
            ) : (
              <span className="usage-skel usage-skel-balance" aria-hidden="true" />
            )}
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
              <span className="usage-inr-hint">
                {validAdd
                  ? <>You&apos;ll pay ≈ {fmtInr(inrPreview)} · rate ₹{rate}/$</>
                  : <>Minimum $1 · rate ₹{rate}/$</>}
              </span>
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
                setPayStatus(null);
                setTopupConfirm({ usd: addUsdNum, inr: paise / 100 });
                if (typeof window !== "undefined") window.dispatchEvent(new Event("credits-changed"));
                refreshAll();
              }}
              onFailure={(err) => { setTopupConfirm(null); setPayStatus({ kind: "error", message: `Payment failed: ${friendlyApiError(err)}` }); }}
              onDismiss={() => setPayStatus({ kind: "info", message: "Checkout cancelled" })}
            />
          </div>

          {topupConfirm && (
            <div className="usage-topup-confirm" role="status">
              <span className="usage-topup-confirm-icon"><Icon name="check-circle" size={22} /></span>
              <div className="usage-topup-confirm-body">
                <strong>Payment successful</strong>
                <span>
                  {fmtInr(topupConfirm.inr)} ({fmtUsd(topupConfirm.usd)}) added ·
                  new balance <b>{fmtUsd(balance)}</b> ≈ {fmtInr(balance * rate)}
                </span>
              </div>
              <button className="usage-topup-confirm-close" onClick={() => setTopupConfirm(null)} aria-label="Dismiss confirmation">
                <Icon name="close" size={14} />
              </button>
            </div>
          )}

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
              const remaining = Number(f?.remaining ?? 0);
              const limit = Number(f?.limit ?? 0);
              return (
                <li key={a.key} className="usage-plan-row">
                  <span className="usage-plan-icon"><Icon name={a.icon} size={18} /></span>
                  <span className="usage-plan-label">{a.label}</span>
                  {f ? (
                    <span className={`usage-plan-free ${remaining > 0 ? "on" : "used"}`}>
                      {remaining > 0 ? `${remaining} of ${limit} free left` : "Free allowance used"}
                    </span>
                  ) : <span className="usage-plan-free" />}
                  {a.note ? (
                    <span className="usage-plan-price usage-plan-note">{a.note}</span>
                  ) : (
                    <span className="usage-plan-price">
                      {a.price != null ? fmtUsd(a.price) : "—"}
                      <small>{a.unit}</small>
                    </span>
                  )}
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
        {loading ? (
          <>
            <section className="usage-card" aria-busy="true" aria-label="Loading storage">
              <div className="usage-skel usage-skel-line w35" />
              <div className="usage-skel usage-skel-bar" />
              <div className="usage-skel usage-skel-line w55" />
            </section>
            <section className="goal-stat-row" aria-hidden="true">
              {[0, 1, 2, 3].map((i) => <div key={i} className="usage-skel usage-skel-stat" />)}
            </section>
          </>
        ) : storage && (
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
      </div>
    </div>
  );
}
