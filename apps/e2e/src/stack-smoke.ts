/**
 * Smoke test against the running docker compose stack (not part of CI):
 *   docker compose --profile channels up -d --wait
 *   pnpm nx run e2e:stack-smoke      (bot and worker must be running)
 * Uses a real encrypted DM between a scripted @lena and @postomat.
 * The bot's AI must be the fake LLM (AI_BASE_URL=http://localhost:8085/v1,
 * AI_MODEL=fake-llm): it knows exactly these messages. With Ollama the
 * dialog works too, but the wording of the answers is not fixed.
 */
import sharp from 'sharp';
import { StackUser } from './stack-client.ts';

const HS = process.env['MATRIX_HOMESERVER_URL'] ?? 'http://localhost:8008';
const BOT = process.env['SMOKE_BOT_USER'] ?? '@postomat:localhost';
const step = (s: string) => console.log(`\n▶ ${s}`);
const onlyDm = process.argv.includes('--dm-only');

const lena = await StackUser.login(HS, 'lena', 'postomat-dev');
// Log the approver in early: a new device only receives room keys for messages sent after it exists.
const kai = process.argv.includes('--approve')
  ? await StackUser.login(HS, 'kai', 'postomat-dev')
  : undefined;
try {
  step('open encrypted DM with the bot');
  const dm = await lena.client.dms.getOrCreateDm(BOT);
  const encrypted = await lena.client.crypto.isRoomEncrypted(dm);
  console.log(`  DM ${dm}, encrypted=${encrypted}`);
  if (!encrypted) throw new Error('DM is not encrypted');

  step('hilfe → bot answers (decrypted)');
  await lena.say(dm, 'hilfe');
  const help = await lena.waitFor(
    dm,
    (b) => b.includes('So funktioniert'),
    60000,
  );
  console.log(`  ✓ ${help.content.body.split('\n')[0]}`);
  if (onlyDm) process.exit(0);

  step('event dialog');
  // A draft from an earlier run: "abbrechen" asks first, "ja" discards it.
  await lena.say(dm, 'abbrechen');
  const cancel = await lena.waitFor(dm, () => true);
  if (cancel.content.body.includes('verwerfen?')) {
    await lena.say(dm, 'ja');
    await lena.waitFor(dm, (b) => b.includes('verworfen'));
  }
  const title = `Smoke-Test ${Math.random()
    .toString(36)
    .replace(/[^a-z]/g, '')
    .slice(0, 6)}`;
  await lena.say(dm, `Ich will am 11.12. einen ${title} machen`);
  await lena.waitFor(dm, (b) => b.includes('1️⃣ Event'));
  await lena.say(dm, '1');
  await lena.waitFor(dm, (b) => b.includes('Worum geht'));
  await lena.say(dm, 'Wir testen Postomat.');
  await lena.waitFor(dm, (b) => b.includes('Uhr geht'));
  await lena.say(dm, '18 Uhr, 8 Plätze, kostenlos');
  await lena.waitFor(dm, (b) => b.includes('Foto'));

  step('encrypted photo upload');
  const photo = await sharp({
    create: {
      width: 800,
      height: 600,
      channels: 3,
      background: { r: 30, g: 140, b: 200 },
    },
  })
    .jpeg()
    .toBuffer();
  await lena.sendPhoto(dm, photo);
  await lena.waitFor(dm, (b) => b.includes('Personen erkennbar'), 60000);
  await lena.say(dm, '3');
  const summary = await lena.waitFor(
    dm,
    (b) => b.includes('Super, so schicke ich es'),
    120000,
  );
  console.log(`  ✓ ${summary.content.body.split('\n').at(-1)}`);
  await lena.waitFor(dm, (b, e) => e.content.msgtype === 'm.image', 60000);

  step('abschicken');
  await lena.say(dm, 'abschicken');
  await lena.waitFor(dm, (b) => b.startsWith('Ist beim Medienteam'));
  console.log(
    '  ✓ submitted – now approve the card in #medienteam as kai or mira (Element: http://localhost:8080)',
  );

  if (kai) {
    step('kai approves with 👍');
    const room = await kai.client.resolveRoom('#medienteam:localhost');
    const card = await kai.waitFor(
      room,
      (b) => b.includes(title) && b.includes('Zur Freigabe'),
      60000,
    );
    await kai.client.sendEvent(room, 'm.reaction', {
      'm.relates_to': {
        rel_type: 'm.annotation',
        event_id: card.event_id,
        key: '👍',
      },
    });
    const done = await kai.waitFor(
      room,
      (b) => b.startsWith('Freigegeben von @kai'),
      120000,
    );
    console.log(`  ✓ ${done.content.body}`);
    const online = await lena.waitFor(
      dm,
      (b) => b.startsWith('✅ Dein'),
      60000,
    );
    console.log(`  ✓ member DM:\n${online.content.body}`);
  }
  console.log('\nSmoke test passed.');
} finally {
  lena.stop();
  kai?.stop();
}
process.exit(0);
