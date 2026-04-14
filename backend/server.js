// ============================================
// SHOPSPHERE — server.js
// Node.js + Express Entry Point
// ============================================

import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import rateLimit from "express-rate-limit";
import { createServer } from "http";
import { Server as SocketIO } from "socket.io";

import { connectDB, pool } from "./config/db.js";
import authRoutes from "./routes/auth.js";
import productRoutes from "./routes/products.js";
import orderRoutes from "./routes/orders.js";
import inventoryRoutes from "./routes/inventory.js";
import stripeRoutes from "./routes/stripe.js";
import adminRoutes from "./routes/admin.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { setupInventorySocket } from "./sockets/inventory.js";

const app = express();
const httpServer = createServer(app);

// ── Socket.IO (real-time inventory) ──────────────────────────
export const io = new SocketIO(httpServer, {
  cors: { origin: process.env.CLIENT_URL || "http://localhost:5173", methods: ["GET", "POST"] },
});
setupInventorySocket(io);

// ── Middleware ────────────────────────────────────────────────
app.use(helmet());
app.use(cors({ origin: process.env.CLIENT_URL || "http://localhost:5173", credentials: true }));
app.use(morgan("dev"));

// Stripe webhook needs raw body — mount BEFORE express.json()
app.use("/api/stripe/webhook", express.raw({ type: "application/json" }));
app.use(express.json());

app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 200, standardHeaders: true }));

// ── Health check ──────────────────────────────────────────────
app.get("/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ status: "ok", db: "connected", timestamp: new Date().toISOString() });
  } catch {
    res.status(503).json({ status: "error", db: "disconnected" });
  }
});

// ── Routes ────────────────────────────────────────────────────
app.use("/api/auth", authRoutes);
app.use("/api/products", productRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/inventory", inventoryRoutes);
app.use("/api/stripe", stripeRoutes);
app.use("/api/admin", adminRoutes);

// ── Error handler ─────────────────────────────────────────────
app.use(errorHandler);

// ── Bootstrap ─────────────────────────────────────────────────
const PORT = process.env.PORT || 4000;

(async () => {
  await connectDB();
  httpServer.listen(PORT, () => {
    console.log(`🛍  ShopSphere API  →  http://localhost:${PORT}`);
    console.log(`🔌  Socket.IO       →  ws://localhost:${PORT}`);
  });
})();