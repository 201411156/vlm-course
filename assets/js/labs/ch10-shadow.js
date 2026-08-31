/* ==========================================================================
   LAB 10-2 — 섀도 전환 시뮬레이터
   현행 텍스트 판정기 A와 후보 멀티모달 판정기 B가 같은 스트림을 판정합니다.
   두 판정기 모두 9장 방식으로 각자의 운용점이 고정되어 있다고 가정하고,
   불일치 · 개선 · 퇴행 · 오탐율 변화 · 이미지 가림 감도를 누적해
   "전환 승인 조건" 체크리스트를 채운다.

   합성 모델(요지)
     · 사례마다 정답 y, "시각 단서가 필요한가" visual, "이미지가 있는가"를 뽑는다.
     · A는 텍스트 메타만 본다 — 시각 사례에서는 사실상 찍는다(0.55).
     · B는 확률 gain 으로 시각 경로를 실제로 사용한다(0.93). 나머지 경우
       B는 A와 같은 결론에 도달합니다 → gain=0 이면 B는 A의 그림자가 됩니다.
     · 이미지가 없으면 폴백 여부에 따라 A를 그대로 따르거나 흔들린다.
     · 가림 테스트: 이미지를 지웠을 때 B의 판정이 바뀌는 비율을 함께 센다.
   실제 모델을 부르지 않는다. 고정 시드라 같은 설정이면 같은 결과가 나온다.
   ========================================================================== */
(function () {
  'use strict';

  var chartEl = document.getElementById('sh_chart');
  if (!chartEl) return;

  var SEED = 20261010;
  var NS = [200, 500, 1000, 2000, 5000];
  var BASE = 0.30;      /* 양성 비율 */
  var P_TEXT_VIS = 0.55;  /* 시각 사례에서 텍스트 판정기의 정확도 */
  var P_TEXT_MET = 0.93;  /* 메타로 되는 사례에서의 정확도 */
  var P_VISION = 0.93;    /* 시각 경로를 실제로 쓸 때의 정확도 */
  var P_COPY_MET = 0.88;  /* 메타 사례에서 B가 A와 같은 결론을 낼 확률 */
  var NOISE_FLIP = 0.02;  /* 가림 테스트의 바닥 잡음 */

  var TH = { n: 1000, dis: 30, far: 0.002, ratio: 2, missDrop: 0.01, flip: 0.05 };

  /* --- 결정적 난수 (mulberry32) ---------------------------------------- */
  function mk(seed) {
    return function () {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  /* --- 입력 -------------------------------------------------------------- */
  var ui = {
    n: document.getElementById('sh_n'), nv: document.getElementById('sh_nv'),
    vd: document.getElementById('sh_vd'), vdv: document.getElementById('sh_vdv'),
    gain: document.getElementById('sh_gain'), gainv: document.getElementById('sh_gainv'),
    fp: document.getElementById('sh_fp'), fpv: document.getElementById('sh_fpv'),
    miss: document.getElementById('sh_miss'), missv: document.getElementById('sh_missv'),
    fb: document.getElementById('sh_fb'),
    play: document.getElementById('sh_play'), reset: document.getElementById('sh_reset'),
    dis: document.getElementById('sh_dis'), ra: document.getElementById('sh_ra'),
    fa: document.getElementById('sh_fa'), rb: document.getElementById('sh_rb'),
    fbr: document.getElementById('sh_fbr'), flip: document.getElementById('sh_flip'),
    mat: document.getElementById('sh_mat'), chk: document.getElementById('sh_chk'),
    verdict: document.getElementById('sh_verdict')
  };

  var P = {};
  function readParams() {
    P.n = NS[parseInt(ui.n.value, 10)];
    P.vd = parseInt(ui.vd.value, 10) / 100;
    P.gain = parseInt(ui.gain.value, 10) / 100;
    P.fp = parseInt(ui.fp.value, 10) / 100;
    P.miss = parseInt(ui.miss.value, 10) / 100;
    P.fb = !!ui.fb.checked;
    ui.nv.textContent = P.n.toLocaleString() + '건';
    ui.vdv.textContent = ui.vd.value + '%';
    ui.gainv.textContent = ui.gain.value + '%';
    ui.fpv.textContent = ui.fp.value + '%';
    ui.missv.textContent = ui.miss.value + '%';
  }

  /* --- 시뮬레이션 상태 ---------------------------------------------------- */
  var rnd, C, pts, rollback = false;

  function fresh() {
    rnd = mk(SEED);
    C = { i: 0, pos: 0, neg: 0,
          aOk: 0, bOk: 0, aTP: 0, aFP: 0, bTP: 0, bFP: 0,
          dis: 0, imp: 0, reg: 0, bothOk: 0, bothNo: 0,
          missN: 0, missA: 0, missB: 0,
          flipD: 0, flipN: 0 };
    pts = [];
  }

  function stepOne() {
    var y = rnd() < BASE ? 1 : 0;
    var visual = rnd() < P.vd;
    var missing = rnd() < P.miss;

    /* A — 텍스트 메타만 */
    var pA = visual ? P_TEXT_VIS : P_TEXT_MET;
    var predA = (rnd() < pA) ? y : 1 - y;

    /* B — 멀티모달 후보 */
    var predB, blind = predA, imaged = !missing;
    if (missing) {
      predB = P.fb ? predA : ((rnd() < 0.5) ? y : 1 - y);
      blind = predB;
    } else if (visual) {
      if (rnd() < P.gain) {                       /* 시각 경로를 실제로 사용 */
        predB = (rnd() < P_VISION) ? y : 1 - y;
        blind = (rnd() < P_TEXT_VIS) ? y : 1 - y; /* 이미지를 가렸다면? */
      } else {                                     /* 이미지를 사실상 무시 */
        predB = predA; blind = predA;
      }
    } else {
      if (rnd() < P_COPY_MET) predB = predA;
      else predB = (rnd() < 0.92) ? y : 1 - y;
      blind = predB;
    }
    if (!missing && y === 0 && rnd() < P.fp) predB = 1;   /* 신규 오탐 유입 */

    /* 집계 */
    C.i++;
    if (y === 1) C.pos++; else C.neg++;
    var ok1 = predA === y, ok2 = predB === y;
    if (ok1) C.aOk++;
    if (ok2) C.bOk++;
    if (predA === 1) { if (y === 1) C.aTP++; else C.aFP++; }
    if (predB === 1) { if (y === 1) C.bTP++; else C.bFP++; }
    if (predA !== predB) C.dis++;
    if (!ok1 && ok2) C.imp++;
    else if (ok1 && !ok2) C.reg++;
    else if (ok1 && ok2) C.bothOk++;
    else C.bothNo++;
    if (missing) { C.missN++; if (ok1) C.missA++; if (ok2) C.missB++; }

    /* 가림 테스트 — 이미지가 있는 사례만 */
    if (imaged) {
      C.flipD++;
      var changed = (blind !== predB);
      if (!changed && rnd() < NOISE_FLIP) changed = true;
      if (changed) C.flipN++;
    }
  }

  function runTo(k) {
    var lim = Math.min(k, P.n);
    var every = Math.max(1, Math.round(P.n / 110));
    while (C.i < lim) {
      stepOne();
      if (C.i % every === 0 || C.i === P.n) {
        pts.push([C.i, C.dis / C.i, C.imp / C.i, C.reg / C.i]);
      }
    }
  }

  /* --- 캔버스 ------------------------------------------------------------- */
  function css(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }
  var CW = 360, CH = 190;
  var cx = (function fit() {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    chartEl.width = CW * dpr; chartEl.height = CH * dpr;
    chartEl.style.width = CW + 'px'; chartEl.style.height = CH + 'px';
    var c = chartEl.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    return c;
  })();

  var PAD = { l: 38, r: 10, t: 14, b: 22 };
  function drawChart() {
    var panel = css('--panel'), line = css('--line'), tx3 = css('--tx3'),
        lang = css('--lang'), ok = css('--ok'), bad = css('--bad');
    cx.clearRect(0, 0, CW, CH);
    cx.fillStyle = panel; cx.fillRect(0, 0, CW, CH);

    var w = CW - PAD.l - PAD.r, h = CH - PAD.t - PAD.b;
    var top = 0.05, i;
    for (i = 0; i < pts.length; i++) {
      top = Math.max(top, pts[i][1], pts[i][2], pts[i][3]);
    }
    top = Math.min(1, top * 1.2);

    cx.font = '10px "IBM Plex Mono", monospace';
    cx.strokeStyle = line; cx.lineWidth = 1;
    for (var g = 0; g <= 2; g++) {
      var yy = PAD.t + h - (g / 2) * h;
      cx.globalAlpha = 0.6;
      cx.beginPath(); cx.moveTo(PAD.l, yy); cx.lineTo(CW - PAD.r, yy); cx.stroke();
      cx.globalAlpha = 1;
      cx.fillStyle = tx3;
      cx.fillText((top * g / 2 * 100).toFixed(0) + '%', 6, yy + 3.5);
    }
    cx.fillStyle = tx3;
    cx.fillText('표본 ' + C.i.toLocaleString() + ' / ' + P.n.toLocaleString(),
                PAD.l, CH - 6);

    if (pts.length < 2) {
      cx.fillStyle = tx3;
      cx.fillText('수집 전', PAD.l + w / 2 - 18, PAD.t + h / 2);
      return;
    }
    function curve(idx, color, width) {
      cx.beginPath();
      for (var k = 0; k < pts.length; k++) {
        var x = PAD.l + (pts[k][0] / P.n) * w;
        var y = PAD.t + h - Math.min(1, pts[k][idx] / top) * h;
        if (k === 0) cx.moveTo(x, y); else cx.lineTo(x, y);
      }
      cx.strokeStyle = color; cx.lineWidth = width; cx.stroke();
    }
    curve(2, ok, 1.6);
    curve(3, bad, 1.6);
    curve(1, lang, 2);
  }

  /* --- 2×2 합의 격자 ------------------------------------------------------ */
  function pct(x, d) { return d > 0 ? (x / d * 100).toFixed(1) + '%' : '—'; }
  function cell(cls, n, cap) {
    return '<div class="c' + (cls ? ' ' + cls : '') + '"><b>' +
      n.toLocaleString() + '</b><small>' + cap + ' · ' + pct(n, C.i) + '</small></div>';
  }
  function drawMat() {
    if (!ui.mat) return;
    ui.mat.innerHTML =
      '<div class="h"></div><div class="h">B 정답</div><div class="h">B 오답</div>' +
      '<div class="h">A 정답</div>' +
      cell('', C.bothOk, '유지') + cell('bad', C.reg, '퇴행') +
      '<div class="h">A 오답</div>' +
      cell('good', C.imp, '개선') + cell('', C.bothNo, '둘 다 오답');
  }

  /* --- 체크리스트 --------------------------------------------------------- */
  var lastChk = '';
  function metrics() {
    var n = C.i || 1;
    return {
      accA: C.aOk / n, accB: C.bOk / n,
      recA: C.pos ? C.aTP / C.pos : 0, recB: C.pos ? C.bTP / C.pos : 0,
      farA: C.neg ? C.aFP / C.neg : 0, farB: C.neg ? C.bFP / C.neg : 0,
      dis: C.dis / n,
      flip: C.flipD ? C.flipN / C.flipD : 0,
      missA: C.missN ? C.missA / C.missN : 0,
      missB: C.missN ? C.missB / C.missN : 0
    };
  }

  function buildChecks(m) {
    var items = [];
    items.push({
      s: C.i >= TH.n ? 'pass' : 'fail',
      t: '섀도 표본 ' + TH.n.toLocaleString() + '건 이상 수집',
      v: C.i.toLocaleString() + '건'
    });
    items.push({
      s: C.dis >= TH.dis ? 'pass' : 'fail',
      t: '불일치 사례 ' + TH.dis + '건 이상 (사람 검수 표본 확보)',
      v: C.dis.toLocaleString() + '건'
    });
    items.push({
      s: m.farB <= m.farA + TH.far ? 'pass' : 'fail',
      t: '운용점 고정 오탐율 비증가 (B ≤ A + 0.2%p)',
      v: (m.farB - m.farA >= 0 ? '+' : '') + ((m.farB - m.farA) * 100).toFixed(1) + '%p'
    });
    items.push({
      s: C.imp >= TH.ratio * C.reg ? 'pass' : 'fail',
      t: '개선이 퇴행의 ' + TH.ratio + '배 이상',
      v: C.imp + ' : ' + C.reg
    });
    if (C.missN < 20) {
      items.push({ s: 'idle', t: '이미지 결측 구간 비퇴행', v: '표본 없음' });
    } else {
      items.push({
        s: m.missB >= m.missA - TH.missDrop ? 'pass' : 'fail',
        t: '이미지 결측 구간 비퇴행 (폴백 경로 검증)',
        v: ((m.missB - m.missA) * 100).toFixed(1) + '%p'
      });
    }
    items.push({
      s: m.flip >= TH.flip ? 'pass' : 'fail',
      t: '모달리티 감도 — 이미지 가림 시 판정 변화 ' + (TH.flip * 100) + '% 이상',
      v: (m.flip * 100).toFixed(1) + '%'
    });
    items.push({
      s: rollback ? 'pass' : 'fail', manual: true,
      t: '롤백 스위치와 이중 기록 경로 확인 (수동)',
      v: ''
    });
    return items;
  }

  function drawChecks(m) {
    if (!ui.chk) return [];
    var items = buildChecks(m);
    var html = items.map(function (it) {
      var mk = it.s === 'pass' ? '✓' : (it.s === 'fail' ? '✕' : '·');
      var label = it.manual
        ? '<label><input type="checkbox" id="sh_rbchk"' + (rollback ? ' checked' : '') +
          '> ' + it.t + '</label>'
        : it.t;
      return '<li class="' + it.s + '"><span class="mk">' + mk + '</span>' +
             '<span>' + label + '</span>' +
             (it.v ? '<span class="v">' + it.v + '</span>' : '') + '</li>';
    }).join('');
    if (html !== lastChk) { ui.chk.innerHTML = html; lastChk = html; }
    return items;
  }

  function drawVerdict(items, m) {
    if (!ui.verdict) return;
    var fails = items.filter(function (i) { return i.s === 'fail'; });
    if (!fails.length) {
      ui.verdict.className = 'verdict go';
      ui.verdict.innerHTML = '<b>전환 승인 조건 충족.</b> 카나리 비율을 낮게 잡아 시작하고, ' +
        '각 단계마다 같은 지표를 다시 확인하세요. 전환 후에도 두 스트림의 기록은 유지합니다.';
      return;
    }
    ui.verdict.className = 'verdict no';
    var extra = '';
    if (m.flip < TH.flip && C.i > 100) {
      extra = ' <b>가림 테스트가 거의 반응하지 않습니다</b> — B가 이미지를 보고 있는지부터 ' +
              '의심해야 합니다(7절).';
    } else if (C.reg > 0 && C.imp < TH.ratio * C.reg && m.farB > m.farA) {
      extra = ' 오탐이 늘어난 채로 개선이 따라오지 못했습니다 — 신규 오탐의 원인부터 ' +
              '찾아야 합니다.';
    }
    ui.verdict.innerHTML = '<b>아직 전환하지 않습니다.</b> 남은 조건 ' + fails.length +
      '개: ' + fails.map(function (f) { return f.t.split(' (')[0]; }).join(' · ') + '.' + extra;
  }

  /* --- 렌더 --------------------------------------------------------------- */
  function render() {
    var m = metrics();
    drawChart();
    drawMat();
    if (ui.dis) ui.dis.textContent = C.i ? (m.dis * 100).toFixed(1) + '%' : '—';
    if (ui.ra) ui.ra.textContent = (m.recA * 100).toFixed(1) + '%';
    if (ui.fa) ui.fa.textContent = (m.farA * 100).toFixed(1) + '%';
    if (ui.rb) ui.rb.textContent = (m.recB * 100).toFixed(1) + '%';
    if (ui.fbr) {
      ui.fbr.textContent = (m.farB * 100).toFixed(1) + '%';
      ui.fbr.className = m.farB > m.farA + TH.far ? 'warn' : 'good';
    }
    if (ui.flip) {
      ui.flip.textContent = (m.flip * 100).toFixed(1) + '%';
      ui.flip.className = m.flip >= TH.flip ? 'good' : 'warn';
    }
    drawVerdict(drawChecks(m), m);
  }

  /* --- 재생 --------------------------------------------------------------- */
  var raf = null, playing = false;
  var reduced = window.matchMedia &&
                window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function stop() {
    playing = false;
    if (raf) cancelAnimationFrame(raf);
    raf = null;
    if (ui.play) ui.play.textContent = '▶ 수집 재생';
  }
  function loop() {
    var chunk = Math.max(1, Math.ceil(P.n / 90));
    runTo(C.i + chunk);
    render();
    if (C.i >= P.n) { stop(); return; }
    raf = requestAnimationFrame(loop);
  }
  function play() {
    stop();
    readParams(); fresh();
    if (reduced) { runTo(P.n); render(); return; }
    playing = true;
    if (ui.play) ui.play.textContent = '⏸ 정지';
    raf = requestAnimationFrame(loop);
  }
  function instant() {
    stop();
    readParams(); fresh(); runTo(P.n); render();
  }

  ['n', 'vd', 'gain', 'fp', 'miss'].forEach(function (k) {
    ui[k].addEventListener('input', instant);
  });
  ui.fb.addEventListener('change', instant);
  if (ui.play) ui.play.addEventListener('click', function () {
    if (playing) { stop(); } else { play(); }
  });
  if (ui.reset) ui.reset.addEventListener('click', function () {
    stop();
    ui.n.value = 2; ui.vd.value = 35; ui.gain.value = 70;
    ui.fp.value = 2; ui.miss.value = 10; ui.fb.checked = true;
    rollback = false; lastChk = '';
    instant();
  });
  if (ui.chk) ui.chk.addEventListener('change', function (e) {
    if (e.target && e.target.id === 'sh_rbchk') {
      rollback = !!e.target.checked;
      lastChk = '';
      render();
    }
  });

  new MutationObserver(function () { drawChart(); }).observe(
    document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  instant();
})();
