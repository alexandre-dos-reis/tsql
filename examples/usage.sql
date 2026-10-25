-- Using the compiled functions from SQL: a CHECK constraint, a generated column and a trigger.
--
-- Hand-written, not generated: this is the application's side, which tsql leaves to you. CI runs it
-- against PostgreSQL after examples/output.sql, and every assertion below raises if it fails:
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 --single-transaction -f examples/output.sql -f examples/usage.sql

-- 1. A CHECK constraint: a condition on one row. The generated functions are IMMUTABLE, which is what
--    PostgreSQL requires of a function in a constraint, a generated column or an index expression.

CREATE TABLE products (
  sku text PRIMARY KEY CHECK (app.is_not_empty(sku)),
  list_cents integer NOT NULL,
  percent_off double precision,
  -- 2. A generated column: computed by the function on every write, stored with the row.
  price_cents double precision GENERATED ALWAYS AS (app.price_cents(list_cents, percent_off)) STORED
);

INSERT INTO products (sku, list_cents, percent_off) VALUES ('mug', 1000, 25), ('pen', 300, NULL);

DO $$
BEGIN
  IF (SELECT price_cents FROM products WHERE sku = 'mug') IS DISTINCT FROM 750 THEN
    RAISE EXCEPTION 'mug should cost 750 cents after 25%% off';
  END IF;
  IF (SELECT price_cents FROM products WHERE sku = 'pen') IS DISTINCT FROM 300 THEN
    RAISE EXCEPTION 'pen has no discount and should cost 300 cents';
  END IF;
END
$$;

DO $$
BEGIN
  INSERT INTO products (sku, list_cents) VALUES ('', 100);
  RAISE EXCEPTION 'an empty sku should have been refused by the CHECK constraint';
EXCEPTION WHEN check_violation THEN
  NULL;
END
$$;

-- 3. A trigger: a condition involving other rows. The trigger gathers the data — the plan, the count — and
--    the compiled function decides. Concurrency is the trigger's job, not the function's.

-- The plan column has the functions' own type: `type Plan = "free" | "pro" | "enterprise"` is the domain
-- app.plan, so a plan the functions do not know is refused on the way in.
CREATE TABLE users (
  id bigint PRIMARY KEY,
  plan app.plan NOT NULL
);

CREATE TABLE todos (
  id bigserial PRIMARY KEY,
  user_id bigint NOT NULL REFERENCES users (id),
  title text NOT NULL
);

CREATE FUNCTION enforce_todo_limit() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  sub app.subscription;
  current_count integer;
BEGIN
  -- Lock the user: two concurrent inserts must not both count 2 todos and both pass a limit of 3.
  SELECT plan INTO sub FROM users WHERE id = NEW.user_id FOR UPDATE;

  -- count(*) is a bigint; the function takes an integer.
  SELECT count(*)::integer INTO current_count FROM todos WHERE user_id = NEW.user_id;

  IF NOT app.can_create_todo(sub, current_count) THEN
    RAISE EXCEPTION 'todo limit reached: % allows %', sub.plan, app.todo_limit(sub.plan)
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER todos_enforce_limit
  BEFORE INSERT ON todos
  FOR EACH ROW EXECUTE FUNCTION enforce_todo_limit();

INSERT INTO users (id, plan) VALUES (1, 'free'), (2, 'pro');

DO $$
BEGIN
  INSERT INTO users (id, plan) VALUES (3, 'gratuit');
  RAISE EXCEPTION 'a plan the functions do not know should have been refused by the app.plan domain';
EXCEPTION WHEN check_violation THEN
  NULL;
END
$$;
INSERT INTO todos (user_id, title) VALUES (1, 'one'), (1, 'two'), (1, 'three'), (2, 'one');

DO $$
BEGIN
  INSERT INTO todos (user_id, title) VALUES (1, 'four');
  RAISE EXCEPTION 'a fourth todo on the free plan should have been refused';
EXCEPTION WHEN check_violation THEN
  NULL;
END
$$;

-- The pro plan allows more, so the same insert passes for user 2.
INSERT INTO todos (user_id, title) VALUES (2, 'two'), (2, 'three'), (2, 'four');

-- A function taking an object is called with ROW(…)::type, its fields in declaration order; one
-- returning an object is read with (fn(…)).field. Here, straight from a query, row by row:
DO $$
BEGIN
  IF (SELECT array_agg(app.can_create_todo(ROW(u.plan)::app.subscription, 3) ORDER BY u.id) FROM users u)
     IS DISTINCT FROM ARRAY[false, true] THEN
    RAISE EXCEPTION 'with 3 todos, free should be full and pro should not';
  END IF;
END
$$;
