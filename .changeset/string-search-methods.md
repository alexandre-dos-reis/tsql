---
"@adrdp/tsql": minor
---

Compile `String.prototype`'s three searches: `s.includes(t)`, `s.startsWith(t)` and `s.endsWith(t)`
become `strpos(s, t) > 0`, `starts_with(s, t)` and `starts_with(reverse(s), reverse(t))`. A
substring search compares code points, so — like the trims, and unlike `<` on strings — no locale
and no collation decides anything, and no helper is installed in the `tsql` schema.

`endsWith` is written as a prefix test on both strings reversed rather than as
`right(s, length(t)) = t`, which is equally exact but mentions the needle twice: `s.endsWith(f(x))`
would call the compiled `f` twice.

Their optional second argument is refused: it is a position counted in UTF-16 code units, which
PostgreSQL's `text` has no notion of — it counts characters, so `"😀a".includes("a", 1)` would
disagree. `indexOf` and `lastIndexOf` stay refused for the same reason, now pointing at `includes`
and `endsWith` where those answer the question.
