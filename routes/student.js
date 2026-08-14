const express = require('express');
const pool = require('../config/db');
const { requireStudent } = require('../middleware/auth');

const router = express.Router();
router.use(requireStudent);

// ---------- DASHBOARD ----------
router.get('/dashboard', async (req, res) => {
  const userId = req.session.user.id;

  const exams = await pool.query(`
    SELECT e.*, s.name AS subject_name,
      (SELECT COUNT(*) FROM exam_attempts ea WHERE ea.exam_id = e.id AND ea.user_id = $1 AND ea.status = 'submitted') AS attempts_taken
    FROM exams e
    JOIN subjects s ON s.id = e.subject_id
    WHERE e.is_active = TRUE
    ORDER BY e.created_at DESC
  `, [userId]);

  const history = await pool.query(`
    SELECT ea.id, ea.score, ea.total_questions, ea.submitted_at, e.title AS exam_title, e.pass_mark_percent
    FROM exam_attempts ea
    JOIN exams e ON e.id = ea.exam_id
    WHERE ea.user_id = $1 AND ea.status = 'submitted'
    ORDER BY ea.submitted_at DESC
    LIMIT 10
  `, [userId]);

  // Resume an in-progress attempt if one exists
  const inProgress = await pool.query(`
    SELECT id FROM exam_attempts WHERE user_id = $1 AND status = 'in_progress' AND deadline_at > NOW()
    ORDER BY started_at DESC LIMIT 1
  `, [userId]);

  res.render('student/dashboard', {
    title: 'My Dashboard',
    exams: exams.rows,
    history: history.rows,
    inProgressAttemptId: inProgress.rows[0]?.id || null
  });
});

// ---------- START EXAM ----------
router.post('/exams/:examId/start', async (req, res) => {
  const userId = req.session.user.id;
  const examId = req.params.examId;

  try {
    // Prevent starting a new attempt if one is already in progress
    const existing = await pool.query(`
      SELECT id FROM exam_attempts WHERE user_id = $1 AND status = 'in_progress' AND deadline_at > NOW()
    `, [userId]);
    if (existing.rows.length > 0) {
      return res.redirect(`/student/attempts/${existing.rows[0].id}`);
    }

    const examResult = await pool.query('SELECT * FROM exams WHERE id = $1 AND is_active = TRUE', [examId]);
    if (examResult.rows.length === 0) {
      req.session.errorMsg = 'Exam not found or is not currently active.';
      return res.redirect('/student/dashboard');
    }
    const exam = examResult.rows[0];

    // Pick N random questions from the subject pool
    const questions = await pool.query(
      'SELECT id FROM questions WHERE subject_id = $1 ORDER BY RANDOM() LIMIT $2',
      [exam.subject_id, exam.num_questions]
    );

    if (questions.rows.length < exam.num_questions) {
      req.session.errorMsg = 'Not enough questions available for this exam yet. Contact your administrator.';
      return res.redirect('/student/dashboard');
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const attemptResult = await client.query(
        `INSERT INTO exam_attempts (exam_id, user_id, total_questions, status, deadline_at)
         VALUES ($1, $2, $3, 'in_progress', NOW() + ($4 || ' minutes')::interval)
         RETURNING id`,
        [examId, userId, questions.rows.length, exam.duration_minutes]
      );
      const attemptId = attemptResult.rows[0].id;

      let orderIndex = 0;
      for (const q of questions.rows) {
        orderIndex += 1;
        await client.query(
          'INSERT INTO attempt_questions (attempt_id, question_id, order_index) VALUES ($1, $2, $3)',
          [attemptId, q.id, orderIndex]
        );
      }

      await client.query('COMMIT');
      res.redirect(`/student/attempts/${attemptId}`);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error(err);
    req.session.errorMsg = 'Could not start exam. Please try again.';
    res.redirect('/student/dashboard');
  }
});

// ---------- TAKE EXAM ----------
router.get('/attempts/:attemptId', async (req, res) => {
  const userId = req.session.user.id;
  const attemptId = req.params.attemptId;

  const attemptResult = await pool.query(`
    SELECT ea.*, e.title AS exam_title FROM exam_attempts ea
    JOIN exams e ON e.id = ea.exam_id
    WHERE ea.id = $1 AND ea.user_id = $2
  `, [attemptId, userId]);

  if (attemptResult.rows.length === 0) {
    req.session.errorMsg = 'Exam attempt not found.';
    return res.redirect('/student/dashboard');
  }
  const attempt = attemptResult.rows[0];

  if (attempt.status === 'submitted') {
    return res.redirect(`/student/results/${attempt.id}`);
  }

  const secondsRemaining = Math.max(0, Math.floor((new Date(attempt.deadline_at) - new Date()) / 1000));
  if (secondsRemaining <= 0) {
    await autoGradeAndSubmit(attemptId);
    return res.redirect(`/student/results/${attempt.id}`);
  }

  const questions = await pool.query(`
    SELECT aq.id AS attempt_question_id, aq.order_index, aq.selected_option,
           q.question_text, q.option_a, q.option_b, q.option_c, q.option_d
    FROM attempt_questions aq
    JOIN questions q ON q.id = aq.question_id
    WHERE aq.attempt_id = $1
    ORDER BY aq.order_index ASC
  `, [attemptId]);

  res.render('student/exam', {
    title: attempt.exam_title,
    attempt,
    questions: questions.rows,
    secondsRemaining
  });
});

// Save a single answer (called via fetch as the student clicks options — keeps progress safe)
router.post('/attempts/:attemptId/answer', async (req, res) => {
  const userId = req.session.user.id;
  const { attemptQuestionId, selectedOption } = req.body;

  try {
    const attempt = await pool.query(
      "SELECT * FROM exam_attempts WHERE id = $1 AND user_id = $2 AND status = 'in_progress'",
      [req.params.attemptId, userId]
    );
    if (attempt.rows.length === 0) {
      return res.status(400).json({ ok: false, error: 'Attempt not active' });
    }
    if (new Date(attempt.rows[0].deadline_at) < new Date()) {
      return res.status(400).json({ ok: false, error: 'Time is up' });
    }
    if (!['A', 'B', 'C', 'D'].includes(selectedOption)) {
      return res.status(400).json({ ok: false, error: 'Invalid option' });
    }

    await pool.query(
      'UPDATE attempt_questions SET selected_option = $1 WHERE id = $2 AND attempt_id = $3',
      [selectedOption, attemptQuestionId, req.params.attemptId]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: 'Server error' });
  }
});

// ---------- SUBMIT EXAM ----------
router.post('/attempts/:attemptId/submit', async (req, res) => {
  const userId = req.session.user.id;
  const attemptId = req.params.attemptId;

  try {
    const attempt = await pool.query(
      "SELECT * FROM exam_attempts WHERE id = $1 AND user_id = $2 AND status = 'in_progress'",
      [attemptId, userId]
    );
    if (attempt.rows.length === 0) {
      return res.redirect(`/student/results/${attemptId}`);
    }

    await autoGradeAndSubmit(attemptId);
    res.redirect(`/student/results/${attemptId}`);
  } catch (err) {
    console.error(err);
    req.session.errorMsg = 'Could not submit exam.';
    res.redirect('/student/dashboard');
  }
});

// ---------- RESULTS ----------
router.get('/results/:attemptId', async (req, res) => {
  const userId = req.session.user.id;
  const attemptId = req.params.attemptId;

  const attemptResult = await pool.query(`
    SELECT ea.*, e.title AS exam_title, e.pass_mark_percent
    FROM exam_attempts ea
    JOIN exams e ON e.id = ea.exam_id
    WHERE ea.id = $1 AND ea.user_id = $2
  `, [attemptId, userId]);

  if (attemptResult.rows.length === 0) {
    req.session.errorMsg = 'Result not found.';
    return res.redirect('/student/dashboard');
  }
  const attempt = attemptResult.rows[0];

  if (attempt.status === 'in_progress') {
    return res.redirect(`/student/attempts/${attemptId}`);
  }

  const answers = await pool.query(`
    SELECT aq.*, q.question_text, q.option_a, q.option_b, q.option_c, q.option_d, q.correct_option
    FROM attempt_questions aq
    JOIN questions q ON q.id = aq.question_id
    WHERE aq.attempt_id = $1
    ORDER BY aq.order_index ASC
  `, [attemptId]);

  const percent = Math.round((attempt.score / attempt.total_questions) * 100);
  const passed = percent >= attempt.pass_mark_percent;

  res.render('student/result', { title: 'Exam Result', attempt, answers: answers.rows, percent, passed });
});

// Shared grading logic used by both manual submit and timeout auto-submit
async function autoGradeAndSubmit(attemptId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const answers = await client.query(`
      SELECT aq.id, aq.selected_option, q.correct_option
      FROM attempt_questions aq
      JOIN questions q ON q.id = aq.question_id
      WHERE aq.attempt_id = $1
    `, [attemptId]);

    let score = 0;
    for (const row of answers.rows) {
      const isCorrect = row.selected_option !== null && row.selected_option === row.correct_option;
      if (isCorrect) score += 1;
      await client.query('UPDATE attempt_questions SET is_correct = $1 WHERE id = $2', [isCorrect, row.id]);
    }

    await client.query(
      "UPDATE exam_attempts SET score = $1, status = 'submitted', submitted_at = NOW() WHERE id = $2",
      [score, attemptId]
    );

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = router;
