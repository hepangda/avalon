# Avalon identity art

## Deck layout

All decks are peers under `public/assets/game/roles/<style>/`:

| Style | Cards | Avatars | Art metadata | Frame |
| --- | --- | --- | --- | --- |
| Modern | `modern/cards/` (11) | `modern/avatars/` (11) | `modern-cards.json` | Gold trim painted into the art |
| Classic | `classic/cards/` (13) | `classic/avatars/` (13) | `classic-cards.json` | No added frame |
| Furry | `furry/cards/` (11) | `furry/avatars/` (11) | `furry-cards.json` | No added frame |

Cards are 1024 × 1536 WebP; matching avatar filenames are 512 × 512 WebP.
No deck occupies the shared root. `src/lib/game/cardDecks.ts` describes each
deck's label and available role variants; `roleMeta.ts` builds
all asset paths uniformly. Character names, allegiance and descriptions remain
live localized text, outside the paintings.

Cards have no added decorative frame. Modern retains the trim already painted
into its original illustrations. Settings previews use the same `RoleCard`
renderer and localized text as cards in the game.

## Display preferences

**Settings → Card art** is available on home, lobby, game and replay pages.
Choose **Modern**, **Classic**, or **Furry**. Modern is the initial choice,
configured centrally by `DEFAULT_CARD_ART_STYLE` in `src/lib/preferences.ts`.
Existing saved choices, including Classic, are preserved.

Signed-in preferences are stored on the account in PostgreSQL and restored after
login. Edits are saved through `/api/auth/preferences`; `avalon-card-art` and
`avalon-locale` keep local display caches and signed-out preferences. Changing
accounts loads that account's preferences, using the default for missing values.
The language follows the first supported browser language, falling back to Chinese.
Language changes leave the URL and game state intact; legacy `/zh/…` and `/en/…`
links redirect without the prefix, preserving queries and fragments.

`RoleCard` and `RolePortrait` use the selected deck across lobby previews,
identity reveals, table cards, final results and replays.

## Role variants and rendering

The server assigns five servant appearances and two minion appearances using
separate deterministic streams from the saved game seed. Up to five servants
and two minions receive distinct art; additional minions cycle through the two
appearances. Artwork
variants follow the same privacy boundary as roles and remain consistent through
reconnection, phase rollback, final reveal and newly generated replays. Older
cached replays without a variant use the first portrait.
The modern and furry decks each keep their four servant appearances and single minion;
the fifth servant wraps to its first portrait and both minion variants use their
existing minion portrait when switching to that style.

`RoleCard` renders the entire illustration with a blue-black or wine-red fade
under the localized text. Identity reveal and the private identity dialog use the
full version; lobby previews and public table cards use smaller versions. Replay and result views use the companion avatars.

## Modern deck

The modern deck preserves the atmospheric fantasy illustrations and matching
avatars under `public/assets/game/roles/modern/`. Its generation prompts are in
`modern-cards.json`; the rectangular gold frame is part of the paintings.

## Classic deck

The classic deck was redrawn from the supplied original board-game references.
Close-up painted portraits retain the distinctive silhouettes: Merlin's blue
orb, Percival's straight fringe, Morgana's red hair and ruby circlet, the woman
assassin's central sword, Mordred's hood and facial markings, and Oberon's
pointed ears. Good characters use blue backgrounds; evil characters use warm
ochre and deep brown shadows. All five servants and both minions from the
original references are represented, with existing asset filenames retained.

Companion avatars are face-focused crops of the same paintings. The complete
generation prompt is `style` plus each role's `subject` in `classic-cards.json`;
that file records portable output paths and exact avatar crop coordinates.
Local reference and generator paths are excluded from public metadata.
Cards have no baked-in labels, faction badges, or scanned card borders; the UI
provides its own border and localized captions.

The five servants are `loyal-servant-1` (chainmail guard), `loyal-servant-2`
(knight with raised visor), `loyal-servant-3` (dark-haired knight without a helmet),
`loyal-servant-4` (woman knight in a pointed silver helmet), and `loyal-servant-5`
(woman in a blue dress with pinned-up brown hair). Minions are `minion`
(sword-bearing man) and `minion-2` (bronze-helmeted man).

## Furry deck

Furry assets use matching filenames under
`public/assets/game/roles/furry/cards/` and `furry/avatars/`:

| Filename | Illustration |
| --- | --- |
| `merlin.webp` | Blue-robed wolf mage |
| `percival.webp` | Lion in silver armor and blue cloak |
| `morgana.webp` | Red-robed wolf mage |
| `mordred.webp` | Wolf with crossed arms and red cloak |
| `oberon.webp` | Antlered woodland beast with green magic |
| `assassin.webp` | Hooded wolf with a red blade |
| `minion.webp` | Hyena warrior |
| `loyal-servant-1.webp` | White tiger |
| `loyal-servant-2.webp` | Black panther with a spear |
| `loyal-servant-3.webp` | Rhino with a hammer |
| `loyal-servant-4.webp` | Moose knight |

Cards are optimized to 1024 × 1536 WebP; companion portraits are individually
cropped to 512 × 512. Source filenames and face-focused crop coordinates are
recorded in `docs/art/furry-cards.json`.

Keep original uploads outside `public/`, for example in the ignored local
`docs/art/furry-source/` directory. Git ignore rules do not stop Vite from copying
files under `public/` into a build. Only optimized illustrations and portraits
belong in the public asset tree.

## Player avatars

Player avatars use a separate, newly generated cosmetic pool in
`public/assets/game/player-avatars/`. These ten original characters have no game
roles. Profile pictures take priority; unavailable profile pictures fall back to
this pool. Unclaimed seats use an empty-seat silhouette.

The registry is `src/lib/game/player-avatars.json`. To expand the pool, add a
square WebP portrait to `public/assets/game/player-avatars/` and append its filename
without `.webp` to that registry. No component changes are needed. Keep existing
IDs and filenames stable. Rendezvous hashing selects by player ID and portrait
ID, so reordering the registry does not change assignments, and adding a portrait
only moves players selected for that new portrait.

The original generation prompts and output paths are saved in
`docs/art/player-avatars.json`; concatenate `sharedPrompt` and each `subject` to
reconstruct an exact prompt. The ten portraits were generated individually with
the built-in `image_gen` tool, then optimized as 512 × 512 WebP assets. Future
portraits should use the same centered face-and-shoulders framing and readable
storybook illustration style, with important features inside a circular crop.

## Gameplay icons

`public/assets/game/icons/` contains shared 256 × 256 transparent WebP icons,
independent of the selected role deck. The component-reference replacements
were repainted with the built-in `image_gen` tool from the user-provided photo
of the original printed component guide. These are interpretations of a small,
blurred reference, not exact reproductions of the source print.

| File | Motif |
| --- | --- |
| `crest.webp` | Red shield with a pale heraldic dragon |
| `leader.webp` | Gold crown with red lining |
| `approve.webp` | Pale approval stone |
| `reject.webp` | Dark rejection stone |
| `mission-success.webp` | Upright golden chalice |
| `mission-fail.webp` | Inverted golden chalice |
| `lady.webp` | Blonde Lady of the Lake looking back over her shoulder, white drapery and teal water |

Generation prompts and export details are in `game-icons.json`. Initial outputs
had painted checkerboard backgrounds; a second image-generation pass replaced
those with a flat green key, removed during export to preserve real alpha.
`lady.webp` was repainted from the separately supplied original Lady of the Lake
card. Its magenta export background was removed to preserve the teal lake motif.
`assassinate.webp` preserves the previous dagger artwork separately from the
rejection stone, so assassination controls retain their original meaning.

## Distribution review

The classic deck was generated using supplied board-game artwork as references;
the alternate furry illustrations were supplied by a user. This repository does
not contain redistribution permission records for either source set. Their
provenance is retained here rather than describing them as independently created
or licensed artwork. Confirm the permitted use or replace these decks before
redistributing the assets. The player-avatar pool has separate generation
prompts in `player-avatars.json`.

No project-wide license has been selected in this repository. This cleanup does
not assign a license to the code or artwork.
