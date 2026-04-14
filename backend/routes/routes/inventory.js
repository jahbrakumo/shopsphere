// ============================================
// SHOPSPHERE — sockets/inventory.js
// Real-time inventory via Socket.IO
// ============================================

import { query } from "../../../db.js";

export function setupInventorySocket(io) {
  io.on("connection", (socket) => {
    console.log(`🔌 Client connected: ${socket.id}`);

    // Client can subscribe to a specific product's stock
    socket.on("inventory:subscribe", async ({ product_id }) => {
      socket.join(`product:${product_id}`);
      try {
        const { rows } = await query(
          "SELECT id, name, stock_quantity FROM products WHERE id = $1",
          [product_id]
        );
        if (rows[0]) socket.emit("inventory:snapshot", rows[0]);
      } catch (err) {
        console.error("Inventory subscribe error:", err);
      }
    });

    socket.on("inventory:unsubscribe", ({ product_id }) => {
      socket.leave(`product:${product_id}`);
    });

    socket.on("disconnect", () => {
      console.log(`🔌 Client disconnected: ${socket.id}`);
    });
  });
}

// Called after every inventory mutation (purchase, restock, etc.)
export function broadcastInventoryUpdate(io, product) {
  io.to(`product:${product.id}`).emit("inventory:update", product);
  io.emit("inventory:global", product); // Admin dashboard listener
}