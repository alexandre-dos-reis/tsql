# tsql: simple

One type and one function, in `input.ts`. No tsconfig: tsql brings its own options.

```bash
npm install
npm run tsql:check     # type check and translate, write nothing
npm run tsql:parity    # prove the SQL gives the same answers as the TypeScript
npm run tsql:compile   # write output.sql
```

`output.sql` is what `tsql:compile` writes, checked in so you can read it without running anything.
