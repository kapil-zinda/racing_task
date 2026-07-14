"""Noter — Notion-style document editor with a directory (folders) layer.

Doc metadata (title, timestamps, parent folder) lives in Mongo (`noter_docs`);
the document body (BlockNote block JSON), uploaded assets and the entire
version history live in S3 under `{noter_prefix}/{user_id}/{doc_id}/`:

    latest.json                  — current document state
    versions/{stamp}.json        — immutable point-in-time snapshots (the history)
    assets/{uuid}_{filename}     — images/files embedded in the doc

Version history is achieved from S3 alone: a snapshot of the saved state is
written whenever the last snapshot is older than `noter_version_interval_seconds`
(and always on create, on manual "save version", and before a restore). Listing
and reading versions is a pure S3 prefix listing — no Mongo involvement.

Folders (`noter_folders`) are plain Mongo rows — name/parent_id/path, one root
per user (`nfolder_root:{user_id}`) — mirroring `content_domain.py`'s directory
model. Unlike Content, a doc's S3 location is keyed by its Mongo id, not its
folder path, so moving a doc between folders never touches S3 — only copy/
duplicate does (cloning `latest.json` plus any assets it references).
"""

import json
import re
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from bson import ObjectId
from pymongo import ASCENDING, DESCENDING

from .context import logger, noter_docs_collection, noter_folders_collection, settings, storage_client

_MAX_CONTENT_BYTES = 5 * 1024 * 1024  # a doc body larger than this is almost certainly a bug
_VERSION_STAMP_RE = re.compile(r"^\d{8}T\d{12}Z$")
_folder_indexes_ensured = False


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _now_iso() -> str:
    return _now().isoformat()


def _uid(user_id: str) -> str:
    uid = (user_id or "").strip()
    if not uid:
        raise ValueError("Invalid user_id")
    return uid


def _oid(doc_id: str) -> ObjectId:
    try:
        return ObjectId(doc_id)
    except Exception:
        raise ValueError("Invalid doc id")


def _bucket() -> str:
    bucket = settings()["content_bucket"]
    if not bucket:
        raise RuntimeError("CONTENT_BUCKET / RECORDING_BUCKET is not configured")
    return bucket


def _doc_prefix(uid: str, doc_id: str) -> str:
    return f"{settings()['noter_prefix']}/{uid}/{doc_id}"


def _latest_key(uid: str, doc_id: str) -> str:
    return f"{_doc_prefix(uid, doc_id)}/latest.json"


def _versions_prefix(uid: str, doc_id: str) -> str:
    return f"{_doc_prefix(uid, doc_id)}/versions/"


def _version_key(uid: str, doc_id: str, stamp: str) -> str:
    return f"{_versions_prefix(uid, doc_id)}{stamp}.json"


def _version_stamp(dt: Optional[datetime] = None) -> str:
    return (dt or _now()).strftime("%Y%m%dT%H%M%S%fZ")


def _stamp_to_iso(stamp: str) -> str:
    try:
        return datetime.strptime(stamp, "%Y%m%dT%H%M%S%fZ").replace(tzinfo=timezone.utc).isoformat()
    except ValueError:
        return ""


def _extract_text(content: Any, limit: int = 200) -> str:
    """Flatten BlockNote block JSON into plain text for list previews."""
    parts: List[str] = []

    def walk(node: Any) -> None:
        if len(" ".join(parts)) >= limit:
            return
        if isinstance(node, list):
            for item in node:
                walk(item)
        elif isinstance(node, dict):
            text = node.get("text")
            if isinstance(text, str) and text.strip():
                parts.append(text.strip())
            walk(node.get("content"))
            walk(node.get("children"))

    walk(content)
    return " ".join(" ".join(parts).split())[:limit]


def _summary(doc: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": str(doc["_id"]),
        "type": "doc",
        "title": doc.get("title") or "Untitled",
        "preview": doc.get("preview") or "",
        "parent_id": doc.get("parent_id") or "",
        "createdAt": doc.get("createdAt") or "",
        "updatedAt": doc.get("updatedAt") or doc.get("createdAt") or "",
    }


def _body_bytes(title: str, content: Any) -> bytes:
    body = json.dumps(
        {"title": title, "content": content if isinstance(content, list) else [], "savedAt": _now_iso()},
        ensure_ascii=False,
    ).encode("utf-8")
    if len(body) > _MAX_CONTENT_BYTES:
        raise ValueError("Document is too large to save")
    return body


def _read_json_object(key: str) -> Optional[Dict[str, Any]]:
    client = storage_client()
    try:
        raw = client.get_object(Bucket=_bucket(), Key=key)["Body"].read()
    except client.exceptions.NoSuchKey:
        return None
    except Exception as err:  # noqa: BLE001 — B2 surfaces missing keys as generic ClientError
        if "NoSuchKey" in str(err) or "404" in str(err):
            return None
        raise
    try:
        return json.loads(raw.decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        logger.warning("noter: unreadable JSON at %s", key)
        return None


def _mongo_doc(uid: str, doc_id: str) -> Dict[str, Any]:
    doc = noter_docs_collection().find_one({"_id": _oid(doc_id), "user_id": uid})
    if not doc:
        raise LookupError("Document not found")
    return doc


# --- Folders (directory layer) ---


def _ensure_folder_indexes() -> None:
    global _folder_indexes_ensured
    if _folder_indexes_ensured:
        return
    noter_folders_collection().create_index([("parent_id", ASCENDING), ("name", ASCENDING)], unique=True)
    noter_folders_collection().create_index([("path", ASCENDING)])
    noter_docs_collection().create_index([("user_id", ASCENDING), ("parent_id", ASCENDING)])
    _folder_indexes_ensured = True


def _user_root_folder_id(uid: str) -> str:
    return f"nfolder_root:{uid}"


def _ensure_root_folder(uid: str) -> None:
    _ensure_folder_indexes()
    root_id = _user_root_folder_id(uid)
    now = _now_iso()
    noter_folders_collection().update_one(
        {"_id": root_id},
        {
            "$setOnInsert": {
                "_id": root_id,
                # Use uid as the name so the (parent_id, name) unique index doesn't
                # collide across users' roots, which all share parent_id=None.
                "name": uid,
                "parent_id": None,
                "path": "",
                "user_id": uid,
                "created_at": now,
            },
            "$set": {"updated_at": now},
        },
        upsert=True,
    )


def _safe_name(name: str) -> str:
    value = (name or "").strip()
    if not value:
        raise ValueError("name is required")
    if "/" in value or "\\" in value:
        raise ValueError("name cannot contain / or \\")
    if value in {".", ".."}:
        raise ValueError("Invalid name")
    return value[:200]


def _get_folder_or_404(uid: str, folder_id: str) -> Dict[str, Any]:
    folder = noter_folders_collection().find_one({"_id": folder_id, "user_id": uid})
    if not folder:
        raise LookupError("Folder not found")
    return folder


def _folder_path(folder: Dict[str, Any]) -> str:
    return (folder.get("path") or "").strip("/")


def _folder_node(folder: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": folder["_id"],
        "type": "folder",
        "name": folder.get("name", ""),
        "parent_id": folder.get("parent_id"),
        "path": folder.get("path", ""),
        "createdAt": folder.get("created_at", ""),
        "updatedAt": folder.get("updated_at", ""),
    }


def _unique_folder_name(parent_id: str, base_name: str, exclude_id: Optional[str] = None) -> str:
    folders = noter_folders_collection()
    name = _safe_name(base_name)
    if not folders.find_one({"parent_id": parent_id, "name": name, "_id": {"$ne": exclude_id}}):
        return name
    idx = 1
    while True:
        candidate = f"{name} ({idx})"
        if not folders.find_one({"parent_id": parent_id, "name": candidate, "_id": {"$ne": exclude_id}}):
            return candidate
        idx += 1


def _collect_descendant_folder_ids(uid: str, folder_id: str) -> List[str]:
    folders = noter_folders_collection()
    all_rows = list(folders.find({"user_id": uid}, {"_id": 1, "parent_id": 1}))
    children_by_parent: Dict[Any, List[str]] = {}
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


def _is_descendant_folder(uid: str, parent_id: str, candidate_child_id: str) -> bool:
    if not parent_id or not candidate_child_id:
        return False
    if parent_id == candidate_child_id:
        return True
    return candidate_child_id in _collect_descendant_folder_ids(uid, parent_id)


def list_folder_tree_payload(user_id: str) -> Dict[str, Any]:
    uid = _uid(user_id)
    _ensure_root_folder(uid)
    rows = list(noter_folders_collection().find({"user_id": uid}, {"_id": 1, "name": 1, "parent_id": 1, "path": 1}))
    return {
        "folders": [
            {"id": r["_id"], "name": r.get("name", ""), "parent_id": r.get("parent_id"), "path": r.get("path", "")}
            for r in rows
        ],
        "root_id": _user_root_folder_id(uid),
    }


def create_folder_payload(user_id: str, parent_id: str, name: str) -> Dict[str, Any]:
    uid = _uid(user_id)
    _ensure_root_folder(uid)
    pname = _safe_name(name)
    root_id = _user_root_folder_id(uid)
    raw_pid = (parent_id or root_id).strip() or root_id
    parent = _get_folder_or_404(uid, raw_pid)
    folders = noter_folders_collection()

    existing = folders.find_one({"parent_id": parent["_id"], "name": pname})
    if existing:
        return {"folder": _folder_node(existing), "created": False}

    new_id = f"nfolder:{uuid.uuid4().hex}"
    now = _now_iso()
    doc = {
        "_id": new_id,
        "name": pname,
        "parent_id": parent["_id"],
        "path": f"{_folder_path(parent)}/{pname}".strip("/"),
        "user_id": uid,
        "created_at": now,
        "updated_at": now,
    }
    folders.insert_one(doc)
    return {"folder": _folder_node(doc), "created": True}


def list_directory_payload(
    user_id: str,
    folder_id: Optional[str],
    q: Optional[str] = None,
    sort_by: Optional[str] = None,
    sort_dir: Optional[str] = None,
) -> Dict[str, Any]:
    uid = _uid(user_id)
    _ensure_root_folder(uid)
    root_id = _user_root_folder_id(uid)
    fid = (folder_id or root_id).strip() or root_id
    folder = _get_folder_or_404(uid, fid)
    folders = noter_folders_collection()
    docs = noter_docs_collection()

    folder_query: Dict[str, Any] = {"parent_id": fid, "user_id": uid}
    if q:
        folder_query["name"] = {"$regex": re.escape(q), "$options": "i"}
    subfolders = list(folders.find(folder_query).sort("name", 1))

    doc_query: Dict[str, Any] = {"user_id": uid}
    if fid == root_id:
        # Docs created before folders existed have no parent_id — treat them as
        # living at the root rather than orphaning them.
        doc_query["$or"] = [{"parent_id": fid}, {"parent_id": {"$exists": False}}, {"parent_id": None}]
    else:
        doc_query["parent_id"] = fid
    if q:
        doc_query["title"] = {"$regex": re.escape(q), "$options": "i"}
    doc_rows = list(docs.find(doc_query))

    items = [_folder_node(f) for f in subfolders] + [_summary(d) for d in doc_rows]
    key = (sort_by or "name").strip()
    reverse = (sort_dir or "asc").lower() == "desc"

    def sort_val(item: Dict[str, Any]):
        if key == "modified":
            return item.get("updatedAt", "")
        return (item.get("title") or item.get("name") or "").lower()

    items.sort(key=sort_val, reverse=reverse)
    return {
        "folder": _folder_node(folder),
        "items": items,
        "q": q or "",
        "sort_by": key,
        "sort_dir": "desc" if reverse else "asc",
    }


def _delete_doc_row(uid: str, doc: Dict[str, Any]) -> None:
    """Removes every S3 object under a single doc's prefix plus its Mongo row.
    S3 cleanup is best-effort — an orphaned object under a deleted doc's prefix
    is harmless, so failures here should never block the Mongo delete."""
    client = storage_client()
    bucket = _bucket()
    prefix = f"{_doc_prefix(uid, str(doc['_id']))}/"
    token = None
    while True:
        kwargs = {"Bucket": bucket, "Prefix": prefix, "MaxKeys": 1000}
        if token:
            kwargs["ContinuationToken"] = token
        resp = client.list_objects_v2(**kwargs)
        keys = [{"Key": item["Key"]} for item in resp.get("Contents", [])]
        if keys:
            client.delete_objects(Bucket=bucket, Delete={"Objects": keys, "Quiet": True})
        if not resp.get("IsTruncated"):
            break
        token = resp.get("NextContinuationToken")
    noter_docs_collection().delete_one({"_id": doc["_id"]})


def _rewrite_asset_urls(content: Any, old_prefix: str, new_prefix: str, client: Any, bucket: str) -> None:
    """Deep-walks BlockNote block JSON; any block whose `props.url` points at an
    asset under `old_prefix` gets that S3 object copied under `new_prefix` and
    the JSON rewritten in place to the new key. Used by doc copy/duplicate so a
    cloned doc doesn't silently break if the original is later deleted."""

    def walk(node: Any) -> None:
        if isinstance(node, list):
            for item in node:
                walk(item)
        elif isinstance(node, dict):
            props = node.get("props")
            if isinstance(props, dict):
                url = props.get("url")
                if isinstance(url, str) and url.startswith(old_prefix):
                    new_key = new_prefix + url[len(old_prefix):]
                    try:
                        client.copy_object(Bucket=bucket, CopySource={"Bucket": bucket, "Key": url}, Key=new_key)
                        props["url"] = new_key
                    except Exception:  # noqa: BLE001 — best-effort; a stale url beats a failed clone
                        logger.warning("noter: failed to copy asset %s -> %s", url, new_key)
            walk(node.get("content"))
            walk(node.get("children"))

    walk(content)


def _clone_doc(uid: str, src_doc: Dict[str, Any], dest_parent_id: str, name_override: Optional[str] = None) -> Dict[str, Any]:
    """Creates a new doc under `dest_parent_id` from `src_doc`'s current content.
    A copy starts a fresh version history (it's a new document, not a history
    fork) but carries its own copies of any referenced assets."""
    title = (name_override if name_override is not None else (src_doc.get("title") or "Untitled"))[:200]
    src_doc_id = str(src_doc["_id"])
    latest = _read_json_object(_latest_key(uid, src_doc_id)) or {}
    content = latest.get("content") if isinstance(latest.get("content"), list) else []

    now = _now_iso()
    record = {
        "user_id": uid,
        "title": title,
        "parent_id": dest_parent_id,
        "preview": _extract_text(content),
        "createdAt": now,
        "updatedAt": now,
        "lastSnapshotAt": now,
    }
    result = noter_docs_collection().insert_one(record)
    new_doc_id = str(result.inserted_id)

    client = storage_client()
    bucket = _bucket()
    _rewrite_asset_urls(
        content,
        f"{_doc_prefix(uid, src_doc_id)}/assets/",
        f"{_doc_prefix(uid, new_doc_id)}/assets/",
        client,
        bucket,
    )
    body = _body_bytes(title, content)
    client.put_object(Bucket=bucket, Key=_latest_key(uid, new_doc_id), Body=body, ContentType="application/json")
    client.put_object(
        Bucket=bucket, Key=_version_key(uid, new_doc_id, _version_stamp()), Body=body, ContentType="application/json"
    )
    record["_id"] = result.inserted_id
    return record


def rename_item_payload(user_id: str, item_id: str, item_type: str, new_name: str) -> Dict[str, Any]:
    uid = _uid(user_id)
    kind = (item_type or "").strip().lower()
    iid = (item_id or "").strip()
    name = _safe_name(new_name)
    if not iid:
        raise ValueError("id is required")

    if kind == "doc":
        doc = _mongo_doc(uid, iid)
        noter_docs_collection().update_one({"_id": doc["_id"]}, {"$set": {"title": name, "updatedAt": _now_iso()}})
        return {"item": _summary(noter_docs_collection().find_one({"_id": doc["_id"]}))}

    if kind == "folder":
        root_id = _user_root_folder_id(uid)
        if iid == root_id:
            raise ValueError("Root folder cannot be renamed")
        folders = noter_folders_collection()
        folder = _get_folder_or_404(uid, iid)
        conflict = folders.find_one({"parent_id": folder["parent_id"], "name": name, "_id": {"$ne": iid}})
        if conflict:
            raise ValueError("A folder with this name already exists here")

        old_path = _folder_path(folder)
        parent = _get_folder_or_404(uid, folder["parent_id"])
        new_path = f"{_folder_path(parent)}/{name}".strip("/")
        now = _now_iso()
        folders.update_one({"_id": iid}, {"$set": {"name": name, "path": new_path, "updated_at": now}})

        descendants = list(folders.find({"path": {"$regex": f"^{re.escape(old_path)}/"}, "user_id": uid}))
        for d in descendants:
            d_path = _folder_path(d)
            suffix = d_path[len(old_path):].lstrip("/")
            folders.update_one({"_id": d["_id"]}, {"$set": {"path": f"{new_path}/{suffix}".strip("/"), "updated_at": now}})
        return {"item": _folder_node(folders.find_one({"_id": iid}))}

    raise ValueError("item_type must be doc or folder")


def move_item_payload(user_id: str, item_id: str, item_type: str, destination_folder_id: str) -> Dict[str, Any]:
    uid = _uid(user_id)
    kind = (item_type or "").strip().lower()
    iid = (item_id or "").strip()
    if kind not in {"doc", "folder"}:
        raise ValueError("item_type must be doc or folder")
    if not iid:
        raise ValueError("id is required")
    root_id = _user_root_folder_id(uid)
    dest_id = (destination_folder_id or root_id).strip() or root_id
    dest_folder = _get_folder_or_404(uid, dest_id)
    folders = noter_folders_collection()

    if kind == "doc":
        doc = _mongo_doc(uid, iid)
        if (doc.get("parent_id") or root_id) == dest_folder["_id"]:
            return {"item": _summary(doc)}
        noter_docs_collection().update_one(
            {"_id": doc["_id"]}, {"$set": {"parent_id": dest_folder["_id"], "updatedAt": _now_iso()}}
        )
        return {"item": _summary(noter_docs_collection().find_one({"_id": doc["_id"]}))}

    if iid == root_id:
        raise ValueError("Root folder cannot be moved")
    folder = _get_folder_or_404(uid, iid)
    if _is_descendant_folder(uid, iid, dest_folder["_id"]):
        raise ValueError("Cannot move a folder into itself or its own descendant")
    if folder.get("parent_id") == dest_folder["_id"]:
        return {"item": _folder_node(folder)}

    new_name = _unique_folder_name(dest_folder["_id"], folder.get("name", "Folder"), exclude_id=iid)
    old_path = _folder_path(folder)
    new_path = f"{_folder_path(dest_folder)}/{new_name}".strip("/")
    now = _now_iso()
    folders.update_one(
        {"_id": iid}, {"$set": {"parent_id": dest_folder["_id"], "name": new_name, "path": new_path, "updated_at": now}}
    )
    descendants = list(folders.find({"path": {"$regex": f"^{re.escape(old_path)}/"}, "user_id": uid}))
    for d in descendants:
        d_path = _folder_path(d)
        suffix = d_path[len(old_path):].lstrip("/")
        folders.update_one({"_id": d["_id"]}, {"$set": {"path": f"{new_path}/{suffix}".strip("/"), "updated_at": now}})
    return {"item": _folder_node(folders.find_one({"_id": iid}))}


def copy_item_payload(user_id: str, item_id: str, item_type: str, destination_folder_id: str) -> Dict[str, Any]:
    uid = _uid(user_id)
    kind = (item_type or "").strip().lower()
    iid = (item_id or "").strip()
    if kind not in {"doc", "folder"}:
        raise ValueError("item_type must be doc or folder")
    if not iid:
        raise ValueError("id is required")
    root_id = _user_root_folder_id(uid)
    dest_id = (destination_folder_id or root_id).strip() or root_id
    dest_folder = _get_folder_or_404(uid, dest_id)
    folders = noter_folders_collection()

    if kind == "doc":
        src = _mongo_doc(uid, iid)
        cloned = _clone_doc(uid, src, dest_folder["_id"])
        return {"item": _summary(cloned)}

    if iid == root_id:
        raise ValueError("Root folder cannot be copied")
    src_root = _get_folder_or_404(uid, iid)
    if _is_descendant_folder(uid, iid, dest_folder["_id"]):
        raise ValueError("Cannot copy a folder into itself or its own descendant")

    descendant_ids = _collect_descendant_folder_ids(uid, iid)
    folder_docs = list(folders.find({"_id": {"$in": descendant_ids}}))
    by_id = {d["_id"]: d for d in folder_docs}
    src_path = _folder_path(src_root)
    new_root_name = _unique_folder_name(dest_folder["_id"], src_root.get("name", "Folder"))
    new_root_path = f"{_folder_path(dest_folder)}/{new_root_name}".strip("/")

    id_map: Dict[str, str] = {iid: f"nfolder:{uuid.uuid4().hex}"}
    path_map: Dict[str, str] = {iid: new_root_path}
    name_map: Dict[str, str] = {iid: new_root_name}
    remaining = [d for d in folder_docs if d["_id"] != iid]
    while remaining:
        progressed = False
        for fdoc in list(remaining):
            parent_old = fdoc.get("parent_id")
            if parent_old not in id_map:
                continue
            old_id = fdoc["_id"]
            old_path = _folder_path(fdoc)
            suffix = old_path[len(src_path):].lstrip("/") if src_path and old_path.startswith(src_path) else old_path
            segment = suffix.split("/")[-1] if suffix else fdoc.get("name", "Folder")
            new_path = f"{new_root_path}/{suffix}".strip("/") if suffix else new_root_path
            id_map[old_id] = f"nfolder:{uuid.uuid4().hex}"
            path_map[old_id] = new_path
            name_map[old_id] = segment
            remaining.remove(fdoc)
            progressed = True
        if not progressed:
            raise RuntimeError("Failed to resolve folder copy hierarchy")

    now = _now_iso()
    for old_id, new_id in id_map.items():
        old_doc = by_id[old_id]
        folders.insert_one({
            "_id": new_id,
            "name": name_map[old_id],
            "parent_id": dest_folder["_id"] if old_id == iid else id_map.get(old_doc.get("parent_id")),
            "path": path_map[old_id],
            "user_id": uid,
            "created_at": now,
            "updated_at": now,
        })

    docs_in_scope = list(noter_docs_collection().find({"user_id": uid, "parent_id": {"$in": descendant_ids}}))
    copied_docs = 0
    for src_doc in docs_in_scope:
        old_parent = src_doc.get("parent_id")
        if old_parent not in id_map:
            continue
        _clone_doc(uid, src_doc, id_map[old_parent])
        copied_docs += 1

    return {
        "item": _folder_node(folders.find_one({"_id": id_map[iid]})),
        "copied_folders": len(id_map),
        "copied_docs": copied_docs,
    }


def duplicate_item_payload(user_id: str, item_id: str, item_type: str) -> Dict[str, Any]:
    uid = _uid(user_id)
    kind = (item_type or "").strip().lower()
    iid = (item_id or "").strip()

    if kind == "doc":
        src = _mongo_doc(uid, iid)
        parent_id = src.get("parent_id") or _user_root_folder_id(uid)
        cloned = _clone_doc(uid, src, parent_id, name_override=f"{src.get('title') or 'Untitled'} (copy)")
        return {"item": _summary(cloned)}

    if kind == "folder":
        root_id = _user_root_folder_id(uid)
        if iid == root_id:
            raise ValueError("Root folder cannot be duplicated")
        folder = _get_folder_or_404(uid, iid)
        parent_id = folder.get("parent_id") or root_id
        # Duplicating into its own parent naturally lands on "Name (1)" via the
        # same uniqueness resolver copy_item_payload already uses for folders.
        return copy_item_payload(uid, iid, "folder", parent_id)

    raise ValueError("item_type must be doc or folder")


def delete_item_payload(user_id: str, item_id: str, item_type: str, recursive: bool = False) -> Dict[str, Any]:
    uid = _uid(user_id)
    kind = (item_type or "").strip().lower()
    iid = (item_id or "").strip()
    if kind not in {"doc", "folder"}:
        raise ValueError("item_type must be doc or folder")
    if not iid:
        raise ValueError("id is required")

    if kind == "doc":
        doc = _mongo_doc(uid, iid)
        _delete_doc_row(uid, doc)
        return {"deleted": True, "deleted_docs": 1, "deleted_folders": 0}

    root_id = _user_root_folder_id(uid)
    if iid == root_id:
        raise ValueError("Root folder cannot be deleted")
    folders = noter_folders_collection()
    _get_folder_or_404(uid, iid)  # 404s if missing/not owned

    folder_ids = _collect_descendant_folder_ids(uid, iid)
    docs_in_scope = list(noter_docs_collection().find({"user_id": uid, "parent_id": {"$in": folder_ids}}))
    if (len(folder_ids) > 1 or docs_in_scope) and not recursive:
        raise ValueError("Folder is not empty. Use recursive delete.")

    for doc in docs_in_scope:
        _delete_doc_row(uid, doc)
    folders.delete_many({"_id": {"$in": folder_ids}})
    return {"deleted": True, "deleted_docs": len(docs_in_scope), "deleted_folders": len(folder_ids)}


# --- Docs ---


def list_docs_payload(user_id: str, limit: int = 100, offset: int = 0) -> Dict[str, Any]:
    uid = _uid(user_id)
    limit = max(1, min(int(limit or 100), 200))
    offset = max(0, int(offset or 0))
    collection = noter_docs_collection()
    total = collection.count_documents({"user_id": uid})
    docs = (
        collection.find({"user_id": uid}, {"title": 1, "preview": 1, "createdAt": 1, "updatedAt": 1})
        .sort("updatedAt", DESCENDING)
        .skip(offset)
        .limit(limit)
    )
    items = [_summary(d) for d in docs]
    return {"docs": items, "total": total, "offset": offset, "limit": limit, "hasMore": offset + len(items) < total}


def create_doc_payload(user_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    uid = _uid(user_id)
    _ensure_root_folder(uid)
    root_id = _user_root_folder_id(uid)
    raw_parent = str(payload.get("parent_id") or root_id).strip() or root_id
    parent = _get_folder_or_404(uid, raw_parent)
    title = (str(payload.get("title") or "").strip() or "Untitled")[:200]
    content = payload.get("content") if isinstance(payload.get("content"), list) else []
    now = _now_iso()
    record = {
        "user_id": uid,
        "title": title,
        "parent_id": parent["_id"],
        "preview": _extract_text(content),
        "createdAt": now,
        "updatedAt": now,
        "lastSnapshotAt": now,
    }
    result = noter_docs_collection().insert_one(record)
    doc_id = str(result.inserted_id)
    body = _body_bytes(title, content)
    client = storage_client()
    client.put_object(Bucket=_bucket(), Key=_latest_key(uid, doc_id), Body=body, ContentType="application/json")
    # Every doc starts with one snapshot so history is never empty.
    client.put_object(
        Bucket=_bucket(), Key=_version_key(uid, doc_id, _version_stamp()), Body=body, ContentType="application/json"
    )
    record["_id"] = result.inserted_id
    return {"doc": {**_summary(record), "content": content}}


def get_doc_payload(user_id: str, doc_id: str) -> Dict[str, Any]:
    uid = _uid(user_id)
    doc = _mongo_doc(uid, doc_id)
    latest = _read_json_object(_latest_key(uid, doc_id)) or {}
    content = latest.get("content") if isinstance(latest.get("content"), list) else []
    return {"doc": {**_summary(doc), "content": content}}


def save_doc_payload(user_id: str, doc_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    uid = _uid(user_id)
    doc = _mongo_doc(uid, doc_id)
    title = (str(payload.get("title") or "").strip() or "Untitled")[:200]
    content = payload.get("content") if isinstance(payload.get("content"), list) else []
    body = _body_bytes(title, content)

    client = storage_client()
    client.put_object(Bucket=_bucket(), Key=_latest_key(uid, doc_id), Body=body, ContentType="application/json")

    # Auto-snapshot: persist a version when the last one is old enough (or forced).
    snapshot_written = False
    force = bool(payload.get("snapshot"))
    interval = int(settings()["noter_version_interval_seconds"])
    last_snap = doc.get("lastSnapshotAt") or ""
    due = True
    if last_snap and not force:
        try:
            last_dt = datetime.fromisoformat(last_snap)
            due = (_now() - last_dt).total_seconds() >= interval
        except ValueError:
            due = True
    if force or due:
        client.put_object(
            Bucket=_bucket(), Key=_version_key(uid, doc_id, _version_stamp()), Body=body, ContentType="application/json"
        )
        snapshot_written = True
        _prune_versions(uid, doc_id)

    updates = {"title": title, "preview": _extract_text(content), "updatedAt": _now_iso()}
    if snapshot_written:
        updates["lastSnapshotAt"] = updates["updatedAt"]
    noter_docs_collection().update_one({"_id": doc["_id"]}, {"$set": updates})
    return {"saved": True, "snapshot": snapshot_written, "updatedAt": updates["updatedAt"]}


def delete_doc_payload(user_id: str, doc_id: str) -> Dict[str, Any]:
    uid = _uid(user_id)
    doc = _mongo_doc(uid, doc_id)
    _delete_doc_row(uid, doc)
    return {"deleted": True}


# --- Version history (S3-only) ---


def _list_version_stamps(uid: str, doc_id: str) -> List[Dict[str, Any]]:
    client = storage_client()
    bucket = _bucket()
    prefix = _versions_prefix(uid, doc_id)
    out: List[Dict[str, Any]] = []
    token = None
    while True:
        kwargs = {"Bucket": bucket, "Prefix": prefix, "MaxKeys": 1000}
        if token:
            kwargs["ContinuationToken"] = token
        resp = client.list_objects_v2(**kwargs)
        for item in resp.get("Contents", []):
            name = item["Key"].rsplit("/", 1)[-1]
            stamp = name[:-5] if name.endswith(".json") else ""
            if _VERSION_STAMP_RE.match(stamp):
                out.append({"id": stamp, "savedAt": _stamp_to_iso(stamp), "size": int(item.get("Size", 0))})
        if not resp.get("IsTruncated"):
            break
        token = resp.get("NextContinuationToken")
    out.sort(key=lambda v: v["id"], reverse=True)
    return out


def _prune_versions(uid: str, doc_id: str) -> None:
    keep = int(settings()["noter_version_keep"])
    versions = _list_version_stamps(uid, doc_id)
    excess = versions[keep:]
    if not excess:
        return
    client = storage_client()
    client.delete_objects(
        Bucket=_bucket(),
        Delete={"Objects": [{"Key": _version_key(uid, doc_id, v["id"])} for v in excess], "Quiet": True},
    )


def _valid_stamp(version_id: str) -> str:
    stamp = (version_id or "").strip()
    if not _VERSION_STAMP_RE.match(stamp):
        raise ValueError("Invalid version id")
    return stamp


def list_versions_payload(user_id: str, doc_id: str) -> Dict[str, Any]:
    uid = _uid(user_id)
    _mongo_doc(uid, doc_id)
    return {"versions": _list_version_stamps(uid, doc_id)}


def get_version_payload(user_id: str, doc_id: str, version_id: str) -> Dict[str, Any]:
    uid = _uid(user_id)
    _mongo_doc(uid, doc_id)
    stamp = _valid_stamp(version_id)
    data = _read_json_object(_version_key(uid, doc_id, stamp))
    if data is None:
        raise LookupError("Version not found")
    return {
        "version": {
            "id": stamp,
            "savedAt": data.get("savedAt") or _stamp_to_iso(stamp),
            "title": data.get("title") or "Untitled",
            "content": data.get("content") if isinstance(data.get("content"), list) else [],
        }
    }


def snapshot_doc_payload(user_id: str, doc_id: str) -> Dict[str, Any]:
    """Manual 'save version now' — snapshots the current latest state."""
    uid = _uid(user_id)
    doc = _mongo_doc(uid, doc_id)
    latest = _read_json_object(_latest_key(uid, doc_id))
    if latest is None:
        raise LookupError("Document has no saved content yet")
    stamp = _version_stamp()
    storage_client().put_object(
        Bucket=_bucket(),
        Key=_version_key(uid, doc_id, stamp),
        Body=json.dumps(latest, ensure_ascii=False).encode("utf-8"),
        ContentType="application/json",
    )
    _prune_versions(uid, doc_id)
    now = _now_iso()
    noter_docs_collection().update_one({"_id": doc["_id"]}, {"$set": {"lastSnapshotAt": now}})
    return {"version": {"id": stamp, "savedAt": _stamp_to_iso(stamp)}}


def restore_version_payload(user_id: str, doc_id: str, version_id: str) -> Dict[str, Any]:
    uid = _uid(user_id)
    doc = _mongo_doc(uid, doc_id)
    stamp = _valid_stamp(version_id)
    version = _read_json_object(_version_key(uid, doc_id, stamp))
    if version is None:
        raise LookupError("Version not found")

    client = storage_client()
    # Snapshot the current state first so a restore is itself always undoable.
    current = _read_json_object(_latest_key(uid, doc_id))
    if current is not None:
        client.put_object(
            Bucket=_bucket(),
            Key=_version_key(uid, doc_id, _version_stamp()),
            Body=json.dumps(current, ensure_ascii=False).encode("utf-8"),
            ContentType="application/json",
        )

    title = (str(version.get("title") or "").strip() or "Untitled")[:200]
    content = version.get("content") if isinstance(version.get("content"), list) else []
    client.put_object(
        Bucket=_bucket(), Key=_latest_key(uid, doc_id), Body=_body_bytes(title, content), ContentType="application/json"
    )
    now = _now_iso()
    noter_docs_collection().update_one(
        {"_id": doc["_id"]},
        {"$set": {"title": title, "preview": _extract_text(content), "updatedAt": now, "lastSnapshotAt": now}},
    )
    _prune_versions(uid, doc_id)
    return {"doc": {"id": doc_id, "title": title, "content": content, "updatedAt": now}}


# --- Assets (images/files embedded in docs) ---


def presign_asset_upload_payload(user_id: str, doc_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    uid = _uid(user_id)
    _mongo_doc(uid, doc_id)
    filename = str(payload.get("filename") or "file").strip() or "file"
    safe = re.sub(r"[^A-Za-z0-9._-]+", "_", filename)[-80:]
    key = f"{_doc_prefix(uid, doc_id)}/assets/{uuid.uuid4().hex}_{safe}"
    # Do not bind ContentType in the presigned signature for browser uploads.
    url = storage_client().generate_presigned_url(
        "put_object", Params={"Bucket": _bucket(), "Key": key}, ExpiresIn=900
    )
    return {"uploadUrl": url, "key": key}


def resolve_asset_url_payload(user_id: str, key: str) -> Dict[str, Any]:
    uid = _uid(user_id)
    key = (key or "").strip()
    prefix = f"{settings()['noter_prefix']}/{uid}/"
    if not key.startswith(prefix) or ".." in key:
        raise ValueError("Invalid asset key")
    url = storage_client().generate_presigned_url(
        "get_object", Params={"Bucket": _bucket(), "Key": key}, ExpiresIn=6 * 3600
    )
    return {"url": url, "expiresIn": 6 * 3600}
