# Avalon identity art

Generated with the built-in `image_gen` tool. The final prompt set is recorded in
`role-cards.json`. Character names, allegiance and descriptions are live localized
text; the paintings contain no baked-in labels.

- `public/assets/game/roles/cards/`: 11 full illustrations, 1024 × 1536 WebP.
- `public/assets/game/roles/avatars/`: 11 paired head-and-shoulder portraits,
  512 × 512 WebP, composed for square or circular display.
- Both folders use matching filenames. Loyal servants are `loyal-servant-1`
  (swordsman), `loyal-servant-2` (red-haired knight), `loyal-servant-3`
  (East Asian wuxia swordsman), and `loyal-servant-4` (ranger).

The third servant is an East Asian swordsman with a relaxed three-quarter stance
and a diagonally sheathed sword in an Avalon castle cloister. Its wardrobe and
pose are original; the oil-painting finish, warm light, blue-and-gold palette and
close character framing follow loyal-servant-1 and Percival as style references.
Its `revisionPrompt` replaces the shared card prompt.

The server assigns the four servant appearances using a separate deterministic
stream from the saved game seed. Up to four servants receive distinct art; a
five-servant game (10 players without Percival) reuses one appearance. Artwork
variants follow the same privacy boundary as roles and remain consistent through
reconnection, phase rollback, final reveal and newly generated replays. Older
cached replays without a variant use the first portrait.

`RoleCard` renders the entire illustration with a blue-black or wine-red fade
under the localized text. Identity reveal and the private identity dialog use the
full version; lobby previews and public table cards use smaller versions. Replay
and MVP lists use the companion avatars.

## Alternate furry deck

Cloudflare Flagship selects the artwork using the `card-resource` string flag in
the `avalon` project (App ID `134aa4be-47b7-435f-a9b8-2d6b7d8f5922`). `default`
uses the classic illustrations; `furry` uses the alternate deck. Missing flags,
invalid values, or evaluation failures fall back to `default`.

The Worker evaluates through the native `FLAGS` binding at
`POST /api/card-resource`. Authenticated account details come from the server
session. The browser only sends `{ anonymousId, anonymousName }`. Responses are
private and uncached. The Flagship context is:

| Attribute | Authenticated viewer | Anonymous viewer |
| --- | --- | --- |
| `targetingKey` | Account ID | `anonymous:<anonymousId>` |
| `userId` | Account ID | `anonymous:<anonymousId>` |
| `name` | Game alias, or original username | Anonymous nickname (may be empty) |
| `username` | Original identity-provider username | Empty string |
| `anonymous` | `false` | `true` |
| `anonymousId` | Empty string | Stable browser UUID |
| `anonymousName` | Empty string | Anonymous nickname (may be empty) |

The UUID is stored in `avalon-anonymous-id`; the card decision is never persisted.
The previous `avalon-card-art` preference and crest gesture no longer select a
deck. The shared auth provider and `CardResourceSync` cover every route, including
direct game and replay links. Identity changes trigger reevaluation, as do tab
focus/visibility and a 60-second interval while visible. Stale requests cannot
overwrite the current identity's result. Local development uses the live
Flagship project through Wrangler's remote binding and requires Cloudflare login.

`src/lib/game/roleMeta.ts` resolves both decks using the same role and servant
variant. `RoleCard` and `RolePortrait` subscribe to the evaluated resource, covering lobby
previews, identity reveals, table cards, final results and replays.

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

Original uploads can be staged in `public/assets/game/roles/furry-source/`, which
is ignored by Git. After conversion, archive originals in
`docs/art/furry-source/` (also ignored) so Vite does not copy large source files
into the public build. Only optimized card illustrations and companion portraits
should be committed.
