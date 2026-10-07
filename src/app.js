/*
 * Интерфейс конструктора КП: стартовый экран (вставка текста, черновики,
 * структуры), редактор (слайды, превью, поля), «уместить», отмена, показ,
 * экспорт в PDF (печать браузера — текст остаётся текстом), PNG и HTML.
 *
 * Слайды — HTML из layouts.js, 1920×1080, масштабируются CSS-трансформацией.
 * Подбор кегля («уместить») делается в скрытом блоке #measure в натуральную
 * величину: ищем наибольший --k, при котором ни один [data-fit] не переполнен.
 */

'use strict';

const STORE_DRAFTS = 'wekp.drafts.v1';
const STORE_THEME = 'wekp.theme.v1';
const STORE_START_TEXT = 'wekp.startText.v1';
const STORE_INSTALL_DISMISSED = 'wekp.installDismissed.v1';
const DRAFTS_LIMIT = 60;
const UNDO_LIMIT = 100;
const UNDO_COALESCE_MS = 900;
const K_MIN = 0.62;          // мельче — уже не по гайду (текст и так не меньше 24 px)
const SIZE_MIN = 60, SIZE_MAX = 100, SIZE_STEP = 5;
const W = 1920, H = 1080;

const state = {
  draft: null,          // { id, name, createdAt, updatedAt, deck, slides: [{ id, kind, data, tune }], source }
  current: 0,
  preview: null,        // { structure, slides, index } — открытое окно структуры
};

const el = {};

/* ================================================================ утилиты */

function uid() { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4); }
function clone(v) { return JSON.parse(JSON.stringify(v)); }
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

function plural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}
function slideCountText(n) { return `${n} ${plural(n, 'слайд', 'слайда', 'слайдов')}`; }

function storeGet(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch { return fallback; }
}
function storeSet(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
}

let statusTimer = null;
function say(text, ms = 3800) {
  el.status.textContent = text;
  el.status.classList.add('show');
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => el.status.classList.remove('show'), ms);
}

const TRANSLIT = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l',
  м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh',
  щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya', ә: 'a', ғ: 'g', қ: 'q', ң: 'n', ө: 'o', ұ: 'u',
  ү: 'u', һ: 'h', і: 'i',
};
function slug(text) {
  return String(text || '').toLowerCase().split('').map(ch => TRANSLIT[ch] ?? ch).join('')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'kp';
}

function timeAgo(ts) {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return 'только что';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} ${plural(m, 'минуту', 'минуты', 'минут')} назад`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} ${plural(h, 'час', 'часа', 'часов')} назад`;
  return new Date(ts).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
}

function isTyping(target) {
  return target && (target.tagName === 'INPUT' && !['range', 'checkbox', 'radio', 'button', 'file'].includes(target.type) ||
    target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable);
}

function debounce(fn, ms) {
  let t = null;
  const f = (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  f.flush = (...args) => { clearTimeout(t); fn(...args); };
  return f;
}

/* =================================================================== иконки */

function iconSvg(name) { return (typeof ICONS !== 'undefined' && ICONS[name]) || ''; }
function paintIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach(node => {
    if (node.dataset.painted === node.dataset.icon) return;
    const svg = iconSvg(node.dataset.icon);
    if (!svg) return;
    if (node.classList.contains('icon-btn') || node.classList.contains('caret') || (!node.childElementCount && !node.textContent.trim())) node.innerHTML = svg;
    else node.insertAdjacentHTML('afterbegin', svg);
    node.dataset.painted = node.dataset.icon;
  });
}
function btn(icon, title, cls = 'icon-btn sm') {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = cls;
  b.title = title;
  b.setAttribute('aria-label', title);
  b.innerHTML = iconSvg(icon);
  return b;
}
function h(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

/* ===================================================================== тема */

function systemPrefersDark() { return Boolean(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches); }
function isDarkActive() {
  const t = document.documentElement.dataset.theme;
  return t ? t === 'dark' : systemPrefersDark();
}
function syncThemeButtons() {
  const dark = isDarkActive();
  for (const b of [el.btnTheme, el.btnThemeStart]) {
    b.title = dark ? 'Светлая тема' : 'Тёмная тема';
    b.innerHTML = iconSvg(dark ? 'sun' : 'moon');
  }
}
function toggleTheme() {
  const next = isDarkActive() ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem(STORE_THEME, next); } catch { /* не запомнится — не страшно */ }
  syncThemeButtons();
}

/* ======================================================= установка на телефон */

let deferredInstallPrompt = null;
function isStandaloneDisplay() {
  return Boolean((window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone);
}
function wireInstallBanner() {
  let dismissed = false;
  try { dismissed = localStorage.getItem(STORE_INSTALL_DISMISSED) === '1'; } catch { /* не критично */ }
  if (dismissed || isStandaloneDisplay()) return;
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredInstallPrompt = e;
    el.installBannerText.textContent = 'Установите конструктор КП как приложение — отдельная иконка, работает без интернета.';
    el.installBanner.hidden = false;
  });
  el.installBannerAction.addEventListener('click', async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    el.installBanner.hidden = true;
  });
  el.installBannerClose.addEventListener('click', () => {
    el.installBanner.hidden = true;
    try { localStorage.setItem(STORE_INSTALL_DISMISSED, '1'); } catch { /* не критично */ }
  });
  window.addEventListener('appinstalled', () => { el.installBanner.hidden = true; });
}

/* ======================================================== отрисовка слайдов */

function emptyDeck() { return { header: '', numbers: true, client: null }; }

function slideHtml(slide, index, deck, k, preview) {
  return KINDS[slide.kind].render(slide.data, {
    k: Math.round(k * 1000) / 1000,
    num: pad2(index + 1),
    deck,
    client: deck.client && deck.client.url ? deck.client : null,
    preview: Boolean(preview),
  });
}

let measureHost = null;
function measureBox() {
  if (!measureHost) {
    measureHost = document.createElement('div');
    measureHost.className = 'measure';
    measureHost.setAttribute('aria-hidden', 'true');
    document.body.appendChild(measureHost);
  }
  return measureHost;
}

function overflows(root) {
  for (const e of root.querySelectorAll('[data-fit]')) {
    if (e.scrollHeight > e.clientHeight + 1 || e.scrollWidth > e.clientWidth + 1) return true;
  }
  return false;
}

/*
 * «Уместить»: наибольший коэффициент кегля ≤ maxK, при котором текст влезает.
 * Считается по экспортной разметке (без серых подсказок) и кешируется по содержимому.
 */
const fitCache = new Map();
function maxKOf(slide) { return clamp((slide.tune && slide.tune.size) || 100, SIZE_MIN, SIZE_MAX) / 100; }
function fitSlide(slide, deck, kindOverride = null, steps = 7) {
  const kind = kindOverride || slide.kind;
  const data = kindOverride ? convertData(slide.data, slide.kind, kind) : slide.data;
  const maxK = maxKOf(slide);
  const key = JSON.stringify([kind, data, maxK, Boolean(deck.client && deck.client.url)]);
  const hit = fitCache.get(key);
  if (hit) return hit;
  const box = measureBox();
  const probe = { kind, data };
  const test = k => {
    box.innerHTML = slideHtml(probe, 0, deck, k, false);
    return !overflows(box.firstElementChild);
  };
  let k = maxK, overflow = false;
  if (!test(maxK)) {
    if (!test(K_MIN)) { k = K_MIN; overflow = true; }
    else {
      let lo = K_MIN, hi = maxK;
      for (let i = 0; i < steps; i++) {
        const mid = (lo + hi) / 2;
        if (test(mid)) lo = mid; else hi = mid;
      }
      k = Math.floor(lo * 1000) / 1000;
    }
  }
  box.innerHTML = '';
  const res = { k, overflow, shrunk: k < maxK - 0.004, maxK };
  if (fitCache.size > 600) fitCache.clear();
  fitCache.set(key, res);
  return res;
}

/* Миниатюра: слайд в натуральную величину внутри уменьшенной рамки. */
function miniHtml(slide, index, deck, opts = {}) {
  const fit = opts.kind ? fitSlide(slide, deck, opts.kind, 5) : fitSlide(slide, deck);
  const probe = opts.kind ? { kind: opts.kind, data: convertData(slide.data, slide.kind, opts.kind) } : slide;
  return slideHtml(probe, index, deck, fit.k, opts.preview);
}
function paintMini(box, slide, index, deck, opts = {}) {
  const w = box.clientWidth || opts.width || 200;
  box.innerHTML = `<div class="mini-in" style="transform:scale(${w / W})">${miniHtml(slide, index, deck, opts)}</div>`;
}

/* ============================================================ черновики */

function normalizeSlide(s) {
  const data = Object.assign(emptyData(), s.data || {});
  data.items = (data.items || []).map(it => ({ title: it.title || '', text: it.text || '' }));
  data.rows = (data.rows || []).map(r => Object.assign(emptyRow(), r));
  data.table = Object.assign({ corner: '', priceLabel: '', cols: [], rows: [] }, data.table || {});
  return { id: s.id || uid(), kind: KINDS[s.kind] ? s.kind : 'text', data, tune: Object.assign({ size: 100 }, s.tune || {}) };
}
function normalizeDraft(d) {
  return {
    id: d.id || uid(),
    name: d.name || 'Коммерческое предложение',
    createdAt: d.createdAt || Date.now(),
    updatedAt: d.updatedAt || Date.now(),
    deck: Object.assign(emptyDeck(), d.deck || {}),
    slides: (d.slides || []).map(normalizeSlide),
    source: d.source || '',
  };
}
function loadDrafts() {
  const list = storeGet(STORE_DRAFTS, []);
  return Array.isArray(list) ? list.filter(d => d && Array.isArray(d.slides) && d.slides.length) : [];
}
function saveDraftNow() {
  if (!state.draft) return;
  state.draft.updatedAt = Date.now();
  const list = loadDrafts().filter(d => d.id !== state.draft.id);
  list.unshift(state.draft);
  while (list.length > DRAFTS_LIMIT) list.pop();
  if (!storeSet(STORE_DRAFTS, list)) {
    // место кончилось: убираем самые старые и пробуем ещё раз
    while (list.length > 1) { list.pop(); if (storeSet(STORE_DRAFTS, list)) return; }
    say('Не удалось сохранить черновик — в браузере кончилось место');
  }
}
const scheduleSave = debounce(saveDraftNow, 600);
function deleteDraft(id) {
  storeSet(STORE_DRAFTS, loadDrafts().filter(d => d.id !== id));
  buildDrafts();
}

function newDraft(slides, opts = {}) {
  return normalizeDraft({
    id: uid(),
    name: opts.name || 'Коммерческое предложение',
    deck: Object.assign(emptyDeck(), opts.deck || {}),
    slides: slides.map(s => ({ id: uid(), kind: s.kind, data: s.data, tune: { size: 100 } })),
    source: opts.source || '',
  });
}

/* ========================================================= стартовый экран */

function buildDrafts() {
  const drafts = loadDrafts();
  el.draftsSection.hidden = !drafts.length;
  el.draftsRow.innerHTML = '';
  for (const raw of drafts) {
    const d = normalizeDraft(raw);
    const card = h('div', 'draft');
    card.tabIndex = 0;
    card.setAttribute('role', 'button');
    const thumb = h('div', 'thumb mini');
    const name = h('span', 'name', d.name);
    const meta = h('span', 'meta', `${slideCountText(d.slides.length)} · ${timeAgo(d.updatedAt)}`);
    const del = btn('trash', 'Удалить КП', 'icon-btn sm del');
    del.addEventListener('click', e => {
      e.stopPropagation();
      if (confirm(`Удалить «${d.name}»? Вернуть не получится.`)) deleteDraft(d.id);
    });
    card.append(thumb, name, meta, del);
    const open = () => openEditor(d, { restored: true });
    card.addEventListener('click', open);
    card.addEventListener('keydown', e => { if (e.key === 'Enter') open(); });
    el.draftsRow.appendChild(card);
    requestAnimationFrame(() => paintMini(thumb, d.slides[0], 0, d.deck, { width: 220 }));
  }
}

function structureSlides(st, mode) {
  return st.slides.map(([kind, over]) => ({ kind, data: mode === 'empty' ? emptyData() : sampleData(kind, over || {}) }));
}

function buildStructures() {
  el.tplGrid.innerHTML = '';
  for (const st of STRUCTURES) {
    const tile = h('button', 'tpl-tile');
    tile.type = 'button';
    const stack = h('div', 'tile-thumb');
    const t1 = h('div', 'mini');
    stack.appendChild(t1);
    const info = h('div', 'tile-info');
    info.append(h('span', 'tile-name', st.name), h('span', 'tile-meta', `${slideCountText(st.slides.length)}`), h('span', 'tile-desc', st.desc));
    tile.append(stack, info);
    tile.addEventListener('click', () => openStructure(st));
    el.tplGrid.appendChild(tile);
    const slides = structureSlides(st, 'sample').map(s => normalizeSlide(s));
    tile._paint = () => paintMini(t1, slides[0], 0, Object.assign(emptyDeck(), { header: st.header }));
  }
  const blank = h('button', 'tpl-tile blank');
  blank.type = 'button';
  blank.innerHTML = `<div class="tile-thumb"><div class="blank-plus">${iconSvg('plus')}</div></div><div class="tile-info"><span class="tile-name">Пустая презентация</span><span class="tile-meta">1 слайд</span><span class="tile-desc">Обложка — остальное добавите сами через «+ Слайд».</span></div>`;
  blank.addEventListener('click', () => openEditor(newDraft([{ kind: 'cover', data: emptyData() }]), { fresh: true }));
  el.tplGrid.appendChild(blank);
}
function paintStructures() { for (const t of el.tplGrid.children) if (t._paint) t._paint(); }

function openStructure(st) {
  const deck = Object.assign(emptyDeck(), { header: st.header });
  state.preview = { st, deck, slides: structureSlides(st, 'sample').map(s => normalizeSlide(s)), index: 0 };
  el.tplTitle.textContent = st.name;
  el.tplDesc.textContent = st.desc;
  el.tplKinds.innerHTML = '';
  state.preview.slides.forEach(s => el.tplKinds.appendChild(h('li', '', KINDS[s.kind].name)));
  el.tplModal.hidden = false;
  el.tplStrip.innerHTML = '';
  state.preview.slides.forEach((s, i) => {
    const b = h('button', 'strip-item');
    b.type = 'button';
    b.title = KINDS[s.kind].name;
    const m = h('div', 'mini');
    b.appendChild(m);
    b.addEventListener('click', () => { state.preview.index = i; paintStructurePreview(); });
    el.tplStrip.appendChild(b);
  });
  requestAnimationFrame(() => {
    [...el.tplStrip.children].forEach((b, i) => paintMini(b.firstChild, state.preview.slides[i], i, deck, { width: 120 }));
    paintStructurePreview();
  });
  el.tplUse.focus();
}
function paintStructurePreview() {
  const p = state.preview;
  if (!p) return;
  paintMini(el.tplStage, p.slides[p.index], p.index, p.deck);
  [...el.tplStrip.children].forEach((b, i) => b.classList.toggle('on', i === p.index));
  const on = el.tplStrip.children[p.index];
  if (on && on.scrollIntoView) on.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}
function closeStructure() { el.tplModal.hidden = true; state.preview = null; }
function startStructure(mode) {
  const p = state.preview;
  const d = newDraft(structureSlides(p.st, mode), { name: mode === 'empty' ? 'Коммерческое предложение' : p.st.name, deck: { header: mode === 'empty' ? '' : p.st.header } });
  closeStructure();
  openEditor(d, { fresh: true });
}

/* ------------------------------------------ вставка текста: общий механизм */

/* Вставка из Word / Google Docs: форматирование → разметка (# заголовки, - пункты). */
function richPaste(textarea, onChange) {
  textarea.addEventListener('paste', e => {
    const html = e.clipboardData && e.clipboardData.getData('text/html');
    if (!html) return;
    let md = '';
    try { md = htmlToMarkup(html); } catch { md = ''; }
    if (!md.trim()) return;
    e.preventDefault();
    insertText(textarea, md);
    onChange();
  });
}
function insertText(textarea, text) {
  textarea.focus();
  // execCommand сохраняет родную отмену ⌘Z в поле; если не сработал — вставляем напрямую
  let ok = false;
  try { ok = document.execCommand('insertText', false, text); } catch { ok = false; }
  if (!ok) {
    const { selectionStart: a, selectionEnd: b, value } = textarea;
    textarea.value = value.slice(0, a) + text + value.slice(b);
    textarea.selectionStart = textarea.selectionEnd = a + text.length;
  }
}
async function readClipboard() {
  if (navigator.clipboard && navigator.clipboard.read) {
    try {
      const items = await navigator.clipboard.read();
      for (const it of items) {
        if (it.types.includes('text/html')) {
          const md = htmlToMarkup(await (await it.getType('text/html')).text());
          if (md.trim()) return md;
        }
      }
      for (const it of items) if (it.types.includes('text/plain')) return await (await it.getType('text/plain')).text();
    } catch { /* нет разрешения — попробуем текстом */ }
  }
  if (navigator.clipboard && navigator.clipboard.readText) {
    try { return await navigator.clipboard.readText(); } catch { /* нет разрешения */ }
  }
  return null;
}

/* Файл Word / текст → разметка в поле. Перетаскивание и кнопка «Открыть файл». */
async function loadTextFile(file, textarea, onChange) {
  try {
    const md = await fileToMarkup(file);
    if (!md || !md.trim()) { say('В файле не нашлось текста'); return; }
    textarea.value = md;
    onChange();
    say(`Файл «${file.name}» прочитан`);
  } catch (err) {
    console.error(err);
    say('Не получилось прочитать файл. Откройте его и скопируйте текст — ⌘A, ⌘C, затем ⌘V сюда');
  }
}
function fileDrop(zone, textarea, onChange) {
  zone.addEventListener('dragover', e => {
    if (![...e.dataTransfer.types].includes('Files')) return;
    e.preventDefault();
    zone.classList.add('drop');
  });
  zone.addEventListener('dragleave', e => { if (!zone.contains(e.relatedTarget)) zone.classList.remove('drop'); });
  zone.addEventListener('drop', e => {
    zone.classList.remove('drop');
    const file = e.dataTransfer.files && e.dataTransfer.files[0];
    if (!file) return;
    e.preventDefault();
    loadTextFile(file, textarea, onChange);
  });
}

/* Сетка миниатюр результата разбора (стартовый экран и окно вставки). */
function paintOutline(grid, slides, deck) {
  grid.innerHTML = '';
  slides.forEach((s, i) => {
    const cell = h('div', 'hp-cell');
    const m = h('div', 'mini');
    const cap = h('span', 'hp-cap');
    cap.innerHTML = `<b>${pad2(i + 1)}</b> ${esc(KINDS[s.kind].name)}`;
    cell.append(m, cap);
    grid.appendChild(cell);
  });
  requestAnimationFrame(() => {
    [...grid.children].forEach((cell, i) => paintMini(cell.firstChild, slides[i], i, deck, { width: 160 }));
  });
}

function parsed(text) {
  if (!text.trim()) return null;
  const r = importText(text);
  if (!r.slides.length) return null;
  r.slides = r.slides.map(s => normalizeSlide(s));
  r.deck = Object.assign(emptyDeck(), { header: r.header });
  return r;
}

const updateStartPreview = debounce(() => {
  const text = el.startText.value;
  storeSet(STORE_START_TEXT, text);
  const has = Boolean(text.trim());
  el.pasteEmpty.hidden = has;
  el.btnClearStart.hidden = !has;
  const r = has ? parsed(text) : null;
  el.btnBuild.disabled = !r;
  el.heroEmpty.hidden = Boolean(r);
  el.heroGrid.hidden = !r;
  el.heroCount.textContent = r ? slideCountText(r.slides.length) : '';
  if (r) paintOutline(el.heroGrid, r.slides, r.deck);
}, 250);

function buildFromStart() {
  const r = parsed(el.startText.value);
  if (!r) return;
  const name = (r.slides[0].data.title || 'Коммерческое предложение').replace(/\*/g, '').split('\n')[0].slice(0, 80);
  const d = newDraft(r.slides, { name, deck: r.deck, source: el.startText.value });
  el.startText.value = '';
  storeSet(STORE_START_TEXT, '');
  updateStartPreview.flush();
  openEditor(d, { fresh: true });
  say('Готово! Проверьте слайды — раскладку любого можно сменить справа в один клик', 5200);
}

/* Демо на пустом стартовом экране: обложка-пример. */
function paintHeroDemo() {
  const s = normalizeSlide({ kind: 'cover', data: sampleData('cover') });
  paintMini(el.heroDemo, s, 0, emptyDeck(), { width: 360 });
}

/* =================================================================== редактор */

function currentSlide() { return state.draft ? state.draft.slides[state.current] : null; }
function deck() { return state.draft.deck; }

function openEditor(draft, opts = {}) {
  state.draft = normalizeDraft(draft);
  state.current = 0;
  undoStack.length = 0;
  redoStack.length = 0;
  syncUndoButtons();
  el.start.hidden = true;
  el.editor.hidden = false;
  closePops();
  if (!history.state || history.state.screen !== 'editor') history.pushState({ screen: 'editor' }, '', '#edit');
  el.docName.value = state.draft.name;
  document.title = `${state.draft.name} · КП WE Media`;
  buildDeckBox();
  buildSlidesList();
  buildForm();
  requestAnimationFrame(() => { renderStage(); paintThumbs(); buildLayouts(); updateCheck(); });
  window.scrollTo(0, 0);
  if (opts.fresh) saveDraftNow();
}

function closeEditor(fromHistory = false) {
  if (!state.draft) return;
  saveDraftNow();
  state.draft = null;
  el.editor.hidden = true;
  el.start.hidden = false;
  document.title = 'КП · WE Media';
  buildDrafts();
  if (!fromHistory && history.state && history.state.screen === 'editor') history.back();
}

function selectSlide(i, opts = {}) {
  if (!state.draft) return;
  i = clamp(i, 0, state.draft.slides.length - 1);
  const same = i === state.current;
  state.current = i;
  syncSlidesSelection();
  if (!same || opts.force) { buildForm(); buildLayouts(); }
  renderStage();
}

/* Любая правка содержимого: сцена сразу, миниатюры и раскладки — чуть погодя, сохранение. */
let stageRaf = null;
function changed(opts = {}) {
  if (!stageRaf) stageRaf = requestAnimationFrame(() => { stageRaf = null; renderStage(); });
  scheduleThumbs();
  if (!opts.noLayouts) scheduleLayouts();
  scheduleSave();
  scheduleCheck();
}

/* ------------------------------------------------------------- сцена */

function stageScale() {
  const box = el.stage;
  const cs = getComputedStyle(box);
  const bw = box.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const bh = box.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
  return Math.max(0.05, Math.min(bw / W, bh / H));
}

function renderStage() {
  const s = currentSlide();
  if (!s || el.editor.hidden) return;
  const d = deck();
  const fit = fitSlide(s, d);
  const scale = stageScale();
  el.stageFrame.style.width = `${Math.floor(W * scale)}px`;
  el.stageFrame.style.height = `${Math.floor(H * scale)}px`;
  el.stageSlide.style.transform = `scale(${scale})`;
  el.stageSlide.innerHTML = slideHtml(s, state.current, d, fit.k, true);
  if (state.flashField) {
    const f = state.flashField;
    state.flashField = null;
    const node = el.stageSlide.querySelector(`[data-f="${CSS.escape(f)}"]`);
    if (node) { node.classList.add('flash'); setTimeout(() => node.classList.remove('flash'), 700); }
  }
  updateNotes(s, fit);
}

function updateNotes(s, fit) {
  const notes = [];
  if (fit.overflow) notes.push({ warn: true, text: 'Текст не помещается даже мелким кеглем', action: canSplit(s) ? ['scissors', 'Разбить на 2 слайда', () => splitSlide(state.current)] : null });
  else if (fit.shrunk) notes.push({ text: `Кегль ${Math.round(fit.k * 100)}% — уменьшен, чтобы текст поместился`, action: canSplit(s) && fit.k < 0.8 ? ['scissors', 'Разбить на 2', () => splitSlide(state.current)] : null });
  const hidden = hiddenFields(s);
  if (hidden.length) notes.push({ warn: true, text: `В этой раскладке не видно: ${hidden.join(', ')}` });
  // гайд: акцентный синий фон — не чаще одного раза на 4–6 слайдов
  if (s.kind === 'summary') {
    const near = state.draft.slides.some((o, j) => o !== s && o.kind === 'summary' && Math.abs(j - state.current) < 4);
    if (near) notes.push({ warn: true, text: 'Рядом ещё один синий слайд — по стилю синий фон не чаще раза на 4–6 слайдов' });
  }
  const live = liveItems(s.data.items).length;
  const rec = { problem: 3, benefits: 4, stages: 4, summary: 4, contacts: 6, whatwedo: 7 }[s.kind];
  if (rec && live > rec && kindFields(s.kind).includes('items')) notes.push({ text: `В раскладке «${KINDS[s.kind].name}» лучше до ${rec} пунктов`, action: canSplit(s) ? ['scissors', 'Разбить', () => splitSlide(state.current)] : null });
  el.notes.innerHTML = '';
  for (const n of notes) {
    const row = h('div', `note${n.warn ? ' warn' : ''}`);
    row.innerHTML = iconSvg(n.warn ? 'warning' : 'magic-wand');
    row.appendChild(h('span', '', n.text));
    if (n.action) {
      const b = h('button', 'btn btn-ghost btn-xs');
      b.type = 'button';
      b.innerHTML = iconSvg(n.action[0]);
      b.appendChild(document.createTextNode(n.action[1]));
      b.addEventListener('click', n.action[2]);
      row.appendChild(b);
    }
    el.notes.appendChild(row);
  }
  el.sizeVal.textContent = `${Math.round(maxKOf(s) * 100)}%`;
  el.sizeVal.title = 'Максимальный размер текста на этом слайде. Щёлкните, чтобы вернуть 100%';
}

/* Клик по тексту на сцене — фокус на нужное поле формы. */
function focusField(path) {
  if (!path) return;
  const exact = el.form.querySelector(`[data-key="${CSS.escape(path)}"]`);
  const base = path.split('.')[0];
  const node = exact || el.form.querySelector(`[data-key="${CSS.escape(base)}"]`) || el.form.querySelector(`[data-key^="${CSS.escape(base)}."]`);
  if (!node) return;
  const target = node.matches('input, textarea') ? node : node.querySelector('input, textarea');
  if (target) {
    target.focus({ preventScroll: true });
    target.scrollIntoView({ block: 'center', behavior: 'smooth' });
    if (target.setSelectionRange && typeof target.value === 'string') target.setSelectionRange(target.value.length, target.value.length);
  } else node.scrollIntoView({ block: 'center', behavior: 'smooth' });
  const wrap = (target || node).closest('.field, .item-row, .prow-ed, .tbl-ed') || node;
  wrap.classList.add('flash');
  setTimeout(() => wrap.classList.remove('flash'), 800);
}

/* ------------------------------------------------------- список слайдов */

function buildSlidesList() {
  const d = state.draft;
  el.slidesList.innerHTML = '';
  d.slides.forEach((s, i) => {
    const item = h('div', 'slide-item');
    item.tabIndex = 0;
    item.setAttribute('role', 'button');
    item.draggable = true;
    item.dataset.index = i;
    item.innerHTML = '<div class="thumb mini"></div><div class="cap"><span class="num"></span><span class="kname"></span></div><div class="tools"></div>';
    item.querySelector('.num').textContent = pad2(i + 1);
    item.querySelector('.kname').textContent = KINDS[s.kind].name;
    const tools = item.querySelector('.tools');
    const bUp = btn('arrow-up', 'Раньше');
    const bDown = btn('arrow-down', 'Позже');
    const bDup = btn('copy', 'Дублировать');
    const bDel = btn('trash', 'Удалить');
    bUp.disabled = i === 0;
    bDown.disabled = i === d.slides.length - 1;
    bDel.disabled = d.slides.length <= 1;
    bUp.addEventListener('click', e => { e.stopPropagation(); moveSlide(i, i - 1); });
    bDown.addEventListener('click', e => { e.stopPropagation(); moveSlide(i, i + 1); });
    bDup.addEventListener('click', e => { e.stopPropagation(); duplicateSlide(i); });
    bDel.addEventListener('click', e => { e.stopPropagation(); deleteSlide(i); });
    tools.append(bUp, bDown, bDup, bDel);
    item.addEventListener('click', () => selectSlide(i));
    item.addEventListener('keydown', e => {
      if (e.target !== item) return;
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectSlide(i); }
      if ((e.key === 'Delete' || e.key === 'Backspace') && d.slides.length > 1) { e.preventDefault(); deleteSlide(i); }
    });
    item.addEventListener('dragstart', e => {
      item.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/x-slide', String(i));
    });
    item.addEventListener('dragend', () => item.classList.remove('dragging'));
    item.addEventListener('dragover', e => {
      if (![...e.dataTransfer.types].includes('text/x-slide')) return;
      e.preventDefault();
      item.classList.add('drag-over');
    });
    item.addEventListener('dragleave', () => item.classList.remove('drag-over'));
    item.addEventListener('drop', e => {
      item.classList.remove('drag-over');
      const from = Number(e.dataTransfer.getData('text/x-slide'));
      if (Number.isNaN(from)) return;
      e.preventDefault();
      moveSlide(from, i);
    });
    el.slidesList.appendChild(item);
  });
  syncSlidesSelection();
  scheduleThumbs();
}

function syncSlidesSelection() {
  [...el.slidesList.children].forEach((item, i) => item.classList.toggle('on', i === state.current));
  const active = el.slidesList.children[state.current];
  if (active && active.scrollIntoView) active.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  const n = state.draft.slides.length;
  el.slideCounter.textContent = `${state.current + 1} / ${n}`;
  el.btnPrev.disabled = state.current === 0;
  el.btnNext.disabled = state.current === n - 1;
}

const scheduleThumbs = debounce(() => paintThumbs(), 160);
function paintThumbs() {
  if (!state.draft) return;
  const d = state.draft;
  [...el.slidesList.children].forEach((item, i) => {
    const s = d.slides[i];
    if (!s) return;
    const thumb = item.querySelector('.thumb');
    const fit = fitSlide(s, d.deck);
    const sig = JSON.stringify([s.kind, s.data, fit.k, i, d.deck]);
    if (thumb._sig !== sig) {
      thumb._sig = sig;
      paintMini(thumb, s, i, d.deck);
    }
    item.classList.toggle('has-warn', fit.overflow || hiddenFields(s).length > 0);
  });
}

function insertSlide(kind) {
  const d = state.draft;
  pushUndo();
  const data = emptyData();
  // пустые строки и колонки сразу — чтобы было куда печатать
  if (kind === 'pricing') data.rows = ['plain', 'vivid', 'blue'].map(style => Object.assign(emptyRow(), { style }));
  if (kind === 'compare') data.table.cols = [1, 2, 3].map(() => ({ name: '', price: '' }));
  const slide = normalizeSlide({ id: uid(), kind, data });
  d.slides.splice(state.current + 1, 0, slide);
  state.current += 1;
  closePops();
  buildSlidesList();
  buildForm();
  buildLayouts();
  changed();
  requestAnimationFrame(() => {
    const first = el.form.querySelector('textarea, input[type="text"]');
    if (first) first.focus();
  });
}

function duplicateSlide(i) {
  const d = state.draft;
  pushUndo();
  const src = d.slides[i];
  d.slides.splice(i + 1, 0, { id: uid(), kind: src.kind, data: clone(src.data), tune: clone(src.tune || {}) });
  state.current = i + 1;
  buildSlidesList();
  buildForm();
  buildLayouts();
  changed();
}

function deleteSlide(i) {
  const d = state.draft;
  if (d.slides.length <= 1) return;
  pushUndo();
  d.slides.splice(i, 1);
  if (state.current >= d.slides.length) state.current = d.slides.length - 1;
  else if (i < state.current) state.current -= 1;
  buildSlidesList();
  buildForm();
  buildLayouts();
  changed();
  say('Слайд удалён — ⌘Z вернёт');
}

function moveSlide(from, to) {
  const d = state.draft;
  if (to < 0 || to >= d.slides.length || from === to) return;
  pushUndo();
  const [s] = d.slides.splice(from, 1);
  d.slides.splice(to, 0, s);
  state.current = to;
  buildSlidesList();
  buildForm();
  changed({ noLayouts: true });
}

/* Разбить: пункты (строки, абзацы) делятся пополам, заголовок повторяется. */
function canSplit(s) {
  const d = s.data;
  if (kindFields(s.kind).includes('items') && liveItems(d.items).length >= 2) return true;
  if (s.kind === 'pricing' && d.rows.length >= 2) return true;
  if (s.kind === 'compare' && d.table.rows.length >= 2) return true;
  return splitParas(d.lead).length >= 2;
}
function splitSlide(i) {
  const d = state.draft;
  const s = d.slides[i];
  if (!canSplit(s)) return;
  pushUndo();
  const a = clone(s.data), b = Object.assign(emptyData(), { title: s.data.title });
  const halve = arr => { const n = Math.ceil(arr.length / 2); return [arr.slice(0, n), arr.slice(n)]; };
  if (kindFields(s.kind).includes('items') && liveItems(a.items).length >= 2) {
    [a.items, b.items] = halve(liveItems(a.items).map(e => e.it));
    b.note = a.note; a.note = '';
    if (s.kind === 'package') { b.level = a.level; b.price = a.price; a.price = ''; b.label = ''; }
  } else if (s.kind === 'pricing' && a.rows.length >= 2) {
    [a.rows, b.rows] = halve(a.rows);
    b.note = a.note; a.note = '';
  } else if (s.kind === 'compare' && a.table.rows.length >= 2) {
    const [r1, r2] = halve(a.table.rows);
    b.table = clone(a.table);
    a.table.rows = r1; b.table.rows = r2;
    a.table.cols = a.table.cols.map(c => Object.assign({}, c, { price: '' }));
    a.table.priceLabel = '';
    b.note = a.note; a.note = '';
  } else {
    const [p1, p2] = halve(splitParas(a.lead));
    a.lead = p1.join('\n\n'); b.lead = p2.join('\n\n');
    b.items = a.items; a.items = [];
    b.note = a.note; a.note = '';
  }
  s.data = a;
  d.slides.splice(i + 1, 0, normalizeSlide({ id: uid(), kind: s.kind, data: b, tune: clone(s.tune) }));
  buildSlidesList();
  buildForm();
  buildLayouts();
  changed();
  say('Слайд разбит на два — ⌘Z вернёт как было');
}

/* ------------------------------------------------------------- меню «+ Слайд» */

function buildAddMenu() {
  el.addPop.innerHTML = '';
  const deckNow = state.draft.deck;
  for (const g of KIND_GROUPS) {
    el.addPop.appendChild(h('p', 'label', g.name));
    const grid = h('div', 'add-grid');
    for (const [kind, k] of Object.entries(KINDS)) {
      if (k.group !== g.id) continue;
      const b = h('button', 'add-item');
      b.type = 'button';
      b.title = k.about;
      const m = h('div', 'mini');
      b.append(m, h('span', '', k.name));
      b.addEventListener('click', () => insertSlide(kind));
      grid.appendChild(b);
      b._paint = () => paintMini(m, normalizeSlide({ kind, data: sampleData(kind) }), 1, deckNow, { width: 150 });
    }
    el.addPop.appendChild(grid);
  }
}
function openAddMenu() {
  buildAddMenu();
  const r = el.btnAddSlide.getBoundingClientRect();
  el.addPop.hidden = false;
  const popH = el.addPop.offsetHeight;
  el.addPop.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - el.addPop.offsetWidth - 8))}px`;
  el.addPop.style.top = `${Math.max(8, Math.min(r.top - popH - 8, window.innerHeight - popH - 8))}px`;
  requestAnimationFrame(() => el.addPop.querySelectorAll('.add-item').forEach(b => b._paint()));
}

/* ------------------------------------------------------------- раскладки */

const scheduleLayouts = debounce(() => buildLayouts(), 450);
function buildLayouts() {
  const s = currentSlide();
  if (!s) return;
  el.layoutName.textContent = KINDS[s.kind].name;
  const d = deck();
  if (!el.layouts.childElementCount) {
    for (const [kind, k] of Object.entries(KINDS)) {
      const b = h('button', 'layout-btn');
      b.type = 'button';
      b.dataset.kind = kind;
      b.title = `${k.name} — ${k.about}`;
      b.append(h('div', 'mini'), h('span', '', k.name));
      b.addEventListener('click', () => switchKind(kind));
      el.layouts.appendChild(b);
    }
  }
  for (const b of el.layouts.children) {
    const kind = b.dataset.kind;
    b.classList.toggle('on', kind === s.kind);
    const m = b.firstChild;
    const sig = JSON.stringify([kind, s.kind, s.data, s.tune, d]);
    if (m._sig === sig) continue;
    m._sig = sig;
    paintMini(m, s, state.current, d, { kind, width: 112 });
  }
  const hidden = hiddenFields(s);
  el.hiddenNote.hidden = !hidden.length;
  if (hidden.length) el.hiddenNote.textContent = `Скрыто в этой раскладке: ${hidden.join(', ')}. Текст сохранён — вернётся при смене раскладки.`;
}

function switchKind(kind) {
  const s = currentSlide();
  if (!s || s.kind === kind) return;
  pushUndo();
  s.data = convertData(s.data, s.kind, kind);
  s.kind = kind;
  buildSlidesList();
  buildForm();
  buildLayouts();
  changed({ noLayouts: true });
}

/* ------------------------------------------------- оформление презентации */

function buildDeckBox() {
  const d = deck();
  const box = el.deckBox;
  box.innerHTML = '';
  const head = h('button', 'box-toggle');
  head.type = 'button';
  const open = Boolean(state.deckOpen);
  const summary = [d.header ? `«${d.header}»` : 'шапка пустая', d.numbers === false ? 'без номеров' : 'номера', d.client && d.client.url ? 'лого клиента' : null].filter(Boolean).join(' · ');
  head.innerHTML = `<span class="eyebrow">Презентация</span><span class="muted small ellipsis">${esc(summary)}</span>${iconSvg(open ? 'caret-up' : 'caret-down')}`;
  head.addEventListener('click', () => { state.deckOpen = !state.deckOpen; buildDeckBox(); });
  box.appendChild(head);
  if (!open) return;
  const body = h('div', 'box-body');

  const f1 = fieldWrap('Надпись в шапке слайдов', 'deck-header');
  const inp = h('input');
  inp.type = 'text';
  inp.id = 'deck-header';
  inp.value = d.header || '';
  inp.placeholder = 'Например, EXECUTIVE VISIBILITY';
  inp.addEventListener('input', () => { pushUndo('deck-header'); d.header = inp.value; deckChanged(); });
  f1.appendChild(inp);
  addHint(f1, 'Набирается капсом автоматически. Это и номер слайда — единственное, что конструктор добавляет от себя.');
  body.appendChild(f1);

  const f2 = h('label', 'toggle');
  const cb = h('input');
  cb.type = 'checkbox';
  cb.checked = d.numbers !== false;
  cb.addEventListener('change', () => { pushUndo(); d.numbers = cb.checked; deckChanged(); });
  f2.append(cb, h('span', '', 'Номера слайдов в шапке'));
  body.appendChild(f2);

  const f3 = fieldWrap('Логотип клиента — на обложке и в контактах');
  const row = h('div', 'logo-row');
  if (d.client && d.client.url) {
    const img = h('img', 'client-prev');
    img.src = d.client.url;
    img.alt = '';
    const rm = h('button', 'btn btn-ghost btn-sm', 'Убрать');
    rm.type = 'button';
    rm.addEventListener('click', () => { pushUndo(); d.client = null; deckChanged(); buildDeckBox(); });
    row.append(img, rm);
  }
  const up = h('button', 'btn btn-outline btn-sm');
  up.type = 'button';
  up.innerHTML = `${iconSvg('upload-simple')}${d.client && d.client.url ? 'Заменить' : 'Загрузить'}`;
  up.addEventListener('click', () => el.logoInput.click());
  row.appendChild(up);
  f3.appendChild(row);
  if (d.client && d.client.url) {
    const t = h('label', 'toggle');
    const mc = h('input');
    mc.type = 'checkbox';
    mc.checked = Boolean(d.client.mono);
    mc.addEventListener('change', () => { pushUndo(); d.client.mono = mc.checked; deckChanged(); });
    t.append(mc, h('span', '', 'В монохроме (чёрный)'));
    f3.appendChild(t);
  } else addHint(f3, 'PNG или SVG на прозрачном фоне. Встанет рядом с логотипом WE Media через тонкий разделитель.');
  body.appendChild(f3);
  box.appendChild(body);
}

function deckChanged() {
  fitCache.clear();
  for (const t of el.slidesList.querySelectorAll('.thumb')) t._sig = null;
  changed();
  const d = deck();
  const sum = el.deckBox.querySelector('.box-toggle .muted');
  if (sum) sum.textContent = [d.header ? `«${d.header}»` : 'шапка пустая', d.numbers === false ? 'без номеров' : 'номера', d.client && d.client.url ? 'лого клиента' : null].filter(Boolean).join(' · ');
}

function logoFileToUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const url = reader.result;
      if (file.type === 'image/svg+xml') { resolve(url); return; }
      const img = new Image();
      img.onload = () => {
        const max = 800;
        const k = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * k);
        c.height = Math.round(img.height * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL('image/png'));
      };
      img.onerror = reject;
      img.src = url;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/* ================================================================== форма */

const FIELD_HINTS = {
  title: '*Звёздочки* вокруг слова — синий акцент.',
  lead: 'Пустая строка — новый абзац.',
};

function slideIsEmpty(s) { return !slideStrings(s).length; }

/* Пустой слайд: вставьте кусок текста — он разложится по полям этого слайда. */
function fillBox(s) {
  const wrap = h('div', 'fill-box');
  wrap.appendChild(h('p', 'label', 'Есть текст для этого слайда?'));
  const ta = h('textarea');
  ta.rows = 4;
  ta.placeholder = 'Вставьте его сюда целиком: заголовок, абзац, список — разложим по полям сами';
  wrap.appendChild(ta);
  const apply = () => {
    const data = slideFromText(s.kind, ta.value);
    if (!data) return;
    pushUndo();
    Object.assign(s.data, data);
    buildForm();
    buildLayouts();
    changed();
    say('Текст разложен по полям слайда');
  };
  richPaste(ta, () => setTimeout(apply, 0));
  ta.addEventListener('paste', e => {
    if (e.clipboardData && e.clipboardData.getData('text/html')) return;
    setTimeout(apply, 0);
  });
  ta.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); apply(); } });
  ta.addEventListener('change', apply);
  return wrap;
}

function buildForm() {
  const s = currentSlide();
  el.form.innerHTML = '';
  if (!s) return;
  if (slideIsEmpty(s)) el.form.appendChild(fillBox(s));
  const k = KINDS[s.kind];
  for (const [key, label] of k.fields) {
    const node = fieldNode(s, key, label);
    if (node) el.form.appendChild(node);
  }
}

function fieldWrap(label, forId) {
  const wrap = h('div', 'field');
  const l = h('label', 'label', label);
  if (forId) l.htmlFor = forId;
  wrap.appendChild(l);
  return wrap;
}
function addHint(wrap, text) { wrap.appendChild(h('p', 'hint', text)); }

function autoGrow(ta) {
  ta.style.height = 'auto';
  ta.style.height = `${ta.scrollHeight + 2}px`;
}

function textInput(value, multiline, onValue, opts = {}) {
  const node = h(multiline ? 'textarea' : 'input');
  if (!multiline) node.type = 'text';
  else node.rows = opts.rows || 2;
  node.value = value || '';
  node.spellcheck = true;
  node.lang = 'ru';
  if (opts.placeholder) node.placeholder = opts.placeholder;
  if (opts.key) node.dataset.key = opts.key;
  node.addEventListener('input', () => {
    onValue(node.value);
    if (multiline) autoGrow(node);
  });
  if (multiline) requestAnimationFrame(() => autoGrow(node));
  return node;
}

function setField(key, value) {
  const s = currentSlide();
  pushUndo(`${s.id}:${key}`);
  s.data[key] = value;
  changed();
}

const PLACEHOLDERS = {
  cover: { note: 'Коммерческое предложение', title: 'Название предложения', lead: 'Суть предложения в одной-двух строках' },
  package: { title: 'BASE: название пакета', lead: 'Для кого этот пакет', label: 'Всё из BASE, плюс:', price: '800 000 ₸ / месяц' },
  summary: { big: '12' },
};

function fieldNode(s, key, label) {
  const ph = (PLACEHOLDERS[s.kind] || {})[key] || '';
  switch (key) {
    case 'title': case 'lead': case 'note': case 'label': case 'price': case 'big': {
      const wrap = fieldWrap(label, `f-${key}`);
      const multi = key === 'title' || key === 'lead' || key === 'note';
      const inp = textInput(s.data[key], multi, v => setField(key, v), { rows: key === 'lead' ? 3 : 1, placeholder: ph, key });
      inp.id = `f-${key}`;
      if (key === 'title') inp.classList.add('big');
      wrap.appendChild(inp);
      if (FIELD_HINTS[key] && (key !== 'lead' || ['text', 'thesis', 'cover', 'summary'].includes(s.kind))) addHint(wrap, FIELD_HINTS[key]);
      if (key === 'title' && s.kind === 'package') addHint(wrap, 'Часть до двоеточия («BASE:») станет синей сама.');
      if (key === 'big') addHint(wrap, 'Огромная полупрозрачная цифра справа, например срок программы. Пусто — без цифры.');
      return wrap;
    }
    case 'level': {
      const wrap = fieldWrap(label);
      const seg = h('div', 'seg level-seg');
      [1, 2, 3].forEach(n => {
        const b = h('button', Number(s.data.level) === n ? 'on' : '');
        b.type = 'button';
        b.innerHTML = `<span class="lvl-sq">${[1, 2, 3].map(i => `<i class="${i <= n ? 'f' : ''}"></i>`).join('')}</span>${['Первый', 'Второй', 'Третий'][n - 1]}`;
        b.addEventListener('click', () => { pushUndo(); s.data.level = n; buildForm(); changed(); });
        seg.appendChild(b);
      });
      wrap.appendChild(seg);
      return wrap;
    }
    case 'items': return itemsField(s, label);
    case 'rows': return rowsField(s, label);
    case 'table': return tableField(s, label);
    default: return null;
  }
}

/* ------------------------------------------------------------- пункты */

function linesToItems(text) {
  return String(text).split(/\n+/).map(l => l.replace(/^\s*([-–—•●▪◦·*✓✔►▸➤→]|\d{1,2}[.)])\s+/, '').trim()).filter(Boolean)
    .map(l => itemFrom(l));
}

function itemsField(s, label) {
  const wrap = fieldWrap(label);
  wrap.dataset.key = 'items';
  wrap.classList.add('items-field');
  const items = s.data.items;
  if (!items.length) {
    const ta = h('textarea', 'bulk');
    ta.rows = 3;
    ta.dataset.key = 'items';
    ta.placeholder = 'Каждый пункт — с новой строки. «Название — описание» станет заголовком и текстом пункта';
    const apply = () => {
      const add = linesToItems(ta.value);
      if (!add.length) return;
      pushUndo();
      s.data.items = add;
      buildForm();
      changed();
      requestAnimationFrame(() => {
        const n = el.form.querySelector(`[data-key="items.${add.length - 1}.text"]`);
        if (n) { n.focus(); n.setSelectionRange(n.value.length, n.value.length); }
      });
    };
    ta.addEventListener('paste', () => setTimeout(apply, 0));
    ta.addEventListener('change', apply);
    ta.addEventListener('keydown', e => {
      // Enter после первой строки — переходим к обычному списку
      if (e.key === 'Enter' && !e.shiftKey && ta.value.trim()) { e.preventDefault(); apply(); }
    });
    wrap.appendChild(ta);
    addHint(wrap, 'Вставьте список целиком или напишите первый пункт и нажмите Enter.');
    return wrap;
  }
  const list = h('div', 'items');
  const titleLabel = { contacts: 'Подпись (Телефон, Почта…)', stages: 'Название этапа' }[s.kind] || 'Заголовок пункта — по желанию';
  items.forEach((it, i) => {
    const row = h('div', 'item-row');
    const num = h('span', 'item-num', pad2(i + 1));
    const fields = h('div', 'item-fields');
    const t = textInput(it.title, false, v => { pushUndo(`${s.id}:items.${i}.title`); it.title = v; changed(); }, { placeholder: titleLabel, key: `items.${i}.title` });
    const d = textInput(it.text, true, v => { pushUndo(`${s.id}:items.${i}.text`); it.text = v; changed(); }, { rows: 1, placeholder: 'Текст пункта', key: `items.${i}.text` });
    for (const inp of [t, d]) {
      // вставка нескольких строк в пустой пункт — сразу несколько пунктов
      inp.addEventListener('paste', e => {
        const text = e.clipboardData && e.clipboardData.getData('text/plain');
        if (!text || !/\n\s*\S/.test(text.trim())) return;
        if (it.title.trim() || it.text.trim()) return;
        e.preventDefault();
        const add = linesToItems(text);
        if (!add.length) return;
        pushUndo();
        items.splice(i, 1, ...add);
        buildForm();
        changed();
        say(`Добавлено пунктов: ${add.length}`);
      });
      inp.addEventListener('keydown', e => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); addItemAfter(i); }
      });
    }
    fields.append(t, d);
    const tools = h('div', 'item-tools');
    const bUp = btn('arrow-up', 'Выше');
    const bDown = btn('arrow-down', 'Ниже');
    const bDel = btn('x', 'Удалить пункт');
    bUp.disabled = i === 0;
    bDown.disabled = i === items.length - 1;
    bUp.addEventListener('click', () => moveItem(i, i - 1));
    bDown.addEventListener('click', () => moveItem(i, i + 1));
    bDel.addEventListener('click', () => { pushUndo(); items.splice(i, 1); buildForm(); changed(); });
    tools.append(bUp, bDown, bDel);
    row.append(num, fields, tools);
    list.appendChild(row);
  });
  wrap.appendChild(list);
  const add = h('button', 'btn btn-ghost btn-sm add-row');
  add.type = 'button';
  add.innerHTML = `${iconSvg('plus')}Пункт`;
  add.addEventListener('click', () => addItemAfter(items.length - 1));
  wrap.appendChild(add);
  addHint(wrap, 'Вставьте несколько строк в пустой пункт — получится список. «Название — описание» делится на заголовок и текст. ⌘Enter — новый пункт.');
  return wrap;

  function moveItem(from, to) {
    if (to < 0 || to >= items.length) return;
    pushUndo();
    const [x] = items.splice(from, 1);
    items.splice(to, 0, x);
    buildForm();
    changed();
  }
  function addItemAfter(i) {
    pushUndo();
    items.splice(i + 1, 0, { title: '', text: '' });
    buildForm();
    changed();
    requestAnimationFrame(() => {
      const n = el.form.querySelector(`[data-key="items.${i + 1}.text"]`);
      if (n) n.focus();
    });
  }
}

/* ------------------------------------------------------ строки стоимости */

const ROW_STYLES = [['plain', 'Без фона'], ['vivid', 'Синяя'], ['blue', 'Голубая'], ['gray', 'Серая']];

function rowsField(s, label) {
  const wrap = fieldWrap(label);
  wrap.dataset.key = 'rows';
  const rows = s.data.rows;
  rows.forEach((r, i) => {
    const box = h('div', 'prow-ed');
    const top = h('div', 'pr-top');
    const mk = (key, ph, multi = false) => textInput(r[key], multi, v => { pushUndo(`${s.id}:rows.${i}.${key}`); r[key] = v; changed(); }, { placeholder: ph, key: `rows.${i}.${key}` });
    top.append(mk('label', 'Подпись: «Оплата за год»'), mk('value', 'Сумма'));
    const mid = h('div', 'pr-mid');
    mid.append(mk('note', 'Пояснение — по желанию'), mk('badge', 'Скидка: −20%'));
    const bottom = h('div', 'pr-bottom');
    bottom.appendChild(mk('save', 'Плашка: «Экономия 360 000 ₸»'));
    const sw = h('div', 'swatches');
    for (const [st, name] of ROW_STYLES) {
      const b = h('button', `sw sw-${st}${r.style === st ? ' on' : ''}`);
      b.type = 'button';
      b.title = name;
      b.setAttribute('aria-label', name);
      b.addEventListener('click', () => { pushUndo(); r.style = st; buildForm(); changed(); });
      sw.appendChild(b);
    }
    const tools = h('div', 'item-tools row');
    const bUp = btn('arrow-up', 'Выше'), bDown = btn('arrow-down', 'Ниже'), bDel = btn('x', 'Удалить строку');
    bUp.disabled = i === 0;
    bDown.disabled = i === rows.length - 1;
    bUp.addEventListener('click', () => { pushUndo(); rows.splice(i - 1, 0, rows.splice(i, 1)[0]); buildForm(); changed(); });
    bDown.addEventListener('click', () => { pushUndo(); rows.splice(i + 1, 0, rows.splice(i, 1)[0]); buildForm(); changed(); });
    bDel.addEventListener('click', () => { pushUndo(); rows.splice(i, 1); buildForm(); changed(); });
    tools.append(bUp, bDown, bDel);
    bottom.append(sw, tools);
    box.append(top, mid, bottom);
    wrap.appendChild(box);
  });
  const add = h('button', 'btn btn-ghost btn-sm add-row');
  add.type = 'button';
  add.innerHTML = `${iconSvg('plus')}Строка`;
  add.addEventListener('click', () => {
    pushUndo();
    rows.push(Object.assign(emptyRow(), { style: rows.length ? ['vivid', 'blue', 'gray'][(rows.length - 1) % 3] : 'plain' }));
    buildForm();
    changed();
  });
  wrap.appendChild(add);
  addHint(wrap, 'Полоса «за год» — синяя, остальные — голубая и серая. Скидка набирается крупно, «Экономия» — плашкой.');
  return wrap;
}

/* --------------------------------------------------------- таблица пакетов */

function tableField(s, label) {
  const t = s.data.table;
  const wrap = fieldWrap(label);
  wrap.dataset.key = 'table';
  const box = h('div', 'tbl-ed');
  const n = t.cols.length;
  box.style.setProperty('--n', n);
  const mk = (val, ph, onv, key) => textInput(val, false, v => { pushUndo(`${s.id}:table.${key}`); onv(v); changed(); }, { placeholder: ph, key: `table.${key}` });

  // строка названий пакетов и цен
  const head = h('div', 'tr head');
  head.appendChild(mk(t.corner, 'Над строками', v => { t.corner = v; }, 'corner'));
  t.cols.forEach((c, j) => {
    const cell = h('div', 'th');
    cell.appendChild(mk(c.name, `Пакет ${j + 1}`, v => { c.name = v; }, `cols.${j}.name`));
    const del = btn('x', 'Убрать колонку');
    del.addEventListener('click', () => { pushUndo(); t.cols.splice(j, 1); t.rows.forEach(r => (r.cells || []).splice(j, 1)); buildForm(); changed(); });
    cell.appendChild(del);
    head.appendChild(cell);
  });
  box.appendChild(head);
  t.rows.forEach((r, i) => {
    const tr = h('div', 'tr');
    tr.appendChild(mk(r.name, 'Строка', v => { r.name = v; }, `rows.${i}.name`));
    t.cols.forEach((c, j) => {
      r.cells = r.cells || [];
      const inp = mk(r.cells[j] || '', '—', v => { r.cells[j] = v; }, `rows.${i}.cells.${j}`);
      inp.classList.add('cell-in');
      tr.appendChild(inp);
    });
    const del = btn('x', 'Удалить строку');
    del.addEventListener('click', () => { pushUndo(); t.rows.splice(i, 1); buildForm(); changed(); });
    tr.appendChild(del);
    box.appendChild(tr);
  });
  const price = h('div', 'tr price');
  price.appendChild(mk(t.priceLabel, 'Подпись цен', v => { t.priceLabel = v; }, 'priceLabel'));
  t.cols.forEach((c, j) => price.appendChild(mk(c.price, 'Цена', v => { c.price = v; }, `cols.${j}.price`)));
  box.appendChild(price);
  // вставка таблицы из Excel / Google Таблиц в любую ячейку
  box.addEventListener('paste', e => {
    const text = e.clipboardData && e.clipboardData.getData('text/plain');
    if (!text || !text.includes('\t')) return;
    e.preventDefault();
    const rows = text.replace(/\r/g, '').split('\n').filter(l => l.trim()).map(l => l.split('\t').map(c => c.trim()));
    if (rows.length < 2) return;
    pushUndo();
    s.data.table = tableData(rows);
    buildForm();
    changed();
    say('Таблица вставлена');
  });
  wrap.appendChild(box);
  const actions = h('div', 'row-actions');
  const addRow = h('button', 'btn btn-ghost btn-sm');
  addRow.type = 'button';
  addRow.innerHTML = `${iconSvg('plus')}Строка`;
  addRow.addEventListener('click', () => { pushUndo(); t.rows.push({ name: '', cells: [] }); buildForm(); changed(); });
  const addCol = h('button', 'btn btn-ghost btn-sm');
  addCol.type = 'button';
  addCol.innerHTML = `${iconSvg('plus')}Пакет`;
  addCol.disabled = t.cols.length >= 4;
  addCol.addEventListener('click', () => { pushUndo(); t.cols.push({ name: '', price: '' }); buildForm(); changed(); });
  actions.append(addRow, addCol);
  wrap.appendChild(actions);
  addHint(wrap, 'В ячейке: «+» или «✓» — синяя галочка, «—» или пусто — прочерк, любой другой текст — как есть. Таблицу из Excel или Google Таблиц можно вставить целиком в любую ячейку.');
  return wrap;
}

/* ===================================================== вставка текста в редакторе */

function openImport() {
  el.importModal.hidden = false;
  el.importText.value = '';
  updateImportPreview.flush();
  el.importText.focus();
}
const updateImportPreview = debounce(() => {
  const r = parsed(el.importText.value);
  el.importReplace.disabled = !r;
  el.importAppend.disabled = !r;
  el.importCount.textContent = r ? slideCountText(r.slides.length) : '';
  if (r) paintOutline(el.importGrid, r.slides, Object.assign({}, deck(), { header: deck().header || r.deck.header }));
  else el.importGrid.innerHTML = '<p class="muted small">Здесь появятся слайды.</p>';
}, 250);

function doImport(mode) {
  const r = parsed(el.importText.value);
  if (!r) return;
  pushUndo();
  const d = state.draft;
  const fresh = r.slides.map(s => normalizeSlide(Object.assign({}, s, { id: uid() })));
  if (mode === 'replace') {
    d.slides = fresh;
    d.source = el.importText.value;
    state.current = 0;
    const autoNames = ['Коммерческое предложение', ...STRUCTURES.map(st => st.name)];
    const cover = (fresh[0].data.title || '').replace(/\*/g, '').split('\n')[0].slice(0, 80);
    if (cover && autoNames.includes(d.name)) { d.name = cover; el.docName.value = cover; }
  } else {
    d.slides.push(...fresh);
    d.source = [d.source, el.importText.value].filter(Boolean).join('\n\n');
    state.current = d.slides.length - fresh.length;
  }
  if (!d.deck.header && r.deck.header) d.deck.header = r.deck.header;
  el.importModal.hidden = true;
  buildDeckBox();
  buildSlidesList();
  buildForm();
  buildLayouts();
  changed();
  say(mode === 'replace' ? `Слайды пересобраны: ${slideCountText(fresh.length)}` : `Добавлено: ${slideCountText(fresh.length)}`);
}

/* ======================================================== сверка с исходником */

const scheduleCheck = debounce(() => updateCheck(), 700);
function updateCheck() {
  const d = state.draft;
  if (!d || !d.source || !d.source.trim()) { el.btnCheck.hidden = true; state.check = null; return; }
  const cov = coverage(d.source, d.slides);
  state.check = cov;
  el.btnCheck.hidden = false;
  el.btnCheck.classList.toggle('ok', cov.missing === 0);
  el.btnCheck.classList.toggle('warn', cov.missing > 0);
  el.btnCheck.innerHTML = cov.missing === 0
    ? `${iconSvg('check-circle')}<span class="hide-sm">Текст сверен</span>`
    : `${iconSvg('warning')}<span>${cov.missing} ${plural(cov.missing, 'слово', 'слова', 'слов')}<span class="hide-sm"> не на слайдах</span></span>`;
  el.btnCheck.title = cov.missing === 0 ? 'Все слова исходного текста есть на слайдах' : 'Часть исходного текста не попала на слайды — нажмите, чтобы посмотреть';
  if (!el.checkModal.hidden) paintCheck();
}
function paintCheck() {
  const cov = state.check;
  if (!cov) return;
  el.checkSummary.textContent = cov.missing === 0
    ? `Все ${cov.total} ${plural(cov.total, 'слово', 'слова', 'слов')} исходного текста есть на слайдах.`
    : `Из ${cov.total} ${plural(cov.total, 'слова', 'слов', 'слов')} исходного текста на слайдах нет ${cov.missing}. Так бывает, если текст удалили или он спрятан сменой раскладки.`;
  el.checkList.innerHTML = '';
  for (const line of cov.lines.slice(0, 80)) {
    const p = h('p', 'check-line');
    const miss = new Map();
    for (const w of line.miss) miss.set(w, (miss.get(w) || 0) + 1);
    p.innerHTML = line.text.replace(/[\p{L}\p{N}]+/gu, w => {
      const key = w.toLowerCase().replace(/ё/g, 'е');
      const c = miss.get(key);
      if (c) { miss.set(key, c - 1); return `<mark>${esc(w)}</mark>`; }
      return esc(w);
    });
    el.checkList.appendChild(p);
  }
}

/* =================================================================== отмена */

const undoStack = [];
const redoStack = [];
let lastUndoTag = null;
let lastUndoAt = 0;

function snapshot() {
  return { slides: clone(state.draft.slides), deck: clone(state.draft.deck), current: state.current, name: state.draft.name };
}
function pushUndo(tag = null) {
  if (!state.draft) return;
  const now = Date.now();
  if (tag && tag === lastUndoTag && now - lastUndoAt < UNDO_COALESCE_MS) { lastUndoAt = now; return; }
  lastUndoTag = tag;
  lastUndoAt = now;
  undoStack.push(snapshot());
  if (undoStack.length > UNDO_LIMIT) undoStack.shift();
  redoStack.length = 0;
  syncUndoButtons();
}
function restore(snap) {
  state.draft.slides = snap.slides;
  state.draft.deck = snap.deck;
  state.draft.name = snap.name;
  state.current = clamp(snap.current, 0, snap.slides.length - 1);
  el.docName.value = snap.name;
  lastUndoTag = null;
  fitCache.clear();
  buildDeckBox();
  buildSlidesList();
  buildForm();
  buildLayouts();
  changed();
  syncUndoButtons();
}
function undo() { if (!undoStack.length) return; redoStack.push(snapshot()); restore(undoStack.pop()); }
function redo() { if (!redoStack.length) return; undoStack.push(snapshot()); restore(redoStack.pop()); }
function syncUndoButtons() {
  el.btnUndo.disabled = !undoStack.length;
  el.btnRedo.disabled = !redoStack.length;
}

/* ===================================================================== показ */

function openPresent(from = state.current) {
  state.presentIndex = from;
  el.present.hidden = false;
  paintPresent();
  const req = el.present.requestFullscreen || el.present.webkitRequestFullscreen;
  if (req) { try { const p = req.call(el.present); if (p && p.catch) p.catch(() => {}); } catch { /* без полноэкранного режима */ } }
}
function paintPresent() {
  const d = state.draft;
  const i = clamp(state.presentIndex, 0, d.slides.length - 1);
  state.presentIndex = i;
  const s = d.slides[i];
  const scale = Math.min(window.innerWidth / W, window.innerHeight / H);
  el.presentSlide.style.transform = `translate(-50%, -50%) scale(${scale})`;
  el.presentSlide.innerHTML = slideHtml(s, i, d.deck, fitSlide(s, d.deck).k, false);
  el.presentCounter.textContent = `${i + 1} / ${d.slides.length}`;
}
function closePresent() {
  el.present.hidden = true;
  if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
  selectSlide(state.presentIndex);
}

/* ==================================================================== экспорт */

function exportBaseName() { return slug(state.draft.name); }

function downloadBlob(blob, name) {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 10000);
}

/* PDF: печать браузера. Все слайды кладутся в #printRoot, страница 1920×1080. */
function preparePrint() {
  if (!state.draft) return false;
  const d = state.draft;
  el.printRoot.innerHTML = d.slides.map((s, i) => slideHtml(s, i, d.deck, fitSlide(s, d.deck).k, false)).join('');
  state.titleBeforePrint = document.title;
  document.title = d.name || 'КП WE Media';
  return true;
}
function cleanupPrint() {
  el.printRoot.innerHTML = '';
  if (state.titleBeforePrint) document.title = state.titleBeforePrint;
  state.titleBeforePrint = null;
}
async function exportPdf() {
  closePops();
  if (!preparePrint()) return;
  if (document.fonts && document.fonts.ready) await document.fonts.ready;
  say('В окне печати выберите «Сохранить как PDF» — имя файла уже подставлено', 6000);
  setTimeout(() => window.print(), 60);
}

/* PNG: слайд → SVG с foreignObject (шрифты и стили внутри) → canvas. */
let exportCss = null;
function exportStyles() {
  if (!exportCss) exportCss = el.fontsCss.textContent + '\n' + el.slidesCss.textContent;
  return exportCss;
}
function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}
async function slideCanvas(s, i, scale = 1) {
  const d = state.draft;
  const holder = document.createElement('div');
  holder.innerHTML = slideHtml(s, i, d.deck, fitSlide(s, d.deck).k, false);
  const xhtml = new XMLSerializer().serializeToString(holder.firstElementChild);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W * scale}" height="${H * scale}" viewBox="0 0 ${W} ${H}">`
    + `<foreignObject x="0" y="0" width="${W}" height="${H}"><div xmlns="http://www.w3.org/1999/xhtml" style="width:${W}px;height:${H}px">`
    + `<style><![CDATA[${exportStyles()}]]></style>${xhtml}</div></foreignObject></svg>`;
  const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  const img = await loadImage(url);
  if (img.decode) { try { await img.decode(); } catch { /* уже декодировано */ } }
  // шрифты внутри SVG иногда догружаются после первого кадра — рисуем повторно
  await new Promise(r => setTimeout(r, 120));
  const c = document.createElement('canvas');
  c.width = W * scale;
  c.height = H * scale;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return c;
}
function canvasBlob(c) { return new Promise(resolve => c.toBlob(resolve, 'image/png')); }

let exporting = false;
async function exportPng(mode) {
  if (exporting) return;
  exporting = true;
  const d = state.draft;
  const list = mode === 'one' ? [state.current] : d.slides.map((_, i) => i);
  el.exportProgress.hidden = false;
  try {
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
    const files = [];
    for (let n = 0; n < list.length; n++) {
      const i = list[n];
      el.exportProgressBar.style.width = `${Math.round((n / list.length) * 100)}%`;
      const c = await slideCanvas(d.slides[i], i, 1);
      const blob = await canvasBlob(c);
      const name = `${exportBaseName()}-${pad2(i + 1)}.png`;
      if (mode === 'one') { downloadBlob(blob, name); break; }
      files.push({ name, data: new Uint8Array(await blob.arrayBuffer()) });
    }
    if (mode !== 'one') downloadBlob(new Blob([buildZip(files)], { type: 'application/zip' }), `${exportBaseName()}.zip`);
    el.exportProgressBar.style.width = '100%';
    say(mode === 'one' ? 'Слайд сохранён' : `Готово: ${slideCountText(files.length)} в ZIP`);
  } catch (err) {
    console.error(err);
    say('Не получилось сохранить картинки в этом браузере — попробуйте Chrome или скачайте PDF');
  } finally {
    exporting = false;
    setTimeout(() => { el.exportProgress.hidden = true; el.exportProgressBar.style.width = '0'; }, 600);
    closePops();
  }
}

/* HTML: один файл с презентацией — открывается в любом браузере, листается стрелками. */
function exportHtml() {
  const d = state.draft;
  const slides = d.slides.map((s, i) => `<section class="pg">${slideHtml(s, i, d.deck, fitSlide(s, d.deck).k, false)}</section>`).join('\n');
  const html = `<!DOCTYPE html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(d.name)}</title>
<style>${exportStyles()}
html,body{margin:0;background:#E9EDF5}
.deck{display:flex;flex-direction:column;align-items:center;gap:24px;padding:24px 0}
.pg{position:relative;overflow:hidden;box-shadow:0 10px 40px rgba(10,10,11,.12)}
.pg>.sl{position:absolute;left:0;top:0;transform-origin:0 0}
body.show{background:#000;overflow:hidden}
body.show .deck{padding:0;gap:0;height:100vh;justify-content:center}
body.show .pg{display:none;box-shadow:none}
body.show .pg.cur{display:block}
.hint{position:fixed;right:16px;bottom:12px;font:500 13px/1.3 WEInter,Arial,sans-serif;color:#6B6B70;background:rgba(255,255,255,.9);padding:8px 12px}
body.show .hint{display:none}
@page{size:1920px 1080px;margin:0}
@media print{html,body{background:#fff}.deck{display:block;padding:0}.pg{width:1920px!important;height:1080px!important;box-shadow:none;break-after:page;page-break-after:always}.pg>.sl{transform:none!important}.hint{display:none}}
</style></head><body>
<div class="deck">${slides}</div>
<div class="hint">F — показ на весь экран · ← → — листать · Esc — выход</div>
<script>
(function(){var pgs=[].slice.call(document.querySelectorAll('.pg')),cur=0,show=false;
function fit(){var w=show?innerWidth:Math.min(innerWidth-32,1600),hh=show?innerHeight:1e9,k=Math.min(w/1920,hh/1080);
pgs.forEach(function(p,i){p.style.width=1920*k+'px';p.style.height=1080*k+'px';p.firstElementChild.style.transform='scale('+k+')';p.classList.toggle('cur',i===cur)});}
function go(i){cur=Math.max(0,Math.min(pgs.length-1,i));fit();}
function toggle(on){show=on;document.body.classList.toggle('show',on);if(on&&document.documentElement.requestFullscreen)document.documentElement.requestFullscreen().catch(function(){});if(!on&&document.fullscreenElement)document.exitFullscreen();fit();}
addEventListener('resize',fit);
addEventListener('keydown',function(e){if(e.key==='f'||e.key==='F'||e.key==='F5'){e.preventDefault();toggle(!show);}
else if(e.key==='Escape')toggle(false);else if(show&&(e.key==='ArrowRight'||e.key===' '||e.key==='PageDown'))go(cur+1);
else if(show&&(e.key==='ArrowLeft'||e.key==='PageUp'))go(cur-1);});
pgs.forEach(function(p,i){p.addEventListener('click',function(){if(!show){cur=i;toggle(true);}else go(cur+1);});});
document.addEventListener('fullscreenchange',function(){if(!document.fullscreenElement&&show)toggle(false);});
fit();})();
<\/script></body></html>`;
  downloadBlob(new Blob([html], { type: 'text/html' }), `${exportBaseName()}.html`);
  closePops();
  say('HTML сохранён: откройте в браузере, F — показ на весь экран');
}

/* ZIP без сжатия (store) — PNG и так сжаты. Перенесено из edubridge. */
function crc32(bytes) {
  if (!crc32.table) {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      table[n] = c >>> 0;
    }
    crc32.table = table;
  }
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) crc = crc32.table[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}
function buildZip(files) {
  const parts = [];
  const central = [];
  let offset = 0;
  const now = new Date();
  const time = ((now.getHours() & 0x1f) << 11) | ((now.getMinutes() & 0x3f) << 5) | ((now.getSeconds() >> 1) & 0x1f);
  const date = (((now.getFullYear() - 1980) & 0x7f) << 9) | (((now.getMonth() + 1) & 0xf) << 5) | (now.getDate() & 0x1f);
  for (const file of files) {
    const nameBytes = new TextEncoder().encode(file.name);
    const data = file.data;
    const crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true);
    local.setUint16(8, 0, true);
    local.setUint16(10, time, true);
    local.setUint16(12, date, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, nameBytes.length, true);
    local.setUint16(28, 0, true);
    parts.push(new Uint8Array(local.buffer), nameBytes, data);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true);
    ch.setUint16(4, 20, true);
    ch.setUint16(6, 20, true);
    ch.setUint16(8, 0x0800, true);
    ch.setUint16(10, 0, true);
    ch.setUint16(12, time, true);
    ch.setUint16(14, date, true);
    ch.setUint32(16, crc, true);
    ch.setUint32(20, data.length, true);
    ch.setUint32(24, data.length, true);
    ch.setUint16(28, nameBytes.length, true);
    ch.setUint32(42, offset, true);
    central.push(new Uint8Array(ch.buffer), nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const centralSize = central.reduce((s, c) => s + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  const all = parts.concat(central, [new Uint8Array(end.buffer)]);
  const out = new Uint8Array(all.reduce((s, c) => s + c.length, 0));
  let pos = 0;
  for (const chunk of all) { out.set(chunk, pos); pos += chunk.length; }
  return out;
}

/* =================================================================== справка */

const SYNTAX = `
<p>Обычно ничего размечать не нужно: копируйте текст из Word или Google Docs — заголовки и списки распознаются сами. Если хотите управлять разбивкой точно, используйте простые знаки:</p>
<table class="syntax">
<tr><td><code># Что мы делаем</code></td><td>новый слайд с этим заголовком</td></tr>
<tr><td><code>## Аудит</code></td><td>подзаголовок: пункт с заголовком, а в разделе «Пакеты» — отдельный пакет</td></tr>
<tr><td><code>- Колонки в СМИ</code> или <code>1. …</code></td><td>пункт списка</td></tr>
<tr><td><code>Аудит — изучаем медиа</code></td><td>пункт делится на заголовок и текст</td></tr>
<tr><td><code>| | BASE | PRO |</code></td><td>строка таблицы → слайд «Сравнение пакетов»</td></tr>
<tr><td><code>---</code></td><td>начать новый слайд без заголовка</td></tr>
<tr><td><code>*слово*</code></td><td>синий акцент в заголовке</td></tr>
</table>
<p>Раскладка выбирается по смыслу заголовка: «Проблема», «Зачем», «Что делаем», «Этапы», «Форматы», «Итог», «Пакеты», «Стоимость», «Контакты» — и по форме: сколько пунктов, есть ли у них описания, цены, таблица. Первая строка становится обложкой.</p>
<p>Текст не меняется: только раскладывается по местам. Кнопка «Текст сверен» сверху сравнивает слайды с исходником и показывает, если что-то потерялось.</p>`;

const HELP = `
<h3>1. Текст → слайды</h3>
<p>Вставьте текст КП на первом экране (из буфера одной кнопкой или ⌘V) или перетащите файл Word (.docx) — справа сразу видно, какие получатся слайды. «Собрать презентацию» — и всё готово. В редакторе кнопка «Текст» сверху пересобирает слайды или добавляет новые в конец.</p>
<h3>2. Правка</h3>
<ul>
<li>Слева — слайды: перетаскивайте, дублируйте, удаляйте. «+ Слайд» — любой из 13 типов.</li>
<li>Справа — поля слайда. Щёлкните по тексту на превью — курсор встанет в нужное поле.</li>
<li><b>Раскладка</b> — превью этого же слайда во всех вариантах. Один клик меняет вид, текст остаётся.</li>
<li>Текст подстраивается сам: если не влезает, кегль уменьшается (не меньше 24 px). Если и так тесно — кнопка «Разбить на 2 слайда».</li>
<li>Кнопка <b>Aa</b> под превью делает текст на слайде мельче, если хочется больше воздуха.</li>
<li>Вставьте несколько строк в пустой пункт — получится список.</li>
<li>В пустой слайд можно вставить его кусок текста целиком — заголовок, абзац и пункты разложатся по полям сами.</li>
</ul>
<h3>3. Оформление</h3>
<p>Блок «Презентация» справа: надпись в шапке, номера слайдов, логотип клиента. Цвета, шрифты и графика — строго по стилю WE Media, их менять не нужно.</p>
<h3>4. Экспорт</h3>
<p><b>Скачать PDF</b> — откроется окно печати: выберите «Сохранить как PDF». Слайды 1920×1080, текст остаётся текстом (лучше всего в Chrome, Edge или Яндекс Браузере). В меню рядом: PNG всех слайдов в ZIP, PNG текущего слайда и HTML-файл для показа. <b>▶</b> — показ на весь экран прямо отсюда.</p>
<h3>Горячие клавиши</h3>
<p>⌘Z / ⌘⇧Z — отменить / повторить, ⌘P — PDF, F5 — показ, PageUp / PageDown — соседний слайд, Esc — закрыть окно.</p>
<p class="muted">Черновики сохраняются в этом браузере автоматически. Работает без интернета, если открыть с сайта хотя бы раз.</p>`;

function openModal(m) { m.hidden = false; }

/* =================================================================== события */

function collectElements() { for (const node of document.querySelectorAll('[id]')) el[node.id] = node; }

function closePops() {
  el.exportPop.hidden = true;
  el.addPop.hidden = true;
}

function closeTopModal() {
  if (!el.present.hidden) { closePresent(); return true; }
  for (const m of [el.syntaxModal, el.helpModal, el.checkModal, el.importModal]) if (!m.hidden) { m.hidden = true; return true; }
  if (!el.tplModal.hidden) { closeStructure(); return true; }
  if (!el.exportPop.hidden || !el.addPop.hidden) { closePops(); return true; }
  return false;
}

function wireModal(modal, closeBtn) {
  closeBtn.addEventListener('click', () => { modal.hidden = true; });
  modal.addEventListener('click', e => { if (e.target === modal) modal.hidden = true; });
}

function wireEvents() {
  // стартовый экран
  richPaste(el.startText, () => updateStartPreview());
  el.startText.addEventListener('input', () => updateStartPreview());
  el.startText.addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); buildFromStart(); }
  });
  el.btnPasteClipboard.addEventListener('click', async () => {
    const text = await readClipboard();
    if (text && text.trim()) {
      el.startText.value = '';
      insertText(el.startText, text);
      updateStartPreview.flush();
    } else {
      el.startText.focus();
      say('Нажмите ⌘V (на Windows — Ctrl+V), чтобы вставить текст');
    }
  });
  el.btnBuild.addEventListener('click', buildFromStart);
  fileDrop(el.pasteBox, el.startText, () => updateStartPreview.flush());
  fileDrop(el.importText.parentElement, el.importText, () => updateImportPreview.flush());
  el.btnOpenFile.addEventListener('click', () => el.textFileInput.click());
  el.textFileInput.addEventListener('change', () => {
    const file = el.textFileInput.files[0];
    el.textFileInput.value = '';
    if (!file) return;
    const inModal = !el.importModal.hidden;
    loadTextFile(file, inModal ? el.importText : el.startText, inModal ? () => updateImportPreview.flush() : () => updateStartPreview.flush());
  });
  el.btnClearStart.addEventListener('click', () => { el.startText.value = ''; updateStartPreview.flush(); el.startText.focus(); });
  el.btnSyntax.addEventListener('click', () => openModal(el.syntaxModal));
  wireModal(el.syntaxModal, el.syntaxClose);
  el.btnHelpStart.addEventListener('click', () => openModal(el.helpModal));
  el.btnThemeStart.addEventListener('click', toggleTheme);
  wireModal(el.helpModal, el.helpClose);

  // окно структуры
  el.tplClose.addEventListener('click', closeStructure);
  el.tplModal.addEventListener('click', e => { if (e.target === el.tplModal) closeStructure(); });
  el.tplUse.addEventListener('click', () => startStructure('sample'));
  el.tplEmpty.addEventListener('click', () => startStructure('empty'));

  // редактор
  el.btnBack.addEventListener('click', () => closeEditor());
  el.btnUndo.addEventListener('click', undo);
  el.btnRedo.addEventListener('click', redo);
  el.btnTheme.addEventListener('click', toggleTheme);
  el.btnHelp.addEventListener('click', () => openModal(el.helpModal));
  el.btnPrev.addEventListener('click', () => selectSlide(state.current - 1));
  el.btnNext.addEventListener('click', () => selectSlide(state.current + 1));
  el.btnSmaller.addEventListener('click', () => {
    const s = currentSlide();
    pushUndo(`${s.id}:size`);
    s.tune.size = clamp((s.tune.size || 100) - SIZE_STEP, SIZE_MIN, SIZE_MAX);
    changed();
  });
  el.sizeVal.addEventListener('click', () => {
    const s = currentSlide();
    if ((s.tune.size || 100) === 100) return;
    pushUndo();
    s.tune.size = 100;
    changed();
  });
  el.docName.addEventListener('input', () => {
    pushUndo('name');
    state.draft.name = el.docName.value;
    document.title = `${state.draft.name || 'КП'} · КП WE Media`;
    scheduleSave();
  });
  el.docName.addEventListener('blur', () => {
    if (!el.docName.value.trim()) { el.docName.value = 'Коммерческое предложение'; state.draft.name = el.docName.value; scheduleSave(); }
  });
  el.btnAddSlide.addEventListener('click', e => {
    e.stopPropagation();
    if (el.addPop.hidden) openAddMenu(); else closePops();
  });
  el.btnPdf.addEventListener('click', exportPdf);
  el.btnExportMore.addEventListener('click', e => {
    e.stopPropagation();
    el.addPop.hidden = true;
    el.exportPop.hidden = !el.exportPop.hidden;
  });
  el.exportPop.addEventListener('click', e => {
    e.stopPropagation();
    const b = e.target.closest('[data-export]');
    if (!b) return;
    const kind = b.dataset.export;
    if (kind === 'pdf') exportPdf();
    else if (kind === 'zip') exportPng('all');
    else if (kind === 'png') exportPng('one');
    else if (kind === 'html') exportHtml();
  });
  el.addPop.addEventListener('click', e => e.stopPropagation());
  document.addEventListener('click', () => closePops());

  el.btnImport.addEventListener('click', openImport);
  richPaste(el.importText, () => updateImportPreview());
  el.importText.addEventListener('input', () => updateImportPreview());
  el.importCancel.addEventListener('click', () => { el.importModal.hidden = true; });
  wireModal(el.importModal, el.importClose);
  el.importReplace.addEventListener('click', () => doImport('replace'));
  el.importAppend.addEventListener('click', () => doImport('append'));

  el.btnCheck.addEventListener('click', () => { paintCheck(); openModal(el.checkModal); });
  wireModal(el.checkModal, el.checkClose);

  el.logoInput.addEventListener('change', async () => {
    const file = el.logoInput.files[0];
    el.logoInput.value = '';
    if (!file || !state.draft) return;
    try {
      const url = await logoFileToUrl(file);
      pushUndo();
      state.draft.deck.client = { url, mono: false };
      deckChanged();
      buildDeckBox();
      say('Логотип клиента добавлен на обложку и в контакты');
    } catch { say('Не удалось открыть картинку'); }
  });

  // сцена: клик по тексту → поле формы
  el.stageSlide.addEventListener('click', e => {
    const node = e.target.closest('[data-f]');
    if (node) focusField(node.dataset.f);
  });
  el.stage.addEventListener('dblclick', () => openPresent());

  // показ
  el.btnPresent.addEventListener('click', () => openPresent());
  el.presentClose.addEventListener('click', closePresent);
  el.present.addEventListener('click', e => {
    if (e.target.closest('.present-bar')) return;
    state.presentIndex += e.clientX < window.innerWidth / 3 ? -1 : 1;
    if (state.presentIndex >= state.draft.slides.length) { closePresent(); return; }
    paintPresent();
  });
  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement && !el.present.hidden) closePresent();
  });

  document.addEventListener('keydown', e => {
    const mod = e.metaKey || e.ctrlKey;
    if (!el.present.hidden) {
      if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'].includes(e.key)) { e.preventDefault(); state.presentIndex++; paintPresent(); }
      else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(e.key)) { e.preventDefault(); state.presentIndex--; paintPresent(); }
      else if (e.key === 'Home') { state.presentIndex = 0; paintPresent(); }
      else if (e.key === 'End') { state.presentIndex = state.draft.slides.length - 1; paintPresent(); }
      else if (e.key === 'Escape') { e.preventDefault(); closePresent(); }
      return;
    }
    if (e.key === 'Escape') { if (closeTopModal()) e.preventDefault(); return; }
    if (!el.tplModal.hidden) {
      const p = state.preview;
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        p.index = clamp(p.index + (e.key === 'ArrowRight' ? 1 : -1), 0, p.slides.length - 1);
        paintStructurePreview();
      } else if (e.key === 'Enter' && !e.target.closest('button')) { e.preventDefault(); startStructure('sample'); }
      return;
    }
    if (el.editor.hidden) return;
    if (!el.importModal.hidden || !el.checkModal.hidden || !el.helpModal.hidden || !el.syntaxModal.hidden) return;
    // F5 — показ с начала, ⇧F5 и ⌘Enter — с текущего слайда
    if (e.key === 'F5' || (mod && e.key === 'Enter')) { e.preventDefault(); openPresent(e.key === 'F5' && !e.shiftKey ? 0 : state.current); return; }
    if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); saveDraftNow(); say('Сохранено — черновики сохраняются автоматически'); return; }
    if (mod && e.key.toLowerCase() === 'p') { e.preventDefault(); exportPdf(); return; }
    if (isTyping(e.target)) return;
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
    if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
    if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicateSlide(state.current); return; }
    if (e.key === 'PageDown' || e.key === 'ArrowDown' && e.target === document.body) { e.preventDefault(); selectSlide(state.current + 1); }
    if (e.key === 'PageUp' || e.key === 'ArrowUp' && e.target === document.body) { e.preventDefault(); selectSlide(state.current - 1); }
  });

  // печать: и по кнопке, и по ⌘P из меню браузера
  window.addEventListener('beforeprint', () => { if (state.draft && !el.printRoot.childElementCount) preparePrint(); });
  window.addEventListener('afterprint', cleanupPrint);

  window.addEventListener('popstate', () => { if (!el.editor.hidden) closeEditor(true); });
  window.addEventListener('beforeunload', () => { if (state.draft) saveDraftNow(); });
  window.addEventListener('pagehide', () => { if (state.draft) saveDraftNow(); });

  const onResize = debounce(() => {
    if (state.draft) { renderStage(); for (const t of el.slidesList.querySelectorAll('.thumb')) t._sig = null; paintThumbs(); }
    if (!el.present.hidden) paintPresent();
    if (state.preview) paintStructurePreview();
  }, 120);
  window.addEventListener('resize', onResize);
  if (window.ResizeObserver) new ResizeObserver(() => { if (state.draft) renderStage(); }).observe(el.stage);
}

async function loadFonts() {
  if (!document.fonts || !document.fonts.load) return;
  const specs = [400, 500, 600, 700].map(w => `${w} 40px WEInter`)
    .concat(['italic 500 40px WEInter', 'italic 700 40px WEInter', '800 40px WEMontserrat']);
  try { await Promise.all(specs.map(s => document.fonts.load(s, 'AaЯяӘә₸0→'))); } catch { /* нарисуем тем, что есть */ }
}

async function start() {
  collectElements();
  el.brandLogo.innerHTML = logoSvg('brand-svg');
  el.helpBody.innerHTML = HELP;
  el.syntaxBody.innerHTML = SYNTAX;
  paintIcons();
  syncThemeButtons();
  if (window.matchMedia) {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    if (mq.addEventListener) mq.addEventListener('change', syncThemeButtons);
  }
  wireEvents();
  wireInstallBanner();
  history.replaceState({ screen: 'start' }, '', location.pathname + location.search);
  await loadFonts();
  buildStructures();
  buildDrafts();
  paintStructures();
  paintHeroDemo();
  const saved = storeGet(STORE_START_TEXT, '');
  if (typeof saved === 'string' && saved.trim()) el.startText.value = saved;
  updateStartPreview.flush();
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('service-worker.js').catch(() => { /* офлайн не заработает — не критично */ });
  }
}

start();
