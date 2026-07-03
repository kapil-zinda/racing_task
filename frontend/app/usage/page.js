"use client";
// Usage & limits — storage consumed and LLM tokens spent, from GET /storage.

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../lib/auth";
import MainMenu from "../components/MainMenu";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "";

function fmtNum(n) {
  return Number(n || 0).toLocaleString();
}

export default function UsagePage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

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

  useEffect(() => { load(); }, [load]);

  const usedGb = data?.used_gb ?? 0;
  const limitGb = data?.limit_gb ?? 0;
  const pct = limitGb > 0 ? Math.min(100, Math.round((usedGb / limitGb) * 100)) : 0;
  const totalTokens = (data?.search_llm_tokens || 0) + (data?.qna_llm_tokens || 0);

  return (
    <div className="goal-page">
      <MainMenu active="usage" />
      <div className="goal-container">
        <header className="goal-header">
          <div><h1>Usage & limits</h1><p className="goal-sub">What you've consumed so far this account.</p></div>
          <button className="goal-btn ghost" onClick={load}>↻ Refresh</button>
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
