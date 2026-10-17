const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');
const { authenticate } = require('../middleware/auth');
const router = express.Router();

router.post('/login', async (req, res, next) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' });
    const [rows] = await db.execute(
      'SELECT id, name, email, password_hash, role, outlet_id, is_active FROM users WHERE email = ? LIMIT 1',
      [email]
    );
    if (!rows.length || !rows[0].is_active || !(await bcrypt.compare(password, rows[0].password_hash))) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }
    if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
      return res.status(500).json({ error: 'Server JWT_SECRET must be set to a random value of at least 32 characters.' });
    }
    const user = rows[0];
    const token = jwt.sign({ sub: String(user.id), role: user.role }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '8h' });
    res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role, outlet_id: user.outlet_id } });
  } catch (err) { next(err); }
});

router.get('/me', authenticate, (req, res) => res.json({ user: req.user }));
module.exports = router;
