const mongoose = require('mongoose');

const mailboxStateSchema = new mongoose.Schema({
  read: { type: Boolean, default: false },
  starred: { type: Boolean, default: false },
  archived: { type: Boolean, default: false },
  trashed: { type: Boolean, default: false },
}, { _id: false });

const attachmentSchema = new mongoose.Schema({
  storageName: { type: String, required: true },
  originalName: { type: String, required: true, maxlength: 255 },
  contentType: { type: String, required: true, maxlength: 150 },
  size: { type: Number, required: true, max: 20 * 1024 * 1024 },
}, { _id: false });

const mailMessageSchema = new mongoose.Schema({
  sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  recipient: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
  draftTo: { type: String, trim: true, maxlength: 254, default: '' },
  isDraft: { type: Boolean, default: false, index: true },
  subject: { type: String, trim: true, maxlength: 200, default: '' },
  body: { type: String, maxlength: 100000, default: '' },
  attachment: { type: attachmentSchema, default: null },
  senderState: { type: mailboxStateSchema, default: () => ({}) },
  recipientState: { type: mailboxStateSchema, default: () => ({}) },
}, { timestamps: true });

mailMessageSchema.index({ recipient: 1, createdAt: -1 });
mailMessageSchema.index({ sender: 1, createdAt: -1 });

module.exports = mongoose.models.MailMessage || mongoose.model('MailMessage', mailMessageSchema);
