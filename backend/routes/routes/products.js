// ============================================
// SHOPSPHERE — routes/products.js
// ============================================

import { Router } from "express";
import { query } from "../db.js";
import { authenticate, optionalAuth } from "../middleware/auth.js";
import { requireRole } from "../middleware/roles.js";

const router = Router();

// ── GET /api/products ─────────────────────────────────────────
router.get("/", optionalAuth, async (req, res, next) => {
  try {
    const {
      q, category, min_price, max_price,
      sort = "created_at", order = "DESC",
      page = 1, limit = 24,
    } = req.query;

    const offset = (Number(page) - 1) * Number(limit);
    const conditions = ["p.is_active = TRUE"];
    const params = [];

    if (q) {
      params.push(`%${q}%`);
      conditions.push(`p.name ILIKE $${params.length}`);
    }
    if (category) {
      params.push(category);
      conditions.push(`c.slug = $${params.length}`);
    }
    if (min_price) {
      params.push(Number(min_price));
      conditions.push(`p.price >= $${params.length}`);
    }
    if (max_price) {
      params.push(Number(max_price));
      conditions.push(`p.price <= $${params.length}`);
    }

    const allowedSort = { price: "p.price", name: "p.name", created_at: "p.created_at", rating: "ps.avg_rating" };
    const sortCol = allowedSort[sort] || "p.created_at";
    const sortDir = order.toUpperCase() === "ASC" ? "ASC" : "DESC";

    params.push(Number(limit), offset);

    const { rows } = await query(
      `SELECT p.*, ps.avg_rating, ps.review_count, ps.total_sold,
              c.name AS category_name, c.slug AS category_slug,
              u.full_name AS vendor_name
       FROM products p
       LEFT JOIN product_stats ps ON ps.id = p.id
       LEFT JOIN categories c ON c.id = p.category_id
       LEFT JOIN users u ON u.id = p.vendor_id
       WHERE ${conditions.join(" AND ")}
       ORDER BY ${sortCol} ${sortDir}
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    const { rows: [{ total }] } = await query(
      `SELECT COUNT(*) AS total FROM products p LEFT JOIN categories c ON c.id = p.category_id WHERE ${conditions.join(" AND ")}`,
      params.slice(0, -2)
    );

    res.json({ products: rows, total: Number(total), page: Number(page), limit: Number(limit) });
  } catch (err) { next(err); }
});

// ── GET /api/products/:slug ───────────────────────────────────
router.get("/:slug", async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT p.*, ps.avg_rating, ps.review_count, ps.total_sold,
              c.name AS category_name, u.full_name AS vendor_name
       FROM products p
       LEFT JOIN product_stats ps ON ps.id = p.id
       LEFT JOIN categories c ON c.id = p.category_id
       LEFT JOIN users u ON u.id = p.vendor_id
       WHERE p.slug = $1 AND p.is_active = TRUE`,
      [req.params.slug]
    );
    if (!rows[0]) return res.status(404).json({ error: "Product not found" });

    const { rows: reviews } = await query(
      `SELECT r.*, u.full_name, u.avatar_url FROM reviews r
       JOIN users u ON u.id = r.customer_id
       WHERE r.product_id = $1 ORDER BY r.created_at DESC LIMIT 20`,
      [rows[0].id]
    );

    res.json({ ...rows[0], reviews });
  } catch (err) { next(err); }
});

// ── POST /api/products ────────────────────────────────────────
router.post("/", authenticate, requireRole(["vendor", "admin"]), async (req, res, next) => {
  try {
    const { name, description, price, category_id, stock_quantity, images, tags, sku } = req.body;
    const slug = name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "") + "-" + Date.now();

    const { rows } = await query(
      `INSERT INTO products (vendor_id, category_id, name, slug, description, price, stock_quantity, images, tags, sku)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [req.user.id, category_id, name, slug, description, price, stock_quantity || 0, JSON.stringify(images || []), tags || [], sku]
    );
    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
});

// ── PATCH /api/products/:id ───────────────────────────────────
router.patch("/:id", authenticate, requireRole(["vendor", "admin"]), async (req, res, next) => {
  try {
    const allowed = ["name","description","price","stock_quantity","images","tags","is_active","is_featured","compare_price"];
    const updates = Object.entries(req.body).filter(([k]) => allowed.includes(k));
    if (!updates.length) return res.status(400).json({ error: "No valid fields" });

    const setClauses = updates.map(([k], i) => `${k} = $${i + 2}`).join(", ");
    const values = [req.params.id, ...updates.map(([,v]) => v)];

    const { rows } = await query(`UPDATE products SET ${setClauses} WHERE id = $1 RETURNING *`, values);
    if (!rows[0]) return res.status(404).json({ error: "Product not found" });
    res.json(rows[0]);
  } catch (err) { next(err); }
});

export default router;