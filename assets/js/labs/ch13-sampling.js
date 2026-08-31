/* ==========================================================================
   LAB 13-1 — 프레임 샘플링 → 토큰 예산
   30초짜리 가상 클립(합성 이벤트 마커) 위에서 샘플링 방식·fps·해상도·
   시간 압축비를 바꿔가며 (ㄱ) LLM이 실제로 받는 비디오 토큰 수와
   (ㄴ) 그 설정에서 살아남는 이벤트를 동시에 보여준다.

   토큰 계산은 Qwen2-VL 계열의 관례를 따른다.
     · 패치 14px + 2×2 공간 병합  → 토큰 하나가 28×28px을 덮는다
     · 프레임당 토큰 = (S / 28)²
     · 시간 패치 τ    → 연속한 τ장이 한 묶음으로 합쳐진다
     · 총 토큰 = ceil(n / τ) × 프레임당 토큰
   전부 브라우저 안에서 도는 산술입니다. 실제 모델을 부르지 않습니다.
   ========================================================================== */
(function () {
  'use strict';

  var cvs = document.getElementById('vtl');
  if (!cvs) return;

  var DUR = 30;                                  /* 클립 길이(초) */
  var FPS = [0.25, 0.5, 1, 2, 4, 8];
  var RES = [224, 336, 448, 672];
  var TAU = [1, 2, 4, 8];
  var BUDGET = 16384;                            /* 예시 비디오 토큰 예산 */

  /* 합성 이벤트: 길이가 6.6초부터 0.17초까지 두 자릿수 차이로 벌어져 있다 */
  var EVENTS = [
    { nm: '인물이 화면에 들어옴', s: 2.00,  e: 8.60,  m: 0.55 },
    { nm: '문이 열림',            s: 11.00, e: 12.60, m: 0.75 },
    { nm: '손이 물건을 바꿔 쥠',  s: 17.40, e: 17.80, m: 1.10 },
    { nm: '물건이 떨어짐',        s: 22.00, e: 22.90, m: 0.95 },
    { nm: '조명이 한 번 깜박임',  s: 26.55, e: 26.72, m: 1.20 }
  ];
  /* 장면 전환(샷 경계) 시각 — 키프레임 추출기가 잡아내는 지점 */
  var CUTS = [0.00, 5.40, 11.20, 19.20, 24.60];

  /* --- 움직임 신호 -------------------------------------------------------
     프레임 차분의 대역 같은 것. 이벤트마다 봉우리가 서고, 샷 경계에서도 튄다. */
  function motion(t) {
    var v = 0.10, i;
    for (i = 0; i < EVENTS.length; i++) {
      var ev = EVENTS[i], c = (ev.s + ev.e) / 2;
      var w = Math.max(0.16, (ev.e - ev.s) / 2);
      var z = (t - c) / w;
      v += ev.m * Math.exp(-z * z);
    }
    for (i = 0; i < CUTS.length; i++) {
      var zc = (t - CUTS[i]) / 0.22;
      v += 0.45 * Math.exp(-zc * zc);
    }
    return v;
  }

  /* 적응 샘플링용 누적분포 */
  var GRID = 1200, gt = [], gc = [];
  (function () {
    var acc = 0;
    for (var k = 0; k < GRID; k++) {
      var t = (k + 0.5) * DUR / GRID;
      acc += motion(t);
      gt.push(t); gc.push(acc);
    }
  })();

  function uniformT(n) {
    var a = [];
    for (var i = 0; i < n; i++) a.push((i + 0.5) * DUR / n);
    return a;
  }
  function adaptiveT(n) {
    var tot = gc[GRID - 1], a = [], k = 0, step = DUR / GRID;
    for (var i = 0; i < n; i++) {
      var target = (i + 0.5) / n * tot;
      while (k < GRID - 1 && gc[k] < target) k++;
      var t = gt[k];
      if (a.length && t <= a[a.length - 1]) t = a[a.length - 1] + step;
      a.push(Math.min(t, DUR - 1e-3));
    }
    return a;
  }
  function keyframeT() { return CUTS.slice(); }

  /* --- 이벤트별 판정 -----------------------------------------------------
     0장   → 놓침
     1그룹 → "있었다"까지만. 변화·방향은 판별 불가
     2그룹 → 시간 그룹이 둘 이상 걸쳐 있으니 변화가 보인다
     (τ로 합쳐진 프레임은 한 묶음으로 세는 단순화입니다) */
  function analyse(times, tau) {
    return EVENTS.map(function (ev) {
      var seen = {}, hits = 0;
      for (var i = 0; i < times.length; i++) {
        if (times[i] >= ev.s && times[i] <= ev.e) { hits++; seen[Math.floor(i / tau)] = 1; }
      }
      var g = 0, key;
      for (key in seen) if (Object.prototype.hasOwnProperty.call(seen, key)) g++;
      return { ev: ev, hits: hits, g: g, st: hits === 0 ? 'miss' : (g < 2 ? 'part' : 'ok') };
    });
  }

  /* --- 캔버스 ------------------------------------------------------------ */
  function css(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }
  var W = 540, H = 194, L = 26, R = 12;
  var cx = null;

  function fit() {
    var host = document.getElementById('v_tlwrap');
    var avail = host && host.clientWidth ? host.clientWidth : 540;
    W = Math.max(280, Math.min(720, Math.floor(avail)));
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    cvs.width = Math.round(W * dpr); cvs.height = Math.round(H * dpr);
    cvs.style.width = W + 'px'; cvs.style.height = H + 'px';
    cx = cvs.getContext('2d');
    cx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  function X(t) { return L + t / DUR * (W - L - R); }

  var MY = 10, MH = 28, EY = 46, ER = 20, AX = 154;

  function drawTimeline(times, rows, tau) {
    var vis = css('--vis'), lang = css('--lang'), bad = css('--bad'), ok = css('--ok'),
        line = css('--line'), tx3 = css('--tx3'), panel2 = css('--panel2');
    cx.clearRect(0, 0, W, H);
    cx.fillStyle = panel2;
    cx.fillRect(0, 0, W, H);

    /* 움직임 신호 */
    var maxm = 0, k;
    for (k = 0; k <= 240; k++) maxm = Math.max(maxm, motion(k / 240 * DUR));
    cx.beginPath();
    cx.moveTo(X(0), MY + MH);
    for (k = 0; k <= 240; k++) {
      var t = k / 240 * DUR;
      cx.lineTo(X(t), MY + MH - motion(t) / maxm * MH);
    }
    cx.lineTo(X(DUR), MY + MH);
    cx.closePath();
    cx.globalAlpha = 0.22; cx.fillStyle = vis; cx.fill();
    cx.globalAlpha = 0.7; cx.strokeStyle = vis; cx.lineWidth = 1; cx.stroke();
    cx.globalAlpha = 1;
    cx.font = '10px "IBM Plex Mono", monospace';
    cx.fillStyle = tx3;
    cx.fillText('움직임', 2, MY + 9);

    /* 이벤트 막대 */
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i], y = EY + i * ER;
      cx.fillStyle = tx3;
      cx.font = '10px "IBM Plex Mono", monospace';
      cx.fillText(String(i + 1), 4, y + 12);
      cx.strokeStyle = line; cx.globalAlpha = 0.6; cx.lineWidth = 1;
      cx.beginPath(); cx.moveTo(L, y + 15.5); cx.lineTo(W - R, y + 15.5); cx.stroke();
      cx.globalAlpha = 1;
      var x0 = X(r.ev.s), x1 = Math.max(X(r.ev.e), x0 + 2.5);
      cx.fillStyle = r.st === 'ok' ? ok : (r.st === 'part' ? lang : bad);
      cx.globalAlpha = r.st === 'miss' ? 0.45 : 0.85;
      cx.fillRect(x0, y + 3, x1 - x0, 10);
      cx.globalAlpha = 1;
    }

    /* 샘플 프레임 눈금 */
    var dense = times.length > 90;
    for (var j = 0; j < times.length; j++) {
      var tx = X(times[j]);
      var inside = false;
      for (var q = 0; q < rows.length; q++) {
        if (times[j] >= rows[q].ev.s && times[j] <= rows[q].ev.e) { inside = true; break; }
      }
      cx.strokeStyle = inside ? lang : vis;
      cx.globalAlpha = inside ? 0.95 : (dense ? 0.18 : 0.38);
      cx.lineWidth = 1;
      cx.beginPath(); cx.moveTo(tx + 0.5, EY - 4); cx.lineTo(tx + 0.5, AX - 4); cx.stroke();
      cx.globalAlpha = 1;
      if (!dense) {
        cx.fillStyle = Math.floor(j / tau) % 2 === 0 ? vis : lang;
        cx.fillRect(tx - 1.5, AX - 3, 3, 6);
      }
    }

    /* 시간 축 */
    cx.strokeStyle = line; cx.lineWidth = 1;
    cx.beginPath(); cx.moveTo(L, AX + 0.5); cx.lineTo(W - R, AX + 0.5); cx.stroke();
    cx.fillStyle = tx3;
    cx.font = '10px "IBM Plex Mono", monospace';
    for (var s = 0; s <= DUR; s += 5) {
      cx.beginPath(); cx.moveTo(X(s) + 0.5, AX); cx.lineTo(X(s) + 0.5, AX + 4); cx.stroke();
      cx.fillText(s + 's', X(s) - (s === 0 ? 0 : 7), AX + 16);
    }
  }

  /* --- UI ---------------------------------------------------------------- */
  var el = {
    fps: document.getElementById('v_fps'), fpsv: document.getElementById('v_fpsv'),
    res: document.getElementById('v_res'), resv: document.getElementById('v_resv'),
    tau: document.getElementById('v_tau'), tauv: document.getElementById('v_tauv'),
    n: document.getElementById('v_n'), g: document.getElementById('v_g'),
    per: document.getElementById('v_per'), total: document.getElementById('v_total'),
    pct: document.getElementById('v_pct'), hour: document.getElementById('v_hour'),
    bar: document.getElementById('v_bar'), list: document.getElementById('v_list'),
    verdict: document.getElementById('v_verdict'),
    fpslabel: document.getElementById('v_fpslabel')
  };
  var modeBtns = document.querySelectorAll('#v_mode button');
  var mode = 'uniform';

  function draw() {
    var fps = FPS[+el.fps.value], side = RES[+el.res.value], tau = TAU[+el.tau.value];
    var times;
    if (mode === 'keyframe') times = keyframeT();
    else if (mode === 'adaptive') times = adaptiveT(Math.max(1, Math.round(DUR * fps)));
    else times = uniformT(Math.max(1, Math.round(DUR * fps)));

    var n = times.length;
    var groups = Math.ceil(n / tau);
    var per = Math.pow(side / 28, 2);
    var total = groups * per;
    var rows = analyse(times, tau);

    el.fps.disabled = (mode === 'keyframe');
    el.fpsv.textContent = mode === 'keyframe' ? '해당 없음' : (fps + ' fps');
    if (el.fpslabel) el.fpslabel.style.opacity = mode === 'keyframe' ? '0.45' : '1';
    el.resv.textContent = side + 'px';
    el.tauv.textContent = tau === 1 ? '없음 (1:1)' : (tau + '장 → 1묶음');

    el.n.textContent = n.toLocaleString() + '장';
    el.g.textContent = groups.toLocaleString() + '묶음';
    el.per.textContent = per.toLocaleString();
    el.total.textContent = total.toLocaleString();
    var pct = total / BUDGET * 100;
    el.pct.textContent = pct.toFixed(0) + '%';
    el.pct.className = pct > 100 ? 'warn' : 'good';
    el.total.className = total > BUDGET ? 'warn' : '';
    var hour = total * 120;
    el.hour.textContent = (hour / 1e6).toFixed(2) + 'M';
    el.bar.style.width = Math.max(1, Math.min(100, pct)) + '%';
    el.bar.style.background = pct > 100 ? 'var(--bad)' : 'var(--vis)';

    var html = '', miss = 0, part = 0;
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (r.st === 'miss') miss++;
      if (r.st === 'part') part++;
      var label = r.st === 'ok' ? '관측 ' + r.g + '묶음' : (r.st === 'part' ? '존재만' : '놓침');
      html += '<div class="ev"><span class="ix">' + (i + 1) + '</span>' +
              '<span class="nm">' + r.ev.nm + '</span>' +
              '<span class="du">' + (r.ev.e - r.ev.s).toFixed(2) + 's</span>' +
              '<span class="st ' + r.st + '">' + label + '</span></div>';
    }
    el.list.innerHTML = html;

    var v;
    if (mode === 'keyframe') {
      v = '샷 경계 5장뿐입니다 — 가장 싸지만, 샷 안에서 벌어진 일은 구조적으로 볼 수 없습니다. 실무에서 키프레임을 쓸 때 균등 샘플을 섞는 이유입니다.';
    } else if (miss === 0 && part === 0 && total <= BUDGET) {
      v = '다섯 이벤트 모두 두 묶음 이상에 걸쳤고 예산도 남습니다 — 이 클립에서는 이 설정이 하한선에 가깝습니다.';
    } else if (miss > 0 && total > BUDGET) {
      v = '예산을 넘겼는데도 ' + miss + '개를 놓쳤습니다 — 해상도를 내리고 그 몫을 fps로 옮겨 보세요.';
    } else if (miss > 0) {
      v = '예산은 ' + (100 - pct).toFixed(0) + '% 남았는데 ' + miss + '개를 놓쳤습니다. 짧은 이벤트는 fps로만 살아납니다.';
    } else if (part > 0) {
      v = part + '개는 한 묶음에만 걸렸습니다 — "있었다"까지는 말할 수 있어도 "어느 방향으로 변했다"는 말할 수 없습니다.';
    } else {
      v = '예산을 ' + pct.toFixed(0) + '% 쓰고 있습니다. 놓친 이벤트는 없지만 1시간이면 ' +
          (hour / 1e6).toFixed(1) + 'M 토큰입니다.';
    }
    el.verdict.textContent = v;

    drawTimeline(times, rows, tau);
  }

  Array.prototype.forEach.call(modeBtns, function (b) {
    b.addEventListener('click', function () {
      Array.prototype.forEach.call(modeBtns, function (x) { x.classList.remove('sel'); });
      b.classList.add('sel');
      mode = b.getAttribute('data-mode');
      draw();
    });
  });
  ['fps', 'res', 'tau'].forEach(function (k) {
    el[k].addEventListener('input', draw);
  });

  var rt = null;
  window.addEventListener('resize', function () {
    if (rt) clearTimeout(rt);
    rt = setTimeout(function () { fit(); draw(); }, 120);
  });
  new MutationObserver(function () { draw(); }).observe(document.documentElement,
    { attributes: true, attributeFilter: ['data-theme'] });

  fit();
  draw();
})();
