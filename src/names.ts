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
 * Words that cannot be used unquoted as a PL/pgSQL identifier. Three lists:
 *
 * - PostgreSQL's fully reserved keywords;
 * - its "type or function name" keywords (`outer`, `inner`, `left`, `join`…):
 *   accepted as a parameter name but not as a column reference, so a parameter
 *   called `outer` breaks `(outer).field` unless it is quoted;
 * - PL/pgSQL's own reserved words (`begin`, `loop`, `if`…), which break a
 *   variable declaration or assignment.
 *
 * Anything missing surfaces as a syntax error from PostgreSQL — which the
 * parity tests run every accepted case into.
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
  // Type or function name keywords: legal as a parameter name, not as a column reference.
  "authorization", "binary", "collation", "concurrently", "cross", "current_schema", "freeze",
  "full", "ilike", "inner", "is", "isnull", "join", "left", "like", "natural", "notnull", "outer",
  "overlaps", "right", "similar", "tablesample", "verbose",
  // PL/pgSQL's own reserved words, beyond those already listed above.
  "begin", "by", "declare", "execute", "foreach", "if", "loop", "strict", "while",
]);

export function quoteIdentifier(name: string): string {
  return RESERVED.has(name) || !/^[a-z_][a-z0-9_]*$/.test(name) ? `"${name.replace(/"/g, '""')}"` : name;
}

export function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * A text literal written as PostgreSQL's Unicode escapes — `U&'\0009\000A'`.
 *
 * Used for the whitespace `.trim()` removes, where the characters themselves
 * would be 25 invisible ones in the migration: a reader could not tell which,
 * and an editor trimming the file would change what the function does. Four hex
 * digits for the BMP, `\+` and six above it, which is the form PostgreSQL
 * documents.
 *
 * `U&'…'` needs `standard_conforming_strings` on (the default since 9.1), and
 * code points above U+007F need a UTF8 server encoding.
 */
export function quoteUnicodeLiteral(codePoints: readonly number[]): string {
  const escapes = codePoints.map((point) =>
    point > 0xffff ? `\\+${point.toString(16).padStart(6, "0")}` : `\\${point.toString(16).padStart(4, "0")}`,
  );
  return `U&'${escapes.join("")}'`;
}

/** PostgreSQL's NAMEDATALEN - 1. Longer identifiers are silently truncated. */
export const MAX_IDENTIFIER_BYTES = 63;
