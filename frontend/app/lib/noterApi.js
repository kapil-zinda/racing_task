"use client";
// Noter (Notion-style docs) — API client. Thin wrappers over apiFetch for
// /noter/docs and /noter/docs/{id}/versions. Every call throws on non-2xx
// with the server's detail message.

import { apiFetch } from "./auth";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "";

async function req(path, opts = {}) {
  if (!API_BASE_URL) throw new Error("NEXT_PUBLIC_API_BASE_URL is not configured");
  const res = await apiFetch(`${API_BASE_URL}${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (_) {
    data = text;
  }
  if (!res.ok) {
    const detail = (data && data.detail) || (typeof data === "string" ? data : "") || `HTTP ${res.status}`;
    throw new Error(detail);
  }
  return data;
}

// --- Docs ---
export const listNoterDocs = (limit = 100, offset = 0) => req(`/noter/docs?limit=${limit}&offset=${offset}`);
export const createNoterDoc = (body) => req("/noter/docs", { method: "POST", body });
export const getNoterDoc = (id) => req(`/noter/docs/${id}`);
export const saveNoterDoc = (id, body) => req(`/noter/docs/${id}`, { method: "PUT", body });
export const deleteNoterDoc = (id) => req(`/noter/docs/${id}`, { method: "DELETE" });

// --- Directory (folders) ---
export const listNoterItems = (folderId = "", q = "", sortBy = "name", sortDir = "asc") => {
  const qs = new URLSearchParams({ folder_id: folderId || "", q: q || "", sort_by: sortBy, sort_dir: sortDir });
  return req(`/noter/items?${qs.toString()}`);
};
export const getNoterFolderTree = () => req("/noter/folders/tree");
export const createNoterFolder = (parentId, name) => req("/noter/folders", { method: "POST", body: { parent_id: parentId || "", name } });
export const renameNoterItem = (id, itemType, name) =>
  req("/noter/items/rename", { method: "POST", body: { id, item_type: itemType, name } });
export const moveNoterItem = (id, itemType, destinationFolderId) =>
  req("/noter/items/move", { method: "POST", body: { id, item_type: itemType, destination_folder_id: destinationFolderId || "" } });
export const copyNoterItem = (id, itemType, destinationFolderId) =>
  req("/noter/items/copy", { method: "POST", body: { id, item_type: itemType, destination_folder_id: destinationFolderId || "" } });
export const duplicateNoterItem = (id, itemType) =>
  req("/noter/items/duplicate", { method: "POST", body: { id, item_type: itemType } });
export const deleteNoterItem = (id, itemType, recursive = false) =>
  req("/noter/items/delete", { method: "POST", body: { id, item_type: itemType, recursive } });

// --- Version history (S3-backed) ---
export const listNoterVersions = (id) => req(`/noter/docs/${id}/versions`);
export const snapshotNoterDoc = (id) => req(`/noter/docs/${id}/versions`, { method: "POST" });
export const getNoterVersion = (id, versionId) => req(`/noter/docs/${id}/versions/${versionId}`);
export const restoreNoterVersion = (id, versionId) =>
  req(`/noter/docs/${id}/restore`, { method: "POST", body: { version_id: versionId } });

// --- Assets (images/files embedded in a doc) ---
export const presignNoterAsset = (id, filename, contentType) =>
  req(`/noter/docs/${id}/assets/presign`, { method: "POST", body: { filename, content_type: contentType || "" } });
export const resolveNoterAsset = (key) => req("/noter/assets/resolve", { method: "POST", body: { key } });

// Uploads a File to the presigned URL and returns a resolvable {key}. Callers
// resolve a fresh signed GET URL (resolveNoterAsset) whenever they render it,
// since the PUT URL itself is not a valid read URL.
export async function uploadNoterAsset(docId, file) {
  const { uploadUrl, key } = await presignNoterAsset(docId, file.name, file.type);
  const putRes = await fetch(uploadUrl, { method: "PUT", body: file });
  if (!putRes.ok) throw new Error("Upload failed");
  return key;
}
