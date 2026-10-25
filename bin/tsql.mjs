#!/usr/bin/env node
/**
 * The `tsql` entry point: the built CLI, `dist/cli.mjs`, run in this process by
 * whichever of Node or Bun invoked it.
 *
 * It is JavaScript rather than the TypeScript sources because Node will not
 * strip types under `node_modules`, where an installed copy lives
 * (ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING). `scripts/build.ts` builds it,
 * and `prepublishOnly` runs that build.
 */
await import(new URL("../dist/cli.mjs", import.meta.url).href);
