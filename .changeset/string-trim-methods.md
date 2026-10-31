---
"@adrdp/tsql": minor
---

Compile `String.prototype`'s three trims: `s.trim()`, `s.trimStart()` and `s.trimEnd()` become
`btrim`, `ltrim` and `rtrim` **handed the set of characters to remove** — the 25 code points
ECMAScript's `trim` strips (`WhiteSpace` and `LineTerminator`), written in the migration as
`U&'\0009\000a…'`. The set form matters: the one-argument `btrim(s)` removes spaces only, so it
would diverge on a tab, and a character set compares code points, so neither the database's locale
nor its collation decides anything. No helper is installed in the `tsql` schema: PostgreSQL already
has these three functions with the same definition.

This is the first method on a value to compile. Methods on anything but a string, and every other
string method, are still refused — now with the divergence named rather than a categorical answer:
`.toUpperCase()` reports the locale and collation question, `.length`, `.indexOf()` and `.slice()`
report that TypeScript counts UTF-16 code units where PostgreSQL counts characters, and
`.trimLeft()`/`.trimRight()` are told to write `trimStart`/`trimEnd`.
