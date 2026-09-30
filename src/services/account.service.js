const mongoose = require('mongoose');
const User = require('../models/user.model');
const { generateTemporaryPassword, hashPassword } = require('../utils/credentials');
const connectDB = require('../config/database');

function normalizeE164(value) {
  let digits = String(value || '').replace(/\D/g, '');
  if (digits.length === 10) digits = `91${digits}`;
  if (!digits || digits.length > 15 || digits.length < 2 || digits.startsWith('0')) {
    throw new Error('The called number is not a valid E.164 phone number.');
  }
  return `+${digits}`;
}

function getEmailAddress(phoneNumber) {
  const digits = String(phoneNumber || '').replace(/\D/g, '');
  return `${digits.slice(-10)}@niti.com`;
}

class AccountService {
  async provisionFromPhone(phoneValue) {
    if (mongoose.connection.readyState !== 1) {
      const connected = await connectDB();
      if (!connected || mongoose.connection.readyState !== 1) {
        throw new Error('The account database is unavailable. No account credentials were sent.');
      }
    }

    const phoneNumber = normalizeE164(phoneValue);
    const existingUser = await User.findOne({ phoneNumber });
    if (existingUser) return { exists: true, phoneNumber, emailAddress: existingUser.emailAddress };

    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await hashPassword(temporaryPassword);
    const user = new User({
      phoneNumber,
      emailAddress: getEmailAddress(phoneNumber),
      passwordHash,
      mustChangePassword: true,
      credentialsExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      credentialsSmsStatus: 'pending',
      accountStatus: 'profile_pending',
    });

    try {
      await user.save();
      return { exists: false, phoneNumber, emailAddress: user.emailAddress, temporaryPassword, userId: user._id };
    } catch (error) {
      // A second simultaneous call may have inserted this phone after our lookup.
      if (error?.code === 11000) {
        const racedUser = await User.findOne({ phoneNumber });
        if (racedUser) return { exists: true, phoneNumber, emailAddress: racedUser.emailAddress };
      }
      throw error;
    }
  }

  async markCredentialsSent(userId) {
    await User.updateOne({ _id: userId }, {
      $set: { credentialsSmsStatus: 'sent', credentialsSentAt: new Date() },
    });
  }

  async markCredentialsFailed(userId) {
    await User.updateOne({ _id: userId }, { $set: { credentialsSmsStatus: 'failed' } });
  }
}

module.exports = new AccountService();
