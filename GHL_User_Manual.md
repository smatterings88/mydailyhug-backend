# GHL Endpoints User Manual

This manual provides comprehensive guidance on using all GoHighLevel (GHL) integration endpoints in the My Daily Hug backend. These endpoints are designed for automated workflows and third-party integrations.

## Table of Contents
1. [Authentication](#authentication)
2. [User Management](#user-management)
3. [Account Status Management](#account-status-management)
4. [User Type Management](#user-type-management)
5. [Push Notifications](#push-notifications)
6. [Error Handling](#error-handling)
7. [Best Practices](#best-practices)
8. [Integration Examples](#integration-examples)

---

## Authentication

All GHL endpoints require API key authentication using the `X-API-Key` header.

### Required Header
```
X-API-Key: <GHL_API_KEY>
Content-Type: application/json
```

### Getting Your API Key
Contact your system administrator to obtain the GHL API key. This key should be kept secure and not exposed in client-side code.

---

## User Management

### 1. Create Premium User

**Endpoint:** `POST /api/ghl/create-user`

Creates a new user with Premium account type. The user will receive a temporary password and must change it on first login.

#### Request Body
```json
{
  "email": "user@example.com",
  "firstName": "Jane",
  "lastName": "Smith",
  "tempPassword": "abc123"
}
```

#### Required Fields
- `email` (string): Valid email address
- `firstName` (string): User's first name
- `lastName` (string): User's last name

#### Optional Fields
- `tempPassword` (string): Custom temporary password (if not provided, a random password is generated)

#### Example Request
```bash
curl -X POST https://your-backend-url.vercel.app/api/ghl/create-user \
  -H "X-API-Key: your-ghl-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "jane.doe@example.com",
    "firstName": "Jane",
    "lastName": "Doe",
    "tempPassword": "TempPass123!"
  }'
```

#### Success Response
```json
{
  "success": true,
  "uid": "firebase-user-id",
  "email": "jane.doe@example.com",
  "firstName": "Jane",
  "lastName": "Doe",
  "accountType": "Premium",
  "userType": "user",
  "is_triple_hugger": "No",
  "message": "Premium user created successfully"
}
```

#### Error Responses
- **400 Bad Request:** Invalid email format or missing required fields
- **401 Unauthorized:** Missing or invalid API key
- **409 Conflict:** User already exists
- **500 Internal Server Error:** Server error (check logs)

---

### 2. Create Trial User

**Endpoint:** `POST /api/ghl/create-trial-user`

Creates a new user with Trial account type. Same functionality as Premium user creation but with Trial status.

#### Request Body
```json
{
  "email": "trial@example.com",
  "firstName": "John",
  "lastName": "Trial",
  "tempPassword": "trial123"
}
```

#### Example Request
```bash
curl -X POST https://your-backend-url.vercel.app/api/ghl/create-trial-user \
  -H "X-API-Key: your-ghl-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "trial.user@example.com",
    "firstName": "John",
    "lastName": "Trial"
  }'
```

#### Success Response
```json
{
  "success": true,
  "uid": "firebase-user-id",
  "email": "trial.user@example.com",
  "firstName": "John",
  "lastName": "Trial",
  "accountType": "Trial",
  "userType": "user",
  "is_triple_hugger": "No",
  "message": "Trial user created successfully"
}
```

---

## Account Status Management

### 3. Make User Inactive

**Endpoint:** `POST /api/ghl/make-inactive`

Sets a user's account status to "Inactive". You can identify the user by either UID or email.

#### Request Body (by UID)
```json
{
  "uid": "firebase-user-id"
}
```

#### Request Body (by Email)
```json
{
  "email": "user@example.com"
}
```

#### Example Request (by Email)
```bash
curl -X POST https://your-backend-url.vercel.app/api/ghl/make-inactive \
  -H "X-API-Key: your-ghl-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com"
  }'
```

#### Success Response
```json
{
  "success": true,
  "uid": "firebase-user-id",
  "email": "user@example.com",
  "accountStatus": "Inactive",
  "message": "User account status updated to Inactive"
}
```

#### Error Responses
- **400 Bad Request:** Missing uid or email
- **404 Not Found:** User not found
- **500 Internal Server Error:** Server error

---

### 4. Make User Active

**Endpoint:** `POST /api/ghl/make-active`

Sets a user's account status to "Active". You can identify the user by either UID or email.

#### Request Body (by UID)
```json
{
  "uid": "firebase-user-id"
}
```

#### Request Body (by Email)
```json
{
  "email": "user@example.com"
}
```

#### Example Request (by Email)
```bash
curl -X POST https://your-backend-url.vercel.app/api/ghl/make-active \
  -H "X-API-Key: your-ghl-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com"
  }'
```

#### Success Response
```json
{
  "success": true,
  "uid": "firebase-user-id",
  "email": "user@example.com",
  "accountStatus": "Active",
  "message": "User account status updated to Active"
}
```

---

## User Type Management

### 5. Make User Triple Hugger

**Endpoint:** `POST /api/ghl/make-triple-hugger`

Marks a user as a triple hugger by setting `is_triple_hugger: "Yes"` in their profile.

#### Request Body
```json
{
  "email": "user@example.com"
}
```

#### Example Request
```bash
curl -X POST https://your-backend-url.vercel.app/api/ghl/make-triple-hugger \
  -H "X-API-Key: your-ghl-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "vip.user@example.com"
  }'
```

#### Success Response
```json
{
  "success": true,
  "uid": "firebase-user-id",
  "email": "vip.user@example.com",
  "is_triple_hugger": "Yes",
  "message": "User marked as triple hugger (GHL)"
}
```

---

### 6. Make User Double Hugger

**Endpoint:** `POST /api/ghl/make-double-hugger`

Marks a user as a double hugger by setting `is_triple_hugger: "No"` in their profile.

#### Request Body
```json
{
  "email": "user@example.com"
}
```

#### Example Request
```bash
curl -X POST https://your-backend-url.vercel.app/api/ghl/make-double-hugger \
  -H "X-API-Key: your-ghl-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "regular.user@example.com"
  }'
```

#### Success Response
```json
{
  "success": true,
  "uid": "firebase-user-id",
  "email": "regular.user@example.com",
  "is_triple_hugger": "No",
  "message": "User marked as double hugger (GHL)"
}
```

---

### 7. Delete User

**Endpoint:** `POST /api/ghl/delete-user`

Permanently deletes a user from Firebase Authentication and Firestore. This action cannot be undone.

#### Parameters
- `email` (string, optional): User's email address
- `uid` (string, optional): Firebase user ID
- Note: Either `email` or `uid` is required

#### HTTP/1.x Compatible Examples

**Query Parameters (Recommended for HTTP/1.x)**
```bash
curl --http1.1 -X POST "https://mydailyhugbackend.vercel.app/api/ghl/delete-user?email=user@example.com" \
  -H "X-API-Key: YOUR_API_KEY"
```

**JSON Body**
```bash
curl -X POST https://mydailyhugbackend.vercel.app/api/ghl/delete-user \
  -H "X-API-Key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com"
  }'
```

**URL-encoded Body (HTTP/1.x Safe)**
```bash
curl --http1.1 -X POST "https://mydailyhugbackend.vercel.app/api/ghl/delete-user" \
  -H "X-API-Key: YOUR_API_KEY" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "email=user@example.com"
```

#### Success Response
```json
{
  "success": true,
  "uid": "firebase-user-id",
  "message": "User deleted successfully (GHL)",
  "deletedBy": "GHL"
}
```

#### Error Responses
- **400 Bad Request**: Missing required parameters
- **404 Not Found**: User not found for provided email/uid
- **500 Internal Server Error**: Server error during deletion

#### Important Notes
- ⚠️ **This action is permanent and cannot be undone**
- The user will be removed from Firebase Authentication and Firestore
- Any associated data (messages, tokens) will also be deleted
- Use with caution in production environments

---

## Push Notifications

### 8. Send Notification to Specific Users

**Endpoint:** `POST /api/ghl/send-notification`

Sends push notifications to specific users identified by their email addresses. Messages are also saved to Firestore for users without push notifications enabled.

#### Request Body
```json
{
  "title": "Notification Title",
  "body": "Notification message",
  "targetEmails": ["user1@example.com", "user2@example.com"],
  "icon": "/path/to/icon.png",
  "badge": "/path/to/badge.png",
  "data": {
    "persistent": true,
    "timestamp": 1234567890,
    "source": "ghl-integration",
    "action": "view_profile"
  }
}
```

#### Required Fields
- `title` (string): Notification title
- `body` (string): Notification message
- `targetEmails` (array): Array of email addresses

#### Optional Fields
- `icon` (string): Path to notification icon
- `badge` (string): Path to notification badge
- `data` (object): Additional data payload (all values will be converted to strings)

#### Example Request
```bash
curl -X POST https://your-backend-url.vercel.app/api/ghl/send-notification \
  -H "X-API-Key: your-ghl-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Welcome to My Daily Hug!",
    "body": "Your premium account has been activated.",
    "targetEmails": ["newuser@example.com", "vip@example.com"],
    "data": {
      "type": "account_activation",
      "persistent": true,
      "action": "view_dashboard"
    }
  }'
```

#### Success Response
```json
{
  "success": true,
  "messageId": "projects/your-project/messages/0:1234567890",
  "stats": {
    "total": 2,
    "successful": 2,
    "failed": 0
  },
  "targetEmails": ["newuser@example.com", "vip@example.com"],
  "validEmails": ["newuser@example.com", "vip@example.com"],
  "invalidEmails": [],
  "response": {
    "successCount": 2,
    "failureCount": 0,
    "responses": [
      {
        "success": true,
        "messageId": "projects/your-project/messages/0:1234567890"
      },
      {
        "success": true,
        "messageId": "projects/your-project/messages/0:1234567891"
      }
    ]
  }
}
```

#### Important Notes
- Only users with valid FCM tokens receive push notifications
- Messages are saved to Firestore (`user_messages` collection) for all targeted users, regardless of push notification status
- Invalid email addresses are skipped and reported in the response
- All `data` values are automatically converted to strings for FCM compatibility

---

## Error Handling

### Common Error Responses

#### 400 Bad Request
```json
{
  "error": "Invalid email format",
  "message": "Please provide a valid email address"
}
```

#### 401 Unauthorized
```json
{
  "error": "Unauthorized",
  "message": "Missing or invalid API key"
}
```

#### 404 Not Found
```json
{
  "error": "User not found",
  "message": "No user found with the provided email"
}
```

#### 500 Internal Server Error
```json
{
  "error": "Internal Server Error",
  "message": "An unexpected error occurred. Please try again later."
}
```

### Notification-Specific Errors

#### No Valid Users Found
```json
{
  "success": false,
  "error": "No users found with valid FCM tokens",
  "targetEmails": ["user@example.com"],
  "validEmails": [],
  "invalidEmails": ["user@example.com"]
}
```

#### FCM Service Unavailable
```json
{
  "success": false,
  "error": "FCM service unavailable",
  "message": "Firebase Cloud Messaging API is not enabled. Please contact your administrator."
}
```

---

## Best Practices

### 1. Error Handling
- Always check the `success` field in responses
- Handle 401 errors by verifying your API key
- Implement retry logic for 500 errors
- Log errors for debugging purposes

### 2. User Creation
- Use descriptive temporary passwords
- Always provide first and last names
- Consider user privacy when creating accounts

### 3. Notifications
- Keep notification titles under 50 characters
- Use clear, actionable body text
- Include relevant data for deep linking
- Test with small groups before bulk sends

### 4. Security
- Never expose API keys in client-side code
- Use HTTPS for all requests
- Implement rate limiting in your integration
- Monitor API usage for unusual patterns

---

## Integration Examples

### 1. Complete User Onboarding Flow

```bash
#!/bin/bash

# Create a new premium user
USER_RESPONSE=$(curl -s -X POST https://your-backend-url.vercel.app/api/ghl/create-user \
  -H "X-API-Key: your-ghl-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "newuser@example.com",
    "firstName": "John",
    "lastName": "Doe",
    "tempPassword": "Welcome123!"
  }')

echo "User creation response: $USER_RESPONSE"

# Extract UID from response (requires jq)
USER_UID=$(echo $USER_RESPONSE | jq -r '.uid')

# Mark as triple hugger
curl -X POST https://your-backend-url.vercel.app/api/ghl/make-triple-hugger \
  -H "X-API-Key: your-ghl-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "newuser@example.com"
  }'

# Send welcome notification
curl -X POST https://your-backend-url.vercel.app/api/ghl/send-notification \
  -H "X-API-Key: your-ghl-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Welcome to My Daily Hug!",
    "body": "Your premium account is ready. Click to get started!",
    "targetEmails": ["newuser@example.com"],
    "data": {
      "type": "welcome",
      "action": "view_dashboard"
    }
  }'
```

### 2. Account Status Management

```bash
#!/bin/bash

# Deactivate user account
curl -X POST https://your-backend-url.vercel.app/api/ghl/make-inactive \
  -H "X-API-Key: your-ghl-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com"
  }'

# Send deactivation notification
curl -X POST https://your-backend-url.vercel.app/api/ghl/send-notification \
  -H "X-API-Key: your-ghl-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Account Temporarily Suspended",
    "body": "Your account has been temporarily suspended. Contact support for assistance.",
    "targetEmails": ["user@example.com"],
    "data": {
      "type": "account_suspended",
      "action": "contact_support"
    }
  }'

# Later, reactivate the account
curl -X POST https://your-backend-url.vercel.app/api/ghl/make-active \
  -H "X-API-Key: your-ghl-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com"
  }'
```

### 3. Bulk User Management

```bash
#!/bin/bash

# List of users to process
USERS=("user1@example.com" "user2@example.com" "user3@example.com")

# Create trial users
for email in "${USERS[@]}"; do
  curl -X POST https://your-backend-url.vercel.app/api/ghl/create-trial-user \
    -H "X-API-Key: your-ghl-api-key" \
    -H "Content-Type: application/json" \
    -d "{
      \"email\": \"$email\",
      \"firstName\": \"Trial\",
      \"lastName\": \"User\"
    }"
done

# Send bulk notification
curl -X POST https://your-backend-url.vercel.app/api/ghl/send-notification \
  -H "X-API-Key: your-ghl-api-key" \
  -H "Content-Type: application/json" \
  -d "{
    \"title\": \"Trial Account Activated\",
    \"body\": \"Your 7-day trial has started. Explore all premium features!\",
    \"targetEmails\": $(printf '%s\n' "${USERS[@]}" | jq -R . | jq -s .),
    \"data\": {
      \"type\": \"trial_started\",
      \"action\": \"explore_features\"
    }
  }"
```

---

## Support and Troubleshooting

### Common Issues

1. **401 Unauthorized**: Check your API key and ensure it's correctly set in the `X-API-Key` header
2. **404 User Not Found**: Verify the email address exists in Firebase Auth
3. **500 Internal Server Error**: Check server logs for detailed error information
4. **Notification Not Received**: Ensure the user has a valid FCM token and messaging is enabled

### Getting Help

- Check the server logs for detailed error messages
- Verify your API key is correct and has proper permissions
- Test with a single user before implementing bulk operations
- Contact your system administrator for API key issues

### Rate Limits

The API implements rate limiting to prevent abuse. If you encounter rate limit errors:
- Implement exponential backoff in your retry logic
- Reduce the frequency of requests
- Consider batching operations where possible

---

*This manual covers all GHL endpoints available in the My Daily Hug backend. For additional support or feature requests, contact your system administrator.*
