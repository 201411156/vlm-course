/* 목차 페이지 — 챕터 카드와 진행 표시를 VLM.chapters에서 그린다. */
(function () {
  'use strict';
  var toc = document.getElementById('toc');
  if (!toc || !window.VLM) return;

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function render() {
    var live = 0, done = 0, html = '';
    VLM.chapters.forEach(function (ch) {
      var body = '<span class="n">' + ch.n + '</span>' +
                 '<span class="t">' + esc(ch.title) +
                 '<small>' + esc(ch.sub) + '</small></span>';
      if (ch.status === 'live') {
        live++;
        var ok = VLM.progress.complete(ch);
        if (ok) done++;
        html += '<li><a href="' + VLM.href(ch) + '">' + body +
                '<span class="badge ' + (ok ? 'done' : 'live') + '">' +
                (ok ? '완료 ✓' : '공개') + '</span></a></li>';
      } else {
        html += '<li><div class="item">' + body +
                '<span class="badge">집필 중</span></div></li>';
      }
    });
    toc.innerHTML = html;

    var pct = live ? Math.round(done / live * 100) : 0;
    var txt = document.getElementById('prog_txt');
    var bar = document.getElementById('prog_bar');
    if (txt) txt.textContent = done + ' / ' + live + '장';
    if (bar) bar.style.width = pct + '%';
  }

  var rst = document.getElementById('prog_reset');
  if (rst) rst.addEventListener('click', function () {
    if (!window.confirm('이 브라우저에 저장된 진행 기록을 모두 지울까요?')) return;
    VLM.progress.reset();
    render();
    VLM.renderRail(null);
  });

  render();
})();
