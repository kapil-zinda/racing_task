"use client";
// Razorpay Standard Checkout — API client + script loader.
// Thin wrappers over apiFetch for the /payments endpoints, plus a helper that lazily
// injects Razorpay's checkout.js. The KEY_SECRET never touches this code; the public
// KEY_ID comes back from create-order (or NEXT_PUBLIC_RAZORPAY_KEY_ID as a fallback).

import { apiFetch } from "./auth";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "";
const CHECKOUT_SRC = "https://checkout.razorpay.com/v1/checkout.js";

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
    throw new Error(detail);
  }
  return data;
}

// POST /payments/create-order → { order_id, amount, currency, receipt, key_id }
export const createOrder = ({ amount, currency = "INR", receipt = "", notes = {} }) =>
  req("/payments/create-order", { method: "POST", body: { amount, currency, receipt, notes } });

// POST /payments/verify → { verified: true, status: "paid", ... }
export const verifyPayment = ({ razorpay_order_id, razorpay_payment_id, razorpay_signature }) =>
  req("/payments/verify", { method: "POST", body: { razorpay_order_id, razorpay_payment_id, razorpay_signature } });

// GET /payments/credits → { balance_paise, balance_rupees, currency, payments }
export const getCredits = () => req("/payments/credits");

// Lazily load checkout.js once. Resolves when window.Razorpay is available.
export function loadRazorpayScript() {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined") {
      reject(new Error("Razorpay checkout is only available in the browser"));
      return;
    }
    if (window.Razorpay) {
      resolve();
      return;
    }
    const existing = document.querySelector(`script[src="${CHECKOUT_SRC}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("Failed to load Razorpay checkout")));
      return;
    }
    const script = document.createElement("script");
    script.src = CHECKOUT_SRC;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load Razorpay checkout"));
    document.body.appendChild(script);
  });
}
