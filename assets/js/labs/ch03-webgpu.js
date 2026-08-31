/* ==========================================================================
   LAB 3-2 — 브라우저 안에서 해상도 바꿔 추론하기 (조종석)

   실제 추론은 assets/js/labs/ch03-webgpu-worker.js 가 합니다. 이 파일은
   지원 여부 확인 · 동의 게이트 · 진행률 · 샘플 이미지 · 결과 표만 맡습니다.

   3단 폴백
     ① WebGPU 있음            → device:'webgpu' (shader-f16이면 q4f16 ≈160MB)
     ② 없음 + 데스크톱        → device:'wasm'   (int8 ≈260MB, 매우 느림)
     ③ 없음 + 모바일 / 실패   → LAB 3-1 로 안내
   자동 시작은 하지 않습니다. 반드시 버튼을 눌러야 내려받습니다.
   ========================================================================== */
(function () {
  'use strict';

  var gate = document.getElementById('w_gate');
  if (!gate) return;

  /* 워커 파일 경로 — 자기 자신의 src 에서 파생시킵니다 */
  var SELF = (document.currentScript && document.currentScript.src) || '';
  var WORKER_URL = SELF
    ? SELF.replace(/ch03-webgpu\.js(\?.*)?$/, 'ch03-webgpu-worker.js')
    : '../assets/js/labs/ch03-webgpu-worker.js';

  var PRESETS = [
    { edge: 512,  label: '512px' },
    { edge: 1024, label: '1,024px' },
    { edge: 1536, label: '1,536px' }
  ];

  var el = {
    gpu: document.getElementById('w_gpu'),
    cache: document.getElementById('w_cache'),
    start: document.getElementById('w_start'),
    skip: document.getElementById('w_skip'),
    loading: document.getElementById('w_loading'),
    bar: document.getElementById('w_barfill'),
    status: document.getElementById('w_status'),
    app: document.getElementById('w_app'),
    canvas: document.getElementById('w_canvas'),
    sample: document.getElementById('w_sample'),
    file: document.getElementById('w_file'),
    prompt: document.getElementById('w_prompt'),
    run: document.getElementById('w_run'),
    stop: document.getElementById('w_stop'),
    runStatus: document.getElementById('w_run_status'),
    live: document.getElementById('w_live'),
    rows: document.getElementById('w_rows'),
    fallback: document.getElementById('w_fallback'),
    fbmsg: document.getElementById('w_fbmsg')
  };

  var state = {
    device: null, f16: false, engine: null, ready: false,
    busy: false, abort: false, blob: null, srcLabel: '샘플 이미지'
  };

  function show(node, on) { if (node) node.hidden = !on; }
  function fmt(n) { return Math.round(n).toLocaleString('en-US'); }
  function mb(bytes) { return (bytes / 1048576).toFixed(1) + 'MB'; }

  function bail(msg) {
    show(gate, false); show(el.loading, false); show(el.app, false);
    show(el.fallback, true);
    if (el.fbmsg) el.fbmsg.innerHTML = msg;
  }

  /* --- 샘플 이미지 -------------------------------------------------------
     해상도 프리셋이 의미를 가지려면 원본이 충분히 커야 합니다. 캔버스 버퍼를
     1536×1152로 두어, 512 프리셋이 진짜 '축소'가 되게 합니다(업스케일이 아니라).
     글자를 세 가지 크기로 넣어 어느 크기부터 읽히기 시작하는지 보게 합니다. */
  var CW = 1536, CH = 1152;
  function drawSample() {
    var cv = el.canvas;
    if (!cv) return;
    cv.width = CW; cv.height = CH;
    cv.style.width = '300px'; cv.style.height = 'auto';
    var c = cv.getContext('2d');

    var g = c.createLinearGradient(0, 0, 0, CH);
    g.addColorStop(0, '#dfe7ec'); g.addColorStop(1, '#b9c6cd');
    c.fillStyle = g; c.fillRect(0, 0, CW, CH);

    /* 나무 카운터 */
    c.fillStyle = '#8a6242'; c.fillRect(0, CH * 0.74, CW, CH * 0.26);
    c.fillStyle = '#7a5539'; c.fillRect(0, CH * 0.74, CW, 18);

    /* 간판 */
    var bx = CW * 0.10, by = CH * 0.13, bw = CW * 0.62, bh = CH * 0.50;
    c.fillStyle = '#fbfaf5'; c.fillRect(bx, by, bw, bh);
    c.strokeStyle = '#2f3a44'; c.lineWidth = 9; c.strokeRect(bx, by, bw, bh);

    c.fillStyle = '#22303a';
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.font = '700 110px "IBM Plex Sans KR", system-ui, sans-serif';
    c.fillText('JUICE', bx + bw / 2, by + bh * 0.26);

    c.strokeStyle = '#c9c4b4'; c.lineWidth = 4;
    c.beginPath();
    c.moveTo(bx + bw * 0.14, by + bh * 0.44);
    c.lineTo(bx + bw * 0.86, by + bh * 0.44);
    c.stroke();

    c.fillStyle = '#a8341f';
    c.font = '700 48px "IBM Plex Mono", ui-monospace, monospace';
    c.fillText('$ 4.75', bx + bw / 2, by + bh * 0.60);

    c.fillStyle = '#5c6670';
    c.font = '400 28px "IBM Plex Sans KR", system-ui, sans-serif';
    c.fillText('NET 350 mL  ·  NO SUGAR', bx + bw / 2, by + bh * 0.80);

    /* 오렌지 하나 */
    var ox = CW * 0.83, oy = CH * 0.63, orr = CW * 0.075;
    c.beginPath(); c.arc(ox, oy, orr, 0, 7);
    c.fillStyle = '#e8862b'; c.fill();
    c.strokeStyle = '#c76d1c'; c.lineWidth = 6; c.stroke();
    c.beginPath();
    c.ellipse(ox + orr * 0.35, oy - orr * 0.95, orr * 0.38, orr * 0.18, -0.5, 0, 7);
    c.fillStyle = '#4e8b4a'; c.fill();

    c.textAlign = 'start'; c.textBaseline = 'alphabetic';
    state.srcLabel = '샘플 이미지 ' + CW + '×' + CH;
    cv.toBlob(function (b) { state.blob = b; }, 'image/png');
  }

  /* --- 지원 여부 확인 ---------------------------------------------------- */
  function isMobile() {
    return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '');
  }

  async function probe() {
    /* 캐시 적중 여부 — transformers.js 는 Cache API 에 가중치를 남깁니다 */
    if (el.cache) {
      var hit = false;
      try {
        if (self.caches && caches.keys) {
          var keys = await caches.keys();
          hit = keys.some(function (k) { return /transformers/i.test(k); });
        }
      } catch (e) { /* 시크릿 모드 등 — 조용히 넘어갑니다 */ }
      el.cache.textContent = hit ? '캐시 있음 · 다시 받지 않습니다' : '첫 방문 · 내려받기 필요';
      el.cache.className = 'pill' + (hit ? ' on' : '');
    }

    if (!('gpu' in navigator)) return noGpu();
    var adapter = null;
    try { adapter = await navigator.gpu.requestAdapter(); } catch (e) { adapter = null; }
    if (!adapter) return noGpu();

    state.device = 'webgpu';
    state.f16 = !!(adapter.features && adapter.features.has('shader-f16'));
    if (el.gpu) {
      el.gpu.textContent = 'WebGPU 사용 가능' + (state.f16 ? ' · f16' : ' · f16 없음');
      el.gpu.className = 'pill on';
    }
    if (el.start) {
      el.start.textContent = state.f16
        ? '모델 받기 (약 160MB)'
        : '모델 받기 (약 260MB · f16 미지원)';
    }
  }

  function noGpu() {
    if (el.gpu) { el.gpu.textContent = 'WebGPU 없음'; el.gpu.className = 'pill off'; }
    if (isMobile()) {
      bail('이 브라우저에서는 <b>WebGPU를 쓸 수 없고</b>, 모바일에서 wasm 폴백은 ' +
           '메모리·시간 모두 감당하기 어렵습니다. 데스크톱 Chrome·Edge(113+)나 ' +
           'Safari 26+에서 다시 열어 주세요. ' +
           '개념은 위의 <b>LAB 3-1</b>만으로도 충분히 잡힙니다 — 거기서 ' +
           '토큰 수와 비용이 어떻게 움직이는지 먼저 보시면 됩니다.');
      return;
    }
    state.device = 'wasm'; state.f16 = false;
    if (el.start) el.start.textContent = '모델 받기 (약 260MB · CPU 폴백)';
    var note = document.createElement('p');
    note.className = 'hint';
    note.style.margin = '10px 0 0';
    note.innerHTML = 'WebGPU가 없어 <b>wasm(CPU) 폴백</b>으로 돕니다. 동작은 하지만 ' +
      '한 번 답하는 데 수십 초가 걸릴 수 있습니다. 급하지 않으면 그대로 진행하시고, ' +
      '빠르게 보고 싶으면 데스크톱 Chrome·Edge에서 열어 주세요.';
    gate.appendChild(note);
  }

  /* --- 엔진 배선 --------------------------------------------------------- */
  async function makeEngine(onMsg) {
    try {
      var w = new Worker(WORKER_URL, { type: 'module' });
      w.onmessage = function (e) { onMsg(e.data); };
      w.onerror = function (e) {
        onMsg({ type: 'error', message: (e && e.message) || '워커를 실행하지 못했습니다' });
      };
      return { post: function (m) { w.postMessage(m); } };
    } catch (e) {
      /* 모듈 워커 미지원 — 같은 파일을 메인 스레드에서 씁니다(UI가 좀 뻑뻑해집니다) */
      var mod = await import(WORKER_URL);
      var engine = mod.createEngine(onMsg);
      return { post: function (m) { engine.handle(m); } };
    }
  }

  /* --- 진행률 ------------------------------------------------------------ */
  var files = {};
  function onProgress(p) {
    if (!files[p.file]) files[p.file] = { loaded: 0, total: 0 };
    var f = files[p.file];
    if (p.total) f.total = p.total;
    if (p.loaded) f.loaded = p.loaded;
    if (p.status === 'done' && f.total) f.loaded = f.total;

    var L = 0, T = 0, n = 0, done = 0;
    for (var k in files) {
      if (!Object.prototype.hasOwnProperty.call(files, k)) continue;
      L += files[k].loaded; T += files[k].total; n++;
      if (files[k].total && files[k].loaded >= files[k].total) done++;
    }
    var pct = T > 0 ? Math.min(100, L / T * 100) : 0;
    if (el.bar) el.bar.style.width = pct.toFixed(1) + '%';
    if (el.status) {
      el.status.textContent = pct.toFixed(0) + '%  ·  ' + mb(L) + ' / ' + mb(T) +
        '  ·  파일 ' + done + '/' + n + '\n' + p.file;
    }
  }

  /* --- 결과 표 ----------------------------------------------------------- */
  var rowEls = {};
  function resetRows() {
    rowEls = {};
    if (el.rows) el.rows.innerHTML = '';
  }
  function ensureRow(key, label) {
    if (rowEls[key]) return rowEls[key];
    var tr = document.createElement('tr');
    tr.innerHTML = '<td class="num">' + label + '</td>' +
      '<td class="num" data-c="tok">…</td><td class="num" data-c="ms">…</td>' +
      '<td data-c="ans" style="color:var(--tx2)">생성 중…</td>';
    if (el.rows) el.rows.appendChild(tr);
    rowEls[key] = {
      tr: tr, label: label,
      lab: tr.firstChild,
      tok: tr.querySelector('[data-c=tok]'),
      ms: tr.querySelector('[data-c=ms]'),
      ans: tr.querySelector('[data-c=ans]')
    };
    return rowEls[key];
  }

  /* --- 실행 -------------------------------------------------------------- */
  var pending = null;
  function handle(m) {
    if (m.type === 'progress') { onProgress(m); return; }
    if (m.type === 'stage') { if (el.status) el.status.textContent = m.text; return; }

    if (m.type === 'ready') {
      state.ready = true;
      show(el.loading, false); show(gate, false); show(el.app, true);
      if (el.runStatus) {
        el.runStatus.textContent = '준비 완료 · ' + m.device + ' · ' + m.dtype;
      }
      return;
    }

    if (m.type === 'prepared') {
      var r0 = rowEls[m.key];
      if (r0) {
        r0.tok.innerHTML = fmt(m.imageTokens) + ' <span style="color:var(--tx3)">이미지</span><br>' +
          '<span style="color:var(--tx3)">전체 ' + fmt(m.promptLen) + '</span>';
        if (m.patches) {
          r0.lab.innerHTML = r0.label +
            '<br><span style="color:var(--tx3)">타일 ' + m.patches + '장 · ' +
            m.tileSide + 'px</span>';
        }
      }
      if (el.live) el.live.textContent = '';
      return;
    }

    if (m.type === 'token') {
      if (el.live) el.live.textContent += m.text;
      return;
    }

    if (m.type === 'result') {
      var r = rowEls[m.key];
      if (r) {
        r.ms.innerHTML = (m.ms / 1000).toFixed(1) + '초<br>' +
          '<span style="color:var(--tx3)">' + m.tps.toFixed(1) + ' tok/s</span>';
        r.ans.textContent = m.answer || '(빈 응답)';
        r.ans.style.color = 'var(--tx)';
      }
      next();
      return;
    }

    if (m.type === 'error') {
      if (m.phase === 'load' || !state.ready) {
        bail('모델을 불러오지 못했습니다 — <code>' + (m.message || '') + '</code><br>' +
             '네트워크나 브라우저 메모리 문제일 수 있습니다. 새로고침 후 다시 시도하거나, ' +
             '그냥 위의 <b>LAB 3-1</b>로 개념을 확인하셔도 됩니다.');
        return;
      }
      var re = rowEls[m.key];
      if (re) { re.ans.textContent = '오류: ' + m.message; re.ans.style.color = 'var(--bad)'; }
      finish();
      return;
    }
  }

  function next() {
    if (state.abort || !pending || pending.i >= PRESETS.length) return finish();
    var p = PRESETS[pending.i], key = 'p' + pending.i;
    pending.i++;
    ensureRow(key, p.label);
    if (el.runStatus) {
      el.runStatus.textContent = '실행 중 — 긴 변 ' + p.label +
        ' (' + pending.i + '/' + PRESETS.length + ')';
    }
    state.engine.post({
      type: 'run', key: key, blob: state.blob,
      prompt: pending.prompt, longestEdge: p.edge, tile: 512
    });
  }

  function finish() {
    state.busy = false;
    pending = null;
    show(el.stop, false);
    if (el.run) el.run.disabled = false;
    if (el.runStatus) {
      el.runStatus.textContent = state.abort ? '중단했습니다.' : '세 단계 모두 끝났습니다.';
    }
  }

  /* --- 이벤트 ------------------------------------------------------------ */
  if (el.start) el.start.addEventListener('click', async function () {
    el.start.disabled = true;
    show(gate, false); show(el.loading, true);
    if (el.status) el.status.textContent = '런타임을 불러오는 중…';
    try {
      state.engine = await makeEngine(handle);
      state.engine.post({ type: 'load', device: state.device, f16: state.f16 });
    } catch (e) {
      bail('실행 환경을 준비하지 못했습니다 — <code>' + ((e && e.message) || e) + '</code><br>' +
           '위의 <b>LAB 3-1</b>은 그대로 쓰실 수 있습니다.');
    }
  });

  if (el.skip) el.skip.addEventListener('click', function () {
    bail('건너뛰었습니다. 개념은 <b>LAB 3-1</b>에 전부 들어 있습니다 — ' +
         '해상도·타일·압축을 움직이며 토큰 수와 비용이 어떻게 갈리는지 보세요. ' +
         '마음이 바뀌면 새로고침하면 다시 나옵니다.');
  });

  if (el.sample) el.sample.addEventListener('click', function () {
    drawSample();
    if (el.runStatus) el.runStatus.textContent = '샘플 이미지로 되돌렸습니다.';
  });

  if (el.file) el.file.addEventListener('change', function () {
    var f = el.file.files && el.file.files[0];
    if (!f) return;
    if (!/^image\//.test(f.type)) return;
    state.blob = f;
    state.srcLabel = f.name;
    var url = URL.createObjectURL(f);
    var img = new Image();
    img.onload = function () {
      var cv = el.canvas, c = cv.getContext('2d');
      cv.width = img.naturalWidth; cv.height = img.naturalHeight;
      cv.style.width = '300px'; cv.style.height = 'auto';
      c.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      if (el.runStatus) {
        el.runStatus.textContent = f.name + ' · ' +
          img.naturalWidth + '×' + img.naturalHeight +
          (Math.max(img.naturalWidth, img.naturalHeight) < 1024
            ? ' — 원본이 작아 높은 프리셋에서는 확대만 됩니다'
            : '');
      }
    };
    img.src = url;
  });

  if (el.run) el.run.addEventListener('click', function () {
    if (state.busy || !state.ready || !state.blob) return;
    state.busy = true; state.abort = false;
    el.run.disabled = true;
    show(el.stop, true);
    resetRows();
    if (el.live) el.live.textContent = '';
    pending = { i: 0, prompt: (el.prompt && el.prompt.value.trim()) || 'Describe this image.' };
    next();
  });

  if (el.stop) el.stop.addEventListener('click', function () {
    state.abort = true;
    if (el.runStatus) el.runStatus.textContent = '현재 단계를 마치면 멈춥니다…';
  });

  /* --- 시작 -------------------------------------------------------------- */
  drawSample();
  probe();
})();
