// يجلب أهم أخبار التعليم في السعودية عبر Claude مع البحث في الويب، ويكتب news.json.
// يعمل يوميًا من GitHub Actions. مفتاح API يُحفظ في GitHub Secrets فقط، ولا يوضع في التطبيق أبدًا.
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const API = 'https://api.anthropic.com/v1/messages';
const MODEL = process.env.NEWS_MODEL || 'claude-sonnet-5-5';

// نقبل فقط الأخبار التي رابطها ظهر فعلًا في نتائج البحث (لمنع الروابط المختلقة).
export function extract(response) {
  const allowed = new Set();
  let text = '';
  for (const b of response.content || []) {
    if (b.type === 'web_search_tool_result' && Array.isArray(b.content)) {
      b.content.forEach((r) => { if (r && r.url) allowed.add(r.url); });
    }
    if (b.type === 'text') {
      text += b.text || '';
      (b.citations || []).forEach((c) => { if (c && c.url) allowed.add(c.url); });
    }
  }
  const m = text.match(/\[[\s\S]*\]/);
  let arr = [];
  try { arr = JSON.parse(m ? m[0] : '[]'); } catch (e) { arr = []; }

  const seen = new Set();
  const items = [];
  for (const it of Array.isArray(arr) ? arr : []) {
    if (!it || typeof it.title !== 'string' || typeof it.url !== 'string') continue;
    const url = it.url.trim();
    const title = it.title.trim().slice(0, 140);
    if (!title || !/^https?:\/\//i.test(url) || !allowed.has(url) || seen.has(url)) continue;
    seen.add(url);
    const source = typeof it.source === 'string' && it.source.trim()
      ? it.source.trim()
      : new URL(url).hostname.replace(/^www\./, '');
    items.push({ title, url, source, date: typeof it.date === 'string' ? it.date : undefined });
    if (items.length >= 8) break;
  }
  return items;
}

async function callApi(key, messages) {
  const res = await fetch(API, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 3000,
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 6 }],
      messages,
    }),
  });
  if (!res.ok) throw new Error(`Anthropic API error ${res.status}: ${await res.text()}`);
  return res.json();
}

async function main() {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY غير مضبوط في GitHub Secrets.');
  const today = new Date().toISOString().slice(0, 10);

  const prompt = `تاريخ اليوم ${today}.
ابحث في الويب عن أهم أخبار التعليم في المملكة العربية السعودية خلال آخر 7 أيام (وزارة التعليم، التعليم العام والمدارس، القرارات والتعاميم، التقويم الدراسي، الجامعات).
فضّل المصادر الرسمية (moe.gov.sa وspa.gov.sa) ثم الصحف السعودية المعروفة.
أعد فقط مصفوفة JSON بين 5 و8 عناصر، كل عنصر على الشكل:
{"title": "عنوان عربي مختصر بصياغتك لا يتجاوز 90 حرفًا", "url": "رابط صفحة الخبر نفسه كما ظهر في نتائج البحث", "source": "اسم الجهة", "date": "YYYY-MM-DD إن عُرف"}
لا تخترع أي رابط، ولا تضع رابط صفحة رئيسية عامة. لا تكتب أي نص خارج المصفوفة.`;

  let messages = [{ role: 'user', content: prompt }];
  let response = await callApi(key, messages);
  for (let i = 0; i < 3 && response.stop_reason === 'pause_turn'; i += 1) {
    messages = [...messages, { role: 'assistant', content: response.content }];
    response = await callApi(key, messages);
  }

  const items = extract(response);
  if (items.length < 3) {
    throw new Error(`عدد الأخبار الصالحة قليل (${items.length}). لم يُحدَّث news.json.`);
  }
  fs.writeFileSync('news.json', JSON.stringify({ updatedAt: new Date().toISOString(), items }, null, 2), 'utf8');
  console.log(`تم تحديث news.json بـ ${items.length} أخبار.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e.message || e); process.exit(1); });
}
