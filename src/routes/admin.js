const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { authenticate, allowRoles } = require('../middleware/auth');
const router = express.Router();
router.use(authenticate, allowRoles('admin', 'sub_admin'));

function dateRange(query) {
  const from = query.from && /^\d{4}-\d{2}-\d{2}$/.test(query.from) ? query.from : '2000-01-01';
  const to = query.to && /^\d{4}-\d{2}-\d{2}$/.test(query.to) ? query.to : '2999-12-31';
  return [from, to];
}
function outletScope(user, requested) {
  if (user.role === 'admin') return requested ? Number(requested) : null;
  return user.outlet_id ? Number(user.outlet_id) : null;
}

router.get('/dashboard/summary', async (req, res, next) => {
  try {
    const [from, to] = dateRange(req.query);
    const outletId = outletScope(req.user, req.query.outletId);
    const clauses = ['DATE(o.created_at) BETWEEN ? AND ?'];
    const params = [from, to];
    if (outletId) { clauses.push('o.outlet_id = ?'); params.push(outletId); }
    else if (req.user.role !== 'admin') return res.status(403).json({ error: 'No outlet assigned to this account.' });
    const where = clauses.join(' AND ');
    const [rows] = await db.execute(
      `SELECT COUNT(*) AS totalOrders,
        COALESCE(SUM(o.total),0) AS totalSales,
        SUM(o.status IN ('pending','accepted','preparing')) AS activeOrders,
        SUM(o.status IN ('ready','completed')) AS completedOrders
       FROM orders o WHERE ${where}`, params);
    const [byStatus] = await db.execute(
      `SELECT o.status, COUNT(*) AS count FROM orders o WHERE ${where} GROUP BY o.status`, params);
    res.json({ from, to, summary: rows[0], byStatus });
  } catch (err) { next(err); }
});

router.get('/orders', async (req, res, next) => {
  try {
    const [from, to] = dateRange(req.query);
    const outletId = outletScope(req.user, req.query.outletId);
    if (req.user.role !== 'admin' && !outletId) return res.status(403).json({ error: 'No outlet assigned to this account.' });
    let sql = `SELECT o.id, o.order_number, o.status, o.payment_method, o.payment_status, o.subtotal, o.service_fee, o.total, o.created_at,
      c.name AS customer_name, c.phone AS customer_phone, outl.name AS outlet_name
      FROM orders o JOIN customers c ON c.id=o.customer_id JOIN outlets outl ON outl.id=o.outlet_id
      WHERE DATE(o.created_at) BETWEEN ? AND ?`;
    const params = [from, to];
    if (outletId) { sql += ' AND o.outlet_id = ?'; params.push(outletId); }
    if (req.query.status && ['pending','accepted','preparing','ready','completed','cancelled'].includes(req.query.status)) {
      sql += ' AND o.status = ?'; params.push(req.query.status);
    }
    sql += ' ORDER BY o.created_at DESC LIMIT 500';
    const [orders] = await db.execute(sql, params);
    for (const order of orders) {
      const [items] = await db.execute('SELECT item_name, unit_price, quantity, line_total FROM order_items WHERE order_id = ?', [order.id]);
      order.items = items;
    }
    res.json({ orders, from, to, limit: 500 });
  } catch (err) { next(err); }
});

router.get('/outlets', async (req, res, next) => {
  try {
    const [rows] = await db.execute('SELECT id, name, code, address, phone, is_active, created_at FROM outlets ORDER BY name');
    res.json({ outlets: rows });
  } catch (err) { next(err); }
});
router.post('/outlets', allowRoles('admin'), async (req, res, next) => {
  try {
    const { name, code, address = '', phone = '' } = req.body;
    if (!String(name || '').trim() || !String(code || '').trim()) return res.status(400).json({ error: 'Outlet name and code are required.' });
    const [r] = await db.execute('INSERT INTO outlets (name, code, address, phone) VALUES (?, ?, ?, ?)', [String(name).trim(), String(code).trim().toUpperCase(), String(address).trim(), String(phone).trim()]);
    res.status(201).json({ id: r.insertId, message: 'Outlet created.' });
  } catch (err) { next(err); }
});
router.put('/outlets/:id', allowRoles('admin'), async (req, res, next) => {
  try {
    const { name, code, address = '', phone = '', is_active = true } = req.body;
    if (!String(name || '').trim() || !String(code || '').trim()) return res.status(400).json({ error: 'Outlet name and code are required.' });
    const [r] = await db.execute('UPDATE outlets SET name=?, code=?, address=?, phone=?, is_active=? WHERE id=?', [String(name).trim(), String(code).trim().toUpperCase(), String(address).trim(), String(phone).trim(), Boolean(is_active), req.params.id]);
    if (!r.affectedRows) return res.status(404).json({ error: 'Outlet not found.' });
    res.json({ message: 'Outlet updated.' });
  } catch (err) { next(err); }
});
router.delete('/outlets/:id', allowRoles('admin'), async (req, res, next) => {
  try {
    const [r] = await db.execute('UPDATE outlets SET is_active=FALSE WHERE id=?', [req.params.id]);
    if (!r.affectedRows) return res.status(404).json({ error: 'Outlet not found.' });
    res.json({ message: 'Outlet deactivated.' });
  } catch (err) { next(err); }
});

router.get('/menu', async (req, res, next) => {
  try {
    let sql = `SELECT m.id,m.outlet_id,m.category_id,m.name,m.description,m.price,m.image_url,m.is_available,c.name AS category
      FROM menu_items m LEFT JOIN menu_categories c ON c.id=m.category_id`;
    const params = [];
    if (req.user.role !== 'admin') {
      if (!req.user.outlet_id) return res.status(403).json({ error: 'No outlet assigned.' });
      sql += ' WHERE m.outlet_id=?'; params.push(req.user.outlet_id);
    } else if (req.query.outletId) { sql += ' WHERE m.outlet_id=?'; params.push(Number(req.query.outletId)); }
    sql += ' ORDER BY m.outlet_id,c.name,m.name';
    const [items] = await db.execute(sql, params);
    res.json({ items });
  } catch (err) { next(err); }
});
router.post('/menu', async (req, res, next) => {
  try {
    const outletId = req.user.role === 'admin' ? Number(req.body.outlet_id) : Number(req.user.outlet_id);
    const name = String(req.body.name || '').trim();
    const price = Number(req.body.price);
    if (!outletId || !name || !Number.isFinite(price) || price < 0) return res.status(400).json({ error: 'Outlet, item name and valid price are required.' });
    const categoryName = String(req.body.category || '').trim();
    let categoryId = null;
    if (categoryName) {
      const [cats] = await db.execute('SELECT id FROM menu_categories WHERE outlet_id=? AND name=?', [outletId, categoryName]);
      if (cats.length) categoryId = cats[0].id;
      else { const [cat] = await db.execute('INSERT INTO menu_categories (outlet_id,name) VALUES (?,?)', [outletId, categoryName]); categoryId = cat.insertId; }
    }
    const [r] = await db.execute('INSERT INTO menu_items (outlet_id,category_id,name,description,price,image_url,is_available) VALUES (?,?,?,?,?,?,?)',
      [outletId, categoryId, name, String(req.body.description || ''), price, String(req.body.image_url || ''), req.body.is_available !== false]);
    res.status(201).json({ id: r.insertId, message: 'Menu item created.' });
  } catch (err) { next(err); }
});
router.put('/menu/:id', async (req, res, next) => {
  try {
    const [existing] = await db.execute('SELECT id,outlet_id FROM menu_items WHERE id=?', [req.params.id]);
    if (!existing.length) return res.status(404).json({ error: 'Menu item not found.' });
    if (req.user.role !== 'admin' && Number(existing[0].outlet_id) !== Number(req.user.outlet_id)) return res.status(403).json({ error: 'Access denied.' });
    const name = String(req.body.name || '').trim(), price = Number(req.body.price);
    if (!name || !Number.isFinite(price) || price < 0) return res.status(400).json({ error: 'Item name and valid price are required.' });
    const categoryName = String(req.body.category || '').trim();
    let categoryId = null;
    if (categoryName) {
      const [cats] = await db.execute('SELECT id FROM menu_categories WHERE outlet_id=? AND name=?', [existing[0].outlet_id, categoryName]);
      if (cats.length) categoryId = cats[0].id;
      else { const [cat] = await db.execute('INSERT INTO menu_categories (outlet_id,name) VALUES (?,?)', [existing[0].outlet_id, categoryName]); categoryId = cat.insertId; }
    }
    await db.execute('UPDATE menu_items SET category_id=?,name=?,description=?,price=?,image_url=?,is_available=? WHERE id=?',
      [categoryId, name, String(req.body.description || ''), price, String(req.body.image_url || ''), req.body.is_available !== false, req.params.id]);
    res.json({ message: 'Menu item updated.' });
  } catch (err) { next(err); }
});
router.delete('/menu/:id', async (req, res, next) => {
  try {
    const [existing] = await db.execute('SELECT outlet_id FROM menu_items WHERE id=?', [req.params.id]);
    if (!existing.length) return res.status(404).json({ error: 'Menu item not found.' });
    if (req.user.role !== 'admin' && Number(existing[0].outlet_id) !== Number(req.user.outlet_id)) return res.status(403).json({ error: 'Access denied.' });
    const [r] = await db.execute('UPDATE menu_items SET is_available=FALSE WHERE id=?', [req.params.id]);
    res.json({ message: 'Menu item deactivated.' });
  } catch (err) { next(err); }
});

router.get('/users', allowRoles('admin'), async (req, res, next) => {
  try {
    const [users] = await db.execute('SELECT id,name,email,role,outlet_id,is_active,created_at FROM users ORDER BY created_at DESC');
    res.json({ users });
  } catch (err) { next(err); }
});
router.post('/users', allowRoles('admin'), async (req, res, next) => {
  try {
    const name = String(req.body.name || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const role = ['admin','sub_admin','chef'].includes(req.body.role) ? req.body.role : 'sub_admin';
    const outletId = req.body.outlet_id ? Number(req.body.outlet_id) : null;
    if (name.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 10) return res.status(400).json({ error: 'Name, valid email and password of at least 10 characters are required.' });
    const hash = await bcrypt.hash(password, 12);
    const [r] = await db.execute('INSERT INTO users (name,email,password_hash,role,outlet_id) VALUES (?,?,?,?,?)', [name,email,hash,role,outletId]);
    res.status(201).json({ id: r.insertId, message: 'User created.' });
  } catch (err) { next(err); }
});
router.put('/users/:id', allowRoles('admin'), async (req, res, next) => {
  try {
    const role = ['admin','sub_admin','chef'].includes(req.body.role) ? req.body.role : 'sub_admin';
    const active = req.body.is_active !== false;
    const outletId = req.body.outlet_id ? Number(req.body.outlet_id) : null;
    if (Number(req.params.id) === Number(req.user.id) && !active) return res.status(400).json({ error: 'You cannot deactivate your own account.' });
    const [r] = await db.execute('UPDATE users SET role=?,outlet_id=?,is_active=? WHERE id=?', [role,outletId,active,req.params.id]);
    if (!r.affectedRows) return res.status(404).json({ error: 'User not found.' });
    res.json({ message: 'User updated.' });
  } catch (err) { next(err); }
});
router.delete('/users/:id', allowRoles('admin'), async (req, res, next) => {
  try {
    if (Number(req.params.id) === Number(req.user.id)) return res.status(400).json({ error: 'You cannot deactivate your own account.' });
    const [r] = await db.execute('UPDATE users SET is_active=FALSE WHERE id=?', [req.params.id]);
    if (!r.affectedRows) return res.status(404).json({ error: 'User not found.' });
    res.json({ message: 'User deactivated.' });
  } catch (err) { next(err); }
});
module.exports = router;
