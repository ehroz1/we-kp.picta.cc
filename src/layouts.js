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
 *   client   — { url, mono } логотип клиента или null
 *   preview  — true в редакторе: пустые поля показываются серыми подсказками
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
  return `<ul class="${cls}" style="--n:${c}" data-f="items">${entries.map(e => `<li>${itemInner(e, env)}</li>`).join('')}</ul>`;
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
    `<li class="${j === 0 || (two && j === rows) ? 'first' : ''}"><span class="n">${pad2(j + 1)}</span><span class="tx">${itemInner(e, env)}</span></li>`
  ).join('')}</ol>`;
}

/* Маркированный список с линиями (текст, пакет). */
function markList(entries, env, cls = '') {
  if (!entries.length) return '';
  return `<ul class="ml ${sizeClass(entries.length, 3, 5, 7)} ${cls}" data-f="items">${entries.map(e => `<li>${itemInner(e, env)}</li>`).join('')}</ul>`;
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

function clientLogo(env) {
  if (!env.client || !env.client.url) return '';
  return `<span class="divi"></span><img class="client${env.client.mono ? ' mono' : ''}" src="${esc(env.client.url)}" alt="">`;
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
    fields: [['note', 'Надпись над заголовком'], ['title', 'Заголовок'], ['lead', 'Подзаголовок']],
    render(d, env) {
      return `<div class="sl sl-cover bg-cover" data-kind="cover" style="--k:${env.k}">${bars()}`
        + `<div class="cv-top">${logoSvg()}${clientLogo(env)}</div>`
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
        { graphics: rings(1900, 1100, [270, 380, 490, 600], 180), bodyCls: items.length ? 'has-items' : 'centered' });
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
        { graphics: gridPanel() });
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
        ? `<ol class="bcols" style="--n:${n}" data-f="items">${entries.map((e, j) => `<li><span class="bn">${pad2(j + 1)}</span>${itemInner(e, env)}</li>`).join('')}</ol>`
        : '';
      return frame('benefits', 'bg-glow', env,
        `<div class="head-blk">${blk('h2', 't-h2', d.title, 'Зачем это клиенту', env, 'title')}${paras(d.lead, 't-lead mt-lead', '', env, 'lead')}</div>`
        + cols
        + blk('p', 't-note mt-note', d.note, '', env, 'note'),
        { graphics: rings(1960, -40, [290, 410, 530, 650], 170) });
    },
  },

  whatwedo: {
    name: 'Что делаем',
    group: 'lists',
    about: 'Слева синяя панель с заголовком и тремя квадратами, справа нумерованный список.',
    fields: [['title', 'Заголовок на синей панели'], ['lead', 'Текст на панели'], ['items', 'Пункты (3–7)'], ['note', 'Сноска']],
    render(d, env) {
      return `<div class="sl sl-wwd" data-kind="whatwedo" style="--k:${env.k}">`
        + `<div class="panel vivid">${GRAIN}</div>`
        + head(env)
        + `<div class="sl-body" data-fit>`
        + `<div class="lc on-blue" data-fit>${blk('h2', 't-h2', d.title, 'Что мы делаем', env, 'title')}${paras(d.lead, 't-desc', '', env, 'lead')}<div class="sq-row"><i></i><i></i><i></i></div></div>`
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
      const two = n > 4;
      const c = n <= 4 ? Math.max(n, 1) : n <= 6 ? 3 : 4;
      const cards = n
        ? `<div class="cards${two ? ' two-rows' : ''}" style="--c:${c}" data-f="items">${entries.map((e, j) =>
          `<div class="card${j === 0 ? ' vivid' : ''}">${j === 0 ? GRAIN : ''}<span class="bignum">${j + 1}</span><div class="cin" data-fit>${itemInner(e, env)}</div></div>`
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
        { graphics: rings(-100, 1180, [260, 480, 600], 200) });
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
        list = `<ul class="ml ${sizeClass(half, 3, 5, 7)} two" style="grid-template-rows:repeat(${half},auto);grid-auto-flow:column" data-f="items">${items.map(e => `<li>${itemInner(e, env)}</li>`).join('')}</ul>`;
      } else list = markList(items, env);
      return frame('text', 'bg-glow', env,
        blk('h2', 't-h2', d.title, '', env, 'title')
        + text + list
        + blk('p', 't-note mt-note', d.note, '', env, 'note'));
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
        ? `<div class="chain" data-f="items">${entries.map(e => `<div class="ci">${itemInner(e, env)}</div>`).join(ARROW)}</div>`
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

  contacts: {
    name: 'Контакты',
    group: 'start',
    about: 'Финальный слайд: заголовок, текст и контакты, большие кольца справа.',
    fields: [['title', 'Заголовок'], ['lead', 'Текст'], ['items', 'Контакты: подпись и значение'], ['note', 'Сноска']],
    render(d, env) {
      const entries = itemsFor(d, env, 3, i => ['Телефон', 'Почта', 'Сайт'][i]);
      const n = entries.length <= 2 ? Math.max(entries.length, 1) : entries.length === 4 ? 2 : 3;
      const ct = entries.length ? `<ul class="ct" style="--n:${n}" data-f="items">${entries.map(e => `<li>${itemInner(e, env)}</li>`).join('')}</ul>` : '';
      return `<div class="sl sl-contacts bg-cover" data-kind="contacts" style="--k:${env.k}">`
        + rings(1960, 1160, [300, 420, 540, 660], 200)
        + `<div class="cv-top">${logoSvg()}${clientLogo(env)}</div>`
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
  { id: 'meaning', name: 'Смысл' },
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
    } else if (key !== 'level') out.push(d[key]);
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
    id: 'short',
    name: 'Короткое КП',
    desc: 'Пять слайдов: обложка, главная мысль, форматы, стоимость, контакты.',
    header: 'Executive Visibility',
    slides: [['cover'], ['thesis'], ['list'], ['pricing'], ['contacts']],
  },
];
