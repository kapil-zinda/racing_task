"use client";
// Noter editor — title + BlockNote body, autosaved, with an S3-backed version
// history drawer (list every snapshot, preview it read-only, restore it).

import "../noter.css";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import MainMenu from "../../components/MainMenu";
import Icon from "../../components/Icon";
import {
  getNoterDoc,
  saveNoterDoc,
  deleteNoterDoc,
  listNoterVersions,
  getNoterVersion,
  restoreNoterVersion,
} from "../../lib/noterApi";
import { friendlyApiError } from "../../lib/errors";
import { confirmDialog } from "../../lib/dialog";

// Rich text editing needs a live DOM; never server-rendered.
const NoterEditor = dynamic(() => import("../NoterEditor"), { ssr: false });

const SAVE_DEBOUNCE_MS = 1500;

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

const STATUS_COPY = {
  loading: "Loading…",
  saved: "Saved",
  saving: "Saving…",
  unsaved: "Unsaved changes",
  error: "Couldn't save — retrying",
};

export default function NoterDocPage() {
  const { docId } = useParams();
  const router = useRouter();

  const [status, setStatus] = useState("loading");
  const [loadError, setLoadError] = useState("");
  const [title, setTitle] = useState("");
  const [lastSavedAt, setLastSavedAt] = useState(null);
  const [docRevision, setDocRevision] = useState(0); // bump to force-remount the editor (e.g. after restore)
  const [deleting, setDeleting] = useState(false);
  const [savingVersion, setSavingVersion] = useState(false);

  const initialContentRef = useRef([]);
  const contentRef = useRef([]);
  const titleRef = useRef("");
  const saveTimerRef = useRef(null);
  const dirtyRef = useRef(false);

  const [historyOpen, setHistoryOpen] = useState(false);
  const [versions, setVersions] = useState([]);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [versionsError, setVersionsError] = useState("");
  const [selectedVersion, setSelectedVersion] = useState(null); // { id, savedAt, title, content } | null
  const [versionLoading, setVersionLoading] = useState(false);
  const [restoring, setRestoring] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setStatus("loading");
      setLoadError("");
      try {
        const data = await getNoterDoc(docId);
        if (cancelled) return;
        setTitle(data.doc.title || "");
        titleRef.current = data.doc.title || "";
        initialContentRef.current = data.doc.content || [];
        contentRef.current = data.doc.content || [];
        setLastSavedAt(data.doc.updatedAt || null);
        setStatus("saved");
      } catch (err) {
        if (!cancelled) {
          setLoadError(friendlyApiError(err));
          setStatus("error");
        }
      }
    })();
    return () => { cancelled = true; };
  }, [docId]);

  const doSave = useCallback(async (force = false) => {
    if (saveTimerRef.current) { clearTimeout(saveTimerRef.current); saveTimerRef.current = null; }
    setStatus("saving");
    try {
      const data = await saveNoterDoc(docId, { title: titleRef.current, content: contentRef.current, snapshot: force });
      dirtyRef.current = false;
      setLastSavedAt(data.updatedAt);
      setStatus("saved");
      return true;
    } catch (err) {
      setStatus("error");
      return false;
    }
  }, [docId]);

  const scheduleSave = useCallback(() => {
    dirtyRef.current = true;
    setStatus("unsaved");
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => { doSave(false); }, SAVE_DEBOUNCE_MS);
  }, [doSave]);

  useEffect(() => () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); }, []);

  // Warn on tab close with edits still in flight or debounced.
  useEffect(() => {
    const handler = (e) => {
      if (status === "unsaved" || status === "saving") {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [status]);

  const handleTitleChange = (e) => {
    const value = e.target.value;
    setTitle(value);
    titleRef.current = value;
    scheduleSave();
  };

  const handleContentChange = useCallback((doc) => {
    contentRef.current = doc;
    scheduleSave();
  }, [scheduleSave]);

  const handleSaveVersionNow = async () => {
    if (savingVersion) return;
    setSavingVersion(true);
    const ok = await doSave(true);
    setSavingVersion(false);
    if (ok && historyOpen) loadVersions();
  };

  const handleDelete = async () => {
    const ok = await confirmDialog({
      title: "Delete document",
      message: `Delete "${title || "Untitled"}"? This removes it and its entire version history. This can't be undone.`,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    setDeleting(true);
    try {
      await deleteNoterDoc(docId);
      router.push("/noter");
    } catch (err) {
      setLoadError(friendlyApiError(err));
      setDeleting(false);
    }
  };

  const loadVersions = useCallback(async () => {
    setVersionsLoading(true);
    setVersionsError("");
    try {
      const data = await listNoterVersions(docId);
      setVersions(data.versions || []);
    } catch (err) {
      setVersionsError(friendlyApiError(err));
    } finally {
      setVersionsLoading(false);
    }
  }, [docId]);

  const openHistory = () => {
    setHistoryOpen(true);
    setSelectedVersion(null);
    loadVersions();
  };

  const closeHistory = () => {
    setHistoryOpen(false);
    setSelectedVersion(null);
  };

  const openVersionPreview = async (version) => {
    setVersionLoading(true);
    setVersionsError("");
    try {
      const data = await getNoterVersion(docId, version.id);
      setSelectedVersion(data.version);
    } catch (err) {
      setVersionsError(friendlyApiError(err));
    } finally {
      setVersionLoading(false);
    }
  };

  const handleRestore = async () => {
    if (!selectedVersion || restoring) return;
    const ok = await confirmDialog({
      title: "Restore this version",
      message: `Replace the current document with the version from ${formatDate(selectedVersion.savedAt)}? Your current state is saved as a version first, so this is reversible.`,
      confirmLabel: "Restore",
    });
    if (!ok) return;
    setRestoring(true);
    try {
      const data = await restoreNoterVersion(docId, selectedVersion.id);
      titleRef.current = data.doc.title;
      contentRef.current = data.doc.content;
      initialContentRef.current = data.doc.content;
      setTitle(data.doc.title);
      setLastSavedAt(data.doc.updatedAt);
      setDocRevision((v) => v + 1); // remounts the editor with the restored content
      setStatus("saved");
      closeHistory();
    } catch (err) {
      setVersionsError(friendlyApiError(err));
    } finally {
      setRestoring(false);
    }
  };

  const statusLabel = STATUS_COPY[status] || "";
  const savedHint = status === "saved" && lastSavedAt ? `Saved ${formatDate(lastSavedAt)}` : statusLabel;

  if (status === "loading") {
    return (
      <div className="noter-page">
        <MainMenu active="noter" />
        <div className="noter-editor-shell">
          <div className="noter-doc-loading" role="status" aria-label="Loading document">
            <div className="noter-skeleton-line noter-skeleton-line-title" style={{ maxWidth: 320 }} />
            <div className="noter-skeleton-line" />
            <div className="noter-skeleton-line" />
            <div className="noter-skeleton-line noter-skeleton-line-short" />
          </div>
        </div>
      </div>
    );
  }

  if (loadError && status === "error" && !titleRef.current && !contentRef.current.length) {
    return (
      <div className="noter-page">
        <MainMenu active="noter" />
        <div className="noter-editor-shell">
          <div className="noter-error">{loadError}</div>
          <a className="noter-back-link" href="/noter" onClick={(e) => { e.preventDefault(); router.push("/noter"); }}>
            <Icon name="chevron-left" size={14} /> Back to Noter
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="noter-page">
      <MainMenu active="noter" />
      <div className="noter-editor-shell">
        <div className="noter-editor-topbar">
          <a className="noter-back-link" href="/noter" onClick={(e) => { e.preventDefault(); router.push("/noter"); }}>
            <Icon name="chevron-left" size={14} /> Noter
          </a>
          <div className="noter-editor-topbar-actions">
            <span className={`noter-save-status is-${status}`}>{savedHint}</span>
            <button className="noter-btn ghost" onClick={handleSaveVersionNow} disabled={savingVersion}>
              <Icon name="history" size={14} /> Save version
            </button>
            <button className="noter-btn ghost" onClick={openHistory}>
              <Icon name="clock" size={14} /> History
            </button>
            <button className="noter-icon-btn danger" onClick={handleDelete} disabled={deleting} aria-label="Delete document" title="Delete">
              <Icon name="trash" size={15} />
            </button>
          </div>
        </div>

        <div className="noter-editor-surface">
          <input
            className="noter-title-input"
            value={title}
            onChange={handleTitleChange}
            placeholder="Untitled"
            aria-label="Document title"
          />
          <NoterEditor
            key={`${docId}-${docRevision}`}
            docId={docId}
            initialContent={initialContentRef.current}
            onChange={handleContentChange}
          />
        </div>
      </div>

      {historyOpen && (
        <>
          <div className="noter-history-backdrop" onClick={closeHistory} aria-hidden="true" />
          <aside className="noter-history-panel" role="dialog" aria-label="Version history">
            <div className="noter-history-head">
              <h2>Version history</h2>
              <button className="noter-icon-btn" onClick={closeHistory} aria-label="Close version history">
                <Icon name="close" size={16} />
              </button>
            </div>

            {selectedVersion ? (
              <div className="noter-version-preview">
                <button className="noter-back-link noter-version-back" onClick={() => setSelectedVersion(null)}>
                  <Icon name="chevron-left" size={14} /> All versions
                </button>
                <div className="noter-version-meta">
                  <strong>{selectedVersion.title || "Untitled"}</strong>
                  <span>{formatDate(selectedVersion.savedAt)}</span>
                </div>
                <div className="noter-version-preview-body">
                  <NoterEditor
                    key={`preview-${selectedVersion.id}`}
                    docId={docId}
                    initialContent={selectedVersion.content}
                    editable={false}
                  />
                </div>
                <div className="noter-version-preview-actions">
                  <button className="noter-btn primary" onClick={handleRestore} disabled={restoring}>
                    <Icon name="restore" size={14} /> {restoring ? "Restoring…" : "Restore this version"}
                  </button>
                </div>
              </div>
            ) : (
              <div className="noter-version-list">
                {versionsError && <div className="noter-error">{versionsError}</div>}
                {versionsLoading ? (
                  <div className="noter-version-list-loading" role="status">Loading versions…</div>
                ) : versions.length === 0 ? (
                  <p className="noter-version-empty">No saved versions yet.</p>
                ) : (
                  versions.map((v, i) => (
                    <button key={v.id} className="noter-version-row" onClick={() => openVersionPreview(v)} disabled={versionLoading}>
                      <Icon name="history" size={14} />
                      <span className="noter-version-row-date">{formatDate(v.savedAt)}</span>
                      {i === 0 && <span className="noter-version-badge">Latest</span>}
                    </button>
                  ))
                )}
              </div>
            )}
          </aside>
        </>
      )}
    </div>
  );
}
