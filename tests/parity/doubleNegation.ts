import type { Float } from "../../src/index";

// `-(-x)` must not be written `--x`, which SQL reads as the start of a comment.
export function doubleNegation(x: Float): Float {
  return -(-x);
}
