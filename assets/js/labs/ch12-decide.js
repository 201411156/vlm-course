/* ==========================================================================
   LAB 12-2 — 전략 결정 트리

   다섯 가지 질문(태스크 폭 · 지연 예산 · 데이터량 · 하드웨어 · 출력 형식)에
   답하면 네 가지 전략에 점수를 매겨 하나를 권합니다. 점수표는 이 장의 본문에서
   설명한 근거를 그대로 숫자로 옮긴 것입니다 — 어디에서 몇 점이 왔는지 전부
   화면에 적어 두었으니, 동의하지 않는 줄이 있으면 그 줄이 곧 토론거리입니다.

   "어떤 모델"이 아니라 "어떤 전략"을 답합니다. 모델 순위는 반년이면 갈리지만
   전략을 고르는 축은 그보다 오래 갑니다.
   ========================================================================== */
(function () {
  'use strict';

  var host = document.getElementById('dt_q');
  if (!host) return;

  var STRATS = [
    { id: 'A', name: '소형 full-FT', sub: '0.25~2B급을 전체 파라미터로 학습',
      next: '베이스 소형 모델 2~3개를 같은 데이터로 각각 full-FT해 보고, 운용 지점의 오탐/미탐으로 고르세요. 학습 메모리는 대략 파라미터당 16바이트입니다.' },
    { id: 'B', name: '중형 LoRA', sub: '2~8B급에 저랭크 어댑터만 학습',
      next: '베이스 능력을 지키면서 도메인만 얹는 경로입니다. 어댑터를 태스크별로 갈아 끼울 수 있다는 점도 함께 활용하세요(6장).' },
    { id: 'C', name: '대형 제로샷 · 프롬프트', sub: '큰 모델을 그대로 쓰고 프롬프트로만 맞춤',
      next: '먼저 이 경로로 상한을 재는 것이 언제나 첫 단계입니다. 여기서 안 되는 태스크는 작은 모델로도 안 되는 경우가 많습니다(5장·8장).' },
    { id: 'D', name: '대형 → 소형 증류', sub: '큰 모델로 라벨을 만들고 소형을 학습',
      next: '교사 라벨의 오류율이 학생의 상한입니다. 사람이 검수한 오라클 셋을 200~500장 따로 떼어 두고, 거기서 교사와 학생을 함께 재세요.' }
  ];

  var QS = [
    { id: 'width', q: '① 태스크 폭 — 모델이 답해야 하는 질문의 범위는?',
      opts: [
        { v: 'one', t: '고정 판정 1종', s: { A: 3, B: 1, C: -1, D: 2 },
          why: '분포가 좁을수록 작은 용량으로도 덮입니다 — 소형 특화의 전제.' },
        { v: 'few', t: '정형 3~5종', s: { A: 1, B: 3, C: 0, D: 1 },
          why: '태스크가 몇 갈래로 갈리면 베이스의 일반 능력이 조금 필요해집니다.' },
        { v: 'open', t: '열린 질문', s: { A: -2, B: 1, C: 3, D: -1 },
          why: '무엇을 물어볼지 모른다면 세계 지식과 지시 따르기가 필요합니다 — 소형이 가장 약한 지점.' }
      ] },
    { id: 'lat', q: '② 지연 예산 — 한 장을 판정하는 데 허용되는 시간은?',
      opts: [
        { v: 'tight', t: '100ms 미만', s: { A: 3, B: 0, C: -3, D: 2 },
          why: '디코딩은 가중치 바이트 ÷ 대역폭이 하한입니다. 파라미터를 줄이는 것 말고 방법이 없습니다.' },
        { v: 'mid', t: '1초 안팎', s: { A: 1, B: 2, C: 0, D: 1 },
          why: '중형까지는 들어옵니다. 양자화와 배치로 조정할 여지가 있습니다(11장).' },
        { v: 'loose', t: '수 초 허용', s: { A: 0, B: 1, C: 2, D: 0 },
          why: '지연이 제약이 아니면 큰 모델을 배제할 이유가 사라집니다.' }
      ] },
    { id: 'data', q: '③ 라벨 데이터 — 지금 만들 수 있는 학습 라벨은?',
      opts: [
        { v: 'none', t: '거의 없음', s: { A: -3, B: -1, C: 3, D: 3 },
          why: '학습 경로의 전제가 없습니다. 라벨을 만드는 일부터가 프로젝트입니다.' },
        { v: 'some', t: '수백~수천 장', s: { A: 2, B: 2, C: 0, D: 1 },
          why: '소형 full-FT와 LoRA 둘 다 사정권입니다. 이 구간에서는 데이터 품질이 모델 선택보다 크게 작용합니다.' },
        { v: 'many', t: '수만 장 이상', s: { A: 3, B: 2, C: -1, D: 0 },
          why: '데이터가 많을수록 전체 파라미터를 열어 얻는 이득이 커집니다. 제로샷은 이 데이터를 버리는 선택입니다.' }
      ] },
    { id: 'hw', q: '④ 하드웨어 — 추론이 실제로 도는 곳은?',
      opts: [
        { v: 'edge', t: '엣지 · CPU · 브라우저', s: { A: 3, B: -1, C: -3, D: 2 },
          why: '가중치가 메모리에 들어가야 시작이라도 합니다. 브라우저 탭은 수백 MB급입니다.' },
        { v: 'one', t: '단일 GPU 16~24GB', s: { A: 2, B: 2, C: -1, D: 1 },
          why: '중형 LoRA 학습과 소형 full-FT가 모두 한 장에 들어가는 구간입니다.' },
        { v: 'server', t: '서버 다GPU · API', s: { A: 0, B: 1, C: 3, D: 0 },
          why: '체급 제약이 사라집니다. 남는 제약은 비용과 지연뿐입니다.' }
      ] },
    { id: 'out', q: '⑤ 출력 형식 — 모델이 뱉어야 하는 것은?',
      opts: [
        { v: 'schema', t: '고정 스키마', s: { A: 3, B: 1, C: -1, D: 2 },
          why: '라벨·JSON·좌표처럼 형식이 닫혀 있으면 학습으로 고정하기 쉽고, 채점도 확률로 할 수 있습니다(9장).' },
        { v: 'short', t: '짧은 문장', s: { A: 1, B: 2, C: 1, D: 1 },
          why: '형식은 느슨하지만 길이가 짧아 지연 부담이 작습니다.' },
        { v: 'long', t: '긴 설명 · 추론', s: { A: -2, B: 1, C: 3, D: -1 },
          why: '긴 생성은 소형이 가장 자주 무너지는 지점입니다 — 문장이 길어질수록 사실이 흐려집니다.' }
      ] }
  ];

  var pick = { width: 'one', lat: 'mid', data: 'some', hw: 'one', out: 'schema' };

  /* --- 질문 렌더 --------------------------------------------------------- */
  function renderQs() {
    var h = '';
    QS.forEach(function (q) {
      h += '<div class="dq"><label>' + q.q + '</label><div class="seg" data-q="' + q.id + '">';
      q.opts.forEach(function (o) {
        h += '<button type="button" data-v="' + o.v + '"' +
             (pick[q.id] === o.v ? ' class="sel"' : '') + '>' + o.t + '</button>';
      });
      h += '</div></div>';
    });
    host.innerHTML = h;
    Array.prototype.forEach.call(host.querySelectorAll('.seg'), function (seg) {
      var qid = seg.getAttribute('data-q');
      Array.prototype.forEach.call(seg.querySelectorAll('button'), function (b) {
        b.addEventListener('click', function () {
          Array.prototype.forEach.call(seg.querySelectorAll('button'), function (x) {
            x.classList.remove('sel');
          });
          b.classList.add('sel');
          pick[qid] = b.getAttribute('data-v');
          renderOut();
        });
      });
    });
  }

  function chosen(q) {
    for (var i = 0; i < q.opts.length; i++) if (q.opts[i].v === pick[q.id]) return q.opts[i];
    return q.opts[0];
  }

  /* --- 경고: 답들끼리 부딪히는 조합 -------------------------------------- */
  function warnings(top) {
    var w = [];
    if (pick.data === 'none' && top === 'A') {
      w.push('라벨이 거의 없는데 full-FT가 1위입니다 — 전제가 빠졌습니다. 먼저 대형으로 라벨을 만드는 <b>증류 경로</b>를 한 단계 거치세요.');
    }
    if (pick.hw === 'edge' && top === 'C') {
      w.push('엣지에 대형 모델은 올라가지 않습니다. 하드웨어를 올리거나, 정확도를 조금 내주고 소형으로 내려오거나 — 둘 중 하나를 골라야 합니다.');
    }
    if (pick.lat === 'tight' && top === 'C') {
      w.push('100ms 예산과 대형 모델은 양립하기 어렵습니다. 디코딩 하한이 가중치 바이트 ÷ 대역폭이라는 점을 먼저 계산해 보세요(LAB 12-1).');
    }
    if (pick.width === 'open' && (top === 'A' || top === 'D')) {
      w.push('열린 질문에 특화 소형 모델은 위험합니다 — 학습 분포를 벗어난 입력에서 <b>조용히</b> 틀립니다.');
    }
    if (pick.data === 'many' && top === 'C') {
      w.push('수만 장의 라벨을 쓰지 않고 있습니다. 그 데이터가 있다면 학습 경로가 거의 항상 이깁니다.');
    }
    if (pick.out === 'schema' && top === 'C') {
      w.push('형식이 고정된 태스크를 자유 생성으로 받으면 파싱 실패가 오탐으로 둔갑합니다 — 제약 채점을 함께 쓰세요(9장).');
    }
    if (pick.hw === 'edge' && pick.width === 'open') {
      w.push('엣지 + 열린 질문은 이 장에서 가장 어려운 조합입니다. 대개는 태스크를 좁히는 쪽이 현실적인 답입니다.');
    }
    return w;
  }

  /* --- 결과 렌더 --------------------------------------------------------- */
  function renderOut() {
    var out = document.getElementById('dt_out');
    if (!out) return;
    var sc = { A: 0, B: 0, C: 0, D: 0 };
    var why = [];
    QS.forEach(function (q) {
      var o = chosen(q);
      ['A', 'B', 'C', 'D'].forEach(function (k) { sc[k] += o.s[k]; });
      var parts = [];
      ['A', 'B', 'C', 'D'].forEach(function (k) {
        if (o.s[k] > 0) parts.push(k + ' +' + o.s[k]);
        else if (o.s[k] < 0) parts.push(k + ' ' + o.s[k]);
      });
      why.push({ q: q.q.slice(0, 2) + ' ' + o.t, delta: parts.join(' · '), why: o.why });
    });

    var order = STRATS.slice().sort(function (a, b) { return sc[b.id] - sc[a.id]; });
    var top = order[0], runner = order[1];
    var mn = sc[order[3].id], mx = sc[top.id], span = Math.max(1, mx - mn);

    var h = '<div class="dt-win"><div class="dt-badge">추천 전략</div>' +
      '<b>' + top.name + '</b><span>' + top.sub + '</span></div>';

    h += '<div class="dt-bars">';
    order.forEach(function (s) {
      var pct = Math.round((sc[s.id] - mn) / span * 100);
      h += '<div class="dt-bar"><span class="nm">' + s.name + '</span>' +
        '<span class="tr"><i style="width:' + Math.max(2, pct) + '%;background:var(--' +
        (s.id === top.id ? 'vis' : 'line') + ')"></i></span>' +
        '<span class="sc">' + (sc[s.id] > 0 ? '+' : '') + sc[s.id] + '</span></div>';
    });
    h += '</div>';

    if (sc[top.id] - sc[runner.id] <= 1) {
      h += '<p class="dt-note">1위와 2위가 ' + (sc[top.id] - sc[runner.id]) +
        '점 차입니다 — 사실상 동점입니다. 이럴 때는 <b>' + runner.name +
        '</b>도 같은 데이터로 한 번 돌려 보고 실측으로 가르는 편이 빠릅니다.</p>';
    }

    h += '<div class="dt-why"><div class="dt-badge">근거</div><ul>';
    why.forEach(function (w) {
      h += '<li><b>' + w.q + '</b> <code>' + w.delta + '</code><br>' + w.why + '</li>';
    });
    h += '</ul></div>';

    var ws = warnings(top.id);
    if (ws.length) {
      h += '<div class="dt-warn"><div class="dt-badge">부딪히는 조합</div><ul>';
      ws.forEach(function (t) { h += '<li>' + t + '</li>'; });
      h += '</ul></div>';
    }

    h += '<p class="dt-note"><b>다음 한 걸음.</b> ' + top.next + '</p>';
    out.innerHTML = h;
  }

  renderQs();
  renderOut();
})();
