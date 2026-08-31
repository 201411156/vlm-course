/* ==========================================================================
   LAB 4-2 — 참조 표현 → 대상 선택
   "왼쪽에서 두 번째 파란 사각형" 같은 표현을 규칙 몇 개로 풀어 본다.
   언어를 좌표로 바꾸는 일이 실제로 어떤 단계를 거치는지, 그리고 그 규칙이
   어디서 깨지는지를 보여주는 것이 목적입니다. 학습된 모델이 아니라 정규식입니다.
   ========================================================================== */
(function () {
  'use strict';

  var cvEl = document.getElementById('g2_cv');
  if (!cvEl) return;

  var IW = 400, IH = 230;

  var OBJ = [
    { id: 1, color: '파랑', kind: '사각형', box: [26, 52, 86, 112] },
    { id: 2, color: '파랑', kind: '사각형', box: [120, 86, 164, 130] },
    { id: 3, color: '파랑', kind: '사각형', box: [246, 40, 282, 76] },
    { id: 4, color: '빨강', kind: '원',     box: [174, 154, 226, 206] },
    { id: 5, color: '빨강', kind: '원',     box: [78, 158, 114, 194] },
    { id: 6, color: '초록', kind: '삼각형', box: [300, 120, 368, 190] },
    { id: 7, color: '노랑', kind: '원',     box: [326, 46, 354, 74] }
  ];
  var NAME = { 파랑: '파란', 빨강: '빨간', 초록: '초록', 노랑: '노란' };

  function cx(o) { return (o.box[0] + o.box[2]) / 2; }
  function cy(o) { return (o.box[1] + o.box[3]) / 2; }
  function area(o) { return (o.box[2] - o.box[0]) * (o.box[3] - o.box[1]); }
  function name(o) { return NAME[o.color] + ' ' + o.kind + ' #' + o.id; }

  /* --- 어휘 ---------------------------------------------------------------
     긴 표기를 먼저 두어야 '동그라미'가 '원'보다 먼저 걸린다. */
  var COLORS = [['파란색', '파랑'], ['파란', '파랑'], ['파랑', '파랑'], ['블루', '파랑'],
                ['빨간색', '빨강'], ['빨간', '빨강'], ['빨강', '빨강'],
                ['초록색', '초록'], ['초록', '초록'], ['녹색', '초록'],
                ['노란색', '노랑'], ['노란', '노랑'], ['노랑', '노랑']];
  var KINDS  = [['사각형', '사각형'], ['네모', '사각형'], ['상자', '사각형'],
                ['동그라미', '원'], ['원', '원'], ['삼각형', '삼각형'],
                ['도형', '*'], ['물체', '*'], ['것', '*']];
  var ORD = { '첫': 1, '한': 1, '하나': 1, '두': 2, '둘': 2, '세': 3, '셋': 3,
              '네': 4, '넷': 4, '다섯': 5 };

  function lookup(tbl, q) {
    for (var i = 0; i < tbl.length; i++) if (q.indexOf(tbl[i][0]) >= 0) return tbl[i][1];
    return null;
  }

  /* --- 필터 · 정렬 --------------------------------------------------------- */
  function filt(q) {
    var color = lookup(COLORS, q), kind = lookup(KINDS, q);
    if (!color && !kind) return null;                    /* 어휘를 하나도 못 찾음 */
    var out = [];
    for (var i = 0; i < OBJ.length; i++) {
      var o = OBJ[i];
      if (color && o.color !== color) continue;
      if (kind && kind !== '*' && o.kind !== kind) continue;
      out.push(o);
    }
    return { color: color, kind: kind, list: out };
  }

  function axisSort(list, axis) {
    var c = list.slice();
    c.sort(function (a, b) {
      if (axis === '왼쪽') return cx(a) - cx(b);
      if (axis === '오른쪽') return cx(b) - cx(a);
      if (axis === '위' || axis === '위쪽') return cy(a) - cy(b);
      if (axis === '아래' || axis === '아래쪽') return cy(b) - cy(a);
      if (axis === '큰') return area(b) - area(a);
      return area(a) - area(b);                          /* 작은 */
    });
    return c;
  }

  /* --- 표현 하나를 푼다 ----------------------------------------------------- */
  function resolve(q, steps, depth) {
    q = String(q || '').trim();
    if (!q) return { err: '표현이 비어 있습니다.' };

    /* ① 관계 표현: "<기준> 오른쪽에 있는 <대상>" */
    var rel = q.match(/^(.*?)(?:의)?\s*(왼쪽|오른쪽|위쪽|아래쪽|위|아래|옆)에\s*있는\s*(.+)$/);
    if (rel && depth < 1) {
      steps.push('관계 분해 — 기준 「' + rel[1].trim() + '」 · 방향 「' + rel[2] +
                 '」 · 대상 「' + rel[3].trim() + '」');
      var anchor = resolve(rel[1], steps, depth + 1);
      if (anchor.err) return { err: '기준을 못 찾았습니다 — ' + anchor.err };
      if (!anchor.pick) return { err: '기준이 하나로 좁혀지지 않습니다.' };
      var tgt = filt(rel[3]);
      if (!tgt) return { err: '대상 어휘를 모릅니다: 「' + rel[3].trim() + '」' };
      var a = anchor.pick, dir = rel[2], keep = [];
      for (var i = 0; i < tgt.list.length; i++) {
        var o = tgt.list[i];
        if (o === a) continue;
        var pass = dir === '옆' ? true
          : dir === '왼쪽' ? cx(o) < cx(a)
          : dir === '오른쪽' ? cx(o) > cx(a)
          : (dir === '위' || dir === '위쪽') ? cy(o) < cy(a)
          : cy(o) > cy(a);
        if (pass) keep.push(o);
      }
      steps.push('관계 필터 — 「' + name(a) + '」의 ' + dir + ': 후보 ' +
                 tgt.list.length + '개 → ' + keep.length + '개');
      if (!keep.length) return { err: '관계를 만족하는 대상이 없습니다.', cands: tgt.list };
      var nar = narrow(keep, rel[3], steps);
      if (nar.pick) return nar;
      if (nar.list.length > 1) {
        var best = nar.list[0], bd = 1e9;
        for (var k = 0; k < nar.list.length; k++) {
          var d = Math.hypot(cx(nar.list[k]) - cx(a), cy(nar.list[k]) - cy(a));
          if (d < bd) { bd = d; best = nar.list[k]; }
        }
        steps.push('동점 처리 — 조건을 만족하는 후보가 ' + nar.list.length +
                   '개라 기준에 가장 가까운 것을 골랐습니다(파서가 임의로 정한 규칙).');
        return { pick: best, cands: nar.list, tie: true };
      }
      return { pick: nar.list[0], cands: nar.list };
    }

    /* ② 색·종류 필터 */
    var f = filt(q);
    if (!f) return { err: '색도 종류도 못 알아들었습니다: 「' + q + '」' };
    steps.push('어휘 해석 — 색 ' + (f.color || '지정 없음') +
               ' · 종류 ' + (f.kind === '*' ? '아무거나' : (f.kind || '지정 없음')));
    steps.push('후보 필터 — 전체 ' + OBJ.length + '개 → ' + f.list.length + '개');
    if (!f.list.length) return { err: '조건에 맞는 도형이 없습니다.' };

    /* ③ 순서·최상급으로 좁히기 */
    var nar2 = narrow(f.list, q, steps);
    if (nar2.err) return { err: nar2.err, cands: f.list };
    if (nar2.pick) return nar2;
    if (nar2.list.length > 1) {
      return { err: '표현이 모호합니다 — 후보 ' + nar2.list.length +
                    '개를 구분할 단서가 없습니다.', cands: nar2.list };
    }
    return { pick: nar2.list[0], cands: f.list };
  }

  function narrow(list, q, steps) {
    var m = q.match(/(왼쪽|오른쪽|위|아래)(?:에서|부터)\s*(첫|한|하나|두|둘|세|셋|네|넷|다섯|[1-9])\s*번째/);
    if (m) {
      var n = ORD[m[2]] || parseInt(m[2], 10);
      var horiz = (m[1] === '왼쪽' || m[1] === '오른쪽');
      var sorted = axisSort(list, m[1]);
      var order = [];
      for (var i = 0; i < sorted.length; i++) {
        order.push(Math.round(horiz ? cx(sorted[i]) : cy(sorted[i])));
      }
      steps.push('정렬 — ' + m[1] + ' 기준으로 줄 세우기 (중심 ' + (horiz ? 'x' : 'y') +
                 ' ' + order.join(' → ') + ')');
      if (n > sorted.length) return { err: m[1] + '에서 ' + n + '번째가 없습니다(후보 ' + sorted.length + '개).' };
      steps.push('선택 — ' + n + '번째 → ' + name(sorted[n - 1]));
      return { pick: sorted[n - 1], cands: list };
    }
    var s = q.match(/(?:가장|제일)\s*(큰|작은|왼쪽|오른쪽|위쪽|아래쪽|위|아래)/);
    if (s) {
      var sorted2 = axisSort(list, s[1]);
      steps.push('최상급 — 「가장 ' + s[1] + '」 기준 1위 → ' + name(sorted2[0]));
      return { pick: sorted2[0], cands: list };
    }
    return { list: list };
  }

  /* --- 그리기 -------------------------------------------------------------- */
  function css(n) {
    return getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  }
  var ctx = null, view = 1;
  function layout() {
    var lab = cvEl.closest ? cvEl.closest('.lab') : null;
    var w = lab ? lab.clientWidth - 48 : 380;
    if (w > 380) w = 380;
    if (w < 210) w = 210;
    view = w / IW;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    cvEl.width = Math.round(w * dpr);
    cvEl.height = Math.round(IH * view * dpr);
    cvEl.style.width = w + 'px';
    cvEl.style.height = Math.round(IH * view) + 'px';
    ctx = cvEl.getContext('2d');
    ctx.setTransform(dpr * view, 0, 0, dpr * view, 0, 0);
  }

  var FILL = { 파랑: '#3f7bd0', 빨강: '#c9503f', 초록: '#4e9160', 노랑: '#d8a72b' };

  function shape(c, o) {
    c.fillStyle = FILL[o.color];
    var b = o.box;
    if (o.kind === '사각형') { c.fillRect(b[0], b[1], b[2] - b[0], b[3] - b[1]); return; }
    if (o.kind === '원') {
      c.beginPath();
      c.arc((b[0] + b[2]) / 2, (b[1] + b[3]) / 2, (b[2] - b[0]) / 2, 0, 7);
      c.fill(); return;
    }
    c.beginPath();
    c.moveTo((b[0] + b[2]) / 2, b[1]); c.lineTo(b[2], b[3]); c.lineTo(b[0], b[3]);
    c.closePath(); c.fill();
  }

  var R = { pick: null, cands: [] };

  function draw() {
    if (!ctx) return;
    var c = ctx, i;
    c.clearRect(0, 0, IW, IH);
    c.fillStyle = '#e7e4d9'; c.fillRect(0, 0, IW, IH);
    for (i = 0; i < OBJ.length; i++) {
      var o = OBJ[i];
      var isCand = R.cands.indexOf(o) >= 0, isPick = R.pick === o;
      c.globalAlpha = (isCand || isPick) ? 1 : 0.3;
      shape(c, o);
      c.globalAlpha = 1;
      if (isCand && !isPick) {
        c.save();
        c.strokeStyle = css('--vis') || '#56c8d8'; c.lineWidth = 1.5;
        c.setLineDash([4, 3]);
        c.strokeRect(o.box[0] - 4, o.box[1] - 4, o.box[2] - o.box[0] + 8, o.box[3] - o.box[1] + 8);
        c.restore();
      }
      if (isPick) {
        c.save();
        c.strokeStyle = css('--ok') || '#7dcf8a'; c.lineWidth = 2.5;
        c.strokeRect(o.box[0] - 5, o.box[1] - 5, o.box[2] - o.box[0] + 10, o.box[3] - o.box[1] + 10);
        c.font = '11px "IBM Plex Mono", monospace';
        c.fillStyle = css('--ok') || '#7dcf8a';
        var ty = o.box[1] - 10 < 10 ? o.box[3] + 18 : o.box[1] - 10;
        c.fillText('선택', Math.max(2, o.box[0] - 5), ty);
        c.restore();
      }
    }
  }

  /* --- UI ------------------------------------------------------------------ */
  var q = document.getElementById('g2_q');
  var out = document.getElementById('g2_out');
  var stepsEl = document.getElementById('g2_steps');
  var chips = document.querySelectorAll('#g2_ex button');

  function esc(s) {
    return String(s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function boxStr(o) {
    var b = o.box;
    return '<box>(' + Math.round(b[0] / IW * 1000) + ',' + Math.round(b[1] / IH * 1000) +
           '),(' + Math.round(b[2] / IW * 1000) + ',' + Math.round(b[3] / IH * 1000) + ')</box>';
  }

  function refresh() {
    var steps = [];
    var r = resolve(q.value, steps, 0);
    R.pick = r.pick || null;
    R.cands = r.cands || (r.pick ? [r.pick] : []);
    draw();

    var h = '';
    for (var i = 0; i < steps.length; i++) {
      h += '<div><span class="tag">' + (i + 1) + '</span><span class="ex">' +
           esc(steps[i]) + '</span></div>';
    }
    if (r.err) {
      h += '<div><span class="tag fail">실패</span><span class="ex">' + esc(r.err) + '</span></div>';
    } else if (r.pick) {
      h += '<div><span class="tag tp">출력</span><span class="src">' +
           esc(boxStr(r.pick)) + '</span><span class="ex">' + esc(name(r.pick)) + '</span></div>';
    }
    stepsEl.innerHTML = h;
    out.innerHTML = r.err
      ? '결과 <span class="warn">해석 실패</span><br><span style="font-size:12px">' + esc(r.err) + '</span>'
      : '결과 <span class="good">' + esc(name(r.pick)) + '</span><br>후보 ' +
        (r.cands ? r.cands.length : 1) + '개 중 1개 선택' + (r.tie ? ' · 동점 규칙 사용' : '');
  }

  Array.prototype.forEach.call(chips, function (b) {
    b.addEventListener('click', function () {
      Array.prototype.forEach.call(chips, function (x) { x.classList.remove('sel'); });
      b.classList.add('sel');
      q.value = b.getAttribute('data-q');
      refresh();
    });
  });
  q.addEventListener('input', function () {
    Array.prototype.forEach.call(chips, function (x) { x.classList.remove('sel'); });
    refresh();
  });

  var rt = null;
  window.addEventListener('resize', function () {
    if (rt) clearTimeout(rt);
    rt = setTimeout(function () { layout(); draw(); }, 120);
  });
  new MutationObserver(function () { draw(); }).observe(document.documentElement,
    { attributes: true, attributeFilter: ['data-theme'] });

  layout();
  refresh();
})();
