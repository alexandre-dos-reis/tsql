/**
 * Rejected: a tagged template.
 *
 * `tag\`…\`` calls `tag` with the literal pieces and the values: a function
 * call, which a compiled function can only make to another compiled function — and a
 * function does not take a template's pieces.
 *
 * Expected: Tagged templates are not supported
 */
function upper(pieces: TemplateStringsArray): string {
  return pieces.join("");
}

export function shout(): string {
  return upper`hello`; // ← rejected here
}
