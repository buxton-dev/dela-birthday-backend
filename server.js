// ============================================
// DELA BIRTHDAY SUPPORT BACKEND - FIXED ERROR HANDLING
// ============================================

require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

let supporters = [];

// ─── GET ACCESS TOKEN ───
async function getAccessToken() {
  const url =
    process.env.MPESA_ENV === 'production'
      ? 'https://api.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials'
      : 'https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials';

  console.log('🔑 Getting token from:', url);
  console.log('🔑 Consumer Key:', process.env.MPESA_CONSUMER_KEY ? '✅ SET' : '❌ MISSING');

  const auth = Buffer.from(
    `${process.env.MPESA_CONSUMER_KEY}:${process.env.MPESA_CONSUMER_SECRET}`
  ).toString('base64');

  try {
    const response = await axios.get(url, {
      headers: { Authorization: `Basic ${auth}` }
    });
    console.log('✅ Token obtained successfully');
    return response.data.access_token;
  } catch (error) {
    console.error('❌ Failed to get token:');
    console.error('   Status:', error.response?.status);
    console.error('   Data:', JSON.stringify(error.response?.data, null, 2));
    throw new Error('Failed to authenticate with Safaricom. Check your Consumer Key and Secret.');
  }
}

// ─── FORMAT PHONE NUMBER ───
function formatPhone(phone) {
  let cleaned = phone.replace(/[\s\-\(\)]/g, '');
  cleaned = cleaned.replace(/^\+/, '');
  cleaned = cleaned.replace(/^0/, '');
  if (!cleaned.startsWith('254')) {
    cleaned = '254' + cleaned;
  }
  return cleaned;
}

// ─── /pay ENDPOINT ───
app.post('/pay', async (req, res) => {
  try {
    let { phone, amount, name } = req.body;

    console.log('📥 Received:', { phone, amount, name });

    if (!phone || !amount || !name) {
      return res.status(400).json({ error: 'Name, phone, and amount are required.' });
    }
    if (amount < 1) {
      return res.status(400).json({ error: 'Amount must be at least 1 KES.' });
    }

    const formattedPhone = formatPhone(phone);
    console.log('📱 Formatted phone:', formattedPhone);

    if (formattedPhone.length !== 12) {
      return res.status(400).json({ 
        error: `Invalid phone number. Got: ${formattedPhone}. Must be 12 digits with 254.` 
      });
    }

    // Get token
    const token = await getAccessToken();

    const timestamp = new Date()
      .toISOString()
      .replace(/[^0-9]/g, '')
      .slice(0, 14);

    const password = Buffer.from(
      `${process.env.MPESA_SHORTCODE}${process.env.MPESA_PASSKEY}${timestamp}`
    ).toString('base64');

    const stkUrl =
      process.env.MPESA_ENV === 'production'
        ? 'https://api.safaricom.co.ke/mpesa/stkpush/v1/processrequest'
        : 'https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest';

    console.log('📤 Sending to Safaricom:');
    console.log('   URL:', stkUrl);
    console.log('   Shortcode:', process.env.MPESA_SHORTCODE);
    console.log('   Phone:', formattedPhone);
    console.log('   Amount:', amount);

    const payload = {
      BusinessShortCode: process.env.MPESA_SHORTCODE,
      Password: password,
      Timestamp: timestamp,
      TransactionType: 'CustomerPayBillOnline',
      Amount: Math.round(amount),
      PartyA: formattedPhone,
      PartyB: process.env.MPESA_SHORTCODE,
      PhoneNumber: formattedPhone,
      CallBackURL: `${process.env.CALLBACK_BASE_URL}/callback`,
      AccountReference: 'DelaSandraBday',
      TransactionDesc: `Birthday support from ${name}`
    };

    console.log('📤 Full Payload:', JSON.stringify(payload, null, 2));

    const stkResponse = await axios.post(stkUrl, payload, {
      headers: { 
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    console.log('✅ Success:', stkResponse.data);

    supporters.push({
      name,
      phone: formattedPhone,
      amount,
      status: 'pending',
      checkoutRequestID: stkResponse.data.CheckoutRequestID
    });

    res.json({
      message: 'Check your phone for the M-Pesa PIN prompt!',
      checkoutRequestID: stkResponse.data.CheckoutRequestID
    });

  } catch (error) {
    console.error('❌ ERROR DETAILS:');
    console.error('   Status:', error.response?.status);
    console.error('   Headers:', error.response?.headers);
    console.error('   Data:', error.response?.data);
    console.error('   Message:', error.message);
    
    // Try to extract the actual Safaricom error
    let errorMsg = 'Payment failed. Please try again.';
    
    if (error.response?.data) {
      // If it's a string, try to parse it
      if (typeof error.response.data === 'string') {
        try {
          const parsed = JSON.parse(error.response.data);
          errorMsg = parsed.errorMessage || parsed.ResponseDescription || parsed.message || errorMsg;
        } catch {
          errorMsg = error.response.data || errorMsg;
        }
      } else {
        // It's already an object
        errorMsg = error.response.data.errorMessage || 
                   error.response.data.ResponseDescription || 
                   error.response.data.message || 
                   errorMsg;
      }
    }

    res.status(500).json({ error: errorMsg });
  }
});

// ─── /callback ENDPOINT ───
app.post('/callback', (req, res) => {
  console.log('🔔 Callback received:', JSON.stringify(req.body, null, 2));
  res.json({ message: 'Callback received' });
});

// ─── /status/:checkoutRequestID ───
app.get('/status/:checkoutRequestID', (req, res) => {
  const supporter = supporters.find(
    s => s.checkoutRequestID === req.params.checkoutRequestID
  );
  res.json(supporter || { status: 'not_found' });
});

// ─── /supporters ───
app.get('/supporters', (req, res) => {
  const confirmed = supporters.filter(s => s.status === 'confirmed');
  res.json(confirmed);
});

// ─── HEALTH CHECK ───
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    environment: process.env.MPESA_ENV,
    shortcode: process.env.MPESA_SHORTCODE,
    callback: process.env.CALLBACK_BASE_URL,
    consumerKey: process.env.MPESA_CONSUMER_KEY ? '✅ SET' : '❌ MISSING'
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('═══════════════════════════════════════════════');
  console.log('🚀 Dela Birthday Backend Running');
  console.log(`🌍 Environment: ${process.env.MPESA_ENV || 'NOT SET!'}`);
  console.log(`🏪 Shortcode: ${process.env.MPESA_SHORTCODE || 'NOT SET!'}`);
  console.log(`📡 Callback: ${process.env.CALLBACK_BASE_URL || 'NOT SET!'}/callback`);
  console.log('═══════════════════════════════════════════════');
});