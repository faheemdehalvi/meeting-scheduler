# Project context — Voice PA Scheduler

A snapshot of what this project is, what we've built, and what's still open.
Last updated: 2026-04-26.

## Goal

A friction-free meeting scheduler operated entirely by voice. Speak naturally
("schedule a 30-min sync with Priya tomorrow at 4pm about the launch") and the
app should produce a calendar event that drops cleanly into both Google
Calendar and Apple Calendar, with no manual form-filling.

The app is intended to act like every person's lightweight personal assistant
for the single task of "get this meeting on my calendar".

## Decisions made

| Question | Choice | Reason |
|---|---|---|
| Form factor | Static frontend + tiny Node/Express server | Zero install for the user, runs locally via `npm start`. Avoids the React/Vite/Electron tax. |
| Speech in/out | Browser Web Speech API (`SpeechRecognition` + `speechSynthesis`) | Free, no API keys for voice. Works in Chrome/Edge out of the box. |
| LLM brain | OpenRouter → `nvidia/nemotron-3-super-120b-a12b:free` | User's choice. Free tier on OpenRouter, strong enough for structured-JSON intent parsing. |
| Calendar integration | Google Calendar deep link + downloadable `.ics` | No OAuth setup. Single click adds to Google; `.ics` opens natively in Apple Calendar / Outlook. Ships in one evening. |
| API key handling | Server-side via `.env`, proxied through `/api/chat` | Keeps the OpenRouter key out of browser code and out of the public repo. |

We considered but rejected (for now): full Google OAuth (heavier setup, not
needed to "ship tonight"), local-LLM via Ollama (too slow on the user's GTX
1660 laptop), Electron/desktop app (extra scaffolding for no real gain).

## Architecture

```
browser (Chrome/Edge)                  localhost:5173 (Node)
┌─────────────────────────┐           ┌──────────────────────┐
│ index.html              │           │ server.js            │
│ styles.css              │ ──GET──▶  │  - serves /public/*  │
│ app.js                  │           │  - POST /api/chat    │
│  - Web Speech in/out    │           │     proxies to       │
│  - .ics + gcal builders │ ──POST──▶ │     OpenRouter       │
└─────────────────────────┘           └──────────────────────┘
            │                                   │
            │                                   ▼
            │                          OpenRouter API
            │                          (Nemotron 3 Super)
            ▼
  Google Calendar deep link  /  .ics download
```

**Conversation loop:** Mic captures speech → transcript posted to LLM with a
system prompt forcing JSON output → LLM returns either `{action: "ask"}`
(clarifying question, mic auto-reopens) or `{action: "create", event: {...}}`
(spoken confirmation + event card with both calendar links).

## File map

- `server.js` — Express server, `/api/chat` proxy, static file serving.
- `package.json` — express + dotenv only, no build step.
- `.env` — `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`, `PORT`. Gitignored.
- `.env.example` — placeholder version, safe to commit.
- `.gitignore` — excludes `node_modules`, `.env`, logs.
- `public/index.html` — single page: conversation log, event card, mic button.
- `public/styles.css` — dark theme, gradient mic, pulse animation when recording.
- `public/app.js` — Web Speech wiring, LLM dialogue, `.ics` + Google Calendar
  link builders, conversation state machine.
- `CONTEXT.md` — this file.

## Run it

```bash
cd "C:\Users\Faheem\faheems crazy conspiracy theories\voice-pa-scheduler"
npm install   # first time only
npm start
```

Then open <http://localhost:5173> in Chrome or Edge. Allow mic access. Tap the
mic button and speak.

## What we verified is working

- Server boots on port 5173.
- Static files (`/`, `/app.js`, `/styles.css`) serve correctly.
- OpenRouter proxy authenticates with the key in `.env`.
- Nemotron parses a real prompt ("schedule a 30 min sync with Priya tomorrow
  at 4pm about the launch") and returns a valid event JSON with the right
  ISO 8601 timestamps and a 30-min default duration.
- Google Calendar URL builder produces correct UTC conversions.
- `.ics` output is RFC-5545 compliant.

What we have not verified end-to-end (requires a browser session): mic
capture, on-screen transcript, TTS playback, the click-through to Google
Calendar / `.ics` download. These should work but haven't been exercised in
an actual browser yet.

## Known limitations

- **Browser support:** Web Speech recognition is Chrome/Edge only. Firefox
  users will see an "unsupported" message.
- **No persistence:** Each page reload starts a fresh conversation. There's
  no event history.
- **No direct calendar write:** The user still clicks "Add to Google
  Calendar" or opens the `.ics` — we don't push events directly. This is a
  deliberate trade-off to skip OAuth.
- **Single user, local only:** The Node server binds to localhost. Not
  designed for multi-user or public deployment as-is.
- **No attendee invites:** Even if the user names attendees with emails, the
  events won't actually email those people unless the user manually saves
  the event in their own calendar (which then sends the invite).

## Open follow-ups

1. **Rotate the OpenRouter API key.** The original key was pasted in chat
   logs and should be regenerated at <https://openrouter.ai/keys>.
2. (Optional) Add Google OAuth so events drop straight into the user's
   Google Calendar without the click-through.
3. (Optional) Wake-word / always-on listening mode instead of tap-to-talk.
4. (Optional) Add an "edit before saving" voice command flow.
5. (Optional) Persist past meetings in `localStorage` for quick re-use.

## Security notes

- The OpenRouter key lives only in `.env` (gitignored). It's never sent to
  the browser; the frontend talks to `/api/chat` on the local server, which
  then talks to OpenRouter.
- Server only listens on localhost; not exposed to the network.
- No user data is stored or logged beyond the in-memory conversation array
  for the current page session.
