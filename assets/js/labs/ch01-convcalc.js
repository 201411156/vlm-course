/* LAB 1-2 — 패치 임베딩 계산기
   실제 patch embedding은 Conv2d(3, 1024, kernel_size=14, stride=14) 라서
   커널 하나가 588개 숫자다. 화면에 담기지 않으므로 같은 연산을 작은 규모
   (입력 6×6×3 · 커널 2×2×3 네 개)로 줄여, 곱셈 12번이 값 하나로 접히는
   과정을 한 위치씩 따라가게 한다.
   외부 의존 없음. 캔버스 색은 CSS 변수에서 읽고, data-theme 이 바뀌면 다시 그린다. */
(function () {
  'use strict';

  var cv = document.getElementById('cc_cv');
  if (!cv) return;

  var elCalc = document.getElementById('cc_calc');
  var elKv = document.getElementById('cc_kv');
  var elNote = document.getElementById('cc_note');
  var segS = document.getElementById('cc_s');
  var segK = document.getElementById('cc_k');
  var btnPrev = document.getElementById('cc_prev');
  var btnNext = document.getElementById('cc_next');
  var btnPlay = document.getElementById('cc_play');

  /* --- 데이터 -------------------------------------------------------------
     입력 6×6 세 장(R·G·B)과 2×2×3 커널 4개. 전부 한 자리 정수라 곱셈이
     눈으로 따라가진다. */
  var N = 6, KS = 2;
  var CH = [
    { n: 'R', v: '--ch-r', c: 'r', d: [
      [3, 7, 1, 4, 8, 2], [6, 2, 9, 5, 1, 7], [0, 8, 3, 6, 2, 9],
      [5, 1, 7, 2, 8, 4], [9, 4, 2, 8, 3, 1], [2, 6, 5, 1, 7, 3]] },
    { n: 'G', v: '--ch-g', c: 'g', d: [
      [5, 1, 8, 2, 6, 9], [3, 7, 2, 8, 4, 1], [9, 2, 6, 1, 7, 5],
      [4, 8, 3, 9, 2, 6], [1, 5, 9, 3, 8, 2], [7, 3, 1, 6, 4, 8]] },
    { n: 'B', v: '--ch-b', c: 'b', d: [
      [8, 4, 2, 9, 3, 5], [1, 9, 6, 3, 7, 2], [6, 3, 8, 5, 1, 7],
      [2, 7, 4, 1, 9, 3], [5, 2, 7, 4, 6, 9], [9, 6, 3, 8, 2, 4]] }
  ];
  /* K[커널][채널][행][열] */
  var K = [
    [[[1, -1], [0, 2]], [[2, 0], [-1, 1]], [[0, 1], [1, -2]]],
    [[[-2, 1], [1, 0]], [[0, 2], [1, -1]], [[1, 1], [-2, 0]]],
    [[[0, 2], [-1, 1]], [[1, -2], [0, 1]], [[2, 0], [1, -1]]],
    [[[1, 0], [2, -1]], [[-1, 1], [0, 2]], [[0, -2], [1, 1]]]
  ];
  var BIAS = [1, -2, 0, 3];

  var stride = 2, kIdx = 0, pos = 0, timer = null;

  /* --- 계산 ---------------------------------------------------------------
     화면 전개와 출력 맵이 같은 함수를 쓰므로 둘이 어긋날 수 없다. */
  function outN() { return Math.floor((N - KS) / stride) + 1; }
  function nPos() { var n = outN(); return n * n; }

  function terms(r0, c0, ci) {
    var out = [], r, c;
    for (r = 0; r < KS; r++) {
      for (c = 0; c < KS; c++) {
        out.push({ a: CH[ci].d[r0 + r][c0 + c], w: K[kIdx][ci][r][c] });
      }
    }
    return out;
  }
  function chanSum(r0, c0, ci) {
    var t = terms(r0, c0, ci), s = 0, i;
    for (i = 0; i < t.length; i++) s += t[i].a * t[i].w;
    return s;
  }
  function conv(r0, c0) {
    return BIAS[kIdx] + chanSum(r0, c0, 0) + chanSum(r0, c0, 1) + chanSum(r0, c0, 2);
  }
  /* 지금 창의 좌상단 좌표 */
  function win() {
    var n = outN(), or_ = Math.floor(pos / n), oc = pos % n;
    return { or: or_, oc: oc, r0: or_ * stride, c0: oc * stride };
  }

  /* --- 캔버스 유틸 --------------------------------------------------------- */
  var cx = null;
  function css(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }
  function fit(w, h) {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
    cv.style.width = w + 'px';
    cv.style.height = h + 'px';
    cx = cv.getContext('2d');
    cx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  /* 캔버스의 바로 위 부모는 캔버스 크기를 따라가므로(순환) 재면 안 됩니다 —
     블록 레벨인 .lab 카드의 폭을 기준으로 잡습니다. */
  function labWidth() {
    var n = cv.parentNode;
    while (n && n.classList && !n.classList.contains('lab')) n = n.parentNode;
    var w = (n && n.clientWidth) || 0;
    if (!w) w = (document.documentElement && document.documentElement.clientWidth) || 400;
    return Math.max(240, w - 48);   /* .lab 좌우 패딩 24 × 2 */
  }

  /* --- 배치 ---------------------------------------------------------------
     넓으면 [입력] × [커널] = [출력] 한 줄, 좁으면 입력을 위에 두고
     × [커널] = [출력] 을 아래 줄로 접는다. 단위는 셀 한 칸 크기(cell). */
  function layout() {
    var W = labWidth(), padL = 22, padR = 10, avail = W - padL - padR;
    var wide = avail / 17.3 >= 30;
    var cell = wide ? Math.min(46, avail / 17.3) : Math.min(46, (avail - 14) / 10.1);
    cell = Math.max(19, cell);
    var off = Math.round(cell * 0.45);
    var g = cell * 0.35, sym = cell * 0.55;
    var inW = N * cell + 2 * off, kW = KS * cell + 2 * off, oW = outN() * cell;
    var inH = N * cell + 2 * off, kH = KS * cell + 2 * off, oH = outN() * cell;
    var top = 34;
    var L = { cell: cell, off: off, wide: wide, top: top };

    L.in = { x: padL, y: top };
    if (wide) {
      L.s1 = { x: padL + inW + g + sym / 2, y: top + inH / 2 };
      L.ker = { x: padL + inW + g + sym + g, y: top };
      L.s2 = { x: L.ker.x + kW + g + sym / 2, y: top + inH / 2 };
      L.out = { x: L.ker.x + kW + g + sym + g, y: top };
      L.w = Math.max(L.out.x + oW + padR, Math.min(W, 520));
      L.h = top + inH + 42;
      L.foot = top + inH + 28;
    } else {
      var row2 = top + inH + 40;
      L.s1 = { x: padL + sym / 2, y: row2 + Math.max(kH, oH) / 2 };
      L.ker = { x: padL + sym + g + 12, y: row2 };   /* 채널 글자 자리 */
      L.s2 = { x: L.ker.x + kW + g + sym / 2, y: row2 + Math.max(kH, oH) / 2 };
      L.out = { x: L.ker.x + kW + g + sym + g, y: row2 };
      L.w = Math.max(L.out.x + oW + padR, padL + inW + padR, W);
      L.h = row2 + Math.max(kH, oH) + 60;
      L.foot = row2 + Math.max(kH, oH) + 26;
    }
    return L;
  }

  function cellText(v, cell, hot, dim) {
    var s = String(v);
    var fs = Math.min(cell * 0.42, (cell - 7) / (s.length * 0.63));
    cx.fillStyle = hot ? css('--vis') : (dim ? css('--tx3') : css('--tx2'));
    cx.font = '600 ' + Math.max(8, Math.round(fs)) + 'px "IBM Plex Mono", monospace';
    return s;
  }

  function drawGrid(x, y, cell, rows, cols, getVal, opt) {
    var r, c, X, Y, v, hot;
    opt = opt || {};
    for (r = 0; r < rows; r++) {
      for (c = 0; c < cols; c++) {
        X = x + c * cell; Y = y + r * cell;
        hot = !!(opt.hot && opt.hot(r, c));
        cx.fillStyle = hot ? css('--vis-dim') : css('--panel2');
        cx.fillRect(X, Y, cell - 2, cell - 2);
        if (hot) {
          cx.strokeStyle = css('--vis');
          cx.lineWidth = 2;
          cx.strokeRect(X + 1, Y + 1, cell - 4, cell - 4);
        }
        v = getVal(r, c);
        if (v !== null && v !== undefined) {
          cx.textAlign = 'center'; cx.textBaseline = 'middle';
          cx.fillText(cellText(v, cell, hot, opt.dim), X + (cell - 2) / 2, Y + (cell - 2) / 2 + 1);
        }
      }
    }
  }

  /* R·G·B 세 장을 살짝 어긋나게 겹쳐 그린다 (앞이 R) */
  function deck(x, y, cell, off, rows, cols, get, hot) {
    var i, bx, by, fs = Math.max(9, Math.round(cell * 0.3));
    for (i = 2; i >= 0; i--) {
      bx = x + i * off; by = y + i * off;
      cx.globalAlpha = i === 0 ? 1 : 0.45;
      drawGrid(bx, by, cell, rows, cols, function (r, c) { return get(i, r, c); },
        { hot: hot, dim: i !== 0 });
      cx.globalAlpha = 1;
      cx.fillStyle = css(CH[i].v);
      cx.font = '600 ' + fs + 'px "IBM Plex Mono", monospace';
      cx.textAlign = 'right'; cx.textBaseline = 'middle';
      cx.fillText(CH[i].n, x - 5, by + cell * 0.35);
    }
  }

  function caption(x, y, t, wide) {
    cx.fillStyle = css('--tx3');
    cx.font = '600 ' + (wide ? '12.5' : '11') + 'px "IBM Plex Mono", monospace';
    cx.textAlign = 'left'; cx.textBaseline = 'alphabetic';
    cx.fillText(t, x, y);
  }
  function symbol(p, t, cell) {
    cx.fillStyle = css('--tx3');
    cx.font = '400 ' + Math.round(cell * 0.62) + 'px "IBM Plex Sans KR", sans-serif';
    cx.textAlign = 'center'; cx.textBaseline = 'middle';
    cx.fillText(t, p.x, p.y);
  }

  function render() {
    var L = layout(), n = outN(), w = win(), cell = L.cell, i, vals = [];
    fit(L.w, L.h);
    cx.clearRect(0, 0, L.w, L.h);

    var W2 = L.wide;
    caption(L.in.x, L.top - 12, W2 ? '입력  6 × 6 × 3' : '입력 6×6×3', W2);
    deck(L.in.x, L.in.y, cell, L.off, N, N,
      function (i2, r, c) { return CH[i2].d[r][c]; },
      function (r, c) {
        return r >= w.r0 && r < w.r0 + KS && c >= w.c0 && c < w.c0 + KS;
      });

    symbol(L.s1, '×', cell);

    caption(L.ker.x, L.ker.y - 12,
      W2 ? '커널 #' + (kIdx + 1) + '  2 × 2 × 3' : '커널 #' + (kIdx + 1) + ' · 2×2×3', W2);
    deck(L.ker.x, L.ker.y, cell, L.off, KS, KS,
      function (i2, r, c) { return K[kIdx][i2][r][c]; },
      function () { return true; });

    symbol(L.s2, '=', cell);

    caption(L.out.x, L.out.y - 12,
      W2 ? '출력 맵  ' + n + ' × ' + n : '출력 ' + n + '×' + n, W2);
    for (i = 0; i < n * n; i++) {
      vals.push(i <= pos ? conv(Math.floor(i / n) * stride, (i % n) * stride) : null);
    }
    drawGrid(L.out.x, L.out.y, cell, n, n,
      function (r, c) { return vals[r * n + c]; },
      { hot: function (r, c) { return r === w.or && c === w.oc; } });

    cx.fillStyle = css('--tx3');
    cx.font = '400 ' + (W2 ? '13' : '12') + 'px "IBM Plex Sans KR", sans-serif';
    cx.textAlign = 'left'; cx.textBaseline = 'alphabetic';
    if (W2) {
      cx.fillText('창을 stride ' + stride + '칸씩 옮기며 ' + (n * n) + '번 찍습니다  ·  지금 ' +
        (pos + 1) + '번째', L.in.x, L.foot);
    } else {
      cx.fillText('창을 stride ' + stride + '칸씩 옮기며 ' + (n * n) + '번 찍습니다', L.in.x, L.foot);
      cx.fillText('지금 ' + (pos + 1) + '번째', L.in.x, L.foot + 17);
    }

    cv.setAttribute('aria-label',
      '입력 6×6×3에 커널 #' + (kIdx + 1) + '을 stride ' + stride + '로 적용한 ' +
      n + '×' + n + ' 출력 맵. 지금 ' + (pos + 1) + '번째 위치, 값 ' + conv(w.r0, w.c0) + '.');
  }

  /* --- 전개 · 수치 --------------------------------------------------------- */
  function panels() {
    var w = win(), n = outN(), html = '', total = BIAS[kIdx], i, j, t, sub, parts;
    for (i = 0; i < 3; i++) {
      t = terms(w.r0, w.c0, i);
      sub = chanSum(w.r0, w.c0, i);
      parts = [];
      for (j = 0; j < t.length; j++) {
        parts.push(t[j].a + '×' + (t[j].w < 0 ? '(' + t[j].w + ')' : t[j].w));
      }
      total += sub;
      html += '<div class="line"><span class="tag ' + CH[i].c + '">' + CH[i].n + '</span>' +
        '<span>' + parts.join(' + ') + ' = <b>' + sub + '</b></span></div>';
    }
    html += '<div class="sum"><span>R + G + B + bias(' + BIAS[kIdx] + ')</span>' +
      '<span>= <b>' + total + '</b></span></div>';
    elCalc.innerHTML = html;

    elKv.innerHTML =
      '<span>곱셈 <b>' + (KS * KS * 3) + '번</b> → 덧셈 → 값 <b>1개</b></span>' +
      '<span>출력 한 변 <b>(6−2)/' + stride + '+1 = ' + n + '</b></span>' +
      '<span>커널 4개면 이 자리에서 <b>4개</b> 값</span>';

    elNote.textContent = stride === KS
      ? '지금은 stride가 커널 크기와 같아 창이 겹치지 않습니다 — 이미지를 조각으로 자르는 것과 같고, 이것이 patch embedding입니다.'
      : 'stride 1이면 창이 한 칸씩 겹치며 지나갑니다 — 늘 쓰던 일반 conv이고, 같은 픽셀이 여러 번 쓰이면서 출력이 커집니다.';
  }

  function upd() { render(); panels(); }

  /* --- 컨트롤 -------------------------------------------------------------- */
  var reduced = window.matchMedia &&
                window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function stopPlay() {
    if (timer) { clearInterval(timer); timer = null; }
    btnPlay.textContent = '▶ 전부 훑기';
  }
  function step(d) {
    var t = nPos();
    pos = (pos + d + t) % t;
    upd();
  }
  function select(box, btn) {
    Array.prototype.forEach.call(box.children, function (x) {
      x.classList.toggle('sel', x === btn);
    });
  }

  btnPrev.addEventListener('click', function () { stopPlay(); step(-1); });
  btnNext.addEventListener('click', function () { stopPlay(); step(1); });
  btnPlay.addEventListener('click', function () {
    if (timer) { stopPlay(); return; }
    if (reduced) { pos = nPos() - 1; upd(); return; }
    pos = 0; upd();
    btnPlay.textContent = '■ 정지';
    timer = setInterval(function () {
      if (pos >= nPos() - 1) { stopPlay(); return; }
      pos++; upd();
    }, 520);
  });

  segS.addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('button') : null;
    if (!b || !b.dataset.s) return;
    stopPlay();
    stride = +b.dataset.s;
    pos = 0;
    select(segS, b);
    upd();
  });
  segK.addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('button') : null;
    if (!b || !b.dataset.k) return;
    kIdx = +b.dataset.k;
    select(segK, b);
    upd();
  });

  /* --- 테마 · 리사이즈 ------------------------------------------------------ */
  if (window.MutationObserver) {
    new MutationObserver(function () { render(); }).observe(document.documentElement,
      { attributes: true, attributeFilter: ['data-theme'] });
  }
  var rt = null;
  window.addEventListener('resize', function () {
    if (rt) clearTimeout(rt);
    rt = setTimeout(render, 140);
  });

  upd();

  /* 검증용 — 브라우저 콘솔이나 헤드리스에서 전개와 출력 맵을 대조할 수 있게 */
  cv.__conv = { conv: conv, chanSum: chanSum, terms: terms,
    set: function (s, k, p) { stride = s; kIdx = k; pos = p; upd(); },
    state: function () { return { stride: stride, kIdx: kIdx, pos: pos, outN: outN() }; } };
})();
