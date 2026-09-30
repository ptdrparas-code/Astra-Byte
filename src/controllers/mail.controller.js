const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const User = require('../models/user.model');
const MailMessage = require('../models/mail-message.model');
const authController = require('./auth.controller');

const attachmentDirectory = path.resolve(process.cwd(), 'storage', 'mail-attachments');
fs.mkdirSync(attachmentDirectory, { recursive: true });

function activeSession(req, res) {
  const userId = authController.sessionUserId(req);
  if (!userId || !mongoose.isValidObjectId(userId)) {
    res.status(401).json({ error: 'Sign in to use Niti Mail.' });
    return null;
  }
  return userId;
}

async function activeUser(userId) {
  const user = await User.findById(userId).select('accountStatus mustChangePassword emailAddress phoneNumber profile.name');
  return user && user.accountStatus === 'active' && !user.mustChangePassword ? user : null;
}

function stateQuery(userId, state) {
  return [
    { sender: userId, [`senderState.${state}`]: true },
    { recipient: userId, [`recipientState.${state}`]: true },
  ];
}

function folderQuery(userId, folder) {
  switch (folder) {
    case 'inbox':
      return { recipient: userId, 'recipientState.archived': false, 'recipientState.trashed': false, 'recipientState.deleted': { $ne: true } };
    case 'sent':
      return { sender: userId, isDraft: { $ne: true }, 'senderState.archived': false, 'senderState.trashed': false, 'senderState.deleted': { $ne: true } };
    case 'drafts':
      return { sender: userId, isDraft: true, 'senderState.trashed': false, 'senderState.deleted': { $ne: true } };
    case 'starred':
      return { $or: [
        { sender: userId, isDraft: { $ne: true }, 'senderState.starred': true, 'senderState.trashed': { $ne: true }, 'senderState.deleted': { $ne: true } },
        { recipient: userId, isDraft: { $ne: true }, 'recipientState.starred': true, 'recipientState.trashed': { $ne: true }, 'recipientState.deleted': { $ne: true } },
      ] };
    case 'archive':
      return { $or: [
        { sender: userId, isDraft: { $ne: true }, 'senderState.archived': true, 'senderState.trashed': { $ne: true }, 'senderState.deleted': { $ne: true } },
        { recipient: userId, isDraft: { $ne: true }, 'recipientState.archived': true, 'recipientState.trashed': { $ne: true }, 'recipientState.deleted': { $ne: true } },
      ] };
    case 'trash':
      return { $or: [
        { sender: userId, 'senderState.trashed': true, 'senderState.deleted': { $ne: true } },
        { recipient: userId, 'recipientState.trashed': true, 'recipientState.deleted': { $ne: true } },
      ] };
    default:
      return null;
  }
}

function publicMessage(message, viewerId) {
  const viewerIsSender = String(message.sender?._id || message.sender) === String(viewerId);
  const state = viewerIsSender ? message.senderState : message.recipientState;
  const sender = message.sender && typeof message.sender === 'object' ? message.sender : {};
  const recipient = message.recipient && typeof message.recipient === 'object' ? message.recipient : {};
  const contact = viewerIsSender ? recipient : sender;
  const isDraft = Boolean(message.isDraft);
  return {
    id: String(message._id),
    from: sender.emailAddress || '',
    fromName: sender.profile?.name || 'Niti member',
    to: recipient.emailAddress || message.draftTo || '',
    draftTo: message.draftTo || '',
    toName: recipient.profile?.name || message.draftTo || 'Niti member',
    direction: isDraft ? 'draft' : viewerIsSender ? 'sent' : 'received',
    isDraft,
    contactPictureUrl: contact.profile?.avatarMimeType ? `/api/mail/messages/${message._id}/contact-picture?viewer=${viewerId}` : null,
    subject: message.subject || '',
    body: message.body || '',
    snippet: String(message.body || '').replace(/\s+/g, ' ').slice(0, 140),
    createdAt: message.createdAt,
    read: Boolean(state?.read),
    starred: Boolean(state?.starred),
    archived: Boolean(state?.archived),
    trashed: Boolean(state?.trashed),
    hasAttachment: Boolean(message.attachment),
    attachmentName: message.attachment?.originalName || '',
    attachmentUrl: message.attachment ? `/api/mail/messages/${message._id}/attachment` : null,
  };
}

class MailController {
  async list(req, res) {
    const userId = activeSession(req, res);
    if (!userId) return;
    const folder = String(req.query.folder || 'inbox').toLowerCase();
    if (!['inbox', 'sent', 'drafts', 'starred', 'archive', 'trash'].includes(folder)) {
      return res.json({ messages: [] });
    }
    try {
      const user = await activeUser(userId);
      if (!user) return res.status(403).json({ error: 'Complete your Niti account setup before opening mail.' });
      const query = folderQuery(userId, folder);
      const results = await MailMessage.find(query)
        .populate({ path: 'sender', select: 'emailAddress profile.name +profile.avatarMimeType' })
        .populate({ path: 'recipient', select: 'emailAddress profile.name +profile.avatarMimeType' })
        .sort({ createdAt: -1 })
        .limit(100)
        .lean();
      return res.json({ messages: results.map((message) => publicMessage(message, userId)) });
    } catch (error) {
      console.error('Mailbox load failed:', error.message);
      return res.status(503).json({ error: 'Could not load your messages right now.' });
    }
  }

  async saveDraft(req, res) {
    const userId = activeSession(req, res);
    if (!userId) return;
    const to = String(req.body?.to || '').trim().toLowerCase();
    const subject = String(req.body?.subject || '').trim();
    const body = String(req.body?.body || '').trim();
    const draftId = String(req.body?.draftId || '').trim();
    const removeUploadedFile = () => {
      if (req.file?.path) fs.promises.unlink(req.file.path).catch(() => {});
    };
    if (subject.length > 200 || body.length > 100000 || to.length > 254) {
      removeUploadedFile();
      return res.status(400).json({ error: 'Subject or message is too long.' });
    }
    if (!draftId && !to && !subject && !body && !req.file) {
      return res.status(400).json({ error: 'Add a recipient, subject, message, or attachment before saving a draft.' });
    }
    try {
      const sender = await activeUser(userId);
      if (!sender) {
        removeUploadedFile();
        return res.status(403).json({ error: 'Complete your Niti account setup before saving drafts.' });
      }
      let draft = null;
      if (draftId) {
        if (!mongoose.isValidObjectId(draftId)) {
          removeUploadedFile();
          return res.status(404).json({ error: 'Draft not found.' });
        }
        draft = await MailMessage.findOne({ _id: draftId, sender: userId, isDraft: true });
        if (!draft) {
          removeUploadedFile();
          return res.status(404).json({ error: 'Draft not found.' });
        }
      }
      let recipientId = null;
      if (/^[^\s@]+@niti\.com$/i.test(to)) {
        const recipient = await User.findOne({ emailAddress: to, accountStatus: 'active' }).select('_id');
        recipientId = recipient?._id || null;
      }
      const oldAttachment = draft?.attachment;
      const attachment = req.file ? {
        storageName: path.basename(req.file.filename),
        originalName: path.basename(req.file.originalname.replace(/\\/g, '/')).slice(0, 255),
        contentType: req.file.mimetype || 'application/octet-stream',
        size: req.file.size,
      } : req.body?.keepAttachment === 'true' ? oldAttachment || null : null;
      if (!draft) draft = new MailMessage({ sender: userId, isDraft: true, senderState: { read: true } });
      draft.recipient = recipientId;
      draft.draftTo = to;
      draft.subject = subject;
      draft.body = body;
      draft.attachment = attachment;
      draft.isDraft = true;
      await draft.save();
      if (req.file && oldAttachment?.storageName) {
        const oldPath = path.join(attachmentDirectory, oldAttachment.storageName);
        fs.promises.unlink(oldPath).catch(() => {});
      }
      return res.status(201).json({ success: true, draftId: String(draft._id) });
    } catch (error) {
      removeUploadedFile();
      console.error('Draft save failed:', error.message);
      return res.status(503).json({ error: 'Could not save your draft right now.' });
    }
  }

  async send(req, res) {
    const userId = activeSession(req, res);
    if (!userId) return;
    const subject = String(req.body?.subject || '').trim();
    const body = String(req.body?.body || '').trim();
    const to = String(req.body?.to || '').trim().toLowerCase();
    const draftId = String(req.body?.draftId || '').trim();
    const removeUploadedFile = () => {
      if (req.file?.path) fs.promises.unlink(req.file.path).catch(() => {});
    };
    if (subject.length > 200 || body.length > 100000) {
      removeUploadedFile();
      return res.status(400).json({ error: 'Subject or message is too long.' });
    }
    if (!body && !req.file && !draftId) {
      return res.status(400).json({ error: 'Write a message or attach a file before sending.' });
    }
    if (!to || to.length > 254) {
      removeUploadedFile();
      return res.status(400).json({ error: 'Choose a Niti member to receive this message.' });
    }
    try {
      const sender = await activeUser(userId);
      if (!sender) {
        removeUploadedFile();
        return res.status(403).json({ error: 'Complete your Niti account setup before sending mail.' });
      }
      let draft = null;
      if (draftId) {
        if (!mongoose.isValidObjectId(draftId)) {
          removeUploadedFile();
          return res.status(404).json({ error: 'Draft not found.' });
        }
        draft = await MailMessage.findOne({ _id: draftId, sender: userId, isDraft: true });
        if (!draft) {
          removeUploadedFile();
          return res.status(404).json({ error: 'Draft not found.' });
        }
      }
      if (!body && !req.file && !draft?.attachment) {
        removeUploadedFile();
        return res.status(400).json({ error: 'Write a message or add an attachment before sending.' });
      }
      // A member remains a valid recipient while resetting their password; they can read the message once signed in again.
      const recipient = await User.findOne({ emailAddress: to, accountStatus: 'active' }).select('_id');
      if (!recipient) {
        removeUploadedFile();
        return res.status(404).json({ error: 'That email address does not belong to an active Niti member.' });
      }
      if (String(recipient._id) === String(userId)) {
        removeUploadedFile();
        return res.status(400).json({ error: 'Choose another Niti member as the recipient.' });
      }
      const uploadedAttachment = req.file ? {
        storageName: path.basename(req.file.filename),
        originalName: path.basename(req.file.originalname.replace(/\\/g, '/')).slice(0, 255),
        contentType: req.file.mimetype || 'application/octet-stream',
        size: req.file.size,
      } : null;
      const oldAttachment = draft?.attachment;
      let message;
      if (draft) {
        draft.recipient = recipient._id;
        draft.draftTo = '';
        draft.subject = subject;
        draft.body = body;
        draft.isDraft = false;
        draft.senderState = { read: true };
        draft.recipientState = {};
        if (uploadedAttachment) draft.attachment = uploadedAttachment;
        await draft.save();
        message = draft;
        if (uploadedAttachment && oldAttachment?.storageName) {
          const oldPath = path.join(attachmentDirectory, oldAttachment.storageName);
          fs.promises.unlink(oldPath).catch(() => {});
        }
      } else {
        message = await MailMessage.create({
          sender: userId,
          recipient: recipient._id,
          subject,
          body,
          senderState: { read: true },
          attachment: uploadedAttachment,
        });
      }
      return res.status(201).json({ message: { id: String(message._id), to, subject: message.subject, createdAt: message.createdAt } });
    } catch (error) {
      removeUploadedFile();
      console.error('Message send failed:', error.message);
      return res.status(503).json({ error: 'Could not send your message right now.' });
    }
  }

  async update(req, res) {
    const userId = activeSession(req, res);
    if (!userId) return;
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: 'Message not found.' });
    const patch = req.body || {};
    const allowed = ['read', 'starred', 'archived', 'trashed', 'deleted'];
    const key = Object.keys(patch).find((candidate) => allowed.includes(candidate));
    if (!key || typeof patch[key] !== 'boolean') return res.status(400).json({ error: 'Choose a valid mailbox action.' });
    try {
      const message = await MailMessage.findOne({ _id: req.params.id, $or: [{ sender: userId }, { recipient: userId }] });
      if (!message) return res.status(404).json({ error: 'Message not found.' });
      const state = String(message.sender) === String(userId) ? message.senderState : message.recipientState;
      if (key === 'deleted' && patch.deleted !== true) {
        return res.status(400).json({ error: 'Permanently deleted messages cannot be recovered.' });
      }
      if (key === 'deleted' && patch.deleted && !state.trashed) {
        return res.status(400).json({ error: 'Move the message to Trash before deleting it permanently.' });
      }
      state[key] = patch[key];
      await message.save();
      if (key === 'deleted' && patch.deleted) {
        const senderDeleted = Boolean(message.senderState?.deleted);
        const recipientDeleted = !message.recipient || Boolean(message.recipientState?.deleted);
        if (senderDeleted && recipientDeleted) {
          const attachmentName = message.attachment?.storageName;
          await MailMessage.deleteOne({ _id: message._id });
          if (attachmentName && /^[\da-f-]{36}$/i.test(attachmentName)) {
            fs.promises.unlink(path.join(attachmentDirectory, attachmentName)).catch(() => {});
          }
        }
      }
      return res.json({ success: true, permanentlyDeleted: key === 'deleted' && patch.deleted });
    } catch (error) {
      console.error('Mailbox update failed:', error.message);
      return res.status(503).json({ error: 'Could not update this message right now.' });
    }
  }

  async contactPicture(req, res) {
    const userId = activeSession(req, res);
    if (!userId) return;
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: 'Profile picture not found.' });
    try {
      const viewer = await activeUser(userId);
      if (!viewer) return res.status(403).json({ error: 'Complete your account setup before opening mail.' });
      const message = await MailMessage.findOne({
        _id: req.params.id,
        $or: [{ sender: userId }, { recipient: userId }],
      }).select('sender recipient').lean();
      if (!message) return res.status(404).json({ error: 'Profile picture not found.' });
      const contactId = String(message.sender) === String(userId) ? message.recipient : message.sender;
      const contact = await User.findById(contactId).select('accountStatus +profile.avatarData +profile.avatarMimeType');
      const picture = contact?.profile;
      if (contact?.accountStatus !== 'active' || !picture?.avatarData || !picture.avatarMimeType) {
        return res.status(404).json({ error: 'Profile picture not found.' });
      }
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.type(picture.avatarMimeType);
      return res.send(Buffer.from(picture.avatarData, 'base64'));
    } catch (error) {
      console.error('Contact profile picture load failed:', error.message);
      return res.status(503).json({ error: 'Could not load this profile picture right now.' });
    }
  }

  async attachment(req, res) {
    const userId = activeSession(req, res);
    if (!userId) return;
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: 'Attachment not found.' });
    try {
      const message = await MailMessage.findOne({ _id: req.params.id, $or: [{ sender: userId }, { recipient: userId }] }).select('attachment');
      if (!message?.attachment || !/^[\da-f-]{36}$/i.test(message.attachment.storageName)) {
        return res.status(404).json({ error: 'Attachment not found.' });
      }
      const filePath = path.join(attachmentDirectory, message.attachment.storageName);
      if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'This attachment is no longer available.' });
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Type', message.attachment.contentType || 'application/octet-stream');
      return res.download(filePath, message.attachment.originalName);
    } catch (error) {
      console.error('Attachment download failed:', error.message);
      return res.status(503).json({ error: 'Could not download this attachment right now.' });
    }
  }
}

module.exports = { controller: new MailController() };
