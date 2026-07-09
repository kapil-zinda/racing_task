"use client";
// Global "not enough credits" prompt. Any API call that returns 402 dispatches an
// `insufficient-credits` window event (see apiFetch); this listens and shows a modal
// with a shortcut to the Usage page to add credits.

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Icon from "./Icon";

const ACTION_LABEL = {
  answer_eval: "answer evaluation",
  interview: "mock interview",
  vector_search: "search",
  qna: "QnA",
};

const TITLE_ID = "credit-guard-title";
const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

export default function CreditGuard() {
  const [detail, setDetail] = useState(null);
  const router = useRouter();
  const pathname = usePathname();
  const modalRef = useRef(null);
  const prevFocusRef = useRef(null);
  const isOpen = detail != null;

  useEffect(() => {
    const onEvent = (e) => setDetail(e.detail || {});
    window.addEventListener("insufficient-credits", onEvent);
    return () => window.removeEventListener("insufficient-credits", onEvent);
  }, []);

  // Auto-dismiss once the user is on the Usage page.
  useEffect(() => {
    if (pathname === "/usage") setDetail(null);
  }, [pathname]);

  // While open: remember the previously-focused element, move focus into the
  // modal, trap Tab inside it, close on Esc, and restore focus on close.
  useEffect(() => {
    if (!isOpen) return undefined;
    prevFocusRef.current = document.activeElement;

    const focusables = () => {
      const modal = modalRef.current;
      return modal ? Array.from(modal.querySelectorAll(FOCUSABLE)) : [];
    };

    // Land on the primary action ("Add credits" — last focusable).
    const initial = focusables();
    (initial[initial.length - 1] || modalRef.current)?.focus();

    const onKey = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setDetail(null);
        return;
      }
      if (e.key !== "Tab") return;
      const list = focusables();
      if (!list.length) return;
      const first = list[0];
      const last = list[list.length - 1];
      const current = document.activeElement;
      if (!modalRef.current?.contains(current)) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && current === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && current === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      const prev = prevFocusRef.current;
      if (prev && typeof prev.focus === "function") prev.focus();
    };
  }, [isOpen]);

  if (!detail) return null;

  const action = ACTION_LABEL[detail.action] || "this action";
  const close = () => setDetail(null);
  const goBuyPlan = () => { close(); router.push("/pricing"); };
  const goAddCredits = () => { close(); router.push("/usage"); };

  return (
    <div className="credit-modal-overlay" onClick={close}>
      <div
        className="credit-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={TITLE_ID}
        ref={modalRef}
        tabIndex={-1}
      >
        <span className="credit-modal-icon"><Icon name="wallet" size={26} /></span>
        <h3 id={TITLE_ID}>Not enough credits</h3>
        <p>
          You&apos;ve used up your plan quota and free {action} and don&apos;t have enough
          credits to continue. Get a plan for a better rate, or add credits to keep going.
        </p>
        <div className="credit-modal-actions">
          <button className="credit-btn ghost" onClick={close}>Not now</button>
          <button className="credit-btn ghost" onClick={goBuyPlan}>Buy plan</button>
          <button className="credit-btn primary" onClick={goAddCredits}>Add credits</button>
        </div>
      </div>
    </div>
  );
}
