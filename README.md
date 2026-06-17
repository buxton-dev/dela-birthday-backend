# Dela & Sandra Birthday Support Backend

Backend server that triggers M-Pesa STK push payments when guests support
the joint birthday celebration (July 11, 2026).

## What this does
1. Frontend sends a name, phone number, and amount to `/pay`
2. This server asks Safaricom to send a PIN prompt to that phone
3. Safaricom calls back `/callback` once the guest pays (or cancels)
4. Confirmed supporters show up at `/supporters`

## Running locally
1. `npm install`
2. Fill in your real Consumer Key/Secret in `.env` (never commit this file)
3. `npm start`
4. Server runs on http://localhost:3000

## Currently in SANDBOX mode
No real money moves yet. Switch `MPESA_ENV` to `production` and update
shortcode/passkey only once everything is tested and working.
