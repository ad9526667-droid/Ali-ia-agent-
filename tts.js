// Voix : voix perso compatible OpenAI, Microsoft Edge, Gemini TTS (clé de l'utilisateur), Workers AI. Les moteurs sont essayés dans l'ordre, vite.
import { userKeys, json } from '../../lib/util.js';
const EDGE = ['fr-FR-RemyMultilingualNeural', 'fr-FR-HenriNeural', 'fr-FR-VivienneMultilingualNeural', 'fr-FR-DeniseNeural', 'fr-FR-EloiseNeural', 'fr-CA-SylvieNeural', 'fr-BE-CharlineNeural'];
const GV = ['Charon', 'Orus', 'Puck', 'Fenrir', 'Kore', 'Aoede'];
const TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4', VER = '1-143.0.3650.75';
const esc = s => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
async function gec(skew) {
  let t = Math.floor(Date.now() / 1000) + skew + 11644473600; t -= t % 300; t *= 1e7;
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t + TOKEN));
  return [...new Uint8Array(h)].map(x => x.toString(16).padStart(2, '0')).join('').toUpperCase();
}
function collect(ws, id, text, voice, rate) {
  ws.accept(); try { ws.binaryType = 'arraybuffer'; } catch {}
  return new Promise((ok, ko) => {
    const chunks = [], timer = setTimeout(() => { try { ws.close(); } catch {} ko(new Error('délai')); }, 6000);
    ws.addEventListener('message', e => {
      if (typeof e.data === 'string') { if (e.data.includes('Path:turn.end')) { clearTimeout(timer); ws.close(); chunks.length ? ok(new Blob(chunks, { type: 'audio/mpeg' })) : ko(new Error('vide')); } return; }
      const buf = new Uint8Array(e.data), hl = (buf[0] << 8) | buf[1];
      if (new TextDecoder().decode(buf.subarray(2, 2 + hl)).includes('Path:audio')) chunks.push(buf.subarray(2 + hl));
    });
    ws.addEventListener('error', () => { clearTimeout(timer); ko(new Error('erreur de connexion')); });
    const ts = new Date().toString();
    ws.send(`X-Timestamp:${ts}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"false"},"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}\r\n`);
    ws.send(`X-RequestId:${id}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:${ts}Z\r\nPath:ssml\r\n\r\n<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='fr-FR'><voice name='${voice}'><prosody pitch='+0Hz' rate='${rate}' volume='+0%'>${esc(text)}</prosody></voice></speak>`);
  });
}
async function edge(text, voice, rate) {
  let skew = 0;
  for (let attempt = 0; attempt < 2; attempt++) {
    const id = crypto.randomUUID().replace(/-/g, ''), muid = [...crypto.getRandomValues(new Uint8Array(16))].map(x => x.toString(16).padStart(2, '0')).join('').toUpperCase();
    const url = `https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=${TOKEN}&Sec-MS-GEC=${await gec(skew)}&Sec-MS-GEC-Version=${VER}&ConnectionId=${id}`;
    const r = await fetch(url, { headers: { Upgrade: 'websocket', Pragma: 'no-cache', 'Cache-Control': 'no-cache', Cookie: 'muid=' + muid, 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0', Origin: 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold' } });
    if (!r.webSocket) {
      const d = r.headers.get('date');
      if (r.status === 403 && d && attempt === 0) { skew = Math.round((Date.parse(d) - Date.now()) / 1000); continue; } // horloge décalée : on corrige et on réessaie
      throw new Error('HTTP ' + r.status);
    }
    return collect(r.webSocket, id, text, voice, rate);
  }
}
const wav = (pcm, rate) => {
  const h = new DataView(new ArrayBuffer(44)), w = (o, s) => [...s].forEach((c, i) => h.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF'); h.setUint32(4, 36 + pcm.length, true); w(8, 'WAVEfmt '); h.setUint32(16, 16, true); h.setUint16(20, 1, true); h.setUint16(22, 1, true);
  h.setUint32(24, rate, true); h.setUint32(28, rate * 2, true); h.setUint16(32, 2, true); h.setUint16(34, 16, true); w(36, 'data'); h.setUint32(40, pcm.length, true);
  return new Blob([h, pcm], { type: 'audio/wav' });
};
async function gemini(text, K, voice, models) {
  if (!K.GEMINI_API_KEY) throw new Error('clé Gemini absente');
  const v = voice.startsWith('gemini:') && GV.includes(voice.slice(7)) ? voice.slice(7) : 'Charon';
  const ids = (Array.isArray(models) ? models : []).filter(x => /^[\w.-]{2,80}$/.test(x)).slice(0, 2); if (!ids.length) ids.push('gemini-2.5-flash-preview-tts', 'gemini-2.5-flash-tts');
  let last = 'indisponible';
  for (const m of ids) {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': K.GEMINI_API_KEY },
      body: JSON.stringify({ contents: [{ parts: [{ text: 'Dis en français, avec naturel, chaleur et dynamisme : ' + text }] }], generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: v } } } } }),
    });
    const d = await r.json().catch(() => ({})), part = d.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
    if (r.ok && part) return wav(Uint8Array.from(atob(part.inlineData.data), c => c.charCodeAt(0)), +(/rate=(\d+)/.exec(part.inlineData.mimeType || '') || [])[1] || 24000);
    last = d.error?.message || 'HTTP ' + r.status;
  }
  throw new Error(String(last).slice(0, 80));
}
async function custom(text, K) {
  if (!/^https:\/\/[\w.-]+\.[a-z]{2,}(\/|$)/i.test(K.TTS_URL || '')) throw new Error('TTS_URL invalide');
  const r = await fetch(K.TTS_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (K.TTS_KEY || '') }, body: JSON.stringify({ model: K.TTS_MODEL || 'tts-1', voice: K.TTS_VOICE || 'onyx', input: text, response_format: 'mp3' }) });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return new Blob([await r.arrayBuffer()], { type: r.headers.get('content-type') || 'audio/mpeg' });
}
export const onRequestPost = async ({ request, env }) => {
  const K = userKeys(request); let b = {}; try { b = await request.json(); } catch {}
  const voice = String(b.voice || ''), ev = EDGE.includes(voice) ? voice : EDGE[0], rate = /^[+-]\d{1,2}%$/.test(String(b.rate)) ? b.rate : '+0%';
  const run = {
    custom: t => custom(t, K), edge: t => edge(t, ev, rate), gemini: t => gemini(t, K, voice, b.ttsModels),
    ai: async t => { if (!(env && env.AI)) throw new Error('liaison Workers AI absente'); const r = await env.AI.run('@cf/myshell-ai/melotts', { prompt: t, lang: 'fr' }); return new Blob([Uint8Array.from(atob(r.audio), c => c.charCodeAt(0))], { type: 'audio/mpeg' }); },
  };
  if (b.diag) {
    const out = {};
    await Promise.all(Object.keys(run).filter(k => k !== 'custom' || K.TTS_URL).map(async k => { try { await run[k]('Test.'); out[k] = 'ok'; } catch (e) { out[k] = '✖ ' + String(e.message).slice(0, 60); } }));
    return json(out);
  }
  const text = String(b.text || '').slice(0, 600);
  if (!text) return json({ error: 'Texte vide' }, 400);
  const skip = Array.isArray(b.skip) ? b.skip : [], failed = [];
  const order = [...(K.TTS_URL ? ['custom'] : []), ...(voice.startsWith('gemini:') ? ['gemini', 'edge'] : ['edge', 'gemini']), 'ai'].filter(e => !skip.includes(e));
  for (const e of order) {
    try { const blob = await run[e](text); return new Response(blob, { headers: { 'content-type': blob.type || 'audio/mpeg', 'x-ali-tts': e, 'x-ali-tts-failed': failed.join(',') } }); }
    catch { failed.push(e); }
  }
  return json({ error: 'Voix indisponible', failed }, 502);
};
