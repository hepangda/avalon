import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const root = new URL('../', import.meta.url);
dotenv.config({ path: fileURLToPath(new URL('.env.local', root)), quiet: true });
const lines = JSON.parse(await readFile(new URL('src/lib/audio/voice-lines.json', root), 'utf8'));
const manifestPath = new URL('src/lib/audio/voice-manifest.json', root);
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const model = 'mimo-v2.5-tts';
const styles = {
  zh: '请用标准普通话，像和朋友玩桌游时说话一样，轻松、干脆地读出台词。语速明快，约每秒五到六个汉字，整句话连贯说完，词组内部自然连读，只在逗号处短暂停顿，句尾利落。',
  en: 'A calm, clear board game host. Concise, confident delivery at a natural pace. Read exactly the provided text, without additions.',
};
const preview = process.argv.includes('--dry-run');
const apiKey = process.env.MIMO_API_KEY || (process.env.MIMO_API_KEY_FILE
  ? (await readFile(process.env.MIMO_API_KEY_FILE, 'utf8')).trim() : '');
if (!preview && !apiKey) throw new Error('Set MIMO_API_KEY in .env.local or the environment.');
for (const locale of ['zh', 'en']) {
  const voice = locale === 'zh' ? '冰糖' : 'Dean';
  const style = styles[locale];
  const dir = new URL(`public/audio/announcer/${locale}/`, root);
  if (!preview) await mkdir(dir, { recursive: true });
  for (const [id, translations] of Object.entries(lines)) {
    const text = translations[locale];
    const hash = createHash('sha256').update(JSON.stringify({ model, voice, style, text })).digest('hex').slice(0, 12);
    const filename = `${id}-${hash}.wav`;
    const path = `/audio/announcer/${locale}/${filename}`;
    if (preview) { console.log(`${locale}/${id}: ${text}`); continue; }
    if (manifest[locale]?.[id] === path) {
      try { if ((await readFile(new URL(filename, dir))).length > 44) continue; } catch { /* regenerate missing asset */ }
    }
    const response = await fetch('https://api.xiaomimimo.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: style }, { role: 'assistant', content: text }], audio: { format: 'wav', voice } }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!response.ok) throw new Error(`MiMo ${response.status} for ${locale}/${id}; rerun to resume.`);
    const body = await response.json();
    const data = body.choices?.[0]?.message?.audio?.data;
    if (typeof data !== 'string') throw new Error(`Missing audio for ${locale}/${id}`);
    const bytes = Buffer.from(data, 'base64');
    if (bytes.length <= 44 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE') throw new Error(`Invalid WAV for ${locale}/${id}`);
    await writeFile(new URL(filename, dir), bytes);
    manifest[locale] ??= {};
    manifest[locale][id] = path;
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(`Generated ${locale}/${id} (${bytes.length} bytes)`);
  }
}
