// ============================================
// SHOPSPHERE — src/api.js
// Axios API client → Node.js backend
// ============================================

import axios from "axios";

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || "http://localhost:4000/api",
  timeout: 10_000,
  headers: { "Content-Type": "application/json" },
});

// Attach JWT from localStorage on every request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem("ss_token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Auto-refresh or redirect on 401
api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem("ss_token");
      window.location.href = "/login";
    }
    return Promise.reject(err);
  }
);

// ── Auth ──────────────────────────────────────────────────────
export const authAPI = {
  register: (data) => api.post("/auth/register", data),
  login:    (data) => api.post("/auth/login", data),
  me:       ()     => api.get("/auth/me"),
};

// ── Products ──────────────────────────────────────────────────
export const productsAPI = {
  list:   (params) => api.get("/products", { params }),
  get:    (slug)   => api.get(`/products/${slug}`),
  create: (data)   => api.post("/products", data),
  update: (id, data) => api.patch(`/products/${id}`, data),
};

// ── Orders ────────────────────────────────────────────────────
export const ordersAPI = {
  list:   ()     => api.get("/orders"),
  get:    (id)   => api.get(`/orders/${id}`),
  create: (data) => api.post("/orders", data),
};

// ── Stripe ────────────────────────────────────────────────────
export const stripeAPI = {
  createPaymentIntent: (items) => api.post("/stripe/create-payment-intent", { items }),
};

// ── Admin ─────────────────────────────────────────────────────
export const adminAPI = {
  dashboard: () => api.get("/admin/dashboard"),
  users:     (params) => api.get("/admin/users", { params }),
  orders:    (params) => api.get("/admin/orders", { params }),
};

export default api;