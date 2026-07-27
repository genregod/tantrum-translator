import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { runPipeline, PERSONAS, DEFAULT_PERSONA, LLM_MODEL } from './translate.js';

const app = express();
const PORT = process.env.PORT || 8787;

app.use(cors());
app.use(express.json({ limit: '2mb' }));

// Tantrums are short. 25MB is a generous ceiling for a screaming toddler.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'tantrum-translator',
    model: LLM_MODEL,
    hasElevenLabs: Boolean(process.env.ELEVENLABS_API_KEY),
    hasOpenRouter: Boolean(process.env.OPENROUTER_API_KEY),
  });
});

app.get('/personas', (_req, res) => {
  res.json({
    default: DEFAULT_PERSONA,
    personas: Object.entries(PERSONAS).map(([key, p]) => ({
      key, label: p.label, blurb: p.blurb,
    })),
  });
});

/**
 * POST /translate
 * multipart/form-data: audio=<file>, persona=<key>
 * -> { transcript, translation, personaLabel, audioBase64 }
 */
app.post('/translate', upload.single('audio'), async (req, res) => {
  const started = Date.now();
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No audio file uploaded (field name must be "audio").' });
    }
    const persona = req.body?.persona || DEFAULT_PERSONA;
    console.log(`[translate] ${req.file.size} bytes, persona=${persona}, mime=${req.file.mimetype}`);

    const result = await runPipeline(req.file.buffer, {
      filename: req.file.originalname || 'tantrum.m4a',
      mimetype: req.file.mimetype || 'audio/m4a',
      persona,
    });

    const ms = Date.now() - started;
    console.log(`[translate] done in ${ms}ms | "${result.transcript.slice(0, 60)}" -> "${result.translation.slice(0, 60)}..."`);
    res.json({ ...result, elapsedMs: ms });
  } catch (err) {
    console.error('[translate] FAILED:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/** Text-only endpoint — handy for testing without a screaming child on hand. */
app.post('/translate-text', async (req, res) => {
  try {
    const { text, persona = DEFAULT_PERSONA } = req.body || {};
    if (!text) return res.status(400).json({ error: 'Body must include "text".' });
    const { translate, speak } = await import('./translate.js');
    const translation = await translate(text, persona);
    const p = PERSONAS[persona] || PERSONAS[DEFAULT_PERSONA];
    const audio = await speak(translation, p.voiceId);
    res.json({
      transcript: text,
      translation,
      persona,
      personaLabel: p.label,
      audioBase64: audio.toString('base64'),
    });
  } catch (err) {
    console.error('[translate-text] FAILED:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Tantrum Translator server listening on http://0.0.0.0:${PORT}`);
  console.log(`  ElevenLabs: ${process.env.ELEVENLABS_API_KEY ? 'configured' : 'MISSING'}`);
  console.log(`  OpenRouter: ${process.env.OPENROUTER_API_KEY ? 'configured' : 'MISSING'}`);
});
