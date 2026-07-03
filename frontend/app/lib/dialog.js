"use client";
// Imperative, promise-based themed dialogs (confirm / alert) so the whole app can
// drop `window.confirm` / `window.alert` for on-theme modals. A single <DialogHost/>
// (mounted in ClientLayout) subscribes; callers just `await confirmDialog(...)`.

let emit = null;
const resolvers = new Map();
let counter = 0;

export function _bind(fn) { emit = fn; }

export function _settle(id, value) {
  const r = resolvers.get(id);
  if (r) { resolvers.delete(id); r(value); }
}

function open(kind, opts) {
  const o = typeof opts === "string" ? { message: opts } : (opts || {});
  return new Promise((resolve) => {
    if (typeof emit !== "function") {
      // Host not mounted (SSR / very early) — fall back to the native dialog.
      if (typeof window === "undefined") { resolve(kind === "confirm" ? false : undefined); return; }
      resolve(kind === "confirm" ? window.confirm(o.message || "Are you sure?") : window.alert(o.message || ""));
      return;
    }
    const id = ++counter;
    resolvers.set(id, resolve);
    emit({ id, kind, ...o });
  });
}

export const confirmDialog = (opts) => open("confirm", opts);
export const alertDialog = (opts) => open("alert", opts);
