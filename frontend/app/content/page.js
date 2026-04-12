"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import MainMenu from "../components/MainMenu";
import ResourceInternalMenu from "../components/ResourceInternalMenu";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "";
const NOTICE_TTL_MS = 15000;
const CONTENT_SEARCH_COURSES = [
  { value: "sfg_level_1", label: "SFG Level 1" },
  { value: "sfg_level_2", label: "SFG Level 2" },
  { value: "level_up_pmp", label: "Level Up PMP" },
  { value: "spectrum", label: "Spectrum" },
  { value: "laxmikant", label: "Laxmikant" },
];

function formatBytes(bytes) {
  const n = Number(bytes || 0);
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function detectType(item) {
  if (!item) return "other";
  const ct = (item.content_type || "").toLowerCase();
  const name = (item.name || "").toLowerCase();
  if (ct.includes("pdf") || name.endsWith(".pdf")) return "pdf";
  if (ct.startsWith("image/")) return "image";
  if (ct.startsWith("video/")) return "video";
  if (ct.startsWith("audio/")) return "audio";
  if (
    ct.startsWith("text/") ||
    ct.includes("xml") ||
    name.endsWith(".txt") ||
    name.endsWith(".md") ||
    name.endsWith(".xml") ||
    name.endsWith(".json")
  ) return "text";
  if (name.endsWith(".xlsx") || name.endsWith(".xls") || ct.includes("sheet")) return "excel";
  if (name.endsWith(".docx") || name.endsWith(".doc")) return "word";
  if (name.endsWith(".pptx") || name.endsWith(".ppt")) return "ppt";
  return "other";
}

function fmtDate(value) {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString();
}

function uploadWithProgress(url, file, contentType, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url, true);
    xhr.setRequestHeader("Content-Type", contentType || "application/octet-stream");

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        const pct = Math.round((e.loaded / e.total) * 100);
        onProgress?.(pct);
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(xhr.getResponseHeader("ETag") || "");
      } else {
        const body = (xhr.responseText || "").slice(0, 500);
        reject(new Error(`Upload failed with status ${xhr.status}${body ? `: ${body}` : ""}`));
      }
    };
    xhr.onerror = () => reject(new Error("Upload failed due to network error"));
    xhr.send(file);
  });
}

function triggerBrowserDownload(url, suggestedName = "") {
  const link = document.createElement("a");
  link.href = url;
  if (suggestedName) link.setAttribute("download", suggestedName);
  link.setAttribute("rel", "noopener noreferrer");
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

export default function ContentPage() {
  const router = useRouter();
  const pathname = usePathname();
  const [folderId, setFolderId] = useState("content_root");
  const [folderInfo, setFolderInfo] = useState(null);
  const [items, setItems] = useState([]);
  const [treeChildrenByParent, setTreeChildrenByParent] = useState({});
  const [expandedFolders, setExpandedFolders] = useState({ content_root: true });
  const [treeLoadingByParent, setTreeLoadingByParent] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const [q, setQ] = useState("");
  const [sortBy, setSortBy] = useState("name");
  const [sortDir, setSortDir] = useState("asc");
  const [viewMode, setViewMode] = useState("table");

  const [showCreateFolderModal, setShowCreateFolderModal] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [showFilterMenu, setShowFilterMenu] = useState(false);
  const [creating, setCreating] = useState(false);

  const [uploadTasks, setUploadTasks] = useState([]);
  const [uploading, setUploading] = useState(false);

  const [selectedFile, setSelectedFile] = useState(null);
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [preview, setPreview] = useState({ loading: false, data: null, error: "", text: "" });
  const [contextMenu, setContextMenu] = useState({ open: false, x: 0, y: 0, item: null });
  const [destinationPicker, setDestinationPicker] = useState({
    open: false,
    mode: "copy",
    item: null,
    stack: [{ id: "content_root", name: "Root", path: "" }],
    loading: false,
    submitting: false,
  });
  const [showMakeSearchableModal, setShowMakeSearchableModal] = useState(false);
  const [makeSearchableItem, setMakeSearchableItem] = useState(null);
  const [searchableCourse, setSearchableCourse] = useState(CONTENT_SEARCH_COURSES[0].value);
  const [makingSearchable, setMakingSearchable] = useState(false);

  const uploadInputRef = useRef(null);
  const folderInputRef = useRef(null);

  const pathParts = useMemo(() => {
    const path = (folderInfo?.path || "").trim();
    if (!path) return [{ name: "Root", path: "" }];
    const chunks = path.split("/");
    return [{ name: "Root", path: "" }].concat(
      chunks.map((part, idx) => ({
        name: part,
        path: chunks.slice(0, idx + 1).join("/"),
      })),
    );
  }, [folderInfo]);

  const getUrlFolderId = () => {
    if (typeof window === "undefined") return "content_root";
    const params = new URLSearchParams(window.location.search || "");
    return (params.get("folder_id") || "content_root").trim() || "content_root";
  };

  const syncFolderInUrl = (nextFolderId) => {
    const fid = (nextFolderId || "content_root").trim() || "content_root";
    const params = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
    if (fid === "content_root") params.delete("folder_id");
    else params.set("folder_id", fid);
    const nextUrl = params.toString() ? `${pathname}?${params.toString()}` : pathname;
    router.replace(nextUrl, { scroll: false });
  };

  const loadTree = async (parentId = "content_root") => {
    if (!API_BASE_URL) return;
    setTreeLoadingByParent((prev) => ({ ...prev, [parentId]: true }));
    try {
      const res = await fetch(`${API_BASE_URL}/content/tree?parent_id=${encodeURIComponent(parentId)}`);
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`Tree API failed: ${res.status} ${txt}`);
      }
      const data = await res.json();
      setTreeChildrenByParent((prev) => ({ ...prev, [parentId]: data.folders || [] }));
    } finally {
      setTreeLoadingByParent((prev) => ({ ...prev, [parentId]: false }));
    }
  };

  const loadList = async (targetFolderId = folderId) => {
    if (!API_BASE_URL) return;
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({
        folder_id: targetFolderId,
        sort_by: sortBy,
        sort_dir: sortDir,
      });
      if (q.trim()) params.set("q", q.trim());
      const res = await fetch(`${API_BASE_URL}/content/list?${params.toString()}`);
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`List API failed: ${res.status} ${txt}`);
      }
      const data = await res.json();
      setFolderId(data.folder?.id || "content_root");
      setFolderInfo(data.folder || null);
      setItems(data.items || []);
      setSelectedFile(null);
      setPreview({ loading: false, data: null, error: "", text: "" });
    } catch (err) {
      setError(String(err.message || err));
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const init = async () => {
      if (!API_BASE_URL) return;
      const requestedFolderId = getUrlFolderId();
      try {
        await Promise.all([
          loadTree("content_root"),
          requestedFolderId !== "content_root" ? loadTree(requestedFolderId) : Promise.resolve(),
          loadList(requestedFolderId),
        ]);
      } catch (err) {
        // Fallback to root if incoming URL folder is invalid/deleted.
        if (requestedFolderId !== "content_root") {
          try {
            await Promise.all([loadTree("content_root"), loadList("content_root")]);
            syncFolderInUrl("content_root");
          } catch (fallbackErr) {
            setError(String(fallbackErr.message || fallbackErr));
          }
        } else {
          setError(String(err.message || err));
        }
      }
    };
    init();
  }, [API_BASE_URL]);

  useEffect(() => {
    if (!API_BASE_URL) return;
    const onPopState = () => {
      const requestedFolderId = getUrlFolderId();
      if (requestedFolderId === folderId) return;
      openFolder(requestedFolderId).catch((err) => {
        setError(String(err.message || err));
      });
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [API_BASE_URL, folderId]);

  useEffect(() => {
    const close = () => {
      setContextMenu({ open: false, x: 0, y: 0, item: null });
      setShowFilterMenu(false);
    };
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, []);

  useEffect(() => {
    if (!error) return;
    const id = setTimeout(() => setError(""), NOTICE_TTL_MS);
    return () => clearTimeout(id);
  }, [error]);

  useEffect(() => {
    if (!message) return;
    const id = setTimeout(() => setMessage(""), NOTICE_TTL_MS);
    return () => clearTimeout(id);
  }, [message]);

  const refresh = async () => {
    await Promise.all([loadTree("content_root"), loadTree(folderId), loadList(folderId)]);
  };

  const openFolder = async (id) => {
    const target = (id || "content_root").trim() || "content_root";
    setFolderId(target);
    setExpandedFolders((prev) => ({ ...prev, [target]: true }));
    await Promise.all([loadList(target), loadTree(target)]);
    syncFolderInUrl(target);
  };

  const openBreadcrumb = async (path) => {
    if (!path) {
      await openFolder("content_root");
      return;
    }
    if ((folderInfo?.path || "") === path) return;
    const targetParts = path.split("/").filter(Boolean);
    if (!targetParts.length) {
      await openFolder("content_root");
      return;
    }
    // Navigate by walking from root level on demand.
    let currentParent = "content_root";
    for (const part of targetParts) {
      const treeRes = await fetch(`${API_BASE_URL}/content/tree?parent_id=${encodeURIComponent(currentParent)}`);
      if (!treeRes.ok) return;
      const treeJson = await treeRes.json();
      const next = (treeJson.folders || []).find((f) => f.name === part);
      if (!next) return;
      setExpandedFolders((prev) => ({ ...prev, [currentParent]: true }));
      currentParent = next.id;
    }
    setExpandedFolders((prev) => ({ ...prev, [currentParent]: true }));
    await openFolder(currentParent);
  };

  const isBlockedDestinationFolder = (candidateFolder, sourceItem) => {
    if (!candidateFolder || !sourceItem || sourceItem.type !== "folder") return false;
    const sourcePath = String(sourceItem.path || "").trim();
    const candidatePath = String(candidateFolder.path || "").trim();
    if (!sourcePath) return false;
    return candidatePath === sourcePath || candidatePath.startsWith(`${sourcePath}/`);
  };

  const ensureTreeChildrenLoaded = async (parentId) => {
    if (Object.prototype.hasOwnProperty.call(treeChildrenByParent, parentId)) return;
    await loadTree(parentId);
  };

  const openDestinationPicker = async (item, mode) => {
    if (!item || !API_BASE_URL) return;
    setDestinationPicker({
      open: true,
      mode,
      item,
      stack: [{ id: "content_root", name: "Root", path: "" }],
      loading: true,
      submitting: false,
    });
    try {
      await ensureTreeChildrenLoaded("content_root");
      setDestinationPicker((prev) => ({ ...prev, loading: false }));
    } catch (err) {
      setDestinationPicker((prev) => ({ ...prev, loading: false, open: false }));
      setError(String(err.message || err));
    }
  };

  const closeDestinationPicker = () => {
    setDestinationPicker({
      open: false,
      mode: "copy",
      item: null,
      stack: [{ id: "content_root", name: "Root", path: "" }],
      loading: false,
      submitting: false,
    });
  };

  const navigateDestinationPickerTo = async (folder) => {
    const blocked = isBlockedDestinationFolder(folder, destinationPicker.item);
    if (blocked) return;
    setDestinationPicker((prev) => ({ ...prev, loading: true }));
    try {
      await ensureTreeChildrenLoaded(folder.id);
      setDestinationPicker((prev) => ({
        ...prev,
        loading: false,
        stack: [...prev.stack, { id: folder.id, name: folder.name, path: folder.path || "" }],
      }));
    } catch (err) {
      setDestinationPicker((prev) => ({ ...prev, loading: false }));
      setError(String(err.message || err));
    }
  };

  const navigateDestinationPickerBreadcrumb = async (index) => {
    setDestinationPicker((prev) => ({ ...prev, stack: prev.stack.slice(0, index + 1) }));
  };

  const createFolder = async () => {
    if (!API_BASE_URL || !newFolderName.trim()) return;
    setCreating(true);
    setError("");
    setMessage("");
    try {
      const res = await fetch(`${API_BASE_URL}/content/folder`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parent_id: folderId, name: newFolderName.trim() }),
      });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`Create folder failed: ${res.status} ${txt}`);
      }
      const json = await res.json();
      setMessage(
        json.created
          ? `Folder created: ${newFolderName.trim()}`
          : `Folder already exists: ${newFolderName.trim()}`,
      );
      setNewFolderName("");
      setShowCreateFolderModal(false);
      await refresh();
    } catch (err) {
      setError(String(err.message || err));
    } finally {
      setCreating(false);
    }
  };

  const renameItem = async (item) => {
    if (!API_BASE_URL || !item) return;
    const nextName = window.prompt("Enter new name", item.name || "");
    if (!nextName || nextName.trim() === item.name) return;
    setError("");
    try {
      const res = await fetch(`${API_BASE_URL}/content/rename`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: item.id, item_type: item.type, new_name: nextName.trim() }),
      });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`Rename failed: ${res.status} ${txt}`);
      }
      setMessage(`${item.type} renamed`);
      await refresh();
    } catch (err) {
      setError(String(err.message || err));
    }
  };

  const deleteItem = async (item) => {
    if (!API_BASE_URL || !item) return;
    const ok = window.confirm(
      item.type === "folder"
        ? `Delete folder "${item.name}" recursively?`
        : `Delete file "${item.name}"?`,
    );
    if (!ok) return;
    setError("");
    try {
      const res = await fetch(`${API_BASE_URL}/content/delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: item.id,
          item_type: item.type,
          recursive: item.type === "folder",
        }),
      });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`Delete failed: ${res.status} ${txt}`);
      }
      setMessage(`${item.type} deleted`);
      if (selectedFile?.id === item.id) {
        setSelectedFile(null);
        setPreview({ loading: false, data: null, error: "", text: "" });
      }
      await refresh();
    } catch (err) {
      setError(String(err.message || err));
    }
  };

  const executeCopyMove = async (item, mode, destination_folder_id) => {
    if (!API_BASE_URL || !item) return;
    setError("");
    setMessage("");
    setDestinationPicker((prev) => ({ ...prev, submitting: true }));
    try {
      const res = await fetch(`${API_BASE_URL}/content/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: item.id,
          item_type: item.type,
          destination_folder_id,
        }),
      });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`${mode === "copy" ? "Copy" : "Move"} failed: ${res.status} ${txt}`);
      }
      setMessage(`${item.type} ${mode === "copy" ? "copied" : "moved"}`);
      closeDestinationPicker();
      if (selectedFile?.id === item.id) {
        setSelectedFile(null);
        setPreview({ loading: false, data: null, error: "", text: "" });
      }
      await refresh();
    } catch (err) {
      setError(String(err.message || err));
    } finally {
      setDestinationPicker((prev) => ({ ...prev, submitting: false }));
    }
  };

  const downloadItem = async (item) => {
    if (!API_BASE_URL || !item) return;
    setError("");
    setMessage("");
    try {
      const res = await fetch(`${API_BASE_URL}/content/download`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: item.id,
          item_type: item.type,
          recursive: true,
        }),
      });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`Download failed: ${res.status} ${txt}`);
      }
      const data = await res.json();
      if (data.type === "file" && data.download_url) {
        triggerBrowserDownload(data.download_url, data.file?.name || "");
        setMessage("Download started");
        return;
      }
      const files = Array.isArray(data.files) ? data.files : [];
      if (!files.length) {
        setMessage("No downloadable files found");
        return;
      }
      for (const entry of files) {
        if (!entry.download_url) continue;
        triggerBrowserDownload(entry.download_url, entry.relative_path || entry.name || "");
        await new Promise((resolve) => setTimeout(resolve, 120));
      }
      setMessage(`Started download for ${files.length} file(s)`);
    } catch (err) {
      setError(String(err.message || err));
    }
  };

  const openMakeSearchableModal = (item) => {
    if (!item) return;
    setMakeSearchableItem(item);
    setSearchableCourse(CONTENT_SEARCH_COURSES[0].value);
    setShowMakeSearchableModal(true);
  };

  const closeMakeSearchableModal = () => {
    setShowMakeSearchableModal(false);
    setMakeSearchableItem(null);
  };

  const makeSearchable = async () => {
    if (!API_BASE_URL || !makeSearchableItem || !searchableCourse) return;
    setMakingSearchable(true);
    setError("");
    setMessage("");
    try {
      const res = await fetch(`${API_BASE_URL}/content/make-searchable`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: makeSearchableItem.id,
          item_type: makeSearchableItem.type,
          course: searchableCourse,
        }),
      });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`Make searchable failed: ${res.status} ${txt}`);
      }
      const data = await res.json();
      const indexed = Number(data.indexed_count || 0);
      const failed = Number(data.failed_count || 0);
      const skipped = Number(data.skipped_count || 0);
      setMessage(`Indexed: ${indexed} | Failed: ${failed} | Skipped: ${skipped}`);
      closeMakeSearchableModal();
    } catch (err) {
      setError(String(err.message || err));
    } finally {
      setMakingSearchable(false);
    }
  };

  const previewFile = async (file) => {
    if (!API_BASE_URL || !file || file.type !== "file") return;
    setSelectedFile(file);
    setShowPreviewModal(true);
    setPreview({ loading: true, data: null, error: "", text: "" });
    try {
      const res = await fetch(`${API_BASE_URL}/content/preview-url?file_id=${encodeURIComponent(file.id)}`);
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`Preview failed: ${res.status} ${txt}`);
      }
      const data = await res.json();
      const f = data.file || file;
      const p = { loading: false, data, error: "", text: "" };
      const kind = detectType(f);
      if (kind === "text" && data.preview_url) {
        try {
          const txtRes = await fetch(data.preview_url);
          const txt = await txtRes.text();
          p.text = txt;
        } catch {
          p.text = "";
        }
      }
      setPreview(p);
    } catch (err) {
      setPreview({ loading: false, data: null, error: String(err.message || err), text: "" });
    }
  };

  const ensurePathFolders = async (rootFolderId, relativePath, cache) => {
    if (!relativePath) return rootFolderId;
    const parts = relativePath.split("/").filter(Boolean);
    let parent = rootFolderId;
    for (const part of parts) {
      const ck = `${parent}|${part}`;
      if (cache[ck]) {
        parent = cache[ck];
        continue;
      }
      const res = await fetch(`${API_BASE_URL}/content/folder`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parent_id: parent, name: part }),
      });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`Create folder '${part}' failed: ${res.status} ${txt}`);
      }
      const json = await res.json();
      const nextId = json.folder?.id;
      if (!nextId) throw new Error("Folder creation returned no id");
      cache[ck] = nextId;
      parent = nextId;
    }
    return parent;
  };

  const uploadMany = async (files, preserveFolder = false) => {
    if (!API_BASE_URL || !files?.length) return;
    setUploading(true);
    setError("");
    setMessage("");
    const tasks = [];
    const cache = {};
    try {
      for (const file of Array.from(files)) {
        const rel = preserveFolder ? (file.webkitRelativePath || file.name) : file.name;
        const parts = rel.split("/").filter(Boolean).map((part) => {
          try {
            return decodeURIComponent(part);
          } catch {
            return part;
          }
        });
        const fileName = parts[parts.length - 1] || file.name;
        const relDir = parts.slice(0, -1).join("/");
        const targetFolderId = await ensurePathFolders(folderId, relDir, cache);

        const presignRes = await fetch(`${API_BASE_URL}/content/presign-upload`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            folder_id: targetFolderId,
            file_name: fileName,
            content_type: file.type || "application/octet-stream",
            size: file.size || 0,
          }),
        });
        if (!presignRes.ok) {
          const txt = await presignRes.text();
          throw new Error(`Presign failed for ${fileName}: ${presignRes.status} ${txt}`);
        }
        const presign = await presignRes.json();
        const taskId = presign.file_id;
        tasks.push({ id: taskId, name: fileName, progress: 0, status: "uploading" });
        setUploadTasks([...tasks]);

        const etag = await uploadWithProgress(
          presign.upload_url,
          file,
          file.type || "application/octet-stream",
          (pct) => {
            setUploadTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, progress: pct } : t)));
          },
        );

        const completeRes = await fetch(`${API_BASE_URL}/content/complete-upload`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ file_id: taskId, etag, size: file.size || 0 }),
        });
        if (!completeRes.ok) {
          const txt = await completeRes.text();
          throw new Error(`Complete upload failed for ${fileName}: ${completeRes.status} ${txt}`);
        }
        setUploadTasks((prev) =>
          prev.map((t) => (t.id === taskId ? { ...t, progress: 100, status: "done" } : t)),
        );
      }
      setMessage(`Uploaded ${files.length} file(s).`);
      await refresh();
    } catch (err) {
      setError(String(err.message || err));
      setUploadTasks((prev) => prev.map((t) => (t.status === "uploading" ? { ...t, status: "failed" } : t)));
    } finally {
      setUploading(false);
    }
  };

  const onDrop = async (e) => {
    e.preventDefault();
    const dt = e.dataTransfer;
    if (!dt) return;
    const files = dt.files;
    if (!files?.length) return;
    await uploadMany(files, false);
  };

  const onContextMenu = (e, item) => {
    e.preventDefault();
    setContextMenu({ open: true, x: e.clientX, y: e.clientY, item });
  };

  const openRowMenu = (e, item) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    setContextMenu({
      open: true,
      x: Math.round(rect.right - 8),
      y: Math.round(rect.bottom + 6),
      item,
    });
  };

  const pickerCurrent = destinationPicker.stack[destinationPicker.stack.length - 1] || { id: "content_root", name: "Root", path: "" };
  const pickerChildren = treeChildrenByParent[pickerCurrent.id] || [];
  const pickerCurrentBlocked = isBlockedDestinationFolder(
    { id: pickerCurrent.id, path: pickerCurrent.path || "" },
    destinationPicker.item,
  );

  const toggleFolderNode = async (nodeId) => {
    const isExpanded = Boolean(expandedFolders[nodeId]);
    if (isExpanded) {
      setExpandedFolders((prev) => ({ ...prev, [nodeId]: false }));
      return;
    }
    setExpandedFolders((prev) => ({ ...prev, [nodeId]: true }));
    if (!Object.prototype.hasOwnProperty.call(treeChildrenByParent, nodeId)) {
      try {
        await loadTree(nodeId);
      } catch (err) {
        setError(String(err.message || err));
      }
    }
  };

  const renderFolderBranch = (parentId = "content_root", depth = 0) => {
    const children = treeChildrenByParent[parentId] || [];
    if (!children.length) return null;
    return (
      <ul className="tree-list">
        {children.map((folder) => {
          const expanded = Boolean(expandedFolders[folder.id]);
          const loaded = Object.prototype.hasOwnProperty.call(treeChildrenByParent, folder.id);
          const hasKnownChildren = loaded && (treeChildrenByParent[folder.id] || []).length > 0;
          const isLoading = Boolean(treeLoadingByParent[folder.id]);
          return (
            <li key={folder.id}>
              <div className="tree-row" style={{ paddingLeft: `${Math.max(0, depth) * 10}px` }}>
                <button
                  className="tree-toggle"
                  aria-label={expanded ? "Collapse folder" : "Expand folder"}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleFolderNode(folder.id);
                  }}
                >
                  {expanded ? "▾" : "▸"}
                </button>
                <button
                  className={`tree-node ${folderId === folder.id ? "active" : ""}`}
                  onDoubleClick={() => openFolder(folder.id)}
                  onClick={() => setFolderId(folder.id)}
                  title="Double click to open folder"
                >
                  {folder.name}
                </button>
              </div>
              {expanded ? (
                <>
                  {isLoading ? <p className="tree-hint">Loading...</p> : null}
                  {hasKnownChildren ? renderFolderBranch(folder.id, depth + 1) : null}
                </>
              ) : null}
            </li>
          );
        })}
      </ul>
    );
  };

  const selectedPreviewType = detectType(preview.data?.file || selectedFile);

  return (
    <main className="app-shell">
      <div className="bg-orb orb-1" />
      <div className="bg-orb orb-2" />

      <header className="hero">
        <MainMenu active="content" />
        <ResourceInternalMenu active="content" />
        <h1>Content Drive</h1>
        <p className="subtext">Google Drive-style manager with folders, uploads, previews, search, sort, and context actions.</p>
      </header>

      <section
        className="drive-layout no-preview"
        onDragOver={(e) => e.preventDefault()}
        onDrop={onDrop}
      >
        <aside className="milestone-panel drive-sidebar">
          <h2>Folders</h2>
          <div className="tree-row">
            <button
              className="tree-toggle"
              aria-label={expandedFolders.content_root ? "Collapse root" : "Expand root"}
              onClick={() => toggleFolderNode("content_root")}
            >
              {expandedFolders.content_root ? "▾" : "▸"}
            </button>
            <button
              className={`tree-node ${folderId === "content_root" ? "active" : ""}`}
              onDoubleClick={() => openFolder("content_root")}
              onClick={() => setFolderId("content_root")}
              title="Double click to open folder"
            >
              Root
            </button>
          </div>
          {expandedFolders.content_root ? renderFolderBranch("content_root", 1) : null}
        </aside>

        <article className="milestone-panel drive-main">
          <div className="content-toolbar">
            <div className="content-search-wrap">
              <input
                className="task-select"
                placeholder="Search files in this folder"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && loadList(folderId)}
              />
            </div>

            <div className="content-actions">
              <button
                className="btn-day"
                onClick={() => {
                  setNewFolderName("");
                  setShowCreateFolderModal(true);
                }}
              >
                Create Folder
              </button>
              <input
                ref={uploadInputRef}
                type="file"
                multiple
                className="hidden-input"
                onChange={async (e) => {
                  await uploadMany(e.target.files, false);
                  e.target.value = "";
                }}
              />
              <button className="btn-day" onClick={() => uploadInputRef.current?.click()} disabled={uploading}>
                {uploading ? "Uploading..." : "Upload Files"}
              </button>
              <input
                ref={folderInputRef}
                type="file"
                webkitdirectory="true"
                directory=""
                multiple
                className="hidden-input"
                onChange={async (e) => {
                  await uploadMany(e.target.files, true);
                  e.target.value = "";
                }}
              />
              <button className="btn-day secondary" onClick={() => folderInputRef.current?.click()} disabled={uploading}>
                Upload Folder
              </button>
              <button
                className="icon-action-btn"
                title="Filter and sort"
                aria-label="Filter and sort"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowFilterMenu((prev) => !prev);
                }}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M3 5h18l-7 8v5l-4 2v-7L3 5z" />
                </svg>
              </button>
            </div>
          </div>

          <div className="content-subtoolbar">
            <div className="content-breadcrumbs">
              {pathParts.map((p, idx) => (
                <button key={`${p.path}-${idx}`} className="crumb-btn" onClick={() => openBreadcrumb(p.path)}>
                  {p.name}
                </button>
              ))}
            </div>
            <div className="content-actions">
              <button className={`btn-day secondary ${viewMode === "grid" ? "active-chip" : ""}`} onClick={() => setViewMode("grid")}>Grid</button>
              <button className={`btn-day secondary ${viewMode === "table" ? "active-chip" : ""}`} onClick={() => setViewMode("table")}>Table</button>
            </div>
          </div>

          {showFilterMenu ? (
            <div className="filter-popover" onClick={(e) => e.stopPropagation()}>
              <div className="session-form-grid">
                <select className="task-select" value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
                  <option value="name">Sort: Name</option>
                  <option value="size">Sort: Size</option>
                  <option value="type">Sort: Type</option>
                  <option value="modified">Sort: Modified</option>
                </select>
                <select className="task-select" value={sortDir} onChange={(e) => setSortDir(e.target.value)}>
                  <option value="asc">Ascending</option>
                  <option value="desc">Descending</option>
                </select>
                <button
                  className="btn-day"
                  onClick={async () => {
                    await loadList(folderId);
                    setShowFilterMenu(false);
                  }}
                >
                  Apply
                </button>
              </div>
            </div>
          ) : null}

          {error ? <p className="api-state error">{error}</p> : null}
          {message ? <p className="api-state ok">{message}</p> : null}
          {loading ? <p className="day-state">Loading...</p> : null}
          {!loading && items.length === 0 ? <p className="day-state">No files/folders here. Drop files to upload.</p> : null}

          {uploadTasks.length ? (
            <div className="upload-task-list">
              {uploadTasks.map((t) => (
                <div key={t.id} className="upload-task">
                  <span>{t.name}</span>
                  <div className="upload-progress-track">
                    <div className="upload-progress-fill" style={{ width: `${t.progress || 0}%` }} />
                  </div>
                  <span>{t.status}</span>
                </div>
              ))}
            </div>
          ) : null}

          {viewMode === "table" ? (
            <div className="drive-table-wrap">
              <table className="drive-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Type</th>
                    <th>Size</th>
                    <th>Modified</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.id} onContextMenu={(e) => onContextMenu(e, item)}>
                      <td>
                        <button
                          className="linkish-btn"
                          onDoubleClick={() => {
                            if (item.type === "folder") openFolder(item.id);
                            else previewFile(item);
                          }}
                        >
                          <span className="item-icon" aria-hidden="true">{item.type === "folder" ? "📁" : "📄"}</span>
                          <span>{item.name}</span>
                        </button>
                      </td>
                      <td>{item.type === "folder" ? "folder" : item.content_type || "file"}</td>
                      <td>{item.type === "file" ? formatBytes(item.size) : "-"}</td>
                      <td>{fmtDate(item.updated_at)}</td>
                      <td>
                        <button className="ellipsis-btn" onClick={(e) => openRowMenu(e, item)} aria-label="Open actions menu">
                          ⋮
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="drive-grid">
              {items.map((item) => (
                <div
                  key={item.id}
                  className="drive-card"
                  onContextMenu={(e) => onContextMenu(e, item)}
                  onDoubleClick={() => (item.type === "folder" ? openFolder(item.id) : previewFile(item))}
                >
                  <div className="drive-card-title">{item.type === "folder" ? "Folder" : "File"}</div>
                  <div className="drive-card-name">{item.name}</div>
                  <div className="drive-card-meta">
                    {item.type === "file" ? `${formatBytes(item.size)} • ${item.content_type || "file"}` : "Open folder"}
                  </div>
                </div>
              ))}
            </div>
          )}
        </article>

      </section>

      {contextMenu.open && contextMenu.item ? (
        <div className="context-menu" style={{ left: contextMenu.x, top: contextMenu.y }}>
          <button
            className="context-item"
            onClick={() => {
              const it = contextMenu.item;
              setContextMenu({ open: false, x: 0, y: 0, item: null });
              if (it.type === "folder") openFolder(it.id);
              else previewFile(it);
            }}
          >
            Open
          </button>
          <button
            className="context-item"
            onClick={() => {
              const it = contextMenu.item;
              setContextMenu({ open: false, x: 0, y: 0, item: null });
              renameItem(it);
            }}
          >
            Rename
          </button>
          <button
            className="context-item"
            onClick={() => {
              const it = contextMenu.item;
              setContextMenu({ open: false, x: 0, y: 0, item: null });
              openDestinationPicker(it, "copy");
            }}
          >
            Copy
          </button>
          <button
            className="context-item"
            onClick={() => {
              const it = contextMenu.item;
              setContextMenu({ open: false, x: 0, y: 0, item: null });
              openDestinationPicker(it, "move");
            }}
          >
            Move
          </button>
          <button
            className="context-item"
            onClick={() => {
              const it = contextMenu.item;
              setContextMenu({ open: false, x: 0, y: 0, item: null });
              downloadItem(it);
            }}
          >
            Download
          </button>
          <button
            className="context-item"
            onClick={() => {
              const it = contextMenu.item;
              setContextMenu({ open: false, x: 0, y: 0, item: null });
              openMakeSearchableModal(it);
            }}
          >
            Make Searchable
          </button>
          <button
            className="context-item danger"
            onClick={() => {
              const it = contextMenu.item;
              setContextMenu({ open: false, x: 0, y: 0, item: null });
              deleteItem(it);
            }}
          >
            Delete
          </button>
        </div>
      ) : null}

      {showCreateFolderModal ? (
        <div className="task-modal-overlay" onClick={() => setShowCreateFolderModal(false)}>
          <div className="task-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Create Folder</h3>
            <p>Enter a folder name for this location.</p>
            <input
              className="task-select"
              placeholder="Folder name"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") createFolder();
              }}
              autoFocus
            />
            <div className="task-modal-actions">
              <button className="btn-day secondary" onClick={() => setShowCreateFolderModal(false)}>
                Cancel
              </button>
              <button className="btn-day" onClick={createFolder} disabled={creating || !newFolderName.trim()}>
                {creating ? "Creating..." : "Create"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {destinationPicker.open && destinationPicker.item ? (
        <div className="task-modal-overlay" onClick={closeDestinationPicker}>
          <div className="task-modal" onClick={(e) => e.stopPropagation()}>
            <h3>{destinationPicker.mode === "copy" ? "Copy To" : "Move To"}</h3>
            <p>
              {destinationPicker.item.name} ({destinationPicker.item.type})
            </p>

            <div className="content-breadcrumbs">
              {destinationPicker.stack.map((node, idx) => (
                <button
                  key={`${node.id}-${idx}`}
                  className="crumb-btn"
                  onClick={() => navigateDestinationPickerBreadcrumb(idx)}
                >
                  {node.name}
                </button>
              ))}
            </div>

            <div className="picker-folder-list">
              {destinationPicker.loading ? <p className="day-state">Loading folders...</p> : null}
              {!destinationPicker.loading && pickerChildren.length === 0 ? (
                <p className="day-state">No subfolders here.</p>
              ) : null}
              {!destinationPicker.loading
                ? pickerChildren.map((folder) => {
                    const blocked = isBlockedDestinationFolder(folder, destinationPicker.item);
                    return (
                      <button
                        key={folder.id}
                        className={`picker-folder-row ${blocked ? "disabled" : ""}`}
                        onClick={() => navigateDestinationPickerTo(folder)}
                        disabled={blocked}
                        title={blocked ? "Cannot choose source folder or its child folders" : "Open folder"}
                      >
                        <span className="item-icon" aria-hidden="true">📁</span>
                        <span>{folder.name}</span>
                      </button>
                    );
                  })
                : null}
            </div>

            <div className="task-modal-actions">
              <button className="btn-day secondary" onClick={closeDestinationPicker}>
                Cancel
              </button>
              <button
                className="btn-day"
                disabled={destinationPicker.submitting || pickerCurrentBlocked}
                onClick={() => executeCopyMove(destinationPicker.item, destinationPicker.mode, pickerCurrent.id)}
              >
                {destinationPicker.submitting
                  ? destinationPicker.mode === "copy"
                    ? "Copying..."
                    : "Moving..."
                  : destinationPicker.mode === "copy"
                    ? "Copy Here"
                    : "Move Here"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showPreviewModal && selectedFile ? (
        <div className="task-modal-overlay" onClick={() => setShowPreviewModal(false)}>
          <div className="task-modal content-preview-modal" onClick={(e) => e.stopPropagation()}>
            <div className="content-preview-head">
              <h3>{selectedFile.name}</h3>
              <button className="btn-day secondary" onClick={() => setShowPreviewModal(false)}>Close</button>
            </div>
            {preview.loading ? <p className="day-state">Loading preview...</p> : null}
            {preview.error ? <p className="api-state error">{preview.error}</p> : null}
            {preview.data?.preview_url ? (
              <div className="content-preview-wrap modal-open">
                {selectedPreviewType === "pdf" ? <iframe className="content-preview-frame" src={preview.data.preview_url} title="PDF Preview" /> : null}
                {selectedPreviewType === "image" ? <img className="content-preview-image" src={preview.data.preview_url} alt={selectedFile.name || "preview"} /> : null}
                {selectedPreviewType === "video" ? <video className="content-preview-frame" controls src={preview.data.preview_url} /> : null}
                {selectedPreviewType === "audio" ? <audio className="session-player" controls src={preview.data.preview_url} /> : null}
                {selectedPreviewType === "text" ? (
                  <pre className="text-preview">{preview.text || "No text preview available."}</pre>
                ) : null}
                {selectedPreviewType === "excel" || selectedPreviewType === "word" || selectedPreviewType === "ppt" || selectedPreviewType === "other" ? (
                  <div className="content-preview-fallback">
                    <p>
                      Inline native preview for this type is limited in-browser.
                      Use download/open for best fidelity.
                    </p>
                    <a className="top-nav-link" href={preview.data.preview_url} target="_blank" rel="noreferrer">
                      Open / Download
                    </a>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {showMakeSearchableModal && makeSearchableItem ? (
        <div className="task-modal-overlay" onClick={closeMakeSearchableModal}>
          <div className="task-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Make Searchable</h3>
            <p>
              {makeSearchableItem.name} ({makeSearchableItem.type})
            </p>
            <select
              className="task-select"
              value={searchableCourse}
              onChange={(e) => setSearchableCourse(e.target.value)}
            >
              {CONTENT_SEARCH_COURSES.map((course) => (
                <option key={course.value} value={course.value}>
                  {course.label}
                </option>
              ))}
            </select>
            <div className="task-modal-actions">
              <button className="btn-day secondary" onClick={closeMakeSearchableModal} disabled={makingSearchable}>
                Cancel
              </button>
              <button className="btn-day" onClick={makeSearchable} disabled={makingSearchable}>
                {makingSearchable ? "Indexing..." : "Start Indexing"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
