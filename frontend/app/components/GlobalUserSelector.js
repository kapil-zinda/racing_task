"use client";

import { useEffect, useState } from "react";

const STORAGE_KEY = "global_user_id";
const VALID_USERS = ["kapil", "divya"];

function readGlobalUser() {
  if (typeof window === "undefined") return "kapil";
  const raw = (window.localStorage.getItem(STORAGE_KEY) || "kapil").toLowerCase().trim();
  return VALID_USERS.includes(raw) ? raw : "kapil";
}

function writeGlobalUser(userId) {
  if (typeof window === "undefined") return;
  const value = VALID_USERS.includes(userId) ? userId : "kapil";
  window.localStorage.setItem(STORAGE_KEY, value);
  window.dispatchEvent(new CustomEvent("global-user-change", { detail: { userId: value } }));
}

export default function GlobalUserSelector() {
  const [userId, setUserId] = useState("kapil");

  useEffect(() => {
    setUserId(readGlobalUser());
  }, []);

  return (
    <div className="global-user-select-wrap">
      <label htmlFor="global-user-select" className="global-user-label">User</label>
      <select
        id="global-user-select"
        className="global-user-select"
        value={userId}
        onChange={(e) => {
          const next = e.target.value;
          setUserId(next);
          writeGlobalUser(next);
        }}
      >
        <option value="kapil">Kapil</option>
        <option value="divya">Divya</option>
      </select>
    </div>
  );
}

