---
"@adr/tsql": minor
---

Speak of functions rather than business rules: tsql compiles TypeScript functions, whatever they encode. The defaults follow — `--project` is now `functions/tsconfig.json` (was `rules/tsconfig.json`) and `compile --out` is `generated/0001_functions.sql` (was `generated/0001_rules.sql`); pass `--project rules/tsconfig.json` to keep the old layout. The guards' drift messages read "but the functions expect".
