const express = require('express');
const router = express.Router();
const webhookController = require('../controllers/webhook.controller');

// Telnyx Call Control Webhook
router.post('/voice/webhook', (req, res) => webhookController.handleVoiceWebhook(req, res));

// Telnyx Messaging Webhook
router.post('/messaging/webhook', (req, res) => webhookController.handleMessagingWebhook(req, res));

module.exports = router;
