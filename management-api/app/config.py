"""管理 API 的环境配置和固定参数。"""

import os
from pathlib import Path


APP_NAME = os.getenv("APP_NAME", "GoTap Management API")
JWT_SECRET = os.getenv("JWT_SECRET", "")
if len(JWT_SECRET) < 32:
    raise RuntimeError("JWT_SECRET 必须至少包含 32 个字符")

_configured_db_path = os.getenv("DB_PATH")
if _configured_db_path:
    DB_PATH = Path(_configured_db_path)
else:
    _gotap_db_path = Path("/data/gotap.sqlite3")
    _legacy_db_path = Path("/data/goyou.sqlite3")
    # 未显式指定数据库时，兼容已有的旧数据库部署。
    DB_PATH = _legacy_db_path if _legacy_db_path.exists() and not _gotap_db_path.exists() else _gotap_db_path

DB_BACKUP_DIR = Path(os.getenv("DB_BACKUP_DIR", str(DB_PATH.parent / "backups")))
USAGE_REPORT_RETENTION_DAYS = max(1, int(os.getenv("USAGE_REPORT_RETENTION_DAYS", "90")))
DB_BACKUP_INTERVAL_SECONDS = max(3600, int(os.getenv("DB_BACKUP_INTERVAL_SECONDS", str(24 * 3600))))
DB_BACKUP_RETENTION_DAYS = max(1, int(os.getenv("DB_BACKUP_RETENTION_DAYS", "7")))
DB_BUSY_TIMEOUT_MS = max(1000, int(os.getenv("DB_BUSY_TIMEOUT_MS", "5000")))
ACCESS_TOKEN_MINUTES = int(os.getenv("ACCESS_TOKEN_MINUTES", "240"))
REFRESH_TOKEN_DAYS = int(os.getenv("REFRESH_TOKEN_DAYS", "30"))

RELAY_HOST = os.getenv("RELAY_HOST", "relay.123371.com")
RELAY_PORT = int(os.getenv("RELAY_PORT", "24443"))
RELAY_PORT_START = int(os.getenv("RELAY_PORT_START", "30000"))
RELAY_PORT_END = int(os.getenv("RELAY_PORT_END", "39999"))
RELAY_METHOD = os.getenv("RELAY_METHOD", "chacha20-ietf-poly1305")
RELAY_PASSWORD = os.getenv("RELAY_PASSWORD", "")
DEFAULT_RELAY_ID = "default"
RELAY_HEARTBEAT_TIMEOUT_SECONDS = max(
    10, min(int(os.getenv("RELAY_HEARTBEAT_TIMEOUT_SECONDS", "30")), 300)
)

DEFAULT_DAILY_QUOTA_BYTES = int(os.getenv("DEFAULT_DAILY_QUOTA_BYTES", "1000000000"))
DEFAULT_ACCOUNT_VALID_DAYS = int(os.getenv("DEFAULT_ACCOUNT_VALID_DAYS", "365"))
QUOTA_TIMEZONE = os.getenv("QUOTA_TIMEZONE", "Asia/Shanghai")
MONTHLY_TRAFFIC_QUOTA_BYTES = 1_000_000_000_000
METERING_TOKEN = os.getenv("METERING_TOKEN", "").strip()

UPDATE_GITHUB_REPOSITORY = os.getenv("UPDATE_GITHUB_REPOSITORY", "zzktz/gotap").strip()
# 仅为 GitHub API 和更新包下载配置独立代理。
GITHUB_PROXY_URL = os.getenv("GITHUB_PROXY_URL", "").strip()
UPDATE_STORAGE_DIR = Path(os.getenv("UPDATE_STORAGE_DIR", str(DB_PATH.parent / "updates")))
UPDATE_MAX_ASSET_BYTES = int(os.getenv("UPDATE_MAX_ASSET_BYTES", "2000000000"))
RELEASE_RETENTION_COUNT = 3
UPDATE_PLATFORMS = ("windows-x86_64", "darwin-aarch64", "darwin-x86_64")
UPDATE_PUBLIC_BASE_URL = os.getenv("UPDATE_PUBLIC_BASE_URL", "https://gotap.123371.com").rstrip("/")

FEEDBACK_STORAGE_DIR = Path(os.getenv("FEEDBACK_STORAGE_DIR", str(DB_PATH.parent / "feedback")))
FEEDBACK_MAX_IMAGES = 3
FEEDBACK_MAX_IMAGE_BYTES = 5 * 1024 * 1024

DOCUMENT_CONVERSION_STORAGE_DIR = Path(
    os.getenv("DOCUMENT_CONVERSION_STORAGE_DIR", str(DB_PATH.parent / "conversions"))
)
DOCUMENT_CONVERSION_MAX_FILE_BYTES = max(
    1024 * 1024, int(os.getenv("DOCUMENT_CONVERSION_MAX_FILE_BYTES", str(50 * 1024 * 1024)))
)
DOCUMENT_CONVERSION_RETENTION_DAYS = max(
    1, int(os.getenv("DOCUMENT_CONVERSION_RETENTION_DAYS", "7"))
)
DOCUMENT_CONVERSION_TIMEOUT_SECONDS = max(
    30, int(os.getenv("DOCUMENT_CONVERSION_TIMEOUT_SECONDS", "120"))
)

ADMIN_EMAIL = os.getenv("ADMIN_EMAIL", "").strip().lower()
ADMIN_NAME = os.getenv("ADMIN_NAME", "GoTap 管理员").strip() or "GoTap 管理员"
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "")
ADMIN_PASSWORD_HASH = os.getenv("ADMIN_PASSWORD_HASH", "")

SMTP_HOST = os.getenv("SMTP_HOST", "").strip()
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USERNAME = os.getenv("SMTP_USERNAME", "").strip()
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "")
SMTP_FROM = os.getenv("SMTP_FROM", SMTP_USERNAME or "").strip()
SMTP_USE_SSL = os.getenv("SMTP_USE_SSL", "0").strip().lower() in {"1", "true", "yes"}
SMTP_STARTTLS = os.getenv("SMTP_STARTTLS", "1").strip().lower() in {"1", "true", "yes"}

VERIFICATION_CODE_EXPIRE_MINUTES = 10
VERIFICATION_CODE_COOLDOWN_SECONDS = 60
VERIFICATION_CODE_MAX_ATTEMPTS = 5

REGISTRATION_SETTING_KEY = "registration_enabled"
DEFAULT_ACCOUNT_VALID_DAYS_SETTING_KEY = "default_account_valid_days"
ADMIN_EMAIL_SETTING_KEY = "admin_email"
ADMIN_NAME_SETTING_KEY = "admin_name"
ADMIN_PASSWORD_HASH_SETTING_KEY = "admin_password_hash"
