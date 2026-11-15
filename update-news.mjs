// نسخة مجانية: تجلب أحدث عناوين أخبار محافظة الليث (في كل المجالات) من أخبار Google (RSS) وتكتب news.json.
// لا تحتاج مفتاح API ولا رصيدًا. تعمل يوميًا من GitHub Actions.
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

// استعلامات بين علامتي اقتباس لتطابق العبارة نفسها (كلمة «الليث» وحدها تلتبس بأسماء وأشياء أخرى).
// strong = العبارة نفسها كافية لتحديد المحافظة. وغير ذلك نشترط وجود «الليث» في العنوان.
const QUERIES = [
  { q: '"محافظة الليث"', strong: true },
  { q: '"محافظ الليث"', strong: true },
  { q: '"بلدية الليث"', strong: true },
  { q: '"مركز الليث"', strong: true },
  { q: '"الليث" "منطقة مكة المكرمة"', strong: false },
  { q: '"الليث" "مكة المكرمة"', strong: false },
];
const MAX_ITEMS = 10;
const MAX_PER_SOURCE = 3;
const DAYS = 30;       // أخبار محافظة أقل عددًا، فنوسّع النافذة
const MIN_ITEMS = 2;

const decode = (s) => String(s || '')
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
  .replace(/&amp;/g, '&')
  .trim();

const pick = (xml, tag) => {
  const m = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i'));
  return m ? decode(m[1]) : '';
};

// يحلّل RSS إلى عناصر {title, url, source, date}.
export function parseRss(xml) {
  const out = [];
  const re = /<item>([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = re.exec(xml))) {
    const block = m[1];
    let title = pick(block, 'title');
    const url = pick(block, 'link');
    const source = pick(block, 'source');
    const pub = pick(block, 'pubDate');
    // عناوين أخبار Google تنتهي عادةً بـ « - اسم الصحيفة »؛ نحذفها لأننا نعرض المصدر منفصلًا.
    if (source && title.endsWith(` - ${source}`)) title = title.slice(0, -(` - ${source}`).length).trim();
    const t = Date.parse(pub);
    if (!title || !/^https?:\/\//i.test(url)) continue;
    out.push({ title: title.slice(0, 140), url, source: source || '', time: Number.isNaN(t) ? 0 : t });
  }
  return out;
}

// يُبقي الأخبار المتعلقة بالليث فقط.
const NOT_LAITH = /الليث بن|الليث ابن|ليث الأسد|أسد الليث/; // أشخاص وأشياء تحمل الاسم نفسه
export function relevant(items) {
  return items.filter((it) => !NOT_LAITH.test(it.title) && (it.strong || /الليث/.test(it.title)));
}

// يدمج النتائج: بلا تكرار، الأحدث أولًا، وبحد أقصى لكل مصدر للتنويع.
export function pickItems(all, now = Date.now()) {
  const minTime = now - DAYS * 24 * 3600 * 1000;
  const seen = new Set();
  const perSource = {};
  const items = [];
  const sorted = [...all].sort((a, b) => b.time - a.time);
  for (const it of sorted) {
    if (it.time && it.time < minTime) continue;
    const key = it.title.replace(/\s+/g, ' ');
    if (seen.has(key)) continue;
    const s = it.source || 'unknown';
    if ((perSource[s] || 0) >= MAX_PER_SOURCE) continue;
    seen.add(key);
    perSource[s] = (perSource[s] || 0) + 1;
    items.push({
      title: it.title,
      url: it.url,
      source: it.source,
      date: it.time ? new Date(it.time).toISOString().slice(0, 10) : undefined,
    });
    if (items.length >= MAX_ITEMS) break;
  }
  return items;
}

async function fetchQuery({ q, strong }) {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(`${q} when:${DAYS}d`)}&hl=ar&gl=SA&ceid=SA:ar`;
  const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; class-news-bot)' } });
  if (!res.ok) throw new Error(`فشل جلب الأخبار (${res.status}) للاستعلام: ${q}`);
  return parseRss(await res.text()).map((it) => ({ ...it, strong }));
}

async function main() {
  let all = [];
  let lastError = null;
  for (const q of QUERIES) {
    try { all = all.concat(await fetchQuery(q)); } catch (e) { lastError = e; }
  }
  const items = pickItems(relevant(all));
  if (items.length < MIN_ITEMS) {
    throw new Error(`عدد الأخبار قليل (${items.length}). لم يُحدَّث news.json.${lastError ? ` آخر خطأ: ${lastError.message}` : ''}`);
  }
  fs.writeFileSync('news.json', JSON.stringify({ updatedAt: new Date().toISOString(), items }, null, 2), 'utf8');
  console.log(`تم تحديث news.json بـ ${items.length} أخبار.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e.message || e); process.exit(1); });
}

