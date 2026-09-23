/* ======================================================================
   АТРИУМ 210° — НАСТРОЙКИ
   Всё, что обычно меняют, находится в этом блоке.
   Координаты — в пикселях исходной картинки 6516 × 2172.
   ====================================================================== */
const ATRIUM = {
  overline: 'Glonari',          // подпись над заголовком ('' — скрыть)
  title: 'Digital Banker',      // главная строка заголовка ('' — скрыть)
  subtitle: 'Atrium',           // золотая строка под заголовком ('' — скрыть)
  hint: 'Drag to look around. Choose a doorway to enter.',
  hintTouch: 'Swipe to look around. Tap a doorway to enter.',

  image: {
    full:  'assets/atrium-6516.webp',   // для компьютеров
    small: 'assets/atrium-3258.webp',   // для телефонов
    width: 6516, height: 2172,
    spanDeg: 210,        // сколько градусов по горизонтали покрывает картинка
    horizonY: 1275,      // уровень глаз камеры (пиксель по вертикали)
  },

  // door:   cx — центр проёма, hw — половина ширины, top — верх арки, bottom — порог
  // plaque: филёнка над аркой, куда вписывается надпись
  // href:   куда вести по клику (null — показать экран комнаты-заглушку)
  rooms: [
    { id: 'experience', name: 'Experience', inscription: ['Experience'],
      door: { cx: 549,  hw: 255, top: 590, bottom: 1735 },
      plaque: { cx: 575,  w: 533, top: 307, bottom: 537 }, href: null },
    { id: 'globalReserve', name: 'Global Reserve', inscription: ['Global', 'Reserve'],
      door: { cx: 1354, hw: 228, top: 710, bottom: 1695 },
      plaque: { cx: 1368, w: 456, top: 494, bottom: 669 }, href: null,
      video: 'assets/global-reserve.mp4' },
    { id: 'globalDream', name: 'Global Dream', inscription: ['Global', 'Dream'],
      door: { cx: 2017, hw: 172, top: 810, bottom: 1665 },
      plaque: { cx: 2034, w: 364, top: 632, bottom: 765 }, href: null },
    { id: 'globalConnections', name: 'Global Connections', inscription: ['Global', 'Connections'],
      door: { cx: 4501, hw: 172, top: 810, bottom: 1665 },
      plaque: { cx: 4482, w: 364, top: 632, bottom: 765 }, href: null },
    { id: 'recordLibrary', name: 'Record Library', inscription: ['Record', 'Library'],
      door: { cx: 5162, hw: 228, top: 710, bottom: 1695 },
      plaque: { cx: 5149, w: 456, top: 494, bottom: 669 }, href: null },
    { id: 'moveMoney', name: 'Move Money', inscription: ['Move', 'Money'],
      door: { cx: 5967, hw: 255, top: 590, bottom: 1735 },
      plaque: { cx: 5940, w: 533, top: 307, bottom: 537 }, href: null },
  ],
  roomPlaceholder: 'This room is being prepared. Its content will appear here soon.',
};

/* ====================================================================== */
(() => {
  'use strict';
  const IMG = ATRIUM.image;
  const W = IMG.width, H = IMG.height;
  const SPAN = THREE.MathUtils.degToRad(IMG.spanDeg);
  const R = W / SPAN;                        // радиус цилиндра в пикселях
  const TAN_TOP = IMG.horizonY / R;          // верх картинки (тангенс угла)
  const TAN_BOT = -(H - IMG.horizonY) / R;   // низ картинки
  const MAX_SPAN = TAN_TOP - TAN_BOT;
  const MIN_SPAN = MAX_SPAN * 0.42;
  const MAX_HALF_W = Math.tan(THREE.MathUtils.degToRad(80));
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const $ = (id) => document.getElementById(id);
  const stage = $('stage'), svg = $('overlay'), caption = $('caption');
  const roomView = $('room'), roomTitle = $('room-title'), roomText = $('room-text');
  const roomVideo = $('room-video'), backBtn = $('back'), veil = $('veil');
  const nav = $('rooms-nav');

  for (const key of ['overline', 'title', 'subtitle']) {
    $(key).textContent = ATRIUM[key];
    $(key).hidden = !ATRIUM[key];
  }
  const coarse = matchMedia('(pointer: coarse)').matches;
  const HINT = coarse ? ATRIUM.hintTouch : ATRIUM.hint;
  caption.textContent = HINT;

  /* ---------- WebGL ---------- */
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  } catch (e) {
    $('status').textContent = 'This view needs WebGL. Turn on hardware acceleration in your browser settings, then reload the page.';
    return;
  }
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.outputEncoding = THREE.sRGBEncoding;
  stage.prepend(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();

  /* ---------- координаты: пиксель картинки -> точка на цилиндре ---------- */
  const angleOf = (px) => (px - W / 2) / R;
  function toWorld(px, py) {
    const a = angleOf(px);
    return new THREE.Vector3(Math.sin(a), (IMG.horizonY - py) / R, -Math.cos(a));
  }

  /* ---------- вид ---------- */
  const view = { yaw: 0, cy: (TAN_TOP + TAN_BOT) / 2, span: MAX_SPAN };
  const target = { ...view };
  let vel = 0, dirty = true, anim = null;
  let vw = 1, vh = 1, aspect = 1;

  function clampView(v) {
    v.span = THREE.MathUtils.clamp(v.span, MIN_SPAN, MAX_SPAN);
    if ((v.span / 2) * aspect > MAX_HALF_W) v.span = (2 * MAX_HALF_W) / aspect;
    v.cy = THREE.MathUtils.clamp(v.cy, TAN_BOT + v.span / 2, TAN_TOP - v.span / 2);
    const halfH = Math.atan((v.span / 2) * aspect);
    const lim = Math.max(0, SPAN / 2 - halfH);
    v.yaw = THREE.MathUtils.clamp(v.yaw, -lim, lim);
    return v;
  }
  function applyCamera() {
    const n = 0.01, halfW = (view.span / 2) * aspect;
    camera.projectionMatrix.makePerspective(-halfW * n, halfW * n,
      (view.cy + view.span / 2) * n, (view.cy - view.span / 2) * n, n, 10);
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
    camera.rotation.set(0, -view.yaw, 0);
    camera.updateMatrixWorld(true);
  }
  function resize() {
    vw = stage.clientWidth; vh = stage.clientHeight; aspect = vw / vh;
    renderer.setSize(vw, vh, false);
    svg.setAttribute('viewBox', `0 0 ${vw} ${vh}`);
    clampView(target); clampView(view); dirty = true;
  }
  addEventListener('resize', resize);

  /* ---------- надписи на филёнках (рисуются прямо в текстуру) ---------- */
  function drawSpaced(ctx, text, x, y, spacing) {
    const chars = [...text];
    const widths = chars.map((c) => ctx.measureText(c).width);
    const total = widths.reduce((s, w) => s + w, 0) + spacing * (chars.length - 1);
    let cx = x - total / 2;
    chars.forEach((c, i) => { ctx.fillText(c, cx, y); cx += widths[i] + spacing; });
  }
  function textWidth(ctx, text, spacing) {
    return [...text].reduce((s, c) => s + ctx.measureText(c).width, 0) + spacing * (text.length - 1);
  }
  function drawInscription(ctx, room) {
    const p = room.plaque, lines = room.inscription.map((l) => l.toUpperCase());
    const ph = p.bottom - p.top, maxW = p.w * 0.8;
    let size = (ph * 0.66) / (lines.length * 1.18);
    const fit = () => {
      ctx.font = `600 ${size}px Cinzel, "Trajan Pro", Georgia, serif`;
      return Math.max(...lines.map((l) => textWidth(ctx, l, size * 0.14)));
    };
    while (fit() > maxW && size > 8) size *= 0.95;
    const sp = size * 0.14, lh = size * 1.18;
    const y0 = p.top + ph / 2 - (lh * (lines.length - 1)) / 2;
    ctx.textBaseline = 'middle';
    const d = Math.max(1, size * 0.045);
    lines.forEach((line, i) => {
      const y = y0 + i * lh;
      ctx.fillStyle = 'rgba(58, 32, 8, 0.8)';      // тень верхней кромки врезки
      drawSpaced(ctx, line, p.cx, y - d * 1.3, sp);
      ctx.fillStyle = 'rgba(255, 249, 232, 0.75)'; // блик нижней кромки
      drawSpaced(ctx, line, p.cx, y + d * 1.1, sp);
      const g = ctx.createLinearGradient(0, y - size / 2, 0, y + size / 2);
      g.addColorStop(0, '#6a4214'); g.addColorStop(0.42, '#c8943c');
      g.addColorStop(0.58, '#a8742c'); g.addColorStop(1, '#5c3810');
      ctx.fillStyle = g;
      drawSpaced(ctx, line, p.cx, y, sp);
    });
  }

  /* ---------- цилиндр из 4 плиток (помещается в текстуры любых телефонов) ---------- */
  function buildTile(canvas, a0, a1) {
    const seg = 40, pos = [], uv = [], idx = [];
    const yT = TAN_TOP, yB = TAN_BOT;
    for (let i = 0; i <= seg; i++) {
      const t = i / seg, a = a0 + (a1 - a0) * t, x = Math.sin(a), z = -Math.cos(a);
      pos.push(x, yT, z, x, yB, z); uv.push(t, 1, t, 0);
      if (i < seg) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    const tex = new THREE.CanvasTexture(canvas);
    tex.encoding = THREE.sRGBEncoding;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    scene.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide })));
  }
  function buildPanorama(img) {
    const s = img.naturalWidth / W, N = 4, tw = Math.round(img.naturalWidth / N);
    for (let i = 0; i < N; i++) {
      const x0 = (i * W) / N, x1 = ((i + 1) * W) / N;
      const c = document.createElement('canvas');
      c.width = i === N - 1 ? img.naturalWidth - tw * i : tw; c.height = img.naturalHeight;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, -tw * i, 0);
      ctx.save(); ctx.scale(s, s); ctx.translate(-x0, 0);
      ATRIUM.rooms.forEach((r) => {
        if (r.plaque.cx + r.plaque.w / 2 > x0 && r.plaque.cx - r.plaque.w / 2 < x1) drawInscription(ctx, r);
      });
      ctx.restore();
      buildTile(c, angleOf(x0), angleOf(x1));
    }
  }

  /* ---------- контуры проёмов для наведения и клика ---------- */
  function doorOutline(d) {
    const pts = [], spring = d.top + d.hw, x0 = d.cx - d.hw, x1 = d.cx + d.hw;
    for (let i = 0; i <= 6; i++) pts.push([x0, d.bottom + (spring - d.bottom) * (i / 6)]);
    for (let i = 1; i < 28; i++) {
      const t = Math.PI - (Math.PI * i) / 28;
      pts.push([d.cx + d.hw * Math.cos(t), spring - d.hw * Math.sin(t)]);
    }
    for (let i = 0; i <= 6; i++) pts.push([x1, spring + (d.bottom - spring) * (i / 6)]);
    for (let i = 1; i < 10; i++) pts.push([x1 - (x1 - x0) * (i / 10), d.bottom]);
    return pts.map(([x, y]) => toWorld(x, y));
  }
  function plaqueOutline(p) {
    const x0 = p.cx - p.w / 2, x1 = p.cx + p.w / 2, pts = [];
    for (let i = 0; i <= 8; i++) pts.push([x0 + (x1 - x0) * (i / 8), p.top]);
    for (let i = 0; i <= 8; i++) pts.push([x1 - (x1 - x0) * (i / 8), p.bottom]);
    return pts.map(([x, y]) => toWorld(x, y));
  }
  const SVGNS = 'http://www.w3.org/2000/svg';
  const mk = (tag, attrs) => { const el = document.createElementNS(SVGNS, tag); for (const k in attrs) el.setAttribute(k, attrs[k]); return el; };
  const dimPath = mk('path', { class: 'dim', 'fill-rule': 'evenodd' });
  const glowPath = mk('path', { class: 'glow' });
  svg.append(dimPath, glowPath);

  const rooms = ATRIUM.rooms.map((r) => {
    const hit = mk('path', { class: 'door', 'data-room': r.id });
    svg.appendChild(hit);
    const btn = document.createElement('button');
    btn.type = 'button'; btn.textContent = `Enter ${r.name}`; btn.dataset.room = r.id;
    nav.appendChild(btn);
    return { ...r, hit, btn, world: doorOutline(r.door), plaqueWorld: plaqueOutline(r.plaque), d: '', pd: '' };
  });
  const byId = Object.fromEntries(rooms.map((r) => [r.id, r]));

  const tmp = new THREE.Vector3();
  function project(list) {
    let out = '';
    for (let i = 0; i < list.length; i++) {
      tmp.copy(list[i]).applyMatrix4(camera.matrixWorldInverse);
      if (tmp.z > -0.02) return '';
      tmp.applyMatrix4(camera.projectionMatrix);
      out += `${i ? 'L' : 'M'}${((tmp.x + 1) / 2 * vw).toFixed(1)} ${((1 - tmp.y) / 2 * vh).toFixed(1)}`;
    }
    return out + 'Z';
  }
  function updateOverlay() {
    rooms.forEach((r) => {
      r.d = project(r.world); r.pd = project(r.plaqueWorld);
      r.hit.setAttribute('d', r.d);
      r.hit.style.display = r.d ? '' : 'none';
    });
    const a = active && byId[active];
    dimPath.setAttribute('d', `M0 0H${vw}V${vh}H0Z` + (a ? a.d + a.pd : ''));
    glowPath.setAttribute('d', a ? a.d : '');
  }

  /* ---------- активный проём (наведение или фокус) ---------- */
  let active = null;
  function setActive(id) {
    if (active === id) return;
    active = id;
    svg.classList.toggle('has-active', !!id);
    stage.classList.toggle('pointing', !!id);
    caption.textContent = id ? `Enter ${byId[id].name}` : HINT;
    dirty = true;
  }

  /* ---------- анимация вида ---------- */
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  let animDone = null;
  function animateTo(to, ms, done) {
    // если прерываем предыдущую анимацию — всё равно выполняем её завершение
    if (anim && animDone) { const prev = animDone; animDone = null; prev(); }
    animDone = done || null;
    const from = { ...view };
    const t0 = performance.now();
    vel = 0;
    anim = (now) => {
      const t = Math.min(1, (now - t0) / ms), k = ease(t);
      view.yaw = from.yaw + (to.yaw - from.yaw) * k;
      view.cy = from.cy + (to.cy - from.cy) * k;
      view.span = from.span + (to.span - from.span) * k;
      clampView(view); Object.assign(target, view); dirty = true;
      if (t >= 1) { anim = null; const cb = animDone; animDone = null; cb && cb(); }
    };
  }
  function lookAtDoor(r) {
    const to = clampView({ yaw: angleOf(r.door.cx), cy: view.cy, span: view.span });
    animateTo(to, reduceMotion ? 1 : 700);
  }

  /* ---------- вход в комнату и возврат ---------- */
  let inRoom = null, savedView = null, busyFlag = false, busyTimer = 0;
  const setBusy = (v) => {
    busyFlag = v; clearTimeout(busyTimer);
    if (v) busyTimer = setTimeout(() => { busyFlag = false; }, 4000);
  };
  function enterRoom(id) {
    const r = byId[id];
    if (!r || busyFlag || inRoom) return;
    setBusy(true); savedView = { ...view }; setActive(id);
    document.body.classList.add('entering');
    const d = r.door, doorMid = (d.top + d.bottom) / 2;
    const to = { yaw: angleOf(d.cx), cy: (IMG.horizonY - doorMid) / R, span: ((d.bottom - d.top) / R) * 0.62 };
    if (r.video) { roomVideo.src = r.video; roomVideo.load(); }
    animateTo(to, reduceMotion ? 1 : 1150, () => {
      veil.classList.add('on');
      setTimeout(() => {
        if (r.href) { location.href = r.href; return; }
        document.body.classList.remove('entering');
        inRoom = id;
        roomTitle.textContent = r.name;
        roomText.textContent = r.text || ATRIUM.roomPlaceholder;
        roomView.classList.toggle('with-video', !!r.video);
        roomView.hidden = false;
        document.body.classList.add('in-room');
        if (r.video) roomVideo.play().catch(() => {});
        requestAnimationFrame(() => { veil.classList.remove('on'); roomView.classList.add('shown'); });
        backBtn.focus({ preventScroll: true });
        setBusy(false);
      }, reduceMotion ? 60 : 380);
    });
  }
  function leaveRoom() {
    if (!inRoom || busyFlag) return;
    setBusy(true);
    const r = byId[inRoom];
    veil.classList.add('on');
    setTimeout(() => {
      roomView.classList.remove('shown'); roomView.hidden = true;
      document.body.classList.remove('in-room');
      roomVideo.pause(); roomVideo.removeAttribute('src'); roomVideo.load();
      inRoom = null; veil.classList.remove('on');
      document.body.classList.remove('entering');
      animateTo(clampView({ ...savedView }), reduceMotion ? 1 : 900, () => { setBusy(false); });
      setActive(null);
      r.btn.focus({ preventScroll: true });
    }, reduceMotion ? 60 : 380);
  }
  backBtn.addEventListener('click', leaveRoom);

  /* ---------- мышь, палец, колесо ---------- */
  const pointers = new Map();
  let drag = null, pinch = null;
  const radPerPx = () => (2 * Math.atan((view.span / 2) * aspect)) / vw;

  stage.addEventListener('pointerdown', (e) => {
    if (inRoom || busyFlag) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    stage.setPointerCapture(e.pointerId);
    if (anim && animDone) { const cb = animDone; animDone = null; cb(); }
    anim = null; vel = 0;
    if (pointers.size === 1) {
      const el = e.target.closest && e.target.closest('[data-room]');
      drag = { x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY, t: performance.now(), moved: 0, room: el ? el.dataset.room : null, type: e.pointerType };
    } else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), span: target.span };
      drag = null;
    }
  });
  stage.addEventListener('pointermove', (e) => {
    if (inRoom) return;
    if (!pointers.has(e.pointerId)) {
      if (e.pointerType === 'mouse' && !busyFlag) {
        const el = e.target.closest && e.target.closest('[data-room]');
        setActive(el ? el.dataset.room : null);
      }
      return;
    }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      target.span = pinch.span * (pinch.dist / Math.max(20, Math.hypot(a.x - b.x, a.y - b.y)));
      clampView(target); dirty = true; return;
    }
    if (!drag) return;
    const dx = e.clientX - drag.lx, dy = e.clientY - drag.ly;
    drag.moved += Math.abs(dx) + Math.abs(dy);
    drag.lx = e.clientX; drag.ly = e.clientY;
    if (drag.moved > 6) {
      stage.classList.add('dragging');
      const k = radPerPx();
      target.yaw -= dx * k; vel = -dx * k;
      target.cy += dy * (view.span / vh);
      clampView(target); dirty = true;
    }
  });
  function endPointer(e) {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    stage.classList.remove('dragging');
    if (drag && pointers.size === 0) {
      if (drag.moved <= 6 && drag.room && e.type === 'pointerup') enterRoom(drag.room);
      drag = null;
    }
  }
  stage.addEventListener('pointerup', endPointer);
  stage.addEventListener('pointercancel', endPointer);
  stage.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse' && !pointers.size) setActive(null); });
  stage.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (inRoom || busyFlag) return;
    anim = null;
    target.span *= Math.exp(e.deltaY * 0.0012);
    clampView(target); dirty = true;
  }, { passive: false });

  /* ---------- кнопки «к соседнему проёму» (телефоны и узкие экраны) ---------- */
  const ordered = [...rooms].sort((a, b) => a.door.cx - b.door.cx);
  function stepRoom(dir) {
    if (inRoom || busyFlag) return;
    const cur = active ? angleOf(byId[active].door.cx) : view.yaw;
    const eps = active ? 0.01 : 0.12;
    const list = dir > 0 ? ordered : [...ordered].reverse();
    const next = list.find((r) => (angleOf(r.door.cx) - cur) * dir > eps) || list[list.length - 1];
    setActive(next.id); lookAtDoor(next);
  }
  $('prev').addEventListener('click', () => stepRoom(-1));
  $('next').addEventListener('click', () => stepRoom(1));

  /* ---------- клавиатура ---------- */
  nav.addEventListener('focusin', (e) => {
    const id = e.target.dataset.room; if (!id || inRoom || busyFlag) return;
    setActive(id); lookAtDoor(byId[id]);
  });
  nav.addEventListener('focusout', () => { if (!inRoom && !busyFlag) setActive(null); });
  nav.addEventListener('click', (e) => { const id = e.target.dataset && e.target.dataset.room; if (id) enterRoom(id); });
  addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && inRoom) { leaveRoom(); return; }
    if (inRoom || busyFlag) return;
    const step = 0.09;
    if (e.key === 'ArrowLeft') target.yaw -= step;
    else if (e.key === 'ArrowRight') target.yaw += step;
    else if (e.key === 'ArrowUp') target.cy += step * 0.5;
    else if (e.key === 'ArrowDown') target.cy -= step * 0.5;
    else if (e.key === '+' || e.key === '=') target.span *= 0.88;
    else if (e.key === '-') target.span /= 0.88;
    else return;
    e.preventDefault(); anim = null; clampView(target); dirty = true;
  });

  /* ---------- цикл ---------- */
  function tick(now) {
    requestAnimationFrame(tick);
    if (anim) anim(now);
    else {
      if (!drag && vel) { target.yaw += vel; vel *= 0.92; if (Math.abs(vel) < 1e-5) vel = 0; clampView(target); dirty = true; }
      const f = 0.2;
      const dy = target.yaw - view.yaw, dc = target.cy - view.cy, ds = target.span - view.span;
      if (Math.abs(dy) + Math.abs(dc) + Math.abs(ds) > 1e-6) {
        view.yaw += dy * f; view.cy += dc * f; view.span += ds * f; clampView(view); dirty = true;
      }
    }
    if (!dirty) return;
    dirty = false;
    applyCamera();
    renderer.render(scene, camera);
    updateOverlay();
  }

  /* ---------- загрузка ---------- */
  const small = Math.min(screen.width, screen.height) < 700 ||
    renderer.capabilities.maxTextureSize < 4096;
  const img = new Image();
  img.decoding = 'async';
  img.src = small ? IMG.small : IMG.full;
  const fontsReady = Promise.race([
    document.fonts ? document.fonts.load('600 64px Cinzel') : Promise.resolve(),
    new Promise((r) => setTimeout(r, 2500)),
  ]);
  Promise.all([img.decode ? img.decode() : new Promise((r) => (img.onload = r)), fontsReady])
    .then(() => {
      buildPanorama(img);
      resize();
      if (!reduceMotion) {
        view.yaw = -0.5; clampView(view); Object.assign(target, view);
        animateTo(clampView({ yaw: 0, cy: view.cy, span: view.span }), 2400);
      }
      requestAnimationFrame(tick);
      document.body.classList.add('ready');
    })
    .catch(() => { $('status').textContent = 'The atrium image did not load. Check that the assets folder sits next to index.html, then reload.'; });
})();
