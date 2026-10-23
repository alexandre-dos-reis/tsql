---
"@adr/tsql": patch
---

Say what was wrong instead of reprinting usage.

Passing a file where the command goes — `tsql rules/billing.ts --out x.sql` —
printed the help text and exited 1, leaving the reader to spot the missing
`compile` themselves. It now names the path it was given and suggests the
command. An unknown command names itself too, and a command with no files says
that rather than implying it.

A missing rules project now reports the path it looked for and points at
`--project`, which is the flag that fixes it: the default describes a consuming
project, so a first run from anywhere else lands there.
