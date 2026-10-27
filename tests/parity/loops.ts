import { int, type Integer } from "../../src/index";

/**
 * A `while`, and a `for` that is not a `range`, become `WHILE … LOOP`: the `for` keeps its re-tested condition and runs its step at the
 * end of each turn — and before a `continue`. `break` is `EXIT`. Loop variables are block-scoped, so
 * a second `for (let i …)` gets its own SQL variable. Inputs are reduced with `%` to keep loops short.
 */
export function sumOfOdds(n: Integer): Integer {
  const limit = n % 50;
  let sum = 0;
  for (let i = 0; i < limit; i = int(i + 1)) {
    if (i % 2 === 0) {
      continue;
    }
    sum = int(sum + i);
  }
  return sum;
}

export function nextPowerOfTwo(n: Integer): Integer {
  let power = 1;
  while (power < n) {
    if (power > 1000000) {
      break;
    }
    power = int(power * 2);
  }
  return power;
}

export function triangle(n: Integer): Integer {
  const limit = n % 20;
  let total = 0;
  for (let i = 1; i <= limit; i = int(i + 1)) {
    total = int(total + i);
  }
  for (let i = 0; i < 2; i = int(i + 1)) {
    total = int(total + 1);
  }
  return total;
}
