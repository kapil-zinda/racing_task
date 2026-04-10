from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from mangum import Mangum

from .constants import PLAYERS, POINTS_MAP
from .context import logger
from .race_domain import (
    add_points_payload,
    build_syllabus_payload,
    get_days_payload,
    get_state_payload,
    reset_race_payload,
)
from .schemas import (
    AddPointsRequest,
    CreateSessionRequest,
    MultipartAbortRequest,
    MultipartCompleteRequest,
    MultipartPartRequest,
    MultipartStartRequest,
    PresignRequest,
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

    @app.post("/points")
    def add_points(payload: AddPointsRequest):
        try:
            if payload.player_id not in PLAYERS:
                raise HTTPException(status_code=400, detail="Unknown player_id")
            if payload.action_type not in POINTS_MAP:
                raise HTTPException(status_code=400, detail="Unknown action_type")
            return add_points_payload(payload.player_id, payload.action_type, payload.test_type, payload.detail)
        except Exception as err:  # noqa: BLE001
            _raise_as_http(err, "POST /points")

    @app.post("/reset")
    def reset_race():
        try:
            return reset_race_payload()
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
            return update_session_status_payload(session_id, payload)
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
