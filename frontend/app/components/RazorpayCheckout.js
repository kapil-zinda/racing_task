"use client";
// Razorpay Standard Checkout button. Click → create order on the backend → open the
// Razorpay modal → verify the signature server-side on success. Handles modal dismiss
// (user cancelled) and the payment.failed event, and surfaces errors to the caller.

import { useCallback, useState } from "react";
import { createOrder, verifyPayment, loadRazorpayScript } from "../lib/paymentApi";

export default function RazorpayCheckout({
  amount,                 // in paise (integer); minimum 100 — ignored when createOrderFn is passed
  currency = "INR",
  receipt = "",
  notes = {},
  name = "Dias",
  description = "Payment",
  prefill = {},           // { name, email, contact }
  theme = { color: "#6366f1" },
  label = "Pay now",
  className = "goal-btn primary",
  disabled = false,
  createOrderFn,          // optional: () => Promise<order> — defaults to the credit top-up order
  onSuccess,              // (verifyResult, razorpayResponse) => void
  onFailure,              // (error) => void
  onDismiss,              // () => void
}) {
  const [busy, setBusy] = useState(false);

  const handleClick = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      await loadRazorpayScript();

      // 1. Create the order on the backend (amount validated + Razorpay order created there).
      const order = createOrderFn
        ? await createOrderFn()
        : await createOrder({ amount, currency, receipt, notes });

      // 2. Resolve the public key: backend response first, then the Next.js public env var.
      const keyId = order.key_id || process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID || "";
      if (!keyId) throw new Error("Razorpay key id is not available");

      // 3. Open the checkout modal.
      const rzp = new window.Razorpay({
        key: keyId,
        order_id: order.order_id,
        amount: order.amount,
        currency: order.currency,
        name,
        description,
        prefill,
        notes,
        theme,
        handler: async (response) => {
          // 4. Payment captured by Razorpay — verify the signature server-side before trusting it.
          try {
            const result = await verifyPayment({
              razorpay_order_id: response.razorpay_order_id,
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_signature: response.razorpay_signature,
            });
            onSuccess?.(result, response);
          } catch (err) {
            onFailure?.(err instanceof Error ? err : new Error(String(err)));
          } finally {
            setBusy(false);
          }
        },
        modal: {
          ondismiss: () => {
            // User closed the modal without paying.
            setBusy(false);
            onDismiss?.();
          },
        },
      });

      rzp.on("payment.failed", (resp) => {
        const err = resp?.error || {};
        setBusy(false);
        onFailure?.(new Error(err.description || err.reason || "Payment failed"));
      });

      rzp.open();
    } catch (err) {
      setBusy(false);
      onFailure?.(err instanceof Error ? err : new Error(String(err)));
    }
  }, [busy, amount, currency, receipt, notes, name, description, prefill, theme, createOrderFn, onSuccess, onFailure, onDismiss]);

  return (
    <button type="button" className={className} onClick={handleClick} disabled={disabled || busy}>
      {busy ? "Processing…" : label}
    </button>
  );
}
