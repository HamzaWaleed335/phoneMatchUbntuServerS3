// src/controllers/authController.js
import bcrypt from 'bcrypt';
import passport from 'passport';
import { Strategy as LocalStrategy } from 'passport-local';
import { withConn } from '../config/db.js';

passport.use(new LocalStrategy({ usernameField: 'email' }, async (email, password, done) => {
  try {
    const user = await withConn(async (conn) => {
      const [rows] = await conn.query('SELECT * FROM users WHERE email = :email', { email });
      return rows[0];
    });
    if (!user) return done(null, false, { message: 'Invalid credentials' });
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return done(null, false, { message: 'Invalid credentials' });
    return done(null, { id: user.id, email: user.email, role: user.role });
  } catch (e) { done(e); }
}));

passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser(async (id, done) => {
  try {
    const user = await withConn(async (conn) => {
      const [rows] = await conn.query('SELECT id, email, role FROM users WHERE id = :id', { id });
      return rows[0];
    });
    done(null, user);
  } catch (e) { done(e); }
});

export const showLogin = (req, res) => res.render('auth/login', { message: req.flash('error') });
export const login = [
  passport.authenticate('local', { failureRedirect: '/login', failureFlash: true }),
  (req, res) => {
    if (req.user.role === 'admin') res.redirect('/admin');
    else res.redirect('/client');
  }
];

export const showRegister = (req, res) => res.render('auth/register', { message: req.flash('error') });
export const register = async (req, res) => {
  const { email, password, role } = req.body;
  const timeless_access = 0;
  if (!['admin', 'client'].includes(role)) return res.status(400).send('Bad role');
  const hash = await bcrypt.hash(password, 12);
  try {
    await withConn(async (conn) => {
      await conn.query('INSERT INTO users (email, password_hash, role, timeless_access) VALUES (:email, :hash, :role, :timeless_access)', { email, hash, role, timeless_access });
    });
    req.flash('info', 'Registered, please log in');
    res.redirect('/login');
  } catch (e) {
    console.log(e);
    req.flash('error', 'Email already exists');
    res.redirect('/register');
  }
};

export const logout = (req, res, next) => {
  req.logout(err => {
    if (err) return next(err);
    res.redirect('/login');
  });
};
