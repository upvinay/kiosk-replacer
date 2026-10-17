const express = require('express');
const db = require('../db');
const router = express.Router();

router.get('/outlets', async (req, res, next) => {
  try {
    const [rows] = await db.execute('SELECT id, name, code, address FROM outlets WHERE is_active = TRUE ORDER BY name');
    res.json({ outlets: rows });
  } catch (err) { next(err); }
});

router.get('/menu', async (req, res, next) => {
  try {
    const outletId = Number(req.query.outletId);
    if (!Number.isInteger(outletId) || outletId < 1) return res.status(400).json({ error: 'Valid outletId is required.' });
    const [rows] = await db.execute(
      `SELECT m.id, m.name, m.description, m.price, m.image_url, c.name AS category
       FROM menu_items m LEFT JOIN menu_categories c ON c.id = m.category_id
       JOIN outlets o ON o.id = m.outlet_id
       WHERE m.outlet_id = ? AND m.is_available = TRUE AND o.is_active = TRUE ORDER BY c.name, m.name`,
      [outletId]
    );
    res.json({ items: rows });
  } catch (err) { next(err); }
});

router.post('/orders', async (req, res, next) => {
  const conn = await db.getConnection();
  try {
    const outletId = Number(req.body.outletId);
    const name = String(req.body.name || '').trim().slice(0, 120);
    const phone = String(req.body.phone || '').trim().slice(0, 30);
    const notes = String(req.body.notes || '').trim().slice(0, 500);
    const rawItems = Array.isArray(req.body.items) ? req.body.items : [];
    if (!Number.isInteger(outletId) || outletId < 1 || name.length < 2 || !/^[+0-9() -]{7,30}$/.test(phone) || !rawItems.length) {
      return res.status(400).json({ error: 'Enter a valid outlet, name, phone number, and at least one item.' });
    }
    const quantities = new Map();
    for (const item of rawItems) {
      const id = Number(item.id), qty = Number(item.quantity);
      if (!Number.isInteger(id) || id < 1 || !Number.isInteger(qty) || qty < 1 || qty > 50) {
        return res.status(400).json({ error: 'Each item needs a valid id and quantity between 1 and 50.' });
      }
      quantities.set(id, (quantities.get(id) || 0) + qty);
    }
    await conn.beginTransaction();
    const [outlets] = await conn.execute('SELECT id FROM outlets WHERE id = ? AND is_active = TRUE FOR UPDATE', [outletId]);
    if (!outlets.length) { await conn.rollback(); return res.status(400).json({ error: 'Outlet is unavailable.' }); }
    const ids = [...quantities.keys()];
    const placeholders = ids.map(() => '?').join(',');
    const [menu] = await conn.execute(
      `SELECT id, name, price FROM menu_items WHERE outlet_id = ? AND is_available = TRUE AND id IN (${placeholders})`,
      [outletId, ...ids]
    );
    if (menu.length !== ids.length) { await conn.rollback(); return res.status(400).json({ error: 'One or more items are unavailable. Refresh the menu.' }); }
    let sub = 0;
    const orderLines = menu.map(item => {
      const quantity = quantities.get(item.id);
      const lineTotal = Number((item.price * quantity).toFixed(2));
      sub += lineTotal;
      return { ...item, quantity, lineTotal };
    });
    sub = Number(sub.toFixed(2));
    const fee = sub > 0 ? 5 : 0;
    const grand = Number((sub + fee).toFixed(2));

    const [customers] = await conn.execute('SELECT id FROM customers WHERE phone = ? LIMIT 1', [phone]);
    let customerId;
    if (customers.length) {
      customerId = customers[0].id;
      await conn.execute('UPDATE customers SET name = ? WHERE id = ?', [name, customerId]);
    } else {
      const [customerResult] = await conn.execute('INSERT INTO customers (name, phone) VALUES (?, ?)', [name, phone]);
      customerId = customerResult.insertId;
    }
    const orderNumber = `KR-${Date.now().toString().slice(-8)}-${Math.floor(Math.random() * 90 + 10)}`;
    const [orderResult] = await conn.execute(
      `INSERT INTO orders (order_number, outlet_id, customer_id, status, payment_method, payment_status, subtotal, service_fee, total, notes)
       VALUES (?, ?, ?, 'pending', 'demo', 'demo_unpaid', ?, ?, ?, ?)`,
      [orderNumber, outletId, customerId, sub, fee, grand, notes]
    );
    for (const line of orderLines) {
      await conn.execute(
        'INSERT INTO order_items (order_id, menu_item_id, item_name, unit_price, quantity, line_total) VALUES (?, ?, ?, ?, ?, ?)',
        [orderResult.insertId, line.id, line.name, line.price, line.quantity, line.lineTotal]
      );
    }
    await conn.execute(
      "INSERT INTO order_status_history (order_id, old_status, new_status, note) VALUES (?, NULL, 'pending', 'Order placed; demo payment not collected')",
      [orderResult.insertId]
    );
    await conn.commit();
    res.status(201).json({
      message: 'Demo order created. No payment was collected.',
      order: { id: orderResult.insertId, orderNumber, status: 'pending', paymentStatus: 'demo_unpaid', subtotal: sub, serviceFee: fee, total: grand, items: orderLines.map(x => ({ name: x.name, quantity: x.quantity, price: x.price })) }
    });
  } catch (err) {
    await conn.rollback();
    next(err);
  } finally { conn.release(); }
});

module.exports = router;
