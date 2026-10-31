/**
 * What a caller can ask of the emitter: the schema to qualify with, `OR REPLACE`, and the comments.
 */
export interface EmitOptions {
  /** Schema to qualify generated functions with. Omit for unqualified names. */
  readonly schema?: string | undefined;
  readonly orReplace?: boolean;
  readonly comments?: boolean;
}

export const DEFAULTS = { orReplace: true, comments: true } satisfies EmitOptions;
