"""管理 API 的请求数据模型。"""

from pydantic import BaseModel, EmailStr, Field

from .config import DEFAULT_ACCOUNT_VALID_DAYS, DEFAULT_DAILY_QUOTA_BYTES, FEEDBACK_MAX_IMAGES, RELAY_METHOD


class RegisterRequest(BaseModel):
    email: EmailStr
    verification_code: str = Field(pattern=r"^\d{6}$")
    password: str = Field(min_length=8, max_length=128)
    name: str = Field(default="", max_length=10, pattern=r"^[A-Za-z\u4e00-\u9fff]*$")


class SendVerificationCodeRequest(BaseModel):
    email: EmailStr


class PasswordResetRequest(BaseModel):
    email: EmailStr
    verification_code: str = Field(pattern=r"^\d{6}$")
    password: str = Field(min_length=8, max_length=128)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


class RefreshRequest(BaseModel):
    refresh_token: str = Field(min_length=20)


class ProfileUpdateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=80)


class DeviceRequest(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    platform: str = Field(default="desktop", max_length=40)


class LeaseRequest(BaseModel):
    device_id: str | None = Field(default=None, max_length=100)


class LeaseRefreshRequest(BaseModel):
    lease_id: str = Field(min_length=8, max_length=100)


class FeedbackScreenshotRequest(BaseModel):
    filename: str = Field(default="screenshot", max_length=255)
    data: str = Field(min_length=1, max_length=7_000_000)


class FeedbackCreateRequest(BaseModel):
    message: str = Field(min_length=1, max_length=5000)
    screenshots: list[FeedbackScreenshotRequest] = Field(default_factory=list, max_length=FEEDBACK_MAX_IMAGES)


class AdminFeedbackReplyRequest(BaseModel):
    reply: str = Field(min_length=1, max_length=5000)


class AdminLoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


class AdminSettingsUpdateRequest(BaseModel):
    registration_enabled: bool | None = None
    default_account_valid_days: int | None = Field(default=None, ge=0, le=3650)


class AdminProfileUpdateRequest(BaseModel):
    current_password: str = Field(min_length=1, max_length=128)
    email: EmailStr | None = None
    name: str | None = Field(default=None, min_length=1, max_length=80)
    new_password: str | None = Field(default=None, min_length=8, max_length=128)


class AdminUserStatusRequest(BaseModel):
    enabled: bool


class AdminCreateUserRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    name: str = Field(default="", max_length=80)
    account_expires_at: str | None = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")
    daily_limit_bytes: int = Field(default=DEFAULT_DAILY_QUOTA_BYTES, ge=0, le=10_000_000_000_000)


class AdminQuotaRequest(BaseModel):
    daily_limit_bytes: int = Field(ge=0, le=10_000_000_000_000)


class AdminAccountExpiryRequest(BaseModel):
    account_expires_at: str | None = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")


class AdminRelayCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    host: str = Field(min_length=1, max_length=255)
    port_start: int = Field(default=30000, ge=1, le=65535)
    port_end: int = Field(default=39999, ge=1, le=65535)
    method: str = Field(default=RELAY_METHOD, min_length=1, max_length=100)
    legacy_port: int = Field(default=0, ge=0, le=65535)
    region: str = Field(default="", max_length=80)
    weight: int = Field(default=100, ge=1, le=1000)
    enabled: bool = True


class AdminRelayUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    host: str | None = Field(default=None, min_length=1, max_length=255)
    port_start: int | None = Field(default=None, ge=1, le=65535)
    port_end: int | None = Field(default=None, ge=1, le=65535)
    method: str | None = Field(default=None, min_length=1, max_length=100)
    legacy_port: int | None = Field(default=None, ge=0, le=65535)
    region: str | None = Field(default=None, max_length=80)
    weight: int | None = Field(default=None, ge=1, le=1000)
    enabled: bool | None = None
    draining: bool | None = None
    regenerate_token: bool = False


class AdminReleaseCreateRequest(BaseModel):
    version: str = Field(pattern=r"^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$", max_length=64)
    notes: str = Field(default="", max_length=10000)


class AdminReleaseUpdateRequest(BaseModel):
    notes: str = Field(default="", max_length=10000)


class AdminReleaseImportRequest(BaseModel):
    notes: str | None = Field(default=None, max_length=10000)


class UsageReportRequest(BaseModel):
    report_id: str = Field(min_length=8, max_length=200)
    user_id: str = Field(min_length=1, max_length=100)
    lease_id: str | None = Field(default=None, max_length=100)
    connection_id: str | None = Field(default=None, max_length=200)
    target_host: str | None = Field(default=None, max_length=255)
    target_port: int | None = Field(default=None, ge=1, le=65535)
    upload_bytes: int = Field(default=0, ge=0, le=10_000_000_000_000)
    download_bytes: int = Field(default=0, ge=0, le=10_000_000_000_000)


class RelayHeartbeatRequest(BaseModel):
    process_running: bool
    listen_ports: list[int] = Field(default_factory=list, max_length=20_000)
    duplicate_ports: list[int] = Field(default_factory=list, max_length=20_000)
    lease_count: int = Field(default=0, ge=0, le=20_000)
    error: str | None = Field(default=None, max_length=2000)
