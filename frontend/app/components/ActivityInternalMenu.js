"use client";

import Link from "next/link";

export default function ActivityInternalMenu({ active = "recorder" }) {
  return (
    <div className="menu-inline" style={{ justifyContent: "center", marginBottom: 8 }}>
      <Link href="/recorder" className={`menu-chip ${active === "recorder" ? "active" : ""}`}>Recorder</Link>
      <Link href="/syllabus" className={`menu-chip ${active === "syllabus" ? "active" : ""}`}>Syllabus</Link>
      <Link href="/mission" className={`menu-chip ${active === "mission" ? "active" : ""}`}>Mission</Link>
    </div>
  );
}

