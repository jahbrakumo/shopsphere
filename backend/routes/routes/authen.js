// ============================================
// SHOPSPHERE — routes/auth.js
// Register, Login, Me
// ============================================

import { Router } from "express";
import bcrypt from "bcryptjs";
import Stripe from "stripe";
import { query } from "../db.js";
import { signToken, authenticate } from "../middleware/auth.js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-04-10" });
const router = Router();

// ── POST /api/auth/register ───────────────────────────────────
router.post("/register", async (req, res, next) => {
  try {
    const { email, password, full_name, role = "customer" } = req.body;
    if (!email || !password) return res.status(400).json({ error: "Email and password required" });
    if (password.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters" });

    const { rows: existing } = await query("SELECT id FROM users WHERE email = $1", [email]);
    if (existing[0]) return res.status(409).json({ error: "Email already registered" });

    const password_hash = await bcrypt.hash(password, 12);

    // Create Stripe customer
    const stripeCustomer = await stripe.customers.create({ email, name: full_name });

    const { rows } = await query(
      `INSERT INTO users (email, password_hash, full_name, role, stripe_customer_id)
       VALUES ($1, $2, $3, $4, $5) RETURNING id, email, full_name, role`,
      [email, password_hash, full_name, role, stripeCustomer.id]
    );

    const token = signToken({ id: rows[0].id, role: rows[0].role });
    res.status(201).json({ user: rows[0], token });
  } catch (err) { next(err); }
});

// ── POST /api/auth/login ──────────────────────────────────────
router.post("/login", async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const { rows } = await query(
      "SELECT id, email, full_name, role, password_hash, stripe_customer_id FROM users WHERE email = $1",
      [email]
    );
    const user = rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const { password_hash, ...safeUser } = user;
    const token = signToken({ id: user.id, role: user.role });
    res.json({ user: safeUser, token });
  } catch (err) { next(err); }
});

// ── GET /api/auth/me ──────────────────────────────────────────
router.get("/me", authenticate, (req, res) => {
  res.json({ user: req.user });
});

export default router;