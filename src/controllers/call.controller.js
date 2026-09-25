const telnyxService = require('../services/telnyx.service');

class CallController {
  /**
   * Initiates an outbound call to a specified phone number
   * Request Body: { "to": "+1XXXXXXXXXX" }
   */
  async initiateOutboundCall(req, res) {
    try {
      const { to } = req.body;

      if (!to) {
        return res.status(400).json({
          success: false,
          error: 'Missing required field: "to". Provide a phone number in E.164 format (e.g. +1XXXXXXXXXX).',
        });
      }

      // Basic E.164 phone number sanity check
      const phoneRegex = /^\+[1-9]\d{1,14}$/;
      if (!phoneRegex.test(to.replace(/\s+/g, ''))) {
        return res.status(400).json({
          success: false,
          error: 'Invalid phone format. Please use E.164 standard (e.g., +15551234567).',
        });
      }

      const formattedNumber = to.replace(/\s+/g, '');
      const callData = await telnyxService.dialOutbound(formattedNumber);

      return res.status(200).json({
        success: true,
        message: 'Outbound call initiated successfully',
        call: {
          callControlId: callData.call_control_id,
          callLegId: callData.call_leg_id,
          to: callData.to,
          from: callData.from,
          status: callData.status,
        },
      });
    } catch (error) {
      console.error('❌ Error initiating outbound call:', error.message);
      return res.status(500).json({
        success: false,
        error: error.message || 'Failed to initiate outbound call',
      });
    }
  }
}

module.exports = new CallController();
