# Todo

## Global objects :
- console.log -> raise ...
- Math (done: `abs`, `ceil`, `floor`, `max`, `min`, `sign`, `sqrt`, `trunc` — see `docs/design.md`; left: `round`, which needs a rewrite, and the constants)
- Date
- String
- Number
- Boolean
- Array
    | arr.length | CARDINALITY(arr) |
    | arr.includes(x) | x = ANY(arr) |
    | arr.map(...) | Often UNNEST() with a query |
    | arr.filter(...) | Often a query with WHERE |
    | arr.join(',') | ARRAY_TO_STRING(arr, ',') |
    | arr.push(x) | arr := ARRAY_APPEND(arr, x) |
    | [...a, ...b] | a || b |
- Object
- RegExp
