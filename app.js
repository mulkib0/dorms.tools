/* ══════════════════════════════════════════════════════════
   교무실 전광판 — app.js
   부서 공지를 함께 띄우고 함께 고치는 전광판
   ══════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  /* ────────────────────────── 상수 ────────────────────────── */
  const STORAGE_KEY = 'gyomushil-board:v1';
  const VIEW_KEY = 'gyomushil-board:view';
  const CHANNEL_NAME = 'gyomushil-board';

  const RANK = { urgent: 0, important: 1, normal: 2 };
  const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
  const SWATCHES = [
    '#7C9CFF', '#6FD3C7', '#F2A65A', '#A78BFA', '#F27D9D',
    '#8FD06A', '#6FC5E8', '#C7B48A', '#E48D6B', '#9BB0C9'
  ];

  const DEFAULT_DEPARTMENTS = [
    { id: 'plan', name: '교무기획부', color: '#7C9CFF' },
    { id: 'curriculum', name: '교육과정부', color: '#6FD3C7' },
    { id: 'safety', name: '학생안전부', color: '#F2A65A' },
    { id: 'science', name: '과학정보부', color: '#A78BFA' },
    { id: 'career', name: '진로상담부', color: '#F27D9D' },
    { id: 'arts', name: '체육예술부', color: '#8FD06A' },
    { id: 'health', name: '보건실', color: '#6FC5E8' },
    { id: 'admin', name: '행정실', color: '#C7B48A' }
  ];

  const DEFAULT_SETTINGS = {
    rotateSec: 12,
    scale: 1,
    showTicker: true,
    ticker: '',
    defaultDept: 'plan',
    theme: 'dark'          // 'dark' | 'light'
  };

  const DEFAULT_TICKER = '오늘도 안전하고 즐거운 학교생활 되세요.';

  const SEED_NOTICES = [
    {
      deptId: 'safety',
      title: '현장체험학습 신청서 제출',
      body: '11월 28일(금)까지 3학년 담임 선생님께 제출해 주세요.\n미제출 학생은 학급에서 개별 확인 부탁드립니다.',
      author: '김하늘', priority: 'important', pinned: true
    },
    {
      deptId: 'plan',
      title: '12월 교직원 회의 일정 안내',
      body: '12월 2일(화) 16:30 · 3층 대회의실\n부서별 안건은 11월 28일까지 교무실로 제출해 주세요.',
      author: '박서준', priority: 'normal'
    },
    {
      deptId: 'science',
      title: '과학실 안전 점검 및 실험 기자재 신청',
      body: '12월 4일(목)까지 학년 과학 담당 선생님은 신청서를 제출해 주세요.',
      author: '이도윤', priority: 'normal'
    }
  ];

  /* ────────────────────────── 유틸 ────────────────────────── */
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.prototype.slice.call((root || document).querySelectorAll(sel));
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const pad2 = (n) => String(n).padStart(2, '0');
  const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const uid = () => 'n' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const byId = (list) => (list || []).reduce((acc, n) => { acc[n.id] = n; return acc; }, {});

  function hexA(hex, alpha) {
    const raw = String(hex || '#8899AA').replace('#', '');
    const full = raw.length === 3 ? raw.split('').map((c) => c + c).join('') : raw;
    const num = parseInt(full, 16);
    if (Number.isNaN(num)) return 'rgba(136,153,170,' + alpha + ')';
    return 'rgba(' + ((num >> 16) & 255) + ',' + ((num >> 8) & 255) + ',' + (num & 255) + ',' + alpha + ')';
  }

  /** 작은 DOM 빌더 — innerHTML 없이 안전하게 조립한다. */
  function h(tag, props) {
    const node = document.createElement(tag);
    if (props) {
      Object.keys(props).forEach(function (key) {
        const value = props[key];
        if (value === null || value === undefined || value === false) return;
        if (key === 'class') node.className = value;
        else if (key === 'text') node.textContent = value;
        else if (key === 'style') node.setAttribute('style', value);
        else if (key === 'dataset') Object.assign(node.dataset, value);
        else if (key.slice(0, 2) === 'on' && typeof value === 'function') {
          node.addEventListener(key.slice(2).toLowerCase(), value);
        } else if (value === true) node.setAttribute(key, '');
        else node.setAttribute(key, value);
      });
    }
    for (let i = 2; i < arguments.length; i++) {
      const kids = [].concat(arguments[i]);
      kids.forEach(function (kid) {
        if (kid === null || kid === undefined || kid === false) return;
        node.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
      });
    }
    return node;
  }

  /* ────────────────────────── 상태 ────────────────────────── */
  function normalize(raw) {
    const src = raw || {};
    const defaults = {
      version: 1,
      org: '○○고등학교 교무실',
      departments: clone(DEFAULT_DEPARTMENTS),
      notices: [],
      settings: clone(DEFAULT_SETTINGS)
    };

    const base = Object.assign(defaults, src);
    base.departments = (Array.isArray(src.departments) && src.departments.length
      ? src.departments
      : clone(DEFAULT_DEPARTMENTS)
    ).map(function (d, i) {
      return {
        id: d && d.id ? String(d.id) : 'dept' + i,
        name: (d && d.name) || '이름 없는 부서',
        color: (d && d.color) || SWATCHES[i % SWATCHES.length]
      };
    });

    base.settings = Object.assign(clone(DEFAULT_SETTINGS), src.settings || {});
    base.settings.rotateSec = clamp(Number(base.settings.rotateSec) || 12, 4, 300);
    base.settings.scale = clamp(Number(base.settings.scale) || 1, 0.75, 1.5);
    base.settings.showTicker = base.settings.showTicker !== false;
    base.settings.ticker = String(base.settings.ticker || '');
    base.settings.theme = base.settings.theme === 'light' ? 'light' : 'dark';
    if (!base.departments.some((d) => d.id === base.settings.defaultDept)) {
      base.settings.defaultDept = base.departments[0].id;
    }

    const deptIds = base.departments.map((d) => d.id);
    base.notices = (Array.isArray(src.notices) ? src.notices : []).map(function (n, i) {
      const item = n || {};
      return {
        id: item.id ? String(item.id) : 'seed' + i + Date.now().toString(36),
        deptId: deptIds.indexOf(item.deptId) >= 0 ? item.deptId : deptIds[0],
        title: String(item.title || ''),
        body: String(item.body || ''),
        author: String(item.author || ''),
        priority: RANK.hasOwnProperty(item.priority) ? item.priority : 'normal',
        pinned: !!item.pinned,
        active: item.active !== false,
        startAt: String(item.startAt || ''),
        endAt: String(item.endAt || ''),
        duration: clamp(Number(item.duration) || 0, 0, 120),
        createdAt: Number(item.createdAt) || Date.now(),
        updatedAt: Number(item.updatedAt) || Date.now()
      };
    });

    base.org = String(base.org || defaults.org).slice(0, 40);
    return base;
  }

  function firstRunState() {
    const now = Date.now();
    const seed = SEED_NOTICES.map(function (n, i) {
      return Object.assign({}, n, {
        id: uid(),
        active: true,
        pinned: !!n.pinned,
        startAt: '',
        endAt: '',
        duration: 0,
        createdAt: now - i * 1000,
        updatedAt: now - i * 1000
      });
    });
    return normalize({ notices: seed });
  }

  let state = normalize(null);
  let pristine = true;          // 이 브라우저에 저장된 공지가 아직 없는 상태
  let mode = 'local';           // 'local' | 'server'
  let revision = 0;
  let baseSnapshot = null;
  let saveTimer = null;
  let saving = false;
  let pollTimer = null;
  let bc = null;
  let editingId = null;

  const disp = {
    list: [],
    idx: 0,
    paused: false,
    timer: null,
    deadline: 0,
    remain: 0,
    sig: null,
    currentId: null
  };

  /* ────────────────────────── 조회 ────────────────────────── */
  function getDept(id) {
    return state.departments.find((d) => d.id === id) || { id: '', name: '기타', color: '#8899AA' };
  }

  function isLive(n, now) {
    if (!n.active) return false;
    if (n.startAt && new Date(n.startAt).getTime() > now) return false;
    if (n.endAt && new Date(n.endAt).getTime() < now) return false;
    return true;
  }

  function byOrder(a, b) {
    return (Number(b.pinned) - Number(a.pinned)) ||
      (RANK[a.priority] - RANK[b.priority]) ||
      (b.updatedAt - a.updatedAt);
  }

  function liveNotices() {
    const now = Date.now();
    return state.notices.filter((n) => isLive(n, now)).sort(byOrder);
  }

  function slideMs(n) {
    const sec = n.duration > 0 ? n.duration : state.settings.rotateSec;
    return clamp(sec, 3, 300) * 1000;
  }

  function stamp(value) {
    if (!value) return '';
    const parts = String(value).split('T');
    const date = parts[0].split('-');
    if (date.length < 3) return value;
    const time = parts[1] ? ' ' + parts[1].slice(0, 5) : '';
    return Number(date[1]) + '월 ' + Number(date[2]) + '일' + time;
  }

  function periodText(n) {
    if (n.startAt && n.endAt) return stamp(n.startAt) + ' ~ ' + stamp(n.endAt);
    if (n.startAt) return stamp(n.startAt) + '부터';
    if (n.endAt) return stamp(n.endAt) + '까지';
    return '';
  }

  function shortDate(ts) {
    const d = new Date(ts);
    const today = new Date();
    const md = (d.getMonth() + 1) + '.' + pad2(d.getDate()) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
    return d.getFullYear() === today.getFullYear() ? md : d.getFullYear() + '. ' + md;
  }

  /* ────────────────────────── 저장 ────────────────────────── */
  function loadLocal() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function persistLocal() {
    pristine = false;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* 저장 공간 부족 */ }
  }

  function broadcast() {
    if (!bc) return;
    try { bc.postMessage({ type: 'state', at: Date.now() }); } catch (e) { /* noop */ }
  }

  function applyFromLocal() {
    if (saveTimer || saving) return;
    const raw = loadLocal();
    if (!raw) return;
    const next = normalize(raw);
    if (same(next, state)) return;
    state = next;
    renderAll();
  }

  function touch() {
    persistLocal();
    broadcast();
    if (mode === 'server') {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(function () {
        saveTimer = null;
        pushState(0);
      }, 500);
    }
  }

  function commit() {
    touch();
    renderAll();
  }

  /* ────────────────────────── 서버 동기화 ────────────────────────── */
  function setMode(next) {
    mode = next;
    const badge = $('#syncBadge');
    const text = $('#syncText');
    if (next === 'server') {
      badge.dataset.state = 'server';
      text.textContent = '선생님들과 함께 쓰는 중';
      $('#shareBox').hidden = false;
      $('#shareUrl').value = location.origin + location.pathname;
      $('#localOnlyNote').hidden = true;
      loadShareUrl();
    } else {
      badge.dataset.state = 'local';
      text.textContent = '이 컴퓨터에만 저장';
      $('#shareBox').hidden = true;
      $('#localOnlyNote').hidden = false;
    }
  }

  /* 서버를 켠 컴퓨터에서 127.0.0.1 로 열었을 때도 다른 선생님이 쓸 주소를 알려준다. */
  let shareUrlLoaded = false;
  function loadShareUrl() {
    if (shareUrlLoaded) return;
    if (!/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)) { shareUrlLoaded = true; return; }
    shareUrlLoaded = true;
    fetch('api/info', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (info) {
        if (info && info.lanUrl) $('#shareUrl').value = info.lanUrl;
      })
      .catch(function () { shareUrlLoaded = false; });
  }

  function setSync(kind) {
    const badge = $('#syncBadge');
    if (mode !== 'server') { badge.dataset.state = 'local'; return; }
    badge.dataset.state = kind === 'error' ? 'error' : 'server';
    $('#syncText').textContent = kind === 'error' ? '연결이 끊겼습니다' : '선생님들과 함께 쓰는 중';
  }

  function mergeStates(base, local, remote) {
    const b = byId(base && base.notices);
    const l = byId(local.notices);
    const r = byId(remote.notices);
    const ids = Object.keys(Object.assign({}, b, l, r));
    const notices = [];

    ids.forEach(function (id) {
      const bn = b[id], ln = l[id], rn = r[id];
      let pick;
      if (!bn) {
        pick = ln && rn ? (ln.updatedAt >= rn.updatedAt ? ln : rn) : (ln || rn);
      } else if (same(ln, bn)) {
        pick = rn;                       // 내가 건드리지 않음 → 서버 최신
      } else if (same(rn, bn)) {
        pick = ln;                       // 서버가 그대로 → 내 편집
      } else {
        pick = (ln && rn) ? ((ln.updatedAt >= rn.updatedAt) ? ln : rn) : (ln || rn);
      }
      if (pick) notices.push(pick);
    });

    const merged = clone(remote);
    merged.notices = notices;
    merged.departments = remote.departments;
    merged.settings = remote.settings;
    merged.org = remote.org;

    if (base) {
      if (!same(local.settings, base.settings)) merged.settings = local.settings;
      if (!same(local.departments, base.departments)) merged.departments = local.departments;
      if (local.org !== base.org) merged.org = local.org;
    } else if (local.org && local.org !== remote.org) {
      merged.org = local.org;
    }
    return normalize(merged);
  }

  async function pushState(retry) {
    if (mode !== 'server') return;
    const attempt = retry || 0;
    saving = true;
    try {
      const res = await fetch('api/state', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseRevision: revision, state: state })
      });

      if (res.status === 409) {
        const payload = await res.json();
        const remote = normalize(payload.state || {});
        state = mergeStates(baseSnapshot, state, remote);
        revision = Number(payload.revision) || revision;
        baseSnapshot = clone(remote);
        persistLocal();
        renderAll();
        saving = false;
        if (attempt < 2) await pushState(attempt + 1);
        else setSync('error');
        return;
      }

      if (!res.ok) throw new Error('save ' + res.status);
      const payload = await res.json();
      revision = Number(payload.revision) || revision;
      baseSnapshot = clone(state);
      setSync('ok');
    } catch (e) {
      setSync('error');
    } finally {
      saving = false;
    }
  }

  async function poll() {
    if (mode !== 'server') return;
    if (document.visibilityState !== 'visible') return;
    if (saveTimer || saving) return;
    try {
      const res = await fetch('api/state', { cache: 'no-store' });
      if (!res.ok) return;
      const payload = await res.json();
      if (!payload || typeof payload.revision !== 'number') return;
      if (payload.revision === revision) { setSync('ok'); return; }
      revision = payload.revision;
      if (!payload.state) return;
      state = normalize(payload.state);
      baseSnapshot = clone(state);
      persistLocal();
      renderAll();
      setSync('ok');
    } catch (e) {
      setSync('error');
    }
  }

  async function detectMode() {
    if (!/^https?:$/.test(location.protocol)) { setMode('local'); return; }
    try {
      const res = await fetch('api/state', { cache: 'no-store' });
      if (!res.ok) throw new Error('no api');
      const payload = await res.json();
      if (!payload || typeof payload.revision !== 'number') throw new Error('bad api');

      mode = 'server';
      revision = payload.revision;

      if (payload.state) {
        const remote = normalize(payload.state);
        const merged = pristine ? clone(remote) : mergeStates(null, state, remote);
        baseSnapshot = clone(remote);
        pristine = false;
        if (!same(merged, remote)) {
          state = merged;
          persistLocal();
          renderAll();
          await pushState(0);
        } else {
          state = remote;
          persistLocal();
          renderAll();
        }
      } else {
        baseSnapshot = null;
        pristine = false;
        await pushState(0);
      }

      setMode('server');
      clearInterval(pollTimer);
      pollTimer = setInterval(poll, 4000);
    } catch (e) {
      setMode('local');
    }
  }

  /* ────────────────────────── 전광판 렌더 ────────────────────────── */
  function paintSlide(n) {
    const stage = $('#stage');
    const dept = getDept(n.deptId);

    const top = h('div', { class: 'slide-top' },
      h('span', { class: 'chip', text: dept.name }),
      n.priority === 'urgent' ? h('span', { class: 'tag tag-urgent', text: '긴급' }) : null,
      n.priority === 'important' ? h('span', { class: 'tag tag-important', text: '중요' }) : null,
      n.pinned ? h('span', { class: 'tag tag-pin', text: '고정' }) : null,
      h('span', {
        class: 'slide-index mono',
        text: pad2(disp.idx + 1) + ' / ' + pad2(disp.list.length)
      })
    );

    const foot = [];
    if (n.author) foot.push(h('span', {}, h('em', { class: 'mono', text: '담당' }), n.author));
    const period = periodText(n);
    if (period) foot.push(h('span', {}, h('em', { class: 'mono', text: '게시' }), period));

    const node = h('article', {
      class: 'slide',
      dataset: { prio: n.priority },
      style: '--c:' + dept.color + ';--c-soft:' + hexA(dept.color, 0.13) + ';--c-line:' + hexA(dept.color, 0.38)
    },
      h('div', { class: 'slide-inner' },
        top,
        h('h1', { class: 'slide-title', text: n.title || '제목 없음' }),
        n.body ? h('p', { class: 'slide-body', text: n.body }) : null,
        foot.length ? h('div', { class: 'slide-foot' }, foot) : null
      )
    );

    stage.style.setProperty('--c', dept.color);
    swapStage(node);
  }

  function paintEmpty() {
    const node = h('article', { class: 'slide slide-empty', style: '--c:#8899AA;--c-soft:rgba(136,153,170,.1);--c-line:rgba(226,235,245,.17)' },
      h('div', { class: 'slide-inner' },
        h('div', { class: 'slide-top' },
          h('span', { class: 'chip', text: '안내' }),
          h('span', { class: 'slide-index mono', text: 'STANDBY' })
        ),
        h('h1', { class: 'slide-title', text: '지금 게시 중인 공지가 없습니다' }),
        h('p', { class: 'slide-body', text: '공지 관리 화면에서 부서 공지를 등록하면\n이 화면에 바로 나타납니다.' })
      )
    );
    swapStage(node);
  }

  /** 제목·본문이 길어도 잘리지 않도록 슬라이드 높이에 맞춰 글자를 줄인다. */
  function fitSlide(node) {
    const inner = node.querySelector('.slide-inner');
    if (!inner) return;
    const cs = getComputedStyle(node);
    const avail = node.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    if (!(avail > 0)) return;
    inner.style.removeProperty('--fit');
    for (let i = 0; i < 24; i++) {
      if (inner.getBoundingClientRect().height <= avail) return;
      const next = Math.max(0.56, 1 - (i + 1) * 0.04);
      inner.style.setProperty('--fit', next.toFixed(2));
      if (next <= 0.56) return;
    }
  }

  function swapStage(node) {
    const stage = $('#stage');
    stage.append(node);
    fitSlide(node);
    requestAnimationFrame(function () { node.classList.add('is-in'); });
    Array.prototype.slice.call(stage.children).forEach(function (old) {
      if (old === node) return;
      old.classList.remove('is-in');
      setTimeout(function () { old.remove(); }, 640);
    });
  }

  function renderDisplay(force) {
    const list = liveNotices();
    disp.list = list;

    const sig = list.map(function (n) { return n.id + ':' + n.updatedAt; }).join('|');
    const stillThere = disp.currentId
      ? list.some(function (n) { return n.id === disp.currentId; })
      : true;
    if (!force && sig === disp.sig && stillThere) return;

    disp.sig = sig;

    if (!list.length) {
      disp.currentId = null;
      clearTimeout(disp.timer);
      paintEmpty();
      renderPager();
      setProgress(0);
      return;
    }

    let idx = disp.currentId ? list.findIndex(function (n) { return n.id === disp.currentId; }) : 0;
    if (idx < 0) idx = 0;
    disp.idx = idx;
    disp.currentId = list[idx].id;
    paintSlide(list[idx]);
    renderPager();
    schedule(slideMs(list[idx]));
  }

  function renderPager() {
    const pager = $('#pager');
    pager.textContent = '';
    pager.hidden = disp.list.length < 2;
    disp.list.forEach(function (n, i) {
      const dept = getDept(n.deptId);
      const dot = h('button', {
        class: 'dot' + (i === disp.idx ? ' is-active' : ''),
        type: 'button',
        'aria-label': (i + 1) + '번째 공지: ' + n.title,
        style: '--c:' + dept.color
      });
      dot.addEventListener('click', function () { goTo(i); });
      pager.append(dot);
    });
  }

  function goTo(index) {
    const list = disp.list;
    if (!list.length) return;
    const len = list.length;
    disp.idx = ((index % len) + len) % len;
    disp.currentId = list[disp.idx].id;
    paintSlide(list[disp.idx]);
    renderPager();
    schedule(slideMs(list[disp.idx]));
  }

  function setProgress(ms) {
    const bar = $('#progressBar');
    bar.style.animation = 'none';
    void bar.offsetWidth;
    if (!ms) { bar.style.opacity = '0'; return; }
    bar.style.opacity = '';
    bar.style.animation = 'grow ' + ms + 'ms linear forwards';
    bar.style.animationPlayState = disp.paused ? 'paused' : 'running';
  }

  function schedule(ms) {
    clearTimeout(disp.timer);
    disp.remain = ms;
    disp.deadline = Date.now() + ms;
    setProgress(ms);
    if (!disp.paused) {
      disp.timer = setTimeout(function () { goTo(disp.idx + 1); }, ms);
    }
  }

  function setPaused(paused) {
    if (paused === disp.paused) { updateHud(); return; }
    disp.paused = paused;
    const bar = $('#progressBar');

    if (paused) {
      clearTimeout(disp.timer);
      if (disp.deadline) disp.remain = Math.max(0, disp.deadline - Date.now());
      bar.style.animationPlayState = 'paused';
    } else {
      bar.style.animationPlayState = 'running';
      clearTimeout(disp.timer);
      if (disp.list.length) {
        disp.deadline = Date.now() + disp.remain;
        disp.timer = setTimeout(function () { goTo(disp.idx + 1); }, disp.remain);
      }
    }
    syncTickerMotion();
    updateHud();
  }

  function updateHud() {
    const hud = $('#hud');
    if (!hud) return;
    $$('[data-hud]', hud).forEach(function (btn) {
      const kind = btn.dataset.hud;
      if (kind === 'pause') {
        btn.textContent = disp.paused ? '재생' : '일시정지';
        btn.classList.toggle('is-on', disp.paused);
      }
      if (kind === 'full') {
        btn.textContent = document.fullscreenElement ? '전체화면 해제' : '전체화면';
      }
    });
  }

  function renderTicker() {
    const wrap = $('#tickerWrap');
    const track = $('#tickerTrack');
    const text = (state.settings.ticker || DEFAULT_TICKER).trim();
    const show = state.settings.showTicker && !!text;

    wrap.hidden = !show;
    track.textContent = '';
    track.classList.remove('is-scroll');
    if (!show) return;

    const seg = h('span', { class: 'ticker-seg', text: text });
    track.append(seg);

    // 한 줄이 화면 안에 들어오면 멈춰 있고, 넘칠 때만 흐르게 한다.
    const width = seg.getBoundingClientRect().width;
    if (width + 40 <= wrap.clientWidth) return;

    track.append(seg.cloneNode(true));
    track.classList.add('is-scroll');
    track.style.animationDuration = clamp(width / 78, 14, 80) + 's';
    syncTickerMotion();
  }

  function syncTickerMotion() {
    const track = $('#tickerTrack');
    if (track) track.style.animationPlayState = disp.paused ? 'paused' : 'running';
  }

  /** 창 크기가 바뀌면 흐를지 멈출지 다시 판단한다. */
  function refreshTicker() {
    renderTicker();
  }

  /* ────────────────────────── 관리 화면 ────────────────────────── */
  function renderBrand() {
    $('#dOrg').textContent = state.org || '교무실';
    document.title = (state.org || '교무실') + ' · 전광판';
  }

  function renderDeptFilter() {
    const select = $('#deptFilter');
    const keep = select.value;
    select.textContent = '';
    select.append(h('option', { value: '', text: '전체 부서' }));
    state.departments.forEach(function (d) {
      select.append(h('option', { value: d.id, text: d.name }));
    });
    select.value = state.departments.some(function (d) { return d.id === keep; }) ? keep : '';
  }

  function renderFormDeptOptions() {
    const select = $('#fDept');
    const keep = select.value || state.settings.defaultDept;
    select.textContent = '';
    state.departments.forEach(function (d) {
      select.append(h('option', { value: d.id, text: d.name }));
    });
    select.value = state.departments.some(function (d) { return d.id === keep; })
      ? keep
      : state.departments[0].id;
  }

  function renderList() {
    const listEl = $('#noticeList');
    const query = ($('#searchInput').value || '').trim().toLowerCase();
    const deptId = $('#deptFilter').value;
    const showInactive = $('#showInactive').checked;

    const items = state.notices
      .filter(function (n) { return showInactive || n.active; })
      .filter(function (n) { return !deptId || n.deptId === deptId; })
      .filter(function (n) {
        if (!query) return true;
        return (n.title + ' ' + n.body + ' ' + n.author).toLowerCase().indexOf(query) >= 0;
      })
      .sort(byOrder);

    $('#listCount').textContent = items.length === state.notices.length
      ? state.notices.length + '건'
      : items.length + '건 / 전체 ' + state.notices.length + '건';
    listEl.textContent = '';

    if (!items.length) {
      listEl.append(h('li', { class: 'empty' },
        h('strong', { text: state.notices.length ? '조건에 맞는 공지가 없습니다' : '아직 등록된 공지가 없습니다' }),
        '오른쪽 양식에서 첫 공지를 등록해 보세요.'
      ));
      return;
    }

    items.forEach(function (n) {
      const dept = getDept(n.deptId);
      const meta = [];
      if (n.author) meta.push(h('span', { text: '담당 ' + n.author }));
      const period = periodText(n);
      if (period) meta.push(h('span', { text: period }));
      meta.push(h('span', { text: '수정 ' + shortDate(n.updatedAt) }));

      listEl.append(h('li', {
        class: 'notice-item',
        dataset: { id: n.id, active: String(n.active), prio: n.priority },
        style: '--c:' + dept.color + ';--c-soft:' + hexA(dept.color, 0.14)
      },
        h('span', { class: 'ni-bar' }),
        h('div', { class: 'ni-main' },
          h('div', { class: 'ni-top' },
            h('span', { class: 'ni-chip', text: dept.name }),
            n.priority === 'urgent' ? h('span', { class: 'tag tag-urgent', text: '긴급' }) : null,
            n.priority === 'important' ? h('span', { class: 'tag tag-important', text: '중요' }) : null,
            n.pinned ? h('span', { class: 'tag tag-pin', text: '고정' }) : null,
            n.active ? null : h('span', { class: 'tag tag-pin', text: '미게시' })
          ),
          h('h3', { class: 'ni-title', text: n.title || '제목 없음' }),
          n.body ? h('p', { class: 'ni-body', text: n.body }) : null,
          h('div', { class: 'ni-meta' }, meta)
        ),
        h('div', { class: 'ni-actions' },
          h('button', { class: 'ni-act' + (n.pinned ? ' is-on' : ''), type: 'button', dataset: { act: 'pin' }, text: '고정' }),
          h('button', { class: 'ni-act', type: 'button', dataset: { act: 'toggle' }, text: n.active ? '내리기' : '게시' }),
          h('button', { class: 'ni-act', type: 'button', dataset: { act: 'edit' }, text: '수정' }),
          h('button', { class: 'ni-act', type: 'button', dataset: { act: 'dup' }, text: '복사' }),
          h('button', { class: 'ni-act', type: 'button', dataset: { act: 'del' }, text: '삭제' })
        )
      ));
    });
  }

  function renderAll() {
    applyTheme();
    renderBrand();
    renderDeptFilter();
    renderFormDeptOptions();
    renderList();
    renderTicker();
    renderDisplay();
    updateHud();
  }

  /* ────────────────────────── 폼 ────────────────────────── */
  function updateBodyCount() {
    const body = $('#fBody');
    $('#bodyCount').textContent = body.value.length + ' / 600';
  }

  function resetForm() {
    editingId = null;
    $('#noticeForm').reset();
    $('#fTitle').classList.remove('is-invalid');
    $('#fActive').checked = true;
    renderFormDeptOptions();
    $('#formTitle').textContent = '새 공지 등록';
    $('#btnSaveNotice').textContent = '등록';
    $('#btnCancelEdit').hidden = true;
    $('#btnNewNotice').hidden = true;
    $('#btnDeleteNotice').hidden = true;
    $('#formNote').textContent = '게시 기간을 비워두면 항상 표시됩니다.';
    updateBodyCount();
  }

  function fillForm(id) {
    const n = state.notices.find(function (x) { return x.id === id; });
    if (!n) { resetForm(); return; }
    $('#fTitle').classList.remove('is-invalid');
    editingId = id;
    $('#formTitle').textContent = '공지 수정';
    $('#btnSaveNotice').textContent = '수정 저장';
    $('#btnCancelEdit').hidden = false;
    $('#btnNewNotice').hidden = false;
    $('#btnDeleteNotice').hidden = false;
    $('#fDept').value = n.deptId;
    $('#fTitle').value = n.title;
    $('#fBody').value = n.body;
    $('#fAuthor').value = n.author;
    $('#fDuration').value = n.duration || '';
    $$('input[name="priority"]').forEach(function (r) { r.checked = r.value === n.priority; });
    $('#fStart').value = n.startAt;
    $('#fEnd').value = n.endAt;
    $('#fPinned').checked = n.pinned;
    $('#fActive').checked = n.active;
    $('#formNote').textContent = '마지막 수정 ' + shortDate(n.updatedAt);
    updateBodyCount();
    if (window.innerWidth < 1080) {
      $('#formTitle').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    $('#fTitle').focus();
  }

  function submitForm(event) {
    event.preventDefault();
    const title = $('#fTitle').value.trim();
    if (!title) {
      toast('제목을 입력해 주세요.', 'error');
      $('#fTitle').classList.add('is-invalid');
      $('#fTitle').focus();
      return;
    }

    const priorityInput = $$('input[name="priority"]').find(function (r) { return r.checked; });
    const data = {
      deptId: $('#fDept').value,
      title: title,
      body: $('#fBody').value.trim(),
      author: $('#fAuthor').value.trim(),
      priority: priorityInput ? priorityInput.value : 'normal',
      pinned: $('#fPinned').checked,
      active: $('#fActive').checked,
      startAt: $('#fStart').value,
      endAt: $('#fEnd').value,
      duration: clamp(Number($('#fDuration').value) || 0, 0, 120),
      updatedAt: Date.now()
    };

    if (data.startAt && data.endAt && data.startAt > data.endAt) {
      toast('게시 종료가 시작보다 빠릅니다.', 'error');
      return;
    }

    if (editingId) {
      const idx = state.notices.findIndex(function (n) { return n.id === editingId; });
      state.notices[idx] = Object.assign({}, state.notices[idx], data);
      toast('공지를 수정했습니다.');
    } else {
      state.notices.push(Object.assign({ id: uid(), createdAt: Date.now() }, data));
      toast('공지를 등록했습니다.');
    }

    state.settings.defaultDept = data.deptId;
    resetForm();
    commit();
  }

  function deleteEditing() {
    if (!editingId) return;
    const n = state.notices.find(function (x) { return x.id === editingId; });
    if (!n) return;
    if (!confirm('"' + (n.title || '제목 없음') + '" 공지를 삭제할까요?')) return;
    state.notices = state.notices.filter(function (x) { return x.id !== editingId; });
    resetForm();
    commit();
    toast('공지를 삭제했습니다.');
  }

  function duplicateNotice(id) {
    const n = state.notices.find(function (x) { return x.id === id; });
    if (!n) return;
    const copy = Object.assign({}, n, {
      id: uid(),
      title: n.title + ' (복사)',
      active: false,
      pinned: false,
      createdAt: Date.now(),
      updatedAt: Date.now()
    });
    state.notices.push(copy);
    $('#showInactive').checked = true;
    commit();
    fillForm(copy.id);
    toast('복사했습니다. 내용을 고친 뒤 "게시"를 눌러 주세요.');
  }

  /* ────────────────────────── 설정 ────────────────────────── */
  function openSettings() {
    $('#sOrg').value = state.org;
    $('#sRotate').value = state.settings.rotateSec;
    $('#sScale').value = state.settings.scale;
    $('#sScaleValue').textContent = Math.round(state.settings.scale * 100) + '%';
    $('#sTicker').value = state.settings.ticker;
    $('#sShowTicker').checked = state.settings.showTicker;
    applyTheme();
    renderDeptRows();
    const dialog = $('#settingsDialog');
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
  }

  function renderDeptRows() {
    const rows = $('#deptRows');
    rows.textContent = '';
    state.departments.forEach(function (d) {
      const nameInput = h('input', {
        class: 'input', value: d.name, maxLength: 20, 'aria-label': '부서 이름', placeholder: '부서 이름'
      });
      nameInput.addEventListener('input', function () {
        d.name = nameInput.value;
        persistLocal();
        renderDeptFilter();
        renderFormDeptOptions();
        renderList();
        renderDisplay();
        broadcast();
        scheduleServerSync();
      });

      const colorInput = h('input', {
        class: 'swatch', type: 'color', value: d.color, 'aria-label': d.name + ' 색상'
      });
      colorInput.addEventListener('input', function () {
        d.color = colorInput.value;
        persistLocal();
        renderList();
        renderDisplay(true);
        broadcast();
        scheduleServerSync();
      });

      rows.append(h('li', { class: 'dept-row' },
        colorInput,
        nameInput,
        h('button', {
          class: 'icon-btn', type: 'button', 'aria-label': d.name + ' 삭제', text: '✕',
          onclick: function () { removeDept(d.id); }
        })
      ));
    });
  }

  function scheduleServerSync() {
    if (mode !== 'server') return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      saveTimer = null;
      pushState(0);
    }, 600);
  }

  function addDept() {
    const dept = {
      id: 'd' + Date.now().toString(36),
      name: '새 부서',
      color: SWATCHES[state.departments.length % SWATCHES.length]
    };
    state.departments.push(dept);
    persistLocal();
    renderDeptRows();
    renderDeptFilter();
    renderFormDeptOptions();
    broadcast();
    scheduleServerSync();
    const inputs = $$('#deptRows .input');
    const last = inputs[inputs.length - 1];
    if (last) { last.focus(); last.select(); }
  }

  function removeDept(id) {
    if (state.departments.length <= 1) {
      toast('부서는 최소 한 개가 필요합니다.', 'error');
      return;
    }
    const dept = getDept(id);
    const used = state.notices.filter(function (n) { return n.deptId === id; }).length;
    const message = used
      ? '"' + dept.name + '" 공지 ' + used + '건이 첫 번째 부서로 옮겨집니다. 삭제할까요?'
      : '"' + dept.name + '" 부서를 삭제할까요?';
    if (!confirm(message)) return;

    state.departments = state.departments.filter(function (d) { return d.id !== id; });
    const fallback = state.departments[0].id;
    state.notices.forEach(function (n) { if (n.deptId === id) n.deptId = fallback; });
    if (state.settings.defaultDept === id) state.settings.defaultDept = fallback;
    persistLocal();
    renderDeptRows();
    renderAll();
    broadcast();
    scheduleServerSync();
    toast('부서를 삭제했습니다.');
  }

  function exportJSON() {
    const payload = JSON.stringify({ version: state.version, savedAt: new Date().toISOString(), state: state }, null, 2);
    const blob = new Blob([payload], { type: 'application/json' });
    const link = document.createElement('a');
    const today = new Date();
    link.href = URL.createObjectURL(blob);
    link.download = '교무실-전광판-' + today.getFullYear() + pad2(today.getMonth() + 1) + pad2(today.getDate()) + '.json';
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(function () { URL.revokeObjectURL(link.href); }, 2000);
    toast('JSON 파일로 내보냈습니다.');
  }

  function importJSON(file) {
    const reader = new FileReader();
    reader.onload = function () {
      try {
        const raw = JSON.parse(String(reader.result));
        const incoming = normalize(raw && raw.state ? raw.state : raw);
        if (!confirm('지금 공지를 모두 가져온 파일 내용으로 바꿀까요?')) return;
        state = incoming;
        resetForm();
        persistLocal();
        renderAll();
        renderDeptRows();
        if (mode === 'server') pushState(0);
        closeDialogs();
        toast('가져오기 완료 — ' + state.notices.length + '건');
      } catch (e) {
        toast('JSON 파일을 읽을 수 없습니다.', 'error');
      }
    };
    reader.readAsText(file);
  }

  function resetAll() {
    if (!confirm('모든 공지와 설정을 지우고 처음 상태로 돌립니다. 계속할까요?')) return;
    state = normalize(null);
    resetForm();
    persistLocal();
    renderAll();
    renderDeptRows();
    if (mode === 'server') pushState(0);
    toast('초기화했습니다.');
  }

  function closeDialogs() {
    $$('dialog[open]').forEach(function (d) { d.close(); });
  }

  /* ────────────────────────── 화면 전환 ────────────────────────── */
  function setView(view) {
    document.body.dataset.view = view;
    $('#viewDisplay').hidden = view !== 'display';
    $('#viewManage').hidden = view !== 'manage';
    try { localStorage.setItem(VIEW_KEY, view); } catch (e) { /* noop */ }

    if (view === 'manage') {
      renderList();
      renderDeptFilter();
      $('#viewManage').scrollTop = 0;
      setPaused(true);
    } else {
      setPaused(false);
      renderDisplay(true);
      requestWakeLock();
    }
    updateHud();
  }

  async function toggleFullscreen() {
    try {
      if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
      else await document.exitFullscreen();
    } catch (e) {
      toast('이 브라우저에서는 전체화면을 쓸 수 없습니다.', 'error');
    }
    updateHud();
  }

  let wakeLock = null;
  async function requestWakeLock() {
    if (document.body.dataset.view !== 'display') return;
    if (!('wakeLock' in navigator)) return;
    try {
      wakeLock = await navigator.wakeLock.request('screen');
    } catch (e) { /* 배터리 절약 모드 등 */ }
  }

  /* ────────────────────────── 알림 ────────────────────────── */
  let toastTimer = null;
  function toast(message, kind) {
    const el = $('#toast');
    el.textContent = message;
    el.dataset.kind = kind || 'info';
    el.classList.add('is-on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('is-on'); }, 2600);
  }

  /* ────────────────────────── 시계 ────────────────────────── */
  function tickClock() {
    const now = new Date();
    $('#dTime').textContent = pad2(now.getHours()) + ':' + pad2(now.getMinutes());
    $('#dDate').textContent = now.getFullYear() + '년 ' + (now.getMonth() + 1) + '월 ' +
      now.getDate() + '일 (' + WEEK[now.getDay()] + ')';
    $('#mClock').textContent = (now.getMonth() + 1) + '.' + now.getDate() + ' (' +
      WEEK[now.getDay()] + ') ' + pad2(now.getHours()) + ':' + pad2(now.getMinutes());
  }

  /* ────────────────────────── 이벤트 ────────────────────────── */
  function bindEvents() {
    /* 전광판 ↔ 관리 */
    $$('[data-hud]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const kind = btn.dataset.hud;
        if (kind === 'manage') setView('manage');
        else if (kind === 'pause') setPaused(!disp.paused);
        else if (kind === 'full') toggleFullscreen();
        else if (kind === 'help') {
          const dlg = $('#helpDialog');
          if (typeof dlg.showModal === 'function') dlg.showModal();
          else dlg.setAttribute('open', '');
        }
      });
    });

    $('#btnShowDisplay').addEventListener('click', function () { setView('display'); });
    $('#btnSettings').addEventListener('click', openSettings);

    /* 검색 / 필터 */
    $('#fTitle').addEventListener('input', function () {
      $('#fTitle').classList.remove('is-invalid');
    });
    $('#searchInput').addEventListener('input', renderList);
    $('#deptFilter').addEventListener('change', renderList);
    $('#showInactive').addEventListener('change', renderList);

    /* 목록 동작 */
    $('#noticeList').addEventListener('click', function (event) {
      const btn = event.target.closest('[data-act]');
      if (!btn) return;
      const item = btn.closest('[data-id]');
      if (!item) return;
      const id = item.dataset.id;
      const act = btn.dataset.act;
      const notice = state.notices.find(function (n) { return n.id === id; });
      if (!notice) return;

      if (act === 'edit') { fillForm(id); return; }
      if (act === 'pin') {
        notice.pinned = !notice.pinned;
        notice.updatedAt = Date.now();
        commit();
        return;
      }
      if (act === 'toggle') {
        notice.active = !notice.active;
        notice.updatedAt = Date.now();
        commit();
        toast(notice.active ? '전광판에 게시했습니다.' : '전광판에서 내렸습니다.');
        return;
      }
      if (act === 'dup') { duplicateNotice(id); return; }
      if (act === 'del') {
        if (!confirm('"' + (notice.title || '제목 없음') + '" 공지를 삭제할까요?')) return;
        if (editingId === id) resetForm();
        state.notices = state.notices.filter(function (n) { return n.id !== id; });
        commit();
        toast('공지를 삭제했습니다.');
      }
    });

    /* 폼 */
    const form = $('#noticeForm');
    form.addEventListener('submit', submitForm);
    $('#fBody').addEventListener('input', updateBodyCount);
    $('#btnCancelEdit').addEventListener('click', resetForm);
    $('#btnNewNotice').addEventListener('click', function () {
      resetForm();
      $('#fTitle').focus();
    });
    $('#btnDeleteNotice').addEventListener('click', deleteEditing);

    /* 설정 */
    $('#sOrg').addEventListener('input', function () {
      state.org = $('#sOrg').value;
      renderBrand();
      persistLocal();
      scheduleServerSync();
    });
    $('#sRotate').addEventListener('change', function () {
      state.settings.rotateSec = clamp(Number($('#sRotate').value) || 12, 4, 300);
      $('#sRotate').value = state.settings.rotateSec;
      persistLocal();
      renderDisplay(true);
      scheduleServerSync();
    });
    $('#sScale').addEventListener('input', function () {
      state.settings.scale = Number($('#sScale').value);
      $('#sScaleValue').textContent = Math.round(state.settings.scale * 100) + '%';
      applyScale();
      persistLocal();
    });
    $('#sTicker').addEventListener('input', function () {
      state.settings.ticker = $('#sTicker').value;
      renderTicker();
      persistLocal();
      scheduleServerSync();
    });
    $$('input[name="theme"]').forEach(function (radio) {
      radio.addEventListener('change', function () {
        if (radio.checked) setTheme(radio.value);
      });
    });
    $('#sShowTicker').addEventListener('change', function () {
      state.settings.showTicker = $('#sShowTicker').checked;
      renderTicker();
      persistLocal();
      scheduleServerSync();
    });
    $('#btnAddDept').addEventListener('click', addDept);
    $('#btnExport').addEventListener('click', exportJSON);
    $('#btnImport').addEventListener('click', function () { $('#importFile').click(); });
    $('#importFile').addEventListener('change', function (event) {
      const file = event.target.files && event.target.files[0];
      if (file) importJSON(file);
      event.target.value = '';
    });
    $('#btnReset').addEventListener('click', resetAll);
    $('#btnCopyUrl').addEventListener('click', async function () {
      const url = $('#shareUrl').value;
      try {
        await navigator.clipboard.writeText(url);
        toast('주소를 복사했습니다.');
      } catch (e) {
        $('#shareUrl').select();
        toast('주소를 선택했습니다. 직접 복사해 주세요.', 'error');
      }
    });

    /* 다이얼로그 닫기 */
    $$('[data-close]').forEach(function (btn) {
      btn.addEventListener('click', function () { btn.closest('dialog').close(); });
    });

    /* 전체화면 상태 */
    document.addEventListener('fullscreenchange', updateHud);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') {
        requestWakeLock();
        poll();
        renderDisplay();
        renderTicker();
      }
    });

    /* 창 크기가 바뀌면 글자 크기와 흐르는 문구를 다시 맞춘다 */
    let resizeTimer = null;
    window.addEventListener('resize', function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () {
        applyScale();
        renderTicker();
        const cur = $('#stage .slide.is-in');
        if (cur) fitSlide(cur);
      }, 180);
    });

    /* 단축키 */
    document.addEventListener('keydown', function (event) {
      const tag = (event.target.tagName || '').toLowerCase();
      const typing = tag === 'input' || tag === 'textarea' || tag === 'select' || event.target.isContentEditable;
      if (typing || $('dialog[open]')) return;
      if (document.body.dataset.view !== 'display') {
        if (event.key === 'Escape') setView('display');
        return;
      }

      if (event.code === 'Space') {
        event.preventDefault();
        setPaused(!disp.paused);
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        goTo(disp.idx + 1);
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        goTo(disp.idx - 1);
      } else if (event.key >= '1' && event.key <= '9') {
        const i = Number(event.key) - 1;
        if (i < disp.list.length) goTo(i);
      } else if (event.key === 'f' || event.key === 'F') {
        toggleFullscreen();
      } else if (event.key === 'a' || event.key === 'A') {
        setView('manage');
      } else if (event.key === '+' || event.key === '=') {
        state.settings.scale = clamp(state.settings.scale + 0.05, 0.75, 1.5);
        applyScale();
        persistLocal();
      } else if (event.key === '-' || event.key === '_') {
        state.settings.scale = clamp(state.settings.scale - 0.05, 0.75, 1.5);
        applyScale();
        persistLocal();
      }
    });

    /* 다른 탭·창과 즉시 동기화 */
    if ('BroadcastChannel' in window) {
      try {
        bc = new BroadcastChannel(CHANNEL_NAME);
        bc.onmessage = function (event) {
          if (event.data && event.data.type === 'state') applyFromLocal();
        };
      } catch (e) { bc = null; }
    }
    window.addEventListener('storage', function (event) {
      if (event.key === STORAGE_KEY) applyFromLocal();
    });
  }

  /** 화면 테마를 문서에 반영한다. 실제 색은 styles.css 의 토큰이 담당한다. */
  function applyTheme() {
    const theme = state.settings.theme === 'light' ? 'light' : 'dark';
    document.documentElement.dataset.theme = theme;
    $$('input[name="theme"]').forEach(function (radio) {
      radio.checked = radio.value === theme;
    });
  }

  function setTheme(theme) {
    const next = theme === 'light' ? 'light' : 'dark';
    state.settings.theme = next;
    applyTheme();
    touch();
  }

  function applyScale() {
    document.documentElement.style.setProperty('--dscale', String(state.settings.scale));
    const el = $('#sScale');
    if (el) {
      el.value = state.settings.scale;
      $('#sScaleValue').textContent = Math.round(state.settings.scale * 100) + '%';
    }
  }

  /* ────────────────────────── 부팅 ────────────────────────── */
  function boot() {
    const stored = loadLocal();
    pristine = !stored;

    if (stored) {
      state = normalize(stored);
    } else if (!/^https?:$/.test(location.protocol)) {
      // 파일로 바로 열었을 때만 예시 공지를 보여 준다.
      // (동기화 서버로 열면 서버에 저장된 공지를 그대로 받는다.)
      state = firstRunState();
      persistLocal();
      pristine = false;
    } else {
      state = normalize(null);
    }

    applyScale();
    bindEvents();
    resetForm();
    renderAll();
    tickClock();
    setInterval(tickClock, 1000);
    setInterval(function () { renderDisplay(); }, 30000);

    let view = 'display';
    try { view = localStorage.getItem(VIEW_KEY) || 'display'; } catch (e) { /* noop */ }
    setView(view === 'manage' ? 'manage' : 'display');
    setPaused(false);

    detectMode();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
