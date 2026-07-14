from __future__ import annotations

import time
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
from .rate_limit import check_rate_limit
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
from .answer_eval_domain import (
    evaluate_answer_payload,
    get_answer_eval_payload,
    list_answer_evals_payload,
    presign_answer_upload_payload,
)
from .extras_domain import (
    create_extra_category,
    delete_extra_category,
    get_extra_categories,
    get_extras_payload,
    save_extras_payload,
)
from .interview_domain import (
    finalize_report_payload,
    get_daf_payload,
    get_interview_payload,
    list_interviews_payload,
    save_daf_payload,
    start_interview_payload,
    submit_answer_payload,
)
from .report_domain import day_report_payload
from .activity_tracker_domain import (
    create_activity,
    create_category,
    delete_activity,
    delete_category,
    get_activities,
    get_activities_summary,
    get_categories,
    update_activity,
)
from .context import current_date_str, logger
from .live_session_domain import (
    get_active_live_session,
    get_day_full,
    get_day_full_summary,
    get_live_stats,
    get_member_day_focus,
    get_member_month_overview,
    heartbeat_live_session,
    init_live_session_service,
    pause_live_session,
    resume_live_session,
    start_live_session,
    stop_live_session,
)
from .group_domain import (
    create_group,
    get_group,
    get_group_live_status,
    init_group_service,
    join_group,
    join_group_by_code,
    leave_group,
    list_my_groups,
    search_groups,
)
from .leaderboard_domain import global_leaderboard, group_leaderboard, list_leaderboard_categories
from .race_domain import (
    add_points_payload,
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
    doc_url_payload,
    index_pdf_document,
    search_pdf,
)
from .qna_domain import ask_qna_in_session, create_qna_session, get_qna_messages, list_qna_sessions
from .goal_domain import (
    create_goal,
    delete_goal,
    get_activity,
    get_goal,
    list_goals,
    update_goal,
)
from .goal_node_domain import (
    bulk_create_children,
    create_node,
    delete_node,
    get_tree,
    move_node,
    update_node,
)
from .goal_metric_domain import (
    create_metric,
    delete_metric,
    increment_metric,
    list_metrics,
    update_metric,
)
from .goal_ai_domain import daily_plan, forecast_goal, generate_goal_from_text, weekly_review
from .goal_template_domain import (
    create_template_from_goal,
    delete_template,
    list_templates,
    use_template,
)
from .goal_analytics_domain import analytics as goal_analytics, calendar as goal_calendar
from .goal_dependency_domain import create_dependency, delete_dependency, list_dependencies
from .goal_schedule_domain import (
    create_recurring,
    create_reminder,
    delete_recurring,
    delete_reminder,
    list_notifications,
    list_recurring,
    list_reminders,
)
from .goal_search_domain import search as goal_search
from .goal_dashboard_domain import dashboard as goal_dashboard
from .goal_attachment_domain import (
    create_attachment,
    delete_attachment,
    list_attachments,
    presign_attachment,
)
from .mindmap_domain import (
    create_mindmap,
    delete_mindmap,
    get_mindmap,
    list_mindmaps,
    update_mindmap,
)
from .noter_domain import (
    copy_item_payload as noter_copy_item,
    create_doc_payload as noter_create_doc,
    create_folder_payload as noter_create_folder,
    delete_doc_payload as noter_delete_doc,
    delete_item_payload as noter_delete_item,
    duplicate_item_payload as noter_duplicate_item,
    get_doc_payload as noter_get_doc,
    get_version_payload as noter_get_version,
    list_directory_payload as noter_list_items,
    list_docs_payload as noter_list_docs,
    list_folder_tree_payload as noter_folder_tree,
    list_versions_payload as noter_list_versions,
    move_item_payload as noter_move_item,
    presign_asset_upload_payload as noter_presign_asset,
    rename_item_payload as noter_rename_item,
    resolve_asset_url_payload as noter_resolve_asset,
    restore_version_payload as noter_restore_version,
    save_doc_payload as noter_save_doc,
    snapshot_doc_payload as noter_snapshot_doc,
)
from .payment_domain import create_order_payload, verify_payment_payload, verify_webhook_payload, credit_balance_payload
from .plans_domain import list_plans_payload, current_subscription_payload, create_plan_order_payload
from .contact_domain import send_contact_message
from .schemas import (
    ActivityCategoryRequest,
    ActivityUpsertRequest,
    ChangePasswordRequest,
    DeleteAccountRequest,
    LiveSessionStartRequest,
    LiveSessionHeartbeatRequest,
    LiveSessionSyncRequest,
    GroupCreateRequest,
    GroupJoinRequest,
    GroupJoinByCodeRequest,
    MindmapUpsertRequest,
    NoterAssetPresignRequest,
    NoterAssetResolveRequest,
    NoterCreateRequest,
    NoterFolderCreateRequest,
    NoterItemCopyRequest,
    NoterItemDeleteRequest,
    NoterItemDuplicateRequest,
    NoterItemMoveRequest,
    NoterItemRenameRequest,
    NoterRestoreRequest,
    NoterSaveRequest,
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
    AnswerEvalEvaluateRequest,
    AnswerEvalPresignRequest,
    ChunkConcatRequest,
    ChunkPresignRequest,
    CreateSessionRequest,
    DafSaveRequest,
    InterviewAnswerRequest,
    InterviewStartRequest,
    SessionNotesRequest,
    ExtrasUpsertRequest,
    ExtraCategoryRequest,
    MultipartAbortRequest,
    MultipartCompleteRequest,
    MultipartPartRequest,
    MultipartStartRequest,
    PdfIndexRequest,
    PdfPresignUploadRequest,
    PresignRequest,
    QnaAskRequest,
    QnaSessionCreateRequest,
    GoalCreateRequest,
    GoalUpdateRequest,
    GoalNodeCreateRequest,
    GoalNodeUpdateRequest,
    GoalNodeMoveRequest,
    GoalNodeBulkCreateRequest,
    GoalMetricCreateRequest,
    GoalMetricUpdateRequest,
    GoalMetricIncrementRequest,
    GoalAIGenerateRequest,
    GoalIdRequest,
    GoalDailyPlanRequest,
    GoalTemplateCreateRequest,
    GoalTemplateUseRequest,
    GoalDependencyCreateRequest,
    GoalReminderCreateRequest,
    GoalRecurringCreateRequest,
    GoalAttachmentPresignRequest,
    GoalAttachmentCreateRequest,
    AgentV2ChatRequest,
    AgentV2CreateRequest,
    AgentV2EntryRequest,
    AgentV2MemoryUpsertRequest,
    AgentV2RealtimeTokenRequest,
    SessionStatusRequest,
    CreateOrderRequest,
    VerifyPaymentRequest,
    SubscribeRequest,
    UpdateProfileRequest,
    ContactRequest,
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


_PUBLIC_PATHS = {"/", "/health", "/docs", "/openapi.json", "/redoc", "/contact", "/razorpay/webhook", "/plans"}

# (method, path) -> (limit, window_seconds, key_kind). "ip" keys off the client address;
# "user" keys off the authenticated user_id (falls back to IP if somehow unauthenticated —
# these routes require auth anyway). Auth-endpoint limits guard against OTP email spam and
# credential stuffing; paid-endpoint limits guard against burst free-tier farming.
_RATE_LIMITS = {
    ("POST", "/auth/signup"): (5, 3600, "ip"),
    ("POST", "/auth/resend-otp"): (3, 300, "ip"),
    ("POST", "/auth/verify-otp"): (10, 300, "ip"),
    ("POST", "/auth/signin"): (10, 300, "ip"),
    ("POST", "/interview/start"): (5, 60, "user"),
    ("POST", "/answer-eval/presign"): (10, 60, "user"),
    ("GET", "/pdf-search/query"): (30, 60, "user"),
    ("POST", "/qna/ask"): (20, 60, "user"),
}


class APIKeyMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        cfg = _settings()
        auth_required = cfg.get("auth_required", False)
        method = request.method
        path = request.url.path
        is_public = path in _PUBLIC_PATHS or path.startswith("/auth/")
        api_key = request.headers.get("X-API-Key", "")
        user_id = ""
        if api_key:
            user = _auth_service.get_user_by_api_key(api_key)
            if user:
                request.state.user = user
                user_id = user.get("user_id", "") if isinstance(user, dict) else ""
            elif auth_required and not is_public:
                logger.warning("%s %s -> 401 invalid API key", method, path)
                return JSONResponse({"detail": "Invalid API key"}, status_code=401)
        elif auth_required and not is_public:
            logger.warning("%s %s -> 401 missing API key", method, path)
            return JSONResponse({"detail": "Missing X-API-Key header"}, status_code=401)

        policy = _RATE_LIMITS.get((method, path))
        if policy:
            limit, window, key_kind = policy
            client_ip = request.client.host if request.client else "unknown"
            rl_key = f"{method}:{path}:{user_id or client_ip}" if key_kind == "user" else f"{method}:{path}:{client_ip}"
            try:
                check_rate_limit(rl_key, limit, window)
            except HTTPException as err:
                logger.warning("%s %s -> 429 rate limited (%s)", method, path, rl_key)
                return JSONResponse({"detail": err.detail}, status_code=err.status_code)

        logger.info("--> %s %s user=%s", method, path, user_id or "-")
        start = time.monotonic()
        try:
            response = await call_next(request)
        except Exception:
            ms = (time.monotonic() - start) * 1000
            logger.exception("<-- %s %s FAILED after %.0fms", method, path, ms)
            raise
        ms = (time.monotonic() - start) * 1000
        log = logger.warning if response.status_code >= 500 else logger.info
        log("<-- %s %s %s %.0fms user=%s", method, path, response.status_code, ms, user_id or "-")
        return response


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
        logger.warning("%s -> HTTP %s: %s", endpoint_name, err.status_code, err.detail)
        raise err
    from .billing_domain import InsufficientCreditsError
    if isinstance(err, InsufficientCreditsError):
        logger.info("%s -> 402 insufficient credits (%s)", endpoint_name, err.action)
        raise HTTPException(
            status_code=402,
            detail={
                "code": "insufficient_credits",
                "action": err.action,
                "required_usd": err.required_usd,
                "balance_usd": err.balance_usd,
                "message": "Not enough credits. Please add credits to continue.",
            },
        )
    if isinstance(err, ValueError):
        logger.warning("%s -> 400 (ValueError): %s", endpoint_name, err)
        raise HTTPException(status_code=400, detail=str(err))
    if isinstance(err, PermissionError):
        logger.warning("%s -> 403: %s", endpoint_name, err)
        raise HTTPException(status_code=403, detail=str(err))
    if isinstance(err, (LookupError, FileNotFoundError)):
        logger.warning("%s -> 404: %s", endpoint_name, err)
        raise HTTPException(status_code=404, detail=str(err))

    logger.exception("%s -> 500 (unhandled): %s", endpoint_name, err)
    raise HTTPException(status_code=500, detail=f"Internal server error: {err}")


def create_app() -> FastAPI:
    app = FastAPI(title="Kapil vs Divya Race API", version="2.0.0")
    app.add_middleware(APIKeyMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=_settings().get("cors_allowed_origins") or [],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(auth_router)

    @app.on_event("startup")
    def _startup():
        _auth_service.init_auth_service()
        init_live_session_service()
        init_group_service()

    @app.get("/user/me")
    def user_me(request: Request):
        user = getattr(request.state, "user", None)
        if not user:
            raise HTTPException(status_code=401, detail="Not authenticated")
        return user

    @app.put("/user/me")
    def user_update_profile(request: Request, payload: UpdateProfileRequest):
        try:
            return _auth_service.update_profile(_require_auth(request), payload.name)
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "PUT /user/me")

    @app.post("/user/change-password")
    def user_change_password(request: Request, payload: ChangePasswordRequest):
        try:
            return _auth_service.change_password(
                _require_auth(request), payload.current_password, payload.new_password
            )
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "POST /user/change-password")

    @app.post("/user/delete-account")
    def user_delete_account(request: Request, payload: DeleteAccountRequest):
        try:
            return _auth_service.delete_account(_require_auth(request), payload.password)
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "POST /user/delete-account")

    @app.get("/plans")
    def plans_list():
        try:
            return list_plans_payload()
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "GET /plans")

    @app.get("/plans/me")
    def plans_me(request: Request):
        try:
            return current_subscription_payload(_require_auth(request))
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "GET /plans/me")

    @app.post("/plans/subscribe")
    def plans_subscribe(request: Request, payload: SubscribeRequest):
        try:
            return create_plan_order_payload(_require_auth(request), payload.plan, payload.interval)
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "POST /plans/subscribe")

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
            return search_pdf(q, limit, course, user_id=_require_auth(request), track_search=True)
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "GET /pdf-search/query")

    @app.get("/pdf-search/doc-url")
    def pdf_doc_url(request: Request, doc_id: str = Query(...)):
        try:
            return doc_url_payload(doc_id, user_id=_require_auth(request))
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "GET /pdf-search/doc-url")

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
            return get_qna_messages(session_id, _require_auth(request))
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "GET /qna/sessions/{id}/messages")

    @app.post("/qna/ask")
    def qna_ask(request: Request, payload: QnaAskRequest):
        try:
            return ask_qna_in_session(payload.session_id, payload.question, payload.course, payload.limit, _require_auth(request))
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "POST /qna/ask")

    # --- Universal Goal OS ---

    @app.get("/goals")
    def goals_list(request: Request):
        try:
            return list_goals(_require_auth(request))
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "GET /goals")

    @app.post("/goals")
    def goals_create(request: Request, payload: GoalCreateRequest):
        try:
            return create_goal(_require_auth(request), payload.model_dump())
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "POST /goals")

    @app.get("/goals/{goal_id}")
    def goals_get(goal_id: str, request: Request):
        try:
            return get_goal(_require_auth(request), goal_id)
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "GET /goals/{goal_id}")

    @app.patch("/goals/{goal_id}")
    def goals_update(goal_id: str, request: Request, payload: GoalUpdateRequest):
        try:
            return update_goal(_require_auth(request), goal_id, payload.model_dump(exclude_none=True))
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "PATCH /goals/{goal_id}")

    @app.delete("/goals/{goal_id}")
    def goals_delete(goal_id: str, request: Request):
        try:
            return delete_goal(_require_auth(request), goal_id)
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "DELETE /goals/{goal_id}")

    @app.get("/goals/{goal_id}/tree")
    def goals_tree(goal_id: str, request: Request,
                   parent: Optional[str] = Query(default=None),
                   depth: int = Query(default=0, ge=0, le=12)):
        try:
            return get_tree(_require_auth(request), goal_id, parent_id=parent, depth=depth)
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "GET /goals/{goal_id}/tree")

    @app.get("/goals/{goal_id}/activity")
    def goals_activity(goal_id: str, request: Request, limit: int = Query(default=100, ge=1, le=500)):
        try:
            return get_activity(_require_auth(request), goal_id, limit=limit)
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "GET /goals/{goal_id}/activity")

    @app.post("/nodes")
    def nodes_create(request: Request, payload: GoalNodeCreateRequest):
        try:
            return create_node(_require_auth(request), payload.model_dump())
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "POST /nodes")

    @app.post("/nodes/bulk")
    def nodes_bulk_create(request: Request, payload: GoalNodeBulkCreateRequest):
        try:
            return bulk_create_children(_require_auth(request), payload.model_dump())
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "POST /nodes/bulk")

    @app.patch("/nodes/{node_id}")
    def nodes_update(node_id: str, request: Request, payload: GoalNodeUpdateRequest):
        try:
            return update_node(_require_auth(request), node_id, payload.model_dump(exclude_none=True))
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "PATCH /nodes/{node_id}")

    @app.delete("/nodes/{node_id}")
    def nodes_delete(node_id: str, request: Request):
        try:
            return delete_node(_require_auth(request), node_id)
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "DELETE /nodes/{node_id}")

    @app.post("/nodes/{node_id}/move")
    def nodes_move(node_id: str, request: Request, payload: GoalNodeMoveRequest):
        try:
            return move_node(_require_auth(request), node_id, payload.new_parent_id, payload.order)
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "POST /nodes/{node_id}/move")

    @app.get("/nodes/{node_id}/metrics")
    def node_metrics_list(node_id: str, request: Request):
        try:
            return list_metrics(_require_auth(request), node_id)
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "GET /nodes/{node_id}/metrics")

    @app.post("/metrics")
    def metrics_create(request: Request, payload: GoalMetricCreateRequest):
        try:
            return create_metric(_require_auth(request), payload.model_dump())
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "POST /metrics")

    @app.patch("/metrics/{metric_id}")
    def metrics_update(metric_id: str, request: Request, payload: GoalMetricUpdateRequest):
        try:
            return update_metric(_require_auth(request), metric_id, payload.model_dump(exclude_none=True))
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "PATCH /metrics/{metric_id}")

    @app.post("/metrics/{metric_id}/increment")
    def metrics_increment(metric_id: str, request: Request, payload: GoalMetricIncrementRequest):
        try:
            return increment_metric(_require_auth(request), metric_id, payload.delta)
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "POST /metrics/{metric_id}/increment")

    @app.delete("/metrics/{metric_id}")
    def metrics_delete(metric_id: str, request: Request):
        try:
            return delete_metric(_require_auth(request), metric_id)
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "DELETE /metrics/{metric_id}")

    # --- Goal OS: AI, forecast, review, plan ---

    @app.post("/ai/generate")
    def ai_generate(request: Request, payload: GoalAIGenerateRequest):
        try:
            return generate_goal_from_text(_require_auth(request), payload.prompt)
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "POST /ai/generate")

    @app.post("/forecast")
    def goal_forecast(request: Request, payload: GoalIdRequest):
        try:
            return forecast_goal(_require_auth(request), payload.goal_id)
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "POST /forecast")

    @app.post("/review")
    def goal_review(request: Request, payload: GoalIdRequest):
        try:
            return weekly_review(_require_auth(request), payload.goal_id)
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "POST /review")

    @app.post("/ai/daily-plan")
    def goal_daily_plan(request: Request, payload: GoalDailyPlanRequest):
        try:
            return daily_plan(_require_auth(request), payload.goal_id, payload.limit)
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "POST /ai/daily-plan")

    # --- Goal OS: templates ---

    @app.get("/templates")
    def templates_list(request: Request):
        try:
            return list_templates(_require_auth(request))
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "GET /templates")

    @app.post("/templates")
    def templates_create(request: Request, payload: GoalTemplateCreateRequest):
        try:
            return create_template_from_goal(_require_auth(request), payload.goal_id, payload.name)
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "POST /templates")

    @app.post("/templates/use")
    def templates_use(request: Request, payload: GoalTemplateUseRequest):
        try:
            return use_template(_require_auth(request), payload.template_id, payload.name)
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "POST /templates/use")

    @app.delete("/templates/{template_id}")
    def templates_delete(template_id: str, request: Request):
        try:
            return delete_template(_require_auth(request), template_id)
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "DELETE /templates/{template_id}")

    # --- Goal OS: analytics + calendar + search ---

    @app.get("/goals/{goal_id}/analytics")
    def goal_analytics_route(goal_id: str, request: Request, tz_offset: int = Query(default=0)):
        try:
            return goal_analytics(_require_auth(request), goal_id, tz_offset)
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "GET /goals/{goal_id}/analytics")

    @app.get("/dashboard")
    def goal_dashboard_route(request: Request, tz_offset: int = Query(default=0)):
        try:
            return goal_dashboard(_require_auth(request), tz_offset)
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "GET /dashboard")

    @app.get("/calendar")
    def goal_calendar_route(request: Request, goal_id: str = Query(default=""), tz_offset: int = Query(default=0)):
        try:
            return goal_calendar(_require_auth(request), goal_id, tz_offset)
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "GET /calendar")

    @app.get("/search")
    def goal_search_route(request: Request, q: str = Query(default=""), limit: int = Query(default=30, ge=1, le=100)):
        try:
            return goal_search(_require_auth(request), q, limit)
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "GET /search")

    # --- Goal OS: dependencies ---

    @app.get("/goals/{goal_id}/dependencies")
    def deps_list(goal_id: str, request: Request):
        try:
            return list_dependencies(_require_auth(request), goal_id)
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "GET /goals/{goal_id}/dependencies")

    @app.post("/dependencies")
    def deps_create(request: Request, payload: GoalDependencyCreateRequest):
        try:
            return create_dependency(_require_auth(request), payload.model_dump())
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "POST /dependencies")

    @app.delete("/dependencies/{dep_id}")
    def deps_delete(dep_id: str, request: Request):
        try:
            return delete_dependency(_require_auth(request), dep_id)
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "DELETE /dependencies/{dep_id}")

    # --- Goal OS: reminders + recurring + notifications ---

    @app.get("/reminders")
    def reminders_list(request: Request, goal_id: str = Query(default="")):
        try:
            return list_reminders(_require_auth(request), goal_id)
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "GET /reminders")

    @app.post("/reminders")
    def reminders_create(request: Request, payload: GoalReminderCreateRequest):
        try:
            return create_reminder(_require_auth(request), payload.model_dump())
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "POST /reminders")

    @app.delete("/reminders/{reminder_id}")
    def reminders_delete(reminder_id: str, request: Request):
        try:
            return delete_reminder(_require_auth(request), reminder_id)
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "DELETE /reminders/{reminder_id}")

    @app.get("/notifications")
    def notifications_list(request: Request):
        try:
            return list_notifications(_require_auth(request))
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "GET /notifications")

    @app.get("/goals/{goal_id}/recurring")
    def recurring_list(goal_id: str, request: Request):
        try:
            return list_recurring(_require_auth(request), goal_id)
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "GET /goals/{goal_id}/recurring")

    @app.post("/recurring")
    def recurring_create(request: Request, payload: GoalRecurringCreateRequest):
        try:
            return create_recurring(_require_auth(request), payload.model_dump())
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "POST /recurring")

    @app.delete("/recurring/{rule_id}")
    def recurring_delete(rule_id: str, request: Request):
        try:
            return delete_recurring(_require_auth(request), rule_id)
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "DELETE /recurring/{rule_id}")

    # --- Goal OS: attachments ---

    @app.get("/nodes/{node_id}/attachments")
    def attachments_list(node_id: str, request: Request):
        try:
            return list_attachments(_require_auth(request), node_id)
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "GET /nodes/{node_id}/attachments")

    @app.post("/attachments/presign")
    def attachments_presign(request: Request, payload: GoalAttachmentPresignRequest):
        try:
            return presign_attachment(_require_auth(request), payload.node_id, payload.name, payload.content_type)
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "POST /attachments/presign")

    @app.post("/attachments")
    def attachments_create(request: Request, payload: GoalAttachmentCreateRequest):
        try:
            return create_attachment(_require_auth(request), payload.model_dump())
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "POST /attachments")

    @app.delete("/attachments/{attachment_id}")
    def attachments_delete(attachment_id: str, request: Request):
        try:
            return delete_attachment(_require_auth(request), attachment_id)
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "DELETE /attachments/{attachment_id}")

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

    @app.get("/extras/categories")
    def extras_get_categories(request: Request):
        try:
            return {"categories": get_extra_categories(_req_user_id(request))}
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "GET /extras/categories")

    @app.post("/extras/categories")
    def extras_create_category(request: Request, payload: ExtraCategoryRequest):
        try:
            return create_extra_category(_req_user_id(request), payload.name, payload.color)
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "POST /extras/categories")

    @app.delete("/extras/categories/{name}")
    def extras_delete_category(name: str, request: Request):
        try:
            return delete_extra_category(_req_user_id(request), name)
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "DELETE /extras/categories/{name}")

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

    # ── UPSC mock interview (virtual panel) ───────────────────────────────
    # DAF profile (one per user). Registered before /interview/{session_id} so
    # the literal /interview/daf path is not swallowed by the dynamic route.
    @app.get("/interview/daf")
    def interview_daf_get(request: Request):
        try:
            return get_daf_payload(_require_auth(request))
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "GET /interview/daf")

    @app.put("/interview/daf")
    def interview_daf_save(request: Request, payload: DafSaveRequest):
        try:
            return save_daf_payload(_require_auth(request), payload.daf)
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "PUT /interview/daf")

    @app.post("/interview/start")
    def interview_start(request: Request, payload: InterviewStartRequest):
        try:
            return start_interview_payload(_req_user_id(request), payload.daf)
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "POST /interview/start")

    @app.post("/interview/{session_id}/answer")
    def interview_answer(session_id: str, payload: InterviewAnswerRequest):
        try:
            return submit_answer_payload(
                session_id,
                text=payload.text,
                audio_base64=payload.audio_base64,
                audio_mime_type=payload.audio_mime_type,
                latency_ms=payload.latency_ms,
            )
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "POST /interview/{id}/answer")

    @app.post("/interview/{session_id}/report")
    def interview_report(session_id: str):
        try:
            return finalize_report_payload(session_id)
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "POST /interview/{id}/report")

    @app.get("/interview")
    def interview_list(request: Request):
        try:
            return list_interviews_payload(_req_user_id(request))
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "GET /interview")

    @app.get("/interview/{session_id}")
    def interview_get(session_id: str):
        try:
            return get_interview_payload(session_id)
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "GET /interview/{id}")

    # ── Report of the day ─────────────────────────────────────────────────
    @app.get("/report/day")
    def report_day(request: Request, date: str = Query(default=""), sections: str = Query(default="")):
        try:
            picked = [s.strip() for s in (sections or "").split(",") if s.strip()]
            return day_report_payload(_require_auth(request), date, picked or None)
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "GET /report/day")

    # ── UPSC Mains answer evaluation ──────────────────────────────────────
    @app.post("/answer-eval/presign")
    def answer_eval_presign(request: Request, payload: AnswerEvalPresignRequest):
        try:
            return presign_answer_upload_payload(
                _req_user_id(request), payload.filename, payload.content_type,
                payload.question, payload.max_marks, payload.subject,
                payload.has_diagrams, payload.language,
            )
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "POST /answer-eval/presign")

    @app.post("/answer-eval/{eval_id}/evaluate")
    def answer_eval_evaluate(eval_id: str, payload: Optional[AnswerEvalEvaluateRequest] = None):
        # Body is optional: question/subject/marks are captured and stored at
        # presign time, so the manual trigger normally posts nothing and the
        # evaluation reads the stored values. Any fields sent here just override.
        try:
            question = payload.question if payload else ""
            max_marks = payload.max_marks if payload else 0
            return evaluate_answer_payload(eval_id, question, max_marks)
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "POST /answer-eval/{id}/evaluate")

    @app.get("/answer-eval/{eval_id}")
    def answer_eval_get(eval_id: str):
        try:
            return get_answer_eval_payload(eval_id)
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "GET /answer-eval/{id}")

    @app.get("/answer-eval")
    def answer_eval_list(
        request: Request,
        q: str = Query(default=""),
        from_date: str = Query(default=""),
        to_date: str = Query(default=""),
    ):
        try:
            return list_answer_evals_payload(_req_user_id(request), q=q, from_date=from_date, to_date=to_date)
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "GET /answer-eval")

    # ── Storage quota (content + recordings + PDF-search) ─────────────────
    @app.get("/storage")
    def storage_status(request: Request):
        try:
            from .storage_domain import storage_status_payload

            return storage_status_payload(_req_user_id(request))
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "GET /storage")

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

    @app.get("/tracker/summary")
    def tracker_summary(
        request: Request,
        start_date: Optional[str] = Query(default=None),
        end_date: Optional[str] = Query(default=None),
    ):
        try:
            return get_activities_summary(_req_user_id(request), start_date or "", end_date or "")
        except Exception as err:
            _raise_as_http(err, "GET /tracker/summary")

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

    @app.get("/tracker/day-full")
    def tracker_day_full(request: Request, date: Optional[str] = Query(default=None)):
        try:
            return get_day_full(_req_user_id(request), date or "")
        except Exception as err:
            _raise_as_http(err, "GET /tracker/day-full")

    @app.get("/tracker/day-full-summary")
    def tracker_day_full_summary(
        request: Request,
        start_date: Optional[str] = Query(default=None),
        end_date: Optional[str] = Query(default=None),
    ):
        try:
            return get_day_full_summary(_req_user_id(request), start_date or "", end_date or "")
        except Exception as err:
            _raise_as_http(err, "GET /tracker/day-full-summary")

    # ── Live study timer (YeolPumTa-style) ─────────────────────────────────
    @app.post("/live/start")
    def live_start(request: Request, payload: LiveSessionStartRequest):
        try:
            return start_live_session(_req_user_id(request), payload.model_dump())
        except Exception as err:
            _raise_as_http(err, "POST /live/start")

    @app.get("/live/active")
    def live_active(request: Request):
        try:
            return get_active_live_session(_req_user_id(request))
        except Exception as err:
            _raise_as_http(err, "GET /live/active")

    @app.get("/live/stats")
    def live_stats(request: Request):
        try:
            return get_live_stats(_req_user_id(request))
        except Exception as err:
            _raise_as_http(err, "GET /live/stats")

    @app.post("/live/{session_id}/heartbeat")
    def live_heartbeat(session_id: str, request: Request, payload: LiveSessionHeartbeatRequest):
        try:
            return heartbeat_live_session(_req_user_id(request), session_id, payload.elapsed_seconds)
        except Exception as err:
            _raise_as_http(err, "POST /live/{id}/heartbeat")

    @app.post("/live/{session_id}/pause")
    def live_pause(session_id: str, request: Request, payload: LiveSessionSyncRequest):
        try:
            return pause_live_session(_req_user_id(request), session_id, payload.elapsed_seconds, payload.reason)
        except Exception as err:
            _raise_as_http(err, "POST /live/{id}/pause")

    @app.post("/live/{session_id}/resume")
    def live_resume(session_id: str, request: Request, payload: LiveSessionSyncRequest):
        try:
            return resume_live_session(_req_user_id(request), session_id, payload.elapsed_seconds, payload.reason)
        except Exception as err:
            _raise_as_http(err, "POST /live/{id}/resume")

    @app.post("/live/{session_id}/stop")
    def live_stop(session_id: str, request: Request, payload: LiveSessionSyncRequest):
        try:
            return stop_live_session(_req_user_id(request), session_id, payload.elapsed_seconds)
        except Exception as err:
            _raise_as_http(err, "POST /live/{id}/stop")

    # ── Study groups ────────────────────────────────────────────────────────
    @app.post("/groups")
    def groups_create(request: Request, payload: GroupCreateRequest):
        try:
            return create_group(_req_user_id(request), payload.model_dump())
        except Exception as err:
            _raise_as_http(err, "POST /groups")

    @app.get("/groups/search")
    def groups_search(
        request: Request,
        q: str = Query(default=""),
        category: str = Query(default=""),
        limit: int = Query(default=20),
        skip: int = Query(default=0),
    ):
        try:
            return search_groups(_req_user_id(request), q, category, limit, skip)
        except Exception as err:
            _raise_as_http(err, "GET /groups/search")

    @app.get("/groups/mine")
    def groups_mine(request: Request):
        try:
            return list_my_groups(_req_user_id(request))
        except Exception as err:
            _raise_as_http(err, "GET /groups/mine")

    @app.post("/groups/join-by-code")
    def groups_join_by_code(request: Request, payload: GroupJoinByCodeRequest):
        try:
            return join_group_by_code(_req_user_id(request), payload.join_code)
        except Exception as err:
            _raise_as_http(err, "POST /groups/join-by-code")

    @app.post("/groups/{group_id}/join")
    def groups_join(group_id: str, request: Request, payload: GroupJoinRequest):
        try:
            return join_group(_req_user_id(request), group_id, payload.join_code)
        except Exception as err:
            _raise_as_http(err, "POST /groups/{id}/join")

    @app.post("/groups/{group_id}/leave")
    def groups_leave(group_id: str, request: Request):
        try:
            return leave_group(_req_user_id(request), group_id)
        except Exception as err:
            _raise_as_http(err, "POST /groups/{id}/leave")

    @app.get("/groups/{group_id}")
    def groups_get(group_id: str, request: Request):
        try:
            return get_group(_req_user_id(request), group_id)
        except Exception as err:
            _raise_as_http(err, "GET /groups/{id}")

    @app.get("/groups/{group_id}/live-status")
    def groups_live_status(group_id: str, request: Request):
        try:
            return get_group_live_status(_req_user_id(request), group_id)
        except Exception as err:
            _raise_as_http(err, "GET /groups/{id}/live-status")

    @app.get("/groups/{group_id}/members/{member_user_id}/overview")
    def groups_member_overview(group_id: str, member_user_id: str, request: Request, month: str = Query(default="")):
        try:
            return get_member_month_overview(_req_user_id(request), group_id, member_user_id, month)
        except Exception as err:
            _raise_as_http(err, "GET /groups/{id}/members/{id}/overview")

    @app.get("/groups/{group_id}/members/{member_user_id}/day")
    def groups_member_day(group_id: str, member_user_id: str, request: Request, date: str = Query(default="")):
        try:
            return get_member_day_focus(_req_user_id(request), group_id, member_user_id, date)
        except Exception as err:
            _raise_as_http(err, "GET /groups/{id}/members/{id}/day")

    # ── Leaderboard ────────────────────────────────────────────────────────
    @app.get("/leaderboard/group/{group_id}")
    def leaderboard_group(
        group_id: str,
        request: Request,
        period: str = Query(default="week"),
        category: str = Query(default=""),
    ):
        try:
            return group_leaderboard(_req_user_id(request), group_id, period, category)
        except Exception as err:
            _raise_as_http(err, "GET /leaderboard/group/{id}")

    @app.get("/leaderboard/global")
    def leaderboard_global(
        request: Request,
        period: str = Query(default="week"),
        category: str = Query(default=""),
    ):
        try:
            return global_leaderboard(_req_user_id(request), period, category)
        except Exception as err:
            _raise_as_http(err, "GET /leaderboard/global")

    @app.get("/leaderboard/categories")
    def leaderboard_categories(request: Request):
        try:
            return list_leaderboard_categories(_req_user_id(request))
        except Exception as err:
            _raise_as_http(err, "GET /leaderboard/categories")

    # ── Mind Map Studio ───────────────────────────────────────────────────
    @app.get("/mindmaps")
    def mindmaps_list(
        request: Request,
        limit: int = Query(default=5),
        offset: int = Query(default=0),
    ):
        try:
            return list_mindmaps(_req_user_id(request), limit, offset)
        except Exception as err:
            _raise_as_http(err, "GET /mindmaps")

    @app.post("/mindmaps")
    def mindmaps_create(request: Request, payload: MindmapUpsertRequest):
        try:
            return create_mindmap(_req_user_id(request), payload.model_dump())
        except Exception as err:
            _raise_as_http(err, "POST /mindmaps")

    @app.get("/mindmaps/{map_id}")
    def mindmaps_get(map_id: str, request: Request):
        try:
            return get_mindmap(_req_user_id(request), map_id)
        except Exception as err:
            _raise_as_http(err, "GET /mindmaps/{id}")

    @app.put("/mindmaps/{map_id}")
    def mindmaps_update(map_id: str, request: Request, payload: MindmapUpsertRequest):
        try:
            return update_mindmap(_req_user_id(request), map_id, payload.model_dump())
        except Exception as err:
            _raise_as_http(err, "PUT /mindmaps/{id}")

    @app.delete("/mindmaps/{map_id}")
    def mindmaps_delete(map_id: str, request: Request):
        try:
            return delete_mindmap(_req_user_id(request), map_id)
        except Exception as err:
            _raise_as_http(err, "DELETE /mindmaps/{id}")

    # --- Noter (Notion-style docs; content + version history on S3) ---

    @app.get("/noter/docs")
    def noter_docs_list(
        request: Request,
        limit: int = Query(default=100),
        offset: int = Query(default=0),
    ):
        try:
            return noter_list_docs(_req_user_id(request), limit, offset)
        except Exception as err:
            _raise_as_http(err, "GET /noter/docs")

    @app.post("/noter/docs")
    def noter_docs_create(request: Request, payload: NoterCreateRequest):
        try:
            return noter_create_doc(_req_user_id(request), payload.model_dump())
        except Exception as err:
            _raise_as_http(err, "POST /noter/docs")

    @app.get("/noter/docs/{doc_id}")
    def noter_docs_get(doc_id: str, request: Request):
        try:
            return noter_get_doc(_req_user_id(request), doc_id)
        except Exception as err:
            _raise_as_http(err, "GET /noter/docs/{id}")

    @app.put("/noter/docs/{doc_id}")
    def noter_docs_save(doc_id: str, request: Request, payload: NoterSaveRequest):
        try:
            return noter_save_doc(_req_user_id(request), doc_id, payload.model_dump())
        except Exception as err:
            _raise_as_http(err, "PUT /noter/docs/{id}")

    @app.delete("/noter/docs/{doc_id}")
    def noter_docs_delete(doc_id: str, request: Request):
        try:
            return noter_delete_doc(_req_user_id(request), doc_id)
        except Exception as err:
            _raise_as_http(err, "DELETE /noter/docs/{id}")

    @app.get("/noter/docs/{doc_id}/versions")
    def noter_versions_list(doc_id: str, request: Request):
        try:
            return noter_list_versions(_req_user_id(request), doc_id)
        except Exception as err:
            _raise_as_http(err, "GET /noter/docs/{id}/versions")

    @app.post("/noter/docs/{doc_id}/versions")
    def noter_versions_snapshot(doc_id: str, request: Request):
        try:
            return noter_snapshot_doc(_req_user_id(request), doc_id)
        except Exception as err:
            _raise_as_http(err, "POST /noter/docs/{id}/versions")

    @app.get("/noter/docs/{doc_id}/versions/{version_id}")
    def noter_versions_get(doc_id: str, version_id: str, request: Request):
        try:
            return noter_get_version(_req_user_id(request), doc_id, version_id)
        except Exception as err:
            _raise_as_http(err, "GET /noter/docs/{id}/versions/{vid}")

    @app.post("/noter/docs/{doc_id}/restore")
    def noter_versions_restore(doc_id: str, request: Request, payload: NoterRestoreRequest):
        try:
            return noter_restore_version(_req_user_id(request), doc_id, payload.version_id)
        except Exception as err:
            _raise_as_http(err, "POST /noter/docs/{id}/restore")

    @app.post("/noter/docs/{doc_id}/assets/presign")
    def noter_assets_presign(doc_id: str, request: Request, payload: NoterAssetPresignRequest):
        try:
            return noter_presign_asset(_req_user_id(request), doc_id, payload.model_dump())
        except Exception as err:
            _raise_as_http(err, "POST /noter/docs/{id}/assets/presign")

    @app.post("/noter/assets/resolve")
    def noter_assets_resolve(request: Request, payload: NoterAssetResolveRequest):
        try:
            return noter_resolve_asset(_req_user_id(request), payload.key)
        except Exception as err:
            _raise_as_http(err, "POST /noter/assets/resolve")

    # --- Noter directory (folders: create, list, rename, move, copy, duplicate, delete) ---

    @app.get("/noter/folders/tree")
    def noter_folders_tree(request: Request):
        try:
            return noter_folder_tree(_req_user_id(request))
        except Exception as err:
            _raise_as_http(err, "GET /noter/folders/tree")

    @app.post("/noter/folders")
    def noter_folders_create(request: Request, payload: NoterFolderCreateRequest):
        try:
            return noter_create_folder(_req_user_id(request), payload.parent_id, payload.name)
        except Exception as err:
            _raise_as_http(err, "POST /noter/folders")

    @app.get("/noter/items")
    def noter_items_list(
        request: Request,
        folder_id: str = Query(default=""),
        q: str = Query(default=""),
        sort_by: str = Query(default="name"),
        sort_dir: str = Query(default="asc"),
    ):
        try:
            return noter_list_items(_req_user_id(request), folder_id, q, sort_by, sort_dir)
        except Exception as err:
            _raise_as_http(err, "GET /noter/items")

    @app.post("/noter/items/rename")
    def noter_items_rename(request: Request, payload: NoterItemRenameRequest):
        try:
            return noter_rename_item(_req_user_id(request), payload.id, payload.item_type, payload.name)
        except Exception as err:
            _raise_as_http(err, "POST /noter/items/rename")

    @app.post("/noter/items/move")
    def noter_items_move(request: Request, payload: NoterItemMoveRequest):
        try:
            return noter_move_item(_req_user_id(request), payload.id, payload.item_type, payload.destination_folder_id)
        except Exception as err:
            _raise_as_http(err, "POST /noter/items/move")

    @app.post("/noter/items/copy")
    def noter_items_copy(request: Request, payload: NoterItemCopyRequest):
        try:
            return noter_copy_item(_req_user_id(request), payload.id, payload.item_type, payload.destination_folder_id)
        except Exception as err:
            _raise_as_http(err, "POST /noter/items/copy")

    @app.post("/noter/items/duplicate")
    def noter_items_duplicate(request: Request, payload: NoterItemDuplicateRequest):
        try:
            return noter_duplicate_item(_req_user_id(request), payload.id, payload.item_type)
        except Exception as err:
            _raise_as_http(err, "POST /noter/items/duplicate")

    @app.post("/noter/items/delete")
    def noter_items_delete(request: Request, payload: NoterItemDeleteRequest):
        try:
            return noter_delete_item(_req_user_id(request), payload.id, payload.item_type, payload.recursive)
        except Exception as err:
            _raise_as_http(err, "POST /noter/items/delete")

    # --- Razorpay payments ---

    @app.post("/payments/create-order")
    def payments_create_order(request: Request, payload: CreateOrderRequest):
        try:
            return create_order_payload(
                payload.amount,
                payload.currency,
                payload.receipt,
                notes=payload.notes,
                user_id=_require_auth(request),
            )
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "POST /payments/create-order")

    @app.post("/payments/verify")
    def payments_verify(request: Request, payload: VerifyPaymentRequest):
        try:
            return verify_payment_payload(
                payload.razorpay_order_id,
                payload.razorpay_payment_id,
                payload.razorpay_signature,
                user_id=_require_auth(request),
            )
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "POST /payments/verify")

    @app.get("/payments/credits")
    def payments_credits(request: Request):
        try:
            return credit_balance_payload(_require_auth(request))
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "GET /payments/credits")

    @app.post("/razorpay/webhook")
    async def razorpay_webhook(request: Request):
        # Razorpay calls this with no X-API-Key — the HMAC signature check below is its
        # authentication. Must read the raw body (not a parsed Pydantic model): signature
        # verification is over the exact bytes Razorpay sent.
        try:
            raw_body = await request.body()
            signature = request.headers.get("X-Razorpay-Signature", "")
            return verify_webhook_payload(raw_body, signature)
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "POST /razorpay/webhook")

    @app.post("/contact")
    def contact(payload: ContactRequest):
        try:
            return send_contact_message(payload.name, payload.email, payload.message, payload.subject)
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "POST /contact")

    @app.get("/")
    def health():
        return {"ok": True, "service": "kapil-divya-race-api"}

    return app


app = create_app()
handler = Mangum(app)
