// Creates a default admin account (if one doesn't already exist).
// Usage: npm run seed
require('dotenv').config();
const bcrypt = require('bcryptjs');
const pool = require('./config/db');

async function seed() {
  const name = process.env.DEFAULT_ADMIN_NAME || 'Super Admin';
  const email = process.env.DEFAULT_ADMIN_EMAIL || 'admin@example.com';
  const password = process.env.DEFAULT_ADMIN_PASSWORD || 'Admin@12345';

  try {
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      console.log(`Admin account already exists for ${email}. Skipping.`);
      return;
    }

    const hash = await bcrypt.hash(password, 10);
    await pool.query(
      'INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, $4)',
      [name, email, hash, 'admin']
    );
    console.log('Default admin account created:');
    console.log(`  Email:    ${email}`);
    console.log(`  Password: ${password}`);
    console.log('IMPORTANT: Log in and change this password, or set your own via env vars before seeding.');
  } catch (err) {
    console.error('Seed failed:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

seed();
