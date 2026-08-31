/* ==========================================================================
   LAB 6-2 — 학습 메모리 계산기
   같은 모델을 전체 파인튜닝 / LoRA / QLoRA 로 학습할 때 무엇이 얼마나
   메모리를 먹는지 네 덩어리(가중치·그래디언트·옵티마이저·활성화)로 쪼갭니다.

   근거가 되는 공개 상수
     · 혼합정밀 AdamW = 파라미터당 16바이트
       (bf16 가중치 2 + bf16 그래디언트 2 + Adam m·v fp32 8 + fp32 마스터 사본 4)
       — Rajbhandari et al., ZeRO, SC 2020.
     · NF4 + 이중 양자화 ≈ 파라미터당 4.127비트 — Dettmers et al., QLoRA, 2023.
     · 층당 활성화 = s·b·h·(34 + 5·a·s/h) 바이트, 전면 재계산 시 2·s·b·h
       — Korthikanti et al., Reducing Activation Recomputation, 2022.
   실제 값은 커널·프래그먼테이션·구현에 따라 달라집니다. 자릿수 감각용입니다.
   ========================================================================== */
(function (global) {
  'use strict';

  var GB = 1024 * 1024 * 1024;

  /* 공개 모델 계열의 언어부 형상 (비전 타워·프로젝터는 제외한 몸통 기준) */
  var MODELS = [
    { id: '2b',  label: '2B급',  note: 'Qwen2-VL-2B 계열',   P: 2.21e9,  h: 1536, L: 28, a: 12, inter: 8960 },
    { id: '4b',  label: '4B급',  note: 'InternVL2-4B 계열',  P: 4.15e9,  h: 3072, L: 32, a: 32, inter: 8192 },
    { id: '7b',  label: '7B급',  note: 'LLaVA-1.5-7B 계열',  P: 6.74e9,  h: 4096, L: 32, a: 32, inter: 11008 },
    { id: '13b', label: '13B급', note: 'LLaVA-1.5-13B 계열', P: 13.02e9, h: 5120, L: 40, a: 40, inter: 13824 }
  ];

  var PREC = {
    fp16: { bytes: 2,           label: 'fp16 · bf16' },
    int8: { bytes: 1,           label: 'int8' },
    nf4:  { bytes: 4.127 / 8,   label: '4bit (NF4)' }
  };

  var ADAM_OPT = 12;   /* m·v fp32(8) + fp32 마스터 사본(4) */
  var GRAD_B = 2;      /* bf16 그래디언트 */

  /* LoRA 학습 파라미터 수: 층마다 대상 행렬에 r(d_in + d_out)씩 붙습니다.
     (GQA로 k·v가 작아지는 부분은 무시한 근사입니다 — 자릿수는 바뀌지 않습니다.) */
  function loraParams(m, r, target) {
    var perLayer;
    if (target === 'qv') perLayer = 2 * r * (m.h + m.h);
    else if (target === 'attn') perLayer = 4 * r * (m.h + m.h);
    else perLayer = 4 * r * (m.h + m.h) + 3 * r * (m.h + m.inter);
    return perLayer * m.L;
  }

  /* 활성화 메모리 (바이트) */
  function activation(m, s, b, ckpt) {
    var perLayer = s * b * m.h * (34 + 5 * m.a * s / m.h);
    if (!ckpt) return m.L * perLayer;
    /* 전면 재계산: 층 입력만 보관(2·s·b·h) + 재계산 중인 한 층의 활성화 */
    return m.L * 2 * s * b * m.h + perLayer;
  }

  /* 한 설정의 메모리 내역 */
  function estimate(opt) {
    var m = opt.model;
    var trainable = opt.method === 'full' ? m.P : loraParams(m, opt.r, opt.target);
    var w = m.P * PREC[opt.prec].bytes;
    var g = trainable * GRAD_B;
    var o = trainable * ADAM_OPT;
    var act = activation(m, opt.seq, opt.batch, opt.ckpt);
    return {
      trainable: trainable,
      weights: w, grads: g, optim: o, act: act,
      total: w + g + o + act
    };
  }

  global.LoraMem = {
    GB: GB, MODELS: MODELS, PREC: PREC,
    loraParams: loraParams, activation: activation, estimate: estimate
  };
})(typeof window !== 'undefined' ? window : this);


/* --- UI부 ---------------------------------------------------------------- */
(function () {
  'use strict';
  if (typeof document === 'undefined') return;
  var root = document.getElementById('mm_bars');
  if (!root) return;

  var L = window.LoraMem, GB = L.GB;
  var RANKS = [4, 8, 16, 32, 64, 128];
  var SEQS = [512, 1024, 2048, 4096, 8192];
  var CARDS = [24, 48, 80];   /* 흔한 가속기 용량(GB) — 참고선 */

  var st = {
    model: L.MODELS[2], method: 'lora', prec: 'fp16',
    r: 16, target: 'all', seq: 2048, batch: 1, ckpt: true
  };

  var el = {
    cmp: document.getElementById('mm_cmp'),
    rv: document.getElementById('mm_rv'),
    seqv: document.getElementById('mm_seqv'),
    bv: document.getElementById('mm_bv'),
    train: document.getElementById('mm_train'),
    pct: document.getElementById('mm_pct'),
    total: document.getElementById('mm_total'),
    fit: document.getElementById('mm_fit'),
    note: document.getElementById('mm_note'),
    verdict: document.getElementById('mm_verdict')
  };
  var inR = document.getElementById('mm_r'),
      inSeq = document.getElementById('mm_seq'),
      inB = document.getElementById('mm_batch'),
      inCkpt = document.getElementById('mm_ckpt');

  function fmt(bytes) {
    var v = bytes / GB;
    if (v >= 100) return v.toFixed(0) + ' GB';
    if (v >= 10) return v.toFixed(1) + ' GB';
    if (v >= 1) return v.toFixed(2) + ' GB';
    return (bytes / (1024 * 1024)).toFixed(0) + ' MB';
  }
  function human(n) {
    if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
    return String(Math.round(n));
  }

  var PARTS = [
    { k: 'weights', name: '가중치',     color: 'var(--vis)' },
    { k: 'grads',   name: '그래디언트', color: 'var(--lang)' },
    { k: 'optim',   name: '옵티마이저', color: 'var(--bad)' },
    { k: 'act',     name: '활성화',     color: 'var(--tx3)' }
  ];

  /* 선택된 설정: 네 덩어리를 각각 하나의 막대로 */
  function drawParts(e) {
    var mx = Math.max(e.weights, e.grads, e.optim, e.act, 1);
    var html = '';
    PARTS.forEach(function (p) {
      var v = e[p.k], pct = Math.max(0.6, v / mx * 100);
      html += '<div class="mmrow">' +
        '<div class="mmhead"><span>' + p.name + '</span><span>' + fmt(v) + '</span></div>' +
        '<div class="mmtrack"><i style="width:' + pct.toFixed(2) + '%;background:' + p.color + '"></i></div>' +
        '</div>';
    });
    root.innerHTML = html;
  }

  /* 세 방식의 총합 비교 (스택 막대 + 가속기 용량 참고선) */
  function drawCompare() {
    if (!el.cmp) return;
    function at(method, prec) {
      return L.estimate({ model: st.model, method: method, prec: prec, r: st.r,
                          target: st.target, seq: st.seq, batch: st.batch, ckpt: st.ckpt });
    }
    var rows = [
      { name: '전체 파인튜닝',      sel: st.method === 'full',  e: at('full', 'fp16') },
      { name: 'LoRA · fp16 베이스',  sel: st.method === 'lora',  e: at('lora', 'fp16') },
      { name: 'QLoRA · 4bit 베이스', sel: st.method === 'qlora', e: at('qlora', 'nf4') }
    ];
    var mx = 0;
    rows.forEach(function (x) { mx = Math.max(mx, x.e.total); });
    var scale = Math.max(mx, CARDS[CARDS.length - 1] * GB * 0.35);

    var html = '';
    CARDS.forEach(function (c) {
      var pos = c * GB / scale * 100;
      if (pos > 99.5) return;
      html += '<span class="mmmark" style="left:' + pos.toFixed(2) + '%">' +
              '<b>' + c + 'GB</b></span>';
    });
    rows.forEach(function (x) {
      var segs = '';
      PARTS.forEach(function (p) {
        var w = x.e[p.k] / scale * 100;
        if (w <= 0.05) return;
        segs += '<i style="width:' + w.toFixed(3) + '%;background:' + p.color + '"></i>';
      });
      html += '<div class="mmrow' + (x.sel ? ' on' : '') + '">' +
        '<div class="mmhead"><span>' + x.name + '</span><span>' + fmt(x.e.total) + '</span></div>' +
        '<div class="mmtrack">' + segs + '</div></div>';
    });
    el.cmp.innerHTML = html;
  }

  function verdict(e) {
    var m = st.model;
    var actShare = e.act / e.total;
    if (st.method === 'full') {
      if (e.total > 80 * GB) {
        return m.label + ' 전체 파인튜닝은 ' + fmt(e.total) +
          ' — 가장 큰 단일 가속기(80GB)에도 들어가지 않습니다. 옵티마이저 상태만 ' +
          fmt(e.optim) + '입니다.';
      }
      return '전체 파인튜닝 ' + fmt(e.total) + ' — 그중 ' + fmt(e.optim + e.grads) +
        '가 옵티마이저와 그래디언트입니다. LoRA로 바꿔 보세요.';
    }
    if (actShare > 0.6) {
      return '이제 메모리의 ' + (actShare * 100).toFixed(0) +
        '%가 활성화입니다 — LoRA가 지운 것은 옵티마이저였지 활성화가 아닙니다. ' +
        (st.ckpt ? '시퀀스 길이를 늘려 보세요.' : '그래디언트 체크포인팅을 켜 보세요.');
    }
    if (st.method === 'qlora' && e.total < 24 * GB) {
      return '베이스를 4비트로 눕히니 ' + fmt(e.total) + ' — 24GB 카드 한 장에 들어갑니다. ' +
        '이것이 QLoRA가 판을 바꾼 지점입니다.';
    }
    return '학습 파라미터는 전체의 ' + (e.trainable / m.P * 100).toFixed(2) +
      '%뿐이고, 옵티마이저는 ' + fmt(e.optim) + '로 줄었습니다.';
  }

  function refresh() {
    var e = L.estimate({
      model: st.model, method: st.method, prec: st.prec,
      r: st.r, target: st.target, seq: st.seq, batch: st.batch, ckpt: st.ckpt
    });
    drawParts(e);
    drawCompare();

    if (el.rv) el.rv.textContent = 'r = ' + st.r;
    if (el.seqv) el.seqv.textContent = st.seq.toLocaleString() + ' 토큰';
    if (el.bv) el.bv.textContent = st.batch + '개';
    if (el.train) el.train.textContent = human(e.trainable);
    if (el.pct) {
      var pct = e.trainable / st.model.P * 100;
      el.pct.textContent = pct >= 1 ? pct.toFixed(1) + '%' : pct.toFixed(2) + '%';
      el.pct.className = pct < 5 ? 'good' : 'warn';
    }
    if (el.total) el.total.textContent = fmt(e.total);
    if (el.fit) {
      var fits = null;
      for (var i = 0; i < CARDS.length; i++) {
        if (e.total <= CARDS[i] * GB) { fits = CARDS[i]; break; }
      }
      el.fit.textContent = fits ? fits + 'GB 한 장' : '단일 카드 불가';
      el.fit.className = fits ? 'good' : 'warn';
    }
    if (el.note) {
      el.note.textContent = st.model.note + ' · h=' + st.model.h + ' · ' + st.model.L +
        '층 · 파라미터 ' + human(st.model.P) + ' · 베이스 ' + L.PREC[st.prec].label;
    }
    if (el.verdict) el.verdict.textContent = verdict(e);
  }

  /* --- 컨트롤 배선 ------------------------------------------------------ */
  function wireSeg(id, fn) {
    var btns = document.querySelectorAll('#' + id + ' button');
    Array.prototype.forEach.call(btns, function (b) {
      b.addEventListener('click', function () {
        if (b.disabled) return;
        Array.prototype.forEach.call(btns, function (x) { x.classList.remove('sel'); });
        b.classList.add('sel');
        fn(b);
        refresh();
      });
    });
    return btns;
  }

  wireSeg('mm_model', function (b) {
    var id = b.getAttribute('data-model');
    for (var i = 0; i < L.MODELS.length; i++) {
      if (L.MODELS[i].id === id) st.model = L.MODELS[i];
    }
  });
  wireSeg('mm_target', function (b) { st.target = b.getAttribute('data-target'); });

  var precBtns = wireSeg('mm_prec', function (b) { st.prec = b.getAttribute('data-prec'); });

  /* 정밀도는 방식에 종속됩니다:
     전체 파인튜닝은 fp16 고정(양자화된 가중치는 갱신할 수 없습니다),
     QLoRA는 정의상 4bit 고정. LoRA일 때만 셋 다 열립니다. */
  function syncPrec() {
    var forced = st.method === 'full' ? 'fp16' : (st.method === 'qlora' ? 'nf4' : null);
    if (forced) st.prec = forced;
    Array.prototype.forEach.call(precBtns, function (b) {
      var p = b.getAttribute('data-prec');
      b.disabled = !!forced && p !== forced;
      b.style.opacity = b.disabled ? '0.4' : '';
      b.style.cursor = b.disabled ? 'not-allowed' : 'pointer';
      b.classList.toggle('sel', p === st.prec);
    });
  }
  wireSeg('mm_method', function (b) {
    st.method = b.getAttribute('data-method');
    syncPrec();
  });

  if (inR) inR.addEventListener('input', function () {
    st.r = RANKS[parseInt(inR.value, 10)]; refresh();
  });
  if (inSeq) inSeq.addEventListener('input', function () {
    st.seq = SEQS[parseInt(inSeq.value, 10)]; refresh();
  });
  if (inB) inB.addEventListener('input', function () {
    st.batch = parseInt(inB.value, 10); refresh();
  });
  if (inCkpt) inCkpt.addEventListener('change', function () {
    st.ckpt = inCkpt.checked; refresh();
  });

  syncPrec();
  refresh();
})();
