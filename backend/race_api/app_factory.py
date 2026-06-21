from __future__ import annotations

from typing import Optional

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware
from mangum import Mangum

from .constants import PLAYERS, POINTS_MAP
from . import auth_service as _auth_service
from .auth_router import router as auth_router
from .context import settings as _settings
from .content_domain import (
    copy_item,
    complete_upload,
    create_folder,
    create_upload_url,
    delete_item,
    download_item,
    list_content,
    list_folder_tree,
    make_item_searchable,
    move_item,
    preview_by_id,
    rename_item,
)
from .extras_domain import get_extras_payload, save_extras_payload
from .activity_tracker_domain import (
    create_activity,
    create_category,
    delete_activity,
    delete_category,
    get_activities,
    get_categories,
    update_activity,
)
from .context import current_date_str, logger
from .race_domain import (
    add_points_payload,
    build_mission_control_payload,
    build_syllabus_payload,
    delete_points_event_payload,
    get_days_payload,
    get_state_payload,
    reset_race_payload,
)
from .agent_v2_domain import (
    agent_context_payload,
    recommendations_next_actions_payload,
    rebuild_daily_aggregates_payload,
    refresh_daily_aggregate,
    refresh_daily_aggregates_for_date,
    report_period_payload,
    report_revision_gaps_payload,
    search_suggest_payload,
    search_unified_payload,
    state_range_payload,
)
from .agent_v2_chat_domain import (
    create_agent_v2_session_payload,
    create_agent_v2_realtime_token_payload,
    get_agent_v2_session_payload,
    run_agent_v2_chat_payload,
    upsert_agent_v2_memory_payload,
    agent_v2_suggestions_payload,
    prepare_entry_payload,
    log_entry_payload,
)
from .pdf_search_domain import (
    create_pdf_presigned_upload,
    index_pdf_document,
    search_pdf,
)
from .qna_domain import ask_qna_in_session, create_qna_session, get_qna_messages, list_qna_sessions
from .journey_domain import create_journey, delete_journey, list_journeys, update_journey
from .journey_progress_domain import get_journey_progress, record_progress_action
from .mission_domain import get_or_create_mission, mission_progress_payload, mission_selector_options, upsert_mission
from .schemas import (
    ActivityCategoryRequest,
    ActivityUpsertRequest,
    AddPointsRequest,
    DeletePointsEventRequest,
    ContentCreateFolderRequest,
    ContentDeleteRequest,
    ContentCompleteUploadRequest,
    ContentCopyRequest,
    ContentDownloadRequest,
    ContentMakeSearchableRequest,
    ContentPresignUploadRequest,
    ContentRenameRequest,
    ContentMoveRequest,
    ChunkConcatRequest,
    ChunkPresignRequest,
    CreateSessionRequest,
    SessionNotesRequest,
    ExtrasUpsertRequest,
    MultipartAbortRequest,
    MultipartCompleteRequest,
    MultipartPartRequest,
    MultipartStartRequest,
    PdfIndexRequest,
    PdfPresignUploadRequest,
    PresignRequest,
    QnaAskRequest,
    QnaSessionCreateRequest,
    MissionUpsertRequest,
    JourneyCreateRequest,
    JourneyUpdateRequest,
    JourneyProgressActionRequest,
    AgentV2ChatRequest,
    AgentV2CreateRequest,
    AgentV2EntryRequest,
    AgentV2MemoryUpsertRequest,
    AgentV2RealtimeTokenRequest,
    SessionStatusRequest,
)
from .session_domain import (
    abort_multipart_upload_payload,
    complete_multipart_upload_payload,
    concat_chunks_payload,
    create_presigned_playback_url_payload,
    create_presigned_upload_payload,
    create_session_payload,
    delete_session_payload,
    get_session_payload,
    list_sessions_payload,
    presign_chunk_upload_payload,
    presign_multipart_part_payload,
    record_session_heartbeat_payload,
    start_multipart_upload_payload,
    update_session_notes_payload,
    update_session_status_payload,
)


_PUBLIC_PATHS = {"/", "/health", "/docs", "/openapi.json", "/redoc"}


class APIKeyMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        cfg = _settings()
        auth_required = cfg.get("auth_required", False)
        path = request.url.path
        is_public = path in _PUBLIC_PATHS or path.startswith("/auth/")
        api_key = request.headers.get("X-API-Key", "")
        if api_key:
            user = _auth_service.get_user_by_api_key(api_key)
            if user:
                request.state.user = user
            elif auth_required and not is_public:
                return JSONResponse({"detail": "Invalid API key"}, status_code=401)
        elif auth_required and not is_public:
            return JSONResponse({"detail": "Missing X-API-Key header"}, status_code=401)
        return await call_next(request)


def _req_user_id(request: Request) -> str:
    user = getattr(request.state, "user", None)
    if isinstance(user, dict):
        return user.get("user_id") or ""
    return ""


def _require_auth(request: Request) -> str:
    uid = _req_user_id(request)
    if not uid:
        raise HTTPException(status_code=401, detail="Authentication required")
    return uid


def _raise_as_http(err: Exception, endpoint_name: str) -> None:
    if isinstance(err, HTTPException):
        raise err
    if isinstance(err, ValueError):
        raise HTTPException(status_code=400, detail=str(err))
    if isinstance(err, LookupError):
        raise HTTPException(status_code=404, detail=str(err))
    if isinstance(err, FileNotFoundError):
        raise HTTPException(status_code=404, detail=str(err))

    logger.exception("%s failed", endpoint_name)
    raise HTTPException(status_code=500, detail=f"Internal server error: {err}")


def create_app() -> FastAPI:
    app = FastAPI(title="Kapil vs Divya Race API", version="2.0.0")
    app.add_middleware(APIKeyMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(auth_router)

    @app.on_event("startup")
    def _startup():
        _auth_service.init_auth_service()

    @app.get("/user/me")
    def user_me(request: Request):
        user = getattr(request.state, "user", None)
        if not user:
            raise HTTPException(status_code=401, detail="Not authenticated")
        return user

    @app.get("/state")
    def get_state(date: Optional[str] = Query(default=None)):
        try:
            return get_state_payload(date)
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "GET /state")

    @app.get("/days")
    def get_days():
        try:
            return get_days_payload()
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "GET /days")

    @app.get("/syllabus")
    def get_syllabus(request: Request):
        try:
            return build_syllabus_payload(_req_user_id(request))
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "GET /syllabus")

    @app.get("/content/list")
    def content_list(
        request: Request,
        folder_id: Optional[str] = Query(default=None),
        q: Optional[str] = Query(default=None),
        sort_by: Optional[str] = Query(default="name"),
        sort_dir: Optional[str] = Query(default="asc"),
        view_mode: Optional[str] = Query(default="all"),
    ):
        try:
            return list_content(folder_id, q, sort_by, sort_dir, view_mode, user_id=_require_auth(request))
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "GET /content/list")

    @app.get("/content/tree")
    def content_tree(
        request: Request,
        parent_id: Optional[str] = Query(default=None),
        view_mode: Optional[str] = Query(default="all"),
    ):
        try:
            return list_folder_tree(parent_id, view_mode, user_id=_require_auth(request))
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "GET /content/tree")

    @app.post("/content/folder")
    def content_create_folder(request: Request, payload: ContentCreateFolderRequest):
        try:
            return create_folder(payload.parent_id, payload.name, user_id=_require_auth(request))
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "POST /content/folder")

    @app.post("/content/rename")
    def content_rename(request: Request, payload: ContentRenameRequest):
        try:
            return rename_item(payload.id, payload.item_type, payload.new_name, user_id=_require_auth(request))
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "POST /content/rename")

    @app.post("/content/presign-upload")
    def content_presign_upload(request: Request, payload: ContentPresignUploadRequest):
        try:
            return create_upload_url(payload.folder_id, payload.file_name, payload.content_type, payload.size, user_id=_require_auth(request))
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "POST /content/presign-upload")

    @app.post("/content/complete-upload")
    def content_complete_upload(payload: ContentCompleteUploadRequest):
        try:
            return complete_upload(payload.file_id, payload.etag, payload.size)
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "POST /content/complete-upload")

    @app.post("/content/delete")
    def content_delete(request: Request, payload: ContentDeleteRequest):
        try:
            return delete_item(payload.id, payload.item_type, payload.recursive, payload.scope, user_id=_require_auth(request))
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "POST /content/delete")

    @app.post("/content/copy")
    def content_copy(request: Request, payload: ContentCopyRequest):
        try:
            return copy_item(payload.id, payload.item_type, payload.destination_folder_id, payload.scope, user_id=_require_auth(request))
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "POST /content/copy")

    @app.post("/content/move")
    def content_move(request: Request, payload: ContentMoveRequest):
        try:
            return move_item(payload.id, payload.item_type, payload.destination_folder_id, payload.scope, user_id=_require_auth(request))
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "POST /content/move")

    @app.post("/content/download")
    def content_download(request: Request, payload: ContentDownloadRequest):
        try:
            return download_item(payload.id, payload.item_type, payload.recursive, user_id=_require_auth(request))
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "POST /content/download")

    @app.get("/content/preview-url")
    def content_preview(request: Request, file_id: str = Query(...)):
        try:
            return preview_by_id(file_id, user_id=_require_auth(request))
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "GET /content/preview-url")

    @app.post("/content/make-searchable")
    def content_make_searchable(request: Request, payload: ContentMakeSearchableRequest):
        try:
            return make_item_searchable(payload.id, payload.item_type, payload.course, user_id=_require_auth(request))
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "POST /content/make-searchable")

    @app.post("/pdf-search/presign-upload")
    def pdf_presign_upload(request: Request, payload: PdfPresignUploadRequest):
        try:
            return create_pdf_presigned_upload(payload, user_id=_require_auth(request))
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "POST /pdf-search/presign-upload")

    @app.post("/pdf-search/index")
    def pdf_index(payload: PdfIndexRequest):
        try:
            return index_pdf_document(payload)
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "POST /pdf-search/index")

    @app.get("/pdf-search/query")
    def pdf_query(
        request: Request,
        q: str = Query(...),
        limit: int = Query(default=20, ge=1, le=100),
        course: Optional[str] = Query(default=None),
    ):
        try:
            return search_pdf(q, limit, course, user_id=_require_auth(request))
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "GET /pdf-search/query")

    @app.get("/qna/sessions")
    def qna_list_sessions(request: Request):
        try:
            return list_qna_sessions(_require_auth(request))
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "GET /qna/sessions")

    @app.post("/qna/sessions")
    def qna_create_session(request: Request, payload: QnaSessionCreateRequest):
        try:
            return create_qna_session(_require_auth(request), payload.title)
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "POST /qna/sessions")

    @app.get("/qna/sessions/{session_id}/messages")
    def qna_get_messages(request: Request, session_id: str):
        try:
            _require_auth(request)
            return get_qna_messages(session_id)
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "GET /qna/sessions/{id}/messages")

    @app.post("/qna/ask")
    def qna_ask(request: Request, payload: QnaAskRequest):
        try:
            _require_auth(request)
            return ask_qna_in_session(payload.session_id, payload.question, payload.course, payload.limit)
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "POST /qna/ask")

    @app.get("/mission-control")
    def get_mission_control(
        request: Request,
        lookback_days: int = Query(default=90, ge=14, le=365),
    ):
        try:
            user_id = _req_user_id(request)
            payload = build_mission_control_payload(user_id, lookback_days)
            payload["mission"] = get_or_create_mission(user_id)
            payload["mission_progress"] = mission_progress_payload(user_id, lookback_days)
            return payload
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "GET /mission-control")

    @app.get("/mission")
    def get_mission(request: Request, lookback_days: int = Query(default=90, ge=14, le=365)):
        try:
            user_id = _req_user_id(request)
            return {
                "mission": get_or_create_mission(user_id),
                "mission_progress": mission_progress_payload(user_id, lookback_days),
                "selector_options": mission_selector_options(user_id),
            }
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "GET /mission")

    @app.put("/mission")
    def save_mission(request: Request, payload: MissionUpsertRequest):
        try:
            user_id = _req_user_id(request) or payload.user_id
            mission = upsert_mission(
                user_id,
                title=payload.title,
                target_date=payload.target_date,
                status=payload.status,
                icon=payload.icon,
                category=payload.category,
                weights=payload.weights,
                targets=payload.targets,
                plan=payload.plan,
            )
            return {
                "message": "Mission saved",
                "mission": mission,
                "mission_progress": mission_progress_payload(user_id, 90),
                "selector_options": mission_selector_options(user_id),
            }
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "PUT /mission")

    @app.get("/journeys")
    def list_user_journeys(request: Request):
        try:
            return {"journeys": list_journeys(_req_user_id(request))}
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "GET /journeys")

    @app.post("/journeys")
    def create_user_journey(request: Request, payload: JourneyCreateRequest):
        try:
            return create_journey(_req_user_id(request), payload.model_dump())
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "POST /journeys")

    @app.put("/journeys/{journey_id}")
    def update_user_journey(journey_id: str, request: Request, payload: JourneyUpdateRequest):
        try:
            return update_journey(_req_user_id(request), journey_id, payload.model_dump(exclude_none=True))
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "PUT /journeys/{journey_id}")

    @app.delete("/journeys/{journey_id}")
    def delete_user_journey(journey_id: str, request: Request):
        try:
            return delete_journey(_req_user_id(request), journey_id)
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "DELETE /journeys/{journey_id}")

    @app.get("/journeys/{journey_id}/progress")
    def get_user_journey_progress(journey_id: str, request: Request):
        try:
            return get_journey_progress(_req_user_id(request), journey_id)
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "GET /journeys/{journey_id}/progress")

    @app.post("/journeys/{journey_id}/progress")
    def record_user_journey_progress(journey_id: str, request: Request, payload: JourneyProgressActionRequest):
        try:
            return record_progress_action(_req_user_id(request), journey_id, payload.model_dump())
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "POST /journeys/{journey_id}/progress")

    @app.get("/mission/options")
    def get_mission_options(request: Request):
        try:
            return mission_selector_options(_req_user_id(request))
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "GET /mission/options")

    @app.get("/agent-v2/context")
    def agent_v2_context(
        request: Request,
        date: Optional[str] = Query(default=None),
        lookback_days: int = Query(default=14, ge=1, le=365),
        x_days: int = Query(default=7, ge=1, le=60),
        y_days: int = Query(default=15, ge=1, le=90),
    ):
        try:
            return agent_context_payload(_req_user_id(request), date, lookback_days, x_days, y_days)
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "GET /agent-v2/context")

    @app.get("/agent-v2/reports/period")
    def agent_v2_report_period(
        request: Request,
        from_date: str = Query(..., alias="from"),
        to_date: str = Query(..., alias="to"),
        group_by: str = Query(default="day"),
        x_days: int = Query(default=7, ge=1, le=60),
        y_days: int = Query(default=15, ge=1, le=90),
    ):
        try:
            return report_period_payload(_req_user_id(request), from_date, to_date, group_by, x_days, y_days)
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "GET /agent-v2/reports/period")

    @app.get("/agent-v2/reports/revision-gaps")
    def agent_v2_revision_gaps(
        request: Request,
        x_days: int = Query(default=7, ge=1, le=60),
        y_days: int = Query(default=15, ge=1, le=90),
        limit: int = Query(default=200, ge=1, le=1000),
        reference_date: Optional[str] = Query(default=None),
    ):
        try:
            return report_revision_gaps_payload(_req_user_id(request), x_days, y_days, limit, reference_date)
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "GET /agent-v2/reports/revision-gaps")

    @app.get("/agent-v2/recommendations/next-actions")
    def agent_v2_next_actions(
        request: Request,
        duration_min: int = Query(default=60, ge=15, le=720),
        mode: str = Query(default="supportive"),
        limit: int = Query(default=5, ge=1, le=20),
        x_days: int = Query(default=7, ge=1, le=60),
        y_days: int = Query(default=15, ge=1, le=90),
    ):
        try:
            return recommendations_next_actions_payload(_req_user_id(request), duration_min, mode, limit, x_days, y_days)
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "GET /agent-v2/recommendations/next-actions")

    @app.get("/agent-v2/search/unified")
    def agent_v2_search_unified(
        request: Request,
        q: str = Query(...),
        course: Optional[str] = Query(default=None),
        types: Optional[str] = Query(default=None),
        limit: int = Query(default=20, ge=1, le=100),
    ):
        try:
            return search_unified_payload(q, _req_user_id(request), course, types, limit)
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "GET /agent-v2/search/unified")

    @app.get("/agent-v2/search/suggest")
    def agent_v2_search_suggest(
        request: Request,
        q: Optional[str] = Query(default=None),
        limit: int = Query(default=12, ge=1, le=50),
    ):
        try:
            return search_suggest_payload(_req_user_id(request), q, limit)
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "GET /agent-v2/search/suggest")

    @app.get("/agent-v2/state/range")
    def agent_v2_state_range(
        request: Request,
        from_date: str = Query(..., alias="from"),
        to_date: str = Query(..., alias="to"),
        include_history: bool = Query(default=False),
    ):
        try:
            return state_range_payload(from_date, to_date, _req_user_id(request) or None, include_history)
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "GET /agent-v2/state/range")

    @app.post("/agent-v2/aggregates/rebuild")
    def agent_v2_rebuild_aggregates(
        request: Request,
        from_date: Optional[str] = Query(default=None, alias="from"),
        to_date: Optional[str] = Query(default=None, alias="to"),
    ):
        try:
            return rebuild_daily_aggregates_payload(from_date, to_date, _req_user_id(request) or None)
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "POST /agent-v2/aggregates/rebuild")

    @app.post("/agent-v2/aggregates/refresh")
    def agent_v2_refresh_aggregates(date: Optional[str] = Query(default=None)):
        try:
            return refresh_daily_aggregates_for_date(date or current_date_str())
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "POST /agent-v2/aggregates/refresh")

    @app.post("/agent-v2/create-agent")
    def agent_v2_create(request: Request, payload: AgentV2CreateRequest):
        try:
            return create_agent_v2_session_payload(
                _req_user_id(request) or payload.user_id,
                mode=payload.mode,
                page_context=payload.page_context,
                current_session_id=payload.current_session_id,
            )
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "POST /agent-v2/create-agent")

    @app.post("/agent-v2/realtime/token")
    def agent_v2_realtime_token(request: Request, payload: AgentV2RealtimeTokenRequest):
        try:
            return create_agent_v2_realtime_token_payload(
                _req_user_id(request) or payload.user_id,
                page_context=payload.page_context,
                voice=payload.voice,
            )
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "POST /agent-v2/realtime/token")

    @app.post("/agent-v2/chat")
    def agent_v2_chat(request: Request, payload: AgentV2ChatRequest):
        try:
            return run_agent_v2_chat_payload(
                payload.session_id,
                _req_user_id(request) or payload.user_id,
                payload.message,
                input_audio_base64=payload.input_audio_base64,
                input_audio_mime_type=payload.input_audio_mime_type,
                mode=payload.mode,
                page_context=payload.page_context,
                allow_ui_actions=payload.allow_ui_actions,
                response_audio=payload.response_audio,
                response_audio_format=payload.response_audio_format,
                response_voice=payload.response_voice,
            )
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "POST /agent-v2/chat")

    @app.get("/agent-v2/session/{session_id}")
    def agent_v2_session(session_id: str):
        try:
            return get_agent_v2_session_payload(session_id)
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "GET /agent-v2/session/{id}")

    @app.post("/agent-v2/memory")
    def agent_v2_memory(request: Request, payload: AgentV2MemoryUpsertRequest):
        try:
            return upsert_agent_v2_memory_payload(
                _req_user_id(request) or payload.user_id,
                payload.key,
                payload.value,
                payload.importance,
                payload.source,
            )
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "POST /agent-v2/memory")

    @app.get("/agent-v2/suggestions")
    def agent_v2_suggestions(
        request: Request,
        duration_min: int = Query(default=60, ge=15, le=720),
        mode: str = Query(default="supportive"),
        limit: int = Query(default=5, ge=1, le=20),
    ):
        try:
            return agent_v2_suggestions_payload(_req_user_id(request), duration_min, mode, limit)
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "GET /agent-v2/suggestions")

    @app.post("/agent-v2/entries/prepare")
    def agent_v2_prepare_entry(request: Request, payload: AgentV2EntryRequest):
        try:
            return prepare_entry_payload(
                _req_user_id(request) or payload.user_id,
                payload.entry_type,
                exam=payload.exam,
                course=payload.course,
                book_name=payload.book_name,
                source=payload.source,
                subject=payload.subject,
                topic=payload.topic,
                test_name=payload.test_name,
                test_number=payload.test_number,
                stage=payload.stage,
                org=payload.org,
                note=payload.note,
                work_type=payload.work_type,
            )
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "POST /agent-v2/entries/prepare")

    @app.post("/agent-v2/entries/log")
    def agent_v2_log_entry(request: Request, payload: AgentV2EntryRequest):
        try:
            return log_entry_payload(
                _req_user_id(request) or payload.user_id,
                payload.entry_type,
                confirm=payload.confirm,
                exam=payload.exam,
                course=payload.course,
                book_name=payload.book_name,
                source=payload.source,
                subject=payload.subject,
                topic=payload.topic,
                test_name=payload.test_name,
                test_number=payload.test_number,
                stage=payload.stage,
                org=payload.org,
                note=payload.note,
                work_type=payload.work_type,
            )
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "POST /agent-v2/entries/log")

    @app.get("/extras")
    def get_extras(request: Request, date: Optional[str] = Query(default=None)):
        try:
            return get_extras_payload(_req_user_id(request), date)
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "GET /extras")

    @app.put("/extras")
    def save_extras(request: Request, payload: ExtrasUpsertRequest):
        try:
            user_id = _req_user_id(request) or payload.user_id
            rows = [r.model_dump() for r in payload.rows]
            result = save_extras_payload(user_id, rows, payload.date)
            try:
                refresh_daily_aggregate(user_id, current_date_str())
            except Exception as agg_err:  # noqa: BLE001
                logger.warning("agent-v2 aggregate refresh failed after PUT /extras: %s", agg_err)
            return result
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "PUT /extras")

    @app.post("/points")
    def add_points(request: Request, payload: AddPointsRequest):
        try:
            if payload.action_type not in POINTS_MAP:
                raise HTTPException(status_code=400, detail="Unknown action_type")
            player_id = _req_user_id(request) or payload.player_id
            if not player_id:
                raise HTTPException(status_code=400, detail="player_id required")
            result = add_points_payload(player_id, payload.action_type, payload.test_type, payload.detail)
            try:
                refresh_daily_aggregate(player_id, result.get("date") or current_date_str())
            except Exception as agg_err:  # noqa: BLE001
                logger.warning("agent-v2 aggregate refresh failed after POST /points: %s", agg_err)
            return result
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "POST /points")

    @app.post("/points/delete")
    def delete_points_event(payload: DeletePointsEventRequest):
        try:
            result = delete_points_event_payload(payload.event_id)
            try:
                refresh_daily_aggregate("kapil", result.get("date", ""))
            except Exception as agg_err:  # noqa: BLE001
                logger.warning("agent-v2 aggregate refresh failed after POST /points/delete (kapil): %s", agg_err)
            try:
                refresh_daily_aggregate("divya", result.get("date", ""))
            except Exception as agg_err:  # noqa: BLE001
                logger.warning("agent-v2 aggregate refresh failed after POST /points/delete (divya): %s", agg_err)
            return result
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "POST /points/delete")

    @app.post("/reset")
    def reset_race():
        try:
            result = reset_race_payload()
            try:
                refresh_daily_aggregate("kapil", result.get("date") or current_date_str())
                refresh_daily_aggregate("divya", result.get("date") or current_date_str())
            except Exception as agg_err:  # noqa: BLE001
                logger.warning("agent-v2 aggregate refresh failed after POST /reset: %s", agg_err)
            return result
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "POST /reset")

    @app.post("/sessions")
    def create_session(request: Request, payload: CreateSessionRequest):
        try:
            uid = _req_user_id(request) or payload.user_id
            payload = payload.model_copy(update={"user_id": uid})
            return create_session_payload(payload)
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "POST /sessions")

    @app.get("/sessions")
    def list_sessions(
        request: Request,
        date: Optional[str] = Query(default=None),
        scope: Optional[str] = Query(default=None),
    ):
        try:
            return list_sessions_payload(date, _req_user_id(request), scope)
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "GET /sessions")

    @app.get("/sessions/{session_id}")
    def get_session(session_id: str):
        try:
            return get_session_payload(session_id)
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "GET /sessions/{id}")

    @app.post("/sessions/{session_id}/status")
    def update_session_status(session_id: str, payload: SessionStatusRequest):
        try:
            result = update_session_status_payload(session_id, payload)
            try:
                session = result.get("session", {}) if isinstance(result, dict) else {}
                uid = (session.get("user_id") or "").strip()
                d = (session.get("date") or current_date_str()).strip()
                if uid and d:
                    refresh_daily_aggregate(uid, d)
            except Exception as agg_err:  # noqa: BLE001
                logger.warning("agent-v2 aggregate refresh failed after POST /sessions/{id}/status: %s", agg_err)
            return result
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "POST /sessions/{id}/status")

    @app.post("/sessions/{session_id}/delete")
    def delete_session(session_id: str):
        try:
            result = delete_session_payload(session_id)
            try:
                uid = (result.get("user_id") or "").strip()
                d = (result.get("date") or current_date_str()).strip()
                if uid and d:
                    refresh_daily_aggregate(uid, d)
            except Exception as agg_err:  # noqa: BLE001
                logger.warning("agent-v2 aggregate refresh failed after POST /sessions/{id}/delete: %s", agg_err)
            return result
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "POST /sessions/{id}/delete")

    @app.post("/sessions/{session_id}/presign")
    def create_presigned_upload(session_id: str, payload: PresignRequest):
        try:
            return create_presigned_upload_payload(session_id, payload)
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "POST /sessions/{id}/presign")

    @app.post("/sessions/{session_id}/multipart/start")
    def start_multipart_upload(session_id: str, payload: MultipartStartRequest):
        try:
            return start_multipart_upload_payload(session_id, payload)
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "POST /sessions/{id}/multipart/start")

    @app.post("/sessions/{session_id}/multipart/presign-part")
    def presign_multipart_part(session_id: str, payload: MultipartPartRequest):
        try:
            return presign_multipart_part_payload(session_id, payload)
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "POST /sessions/{id}/multipart/presign-part")

    @app.post("/sessions/{session_id}/multipart/complete")
    def complete_multipart_upload(session_id: str, payload: MultipartCompleteRequest):
        try:
            return complete_multipart_upload_payload(session_id, payload)
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "POST /sessions/{id}/multipart/complete")

    @app.post("/sessions/{session_id}/multipart/abort")
    def abort_multipart_upload(session_id: str, payload: MultipartAbortRequest):
        try:
            return abort_multipart_upload_payload(session_id, payload)
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "POST /sessions/{id}/multipart/abort")

    @app.post("/sessions/{session_id}/chunk/presign-url")
    def presign_chunk_upload(session_id: str, payload: ChunkPresignRequest):
        try:
            return presign_chunk_upload_payload(session_id, payload)
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "POST /sessions/{id}/chunk/presign-url")

    @app.post("/sessions/{session_id}/chunks/concat")
    def concat_chunks(session_id: str, payload: ChunkConcatRequest):
        try:
            return concat_chunks_payload(session_id, payload)
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "POST /sessions/{id}/chunks/concat")

    @app.get("/sessions/{session_id}/playback-url")
    def create_presigned_playback_url(
        session_id: str,
        media_type: str = Query(...),
        download: bool = Query(default=False),
    ):
        try:
            return create_presigned_playback_url_payload(
                session_id, media_type, disposition="attachment" if download else None
            )
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "GET /sessions/{id}/playback-url")

    @app.post("/sessions/{session_id}/notes")
    def update_session_notes(session_id: str, payload: SessionNotesRequest):
        try:
            return update_session_notes_payload(session_id, payload)
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "POST /sessions/{id}/notes")

    @app.post("/sessions/{session_id}/heartbeat")
    def session_heartbeat(session_id: str):
        try:
            return record_session_heartbeat_payload(session_id)
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "POST /sessions/{id}/heartbeat")

    # ── Day Activity Tracker ──────────────────────────────────────────────
    @app.get("/tracker/activities")
    def tracker_get_activities(request: Request, date: Optional[str] = Query(default=None)):
        try:
            return {"activities": get_activities(_req_user_id(request), date or "")}
        except Exception as err:
            _raise_as_http(err, "GET /tracker/activities")

    @app.post("/tracker/activities")
    def tracker_create_activity(request: Request, payload: ActivityUpsertRequest):
        try:
            return create_activity(_req_user_id(request), payload.model_dump())
        except Exception as err:
            _raise_as_http(err, "POST /tracker/activities")

    @app.put("/tracker/activities/{activity_id}")
    def tracker_update_activity(activity_id: str, request: Request, payload: ActivityUpsertRequest):
        try:
            return update_activity(_req_user_id(request), activity_id, payload.model_dump(exclude_none=True))
        except Exception as err:
            _raise_as_http(err, "PUT /tracker/activities/{id}")

    @app.delete("/tracker/activities/{activity_id}")
    def tracker_delete_activity(activity_id: str, request: Request):
        try:
            return delete_activity(_req_user_id(request), activity_id)
        except Exception as err:
            _raise_as_http(err, "DELETE /tracker/activities/{id}")

    @app.get("/tracker/categories")
    def tracker_get_categories(request: Request):
        try:
            return {"categories": get_categories(_req_user_id(request))}
        except Exception as err:
            _raise_as_http(err, "GET /tracker/categories")

    @app.post("/tracker/categories")
    def tracker_create_category(request: Request, payload: ActivityCategoryRequest):
        try:
            return create_category(_req_user_id(request), payload.name, payload.color)
        except Exception as err:
            _raise_as_http(err, "POST /tracker/categories")

    @app.delete("/tracker/categories/{name}")
    def tracker_delete_category(name: str, request: Request):
        try:
            return delete_category(_req_user_id(request), name)
        except Exception as err:
            _raise_as_http(err, "DELETE /tracker/categories/{name}")

    @app.get("/")
    def health():
        return {"ok": True, "service": "kapil-divya-race-api"}

    return app


app = create_app()
handler = Mangum(app)
