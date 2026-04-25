// Voice PA — meeting scheduler
// Browser STT/TTS via Web Speech API + LLM dialogue via /api/chat proxy.

const $ = (id) => document.getElementById(id);
const conversationEl = $('conversation');
const statusEl = $('status');
const micBtn = $('mic-btn');
const eventCard = $('event-card');

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
if (!SR) {
  setStatus('error', 'unsupported');
  addBubble('pa', "Your browser doesn't support the Web Speech API. Use Chrome or Edge for now.");
  micBtn.disabled = true;
}

const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const conversation = []; // {role, content}[]
let recog = null;
let recognizing = false;
let partialBubble = null;

function setStatus(kind, text) {
  statusEl.className = 'status ' + kind;
  statusEl.textContent = text;
}

function addBubble(who, text, opts = {}) {
  const div = document.createElement('div');
  div.className = 'bubble ' + who + (opts.partial ? ' partial' : '');
  div.textContent = text;
  conversationEl.appendChild(div);
  conversationEl.scrollTop = conversationEl.scrollHeight;
  return div;
}

const SYSTEM_PROMPT = () => `You are a friction-free meeting-scheduling personal assistant.
The user speaks to you and you reply with ONLY a JSON object — no prose outside JSON.

Current local datetime: ${new Date().toISOString()}
User's IANA timezone: ${tz}

Resolve relative phrases ("tomorrow", "next Tuesday at 4", "in an hour") into absolute ISO 8601 datetimes in the user's timezone.

Return one of these JSON shapes:

1) Need more info from the user:
{
  "action": "ask",
  "say": "<one short clarifying question to speak aloud>"
}

2) Ready to create the event:
{
  "action": "create",
  "say": "<one short confirmation to speak aloud, e.g. 'Scheduled your sync with Priya for tomorrow at 4pm.'>",
  "event": {
    "title": "<concise title>",
    "start": "<ISO 8601 with timezone offset, e.g. 2026-04-26T16:00:00-04:00>",
    "end":   "<ISO 8601 with timezone offset>",
    "location": "<optional, empty string if none>",
    "attendees": ["<optional emails>"],
    "description": "<optional notes/agenda>"
  }
}

Rules:
- Default meeting length is 30 minutes if user doesn't say.
- Do not invent attendee emails. Only include emails if the user said them.
- Keep "say" ONE short sentence, suitable for text-to-speech.
- If a name is given without a time/date, ask for the time. If time without title, ask what it's about.
- After you've returned "create", if the user speaks again you may modify the event by returning a new "create" object with the updated fields.`;

async function callLLM(userText) {
  conversation.push({ role: 'user', content: userText });
  setStatus('thinking', 'thinking');

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT() },
    ...conversation
  ];

  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages })
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error || 'chat failed');
  }

  let parsed;
  try {
    parsed = JSON.parse(data.content);
  } catch {
    // Some models wrap JSON in fences; salvage.
    const m = data.content.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('LLM returned non-JSON: ' + data.content.slice(0, 200));
    parsed = JSON.parse(m[0]);
  }

  conversation.push({ role: 'assistant', content: JSON.stringify(parsed) });
  return parsed;
}

function speak(text) {
  return new Promise((resolve) => {
    if (!('speechSynthesis' in window)) return resolve();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.05;
    u.pitch = 1.0;
    u.onend = resolve;
    u.onerror = resolve;
    setStatus('speaking', 'speaking');
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  });
}

function pad(n) { return String(n).padStart(2, '0'); }

function toICSDate(iso) {
  // ICS uses UTC: YYYYMMDDTHHMMSSZ
  const d = new Date(iso);
  return (
    d.getUTCFullYear() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) + 'T' +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds()) + 'Z'
  );
}

function buildGoogleCalendarLink(ev) {
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: ev.title || 'Meeting',
    dates: `${toICSDate(ev.start)}/${toICSDate(ev.end)}`,
    details: ev.description || '',
    location: ev.location || ''
  });
  if (Array.isArray(ev.attendees) && ev.attendees.length) {
    params.set('add', ev.attendees.join(','));
  }
  return 'https://calendar.google.com/calendar/render?' + params.toString();
}

function buildICS(ev) {
  const uid = crypto.randomUUID() + '@voice-pa-scheduler';
  const esc = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Voice PA Scheduler//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    'UID:' + uid,
    'DTSTAMP:' + toICSDate(new Date().toISOString()),
    'DTSTART:' + toICSDate(ev.start),
    'DTEND:' + toICSDate(ev.end),
    'SUMMARY:' + esc(ev.title || 'Meeting'),
  ];
  if (ev.location) lines.push('LOCATION:' + esc(ev.location));
  if (ev.description) lines.push('DESCRIPTION:' + esc(ev.description));
  if (Array.isArray(ev.attendees)) {
    for (const a of ev.attendees) {
      if (a) lines.push('ATTENDEE;RSVP=TRUE:mailto:' + a);
    }
  }
  lines.push('END:VEVENT', 'END:VCALENDAR');
  return lines.join('\r\n');
}

function fmtWhen(ev) {
  try {
    const start = new Date(ev.start);
    const end = new Date(ev.end);
    const sameDay = start.toDateString() === end.toDateString();
    const dateOpts = { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' };
    const timeOpts = { hour: 'numeric', minute: '2-digit' };
    if (sameDay) {
      return `${start.toLocaleDateString(undefined, dateOpts)} · ${start.toLocaleTimeString(undefined, timeOpts)} – ${end.toLocaleTimeString(undefined, timeOpts)}`;
    }
    return `${start.toLocaleString(undefined, { ...dateOpts, ...timeOpts })} → ${end.toLocaleString(undefined, { ...dateOpts, ...timeOpts })}`;
  } catch {
    return `${ev.start} → ${ev.end}`;
  }
}

function showEvent(ev) {
  $('ev-title').textContent = ev.title || 'Meeting';
  $('ev-when').textContent = fmtWhen(ev);

  const where = $('ev-where');
  if (ev.location) { where.textContent = '📍 ' + ev.location; where.classList.remove('hidden'); }
  else where.classList.add('hidden');

  const who = $('ev-who');
  if (Array.isArray(ev.attendees) && ev.attendees.length) {
    who.textContent = '👥 ' + ev.attendees.join(', ');
    who.classList.remove('hidden');
  } else who.classList.add('hidden');

  const notes = $('ev-notes');
  if (ev.description) { notes.textContent = ev.description; notes.classList.remove('hidden'); }
  else notes.classList.add('hidden');

  $('gcal-link').href = buildGoogleCalendarLink(ev);

  const ics = buildICS(ev);
  const blob = new Blob([ics], { type: 'text/calendar' });
  const url = URL.createObjectURL(blob);
  const icsLink = $('ics-link');
  icsLink.href = url;
  icsLink.download = (ev.title || 'meeting').replace(/[^a-z0-9]+/gi, '-').toLowerCase() + '.ics';

  eventCard.classList.remove('hidden');
}

function resetConversation() {
  conversation.length = 0;
  conversationEl.innerHTML = '';
  eventCard.classList.add('hidden');
  setStatus('idle', 'idle');
}

$('reset-btn').addEventListener('click', resetConversation);

// ---- Speech recognition ----

function startRecognition() {
  if (!SR || recognizing) return;
  recog = new SR();
  recog.lang = 'en-US';
  recog.interimResults = true;
  recog.continuous = false;

  let finalText = '';
  partialBubble = null;

  recog.onstart = () => {
    recognizing = true;
    micBtn.classList.add('recording');
    micBtn.querySelector('.mic-label').textContent = 'Listening… tap to stop';
    setStatus('listening', 'listening');
  };

  recog.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const t = e.results[i][0].transcript;
      if (e.results[i].isFinal) finalText += t;
      else interim += t;
    }
    const shown = (finalText + ' ' + interim).trim();
    if (!partialBubble) partialBubble = addBubble('user', shown, { partial: true });
    else partialBubble.textContent = shown;
  };

  recog.onerror = (e) => {
    setStatus('error', e.error || 'mic error');
  };

  recog.onend = async () => {
    recognizing = false;
    micBtn.classList.remove('recording');
    micBtn.querySelector('.mic-label').textContent = 'Tap to talk';
    const text = finalText.trim();
    if (partialBubble) {
      if (text) {
        partialBubble.classList.remove('partial');
        partialBubble.textContent = text;
      } else {
        partialBubble.remove();
      }
      partialBubble = null;
    }
    if (!text) { setStatus('idle', 'idle'); return; }

    try {
      const reply = await callLLM(text);
      const say = reply.say || (reply.action === 'create' ? 'Done.' : 'Could you say that again?');
      addBubble('pa', say);
      if (reply.action === 'create' && reply.event) {
        showEvent(reply.event);
      }
      await speak(say);
      setStatus('idle', 'idle');
      // Auto re-open mic if PA asked a clarifying question.
      if (reply.action === 'ask') {
        setTimeout(startRecognition, 250);
      }
    } catch (err) {
      console.error(err);
      addBubble('pa', '⚠️ ' + err.message);
      setStatus('error', 'error');
    }
  };

  try { recog.start(); } catch (err) { setStatus('error', err.message); }
}

function stopRecognition() {
  if (recog && recognizing) recog.stop();
}

micBtn.addEventListener('click', () => {
  if (recognizing) stopRecognition();
  else startRecognition();
});

setStatus('idle', 'idle');
