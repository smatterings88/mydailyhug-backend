# My Daily Hug Backend - API Endpoints

This document provides complete, copy/pasteable instructions for every endpoint in the backend. Examples use curl. Replace placeholders like <your-backend-url>, <admin-id-token>, and <GHL_API_KEY>.

- Base URL examples:
  - Local: `http://localhost:3001`
  - Prod (example): `https://your-backend-url.vercel.app`

- Authentication methods:
  - Admin endpoints: `Authorization: Bearer <admin-id-token>` where the token belongs to a Firebase Auth user whose Firestore document at `users/{uid}` has `userType: "admin"`.
  - GHL endpoints: `X-API-Key: <GHL_API_KEY>` static key configured in environment variables.

- Common headers:
  - `Content-Type: application/json`

---

## Health

- Method/Path: `GET /health`
- Auth: None
- Description: Service liveness check.

Example
```bash
curl -s <your-backend-url>/health
```

---

## Send Notification

- Method/Path: `POST /api/send-notification`
- Auth: None
- Description: Sends an FCM push notification to selected users by type or specific IDs.

Request body
```json
{
  "title": "Notification Title",
  "body": "Notification message",
  "targetType": "all|admin|user",
  "targetUsers": ["uid1", "uid2"],
  "icon": "/path/to/icon.png",
  "badge": "/path/to/badge.png",
  "data": { "custom": "data" }
}
```

Notes
- If `targetUsers` is provided and non-empty, those UIDs are targeted.
- Otherwise, `targetType` is used (default: `all`).
- Users must have `fcmToken` stored in `users/{uid}`.

Example
```bash
curl -X POST <your-backend-url>/api/send-notification \
  -H "Content-Type: application/json" \
  -d '{
    "title":"Hello",
    "body":"This is a test",
    "targetType":"all"
  }'
```

Response
```json
{
  "success": true,
  "messageId": "batch-1699999999999",
  "stats": { "total": 10, "successful": 9, "failed": 1 }
}
```

---

## Notification Stats

- Method/Path: `GET /api/notification-stats`
- Auth: None
- Description: Returns counts of users, admins, regular users, and users with FCM tokens.

Example
```bash
curl -s <your-backend-url>/api/notification-stats
```

Response
```json
{
  "totalUsers": 42,
  "usersWithNotifications": 21,
  "admins": 3,
  "regularUsers": 39
}
```

---

## List Users

- Method/Path: `GET /api/users`
- Auth: None
- Description: Returns all users from Firestore with select fields and converted timestamps when available.

Example
```bash
curl -s <your-backend-url>/api/users
```

Response (truncated)
```json
{
  "success": true,
  "users": [
    {
      "id": "<uid>",
      "uid": "<uid>",
      "email": "user@example.com",
      "userType": "user",
      "accountStatus": "Active",
      "createdAt": "2024-01-01T00:00:00.000Z",
      "updatedAt": "2024-01-01T01:00:00.000Z"
    }
  ],
  "total": 42
}
```

---

## Admin: Grant Admin

- Method/Path: `POST /api/grant-admin`
- Auth: Bearer admin token
- Description: Grants admin role to an email. Creates user if needed, sets a temp password (generated or provided), requires password change on first sign-in, and writes profile to Firestore.

Headers
- `Authorization: Bearer <admin-id-token>`
- `Content-Type: application/json`

Request body
```json
{
  "email": "admin@example.com",
  "firstName": "John",        
  "lastName": "Doe",         
  "tempPassword": "custom"    
}
```

Example
```bash
curl -X POST <your-backend-url>/api/grant-admin \
  -H "Authorization: Bearer <admin-id-token>" \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com"}'
```

---

## Admin: Create Regular User

- Method/Path: `POST /api/create-user`
- Auth: Bearer admin token
- Description: Creates a regular user with a temporary password, requires password change, and writes profile to Firestore.

Headers
- `Authorization: Bearer <admin-id-token>`
- `Content-Type: application/json`

Request body
```json
{
  "email": "user@example.com",
  "firstName": "Jane",
  "lastName": "Smith",
  "tempPassword": "custom"
}
```

Example
```bash
curl -X POST <your-backend-url>/api/create-user \
  -H "Authorization: Bearer <admin-id-token>" \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com"}'
```

---

## Admin: Remove Password Change Requirement

- Method/Path: `POST /api/remove-password-change-requirement`
- Auth: None (note: current implementation does not authenticate; lock down if needed)
- Description: Clears the `mustChangePassword` custom claim for the given `uid`.

Headers
- `Content-Type: application/json`

Request body
```json
{ "uid": "<firebase-uid>" }
```

Example
```bash
curl -X POST <your-backend-url>/api/remove-password-change-requirement \
  -H "Content-Type: application/json" \
  -d '{"uid":"<firebase-uid>"}'
```

---

## Admin: Make User Inactive

- Method/Path: `POST /api/make-inactive`
- Auth: Bearer admin token
- Description: Sets `users/{uid}.accountStatus = "Inactive"`.

Headers
- `Authorization: Bearer <admin-id-token>`
- `Content-Type: application/json`

Request body
```json
{ "uid": "<firebase-uid>" }
```
-or-
```json
{ "email": "user@example.com" }
```

Example
```bash
curl -X POST <your-backend-url>/api/make-inactive \
  -H "Authorization: Bearer <admin-id-token>" \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com"}'
```

---

## Admin: Make User Active

- Method/Path: `POST /api/make-active`
- Auth: Bearer admin token
- Description: Sets `users/{uid}.accountStatus = "Active"`.

Headers
- `Authorization: Bearer <admin-id-token>`
- `Content-Type: application/json`

Request body
```json
{ "uid": "<firebase-uid>" }
```
-or-
```json
{ "email": "user@example.com" }
```

Example
```bash
curl -X POST <your-backend-url>/api/make-active \
  -H "Authorization: Bearer <admin-id-token>" \
  -H "Content-Type: application/json" \
  -d '{"uid":"<firebase-uid>"}'
```

---

## GHL: Create Premium User

- Method/Path: `POST /api/ghl/create-user`
- Auth: `X-API-Key`
- Description: Creates a regular user with `accountType: "Premium"`, sets temp password, and writes Firestore profile.

Headers
- `X-API-Key: <GHL_API_KEY>`
- `Content-Type: application/json`

Request body
```json
{
  "email": "user@example.com",
  "firstName": "Jane",
  "lastName": "Smith",
  "tempPassword": "abc123"
}
```

Example
```bash
curl -X POST <your-backend-url>/api/ghl/create-user \
  -H "X-API-Key: <GHL_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com"}'
```

---

## GHL: Create Trial User

- Method/Path: `POST /api/ghl/create-trial-user`
- Auth: `X-API-Key`
- Description: Same as above but sets `accountType: "Trial"`.

Headers
- `X-API-Key: <GHL_API_KEY>`
- `Content-Type: application/json`

Request body
```json
{
  "email": "user@example.com",
  "firstName": "Jane",
  "lastName": "Smith",
  "tempPassword": "abc123"
}
```

Example
```bash
curl -X POST <your-backend-url>/api/ghl/create-trial-user \
  -H "X-API-Key: <GHL_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com"}'
```

---

## GHL: Make User Inactive

- Method/Path: `POST /api/ghl/make-inactive`
- Auth: `X-API-Key`
- Description: Sets `users/{uid}.accountStatus = "Inactive"`.

Headers
- `X-API-Key: <GHL_API_KEY>`
- `Content-Type: application/json`

Request body
```json
{ "uid": "<firebase-uid>" }
```
-or-
```json
{ "email": "user@example.com" }
```

Example
```bash
curl -X POST <your-backend-url>/api/ghl/make-inactive \
  -H "X-API-Key: <GHL_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"uid":"<firebase-uid>"}'
```

---

## GHL: Make User Active

- Method/Path: `POST /api/ghl/make-active`
- Auth: `X-API-Key`
- Description: Sets `users/{uid}.accountStatus = "Active"`.

Headers
- `X-API-Key: <GHL_API_KEY>`
- `Content-Type: application/json`

Request body
```json
{ "uid": "<firebase-uid>" }
```
-or-
```json
{ "email": "user@example.com" }
```

Example
```bash
curl -X POST <your-backend-url>/api/ghl/make-active \
  -H "X-API-Key: <GHL_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com"}'
```

---

## Make User Triple Hugger

- Method/Path: `POST /api/make-triple-hugger`
- Auth: None
- Description: Marks a user as a triple hugger by setting `is_triple_hugger: "Yes"` in their Firestore profile.

Headers
- `Content-Type: application/json`

Request body
```json
{ "email": "user@example.com" }
```

Example
```bash
curl -X POST <your-backend-url>/api/make-triple-hugger \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com"}'
```

Response
```json
{
  "success": true,
  "uid": "<firebase-uid>",
  "email": "user@example.com",
  "is_triple_hugger": "Yes",
  "message": "User marked as triple hugger"
}
```

---

## GHL: Make User Triple Hugger

- Method/Path: `POST /api/ghl/make-triple-hugger`
- Auth: `X-API-Key`
- Description: Marks a user as a triple hugger by setting `is_triple_hugger: "Yes"` in their Firestore profile (GHL version with API key auth).

Headers
- `X-API-Key: <GHL_API_KEY>`
- `Content-Type: application/json`

Request body
```json
{ "email": "user@example.com" }
```

Example
```bash
curl -X POST <your-backend-url>/api/ghl/make-triple-hugger \
  -H "X-API-Key: <GHL_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com"}'
```

Response
```json
{
  "success": true,
  "uid": "<firebase-uid>",
  "email": "user@example.com",
  "is_triple_hugger": "Yes",
  "message": "User marked as triple hugger (GHL)"
}
```

---

## Make User Double Hugger

- Method/Path: `POST /api/make-double-hugger`
- Auth: None
- Description: Marks a user as a double hugger by setting `is_triple_hugger: "No"` in their Firestore profile.

Headers
- `Content-Type: application/json`

Request body
```json
{ "email": "user@example.com" }
```

Example
```bash
curl -X POST <your-backend-url>/api/make-double-hugger \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com"}'
```

Response
```json
{
  "success": true,
  "uid": "<firebase-uid>",
  "email": "user@example.com",
  "is_triple_hugger": "No",
  "message": "User marked as double hugger"
}
```

---

## GHL: Make User Double Hugger

- Method/Path: `POST /api/ghl/make-double-hugger`
- Auth: `X-API-Key`
- Description: Marks a user as a double hugger by setting `is_triple_hugger: "No"` in their Firestore profile (GHL version with API key auth).

Headers
- `X-API-Key: <GHL_API_KEY>`
- `Content-Type: application/json`

Request body
```json
{ "email": "user@example.com" }
```

Example
```bash
curl -X POST <your-backend-url>/api/ghl/make-double-hugger \
  -H "X-API-Key: <GHL_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com"}'
```

Response
```json
{
  "success": true,
  "uid": "<firebase-uid>",
  "email": "user@example.com",
  "is_triple_hugger": "No",
  "message": "User marked as double hugger (GHL)"
}
```

---

## Error Responses (General)

- 400: Invalid or missing parameters (e.g., missing `email` or `uid`).
- 401: Missing/invalid authentication (e.g., missing `X-API-Key` or `Authorization`).
- 403: Authenticated but not authorized (e.g., wrong `X-API-Key`).
- 404: Target user not found (when resolving by email).
- 409: User already exists (create endpoints).
- 500: Server error (see logs for details).

---

## Environment Variables

- Firebase Admin SDK
  - `FIREBASE_PROJECT_ID`
  - `FIREBASE_PRIVATE_KEY_ID`
  - `FIREBASE_PRIVATE_KEY` (be careful with newlines; escaped in env, unescaped in code)
  - `FIREBASE_CLIENT_EMAIL`
  - `FIREBASE_CLIENT_ID`
- GHL API Key
  - `GHL_API_KEY`
- Other
  - `FRONTEND_URL` (for web push links)
  - `PORT` (default 3001)

---

## Security Notes

- Admin endpoints require a valid Firebase ID token from a user whose Firestore document has `userType: "admin"`.
- GHL endpoints are protected by a static API key; rotate keys periodically and consider IP allowlists/rate limits at your edge.
- The service applies CORS, Helmet, and rate limiting (`/api/*`).
