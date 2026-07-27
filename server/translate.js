/**
 * Core pipeline: audio -> transcript -> pompous translation -> cartoon-British audio
 *
 * PROVIDER STRATEGY (important):
 *   STT: Gemini via OpenRouter (primary). Handles toddler garble far better than
 *        strict ASR because we can *prompt* it to phonetically approximate
 *        unintelligible screaming instead of returning an empty string.
 *        ElevenLabs Scribe is used only if ELEVENLABS_API_KEY works.
 *   TTS: ElevenLabs if the key is healthy (best quality), otherwise edge-tts
 *        (free, no key, en-GB voices). The app never dies because of billing.
 *
 * Pure functions, no express imports, so this can be tested standalone.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const execFileAsync = promisify(execFile);

const ELEVEN = 'https://api.elevenlabs.io/v1';
const OPENROUTER = 'https://openrouter.ai/api/v1/chat/completions';

/**
 * Voices. We want CARTOON posh — think Wallace & Gromit / Stephen Fry doing a
 * voiceover, not a dry news bulletin.
 *
 * Each persona maps to BOTH an ElevenLabs voice and an edge-tts en-GB voice,
 * so the character survives a provider switch.
 */
export const VOICES = {
  george: { eleven: 'JBFqnCBsd6RMkjVDRZzb', edge: 'en-GB-RyanNeural',   rate: '-8%',  pitch: '+8Hz'  },
  daniel: { eleven: 'onwK4e9ZLuTAKqWW03F9', edge: 'en-GB-ThomasNeural', rate: '-10%', pitch: '-2Hz'  },
  alice:  { eleven: 'Xb7hH8MSUJpSbSDYk0k2', edge: 'en-GB-SoniaNeural',  rate: '-5%',  pitch: '+5Hz'  },
  lily:   { eleven: 'pFZP5JQG7iQjIQuC4Bku', edge: 'en-GB-LibbyNeural',  rate: '-12%', pitch: '+12Hz' },
};

/** Cartoon delivery for ElevenLabs: low stability + high style = maximum ham. */
export const CARTOON_SETTINGS = {
  stability: 0.28,
  similarity_boost: 0.7,
  style: 0.75,
  use_speaker_boost: true,
};

export const LLM_MODEL = process.env.LLM_MODEL || 'anthropic/claude-sonnet-4.6';
export const STT_MODEL = process.env.STT_MODEL || 'google/gemini-2.5-flash';

/** Rendering personas — the *flavour* of the mockery. */
export const PERSONAS = {
  butler: {
    label: 'The Butler',
    blurb: "A long-suffering English butler relaying the young master's grievance.",
    voice: VOICES.george,
    system: `You are BARNABY, a gloriously theatrical English butler of forty years' service —
think a cartoon butler in a stately home: plummy, fussy, magnificently over-dramatic.
A toddler has just had a meltdown. You must relay their grievance to the household
in impeccable, ornate, faintly exhausted Victorian English.

RULES:
- Address the parent as "Madam" or "Sir".
- Use elaborate subordinate clauses and needlessly grand vocabulary.
- Be theatrical and a touch camp — this is a cartoon, not a documentary.
- Treat the toddler's complaint with total, absurd gravity — as though it were a
  matter of state. The comedy comes from the mismatch, never from insulting the child.
- Refer to the child as "the young master" or "the young mistress".
- 2 to 3 sentences. No emoji. No stage directions. No asterisks. No quotation marks
  wrapping the whole reply.
- Never break character to explain yourself.`,
  },
  barrister: {
    label: 'The Barrister',
    blurb: "A King's Counsel presenting the toddler's case before the court.",
    voice: VOICES.daniel,
    system: `You are a gloriously pompous King's Counsel barrister presenting a toddler's
grievance to the High Court — a cartoon of a barrister, all bluster and wig.
Translate the tantrum into formal legal submission: "My Lord, my client contends..."

RULES:
- Refer to the toddler as "my client" and the parent as "the respondent".
- Cite absurd fake precedent occasionally (e.g. "Biscuit v. Bedtime, 2019").
- Total deadpan gravity delivered with theatrical outrage.
- 2 to 3 sentences. No emoji, no stage directions, no asterisks.
- Never break character.`,
  },
  narrator: {
    label: 'The Nature Documentarian',
    blurb: 'A hushed wildlife narrator observing the specimen in its habitat.',
    voice: VOICES.george,
    system: `You are a hushed, reverent nature documentary narrator observing a small human
in the throes of a territorial display. Breathless, wondrous, faintly ridiculous.

RULES:
- Speak in hushed present tense: "Here, we observe..."
- Describe the tantrum as fascinating animal behaviour with clinical wonder.
- Affectionate, never cruel. The specimen is magnificent, simply misunderstood.
- 2 to 3 sentences. No emoji, no stage directions, no asterisks.
- Never break character.`,
  },
  diplomat: {
    label: 'The Diplomat',
    blurb: 'A UN envoy issuing a formal communiqué on behalf of the toddler.',
    voice: VOICES.alice,
    system: `You are a supremely composed career diplomat issuing an official communiqué on
behalf of a toddler delegation which has suffered a grave breach of protocol.
Crisp, clipped, magnificently over-serious — a cartoon of diplomatic froideur.

RULES:
- Use the language of international relations: "the delegation", "unilateral action",
  "we call upon the respondent party", "relations have deteriorated".
- Treat the snack/bedtime/wrong-cup incident as an international incident.
- 2 to 3 sentences. No emoji, no stage directions, no asterisks.
- Never break character.`,
  },
  duchess: {
    label: 'The Dowager Duchess',
    blurb: 'An imperious aristocrat, deeply unimpressed by absolutely everyone.',
    voice: VOICES.lily,
    system: `You are a withering Dowager Duchess of the old school — imperious, arch, and
appalled by the modern world. A toddler has had a meltdown, and you are relaying
their complaint as though dictating to a terrified secretary.

RULES:
- Grand, cutting, deliciously snobbish. Deploy withering understatement.
- Direct the disdain at the SITUATION and the indignity of it all — never at the child,
  whom you regard as the only person present with any standards.
- Occasional asides about how things were done in your day.
- 2 to 3 sentences. No emoji, no stage directions, no asterisks.
- Never break character.`,
  },
};

export const DEFAULT_PERSONA = 'butler';

function need(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required environment variable: ${name}`);
  return v;
}

/** Strip markdown/stage-direction cruft the LLM sometimes emits, so TTS doesn't read asterisks aloud. */
function cleanForSpeech(text) {
  return text
    .replace(/\*+/g, '')
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------------------------------------------------------------------------
// STT
// ---------------------------------------------------------------------------

function audioFormatFor(filename = '', mimetype = '') {
  const f = `${filename} ${mimetype}`.toLowerCase();
  if (f.includes('wav')) return 'wav';
  if (f.includes('webm')) return 'webm';
  if (f.includes('ogg')) return 'ogg';
  if (f.includes('flac')) return 'flac';
  if (f.includes('m4a') || f.includes('mp4') || f.includes('aac')) return 'm4a';
  return 'mp3';
}

/**
 * Transcribe via Gemini (OpenRouter). Prompted specifically for toddler speech:
 * we WANT the phonetic garble, not a polite empty string.
 */
async function transcribeGemini(audioBuffer, filename, mimetype) {
  const key = need('OPENROUTER_API_KEY');
  const format = audioFormatFor(filename, mimetype);
  const b64 = audioBuffer.toString('base64');

  const res = await fetch(OPENROUTER, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://github.com/tantrum-translator',
      'X-Title': 'Tantrum Translator',
    },
    body: JSON.stringify({
      model: STT_MODEL,
      max_tokens: 400,
      messages: [
        {
          role: 'system',
          content: `You transcribe audio of small children having tantrums.
Output ONLY the transcript, nothing else.
The speech will be slurred, screamed, sobbed, or barely words. That is expected.
Write what you hear phonetically if it isn't real words (e.g. "NOOO MINE MINE WAAAH bikkit").
Include screams and sobs as written sounds. Never refuse. Never editorialise.
If there is genuinely no vocal sound at all, output exactly: [no speech detected]`,
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Transcribe this tantrum verbatim.' },
            { type: 'input_audio', input_audio: { data: b64, format } },
          ],
        },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`STT (gemini) failed (${res.status}): ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content?.trim() || '';
  return text === '[no speech detected]' ? '' : text;
}

/** Transcribe via ElevenLabs Scribe. Only used when the key is healthy. */
async function transcribeElevenLabs(audioBuffer, filename, mimetype) {
  const key = need('ELEVENLABS_API_KEY');
  const form = new FormData();
  form.append('file', new Blob([audioBuffer], { type: mimetype || 'audio/m4a' }), filename || 'tantrum.m4a');
  form.append('model_id', 'scribe_v1');
  form.append('language_code', 'eng');

  const res = await fetch(`${ELEVEN}/speech-to-text`, {
    method: 'POST',
    headers: { 'xi-api-key': key },
    body: form,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`STT (elevenlabs) failed (${res.status}): ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  return (data.text || '').trim();
}

/** Public STT with fallback. Returns { text, provider }. */
export async function transcribe(audioBuffer, filename = 'tantrum.m4a', mimetype = 'audio/m4a') {
  const preferEleven = process.env.STT_PROVIDER === 'elevenlabs';
  const chain = preferEleven
    ? [['elevenlabs', transcribeElevenLabs], ['gemini', transcribeGemini]]
    : [['gemini', transcribeGemini], ['elevenlabs', transcribeElevenLabs]];

  const errors = [];
  for (const [provider, fn] of chain) {
    if (provider === 'elevenlabs' && !process.env.ELEVENLABS_API_KEY) continue;
    try {
      const text = await fn(audioBuffer, filename, mimetype);
      return { text, provider };
    } catch (err) {
      console.warn(`[stt] ${provider} failed: ${err.message}`);
      errors.push(`${provider}: ${err.message}`);
    }
  }
  throw new Error(`All STT providers failed -> ${errors.join(' | ')}`);
}

// ---------------------------------------------------------------------------
// LLM translation
// ---------------------------------------------------------------------------

export async function translate(transcript, personaKey = DEFAULT_PERSONA) {
  const key = need('OPENROUTER_API_KEY');
  const persona = PERSONAS[personaKey] || PERSONAS[DEFAULT_PERSONA];

  const userContent =
    transcript && transcript.trim().length > 1
      ? `The toddler said (as best anyone could tell): "${transcript}"`
      : `The toddler produced a sustained, wordless howl of pure grievance. No words were recoverable.`;

  const res = await fetch(OPENROUTER, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://github.com/tantrum-translator',
      'X-Title': 'Tantrum Translator',
    },
    body: JSON.stringify({
      model: LLM_MODEL,
      max_tokens: 300,
      temperature: 0.9,
      messages: [
        { role: 'system', content: persona.system },
        { role: 'user', content: userContent },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`LLM failed (${res.status}): ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error(`LLM returned no content: ${JSON.stringify(data).slice(0, 300)}`);
  return cleanForSpeech(text);
}

// ---------------------------------------------------------------------------
// TTS
// ---------------------------------------------------------------------------

async function speakElevenLabs(text, voice) {
  const key = need('ELEVENLABS_API_KEY');
  const res = await fetch(`${ELEVEN}/text-to-speech/${voice.eleven}?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text,
      model_id: 'eleven_multilingual_v2',
      voice_settings: CARTOON_SETTINGS,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`TTS (elevenlabs) failed (${res.status}): ${body.slice(0, 300)}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

/**
 * Free fallback via edge-tts. Slower rate + raised pitch gives the
 * exaggerated, sing-song cartoon-posh delivery we're after.
 */
async function speakEdge(text, voice) {
  const out = join(tmpdir(), `tt_${randomUUID()}.mp3`);
  try {
    await execFileAsync(
      'edge-tts',
      ['--voice', voice.edge, `--rate=${voice.rate}`, `--pitch=${voice.pitch}`, '--text', text, '--write-media', out],
      { timeout: 90_000 },
    );
    return await readFile(out);
  } finally {
    await unlink(out).catch(() => {});
  }
}

/** Public TTS with fallback. Returns { audio: Buffer, provider }. */
export async function speak(text, voice) {
  const v = voice || PERSONAS[DEFAULT_PERSONA].voice;
  const errors = [];

  if (process.env.ELEVENLABS_API_KEY && process.env.TTS_PROVIDER !== 'edge') {
    try {
      return { audio: await speakElevenLabs(text, v), provider: 'elevenlabs' };
    } catch (err) {
      console.warn(`[tts] elevenlabs failed, falling back to edge-tts: ${err.message}`);
      errors.push(`elevenlabs: ${err.message}`);
    }
  }

  try {
    return { audio: await speakEdge(text, v), provider: 'edge-tts' };
  } catch (err) {
    errors.push(`edge-tts: ${err.message}`);
    throw new Error(`All TTS providers failed -> ${errors.join(' | ')}`);
  }
}

// ---------------------------------------------------------------------------
// Full pipeline
// ---------------------------------------------------------------------------

/** Returns { transcript, translation, persona, personaLabel, audioBase64, providers }. */
export async function runPipeline(audioBuffer, { filename, mimetype, persona = DEFAULT_PERSONA } = {}) {
  const p = PERSONAS[persona] || PERSONAS[DEFAULT_PERSONA];
  const stt = await transcribe(audioBuffer, filename, mimetype);
  const translation = await translate(stt.text, persona);
  const tts = await speak(translation, p.voice);
  return {
    transcript: stt.text,
    translation,
    persona,
    personaLabel: p.label,
    audioBase64: tts.audio.toString('base64'),
    providers: { stt: stt.provider, tts: tts.provider, llm: LLM_MODEL },
  };
}
