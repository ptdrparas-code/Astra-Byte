# AstraByte - Telnyx Outbound Calling & IVR Backend

Outbound IVR calling system built with **Node.js**, **Express**, **Telnyx Call Control API v2**, and exposed via **Tailscale Funnel**.

---

## 🌐 Active Live Endpoints

- **Public Base URL**: `https://paras.tailf684e8.ts.net`
- **Call Control Webhook**: `https://paras.tailf684e8.ts.net/api/telnyx/voice/webhook`
- **Messaging Webhook**: `https://paras.tailf684e8.ts.net/api/telnyx/messaging/webhook`
- **Initiate Outbound Call**: `POST https://paras.tailf684e8.ts.net/api/calls/initiate`

---

## 🛠️ Telnyx Portal Setup Guide

### 1. Voice (Call Control Application)
1. Go to [Telnyx Portal > Voice > Call Control](https://portal.telnyx.com/#/app/call-control/applications).
2. Click **Add New App** (Name: `AstraByte-Call-Control`).
3. Set **Webhook API Version**: `API v2`.
4. Set **Webhook Event URL**:
   ```text
   https://paras.tailf684e8.ts.net/api/telnyx/voice/webhook
   ```
5. Click **Save**. Copy the generated **Application ID** and paste it into `.env` as `TELNYX_CALL_CONTROL_APP_ID`.
6. Assign your Telnyx phone number to this Call Control Application in **Numbers > My Numbers**.

### 2. Messaging (Programmable Messaging Profile)
1. Go to [Telnyx Portal > Messaging > Programmable Messaging](https://portal.telnyx.com/#/app/messaging).
2. Click **Add New Profile** (Name: `AstraByte-SMS`).
3. Set **Webhook API Version**: `API v2`.
4. Set **Inbound Webhook URL**:
   ```text
   https://paras.tailf684e8.ts.net/api/telnyx/messaging/webhook
   ```
5. Assign your Telnyx phone number to this Messaging Profile in **Numbers > My Numbers**.

### 3. API Key
1. Go to **Account Settings > Keys & Credentials > API Keys**.
2. Create/copy your key and paste it into `.env` as `TELNYX_API_KEY`.

---

## ⚙️ Environment Variables (`.env`)

Edit your [.env](file:///c:/Users/DELL/OneDrive/Desktop/Astra-Byte/.env) file:

```env
PORT=3000
TELNYX_API_KEY=KEY...
TELNYX_CALL_CONTROL_APP_ID=your-call-control-app-id
TELNYX_PHONE_NUMBER=+1XXXXXXXXXX
PUBLIC_URL=https://paras.tailf684e8.ts.net
MONGODB_URI=mongodb://localhost:27017/astrabyte
```

---

## 📞 How the IVR Flow Works

1. You trigger an outbound call by sending a POST request:
   ```bash
   curl -X POST http://localhost:3000/api/calls/initiate \
     -H "Content-Type: application/json" \
     -d '{"to": "+15551234567"}'
   ```
2. Telnyx dials the recipient number.
3. When answered (`call.answered`), the backend speaks the menu in a **female voice**:
   > *"Hello. Please choose an option from the menu: Press 1 to create an account. Press 2 for forgot password. Press 3 to repeat this menu."*
4. Caller presses a digit (`call.gather.ended`):
   - **`1` (Create Account)**:
     - Sends dummy SMS: *"Welcome to AstraByte! Complete your account registration here: https://example.com/signup?ref=call"*
     - Speaks: *"We have sent a text message with instructions to create your account. Thank you, goodbye!"*
     - Hangs up the call.
   - **`2` (Forgot Password)**:
     - Sends dummy SMS: *"AstraByte Security: Click here to reset your password: https://example.com/reset-password?token=dummy123"*
     - Speaks: *"We have sent a password reset link to your phone number via text. Thank you, goodbye!"*
     - Hangs up the call.
   - **`3` (Repeat)**:
     - Replays the main menu gather prompt.
   - **Invalid / Timeout**:
     - Speaks: *"Sorry, we did not receive a valid selection. Goodbye."* and hangs up.

---

## 🏃 Commands

- Start server: `npm start`
- Start server in dev/watch mode: `npm run dev`

## Niti Mail frontend

The frontend is served at `http://localhost:3000`. It includes sign-in, first-login profile setup, inbox folders, search, message reading, starring, and composing with an optional attachment. It is wired for these same-origin API routes:

- `GET /api/auth/me`
- `POST /api/auth/login`
- `POST /api/auth/request-code` (send a sign-in code through Telnyx)
- `POST /api/auth/complete-profile`
- `POST /api/auth/logout`
- `GET /api/mail/messages?folder=inbox`
- `PATCH /api/mail/messages/:id`
- `POST /api/mail/messages` (multipart message and optional attachment)

These account and mail routes are frontend integration points; the current backend does not implement them yet. The server still contains the existing Telnyx calling routes.

## IVR account provisioning database

Pressing "1" checks "users.phoneNumber" in MongoDB. Existing users receive an SMS saying they already have an account. New numbers get a pending-profile user record with a phone-derived "@niti.com" login address and a random temporary password; only its scrypt hash is stored. Credentials expire after 24 hours. MongoDB must be connected before the IVR sends credentials.
