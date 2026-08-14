const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { body, validationResult } = require('express-validator');
const pool = require('../config/db');
const { sendPasswordResetEmail, smtpConfigured } = require('../config/mailer');

const router = express.Router();

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

router.get('/', (req, res) => {
  if (req.session.user) {
    return res.redirect(req.session.user.role === 'admin' ? '/admin/dashboard' : '/student/dashboard');
  }
  res.redirect('/login');
});

// ---------- LOGIN ----------
router.get('/login', (req, res) => {
  if (req.session.user) {
    return res.redirect(req.session.user.role === 'admin' ? '/admin/dashboard' : '/student/dashboard');
  }
  res.render('login', { title: 'Login', errors: [], oldEmail: '' });
});

router.post(
  '/login',
  [
    body('email').isEmail().withMessage('Enter a valid email address'),
    body('password').notEmpty().withMessage('Password is required')
  ],
  async (req, res) => {
    const errors = validationResult(req);
    const { email, password } = req.body;

    if (!errors.isEmpty()) {
      return res.render('login', { title: 'Login', errors: errors.array(), oldEmail: email });
    }

    try {
      const result = await pool.query('SELECT * FROM users WHERE email = $1', [email.toLowerCase().trim()]);
      const user = result.rows[0];

      if (!user) {
        return res.render('login', {
          title: 'Login',
          errors: [{ msg: 'Invalid email or password' }],
          oldEmail: email
        });
      }

      const match = await bcrypt.compare(password, user.password_hash);
      if (!match) {
        return res.render('login', {
          title: 'Login',
          errors: [{ msg: 'Invalid email or password' }],
          oldEmail: email
        });
      }

      req.session.user = { id: user.id, name: user.name, email: user.email, role: user.role };
      const dest = req.session.returnTo || (user.role === 'admin' ? '/admin/dashboard' : '/student/dashboard');
      delete req.session.returnTo;
      res.redirect(dest);
    } catch (err) {
      console.error(err);
      res.render('login', { title: 'Login', errors: [{ msg: 'Something went wrong. Try again.' }], oldEmail: email });
    }
  }
);

// ---------- REGISTER (students only; admins are created via seed script) ----------
router.get('/register', (req, res) => {
  if (req.session.user) {
    return res.redirect(req.session.user.role === 'admin' ? '/admin/dashboard' : '/student/dashboard');
  }
  res.render('register', { title: 'Create Student Account', errors: [], oldName: '', oldEmail: '' });
});

router.post(
  '/register',
  [
    body('name').trim().isLength({ min: 2 }).withMessage('Name must be at least 2 characters'),
    body('email').isEmail().withMessage('Enter a valid email address'),
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
    body('confirmPassword').custom((value, { req }) => {
      if (value !== req.body.password) {
        throw new Error('Passwords do not match');
      }
      return true;
    })
  ],
  async (req, res) => {
    const errors = validationResult(req);
    const { name, email, password } = req.body;

    if (!errors.isEmpty()) {
      return res.render('register', {
        title: 'Create Student Account',
        errors: errors.array(),
        oldName: name,
        oldEmail: email
      });
    }

    try {
      const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase().trim()]);
      if (existing.rows.length > 0) {
        return res.render('register', {
          title: 'Create Student Account',
          errors: [{ msg: 'An account with that email already exists' }],
          oldName: name,
          oldEmail: email
        });
      }

      const hash = await bcrypt.hash(password, 10);
      const result = await pool.query(
        'INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id, name, email, role',
        [name.trim(), email.toLowerCase().trim(), hash, 'student']
      );
      const user = result.rows[0];
      req.session.user = { id: user.id, name: user.name, email: user.email, role: user.role };
      res.redirect('/student/dashboard');
    } catch (err) {
      console.error(err);
      res.render('register', {
        title: 'Create Student Account',
        errors: [{ msg: 'Something went wrong. Try again.' }],
        oldName: name,
        oldEmail: email
      });
    }
  }
);

// ---------- FORGOT PASSWORD ----------
router.get('/forgot-password', (req, res) => {
  if (req.session.user) {
    return res.redirect(req.session.user.role === 'admin' ? '/admin/dashboard' : '/student/dashboard');
  }
  res.render('forgot-password', { title: 'Forgot Password', errors: [], oldEmail: '', sent: false, resetUrl: null });
});

router.post(
  '/forgot-password',
  [body('email').isEmail().withMessage('Enter a valid email address')],
  async (req, res) => {
    const errors = validationResult(req);
    const { email } = req.body;

    if (!errors.isEmpty()) {
      return res.render('forgot-password', {
        title: 'Forgot Password',
        errors: errors.array(),
        oldEmail: email,
        sent: false,
        resetUrl: null
      });
    }

    // Always show the same success message whether or not the account exists,
    // so this endpoint can't be used to discover which emails are registered.
    const genericSuccessView = (resetUrl) =>
      res.render('forgot-password', {
        title: 'Forgot Password',
        errors: [],
        oldEmail: '',
        sent: true,
        resetUrl // only non-null in demo mode (no SMTP configured), shown so the flow is testable
      });

    try {
      const result = await pool.query('SELECT id, email FROM users WHERE email = $1', [email.toLowerCase().trim()]);
      const user = result.rows[0];

      if (!user) {
        return genericSuccessView(null);
      }

      const token = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);

      await pool.query(
        'INSERT INTO password_resets (user_id, token, expires_at) VALUES ($1, $2, $3)',
        [user.id, token, expiresAt]
      );

      const resetUrl = `${req.protocol}://${req.get('host')}/reset-password/${token}`;
      const emailSent = await sendPasswordResetEmail(user.email, resetUrl);

      // If SMTP isn't configured, surface the link directly instead of emailing it,
      // so the reset flow still works out of the box before mail is set up.
      genericSuccessView(emailSent ? null : resetUrl);
    } catch (err) {
      console.error(err);
      genericSuccessView(null);
    }
  }
);

// ---------- RESET PASSWORD ----------
router.get('/reset-password/:token', async (req, res) => {
  const { token } = req.params;

  const result = await pool.query(
    'SELECT * FROM password_resets WHERE token = $1 AND used = FALSE AND expires_at > NOW()',
    [token]
  );

  if (result.rows.length === 0) {
    return res.render('reset-password', {
      title: 'Reset Password',
      errors: [{ msg: 'This reset link is invalid or has expired. Request a new one below.' }],
      token: null
    });
  }

  res.render('reset-password', { title: 'Reset Password', errors: [], token });
});

router.post(
  '/reset-password/:token',
  [
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
    body('confirmPassword').custom((value, { req }) => {
      if (value !== req.body.password) {
        throw new Error('Passwords do not match');
      }
      return true;
    })
  ],
  async (req, res) => {
    const { token } = req.params;
    const errors = validationResult(req);

    if (!errors.isEmpty()) {
      return res.render('reset-password', { title: 'Reset Password', errors: errors.array(), token });
    }

    try {
      const result = await pool.query(
        'SELECT * FROM password_resets WHERE token = $1 AND used = FALSE AND expires_at > NOW()',
        [token]
      );
      const resetRecord = result.rows[0];

      if (!resetRecord) {
        return res.render('reset-password', {
          title: 'Reset Password',
          errors: [{ msg: 'This reset link is invalid or has expired. Request a new one.' }],
          token: null
        });
      }

      const hash = await bcrypt.hash(req.body.password, 10);

      await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, resetRecord.user_id]);
      await pool.query('UPDATE password_resets SET used = TRUE WHERE id = $1', [resetRecord.id]);
      // Invalidate any other outstanding reset links for this user
      await pool.query(
        'UPDATE password_resets SET used = TRUE WHERE user_id = $1 AND used = FALSE',
        [resetRecord.user_id]
      );

      req.session.successMsg = 'Password reset successfully. You can now log in with your new password.';
      res.redirect('/login');
    } catch (err) {
      console.error(err);
      res.render('reset-password', {
        title: 'Reset Password',
        errors: [{ msg: 'Something went wrong. Try again.' }],
        token
      });
    }
  }
);

// ---------- LOGOUT ----------
router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login');
  });
});

module.exports = router;
