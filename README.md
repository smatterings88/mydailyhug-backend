# My Daily Hug Backend Service

A Node.js/Express backend service for sending push notifications using Firebase Cloud Messaging (FCM).

## Features

- 🔔 Send push notifications to users
- 👥 Target specific user types (admin/user/all)
- 📊 Get notification statistics
- 🔒 Rate limiting and security
- 🚀 Production ready

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Environment Variables

Copy `env.example` to `.env` and fill in your Firebase credentials:

```bash
cp env.example .env
```

Get your Firebase Admin SDK credentials from:
- Firebase Console → Project Settings → Service Accounts
- Generate a new private key
- Copy the values to your `.env` file

### 3. Run the Server

Development:
```bash
npm run dev
```

Production:
```bash
npm start
```

## API Endpoints

### Health Check
```
GET /health
```

### Send Notification
```
POST /api/send-notification
```

**Request Body:**
```json
{
  "title": "Notification Title",
  "body": "Notification message",
  "targetType": "all|admin|user",
  "targetUsers": ["user1", "user2"],
  "icon": "/path/to/icon.png",
  "badge": "/path/to/badge.png",
  "data": {
    "custom": "data"
  }
}
```

### Get Statistics
```
GET /api/notification-stats
```

### GHL: Create Regular User (API Key Auth)

Use this endpoint to allow GoHighLevel (GHL) to create a regular user in Firebase Auth and Firestore without a Firebase ID token. The endpoint is protected with a static API key passed in the `X-API-Key` header.

```
POST /api/ghl/create-user
```

Headers:

```
Content-Type: application/json
X-API-Key: <your-long-random-api-key>
```

Body:

```json
{
  "email": "user@example.com",
  "firstName": "Jane",     // optional
  "lastName": "Smith",     // optional
  "tempPassword": "abc123" // optional (auto-generated if omitted)
}
```

Success response:

```json
{
  "success": true,
  "email": "user@example.com",
  "uid": "firebase-uid",
  "tempPassword": "generated-or-provided-temp-password"
}
```

Errors:

- `401 X-API-Key header required`
- `403 Invalid API key`
- `400 Valid email is required`
- `400 Invalid email format`
- `409 User already exists with this email`
- `500 Failed to create user`

Environment variable:

```
GHL_API_KEY=your_long_random_api_key_here
```

Tips:
- Rotate `GHL_API_KEY` periodically.
- Apply stricter rate limits at your hosting provider/CDN for `/api/ghl/*`.
- Optionally add an IP allowlist if GHL provides static egress IPs.

### GHL: Create Trial User (API Key Auth)

Same as GHL Create Regular User, but stores `accountType: "Trial"`.

```
POST /api/ghl/create-trial-user
```

Headers:

```
Content-Type: application/json
X-API-Key: <your-long-random-api-key>
```

Body:

```json
{
  "email": "user@example.com",
  "firstName": "Jane",     // optional
  "lastName": "Smith",     // optional
  "tempPassword": "abc123" // optional (auto-generated if omitted)
}
```

### GHL: Make User Inactive (API Key Auth)

```
POST /api/ghl/make-inactive
```

Headers:

```
Content-Type: application/json
X-API-Key: <your-long-random-api-key>
```

Body:

```json
{
  "uid": "firebase-uid" // or provide "email": "user@example.com"
}
```

Effect: Sets `users/{uid}.accountStatus = "Inactive"` and updates `updatedAt`.

### GHL: Make User Active (API Key Auth)

```
POST /api/ghl/make-active
```

Headers:

```
Content-Type: application/json
X-API-Key: <your-long-random-api-key>
```

Body:

```json
{
  "uid": "firebase-uid" // or provide "email": "user@example.com"
}
```

Effect: Sets `users/{uid}.accountStatus = "Active"` and updates `updatedAt`.

Success response:

```json
{
  "success": true,
  "email": "user@example.com",
  "uid": "firebase-uid",
  "tempPassword": "generated-or-provided-temp-password"
}
```

### Admin: Create Admin User (Bearer Admin Token)

```
POST /api/grant-admin
```

Body (JSON):

```json
{
  "email": "admin@example.com",
  "firstName": "John",      // optional
  "lastName": "Doe",        // optional
  "tempPassword": "custom"  // optional
}
```

### Admin: Create Regular User (Bearer Admin Token)

```
POST /api/create-user
```

Body (JSON):

```json
{
  "email": "user@example.com",
  "firstName": "Jane",      // optional
  "lastName": "Smith",      // optional
  "tempPassword": "custom"  // optional
}
```

### Admin: Make User Inactive (Bearer Admin Token)

```
POST /api/make-inactive
```

Body (JSON):

```json
{
  "uid": "firebase-uid" // or provide "email": "user@example.com"
}
```

Effect: Sets `users/{uid}.accountStatus = "Inactive"` and updates `updatedAt`.

### Admin: Make User Active (Bearer Admin Token)

```
POST /api/make-active
```

Body (JSON):

```json
{
  "uid": "firebase-uid" // or provide "email": "user@example.com"
}
```

Effect: Sets `users/{uid}.accountStatus = "Active"` and updates `updatedAt`.

## User Document Schema (Firestore `users/{uid}`)

The backend writes these fields when creating users:

```json
{
  "uid": "firebase-uid",
  "email": "user@example.com",
  "userType": "user | admin",
  "accountType": "Premium | Trial | Admin-Created",
  "creationEndpoint": "ghl_create_user | ghl_create_trial_user | grant_admin | create_user",
  "createdBy": "GHL | <admin full name>",
  "accountStatus": "Active",
  "firstName": "Jane",                // when provided
  "lastName": "Smith",                // when provided
  "displayName": "Jane Smith",        // when derivable
  "tempPassword": "<redacted in logs>",
  "passwordGeneratedAt": "Timestamp",
  "createdAt": "ServerTimestamp",
  "updatedAt": "Timestamp"
}
```

Rules by endpoint:
- `POST /api/ghl/create-user`: `accountType = "Premium"`, `creationEndpoint = "ghl_create_user"`, `createdBy = "GHL"`
- `POST /api/ghl/create-trial-user`: `accountType = "Trial"`, `creationEndpoint = "ghl_create_trial_user"`, `createdBy = "GHL"`
- `POST /api/grant-admin`: `accountType = "Admin-Created"`, `creationEndpoint = "grant_admin"`, `createdBy = <admin full name>`
- `POST /api/create-user`: `accountType = "Admin-Created"`, `creationEndpoint = "create_user"`, `createdBy = <admin full name>`

## Deployment

### Vercel (Recommended)

1. Install Vercel CLI:
```bash
npm i -g vercel
```

2. Deploy:
```bash
vercel
```

3. Set environment variables in Vercel dashboard

### Other Platforms

- **Railway**: Connect GitHub repo
- **Render**: Connect GitHub repo  
- **Heroku**: Use Heroku CLI
- **DigitalOcean**: Use App Platform

## Security

- Rate limiting (100 requests per 15 minutes)
- CORS protection
- Helmet security headers
- Input validation
- Error handling

## Frontend Integration

Update your frontend to call the backend API instead of the mock implementation:

```javascript
// Replace the mock sendNotification function
export async function sendNotification(payload, options = {}) {
  const response = await fetch('https://your-backend-url.vercel.app/api/send-notification', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      title: payload.title,
      body: payload.body,
      targetType: options.targetUserType || 'all',
      targetUsers: options.targetUsers || [],
      icon: payload.icon,
      badge: payload.badge,
      data: payload.data
    })
  });
  
  return await response.json();
}
```
