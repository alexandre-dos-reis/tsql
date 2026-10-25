---
"@adr/tsql": patch
---

Fix `tsql` on Node when installed from npm. Node strips TypeScript types, but refuses to under `node_modules` (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`), which is where an installed package lives — so every `npx tsql` on Node failed, and so did importing `@adr/tsql` from Node. The package now ships its code as JavaScript, built into `dist/` (no dependency bundled, not minified), with its types still read from the TypeScript sources. Bun was never affected.
