const { telnyx, callControlAppId, messagingProfileId, phoneNumber } = require('../config/telnyx');

const ttsVoice = process.env.TELNYX_TTS_VOICE || 'AWS.Polly.Joanna-Neural';
const ttsLanguage = process.env.TELNYX_TTS_LANGUAGE || 'en-US';
const ttsServiceLevel = process.env.TELNYX_TTS_SERVICE_LEVEL || 'premium';

class TelnyxService {
  /**
   * Initiates an outbound call to a target phone number
   * @param {string} to - Destination phone number in E.164 format (+1XXXXXXXXXX)
   */
  async dialOutbound(to) {
    if (!phoneNumber) {
      throw new Error('TELNYX_PHONE_NUMBER is not set in environment variables');
    }
    if (!callControlAppId) {
      throw new Error('TELNYX_CALL_CONTROL_APP_ID is not set in environment variables');
    }

    console.log(`📞 Initiating outbound call to ${to} from ${phoneNumber}...`);
    const response = await telnyx.calls.dial({
      to,
      from: phoneNumber,
      connection_id: callControlAppId,
      timeout_secs: 60,
    });

    return response.data;
  }

  /**
   * Answers an inbound call and marks later webhooks as incoming.
   * @param {string} callControlId
   * @param {string} commandId
   */
  async answerInbound(callControlId, commandId) {
    if (!callControlId) {
      throw new Error('Telnyx call_control_id is missing from the inbound call event');
    }

    return await telnyx.calls.actions.answer(callControlId, {
      client_state: Buffer.from(JSON.stringify({ direction: 'incoming' })).toString('base64'),
      ...(commandId ? { command_id: commandId } : {}),
    });
  }

  /**
   * Speaks a prompt with the configured TTS voice and gathers DTMF digits
   * @param {string} callControlId
   * @param {string} payload - Text to speak
   * @param {object} customOptions
   */
  async gatherUsingSpeak(callControlId, payload, customOptions = {}) {
    console.log(`🎙️  Gathering input with ${ttsVoice} TTS for Call ID: ${callControlId}`);
    return await telnyx.calls.actions.gatherUsingSpeak(callControlId, {
      payload,
      service_level: ttsServiceLevel,
      voice: ttsVoice,
      language: ttsLanguage,
      valid_digits: '123',
      max: 1,
      timeout_millis: 10000,
      ...customOptions,
    });
  }

  /**
   * Speaks a message with the configured TTS voice to the caller
   * @param {string} callControlId
   * @param {string} payload - Text to speak
   * @param {object} customOptions
   */
  async speak(callControlId, payload, customOptions = {}) {
    console.log(`🗣️  Speaking to caller: "${payload}" (Call ID: ${callControlId})`);
    try {
      return await telnyx.calls.actions.speak(callControlId, {
        payload,
        service_level: ttsServiceLevel,
        voice: ttsVoice,
        language: ttsLanguage,
        ...customOptions,
      });
    } catch (error) {
      if (error.message && error.message.includes('90018')) {
        console.log(`ℹ️  Call ${callControlId} already ended by caller before speak completed.`);
        return null;
      }
      throw error;
    }
  }

  /**
   * Terminates the active call
   * @param {string} callControlId
   */
  async hangup(callControlId) {
    console.log(`📴 Hanging up call: ${callControlId}`);
    try {
      return await telnyx.calls.actions.hangup(callControlId, {});
    } catch (error) {
      console.warn(`Hangup note: ${error.message}`);
    }
  }

  /**
   * Sends an SMS message to a phone number
   * @param {string} to - Destination phone number
   * @param {string} text - Message content
   */
  async sendSMS(to, text) {
    if (!phoneNumber) {
      throw new Error('TELNYX_PHONE_NUMBER is not set in environment variables');
    }

    console.log(`✉️  Sending SMS to ${to}.`);
    const payload = {
      from: phoneNumber,
      to,
      text,
    };
    if (messagingProfileId) {
      payload.messaging_profile_id = messagingProfileId;
    }
    const response = await telnyx.messages.send(payload);

    return response.data;
  }
}

module.exports = new TelnyxService();
