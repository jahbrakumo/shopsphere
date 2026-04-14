// ============================================
// SHOPSPHERE — middleware/auth.js
// JWT authentication middleware
// ============================================

import jwt from "jsonwebtoken";
import { query } from "../config/db.js";

const JWT_SECRET = process.env.JWT_SECRET || "shopsphere-dev-secret-change-in-prod";

export function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "7d" });
}

export async function authenticate(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "No token provided" });
  }

  try {
    const token = header.slice(7);
    const decoded = jwt.verify(token, JWT_SECRET);

    const { rows } = await query(
      "SELECT id, email, full_name, role, stripe_customer_id FROM users WHERE id = $1",
      [decoded.id]
    );
    if (!rows[0]) return res.status(401).json({ error: "User not found" });

    req.user = rows[0];
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

export async function optionalAuth(req, _res, next) {
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) {
    try {
      const decoded = jwt.verify(header.slice(7), JWT_SECRET);
      const { rows } = await query("SELECT id, email, full_name, role FROM users WHERE id = $1", [decoded.id]);
      req.user = rows[0] || null;
    } catch {
      req.user = null;
    }
  }
  next();
}