const telnyxService = require('./telnyx.service');
const accountService = require('./account.service');

const MAIN_MENU_PROMPT =
  'Hello. Thank you for calling Niti Mail. ' +
  'To create an account, press 1. ' +
  'For password help, press 2. ' +
  'To hear these options again, press 3.';

class IVRService {
  constructor() {
    this.startingMenus = new Map();
  }

  async handleCallAnswered(payload) {
    const callControlId = payload.call_control_id;
    const existingStart = this.startingMenus.get(callControlId);
    if (existingStart) {
      console.log('Ignoring duplicate answered event for ' + callControlId + '.');
      return existingStart;
    }
    console.log('Call answered; starting the IVR menu for ' + callControlId + '.');

    const direction = this.getCallDirection(payload.client_state);
    const startMenu = telnyxService.gatherUsingSpeak(callControlId, MAIN_MENU_PROMPT, {
      client_state: this.encodeClientState({ menu: 'main', direction }),
    });
    this.startingMenus.set(callControlId, startMenu);
    try {
      await startMenu;
    } catch (error) {
      this.startingMenus.delete(callControlId);
      throw error;
    }
  }

  handleCallEnded(payload) {
    this.startingMenus.delete(payload.call_control_id);
  }

  async handleGatherEnded(payload) {
    const callControlId = payload.call_control_id;
    const digits = payload.digits;
    const direction = this.getCallDirection(payload.client_state);
    const userPhone = direction === 'incoming' ? payload.from : payload.to;

    console.log('Gather ended for ' + callControlId + '; digit received: "' + (digits || '') + '".');

    switch (digits) {
      case '1': {
        let account;
        let failureStage = 'account lookup or creation';
        try {
          account = await accountService.provisionFromPhone(userPhone);

          if (account.exists) {
            failureStage = 'existing-account SMS delivery';
            await telnyxService.sendSMS(account.phoneNumber, 'Your Niti Mail login is: ' + account.emailAddress + '. You already have an account.');
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
          client_state: this.encodeClientState({ menu: 'main', direction }),
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
    const clientState = this.decodeClientState(payload.client_state);

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

  encodeClientState(state) {
    return Buffer.from(JSON.stringify(state)).toString('base64');
  }

  decodeClientState(encodedState) {
    if (!encodedState) return null;
    try {
      return JSON.parse(Buffer.from(encodedState, 'base64').toString('utf8'));
    } catch {
      return null;
    }
  }

  getCallDirection(encodedState) {
    return this.decodeClientState(encodedState)?.direction === 'incoming' ? 'incoming' : 'outgoing';
  }
}

module.exports = new IVRService();
