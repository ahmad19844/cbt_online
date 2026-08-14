# CBT Exam Portal

A complete online Computer-Based Test (CBT) system: admins create subjects, build
a question bank, and configure timed exams; students register, take exams with a
live countdown timer, and get instant auto-graded results with an answer review.

**Stack:** Node.js, Express, EJS (server-rendered, no build step), PostgreSQL.

## Features

- **Admin panel:** manage subjects, add/edit/delete multiple-choice questions,
  create timed exams (pick subject, duration, number of questions, pass mark),
  activate/deactivate exams, view every student's results and answer-by-answer review.
- **Student portal:** register/login, see available exams, take a timed exam
  (answers autosave as you click, auto-submits when time runs out), see instant
  scored results with correct-answer review, view result history.
- **Password management:** "Forgot password" email flow (with a working
  no-setup fallback that shows the reset link on-screen if you haven't
  configured SMTP yet), plus a "Change Password" option for logged-in users.
- **Random question selection:** each exam attempt pulls N random questions from
  the subject's question pool, so no two attempts are guaranteed identical.
- **Sessions stored in Postgres** so logins survive app restarts/redeploys.

## Project Structure

```
cbt-exam-app/
├── server.js              # App entry point
├── config/db.js           # Postgres connection pool
├── schema.sql             # Database schema
├── migrate.js             # Runs schema.sql
├── seed.js                # Creates the default admin account
├── middleware/auth.js     # Session-based auth guards
├── routes/
│   ├── auth.js             # Login / register / logout
│   ├── admin.js             # Admin CRUD + results
│   └── student.js           # Exam taking + grading
├── views/                  # EJS templates
└── public/                 # CSS + client-side JS (timer, autosave)
```

## 1. Local Setup (optional, to test before deploying)

Requirements: Node.js 18+, a PostgreSQL database (local or free cloud instance).

```bash
cd cbt-exam-app
npm install
cp .env.example .env
# edit .env and set DATABASE_URL to your local/cloud Postgres connection string
npm run migrate    # creates all tables
npm run seed        # creates the default admin account
npm start
```

Visit `http://localhost:3000`. Log in with the admin credentials printed by
`npm run seed` (defaults to `admin@example.com` / `Admin@12345` unless you changed
the `DEFAULT_ADMIN_*` values in `.env`).

## 2. Deploy to Render.com

You have two options: the one-click Blueprint (fastest) or manual setup.

### Option A — Blueprint (`render.yaml`), recommended

This repo includes a `render.yaml` that provisions both the web service and a
free PostgreSQL database automatically.

1. Push this project to a GitHub (or GitLab) repository.
2. In the Render dashboard, click **New +** → **Blueprint**.
3. Connect the repository. Render will detect `render.yaml` and show you the
   `cbt-exam-app` web service and `cbt-exam-db` database it's about to create.
4. Before clicking **Apply**, open the env var list and change
   `DEFAULT_ADMIN_EMAIL` / `DEFAULT_ADMIN_PASSWORD` to your own values
   (or leave them and change the password after your first login).
5. Click **Apply**. Render will provision the database, run
   `npm install && npm run migrate && npm run seed` as the build step, then
   start the app with `npm start`.
6. Once the deploy finishes, open the service URL Render gives you
   (e.g. `https://cbt-exam-app.onrender.com`) and log in with your admin
   credentials.

### Option B — Manual setup

1. **Create the database:** Render dashboard → **New +** → **PostgreSQL**.
   Choose the free plan, give it a name (e.g. `cbt-exam-db`), and create it.
   Once it's ready, copy the **Internal Database URL** shown on its page.
2. **Create the web service:** Render dashboard → **New +** → **Web Service**.
   Connect your GitHub repo containing this project.
   - **Runtime:** Node
   - **Build Command:** `npm install && npm run migrate && npm run seed`
   - **Start Command:** `npm start`
   - **Plan:** Free (or any paid plan for always-on hosting)
3. **Add environment variables** on the web service's Environment tab:
   - `DATABASE_URL` = the Internal Database URL you copied
   - `DB_SSL` = `true`
   - `NODE_ENV` = `production`
   - `SESSION_SECRET` = any long random string (Render can generate one for you)
   - `DEFAULT_ADMIN_NAME`, `DEFAULT_ADMIN_EMAIL`, `DEFAULT_ADMIN_PASSWORD` = your admin login
4. Click **Create Web Service**. Render will build and deploy automatically.
5. Visit the generated URL and log in as admin.

### After deploying

- **Change the default admin password** immediately after your first login
  (there's no in-app change-password screen yet — see "Next Steps" below —
  so for now update `DEFAULT_ADMIN_PASSWORD` and re-run `npm run seed` locally
  pointed at your production `DATABASE_URL`, or update it directly via SQL in
  the Render Postgres shell).
- Go to **Subjects** and add at least one subject.
- Go to **Questions** and add multiple-choice questions to that subject
  (you need at least as many questions as any exam's "number of questions" setting).
- Go to **Exams** and create a timed exam pointing at that subject.
- Share the site URL with students so they can register and take it.

### Notes on the free Render plan

- Free web services spin down after periods of inactivity and take a few
  seconds to wake up on the next request — fine for testing, but for a live
  exam with real students, use a paid plan so the app (and the in-progress
  exam timer) doesn't get interrupted.
- Free Postgres databases on Render expire after 30 days unless upgraded.

## How grading works

Each exam attempt snapshots a random set of question IDs into
`attempt_questions` when the student clicks "Start Exam." As the student
selects answers, each choice is saved immediately via a background request
(so a lost connection doesn't lose progress). On submit — or automatically
when the timer hits zero — the server compares each selected option to the
question's `correct_option` and stores the final score.

## Password reset / forgot password

The login page has a "Forgot your password?" link that walks a user through:

1. Enter their email at `/forgot-password`.
2. A single-use, 1-hour-expiring token is generated and stored in the
   `password_resets` table.
3. If SMTP is configured (see env vars below), an email is sent with a link
   to `/reset-password/:token`. **If SMTP is not configured, the reset link
   is shown directly on the confirmation page instead** — so the whole flow
   is testable immediately after deploying, with no mail setup required.
4. The user sets a new password on that page, and the token is marked used.

Logged-in users can also change their password anytime via **Change Password**
in the top navbar (`/account/change-password`), which just requires their
current password — no email involved.

### Enabling real reset emails

Set these environment variables (in `.env` locally, or in the Render
dashboard / `render.yaml` for production) to any SMTP provider — a Gmail app
password, SendGrid, Mailgun, Resend, Amazon SES, etc. all work:

```
SMTP_HOST=smtp.yourprovider.com
SMTP_PORT=587
SMTP_USER=your_smtp_username
SMTP_PASS=your_smtp_password
SMTP_FROM=noreply@yourdomain.com
```

Once all four of `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` are
set, the app automatically switches from "show the link on-screen" to
"actually send the email" — no code changes needed.

## Next steps / ideas to extend this

- Add CSV import for bulk question upload.
- Add per-exam attempt limits (currently a student can retake an active exam
  as many times as they like once each attempt is submitted).
- Add negative marking or weighted question scoring.
- Export results to CSV/PDF from the admin results page.
