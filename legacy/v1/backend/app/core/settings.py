from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import List

from pydantic import AliasChoices, Field, field_validator
from pydantic_settings import BaseSettings, DotEnvSettingsSource, EnvSettingsSource, SettingsConfigDict


class _FallbackEnvSettingsSource(EnvSettingsSource):
    """Allow ALLOW_ORIGINS to be comma-separated instead of strict JSON."""

    def decode_complex_value(self, field_name, field, value):  # type: ignore[override]
        try:
            return super().decode_complex_value(field_name, field, value)
        except json.JSONDecodeError:
            if field_name == "allow_origins":
                return value
            raise


class _FallbackDotEnvSettingsSource(DotEnvSettingsSource):
    """Allow ALLOW_ORIGINS to be comma-separated instead of strict JSON."""

    def decode_complex_value(self, field_name, field, value):  # type: ignore[override]
        try:
            return super().decode_complex_value(field_name, field, value)
        except json.JSONDecodeError:
            if field_name == "allow_origins":
                return value
            raise


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    project_name: str = "Zen Ops API"
    project_version: str = "1.0.0"
    environment: str = Field(
        default="development",
        description="Deployment environment name",
        validation_alias=AliasChoices("ENV", "ENVIRONMENT"),
    )
    allow_destructive_actions: bool = Field(
        default=False,
        description="Allow destructive actions (deletes, resets) in production.",
        validation_alias=AliasChoices("ALLOW_DESTRUCTIVE_ACTIONS", "DESTRUCTIVE_ACTIONS_ALLOWED"),
    )
    git_sha: str | None = Field(default=None, description="Git SHA for /version")
    build_version: str | None = Field(default=None, description="Build identifier")
    log_level: str = Field(default="INFO", description="Logging level")

    # Database
    database_url: str = Field(
        default="postgresql+psycopg2://postgres@localhost:5432/zenops",
        description="SQLAlchemy database URL",
    )

    # Auth / JWT
    jwt_secret: str = Field(default="change_me", description="JWT signing secret")
    algorithm: str = Field(default="HS256", description="JWT signing algorithm")
    access_token_expire_minutes: int = Field(default=60, description="Access token expiry in minutes")
    login_max_attempts: int = Field(default=10, description="Login attempts allowed per window")
    login_window_minutes: int = Field(default=15, description="Login rate limit window in minutes")

    # Session management
    idle_timeout_admin_minutes: int = Field(default=30, description="Idle timeout for admin roles (minutes)")
    idle_timeout_employee_minutes: int = Field(default=120, description="Idle timeout for employee roles (minutes)")
    absolute_session_lifetime_hours: int = Field(default=12, description="Max session lifetime regardless of activity (hours)")

    # CORS
    allow_origins: List[str] = Field(
        default_factory=lambda: [
            "http://localhost",
            "http://localhost:5173",
            "http://127.0.0.1:5173",
        ]
    )

    # Storage
    uploads_dir: str = Field(
        default="./uploads",
        description="Directory for uploaded documents",
        validation_alias=AliasChoices("UPLOAD_DIR", "UPLOADS_DIR"),
    )

    backup_dir: str = Field(
        default="./deploy/backups",
        description="Directory where backup artifacts are stored",
        validation_alias=AliasChoices("BACKUP_DIR", "BACKUPS_DIR"),
    )
    backup_admin_pin: str | None = Field(
        default=None,
        description="Secondary PIN required to trigger backups from the UI",
        validation_alias=AliasChoices("BACKUP_ADMIN_PIN", "BACKUP_PIN"),
    )

    # Email delivery
    app_base_url: str = Field(
        default="http://localhost:5173",
        description="Base URL for portal links in emails",
        validation_alias=AliasChoices("APP_BASE_URL", "FRONTEND_BASE_URL"),
    )
    email_provider: str = Field(
        default="disabled",
        description="Email provider: resend, postmark, smtp, disabled",
        validation_alias=AliasChoices("EMAIL_PROVIDER"),
    )
    email_api_key: str | None = Field(
        default=None,
        description="API key for Resend/Postmark",
        validation_alias=AliasChoices("EMAIL_API_KEY"),
    )
    email_from: str | None = Field(
        default=None,
        description="From address for outbound email",
        validation_alias=AliasChoices("EMAIL_FROM"),
    )
    email_max_attempts: int = Field(default=3, description="Max delivery attempts per email")
    email_retry_minutes: int = Field(default=5, description="Minutes between delivery retries")
    email_dedupe_minutes: int = Field(default=60, description="Deduplicate identical emails within minutes")
    email_daily_limit: int = Field(default=20, description="Max emails per user per day")

    smtp_host: str | None = Field(default=None, description="SMTP host")
    smtp_port: int = Field(default=587, description="SMTP port")
    smtp_username: str | None = Field(default=None, description="SMTP username")
    smtp_password: str | None = Field(default=None, description="SMTP password")
    smtp_use_tls: bool = Field(default=True, description="Use TLS for SMTP")

    # DB pool tuning (Postgres)
    db_pool_size: int = Field(default=5, description="Base DB connection pool size")
    db_max_overflow: int = Field(default=10, description="Additional DB connections beyond pool size")
    db_pool_timeout: int = Field(default=30, description="Seconds to wait for a DB connection")
    db_pool_recycle: int = Field(default=1800, description="Recycle DB connections after N seconds")

    # V1 -> V2 billing handshake
    studio_base_url: str | None = Field(
        default=None,
        description="V2 Studio API base URL for billing handshake",
        validation_alias=AliasChoices("STUDIO_BASE_URL"),
    )
    studio_service_token: str | None = Field(
        default=None,
        description="Service token used by V1 when calling V2 billing endpoints",
        validation_alias=AliasChoices("STUDIO_SERVICE_TOKEN"),
    )
    default_billing_mode: str = Field(
        default="POSTPAID",
        description="Fallback billing mode when Studio lookup is unavailable",
        validation_alias=AliasChoices("DEFAULT_BILLING_MODE"),
    )
    studio_http_timeout_seconds: float = Field(
        default=5.0,
        description="Timeout for V1->V2 Studio billing HTTP requests",
        validation_alias=AliasChoices("STUDIO_HTTP_TIMEOUT_SECONDS"),
    )
    studio_status_cache_seconds: int = Field(
        default=45,
        description="TTL for cached V2 billing status lookups in V1",
        validation_alias=AliasChoices("STUDIO_STATUS_CACHE_SECONDS"),
    )

    @field_validator("allow_origins", mode="before")
    @classmethod
    def parse_allow_origins(cls, value: str | List[str]) -> List[str]:
        if isinstance(value, list):
            return value
        if isinstance(value, str) and value.strip():
            return [origin.strip() for origin in value.split(",") if origin.strip()]
        return [
            "http://localhost",
            "http://localhost:5173",
            "http://127.0.0.1:5173",
        ]

    @field_validator("default_billing_mode")
    @classmethod
    def normalize_default_billing_mode(cls, value: str) -> str:
        mode = (value or "").strip().upper()
        if mode not in {"POSTPAID", "CREDIT"}:
            return "POSTPAID"
        return mode

    def ensure_uploads_dir(self) -> Path:
        uploads_path = Path(self.uploads_dir).expanduser().resolve()
        uploads_path.mkdir(parents=True, exist_ok=True)
        return uploads_path

    @property
    def destructive_actions_enabled(self) -> bool:
        if self.environment.lower() in ("production", "prod"):
            return bool(self.allow_destructive_actions)
        return True

    @classmethod
    def settings_customise_sources(
        cls,
        settings_cls,
        init_settings,
        env_settings,
        dotenv_settings,
        file_secret_settings,
    ):
        return (
            init_settings,
            _FallbackEnvSettingsSource(settings_cls),
            _FallbackDotEnvSettingsSource(settings_cls),
            file_secret_settings,
        )


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    settings = Settings()
    settings.ensure_uploads_dir()
    return settings


settings = get_settings()
