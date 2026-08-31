/* ==========================================================================
   LAB 11-2 — 양자화 격자와 손실

   가중치 한 행(입력 채널 512개)을 정수 격자에 올려보는 장난감입니다.
     · 분포      : 가우시안 + "큰 가중치 이상치"(개수 소수, 크기 조절 가능)
     · 중요 채널 : 크기는 평범하지만 활성값이 커서 출력에 크게 기여하는 채널
     · 방식      : RTN(텐서 하나) / 그룹 128 / 그룹 + AWQ식 중요 채널 스케일링
   대칭 absmax 균등 양자화만 씁니다. Δ = absmax / (2^(b-1) − 1).
   AWQ 모드는 중요 채널의 가중치를 s배 키워 양자화한 뒤 다시 s로 나눕니다 —
   그 채널의 상대 오차가 s배 줄지만, 그룹의 absmax가 커지면 나머지가 조금 손해를
   봅니다. 논문이 s를 탐색으로 고르는 이유가 이 맞교환입니다.
   입력이 바뀔 때만 다시 그립니다 — 애니메이션 루프가 없으므로
   prefers-reduced-motion 환경에서도 움직이는 것이 없습니다.
   ========================================================================== */
(function () {
  'use strict';

  var mapEl = document.getElementById('qz_map');
  if (!mapEl) return;
  var errEl = document.getElementById('qz_err');

  var N = 512, G = 128;             /* 채널 수 · 그룹 크기 */
  var BITS = [2, 3, 4, 5, 6, 8];
  var SAL = [10, 55, 90, 200, 260, 410];    /* 중요 채널(활성값이 큰 채널) */
  var OUTCH = [40, 300];                    /* 큰 가중치 이상치 채널 */
  var SALIMP = 25;                          /* 중요 채널의 활성 크기 배수 */
  var SCALE = 4;                            /* AWQ식 보호 스케일 s */

  var st = { bits: 2, out: 8, mode: 'rtn' };   /* bits index 2 → 4비트 */

  /* --- 결정적 난수 --------------------------------------------------- */
  function rng(seed) {
    return function () {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  var W0 = new Float64Array(N), IMP = new Float64Array(N);
  (function build() {
    var r = rng(20261111), i;
    for (i = 0; i < N; i++) {
      var u = Math.max(r(), 1e-9), v = r();
      W0[i] = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);  /* N(0,1) */
      IMP[i] = 1;
    }
    for (i = 0; i < SAL.length; i++) IMP[SAL[i]] = SALIMP;
  })();

  function weights(outMag) {
    var w = new Float64Array(N), i;
    for (i = 0; i < N; i++) w[i] = W0[i];
    for (i = 0; i < OUTCH.length; i++) {
      w[OUTCH[i]] = (i % 2 ? -1 : 1) * outMag;
    }
    return w;
  }

  /* --- 양자화 --------------------------------------------------------- */
  function quantize(w, bits, mode) {
    var qmax = Math.pow(2, bits - 1) - 1;
    var gsz = (mode === 'rtn') ? N : G;
    var what = new Float64Array(N), code = new Int32Array(N);
    var deltas = [], used = {}, g, i;
    for (g = 0; g < N; g += gsz) {
      var end = Math.min(g + gsz, N), amax = 0, sc;
      for (i = g; i < end; i++) {
        sc = (mode === 'awq' && IMP[i] > 1) ? SCALE : 1;
        var a = Math.abs(w[i] * sc);
        if (a > amax) amax = a;
      }
      var d = amax / qmax;
      if (!(d > 0)) d = 1e-9;
      deltas.push(d);
      for (i = g; i < end; i++) {
        sc = (mode === 'awq' && IMP[i] > 1) ? SCALE : 1;
        var q = Math.round(w[i] * sc / d);
        if (q > qmax) q = qmax;
        if (q < -qmax) q = -qmax;
        code[i] = q;
        used[q] = 1;
        what[i] = q * d / sc;
      }
    }
    var se = 0, sw = 0, sww = 0, nu = 0, k;
    for (i = 0; i < N; i++) {
      var e = what[i] - w[i];
      se += e * e;
      sw += IMP[i] * IMP[i] * e * e;
      sww += IMP[i] * IMP[i] * w[i] * w[i];
    }
    for (k in used) if (Object.prototype.hasOwnProperty.call(used, k)) nu++;
    var dsum = 0;
    for (i = 0; i < deltas.length; i++) dsum += deltas[i];
    return {
      what: what, code: code,
      delta: dsum / deltas.length, deltas: deltas, gsz: gsz,
      rmse: Math.sqrt(se / N),
      werr: 100 * Math.sqrt(sw / Math.max(sww, 1e-12)),
      used: nu, levels: 2 * qmax + 1, qmax: qmax
    };
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
    return Math.max(250, Math.min(Math.floor(w), 520));
  }
  var CW = boxWidth(mapEl), MH = 210, EH = 116;
  var mc = fit(mapEl, CW, MH);
  var ec = errEl ? fit(errEl, CW, EH) : null;

  function drawMap(w, q, rng2) {
    var vis = css('--vis'), lang = css('--lang'), bad = css('--bad'),
        line = css('--line'), tx3 = css('--tx3'), panel = css('--panel');
    mc.clearRect(0, 0, CW, MH);
    mc.fillStyle = panel; mc.fillRect(0, 0, CW, MH);
    var pad = 26, w2 = CW - pad - 10, h2 = MH - pad - 22;
    function X(v) { return pad + (v / rng2 / 2 + 0.5) * w2; }
    function Y(v) { return pad + h2 - (v / rng2 / 2 + 0.5) * h2; }

    /* 첫 그룹의 격자(레벨) — 너무 촘촘하면 생략 */
    if (q.levels <= 96) {
      mc.strokeStyle = line; mc.globalAlpha = 0.75; mc.lineWidth = 1;
      for (var k = -q.qmax; k <= q.qmax; k++) {
        var yy = Y(k * q.deltas[0]);
        if (yy < pad - 1 || yy > pad + h2 + 1) continue;
        mc.beginPath(); mc.moveTo(pad, yy); mc.lineTo(pad + w2, yy); mc.stroke();
      }
      mc.globalAlpha = 1;
    }
    /* 항등선 */
    mc.strokeStyle = tx3; mc.globalAlpha = 0.6; mc.setLineDash([3, 3]);
    mc.beginPath(); mc.moveTo(X(-rng2), Y(-rng2)); mc.lineTo(X(rng2), Y(rng2)); mc.stroke();
    mc.setLineDash([]); mc.globalAlpha = 1;

    /* 점 */
    var i, isOut = {}, isSal = {};
    for (i = 0; i < OUTCH.length; i++) isOut[OUTCH[i]] = 1;
    for (i = 0; i < SAL.length; i++) isSal[SAL[i]] = 1;
    for (i = 0; i < N; i++) {
      if (isOut[i] || isSal[i]) continue;
      mc.fillStyle = vis; mc.globalAlpha = 0.45;
      mc.fillRect(X(w[i]) - 1.2, Y(q.what[i]) - 1.2, 2.4, 2.4);
    }
    mc.globalAlpha = 1;
    for (i = 0; i < SAL.length; i++) {
      mc.fillStyle = lang;
      mc.beginPath(); mc.arc(X(w[SAL[i]]), Y(q.what[SAL[i]]), 3.4, 0, 7); mc.fill();
    }
    for (i = 0; i < OUTCH.length; i++) {
      mc.fillStyle = bad;
      mc.beginPath(); mc.arc(X(w[OUTCH[i]]), Y(q.what[OUTCH[i]]), 3.8, 0, 7); mc.fill();
    }
    /* 축 */
    mc.strokeStyle = line; mc.lineWidth = 1;
    mc.strokeRect(pad + 0.5, pad + 0.5, w2, h2);
    mc.font = '10px "IBM Plex Mono", monospace';
    mc.fillStyle = tx3; mc.textAlign = 'left'; mc.textBaseline = 'top';
    mc.fillText('양자화 후 ŵ', 4, 6);
    mc.textAlign = 'right'; mc.textBaseline = 'bottom';
    mc.fillText('원래 가중치 w →', CW - 8, MH - 4);
  }

  function drawErr(all, mode, gmax) {
    if (!ec) return;
    var vis = css('--vis'), lang = css('--lang'), bad = css('--bad'),
        line = css('--line'), tx3 = css('--tx3'), panel = css('--panel');
    ec.clearRect(0, 0, CW, EH);
    ec.fillStyle = panel; ec.fillRect(0, 0, CW, EH);
    var pad = 26, w2 = CW - pad - 10, h2 = EH - 16 - 18;
    var q = all[mode], i, isOut = {}, isSal = {};
    for (i = 0; i < OUTCH.length; i++) isOut[OUTCH[i]] = 1;
    for (i = 0; i < SAL.length; i++) isSal[SAL[i]] = 1;
    var bw = w2 / G;
    for (i = 0; i < G; i++) {
      var e = Math.abs(q.what[i] - q.w[i]) * IMP[i];
      var hh = Math.min(1, e / gmax) * h2;
      ec.fillStyle = isOut[i] ? bad : (isSal[i] ? lang : vis);
      ec.globalAlpha = isOut[i] || isSal[i] ? 1 : 0.55;
      ec.fillRect(pad + i * bw, 16 + h2 - hh, Math.max(bw - 0.6, 1), hh);
    }
    ec.globalAlpha = 1;
    ec.strokeStyle = line; ec.lineWidth = 1;
    ec.beginPath(); ec.moveTo(pad, 16 + h2 + 0.5); ec.lineTo(pad + w2, 16 + h2 + 0.5); ec.stroke();
    ec.font = '10px "IBM Plex Mono", monospace';
    ec.fillStyle = tx3; ec.textAlign = 'left'; ec.textBaseline = 'top';
    ec.fillText('출력 기여 오차 |Δw|×활성', 4, 3);
    ec.textAlign = 'left'; ec.textBaseline = 'bottom';
    ec.fillText('채널 0', pad, EH - 3);
    ec.textAlign = 'right';
    ec.fillText('127 (그룹 하나)', pad + w2, EH - 3);
  }

  /* --- UI ------------------------------------------------------------- */
  var el = {};
  ['bits', 'bitsv', 'out', 'outv', 'delta', 'used', 'rmse',
   'cmp', 'verdict'].forEach(function (k) {
    el[k] = document.getElementById('qz_' + k);
  });
  var modeBtns = document.querySelectorAll('#qz_mode button');

  function refresh() {
    var bits = BITS[st.bits], outMag = st.out;
    var w = weights(outMag);
    var all = {
      rtn: quantize(w, bits, 'rtn'),
      group: quantize(w, bits, 'group'),
      awq: quantize(w, bits, 'awq')
    };
    all.rtn.w = w; all.group.w = w; all.awq.w = w;
    var q = all[st.mode];

    var gmax = 0, m, i;
    for (m in all) {
      if (!Object.prototype.hasOwnProperty.call(all, m)) continue;
      for (i = 0; i < G; i++) {
        var e = Math.abs(all[m].what[i] - w[i]) * IMP[i];
        if (e > gmax) gmax = e;
      }
    }
    if (!(gmax > 0)) gmax = 1;

    var rng2 = Math.max(3.2, outMag * 1.08);
    drawMap(w, q, rng2);
    drawErr(all, st.mode, gmax);

    el.bitsv.textContent = bits + '비트';
    el.outv.textContent = outMag === 0 ? '없음' : '±' + outMag + 'σ';
    el.delta.textContent = q.delta.toFixed(3);
    el.used.textContent = q.used + ' / ' + q.levels;
    el.rmse.textContent = q.rmse.toFixed(3);
    el.cmp.innerHTML =
      row('RTN · 텐서 하나', all.rtn.werr, st.mode === 'rtn') +
      row('그룹 128', all.group.werr, st.mode === 'group') +
      row('그룹 + AWQ식 스케일', all.awq.werr, st.mode === 'awq');

    var v;
    if (outMag >= 6 && st.mode === 'rtn') {
      v = '이상치 하나가 텐서 전체의 격자 간격을 정하고 있습니다 — 레벨 ' + q.levels +
          '개 중 실제로 쓰이는 것은 ' + q.used + '개뿐입니다. 나머지 가중치는 몇 칸 안에 뭉개집니다.';
    } else if (outMag >= 6 && st.mode === 'group') {
      v = '그룹을 나누자 피해가 이상치가 든 그룹 안으로 격리되었습니다. 같은 비트 수인데 ' +
          '오차가 줄어드는 이유가 이것입니다 — 실무에서 g=128이 사실상 기본값인 이유이기도 합니다.';
    } else if (st.mode === 'awq' && bits <= 3) {
      v = '비트가 이렇게 낮으면 보호의 대가가 이득을 넘어섭니다 — 중요 채널을 키운 만큼 ' +
          '그룹 absmax가 커지고, 그 몇 칸 안 되는 격자가 더 성겨집니다. ' +
          'AWQ가 그룹 단위 4비트를 표준 설정으로 두는 이유입니다.';
    } else if (st.mode === 'awq') {
      v = '호박색 = 중요 채널(활성값이 큰 채널)입니다. 스케일링으로 이들의 오차가 눌렸지만, ' +
          '그룹 absmax가 커진 만큼 나머지 채널은 조금 손해를 봅니다. 이 맞교환이 AWQ가 s를 탐색으로 고르는 이유입니다.';
    } else if (bits <= 3) {
      v = bits + '비트에서는 격자가 ' + q.levels + '칸뿐입니다. 이상치를 없애도 분포 자체가 계단으로 뭉개집니다 — ' +
          '보정 없는 반올림(RTN)이 3비트 이하에서 무너지는 지점입니다.';
    } else {
      v = '이상치 크기를 올려 보세요. 가중치는 그대로인데 격자만 성겨지면서 오차가 어떻게 커지는지 보입니다.';
    }
    el.verdict.textContent = v;
  }

  function row(name, v, on) {
    var pct = Math.min(100, v);
    return '<div style="margin:6px 0' + (on ? ';color:var(--tx)' : '') + '">' +
      '<div style="display:flex;justify-content:space-between;font-size:12px;' +
      'font-family:\'IBM Plex Mono\',monospace">' +
      '<span>' + (on ? '▸ ' : '　') + name + '</span><span>' + v.toFixed(1) + '%</span></div>' +
      '<div style="height:6px;border-radius:3px;background:var(--panel);margin-top:3px;' +
      'overflow:hidden"><i style="display:block;height:100%;width:' + pct + '%;' +
      'background:var(--' + (on ? 'lang' : 'vis') + ');opacity:' + (on ? 1 : 0.5) +
      '"></i></div></div>';
  }

  if (el.bits) {
    el.bits.min = 0; el.bits.max = BITS.length - 1; el.bits.step = 1;
    el.bits.value = st.bits;
    el.bits.addEventListener('input', function () {
      st.bits = parseInt(el.bits.value, 10); refresh();
    });
  }
  if (el.out) {
    el.out.addEventListener('input', function () {
      st.out = parseInt(el.out.value, 10); refresh();
    });
  }
  Array.prototype.forEach.call(modeBtns, function (b) {
    b.addEventListener('click', function () {
      Array.prototype.forEach.call(modeBtns, function (x) { x.classList.remove('sel'); });
      b.classList.add('sel');
      st.mode = b.getAttribute('data-mode');
      refresh();
    });
  });

  var rt = null;
  window.addEventListener('resize', function () {
    if (rt) clearTimeout(rt);
    rt = setTimeout(function () {
      var w = boxWidth(mapEl);
      if (w === CW) return;
      CW = w;
      mc = fit(mapEl, CW, MH);
      if (errEl) ec = fit(errEl, CW, EH);
      refresh();
    }, 150);
  });

  new MutationObserver(refresh).observe(document.documentElement,
    { attributes: true, attributeFilter: ['data-theme'] });

  refresh();
})();
