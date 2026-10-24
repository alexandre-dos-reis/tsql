---
"@adr/tsql": patch
---

Quote PostgreSQL's "type or function name" keywords (`outer`, `inner`, `left`, `join`, `like`…) and PL/pgSQL's own reserved words (`begin`, `loop`, `if`…) in generated identifiers. A rule with a parameter named `outer` used to compile to SQL that PostgreSQL refused: the keyword is accepted as a parameter name but not as a column reference in `(outer).field`.
