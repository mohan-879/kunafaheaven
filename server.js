const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const SECRET_KEY = process.env.SECRET_KEY || 'kunafa_secret_key_change_in_prod';

// ─── GMAIL TRANSPORTER ────────────────────────────────────────────────────────
// Use Gmail App Password: https://myaccount.google.com/apppasswords
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER || 'heavenkunafa@gmail.com',
    pass: process.env.GMAIL_APP_PASSWORD || 'your_app_password_here', // 16-char App Password
  },
});

async function sendEmail(to, subject, html) {
  try {
    await transporter.sendMail({
      from: `"Kunafa Heaven 🍯" <${process.env.GMAIL_USER || 'heavenkunafa@gmail.com'}>`,
      to,
      subject,
      html,
    });
    console.log(`[EMAIL] Sent to ${to}: ${subject}`);
    return true;
  } catch (err) {
    console.error('[EMAIL] Failed:', err.message);
    return false;
  }
}

// ─── MIDDLEWARE ───────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "index.html")));

// ─── DATABASE ─────────────────────────────────────────────────────────────────
const db = new sqlite3.Database('./database.sqlite', (err) => {
  if (err) { console.error('DB Error:', err.message); return; }
  console.log('Connected to SQLite.');

  db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE,
      phone TEXT,
      address TEXT,
      password TEXT NOT NULL,
      role TEXT DEFAULT 'user',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      price REAL NOT NULL,
      image_url TEXT,
      category TEXT DEFAULT 'Classic',
      discount_percentage REAL DEFAULT 0,
      is_featured INTEGER DEFAULT 0,
      is_new INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Add missing columns if they don't exist (migration)
    db.run(`ALTER TABLE products ADD COLUMN is_featured INTEGER DEFAULT 0`, () => {});
    db.run(`ALTER TABLE products ADD COLUMN is_new INTEGER DEFAULT 0`, () => {});
    db.run(`ALTER TABLE products ADD COLUMN category TEXT DEFAULT 'Classic'`, () => {});

    db.run(`CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      items TEXT NOT NULL,
      total_amount REAL NOT NULL,
      status TEXT DEFAULT 'pending',
      delivery_address TEXT,
      phone TEXT,
      note TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users (id)
    )`);

    // Add missing order columns
    db.run(`ALTER TABLE orders ADD COLUMN delivery_address TEXT`, () => {});
    db.run(`ALTER TABLE orders ADD COLUMN phone TEXT`, () => {});
    db.run(`ALTER TABLE orders ADD COLUMN note TEXT`, () => {});

    db.run(`CREATE TABLE IF NOT EXISTS sent_emails (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      to_email TEXT NOT NULL,
      subject TEXT NOT NULL,
      body TEXT NOT NULL,
      otp TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS otps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL,
      otp TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
  });
});

// Seed admin
bcrypt.hash('58831', 10, (err, hash) => {
  if (!err) {
    db.run(`DELETE FROM users WHERE email = 'sampath@kunafa.com'`);
    db.run(`INSERT OR IGNORE INTO users (name, email, password, role) VALUES ('sampath', 'sampath@kunafa.com', ?, 'admin')`, [hash]);
  }
});

// ─── TOKEN MIDDLEWARE ─────────────────────────────────────────────────────────
const verifyToken = (req, res, next) => {
  const auth = req.headers['authorization'];
  if (!auth) return res.status(403).json({ error: 'No token provided' });
  jwt.verify(auth.split(' ')[1], SECRET_KEY, (err, decoded) => {
    if (err) return res.status(401).json({ error: 'Unauthorized' });
    req.userId = decoded.id;
    req.userRole = decoded.role;
    next();
  });
};

const verifyAdmin = (req, res, next) => {
  if (req.userRole !== 'admin') return res.status(403).json({ error: 'Require Admin Role' });
  next();
};

// ─── AUTH ──────────────────────────────────────────────────────────────────────
app.post('/api/auth/register', (req, res) => {
  const { name, email, phone, address, password } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'Missing required fields' });

  bcrypt.hash(password, 10, (err, hash) => {
    if (err) return res.status(500).json({ error: 'Error hashing password' });
    db.run(`INSERT INTO users (name, email, phone, address, password) VALUES (?, ?, ?, ?, ?)`,
      [name, email, phone, address, hash], function(err) {
        if (err) {
          if (err.message.includes('UNIQUE')) return res.status(400).json({ error: 'Email already exists' });
          return res.status(500).json({ error: 'Failed to register user' });
        }
        res.status(201).json({ message: 'User registered successfully' });
      });
  });
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  db.get(`SELECT * FROM users WHERE email = ?`, [email], (err, user) => {
    if (err || !user) return res.status(404).json({ error: 'User not found' });
    bcrypt.compare(password, user.password, (err, result) => {
      if (err || !result) return res.status(401).json({ error: 'Invalid password' });
      const token = jwt.sign({ id: user.id, role: user.role }, SECRET_KEY, { expiresIn: 86400 });
      res.json({ token, user: { id: user.id, name: user.name, role: user.role, email: user.email } });
    });
  });
});

app.post('/api/auth/send-otp', (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email is required' });

  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  const expiresAt = Date.now() + 5 * 60 * 1000;

  db.run(`INSERT INTO otps (email, otp, expires_at) VALUES (?, ?, ?)`, [email, otp, expiresAt], (err) => {
    if (err) return res.status(500).json({ error: 'Failed to generate OTP' });
    console.log(`[OTP] ${email}: ${otp}`);
    res.json({ message: 'OTP sent (Demo Mode)', demoOtp: otp });
  });
});

app.post('/api/auth/verify-otp', (req, res) => {
  const { email, otp } = req.body;
  db.get(`SELECT * FROM otps WHERE email = ? AND otp = ? AND expires_at > ? ORDER BY created_at DESC LIMIT 1`,
    [email, otp, Date.now()], (err, row) => {
      if (err || !row) return res.status(400).json({ error: 'Invalid or expired OTP' });
      res.json({ verified: true });
    });
});

// ─── PRODUCTS ─────────────────────────────────────────────────────────────────
app.get('/api/products', (req, res) => {
  db.all(`SELECT * FROM products ORDER BY is_featured DESC, created_at DESC`, [], (err, rows) => {
    if (err) return res.status(500).json({ error: 'Failed to fetch products' });
    res.json(rows);
  });
});

// ─── PAYMENT (DEMO) ───────────────────────────────────────────────────────────
app.post('/api/payment/create-order', verifyToken, async (req, res) => {
  const { amount } = req.body;
  if (!amount) return res.status(400).json({ error: 'Amount is required' });
  res.json({ id: `order_demo_${Date.now()}`, amount: Math.round(amount * 100), currency: 'INR' });
});

app.post('/api/payment/verify', verifyToken, (req, res) => {
  res.json({ message: 'Payment verified (Demo Mode)' });
});

// ─── ORDERS ───────────────────────────────────────────────────────────────────
app.post('/api/orders', verifyToken, (req, res) => {
  const { items, total_amount, delivery_address, phone, note } = req.body;
  if (!items || !total_amount) return res.status(400).json({ error: 'Missing order details' });

  db.run(`INSERT INTO orders (user_id, items, total_amount, delivery_address, phone, note) VALUES (?, ?, ?, ?, ?, ?)`,
    [req.userId, JSON.stringify(items), total_amount, delivery_address || '', phone || '', note || ''],
    function(err) {
      if (err) return res.status(500).json({ error: 'Failed to place order' });
      const orderId = this.lastID;

      db.get(`SELECT name, email FROM users WHERE id = ?`, [req.userId], async (errUser, user) => {
        if (!errUser && user) {
          const itemsHtml = items.map(i =>
            `<tr><td style="padding:8px 12px;border-bottom:1px solid #f5e6c8">${i.name}</td>
             <td style="padding:8px 12px;border-bottom:1px solid #f5e6c8;text-align:center">×${i.quantity}</td>
             <td style="padding:8px 12px;border-bottom:1px solid #f5e6c8;text-align:right">₹${(i.price * i.quantity).toFixed(0)}</td></tr>`
          ).join('');

          // Customer confirmation email
          const customerHtml = `
            <div style="font-family:'Georgia',serif;background:#fdf6ec;padding:0;margin:0">
              <div style="background:linear-gradient(135deg,#8B1A1A,#C94040);padding:40px;text-align:center">
                <h1 style="color:#FFD700;font-size:32px;margin:0;letter-spacing:3px">♔ KUNAFA HEAVEN</h1>
                <p style="color:#FFD7B3;margin:8px 0 0;font-size:14px">Artisan Middle Eastern Sweets</p>
              </div>
              <div style="padding:40px;max-width:600px;margin:0 auto">
                <h2 style="color:#8B1A1A;font-size:24px">Order Confirmed! 🎉</h2>
                <p style="color:#555;font-size:16px">Dear ${user.name}, your order <strong>#${orderId}</strong> has been received and is being prepared with love.</p>
                <table style="width:100%;border-collapse:collapse;margin:24px 0;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(139,26,26,0.1)">
                  <thead><tr style="background:#8B1A1A">
                    <th style="padding:12px;color:#FFD700;text-align:left">Item</th>
                    <th style="padding:12px;color:#FFD700;text-align:center">Qty</th>
                    <th style="padding:12px;color:#FFD700;text-align:right">Price</th>
                  </tr></thead>
                  <tbody>${itemsHtml}</tbody>
                  <tfoot><tr style="background:#fdf0dc">
                    <td colspan="2" style="padding:12px;font-weight:bold;color:#8B1A1A">Total</td>
                    <td style="padding:12px;font-weight:bold;color:#8B1A1A;text-align:right">₹${total_amount.toFixed(0)}</td>
                  </tr></tfoot>
                </table>
                ${delivery_address ? `<p style="color:#555"><strong>📍 Delivery to:</strong> ${delivery_address}</p>` : ''}
                <p style="color:#888;font-size:14px;margin-top:32px">Thank you for choosing Kunafa Heaven. Every piece is made fresh for you. ♔</p>
              </div>
            </div>`;

          await sendEmail(user.email, `Order Confirmed #${orderId} - Kunafa Heaven`, customerHtml);

          // Admin notification to heavenkunafa@gmail.com
          const adminHtml = `
            <div style="font-family:'Georgia',serif;background:#1a0a00;padding:0;margin:0">
              <div style="background:linear-gradient(135deg,#8B1A1A,#C94040);padding:32px;text-align:center">
                <h1 style="color:#FFD700;margin:0;letter-spacing:2px">♔ NEW ORDER ALERT</h1>
              </div>
              <div style="padding:32px;color:#f5e6c8">
                <h2 style="color:#FFD700">Order #${orderId}</h2>
                <p><strong>Customer:</strong> ${user.name} (${user.email})</p>
                <p><strong>Phone:</strong> ${phone || 'N/A'}</p>
                <p><strong>Address:</strong> ${delivery_address || 'N/A'}</p>
                ${note ? `<p><strong>Note:</strong> ${note}</p>` : ''}
                <table style="width:100%;border-collapse:collapse;margin:16px 0">
                  <thead><tr style="background:#8B1A1A">
                    <th style="padding:10px;color:#FFD700;text-align:left">Item</th>
                    <th style="padding:10px;color:#FFD700;text-align:center">Qty</th>
                    <th style="padding:10px;color:#FFD700;text-align:right">Price</th>
                  </tr></thead>
                  <tbody>${itemsHtml}</tbody>
                </table>
                <p style="color:#FFD700;font-size:20px;font-weight:bold">Total: ₹${total_amount.toFixed(0)}</p>
                <p style="color:#888;font-size:12px">Time: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}</p>
              </div>
            </div>`;

          await sendEmail('heavenkunafa@gmail.com', `🆕 New Order #${orderId} — ₹${total_amount.toFixed(0)} from ${user.name}`, adminHtml);
        }
      });

      res.status(201).json({ message: 'Order placed successfully', orderId });
    });
});

app.get('/api/orders/my', verifyToken, (req, res) => {
  db.all(`SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC`, [req.userId], (err, rows) => {
    if (err) return res.status(500).json({ error: 'Failed to fetch orders' });
    res.json(rows);
  });
});

// ─── ADMIN ────────────────────────────────────────────────────────────────────
app.get('/api/admin/users', verifyToken, verifyAdmin, (req, res) => {
  db.all(`SELECT id, name, email, phone, role, created_at FROM users`, [], (err, rows) => {
    if (err) return res.status(500).json({ error: 'Failed to fetch users' });
    res.json(rows);
  });
});

app.get('/api/admin/orders', verifyToken, verifyAdmin, (req, res) => {
  db.all(`SELECT orders.*, users.name as customer_name, users.email as customer_email
    FROM orders JOIN users ON orders.user_id = users.id
    ORDER BY orders.created_at DESC`, [], (err, rows) => {
    if (err) return res.status(500).json({ error: 'Failed to fetch orders' });
    res.json(rows);
  });
});

app.put('/api/admin/orders/:id/status', verifyToken, verifyAdmin, (req, res) => {
  const { status } = req.body;
  db.run(`UPDATE orders SET status = ? WHERE id = ?`, [status, req.params.id], function(err) {
    if (err) return res.status(500).json({ error: 'Failed to update status' });
    res.json({ message: 'Status updated' });
  });
});

// Admin order summary — send email summary
app.post('/api/admin/send-order-summary', verifyToken, verifyAdmin, (req, res) => {
  const today = new Date().toISOString().split('T')[0];

  db.all(`SELECT orders.*, users.name as customer_name FROM orders
    JOIN users ON orders.user_id = users.id
    WHERE DATE(orders.created_at) = ?`, [today], async (err, rows) => {
    if (err) return res.status(500).json({ error: 'DB error' });

    const totalRevenue = rows.reduce((s, r) => s + r.total_amount, 0);
    const orderRows = rows.map(r =>
      `<tr>
        <td style="padding:8px 12px;border-bottom:1px solid #333">#${r.id}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #333">${r.customer_name}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #333;text-align:right">₹${r.total_amount.toFixed(0)}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #333">${r.status}</td>
      </tr>`).join('');

    const summaryHtml = `
      <div style="font-family:'Georgia',serif;background:#1a0a00;padding:0;color:#f5e6c8">
        <div style="background:linear-gradient(135deg,#8B1A1A,#C94040);padding:32px;text-align:center">
          <h1 style="color:#FFD700;margin:0">♔ Daily Order Summary</h1>
          <p style="color:#FFD7B3;margin:4px 0 0">${today}</p>
        </div>
        <div style="padding:32px">
          <div style="display:flex;gap:24px;margin-bottom:24px">
            <div style="background:#2a1500;padding:20px;border-radius:12px;border:1px solid #FFD700;flex:1;text-align:center">
              <div style="font-size:36px;color:#FFD700;font-weight:bold">${rows.length}</div>
              <div style="color:#f5e6c8;font-size:14px">Total Orders</div>
            </div>
            <div style="background:#2a1500;padding:20px;border-radius:12px;border:1px solid #4CAF50;flex:1;text-align:center">
              <div style="font-size:36px;color:#4CAF50;font-weight:bold">₹${totalRevenue.toFixed(0)}</div>
              <div style="color:#f5e6c8;font-size:14px">Total Revenue</div>
            </div>
          </div>
          ${rows.length > 0 ? `
          <table style="width:100%;border-collapse:collapse">
            <thead><tr style="background:#8B1A1A">
              <th style="padding:10px;color:#FFD700;text-align:left">Order</th>
              <th style="padding:10px;color:#FFD700;text-align:left">Customer</th>
              <th style="padding:10px;color:#FFD700;text-align:right">Amount</th>
              <th style="padding:10px;color:#FFD700;text-align:left">Status</th>
            </tr></thead>
            <tbody>${orderRows}</tbody>
          </table>` : '<p style="color:#888;text-align:center">No orders today.</p>'}
        </div>
      </div>`;

    const sent = await sendEmail('heavenkunafa@gmail.com', `📊 Daily Summary: ${rows.length} orders, ₹${totalRevenue.toFixed(0)} — ${today}`, summaryHtml);
    res.json({ message: sent ? 'Summary email sent!' : 'Email failed (check credentials)', orders: rows.length, revenue: totalRevenue });
  });
});

// Dashboard stats
app.get('/api/admin/stats', verifyToken, verifyAdmin, (req, res) => {
  const stats = {};
  db.get(`SELECT COUNT(*) as total, SUM(total_amount) as revenue FROM orders`, (err, r) => {
    stats.totalOrders = r?.total || 0;
    stats.totalRevenue = r?.revenue || 0;
    db.get(`SELECT COUNT(*) as total FROM users WHERE role = 'user'`, (err2, r2) => {
      stats.totalUsers = r2?.total || 0;
      db.get(`SELECT COUNT(*) as total FROM products`, (err3, r3) => {
        stats.totalProducts = r3?.total || 0;
        db.all(`SELECT * FROM orders ORDER BY created_at DESC LIMIT 5`, (err4, recent) => {
          stats.recentOrders = recent || [];
          res.json(stats);
        });
      });
    });
  });
});

// Products CRUD
app.post('/api/admin/products', verifyToken, verifyAdmin, (req, res) => {
  const { name, price, image_url, discount_percentage, category, description, is_featured, is_new } = req.body;
  if (!name || !price) return res.status(400).json({ error: 'Missing product details' });
  db.run(`INSERT INTO products (name, price, image_url, discount_percentage, category, description, is_featured, is_new) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [name, price, image_url, discount_percentage || 0, category || 'Classic', description || '', is_featured ? 1 : 0, is_new ? 1 : 0],
    function(err) {
      if (err) return res.status(500).json({ error: 'Failed to add product' });
      res.status(201).json({ message: 'Product added', id: this.lastID });
    });
});

app.put('/api/admin/products/:id', verifyToken, verifyAdmin, (req, res) => {
  const { name, price, image_url, discount_percentage, category, description, is_featured, is_new } = req.body;
  db.run(`UPDATE products SET name=?, price=?, image_url=?, discount_percentage=?, category=?, description=?, is_featured=?, is_new=? WHERE id=?`,
    [name, price, image_url, discount_percentage || 0, category || 'Classic', description || '', is_featured ? 1 : 0, is_new ? 1 : 0, req.params.id],
    function(err) {
      if (err) return res.status(500).json({ error: 'Failed to update product' });
      res.json({ message: 'Product updated' });
    });
});

app.delete('/api/admin/products/:id', verifyToken, verifyAdmin, (req, res) => {
  db.run(`DELETE FROM products WHERE id = ?`, [req.params.id], function(err) {
    if (err) return res.status(500).json({ error: 'Failed to delete product' });
    res.json({ message: 'Product deleted' });
  });
});

app.get('/api/admin/mailbox', verifyToken, verifyAdmin, (req, res) => {
  db.all(`SELECT * FROM sent_emails ORDER BY created_at DESC`, [], (err, rows) => {
    if (err) return res.status(500).json({ error: 'Failed' });
    res.json(rows);
  });
});

// ─── START ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => console.log(`Kunafa Heaven server on http://localhost:${PORT}`));
