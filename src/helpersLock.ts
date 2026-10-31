/**
 * One hash per revision of the helpers in `src/helpers.ts`, oldest first: the
 * revision a database records is how many of these there are.
 *
 * Not edited by hand — `bun scripts/helpers.ts lock` appends the hash of the
 * current text. `tests/helpers.test.ts` fails when the last entry is not the hash
 * of the helpers as they are, so a changed helper cannot be committed without
 * the new revision (the pre-commit hook runs the tests), and an entry is never
 * rewritten: that is what lets an older tsql recognise a database as newer.
 */
export const HELPER_HASHES: readonly string[] = [
  "bc6e2ac59d076aebba3326e3480d769316be8214e898b4944b5ac2b5ace98b81",
  "e04e5d242bbe4470ea740e36aa556fa6de5c4b33288abbd3ea44f236f3490e99",
  "f6019053a4597e327c5bb3d6be546cd5197a86eef534e34cdac4b0e4da86a863",
];
