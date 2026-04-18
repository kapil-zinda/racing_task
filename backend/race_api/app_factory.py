from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from mangum import Mangum

from .constants import PLAYERS, POINTS_MAP
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
from .context import current_date_str, logger
from .race_domain import (
    add_points_payload,
    build_mission_control_payload,
    build_syllabus_payload,
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
from .mission_domain import get_or_create_mission, mission_progress_payload, mission_selector_options, upsert_mission
from .schemas import (
    AddPointsRequest,
    ContentCreateFolderRequest,
    ContentDeleteRequest,
    ContentCompleteUploadRequest,
    ContentCopyRequest,
    ContentDownloadRequest,
    ContentMakeSearchableRequest,
    ContentPresignUploadRequest,
    ContentRenameRequest,
    ContentMoveRequest,
    CreateSessionRequest,
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
    AgentV2ChatRequest,
    AgentV2CreateRequest,
    AgentV2EntryRequest,
    AgentV2MemoryUpsertRequest,
    SessionStatusRequest,
)
from .session_domain import (
    abort_multipart_upload_payload,
    complete_multipart_upload_payload,
    create_presigned_playback_url_payload,
    create_presigned_upload_payload,
    create_session_payload,
    get_session_payload,
    list_sessions_payload,
    presign_multipart_part_payload,
    start_multipart_upload_payload,
    update_session_status_payload,
)


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
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/state")
    def get_state(date: str | None = Query(default=None)):
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
    def get_syllabus(user_id: str = Query(default="kapil")):
        try:
            if user_id not in PLAYERS:
                raise HTTPException(status_code=400, detail="Invalid user_id")
            return build_syllabus_payload(user_id)
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "GET /syllabus")

    @app.get("/content/list")
    def content_list(
        folder_id: str | None = Query(default=None),
        q: str | None = Query(default=None),
        sort_by: str | None = Query(default="name"),
        sort_dir: str | None = Query(default="asc"),
        view_mode: str | None = Query(default="all"),
    ):
        try:
            return list_content(folder_id, q, sort_by, sort_dir, view_mode)
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "GET /content/list")

    @app.get("/content/tree")
    def content_tree(
        parent_id: str | None = Query(default=None),
        view_mode: str | None = Query(default="all"),
    ):
        try:
            return list_folder_tree(parent_id, view_mode)
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "GET /content/tree")

    @app.post("/content/folder")
    def content_create_folder(payload: ContentCreateFolderRequest):
        try:
            return create_folder(payload.parent_id, payload.name)
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "POST /content/folder")

    @app.post("/content/rename")
    def content_rename(payload: ContentRenameRequest):
        try:
            return rename_item(payload.id, payload.item_type, payload.new_name)
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "POST /content/rename")

    @app.post("/content/presign-upload")
    def content_presign_upload(payload: ContentPresignUploadRequest):
        try:
            return create_upload_url(payload.folder_id, payload.file_name, payload.content_type, payload.size)
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "POST /content/presign-upload")

    @app.post("/content/complete-upload")
    def content_complete_upload(payload: ContentCompleteUploadRequest):
        try:
            return complete_upload(payload.file_id, payload.etag, payload.size)
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "POST /content/complete-upload")

    @app.post("/content/delete")
    def content_delete(payload: ContentDeleteRequest):
        try:
            return delete_item(payload.id, payload.item_type, payload.recursive, payload.scope)
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "POST /content/delete")

    @app.post("/content/copy")
    def content_copy(payload: ContentCopyRequest):
        try:
            return copy_item(payload.id, payload.item_type, payload.destination_folder_id, payload.scope)
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "POST /content/copy")

    @app.post("/content/move")
    def content_move(payload: ContentMoveRequest):
        try:
            return move_item(payload.id, payload.item_type, payload.destination_folder_id, payload.scope)
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "POST /content/move")

    @app.post("/content/download")
    def content_download(payload: ContentDownloadRequest):
        try:
            return download_item(payload.id, payload.item_type, payload.recursive)
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "POST /content/download")

    @app.get("/content/preview-url")
    def content_preview(file_id: str = Query(...)):
        try:
            return preview_by_id(file_id)
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "GET /content/preview-url")

    @app.post("/content/make-searchable")
    def content_make_searchable(payload: ContentMakeSearchableRequest):
        try:
            return make_item_searchable(payload.id, payload.item_type, payload.course)
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "POST /content/make-searchable")

    @app.post("/pdf-search/presign-upload")
    def pdf_presign_upload(payload: PdfPresignUploadRequest):
        try:
            return create_pdf_presigned_upload(payload)
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
        q: str = Query(...),
        limit: int = Query(default=20, ge=1, le=100),
        course: str | None = Query(default=None),
    ):
        try:
            return search_pdf(q, limit, course)
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "GET /pdf-search/query")

    @app.get("/qna/sessions")
    def qna_list_sessions(user_id: str = Query(default="kapil")):
        try:
            return list_qna_sessions(user_id)
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "GET /qna/sessions")

    @app.post("/qna/sessions")
    def qna_create_session(payload: QnaSessionCreateRequest):
        try:
            return create_qna_session(payload.user_id, payload.title)
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "POST /qna/sessions")

    @app.get("/qna/sessions/{session_id}/messages")
    def qna_get_messages(session_id: str):
        try:
            return get_qna_messages(session_id)
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "GET /qna/sessions/{id}/messages")

    @app.post("/qna/ask")
    def qna_ask(payload: QnaAskRequest):
        try:
            return ask_qna_in_session(payload.session_id, payload.question, payload.course, payload.limit)
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "POST /qna/ask")

    @app.get("/mission-control")
    def get_mission_control(
        user_id: str = Query(default="kapil"),
        lookback_days: int = Query(default=90, ge=14, le=365),
    ):
        try:
            if user_id not in PLAYERS:
                raise HTTPException(status_code=400, detail="Invalid user_id")
            payload = build_mission_control_payload(user_id, lookback_days)
            payload["mission"] = get_or_create_mission(user_id)
            payload["mission_progress"] = mission_progress_payload(user_id, lookback_days)
            return payload
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "GET /mission-control")

    @app.get("/mission")
    def get_mission(user_id: str = Query(default="kapil"), lookback_days: int = Query(default=90, ge=14, le=365)):
        try:
            if user_id not in PLAYERS:
                raise HTTPException(status_code=400, detail="Invalid user_id")
            return {
                "mission": get_or_create_mission(user_id),
                "mission_progress": mission_progress_payload(user_id, lookback_days),
                "selector_options": mission_selector_options(user_id),
            }
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "GET /mission")

    @app.put("/mission")
    def save_mission(payload: MissionUpsertRequest):
        try:
            if payload.user_id not in PLAYERS:
                raise HTTPException(status_code=400, detail="Invalid user_id")
            mission = upsert_mission(
                payload.user_id,
                title=payload.title,
                target_date=payload.target_date,
                status=payload.status,
                weights=payload.weights,
                targets=payload.targets,
                plan=payload.plan,
            )
            return {
                "message": "Mission saved",
                "mission": mission,
                "mission_progress": mission_progress_payload(payload.user_id, 90),
                "selector_options": mission_selector_options(payload.user_id),
            }
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "PUT /mission")

    @app.get("/mission/options")
    def get_mission_options(user_id: str = Query(default="kapil")):
        try:
            if user_id not in PLAYERS:
                raise HTTPException(status_code=400, detail="Invalid user_id")
            return mission_selector_options(user_id)
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "GET /mission/options")

    @app.get("/agent-v2/context")
    def agent_v2_context(
        user_id: str = Query(default="kapil"),
        date: str | None = Query(default=None),
        lookback_days: int = Query(default=14, ge=1, le=365),
        x_days: int = Query(default=7, ge=1, le=60),
        y_days: int = Query(default=15, ge=1, le=90),
    ):
        try:
            return agent_context_payload(user_id, date, lookback_days, x_days, y_days)
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "GET /agent-v2/context")

    @app.get("/agent-v2/reports/period")
    def agent_v2_report_period(
        user_id: str = Query(default="kapil"),
        from_date: str = Query(..., alias="from"),
        to_date: str = Query(..., alias="to"),
        group_by: str = Query(default="day"),
        x_days: int = Query(default=7, ge=1, le=60),
        y_days: int = Query(default=15, ge=1, le=90),
    ):
        try:
            return report_period_payload(user_id, from_date, to_date, group_by, x_days, y_days)
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "GET /agent-v2/reports/period")

    @app.get("/agent-v2/reports/revision-gaps")
    def agent_v2_revision_gaps(
        user_id: str = Query(default="kapil"),
        x_days: int = Query(default=7, ge=1, le=60),
        y_days: int = Query(default=15, ge=1, le=90),
        limit: int = Query(default=200, ge=1, le=1000),
        reference_date: str | None = Query(default=None),
    ):
        try:
            return report_revision_gaps_payload(user_id, x_days, y_days, limit, reference_date)
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "GET /agent-v2/reports/revision-gaps")

    @app.get("/agent-v2/recommendations/next-actions")
    def agent_v2_next_actions(
        user_id: str = Query(default="kapil"),
        duration_min: int = Query(default=60, ge=15, le=720),
        mode: str = Query(default="supportive"),
        limit: int = Query(default=5, ge=1, le=20),
        x_days: int = Query(default=7, ge=1, le=60),
        y_days: int = Query(default=15, ge=1, le=90),
    ):
        try:
            return recommendations_next_actions_payload(user_id, duration_min, mode, limit, x_days, y_days)
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "GET /agent-v2/recommendations/next-actions")

    @app.get("/agent-v2/search/unified")
    def agent_v2_search_unified(
        q: str = Query(...),
        user_id: str = Query(default="kapil"),
        course: str | None = Query(default=None),
        types: str | None = Query(default=None),
        limit: int = Query(default=20, ge=1, le=100),
    ):
        try:
            return search_unified_payload(q, user_id, course, types, limit)
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "GET /agent-v2/search/unified")

    @app.get("/agent-v2/search/suggest")
    def agent_v2_search_suggest(
        user_id: str = Query(default="kapil"),
        q: str | None = Query(default=None),
        limit: int = Query(default=12, ge=1, le=50),
    ):
        try:
            return search_suggest_payload(user_id, q, limit)
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "GET /agent-v2/search/suggest")

    @app.get("/agent-v2/state/range")
    def agent_v2_state_range(
        from_date: str = Query(..., alias="from"),
        to_date: str = Query(..., alias="to"),
        user_id: str | None = Query(default=None),
        include_history: bool = Query(default=False),
    ):
        try:
            return state_range_payload(from_date, to_date, user_id, include_history)
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "GET /agent-v2/state/range")

    @app.post("/agent-v2/aggregates/rebuild")
    def agent_v2_rebuild_aggregates(
        from_date: str | None = Query(default=None, alias="from"),
        to_date: str | None = Query(default=None, alias="to"),
        user_id: str | None = Query(default=None),
    ):
        try:
            return rebuild_daily_aggregates_payload(from_date, to_date, user_id)
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "POST /agent-v2/aggregates/rebuild")

    @app.post("/agent-v2/aggregates/refresh")
    def agent_v2_refresh_aggregates(date: str | None = Query(default=None)):
        try:
            return refresh_daily_aggregates_for_date(date or current_date_str())
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "POST /agent-v2/aggregates/refresh")

    @app.post("/agent-v2/create-agent")
    def agent_v2_create(payload: AgentV2CreateRequest):
        try:
            return create_agent_v2_session_payload(
                payload.user_id,
                mode=payload.mode,
                page_context=payload.page_context,
                current_session_id=payload.current_session_id,
            )
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "POST /agent-v2/create-agent")

    @app.post("/agent-v2/chat")
    def agent_v2_chat(payload: AgentV2ChatRequest):
        try:
            return run_agent_v2_chat_payload(
                payload.session_id,
                payload.user_id,
                payload.message,
                mode=payload.mode,
                page_context=payload.page_context,
                allow_ui_actions=payload.allow_ui_actions,
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
    def agent_v2_memory(payload: AgentV2MemoryUpsertRequest):
        try:
            return upsert_agent_v2_memory_payload(
                payload.user_id,
                payload.key,
                payload.value,
                payload.importance,
                payload.source,
            )
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "POST /agent-v2/memory")

    @app.get("/agent-v2/suggestions")
    def agent_v2_suggestions(
        user_id: str = Query(default="kapil"),
        duration_min: int = Query(default=60, ge=15, le=720),
        mode: str = Query(default="supportive"),
        limit: int = Query(default=5, ge=1, le=20),
    ):
        try:
            return agent_v2_suggestions_payload(user_id, duration_min, mode, limit)
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "GET /agent-v2/suggestions")

    @app.post("/agent-v2/entries/prepare")
    def agent_v2_prepare_entry(payload: AgentV2EntryRequest):
        try:
            return prepare_entry_payload(
                payload.user_id,
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
    def agent_v2_log_entry(payload: AgentV2EntryRequest):
        try:
            return log_entry_payload(
                payload.user_id,
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
    def get_extras(user_id: str = Query(default="kapil"), date: str | None = Query(default=None)):
        try:
            return get_extras_payload(user_id, date)
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "GET /extras")

    @app.put("/extras")
    def save_extras(payload: ExtrasUpsertRequest):
        try:
            rows = [r.model_dump() for r in payload.rows]
            result = save_extras_payload(payload.user_id, rows, payload.date)
            try:
                refresh_daily_aggregate(payload.user_id, current_date_str())
            except Exception as agg_err:  # noqa: BLE001
                logger.warning("agent-v2 aggregate refresh failed after PUT /extras: %s", agg_err)
            return result
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "PUT /extras")

    @app.post("/points")
    def add_points(payload: AddPointsRequest):
        try:
            if payload.player_id not in PLAYERS:
                raise HTTPException(status_code=400, detail="Unknown player_id")
            if payload.action_type not in POINTS_MAP:
                raise HTTPException(status_code=400, detail="Unknown action_type")
            result = add_points_payload(payload.player_id, payload.action_type, payload.test_type, payload.detail)
            try:
                refresh_daily_aggregate(payload.player_id, result.get("date") or current_date_str())
            except Exception as agg_err:  # noqa: BLE001
                logger.warning("agent-v2 aggregate refresh failed after POST /points: %s", agg_err)
            return result
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "POST /points")

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
    def create_session(payload: CreateSessionRequest):
        try:
            return create_session_payload(payload)
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "POST /sessions")

    @app.get("/sessions")
    def list_sessions(date: str | None = Query(default=None), user_id: str | None = Query(default=None)):
        try:
            return list_sessions_payload(date, user_id)
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
                uid = (session.get("user_id") or "").strip().lower()
                d = (session.get("date") or current_date_str()).strip()
                if uid in PLAYERS and d:
                    refresh_daily_aggregate(uid, d)
            except Exception as agg_err:  # noqa: BLE001
                logger.warning("agent-v2 aggregate refresh failed after POST /sessions/{id}/status: %s", agg_err)
            return result
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "POST /sessions/{id}/status")

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

    @app.get("/sessions/{session_id}/playback-url")
    def create_presigned_playback_url(session_id: str, media_type: str = Query(...)):
        try:
            return create_presigned_playback_url_payload(session_id, media_type)
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "GET /sessions/{id}/playback-url")

    @app.get("/")
    def health():
        return {"ok": True, "service": "kapil-divya-race-api"}

    return app


app = create_app()
handler = Mangum(app)
