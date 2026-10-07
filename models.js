// Liste les modèles réellement disponibles pour les clés de l'utilisateur et les classe (abonnement gratuit ou payant).
import { userKeys, json } from '../../lib/util.js';
const BAD = /whisper|guard|tts|orpheus|playai|embed|compound|safeguard|image|live|audio|robotics|computer|aqa/i;
const GROQ_PREF = [/gpt-oss-120b/, /kimi-k2/, /llama-4-maverick/, /llama-3\.3-70b/, /qwen.*32b/, /gpt-oss-20b/, /llama-4-scout/, /llama-3\.1-8b/];
const rankGroq = ids => ids.filter(i => !BAD.test(i)).map(i => [GROQ_PREF.findIndex(r => r.test(i)), i])
  .sort((a, b) => (a[0] < 0 ? 99 : a[0]) - (b[0] < 0 ? 99 : b[0]) || a[1].localeCompare(b[1])).map(x => x[1]).slice(0, 6);
const rankGemini = (ids, paid) => {
  const g = { flash: [], lite: [], pro: [] };
  ids.filter(i => /^gemini-/.test(i) && !BAD.test(i)).forEach(i => (/flash-lite/.test(i) ? g.lite : /flash/.test(i) ? g.flash : /pro/.test(i) ? g.pro : []).push(i));
  const ver = i => parseFloat((/^gemini-(\d+(?:\.\d+)?)/.exec(i) || [])[1] || 0);
  for (const k in g) g[k].sort((a, b) => ver(b) - ver(a) || a.localeCompare(b));
  return [...new Set([...(paid ? g.pro.slice(0, 1) : []), g.flash[0], g.lite[0], g.flash[1], g.lite[1], g.pro[0]].filter(Boolean))].slice(0, 5);
};
export const onRequestPost = async ({ request }) => {
  const KV = userKeys(request), out = {}; let b = {}; try { b = await request.json(); } catch {}
  const paid = b.tier === 'paid';
  await Promise.all([
    KV.GROQ_API_KEY && fetch('https://api.groq.com/openai/v1/models', { headers: { Authorization: `Bearer ${KV.GROQ_API_KEY}` } })
      .then(r => r.json()).then(d => { out.groq = rankGroq((d.data || []).map(m => m.id)); }).catch(() => {}),
    KV.GEMINI_API_KEY && fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=100', { headers: { 'x-goog-api-key': KV.GEMINI_API_KEY } })
      .then(r => r.json()).then(d => { out.gemini = rankGemini((d.models || []).filter(m => (m.supportedGenerationMethods || []).includes('generateContent')).map(m => m.name.replace('models/', '')), paid);  out.tts = (d.models || []).map(m => m.name.replace('models/', '')).filter(n => /tts/i.test(n)).slice(0, 3); }).catch(() => {}),
  ]);
  return json(out);
};
