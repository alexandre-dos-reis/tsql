---
"@adr/tsql": patch
---

`tsql parity` no longer generates subnormal doubles. PostgreSQL raises "value out of range: underflow" when a `double precision` result underflows to zero, where TypeScript gives 0; like integer overflow, this is now a documented divergence rather than a parity failure on inputs such as `5e-324`.
