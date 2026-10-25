---
"@adr/tsql": minor
---

Compile template literals as text concatenation: `` `${plan}-${region}` `` is `plan || '-' || region`, and a template without substitutions is a plain literal. Substitutions may be text, `Integer` or `boolean` (written with `::text`, which matches `String(value)`); fractional numbers, which the two languages print differently, nullable values, which `||` turns into NULL, and tagged templates are refused with an explanation.
