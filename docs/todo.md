# Todo

## Global objects :
- console.log -> raise ...
- Math (done: everything that can return the same double as JavaScript — see `docs/design.md`; what is left is refused on purpose: `sin`, `exp`, `pow`… differ between engines)
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
