/* ==========================================================================
   LAB 3-1 — 토큰 예산 시뮬레이터
   전부 브라우저 안에서 도는 개념 시뮬레이션입니다. 실제 모델을 부르지 않고,
   벤치마크 수치를 재현하지도 않습니다. 곡선의 "모양"만 진짜입니다.

   토큰 회계 (공개 모델들이 실제로 쓰는 방식 그대로)
     타일 한 변 S, ViT 패치 P=14  →  타일 하나가 (S/P)² 패치
     압축비 c (1 = 그대로, 4 = pixel-shuffle 2×2)
     타일 T개 + (T>1이면) 전역 썸네일 1장
       N = (T + thumb) · (S/P)² / c
     유효 시력 — 썸네일은 세부를 더해주지 않으므로 타일만 센다
       R_eff = S · √T / √c   ( = P·√(N − 썸네일분) )

   비용 모델
     프리필 비용 ∝ 선형항(FFN·투영) + 제곱항(어텐션)
       cost(N) = L + L²/1000,  L = N + 텍스트 토큰
     1× 기준점은 "224px 단일 타일 1:1" = 256토큰. 즉 224 시대의 한 장면.
     분모 1000은 제곱항이 선형항을 넘어서는 지점을 정하는 눈금일 뿐입니다.

   정확도 곡선 (개념)
     acc(R) = floor + (ceil−floor)·R^h / (R^h + R50^h)   — Hill 형 포화곡선
     태스크마다 floor·ceil·R50·h가 다릅니다. 임의 단위이고, 특정 벤치마크의
     점수가 아닙니다.

   "무릎"의 정의
     (log 상대비용, 정확도) 평면에서 양 끝점을 잇는 직선으로부터 가장 멀리
     떨어진 점. Satopää et al.의 Kneedle 판정법(ICDCS-W 2011)과 같은 발상입니다.
   ========================================================================== */
(function () {
  'use strict';

  var curveEl = document.getElementById('b_curve');
  if (!curveEl) return;
  var tilesEl = document.getElementById('b_tiles');

  /* --- 상수 -------------------------------------------------------------- */
  var PATCH = 14;
  var TEXT = 48;
  var SIDES = [224, 336, 448, 672, 896];
  var TILES = [
    { t: 1, c: 1, r: 1 }, { t: 2, c: 2, r: 1 }, { t: 4, c: 2, r: 2 },
    { t: 6, c: 3, r: 2 }, { t: 9, c: 3, r: 3 }, { t: 12, c: 4, r: 3 }
  ];
  var COMPS = [
    { c: 1, label: '없음 · 1:1' },
    { c: 4, label: 'pixel-shuffle · ¼' }
  ];
  var NMIN = 64, NMAX = 65536;

  var TASKS = {
    doc:   { name: '문서 · OCR',  floor: 4,  ceil: 93, r50: 950, h: 2.4 },
    vqa:   { name: '일반 VQA',    floor: 42, ceil: 78, r50: 220, h: 3.0 },
    small: { name: '작은 물체',   floor: 10, ceil: 85, r50: 450, h: 3.0 }
  };

  /* --- 모델 -------------------------------------------------------------- */
  function cost(n) { var L = n + TEXT; return L + L * L / 1000; }
  var REF = cost(256);                       /* 224px 단일 타일 1:1 = 1× */
  function rel(n) { return cost(n) / REF; }
  function acc(task, R) {
    var x = Math.pow(Math.max(R, 1) / task.r50, task.h);
    return task.floor + (task.ceil - task.floor) * x / (1 + x);
  }
  /* 토큰 수 n 을 압축 없이 썼을 때의 유효 해상도 */
  function reffOf(n) { return PATCH * Math.sqrt(n); }

  /* --- 무릎 (태스크별로 한 번만 계산해 캐시) ----------------------------- */
  var kneeCache = {};
  function knee(key) {
    if (kneeCache[key]) return kneeCache[key];
    var task = TASKS[key];
    var M = 241, lo = Math.log(NMIN) / Math.LN2, hi = Math.log(NMAX) / Math.LN2;
    var ns = [], xs = [], ys = [], i, v;
    for (i = 0; i < M; i++) {
      v = Math.pow(2, lo + (hi - lo) * i / (M - 1));
      ns.push(v);
      xs.push(Math.log(cost(v)) / Math.LN2);
      ys.push(acc(task, reffOf(v)));
    }
    var x0 = xs[0], x1 = xs[M - 1], y0 = ys[0], y1 = ys[M - 1];
    var best = 0, bestD = -Infinity;
    for (i = 0; i < M; i++) {
      var d = (ys[i] - y0) / (y1 - y0) - (xs[i] - x0) / (x1 - x0);
      if (d > bestD) { bestD = d; best = i; }
    }
    var n = Math.round(ns[best]);
    return (kneeCache[key] = { n: n, acc: acc(task, reffOf(n)), rel: rel(n) });
  }

  /* --- 상태 -------------------------------------------------------------- */
  var st = { task: 'vqa', side: 2, tile: 2, comp: 1 };

  function derive() {
    var S = SIDES[st.side], g = S / PATCH;
    var T = TILES[st.tile], c = COMPS[st.comp].c;
    var perTile = g * g / c;
    var thumb = T.t > 1 ? 1 : 0;
    var nTiles = T.t * perTile;
    var n = Math.round(nTiles + thumb * perTile);
    return {
      side: S, grid: g, tiles: T, comp: c, thumb: thumb,
      perTile: Math.round(perTile),
      n: n,
      nTiles: Math.round(nTiles),
      raw: Math.round(S * Math.sqrt(T.t)),
      reff: Math.round(S * Math.sqrt(T.t) / Math.sqrt(c)),
      rel: rel(n)
    };
  }

  /* --- 캔버스 유틸 ------------------------------------------------------- */
  function css(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }
  function fit(canvas, w, h) {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
    var c = canvas.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    return c;
  }
  function fmt(n) { return Math.round(n).toLocaleString('en-US'); }
  function fmtRel(v) {
    if (v < 10) return v.toFixed(1) + '×';
    if (v < 10000) return fmt(v) + '×';
    return (v / 1000).toFixed(0) + 'k×';
  }

  /* --- 곡선 -------------------------------------------------------------- */
  var CW = 400, CH = 252;
  var padL = 36, padR = 42, padT = 16, padB = 30;
  var LOGN0 = Math.log(NMIN) / Math.LN2, LOGN1 = Math.log(NMAX) / Math.LN2;
  var CLO = -1, CHI = 4.4;                    /* 상대비용 축: 0.1× ~ 25,000× (log10) */

  function px(n) {
    var t = (Math.log(n) / Math.LN2 - LOGN0) / (LOGN1 - LOGN0);
    return padL + Math.max(0, Math.min(1, t)) * (CW - padL - padR);
  }
  function pyAcc(a) { return CH - padB - (a / 100) * (CH - padT - padB); }
  function pyCost(v) {
    var t = (Math.log(v) / Math.LN10 - CLO) / (CHI - CLO);
    return CH - padB - Math.max(0, Math.min(1, t)) * (CH - padT - padB);
  }

  function drawCurve() {
    var ctx = fit(curveEl, CW, CH);
    var vis = css('--vis'), lang = css('--lang'), line = css('--line'),
        tx3 = css('--tx3'), tx2 = css('--tx2'), panel = css('--panel'),
        panel2 = css('--panel2'), ok = css('--ok');
    var task = TASKS[st.task], k = knee(st.task), d = derive();

    ctx.clearRect(0, 0, CW, CH);
    ctx.fillStyle = panel2; ctx.fillRect(0, 0, CW, CH);

    var mono = '10px "IBM Plex Mono", ui-monospace, monospace';

    /* 격자 · 눈금 */
    ctx.font = mono; ctx.textBaseline = 'middle';
    ctx.strokeStyle = line; ctx.lineWidth = 1;
    var xt = [64, 512, 4096, 32768];
    ctx.textAlign = 'center';
    for (var i = 0; i < xt.length; i++) {
      var X = px(xt[i]);
      ctx.globalAlpha = 0.55;
      ctx.beginPath(); ctx.moveTo(X, padT); ctx.lineTo(X, CH - padB); ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = tx3;
      ctx.fillText(xt[i] >= 1024 ? (xt[i] / 1024) + 'k' : xt[i], X, CH - padB + 11);
    }
    ctx.textAlign = 'right';
    for (var a = 0; a <= 100; a += 25) {
      var Y = pyAcc(a);
      ctx.globalAlpha = 0.4;
      ctx.beginPath(); ctx.moveTo(padL, Y); ctx.lineTo(CW - padR, Y); ctx.stroke();
      ctx.globalAlpha = 1;
      if (a % 50 === 0) { ctx.fillStyle = tx3; ctx.fillText(a, padL - 5, Y); }
    }
    /* 오른쪽 = 상대 비용(log) */
    ctx.textAlign = 'left';
    var ct = [1, 100, 10000];
    for (var j = 0; j < ct.length; j++) {
      ctx.fillStyle = lang; ctx.globalAlpha = 0.75;
      ctx.fillText(fmtRel(ct[j]), CW - padR + 5, pyCost(ct[j]));
      ctx.globalAlpha = 1;
    }

    /* 비용 곡선(호박) */
    ctx.beginPath();
    for (var s = 0; s <= 120; s++) {
      var n = Math.pow(2, LOGN0 + (LOGN1 - LOGN0) * s / 120);
      var X2 = px(n), Y2 = pyCost(rel(n));
      s ? ctx.lineTo(X2, Y2) : ctx.moveTo(X2, Y2);
    }
    ctx.strokeStyle = lang; ctx.lineWidth = 1.6;
    ctx.setLineDash([5, 3]); ctx.stroke(); ctx.setLineDash([]);

    /* 무릎 표시 */
    var kx = px(k.n);
    ctx.strokeStyle = ok; ctx.lineWidth = 1; ctx.globalAlpha = 0.75;
    ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(kx, padT); ctx.lineTo(kx, CH - padB); ctx.stroke();
    ctx.setLineDash([]); ctx.globalAlpha = 1;
    ctx.fillStyle = ok; ctx.textAlign = kx > CW * 0.62 ? 'right' : 'left';
    ctx.fillText('무릎 ' + fmt(k.n) + 'tok', kx + (kx > CW * 0.62 ? -5 : 5), padT + 6);

    /* 정확도 곡선(청록) */
    ctx.beginPath();
    for (var t2 = 0; t2 <= 160; t2++) {
      var n2 = Math.pow(2, LOGN0 + (LOGN1 - LOGN0) * t2 / 160);
      var X3 = px(n2), Y3 = pyAcc(acc(task, reffOf(n2)));
      t2 ? ctx.lineTo(X3, Y3) : ctx.moveTo(X3, Y3);
    }
    ctx.strokeStyle = vis; ctx.lineWidth = 2.2; ctx.stroke();

    /* 현재 지점 */
    var mx = px(Math.max(NMIN, Math.min(NMAX, d.n)));
    var my = pyAcc(acc(task, d.reff));
    ctx.strokeStyle = vis; ctx.globalAlpha = 0.45; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(mx, my); ctx.lineTo(mx, CH - padB); ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.beginPath(); ctx.arc(mx, my, 5.5, 0, 7);
    ctx.fillStyle = vis; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = panel; ctx.stroke();

    /* 축 이름 */
    ctx.fillStyle = tx2; ctx.textAlign = 'left';
    ctx.fillText('개념 정확도', padL + 2, padT + 6);
    ctx.textAlign = 'right';
    ctx.fillStyle = tx3;
    ctx.fillText('시각 토큰 수 →', CW - padR, CH - padB + 11);
  }

  /* --- 타일 배치 --------------------------------------------------------- */
  var TW = 208, TH = 150;
  function drawTiles() {
    if (!tilesEl) return;
    var ctx = fit(tilesEl, TW, TH);
    var vis = css('--vis'), lang = css('--lang'), line = css('--line'),
        tx3 = css('--tx3'), panel2 = css('--panel2');
    var d = derive();
    ctx.clearRect(0, 0, TW, TH);
    ctx.fillStyle = panel2; ctx.fillRect(0, 0, TW, TH);

    /* 원본 이미지 자리 (4:3) */
    var iw = 132, ih = 99, ix = 10, iy = 12;
    ctx.fillStyle = line; ctx.fillRect(ix, iy, iw, ih);
    /* 안에 "내용"을 몇 줄 — 글자줄 + 작은 물체 */
    ctx.fillStyle = tx3; ctx.globalAlpha = 0.7;
    for (var r = 0; r < 5; r++) {
      ctx.fillRect(ix + 8, iy + 12 + r * 9, iw * (0.62 - r * 0.05), 3);
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = lang;
    ctx.beginPath(); ctx.arc(ix + iw * 0.8, iy + ih * 0.72, 4.5, 0, 7); ctx.fill();

    /* 타일 격자 */
    var T = d.tiles;
    ctx.strokeStyle = vis; ctx.lineWidth = 1.4;
    for (var c = 0; c < T.c; c++) {
      for (var rr = 0; rr < T.r; rr++) {
        ctx.strokeRect(ix + c * iw / T.c + 0.7, iy + rr * ih / T.r + 0.7,
                       iw / T.c - 1.4, ih / T.r - 1.4);
      }
    }

    /* 썸네일 */
    ctx.font = '10px "IBM Plex Mono", ui-monospace, monospace';
    ctx.textBaseline = 'top';
    if (d.thumb) {
      var tw = 40, th = 30, tx = ix + iw + 14, ty = iy + 6;
      ctx.fillStyle = line; ctx.fillRect(tx, ty, tw, th);
      ctx.strokeStyle = vis; ctx.lineWidth = 1.4;
      ctx.strokeRect(tx + 0.7, ty + 0.7, tw - 1.4, th - 1.4);
      ctx.fillStyle = tx3;
      ctx.fillText('썸네일', tx - 2, ty + th + 5);
      ctx.fillText('+' + fmt(d.perTile), tx - 2, ty + th + 18);
    }

    /* 캡션 */
    ctx.fillStyle = tx3; ctx.textAlign = 'left';
    ctx.fillText(d.side + 'px 타일 ' + T.t + '개 (' + T.c + '×' + T.r + ')',
                 ix, iy + ih + 8);
    ctx.fillText('타일당 ' + fmt(d.perTile) + ' 토큰', ix, iy + ih + 21);
    ctx.textBaseline = 'alphabetic';
  }

  /* --- UI ---------------------------------------------------------------- */
  var el = {
    side: document.getElementById('b_side'), sideV: document.getElementById('b_sidev'),
    tile: document.getElementById('b_tile'), tileV: document.getElementById('b_tilev'),
    ntok: document.getElementById('b_ntok'), reff: document.getElementById('b_reff'),
    cost: document.getElementById('b_cost'), accv: document.getElementById('b_acc'),
    knee: document.getElementById('b_knee'), verdict: document.getElementById('b_verdict')
  };
  var taskBtns = document.querySelectorAll('#b_task button');
  var compBtns = document.querySelectorAll('#b_comp button');

  function verdict(d, k) {
    var ratio = d.n / k.n;
    var gap = acc(TASKS[st.task], reffOf(k.n)) - acc(TASKS[st.task], d.reff);
    if (ratio < 0.55) {
      return '무릎 <b>한참 왼쪽</b>입니다 — 토큰을 더 쓰면 정확도가 눈에 띄게 오릅니다. ' +
             '무릎(' + fmt(k.n) + '토큰)까지 올리면 개념 정확도가 ' +
             gap.toFixed(1) + '점 더 붙습니다.';
    }
    if (ratio <= 1.9) {
      return '<b>무릎 근처</b>입니다 — 이 태스크에서 토큰당 이득이 가장 좋은 구간입니다. ' +
             '대개 여기서 멈추는 편이 이깁니다.';
    }
    return '무릎 <b>오른쪽</b>입니다 — 정확도는 ' + Math.abs(gap).toFixed(1) +
           '점 오르는데 비용은 무릎의 ' + fmtRel(d.rel / k.rel) +
           '입니다. 이 지출이 정말 필요한지 되물어볼 자리입니다.';
  }

  function refresh() {
    var d = derive(), k = knee(st.task), task = TASKS[st.task];
    if (el.sideV) el.sideV.textContent = d.side + 'px (' + d.grid + '×' + d.grid + ' 패치)';
    if (el.tileV) el.tileV.textContent = d.tiles.t + '개 · ' + d.tiles.c + '×' + d.tiles.r;
    if (el.ntok) el.ntok.textContent = fmt(d.n);
    if (el.reff) el.reff.textContent = fmt(d.reff) + 'px';
    if (el.cost) {
      el.cost.textContent = fmtRel(d.rel);
      el.cost.className = d.rel > 200 ? 'warn' : '';
    }
    if (el.accv) el.accv.textContent = acc(task, d.reff).toFixed(1);
    if (el.knee) el.knee.textContent = fmt(k.n) + ' tok · ' + fmtRel(k.rel);
    if (el.verdict) el.verdict.innerHTML = verdict(d, k);
    drawCurve(); drawTiles();
  }

  if (el.side) el.side.addEventListener('input', function () {
    st.side = parseInt(el.side.value, 10); refresh();
  });
  if (el.tile) el.tile.addEventListener('input', function () {
    st.tile = parseInt(el.tile.value, 10); refresh();
  });
  Array.prototype.forEach.call(taskBtns, function (b) {
    b.addEventListener('click', function () {
      Array.prototype.forEach.call(taskBtns, function (x) { x.classList.remove('sel'); });
      b.classList.add('sel');
      st.task = b.getAttribute('data-task');
      refresh();
    });
  });
  Array.prototype.forEach.call(compBtns, function (b) {
    b.addEventListener('click', function () {
      Array.prototype.forEach.call(compBtns, function (x) { x.classList.remove('sel'); });
      b.classList.add('sel');
      st.comp = parseInt(b.getAttribute('data-c'), 10);
      refresh();
    });
  });

  /* 폭이 좁으면 곡선을 줄인다.
     캔버스의 바로 위 부모는 캔버스 크기를 따라가므로(순환) 재면 안 됩니다 —
     블록 레벨인 .lab 카드의 폭을 기준으로 잡습니다. */
  function labWidth() {
    var n = curveEl.parentNode;
    while (n && n.classList && !n.classList.contains('lab')) n = n.parentNode;
    var w = (n && n.clientWidth) || 0;
    if (!w) w = (document.documentElement && document.documentElement.clientWidth) || 400;
    return w;
  }
  function resize() {
    var inner = labWidth() - 48;           /* .lab 좌우 패딩 24 × 2 */
    /* 넓으면 컨트롤과 2단으로 놓이므로 400 고정, 좁으면 카드 폭에 맞춘다 */
    CW = labWidth() >= 680 ? 400 : Math.max(250, Math.min(400, inner));
    refresh();
  }
  var rt = null;
  window.addEventListener('resize', function () {
    if (rt) clearTimeout(rt);
    rt = setTimeout(resize, 140);
  });

  /* 테마가 바뀌면 캔버스 색도 따라간다 */
  new MutationObserver(refresh).observe(document.documentElement,
    { attributes: true, attributeFilter: ['data-theme'] });

  resize();
})();
