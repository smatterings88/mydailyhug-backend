# My Daily Hug Backend - Complete Endpoints Table

Base URL: `https://mydailyhugbackend.vercel.app`

## Authentication Methods
- **Admin Endpoints**: Require `Authorization: Bearer <firebase-id-token>` header where the token belongs to a user with `userType: "admin"` in Firestore
- **GHL Endpoints**: Require `X-API-Key: <GHL_API_KEY>` header
- **Public Endpoints**: No authentication required

---

## Health & Testing Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/health` | None | Service liveness check. Returns server status and timestamp. |
| GET | `/api/test-firebase` | None | Tests Firebase connectivity (Firestore, Auth, FCM). Validates all Firebase services are operational. |
| GET | `/api/validate-tokens` | None | Validates all FCM tokens in the database. Returns list of valid and invalid tokens with user information. |

---

## Notification Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/send-notification` | None | Sends FCM push notifications to users by type (`all`, `admin`, `user`, `specific`) or specific user IDs/tokens. Supports targeting by email addresses. Persists messages to Firestore `user_messages` collection. |
| GET | `/api/notification-stats` | None | Returns statistics about users: total users, users with FCM tokens, admin count, and regular user count. |
| POST | `/api/ghl/send-notification` | X-API-Key | GHL version: Sends push notifications to specific users by email addresses. Requires `targetEmails` array. HTTP/1.x compatible with query parameter fallback. |
| GET | `/api/ghl/send-notification` | X-API-Key | GHL version: Sends notification via query parameters (`?title=...&body=...&email=...`). Persists message to Firestore even if user has no FCM token. |

---

## User Listing & Profile Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/users` | None | Returns all users from Firestore with select fields. Includes converted timestamps. |
| POST | `/api/get-user-profile` | Bearer (Admin) | Retrieves complete user profile from Firestore including Firebase Auth status. Returns all user fields including `isDollarHugger`, `is_triple_hugger`, onboarding data, etc. |

---

## User Creation Endpoints (Admin)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/grant-admin` | Bearer (Admin) | Grants admin role to a user by email. Creates Firebase Auth user if needed, sets temporary password, requires password change on first sign-in, and writes admin profile to Firestore. |
| POST | `/api/create-user` | Bearer (Admin) | Creates a regular user with temporary password. Sets `userType: "user"`, `accountType: "Admin-Created"`, requires password change, and writes profile to Firestore. Returns 409 if user already exists. |
| POST | `/api/create-dollar-hugger` | Bearer (Admin) | Creates a user marked as Dollar Hugger (`isDollarHugger: "Yes"`, `is_triple_hugger: "No"`). If email already exists, updates existing user instead of returning 409. Requires password change on first sign-in. |

---

## User Creation Endpoints (GHL)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/ghl/create-user` | X-API-Key | Creates a premium user (`accountType: "Premium"`). Sets temporary password, requires password change, and writes profile to Firestore. HTTP/1.x compatible with query parameter fallback. Returns 409 if user already exists. |
| POST | `/api/ghl/create-trial-user` | X-API-Key | Creates a trial user (`accountType: "Trial"`). Same as create-user but with trial account type. HTTP/1.x compatible. Returns 409 if user already exists. |
| POST | `/api/ghl/create-dollar-hugger` | X-API-Key | Creates a Dollar Hugger user (`isDollarHugger: "Yes"`, `is_triple_hugger: "No"`). If email already exists, updates existing user instead of returning 409. HTTP/1.x compatible. |

---

## User Status Management (Admin)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/make-inactive` | Bearer (Admin) | Sets user's `accountStatus` to `"Inactive"` in Firestore. Accepts `uid` or `email` in request body. |
| POST | `/api/make-active` | Bearer (Admin) | Sets user's `accountStatus` to `"Active"` in Firestore. Accepts `uid` or `email` in request body. |
| POST | `/api/make-triple-hugger` | Bearer (Admin) | Marks user as triple hugger by setting `is_triple_hugger: "Yes"` in Firestore. Requires `email` in request body. |
| POST | `/api/make-double-hugger` | Bearer (Admin) | Marks user as double hugger by setting `is_triple_hugger: "No"` in Firestore. Requires `email` in request body. |

---

## User Status Management (GHL)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/ghl/make-inactive` | X-API-Key | Sets user's `accountStatus` to `"Inactive"` (GHL version). HTTP/1.x compatible. Accepts `uid` or `email`. |
| POST | `/api/ghl/make-active` | X-API-Key | Sets user's `accountStatus` to `"Active"` (GHL version). HTTP/1.x compatible. Accepts `uid` or `email`. |
| POST | `/api/ghl/make-triple-hugger` | X-API-Key | Marks user as triple hugger (`is_triple_hugger: "Yes"`) (GHL version). HTTP/1.x compatible. Requires `email`. |
| POST | `/api/ghl/make-double-hugger` | X-API-Key | Marks user as double hugger (`is_triple_hugger: "No"`) (GHL version). HTTP/1.x compatible. Requires `email`. |

---

## User Deletion Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/delete-user` | Bearer (Admin) | Permanently deletes a user from Firebase Authentication and Firestore. Accepts `uid` or `email` in request body. Returns admin name who performed deletion. |
| POST | `/api/ghl/delete-user` | X-API-Key | Permanently deletes a user from Firebase Authentication and Firestore (GHL version). HTTP/1.x compatible with query parameter fallback. Accepts `uid` or `email`. |

---

## Password Management Endpoints (Admin)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/force-password-reset` | Bearer (Admin) | Forces a user to change their password on next sign-in. Sets `mustChangePassword: true` custom claim and revokes refresh tokens. Accepts `uid` or `email` in request body. |
| POST | `/api/remove-password-change-requirement` | Bearer (Admin) | Removes the password change requirement by clearing `mustChangePassword` custom claim. Revokes refresh tokens to force re-authentication. Requires `uid` in request body. |

---

## User Cleanup Utility Endpoints (Admin)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/scan-orphaned-users` | Bearer (Admin) | Scans Firestore for users that don't have corresponding Firebase Authentication accounts. Returns list of orphaned users with summary statistics. No parameters required. |
| POST | `/api/cleanup-orphaned-users` | Bearer (Admin) | Deletes orphaned user records from Firestore and their subcollections (conversations, memories, user_messages). Requires `userIds` array in request body. Returns detailed cleanup results. |
| POST | `/api/validate-user-auth` | Bearer (Admin) | Validates if a specific user exists in Firebase Authentication. Requires `uid` in request body. Returns user details if exists, or `exists: false` if not found. |

---

## Default User Profile Fields on Creation

When users are created by any endpoint (`/api/grant-admin`, `/api/create-user`, `/api/ghl/create-user`, `/api/ghl/create-trial-user`), the following default fields are set in Firestore:

- `is_triple_hugger: "No"`
- `isDollarHugger: "No"`

These can be updated later via the respective management endpoints.

---

## HTTP/1.x Compatibility

All GHL endpoints (`/api/ghl/*`) support HTTP/1.x compatibility with query parameter fallback. If a POST request body is dropped by a proxy, the endpoint will attempt to extract parameters from URL query parameters.

Example:
```bash
# Standard JSON body
curl -X POST "https://mydailyhugbackend.vercel.app/api/ghl/make-triple-hugger" \
  -H "X-API-Key: <key>" \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com"}'

# HTTP/1.x query parameter fallback
curl --http1.1 -X POST "https://mydailyhugbackend.vercel.app/api/ghl/make-triple-hugger?email=user@example.com" \
  -H "X-API-Key: <key>"
```

---

## Common Error Responses

| Status Code | Description |
|-------------|-------------|
| 400 | Bad Request - Invalid or missing required parameters |
| 401 | Unauthorized - Missing or invalid authentication token/API key |
| 403 | Forbidden - Authenticated but not authorized (e.g., non-admin accessing admin endpoint) |
| 404 | Not Found - Target user or resource not found |
| 409 | Conflict - Resource already exists (e.g., user with email already exists) |
| 500 | Internal Server Error - Server-side error (check logs for details) |
| 503 | Service Unavailable - External service error (e.g., FCM API not enabled) |

---

## Notes

- All endpoints that create users set `mustChangePassword: true` custom claim, requiring password change on first sign-in
- All user creation endpoints generate a temporary password if not provided
- GHL endpoints are designed for integration with GoHighLevel automation workflows
- Admin endpoints require Firebase ID token from a user with `userType: "admin"` in Firestore
- All timestamps in responses are converted to ISO 8601 format when available
- Messages sent via notification endpoints are persisted to Firestore `user_messages` collection for offline users

