from __future__ import annotations

import smtplib
from dataclasses import dataclass
from email.message import EmailMessage
from typing import Optional

import httpx

from app.core.settings import settings


@dataclass
class EmailSendResult:
    provider: str
    message_id: Optional[str] = None


class EmailSendError(RuntimeError):
    pass


def send_email(*, to_address: str, subject: str, html: str, text: str | None = None) -> EmailSendResult:
    provider = (settings.email_provider or "disabled").lower()
    if provider in {"disabled", "none"}:
        raise EmailSendError("EMAIL_PROVIDER disabled")
    if not settings.email_from:
        raise EmailSendError("EMAIL_FROM not configured")

    if provider == "resend":
        return _send_resend(to_address=to_address, subject=subject, html=html, text=text)
    if provider == "postmark":
        return _send_postmark(to_address=to_address, subject=subject, html=html, text=text)
    if provider == "smtp":
        return _send_smtp(to_address=to_address, subject=subject, html=html, text=text)

    raise EmailSendError(f"Unsupported EMAIL_PROVIDER: {settings.email_provider}")


def _send_resend(*, to_address: str, subject: str, html: str, text: str | None) -> EmailSendResult:
    if not settings.email_api_key:
        raise EmailSendError("EMAIL_API_KEY not configured for Resend")
    payload = {
        "from": settings.email_from,
        "to": [to_address],
        "subject": subject,
        "html": html,
    }
    if text:
        payload["text"] = text
    headers = {
        "Authorization": f"Bearer {settings.email_api_key}",
        "Content-Type": "application/json",
    }
    with httpx.Client(timeout=15) as client:
        resp = client.post("https://api.resend.com/emails", json=payload, headers=headers)
    if resp.status_code >= 400:
        raise EmailSendError(f"Resend error: {resp.status_code} {resp.text}")
    data = resp.json()
    return EmailSendResult(provider="resend", message_id=data.get("id"))


def _send_postmark(*, to_address: str, subject: str, html: str, text: str | None) -> EmailSendResult:
    if not settings.email_api_key:
        raise EmailSendError("EMAIL_API_KEY not configured for Postmark")
    payload = {
        "From": settings.email_from,
        "To": to_address,
        "Subject": subject,
        "HtmlBody": html,
    }
    if text:
        payload["TextBody"] = text
    headers = {
        "X-Postmark-Server-Token": settings.email_api_key,
        "Content-Type": "application/json",
    }
    with httpx.Client(timeout=15) as client:
        resp = client.post("https://api.postmarkapp.com/email", json=payload, headers=headers)
    if resp.status_code >= 400:
        raise EmailSendError(f"Postmark error: {resp.status_code} {resp.text}")
    data = resp.json()
    return EmailSendResult(provider="postmark", message_id=data.get("MessageID"))


def _send_smtp(*, to_address: str, subject: str, html: str, text: str | None) -> EmailSendResult:
    if not settings.smtp_host:
        raise EmailSendError("SMTP_HOST not configured")
    message = EmailMessage()
    message["Subject"] = subject
    message["From"] = settings.email_from
    message["To"] = to_address
    message.set_content(text or "This email requires an HTML-capable client.")
    message.add_alternative(html, subtype="html")

    if settings.smtp_use_tls:
        server = smtplib.SMTP(settings.smtp_host, settings.smtp_port)
        server.starttls()
    else:
        server = smtplib.SMTP(settings.smtp_host, settings.smtp_port)
    if settings.smtp_username and settings.smtp_password:
        server.login(settings.smtp_username, settings.smtp_password)
    server.send_message(message)
    server.quit()
    return EmailSendResult(provider="smtp")
