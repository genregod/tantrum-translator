# 👑 The Tantrum Translator

> Rendering the grievances of the very small into the Queen's English.

Record a toddler having a meltdown. The app transcribes the screaming, hands it to
an LLM playing a magnificently pompous British character, and reads the result back
in a cartoon-posh British voice.

**Input:** `"NO! I want the BLUE cup! The green cup is BROKEN! It tastes like GREEN!"`

**Output (The Dowager Duchess):**
> *"The young master has lodged a series of entirely reasonable objections — the inferior
> vessel, the geometrically compromised toast, the general atmosphere of incompetence —
> and has been met, as one has come to expect in this degraded age, with blank
> incomprehension from the staff. In my day, one's footman knew perfectly well which cup
> a person preferred without being subjected to a formal presentation of evidence…"*

---

## The interpreters

| Persona | Character |
|---|---|
| **The Butler** | A long-suffering English butler relaying the young master's grievance |
| **The Barrister** | A King's Counsel presenting the case, citing *Biscuit v. Bedtime, 2019* |
| **The Documentarian** | A hushed wildlife narrator observing the specimen |
| **The Diplomat** | A UN envoy issuing a formal communiqué |
| **The Dowager Duchess** | An imperious aristocrat, deeply unimpressed by everyone |

The comedy always points at the *situation* — never at the child.

---

## Architecture

```
Expo app  ──multipart audio──▶  Node server
                                    │
                                    ├─ 1. STT    Gemini 2.5 Flash (OpenRouter)
                                    │            └ fallback: ElevenLabs Scribe
                                    ├─ 2. LLM    Claude Sonnet 4.6 (OpenRouter)
                                    └─ 3. TTS    ElevenLabs (cartoon settings)
                                                 └ fallback: edge-tts (free, en-GB)
                                    │
Expo app  ◀──JSON + base64 mp3──────┘
```

**Why Gemini for speech-to-text?** Strict ASR returns an empty string when a
two-year-old is just screaming. Gemini can be *prompted* to phonetically approximate
the garble ("NOOO MINE MINE WAAAH bikkit") — and the garble is the whole point.

**Why the fallbacks?** So a billing hiccup on one provider never bricks the app.
Both providers are attempted in order and the response reports which one served it.

---

## Setup

### 1. Server

```bash
cd server
npm install
cp .env.example .env     # then fill in your keys
npm start
```

`.env`:
```
OPENROUTER_API_KEY=sk-or-v1-...     # required
ELEVENLABS_API_KEY=sk_...           # optional — falls back to free edge-tts
PORT=8787
```

Free TTS fallback needs `edge-tts`:
```bash
pip install edge-tts
```

Verify:
```bash
curl localhost:8787/health
curl -X POST localhost:8787/translate-text \
  -H 'Content-Type: application/json' \
  -d '{"text":"NO! I want the BLUE cup!","persona":"duchess"}'
```

### 2. App

```bash
cd app
npm install
npx expo start
```

**Important:** edit `app/config.js` and set `API_BASE` to your machine's **LAN IP**
(e.g. `http://192.168.1.100:8787`) — not `localhost`. On a physical phone,
`localhost` means the phone itself.

```bash
ifconfig | grep "inet "     # macOS / Linux
ipconfig                    # Windows
```

Then scan the QR code with **Expo Go**.

### 3. Running the server in Codespaces

Start the server, open the **Ports** tab, forward port `8787`, set visibility to
**Public**, and paste the generated `https://…app.github.dev` URL into `API_BASE`.

---

## API

**`GET /health`** — service status and which providers are configured.

**`GET /personas`** — the interpreter list (the app pulls this so it stays in sync).

**`POST /translate`** — `multipart/form-data` with `audio` (file) and `persona` (string).

**`POST /translate-text`** — `{ "text": "...", "persona": "butler" }`. Test without
a screaming child on hand.

Both translate endpoints return:
```json
{
  "transcript": "NO! I want the blue cup...",
  "translation": "Madam, I regret to inform you...",
  "personaLabel": "The Butler",
  "audioBase64": "<mp3 bytes>",
  "providers": { "stt": "gemini", "tts": "edge-tts", "llm": "anthropic/claude-sonnet-4.6" }
}
```

---

## Building for a real phone

```bash
npm install -g eas-cli
eas login
eas build:configure
eas build --platform android --profile preview   # installable .apk
eas build --platform ios --profile preview       # needs an Apple Developer account
```

---

## Cost

Roughly **$0.002 per tantrum** (Gemini Flash STT + Claude Sonnet). TTS is free
when using the edge-tts fallback.

## Licence

MIT — go forth and mock the meltdowns.
