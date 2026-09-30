const crypto = require('crypto');
const mongoose = require('mongoose');
const User = require('../models/user.model');
const telnyxService = require('../services/telnyx.service');
const { generateTemporaryPassword, hashPassword, verifyPassword } = require('../utils/credentials');

const COOKIE_NAME = 'niti_session';
const OTP_COOKIE_NAME = 'niti_otp';
const RESET_COOKIE_NAME = 'niti_password_reset';
const SESSION_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const OTP_AGE_MS = 5 * 60 * 1000;
const OTP_RESEND_WAIT_MS = 30 * 1000;
const MAX_OTP_ATTEMPTS = 5;
const sessionSecret = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

function normalizePhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length !== 10 || digits.startsWith('0')) return null;
  return `+91${digits}`;
}

function displayPhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : digits;
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

function setOtpCookie(res, userId, challengeId, purpose = 'signin') {
  setCookies(res, [
    { name: OTP_COOKIE_NAME, value: makeSignedToken({ sub: String(userId), challengeId, purpose, exp: Date.now() + OTP_AGE_MS }), maxAge: OTP_AGE_MS / 1000 },
    { name: COOKIE_NAME, value: '', maxAge: 0 },
    { name: RESET_COOKIE_NAME, value: '', maxAge: 0 },
  ]);
}

function setResetCookie(res, userId) {
  const age = 10 * 60 * 1000;
  setCookies(res, [
    { name: RESET_COOKIE_NAME, value: makeSignedToken({ sub: String(userId), exp: Date.now() + age }), maxAge: age / 1000 },
    { name: OTP_COOKIE_NAME, value: '', maxAge: 0 },
    { name: COOKIE_NAME, value: '', maxAge: 0 },
  ]);
}

function clearOtpCookie(res) {
  setCookies(res, [{ name: OTP_COOKIE_NAME, value: '', maxAge: 0 }]);
}

function clearSessionCookie(res) {
  setCookies(res, [{ name: COOKIE_NAME, value: '', maxAge: 0 }]);
}

function clearResetCookie(res) {
  setCookies(res, [{ name: RESET_COOKIE_NAME, value: '', maxAge: 0 }]);
}

function sessionUserId(req) {
  return readSignedToken(req, COOKIE_NAME)?.sub || null;
}

function otpSession(req) {
  return readSignedToken(req, OTP_COOKIE_NAME);
}

function resetSession(req) {
  return readSignedToken(req, RESET_COOKIE_NAME);
}

function generateOtp() {
  return String(crypto.randomInt(100000, 1000000));
}

async function sendOtp(user, code, purpose = 'signin') {
  const label = purpose === 'reset' ? 'password reset' : 'sign-in';
  await telnyxService.sendSMS(user.phoneNumber, `Your Niti ${label} code is ${code}. It expires in 5 minutes. Do not share this code.`);
}

function toPublicUser(user) {
  const profile = user.profile || {};
  const dateOfBirth = profile.dateOfBirth ? new Date(profile.dateOfBirth) : null;
  const birthDateString = dateOfBirth && !Number.isNaN(dateOfBirth.getTime()) ? dateOfBirth.toISOString().slice(0, 10) : null;
  const age = birthDateString ? calculateAge(birthDateString) : null;
  return {
    name: profile.name || '',
    nameChangeAvailableAt: profile.nameChangedAt
      ? new Date(new Date(profile.nameChangedAt).getTime() + 7 * 24 * 60 * 60 * 1000).toISOString()
      : null,
    email: user.emailAddress,
    phoneNumber: displayPhone(user.phoneNumber),
    profileComplete: user.accountStatus === 'active' && Boolean(user.profileCompletedAt),
    mustChangePassword: Boolean(user.mustChangePassword),
    age: age?.years ?? profile.ageAtRegistration,
    ageYears: age?.years ?? null,
    ageMonths: age?.months ?? null,
    dateOfBirth: birthDateString,
    gender: profile.gender,
    profilePicture: profile.avatarData && profile.avatarMimeType
      ? `data:${profile.avatarMimeType};base64,${profile.avatarData}`
      : null,
  };
}

function parseDateOfBirth(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.toISOString().slice(0, 10) === value ? date : null;
}

function calculateAge(value, today = new Date()) {
  const birthDate = parseDateOfBirth(value);
  if (!birthDate) return null;
  const year = birthDate.getUTCFullYear();
  const month = birthDate.getUTCMonth() + 1;
  const day = birthDate.getUTCDate();
  let years = today.getUTCFullYear() - year;
  let months = today.getUTCMonth() + 1 - month;
  if (today.getUTCDate() < day) months -= 1;
  if (months < 0) { years -= 1; months += 12; }
  if (years < 0 || years > 125) return null;
  return { years, months };
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
      const phonePrefix = digits.length <= 10
        ? `^\\+(?:91)?${digits}`
        : `^\\+${digits}`;
      const users = await User.find({
        _id: { $ne: userId },
        accountStatus: 'active',
        phoneNumber: { $regex: phonePrefix },
      }).select('phoneNumber emailAddress profile.name').sort({ 'profile.name': 1 }).lean();
      return res.json({ users: users.map((user) => ({
        name: user.profile?.name || 'Niti member',
        phoneNumber: displayPhone(user.phoneNumber),
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
    if ((!phoneNumber && !emailAddress) || !password) return res.status(400).json({ error: 'Enter your 10-digit mobile number or Niti email and password.' });
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
      setOtpCookie(res, user._id, challengeId, 'signin');
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
      return res.json({ pending: true, purpose: challenge.purpose || 'signin', phoneHint: `${user.phoneNumber.slice(0, 3)}••••${user.phoneNumber.slice(-2)}` });
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
      if (challenge.purpose === 'reset') {
        await user.save();
        setResetCookie(res, user._id);
        return res.json({ requiresPasswordReset: true });
      }
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
      await sendOtp(user, code, challenge.purpose || 'signin');
      user.otpHash = await hashPassword(code);
      user.otpExpiresAt = new Date(Date.now() + OTP_AGE_MS);
      user.otpAttempts = 0;
      user.otpSentAt = new Date();
      await user.save();
      setOtpCookie(res, user._id, challenge.challengeId, challenge.purpose || 'signin');
      return res.json({ message: challenge.purpose === 'reset' ? 'A new password reset code was sent to your mobile number.' : 'A new sign-in code was sent to your mobile number.' });
    } catch (error) {
      console.error('OTP resend failed:', error.message);
      return res.status(503).json({ error: 'Could not send a new code right now. Please try again.' });
    }
  }

  async requestCode(req, res) {
    if (mongoose.connection.readyState !== 1) return res.status(503).json({ error: 'Account database is unavailable. Please try again shortly.' });
    const phoneNumber = normalizePhone(req.body?.mobile);
    if (!phoneNumber) return res.status(400).json({ error: 'Enter a valid 10-digit mobile number.' });
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

  async requestPasswordReset(req, res) {
    if (mongoose.connection.readyState !== 1) return res.status(503).json({ error: 'Account database is unavailable. Please try again shortly.' });
    const phoneNumber = normalizePhone(req.body?.mobile);
    if (!phoneNumber) return res.status(400).json({ error: 'Enter your registered 10-digit mobile number.' });
    try {
      const user = await User.findOne({ phoneNumber }).select('+otpHash');
      const genericMessage = 'If this number belongs to a Niti account, a password reset code has been sent.';
      if (!user || user.accountStatus === 'suspended') return res.json({ message: genericMessage });
      if (user.otpSentAt && Date.now() - user.otpSentAt.getTime() < OTP_RESEND_WAIT_MS) {
        return res.status(429).json({ error: 'Please wait 30 seconds before requesting another code.' });
      }
      const code = generateOtp();
      const challengeId = crypto.randomBytes(16).toString('hex');
      user.otpChallengeId = challengeId;
      user.otpHash = await hashPassword(code);
      user.otpExpiresAt = new Date(Date.now() + OTP_AGE_MS);
      user.otpAttempts = 0;
      user.otpSentAt = new Date();
      await user.save();
      try {
        await telnyxService.sendSMS(user.phoneNumber, `Your Niti password reset code is ${code}. It expires in 5 minutes. Do not share this code.`);
      } catch (error) {
        user.otpChallengeId = null;
        user.otpHash = null;
        user.otpExpiresAt = null;
        user.otpAttempts = 0;
        user.otpSentAt = null;
        await user.save();
        throw error;
      }
      setOtpCookie(res, user._id, challengeId, 'reset');
      return res.json({ message: genericMessage });
    } catch (error) {
      console.error('Password reset code request failed:', error.message);
      return res.status(503).json({ error: 'Could not send a password reset code right now. Please try again.' });
    }
  }

  async resetStatus(req, res) {
    const reset = resetSession(req);
    if (!reset?.sub) return res.json({ pending: false });
    try {
      const user = await User.findById(reset.sub).select('accountStatus');
      if (!user || user.accountStatus === 'suspended') {
        clearResetCookie(res);
        return res.json({ pending: false });
      }
      return res.json({ pending: true });
    } catch {
      return res.status(503).json({ error: 'Account service is temporarily unavailable.' });
    }
  }

  async completeProfile(req, res) {
    const userId = sessionUserId(req);
    if (!userId) return res.status(401).json({ error: 'Sign in again to finish your profile.' });
    const name = String(req.body?.name || '').trim();
    const rawDateOfBirth = req.body?.dateOfBirth;
    const birthDate = parseDateOfBirth(rawDateOfBirth);
    const age = birthDate ? calculateAge(rawDateOfBirth) : null;
    const allowedGenders = ['woman', 'man', 'nonbinary', 'self_describe', 'prefer_not_to_say'];
    const gender = req.body?.gender || null;
    if (!name || name.length > 100 || !birthDate || !age) {
      return res.status(400).json({ error: 'Enter your name and a valid date of birth.' });
    }
    if (gender && !allowedGenders.includes(gender)) return res.status(400).json({ error: 'Choose a valid gender option.' });
    try {
      const user = await User.findById(userId).select('+profile.avatarData +profile.avatarMimeType');
      if (!user || user.accountStatus === 'suspended') return res.status(401).json({ error: 'Sign in again to finish your profile.' });
      if (user.mustChangePassword) return res.status(403).json({ error: 'Change your temporary password before finishing your profile.' });
      user.profile = { ...user.profile.toObject(), name, dateOfBirth: birthDate, ageAtRegistration: age.years, gender };
      user.profileCompletedAt = new Date();
      user.accountStatus = 'active';
      await user.save();
      return res.json({ user: toPublicUser(user) });
    } catch (error) {
      console.error('Profile completion failed:', error.message);
      return res.status(503).json({ error: 'Could not save your profile right now. Please try again.' });
    }
  }

  async updateProfileName(req, res) {
    const userId = sessionUserId(req);
    if (!userId) return res.status(401).json({ error: 'Sign in again to update your profile.' });
    const name = String(req.body?.name || '').trim();
    if (!name || name.length > 100) {
      return res.status(400).json({ error: 'Enter a name between 1 and 100 characters.' });
    }
    try {
      const user = await User.findById(userId);
      if (!user || user.accountStatus !== 'active' || user.mustChangePassword) {
        return res.status(403).json({ error: 'Complete your account setup before updating your name.' });
      }
      if ((user.profile?.name || '') === name) return res.json({ user: toPublicUser(user) });

      const now = new Date();
      const cooldownMs = 7 * 24 * 60 * 60 * 1000;
      const lastChangedAt = user.profile?.nameChangedAt ? new Date(user.profile.nameChangedAt) : null;
      const availableAt = lastChangedAt ? new Date(lastChangedAt.getTime() + cooldownMs) : null;
      if (availableAt && availableAt > now) {
        return res.status(429).json({
          error: `You can change your name again on ${availableAt.toISOString().slice(0, 10)}.`,
          nameChangeAvailableAt: availableAt.toISOString(),
        });
      }

      const updatedUser = await User.findOneAndUpdate({
        _id: userId,
        accountStatus: 'active',
        mustChangePassword: false,
        'profile.name': user.profile?.name || null,
        $or: [
          { 'profile.nameChangedAt': { $exists: false } },
          { 'profile.nameChangedAt': null },
          { 'profile.nameChangedAt': { $lte: new Date(now.getTime() - cooldownMs) } },
        ],
      }, {
        $set: { 'profile.name': name, 'profile.nameChangedAt': now },
      }, { returnDocument: 'after' }).select('+profile.avatarData +profile.avatarMimeType');
      if (updatedUser) return res.json({ user: toPublicUser(updatedUser) });

      const currentUser = await User.findById(userId).select('+profile.avatarData +profile.avatarMimeType');
      if (!currentUser || currentUser.accountStatus !== 'active' || currentUser.mustChangePassword) {
        return res.status(403).json({ error: 'Complete your account setup before updating your name.' });
      }
      if ((currentUser.profile?.name || '') === name) return res.json({ user: toPublicUser(currentUser) });
      const currentLastChangedAt = currentUser.profile?.nameChangedAt ? new Date(currentUser.profile.nameChangedAt) : null;
      const currentAvailableAt = currentLastChangedAt ? new Date(currentLastChangedAt.getTime() + cooldownMs) : null;
      if (currentAvailableAt && currentAvailableAt > new Date()) {
        return res.status(429).json({
          error: `You can change your name again on ${currentAvailableAt.toISOString().slice(0, 10)}.`,
          nameChangeAvailableAt: currentAvailableAt.toISOString(),
        });
      }
      return res.status(409).json({ error: 'Your profile changed. Reload it and try again.' });
    } catch (error) {
      console.error('Profile name update failed:', error.message);
      return res.status(503).json({ error: 'Could not save your name right now. Please try again.' });
    }
  }

  async changePassword(req, res) {
    const userId = sessionUserId(req);
    const reset = resetSession(req);
    const resetAuthorized = Boolean(!userId && reset?.sub);
    const authorizedUserId = userId || (resetAuthorized ? reset.sub : null);
    if (!authorizedUserId) return res.status(401).json({ error: 'Verify a password reset code before changing your password.' });
    const password = String(req.body?.password || '');
    const confirmPassword = String(req.body?.confirmPassword || '');
    if (password.length < 8 || password.length > 128) {
      return res.status(400).json({ error: 'Choose a password between 8 and 128 characters.' });
    }
    if (password !== confirmPassword) return res.status(400).json({ error: 'The passwords do not match.' });
    try {
      const user = await User.findById(authorizedUserId).select('+passwordHash +profile.avatarData +profile.avatarMimeType');
      if (!user || user.accountStatus === 'suspended') return res.status(401).json({ error: 'Sign in again to change your password.' });
      if (!resetAuthorized && await verifyPassword(password, user.passwordHash)) return res.status(400).json({ error: 'Choose a password different from your temporary password.' });
      user.passwordHash = await hashPassword(password);
      user.mustChangePassword = false;
      await user.save();
      if (resetAuthorized) {
        setCookies(res, [
          { name: COOKIE_NAME, value: makeSignedToken({ sub: String(user._id), exp: Date.now() + SESSION_AGE_MS }), maxAge: SESSION_AGE_MS / 1000 },
          { name: RESET_COOKIE_NAME, value: '', maxAge: 0 },
        ]);
      }
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
