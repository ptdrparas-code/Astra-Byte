const express = require('express');
const cors = require('cors');
const callRoutes = require('./routes/call.routes');
const webhookRoutes = require('./routes/webhook.routes');

const app = express();

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// API status
app.get('/api/status', (req, res) => {
  res.json({
    status: 'online',
    service: 'AstraByte IVR & Outbound Calling Backend',
    publicUrl: process.env.PUBLIC_URL || 'https://paras.tailf684e8.ts.net',
    endpoints: {
      initiateCall: 'POST /api/calls/initiate',
      voiceWebhook: 'POST /api/telnyx/voice/webhook',
      messagingWebhook: 'POST /api/telnyx/messaging/webhook',
    },
  });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

// Routes
app.use('/api/calls', callRoutes);
app.use('/api/telnyx', webhookRoutes);

// Niti Mail frontend
app.use(express.static(require('path').join(__dirname, '..', 'public')));

// 404 Handler
app.use((req, res) => {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.originalUrl}` });
});

module.exports = app;
