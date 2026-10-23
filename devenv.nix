{ pkgs, lib, ... }:

let
  # nixpkgs tracks Bun 1.3.13, but this project needs 1.4.4 for `bun check` —
  # the embedded typescript-go type checker that replaced the `tsc` scripts.
  # Only the version and the release tarballs are overridden; the platform
  # handling (autoPatchelf on Linux, install_name_tool + resigning on Darwin)
  # is nixpkgs' and stays as-is.
  bunVersion = "1.4.4";

  bunAsset = {
    x86_64-linux = "bun-linux-x64";
    aarch64-linux = "bun-linux-aarch64";
    x86_64-darwin = "bun-darwin-x64";
    aarch64-darwin = "bun-darwin-aarch64";
  };

  bunHash = {
    x86_64-linux = "sha256-v4zL+ysLgBWeD5ptFcVTF63YB3U028YTCj7bUvzLOVw=";
    aarch64-linux = "sha256-uqa7NvUdblhWHgK76oJQOKnfRU9nPW13bou/hvjHhQ4=";
    x86_64-darwin = "sha256-UKNJH3Orwv6BZzFxqFdi07wswWgMzsrdmD3pmt93l34=";
    aarch64-darwin = "sha256-wkDX8My5DCY6hJ/NsJt+5iYw2SE0jtaq/ahrnVd7xRA=";
  };

  bunSource =
    system:
    pkgs.fetchurl {
      url = "https://github.com/oven-sh/bun/releases/download/bun-v${bunVersion}/${bunAsset.${system}}.zip";
      hash = bunHash.${system};
    };

  bun = pkgs.bun.overrideAttrs (
    final: prev: {
      version = bunVersion;

      # The archive's single top-level directory is named after the asset, and
      # 1.4.4 drops the x86_64-darwin `-baseline` variant nixpkgs still points at.
      sourceRoot = bunAsset.${pkgs.stdenvNoCC.hostPlatform.system} or null;

      passthru = prev.passthru // {
        sources = lib.genAttrs (lib.attrNames bunAsset) bunSource;
      };
    }
  );
in
{
  # Node is here for the tooling that is not Bun-native: the changesets CLI,
  # and `npm publish` for the per-platform binary packages. Pinned for the same
  # reason Bun is — the ambient system Node is whatever happens to be on PATH.
  packages = [
    bun
    pkgs.nodejs_24
  ];

  enterShell = ''
    echo "tsql — bun $(bun --version), node $(node --version)"
  '';
}
