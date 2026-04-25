import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(express.json({ limit: '256kb' }));
app.use(express.static(path.join(__dirname, 'public')));

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

app.post('/api/chat', async (req, res) => {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key || key === 'replace-me') {
    return res.status(500).json({ error: 'OPENROUTER_API_KEY not set in .env' });
  }

  const { messages } = req.body ?? {};
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages array required' });
  }

  try {
    const upstream = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`,
        'HTTP-Referer': 'http://localhost:5173',
        'X-Title': 'Voice PA Scheduler'
      },
      body: JSON.stringify({
        model: process.env.OPENROUTER_MODEL || 'nvidia/nemotron-3-super-120b-a12b:free',
        messages,
        response_format: { type: 'json_object' },
        temperature: 0.2
      })
    });

    const data = await upstream.json();
    if (!upstream.ok) {
      return res.status(upstream.status).json({ error: data?.error?.message || 'upstream error', raw: data });
    }
    const content = data?.choices?.[0]?.message?.content ?? '';
    res.json({ content });
  } catch (err) {
    res.status(500).json({ error: String(err?.message || err) });
  }
});

const port = Number(process.env.PORT) || 5173;
app.listen(port, () => {
  console.log(`Voice PA Scheduler running at http://localhost:${port}`);
});
