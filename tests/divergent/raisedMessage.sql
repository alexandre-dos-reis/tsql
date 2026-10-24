-- Deliberately wrong: the TypeScript in raisedMessage.ts raises "plan is unknown".
CREATE SCHEMA IF NOT EXISTS app;

CREATE FUNCTION app.plan_check(plan text) RETURNS integer
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF plan = 'pro' THEN
    RAISE EXCEPTION '%', 'unknown plan';
  END IF;
  RETURN 1;
END;
$$;
