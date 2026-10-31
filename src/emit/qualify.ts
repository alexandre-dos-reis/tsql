/**
 * How a name and a type are written in SQL: schema-qualified when a schema is in use, and the note kept for a string union that nothing enforces.
 */
import { isArray, isScalar, type ArrayType, type CompositeType, type PgType, type ScalarType } from "../ir.ts";
import { quoteIdentifier, quoteLiteral } from "../names.ts";

/**
 * Renders SQL names, schema-qualified when a schema is in use: `q(name)` for a
 * function, `q.type(composite)` for a composite type, `q.scalar(type)` for a
 * scalar — its domain or enum when it has one.
 */
export interface Qualifier {
  (sqlName: string): string;
  type(composite: CompositeType): string;
  scalar(type: ScalarType): string;
}

export function arrayTypeName(type: ArrayType, q: Qualifier): string {
  return `${isScalar(type.element) ? q.scalar(type.element) : q.type(type.element)}[]`;
}

/**
 * String-literal unions stay `text` on the database side. The permitted values
 * are recorded for the reader; enforcing them is a separate concern (an enum,
 * a domain, or a CHECK constraint).
 */
export function allowedNote(name: string, allowed: readonly string[]): string {
  return `--   ${name}: one of ${allowed.map((v) => quoteLiteral(v)).join(", ")} (not enforced here)`;
}

/** How a type is written in SQL: a scalar name, a (possibly qualified) composite, or an array of either. */
export function typeName(type: PgType, schema: string | undefined): string {
  if (isArray(type)) return `${typeName(type.element, schema)}[]`;
  if (isScalar(type) && !type.named) return type.sql;
  const sqlName = isScalar(type) ? type.named!.sqlName : type.sqlName;
  return schema ? `${quoteIdentifier(schema)}.${quoteIdentifier(sqlName)}` : quoteIdentifier(sqlName);
}

/** A domain or an enum enforces its values itself; only plain text gets the comment. */
export function unenforced(type: PgType): readonly string[] | undefined {
  if (isArray(type)) return isScalar(type.element) && !type.element.named ? type.element.allowed : undefined;
  return isScalar(type) && !type.named ? type.allowed : undefined;
}

export function qualifier(schema: string | undefined): Qualifier {
  const qualify = ((sqlName: string) =>
    schema ? `${quoteIdentifier(schema)}.${quoteIdentifier(sqlName)}` : quoteIdentifier(sqlName)) as Qualifier;
  qualify.type = (composite) => typeName(composite, schema);
  qualify.scalar = (type) => typeName(type, schema);
  return qualify;
}
