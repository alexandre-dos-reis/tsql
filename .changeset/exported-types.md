---
"@adr/tsql": minor
---

Compile exported types for their own sake. An exported `interface`, `type` or `enum` is now created in
the migration whether or not a compiled function mentions it, so a composite, a domain or an enum can
exist for a table column written in SQL the compiler never sees. A non-exported type still compiles
wherever a function uses it, and is still absent when nothing does; the rule is what the functions
need, plus what the files export. An exported type must therefore be mappable even if nothing uses it,
and an exported generic declaration is refused — a PostgreSQL type is one fixed column list.
