// test-credentials.js
const axios = require('axios');

// REPLACE THESE WITH YOUR ACTUAL SANDBOX CREDENTIALS
const CONSUMER_KEY = 'ATkrRVTAvKig9uGvddP23xRkR8lehkXDkxWX4YG5OU40k6LC';
const CONSUMER_SECRET = 'aNBsk8GMLw9GPSEQ78oGXm8wOKK3PFII9idCWANhYrWtNFClCNqp8cioT34X3yNf';

async function testCredentials() {
  const url = 'https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials';
  const auth = Buffer.from(`${CONSUMER_KEY}:${CONSUMER_SECRET}`).toString('base64');

  console.log('🔑 Testing Credentials:');
  console.log('   Consumer Key:', CONSUMER_KEY.substring(0, 10) + '...');
  console.log('   Consumer Secret:', CONSUMER_SECRET.substring(0, 10) + '...');
  console.log('   URL:', url);
  console.log('   Auth Header:', 'Basic ' + auth.substring(0, 20) + '...');

  try {
    const response = await axios.get(url, {
      headers: { Authorization: `Basic ${auth}` }
    });
    console.log('✅ SUCCESS! Token obtained:');
    console.log('   Access Token:', response.data.access_token);
    console.log('   Expires In:', response.data.expires_in);
  } catch (error) {
    console.error('❌ FAILED:');
    console.error('   Status:', error.response?.status);
    console.error('   Data:', JSON.stringify(error.response?.data, null, 2));
    console.error('   Message:', error.message);
  }
}

testCredentials();