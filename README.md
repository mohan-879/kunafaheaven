# ♔ Kunafa Heaven — Deployment Guide

## Run Locally (Right Now)

```bash
# 1. Install dependencies
npm install

# 2. Set your Gmail App Password
#    Get it from: https://myaccount.google.com/apppasswords
#    (requires 2-Step Verification enabled on Gmail)

# 3. Start the server
GMAIL_APP_PASSWORD=your_16_char_password node server.js

# 4. Open in browser
http://localhost:3000
```

**Admin Login:** `sampath@kunafa.com` / `58831`

---

## Deploy to Railway (Easiest — Free)

1. Go to **https://railway.app** → Sign up free
2. Click **"New Project"** → **"Deploy from local"**
3. Upload this entire folder
4. Go to **Variables** tab, add:
   - `GMAIL_APP_PASSWORD` = your 16-char App Password
   - `GMAIL_USER` = heavenkunafa@gmail.com
5. Railway gives you a live URL instantly!

---

## Deploy to Render (Also Free)

1. Go to **https://render.com** → Sign up free
2. Push this folder to a GitHub repo (github.com → New repo → upload files)
3. On Render: **New** → **Web Service** → connect your GitHub repo
4. Set:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
5. Add Environment Variables:
   - `GMAIL_APP_PASSWORD` = your App Password
   - `GMAIL_USER` = heavenkunafa@gmail.com
6. Click **Deploy** → live in ~2 minutes!

---

## Gmail App Password Setup

1. Go to https://myaccount.google.com/security
2. Enable **2-Step Verification** (if not already)
3. Go to https://myaccount.google.com/apppasswords
4. Select app: **Mail**, device: **Other** → type "Kunafa Heaven"
5. Copy the 16-character password
6. Set it as `GMAIL_APP_PASSWORD` environment variable

---

## Features

- 🍯 Full product menu with categories, offers, featured items
- 🛒 Cart with quantity controls
- 📦 Order placement with delivery address
- 📧 Auto email to customer on order + instant alert to heavenkunafa@gmail.com
- 📊 Admin dashboard with live stats
- ⚙️ Add/Edit/Delete products with discounts, badges
- 📋 Order management with status updates
- 👥 Customer list
- 📬 One-click daily summary email

---

## File Structure

```
kunafa-heaven/
├── server.js          ← Backend (Node.js + Express + SQLite)
├── index.html         ← Frontend (full website)
├── database.sqlite    ← Database (auto-created if missing)
├── package.json       ← Dependencies
├── render.yaml        ← Render deployment config
├── railway.toml       ← Railway deployment config
└── README.md          ← This file
```
