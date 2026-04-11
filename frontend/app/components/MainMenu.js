"use client";

import Link from "next/link";

function isActive(groupActive, values) {
  return values.includes(groupActive);
}

export default function MainMenu({ active = "" }) {
  const activityActive = isActive(active, ["recorder", "syllabus", "mission"]);
  const resourcesActive = isActive(active, ["content", "search"]);

  return (
    <div className="main-menu">
      <Link href="/" className={`menu-pill ${active === "home" ? "active" : ""}`}>Home</Link>

      <Link href="/recorder" className={`menu-pill ${activityActive ? "active" : ""}`}>Activities</Link>
      <Link href="/search" className={`menu-pill ${resourcesActive ? "active" : ""}`}>Resources</Link>
    </div>
  );
}
