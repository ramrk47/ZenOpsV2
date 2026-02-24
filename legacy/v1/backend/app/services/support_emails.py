"""Email templates for support system events."""
from __future__ import annotations

from typing import Optional

from sqlalchemy.orm import Session

from app.models.support import SupportMessage, SupportThread
from app.models.user import User
from app.services.email_delivery import create_email_delivery


def send_support_thread_created_email(
    db: Session,
    *,
    thread: SupportThread,
    recipient_email: str,
    recipient_name: Optional[str] = None,
) -> None:
    """Send email when a new support thread is created."""
    
    subject = f"New Support Request: {thread.subject}"
    
    thread_url = f"https://yourapp.com/support/threads/{thread.id}"  # TODO: Make configurable
    
    html = f"""
    <html>
      <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
        <h2 style="color: #2563eb;">New Support Request</h2>
        
        <p>Hello {recipient_name or 'there'},</p>
        
        <p>A new support request has been created:</p>
        
        <div style="background-color: #f3f4f6; padding: 16px; border-radius: 8px; margin: 20px 0;">
          <strong>Subject:</strong> {thread.subject}<br>
          <strong>Priority:</strong> {thread.priority.value}<br>
          <strong>Status:</strong> {thread.status.value}<br>
          {f'<strong>Assignment:</strong> #{thread.assignment_id}<br>' if thread.assignment_id else ''}
        </div>
        
        <p>
          <a href="{thread_url}" 
             style="display: inline-block; background-color: #2563eb; color: white; 
                    padding: 12px 24px; text-decoration: none; border-radius: 6px; 
                    font-weight: bold;">
            View Thread
          </a>
        </p>
        
        <p style="color: #6b7280; font-size: 14px; margin-top: 30px;">
          This is an automated notification from Zen Ops Support System.
        </p>
      </body>
    </html>
    """
    
    text = f"""
    New Support Request
    
    Hello {recipient_name or 'there'},
    
    A new support request has been created:
    
    Subject: {thread.subject}
    Priority: {thread.priority.value}
    Status: {thread.status.value}
    {'Assignment: #' + str(thread.assignment_id) if thread.assignment_id else ''}
    
    View thread: {thread_url}
    
    ---
    This is an automated notification from Zen Ops Support System.
    """
    
    create_email_delivery(
        db,
        event_type="SUPPORT_THREAD_CREATED",
        to_email=recipient_email,
        subject=subject,
        html=html,
        text=text,
        idempotency_key=f"support_thread_created_{thread.id}_{recipient_email}",
        payload={
            "thread_id": thread.id,
            "assignment_id": thread.assignment_id,
        },
    )


def send_support_message_email(
    db: Session,
    *,
    message: SupportMessage,
    thread: SupportThread,
    recipient_email: str,
    recipient_name: Optional[str] = None,
) -> None:
    """Send email when a new message is added to a support thread."""
    
    subject = f"New Reply: {thread.subject}"
    
    thread_url = f"https://yourapp.com/support/threads/{thread.id}"  # TODO: Make configurable
    
    author_label = message.author_label or "Unknown"
    
    html = f"""
    <html>
      <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
        <h2 style="color: #2563eb;">New Reply to Support Request</h2>
        
        <p>Hello {recipient_name or 'there'},</p>
        
        <p><strong>{author_label}</strong> replied to: <em>{thread.subject}</em></p>
        
        <div style="background-color: #f3f4f6; padding: 16px; border-radius: 8px; margin: 20px 0; 
                    border-left: 4px solid #2563eb;">
          <p style="margin: 0; white-space: pre-wrap;">{message.message_text[:500]}</p>
          {f'<p style="margin-top: 10px; color: #6b7280; font-size: 14px;">... (message truncated)</p>' if len(message.message_text) > 500 else ''}
        </div>
        
        <p>
          <a href="{thread_url}" 
             style="display: inline-block; background-color: #2563eb; color: white; 
                    padding: 12px 24px; text-decoration: none; border-radius: 6px; 
                    font-weight: bold;">
            View Full Thread
          </a>
        </p>
        
        <p style="color: #6b7280; font-size: 14px; margin-top: 30px;">
          This is an automated notification from Zen Ops Support System.
        </p>
      </body>
    </html>
    """
    
    text = f"""
    New Reply to Support Request
    
    Hello {recipient_name or 'there'},
    
    {author_label} replied to: {thread.subject}
    
    ---
    {message.message_text[:500]}
    {'... (message truncated)' if len(message.message_text) > 500 else ''}
    ---
    
    View full thread: {thread_url}
    
    ---
    This is an automated notification from Zen Ops Support System.
    """
    
    create_email_delivery(
        db,
        event_type="SUPPORT_MESSAGE_CREATED",
        to_email=recipient_email,
        subject=subject,
        html=html,
        text=text,
        idempotency_key=f"support_message_{message.id}_{recipient_email}",
        payload={
            "message_id": message.id,
            "thread_id": thread.id,
            "assignment_id": thread.assignment_id,
        },
    )


def send_support_thread_resolved_email(
    db: Session,
    *,
    thread: SupportThread,
    recipient_email: str,
    recipient_name: Optional[str] = None,
    resolved_by: Optional[User] = None,
) -> None:
    """Send email when a support thread is resolved."""
    
    subject = f"Resolved: {thread.subject}"
    
    thread_url = f"https://yourapp.com/support/threads/{thread.id}"  # TODO: Make configurable
    
    resolved_by_name = resolved_by.full_name or resolved_by.email if resolved_by else "Support team"
    
    html = f"""
    <html>
      <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
        <h2 style="color: #10b981;">Support Request Resolved</h2>
        
        <p>Hello {recipient_name or 'there'},</p>
        
        <p>Your support request has been resolved:</p>
        
        <div style="background-color: #f3f4f6; padding: 16px; border-radius: 8px; margin: 20px 0;">
          <strong>Subject:</strong> {thread.subject}<br>
          <strong>Status:</strong> <span style="color: #10b981; font-weight: bold;">RESOLVED</span><br>
          <strong>Resolved by:</strong> {resolved_by_name}
        </div>
        
        <p>If you have any additional questions or if this issue persists, please reply to this thread or create a new support request.</p>
        
        <p>
          <a href="{thread_url}" 
             style="display: inline-block; background-color: #10b981; color: white; 
                    padding: 12px 24px; text-decoration: none; border-radius: 6px; 
                    font-weight: bold;">
            View Thread
          </a>
        </p>
        
        <p style="color: #6b7280; font-size: 14px; margin-top: 30px;">
          This is an automated notification from Zen Ops Support System.
        </p>
      </body>
    </html>
    """
    
    text = f"""
    Support Request Resolved
    
    Hello {recipient_name or 'there'},
    
    Your support request has been resolved:
    
    Subject: {thread.subject}
    Status: RESOLVED
    Resolved by: {resolved_by_name}
    
    If you have any additional questions or if this issue persists, please reply to this thread or create a new support request.
    
    View thread: {thread_url}
    
    ---
    This is an automated notification from Zen Ops Support System.
    """
    
    create_email_delivery(
        db,
        event_type="SUPPORT_THREAD_RESOLVED",
        to_email=recipient_email,
        subject=subject,
        html=html,
        text=text,
        idempotency_key=f"support_thread_resolved_{thread.id}_{recipient_email}",
        payload={
            "thread_id": thread.id,
            "assignment_id": thread.assignment_id,
            "resolved_by_user_id": resolved_by.id if resolved_by else None,
        },
    )
