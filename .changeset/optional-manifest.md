---
"@adr/tsql": minor
---

`compile` writes only the migration unless asked for more. `--manifest` is now a flag rather than a path: it writes `tsql-manifest.json` beside the migration, always under that name, so tooling finds it without being told. Before, a manifest was always written, to `generated/manifest.json` by default; nothing in tsql reads it back.
