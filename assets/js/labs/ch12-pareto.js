/* ==========================================================================
   LAB 12-1 — 크기 · 정확도 · 속도 3축 지형도

   데이터는 전부 공개 수치입니다. 각 모델의 벤치 점수는 해당 모델의 논문 또는
   모델 카드에 실린 값을 그대로 옮겼고(출처는 표의 마지막 열), 서로 다른 문헌의
   수치를 한 그림에 올린다는 사실 자체가 이 LAB의 교보재입니다.

   파생값 두 가지는 계산으로 만듭니다 — 계산식을 화면에도 적어 둡니다.
     · 가중치 메모리(GB) = 파라미터 수 × 정밀도 바이트 수     (활성값·KV 캐시 제외)
     · 추정 지연(ms)     = max(프리필 연산시간, 가중치 1회 읽기) + 32토큰 디코딩
                          프리필 = 2·P·T FLOP ÷ (피크 FLOPS × 0.3)
                          디코딩 = 토큰당 (가중치 바이트 ÷ 메모리 대역폭)
   실측이 아니라 이론 하한입니다. 실제 지연은 런타임·배치·커널에 따라 몇 배씩
   달라집니다(11장). 여기서 볼 것은 절대값이 아니라 점들이 놓이는 모양입니다.
   ========================================================================== */
(function () {
  'use strict';

  var cv = document.getElementById('pf');
  if (!cv) return;

  /* --- 공개 수치 ---------------------------------------------------------
     mmmu : MMMU val · doc : DocVQA test · text : TextVQA val
     null = 해당 문헌이 그 벤치를 보고하지 않음 (추정치를 채워 넣지 않습니다)
     params : 비전 인코더를 포함한 총 파라미터(B), 모델 카드 기준 근삿값
     ---------------------------------------------------------------------- */
  var MODELS = [
    { id: 'flo2l', name: 'Florence-2-large', params: 0.77,
      mmmu: null, doc: null, text: 73.5,
      note: '전이학습 후 TextVQA. 제로샷 COCO 캡션 CIDEr 135.6 (Flamingo-80B는 84.3)',
      src: 'arXiv:2311.06242', url: 'https://arxiv.org/abs/2311.06242' },
    { id: 'sm256', name: 'SmolVLM-256M', params: 0.26,
      mmmu: 29.0, doc: 58.3, text: 50.2,
      note: 'SigLIP-B/16 93M + SmolLM2-135M · 논문 보고 RAM 0.8GB',
      src: 'arXiv:2504.05299', url: 'https://arxiv.org/abs/2504.05299' },
    { id: 'sm500', name: 'SmolVLM-500M', params: 0.50,
      mmmu: 33.7, doc: 70.5, text: 60.2,
      note: 'SigLIP-B/16 93M + SmolLM2-360M · 논문 보고 RAM 1.2GB',
      src: 'arXiv:2504.05299', url: 'https://arxiv.org/abs/2504.05299' },
    { id: 'sm22b', name: 'SmolVLM-2.2B', params: 2.2,
      mmmu: 42.0, doc: 80.0, text: 73.0,
      note: 'SigLIP-SO400M 428M + SmolLM2-1.7B · 논문 보고 RAM 4.9GB',
      src: 'arXiv:2504.05299', url: 'https://arxiv.org/abs/2504.05299' },
    { id: 'iv25_1b', name: 'InternVL2.5-1B', params: 0.9,
      mmmu: 40.9, doc: 84.8, text: 72.0,
      note: 'InternViT-300M + Qwen2.5-0.5B · OCRBench 785',
      src: 'arXiv:2412.05271', url: 'https://arxiv.org/abs/2412.05271' },
    { id: 'moon2', name: 'moondream2', params: 2.0,
      mmmu: null, doc: 79.3, text: 76.3,
      note: '모델 카드 2025-04-15 릴리스 기준 · MMMU 미보고',
      src: 'HF 모델 카드', url: 'https://huggingface.co/vikhyatk/moondream2' },
    { id: 'pg3b', name: 'PaliGemma-3B (448px)', params: 2.9,
      mmmu: null, doc: 78.0, text: 73.2,
      note: 'SigLIP-So400m 400M + Gemma-2B · 전이학습 후 수치(베이스 모델)',
      src: 'arXiv:2407.07726', url: 'https://arxiv.org/abs/2407.07726' },
    { id: 'qw2_2b', name: 'Qwen2-VL-2B', params: 2.2,
      mmmu: 41.1, doc: 90.1, text: 79.7,
      note: 'ViT 675M + LLM 1.5B · RefCOCO val 87.6',
      src: 'arXiv:2409.12191', url: 'https://arxiv.org/abs/2409.12191' },
    { id: 'qw25_3b', name: 'Qwen2.5-VL-3B', params: 3.8,
      mmmu: 53.1, doc: 93.9, text: 79.3,
      note: 'OCRBench 797',
      src: 'arXiv:2502.13923', url: 'https://arxiv.org/abs/2502.13923' },
    { id: 'qw25_7b', name: 'Qwen2.5-VL-7B', params: 8.3,
      mmmu: 58.6, doc: 95.7, text: 84.9,
      note: 'TextVQA에서 72B보다 높습니다 — 단일 수치의 노이즈',
      src: 'arXiv:2502.13923', url: 'https://arxiv.org/abs/2502.13923' },
    { id: 'qw25_72b', name: 'Qwen2.5-VL-72B', params: 73.4,
      mmmu: 70.2, doc: 96.4, text: 83.5,
      note: 'OCRBench 885',
      src: 'arXiv:2502.13923', url: 'https://arxiv.org/abs/2502.13923' }
  ];

  /* --- 하드웨어(공개 스펙에서 반올림한 근삿값) --------------------------- */
  var HW = [
    { id: 'a100', name: 'A100 80GB · 서버 GPU',      bw: 2039, tf: 312, mem: 80 },
    { id: '4090', name: 'RTX 4090 · 워크스테이션',    bw: 1008, tf: 165, mem: 24 },
    { id: 'orin', name: 'Jetson Orin NX 16GB · 엣지', bw: 102,  tf: 20,  mem: 16 },
    { id: 'cpu',  name: '노트북 CPU · DDR5',          bw: 60,   tf: 1,   mem: 16 },
    { id: 'web',  name: '브라우저 WebGPU · 통합 GPU', bw: 80,   tf: 4,   mem: 2 }
  ];
  var MFU = 0.3;     /* 피크 FLOPS 대비 실효 사용률 가정 */
  var OUTTOK = 32;   /* 판정 태스크가 뱉는 출력 토큰 수 가정 */
  var MEMFACTOR = 1.2; /* 가중치 외 KV·활성값 여유 */

  var BENCH = [
    { key: 'mmmu', label: 'MMMU', full: '일반 추론 · MMMU (val)' },
    { key: 'doc',  label: 'DocVQA', full: '문서 · DocVQA (test)' },
    { key: 'text', label: 'TextVQA', full: '장면 텍스트 · TextVQA (val)' }
  ];

  /* --- 상태 -------------------------------------------------------------- */
  var st = {
    axis: 'params',
    w: { mmmu: 34, doc: 33, text: 33 },
    hw: '4090',
    bpp: 2,
    ntok: 1024,
    pick: null,
    hover: null
  };

  function hw() {
    for (var i = 0; i < HW.length; i++) if (HW[i].id === st.hw) return HW[i];
    return HW[1];
  }

  /* --- 파생값 ------------------------------------------------------------ */
  function memGB(m) { return m.params * st.bpp; }          /* B개 × bytes = GB */

  function latencyMs(m) {
    var h = hw();
    var bytes = m.params * 1e9 * st.bpp;
    var prefillFlops = 2 * m.params * 1e9 * (st.ntok + 32);
    var tCompute = prefillFlops / (h.tf * 1e12 * MFU);
    var tRead = bytes / (h.bw * 1e9);
    var tPrefill = Math.max(tCompute, tRead);
    var tDecode = OUTTOK * tRead;
    return (tPrefill + tDecode) * 1000;
  }

  function fits(m) { return memGB(m) * MEMFACTOR <= hw().mem; }

  function score(m) {
    var sw = 0, acc = 0, missing = [];
    for (var i = 0; i < BENCH.length; i++) {
      var k = BENCH[i].key, w = st.w[k];
      if (w <= 0) continue;
      if (m[k] === null) { missing.push(BENCH[i].label); continue; }
      sw += w; acc += w * m[k];
    }
    if (sw === 0) return { v: null, missing: missing };
    return { v: acc / sw, missing: missing };
  }

  function xval(m) {
    if (st.axis === 'params') return m.params;
    if (st.axis === 'mem') return memGB(m);
    return latencyMs(m);
  }
  var AXIS = {
    params: { label: '총 파라미터 (B, 로그축)', fmt: function (v) { return v < 1 ? v.toFixed(2) : String(v); } },
    mem:    { label: '가중치 메모리 (GB, 로그축)', fmt: function (v) { return v < 1 ? v.toFixed(2) : String(v); } },
    lat:    { label: '추정 지연 (ms, 로그축)', fmt: function (v) { return v >= 1000 ? (v / 1000) + 's' : String(v); } }
  };

  /* 현재 설정에서 그릴 수 있는 행 */
  function rows() {
    var out = [];
    for (var i = 0; i < MODELS.length; i++) {
      var m = MODELS[i], s = score(m);
      out.push({
        m: m, y: s.v, missing: s.missing,
        x: xval(m), mem: memGB(m), lat: latencyMs(m), fits: fits(m),
        partial: s.v !== null && s.missing.length > 0
      });
    }
    return out;
  }

  /* 파레토 프론티어: x는 작을수록, y는 클수록 좋다 */
  function frontier(rs) {
    var live = rs.filter(function (r) { return r.y !== null; })
                 .slice().sort(function (a, b) { return a.x - b.x || b.y - a.y; });
    var best = -Infinity, front = [];
    for (var i = 0; i < live.length; i++) {
      if (live[i].y > best + 1e-9) { front.push(live[i]); best = live[i].y; }
    }
    return front;
  }

  /* --- 그리기 ------------------------------------------------------------ */
  function css(n) {
    return getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  }
  var W = 520, H = 340, ctx = null;
  var PAD = { l: 44, r: 14, t: 14, b: 42 };

  function fit() {
    var host = cv.parentNode;
    var avail = host ? host.clientWidth : 520;
    W = Math.max(280, Math.min(520, avail || 520));
    H = W < 380 ? 300 : 340;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = W * dpr; cv.height = H * dpr;
    cv.style.width = W + 'px'; cv.style.height = H + 'px';
    ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  var YMIN = 20, YMAX = 100, xlo = 0.1, xhi = 100;

  function px(x) {
    var t = (Math.log(x) - Math.log(xlo)) / (Math.log(xhi) - Math.log(xlo));
    return PAD.l + t * (W - PAD.l - PAD.r);
  }
  function py(y) {
    var t = (y - YMIN) / (YMAX - YMIN);
    return H - PAD.b - t * (H - PAD.t - PAD.b);
  }

  function draw(rs, front) {
    var vis = css('--vis'), lang = css('--lang'), line = css('--line'),
        tx2 = css('--tx2'), tx3 = css('--tx3'), panel = css('--panel'),
        panel2 = css('--panel2'), ok = css('--ok'), bad = css('--bad');

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = panel; ctx.fillRect(0, 0, W, H);

    var live = rs.filter(function (r) { return r.y !== null; });
    if (!live.length) {
      ctx.fillStyle = tx3;
      ctx.font = '12px "IBM Plex Sans KR", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('가중치를 하나 이상 올려 보세요', W / 2, H / 2);
      return;
    }
    var mn = Infinity, mx = -Infinity;
    for (var i = 0; i < live.length; i++) {
      if (live[i].x < mn) mn = live[i].x;
      if (live[i].x > mx) mx = live[i].x;
    }
    xlo = mn / 1.9; xhi = mx * 1.9;

    /* 격자 + y축 */
    ctx.font = '10px "IBM Plex Mono", monospace';
    ctx.strokeStyle = line; ctx.lineWidth = 1;
    for (var y = 20; y <= 100; y += 20) {
      ctx.globalAlpha = 0.55;
      ctx.beginPath(); ctx.moveTo(PAD.l, py(y)); ctx.lineTo(W - PAD.r, py(y)); ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = tx3; ctx.textAlign = 'right';
      ctx.fillText(String(y), PAD.l - 6, py(y) + 3);
    }
    /* x축 눈금: 로그 데케이드 */
    var dec = Math.floor(Math.log(xlo) / Math.LN10);
    ctx.textAlign = 'center';
    for (var d = dec; d <= Math.ceil(Math.log(xhi) / Math.LN10); d++) {
      var mults = [1, 2, 5];
      for (var k = 0; k < mults.length; k++) {
        var v = mults[k] * Math.pow(10, d);
        if (v < xlo || v > xhi) continue;
        ctx.globalAlpha = 0.45; ctx.strokeStyle = line;
        ctx.beginPath(); ctx.moveTo(px(v), PAD.t); ctx.lineTo(px(v), H - PAD.b); ctx.stroke();
        ctx.globalAlpha = 1; ctx.fillStyle = tx3;
        ctx.fillText(AXIS[st.axis].fmt(v), px(v), H - PAD.b + 15);
      }
    }
    ctx.fillStyle = tx2; ctx.textAlign = 'center';
    ctx.font = '11px "IBM Plex Sans KR", system-ui, sans-serif';
    ctx.fillText(AXIS[st.axis].label, PAD.l + (W - PAD.l - PAD.r) / 2, H - 6);
    ctx.save();
    ctx.translate(11, PAD.t + (H - PAD.t - PAD.b) / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('가중 점수', 0, 0);
    ctx.restore();

    /* 프론티어 선(계단) */
    if (front.length > 1) {
      ctx.strokeStyle = ok; ctx.globalAlpha = 0.5; ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(px(front[0].x), py(front[0].y));
      for (var f = 1; f < front.length; f++) {
        ctx.lineTo(px(front[f].x), py(front[f - 1].y));
        ctx.lineTo(px(front[f].x), py(front[f].y));
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    var onFront = {};
    for (var q = 0; q < front.length; q++) onFront[front[q].m.id] = true;

    /* 점 */
    ctx.font = '10px "IBM Plex Sans KR", system-ui, sans-serif';
    for (var j = 0; j < live.length; j++) {
      var r = live[j], X = px(r.x), Y = py(r.y);
      var sel = st.pick === r.m.id || st.hover === r.m.id;
      var col = onFront[r.m.id] ? ok : vis;
      if (!r.fits) col = bad;

      ctx.beginPath(); ctx.arc(X, Y, sel ? 8 : (onFront[r.m.id] ? 6 : 4.5), 0, 7);
      if (r.partial) {
        ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.stroke();
        ctx.fillStyle = panel2; ctx.globalAlpha = 0.9; ctx.fill(); ctx.globalAlpha = 1;
      } else {
        ctx.fillStyle = col; ctx.fill();
        ctx.lineWidth = 1.5; ctx.strokeStyle = panel; ctx.stroke();
      }
      if (sel || onFront[r.m.id]) {
        ctx.fillStyle = sel ? css('--tx') : tx2;
        ctx.textAlign = X > W - 120 ? 'right' : 'left';
        ctx.fillText(r.m.name, X + (X > W - 120 ? -10 : 10), Y + 3.5);
      }
    }
    /* 메모리 초과 표시 */
    var overflowed = live.filter(function (r) { return !r.fits; }).length;
    if (overflowed) {
      ctx.fillStyle = bad; ctx.textAlign = 'right';
      ctx.font = '10px "IBM Plex Mono", monospace';
      ctx.fillText(overflowed + '개 모델이 이 장치 메모리를 넘습니다', W - PAD.r, PAD.t + 10);
    }
  }

  /* --- 표 ---------------------------------------------------------------- */
  function num(v, digits) {
    if (v === null || v === undefined) return '<span style="color:var(--tx3)">미보고</span>';
    return v.toFixed(digits === undefined ? 1 : digits);
  }
  function ms(v) {
    return v >= 1000 ? (v / 1000).toFixed(1) + ' s' : Math.round(v) + ' ms';
  }
  function renderTable(rs, front) {
    var host = document.getElementById('pf_table');
    if (!host) return;
    var onFront = {};
    for (var q = 0; q < front.length; q++) onFront[front[q].m.id] = true;
    var h = '<div class="tablebox"><table><thead><tr>' +
      '<th>모델</th><th>파라미터</th><th>MMMU</th><th>DocVQA</th><th>TextVQA</th>' +
      '<th>메모리</th><th>추정 지연</th><th>가중 점수</th><th>출처</th></tr></thead><tbody>';
    var sorted = rs.slice().sort(function (a, b) {
      if (a.y === null) return 1;
      if (b.y === null) return -1;
      return b.y - a.y;
    });
    for (var i = 0; i < sorted.length; i++) {
      var r = sorted[i], m = r.m;
      var mark = onFront[m.id] ? ' <span style="color:var(--ok)">◆</span>' : '';
      var cls = st.pick === m.id ? ' class="on"' : '';
      h += '<tr data-id="' + m.id + '"' + cls + '>' +
        '<td>' + m.name + mark + '</td>' +
        '<td class="num">' + m.params + 'B</td>' +
        '<td class="num">' + num(m.mmmu) + '</td>' +
        '<td class="num">' + num(m.doc) + '</td>' +
        '<td class="num">' + num(m.text) + '</td>' +
        '<td class="num">' + r.mem.toFixed(1) + 'GB' +
          (r.fits ? '' : ' <span style="color:var(--bad)">초과</span>') + '</td>' +
        '<td class="num">' + ms(r.lat) + '</td>' +
        '<td class="num">' + (r.y === null ? '—' : r.y.toFixed(1) +
          (r.partial ? ' <span style="color:var(--lang)">*</span>' : '')) + '</td>' +
        '<td><a href="' + m.url + '">' + m.src + '</a></td></tr>';
    }
    h += '</tbody></table></div>';
    host.innerHTML = h;
    Array.prototype.forEach.call(host.querySelectorAll('tr[data-id]'), function (tr) {
      tr.addEventListener('click', function () {
        st.pick = st.pick === tr.getAttribute('data-id') ? null : tr.getAttribute('data-id');
        refresh();
      });
    });
  }

  /* --- 선택 패널 --------------------------------------------------------- */
  function renderPick(rs) {
    var host = document.getElementById('pf_pick');
    if (!host) return;
    var id = st.hover || st.pick, r = null;
    for (var i = 0; i < rs.length; i++) if (rs[i].m.id === id) r = rs[i];
    if (!r) {
      host.innerHTML = '점이나 표의 행을 누르면 그 모델의 공개 수치가 여기 나옵니다.';
      return;
    }
    var m = r.m;
    host.innerHTML =
      '<b style="font-size:14px">' + m.name + '</b><br>' +
      'MMMU ' + num(m.mmmu) + ' · DocVQA ' + num(m.doc) + ' · TextVQA ' + num(m.text) + '<br>' +
      '가중 점수 <b>' + (r.y === null ? '—' : r.y.toFixed(1)) + '</b>' +
      (r.partial ? ' <span class="warn">(미보고 축 제외)</span>' : '') + '<br>' +
      '가중치 ' + r.mem.toFixed(1) + 'GB · 추정 ' + ms(r.lat) +
      (r.fits ? '' : ' <span class="warn">· 장치 메모리 초과</span>') +
      '<div style="font-family:\'IBM Plex Sans KR\',system-ui,sans-serif;font-size:12px;' +
      'color:var(--tx2);line-height:1.6;margin-top:6px">' + m.note + '</div>';
  }

  /* --- 배선 -------------------------------------------------------------- */
  var el = {
    axis: document.getElementById('pf_axis'),
    prec: document.getElementById('pf_prec'),
    hw: document.getElementById('pf_hw'),
    tok: document.getElementById('pf_tok'),
    tokv: document.getElementById('pf_tokv'),
    verdict: document.getElementById('pf_verdict')
  };

  function verdict(rs, front) {
    if (!el.verdict) return;
    var names = front.map(function (r) { return r.m.name; });
    var top = null;
    for (var i = 0; i < rs.length; i++) {
      if (rs[i].y === null) continue;
      if (!top || rs[i].y > top.y) top = rs[i];
    }
    if (!front.length) {
      el.verdict.textContent = '가중치가 전부 0입니다 — 어떤 벤치도 보지 않겠다는 뜻이라 비교할 것이 남지 않습니다.';
      return;
    }
    var msg = '파레토 프론티어 ' + front.length + '개 — ' + names.join(' · ') + '. ';
    if (top && front.length && front[0].m.id !== top.m.id) {
      msg += '가장 싼 선택지(' + front[0].m.name + ')와 가장 정확한 선택지(' +
             top.m.name + ') 사이의 모든 점이 진짜 후보이고, 프론티어 밖의 점은 ' +
             '어느 축으로도 이길 수 없는 모델입니다.';
    }
    el.verdict.textContent = msg;
  }

  function refresh() {
    var rs = rows(), front = frontier(rs);
    draw(rs, front);
    renderTable(rs, front);
    renderPick(rs);
    verdict(rs, front);
  }

  function wireSeg(box, attr, fn) {
    if (!box) return;
    Array.prototype.forEach.call(box.querySelectorAll('button'), function (b) {
      b.addEventListener('click', function () {
        Array.prototype.forEach.call(box.querySelectorAll('button'), function (x) {
          x.classList.remove('sel');
        });
        b.classList.add('sel');
        fn(b.getAttribute(attr));
        refresh();
      });
    });
  }
  wireSeg(el.axis, 'data-x', function (v) { st.axis = v; });
  wireSeg(el.prec, 'data-p', function (v) { st.bpp = parseFloat(v); });

  if (el.hw) {
    var opt = '';
    for (var i = 0; i < HW.length; i++) {
      opt += '<option value="' + HW[i].id + '"' + (HW[i].id === st.hw ? ' selected' : '') +
             '>' + HW[i].name + '</option>';
    }
    el.hw.innerHTML = opt;
    el.hw.addEventListener('change', function () { st.hw = el.hw.value; refresh(); });
  }
  if (el.tok) {
    el.tok.addEventListener('input', function () {
      st.ntok = parseInt(el.tok.value, 10);
      if (el.tokv) el.tokv.textContent = st.ntok.toLocaleString() + '개';
      refresh();
    });
  }

  BENCH.forEach(function (b) {
    var s = document.getElementById('w_' + b.key);
    var v = document.getElementById('w_' + b.key + '_v');
    if (!s) return;
    s.addEventListener('input', function () {
      st.w[b.key] = parseInt(s.value, 10);
      if (v) v.textContent = s.value;
      refresh();
    });
  });

  /* 캔버스 히트 테스트 */
  function nearest(evt) {
    var rect = cv.getBoundingClientRect();
    var mx = evt.clientX - rect.left, my = evt.clientY - rect.top;
    var rs = rows(), best = null, bd = 20 * 20;
    for (var i = 0; i < rs.length; i++) {
      if (rs[i].y === null) continue;
      var dx = px(rs[i].x) - mx, dy = py(rs[i].y) - my;
      var d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = rs[i].m.id; }
    }
    return best;
  }
  cv.addEventListener('mousemove', function (e) {
    var id = nearest(e);
    if (id !== st.hover) { st.hover = id; cv.style.cursor = id ? 'pointer' : 'default'; refresh(); }
  });
  cv.addEventListener('mouseleave', function () {
    if (st.hover) { st.hover = null; refresh(); }
  });
  cv.addEventListener('click', function (e) {
    var id = nearest(e);
    if (id) { st.pick = st.pick === id ? null : id; refresh(); }
  });

  window.addEventListener('resize', function () { fit(); refresh(); });
  new MutationObserver(refresh).observe(document.documentElement,
    { attributes: true, attributeFilter: ['data-theme'] });

  fit();
  refresh();
})();
