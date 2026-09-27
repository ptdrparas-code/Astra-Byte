const crypto = require('crypto');
const mongoose = require('mongoose');
const User = require('../models/user.model');
const telnyxService = require('../services/telnyx.service');
const { generateTemporaryPassword, hashPassword, verifyPassword } = require('../utils/credentials');

const COOKIE_NAME = 'niti_session';
const OTP_COOKIE_NAME = 'niti_otp';
const SESSION_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const OTP_AGE_MS = 5 * 60 * 1000;
const OTP_RESEND_WAIT_MS = 30 * 1000;
const MAX_OTP_ATTEMPTS = 5;
const sessionSecret = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

function normalizePhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length < 2 || digits.length > 15 || digits.startsWith('0')) return null;
  return `+${digits}`;
}

function sign(value) {
  return crypto.createHmac('sha256', sessionSecret).update(value).digest('base64url');
}

function makeSignedToken(data) {
  const payload = Buffer.from(JSON.stringify(data)).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

function readSignedToken(req, cookieName) {
  const cookie = String(req.headers.cookie || '').split(';').map((part) => part.trim()).find((part) => part.startsWith(`${cookieName}=`));
  if (!cookie) return null;
  const token = decodeURIComponent(cookie.slice(cookieName.length + 1));
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;
  const expected = Buffer.from(sign(payload));
  const actual = Buffer.from(signature);
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return null;
  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return session.exp > Date.now() ? session : null;
  } catch {
    return null;
  }
}

function setCookies(res, values) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', values.map(({ name, value, maxAge }) => `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`));
}

function setSessionCookie(res, userId) {
  setCookies(res, [{ name: COOKIE_NAME, value: makeSignedToken({ sub: String(userId), exp: Date.now() + SESSION_AGE_MS }), maxAge: SESSION_AGE_MS / 1000 }]);
}

function setOtpCookie(res, userId, challengeId) {
  setCookies(res, [
    { name: OTP_COOKIE_NAME, value: makeSignedToken({ sub: String(userId), challengeId, exp: Date.now() + OTP_AGE_MS }), maxAge: OTP_AGE_MS / 1000 },
    { name: COOKIE_NAME, value: '', maxAge: 0 },
  ]);
}

function clearOtpCookie(res) {
  setCookies(res, [{ name: OTP_COOKIE_NAME, value: '', maxAge: 0 }]);
}

function clearSessionCookie(res) {
  setCookies(res, [{ name: COOKIE_NAME, value: '', maxAge: 0 }]);
}

function sessionUserId(req) {
  return readSignedToken(req, COOKIE_NAME)?.sub || null;
}

function otpSession(req) {
  return readSignedToken(req, OTP_COOKIE_NAME);
}

function generateOtp() {
  return String(crypto.randomInt(100000, 1000000));
}

async function sendOtp(user, code) {
  await telnyxService.sendSMS(user.phoneNumber, `Your Niti sign-in code is ${code}. It expires in 5 minutes. Do not share this code.`);
}

function toPublicUser(user) {
  const profile = user.profile || {};
  return {
    name: profile.name || '',
    email: user.emailAddress,
    phoneNumber: user.phoneNumber,
    profileComplete: user.accountStatus === 'active' && Boolean(user.profileCompletedAt),
    mustChangePassword: Boolean(user.mustChangePassword),
    age: profile.ageAtRegistration,
    gender: profile.gender,
    profilePicture: profile.avatarData && profile.avatarMimeType
      ? `data:${profile.avatarMimeType};base64,${profile.avatarData}`
      : null,
  };
}

class AuthController {
  async me(req, res) {
    const userId = sessionUserId(req);
    if (!userId) return res.json({ authenticated: false });
    try {
      const user = await User.findById(userId).select('+profile.avatarData +profile.avatarMimeType');
      if (!user || user.accountStatus === 'suspended') {
        clearSessionCookie(res);
        return res.json({ authenticated: false });
      }
      return res.json({ authenticated: true, user: toPublicUser(user) });
    } catch {
      return res.status(503).json({ error: 'Account service is temporarily unavailable.' });
    }
  }

  async searchUsers(req, res) {
    const userId = sessionUserId(req);
    if (!userId) return res.status(401).json({ error: 'Sign in to search Niti members.' });
    const digits = String(req.query.mobile || '').replace(/\D/g, '');
    if (digits.length < 3 || digits.length > 15) return res.status(400).json({ error: 'Enter at least 3 digits to search.' });
    if (mongoose.connection.readyState !== 1) return res.status(503).json({ error: 'Account database is unavailable.' });
    try {
      const requester = await User.findById(userId).select('accountStatus mustChangePassword');
      if (!requester || requester.accountStatus !== 'active' || requester.mustChangePassword) {
        return res.status(403).json({ error: 'Complete your account setup before searching Niti members.' });
      }
      const users = await User.find({
        _id: { $ne: userId },
        accountStatus: 'active',
        phoneNumber: { $regex: `^\\+${digits}` },
      }).select('phoneNumber emailAddress profile.name').sort({ 'profile.name': 1 }).lean();
      return res.json({ users: users.map((user) => ({
        name: user.profile?.name || 'Niti member',
        phoneNumber: user.phoneNumber,
        email: user.emailAddress,
      })) });
    } catch (error) {
      console.error('Member search failed:', error.message);
      return res.status(503).json({ error: 'Could not search Niti members right now.' });
    }
  }

  async login(req, res) {
    if (mongoose.connection.readyState !== 1) return res.status(503).json({ error: 'Account database is unavailable. Please try again shortly.' });
    const identity = String(req.body?.mobile || '').trim();
    const password = String(req.body?.password || '');
    const phoneNumber = identity.includes('@') ? null : normalizePhone(identity);
    const emailAddress = identity.includes('@') ? identity.toLowerCase() : null;
    if ((!phoneNumber && !emailAddress) || !password) return res.status(400).json({ error: 'Enter your mobile number or Niti email and password.' });
    try {
      const user = await User.findOne(phoneNumber ? { phoneNumber } : { emailAddress }).select('+passwordHash +otpHash +profile.avatarData +profile.avatarMimeType');
      if (!user) return res.status(401).json({ error: 'Wrong mobile number, email, or password.' });
      if (user.accountStatus === 'suspended') return res.status(403).json({ error: 'This account is unavailable. Please contact support.' });
      if (user.mustChangePassword && user.credentialsExpiresAt && user.credentialsExpiresAt.getTime() < Date.now()) {
        return res.status(401).json({ error: 'Your temporary password has expired. Request a new code.' });
      }
      if (!(await verifyPassword(password, user.passwordHash))) return res.status(401).json({ error: 'Wrong password. Please try again.' });
      // OTP is an initial account verification step. Preserve that verification for later sign-ins.
      // Active accounts created before this field existed already passed the original OTP flow.
      if (!user.initialOtpVerifiedAt && user.accountStatus === 'active' && user.profileCompletedAt) {
        user.initialOtpVerifiedAt = user.profileCompletedAt;
      }
      if (user.initialOtpVerifiedAt) {
        if (user.isModified('initialOtpVerifiedAt')) await user.save();
        setCookies(res, [
          { name: COOKIE_NAME, value: makeSignedToken({ sub: String(user._id), exp: Date.now() + SESSION_AGE_MS }), maxAge: SESSION_AGE_MS / 1000 },
          { name: OTP_COOKIE_NAME, value: '', maxAge: 0 },
        ]);
        const publicUser = toPublicUser(user);
        return res.json({ user: publicUser, requiresProfileCompletion: !publicUser.profileComplete });
      }
      let challengeId = user.otpChallengeId;
      const activeChallenge = challengeId && user.otpExpiresAt?.getTime() > Date.now() && user.otpAttempts < MAX_OTP_ATTEMPTS;
      const recentlySent = user.otpSentAt && Date.now() - user.otpSentAt.getTime() < OTP_RESEND_WAIT_MS;
      if (!activeChallenge || !recentlySent) {
        const code = generateOtp();
        challengeId = crypto.randomBytes(16).toString('hex');
        user.otpChallengeId = challengeId;
        user.otpHash = await hashPassword(code);
        user.otpExpiresAt = new Date(Date.now() + OTP_AGE_MS);
        user.otpAttempts = 0;
        user.otpSentAt = new Date();
        await user.save();
        try {
          await sendOtp(user, code);
        } catch (error) {
          user.otpChallengeId = null;
          user.otpHash = null;
          user.otpExpiresAt = null;
          user.otpAttempts = 0;
          user.otpSentAt = null;
          await user.save();
          throw error;
        }
      }
      setOtpCookie(res, user._id, challengeId);
      return res.json({ requiresOtp: true, message: 'A sign-in code was sent to your mobile number.' });
    } catch (error) {
      console.error('Account login failed:', error.message);
      return res.status(503).json({ error: 'Could not send a sign-in code right now. Please try again.' });
    }
  }

  async otpStatus(req, res) {
    const challenge = otpSession(req);
    if (!challenge?.sub || !challenge.challengeId) return res.json({ pending: false });
    try {
      const user = await User.findById(challenge.sub);
      const valid = user && user.otpChallengeId === challenge.challengeId && user.otpExpiresAt?.getTime() > Date.now() && user.otpAttempts < MAX_OTP_ATTEMPTS;
      if (!valid) {
        clearOtpCookie(res);
        return res.json({ pending: false });
      }
      return res.json({ pending: true, phoneHint: `${user.phoneNumber.slice(0, 3)}••••${user.phoneNumber.slice(-2)}` });
    } catch {
      return res.status(503).json({ error: 'Account service is temporarily unavailable.' });
    }
  }

  async verifyOtp(req, res) {
    const challenge = otpSession(req);
    const code = String(req.body?.code || '').trim();
    if (!challenge?.sub || !challenge.challengeId) return res.status(401).json({ error: 'Your sign-in code expired. Sign in again.' });
    if (!/^\d{6}$/.test(code)) return res.status(400).json({ error: 'Enter the 6-digit code sent to your mobile.' });
    try {
      const user = await User.findById(challenge.sub).select('+otpHash +profile.avatarData +profile.avatarMimeType');
      if (!user || user.otpChallengeId !== challenge.challengeId || !user.otpExpiresAt || user.otpExpiresAt.getTime() <= Date.now()) {
        clearOtpCookie(res);
        return res.status(401).json({ error: 'Your sign-in code expired. Sign in again.' });
      }
      if (user.otpAttempts >= MAX_OTP_ATTEMPTS) {
        clearOtpCookie(res);
        return res.status(429).json({ error: 'Too many incorrect codes. Sign in again to request a new code.' });
      }
      if (!(await verifyPassword(code, user.otpHash))) {
        user.otpAttempts += 1;
        if (user.otpAttempts >= MAX_OTP_ATTEMPTS) {
          user.otpChallengeId = null;
          user.otpHash = null;
          user.otpExpiresAt = null;
          user.otpSentAt = null;
        }
        await user.save();
        return res.status(401).json({ error: 'Wrong OTP. Please try again.' });
      }
      user.otpChallengeId = null;
      user.otpHash = null;
      user.otpExpiresAt = null;
      user.otpAttempts = 0;
      user.otpSentAt = null;
      user.initialOtpVerifiedAt = user.initialOtpVerifiedAt || new Date();
      await user.save();
      setCookies(res, [
        { name: COOKIE_NAME, value: makeSignedToken({ sub: String(user._id), exp: Date.now() + SESSION_AGE_MS }), maxAge: SESSION_AGE_MS / 1000 },
        { name: OTP_COOKIE_NAME, value: '', maxAge: 0 },
      ]);
      const publicUser = toPublicUser(user);
      return res.json({ user: publicUser, requiresProfileCompletion: !publicUser.profileComplete });
    } catch (error) {
      console.error('OTP verification failed:', error.message);
      return res.status(503).json({ error: 'Could not verify your code right now. Please try again.' });
    }
  }

  async resendOtp(req, res) {
    const challenge = otpSession(req);
    if (!challenge?.sub || !challenge.challengeId) return res.status(401).json({ error: 'Sign in again to request a new code.' });
    try {
      const user = await User.findById(challenge.sub).select('+otpHash');
      if (!user || user.otpChallengeId !== challenge.challengeId || !user.otpExpiresAt || user.otpExpiresAt.getTime() <= Date.now()) {
        clearOtpCookie(res);
        return res.status(401).json({ error: 'Your sign-in code expired. Sign in again.' });
      }
      if (user.otpSentAt && Date.now() - user.otpSentAt.getTime() < OTP_RESEND_WAIT_MS) {
        return res.status(429).json({ error: 'Please wait 30 seconds before requesting another code.' });
      }
      const code = generateOtp();
      await sendOtp(user, code);
      user.otpHash = await hashPassword(code);
      user.otpExpiresAt = new Date(Date.now() + OTP_AGE_MS);
      user.otpAttempts = 0;
      user.otpSentAt = new Date();
      await user.save();
      setOtpCookie(res, user._id, challenge.challengeId);
      return res.json({ message: 'A new sign-in code was sent to your mobile number.' });
    } catch (error) {
      console.error('OTP resend failed:', error.message);
      return res.status(503).json({ error: 'Could not send a new code right now. Please try again.' });
    }
  }

  async requestCode(req, res) {
    if (mongoose.connection.readyState !== 1) return res.status(503).json({ error: 'Account database is unavailable. Please try again shortly.' });
    const phoneNumber = normalizePhone(req.body?.mobile);
    if (!phoneNumber) return res.status(400).json({ error: 'Enter a valid mobile number.' });
    try {
      const user = await User.findOne({ phoneNumber });
      if (user && user.accountStatus !== 'suspended') {
        const temporaryPassword = generateTemporaryPassword();
        const passwordHash = await hashPassword(temporaryPassword);
        await telnyxService.sendSMS(phoneNumber, `Your Niti sign-in password is: ${temporaryPassword}\nIt expires in 24 hours.`);
        user.passwordHash = passwordHash;
        user.mustChangePassword = true;
        user.credentialsExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
        user.credentialsSmsStatus = 'sent';
        user.credentialsSentAt = new Date();
        user.otpChallengeId = null;
        user.otpHash = null;
        user.otpExpiresAt = null;
        user.otpAttempts = 0;
        user.otpSentAt = null;
        await user.save();
      }
      return res.json({ message: 'If this number belongs to a Niti account, a sign-in code has been sent.' });
    } catch (error) {
      console.error('Credential SMS request failed:', error.message);
      return res.status(503).json({ error: 'Could not send a new sign-in code. Check the number and try again later.' });
    }
  }

  async completeProfile(req, res) {
    const userId = sessionUserId(req);
    if (!userId) return res.status(401).json({ error: 'Sign in again to finish your profile.' });
    const name = String(req.body?.name || '').trim();
    const age = Number(req.body?.age);
    const allowedGenders = ['woman', 'man', 'nonbinary', 'self_describe', 'prefer_not_to_say'];
    const gender = req.body?.gender || null;
    if (!name || name.length > 100 || !Number.isInteger(age) || age < 0 || age > 125) {
      return res.status(400).json({ error: 'Enter your name and a valid age between 0 and 125.' });
    }
    if (gender && !allowedGenders.includes(gender)) return res.status(400).json({ error: 'Choose a valid gender option.' });
    try {
      const user = await User.findById(userId).select('+profile.avatarData +profile.avatarMimeType');
      if (!user || user.accountStatus === 'suspended') return res.status(401).json({ error: 'Sign in again to finish your profile.' });
      if (user.mustChangePassword) return res.status(403).json({ error: 'Change your temporary password before finishing your profile.' });
      user.profile = { ...user.profile.toObject(), name, ageAtRegistration: age, gender };
      user.profileCompletedAt = new Date();
      user.accountStatus = 'active';
      await user.save();
      return res.json({ user: toPublicUser(user) });
    } catch (error) {
      console.error('Profile completion failed:', error.message);
      return res.status(503).json({ error: 'Could not save your profile right now. Please try again.' });
    }
  }

  async changePassword(req, res) {
    const userId = sessionUserId(req);
    if (!userId) return res.status(401).json({ error: 'Sign in again to change your password.' });
    const password = String(req.body?.password || '');
    const confirmPassword = String(req.body?.confirmPassword || '');
    if (password.length < 8 || password.length > 128) {
      return res.status(400).json({ error: 'Choose a password between 8 and 128 characters.' });
    }
    if (password !== confirmPassword) return res.status(400).json({ error: 'The passwords do not match.' });
    try {
      const user = await User.findById(userId).select('+passwordHash +profile.avatarData +profile.avatarMimeType');
      if (!user || user.accountStatus === 'suspended') return res.status(401).json({ error: 'Sign in again to change your password.' });
      if (await verifyPassword(password, user.passwordHash)) return res.status(400).json({ error: 'Choose a password different from your temporary password.' });
      user.passwordHash = await hashPassword(password);
      user.mustChangePassword = false;
      await user.save();
      const publicUser = toPublicUser(user);
      return res.json({ user: publicUser, requiresProfileCompletion: !publicUser.profileComplete });
    } catch (error) {
      console.error('Password change failed:', error.message);
      return res.status(503).json({ error: 'Could not update your password right now. Please try again.' });
    }
  }

  async updateProfilePicture(req, res) {
    const userId = sessionUserId(req);
    if (!userId) return res.status(401).json({ error: 'Sign in to update your profile picture.' });
    const dataUrl = String(req.body?.dataUrl || '');
    const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
    if (!match) return res.status(400).json({ error: 'Choose a JPG, PNG, or WebP image.' });
    const imageBuffer = Buffer.from(match[2], 'base64');
    if (!imageBuffer.length || imageBuffer.length > 512 * 1024) {
      return res.status(413).json({ error: 'The resized image must be 512 KB or smaller.' });
    }
    try {
      const user = await User.findById(userId).select('+profile.avatarData +profile.avatarMimeType');
      if (!user || user.accountStatus !== 'active' || user.mustChangePassword) {
        return res.status(403).json({ error: 'Complete account setup before updating your profile picture.' });
      }
      user.profile.avatarData = match[2];
      user.profile.avatarMimeType = match[1];
      await user.save();
      return res.json({ profilePicture: `data:${match[1]};base64,${match[2]}` });
    } catch (error) {
      console.error('Profile picture update failed:', error.message);
      return res.status(503).json({ error: 'Could not save your profile picture right now.' });
    }
  }

  logout(req, res) {
    setCookies(res, [
      { name: COOKIE_NAME, value: '', maxAge: 0 },
      { name: OTP_COOKIE_NAME, value: '', maxAge: 0 },
    ]);
    return res.json({ success: true });
  }
}

module.exports = Object.assign(new AuthController(), { sessionUserId });
