/* ==========================================================================
   LAB 13-2 — "시간 무시" 진단 미니
   같은 8프레임 클립을 원본 / 역순 / 셔플 순서로 보여주고, 두 가상 모델의
   답이 어떻게 달라지는지 비교합니다.

     · 프레임 백(bag-of-frames) 모델
         프레임을 집합으로만 본다. 순서 문항은 학습 분포의 다수답으로 때운다.
         → 어떤 순서로 넣어도 답이 똑같다.
     · 시간 인식 모델
         제시된 순서에서 기울기·선후를 실제로 읽는다.
         → 순서를 흐트러뜨리면 답이 바뀐다(= 원본 정답 기준 점수가 떨어진다).

   진단의 요지: 정답 라벨은 원본 기준으로 고정한 채 입력 순서만 망가뜨립니다.
   점수가 안 떨어지면 그 모델(혹은 그 문항)은 시간을 보고 있지 않습니다.
   두 모델 모두 시뮬레이션이며 실제 모델을 부르지 않습니다.
   ========================================================================== */
(function () {
  'use strict';

  var strip = document.getElementById('sh_strip');
  if (!strip) return;

  var NF = 8;
  var ORDERS = {
    orig:    [0, 1, 2, 3, 4, 5, 6, 7],
    reverse: [7, 6, 5, 4, 3, 2, 1, 0],
    shuffle: [5, 2, 7, 0, 6, 1, 4, 3]
  };
  var ORDER_NM = { orig: '원본', reverse: '역순', shuffle: '셔플' };

  /* 프레임 t의 상태: 공은 왼→오, 문은 점점 열리고, 조명은 t≥5에서 켜진다 */
  function state(t) {
    var u = t / (NF - 1);
    return { ball: u, door: u, light: t >= 5, boxes: 2 };
  }

  var QS = [
    { k: 'look', q: '장면에 상자가 몇 개 있나요?',            a: ['2개', '3개'] },
    { k: 'look', q: '조명이 켜진 프레임이 있나요?',            a: ['있음', '없음'] },
    { k: 'time', q: '공은 어느 방향으로 움직였나요?',          a: ['왼 → 오', '오 → 왼'] },
    { k: 'time', q: '문은 열렸나요, 닫혔나요?',                a: ['열림', '닫힘'] },
    { k: 'time', q: '조명은 공이 중앙을 지난 뒤에 켜졌나요?',  a: ['뒤', '앞'] }
  ];
  /* 정답은 언제나 원본 순서 기준으로 고정합니다 */
  var GT = ['2개', '있음', '왼 → 오', '열림', '뒤'];

  function slope(ord, get) {
    var n = ord.length, mi = (n - 1) / 2, mv = 0, i;
    for (i = 0; i < n; i++) mv += get(ord[i]);
    mv /= n;
    var s = 0;
    for (i = 0; i < n; i++) s += (i - mi) * (get(ord[i]) - mv);
    return s;
  }

  /* 시간 인식 모델 — 제시된 순서에서 직접 읽는다 */
  function answerTemporal(ord) {
    var i;
    var sb = slope(ord, function (t) { return state(t).ball; });
    var sd = slope(ord, function (t) { return state(t).door; });
    var lightPos = -1, crossPos = -1;
    for (i = 0; i < ord.length; i++) {
      if (lightPos < 0 && state(ord[i]).light) lightPos = i;
      if (crossPos < 0 && state(ord[i]).ball > 0.5) crossPos = i;
    }
    return ['2개', '있음',
            sb >= 0 ? '왼 → 오' : '오 → 왼',
            sd >= 0 ? '열림' : '닫힘',
            (lightPos > crossPos) ? '뒤' : '앞'];
  }
  /* 프레임 백 모델 — 순서 문항은 고정된 다수답 */
  function answerBag() {
    return ['2개', '있음', '왼 → 오', '열림', '뒤'];
  }

  function score(ans, scope) {
    var hit = 0, tot = 0;
    for (var i = 0; i < QS.length; i++) {
      if (scope === 'time' && QS[i].k !== 'time') continue;
      tot++;
      if (ans[i] === GT[i]) hit++;
    }
    return { hit: hit, tot: tot, pct: tot ? hit / tot * 100 : 0 };
  }

  /* --- 필름스트립 --------------------------------------------------------- */
  function css(n) {
    return getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  }
  var SW = 540, SH = 96, cols = 8, cw = 60, ch = 46, cx = null;

  function fit() {
    var host = document.getElementById('sh_wrap');
    var avail = host && host.clientWidth ? host.clientWidth : 540;
    SW = Math.max(280, Math.min(680, Math.floor(avail)));
    cols = SW < 400 ? 4 : 8;
    var rows = NF / cols;
    var gap = 6;
    cw = Math.floor((SW - gap * (cols - 1)) / cols);
    ch = Math.round(cw * 0.72);
    SH = rows * (ch + 16) + (rows - 1) * gap;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    strip.width = Math.round(SW * dpr); strip.height = Math.round(SH * dpr);
    strip.style.width = SW + 'px'; strip.style.height = SH + 'px';
    cx = strip.getContext('2d');
    cx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return gap;
  }

  function cell(x, y, w, h, t, pos) {
    var vis = css('--vis'), lang = css('--lang'), line = css('--line'),
        tx3 = css('--tx3'), panel = css('--panel'), panel2 = css('--panel2');
    var st = state(t);
    cx.fillStyle = panel;
    cx.fillRect(x, y, w, h);
    cx.strokeStyle = line; cx.lineWidth = 1;
    cx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);

    /* 바닥선 */
    cx.strokeStyle = line; cx.globalAlpha = 0.8;
    cx.beginPath(); cx.moveTo(x + 2, y + h * 0.76); cx.lineTo(x + w - 2, y + h * 0.76); cx.stroke();
    cx.globalAlpha = 1;

    /* 문 — 왼쪽 벽의 문짝이 열리면서 어두운 통로가 드러난다 */
    var dw = w * 0.2, dh = h * 0.5, dx = x + w * 0.05, dy = y + h * 0.24;
    cx.fillStyle = panel2;
    cx.fillRect(dx, dy, dw, dh);
    cx.fillStyle = vis;
    cx.globalAlpha = 0.55;
    cx.fillRect(dx + dw * st.door, dy, dw * (1 - st.door), dh);
    cx.globalAlpha = 1;

    /* 조명 */
    cx.fillStyle = st.light ? lang : panel2;
    cx.strokeStyle = st.light ? lang : line;
    cx.beginPath(); cx.arc(x + w * 0.86, y + h * 0.18, Math.max(3, w * 0.055), 0, 7);
    cx.fill(); cx.stroke();

    /* 상자 2개(고정) */
    cx.fillStyle = tx3; cx.globalAlpha = 0.6;
    cx.fillRect(x + w * 0.34, y + h * 0.6, w * 0.1, h * 0.16);
    cx.fillRect(x + w * 0.72, y + h * 0.6, w * 0.1, h * 0.16);
    cx.globalAlpha = 1;

    /* 공 */
    var bx = x + w * (0.2 + 0.62 * st.ball), by = y + h * 0.68;
    cx.beginPath(); cx.arc(bx, by, Math.max(3, w * 0.07), 0, 7);
    cx.fillStyle = vis; cx.fill();

    /* 제시 순서 · 원본 프레임 번호 */
    cx.font = '10px "IBM Plex Mono", monospace';
    cx.fillStyle = tx3;
    cx.fillText('#' + (pos + 1), x, y + h + 12);
    cx.fillStyle = t === pos ? tx3 : lang;
    cx.fillText('f' + t, x + w - 15, y + h + 12);
  }

  function drawStrip(ord, gap) {
    cx.clearRect(0, 0, SW, SH);
    for (var i = 0; i < ord.length; i++) {
      var r = Math.floor(i / cols), c = i % cols;
      cell(c * (cw + gap), r * (ch + 16 + gap), cw, ch, ord[i], i);
    }
  }

  /* --- UI ---------------------------------------------------------------- */
  var el = {
    rows: document.getElementById('sh_rows'),
    mat: document.getElementById('sh_mat'),
    verdict: document.getElementById('sh_verdict')
  };
  var ordBtns = document.querySelectorAll('#sh_order button');
  var scopeBtns = document.querySelectorAll('#sh_scope button');
  var order = 'orig', scope = 'all';

  function render() {
    var gap = fit();
    var ord = ORDERS[order];
    drawStrip(ord, gap);

    var bag = answerBag(), tmp = answerTemporal(ord);
    var html = '';
    for (var i = 0; i < QS.length; i++) {
      var dim = (scope === 'time' && QS[i].k !== 'time');
      var kb = QS[i].k === 'time' ? '순서' : '외형';
      html += '<div class="qr' + (dim ? ' dim' : '') + '">' +
        '<span class="kk ' + QS[i].k + '">' + kb + '</span>' +
        '<span class="qq">' + QS[i].q + '</span>' +
        '<span class="aa ' + (bag[i] === GT[i] ? 'ok' : 'no') + '">' + bag[i] + '</span>' +
        '<span class="aa ' + (tmp[i] === GT[i] ? 'ok' : 'no') + '">' + tmp[i] + '</span>' +
        '</div>';
    }
    el.rows.innerHTML = html;

    /* 모델 × 순서 점수 행렬 */
    var keys = ['orig', 'reverse', 'shuffle'];
    var mh = '<tr><th>모델</th>';
    keys.forEach(function (k) { mh += '<th>' + ORDER_NM[k] + '</th>'; });
    mh += '<th>Δ (원본−셔플)</th></tr>';
    var models = [
      { nm: '프레임 백', f: function () { return answerBag(); } },
      { nm: '시간 인식', f: function (o) { return answerTemporal(ORDERS[o]); } }
    ];
    var body = '', deltas = [];
    models.forEach(function (m) {
      var row = '<tr><td>' + m.nm + '</td>', s0 = null, ss = null;
      keys.forEach(function (k) {
        var s = score(m.f(k), scope);
        if (k === 'orig') s0 = s;
        if (k === 'shuffle') ss = s;
        row += '<td class="num' + (k === order ? ' hi' : '') + '">' +
               s.hit + '/' + s.tot + '</td>';
      });
      var d = s0.pct - ss.pct;
      deltas.push(d);
      row += '<td class="num ' + (d < 1 ? 'flat' : 'drop') + '">' +
             (d < 1 ? '0%p' : '−' + d.toFixed(0) + '%p') + '</td></tr>';
      body += row;
    });
    el.mat.innerHTML = mh + body;

    var v;
    if (scope === 'all') {
      v = '전체 5문항으로 재면 시간 인식 모델의 하락폭은 −' + deltas[1].toFixed(0) +
          '%p에 그칩니다. 외형 문항 2개가 순서와 무관하게 계속 정답이라 진단이 희석되기 때문입니다 — ' +
          '"순서 문항만"으로 바꿔 보세요.';
    } else {
      v = '순서 문항만 남기면 시간 인식 모델은 −' + deltas[1].toFixed(0) +
          '%p, 프레임 백 모델은 0%p입니다. 이 0이 진단 결과입니다 — ' +
          '입력의 시간축을 부쉈는데도 점수가 그대로라면, 그 답은 시간에서 나온 것이 아닙니다.';
    }
    el.verdict.textContent = v;
  }

  Array.prototype.forEach.call(ordBtns, function (b) {
    b.addEventListener('click', function () {
      Array.prototype.forEach.call(ordBtns, function (x) { x.classList.remove('sel'); });
      b.classList.add('sel');
      order = b.getAttribute('data-order');
      render();
    });
  });
  Array.prototype.forEach.call(scopeBtns, function (b) {
    b.addEventListener('click', function () {
      Array.prototype.forEach.call(scopeBtns, function (x) { x.classList.remove('sel'); });
      b.classList.add('sel');
      scope = b.getAttribute('data-scope');
      render();
    });
  });
  var rt = null;
  window.addEventListener('resize', function () {
    if (rt) clearTimeout(rt);
    rt = setTimeout(render, 120);
  });
  new MutationObserver(render).observe(document.documentElement,
    { attributes: true, attributeFilter: ['data-theme'] });

  render();
})();
