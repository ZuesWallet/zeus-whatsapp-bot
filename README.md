# ZeusPay WhatsApp Bot

A standalone microservice that powers multi-tenant WhatsApp bots for ZeusPay partners. Partners connect their own Twilio WhatsApp numbers and their customers interact via WhatsApp to check rates, view balances, and cash out crypto to naira — all without opening an app.

---

## Architecture

```
User WhatsApp ──► Twilio ──► /webhook/twilio
                                    │
                              RoutingService
                              (Redis cache → backend resolve API)
                                    │
                              SessionService (Redis)
                                    │
                              Handler Dispatcher
                              ┌─────┴──────────────┐
                            Intent            Active Flow
                            (RATE, BALANCE…)  (CASHOUT, ADD_BANK)
                                    │
                              ZeusPayService
                              (Partner API calls)
                                    │
                              TwilioService ──► User WhatsApp

ZeusPay Backend ──► /internal/notify ──► TwilioService ──► User WhatsApp
```

The service sits between Twilio and the ZeusPay backend. Every inbound WhatsApp message is routed to the correct partner config (from Redis cache or the backend resolve API), processed through keyword-based intent detection and a session-aware handler, then a reply is sent back via Twilio.

---

## Prerequisites

- Node 20+
- Redis (shared with backend)
- A [Twilio account](https://www.twilio.com) with WhatsApp enabled
- ZeusPay backend running and accessible

---

## Setup

```bash
cd whatsapp-bot
npm install
cp .env.example .env
# Edit .env — fill in all required values
npm run dev
```

Required `.env` values:

| Variable | Description |
|---|---|
| `ZEUSPAY_API_URL` | URL of the ZeusPay backend (e.g. `http://localhost:3000`) |
| `REDIS_URL` | Redis connection string — must be the same instance as the backend |
| `ENCRYPTION_KEY` | Must exactly match `WALLET_ENCRYPTION_KEY` from the backend `.env` |
| `SERVICE_SECRET` | Shared secret between backend and this service (generate with `openssl rand -hex 32`) |
| `TWILIO_ACCOUNT_SID` | ZeusPay's Twilio master account SID |
| `TWILIO_AUTH_TOKEN` | ZeusPay's Twilio master auth token |
| `PUBLIC_URL` | Externally reachable URL for this service (for Twilio signature verification) |

---

## Twilio Configuration

### 1. Create a Twilio account

Sign up at [twilio.com](https://www.twilio.com). Note your **Account SID** and **Auth Token** from the console dashboard.

### 2. Enable WhatsApp Sandbox (for testing)

In the Twilio console: **Messaging → Try it out → Send a WhatsApp message**

This gives you a sandbox number immediately. Users join by sending a code to the sandbox number.

Set the sandbox webhook:
- **Messaging → Settings → WhatsApp Sandbox Settings**
- **When a message comes in:** `https://your-domain.com/webhook/twilio`
- Method: HTTP POST

### 3. Register a dedicated number (production)

For production, apply for a dedicated WhatsApp Business number:
- **Messaging → Senders → WhatsApp Senders → Request a number**
- Requires Meta Business Manager account verification (typically 1–5 business days)
- Each partner's number is registered under ZeusPay's Twilio account

### 4. Configure Messaging Service

- **Messaging → Services → Create a Messaging Service**
- Add your WhatsApp number as a sender
- Under **Integration**:
  - **Request URL:** `https://your-domain.com/webhook/twilio`
  - **HTTP Method:** POST

### 5. Local development with ngrok

```bash
# Install ngrok: https://ngrok.com
ngrok http 3001
# Use the https URL as your PUBLIC_URL and Twilio webhook URL
```

---

## Connecting a Partner Number

Partners connect their WhatsApp number via the ZeusPay Partner API:

```bash
POST /api/v1/partner/whatsapp/connect
X-ZeusPay-Key: pk_live_xxx

{
  "whatsappNumber": "+2348012345678",
  "botName": "MyApp Cash",
  "connectionType": "OWNED",
  "bspType": "TWILIO",
  "credentials": {
    "accountSid": "ACxxxx",
    "authToken": "xxxx",
    "messagingServiceSid": "MGxxxx"
  },
  "welcomeMessage": "👋 Welcome to MyApp! Type *help* to get started.",
  "enabledCommands": ["RATE", "BALANCE", "CASHOUT", "HISTORY", "HELP"]
}
```

After connecting, an admin activates the number:

```bash
PUT /api/v1/admin/partners/{partnerId}/whatsapp/activate
```

Once active, the number is live and ready to receive messages.

---

## Testing

Send these messages to your sandbox number to test each command:

| Message | Expected response |
|---|---|
| `hi` | Welcome/help menu |
| `rate` | Live USDT/NGN rate |
| `balance` | Wallet balances |
| `wallet` | Deposit addresses |
| `history` | Last 5 transactions |
| `cash out 100` | Starts cashout flow |
| `cancel` | Cancels active flow |
| `add bank` | Starts add bank flow |

**Multi-step cashout flow:**
1. Send `cash out 100`
2. Bot shows preview and asks for bank selection
3. Reply with `1` (existing bank) or select "Add new bank"
4. Enter your 6-digit PIN
5. Bot confirms and processes

---

## Deployment

The service is a standard Node.js HTTP server. Deploy to any Node host:

**Railway:**
```bash
railway init
railway up
# Set env vars in Railway dashboard
```

**Render:**
- New Web Service → connect repo → set root directory to `whatsapp-bot/`
- Build command: `npm install && npm run build`
- Start command: `npm start`

**Environment variables** must match the backend exactly — especially `ENCRYPTION_KEY` and `SERVICE_SECRET`.

After deployment, update the Twilio webhook URL to your production URL.
