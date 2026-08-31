/* ==========================================================================
   LAB 10-1 — 아키텍처 조립 보드
   텍스트 판정기를 멀티모달 판정기로 바꿀 때의 블록 선택(비전 인코더 ·
   프로젝터 · 언어부 백본 · 적응 방식 · 판정 출력)을 클릭으로 조립하고,
   그 조합의 학습 파라미터 · 메모리 · 필요한 데이터 · 리스크를 즉시 계산합니다.

   수치에 대하여
     · 파라미터는 공개 모델의 대략적인 체급을 넣은 어림값(단위: M = 100만).
     · VRAM은 bf16 가중치(2B/param) + 학습 대상의 옵티마이저 상태 포함
       16B/param + 활성값 상수항으로 잡은 장난감 추정입니다.
     · 목적은 절대 수치가 아니라 선택 사이의 비율을 손에 쥐는 것.
   외부 의존 없음. 실제 모델을 부르지 않는다.
   ========================================================================== */
(function () {
  'use strict';

  var boardEl = document.getElementById('b_board');
  if (!boardEl) return;

  /* --- 블록 정의 --------------------------------------------------------- */
  var VISION = {
    none:  { label: '없음 · 텍스트 전용', total: 0,   train: 0,   dv: 0,    tok: 0 },
    clip:  { label: 'CLIP ViT-L/14 · 동결', total: 304, train: 0, dv: 1024, tok: 576 },
    sig:   { label: 'SigLIP-SO400M · 동결', total: 428, train: 0, dv: 1152, tok: 729 },
    sigun: { label: 'SigLIP-SO400M · 상위 블록 해동', total: 428, train: 107, dv: 1152, tok: 729 },
    native:{ label: 'VLM 내장 인코더 · 동결', total: 400, train: 0, dv: 1152, tok: 729, vlmOnly: true }
  };
  var PROJ = {
    none:  { label: '없음', kind: 'none' },
    lin:   { label: 'Linear (dᵥ → dℓ)', kind: 'new', shrink: 1 },
    mlp:   { label: '2층 MLP', kind: 'new', shrink: 1 },
    ps:    { label: 'pixel-shuffle + MLP', kind: 'new', shrink: 4 },
    native:{ label: '내장 프로젝터 · 정렬 완료', kind: 'native', shrink: 1, vlmOnly: true }
  };
  var LLM = {
    text3: { label: '텍스트 전용 LLM 3B', total: 3090, dl: 2048, vlm: false },
    vlm3:  { label: '사전 정렬 VLM 3B', total: 3090, dl: 2048, vlm: true },
    vlm05: { label: '소형 VLM 0.5B', total: 494, dl: 896, vlm: true }
  };
  var ADAPT = {
    frozen: { label: '전부 동결' },
    lora:   { label: 'LoRA r=16' },
    full:   { label: '전체 파인튜닝' }
  };
  var HEAD = {
    gen: { label: '자유 생성 + 파싱' },
    con: { label: '제약 채점 (9장)' }
  };

  var COLS = [
    { key: 'vision', title: '비전 인코더', map: VISION },
    { key: 'proj',   title: '프로젝터',    map: PROJ },
    { key: 'llm',    title: '언어부 백본', map: LLM },
    { key: 'adapt',  title: '적응 방식',   map: ADAPT },
    { key: 'head',   title: '판정 출력',   map: HEAD }
  ];

  var PRESETS = {
    reuse:    { vision: 'sig',    proj: 'mlp',    llm: 'text3', adapt: 'lora',   head: 'con' },
    vlmbase:  { vision: 'native', proj: 'native', llm: 'vlm3',  adapt: 'lora',   head: 'con' },
    small:    { vision: 'native', proj: 'native', llm: 'vlm05', adapt: 'full',   head: 'con' },
    textonly: { vision: 'none',   proj: 'none',   llm: 'text3', adapt: 'lora',   head: 'con' }
  };

  var sel = {};
  (function () { for (var k in PRESETS.reuse) sel[k] = PRESETS.reuse[k]; })();

  /* --- 보드 그리기 -------------------------------------------------------- */
  var buttons = {};
  (function buildBoard() {
    COLS.forEach(function (col) {
      var box = document.createElement('div');
      box.className = 'col';
      var h = document.createElement('h4');
      h.textContent = col.title;
      box.appendChild(h);
      buttons[col.key] = [];
      Object.keys(col.map).forEach(function (id) {
        var b = document.createElement('button');
        b.type = 'button';
        b.textContent = col.map[id].label;
        b.setAttribute('data-id', id);
        b.setAttribute('aria-pressed', 'false');
        b.addEventListener('click', function () {
          sel[col.key] = id;
          render();
        });
        box.appendChild(b);
        buttons[col.key].push(b);
      });
      boardEl.appendChild(box);
    });
  })();

  /* --- 계산 --------------------------------------------------------------- */
  function fmt(m) {
    if (m <= 0) return '0';
    if (m >= 1000) return (m / 1000).toFixed(2) + 'B';
    if (m < 1) return m.toFixed(2) + 'M';
    if (m < 10) return m.toFixed(1) + 'M';
    return Math.round(m) + 'M';
  }

  function compute() {
    var v = VISION[sel.vision], p = PROJ[sel.proj], l = LLM[sel.llm];
    var hasVision = sel.vision !== 'none';
    var dv = v.dv, dl = l.dl;

    /* 프로젝터 파라미터(M) */
    var projP = 0;
    if (p.kind === 'new') {
      if (sel.proj === 'lin') projP = dv * dl / 1e6;
      else if (sel.proj === 'mlp') projP = (dv * dl + dl * dl) / 1e6;
      else if (sel.proj === 'ps') projP = (4 * dv * dl + dl * dl) / 1e6;
    } else if (p.kind === 'native') {
      projP = (dv * dl + dl * dl) / 1e6;
    }
    /* 다리가 이어지지 않으면 프로젝터는 존재해도 무의미하다 — 세지 않는다 */
    var bridged = hasVision && p.kind !== 'none';
    if (!bridged) projP = 0;

    /* 학습 대상 */
    var trVision = hasVision ? v.train : 0;
    var trProj = 0;
    if (p.kind === 'new') trProj = projP;                       /* 새 다리는 항상 학습 */
    else if (p.kind === 'native' && sel.adapt === 'full') trProj = projP;
    var trLLM = 0;
    if (sel.adapt === 'lora') trLLM = Math.round(l.total * 0.0097 * 10) / 10;
    else if (sel.adapt === 'full') trLLM = l.total;

    var total = (hasVision ? v.total : 0) + projP + l.total;
    var train = trVision + trProj + trLLM;
    var frozen = Math.max(0, total - train);

    /* 시각 토큰 */
    var tok = bridged ? Math.round(v.tok / (p.shrink || 1)) : 0;

    /* VRAM(GB) — 파라미터당 바이트 + 활성값 상수항 */
    var vram = (frozen * 2 + train * 16) / 1000;
    vram += tok > 0 ? 0.6 + (tok / 729) * 0.9 : 0.4;

    /* 학습 단계 */
    var stage;
    if (train === 0) stage = '0단계 · zero-shot';
    else if (p.kind === 'new' && bridged) stage = '2단계 (정렬 → 판정)';
    else stage = '1단계 (판정만)';

    return {
      v: v, p: p, l: l, hasVision: hasVision, bridged: bridged,
      projP: projP, total: total, train: train, frozen: frozen,
      tok: tok, vram: vram, stage: stage,
      trVision: trVision, trProj: trProj, trLLM: trLLM
    };
  }

  /* --- 필요한 데이터 ------------------------------------------------------ */
  function dataNeeds(c) {
    var out = [];
    if (c.p.kind === 'new' && c.bridged) {
      out.push(['warn', '<b>이미지-설명 쌍</b> — 1단계 정렬용. 판정 라벨로는 대체할 수 없습니다.']);
    }
    if (c.hasVision) {
      out.push(['info', '<b>판정 SFT</b> — 이미지 + 메타 + 라벨. 크롭 규격을 서빙과 통일해야 합니다.']);
      out.push(['info', '<b>결측 샘플용 텍스트 전용 프롬프트</b> — 서빙 폴백과 같은 형태로.']);
    } else {
      out.push(['info', '<b>판정 SFT</b> — 메타 + 라벨. 기존 텍스트 데이터를 그대로 씁니다.']);
    }
    if (sel.adapt !== 'frozen') {
      out.push(['info', '<b>기존 텍스트 판정 데이터 리플레이</b> — LLM을 열면 텍스트 능력이 회귀합니다.']);
    }
    if (sel.vision === 'sigun') {
      out.push(['warn', '<b>도메인 이미지 대량</b> — 인코더를 해동하면 소량 데이터로는 오히려 망가집니다.']);
    }
    if (sel.head === 'con') {
      out.push(['info', '<b>운용점 보정용 검증셋</b> — 후보 토큰의 점수 분포로 임계를 잡습니다(9장).']);
    }
    return out;
  }

  /* --- 리스크 메모 -------------------------------------------------------- */
  function notes(c) {
    var out = [];
    var vlmBase = c.l.vlm;

    /* 치명적 조합 */
    if (c.hasVision && c.p.kind === 'none') {
      out.push(['err', '<b>이미지 경로가 끊겼습니다.</b> 시각 특징을 언어 임베딩 공간으로 옮길 다리가 없습니다 — 인코더는 돌지만 LLM은 아무것도 받지 못합니다.']);
    }
    if (!c.hasVision && c.p.kind !== 'none') {
      out.push(['err', '<b>프로젝터에 들어올 입력이 없습니다.</b> 비전 인코더를 먼저 고르세요.']);
    }
    if ((sel.vision === 'native' || sel.proj === 'native') && !vlmBase) {
      out.push(['err', '<b>내장 블록은 VLM 베이스에만 딸려 옵니다.</b> 텍스트 전용 LLM에는 내장 인코더도 내장 프로젝터도 존재하지 않습니다 — 직접 붙여야 합니다.']);
    }
    if (vlmBase && c.hasVision && sel.vision !== 'native') {
      out.push(['warn', '사전 정렬된 VLM에 <b>외부 인코더를 새로 붙였습니다</b> — 이미 맞춰진 시각 경로를 버리는 셈입니다.']);
    }
    if (vlmBase && c.p.kind === 'new') {
      out.push(['warn', '이미 정렬된 다리를 두고 <b>새 다리를 놓았습니다</b> — 1단계 정렬을 처음부터 다시 치러야 합니다. VLM 베이스를 고른 이유가 사라집니다.']);
    }

    /* 학습 계획 */
    if (c.train === 0) {
      out.push(['warn', '<b>학습 파라미터가 0입니다</b> — zero-shot 판정입니다. 베이스라인으로는 훌륭하지만 도메인의 판정 규칙은 배우지 못합니다(8장).']);
    } else if (sel.adapt === 'frozen' && c.p.kind === 'new' && c.bridged) {
      out.push(['warn', '<b>프로젝터만 학습합니다 = 1단계에서 멈춘 상태</b>입니다. 좌표계는 맞았지만 판정 규칙은 아직 없습니다.']);
    }
    if (!c.hasVision) {
      out.push(['warn', '<b>이미지를 전혀 보지 않습니다</b> — 전환 전, 현행 텍스트 판정기 상태입니다. 1절의 천장이 그대로 남습니다.']);
    }
    if (sel.adapt === 'full' && c.l.total >= 1500) {
      out.push(['warn', '<b>3B급 전체 파인튜닝</b>은 옵티마이저 상태만으로 수십 GB입니다. 같은 데이터로 LoRA와 비교해 이득이 실제로 있는지 먼저 확인하세요(6장).']);
    }
    if (sel.adapt === 'full' && c.l.total < 1500) {
      out.push(['info', '작은 모델의 전체 파인튜닝은 어댑터 없이 구조가 단순하고, 출력 공간이 좁은 판정 과제에 잘 맞습니다(12장).']);
    }
    if (sel.vision === 'sigun') {
      out.push(['warn', '<b>인코더 해동은 최후 수단</b>입니다(4절 2′). 낮은 학습률로 상위 블록만, 그리고 일반 이미지 성능이 무너지지 않는지 함께 확인해야 합니다.']);
    }

    /* 다리의 성격 */
    if (sel.proj === 'lin' && c.bridged) {
      out.push(['info', '선형 다리는 표현력에 한계가 있습니다(2장 LAB 2-1). 2층 MLP가 사실상 기본값입니다.']);
    }
    if (sel.proj === 'ps' && c.bridged) {
      out.push(['info', '시각 토큰이 ¼로 줄어 지연에 유리합니다 — 대신 작은 글자와 미세 질감 단서도 함께 줄어듭니다.']);
    }

    /* 출력 */
    if (sel.head === 'gen') {
      out.push(['warn', '자유 생성은 <b>포맷 이탈과 파싱 실패</b>가 운용 중 조용히 쌓입니다. 게다가 연속 점수가 없어 운용점 고정 비교(5-2)를 할 수 없습니다.']);
    } else {
      out.push(['good', '제약 채점이라 <b>연속 점수</b>가 나옵니다 — 같은 오탐율 지점에서 A/B를 비교할 수 있습니다(5-2, 9장).']);
    }

    /* 전환 공통 */
    if (c.hasVision && c.bridged) {
      out.push(['info', '이미지를 <b>붙였다</b>는 것과 모델이 이미지를 <b>본다</b>는 것은 다릅니다. 가림·교체 어블레이션을 평가 계획에 미리 넣어 두세요(7절).']);
    }
    return out;
  }

  /* --- 파이프라인 스트립 --------------------------------------------------- */
  function pipe(c) {
    var blocks = [];
    blocks.push({ k: 'INPUT', t: c.hasVision ? '크롭 이미지 + 메타' : '메타 텍스트만',
                  train: false, off: false, pill: null });
    blocks.push({ k: 'VISION', t: c.v.label, off: !c.hasVision,
                  train: c.trVision > 0,
                  pill: c.hasVision ? (c.trVision > 0 ? '학습 ' + fmt(c.trVision) : '동결') : null });
    blocks.push({ k: 'PROJECTOR', t: c.p.label, off: !c.bridged,
                  train: c.trProj > 0,
                  pill: !c.bridged ? null : (c.trProj > 0 ? '학습 ' + fmt(c.trProj) : '동결') });
    blocks.push({ k: 'LLM', t: c.l.label, off: false, train: c.trLLM > 0,
                  pill: c.trLLM > 0 ? '학습 ' + fmt(c.trLLM) : '동결' });
    blocks.push({ k: 'VERDICT', t: HEAD[sel.head].label, off: false, train: false, pill: null });

    return blocks.map(function (b) {
      var cls = 'blk' + (b.train ? ' train' : '') + (b.off ? ' off' : '');
      return '<div class="' + cls + '"><span class="k">' + b.k + '</span>' + b.t +
        (b.pill ? '<span class="pill' + (b.train ? ' t' : '') + '">' + b.pill + '</span>' : '') +
        '</div>';
    }).join('');
  }

  /* --- 렌더 --------------------------------------------------------------- */
  var el = {
    pipe: document.getElementById('b_pipe'),
    train: document.getElementById('b_train'),
    total: document.getElementById('b_total'),
    vram: document.getElementById('b_vram'),
    tok: document.getElementById('b_tok'),
    stage: document.getElementById('b_stage'),
    data: document.getElementById('b_data'),
    notes: document.getElementById('b_notes')
  };

  function list(items) {
    return items.map(function (it) {
      return '<li class="' + it[0] + '">' + it[1] + '</li>';
    }).join('');
  }

  function render() {
    COLS.forEach(function (col) {
      buttons[col.key].forEach(function (b) {
        var on = b.getAttribute('data-id') === sel[col.key];
        b.classList.toggle('sel', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
    });

    var c = compute();
    if (el.pipe) el.pipe.innerHTML = pipe(c);
    if (el.train) {
      el.train.textContent = fmt(c.train) +
        (c.total > 0 ? ' (' + (c.train / c.total * 100).toFixed(1) + '%)' : '');
    }
    if (el.total) el.total.textContent = fmt(c.total);
    if (el.vram) el.vram.textContent = '~' + c.vram.toFixed(1) + ' GB';
    if (el.tok) el.tok.textContent = c.tok > 0 ? c.tok.toLocaleString() + '개' : '없음';
    if (el.stage) el.stage.textContent = c.stage;
    if (el.data) el.data.innerHTML = list(dataNeeds(c));
    if (el.notes) el.notes.innerHTML = list(notes(c));
  }

  Array.prototype.forEach.call(
    document.querySelectorAll('#b_preset button[data-preset]'),
    function (b) {
      b.addEventListener('click', function () {
        var p = PRESETS[b.getAttribute('data-preset')];
        if (!p) return;
        for (var k in p) sel[k] = p[k];
        render();
      });
    }
  );

  render();
})();
