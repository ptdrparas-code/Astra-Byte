const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const multer = require('multer');
const { controller } = require('../controllers/mail.controller');
const authController = require('../controllers/auth.controller');

const router = express.Router();
const attachmentDirectory = path.resolve(process.cwd(), 'storage', 'mail-attachments');
fs.mkdirSync(attachmentDirectory, { recursive: true });
const upload = multer({
  storage: multer.diskStorage({
    destination: attachmentDirectory,
    filename: (_req, _file, callback) => callback(null, crypto.randomUUID()),
  }),
  limits: { fileSize: 20 * 1024 * 1024, files: 1 },
});

function requireSession(req, res, next) {
  if (!authController.sessionUserId(req)) return res.status(401).json({ error: 'Sign in to use Niti Mail.' });
  return next();
}

function withAttachment(req, res, next) {
  upload.single('attachment')(req, res, (error) => {
    if (!error) return next();
    const status = error.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    return res.status(status).json({ error: status === 413 ? 'Attachments must be 20 MB or smaller.' : 'Could not read the attachment.' });
  });
}

router.get('/messages', (req, res) => controller.list(req, res));
router.post('/drafts', requireSession, withAttachment, (req, res) => controller.saveDraft(req, res));
router.post('/messages', requireSession, withAttachment, (req, res) => controller.send(req, res));
router.get('/messages/:id/contact-picture', (req, res) => controller.contactPicture(req, res));
router.get('/messages/:id/attachment', (req, res) => controller.attachment(req, res));
router.patch('/messages/:id', (req, res) => controller.update(req, res));

module.exports = router;
