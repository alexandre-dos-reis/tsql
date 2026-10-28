---
"@adr/tsql": patch
---

An exported union of strings (`export type Plan = "free" | "pro"`) now creates its domain even when no function and no other type mentions it, as an exported `interface`, object type or `enum` already did. It was created only when something reached it, so a table column could not use it on its own. Nothing changes for a union that was already created.
