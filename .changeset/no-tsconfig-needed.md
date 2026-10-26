---
"@adr/tsql": minor
---

No tsconfig is needed any more: `tsql check input.ts` works on its own, and `--project` has no default. tsql always type checks with options it imposes — `strict`, `noEmit`, `types: []` and `lib: ["ESNext"]` — even over a tsconfig given with `--project`, which still lends its paths and other settings. Without `strict`, TypeScript lets `null` into every type and a nullable comparison would be translated wrongly; without the other two, browser and Node globals would type check. Before, `--project` defaulted to `functions/tsconfig.json`, and the translation depended on that file's settings.
