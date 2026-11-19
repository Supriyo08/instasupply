-- =====================================================================================
-- InstaSupply · migration 0001_init · PostgreSQL 17
-- Conventions (docs/PLATFORM.md §3.1):
--   * ids are text; money is bigint cents; instants inside documents are epoch milliseconds.
--   * `doc` holds the shared TypeScript document without its primary key, without
--     createdAt/updatedAt and without the fields listed as "owned columns" for the table.
--   * GENERATED columns mirror `doc` (or `meta`) for filters, sorts, keys and foreign keys.
--     They cannot be written, so they cannot drift from the document.
--   * created_at / updated_at are written by the repositories from the application clock.
--   * No extension is required.
--   * In comments, "§n" is a section of docs/PLATFORM.md and "MARKETPLACE §n" one of docs/MARKETPLACE.md.
-- =====================================================================================

-- ---------- helper functions ----------

CREATE FUNCTION ms_to_ts(ms bigint) RETURNS timestamptz
  LANGUAGE sql IMMUTABLE PARALLEL SAFE RETURNS NULL ON NULL INPUT
  AS $$ SELECT to_timestamp(ms::double precision / 1000.0) $$;

CREATE FUNCTION jsonb_text_array(j jsonb) RETURNS text[]
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
  AS $$ SELECT COALESCE(array_agg(e ORDER BY o), '{}'::text[])
        FROM jsonb_array_elements_text(j) WITH ORDINALITY AS t(e, o) $$;

CREATE FUNCTION is_uuid4(v text) RETURNS boolean
  LANGUAGE sql IMMUTABLE PARALLEL SAFE RETURNS NULL ON NULL INPUT
  AS $$ SELECT v ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' $$;

-- ---------- human numbers (MARKETPLACE §1.1) ----------

CREATE SEQUENCE order_number_seq START WITH 10001 MINVALUE 10001 NO CYCLE;  -- IS-10001: orders and manual deliveries
CREATE SEQUENCE quote_number_seq START WITH 10001 MINVALUE 10001 NO CYCLE;  -- Q-10001
CREATE SEQUENCE issue_number_seq START WITH 10001 MINVALUE 10001 NO CYCLE;  -- CASE-10001

-- =====================================================================================
-- Stores and catalogue
-- =====================================================================================

CREATE TABLE stores (
  id            text PRIMARY KEY
                CHECK (id ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length(id) BETWEEN 3 AND 40),
  doc           jsonb NOT NULL,              -- Store (rating, ratingCount are computed from the two columns below)
  settings      jsonb NOT NULL,              -- PRIVATE: StorePrivateSettings
  rating_sum    integer NOT NULL DEFAULT 0 CHECK (rating_sum >= 0),
  rating_count  integer NOT NULL DEFAULT 0 CHECK (rating_count >= 0),
  name          text GENERATED ALWAYS AS (doc->>'name') STORED NOT NULL,
  status        text GENERATED ALWAYS AS (doc->>'status') STORED NOT NULL
                CHECK (status IN ('onboarding', 'coming_soon', 'live', 'closed')),
  market_id     text GENERATED ALWAYS AS (doc->>'marketId') STORED NOT NULL,
  city_id       text GENERATED ALWAYS AS (doc->>'cityId') STORED NOT NULL,
  accepting_orders boolean GENERATED ALWAYS AS ((doc->>'acceptingOrders')::boolean) STORED NOT NULL,
  created_at    timestamptz NOT NULL,
  updated_at    timestamptz NOT NULL
);
CREATE INDEX stores_market_idx ON stores (market_id, status);

CREATE TABLE categories (
  id          text PRIMARY KEY,
  doc         jsonb NOT NULL,                -- Category without id
  sort_order  integer GENERATED ALWAYS AS ((doc->>'sortOrder')::integer) STORED NOT NULL,
  active      boolean GENERATED ALWAYS AS ((doc->>'active')::boolean) STORED NOT NULL,
  created_at  timestamptz NOT NULL,
  updated_at  timestamptz NOT NULL
);
CREATE INDEX categories_sort_idx ON categories (sort_order, id);

CREATE TABLE products (
  id            text PRIMARY KEY,            -- `${storeId}--${skuSlug}`
  store_id      text NOT NULL REFERENCES stores(id),
  doc           jsonb NOT NULL,              -- Product without id, storeId and the owned columns below
  -- owned columns (never inside doc)
  stock_on_hand integer NOT NULL DEFAULT 0 CHECK (stock_on_hand BETWEEN 0 AND 1000000),
  reserved      integer NOT NULL DEFAULT 0 CHECK (reserved >= 0),
  store_name    text NOT NULL,
  store_status  text NOT NULL CHECK (store_status IN ('onboarding', 'coming_soon', 'live', 'closed')),
  search_terms  text[] NOT NULL DEFAULT '{}',
  -- mirrors
  sku           text GENERATED ALWAYS AS (doc->>'sku') STORED NOT NULL,
  name_sort     text COLLATE "C" GENERATED ALWAYS AS (lower(doc->>'name')) STORED NOT NULL,
  category_id   text GENERATED ALWAYS AS (doc->>'categoryId') STORED NOT NULL REFERENCES categories(id),
  family_key    text GENERATED ALWAYS AS (doc->>'familyKey') STORED,
  price_cents   bigint GENERATED ALWAYS AS ((doc->>'priceCents')::bigint) STORED NOT NULL
                CHECK (price_cents BETWEEN 1 AND 10000000),
  active        boolean GENERATED ALWAYS AS ((doc->>'active')::boolean) STORED NOT NULL,
  featured      boolean GENERATED ALWAYS AS ((doc->>'featured')::boolean) STORED NOT NULL,
  listed        boolean GENERATED ALWAYS AS (((doc->>'active')::boolean) AND store_status = 'live') STORED NOT NULL,
  created_at    timestamptz NOT NULL,
  updated_at    timestamptz NOT NULL,
  CONSTRAINT products_id_matches_store CHECK (id LIKE store_id || '--%'),
  CONSTRAINT products_store_sku_key UNIQUE (store_id, sku)
);
-- MARKETPLACE §6.5 #1..#7
CREATE INDEX products_search_idx         ON products USING gin (search_terms) WHERE listed;                     -- #1
CREATE INDEX products_category_idx       ON products (category_id, name_sort, id) WHERE listed;                 -- #2
CREATE INDEX products_featured_idx       ON products (name_sort, id) WHERE listed AND featured;                 -- #3
CREATE INDEX products_store_listed_idx   ON products (store_id, name_sort, id) WHERE listed;                    -- #4
CREATE INDEX products_store_category_idx ON products (store_id, category_id, name_sort, id) WHERE listed;       -- #5
CREATE INDEX products_store_idx          ON products (store_id, name_sort, id);                                 -- #6
CREATE INDEX products_family_idx         ON products (family_key, price_cents, id)
                                         WHERE listed AND family_key IS NOT NULL;                               -- #7
CREATE INDEX products_listed_name_idx    ON products (name_sort, id) WHERE listed;

-- =====================================================================================
-- Accounts, sessions and tokens
-- =====================================================================================

CREATE TABLE users (
  id             text PRIMARY KEY,           -- UUIDv4, generated by the server
  email          text NOT NULL,
  -- PRIVATE authentication state
  password_hash  text,                       -- NULL until an invited user sets a password
  failed_logins  integer NOT NULL DEFAULT 0,  -- consecutive wrong passwords; diagnostics only, never blocks (§6.3.4)
  password_changed_at timestamptz,
  last_login_at  timestamptz,
  -- account columns (the old custom claims; re-read on every request)
  role           text CHECK (role IN ('admin', 'dispatcher', 'driver', 'customer', 'supplier')),  -- NULL: signed up, no profile yet
  status         text NOT NULL DEFAULT 'active' CHECK (status IN ('pending', 'active', 'suspended')),
  display_name   text NOT NULL DEFAULT '' CHECK (char_length(display_name) <= 80),
  phone_number   text CHECK (phone_number ~ '^\+1[2-9][0-9]{2}[2-9][0-9]{6}$'),
  phone_verified boolean NOT NULL DEFAULT false,
  store_id       text REFERENCES stores(id),
  store_role     text CHECK (store_role IN ('owner', 'staff')),
  city_id        text,
  doc            jsonb NOT NULL DEFAULT '{}',  -- the rest of UserProfile (see §3.3)
  capacity_class text GENERATED ALWAYS AS (doc #>> '{vehicle,capacityClass}') STORED,
  created_at     timestamptz NOT NULL,
  updated_at     timestamptz NOT NULL,
  CONSTRAINT users_supplier_store CHECK ((role IS NOT DISTINCT FROM 'supplier') = (store_id IS NOT NULL)),
  CONSTRAINT users_store_role CHECK ((store_id IS NULL) = (store_role IS NULL)),
  CONSTRAINT users_verified_phone CHECK (NOT phone_verified OR phone_number IS NOT NULL)
);
CREATE UNIQUE INDEX users_email_key ON users (lower(email));
CREATE UNIQUE INDEX users_phone_key ON users (phone_number) WHERE phone_verified;
CREATE INDEX users_role_status_idx ON users (role, status, city_id, capacity_class);                 -- MARKETPLACE §6.5 #35, #36
CREATE INDEX users_store_idx ON users (store_id, role, status) WHERE store_id IS NOT NULL;          -- MARKETPLACE §6.5 #37

CREATE TABLE sessions (
  id              text PRIMARY KEY,          -- UUIDv4; the `sid` claim of the access token
  user_id         text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  app             text NOT NULL CHECK (app IN ('customer', 'driver', 'console')),
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 8 AND 80),
  platform        text CHECK (platform IN ('ios', 'android', 'web')),   -- from the X-Client header, when sent
  app_version     text,
  device_name     text,
  user_agent      text,
  ip_hash         text,
  created_at      timestamptz NOT NULL,
  last_used_at    timestamptz NOT NULL,
  expires_at      timestamptz NOT NULL,      -- absolute end of the session
  revoked_at      timestamptz,
  revoked_reason  text CHECK (revoked_reason IN
                    ('logout', 'password_changed', 'password_reset', 'suspended', 'reuse_detected', 'removed', 'expired',
                     'admin'))
);
CREATE INDEX sessions_user_idx ON sessions (user_id, installation_id) WHERE revoked_at IS NULL;
CREATE INDEX sessions_expires_idx ON sessions (expires_at);

CREATE TABLE refresh_tokens (
  id          text PRIMARY KEY,              -- UUIDv4; the public half of the refresh token
  session_id  text NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  token_hash  text NOT NULL,                 -- hex SHA-256 of the secret half
  created_at  timestamptz NOT NULL,
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,                   -- set when the token is rotated
  replaced_by text,                          -- the newest child issued for this token
  parent_id   text,                          -- the token this one was issued for (NULL for the first token of a session)
  superseded_at timestamptz                  -- set when a sibling (same parent) was used: presenting this token is reuse
);
CREATE INDEX refresh_tokens_session_idx ON refresh_tokens (session_id);
CREATE INDEX refresh_tokens_parent_idx  ON refresh_tokens (parent_id) WHERE parent_id IS NOT NULL;
CREATE INDEX refresh_tokens_expires_idx ON refresh_tokens (expires_at);

CREATE TABLE auth_tokens (                   -- password reset codes and set-password links
  id          text PRIMARY KEY,              -- UUIDv4
  user_id     text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose     text NOT NULL CHECK (purpose IN ('password_reset', 'set_password')),
  secret_hash text NOT NULL,                 -- hex HMAC-SHA256 keyed with OTP_PEPPER
  attempts    integer NOT NULL DEFAULT 0,
  created_by  text REFERENCES users(id),
  created_at  timestamptz NOT NULL,
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz
);
CREATE UNIQUE INDEX auth_tokens_active_key ON auth_tokens (user_id, purpose) WHERE used_at IS NULL;
CREATE INDEX auth_tokens_expires_idx ON auth_tokens (expires_at);

CREATE TABLE otp_challenges (                -- phone verification, one per user
  user_id           text PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  phone_number      text NOT NULL,
  code_hash         text NOT NULL,           -- hex HMAC-SHA256 keyed with OTP_PEPPER
  attempts          integer NOT NULL DEFAULT 0,
  expires_at        timestamptz NOT NULL,
  last_sent_at      timestamptz NOT NULL,
  window_started_at timestamptz NOT NULL,
  send_count        integer NOT NULL
);
CREATE INDEX otp_challenges_expires_idx ON otp_challenges (expires_at);

-- =====================================================================================
-- Customer data
-- =====================================================================================

CREATE TABLE jobsites (
  id           text PRIMARY KEY CHECK (is_uuid4(id)),   -- client UUIDv4
  user_id      text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  doc          jsonb NOT NULL,               -- JobsiteFields
  is_default   boolean NOT NULL DEFAULT false,
  last_used_at timestamptz,                  -- written by placeOrder only
  created_at   timestamptz NOT NULL,
  updated_at   timestamptz NOT NULL
);
CREATE INDEX jobsites_user_idx ON jobsites (user_id, created_at, id);
CREATE UNIQUE INDEX jobsites_default_key ON jobsites (user_id) WHERE is_default;

CREATE TABLE cards (                         -- no column can hold a card number or CVV
  id           text PRIMARY KEY CHECK (is_uuid4(id)),   -- client UUIDv4
  user_id      text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  brand        text NOT NULL CHECK (brand IN ('visa', 'mastercard', 'amex', 'discover', 'card')),
  last4        text NOT NULL CHECK (last4 ~ '^[0-9]{4}$'),
  exp_month    smallint NOT NULL CHECK (exp_month BETWEEN 1 AND 12),
  exp_year     smallint NOT NULL CHECK (exp_year BETWEEN 2024 AND 2100),
  holder       text NOT NULL CHECK (char_length(holder) BETWEEN 1 AND 80),
  is_default   boolean NOT NULL DEFAULT false,
  provider     text NOT NULL DEFAULT 'test' CHECK (provider IN ('test', 'stripe')),
  provider_ref text,
  created_at   timestamptz NOT NULL,
  updated_at   timestamptz NOT NULL
);
CREATE INDEX cards_user_idx ON cards (user_id, created_at, id);
CREATE UNIQUE INDEX cards_default_key ON cards (user_id) WHERE is_default;

CREATE TABLE favorites (
  user_id    text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id text NOT NULL,                  -- no foreign key: a favourite may outlive the listing
  created_at timestamptz NOT NULL,
  PRIMARY KEY (user_id, product_id)
);
CREATE INDEX favorites_user_idx ON favorites (user_id, created_at DESC);

CREATE TABLE devices (                       -- push tokens, one per app install
  user_id         text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 8 AND 80),
  token           text NOT NULL CHECK (char_length(token) BETWEEN 10 AND 4096),
  provider        text NOT NULL CHECK (provider IN ('expo')),
  platform        text NOT NULL CHECK (platform IN ('ios', 'android', 'web')),
  app             text NOT NULL CHECK (app IN ('customer', 'driver', 'console')),
  app_version     text,
  device_name     text,
  created_at      timestamptz NOT NULL,
  last_seen_at    timestamptz NOT NULL,
  PRIMARY KEY (user_id, installation_id)
);
CREATE UNIQUE INDEX devices_token_key ON devices (token);

CREATE TABLE carts (                         -- P1: signed-in cart
  user_id    text PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  doc        jsonb NOT NULL,                 -- Cart without updatedAt
  updated_at timestamptz NOT NULL
);

-- =====================================================================================
-- Orders, store orders, deliveries
-- =====================================================================================

CREATE TABLE orders (
  id                  text PRIMARY KEY CHECK (is_uuid4(id)),   -- the client's checkoutId
  doc                 jsonb NOT NULL,        -- Order without id
  number              text GENERATED ALWAYS AS (doc->>'number') STORED NOT NULL UNIQUE,
  customer_id         text GENERATED ALWAYS AS (doc->>'customerId') STORED NOT NULL REFERENCES users(id),
  source              text GENERATED ALWAYS AS (doc->>'source') STORED NOT NULL
                      CHECK (source IN ('cart', 'quote', 'replacement')),
  status              text GENERATED ALWAYS AS (doc->>'status') STORED NOT NULL
                      CHECK (status IN ('placed', 'confirmed', 'preparing', 'ready', 'on_the_way', 'completed', 'cancelled')),
  needs_attention     boolean GENERATED ALWAYS AS ((doc->>'needsAttention')::boolean) STORED NOT NULL,
  jobsite_id          text GENERATED ALWAYS AS (doc #>> '{jobsite,jobsiteId}') STORED,
  payment_status      text GENERATED ALWAYS AS (doc #>> '{payment,status}') STORED NOT NULL
                      CHECK (payment_status IN ('authorized', 'capture_pending', 'captured', 'capture_failed',
                                                'partially_refunded', 'refunded', 'voided', 'not_required')),
  capture_deadline_at timestamptz GENERATED ALWAYS AS (ms_to_ts((doc #>> '{payment,captureDeadlineAt}')::bigint)) STORED,
  total_cents         bigint GENERATED ALWAYS AS ((doc #>> '{current,totalCents}')::bigint) STORED NOT NULL,
  created_at          timestamptz NOT NULL,
  updated_at          timestamptz NOT NULL
);
CREATE INDEX orders_customer_idx        ON orders (customer_id, created_at DESC, id DESC);                    -- MARKETPLACE §6.5 #14
CREATE INDEX orders_customer_active_idx ON orders (customer_id, created_at DESC, id DESC)
                                        WHERE status NOT IN ('completed', 'cancelled');                       -- #15
CREATE INDEX orders_status_idx          ON orders (status, created_at DESC, id DESC);                         -- #16
CREATE INDEX orders_capture_sweep_idx   ON orders (payment_status, capture_deadline_at)
                                        WHERE payment_status IN ('authorized', 'capture_pending', 'capture_failed'); -- #17
CREATE INDEX orders_attention_idx       ON orders (created_at DESC, id DESC) WHERE needs_attention;           -- #18
CREATE INDEX orders_created_idx         ON orders (created_at DESC, id DESC);

CREATE TABLE store_orders (
  id             text PRIMARY KEY,           -- `${orderId}-${letter}`
  doc            jsonb NOT NULL,             -- StoreOrder without id
  meta           jsonb NOT NULL,             -- PRIVATE: StoreOrderPrivateMeta
  order_id       text GENERATED ALWAYS AS (doc->>'orderId') STORED NOT NULL REFERENCES orders(id),
  store_id       text GENERATED ALWAYS AS (doc->>'storeId') STORED NOT NULL REFERENCES stores(id),
  customer_id    text GENERATED ALWAYS AS (doc->>'customerId') STORED NOT NULL REFERENCES users(id),
  number         text GENERATED ALWAYS AS (doc->>'number') STORED NOT NULL UNIQUE,
  status         text GENERATED ALWAYS AS (doc->>'status') STORED NOT NULL
                 CHECK (status IN ('new', 'accepted', 'preparing', 'ready', 'out_for_delivery', 'delivered',
                                   'picked_up', 'failed', 'rejected', 'cancelled')),
  fulfilment     text GENERATED ALWAYS AS (doc->>'fulfilment') STORED NOT NULL
                 CHECK (fulfilment IN ('delivery', 'pickup')),
  version        integer GENERATED ALWAYS AS ((doc->>'version')::integer) STORED NOT NULL,
  delivery_id    text GENERATED ALWAYS AS (doc->>'deliveryId') STORED,
  respond_by     timestamptz GENERATED ALWAYS AS (ms_to_ts((doc #>> '{timing,respondBy}')::bigint)) STORED NOT NULL,
  ready_by       timestamptz GENERATED ALWAYS AS (ms_to_ts((doc #>> '{timing,readyBy}')::bigint)) STORED NOT NULL,
  ready_by_date  text GENERATED ALWAYS AS (doc #>> '{timing,readyByDate}') STORED NOT NULL,
  hold_until     timestamptz GENERATED ALWAYS AS (ms_to_ts((doc #>> '{pickup,holdUntil}')::bigint)) STORED,
  completed_at   timestamptz GENERATED ALWAYS AS (ms_to_ts((doc->>'completedAt')::bigint)) STORED,
  accept_overdue boolean GENERATED ALWAYS AS ((doc->>'acceptOverdue')::boolean) STORED NOT NULL,
  reminder_sent  boolean GENERATED ALWAYS AS ((doc->>'reminderSentAt') IS NOT NULL) STORED NOT NULL,
  created_at     timestamptz NOT NULL,
  updated_at     timestamptz NOT NULL,
  CONSTRAINT store_orders_id_matches_order CHECK (id ~ '-[A-E]$' AND left(id, -2) = order_id)
);
CREATE INDEX store_orders_board_idx     ON store_orders (store_id, status, ready_by, id);                     -- MARKETPLACE §6.5 #8
CREATE INDEX store_orders_store_idx     ON store_orders (store_id, created_at DESC, id DESC);                 -- #9
CREATE INDEX store_orders_completed_idx ON store_orders (store_id, completed_at DESC, id DESC)
                                        WHERE completed_at IS NOT NULL;                                       -- #10
CREATE INDEX store_orders_respond_idx   ON store_orders (respond_by) WHERE status = 'new';                    -- #11
CREATE INDEX store_orders_hold_idx      ON store_orders (hold_until)
                                        WHERE fulfilment = 'pickup' AND status = 'ready';                     -- #12
CREATE INDEX store_orders_status_idx    ON store_orders (status, created_at DESC, id DESC);                   -- #13
CREATE INDEX store_orders_order_idx     ON store_orders (order_id);
CREATE INDEX store_orders_created_idx   ON store_orders (created_at DESC, id DESC);

CREATE TABLE store_reviews (
  id             text PRIMARY KEY,           -- the storeOrderId (seed rows: `seed-${storeId}-${n}`)
  store_id       text NOT NULL REFERENCES stores(id),
  store_order_id text REFERENCES store_orders(id),   -- NULL for seed rows
  customer_id    text NOT NULL,
  author_name    text NOT NULL CHECK (char_length(author_name) BETWEEN 1 AND 40),
  rating         smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  text           text NOT NULL DEFAULT '' CHECK (char_length(text) <= 1000),
  created_at     timestamptz NOT NULL,
  updated_at     timestamptz NOT NULL
);
CREATE INDEX store_reviews_store_idx ON store_reviews (store_id, updated_at DESC, id DESC);

CREATE TABLE deliveries (
  id              text PRIMARY KEY,          -- UUIDv4, generated by the server
  doc             jsonb NOT NULL,            -- Delivery without id
  meta            jsonb NOT NULL,            -- PRIVATE: DeliveryPrivateMeta + codeAttempts + trackingLinkSentAt
  order_ref       text GENERATED ALWAYS AS (doc->>'orderId') STORED NOT NULL,   -- IS-10042-A or IS-10043
  kind            text GENERATED ALWAYS AS (doc->>'kind') STORED NOT NULL CHECK (kind IN ('marketplace', 'manual')),
  status          text GENERATED ALWAYS AS (doc->>'status') STORED NOT NULL
                  CHECK (status IN ('unassigned', 'assigned', 'accepted', 'picked_up', 'in_transit', 'arrived',
                                    'delivered', 'failed', 'cancelled')),
  driver_id       text GENERATED ALWAYS AS (doc->>'driverId') STORED REFERENCES users(id),
  customer_id     text GENERATED ALWAYS AS (doc->>'customerId') STORED REFERENCES users(id),
  source_order_id text GENERATED ALWAYS AS (doc->>'sourceOrderId') STORED REFERENCES orders(id),
  store_order_id  text GENERATED ALWAYS AS (doc->>'storeOrderId') STORED REFERENCES store_orders(id),
  store_id        text GENERATED ALWAYS AS (doc->>'storeId') STORED REFERENCES stores(id),
  offer_status    text GENERATED ALWAYS AS (doc->>'offerStatus') STORED
                  CHECK (offer_status IN ('held', 'scheduled', 'open', 'claimed', 'withdrawn')),
  unload_status   text GENERATED ALWAYS AS (doc #>> '{unload,status}') STORED,
  delivered_at    timestamptz GENERATED ALWAYS AS (ms_to_ts((doc->>'deliveredAt')::bigint)) STORED,
  tracking_token  text GENERATED ALWAYS AS (meta->>'trackingToken') STORED NOT NULL UNIQUE,
  created_at      timestamptz NOT NULL,
  updated_at      timestamptz NOT NULL
);
-- the six delivery indexes of the old firestore.indexes.json
CREATE INDEX deliveries_driver_status_idx    ON deliveries (driver_id, status, updated_at DESC, id DESC);
CREATE INDEX deliveries_driver_delivered_idx ON deliveries (driver_id, delivered_at) WHERE status = 'delivered';
CREATE INDEX deliveries_driver_created_idx   ON deliveries (driver_id, created_at DESC, id DESC);
CREATE INDEX deliveries_status_created_idx   ON deliveries (status, created_at DESC, id DESC);
CREATE INDEX deliveries_status_updated_idx   ON deliveries (status, updated_at DESC, id DESC);
CREATE INDEX deliveries_created_idx          ON deliveries (created_at DESC, id DESC);
CREATE UNIQUE INDEX deliveries_store_order_key ON deliveries (store_order_id) WHERE store_order_id IS NOT NULL;
CREATE INDEX deliveries_source_order_idx     ON deliveries (source_order_id) WHERE source_order_id IS NOT NULL;
CREATE INDEX deliveries_labourer_idx         ON deliveries (created_at) WHERE unload_status = 'needed';

CREATE TABLE delivery_events (               -- append-only audit trail
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  delivery_id text NOT NULL REFERENCES deliveries(id) ON DELETE CASCADE,
  at          timestamptz NOT NULL,
  doc         jsonb NOT NULL                 -- DeliveryEvent without id, deliveryId, at
);
CREATE INDEX delivery_events_delivery_idx ON delivery_events (delivery_id, id DESC);

CREATE TABLE job_offers (                    -- exists only while its delivery is unassigned and offered
  delivery_id text PRIMARY KEY REFERENCES deliveries(id) ON DELETE CASCADE,
  doc         jsonb NOT NULL,                -- JobOffer without deliveryId
  status      text GENERATED ALWAYS AS (doc->>'status') STORED NOT NULL CHECK (status IN ('scheduled', 'open')),
  audience    text[] GENERATED ALWAYS AS (jsonb_text_array(doc->'audience')) STORED NOT NULL,
  opens_at    timestamptz GENERATED ALWAYS AS (ms_to_ts((doc->>'opensAt')::bigint)) STORED NOT NULL,
  opened_at   timestamptz GENERATED ALWAYS AS (ms_to_ts((doc->>'openedAt')::bigint)) STORED,
  nudged      boolean GENERATED ALWAYS AS ((doc->>'nudgedAt') IS NOT NULL) STORED NOT NULL,
  created_at  timestamptz NOT NULL,
  updated_at  timestamptz NOT NULL
);
CREATE INDEX job_offers_audience_idx ON job_offers USING gin (audience) WHERE status = 'open';               -- MARKETPLACE §6.5 #19
CREATE INDEX job_offers_opens_idx    ON job_offers (status, opens_at);                                       -- #20
CREATE INDEX job_offers_nudge_idx    ON job_offers (opened_at) WHERE status = 'open' AND NOT nudged;          -- #21

CREATE TABLE tracking (                      -- public tracking view, read by token only
  token           text PRIMARY KEY,
  delivery_id     text NOT NULL UNIQUE REFERENCES deliveries(id) ON DELETE CASCADE,
  doc             jsonb NOT NULL,            -- PublicTracking without updatedAt
  eta_computed_at timestamptz,               -- PRIVATE: last provider ETA
  updated_at      timestamptz NOT NULL
);

CREATE TABLE routes (
  driver_id   text PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  doc         jsonb NOT NULL,                -- RoutePlan without driverId, computedAt
  signature   text,                          -- PRIVATE: hash of the planning inputs
  leased_at   timestamptz,                   -- PRIVATE
  computed_at timestamptz NOT NULL
);

CREATE TABLE driver_locations (
  driver_id  text PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  lat        double precision NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lng        double precision NOT NULL CHECK (lng BETWEEN -180 AND 180),
  heading    real,
  speed      real,
  accuracy   real,
  battery    real,
  online     boolean NOT NULL,
  synced_lat double precision,               -- PRIVATE: position at the last tracking sync
  synced_lng double precision,
  synced_at  timestamptz,
  updated_at timestamptz NOT NULL
);
CREATE INDEX driver_locations_online_idx ON driver_locations (updated_at) WHERE online;

-- =====================================================================================
-- Chat and support
-- =====================================================================================

CREATE TABLE chat_threads (                  -- dispatch <-> driver, one per driver
  driver_id        text PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  driver_name      text NOT NULL,
  last_message     jsonb,
  unread_by_driver integer NOT NULL DEFAULT 0 CHECK (unread_by_driver >= 0),
  unread_by_staff  integer NOT NULL DEFAULT 0 CHECK (unread_by_staff >= 0),
  driver_read_at   timestamptz,
  staff_read_at    timestamptz,
  created_at       timestamptz NOT NULL,
  updated_at       timestamptz NOT NULL
);
CREATE INDEX chat_threads_updated_idx ON chat_threads (updated_at DESC, driver_id DESC);

CREATE TABLE chat_messages (
  id          text PRIMARY KEY CHECK (is_uuid4(id)),    -- client UUIDv4
  thread_id   text NOT NULL REFERENCES chat_threads(driver_id) ON DELETE CASCADE,
  seq         bigint GENERATED ALWAYS AS IDENTITY,
  sender_id   text NOT NULL REFERENCES users(id),
  sender_name text NOT NULL CHECK (char_length(sender_name) BETWEEN 1 AND 80),
  sender_role text NOT NULL CHECK (sender_role IN ('driver', 'staff')),
  text        text NOT NULL CHECK (char_length(text) BETWEEN 1 AND 1000),
  delivery_id text,
  kind        text NOT NULL CHECK (kind IN ('text', 'quick_reply')),
  created_at  timestamptz NOT NULL
);
CREATE INDEX chat_messages_thread_idx ON chat_messages (thread_id, seq DESC);

CREATE TABLE support_threads (
  id              text PRIMARY KEY,          -- the customer's uid, or `store_${storeId}`
  kind            text NOT NULL CHECK (kind IN ('customer', 'store')),
  owner_id        text NOT NULL,             -- uid or storeId
  owner_name      text NOT NULL,
  company_name    text,
  status          text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  assigned_to     text REFERENCES users(id),
  assigned_name   text,
  context         jsonb,
  last_message    jsonb,
  unread_by_owner integer NOT NULL DEFAULT 0 CHECK (unread_by_owner >= 0),
  unread_by_staff integer NOT NULL DEFAULT 0 CHECK (unread_by_staff >= 0),
  owner_read_at   timestamptz,
  staff_read_at   timestamptz,
  created_at      timestamptz NOT NULL,
  updated_at      timestamptz NOT NULL,
  CONSTRAINT support_threads_id_matches_owner
    CHECK ((kind = 'customer' AND id = owner_id) OR (kind = 'store' AND id = 'store_' || owner_id))
);
CREATE INDEX support_threads_kind_idx   ON support_threads (kind, updated_at DESC, id DESC);                  -- MARKETPLACE §6.5 #29
CREATE INDEX support_threads_status_idx ON support_threads (status, updated_at DESC, id DESC);                -- #30

CREATE TABLE support_messages (
  id          text PRIMARY KEY CHECK (is_uuid4(id)),    -- client UUIDv4
  thread_id   text NOT NULL REFERENCES support_threads(id) ON DELETE CASCADE,
  seq         bigint GENERATED ALWAYS AS IDENTITY,
  sender_id   text NOT NULL REFERENCES users(id),
  sender_name text NOT NULL CHECK (char_length(sender_name) BETWEEN 1 AND 80),
  sender_role text NOT NULL CHECK (sender_role IN ('customer', 'supplier', 'staff')),
  text        text NOT NULL CHECK (char_length(text) BETWEEN 1 AND 1000),
  context     jsonb,
  created_at  timestamptz NOT NULL
);
CREATE INDEX support_messages_thread_idx ON support_messages (thread_id, seq DESC);

-- =====================================================================================
-- Quotes and issues
-- =====================================================================================

CREATE TABLE quotes (
  id                text PRIMARY KEY CHECK (is_uuid4(id)),   -- the client's requestId
  doc               jsonb NOT NULL,          -- Quote without id
  workspace         jsonb,                   -- PRIVATE: quote-builder draft and internal note
  number            text GENERATED ALWAYS AS (doc->>'number') STORED NOT NULL UNIQUE,
  customer_id       text GENERATED ALWAYS AS (doc->>'customerId') STORED NOT NULL REFERENCES users(id),
  status            text GENERATED ALWAYS AS (doc->>'status') STORED NOT NULL
                    CHECK (status IN ('submitted', 'in_review', 'quoted', 'accepted', 'declined', 'expired', 'cancelled')),
  respond_by        timestamptz GENERATED ALWAYS AS (ms_to_ts((doc->>'respondBy')::bigint)) STORED NOT NULL,
  offer_valid_until timestamptz GENERATED ALWAYS AS (ms_to_ts((doc->>'offerValidUntil')::bigint)) STORED,
  assigned_to       text GENERATED ALWAYS AS (doc->>'assignedTo') STORED,
  order_id          text GENERATED ALWAYS AS (doc->>'orderId') STORED,
  created_at        timestamptz NOT NULL,
  updated_at        timestamptz NOT NULL
);
CREATE INDEX quotes_customer_idx ON quotes (customer_id, created_at DESC, id DESC);                           -- MARKETPLACE §6.5 #22
CREATE INDEX quotes_sla_idx      ON quotes (status, respond_by, id);                                          -- #23
CREATE INDEX quotes_status_idx   ON quotes (status, created_at DESC, id DESC);                                -- #24
CREATE INDEX quotes_expiry_idx   ON quotes (offer_valid_until) WHERE status = 'quoted';                       -- #25
CREATE INDEX quotes_created_idx  ON quotes (created_at DESC, id DESC);

CREATE TABLE issues (
  id             text PRIMARY KEY CHECK (is_uuid4(id)),      -- the client's issueId
  doc            jsonb NOT NULL,             -- Issue without id
  notes          jsonb,                      -- PRIVATE: internal notes
  number         text GENERATED ALWAYS AS (doc->>'number') STORED NOT NULL UNIQUE,
  customer_id    text GENERATED ALWAYS AS (doc->>'customerId') STORED NOT NULL REFERENCES users(id),
  store_id       text GENERATED ALWAYS AS (doc->>'storeId') STORED NOT NULL REFERENCES stores(id),
  order_id       text GENERATED ALWAYS AS (doc->>'orderId') STORED NOT NULL REFERENCES orders(id),
  store_order_id text GENERATED ALWAYS AS (doc->>'storeOrderId') STORED NOT NULL REFERENCES store_orders(id),
  status         text GENERATED ALWAYS AS (doc->>'status') STORED NOT NULL
                 CHECK (status IN ('open', 'in_review', 'resolved')),
  sla_due_at     timestamptz GENERATED ALWAYS AS (ms_to_ts((doc->>'slaDueAt')::bigint)) STORED NOT NULL,
  assigned_to    text GENERATED ALWAYS AS (doc->>'assignedTo') STORED,
  created_at     timestamptz NOT NULL,
  updated_at     timestamptz NOT NULL
);
CREATE UNIQUE INDEX issues_open_key ON issues (store_order_id) WHERE status <> 'resolved';   -- ISSUE_ALREADY_OPEN
CREATE INDEX issues_customer_idx ON issues (customer_id, created_at DESC, id DESC);                           -- MARKETPLACE §6.5 #26
CREATE INDEX issues_store_idx    ON issues (store_id, created_at DESC, id DESC);                              -- #27
CREATE INDEX issues_status_idx   ON issues (status, created_at DESC, id DESC);                                -- #28
CREATE INDEX issues_order_idx    ON issues (order_id);
CREATE INDEX issues_created_idx  ON issues (created_at DESC, id DESC);

-- =====================================================================================
-- Money: payment journal, ledger, payouts
-- =====================================================================================

CREATE TABLE payment_authorizations (        -- journal of card holds, so that none is orphaned
  order_id       text PRIMARY KEY CHECK (is_uuid4(order_id)),
  customer_id    text NOT NULL REFERENCES users(id),
  amount_cents   bigint NOT NULL CHECK (amount_cents >= 0),
  card           jsonb NOT NULL,             -- { cardId, brand, last4 }
  provider       text NOT NULL CHECK (provider IN ('test', 'stripe')),
  status         text NOT NULL CHECK (status IN ('pending', 'authorized', 'declined', 'attached',
                                                 'void_pending', 'voided', 'captured')),
  attempt        integer NOT NULL DEFAULT 1 CHECK (attempt >= 1),   -- part of the gateway idempotency key after a retry
  intent_ref     text,
  capture_before timestamptz,
  decline_reason text,
  capture_breakdown jsonb,                   -- { storeOrderId: cents } fixed by Finalize step 1 together with pendingCaptureCents (§10.4)
  created_at     timestamptz NOT NULL,
  updated_at     timestamptz NOT NULL
);
CREATE INDEX payment_authorizations_open_idx ON payment_authorizations (updated_at)
  WHERE status IN ('pending', 'authorized', 'void_pending');

CREATE TABLE payouts (
  id            text PRIMARY KEY,            -- `${payeeType}_${payeeId}_${runKey}`
  payee_type    text NOT NULL CHECK (payee_type IN ('store', 'driver')),
  payee_id      text NOT NULL,
  payee_name    text NOT NULL,
  run_key       text NOT NULL CHECK (run_key ~ '^[0-9]{8}-[0-9]{4}$'),
  period_date   text NOT NULL CHECK (period_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  entry_ids     text[] NOT NULL,
  entry_count   integer NOT NULL,
  credits_cents bigint NOT NULL,
  debits_cents  bigint NOT NULL,
  net_cents     bigint NOT NULL CHECK (net_cents > 0),
  status        text NOT NULL CHECK (status IN ('pending', 'paid', 'failed')),
  provider      text NOT NULL CHECK (provider IN ('test', 'stripe')),
  reference     text,
  created_at    timestamptz NOT NULL,
  paid_at       timestamptz
);
CREATE INDEX payouts_payee_idx   ON payouts (payee_type, payee_id, created_at DESC, id DESC);                 -- MARKETPLACE §6.5 #33
CREATE INDEX payouts_pending_idx ON payouts (created_at) WHERE status = 'pending';
CREATE INDEX payouts_created_idx ON payouts (created_at DESC, id DESC);

CREATE TABLE ledger_entries (                -- append-only; only payout_id and held_for_issue_id change
  id                text PRIMARY KEY,        -- deterministic: sale_{storeOrderId}, delivery_{deliveryId}_{attempt}, ...
  payee_type        text NOT NULL CHECK (payee_type IN ('store', 'driver')),
  payee_id          text NOT NULL,
  kind              text NOT NULL CHECK (kind IN ('sale', 'commission', 'delivery', 'failed_attempt',
                                                  'cancellation', 'clawback', 'adjustment')),
  amount_cents      bigint NOT NULL,         -- signed
  order_id          text,
  store_order_id    text,
  delivery_id       text,
  issue_id          text,
  description       text NOT NULL,
  payout_id         text REFERENCES payouts(id),
  held_for_issue_id text,
  created_at        timestamptz NOT NULL
);
CREATE INDEX ledger_payee_idx       ON ledger_entries (payee_type, payee_id, created_at DESC, id DESC);       -- MARKETPLACE §6.5 #31
CREATE INDEX ledger_unpaid_idx      ON ledger_entries (payee_type, payee_id, created_at)
                                    WHERE payout_id IS NULL;                                                  -- #32
CREATE INDEX ledger_payout_idx      ON ledger_entries (payout_id) WHERE payout_id IS NOT NULL;
CREATE INDEX ledger_store_order_idx ON ledger_entries (store_order_id) WHERE store_order_id IS NOT NULL;
CREATE INDEX ledger_held_idx        ON ledger_entries (held_for_issue_id) WHERE held_for_issue_id IS NOT NULL;  -- resolveIssue releases holds

-- =====================================================================================
-- Suggestions, notifications, files
-- =====================================================================================

CREATE TABLE store_suggestions (
  id           text PRIMARY KEY,             -- UUIDv4, generated by the server
  store_name   text NOT NULL CHECK (char_length(store_name) BETWEEN 2 AND 80),
  city         text NOT NULL CHECK (char_length(city) BETWEEN 2 AND 60),
  interests    text[] NOT NULL DEFAULT '{}',
  email        text,
  suggested_by text REFERENCES users(id),
  source       text NOT NULL CHECK (source IN ('app', 'web')),
  status       text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'onboarding', 'dismissed')),
  created_at   timestamptz NOT NULL,
  updated_at   timestamptz NOT NULL
);
CREATE INDEX store_suggestions_status_idx ON store_suggestions (status, created_at DESC, id DESC);            -- MARKETPLACE §6.5 #34

CREATE TABLE notifications (                 -- the in-app inbox
  id           text PRIMARY KEY,             -- UUIDv4, generated by the server
  user_id      text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  dedupe_key   text,                         -- idempotency key of the producer
  type         text NOT NULL,
  title        text NOT NULL CHECK (char_length(title) <= 120),
  body         text NOT NULL CHECK (char_length(body) <= 500),
  data         jsonb NOT NULL DEFAULT '{}',
  read         boolean NOT NULL DEFAULT false,
  read_at      timestamptz,
  push_status  text NOT NULL CHECK (push_status IN ('pending', 'sent', 'partial', 'failed', 'no_devices', 'skipped')),
  push_success integer NOT NULL DEFAULT 0,
  push_failure integer NOT NULL DEFAULT 0,
  push_sent_at timestamptz,
  created_at   timestamptz NOT NULL
);
CREATE UNIQUE INDEX notifications_dedupe_key ON notifications (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE INDEX notifications_user_idx   ON notifications (user_id, created_at DESC, id DESC);
CREATE INDEX notifications_unread_idx ON notifications (user_id) WHERE NOT read;

CREATE TABLE push_tickets (                  -- Expo push tickets waiting for their receipt
  ticket_id       text PRIMARY KEY,
  notification_id text NOT NULL,
  user_id         text NOT NULL,
  token           text NOT NULL,
  created_at      timestamptz NOT NULL,
  check_after     timestamptz NOT NULL
);
CREATE INDEX push_tickets_check_idx ON push_tickets (check_after);

CREATE TABLE files (
  id            text PRIMARY KEY,            -- UUIDv4, generated by the server: the uploadId
  path          text NOT NULL UNIQUE,        -- final storage key, prefixes of MARKETPLACE §6.4; written only by the server (confirm copies here)
  upload_key    text NOT NULL UNIQUE,        -- `uploads/{id}`: the only key a presigned form can write; deleted after confirm
  purpose       text NOT NULL CHECK (purpose IN ('proof', 'quote_upload', 'issue_photo', 'store_photo',
                                                 'product_photo', 'avatar')),
  uploaded_by   text NOT NULL REFERENCES users(id),
  scope_id      text NOT NULL,               -- the request's ownerId: deliveryId | requestId | issueId | storeId | uid
  content_type  text NOT NULL,
  size_bytes    bigint CHECK (size_bytes > 0),
  max_bytes     bigint NOT NULL,
  original_name text,
  status        text NOT NULL CHECK (status IN ('pending', 'ready')),
  created_at    timestamptz NOT NULL,
  completed_at  timestamptz
);
CREATE INDEX files_scope_idx   ON files (purpose, scope_id);
CREATE INDEX files_uploader_idx ON files (uploaded_by, created_at DESC);
CREATE INDEX files_pending_idx ON files (created_at) WHERE status = 'pending';

-- =====================================================================================
-- Platform tables
-- =====================================================================================

CREATE TABLE dev_outbox (                    -- every SMS and email the system sent or stored
  id           text PRIMARY KEY,             -- UUIDv4
  channel      text NOT NULL CHECK (channel IN ('sms', 'email')),
  to_address   text NOT NULL,
  subject      text,
  body         text,                         -- NULL when redacted (sensitive message sent by a real provider)
  purpose      text NOT NULL CHECK (purpose IN ('otp', 'tracking_link', 'store_alert', 'other',
                                                'password_reset', 'invite')),
  provider     text NOT NULL CHECK (provider IN ('outbox', 'twilio', 'resend', 'smtp')),
  status       text NOT NULL CHECK (status IN ('stored', 'sent', 'failed')),
  provider_ref text,
  error        text,
  sensitive    boolean NOT NULL DEFAULT false,   -- admin-only rows
  created_at   timestamptz NOT NULL,
  expires_at   timestamptz NOT NULL
);
CREATE INDEX dev_outbox_created_idx ON dev_outbox (created_at DESC, id DESC);
CREATE INDEX dev_outbox_expires_idx ON dev_outbox (expires_at);

CREATE TABLE rate_limits (                   -- fixed-window counters
  bucket       text NOT NULL,
  subject      text NOT NULL,
  count        integer NOT NULL,
  window_start timestamptz NOT NULL,
  expires_at   timestamptz NOT NULL,
  PRIMARY KEY (bucket, subject)
);
CREATE INDEX rate_limits_expires_idx ON rate_limits (expires_at);

CREATE TABLE outbox (                        -- transactional outbox for network side effects
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event        text NOT NULL,
  payload      jsonb NOT NULL DEFAULT '{}',
  dedupe_key   text,
  status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'done', 'dead')),
  attempts     integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 8,
  run_at       timestamptz NOT NULL,
  locked_at    timestamptz,
  locked_by    text,
  last_error   text,
  created_at   timestamptz NOT NULL,
  finished_at  timestamptz
);
CREATE UNIQUE INDEX outbox_dedupe_key   ON outbox (dedupe_key) WHERE dedupe_key IS NOT NULL AND status = 'pending';
CREATE INDEX outbox_due_idx             ON outbox (run_at, id) WHERE status = 'pending';
CREATE INDEX outbox_processing_idx      ON outbox (locked_at) WHERE status = 'processing';
CREATE INDEX outbox_finished_idx        ON outbox (finished_at) WHERE status IN ('done', 'dead');
CREATE INDEX outbox_refund_open_idx     ON outbox ((payload->>'storeOrderId'))
                                        WHERE event = 'payment.refund' AND status IN ('pending', 'processing');  -- §9.2.12

CREATE TABLE scheduler_state (               -- one row per scheduled job
  job              text PRIMARY KEY,
  next_run_at      timestamptz NOT NULL,
  last_started_at  timestamptz,
  last_finished_at timestamptz,
  last_status      text CHECK (last_status IN ('ok', 'error')),
  last_error       text,
  last_result      jsonb
);

CREATE TABLE geocode_cache (
  query_key  text PRIMARY KEY,               -- hex SHA-256 of provider + normalized query + rounded bias point
  provider   text NOT NULL,
  results    jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE INDEX geocode_cache_expires_idx ON geocode_cache (expires_at);
