"use client";
// App-wide navigation accelerators for daily users: "g" then a letter jumps to
// a section (e.g. g h -> /home), "/" jumps to Search, "?" opens the help guide.
// Disabled while focus is in a text field so normal typing is never hijacked.

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

const GO_MAP = {
  h: "/home",
  i: "/interview",
  e: "/answer-eval",
  q: "/qna",
  o: "/goals",
  a: "/analytics",
  r: "/recorder",
  m: "/mindmap",
  n: "/noter",
  c: "/content",
  s: "/search",
  u: "/usage",
};

const PENDING_MS = 900;

// Covers every modal/overlay pattern in the app (task modals, confirm dialogs,
// the credit paywall, the day-tracker clock picker). If any is open, navigation
// shortcuts must not silently discard it — let Escape/Cancel handle it instead.
const OVERLAY_SELECTOR = [
  ".task-modal-overlay",
  ".cp-backdrop",
  ".credit-modal-overlay",
  ".app-dialog-overlay",
  ".goal-modal-backdrop",
  ".goal-menu-backdrop",
  ".vlc-backdrop",
  '[role="dialog"]',
].join(", ");

function isTypingTarget(el) {
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || !!el.isContentEditable;
}

function isOverlayOpen() {
  return !!document.querySelector(OVERLAY_SELECTOR);
}

export default function KeyboardShortcuts() {
  const router = useRouter();
  const pendingRef = useRef(false);
  const timerRef = useRef(null);

  useEffect(() => {
    const clearPending = () => {
      pendingRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
    };

    const onKeyDown = (e) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      if (isTypingTarget(e.target)) return;
      if (isOverlayOpen()) { clearPending(); return; }

      if (pendingRef.current) {
        clearPending();
        const dest = GO_MAP[e.key.toLowerCase()];
        if (dest) {
          e.preventDefault();
          router.push(dest);
        }
        return;
      }

      if (e.key === "g" || e.key === "G") {
        pendingRef.current = true;
        timerRef.current = setTimeout(clearPending, PENDING_MS);
        return;
      }
      if (e.key === "/") {
        e.preventDefault();
        router.push("/search");
        return;
      }
      if (e.key === "?") {
        e.preventDefault();
        router.push("/how-to-use");
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      clearPending();
    };
  }, [router]);

  return null;
}
