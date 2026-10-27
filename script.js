(() => {
  'use strict';

  /* =========================================================
     설정
     ========================================================= */
  const CATS = [
    { key: 'red',      label: 'Red',      sw: '#e5484d' },
    { key: 'orange',   label: 'Orange',      sw: '#f76b15' },
    { key: 'yellow',   label: 'Yellow',      sw: '#f5c400' },
    { key: 'green',    label: 'Green',      sw: '#30a46c' },
    { key: 'blue',     label: 'Blue',      sw: '#3b9eff' },
    { key: 'purple',   label: 'Purple',      sw: '#8e4ec6' },
    { key: 'pink',     label: 'Pink',      sw: '#f06fae' },
    { key: 'brown',    label: 'Brown',    sw: '#8a5a3c' },
    { key: 'black',    label: 'Black',      sw: '#1b1b1d' },
    { key: 'gray',     label: 'Gray',    sw: '#9b9a97' },
    { key: 'silver',   label: 'Silver',      sw: null },
    { key: 'white',    label: 'White',    sw: '#ffffff' },
    { key: 'twotone',  label: 'Two-tone',  sw: null, boards: ['hair'] },
    { key: 'oddeye',   label: 'Odd-eye',   sw: null, boards: ['eye'] },
    { key: 'other',    label: 'Other',     sw: null },
  ];
  // 예전 버전 칸 → 현재 칸
  const LEGACY_CAT = { indigo: 'blue', gradient: 'other' };
  const CAT = Object.fromEntries(CATS.map(c => [c.key, c]));
  // 보드별로 쓰는 칸 (머리색: 투톤 / 눈색: 오드아이)
  const catsFor = (board) => CATS.filter(c => !c.boards || c.boards.includes(board));
  const multiCatFor = (board) => (board === 'eye' ? 'oddeye' : board === 'hair' ? 'twotone' : 'other');
  // 예전 칸 이름 정리 + 보드에 없는 칸이면 맞는 칸으로
  function fixCat(cat, board) {
    let k = LEGACY_CAT[cat] || cat;
    if (k === 'twotone' || k === 'oddeye') k = multiCatFor(board);
    return CAT[k] ? k : null;
  }
  const BOARDS = [
    { key: 'hair', label: '머리색' },
    { key: 'eye',  label: '눈색' },
    { key: 'theme', label: '테마색' },     // 등록할 때는 안 거치고, 편집창에서 나중에 추가
  ];
  const VIEWS = [...BOARDS, { key: 'all', label: '한눈에 보기' }];
  const STORE_KEY = 'colorShelf.v1';
  const THUMB = 160;            // 저장되는 원형 썸네일 해상도(px)
  const PREVIEW_CSS = 208;      // 미리보기 원 크기(px)

  const dpr = () => Math.min(window.devicePixelRatio || 1, 2);
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const $ = (s) => document.querySelector(s);

  const els = {
    board: $('#board'), tabs: $('#tabs'),
    fileInput: $('#fileInput'), importInput: $('#importInput'), exportBtn: $('#exportBtn'),
    modal: $('#modal'), sheet: $('#sheet'), title: $('#modalTitle'), sub: $('#modalSub'), close: $('#modalClose'),
    stageWrap: $('#stageWrap'), stage: $('#stage'), sizeRange: $('#sizeRange'),
    preview: $('#preview'), colorSlots: $('#colorSlots'),
    swatch: $('#swatch'), noneBtn: $('#noneBtn'), hexInput: $('#hexInput'), colorPicker: $('#colorPicker'), hoverText: $('#hoverText'), autoBtn: $('#autoPickBtn'),
    nameInput: $('#nameInput'), nameField: $('#nameField'), catGrid: $('#catGrid'),
    layoutSeg: $('#layoutSeg'), sortSeg: $('#sortSeg'), boardSortSeg: $('#boardSortSeg'), nameCheck: $('#nameCheck'), themeCheck: $('#themeCheck'), themeCheckWrap: $('#themeCheckWrap'),
    deleteBtn: $('#deleteBtn'), skipBtn: $('#skipBtn'), saveBtn: $('#saveBtn'),
    toast: $('#toast'), slotsHint: $('#slotsHint'), sameCropBtn: $('#sameCropBtn'), resetCropBtn: $('#resetCropBtn'), previewHint: $('#previewHint'), stageHint: $('#stageHint'),
    snapBtn: $('#snapBtn'), snapModal: $('#snapModal'), snapImg: $('#snapImg'), snapSub: $('#snapSub'),
    snapClose: $('#snapClose'), snapTitle: $('#snapTitle'), snapCancel: $('#snapCancel'), snapDownload: $('#snapDownload'),
    charModal: $('#charModal'), charName: $('#charName'), charNameField: $('#charNameField'),
    charPhotoBtn: $('#charPhotoBtn'), charPhotoInput: $('#charPhotoInput'), charChartBtn: $('#charChartBtn'),
    charCanvas: $('#charCanvas'), charHint: $('#charHint'), charRows: $('#charRows'),
    charClose: $('#charClose'), charCancel: $('#charCancel'), charSave: $('#charSave'), charDelete: $('#charDelete'),
    replaceBtn: $('#replaceBtn'), replaceInput: $('#replaceInput'),
    linkBtn: $('#linkBtn'), linkBtnText: $('#linkBtnText'),
    picker: $('#picker'), pickerTitle: $('#pickerTitle'), pickerSub: $('#pickerSub'), pickerGrid: $('#pickerGrid'),
    pickerAll: $('#pickerAll'), pickerCancel: $('#pickerCancel'), pickerOk: $('#pickerOk'), pickerClose: $('#pickerClose'),
  };
  const sctx = els.stage.getContext('2d');
  const pctx = els.preview.getContext('2d', { willReadFrequently: true });

  /* =========================================================
     상태 & 저장
     ========================================================= */
  const state = { items: [], seq: 0, board: 'hair', layout: 'rows', showNames: true, sortAll: 'hair', chars: {},
    boardSort: { hair: 'light', eye: 'light', theme: 'light' },
    showTheme: true, charOrder: [] };   // 한눈에 보기: 테마색 칩 표시, 직접 배치 순서(charId 목록)   // light = 밝기순(기본), manual = 직접 배치
  // 캐릭터별 '그 외' 색: [{ color, memo }]
  const charData = (charId) => state.chars[charId] || { extras: [] };

  function cleanChars(raw) {
    const out = {};
    if (!raw || typeof raw !== 'object') return out;
    for (const [id, v] of Object.entries(raw)) {
      const extras = Array.isArray(v && v.extras) ? v.extras
        .filter(x => x && (x.color === 'none' || /^#[0-9a-f]{6}$/i.test(x.color)))
        .map(x => ({ color: x.color.toLowerCase(), memo: typeof x.memo === 'string' ? x.memo.slice(0, 40) : '' }))
        .slice(0, 30) : [];
      if (extras.length) out[id] = { extras };
    }
    return out;
  }
  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return;
      const d = JSON.parse(raw);
      state.items = Array.isArray(d.items) ? d.items : [];
      for (const it of state.items) {
        it.cat = fixCat(it.cat, it.board) || 'other';
        if (!Array.isArray(it.colors) || !it.colors.length) it.colors = [it.color];
        if (typeof it.charId !== 'string') it.charId = it.id;
      }
      state.seq = Number(d.seq) || state.items.length;
      state.chars = cleanChars(d.chars);
      if (VIEWS.some(b => b.key === d.board)) state.board = d.board;
      if (d.layout === 'rows' || d.layout === 'cols') state.layout = d.layout;
      if (typeof d.showNames === 'boolean') state.showNames = d.showNames;
      if (['hair', 'eye', 'name', 'manual'].includes(d.sortAll)) state.sortAll = d.sortAll;
      if (typeof d.showTheme === 'boolean') state.showTheme = d.showTheme;
      if (Array.isArray(d.charOrder)) state.charOrder = d.charOrder.filter(x => typeof x === 'string');
      if (d.lastCrop && ['x', 'y', 'r', 'iw', 'ih'].every(k => Number.isFinite(d.lastCrop[k]))) state.lastCrop = d.lastCrop;
      if (d.boardSort && typeof d.boardSort === 'object') {
        for (const k of Object.keys(state.boardSort)) if (['light', 'manual'].includes(d.boardSort[k])) state.boardSort[k] = d.boardSort[k];
      }
    } catch (e) { /* 저장소 사용 불가 시 빈 상태로 시작 */ }
  }
  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({
        items: state.items, seq: state.seq, board: state.board, chars: state.chars,
        layout: state.layout, showNames: state.showNames, sortAll: state.sortAll, boardSort: state.boardSort,
        showTheme: state.showTheme, charOrder: state.charOrder, lastCrop: state.lastCrop,
      }));
    } catch (e) {
      toast('브라우저 저장 공간이 부족합니다. 백업 후 일부를 정리해 주십시오.');
    }
  }

  /* =========================================================
     색상 유틸
     ========================================================= */
  const rgbToHex = (r, g, b) => '#' + [r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
  function hexToRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function rgbToHsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    let h = 0;
    if (d) {
      if (max === r) h = ((g - b) / d) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60; if (h < 0) h += 360;
    }
    return { h, s: max ? d / max : 0, v: max };
  }

  // '없음' (머리카락/눈이 없는 캐릭터) — 투명 체크무늬로 표시
  const NONE = 'none';
  const CHECKER = 'repeating-conic-gradient(#d2d2d2 0 25%, #f4f4f4 0 50%) 50% / 8px 8px';
  const paint = (c) => (c === NONE ? CHECKER : c);
  const colorLabel = (c) => (c === NONE ? '없음' : c.toUpperCase());
  // 여러 색일 때 자동 분류: '없음'만 있으면 Other, 실제 색 2개 이상이면 투톤/오드아이
  function autoCatFor(colors, board) {
    const real = colors.filter(c => c !== NONE);
    if (!real.length) return 'other';
    if (real.length > 1) return multiCatFor(board);
    return classify(real[0]);
  }

  // 색 → 칸 자동 분류 (경계값은 여기서 조절)
  function classify(hex) {
    if (hex === NONE || !/^#[0-9a-f]{6}$/i.test(hex)) return 'other';
    const { h, s, v } = rgbToHsv(...hexToRgb(hex));
    if (v < 0.16) return 'black';
    if (s < 0.13 || (s < 0.22 && v < 0.32)) {
      if (v > 0.86) return 'white';
      if (v < 0.26) return 'black';
      if (v >= 0.64) return 'silver';            // 밝은 회색 = 실버
      return 'gray';
    }
    // 어둡거나 탁한 주황~적갈색 = 브라운
    if (h >= 8 && h < 45 && (v < 0.62 || (s < 0.5 && v < 0.8))) return 'brown';
    if (h >= 345 || h < 12) {
      if (s < 0.55 && v > 0.7) return 'pink';    // 연한 빨강 = 핑크
      return 'red';
    }
    if (h < 40) return 'orange';                  // 갈색 계열 포함
    if (h < 68) return 'yellow';                  // 금발 계열 포함
    if (h < 165) return 'green';
    if (h < 262) return 'blue';                   // 하늘색 ~ 남색 계열 포함
    if (h < 295) return 'purple';
    return 'pink';                                // 마젠타 ~ 핑크
  }

  // 지정 지점 주변 평균색
  function sampleAvg(ctx, x, y, rad) {
    const W = ctx.canvas.width, H = ctx.canvas.height;
    const x0 = clamp(Math.round(x) - rad, 0, W - 1), y0 = clamp(Math.round(y) - rad, 0, H - 1);
    const x1 = clamp(Math.round(x) + rad, 0, W - 1), y1 = clamp(Math.round(y) + rad, 0, H - 1);
    const d = ctx.getImageData(x0, y0, x1 - x0 + 1, y1 - y0 + 1).data;
    let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 200) continue;
      r += d[i]; g += d[i + 1]; b += d[i + 2]; n++;
    }
    return n ? rgbToHex(r / n, g / n, b / n) : null;
  }

  // 원 안쪽에서 가장 많이 쓰인 색(대표색) 추출
  const domCanvas = document.createElement('canvas');
  const domCtx = domCanvas.getContext('2d', { willReadFrequently: true });
  function dominant(src) {
    const s = 48;
    domCanvas.width = domCanvas.height = s;
    domCtx.clearRect(0, 0, s, s);
    domCtx.drawImage(src, 0, 0, s, s);
    const d = domCtx.getImageData(0, 0, s, s).data;
    const bins = new Map();
    const lim = (s * 0.4) ** 2;
    for (let py = 0; py < s; py++) {
      for (let px = 0; px < s; px++) {
        const dx = px - s / 2 + 0.5, dy = py - s / 2 + 0.5;
        if (dx * dx + dy * dy > lim) continue;
        const i = (py * s + px) * 4;
        if (d[i + 3] < 200) continue;
        const r = d[i], g = d[i + 1], b = d[i + 2];
        const k = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5);
        let e = bins.get(k);
        if (!e) { e = [0, 0, 0, 0]; bins.set(k, e); }
        e[0] += r; e[1] += g; e[2] += b; e[3]++;
      }
    }
    let best = null;
    for (const e of bins.values()) if (!best || e[3] > best[3]) best = e;
    return best ? rgbToHex(best[0] / best[3], best[1] / best[3], best[2] / best[3]) : '#888888';
  }

  // 이미지 밖으로 나간 영역까지 안전하게 원형 영역을 그리기
  function drawCrop(ctx, img, iw, ih, cx, cy, r, S) {
    const sx = cx - r, sy = cy - r, sw = 2 * r, k = S / sw;
    const x0 = Math.max(0, sx), y0 = Math.max(0, sy);
    const x1 = Math.min(iw, sx + sw), y1 = Math.min(ih, sy + sw);
    if (x1 <= x0 || y1 <= y0) return;
    ctx.drawImage(img, x0, y0, x1 - x0, y1 - y0, (x0 - sx) * k, (y0 - sy) * k, (x1 - x0) * k, (y1 - y0) * k);
  }

  /* =========================================================
     원본 사진 보관 (IndexedDB) — 다른 보드에서 다시 찍을 때 사용
     ========================================================= */
  const originals = (() => {
    let dbp = null;
    function open() {
      if (!dbp) {
        dbp = new Promise((resolve, reject) => {
          if (!window.indexedDB) { reject(new Error('no idb')); return; }
          const r = indexedDB.open('colorShelf', 1);
          r.onupgradeneeded = () => r.result.createObjectStore('originals');
          r.onsuccess = () => resolve(r.result);
          r.onerror = () => reject(r.error);
        });
      }
      return dbp;
    }
    async function run(mode, fn) {
      const db = await open();
      return new Promise((resolve, reject) => {
        const t = db.transaction('originals', mode);
        const req = fn(t.objectStore('originals'));
        t.oncomplete = () => resolve(req ? req.result : undefined);
        t.onerror = () => reject(t.error);
      });
    }
    return {
      get: (k) => run('readonly', st => st.get(k)).catch(() => null),
      put: (k, v) => run('readwrite', st => st.put(v, k)).catch(() => {}),
      del: (k) => run('readwrite', st => st.delete(k)).catch(() => {}),
      clear: () => run('readwrite', st => st.clear()).catch(() => {}),
    };
  })();

  // 원본 보관: 8MB 이하 일반 이미지는 파일 그대로, 그 외엔 긴 변 3000px JPG
  const ORIGINAL_MAX_BYTES = 8 * 1024 * 1024;
  function originalFor(file, img, iw, ih) {
    if (file && file.size <= ORIGINAL_MAX_BYTES && /^image\/(jpeg|png|webp|gif|avif)$/.test(file.type)) {
      return Promise.resolve(file);
    }
    return makeOriginalBlob(img, iw, ih);
  }
  function makeOriginalBlob(img, iw, ih) {
    const k = Math.min(1, 3000 / Math.max(iw, ih));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(iw * k));
    c.height = Math.max(1, Math.round(ih * k));
    const ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, c.width, c.height);
    return new Promise(res => c.toBlob(b => res(b), 'image/jpeg', 0.92));
  }

  const boardLabel = (key) => (BOARDS.find(b => b.key === key) || {}).label || '';
  const otherBoard = (key) => BOARDS.find(b => b.key !== key).key;
  const hasChar = (charId, board) => state.items.some(i => i.charId === charId && i.board === board);
  const idTime = (id) => { const n = parseInt(String(id).slice(0, 8), 36); return Number.isFinite(n) && n > 1e12 ? n : 0; };
  // 캐릭터 단위로 묶기 (등록 순서대로)
  function characters() {
    const map = new Map();
    for (const it of state.items) {
      let c = map.get(it.charId);
      if (!c) { c = { charId: it.charId, items: {}, created: Infinity, name: '' }; map.set(it.charId, c); }
      c.items[it.board] = it;
      c.created = Math.min(c.created, it.created || idTime(it.charId) || it.order);
      if (it.name && !c.name) c.name = it.name;
    }
    return [...map.values()].sort((a, b) => a.created - b.created);
  }
  function syncName(charId, name, exceptId) {
    for (const i of state.items) if (i.charId === charId && i.id !== exceptId) i.name = name;
  }

  /* =========================================================
     렌더링
     ========================================================= */
  function chipEl(c) {
    const s = document.createElement('span');
    s.className = 'chip' + (c.sw ? '' : ' ' + c.key);
    if (c.sw) s.style.setProperty('--c', c.sw);
    return s;
  }

  const itemColors = (it) => (Array.isArray(it.colors) && it.colors.length ? it.colors : [it.color]);
  const cardTitle = (it) => (it.name ? it.name + ' · ' : '') + itemColors(it).map(colorLabel).join(' / ');

  // 카드 오른쪽 아래 색 점: 1색 = 단색, 투톤 = 나눠 칠하기, 그라데이션 = 섞기
  function dotBackground(it) {
    const cols = itemColors(it);
    if (cols.length === 1) return paint(cols[0]);
    const hasNone = cols.includes(NONE);
    const cs = cols.map(c => (c === NONE ? 'transparent' : c));
    let g;
    if (it.cat === 'other') g = `linear-gradient(135deg, ${cs.join(', ')})`;
    else {
      const step = 100 / cs.length;
      g = `conic-gradient(from 180deg, ${cs.map((c, i) => `${c} ${i * step}% ${(i + 1) * step}%`).join(', ')})`;
    }
    return hasNone ? `${g}, ${CHECKER}` : g;
  }

  function cardEl(it, isNew) {
    const b = document.createElement('div');
    b.className = 'card' + (isNew ? ' is-new' : '');
    b.dataset.id = it.id;
    b.tabIndex = 0;
    b.setAttribute('role', 'button');
    b.title = cardTitle(it);

    const wrap = document.createElement('span');
    wrap.className = 'thumb-wrap';
    const th = document.createElement('span');
    th.className = 'thumb';
    const img = new Image();
    img.src = it.img; img.alt = it.name || itemColors(it)[0]; img.draggable = false;
    th.append(img);
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.setProperty('--c', dotBackground(it));
    wrap.append(th, dot);

    // 사진 아래 이름 칸 (행/열 상관없이 항상 사진 아래)
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'name-input';
    input.value = it.name || '';
    input.placeholder = '이름';
    input.maxLength = 80;
    input.autocomplete = 'off';
    input.setAttribute('aria-label', '캐릭터 이름');

    b.append(wrap, input);
    return b;
  }

  function applyView() {
    const all = state.board === 'all';
    els.board.classList.toggle('is-all', all);
    els.layoutSeg.hidden = all;
    els.sortSeg.hidden = !all;
    els.boardSortSeg.hidden = all;
    for (const btn of els.boardSortSeg.querySelectorAll('button')) {
      btn.classList.toggle('is-active', !all && btn.dataset.bsort === state.boardSort[state.board]);
    }
    for (const btn of els.sortSeg.querySelectorAll('button')) {
      btn.classList.toggle('is-active', btn.dataset.sort === state.sortAll);
    }
    els.linkBtn.hidden = true;
    els.board.classList.toggle('is-cols', !all && state.layout === 'cols');
    els.board.classList.toggle('show-names', state.showNames);
    for (const btn of els.layoutSeg.querySelectorAll('button')) {
      btn.classList.toggle('is-active', btn.dataset.layout === state.layout);
    }
    els.nameCheck.checked = state.showNames;
    els.themeCheck.checked = state.showTheme;
    els.themeCheckWrap.hidden = !all;
    els.nameField.hidden = !state.showNames;
  }

  function render(highlightId) {
    applyView();
    els.linkBtnText.textContent = `${boardLabel(otherBoard(state.board))}에서 가져오기`;
    // 탭
    els.tabs.replaceChildren(...VIEWS.map(b => {
      const t = document.createElement('button');
      t.type = 'button';
      t.className = 'tab' + (b.key === state.board ? ' is-active' : '');
      t.dataset.board = b.key;
      t.textContent = b.label;
      const n = document.createElement('span');
      n.className = 'n';
      n.textContent = b.key === 'all' ? characters().length : state.items.filter(i => i.board === b.key).length;
      t.append(n);
      return t;
    }));

    if (state.board === 'all') { renderAll(highlightId); return; }

    // 칸
    const items = boardItems(state.board);
    const frag = document.createDocumentFragment();

    if (!items.length) {
      const e = document.createElement('div');
      e.className = 'empty';
      e.innerHTML = '<strong>아직 등록된 캐릭터가 없습니다</strong><span>‘캐릭터 추가’ 버튼 및 드래그&amp;드롭으로 이미지를 활용할 수 있습니다. 일괄 추가도 가능합니다.</span>';
      e.style.gridColumn = `1 / span ${catsFor(state.board).length}`;
      frag.append(e);
    }

    for (const c of catsFor(state.board)) {
      const list = items.filter(i => i.cat === c.key);
      const row = document.createElement('section');
      row.className = 'row';
      row.dataset.cat = c.key;

      const label = document.createElement('div');
      label.className = 'row-label';
      const name = document.createElement('span');
      name.className = 'row-name';
      name.textContent = c.label;
      const count = document.createElement('span');
      count.className = 'row-count';
      count.textContent = list.length || '';
      label.append(chipEl(c), name, count);

      const box = document.createElement('div');
      box.className = 'items';
      for (const it of list) box.append(cardEl(it, it.id === highlightId));

      row.append(label, box);
      frag.append(row);
    }
    els.board.replaceChildren(frag);
  }

  /* ---------- 한눈에 보기: 캐릭터 전체 + 컬러칩 2개 ---------- */
  function renderAll(highlightId) {
    const hlItem = highlightId && state.items.find(i => i.id === highlightId);
    const hlChar = hlItem ? hlItem.charId : null;
    const chars = sortChars(characters());
    const frag = document.createDocumentFragment();
    if (!chars.length) {
      const e = document.createElement('div');
      e.className = 'empty';
      e.innerHTML = '<strong>아직 등록된 캐릭터가 없습니다</strong><span>‘캐릭터 추가’ 버튼 및 드래그&amp;드롭으로 이미지를 활용할 수 있습니다. 일괄 추가도 가능합니다.</span>';
      frag.append(e);
    } else {
      const grid = document.createElement('div');
      grid.className = 'all-grid';
      for (const c of chars) grid.append(charCardEl(c, c.charId === hlChar));
      frag.append(grid);
    }
    els.board.replaceChildren(frag);
  }

  // 명도 (CIE L*, 0~100) — 첫 번째 색 기준, '없음'은 맨 뒤
  function lightness(hex) {
    if (hex === NONE || !/^#[0-9a-f]{6}$/i.test(hex)) return -1;
    const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    const [r, g, b] = hexToRgb(hex).map(lin);
    const Y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    return Y > 0.008856 ? 116 * Math.cbrt(Y) - 16 : 903.3 * Y;
  }
  const firstColor = (it) => itemColors(it).find(c => c !== NONE) || NONE;
  // 보드 카드 순서: 밝기순이면 밝은 색 → 어두운 색, 직접 배치면 끌어다 놓은 순서
  function boardItems(board) {
    const list = state.items.filter(i => i.board === board);
    if (state.boardSort[board] === 'manual') return list.sort((a, b) => a.order - b.order);
    return list.sort((a, b) => lightness(firstColor(b)) - lightness(firstColor(a)) || a.order - b.order);
  }

  // 한눈에 보기 정렬
  const nameCollator = new Intl.Collator('ko', { numeric: true, sensitivity: 'base' });
  function sortChars(chars) {
    if (state.sortAll === 'manual') {
      // 직접 배치: 저장된 순서대로, 새로 추가된 캐릭터는 맨 뒤
      const pos = new Map(state.charOrder.map((id, i) => [id, i]));
      return chars.slice().sort((a, b) => (pos.get(a.charId) ?? 1e9) - (pos.get(b.charId) ?? 1e9) || a.created - b.created);
    }
    if (state.sortAll === 'name') {
      return chars.slice().sort((a, b) => {
        if (!a.name !== !b.name) return a.name ? -1 : 1;      // 이름 없는 캐릭터는 뒤로
        return nameCollator.compare(a.name, b.name) || a.created - b.created;
      });
    }
    // 머리색순 / 눈색순: 칸 순서(Red → … → Other) → 같은 칸 안에서는 그 보드에 보이는 순서
    const board = state.sortAll === 'eye' ? 'eye' : 'hair';
    const rank = Object.fromEntries(catsFor(board).map((c, i) => [c.key, i]));
    const pos = new Map(boardItems(board).map((it, i) => [it.id, i]));
    return chars.slice().sort((a, b) => {
      const ha = a.items[board], hb = b.items[board];
      if (!ha !== !hb) return ha ? -1 : 1;                    // 그 색이 없는 캐릭터는 뒤로
      if (!ha) return a.created - b.created;
      return (rank[ha.cat] ?? 99) - (rank[hb.cat] ?? 99) || pos.get(ha.id) - pos.get(hb.id);
    });
  }

  function charCardEl(c, isNew) {
    const el = document.createElement('div');
    el.className = 'char-card' + (isNew ? ' is-new' : '');
    el.dataset.charId = c.charId;
    el.tabIndex = 0;
    el.setAttribute('role', 'button');
    const src = c.items.hair || c.items.eye;

    const th = document.createElement('span');
    th.className = 'thumb';
    const img = new Image();
    img.src = src.img; img.alt = c.name || ''; img.draggable = false;
    th.append(img);

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'name-input';
    input.value = c.name || '';
    input.placeholder = '이름';
    input.maxLength = 80;
    input.autocomplete = 'off';
    input.setAttribute('aria-label', '캐릭터 이름');

    const chips = document.createElement('span');
    chips.className = 'cchips';
    for (const b of BOARDS) {
      const it = c.items[b.key];
      if (b.key === 'theme' && (!it || !state.showTheme)) continue;
      const chip = document.createElement('span');
      chip.className = 'cchip' + (it ? '' : ' is-empty');
      const dot = document.createElement('i');
      if (it) dot.style.setProperty('--c', dotBackground(it));
      chip.append(dot);
      chip.dataset.board = b.key;
      chip.setAttribute('aria-label', it ? `${b.label} ${itemColors(it).map(colorLabel).join(' / ')} — 눌러서 복사` : `${b.label} 미등록`);
      chips.append(chip);
    }
    el.append(th, input, chips);
    return el;
  }

  /* =========================================================
     업로드 큐
     ========================================================= */
  const queue = [];
  let queueTotal = 0, queueDone = 0;

  const IMG_EXT = /\.(png|jpe?g|gif|webp|avif|bmp|heic|heif)$/i;
  const isImageFile = (f) => (f.type && f.type.startsWith('image/')) || IMG_EXT.test(f.name || '');

  function addFiles(list) {
    const files = [...list].filter(isImageFile);
    if (!files.length) return;
    queue.push(...files);
    queueTotal += files.length;
    if (!modal.open) nextInQueue();
    else updateSub();
  }

  // 파일 앞부분을 읽어 실제 형식 확인 (확장자와 다를 수 있음)
  async function sniffFormat(file) {
    try {
      const b = new Uint8Array(await file.slice(0, 32).arrayBuffer());
      const ascii = (s, e) => String.fromCharCode(...b.slice(s, e));
      if (b[0] === 0x89 && ascii(1, 4) === 'PNG') return 'PNG';
      if (b[0] === 0xff && b[1] === 0xd8) return 'JPG';
      if (ascii(0, 3) === 'GIF') return 'GIF';
      if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'WEBP';
      if (ascii(0, 2) === 'BM') return 'BMP';
      if (ascii(4, 8) === 'ftyp') {
        const brand = ascii(8, 12);
        if (/avi[fs]/.test(brand)) return 'AVIF';
        if (/hei[cxms]|hev[cx]|mif1|msf1/.test(brand)) return 'HEIC';
      }
    } catch (e) { /* 무시 */ }
    return null;
  }

  function readAsDataURL(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.readAsDataURL(file);
    });
  }

  // 1순위: createImageBitmap (URL 없이 바로 디코딩 → 보안 정책 영향 없음)
  // 2순위: data URL로 <img> 로드
  async function loadImage(file) {
    if (window.createImageBitmap) {
      try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch (e) { /* 다음 방법 */ }
      try { return await createImageBitmap(file); } catch (e) { /* 다음 방법 */ }
    }
    const src = await readAsDataURL(file);
    return await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('decode'));
      img.src = src;
    });
  }

  function releaseImage() {
    if (modal.img && typeof modal.img.close === 'function') {
      try { modal.img.close(); } catch (e) { /* 무시 */ }
    }
    modal.img = null;
  }

  async function nextInQueue() {
    if (!queue.length) {
      closeModal();
      queueTotal = queueDone = 0;
      return;
    }
    const file = queue.shift();
    if (file && file.kind === 'char') { openCharEntry(file); return; }
    try {
      const img = await loadImage(file);
      openModal({ mode: 'new', img, file, fileName: file.name, board: 'hair', flow: 'both' });
    } catch (e) {
      const fmt = await sniffFormat(file);
      if (fmt === 'HEIC') toast(`HEIC(아이폰 사진) 형식이라 브라우저에서 열 수 없습니다: ${file.name}`);
      else if (fmt && !new RegExp(fmt === 'JPG' ? 'jpe?g' : fmt, 'i').test(file.name)) toast(`확장자와 달리 실제로는 ${fmt} 파일입니다. 열 수 없습니다: ${file.name}`);
      else toast(`이 브라우저에서 열 수 없는 파일입니다${fmt ? ` (${fmt})` : ''}: ${file.name}`);
      queueDone++;
      nextInQueue();
    }
  }

  // 다른 보드의 캐릭터를 원본 사진으로 다시 열기
  async function openCharEntry(entry) {
    const src = state.items.find(i => i.charId === entry.charId && i.board === entry.board)
      || state.items.find(i => i.charId === entry.charId);
    if (!src) { queueDone++; nextInQueue(); return; }
    if (entry.file) {
      // 새 사진으로 바꾸기
      try {
        const img = await loadImage(entry.file);
        openModal({
          mode: 'new', img, file: entry.file, board: entry.board, charId: entry.charId, flow: entry.flow || 'single', change: true,
          name: src.name || '', fileName: src.name || entry.file.name, hasOriginal: false, fromChar: true,
        });
      } catch (e) {
        const fmt = await sniffFormat(entry.file);
        toast(`열 수 없는 파일입니다${fmt ? ` (${fmt})` : ''}: ${entry.file.name}`);
        queueDone++; nextInQueue();
      }
      return;
    }
    let img = null, hasOriginal = false;
    const blob = await originals.get(entry.charId);
    if (blob) {
      try { img = await loadImage(blob); hasOriginal = true; } catch (e) { img = null; }
    }
    if (!img) {
      // 원본이 없으면(예전에 올린 카드) 저장된 원형 썸네일로 대신
      img = await new Promise((resolve) => {
        const im = new Image();
        im.onload = () => resolve(im);
        im.onerror = () => resolve(null);
        im.src = src.img;
      });
      hasOriginal = true;   // 저해상도 썸네일은 원본으로 저장하지 않음
    }
    if (!img) { toast('사진을 불러오지 못했습니다'); queueDone++; nextInQueue(); return; }
    openModal({
      mode: 'new', img, board: entry.board, charId: entry.charId,
      name: src.name || '', fileName: src.name || '이름 없음', hasOriginal, fromChar: true, flow: entry.flow || 'single',
      lowRes: !blob,
    });
  }

  /* =========================================================
     모달 (크롭 + 스포이드 + 분류)
     ========================================================= */
  const modal = { open: false };
  let disp = null;        // 스테이지용 축소 이미지
  let stageDrag = null;
  let rafId = 0;

  function openModal(o) {
    const iw = o.img.naturalWidth || o.img.width;
    const ih = o.img.naturalHeight || o.img.height;
    Object.assign(modal, {
      open: true, mode: o.mode, img: o.img, item: o.item || null,
      fileName: o.fileName || '', iw, ih,
      board: o.board || (o.item ? o.item.board : state.board),
      charId: o.charId || (o.item ? o.item.charId : uid()),
      hasOriginal: !!o.hasOriginal,
      file: o.file || null,
      fromChar: !!o.fromChar,
      flow: o.flow || 'single',
      change: !!o.change,
      colors: ['#888888'], picks: [null], slot: 0, manual0: false, manualCat: false, cat: null,
      cropKey: undefined,
    });

    const isNew = o.mode === 'new';
    els.sheet.classList.toggle('is-edit', !isNew);
    els.deleteBtn.hidden = isNew;
    els.skipBtn.hidden = !isNew;
    els.title.textContent = isNew ? stepTitle() : '카드 수정';
    els.modal.hidden = false;
    document.body.classList.add('modal-open');

    els.hoverText.textContent = '';
    if (o.mode !== 'new') setLocked(false);

    if (isNew) {
      const m = Math.min(iw, ih);
      // 시작 시: 사진 정중앙에 가장 큰 원 (1:1 사진은 그대로 꽉 차게)
      modal.r = m / 2;
      modal.cx = iw / 2;
      modal.cy = ih / 2;
      els.nameInput.value = o.name || '';
      // 한 캐릭터 = 사진 하나: 다른 쪽에서 원 위치를 이미 정했으면 그대로 쓰고 스포이드만
      const other = o.flow === 'single' && !o.file
        ? state.items.find(i => i.charId === modal.charId && i.board !== modal.board)
        : null;
      let lock = false;
      if (other && o.lowRes) lock = true;                 // 썸네일로 열면 썸네일 자체가 이미 잘린 사진
      else if (other && other.crop) { applyCrop(other.crop); lock = true; }
      setLocked(lock);
      loadStepValues();
      refreshColorUI();
      if (!lock) layoutStage();
      else redraw();
      if (o.change) toast('기존 색은 그대로 유지됩니다. 원 위치만 새 사진에 맞춰 주십시오');
      els.replaceBtn.hidden = !modal.fromChar;
      els.replaceBtn.classList.toggle('is-attn', !!o.lowRes);
      if (o.lowRes) toast('원본이 없는 예전 카드라 썸네일로 열었습니다. ‘원본 사진 바꾸기’로 고화질 사진을 넣을 수 있습니다');
    } else {
      const it = o.item;
      modal.colors = itemColors(it).slice();
      modal.picks = modal.colors.map(() => null);
      modal.manual0 = true;
      modal.manualCat = !it.auto;
      modal.cat = it.cat;
      els.nameInput.value = it.name || '';
      drawPreview();
    }
    updateSub();
  }

  function closeModal() {
    releaseImage();
    modal.open = false;
    modal.img = null;
    stageDrag = null;
    disp = null;
    els.modal.hidden = true;
    document.body.classList.remove('modal-open');
  }

  function stepTitle() {
    if (modal.flow === 'both') {
      const again = modal.change ? '다시 지정' : '찍기';
      return modal.board === 'hair' ? `① 머리색 ${again}` : `② 눈색 ${again}`;
    }
    return `${boardLabel(modal.board)} ${hasChar(modal.charId, modal.board) ? '다시 찍기' : '찍기'}`;
  }
  const firstStep = () => modal.flow === 'both' && modal.board === 'hair';

  function updateSub() {
    if (!modal.open) return;
    if (modal.mode === 'new') {
      els.sub.textContent = `${queueDone + 1} / ${queueTotal}` + (modal.fileName ? ` · ${modal.fileName}` : '');
      const keep = hasChar(modal.charId, modal.board);
      els.skipBtn.hidden = false;
      if (modal.change) {
        // 사진 바꾸기: 기존 값이 채워진 채로 순서대로, 언제든 마칠 수 있음
        if (firstStep()) {
          els.skipBtn.textContent = '이대로 마치기';
          els.saveBtn.textContent = '저장하고 눈색 →';
        } else {
          els.skipBtn.hidden = true;
          els.saveBtn.textContent = queue.length ? '저장하고 다음' : '저장하고 마치기';
        }
      } else if (firstStep()) {
        els.skipBtn.textContent = keep ? '머리색은 그대로 두기' : '머리색 건너뛰기';
        els.saveBtn.textContent = '저장하고 눈색 →';
      } else {
        els.skipBtn.textContent = modal.flow === 'both' ? (keep ? '눈색은 그대로 두기' : '눈색 건너뛰기') : (keep ? '그대로 두기' : '건너뛰기');
        els.saveBtn.textContent = queue.length ? '저장하고 다음 사진' : '저장';
      }
    } else {
      const b = BOARDS.find(b => b.key === modal.item.board);
      els.sub.textContent = `${b ? b.label : ''} · ${CAT[modal.item.cat].label}`;
      els.saveBtn.textContent = '저장';
    }
  }

  /* ---------- 스테이지(크롭) ---------- */
  const rMax = () => Math.min(modal.iw, modal.ih) / 2;

  function layoutStage() {
    if (!modal.open || !modal.img || modal.mode !== 'new' || modal.locked) return;
    const pad = isNarrow() ? 20 : 32;
    const W = Math.max(120, els.stageWrap.clientWidth - pad);
    const H = isNarrow()
      ? Math.max(180, Math.min(window.innerHeight * 0.42, 420))
      : Math.max(160, Math.min(window.innerHeight * 0.58, 560));
    const scale = Math.min(W / modal.iw, H / modal.ih);
    const cw = Math.max(1, Math.round(modal.iw * scale));
    const ch = Math.max(1, Math.round(modal.ih * scale));
    els.stage.style.width = cw + 'px';
    els.stage.style.height = ch + 'px';
    els.stage.width = Math.round(cw * dpr());
    els.stage.height = Math.round(ch * dpr());

    disp = document.createElement('canvas');
    disp.width = els.stage.width;
    disp.height = els.stage.height;
    const dctx = disp.getContext('2d');
    dctx.imageSmoothingQuality = 'high';
    dctx.drawImage(modal.img, 0, 0, disp.width, disp.height);

    syncRange();
    redraw();
  }

  function drawStage() {
    const c = els.stage, ctx = sctx;
    const k = c.width / modal.iw;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    if (disp) ctx.drawImage(disp, 0, 0);

    ctx.setTransform(k, 0, 0, k, 0, 0);
    ctx.beginPath();
    ctx.rect(0, 0, modal.iw, modal.ih);
    ctx.moveTo(modal.cx + modal.r, modal.cy);
    ctx.arc(modal.cx, modal.cy, modal.r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(12, 12, 14, 0.62)';
    ctx.fill('evenodd');

    ctx.beginPath();
    ctx.arc(modal.cx, modal.cy, modal.r, 0, Math.PI * 2);
    ctx.lineWidth = (2 * dpr()) / k;
    ctx.strokeStyle = '#fff';
    ctx.stroke();

    // 중앙 십자
    const t = (6 * dpr()) / k;
    ctx.beginPath();
    ctx.moveTo(modal.cx - t, modal.cy); ctx.lineTo(modal.cx + t, modal.cy);
    ctx.moveTo(modal.cx, modal.cy - t); ctx.lineTo(modal.cx, modal.cy + t);
    ctx.lineWidth = (1.2 * dpr()) / k;
    ctx.strokeStyle = 'rgba(255,255,255,.7)';
    ctx.stroke();
  }

  function clampCircle() {
    modal.r = clamp(modal.r, rMax() * 0.01, rMax());
    modal.cx = clamp(modal.cx, 0, modal.iw);
    modal.cy = clamp(modal.cy, 0, modal.ih);
  }
  function syncRange() {
    els.sizeRange.value = Math.round((modal.r / rMax()) * 100);
  }
  function redraw() {
    if (rafId) return;
    rafId = requestAnimationFrame(() => {
      rafId = 0;
      if (!modal.open || !modal.img) return;
      if (modal.mode === 'new' && !modal.locked) drawStage();
      drawPreview();
    });
  }

  function toImg(e) {
    const r = els.stage.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / r.width) * modal.iw,
      y: ((e.clientY - r.top) / r.height) * modal.ih,
    };
  }

  const touches = new Map();
  let pinch = null;
  const pinchInfo = () => {
    const [a, b] = [...touches.values()];
    return { d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
  };
  els.stage.addEventListener('pointerdown', (e) => {
    if (!modal.open) return;
    touches.set(e.pointerId, toImg(e));
    els.stage.setPointerCapture(e.pointerId);
    if (touches.size >= 2) {
      const i = pinchInfo();
      pinch = { d0: Math.max(1, i.d), r0: modal.r, mx0: i.mx, my0: i.my, cx0: modal.cx, cy0: modal.cy };
      stageDrag = null;
      return;
    }
    const p = toImg(e);
    const dx = p.x - modal.cx, dy = p.y - modal.cy;
    if (dx * dx + dy * dy > modal.r * modal.r) {   // 원 밖을 누르면 그 위치로 원 이동
      modal.cx = p.x; modal.cy = p.y;
      clampCircle();
    }
    stageDrag = { x: p.x, y: p.y, cx: modal.cx, cy: modal.cy };
    els.stage.setPointerCapture(e.pointerId);
    redraw();
  });
  els.stage.addEventListener('pointermove', (e) => {
    if (touches.has(e.pointerId)) touches.set(e.pointerId, toImg(e));
    if (pinch && touches.size >= 2) {
      const i = pinchInfo();
      modal.r = pinch.r0 * (i.d / pinch.d0);
      modal.cx = pinch.cx0 + (i.mx - pinch.mx0);
      modal.cy = pinch.cy0 + (i.my - pinch.my0);
      clampCircle();
      syncRange();
      redraw();
      return;
    }
    if (!stageDrag) return;
    const p = toImg(e);
    modal.cx = stageDrag.cx + (p.x - stageDrag.x);
    modal.cy = stageDrag.cy + (p.y - stageDrag.y);
    clampCircle();
    redraw();
  });
  const endStage = (e) => {
    touches.delete(e.pointerId);
    if (touches.size < 2) pinch = null;
    if (touches.size === 1) {
      // 한 손가락만 남으면 그 손가락으로 계속 이동
      const p = [...touches.values()][0];
      stageDrag = { x: p.x, y: p.y, cx: modal.cx, cy: modal.cy };
    } else if (!touches.size) stageDrag = null;
  };
  els.stage.addEventListener('pointerup', endStage);
  els.stage.addEventListener('pointercancel', endStage);
  els.stage.addEventListener('wheel', (e) => {
    if (!modal.open) return;
    e.preventDefault();
    modal.r *= Math.exp(-e.deltaY * 0.0015);
    clampCircle();
    syncRange();
    redraw();
  }, { passive: false });
  els.sizeRange.addEventListener('input', () => {
    modal.r = (rMax() * Number(els.sizeRange.value)) / 100;
    clampCircle();
    redraw();
  });

  /* ---------- 이전과 같게 / 초기화 ---------- */
  function syncCropButtons() {
    els.sameCropBtn.disabled = !state.lastCrop;
    els.sameCropBtn.title = state.lastCrop ? '바로 전에 정한 원 위치·크기를 그대로 적용합니다' : '아직 저장한 크롭이 없습니다';
  }
  els.sameCropBtn.addEventListener('click', () => {
    const lc = state.lastCrop;
    if (!lc || !modal.open || modal.locked) return;
    applyCrop(lc);
    syncRange();
    redraw();
    toast(lc.iw === modal.iw && lc.ih === modal.ih ? '같은 영역으로 크롭했습니다' : '크기가 달라 비율에 맞춰 같은 영역으로 크롭했습니다');
  });
  els.resetCropBtn.addEventListener('click', () => {
    if (!modal.open || modal.locked) return;
    modal.r = Math.min(modal.iw, modal.ih) / 2;
    modal.cx = modal.iw / 2;
    modal.cy = modal.ih / 2;
    syncRange();
    redraw();
  });

  /* ---------- 원본 사진 바꾸기 (가져온 캐릭터용) ---------- */
  els.replaceBtn.addEventListener('click', () => els.replaceInput.click());
  els.replaceInput.addEventListener('change', () => {
    const f = els.replaceInput.files[0];
    els.replaceInput.value = '';
    if (f) replaceCropImage(f);
  });
  async function replaceCropImage(f) {
    if (!f || !modal.open || modal.mode !== 'new') return;
    let img;
    try { img = await loadImage(f); } catch (e) {
      const fmt = await sniffFormat(f);
      toast(`열 수 없는 파일입니다${fmt ? ` (${fmt})` : ''}: ${f.name}`);
      return;
    }
    releaseImage();
    const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
    Object.assign(modal, {
      img, iw, ih, file: f, hasOriginal: false,
      r: Math.min(iw, ih) / 2, cx: iw / 2, cy: ih / 2,
      picks: modal.colors.map(() => null), manual0: false,
    });
    setLocked(false);
    // 바꾼 사진은 저장할 때 이 캐릭터의 새 원본이 됨
    els.replaceBtn.classList.remove('is-attn');
    layoutStage();
    if (modal.flow === 'both' && modal.board === 'eye' && hasChar(modal.charId, 'hair')) {
      // 한 캐릭터 = 사진 하나: 머리색부터 새 사진으로 다시 (입력된 값은 유지)
      modal.change = true;
      goToStep('hair', '사진을 바꿨습니다. 머리색부터 다시 맞춰 주십시오');
      return;
    }
    if (hasChar(modal.charId, modal.board)) modal.change = modal.change || modal.flow === 'both';
    toast('사진을 바꿨습니다');
  }

  /* ---------- 미리보기 & 스포이드 ---------- */
  const MAX_COLORS = 5;
  const curColor = () => modal.colors[modal.slot];

  function drawPreview() {
    const S = els.preview.width;
    pctx.clearRect(0, 0, S, S);
    pctx.save();
    pctx.beginPath();
    pctx.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2);
    pctx.clip();
    // 원 영역이 미리보기보다 작아 확대될 때는 픽셀을 그대로 키움 → 색이 섞이지 않아 스포이드가 정확
    const srcPx = modal.mode === 'new' ? modal.r * 2 : modal.iw;
    const zoom = S / Math.max(1, srcPx);
    pctx.imageSmoothingEnabled = zoom < 1.5;
    pctx.imageSmoothingQuality = 'high';
    els.preview.classList.toggle('is-pixel', zoom >= 1.5);
    if (modal.mode === 'new') drawCrop(pctx, modal.img, modal.iw, modal.ih, modal.cx, modal.cy, modal.r, S);
    else pctx.drawImage(modal.img, 0, 0, S, S);
    pctx.restore();

    // 한 번 찍은 색은 원(영역)을 옮겨도 그대로 유지.
    // 영역이 바뀌면 찍은 위치 표시만 지움 (그 자리는 이제 다른 픽셀이라서)
    const key = modal.mode === 'new' ? `${modal.cx}|${modal.cy}|${modal.r}` : 'edit';
    if (modal.cropKey !== undefined && modal.cropKey !== key) modal.picks = modal.colors.map(() => null);
    modal.cropKey = key;
    // 아직 아무 색도 찍지 않았을 때만 대표색을 자동으로 따라감
    if (!modal.manual0) modal.colors[0] = dominant(els.preview);
    refreshColorUI();
  }

  function previewPoint(e) {
    const r = els.preview.getBoundingClientRect();
    return { u: (e.clientX - r.left) / r.width, v: (e.clientY - r.top) / r.height };
  }
  const inCircle = (p) => (p.u - 0.5) ** 2 + (p.v - 0.5) ** 2 <= 0.25;
  // 미리보기 좌표 → 원본 사진 좌표
  const toSrc = (p) => ({ x: modal.cx - modal.r + p.u * 2 * modal.r, y: modal.cy - modal.r + p.v * 2 * modal.r });
  const srcCanvas = document.createElement('canvas');
  const srcCtx = srcCanvas.getContext('2d', { willReadFrequently: true });
  // 스포이드: 미리보기가 아니라 원본 사진 픽셀에서 바로 (작게 보여도 색이 섞이지 않음)
  const sampleAt = (p) => {
    if (modal.mode === 'new' && modal.img) {
      const { x, y } = toSrc(p);
      const sx = Math.floor(x) - 1, sy = Math.floor(y) - 1;
      if (x < 0 || y < 0 || x >= modal.iw || y >= modal.ih) return null;
      srcCanvas.width = srcCanvas.height = 3;
      srcCtx.clearRect(0, 0, 3, 3);
      srcCtx.imageSmoothingEnabled = false;
      srcCtx.drawImage(modal.img, sx, sy, 3, 3, 0, 0, 3, 3);
      return sampleAvg(srcCtx, 1, 1, 1);
    }
    const S = els.preview.width;
    return sampleAvg(pctx, p.u * S, p.v * S, Math.max(1, Math.round(2 * dpr())));
  };

  // 돋보기: 커서 주변을 크게 확대
  const loupe = document.createElement('div');
  loupe.className = 'loupe';
  loupe.hidden = true;
  const loupeCv = document.createElement('canvas');
  const LOUPE = 120;
  loupeCv.width = loupeCv.height = Math.round(LOUPE * dpr());
  loupe.append(loupeCv);
  els.preview.parentElement.append(loupe);
  function showLoupe(p, hex) {
    if (modal.mode !== 'new' || !modal.img) { loupe.hidden = true; return; }
    const { x, y } = toSrc(p);
    // 원본에서 보여줄 범위: 원 지름의 1/8 (최소 9px) → 작은 눈도 크게
    const span = Math.max(9, Math.round((modal.r * 2) / 8));
    const ctx = loupeCv.getContext('2d');
    const S = loupeCv.width;
    ctx.clearRect(0, 0, S, S);
    ctx.save();
    ctx.beginPath(); ctx.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, S, S);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(modal.img, x - span / 2, y - span / 2, span, span, 0, 0, S, S);
    // 가운데 찍히는 칸 표시
    const cell = S / span;
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2 * dpr();
    ctx.strokeRect(S / 2 - cell * 1.5, S / 2 - cell * 1.5, cell * 3, cell * 3);
    ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.lineWidth = 1 * dpr();
    ctx.strokeRect(S / 2 - cell * 1.5 - dpr(), S / 2 - cell * 1.5 - dpr(), cell * 3 + 2 * dpr(), cell * 3 + 2 * dpr());
    ctx.restore();
    loupe.style.setProperty('--c', hex || 'transparent');
    // 커서 위쪽에 띄우기 (위가 모자라면 아래)
    const wrap = els.preview.parentElement.getBoundingClientRect();
    const px = p.u * wrap.width, py = p.v * wrap.height;
    const above = py - LOUPE - 18 > -wrap.top + 8;
    loupe.style.left = px - LOUPE / 2 + 'px';
    loupe.style.top = (above ? py - LOUPE - 18 : py + 18) + 'px';
    loupe.hidden = false;
  }

  function placeMarks() {
    const wrap = els.preview.parentElement;
    wrap.querySelectorAll('.pick-mark').forEach(m => m.remove());
    const multi = modal.colors.length > 1;
    modal.picks.forEach((p, i) => {
      if (!p) return;
      const m = document.createElement('span');
      m.className = 'pick-mark' + (i === modal.slot ? ' is-active' : '');
      m.style.left = p.u * 100 + '%';
      m.style.top = p.v * 100 + '%';
      m.style.setProperty('--c', paint(modal.colors[i]));
      if (multi) m.textContent = i + 1;
      wrap.append(m);
    });
  }

  function pickAt(p) {
    const hex = sampleAt(p);
    if (!hex) return;
    modal.colors[modal.slot] = hex;
    modal.picks[modal.slot] = p;
    if (modal.slot === 0) modal.manual0 = true;
    refreshColorUI();
  }

  let picking = false;
  els.preview.addEventListener('pointerdown', (e) => {
    const p = previewPoint(e);
    if (!inCircle(p)) return;
    picking = true;
    els.preview.setPointerCapture(e.pointerId);
    pickAt(p);
  });
  els.preview.addEventListener('pointermove', (e) => {
    const p = previewPoint(e);
    const h = inCircle(p) ? sampleAt(p) : null;
    if (h && e.pointerType !== 'touch' || picking) showLoupe(p, h); else loupe.hidden = true;
    if (picking) { if (inCircle(p)) pickAt(p); return; }
    els.hoverText.innerHTML = h ? `<i style="background:${h}"></i>${h.toUpperCase()}` : '';
  });
  const endPick = () => { picking = false; loupe.hidden = true; };
  els.preview.addEventListener('pointerup', endPick);
  els.preview.addEventListener('pointercancel', endPick);
  els.preview.addEventListener('pointerleave', () => { if (!picking) { els.hoverText.textContent = ''; loupe.hidden = true; } });

  els.autoBtn.addEventListener('click', () => {
    modal.manual0 = false;
    modal.picks[0] = null;
    drawPreview();
  });

  /* ---------- 색 슬롯 (여러 색) ---------- */
  function renderSlots() {
    const multi = modal.colors.length > 1;
    const nodes = modal.colors.map((c, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'slot' + (i === modal.slot ? ' is-active' : '');
      b.dataset.i = i;
      b.style.setProperty('--c', paint(c));
      b.title = `색 ${i + 1} · ${colorLabel(c)}`;
      if (multi) {
        b.append(String(i + 1));
        const del = document.createElement('span');
        del.className = 'slot-del';
        del.textContent = '×';
        del.title = '이 색 빼기';
        b.append(del);
      }
      return b;
    });
    if (modal.colors.length < MAX_COLORS) {
      const add = document.createElement('button');
      add.type = 'button';
      add.className = 'slot-add';
      add.textContent = '+';
      add.title = '색 추가';
      nodes.push(add);
    }
    els.colorSlots.replaceChildren(...nodes);
  }

  els.colorSlots.addEventListener('click', (e) => {
    if (e.target.closest('.slot-add')) {
      modal.colors.push(curColor());
      modal.picks.push(null);
      modal.slot = modal.colors.length - 1;
      refreshColorUI();
      return;
    }
    const slot = e.target.closest('.slot');
    if (!slot) return;
    const i = Number(slot.dataset.i);
    if (e.target.closest('.slot-del')) {
      modal.colors.splice(i, 1);
      modal.picks.splice(i, 1);
      if (i === 0) modal.manual0 = true;   // 남은 첫 색은 자동 추출로 덮어쓰지 않음
      if (modal.slot >= modal.colors.length || modal.slot > i) modal.slot = Math.max(0, modal.slot - 1);
    } else {
      modal.slot = i;
    }
    refreshColorUI();
  });

  /* ---------- 색 & 분류 ---------- */
  const autoCat = () => autoCatFor(modal.colors, modal.board);
  const currentCat = () => (modal.manualCat ? modal.cat : autoCat());

  function refreshColorUI(from) {
    const hex = curColor();
    els.swatch.style.background = paint(hex);
    if (from !== 'input') {
      els.hexInput.value = colorLabel(hex);
      els.hexInput.classList.remove('is-invalid');
    }
    if (from !== 'picker' && hex !== NONE) els.colorPicker.value = hex;
    els.noneBtn.classList.toggle('is-on', hex === NONE);
    els.autoBtn.hidden = !(modal.slot === 0 && modal.manual0);
    renderSlots();
    placeMarks();
    renderCatGrid();
  }

  // 컬러코드 직접 입력 (#RGB, #RRGGBB, # 생략 가능)
  function parseHex(v) {
    let t = String(v).trim().replace(/^#/, '');
    if (/^[0-9a-f]{3}$/i.test(t)) t = t.split('').map(c => c + c).join('');
    return /^[0-9a-f]{6}$/i.test(t) ? '#' + t.toLowerCase() : null;
  }
  function setManualColor(hex, from) {
    modal.colors[modal.slot] = hex;
    modal.picks[modal.slot] = null;
    if (modal.slot === 0) modal.manual0 = true;
    refreshColorUI(from);
  }
  els.hexInput.addEventListener('input', () => {
    const hex = parseHex(els.hexInput.value);
    els.hexInput.classList.toggle('is-invalid', !hex && els.hexInput.value.replace('#', '').length >= 3);
    if (hex) {
      els.hexInput.classList.remove('is-invalid');
      setManualColor(hex, 'input');
    }
  });
  els.hexInput.addEventListener('focus', () => els.hexInput.select());
  els.hexInput.addEventListener('blur', () => {
    els.hexInput.value = colorLabel(curColor());
    els.hexInput.classList.remove('is-invalid');
  });
  els.colorPicker.addEventListener('input', () => setManualColor(els.colorPicker.value, 'picker'));
  els.noneBtn.addEventListener('click', () => setManualColor(NONE));

  function renderCatGrid() {
    const auto = autoCat();
    const active = currentCat();
    els.slotsHint.textContent = `2개 이상이면 ${CAT[multiCatFor(modal.board)].label}${multiCatFor(modal.board) === 'twotone' ? '으로' : '로'} 분류`;
    els.catGrid.replaceChildren(...catsFor(modal.board).map(c => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'cat-btn ' + c.key + (c.key === active ? ' is-active' : '');
      b.dataset.cat = c.key;
      const t = document.createElement('span');
      t.textContent = c.label;
      b.append(chipEl(c), t);
      if (c.key === auto) {
        const em = document.createElement('em');
        em.textContent = '자동';
        b.append(em);
      }
      return b;
    }));
  }
  els.catGrid.addEventListener('click', (e) => {
    const b = e.target.closest('.cat-btn');
    if (!b) return;
    const key = b.dataset.cat;
    if (key === autoCat()) modal.manualCat = false;
    else { modal.manualCat = true; modal.cat = key; }
    renderCatGrid();
  });

  /* ---------- 저장 / 건너뛰기 / 삭제 / 닫기 ---------- */
  // 같은 사진으로 눈색 단계로 넘어가기
  // 이 캐릭터에 이미 입력된 값이 있으면 그대로 채워서 시작 (사진을 바꿔도 리셋하지 않음)
  function loadStepValues() {
    const ex = state.items.find(i => i.charId === modal.charId && i.board === modal.board);
    if (ex) {
      modal.colors = itemColors(ex).slice();
      modal.picks = modal.colors.map(() => null);
      modal.slot = 0;
      modal.manual0 = true;
      modal.manualCat = !ex.auto;
      modal.cat = ex.cat;
    } else {
      Object.assign(modal, { colors: ['#888888'], picks: [null], slot: 0, manual0: false, manualCat: false, cat: null });
    }
  }

  // 이미지 고정 모드: 원 위치는 앞 단계에서 확정, 이번 단계는 스포이드만 (미리보기를 크게)
  const PREVIEW_LOCKED = 300;
  const isNarrow = () => window.innerWidth <= 760;
  const isTouch = () => window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  function previewSize() {
    if (modal.locked) return Math.min(PREVIEW_LOCKED, window.innerWidth - 64);
    return isNarrow() ? 132 : PREVIEW_CSS;
  }
  function setLocked(v) {
    modal.locked = !!v;
    els.sheet.classList.toggle('is-locked', modal.locked);
    const css = previewSize();
    const wrap = els.preview.parentElement;
    wrap.style.width = wrap.style.height = css + 'px';
    els.preview.width = els.preview.height = Math.round(css * dpr());
    els.previewHint.textContent = modal.locked
      ? (isNarrow() ? '사진은 앞 단계 그대로 · 스포이드로 색만 찍습니다' : '사진 위치는 앞 단계에서 정한 그대로입니다 · 스포이드로 색만 찍습니다')
      : '원 안을 누르면 스포이드로 색을 찍습니다';
    els.stageHint.textContent = isTouch() ? '한 손가락으로 이동 · 두 손가락으로 크기' : '드래그로 위치 이동 · 휠/슬라이더로 크기';
    syncCropButtons();
    if (!modal.locked) layoutStage();
  }
  const cropOf = () => ({ x: modal.cx / modal.iw, y: modal.cy / modal.ih, r: modal.r / Math.min(modal.iw, modal.ih) });
  function applyCrop(c) {
    const m = Math.min(modal.iw, modal.ih);
    modal.cx = c.x * modal.iw; modal.cy = c.y * modal.ih; modal.r = c.r * m;
    clampCircle();
  }

  function goToStep(board, msg, lock) {
    modal.board = board;
    if (!lock) Object.assign(modal, { r: Math.min(modal.iw, modal.ih) / 2, cx: modal.iw / 2, cy: modal.ih / 2 });
    setLocked(lock);
    loadStepValues();
    els.title.textContent = stepTitle();
    syncRange();
    refreshColorUI();
    updateSub();
    redraw();
    if (msg) toast(msg);
  }
  function goToEyeStep(savedHair) {
    // 머리색에서 원을 확정했으면 눈색은 같은 사진 그대로, 스포이드만
    goToStep('eye', savedHair ? '머리색을 저장했습니다. 같은 사진에서 눈색을 찍어 주십시오' : '', savedHair);
  }

  function makeThumb(cx, cy, r) {
    const out = document.createElement('canvas');
    out.width = out.height = THUMB;
    const o = out.getContext('2d');
    o.fillStyle = '#ffffff';
    o.fillRect(0, 0, THUMB, THUMB);
    o.imageSmoothingQuality = 'high';
    drawCrop(o, modal.img, modal.iw, modal.ih, cx, cy, r, THUMB);
    return out.toDataURL('image/jpeg', 0.86);
  }
  function storeOriginalOnce() {
    if (modal.hasOriginal) return;
    const cid = modal.charId;
    originalFor(modal.file, modal.img, modal.iw, modal.ih).then(b => { if (b) originals.put(cid, b); });
    modal.hasOriginal = true;
  }

  // 사진을 바꾸는 중에 '이대로 마치기': 남은 쪽은 기존 색을 그대로 두고, 썸네일만 새 사진 가운데로
  function finishChange() {
    storeOriginalOnce();
    if (modal.board === 'hair') {
      const eye = state.items.find(i => i.charId === modal.charId && i.board === 'eye');
      if (eye) { eye.img = makeThumb(modal.cx, modal.cy, modal.r); eye.crop = cropOf(); }
    }
    save();
    render();
    queueDone++;
    releaseImage();
    nextInQueue();
  }

  function onSaveStepOnly() {
    const keepFlow = modal.flow;
    modal.flow = 'single';            // 다음 단계로 넘어가지 않게 잠깐 바꿔서 저장만
    modal._noAdvance = true;
    onSave();
    modal._noAdvance = false;
    modal.flow = keepFlow;
  }

  function onSave() {
    if (!modal.open) return;
    if (modal.mode === 'new') {
      storeOriginalOnce();
      // 이번에 정한 원 위치를 기억 → 다음 사진에서 '이전과 같게'
      if (!modal.locked) state.lastCrop = { ...cropOf(), iw: modal.iw, ih: modal.ih };
      const name = els.nameInput.value.trim();
      const data = {
        cat: currentCat(),
        auto: !modal.manualCat,
        color: modal.colors[0],
        colors: modal.colors.slice(),
        name,
        img: makeThumb(modal.cx, modal.cy, modal.r),
        crop: cropOf(),
      };
      let it = state.items.find(i => i.charId === modal.charId && i.board === modal.board);
      if (it) Object.assign(it, data);           // 다시 찍기 → 기존 카드 갱신 (순서 유지)
      else {
        it = { id: uid(), charId: modal.charId, board: modal.board, ...data, order: ++state.seq, created: Date.now() };
        state.items.push(it);
      }
      if (name) syncName(it.charId, name, it.id);
      for (const o of state.items) if (o.charId === it.charId) { o.img = it.img; o.crop = it.crop; }   // 한 캐릭터 = 사진 하나
      save();
      render(it.id);
      if (modal._noAdvance) return;

      if (firstStep()) { goToEyeStep(true); return; }
      queueDone++;
      releaseImage();
      nextInQueue();
    } else {
      const it = modal.item;
      it.color = modal.colors[0];
      it.colors = modal.colors.slice();
      it.cat = currentCat();
      it.auto = !modal.manualCat;
      it.name = els.nameInput.value.trim();
      syncName(it.charId, it.name, it.id);
      save();
      closeModal();
      render(it.id);
    }
  }

  function onSkip() {
    if (modal.change) {
      // 지금 단계의 원 위치·색을 저장하고 마침 (남은 쪽은 기존 값 유지). 원래 없던 쪽은 새로 만들지 않음
      if (hasChar(modal.charId, modal.board)) onSaveStepOnly();
      finishChange();
      return;
    }
    if (firstStep()) { goToEyeStep(false); return; }
    queueDone++;
    releaseImage();
    nextInQueue();
  }

  function onClose() {
    // 사진 바꾸기 중 눈색 단계에서 닫으면: 머리색은 이미 바뀌었으니 눈색은 기존 값 유지로 마무리
    if (modal.mode === 'new' && modal.change && modal.board === 'eye') {
      const eye = state.items.find(i => i.charId === modal.charId && i.board === 'eye');
      if (eye) { eye.img = makeThumb(modal.cx, modal.cy, modal.r); eye.crop = cropOf(); }
      save(); render();
    }
    if (modal.mode === 'new') {
      const left = queue.length;
      queue.length = 0;
      queueTotal = queueDone = 0;
      closeModal();
      if (left) toast(`남은 ${left}명은 추가하지 않았습니다`);
    } else {
      closeModal();
    }
  }

  function onDelete() {
    if (modal.mode !== 'edit') return;
    if (!armDanger(els.deleteBtn)) return;
    const cid = modal.item.charId;
    state.items = state.items.filter(i => i.id !== modal.item.id);
    if (!state.items.some(i => i.charId === cid)) originals.del(cid);
    save();
    closeModal();
    render();
  }

  els.saveBtn.addEventListener('click', () => onSave());
  els.skipBtn.addEventListener('click', onSkip);
  els.close.addEventListener('click', onClose);
  els.deleteBtn.addEventListener('click', onDelete);
  els.modal.addEventListener('pointerdown', (e) => { if (e.target === els.modal) onClose(); });

  document.addEventListener('keydown', (e) => {
    if (!els.picker.hidden && e.key === 'Escape') { e.preventDefault(); closePicker(); return; }
    if (!els.snapModal.hidden && e.key === 'Escape') { e.preventDefault(); closeSnap(); return; }
    if (ed.open) {
      if (e.key === 'Escape') { e.preventDefault(); saveEditor(); }
      else if (e.key === 'Enter' && !e.isComposing && e.target.tagName === 'INPUT' && e.target.type === 'text') { e.preventDefault(); saveEditor(); }
      return;
    }
    if (!modal.open) return;
    if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    else if (e.key === 'Enter' && !e.isComposing && e.target.tagName !== 'BUTTON') { e.preventDefault(); onSave(); }
  });

  let lastW = window.innerWidth;
  window.addEventListener('resize', () => {
    if (!modal.open || modal.mode !== 'new') return;
    if (window.innerWidth === lastW && isNarrow()) return;   // 폰 주소창이 접히는 높이 변화는 무시
    lastW = window.innerWidth;
    setLocked(modal.locked);
    redraw();
  });

  // 이름 받침에 따라 을/를 (한글이 아니면 을(를))
  function eulReul(word) {
    const ch = word.charCodeAt(word.length - 1);
    if (ch >= 0xac00 && ch <= 0xd7a3) return (ch - 0xac00) % 28 ? '을' : '를';
    return '을(를)';
  }

  // 한 번 누르면 '한 번 더 누르면 삭제됩니다'로 바뀌고, 4초 안에 다시 누르면 실행
  function armDanger(btn, label) {
    if (btn.dataset.armed === '1') { disarm(btn); return true; }
    btn.dataset.armed = '1';
    btn.dataset.label = btn.textContent;
    btn.textContent = label || '한 번 더 누르면 삭제됩니다';
    btn.classList.add('is-armed');
    clearTimeout(btn._armT);
    btn._armT = setTimeout(() => disarm(btn), 4000);
    return false;
  }
  function disarm(btn) {
    if (btn.dataset.armed !== '1') return;
    clearTimeout(btn._armT);
    btn.dataset.armed = '';
    btn.textContent = btn.dataset.label;
    btn.classList.remove('is-armed');
  }

  /* =========================================================
     캐릭터 편집 (세로형: 사진 → 머리색 → 눈색 → 테마색 → 그 외)
     ========================================================= */
  const ed = { open: false, charId: null, sides: {}, extras: [], target: null, src: null, rowEls: {} };
  const EDIT_PREVIEW = 240;
  const sideAutoCat = (sd) => autoCatFor(sd.colors, sd.board);
  const sideCat = (sd) => sd.cat || sideAutoCat(sd);
  const sideOn = (sd) => (sd.item ? !sd.removed : sd.added);

  async function openCharEditor(charId) {
    const items = state.items.filter(i => i.charId === charId);
    if (!items.length) return;
    disarm(els.charDelete);
    Object.assign(ed, { open: true, charId, sides: {}, target: null, src: null, rowEls: {} });
    for (const b of BOARDS) {
      const it = items.find(i => i.board === b.key) || null;
      ed.sides[b.key] = {
        board: b.key, item: it, removed: false, added: false,
        colors: it ? itemColors(it).slice() : ['#888888'], slot: 0,
        cat: it && !it.auto ? it.cat : '',
      };
    }
    ed.extras = charData(charId).extras.map(x => ({ ...x }));
    const first = BOARDS.find(b => sideOn(ed.sides[b.key]));
    ed.target = first ? { kind: 'side', board: first.key } : null;
    els.charName.value = (items.find(i => i.name) || {}).name || '';
    els.charNameField.hidden = !state.showNames;
    renderRows();
    els.charModal.hidden = false;
    document.body.classList.add('modal-open');
    els.charModal.querySelector('.char-body').scrollTop = 0;
    clearCanvas();
    loadEditorSource(charId, items);
  }

  // 편집창 사진: 원본이 있으면 원본에서 그 캐릭터 크롭 그대로, 없으면 썸네일
  async function loadEditorSource(charId, items) {
    let src = null;
    const withCrop = items.find(i => i.crop);
    if (withCrop) {
      const blob = await originals.get(charId);
      if (blob) {
        try {
          const img = await loadImage(blob);
          const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height, m = Math.min(iw, ih);
          src = { img, iw, ih, cx: withCrop.crop.x * iw, cy: withCrop.crop.y * ih, r: withCrop.crop.r * m };
        } catch (e) { src = null; }
      }
    }
    if (!src) {
      const img = await new Promise(res => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = items[0].img; });
      if (img) { const w = img.naturalWidth || 160; src = { img, iw: w, ih: w, cx: w / 2, cy: w / 2, r: w / 2 }; }
    }
    if (!ed.open || ed.charId !== charId) { if (src && src.img.close) src.img.close(); return; }
    ed.src = src;
    drawEditorPhoto();
  }

  function clearCanvas() {
    const cv = els.charCanvas;
    cv.width = cv.height = Math.round(EDIT_PREVIEW * dpr());
    cv.getContext('2d').clearRect(0, 0, cv.width, cv.height);
  }
  function drawEditorPhoto() {
    const cv = els.charCanvas, src = ed.src;
    if (!src) return;
    const S = cv.width = cv.height = Math.round(EDIT_PREVIEW * dpr());
    const ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, S, S);
    ctx.save();
    ctx.beginPath(); ctx.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2); ctx.clip();
    const zoom = S / (src.r * 2);
    ctx.imageSmoothingEnabled = zoom < 1.5;
    ctx.imageSmoothingQuality = 'high';
    cv.classList.toggle('is-pixel', zoom >= 1.5);
    drawCrop(ctx, src.img, src.iw, src.ih, src.cx, src.cy, src.r, S);
    ctx.restore();
  }
  function closeEditor() {
    disarm(els.charDelete);
    ed.open = false;
    if (ed.src && ed.src.img && ed.src.img.close) { try { ed.src.img.close(); } catch (e) { /* 무시 */ } }
    ed.src = null;
    edLoupe.hidden = true;
    els.charModal.hidden = true;
    if (!modal.open && els.picker.hidden && els.snapModal.hidden) document.body.classList.remove('modal-open');
  }

  /* ---------- 사진 스포이드 + 돋보기 ---------- */
  function edSample(p) {
    const s = ed.src;
    if (!s) return null;
    const x = s.cx - s.r + p.u * 2 * s.r, y = s.cy - s.r + p.v * 2 * s.r;
    if (x < 0 || y < 0 || x >= s.iw || y >= s.ih) return null;
    srcCanvas.width = srcCanvas.height = 3;
    srcCtx.clearRect(0, 0, 3, 3);
    srcCtx.imageSmoothingEnabled = false;
    srcCtx.drawImage(s.img, Math.floor(x) - 1, Math.floor(y) - 1, 3, 3, 0, 0, 3, 3);
    return sampleAvg(srcCtx, 1, 1, 1);
  }
  const edLoupe = document.createElement('div');
  edLoupe.className = 'loupe';
  edLoupe.hidden = true;
  const edLoupeCv = document.createElement('canvas');
  edLoupeCv.width = edLoupeCv.height = Math.round(120 * dpr());
  edLoupe.append(edLoupeCv);
  els.charCanvas.parentElement.append(edLoupe);
  function edShowLoupe(p, hex) {
    const s = ed.src;
    if (!s) return;
    const x = s.cx - s.r + p.u * 2 * s.r, y = s.cy - s.r + p.v * 2 * s.r;
    const span = Math.max(9, Math.round((s.r * 2) / 8));
    const ctx = edLoupeCv.getContext('2d'), S = edLoupeCv.width;
    ctx.clearRect(0, 0, S, S);
    ctx.save();
    ctx.beginPath(); ctx.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, S, S);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(s.img, x - span / 2, y - span / 2, span, span, 0, 0, S, S);
    const cell = S / span;
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2 * dpr();
    ctx.strokeRect(S / 2 - cell * 1.5, S / 2 - cell * 1.5, cell * 3, cell * 3);
    ctx.restore();
    edLoupe.style.setProperty('--c', hex || 'transparent');
    const w = els.charCanvas.getBoundingClientRect();
    const px = p.u * w.width, py = p.v * w.height;
    edLoupe.style.left = px - 60 + 'px';
    edLoupe.style.top = (py > 140 ? py - 138 : py + 18) + 'px';
    edLoupe.hidden = false;
  }
  {
    const cv = els.charCanvas;
    let down = false;
    const pt = (e) => { const r = cv.getBoundingClientRect(); return { u: (e.clientX - r.left) / r.width, v: (e.clientY - r.top) / r.height }; };
    cv.addEventListener('pointerdown', (e) => {
      const p = pt(e);
      if (!inCircle(p) || !ed.src) return;
      if (!ed.target) { toast('먼저 아래에서 색을 넣을 칸을 골라 주십시오'); return; }
      down = true; cv.setPointerCapture(e.pointerId);
      const h = edSample(p); if (h) setTargetColor(h);
      edShowLoupe(p, h);
    });
    cv.addEventListener('pointermove', (e) => {
      const p = pt(e);
      const h = inCircle(p) ? edSample(p) : null;
      if (down) { if (h) setTargetColor(h); edShowLoupe(p, h); return; }
      if (h && e.pointerType !== 'touch') edShowLoupe(p, h); else edLoupe.hidden = true;
    });
    const up = () => { down = false; edLoupe.hidden = true; };
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);
    cv.addEventListener('pointerleave', () => { if (!down) edLoupe.hidden = true; });
  }

  /* ---------- 색 줄 그리기 ---------- */
  const isTarget = (t) => ed.target && t && ed.target.kind === t.kind &&
    (t.kind === 'side' ? ed.target.board === t.board : ed.target.index === t.index);

  function makeHexRow(color, label) {
    const sw = document.createElement('label');
    sw.className = 'swatch';
    sw.title = '색 고르기';
    const picker = document.createElement('input');
    picker.type = 'color';
    picker.setAttribute('aria-label', `${label} 색 고르기`);
    sw.append(picker);
    const hex = document.createElement('input');
    hex.type = 'text'; hex.className = 'hex-input'; hex.maxLength = 7; hex.spellcheck = false;
    hex.autocomplete = 'off'; hex.placeholder = '#RRGGBB';
    hex.setAttribute('aria-label', `${label} 컬러코드`);
    return { sw, picker, hex };
  }

  function renderRows() {
    ed.rowEls = {};
    const nodes = [];
    for (const b of BOARDS) {
      const sd = ed.sides[b.key];
      const row = document.createElement('section');
      row.className = 'crow';
      row.dataset.key = b.key;
      const head = document.createElement('div');
      head.className = 'crow-head';
      const title = document.createElement('strong');
      title.textContent = b.label;
      head.append(title);
      row.append(head);
      if (!sideOn(sd)) {
        row.classList.add('is-empty');
        const add = document.createElement('button');
        add.type = 'button'; add.className = 'crow-add'; add.dataset.act = 'add';
        add.textContent = `+ ${b.label} 추가`;
        head.append(add);
        nodes.push(row);
        continue;
      }
      const sp = document.createElement('span'); sp.className = 'spacer';
      const sel = document.createElement('select');
      sel.className = 'crow-cat';
      sel.setAttribute('aria-label', `${b.label} 분류`);
      const x = document.createElement('button');
      x.type = 'button'; x.className = 'crow-x'; x.dataset.act = 'remove';
      x.title = `${b.label} 지우기`; x.textContent = '×';
      head.append(sp, sel, x);

      const body = document.createElement('div');
      body.className = 'crow-body';
      const slots = document.createElement('div');
      slots.className = 'color-slots';
      const line = document.createElement('div');
      line.className = 'crow-hex';
      const { sw, picker, hex } = makeHexRow(sd.colors[sd.slot], b.label);
      const none = document.createElement('button');
      none.type = 'button'; none.className = 'none-btn'; none.dataset.act = 'none';
      none.title = '없음 (투명)'; none.textContent = '없음';
      line.append(sw, hex, none);
      body.append(slots, line);
      row.append(body);
      ed.rowEls[b.key] = { row, sel, slots, sw, picker, hex, none };
      nodes.push(row);
    }

    // 그 외: 컬러코드 + 메모, 개수 자유
    const ex = document.createElement('section');
    ex.className = 'crow';
    ex.dataset.key = 'extras';
    const head = document.createElement('div');
    head.className = 'crow-head';
    const title = document.createElement('strong');
    title.textContent = '그 외';
    const sp = document.createElement('span'); sp.className = 'spacer';
    const plus = document.createElement('button');
    plus.type = 'button'; plus.className = 'crow-plus'; plus.dataset.act = 'extra-add';
    plus.title = '그 외 색 추가'; plus.textContent = '+';
    head.append(title, sp, plus);
    ex.append(head);
    if (!ed.extras.length) {
      const p = document.createElement('p');
      p.className = 'crow-empty-hint';
      p.textContent = '+로 컬러코드를 추가';
      ex.append(p);
    } else {
      const list = document.createElement('div');
      list.className = 'extra-list';
      ed.extras.forEach((x, i) => {
        const r = document.createElement('div');
        r.className = 'extra-row';
        r.dataset.i = i;
        const { sw, picker, hex } = makeHexRow(x.color, `그 외 ${i + 1}`);
        const memo = document.createElement('input');
        memo.type = 'text'; memo.className = 'memo-input'; memo.maxLength = 40;
        memo.placeholder = '메모 (예: 리본, 하이라이트)'; memo.value = x.memo || '';
        memo.setAttribute('aria-label', `그 외 ${i + 1} 메모`);
        const minus = document.createElement('button');
        minus.type = 'button'; minus.className = 'crow-minus'; minus.dataset.act = 'extra-del';
        minus.title = '이 색 빼기'; minus.textContent = '−';
        r.append(sw, hex, memo, minus);
        list.append(r);
        ed.rowEls['x' + i] = { row: r, sw, picker, hex };
      });
      ex.append(list);
    }
    nodes.push(ex);
    els.charRows.replaceChildren(...nodes);
    for (const b of BOARDS) if (ed.rowEls[b.key]) paintSide(b.key);
    ed.extras.forEach((_, i) => paintExtra(i));
    paintTargets();
  }

  function paintTargets() {
    for (const b of BOARDS) {
      const el = els.charRows.querySelector(`.crow[data-key="${b.key}"]`);
      if (el) el.classList.toggle('is-target', isTarget({ kind: 'side', board: b.key }));
    }
    els.charRows.querySelectorAll('.extra-row').forEach(r => {
      r.classList.toggle('is-target', isTarget({ kind: 'extra', index: Number(r.dataset.i) }));
    });
    const t = ed.target;
    els.charHint.textContent = !t ? '아래에서 색을 넣을 칸을 고르면 사진에서 스포이드로 찍을 수 있습니다'
      : t.kind === 'side' ? `사진을 누르면 ${boardLabel(t.board)}${ed.sides[t.board].colors.length > 1 ? ` ${ed.sides[t.board].slot + 1}번` : ''}에 색이 들어갑니다`
      : `사진을 누르면 그 외 ${t.index + 1}번에 색이 들어갑니다`;
  }

  function paintHex(r, color, from) {
    r.sw.style.background = paint(color);
    if (from !== 'input') { r.hex.value = colorLabel(color); r.hex.classList.remove('is-invalid'); }
    if (from !== 'picker' && color !== NONE) r.picker.value = color;
  }
  function paintSide(board, from) {
    const sd = ed.sides[board], r = ed.rowEls[board];
    if (!r) return;
    paintHex(r, sd.colors[sd.slot], from);
    r.none.classList.toggle('is-on', sd.colors[sd.slot] === NONE);
    const multi = sd.colors.length > 1;
    const nodes = sd.colors.map((c, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'slot' + (i === sd.slot ? ' is-active' : '');
      b.dataset.i = i;
      b.style.setProperty('--c', paint(c));
      b.title = `색 ${i + 1} · ${colorLabel(c)}`;
      if (multi) {
        b.append(String(i + 1));
        const del = document.createElement('span');
        del.className = 'slot-del'; del.textContent = '×';
        b.append(del);
      }
      return b;
    });
    if (sd.colors.length < MAX_COLORS) {
      const add = document.createElement('button');
      add.type = 'button'; add.className = 'slot-add'; add.textContent = '+'; add.title = '색 추가';
      nodes.push(add);
    }
    r.slots.replaceChildren(...nodes);
    const auto = sideAutoCat(sd);
    const opts = [new Option(`자동 · ${CAT[auto].label}`, '')];
    for (const c of catsFor(board)) opts.push(new Option(c.label, c.key));
    r.sel.replaceChildren(...opts);
    r.sel.value = sd.cat;
  }
  function paintExtra(i, from) {
    const r = ed.rowEls['x' + i];
    if (r) paintHex(r, ed.extras[i].color, from);
  }

  function setTargetColor(hex, from) {
    const t = ed.target;
    if (!t) return;
    if (t.kind === 'side') {
      const sd = ed.sides[t.board];
      sd.colors[sd.slot] = hex;
      paintSide(t.board, from);
    } else if (ed.extras[t.index]) {
      ed.extras[t.index].color = hex;
      paintExtra(t.index, from);
    }
    paintTargets();
  }
  function setTarget(t) { ed.target = t; paintTargets(); }

  // 줄 안 어디를 눌러도 그 줄이 스포이드 대상
  els.charRows.addEventListener('pointerdown', (e) => {
    const xr = e.target.closest('.extra-row');
    if (xr) { setTarget({ kind: 'extra', index: Number(xr.dataset.i) }); return; }
    const row = e.target.closest('.crow');
    if (row && row.dataset.key !== 'extras' && sideOn(ed.sides[row.dataset.key])) setTarget({ kind: 'side', board: row.dataset.key });
  });
  els.charRows.addEventListener('click', (e) => {
    const row = e.target.closest('.crow');
    if (!row) return;
    const key = row.dataset.key;
    const act = e.target.closest('[data-act]');
    const a = act && act.dataset.act;
    if (key === 'extras') {
      if (a === 'extra-add') {
        ed.extras.push({ color: '#888888', memo: '' });
        ed.target = { kind: 'extra', index: ed.extras.length - 1 };
        renderRows();
        const r = ed.rowEls['x' + (ed.extras.length - 1)];
        if (r) r.hex.focus();
      } else if (a === 'extra-del') {
        const i = Number(e.target.closest('.extra-row').dataset.i);
        ed.extras.splice(i, 1);
        if (ed.target && ed.target.kind === 'extra') {
          if (ed.target.index === i) ed.target = null;
          else if (ed.target.index > i) ed.target.index--;
        }
        renderRows();
      }
      return;
    }
    const sd = ed.sides[key];
    if (a === 'add') {
      if (sd.item) sd.removed = false; else sd.added = true;
      if (!sd.item) { sd.colors = [ed.src ? dominantOfEditor() : '#888888']; sd.slot = 0; sd.cat = ''; }
      ed.target = { kind: 'side', board: key };
      renderRows();
      toast(`사진을 눌러 ${boardLabel(key)}을 찍어 주십시오`);
    } else if (a === 'remove') {
      if (sd.item) sd.removed = true; else sd.added = false;
      if (isTarget({ kind: 'side', board: key })) ed.target = null;
      renderRows();
    } else if (a === 'none') {
      ed.target = { kind: 'side', board: key };
      setTargetColor(NONE);
    } else if (e.target.closest('.slot-add')) {
      sd.colors.push(sd.colors[sd.slot]);
      sd.slot = sd.colors.length - 1;
      paintSide(key); paintTargets();
    } else if (e.target.closest('.slot')) {
      const i = Number(e.target.closest('.slot').dataset.i);
      if (e.target.closest('.slot-del')) {
        sd.colors.splice(i, 1);
        if (sd.slot >= sd.colors.length || sd.slot > i) sd.slot = Math.max(0, sd.slot - 1);
      } else sd.slot = i;
      paintSide(key); paintTargets();
    }
  });
  els.charRows.addEventListener('input', (e) => {
    const t = e.target;
    const xr = t.closest('.extra-row');
    if (t.classList.contains('memo-input') && xr) { ed.extras[Number(xr.dataset.i)].memo = t.value; return; }
    if (t.classList.contains('hex-input')) {
      const h = parseHex(t.value);
      t.classList.toggle('is-invalid', !h && t.value.replace('#', '').length >= 3);
      if (h) setTargetColor(h, 'input');
    } else if (t.type === 'color') {
      setTargetColor(t.value, 'picker');
    }
  });
  els.charRows.addEventListener('focusin', (e) => {
    if (e.target.classList.contains('hex-input')) e.target.select();
  });
  els.charRows.addEventListener('focusout', (e) => {
    const t = e.target;
    if (!t.classList.contains('hex-input')) return;
    const xr = t.closest('.extra-row');
    const row = t.closest('.crow');
    const c = xr ? ed.extras[Number(xr.dataset.i)].color : (() => { const sd = ed.sides[row.dataset.key]; return sd.colors[sd.slot]; })();
    t.value = colorLabel(c);
    t.classList.remove('is-invalid');
  });
  els.charRows.addEventListener('change', (e) => {
    if (!e.target.classList.contains('crow-cat')) return;
    const key = e.target.closest('.crow').dataset.key;
    ed.sides[key].cat = e.target.value;
    paintSide(key);
  });

  function dominantOfEditor() {
    try { return dominant(els.charCanvas); } catch (e) { return '#888888'; }
  }

  /* ---------- 저장 ---------- */
  function commitEditor() {
    const charId = ed.charId;
    const name = els.charName.value.trim();
    const base = state.items.filter(i => i.charId === charId);
    const thumb = base.length ? base[0].img : null;
    const crop = (base.find(i => i.crop) || {}).crop;
    for (const b of BOARDS) {
      const sd = ed.sides[b.key];
      const data = { colors: sd.colors.slice(), color: sd.colors[0], cat: sideCat(sd), auto: !sd.cat };
      if (sd.item) {
        if (sd.removed) state.items = state.items.filter(i => i.id !== sd.item.id);
        else Object.assign(sd.item, data);
      } else if (sd.added && thumb) {
        state.items.push({ id: uid(), charId, board: b.key, ...data, name, img: thumb, crop, order: ++state.seq, created: Date.now() });
      }
    }
    for (const i of state.items) if (i.charId === charId) i.name = name;
    const extras = ed.extras.map(x => ({ color: x.color, memo: (x.memo || '').trim() }));
    if (extras.length) state.chars[charId] = { extras }; else delete state.chars[charId];
    if (!state.items.some(i => i.charId === charId)) { originals.del(charId); delete state.chars[charId]; }
    save();
  }

  function saveEditor() {
    commitEditor();
    const keep = state.items.find(i => i.charId === ed.charId);
    closeEditor();
    render(keep && keep.id);
  }

  // 사진 바꾸기: 저장 후 머리색 → 눈색 순서로 다시 지정 (입력된 값은 유지)
  function startBothFlow(extra) {
    const charId = ed.charId;
    commitEditor();
    closeEditor();
    render();
    if (!state.items.some(i => i.charId === charId)) return;
    queue.push({ kind: 'char', charId, board: 'hair', flow: 'both', ...extra });
    queueTotal += 1;
    if (!modal.open) nextInQueue(); else updateSub();
  }
  els.charPhotoBtn.addEventListener('click', () => els.charPhotoInput.click());
  els.charPhotoInput.addEventListener('change', () => {
    const f = els.charPhotoInput.files[0];
    els.charPhotoInput.value = '';
    if (f) startBothFlow({ file: f });
  });
  els.charChartBtn.addEventListener('click', makeCharChart);

  els.charSave.addEventListener('click', saveEditor);
  els.charCancel.addEventListener('click', closeEditor);
  // 바깥 클릭·×·Esc로 닫아도 편집 내용은 저장 (버리려면 '취소')
  els.charClose.addEventListener('click', saveEditor);
  els.charModal.addEventListener('pointerdown', (e) => { if (e.target === els.charModal) saveEditor(); });
  els.charDelete.addEventListener('click', () => {
    if (!armDanger(els.charDelete, '한 번 더 누르면 캐릭터가 삭제됩니다')) return;
    const name = els.charName.value.trim();
    state.items = state.items.filter(i => i.charId !== ed.charId);
    delete state.chars[ed.charId];
    originals.del(ed.charId);
    save();
    closeEditor();
    render();
    toast(name ? `‘${name}’${eulReul(name)} 삭제했습니다` : '캐릭터를 삭제했습니다');
  });

  /* =========================================================
     캐릭터 컬러차트 (편집창 → 세로형 이미지)
     ========================================================= */
  async function makeCharChart() {
    if (document.fonts && document.fonts.ready) { try { await document.fonts.load('400 26px "Jua"', '캐릭터'); await document.fonts.ready; } catch (e) { /* 무시 */ } }
    const W = 720, P = 48;
    const name = els.charName.value.trim();
    const rows = BOARDS.filter(b => sideOn(ed.sides[b.key])).map(b => ({ label: b.label, colors: ed.sides[b.key].colors.slice(), cat: sideCat(ed.sides[b.key]) }));
    const extras = ed.extras.slice();
    if (!rows.length && !extras.length) { toast('저장할 색이 아직 없습니다'); return; }

    // 레이아웃: 메인 색(머리·눈·테마)은 한 줄에 칸으로, 그 외는 작은 칩 + 메모 2열
    const PHOTO = 240;
    const n = Math.max(1, rows.length), GAP = 20;
    const colW = (W - P * 2 - GAP * (n - 1)) / n;
    const CHIP = Math.min(96, colW - 24);
    const maxLines = Math.max(1, ...rows.map(r => r.colors.length));
    const mainH = rows.length ? CHIP + 12 + 18 + 6 + maxLines * 21 + 8 : 0;
    const XCOLS = 2, XCHIP = 40, XROW = 58;
    const xLines = Math.ceil(extras.length / XCOLS);
    let H = P + 8 + PHOTO + 28 + (name ? 40 : 0) + 30 + 16 + mainH;
    if (extras.length) H += 24 + 34 + xLines * XROW;
    H += 48 + P;

    const scale = 2;
    const cv = document.createElement('canvas');
    cv.width = W * scale; cv.height = H * scale;
    const ctx = cv.getContext('2d');
    ctx.scale(scale, scale);
    ctx.fillStyle = SNAP.bg; ctx.fillRect(0, 0, W, H);
    rrect(ctx, 20, 20, W - 40, H - 40, 28); ctx.fillStyle = SNAP.surface; ctx.fill();

    // 사진
    let y = P + 8;
    const cx = W / 2, pr = PHOTO / 2;
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, y + pr, pr, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = '#f8f7f4'; ctx.fillRect(cx - pr, y, PHOTO, PHOTO);
    if (ed.src) {
      const off = document.createElement('canvas');
      off.width = off.height = PHOTO * scale;
      const oc = off.getContext('2d');
      oc.imageSmoothingEnabled = (off.width / (ed.src.r * 2)) < 1.5;
      oc.imageSmoothingQuality = 'high';
      drawCrop(oc, ed.src.img, ed.src.iw, ed.src.ih, ed.src.cx, ed.src.cy, ed.src.r, off.width);
      ctx.drawImage(off, cx - pr, y, PHOTO, PHOTO);
    }
    ctx.restore();
    ctx.beginPath(); ctx.arc(cx, y + pr, pr - 0.5, 0, Math.PI * 2); ctx.strokeStyle = SNAP.line; ctx.lineWidth = 1; ctx.stroke();
    y += PHOTO + 28;

    // 이름
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if (name) {
      ctx.font = `400 30px ${SNAP.display}`; ctx.fillStyle = SNAP.ink;
      ctx.fillText(fitText(ctx, name, W - P * 2), cx, y + 14);
      y += 40;
    }
    setFont(ctx, 12, 600); ctx.fillStyle = SNAP.muted;
    ctx.fillText('COLOR CHART', cx, y + 6);
    y += 30;
    ctx.beginPath(); ctx.moveTo(P, y - 8); ctx.lineTo(W - P, y - 8); ctx.strokeStyle = SNAP.line; ctx.lineWidth = 1; ctx.stroke();
    y += 16;

    // 칩: 색이 여러 개면 세로 띠로 나눠 칠하기
    const drawChip = (x, yy, size, cols, radius) => {
      ctx.save();
      rrect(ctx, x, yy, size, size, radius); ctx.clip();
      if (cols.includes(NONE)) { ctx.fillStyle = checker(ctx); ctx.fillRect(x, yy, size, size); }
      const band = size / cols.length;
      cols.forEach((c, k) => {
        if (c === NONE) return;
        ctx.fillStyle = c;
        ctx.fillRect(x + k * band, yy, Math.ceil(band) + (k === cols.length - 1 ? 1 : 0), size);
      });
      ctx.restore();
      rrect(ctx, x + 0.5, yy + 0.5, size - 1, size - 1, radius); ctx.strokeStyle = 'rgba(0,0,0,.1)'; ctx.lineWidth = 1; ctx.stroke();
    };

    // 메인: 색깔 → (머리색) → #컬러코드
    rows.forEach((r, i) => {
      const colX = P + i * (colW + GAP), ccx = colX + colW / 2;
      drawChip(ccx - CHIP / 2, y, CHIP, r.colors, 18);
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      setFont(ctx, 13, 500); ctx.fillStyle = SNAP.muted;
      ctx.fillText(r.label, ccx, y + CHIP + 12);
      setFont(ctx, 16, 700); ctx.fillStyle = SNAP.ink;
      r.colors.forEach((c, k) => ctx.fillText(colorLabel(c), ccx, y + CHIP + 12 + 24 + k * 21));
    });
    y += mainH;

    // 그 외: 작은 칩 + 컬러코드 + 메모
    if (extras.length) {
      y += 8;
      ctx.beginPath(); ctx.moveTo(P, y); ctx.lineTo(W - P, y); ctx.strokeStyle = SNAP.line; ctx.lineWidth = 1; ctx.stroke();
      y += 16;
      ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      setFont(ctx, 13, 700); ctx.fillStyle = SNAP.muted;
      ctx.fillText('그 외', P, y);
      y += 34;
      const xColW = (W - P * 2 - GAP) / XCOLS;
      extras.forEach((x, k) => {
        const col = k % XCOLS, line = Math.floor(k / XCOLS);
        const ex = P + col * (xColW + GAP), ey = y + line * XROW;
        drawChip(ex, ey, XCHIP, [x.color], 10);
        ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        if (x.memo) {
          setFont(ctx, 15, 700); ctx.fillStyle = SNAP.ink;
          ctx.fillText(colorLabel(x.color), ex + XCHIP + 12, ey + 11);
          setFont(ctx, 12.5, 400); ctx.fillStyle = SNAP.muted;
          ctx.fillText(fitText(ctx, x.memo, xColW - XCHIP - 16), ex + XCHIP + 12, ey + 30);
        } else {
          setFont(ctx, 15, 700); ctx.fillStyle = SNAP.ink;
          ctx.fillText(colorLabel(x.color), ex + XCHIP + 12, ey + XCHIP / 2);
        }
      });
      y += xLines * XROW;
    }

    // 꼬리말
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    setFont(ctx, 11, 500); ctx.fillStyle = SNAP.muted;
    ctx.fillText(`캐릭터 컬러 정리함 · ${todayStr()}`, cx, H - P + 4);

    const stamp = todayStr().replace(/\./g, '');
    showSnapCanvas(cv, '컬러차트', `${name || '캐릭터'} · ${W * scale}×${H * scale}px`, `캐릭터컬러정리함-${(name || '캐릭터').replace(/\s+/g, '')}-컬러차트-${stamp}.png`);
  }

  /* =========================================================
     카드 드래그 (마우스: 바로 / 터치: 길게 누르기)
     ========================================================= */
  let drag = null;
  let suppressClick = false;

  els.board.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.name-input') || e.target.closest('.cchip')) return;
    const card = e.target.closest('.card, .char-card');
    if (!card) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    drag = {
      id: card.dataset.id, charId: card.dataset.charId, all: card.classList.contains('char-card'), card, type: e.pointerType,
      sx: e.clientX, sy: e.clientY, x: e.clientX, y: e.clientY,
      started: false, timer: 0, ghost: null, over: null, index: null,
    };
    if (e.pointerType !== 'mouse') {
      drag.timer = setTimeout(() => { if (drag && !drag.started) startDrag(); }, 260);
    }
  });

  window.addEventListener('pointermove', (e) => {
    if (!drag) return;
    drag.x = e.clientX; drag.y = e.clientY;
    if (!drag.started) {
      const dist = Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy);
      if (drag.type === 'mouse') {
        if (dist > 5) startDrag(); else return;
      } else {
        if (dist > 10) { clearTimeout(drag.timer); drag = null; }
        return;
      }
    }
    moveDrag();
  });
  window.addEventListener('pointerup', endDrag);
  window.addEventListener('pointercancel', cancelDrag);
  document.addEventListener('touchmove', (e) => { if (drag && drag.started) e.preventDefault(); }, { passive: false });
  els.board.addEventListener('contextmenu', (e) => { if (e.target.closest('.card')) e.preventDefault(); });

  function startDrag() {
    drag.started = true;
    const r = drag.card.getBoundingClientRect();
    drag.offX = drag.sx - r.left;
    drag.offY = drag.sy - r.top;
    const g = drag.card.cloneNode(true);
    g.classList.add('ghost');
    g.classList.remove('is-new');
    document.body.append(g);
    drag.ghost = g;
    drag.card.classList.add('is-dragging');
    document.body.classList.add('is-dragging-card');
    if (drag.type !== 'mouse' && navigator.vibrate) navigator.vibrate(12);
    moveDrag();
  }

  // 놓을 위치(칸 안 몇 번째) 계산
  const dragCols = () => !drag.all && state.layout === 'cols';
  function dropIndex(row, x, y) {
    const cards = [...row.querySelectorAll(drag.all ? '.char-card' : '.card')].filter(c => c !== drag.card);
    const cols = dragCols();
    for (let i = 0; i < cards.length; i++) {
      const r = cards[i].getBoundingClientRect();
      const before = cols
        ? y < r.top + r.height / 2
        : y < r.bottom && (y < r.top || x < r.left + r.width / 2);
      if (before) return { index: i, cards };
    }
    return { index: cards.length, cards };
  }

  let dropLine = null;
  function showDropLine(cards, index) {
    if (!cards.length) { hideDropLine(); return; }
    if (!dropLine) {
      dropLine = document.createElement('div');
      dropLine.className = 'drop-line';
      document.body.append(dropLine);
    }
    const cols = dragCols();
    const ref = cards[Math.min(index, cards.length - 1)];
    const t = ref.querySelector('.thumb').getBoundingClientRect();
    const after = index >= cards.length;
    dropLine.classList.toggle('is-h', cols);
    if (cols) {
      const yy = after ? t.bottom + 6 : t.top - 6;
      Object.assign(dropLine.style, { left: t.left - 8 + 'px', top: yy - 1.5 + 'px', width: t.width + 16 + 'px', height: '3px' });
    } else {
      const xx = after ? t.right + 6 : t.left - 6;
      Object.assign(dropLine.style, { left: xx - 1.5 + 'px', top: t.top - 4 + 'px', width: '3px', height: t.height + 8 + 'px' });
    }
    dropLine.hidden = false;
  }
  function hideDropLine() { if (dropLine) dropLine.hidden = true; }

  function moveDrag() {
    const { x, y } = drag;
    drag.ghost.style.transform = `translate(${x - drag.offX}px, ${y - drag.offY}px)`;
    const el = document.elementFromPoint(x, y);
    let target = el ? (drag.all ? el.closest('.all-grid') : (el.closest('.row') || el.closest('.tab'))) : null;
    if (target && target.dataset.board === 'all') target = null;
    if (target !== drag.over) {
      if (drag.over) drag.over.classList.remove('is-over');
      if (target) target.classList.add('is-over');
      drag.over = target;
    }
    if (target && (target.classList.contains('row') || target.classList.contains('all-grid'))) {
      const { index, cards } = dropIndex(target, x, y);
      drag.index = index;
      showDropLine(cards, index);
    } else {
      drag.index = null;
      hideDropLine();
    }
    // 화면 가장자리 자동 스크롤
    if (y < 80) window.scrollBy(0, -16);
    else if (y > window.innerHeight - 60) window.scrollBy(0, 16);
    if (dragCols()) {
      const br = els.board.getBoundingClientRect();
      if (x < br.left + 60) els.board.scrollBy(-16, 0);
      else if (x > br.right - 60) els.board.scrollBy(16, 0);
    }
  }

  function cleanupDrag() {
    if (!drag) return;
    clearTimeout(drag.timer);
    if (drag.ghost) drag.ghost.remove();
    if (drag.over) drag.over.classList.remove('is-over');
    drag.card.classList.remove('is-dragging');
    document.body.classList.remove('is-dragging-card');
    hideDropLine();
  }

  // 순서를 1, 2, 3… 으로 다시 매김 (소수점 누적 방지)
  function normalizeOrder() {
    state.items.sort((a, b) => a.order - b.order).forEach((it, i) => { it.order = i + 1; });
    state.seq = state.items.length;
  }

  function endDrag() {
    if (!drag) return;
    if (!drag.started) { cleanupDrag(); drag = null; return; }
    const it = state.items.find(i => i.id === drag.id);
    const over = drag.over;
    const index = drag.index;
    const all = drag.all, charId = drag.charId;
    cleanupDrag();
    drag = null;
    suppressClick = true;
    setTimeout(() => { suppressClick = false; }, 60);

    if (all) {
      // 한눈에 보기: 지금 보이는 순서에서 옮기고 직접 배치로 고정
      if (!over || index == null) return;
      const ids = sortChars(characters()).map(c => c.charId).filter(id => id !== charId);
      ids.splice(Math.min(index, ids.length), 0, charId);
      state.charOrder = ids;
      if (state.sortAll !== 'manual') { state.sortAll = 'manual'; toast('한눈에 보기를 직접 배치로 바꿨습니다'); }
      save();
      render();
      return;
    }
    if (!it || !over) return;

    if (over.classList.contains('row')) {
      const cat = over.dataset.cat;
      const board = state.board;
      if (state.boardSort[board] !== 'manual') {
        if (cat !== it.cat) {
          // 밝기순: 다른 칸으로 옮기면 칸만 바꾸고 위치는 밝기에 맞춰 자동
          it.cat = cat; it.auto = false;
          save(); render(it.id);
          return;
        }
        // 같은 칸 안에서 순서를 바꾸면 → 지금 보이는 순서를 그대로 고정하고 직접 배치로
        boardItems(board).forEach((x, i) => { x.order = i + 1; });
        state.boardSort[board] = 'manual';
        toast(`${boardLabel(board)}을 직접 배치로 바꿨습니다`);
      }
      // 놓은 칸의 카드들(자기 자신 제외) 사이에 끼워 넣기
      const list = state.items
        .filter(i => i.board === board && i.cat === cat && i.id !== it.id)
        .sort((a, b) => a.order - b.order);
      const at = index == null ? list.length : Math.min(index, list.length);
      const prev = list[at - 1], next = list[at];
      if (prev && next) it.order = (prev.order + next.order) / 2;
      else if (prev) it.order = prev.order + 0.5;
      else if (next) it.order = next.order - 0.5;
      if (cat !== it.cat) { it.cat = cat; it.auto = false; }
      normalizeOrder();
      save();
      render(it.id);
    } else if (over.classList.contains('tab')) {
      const board = over.dataset.board;
      if (board !== it.board && hasChar(it.charId, board)) {
        toast(`이 캐릭터는 이미 ${boardLabel(board)}이 있습니다`);
      } else if (board !== it.board) {
        it.board = board;
        it.cat = fixCat(it.cat, board) || 'other';
        save(); render();
        toast(`‘${BOARDS.find(b => b.key === board).label}’ 보드로 옮겼습니다`);
      }
    }
  }
  function cancelDrag() { cleanupDrag(); drag = null; }

  els.board.addEventListener('click', (e) => {
    if (e.target.closest('.name-input')) return;
    const chip = e.target.closest('.cchip');
    if (chip && chipLongPressed) { chipLongPressed = false; return; }   // 꾹 누른 뒤 손 뗀 건 복사 X
    if (chip && !chip.classList.contains('is-empty')) { copyChip(chip); return; }
    const cc = e.target.closest('.char-card');
    if (cc) { openCharEditor(cc.dataset.charId); return; }
    const card = e.target.closest('.card');
    if (!card || suppressClick) return;
    const it = state.items.find(i => i.id === card.dataset.id);
    if (it) openCharEditor(it.charId);
  });

  els.board.addEventListener('keydown', (e) => {
    const input = e.target.closest('.name-input');
    if (input) {
      if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); input.blur(); }
      else if (e.key === 'Escape') {
        const holder = input.closest('.card, .char-card');
        const it = holder.dataset.id ? state.items.find(i => i.id === holder.dataset.id) : state.items.find(i => i.charId === holder.dataset.charId);
        input.value = (it && it.name) || '';
        input.blur();
      }
      return;
    }
    const card = e.target.closest('.card, .char-card');
    if (card && e.target === card && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      const it = card.dataset.id ? state.items.find(i => i.id === card.dataset.id) : null;
      openCharEditor(it ? it.charId : card.dataset.charId);
    }
  });

  // 사진 아래 이름 칸에서 바로 이름 수정
  els.board.addEventListener('change', (e) => {
    const input = e.target.closest('.name-input');
    if (!input) return;
    const cc = input.closest('.char-card');
    if (cc) {
      const name = input.value.trim();
      input.value = name;
      syncName(cc.dataset.charId, name, null);
      save();
      return;
    }
    const card = input.closest('.card');
    const it = state.items.find(i => i.id === card.dataset.id);
    if (!it) return;
    it.name = input.value.trim();
    input.value = it.name;
    card.title = cardTitle(it);
    syncName(it.charId, it.name, it.id);
    save();
  });

  /* ---------- 보기 옵션 ---------- */
  els.layoutSeg.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || b.dataset.layout === state.layout) return;
    state.layout = b.dataset.layout;
    save();
    applyView();
  });
  els.boardSortSeg.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || state.board === 'all' || b.dataset.bsort === state.boardSort[state.board]) return;
    if (b.dataset.bsort === 'manual') boardItems(state.board).forEach((x, i) => { x.order = i + 1; });   // 지금 순서 그대로 시작
    state.boardSort[state.board] = b.dataset.bsort;
    normalizeOrder();
    save();
    render();
  });
  els.sortSeg.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || b.dataset.sort === state.sortAll) return;
    if (b.dataset.sort === 'manual' && !state.charOrder.length) state.charOrder = sortChars(characters()).map(c => c.charId);
    state.sortAll = b.dataset.sort;
    save();
    render();
  });
  els.nameCheck.addEventListener('change', () => {
    state.showNames = els.nameCheck.checked;
    save();
    applyView();
  });
  els.themeCheck.addEventListener('change', () => {
    state.showTheme = els.themeCheck.checked;
    save();
    render();
  });

  /* =========================================================
     탭 / 파일 / 붙여넣기 / 백업
     ========================================================= */
  els.tabs.addEventListener('click', (e) => {
    const t = e.target.closest('.tab');
    if (!t || t.dataset.board === state.board) return;
    state.board = t.dataset.board;
    save();
    render();
  });

  els.fileInput.addEventListener('change', () => {
    addFiles(els.fileInput.files);
    els.fileInput.value = '';
  });

  // 파일을 끌어다 놓을 때: 지금 열린 창에 따라 하는 일이 달라짐
  const dropzoneText = document.querySelector('.dropzone span');
  function dropTarget(el) {
    if (!els.snapModal.hidden || !els.picker.hidden) return { kind: 'none' };
    if (ed.open) return { kind: 'both', el: els.charModal.querySelector('.char-sheet') };
    if (modal.open && modal.mode === 'new') {
      if (modal.locked) return { kind: 'crop', el: els.sheet };
      const stage = el && el.closest && el.closest('#stageWrap');
      return stage ? { kind: 'crop', el: stage } : { kind: 'queue' };
    }
    return { kind: 'queue' };
  }
  let dropHi = null;
  function showDropHint(t) {
    if (dropHi && dropHi !== t.el) dropHi.classList.remove('is-drop');
    dropHi = t.el || null;
    if (dropHi) dropHi.classList.add('is-drop');
    const msg = {
      side: `놓으면 ${boardLabel(t.board)} 사진만 바꿉니다`,
      both: '놓으면 이 캐릭터 사진을 바꿉니다 (입력된 색은 그대로)',
      crop: '놓으면 지금 사진을 바꿉니다',
      queue: '여기에 놓으면 추가됩니다',
      none: '지금은 사진을 넣을 수 없습니다',
    }[t.kind];
    dropzoneText.textContent = msg;
    document.body.classList.toggle('is-drop-local', t.kind === 'both' || t.kind === 'crop');
  }
  function clearDrop() {
    dragDepth = 0;
    document.body.classList.remove('is-dropping', 'is-drop-local');
    if (dropHi) dropHi.classList.remove('is-drop');
    dropHi = null;
  }

  function handleIncomingFiles(files, el) {
    const imgs = [...files].filter(isImageFile);
    if (!imgs.length) return;
    const t = dropTarget(el);
    if (t.kind === 'none') return;
    if (t.kind === 'both') {
      startBothFlow({ file: imgs[0] });
    } else if (t.kind === 'crop') {
      replaceCropImage(imgs[0]);
    } else {
      addFiles(imgs);
    }
  }

  let dragDepth = 0;
  const hasFiles = (e) => [...((e.dataTransfer && e.dataTransfer.types) || [])].includes('Files');
  window.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth++;
    document.body.classList.add('is-dropping');
    showDropHint(dropTarget(e.target));
  });
  window.addEventListener('dragover', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    showDropHint(dropTarget(e.target));
  });
  window.addEventListener('dragleave', (e) => {
    if (!hasFiles(e)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) clearDrop();
  });
  window.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    const el = e.target;
    clearDrop();
    handleIncomingFiles(e.dataTransfer.files, el);
  });

  window.addEventListener('paste', (e) => {
    const files = [...((e.clipboardData && e.clipboardData.files) || [])].filter(f => f.type.startsWith('image/'));
    if (!files.length) return;
    e.preventDefault();
    // 붙여넣기는 커서 위치가 없으니 편집창이면 둘 다, 찍기 창이면 지금 사진 교체
    const t = ed.open ? null : (modal.open && modal.mode === 'new' ? els.stageWrap : null);
    handleIncomingFiles(files, t);
  });

  /* ---------- 전체 초기화 ---------- */
  const resetModal = $('#resetModal');
  function openReset() {
    if (!state.items.length && !Object.keys(state.chars).length) { toast('초기화할 내용이 없습니다'); return; }
    $('#resetCount').textContent = `${characters().length}명`;
    resetModal.hidden = false;
    document.body.classList.add('modal-open');
    $('#resetCancel').focus();
  }
  function closeReset() {
    resetModal.hidden = true;
    if (!modal.open && !ed.open && els.picker.hidden && els.snapModal.hidden) document.body.classList.remove('modal-open');
  }
  $('#resetAllBtn').addEventListener('click', openReset);
  $('#resetClose').addEventListener('click', closeReset);
  $('#resetCancel').addEventListener('click', closeReset);
  resetModal.addEventListener('pointerdown', (e) => { if (e.target === resetModal) closeReset(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !resetModal.hidden) closeReset(); });
  $('#resetBackupBtn').addEventListener('click', () => els.exportBtn.click());
  $('#resetConfirm').addEventListener('click', () => {
    state.items = [];
    state.chars = {};
    state.charOrder = [];
    state.seq = 0;
    state.lastCrop = null;
    originals.clear();
    save();
    closeReset();
    render();
    toast('모든 캐릭터를 삭제했습니다');
  });

  els.exportBtn.addEventListener('click', () => {
    if (!state.items.length) { toast('백업할 카드가 아직 없습니다'); return; }
    const data = { app: 'color-shelf', version: 2, seq: state.seq, items: state.items, chars: state.chars };
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const d = new Date();
    const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
    saveFile(blob, `캐릭터컬러정리함-백업-${stamp}.json`, '백업 파일을 저장했습니다');
  });

  els.importInput.addEventListener('change', async () => {
    const f = els.importInput.files[0];
    els.importInput.value = '';
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      const list = Array.isArray(data.items) ? data.items.slice().sort((a, b) => (a.order || 0) - (b.order || 0)) : [];
      let added = 0;
      for (const raw of list) {
        if (!raw || typeof raw.img !== 'string' || !raw.img.startsWith('data:image/')) continue;
        if (state.items.some(i => i.id === raw.id)) continue;
        const color = raw.color === 'none' ? 'none' : /^#[0-9a-f]{6}$/i.test(raw.color) ? raw.color.toLowerCase() : '#888888';
        state.items.push({
          id: typeof raw.id === 'string' ? raw.id : uid(),
          charId: typeof raw.charId === 'string' ? raw.charId : (typeof raw.id === 'string' ? raw.id : uid()),
          board: BOARDS.some(b => b.key === raw.board) ? raw.board : 'hair',
          cat: fixCat(raw.cat, BOARDS.some(b => b.key === raw.board) ? raw.board : 'hair') || classify(color),
          auto: !!raw.auto,
          color,
          colors: (() => {
            const cs = Array.isArray(raw.colors) ? raw.colors.filter(c => c === 'none' || /^#[0-9a-f]{6}$/i.test(c)).map(c => c.toLowerCase()).slice(0, 5) : [];
            return cs.length ? cs : [color];
          })(),
          name: typeof raw.name === 'string' ? raw.name.slice(0, 80) : '',
          img: raw.img,
          order: ++state.seq,
        });
        added++;
      }
      const inChars = cleanChars(data.chars);
      for (const [id, v] of Object.entries(inChars)) if (!state.chars[id]) state.chars[id] = v;
      save();
      render();
      toast(added ? `${added}개를 불러왔습니다` : '새로 추가할 카드가 없습니다');
    } catch (e) {
      toast('백업 파일을 읽을 수 없습니다');
    }
  });

  /* =========================================================
     다른 보드에서 캐릭터 가져오기
     ========================================================= */
  const pickSel = new Set();

  function openPicker() {
    const from = otherBoard(state.board);
    els.pickerTitle.textContent = `${boardLabel(from)}에서 캐릭터 가져오기`;
    els.pickerSub.textContent = `고른 캐릭터의 원본 사진으로 ${boardLabel(state.board)}을 찍습니다`;
    pickSel.clear();

    // 다른 보드의 캐릭터 (캐릭터당 하나, 그 보드의 순서대로)
    const seen = new Set();
    const chars = state.items
      .filter(i => i.board === from)
      .sort((a, b) => a.order - b.order)
      .filter(i => (seen.has(i.charId) ? false : seen.add(i.charId)));

    if (!chars.length) {
      const e = document.createElement('div');
      e.className = 'picker-empty';
      e.textContent = `${boardLabel(from)} 보드에 아직 카드가 없습니다.`;
      els.pickerGrid.replaceChildren(e);
    } else {
      els.pickerGrid.replaceChildren(...chars.map(it => {
        const done = hasChar(it.charId, state.board);
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'pick-item' + (done ? ' is-done' : '');
        b.dataset.charId = it.charId;
        b.disabled = done;
        const th = document.createElement('span');
        th.className = 'thumb';
        const img = new Image();
        img.src = it.img; img.alt = ''; img.draggable = false;
        th.append(img);
        const ck = document.createElement('span');
        ck.className = 'pick-check';
        ck.textContent = '✓';
        const nm = document.createElement('span');
        nm.className = 'pick-name' + (it.name ? '' : ' is-empty');
        nm.textContent = it.name || '이름 없음';
        b.append(th, nm);
        if (done) {
          const tag = document.createElement('span');
          tag.className = 'pick-tag';
          tag.textContent = '이미 있음';
          b.append(tag);
        } else {
          b.append(ck);
        }
        return b;
      }));
    }
    els.pickerAll.hidden = !chars.some(i => !hasChar(i.charId, state.board));
    updatePickerOk();
    els.picker.hidden = false;
    document.body.classList.add('modal-open');
  }
  function closePicker() {
    els.picker.hidden = true;
    if (!modal.open) document.body.classList.remove('modal-open');
  }
  function updatePickerOk() {
    els.pickerOk.disabled = !pickSel.size;
    els.pickerOk.textContent = pickSel.size ? `${pickSel.size}명 가져오기` : '가져오기';
    const avail = els.pickerGrid.querySelectorAll('.pick-item:not(.is-done)').length;
    els.pickerAll.textContent = avail && pickSel.size === avail ? '선택 해제' : '모두 선택';
  }

  els.linkBtn.addEventListener('click', openPicker);
  els.pickerClose.addEventListener('click', closePicker);
  els.pickerCancel.addEventListener('click', closePicker);
  els.picker.addEventListener('pointerdown', (e) => { if (e.target === els.picker) closePicker(); });
  els.pickerGrid.addEventListener('click', (e) => {
    const b = e.target.closest('.pick-item');
    if (!b || b.disabled) return;
    const id = b.dataset.charId;
    if (pickSel.has(id)) pickSel.delete(id); else pickSel.add(id);
    b.classList.toggle('is-selected', pickSel.has(id));
    updatePickerOk();
  });
  els.pickerAll.addEventListener('click', () => {
    const items = [...els.pickerGrid.querySelectorAll('.pick-item:not(.is-done)')];
    const all = pickSel.size === items.length;
    pickSel.clear();
    for (const b of items) {
      if (!all) pickSel.add(b.dataset.charId);
      b.classList.toggle('is-selected', !all);
    }
    updatePickerOk();
  });
  els.pickerOk.addEventListener('click', () => {
    if (!pickSel.size) return;
    // 가져오기 창에 보이던 순서대로 대기열에 넣기
    const ids = [...els.pickerGrid.querySelectorAll('.pick-item.is-selected')].map(b => b.dataset.charId);
    for (const charId of ids) queue.push({ kind: 'char', charId, board: state.board });
    queueTotal += ids.length;
    closePicker();
    if (!modal.open) nextInQueue();
    else updateSub();
  });

  /* =========================================================
     컬러칩 툴팁 & 복사 (한눈에 보기)
     ========================================================= */
  const tipEl = document.createElement('div');
  tipEl.className = 'tip';
  tipEl.setAttribute('role', 'tooltip');
  tipEl.hidden = true;
  document.body.append(tipEl);
  let tipChip = null;

  function chipItem(chip) {
    const card = chip.closest('.char-card');
    return card && state.items.find(i => i.charId === card.dataset.charId && i.board === chip.dataset.board);
  }

  function showTip(chip) {
    tipChip = chip;
    tipEl.classList.remove('is-text');
    const it = chipItem(chip);
    const board = chip.dataset.board;
    tipEl.replaceChildren();

    const head = document.createElement('div');
    head.className = 'tip-head';
    const label = document.createElement('span');
    label.textContent = boardLabel(board);
    head.append(label);
    if (it) {
      const cat = document.createElement('span');
      cat.className = 'tip-cat';
      cat.textContent = CAT[it.cat] ? CAT[it.cat].label : '';
      head.append(cat);
    }
    tipEl.append(head);

    if (it) {
      const list = document.createElement('div');
      list.className = 'tip-codes';
      for (const c of itemColors(it)) {
        const row = document.createElement('div');
        row.className = 'tip-code';
        const sw = document.createElement('i');
        sw.style.background = paint(c);
        const code = document.createElement('span');
        code.textContent = colorLabel(c);
        row.append(sw, code);
        list.append(row);
      }
      tipEl.append(list);
      const foot = document.createElement('div');
      foot.className = 'tip-foot';
      foot.textContent = itemColors(it).some(c => c !== NONE) ? (isTouch() ? '탭하면 복사' : '클릭해서 복사') : '복사할 코드 없음';
      tipEl.append(foot);
    } else {
      const empty = document.createElement('div');
      empty.className = 'tip-foot';
      empty.textContent = '아직 등록 안 됨';
      tipEl.append(empty);
    }

    tipEl.hidden = false;
    tipEl.classList.remove('is-in');
    placeTip(chip);
    void tipEl.offsetWidth;          // 애니메이션 다시 시작
    tipEl.classList.add('is-in');
  }

  function placeTip(chip) {
    const r = chip.querySelector('i').getBoundingClientRect();
    const w = tipEl.offsetWidth, h = tipEl.offsetHeight;
    let x = r.left + r.width / 2;
    x = clamp(x, w / 2 + 8, window.innerWidth - w / 2 - 8);
    let y = r.top - 10;
    const below = y - h < 8;
    if (below) y = r.bottom + 10;
    tipEl.classList.toggle('is-below', below);
    tipEl.style.left = x + 'px';
    tipEl.style.top = y + 'px';
    tipEl.style.setProperty('--arrow-x', (r.left + r.width / 2 - x) + 'px');
  }

  function hideTip() {
    tipChip = null;
    tipEl.hidden = true;
    tipEl.classList.remove('is-in');
  }

  els.board.addEventListener('pointerover', (e) => {
    if (e.pointerType === 'touch') return;
    const chip = e.target.closest('.cchip');
    if (chip && chip !== tipChip) showTip(chip);
  });
  els.board.addEventListener('pointerout', (e) => {
    const chip = e.target.closest('.cchip');
    if (chip && !chip.contains(e.relatedTarget)) hideTip();
  });
  window.addEventListener('scroll', () => { clearTimeout(pressT); hideTip(); }, { passive: true });

  // 모바일: 컬러칩을 꾹 누르면 컬러코드 보이기 (짧게 탭하면 지금처럼 복사)
  let pressT = 0, pressHideT = 0, pressStart = null, chipLongPressed = false;
  els.board.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse') return;
    const chip = e.target.closest('.cchip');
    if (!chip) return;
    chipLongPressed = false;
    pressStart = { x: e.clientX, y: e.clientY };
    clearTimeout(pressT); clearTimeout(pressHideT);
    pressT = setTimeout(() => {
      chipLongPressed = true;
      showTip(chip);
      if (navigator.vibrate) navigator.vibrate(10);
    }, 380);
  });
  els.board.addEventListener('pointermove', (e) => {
    if (!pressStart || e.pointerType === 'mouse') return;
    if (Math.hypot(e.clientX - pressStart.x, e.clientY - pressStart.y) > 10) { clearTimeout(pressT); pressStart = null; }
  });
  const endPress = (e) => {
    if (e.pointerType === 'mouse') return;
    clearTimeout(pressT);
    pressStart = null;
    // 손을 떼도 잠깐 보여 주고 사라짐
    if (chipLongPressed) pressHideT = setTimeout(hideTip, 2200);
  };
  els.board.addEventListener('pointerup', endPress);
  els.board.addEventListener('pointercancel', endPress);
  els.board.addEventListener('contextmenu', (e) => { if (e.target.closest('.cchip')) e.preventDefault(); });

  let textTipEl = null;
  function showTextTip(el) {
    textTipEl = el;
    tipChip = null;
    tipEl.replaceChildren();
    tipEl.classList.add('is-text');
    tipEl.textContent = el.dataset.tip;
    tipEl.hidden = false;
    tipEl.classList.remove('is-in');
    const r = el.getBoundingClientRect();
    const w = tipEl.offsetWidth, h = tipEl.offsetHeight;
    const x = clamp(r.left + r.width / 2, w / 2 + 8, window.innerWidth - w / 2 - 8);
    let y = r.top - 10;
    const below = y - h < 8;
    if (below) y = r.bottom + 10;
    tipEl.classList.toggle('is-below', below);
    tipEl.style.left = x + 'px';
    tipEl.style.top = y + 'px';
    tipEl.style.setProperty('--arrow-x', (r.left + r.width / 2 - x) + 'px');
    void tipEl.offsetWidth;
    tipEl.classList.add('is-in');
  }
  document.addEventListener('pointerover', (e) => {
    if (e.pointerType === 'touch') return;
    const el = e.target.closest && e.target.closest('[data-tip]');
    if (el && el !== textTipEl) showTextTip(el);
  });
  document.addEventListener('pointerout', (e) => {
    const el = e.target.closest && e.target.closest('[data-tip]');
    if (el && !el.contains(e.relatedTarget)) { textTipEl = null; tipEl.classList.remove('is-text'); hideTip(); }
  });
  document.addEventListener('pointerdown', () => { if (textTipEl) { textTipEl = null; tipEl.classList.remove('is-text'); hideTip(); } });

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      // CodePen 미리보기 등 클립보드 권한이 없을 때
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.append(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (err) { ok = false; }
      ta.remove();
      return ok;
    }
  }

  async function copyChip(chip) {
    const it = chipItem(chip);
    if (!it) return;
    const codes = itemColors(it).filter(c => c !== NONE).map(c => c.toUpperCase());
    if (!codes.length) { toast('‘없음’이라 복사할 컬러코드가 없습니다'); return; }
    const ok = await copyText(codes.join(', '));
    if (!ok) { toast('복사하지 못했습니다. 브라우저 권한을 확인해 주십시오'); return; }
    toast('컬러코드가 복사되었습니다');
    chip.classList.remove('is-copied');
    void chip.offsetWidth;
    chip.classList.add('is-copied');
    if (tipChip === chip) {
      const foot = tipEl.querySelector('.tip-foot');
      if (foot) { foot.textContent = '복사됨 ✓'; foot.classList.add('is-done'); }
    }
  }

  /* =========================================================
     이미지로 저장 (지금 보고 있는 탭을 그대로 PNG로)
     ========================================================= */
  const SNAP = {
    bg: '#f4f4f6', surface: '#ffffff', ink: '#1b1b1f', muted: '#87878f', line: '#e4e4e9',
    display: '"Jua", Pretendard, "Noto Sans KR", sans-serif',
    font: 'Pretendard, "Noto Sans KR", -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", sans-serif',
  };
  const setFont = (ctx, size, weight = 400) => { ctx.font = `${weight} ${size}px ${SNAP.font}`; };

  function rrect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  let checkerPat = null;
  function checker(ctx) {
    if (!checkerPat) {
      const t = document.createElement('canvas');
      t.width = t.height = 8;
      const g = t.getContext('2d');
      g.fillStyle = '#f4f4f4'; g.fillRect(0, 0, 8, 8);
      g.fillStyle = '#d2d2d2'; g.fillRect(0, 0, 4, 4); g.fillRect(4, 4, 4, 4);
      checkerPat = t;
    }
    return ctx.createPattern(checkerPat, 'repeat');
  }

  // 색 원 그리기: single(단색) / split(투톤·오드아이) / blend(Other 섞기)
  function drawSwatch(ctx, cx, cy, r, colors, mode) {
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.clip();
    if (colors.includes(NONE)) { ctx.fillStyle = checker(ctx); ctx.fillRect(cx - r, cy - r, r * 2, r * 2); }
    if (colors.length === 1 || mode === 'single') {
      if (colors[0] !== NONE) { ctx.fillStyle = colors[0]; ctx.fillRect(cx - r, cy - r, r * 2, r * 2); }
    } else if (mode === 'blend') {
      const g = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
      colors.forEach((c, i) => g.addColorStop(i / (colors.length - 1), c === NONE ? 'rgba(255,255,255,0)' : c));
      ctx.fillStyle = g; ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    } else {
      const step = (Math.PI * 2) / colors.length;
      colors.forEach((c, i) => {
        if (c === NONE) return;
        const a0 = Math.PI / 2 + i * step;              // CSS conic 'from 180deg'와 같은 시작점(아래)
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, r + 1, a0, a0 + step); ctx.closePath();
        ctx.fillStyle = c; ctx.fill();
      });
    }
    ctx.restore();
    ctx.beginPath(); ctx.arc(cx, cy, r - 0.5, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(0,0,0,.12)'; ctx.lineWidth = 1; ctx.stroke();
  }
  const itemMode = (it) => (itemColors(it).length === 1 ? 'single' : it.cat === 'other' ? 'blend' : 'split');

  // 칸 이름 앞의 작은 칩
  function drawCatChip(ctx, cx, cy, r, c) {
    const fixed = {
      twotone: [['#e5484d', '#3b9eff'], 'half'],
      oddeye: [['#3b9eff', '#f5b324'], 'half'],
    };
    if (c.key === 'other') {
      ctx.beginPath(); ctx.arc(cx, cy, r - 0.75, 0, Math.PI * 2);
      ctx.strokeStyle = SNAP.muted; ctx.lineWidth = 1.5; ctx.stroke();
      setFont(ctx, r * 1.1, 700); ctx.fillStyle = SNAP.muted; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('?', cx, cy + 0.5);
      return;
    }
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.clip();
    if (fixed[c.key]) {
      const [cols] = fixed[c.key];
      ctx.fillStyle = cols[0]; ctx.fillRect(cx - r, cy - r, r, r * 2);
      ctx.fillStyle = cols[1]; ctx.fillRect(cx, cy - r, r, r * 2);
    } else if (c.key === 'silver') {
      const g = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
      g.addColorStop(0, '#f4f5f7'); g.addColorStop(.48, '#b4b8bf'); g.addColorStop(.52, '#e6e8eb'); g.addColorStop(1, '#a9adb4');
      ctx.fillStyle = g; ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    } else {
      ctx.fillStyle = c.sw; ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    }
    ctx.restore();
    ctx.beginPath(); ctx.arc(cx, cy, r - 0.5, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(0,0,0,.1)'; ctx.lineWidth = 1; ctx.stroke();
  }

  function fitText(ctx, text, maxW) {
    if (ctx.measureText(text).width <= maxW) return text;
    let t = text;
    while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1);
    return t + '…';
  }

  function drawThumb(ctx, img, cx, cy, r) {
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = '#f8f7f4'; ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    if (img) ctx.drawImage(img, cx - r, cy - r, r * 2, r * 2);
    ctx.restore();
    ctx.beginPath(); ctx.arc(cx, cy, r - 0.5, 0, Math.PI * 2);
    ctx.strokeStyle = SNAP.line; ctx.lineWidth = 1; ctx.stroke();
  }

  // 사진 + 오른쪽 아래 색 점 + (이름)
  function drawCard(ctx, it, imgs, x, y, cardW) {
    const cx = x + cardW / 2, cy = y + 32;
    drawThumb(ctx, imgs.get(it.id), cx, cy, 32);
    const dx = cx + 27, dy = cy + 25;
    ctx.beginPath(); ctx.arc(dx, dy, 11.5, 0, Math.PI * 2); ctx.fillStyle = SNAP.surface; ctx.fill();
    drawSwatch(ctx, dx, dy, 9, itemColors(it), itemMode(it));
    if (state.showNames && it.name) {
      setFont(ctx, 11); ctx.fillStyle = SNAP.ink; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(fitText(ctx, it.name, cardW - 4), cx, y + 64 + 6 + 12);
    }
  }

  function loadImgs(items) {
    const map = new Map();
    return Promise.all(items.map(it => new Promise(res => {
      const im = new Image();
      im.onload = () => { map.set(it.id, im); res(); };
      im.onerror = () => res();
      im.src = it.img;
    }))).then(() => map);
  }

  function todayStr() {
    const d = new Date();
    return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
  }

  // 레이아웃 계산 → 실제 그리기 (두 번 나눠서 캔버스 크기를 먼저 정함)
  function planSnapshot(imgs) {
    const P = 40, HEAD = 92;
    const names = state.showNames;
    const ops = [];
    let W = 1200, H = 0;
    let title, sub;

    if (state.board === 'all') {
      const chars = sortChars(characters());
      const sortLabel = { hair: '머리색순', eye: '눈색순', name: '이름순', manual: '직접 배치' }[state.sortAll];
      title = '한눈에 보기';
      sub = `캐릭터 ${chars.length}명 · ${sortLabel}`;
      const cellW = 112, gapX = 12, gapY = 26, padX = 24, padY = 28;
      const innerW = W - P * 2 - padX * 2;
      const per = Math.max(1, Math.floor((innerW + gapX) / (cellW + gapX)));
      const cellH = 76 + 10 + (names ? 18 + 8 : 0) + 28;
      const lines = Math.ceil(chars.length / per);
      const panelH = padY * 2 + lines * cellH + (lines - 1) * gapY;
      const py = HEAD;
      ops.push(ctx => { rrect(ctx, P, py, W - P * 2, panelH, 18); ctx.fillStyle = SNAP.surface; ctx.fill(); ctx.strokeStyle = SNAP.line; ctx.lineWidth = 1; ctx.stroke(); });
      const usedW = per * cellW + (per - 1) * gapX;
      const startX = P + padX + Math.max(0, (innerW - usedW) / 2);
      chars.forEach((c, i) => {
        const col = i % per, row = Math.floor(i / per);
        const x = startX + col * (cellW + gapX), y = py + padY + row * (cellH + gapY);
        ops.push(ctx => {
          const src = c.items.hair || c.items.eye;
          const cx = x + cellW / 2;
          drawThumb(ctx, imgs.get(src.id), cx, y + 38, 38);
          let yy = y + 76 + 10;
          if (names) {
            if (c.name) {
              setFont(ctx, 12, 500); ctx.fillStyle = SNAP.ink; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
              ctx.fillText(fitText(ctx, c.name, cellW - 4), cx, yy + 9);
            }
            yy += 18 + 8;
          }
          const shown = BOARDS.filter(b => b.key !== 'theme' || (c.items.theme && state.showTheme));
          shown.forEach((b, k) => {
            const it = c.items[b.key];
            const chx = cx + (k - (shown.length - 1) / 2) * 30, chy = yy + 13;
            if (it) drawSwatch(ctx, chx, chy, 12, itemColors(it), itemMode(it));
            else {
              ctx.save(); ctx.setLineDash([3, 3]);
              ctx.beginPath(); ctx.arc(chx, chy, 11.25, 0, Math.PI * 2);
              ctx.strokeStyle = SNAP.line; ctx.lineWidth = 1.5; ctx.stroke(); ctx.restore();
            }
          });
        });
      });
      H = py + panelH + P;
    } else {
      const board = state.board;
      const items = boardItems(board);
      const cats = catsFor(board).map(c => ({ c, list: items.filter(i => i.cat === c.key) })).filter(r => r.list.length);
      title = boardLabel(board);
      sub = `${items.length}명 · ${state.layout === 'cols' ? '열 나열' : '행 나열'} · ${state.boardSort[board] === 'manual' ? '직접 배치' : '밝기순'}`;
      const cardH = 64 + (names ? 6 + 24 : 0);

      if (state.layout === 'cols') {
        const colW = names ? 124 : 112, gap = 8, labelH = 22, padT = 16;
        W = Math.max(720, P * 2 + cats.length * colW + (cats.length - 1) * gap);
        const maxN = Math.max(...cats.map(r => r.list.length));
        const colH = padT + labelH + 14 + maxN * cardH + (maxN - 1) * 12 + 18;
        const cardW = names ? 84 : 64;
        cats.forEach((r, i) => {
          const x = P + i * (colW + gap), y = HEAD;
          ops.push(ctx => {
            rrect(ctx, x, y, colW, colH, 18); ctx.fillStyle = SNAP.surface; ctx.fill(); ctx.strokeStyle = SNAP.line; ctx.lineWidth = 1; ctx.stroke();
            setFont(ctx, 13, 600);
            const label = r.c.label, cnt = String(r.list.length);
            const lw = ctx.measureText(label).width;
            setFont(ctx, 11); const cw = ctx.measureText(cnt).width;
            const total = 18 + 6 + lw + 5 + cw;
            let lx = x + colW / 2 - total / 2;
            const ly = y + padT + labelH / 2;
            drawCatChip(ctx, lx + 9, ly, 9, r.c);
            setFont(ctx, 13, 600); ctx.fillStyle = SNAP.ink; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
            ctx.fillText(label, lx + 24, ly);
            setFont(ctx, 11); ctx.fillStyle = SNAP.muted;
            ctx.fillText(cnt, lx + 24 + lw + 5, ly);
            r.list.forEach((it, k) => drawCard(ctx, it, imgs, x + (colW - cardW) / 2, y + padT + labelH + 14 + k * (cardH + 12), cardW));
          });
        });
        H = HEAD + colH + P;
      } else {
        const rowX = P, rowW = W - P * 2, padX = 18, padY = 14, labelW = 128;
        const cardW = names ? 84 : 64, gapX = 12, gapY = 14;
        const itemsX = rowX + padX + labelW + 16;
        const itemsW = rowW - padX * 2 - labelW - 16;
        const per = Math.max(1, Math.floor((itemsW + gapX) / (cardW + gapX)));
        let y = HEAD;
        cats.forEach(r => {
          const lines = Math.ceil(r.list.length / per);
          const itemsH = lines * cardH + (lines - 1) * gapY;
          const rowH = Math.max(64, itemsH) + padY * 2;
          const ry = y;
          ops.push(ctx => {
            rrect(ctx, rowX, ry, rowW, rowH, 18); ctx.fillStyle = SNAP.surface; ctx.fill(); ctx.strokeStyle = SNAP.line; ctx.lineWidth = 1; ctx.stroke();
            const ly = ry + padY + 32;
            drawCatChip(ctx, rowX + padX + 10, ly, 10, r.c);
            setFont(ctx, 14, 600); ctx.fillStyle = SNAP.ink; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
            ctx.fillText(r.c.label, rowX + padX + 30, ly);
            const lw = ctx.measureText(r.c.label).width;
            setFont(ctx, 12); ctx.fillStyle = SNAP.muted;
            ctx.fillText(String(r.list.length), rowX + padX + 30 + lw + 8, ly);
            r.list.forEach((it, k) => {
              const col = k % per, line = Math.floor(k / per);
              drawCard(ctx, it, imgs, itemsX + col * (cardW + gapX), ry + padY + line * (cardH + gapY), cardW);
            });
          });
          y += rowH + 8;
        });
        H = y - 8 + P;
      }
    }

    // 머리말
    ops.unshift(ctx => {
      ctx.fillStyle = SNAP.bg; ctx.fillRect(0, 0, W, H);
      setFont(ctx, 12, 600); ctx.fillStyle = SNAP.muted; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
      ctx.fillText('캐릭터 컬러 정리함', P, 38);
      ctx.font = `400 26px ${SNAP.display}`; ctx.fillStyle = SNAP.ink;
      ctx.fillText(title, P, 68);
      const tw = ctx.measureText(title).width;
      setFont(ctx, 13); ctx.fillStyle = SNAP.muted;
      ctx.fillText(sub, P + tw + 12, 67);
      ctx.textAlign = 'right';
      ctx.fillText(todayStr(), W - P, 67);
    });
    return { W, H, ops, title };
  }

  async function makeSnapshot() {
    const pool = state.board === 'all' ? state.items : state.items.filter(i => i.board === state.board);
    if (!pool.length) { toast('저장할 카드가 아직 없습니다'); return; }
    els.snapBtn.disabled = true;
    try {
      if (document.fonts && document.fonts.ready) { try { await document.fonts.load('400 26px "Jua"', '캐릭터'); await document.fonts.ready; } catch (e) { /* 무시 */ } }
      const imgs = await loadImgs(pool);
      const plan = planSnapshot(imgs);
      // 아주 긴 이미지는 브라우저 한계를 넘지 않게 배율을 낮춤
      const scale = Math.max(1, Math.min(2, 16000 / Math.max(plan.W, plan.H)));
      const cv = document.createElement('canvas');
      cv.width = Math.round(plan.W * scale);
      cv.height = Math.round(plan.H * scale);
      const ctx = cv.getContext('2d');
      ctx.scale(scale, scale);
      ctx.imageSmoothingQuality = 'high';
      for (const op of plan.ops) op(ctx);

      const stamp = todayStr().replace(/\./g, '');
      await showSnapCanvas(cv, '이미지로 저장', `${plan.title} · ${Math.round(plan.W * scale)}×${Math.round(plan.H * scale)}px`,
        `캐릭터컬러정리함-${plan.title.replace(/\s+/g, '')}-${stamp}.png`);
    } catch (e) {
      toast('이미지를 만들지 못했습니다');
    } finally {
      els.snapBtn.disabled = false;
    }
  }
  async function showSnapCanvas(cv, title, sub, fileName) {
    const blob = await new Promise(res => cv.toBlob(res, 'image/png'));
    if (!blob) { toast('이미지를 만들지 못했습니다'); return; }
    // 누르면 바로 다운로드
    await saveFile(blob, fileName, `${title === '컬러차트' ? '컬러차트를' : '이미지를'} 저장했습니다`);
    return;
    if (els.snapDownload.href) URL.revokeObjectURL(els.snapDownload.href);
    // 미리보기는 dataURL (blob 주소가 막힌 환경에서도 보이게), 다운로드는 blob
    els.snapImg.src = cv.toDataURL('image/png');
    els.snapDownload.href = URL.createObjectURL(blob);
    els.snapDownload.download = fileName;
    els.snapTitle.textContent = title;
    els.snapSub.textContent = sub;
    els.snapModal.hidden = false;
    document.body.classList.add('modal-open');
  }
  function closeSnap() {
    els.snapModal.hidden = true;
    if (!modal.open && !ed.open && els.picker.hidden) document.body.classList.remove('modal-open');
  }
  els.snapBtn.addEventListener('click', makeSnapshot);
  els.snapClose.addEventListener('click', closeSnap);
  els.snapCancel.addEventListener('click', closeSnap);
  els.snapModal.addEventListener('pointerdown', (e) => { if (e.target === els.snapModal) closeSnap(); });
  els.snapDownload.addEventListener('click', () => setTimeout(() => toast('이미지를 저장했습니다'), 300));

  /* ---------- 도움말 ---------- */
  const guideModal = $('#guideModal');
  function openGuide() {
    guideModal.hidden = false;
    document.body.classList.add('modal-open');
    guideModal.querySelector('.guide-body').scrollTop = 0;
  }
  function closeGuide() {
    guideModal.hidden = true;
    if (!modal.open && !ed.open && els.picker.hidden && els.snapModal.hidden) document.body.classList.remove('modal-open');
  }
  $('#guideBtn').addEventListener('click', openGuide);
  $('#guideClose').addEventListener('click', closeGuide);
  $('#guideOk').addEventListener('click', closeGuide);
  guideModal.addEventListener('pointerdown', (e) => { if (e.target === guideModal) closeGuide(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !guideModal.hidden) closeGuide(); });

  /* ---------- 파일 저장 ---------- */
  let dlPromise = null;
  function downloadsApi() {
    if (!dlPromise) {
      dlPromise = (window.claude && typeof window.claude.use === 'function')
        ? window.claude.use('downloads').catch(() => null)
        : Promise.resolve(null);
    }
    return dlPromise;
  }
  if (window.claude && typeof window.claude.use === 'function') downloadsApi();   // 미리 준비
  async function saveFile(blob, filename, doneMsg) {
    const dl = await downloadsApi();
    if (dl) {
      try {
        await dl.save({ filename, data: blob });
        if (doneMsg) toast(doneMsg);
      } catch (e) {
        const code = e && e.code;
        if (code === 'declined') return;
        if (code === 'rate_limited') toast('잠시 후 다시 눌러 주십시오');
        else toast('여기서는 파일을 저장할 수 없습니다');
      }
      return;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    if (doneMsg) toast(doneMsg);
  }

  /* ---------- 토스트 ---------- */
  let toastT = 0;
  function toast(msg) {
    els.toast.textContent = msg;
    els.toast.classList.add('show');
    clearTimeout(toastT);
    toastT = setTimeout(() => els.toast.classList.remove('show'), 2600);
  }

  /* ---------- 시작 ---------- */
  load();
  render();
  // 처음 방문했을 때 한 번만 도움말 띄우기 (이후엔 '도움말' 버튼으로)
  const HELP_KEY = 'colorShelf.helpSeen';
  let helpSeen = false;
  try { helpSeen = localStorage.getItem(HELP_KEY) === '1'; } catch (e) { helpSeen = true; }
  if (!helpSeen) {
    openGuide();
    try { localStorage.setItem(HELP_KEY, '1'); } catch (e) { /* 무시 */ }
  }
})();
