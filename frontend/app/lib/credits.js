"use client";
// In-memory credits store. Holds the user's current balance, per-action prices, and
// free-tier remaining (from GET /payments/credits) so the UI can decide up front
// whether an action is affordable — WITHOUT a pre-check API call. The backend remains
// the sole enforcer (each action returns 402 if unaffordable); this just prevents the
// UI from firing a doomed call and lets it prompt for credits proactively.

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { apiFetch, useAuth } from "./auth";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "";
const CreditsContext = createContext(null);

const PRICE_KEY = {
  answer_eval: "answer_eval_usd",
  interview: "interview_usd",
  vector_search: "vector_search_usd",
};

export function CreditsProvider({ children }) {
  const { auth } = useAuth();
  const [credits, setCredits] = useState(null);

  const refreshCredits = useCallback(async () => {
    if (!API_BASE_URL) return;
    try {
      const res = await apiFetch(`${API_BASE_URL}/payments/credits`);
      if (res.ok) setCredits(await res.json());
    } catch (_) {
      // Non-fatal: canAfford falls back to letting the backend decide.
    }
  }, []);

  useEffect(() => {
    if (auth) refreshCredits();
    else setCredits(null);
  }, [auth, refreshCredits]);

  // Refresh whenever a 402 fires or a credit top-up completes.
  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const onChange = () => refreshCredits();
    window.addEventListener("insufficient-credits", onChange);
    window.addEventListener("credits-changed", onChange);
    return () => {
      window.removeEventListener("insufficient-credits", onChange);
      window.removeEventListener("credits-changed", onChange);
    };
  }, [refreshCredits]);

  // Cost of one action in USD (0 while free-tier remains).
  const costOf = useCallback((action) => {
    if (!credits) return 0;
    const free = credits.free?.[action];
    if (free && free.remaining > 0) return 0;
    return Number(credits.pricing?.[PRICE_KEY[action]] ?? 0);
  }, [credits]);

  const canAfford = useCallback((action) => {
    if (!credits) return true; // not loaded — let the backend be the judge
    const free = credits.free?.[action];
    if (free && free.remaining > 0) return true;
    const bal = Number(credits.balance_usd ?? 0);
    if (action === "qna") return bal > 0; // variable LLM cost — need some balance
    return bal >= Number(credits.pricing?.[PRICE_KEY[action]] ?? 0);
  }, [credits]);

  // Gate a UI action. Returns true if it may proceed; otherwise shows the credits
  // prompt and returns false — without hitting the API.
  const requireCredits = useCallback((action) => {
    if (canAfford(action)) return true;
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("insufficient-credits", {
        detail: { action, balance_usd: Number(credits?.balance_usd ?? 0) },
      }));
    }
    return false;
  }, [canAfford, credits]);

  return (
    <CreditsContext.Provider value={{ credits, refreshCredits, canAfford, costOf, requireCredits }}>
      {children}
    </CreditsContext.Provider>
  );
}

export function useCredits() {
  return useContext(CreditsContext) || {
    credits: null,
    refreshCredits: () => {},
    canAfford: () => true,
    costOf: () => 0,
    requireCredits: () => true,
  };
}
