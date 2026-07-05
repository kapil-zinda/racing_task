"use client";
// Global "not enough credits" prompt. Any API call that returns 402 dispatches an
// `insufficient-credits` window event (see apiFetch); this listens and shows a modal
// with a shortcut to the Usage page to add credits.

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Icon from "./Icon";

const ACTION_LABEL = {
  answer_eval: "answer evaluation",
  interview: "mock interview",
  vector_search: "search",
  qna: "QnA",
};

export default function CreditGuard() {
  const [detail, setDetail] = useState(null);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    const onEvent = (e) => setDetail(e.detail || {});
    window.addEventListener("insufficient-credits", onEvent);
    return () => window.removeEventListener("insufficient-credits", onEvent);
  }, []);

  // Auto-dismiss once the user is on the Usage page.
  useEffect(() => {
    if (pathname === "/usage") setDetail(null);
  }, [pathname]);

  if (!detail) return null;

  const action = ACTION_LABEL[detail.action] || "this action";
  const close = () => setDetail(null);
  const goAddCredits = () => { close(); router.push("/usage"); };

  return (
    <div className="credit-modal-overlay" onClick={close}>
      <div className="credit-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <span className="credit-modal-icon"><Icon name="wallet" size={26} /></span>
        <h3>Not enough credits</h3>
        <p>
          You've used up your free {action} and don't have enough credits to continue.
          Add credits to keep going.
        </p>
        <div className="credit-modal-actions">
          <button className="credit-btn ghost" onClick={close}>Not now</button>
          <button className="credit-btn primary" onClick={goAddCredits}>Add credits</button>
        </div>
      </div>
    </div>
  );
}
