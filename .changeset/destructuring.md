---
"@adr/tsql": minor
---

Compile object destructuring in `const` declarations: `const { plan, shipping: { express } } = order` reads one field per name, nested patterns read flattened columns, and `{ plan: tier }` renames. A call result is read once, through a local. Defaults, `...rest` and array destructuring are refused with a message saying why.
