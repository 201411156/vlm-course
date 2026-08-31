/* ==========================================================================
   LAB 2-1 — 임베딩 공간 정렬 시뮬레이터
   전부 브라우저 안에서 도는 장난감 시뮬레이션입니다. 실제 모델을 부르지 않습니다.

   설정
     · 언어 임베딩 t_k : 개념 k가 LLM 임베딩 공간에서 차지하는 자리 (고정 = 동결된 LLM)
     · 시각 특징  v_k : 같은 개념을 비전 인코더가 뽑은 벡터.
                        같은 구조를 갖되 "다른 좌표계"에 놓이도록 비선형 변형해 둔다.
     · 프로젝터   p_k = f(v_k) : none / linear(Wv+b) / MLP(선형 + tanh 잔차)
   목적함수
     CLIP식 대칭 대조손실. 실제 CLIP은 단위구 위의 코사인 유사도를 쓰지만,
     2D 산점도에서 눈에 보이게 하려고 여기서는 유사도를 -거리²/τ 로 둔다.
     (짝은 당기고 짝이 아닌 것은 밀어내는 구조는 동일하다.)
   최적화
     직접 손으로 미분한 그라디언트 + Adam. 라이브러리 없음.
   ========================================================================== */
(function () {
  'use strict';

  var scatterEl = document.getElementById('align');
  if (!scatterEl) return;
  var matEl = document.getElementById('simmat');

  var LABELS = ['고양이', '자동차', '커피잔', '산', '책', '기타', '시계', '우산'];
  var N = LABELS.length;
  var HID = 12;      /* MLP 은닉 폭 */
  var TAU = 0.14;    /* 온도 */
  var LR = 0.035;

  /* --- 결정적 난수 (mulberry32) --------------------------------------- */
  function rng(seed) {
    return function () {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  /* --- 데이터 생성 ------------------------------------------------------- */
  function standardize(pts) {
    var mx = 0, my = 0, i;
    for (i = 0; i < pts.length; i++) { mx += pts[i][0]; my += pts[i][1]; }
    mx /= pts.length; my /= pts.length;
    var s = 0;
    for (i = 0; i < pts.length; i++) {
      s += (pts[i][0] - mx) * (pts[i][0] - mx) + (pts[i][1] - my) * (pts[i][1] - my);
    }
    s = Math.sqrt(s / pts.length) || 1;
    for (i = 0; i < pts.length; i++) {
      pts[i][0] = (pts[i][0] - mx) / s; pts[i][1] = (pts[i][1] - my) / s;
    }
    return pts;
  }

  var T = [], V0 = [];
  (function build() {
    var r = rng(20260831);
    var i;
    /* 언어 앵커: 안/바깥 두 겹의 고리 + 지터 → 반지름이 서로 달라야
       뒤에 걸 "반지름에 비례한 회전"이 진짜 비선형이 됩니다. */
    for (i = 0; i < N; i++) {
      var ring = i % 2 === 0 ? 0.55 : 1.15;
      var ang = (i / N) * Math.PI * 2 + (r() - 0.5) * 0.5;
      T.push([Math.cos(ang) * ring + (r() - 0.5) * 0.14,
              Math.sin(ang) * ring + (r() - 0.5) * 0.14]);
    }
    standardize(T);
    /* 시각 특징: ①반지름에 비례한 소용돌이 ②y축 2차 접힘 ③회전·평행이동·잡음
       → 선형변환 하나로는 되돌릴 수 없는 좌표계가 됩니다. */
    for (i = 0; i < N; i++) {
      var x = T[i][0], y = T[i][1];
      var rad = Math.hypot(x, y);
      var sw = 1.35 * rad;                       /* ① 소용돌이 */
      var x1 = x * Math.cos(sw) - y * Math.sin(sw);
      var y1 = x * Math.sin(sw) + y * Math.cos(sw);
      y1 += 0.42 * x1 * x1 - 0.3;                /* ② 접힘 */
      var g = 0.62;                              /* ③ 고정 아핀 + 잡음 */
      V0.push([x1 * Math.cos(g) - y1 * Math.sin(g) * 0.85 + (r() - 0.5) * 0.07,
               x1 * Math.sin(g) * 1.1 + y1 * Math.cos(g) + (r() - 0.5) * 0.07]);
    }
    standardize(V0);
  })();

  /* --- 모델 상태 --------------------------------------------------------- */
  var S = null;
  function zeros(n) { var a = new Float64Array(n); return a; }

  function reset() {
    var r = rng(7);
    S = {
      step: 0,
      V: V0.map(function (p) { return [p[0], p[1]]; }),  /* 시각 특징(동결 해제 시 학습됨) */
      W: [1, 0, 0, 1],           /* 2×2, 항등으로 시작 → step0 = 원래 시각 좌표계 */
      b: [0, 0],
      A: [], a: zeros(HID),      /* 2→HID */
      B: [], b2: [0, 0],         /* HID→2, 0으로 시작 = 잔차 없음 */
      loss: 0, acc: 0
    };
    var i;
    for (i = 0; i < HID * 2; i++) S.A.push((r() - 0.5) * 2.0);
    for (i = 0; i < HID * 2; i++) S.B.push(0);
    adamState = {};
    evaluate();
  }

  /* Adam 슬롯 (파라미터 배열마다 m,v) */
  var adamState = {};
  function adam(name, params, grads, t) {
    var st = adamState[name];
    if (!st || st.m.length !== params.length) {
      st = adamState[name] = { m: zeros(params.length), v: zeros(params.length) };
    }
    var b1 = 0.9, b2 = 0.999, eps = 1e-8;
    var c1 = 1 - Math.pow(b1, t), c2 = 1 - Math.pow(b2, t);
    for (var i = 0; i < params.length; i++) {
      st.m[i] = b1 * st.m[i] + (1 - b1) * grads[i];
      st.v[i] = b2 * st.v[i] + (1 - b2) * grads[i] * grads[i];
      params[i] -= LR * (st.m[i] / c1) / (Math.sqrt(st.v[i] / c2) + eps);
    }
  }

  /* --- 순전파 ------------------------------------------------------------ */
  var mode = 'none';          /* none | linear | mlp */
  var unfreeze = false;

  function forward() {
    var P = [], H = [];
    for (var i = 0; i < N; i++) {
      var v = S.V[i], px, py, h = null;
      if (mode === 'none') { px = v[0]; py = v[1]; }
      else {
        px = S.W[0] * v[0] + S.W[1] * v[1] + S.b[0];
        py = S.W[2] * v[0] + S.W[3] * v[1] + S.b[1];
        if (mode === 'mlp') {
          h = new Float64Array(HID);
          for (var j = 0; j < HID; j++) {
            h[j] = Math.tanh(S.A[j * 2] * v[0] + S.A[j * 2 + 1] * v[1] + S.a[j]);
          }
          var rx = S.b2[0], ry = S.b2[1];
          for (var k = 0; k < HID; k++) { rx += S.B[k * 2] * h[k]; ry += S.B[k * 2 + 1] * h[k]; }
          px += rx; py += ry;
        }
      }
      P.push([px, py]); H.push(h);
    }
    return { P: P, H: H };
  }

  /* logits_{ik} = -||p_i - t_k||² / τ, 행 softmax(P) · 열 softmax(Q) */
  function stats(P) {
    var L = [], i, k;
    for (i = 0; i < N; i++) {
      L.push(new Float64Array(N));
      for (k = 0; k < N; k++) {
        var dx = P[i][0] - T[k][0], dy = P[i][1] - T[k][1];
        L[i][k] = -(dx * dx + dy * dy) / TAU;
      }
    }
    var Prow = [], Qcol = [], acc = 0, loss = 0;
    for (i = 0; i < N; i++) {
      var mx = -Infinity, best = 0;
      for (k = 0; k < N; k++) if (L[i][k] > mx) { mx = L[i][k]; best = k; }
      if (best === i) acc++;
      var s = 0, row = new Float64Array(N);
      for (k = 0; k < N; k++) { row[k] = Math.exp(L[i][k] - mx); s += row[k]; }
      for (k = 0; k < N; k++) row[k] /= s;
      Prow.push(row);
      loss -= Math.log(Math.max(row[i], 1e-12)) / (2 * N);
    }
    for (k = 0; k < N; k++) {
      var mc = -Infinity;
      for (i = 0; i < N; i++) if (L[i][k] > mc) mc = L[i][k];
      var sc = 0, col = new Float64Array(N);
      for (i = 0; i < N; i++) { col[i] = Math.exp(L[i][k] - mc); sc += col[i]; }
      for (i = 0; i < N; i++) col[i] /= sc;
      Qcol.push(col);
      loss -= Math.log(Math.max(col[k], 1e-12)) / (2 * N);
    }
    return { L: L, Prow: Prow, Qcol: Qcol, acc: acc, loss: loss };
  }

  function evaluate() {
    var f = forward();
    var st = stats(f.P);
    S.P = f.P; S.H = f.H; S.Prow = st.Prow; S.loss = st.loss; S.acc = st.acc;
  }

  /* --- 한 스텝 학습 ------------------------------------------------------ */
  function trainStep() {
    if (mode === 'none' && !unfreeze) { evaluate(); return; }
    var f = forward(), P = f.P, H = f.H;
    var st = stats(P);
    S.P = P; S.Prow = st.Prow; S.loss = st.loss; S.acc = st.acc;
    S.step++;

    /* dL/dp_i */
    var dP = [], i, k;
    for (i = 0; i < N; i++) dP.push([0, 0]);
    for (i = 0; i < N; i++) {
      for (k = 0; k < N; k++) {
        var d = (i === k) ? 1 : 0;
        var g = 0.5 * ((st.Prow[i][k] - d) + (st.Qcol[k][i] - d)) / N;
        var c = -2 * g / TAU;
        dP[i][0] += c * (P[i][0] - T[k][0]);
        dP[i][1] += c * (P[i][1] - T[k][1]);
      }
    }

    var gW = zeros(4), gb = zeros(2), gA = zeros(HID * 2), ga = zeros(HID),
        gB = zeros(HID * 2), gb2 = zeros(2), gV = zeros(N * 2);

    for (i = 0; i < N; i++) {
      var v = S.V[i], dx = dP[i][0], dy = dP[i][1];
      if (mode === 'none') {
        gV[i * 2] += dx; gV[i * 2 + 1] += dy;
        continue;
      }
      gW[0] += dx * v[0]; gW[1] += dx * v[1];
      gW[2] += dy * v[0]; gW[3] += dy * v[1];
      gb[0] += dx; gb[1] += dy;
      var dvx = S.W[0] * dx + S.W[2] * dy;
      var dvy = S.W[1] * dx + S.W[3] * dy;
      if (mode === 'mlp') {
        var h = H[i];
        gb2[0] += dx; gb2[1] += dy;
        for (var j = 0; j < HID; j++) {
          gB[j * 2] += dx * h[j];
          gB[j * 2 + 1] += dy * h[j];
          var dh = S.B[j * 2] * dx + S.B[j * 2 + 1] * dy;
          var dz = dh * (1 - h[j] * h[j]);
          gA[j * 2] += dz * v[0];
          gA[j * 2 + 1] += dz * v[1];
          ga[j] += dz;
          dvx += S.A[j * 2] * dz;
          dvy += S.A[j * 2 + 1] * dz;
        }
      }
      gV[i * 2] += dvx; gV[i * 2 + 1] += dvy;
    }

    var t = S.step;
    if (mode !== 'none') {
      adam('W', S.W, gW, t); adam('b', S.b, gb, t);
      if (mode === 'mlp') {
        adam('A', S.A, gA, t); adam('a', S.a, ga, t);
        adam('B', S.B, gB, t); adam('b2', S.b2, gb2, t);
      }
    }
    if (unfreeze) {
      var flat = [];
      for (i = 0; i < N; i++) { flat.push(S.V[i][0], S.V[i][1]); }
      adam('V', flat, gV, t);
      for (i = 0; i < N; i++) { S.V[i][0] = flat[i * 2]; S.V[i][1] = flat[i * 2 + 1]; }
    }
  }

  /* --- 그리기 ------------------------------------------------------------ */
  function css(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }
  function fit(canvas, w, h) {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = w * dpr; canvas.height = h * dpr;
    canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
    var c = canvas.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    return c;
  }

  var SW = 360, SH = 300, MW = 132;
  var sc = fit(scatterEl, SW, SH);
  var mc = matEl ? fit(matEl, MW, MW) : null;

  var RANGE = 2.1;
  function X(x) { return SW / 2 + x * (SW / 2 - 26) / RANGE; }
  function Y(y) { return SH / 2 - y * (SH / 2 - 22) / RANGE; }

  function drawScatter() {
    var vis = css('--vis'), lang = css('--lang'), line = css('--line'),
        tx3 = css('--tx3'), panel = css('--panel'), ok = css('--ok');
    sc.clearRect(0, 0, SW, SH);
    sc.fillStyle = panel; sc.fillRect(0, 0, SW, SH);

    /* 격자 */
    sc.strokeStyle = line; sc.lineWidth = 1; sc.globalAlpha = 0.5;
    for (var g = -2; g <= 2; g++) {
      sc.beginPath(); sc.moveTo(X(g), 0); sc.lineTo(X(g), SH); sc.stroke();
      sc.beginPath(); sc.moveTo(0, Y(g)); sc.lineTo(SW, Y(g)); sc.stroke();
    }
    sc.globalAlpha = 1;

    /* 짝 연결선 */
    for (var i = 0; i < N; i++) {
      var p = S.P[i], t = T[i];
      var dist = Math.hypot(p[0] - t[0], p[1] - t[1]);
      sc.strokeStyle = dist < 0.25 ? ok : tx3;
      sc.globalAlpha = dist < 0.25 ? 0.55 : 0.3;
      sc.lineWidth = 1;
      sc.beginPath(); sc.moveTo(X(p[0]), Y(p[1])); sc.lineTo(X(t[0]), Y(t[1])); sc.stroke();
    }
    sc.globalAlpha = 1;

    /* 언어 앵커(호박색 사각) */
    sc.font = '10px "IBM Plex Sans KR", system-ui, sans-serif';
    for (i = 0; i < N; i++) {
      var tx = X(T[i][0]), ty = Y(T[i][1]);
      sc.fillStyle = lang;
      sc.fillRect(tx - 4, ty - 4, 8, 8);
      sc.fillStyle = lang; sc.globalAlpha = 0.85;
      sc.fillText(LABELS[i], tx + 7, ty + 3.5);
      sc.globalAlpha = 1;
    }
    /* 투영된 이미지 임베딩(청록 원) */
    for (i = 0; i < N; i++) {
      var px = X(S.P[i][0]), py = Y(S.P[i][1]);
      sc.beginPath(); sc.arc(px, py, 5, 0, 7);
      sc.fillStyle = vis; sc.fill();
      sc.lineWidth = 1.5; sc.strokeStyle = panel; sc.stroke();
    }
  }

  function drawMatrix() {
    if (!mc) return;
    var vis = css('--vis'), lang = css('--lang'), panel2 = css('--panel2');
    var cell = MW / N;
    mc.clearRect(0, 0, MW, MW);
    mc.fillStyle = panel2; mc.fillRect(0, 0, MW, MW);
    for (var i = 0; i < N; i++) {
      for (var k = 0; k < N; k++) {
        var a = Math.pow(S.Prow[i][k], 0.6);
        if (a > 0.02) {
          mc.globalAlpha = a;
          mc.fillStyle = vis;
          mc.fillRect(k * cell, i * cell, cell, cell);
        }
      }
    }
    mc.globalAlpha = 1;
    mc.strokeStyle = lang; mc.lineWidth = 1;
    for (var d = 0; d < N; d++) {
      mc.strokeRect(d * cell + 0.5, d * cell + 0.5, cell - 1, cell - 1);
    }
  }

  /* --- UI ---------------------------------------------------------------- */
  var el = {
    step: document.getElementById('a_step'),
    loss: document.getElementById('a_loss'),
    acc: document.getElementById('a_acc'),
    play: document.getElementById('a_play'),
    reset: document.getElementById('a_reset'),
    unfreeze: document.getElementById('a_unfreeze'),
    verdict: document.getElementById('a_verdict')
  };
  var segBtns = document.querySelectorAll('#a_mode button');

  function refresh() {
    drawScatter(); drawMatrix();
    if (el.step) el.step.textContent = S.step;
    if (el.loss) el.loss.textContent = S.loss.toFixed(3);
    if (el.acc) {
      el.acc.textContent = S.acc + ' / ' + N;
      el.acc.className = S.acc === N ? 'good' : (S.acc <= N / 2 ? 'warn' : '');
    }
    if (el.verdict) {
      var v = '';
      if (S.step === 0 && !(mode === 'none' && !unfreeze)) {
        v = '아직 학습 전입니다 — 시각 특징을 그대로 얹은 상태입니다. ▶ 를 눌러 보세요.';
      } else if (mode === 'none' && !unfreeze) {
        v = '다리도 없고 시각 경로도 얼어 있습니다 — 학습할 파라미터가 하나도 없습니다.';
      } else if (mode === 'none' && unfreeze) {
        v = '다리 없이 인코더만 움직여도 정렬됩니다 — early fusion이 노리는 지점입니다.';
      } else if (S.acc === N && S.loss < 0.35) {
        v = '정렬 완료 — 대각선만 밝습니다. 이것이 CLIP이 만든 그림입니다.';
      } else if (S.step > 200 && S.acc < N) {
        v = '수렴했는데도 남는 오차 = 이 프로젝터의 표현력 한계입니다.';
      } else {
        v = '학습 중입니다 — 짝은 당기고, 짝이 아닌 것은 밀어냅니다.';
      }
      el.verdict.textContent = v;
    }
  }

  var running = false, raf = null;
  var reduced = window.matchMedia &&
                window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var MAXSTEP = 500;

  function loop() {
    if (S.step >= MAXSTEP) { stop(); refresh(); return; }
    trainStep();
    refresh();
    if (running) raf = requestAnimationFrame(loop);
  }
  function start() {
    if (running) return;
    if (mode === 'none' && !unfreeze) { refresh(); return; }  /* 학습할 게 없다 */
    if (reduced) {                       /* 모션 최소화 설정: 애니메이션 없이 한 번에 */
      for (var i = 0; i < MAXSTEP && S.step < MAXSTEP; i++) trainStep();
      refresh(); return;
    }
    running = true;
    if (el.play) el.play.textContent = '⏸ 일시정지';
    raf = requestAnimationFrame(loop);
  }
  function stop() {
    running = false;
    if (raf) cancelAnimationFrame(raf);
    if (el.play) el.play.textContent = '▶ 학습';
  }

  if (el.play) el.play.addEventListener('click', function () {
    running ? stop() : start();
  });
  if (el.reset) el.reset.addEventListener('click', function () {
    stop(); adamState = {}; reset(); refresh();
  });
  if (el.unfreeze) el.unfreeze.addEventListener('change', function () {
    unfreeze = el.unfreeze.checked;
    stop(); adamState = {}; reset(); refresh();
  });
  Array.prototype.forEach.call(segBtns, function (b) {
    b.addEventListener('click', function () {
      Array.prototype.forEach.call(segBtns, function (x) { x.classList.remove('sel'); });
      b.classList.add('sel');
      mode = b.getAttribute('data-mode');
      stop(); adamState = {}; reset(); refresh();
    });
  });

  /* 테마가 바뀌면 캔버스 색도 따라가야 한다 */
  new MutationObserver(refresh).observe(document.documentElement,
    { attributes: true, attributeFilter: ['data-theme'] });

  reset();
  refresh();
})();


/* ==========================================================================
   LAB 2-2 — 어댑터가 토큰 개수에 하는 일
   같은 시각 토큰 격자를 세 가지 어댑터에 통과시켰을 때 LLM이 실제로 받는
   토큰 수가 어떻게 달라지는지 비교합니다.
   ========================================================================== */
(function () {
  'use strict';
  var g = document.getElementById('ad_grid');
  if (!g) return;
  var out = {
    mlp: document.getElementById('ad_mlp'),
    ps: document.getElementById('ad_ps'),
    rs: document.getElementById('ad_rs'),
    grid: document.getElementById('ad_gridv'),
    src: document.getElementById('ad_src'),
    q: document.getElementById('ad_q'),
    qv: document.getElementById('ad_qv'),
    bars: document.getElementById('ad_bars')
  };
  var GRIDS = [16, 24, 32, 48, 64];

  function bar(label, n, base, cls) {
    var pct = Math.max(2, Math.round(n / base * 100));
    return '<div style="margin:8px 0">' +
      '<div style="display:flex;justify-content:space-between;font-size:12px;' +
      'font-family:\'IBM Plex Mono\',monospace;color:var(--tx2)">' +
      '<span>' + label + '</span><span>' + n.toLocaleString() + ' tok</span></div>' +
      '<div style="height:8px;border-radius:4px;background:var(--panel2);margin-top:4px;' +
      'overflow:hidden"><i style="display:block;height:100%;width:' + pct + '%;' +
      'background:var(--' + cls + ')"></i></div></div>';
  }

  function draw() {
    var side = GRIDS[g.value], q = parseInt(out.q.value, 10);
    var src = side * side;
    var mlp = src, ps = Math.round(src / 4), rs = q;
    out.grid.textContent = side + ' × ' + side;
    out.src.textContent = src.toLocaleString();
    out.qv.textContent = q + '개';
    out.bars.innerHTML =
      bar('linear / MLP · 1:1', mlp, src, 'vis') +
      bar('pixel-shuffle · 1/4', ps, src, 'vis') +
      bar('resampler · 쿼리 ' + q + '개 고정', rs, src, 'lang');
    out.mlp.textContent = mlp.toLocaleString();
    out.ps.textContent = ps.toLocaleString();
    out.rs.textContent = rs.toLocaleString();
  }
  g.addEventListener('input', draw);
  out.q.addEventListener('input', draw);
  draw();
})();
