-- Deliberately wrong: the TypeScript in wrongResult.ts returns 3 for 'free'.
CREATE SCHEMA IF NOT EXISTS app;

CREATE FUNCTION app.wrong_limit(plan text) RETURNS integer
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF plan = 'free' THEN
    RETURN 4;
  END IF;
  RETURN 1000;
END;
$$;
