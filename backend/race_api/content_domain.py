from datetime import datetime, timezone
import uuid
from typing import Any, Dict, List
from urllib.parse import quote, unquote

from pymongo import ASCENDING

from .context import content_files_collection, content_folders_collection, s3_client, settings

ROOT_FOLDER_ID = "content_root"
_content_indexes_ensured = False


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _bucket() -> str:
    bucket = (settings().get("content_bucket") or "").strip()
    if not bucket:
        raise RuntimeError("CONTENT_BUCKET or RECORDING_BUCKET is not configured")
    return bucket


def _prefix() -> str:
    return (settings().get("content_prefix") or "content").strip().strip("/")


def _new_id(prefix: str) -> str:
    return f"{prefix}:{uuid.uuid4().hex}"


def _safe_name(name: str) -> str:
    value = unquote((name or "").strip()).strip()
    if not value:
        raise ValueError("name is required")
    if "/" in value or "\\" in value:
        raise ValueError("name cannot contain / or \\")
    if value in {".", ".."}:
        raise ValueError("Invalid name")
    return value


def _safe_key_part(name: str) -> str:
    return quote(_safe_name(name).replace(" ", "_"), safe="_-.()")


def _ensure_indexes() -> None:
    global _content_indexes_ensured
    if _content_indexes_ensured:
        return

    folders = content_folders_collection()
    files = content_files_collection()

    folders.create_index([("parent_id", ASCENDING), ("name", ASCENDING)], unique=True)
    folders.create_index([("path", ASCENDING)])

    files.create_index([("parent_id", ASCENDING), ("name", ASCENDING)], unique=True)
    files.create_index([("parent_id", ASCENDING)])
    files.create_index([("folder_id", ASCENDING), ("name", ASCENDING)], unique=True)
    files.create_index([("folder_id", ASCENDING)])
    files.create_index([("s3_key", ASCENDING)], unique=True)
    files.create_index([("name", ASCENDING)])
    files.create_index([("content_type", ASCENDING)])
    files.create_index([("updated_at", ASCENDING)])

    _content_indexes_ensured = True
    _ensure_root_folder()


def _ensure_root_folder() -> None:
    folders = content_folders_collection()
    folders.update_one(
        {"_id": ROOT_FOLDER_ID},
        {
            "$setOnInsert": {
                "_id": ROOT_FOLDER_ID,
                "name": "Root",
                "parent_id": None,
                "node_type": "folder",
                "path": "",
                "created_at": _now(),
            },
            "$set": {"updated_at": _now()},
        },
        upsert=True,
    )


def _get_folder_or_404(folder_id: str) -> Dict[str, Any]:
    folder = content_folders_collection().find_one({"_id": folder_id})
    if not folder:
        raise LookupError("Folder not found")
    return folder


def _folder_path(folder: Dict[str, Any]) -> str:
    return (folder.get("path") or "").strip("/")


def _build_object_key(folder: Dict[str, Any], file_name: str) -> str:
    root = _prefix()
    path = _folder_path(folder)
    safe_file = _safe_key_part(file_name)
    if path:
        safe_parts = [_safe_key_part(p) for p in path.split("/") if p]
        return f"{root}/{'/'.join(safe_parts)}/{safe_file}"
    return f"{root}/{safe_file}"


def _folder_node(folder: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": folder["_id"],
        "type": "folder",
        "name": folder.get("name", ""),
        "parent_id": folder.get("parent_id"),
        "path": folder.get("path", ""),
        "created_at": folder.get("created_at", ""),
        "updated_at": folder.get("updated_at", ""),
    }


def _file_node(file_doc: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": file_doc["_id"],
        "type": "file",
        "name": file_doc.get("name", ""),
        "parent_id": file_doc.get("parent_id", file_doc.get("folder_id")),
        "folder_id": file_doc.get("folder_id"),
        "content_type": file_doc.get("content_type", ""),
        "size": int(file_doc.get("size", 0) or 0),
        "s3_key": file_doc.get("s3_key", ""),
        "status": file_doc.get("status", "ready"),
        "created_at": file_doc.get("created_at", ""),
        "updated_at": file_doc.get("updated_at", ""),
    }


def list_content(folder_id: str | None, q: str | None, sort_by: str | None, sort_dir: str | None) -> Dict[str, Any]:
    _ensure_indexes()
    fid = (folder_id or ROOT_FOLDER_ID).strip()
    folder = _get_folder_or_404(fid)
    folders = content_folders_collection()
    files = content_files_collection()

    folder_query: Dict[str, Any] = {"parent_id": fid}
    if q:
        folder_query["name"] = {"$regex": q, "$options": "i"}
    subfolders = list(folders.find(folder_query).sort("name", 1))
    file_query: Dict[str, Any] = {"status": {"$in": ["uploading", "ready"]}}
    # New model: files use parent_id for child-parent hierarchy.
    # Fallback supports already-created docs that only have folder_id.
    file_query["$or"] = [{"parent_id": fid}, {"folder_id": fid}]
    if q:
        file_query["name"] = {"$regex": q, "$options": "i"}
    file_docs = list(files.find(file_query))

    items = [_folder_node(f) for f in subfolders] + [_file_node(f) for f in file_docs]
    key = (sort_by or "name").strip()
    reverse = (sort_dir or "asc").lower() == "desc"

    def sort_val(item: Dict[str, Any]):
        if key == "size":
            return item.get("size", 0)
        if key == "type":
            return item.get("content_type", "") if item["type"] == "file" else "folder"
        if key == "modified":
            return item.get("updated_at", "")
        return item.get("name", "").lower()

    items.sort(key=sort_val, reverse=reverse)
    return {
        "folder": _folder_node(folder),
        "items": items,
        "q": q or "",
        "sort_by": key,
        "sort_dir": "desc" if reverse else "asc",
    }


def list_folder_tree(parent_id: str | None = None) -> Dict[str, Any]:
    _ensure_indexes()
    query: Dict[str, Any] = {}
    if parent_id is not None:
        query["parent_id"] = parent_id
    rows = list(content_folders_collection().find(query, {"_id": 1, "name": 1, "parent_id": 1, "path": 1}))
    return {
        "folders": [
            {
                "id": row["_id"],
                "name": row.get("name", ""),
                "parent_id": row.get("parent_id"),
                "path": row.get("path", ""),
            }
            for row in rows
        ]
    }


def create_folder(parent_id: str, name: str) -> Dict[str, Any]:
    _ensure_indexes()
    pname = _safe_name(name)
    parent = _get_folder_or_404((parent_id or ROOT_FOLDER_ID).strip())
    new_id = _new_id("folder")
    parent_path = _folder_path(parent)
    full_path = f"{parent_path}/{pname}".strip("/")
    folders = content_folders_collection()

    existing = folders.find_one({"parent_id": parent["_id"], "name": pname})
    if existing:
        return {"message": "Folder exists", "folder": _folder_node(existing), "created": False}

    doc = {
        "_id": new_id,
        "name": pname,
        "node_type": "folder",
        "parent_id": parent["_id"],
        "path": full_path,
        "created_at": _now(),
        "updated_at": _now(),
    }
    folders.insert_one(doc)
    return {"message": "Folder created", "folder": _folder_node(doc), "created": True}


def rename_item(item_id: str, item_type: str, new_name: str) -> Dict[str, Any]:
    _ensure_indexes()
    iid = (item_id or "").strip()
    if not iid:
        raise ValueError("id is required")
    name = _safe_name(new_name)
    kind = (item_type or "").strip().lower()
    now = _now()

    if kind == "file":
        files = content_files_collection()
        doc = files.find_one({"_id": iid})
        if not doc:
            raise LookupError("File not found")
        conflict = files.find_one({"folder_id": doc["folder_id"], "name": name, "_id": {"$ne": iid}})
        if conflict:
            raise ValueError("A file with same name already exists in this folder")
        files.update_one({"_id": iid}, {"$set": {"name": name, "updated_at": now}})
        updated = files.find_one({"_id": iid})
        return {"message": "File renamed", "item": _file_node(updated)}

    if kind == "folder":
        if iid == ROOT_FOLDER_ID:
            raise ValueError("Root folder cannot be renamed")
        folders = content_folders_collection()
        folder = folders.find_one({"_id": iid})
        if not folder:
            raise LookupError("Folder not found")
        conflict = folders.find_one({"parent_id": folder["parent_id"], "name": name, "_id": {"$ne": iid}})
        if conflict:
            raise ValueError("A folder with same name already exists here")

        old_path = _folder_path(folder)
        parent = _get_folder_or_404(folder["parent_id"])
        parent_path = _folder_path(parent)
        new_path = f"{parent_path}/{name}".strip("/")
        folders.update_one({"_id": iid}, {"$set": {"name": name, "path": new_path, "updated_at": now}})

        # cascade update descendant folder paths
        descendants = list(folders.find({"path": {"$regex": f"^{old_path}/"}}))
        for d in descendants:
            d_path = d.get("path", "")
            suffix = d_path[len(old_path):].lstrip("/")
            folders.update_one({"_id": d["_id"]}, {"$set": {"path": f"{new_path}/{suffix}".strip("/"), "updated_at": now}})
        return {"message": "Folder renamed", "item": _folder_node(folders.find_one({"_id": iid}))}

    raise ValueError("item_type must be file or folder")


def create_upload_url(folder_id: str, file_name: str, content_type: str, size: int) -> Dict[str, Any]:
    _ensure_indexes()
    folder = _get_folder_or_404((folder_id or ROOT_FOLDER_ID).strip())
    name = _safe_name(file_name)
    ct = (content_type or "application/octet-stream").strip()
    s3_key = _build_object_key(folder, name)
    files = content_files_collection()

    existing = files.find_one({"$or": [{"parent_id": folder["_id"]}, {"folder_id": folder["_id"]}], "name": name})
    if existing and existing.get("status") == "ready":
        raise ValueError("File already exists in this folder")

    file_id = existing["_id"] if existing else _new_id("file")
    now = _now()
    files.update_one(
        {"_id": file_id},
        {
            "$set": {
                "node_type": "file",
                "parent_id": folder["_id"],
                "folder_id": folder["_id"],
                "name": name,
                "content_type": ct,
                "size": max(0, int(size or 0)),
                "s3_key": s3_key,
                "status": "uploading",
                "updated_at": now,
            },
            "$setOnInsert": {"created_at": now},
        },
        upsert=True,
    )

    # Do not bind ContentType in the presigned signature for browser uploads.
    # Browsers may send slightly different Content-Type values, which can cause
    # Signature mismatch / 400 on S3 PUT.
    url = s3_client().generate_presigned_url(
        "put_object",
        Params={"Bucket": _bucket(), "Key": s3_key},
        ExpiresIn=3600,
    )
    return {"file_id": file_id, "upload_url": url, "s3_key": s3_key, "bucket": _bucket()}


def complete_upload(file_id: str, etag: str, size: int) -> Dict[str, Any]:
    _ensure_indexes()
    fid = (file_id or "").strip()
    if not fid:
        raise ValueError("file_id is required")
    files = content_files_collection()
    doc = files.find_one({"_id": fid})
    if not doc:
        raise LookupError("File not found")
    files.update_one(
        {"_id": fid},
        {
            "$set": {
                "etag": (etag or "").strip().strip('"'),
                "size": max(int(size or doc.get("size", 0) or 0), 0),
                "status": "ready",
                "updated_at": _now(),
            }
        },
    )
    return {"message": "Upload completed", "file": _file_node(files.find_one({"_id": fid}))}


def _collect_descendant_folder_ids(folder_id: str) -> List[str]:
    folders = content_folders_collection()
    all_rows = list(folders.find({}, {"_id": 1, "parent_id": 1}))
    children_by_parent: Dict[str | None, List[str]] = {}
    for row in all_rows:
        children_by_parent.setdefault(row.get("parent_id"), []).append(row["_id"])

    stack = [folder_id]
    out: List[str] = []
    while stack:
        node = stack.pop()
        out.append(node)
        for child in children_by_parent.get(node, []):
            stack.append(child)
    return out


def delete_item(item_id: str, item_type: str, recursive: bool = False) -> Dict[str, Any]:
    _ensure_indexes()
    iid = (item_id or "").strip()
    kind = (item_type or "").strip().lower()
    if not iid:
        raise ValueError("id is required")
    if kind not in {"file", "folder"}:
        raise ValueError("item_type must be file or folder")

    files = content_files_collection()
    folders = content_folders_collection()
    s3 = s3_client()
    bucket = _bucket()

    if kind == "file":
        file_doc = files.find_one({"_id": iid})
        if not file_doc:
            raise LookupError("File not found")
        s3_key = file_doc.get("s3_key")
        if s3_key:
            try:
                s3.delete_object(Bucket=bucket, Key=s3_key)
            except Exception:  # noqa: BLE001
                pass
        files.delete_one({"_id": iid})
        return {"message": "File deleted", "deleted": 1}

    if iid == ROOT_FOLDER_ID:
        raise ValueError("Root folder cannot be deleted")

    folder_doc = folders.find_one({"_id": iid})
    if not folder_doc:
        raise LookupError("Folder not found")

    child_exists = folders.find_one({"parent_id": iid}) or files.find_one({"folder_id": iid})
    if child_exists and not recursive:
        raise ValueError("Folder is not empty. Use recursive delete.")

    folder_ids = _collect_descendant_folder_ids(iid)
    file_docs = list(files.find({"folder_id": {"$in": folder_ids}}))
    keys = [d.get("s3_key") for d in file_docs if d.get("s3_key")]
    for start in range(0, len(keys), 1000):
        chunk = keys[start:start + 1000]
        try:
            s3.delete_objects(Bucket=bucket, Delete={"Objects": [{"Key": k} for k in chunk], "Quiet": True})
        except Exception:  # noqa: BLE001
            pass
    files.delete_many({"folder_id": {"$in": folder_ids}})
    folders.delete_many({"_id": {"$in": [fid for fid in folder_ids if fid != ROOT_FOLDER_ID]}})
    return {"message": "Folder deleted", "deleted_folders": len(folder_ids), "deleted_files": len(file_docs)}


def preview_by_id(file_id: str) -> Dict[str, Any]:
    _ensure_indexes()
    fid = (file_id or "").strip()
    if not fid:
        raise ValueError("file_id is required")
    doc = content_files_collection().find_one({"_id": fid})
    if not doc:
        raise LookupError("File not found")
    if doc.get("status") != "ready":
        raise ValueError("File upload is not complete yet")

    key = doc.get("s3_key")
    if not key:
        raise ValueError("File storage key missing")
    url = s3_client().generate_presigned_url(
        "get_object",
        Params={"Bucket": _bucket(), "Key": key},
        ExpiresIn=3600,
    )
    return {
        "file": _file_node(doc),
        "preview_url": url,
    }
