# tsql: simple

One type and one function, `functions/pricing.ts`, and the tsconfig tsql reads.

```bash
npm install
npm run check     # type check and translate, write nothing
npm run parity    # prove the SQL gives the same answers as the TypeScript
npm run compile   # write generated/0001_functions.sql
```
