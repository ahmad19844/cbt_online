const nodemailer = require('nodemailer');

const smtpConfigured = Boolean(
  process.env.SMTP_HOST && process.env.SMTP_PORT && process.env.SMTP_USER && process.env.SMTP_PASS
);

let transporter = null;
if (smtpConfigured) {
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT, 10),
    secure: parseInt(process.env.SMTP_PORT, 10) === 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });
}

/**
 * Sends a password reset email.
 * If SMTP isn't configured, this is a no-op and the caller should fall back
 * to displaying the reset link directly (useful for local dev / first deploy).
 * Returns true if an email was actually sent, false otherwise.
 */
async function sendPasswordResetEmail(toEmail, resetUrl) {
  if (!transporter) return false;

  const fromAddress = process.env.SMTP_FROM || process.env.SMTP_USER;

  await transporter.sendMail({
    from: fromAddress,
    to: toEmail,
    subject: 'Reset your CBT Exam Portal password',
    text: `We received a request to reset your password.\n\nReset it here (valid for 1 hour):\n${resetUrl}\n\nIf you didn't request this, you can safely ignore this email.`,
    html: `
      <p>We received a request to reset your password.</p>
      <p><a href="${resetUrl}">Click here to reset your password</a> (valid for 1 hour).</p>
      <p>If you didn't request this, you can safely ignore this email.</p>
    `
  });

  return true;
}

module.exports = { sendPasswordResetEmail, smtpConfigured };
