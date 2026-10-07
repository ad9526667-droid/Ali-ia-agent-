// Recherche web qui marche : Tavily, Brave (clés de l'utilisateur), Gemini + Google Search, puis DuckDuckGo sans clé.
import { userKeys, json } from '../../lib/util.js';
const clip = (s, n) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);
const fmt = rs => rs.slice(0, 6).map(r => `- ${clip(r.title, 90)} : ${clip(r.snippet, 260)} (${r.url})`).join('\n');
const idOk = x => typeof x === 'string' && /^[\w./:-]{2,80}$/.test(x);
const engines = {
  async tavily(q, K) {
    const r = await fetch('https://api.tavily.com/search', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + K.TAVILY_API_KEY }, body: JSON.stringify({ query: q, max_results: 6, include_answer: true }) });
    const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(String(d.detail?.error || d.error || 'HTTP ' + r.status).slice(0, 80));
    const rs = (d.results || []).map(x => ({ title: x.title, snippet: x.content, url: x.url }));
    return { notes: (d.answer ? clip(d.answer, 600) + '\n' : '') + fmt(rs), sources: rs.map(x => ({ title: x.title, url: x.url })) };
  },
  async brave(q, K) {
    const r = await fetch('https://api.search.brave.com/res/v1/web/search?count=6&q=' + encodeURIComponent(q), { headers: { 'X-Subscription-Token': K.BRAVE_API_KEY, Accept: 'application/json' } });
    const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error('HTTP ' + r.status);
    const rs = (d.web?.results || []).map(x => ({ title: x.title, snippet: x.description, url: x.url }));
    return { notes: fmt(rs), sources: rs.map(x => ({ title: x.title, url: x.url })) };
  },
  async gemini(q, K, models) {
    const ids = models.length ? models.slice(0, 3) : ['gemini-3.8-flash', 'gemini-3.8-flash-lite']; let last = 'indisponible';
    for (const m of ids) {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': K.GEMINI_API_KEY },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: `Cherche sur le web les informations à jour utiles pour : ${q}\nRésume en 150 mots maximum, en français : faits, chiffres, API ou syntaxe, bonnes pratiques.` }] }], tools: [{ google_search: {} }] }),
      });
      const d = await r.json().catch(() => ({})), c = d.candidates?.[0];
      if (r.ok && c) return { notes: (c.content?.parts || []).map(p => p.text || '').join(''), sources: (c.groundingMetadata?.groundingChunks || []).map(x => x.web).filter(Boolean).slice(0, 4).map(w => ({ title: w.title, url: w.uri })) };
      last = d.error?.message || 'HTTP ' + r.status;
    }
    throw new Error(String(last).slice(0, 80));
  },
  async ddg(q) {
    const r = await fetch('https://html.duckduckgo.com/html/?q=' + encodeURIComponent(q), { headers: { 'User-Agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36', 'Accept-Language': 'fr-FR,fr;q=0.9' } });
    const h = await r.text(), strip = s => s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').trim();
    const links = [...h.matchAll(/<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)], snips = [...h.matchAll(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g)];
    const rs = links.slice(0, 6).map((m, i) => { let u = m[1]; const x = /[?&]uddg=([^&]+)/.exec(u); if (x) u = decodeURIComponent(x[1]); else if (u.startsWith('//')) u = 'https:' + u; return { title: strip(m[2]), snippet: strip(snips[i] ? snips[i][1] : ''), url: u }; }).filter(x => /^https?:/.test(x.url));
    if (!rs.length) throw new Error('aucun résultat (page de vérification ?)');
    return { notes: fmt(rs), sources: rs.map(x => ({ title: x.title, url: x.url })) };
  },
};
export const onRequestPost = async ({ request }) => {
  const K = userKeys(request); let b = {}; try { b = await request.json(); } catch {}
  const q = String(b.query || '').slice(0, 300);
  if (!q) return json({ error: 'Question vide.' }, 400);
  const order = [K.TAVILY_API_KEY && 'tavily', K.BRAVE_API_KEY && 'brave', K.GEMINI_API_KEY && 'gemini', 'ddg'].filter(Boolean), errs = [];
  for (const e of order) {
    try { const r = await engines[e](q, K, (Array.isArray(b.models) ? b.models : []).filter(idOk)); if (r.notes && r.notes.trim()) return json({ ...r, engine: e }); errs.push(e + ' : vide'); }
    catch (x) { errs.push(e + ' : ' + x.message); }
  }
  return json({ error: 'Recherche impossible (' + errs.join(' ; ') + ')' }, 502);
};
