require('dotenv').config();
const express = require('express');
const path = require('path');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const db = require('./db');

const app = express();
app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({
  origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',').map(x => x.trim()) : true
}));
app.use(express.json({ limit: '100kb' }));
app.use('/api/auth/login', rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false }));

app.get('/api/health', async (req, res) => {
  try { await db.query('SELECT 1'); res.json({ status: 'ok', database: 'connected' }); }
  catch (_) { res.status(503).json({ status: 'error', database: 'unavailable' }); }
});
app.use('/api/auth', require('./routes/auth'));
app.use('/api', require('./routes/public'));
app.use('/api', require('./routes/admin'));
app.use('/api/kitchen', require('./routes/kitchen'));
app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));

app.use((err, req, res, next) => {
  if (err && err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'A record with that unique value already exists.' });
  console.error(err);
  res.status(500).json({ error: 'An unexpected server error occurred.' });
});

const port = Number(process.env.PORT || 3000);
app.listen(port, () => console.log(`Kiosk Replacer running at http://localhost:${port}`));
