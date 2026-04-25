# Voice PA — Meeting Scheduler

A friction-free, voice-driven meeting scheduler. Tap the mic, speak naturally
("schedule a 30-minute sync with Priya tomorrow at 4pm about the launch"),
and get a one-click calendar event for either Google Calendar or Apple
Calendar. No OAuth, no forms, no typing.

## How it works

1. The browser captures your voice with the **Web Speech API**.
2. The transcript goes to an **LLM** (NVIDIA Nemotron 3 Super via OpenRouter)
   that acts as a personal assistant — it asks clarifying questions if needed
   and produces a structured calendar event.
3. The PA speaks its confirmation back via the browser's text-to-speech.
4. You get two one-click outputs:
   - **Add to Google Calendar** — a deep link that opens a pre-filled event.
   - **Download `.ics`** — opens natively in Apple Calendar or Outlook.

No OAuth setup. No data stored anywhere except your local browser session.

## Requirements

- **Node.js 18+** (for the local server)
- **Chrome or Edge** (Web Speech recognition isn't supported in Firefox)
- An **OpenRouter API key** — free at <https://openrouter.ai/keys>

## Setup

```bash
git clone https://github.com/faheemdehalvi/meeting-scheduler.git
cd meeting-scheduler
npm install
cp .env.example .env
```

Open `.env` and paste your OpenRouter key:

```
OPENROUTER_API_KEY=sk-or-v1-your-key-here
OPENROUTER_MODEL=nvidia/nemotron-3-super-120b-a12b:free
PORT=5173
```

## Run

```bash
npm start
```

Open <http://localhost:5173> in Chrome or Edge, allow mic access, tap the
mic button, and start talking.

## Try saying

- *"Schedule a 30-minute sync with Priya tomorrow at 4pm about the launch."*
- *"Block off an hour next Tuesday morning for deep work."*
- *"Set up a coffee chat with Alex on Friday at 11."*
- *"Move my 2pm meeting to 3."*

If you don't give the PA enough information, it will ask a single short
follow-up question and re-open the mic for you.

## Project layout

```
.
├── server.js              # Express server + /api/chat proxy to OpenRouter
├── package.json
├── .env.example           # Copy to .env and fill in
├── public/
│   ├── index.html         # UI shell
│   ├── styles.css         # Dark theme
│   └── app.js             # Voice loop, LLM dialogue, .ics + gcal builders
├── CONTEXT.md             # Project state snapshot (decisions, status, follow-ups)
└── README.md
```

## Stack

- **Express** — minimal Node server (only used to keep the API key off the
  browser by proxying `/api/chat` to OpenRouter)
- **Web Speech API** — browser-native speech recognition + synthesis
- **OpenRouter / Nemotron 3 Super (free)** — LLM brain that parses intent
  and emits structured event JSON
- **No build step, no framework** — vanilla HTML/CSS/JS

## Security

- The OpenRouter API key lives only in `.env` (gitignored). It is **never**
  sent to the browser; the frontend calls the local `/api/chat` endpoint,
  which forwards the request server-side.
- The server binds to `localhost` only.
- No user data, transcripts, or events are persisted anywhere.

## Limitations

- Chrome / Edge only (Firefox doesn't ship Web Speech recognition).
- Single-user local use — not designed for public deployment as-is.
- The PA hands you a calendar link / `.ics` to click; it does not push
  events directly to your calendar account. (That would require OAuth.)

## License

MIT
