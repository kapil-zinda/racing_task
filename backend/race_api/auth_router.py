from fastapi import APIRouter
from pydantic import BaseModel

from . import auth_service

router = APIRouter(prefix="/auth", tags=["auth"])


class SignupRequest(BaseModel):
    email: str
    name: str
    phone: str
    password: str


class VerifyOtpRequest(BaseModel):
    email: str
    otp: str


class ResendOtpRequest(BaseModel):
    email: str
    purpose: str = "signup"


class SigninRequest(BaseModel):
    email: str
    password: str


class ForgotPasswordRequest(BaseModel):
    email: str


class ResetPasswordRequest(BaseModel):
    email: str
    otp: str
    new_password: str


def _raise_http(err: Exception):
    from fastapi import HTTPException

    if isinstance(err, ValueError):
        raise HTTPException(status_code=400, detail=str(err))
    if isinstance(err, LookupError):
        raise HTTPException(status_code=404, detail=str(err))
    raise HTTPException(status_code=500, detail=f"Internal error: {err}")


@router.post("/signup")
def signup(payload: SignupRequest):
    try:
        return auth_service.signup(payload.email, payload.name, payload.phone, payload.password)
    except Exception as err:
        _raise_http(err)


@router.post("/verify-otp")
def verify_otp(payload: VerifyOtpRequest):
    try:
        return auth_service.verify_otp(payload.email, payload.otp)
    except Exception as err:
        _raise_http(err)


@router.post("/resend-otp")
def resend_otp(payload: ResendOtpRequest):
    try:
        return auth_service.resend_otp(payload.email, payload.purpose)
    except Exception as err:
        _raise_http(err)


@router.post("/signin")
def signin(payload: SigninRequest):
    try:
        return auth_service.signin(payload.email, payload.password)
    except Exception as err:
        _raise_http(err)


@router.post("/forgot-password")
def forgot_password(payload: ForgotPasswordRequest):
    try:
        return auth_service.forgot_password(payload.email)
    except Exception as err:
        _raise_http(err)


@router.post("/reset-password")
def reset_password(payload: ResetPasswordRequest):
    try:
        return auth_service.reset_password(payload.email, payload.otp, payload.new_password)
    except Exception as err:
        _raise_http(err)
