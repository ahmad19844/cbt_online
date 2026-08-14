require('dotenv').config();
const express = require('express');
const path = require('path');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const expressLayouts = require('express-ejs-layouts');

const pool = require('./config/db');
const { injectLocals } = require('./middleware/auth');
const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const studentRoutes = require('./routes/student');
const accountRoutes = require('./routes/account');

const app = express();
const PORT = process.env.PORT || 3000;

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(expressLayouts);
app.set('layout', 'layout');

// Body parsing & static files
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Trust Render's proxy so secure cookies work correctly
app.set('trust proxy', 1);

// Sessions stored in Postgres so they survive restarts/deploys
app.use(
  session({
    store: new pgSession({
      pool,
      tableName: 'session',
      createTableIfMissing: true
    }),
    secret: process.env.SESSION_SECRET || 'insecure_dev_secret_change_me',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 1000 * 60 * 60 * 8 // 8 hours
    }
  })
);

app.use(injectLocals);

// Routes
app.use('/', authRoutes);
app.use('/admin', adminRoutes);
app.use('/student', studentRoutes);
app.use('/account', accountRoutes);

// Health check endpoint (useful for Render)
app.get('/healthz', (req, res) => res.status(200).send('ok'));

// 404
app.use((req, res) => {
  res.status(404).render('error', { title: 'Not Found', message: 'That page does not exist.' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).render('error', { title: 'Server Error', message: 'Something went wrong on our end.' });
});

app.listen(PORT, () => {
  console.log(`CBT exam app running on port ${PORT}`);
});
