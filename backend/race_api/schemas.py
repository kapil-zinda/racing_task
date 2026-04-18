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
    session_type: str  # study | revision | analysis
    recorder_type: str = "call"
    modes: List[str] = []  # audio | video | screen
    notes: str
    test_source: str = ""
    test_name: str = ""
    test_number: str = ""


class SessionStatusRequest(BaseModel):
    status: str  # started | paused | resumed | stopped
    elapsed_seconds: int = 0


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
    scope: str = "all"  # all | searchable


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
    scope: str = "all"  # all | searchable


class ContentMoveRequest(BaseModel):
    id: str
    item_type: str  # file | folder
    destination_folder_id: str = "content_root"
    scope: str = "all"  # all | searchable


class ContentDownloadRequest(BaseModel):
    id: str
    item_type: str  # file | folder
    recursive: bool = True


class ContentMakeSearchableRequest(BaseModel):
    id: str
    item_type: str  # file | folder
    course: str


class ExtraRowInput(BaseModel):
    id: str = ""
    title: str = ""
    link: str = ""
    kind: str = ""
    duration: str = ""


class ExtrasUpsertRequest(BaseModel):
    user_id: str
    date: str = ""
    rows: List[ExtraRowInput] = []


class QnaAskRequest(BaseModel):
    session_id: str
    question: str
    course: str = ""
    limit: int = 8


class QnaSessionCreateRequest(BaseModel):
    user_id: str
    title: str = ""


class MissionUpsertRequest(BaseModel):
    user_id: str
    title: str = ""
    target_date: str = ""
    status: str = "active"
    weights: dict = {}
    targets: dict | None = None
    plan: dict = {}


class AgentV2CreateRequest(BaseModel):
    user_id: str
    mode: str = "supportive"
    page_context: str = ""
    current_session_id: str = ""


class AgentV2RealtimeTokenRequest(BaseModel):
    user_id: str
    page_context: str = ""
    voice: str = ""


class AgentV2ChatRequest(BaseModel):
    session_id: str
    user_id: str
    message: str = ""
    input_audio_base64: str = ""
    input_audio_mime_type: str = "audio/webm"
    mode: str = ""
    page_context: str = ""
    allow_ui_actions: bool = True
    response_audio: bool = True
    response_audio_format: str = "mp3"
    response_voice: str = "alloy"


class AgentV2MemoryUpsertRequest(BaseModel):
    user_id: str
    key: str
    value: dict
    importance: int = 1
    source: str = "manual"


class AgentV2EntryRequest(BaseModel):
    user_id: str
    entry_type: str
    exam: str = ""
    course: str = ""
    book_name: str = ""
    source: str = ""
    subject: str = ""
    topic: str = ""
    test_name: str = ""
    test_number: str = ""
    stage: str = ""
    org: str = ""
    note: str = ""
    work_type: str = "study"
    confirm: bool = False
