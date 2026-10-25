/**
 * The authoring vocabulary shared by the pure functions and the compiler.
 *
 * TypeScript's `number` is an IEEE-754 double, while PostgreSQL distinguishes
 * integer, exact decimal and floating point. Rather than guess, the compiler
 * requires an explicit annotation wherever the distinction matters. These are
 * plain aliases of `number`, so they cost nothing in TypeScript and impose no
 * friction at call sites — the compiler resolves them by name at build time.
 */

/** `integer` in PostgreSQL. 32-bit; PostgreSQL raises on overflow, TypeScript does not. */
export type Integer = number;

/** `numeric` in PostgreSQL. Exact decimal arithmetic. */
export type Numeric = number;

/** `double precision` in PostgreSQL. The same IEEE-754 double TypeScript uses. */
export type Float = number;
