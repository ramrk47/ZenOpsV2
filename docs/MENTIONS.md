# @Mentions in Document Comments

This document describes the @mention functionality in Zen Ops document comments.

## Overview

Users can mention other users in document comments using the `@` syntax. Mentioned users receive in-app notifications and (if configured) email alerts.

## Syntax

### Email Mention (Recommended)
```
@user@example.com
```
- Most reliable method
- Case-insensitive
- Example: `@john.smith@zenops.com please review this`

### Name Mention
```
@Full Name
```
- Case-insensitive
- Must match user's full name exactly
- Example: `@Jane Doe can you help with this?`

**Important**: If multiple users share the same name, the mention will fail with a warning. Use email instead.

## How It Works

### Backend Processing

When a comment is created or updated:

1. **Extraction**: The backend parses the comment content for `@mentions`
2. **Resolution**: Each mention is resolved to a user ID:
   - Email mentions: exact match (case-insensitive)
   - Name mentions: exact match, fails if ambiguous
3. **Storage**: Resolved user IDs are stored in `mentioned_user_ids` field
4. **Notifications**: Each mentioned user receives a notification

### Notification Rules

- **Author exclusion**: You cannot mention yourself
- **Inactive users**: Inactive users are skipped
- **Lane visibility**: Mentions respect comment lane visibility:
  - `INTERNAL` lane: All internal users can be mentioned
  - `EXTERNAL` lane: Only client-facing users (for client visibility)
- **Deduplication**: Recent duplicate notifications are suppressed (5 min window)

### Error Handling

- **Not found**: User not found warnings are logged but comment creation succeeds
- **Ambiguous name**: If multiple users match a name, warning is logged
- **Failed notifications**: Best-effort; comment creation succeeds even if notification fails

## Frontend Display

### Mention Highlighting

Mentions are visually highlighted in the comment text:
```jsx
@john@example.com → styled with accent background
```

### Mention Badge

Comments with mentions display a badge:
```
👥 2 mentioned
```

## API Examples

### Create Comment with Mentions

```bash
POST /api/document-comments
{
  "document_id": 123,
  "assignment_id": 45,
  "content": "@john@example.com please review this document. cc @Jane Doe",
  "lane": "INTERNAL",
  "mentioned_user_ids": []  // Backend parses from content
}
```

Response:
```json
{
  "id": 456,
  "content": "@john@example.com please review...",
  "mentioned_user_ids": [10, 25],
  "author": {...},
  ...
}
```

### Document Review with Mention

```bash
POST /api/assignments/45/documents/16/review
{
  "review_status": "NEEDS_CLARIFICATION",
  "note": "@jane@example.com can you clarify the dates?",
  "lane": "INTERNAL"
}
```

## Testing

Run mention tests:
```bash
cd backend
pytest tests/test_mentions.py -v
```

## Troubleshooting

### Mention Not Working

1. **Check user exists**: Verify user email/name in database
2. **Check active status**: Only active users receive mentions
3. **Check spelling**: Name mentions must match exactly
4. **Use email instead**: Email is more reliable than name

### No Notification Received

1. **Check notification preferences**: User may have disabled notifications
2. **Check recent notifications**: Duplicates suppressed within 5 min
3. **Check logs**: Backend logs mention resolution warnings

## Security Considerations

- **No user enumeration**: Mention failures don't reveal user existence to clients
- **Lane respect**: External partners cannot mention internal-only users via external lane
- **Audit trail**: All mentions logged with request_id for debugging

## Future Enhancements

### In Progress
- [ ] Autocomplete dropdown when typing `@`
- [ ] Mention activity feed
- [ ] Email digest for mentions

### Planned
- [ ] Mention groups (e.g., `@team-valuers`)
- [ ] Mention from assignment messages
- [ ] Rich notifications with comment preview
