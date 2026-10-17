const express = require('express');
const db = require('../db');
const { authenticate, allowRoles } = require('../middleware/auth');
const router = express.Router();
router.use(authenticate, allowRoles('admin', 'sub_admin', 'chef'));

router.get('/orders', async (req, res, next) => {
  try {
    let sql = `SELECT o.id,o.order_number,o.status,o.total,o.created_at,c.name AS customer_name,c.phone AS customer_phone,outl.name AS outlet_name
      FROM orders o JOIN customers c ON c.id=o.customer_id JOIN outlets outl ON outl.id=o.outlet_id
      WHERE o.status IN ('pending','accepted','preparing','ready')`;
    const params = [];
    if (req.user.role !== 'admin') {
      if (!req.user.outlet_id) return res.status(403).json({ error: 'No outlet assigned.' });
      sql += ' AND o.outlet_id=?'; params.push(req.user.outlet_id);
    } else if (req.query.outletId) { sql += ' AND o.outlet_id=?'; params.push(Number(req.query.outletId)); }
    sql += ' ORDER BY o.created_at ASC LIMIT 250';
    const [orders] = await db.execute(sql, params);
    for (const order of orders) {
      const [items] = await db.execute('SELECT item_name,quantity FROM order_items WHERE order_id=?', [order.id]);
      order.items = items;
    }
    res.json({ orders });
  } catch (err) { next(err); }
});

router.patch('/orders/:id/status', async (req, res, next) => {
  const allowed = ['accepted','preparing','ready','completed','cancelled'];
  const newStatus = String(req.body.status || '').toLowerCase();
  if (!allowed.includes(newStatus)) return res.status(400).json({ error: 'Invalid status.' });
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    let sql = 'SELECT id,outlet_id,status FROM orders WHERE id=? FOR UPDATE';
    const params = [req.params.id];
    const [rows] = await conn.execute(sql, params);
    if (!rows.length) { await conn.rollback(); return res.status(404).json({ error: 'Order not found.' }); }
    const order = rows[0];
    if (req.user.role !== 'admin' && Number(order.outlet_id) !== Number(req.user.outlet_id)) {
      await conn.rollback(); return res.status(403).json({ error: 'Access denied for this outlet.' });
    }
    const transitions = {
      pending: ['accepted','cancelled'],
      accepted: ['preparing','cancelled'],
      preparing: ['ready','cancelled'],
      ready: ['completed'],
      completed: [],
      cancelled: []
    };
    if (!transitions[order.status].includes(newStatus)) {
      await conn.rollback();
      return res.status(409).json({ error: `Cannot change status from ${order.status} to ${newStatus}.` });
    }
    await conn.execute('UPDATE orders SET status=? WHERE id=?', [newStatus, order.id]);
    await conn.execute('INSERT INTO order_status_history (order_id,changed_by,old_status,new_status) VALUES (?,?,?,?)',
      [order.id, req.user.id, order.status, newStatus]);
    await conn.commit();
    res.json({ message: 'Order status updated.', orderId: order.id, status: newStatus });
  } catch (err) {
    await conn.rollback();
    next(err);
  } finally { conn.release(); }
});
module.exports = router;
