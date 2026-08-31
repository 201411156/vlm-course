/* ==========================================================================
   LAB 6-1 — 저랭크 근사 시각화
   64×64 행렬을 SVD로 분해한 뒤 상위 r개 성분만 남겨 재구성합니다.
   "r을 얼마까지 줄여도 원본처럼 보이는가"가 곧 LoRA가 성립하는 조건입니다.

   수학부(LowRankMath)는 DOM과 완전히 분리되어 있습니다 — 노드에서 그대로
   불러 수치 검증을 할 수 있게 하기 위함입니다.
   ========================================================================== */

/* --- 순수 수학부 ---------------------------------------------------------- */
(function (global) {
  'use strict';

  /* 결정적 난수 (mulberry32) */
  function rng(seed) {
    return function () {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  /* Box-Muller 표준정규 */
  function gaussian(r) {
    var u = Math.max(r(), 1e-12), v = r();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /* ------------------------------------------------------------------------
     단측 야코비(one-sided Jacobi) SVD.  A(m×n, m ≥ n, 행우선) = U Σ Vᵀ
       · 열 쌍 (p,q)에 기븐스 회전을 반복 적용해 열끼리 직교시킨다.
       · 수렴 후 각 열의 노름이 특이값, 정규화한 열이 좌특이벡터.
       · 회전을 누적한 V가 우특이벡터.
     반환: { U: Float64Array(m*n), S: Float64Array(n), V: Float64Array(n*n) }
           U·V 모두 열 기준(열 t = t번째 특이벡터), S는 내림차순.
     ---------------------------------------------------------------------- */
  function svd(Ain, m, n) {
    if (m < n) throw new Error('svd: m >= n 인 경우만 지원합니다');
    var U = new Float64Array(Ain);          /* 파괴적 변형 → 사본에서 작업 */
    var V = new Float64Array(n * n);
    var i, j, k, p, q;
    for (i = 0; i < n; i++) V[i * n + i] = 1;

    var EPS = 1e-15, MAXSWEEP = 60;
    for (var sweep = 0; sweep < MAXSWEEP; sweep++) {
      var off = 0;
      for (p = 0; p < n - 1; p++) {
        for (q = p + 1; q < n; q++) {
          var alpha = 0, beta = 0, gamma = 0;
          for (k = 0; k < m; k++) {
            var up = U[k * n + p], uq = U[k * n + q];
            alpha += up * up; beta += uq * uq; gamma += up * uq;
          }
          if (gamma === 0) continue;
          var denom = Math.sqrt(alpha * beta);
          if (denom === 0 || Math.abs(gamma) <= EPS * denom) continue;
          off += (gamma * gamma) / (alpha * beta);

          /* 회전각: (c²−s²)γ + cs(α−β) = 0 을 푸는 t = tanθ 중 절댓값이 작은 쪽 */
          var zeta = (beta - alpha) / (2 * gamma);
          var t = (zeta >= 0 ? 1 : -1) / (Math.abs(zeta) + Math.sqrt(1 + zeta * zeta));
          var c = 1 / Math.sqrt(1 + t * t), s = c * t;

          for (k = 0; k < m; k++) {
            var a1 = U[k * n + p], a2 = U[k * n + q];
            U[k * n + p] = c * a1 - s * a2;
            U[k * n + q] = s * a1 + c * a2;
          }
          for (k = 0; k < n; k++) {
            var v1 = V[k * n + p], v2 = V[k * n + q];
            V[k * n + p] = c * v1 - s * v2;
            V[k * n + q] = s * v1 + c * v2;
          }
        }
      }
      if (off < 1e-28) break;
    }

    /* 열 노름 → 특이값, 열 정규화 → 좌특이벡터 */
    var S = new Float64Array(n);
    for (j = 0; j < n; j++) {
      var ss = 0;
      for (i = 0; i < m; i++) ss += U[i * n + j] * U[i * n + j];
      S[j] = Math.sqrt(ss);
    }
    /* 내림차순 정렬 (열 순서 재배치) */
    var idx = [];
    for (j = 0; j < n; j++) idx.push(j);
    idx.sort(function (x, y) { return S[y] - S[x]; });

    var U2 = new Float64Array(m * n), V2 = new Float64Array(n * n), S2 = new Float64Array(n);
    for (j = 0; j < n; j++) {
      var src = idx[j];
      S2[j] = S[src];
      var inv = S[src] > 1e-300 ? 1 / S[src] : 0;
      for (i = 0; i < m; i++) U2[i * n + j] = U[i * n + src] * inv;
      for (i = 0; i < n; i++) V2[i * n + j] = V[i * n + src];
    }
    return { U: U2, S: S2, V: V2 };
  }

  /* 상위 r개 성분만 남긴 재구성 A_r = Σ_{t<r} σ_t u_t v_tᵀ */
  function reconstruct(d, r, m, n) {
    var out = new Float64Array(m * n);
    var rr = Math.min(r, n);
    for (var t = 0; t < rr; t++) {
      var s = d.S[t];
      if (s <= 0) continue;
      for (var i = 0; i < m; i++) {
        var su = s * d.U[i * n + t];
        if (su === 0) continue;
        for (var j = 0; j < n; j++) out[i * n + j] += su * d.V[j * n + t];
      }
    }
    return out;
  }

  /* 에카르트–영 정리에 따른 상대 프로베니우스 오차 (특이값만으로 계산) */
  function relError(S, r) {
    var tot = 0, tail = 0;
    for (var i = 0; i < S.length; i++) {
      var e = S[i] * S[i];
      tot += e;
      if (i >= r) tail += e;
    }
    if (tot <= 0) return 0;
    return Math.sqrt(tail / tot);
  }

  /* 부드러운 랜덤 벡터 n개를 만들어 수정 그람-슈미트로 직교정규화합니다.
     여기에 원하는 특이값을 얹으면 스펙트럼을 정확히 지정할 수 있습니다. */
  function smoothBasis(seed, n) {
    var r = rng(seed), cols = [], i, j, k, t;
    for (k = 0; k < n; k++) {
      var v = new Float64Array(n);
      for (t = 0; t < 4; t++) {
        var f = 0.5 + 5 * r(), ph = r() * 6.283, amp = 1 / (t + 1);
        for (i = 0; i < n; i++) v[i] += amp * Math.sin(f * Math.PI * i / (n - 1) + ph);
      }
      for (i = 0; i < n; i++) v[i] += 0.35 * gaussian(r);
      cols.push(v);
    }
    for (k = 0; k < n; k++) {
      var w = cols[k];
      for (j = 0; j < k; j++) {
        var u = cols[j], d = 0;
        for (i = 0; i < n; i++) d += u[i] * w[i];
        for (i = 0; i < n; i++) w[i] -= d * u[i];
      }
      var nr = 0;
      for (i = 0; i < n; i++) nr += w[i] * w[i];
      nr = Math.sqrt(nr) || 1;
      for (i = 0; i < n; i++) w[i] /= nr;
    }
    return cols;
  }

  /* --- 표본 행렬 4종 (전부 64×64) --------------------------------------- */
  function makeMatrix(kind, n) {
    n = n || 64;
    var A = new Float64Array(n * n), i, j, k;

    if (kind === 'struct') {
      /* 특이값을 σ_k = (k+1)^-1.7 로 정확히 지정한 행렬.
         잘 학습된 모델의 ΔW가 보이는 전형적인 모습입니다 — 랭크가 부족한 것은
         아니지만(64개 성분이 전부 살아 있습니다) 위쪽 몇 개가 압도적입니다. */
      var U = smoothBasis(11, n), V = smoothBasis(29, n);
      for (k = 0; k < n; k++) {
        var s = Math.pow(k + 1, -1.7), uk = U[k], vk = V[k];
        for (i = 0; i < n; i++) {
          var su = s * uk[i];
          for (j = 0; j < n; j++) A[i * n + j] += su * vk[j];
        }
      }

    } else if (kind === 'image') {
      /* 합성 이미지 패치: 원반 + 대각 그라디언트 + 줄무늬 */
      for (i = 0; i < n; i++) {
        for (j = 0; j < n; j++) {
          var y = (i - n / 2) / (n / 2), xx = (j - n / 2) / (n / 2);
          var d1 = Math.hypot(xx + 0.32, y + 0.28);
          var disk = d1 < 0.46 ? 1 : (d1 < 0.56 ? (0.56 - d1) / 0.10 : 0);
          var grad = 0.55 * (xx * 0.7 + y * 0.5);
          var stripe = 0.28 * Math.sin(7 * Math.PI * (xx * 0.8 + y * 0.2));
          A[i * n + j] = disk * 0.9 + grad + stripe;
        }
      }

    } else if (kind === 'noise') {
      /* i.i.d. 가우시안 — 특이값이 거의 평평합니다 (저랭크 근사가 무너지는 예) */
      var r3 = rng(97);
      for (i = 0; i < n * n; i++) A[i] = gaussian(r3);

    } else { /* 'rank4' — 정확히 랭크 4 */
      var r4 = rng(2026);
      for (k = 0; k < 4; k++) {
        var u2 = new Float64Array(n), v2 = new Float64Array(n);
        for (i = 0; i < n; i++) { u2[i] = gaussian(r4); v2[i] = gaussian(r4); }
        var w2 = 1 / (k + 1);
        for (i = 0; i < n; i++) {
          for (j = 0; j < n; j++) A[i * n + j] += w2 * u2[i] * v2[j];
        }
      }
    }
    return A;
  }

  global.LowRankMath = {
    svd: svd,
    reconstruct: reconstruct,
    relError: relError,
    makeMatrix: makeMatrix,
    rng: rng
  };
})(typeof window !== 'undefined' ? window : this);


/* --- UI부 ---------------------------------------------------------------- */
(function () {
  'use strict';
  if (typeof document === 'undefined') return;
  var slider = document.getElementById('lr_r');
  if (!slider) return;

  var M = window.LowRankMath;
  var N = 64;                       /* 정사각 64×64 */
  var SIZE = 140;                   /* 캔버스 한 변(px) */

  var el = {
    orig: document.getElementById('lr_orig'),
    rec: document.getElementById('lr_rec'),
    err: document.getElementById('lr_err'),
    spec: document.getElementById('lr_spec'),
    rv: document.getElementById('lr_rv'),
    pfull: document.getElementById('lr_pfull'),
    plora: document.getElementById('lr_plora'),
    pratio: document.getElementById('lr_pratio'),
    perr: document.getElementById('lr_perr'),
    peng: document.getElementById('lr_peng'),
    verdict: document.getElementById('lr_verdict')
  };
  var srcBtns = document.querySelectorAll('#lr_src button');

  var kind = 'struct';
  var A = null, D = null, Amax = 1;

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

  var cOrig = fit(el.orig, SIZE, SIZE);
  var cRec = fit(el.rec, SIZE, SIZE);
  var cErr = fit(el.err, SIZE, SIZE);
  var SPW = 0, SPH = 96, cSpec = null;

  function layoutSpec() {
    var parent = el.spec.parentNode;
    var w = Math.max(240, Math.min(560, (parent.clientWidth || 480) - 2));
    if (w !== SPW) { SPW = w; cSpec = fit(el.spec, SPW, SPH); }
  }

  /* 값 → 색: 양수는 시각색(teal), 음수는 언어색(amber). 두 테마 모두에서 읽힙니다.
     최댓값으로 정규화하면 이상치 한둘 때문에 전체가 흐려지므로, 98분위수를 기준으로
     잡고 감마를 얹어 대비를 확보합니다(상위 2%는 포화됩니다). */
  function paint(ctx, data, scale) {
    var vis = css('--vis'), lang = css('--lang'), panel2 = css('--panel2');
    ctx.clearRect(0, 0, SIZE, SIZE);
    ctx.fillStyle = panel2; ctx.fillRect(0, 0, SIZE, SIZE);
    var cs = SIZE / N;
    for (var i = 0; i < N; i++) {
      for (var j = 0; j < N; j++) {
        var v = data[i * N + j] * scale;
        var a = Math.pow(Math.min(1, Math.abs(v)), 0.7);
        if (a < 0.02) continue;
        ctx.globalAlpha = a;
        ctx.fillStyle = v >= 0 ? vis : lang;
        ctx.fillRect(j * cs, i * cs, cs + 0.6, cs + 0.6);
      }
    }
    ctx.globalAlpha = 1;
  }

  function drawSpectrum(r) {
    layoutSpec();
    if (!cSpec) return;
    var vis = css('--vis'), tx3 = css('--tx3'), panel2 = css('--panel2'), lang = css('--lang');
    cSpec.clearRect(0, 0, SPW, SPH);
    cSpec.fillStyle = panel2; cSpec.fillRect(0, 0, SPW, SPH);

    var pad = 4, bw = (SPW - pad * 2) / N;
    var top = D.S[0] || 1;
    /* 세제곱근 압축 — 꼬리의 작은 특이값도 눈에 보이게 */
    for (var i = 0; i < N; i++) {
      var hh = Math.pow(D.S[i] / top, 1 / 3) * (SPH - 14);
      cSpec.fillStyle = i < r ? vis : tx3;
      cSpec.globalAlpha = i < r ? 1 : 0.45;
      cSpec.fillRect(pad + i * bw, SPH - 8 - hh, Math.max(1, bw - 0.8), hh);
    }
    cSpec.globalAlpha = 1;
    /* 절단선 */
    var cx = pad + r * bw;
    cSpec.strokeStyle = lang; cSpec.lineWidth = 1.5;
    cSpec.setLineDash([3, 3]);
    cSpec.beginPath(); cSpec.moveTo(cx, 2); cSpec.lineTo(cx, SPH - 6); cSpec.stroke();
    cSpec.setLineDash([]);
    cSpec.fillStyle = tx3;
    cSpec.font = '10px "IBM Plex Mono", monospace';
    cSpec.fillText('σ₁', pad + 1, 11);
    cSpec.fillText('σ₆₄', SPW - 26, 11);
  }

  function verdictText(r, err) {
    var pct = (err * 100).toFixed(1);
    if (kind === 'rank4') {
      return r >= 4
        ? 'ΔW가 정말로 랭크 4였습니다 — r ≥ 4에서 오차가 사실상 0입니다. 남은 성분은 아무것도 설명하지 않으므로 r을 더 올려도 파라미터만 늘어납니다.'
        : '아직 r < 4입니다 — 진짜 랭크에 못 미치면 오차가 뚜렷하게 남습니다. r을 4까지 올려 보세요.';
    }
    if (kind === 'noise') {
      return r >= 32
        ? '순수 잡음은 r을 절반까지 올려도 오차가 ' + pct + '%나 남습니다. 그런데 r = 32면 파라미터가 이미 원본과 같습니다 — 압축할 구조가 없는 행렬에는 LoRA가 통하지 않습니다.'
        : '잡음 행렬은 특이값이 거의 평평합니다. r = ' + r + '에서도 오차 ' + pct + '% — 버릴 성분이 없다는 뜻입니다. LoRA가 성립하려면 ΔW가 이렇게 생기면 안 됩니다.';
    }
    if (err < 0.05) {
      return '오차 ' + pct + '% — 눈으로는 구분이 어렵습니다. 파라미터는 ' +
             (2 * N * r / (N * N) * 100).toFixed(0) + '%만 쓰고 있습니다.';
    }
    if (err < 0.2) {
      return '오차 ' + pct + '% — 큰 덩어리는 살아 있고 가장자리와 잔무늬가 뭉개집니다. LoRA가 실제로 하는 절충이 이것입니다.';
    }
    return '오차 ' + pct + '% — 아직 형태만 겨우 남았습니다. 슬라이더를 오른쪽으로 밀어 어디서 "충분해지는지" 찾아보세요.';
  }

  function refresh() {
    var r = parseInt(slider.value, 10);
    var R = M.reconstruct(D, r, N, N);
    var E = new Float64Array(N * N);
    for (var i = 0; i < N * N; i++) E[i] = A[i] - R[i];

    var scale = 1 / Amax;
    paint(cOrig, A, scale);
    paint(cRec, R, scale);
    paint(cErr, E, scale * 4);          /* 오차는 4배 확대해서 보여줍니다 */
    drawSpectrum(r);

    var err = M.relError(D.S, r);
    var full = N * N, lora = 2 * N * r;
    /* 다음 성분이 아직 얼마나 큰가 = "r을 하나 더 올릴 값어치가 있는가" */
    var nxt = r < N ? D.S[r] / (D.S[0] || 1) : 0;

    if (el.rv) el.rv.textContent = 'r = ' + r;
    if (el.pfull) el.pfull.textContent = full.toLocaleString();
    if (el.plora) el.plora.textContent = lora.toLocaleString();
    if (el.pratio) {
      el.pratio.textContent = (lora / full * 100).toFixed(0) + '%';
      el.pratio.className = lora < full ? 'good' : 'warn';
    }
    if (el.perr) {
      el.perr.textContent = (err * 100).toFixed(1) + '%';
      el.perr.className = err < 0.05 ? 'good' : (err > 0.25 ? 'warn' : '');
    }
    if (el.peng) {
      el.peng.textContent = nxt < 0.005 ? '≈ 0 (더 얻을 것 없음)' : (nxt * 100).toFixed(1) + '%';
      el.peng.className = nxt < 0.02 ? 'good' : (nxt > 0.4 ? 'warn' : '');
    }
    if (el.verdict) el.verdict.textContent = verdictText(r, err);
  }

  function build() {
    A = M.makeMatrix(kind, N);
    D = M.svd(A, N, N);
    /* 표시 기준: |A| 의 98분위수 */
    var abs = new Float64Array(N * N);
    for (var i = 0; i < N * N; i++) abs[i] = Math.abs(A[i]);
    Array.prototype.sort.call(abs, function (x, y) { return x - y; });
    Amax = abs[Math.floor((N * N - 1) * 0.98)] || abs[N * N - 1] || 1;
    refresh();
  }

  slider.addEventListener('input', refresh);
  Array.prototype.forEach.call(srcBtns, function (b) {
    b.addEventListener('click', function () {
      Array.prototype.forEach.call(srcBtns, function (x) { x.classList.remove('sel'); });
      b.classList.add('sel');
      kind = b.getAttribute('data-src');
      build();
    });
  });

  /* 테마 전환 시 캔버스 색 재적용 */
  if (window.MutationObserver) {
    new MutationObserver(refresh).observe(document.documentElement,
      { attributes: true, attributeFilter: ['data-theme'] });
  }
  var rt = null;
  window.addEventListener('resize', function () {
    clearTimeout(rt);
    rt = setTimeout(function () { SPW = 0; refresh(); }, 150);
  });

  build();
})();
