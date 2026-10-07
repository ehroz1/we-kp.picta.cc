/*
 * Раскладки слайдов КП WE Media — единственный источник правды о том, как
 * выглядит каждый тип слайда (docs/style-guide.md, раздел 7).
 *
 * У всех слайдов одна модель данных (emptyData): заголовок, текст, пункты,
 * сноска и несколько специальных полей (пакет, таблица, строки стоимости).
 * Раскладка решает, какие поля показать и как. Поэтому раскладку можно
 * сменить в один клик — текст остаётся на месте.
 *
 * render(data, env) возвращает HTML слайда 1920×1080. env:
 *   k        — коэффициент «уместить» (подбирает app.js)
 *   num      — номер слайда «02»
 *   deck     — { header, numbers } — надпись в шапке и номера
 *   partners — [{ url, name, mono }] логотипы партнёров на обложке и в контактах
 *   preview  — true в редакторе: пустые поля показываются серыми подсказками
 *
 * У пунктов может быть иконка (item.icon: «ph:имя» из SLIDE_ICONS или «up:id»
 * из своей библиотеки). У раскладок со «слотом графики» (SLOTS) графику можно
 * сменить: data.gfx — '' (как задумано), 'none', мотив из GFX или «up:id».
 * Свои картинки (иконки, графика, фото) app.js кладёт в USER_ASSETS.
 *
 * Своё фото есть у любой раскладки: data.photo — «up:id» из библиотеки фото,
 * data.photoAt — колонка справа / слева / на половину слайда (у «Кейса» —
 * низ синей панели), data.photoFocus — какую часть кадра оставить. Слайд с
 * фото рисует renderSlide(): фото на всю высоту, рядом — та же раскладка,
 * только уже; «Уместить» подгоняет текст под новую ширину.
 *
 * Текст заказчика не меняется: typo() трогает только пробелы (неразрывные
 * после коротких слов, внутри чисел и перед тире), *звёздочки* дают синий акцент.
 */

/* ============================================================ текст */

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const NBSP = ' ';
/* Короткое слово склеивается со следующим. Цепочки не строим: «Что мы делаем» →
   «Что_мы делаем», иначе длинный неразрывный кусок не влезет в узкую колонку. */
const SHORT_WORDS = /(^|[ («„"'/])([а-яёa-z]{1,2}|без|для|под|над|при|про|или|что|как|это|все|всё|его|её|ее|нас|вас|них|нет|так|уже|ещё|еще) (?=\S)/giu;

function typo(s) {
  return String(s)
    .replace(/[ \t]+/g, ' ')
    .replace(SHORT_WORDS, `$1$2${NBSP}`)
    .replace(/(\d)[ \t](?=\d{3}(?!\d))/g, `$1${NBSP}`)          // 1 500 000
    .replace(/(\d)[ \t](?=[^\s\d])/g, `$1${NBSP}`)                // 12 месяцев, 500 ₸
    .replace(/[ \t]+(?=[—–]\s)/g, NBSP)                           // слово — тире
    .replace(/№[ \t]/g, `№${NBSP}`);
}

/* Строка заказчика → безопасный HTML: типографика, *акцент*, переносы строк. */
function rich(s) {
  return esc(typo(s))
    .replace(/\*([^*\n]+)\*/g, '<em class="acc">$1</em>')
    .replace(/\n/g, '<br>');
}

function has(s) { return typeof s === 'string' && s.trim() !== ''; }
function pad2(n) { return String(n).padStart(2, '0'); }

/* Пустое поле: в редакторе — серая подсказка, в экспорте — ничего. */
function ph(env, text) { return env.preview && text ? `<span class="ph">${esc(text)}</span>` : ''; }

function blk(tag, cls, value, hint, env, f) {
  if (has(value)) return `<${tag} class="${cls}" data-f="${f}">${rich(value.trim())}</${tag}>`;
  if (env.preview && hint) return `<${tag} class="${cls}" data-f="${f}">${ph(env, hint)}</${tag}>`;
  return '';
}

/* Абзацы через пустую строку; первый может быть оформлен иначе (лид). */
function splitParas(s) {
  return has(s) ? s.trim().split(/\n\s*\n/).map(p => p.trim()).filter(Boolean) : [];
}
function paras(value, cls, hint, env, f) {
  const ps = splitParas(value);
  if (!ps.length) return blk('p', cls, '', hint, env, f);
  if (ps.length === 1) return `<p class="${cls}" data-f="${f}">${rich(ps[0])}</p>`;
  return `<div class="${cls} paras" data-f="${f}">${ps.map(p => `<p>${rich(p)}</p>`).join('')}</div>`;
}

/* --------------------------------------------------------- пункты */

/* Свои загруженные картинки: app.js заполняет из localStorage. */
const USER_ASSETS = { icons: new Map(), graphics: new Map(), photos: new Map() };

/* Иконка пункта: Phosphor Duotone в цвете текста (синий / белый на синем) или своя картинка. */
function slideIcon(ref) {
  if (!has(ref)) return '';
  if (ref.startsWith('ph:')) {
    const ic = typeof SLIDE_ICONS !== 'undefined' && SLIDE_ICONS[ref.slice(3)];
    return ic ? `<svg viewBox="0 0 256 256" fill="currentColor" aria-hidden="true">${ic.svg}</svg>` : '';
  }
  if (ref.startsWith('up:')) {
    const a = USER_ASSETS.icons.get(ref);
    return a ? `<img src="${esc(a.url)}" alt="">` : '';
  }
  return '';
}
function ico(it, cls) {
  const inner = it && slideIcon(it.icon);
  return inner ? `<span class="ico ${cls}">${inner}</span>` : '';
}

function liveItems(items) {
  return (items || []).map((it, i) => ({ it, i })).filter(({ it }) => has(it.title) || has(it.text));
}

/* В редакторе пустой список показывает подсказки, чтобы было видно раскладку. */
function itemsFor(d, env, phCount, phSample) {
  const live = liveItems(d.items);
  if (live.length || !env.preview) return live;
  return Array.from({ length: phCount }, (_, i) => ({ it: { title: '', text: '' }, i, ph: phSample(i) }));
}

function itemInner(entry, env) {
  const { it, i } = entry;
  if (entry.ph) return `<span class="it-only" data-f="items">${ph(env, entry.ph)}</span>`;
  const t = has(it.title), d = has(it.text);
  if (t && d) {
    return `<span class="it-t" data-f="items.${i}.title">${rich(it.title.trim())}</span>`
      + `<span class="it-d" data-f="items.${i}.text">${rich(it.text.trim())}</span>`;
  }
  if (t) return `<span class="it-only" data-f="items.${i}.title">${rich(it.title.trim())}</span>`;
  return `<span class="it-only" data-f="items.${i}.text">${rich(it.text.trim())}</span>`;
}

function sizeClass(n, few = 3, mid = 5, many = 7) {
  if (n <= few) return 'few';
  if (n <= mid) return 'mid';
  if (n <= many) return 'many';
  return 'lots';
}

/* Колонки с линией сверху. */
function colsBlock(entries, env, cls) {
  if (!entries.length) return '';
  const n = entries.length;
  const c = n <= 3 ? n : n === 4 ? 2 : 3;
  return `<ul class="${cls}" style="--n:${c}" data-f="items">${entries.map(e => `<li>${ico(e.it, 'ico-col')}${itemInner(e, env)}</li>`).join('')}</ul>`;
}

/* Нумерованный список с линиями; при большом числе пунктов — в две колонки сверху вниз. */
function numList(entries, env, opts = {}) {
  if (!entries.length) return '';
  const n = entries.length;
  const two = opts.twoFrom && n >= opts.twoFrom;
  const rows = two ? Math.ceil(n / 2) : n;
  const size = two ? sizeClass(rows + 2) : sizeClass(n);
  const style = two ? ` style="grid-template-rows:repeat(${rows},auto);grid-auto-flow:column"` : '';
  return `<ol class="nl ${size}${two ? ' two' : ''}"${style} data-f="items">${entries.map((e, j) =>
    `<li class="${j === 0 || (two && j === rows) ? 'first' : ''}"><span class="n">${ico(e.it, 'ico-n') || pad2(j + 1)}</span><span class="tx">${itemInner(e, env)}</span></li>`
  ).join('')}</ol>`;
}

/* Маркированный список с линиями (текст, пакет). */
function markList(entries, env, cls = '') {
  if (!entries.length) return '';
  return `<ul class="ml ${sizeClass(entries.length, 3, 5, 7)} ${cls}" data-f="items">${entries.map(e => mlItem(e, env)).join('')}</ul>`;
}
function mlItem(e, env) {
  const i = ico(e.it, 'ico-m');
  return `<li${i ? ' class="has-ico"' : ''}>${i}${itemInner(e, env)}</li>`;
}

/* ===================================================== постоянные части */

function logoSvg(cls = 'logo') {
  return `<svg class="${cls}" viewBox="${LOGO.vb.join(' ')}" role="img" aria-label="WE Media Group">${LOGO.paths.map(d => `<path d="${d}"/>`).join('')}</svg>`;
}

function head(env, right = '') {
  const lab = has(env.deck.header) ? esc(typo(env.deck.header.trim())) : '';
  const num = env.deck.numbers !== false ? `<span class="num">${env.num}</span>` : '';
  return `<div class="sl-head"><span class="lab">${lab}</span><span class="rt">${right}${num}</span></div>`;
}

function foot(right = '') { return `<div class="sl-foot">${logoSvg()}${right}</div>`; }

function frame(kind, cls, env, body, opts = {}) {
  return `<div class="sl sl-${kind}${cls ? ' ' + cls : ''}" data-kind="${kind}" style="--k:${env.k}">`
    + (opts.graphics || '')
    + head(env, opts.headRight || '')
    + `<div class="sl-body${opts.bodyCls ? ' ' + opts.bodyCls : ''}" data-fit>${body}</div>`
    + foot(opts.footRight || '')
    + '</div>';
}

/* Логотипы партнёров рядом с логотипом WE Media через тонкий разделитель (до 3). */
function partnersHtml(env) {
  const list = (env.partners || []).filter(p => p && p.url).slice(0, 3);
  if (!list.length) return '';
  const n = list.length;
  const hgt = [64, 60, 52][n - 1];
  const mw = [380, 300, 240][n - 1];
  return '<span class="divi"></span>' + list.map(p =>
    `<img class="partner${p.mono ? ' mono' : ''}" src="${esc(p.url)}" alt="${esc(p.name || '')}" style="max-height:${hgt}px;max-width:${mw}px">`).join('');
}

/* ======================================================== графика */

const GRAIN = '<span class="grain"></span>';

/* 6 растущих столбиков: ширина 120, высота 200→800, зазор 24, прозрачность 0.35→1. */
function bars() {
  let s = '<div class="g g-bars">';
  for (let i = 0; i < 6; i++) {
    s += `<i style="height:${200 + i * 120}px;opacity:${(0.35 + i * 0.13).toFixed(2)}">${GRAIN}</i>`;
  }
  return s + '</div>';
}

/* Кольца 2 px #D6E0FF вокруг центра за краем слайда + градиентный диск в центре. */
function rings(cx, cy, radii, disk) {
  let s = '';
  for (const r of radii) {
    s += `<i class="g ring" style="left:${cx - r}px;top:${cy - r}px;width:${r * 2}px;height:${r * 2}px"></i>`;
  }
  if (disk) s += `<i class="g disk" style="left:${cx - disk}px;top:${cy - disk}px;width:${disk * 2}px;height:${disk * 2}px">${GRAIN}</i>`;
  return s;
}

/* Панель 680 px: сетка 7 × 11 квадратов 44 px, к краям контуры бледнеют, 3 квадрата «горят». */
function gridPanel() {
  const cols = 7, rows = 11, pitch = 96, sq = 44, w = 680, h = 1080;
  const ox = (w - cols * pitch) / 2 + (pitch - sq) / 2;
  const oy = (h - rows * pitch) / 2 + (pitch - sq) / 2;
  const cx = (cols - 1) / 2, cy = (rows - 1) / 2;
  const lit = [[4, 2], [2, 5], [5, 7]];
  let rects = '';
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (lit.some(([lc, lr]) => lc === c && lr === r)) continue;
      const d = Math.min(1, Math.hypot((c - cx) / (cx + 1), (r - cy) / (cy + 1)));
      const a = (0.06 + 0.44 * Math.pow(1 - d, 1.4)).toFixed(3);
      rects += `<rect x="${ox + c * pitch + 1}" y="${oy + r * pitch + 1}" width="${sq - 2}" height="${sq - 2}" fill="none" stroke="rgba(0,68,255,${a})" stroke-width="2"/>`;
    }
  }
  let litHtml = '';
  for (const [c, r] of lit) {
    const x = ox + c * pitch, y = oy + r * pitch;
    litHtml += `<i class="glow" style="left:${x + sq / 2 - 130}px;top:${y + sq / 2 - 130}px"></i>`;
    litHtml += `<i class="lit" style="left:${x}px;top:${y}px">${GRAIN}</i>`;
  }
  return `<div class="g g-grid">${litHtml}<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${rects}</svg></div>`;
}
function panelBg() { return '<div class="g g-grid"></div>'; }

/* --------------------------------------------- сменная графика (библиотека) */

/* Мотивы библиотеки — только геометрия из гайда: столбики, кольца, квадраты, круги. */
const GFX = [
  ['', 'Как задумано'],
  ['none', 'Без графики'],
  ['bars', 'Столбики'],
  ['rings', 'Кольца'],
  ['grid', 'Сетка'],
  ['squares', 'Квадраты'],
  ['disk', 'Диск'],
  ['mosaic', 'Мозаика'],
];

/*
 * Слот графики раскладки: прямоугольник, где графика не заденет текст и логотип,
 * угол, от которого она «растёт», и тон (dark — на синем фоне, графика белая).
 */
const SLOTS = {
  cover: { x: 1040, y: 220, w: 880, h: 860, anchor: 'br' },
  thesis: { x: 1420, y: 500, w: 500, h: 580, anchor: 'br' },
  problem: { x: 1240, y: 0, w: 680, h: 1080, anchor: 'panel' },
  benefits: { x: 1360, y: 150, w: 560, h: 420, anchor: 'tr' },
  whatwedo: { x: 120, y: 700, w: 456, h: 212, anchor: 'bl', tone: 'dark', clip: true },
  list: { x: 300, y: 640, w: 480, h: 440, anchor: 'b' },
  text: { x: 1560, y: 150, w: 360, h: 420, anchor: 'tr' },
  timeline: { x: 1500, y: 150, w: 420, h: 330, anchor: 'tr' },
  quote: { x: 1420, y: 500, w: 500, h: 580, anchor: 'br' },
  case: { x: 1440, y: 700, w: 360, h: 212, anchor: 'br', tone: 'dark', clip: true },
  contacts: { x: 1320, y: 420, w: 600, h: 660, anchor: 'br' },
};

/* Детерминированный «случайный» шум для мозаики — одинаковый при каждой отрисовке. */
function noise(i, j, seed = 1) {
  const v = Math.sin(i * 127.1 + j * 311.7 + seed * 74.7) * 43758.5453;
  return v - Math.floor(v);
}
function px(v) { return Math.round(v * 10) / 10; }

/*
 * Точка, от которой «растёт» мотив: угол слота за краем слайда. У «tr» — середина
 * правого края, чтобы кольца не задевали номер слайда; у слотов внутри панели
 * (clip) — ровно угол слота, а сам мотив обрезается по слоту.
 */
function anchorPoint(b) {
  const o = b.clip ? 0 : 40;
  switch (b.anchor) {
    case 'br': return [b.x + b.w + o, b.y + b.h + o];
    case 'bl': return [b.x - o, b.y + b.h + o];
    case 'tr': return [b.x + b.w + 30, b.y + b.h / 2];
    case 'b': return [b.x + b.w / 2, b.y + b.h + 60];
    default: return [b.x + b.w / 2, b.y + b.h / 2];
  }
}

/* Радиус колец и диска под слот — так, чтобы не выйти за его пределы к тексту. */
function motifRadius(b) {
  if (b.anchor === 'panel') return Math.min(b.w, b.h) / 2 - 30;
  if (b.anchor === 'tr') return b.h / 2 - 6;
  if (b.anchor === 'b') return Math.min(b.w / 2, b.h);
  if (b.clip) return Math.min(b.w, b.h) - 4;
  return Math.min(b.w, b.h) + 20;
}

function motif(name, b) {
  const dark = b.tone === 'dark';
  const wt = dark ? ' wt' : '';
  const out = [];
  if (name === 'bars') {
    if (b.anchor === 'tr') {
      // от правого края — горизонтальные столбики, растут сверху вниз
      const n = Math.max(3, Math.min(6, Math.round(b.h / 80)));
      const gap = Math.max(12, b.h * 0.05);
      const bh = (b.h - gap * (n - 1)) / n;
      for (let i = 0; i < n; i++) {
        const bw = b.w * (0.3 + 0.7 * i / (n - 1));
        out.push(`<i class="g gb hz${wt}" style="left:${px(b.x + b.w - bw)}px;top:${px(b.y + i * (bh + gap))}px;width:${px(bw)}px;height:${px(bh)}px;opacity:${(0.35 + 0.65 * i / (n - 1)).toFixed(2)}">${GRAIN}</i>`);
      }
    } else {
      const pad = b.anchor === 'panel' ? 72 : 0;
      const x0 = b.x + pad, w = b.w - pad * 2, top = b.y + (b.anchor === 'panel' ? 200 : 0), hh = b.y + b.h - top;
      const n = Math.max(3, Math.min(6, Math.round(w / 140)));
      const gap = Math.max(12, Math.min(24, w * 0.03));
      const bw = (w - gap * (n - 1)) / n;
      for (let i = 0; i < n; i++) {
        const bh = hh * (0.25 + 0.75 * i / (n - 1));
        out.push(`<i class="g gb${wt}" style="left:${px(x0 + i * (bw + gap))}px;top:${px(b.y + b.h - bh)}px;width:${px(bw)}px;height:${px(bh)}px;opacity:${(0.35 + 0.65 * i / (n - 1)).toFixed(2)}">${GRAIN}</i>`);
      }
    }
  } else if (name === 'rings') {
    const [cx, cy] = anchorPoint(b);
    const R = motifRadius(b);
    out.push(rings(cx, cy, [0.46, 0.64, 0.82, 1].map(k => Math.round(R * k)), Math.round(R * 0.3)).replace(/class="g ring"/g, `class="g ring${wt}"`).replace(/class="g disk"/g, `class="g disk${wt}"`));
  } else if (name === 'grid') {
    const pitch = b.anchor === 'panel' ? 96 : 80, sq = pitch * 0.46;
    const cols = Math.max(2, Math.floor(b.w / pitch)), rows = Math.max(2, Math.floor(b.h / pitch));
    const ox = b.x + (b.w - cols * pitch) / 2 + (pitch - sq) / 2, oy = b.y + (b.h - rows * pitch) / 2 + (pitch - sq) / 2;
    const [ax, ay] = anchorPoint(b);
    const maxD = Math.hypot(b.w, b.h);
    const lit = new Set();
    for (let k = 0; k < 3; k++) lit.add(`${Math.floor(noise(k, 3) * cols)}:${Math.floor(noise(k, 7) * rows)}`);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = ox + c * pitch, y = oy + r * pitch;
        const d = Math.min(1, Math.hypot(x + sq / 2 - ax, y + sq / 2 - ay) / maxD);
        const a = (0.07 + 0.5 * Math.pow(1 - d, 1.5)).toFixed(3);
        if (lit.has(`${c}:${r}`)) {
          out.push(`<i class="g glow" style="left:${px(x + sq / 2 - 110)}px;top:${px(y + sq / 2 - 110)}px"></i><i class="g lit${wt}" style="left:${px(x)}px;top:${px(y)}px;width:${px(sq)}px;height:${px(sq)}px">${GRAIN}</i>`);
        } else {
          out.push(`<i class="g sqo" style="left:${px(x)}px;top:${px(y)}px;width:${px(sq)}px;height:${px(sq)}px;border-color:${dark ? `rgba(255,255,255,${a})` : `rgba(0,68,255,${a})`}"></i>`);
        }
      }
    }
  } else if (name === 'squares') {
    const s = Math.min(b.w / 456, b.h / 212, 2.4);
    const sizes = [72, 136, 200].map(v => v * s), gap = 24 * s, total = sizes[0] + sizes[1] + sizes[2] + gap * 2;
    let x = b.anchor === 'bl' ? b.x : b.anchor === 'br' || b.anchor === 'tr' ? b.x + b.w - total : b.x + (b.w - total) / 2;
    const bottom = b.anchor === 'tr' ? b.y + sizes[2] : b.anchor === 'panel' ? b.y + b.h / 2 + sizes[2] / 2 : b.y + b.h;
    sizes.forEach((sz, i) => {
      out.push(`<i class="g gsq${wt} s${i}" style="left:${px(x)}px;top:${px(bottom - sz)}px;width:${px(sz)}px;height:${px(sz)}px">${dark ? '' : GRAIN}</i>`);
      x += sz + gap;
    });
  } else if (name === 'disk') {
    const [cx, cy] = anchorPoint(b);
    const R = motifRadius(b) * (b.anchor === 'panel' ? 0.72 : 0.8);
    out.push(`<i class="g disk${wt}" style="left:${px(cx - R)}px;top:${px(cy - R)}px;width:${px(R * 2)}px;height:${px(R * 2)}px">${dark ? '' : GRAIN}</i>`);
    const r2 = R * 1.22;
    out.push(`<i class="g ring${wt}" style="left:${px(cx - r2)}px;top:${px(cy - r2)}px;width:${px(r2 * 2)}px;height:${px(r2 * 2)}px"></i>`);
  } else if (name === 'mosaic') {
    const cell = b.anchor === 'panel' ? 68 : Math.max(36, Math.min(64, Math.min(b.w, b.h) / 6));
    const cols = Math.floor(b.w / cell), rows = Math.floor(b.h / cell);
    const ox = b.x + (b.w - cols * cell) / 2, oy = b.y + (b.h - rows * cell) / 2;
    const [ax, ay] = anchorPoint(b);
    const maxD = b.anchor === 'panel' ? Math.min(b.w, b.h) * 0.75 : Math.hypot(b.w, b.h);
    const palette = dark
      ? ['rgba(255,255,255,0.95)', 'rgba(255,255,255,0.6)', 'rgba(255,255,255,0.32)', 'rgba(255,255,255,0.18)']
      : ['#0044FF', '#3D8BFF', '#5CC8FF', '#7B61FF', '#D6E0FF', '#E6EDFF'];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = ox + c * cell, y = oy + r * cell;
        const d = Math.min(1, Math.hypot(x + cell / 2 - ax, y + cell / 2 - ay) / maxD);
        const pr = Math.pow(1 - d, 1.7) * 0.95;
        if (noise(c, r, 5) > pr) continue;
        const col = palette[Math.floor(noise(c, r, 9) * palette.length)];
        const vivid = !dark && noise(c, r, 13) > 0.82;
        const op = (0.45 + 0.55 * (1 - d)).toFixed(2);
        out.push(`<i class="g msq${vivid ? ' v' : ''}" style="left:${px(x + 3)}px;top:${px(y + 3)}px;width:${px(cell - 6)}px;height:${px(cell - 6)}px;opacity:${op}${vivid ? '' : `;background:${col}`}">${vivid ? GRAIN : ''}</i>`);
      }
    }
  }
  return out.join('');
}

/* Своя картинка из библиотеки графики — вписывается в слот, прижимается к его углу. */
function userGraphic(ref, b) {
  const a = USER_ASSETS.graphics.get(ref);
  if (!a) return '';
  const pos = { br: 'right bottom', bl: 'left bottom', tr: 'right top', b: 'center bottom', panel: 'center' }[b.anchor] || 'center';
  return `<img class="g g-img" src="${esc(a.url)}" alt="" style="left:${b.x}px;top:${b.y}px;width:${b.w}px;height:${b.h}px;object-fit:${b.anchor === 'panel' ? 'cover' : 'contain'};object-position:${pos}">`;
}

/* Графика слайда: «как задумано» — родная графика раскладки, иначе выбранная из библиотеки. */
function gfx(kind, d, def) {
  if (photoOf(kind, d)) return '';   // рядом с фото графика лишняя
  const slot = SLOTS[kind];
  const g = d.gfx || '';
  if (!slot || !g) return def;
  if (g === 'none') return '';
  if (g.startsWith('up:')) return userGraphic(g, slot);
  if (slot.clip) {
    // мотив внутри панели — обрезаем по слоту, чтобы не задеть логотип и текст
    return `<div class="g gclip" style="left:${slot.x}px;top:${slot.y}px;width:${slot.w}px;height:${slot.h}px">${motif(g, Object.assign({}, slot, { x: 0, y: 0 }))}</div>`;
  }
  return motif(g, slot);
}

/* --------------------------------------------------------- свои фото */

/* Где стоит фото. Колонка 640 px — треть слайда, «половина» — 960 px. */
const PHOTO_AT = [['right', 'Справа'], ['left', 'Слева'], ['half', 'Половина']];
const PHOTO_W = { right: 640, left: 640, half: 960 };
/* Раскладки, где не всё подходит: у «Что делаем» слева синяя панель, у «Кейса» справа. */
const PHOTO_MODES = {
  whatwedo: ['right'], case: ['panel'],
  // таблицы, цепочки и ряды карточек на половине слайда превращаются в столбики по слову
  list: ['right', 'left'], stages: ['right', 'left'], compare: ['right', 'left'],
  timeline: ['right', 'left'], summary: ['right', 'left'],
};
/* Какую часть кадра держать в колонке. */
const PHOTO_FOCUS = [['left', 'Левее'], ['', 'Центр'], ['right', 'Правее']];

function photoModes(kind) { return PHOTO_MODES[kind] || ['right', 'left', 'half']; }

/* Фото слайда → { url, at, pos } или null (нет фото или его нет в этом браузере). */
function photoOf(kind, d) {
  if (!d || !has(d.photo)) return null;
  const a = USER_ASSETS.photos.get(d.photo);
  if (!a) return null;
  const modes = photoModes(kind);
  const at = modes.includes(d.photoAt) ? d.photoAt : modes[0];
  const x = { left: '0%', right: '100%' }[d.photoFocus] || '50%';
  return { url: a.url, at, pos: `${x} 50%` };
}
function photoBox(p, cls) {
  return `<div class="${cls}" data-f="photo"><img src="${esc(p.url)}" alt="" style="object-position:${p.pos}"></div>`;
}

/*
 * HTML слайда с учётом фото. Раскладка рисуется как обычно, но в колонке уже
 * 1920 px, фото — рядом на всю высоту. Все места, где нужен слайд, зовут это.
 */
function renderSlide(kind, d, env) {
  const html = KINDS[kind].render(d, env);
  const p = photoOf(kind, d);
  if (!p || p.at === 'panel') return html;
  return `<div class="sl slp at-${p.at}" data-kind="${kind}" style="--pw:${PHOTO_W[p.at]}px">${photoBox(p, 'ph-col')}${html}</div>`;
}

const ARROW = '<svg class="arr" viewBox="0 0 48 24" aria-hidden="true"><path d="M0 12H45M34 1.5 44.5 12 34 22.5" fill="none" stroke="currentColor" stroke-width="3.5"/></svg>';
const CHECK = '<svg class="ck" viewBox="0 0 40 40" aria-hidden="true"><path d="M7 21.5 15.5 30 33 11" fill="none" stroke="currentColor" stroke-width="4.5"/></svg>';

/* «BASE: …» — название пакета до двоеточия синим (если нет своих *звёздочек*). */
function pkgTitle(s) {
  if (!has(s)) return s;
  if (s.includes('*')) return s;
  const m = s.match(/^([^:\n]{1,28}:)(\s[\s\S]*)?$/);
  return m ? `*${m[1]}*${m[2] || ''}` : s;
}

/* ===================================================== раскладки */

const PH_ITEMS = i => ['Первый пункт', 'Второй пункт', 'Третий пункт', 'Четвёртый пункт', 'Пятый пункт'][i] || 'Пункт';

const KINDS = {
  cover: {
    name: 'Обложка',
    group: 'start',
    about: 'Логотип сверху, крупный заголовок и подзаголовок слева внизу, растущие столбики справа.',
    fields: [['note', 'Надпись над заголовком'], ['title', 'Заголовок'], ['lead', 'Подзаголовок'], ['partners', 'Логотипы партнёров']],
    render(d, env) {
      return `<div class="sl sl-cover bg-cover" data-kind="cover" style="--k:${env.k}">${gfx('cover', d, bars())}`
        + `<div class="cv-top">${logoSvg()}${partnersHtml(env)}</div>`
        + `<div class="sl-body" data-fit>`
        + blk('p', 'cv-note', d.note, '', env, 'note')
        + blk('h1', 't-h1', d.title, 'Название предложения', env, 'title')
        + paras(d.lead, 't-lead', 'Подзаголовок: суть предложения в одной-двух строках', env, 'lead')
        + '</div></div>';
    },
  },

  thesis: {
    name: 'Тезис',
    group: 'meaning',
    about: 'Одна крупная мысль. Подходит для вступления, вывода или раздела.',
    fields: [['title', 'Крупная мысль'], ['lead', 'Пояснение'], ['items', 'Пункты — по желанию'], ['note', 'Сноска']],
    render(d, env) {
      const items = liveItems(d.items);
      // только короткий заголовок — это разделитель раздела, набираем крупно
      const solo = !items.length && !has(d.lead) && !has(d.note) && has(d.title) && d.title.trim().length <= 48;
      return frame('thesis', `bg-glow${solo ? ' solo' : ''}`, env,
        blk('h2', 't-thesis', d.title, 'Главная мысль слайда — одно-два предложения', env, 'title')
        + paras(d.lead, 't-lead mt-lead', '', env, 'lead')
        + colsBlock(items, env, 'cols')
        + blk('p', 't-note mt-note', d.note, '', env, 'note'),
        { graphics: gfx('thesis', d, rings(1900, 1100, [270, 380, 490, 600], 180)), bodyCls: items.length ? 'has-items' : 'centered' });
    },
  },

  problem: {
    name: 'Проблема / контекст',
    group: 'meaning',
    about: 'Слева тезис и до трёх колонок с линией сверху, справа панель с сеткой квадратов.',
    fields: [['title', 'Тезис'], ['lead', 'Пояснение'], ['items', 'Колонки (лучше 3)'], ['note', 'Сноска']],
    render(d, env) {
      return frame('problem', '', env,
        blk('h2', 't-thesis', d.title, 'Тезис о ситуации клиента', env, 'title')
        + paras(d.lead, 't-lead mt-lead', '', env, 'lead')
        + colsBlock(itemsFor(d, env, 3, PH_ITEMS), env, 'cols push')
        + blk('p', 't-note mt-note', d.note, '', env, 'note'),
        { graphics: photoOf('problem', d) ? '' : d.gfx ? panelBg() + gfx('problem', d, '') : gridPanel() });
    },
  },

  benefits: {
    name: 'Польза: 3 колонки',
    group: 'meaning',
    about: 'Заголовок и лид, внизу колонки с номерами 01, 02, 03, кольца в углу.',
    fields: [['title', 'Заголовок'], ['lead', 'Лид'], ['items', 'Колонки (лучше 3)'], ['note', 'Сноска']],
    render(d, env) {
      const entries = itemsFor(d, env, 3, PH_ITEMS);
      const n = entries.length <= 4 ? entries.length : 3;
      const cols = entries.length
        ? `<ol class="bcols" style="--n:${n}" data-f="items">${entries.map((e, j) => `<li>${slideIcon(e.it.icon) ? `<span class="ico ico-tile">${GRAIN}${slideIcon(e.it.icon)}</span>` : `<span class="bn">${pad2(j + 1)}</span>`}${itemInner(e, env)}</li>`).join('')}</ol>`
        : '';
      return frame('benefits', 'bg-glow', env,
        `<div class="head-blk">${blk('h2', 't-h2', d.title, 'Зачем это клиенту', env, 'title')}${paras(d.lead, 't-lead mt-lead', '', env, 'lead')}</div>`
        + cols
        + blk('p', 't-note mt-note', d.note, '', env, 'note'),
        { graphics: gfx('benefits', d, rings(1960, -40, [290, 410, 530, 650], 170)) });
    },
  },

  whatwedo: {
    name: 'Что делаем',
    group: 'lists',
    about: 'Слева синяя панель с заголовком и тремя квадратами, справа нумерованный список.',
    fields: [['title', 'Заголовок на синей панели'], ['lead', 'Текст на панели'], ['items', 'Пункты (3–7)'], ['note', 'Сноска']],
    render(d, env) {
      const own = d.gfx && !photoOf('whatwedo', d);
      return `<div class="sl sl-wwd" data-kind="whatwedo" style="--k:${env.k}">`
        + `<div class="panel vivid">${GRAIN}</div>`
        + (own ? gfx('whatwedo', d, '') : '')
        + head(env)
        + `<div class="sl-body" data-fit>`
        + `<div class="lc on-blue" data-fit>${blk('h2', 't-h2', d.title, 'Что мы делаем', env, 'title')}${paras(d.lead, 't-desc', '', env, 'lead')}${own ? '<div class="sq-row sq-space"></div>' : '<div class="sq-row"><i></i><i></i><i></i></div>'}</div>`
        + `<div class="rc" data-fit>${numList(itemsFor(d, env, 4, PH_ITEMS), env)}${blk('p', 't-note', d.note, '', env, 'note')}</div>`
        + `</div>${foot()}</div>`;
    },
  },

  stages: {
    name: 'Этапы',
    group: 'lists',
    about: 'Заголовок и карточки этапов с огромной обрезанной цифрой; первая карточка синяя.',
    fields: [['title', 'Заголовок'], ['lead', 'Лид — по желанию'], ['items', 'Этапы (лучше 4)'], ['note', 'Сноска']],
    render(d, env) {
      const entries = itemsFor(d, env, 4, i => ['Первый этап', 'Второй этап', 'Третий этап', 'Четвёртый этап'][i]);
      const n = entries.length;
      // рядом с фото места на 4 карточки в ряд нет — максимум по 2
      const narrow = Boolean(photoOf('stages', d));
      const two = narrow ? n > 2 : n > 4;
      const c = narrow ? Math.min(Math.max(n, 1), 2) : n <= 4 ? Math.max(n, 1) : n <= 6 ? 3 : 4;
      const cards = n
        ? `<div class="cards${two ? ' two-rows' : ''}" style="--c:${c}" data-f="items">${entries.map((e, j) =>
          `<div class="card${j === 0 ? ' vivid' : ''}">${j === 0 ? GRAIN : ''}<span class="bignum">${j + 1}</span><div class="cin" data-fit>${ico(e.it, 'ico-card')}${itemInner(e, env)}</div></div>`
        ).join('')}</div>`
        : '';
      return frame('stages', '', env,
        blk('h2', 't-h2', d.title, 'Как мы работаем', env, 'title')
        + paras(d.lead, 't-lead', '', env, 'lead')
        + cards
        + blk('p', 't-note mt-note', d.note, '', env, 'note'));
    },
  },

  list: {
    name: 'Список',
    group: 'lists',
    about: 'Слева заголовок, справа нумерованный список; при 8+ пунктах — в две колонки.',
    fields: [['title', 'Заголовок'], ['lead', 'Лид'], ['items', 'Пункты'], ['note', 'Сноска']],
    render(d, env) {
      return frame('list', '', env,
        `<div class="lc" data-fit>${blk('h2', 't-h2', d.title, 'Форматы', env, 'title')}${paras(d.lead, 't-lead', '', env, 'lead')}</div>`
        + `<div class="rc" data-fit>${numList(itemsFor(d, env, 5, PH_ITEMS), env, { twoFrom: 9 })}${blk('p', 't-note', d.note, '', env, 'note')}</div>`,
        { graphics: gfx('list', d, rings(-100, 1180, [260, 480, 600], 200)) });
    },
  },

  text: {
    name: 'Текст',
    group: 'meaning',
    about: 'Заголовок, лид и абзацы; пункты — маркированным списком с линиями.',
    fields: [['title', 'Заголовок'], ['lead', 'Текст (абзацы через пустую строку)'], ['items', 'Пункты — по желанию'], ['note', 'Сноска']],
    render(d, env) {
      const ps = splitParas(d.lead);
      let text;
      if (!ps.length) text = blk('p', 't-lead mt-lead', '', 'Текст слайда', env, 'lead');
      else {
        const [first, ...rest] = ps;
        const restLen = rest.join(' ').length;
        text = `<p class="t-lead${has(d.title) || env.preview ? ' mt-lead' : ''}" data-f="lead">${rich(first)}</p>`;
        if (rest.length) text += `<div class="t-body paras${restLen > 520 ? ' body2' : ''}" data-f="lead">${rest.map(p => `<p>${rich(p)}</p>`).join('')}</div>`;
      }
      const items = liveItems(d.items);
      const two = items.length >= 6;
      let list = '';
      if (two) {
        const half = Math.ceil(items.length / 2);
        list = `<ul class="ml ${sizeClass(half, 3, 5, 7)} two" style="grid-template-rows:repeat(${half},auto);grid-auto-flow:column" data-f="items">${items.map(e => mlItem(e, env)).join('')}</ul>`;
      } else list = markList(items, env);
      return frame('text', 'bg-glow', env,
        blk('h2', 't-h2', d.title, '', env, 'title')
        + text + list
        + blk('p', 't-note mt-note', d.note, '', env, 'note'),
        { graphics: gfx('text', d, '') });
    },
  },

  summary: {
    name: 'Итог',
    group: 'meaning',
    about: 'Синий слайд с зерном: заголовок, абзац, крупная цифра на фоне и белая плашка-цепочка из пунктов.',
    fields: [['title', 'Заголовок'], ['lead', 'Абзац'], ['big', 'Цифра на фоне — по желанию'], ['items', 'Цепочка: 3–4 коротких тезиса'], ['note', 'Сноска']],
    render(d, env) {
      const entries = itemsFor(d, env, 4, i => ['Тезис', 'Тезис', 'Тезис', 'Тезис'][i]);
      const chain = entries.length
        ? `<div class="chain" data-f="items">${entries.map(e => `<div class="ci">${ico(e.it, 'ico-ch')}${itemInner(e, env)}</div>`).join(ARROW)}</div>`
        : '';
      const big = has(d.big) ? `<span class="bigbg" data-f="big">${esc(d.big.trim())}</span>` : '';
      return `<div class="sl sl-summary blue${big ? '' : ' nobig'}${chain ? '' : ' nochain'}" data-kind="summary" style="--k:${env.k}">${GRAIN}${big}`
        + head(env)
        + `<div class="sl-body" data-fit>`
        + blk('h2', 't-h2', d.title, 'Итог', env, 'title')
        + paras(d.lead, 't-lead mt-lead', 'Каким будет результат для клиента', env, 'lead')
        + chain.replace('class="chain"', 'class="chain push"')
        + blk('p', 't-note', d.note, '', env, 'note')
        + `</div>${foot()}</div>`;
    },
  },

  package: {
    name: 'Пакет',
    group: 'money',
    about: 'Название пакета синим, курсивный подзаголовок, «Всё из …, плюс:», пункты в две колонки, уровень в шапке.',
    fields: [['title', 'Название пакета и заголовок'], ['lead', 'Подзаголовок (курсив)'], ['label', 'Строка перед списком'], ['items', 'Что входит'], ['price', 'Цена — по желанию'], ['level', 'Уровень пакета'], ['note', 'Сноска']],
    render(d, env) {
      const entries = itemsFor(d, env, 6, PH_ITEMS);
      let colsHtml = '';
      if (entries.length) {
        const one = entries.length <= 3;
        const half = one ? entries.length : Math.ceil(entries.length / 2);
        const groups = one ? [entries] : [entries.slice(0, half), entries.slice(half)];
        colsHtml = `<div class="pk-cols${one ? ' one' : ''}">${groups.map(g => markList(g, env)).join('')}</div>`;
      }
      const level = Math.max(1, Math.min(3, Number(d.level) || 1));
      const lvl = `<span class="lvl">${[1, 2, 3].map(i => `<i class="${i <= level ? 'on' : ''}"></i>`).join('')}</span>`;
      const price = has(d.price) ? `<span class="price" data-f="price">${rich(d.price.trim())}</span>` : '';
      return frame('pkg', '', env,
        blk('h2', 't-h2', pkgTitle(d.title), 'BASE: название пакета', env, 'title')
        + paras(d.lead, 't-sub', 'Подзаголовок: для кого этот пакет', env, 'lead')
        + blk('p', 'pk-label', d.label, '', env, 'label')
        + colsHtml
        + blk('p', 't-note mt-note', d.note, '', env, 'note'),
        { headRight: lvl, footRight: price });
    },
  },

  compare: {
    name: 'Сравнение пакетов',
    group: 'money',
    about: 'Таблица: строки слева, пакеты в колонках. Последний пакет — синий. ✓ синим, «—» серым.',
    fields: [['title', 'Заголовок'], ['table', 'Таблица'], ['note', 'Сноска']],
    render(d, env) {
      const t = d.table || { cols: [], rows: [] };
      let cols = (t.cols || []).filter(c => has(c.name) || has(c.price));
      let rows = (t.rows || []).filter(r => has(r.name) || (r.cells || []).some(has));
      const phMode = env.preview && !cols.length;
      if (phMode) cols = [{ name: 'BASE' }, { name: 'PRO' }, { name: 'PREMIUM' }].map(c => ({ ...c, ph: true }));
      if (env.preview && !rows.length) rows = [1, 2, 3, 4].map(i => ({ name: '', cells: [], ph: `Строка ${i}` }));
      const n = Math.max(1, cols.length);
      const styles = [['c-vivid'], ['c-tint', 'c-vivid'], ['c-neutral', 'c-tint', 'c-vivid'], ['c-neutral', 'c-panel', 'c-tint', 'c-vivid']][Math.min(n, 4) - 1];
      const styleOf = j => (n > 4 ? (j === n - 1 ? 'c-vivid' : ['c-neutral', 'c-panel', 'c-tint'][j % 3]) : styles[j]);
      const hasPrice = cols.some(c => has(c.price));
      const R = 1 + rows.length + (hasPrice ? 1 : 0);
      let g = '';
      cols.forEach((c, j) => {
        const st = styleOf(j);
        g += `<div class="cbg ${st}" style="grid-column:${j + 2}">${st === 'c-vivid' ? GRAIN : ''}</div>`;
      });
      const ob = j => (styleOf(j) === 'c-vivid' ? ' on-blue' : '');
      g += `<div class="cell hd rn corner" style="grid-row:1;grid-column:1" data-f="table">${has(t.corner) ? rich(t.corner.trim()) : ''}</div>`;
      cols.forEach((c, j) => {
        const name = c.ph ? ph(env, c.name) : rich((c.name || '').trim());
        g += `<div class="cell hd pc${ob(j)}" style="grid-row:1;grid-column:${j + 2}" data-f="table">${name}</div>`;
      });
      rows.forEach((r, ri) => {
        const first = ri === 0 ? ' first' : '';
        const name = r.ph ? ph(env, r.ph) : rich((r.name || '').trim());
        g += `<div class="cell rn${first}" style="grid-row:${ri + 2};grid-column:1" data-f="table">${name}</div>`;
        cols.forEach((c, j) => {
          g += `<div class="cell pc${first}${ob(j)}" style="grid-row:${ri + 2};grid-column:${j + 2}" data-f="table">${cellValue((r.cells || [])[j], r.ph)}</div>`;
        });
      });
      if (hasPrice) {
        const pr = rows.length + 2;
        g += `<div class="cell rn pr" style="grid-row:${pr};grid-column:1" data-f="table">${has(t.priceLabel) ? rich(t.priceLabel.trim()) : ''}</div>`;
        cols.forEach((c, j) => {
          g += `<div class="cell pc pr${ob(j)}" style="grid-row:${pr};grid-column:${j + 2}" data-f="table">${has(c.price) ? rich(c.price.trim()) : ''}</div>`;
        });
      }
      const title = blk('h2', 't-h2', d.title, '', env, 'title');
      return frame('cmp', '', env,
        title
        + `<div class="cmp${title ? '' : ' noh'}" style="--n:${n};grid-template-rows:repeat(${R},auto)">${g}</div>`
        + blk('p', 't-note', d.note, '', env, 'note'));
    },
  },

  pricing: {
    name: 'Стоимость',
    group: 'money',
    about: 'Полосы на всю ширину: базовая без фона, «за год» синяя со скидкой, остальные — голубая и серая.',
    fields: [['title', 'Заголовок'], ['lead', 'Лид — по желанию'], ['rows', 'Строки стоимости'], ['note', 'Сноска']],
    render(d, env) {
      let rows = (d.rows || []).filter(r => has(r.label) || has(r.value) || has(r.badge));
      if (env.preview && !rows.length) {
        rows = [
          { ph: 'Базовая стоимость', style: 'plain', phv: '000 000 ₸' },
          { ph: 'Оплата за год', style: 'vivid', phb: '−20%' },
          { ph: 'Оплата за 6 месяцев', style: 'blue', phb: '−10%' },
        ];
      }
      const html = rows.map(r => {
        const st = ['plain', 'vivid', 'blue', 'gray'].includes(r.style) ? r.style : 'plain';
        const label = r.ph ? ph(env, r.ph) : rich((r.label || '').trim());
        const note = has(r.note) ? `<div class="pl-n">${rich(r.note.trim())}</div>` : '';
        const saves = has(r.save) ? `<div class="saves">${r.save.split(/\n+/).filter(has).map(s => `<span class="save">${rich(s.trim())}</span>`).join('')}</div>` : '';
        const badge = has(r.badge) ? rich(r.badge.trim()) : r.phb ? ph(env, r.phb) : '';
        const value = has(r.value) ? rich(r.value.trim()) : r.phv ? ph(env, r.phv) : '';
        return `<div class="prow s-${st}" data-f="rows">${st === 'vivid' ? GRAIN : ''}<div class="pl"><div class="pl-t">${label}</div>${note}${saves}</div><div class="badge">${badge}</div><div class="pv">${value}</div></div>`;
      }).join('');
      return frame('price', 'bg-glow', env,
        blk('h2', 't-h2', d.title, 'Стоимость', env, 'title')
        + paras(d.lead, 't-lead', '', env, 'lead')
        + (html ? `<div class="prows">${html}</div>` : '')
        + blk('p', 't-note', d.note, '', env, 'note'));
    },
  },

  stats: {
    name: 'Цифры',
    group: 'meaning',
    about: 'Крупные цифры в карточках: охват, результат, сроки. Первая карточка синяя, у каждой может быть иконка.',
    fields: [['title', 'Заголовок'], ['lead', 'Лид — по желанию'], ['items', 'Цифры: число и подпись'], ['note', 'Сноска']],
    render(d, env) {
      const entries = itemsFor(d, env, 3, () => 'Число и подпись');
      const n = entries.length;
      const c = n <= 4 ? Math.max(n, 1) : 3;
      const cards = n
        ? `<div class="stats${n > 4 ? ' two-rows' : ''}" style="--c:${c}" data-f="items">${entries.map((e, j) => {
          const it = e.it;
          let inner;
          if (e.ph) inner = `<span class="st-n">${ph(env, '120+')}</span><span class="st-l">${ph(env, 'подпись к цифре')}</span>`;
          else if (has(it.title) && has(it.text)) inner = `<span class="st-n" data-f="items.${e.i}.title">${rich(it.title.trim())}</span><span class="st-l" data-f="items.${e.i}.text">${rich(it.text.trim())}</span>`;
          else inner = `<span class="st-n" data-f="items.${e.i}.${has(it.title) ? 'title' : 'text'}">${rich((has(it.title) ? it.title : it.text).trim())}</span>`;
          return `<div class="stat${j === 0 ? ' vivid' : ''}">${j === 0 ? GRAIN : ''}${ico(it, 'ico-stat')}<div class="st-in" data-fit>${inner}</div></div>`;
        }).join('')}</div>`
        : '';
      return frame('stats', 'bg-glow', env,
        blk('h2', 't-h2', d.title, 'В цифрах', env, 'title')
        + paras(d.lead, 't-lead mt-lead', '', env, 'lead')
        + cards
        + blk('p', 't-note mt-note', d.note, '', env, 'note'));
    },
  },

  timeline: {
    name: 'Дорожная карта',
    group: 'lists',
    about: 'Линия с точками-шагами: срок сверху, описание снизу. С иконками точки становятся синими кругами.',
    fields: [['title', 'Заголовок'], ['lead', 'Лид — по желанию'], ['items', 'Шаги: срок и описание'], ['note', 'Сноска']],
    render(d, env) {
      const entries = itemsFor(d, env, 4, i => `Месяц ${i + 1}`);
      const n = entries.length;
      const tl = n
        ? `<ol class="tl${n > 5 ? ' dense' : ''}" style="--n:${n}" data-f="items">${entries.map((e, j) => {
          const it = e.it;
          const i = slideIcon(it.icon);
          const t = e.ph ? ph(env, e.ph) : has(it.title) ? `<span data-f="items.${e.i}.title">${rich(it.title.trim())}</span>` : '';
          const x = e.ph ? ph(env, 'Что происходит на этом шаге') : has(it.text) ? `<span data-f="items.${e.i}.text">${rich(it.text.trim())}</span>` : '';
          return `<li class="${j === 0 ? 'first' : ''}${i ? ' has-ico' : ''}"><span class="tl-t">${t}</span><span class="tl-node">${i ? `<span class="ico ico-tl">${GRAIN}${i}</span>` : ''}</span><span class="tl-d">${x}</span></li>`;
        }).join('')}</ol>`
        : '';
      return frame('timeline', 'bg-glow', env,
        blk('h2', 't-h2', d.title, 'Дорожная карта', env, 'title')
        + paras(d.lead, 't-lead mt-lead', '', env, 'lead')
        + tl
        + blk('p', 't-note mt-note', d.note, '', env, 'note'),
        { graphics: gfx('timeline', d, '') });
    },
  },

  quote: {
    name: 'Цитата / отзыв',
    group: 'meaning',
    about: 'Крупная цитата клиента или эксперта, автор и должность; синий квадрат с кавычками, кольца в углу.',
    fields: [['label', 'Надпись над цитатой'], ['title', 'Цитата'], ['lead', 'Автор'], ['note', 'Должность, компания']],
    render(d, env) {
      const mark = typeof SLIDE_ICONS !== 'undefined' && SLIDE_ICONS.quotes
        ? `<div class="q-mark">${GRAIN}<svg viewBox="0 0 256 256" fill="currentColor" aria-hidden="true">${SLIDE_ICONS.quotes.svg}</svg></div>` : '';
      const by = blk('p', 'q-author', d.lead, 'Имя Фамилия', env, 'lead') + blk('p', 'q-role', d.note, 'Должность, компания', env, 'note');
      return frame('quote', 'bg-cover', env,
        mark
        + blk('p', 'q-label', d.label, '', env, 'label')
        + blk('p', 't-thesis q-text', d.title, 'Слова клиента о работе с нами — одна-три фразы', env, 'title')
        + (by ? `<div class="q-by">${by}</div>` : ''),
        { graphics: gfx('quote', d, rings(1900, 1100, [270, 380, 490, 600], 180)), bodyCls: 'centered' });
    },
  },

  case: {
    name: 'Кейс',
    group: 'meaning',
    about: 'История проекта: задача, решение, результат; справа синяя панель с главной цифрой.',
    fields: [['title', 'Название кейса'], ['lead', 'Клиент и контекст'], ['items', 'Задача, решение, результат'], ['big', 'Главная цифра'], ['label', 'Подпись к цифре'], ['note', 'Сноска']],
    render(d, env) {
      const entries = itemsFor(d, env, 3, i => ['Задача', 'Решение', 'Результат'][i]);
      const rows = entries.length
        ? `<ul class="cs-rows push" data-f="items">${entries.map((e, j) => {
          const it = e.it;
          if (e.ph) return `<li class="${j === 0 ? 'first' : ''}"><span class="cs-t">${ph(env, e.ph)}</span><span class="cs-d">${ph(env, 'Пара предложений')}</span></li>`;
          const i = ico(it, 'ico-cs');
          const t = has(it.title) ? `<span class="cs-t" data-f="items.${e.i}.title">${i}${rich(it.title.trim())}</span>` : '';
          const x = has(it.text) ? `<span class="cs-d${t ? '' : ' wide'}" data-f="items.${e.i}.text">${t ? '' : i}${rich(it.text.trim())}</span>` : '';
          return `<li class="${j === 0 ? 'first' : ''}">${t}${x}</li>`;
        }).join('')}</ul>`
        : '';
      const bigText = has(d.big) ? d.big.trim() : '';
      const len = bigText.length;
      const bigSize = len <= 3 ? 220 : len <= 5 ? 168 : len <= 7 ? 124 : 96;
      const big = bigText ? `<span class="cs-big" data-f="big" style="font-size:calc(${bigSize}px * var(--k))">${esc(bigText)}</span>`
        : env.preview ? `<span class="cs-big" data-f="big" style="font-size:calc(168px * var(--k))">${ph(env, '+40%')}</span>` : '';
      return `<div class="sl sl-case" data-kind="case" style="--k:${env.k}">`
        + `<div class="cs-panel vivid">${GRAIN}</div>`
        + `<div class="cs-pin on-blue${photoOf('case', d) ? ' has-photo' : ''}" data-fit>${big}${blk('p', 'cs-label', d.label, 'подпись к цифре', env, 'label')}</div>`
        + (photoOf('case', d) ? photoBox(photoOf('case', d), 'cs-photo') : gfx('case', Object.assign({}, d, { gfx: d.gfx || 'squares' }), ''))
        + head(env)
        + `<div class="sl-body" data-fit>`
        + blk('h2', 't-h2', d.title, 'Кейс: название проекта', env, 'title')
        + paras(d.lead, 't-lead mt-lead', '', env, 'lead')
        + rows
        + blk('p', 't-note mt-note', d.note, '', env, 'note')
        + `</div>${foot()}</div>`;
    },
  },

  contacts: {
    name: 'Контакты',
    group: 'start',
    about: 'Финальный слайд: заголовок, текст и контакты, большие кольца справа.',
    fields: [['title', 'Заголовок'], ['lead', 'Текст'], ['items', 'Контакты: подпись и значение'], ['note', 'Сноска'], ['partners', 'Логотипы партнёров']],
    render(d, env) {
      const entries = itemsFor(d, env, 3, i => ['Телефон', 'Почта', 'Сайт'][i]);
      const n = entries.length <= 2 ? Math.max(entries.length, 1) : entries.length === 4 ? 2 : 3;
      const ct = entries.length ? `<ul class="ct" style="--n:${n}" data-f="items">${entries.map(e => {
        const i = ico(e.it, 'ico-ct');
        return i ? `<li class="has-ico">${i}<div>${itemInner(e, env)}</div></li>` : `<li>${itemInner(e, env)}</li>`;
      }).join('')}</ul>` : '';
      return `<div class="sl sl-contacts bg-cover" data-kind="contacts" style="--k:${env.k}">`
        + gfx('contacts', d, rings(1960, 1160, [300, 420, 540, 660], 200))
        + `<div class="cv-top">${logoSvg()}${partnersHtml(env)}</div>`
        + `<div class="sl-body" data-fit>`
        + blk('h1', 't-h1', d.title, 'Спасибо!', env, 'title')
        + paras(d.lead, 't-lead', '', env, 'lead')
        + ct
        + blk('p', 't-note', d.note, '', env, 'note')
        + '</div></div>';
    },
  },
};

const KIND_GROUPS = [
  { id: 'start', name: 'Начало и финал' },
  { id: 'meaning', name: 'Смысл и доказательства' },
  { id: 'lists', name: 'Списки и этапы' },
  { id: 'money', name: 'Пакеты и деньги' },
];

/* Значение ячейки таблицы: ✓, «—» или текст как есть. */
const YES = /^(✓|✔|☑|v|\+|да|есть|yes|true|x|х)$/i;
const NO = /^(—|–|-|−|нет|no|false|0)?$/i;
function cellValue(v, isPh) {
  const s = (v || '').trim();
  if (isPh) return '<span class="dash">—</span>';
  if (YES.test(s)) return CHECK;
  if (NO.test(s)) return '<span class="dash">—</span>';
  return `<span class="tv">${rich(s)}</span>`;
}

/* =================================================== модель данных */

function emptyData() {
  return {
    note: '', title: '', lead: '', items: [],
    label: '', price: '', level: 1, big: '',
    gfx: '',
    photo: '', photoAt: '', photoFocus: '',
    rows: [],
    table: { corner: '', priceLabel: '', cols: [], rows: [] },
  };
}

function emptyRow() { return { label: '', note: '', value: '', badge: '', save: '', style: 'plain' }; }

/* Какие поля раскладка показывает — по ним сверка текста и подсказка «скрыто». */
function kindFields(kind) { return KINDS[kind].fields.map(([key]) => key); }

/* Весь видимый в раскладке текст слайда — для сверки с исходником. */
function slideStrings(slide) {
  const d = slide.data;
  const out = [];
  for (const key of kindFields(slide.kind)) {
    if (key === 'items') for (const it of d.items || []) out.push(it.title, it.text);
    else if (key === 'rows') for (const r of d.rows || []) out.push(r.label, r.note, r.value, r.badge, r.save);
    else if (key === 'table') {
      out.push(d.table.corner, d.table.priceLabel);
      for (const c of d.table.cols || []) out.push(c.name, c.price);
      for (const r of d.table.rows || []) out.push(r.name, ...(r.cells || []));
    } else if (key !== 'level' && key !== 'partners') out.push(d[key]);
  }
  return out.filter(has);
}

/* Поля с текстом, которые эта раскладка не показывает (останутся в данных). */
function hiddenFields(slide) {
  const shown = new Set(kindFields(slide.kind));
  const d = slide.data;
  const hidden = [];
  const names = { note: 'сноска', title: 'заголовок', lead: 'текст', items: 'пункты', label: 'строка перед списком', price: 'цена', big: 'цифра на фоне', rows: 'строки стоимости', table: 'таблица' };
  for (const key of Object.keys(names)) {
    if (shown.has(key)) continue;
    const v = d[key];
    const filled = key === 'items' ? liveItems(v).length
      : key === 'rows' ? (v || []).some(r => has(r.label) || has(r.value))
        : key === 'table' ? (v.rows || []).length || (v.cols || []).length
          : has(v);
    if (filled) hidden.push(names[key]);
  }
  return hidden;
}

/*
 * Смена раскладки: данные общие, но пункты ↔ строки стоимости ↔ строки таблицы
 * переносятся, если в новой раскладке своё поле пустое — чтобы текст не прятался.
 */
function convertData(data, from, to) {
  const d = JSON.parse(JSON.stringify(data));
  const fTo = kindFields(to);
  const items = liveItems(d.items).map(e => e.it);
  if (fTo.includes('rows') && !(d.rows || []).some(r => has(r.label) || has(r.value)) && items.length) {
    d.rows = items.map((it, i) => Object.assign(emptyRow(), {
      label: has(it.title) ? it.title : it.text,
      value: has(it.title) ? it.text : '',
      style: i === 0 ? 'plain' : ['vivid', 'blue', 'gray'][(i - 1) % 3],
    }));
    d.items = [];
  } else if (fTo.includes('table') && !(d.table.rows || []).length && items.length) {
    d.table.rows = items.map(it => ({ name: [it.title, it.text].filter(has).join(' — '), cells: [] }));
    if (!(d.table.cols || []).length) d.table.cols = [{ name: '', price: '' }, { name: '', price: '' }, { name: '', price: '' }];
    d.items = [];
  } else if (fTo.includes('items') && !items.length) {
    const rows = (d.rows || []).filter(r => has(r.label) || has(r.value));
    if (rows.length && !fTo.includes('rows')) {
      d.items = rows.map(r => ({ title: has(r.value) ? r.label : '', text: has(r.value) ? r.value : r.label }));
      d.rows = [];
    } else if ((d.table.rows || []).length && !fTo.includes('table')) {
      d.items = d.table.rows.filter(r => has(r.name)).map(r => ({ title: '', text: r.name }));
    }
  }
  return d;
}

/* ============================================================ примеры */

const SAMPLE = {
  cover: {
    note: 'Коммерческое предложение',
    title: 'Executive Visibility by WE Media',
    lead: 'Программа системного присутствия первого лица компании в деловых медиа',
  },
  thesis: {
    title: 'Клиенты, партнёры и инвесторы всё чаще выбирают людей, а не логотипы',
    lead: 'Голос руководителя становится частью репутации компании.',
  },
  problem: {
    title: 'Компанию знают, а её руководителя — нет',
    lead: 'В деловой повестке звучат другие голоса.',
    items: [
      { title: 'Нет голоса в медиа', text: 'Позиция руководителя не звучит в отраслевой повестке.' },
      { title: 'Случайные публикации', text: 'Интервью выходят от повода к поводу, без общей линии.' },
      { title: 'Нет системы', text: 'Результат не измеряется и не накапливается.' },
    ],
  },
  benefits: {
    title: 'Зачем это бизнесу',
    lead: 'Сильный личный бренд руководителя делает компанию заметнее и понятнее для рынка.',
    items: [
      { title: 'Доверие', text: 'Рынку проще доверять компании, у которой есть узнаваемое лицо.' },
      { title: 'Сделки', text: 'Публичность первого лица сокращает путь от знакомства до контракта.' },
      { title: 'Команда', text: 'Сильные специалисты охотнее идут к руководителю, которого знают.' },
    ],
  },
  whatwedo: {
    title: 'Что мы делаем',
    lead: 'Берём на себя всю работу — от позиционирования до публикаций.',
    items: [
      { title: '', text: 'Формируем позиционирование и ключевые темы руководителя' },
      { title: '', text: 'Готовим экспертные колонки, интервью и комментарии' },
      { title: '', text: 'Договариваемся с деловыми и отраслевыми медиа' },
      { title: '', text: 'Ведём профессиональные соцсети первого лица' },
      { title: '', text: 'Каждый месяц показываем результат в отчёте' },
    ],
  },
  stages: {
    title: 'Как мы работаем',
    items: [
      { title: 'Аудит', text: 'Изучаем текущий образ руководителя и упоминания в медиа.' },
      { title: 'Стратегия', text: 'Определяем темы, площадки и тон голоса.' },
      { title: 'Публикации', text: 'Готовим и размещаем материалы по согласованному плану.' },
      { title: 'Отчёт', text: 'Подводим итоги месяца и корректируем план.' },
    ],
  },
  list: {
    title: 'Форматы присутствия',
    lead: 'Комбинируем форматы под задачи и график руководителя.',
    items: [
      { title: '', text: 'Экспертные колонки' },
      { title: '', text: 'Интервью в деловых СМИ' },
      { title: '', text: 'Комментарии к новостям отрасли' },
      { title: '', text: 'Подкасты и видеоинтервью' },
      { title: '', text: 'Выступления на конференциях' },
      { title: '', text: 'Посты в LinkedIn и Telegram' },
    ],
  },
  text: {
    title: 'О WE Media',
    lead: 'Мы помогаем компаниям и их руководителям говорить с рынком на языке деловых медиа.\n\nВ команде — редакторы, журналисты и PR-стратеги, которые знают, как устроены редакции и чего ждут читатели.',
  },
  summary: {
    title: 'Через 12 месяцев',
    lead: 'Руководитель — узнаваемый эксперт отрасли, а у компании — сильное лицо на рынке.',
    big: '12',
    items: [
      { title: '', text: 'Позиционирование' },
      { title: '', text: 'Публикации' },
      { title: '', text: 'Узнаваемость' },
      { title: '', text: 'Доверие рынка' },
    ],
  },
  package: {
    title: 'PRO: голос в деловой повестке',
    lead: 'Для руководителей, готовых выйти в национальные деловые медиа',
    label: 'Всё из BASE, плюс:',
    items: [
      { title: '', text: 'Интервью в деловых СМИ — 1 в месяц' },
      { title: '', text: 'Подкаст или видеоинтервью раз в квартал' },
      { title: '', text: 'Ведение Telegram-канала' },
      { title: '', text: 'Медиатренинг для руководителя' },
      { title: '', text: 'Мониторинг упоминаний' },
      { title: '', text: 'Еженедельный созвон с командой' },
    ],
    level: 2,
    price: '1 400 000 ₸ / месяц',
  },
  compare: {
    title: 'Сравнение пакетов',
    table: {
      cols: [
        { name: 'BASE', price: '800 000 ₸' },
        { name: 'PRO', price: '1 400 000 ₸' },
        { name: 'PREMIUM', price: '2 300 000 ₸' },
      ],
      rows: [
        { name: 'Позиционирование и карта тем', cells: ['✓', '✓', '✓'] },
        { name: 'Экспертные колонки', cells: ['2 в месяц', '3 в месяц', '4 в месяц'] },
        { name: 'Интервью в деловых СМИ', cells: ['—', '✓', '✓'] },
        { name: 'Медиатренинг', cells: ['—', '✓', '✓'] },
        { name: 'Выступления на конференциях', cells: ['—', '—', '✓'] },
        { name: 'Антикризисная поддержка', cells: ['—', '—', '✓'] },
      ],
    },
    note: 'Стоимость в месяц, без НДС',
  },
  pricing: {
    title: 'Стоимость и оплата',
    rows: [
      { label: 'Базовая стоимость', note: 'при помесячной оплате', value: 'от 800 000 ₸ / мес', badge: '', save: '', style: 'plain' },
      { label: 'Оплата за год', note: '12 месяцев одним платежом', value: '', badge: '−20%', save: 'Экономия до 5 520 000 ₸', style: 'vivid' },
      { label: 'Оплата за 6 месяцев', note: '', value: '', badge: '−10%', save: '', style: 'blue' },
      { label: 'Поквартальная оплата', note: '', value: '', badge: '−5%', save: '', style: 'gray' },
    ],
    note: 'Стоимость указана без НДС',
  },
  stats: {
    title: 'Программа в цифрах',
    lead: 'Что получает руководитель за год работы с нами.',
    items: [
      { title: '120+', text: 'публикаций в деловых и отраслевых СМИ', icon: 'ph:newspaper' },
      { title: '40', text: 'изданий в медиакарте программы', icon: 'ph:globe-hemisphere-east' },
      { title: '12', text: 'месяцев системной работы', icon: 'ph:calendar-check' },
    ],
  },
  timeline: {
    title: 'Дорожная карта на 12 месяцев',
    items: [
      { title: '1 месяц', text: 'Аудит, позиционирование и карта тем' },
      { title: '2–3 месяц', text: 'Первые колонки и комментарии в отраслевых СМИ' },
      { title: '4–6 месяц', text: 'Интервью в деловых медиа и подкасты' },
      { title: '7–12 месяц', text: 'Конференции, рейтинги и премии' },
    ],
  },
  quote: {
    label: 'Отзыв клиента',
    title: 'За год о нашем директоре узнал весь рынок — теперь партнёры приходят к нам сами.',
    lead: 'Имя Фамилия',
    note: 'Генеральный директор, компания',
  },
  case: {
    title: 'Кейс: голос финтеха в деловых медиа',
    lead: 'Генеральный директор финтех-компании, 12 месяцев программы',
    items: [
      { title: 'Задача', text: 'Сделать руководителя заметным экспертом рынка платежей.' },
      { title: 'Решение', text: 'Карта тем, две колонки в месяц, интервью и выступления на отраслевых конференциях.' },
      { title: 'Результат', text: 'Руководитель вошёл в число самых цитируемых спикеров отрасли.' },
    ],
    big: '×3',
    label: 'рост упоминаний в СМИ за год',
  },
  contacts: {
    title: 'Обсудим вашу программу?',
    lead: 'Подготовим стратегию за 5 рабочих дней после встречи.',
    items: [
      { title: 'Менеджер', text: 'Имя Фамилия' },
      { title: 'Телефон', text: '+7 700 000 00 00' },
      { title: 'Почта', text: 'mail@domain.kz' },
    ],
  },
};

function sampleData(kind, over = {}) {
  return Object.assign(emptyData(), JSON.parse(JSON.stringify(SAMPLE[kind] || {})), JSON.parse(JSON.stringify(over)));
}

/* Готовые структуры КП для экрана выбора. */
const STRUCTURES = [
  {
    id: 'packages',
    name: 'КП с пакетами',
    desc: 'Полная программа: проблема, польза, что делаем, этапы, форматы, итог, три пакета, сравнение и стоимость.',
    header: 'Executive Visibility',
    slides: [
      ['cover'], ['problem'], ['benefits'], ['whatwedo'], ['stages'], ['list'], ['summary'],
      ['package', {
        title: 'BASE: присутствие в отраслевых медиа',
        lead: 'Для тех, кто начинает публичный путь',
        label: '',
        items: [
          { title: '', text: 'Позиционирование и карта тем' },
          { title: '', text: '2 экспертные колонки в месяц' },
          { title: '', text: 'Комментарии к отраслевым новостям' },
          { title: '', text: 'Ведение LinkedIn: 4 поста в месяц' },
          { title: '', text: 'Ежемесячный отчёт' },
        ],
        level: 1, price: '800 000 ₸ / месяц',
      }],
      ['package'],
      ['package', {
        title: 'PREMIUM: лидер мнений отрасли',
        lead: 'Для тех, кто формирует повестку рынка',
        label: 'Всё из PRO, плюс:',
        items: [
          { title: '', text: 'Выступления на ключевых конференциях' },
          { title: '', text: 'Участие в рейтингах и премиях' },
          { title: '', text: 'Колонки в международных изданиях' },
          { title: '', text: 'Персональный менеджер' },
          { title: '', text: 'Антикризисная поддержка' },
        ],
        level: 3, price: '2 300 000 ₸ / месяц',
      }],
      ['compare'], ['pricing'], ['contacts'],
    ],
  },
  {
    id: 'service',
    name: 'КП на услугу',
    desc: 'Короткая история: ситуация клиента, что делаем, этапы, результат и стоимость.',
    header: 'Executive Visibility',
    slides: [['cover'], ['problem'], ['whatwedo'], ['stages'], ['summary'], ['pricing'], ['contacts']],
  },
  {
    id: 'proof',
    name: 'КП с кейсом и цифрами',
    desc: 'Доказательная история: цифры, ситуация, что делаем, дорожная карта, кейс, отзыв клиента и стоимость.',
    header: 'Executive Visibility',
    slides: [['cover'], ['stats'], ['problem'], ['whatwedo'], ['timeline'], ['case'], ['quote'], ['pricing'], ['contacts']],
  },
  {
    id: 'short',
    name: 'Короткое КП',
    desc: 'Пять слайдов: обложка, главная мысль, форматы, стоимость, контакты.',
    header: 'Executive Visibility',
    slides: [['cover'], ['thesis'], ['list'], ['pricing'], ['contacts']],
  },
];
