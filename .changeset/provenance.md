---
"@adrdp/tsql": patch
---

Releases are published from CI with [npm provenance](https://docs.npmjs.com/generating-provenance-statements). The tarball is cryptographically linked to the workflow run and the commit that built it, so `npm audit signatures` can verify that what is on the registry came from this repository. Authentication is [trusted publishing](https://docs.npmjs.com/trusted-publishers) over OpenID Connect, so no long-lived npm token exists to leak.

Nothing in the compiler or the generated SQL changes.
