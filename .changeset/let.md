---
"@adr/tsql": minor
---

Compile `let` locals and their reassignment: `x = v`, `x += v` (and `-=`, `*=`, `/=`, `%=`), `x++`, `x--`, as statements. A compound assignment follows the rules of its operator, and the result must fit the variable: a `let` takes the type of its initial value unless annotated, so assigning a fraction to an integer `let` is refused with a hint rather than rounded. `var`, reassigning a parameter, assignments used as values and logical assignment (`??=`, `||=`, `&&=`, `**=`) are refused with a message.
