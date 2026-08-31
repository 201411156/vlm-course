/* ==========================================================================
   LAB 14-1 — 에이전트 루프 시뮬레이터
   모델을 부르지 않는 순수 상태기계입니다.
     · 세계   : 합성 앱 화면(홈 → 설정 → 알림)과 토글 플래그
     · 관찰   : 화면 상태를 캡션 문장으로 바꾼 것
     · 그라운딩: 요소 사각형의 중심 좌표
     · 전략   : open(개루프) / reobs(매 스텝 재관찰) / verify(재관찰 + 검증기)
     · 오류   : coord(에이전트의 좌표 오차) / flaky(환경이 행동을 삼킴)
   요점 — 오류의 출처가 다르면 잡히는 위치도 다릅니다.
     좌표 오차 → 행동 "전" 검증에 잡힌다
     행동 유실 → 행동 "후" 검증에만 잡힌다
   ========================================================================== */
(function () {
  'use strict';

  var cvEl = document.getElementById('ag_screen');
  if (!cvEl) return;

  /* --- 화면 기하 ---------------------------------------------------------- */
  var W = 264, H = 384;
  var BAR_H = 40;
  var ROW_X = 14, ROW_W = 236, ROW_H = 42, ROW_TOP = 58, ROW_GAP = 8;
  var BACK = [10, 9, 52, 22];

  function rowRect(i) { return [ROW_X, ROW_TOP + i * (ROW_H + ROW_GAP), ROW_W, ROW_H]; }
  function center(r) { return [Math.round(r[0] + r[2] / 2), Math.round(r[1] + r[3] / 2)]; }
  function inRect(p, r) {
    return p[0] >= r[0] && p[0] <= r[0] + r[2] && p[1] >= r[1] && p[1] <= r[1] + r[3];
  }

  /* --- 세계 --------------------------------------------------------------- */
  var SCREENS = {
    home: { title: '홈', back: null, rows: [
      { label: '받은 편지함', go: 'mail' },
      { label: '사진', go: 'photos' },
      { label: '설정', go: 'settings' }
    ] },
    settings: { title: '설정', back: 'home', rows: [
      { label: '계정', go: 'account' },
      { label: '알림', go: 'notif' },
      { label: '화면', go: 'display' },
      { label: '정보', go: 'about' }
    ] },
    notif: { title: '알림', back: 'settings', rows: [
      { label: '푸시 알림', flag: 'push' },
      { label: '소리', flag: 'sound' },
      { label: '배지', flag: 'badge' }
    ] },
    mail: { title: '받은 편지함', back: 'home', rows: [], dead: '메일 3통' },
    photos: { title: '사진', back: 'home', rows: [], dead: '사진 12장' },
    account: { title: '계정', back: 'settings', rows: [], dead: '로그인 정보' },
    display: { title: '화면', back: 'settings', rows: [], dead: '밝기 · 글꼴 크기' },
    about: { title: '정보', back: 'settings', rows: [], dead: '버전 1.0' }
  };

  /* 목표까지의 거리 — "진전이 있었는가"를 판정하는 데만 씁니다 */
  function dist(screen, flags) {
    if (!flags.push) return 0;
    if (screen === 'notif') return 1;
    if (screen === 'settings') return 2;
    if (screen === 'home') return 3;
    return 4;
  }

  /* 개루프가 처음 한 번에 세우는 계획: (기대 화면, 노릴 요소) */
  var OPEN_PLAN = [
    { screen: 'home', label: '설정' },
    { screen: 'settings', label: '알림' },
    { screen: 'notif', label: '푸시 알림' }
  ];
  var MAX_ACTS = 10;

  /* --- 관찰(캡션) --------------------------------------------------------- */
  function caption(screen, flags) {
    var sc = SCREENS[screen];
    if (!sc.rows.length) {
      return '"' + sc.title + '" 화면 · ' + sc.dead + ' · 목록 항목 없음 · 뒤로 버튼 있음';
    }
    var parts = [];
    for (var i = 0; i < sc.rows.length; i++) {
      var r = sc.rows[i];
      parts.push((i + 1) + ') ' + r.label +
        (r.flag ? ' [' + (flags[r.flag] ? '켜짐' : '꺼짐') + ']' : ''));
    }
    return '"' + sc.title + '" 화면 · ' + parts.join('  ');
  }

  function targetRect(screen, label) {
    var sc = SCREENS[screen];
    if (label === '뒤로') return sc.back ? BACK : null;
    for (var i = 0; i < sc.rows.length; i++) {
      if (sc.rows[i].label === label) return rowRect(i);
    }
    return null;
  }

  function hitTest(screen, p) {
    var sc = SCREENS[screen];
    if (sc.back && inRect(p, BACK)) return { type: 'back' };
    for (var i = 0; i < sc.rows.length; i++) {
      if (inRect(p, rowRect(i))) return { type: 'row', i: i, row: sc.rows[i] };
    }
    return null;
  }

  /* 폐루프 정책: 지금 화면에서 목표에 가장 가까워지는 한 수 */
  function policy(screen, flags) {
    if (screen === 'notif') return flags.push ? '푸시 알림' : null;
    if (screen === 'home') return '설정';
    if (screen === 'settings') return '알림';
    return '뒤로';
  }

  /* --- 상태 --------------------------------------------------------------- */
  var strategy = 'open', fault = 'none';
  var S = null;

  function reset() {
    S = {
      screen: 'home',
      flags: { push: true, sound: true, badge: false },
      acts: 0, calls: 0, waste: 0,
      done: false, failed: false, failMsg: '',
      planIdx: 0, faultUsed: false, planned: false,
      trace: [], cursor: null, cursorOk: true, target: null
    };
    anim = null;
  }

  function log(k, t, cls) { S.trace.push({ k: k, t: t, cls: cls || '' }); }
  function sep() { S.trace.push({ sep: true }); }

  /* --- 한 스텝 ------------------------------------------------------------ */
  function step() {
    if (!S || S.done || S.failed) return false;
    if (S.acts >= MAX_ACTS) {
      S.failed = true; S.failMsg = '스텝 한도(' + MAX_ACTS + ') 초과';
      log('결과', '✗ ' + S.failMsg + ' — 루프를 끊었습니다.', 'bad');
      return false;
    }
    sep();

    var label, planScreen;

    if (strategy === 'open') {
      if (!S.planned) {
        S.calls++;
        log('관찰', caption(S.screen, S.flags));
        log('계획', '전체 계획을 한 번에 수립: ① "설정" ② "알림" ③ "푸시 알림". ' +
                    '이후에는 화면을 다시 보지 않습니다.');
        S.planned = true;
      }
      var p = OPEN_PLAN[S.planIdx];
      if (!p) {
        S.failed = true; S.failMsg = '계획을 다 썼는데 목표에 도달하지 못했습니다';
        log('결과', '✗ ' + S.failMsg, 'bad');
        return false;
      }
      S.planIdx++;
      planScreen = p.screen; label = p.label;
      log('계획', '계획 ' + S.planIdx + '단계 실행: "' + label +
                  '" (기대 화면 = "' + SCREENS[planScreen].title + '")', 'muted');
    } else {
      S.calls++;
      log('관찰', caption(S.screen, S.flags));
      label = policy(S.screen, S.flags);
      if (label === null) { finish(); return false; }
      planScreen = S.screen;
      log('계획', '목표까지 다음 한 수 — "' + label + '" 을 누른다');
    }

    /* 그라운딩: 기대 화면에서 요소의 중심 좌표를 낸다 */
    var rect = targetRect(planScreen, label);
    if (!rect) rect = [ROW_X, ROW_TOP, ROW_W, ROW_H];
    var pt = center(rect);

    /* 오류 ①: 에이전트의 좌표 오차 — 한 행 아래를 찍는다 */
    if (fault === 'coord' && !S.faultUsed && label === '알림') {
      S.faultUsed = true;
      pt = [pt[0], pt[1] + ROW_H + ROW_GAP];
      log('행동', '그라운딩 결과 click(' + pt[0] + ', ' + pt[1] + ') — ' +
                  '한 행 아래를 찍었습니다', 'bad');
    }

    /* 검증기 ①: 행동 전 — 이 좌표 아래 요소가 내가 노린 것인가 */
    if (strategy === 'verify') {
      S.calls++;
      var h0 = hitTest(S.screen, pt);
      var seen = h0 ? (h0.type === 'back' ? '뒤로' : h0.row.label) : '없음';
      if (seen !== label) {
        log('검증', '✗ 행동 전 확인 — (' + pt[0] + ', ' + pt[1] + ') 아래 요소는 "' +
                    seen + '", 노린 것은 "' + label + '". 행동을 취소하고 다시 그라운딩합니다.', 'bad');
        var r2 = targetRect(S.screen, label);
        if (r2) pt = center(r2);
      } else {
        log('검증', '✓ 행동 전 확인 — (' + pt[0] + ', ' + pt[1] + ') 아래 요소 = "' +
                    label + '"', 'good');
      }
    }

    /* --- 실행 ------------------------------------------------------------- */
    var before = S.screen + '|' + S.flags.push + S.flags.sound + S.flags.badge;
    var d0 = dist(S.screen, S.flags);
    S.acts++;
    S.cursor = pt;
    S.target = targetRect(S.screen, label);
    S.cursorOk = true;

    var dropped = (fault === 'flaky' && !S.faultUsed && label === '설정');
    if (dropped) S.faultUsed = true;

    var hit = hitTest(S.screen, pt);
    if (dropped) {
      S.cursorOk = false;
      log('행동', 'click(' + pt[0] + ', ' + pt[1] + ') → 좌표는 정확했지만 ' +
                  '화면이 아직 반응하지 않았습니다(행동 유실)', 'bad');
    } else if (!hit) {
      S.cursorOk = false;
      log('행동', 'click(' + pt[0] + ', ' + pt[1] + ') → 빈 영역. 아무 일도 일어나지 않았습니다', 'bad');
    } else if (hit.type === 'back') {
      S.screen = SCREENS[S.screen].back;
      log('행동', 'click(' + pt[0] + ', ' + pt[1] + ') → 뒤로 · "' +
                  SCREENS[S.screen].title + '" 로 복귀');
    } else if (hit.row.go) {
      S.screen = hit.row.go;
      log('행동', 'click(' + pt[0] + ', ' + pt[1] + ') → "' + hit.row.label + '" 열림');
    } else if (hit.row.flag) {
      S.flags[hit.row.flag] = !S.flags[hit.row.flag];
      log('행동', 'click(' + pt[0] + ', ' + pt[1] + ') → "' + hit.row.label + '" ' +
                  (S.flags[hit.row.flag] ? '켜짐' : '꺼짐'));
    }

    /* 진전이 없었으면 헛발질 */
    if (dist(S.screen, S.flags) >= d0) S.waste++;

    /* 검증기 ②: 행동 후 — 상태가 실제로 바뀌었는가 */
    if (strategy === 'verify') {
      S.calls++;
      var after = S.screen + '|' + S.flags.push + S.flags.sound + S.flags.badge;
      if (after === before) {
        log('검증', '✗ 행동 후 확인 — 상태가 그대로입니다. 반영되지 않았다고 판단하고 ' +
                    '다음 스텝에서 다시 시도합니다.', 'bad');
      } else {
        log('검증', '✓ 행동 후 확인 — 상태가 바뀌었습니다 → "' +
                    SCREENS[S.screen].title + '"', 'good');
      }
    }

    if (!S.flags.push) { finish(); return false; }
    if (strategy === 'open' && S.planIdx >= OPEN_PLAN.length) {
      S.failed = true; S.failMsg = '계획을 다 썼는데 목표에 도달하지 못했습니다';
      sep(); log('결과', '✗ ' + S.failMsg, 'bad');
      return false;
    }
    return true;
  }

  function finish() {
    S.done = true;
    sep();
    log('결과', '✓ 목표 달성 — 푸시 알림이 꺼졌습니다. 행동 ' + S.acts +
                '회 · 모델 호출 ' + S.calls + '회 · 헛발질 ' + S.waste + '회', 'good');
  }

  /* --- 그리기 ------------------------------------------------------------- */
  function css(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }
  function fit(canvas, w, h) {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = w * dpr; canvas.height = h * dpr;
    canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
    var c = canvas.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    return c;
  }
  function rr(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  var cx = fit(cvEl, W, H);
  var anim = null;
  var reduced = window.matchMedia &&
                window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function draw() {
    var bg = css('--bg'), panel = css('--panel'), panel2 = css('--panel2'),
        line = css('--line'), tx = css('--tx'), tx2 = css('--tx2'), tx3 = css('--tx3'),
        vis = css('--vis'), lang = css('--lang'), ok = css('--ok'), bad = css('--bad');

    cx.clearRect(0, 0, W, H);
    cx.fillStyle = bg; cx.fillRect(0, 0, W, H);
    rr(cx, 1, 1, W - 2, H - 2, 12);
    cx.fillStyle = panel; cx.fill();
    cx.strokeStyle = line; cx.lineWidth = 1; cx.stroke();

    var sc = SCREENS[S.screen];

    /* 타이틀 바 */
    cx.fillStyle = panel2;
    rr(cx, 1, 1, W - 2, BAR_H, 12); cx.fill();
    cx.fillStyle = panel2; cx.fillRect(1, BAR_H - 10, W - 2, 10);
    cx.strokeStyle = line; cx.beginPath();
    cx.moveTo(1, BAR_H + 0.5); cx.lineTo(W - 1, BAR_H + 0.5); cx.stroke();
    cx.font = '600 13px "IBM Plex Sans KR", system-ui, sans-serif';
    cx.fillStyle = tx; cx.textAlign = 'center'; cx.textBaseline = 'middle';
    cx.fillText(sc.title, W / 2, BAR_H / 2);
    cx.textAlign = 'left';

    if (sc.back) {
      rr(cx, BACK[0], BACK[1], BACK[2], BACK[3], 6);
      cx.fillStyle = panel; cx.fill();
      cx.strokeStyle = line; cx.stroke();
      cx.font = '11px "IBM Plex Sans KR", system-ui, sans-serif';
      cx.fillStyle = tx2;
      cx.fillText('‹ 뒤로', BACK[0] + 9, BACK[1] + BACK[3] / 2 + 1);
    }

    /* 목록 */
    if (!sc.rows.length) {
      cx.font = '12.5px "IBM Plex Sans KR", system-ui, sans-serif';
      cx.fillStyle = tx3; cx.textAlign = 'center';
      cx.fillText(sc.dead, W / 2, H / 2 - 8);
      cx.fillText('(목표와 관련된 요소 없음)', W / 2, H / 2 + 14);
      cx.textAlign = 'left';
    }
    for (var i = 0; i < sc.rows.length; i++) {
      var r = rowRect(i), row = sc.rows[i];
      rr(cx, r[0], r[1], r[2], r[3], 8);
      cx.fillStyle = panel2; cx.fill();
      cx.strokeStyle = line; cx.stroke();
      cx.font = '13px "IBM Plex Sans KR", system-ui, sans-serif';
      cx.fillStyle = tx;
      cx.fillText(row.label, r[0] + 14, r[1] + r[3] / 2 + 1);
      if (row.flag) {
        var on = S.flags[row.flag];
        var tw = 38, th = 20, tX = r[0] + r[2] - tw - 12, tY = r[1] + (r[3] - th) / 2;
        rr(cx, tX, tY, tw, th, th / 2);
        cx.fillStyle = on ? vis : line; cx.fill();
        cx.beginPath();
        cx.arc(tX + (on ? tw - th / 2 : th / 2), tY + th / 2, th / 2 - 3, 0, 7);
        cx.fillStyle = panel; cx.fill();
      } else {
        cx.fillStyle = tx3;
        cx.font = '13px "IBM Plex Mono", monospace';
        cx.fillText('›', r[0] + r[2] - 18, r[1] + r[3] / 2 + 1);
      }
    }

    /* 노린 요소 */
    if (S.target) {
      cx.save();
      cx.setLineDash([5, 4]);
      cx.strokeStyle = lang; cx.lineWidth = 1.6;
      rr(cx, S.target[0] - 2, S.target[1] - 2, S.target[2] + 4, S.target[3] + 4, 9);
      cx.stroke();
      cx.restore();
    }

    /* 클릭 지점 */
    var cur = S.cursor;
    if (anim) {
      cur = [anim.from[0] + (anim.to[0] - anim.from[0]) * anim.t,
             anim.from[1] + (anim.to[1] - anim.from[1]) * anim.t];
    }
    if (cur) {
      var col = anim ? vis : (S.cursorOk ? ok : bad);
      cx.strokeStyle = col; cx.lineWidth = 1.4;
      cx.beginPath(); cx.moveTo(cur[0] - 9, cur[1]); cx.lineTo(cur[0] + 9, cur[1]); cx.stroke();
      cx.beginPath(); cx.moveTo(cur[0], cur[1] - 9); cx.lineTo(cur[0], cur[1] + 9); cx.stroke();
      cx.beginPath(); cx.arc(cur[0], cur[1], 6.5, 0, 7);
      cx.stroke();
      cx.globalAlpha = 0.22; cx.fillStyle = col; cx.fill(); cx.globalAlpha = 1;
    }
  }

  /* --- 트레이스 로그 ------------------------------------------------------ */
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  var traceEl = document.getElementById('ag_trace');
  function drawTrace() {
    if (!traceEl) return;
    if (!S.trace.length) {
      traceEl.innerHTML = '<div class="ln"><span class="k">대기</span>' +
        '<span class="t muted">▶ 재생 또는 ⏭ 한 단계를 눌러 보세요.</span></div>';
      return;
    }
    var h = '', cls;
    for (var i = 0; i < S.trace.length; i++) {
      var e = S.trace[i];
      if (e.sep) { h += '<div class="sep"></div>'; continue; }
      cls = e.k === '관찰' ? 'obs' : (e.k === '행동' ? 'act' : '');
      h += '<div class="ln ' + cls + '"><span class="k">' + esc(e.k) + '</span>' +
           '<span class="t ' + e.cls + '">' + esc(e.t) + '</span></div>';
    }
    traceEl.innerHTML = h;
    traceEl.scrollTop = traceEl.scrollHeight;
  }

  /* --- 판정문 ------------------------------------------------------------- */
  function verdict() {
    if (!S.acts && !S.done && !S.failed) {
      return '먼저 오류 없이 세 전략을 비교해 보십시오. 그다음 오류를 하나 주입하면 ' +
             '결론이 뒤집힙니다.';
    }
    if (S.failed) {
      if (strategy === 'open') {
        return '실패 — 개루프는 첫 오류 이후 자기가 어디에 있는지 모릅니다. ' +
               '남은 행동은 전부 엉뚱한 화면에 떨어졌습니다. ' +
               '관찰을 한 번도 다시 하지 않았으니 알아챌 방법도 없었습니다.';
      }
      return '실패 — 한도 안에 목표에 닿지 못했습니다.';
    }
    if (!S.done) return '진행 중입니다 — 관찰 → 계획 → 행동이 한 스텝입니다.';

    if (fault === 'none') {
      if (strategy === 'open') {
        return '성공 · 모델 호출 ' + S.calls + '회 — 오류가 없다면 개루프가 압도적으로 쌉니다. ' +
               '한 번 보고 세 번 누르면 끝입니다. 문제는 이 전제가 오래 유지되지 않는다는 것입니다.';
      }
      if (strategy === 'reobs') {
        return '성공 · 모델 호출 ' + S.calls + '회 — 매 스텝 다시 보느라 호출이 늘었지만 ' +
               '얻은 것은 없습니다. 오류가 없는 세계에서 폐루프는 순수한 낭비입니다.';
      }
      return '성공 · 모델 호출 ' + S.calls + '회 — 검증까지 붙이면 호출이 세 배입니다. ' +
             '지금은 전부 통과 도장만 찍고 있습니다.';
    }
    if (fault === 'coord') {
      if (strategy === 'reobs') {
        return '성공 · 행동 ' + S.acts + '회(헛발질 ' + S.waste + ') — 잘못 눌러 엉뚱한 화면에 ' +
               '들어갔지만, 다시 보니 "여기가 아니다"를 알 수 있었습니다. 되돌아와 다시 시도했습니다. ' +
               '복구는 되지만 <b>이미 저지른 뒤</b>입니다.';
      }
      if (strategy === 'verify') {
        return '성공 · 행동 ' + S.acts + '회(헛발질 ' + S.waste + ') — 검증기가 좌표 아래 요소를 ' +
               '한 번 더 보고 <b>누르기 전에</b> 잡았습니다. 되돌릴 행동 자체가 없습니다. ' +
               '되돌릴 수 없는 행동이라면 이 차이가 전부입니다.';
      }
    }
    if (fault === 'flaky') {
      if (strategy === 'reobs') {
        return '성공 · 행동 ' + S.acts + '회(헛발질 ' + S.waste + ') — 다시 보니 화면이 그대로여서 ' +
               '같은 계획이 다시 나왔고, 결과적으로 재시도가 되었습니다. 복구는 되지만 ' +
               '<b>실패했다는 사실 자체는 기록되지 않습니다.</b>';
      }
      if (strategy === 'verify') {
        return '성공 · 행동 ' + S.acts + '회 — 이 오류는 좌표가 옳았으므로 행동 전 검증은 ' +
               '통과합니다. <b>행동 후</b> 상태를 확인해야만 드러납니다. 호출은 가장 비싸지만, ' +
               '유일하게 "무엇이 실패했는지"가 로그에 남습니다.';
      }
    }
    return '성공했습니다.';
  }

  /* --- UI ----------------------------------------------------------------- */
  var el = {
    play: document.getElementById('ag_play'),
    step: document.getElementById('ag_step'),
    reset: document.getElementById('ag_reset'),
    steps: document.getElementById('ag_steps'),
    calls: document.getElementById('ag_calls'),
    waste: document.getElementById('ag_waste'),
    state: document.getElementById('ag_state'),
    verdict: document.getElementById('ag_verdict')
  };
  var stratBtns = document.querySelectorAll('#ag_strategy button');
  var faultBtns = document.querySelectorAll('#ag_fault button');

  function refresh() {
    draw(); drawTrace();
    if (el.steps) el.steps.textContent = S.acts;
    if (el.calls) el.calls.textContent = S.calls;
    if (el.waste) {
      el.waste.textContent = S.waste;
      el.waste.className = S.waste ? 'warn' : '';
    }
    if (el.state) {
      el.state.textContent = S.done ? '성공' : (S.failed ? '실패' : (S.acts ? '진행 중' : '대기'));
      el.state.style.color = S.done ? css('--ok') : (S.failed ? css('--bad') : '');
    }
    if (el.verdict) el.verdict.innerHTML = verdict();
  }

  var playing = false, timer = null, raf = null;

  function animateTo(pt, cb) {
    var from = S.cursor && !anim ? S.cursor : (S.cursor || [W / 2, H / 2]);
    if (reduced) { cb(); return; }
    anim = { from: from, to: pt, t: 0 };
    var t0 = performance.now(), dur = 300;
    function frame(now) {
      anim.t = Math.min(1, (now - t0) / dur);
      draw();
      if (anim.t < 1) { raf = requestAnimationFrame(frame); }
      else { anim = null; cb(); }
    }
    raf = requestAnimationFrame(frame);
  }

  function doStep() {
    if (S.done || S.failed) return false;
    var prev = S.cursor;
    var more = step();
    /* 커서 이동 애니메이션은 시각적 장식일 뿐 — 상태는 이미 갱신되어 있습니다 */
    if (prev && S.cursor && !reduced) {
      var to = S.cursor;
      S.cursor = prev;
      animateTo(to, function () { S.cursor = to; refresh(); });
      return more;
    }
    refresh();
    return more;
  }

  function play() {
    if (playing) { stopPlay(); return; }
    if (S.done || S.failed) { hardReset(); }
    playing = true;
    if (el.play) el.play.textContent = '⏸ 정지';
    tick();
  }
  function tick() {
    if (!playing) return;
    var more = doStep();
    if (!more) { stopPlay(); return; }
    timer = setTimeout(tick, reduced ? 120 : 980);
  }
  function stopPlay() {
    playing = false;
    if (timer) clearTimeout(timer);
    if (raf) cancelAnimationFrame(raf);
    anim = null;
    if (el.play) el.play.textContent = '▶ 재생';
    refresh();
  }
  function hardReset() {
    stopPlay(); reset(); refresh();
  }

  if (el.play) el.play.addEventListener('click', play);
  if (el.step) el.step.addEventListener('click', function () {
    stopPlay();
    if (S.done || S.failed) reset();
    doStep();
  });
  if (el.reset) el.reset.addEventListener('click', hardReset);

  Array.prototype.forEach.call(stratBtns, function (b) {
    b.addEventListener('click', function () {
      Array.prototype.forEach.call(stratBtns, function (x) { x.classList.remove('sel'); });
      b.classList.add('sel');
      strategy = b.getAttribute('data-s');
      hardReset();
    });
  });
  Array.prototype.forEach.call(faultBtns, function (b) {
    b.addEventListener('click', function () {
      Array.prototype.forEach.call(faultBtns, function (x) { x.classList.remove('sel'); });
      b.classList.add('sel');
      fault = b.getAttribute('data-f');
      hardReset();
    });
  });

  new MutationObserver(function () { draw(); }).observe(document.documentElement,
    { attributes: true, attributeFilter: ['data-theme'] });

  reset();
  refresh();
})();


/* ==========================================================================
   LAB 14-2 — 도구 라우팅 미니
   질문 8개를 직접 답 / 검출기 / OCR / 검색 중 하나로 보냅니다.
   라우터는  argmax_r [ 정확도(추정 유형, r) − λ · 비용(r) ] 로 경로를 고릅니다.
   · λ 를 올리면 → 곡선을 따라 미끄러진다 (선택 가능한 트레이드오프)
   · 오인식을 올리면 → 곡선 자체가 내려앉는다 (선택할 수 없는 손실)
   정확도·비용 수치는 구조를 보여주기 위한 가상값입니다. 공개 벤치 수치가 아닙니다.
   ========================================================================== */
(function () {
  'use strict';

  var lamEl = document.getElementById('rt_lambda');
  if (!lamEl) return;

  var ROUTES = ['direct', 'detect', 'ocr', 'web'];
  var NAME = { direct: '직접 답', detect: '검출기', ocr: 'OCR', web: '검색' };
  var KIND = { scene: '장면 이해', count: '개수 세기', text: '글자 읽기', world: '외부 지식' };
  var COST = { direct: 1.0, detect: 2.4, ocr: 1.9, web: 3.2 };
  var ACC = {
    scene: { direct: 0.92, detect: 0.61, ocr: 0.52, web: 0.58 },
    count: { direct: 0.41, detect: 0.93, ocr: 0.33, web: 0.30 },
    text:  { direct: 0.47, detect: 0.38, ocr: 0.95, web: 0.36 },
    world: { direct: 0.36, detect: 0.29, ocr: 0.31, web: 0.90 }
  };
  /* thr = 이 오인식 수준을 넘으면 라우터가 conf 유형으로 착각한다 */
  var QS = [
    { q: '이 사진 분위기가 어때?',      kind: 'scene', conf: 'world', thr: 0.55 },
    { q: '선반에 상자가 몇 개 있어?',   kind: 'count', conf: 'scene', thr: 0.15 },
    { q: '영수증 총액이 얼마야?',       kind: 'text',  conf: 'world', thr: 0.35 },
    { q: '이 로고는 어느 회사야?',      kind: 'world', conf: 'text',  thr: 0.25 },
    { q: '작업자가 안전모를 썼어?',     kind: 'scene', conf: 'count', thr: 0.45 },
    { q: '계기판 숫자를 읽어줘',        kind: 'text',  conf: 'scene', thr: 0.20 },
    { q: '화면에 사람이 몇 명이야?',    kind: 'count', conf: 'scene', thr: 0.40 },
    { q: '이 건물은 언제 지어졌어?',    kind: 'world', conf: 'scene', thr: 0.50 }
  ];

  var el = {
    lv: document.getElementById('rt_lv'),
    eps: document.getElementById('rt_eps'),
    ev: document.getElementById('rt_ev'),
    det: document.getElementById('rt_det'),
    ocr: document.getElementById('rt_ocr'),
    web: document.getElementById('rt_web'),
    acc: document.getElementById('rt_acc'),
    cost: document.getElementById('rt_cost'),
    rate: document.getElementById('rt_rate'),
    table: document.getElementById('rt_table'),
    verdict: document.getElementById('rt_verdict'),
    curve: document.getElementById('rt_curve')
  };

  function enabled() {
    var list = ['direct'];
    if (el.det.checked) list.push('detect');
    if (el.ocr.checked) list.push('ocr');
    if (el.web.checked) list.push('web');
    return list;
  }

  /* 하나의 (λ, ε) 설정에 대한 라우팅 결과 */
  function evaluate(lam, eps, avail) {
    var rows = [], accSum = 0, costSum = 0, toolCalls = 0;
    for (var i = 0; i < QS.length; i++) {
      var Q = QS[i];
      var est = (eps >= Q.thr) ? Q.conf : Q.kind;
      var best = avail[0], bestScore = -Infinity;
      for (var j = 0; j < avail.length; j++) {
        var r = avail[j];
        var s = ACC[est][r] - lam * COST[r];
        if (s > bestScore + 1e-12) { bestScore = s; best = r; }
      }
      var a = ACC[Q.kind][best], c = COST[best];
      accSum += a; costSum += c;
      if (best !== 'direct') toolCalls++;
      rows.push({ q: Q.q, kind: Q.kind, est: est, pick: best, acc: a, cost: c,
                  mis: est !== Q.kind });
    }
    return { rows: rows, acc: accSum / QS.length, cost: costSum / QS.length,
             rate: toolCalls / QS.length };
  }

  /* --- 곡선 -------------------------------------------------------------- */
  function css(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }
  function fit(canvas, w, h) {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = w * dpr; canvas.height = h * dpr;
    canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
    var c = canvas.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    return c;
  }
  var CW = 336, CH = 252, PAD = 38;
  var cc = el.curve ? fit(el.curve, CW, CH) : null;
  var XMIN = 0.92, XMAX = 2.30, YMIN = 0.35, YMAX = 1.0;
  function PX(x) { return PAD + (x - XMIN) / (XMAX - XMIN) * (CW - PAD - 14); }
  function PY(y) { return CH - 30 - (y - YMIN) / (YMAX - YMIN) * (CH - 30 - 14); }

  function drawCurve(eps, avail, cur) {
    if (!cc) return;
    var panel = css('--panel'), line = css('--line'), tx3 = css('--tx3'),
        vis = css('--vis'), lang = css('--lang');
    cc.clearRect(0, 0, CW, CH);
    cc.fillStyle = panel; cc.fillRect(0, 0, CW, CH);

    /* 격자 · 축 */
    cc.strokeStyle = line; cc.lineWidth = 1;
    cc.font = '10px "IBM Plex Mono", monospace';
    cc.fillStyle = tx3;
    var yv;
    for (yv = 0.4; yv <= 1.001; yv += 0.2) {
      cc.globalAlpha = 0.6;
      cc.beginPath(); cc.moveTo(PAD, PY(yv)); cc.lineTo(CW - 14, PY(yv)); cc.stroke();
      cc.globalAlpha = 1;
      cc.textAlign = 'right'; cc.textBaseline = 'middle';
      cc.fillText(yv.toFixed(1), PAD - 6, PY(yv));
    }
    var xv;
    cc.textAlign = 'center'; cc.textBaseline = 'top';
    for (xv = 1.0; xv <= 2.21; xv += 0.4) {
      cc.fillText(xv.toFixed(1), PX(xv), CH - 25);
    }
    cc.textAlign = 'left';
    cc.fillText('평균 비용 →', PAD, CH - 12);
    cc.save();
    cc.translate(11, PY(0.68)); cc.rotate(-Math.PI / 2);
    cc.textAlign = 'center'; cc.textBaseline = 'top';
    cc.fillText('평균 정확도', 0, 0);
    cc.restore();

    /* λ 스윕 곡선 */
    var pts = [], i;
    for (i = 0; i <= 40; i++) {
      var r = evaluate(i / 100, eps, avail);
      pts.push([r.cost, r.acc]);
    }
    cc.strokeStyle = vis; cc.lineWidth = 2;
    cc.beginPath();
    for (i = 0; i < pts.length; i++) {
      var x = PX(pts[i][0]), y = PY(pts[i][1]);
      if (i === 0) cc.moveTo(x, y); else cc.lineTo(x, y);
    }
    cc.stroke();
    cc.fillStyle = vis; cc.globalAlpha = 0.75;
    for (i = 0; i < pts.length; i += 4) {
      cc.beginPath(); cc.arc(PX(pts[i][0]), PY(pts[i][1]), 2.2, 0, 7); cc.fill();
    }
    cc.globalAlpha = 1;

    /* 현재 지점 */
    cc.beginPath(); cc.arc(PX(cur.cost), PY(cur.acc), 6, 0, 7);
    cc.fillStyle = lang; cc.fill();
    cc.strokeStyle = panel; cc.lineWidth = 2; cc.stroke();
  }

  /* --- 표 ---------------------------------------------------------------- */
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function drawTable(res) {
    if (!el.table) return;
    var h = '<table><thead><tr><th>질문</th><th>실제 유형</th><th>라우터 판단</th>' +
            '<th>보낸 곳</th><th>정확도</th><th>비용</th></tr></thead><tbody>';
    for (var i = 0; i < res.rows.length; i++) {
      var r = res.rows[i];
      h += '<tr><td>' + esc(r.q) + '</td>' +
           '<td>' + KIND[r.kind] + '</td>' +
           '<td class="' + (r.mis ? 'miss' : '') + '">' + KIND[r.est] +
             (r.mis ? ' ✗' : '') + '</td>' +
           '<td class="pick">' + NAME[r.pick] + '</td>' +
           '<td class="num ' + (r.acc >= 0.85 ? 'hit' : (r.acc < 0.5 ? 'miss' : '')) + '">' +
             r.acc.toFixed(2) + '</td>' +
           '<td class="num">' + r.cost.toFixed(1) + '</td></tr>';
    }
    h += '</tbody></table>';
    el.table.innerHTML = h;
  }

  /* --- 판정문 ------------------------------------------------------------- */
  function verdict(lam, eps, avail, res) {
    if (avail.length === 1) {
      return '도구를 전부 껐습니다 — 모든 질문이 직접 답으로 갑니다. 비용은 최소, ' +
             '정확도는 <b>' + res.acc.toFixed(2) + '</b>. 개수 세기와 글자 읽기가 무너집니다.';
    }
    if (eps === 0 && lam <= 0.10) {
      return '라우터가 완벽하고 비용도 거의 안 따집니다 — 각 질문이 가장 잘하는 도구로 갑니다. ' +
             '이것이 이 설정에서 가능한 상한선입니다(정확도 <b>' + res.acc.toFixed(2) + '</b>).';
    }
    if (eps === 0) {
      return 'λ 를 올리면 비싼 도구부터 하나씩 포기합니다. 정확도는 떨어지지만 ' +
             '<b>어디까지 포기할지는 우리가 고릅니다</b> — 곡선 위를 미끄러지는 것뿐입니다.';
    }
    var mis = 0;
    for (var i = 0; i < res.rows.length; i++) if (res.rows[i].mis) mis++;
    if (mis >= 4) {
      return '질문 ' + mis + '개를 잘못 분류했습니다 — 곡선이 통째로 내려앉았습니다. ' +
             '도구는 그대로인데 정확도가 <b>' + res.acc.toFixed(2) + '</b> 입니다. ' +
             '<b>부를 줄 모르면 없는 것과 같고, 비용은 그대로 냅니다.</b>';
    }
    return '오인식이 ' + mis + '개 생겼습니다. 잘못 부른 도구는 비용을 온전히 지불하면서 ' +
           '정확도는 직접 답보다 낮습니다 — 트레이드오프가 아니라 순손실입니다.';
  }

  /* --- 갱신 --------------------------------------------------------------- */
  function update() {
    var lam = parseInt(lamEl.value, 10) / 100;
    var eps = parseInt(el.eps.value, 10) / 100;
    var avail = enabled();
    var res = evaluate(lam, eps, avail);

    el.lv.textContent = lam.toFixed(2);
    el.ev.textContent = Math.round(eps * 100) + '%';
    el.acc.textContent = res.acc.toFixed(2);
    el.cost.textContent = res.cost.toFixed(2);
    el.rate.textContent = Math.round(res.rate * 100) + '%';

    drawTable(res);
    drawCurve(eps, avail, res);
    if (el.verdict) el.verdict.innerHTML = verdict(lam, eps, avail, res);
  }

  lamEl.addEventListener('input', update);
  el.eps.addEventListener('input', update);
  el.det.addEventListener('change', update);
  el.ocr.addEventListener('change', update);
  el.web.addEventListener('change', update);

  new MutationObserver(update).observe(document.documentElement,
    { attributes: true, attributeFilter: ['data-theme'] });

  update();
})();
