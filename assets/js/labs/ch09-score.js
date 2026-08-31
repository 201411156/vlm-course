/* ==========================================================================
   LAB 9-1 — 제약 채점기: 로그확률에서 운용점까지
   전부 브라우저 안에서 도는 장난감 시뮬레이션입니다. 실제 모델을 부르지 않습니다.

   설정
     · 케이스 20개. 각 케이스마다 판정 모델이 후보 4개
       {예, 아니오, 불확실, 해당 없음} 에 부여한 다음 토큰 로짓이 주어진다.
     · 로짓은 "잠재 참확률 q" 를 2.2배로 날카롭게 만든 값입니다.
       → 이 판정기는 구조적으로 과신합니다. 온도 T≈2.2~2.5 에서 보정됩니다.
   채점
     · 이진 재정규화 : p = softmax(logit)[예] / (softmax[예] + softmax[아니오])
                      = sigmoid((l_예 − l_아니오)/T)  ← 온도에 대해 단조
     · 4후보 정규화  : p = softmax(logit/T)[예]        ← 기권 질량이 분모에 남는다
   지표
     · PR 곡선 / AP(계단 적분) · 혼동행렬 · 신뢰도 다이어그램 · ECE(5구간)
     전부 이 파일 안에서 직접 계산합니다. 라이브러리 없음.
   ========================================================================== */
(function () {
  'use strict';

  var barsEl = document.getElementById('sg_bars');
  if (!barsEl) return;
  var prEl = document.getElementById('sg_pr');
  var relEl = document.getElementById('sg_rel');

  var CAND = ['예', '아니오', '불확실', '해당 없음'];

  /* [장면, 질문 대상, 정답 라벨(1=있음), [예, 아니오, 불확실, 해당 없음] 로짓] */
  var CASES = [
    ['실내 사무실',   '노트북',    1, [4.47, 0.29, 0, -1.1]],
    ['공원 벤치',     '자전거',    1, [4.29, 0.30, 0, -1.1]],
    ['주방 조리대',   '프라이팬',  1, [3.97, 0.32, 0, -1.1]],
    ['거리 야경',     '신호등',    1, [3.81, 0.33, 0, -1.1]],
    ['서점 진열대',   '노트북',    0, [4.21, 0.31, 0, -1.1]],
    ['우천 거리',     '우산',      1, [2.58, 0.39, 0, -1.1]],
    ['회의실',        '화이트보드', 1, [2.47, 0.40, 0, -1.1]],
    ['공사장 입구',   '안전모',    1, [2.27, 0.41, 0, -1.1]],
    ['체육관 선반',   '안전모',    0, [2.42, 0.40, 0, -1.1]],
    ['안개 낀 도로',  '표지판',    1, [1.00, 0.47, 0, -1.1]],
    ['야간 주차장',   '표지판',    0, [0.88, 0.48, 0, -1.1]],
    ['붐비는 시장',   '소화기',    1, [0.41, 2.17, 0, -1.1]],
    ['해변 파라솔',   '소화기',    0, [0.41, 2.27, 0, -1.1]],
    ['빈 회의실',     '반려견',    0, [0.40, 2.37, 0, -1.1]],
    ['숲길',          '자동차',    0, [0.40, 2.42, 0, -1.1]],
    ['복도 끝',       '사다리',    1, [0.31, 4.04, 0, -1.1]],
    ['눈 덮인 산',    '커피잔',    0, [0.31, 4.13, 0, -1.1]],
    ['실내 수영장',   '프라이팬',  0, [0.31, 4.21, 0, -1.1]],
    ['도서관 열람실', '자전거',    0, [0.30, 4.29, 0, -1.1]],
    ['사막 도로',     '신호등',    0, [0.30, 4.38, 0, -1.1]]
  ];

  var N = CASES.length;
  var POS = 0;
  for (var _i = 0; _i < N; _i++) if (CASES[_i][2] === 1) POS++;
  var NEG = N - POS;

  var S = { cur: 0, norm: 'bin', thr: 0.60, T: 1.0 };

  /* --- 수치 ------------------------------------------------------------- */
  function softmax(l, T) {
    var i, mx = -Infinity, a = new Array(l.length);
    for (i = 0; i < l.length; i++) { a[i] = l[i] / T; if (a[i] > mx) mx = a[i]; }
    var s = 0;
    for (i = 0; i < a.length; i++) { a[i] = Math.exp(a[i] - mx); s += a[i]; }
    for (i = 0; i < a.length; i++) a[i] /= s;
    return a;
  }
  function probs(i) { return softmax(CASES[i][3], S.T); }
  function scoreAt(i) {
    var p = probs(i);
    return S.norm === 'bin' ? p[0] / (p[0] + p[1]) : p[0];
  }
  function allScores() {
    var a = [], i;
    for (i = 0; i < N; i++) a.push(scoreAt(i));
    return a;
  }
  function confusion(sc, thr) {
    var tp = 0, fp = 0, fn = 0, tn = 0, i;
    for (i = 0; i < N; i++) {
      var pos = sc[i] >= thr, y = CASES[i][2] === 1;
      if (pos && y) tp++; else if (pos) fp++; else if (y) fn++; else tn++;
    }
    return { tp: tp, fp: fp, fn: fn, tn: tn,
             prec: (tp + fp) ? tp / (tp + fp) : null,
             rec: (tp + fn) ? tp / (tp + fn) : null };
  }
  /* PR 곡선: 점수 내림차순으로 훑으며 (recall, precision) 계단을 만든다. */
  function prCurve(sc) {
    var idx = [], i;
    for (i = 0; i < N; i++) idx.push(i);
    idx.sort(function (a, b) { return sc[b] - sc[a]; });
    var tp = 0, fp = 0, ap = 0, prevR = 0, pts = [];
    for (i = 0; i < idx.length; i++) {
      if (CASES[idx[i]][2] === 1) tp++; else fp++;
      if (i + 1 < idx.length && Math.abs(sc[idx[i + 1]] - sc[idx[i]]) < 1e-12) continue;
      var prec = tp / (tp + fp), rec = tp / POS;
      pts.push({ thr: sc[idx[i]], prec: prec, rec: rec });
      ap += (rec - prevR) * prec;
      prevR = rec;
    }
    return { pts: pts, ap: ap };
  }
  /* 신뢰도 다이어그램: 이진 신뢰도 max(p,1−p) 를 [0.5,1] 5구간으로 나눈다.
     정답 여부는 임계 0.5 기준 판정으로 매긴다(운용 임계와 무관한 표준 정의). */
  var NB = 5;
  function reliability() {
    var b = [], i;
    for (i = 0; i < NB; i++) b.push({ n: 0, acc: 0, conf: 0 });
    var pb = [];
    for (i = 0; i < N; i++) {
      var p = probs(i);
      pb.push(p[0] / (p[0] + p[1]));
    }
    for (i = 0; i < N; i++) {
      var q = pb[i], cf = Math.max(q, 1 - q);
      var ok = ((q >= 0.5) === (CASES[i][2] === 1)) ? 1 : 0;
      var k = Math.floor((cf - 0.5) / (0.5 / NB));
      if (k < 0) k = 0; if (k > NB - 1) k = NB - 1;
      b[k].n++; b[k].acc += ok; b[k].conf += cf;
    }
    var ece = 0, accAll = 0, confAll = 0;
    for (i = 0; i < NB; i++) {
      if (b[i].n) {
        accAll += b[i].acc; confAll += b[i].conf;
        b[i].acc /= b[i].n; b[i].conf /= b[i].n;
        ece += b[i].n / N * Math.abs(b[i].acc - b[i].conf);
      }
    }
    return { bins: b, ece: ece, acc: accAll / N, conf: confAll / N };
  }

  /* --- 캔버스 유틸 ------------------------------------------------------- */
  function css(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }
  /* 캔버스 자신의 부모를 재면 스타일 폭이 되먹임되므로, 감싸는 LAB 카드를 잰다. */
  function boxWidth(node) {
    var el = node;
    while (el && el !== document.body) {
      if (el.className && String(el.className).indexOf('lab') >= 0) {
        return el.clientWidth - 48;         /* .lab 좌우 패딩 22+24 */
      }
      el = el.parentNode;
    }
    return 0;
  }
  function fit(canvas, w, h) {
    var avail = boxWidth(canvas);
    if (avail > 0 && avail < w) {
      w = Math.max(230, avail);
      h = Math.round(h * Math.max(0.62, w / (canvas === barsEl ? 402 : 300)));
    }
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
    var c = canvas.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.__w = w; c.__h = h;
    return c;
  }
  var MONO = '"IBM Plex Mono", monospace';
  var SANS = '"IBM Plex Sans KR", system-ui, sans-serif';

  /* --- 후보 채점 막대 ---------------------------------------------------- */
  function drawBars() {
    var c = fit(barsEl, 402, 210), W = c.__w, H = c.__h;
    var vis = css('--vis'), lang = css('--lang'), line = css('--line'),
        tx = css('--tx'), tx2 = css('--tx2'), tx3 = css('--tx3'),
        panel = css('--panel'), panel2 = css('--panel2'), ok = css('--ok');
    c.clearRect(0, 0, W, H);
    c.fillStyle = panel; c.fillRect(0, 0, W, H);

    var nameW = Math.max(52, W * 0.16);
    var lx0 = nameW + 6, lw = (W - nameW - 20) * 0.40;
    var px0 = lx0 + lw + 16, pw = W - px0 - 42;
    var LMIN = -1.6, LMAX = 5.0;
    var zx = lx0 + (0 - LMIN) / (LMAX - LMIN) * lw;

    c.font = '10px ' + MONO;
    c.fillStyle = tx3;
    c.fillText('로짓', lx0, 14);
    c.fillText('확률  T=' + S.T.toFixed(1), px0, 14);

    var p = probs(S.cur);
    var gold = CASES[S.cur][2] === 1 ? 0 : 1;
    var rowH = (H - 26) / 4;

    /* 0 기준선 */
    c.strokeStyle = line; c.lineWidth = 1;
    c.beginPath(); c.moveTo(zx, 20); c.lineTo(zx, H - 6); c.stroke();

    for (var i = 0; i < 4; i++) {
      var y = 26 + i * rowH, cy = y + rowH / 2;
      var col = i === 0 ? vis : (i === 1 ? lang : tx3);

      if (i === gold) {                       /* 정답 라벨 표식 */
        c.fillStyle = ok;
        c.beginPath();
        c.moveTo(3, cy - 4); c.lineTo(9, cy); c.lineTo(3, cy + 4);
        c.closePath(); c.fill();
      }
      c.font = (i < 2 ? '600 ' : '') + '12px ' + SANS;
      c.fillStyle = i < 2 ? tx : tx2;
      c.fillText(CAND[i], 13, cy + 4);

      /* 로짓 막대 (0 에서 뻗는다) */
      var lv = CASES[S.cur][3][i];
      var ex = lx0 + (lv - LMIN) / (LMAX - LMIN) * lw;
      c.fillStyle = col; c.globalAlpha = 0.45;
      c.fillRect(Math.min(zx, ex), cy - 6, Math.abs(ex - zx), 12);
      c.globalAlpha = 1;
      c.font = '10px ' + MONO; c.fillStyle = tx3;
      c.fillText(lv.toFixed(2), Math.max(ex, zx) + 4, cy + 3.5);

      /* 확률 막대 */
      c.fillStyle = panel2; c.fillRect(px0, cy - 7, pw, 14);
      c.fillStyle = col;
      c.fillRect(px0, cy - 7, Math.max(1, pw * p[i]), 14);
      c.font = '10.5px ' + MONO; c.fillStyle = tx2;
      c.fillText(p[i].toFixed(3), px0 + pw + 5, cy + 3.5);
    }
  }

  /* --- PR 곡선 ----------------------------------------------------------- */
  function drawPR(sc, curve) {
    if (!prEl) return;
    var c = fit(prEl, 300, 250), W = c.__w, H = c.__h;
    var vis = css('--vis'), lang = css('--lang'), line = css('--line'),
        tx3 = css('--tx3'), tx2 = css('--tx2'), panel = css('--panel');
    var L = 34, R = W - 12, Tp = 14, B = H - 28;
    c.clearRect(0, 0, W, H); c.fillStyle = panel; c.fillRect(0, 0, W, H);
    function X(r) { return L + r * (R - L); }
    function Y(p) { return B - p * (B - Tp); }

    c.strokeStyle = line; c.lineWidth = 1; c.globalAlpha = 0.6;
    for (var g = 0; g <= 4; g++) {
      c.beginPath(); c.moveTo(L, Y(g / 4)); c.lineTo(R, Y(g / 4)); c.stroke();
      c.beginPath(); c.moveTo(X(g / 4), Tp); c.lineTo(X(g / 4), B); c.stroke();
    }
    c.globalAlpha = 1;
    c.font = '9.5px ' + MONO; c.fillStyle = tx3;
    c.fillText('1.0', 6, Y(1) + 4); c.fillText('0.5', 6, Y(0.5) + 4);
    c.fillText('0.0', 6, Y(0) + 4);
    c.fillText('재현율 →', L, H - 8);
    c.save(); c.translate(11, Y(0.5) + 22); c.rotate(-Math.PI / 2);
    c.fillText('정밀도 →', 0, 0); c.restore();

    /* 무작위 판정기의 정밀도 = 양성 비율 */
    c.strokeStyle = tx3; c.setLineDash([3, 3]); c.globalAlpha = 0.8;
    c.beginPath(); c.moveTo(L, Y(POS / N)); c.lineTo(R, Y(POS / N)); c.stroke();
    c.setLineDash([]); c.globalAlpha = 1;

    /* 계단 곡선 */
    var pts = curve.pts;
    c.strokeStyle = vis; c.lineWidth = 2;
    c.beginPath();
    c.moveTo(X(0), Y(pts.length ? pts[0].prec : 1));
    for (var i = 0; i < pts.length; i++) {
      c.lineTo(X(pts[i].rec), Y(i ? pts[i - 1].prec : pts[0].prec));
      c.lineTo(X(pts[i].rec), Y(pts[i].prec));
    }
    c.stroke();
    c.fillStyle = vis; c.globalAlpha = 0.12;
    c.lineTo(X(pts.length ? pts[pts.length - 1].rec : 0), Y(0));
    c.lineTo(X(0), Y(0)); c.closePath(); c.fill();
    c.globalAlpha = 1;

    /* 현재 운용점 */
    var cm = confusion(sc, S.thr);
    if (cm.prec !== null && cm.rec !== null) {
      var x = X(cm.rec), y = Y(cm.prec);
      c.strokeStyle = lang; c.lineWidth = 1; c.globalAlpha = 0.55;
      c.beginPath(); c.moveTo(L, y); c.lineTo(x, y); c.moveTo(x, B); c.lineTo(x, y); c.stroke();
      c.globalAlpha = 1;
      c.beginPath(); c.arc(x, y, 5, 0, 7);
      c.fillStyle = lang; c.fill();
      c.strokeStyle = panel; c.lineWidth = 1.5; c.stroke();
    } else {
      c.font = '11px ' + SANS; c.fillStyle = tx2;
      c.fillText('임계가 너무 높아 양성 판정이 없습니다', L + 6, Y(0.5));
    }
  }

  /* --- 신뢰도 다이어그램 -------------------------------------------------- */
  function drawRel(rel) {
    if (!relEl) return;
    var c = fit(relEl, 300, 250), W = c.__w, H = c.__h;
    var vis = css('--vis'), bad = css('--bad'), line = css('--line'),
        tx3 = css('--tx3'), panel = css('--panel'), panel2 = css('--panel2');
    var L = 34, R = W - 12, Tp = 14, B = H - 28;
    c.clearRect(0, 0, W, H); c.fillStyle = panel; c.fillRect(0, 0, W, H);
    function X(v) { return L + (v - 0.5) / 0.5 * (R - L); }
    function Y(v) { return B - v * (B - Tp); }

    c.strokeStyle = line; c.lineWidth = 1; c.globalAlpha = 0.6;
    for (var g = 0; g <= 5; g++) {
      c.beginPath(); c.moveTo(L, Y(g / 5)); c.lineTo(R, Y(g / 5)); c.stroke();
    }
    c.globalAlpha = 1;

    /* 완전 보정선 */
    c.strokeStyle = tx3; c.setLineDash([4, 3]); c.lineWidth = 1.2;
    c.beginPath(); c.moveTo(X(0.5), Y(0.5)); c.lineTo(X(1), Y(1)); c.stroke();
    c.setLineDash([]);

    var bw = (R - L) / NB;
    for (var i = 0; i < NB; i++) {
      var b = rel.bins[i], x0 = L + i * bw;
      if (!b.n) {
        c.fillStyle = panel2; c.globalAlpha = 0.5;
        c.fillRect(x0 + 1, Y(0) - 3, bw - 2, 3);
        c.globalAlpha = 1;
        continue;
      }
      /* 과신 구간: 정확도 막대와 신뢰도 사이의 간극을 붉게 칠한다 */
      if (b.conf > b.acc) {
        c.fillStyle = bad; c.globalAlpha = 0.28;
        c.fillRect(x0 + 1, Y(b.conf), bw - 2, Y(b.acc) - Y(b.conf));
        c.globalAlpha = 1;
      }
      c.fillStyle = vis; c.globalAlpha = 0.55;
      c.fillRect(x0 + 1, Y(b.acc), bw - 2, B - Y(b.acc));
      c.globalAlpha = 1;
      c.strokeStyle = vis; c.lineWidth = 1.4;
      c.beginPath(); c.moveTo(x0 + 1, Y(b.acc)); c.lineTo(x0 + bw - 1, Y(b.acc)); c.stroke();
      c.font = '9.5px ' + MONO; c.fillStyle = tx3;
      c.fillText('n' + b.n, x0 + 3, Math.min(B - 4, Y(b.acc) - 4));
    }

    c.strokeStyle = line; c.lineWidth = 1;
    c.beginPath(); c.moveTo(L, B); c.lineTo(R, B); c.stroke();
    c.font = '9.5px ' + MONO; c.fillStyle = tx3;
    c.fillText('1.0', 6, Y(1) + 4); c.fillText('0.0', 6, Y(0) + 4);
    c.fillText('0.5', L - 6, H - 10);
    c.fillText('1.0', R - 12, H - 10);
    c.fillText('신뢰도 →', (L + R) / 2 - 22, H - 10);
    c.save(); c.translate(11, Y(0.5) + 22); c.rotate(-Math.PI / 2);
    c.fillText('정확도 →', 0, 0); c.restore();
  }

  /* --- DOM --------------------------------------------------------------- */
  var el = {
    strip: document.getElementById('sg_strip'),
    caseinfo: document.getElementById('sg_case'),
    thr: document.getElementById('sg_thr'),
    thrv: document.getElementById('sg_thrv'),
    temp: document.getElementById('sg_temp'),
    tempv: document.getElementById('sg_tempv'),
    cm: document.getElementById('sg_cm'),
    cal: document.getElementById('sg_cal'),
    read: document.getElementById('sg_read'),
    verdict: document.getElementById('sg_verdict'),
    reset: document.getElementById('sg_reset')
  };
  var normBtns = document.querySelectorAll('#sg_norm button');

  function buildStrip() {
    if (!el.strip) return;
    var h = '', i;
    for (i = 0; i < N; i++) {
      h += '<button type="button" data-i="' + i + '" ' +
           'title="' + CASES[i][0] + ' · ' + CASES[i][1] + '">' + (i + 1) + '</button>';
    }
    el.strip.innerHTML = h;
    Array.prototype.forEach.call(el.strip.querySelectorAll('button'), function (b) {
      b.addEventListener('click', function () {
        S.cur = parseInt(b.getAttribute('data-i'), 10);
        refresh();
      });
    });
  }
  function paintStrip(sc) {
    if (!el.strip) return;
    Array.prototype.forEach.call(el.strip.querySelectorAll('button'), function (b) {
      var i = parseInt(b.getAttribute('data-i'), 10);
      var pos = sc[i] >= S.thr, y = CASES[i][2] === 1;
      b.className = (y ? 'gold ' : '') + (pos === y ? 'hit' : 'miss') +
                    (i === S.cur ? ' sel' : '');
    });
  }

  function pct(x) { return (x * 100).toFixed(0) + '%'; }
  function fmt(x) { return x === null ? '—' : x.toFixed(3); }

  function refresh() {
    var sc = allScores();
    var curve = prCurve(sc);
    var cm = confusion(sc, S.thr);
    var rel = reliability();

    drawBars(); drawPR(sc, curve); drawRel(rel);
    paintStrip(sc);

    if (el.thrv) el.thrv.textContent = S.thr.toFixed(3);
    if (el.tempv) el.tempv.textContent = S.T.toFixed(1);

    if (el.caseinfo) {
      var cse = CASES[S.cur], p = probs(S.cur);
      var abst = p[2] + p[3];
      el.caseinfo.innerHTML =
        '케이스 ' + (S.cur + 1) + ' · ' + cse[0] + '<br>' +
        '질문 <span style="color:var(--tx)">' + cse[1] + '이(가) 있습니까?</span><br>' +
        '정답 라벨 <b class="' + (cse[2] ? 'good' : 'warn') + '">' +
          (cse[2] ? '있음' : '없음') + '</b><br>' +
        '채점 점수 p(예) <b>' + sc[S.cur].toFixed(3) + '</b><br>' +
        '기권 질량 <span class="warn">' + abst.toFixed(3) + '</span><br>' +
        '판정 <span class="' + ((sc[S.cur] >= S.thr) === (cse[2] === 1) ? 'good' : 'warn') + '">' +
          (sc[S.cur] >= S.thr ? '예' : '아니오') + '</span>';
    }

    if (el.cm) {
      el.cm.innerHTML =
        'AP <b>' + curve.ap.toFixed(3) + '</b>' +
        ' <span style="color:var(--tx3)">(무작위 ' + (POS / N).toFixed(2) + ')</span><br>' +
        '정밀도 ' + fmt(cm.prec) + ' · 재현율 ' + fmt(cm.rec) + '<br>' +
        '<span style="color:var(--tx3)">TP</span> ' + cm.tp +
        ' · <span class="warn">FP</span> ' + cm.fp +
        ' · <span class="warn">FN</span> ' + cm.fn +
        ' · <span style="color:var(--tx3)">TN</span> ' + cm.tn;
    }
    if (el.read) {
      el.read.textContent =
        '음성 ' + NEG + '건 중 ' + cm.tn + '건 기각(' + pct(cm.tn / NEG) + ') ' +
        '· 양성 ' + POS + '건 중 ' + cm.fn + '건 손실(' + pct(cm.fn / POS) + ')';
    }
    if (el.cal) {
      el.cal.innerHTML =
        'ECE <b>' + rel.ece.toFixed(3) + '</b><br>' +
        '평균 신뢰도 ' + rel.conf.toFixed(3) + '<br>' +
        '실제 정확도 ' + rel.acc.toFixed(3) + '<br>' +
        '<span style="color:var(--tx3)">차이 ' +
          (rel.conf - rel.acc >= 0 ? '+' : '') + (rel.conf - rel.acc).toFixed(3) +
          (rel.conf - rel.acc > 0.02 ? ' · 과신' : (rel.conf - rel.acc < -0.02 ? ' · 미신' : ' · 균형')) +
        '</span>';
    }
    if (el.verdict) {
      var v;
      if (S.T < 0.9) {
        v = '온도를 1 아래로 내리면 분포가 더 뾰족해집니다 — 순위는 그대로인데 확률만 극단으로 몰립니다.';
      } else if (rel.conf - rel.acc > 0.10) {
        v = '평균 신뢰도가 실제 정확도보다 ' + (rel.conf - rel.acc).toFixed(2) +
            '만큼 높습니다 — 교과서적인 과신 상태입니다. 온도를 올려 보세요.';
      } else if (Math.abs(rel.conf - rel.acc) <= 0.05) {
        v = '신뢰도와 정확도가 거의 붙었습니다. 그런데 PR 곡선은 처음 그대로입니다 — ' +
            '보정은 순위를 바꾸지 않고 눈금만 고칩니다.';
      } else {
        v = '이번에는 신뢰도가 실제 정확도보다 낮습니다 — 온도를 너무 올리면 반대편으로 넘어갑니다.';
      }
      el.verdict.textContent = v;
    }
  }

  /* --- 이벤트 ------------------------------------------------------------ */
  if (el.thr) el.thr.addEventListener('input', function () {
    S.thr = parseFloat(el.thr.value); refresh();
  });
  if (el.temp) el.temp.addEventListener('input', function () {
    S.T = parseFloat(el.temp.value); refresh();
  });
  Array.prototype.forEach.call(normBtns, function (b) {
    b.addEventListener('click', function () {
      Array.prototype.forEach.call(normBtns, function (x) { x.classList.remove('sel'); });
      b.classList.add('sel');
      S.norm = b.getAttribute('data-n');
      refresh();
    });
  });
  if (el.reset) el.reset.addEventListener('click', function () {
    S.thr = 0.60; S.T = 1.0;
    if (el.thr) el.thr.value = '0.6';
    if (el.temp) el.temp.value = '1';
    refresh();
  });

  new MutationObserver(function () { refresh(); }).observe(document.documentElement,
    { attributes: true, attributeFilter: ['data-theme'] });

  var rz = null;
  window.addEventListener('resize', function () {
    if (rz) clearTimeout(rz);
    rz = setTimeout(refresh, 150);
  });

  buildStrip();
  refresh();
})();
