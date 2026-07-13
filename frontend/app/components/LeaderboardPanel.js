"use client";
// Leaderboard — mirrors the mobile app: Today / This week / All-time pills over a
// ranked list of tracked study time. Renders the global board by default, or a
// group's board when `groupId` is passed.

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../lib/auth";
import Icon from "./Icon";
import { friendlyApiError } from "../lib/errors";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "";

const PERIODS = [
  { key: "today", label: "Today" },
  { key: "week", label: "This week" },
  { key: "all", label: "All-time" },
];

function fmtMins(m) {
  const mins = Math.max(0, Number(m) || 0);
  if (!mins) return "0m";
  const h = Math.floor(mins / 60), rem = mins % 60;
  return h === 0 ? `${rem}m` : rem === 0 ? `${h}h` : `${h}h ${rem}m`;
}

export default function LeaderboardPanel({ groupId = "", embedded = false }) {
  const [period, setPeriod] = useState("week");
  const [rows, setRows] = useState([]);
  const [me, setMe] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!API_BASE_URL) return;
    setLoading(true); setError("");
    try {
      const url = groupId
        ? `${API_BASE_URL}/leaderboard/group/${groupId}?period=${period}`
        : `${API_BASE_URL}/leaderboard/global?period=${period}`;
      const res = await apiFetch(url);
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json();
      setRows(Array.isArray(data.rows) ? data.rows : []);
      setMe(data.me || null);
    } catch (err) { setError(friendlyApiError(err)); }
    finally { setLoading(false); }
  }, [groupId, period]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="lb-wrap">
      {!embedded && (
        <div className="lb-head">
          <Icon name="trophy" size={16} />
          <span className="lb-title">Leaderboard</span>
          <span className="lb-note">Ranks count timer sessions from the mobile/desktop app.</span>
        </div>
      )}

      <div className="lb-pills">
        {PERIODS.map((p) => (
          <button key={p.key} className={`ts-chip${period === p.key ? " lb-pill-on" : ""}`} onClick={() => setPeriod(p.key)}>
            {p.label}
          </button>
        ))}
      </div>

      {error ? <p className="api-state error">{error}</p> : null}

      {loading ? <p className="dt-empty">Loading…</p>
        : rows.length === 0 ? <p className="dt-empty">No study time recorded for this period yet.</p>
        : (
          <div className="lb-list">
            {rows.slice(0, 100).map((row) => {
              const isMe = me?.user_id === row.user_id;
              return (
                <div className={`lb-row${isMe ? " me" : ""}`} key={row.user_id}>
                  <span className="lb-rank">#{row.rank}</span>
                  <span className="lb-name">{isMe ? "You" : row.name}</span>
                  {isMe && row.percentile != null ? <span className="lb-pct">top {row.percentile}%</span> : null}
                  <span className="lb-mins">{fmtMins(row.total_minutes)}</span>
                </div>
              );
            })}
          </div>
        )}
    </div>
  );
}
