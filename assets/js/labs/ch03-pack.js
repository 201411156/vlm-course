/* ==========================================================================
   LAB 3-3 — 타일 이어 붙이기 시뮬레이터
   3-4절의 pack_image_features 세 단계(재조립 · 패딩 제거 · 줄바꿈)를 손으로
   만져 보는 실습입니다. 실제 모델을 부르지 않고, 순서만 그대로 흉내 냅니다.

   축척
     원본 = 4×4 칸짜리 타일 2×2 = 8×8 = 64칸.
     본문의 실제 수치(24×24 타일 2×2 = 48×48 = 2,304칸)를 6분의 1로 줄인 것이라
     세는 방식은 완전히 같습니다.

   패딩
     아래쪽 타일 두 장의 마지막 두 행(전체 격자의 6·7행)이 패딩입니다.
     걷어내면 64 → 48칸, 8행 → 6행, 줄바꿈도 8 → 6개가 됩니다.

   두 가지 순서
     행 단위 (실제)  — 재조립한 8×8을 위에서부터 한 행씩 폅니다.
                       타일 ①의 첫 행 4칸 다음에 타일 ②의 첫 행 4칸이 옵니다.
     타일별 (틀림)   — 타일 ①을 16칸 다 쓰고 타일 ②로 넘어갑니다.
                       이때 한 행은 타일 안쪽의 4칸이라 줄바꿈이 16개가 됩니다.
   ========================================================================== */
(function () {
  'use strict';

  var srcEl = document.getElementById('pk_src');
  if (!srcEl) return;
  var seqEl = document.getElementById('pk_seq');

  /* --- 모델 -------------------------------------------------------------- */
  var G = 8;          /* 재조립한 격자 한 변 */
  var TS = 4;         /* 타일 한 변 */
  var PADROW = 6;     /* 이 행부터 아래가 패딩 */
  var TVARS = ['--vis', '--lang', '--ok', '--bad'];
  var TMARK = ['①', '②', '③', '④'];

  function tileOf(r, c) { return (r < TS ? 0 : 2) + (c < TS ? 0 : 1); }
  function numOf(r, c) { return (r % TS) * TS + (c % TS) + 1; }
  function isPad(r) { return r >= PADROW; }

  var st = { order: 'row', unpad: false, nl: true, i: 0 };

  function build() {
    var seq = [], pos = {}, rows = 0;
    var r, c, t, tr, tc, row, i;

    function cell(rr, cc) {
      return { k: 'tok', r: rr, c: cc, t: tileOf(rr, cc), n: numOf(rr, cc), pad: isPad(rr) };
    }
    function push(list) {
      if (!list.length) return;
      rows++;
      for (var j = 0; j < list.length; j++) {
        pos[list[j].r * G + list[j].c] = seq.length;
        seq.push(list[j]);
      }
      if (st.nl) seq.push({ k: 'nl', row: rows });
    }

    if (st.order === 'row') {
      for (r = 0; r < G; r++) {
        row = [];
        for (c = 0; c < G; c++) { if (st.unpad && isPad(r)) continue; row.push(cell(r, c)); }
        push(row);
      }
    } else {
      for (t = 0; t < 4; t++) {
        var r0 = t < 2 ? 0 : TS, c0 = (t % 2) === 0 ? 0 : TS;
        for (tr = 0; tr < TS; tr++) {
          row = [];
          for (tc = 0; tc < TS; tc++) {
            var rr = r0 + tr, cc = c0 + tc;
            if (st.unpad && isPad(rr)) continue;
            row.push(cell(rr, cc));
          }
          push(row);
        }
      }
    }

    var ntok = 0, nnl = 0;
    for (i = 0; i < seq.length; i++) { if (seq[i].k === 'nl') nnl++; else ntok++; }
    return {
      seq: seq, pos: pos, rows: rows, ntok: ntok, nnl: nnl,
      width: st.order === 'row' ? G : TS
    };
  }

  var B = build();

  /* --- 캔버스 유틸 ------------------------------------------------------- */
  function css(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }
  function fit(canvas, w, h) {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    var c = canvas.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    return c;
  }
  function hatch(ctx, x, y, w, h, color, alpha) {
    ctx.save();
    ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
    ctx.strokeStyle = color; ctx.globalAlpha = alpha; ctx.lineWidth = 1;
    for (var d = -h; d < w; d += 5) {
      ctx.beginPath(); ctx.moveTo(x + d, y + h); ctx.lineTo(x + d + h, y); ctx.stroke();
    }
    ctx.restore();
  }
  var MONO = '"IBM Plex Mono", ui-monospace, monospace';

  /* --- 원본 격자 --------------------------------------------------------- */
  var SRC = 300, M = 10, CELL = 35;

  function drawSrc() {
    var ctx = fit(srcEl, SRC, SRC);
    var panel = css('--panel'), panel2 = css('--panel2'),
        tx = css('--tx'), tx3 = css('--tx3'), line = css('--line');
    var cols = [css(TVARS[0]), css(TVARS[1]), css(TVARS[2]), css(TVARS[3])];

    ctx.clearRect(0, 0, SRC, SRC);
    ctx.fillStyle = panel2;
    ctx.fillRect(0, 0, SRC, SRC);

    var cur = st.i > 0 && B.seq[st.i - 1].k === 'tok' ? B.seq[st.i - 1] : null;
    var r, c;

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = Math.max(9, Math.round(CELL * 0.33)) + 'px ' + MONO;

    for (r = 0; r < G; r++) {
      for (c = 0; c < G; c++) {
        var x = M + c * CELL, y = M + r * CELL;
        var t = tileOf(r, c), pad = isPad(r);
        var p = B.pos[r * G + c];
        var out = p === undefined;                 /* 시퀀스에 안 들어감 */
        var done = !out && p < st.i;

        ctx.fillStyle = panel;
        ctx.fillRect(x, y, CELL, CELL);

        if (pad) {
          hatch(ctx, x + 1, y + 1, CELL - 2, CELL - 2, tx3, out ? 0.28 : 0.55);
          ctx.globalAlpha = out ? 0.45 : 0.9;
          ctx.strokeStyle = tx3; ctx.lineWidth = 1;
          ctx.setLineDash([3, 2]);
          ctx.strokeRect(x + 0.5, y + 0.5, CELL - 1, CELL - 1);
          ctx.setLineDash([]);
          ctx.fillStyle = tx3;
          ctx.globalAlpha = out ? 0.4 : 0.85;
          ctx.fillText(String(numOf(r, c)), x + CELL / 2, y + CELL / 2 + 0.5);
          ctx.globalAlpha = 1;
        } else {
          ctx.globalAlpha = done ? 0.34 : 0.13;
          ctx.fillStyle = cols[t];
          ctx.fillRect(x, y, CELL, CELL);
          ctx.globalAlpha = done ? 0.95 : 0.4;
          ctx.strokeStyle = cols[t]; ctx.lineWidth = 1;
          ctx.strokeRect(x + 0.5, y + 0.5, CELL - 1, CELL - 1);
          ctx.fillStyle = cols[t];
          ctx.globalAlpha = done ? 1 : 0.5;
          ctx.fillText(String(numOf(r, c)), x + CELL / 2, y + CELL / 2 + 0.5);
          ctx.globalAlpha = 1;
        }
      }
    }

    /* 타일 경계 */
    for (var ti = 0; ti < 4; ti++) {
      var tr0 = ti < 2 ? 0 : TS, tc0 = (ti % 2) === 0 ? 0 : TS;
      ctx.strokeStyle = cols[ti]; ctx.lineWidth = 2; ctx.globalAlpha = 0.85;
      ctx.strokeRect(M + tc0 * CELL + 1, M + tr0 * CELL + 1, TS * CELL - 2, TS * CELL - 2);
      ctx.globalAlpha = 1;
    }

    /* 현재 칸 */
    if (cur) {
      ctx.strokeStyle = tx; ctx.lineWidth = 2.6;
      ctx.strokeRect(M + cur.c * CELL - 0.5, M + cur.r * CELL - 0.5, CELL + 1, CELL + 1);
    }

    /* 타일 표식 — 격자 바깥 네 모서리 */
    var corners = [[M, M], [M + G * CELL, M], [M, M + G * CELL], [M + G * CELL, M + G * CELL]];
    ctx.font = '10.5px ' + MONO;
    for (var ci = 0; ci < 4; ci++) {
      ctx.beginPath();
      ctx.arc(corners[ci][0], corners[ci][1], 9, 0, 7);
      ctx.fillStyle = panel; ctx.fill();
      ctx.strokeStyle = cols[ci]; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.fillStyle = cols[ci];
      ctx.fillText(TMARK[ci], corners[ci][0], corners[ci][1] + 0.5);
    }

    ctx.strokeStyle = line; ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, SRC - 1, SRC - 1);
    ctx.textBaseline = 'alphabetic';
  }

  /* --- 시퀀스 띠 --------------------------------------------------------- */
  var QW = 600, TB = 18, GAP = 4, NLW = 13, QPAD = 9;

  function layout() {
    var out = [], x = QPAD, y = QPAD, i, w;
    for (i = 0; i < B.seq.length; i++) {
      w = B.seq[i].k === 'nl' ? NLW : TB;
      if (x + w > QW - QPAD) { x = QPAD; y += TB + GAP; }
      out.push({ x: x, y: y, w: w });
      x += w + GAP;
    }
    return { boxes: out, h: y + TB + QPAD };
  }

  function drawSeq() {
    if (!seqEl) return;
    var L = layout();
    var ctx = fit(seqEl, QW, L.h);
    var panel = css('--panel'), panel2 = css('--panel2'),
        tx = css('--tx'), tx3 = css('--tx3'), line = css('--line');
    var cols = [css(TVARS[0]), css(TVARS[1]), css(TVARS[2]), css(TVARS[3])];

    ctx.clearRect(0, 0, QW, L.h);
    ctx.fillStyle = panel2;
    ctx.fillRect(0, 0, QW, L.h);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (var i = 0; i < B.seq.length; i++) {
      var it = B.seq[i], b = L.boxes[i], done = i < st.i;
      var cx = b.x + b.w / 2, cy = b.y + TB / 2;

      if (!done) {
        ctx.fillStyle = panel; ctx.globalAlpha = 0.55;
        ctx.fillRect(b.x, b.y, b.w, TB);
        ctx.globalAlpha = 0.7;
        ctx.strokeStyle = line; ctx.lineWidth = 1;
        ctx.strokeRect(b.x + 0.5, b.y + 0.5, b.w - 1, TB - 1);
        ctx.globalAlpha = 1;
        continue;
      }

      if (it.k === 'nl') {
        ctx.fillStyle = tx; ctx.globalAlpha = 0.12;
        ctx.fillRect(b.x, b.y, b.w, TB);
        ctx.globalAlpha = 1;
        ctx.strokeStyle = tx; ctx.lineWidth = 1.2;
        ctx.strokeRect(b.x + 0.6, b.y + 0.6, b.w - 1.2, TB - 1.2);
        ctx.fillStyle = tx;
        ctx.font = '9.5px ' + MONO;
        ctx.fillText('⏎', cx, cy + 0.5);
      } else if (it.pad) {
        ctx.fillStyle = panel; ctx.fillRect(b.x, b.y, b.w, TB);
        hatch(ctx, b.x + 1, b.y + 1, b.w - 2, TB - 2, tx3, 0.55);
        ctx.strokeStyle = tx3; ctx.lineWidth = 1;
        ctx.setLineDash([3, 2]);
        ctx.strokeRect(b.x + 0.5, b.y + 0.5, b.w - 1, TB - 1);
        ctx.setLineDash([]);
      } else {
        ctx.fillStyle = cols[it.t]; ctx.globalAlpha = 0.32;
        ctx.fillRect(b.x, b.y, b.w, TB);
        ctx.globalAlpha = 1;
        ctx.strokeStyle = cols[it.t]; ctx.lineWidth = 1;
        ctx.strokeRect(b.x + 0.5, b.y + 0.5, b.w - 1, TB - 1);
        ctx.fillStyle = cols[it.t];
        ctx.font = '9px ' + MONO;
        ctx.fillText(String(it.n), cx, cy + 0.5);
      }

      if (i === st.i - 1) {
        ctx.strokeStyle = tx; ctx.lineWidth = 2.4;
        ctx.strokeRect(b.x - 1, b.y - 1, b.w + 2, TB + 2);
      }
    }

    /* 시작 표시 */
    ctx.fillStyle = tx3;
    ctx.font = '9px ' + MONO;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.globalAlpha = 0.8;
    ctx.fillText('→', 2, QPAD + TB - 4);
    ctx.globalAlpha = 1;

    ctx.strokeStyle = line; ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, QW - 1, L.h - 1);
  }

  /* --- 카운터 · 상태 문장 ------------------------------------------------ */
  var el = {
    ntok: document.getElementById('pk_ntok'),
    nnl: document.getElementById('pk_nnl'),
    tot: document.getElementById('pk_tot'),
    rows: document.getElementById('pk_rows'),
    warn: document.getElementById('pk_warn'),
    cur: document.getElementById('pk_cur'),
    unpad: document.getElementById('pk_unpad'),
    nl: document.getElementById('pk_nl'),
    step: document.getElementById('pk_step'),
    all: document.getElementById('pk_all'),
    reset: document.getElementById('pk_reset')
  };
  var orderBtns = document.querySelectorAll('#pk_order button');

  function curText() {
    if (st.i === 0) {
      return '아직 비어 있습니다 — <b>한 칸씩</b>을 눌러 첫 토큰부터 따라가 보세요.';
    }
    var it = B.seq[st.i - 1];
    var head = st.i + '번째 / ' + B.seq.length + ' — ';
    if (it.k === 'nl') {
      return head + '<b>⏎ 줄바꿈</b> (' + it.row + '번째 행이 끝났습니다)';
    }
    return head + '타일 <b>' + TMARK[it.t] + '</b>의 <b>' + it.n + '번 칸</b>' +
           (it.pad ? ' · 패딩' : '') +
           ' <span class="dim">(원본 ' + (it.r + 1) + '행 ' + (it.c + 1) + '열)</span>';
  }

  function refreshText() {
    if (el.ntok) el.ntok.textContent = B.ntok;
    if (el.nnl) el.nnl.textContent = B.nnl;
    if (el.tot) el.tot.textContent = B.ntok + B.nnl;
    if (el.rows) {
      el.rows.textContent = st.order === 'row'
        ? '행 ' + B.rows + '개 · 한 행 ' + B.width + '칸'
        : '행 ' + B.rows + '개 · 한 행 ' + B.width + '칸 (타일 안쪽 행)';
    }
    if (el.warn) el.warn.textContent = st.nl ? '' : '행 경계를 알 수 없음';
    if (el.cur) el.cur.innerHTML = curText();
  }

  function render() { drawSrc(); drawSeq(); refreshText(); }

  /* --- 재생 -------------------------------------------------------------- */
  var raf = null, last = 0;
  var reduced = window.matchMedia &&
                window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function stopPlay() {
    if (raf) cancelAnimationFrame(raf);
    raf = null;
  }
  var STEP_MS = 30;
  function loop(now) {
    if (!last) last = now;
    var n = Math.floor((now - last) / STEP_MS);
    if (n > 0) {
      last += n * STEP_MS;
      st.i = Math.min(B.seq.length, st.i + n);
      render();
    }
    if (st.i >= B.seq.length) { stopPlay(); return; }
    raf = requestAnimationFrame(loop);
  }
  function playAll() {
    stopPlay();
    if (reduced) { st.i = B.seq.length; render(); return; }
    last = 0;
    raf = requestAnimationFrame(loop);
  }

  /* 옵션이 바뀌면 시퀀스를 다시 짓습니다. 끝까지 채워둔 상태였다면 그대로
     끝까지 채운 채로 두어, 총 개수가 어떻게 달라지는지 바로 보이게 합니다. */
  function rebuild() {
    stopPlay();
    var wasFull = B.seq.length > 0 && st.i >= B.seq.length;
    B = build();
    st.i = wasFull ? B.seq.length : Math.min(st.i, B.seq.length);
    render();
  }

  Array.prototype.forEach.call(orderBtns, function (b) {
    b.addEventListener('click', function () {
      Array.prototype.forEach.call(orderBtns, function (x) { x.classList.remove('sel'); });
      b.classList.add('sel');
      st.order = b.getAttribute('data-o');
      rebuild();
    });
  });
  if (el.unpad) el.unpad.addEventListener('change', function () {
    st.unpad = !!el.unpad.checked; rebuild();
  });
  if (el.nl) el.nl.addEventListener('change', function () {
    st.nl = !!el.nl.checked; rebuild();
  });
  if (el.step) el.step.addEventListener('click', function () {
    stopPlay();
    st.i = Math.min(B.seq.length, st.i + 1);
    render();
  });
  if (el.all) el.all.addEventListener('click', playAll);
  if (el.reset) el.reset.addEventListener('click', function () {
    stopPlay(); st.i = 0; render();
  });

  /* --- 크기 -------------------------------------------------------------- */
  function labWidth() {
    var n = srcEl.parentNode;
    while (n && n.classList && !n.classList.contains('lab')) n = n.parentNode;
    var w = (n && n.clientWidth) || 0;
    if (!w) w = (document.documentElement && document.documentElement.clientWidth) || 400;
    return w;
  }
  function resize() {
    var inner = Math.max(200, labWidth() - 48);   /* .lab 좌우 패딩 24 × 2 */
    var target = inner >= 560 ? 300 : Math.max(196, Math.min(300, inner));
    CELL = Math.max(22, Math.floor((target - M * 2) / G));
    SRC = CELL * G + M * 2;
    QW = Math.max(230, Math.min(inner, 760));
    render();
  }
  var rt = null;
  window.addEventListener('resize', function () {
    if (rt) clearTimeout(rt);
    rt = setTimeout(resize, 140);
  });

  new MutationObserver(function () { render(); }).observe(
    document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  resize();
})();
