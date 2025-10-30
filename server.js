require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const admin = require('firebase-admin');

const app = express();
const PORT = process.env.PORT || 3001;

// Trust proxy headers (needed on Vercel and other proxies)
app.set('trust proxy', 1);

// Initialize Firebase Admin SDK
console.log('Initializing Firebase Admin SDK...');
console.log('FIREBASE_PROJECT_ID:', process.env.FIREBASE_PROJECT_ID ? 'SET' : 'MISSING');
console.log('FIREBASE_CLIENT_EMAIL:', process.env.FIREBASE_CLIENT_EMAIL ? 'SET' : 'MISSING');
console.log('FIREBASE_PRIVATE_KEY:', process.env.FIREBASE_PRIVATE_KEY ? 'SET' : 'MISSING');

// Validate required environment variables
if (!process.env.FIREBASE_PROJECT_ID) {
  console.error('FIREBASE_PROJECT_ID environment variable is required');
  process.exit(1);
}

if (!process.env.FIREBASE_CLIENT_EMAIL) {
  console.error('FIREBASE_CLIENT_EMAIL environment variable is required');
  process.exit(1);
}

if (!process.env.FIREBASE_PRIVATE_KEY) {
  console.error('FIREBASE_PRIVATE_KEY environment variable is required');
  process.exit(1);
}

const serviceAccount = {
  type: "service_account",
  project_id: process.env.FIREBASE_PROJECT_ID,
  private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
  private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  client_email: process.env.FIREBASE_CLIENT_EMAIL,
  client_id: process.env.FIREBASE_CLIENT_ID,
  auth_uri: "https://accounts.google.com/o/oauth2/auth",
  token_uri: "https://oauth2.googleapis.com/token",
  auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs",
  client_x509_cert_url: `https://www.googleapis.com/robot/v1/metadata/x509/${process.env.FIREBASE_CLIENT_EMAIL}`
};

try {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: process.env.FIREBASE_PROJECT_ID
  });
  console.log('Firebase Admin SDK initialized successfully');
} catch (error) {
  console.error('Failed to initialize Firebase Admin SDK:', error);
  process.exit(1);
}

const db = admin.firestore();

// Helper function for HTTP/1.x query parameter parsing
function parseQueryParams(req, paramName) {
  // First try standard req.query
  if (req.query && req.query[paramName]) {
    return req.query[paramName]
  }
  
  // Manual parsing fallback for HTTP/1.x compatibility
  if (req.url && req.url.includes(`${paramName}=`)) {
    const urlParams = new URLSearchParams(req.url.split('?')[1] || '')
    return urlParams.get(paramName)
  }
  
  return null
}

// Helper function to normalize request body and extract parameters with query fallback
function normalizeRequestBody(req, paramNames = []) {
  // Normalize body: handle string bodies (HTTP/1.x proxies), urlencoded, or JSON
  let normalized = req.body
  if (typeof normalized === 'string') {
    try { normalized = JSON.parse(normalized) } catch { normalized = {} }
  }
  // Graceful handling for proxies that drop JSON body on HTTP/1.x
  const bodyPayload = (normalized && Object.keys(normalized || {}).length > 0) ? normalized : null
  
  const result = {}
  for (const paramName of paramNames) {
    result[paramName] = bodyPayload?.[paramName] || parseQueryParams(req, paramName)
  }
  
  return result
}

// Helper: persist messages for targeted users in Firestore
async function saveMessagesForUsers(targetUserIds, payload, meta = {}) {
  if (!Array.isArray(targetUserIds) || targetUserIds.length === 0) return;
  try {
    console.log(`Persisting user_messages for ${targetUserIds.length} users`, {
      sampleUid: targetUserIds[0],
      title: payload?.title,
      targetType: meta?.targetType,
      source: meta?.source
    })
  } catch (_) {}
  const createdAt = admin.firestore.FieldValue.serverTimestamp();
  const writes = [];
  for (const uid of targetUserIds) {
    const doc = {
      uid,
      title: payload?.title || '',
      body: payload?.body || '',
      data: payload?.data || {},
      icon: payload?.icon || null,
      badge: payload?.badge || null,
      source: meta.source || 'backend-service',
      targetType: meta.targetType || null,
      creationEndpoint: meta.creationEndpoint || null,
      dismissed: 'No',
      createdAt
    };
    writes.push(db.collection('user_messages').add(doc));
  }
  const results = await Promise.allSettled(writes);
  const failed = results.filter(r => r.status === 'rejected');
  if (failed.length > 0) {
    console.error('One or more user_messages writes failed', failed.map(f => f.reason?.message || f.reason))
  } else {
    console.log('Successfully persisted user_messages for all targeted users')
  }
}

// Middleware
app.use(helmet());
app.use(cors({
  origin: [
    'https://app.mydailyhug.com',
    'https://app.dailyhug.com',
    'http://localhost:8080',
    'http://localhost:3000'
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json({ limit: '10mb' }));
// Accept urlencoded and text bodies to improve HTTP/1.x compatibility
app.use(express.urlencoded({ extended: true }));
app.use(express.text({ type: ['text/*', 'application/json'], limit: '10mb' }));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});
app.use('/api/', limiter);

// Authentication middleware for admin endpoints
const authenticateAdmin = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: 'Authorization header required'
      });
    }

    const idToken = authHeader.split('Bearer ')[1];
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    
    // Check if user has admin role in Firestore
    const userDoc = await db.collection('users').doc(decodedToken.uid).get();
    if (!userDoc.exists || userDoc.data().userType !== 'admin') {
      return res.status(403).json({
        success: false,
        error: 'Admin access required'
      });
    }

    req.user = decodedToken;
    // Attach admin profile/name for downstream handlers
    const profile = userDoc.data() || {}
    const profileName = (profile.displayName && String(profile.displayName).trim())
      || `${profile.firstName || ''} ${profile.lastName || ''}`.trim()
      || decodedToken.name
      || decodedToken.email
      || 'Admin'
    req.adminProfile = profile
    req.adminDisplayName = profileName
    next();
  } catch (error) {
    console.error('Authentication error:', error);
    res.status(401).json({
      success: false,
      error: 'Invalid or expired token'
    });
  }
};

// Authentication middleware for GHL integrations using static API key
const authenticateApiKey = (req, res, next) => {
  try {
    const providedKey = req.header('X-API-Key') || req.header('x-api-key')
    if (!providedKey) {
      return res.status(401).json({ success: false, error: 'X-API-Key header required' })
    }

    const expectedKey = process.env.GHL_API_KEY
    if (!expectedKey) {
      console.error('GHL_API_KEY not configured')
      return res.status(500).json({ success: false, error: 'Server configuration error' })
    }

    if (providedKey !== expectedKey) {
      return res.status(403).json({ success: false, error: 'Invalid API key' })
    }

    next()
  } catch (error) {
    console.error('API key authentication error:', error)
    res.status(401).json({ success: false, error: 'Unauthorized' })
  }
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Firebase connectivity test endpoint
app.get('/api/test-firebase', async (req, res) => {
  try {
    console.log('Testing Firebase connectivity...');
    
    // Test Firestore connection
    const testDoc = await db.collection('test').doc('connectivity').get();
    console.log('Firestore connection: OK');
    
    // Test Firebase Auth connection
    try {
      await admin.auth().listUsers(1);
      console.log('Firebase Auth connection: OK');
    } catch (authError) {
      console.error('Firebase Auth error:', authError);
      return res.status(500).json({
        success: false,
        error: 'Firebase Auth connection failed',
        details: authError.message
      });
    }
    
    // Test FCM connection with a dummy token
    try {
      const dummyToken = 'dummy-token-for-testing';
      await admin.messaging().send({
        token: dummyToken,
        notification: { title: 'Test', body: 'Test' }
      });
    } catch (fcmError) {
      console.log('FCM test error (expected):', fcmError.code);
      if (fcmError.code === 'messaging/registration-token-not-registered') {
        console.log('FCM connection: OK (invalid token error is expected)');
      } else if (fcmError.code === 'messaging/unknown-error' && fcmError.message.includes('404')) {
        console.error('FCM connection: FAILED - 404 error indicates Firebase project/API issue');
        return res.status(500).json({
          success: false,
          error: 'FCM API not available - check Firebase project configuration',
          details: fcmError.message,
          suggestion: 'Enable Firebase Cloud Messaging API in Google Cloud Console'
        });
      } else {
        console.error('FCM connection: FAILED - unexpected error:', fcmError);
        return res.status(500).json({
          success: false,
          error: 'FCM connection failed',
          details: fcmError.message
        });
      }
    }
    
    res.json({
      success: true,
      message: 'Firebase connectivity test passed',
      firestore: 'OK',
      auth: 'OK',
      fcm: 'OK',
      projectId: process.env.FIREBASE_PROJECT_ID
    });
    
  } catch (error) {
    console.error('Firebase connectivity test failed:', error);
    res.status(500).json({
      success: false,
      error: 'Firebase connectivity test failed',
      details: error.message,
      projectId: process.env.FIREBASE_PROJECT_ID
    });
  }
});

// FCM token validation endpoint
app.get('/api/validate-tokens', async (req, res) => {
  try {
    console.log('Validating FCM tokens...');
    
    // Get all users with FCM tokens
    const snapshot = await db.collection('users').get();
    const users = snapshot.docs.map(doc => ({
      uid: doc.id,
      email: doc.data().email,
      fcmToken: doc.data().fcmToken
    })).filter(user => user.fcmToken && user.fcmToken.trim() !== '');
    
    console.log(`Found ${users.length} users with FCM tokens`);
    
    // Test each token individually
    const validationResults = [];
    for (const user of users) {
      try {
        await admin.messaging().send({
          token: user.fcmToken,
          notification: { title: 'Token Validation', body: 'Testing token validity' }
        });
        validationResults.push({
          uid: user.uid,
          email: user.email,
          token: user.fcmToken.substring(0, 20) + '...',
          status: 'valid'
        });
      } catch (error) {
        validationResults.push({
          uid: user.uid,
          email: user.email,
          token: user.fcmToken.substring(0, 20) + '...',
          status: 'invalid',
          error: error.code || 'unknown'
        });
      }
    }
    
    const validTokens = validationResults.filter(r => r.status === 'valid');
    const invalidTokens = validationResults.filter(r => r.status === 'invalid');
    
    res.json({
      success: true,
      total: users.length,
      valid: validTokens.length,
      invalid: invalidTokens.length,
      validTokens,
      invalidTokens
    });
    
  } catch (error) {
    console.error('Token validation failed:', error);
    res.status(500).json({
      success: false,
      error: 'Token validation failed',
      details: error.message
    });
  }
});

// Send notification endpoint
app.post('/api/send-notification', async (req, res) => {
  try {
    const { 
      title, 
      body, 
      targetType = 'all', 
      targetUsers = [], 
      targetTokens = [],
      targetEmails = [],
      icon, 
      badge, 
      data 
    } = req.body;

    // Validation
    if (!title || !body) {
      return res.status(400).json({
        success: false,
        error: 'Title and body are required'
      });
    }

    if (!['all', 'admin', 'user', 'specific'].includes(targetType)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid targetType'
      });
    }

    // Validate targetTokens for specific type
    if (targetType === 'specific' && (!targetTokens || !Array.isArray(targetTokens) || targetTokens.length === 0)) {
      return res.status(400).json({
        success: false,
        error: 'targetTokens array is required for specific targeting'
      });
    }

    let tokens = [];
    let targetUserIdsForPersistence = [];
    let message;
    let response;

    // If targetEmails provided, resolve emails to UIDs and tokens first (non-GHL support)
    if (Array.isArray(targetEmails) && targetEmails.length > 0) {
      try {
        console.log('Resolving targetEmails for standard endpoint:', { count: targetEmails.length })
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
        const invalidEmails = targetEmails.filter(e => !emailRegex.test(e))
        if (invalidEmails.length > 0) {
          return res.status(400).json({ success: false, error: `Invalid email format(s): ${invalidEmails.join(', ')}` })
        }

        const tokenAndUidPromises = targetEmails.map(async (email) => {
          try {
            const userRecord = await admin.auth().getUserByEmail(email)
            const userDoc = await db.collection('users').doc(userRecord.uid).get()
            const userData = userDoc.exists ? userDoc.data() : {}
            const token = userData?.fcmToken && String(userData.fcmToken).trim() !== '' ? userData.fcmToken : null
            return { uid: userRecord.uid, token }
          } catch (err) {
            if (err && err.code === 'auth/user-not-found') {
              console.warn('User not found for email:', email)
              return null
            }
            throw err
          }
        })

        const tokenAndUidResults = await Promise.all(tokenAndUidPromises)
        const existingUsers = tokenAndUidResults.filter(r => r !== null)
        const allTokensFromEmails = existingUsers.map(r => r.token).filter(t => t !== null)
        const allUidsFromEmails = existingUsers.map(r => r.uid)

        // Persist messages for all resolved UIDs regardless of token availability
        if (allUidsFromEmails.length > 0) {
          console.log('Preparing to persist user_messages (standard via emails):', { count: allUidsFromEmails.length, sampleUid: allUidsFromEmails[0] })
          try {
            await saveMessagesForUsers(allUidsFromEmails, { title, body, data, icon, badge }, { source: 'backend-service', targetType: 'email', creationEndpoint: 'send_notification' })
          } catch (e) {
            console.error('Failed to persist user_messages (standard via emails):', e)
          }
        }

        // Continue with tokens derived from emails
        tokens = allTokensFromEmails
      } catch (e) {
        console.error('Error resolving emails for standard endpoint:', e?.message || e)
      }
    }

    switch (targetType) {
      case 'specific':
        tokens = targetTokens;
        // Resolve UIDs for persistence with a two-pass strategy:
        // 1) By fcmToken match in users collection
        // 2) If not found, attempt to derive UID via Authentication lookups by email if provided in data (optional)
        try {
          const uidByToken = await Promise.all(
            (targetTokens || []).map(async (tok) => {
              try {
                const snap = await db.collection('users').where('fcmToken', '==', tok).limit(1).get();
                if (!snap.empty) return snap.docs[0].id;
                return null;
              } catch (e) {
                console.error('Error resolving uid for token:', tok?.substring(0, 20) + '...', e?.message || e);
                return null;
              }
            })
          );

          const uids = uidByToken.filter(Boolean);

          // Optional: if request includes data.email, try to resolve via Auth
          if ((!uids || uids.length === 0) && data && typeof data.email === 'string') {
            try {
              const userRecord = await admin.auth().getUserByEmail(data.email)
              if (userRecord && userRecord.uid) uids.push(userRecord.uid)
            } catch (err) {
              if (err && err.code === 'auth/user-not-found') {
                console.warn('Specific targeting: email not found in Auth:', data.email)
              } else {
                console.error('Specific targeting: error looking up email in Auth:', err?.message || err)
              }
            }
          }

          targetUserIdsForPersistence = [...new Set(uids)]
          if (targetUserIdsForPersistence.length > 0) {
            console.log('Resolved UIDs for specific targeting:', {
              count: targetUserIdsForPersistence.length,
              sampleUid: targetUserIdsForPersistence[0]
            })
          } else {
            console.log('No UIDs resolved for specific targeting; persistence will be skipped')
          }
        } catch (e) {
          console.error('Failed resolving UIDs for specific targeting:', e?.message || e);
        }
        break;

      case 'all':
      case 'admin':
      case 'user':
        if (targetUsers.length > 0) {
          // Get tokens for specific users
          const userPromises = targetUsers.map(async (userId) => {
            const userDoc = await db.collection('users').doc(userId).get();
            return userDoc.exists ? userDoc.data().fcmToken : null;
          });
          
          const userTokens = await Promise.all(userPromises);
          const allTokens = userTokens.filter(token => token !== null);
          // Persist messages for the explicitly targeted users regardless of token availability
          targetUserIdsForPersistence = [...new Set(targetUsers)];
          
          // Validate each token before adding to final list
          console.log(`Found ${allTokens.length} tokens for specific users, validating...`);
          tokens = [];
          for (const token of allTokens) {
            try {
              await admin.messaging().send({
                token: token,
                notification: { title: 'Validation', body: 'Testing token' }
              });
              tokens.push(token);
            } catch (error) {
              console.log(`Token ${token.substring(0, 20)}... is invalid for specific user:`, error.code);
            }
          }
          console.log(`Validated ${tokens.length} tokens for specific users`);
        } else {
          // Get tokens based on user type
          let query = db.collection('users');
          
          if (targetType !== 'all') {
            query = query.where('userType', '==', targetType);
          }
          
          const snapshot = await query.get();
          // Persist messages for all users matching the criteria regardless of token availability
          targetUserIdsForPersistence = snapshot.docs.map(doc => doc.id);
          const allTokens = snapshot.docs
            .map(doc => {
              const userData = doc.data();
              // Only include users with valid FCM tokens (messaging enabled)
              return userData.fcmToken && userData.fcmToken.trim() !== '' ? userData.fcmToken : null;
            })
            .filter(token => token !== null && token !== undefined);
          
          // Validate each token before adding to final list
          console.log(`Found ${allTokens.length} tokens for ${targetType} users, validating...`);
          tokens = [];
          for (const token of allTokens) {
            try {
              await admin.messaging().send({
                token: token,
                notification: { title: 'Validation', body: 'Testing token' }
              });
              tokens.push(token);
            } catch (error) {
              console.log(`Token ${token.substring(0, 20)}... is invalid for ${targetType}:`, error.code);
            }
          }
          console.log(`Validated ${tokens.length} tokens for ${targetType} users`);
        }
        break;

      default:
        return res.status(400).json({
          success: false,
          error: 'Invalid target type'
        });
    }

    // Persist messages for targeted users (admins/users/specific users by uid). Not for 'specific' tokens-only targeting
    if (Array.isArray(targetUserIdsForPersistence) && targetUserIdsForPersistence.length > 0) {
      console.log('Preparing to persist user_messages (standard endpoint):', {
        count: targetUserIdsForPersistence.length,
        sampleUid: targetUserIdsForPersistence[0],
        targetType
      })
      try {
        await saveMessagesForUsers(targetUserIdsForPersistence, { title, body, data, icon, badge }, { source: 'backend-service', targetType, creationEndpoint: 'send_notification' });
      } catch (e) {
        console.error('Failed to persist user_messages:', e);
      }
    }

    if (tokens.length === 0) {
      return res.json({
        success: false,
        error: 'No users with messaging enabled found for the specified criteria'
      });
    }

    // Prepare notification payload
    // Convert all data values to strings (FCM requirement)
    const stringifiedData = {}
    if (data && typeof data === 'object') {
      Object.keys(data).forEach(key => {
        stringifiedData[key] = String(data[key])
      })
    }
    
    message = {
      notification: {
        title,
        body
      },
      data: {
        ...stringifiedData,
        timestamp: Date.now().toString(),
        source: 'backend-service'
      },
      webpush: {
        notification: {
          icon: icon || '/MDH_favicon.png',
          badge: badge || '/MDH_favicon.png'
        },
        fcm_options: {
          link: process.env.FRONTEND_URL || 'http://localhost:8080'
        }
      }
    };

    // Send notifications using multicast for better performance
    console.log(`Sending notification to ${tokens.length} tokens`);
    console.log('Message payload:', JSON.stringify(message, null, 2));
    
    if (tokens.length === 1) {
      // Single token - use send method
      try {
        console.log('Sending to single token:', tokens[0].substring(0, 20) + '...');
        response = await admin.messaging().send({ ...message, token: tokens[0] });
        console.log('Single token send successful:', response);
        res.json({
          success: true,
          messageId: response,
          stats: {
            total: 1,
            successful: 1,
            failed: 0
          }
        });
      } catch (error) {
        console.error('Failed to send to single token:', error);
        console.error('Error details:', {
          code: error.code,
          message: error.message,
          stack: error.stack
        });
        if (error.code === 'messaging/registration-token-not-registered') {
          res.json({
            success: false,
            error: 'Invalid or expired FCM token',
            stats: {
              total: 1,
              successful: 0,
              failed: 1
            }
          });
        } else {
          throw error;
        }
      }
    } else {
      // Multiple tokens - tokens are already validated, send directly
      console.log('Sending multicast to validated tokens:', tokens.map(t => t.substring(0, 20) + '...'));
      
      try {
        response = await admin.messaging().sendMulticast({ ...message, tokens });
        console.log('Multicast send response:', {
          successCount: response.successCount,
          failureCount: response.failureCount,
          responses: response.responses.length
        });
        
        const successful = response.successCount;
        const failed = response.failureCount;

        res.json({
          success: true,
          messageId: response.responses?.[0]?.messageId,
          stats: {
            total: tokens.length,
            successful,
            failed
          },
          message: `${successful} notifications sent successfully`
        });
      } catch (error) {
        console.error('Failed to send multicast:', error);
        console.error('Error details:', {
          code: error.code,
          message: error.message,
          stack: error.stack
        });
        
        // Handle FCM API not enabled error
        if (error.code === 'messaging/unknown-error' && error.message.includes('404')) {
          return res.status(503).json({
            success: false,
            error: 'Firebase Cloud Messaging API not enabled',
            details: 'The FCM API is not enabled for this Firebase project',
            suggestion: 'Enable Firebase Cloud Messaging API in Google Cloud Console',
            tokensFound: tokens.length,
            projectId: process.env.FIREBASE_PROJECT_ID
          });
        }
        
        throw error;
      }
    }

  } catch (error) {
    console.error('Error sending notification:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error'
    });
  }
});

// Get notification stats endpoint
app.get('/api/notification-stats', async (req, res) => {
  try {
    const snapshot = await db.collection('users').get();
    const users = snapshot.docs.map(doc => doc.data());
    
    const stats = {
      totalUsers: users.length,
      usersWithNotifications: users.filter(user => user.fcmToken).length,
      admins: users.filter(user => user.userType === 'admin').length,
      regularUsers: users.filter(user => user.userType === 'user').length
    };

    res.json(stats);
  } catch (error) {
    console.error('Error getting stats:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// Grant Admin role (by email). If Auth user doesn't exist, create it and create/merge profile (admin only)
app.post('/api/grant-admin', authenticateAdmin, async (req, res) => {
  try {
    console.log('Grant admin request received:', { body: req.body })
    const { email, firstName = '', lastName = '', tempPassword } = req.body || {}

    if (!email || typeof email !== 'string') {
      console.log('Invalid email provided:', email)
      return res.status(400).json({ success: false, error: 'Valid email is required' })
    }

    // Basic email format validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(email)) {
      console.log('Invalid email format:', email)
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid email format' 
      })
    }

    // Find or create Auth user
    let userRecord
    try {
      console.log('Looking up user by email:', email)
      userRecord = await admin.auth().getUserByEmail(email)
      console.log('User found:', userRecord.uid)
    } catch (err) {
      if (err && err.code === 'auth/user-not-found') {
        console.log('User not found, creating new user')
        // Create with temporary password if provided (or generate one)
        const generated = tempPassword || Math.random().toString(36).slice(-8) + Math.random().toString(36).slice(-4)
        userRecord = await admin.auth().createUser({ email, password: generated })
        console.log('New user created:', userRecord.uid)
        console.log('Generated temp password:', generated)
        // Store for response
        userRecord._generatedTempPassword = generated
      } else {
        console.error('Error looking up user:', err)
        throw err
      }
    }

    // Handle password for existing users or use generated password for new users
    let effectiveTempPassword = userRecord._generatedTempPassword || null
    if (!effectiveTempPassword && tempPassword) {
      // User already existed and tempPassword was provided
      await admin.auth().updateUser(userRecord.uid, { password: tempPassword })
      effectiveTempPassword = tempPassword
    }
    
    console.log('Effective temp password:', effectiveTempPassword ? 'Generated/Set' : 'None')

    // Set custom claim requiring password change on first sign-in
    console.log('Setting custom claims for user:', userRecord.uid)
    await admin.auth().setCustomUserClaims(userRecord.uid, {
      mustChangePassword: true,
      // preserve existing claims if needed in a real implementation (fetch then merge)
    })

    // Update Firestore profile: set admin role and names if provided
    const uid = userRecord.uid
    const displayName = `${firstName || ''} ${lastName || ''}`.trim() || userRecord.displayName || ''
    
    // Prepare user data object
    const userData = {
      uid,
      email,
      userType: 'admin',
      accountType: 'Admin-Created',
      creationEndpoint: 'grant_admin',
      createdBy: req.adminDisplayName || 'Admin',
      accountStatus: 'Active',
      is_triple_hugger: 'No',
      isDollarHugger: 'No',
      updatedAt: admin.firestore.Timestamp.now()
    }
    
    // Only add fields if they have values
    if (firstName) userData.firstName = firstName
    if (lastName) userData.lastName = lastName
    if (displayName) userData.displayName = displayName
    
    // Add temporary password if one was generated/set
    if (effectiveTempPassword) {
      userData.tempPassword = effectiveTempPassword
      userData.passwordGeneratedAt = admin.firestore.Timestamp.now()
    }
    
    // Set createdAt only for new users
    if (userRecord._generatedTempPassword) {
      userData.createdAt = admin.firestore.FieldValue.serverTimestamp()
    }
    
    console.log('Writing user data to Firestore:', { 
      ...userData, 
      tempPassword: userData.tempPassword ? '[REDACTED]' : undefined 
    })
    await db.collection('users').doc(uid).set(userData, { merge: true })
    console.log('Successfully wrote user data to Firestore')

    const response = {
      success: true,
      uid,
      email,
      message: 'Admin role granted with temporary password set',
      tempPassword: effectiveTempPassword || undefined
    }
    
    console.log('Sending response:', { ...response, tempPassword: effectiveTempPassword ? '[REDACTED]' : 'undefined' })
    res.json(response)
  } catch (error) {
    console.error('Error granting admin:', error)
    res.status(500).json({
      success: false,
      error: error?.message || 'Failed to grant admin role',
      code: error?.code || undefined
    })
  }
})

// Remove mustChangePassword custom claim endpoint
app.post('/api/remove-password-change-requirement', async (req, res) => {
  try {
    const { uid } = req.body;

    if (!uid) {
      return res.status(400).json({
        success: false,
        error: 'User ID is required'
      });
    }

    // Remove the mustChangePassword custom claim
    await admin.auth().setCustomUserClaims(uid, {
      mustChangePassword: false
    });

    res.json({
      success: true,
      message: 'Password change requirement removed'
    });

  } catch (error) {
    console.error('Error removing password change requirement:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error'
    });
  }
});

// Create new user endpoint (admin only)
app.post('/api/create-user', authenticateAdmin, async (req, res) => {
  try {
    console.log('Create user request received:', { body: req.body })
    const { email, firstName = '', lastName = '', tempPassword } = req.body || {}

    // Validate email format
    if (!email || typeof email !== 'string') {
      console.log('Invalid email provided:', email)
      return res.status(400).json({ 
        success: false, 
        error: 'Valid email is required' 
      })
    }

    // Basic email format validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(email)) {
      console.log('Invalid email format:', email)
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid email format' 
      })
    }

    // Find or create Auth user
    let userRecord
    try {
      console.log('Looking up user by email:', email)
      userRecord = await admin.auth().getUserByEmail(email)
      console.log('User already exists:', userRecord.uid)
      return res.status(409).json({
        success: false,
        error: 'User already exists with this email',
        uid: userRecord.uid
      })
    } catch (err) {
      if (err && err.code === 'auth/user-not-found') {
        console.log('User not found, creating new user')
        // Create with temporary password if provided (or generate one)
        const generated = tempPassword || Math.random().toString(36).slice(-8) + Math.random().toString(36).slice(-4)
        userRecord = await admin.auth().createUser({ email, password: generated })
        console.log('New user created:', userRecord.uid)
        console.log('Generated temp password:', generated)
        // Store for response
        userRecord._generatedTempPassword = generated
      } else {
        console.error('Error looking up user:', err)
        throw err
      }
    }

    // Handle password for existing users or use generated password for new users
    let effectiveTempPassword = userRecord._generatedTempPassword || null
    if (!effectiveTempPassword && tempPassword) {
      // User already existed and tempPassword was provided
      await admin.auth().updateUser(userRecord.uid, { password: tempPassword })
      effectiveTempPassword = tempPassword
    }
    
    console.log('Effective temp password:', effectiveTempPassword ? 'Generated/Set' : 'None')

    // Set custom claim requiring password change on first sign-in
    console.log('Setting custom claims for user:', userRecord.uid)
    await admin.auth().setCustomUserClaims(userRecord.uid, {
      mustChangePassword: true,
      // preserve existing claims if needed in a real implementation (fetch then merge)
    })

    // Update Firestore profile: set user role and names if provided
    const uid = userRecord.uid
    const displayName = `${firstName || ''} ${lastName || ''}`.trim() || userRecord.displayName || ''
    
    // Prepare user data object
    const userData = {
      uid,
      email,
      userType: 'user', // Regular user role
      accountType: 'Admin-Created',
      creationEndpoint: 'create_user',
      createdBy: req.adminDisplayName || 'Admin',
      accountStatus: 'Active',
      is_triple_hugger: 'No',
      isDollarHugger: 'No',
      updatedAt: admin.firestore.Timestamp.now()
    }
    
    // Only add fields if they have values
    if (firstName) userData.firstName = firstName
    if (lastName) userData.lastName = lastName
    if (displayName) userData.displayName = displayName
    
    // Add temporary password if one was generated/set
    if (effectiveTempPassword) {
      userData.tempPassword = effectiveTempPassword
      userData.passwordGeneratedAt = admin.firestore.Timestamp.now()
    }
    
    // Set createdAt only for new users
    if (userRecord._generatedTempPassword) {
      userData.createdAt = admin.firestore.FieldValue.serverTimestamp()
    }
    
    console.log('Writing user data to Firestore:', { 
      ...userData, 
      tempPassword: userData.tempPassword ? '[REDACTED]' : undefined 
    })
    await db.collection('users').doc(uid).set(userData, { merge: true })
    console.log('Successfully wrote user data to Firestore')

    const response = {
      success: true,
      email,
      uid,
      tempPassword: effectiveTempPassword || undefined
    }
    
    console.log('Sending response:', { ...response, tempPassword: effectiveTempPassword ? '[REDACTED]' : 'undefined' })
    res.json(response)
  } catch (error) {
    console.error('Error creating user:', error)
    res.status(500).json({
      success: false,
      error: error?.message || 'Failed to create user',
      code: error?.code || undefined
    })
  }
})

// Get all users endpoint
app.get('/api/users', async (req, res) => {
  try {
    const snapshot = await db.collection('users').get();
    const users = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
      createdAt: doc.data().createdAt?.toDate?.() || null,
      updatedAt: doc.data().updatedAt?.toDate?.() || null
    }));

    res.json({
      success: true,
      users,
      total: users.length
    });
  } catch (error) {
    console.error('Error getting users:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// GHL: Create new user via API key (no Firebase token required)
app.post('/api/ghl/create-user', authenticateApiKey, async (req, res) => {
  try {
    console.log('GHL create user request received:', { body: req.body })
    
    const { email, firstName = '', lastName = '', tempPassword } = normalizeRequestBody(req, ['email', 'firstName', 'lastName', 'tempPassword'])

    // Validate email format
    if (!email || typeof email !== 'string') {
      console.log('Invalid email provided:', email)
      return res.status(400).json({ success: false, error: 'Valid email is required' })
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(email)) {
      console.log('Invalid email format:', email)
      return res.status(400).json({ success: false, error: 'Invalid email format' })
    }

    // Check duplicates
    let userRecord
    try {
      console.log('Looking up user by email:', email)
      userRecord = await admin.auth().getUserByEmail(email)
      console.log('User already exists:', userRecord.uid)
      return res.status(409).json({ success: false, error: 'User already exists with this email', uid: userRecord.uid })
    } catch (err) {
      if (!(err && err.code === 'auth/user-not-found')) {
        console.error('Error looking up user:', err)
        throw err
      }
    }

    // Create new user
    const generated = tempPassword || Math.random().toString(36).slice(-8) + Math.random().toString(36).slice(-4)
    userRecord = await admin.auth().createUser({ email, password: generated })
    console.log('New user created (GHL):', userRecord.uid)

    // Enforce password change on first sign-in
    await admin.auth().setCustomUserClaims(userRecord.uid, { mustChangePassword: true })

    // Build Firestore data
    const uid = userRecord.uid
    const displayName = `${firstName || ''} ${lastName || ''}`.trim() || userRecord.displayName || ''
    const userData = {
      uid,
      email,
      userType: 'user',
      accountType: 'Premium',
      creationEndpoint: 'ghl_create_user',
      createdBy: 'GHL',
      accountStatus: 'Active',
      is_triple_hugger: 'No',
      isDollarHugger: 'No',
      updatedAt: admin.firestore.Timestamp.now(),
      tempPassword: generated,
      passwordGeneratedAt: admin.firestore.Timestamp.now()
    }
    if (firstName) userData.firstName = firstName
    if (lastName) userData.lastName = lastName
    if (displayName) userData.displayName = displayName
    userData.createdAt = admin.firestore.FieldValue.serverTimestamp()

    console.log('Writing user (GHL) to Firestore:', { ...userData, tempPassword: '[REDACTED]' })
    await db.collection('users').doc(uid).set(userData, { merge: true })

    const response = { success: true, email, uid, tempPassword: generated }
    console.log('GHL create-user response:', { ...response, tempPassword: '[REDACTED]' })
    res.json(response)
  } catch (error) {
    console.error('Error creating user (GHL):', error)
    res.status(500).json({ success: false, error: error?.message || 'Failed to create user', code: error?.code || undefined })
  }
})

// GHL: Create trial user via API key (accountType: "Trial")
app.post('/api/ghl/create-trial-user', authenticateApiKey, async (req, res) => {
  try {
    console.log('GHL create trial user request received:', { body: req.body })
    
    const { email, firstName = '', lastName = '', tempPassword } = normalizeRequestBody(req, ['email', 'firstName', 'lastName', 'tempPassword'])

    // Validate email format
    if (!email || typeof email !== 'string') {
      console.log('Invalid email provided:', email)
      return res.status(400).json({ success: false, error: 'Valid email is required' })
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(email)) {
      console.log('Invalid email format:', email)
      return res.status(400).json({ success: false, error: 'Invalid email format' })
    }

    // Check duplicates
    let userRecord
    try {
      console.log('Looking up user by email:', email)
      userRecord = await admin.auth().getUserByEmail(email)
      console.log('User already exists:', userRecord.uid)
      return res.status(409).json({ success: false, error: 'User already exists with this email', uid: userRecord.uid })
    } catch (err) {
      if (!(err && err.code === 'auth/user-not-found')) {
        console.error('Error looking up user:', err)
        throw err
      }
    }

    // Create new user
    const generated = tempPassword || Math.random().toString(36).slice(-8) + Math.random().toString(36).slice(-4)
    userRecord = await admin.auth().createUser({ email, password: generated })
    console.log('New trial user created (GHL):', userRecord.uid)

    // Enforce password change on first sign-in
    await admin.auth().setCustomUserClaims(userRecord.uid, { mustChangePassword: true })

    // Build Firestore data
    const uid = userRecord.uid
    const displayName = `${firstName || ''} ${lastName || ''}`.trim() || userRecord.displayName || ''
    const userData = {
      uid,
      email,
      userType: 'user',
      accountType: 'Trial',
      creationEndpoint: 'ghl_create_trial_user',
      createdBy: 'GHL',
      accountStatus: 'Active',
      is_triple_hugger: 'No',
      isDollarHugger: 'No',
      updatedAt: admin.firestore.Timestamp.now(),
      tempPassword: generated,
      passwordGeneratedAt: admin.firestore.Timestamp.now()
    }
    if (firstName) userData.firstName = firstName
    if (lastName) userData.lastName = lastName
    if (displayName) userData.displayName = displayName
    userData.createdAt = admin.firestore.FieldValue.serverTimestamp()

    console.log('Writing trial user (GHL) to Firestore:', { ...userData, tempPassword: '[REDACTED]' })
    await db.collection('users').doc(uid).set(userData, { merge: true })

    const response = { success: true, email, uid, tempPassword: generated }
    console.log('GHL create-trial-user response:', { ...response, tempPassword: '[REDACTED]' })
    res.json(response)
  } catch (error) {
    console.error('Error creating trial user (GHL):', error)
    res.status(500).json({ success: false, error: error?.message || 'Failed to create trial user', code: error?.code || undefined })
  }
})

// Create Dollar Hugger (admin only)
app.post('/api/create-dollar-hugger', authenticateAdmin, async (req, res) => {
  try {
    console.log('Create dollar hugger (admin) request received:', { body: req.body })
    const { email, firstName = '', lastName = '', tempPassword } = req.body || {}

    if (!email || typeof email !== 'string') {
      return res.status(400).json({ success: false, error: 'Valid email is required' })
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(email)) {
      return res.status(400).json({ success: false, error: 'Invalid email format' })
    }

    // Check if user already exists
    let userRecord
    try {
      userRecord = await admin.auth().getUserByEmail(email)
      // If the user already exists in Auth, update Firestore to mark as Dollar Hugger
      const uid = userRecord.uid
      const displayName = `${firstName || ''} ${lastName || ''}`.trim() || userRecord.displayName || ''
      const userRef = db.collection('users').doc(uid)
      const existing = await userRef.get()
      const userData = {
        uid,
        email,
        isDollarHugger: 'Yes',
        is_triple_hugger: 'No',
        updatedAt: admin.firestore.Timestamp.now(),
        creationEndpoint: 'create_dollar_hugger_existing',
        createdBy: req.adminDisplayName || 'Admin'
      }
      if (firstName) userData.firstName = firstName
      if (lastName) userData.lastName = lastName
      if (displayName) userData.displayName = displayName
      if (!existing.exists) {
        userData.userType = 'user'
        userData.accountType = 'Admin-Created'
        userData.accountStatus = 'Active'
        userData.createdAt = admin.firestore.FieldValue.serverTimestamp()
      }
      await userRef.set(userData, { merge: true })
      return res.json({ success: true, email, uid, updated: true, message: 'User already existed; isDollarHugger set to Yes' })
    } catch (err) {
      if (!(err && err.code === 'auth/user-not-found')) {
        console.error('Error looking up user:', err)
        throw err
      }
    }

    // Create new Auth user with temp password (provided or generated)
    const generated = tempPassword || Math.random().toString(36).slice(-8) + Math.random().toString(36).slice(-4)
    userRecord = await admin.auth().createUser({ email, password: generated })

    // Enforce password change on first sign-in
    await admin.auth().setCustomUserClaims(userRecord.uid, { mustChangePassword: true })

    const uid = userRecord.uid
    const displayName = `${firstName || ''} ${lastName || ''}`.trim() || userRecord.displayName || ''

    const userData = {
      uid,
      email,
      userType: 'user',
      accountType: 'Admin-Created',
      creationEndpoint: 'create_dollar_hugger',
      createdBy: req.adminDisplayName || 'Admin',
      accountStatus: 'Active',
      is_triple_hugger: 'No',
      isDollarHugger: 'Yes',
      updatedAt: admin.firestore.Timestamp.now(),
      tempPassword: generated,
      passwordGeneratedAt: admin.firestore.Timestamp.now()
    }
    if (firstName) userData.firstName = firstName
    if (lastName) userData.lastName = lastName
    if (displayName) userData.displayName = displayName
    userData.createdAt = admin.firestore.FieldValue.serverTimestamp()

    await db.collection('users').doc(uid).set(userData, { merge: true })

    return res.json({ success: true, email, uid, tempPassword: generated })
  } catch (error) {
    console.error('Error creating dollar hugger (admin):', error)
    res.status(500).json({ success: false, error: error?.message || 'Failed to create dollar hugger', code: error?.code || undefined })
  }
})

// GHL: Create Dollar Hugger (API key auth)
app.post('/api/ghl/create-dollar-hugger', authenticateApiKey, async (req, res) => {
  try {
    console.log('GHL create dollar hugger request received:', { body: req.body })
    const { email, firstName = '', lastName = '', tempPassword } = normalizeRequestBody(req, ['email', 'firstName', 'lastName', 'tempPassword'])

    if (!email || typeof email !== 'string') {
      return res.status(400).json({ success: false, error: 'Valid email is required' })
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(email)) {
      return res.status(400).json({ success: false, error: 'Invalid email format' })
    }

    // Check duplicates
    let userRecord
    try {
      userRecord = await admin.auth().getUserByEmail(email)
      // If the user already exists, update Firestore to mark as Dollar Hugger
      const uid = userRecord.uid
      const displayName = `${firstName || ''} ${lastName || ''}`.trim() || userRecord.displayName || ''
      const userRef = db.collection('users').doc(uid)
      const existing = await userRef.get()
      const userData = {
        uid,
        email,
        isDollarHugger: 'Yes',
        is_triple_hugger: 'No',
        updatedAt: admin.firestore.Timestamp.now(),
        creationEndpoint: 'ghl_create_dollar_hugger_existing',
        createdBy: 'GHL'
      }
      if (firstName) userData.firstName = firstName
      if (lastName) userData.lastName = lastName
      if (displayName) userData.displayName = displayName
      if (!existing.exists) {
        userData.userType = 'user'
        userData.accountType = 'Premium'
        userData.accountStatus = 'Active'
        userData.createdAt = admin.firestore.FieldValue.serverTimestamp()
      }
      await userRef.set(userData, { merge: true })
      return res.json({ success: true, email, uid, updated: true, message: 'User already existed; isDollarHugger set to Yes (GHL)' })
    } catch (err) {
      if (!(err && err.code === 'auth/user-not-found')) {
        console.error('Error looking up user:', err)
        throw err
      }
    }

    // Create new user
    const generated = tempPassword || Math.random().toString(36).slice(-8) + Math.random().toString(36).slice(-4)
    userRecord = await admin.auth().createUser({ email, password: generated })

    // Enforce password change on first sign-in
    await admin.auth().setCustomUserClaims(userRecord.uid, { mustChangePassword: true })

    // Build Firestore data
    const uid = userRecord.uid
    const displayName = `${firstName || ''} ${lastName || ''}`.trim() || userRecord.displayName || ''
    const userData = {
      uid,
      email,
      userType: 'user',
      accountType: 'Premium',
      creationEndpoint: 'ghl_create_dollar_hugger',
      createdBy: 'GHL',
      accountStatus: 'Active',
      is_triple_hugger: 'No',
      isDollarHugger: 'Yes',
      updatedAt: admin.firestore.Timestamp.now(),
      tempPassword: generated,
      passwordGeneratedAt: admin.firestore.Timestamp.now()
    }
    if (firstName) userData.firstName = firstName
    if (lastName) userData.lastName = lastName
    if (displayName) userData.displayName = displayName
    userData.createdAt = admin.firestore.FieldValue.serverTimestamp()

    await db.collection('users').doc(uid).set(userData, { merge: true })

    const response = { success: true, email, uid, tempPassword: generated }
    return res.json(response)
  } catch (error) {
    console.error('Error creating dollar hugger (GHL):', error)
    res.status(500).json({ success: false, error: error?.message || 'Failed to create dollar hugger', code: error?.code || undefined })
  }
})

// Make user inactive (admin only)
app.post('/api/make-inactive', authenticateAdmin, async (req, res) => {
  try {
    const { uid, email } = req.body || {}

    if (!uid && !email) {
      return res.status(400).json({ success: false, error: 'uid or email is required' })
    }

    let targetUid = uid
    if (!targetUid && email) {
      try {
        const userRecord = await admin.auth().getUserByEmail(email)
        targetUid = userRecord.uid
      } catch (err) {
        if (err && err.code === 'auth/user-not-found') {
          return res.status(404).json({ success: false, error: 'User not found for provided email' })
        }
        throw err
      }
    }

    await db.collection('users').doc(targetUid).set({
      accountStatus: 'Inactive',
      updatedAt: admin.firestore.Timestamp.now()
    }, { merge: true })

    res.json({ success: true, uid: targetUid, accountStatus: 'inactive' })
  } catch (error) {
    console.error('Error making user inactive (admin):', error)
    res.status(500).json({ success: false, error: error?.message || 'Internal server error' })
  }
})

// Make user inactive (GHL via API key)
app.post('/api/ghl/make-inactive', authenticateApiKey, async (req, res) => {
  try {
    const { uid, email } = normalizeRequestBody(req, ['uid', 'email'])

    if (!uid && !email) {
      return res.status(400).json({ success: false, error: 'uid or email is required' })
    }

    let targetUid = uid
    if (!targetUid && email) {
      try {
        const userRecord = await admin.auth().getUserByEmail(email)
        targetUid = userRecord.uid
      } catch (err) {
        if (err && err.code === 'auth/user-not-found') {
          return res.status(404).json({ success: false, error: 'User not found for provided email' })
        }
        throw err
      }
    }

    await db.collection('users').doc(targetUid).set({
      accountStatus: 'Inactive',
      updatedAt: admin.firestore.Timestamp.now()
    }, { merge: true })

    res.json({ success: true, uid: targetUid, accountStatus: 'inactive' })
  } catch (error) {
    console.error('Error making user inactive (GHL):', error)
    res.status(500).json({ success: false, error: error?.message || 'Internal server error' })
  }
})

// Make user active (admin only)
app.post('/api/make-active', authenticateAdmin, async (req, res) => {
  try {
    const { uid, email } = req.body || {}

    if (!uid && !email) {
      return res.status(400).json({ success: false, error: 'uid or email is required' })
    }

    let targetUid = uid
    if (!targetUid && email) {
      try {
        const userRecord = await admin.auth().getUserByEmail(email)
        targetUid = userRecord.uid
      } catch (err) {
        if (err && err.code === 'auth/user-not-found') {
          return res.status(404).json({ success: false, error: 'User not found for provided email' })
        }
        throw err
      }
    }

    await db.collection('users').doc(targetUid).set({
      accountStatus: 'Active',
      updatedAt: admin.firestore.Timestamp.now()
    }, { merge: true })

    res.json({ success: true, uid: targetUid, accountStatus: 'Active' })
  } catch (error) {
    console.error('Error making user active (admin):', error)
    res.status(500).json({ success: false, error: error?.message || 'Internal server error' })
  }
})

// Make user active (GHL via API key)
app.post('/api/ghl/make-active', authenticateApiKey, async (req, res) => {
  try {
    const { uid, email } = normalizeRequestBody(req, ['uid', 'email'])

    if (!uid && !email) {
      return res.status(400).json({ success: false, error: 'uid or email is required' })
    }

    let targetUid = uid
    if (!targetUid && email) {
      try {
        const userRecord = await admin.auth().getUserByEmail(email)
        targetUid = userRecord.uid
      } catch (err) {
        if (err && err.code === 'auth/user-not-found') {
          return res.status(404).json({ success: false, error: 'User not found for provided email' })
        }
        throw err
      }
    }

    await db.collection('users').doc(targetUid).set({
      accountStatus: 'Active',
      updatedAt: admin.firestore.Timestamp.now()
    }, { merge: true })

    res.json({ success: true, uid: targetUid, accountStatus: 'Active' })
  } catch (error) {
    console.error('Error making user active (GHL):', error)
    res.status(500).json({ success: false, error: error?.message || 'Internal server error' })
  }
})

// Make user a triple hugger (admin only)
app.post('/api/make-triple-hugger', authenticateAdmin, async (req, res) => {
  try {
    const { email } = req.body || {}

    if (!email || typeof email !== 'string') {
      return res.status(400).json({ success: false, error: 'Valid email is required' })
    }

    // Basic email format validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(email)) {
      return res.status(400).json({ success: false, error: 'Invalid email format' })
    }

    // Find user by email
    let userRecord
    try {
      userRecord = await admin.auth().getUserByEmail(email)
    } catch (err) {
      if (err && err.code === 'auth/user-not-found') {
        return res.status(404).json({ success: false, error: 'User not found for provided email' })
      }
      throw err
    }

    const uid = userRecord.uid

    // Update Firestore profile with is_triple_hugger field
    await db.collection('users').doc(uid).set({
      is_triple_hugger: 'Yes',
      updatedAt: admin.firestore.Timestamp.now()
    }, { merge: true })

    res.json({ 
      success: true, 
      uid, 
      email, 
      is_triple_hugger: 'Yes',
      message: 'User marked as triple hugger'
    })
  } catch (error) {
    console.error('Error making user triple hugger:', error)
    res.status(500).json({ success: false, error: error?.message || 'Internal server error' })
  }
})

// GHL: Make user a triple hugger (API key auth)
app.post('/api/ghl/make-triple-hugger', authenticateApiKey, async (req, res) => {
  try {
    const { email } = normalizeRequestBody(req, ['email'])

    if (!email || typeof email !== 'string') {
      return res.status(400).json({ success: false, error: 'Valid email is required' })
    }

    // Basic email format validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(email)) {
      return res.status(400).json({ success: false, error: 'Invalid email format' })
    }

    // Find user by email
    let userRecord
    try {
      userRecord = await admin.auth().getUserByEmail(email)
    } catch (err) {
      if (err && err.code === 'auth/user-not-found') {
        return res.status(404).json({ success: false, error: 'User not found for provided email' })
      }
      throw err
    }

    const uid = userRecord.uid

    // Update Firestore profile with is_triple_hugger field
    await db.collection('users').doc(uid).set({
      is_triple_hugger: 'Yes',
      updatedAt: admin.firestore.Timestamp.now()
    }, { merge: true })

    res.json({ 
      success: true, 
      uid, 
      email, 
      is_triple_hugger: 'Yes',
      message: 'User marked as triple hugger (GHL)'
    })
  } catch (error) {
    console.error('Error making user triple hugger (GHL):', error)
    res.status(500).json({ success: false, error: error?.message || 'Internal server error' })
  }
})

// Make user a double hugger (admin only)
app.post('/api/make-double-hugger', authenticateAdmin, async (req, res) => {
  try {
    const { email } = req.body || {}

    if (!email || typeof email !== 'string') {
      return res.status(400).json({ success: false, error: 'Valid email is required' })
    }

    // Basic email format validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(email)) {
      return res.status(400).json({ success: false, error: 'Invalid email format' })
    }

    // Find user by email
    let userRecord
    try {
      userRecord = await admin.auth().getUserByEmail(email)
    } catch (err) {
      if (err && err.code === 'auth/user-not-found') {
        return res.status(404).json({ success: false, error: 'User not found for provided email' })
      }
      throw err
    }

    const uid = userRecord.uid

    // Update Firestore profile with is_triple_hugger field set to "No"
    await db.collection('users').doc(uid).set({
      is_triple_hugger: 'No',
      updatedAt: admin.firestore.Timestamp.now()
    }, { merge: true })

    res.json({ 
      success: true, 
      uid, 
      email, 
      is_triple_hugger: 'No',
      message: 'User marked as double hugger'
    })
  } catch (error) {
    console.error('Error making user double hugger:', error)
    res.status(500).json({ success: false, error: error?.message || 'Internal server error' })
  }
})

// GHL: Make user a double hugger (API key auth)
app.post('/api/ghl/make-double-hugger', authenticateApiKey, async (req, res) => {
  try {
    const { email } = normalizeRequestBody(req, ['email'])

    if (!email || typeof email !== 'string') {
      return res.status(400).json({ success: false, error: 'Valid email is required' })
    }

    // Basic email format validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(email)) {
      return res.status(400).json({ success: false, error: 'Invalid email format' })
    }

    // Find user by email
    let userRecord
    try {
      userRecord = await admin.auth().getUserByEmail(email)
    } catch (err) {
      if (err && err.code === 'auth/user-not-found') {
        return res.status(404).json({ success: false, error: 'User not found for provided email' })
      }
      throw err
    }

    const uid = userRecord.uid

    // Update Firestore profile with is_triple_hugger field set to "No"
    await db.collection('users').doc(uid).set({
      is_triple_hugger: 'No',
      updatedAt: admin.firestore.Timestamp.now()
    }, { merge: true })

    res.json({ 
      success: true, 
      uid, 
      email, 
      is_triple_hugger: 'No',
      message: 'User marked as double hugger (GHL)'
    })
  } catch (error) {
    console.error('Error making user double hugger (GHL):', error)
    res.status(500).json({ success: false, error: error?.message || 'Internal server error' })
  }
})

// Delete user (admin only)
app.post('/api/delete-user', authenticateAdmin, async (req, res) => {
  try {
    const { uid, email } = req.body || {}

    if (!uid && !email) {
      return res.status(400).json({ success: false, error: 'uid or email is required' })
    }

    let targetUid = uid
    if (!targetUid && email) {
      try {
        const userRecord = await admin.auth().getUserByEmail(email)
        targetUid = userRecord.uid
      } catch (err) {
        if (err && err.code === 'auth/user-not-found') {
          return res.status(404).json({ success: false, error: 'User not found for provided email' })
        }
        throw err
      }
    }

    // Delete from Firebase Authentication
    await admin.auth().deleteUser(targetUid)
    
    // Delete from Firestore
    await db.collection('users').doc(targetUid).delete()

    res.json({ 
      success: true, 
      uid: targetUid, 
      message: 'User deleted successfully',
      deletedBy: req.adminDisplayName || 'Admin'
    })
  } catch (error) {
    console.error('Error deleting user (admin):', error)
    res.status(500).json({ success: false, error: error?.message || 'Internal server error' })
  }
})

// Delete user (GHL via API key)
app.post('/api/ghl/delete-user', authenticateApiKey, async (req, res) => {
  try {
    const { uid, email } = normalizeRequestBody(req, ['uid', 'email'])

    if (!uid && !email) {
      return res.status(400).json({ success: false, error: 'uid or email is required' })
    }

    let targetUid = uid
    if (!targetUid && email) {
      try {
        const userRecord = await admin.auth().getUserByEmail(email)
        targetUid = userRecord.uid
      } catch (err) {
        if (err && err.code === 'auth/user-not-found') {
          return res.status(404).json({ success: false, error: 'User not found for provided email' })
        }
        throw err
      }
    }

    // Delete from Firebase Authentication
    await admin.auth().deleteUser(targetUid)
    
    // Delete from Firestore
    await db.collection('users').doc(targetUid).delete()

    res.json({ 
      success: true, 
      uid: targetUid, 
      message: 'User deleted successfully (GHL)',
      deletedBy: 'GHL'
    })
  } catch (error) {
    console.error('Error deleting user (GHL):', error)
    res.status(500).json({ success: false, error: error?.message || 'Internal server error' })
  }
})

// Scan for orphaned users (admin only)
app.post('/api/scan-orphaned-users', authenticateAdmin, async (req, res) => {
  try {
    console.log('Scanning for orphaned users...')
    
    // Get all users from Firestore
    const usersSnapshot = await db.collection('users').get()
    const firestoreUsers = usersSnapshot.docs.map(doc => ({
      uid: doc.id,
      ...doc.data()
    }))

    console.log(`Found ${firestoreUsers.length} users in Firestore`)

    // Check which users don't exist in Firebase Auth
    const orphanedUsers = []
    
    for (const user of firestoreUsers) {
      try {
        await admin.auth().getUser(user.uid)
        // User exists in Firebase Auth
      } catch (error) {
        if (error.code === 'auth/user-not-found') {
          // User doesn't exist in Firebase Auth
          orphanedUsers.push({
            uid: user.uid,
            email: user.email,
            firstName: user.firstName,
            lastName: user.lastName,
            userType: user.userType,
            createdAt: user.createdAt?.toDate?.()?.toISOString() || user.createdAt
          })
        } else {
          console.error(`Error checking user ${user.uid}:`, error)
        }
      }
    }

    console.log(`Found ${orphanedUsers.length} orphaned users`)

    res.json({
      success: true,
      orphanedUsers,
      summary: {
        totalFirestoreUsers: firestoreUsers.length,
        orphanedUsers: orphanedUsers.length,
        validUsers: firestoreUsers.length - orphanedUsers.length
      }
    })
  } catch (error) {
    console.error('Error scanning orphaned users:', error)
    res.status(500).json({
      success: false,
      error: error?.message || 'Internal server error'
    })
  }
})

// Cleanup orphaned users (admin only)
app.post('/api/cleanup-orphaned-users', authenticateAdmin, async (req, res) => {
  try {
    const { userIds } = req.body || {}
    
    if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json({ 
        success: false, 
        error: 'userIds array is required and must not be empty' 
      })
    }

    console.log(`Starting cleanup of ${userIds.length} users...`)
    
    const results = {
      totalUsers: userIds.length,
      orphanedUsers: 0,
      cleanedUsers: 0,
      failedUsers: 0,
      errors: []
    }

    for (const userId of userIds) {
      try {
        // Verify user doesn't exist in Firebase Auth
        try {
          await admin.auth().getUser(userId)
          // User exists in Firebase Auth, skip cleanup
          results.errors.push(`User ${userId} exists in Firebase Auth, skipping cleanup`)
          continue
        } catch (error) {
          if (error.code !== 'auth/user-not-found') {
            throw error
          }
          // User doesn't exist in Firebase Auth, proceed with cleanup
        }

        // Delete user document and subcollections
        const batch = db.batch()
        
        // Delete user document
        batch.delete(db.collection('users').doc(userId))
        
        // Delete subcollections (conversations, memories, user_messages, etc.)
        try {
          const conversationsSnapshot = await db.collection('users').doc(userId).collection('conversations').get()
          conversationsSnapshot.docs.forEach(doc => batch.delete(doc.ref))
          
          const memoriesSnapshot = await db.collection('users').doc(userId).collection('memories').get()
          memoriesSnapshot.docs.forEach(doc => batch.delete(doc.ref))
          
          // Delete user_messages where uid matches
          const userMessagesSnapshot = await db.collection('user_messages').where('uid', '==', userId).get()
          userMessagesSnapshot.docs.forEach(doc => batch.delete(doc.ref))
          
        } catch (subcollectionError) {
          console.warn(`Error accessing subcollections for user ${userId}:`, subcollectionError)
          // Continue with cleanup even if subcollections fail
        }
        
        await batch.commit()
        
        results.cleanedUsers++
        results.orphanedUsers++
        console.log(`Successfully cleaned up user ${userId}`)
        
      } catch (error) {
        console.error(`Error cleaning up user ${userId}:`, error)
        results.failedUsers++
        results.errors.push(`Failed to cleanup user ${userId}: ${error?.message || 'Unknown error'}`)
      }
    }

    console.log(`Cleanup completed: ${results.cleanedUsers} cleaned, ${results.failedUsers} failed`)

    res.json({
      success: true,
      message: `Successfully cleaned up ${results.cleanedUsers} orphaned users`,
      details: results
    })
  } catch (error) {
    console.error('Error cleaning up orphaned users:', error)
    res.status(500).json({
      success: false,
      error: error?.message || 'Internal server error'
    })
  }
})

// Validate user auth (admin only)
app.post('/api/validate-user-auth', authenticateAdmin, async (req, res) => {
  try {
    const { uid } = req.body || {}
    
    if (!uid || typeof uid !== 'string') {
      return res.status(400).json({ 
        success: false, 
        error: 'uid is required and must be a string' 
      })
    }
    
    try {
      const userRecord = await admin.auth().getUser(uid)
      res.json({ 
        success: true, 
        exists: true,
        user: {
          uid: userRecord.uid,
          email: userRecord.email,
          displayName: userRecord.displayName,
          disabled: userRecord.disabled,
          emailVerified: userRecord.emailVerified
        }
      })
    } catch (error) {
      if (error.code === 'auth/user-not-found') {
        res.json({ success: true, exists: false })
      } else {
        throw error
      }
    }
  } catch (error) {
    console.error('Error validating user auth:', error)
    res.status(500).json({
      success: false,
      error: error?.message || 'Internal server error'
    })
  }
})

// Get user profile (admin only)
app.post('/api/get-user-profile', authenticateAdmin, async (req, res) => {
  try {
    const { userId } = req.body || {}
    
    if (!userId || typeof userId !== 'string') {
      return res.status(400).json({ 
        success: false, 
        error: 'User ID is required' 
      })
    }

    console.log(`Getting profile for user: ${userId}`)

    // Get user profile from Firestore
    const profileDoc = await db.collection('users').doc(userId).get()
    
    if (!profileDoc.exists) {
      console.log(`User not found in Firestore: ${userId}`)
      return res.status(404).json({ 
        success: false, 
        error: 'User not found' 
      })
    }

    const profileData = profileDoc.data()
    
    // Check if user exists in Firebase Auth
    let hasFirebaseAuth = true
    try {
      await admin.auth().getUser(userId)
    } catch (error) {
      if (error.code === 'auth/user-not-found') {
        hasFirebaseAuth = false
        console.log(`User ${userId} not found in Firebase Auth`)
      } else {
        console.error(`Error checking Firebase Auth for user ${userId}:`, error)
        throw error
      }
    }

    // Format timestamps for response
    const formatTimestamp = (timestamp) => {
      if (!timestamp) return null
      if (timestamp.toDate && typeof timestamp.toDate === 'function') {
        return timestamp.toDate().toISOString()
      }
      if (timestamp instanceof Date) {
        return timestamp.toISOString()
      }
      return timestamp
    }

    // Build complete profile with all fields
    const completeProfile = {
      uid: userId,
      email: profileData.email,
      firstName: profileData.firstName,
      lastName: profileData.lastName,
      displayName: profileData.displayName,
      userType: profileData.userType,
      accountType: profileData.accountType,
      accountStatus: profileData.accountStatus,
      createdAt: formatTimestamp(profileData.createdAt),
      updatedAt: formatTimestamp(profileData.updatedAt),
      fcmToken: profileData.fcmToken,
      is_triple_hugger: profileData.is_triple_hugger,
      hasFirebaseAuth,
      birthday: profileData.birthday,
      wakeTime: profileData.wakeTime,
      sleepTime: profileData.sleepTime,
      hugVibe: profileData.hugVibe,
      onboardingCompleted: profileData.onboardingCompleted,
      onboardingCompletedAt: formatTimestamp(profileData.onboardingCompletedAt),
      creationEndpoint: profileData.creationEndpoint,
      createdBy: profileData.createdBy,
      tempPassword: profileData.tempPassword,
      passwordGeneratedAt: formatTimestamp(profileData.passwordGeneratedAt)
    }

    console.log(`Successfully retrieved profile for user: ${userId}`)

    res.json({
      success: true,
      profile: completeProfile
    })
  } catch (error) {
    console.error('Error getting user profile:', error)
    res.status(500).json({
      success: false,
      error: error?.message || 'Internal server error'
    })
  }
})

// Admin-only: Force password reset by setting custom claim mustChangePassword=true
app.post('/api/force-password-reset', async (req, res) => {
  try {
    const authHeader = req.headers.authorization || ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
    if (!token) {
      return res.status(401).json({ success: false, error: 'Missing Authorization token' })
    }

    let decoded
    try {
      decoded = await admin.auth().verifyIdToken(token)
    } catch (e) {
      return res.status(401).json({ success: false, error: 'Invalid or expired token' })
    }

    const allowlist = new Set(['mgzobel@icloud.com', 'kenergizer@mac.com', 'katlinzobel@icloud.com'])
    let isAdmin = false
    try {
      const requesterDoc = await db.collection('users').doc(decoded.uid).get()
      const requesterData = requesterDoc.data() || {}
      isAdmin = requesterData.userType === 'admin' || requesterData.userType === 'super_admin'
    } catch (_) {}
    const requesterEmail = decoded.email || ''
    if (!isAdmin && !allowlist.has(requesterEmail)) {
      return res.status(403).json({ success: false, error: 'Admin access required' })
    }

    let { uid, email } = req.body || {}
    if ((!uid || typeof uid !== 'string') && (!email || typeof email !== 'string')) {
      return res.status(400).json({ success: false, error: 'uid or email is required' })
    }

    if (!uid && email) {
      try {
        const userRecord = await admin.auth().getUserByEmail(email)
        uid = userRecord.uid
      } catch (err) {
        if (err && err.code === 'auth/user-not-found') {
          return res.status(404).json({ success: false, error: 'User not found' })
        }
        throw err
      }
    }

    try {
      const userRecord = await admin.auth().getUser(uid)
      const existingClaims = userRecord.customClaims || {}
      const newClaims = { ...existingClaims, mustChangePassword: true }
      await admin.auth().setCustomUserClaims(uid, newClaims)
      await admin.auth().revokeRefreshTokens(uid)
      console.log(JSON.stringify({ level: 'info', action: 'force-password-reset', requesterUid: decoded.uid, requesterEmail, targetUid: uid, result: 'success' }))
      return res.json({ success: true, uid, message: 'User will be required to change password on next sign-in' })
    } catch (err) {
      if (err && (err.code === 'auth/user-not-found' || err.code === 'auth/invalid-uid')) {
        return res.status(404).json({ success: false, error: 'User not found' })
      }
      console.error('Error forcing password reset:', err)
      return res.status(500).json({ success: false, error: err?.message || 'Internal server error' })
    }
  } catch (error) {
    console.error('Unhandled error in force-password-reset:', error)
    res.status(500).json({ success: false, error: error?.message || 'Internal server error' })
  }
})

// Admin-only: Remove password change requirement by unsetting mustChangePassword custom claim
app.post('/api/remove-password-change-requirement', async (req, res) => {
  try {
    const authHeader = req.headers.authorization || ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
    if (!token) {
      return res.status(401).json({ success: false, error: 'Missing Authorization token' })
    }

    let decoded
    try {
      decoded = await admin.auth().verifyIdToken(token)
    } catch (e) {
      return res.status(401).json({ success: false, error: 'Invalid or expired token' })
    }

    const allowlist = new Set(['mgzobel@icloud.com', 'kenergizer@mac.com', 'katlinzobel@icloud.com'])
    let isAdmin = false
    try {
      const requesterDoc = await db.collection('users').doc(decoded.uid).get()
      const requesterData = requesterDoc.data() || {}
      isAdmin = requesterData.userType === 'admin' || requesterData.userType === 'super_admin'
    } catch (_) {}
    const requesterEmail = decoded.email || ''
    if (!isAdmin && !allowlist.has(requesterEmail)) {
      return res.status(403).json({ success: false, error: 'Admin access required' })
    }

    const { uid } = req.body || {}
    if (!uid || typeof uid !== 'string') {
      return res.status(400).json({ success: false, error: 'uid is required and must be a string' })
    }

    try {
      const userRecord = await admin.auth().getUser(uid)
      const existingClaims = userRecord.customClaims || {}
      // Remove mustChangePassword while preserving other claims
      const { mustChangePassword, ...restClaims } = existingClaims
      await admin.auth().setCustomUserClaims(uid, restClaims)
      await admin.auth().revokeRefreshTokens(uid)
      console.log(JSON.stringify({ level: 'info', action: 'remove-password-change-requirement', requesterUid: decoded.uid, requesterEmail, targetUid: uid, result: 'success' }))
      return res.json({ success: true, uid, message: 'Password change requirement removed' })
    } catch (err) {
      if (err && (err.code === 'auth/user-not-found' || err.code === 'auth/invalid-uid')) {
        return res.status(404).json({ success: false, error: 'User not found' })
      }
      console.error('Error removing password change requirement:', err)
      return res.status(500).json({ success: false, error: err?.message || 'Internal server error' })
    }
  } catch (error) {
    console.error('Unhandled error in remove-password-change-requirement:', error)
    res.status(500).json({ success: false, error: error?.message || 'Internal server error' })
  }
})

// GHL: Send notification to specific users by email (API key auth)
app.post('/api/ghl/send-notification', authenticateApiKey, async (req, res) => {
  try {
    let { title, body, targetEmails = [], icon, badge, data } = normalizeRequestBody(req, ['title', 'body', 'targetEmails', 'icon', 'badge', 'data'])
    
    // Handle single email from query parameter
    if ((!targetEmails || targetEmails.length === 0) && req.query.email) {
      targetEmails = [req.query.email]
    }

    // Validation
    if (!title || !body) {
      return res.status(400).json({
        success: false,
        error: 'Title and body are required'
      })
    }

    if (!targetEmails || !Array.isArray(targetEmails) || targetEmails.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'targetEmails array is required and must not be empty'
      })
    }

    // Validate email formats
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    const invalidEmails = targetEmails.filter(email => !emailRegex.test(email))
    if (invalidEmails.length > 0) {
      return res.status(400).json({
        success: false,
        error: `Invalid email format(s): ${invalidEmails.join(', ')}`
      })
    }

    // Get FCM tokens for the specified emails
    const tokenPromises = targetEmails.map(async (email) => {
      try {
        const userRecord = await admin.auth().getUserByEmail(email)
        const userDoc = await db.collection('users').doc(userRecord.uid).get()
        if (userDoc.exists) {
          const userData = userDoc.data()
          // Only include users with valid FCM tokens (messaging enabled)
          return userData.fcmToken && userData.fcmToken.trim() !== '' ? userData.fcmToken : null
        }
        return null
      } catch (err) {
        if (err && err.code === 'auth/user-not-found') {
          console.warn(`User not found for email: ${email}`)
          return null
        }
        throw err
      }
    })

    const tokenAndUidPromises = targetEmails.map(async (email) => {
      try {
        const userRecord = await admin.auth().getUserByEmail(email)
        const userDoc = await db.collection('users').doc(userRecord.uid).get()
        if (userDoc.exists) {
          const userData = userDoc.data()
          const token = (userData.fcmToken && userData.fcmToken.trim() !== '') ? userData.fcmToken : null
          return { uid: userRecord.uid, token }
        }
        return { uid: userRecord.uid, token: null }
      } catch (err) {
        if (err && err.code === 'auth/user-not-found') {
          console.warn(`User not found for email: ${email}`)
          return null
        }
        throw err
      }
    })

    const tokenAndUidResults = await Promise.all(tokenAndUidPromises)
    const existingUsers = tokenAndUidResults.filter(r => r !== null)
    const allTokens = existingUsers.map(r => r.token).filter(token => token !== null)
    const allTargetUids = existingUsers.map(r => r.uid)
    
    // Validate each token before adding to final list
    console.log(`Found ${allTokens.length} tokens for email targeting, validating...`)
    const validTokens = []
    for (const token of allTokens) {
      try {
        await admin.messaging().send({
          token: token,
          notification: { title: 'Validation', body: 'Testing token' }
        })
        validTokens.push(token)
      } catch (error) {
        console.log(`Token ${token.substring(0, 20)}... is invalid for email targeting:`, error.code)
      }
    }
    console.log(`Validated ${validTokens.length} tokens for email targeting`)

    // Persist messages for targeted users (by email) regardless of token availability
    if (Array.isArray(allTargetUids) && allTargetUids.length > 0) {
      console.log('Preparing to persist user_messages (GHL endpoint):', {
        count: allTargetUids.length,
        sampleUid: allTargetUids[0]
      })
      try {
        await saveMessagesForUsers(allTargetUids, { title, body, data, icon, badge }, { source: 'ghl-integration', targetType: 'email', creationEndpoint: 'ghl_send_notification' })
      } catch (e) {
        console.error('Failed to persist user_messages (GHL):', e)
      }
    }

    if (validTokens.length === 0) {
      return res.json({
        success: false,
        error: 'No users with messaging enabled found for the specified emails'
      })
    }

    // Prepare notification payload
    // Convert all data values to strings (FCM requirement)
    const stringifiedData = {}
    if (data && typeof data === 'object') {
      Object.keys(data).forEach(key => {
        stringifiedData[key] = String(data[key])
      })
    }
    
    const message = {
      notification: {
        title,
        body
      },
      data: {
        ...stringifiedData,
        timestamp: Date.now().toString(),
        source: 'ghl-integration'
      },
      webpush: {
        notification: {
          icon: icon || '/MDH_favicon.png',
          badge: badge || '/MDH_favicon.png'
        },
        fcm_options: {
          link: process.env.FRONTEND_URL || 'http://localhost:8080'
        }
      }
    }

    // Send notifications using multicast for better performance
    let response
    if (validTokens.length === 1) {
      // Single token - use send method
      try {
        response = await admin.messaging().send({ ...message, token: validTokens[0] })
        res.json({
          success: true,
          messageId: response,
          stats: {
            total: 1,
            successful: 1,
            failed: 0
          },
          targetEmails,
          validEmails: targetEmails.filter(email => {
            const userIndex = targetEmails.indexOf(email);
            const userResult = tokenAndUidResults[userIndex];
            return userResult && userResult.token && validTokens.includes(userResult.token);
          }),
          invalidEmails: targetEmails.filter(email => {
            const userIndex = targetEmails.indexOf(email);
            const userResult = tokenAndUidResults[userIndex];
            return !userResult || !userResult.token || !validTokens.includes(userResult.token);
          })
        })
      } catch (error) {
        console.error('Failed to send to single token (GHL):', error)
        if (error.code === 'messaging/registration-token-not-registered') {
          res.json({
            success: false,
            error: 'Invalid or expired FCM token',
            stats: {
              total: 1,
              successful: 0,
              failed: 1
            },
            targetEmails,
            validEmails: targetEmails.filter((email, index) => validTokens[index] !== null),
            invalidEmails: targetEmails.filter((email, index) => validTokens[index] === null)
          })
        } else {
          throw error
        }
      }
    } else {
      // Multiple tokens - tokens are already validated, send directly
      console.log('Sending multicast to validated tokens (GHL):', validTokens.map(t => t.substring(0, 20) + '...'))
      
      try {
        response = await admin.messaging().sendMulticast({ ...message, tokens: validTokens })
        console.log('Multicast send response (GHL):', {
          successCount: response.successCount,
          failureCount: response.failureCount,
          responses: response.responses.length
        })
        
        const successful = response.successCount
        const failed = response.failureCount

        res.json({
          success: true,
          messageId: response.responses?.[0]?.messageId,
          stats: {
            total: validTokens.length,
            successful,
            failed
          },
          targetEmails,
          validEmails: targetEmails.filter(email => {
            const userIndex = targetEmails.indexOf(email);
            const userResult = tokenAndUidResults[userIndex];
            return userResult && userResult.token && validTokens.includes(userResult.token);
          }),
          invalidEmails: targetEmails.filter(email => {
            const userIndex = targetEmails.indexOf(email);
            const userResult = tokenAndUidResults[userIndex];
            return !userResult || !userResult.token || !validTokens.includes(userResult.token);
          }),
          message: `${successful} notifications sent successfully`
        })
      } catch (error) {
        console.error('Failed to send multicast (GHL):', error)
        
        // Handle FCM API not enabled error
        if (error.code === 'messaging/unknown-error' && error.message.includes('404')) {
          return res.status(503).json({
            success: false,
            error: 'Firebase Cloud Messaging API not enabled',
            details: 'The FCM API is not enabled for this Firebase project',
            suggestion: 'Enable Firebase Cloud Messaging API in Google Cloud Console',
            tokensFound: validTokens.length,
            projectId: process.env.FIREBASE_PROJECT_ID,
            targetEmails,
            validEmails: targetEmails.filter((email, index) => validTokens[index] !== null),
            invalidEmails: targetEmails.filter((email, index) => validTokens[index] === null)
          })
        }
        
        throw error
      }
    }

  } catch (error) {
    console.error('Error sending notification (GHL):', error)
    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error'
    })
  }
})

// GHL: Send notification via GET (query params): ?title=...&body=...&email=...
app.get('/api/ghl/send-notification', authenticateApiKey, async (req, res) => {
  try {
    const title = req.query.title && String(req.query.title)
    const body = req.query.body && String(req.query.body)
    const email = req.query.email && String(req.query.email)

    if (!title || !body) {
      return res.status(400).json({ success: false, error: 'Title and body are required' })
    }
    if (!email) {
      return res.status(400).json({ success: false, error: 'email query param is required' })
    }

    // Resolve email to uid and optional token
    let uid = null
    let token = null
    try {
      const userRecord = await admin.auth().getUserByEmail(email)
      uid = userRecord.uid
      const userDoc = await db.collection('users').doc(uid).get()
      if (userDoc.exists) {
        const userData = userDoc.data() || {}
        token = userData.fcmToken && String(userData.fcmToken).trim() !== '' ? String(userData.fcmToken) : null
      }
    } catch (err) {
      if (err && err.code === 'auth/user-not-found') {
        return res.status(404).json({ success: false, error: 'User not found for provided email' })
      }
      throw err
    }

    // Persist message regardless of token presence
    try {
      await saveMessagesForUsers([uid], { title, body, data: {}, icon: null, badge: null }, { source: 'ghl-integration', targetType: 'email', creationEndpoint: 'ghl_send_notification_get' })
    } catch (e) {
      console.error('Failed to persist user_messages (GHL GET):', e)
    }

    if (!token) {
      return res.json({ success: true, message: 'Message saved to Firestore; user has no FCM token', email, uid })
    }

    const message = {
      notification: { title, body },
      data: { timestamp: Date.now().toString(), source: 'ghl-integration' },
      webpush: {
        notification: { icon: '/MDH_favicon.png', badge: '/MDH_favicon.png' },
        fcm_options: { link: process.env.FRONTEND_URL || 'http://localhost:8080' }
      },
      token
    }

    try {
      const response = await admin.messaging().send(message)
      return res.json({ success: true, messageId: response, email, uid })
    } catch (error) {
      console.error('Failed to send (GHL GET):', error)
      return res.status(500).json({ success: false, error: error.message || 'Failed to send notification' })
    }
  } catch (error) {
    console.error('Error in GHL GET send-notification:', error)
    res.status(500).json({ success: false, error: error.message || 'Internal server error' })
  }
})

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    success: false,
    error: 'Something went wrong!'
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found'
  });
});

app.listen(PORT, () => {
  console.log(`🚀 My Daily Hug Backend Server running on port ${PORT}`);
  console.log(`📱 Health check: http://localhost:${PORT}/health`);
  console.log(`🔔 Notification API: http://localhost:${PORT}/api/send-notification`);
});
