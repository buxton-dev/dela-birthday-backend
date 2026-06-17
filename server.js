// ============================================
// DELA BIRTHDAY SUPPORT BACKEND - COMPLETE FIXED VERSION
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

  const auth = Buffer.from(
    `${process.env.MPESA_CONSUMER_KEY}:${process.env.MPESA_CONSUMER_SECRET}`
  ).toString('base64');

  const response = await axios.get(url, {
    headers: { Authorization: `Basic ${auth}` }
  });

  return response.data.access_token;
}

// ─── FORMAT PHONE NUMBER ───
function formatPhone(phone) {
  // Remove spaces, dashes, brackets
  let cleaned = phone.replace(/[\s\-\(\)]/g, '');
  
  // Remove leading + if present
  cleaned = cleaned.replace(/^\+/, '');
  
  // If it starts with 0, remove it (e.g., 0712345678 → 712345678)
  cleaned = cleaned.replace(/^0/, '');
  
  // If it starts with 254, keep it
  // If it doesn't start with 254, add it
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

    // Validate
    if (!phone || !amount || !name) {
      return res.status(400).json({ error: 'Name, phone, and amount are required.' });
    }
    if (amount < 1) {
      return res.status(400).json({ error: 'Amount must be at least 1 KES.' });
    }

    // Format phone: 07XXXXXXX → 2547XXXXXXXX
    const formattedPhone = formatPhone(phone);
    console.log('📱 Formatted phone:', formattedPhone);

    if (formattedPhone.length !== 12) {
      return res.status(400).json({ 
        error: `Invalid phone number. Got: ${formattedPhone}. Must be 12 digits with 254.` 
      });
    }

    // Get token
    const token = await getAccessToken();
    console.log('✅ Token obtained');

    // Generate timestamp
    const timestamp = new Date()
      .toISOString()
      .replace(/[^0-9]/g, '')
      .slice(0, 14);

    // Generate password
    const password = Buffer.from(
      `${process.env.MPESA_SHORTCODE}${process.env.MPESA_PASSKEY}${timestamp}`
    ).toString('base64');

    const stkUrl =
      process.env.MPESA_ENV === 'production'
        ? 'https://api.safaricom.co.ke/mpesa/stkpush/v1/processrequest'
        : 'https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest';

    console.log('📤 Sending to:', stkUrl);
    console.log('📤 Shortcode:', process.env.MPESA_SHORTCODE);

    const payload = {
      BusinessShortCode: process.env.MPESA_SHORTCODE,
      Password: password,
      Timestamp: timestamp,
      TransactionType: 'CustomerBuyGoodsOnline',
      Amount: Math.round(amount),
      PartyA: formattedPhone,
      PartyB: process.env.MPESA_SHORTCODE,
      PhoneNumber: formattedPhone,
      CallBackURL: `${process.env.CALLBACK_BASE_URL}/callback`,
      AccountReference: 'DelaSandraBday',
      TransactionDesc: `Birthday support from ${name}`
    };

    console.log('📤 Payload:', JSON.stringify(payload, null, 2));

    const stkResponse = await axios.post(stkUrl, payload, {
      headers: { Authorization: `Bearer ${token}` }
    });

    console.log('✅ Success:', stkResponse.data);

    // Store supporter
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
    console.error('❌ Error:');
    console.error('   Status:', error.response?.status);
    console.error('   Data:', JSON.stringify(error.response?.data, null, 2));
    console.error('   Message:', error.message);

    const errorMsg = error.response?.data?.errorMessage ||
                     error.response?.data?.ResponseDescription ||
                     error.response?.data?.message ||
                     'Payment request failed. Please try again.';

    res.status(500).json({ error: errorMsg });
  }
});

// ─── /callback ENDPOINT ───
app.post('/callback', (req, res) => {
  console.log('🔔 Callback received:', JSON.stringify(req.body, null, 2));

  const result = req.body.Body?.stkCallback;
  if (!result) {
    return res.status(400).json({ message: 'Invalid callback format' });
  }

  const checkoutRequestID = result.CheckoutRequestID;
  const resultCode = result.ResultCode;

  const supporter = supporters.find(s => s.checkoutRequestID === checkoutRequestID);

  if (supporter) {
    supporter.status = resultCode === 0 ? 'confirmed' : 'failed';
    console.log(`✅ Supporter ${supporter.name} status: ${supporter.status}`);
  }

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
    supporters: supporters.filter(s => s.status === 'confirmed').length
  });
});

// ─── START SERVER ───
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('═══════════════════════════════════════════════');
  console.log('🚀 Dela Birthday Backend Running');
  console.log(`🌍 Environment: ${process.env.MPESA_ENV || 'NOT SET!'}`);
  console.log(`🏪 Shortcode: ${process.env.MPESA_SHORTCODE || 'NOT SET!'}`);
  console.log(`📡 Callback: ${process.env.CALLBACK_BASE_URL || 'NOT SET!'}/callback`);
  console.log(`🔑 Consumer Key: ${process.env.MPESA_CONSUMER_KEY ? '✅ SET' : '❌ MISSING'}`);
  console.log(`🔐 Consumer Secret: ${process.env.MPESA_CONSUMER_SECRET ? '✅ SET' : '❌ MISSING'}`);
  console.log(`🔑 Passkey: ${process.env.MPESA_PASSKEY ? '✅ SET' : '❌ MISSING'}`);
  console.log('═══════════════════════════════════════════════');
});