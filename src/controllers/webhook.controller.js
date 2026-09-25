const ivrService = require('../services/ivr.service');

class WebhookController {
  /**
   * Handles incoming Telnyx Call Control (Voice) Webhook events
   */
  async handleVoiceWebhook(req, res) {
    // Telnyx expects a 200 OK immediately
    res.status(200).json({ received: true });

    try {
      const event = req.body?.data;
      if (!event) return;

      const eventType = event.event_type;
      const payload = event.payload;

      console.log(`\n🔔 [Telnyx Voice Event]: ${eventType} | Call ID: ${payload?.call_control_id}`);

      switch (eventType) {
        case 'call.answered':
          await ivrService.handleCallAnswered(payload);
          break;

        case 'call.gather.ended':
          await ivrService.handleGatherEnded(payload);
          break;

        case 'call.speak.ended':
          await ivrService.handleSpeakEnded(payload);
          break;

        case 'call.hangup':
          console.log(`📴 Call has ended. Call ID: ${payload.call_control_id} | Reason: ${payload.hangup_source}`);
          break;

        case 'call.initiated':
          console.log(`📞 Outbound call initiated to: ${payload.to}`);
          break;

        default:
          console.log(`ℹ️  Unhandled voice event type: ${eventType}`);
          break;
      }
    } catch (error) {
      console.error('❌ Error handling voice webhook event:', error.message);
    }
  }

  /**
   * Handles incoming Telnyx Messaging (SMS) Webhook events
   */
  async handleMessagingWebhook(req, res) {
    res.status(200).json({ received: true });

    try {
      const event = req.body?.data;
      if (!event) return;

      const eventType = event.event_type;
      const payload = event.payload;

      console.log(`\n💬 [Telnyx SMS Event]: ${eventType} | To: ${payload?.to?.[0]?.phone_number || payload?.to}`);
    } catch (error) {
      console.error('❌ Error handling messaging webhook:', error.message);
    }
  }
}

module.exports = new WebhookController();
