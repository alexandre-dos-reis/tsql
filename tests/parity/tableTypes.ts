import type { Integer } from "../../src/index";

/**
 * Types compiled for their own sake: nothing in this file calls or mentions
 * them, and they are still created. An exported type belongs to the schema
 * because a table column may be its only user, and that column is written in
 * SQL the compiler never sees.
 *
 * `TableName` has no SQL type of its own — it is `text` — so it leaves nothing
 * behind to create. `TableHidden` is not exported, and nothing reaches it, so
 * it is not created either.
 */

export type TableTier = "standard" | "gold";

export enum TableStatus {
  Open = "open",
  Shipped = "shipped",
}

export interface TableRow {
  readonly label: string;
  readonly tier: TableTier;
  readonly status: TableStatus;
  readonly quantity: Integer;
}

export type TableName = string;

interface TableHidden {
  readonly nobody: string;
}
