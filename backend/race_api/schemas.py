from __future__ import annotations

from typing import List, Optional

from pydantic import BaseModel


class AddPointsRequest(BaseModel):
    player_id: str
    action_type: str
    test_type: str = ""
    detail: str = ""


class DeletePointsEventRequest(BaseModel):
    event_id: str


class CreateSessionRequest(BaseModel):
    user_id: str = ""
    subject: str
    topic: str
    goal_id: str = "global"
    session_type: str  # study | revision | analysis
    recorder_type: str = "call"
    modes: List[str] = []  # audio | video | screen
    notes: str
    simple_record: bool = False
    test_source: str = ""
    test_name: str = ""
    test_number: str = ""


class SessionStatusRequest(BaseModel):
    status: str  # started | paused | resumed | stopped
    elapsed_seconds: int = 0
    force_stop_previous: bool = False


class SessionNotesRequest(BaseModel):
    notes: str = ""


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


class InterviewStartRequest(BaseModel):
    daf: Optional[dict] = None


class DafSaveRequest(BaseModel):
    daf: dict


class AnswerEvalPresignRequest(BaseModel):
    filename: str = "answer.pdf"
    content_type: str = "application/pdf"
    question: str = ""
    subject: str = ""
    max_marks: int = 0
    has_diagrams: bool = True
    language: str = "English"


class AnswerEvalEvaluateRequest(BaseModel):
    question: str = ""
    max_marks: int = 0


class ContactRequest(BaseModel):
    name: str = ""
    email: str
    message: str
    subject: str = ""


class InterviewAnswerRequest(BaseModel):
    text: str = ""
    audio_base64: str = ""
    audio_mime_type: str = "audio/webm"
    latency_ms: int = 0


class ChunkPresignRequest(BaseModel):
    media_type: str  # audio | video | screen | attachment
    seq: int  # 0-based ordering of the chunk within the recording
    content_type: str = "application/octet-stream"


class ChunkConcatRequest(BaseModel):
    media_type: str  # audio | video | screen | attachment
    content_type: str = "application/octet-stream"
    extension: str = "webm"


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
    user_id: str = ""
    date: str = ""
    rows: List[ExtraRowInput] = []


class QnaAskRequest(BaseModel):
    session_id: str
    question: str
    course: str = ""
    limit: int = 8


class QnaSessionCreateRequest(BaseModel):
    user_id: str = ""
    title: str = ""


# --- Universal Goal OS ---

class GoalCreateRequest(BaseModel):
    name: str
    description: str = ""
    icon: str = ""
    cover_image: str = ""
    color: str = ""
    category: str = ""
    priority: str = ""
    start_date: str = ""
    end_date: str = ""
    visibility: str = ""
    estimated_hours: float = 0
    settings: dict = {}


class GoalUpdateRequest(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    icon: Optional[str] = None
    cover_image: Optional[str] = None
    color: Optional[str] = None
    status: Optional[str] = None
    category: Optional[str] = None
    priority: Optional[str] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    visibility: Optional[str] = None
    estimated_hours: Optional[float] = None
    actual_hours: Optional[float] = None
    settings: Optional[dict] = None


class GoalNodeCreateRequest(BaseModel):
    goal_id: str
    parent_id: Optional[str] = None
    title: str
    description: str = ""
    type: str = ""
    status: str = "todo"
    weight: float = 1
    estimated_value: Optional[float] = None
    actual_value: Optional[float] = None
    unit: str = ""
    progress_mode: str = "children_weighted"
    formula: str = ""
    order: Optional[float] = None
    metadata: dict = {}


class GoalNodeUpdateRequest(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    type: Optional[str] = None
    status: Optional[str] = None
    weight: Optional[float] = None
    estimated_value: Optional[float] = None
    actual_value: Optional[float] = None
    unit: Optional[str] = None
    progress_mode: Optional[str] = None
    progress: Optional[float] = None
    formula: Optional[str] = None
    order: Optional[float] = None
    metadata: Optional[dict] = None


class GoalNodeMoveRequest(BaseModel):
    new_parent_id: Optional[str] = None
    order: Optional[float] = None


class GoalMetricTemplateItem(BaseModel):
    name: str
    target_value: float = 1
    unit: str = ""
    type: str = "number"


class GoalNodeBulkCreateRequest(BaseModel):
    goal_id: str
    parent_id: Optional[str] = None
    # Either an explicit list of titles, or a pattern + count.
    titles: Optional[List[str]] = None
    name_pattern: Optional[str] = None
    count: Optional[int] = None
    start: int = 1
    type: str = ""
    weight: float = 1
    progress_mode: Optional[str] = None
    metrics: List[GoalMetricTemplateItem] = []


class GoalMetricCreateRequest(BaseModel):
    node_id: str
    name: str
    type: str = "number"
    unit: str = ""
    target_value: float = 0
    current_value: float = 0
    min_value: Optional[float] = None
    max_value: Optional[float] = None


class GoalMetricUpdateRequest(BaseModel):
    name: Optional[str] = None
    type: Optional[str] = None
    unit: Optional[str] = None
    target_value: Optional[float] = None
    current_value: Optional[float] = None
    min_value: Optional[float] = None
    max_value: Optional[float] = None


class GoalMetricIncrementRequest(BaseModel):
    delta: float = 1


# --- Goal OS: AI, templates, dependencies, scheduling, attachments ---

class GoalAIGenerateRequest(BaseModel):
    prompt: str


class GoalIdRequest(BaseModel):
    goal_id: str


class GoalDailyPlanRequest(BaseModel):
    goal_id: str
    limit: int = 5


class GoalTemplateCreateRequest(BaseModel):
    goal_id: str
    name: str = ""


class GoalTemplateUseRequest(BaseModel):
    template_id: str
    name: str = ""


class GoalDependencyCreateRequest(BaseModel):
    goal_id: str
    source_node_id: str
    target_node_id: str
    dependency_type: str = "blocks"


class GoalReminderCreateRequest(BaseModel):
    goal_id: str
    node_id: Optional[str] = None
    time: str
    type: str = "reminder"


class GoalRecurringCreateRequest(BaseModel):
    goal_id: str
    node_id: Optional[str] = None
    frequency: str
    cron: str = ""
    start_date: str = ""
    end_date: str = ""


class GoalAttachmentPresignRequest(BaseModel):
    node_id: str
    name: str
    content_type: str = ""


class GoalAttachmentCreateRequest(BaseModel):
    node_id: str
    type: str = "file"
    name: str = ""
    url: str = ""
    key: str = ""
    size: int = 0


class AgentV2CreateRequest(BaseModel):
    user_id: str = ""
    mode: str = "supportive"
    page_context: str = ""
    current_session_id: str = ""


class AgentV2RealtimeTokenRequest(BaseModel):
    user_id: str = ""
    page_context: str = ""
    voice: str = ""


class AgentV2ChatRequest(BaseModel):
    session_id: str
    user_id: str = ""
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
    user_id: str = ""
    key: str
    value: dict
    importance: int = 1
    source: str = "manual"


class AgentV2EntryRequest(BaseModel):
    user_id: str = ""
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


class ActivityUpsertRequest(BaseModel):
    title: str = ""
    date: str = ""
    start_time: str = ""
    end_time: str = ""
    category: str = "Study"
    note: str = ""


class ActivityCategoryRequest(BaseModel):
    name: str
    color: str = "#6366f1"


class ExtraCategoryRequest(BaseModel):
    name: str
    color: str = "#94a3b8"


class LiveSessionStartRequest(BaseModel):
    category: str = "Study"
    title: str = ""
    local_date: str = ""  # client-computed local YYYY-MM-DD; falls back to server tz if blank


class LiveSessionHeartbeatRequest(BaseModel):
    elapsed_seconds: int = 0
    foreground: bool = True


class LiveSessionSyncRequest(BaseModel):
    elapsed_seconds: int = 0
    reason: str = "manual"  # manual | backgrounded | foregrounded


class GroupCreateRequest(BaseModel):
    name: str
    description: str = ""
    category_focus: str = ""
    is_public: bool = True


class GroupJoinRequest(BaseModel):
    join_code: str = ""


class GroupJoinByCodeRequest(BaseModel):
    join_code: str


class MindmapUpsertRequest(BaseModel):
    title: str = ""
    markdown: str = ""
    outlineItems: Optional[List[dict]] = None
    tree: Optional[dict] = None


# --- Noter (Notion-style docs) ---

class NoterCreateRequest(BaseModel):
    title: str = ""
    content: Optional[List[dict]] = None
    parent_id: str = ""


class NoterSaveRequest(BaseModel):
    title: str = ""
    content: Optional[List[dict]] = None
    snapshot: bool = False  # force a version snapshot with this save


class NoterRestoreRequest(BaseModel):
    version_id: str


class NoterAssetPresignRequest(BaseModel):
    filename: str = "file"
    content_type: str = ""


class NoterAssetResolveRequest(BaseModel):
    key: str


# --- Noter directory (folders) ---

class NoterFolderCreateRequest(BaseModel):
    parent_id: str = ""
    name: str


class NoterItemRenameRequest(BaseModel):
    id: str
    item_type: str  # "doc" | "folder"
    name: str


class NoterItemMoveRequest(BaseModel):
    id: str
    item_type: str
    destination_folder_id: str = ""


class NoterItemCopyRequest(BaseModel):
    id: str
    item_type: str
    destination_folder_id: str = ""


class NoterItemDuplicateRequest(BaseModel):
    id: str
    item_type: str


class NoterItemDeleteRequest(BaseModel):
    id: str
    item_type: str
    recursive: bool = False


# --- Razorpay payments ---

class CreateOrderRequest(BaseModel):
    amount: int  # in paise; minimum 100
    currency: str = "INR"
    receipt: str = ""
    notes: dict = {}


class VerifyPaymentRequest(BaseModel):
    razorpay_order_id: str
    razorpay_payment_id: str
    razorpay_signature: str


# --- Pricing plans ---

class SubscribeRequest(BaseModel):
    plan: str  # "pro" | "max"
    interval: str  # "monthly" | "annual"


# --- Account settings ---

class UpdateProfileRequest(BaseModel):
    name: str  # email/phone are not editable — intentionally not accepted here


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


class DeleteAccountRequest(BaseModel):
    password: str
