/**
 * TypeScript identifiers are camelCase; PostgreSQL folds unquoted identifiers
 * to lower case. Mapping to snake_case keeps generated SQL idiomatic and
 * avoids needing quoted identifiers everywhere.
 */
export function toSnakeCase(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .toLowerCase();
}

/**
 * Reserved words that cannot be used unquoted as a PL/pgSQL identifier.
 * Deliberately short: it only needs the words that are actually unusable, and
 * anything missing surfaces immediately as a syntax error from PostgreSQL.
 */
// A wrapped word list reads better than 77 one-word lines.
// prettier-ignore
const RESERVED = new Set([
  "all", "analyse", "analyze", "and", "any", "array", "as", "asc", "asymmetric", "both", "case",
  "cast", "check", "collate", "column", "constraint", "create", "current_catalog", "current_date",
  "current_role", "current_time", "current_timestamp", "current_user", "default", "deferrable",
  "desc", "distinct", "do", "else", "end", "except", "false", "fetch", "for", "foreign", "from",
  "grant", "group", "having", "in", "initially", "intersect", "into", "lateral", "leading", "limit",
  "localtime", "localtimestamp", "not", "null", "offset", "on", "only", "or", "order", "placing",
  "primary", "references", "returning", "select", "session_user", "some", "symmetric", "table",
  "then", "to", "trailing", "true", "union", "unique", "user", "using", "variadic", "when", "where",
  "window", "with",
]);

export function quoteIdentifier(name: string): string {
  return RESERVED.has(name) || !/^[a-z_][a-z0-9_]*$/.test(name) ? `"${name.replace(/"/g, '""')}"` : name;
}

export function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}
