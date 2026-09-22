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
