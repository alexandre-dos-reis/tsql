---
"@adr/tsql": patch
---

Rewrite the README around getting started, and add a logo.

The front of the document is now install, a rule, its generated SQL, and a few
worked examples — every SQL snippet produced by actually compiling the
TypeScript above it rather than written by hand. The design reasoning that was
previously interleaved moves below a `Reference` divider, where it still
records *why* each restriction and each semantic mapping exists.

Drops the pre-implementation "Design Decision" and "Support" notes, which were
speculation the built compiler has since superseded, and corrects the sections
left stale by removing the compiled binary.

Adds `assets/logo.svg` — the PostgreSQL project's own elephant artwork beside
an original TypeScript tile — and a licence and trademarks section.
