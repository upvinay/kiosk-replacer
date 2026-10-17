require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('./db');

async function seed() {
  const conn = await db.getConnection();
  try {
    const [existing] = await conn.execute('SELECT id FROM users WHERE email=?', ['admin@kiosk.local']);
    if (!existing.length) {
      const hash = await bcrypt.hash('ChangeMe123!', 12);
      await conn.execute('INSERT INTO users (name,email,password_hash,role) VALUES (?,?,?,?)',
        ['Demo Administrator', 'admin@kiosk.local', hash, 'admin']);
      console.log('Seeded admin: admin@kiosk.local / ChangeMe123!');
    } else {
      console.log('Seed admin already exists; leaving it unchanged.');
    }
    let [outlets] = await conn.execute('SELECT id FROM outlets WHERE code=?', ['MAIN']);
    let outletId;
    if (!outlets.length) {
      const [r] = await conn.execute('INSERT INTO outlets (name,code,address,phone) VALUES (?,?,?,?)',
        ['Main Outlet', 'MAIN', 'Demo address', '']);
      outletId = r.insertId;
    } else outletId = outlets[0].id;

    const demoItems = [
      ['Snacks','Classic Veg Burger','Crisp vegetables and house sauce.',89],
      ['Snacks','Golden French Fries','Golden, lightly salted fries.',59],
      ['Meals','Paneer Rice Bowl','Spiced paneer with fragrant rice.',149],
      ['Snacks','Masala Sandwich','Toasted sandwich with savoury filling.',79],
      ['Drinks','Fresh Lime Soda','Refreshing citrus cooler.',49],
      ['Drinks','Cold Coffee','Chilled creamy coffee.',89],
      ['Meals','Veg Thali','A homestyle meal.',179],
      ['Snacks','Chocolate Brownie','Rich chocolate treat.',69]
    ];
    for (const [category, name, description, price] of demoItems) {
      let [rows] = await conn.execute('SELECT id FROM menu_items WHERE outlet_id=? AND name=?', [outletId, name]);
      if (rows.length) continue;
      let [cats] = await conn.execute('SELECT id FROM menu_categories WHERE outlet_id=? AND name=?', [outletId, category]);
      let categoryId;
      if (!cats.length) {
        const [cr] = await conn.execute('INSERT INTO menu_categories (outlet_id,name) VALUES (?,?)', [outletId, category]);
        categoryId = cr.insertId;
      } else categoryId = cats[0].id;
      await conn.execute('INSERT INTO menu_items (outlet_id,category_id,name,description,price) VALUES (?,?,?,?,?)',
        [outletId, categoryId, name, description, price]);
    }
    console.log('Demo outlet and menu ready.');
  } finally {
    conn.release();
    await db.end();
  }
}
seed().catch(err => { console.error(err); process.exit(1); });
