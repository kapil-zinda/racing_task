"use client";
// Pricing plans — API client. GET /plans is public (used on the pricing page,
// signed in or not); GET /plans/me and POST /plans/subscribe require auth.

import { apiFetch } from "./auth";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "";

async function req(path, opts = {}) {
  if (!API_BASE_URL) throw new Error("NEXT_PUBLIC_API_BASE_URL is not configured");
  const res = await apiFetch(`${API_BASE_URL}${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (_) {
    data = text;
  }
  if (!res.ok) {
    const detail = (data && data.detail) || (typeof data === "string" ? data : "") || `HTTP ${res.status}`;
    throw new Error(typeof detail === "string" ? detail : "Request failed");
  }
  return data;
}

// GET /plans → { plans: { free, pro, max } }
export const listPlans = () => req("/plans");

// GET /plans/me → current subscription (or free-tier shape)
export const mySubscription = () => req("/plans/me");

// POST /plans/subscribe → { order_id, amount, currency, receipt, key_id } (same shape
// as createOrder, so RazorpayCheckout can use either as its order-creation call)
export const subscribeToPlan = (plan, interval) =>
  req("/plans/subscribe", { method: "POST", body: { plan, interval } });
