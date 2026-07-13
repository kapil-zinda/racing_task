"use client";
// Study groups — mirrors the mobile app's Groups tab: my groups, create/join/search,
// and a group detail view (who's studying now + group leaderboard).

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../lib/auth";
import Icon from "./Icon";
import { alertDialog, confirmDialog } from "../lib/dialog";
import { friendlyApiError } from "../lib/errors";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "";
const LIVE_POLL_MS = 20000;

function fmtMins(m) {
  const mins = Math.max(0, Number(m) || 0);
  if (!mins) return "0m";
  const h = Math.floor(mins / 60), rem = mins % 60;
  return h === 0 ? `${rem}m` : rem === 0 ? `${h}h` : `${h}h ${rem}m`;
}

function statusVisual(status) {
  if (status === "active") return { icon: "play", label: "Studying now", className: "active" };
  if (status === "recent") return { icon: "clock", label: "Recently active", className: "recent" };
  return { icon: "user", label: "Offline", className: "off" };
}

// "Who's studying" grid — one card per member with a live-status badge and today's time.
function MemberGrid({ rows }) {
  if (!rows.length) return <p className="dt-empty">No members yet.</p>;
  return (
    <div className="gp-member-grid">
      {rows.map((r) => {
        const v = statusVisual(r.status);
        return (
          <div className="gp-member-card" key={r.user_id} title={v.label}>
            <span className={`gp-member-badge ${v.className}`}><Icon name={v.icon} size={18} /></span>
            <span className="gp-member-name">{r.name}</span>
            <span className="gp-member-time">{fmtMins(Math.floor((r.today_seconds || 0) / 60))}</span>
            {r.status === "active" && r.category ? <span className="gp-member-cat">{r.category}</span> : null}
          </div>
        );
      })}
    </div>
  );
}

function GroupDetail({ group, onBack, onLeft }) {
  const [members, setMembers] = useState([]);
  const [live, setLive] = useState([]);
  const [error, setError] = useState("");

  const loadGroup = useCallback(async () => {
    try {
      const res = await apiFetch(`${API_BASE_URL}/groups/${group._id}`);
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json();
      setMembers(Array.isArray(data.members) ? data.members : []);
    } catch (err) { setError(friendlyApiError(err)); }
  }, [group._id]);

  const loadLive = useCallback(async () => {
    try {
      const res = await apiFetch(`${API_BASE_URL}/groups/${group._id}/live-status`);
      if (!res.ok) return;
      const data = await res.json();
      setLive(Array.isArray(data.members) ? data.members : []);
    } catch (_) {}
  }, [group._id]);

  useEffect(() => { loadGroup(); }, [loadGroup]);
  useEffect(() => {
    loadLive();
    const poll = setInterval(loadLive, LIVE_POLL_MS);
    return () => clearInterval(poll);
  }, [loadLive]);

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(group.join_code || "");
      await alertDialog({ title: "Copied", message: `Join code ${group.join_code} copied to clipboard.`, tone: "success" });
    } catch (_) {}
  };

  const leave = async () => {
    if (!(await confirmDialog({ title: "Leave group", message: `Leave "${group.name}"?`, confirmLabel: "Leave", danger: true }))) return;
    try {
      const res = await apiFetch(`${API_BASE_URL}/groups/${group._id}/leave`, { method: "POST" });
      if (!res.ok) throw new Error(`${res.status}`);
      onLeft();
    } catch (err) { setError(friendlyApiError(err)); }
  };

  const memberCount = live.length || members.length || group.member_count || 0;

  return (
    <div className="gp-detail">
      <div className="gp-detail-head">
        <button className="gp-back-btn" onClick={onBack}><Icon name="arrow-left" size={14} /> All groups</button>
        <button className="gp-leave-btn" onClick={leave}>Leave group</button>
      </div>
      <h3 className="gp-detail-name">{group.name}</h3>
      {group.description ? <p className="gp-detail-desc">{group.description}</p> : null}
      <p className="gp-detail-meta">
        {memberCount} member{memberCount === 1 ? "" : "s"} · code <b>{group.join_code}</b>
        <button className="dt-icon-btn" onClick={copyCode} title="Copy join code"><Icon name="copy" size={13} /></button>
      </p>

      {error ? <p className="api-state error">{error}</p> : null}

      <div className="gp-section-label">Members</div>
      <MemberGrid rows={live} />
    </div>
  );
}

const EMPTY_CREATE = { name: "", description: "", is_public: true };

export default function GroupsPanel() {
  const [groups, setGroups] = useState([]);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [createDraft, setCreateDraft] = useState(EMPTY_CREATE);
  const [joinOpen, setJoinOpen] = useState(false);
  const [joinCode, setJoinCode] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [searched, setSearched] = useState(false);

  const load = useCallback(async () => {
    if (!API_BASE_URL) return;
    setLoading(true); setError("");
    try {
      const res = await apiFetch(`${API_BASE_URL}/groups/mine`);
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json();
      setGroups(Array.isArray(data.groups) ? data.groups : []);
    } catch (err) { setError(friendlyApiError(err)); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async () => {
    const name = createDraft.name.trim();
    if (!name || busy) return;
    setBusy(true);
    try {
      const res = await apiFetch(`${API_BASE_URL}/groups`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description: createDraft.description.trim(), is_public: createDraft.is_public }),
      });
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json();
      setCreateOpen(false);
      setCreateDraft(EMPTY_CREATE);
      await load();
      await alertDialog({ title: "Group created", message: `Share join code ${data.group?.join_code || ""} so others can join.`, tone: "success" });
    } catch (err) { setError(friendlyApiError(err)); }
    finally { setBusy(false); }
  };

  const handleJoinByCode = async () => {
    const code = joinCode.trim();
    if (!code || busy) return;
    setBusy(true);
    try {
      const res = await apiFetch(`${API_BASE_URL}/groups/join-by-code`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ join_code: code }),
      });
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json();
      setJoinOpen(false); setJoinCode("");
      await load();
      await alertDialog({
        title: data.already_member ? "Already a member" : "Joined",
        message: data.already_member ? `You are already in ${data.group?.name || "this group"}.` : `Welcome to ${data.group?.name || "the group"}.`,
        tone: "success",
      });
    } catch (err) {
      await alertDialog({ title: "Could not join", message: friendlyApiError(err), tone: "error" });
    } finally { setBusy(false); }
  };

  const runSearch = async () => {
    try {
      const res = await apiFetch(`${API_BASE_URL}/groups/search?q=${encodeURIComponent(query)}`);
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json();
      setResults(Array.isArray(data.groups) ? data.groups : []);
      setSearched(true);
    } catch (err) { setError(friendlyApiError(err)); }
  };

  const handleJoinSearch = async (g) => {
    try {
      const res = await apiFetch(`${API_BASE_URL}/groups/${g._id}/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ join_code: "" }),
      });
      if (!res.ok) throw new Error(`${res.status}`);
      setSearchOpen(false);
      await load();
    } catch (err) {
      await alertDialog({ title: "Could not join", message: friendlyApiError(err), tone: "error" });
    }
  };

  if (selected) {
    return (
      <GroupDetail
        group={selected}
        onBack={() => setSelected(null)}
        onLeft={() => { setSelected(null); load(); }}
      />
    );
  }

  return (
    <div className="gp-wrap">
      <div className="gp-actions">
        <button className="dt-add-btn" onClick={() => setCreateOpen(true)}><Icon name="plus" size={13} /> Create group</button>
        <button className="dt-today-btn" onClick={() => { setJoinCode(""); setJoinOpen(true); }}>Join by code</button>
        <button className="dt-today-btn" onClick={() => { setQuery(""); setResults([]); setSearched(false); setSearchOpen(true); }}>
          Search public groups
        </button>
      </div>

      {error ? <p className="api-state error">{error}</p> : null}

      {loading ? <p className="dt-empty">Loading…</p>
        : groups.length === 0 ? <p className="dt-empty">You haven&apos;t joined any groups yet. Create one or join with a code.</p>
        : groups.map((g) => (
          <button className="gp-card" key={g._id} onClick={() => setSelected(g)}>
            <span className="gp-card-icon"><Icon name="users" size={18} /></span>
            <span className="gp-card-main">
              <span className="gp-card-name">{g.name}</span>
              <span className="gp-card-meta">{g.member_count} member{g.member_count === 1 ? "" : "s"} · code {g.join_code}</span>
            </span>
            <Icon name="chevron-right" size={16} />
          </button>
        ))}

      {createOpen ? (
        <div className="task-modal-overlay" role="dialog" aria-modal="true">
          <div className="task-modal dt-modal">
            <h3>Create group</h3>
            <div className="session-form-grid">
              <input className="task-select" placeholder="Group name (e.g. UPSC 2027 Batch)" value={createDraft.name} autoFocus
                onChange={(e) => setCreateDraft((p) => ({ ...p, name: e.target.value }))} />
              <input className="task-select" placeholder="Description (optional)" value={createDraft.description}
                onChange={(e) => setCreateDraft((p) => ({ ...p, description: e.target.value }))} />
            </div>
            <div className="gp-vis-row">
              <button className={`gp-vis-pill${createDraft.is_public ? " on" : ""}`} onClick={() => setCreateDraft((p) => ({ ...p, is_public: true }))}>
                <b>Public</b><span>Anyone can find &amp; join</span>
              </button>
              <button className={`gp-vis-pill${!createDraft.is_public ? " on" : ""}`} onClick={() => setCreateDraft((p) => ({ ...p, is_public: false }))}>
                <b>Private</b><span>Join code only</span>
              </button>
            </div>
            <div className="task-modal-actions">
              <button className="btn-cancel" onClick={() => setCreateOpen(false)}>Cancel</button>
              <button className="btn-save" onClick={handleCreate} disabled={!createDraft.name.trim() || busy}>
                {busy ? "Creating…" : "Create group"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {joinOpen ? (
        <div className="task-modal-overlay" role="dialog" aria-modal="true">
          <div className="task-modal dt-modal">
            <h3>Join by code</h3>
            <div className="session-form-grid">
              <input className="task-select" placeholder="Join code (e.g. AB3K9Q)" value={joinCode} autoFocus
                onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                onKeyDown={(e) => e.key === "Enter" && handleJoinByCode()} />
            </div>
            <div className="task-modal-actions">
              <button className="btn-cancel" onClick={() => setJoinOpen(false)}>Cancel</button>
              <button className="btn-save" onClick={handleJoinByCode} disabled={!joinCode.trim() || busy}>
                {busy ? "Joining…" : "Join"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {searchOpen ? (
        <div className="task-modal-overlay" role="dialog" aria-modal="true">
          <div className="task-modal dt-modal">
            <h3>Search public groups</h3>
            <div className="gp-search-row">
              <input className="task-select" placeholder="Search groups…" value={query} autoFocus
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && runSearch()} />
              <button className="dt-add-btn" onClick={runSearch}><Icon name="search" size={13} /> Search</button>
            </div>
            <div className="gp-search-results">
              {results.map((g) => (
                <div className="gp-card static" key={g._id}>
                  <span className="gp-card-icon"><Icon name="users" size={18} /></span>
                  <span className="gp-card-main">
                    <span className="gp-card-name">{g.name}</span>
                    <span className="gp-card-meta">{g.member_count} member{g.member_count === 1 ? "" : "s"}</span>
                  </span>
                  <button className="dt-add-btn" onClick={() => handleJoinSearch(g)}>Join</button>
                </div>
              ))}
              {searched && results.length === 0 ? <p className="dt-empty">No public groups matched.</p> : null}
            </div>
            <div className="task-modal-actions">
              <button className="btn-cancel" onClick={() => setSearchOpen(false)}>Close</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
