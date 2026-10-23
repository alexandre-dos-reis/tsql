/**
 * The platforms a binary is published for.
 *
 * Shared by the build script and the test that checks these stay in step with
 * the launcher's `optionalDependencies` — a target added in one place and not
 * the other produces a release that silently has no binary for someone.
 *
 * `bin/tsql.mjs` carries the same mapping, spelled out in plain JavaScript,
 * because npm puts that file on PATH and it must start without a transpiler.
 */
export interface Target {
  /** Package-name suffix, and the directory under `dist/`. */
  readonly name: string;
  /** Bun's `--target` value. */
  readonly bunTarget: string;
  /** npm's `os` field — the values `process.platform` uses. */
  readonly os: string;
  /** npm's `cpu` field — the values `process.arch` uses. */
  readonly cpu: string;
  readonly exe: string;
}

export const TARGETS: readonly Target[] = [
  { name: "linux-x64", bunTarget: "bun-linux-x64", os: "linux", cpu: "x64", exe: "tsql" },
  { name: "linux-arm64", bunTarget: "bun-linux-arm64", os: "linux", cpu: "arm64", exe: "tsql" },
  { name: "darwin-x64", bunTarget: "bun-darwin-x64", os: "darwin", cpu: "x64", exe: "tsql" },
  { name: "darwin-arm64", bunTarget: "bun-darwin-arm64", os: "darwin", cpu: "arm64", exe: "tsql" },
  { name: "windows-x64", bunTarget: "bun-windows-x64", os: "win32", cpu: "x64", exe: "tsql.exe" },
];
