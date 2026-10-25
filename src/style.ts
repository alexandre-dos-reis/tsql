/**
 * Colour for the CLI, written by hand: seven ANSI styles do not justify a
 * dependency, and the rule for when to use them is the part that matters.
 *
 * Colour is used only on a terminal that supports it. `NO_COLOR` turns it off
 * and `FORCE_COLOR` turns it on (`FORCE_COLOR=0` off), as most tools agree
 * (https://no-color.org, https://force-color.org). Anything else — a pipe, a
 * file, a CI log, the test suite capturing output — gets plain text, so what a
 * script parses never contains escape codes.
 */

const CODES = {
  bold: [1, 22],
  dim: [2, 22],
  red: [31, 39],
  green: [32, 39],
  yellow: [33, 39],
  cyan: [36, 39],
  gray: [90, 39],
} as const;

export type Style = keyof typeof CODES;

/** Styles text for one output stream, or leaves it alone when that stream should stay plain. */
export interface Paint {
  (style: Style | readonly Style[], text: string): string;
  readonly enabled: boolean;
}

interface Stream {
  readonly isTTY?: boolean;
  hasColors?(): boolean;
}

export function colorEnabled(stream: Stream, env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== "") return false;
  if (env.FORCE_COLOR !== undefined) return env.FORCE_COLOR !== "0" && env.FORCE_COLOR !== "false";
  return stream.isTTY === true && (stream.hasColors?.() ?? true);
}

export function painter(enabled: boolean): Paint {
  const paint = ((style: Style | readonly Style[], text: string) => {
    if (!enabled || text === "") return text;
    const styles: readonly Style[] = typeof style === "string" ? [style] : style;
    return styles.reduce((inner, s) => `\u001b[${CODES[s][0]}m${inner}\u001b[${CODES[s][1]}m`, text);
  }) as Paint;
  Object.defineProperty(paint, "enabled", { value: enabled });
  return paint;
}

/** One painter per stream: stdout may be a terminal while stderr is redirected, or the reverse. */
export const out = painter(colorEnabled(process.stdout));
export const err = painter(colorEnabled(process.stderr));
