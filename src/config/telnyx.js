const Telnyx = require('telnyx');

const apiKey = process.env.TELNYX_API_KEY || 'dummy_key';
const telnyx = new Telnyx(apiKey);

module.exports = {
  telnyx,
  callControlAppId: process.env.TELNYX_CALL_CONTROL_APP_ID,
  messagingProfileId: process.env.TELNYX_MESSAGING_PROFILE_ID,
  phoneNumber: process.env.TELNYX_PHONE_NUMBER,
  publicUrl: process.env.PUBLIC_URL || 'https://paras.tailf684e8.ts.net',
};
