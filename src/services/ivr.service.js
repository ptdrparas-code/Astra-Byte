const telnyxService = require('./telnyx.service');
const accountService = require('./account.service');

const MAIN_MENU_PROMPT =
  'Hello user, thank you for calling. ' +
  'Press 1 to create an account. ' +
  'Press 2 for forgot password. ' +
  'Press 3 to repeat this menu.';

class IVRService {
  async handleCallAnswered(payload) {
    const callControlId = payload.call_control_id;
    console.log('Call answered; starting the IVR menu for ' + callControlId + '.');

    await telnyxService.gatherUsingSpeak(callControlId, MAIN_MENU_PROMPT, {
      client_state: Buffer.from(JSON.stringify({ menu: 'main' })).toString('base64'),
    });
  }

  async handleGatherEnded(payload) {
    const callControlId = payload.call_control_id;
    const digits = payload.digits;
    const userPhone = payload.to;

    console.log('Gather ended for ' + callControlId + '; digit received: "' + (digits || '') + '".');

    switch (digits) {
      case '1': {
        let account;
        let failureStage = 'account lookup or creation';
        try {
          account = await accountService.provisionFromPhone(userPhone);

          if (account.exists) {
            failureStage = 'existing-account SMS delivery';
            await telnyxService.sendSMS(account.phoneNumber, 'You already have an account.');
            await this.speakAndEnd(callControlId, 'This phone number already has an account. Goodbye.');
            break;
          }

          const credentialsSMS = [
            'Your Niti account is ready.',
            'Login: ' + account.emailAddress,
            'Temporary password: ' + account.temporaryPassword,
            'Sign in within 24 hours and complete your profile.',
          ].join('\n');

          failureStage = 'credentials SMS delivery';
          await telnyxService.sendSMS(account.phoneNumber, credentialsSMS);
          failureStage = 'updating SMS delivery status';
          try {
            await accountService.markCredentialsSent(account.userId);
          } catch (error) {
            console.error('Could not update credential delivery status (' + (error.name || 'Error') + ').');
          }
          await this.speakAndEnd(callControlId, 'We have sent your temporary account credentials by text. Please complete your profile after signing in. Goodbye.');
        } catch (error) {
          if (account && account.userId) {
            try { await accountService.markCredentialsFailed(account.userId); } catch { /* Keep the original delivery error. */ }
          }
          console.error('IVR option 1 failed:', {
            stage: failureStage,
            name: error.name || 'Error',
            code: error.code || error.errorCode || null,
            status: error.status || error.statusCode || null,
            message: error.message || 'No error message provided',
          });
          await this.speakAndEnd(callControlId, 'We could not complete your account request right now. Please try again later. Goodbye.');
        }
        break;
      }

      case '2':
        await this.speakAndEnd(callControlId, 'Account recovery is not available yet. Please contact support. Goodbye.');
        break;

      case '3':
        console.log('Repeating the IVR menu for ' + callControlId + '.');
        await telnyxService.gatherUsingSpeak(callControlId, MAIN_MENU_PROMPT, {
          client_state: Buffer.from(JSON.stringify({ menu: 'main' })).toString('base64'),
        });
        break;

      default:
        console.log('Invalid digit or timeout for ' + callControlId + '.');
        await this.speakAndEnd(callControlId, 'Sorry, we did not receive a valid selection. Goodbye.');
        break;
    }
  }

  async handleSpeakEnded(payload) {
    const callControlId = payload.call_control_id;
    let clientState = null;

    if (payload.client_state) {
      try {
        clientState = JSON.parse(Buffer.from(payload.client_state, 'base64').toString('utf8'));
      } catch {
        // Ignore invalid client state and leave the call alone.
      }
    }

    if (clientState && clientState.action === 'hangup_after_speak') {
      console.log('Speak finished; ending call ' + callControlId + '.');
      await telnyxService.hangup(callControlId);
    }
  }

  async speakAndEnd(callControlId, message) {
    await telnyxService.speak(callControlId, message, {
      client_state: Buffer.from(JSON.stringify({ action: 'hangup_after_speak' })).toString('base64'),
    });
  }
}

module.exports = new IVRService();
