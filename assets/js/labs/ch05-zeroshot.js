/* ==========================================================================
   LAB 5-1 — 제로샷 하한선 측정 시뮬레이터
   전부 브라우저 안에서 도는 장난감입니다. 실제 모델을 부르지 않습니다.

   무엇을 흉내내는가
     · 장면 12장으로 이루어진 "소량 GT 세트". 난이도 3단(큰 단일 / 다중 중간 / 작고 밀집).
     · 가상 검출기 3종
         ov     open-vocabulary 검출기  — 박스마다 연속적인 점수가 붙는다
         gen    생성형 VLM             — 좌표를 문장으로 뱉는다. 점수가 없다
         gensc  생성형 + 자기평가       — 모델에게 1~5점을 매기게 한 경우(거친 5단계 점수)
     · 슬라이더 4종: 좌표 노이즈 · 누락률 · 환각률 · 파싱 실패율

   중요한 설계 두 가지
     ① 좌표 노이즈는 "절대량"입니다. 화면 가로폭 대비 몇 %로 흔들리므로, 같은 노이즈라도
        작은 박스는 IoU가 무너지고 큰 박스는 멀쩡하다 — 이 장의 핵심 메커니즘.
     ② PR 점은 "서로 다른 점수 값"마다 하나씩 찍는다. 그래서 점수가 없는 생성형은
        PR 곡선이 점 하나가 되고, 5단계 자기평가는 계단 다섯 칸이 됩니다.

   난수는 GT마다 미리 뽑아 고정합니다. 슬라이더를 밀면 결과가 튀지 않고 단조롭게 변합니다.
   ========================================================================== */
(function () {
  'use strict';

  var sceneEl = document.getElementById('z_scene');
  if (!sceneEl) return;
  var prEl = document.getElementById('z_pr');

  /* --- 유틸 ------------------------------------------------------------- */
  function rng(seed) {
    return function () {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function iou(a, b) {
    var x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y);
    var x2 = Math.min(a.x + a.w, b.x + b.w), y2 = Math.min(a.y + a.h, b.y + b.h);
    var iw = x2 - x1, ih = y2 - y1;
    if (iw <= 0 || ih <= 0) return 0;
    var inter = iw * ih;
    return inter / (a.w * a.h + b.w * b.h - inter);
  }
  function pct(v) { return (v * 100).toFixed(1) + '%'; }

  /* --- 장면 ------------------------------------------------------------- */
  var SCH = 0.75;          /* 장면 세로 (가로 = 1) */
  var NIMG = 12;           /* 소량 GT 세트 크기 */
  var NOISE_UNIT = 0.062;  /* 노이즈 슬라이더 100%일 때의 최대 변위(가로폭 대비) */

  var TIERS = {
    easy: { label: '큰 단일 물체', cnt: [1, 1],   size: [0.30, 0.44],   maxIoU: 0.02, cluster: false },
    mid:  { label: '다중 중간',   cnt: [3, 5],   size: [0.11, 0.19],   maxIoU: 0.06, cluster: false },
    hard: { label: '작고 밀집',   cnt: [11, 17], size: [0.042, 0.072], maxIoU: 0.30, cluster: true }
  };

  function buildScenes(key, seedOff) {
    var T = TIERS[key], imgs = [], base = key.charCodeAt(0) * 1013;
    for (var s = 0; s < NIMG; s++) {
      var r = rng(base + 31 * s + seedOff * 7717);
      var n = T.cnt[0] + Math.floor(r() * (T.cnt[1] - T.cnt[0] + 1));
      var gt = [], cx = 0.28 + r() * 0.44, cy = 0.22 + r() * 0.30;
      for (var i = 0; i < n; i++) {
        for (var t = 0; t < 30; t++) {
          var sz = T.size[0] + r() * (T.size[1] - T.size[0]);
          var w = sz * (0.85 + 0.35 * r()), h = sz * (0.85 + 0.35 * r());
          var x, y;
          if (T.cluster) {
            x = cx + (r() - 0.5) * 0.60 - w / 2;
            y = cy + (r() - 0.5) * 0.44 - h / 2;
          } else {
            x = 0.03 + r() * (1 - 0.06 - w);
            y = 0.03 + r() * (SCH - 0.06 - h);
          }
          x = clamp(x, 0.02, 1 - 0.02 - w);
          y = clamp(y, 0.02, SCH - 0.02 - h);
          var b = { x: x, y: y, w: w, h: h };
          var ok = true;
          for (var j = 0; j < gt.length; j++) { if (iou(b, gt[j]) > T.maxIoU) { ok = false; break; } }
          if (ok) { gt.push(b); break; }
        }
      }
      /* GT마다 고정 난수 — 슬라이더 이동이 단조롭게 반영되도록 */
      var draws = [];
      for (i = 0; i < gt.length; i++) {
        draws.push({ miss: r(), dx: r(), dy: r(), dw: r(), dh: r(), cf: r() });
      }
      /* 이웃과의 최대 겹침 = 밀집도. 붐빌수록 놓치거나 뭉갠다. */
      var crowd = [];
      for (i = 0; i < gt.length; i++) {
        var m = 0;
        for (var q = 0; q < gt.length; q++) if (q !== i) m = Math.max(m, iou(gt[i], gt[q]));
        crowd.push(m);
      }
      /* 환각 후보 풀 — 슬라이더가 임계값 역할을 한다 */
      var hmax = Math.max(1, Math.min(10, Math.round(gt.length * 0.7))), hall = [];
      for (var k = 0; k < hmax; k++) {
        var hs = (T.size[0] + r() * (T.size[1] - T.size[0])) * 1.15;
        var hw = hs * (0.8 + 0.5 * r()), hh = hs * (0.8 + 0.5 * r());
        hall.push({
          box: {
            x: clamp(0.03 + r() * (1 - 0.06 - hw), 0.02, 1 - 0.02 - hw),
            y: clamp(0.03 + r() * (SCH - 0.06 - hh), 0.02, SCH - 0.02 - hh),
            w: hw, h: hh
          },
          u: r(), cf: r()
        });
      }
      imgs.push({ gt: gt, draws: draws, crowd: crowd, hall: hall, uParse: r() });
    }
    return imgs;
  }

  /* --- 가상 검출기 ------------------------------------------------------- */
  /* 점수 모델. ov 는 실제 IoU와 상관되도록 만들었다 — 즉 현실보다 후하게
     "잘 보정된" 검출기다. 그런데도 곡선이 이 모양이라는 점이 요지다. */
  function score(q, u, det, isHall) {
    if (det === 'gen') return 1;
    if (det === 'ov') {
      if (isHall) return clamp(0.05 + 0.45 * u, 0.02, 0.72);
      return clamp(0.10 + 0.88 * q + (u - 0.5) * 0.28, 0.03, 0.99);
    }
    /* gensc — 1~5점 자기평가. 거칠고, 헛것에도 후하다. */
    var lv = isHall ? clamp(1.8 + u * 2.8, 1, 5) : clamp(0.7 + 4.2 * q + (u - 0.5) * 1.7, 1, 5);
    return Math.round(lv) / 5;
  }

  function predict(img, o) {
    var out = { preds: [], skipped: false, failed: false };
    if (o.det !== 'ov' && img.uParse < o.parse) {
      out.failed = true;
      out.skipped = (o.policy === 'drop');
      return out;                       /* 출력을 못 읽었다 = 박스가 하나도 없다 */
    }
    var sig = o.noise * NOISE_UNIT, i;
    for (i = 0; i < img.gt.length; i++) {
      var d = img.draws[i];
      if (d.miss < o.miss + 0.35 * img.crowd[i]) continue;   /* 놓침 */
      var g = img.gt[i];
      var p = {
        x: g.x + (d.dx - 0.5) * 2 * sig,
        y: g.y + (d.dy - 0.5) * 2 * sig,
        w: Math.max(0.012, g.w + (d.dw - 0.5) * 2 * sig),
        h: Math.max(0.012, g.h + (d.dh - 0.5) * 2 * sig)
      };
      p.conf = score(iou(p, g), d.cf, o.det, false);
      out.preds.push(p);
    }
    for (i = 0; i < img.hall.length; i++) {
      var H = img.hall[i];
      if (H.u >= o.hallu) continue;
      out.preds.push({
        x: H.box.x, y: H.box.y, w: H.box.w, h: H.box.h,
        conf: score(0, H.cf, o.det, true), hall: true
      });
    }
    return out;
  }

  /* --- 평가 -------------------------------------------------------------- */
  /* PR 점은 "서로 다른 점수 값"마다 하나. 그래서 점수의 해상도가 곧
     돌릴 수 있는 임계의 개수가 됩니다. */
  function curveAt(imgs, per, thr) {
    var recs = [], nGT = 0, match = [], i;
    for (i = 0; i < imgs.length; i++) {
      var o = per[i], fl = { pred: [], gt: [] };
      match.push(fl);
      if (o.skipped) continue;
      var gt = imgs[i].gt; nGT += gt.length;
      var taken = [], order = [], k;
      for (k = 0; k < o.preds.length; k++) order.push(k);
      order.sort(function (a, b) { return o.preds[b].conf - o.preds[a].conf; });
      for (k = 0; k < order.length; k++) {
        var p = o.preds[order[k]], best = thr, bi = -1;
        for (var g = 0; g < gt.length; g++) {
          if (taken[g]) continue;
          var v = iou(p, gt[g]);
          if (v >= best) { best = v; bi = g; }
        }
        if (bi >= 0) {
          taken[bi] = 1; fl.pred[order[k]] = 1; fl.gt[bi] = 1;
          recs.push({ c: p.conf, t: 1 });
        } else {
          fl.pred[order[k]] = 0;
          recs.push({ c: p.conf, t: 0 });
        }
      }
    }
    recs.sort(function (a, b) { return b.c - a.c; });
    var tp = 0, fp = 0, pts = [], j;
    for (j = 0; j < recs.length; j++) {
      if (recs[j].t) tp++; else fp++;
      if (j === recs.length - 1 || recs[j + 1].c !== recs[j].c) {
        pts.push({ r: nGT ? tp / nGT : 0, p: tp / (tp + fp), c: recs[j].c });
      }
    }
    var env = [], run = 0;
    for (j = pts.length - 1; j >= 0; j--) { run = Math.max(run, pts[j].p); env[j] = run; }
    var ap = 0, prev = 0;
    for (j = 0; j < pts.length; j++) { ap += (pts[j].r - prev) * env[j]; prev = pts[j].r; }
    return { ap: ap, pts: pts, env: env, tp: tp, fp: fp, nGT: nGT, match: match };
  }

  function evaluate(imgs, o) {
    var per = [], i;
    for (i = 0; i < imgs.length; i++) per.push(predict(imgs[i], o));
    var res = { per: per, fail: 0, used: 0, nGT: 0, nPred: 0 };
    for (i = 0; i < imgs.length; i++) {
      if (per[i].failed) res.fail++;
      if (per[i].skipped) continue;
      res.used++; res.nGT += imgs[i].gt.length; res.nPred += per[i].preds.length;
    }
    var a50 = curveAt(imgs, per, 0.5), a75 = curveAt(imgs, per, 0.75);
    res.ap50 = a50.ap; res.ap75 = a75.ap;
    res.pts = a50.pts; res.env = a50.env; res.match = a50.match;
    res.tp = a50.tp; res.fp = a50.fp; res.fn = Math.max(0, res.nGT - a50.tp);
    res.prec = (a50.tp + a50.fp) ? a50.tp / (a50.tp + a50.fp) : 0;
    res.rec = res.nGT ? a50.tp / res.nGT : 0;
    return res;
  }

  /* --- 캔버스 ------------------------------------------------------------ */
  function css(n) {
    return getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  }
  function fit(cv, w, h) {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    cv.style.width = w + 'px'; cv.style.height = h + 'px';
    var c = cv.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    return c;
  }
  function labWidth(el) {
    var n = el;
    while (n && !(n.classList && n.classList.contains('lab'))) n = n.parentNode;
    return n ? n.clientWidth : 0;
  }

  var SW = 344, PW = 250, sc = null, pr = null;
  function layout() {
    var inner = labWidth(sceneEl) - 52;
    SW = Math.round(clamp(inner > 0 ? Math.min(344, inner) : 344, 210, 344));
    PW = Math.round(clamp(inner > 0 ? Math.min(250, inner) : 250, 190, 250));
    sc = fit(sceneEl, SW, Math.round(SW * SCH));
    if (prEl) pr = fit(prEl, PW, PW);
  }

  function box(g, b, col, dash, wdt) {
    g.save();
    g.strokeStyle = col; g.lineWidth = wdt || 1.6;
    g.setLineDash(dash || []);
    g.strokeRect(b.x * SW, b.y * SW, b.w * SW, b.h * SW);
    g.restore();
  }

  function drawScene() {
    if (!sc) return;
    var W = SW, H = Math.round(SW * SCH), g = sc;
    var panel2 = css('--panel2'), line = css('--line'), lang = css('--lang'),
        ok = css('--ok'), bad = css('--bad'), tx3 = css('--tx3'), tx2 = css('--tx2');
    g.clearRect(0, 0, W, H);
    g.fillStyle = panel2; g.fillRect(0, 0, W, H);
    g.strokeStyle = line; g.globalAlpha = 0.5; g.lineWidth = 1;
    for (var q = 1; q < 6; q++) {
      g.beginPath(); g.moveTo(W * q / 6, 0); g.lineTo(W * q / 6, H); g.stroke();
      g.beginPath(); g.moveTo(0, H * q / 6); g.lineTo(W, H * q / 6); g.stroke();
    }
    g.globalAlpha = 1;

    var im = imgs[cur], o = R.per[cur], fl = R.match[cur], i;

    /* 정답(GT) — 호박색 점선 */
    for (i = 0; i < im.gt.length; i++) box(g, im.gt[i], lang, [4, 3], 1.4);

    if (o.failed) {
      g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(0, 0, W, H);
      g.fillStyle = bad;
      g.font = '600 13px "IBM Plex Mono", monospace';
      g.textAlign = 'center';
      g.fillText(o.skipped ? '파싱 실패 · 평가 제외' : '파싱 실패 · 검출 0건', W / 2, H / 2 - 2);
      g.font = '11px "IBM Plex Sans KR", system-ui, sans-serif';
      g.fillStyle = tx2;
      g.fillText(o.skipped ? '이 장면의 GT는 분모에서도 빠집니다'
                           : '이 장면의 GT는 전부 미검출로 계산됩니다', W / 2, H / 2 + 16);
      g.textAlign = 'left';
      return;
    }

    /* 놓친 GT — ✕ 표시 */
    for (i = 0; i < im.gt.length; i++) {
      if (fl.gt[i]) continue;
      var b = im.gt[i], mx = (b.x + b.w / 2) * SW, my = (b.y + b.h / 2) * SW;
      var s = Math.max(4, Math.min(9, b.w * SW * 0.35));
      g.strokeStyle = bad; g.lineWidth = 1.6; g.globalAlpha = 0.85;
      g.beginPath();
      g.moveTo(mx - s, my - s); g.lineTo(mx + s, my + s);
      g.moveTo(mx + s, my - s); g.lineTo(mx - s, my + s);
      g.stroke(); g.globalAlpha = 1;
    }
    /* 예측 — 맞춘 것은 초록, 헛것은 빨강 */
    for (i = 0; i < o.preds.length; i++) {
      box(g, o.preds[i], fl.pred[i] ? ok : bad, [], fl.pred[i] ? 1.8 : 1.4);
    }
    if (im.gt.length === 0) {
      g.fillStyle = tx3;
      g.font = '11px "IBM Plex Sans KR", system-ui, sans-serif';
      g.fillText('이 장면에는 정답 박스가 없습니다', 10, H - 10);
    }
  }

  function drawPR() {
    if (!pr) return;
    var S = PW, g = pr;
    var panel2 = css('--panel2'), line = css('--line'), vis = css('--vis'),
        tx3 = css('--tx3'), lang = css('--lang');
    g.clearRect(0, 0, S, S);
    g.fillStyle = panel2; g.fillRect(0, 0, S, S);
    var pad = 30, x0 = pad, y0 = S - pad, x1 = S - 12, y1 = 12;
    function PX(r) { return x0 + r * (x1 - x0); }
    function PY(p) { return y0 - p * (y0 - y1); }

    g.strokeStyle = line; g.lineWidth = 1; g.globalAlpha = 0.6;
    for (var t = 0; t <= 4; t++) {
      g.beginPath(); g.moveTo(PX(t / 4), y1); g.lineTo(PX(t / 4), y0); g.stroke();
      g.beginPath(); g.moveTo(x0, PY(t / 4)); g.lineTo(x1, PY(t / 4)); g.stroke();
    }
    g.globalAlpha = 1;
    g.fillStyle = tx3;
    g.font = '9.5px "IBM Plex Mono", monospace';
    g.fillText('0', x0 - 6, y0 + 12);
    g.fillText('1', x1 - 4, y0 + 12);
    g.fillText('1', x0 - 16, y1 + 6);
    g.font = '10px "IBM Plex Sans KR", system-ui, sans-serif';
    g.fillText('재현율', (x0 + x1) / 2 - 16, y0 + 22);
    g.save();
    g.translate(x0 - 18, (y0 + y1) / 2 + 16); g.rotate(-Math.PI / 2);
    g.fillText('정밀도', 0, 0);
    g.restore();

    var pts = R.pts, env = R.env, n = pts.length;
    if (!n) {
      g.fillStyle = tx3;
      g.font = '11px "IBM Plex Sans KR", system-ui, sans-serif';
      g.fillText('예측이 하나도 없습니다', x0 + 8, (y0 + y1) / 2);
      return;
    }
    /* 곡선 아래 면적 = AP */
    g.beginPath();
    g.moveTo(PX(0), PY(env[0]));
    for (var j = 0; j < n; j++) {
      g.lineTo(PX(pts[j].r), PY(env[j]));
      if (j + 1 < n) g.lineTo(PX(pts[j].r), PY(env[j + 1]));
    }
    g.lineTo(PX(pts[n - 1].r), PY(0));
    g.lineTo(PX(0), PY(0));
    g.closePath();
    g.fillStyle = vis; g.globalAlpha = 0.16; g.fill(); g.globalAlpha = 1;

    /* 계단 */
    g.beginPath();
    g.moveTo(PX(0), PY(env[0]));
    for (j = 0; j < n; j++) {
      g.lineTo(PX(pts[j].r), PY(env[j]));
      if (j + 1 < n) g.lineTo(PX(pts[j].r), PY(env[j + 1]));
    }
    g.strokeStyle = vis; g.lineWidth = 1.8; g.stroke();

    /* 운영점 */
    if (n <= 24) {
      for (j = 0; j < n; j++) {
        g.beginPath(); g.arc(PX(pts[j].r), PY(pts[j].p), n === 1 ? 5 : 3, 0, 7);
        g.fillStyle = n === 1 ? lang : vis; g.fill();
      }
    }
    if (n === 1) {   /* 점수가 없다 = 돌릴 손잡이가 없다 */
      g.save();
      g.setLineDash([3, 3]); g.strokeStyle = lang; g.lineWidth = 1; g.globalAlpha = 0.8;
      g.beginPath();
      g.moveTo(PX(0), PY(pts[0].p)); g.lineTo(PX(pts[0].r), PY(pts[0].p));
      g.lineTo(PX(pts[0].r), PY(0));
      g.stroke();
      g.restore();
      g.fillStyle = lang;
      g.font = '10px "IBM Plex Sans KR", system-ui, sans-serif';
      g.fillText('운영점 1개', PX(pts[0].r) + 6, PY(pts[0].p) - 6);
    }
  }

  /* --- UI ---------------------------------------------------------------- */
  var el = {
    noise: document.getElementById('z_noise'), noiseV: document.getElementById('z_noisev'),
    miss: document.getElementById('z_miss'), missV: document.getElementById('z_missv'),
    hallu: document.getElementById('z_hallu'), halluV: document.getElementById('z_halluv'),
    parse: document.getElementById('z_parse'), parseV: document.getElementById('z_parsev'),
    parseWrap: document.getElementById('z_parsewrap'),
    policyWrap: document.getElementById('z_policywrap'),
    sceneV: document.getElementById('z_scenev'),
    prev: document.getElementById('z_prev'), next: document.getElementById('z_next'),
    reroll: document.getElementById('z_reroll'),
    ngt: document.getElementById('z_ngt'), npred: document.getElementById('z_npred'),
    tp: document.getElementById('z_tp'), fp: document.getElementById('z_fp'),
    fn: document.getElementById('z_fn'),
    prec: document.getElementById('z_prec'), rec: document.getElementById('z_rec'),
    ap50: document.getElementById('z_ap50'), ap75: document.getElementById('z_ap75'),
    fail: document.getElementById('z_fail'), ops: document.getElementById('z_ops'),
    verdict: document.getElementById('z_verdict')
  };
  var tierBtns = document.querySelectorAll('#z_tier button');
  var detBtns = document.querySelectorAll('#z_det button');
  var polBtns = document.querySelectorAll('#z_policy button');

  var tier = 'mid', det = 'ov', policy = 'zero', seedOff = 0, cur = 0;
  var imgs = [], R = null;

  function opts() {
    return {
      det: det,
      noise: +el.noise.value / 100,
      miss: +el.miss.value / 100,
      hallu: +el.hallu.value / 100,
      parse: det === 'ov' ? 0 : +el.parse.value / 100,
      policy: policy
    };
  }

  function verdict() {
    var o = opts(), s = [];
    if (det === 'gen') {
      s.push('점수가 없으니 운영점은 <b>단 하나</b>입니다 — 정밀도와 재현율을 맞바꿀 손잡이가 없습니다. ' +
             '여기서의 AP는 그 점 아래 직사각형 넓이(정밀도 × 재현율)일 뿐입니다.');
    } else if (det === 'gensc') {
      s.push('자기평가 점수 다섯 단계가 계단 다섯 칸을 만듭니다 — 곡선이 <b>되살아나지만 아주 거칩니다</b>. ' +
             '고를 수 있는 임계는 다섯 개뿐입니다.');
    } else {
      s.push('연속 점수가 있으니 임계를 돌려 정밀도와 재현율을 맞바꿀 수 있습니다.');
    }
    if (tier === 'hard') {
      s.push('작고 밀집한 장면에서는 <b>같은 노이즈가 IoU를 통째로 날려버립니다</b> — ' +
             'AP50과 AP75의 간격을 보세요.');
    } else if (tier === 'easy' && R.ap50 > 0.6) {
      s.push('큰 물체 하나짜리 장면이라면 제로샷도 꽤 그럴듯해 보입니다. 여기까지가 하한선의 가장 좋은 얼굴입니다.');
    }
    if (o.parse > 0 && policy === 'drop' && R.fail > 0) {
      s.push('파싱 실패 ' + R.fail + '장을 평가에서 빼면 <b>하한선이 그만큼 부풀려집니다</b> — ' +
             '운영에서 그 요청은 실패한 요청입니다.');
    }
    return s.join(' ');
  }

  function refresh() {
    R = evaluate(imgs, opts());
    if (cur >= imgs.length) cur = 0;
    drawScene(); drawPR();
    el.noiseV.textContent = '±' + (+el.noise.value / 100 * NOISE_UNIT * 100).toFixed(1) + '% 폭';
    el.missV.textContent = el.miss.value + '%';
    el.halluV.textContent = el.hallu.value + '%';
    el.parseV.textContent = el.parse.value + '%';
    el.sceneV.textContent = (cur + 1) + ' / ' + imgs.length;
    el.ngt.textContent = R.nGT;
    el.npred.textContent = R.nPred;
    el.tp.textContent = R.tp;
    el.fp.textContent = R.fp;
    el.fn.textContent = R.fn;
    el.prec.textContent = pct(R.prec);
    el.rec.textContent = pct(R.rec);
    el.ap50.textContent = R.ap50.toFixed(3);
    el.ap75.textContent = R.ap75.toFixed(3);
    el.fail.textContent = det === 'ov' ? '해당 없음'
      : R.fail + '장 (' + (policy === 'drop' ? '제외' : '미검출 처리') + ')';
    el.ops.textContent = R.pts.length + '개';
    el.ops.className = R.pts.length <= 6 ? 'warn' : 'good';
    el.verdict.innerHTML = verdict();
  }

  function rebuild() {
    imgs = buildScenes(tier, seedOff);
    cur = 0;
    refresh();
  }

  function seg(nodes, attr, set) {
    Array.prototype.forEach.call(nodes, function (b) {
      b.addEventListener('click', function () {
        Array.prototype.forEach.call(nodes, function (x) { x.classList.remove('sel'); });
        b.classList.add('sel');
        set(b.getAttribute(attr));
      });
    });
  }
  seg(tierBtns, 'data-t', function (v) { tier = v; rebuild(); });
  seg(detBtns, 'data-d', function (v) {
    det = v;
    var off = (det === 'ov');
    el.parse.disabled = off;
    el.parseWrap.classList.toggle('dim', off);
    el.policyWrap.classList.toggle('dim', off);
    Array.prototype.forEach.call(polBtns, function (x) { x.disabled = off; });
    refresh();
  });
  seg(polBtns, 'data-p', function (v) { policy = v; refresh(); });

  ['noise', 'miss', 'hallu', 'parse'].forEach(function (k) {
    el[k].addEventListener('input', refresh);
  });
  el.prev.addEventListener('click', function () {
    cur = (cur - 1 + imgs.length) % imgs.length; refresh();
  });
  el.next.addEventListener('click', function () {
    cur = (cur + 1) % imgs.length; refresh();
  });
  el.reroll.addEventListener('click', function () { seedOff++; rebuild(); });

  var rt = null;
  window.addEventListener('resize', function () {
    if (rt) clearTimeout(rt);
    rt = setTimeout(function () { layout(); drawScene(); drawPR(); }, 160);
  });
  new MutationObserver(function () { drawScene(); drawPR(); })
    .observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  layout();
  rebuild();
})();


/* ==========================================================================
   LAB 5-2 — 프롬프트 민감도 미니

   ★ 개념 시뮬레이션입니다. 실제 모델을 부르지 않으며, 여기 숫자는 실측이 아닙니다.
     "표현을 바꾸면 검출률이 흔들리고, 장면이 바뀌면 순위까지 뒤집힌다"는 구조만
     재현합니다. 각 표현에 기댓값(base)과 흔들림 폭(spread)을 주고, 장면 번호로
     결정적 난수를 뽑아 값을 만듭니다. 값은 새로고침해도 같습니다.
   ========================================================================== */
(function () {
  'use strict';

  var host = document.getElementById('p_bars');
  if (!host) return;

  function rng(seed) {
    return function () {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  var NSCENE = 6;
  var P = [
    { t: 'person',                        d: '맨 명사 하나',                base: 0.62, sp: 0.17 },
    { t: 'a photo of a person',           d: 'CLIP식 템플릿으로 감싸기',    base: 0.70, sp: 0.12 },
    { t: 'pedestrian',                    d: '동의어로 바꾸기',             base: 0.55, sp: 0.23 },
    { t: 'person walking on the street',  d: '수식 구를 붙이기',            base: 0.50, sp: 0.26 },
    { t: 'human. person. pedestrian.',    d: '동의어 나열(마침표 구분)',    base: 0.73, sp: 0.15 }
  ];

  function val(i, s) {
    var r = rng(90210 + s * 977 + i * 131);
    r(); /* 첫 값은 버린다 — 시드가 이웃하면 첫 표본이 비슷해지므로 */
    return clamp(P[i].base + (r() - 0.5) * 2 * P[i].sp, 0.04, 0.97);
  }

  var mean = P.map(function (_, i) {
    var s = 0;
    for (var k = 0; k < NSCENE; k++) s += val(i, k);
    return s / NSCENE;
  });

  var scene = 0;
  var sceneV = document.getElementById('p_scenev');
  var spreadV = document.getElementById('p_spread');
  var bestV = document.getElementById('p_best');
  var nextBtn = document.getElementById('p_next');

  function esc(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function draw() {
    var v = P.map(function (_, i) { return val(i, scene); });
    var lo = Math.min.apply(null, v), hi = Math.max.apply(null, v);
    var html = '';
    for (var i = 0; i < P.length; i++) {
      var col = v[i] === hi ? 'ok' : (v[i] === lo ? 'bad' : 'vis');
      html +=
        '<div style="margin:0 0 12px">' +
          '<div style="display:flex;justify-content:space-between;gap:10px;font-size:12.5px;' +
            'font-family:\'IBM Plex Mono\',monospace;color:var(--tx2)">' +
            '<span>"' + esc(P[i].t) + '"</span>' +
            '<span style="color:var(--' + col + ')">' + (v[i] * 100).toFixed(1) + '%</span>' +
          '</div>' +
          '<div style="position:relative;height:9px;border-radius:5px;background:var(--panel2);' +
            'margin:5px 0 3px;overflow:hidden">' +
            '<i style="display:block;height:100%;width:' + (v[i] * 100).toFixed(1) + '%;' +
              'background:var(--' + col + ')"></i>' +
            '<i style="position:absolute;top:0;bottom:0;left:' + (mean[i] * 100).toFixed(1) + '%;' +
              'width:2px;background:var(--tx3)"></i>' +
          '</div>' +
          '<div style="font-size:11.5px;color:var(--tx3)">' + P[i].d + '</div>' +
        '</div>';
    }
    host.innerHTML = html;
    if (sceneV) sceneV.textContent = (scene + 1) + ' / ' + NSCENE;
    if (spreadV) spreadV.textContent = ((hi - lo) * 100).toFixed(1) + '%p';
    if (bestV) bestV.textContent = '"' + P[v.indexOf(hi)].t + '"';
  }

  if (nextBtn) nextBtn.addEventListener('click', function () {
    scene = (scene + 1) % NSCENE; draw();
  });
  draw();
})();
