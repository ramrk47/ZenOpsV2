"""System configuration utilities."""
from __future__ import annotations

from typing import Optional

from sqlalchemy.orm import Session

from app.models.support import SystemConfig


def get_config(db: Session, key: str, default: Optional[str] = None) -> Optional[str]:
    """Get a system configuration value."""
    config = db.query(SystemConfig).filter(SystemConfig.config_key == key).first()
    return config.config_value if config else default


def set_config(db: Session, key: str, value: str, *, is_public: bool = False, description: Optional[str] = None) -> SystemConfig:
    """Set a system configuration value."""
    config = db.query(SystemConfig).filter(SystemConfig.config_key == key).first()
    
    if config:
        config.config_value = value
        if description:
            config.description = description
    else:
        config = SystemConfig(
            config_key=key,
            config_value=value,
            is_public=is_public,
            description=description,
        )
        db.add(config)
    
    db.flush()
    return config


def get_public_configs(db: Session) -> dict[str, str]:
    """Get all public system configurations."""
    configs = db.query(SystemConfig).filter(SystemConfig.is_public == True).all()
    return {config.config_key: config.config_value for config in configs}


def get_whatsapp_number(db: Session) -> str:
    """Get WhatsApp number for click-to-chat."""
    return get_config(db, "WHATSAPP_NUMBER", default="917975357599") or "917975357599"


def get_ops_support_email(db: Session) -> Optional[str]:
    """Get ops support email address."""
    return get_config(db, "OPS_SUPPORT_EMAIL")


def is_support_bubble_enabled(db: Session) -> bool:
    """Check if WhatsApp support bubble is enabled."""
    value = get_config(db, "SUPPORT_BUBBLE_ENABLED", default="true")
    return value.lower() in {"true", "1", "yes", "enabled"}
