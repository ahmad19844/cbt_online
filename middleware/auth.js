function requireAuth(req, res, next) {
  if (!req.session.user) {
    req.session.returnTo = req.originalUrl;
    return res.redirect('/login');
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.user) {
    req.session.returnTo = req.originalUrl;
    return res.redirect('/login');
  }
  if (req.session.user.role !== 'admin') {
    return res.status(403).render('error', {
      title: 'Access Denied',
      message: 'You must be an administrator to view this page.'
    });
  }
  next();
}

function requireStudent(req, res, next) {
  if (!req.session.user) {
    req.session.returnTo = req.originalUrl;
    return res.redirect('/login');
  }
  if (req.session.user.role !== 'student') {
    return res.status(403).render('error', {
      title: 'Access Denied',
      message: 'This page is only available to students.'
    });
  }
  next();
}

// Makes current user + flash-style messages available to every view
function injectLocals(req, res, next) {
  res.locals.currentUser = req.session.user || null;
  res.locals.successMsg = req.session.successMsg || null;
  res.locals.errorMsg = req.session.errorMsg || null;
  delete req.session.successMsg;
  delete req.session.errorMsg;
  next();
}

module.exports = { requireAuth, requireAdmin, requireStudent, injectLocals };
