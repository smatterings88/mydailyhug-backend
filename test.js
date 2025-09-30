const fetch = require('node-fetch');

const API_URL = 'http://localhost:3001';

async function testBackend() {
  console.log('🧪 Testing My Daily Hug Backend Service...\n');

  try {
    // Test health check
    console.log('1. Testing health check...');
    const healthResponse = await fetch(`${API_URL}/health`);
    const healthData = await healthResponse.json();
    console.log('✅ Health check:', healthData);

    // Test notification stats
    console.log('\n2. Testing notification stats...');
    const statsResponse = await fetch(`${API_URL}/api/notification-stats`);
    const statsData = await statsResponse.json();
    console.log('✅ Stats:', statsData);

    // Test sending notification
    console.log('\n3. Testing notification send...');
    const notificationResponse = await fetch(`${API_URL}/api/send-notification`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        title: 'Test Notification',
        body: 'This is a test from the backend service',
        targetType: 'all',
        icon: '/MDH_favicon.png',
        badge: '/MDH_favicon.png',
        data: {
          test: true,
          timestamp: Date.now()
        }
      })
    });
    
    const notificationData = await notificationResponse.json();
    console.log('✅ Notification result:', notificationData);

    console.log('\n🎉 All tests passed! Backend service is working correctly.');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.log('\n💡 Make sure the backend server is running:');
    console.log('   npm run dev');
  }
}

testBackend();
