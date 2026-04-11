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
    notes: str


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
