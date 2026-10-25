---
"@adr/tsql": patch
---

Fix `tsql` on Node when installed from npm. Node strips TypeScript types, but refuses to under `node_modules` (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`), which is where an installed package lives — so every `npx tsql` on Node failed. The launcher now strips this package's own sources itself, with Node's `module.stripTypeScriptTypes` in a load hook that touches nothing else. Bun was never affected.
