/**
 * Rejected: an arrow function without an explicit return type.
 *
 * Arrow functions follow the same requirement as `function` declarations: the return
 * type is part of the contract between TypeScript and SQL — it decides
 * `RETURNS boolean` versus `RETURNS text` — so it has to be written down.
 *
 * Expected: Add an explicit return type to `isFree`
 */
export const isFree = (plan: string) => plan === "free";
