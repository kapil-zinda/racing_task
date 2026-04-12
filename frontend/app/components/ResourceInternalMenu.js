"use client";

import Link from "next/link";

export default function ResourceInternalMenu({ active = "search" }) {
  return (
    <div className="menu-inline" style={{ justifyContent: "center", marginBottom: 8 }}>
      <Link href="/qna" className={`menu-chip ${active === "qna" ? "active" : ""}`}>QnA</Link>
      <Link href="/search" className={`menu-chip ${active === "search" ? "active" : ""}`}>Search</Link>
      <Link href="/content" className={`menu-chip ${active === "content" ? "active" : ""}`}>Content</Link>
    </div>
  );
}
