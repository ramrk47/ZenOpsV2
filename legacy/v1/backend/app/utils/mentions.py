"""Utility functions for parsing and resolving @mentions in comments."""
import re
from typing import List, Optional, Tuple

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.models.user import User


def extract_mentions(text: str) -> List[str]:
    """
    Extract @mentions from text.
    Supports: @email@domain.com and @Full Name
    
    Returns list of mention tokens (without @).
    """
    if not text:
        return []
    
    # Pattern: @email or @Name (alphanumeric, spaces, dots, hyphens, underscores)
    # Email pattern: @something@domain.tld
    # Name pattern: @First Last or @First.Last or @First_Last
    pattern = r'@([\w\.\-]+@[\w\.\-]+\.\w+|[\w\.\-\s]+)'
    matches = re.findall(pattern, text)
    
    # Clean up and deduplicate
    mentions = []
    seen = set()
    for match in matches:
        cleaned = match.strip()
        if cleaned and cleaned not in seen:
            mentions.append(cleaned)
            seen.add(cleaned)
    
    return mentions


def resolve_mentions(
    db: Session,
    mention_tokens: List[str],
    exclude_user_id: Optional[int] = None,
) -> Tuple[List[int], List[str]]:
    """
    Resolve mention tokens to user IDs.
    
    Args:
        db: Database session
        mention_tokens: List of mention strings (without @)
        exclude_user_id: Exclude this user from results (e.g., comment author)
    
    Returns:
        Tuple of (resolved_user_ids, warnings)
        - resolved_user_ids: Unique, sorted list of user IDs
        - warnings: List of warning messages for ambiguous/unresolved mentions
    """
    if not mention_tokens:
        return [], []
    
    user_ids = []
    warnings = []
    
    for token in mention_tokens:
        # Check if it's an email
        if '@' in token:
            # Email lookup
            result = db.execute(
                select(User).where(User.email.ilike(token), User.is_active == True)
            )
            user = result.scalar_one_or_none()
            if user:
                if exclude_user_id is None or user.id != exclude_user_id:
                    user_ids.append(user.id)
            else:
                warnings.append(f"User not found: {token}")
        else:
            # Name lookup (case-insensitive)
            result = db.execute(
                select(User).where(
                    User.full_name.ilike(token),
                    User.is_active == True
                )
            )
            users = result.scalars().all()
            
            if len(users) == 0:
                warnings.append(f"User not found: {token}")
            elif len(users) == 1:
                if exclude_user_id is None or users[0].id != exclude_user_id:
                    user_ids.append(users[0].id)
            else:
                # Ambiguous name - multiple matches
                warnings.append(
                    f"Ambiguous name '{token}' matches {len(users)} users. Use email instead."
                )
    
    # Return unique, sorted list
    return sorted(set(user_ids)), warnings


def parse_and_resolve_mentions(
    db: Session,
    content: str,
    author_id: int,
) -> Tuple[List[int], List[str]]:
    """
    Extract mentions from content and resolve to user IDs.
    
    Args:
        db: Database session
        content: Comment content with @mentions
        author_id: Comment author's user ID (excluded from results)
    
    Returns:
        Tuple of (user_ids, warnings)
    """
    tokens = extract_mentions(content)
    return resolve_mentions(db, tokens, exclude_user_id=author_id)
