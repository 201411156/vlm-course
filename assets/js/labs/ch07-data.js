/* ==========================================================================
   7장 실습 — instruction 데이터 빌더 / 누수 탐지
     LAB 7-1  기하 라벨(합성 장면 + GT 박스) → 대화형 instruction JSON 자동 변환.
              템플릿 회전 · 부정 샘플 비율 · 좌표 포맷 · 포맷 검사기.
     LAB 7-2  평균 해시(aHash) + 해밍 거리로 train/val 사이의 같은 장면을 찾는 미니 데모.
   외부 라이브러리 없음. 이미지 파일 없음 — 장면은 전부 캔버스로 그립니다.
   ========================================================================== */
(function () {
  'use strict';

  /* ======================================================================
     공용 유틸
     ====================================================================== */

  /* 결정적 난수 (mulberry32) — 새로고침해도 같은 데이터셋이 나옵니다. */
  function rng(seed) {
    return function () {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function css(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  /* 캔버스: 논리 좌표계는 w×h 로 두고, 화면에서는 폭에 맞춰 줄어듭니다. */
  function fit(canvas, w, h) {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = '100%';
    canvas.style.maxWidth = w + 'px';
    canvas.style.height = 'auto';
    var c = canvas.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    return c;
  }

  /* 한국어 조사 — 받침 유무로 고릅니다. 질문 문장이 어색하면 데이터도 어색합니다. */
  function josa(w, withBatchim, without) {
    var c = w.charCodeAt(w.length - 1);
    var bat = (c >= 0xAC00 && c <= 0xD7A3) ? ((c - 0xAC00) % 28) !== 0 : false;
    return w + (bat ? withBatchim : without);
  }

  /* ======================================================================
     합성 장면 — 두 LAB 이 공유합니다.
     좌표는 전부 [0,1] 정규화. 렌더 크기와 무관하게 같은 장면입니다.
     ====================================================================== */

  var CLS = ['사람', '자동차', '자전거', '신호등', '개'];
  /* 크기(정규화) — 클래스마다 다른 종횡비를 줍니다. */
  var SIZE = [
    { w: 0.055, h: 0.19 }, { w: 0.20, h: 0.11 }, { w: 0.12, h: 0.09 },
    { w: 0.046, h: 0.22 }, { w: 0.10, h: 0.072 }
  ];
  /* 같은 장면에 함께 나올 법한 순서 — "어려운 부정 샘플"을 고를 때 씁니다. */
  var CONFUSE = [[2, 4, 1, 3], [2, 3, 0, 4], [0, 1, 4, 3], [1, 0, 2, 4], [0, 2, 1, 3]];
  var SKIES = [
    ['#8fb9d4', '#dbe8ee'], ['#b8c6d6', '#e6e2d8'], ['#e0b98f', '#f0dcc4'],
    ['#7d9fc0', '#cdd9e2'], ['#a9bfc9', '#e9ece6']
  ];

  function makeScene(seed) {
    var r = rng(seed);
    var i, j;

    /* --- 배경: 지평선 · 하늘 · 스카이라인 --- */
    var horizon = 0.48 + r() * 0.12;
    var sky = SKIES[Math.floor(r() * SKIES.length)];
    var blds = [], x = -0.06 + r() * 0.05;
    while (x < 1.0 && blds.length < 8) {
      var bw = 0.07 + r() * 0.15;
      blds.push({ x: x, w: bw, h: 0.06 + r() * 0.30, s: r() });
      x += bw + (r() * 0.07 - 0.015);
    }

    /* --- 전경 물체 --- */
    var pool = [0, 1, 2, 3, 4];
    for (i = pool.length - 1; i > 0; i--) {
      j = Math.floor(r() * (i + 1));
      var t = pool[i]; pool[i] = pool[j]; pool[j] = t;
    }
    var k = 1 + Math.floor(r() * 3);                 /* 클래스 1~3종 */
    var objs = [];
    for (i = 0; i < k; i++) {
      var ci = pool[i];
      var n = 1 + Math.floor(r() * r() * 3);         /* 인스턴스 1~3개(1쪽으로 치우침) */
      for (j = 0; j < n; j++) {
        var depth = r();
        var sc = 0.72 + depth * 0.60;
        var w = SIZE[ci].w * sc, h = SIZE[ci].h * sc;
        var base = Math.min(0.98, horizon + 0.06 + depth * 0.30);
        var x0 = 0.02 + r() * (0.96 - w);
        objs.push({ c: ci, b: [x0, base - h, x0 + w, base], d: depth });
      }
    }
    objs.sort(function (a, b) { return a.d - b.d; });  /* 먼 것부터 그립니다 */

    var present = {};
    for (i = 0; i < objs.length; i++) present[objs[i].c] = (present[objs[i].c] || 0) + 1;
    return { seed: seed, horizon: horizon, sky: sky, blds: blds,
             objs: objs, present: present, tint: null };
  }

  /* 같은 장면의 "다음 프레임" — 카메라가 조금 흔들리고, 물체 하나가 움직이고,
     노출이 살짝 달라집니다. 사람 눈에는 다른 사진이지만 내용은 같은 장면입니다. */
  function variantOf(sc, r) {
    var pan = (r() < 0.5 ? -1 : 1) * (0.006 + r() * 0.008);
    var objs = [], blds = [], i, b;
    for (i = 0; i < sc.objs.length; i++) {
      b = sc.objs[i].b;
      objs.push({ c: sc.objs[i].c, b: [b[0] + pan, b[1], b[2] + pan, b[3]], d: sc.objs[i].d });
    }
    var m = objs.length - 1;
    var dx = (r() < 0.5 ? -1 : 1) * (0.02 + r() * 0.03);
    objs[m].b[0] += dx; objs[m].b[2] += dx;
    for (i = 0; i < sc.blds.length; i++) {
      blds.push({ x: sc.blds[i].x + pan, w: sc.blds[i].w, h: sc.blds[i].h, s: sc.blds[i].s });
    }
    return { seed: sc.seed, horizon: sc.horizon,
             sky: sc.sky, blds: blds, objs: objs, present: sc.present,
             tint: r() < 0.5 ? 'rgba(255,255,255,.09)' : 'rgba(0,0,0,.09)' };
  }

  /* --- 장면 그리기 (사진 그 자체이므로 고정 팔레트를 씁니다) --------------- */
  function paintScene(c, W, H, sc) {
    var hz = sc.horizon * H, i;
    var g = c.createLinearGradient(0, 0, 0, hz);
    g.addColorStop(0, sc.sky[0]); g.addColorStop(1, sc.sky[1]);
    c.fillStyle = g; c.fillRect(0, 0, W, hz);
    for (i = 0; i < sc.blds.length; i++) {
      var b = sc.blds[i], v = Math.round(78 + b.s * 88);
      c.fillStyle = 'rgb(' + v + ',' + (v + 5) + ',' + (v + 15) + ')';
      c.fillRect(b.x * W, hz - b.h * H, b.w * W, b.h * H);
    }
    c.fillStyle = '#8e9089'; c.fillRect(0, hz, W, H - hz);
    c.fillStyle = '#7e8078'; c.fillRect(0, hz, W, Math.max(1, H * 0.015));
    for (i = 0; i < sc.objs.length; i++) {
      var o = sc.objs[i], bb = o.b;
      drawObj(c, o.c, bb[0] * W, bb[1] * H, (bb[2] - bb[0]) * W, (bb[3] - bb[1]) * H);
    }
    if (sc.tint) { c.fillStyle = sc.tint; c.fillRect(0, 0, W, H); }
  }

  var OBJCOL = ['#c9603c', '#3f6cba', '#2f9c74', '#c39a2e', '#8d5fb5'];

  function drawObj(c, ci, x, y, w, h) {
    var col = OBJCOL[ci], cx = x + w / 2;
    c.fillStyle = col;
    if (ci === 0) {                                   /* 사람 */
      c.beginPath(); c.arc(cx, y + w * 0.5, w * 0.46, 0, 7); c.fill();
      c.fillRect(cx - w * 0.4, y + w * 1.05, w * 0.8, h * 0.42);
      c.fillRect(cx - w * 0.34, y + w * 1.05 + h * 0.42, w * 0.26, h * 0.36);
      c.fillRect(cx + w * 0.08, y + w * 1.05 + h * 0.42, w * 0.26, h * 0.36);
    } else if (ci === 1) {                            /* 자동차 */
      c.beginPath();
      c.moveTo(x + w * 0.22, y + h * 0.45); c.lineTo(x + w * 0.36, y);
      c.lineTo(x + w * 0.70, y); c.lineTo(x + w * 0.82, y + h * 0.45);
      c.closePath(); c.fill();
      c.fillRect(x, y + h * 0.42, w, h * 0.36);
      c.fillStyle = '#24272d';
      c.beginPath(); c.arc(x + w * 0.24, y + h * 0.82, h * 0.18, 0, 7); c.fill();
      c.beginPath(); c.arc(x + w * 0.76, y + h * 0.82, h * 0.18, 0, 7); c.fill();
    } else if (ci === 2) {                            /* 자전거 */
      c.strokeStyle = col; c.lineWidth = Math.max(1, h * 0.12);
      c.beginPath(); c.arc(x + w * 0.22, y + h * 0.72, h * 0.26, 0, 7); c.stroke();
      c.beginPath(); c.arc(x + w * 0.78, y + h * 0.72, h * 0.26, 0, 7); c.stroke();
      c.beginPath();
      c.moveTo(x + w * 0.22, y + h * 0.72); c.lineTo(x + w * 0.48, y + h * 0.28);
      c.lineTo(x + w * 0.78, y + h * 0.72); c.moveTo(x + w * 0.48, y + h * 0.28);
      c.lineTo(x + w * 0.28, y + h * 0.22);
      c.stroke();
    } else if (ci === 3) {                            /* 신호등 */
      c.fillStyle = '#4e515a';
      c.fillRect(cx - w * 0.14, y + h * 0.38, w * 0.28, h * 0.62);
      c.fillStyle = col;
      c.fillRect(x, y, w, h * 0.40);
      c.fillStyle = '#f4f1e6';
      for (var k = 0; k < 3; k++) {
        c.beginPath(); c.arc(cx, y + h * 0.09 + k * h * 0.11, w * 0.15, 0, 7); c.fill();
      }
    } else {                                          /* 개 */
      c.beginPath();
      if (c.ellipse) c.ellipse(x + w * 0.42, y + h * 0.45, w * 0.34, h * 0.30, 0, 0, 7);
      else c.arc(x + w * 0.42, y + h * 0.45, h * 0.30, 0, 7);
      c.fill();
      c.beginPath(); c.arc(x + w * 0.82, y + h * 0.30, h * 0.24, 0, 7); c.fill();
      c.fillRect(x + w * 0.18, y + h * 0.65, w * 0.10, h * 0.35);
      c.fillRect(x + w * 0.58, y + h * 0.65, w * 0.10, h * 0.35);
      c.strokeStyle = col; c.lineWidth = Math.max(1, h * 0.13);
      c.beginPath(); c.moveTo(x + w * 0.10, y + h * 0.36);
      c.lineTo(x, y + h * 0.10); c.stroke();
    }
  }

  /* ======================================================================
     LAB 7-1 — instruction 데이터 빌더
     ====================================================================== */
  (function () {
    var cv = document.getElementById('db_scene');
    if (!cv) return;

    var W = 340, H = 250;
    var g2d = fit(cv, W, H);

    var NSCENE = 120, NSAMPLE = 240;
    var SRCW = 1280, SRCH = 960;   /* 라벨을 딴 원본 크기 */
    var RENW = 448;                /* 모델에 실제로 들어가는 크기 */

    var SCENES = [];
    for (var s = 0; s < NSCENE; s++) SCENES.push(makeScene(70001 + s * 37));

    /* --- 질문 템플릿 (회전) --------------------------------------------- */
    var QT = {
      exist: [
        function (c) { return '이 장면에 ' + josa(c, '이', '가') + ' 있습니까?'; },
        function (c) { return '사진에서 ' + josa(c, '을', '를') + ' 찾을 수 있습니까?'; },
        function (c) { return c + '이(가) 보이면 예, 보이지 않으면 아니오로 답하십시오.'; },
        function (c) { return '이미지에 ' + josa(c, '이', '가') + ' 포함되어 있습니까?'; }
      ],
      loc: [
        function (c) { return josa(c, '은', '는') + ' 어디에 있습니까? 경계 상자로 답하십시오.'; },
        function (c) { return c + '의 위치를 좌표로 알려 주십시오.'; },
        function (c) { return '이미지에서 ' + josa(c, '을', '를') + ' 찾아 상자 좌표를 출력하십시오.'; },
        function (c) { return josa(c, '이', '가') + ' 있는 영역의 좌표는 무엇입니까?'; }
      ],
      count: [
        function (c) { return '이 장면에 ' + josa(c, '이', '가') + ' 몇 개 있습니까?'; },
        function (c) { return c + '의 개수를 숫자로 답하십시오.'; },
        function (c) { return '사진 속 ' + josa(c, '은', '는') + ' 모두 몇 개입니까?'; },
        function (c) { return josa(c, '을', '를') + ' 세어 숫자만 출력하십시오.'; }
      ]
    };
    var TYPE_KO = { exist: '존재', loc: '위치', count: '개수' };

    /* --- 좌표 포맷 ------------------------------------------------------- */
    var FMT = {
      norm1000: { label: '정수 0~1000', min: 0, max: 1000,
        spec: '좌표는 이미지 크기를 0~1000으로 정규화한 정수 [x0,y0,x1,y1]입니다.',
        f: function (v) { return String(Math.round(v * 1000)); } },
      norm01: { label: '0~1 실수', min: 0, max: 1,
        spec: '좌표는 이미지 크기로 나눈 0~1 실수 [x0,y0,x1,y1]입니다.',
        f: function (v) { return v.toFixed(3); } },
      pixel: { label: '픽셀 절대값(448px)', min: 0, max: RENW - 1,
        spec: '좌표는 448×448 이미지의 픽셀 정수 [x0,y0,x1,y1]입니다.',
        f: function (v) { return String(Math.round(v * (RENW - 1))); } }
    };

    function boxStr(b, key, bug) {
      if (bug) {                    /* 리사이즈 전 원본 픽셀을 그대로 적는 고전적 버그 */
        return '[' + Math.round(b[0] * SRCW) + ',' + Math.round(b[1] * SRCH) + ',' +
               Math.round(b[2] * SRCW) + ',' + Math.round(b[3] * SRCH) + ']';
      }
      var f = FMT[key].f;
      return '[' + f(b[0]) + ',' + f(b[1]) + ',' + f(b[2]) + ',' + f(b[3]) + ']';
    }

    var el = {
      exist: document.getElementById('db_t_exist'),
      loc: document.getElementById('db_t_loc'),
      count: document.getElementById('db_t_count'),
      neg: document.getElementById('db_t_neg'),
      ratio: document.getElementById('db_ratio'),
      ratioV: document.getElementById('db_ratioV'),
      bugImg: document.getElementById('db_bug_img'),
      bugCoord: document.getElementById('db_bug_coord'),
      bugFmt: document.getElementById('db_bug_fmt'),
      json: document.getElementById('db_json'),
      idx: document.getElementById('db_idx'),
      meta: document.getElementById('db_meta'),
      stat: document.getElementById('db_stat'),
      dist: document.getElementById('db_dist'),
      check: document.getElementById('db_check'),
      prev: document.getElementById('db_prev'),
      next: document.getElementById('db_next')
    };
    var fmtBtns = document.querySelectorAll('#db_fmt button');
    var fmtKey = 'norm1000';
    var cur = 0, DATA = [];

    function cfg() {
      var types = [];
      if (el.exist.checked) types.push('exist');
      if (el.loc.checked) types.push('loc');
      if (el.count.checked) types.push('count');
      return {
        types: types,
        neg: el.neg.checked,
        ratio: parseInt(el.ratio.value, 10) / 100,
        bugImg: el.bugImg.checked,
        bugCoord: el.bugCoord.checked,
        bugFmt: el.bugFmt.checked
      };
    }

    /* 부정 대상: 장면에 없되 "함께 나올 법한" 클래스 — 무작위보다 훨씬 어렵습니다. */
    function pickAbsent(sc) {
      var keys = Object.keys(sc.present), i, j;
      for (i = 0; i < keys.length; i++) {
        var list = CONFUSE[keys[i] | 0];
        for (j = 0; j < list.length; j++) if (!sc.present[list[j]]) return list[j];
      }
      return -1;
    }

    /* --- 데이터셋 생성 ---------------------------------------------------- */
    function build() {
      var c = cfg();
      DATA = [];
      if (!c.types.length) return;
      var r = rng(20260907);
      var tc = { exist: 0, loc: 0, count: 0 };
      for (var i = 0; i < NSAMPLE; i++) {
        var sc = SCENES[i % NSCENE];
        var type = c.types[i % c.types.length];
        var neg = c.neg && r() < c.ratio;
        var target = -1;
        if (neg) { target = pickAbsent(sc); if (target < 0) neg = false; }
        if (!neg) {
          var pk = Object.keys(sc.present);
          target = pk[Math.floor(r() * pk.length)] | 0;
        }
        var name = CLS[target];
        var ti = tc[type]++ % QT[type].length;
        var q = QT[type][ti](name);

        var a, k, boxes = [];
        if (type === 'exist') {
          a = neg ? '아니오' : '예';
        } else if (type === 'count') {
          a = String(neg ? 0 : sc.present[target]);
        } else if (neg) {
          a = '해당 물체는 이미지에 없습니다.';
        } else {
          for (k = 0; k < sc.objs.length; k++) {
            if (sc.objs[k].c === target) boxes.push(sc.objs[k].b);
          }
          var parts = [];
          for (k = 0; k < boxes.length; k++) parts.push(boxStr(boxes[k], fmtKey, c.bugCoord));
          a = parts.join(', ');
        }

        /* 실수 재현 ① 답변 형식 혼재 */
        if (c.bugFmt && i % 8 === 3) {
          if (type === 'exist') {
            a = neg ? '아니요, ' + josa(name, '은', '는') + ' 보이지 않습니다.'
                    : '네, ' + josa(name, '이', '가') + ' 보입니다.';
          } else if (type === 'count') {
            a = (neg ? 0 : sc.present[target]) + '개입니다.';
          }
        }
        /* 실수 재현 ② 이미지 플레이스홀더 누락 */
        var hasImg = !(c.bugImg && i % 9 === 5);

        DATA.push({ i: i, scene: i % NSCENE, type: type, neg: neg, target: target,
                    q: q, a: a, hasImg: hasImg, ti: ti });
      }
    }

    /* --- 샘플 → JSON ------------------------------------------------------ */
    function sysPrompt() {
      return '이미지를 보고 질문에 답합니다. 존재 질문에는 "예" 또는 "아니오"로만, ' +
             '개수 질문에는 숫자로만, 위치 질문에는 좌표 배열로만 답합니다. ' + FMT[fmtKey].spec;
    }
    function toJSON(d) {
      return {
        id: 'syn_' + ('00000' + d.i).slice(-6),
        image: 'scenes/' + ('00000' + d.scene).slice(-6) + '.png',
        conversations: [
          { from: 'system', value: sysPrompt() },
          { from: 'human', value: (d.hasImg ? '<image>\n' : '') + d.q },
          { from: 'gpt', value: d.a }
        ]
      };
    }

    /* --- 장면 + GT 박스 그리기 -------------------------------------------- */
    function draw() {
      var d = DATA[cur];
      g2d.clearRect(0, 0, W, H);
      if (!d) {
        g2d.fillStyle = css('--panel2'); g2d.fillRect(0, 0, W, H);
        g2d.fillStyle = css('--tx3');
        g2d.font = '13px "IBM Plex Sans KR", system-ui, sans-serif';
        g2d.fillText('질문 템플릿을 하나 이상 선택하십시오.', 24, H / 2);
        return;
      }
      var sc = SCENES[d.scene];
      paintScene(g2d, W, H, sc);

      var vis = css('--vis'), lang = css('--lang'), panel = css('--panel');
      g2d.font = '600 10px "IBM Plex Mono", monospace';
      for (var i = 0; i < sc.objs.length; i++) {
        var o = sc.objs[i], b = o.b;
        var x = b[0] * W, y = b[1] * H, w = (b[2] - b[0]) * W, h = (b[3] - b[1]) * H;
        var hot = !d.neg && o.c === d.target;
        g2d.strokeStyle = hot ? lang : vis;
        g2d.lineWidth = hot ? 2 : 1;
        g2d.globalAlpha = hot ? 1 : 0.7;
        g2d.strokeRect(x, y, w, h);
        g2d.globalAlpha = 1;
        var lab = CLS[o.c], ly = Math.max(0, y - 12);
        g2d.fillStyle = hot ? lang : vis;
        g2d.fillRect(x, ly, g2d.measureText(lab).width + 8, 12);
        g2d.fillStyle = panel;
        g2d.fillText(lab, x + 4, ly + 9);
      }
      if (d.neg) {
        var msg = '부정 샘플 — ' + josa('"' + CLS[d.target] + '"', '은', '는') +
                  ' 이 장면에 없습니다';
        g2d.font = '600 11px "IBM Plex Sans KR", system-ui, sans-serif';
        g2d.fillStyle = css('--bad'); g2d.globalAlpha = 0.94;
        g2d.fillRect(8, H - 27, g2d.measureText(msg).width + 14, 19);
        g2d.globalAlpha = 1;
        g2d.fillStyle = panel;
        g2d.fillText(msg, 15, H - 14);
      }
    }

    /* --- 통계 ------------------------------------------------------------- */
    function stats() {
      var pos = 0, negn = 0, i;
      var per = [0, 0, 0, 0, 0], perNeg = [0, 0, 0, 0, 0];
      var uq = {}, ut = {}, byType = { exist: 0, loc: 0, count: 0 }, scenes = {};
      for (i = 0; i < DATA.length; i++) {
        var d = DATA[i];
        if (d.neg) { negn++; perNeg[d.target]++; } else { pos++; per[d.target]++; }
        uq[d.q] = 1; ut[d.type + ':' + d.ti] = 1;
        byType[d.type]++; scenes[d.scene] = 1;
      }
      return { pos: pos, neg: negn, per: per, perNeg: perNeg,
               uq: Object.keys(uq).length, ut: Object.keys(ut).length,
               byType: byType, scenes: Object.keys(scenes).length };
    }

    function renderStats(st) {
      var n = DATA.length, i;
      if (!n) { el.stat.innerHTML = '샘플 <b>0</b>'; el.dist.innerHTML = ''; return; }
      var ratio = st.neg / n;
      var cl = st.neg === 0 ? 'warn' : (ratio > 0.62 ? 'warn' : 'good');
      el.stat.innerHTML =
        '샘플 <b>' + n + '</b><br>' +
        '장면 ' + st.scenes + '개 · 장면당 ' + (n / st.scenes).toFixed(1) + '문항<br>' +
        '긍정 : 부정 <span class="' + cl + '">' + st.pos + ' : ' + st.neg + '</span>' +
        ' <span style="color:var(--tx3)">(' + Math.round(ratio * 100) + '%)</span><br>' +
        '질문 문형 ' + st.ut + '종 · 고유 문장 ' + st.uq + '개<br>' +
        '존재 ' + st.byType.exist + ' · 위치 ' + st.byType.loc + ' · 개수 ' + st.byType.count;

      var html = '', mx = 1;
      for (i = 0; i < 5; i++) mx = Math.max(mx, st.per[i] + st.perNeg[i]);
      for (i = 0; i < 5; i++) {
        var tot = st.per[i] + st.perNeg[i];
        html += '<div><div class="lb"><span>' + CLS[i] + '</span><span>' + tot + '</span></div>' +
          '<div class="b">' +
          '<i style="width:' + (st.per[i] / mx * 100) + '%;background:var(--vis)"></i>' +
          '<i style="width:' + (st.perNeg[i] / mx * 100) + '%;background:var(--lang)"></i>' +
          '</div></div>';
      }
      el.dist.innerHTML = html;
    }

    /* --- 포맷 검사기 ------------------------------------------------------
       실제 검사기가 하는 일과 같습니다: 데이터를 한 줄씩 읽고 "선언한 규약"과
       대조합니다. 규약 밖의 의미 오류(엉뚱한 좌표)는 여기서 잡히지 않습니다.
       ---------------------------------------------------------------------- */
    var NUM = /-?\d+(?:\.\d+)?/g;

    function check(st) {
      var out = [], i, k, d;
      if (!DATA.length) {
        el.check.innerHTML = '<li class="bad"><span class="m">×</span><span>' +
          '생성된 샘플이 없습니다 — 질문 템플릿을 하나 이상 선택하십시오.</span></li>';
        return;
      }
      var missImg = 0, badRange = 0, badFmt = 0, worst = 0;
      for (i = 0; i < DATA.length; i++) {
        d = DATA[i];
        if (!d.hasImg) missImg++;
        if (d.type === 'loc' && !d.neg) {
          var m = d.a.match(NUM) || [];
          for (k = 0; k < m.length; k++) {
            var v = parseFloat(m[k]);
            if (v < FMT[fmtKey].min || v > FMT[fmtKey].max) {
              badRange++; worst = Math.max(worst, v); break;
            }
          }
        }
        if (d.type === 'exist' && !/^(예|아니오)$/.test(d.a)) badFmt++;
        if (d.type === 'count' && !/^\d+$/.test(d.a)) badFmt++;
      }

      out.push(missImg
        ? ['bad', '×', '<b>&lt;image&gt; 플레이스홀더 누락 ' + missImg + '건</b> — 시각 토큰이 들어갈 자리가 ' +
           '없습니다. 학습 스크립트에 따라 예외로 죽거나, 이미지를 무시한 채 텍스트만으로 학습됩니다.']
        : ['ok', '✓', '&lt;image&gt; 플레이스홀더 — 전 샘플 user 턴에 정확히 1회.']);

      out.push(badRange
        ? ['bad', '×', '<b>좌표 범위 이탈 ' + badRange + '건</b> — 선언은 ' + FMT[fmtKey].min + '~' +
           FMT[fmtKey].max + '인데 최대 ' + Math.round(worst) + '까지 나왔습니다. 원본 ' +
           SRCW + '×' + SRCH + ' 좌표를 리사이즈된 이미지에 그대로 붙인 것입니다.']
        : ['ok', '✓', '좌표 범위 — 전부 ' + FMT[fmtKey].min + '~' + FMT[fmtKey].max +
           ' 안 (' + FMT[fmtKey].label + ').']);

      out.push(badFmt
        ? ['warn', '!', '<b>답변 형식 불일치 ' + badFmt + '건</b> — system 프롬프트는 예/아니오와 숫자만 ' +
           '허용하는데 서술형이 섞였습니다. 파서보다 <b>모델이</b> 먼저 흔들립니다.']
        : ['ok', '✓', '답변 형식 — 존재는 예/아니오, 개수는 정수, 위치는 좌표 배열.']);

      var ratio = st.neg / DATA.length;
      if (st.neg === 0) {
        out.push(['warn', '!', '<b>부정 샘플 0%</b> — "아니오"라는 답을 한 번도 본 적 없는 모델이 됩니다. ' +
          '존재 질문이 사실상 객관식 1지선다가 됩니다.']);
      } else if (ratio > 0.62) {
        out.push(['warn', '!', '부정 비율 ' + Math.round(ratio * 100) +
          '% — 이번엔 반대로 기울었습니다. 무조건 "아니오"가 가장 안전한 답이 됩니다.']);
      } else {
        out.push(['ok', '✓', '부정 비율 ' + Math.round(ratio * 100) + '% — 균형 범위입니다.']);
      }

      out.push(st.ut <= 3
        ? ['warn', '!', '질문 문형 ' + st.ut + '종 — 표현이 고정되면 모델은 그 문장에만 반응합니다.']
        : ['ok', '✓', '질문 문형 ' + st.ut + '종 — 같은 뜻을 여러 문장으로 회전시켰습니다.']);

      var html = '';
      for (i = 0; i < out.length; i++) {
        html += '<li class="' + out[i][0] + '"><span class="m">' + out[i][1] + '</span><span>' +
                out[i][2] + '</span></li>';
      }
      el.check.innerHTML = html;
    }

    /* --- 갱신 ------------------------------------------------------------- */
    function refresh(rebuild) {
      if (rebuild) { build(); if (cur >= DATA.length) cur = 0; }
      el.ratio.disabled = !el.neg.checked;
      el.ratioV.textContent = el.ratio.value + '%';
      var st = stats();
      draw(); renderStats(st); check(st);
      var d = DATA[cur];
      el.idx.textContent = d ? '#' + ('00' + d.i).slice(-3) : '—';
      el.meta.textContent = d
        ? TYPE_KO[d.type] + ' · ' + (d.neg ? '부정' : '긍정') + ' · 대상 ' + CLS[d.target] +
          ' · 문형 ' + (d.ti + 1) + '번'
        : '';
      el.json.textContent = d ? JSON.stringify(toJSON(d), null, 2) : '{}';
    }

    ['exist', 'loc', 'count', 'neg', 'bugImg', 'bugCoord', 'bugFmt'].forEach(function (k) {
      el[k].addEventListener('change', function () { refresh(true); });
    });
    el.ratio.addEventListener('input', function () { refresh(true); });
    el.prev.addEventListener('click', function () {
      if (DATA.length) { cur = (cur - 1 + DATA.length) % DATA.length; refresh(false); }
    });
    el.next.addEventListener('click', function () {
      if (DATA.length) { cur = (cur + 1) % DATA.length; refresh(false); }
    });
    Array.prototype.forEach.call(fmtBtns, function (b) {
      b.addEventListener('click', function () {
        Array.prototype.forEach.call(fmtBtns, function (x) { x.classList.remove('sel'); });
        b.classList.add('sel');
        fmtKey = b.getAttribute('data-fmt');
        refresh(true);
      });
    });

    new MutationObserver(function () { refresh(false); }).observe(
      document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    refresh(true);
  })();


  /* ======================================================================
     LAB 7-2 — 누수 탐지 미니 (평균 해시 + 해밍 거리)
     같은 장면의 다른 프레임은 파일명이 달라도 같은 이미지입니다.
     ====================================================================== */
  (function () {
    var host = document.getElementById('lk_grid');
    if (!host) return;

    var el = {
      thr: document.getElementById('lk_thr'),
      thrV: document.getElementById('lk_thrV'),
      out: document.getElementById('lk_out')
    };
    var splitBtns = document.querySelectorAll('#lk_split button');
    var mode = 'random';
    var BASE = 8, TRAIN_N = 11;
    var HS = 16, NBIT = HS * HS;   /* 16×16 = 256비트 */

    /* --- 평균 해시(aHash): 축소 → 회색조 → 평균보다 밝은 칸이 1 ------------ */
    function ahash(sc) {
      var big = document.createElement('canvas');
      big.width = 128; big.height = 96;
      paintScene(big.getContext('2d'), 128, 96, sc);
      var sm = document.createElement('canvas');
      sm.width = HS; sm.height = HS;
      var c = sm.getContext('2d');
      c.drawImage(big, 0, 0, HS, HS);
      var px = c.getImageData(0, 0, HS, HS).data;
      var g = [], sum = 0, i;
      for (i = 0; i < NBIT; i++) {
        var v = 0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2];
        g.push(v); sum += v;
      }
      var avg = sum / NBIT, bits = [];
      for (i = 0; i < NBIT; i++) bits.push(g[i] > avg ? 1 : 0);
      return bits;
    }
    function hamming(a, b) {
      var d = 0;
      for (var i = 0; i < NBIT; i++) if (a[i] !== b[i]) d++;
      return d;
    }

    /* 후보를 넉넉히 만든 뒤 서로 가장 멀리 떨어진 8장면을 고릅니다.
       (데모가 "서로 다른 장면은 확실히 다르다"에서 출발해야 하므로) */
    var ITEMS = [];
    (function () {
      var cands = [], i, j;
      for (i = 0; i < 40; i++) {
        var sc = makeScene(90001 + i * 131);
        cands.push({ sc: sc, h: ahash(sc) });
      }
      var chosen = [0], used = { 0: 1 };
      while (chosen.length < BASE) {
        var best = -1, bestD = -1;
        for (i = 0; i < cands.length; i++) {
          if (used[i]) continue;
          var mn = NBIT;
          for (j = 0; j < chosen.length; j++) {
            mn = Math.min(mn, hamming(cands[i].h, cands[chosen[j]].h));
          }
          if (mn > bestD) { bestD = mn; best = i; }
        }
        used[best] = 1; chosen.push(best);
      }
      var r = rng(4321);
      for (i = 0; i < chosen.length; i++) {
        var base = cands[chosen[i]].sc;
        var vr = variantOf(base, r);
        ITEMS.push({ id: String.fromCharCode(65 + i) + '1', scene: i, sc: base, h: cands[chosen[i]].h });
        ITEMS.push({ id: String.fromCharCode(65 + i) + '2', scene: i, sc: vr, h: ahash(vr) });
      }
    })();

    /* --- 분할 ------------------------------------------------------------- */
    var PERM = (function () {
      var a = [], r = rng(555), i, j, t;
      for (i = 0; i < ITEMS.length; i++) a.push(i);
      for (i = a.length - 1; i > 0; i--) {
        j = Math.floor(r() * (i + 1)); t = a[i]; a[i] = a[j]; a[j] = t;
      }
      return a;
    })();

    function split() {
      var tr = [], va = [], i;
      if (mode === 'random') {        /* 파일 단위 무작위 — 가장 흔한 기본값 */
        for (i = 0; i < PERM.length; i++) (i < TRAIN_N ? tr : va).push(ITEMS[PERM[i]]);
      } else {                        /* 장면 단위 — 같은 장면은 통째로 한쪽에 */
        for (i = 0; i < ITEMS.length; i++) (ITEMS[i].scene < BASE - 2 ? tr : va).push(ITEMS[i]);
      }
      return { tr: tr, va: va };
    }

    /* --- 썸네일 ----------------------------------------------------------- */
    function thumb(item, leak, dist) {
      var box = document.createElement('div');
      box.className = 'thumb' + (leak ? ' leak' : '');
      var w = 78, h = 58, dpr = Math.min(window.devicePixelRatio || 1, 2);
      var c = document.createElement('canvas');
      c.width = w * dpr; c.height = h * dpr;
      c.style.width = w + 'px'; c.style.height = h + 'px';
      var ctx = c.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      paintScene(ctx, w, h, item.sc);
      box.appendChild(c);
      var cap = document.createElement('span');
      cap.className = 'cap';
      cap.textContent = item.id + (dist == null ? '' : ' · d=' + dist);
      box.appendChild(cap);
      return box;
    }

    function row(tag, items, dists, thr) {
      var el2 = document.createElement('div');
      el2.className = 'thumbrow';
      var t = document.createElement('span');
      t.className = 'tag'; t.textContent = tag;
      el2.appendChild(t);
      for (var i = 0; i < items.length; i++) {
        el2.appendChild(thumb(items[i], dists ? dists[i] <= thr : false, dists ? dists[i] : null));
      }
      return el2;
    }

    function render() {
      var thr = parseInt(el.thr.value, 10);
      el.thrV.textContent = thr;
      var sp = split(), i, j;

      var minD = [], pair = [];
      for (i = 0; i < sp.va.length; i++) {
        var best = NBIT, bj = -1;
        for (j = 0; j < sp.tr.length; j++) {
          var d = hamming(sp.va[i].h, sp.tr[j].h);
          if (d < best) { best = d; bj = j; }
        }
        minD.push(best); pair.push(bj);
      }

      host.innerHTML = '';
      host.appendChild(row('TRAIN', sp.tr, null, thr));
      host.appendChild(row('VAL', sp.va, minD, thr));

      var leaks = [];
      for (i = 0; i < minD.length; i++) {
        if (minD[i] <= thr) leaks.push(sp.va[i].id + '↔' + sp.tr[pair[i]].id + '(d=' + minD[i] + ')');
      }
      el.out.innerHTML = leaks.length
        ? '<b style="color:var(--bad)">누수 ' + leaks.length + '건</b> — val ' + sp.va.length +
          '장 중 ' + leaks.length + '장이 train의 어떤 이미지와 해밍 거리 ' + thr + ' 이하입니다: ' +
          leaks.slice(0, 4).join(' · ') + (leaks.length > 4 ? ' …' : '') +
          '<br>이 val로 잰 점수는 일반화 성능이 아니라 <b>암기 성능</b>입니다. ' +
          '여러 번 다시 재도 같은 거짓 점수가 나옵니다.'
        : '<b style="color:var(--ok)">누수 0건</b> — val ' + sp.va.length +
          '장 모두 train의 어떤 이미지와도 해밍 거리 ' + thr + ' 초과입니다. ' +
          '이제 val 점수를 믿을 수 있습니다.';
    }

    el.thr.addEventListener('input', render);
    Array.prototype.forEach.call(splitBtns, function (b) {
      b.addEventListener('click', function () {
        Array.prototype.forEach.call(splitBtns, function (x) { x.classList.remove('sel'); });
        b.classList.add('sel');
        mode = b.getAttribute('data-split');
        render();
      });
    });
    new MutationObserver(render).observe(document.documentElement,
      { attributes: true, attributeFilter: ['data-theme'] });

    render();
  })();

})();
