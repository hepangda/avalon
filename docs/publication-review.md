# Publication checklist

Publish reviewed source files or build outputs. Do not distribute a raw ZIP of
the working directory: ignored environment files, backups, original artwork and
private operational records may still exist locally. `.gitignore` and
`.dockerignore` exclude these from normal source and image inputs.

## Distribution requirements

- **Artwork:** confirm redistribution rights or replace affected assets. The
  classic deck references supplied board-game art, and the alternate deck uses
  user-provided illustrations. Provenance alone does not grant permission;
  see [art documentation](art/README.md).
- **License:** the repository has no code license. The owner must choose a license
  and establish compatible asset permissions before distribution.
- **Git history:** deleting files from the working tree does not remove their
  previous revisions. Review history separately before publishing the repository;
  earlier revisions contain generated state and agent session files.
- **Operations:** keep installation-specific manifests, credentials, migration
  records and recovery backups private. Public deployment guides use configurable
  destinations and environment variables.

Gameplay tests, optimized artwork, generation metadata and bot benchmark fixtures
are intentional source inputs. Authentication provider domains in allowlists and
tests define supported behavior. Database recovery and rollback constraints are
in [architecture](architecture.md). Run the verification commands in the root
[README](../README.md) before releasing; previous audit results are not evidence
for the current tree.
