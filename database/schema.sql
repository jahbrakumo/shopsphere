-- ============================================
-- SHOPSPHERE DATABASE SCHEMA
-- PostgreSQL 15+
-- ============================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- ============================================
-- USERS
-- ============================================
CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email         VARCHAR(255) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  full_name     VARCHAR(255),
  avatar_url    TEXT,
  role          VARCHAR(20) DEFAULT 'customer' CHECK (role IN ('customer', 'vendor', 'admin')),
  stripe_customer_id TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_users_email ON users(email);

-- ============================================
-- CATEGORIES
-- ============================================
CREATE TABLE categories (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        VARCHAR(100) NOT NULL,
  slug        VARCHAR(100) UNIQUE NOT NULL,
  description TEXT,
  image_url   TEXT,
  parent_id   UUID REFERENCES categories(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- PRODUCTS
-- ============================================
CREATE TABLE products (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vendor_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category_id     UUID REFERENCES categories(id) ON DELETE SET NULL,
  name            VARCHAR(255) NOT NULL,
  slug            VARCHAR(255) UNIQUE NOT NULL,
  description     TEXT,
  price           NUMERIC(10, 2) NOT NULL CHECK (price >= 0),
  compare_price   NUMERIC(10, 2),
  cost_price      NUMERIC(10, 2),
  sku             VARCHAR(100) UNIQUE,
  stock_quantity  INTEGER NOT NULL DEFAULT 0 CHECK (stock_quantity >= 0),
  weight_kg       NUMERIC(6, 3),
  images          JSONB DEFAULT '[]',
  tags            TEXT[],
  is_active       BOOLEAN DEFAULT TRUE,
  is_featured     BOOLEAN DEFAULT FALSE,
  stripe_price_id TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_products_vendor ON products(vendor_id);
CREATE INDEX idx_products_category ON products(category_id);
CREATE INDEX idx_products_name_trgm ON products USING gin(name gin_trgm_ops);
CREATE INDEX idx_products_tags ON products USING gin(tags);
CREATE INDEX idx_products_active ON products(is_active) WHERE is_active = TRUE;

-- ============================================
-- INVENTORY EVENTS (Real-time tracking)
-- ============================================
CREATE TABLE inventory_events (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_id  UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  delta       INTEGER NOT NULL,
  reason      VARCHAR(50) CHECK (reason IN ('purchase', 'restock', 'adjustment', 'return', 'damaged')),
  reference   TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_inventory_product ON inventory_events(product_id);

-- ============================================
-- ORDERS
-- ============================================
CREATE TABLE orders (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  customer_id           UUID NOT NULL REFERENCES users(id),
  status                VARCHAR(30) DEFAULT 'pending'
                          CHECK (status IN ('pending','confirmed','processing','shipped','delivered','cancelled','refunded')),
  subtotal              NUMERIC(10, 2) NOT NULL,
  tax_amount            NUMERIC(10, 2) DEFAULT 0,
  shipping_amount       NUMERIC(10, 2) DEFAULT 0,
  discount_amount       NUMERIC(10, 2) DEFAULT 0,
  total                 NUMERIC(10, 2) NOT NULL,
  stripe_payment_intent TEXT,
  stripe_charge_id      TEXT,
  currency              CHAR(3) DEFAULT 'USD',
  shipping_address      JSONB,
  billing_address       JSONB,
  notes                 TEXT,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_orders_customer ON orders(customer_id);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_orders_created ON orders(created_at DESC);

-- ============================================
-- ORDER ITEMS
-- ============================================
CREATE TABLE order_items (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id    UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id  UUID NOT NULL REFERENCES products(id),
  quantity    INTEGER NOT NULL CHECK (quantity > 0),
  unit_price  NUMERIC(10, 2) NOT NULL,
  total_price NUMERIC(10, 2) NOT NULL,
  snapshot    JSONB
);

CREATE INDEX idx_order_items_order ON order_items(order_id);

-- ============================================
-- REVIEWS
-- ============================================
CREATE TABLE reviews (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_id  UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES users(id),
  rating      SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  title       VARCHAR(255),
  body        TEXT,
  is_verified BOOLEAN DEFAULT FALSE,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(product_id, customer_id)
);

-- ============================================
-- USEFUL VIEWS
-- ============================================
CREATE VIEW product_stats AS
SELECT
  p.id,
  p.name,
  p.price,
  p.stock_quantity,
  COALESCE(AVG(r.rating), 0)::NUMERIC(3,2) AS avg_rating,
  COUNT(r.id) AS review_count,
  COALESCE(SUM(oi.quantity), 0) AS total_sold
FROM products p
LEFT JOIN reviews r ON r.product_id = p.id
LEFT JOIN order_items oi ON oi.product_id = p.id
GROUP BY p.id;

-- ============================================
-- TRIGGERS: auto-update updated_at
-- ============================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated     BEFORE UPDATE ON users     FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_products_updated  BEFORE UPDATE ON products  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_orders_updated    BEFORE UPDATE ON orders    FOR EACH ROW EXECUTE FUNCTION update_updated_at();