import { int, type Integer } from "../../src/index";

/**
 * A field named after a reserved word is quoted where SQL reads it — `"limit" integer` in
 * `CREATE TYPE`, `(quota)."limit"` in a function — but the type guard compares it unquoted, as the
 * catalogue stores it. Were it compared quoted, applying the migration a second time would raise.
 */

export interface Quota {
  readonly limit: Integer;
  readonly used: Integer;
}

export function remainingQuota(quota: Quota): Integer {
  return int(quota.limit - quota.used);
}
