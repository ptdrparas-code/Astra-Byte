const express = require('express');
const authController = require('../controllers/auth.controller');

const router = express.Router();

router.get('/me', (req, res) => authController.me(req, res));
router.get('/users/search', (req, res) => authController.searchUsers(req, res));
router.get('/otp-status', (req, res) => authController.otpStatus(req, res));
router.get('/reset-status', (req, res) => authController.resetStatus(req, res));
router.post('/login', (req, res) => authController.login(req, res));
router.post('/verify-otp', (req, res) => authController.verifyOtp(req, res));
router.post('/resend-otp', (req, res) => authController.resendOtp(req, res));
router.post('/change-password', (req, res) => authController.changePassword(req, res));
router.patch('/profile-picture', (req, res) => authController.updateProfilePicture(req, res));
router.patch('/profile-name', (req, res) => authController.updateProfileName(req, res));
router.post('/request-code', (req, res) => authController.requestCode(req, res));
router.post('/request-password-reset', (req, res) => authController.requestPasswordReset(req, res));
router.post('/complete-profile', (req, res) => authController.completeProfile(req, res));
router.post('/logout', (req, res) => authController.logout(req, res));

module.exports = router;
