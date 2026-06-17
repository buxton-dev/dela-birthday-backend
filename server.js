// ============================================
// SECTION 1: SETUP
// Wake up the tools we borrowed in package.json
// ============================================
require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
app.use(cors());           // allow our Surge frontend to talk to this backend
app.use(express.json());   // allow this server to understand JSON sent from the frontend

// In-memory list of supporters. (Beginner note: this resets if the server restarts.
// Good enough for now - we can upgrade to permanent storage later if you want.)
let supporters = [];

// ============================================
// SECTION 2: GET A TOKEN
// Every request to Safaricom needs fresh "ID" first.
// This function asks Safaricom: "here's my Consumer Key + Secret, give me a token"
// ============================================
async function getAccessToken() {
  const url =
    process.env.MPESA_ENV === 'production'
      ? 'https://api.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials'
      : 'https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials';

  // Safaricom wants the key+secret combined and encoded in a specific way (Base64)
  const auth = Buffer.from(
    `${process.env.MPESA_CONSUMER_KEY}:${process.env.MPESA_CONSUMER_SECRET}`
  ).toString('base64');

  const response = await axios.get(url, {
    headers: { Authorization: `Basic ${auth}` }
  });

  return response.data.access_token;
}

// ============================================
// SECTION 3A: DOOR 1 - "/pay"
// Your frontend knocks here when someone fills the support form.
// We take their phone + amount, get a token, then ask Safaricom
// to buzz that phone with a PIN prompt.
// ============================================
app.post('/pay', async (req, res) => {
  try {
    const { phone, amount, name } = req.body;

    // Basic safety checks before we bother Safaricom at all
    if (!phone || !amount || !name) {
      return res.status(400).json({ error: 'Name, phone, and amount are all required.' });
    }
    if (amount < 1) {
      return res.status(400).json({ error: 'Amount must be at least 1.' });
    }

    const token = await getAccessToken();

    // Safaricom requires a timestamp in this exact format: YYYYMMDDHHmmss
    const timestamp = new Date()
      .toISOString()
      .replace(/[^0-9]/g, '')
      .slice(0, 14);

    // The "password" is shortcode + passkey + timestamp, Base64 encoded together
    const password = Buffer.from(
      `${process.env.MPESA_SHORTCODE}${process.env.MPESA_PASSKEY}${timestamp}`
    ).toString('base64');

    const stkUrl =
      process.env.MPESA_ENV === 'production'
        ? 'https://api.safaricom.co.ke/mpesa/stkpush/v1/processrequest'
        : 'https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest';

    const stkResponse = await axios.post(
      stkUrl,
      {
        BusinessShortCode: process.env.MPESA_SHORTCODE,
        Password: password,
        Timestamp: timestamp,
        TransactionType: 'CustomerBuyGoodsOnline',
        Amount: amount,
        PartyA: phone,
        PartyB: process.env.MPESA_SHORTCODE,
        PhoneNumber: phone,
        CallBackURL: `${process.env.CALLBACK_BASE_URL}/callback`,
        AccountReference: 'DelaSandraBday',
        TransactionDesc: `Birthday support from ${name}`
      },
      { headers: { Authorization: `Bearer ${token}` } }
    );

    // Temporarily remember this person as "pending" until the callback confirms them
    supporters.push({
      name,
      phone,
      amount,
      status: 'pending',
      checkoutRequestID: stkResponse.data.CheckoutRequestID
    });

    res.json({
      message: 'Check your phone for the M-Pesa PIN prompt!',
      checkoutRequestID: stkResponse.data.CheckoutRequestID
    });
  } catch (error) {
    console.error('STK Push error:', error.response?.data || error.message);
    res.status(500).json({ error: 'Something went wrong starting the payment. Please try again.' });
  }
});

// ============================================
// SECTION 3B: DOOR 2 - "/callback"
// Safaricom itself knocks here, automatically, after the person
// enters their PIN (or cancels, or times out).
// This is HOW we find out whether the payment actually succeeded.
// ============================================
app.post('/callback', (req, res) => {
  console.log('Callback received:', JSON.stringify(req.body));

  const result = req.body.Body?.stkCallback;
  if (!result) {
    return res.status(400).json({ message: 'Invalid callback format' });
  }

  const checkoutRequestID = result.CheckoutRequestID;
  const resultCode = result.ResultCode; // 0 = success, anything else = failed/cancelled

  const supporter = supporters.find(s => s.checkoutRequestID === checkoutRequestID);

  if (supporter) {
    supporter.status = resultCode === 0 ? 'confirmed' : 'failed';
  }

  // Safaricom just wants a 200 OK back to know we received it
  res.json({ message: 'Callback received' });
});

// ============================================
// EXTRA DOOR: lets your frontend ask "is this payment done yet?"
// and also lets us show the supporters list
// ============================================
app.get('/status/:checkoutRequestID', (req, res) => {
  const supporter = supporters.find(
    s => s.checkoutRequestID === req.params.checkoutRequestID
  );
  res.json(supporter || { status: 'not_found' });
});

app.get('/supporters', (req, res) => {
  const confirmed = supporters.filter(s => s.status === 'confirmed');
  res.json(confirmed);
});

// ============================================
// START THE SERVER
// ============================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
