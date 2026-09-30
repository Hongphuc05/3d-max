const User = require('../models/Users');

exports.loginSuccess = (req, res) => {
  if (!req.user) return res.redirect('/');
  res.send(`<h2>Hello, ${req.user.displayName}</h2><a href="/logout">Logout</a>`);
};

exports.logout = (req, res) => {
  req.logout(() => res.redirect('/'));
};
