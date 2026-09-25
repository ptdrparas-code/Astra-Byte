const express = require('express');
const router = express.Router();
const callController = require('../controllers/call.controller');

// Trigger an outbound call
router.post('/initiate', (req, res) => callController.initiateOutboundCall(req, res));

module.exports = router;
