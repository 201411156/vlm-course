/* ==========================================================================
   8장 — 판정기로 쓰는 VLM
   LAB 8-1 판정 파이프라인 시뮬레이터 · LAB 8-2 프롬프트 빌더
   전부 브라우저 안에서 도는 장난감입니다. 실제 모델도, 네트워크 호출도 없습니다.
   ========================================================================== */

/* ==========================================================================
   LAB 8-1 — 2단 캐스케이드 시뮬레이터
   합성 프레임 스트림 → 1차 검출기(임계값) → 2차 판정기(정확도·패딩·지연)
     · 후보마다 (진짜/오탐, 검출점수, 난이도, 판정용 난수 u)를 고정으로 뽑아 둔다.
       슬라이더를 움직여도 u는 그대로이므로 결과가 튀지 않고 단조롭게 변합니다.
     · 판정 정확도는 "난이도"와 "크롭 패딩"에 의해 실효값으로 깎인다.
   ========================================================================== */
(function () {
  'use strict';

  var cv = document.getElementById('pipe');
  if (!cv) return;
  var wrap = document.getElementById('pipewrap');
  var cx = cv.getContext('2d');

  var FRAMES = 6, COLS = 3, ROWS = 2, GAP = 6;
  var DET_MS = 6;            /* 1차 검출기 고정 비용(프레임당) */

  /* --- 결정적 난수 (mulberry32) --------------------------------------- */
  function rng(seed) {
    return function () {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  /* --- 장면 생성 --------------------------------------------------------- */
  function mk(r, isTrue, score, hard) {
    var w = 0.13 + 0.15 * r(), h = 0.14 + 0.17 * r();
    return {
      t: isTrue, s: score, hard: Math.min(1, Math.max(0, hard)), u: r(),
      x: 0.05 + r() * (0.95 - w - 0.05),
      y: 0.08 + r() * (0.90 - h - 0.08),
      w: w, h: h
    };
  }
  function build(seed) {
    var r = rng(seed), frames = [], f, i;
    for (f = 0; f < FRAMES; f++) {
      var c = [];
      var nT = 2 + Math.floor(r() * 2);    /* 진짜 물체 2~3 */
      var nC = 1 + Math.floor(r() * 4);    /* 배경 잡음 1~4 */
      /* 진짜: 점수가 높을수록 크고 선명 = 판정하기 쉬움 */
      for (i = 0; i < nT; i++) {
        var s = 0.45 + 0.50 * r();
        c.push(mk(r, true, s, 0.15 + 0.70 * (1 - (s - 0.45) / 0.50)));
      }
      /* 오탐: 점수가 높은 것일수록 진짜처럼 생겼다 = 판정하기 어려움 */
      for (i = 0; i < nC; i++) {
        var s2 = 0.15 + 0.55 * r();
        c.push(mk(r, false, s2, 0.15 + 0.70 * ((s2 - 0.15) / 0.55)));
      }
      frames.push(c);
    }
    return frames;
  }

  var seed = 20260831;
  var DATA = build(seed);

  /* --- 판정기 모델 ------------------------------------------------------- */
  /* 크롭 패딩: 0%는 맥락이 잘려 나가고, 너무 넓으면 대상이 묻힌다 → 20% 부근이 최적 */
  function padF(p) {
    var d = p - 0.20;
    return 0.55 + 0.45 * Math.exp(-(d * d) / (2 * 0.15 * 0.15));
  }
  function pCorrect(cand, acc, pad) {
    var v = 0.5 + (acc - 0.5) * padF(pad) * (1 - 0.35 * cand.hard);
    return Math.min(0.995, Math.max(0.5, v));
  }

  /* --- UI 참조 ----------------------------------------------------------- */
  var el = {
    thr: document.getElementById('p_thr'), thrV: document.getElementById('p_thrV'),
    acc: document.getElementById('p_acc'), accV: document.getElementById('p_accV'),
    pad: document.getElementById('p_pad'), padV: document.getElementById('p_padV'),
    lat: document.getElementById('p_lat'), latV: document.getElementById('p_latV'),
    batch: document.getElementById('p_batch'),
    reseed: document.getElementById('p_reseed'),
    cand: document.getElementById('p_cand'),
    eff: document.getElementById('p_eff'),
    dp: document.getElementById('p_dp'), dr: document.getElementById('p_dr'),
    jp: document.getElementById('p_jp'), jr: document.getElementById('p_jr'),
    rej: document.getElementById('p_rej'), keep: document.getElementById('p_keep'),
    ms: document.getElementById('p_ms'),
    bars: document.getElementById('p_bars'),
    verdict: document.getElementById('p_verdict')
  };

  function pct(x) { return isFinite(x) ? (x * 100).toFixed(1) + '%' : '—'; }

  /* --- 계산 ------------------------------------------------------------- */
  var M = null;
  function compute() {
    var thr = parseFloat(el.thr.value);
    var acc = parseFloat(el.acc.value);
    var pad = parseFloat(el.pad.value) / 100;
    var J = parseFloat(el.lat.value);
    var batch = !!(el.batch && el.batch.checked);

    var gt = 0, det = 0, tpD = 0, fpD = 0, tpJ = 0, fpJ = 0;
    var effSum = 0, effN = 0, msSum = 0;

    for (var f = 0; f < FRAMES; f++) {
      var k = 0;
      for (var i = 0; i < DATA[f].length; i++) {
        var c = DATA[f][i];
        if (c.t) gt++;
        c.det = c.s >= thr;
        c.pred = null;
        if (!c.det) continue;
        k++; det++;
        if (c.t) tpD++; else fpD++;
        var p = pCorrect(c, acc, pad);
        effSum += p; effN++;
        var right = c.u < p;
        c.pred = right ? c.t : !c.t;
        if (c.pred) { if (c.t) tpJ++; else fpJ++; }
      }
      msSum += DET_MS + (k === 0 ? 0 : (batch ? J * (1 + 0.30 * (k - 1)) : J * k));
    }

    M = {
      thr: thr, acc: acc, pad: pad, J: J, batch: batch,
      gt: gt, det: det, tpD: tpD, fpD: fpD, tpJ: tpJ, fpJ: fpJ,
      pD: det ? tpD / det : NaN, rD: gt ? tpD / gt : NaN,
      pJ: (tpJ + fpJ) ? tpJ / (tpJ + fpJ) : NaN, rJ: gt ? tpJ / gt : NaN,
      rejFP: fpD ? (fpD - fpJ) / fpD : NaN,      /* 오탐 기각률 */
      keepTP: tpD ? tpJ / tpD : NaN,             /* 정탐 보존율 */
      eff: effN ? effSum / effN : NaN,
      ms: msSum / FRAMES
    };
  }

  /* --- 그리기 ------------------------------------------------------------ */
  function css(n) {
    return getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  }
  function draw() {
    var w = Math.max(240, (wrap && wrap.clientWidth) || 320);
    var H = Math.round(w * 0.60);
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = Math.round(w * dpr); cv.height = Math.round(H * dpr);
    cv.style.width = '100%'; cv.style.height = H + 'px';
    cx.setTransform(dpr, 0, 0, dpr, 0, 0);

    var panel = css('--panel'), panel2 = css('--panel2'), line = css('--line');
    var ok = css('--ok'), bad = css('--bad'), lang = css('--lang'), tx3 = css('--tx3');

    cx.clearRect(0, 0, w, H);
    cx.fillStyle = panel; cx.fillRect(0, 0, w, H);

    var cw = (w - GAP * (COLS - 1)) / COLS;
    var ch = (H - GAP * (ROWS - 1)) / ROWS;
    var pd = M.pad;

    for (var f = 0; f < FRAMES; f++) {
      var ox = (f % COLS) * (cw + GAP);
      var oy = Math.floor(f / COLS) * (ch + GAP);

      cx.fillStyle = panel2; cx.fillRect(ox, oy, cw, ch);
      cx.strokeStyle = line; cx.lineWidth = 1;
      cx.strokeRect(ox + 0.5, oy + 0.5, cw - 1, ch - 1);
      cx.globalAlpha = 0.5;
      cx.beginPath();
      cx.moveTo(ox + 1, oy + ch * 0.56); cx.lineTo(ox + cw - 1, oy + ch * 0.56);
      cx.stroke();
      cx.globalAlpha = 1;

      for (var i = 0; i < DATA[f].length; i++) {
        var c = DATA[f][i];
        var bx = ox + c.x * cw, by = oy + c.y * ch;
        var bw = c.w * cw, bh = c.h * ch;

        /* 물체 자체는 전부 같은 회색 얼룩 — 눈으로는 진짜/가짜를 알 수 없습니다 */
        cx.globalAlpha = 0.34; cx.fillStyle = tx3;
        cx.fillRect(bx, by, bw, bh);
        cx.globalAlpha = 1;

        if (!c.det) {                                  /* 검출기가 못 본 것 */
          if (c.t) {
            cx.strokeStyle = tx3; cx.setLineDash([1, 3]); cx.lineWidth = 1;
            cx.globalAlpha = 0.7;
            cx.strokeRect(bx, by, bw, bh);
            cx.globalAlpha = 1; cx.setLineDash([]);
          }
          continue;
        }
        /* 판정기에 들어간 크롭 = 박스 + 패딩 */
        var px = bx - bw * pd, py = by - bh * pd;
        var pw = bw * (1 + 2 * pd), ph = bh * (1 + 2 * pd);
        cx.strokeStyle = tx3; cx.globalAlpha = 0.28; cx.lineWidth = 1;
        cx.setLineDash([2, 2]); cx.strokeRect(px, py, pw, ph);
        cx.setLineDash([]); cx.globalAlpha = 1;

        if (c.pred) { cx.strokeStyle = c.t ? ok : bad; cx.setLineDash([]); }
        else { cx.strokeStyle = c.t ? lang : tx3; cx.setLineDash([3, 2]); }
        cx.lineWidth = c.pred ? 2 : 1.4;
        cx.strokeRect(bx, by, bw, bh);
        cx.setLineDash([]);
      }
    }
  }

  function bar(label, v, cls) {
    var p = isFinite(v) ? Math.round(v * 100) : 0;
    return '<div style="margin:6px 0">' +
      '<div style="display:flex;justify-content:space-between;font-size:12px;' +
      'font-family:\'IBM Plex Mono\',monospace;color:var(--tx2)">' +
      '<span>' + label + '</span><span>' + (isFinite(v) ? p + '%' : '—') + '</span></div>' +
      '<div style="height:8px;border-radius:4px;background:var(--panel2);margin-top:4px;' +
      'overflow:hidden"><i style="display:block;height:100%;width:' + Math.max(1, p) +
      '%;background:var(--' + cls + ')"></i></div></div>';
  }

  function verdict() {
    if (!isFinite(M.pJ)) {
      return '판정기가 후보를 전부 기각했습니다 — 경보가 하나도 나가지 않습니다.';
    }
    if (M.acc < 0.70) {
      return '판정기가 이 정확도면 오탐을 거르는 만큼 정탐도 함께 버립니다 — 없느니만 못한 구간입니다.';
    }
    if (M.pad < 0.06) {
      return '패딩이 0에 가깝습니다 — 크롭이 박스에 딱 붙어 주변 맥락이 잘려 나갔습니다.';
    }
    if (M.pad > 0.45) {
      return '패딩이 너무 넓습니다 — 크롭 안에서 정작 판정할 대상이 작아졌습니다.';
    }
    if (M.thr <= 0.35 && M.acc >= 0.85 && M.pJ > M.pD + 0.2) {
      return '낮은 임계값으로 재현율을 벌고 판정기로 정밀도를 되사는 조합 — 캐스케이드의 표준 레시피입니다.';
    }
    if (M.thr >= 0.7) {
      return '임계값이 높아 후보가 이미 깨끗합니다 — 판정기가 벌어들이는 것이 별로 없습니다.';
    }
    return '오탐은 기각되고 정탐은 살아남는지, 두 축을 따로 보세요.';
  }

  function refresh() {
    compute();
    draw();
    el.thrV.textContent = M.thr.toFixed(2);
    el.accV.textContent = Math.round(M.acc * 100) + '%';
    el.padV.textContent = Math.round(M.pad * 100) + '%';
    el.latV.textContent = M.J + 'ms';
    el.cand.textContent = (M.det / FRAMES).toFixed(1);
    el.eff.textContent = pct(M.eff);
    el.dp.textContent = pct(M.pD); el.dr.textContent = pct(M.rD);
    el.jp.textContent = pct(M.pJ); el.jr.textContent = pct(M.rJ);
    el.rej.textContent = pct(M.rejFP); el.keep.textContent = pct(M.keepTP);
    el.ms.textContent = M.ms.toFixed(1) + 'ms';
    el.ms.className = M.ms > 33 ? 'warn' : 'good';
    el.jp.className = isFinite(M.pJ) && M.pJ >= M.pD ? 'good' : 'warn';
    el.jr.className = isFinite(M.rJ) && M.rJ >= M.rD * 0.9 ? '' : 'warn';
    el.bars.innerHTML =
      bar('정밀도 · 검출기 단독', M.pD, 'tx3') +
      bar('정밀도 · 판정기 통과', M.pJ, 'vis') +
      bar('재현율 · 판정기 통과', M.rJ, 'lang');
    var vd = verdict();
    if (M.ms > 33) {
      vd += ' 그리고 프레임당 지연이 30fps 예산(33ms)을 넘었습니다 — ' +
            '후보 수를 줄이거나(임계값 ↑ · 트랙당 1회) 배치로 묶어야 합니다.';
    }
    el.verdict.textContent = vd;
  }

  ['thr', 'acc', 'pad', 'lat'].forEach(function (k) {
    el[k].addEventListener('input', refresh);
  });
  if (el.batch) el.batch.addEventListener('change', refresh);
  if (el.reseed) el.reseed.addEventListener('click', function () {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    DATA = build(seed);
    refresh();
  });

  var rt = null;
  window.addEventListener('resize', function () {
    clearTimeout(rt); rt = setTimeout(refresh, 120);
  });
  new MutationObserver(refresh).observe(document.documentElement,
    { attributes: true, attributeFilter: ['data-theme'] });

  refresh();
})();


/* ==========================================================================
   LAB 8-2 — 프롬프트 빌더 + 파서 생성기
   프롬프트를 어떻게 조이느냐에 따라 파싱 규칙이 어떻게 달라지고,
   같은 원시 출력 5종이 어떻게 다르게 읽히는지를 나란히 보여줍니다.
   ========================================================================== */
(function () {
  'use strict';

  var promptEl = document.getElementById('pb_prompt');
  if (!promptEl) return;

  var ruleEl = document.getElementById('pb_rule');
  var tblEl = document.getElementById('pb_tbl');
  var noteEl = document.getElementById('pb_note');
  var okEl = document.getElementById('pb_ok');
  var misEl = document.getElementById('pb_mis');
  var tokEl = document.getElementById('pb_tok');
  var closedEl = document.getElementById('pb_closed');
  var negEl = document.getElementById('pb_neg');
  var lenEl = document.getElementById('pb_lenient');
  var fmtBtns = document.querySelectorAll('#pb_fmt button');

  var BASE = ['차량', '이륜차', '보행자'];
  var NEG = '해당 없음';
  var LETTERS = ['A', 'B', 'C', 'D'];
  var fmt = 'letter';

  function syncFmt() {
    Array.prototype.forEach.call(fmtBtns, function (b) {
      if (b.getAttribute('data-f') === fmt) b.classList.add('sel');
      else b.classList.remove('sel');
    });
  }

  /* 실전에서 실제로 관찰되는 출력 변종 5종 — 설정과 무관하게 고정입니다 */
  var SAMPLES = [
    { raw: 'A', truth: '차량' },
    { raw: '이륜차', truth: '이륜차' },
    { raw: '정답: B) 이륜차', truth: '이륜차' },
    { raw: '보행자는 보이지 않고, 오토바이 한 대가 있습니다.', truth: '이륜차' },
    { raw: '해당 없음', truth: '해당 없음' }
  ];

  function esc(s) {
    return s.replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function build() {
    var closed = closedEl.checked, neg = negEl.checked, lenient = lenEl.checked;
    /* 선택지를 열어 두면 "보기의 기호"라는 형식 자체가 성립하지 않습니다 */
    if (!closed && fmt === 'letter') { fmt = 'word'; syncFmt(); }
    Array.prototype.forEach.call(fmtBtns, function (b) {
      if (b.getAttribute('data-f') === 'letter') b.disabled = !closed;
    });
    var cls = BASE.slice();
    if (neg) cls.push(NEG);
    var nL = cls.length;
    var lastL = LETTERS[nL - 1];

    /* --- 프롬프트 --------------------------------------------------- */
    var p = [];
    p.push('<image>  ← 1차 검출기가 제안한 후보 크롭 1장');
    p.push('');
    if (closed) {
      p.push('이 크롭 안의 물체는 아래 중 무엇입니까?');
      p.push('');
      for (var i = 0; i < nL; i++) p.push(LETTERS[i] + ') ' + cls[i]);
      p.push('');
    } else {
      p.push('이 크롭 안에는 무엇이 있습니까?');
      p.push('');
    }
    if (fmt === 'letter') {
      p.push('보기의 기호 한 글자(A~' + lastL + ')만 출력하십시오.');
      p.push('설명, 문장, 여는 말을 덧붙이지 마십시오.');
    } else if (fmt === 'word') {
      p.push(closed ? '보기의 단어 하나만 그대로 출력하십시오.'
                    : '한 단어로만 답하십시오.');
      p.push('문장으로 답하지 마십시오.');
    } else {
      p.push('보이는 것을 한두 문장으로 설명하십시오.');
    }
    promptEl.textContent = p.join('\n');

    /* --- 파싱 규칙 --------------------------------------------------- */
    var wordPat = cls.map(function (c) {
      return c === NEG ? '해당\\s*없음' : c;
    }).join('|');
    var letterPat = '[A-' + lastL + ']';

    var reStrictL = new RegExp('^\\s*(' + letterPat + ')[)\\.\\s]*$');
    var reFbL = new RegExp('(?:^|[^A-Za-z])(' + letterPat + ')[)\\.:]');
    var reBareL = new RegExp('^\\s*(' + letterPat + ')\\s*$');
    var reStrictW = new RegExp('^\\s*(' + wordPat + ')\\s*[.]?\\s*$');
    var reSearchW = new RegExp('(' + wordPat + ')');

    var rules = [];
    if (fmt === 'letter') {
      rules.push('1차(엄격)  /^\\s*(' + letterPat + ')[)\\.\\s]*$/');
      if (lenient) {
        rules.push('2차(폴백)  /(?:^|[^A-Za-z])(' + letterPat + ')[)\\.:]/');
        rules.push('3차(폴백)  /(' + wordPat + ')/');
      }
    } else if (fmt === 'word') {
      rules.push('1차(엄격)  /^\\s*(' + wordPat + ')\\s*[.]?$/');
      if (lenient) rules.push('2차(폴백)  /(' + wordPat + ')/   ← 첫 매치');
    } else {
      rules.push('1차(검색)  /(' + wordPat + ')/   ← 첫 매치');
      if (closed) rules.push('2차(검색)  /^\\s*(' + letterPat + ')\\s*$/');
    }
    rules.push('');
    rules.push('허용 값 = [' + cls.join(', ') + ']');
    rules.push('매치 실패 → null (재질의 또는 보류)');
    ruleEl.textContent = rules.join('\n');

    /* --- 파서 -------------------------------------------------------- */
    function byLetter(ch) {
      var k = LETTERS.indexOf(ch);
      return (k >= 0 && k < nL) ? cls[k] : null;
    }
    function norm(w) { return w.replace(/\s+/g, ' ') === '해당 없음' ? NEG : w; }

    function parse(raw) {
      var m, v = null, how = '';
      if (fmt === 'letter') {
        m = raw.match(reStrictL);
        if (m) { v = byLetter(m[1]); how = '엄격'; }
        if (!v && lenient) {
          m = raw.match(reFbL);
          if (m) { v = byLetter(m[1]); how = '폴백'; }
          if (!v) { m = raw.match(reSearchW); if (m) { v = norm(m[1]); how = '폴백'; } }
        }
      } else if (fmt === 'word') {
        m = raw.match(reStrictW);
        if (m) { v = norm(m[1]); how = '엄격'; }
        if (!v && lenient) {
          m = raw.match(reSearchW);
          if (m) { v = norm(m[1]); how = '폴백'; }
        }
      } else {
        m = raw.match(reSearchW);
        if (m) { v = norm(m[1]); how = '검색'; }
        if (!v && closed) {
          m = raw.match(reBareL);
          if (m) { v = byLetter(m[1]); how = '검색'; }
        }
      }
      return { v: v, how: how };
    }

    /* --- 샘플 표 ------------------------------------------------------ */
    var nOK = 0, nMis = 0, rows = '';
    SAMPLES.forEach(function (s, i) {
      var r = parse(s.raw);
      var st, cls2;
      if (r.v === null) { st = '파싱 실패'; cls2 = 'st-fail'; }
      else if (r.v === s.truth) { st = r.v + ' ✓'; cls2 = 'st-ok'; nOK++; }
      else { st = r.v + ' ⚠ 조용한 오답'; cls2 = 'st-mis'; nOK++; nMis++; }
      rows += '<tr><td class="num">#' + (i + 1) + '</td>' +
        '<td class="raw">' + esc(s.raw) + '</td>' +
        '<td class="' + cls2 + '">' + esc(st) +
        (r.how ? ' <span class="how">' + r.how + '</span>' : '') + '</td>' +
        '<td class="tru">' + esc(s.truth) + '</td></tr>';
    });
    tblEl.innerHTML =
      '<div class="tablebox"><table><thead><tr>' +
      '<th>#</th><th>모델의 원시 출력</th><th>파서가 읽은 값</th><th>사람이 본 정답</th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table></div>';

    okEl.textContent = String(nOK);
    misEl.textContent = String(nMis);
    misEl.className = nMis ? 'warn' : 'good';
    var tok = fmt === 'letter' ? 1 : (fmt === 'word' ? 3 : 35);
    tokEl.textContent = '~' + tok;

    /* --- 한 줄 해설 --------------------------------------------------- */
    var note = '';
    if (!closed) {
      note = '선택지를 열어두면 모델이 "오토바이" 같은 동의어를 씁니다(#4). ' +
             '허용 값이 프롬프트에 없으니 파서는 동의어 사전을 따로 들고 있어야 하고, ' +
             '그 사전이 조용한 오답이 자라는 자리입니다. ' +
             '기호 한 글자 형식도 쓸 수 없습니다 — 가리킬 보기가 없으니까요.';
    } else if (nMis > 0) {
      note = '#4를 보세요. 파서는 문장 앞쪽의 "보행자"를 집었고, 값이 나왔으므로 ' +
             '파이프라인은 이것을 성공으로 셉니다 — 실패보다 나쁜 종류의 오류입니다.';
    } else if (!neg) {
      note = '#5가 파싱에 실패했습니다. 부정 옵션을 빼면 모델은 남은 셋 중 하나를 ' +
             '억지로 고르고, 그 오답은 형식을 지켰으므로 파싱에 성공해 조용히 통과합니다.';
    } else if (fmt === 'letter' && !lenient) {
      note = '엄격한 한 글자 파서는 #1만 통과시킵니다. 나머지는 전부 재질의 대상 — ' +
             '깨끗하지만 그만큼 재질의 비용을 냅니다.';
    } else if (fmt === 'free') {
      note = '자유 문장은 파싱률이 높아 보이지만, 그 높은 숫자 안에 조용한 오답이 섞입니다. ' +
             '출력 토큰도 30배 이상이라 지연이 그만큼 늘어납니다.';
    } else {
      note = '형식을 조일수록 파서는 단순해지고, 실패는 늘지만 그 실패는 눈에 보입니다. ' +
             '눈에 보이는 실패가 조용한 오답보다 낫습니다.';
    }
    noteEl.textContent = note;

    if (lenEl) lenEl.disabled = (fmt === 'free');
  }

  Array.prototype.forEach.call(fmtBtns, function (b) {
    b.addEventListener('click', function () {
      if (b.disabled) return;
      Array.prototype.forEach.call(fmtBtns, function (x) { x.classList.remove('sel'); });
      b.classList.add('sel');
      fmt = b.getAttribute('data-f');
      build();
    });
  });
  [closedEl, negEl, lenEl].forEach(function (c) {
    if (c) c.addEventListener('change', build);
  });

  build();
})();
