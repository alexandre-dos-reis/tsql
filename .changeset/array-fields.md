---
"@adr/tsql": minor
---

Compile array fields in object types. `lines: readonly BasketLine[]` is one column of type `app.basket_line[]` beside the flattened ones, and reads as an array anywhere — `for … of`, `.length`, `.includes`, passed to another rule, held in a local or destructured — and a spread carries it into a new value, so an object holding an array can be returned. Composite types are now created in dependency order, and a shape that contains itself through an array is refused. Array locals are accepted. Also fixes the composite type guard, which compared a field named after a reserved word (`limit`) quoted against the catalogue's unquoted name, so applying a migration twice raised.
