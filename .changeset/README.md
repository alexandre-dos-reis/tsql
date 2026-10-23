# Changesets

This directory holds the pending release notes. Each `.md` file here is one
changeset: a bump type plus a description of what changed, written when the
change is made rather than reconstructed at release time.

```
bun run changeset        # describe a change (interactive)
bun run version          # consume changesets: bump, write CHANGELOG, sync pins
bun run release          # build binaries, publish platform packages, then the launcher
```

See https://github.com/changesets/changesets for the full model.
