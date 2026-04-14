from typing import List

from pydantic import BaseModel


class AddPointsRequest(BaseModel):
    player_id: str
    action_type: str
    test_type: str = ""
    detail: str = ""


class CreateSessionRequest(BaseModel):
    user_id: str
    subject: str
    topic: str
    session_type: str  # study | revision
    recorder_type: str = "call"
    modes: List[str] = []  # audio | video | screen
    notes: str = ""


class SessionStatusRequest(BaseModel):
    status: str  # started | paused | resumed | stopped
    elapsed_seconds: int = 0
    force_stop_previous: bool = False


class PresignRequest(BaseModel):
    media_type: str  # audio | video | screen | attachment
    content_type: str = "application/octet-stream"
    extension: str = "webm"


class MultipartStartRequest(BaseModel):
    media_type: str  # audio | video | screen | attachment
    content_type: str = "application/octet-stream"
    extension: str = "webm"


class MultipartPartRequest(BaseModel):
    media_type: str  # audio | video | screen | attachment
    upload_id: str
    part_number: int


class UploadedPart(BaseModel):
    part_number: int
    etag: str


class MultipartCompleteRequest(BaseModel):
    media_type: str  # audio | video | screen | attachment
    upload_id: str
    parts: List[UploadedPart]


class MultipartAbortRequest(BaseModel):
    media_type: str  # audio | video | screen | attachment
    upload_id: str


class PdfPresignUploadRequest(BaseModel):
    file_name: str
    content_type: str = "application/pdf"
    course: str


class PdfIndexRequest(BaseModel):
    doc_id: str


class PdfSearchRequest(BaseModel):
    query: str
    limit: int = 20
    course: str = ""


class ContentCreateFolderRequest(BaseModel):
    parent_id: str = "content_root"
    name: str


class ContentPresignUploadRequest(BaseModel):
    folder_id: str = "content_root"
    file_name: str
    content_type: str = "application/octet-stream"
    size: int = 0


class ContentDeleteRequest(BaseModel):
    id: str
    item_type: str  # file | folder
    recursive: bool = False


class ContentRenameRequest(BaseModel):
    id: str
    item_type: str  # file | folder
    new_name: str


class ContentCompleteUploadRequest(BaseModel):
    file_id: str
    etag: str = ""
    size: int = 0


class ContentCopyRequest(BaseModel):
    id: str
    item_type: str  # file | folder
    destination_folder_id: str = "content_root"


class ContentMoveRequest(BaseModel):
    id: str
    item_type: str  # file | folder
    destination_folder_id: str = "content_root"


class ContentDownloadRequest(BaseModel):
    id: str
    item_type: str  # file | folder
    recursive: bool = True


class ExtraRowInput(BaseModel):
    id: str = ""
    title: str = ""
    link: str = ""
    kind: str = ""
    duration: str = ""


class ExtrasUpsertRequest(BaseModel):
    user_id: str
    rows: List[ExtraRowInput] = []
