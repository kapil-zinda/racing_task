"use client";
// Shared Goal OS header tools: global search (goals + nodes) and a notifications bell.

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { search as apiSearch, listNotifications } from "../../lib/goalApi";

function GlobalSearch() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [res, setRes] = useState(null);
  const [open, setOpen] = useState(false);
  const timer = useRef(null);

  useEffect(() => {
    if (!q.trim()) { setRes(null); return; }
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try { setRes(await apiSearch(q.trim(), 8)); setOpen(true); } catch (_) { /* ignore */ }
    }, 250);
    return () => clearTimeout(timer.current);
  }, [q]);

  const go = (href) => { setOpen(false); setQ(""); router.push(href); };
  const hasHits = res && (res.goals?.length || res.nodes?.length);

  return (
    <div className="gsearch">
      <input className="gsearch-input" placeholder="🔍 Search goals & nodes…" value={q}
             onChange={(e) => setQ(e.target.value)} onFocus={() => res && setOpen(true)}
             onBlur={() => setTimeout(() => setOpen(false), 150)} />
      {open && res && (
        <div className="gsearch-dropdown">
          {!hasHits && <div className="goal-hint" style={{ padding: 10 }}>No matches.</div>}
          {res.goals?.map((g) => (
            <button key={`g-${g.id}`} className="gsearch-item" onMouseDown={() => go(`/goals/${g.id}`)}>
              <span>{g.icon} {g.name}</span><span className="gsearch-tag">goal · {g.progress}%</span>
            </button>
          ))}
          {res.nodes?.map((n) => (
            <button key={`n-${n.id}`} className="gsearch-item" onMouseDown={() => go(`/goals/${n.goal_id}`)}>
              <span className={`tree-status-dot s-${n.status}`} /> {n.title}
              <span className="gsearch-tag">{n.type || "node"} · {n.progress}%</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function NotificationsBell() {
  const router = useRouter();
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    try { const d = await listNotifications(); setItems(d.notifications || []); } catch (_) { /* ignore */ }
  }, []);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="gbell">
      <button className="goal-btn ghost" onClick={() => { setOpen((v) => !v); if (!open) load(); }} title="Notifications">
        🔔{items.length > 0 && <span className="gbell-badge">{items.length}</span>}
      </button>
      {open && (
        <div className="gsearch-dropdown gbell-dropdown">
          {items.length === 0 ? <div className="goal-hint" style={{ padding: 10 }}>No notifications.</div>
            : items.map((n) => (
              <button key={n.id} className="gsearch-item" onMouseDown={() => { setOpen(false); if (n.goal_id) router.push(`/goals/${n.goal_id}`); }}>
                <span>{n.type}</span><span className="gsearch-tag">{(n.time || "").slice(0, 16).replace("T", " ")}</span>
              </button>
            ))}
        </div>
      )}
    </div>
  );
}

export default function GoalHeaderTools() {
  return (
    <div className="goal-header-tools">
      <GlobalSearch />
      <NotificationsBell />
    </div>
  );
}
