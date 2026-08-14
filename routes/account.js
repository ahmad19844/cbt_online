const express = require('express');
const bcrypt = require('bcryptjs');
const { body, validationResult } = require('express-validator');
const pool = require('../config/db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.get('/change-password', (req, res) => {
  res.render('account/change-password', { title: 'Change Password', errors: [] });
});

router.post(
  '/change-password',
  [
    body('currentPassword').notEmpty().withMessage('Enter your current password'),
    body('newPassword').isLength({ min: 6 }).withMessage('New password must be at least 6 characters'),
    body('confirmPassword').custom((value, { req }) => {
      if (value !== req.body.newPassword) {
        throw new Error('New passwords do not match');
      }
      return true;
    })
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.render('account/change-password', { title: 'Change Password', errors: errors.array() });
    }

    try {
      const result = await pool.query('SELECT * FROM users WHERE id = $1', [req.session.user.id]);
      const user = result.rows[0];

      const match = await bcrypt.compare(req.body.currentPassword, user.password_hash);
      if (!match) {
        return res.render('account/change-password', {
          title: 'Change Password',
          errors: [{ msg: 'Current password is incorrect' }]
        });
      }

      const hash = await bcrypt.hash(req.body.newPassword, 10);
      await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, user.id]);

      req.session.successMsg = 'Password changed successfully.';
      res.redirect(req.session.user.role === 'admin' ? '/admin/dashboard' : '/student/dashboard');
    } catch (err) {
      console.error(err);
      res.render('account/change-password', {
        title: 'Change Password',
        errors: [{ msg: 'Something went wrong. Try again.' }]
      });
    }
  }
);

module.exports = router;
