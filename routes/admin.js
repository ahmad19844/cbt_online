const express = require('express');
const { body, validationResult } = require('express-validator');
const pool = require('../config/db');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();
router.use(requireAdmin);

// ---------- DASHBOARD ----------
router.get('/dashboard', async (req, res) => {
  try {
    const [subjects, questions, exams, students, attempts] = await Promise.all([
      pool.query('SELECT COUNT(*) FROM subjects'),
      pool.query('SELECT COUNT(*) FROM questions'),
      pool.query('SELECT COUNT(*) FROM exams'),
      pool.query("SELECT COUNT(*) FROM users WHERE role = 'student'"),
      pool.query("SELECT COUNT(*) FROM exam_attempts WHERE status = 'submitted'")
    ]);

    const recentAttempts = await pool.query(`
      SELECT ea.id, ea.score, ea.total_questions, ea.submitted_at,
             u.name AS student_name, e.title AS exam_title
      FROM exam_attempts ea
      JOIN users u ON u.id = ea.user_id
      JOIN exams e ON e.id = ea.exam_id
      WHERE ea.status = 'submitted'
      ORDER BY ea.submitted_at DESC
      LIMIT 10
    `);

    res.render('admin/dashboard', {
      title: 'Admin Dashboard',
      stats: {
        subjects: subjects.rows[0].count,
        questions: questions.rows[0].count,
        exams: exams.rows[0].count,
        students: students.rows[0].count,
        attempts: attempts.rows[0].count
      },
      recentAttempts: recentAttempts.rows
    });
  } catch (err) {
    console.error(err);
    res.status(500).render('error', { title: 'Error', message: 'Could not load dashboard.' });
  }
});

// ---------- SUBJECTS ----------
router.get('/subjects', async (req, res) => {
  const result = await pool.query(`
    SELECT s.*, COUNT(q.id) AS question_count
    FROM subjects s
    LEFT JOIN questions q ON q.subject_id = s.id
    GROUP BY s.id ORDER BY s.name ASC
  `);
  res.render('admin/subjects', { title: 'Subjects', subjects: result.rows, errors: [], oldName: '', oldDescription: '' });
});

router.post(
  '/subjects',
  [body('name').trim().isLength({ min: 2 }).withMessage('Subject name must be at least 2 characters')],
  async (req, res) => {
    const errors = validationResult(req);
    const { name, description } = req.body;
    if (!errors.isEmpty()) {
      const result = await pool.query(`
        SELECT s.*, COUNT(q.id) AS question_count FROM subjects s
        LEFT JOIN questions q ON q.subject_id = s.id GROUP BY s.id ORDER BY s.name ASC
      `);
      return res.render('admin/subjects', {
        title: 'Subjects',
        subjects: result.rows,
        errors: errors.array(),
        oldName: name,
        oldDescription: description
      });
    }
    try {
      await pool.query('INSERT INTO subjects (name, description) VALUES ($1, $2)', [name.trim(), description || '']);
      req.session.successMsg = 'Subject added successfully.';
      res.redirect('/admin/subjects');
    } catch (err) {
      req.session.errorMsg = err.code === '23505' ? 'A subject with that name already exists.' : 'Could not add subject.';
      res.redirect('/admin/subjects');
    }
  }
);

router.post('/subjects/:id/delete', async (req, res) => {
  try {
    await pool.query('DELETE FROM subjects WHERE id = $1', [req.params.id]);
    req.session.successMsg = 'Subject deleted.';
  } catch (err) {
    req.session.errorMsg = 'Could not delete subject (it may have linked exams).';
  }
  res.redirect('/admin/subjects');
});

// ---------- QUESTIONS ----------
router.get('/questions', async (req, res) => {
  const subjectFilter = req.query.subject_id || '';
  const subjects = await pool.query('SELECT * FROM subjects ORDER BY name ASC');

  let query = `
    SELECT q.*, s.name AS subject_name FROM questions q
    JOIN subjects s ON s.id = q.subject_id
  `;
  const params = [];
  if (subjectFilter) {
    query += ' WHERE q.subject_id = $1';
    params.push(subjectFilter);
  }
  query += ' ORDER BY q.created_at DESC';

  const questions = await pool.query(query, params);

  res.render('admin/questions', {
    title: 'Questions',
    subjects: subjects.rows,
    questions: questions.rows,
    subjectFilter,
    errors: [],
    old: {}
  });
});

router.get('/questions/new', async (req, res) => {
  const subjects = await pool.query('SELECT * FROM subjects ORDER BY name ASC');
  if (subjects.rows.length === 0) {
    req.session.errorMsg = 'Create a subject first before adding questions.';
    return res.redirect('/admin/subjects');
  }
  res.render('admin/question-form', { title: 'Add Question', subjects: subjects.rows, errors: [], old: {}, question: null });
});

const questionValidators = [
  body('subject_id').notEmpty().withMessage('Select a subject'),
  body('question_text').trim().isLength({ min: 3 }).withMessage('Question text is required'),
  body('option_a').trim().notEmpty().withMessage('Option A is required'),
  body('option_b').trim().notEmpty().withMessage('Option B is required'),
  body('option_c').trim().notEmpty().withMessage('Option C is required'),
  body('option_d').trim().notEmpty().withMessage('Option D is required'),
  body('correct_option').isIn(['A', 'B', 'C', 'D']).withMessage('Select the correct option')
];

router.post('/questions', questionValidators, async (req, res) => {
  const errors = validationResult(req);
  const { subject_id, question_text, option_a, option_b, option_c, option_d, correct_option } = req.body;

  if (!errors.isEmpty()) {
    const subjects = await pool.query('SELECT * FROM subjects ORDER BY name ASC');
    return res.render('admin/question-form', {
      title: 'Add Question',
      subjects: subjects.rows,
      errors: errors.array(),
      old: req.body,
      question: null
    });
  }

  try {
    await pool.query(
      `INSERT INTO questions (subject_id, question_text, option_a, option_b, option_c, option_d, correct_option)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [subject_id, question_text.trim(), option_a.trim(), option_b.trim(), option_c.trim(), option_d.trim(), correct_option]
    );
    req.session.successMsg = 'Question added successfully.';
    res.redirect('/admin/questions');
  } catch (err) {
    console.error(err);
    req.session.errorMsg = 'Could not add question.';
    res.redirect('/admin/questions/new');
  }
});

router.get('/questions/:id/edit', async (req, res) => {
  const [subjects, question] = await Promise.all([
    pool.query('SELECT * FROM subjects ORDER BY name ASC'),
    pool.query('SELECT * FROM questions WHERE id = $1', [req.params.id])
  ]);
  if (question.rows.length === 0) {
    req.session.errorMsg = 'Question not found.';
    return res.redirect('/admin/questions');
  }
  res.render('admin/question-form', {
    title: 'Edit Question',
    subjects: subjects.rows,
    errors: [],
    old: {},
    question: question.rows[0]
  });
});

router.post('/questions/:id/edit', questionValidators, async (req, res) => {
  const errors = validationResult(req);
  const { subject_id, question_text, option_a, option_b, option_c, option_d, correct_option } = req.body;

  if (!errors.isEmpty()) {
    const subjects = await pool.query('SELECT * FROM subjects ORDER BY name ASC');
    return res.render('admin/question-form', {
      title: 'Edit Question',
      subjects: subjects.rows,
      errors: errors.array(),
      old: {},
      question: { id: req.params.id, ...req.body }
    });
  }

  try {
    await pool.query(
      `UPDATE questions SET subject_id=$1, question_text=$2, option_a=$3, option_b=$4,
       option_c=$5, option_d=$6, correct_option=$7 WHERE id=$8`,
      [subject_id, question_text.trim(), option_a.trim(), option_b.trim(), option_c.trim(), option_d.trim(), correct_option, req.params.id]
    );
    req.session.successMsg = 'Question updated successfully.';
    res.redirect('/admin/questions');
  } catch (err) {
    console.error(err);
    req.session.errorMsg = 'Could not update question.';
    res.redirect(`/admin/questions/${req.params.id}/edit`);
  }
});

router.post('/questions/:id/delete', async (req, res) => {
  try {
    await pool.query('DELETE FROM questions WHERE id = $1', [req.params.id]);
    req.session.successMsg = 'Question deleted.';
  } catch (err) {
    req.session.errorMsg = 'Could not delete question.';
  }
  res.redirect('/admin/questions');
});

// ---------- EXAMS ----------
router.get('/exams', async (req, res) => {
  const exams = await pool.query(`
    SELECT e.*, s.name AS subject_name,
      (SELECT COUNT(*) FROM questions q WHERE q.subject_id = e.subject_id) AS available_questions
    FROM exams e
    JOIN subjects s ON s.id = e.subject_id
    ORDER BY e.created_at DESC
  `);
  res.render('admin/exams', { title: 'Exams', exams: exams.rows });
});

router.get('/exams/new', async (req, res) => {
  const subjects = await pool.query(`
    SELECT s.*, COUNT(q.id) AS question_count FROM subjects s
    LEFT JOIN questions q ON q.subject_id = s.id GROUP BY s.id ORDER BY s.name ASC
  `);
  res.render('admin/exam-form', { title: 'Create Exam', subjects: subjects.rows, errors: [], old: {}, exam: null });
});

const examValidators = [
  body('title').trim().isLength({ min: 3 }).withMessage('Exam title is required'),
  body('subject_id').notEmpty().withMessage('Select a subject'),
  body('duration_minutes').isInt({ min: 1 }).withMessage('Duration must be a positive number of minutes'),
  body('num_questions').isInt({ min: 1 }).withMessage('Number of questions must be a positive number'),
  body('pass_mark_percent').isInt({ min: 0, max: 100 }).withMessage('Pass mark must be between 0 and 100')
];

router.post('/exams', examValidators, async (req, res) => {
  const errors = validationResult(req);
  const { title, subject_id, duration_minutes, num_questions, pass_mark_percent } = req.body;

  const subjects = await pool.query(`
    SELECT s.*, COUNT(q.id) AS question_count FROM subjects s
    LEFT JOIN questions q ON q.subject_id = s.id GROUP BY s.id ORDER BY s.name ASC
  `);

  if (!errors.isEmpty()) {
    return res.render('admin/exam-form', {
      title: 'Create Exam',
      subjects: subjects.rows,
      errors: errors.array(),
      old: req.body,
      exam: null
    });
  }

  const subjectQCount = await pool.query('SELECT COUNT(*) FROM questions WHERE subject_id = $1', [subject_id]);
  if (parseInt(subjectQCount.rows[0].count, 10) < parseInt(num_questions, 10)) {
    return res.render('admin/exam-form', {
      title: 'Create Exam',
      subjects: subjects.rows,
      errors: [{ msg: `Selected subject only has ${subjectQCount.rows[0].count} question(s). Reduce the number of questions or add more.` }],
      old: req.body,
      exam: null
    });
  }

  try {
    await pool.query(
      `INSERT INTO exams (title, subject_id, duration_minutes, num_questions, pass_mark_percent, created_by)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [title.trim(), subject_id, duration_minutes, num_questions, pass_mark_percent, req.session.user.id]
    );
    req.session.successMsg = 'Exam created successfully.';
    res.redirect('/admin/exams');
  } catch (err) {
    console.error(err);
    req.session.errorMsg = 'Could not create exam.';
    res.redirect('/admin/exams/new');
  }
});

router.post('/exams/:id/toggle', async (req, res) => {
  try {
    await pool.query('UPDATE exams SET is_active = NOT is_active WHERE id = $1', [req.params.id]);
  } catch (err) {
    req.session.errorMsg = 'Could not update exam.';
  }
  res.redirect('/admin/exams');
});

router.post('/exams/:id/delete', async (req, res) => {
  try {
    await pool.query('DELETE FROM exams WHERE id = $1', [req.params.id]);
    req.session.successMsg = 'Exam deleted.';
  } catch (err) {
    req.session.errorMsg = 'Could not delete exam.';
  }
  res.redirect('/admin/exams');
});

// ---------- RESULTS ----------
router.get('/results', async (req, res) => {
  const examFilter = req.query.exam_id || '';
  const exams = await pool.query('SELECT id, title FROM exams ORDER BY title ASC');

  let query = `
    SELECT ea.id, ea.score, ea.total_questions, ea.status, ea.started_at, ea.submitted_at,
           u.name AS student_name, u.email AS student_email, e.title AS exam_title, e.pass_mark_percent
    FROM exam_attempts ea
    JOIN users u ON u.id = ea.user_id
    JOIN exams e ON e.id = ea.exam_id
  `;
  const params = [];
  if (examFilter) {
    query += ' WHERE ea.exam_id = $1';
    params.push(examFilter);
  }
  query += ' ORDER BY ea.started_at DESC';

  const attempts = await pool.query(query, params);
  res.render('admin/results', { title: 'Results', exams: exams.rows, attempts: attempts.rows, examFilter });
});

router.get('/results/:attemptId', async (req, res) => {
  const attempt = await pool.query(`
    SELECT ea.*, u.name AS student_name, u.email AS student_email, e.title AS exam_title, e.pass_mark_percent
    FROM exam_attempts ea
    JOIN users u ON u.id = ea.user_id
    JOIN exams e ON e.id = ea.exam_id
    WHERE ea.id = $1
  `, [req.params.attemptId]);

  if (attempt.rows.length === 0) {
    req.session.errorMsg = 'Result not found.';
    return res.redirect('/admin/results');
  }

  const answers = await pool.query(`
    SELECT aq.*, q.question_text, q.option_a, q.option_b, q.option_c, q.option_d, q.correct_option
    FROM attempt_questions aq
    JOIN questions q ON q.id = aq.question_id
    WHERE aq.attempt_id = $1
    ORDER BY aq.order_index ASC
  `, [req.params.attemptId]);

  res.render('admin/result-detail', {
    title: 'Result Detail',
    attempt: attempt.rows[0],
    answers: answers.rows
  });
});

module.exports = router;
