-- Runs after 01_functions.sql, which `npm run db` generates from functions/*.ts:
-- the domain app.plan and the functions app.todo_limit() and app.can_add_todo().

CREATE SCHEMA api;

CREATE TABLE api.users (
  id   integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name text NOT NULL,
  plan app.plan NOT NULL
);

CREATE TABLE api.todos (
  id      integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id integer NOT NULL REFERENCES api.users,
  title   text NOT NULL
);

-- The rule the page uses to grey out its button, enforced where no client can skip it.
-- The trigger gathers what the function needs; the function decides.
CREATE SCHEMA internal;

CREATE FUNCTION internal.enforce_todo_limit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  user_plan app.plan;
  current_count integer;
BEGIN
  -- Lock the user: two concurrent inserts must not both see room for one more.
  SELECT plan INTO user_plan FROM api.users WHERE id = NEW.user_id FOR UPDATE;
  SELECT count(*)::integer INTO current_count FROM api.todos WHERE user_id = NEW.user_id;
  IF NOT app.can_add_todo(user_plan, current_count) THEN
    RAISE EXCEPTION 'The % plan allows % todos.', user_plan, app.todo_limit(user_plan)
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER todos_limit BEFORE INSERT ON api.todos
  FOR EACH ROW EXECUTE FUNCTION internal.enforce_todo_limit();

-- PostGraphile connects as `postgraphile` and exposes the `api` schema, with what this role may do.
CREATE ROLE postgraphile LOGIN PASSWORD 'secret';
GRANT USAGE ON SCHEMA api, app TO postgraphile;
GRANT SELECT ON api.users TO postgraphile;
GRANT SELECT, INSERT (user_id, title) ON api.todos TO postgraphile;

INSERT INTO api.users (name, plan) VALUES ('Ada', 'free'), ('Grace', 'pro');
