---
"@adrdp/tsql": minor
---

Compile `Number.parseFloat(s)` to `tsql.number_parse_float(s)`, a `double precision`: it reads the longest decimal prefix as JavaScript does (`"3.14abc"` is 3.14, `".5"`, `"1e3"` and `"-Infinity"` are numbers, unreadable text is `NaN`), and gives `±Infinity`, `0` and `-0` where PostgreSQL's own cast raises. The helper inlines. It is a `Float`, so `int(Number.parseFloat(s))` is refused. Literals beyond what `numeric` holds (about 10^130749, or 10^-16383) raise rather than answer. A new helper is added, so the helpers are at revision 3; no existing helper changed, so nothing already installed behaves differently.
