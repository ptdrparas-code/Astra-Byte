const mongoose = require('mongoose');

const profileSchema = new mongoose.Schema({
  name: { type: String, trim: true, maxlength: 100, default: null },
  ageAtRegistration: { type: Number, min: 0, max: 125, default: null },
  dateOfBirth: { type: Date, default: null },
  avatarData: { type: String, default: null, select: false },
  avatarMimeType: { type: String, enum: ['image/jpeg', 'image/png', 'image/webp', null], default: null, select: false },
  gender: {
    type: String,
    enum: ['woman', 'man', 'nonbinary', 'self_describe', 'prefer_not_to_say', null],
    default: null,
  },
}, { _id: false });

const userSchema = new mongoose.Schema({
  phoneNumber: {
    type: String,
    required: true,
    unique: true,
    immutable: true,
  },
  emailAddress: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
  },
  passwordHash: { type: String, required: true, select: false },
  otpChallengeId: { type: String, default: null },
  otpHash: { type: String, default: null, select: false },
  otpExpiresAt: { type: Date, default: null },
  otpAttempts: { type: Number, default: 0 },
  otpSentAt: { type: Date, default: null },
  initialOtpVerifiedAt: { type: Date, default: null },
  mustChangePassword: { type: Boolean, default: true },
  credentialsExpiresAt: { type: Date, required: true },
  credentialsSmsStatus: {
    type: String,
    enum: ['pending', 'sent', 'failed'],
    default: 'pending',
  },
  credentialsSentAt: { type: Date, default: null },
  accountStatus: {
    type: String,
    enum: ['profile_pending', 'active', 'suspended'],
    default: 'profile_pending',
    index: true,
  },
  profile: { type: profileSchema, default: () => ({}) },
  profileCompletedAt: { type: Date, default: null },
}, { timestamps: true });

module.exports = mongoose.models.User || mongoose.model('User', userSchema);
