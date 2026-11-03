# Artwork and distribution

## Role decks

Each deck lives under `frontend/public/assets/game/roles/<style>/`, with 1024 × 1536
WebP cards in `cards/` and matching 512 × 512 WebP portraits in `avatars/`:

| Style | Files | Variants |
| --- | --- | --- |
| Modern | 11 | Four servants, one minion; gold trim is painted into the art |
| Classic | 13 | Five servants, two minions |
| Furry | 11 | Four servants, one minion |

`frontend/src/lib/art/cardDecks.ts` lists each deck's variants and
`roleMeta.ts` builds the asset paths. A variant index beyond a deck's range wraps
to an existing portrait. Names and descriptions are localized text drawn by the
UI, never part of the paintings.

## Player avatars

`frontend/public/assets/game/player-avatars/` holds ten 512 × 512 WebP portraits
of original characters with no game role. To add one, place the file there and
append its name (without `.webp`) to `frontend/src/lib/art/player-avatars.json`.
Keep existing IDs stable: assignment uses rendezvous hashing by player and
portrait ID, so a new portrait only moves the players it wins.

## Gameplay icons

`frontend/public/assets/game/icons/` contains 256 × 256 transparent WebP icons
shared by every deck.

Keep source images outside `frontend/public/`: Vite copies everything in that
directory into the build, regardless of Git ignore rules.

## Provenance and distribution

- **Classic deck:** repainted with an image generator from supplied images of the
  original printed board game.
- **Furry deck:** illustrations supplied by a user, cropped and optimized.
- **Gameplay icons:** repainted from a photo of the original printed component
  guide; `lady.webp` from the original Lady of the Lake card.
- **Modern deck and player avatars:** generated for this project.

The repository holds no redistribution permission for the classic or furry
source material. Confirm permitted use, or replace those assets, before
redistributing them.

## Before publishing the repository

- **License:** none has been chosen for the code or artwork.
- **Git history:** deleted files remain in earlier revisions, which include
  generated state and agent session files. Review history separately.
- **Local files:** publish reviewed sources or build outputs, never a ZIP of the
  working directory; ignored environment files, backups, original artwork and
  `.private/` operations records may exist locally.
- **Operations:** keep installation-specific manifests, credentials and recovery
  backups private; public deployment guides use environment variables.
