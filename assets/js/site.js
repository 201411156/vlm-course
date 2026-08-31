/* ==========================================================================
   VLM 워크북 — 공용 스크립트
   · 챕터 레지스트리 (한 곳에서만 관리)
   · 사이드 레일 렌더 · 테마 토글 · 진행상태(localStorage)
   외부 의존 없음. 모듈 아님(고전 스크립트) — 정적 호스팅에 그대로 올라간다.
   ========================================================================== */
(function (global) {
  'use strict';

  /* --- 챕터 레지스트리 -------------------------------------------------- */
  /* status: 'live' 공개 · 'draft' 집필 중 */
  var CHAPTERS = [
    { n: '01', title: '이미지가 토큰이 되기까지', status: 'live', quizzes: ['q1', 'q2'],
      sub: '패치 분할, 토큰 수, 어텐션 비용 — VLM의 모든 비용이 여기서 결정됩니다.' },
    { n: '02', title: '두 세계를 잇는 프로젝터', status: 'live', quizzes: ['q1', 'q2'],
      sub: '비전-언어 정렬, 그리고 linear · MLP · resampler 어댑터의 트레이드오프.' },
    { n: '03', title: '해상도와 토큰 예산', status: 'live', quizzes: ['q1', 'q2', 'q3'],
      sub: '동적 해상도와 타일 분할 — 토큰을 어디에 쓸 것인가.' },
    { n: '04', title: '그라운딩 — 좌표를 말하게 하기', status: 'live', quizzes: ['q1', 'q2', 'q3'],
      sub: '박스를 텍스트로 뱉는 모델들, 그리고 좌표 표기법.' },
    { n: '05', title: '제로샷 검출의 하한선', status: 'live', quizzes: ['q1', 'q2', 'q3'],
      sub: '학습 없이 어디까지 되는가, 그리고 어디서 무너지는가.' },
    { n: '06', title: 'LoRA — 큰 모델을 얇게 고치기', status: 'live', quizzes: ['q1', 'q2', 'q3'],
      sub: '저랭크 어댑터의 수학과, 무엇을 얼리고 무엇을 열 것인가.' },
    { n: '07', title: '데이터 만들기 — instruction', status: 'live', quizzes: ['q1', 'q2', 'q3'],
      sub: '멀티모달 instruction 데이터의 합성과 검증.' },
    { n: '08', title: '판정기로 쓰는 VLM', status: 'live', quizzes: ['q1', 'q2', 'q3'],
      sub: '생성 모델을 분류기처럼 쓰는 법과 그 함정.' },
    { n: '09', title: '제약 채점과 확률 읽기', status: 'live', quizzes: ['q1', 'q2', 'q3'],
      sub: '로짓을 직접 읽어 후보를 제한하는 채점 방식.' },
    { n: '10', title: '멀티모달 판정기 전환', status: 'live', quizzes: ['q1', 'q2', 'q3'],
      sub: '텍스트 전용 파이프라인에 이미지를 붙일 때 생기는 일.' },
    { n: '11', title: '서빙 — 양자화와 지연', status: 'live', quizzes: ['q1', 'q2', 'q3'],
      sub: 'INT8·INT4, KV 캐시, 배치 — 지연을 만드는 것들.' },
    { n: '12', title: '소형 VLM의 역습', status: 'live', quizzes: ['q1', 'q2', 'q3'],
      sub: '체급이 아니라 분포입니다 — 작은 모델이 이기는 조건.' },
    { n: '13', title: '비디오 — 시간축 토큰', status: 'live', quizzes: ['q1', 'q2', 'q3'],
      sub: '프레임 샘플링과 시간 인코딩, 그리고 폭발하는 토큰 수.' },
    { n: '14', title: '에이전틱 VLM', status: 'live', quizzes: ['q1', 'q2', 'q3'],
      sub: '보고, 판단하고, 도구를 부르는 루프.' }
  ];

  /* --- 경로 --------------------------------------------------------------- */
  function base() {
    return /\/chapters\//.test(location.pathname) ? '../' : '';
  }
  function href(ch) { return base() + 'chapters/' + ch.n + '.html'; }

  /* --- 진행상태 ----------------------------------------------------------- */
  var KEY = 'vlmwb_v1';
  function load() {
    try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; }
    catch (e) { return {}; }
  }
  function save(o) {
    try { localStorage.setItem(KEY, JSON.stringify(o)); } catch (e) {}
  }
  var progress = {
    all: load,
    solved: function (n, qid) {
      var d = load();
      return !!(d[n] && d[n].indexOf(qid) >= 0);
    },
    mark: function (n, qid) {
      var d = load();
      if (!d[n]) d[n] = [];
      if (d[n].indexOf(qid) < 0) d[n].push(qid);
      save(d);
    },
    /* 챕터의 모든 퀴즈를 맞혔는가 */
    complete: function (ch) {
      if (!ch.quizzes || !ch.quizzes.length) return false;
      var d = load(), got = d[ch.n] || [];
      for (var i = 0; i < ch.quizzes.length; i++) {
        if (got.indexOf(ch.quizzes[i]) < 0) return false;
      }
      return true;
    },
    reset: function () { save({}); }
  };

  /* --- 테마 --------------------------------------------------------------- */
  var TKEY = 'vlmwb_theme';
  function applyTheme(t) {
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
    else document.documentElement.removeAttribute('data-theme');
  }
  function currentTheme() {
    try { return localStorage.getItem(TKEY) || 'auto'; } catch (e) { return 'auto'; }
  }
  function cycleTheme() {
    var order = ['auto', 'light', 'dark'];
    var next = order[(order.indexOf(currentTheme()) + 1) % order.length];
    try { localStorage.setItem(TKEY, next); } catch (e) {}
    applyTheme(next);
    return next;
  }
  applyTheme(currentTheme()); /* FOUC 방지를 위해 즉시 적용 */

  /* --- 사이드 레일 -------------------------------------------------------- */
  function renderRail(currentN) {
    var nav = document.querySelector('nav.rail');
    if (!nav) return;
    var b = base(), html = '';
    html += '<a class="brand" href="' + b + 'index.html">VLM 워크북' +
            '<small>VISION · LANGUAGE</small></a>';
    CHAPTERS.forEach(function (ch) {
      var done = progress.complete(ch) ? '<span class="done" aria-label="완료">✓</span>' : '';
      if (ch.status === 'live') {
        html += '<a class="' + (ch.n === currentN ? 'on' : '') + '" href="' + href(ch) + '">' +
                '<span class="n">' + ch.n + '</span>' + ch.title + done + '</a>';
      } else {
        html += '<a class="todo" aria-disabled="true" title="집필 중">' +
                '<span class="n">' + ch.n + '</span>' + ch.title + '</a>';
      }
    });
    html += '<div class="rail-foot"><button class="themebtn" id="themebtn" type="button">' +
            'THEME · ' + currentTheme().toUpperCase() + '</button></div>';
    nav.innerHTML = html;
    var btn = document.getElementById('themebtn');
    if (btn) btn.addEventListener('click', function () {
      btn.textContent = 'THEME · ' + cycleTheme().toUpperCase();
    });
  }

  /* --- 퀴즈 ---------------------------------------------------------------
     마크업 규약: <div class="opts" id="q1"> 안의 button[data-a="1"] 이 정답,
     해설은 같은 번호의 <div class="expl" id="e1">.
     페이지의 data-chapter 값으로 진행상태를 저장합니다.
     ---------------------------------------------------------------------- */
  function initQuizzes() {
    var n = document.body.getAttribute('data-chapter') || '00';
    Array.prototype.forEach.call(document.querySelectorAll('.opts[id]'), function (box) {
      var qid = box.id;
      var expl = document.getElementById('e' + qid.slice(1));
      var lock = function () {
        Array.prototype.forEach.call(box.querySelectorAll('button'), function (x) {
          x.disabled = true;
        });
      };
      Array.prototype.forEach.call(box.querySelectorAll('button'), function (btn) {
        btn.addEventListener('click', function () {
          var ok = btn.getAttribute('data-a') === '1';
          btn.classList.add(ok ? 'ok' : 'no');
          if (ok) {
            if (expl) expl.classList.add('show');
            progress.mark(n, qid);
            lock();
            renderRail(n); /* 레일의 완료 표시 갱신 */
          }
        });
      });
      if (progress.solved(n, qid) && expl) expl.classList.add('show');
    });
  }

  /* --- 부트스트랩 --------------------------------------------------------- */
  function boot() {
    renderRail(document.body.getAttribute('data-chapter') || null);
    initQuizzes();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else { boot(); }

  global.VLM = {
    chapters: CHAPTERS,
    href: href,
    base: base,
    progress: progress,
    renderRail: renderRail,
    cycleTheme: cycleTheme
  };
})(window);
