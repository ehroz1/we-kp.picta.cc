/*
 * Текст КП → слайды.
 *
 * Шаг 1. Вставка из Word / Google Docs приходит как HTML — htmlToMarkup()
 *        превращает её в простую разметку, которую видно и можно поправить:
 *          # Заголовок        — новый слайд
 *          ## Подзаголовок    — пункт с заголовком, пакет внутри «Пакетов»
 *          - пункт / 1. пункт — список
 *          | a | b | c |      — строка таблицы
 *          ---                — принудительно новый слайд
 *        Обычный текст без разметки тоже понимается: заголовки угадываются
 *        по длине строки, пустым строкам вокруг и ключевым словам.
 *
 * Шаг 2. parseMarkup() → блоки, buildSections() → разделы по заголовкам.
 *
 * Шаг 3. sectionSlides() выбирает раскладку: сначала по смыслу заголовка
 *        («Этапы», «Стоимость», «Пакеты»…), потом по форме содержимого
 *        (сколько пунктов, есть ли описания, таблица, цены). Соседние слайды
 *        стараются не повторять раскладку, синий итог — не чаще раза на 4 слайда.
 *
 * Текст не переписывается: строки только раскладываются по полям.
 * Единственное «разрезание» — «Название — описание» в пункте делится на
 * заголовок и текст пункта (разбивать на блоки гайд разрешает).
 */

/* ============================================================ утилиты */

const CURRENCY = /(₸|₽|\$|€|руб|тенге|тг\.?(?=\s|$|\/)|kzt|rub|usd|eur|сум\b)/i;
const PRICE_LINE = new RegExp(`\\d[\\d\\s\\u00A0.,]*\\s?(${CURRENCY.source})|(${CURRENCY.source})\\s?\\d|\\d\\s?%`, 'i');
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/;
const PHONE = /(\+?\d[\d\s()\-–]{8,}\d)/;
const URL_RE = /(https?:\/\/|www\.)\S+|\b[\w-]+\.(kz|ru|com|org|net|io|uz|kg|by|group|media|agency)\b/i;

function cleanText(s) {
  return String(s)
    .replace(/ /g, ' ')
    .replace(/[​-‍﻿]/g, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function wordsCount(s) { return (s.match(/\S+/g) || []).length; }

/* Похоже на заголовок: короткая строка без точки в конце. */
function headingShape(s) {
  return s.length <= 90 && wordsCount(s) <= 12 && !/[.!?…;,]$/.test(s) && /[\p{L}\d]/u.test(s);
}

/* «Название — описание» / «Название: описание» → { title, text }. */
function splitLeadIn(s) {
  const m = s.match(/^(.{2,60}?)\s+[—–-]\s+(.+)$/s) || s.match(/^([^:]{2,60}):\s+(.+)$/s);
  if (!m) return null;
  const [, a, b] = m;
  if (wordsCount(a) > 7 || /[.!?]$/.test(a)) return null;
  if (b.trim().length < 3) return null;
  return { title: a.trim(), text: b.trim() };
}

/* ======================================================= HTML → разметка */

function htmlToMarkup(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('style, script, meta, link, title, xml, o\\:p').forEach(n => n.remove());
  // Word: маркеры списков лежат в span style="mso-list:Ignore"
  const ignoreMarkers = new Set();
  doc.querySelectorAll('span').forEach(sp => {
    if (/mso-list:\s*ignore/i.test(sp.getAttribute('style') || '')) ignoreMarkers.add(sp);
  });

  const BLOCK = /^(P|H[1-6]|LI|DIV|TABLE|UL|OL|BLOCKQUOTE|PRE|SECTION|ARTICLE|HEADER|FOOTER|TR|TD|TH|DL|DT|DD)$/;
  const blocks = [];

  const isBoldEl = el => {
    const st = (el.getAttribute && el.getAttribute('style')) || '';
    const w = st.match(/font-weight:\s*(\w+)/i);
    if (w) return w[1] === 'bold' || Number(w[1]) >= 600;
    if (el.id && /^docs-internal/.test(el.id)) return false;
    return /^(B|STRONG)$/.test(el.tagName);
  };
  const sizeOf = el => {
    const st = (el.getAttribute && el.getAttribute('style')) || '';
    const m = st.match(/font-size:\s*([\d.]+)(pt|px)/i);
    if (!m) return 0;
    return m[2].toLowerCase() === 'pt' ? Number(m[1]) * 4 / 3 : Number(m[1]);
  };

  /* Текст блока с подсчётом жирных символов и максимального кегля. */
  // nested — текст абзацев внутри пункта списка (Google Docs кладёт <p> в <li>)
  function inline(el, stats, bold = false, size = 0, nested = false) {
    let s = '';
    for (const node of el.childNodes) {
      if (node.nodeType === 3) {
        const t = node.nodeValue.replace(/\s+/g, ' ');
        s += t;
        const n = t.replace(/\s/g, '').length;
        stats.chars += n;
        if (bold) stats.bold += n;
        if (size) stats.sizes.push([size, n]);
      } else if (node.nodeType === 1) {
        if (ignoreMarkers.has(node)) { stats.marker = node.textContent.trim(); continue; }
        if (node.tagName === 'BR') { s += '\n'; continue; }
        const b = isBoldEl(node) ? true : (node.style && /normal|400/.test(node.style.fontWeight) ? false : bold);
        if (BLOCK.test(node.tagName)) {
          if (nested && /^(P|DIV)$/.test(node.tagName)) s += (s.trim() ? ' ' : '') + inline(node, stats, b, sizeOf(node) || size, true);
          continue;
        }
        s += inline(node, stats, b, sizeOf(node) || size, nested);
      }
    }
    return s;
  }

  function pushBlock(el, kind, extra = {}) {
    const stats = { chars: 0, bold: 0, sizes: [], marker: '' };
    const startBold = isBoldEl(el) || /^H[1-6]$/.test(el.tagName);
    const text = inline(el, stats, startBold, sizeOf(el), kind === 'li').split('\n').map(l => cleanText(l)).filter(Boolean).join('\n');
    if (!text) { if (kind === 'p') blocks.push({ kind: 'blank' }); return; }
    let size = 0;
    if (stats.sizes.length) size = Math.max(...stats.sizes.map(([sz]) => sz));
    blocks.push(Object.assign({ kind, text, bold: stats.chars > 0 && stats.bold / stats.chars > 0.9, size, marker: stats.marker }, extra));
  }

  function walk(el, listCtx = null) {
    for (const node of el.children) {
      const tag = node.tagName;
      if (/^H[1-6]$/.test(tag)) pushBlock(node, 'h', { tagLevel: Number(tag[1]) });
      else if (tag === 'UL' || tag === 'OL') walk(node, { ordered: tag === 'OL' });
      else if (tag === 'LI') {
        if ([...node.children].some(c => c.tagName === 'UL' || c.tagName === 'OL')) {
          const clone = node.cloneNode(true);
          clone.querySelectorAll('ul, ol').forEach(n => n.remove());
          pushBlock(clone, 'li', { ordered: listCtx ? listCtx.ordered : false });
          node.querySelectorAll(':scope > ul, :scope > ol').forEach(n => walk(n, { ordered: n.tagName === 'OL' }));
        } else pushBlock(node, 'li', { ordered: listCtx ? listCtx.ordered : false });
      } else if (tag === 'TABLE') {
        const rows = [...node.querySelectorAll('tr')].map(tr => [...tr.children].map(td => cleanText(td.textContent.replace(/\s+/g, ' '))));
        if (rows.length) blocks.push({ kind: 'table', rows });
      } else if (tag === 'P' || (tag === 'DIV' && ![...node.children].some(c => BLOCK.test(c.tagName)))) {
        const cls = node.getAttribute('class') || '';
        if (/MsoListParagraph/i.test(cls) || /mso-list/i.test(node.getAttribute('style') || '')) {
          pushBlock(node, 'li');
          const last = blocks[blocks.length - 1];
          if (last && last.kind === 'li') last.ordered = /\d/.test(last.marker || '');
        } else pushBlock(node, 'p');
      } else if (node.children.length) walk(node, listCtx);
      else pushBlock(node, 'p');
    }
  }
  walk(doc.body);
  return blocksToMarkup(blocks);
}

/*
 * Блоки документа { kind: h|p|li|table|blank, text, bold, size, tagLevel } → разметка.
 * Уровни заголовков — по тегу/стилю и кеглю относительно основного текста.
 */
function blocksToMarkup(blocks) {
  const bodySizes = new Map();
  for (const b of blocks) if (b.kind === 'p' && b.size && !b.bold) bodySizes.set(b.size, (bodySizes.get(b.size) || 0) + b.text.length);
  const bodySize = bodySizes.size ? [...bodySizes.entries()].sort((a, c) => c[1] - a[1])[0][0] : 0;
  for (const b of blocks) {
    if (b.kind !== 'p') continue;
    const short = b.text.length <= 100 && !b.text.includes('\n');
    if (bodySize && b.size >= bodySize * 1.2 && short) { b.kind = 'h'; b.sizeLevel = b.size; }
    else if (b.bold && short && headingShape(b.text)) { b.kind = 'h'; b.boldOnly = true; }
  }
  const strength = b => (b.tagLevel ? 100 - b.tagLevel * 10 : 0) + (b.sizeLevel ? b.sizeLevel / 10 : 0) + (b.boldOnly ? -50 : 0);
  const heads = blocks.filter(b => b.kind === 'h');
  const levels = [...new Set(heads.map(strength))].sort((a, c) => c - a);
  // Самый крупный уровень, встречающийся один раз в начале, — название документа: он и следующий уровень — слайды.
  let sectionLevels = 1;
  if (levels.length > 1) {
    const top = heads.filter(h => strength(h) === levels[0]);
    if (top.length === 1 && blocks.indexOf(top[0]) <= 3) sectionLevels = 2;
  }
  for (const h of heads) h.md = levels.indexOf(strength(h)) < sectionLevels ? '#' : '##';

  /* Сборка текста разметки. */
  const out = [];
  for (const b of blocks) {
    if (b.kind === 'blank') { if (out.length && out[out.length - 1] !== '') out.push(''); continue; }
    if (b.kind === 'h') {
      if (out.length && out[out.length - 1] !== '') out.push('');
      out.push(`${b.md} ${b.text.replace(/\n/g, ' ')}`);
    } else if (b.kind === 'li') {
      out.push(`${b.ordered ? '1.' : '-'} ${b.text.replace(/\n/g, ' ')}`);
    } else if (b.kind === 'table') {
      for (const r of b.rows) out.push(`| ${r.join(' | ')} |`);
      out.push('');
    } else out.push(b.text);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/* ============================================================ файлы .docx */

/*
 * .docx — это ZIP: читаем каталог, распаковываем word/document.xml (и стили,
 * нумерацию) встроенным DecompressionStream и собираем те же блоки, что из HTML.
 */
async function unzipEntries(buf, wanted) {
  const u8 = new Uint8Array(buf);
  const dv = new DataView(buf);
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 66000); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a zip');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const out = {};
  const dec = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true);
    const csize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (!wanted.includes(name)) continue;
    const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
    const data = u8.subarray(start, start + csize);
    if (method === 0) out[name] = dec.decode(data);
    else if (method === 8) {
      const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      out[name] = await new Response(stream).text();
    }
  }
  return out;
}

async function docxToMarkup(buf) {
  const files = await unzipEntries(buf, ['word/document.xml', 'word/styles.xml', 'word/numbering.xml']);
  if (!files['word/document.xml']) throw new Error('no document.xml');
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const parse = x => new DOMParser().parseFromString(x, 'application/xml');
  const kids = (el, name) => [...el.childNodes].filter(n => n.nodeType === 1 && n.localName === name);
  const kid = (el, name) => el && kids(el, name)[0];
  const attr = (el, name) => el && (el.getAttributeNS(W, name) || el.getAttribute('w:' + name));

  // стили: id → уровень заголовка (Title — 1, Heading 1 — 2…)
  const styleLevel = {};
  const styleList = {};   // стили списков («List Bullet», «List Number» или с нумерацией внутри стиля)
  if (files['word/styles.xml']) {
    for (const st of parse(files['word/styles.xml']).getElementsByTagNameNS(W, 'style')) {
      const name = (attr(kid(st, 'name'), 'val') || '').toLowerCase();
      const id = attr(st, 'styleId');
      const m = name.match(/^heading (\d)/);
      if (name === 'title') styleLevel[id] = 1;
      else if (m) styleLevel[id] = Number(m[1]) + 1;
      else if (/^list (bullet|number)/.test(name)) styleList[id] = { ordered: /number/.test(name) };
      else if (kid(kid(st, 'pPr'), 'numPr')) styleList[id] = { numId: attr(kid(kid(kid(st, 'pPr'), 'numPr'), 'numId'), 'val') };
    }
  }
  // нумерация: numId → маркированный или нумерованный список
  const numOrdered = {};
  if (files['word/numbering.xml']) {
    const nx = parse(files['word/numbering.xml']);
    const abs = {};
    for (const a of nx.getElementsByTagNameNS(W, 'abstractNum')) {
      const lvl = kid(a, 'lvl');
      abs[attr(a, 'abstractNumId')] = (attr(kid(lvl, 'numFmt'), 'val') || 'bullet') !== 'bullet';
    }
    for (const n of nx.getElementsByTagNameNS(W, 'num')) numOrdered[attr(n, 'numId')] = abs[attr(kid(n, 'abstractNumId'), 'val')];
  }

  const isOn = el => el && !/^(0|false|off)$/i.test(attr(el, 'val') || '');
  function paraInfo(p) {
    let text = '', chars = 0, bold = 0, size = 0;
    const walk = node => {
      for (const c of node.childNodes) {
        if (c.nodeType !== 1) continue;
        if (c.localName === 'r') {
          const rPr = kid(c, 'rPr');
          const b = isOn(kid(rPr, 'b'));
          const sz = Number(attr(kid(rPr, 'sz'), 'val')) / 2 || 0;
          for (const t of c.childNodes) {
            if (t.nodeType !== 1) continue;
            if (t.localName === 't') {
              text += t.textContent;
              const n = t.textContent.replace(/\s/g, '').length;
              chars += n; if (b) bold += n; if (sz) size = Math.max(size, sz);
            } else if (t.localName === 'tab') text += ' ';
            else if (t.localName === 'br' || t.localName === 'cr') text += '\n';
          }
        } else if (['hyperlink', 'smartTag', 'ins', 'sdt', 'sdtContent', 'fldSimple'].includes(c.localName)) walk(c);
      }
    };
    walk(p);
    return { text, bold: chars > 0 && bold / chars > 0.9, size: size * 4 / 3 };
  }

  const blocks = [];
  const body = parse(files['word/document.xml']).getElementsByTagNameNS(W, 'body')[0];
  const visit = el => {
    for (const node of el.childNodes) {
      if (node.nodeType !== 1) continue;
      if (node.localName === 'p') {
        const pPr = kid(node, 'pPr');
        const info = paraInfo(node);
        const text = info.text.split('\n').map(l => cleanText(l)).filter(Boolean).join('\n');
        if (!text) { blocks.push({ kind: 'blank' }); continue; }
        const styleId = attr(kid(pPr, 'pStyle'), 'val');
        const lvl = styleLevel[styleId];
        const numPr = kid(pPr, 'numPr');
        const listStyle = styleList[styleId];
        if (lvl) blocks.push({ kind: 'h', text, tagLevel: lvl, bold: true, size: info.size });
        else if (numPr) blocks.push({ kind: 'li', text, ordered: Boolean(numOrdered[attr(kid(numPr, 'numId'), 'val')]) });
        else if (listStyle) blocks.push({ kind: 'li', text, ordered: listStyle.ordered != null ? listStyle.ordered : Boolean(numOrdered[listStyle.numId]) });
        else blocks.push({ kind: 'p', text, bold: info.bold, size: info.size });
      } else if (node.localName === 'tbl') {
        const rows = kids(node, 'tr').map(tr => kids(tr, 'tc').map(tc => cleanText(kids(tc, 'p').map(p => paraInfo(p).text).join(' '))));
        if (rows.length) blocks.push({ kind: 'table', rows });
      } else if (node.localName === 'sdt' || node.localName === 'sdtContent') visit(node);
    }
  };
  visit(body);
  return blocksToMarkup(blocks);
}

/* Текстовый файл или .docx → разметка для поля вставки. */
async function fileToMarkup(file) {
  if (/\.docx$/i.test(file.name) || file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    return docxToMarkup(await file.arrayBuffer());
  }
  if (/\.(html?|htm)$/i.test(file.name) || file.type === 'text/html') return htmlToMarkup(await file.text());
  return file.text();
}

/* ============================================== кусок текста → один слайд */

/*
 * Для пустого слайда: первая строка-заголовок → заголовок, абзацы → текст,
 * списки и подзаголовки → пункты. Раскладка слайда не меняется.
 */
function slideFromText(kind, text) {
  const blocks = parseMarkup(text);
  const nb = blocks.filter(b => b.type !== 'blank');
  if (!nb.length) return null;
  let title = '';
  let start = 0;
  const first = nb[0];
  if (first.type === 'h' || (first.type === 'p' && headingShape(first.text) && nb.length > 1)) {
    title = first.text;
    start = blocks.indexOf(first) + 1;
  }
  const rest = blocks.slice(start).map(b => (b.type === 'h' ? Object.assign({}, b, { sub: true }) : b));
  if (kind === 'package') return packageSlide(title, rest, 0).data;
  const d = digest(rest);
  const out = { title, lead: d.paras.join('\n\n'), items: d.items };
  if (kind === 'pricing') {
    const lines = [...d.items.map(it => (it.title && it.text ? `${it.title} — ${it.text}` : it.title || it.text)), ...d.paras];
    return { title, rows: pricingRows(lines) };
  }
  if (d.tables.length) out.table = tableData(d.tables[0]);
  if (kind === 'cover' && !title && d.paras.length) {
    out.title = d.paras[0];
    out.lead = d.paras.slice(1).join('\n\n');
  }
  return out;
}

/* ================================================== разметка → блоки */

const LI_RE = /^\s*([-–—•●▪◦·*✓✔►▸➤→]|\d{1,2}[.)]|0\d(?=\s))\s+(.*)$/;

function isTableLine(line) {
  const t = line.trim();
  if (t.startsWith('|') && (t.match(/\|/g) || []).length >= 3) return true;
  return (line.match(/\t/g) || []).length >= 1 && line.split('\t').filter(c => c.trim()).length >= 2;
}
function tableCells(line) {
  const t = line.trim();
  if (t.startsWith('|')) return t.replace(/^\||\|$/g, '').split('|').map(c => cleanText(c));
  return line.split('\t').map(c => cleanText(c));
}

function parseMarkup(text) {
  const lines = String(text).replace(/\r\n?/g, '\n').replace(/ /g, ' ').replace(/[​-‍﻿]/g, '').split('\n');
  const blocks = [];
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) { blocks.push({ type: 'blank' }); continue; }
    let m;
    if (/^\s*(-{3,}|\*{3,}|_{3,}|={3,})\s*$/.test(line)) { blocks.push({ type: 'break' }); continue; }
    if (/^\s*\|?\s*:?-{3,}/.test(line) && line.includes('|')) continue;          // разделитель markdown-таблицы
    if ((m = line.match(/^\s*(#{1,6})\s+(.*)$/))) { blocks.push({ type: 'h', level: m[1].length, text: cleanText(m[2]), explicit: true }); continue; }
    if (isTableLine(line)) {
      const last = blocks[blocks.length - 1];
      const cells = tableCells(line);
      if (last && last.type === 'table') last.rows.push(cells);
      else blocks.push({ type: 'table', rows: [cells] });
      continue;
    }
    if ((m = line.match(/^\s*\*\*(.+)\*\*\s*:?\s*$/)) && headingShape(cleanText(m[1]))) { blocks.push({ type: 'h', level: 9, text: cleanText(line), bold: true }); continue; }
    if ((m = line.match(LI_RE))) { blocks.push({ type: 'li', ordered: /\d/.test(m[1]), text: cleanText(m[2]) }); continue; }
    blocks.push({ type: 'p', text: cleanText(line) });
  }
  return detectHeadings(blocks);
}

const SECTION_WORDS = /^(о нас|о компании|почему|зачем|проблем|задач|вызов|контекст|ситуац|что (мы )?(делаем|предлагаем|сделаем|входит|получ)|наше предложение|решени|подход|как (мы )?работаем|этапы|план|процесс|формат|результат|итог|выгод|преимуществ|польз|ценност|пакет|тариф|стоимост|цен[аы]|оплат|бюджет|инвестиц|сравнени|контакт|кейс|команда|сроки|услов)/i;

/* Заголовки в тексте без разметки: короткая строка + контекст вокруг. */
function detectHeadings(blocks) {
  const hasExplicit = blocks.some(b => b.type === 'h' && b.explicit);
  if (hasExplicit) {
    // минимальный уровень «#» — разделы, остальные — подзаголовки
    const min = Math.min(...blocks.filter(b => b.type === 'h' && b.explicit).map(b => b.level));
    for (const b of blocks) if (b.type === 'h') b.sub = b.level !== min;
    return blocks;
  }
  const firstC = blocks.findIndex(b => b.type !== 'blank');
  let lastC = blocks.length - 1;
  while (lastC >= 0 && blocks[lastC].type === 'blank') lastC--;
  const hasBlank = blocks.some((b, i) => b.type === 'blank' && i > firstC && i < lastC);
  const prevOf = i => { for (let j = i - 1; j >= 0; j--) if (blocks[j].type !== 'blank') return blocks[j]; return null; };
  const nextOf = i => { for (let j = i + 1; j < blocks.length; j++) if (blocks[j].type !== 'blank') return blocks[j]; return null; };
  const firstContent = blocks.findIndex(b => b.type !== 'blank');
  blocks.forEach((b, i) => {
    if (b.type === 'h' && b.bold) { b.sub = true; return; }
    if (b.type !== 'p' || !headingShape(b.text)) return;
    const next = nextOf(i);
    if (!next) return;
    const blankBefore = i === firstContent || (blocks[i - 1] && blocks[i - 1].type === 'blank');
    const blankAfter = blocks[i + 1] && blocks[i + 1].type === 'blank';
    const prev = prevOf(i);
    let score = 0;
    if (blankBefore) score += hasBlank ? 2 : 1;
    if (i === firstContent) score += 2;
    if (SECTION_WORDS.test(b.text)) score += hasBlank ? 2 : 3;
    if (b.text.length <= 50) score += 1;
    if (b.text === b.text.toUpperCase() && /\p{L}{3}/u.test(b.text)) score += 1;
    if (/:$/.test(b.text)) score -= 1;
    if (next.type === 'li' || next.type === 'table' || (next.type === 'p' && next.text.length > b.text.length * 1.4)) score += 1;
    if (prev && (prev.type === 'li' || (prev.type === 'p' && !headingShape(prev.text)))) score += 1;
    if (hasBlank && !blankBefore) score -= 2;
    if (blankAfter && hasBlank) score += 0.5;
    if (score >= 4) { b.type = 'h'; b.level = 1; b.sub = false; }
  });
  return blocks;
}

/* ===================================================== блоки → разделы */

function buildSections(blocks) {
  const sections = [];
  let cur = null;
  for (const b of blocks) {
    if (b.type === 'break') { cur = null; continue; }
    if (b.type === 'h' && !b.sub) {
      cur = { title: b.text, blocks: [] };
      sections.push(cur);
      continue;
    }
    if (b.type === 'blank') { if (cur) cur.blocks.push(b); continue; }
    if (!cur) { cur = { title: '', blocks: [] }; sections.push(cur); }
    cur.blocks.push(b);
  }
  return sections.filter(s => s.title || s.blocks.some(b => b.type !== 'blank'));
}

/* ========================================== содержимое раздела → поля */

/*
 * Разбирает блоки раздела на абзацы и пункты:
 *  - пункт списка + следующие за ним абзацы → пункт с описанием;
 *  - подзаголовок + абзацы → пункт «заголовок + текст»;
 *  - 3+ коротких строки подряд без знаков в конце → список без маркеров;
 *  - пары «короткая строка + абзац» (2+ раза) → пункты с заголовком.
 */
function digest(blocks) {
  const bs = blocks.filter(b => b.type !== 'blank');
  const paras = [];
  const items = [];
  const tables = [];
  let i = 0;
  const isShortP = b => b && b.type === 'p' && headingShape(b.text) && b.text.length <= 80;
  // пары «короткая строка + абзац»
  let pairs = 0;
  for (let j = 0; j + 1 < bs.length; j++) if (isShortP(bs[j]) && bs[j + 1].type === 'p' && !isShortP(bs[j + 1])) pairs++;
  // описания у пунктов списка: только если абзац идёт после нескольких пунктов,
  // иначе это заключительный абзац раздела
  const liTotal = bs.filter(b => b.type === 'li').length;
  let liWithP = 0;
  for (let j = 0; j + 1 < bs.length; j++) if (bs[j].type === 'li' && bs[j + 1].type === 'p' && !isShortP(bs[j + 1])) liWithP++;
  const attach = liWithP >= 2 || (liWithP === 1 && liTotal === 1);

  while (i < bs.length) {
    const b = bs[i];
    if (b.type === 'table') { tables.push(b.rows); i++; continue; }
    if (b.type === 'li') {
      const item = itemFrom(b.text);
      i++;
      const desc = [];
      while (attach && i < bs.length && bs[i].type === 'p' && !isShortP(bs[i]) && b.text.length <= 90) { desc.push(bs[i].text); i++; }
      if (desc.length) {
        if (item.title) item.text += '\n' + desc.join('\n');
        else { item.title = item.text; item.text = desc.join('\n'); }
      }
      items.push(item);
      continue;
    }
    if (b.type === 'h') {
      i++;
      const desc = [];
      while (i < bs.length && (bs[i].type === 'p' || bs[i].type === 'li')) { desc.push(bs[i].text); i++; }
      items.push({ title: b.text, text: desc.join('\n') });
      continue;
    }
    // список без маркеров: 3+ коротких строк подряд
    let run = 0;
    while (i + run < bs.length && isShortP(bs[i + run])) run++;
    if (run >= 3) {
      for (let j = 0; j < run; j++) items.push(itemFrom(bs[i + j].text));
      i += run;
      continue;
    }
    if (pairs >= 2 && isShortP(b) && bs[i + 1] && bs[i + 1].type === 'p' && !isShortP(bs[i + 1])) {
      items.push({ title: b.text, text: bs[i + 1].text });
      i += 2;
      continue;
    }
    paras.push(b.text);
    i++;
  }
  return { paras, items, tables };
}

function itemFrom(text) {
  const sp = splitLeadIn(text);
  return sp ? { title: sp.title, text: sp.text } : { title: '', text };
}

/* =================================================== выбор раскладки */

const INTENTS = [
  ['contacts', /контакт|связ[ьа]т|свяжи|обсуд|спасибо|до встречи|ждём|ждем|напишите|звоните/i],
  ['quote', /отзыв|цитат|говорят о нас|что говорят|рекомендац|мнение клиент/i],
  ['case', /кейс|история успеха|пример работы|реализованн|наш опыт/i],
  ['compare', /сравнени|сравнит/i],
  ['pricing', /стоимост|цен[аы]\b|цены|оплат|бюджет|инвестиц|прайс|расч[её]т/i],
  ['packages', /пакет|тариф|варианты (сотрудничества|участия)|уровни/i],
  ['stats', /в цифрах|цифры|факты|показател|статистик|достижени|охват/i],
  ['summary', /итог|результат|резюм|что (вы )?получ|эффект|вывод|в сухом остатке/i],
  ['timeline', /дорожн|таймлайн|timeline|roadmap|по месяцам|календарн|график работ|сроки/i],
  ['stages', /этап|шаг[иов]?\b|план|как (мы )?работа|процесс/i],
  ['problem', /проблем|вызов|контекст|ситуац|почему сейчас|боль|сложност|рынок|сегодня/i],
  ['benefits', /зачем|почему|польз|преимуществ|ценност|выгод|для чего|что (это )?да[её]т|что вы получите/i],
  ['whatwedo', /что (мы )?(делаем|предлагаем|сделаем)|решени|подход|наше предложение|механик|как это работает|услуг|предлагаем/i],
  ['list', /формат|канал|площадк|инструмент|состав|что входит|включ|перечень|список|направлен|кейс|клиент/i],
];

const PACKAGE_NAME = /^(пакет|тариф)\b|^(base|basic|start|lite|light|standard|pro|business|premium|enterprise|vip|max|gold|silver|platinum|optimum|базов\w*|старт\w*|стандарт\w*|оптим\w*|премиум\w*|максим\w*|бизнес)\b/i;

function intentOf(title) {
  for (const [k, re] of INTENTS) if (re.test(title)) return k;
  return null;
}

function levelOf(name, idx) {
  if (/premium|премиум|vip|max|максим|enterprise|platinum|gold/i.test(name)) return 3;
  if (/\bpro\b|standard|стандарт|optimum|оптим|business|бизнес|silver/i.test(name)) return 2;
  if (/base|basic|start|старт|lite|light|базов/i.test(name)) return 1;
  return Math.min(3, idx + 1);
}

/* «120+», «40 %», «×3», «1,5 млн» — число как заголовок карточки «Цифры». */
const NUM_TITLE = /^[~≈<>+−\-×]?\s?\d[\d\s.,]*\s?(%|\+|x|х|×|млн\.?|млрд\.?|тыс\.?|k|m|₸|₽|\$|€)?\+?$/i;
const NUM_LEAD = /^([~≈<>+−\-×]?\s?\d[\d\s.,]*\s?(?:%|\+|x|х|×|млн\.?|млрд\.?|тыс\.?|k|m|₸|₽|\$|€)?\+?)\s+(\S.*)$/i;
/* «1 месяц», «2–3 неделя», «Q1», «Январь», «2026» — срок шага дорожной карты. */
const TIME_TITLE = /^(\d+\s?([–-]\s?\d+)?\s?-?(й|я)?\s?(мес|месяц|недел|день|дня|дней|квартал|год)|(месяц|неделя|квартал|этап|шаг|день|фаза)\s?\d|q[1-4]\b|(янв|фев|мар|апр|ма[йя]|июн|июл|авг|сен|окт|ноя|дек)|20\d\d)/i;

/* Пункты «120+ публикаций в СМИ» → { title: '120+', text: 'публикаций в СМИ' }. */
function statItems(items) {
  return items.map(it => {
    if (has(it.title) || !has(it.text)) return it;
    const m = it.text.match(NUM_LEAD);
    return m && m[1].replace(/\D/g, '').length <= 7 ? { title: m[1].trim(), text: m[2].trim() } : it;
  });
}

function priceLike(s) { return PRICE_LINE.test(s) && /\d/.test(s); }
function contactLike(s) { return EMAIL.test(s) || (PHONE.test(s) && /\+|\(/.test(s)) || URL_RE.test(s); }

const CAP = { list: 14, whatwedo: 7, stages: 8, benefits: 4, problem: 6, package: 12, contacts: 6, summary: 4, text: 10, thesis: 6 };

function chunk(arr, size) {
  if (arr.length <= size) return [arr];
  const parts = Math.ceil(arr.length / size);
  const per = Math.ceil(arr.length / parts);
  const out = [];
  for (let i = 0; i < arr.length; i += per) out.push(arr.slice(i, i + per));
  return out;
}

function mk(kind, fields) { return { kind, data: Object.assign(emptyData(), fields) }; }

/* Раздел целиком — пакет (заголовок «BASE …» или «Пакет …»). */
function packageSlide(title, blocks, idx) {
  const bs = blocks.filter(b => b.type !== 'blank');
  let lead = '', label = '', price = '';
  const items = [];
  const notes = [];
  for (const b of bs) {
    if (b.type === 'li') { items.push(itemFrom(b.text)); continue; }
    if (b.type === 'h') { items.push({ title: '', text: b.text }); continue; }
    if (b.type === 'table') { for (const r of b.rows) items.push({ title: '', text: r.filter(Boolean).join(' — ') }); continue; }
    const t = b.text;
    if (!price && priceLike(t) && t.length <= 70 && CURRENCY.test(t)) { price = t; continue; }
    if (!label && /^(вс[её] из|все из|всё,? что|включает вс[её]|\+\s*вс[её])/i.test(t)) { label = t; continue; }
    if (!label && /:$/.test(t) && t.length <= 60 && !items.length) { label = t; continue; }
    if (!lead && !items.length) { lead = t; continue; }
    if (!items.length || headingShape(t)) items.push({ title: '', text: t });
    else notes.push(t);
  }
  return mk('package', { title, lead, label, items, price, note: notes.join('\n'), level: levelOf(title, idx) });
}

/* Строки стоимости: «Подпись — значение», скидки «−20%» уходят в крупную плашку. */
function pricingRows(lines) {
  const rows = [];
  for (const raw of lines) {
    const sp = raw.match(/^(.{2,80}?)\s*(?:[—–]|\s-\s|:|\t)\s*(.+)$/);
    let label = raw, value = '';
    if (sp && /\d/.test(sp[2])) { label = sp[1].trim(); value = sp[2].trim(); }
    const row = emptyRow();
    row.label = label;
    if (value && /%/.test(value) && !CURRENCY.test(value) && value.length <= 24) row.badge = value;
    else row.value = value;
    if (!value && rows.length && !/\d/.test(raw) && raw.length <= 90 && /^[a-zа-яё(]/.test(raw)) {
      const last = rows[rows.length - 1];
      last.note = last.note ? last.note + '\n' + raw : raw;
      continue;
    }
    rows.push(row);
  }
  // стили: «за год» — синяя полоса, «6 месяцев» — голубая, «квартал» — серая
  let vivid = false;
  rows.forEach((r, i) => {
    const s = `${r.label} ${r.value} ${r.badge}`;
    if (!vivid && /год|12\s?мес|annual|year/i.test(s) && i > 0) { r.style = 'vivid'; vivid = true; }
    else if (/6\s?мес|полгод|полугод/i.test(s)) r.style = 'blue';
    else if (/квартал|3\s?мес/i.test(s)) r.style = 'gray';
    else r.style = i === 0 ? 'plain' : (r.badge ? 'blue' : 'plain');
  });
  if (!vivid) {
    const withBadge = rows.find((r, i) => i > 0 && r.badge);
    if (withBadge) withBadge.style = 'vivid';
  }
  return rows;
}

function tableData(rows) {
  const width = Math.max(...rows.map(r => r.length));
  const norm = rows.map(r => Array.from({ length: width }, (_, i) => r[i] || ''));
  const [head, ...rest] = norm;
  const cols = head.slice(1).map(name => ({ name, price: '' }));
  const out = { corner: head[0] || '', priceLabel: '', cols, rows: [] };
  for (const r of rest) {
    if (/^(стоимость|цена|итого|сумма|price)/i.test(r[0]) && r.slice(1).some(c => /\d/.test(c))) {
      out.priceLabel = r[0];
      r.slice(1).forEach((c, j) => { if (cols[j]) cols[j].price = c; });
    } else out.rows.push({ name: r[0], cells: r.slice(1) });
  }
  return out;
}

/*
 * Раздел → один или несколько слайдов. ctx: { prevKinds, idx, packIdx }.
 */
function sectionSlides(sec, ctx) {
  const title = sec.title;
  const intent = title ? intentOf(title) : null;
  const bs = sec.blocks.filter(b => b.type !== 'blank');
  const out = [];
  // в разделе «Пакеты» строки-названия («BASE», «Пакет PRO») — подзаголовки пакетов
  if (intent === 'packages' && !bs.some(b => b.type === 'h')) {
    for (const b of bs) if (b.type === 'p' && PACKAGE_NAME.test(b.text) && headingShape(b.text) && b.text.length <= 60) { b.type = 'h'; b.sub = true; }
  }
  const subs = bs.filter(b => b.type === 'h');

  /* Пакеты: раздел «Пакеты» с подзаголовками или заголовок-название пакета. */
  if ((intent === 'packages' && subs.length >= 1) || (title && PACKAGE_NAME.test(title) && !subs.length)) {
    if (title && PACKAGE_NAME.test(title) && !subs.length) {
      out.push(packageSlide(title, sec.blocks, ctx.packIdx++));
      return out;
    }
    const firstSub = bs.indexOf(subs[0]);
    const intro = bs.slice(0, firstSub);
    const introD = digest(intro);
    out.push(mk('thesis', { title, lead: introD.paras.join('\n\n'), items: introD.items }));
    for (let s = 0; s < subs.length; s++) {
      const from = bs.indexOf(subs[s]) + 1;
      const to = s + 1 < subs.length ? bs.indexOf(subs[s + 1]) : bs.length;
      out.push(packageSlide(subs[s].text, bs.slice(from, to), ctx.packIdx++));
    }
    return out;
  }

  /* Цитата: подпись раздела — надпись, самая длинная строка — цитата, следующие — автор и должность. */
  if (intent === 'quote' && bs.length && bs.length <= 5 && !bs.some(x => x.type === 'table')) {
    const texts = bs.map(x => x.text);
    const qi = texts.reduce((a, t, i) => (t.length > texts[a].length ? i : a), 0);
    const rest = texts.filter((_, i) => i !== qi);
    out.push(mk('quote', { label: title, title: texts[qi], lead: rest[0] || '', note: rest.slice(1).join('\n') }));
    return out;
  }

  const d = digest(sec.blocks);
  const { paras, items, tables } = d;

  /* Таблица → сравнение (если строк много — на несколько слайдов). */
  if (tables.length) {
    for (const rows of tables) {
      if (rows.length < 2) { items.push(...rows.map(r => ({ title: '', text: r.filter(Boolean).join(' — ') }))); continue; }
      const t = tableData(rows);
      const parts = chunk(t.rows, 10);
      parts.forEach((part, pi) => {
        out.push(mk('compare', {
          title,
          table: Object.assign({}, t, { rows: part, cols: t.cols.map(c => ({ name: c.name, price: pi === parts.length - 1 ? c.price : '' })) }),
          note: pi === parts.length - 1 ? paras.join('\n') : '',
        }));
      });
    }
    if (!items.length) return out;
  }

  /* Стоимость: заголовок про деньги или несколько строк с ценами. */
  const lines = [...items.map(it => it.title && it.text ? `${it.title} — ${it.text}` : (it.title || it.text)), ...paras];
  const priceLines = lines.filter(priceLike);
  if ((intent === 'pricing' && priceLines.length >= 1) || (priceLines.length >= 2 && priceLines.length >= lines.length * 0.5)) {
    const srcLines = items.length ? items.map(it => it.title && it.text ? `${it.title} — ${it.text}` : (it.title || it.text)) : paras;
    const before = items.length ? paras.filter(p => !priceLike(p)) : [];
    const rows = pricingRows(items.length ? srcLines : srcLines.filter(p => priceLike(p) || p.length <= 90));
    const rest = items.length ? [] : srcLines.filter(p => !(priceLike(p) || p.length <= 90));
    for (const part of chunk(rows, 6)) {
      out.push(mk('pricing', { title, lead: before.join('\n\n'), rows: part, note: rest.join('\n') }));
    }
    return out;
  }

  /* Контакты. */
  const contactCount = lines.filter(contactLike).length;
  if (intent === 'contacts' || contactCount >= 2) {
    const its = items.length ? items : paras.filter(p => p.length <= 90).map(p => itemFrom(p));
    const rest = items.length ? paras : paras.filter(p => p.length > 90);
    out.push(mk('contacts', { title, lead: rest.join('\n\n'), items: its.slice(0, 6) }));
    if (its.length > 6) out.push(mk('text', { items: its.slice(6) }));
    return out;
  }


  /* Кейс: задача, решение, результат — пунктами; число из результата — крупно на панели. */
  if (intent === 'case' && items.length >= 1 && items.length <= 4) {
    const slide = mk('case', { title, lead: paras.join('\n\n'), items });
    const res = items.find(it => /результат|итог|эффект/i.test(it.title)) || items[items.length - 1];
    const m = `${res.title} ${res.text}`.match(/(×\s?\d+([.,]\d+)?|[+−-]\s?\d+([.,]\d+)?\s?%|\d+([.,]\d+)?\s?%|в\s\d+\s?раз[а]?)/i);
    if (m) slide.data.big = m[1].replace(/^в\s/i, '×').replace(/\s?раз[а]?$/i, '');
    out.push(slide);
    return out;
  }

  /* Цифры: раздел «в цифрах» или пункты, начинающиеся с числа. */
  const asStats = statItems(items);
  const numeric = asStats.filter(it => NUM_TITLE.test((it.title || '').trim())).length;
  if ((intent === 'stats' && numeric >= 1 && asStats.length <= 6) || (asStats.length >= 2 && asStats.length <= 6 && numeric >= Math.ceil(asStats.length * 0.66) && intent !== 'pricing')) {
    out.push(mk('stats', { title, lead: paras.join('\n\n'), items: asStats }));
    return out;
  }

  /* Дорожная карта: раздел про сроки или пункты-сроки («1 месяц», «Q1»). */
  const timed = items.filter(it => TIME_TITLE.test((it.title || '').trim())).length;
  if (items.length >= 2 && items.length <= 8 && (intent === 'timeline' || timed >= Math.ceil(items.length * 0.66))) {
    out.push(mk('timeline', { title, lead: paras.join('\n\n'), items }));
    return out;
  }

  const n = items.length;
  const withDesc = items.filter(it => it.title && it.text).length;
  const shortItems = items.every(it => (it.title + it.text).length <= 40);
  const lead = paras.join('\n\n');
  const leadLen = lead.length;
  const avoid = k => ctx.prevKinds[ctx.prevKinds.length - 1] === k;
  const blueRecently = ctx.prevKinds.slice(-3).includes('summary');
  let kind;

  if (n === 0) {
    if (intent === 'summary' && !blueRecently && leadLen <= 420) kind = 'summary';
    else if (leadLen <= 260) kind = 'thesis';
    else kind = 'text';
  } else {
    switch (intent) {
      case 'summary': kind = !blueRecently && n <= 4 && shortItems && leadLen <= 360 ? 'summary' : (n <= 4 ? 'benefits' : 'list'); break;
      case 'stages': kind = n >= 2 && n <= 8 ? 'stages' : 'list'; break;
      case 'problem': kind = n <= 6 ? 'problem' : 'list'; break;
      case 'benefits': kind = n <= 4 ? 'benefits' : (n <= 7 ? 'whatwedo' : 'list'); break;
      case 'whatwedo': kind = n <= 7 ? 'whatwedo' : 'list'; break;
      case 'list': kind = 'list'; break;
      default: kind = null;
    }
    if (!kind) {
      if (n <= 2) kind = 'text';
      else if (n === 3) kind = withDesc ? (avoid('benefits') ? 'problem' : 'benefits') : (avoid('whatwedo') ? 'list' : 'whatwedo');
      else if (n === 4) kind = withDesc ? (avoid('stages') ? 'benefits' : 'stages') : (avoid('list') ? 'whatwedo' : 'list');
      else if (n <= 7) kind = avoid('list') ? 'whatwedo' : (avoid('whatwedo') ? 'list' : (withDesc ? 'whatwedo' : 'list'));
      else kind = 'list';
    }
    if (kind === 'whatwedo' && avoid('whatwedo')) kind = 'list';
  }

  /* Длинный текст и длинные списки — на несколько слайдов. */
  const cap = CAP[kind] || 8;
  if (n && n > cap) {
    chunk(items, cap).forEach((part, pi) => out.push(mk(kind, { title, lead: pi === 0 ? lead : '', items: part })));
    return out;
  }
  if (!n && kind === 'text' && leadLen > 1100) {
    let buf = [], len = 0;
    for (const p of paras) {
      if (len + p.length > 1000 && buf.length) { out.push(mk('text', { title, lead: buf.join('\n\n') })); buf = []; len = 0; }
      buf.push(p); len += p.length;
    }
    if (buf.length) out.push(mk('text', { title, lead: buf.join('\n\n') }));
    return out;
  }
  if (n && leadLen > 600 && kind !== 'text') {
    out.push(mk('text', { title, lead }));
    out.push(mk(kind, { title, items }));
    return out;
  }
  const slide = mk(kind, { title, lead, items });
  // итог: срок или кратность из текста («Через 12 месяцев») — крупной цифрой на фоне
  if (kind === 'summary') {
    const m = `${title} ${lead}`.match(/(?:^|[\s(«])(\d{1,2})\s?(?:мес|месяц|недел|дн|раз|лет|год|x\b|х\b)/i);
    if (m) slide.data.big = m[1];
  }
  out.push(slide);
  return out;
}

/* Обложка из первого раздела; что не поместилось — следующим слайдом. */
function coverFrom(sections) {
  const first = sections[0];
  let note = '';
  let sec = first;
  const firstBlocks = first.blocks.filter(b => b.type !== 'blank');
  // одна короткая строка перед настоящим заголовком («Коммерческое предложение») — надпись над заголовком
  if (sections.length > 1 && sections[1].title) {
    if (!first.title && firstBlocks.length === 1 && firstBlocks[0].type === 'p' && firstBlocks[0].text.length <= 70) note = firstBlocks[0].text;
    else if (first.title && !firstBlocks.length && first.title.length <= 70) note = first.title;
    if (note) { sections.shift(); sec = sections[0]; }
  }
  const bs = sec.blocks.filter(b => b.type !== 'blank');
  let title = sec.title;
  let k = 0;
  if (!title && bs[0] && bs[0].type === 'p') { title = bs[0].text; k = 1; }
  let lead = '';
  if (bs[k] && bs[k].type === 'p' && bs[k].text.length <= 320) { lead = bs[k].text; k++; }
  const cover = mk('cover', { note, title, lead });
  const rest = bs.slice(k);
  sections.shift();
  if (rest.length) sections.unshift({ title: '', blocks: rest });
  return cover;
}

/*
 * Главная функция: текст → { slides, header }.
 */
function importText(text) {
  const blocks = parseMarkup(text);
  const sections = buildSections(blocks);
  if (!sections.length) return { slides: [], header: '' };
  const slides = [coverFrom(sections)];
  const ctx = { prevKinds: ['cover'], packIdx: 0 };
  for (const sec of sections) {
    for (const s of sectionSlides(sec, ctx)) {
      slides.push(s);
      ctx.prevKinds.push(s.kind);
    }
  }
  const cTitle = slides[0].data.title.replace(/\*/g, '');
  const header = cTitle.length <= 40 ? cTitle : '';
  return { slides, header };
}

/* =============================================== автоподбор иконок к пунктам */

const FALLBACK_ICONS = ['sparkle', 'target', 'lightbulb', 'rocket-launch', 'star', 'trend-up', 'shield-check', 'handshake', 'check-circle', 'flag'];
let iconStems = null;
function stemsOf() {
  if (!iconStems) {
    const all = typeof SLIDE_ICONS !== 'undefined' ? SLIDE_ICONS : {};
    iconStems = Object.entries(all).map(([name, ic]) => [name, ic.kw.toLowerCase().replace(/ё/g, 'е').split(/\s+/).filter(Boolean)]);
  }
  return iconStems;
}

/* Иконка по смыслу: контакты — по формату, остальное — по ключевым словам;
   совпадения в заголовке пункта весят втрое больше, чем в тексте. */
function suggestIcon(title, text = '', used = new Set()) {
  const raw = `${title} ${text}`;
  if (EMAIL.test(raw)) return 'envelope-simple';
  if (/telegram|телеграм|t\.me\//i.test(raw)) return 'telegram-logo';
  if (/instagram|инстаграм/i.test(raw)) return 'instagram-logo';
  if (/linkedin|линкедин/i.test(raw)) return 'linkedin-logo';
  if (/whatsapp|ватсап/i.test(raw)) return 'whatsapp-logo';
  if (/youtube|ютуб/i.test(raw)) return 'youtube-logo';
  if (PHONE.test(raw) && /\+|\(/.test(raw)) return 'phone';
  if (URL_RE.test(raw)) return 'globe';
  const wordsOf = t => String(t).toLowerCase().replace(/ё/g, 'е').match(/[\p{L}\p{N}]+/gu) || [];
  const tw = wordsOf(title), xw = wordsOf(text);
  const hit = (words, st) => words.some(w => w.startsWith(st) || (st.length >= 5 && w.includes(st)));
  let best = null, bestScore = 0;
  for (const [name, stems] of stemsOf()) {
    if (used.has(name)) continue;   // на одном слайде иконки не повторяются — берём следующую по смыслу
    let score = 0;
    for (const st of stems) {
      const weight = st.length >= 4 ? 2 : 1;
      if (hit(tw, st)) score += weight * 3;
      else if (hit(xw, st)) score += weight;
    }
    if (score > bestScore) { best = name; bestScore = score; }
  }
  return best;
}

/* Иконки для всех пунктов слайда: без повторов, если не нашлось — нейтральная из запасных. */
function suggestIcons(items) {
  const used = new Set();
  return items.map(it => {
    let name = suggestIcon(it.title || '', it.text || '', used);
    if (!name || used.has(name)) name = FALLBACK_ICONS.find(f => !used.has(f)) || name || 'sparkle';
    used.add(name);
    return `ph:${name}`;
  });
}

/* ======================================================== сверка текста */

function normWords(s) {
  return (String(s).toLowerCase().replace(/ё/g, 'е').match(/[\p{L}\p{N}]+/gu) || []);
}

/*
 * Какие слова исходного текста не попали на слайды (видимые поля).
 * Возвращает { total, missing, lines: [{ text, miss: [слова] }] }.
 */
function coverage(source, slides) {
  const strings = [];
  for (const s of slides) strings.push(...slideStrings(s));
  const all = ` ${strings.map(x => normWords(x).join(' ')).join(' ')} `;
  const pool = new Map();
  for (const w of all.split(' ')) if (w) pool.set(w, (pool.get(w) || 0) + 1);
  const take = w => { const c = pool.get(w) || 0; if (c > 0) { pool.set(w, c - 1); return true; } return false; };
  const lines = [];
  const src = [];
  for (const raw of String(source).split('\n')) {
    const line = raw.replace(/^\s*(#{1,6}|[-–—•●▪◦·*✓✔►▸➤→]|\d{1,2}[.)])\s+/, '').replace(/\|/g, ' ').trim();
    if (!line || /^(-{3,}|\*{3,})$/.test(line)) continue;
    const words = normWords(line);
    if (words.length) src.push({ line, words, whole: all.includes(` ${words.join(' ')} `) });
  }
  let total = 0, missing = 0;
  // строки, найденные целиком, забирают свои слова первыми — иначе пропажа «перетечёт» на соседние строки
  for (const l of src) { total += l.words.length; if (l.whole) l.words.forEach(take); }
  for (const l of src) {
    if (l.whole) continue;
    const miss = l.words.filter(w => !take(w));
    missing += miss.length;
    if (miss.length) lines.push({ text: l.line, miss });
  }
  return { total, missing, lines };
}

/* Короткое описание результата для окна вставки. */
function outlineOf(slides) {
  return slides.map(s => {
    const d = s.data;
    const first = d.title || (d.items[0] && (d.items[0].title || d.items[0].text)) || d.lead || (d.rows[0] && d.rows[0].label) || '';
    const count = s.kind === 'pricing' ? d.rows.length : s.kind === 'compare' ? d.table.rows.length : liveItems(d.items).length;
    return { kind: s.kind, name: KINDS[s.kind].name, text: first.replace(/\*/g, '').slice(0, 90), count };
  });
}
