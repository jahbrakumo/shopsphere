// ============================================
// SHOPSPHERE — routes/stripe.js
// Stripe Payments + Webhooks
// ============================================

import { Router } from "express";
import Stripe from "stripe";
import { query, withTransaction } from "../config/db.js";
import { authenticate } from "../middleware/auth.js";
import { io } from "../server.js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-04-10" });
const router = Router();

// ── POST /api/stripe/create-payment-intent ────────────────────
router.post("/create-payment-intent", authenticate, async (req, res, next) => {
  try {
    const { items } = req.body; // [{ product_id, quantity }]

    // Fetch products & validate stock
    const productIds = items.map((i) => i.product_id);
    const { rows: products } = await query(
      `SELECT id, name, price, stock_quantity FROM products WHERE id = ANY($1::uuid[]) AND is_active = TRUE`,
      [productIds]
    );

    if (products.length !== items.length) {
      return res.status(400).json({ error: "One or more products unavailable" });
    }

    let subtotal = 0;
    const lineItems = items.map((item) => {
      const product = products.find((p) => p.id === item.product_id);
      if (product.stock_quantity < item.quantity) {
        throw Object.assign(new Error(`Insufficient stock for ${product.name}`), { status: 400 });
      }
      subtotal += product.price * item.quantity;
      return { product, quantity: item.quantity, unit_price: product.price };
    });

    const tax = +(subtotal * 0.08).toFixed(2);
    const total = +(subtotal + tax).toFixed(2);

    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(total * 100),
      currency: "usd",
      customer: req.user.stripe_customer_id || undefined,
      metadata: {
        user_id: req.user.id,
        items: JSON.stringify(items),
      },
      automatic_payment_methods: { enabled: true },
    });

    res.json({
      clientSecret: paymentIntent.client_secret,
      subtotal,
      tax,
      total,
      lineItems,
    });
  } catch (err) { next(err); }
});

// ── POST /api/stripe/webhook ──────────────────────────────────
router.post("/webhook", async (req, res) => {
  let event;
  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      req.headers["stripe-signature"],
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error("Webhook sig verify failed:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === "payment_intent.succeeded") {
    const pi = event.data.object;
    const { user_id, items: itemsJson } = pi.metadata;
    const items = JSON.parse(itemsJson);

    try {
      await withTransaction(async (client) => {
        // Fetch product prices
        const { rows: products } = await client.query(
          `SELECT id, name, price, stock_quantity FROM products WHERE id = ANY($1::uuid[])`,
          [items.map((i) => i.product_id)]
        );

        let subtotal = 0;
        const orderItems = items.map((item) => {
          const p = products.find((p) => p.id === item.product_id);
          subtotal += p.price * item.quantity;
          return { product_id: p.id, quantity: item.quantity, unit_price: p.price, total_price: p.price * item.quantity };
        });

        const tax = +(subtotal * 0.08).toFixed(2);
        const total = +(subtotal + tax).toFixed(2);

        // Create order
        const { rows: [order] } = await client.query(
          `INSERT INTO orders (customer_id, status, subtotal, tax_amount, total, stripe_payment_intent)
           VALUES ($1, 'confirmed', $2, $3, $4, $5) RETURNING *`,
          [user_id, subtotal, tax, total, pi.id]
        );

        // Insert order items + deduct inventory
        for (const item of orderItems) {
          await client.query(
            `INSERT INTO order_items (order_id, product_id, quantity, unit_price, total_price) VALUES ($1,$2,$3,$4,$5)`,
            [order.id, item.product_id, item.quantity, item.unit_price, item.total_price]
          );
          await client.query(
            `UPDATE products SET stock_quantity = stock_quantity - $1 WHERE id = $2`,
            [item.quantity, item.product_id]
          );
          await client.query(
            `INSERT INTO inventory_events (product_id, delta, reason, reference) VALUES ($1,$2,'purchase',$3)`,
            [item.product_id, -item.quantity, order.id]
          );

          // Real-time inventory broadcast
          const { rows: [updated] } = await client.query(
            `SELECT id, stock_quantity FROM products WHERE id = $1`,
            [item.product_id]
          );
          io.emit("inventory:update", updated);
        }
      });
    } catch (err) {
      console.error("Order fulfillment error:", err);
    }
  }

  res.json({ received: true });
});

export default router;