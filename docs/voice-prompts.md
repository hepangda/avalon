# Game voice prompts

The game uses 23 short announcements in each of Chinese and English, generated with Xiaomi MiMo (`mimo-v2.5-tts`). Chinese uses 冰糖 with brisk, conversational Mandarin phrasing (target 5–6 characters per second); English uses Dean. Text lives in `src/lib/audio/voice-lines.json`.

Generate or resume missing clips:

```sh
# Set MIMO_API_KEY in .env.local, or point to a file containing only the key:
MIMO_API_KEY_FILE=/absolute/path/to/key-file npm run voices:generate
# Inspect the bilingual script without calling the API:
npm run voices:generate -- --dry-run
```

The script calls the official `https://api.xiaomimimo.com/v1/chat/completions` endpoint. Keys are used only by the local generation process. Requests contain the fixed prompt text, with no player data. See [MiMo speech synthesis documentation](https://mimo.mi.com/docs/en-US/quick-start/usage-guide/audio/speech-synthesis-v2.5).

Each successful WAV is saved in `public/audio/announcer/{zh,en}` and recorded in `src/lib/audio/voice-manifest.json`. Commit both the generated clips and the manifest. Filenames include a hash of the text, voice, model and style; unchanged completed clips are skipped on reruns. New accounts default to effects enabled and narration disabled. Sound and voice volume, switches, and notification preferences sync through `/api/auth/preferences`; browser notification permission is still device-specific.

The build includes WAV files in the existing content-addressed static asset/CDN manifest.

Playback follows the interface language and account audio preferences. Functions contains sound, background notification and independent voice controls; switching voice off immediately stops narration and saves to the account on the server. Browser audio unlock requires a click or keypress first. Announcements run serially after public reveal animations settle; a new reveal cancels older speech. Initial arrival, reconnection, rollback, unchanged snapshots and hidden tabs do not replay past announcements. Private roles and Lady inspection results are never spoken. Missing audio does not block play.

Discussion announcements name the current speaker by their displayed seat number (1–10), for example “3号玩家请发言。” / “Player 3, please speak.” They follow the discussion order, resolving player IDs to seats rather than treating speaking order as a seat number.
