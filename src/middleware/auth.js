const jwt = require('jsonwebtoken');
const db = require('../db');

async function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return res.status(401).json({ error: 'Authentication required.' });
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const [rows] = await db.execute(
      'SELECT id, name, email, role, outlet_id, is_active FROM users WHERE id = ? LIMIT 1',
      [payload.sub]
    );
    if (!rows.length || !rows[0].is_active) return res.status(401).json({ error: 'Account unavailable.' });
    req.user = rows[0];
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token.' });
  }
}

function allowRoles(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'You do not have permission for this action.' });
    }
    next();
  };
}

module.exports = { authenticate, allowRoles };
