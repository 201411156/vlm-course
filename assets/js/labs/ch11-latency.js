/* ==========================================================================
   LAB 11-1 — 지연 예산 계산기 (개념 모델)

   실측 벤치마크가 아니라 루프라인(roofline) 근사입니다. 계산은 셋뿐입니다.
     · 비전 인코딩 / 프리필 : 연산 바운드 → t = FLOPs / (peak × MFU)
     · 디코딩 한 스텝       : max( (가중치 + KV) 읽기 / 유효대역폭 , 연산시간 )
     · 총 지연              : 비전 + 프리필 + 출력토큰수 × 스텝시간

   하드웨어 값은 제조사가 공개한 데이터시트의 메모리 대역폭(GB/s)과
   dense BF16 연산량(TFLOPS)이고, 효율 계수(MFU·대역폭 이용률)는 공개적으로
   흔히 보고되는 범위의 대표값을 상수로 박아 둔 것입니다.
   절대값은 ±2배까지 틀릴 수 있습니다 — "무엇이 지배적인가"를 읽는 도구입니다.
   입력이 바뀔 때만 다시 그립니다 — 애니메이션 루프가 없으므로
   prefers-reduced-motion 환경에서도 움직이는 것이 없습니다.
   ========================================================================== */
(function () {
  'use strict';

  var barEl = document.getElementById('lat_bar');
  if (!barEl) return;
  var curveEl = document.getElementById('lat_curve');

  /* --- 프리셋 --------------------------------------------------------- */
  /* p=파라미터, L=층, d=은닉차원, kv=KV헤드, hd=헤드차원, vit=비전 인코더 크기 */
  var MODELS = [
    { name: '0.25B', p: 0.25e9, L: 30, d: 576,  kv: 3,  hd: 64,  vit: 93e6 },
    { name: '0.5B',  p: 0.5e9,  L: 24, d: 896,  kv: 2,  hd: 64,  vit: 400e6 },
    { name: '2B',    p: 2e9,    L: 28, d: 1536, kv: 2,  hd: 128, vit: 400e6 },
    { name: '7B',    p: 7e9,    L: 32, d: 4096, kv: 8,  hd: 128, vit: 400e6 },
    { name: '13B',   p: 13e9,   L: 40, d: 5120, kv: 40, hd: 128, vit: 400e6 },
    { name: '34B',   p: 34e9,   L: 48, d: 7168, kv: 8,  hd: 128, vit: 600e6 },
    { name: '72B',   p: 72e9,   L: 80, d: 8192, kv: 8,  hd: 128, vit: 600e6 }
  ];
  /* bw=메모리 대역폭 GB/s, tf=dense BF16 TFLOPS, gpc=CPU 코어당 GFLOPS, mem=GB */
  var HW = [
    { name: 'CPU · DDR5 2채널', bw: 90,   gpc: 120, mem: 32,  cpu: true },
    { name: 'CPU · DDR5 8채널', bw: 300,  gpc: 200, mem: 256, cpu: true },
    { name: 'Jetson AGX Orin',  bw: 205,  tf: 42,   mem: 64 },
    { name: 'L4 24GB',          bw: 300,  tf: 121,  mem: 24 },
    { name: 'A100 80GB',        bw: 2039, tf: 312,  mem: 80 },
    { name: 'H100 SXM 80GB',    bw: 3350, tf: 990,  mem: 80 }
  ];
  /* wb=가중치 바이트/파라미터, cmul=연산 처리량 배수(활성값까지 양자화해야 오른다) */
  var PREC = [
    { id: 'fp16',  name: 'FP16',  wb: 2,   cmul: 1.00 },
    { id: 'w8a16', name: 'W8A16', wb: 1,   cmul: 0.95 },
    { id: 'w8a8',  name: 'W8A8',  wb: 1,   cmul: 1.80 },
    { id: 'w4a16', name: 'W4A16', wb: 0.5, cmul: 0.90 }
  ];
  var VIS   = [64, 144, 256, 576, 1024, 2048, 4096];
  var OUT   = [1, 2, 4, 8, 16, 32, 64, 128, 256, 512];
  var BATCH = [1, 2, 4, 8, 16, 32];
  var CORES = [2, 4, 8, 16, 32, 64];
  var NTEXT = 64;           /* 텍스트 프롬프트 토큰 수(고정) */
  var MFU_G = 0.40, BWU_G = 0.75;   /* GPU 효율 계수 */
  var MFU_C = 0.35, BWU_C = 0.65;   /* CPU 효율 계수 */

  var st = { m: 3, p: 0, hw: 4, cores: 3, vis: 4, out: 6, batch: 0 };

  /* --- 모델 ----------------------------------------------------------- */
  function calc(o, noutOverride) {
    var m = MODELS[o.m], hw = HW[o.hw], pr = PREC[o.p];
    var B = BATCH[o.batch], nvis = VIS[o.vis];
    var nout = noutOverride || OUT[o.out];
    var Tin = nvis + NTEXT;

    var peak = hw.cpu ? CORES[o.cores] * hw.gpc * 1e9 : hw.tf * 1e12;
    var mfu = hw.cpu ? MFU_C : MFU_G;
    var bwu = hw.cpu ? BWU_C : BWU_G;
    var eff = peak * mfu;              /* 유효 연산량 FLOP/s */
    var bwe = hw.bw * 1e9 * bwu;       /* 유효 대역폭 B/s */

    /* 비전 인코딩 — 요청당 1회, 양자화 이득 없음(FP16 가정) */
    var tVis = (2 * m.vit * nvis * B) / eff;

    /* 프리필 — 입력 토큰 전체를 한 번에. 어텐션 항은 토큰 수의 제곱. */
    var fPre = (2 * m.p * Tin + 4 * m.L * Tin * Tin * m.d) * B;
    var tPre = fPre / (eff * pr.cmul);

    /* 디코딩 — 한 스텝마다 가중치 전체 + KV 캐시를 읽는다 */
    var kvTok = 2 * m.L * m.kv * m.hd * 2;          /* K,V × 층 × 헤드 × 2바이트 */
    var wBytes = m.p * pr.wb;
    var Tavg = Tin + nout / 2;
    var stepMem = (wBytes + B * Tavg * kvTok) / bwe;
    var stepCmp = (2 * m.p * B + 4 * m.L * Tavg * m.d * B) / (eff * pr.cmul);
    var tStep = Math.max(stepMem, stepCmp);
    var tDec = nout * tStep;

    var total = tVis + tPre + tDec;
    var kvMax = B * (Tin + nout) * kvTok;
    var memNeed = wBytes + kvMax + (hw.cpu ? 0.5e9 : 1.5e9);

    return {
      m: m, hw: hw, pr: pr, B: B, nvis: nvis, nout: nout, Tin: Tin,
      tVis: tVis, tPre: tPre, tDec: tDec, tStep: tStep, total: total,
      ttft: tVis + tPre + tStep,
      fps: B / total, tps: B * nout / total,
      wGB: wBytes / 1e9, kvGB: kvMax / 1e9, memGB: memNeed / 1e9,
      over: memNeed / 1e9 > hw.mem,
      memBound: stepMem >= stepCmp, kvTok: kvTok,
      peakT: peak / 1e12
    };
  }

  /* --- 포맷 ----------------------------------------------------------- */
  function ms(sec) {
    var v = sec * 1000;
    if (v < 1) return v.toFixed(2) + ' ms';
    if (v < 1000) return v.toFixed(v < 10 ? 1 : 0) + ' ms';
    return (v / 1000).toFixed(v < 10000 ? 2 : 1) + ' s';
  }
  function gb(v) { return v < 10 ? v.toFixed(2) + ' GB' : v.toFixed(1) + ' GB'; }
  function rate(v) {
    if (v >= 100) return v.toFixed(0);
    if (v >= 10) return v.toFixed(1);
    return v.toFixed(2);
  }

  /* --- 캔버스 --------------------------------------------------------- */
  function css(n) {
    return getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  }
  function fit(canvas, w, h) {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
    var c = canvas.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    return c;
  }
  function boxWidth(el) {
    var p = el.parentNode;
    var w = (p && p.clientWidth) || 340;
    return Math.max(250, Math.min(Math.floor(w), 560));
  }

  var BW = boxWidth(barEl), BH = 108, CH = 150;
  var bc = fit(barEl, BW, BH);
  var cc = curveEl ? fit(curveEl, BW, CH) : null;

  function drawBar(r) {
    var vis = css('--vis'), lang = css('--lang'), ok = css('--ok'),
        panel2 = css('--panel2'), tx3 = css('--tx3'), tx2 = css('--tx2');
    bc.clearRect(0, 0, BW, BH);
    var padL = 4, padR = 4, y = 30, h = 34;
    var w = BW - padL - padR;
    var segs = [
      { v: r.tVis, c: vis, n: '비전' },
      { v: r.tPre, c: lang, n: '프리필' },
      { v: r.tDec, c: ok, n: '디코딩' }
    ];
    bc.fillStyle = panel2;
    bc.fillRect(padL, y, w, h);

    var x = padL;
    bc.font = '11px "IBM Plex Mono", monospace';
    bc.textBaseline = 'middle';
    for (var i = 0; i < segs.length; i++) {
      var sw = (segs[i].v / r.total) * w;
      bc.fillStyle = segs[i].c;
      bc.fillRect(x, y, Math.max(sw, 0), h);
      var pct = Math.round(segs[i].v / r.total * 100);
      if (sw > 44) {
        bc.fillStyle = css('--panel');
        bc.textAlign = 'center';
        bc.fillText(pct + '%', x + sw / 2, y + h / 2);
      }
      x += sw;
    }
    /* 눈금 */
    bc.fillStyle = tx3;
    bc.textAlign = 'left';
    bc.font = '11px "IBM Plex Mono", monospace';
    bc.fillText('0', padL, y + h + 12);
    bc.textAlign = 'right';
    bc.fillText(ms(r.total), padL + w, y + h + 12);
    bc.textAlign = 'left';
    bc.fillStyle = tx2;
    bc.font = '12px "IBM Plex Sans KR", system-ui, sans-serif';
    bc.fillText('요청 1건의 지연 분해', padL, 12);
    bc.textAlign = 'right';
    bc.fillStyle = tx3;
    bc.fillText('TTFT ' + ms(r.ttft), padL + w, 12);
  }

  function drawCurve(o) {
    if (!cc) return;
    var vis = css('--vis'), lang = css('--lang'), line = css('--line'),
        tx3 = css('--tx3'), panel = css('--panel');
    cc.clearRect(0, 0, BW, CH);
    cc.fillStyle = panel; cc.fillRect(0, 0, BW, CH);

    var padL = 40, padR = 10, padT = 14, padB = 24;
    var w = BW - padL - padR, h = CH - padT - padB;
    var pts = [], i, maxY = 0;
    for (i = 0; i <= 9; i++) {
      var n = Math.pow(2, i);
      var rr = calc(o, n);
      pts.push([i, rr.total]);
      if (rr.total > maxY) maxY = rr.total;
    }
    var cur = calc(o);
    var fixed = cur.tVis + cur.tPre;
    if (maxY <= 0) maxY = 1e-6;
    function X(k) { return padL + (k / 9) * w; }
    function Y(v) { return padT + h - (v / maxY) * h; }

    /* 축 */
    cc.strokeStyle = line; cc.lineWidth = 1;
    cc.beginPath(); cc.moveTo(padL, padT); cc.lineTo(padL, padT + h);
    cc.lineTo(padL + w, padT + h); cc.stroke();

    /* 고정 비용선 */
    cc.setLineDash([3, 3]); cc.strokeStyle = lang; cc.globalAlpha = 0.8;
    cc.beginPath(); cc.moveTo(padL, Y(fixed)); cc.lineTo(padL + w, Y(fixed)); cc.stroke();
    cc.setLineDash([]); cc.globalAlpha = 1;

    /* 곡선 */
    cc.strokeStyle = vis; cc.lineWidth = 2;
    cc.beginPath();
    for (i = 0; i < pts.length; i++) {
      var px = X(pts[i][0]), py = Y(pts[i][1]);
      if (i === 0) cc.moveTo(px, py); else cc.lineTo(px, py);
    }
    cc.stroke();

    /* 현재 지점 */
    var ci = Math.round(Math.log(cur.nout) / Math.LN2);
    cc.fillStyle = vis;
    cc.beginPath(); cc.arc(X(ci), Y(cur.total), 4.5, 0, 7); cc.fill();
    cc.strokeStyle = panel; cc.lineWidth = 1.5; cc.stroke();

    /* 라벨 */
    cc.font = '10px "IBM Plex Mono", monospace';
    cc.fillStyle = tx3; cc.textAlign = 'right'; cc.textBaseline = 'middle';
    cc.fillText(ms(maxY), padL - 5, padT + 4);
    cc.fillText('0', padL - 5, padT + h);
    cc.textAlign = 'left'; cc.textBaseline = 'top';
    cc.fillText('출력 1', padL, padT + h + 6);
    cc.textAlign = 'right';
    cc.fillText('512 토큰', padL + w, padT + h + 6);
    cc.fillStyle = lang; cc.textAlign = 'left'; cc.textBaseline = 'bottom';
    cc.fillText('고정 비용(비전+프리필)', padL + 4, Y(fixed) - 3);
  }

  /* --- UI ------------------------------------------------------------- */
  var el = {};
  ['model', 'modelv', 'hw', 'hwv', 'cores', 'coresv', 'coresrow',
   'vis', 'visv', 'out', 'outv', 'batch', 'batchv',
   'ttft', 'total', 'tpot', 'fps', 'tps', 'kv', 'mem', 'verdict', 'assume'
  ].forEach(function (k) { el[k] = document.getElementById('lat_' + k); });
  var precBtns = document.querySelectorAll('#lat_prec button');

  function refresh() {
    var r = calc(st);
    var hw = HW[st.hw];

    el.modelv.textContent = MODELS[st.m].name;
    el.hwv.textContent = hw.name;
    el.visv.textContent = VIS[st.vis].toLocaleString() + '개';
    el.outv.textContent = OUT[st.out].toLocaleString() + '토큰';
    el.batchv.textContent = BATCH[st.batch] + '건';
    el.coresv.textContent = hw.cpu ? CORES[st.cores] + '코어' : '—';
    el.cores.disabled = !hw.cpu;
    el.coresrow.style.opacity = hw.cpu ? '1' : '.45';

    el.ttft.textContent = ms(r.ttft);
    el.total.textContent = ms(r.total);
    el.tpot.textContent = ms(r.tStep);
    el.fps.textContent = rate(r.fps) + ' 장/초';
    el.tps.textContent = rate(r.tps) + ' tok/s';
    el.kv.textContent = gb(r.kvGB) + ' (토큰당 ' +
      (r.kvTok / 1024).toFixed(0) + ' KB)';
    el.mem.textContent = gb(r.memGB) + ' / ' + hw.mem + ' GB';
    el.mem.className = r.over ? 'warn' : '';

    var v;
    if (r.over) {
      v = '이 조합은 장치 메모리를 넘습니다 — 가중치 ' + gb(r.wGB) +
          ' + KV 캐시 ' + gb(r.kvGB) + '. 배치를 줄이거나 비트를 더 내려야 합니다.';
    } else if (r.nout === 1) {
      v = '출력이 1토큰입니다(판정기). 디코딩은 단 한 스텝이라 지연을 정하는 것은 ' +
          '사실상 입력 쪽 — 이미지 토큰 수입니다.';
    } else if (r.tDec > 0.6 * r.total) {
      v = '디코딩이 지배합니다. 이 막대를 줄이는 방법은 두 가지뿐입니다 — ' +
          '출력 토큰을 줄이거나, 가중치 비트를 내려 메모리 읽기를 줄이거나.';
    } else if (r.tVis > 0.4 * r.total) {
      v = '비전 인코딩이 지배합니다. LLM을 4비트로 내려도 이 막대는 꿈쩍하지 않습니다 — ' +
          '이미지 토큰 예산과 인코더 체급부터 손봐야 합니다.';
    } else if (r.tPre > 0.5 * r.total) {
      v = '프리필이 지배합니다. 원인은 이미지 토큰 수이고, 가중치 전용 양자화' +
          '(W8A16 · W4A16)로는 거의 줄지 않습니다 — 활성값까지 내리거나(W8A8) 토큰을 줄이세요.';
    } else {
      v = '세 조각이 비슷하게 나뉘어 있습니다. 출력 토큰 수를 밀어 보면 균형이 어떻게 깨지는지 보입니다.';
    }
    el.verdict.textContent = v;

    el.assume.textContent =
      '가정 — 텍스트 프롬프트 ' + NTEXT + '토큰, 이미지 1장/요청, ' +
      '비전 인코더 ' + Math.round(MODELS[st.m].vit / 1e6) + 'M(FP16 고정), ' +
      'KV 캐시 FP16, 유효 연산량 ' + (r.peakT * (hw.cpu ? MFU_C : MFU_G)).toFixed(1) +
      ' TFLOPS(peak ' + r.peakT.toFixed(1) + ' × MFU ' + (hw.cpu ? MFU_C : MFU_G) + '), ' +
      '유효 대역폭 ' + Math.round(hw.bw * (hw.cpu ? BWU_C : BWU_G)) +
      ' GB/s(peak ' + hw.bw + ' × ' + (hw.cpu ? BWU_C : BWU_G) + '). ' +
      '디코딩 스텝은 ' + (r.memBound ? '메모리 대역폭' : '연산') + ' 바운드입니다.';

    drawBar(r);
    drawCurve(st);
  }

  function bindRange(node, key, arr) {
    if (!node) return;
    node.min = 0; node.max = arr.length - 1; node.step = 1;
    node.value = st[key];
    node.addEventListener('input', function () {
      st[key] = parseInt(node.value, 10);
      refresh();
    });
  }
  bindRange(el.model, 'm', MODELS);
  bindRange(el.hw, 'hw', HW);
  bindRange(el.cores, 'cores', CORES);
  bindRange(el.vis, 'vis', VIS);
  bindRange(el.out, 'out', OUT);
  bindRange(el.batch, 'batch', BATCH);

  Array.prototype.forEach.call(precBtns, function (b, i) {
    b.addEventListener('click', function () {
      Array.prototype.forEach.call(precBtns, function (x) { x.classList.remove('sel'); });
      b.classList.add('sel');
      st.p = i;
      refresh();
    });
  });

  var rt = null;
  window.addEventListener('resize', function () {
    if (rt) clearTimeout(rt);
    rt = setTimeout(function () {
      var w = boxWidth(barEl);
      if (w === BW) return;
      BW = w;
      bc = fit(barEl, BW, BH);
      if (curveEl) cc = fit(curveEl, BW, CH);
      refresh();
    }, 150);
  });

  new MutationObserver(refresh).observe(document.documentElement,
    { attributes: true, attributeFilter: ['data-theme'] });

  refresh();
})();
