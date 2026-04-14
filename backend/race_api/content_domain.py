from datetime import datetime, timezone
import uuid
from typing import Any, Dict, List, Set
from types import SimpleNamespace
from urllib.parse import quote, unquote

from pymongo import ASCENDING

from .context import content_files_collection, content_folders_collection, pdf_docs_collection, s3_client, settings
from .pdf_search_domain import COURSE_OPTIONS, _normalize_course, index_pdf_document

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


def _pdf_bucket() -> str:
    bucket = (settings().get("pdf_search_bucket") or "").strip()
    if not bucket:
        raise RuntimeError("PDF_SEARCH_BUCKET or RECORDING_BUCKET is not configured")
    return bucket


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


def _searchable_scope_ids() -> tuple[Set[str], Set[str]]:
    files = content_files_collection()
    folders = content_folders_collection()
    docs = pdf_docs_collection()

    # Backfill: documents uploaded from Search page may not have content file links.
    for row in docs.find({"key": {"$exists": True, "$ne": ""}}, {"doc_id": 1, "source_file_id": 1, "file_name": 1, "key": 1, "bucket": 1, "status": 1}):
        status = str(row.get("status", "") or "").strip().lower()
        if status in {"failed", "deleted"}:
            continue
        linked_id = str(row.get("source_file_id", "") or "").strip()
        if linked_id and files.find_one({"_id": linked_id}):
            continue
        key = str(row.get("key", "") or "").strip()
        if not key:
            continue
        existing = files.find_one({"s3_key": key})
        if existing:
            docs.update_one(
                {"doc_id": row.get("doc_id", "")},
                {"$set": {"source_file_id": existing.get("_id"), "source": "content_drive", "updated_at": _now()}},
            )
            continue
        file_name = str(row.get("file_name", "") or "").strip() or "document.pdf"
        safe_name = _unique_file_name(ROOT_FOLDER_ID, file_name)
        new_id = _new_id("file")
        now = _now()
        file_bucket = str(row.get("bucket", "") or "").strip() or _pdf_bucket()
        files.insert_one(
            {
                "_id": new_id,
                "node_type": "file",
                "parent_id": ROOT_FOLDER_ID,
                "folder_id": ROOT_FOLDER_ID,
                "name": safe_name,
                "content_type": "application/pdf",
                "size": 0,
                "etag": "",
                "s3_key": key,
                "bucket": file_bucket,
                "status": "ready",
                "source": "pdf_search_upload",
                "visibility_scope": "searchable_only",
                "created_at": now,
                "updated_at": now,
            }
        )
        docs.update_one(
            {"doc_id": row.get("doc_id", "")},
            {"$set": {"source_file_id": new_id, "source": "content_drive", "updated_at": now}},
        )

    raw_file_ids = {
        str(row.get("source_file_id", "")).strip()
        for row in docs.find({"source_file_id": {"$exists": True, "$ne": ""}}, {"source_file_id": 1})
    }
    raw_file_ids = {fid for fid in raw_file_ids if fid}
    if not raw_file_ids:
        return set(), {ROOT_FOLDER_ID}

    file_docs = list(
        files.find(
            {"_id": {"$in": list(raw_file_ids)}, "status": {"$in": ["uploading", "ready"]}},
            {"_id": 1, "parent_id": 1, "folder_id": 1},
        )
    )
    searchable_file_ids = {str(doc.get("_id", "")) for doc in file_docs if doc.get("_id")}

    parent_map: Dict[str, str | None] = {
        str(row.get("_id")): row.get("parent_id")
        for row in folders.find({}, {"_id": 1, "parent_id": 1})
    }
    searchable_folder_ids: Set[str] = {ROOT_FOLDER_ID}
    for file_doc in file_docs:
        parent_id = str(file_doc.get("parent_id") or file_doc.get("folder_id") or "").strip()
        while parent_id:
            searchable_folder_ids.add(parent_id)
            parent_value = parent_map.get(parent_id)
            if parent_value is None:
                break
            parent_id = str(parent_value).strip()

    return searchable_file_ids, searchable_folder_ids


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
        "bucket": file_doc.get("bucket", ""),
        "status": file_doc.get("status", "ready"),
        "created_at": file_doc.get("created_at", ""),
        "updated_at": file_doc.get("updated_at", ""),
    }


def _unique_folder_name(parent_id: str, base_name: str, exclude_id: str | None = None) -> str:
    folders = content_folders_collection()
    name = _safe_name(base_name)
    if not folders.find_one({"parent_id": parent_id, "name": name, "_id": {"$ne": exclude_id}}):
        return name
    idx = 1
    while True:
        candidate = f"{name} ({idx})"
        if not folders.find_one({"parent_id": parent_id, "name": candidate, "_id": {"$ne": exclude_id}}):
            return candidate
        idx += 1


def _unique_file_name(parent_id: str, base_name: str, exclude_id: str | None = None) -> str:
    files = content_files_collection()
    name = _safe_name(base_name)
    query: Dict[str, Any] = {"name": name, "_id": {"$ne": exclude_id}}
    query["$or"] = [{"parent_id": parent_id}, {"folder_id": parent_id}]
    if not files.find_one(query):
        return name
    stem = name
    ext = ""
    if "." in name and not name.startswith("."):
        stem, ext = name.rsplit(".", 1)
        ext = f".{ext}"
    idx = 1
    while True:
        candidate = f"{stem} ({idx}){ext}"
        candidate_query: Dict[str, Any] = {"name": candidate, "_id": {"$ne": exclude_id}}
        candidate_query["$or"] = [{"parent_id": parent_id}, {"folder_id": parent_id}]
        if not files.find_one(candidate_query):
            return candidate
        idx += 1


def list_content(
    folder_id: str | None,
    q: str | None,
    sort_by: str | None,
    sort_dir: str | None,
    view_mode: str | None = None,
) -> Dict[str, Any]:
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

    mode = (view_mode or "all").strip().lower()
    if mode == "searchable":
        searchable_file_ids, searchable_folder_ids = _searchable_scope_ids()
        subfolders = [row for row in subfolders if str(row.get("_id", "")) in searchable_folder_ids]
        file_docs = [row for row in file_docs if str(row.get("_id", "")) in searchable_file_ids]
    else:
        file_docs = [
            row
            for row in file_docs
            if str(row.get("visibility_scope", "")).strip().lower() != "searchable_only"
            and str(row.get("source", "")).strip().lower() != "pdf_search_upload"
        ]

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
        "view_mode": "searchable" if mode == "searchable" else "all",
    }


def list_folder_tree(parent_id: str | None = None, view_mode: str | None = None) -> Dict[str, Any]:
    _ensure_indexes()
    query: Dict[str, Any] = {}
    if parent_id is not None:
        query["parent_id"] = parent_id
    rows = list(content_folders_collection().find(query, {"_id": 1, "name": 1, "parent_id": 1, "path": 1}))
    mode = (view_mode or "all").strip().lower()
    if mode == "searchable":
        _, searchable_folder_ids = _searchable_scope_ids()
        rows = [row for row in rows if str(row.get("_id", "")) in searchable_folder_ids]
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
                "bucket": _bucket(),
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


def _copy_object(src_key: str, dst_key: str, src_bucket: str | None = None, dst_bucket: str | None = None) -> None:
    if not src_key or not dst_key:
        return
    source_bucket = (src_bucket or "").strip() or _bucket()
    target_bucket = (dst_bucket or "").strip() or _bucket()
    s3_client().copy_object(
        Bucket=target_bucket,
        CopySource={"Bucket": source_bucket, "Key": src_key},
        Key=dst_key,
    )


def _move_object(src_key: str, dst_key: str, src_bucket: str | None = None, dst_bucket: str | None = None) -> None:
    if not src_key or not dst_key:
        return
    source_bucket = (src_bucket or "").strip() or _bucket()
    target_bucket = (dst_bucket or "").strip() or _bucket()
    _copy_object(src_key, dst_key, source_bucket, target_bucket)
    try:
        s3_client().delete_object(Bucket=source_bucket, Key=src_key)
    except Exception:  # noqa: BLE001
        pass


def _is_descendant_folder(parent_id: str, candidate_child_id: str) -> bool:
    if not parent_id or not candidate_child_id:
        return False
    if parent_id == candidate_child_id:
        return True
    return candidate_child_id in _collect_descendant_folder_ids(parent_id)


def copy_item(item_id: str, item_type: str, destination_folder_id: str, scope: str | None = "all") -> Dict[str, Any]:
    _ensure_indexes()
    mode = (scope or "all").strip().lower()
    if mode == "searchable":
        raise ValueError("Copy is disabled in searchable view")
    iid = (item_id or "").strip()
    kind = (item_type or "").strip().lower()
    dest_id = (destination_folder_id or ROOT_FOLDER_ID).strip() or ROOT_FOLDER_ID
    if kind not in {"file", "folder"}:
        raise ValueError("item_type must be file or folder")
    if not iid:
        raise ValueError("id is required")
    dest_folder = _get_folder_or_404(dest_id)
    now = _now()
    files = content_files_collection()
    folders = content_folders_collection()

    if kind == "file":
        src = files.find_one({"_id": iid})
        if not src:
            raise LookupError("File not found")
        target_name = _unique_file_name(dest_folder["_id"], src.get("name", "file"))
        dst_key = _build_object_key(dest_folder, target_name)
        src_key = src.get("s3_key", "")
        src_bucket = str(src.get("bucket", "") or "").strip() or _bucket()
        dst_bucket = _bucket()
        if src_key:
            _copy_object(src_key, dst_key, src_bucket, dst_bucket)
        new_id = _new_id("file")
        files.insert_one({
            "_id": new_id,
            "node_type": "file",
            "parent_id": dest_folder["_id"],
            "folder_id": dest_folder["_id"],
            "name": target_name,
            "content_type": src.get("content_type", "application/octet-stream"),
            "size": int(src.get("size", 0) or 0),
            "etag": src.get("etag", ""),
            "s3_key": dst_key,
            "bucket": dst_bucket,
            "status": "ready",
            "created_at": now,
            "updated_at": now,
        })
        return {"message": "File copied", "item": _file_node(files.find_one({"_id": new_id}))}

    if iid == ROOT_FOLDER_ID:
        raise ValueError("Root folder cannot be copied")
    src_root = folders.find_one({"_id": iid})
    if not src_root:
        raise LookupError("Folder not found")
    if _is_descendant_folder(iid, dest_folder["_id"]):
        raise ValueError("Cannot copy folder into itself or its descendant")

    descendants = _collect_descendant_folder_ids(iid)
    folder_docs = list(folders.find({"_id": {"$in": descendants}}))
    by_id = {d["_id"]: d for d in folder_docs}
    src_path = _folder_path(src_root)
    new_root_name = _unique_folder_name(dest_folder["_id"], src_root.get("name", "Folder"))
    dest_parent_path = _folder_path(dest_folder)
    new_root_path = f"{dest_parent_path}/{new_root_name}".strip("/")

    id_map: Dict[str, str] = {iid: _new_id("folder")}
    path_map: Dict[str, str] = {iid: new_root_path}
    name_map: Dict[str, str] = {iid: new_root_name}

    remaining = [d for d in folder_docs if d["_id"] != iid]
    while remaining:
        progressed = False
        for doc in list(remaining):
            parent_old = doc.get("parent_id")
            if parent_old not in id_map:
                continue
            old_id = doc["_id"]
            old_path = _folder_path(doc)
            suffix = old_path[len(src_path):].lstrip("/") if src_path and old_path.startswith(src_path) else old_path
            segment = suffix.split("/")[-1] if suffix else doc.get("name", "Folder")
            new_path = f"{new_root_path}/{suffix}".strip("/") if suffix else new_root_path
            id_map[old_id] = _new_id("folder")
            path_map[old_id] = new_path
            name_map[old_id] = segment
            remaining.remove(doc)
            progressed = True
        if not progressed:
            raise RuntimeError("Failed to resolve folder copy hierarchy")

    for old_id, new_id in id_map.items():
        old_doc = by_id[old_id]
        folders.insert_one({
            "_id": new_id,
            "name": name_map[old_id],
            "node_type": "folder",
            "parent_id": dest_folder["_id"] if old_id == iid else id_map.get(old_doc.get("parent_id")),
            "path": path_map[old_id],
            "created_at": now,
            "updated_at": now,
        })

    file_docs = list(files.find({"$or": [{"parent_id": {"$in": descendants}}, {"folder_id": {"$in": descendants}}]}))
    copied_files = 0
    for src in file_docs:
        old_parent = src.get("parent_id") or src.get("folder_id")
        if old_parent not in id_map:
            continue
        new_parent = id_map[old_parent]
        target_name = _unique_file_name(new_parent, src.get("name", "file"))
        new_parent_doc = folders.find_one({"_id": new_parent})
        if not new_parent_doc:
            continue
        dst_key = _build_object_key(new_parent_doc, target_name)
        src_bucket = str(src.get("bucket", "") or "").strip() or _bucket()
        dst_bucket = _bucket()
        if src.get("s3_key"):
            _copy_object(src.get("s3_key"), dst_key, src_bucket, dst_bucket)
        files.insert_one({
            "_id": _new_id("file"),
            "node_type": "file",
            "parent_id": new_parent,
            "folder_id": new_parent,
            "name": target_name,
            "content_type": src.get("content_type", "application/octet-stream"),
            "size": int(src.get("size", 0) or 0),
            "etag": src.get("etag", ""),
            "s3_key": dst_key,
            "bucket": dst_bucket,
            "status": "ready",
            "created_at": now,
            "updated_at": now,
        })
        copied_files += 1

    return {
        "message": "Folder copied",
        "item": _folder_node(folders.find_one({"_id": id_map[iid]})),
        "copied_folders": len(id_map),
        "copied_files": copied_files,
    }


def move_item(item_id: str, item_type: str, destination_folder_id: str, scope: str | None = "all") -> Dict[str, Any]:
    _ensure_indexes()
    mode = (scope or "all").strip().lower()
    if mode == "searchable":
        raise ValueError("Move is disabled in searchable view")
    iid = (item_id or "").strip()
    kind = (item_type or "").strip().lower()
    dest_id = (destination_folder_id or ROOT_FOLDER_ID).strip() or ROOT_FOLDER_ID
    if kind not in {"file", "folder"}:
        raise ValueError("item_type must be file or folder")
    if not iid:
        raise ValueError("id is required")
    dest_folder = _get_folder_or_404(dest_id)
    files = content_files_collection()
    folders = content_folders_collection()
    now = _now()

    if kind == "file":
        doc = files.find_one({"_id": iid})
        if not doc:
            raise LookupError("File not found")
        if (doc.get("parent_id") or doc.get("folder_id")) == dest_folder["_id"]:
            return {"message": "File already in destination folder", "item": _file_node(doc)}
        target_name = _unique_file_name(dest_folder["_id"], doc.get("name", "file"), exclude_id=iid)
        dst_key = _build_object_key(dest_folder, target_name)
        src_bucket = str(doc.get("bucket", "") or "").strip() or _bucket()
        dst_bucket = _bucket()
        if doc.get("s3_key") and (doc.get("s3_key") != dst_key or src_bucket != dst_bucket):
            _move_object(doc.get("s3_key"), dst_key, src_bucket, dst_bucket)
        files.update_one(
            {"_id": iid},
            {"$set": {
                "parent_id": dest_folder["_id"],
                "folder_id": dest_folder["_id"],
                "name": target_name,
                "s3_key": dst_key,
                "bucket": dst_bucket,
                "updated_at": now,
            }},
        )
        return {"message": "File moved", "item": _file_node(files.find_one({"_id": iid}))}

    if iid == ROOT_FOLDER_ID:
        raise ValueError("Root folder cannot be moved")
    root = folders.find_one({"_id": iid})
    if not root:
        raise LookupError("Folder not found")
    if _is_descendant_folder(iid, dest_folder["_id"]):
        raise ValueError("Cannot move folder into itself or its descendant")
    if root.get("parent_id") == dest_folder["_id"]:
        return {"message": "Folder already in destination", "item": _folder_node(root)}

    old_root_path = _folder_path(root)
    new_name = _unique_folder_name(dest_folder["_id"], root.get("name", "Folder"), exclude_id=iid)
    new_parent_path = _folder_path(dest_folder)
    new_root_path = f"{new_parent_path}/{new_name}".strip("/")

    folders.update_one(
        {"_id": iid},
        {"$set": {"parent_id": dest_folder["_id"], "name": new_name, "path": new_root_path, "updated_at": now}},
    )
    descendants = list(folders.find({"path": {"$regex": f"^{old_root_path}/"}}))
    for d in descendants:
        d_path = _folder_path(d)
        suffix = d_path[len(old_root_path):].lstrip("/")
        folders.update_one(
            {"_id": d["_id"]},
            {"$set": {"path": f"{new_root_path}/{suffix}".strip("/"), "updated_at": now}},
        )

    moved_folder_ids = _collect_descendant_folder_ids(iid)
    file_docs = list(files.find({"$or": [{"parent_id": {"$in": moved_folder_ids}}, {"folder_id": {"$in": moved_folder_ids}}]}))
    folder_docs = {f["_id"]: f for f in folders.find({"_id": {"$in": moved_folder_ids}})}
    for fdoc in file_docs:
        parent_id = fdoc.get("parent_id") or fdoc.get("folder_id")
        parent_folder = folder_docs.get(parent_id)
        if not parent_folder:
            continue
        target_name = _unique_file_name(parent_folder["_id"], fdoc.get("name", "file"), exclude_id=fdoc["_id"])
        dst_key = _build_object_key(parent_folder, target_name)
        src_key = fdoc.get("s3_key", "")
        src_bucket = str(fdoc.get("bucket", "") or "").strip() or _bucket()
        dst_bucket = _bucket()
        if src_key and (src_key != dst_key or src_bucket != dst_bucket):
            _move_object(src_key, dst_key, src_bucket, dst_bucket)
        files.update_one(
            {"_id": fdoc["_id"]},
            {"$set": {
                "parent_id": parent_folder["_id"],
                "folder_id": parent_folder["_id"],
                "name": target_name,
                "s3_key": dst_key,
                "bucket": dst_bucket,
                "updated_at": now,
            }},
        )

    return {"message": "Folder moved", "item": _folder_node(folders.find_one({"_id": iid}))}


def download_item(item_id: str, item_type: str, recursive: bool = True) -> Dict[str, Any]:
    _ensure_indexes()
    iid = (item_id or "").strip()
    kind = (item_type or "").strip().lower()
    if kind not in {"file", "folder"}:
        raise ValueError("item_type must be file or folder")
    if not iid:
        raise ValueError("id is required")
    files = content_files_collection()
    folders = content_folders_collection()
    s3 = s3_client()
    expires = 3600

    if kind == "file":
        doc = files.find_one({"_id": iid})
        if not doc:
            raise LookupError("File not found")
        key = doc.get("s3_key")
        if not key:
            raise ValueError("File key is missing")
        file_bucket = str(doc.get("bucket", "") or "").strip() or _bucket()
        url = s3.generate_presigned_url("get_object", Params={"Bucket": file_bucket, "Key": key}, ExpiresIn=expires)
        return {"type": "file", "file": _file_node(doc), "download_url": url, "expires_in": expires}

    folder = folders.find_one({"_id": iid})
    if not folder:
        raise LookupError("Folder not found")
    if iid == ROOT_FOLDER_ID:
        base_name = "Root"
    else:
        base_name = folder.get("name", "Folder")

    folder_ids = [iid]
    if recursive:
        folder_ids = _collect_descendant_folder_ids(iid)
    file_docs = list(files.find({"$or": [{"parent_id": {"$in": folder_ids}}, {"folder_id": {"$in": folder_ids}}], "status": "ready"}))
    folder_by_id = {f["_id"]: f for f in folders.find({"_id": {"$in": folder_ids}})}
    root_path = _folder_path(folder)
    downloads: List[Dict[str, Any]] = []
    for fdoc in file_docs:
        key = fdoc.get("s3_key")
        if not key:
            continue
        parent_id = fdoc.get("parent_id") or fdoc.get("folder_id")
        parent = folder_by_id.get(parent_id)
        parent_path = _folder_path(parent) if parent else ""
        rel_dir = ""
        if parent_path and root_path and parent_path.startswith(root_path):
            rel_dir = parent_path[len(root_path):].lstrip("/")
        elif parent_path and not root_path:
            rel_dir = parent_path
        rel_path = f"{rel_dir}/{fdoc.get('name', '')}".strip("/")
        if base_name:
            rel_path = f"{base_name}/{rel_path}".strip("/")
        file_bucket = str(fdoc.get("bucket", "") or "").strip() or _bucket()
        url = s3.generate_presigned_url("get_object", Params={"Bucket": file_bucket, "Key": key}, ExpiresIn=expires)
        downloads.append({
            "file_id": fdoc.get("_id"),
            "name": fdoc.get("name", ""),
            "content_type": fdoc.get("content_type", ""),
            "size": int(fdoc.get("size", 0) or 0),
            "relative_path": rel_path,
            "download_url": url,
        })
    downloads.sort(key=lambda x: x.get("relative_path", ""))
    return {
        "type": "folder",
        "folder": _folder_node(folder),
        "recursive": bool(recursive),
        "count": len(downloads),
        "files": downloads,
        "expires_in": expires,
    }


def delete_item(item_id: str, item_type: str, recursive: bool = False, scope: str | None = "all") -> Dict[str, Any]:
    _ensure_indexes()
    iid = (item_id or "").strip()
    kind = (item_type or "").strip().lower()
    mode = (scope or "all").strip().lower()
    if not iid:
        raise ValueError("id is required")
    if kind not in {"file", "folder"}:
        raise ValueError("item_type must be file or folder")
    if mode not in {"all", "searchable"}:
        raise ValueError("scope must be all or searchable")

    files = content_files_collection()
    folders = content_folders_collection()
    s3 = s3_client()
    bucket = _bucket()

    def _hard_delete_file(file_doc: Dict[str, Any]) -> Dict[str, int]:
        s3_key = file_doc.get("s3_key")
        file_bucket = str(file_doc.get("bucket", "") or "").strip() or bucket
        if s3_key:
            try:
                s3.delete_object(Bucket=file_bucket, Key=s3_key)
            except Exception:  # noqa: BLE001
                pass
        index_deleted = _delete_search_index_by_file_id(str(file_doc.get("_id", "")))
        files.delete_one({"_id": file_doc.get("_id")})
        return index_deleted

    def _unindex_file_only(file_doc: Dict[str, Any]) -> Dict[str, int]:
        index_deleted = _delete_search_index_by_file_id(str(file_doc.get("_id", "")))
        files.update_one(
            {"_id": file_doc.get("_id")},
            {"$set": {"searchable": False, "updated_at": _now()}, "$unset": {"searchable_course": ""}},
        )
        return index_deleted

    if kind == "file":
        file_doc = files.find_one({"_id": iid})
        if not file_doc:
            raise LookupError("File not found")
        if mode == "searchable":
            if _is_searchable_only_file(file_doc):
                index_deleted = _hard_delete_file(file_doc)
                return {
                    "message": "Searchable file deleted (including storage + vector index)",
                    "deleted_files": 1,
                    "deleted_docs": index_deleted["deleted_docs"],
                    "deleted_pages": index_deleted["deleted_pages"],
                }
            index_deleted = _unindex_file_only(file_doc)
            return {
                "message": "File removed from searchable index only",
                "unindexed_files": 1,
                "deleted_docs": index_deleted["deleted_docs"],
                "deleted_pages": index_deleted["deleted_pages"],
            }
        index_deleted = _hard_delete_file(file_doc)
        return {
            "message": "File deleted",
            "deleted_files": 1,
            "deleted_docs": index_deleted["deleted_docs"],
            "deleted_pages": index_deleted["deleted_pages"],
        }

    if iid == ROOT_FOLDER_ID:
        raise ValueError("Root folder cannot be deleted")

    folder_doc = folders.find_one({"_id": iid})
    if not folder_doc:
        raise LookupError("Folder not found")

    child_exists = folders.find_one({"parent_id": iid}) or files.find_one({"$or": [{"parent_id": iid}, {"folder_id": iid}]})
    if child_exists and not recursive:
        raise ValueError("Folder is not empty. Use recursive delete.")

    folder_ids = _collect_descendant_folder_ids(iid)
    file_docs = list(
        files.find(
            {
                "$or": [
                    {"parent_id": {"$in": folder_ids}},
                    {"folder_id": {"$in": folder_ids}},
                ]
            }
        )
    )

    if mode == "searchable":
        deleted_files = 0
        unindexed_files = 0
        deleted_docs = 0
        deleted_pages = 0
        for fdoc in file_docs:
            has_index = pdf_docs_collection().find_one({"source_file_id": str(fdoc.get("_id", ""))}, {"_id": 1})
            if not has_index and not _is_searchable_only_file(fdoc):
                continue
            if _is_searchable_only_file(fdoc):
                idx = _hard_delete_file(fdoc)
                deleted_files += 1
            else:
                idx = _unindex_file_only(fdoc)
                unindexed_files += 1
            deleted_docs += idx["deleted_docs"]
            deleted_pages += idx["deleted_pages"]

        # Remove now-empty searchable-only folders from this subtree.
        folder_docs = list(folders.find({"_id": {"$in": folder_ids}}))
        folder_docs.sort(key=lambda row: len(str(row.get("path", "") or "").split("/")), reverse=True)
        removed_folders = 0
        for frow in folder_docs:
            fid = str(frow.get("_id", "") or "")
            if not fid or fid == ROOT_FOLDER_ID:
                continue
            has_child_folders = folders.find_one({"parent_id": fid}, {"_id": 1})
            has_child_files = files.find_one({"$or": [{"parent_id": fid}, {"folder_id": fid}]}, {"_id": 1})
            if not has_child_folders and not has_child_files:
                folders.delete_one({"_id": fid})
                removed_folders += 1

        return {
            "message": "Searchable delete completed",
            "deleted_files": deleted_files,
            "unindexed_files": unindexed_files,
            "deleted_docs": deleted_docs,
            "deleted_pages": deleted_pages,
            "deleted_folders": removed_folders,
        }

    keys_by_bucket: Dict[str, List[str]] = {}
    for fdoc in file_docs:
        s3_key = fdoc.get("s3_key")
        if not s3_key:
            continue
        file_bucket = str(fdoc.get("bucket", "") or "").strip() or bucket
        keys_by_bucket.setdefault(file_bucket, []).append(s3_key)
    for bucket_name, keys in keys_by_bucket.items():
        for start in range(0, len(keys), 1000):
            chunk = keys[start:start + 1000]
            try:
                s3.delete_objects(Bucket=bucket_name, Delete={"Objects": [{"Key": k} for k in chunk], "Quiet": True})
            except Exception:  # noqa: BLE001
                pass

    deleted_docs = 0
    deleted_pages = 0
    for fdoc in file_docs:
        idx = _delete_search_index_by_file_id(str(fdoc.get("_id", "")))
        deleted_docs += idx["deleted_docs"]
        deleted_pages += idx["deleted_pages"]

    files.delete_many({"$or": [{"parent_id": {"$in": folder_ids}}, {"folder_id": {"$in": folder_ids}}]})
    folders.delete_many({"_id": {"$in": [fid for fid in folder_ids if fid != ROOT_FOLDER_ID]}})
    return {
        "message": "Folder deleted",
        "deleted_folders": len(folder_ids),
        "deleted_files": len(file_docs),
        "deleted_docs": deleted_docs,
        "deleted_pages": deleted_pages,
    }


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
    file_bucket = str(doc.get("bucket", "") or "").strip() or _bucket()
    url = s3_client().generate_presigned_url(
        "get_object",
        Params={"Bucket": file_bucket, "Key": key},
        ExpiresIn=3600,
    )
    return {
        "file": _file_node(doc),
        "preview_url": url,
    }


def _is_pdf_file(file_doc: Dict[str, Any]) -> bool:
    name = str(file_doc.get("name", "") or "").lower()
    content_type = str(file_doc.get("content_type", "") or "").lower()
    return name.endswith(".pdf") or "pdf" in content_type


def _files_for_item(item_id: str, item_type: str) -> List[Dict[str, Any]]:
    files = content_files_collection()
    if item_type == "file":
        doc = files.find_one({"_id": item_id})
        if not doc:
            raise LookupError("File not found")
        return [doc]
    if item_type == "folder":
        folder = content_folders_collection().find_one({"_id": item_id})
        if not folder:
            raise LookupError("Folder not found")
        folder_ids = _collect_descendant_folder_ids(item_id)
        return list(
            files.find(
                {
                    "$or": [
                        {"parent_id": {"$in": folder_ids}},
                        {"folder_id": {"$in": folder_ids}},
                    ]
                }
            )
        )
    raise ValueError("item_type must be file or folder")


def _is_searchable_only_file(file_doc: Dict[str, Any]) -> bool:
    return (
        str(file_doc.get("visibility_scope", "")).strip().lower() == "searchable_only"
        or str(file_doc.get("source", "")).strip().lower() == "pdf_search_upload"
    )


def _delete_search_index_by_file_id(file_id: str) -> Dict[str, int]:
    docs = pdf_docs_collection()
    pages = settings()["mongodb_pdf_pages_collection"]
    pages_coll = docs.database[pages]
    doc_rows = list(docs.find({"source_file_id": file_id}, {"doc_id": 1}))
    doc_ids = [str(row.get("doc_id", "")).strip() for row in doc_rows if row.get("doc_id")]
    if not doc_ids:
        return {"deleted_docs": 0, "deleted_pages": 0}
    delete_pages_result = pages_coll.delete_many({"doc_id": {"$in": doc_ids}})
    delete_docs_result = docs.delete_many({"doc_id": {"$in": doc_ids}})
    return {
        "deleted_docs": int(delete_docs_result.deleted_count or 0),
        "deleted_pages": int(delete_pages_result.deleted_count or 0),
    }


def make_item_searchable(item_id: str, item_type: str, course: str) -> Dict[str, Any]:
    _ensure_indexes()
    iid = (item_id or "").strip()
    kind = (item_type or "").strip().lower()
    normalized_course = _normalize_course(course)
    if not iid:
        raise ValueError("id is required")
    if kind not in {"file", "folder"}:
        raise ValueError("item_type must be file or folder")
    if not normalized_course:
        allowed = ", ".join(COURSE_OPTIONS.values())
        raise ValueError(f"course is required and must be one of: {allowed}")

    candidates = _files_for_item(iid, kind)
    if not candidates:
        raise ValueError("No files found for this item")

    docs = pdf_docs_collection()
    files = content_files_collection()
    now = _now()
    indexed: List[Dict[str, Any]] = []
    failed: List[Dict[str, Any]] = []
    skipped: List[Dict[str, Any]] = []

    for file_doc in candidates:
        file_id = str(file_doc.get("_id", "") or "").strip()
        file_name = str(file_doc.get("name", "") or "").strip()
        status = str(file_doc.get("status", "") or "").strip().lower()
        key = str(file_doc.get("s3_key", "") or "").strip()
        if not file_id:
            continue
        if not _is_pdf_file(file_doc):
            skipped.append({"file_id": file_id, "file_name": file_name, "reason": "not_pdf"})
            continue
        if status != "ready":
            skipped.append({"file_id": file_id, "file_name": file_name, "reason": "upload_not_ready"})
            continue
        if not key:
            skipped.append({"file_id": file_id, "file_name": file_name, "reason": "missing_storage_key"})
            continue

        doc_id = f"content:{file_id}"
        docs.update_one(
            {"doc_id": doc_id},
            {
                "$set": {
                    "doc_id": doc_id,
                    "file_name": file_name or "document.pdf",
                    "bucket": str(file_doc.get("bucket", "") or "").strip() or _bucket(),
                    "key": key,
                    "course": normalized_course,
                    "course_label": COURSE_OPTIONS[normalized_course],
                    "status": "uploaded_pending_index",
                    "source": "content_drive",
                    "source_file_id": file_id,
                    "updated_at": now,
                },
                "$setOnInsert": {"created_at": now},
            },
            upsert=True,
        )
        files.update_one(
            {"_id": file_id},
            {"$set": {"searchable": True, "searchable_course": normalized_course, "updated_at": now}},
        )
        try:
            result = index_pdf_document(SimpleNamespace(doc_id=doc_id))
            indexed.append(
                {
                    "file_id": file_id,
                    "file_name": file_name,
                    "doc_id": doc_id,
                    "page_count": int(result.get("page_count", 0) or 0),
                }
            )
        except Exception as err:  # noqa: BLE001
            failed.append(
                {
                    "file_id": file_id,
                    "file_name": file_name,
                    "doc_id": doc_id,
                    "error": str(err),
                }
            )

    if not indexed and failed:
        raise RuntimeError(
            "Unable to index selected item. "
            f"Failures: {len(failed)}, skipped: {len(skipped)}"
        )

    return {
        "message": "Searchable indexing completed",
        "item_type": kind,
        "course": normalized_course,
        "course_label": COURSE_OPTIONS[normalized_course],
        "total_candidates": len(candidates),
        "indexed_count": len(indexed),
        "failed_count": len(failed),
        "skipped_count": len(skipped),
        "indexed": indexed,
        "failed": failed,
        "skipped": skipped,
    }
