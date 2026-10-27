import { range, type Integer } from "../../src/index";

/**
 * Rejected: a `let` loop variable over a `range`.
 *
 * PL/pgSQL's `FOR` variable belongs to its loop — it is declared by the loop and
 * exists only inside it — so a reassignable TypeScript variable would promise
 * something the SQL does not do. Requiring `const` also means `tsc` refuses the
 * reassignment, so the correspondence is checked rather than trusted, the same
 * way `readonly` is required of array parameters.
 *
 * Expected: must be `const`
 * Expected: belongs to its loop
 */
export function sumTo(n: Integer): Integer {
  let total = 0;
  for (let i of range(1, n)) { // ← rejected here
    i = 0;
    total = total + i;
  }
  return total;
}
