// Fake OpenAI-compatible LLM for local development and the stack smoke test.
// Dependency-free (Node 24). Deterministic: the same message in the same
// dialog context always gives the same answer.
//
//   POST /v1/chat/completions  -> chat.completion with a JSON message
//   GET  /v1/models            -> the one model
//   GET  /healthz              -> "ok"
//
// It only knows the messages of the walkthrough and of the stack smoke test
// (plus a few simple patterns). Postomat itself never parses text: this file
// is a test double standing in for the real model, so matching text here is
// fine. Unknown messages come back as intent "unclear".

import { createServer } from 'node:http';

const PORT = Number(process.env.PORT ?? 8085);
const MODEL = process.env.FAKE_LLM_MODEL ?? 'fake-llm';
const TZ = 'Europe/Berlin';

const FACT_KEYS = [
  'title',
  'description',
  'date',
  'startTime',
  'endTime',
  'places',
  'costs',
  'audience',
  'trickiest',
  'isWorkshop',
];

const interpretation = (r = {}) => ({
  intent: r.intent ?? 'provide_info',
  type: r.type ?? null,
  facts: Object.fromEntries(FACT_KEYS.map((k) => [k, r.facts?.[k] ?? null])),
  consent: r.consent ?? null,
  instruction: r.instruction ?? null,
  text: r.text ?? null,
});

/** Today in Berlin as YYYY-MM-DD. */
function today() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
}

/** "11.12." → the next 11 Dec (this year or next) as YYYY-MM-DD. */
function nextDate(day, month) {
  const now = today();
  const year = Number(now.slice(0, 4));
  const pad = (n) => String(n).padStart(2, '0');
  const candidate = `${year}-${pad(month)}-${pad(day)}`;
  return candidate >= now ? candidate : `${year + 1}-${pad(month)}-${pad(day)}`;
}

/** "nächsten Freitag" → the next Friday after today. */
function nextWeekday(target) {
  const d = new Date(`${today()}T12:00:00Z`);
  do d.setUTCDate(d.getUTCDate() + 1);
  while (d.getUTCDay() !== target);
  return d.toISOString().slice(0, 10);
}

const CONSENT = {
  1: 'alle_einverstanden',
  2: 'nicht_gefragt',
  3: 'keine_personen',
};
const FREE_TEXT = ['title', 'description', 'trickiest', 'audience'];

function facts(text) {
  const f = {};
  const date = /(\d{1,2})\.(\d{1,2})\./.exec(text);
  if (date) f.date = nextDate(Number(date[1]), Number(date[2]));
  if (/nächsten freitag/i.test(text)) f.date = nextWeekday(5);
  const range = /(\d{1,2})\s*[–-]\s*(\d{1,2})\s*Uhr/i.exec(text);
  const time = /(\d{1,2})(?::(\d{2}))?\s*Uhr/i.exec(text);
  const hhmm = (h, m = '00') => `${String(h).padStart(2, '0')}:${m}`;
  if (range) {
    f.startTime = hhmm(range[1]);
    f.endTime = hhmm(range[2]);
  } else if (time) f.startTime = hhmm(time[1], time[2]);
  const places = /(\d+)\s*(Plätze|Leute|Personen)/i.exec(text);
  if (places) f.places = Number(places[1]);
  if (/kostenlos|umsonst|gratis/i.test(text)) f.costs = 'kostenlos';
  const euro = /(\d+)\s*€/.exec(text);
  if (euro)
    f.costs = `${euro[1]} €${/material/i.test(text) ? ' Material' : ''}`;
  return f;
}

function interpret({ nachricht: raw, kontext: ctx = {} }) {
  const text = String(raw ?? '').trim();
  const t = text.toLowerCase().replace(/[!.?]+$/, '');
  const expecting = ctx.erwartet ?? null;
  const cmd = {
    hilfe: 'cmd_help',
    help: 'cmd_help',
    status: 'cmd_status',
    neu: 'cmd_new',
    abbrechen: 'cmd_cancel',
    abschicken: 'confirm_submit',
    nochmal: 'retry',
  }[t];
  if (cmd) return interpretation({ intent: cmd });
  if (/^(hallo|hi|moin|hey|danke)/.test(t))
    return interpretation({ intent: 'smalltalk_or_thanks' });
  if (expecting === 'consent' && CONSENT[t])
    return interpretation({ intent: 'answer_consent', consent: CONSENT[t] });
  if (expecting === 'consent' && t === 'nein')
    return interpretation({
      intent: 'answer_consent',
      consent: 'keine_personen',
    });
  if (expecting === 'type' && (t === '1' || t === '2'))
    return interpretation({
      intent: 'choose_type',
      type: t === '1' ? 'event' : 'projekt',
    });
  if (t === 'ja') return interpretation({ intent: 'confirm_yes' });
  if (t === 'nein')
    return interpretation({
      intent: expecting === 'photo' ? 'decline_photo' : 'confirm_no',
    });
  if (t === 'weiter' || t === '-')
    return interpretation({ intent: 'skip_optional' });
  if (ctx.offeneRueckfrage)
    return interpretation({ intent: 'answer_rueckfrage', facts: facts(text) });

  // "Ich will am 11.12. einen Lötkurs machen"
  const plan =
    /^ich will (?:am \S+ |nächsten freitag )?einen? (.+?) machen$/i.exec(text);
  if (plan) {
    const title = plan[1];
    const workshop = /kurs|workshop/i.test(title);
    return interpretation({
      type: /nächsten freitag/i.test(text) ? 'event' : null,
      facts: {
        ...facts(text),
        title,
        ...(workshop ? { isWorkshop: true } : {}),
      },
    });
  }
  if (FREE_TEXT.includes(expecting))
    return interpretation({ facts: { [expecting]: text } });
  const found = facts(text);
  if (Object.keys(found).length) return interpretation({ facts: found });
  return interpretation({ intent: 'unclear' });
}

function candidate({ antwort, kandidaten = [] }) {
  const t = String(antwort ?? '')
    .trim()
    .toLowerCase();
  const n = /^([1-9])/.exec(t);
  if (n && Number(n[1]) <= kandidaten.length) return { choice: Number(n[1]) };
  if (/^(nein|keins|keines)/.test(t)) return { choice: 'none' };
  return { choice: 'unrelated' };
}

function texts({ typ, angaben: f = {} }) {
  const title = f.title ?? 'Ohne Titel';
  return {
    hookDe:
      typ === 'projekt'
        ? `Frisch aus der Werkstatt: ${title}! 🛠️`
        : `Lust auf „${title}“? 🔥`,
    bodyDe: f.description ?? `${title} im Attraktor.`,
    titleEn: title,
    bodyEn: `Join us at Attraktor makerspace in Hamburg-Altona: ${title}.`,
    shortEn: `${title} at Attraktor makerspace in Hamburg-Altona.`,
    costsEn: f.costs ? (f.costs === 'kostenlos' ? 'free' : f.costs) : null,
  };
}

function answer(messages) {
  const text = (role) =>
    messages
      .filter((m) => m.role === role)
      .map((m) =>
        typeof m.content === 'string'
          ? m.content
          : (m.content ?? []).map((p) => p.text ?? '').join(''),
      )
      .join('\n');
  const system = text('system');
  let input = {};
  try {
    input = JSON.parse(text('user'));
  } catch {
    // not one of Postomat's prompts
  }
  if (input.probe) return interpretation({ intent: 'smalltalk_or_thanks' });
  if (system.includes('Meetup-Events')) return candidate(input);
  if (system.includes('Dialog-Assistent')) return interpret(input);
  return texts(input);
}

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/healthz') {
    res.writeHead(200).end('ok');
    return;
  }
  if (req.method === 'GET' && req.url === '/v1/models') {
    send(res, 200, { object: 'list', data: [{ id: MODEL, object: 'model' }] });
    return;
  }
  if (req.method === 'POST' && req.url === '/v1/chat/completions') {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      send(res, 400, { error: { message: 'invalid JSON' } });
      return;
    }
    const content = JSON.stringify(answer(body.messages ?? []));
    send(res, 200, {
      id: `chatcmpl-${Date.now()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: body.model ?? MODEL,
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content },
          finish_reason: 'stop',
        },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    });
    return;
  }
  res.writeHead(404).end();
}).listen(PORT, () => console.log(`fake-llm listening on :${PORT}`));
