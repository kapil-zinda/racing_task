"use client";
// Noter — directory view (folders + docs), mirroring the Content drive's
// create/rename/move/copy/duplicate/delete model. Opening a doc goes to
// /noter/[docId] where the BlockNote editor lives.

import "./noter.css";
import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import MainMenu from "../components/MainMenu";
import Icon from "../components/Icon";
import {
  listNoterItems,
  createNoterDoc,
  getNoterFolderTree,
  createNoterFolder,
  renameNoterItem,
  moveNoterItem,
  copyNoterItem,
  duplicateNoterItem,
  deleteNoterItem,
} from "../lib/noterApi";
import { friendlyApiError } from "../lib/errors";
import { confirmDialog } from "../lib/dialog";

function formatUpdated(value) {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

function isBlockedDestination(candidate, sourceItem, foldersById) {
  if (!candidate || !sourceItem || sourceItem.type !== "folder") return false;
  if (candidate.id === sourceItem.id) return true;
  let cur = foldersById[candidate.id];
  while (cur && cur.parent_id) {
    if (cur.parent_id === sourceItem.id) return true;
    cur = foldersById[cur.parent_id];
  }
  return false;
}

export default function NoterListPage() {
  const router = useRouter();
  const pathname = usePathname();

  const [allFolders, setAllFolders] = useState([]);
  const [rootId, setRootId] = useState("");
  const [folderId, setFolderId] = useState("");
  const [currentFolder, setCurrentFolder] = useState(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [creating, setCreating] = useState(false);

  const [actionMenu, setActionMenu] = useState({ open: false, x: 0, y: 0, item: null });
  const [newFolderModal, setNewFolderModal] = useState({ open: false, name: "", saving: false });
  const [renameModal, setRenameModal] = useState({ open: false, item: null, name: "", saving: false });
  const [picker, setPicker] = useState({ open: false, mode: "move", item: null, locationId: "", saving: false });

  const foldersById = useMemo(() => Object.fromEntries(allFolders.map((f) => [f.id, f])), [allFolders]);

  const breadcrumb = useMemo(() => {
    const chain = [];
    let cur = folderId ? foldersById[folderId] : null;
    while (cur) {
      chain.unshift(cur);
      cur = cur.parent_id ? foldersById[cur.parent_id] : null;
    }
    return chain.map((f) => ({ id: f.id, label: f.parent_id === null ? "Noter" : f.name }));
  }, [folderId, foldersById]);

  const getUrlFolderId = () => {
    if (typeof window === "undefined") return "";
    return new URLSearchParams(window.location.search || "").get("folder") || "";
  };

  const syncFolderInUrl = (id) => {
    const params = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
    if (id) params.set("folder", id); else params.delete("folder");
    const next = params.toString() ? `${pathname}?${params.toString()}` : pathname;
    router.replace(next, { scroll: false });
  };

  const loadTree = useCallback(async () => {
    try {
      const data = await getNoterFolderTree();
      setAllFolders(data.folders || []);
      setRootId(data.root_id || "");
    } catch (err) {
      setError(friendlyApiError(err));
    }
  }, []);

  const loadItems = useCallback(async (id) => {
    setLoading(true);
    setError("");
    try {
      const data = await listNoterItems(id);
      setCurrentFolder(data.folder || null);
      setFolderId(data.folder?.id || "");
      setItems(data.items || []);
    } catch (err) {
      setError(friendlyApiError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const initial = getUrlFolderId();
    loadTree();
    loadItems(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onPopState = () => {
      const id = getUrlFolderId();
      if (id !== folderId) loadItems(id);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folderId]);

  useEffect(() => {
    const close = () => setActionMenu({ open: false, x: 0, y: 0, item: null });
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, []);

  useEffect(() => {
    if (!message) return;
    const id = setTimeout(() => setMessage(""), 4000);
    return () => clearTimeout(id);
  }, [message]);

  const refresh = useCallback(async () => {
    await Promise.all([loadTree(), loadItems(folderId)]);
  }, [loadTree, loadItems, folderId]);

  const openFolder = (id) => {
    setActionMenu({ open: false, x: 0, y: 0, item: null });
    syncFolderInUrl(id);
    loadItems(id);
  };

  const openItem = (item) => {
    if (item.type === "folder") openFolder(item.id);
    else router.push(`/noter/${item.id}`);
  };

  const handleCreateDoc = async () => {
    if (creating) return;
    setCreating(true);
    try {
      const data = await createNoterDoc({ title: "Untitled", content: [], parent_id: folderId });
      router.push(`/noter/${data.doc.id}`);
    } catch (err) {
      setError(friendlyApiError(err));
      setCreating(false);
    }
  };

  const openRowMenu = (e, item) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    setActionMenu({ open: true, x: Math.round(rect.right - 8), y: Math.round(rect.bottom + 6), item });
  };

  const closeRowMenu = () => setActionMenu({ open: false, x: 0, y: 0, item: null });

  const openNewFolderModal = () => setNewFolderModal({ open: true, name: "", saving: false });
  const closeNewFolderModal = () => setNewFolderModal({ open: false, name: "", saving: false });

  const submitNewFolder = async () => {
    const name = newFolderModal.name.trim();
    if (!name) return;
    setNewFolderModal((s) => ({ ...s, saving: true }));
    try {
      await createNoterFolder(folderId, name);
      closeNewFolderModal();
      await refresh();
    } catch (err) {
      setError(friendlyApiError(err));
      setNewFolderModal((s) => ({ ...s, saving: false }));
    }
  };

  const openRenameModal = (item) => {
    closeRowMenu();
    setRenameModal({ open: true, item, name: item.type === "folder" ? item.name : item.title, saving: false });
  };
  const closeRenameModal = () => setRenameModal({ open: false, item: null, name: "", saving: false });

  const submitRename = async () => {
    const name = renameModal.name.trim();
    const item = renameModal.item;
    if (!name || !item) return;
    setRenameModal((s) => ({ ...s, saving: true }));
    try {
      await renameNoterItem(item.id, item.type, name);
      closeRenameModal();
      await refresh();
    } catch (err) {
      setError(friendlyApiError(err));
      setRenameModal((s) => ({ ...s, saving: false }));
    }
  };

  const handleDuplicate = async (item) => {
    closeRowMenu();
    try {
      await duplicateNoterItem(item.id, item.type);
      setMessage(item.type === "folder" ? "Folder duplicated" : "Document duplicated");
      await refresh();
    } catch (err) {
      setError(friendlyApiError(err));
    }
  };

  const handleDelete = async (item) => {
    closeRowMenu();
    const label = item.type === "folder" ? item.name : item.title;
    const ok = await confirmDialog({
      title: item.type === "folder" ? "Delete folder" : "Delete document",
      message: item.type === "folder"
        ? `Delete "${label}" and everything inside it — subfolders, documents, and their version history? This can't be undone.`
        : `Delete "${label}"? This removes it and its entire version history. This can't be undone.`,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteNoterItem(item.id, item.type, item.type === "folder");
      setMessage(item.type === "folder" ? "Folder deleted" : "Document deleted");
      await refresh();
    } catch (err) {
      setError(friendlyApiError(err));
    }
  };

  const openPicker = (item, mode) => {
    closeRowMenu();
    setPicker({ open: true, mode, item, locationId: rootId, saving: false });
  };
  const closePicker = () => setPicker({ open: false, mode: "move", item: null, locationId: "", saving: false });

  const submitPicker = async () => {
    const { item, mode, locationId } = picker;
    if (!item) return;
    setPicker((s) => ({ ...s, saving: true }));
    try {
      if (mode === "move") await moveNoterItem(item.id, item.type, locationId);
      else await copyNoterItem(item.id, item.type, locationId);
      setMessage(`${item.type === "folder" ? "Folder" : "Document"} ${mode === "move" ? "moved" : "copied"}`);
      closePicker();
      await refresh();
    } catch (err) {
      setError(friendlyApiError(err));
      setPicker((s) => ({ ...s, saving: false }));
    }
  };

  const pickerChildren = allFolders.filter((f) => f.parent_id === picker.locationId);
  const pickerLocation = foldersById[picker.locationId];
  const pickerBreadcrumb = useMemo(() => {
    const chain = [];
    let cur = foldersById[picker.locationId];
    while (cur) {
      chain.unshift(cur);
      cur = cur.parent_id ? foldersById[cur.parent_id] : null;
    }
    return chain.map((f) => ({ id: f.id, label: f.parent_id === null ? "Noter" : f.name }));
  }, [picker.locationId, foldersById]);
  const pickerCurrentBlocked = picker.item && pickerLocation
    ? isBlockedDestination(pickerLocation, picker.item, foldersById)
    : false;

  const folders = items.filter((i) => i.type === "folder");
  const docs = items.filter((i) => i.type === "doc");

  return (
    <div className="noter-list-page">
      <MainMenu active="noter" />
      <div className="noter-list-container">
        <header className="noter-list-header">
          <div>
            <h1>Noter</h1>
            <p className="noter-list-sub">Free-form notes and write-ups, organised in folders, with full version history.</p>
          </div>
          <div className="noter-header-actions">
            <button className="noter-btn ghost" onClick={openNewFolderModal}>
              <Icon name="folder" size={16} /> New folder
            </button>
            <button className="noter-btn primary" onClick={handleCreateDoc} disabled={creating}>
              <Icon name="plus" size={16} /> New document
            </button>
          </div>
        </header>

        <nav className="noter-breadcrumb" aria-label="Folder path">
          {breadcrumb.map((b, idx) => (
            <span key={b.id} className="noter-breadcrumb-item">
              {idx > 0 && <Icon name="chevron-right" size={12} className="noter-breadcrumb-sep" />}
              {idx === breadcrumb.length - 1 ? (
                <span className="noter-breadcrumb-current">{b.label}</span>
              ) : (
                <button className="noter-breadcrumb-btn" onClick={() => openFolder(b.id)}>{b.label}</button>
              )}
            </span>
          ))}
        </nav>

        {error && <div className="noter-error">{error}</div>}
        {message && <div className="noter-toast" role="status">{message}</div>}

        {loading ? (
          <div className="noter-grid" aria-busy="true">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="noter-card noter-card-skeleton" aria-hidden="true">
                <div className="noter-skeleton-line noter-skeleton-line-title" />
                <div className="noter-skeleton-line" />
                <div className="noter-skeleton-line noter-skeleton-line-short" />
              </div>
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="noter-empty">
            <Icon name="noter" size={32} />
            <h2>This folder is empty</h2>
            <p>Write up revision notes, essays, or anything else — organized in blocks, autosaved, with every version kept.</p>
            <div className="noter-empty-actions">
              <button className="noter-btn ghost" onClick={openNewFolderModal}>
                <Icon name="folder" size={16} /> New folder
              </button>
              <button className="noter-btn primary" onClick={handleCreateDoc} disabled={creating}>
                <Icon name="plus" size={16} /> New document
              </button>
            </div>
          </div>
        ) : (
          <div className="noter-grid">
            {folders.map((item) => (
              <div key={item.id} className="noter-card" onClick={() => openItem(item)} role="button" tabIndex={0}
                   onKeyDown={(e) => { if (e.key === "Enter") openItem(item); }}>
                <div className="noter-card-head">
                  <Icon name="folder" size={16} className="noter-card-icon" />
                  <h3 className="noter-card-title">{item.name}</h3>
                </div>
                <p className="noter-card-preview noter-card-preview-muted">Folder</p>
                <div className="noter-card-foot">
                  <span className="noter-card-updated">Updated {formatUpdated(item.updatedAt)}</span>
                  <button className="noter-icon-btn" onClick={(e) => openRowMenu(e, item)} aria-label={`Actions for ${item.name}`} title="More actions">
                    <Icon name="more" size={15} />
                  </button>
                </div>
              </div>
            ))}
            {docs.map((item) => (
              <div key={item.id} className="noter-card" onClick={() => openItem(item)} role="button" tabIndex={0}
                   onKeyDown={(e) => { if (e.key === "Enter") openItem(item); }}>
                <div className="noter-card-head">
                  <Icon name="noter" size={16} className="noter-card-icon" />
                  <h3 className="noter-card-title">{item.title}</h3>
                </div>
                <p className="noter-card-preview">{item.preview || "Empty document"}</p>
                <div className="noter-card-foot">
                  <span className="noter-card-updated">Updated {formatUpdated(item.updatedAt)}</span>
                  <button className="noter-icon-btn" onClick={(e) => openRowMenu(e, item)} aria-label={`Actions for ${item.title}`} title="More actions">
                    <Icon name="more" size={15} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {actionMenu.open && actionMenu.item && (
        <div className="context-menu" style={{ left: actionMenu.x, top: actionMenu.y }} onClick={(e) => e.stopPropagation()}>
          <button className="context-item" onClick={() => { openItem(actionMenu.item); closeRowMenu(); }}>Open</button>
          <button className="context-item" onClick={() => openRenameModal(actionMenu.item)}>Rename</button>
          <button className="context-item" onClick={() => handleDuplicate(actionMenu.item)}>Duplicate</button>
          <button className="context-item" onClick={() => openPicker(actionMenu.item, "move")}>Move to…</button>
          <button className="context-item" onClick={() => openPicker(actionMenu.item, "copy")}>Copy to…</button>
          <button className="context-item danger" onClick={() => handleDelete(actionMenu.item)}>Delete</button>
        </div>
      )}

      {newFolderModal.open && (
        <div className="task-modal-overlay" onClick={closeNewFolderModal}>
          <div className="task-modal" onClick={(e) => e.stopPropagation()}>
            <h3>New folder</h3>
            <p>Create a folder inside {currentFolder && currentFolder.parent_id === null ? "Noter" : currentFolder?.name || "this folder"}.</p>
            <input
              className="task-input"
              placeholder="Folder name"
              value={newFolderModal.name}
              onChange={(e) => setNewFolderModal((s) => ({ ...s, name: e.target.value }))}
              onKeyDown={(e) => { if (e.key === "Enter") submitNewFolder(); }}
              autoFocus
            />
            <div className="task-modal-actions">
              <button className="noter-btn ghost" onClick={closeNewFolderModal}>Cancel</button>
              <button className="noter-btn primary" onClick={submitNewFolder} disabled={newFolderModal.saving || !newFolderModal.name.trim()}>
                {newFolderModal.saving ? "Creating…" : "Create"}
              </button>
            </div>
          </div>
        </div>
      )}

      {renameModal.open && (
        <div className="task-modal-overlay" onClick={closeRenameModal}>
          <div className="task-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Rename {renameModal.item?.type === "folder" ? "folder" : "document"}</h3>
            <input
              className="task-input"
              value={renameModal.name}
              onChange={(e) => setRenameModal((s) => ({ ...s, name: e.target.value }))}
              onKeyDown={(e) => { if (e.key === "Enter") submitRename(); }}
              autoFocus
            />
            <div className="task-modal-actions">
              <button className="noter-btn ghost" onClick={closeRenameModal}>Cancel</button>
              <button className="noter-btn primary" onClick={submitRename} disabled={renameModal.saving || !renameModal.name.trim()}>
                {renameModal.saving ? "Saving…" : "Rename"}
              </button>
            </div>
          </div>
        </div>
      )}

      {picker.open && picker.item && (
        <div className="task-modal-overlay" onClick={closePicker}>
          <div className="task-modal" onClick={(e) => e.stopPropagation()}>
            <h3>{picker.mode === "move" ? "Move to…" : "Copy to…"}</h3>
            <p>{picker.item.type === "folder" ? picker.item.name : picker.item.title}</p>

            <nav className="noter-breadcrumb" aria-label="Destination path">
              {pickerBreadcrumb.map((b, idx) => (
                <span key={b.id} className="noter-breadcrumb-item">
                  {idx > 0 && <Icon name="chevron-right" size={12} className="noter-breadcrumb-sep" />}
                  <button className="noter-breadcrumb-btn" onClick={() => setPicker((s) => ({ ...s, locationId: b.id }))}>{b.label}</button>
                </span>
              ))}
            </nav>

            <div className="noter-picker-list">
              {pickerChildren.length === 0 ? (
                <p className="noter-version-empty">No subfolders here.</p>
              ) : (
                pickerChildren.map((f) => {
                  const blocked = isBlockedDestination(f, picker.item, foldersById);
                  return (
                    <button
                      key={f.id}
                      className="noter-picker-row"
                      disabled={blocked}
                      title={blocked ? "Can't choose the source folder or one of its own subfolders" : "Open folder"}
                      onClick={() => setPicker((s) => ({ ...s, locationId: f.id }))}
                    >
                      <Icon name="folder" size={14} />
                      <span>{f.name}</span>
                    </button>
                  );
                })
              )}
            </div>

            <div className="task-modal-actions">
              <button className="noter-btn ghost" onClick={closePicker}>Cancel</button>
              <button
                className="noter-btn primary"
                disabled={picker.saving || pickerCurrentBlocked}
                onClick={submitPicker}
              >
                {picker.saving ? (picker.mode === "move" ? "Moving…" : "Copying…") : (picker.mode === "move" ? "Move here" : "Copy here")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
