/* LAB 1-1 — 패치 분할 실습
   외부 이미지 없이 캔버스로 합성 장면을 그리고, 해상도/패치 크기에 따라
   이미지 토큰 수와 어텐션 비용이 어떻게 움직이는지 보여준다. */
(function () {
  'use strict';
  var RES = [224, 336, 448, 672], PAT = [8, 16, 32];
  var cv = document.getElementById('cv');
  if (!cv) return;
  var cx = cv.getContext('2d');
  var res = document.getElementById('res'), pat = document.getElementById('pat');
  var resV = document.getElementById('resV'), patV = document.getElementById('patV');
  var ntok = document.getElementById('ntok'), cost = document.getElementById('cost');
  var grid = document.getElementById('grid'), seqEl = document.getElementById('seq');

  /* 합성 장면: 하늘 · 해 · 산 · 들판 · 집 · 개 한 마리 */
  function scene(w) {
    cx.clearRect(0, 0, w, w);
    var g = cx.createLinearGradient(0, 0, 0, w * 0.62);
    g.addColorStop(0, '#7fb6d9'); g.addColorStop(1, '#cfe3ee');
    cx.fillStyle = g; cx.fillRect(0, 0, w, w * 0.62);
    cx.fillStyle = '#e8c765';
    cx.beginPath(); cx.arc(w * 0.78, w * 0.2, w * 0.08, 0, 7); cx.fill();
    cx.fillStyle = '#5c7d5a';
    cx.beginPath(); cx.moveTo(0, w * 0.62); cx.lineTo(w * 0.33, w * 0.3);
    cx.lineTo(w * 0.62, w * 0.62); cx.closePath(); cx.fill();
    cx.fillStyle = '#46604a';
    cx.beginPath(); cx.moveTo(w * 0.4, w * 0.62); cx.lineTo(w * 0.7, w * 0.38);
    cx.lineTo(w, w * 0.62); cx.closePath(); cx.fill();
    cx.fillStyle = '#9db98a'; cx.fillRect(0, w * 0.62, w, w * 0.38);
    cx.fillStyle = '#b5563e'; cx.fillRect(w * 0.14, w * 0.66, w * 0.2, w * 0.16);
    cx.fillStyle = '#7d3a2a';
    cx.beginPath(); cx.moveTo(w * 0.11, w * 0.66); cx.lineTo(w * 0.24, w * 0.56);
    cx.lineTo(w * 0.37, w * 0.66); cx.closePath(); cx.fill();
    cx.fillStyle = '#e9ddc8'; cx.fillRect(w * 0.205, w * 0.73, w * 0.05, w * 0.09);
    cx.fillStyle = '#3c3f45'; cx.fillRect(w * 0.55, w * 0.7, w * 0.11, w * 0.07);
    cx.fillStyle = '#2b2e33'; cx.fillRect(w * 0.565, w * 0.665, w * 0.08, w * 0.035);
    cx.beginPath();
    cx.arc(w * 0.575, w * 0.785, w * 0.018, 0, 7);
    cx.arc(w * 0.645, w * 0.785, w * 0.018, 0, 7);
    cx.fillStyle = '#1c1e22'; cx.fill();
  }

  function draw() {
    var w = RES[res.value], p = PAT[pat.value];
    cv.width = w; cv.height = w;
    cv.style.width = Math.min(336, w) + 'px'; cv.style.height = cv.style.width;
    scene(w);
    var n = Math.floor(w / p);
    cx.strokeStyle = 'rgba(20,24,32,0.55)';
    cx.lineWidth = Math.max(1, w / 336);
    for (var i = 1; i < n; i++) {
      var t = i * p;
      cx.beginPath(); cx.moveTo(t, 0); cx.lineTo(t, w); cx.stroke();
      cx.beginPath(); cx.moveTo(0, t); cx.lineTo(w, t); cx.stroke();
    }
    var tok = n * n;
    resV.textContent = w + 'px'; patV.textContent = p + 'px';
    ntok.textContent = tok.toLocaleString();
    grid.textContent = n + ' × ' + n;
    cost.textContent = (tok * tok >= 1e6
      ? (tok * tok / 1e6).toFixed(1) + 'M'
      : Math.round(tok * tok / 1e3) + 'k');

    seqEl.innerHTML = '';
    for (var k = 0; k < 6; k++) {
      var s = document.createElement('i'); s.className = 'l'; seqEl.appendChild(s);
    }
    var show = Math.min(tok, 110);
    for (var j = 0; j < show; j++) seqEl.appendChild(document.createElement('i'));
    if (tok > show) {
      var m = document.createElement('span');
      m.className = 'more';
      m.textContent = '… +' + (tok - show).toLocaleString();
      seqEl.appendChild(m);
    }
  }

  res.addEventListener('input', draw);
  pat.addEventListener('input', draw);
  draw();
})();
