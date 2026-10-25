---
"@adr/tsql": minor
---

Nest object types as PostgreSQL does, instead of flattening them. A field of a named object type is now a column of that type's own composite — `customer: Customer` is `customer app.customer`, read as `((basket).customer).tier` — where it used to be flattened into prefixed columns (`customer_tier`). A nested object is a value: it can be passed to another function, returned, held in a local or destructured as a whole, and a nested literal is a `ROW` inside a `ROW`. Anonymous nested shapes (`customer: { tier: string }`) are now refused — give the shape a name — as is a nested object that may be `null`; the 4-level nesting cap is gone. The generated types change shape: an existing database needs its composite types migrated (the type guard reports the difference rather than replacing anything).
