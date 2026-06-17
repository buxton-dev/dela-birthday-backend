// ============================================
// DELA BIRTHDAY - COMPLETE BACKEND
// ============================================

require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// ─── DATA (In-memory for now) ───
let supporters = [];        // Payment records
let guests = [];            // Guest list (confirmed RSVPs)

// ─── TEST DATA (You can remove this) ───
// These will show up as examples
const testGuests = [
  { name: 'Delaquez', phone: '254712345678', status: 'confirmed', rsvp: true },
  { name: 'Sandra', phone: '254798765432', status: 'confirmed', rsvp: true },
];
guests.push(...testGuests);

// ─── HELPERS ───
function formatPhone(phone) {
  let cleaned = phone.replace(/[\s\-\(\)]/g, '');
  cleaned = cleaned.replace(/^\+/, '');
  cleaned = cleaned.replace(/^0/, '');
  if (!cleaned.startsWith('254')) {
    cleaned = '254' + cleaned;
  }
  return cleaned;
}

function generateQRData(phone) {
  // This will be used to generate QR codes
  // The QR will contain: https://dela-birthday.surge.sh/rsvp?phone=254712345678
  return `${process.env.FRONTEND_URL}/rsvp?phone=${phone}`;
}

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

// ─── /pay ENDPOINT ───
app.post('/pay', async (req, res) => {
  try {
    let { phone, amount, name } = req.body;

    if (!phone || !amount || !name) {
      return res.status(400).json({ error: 'Name, phone, and amount are required.' });
    }

    const formattedPhone = formatPhone(phone);

    // Check if this phone already RSVP'd
    const existingGuest = guests.find(g => g.phone === formattedPhone);
    if (existingGuest && existingGuest.rsvp === true) {
      // They already RSVP'd — skip payment flow and go straight to invitation
      return res.json({
        message: 'You are already on the guest list! 🎉',
        checkoutRequestID: null,
        alreadyConfirmed: true,
        redirectUrl: `${process.env.FRONTEND_URL}/invitation.html?phone=${formattedPhone}`
      });
    }

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

    const payload = {
      BusinessShortCode: process.env.MPESA_SHORTCODE,
      Password: password,
      Timestamp: timestamp,
      TransactionType:
        process.env.MPESA_ENV === 'production'
          ? 'CustomerBuyGoodsOnline'
          : 'CustomerPayBillOnline',
      Amount: Math.round(amount),
      PartyA: formattedPhone,
      PartyB: process.env.MPESA_SHORTCODE,
      PhoneNumber: formattedPhone,
      CallBackURL: `${process.env.CALLBACK_BASE_URL}/callback`,
      AccountReference: 'DelaSandraBday',
      TransactionDesc: `Birthday support from ${name}`
    };

    const stkResponse = await axios.post(stkUrl, payload, {
      headers: { Authorization: `Bearer ${token}` }
    });

    // Store supporter as pending
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
    console.error('❌ Error:', error.response?.data || error.message);
    const errorMsg = error.response?.data?.errorMessage || 'Payment failed. Please try again.';
    res.status(500).json({ error: errorMsg });
  }
});

// ─── /callback ENDPOINT ───
app.post('/callback', (req, res) => {
  console.log('🔔 Callback received');

  const result = req.body.Body?.stkCallback;
  if (!result) {
    return res.status(400).json({ message: 'Invalid callback format' });
  }

  const checkoutRequestID = result.CheckoutRequestID;
  const resultCode = result.ResultCode;

  const supporter = supporters.find(s => s.checkoutRequestID === checkoutRequestID);

  if (supporter) {
    supporter.status = resultCode === 0 ? 'confirmed' : 'failed';

    if (resultCode === 0) {
      const metadata = result.CallbackMetadata?.Item || [];
      const receipt = metadata.find(item => item.Name === 'MpesaReceiptNumber');
      const amount = metadata.find(item => item.Name === 'Amount');

      supporter.receiptNumber = receipt?.Value;
      supporter.transactionAmount = amount?.Value;

      // ─── AUTO-RSVP: Add to guest list if payment successful ───
      // Check if already in guest list
      const existingGuest = guests.find(g => g.phone === supporter.phone);
      if (!existingGuest) {
        guests.push({
          name: supporter.name,
          phone: supporter.phone,
          status: 'confirmed',
          rsvp: true,
          receipt: supporter.receiptNumber,
          paidAmount: supporter.transactionAmount
        });
        console.log(`✅ ${supporter.name} added to guest list!`);
      } else if (!existingGuest.rsvp) {
        existingGuest.rsvp = true;
        existingGuest.status = 'confirmed';
        console.log(`✅ ${supporter.name} updated to RSVP confirmed!`);
      }

      console.log(`✅ Payment confirmed for ${supporter.name}`);
      console.log(`🧾 Receipt: ${supporter.receiptNumber}`);
    } else {
      console.log(`❌ Payment failed: ${result.ResultDesc}`);
    }
  }

  res.json({ message: 'Callback received' });
});

// ─── /status ENDPOINT ───
app.get('/status/:checkoutRequestID', (req, res) => {
  const supporter = supporters.find(
    s => s.checkoutRequestID === req.params.checkoutRequestID
  );
  res.json(supporter || { status: 'not_found' });
});

// ─── /guest-list ENDPOINT ───
app.get('/guest-list', (req, res) => {
  // Return all confirmed guests (for admin view)
  const confirmedGuests = guests.filter(g => g.rsvp === true);
  res.json(confirmedGuests);
});

// ─── /guest/:phone ENDPOINT ───
app.get('/guest/:phone', (req, res) => {
  const formattedPhone = formatPhone(req.params.phone);
  const guest = guests.find(g => g.phone === formattedPhone);
  if (guest) {
    res.json(guest);
  } else {
    res.json({ status: 'not_found' });
  }
});

// ─── /rsvp ENDPOINT ───
app.post('/rsvp', (req, res) => {
  const { phone, name } = req.body;
  const formattedPhone = formatPhone(phone);

  // Check if already RSVP'd
  const existingGuest = guests.find(g => g.phone === formattedPhone);
  if (existingGuest && existingGuest.rsvp === true) {
    return res.json({ 
      message: 'You are already on the guest list! 🎉',
      alreadyConfirmed: true
    });
  }

  // If guest exists but didn't RSVP (e.g., paid but system didn't add)
  if (existingGuest) {
    existingGuest.rsvp = true;
    existingGuest.status = 'confirmed';
    return res.json({ 
      message: 'You are now on the guest list! 🎉',
      success: true
    });
  }

  // New guest
  guests.push({
    name: name || 'Guest',
    phone: formattedPhone,
    status: 'confirmed',
    rsvp: true
  });

  res.json({ 
    message: 'You are now on the guest list! 🎉',
    success: true
  });
});

// ─── HEALTH CHECK ───
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    environment: process.env.MPESA_ENV,
    shortcode: process.env.MPESA_SHORTCODE,
    totalGuests: guests.filter(g => g.rsvp === true).length
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('═══════════════════════════════════════════════');
  console.log('🚀 Dela Birthday Backend Running');
  console.log(`🌍 Environment: ${process.env.MPESA_ENV || 'NOT SET!'}`);
  console.log(`🏪 Shortcode: ${process.env.MPESA_SHORTCODE || 'NOT SET!'}`);
  console.log(`👥 Guests: ${guests.filter(g => g.rsvp === true).length}`);
  console.log('═══════════════════════════════════════════════');
});