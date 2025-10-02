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
const serviceAccount = {
  type: "service_account",
  project_id: process.env.FIREBASE_PROJECT_ID,
  private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
  private_key: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  client_email: process.env.FIREBASE_CLIENT_EMAIL,
  client_id: process.env.FIREBASE_CLIENT_ID,
  auth_uri: "https://accounts.google.com/o/oauth2/auth",
  token_uri: "https://oauth2.googleapis.com/token",
  auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs",
  client_x509_cert_url: `https://www.googleapis.com/robot/v1/metadata/x509/${process.env.FIREBASE_CLIENT_EMAIL}`
};

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  projectId: process.env.FIREBASE_PROJECT_ID
});

const db = admin.firestore();

// Middleware
app.use(helmet());
app.use(cors({
  origin: [
    'https://app.mydailyhug.com',
    'http://localhost:8080',
    'http://localhost:3000'
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json({ limit: '10mb' }));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});
app.use('/api/', limiter);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Send notification endpoint
app.post('/api/send-notification', async (req, res) => {
  try {
    const { title, body, targetType = 'all', targetUsers = [], icon, badge, data } = req.body;

    // Validate required fields
    if (!title || !body) {
      return res.status(400).json({
        success: false,
        error: 'Title and body are required'
      });
    }

    // Get FCM tokens based on target type
    let tokens = [];
    
    if (targetUsers.length > 0) {
      // Get tokens for specific users
      const userPromises = targetUsers.map(async (userId) => {
        const userDoc = await db.collection('users').doc(userId).get();
        return userDoc.exists ? userDoc.data().fcmToken : null;
      });
      
      const userTokens = await Promise.all(userPromises);
      tokens = userTokens.filter(token => token !== null);
    } else {
      // Get tokens based on user type
      let query = db.collection('users');
      
      if (targetType !== 'all') {
        query = query.where('userType', '==', targetType);
      }
      
      const snapshot = await query.get();
      tokens = snapshot.docs
        .map(doc => doc.data().fcmToken)
        .filter(token => token !== null && token !== undefined);
    }

    if (tokens.length === 0) {
      return res.json({
        success: false,
        error: 'No users have enabled notifications for the specified criteria'
      });
    }

    // Prepare notification payload
    const message = {
      // Only title/body are allowed in top-level notification for FCM Admin
      notification: {
        title,
        body
      },
      data: {
        ...data,
        timestamp: Date.now().toString(),
        source: 'backend-service'
      },
      webpush: {
        // Web Push-specific notification fields
        notification: {
          icon: icon || '/MDH_favicon.png',
          badge: badge || '/MDH_favicon.png'
        },
        fcm_options: {
          link: process.env.FRONTEND_URL || 'http://localhost:8080'
        }
      }
    };

    // Send notifications
    const results = await Promise.allSettled(
      tokens.map(token => admin.messaging().send({ ...message, token }))
    );

    const successful = results.filter(result => result.status === 'fulfilled').length;
    const failed = results.filter(result => result.status === 'rejected').length;

    // Log failed sends
    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        console.error(`Failed to send to token ${tokens[index].substring(0, 20)}...:`, result.reason);
      }
    });

    res.json({
      success: true,
      messageId: `batch-${Date.now()}`,
      stats: {
        total: tokens.length,
        successful,
        failed
      }
    });

  } catch (error) {
    console.error('Error sending notification:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
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

// Grant Admin role (by email). If Auth user doesn't exist, create it and create/merge profile
app.post('/api/grant-admin', async (req, res) => {
  try {
    console.log('Grant admin request received:', { body: req.body })
    const { email, firstName = '', lastName = '', tempPassword } = req.body || {}

    if (!email || typeof email !== 'string') {
      console.log('Invalid email provided:', email)
      return res.status(400).json({ success: false, error: 'Valid email is required' })
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
