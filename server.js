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
    const { email, firstName = '', lastName = '', tempPassword } = req.body || {}

    if (!email || typeof email !== 'string') {
      return res.status(400).json({ success: false, error: 'Valid email is required' })
    }

    // Find or create Auth user
    let userRecord
    try {
      userRecord = await admin.auth().getUserByEmail(email)
    } catch (err) {
      if (err && err.code === 'auth/user-not-found') {
        // Create with temporary password if provided (or generate one)
        const generated = tempPassword || Math.random().toString(36).slice(-8) + Math.random().toString(36).slice(-4)
        userRecord = await admin.auth().createUser({ email, password: generated })
        // Store for response
        userRecord._generatedTempPassword = generated
      } else {
        throw err
      }
    }

    // If user already existed and tempPassword provided, update password
    let effectiveTempPassword = userRecord._generatedTempPassword || null
    if (!effectiveTempPassword && tempPassword) {
      await admin.auth().updateUser(userRecord.uid, { password: tempPassword })
      effectiveTempPassword = tempPassword
    }

    // Set custom claim requiring password change on first sign-in
    await admin.auth().setCustomUserClaims(userRecord.uid, {
      mustChangePassword: true,
      // preserve existing claims if needed in a real implementation (fetch then merge)
    })

    // Update Firestore profile: set admin role and names if provided
    const uid = userRecord.uid
    const displayName = `${firstName || ''} ${lastName || ''}`.trim() || userRecord.displayName || ''
    await db.collection('users').doc(uid).set(
      {
        uid,
        email,
        firstName: firstName || admin.firestore.FieldValue.delete(),
        lastName: lastName || admin.firestore.FieldValue.delete(),
        displayName: displayName || admin.firestore.FieldValue.delete(),
        userType: 'admin',
        updatedAt: admin.firestore.Timestamp.now(),
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      },
      { merge: true }
    )

    res.json({
      success: true,
      uid,
      email,
      message: 'Admin role granted with temporary password set',
      tempPassword: effectiveTempPassword || undefined
    })
  } catch (error) {
    console.error('Error granting admin:', error)
    res.status(500).json({ success: false, error: 'Failed to grant admin role' })
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
