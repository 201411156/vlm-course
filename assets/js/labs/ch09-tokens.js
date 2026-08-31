/* ==========================================================================
   LAB 9-2 — 토크나이저가 후보를 쪼갤 때
   후보 문자열이 토큰 몇 개로 쪼개지느냐에 따라 채점 방식 셋이 서로 다른 답을
   내놓는 상황을 재현합니다. 토큰 로그확률은 손으로 지어낸 값이지만,
   확률로서 앞뒤가 맞도록(형제 후보 질량 합 ≤ 부모 질량) 맞춰 두었습니다.

   채점 방식
     · 첫 토큰 근사 : 첫 토큰의 로그확률만 본다 (forward 1회, 가장 쌈)
     · 시퀀스 합산  : Σ log p — 문자열의 진짜 로그확률. 짧은 후보가 유리하다.
     · 길이 정규화  : (Σ log p) / (토큰 수)^α — α=1 이면 토큰당 평균.
   실제 토크나이저의 분절은 모델마다 다릅니다. 여기 숫자는 예시입니다.
   ========================================================================== */
(function () {
  'use strict';

  var out = document.getElementById('tk_out');
  if (!out) return;

  /* g: 의미 그룹 (예 / 아니오 / 기타) — 표면형이 확률 질량을 나눠 갖는 걸 본다 */
  var SCEN = {
    s1: {
      name: '단일 토큰 대칭',
      desc: '후보 넷이 모두 1토큰입니다. 이럴 때는 세 방식이 완전히 같은 답을 냅니다 — 채점기가 가장 편한 상태입니다.',
      cands: [
        { t: 'Yes',     g: '예',    toks: [['Yes', -0.20]] },
        { t: 'No',      g: '아니오', toks: [['No', -2.05]] },
        { t: 'Maybe',   g: '기타',  toks: [['Maybe', -3.50]] },
        { t: 'Unclear', g: '기타',  toks: [['Unclear', -4.30]] }
      ]
    },
    s2: {
      name: '길이 불균형',
      desc: '"예"는 1토큰, "아니오"는 3토큰입니다. 첫 토큰만 보면 아니오, 합산하면 예, 토큰당 평균을 내면 다시 아니오 — 세 방식이 전부 다른 답을 냅니다.',
      cands: [
        { t: '예',       g: '예',    toks: [['예', -0.95]] },
        { t: '아니오',    g: '아니오', toks: [['아', -0.75], ['니', -0.35], ['오', -0.05]] },
        { t: '불확실',    g: '기타',  toks: [['불', -2.60], ['확', -0.42], ['실', -0.08]] },
        { t: '해당 없음', g: '기타',  toks: [['해', -3.30], ['당', -0.35], ['␣없', -0.20], ['음', -0.06]] }
      ]
    },
    s3: {
      name: '접두 충돌',
      desc: '"있음"과 "있을 수 있음"의 첫 토큰이 같습니다. 첫 토큰 근사는 정반대 뜻의 두 후보에 똑같은 점수를 줍니다 — 근사가 아니라 아예 구분 불능입니다.',
      cands: [
        { t: '있음',        g: '예',    toks: [['있', -0.30], ['음', -0.18]] },
        { t: '있을 수 있음', g: '기타',  toks: [['있', -0.30], ['을', -1.90], ['␣수', -0.10], ['␣있', -0.12], ['음', -0.04]] },
        { t: '없음',        g: '아니오', toks: [['없', -1.60], ['음', -0.06]] },
        { t: '확인 불가',    g: '기타',  toks: [['확', -3.10], ['인', -0.22], ['␣불', -0.30], ['가', -0.05]] }
      ]
    },
    s4: {
      name: '표면형 분산',
      desc: '같은 뜻의 "예"가 네 가지 표면형으로 갈려 확률 질량을 나눠 가집니다. 어느 하나만 후보로 올리면 결론이 뒤집힙니다.',
      cands: [
        { t: '␣Yes', g: '예',    toks: [['␣Yes', -0.62]] },
        { t: 'Yes',  g: '예',    toks: [['Yes', -2.30]] },
        { t: 'yes',  g: '예',    toks: [['yes', -3.40]] },
        { t: 'YES',  g: '예',    toks: [['Y', -4.35], ['ES', -0.65]] },
        { t: '␣No',  g: '아니오', toks: [['␣No', -1.61]] }
      ]
    }
  };

  var cur = 's2', alpha = 1.0;

  function sumLp(c) {
    var s = 0;
    for (var i = 0; i < c.toks.length; i++) s += c.toks[i][1];
    return s;
  }
  /* 내림차순 순위. 동점은 같은 순위를 받는다(첫 토큰 충돌을 드러내기 위해). */
  function ranks(v) {
    var sorted = v.slice().sort(function (a, b) { return b - a; });
    return v.map(function (x) {
      for (var i = 0; i < sorted.length; i++) {
        if (Math.abs(sorted[i] - x) < 1e-12) return i + 1;
      }
      return v.length;
    });
  }
  /* α에서의 전체 순위(내림차순 인덱스 배열) */
  function orderAt(cands, a) {
    var v = cands.map(function (c) { return sumLp(c) / Math.pow(c.toks.length, a); });
    return cands.map(function (c, i) { return i; })
                .sort(function (x, y) { return v[y] - v[x]; });
  }
  /* α를 0에서 1까지 밀 때 순위가 처음 뒤집히는 지점과, 그 자리를 주고받은 두 후보 */
  function firstFlip(cands) {
    var o0 = orderAt(cands, 0);
    for (var a = 0.01; a <= 1.0001; a += 0.01) {
      var o = orderAt(cands, a);
      for (var i = 0; i < o.length; i++) {
        if (o[i] !== o0[i]) {
          return { a: a, rank: i + 1, from: cands[o0[i]].t, to: cands[o[i]].t };
        }
      }
    }
    return null;
  }

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function cell(val, rk, best) {
    var cls = rk === 1 ? ' class="win"' : '';
    return '<td class="num"' + cls + '>' + val.toFixed(3) +
           ' <span class="rk">#' + rk + (best > 1 && rk === 1 ? '=' : '') + '</span></td>';
  }

  function render() {
    var sc = SCEN[cur], cands = sc.cands;
    var first = cands.map(function (c) { return c.toks[0][1]; });
    var sums = cands.map(sumLp);
    var lens = cands.map(function (c) { return c.toks.length; });
    var norm = sums.map(function (v, i) { return v / Math.pow(lens[i], alpha); });
    var rf = ranks(first), rs = ranks(sums), rn = ranks(norm);
    var tiedFirst = rf.filter(function (x) { return x === 1; }).length;

    var h = '<div class="tablebox"><table><thead><tr>' +
      '<th>후보</th><th>토큰 분절 · 토큰별 log p</th><th>길이</th>' +
      '<th>첫 토큰</th><th>시퀀스 합산</th><th>길이 정규화</th>' +
      '</tr></thead><tbody>';
    cands.forEach(function (c, i) {
      h += '<tr><td><b>' + esc(c.t) + '</b><br><span class="grp">' + esc(c.g) + '</span></td><td class="tk">';
      c.toks.forEach(function (t) {
        h += '<i>' + esc(t[0]) + '<em>' + t[1].toFixed(2) + '</em></i>';
      });
      h += '</td><td class="num">' + lens[i] + '</td>' +
           cell(first[i], rf[i], tiedFirst) +
           cell(sums[i], rs[i], 1) +
           cell(norm[i], rn[i], 1) + '</tr>';
    });
    h += '</tbody></table></div>';
    out.innerHTML = h;

    /* --- 그룹별 확률 질량 --- */
    var mass = {};
    cands.forEach(function (c, i) { mass[c.g] = (mass[c.g] || 0) + Math.exp(sums[i]); });
    var yes = mass['예'] || 0, no = mass['아니오'] || 0, etc = mass['기타'] || 0;
    var tot = yes + no + etc;

    var st = document.getElementById('tk_stat');
    if (st) {
      st.innerHTML =
        '후보 총질량 <b class="sm">' + tot.toFixed(3) + '</b><br>' +
        '예 계열 ' + yes.toFixed(3) + ' · 아니오 계열 ' + no.toFixed(3) +
        ' · 기타 <span class="warn">' + etc.toFixed(3) + '</span><br>' +
        '전체 재정규화 p(예) <b>' + (tot ? yes / tot : 0).toFixed(3) + '</b><br>' +
        '예·아니오만 p(예) <b>' + ((yes + no) ? yes / (yes + no) : 0).toFixed(3) + '</b>';
    }

    var wf = cands[rf.indexOf(1)].t, ws = cands[rs.indexOf(1)].t, wn = cands[rn.indexOf(1)].t;
    var win = document.getElementById('tk_win');
    if (win) {
      win.innerHTML =
        '첫 토큰 근사 → <b>' + esc(wf) + '</b>' +
        (tiedFirst > 1 ? ' <span class="warn">(동점 ' + tiedFirst + '개 · 구분 불가)</span>' : '') +
        '<br>시퀀스 합산 → <b>' + esc(ws) + '</b>' +
        '<br>길이 정규화(α=' + alpha.toFixed(2) + ') → <b>' + esc(wn) + '</b>';
    }

    var vd = document.getElementById('tk_verdict');
    if (vd) {
      var flip = firstFlip(cands);
      var extra = '';
      if (cur === 's4') {
        var p = cands.map(function (c, i) { return Math.exp(sums[i]); });
        extra = ' 후보를 {"Yes", "␣No"}로만 잡으면 p(예)=' +
                (p[1] / (p[1] + p[4])).toFixed(3) + ' 이라 "아니오"로 판정되지만, ' +
                '예 계열 네 형태를 모두 더하면 p(예)=' +
                ((p[0] + p[1] + p[2] + p[3]) / (p[0] + p[1] + p[2] + p[3] + p[4])).toFixed(3) +
                ' — 결론이 뒤집힙니다.';
      } else if (flip) {
        extra = ' α를 ' + flip.a.toFixed(2) + ' 부근까지 올리면 순위가 뒤집힙니다 — ' +
                flip.rank + '위 자리가 "' + flip.from + '"에서 "' + flip.to + '"로 넘어갑니다.';
      } else {
        extra = ' α를 0에서 1까지 밀어도 1위는 바뀌지 않습니다.';
      }
      vd.textContent = sc.desc + extra;
    }
  }

  var segs = document.querySelectorAll('#tk_mode button');
  Array.prototype.forEach.call(segs, function (b) {
    b.addEventListener('click', function () {
      Array.prototype.forEach.call(segs, function (x) { x.classList.remove('sel'); });
      b.classList.add('sel');
      cur = b.getAttribute('data-s');
      render();
    });
  });
  var al = document.getElementById('tk_alpha'), alv = document.getElementById('tk_alphav');
  if (al) al.addEventListener('input', function () {
    alpha = parseFloat(al.value);
    if (alv) alv.textContent = alpha.toFixed(2);
    render();
  });
  if (alv) alv.textContent = alpha.toFixed(2);

  render();
})();
