/* 용어집 페이지 — 분류별로 묶어 그리고, 검색창으로 즉시 거릅니다. */
(function () {
  'use strict';
  var body = document.getElementById('glbody');
  var q = document.getElementById('glq');
  var count = document.getElementById('glcount');
  var DATA = window.VLM_GLOSSARY;
  if (!body || !DATA) return;

  var ORDER = ['구조', '연산', '모델', '학습', '방법', '평가', '데이터',
               '비용', '서빙', '런타임', '비디오', '에이전트'];

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  /* 한글 → 영문 순, 각 묶음 안에서는 표기 기준 정렬 */
  function cmp(a, b) {
    var x = a.t[0], y = b.t[0];
    var hx = /^[가-힣]/.test(x), hy = /^[가-힣]/.test(y);
    if (hx !== hy) return hx ? -1 : 1;
    return x.localeCompare(y, 'ko');
  }

  function render(filter) {
    var f = (filter || '').trim().toLowerCase();
    var groups = {}, shown = 0;
    DATA.forEach(function (e) {
      if (f) {
        var hay = (e.t.join(' ') + ' ' + e.s + ' ' + (e.b || '') + ' ' + e.k).toLowerCase();
        if (hay.indexOf(f) < 0) return;
      }
      (groups[e.k] = groups[e.k] || []).push(e);
      shown++;
    });
    var keys = ORDER.filter(function (k) { return groups[k]; })
      .concat(Object.keys(groups).filter(function (k) { return ORDER.indexOf(k) < 0; }));
    var html = '';
    keys.forEach(function (k) {
      groups[k].sort(cmp);
      html += '<section class="glgroup"><div class="k">' + esc(k) + '</div>' +
              '<h2>' + esc(k) + ' <span style="color:var(--tx3);font-size:13px">' +
              groups[k].length + '</span></h2><ul class="gllist">';
      groups[k].forEach(function (e) {
        html += '<li id="' + esc(e.id) + '">' +
          '<a class="ch" href="chapters/' + esc(e.c) + '.html">' + esc(e.c) + '장</a>' +
          '<span class="term">' + esc(e.t[0]) + '</span>' +
          (e.t.length > 1 ? '<span class="alt">' + esc(e.t.slice(1).join(' · ')) + '</span>' : '') +
          '<p>' + esc(e.s) + '</p>' +
          (e.b ? '<p class="bridge">' + esc(e.b) + '</p>' : '') +
          '</li>';
      });
      html += '</ul></section>';
    });
    body.innerHTML = html || '<p class="glempty">검색 결과가 없습니다.</p>';
    count.textContent = f ? shown + ' / ' + DATA.length + '개' : DATA.length + '개 용어';
    if (!f && location.hash) {
      var el = document.getElementById(location.hash.slice(1));
      if (el) el.scrollIntoView({ block: 'center' });
    }
  }

  var t = 0;
  q.addEventListener('input', function () {
    clearTimeout(t);
    t = setTimeout(function () { render(q.value); }, 80);
  });
  q.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { q.value = ''; render(''); }
  });
  render('');
})();
