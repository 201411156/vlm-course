/* ==========================================================================
   LAB 4-1 — 좌표 문자열 ↔ 박스
   모델이 "말한" 좌표 텍스트를 파싱해 박스로 되돌리고, 정답(GT)과 IoU를 잰다.

   구성
     · 장면      : 캔버스에 직접 그린 합성 도형 4개. GT 박스는 코드에 박아둔다.
     · 프리셋    : 정상 출력 3종(정수 0~1000 / 픽셀 / JSON) + 고장 출력 5종.
     · 파서      : 엄격 정규식 ↔ 느슨한 숫자 추출, 그리고 복구 규칙 4종 토글.
     · 양자화    : 정규화 좌표를 B개 구간으로 반올림 → 이산화 오차와 IoU 상한.
     · 채점      : 라벨 일치 + 탐욕적 IoU 매칭, TP@0.5 / FP / 미검출.
   전부 브라우저 안에서 돈다. 실제 모델을 부르지 않는다.
   ========================================================================== */
(function () {
  'use strict';

  var cvEl = document.getElementById('g1_cv');
  if (!cvEl) return;

  /* 이 장면의 "이미지 픽셀" 좌표계 (화면 표시 크기와 무관하게 고정) */
  var IW = 400, IH = 300;

  var GT = [
    { label: '파란 사각형', box: [40, 60, 124, 148] },
    { label: '파란 사각형', box: [150, 189, 162, 201] },
    { label: '빨간 원',     box: [212, 62, 288, 138] },
    { label: '초록 삼각형', box: [296, 168, 372, 240] }
  ];

  /* --- 출력 프리셋 -------------------------------------------------------
     scale: 이 텍스트가 "원래" 어떤 스케일로 쓰였는가.
     keepScale: true 면 프리셋을 눌러도 해석 스케일을 바꾸지 않는다
                (스케일 혼동을 눈으로 보여주기 위한 장치).
     -------------------------------------------------------------------- */
  var P = {
    int1000: {
      scale: '1000',
      text:
        '<ref>파란 사각형</ref><box>(97,196),(312,500)</box>\n' +
        '<ref>파란 사각형</ref><box>(374,628),(405,668)</box>\n' +
        '<ref>빨간 원</ref><box>(534,210),(716,455)</box>\n' +
        '<ref>초록 삼각형</ref><box>(737,566),(934,803)</box>'
    },
    pixel: {
      scale: 'px',
      text:
        '파란 사각형: [39, 59, 125, 150]\n' +
        '파란 사각형: [150, 188, 162, 200]\n' +
        '빨간 원: [214, 63, 286, 137]\n' +
        '초록 삼각형: [295, 170, 374, 241]'
    },
    json: {
      scale: 'px',
      text:
        '[\n' +
        '  {"label": "파란 사각형", "bbox_2d": [39, 59, 125, 150]},\n' +
        '  {"label": "파란 사각형", "bbox_2d": [150, 188, 162, 200]},\n' +
        '  {"label": "빨간 원", "bbox_2d": [214, 63, 286, 137]},\n' +
        '  {"label": "초록 삼각형", "bbox_2d": [295, 170, 374, 241]}\n' +
        ']'
    },
    /* --- 고장 출력 --- */
    broken: {
      scale: '1000',
      text:
        '<ref>파란 사각형</ref><box>(97,196),(312,500)</box>\n' +
        '<ref>파란 사각형</ref><box>374,628),(405 668</box>\n' +
        '<ref>빨간 원</ref><box>(534,210),(716,455</box>\n' +
        '<ref>초록 삼각형</ref><box>(737,566),(934,803)</box>'
    },
    swap: {
      scale: '1000',
      text:
        '<ref>파란 사각형</ref><box>(312,500),(97,196)</box>\n' +
        '<ref>파란 사각형</ref><box>(405,668),(374,628)</box>\n' +
        '<ref>빨간 원</ref><box>(534,210),(716,455)</box>\n' +
        '<ref>초록 삼각형</ref><box>(934,803),(737,566)</box>'
    },
    unitmix: {
      scale: '1000', keepScale: true,
      text:
        '파란 사각형: [0.098, 0.197, 0.310, 0.493]\n' +
        '파란 사각형: [0.374, 0.628, 0.405, 0.668]\n' +
        '빨간 원: [0.530, 0.207, 0.720, 0.460]\n' +
        '초록 삼각형: [0.740, 0.560, 0.930, 0.800]'
    },
    trunc: {
      scale: '1000',
      text:
        '<ref>파란 사각형</ref><box>(97,196),(312,500)</box>\n' +
        '<ref>파란 사각형</ref><box>(374,628),(405,668)</box>\n' +
        '<ref>빨간 원</ref><box>(534,210),(7'
    },
    halluc: {
      scale: '1000',
      text:
        '<ref>파란 사각형</ref><box>(97,196),(312,500)</box>\n' +
        '<ref>파란 사각형</ref><box>(99,199),(309,497)</box>\n' +
        '<ref>파란 사각형</ref><box>(374,628),(405,668)</box>\n' +
        '<ref>빨간 원</ref><box>(534,210),(716,455)</box>\n' +
        '<ref>초록 삼각형</ref><box>(737,566),(934,803)</box>\n' +
        '<ref>노란 별</ref><box>(120,700),(260,880)</box>'
    }
  };

  var BINS = [50, 100, 250, 500, 1000];

  /* --- DOM ---------------------------------------------------------------- */
  var el = {
    txt:   document.getElementById('g1_txt'),
    bins:  document.getElementById('g1_bins'),
    binsV: document.getElementById('g1_binsv'),
    loose: document.getElementById('g1_loose'),
    sort:  document.getElementById('g1_sort'),
    clamp: document.getElementById('g1_clamp'),
    dedup: document.getElementById('g1_dedup'),
    ok:    document.getElementById('g1_ok'),
    tryN:  document.getElementById('g1_try'),
    tp:    document.getElementById('g1_tp'),
    fp:    document.getElementById('g1_fp'),
    fn:    document.getElementById('g1_fn'),
    iouV:  document.getElementById('g1_iou'),
    ceil:  document.getElementById('g1_ceil'),
    rows:  document.getElementById('g1_rows'),
    note:  document.getElementById('g1_note')
  };
  var presetBtns = document.querySelectorAll('#g1_preset button, #g1_bad button');
  var scaleBtns  = document.querySelectorAll('#g1_scale button');
  var scaleMode = '1000';

  /* --- 파싱 --------------------------------------------------------------
     ① 텍스트를 레코드로 쪼갠다 (JSON 객체 / 줄 / <box> 단위)
     ② 레코드마다 라벨과 숫자 4개를 뽑는다
     ---------------------------------------------------------------------- */
  function records(t) {
    var out = [], i, k;
    t = String(t || '');
    if (t.indexOf('{') >= 0 && t.indexOf('"') >= 0) {
      var m = t.match(/\{[^{}]*\}/g);
      if (m && m.length) return m;
    }
    var lines = t.split(/\n+/);
    for (i = 0; i < lines.length; i++) {
      var L = lines[i].trim();
      if (!L) continue;
      var segs = L.split('</box>');
      if (segs.length > 2) {
        for (k = 0; k < segs.length; k++) {
          if (segs[k].replace(/\s/g, '')) out.push(segs[k] + '</box>');
        }
        continue;
      }
      out.push(L);
    }
    return out;
  }

  function labelOf(rec) {
    var m = rec.match(/<ref>([\s\S]*?)<\/ref>/);
    if (m) return m[1].trim();
    m = rec.match(/"(?:label|name|category|ref)"\s*:\s*"([^"]*)"/);
    if (m) return m[1].trim();
    m = rec.match(/^\s*([^:\[\{\(<]+?)\s*:/);
    if (m) return m[1].trim();
    return '';
  }

  function numsOf(rec, loose) {
    var m;
    if (!loose) {
      /* 엄격 모드: 괄호 구조가 정확히 맞아야 한다 */
      m = rec.match(/\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)\s*,\s*\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)/);
      if (!m) {
        m = rec.match(/\[\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\]/);
      }
      if (!m) return null;
      return [parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3]), parseFloat(m[4])];
    }
    /* 느슨한 모드: 라벨·키 이름을 지우고 남은 숫자 앞 4개를 긁는다 */
    var body = rec.replace(/<ref>[\s\S]*?<\/ref>/g, ' ').replace(/"[^"]*"/g, ' ');
    var all = body.match(/-?\d+(?:\.\d+)?/g);
    if (!all || all.length < 4) return null;
    return [parseFloat(all[0]), parseFloat(all[1]), parseFloat(all[2]), parseFloat(all[3])];
  }

  /* --- 좌표 변환 ---------------------------------------------------------- */
  function toPixel(v) {
    if (scaleMode === 'px') return [v[0], v[1], v[2], v[3]];
    var d = scaleMode === '1000' ? 1000 : 1;
    return [v[0] / d * IW, v[1] / d * IH, v[2] / d * IW, v[3] / d * IH];
  }
  function quantize(b, B) {
    function q(v, span) { return Math.round(v / span * B) / B * span; }
    return [q(b[0], IW), q(b[1], IH), q(b[2], IW), q(b[3], IH)];
  }
  function iou(a, b) {
    var x1 = Math.max(a[0], b[0]), y1 = Math.max(a[1], b[1]);
    var x2 = Math.min(a[2], b[2]), y2 = Math.min(a[3], b[3]);
    var iw = x2 - x1, ih = y2 - y1;
    if (iw <= 0 || ih <= 0) return 0;
    var inter = iw * ih;
    var ua = Math.max(0, a[2] - a[0]) * Math.max(0, a[3] - a[1]);
    var ub = Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);
    var uni = ua + ub - inter;
    return uni > 0 ? inter / uni : 0;
  }
  function norm(s) { return String(s || '').replace(/\s+/g, ''); }

  /* --- 한 번의 전체 계산 --------------------------------------------------- */
  var S = { preds: [], tp: 0, fp: 0, fn: 0, tried: 0, parsed: 0, miou: 0, ceil: 0, ceilMin: 0 };

  function run() {
    var B = BINS[parseInt(el.bins.value, 10)];
    var loose = el.loose.checked, doSort = el.sort.checked;
    var doClamp = el.clamp.checked, doDedup = el.dedup.checked;
    var recs = records(el.txt.value), preds = [], i;

    for (i = 0; i < recs.length; i++) {
      var rec = recs[i];
      var raw = numsOf(rec, loose);
      var p = {
        raw: rec.replace(/\s+/g, ' ').trim(),
        label: labelOf(rec), ok: false, fixes: [], iou: 0, gt: -1, tag: '', why: ''
      };
      if (!raw) {
        p.why = loose ? '숫자 4개를 못 찾음' : '괄호 구조 불일치';
        preds.push(p); continue;
      }
      var b = toPixel(raw);
      if (doSort) {
        if (b[0] > b[2]) { var tx = b[0]; b[0] = b[2]; b[2] = tx; p.fixes.push('x 교환'); }
        if (b[1] > b[3]) { var ty = b[1]; b[1] = b[3]; b[3] = ty; p.fixes.push('y 교환'); }
      }
      if (doClamp) {
        var before = b.join(',');
        b = [Math.min(Math.max(b[0], 0), IW), Math.min(Math.max(b[1], 0), IH),
             Math.min(Math.max(b[2], 0), IW), Math.min(Math.max(b[3], 0), IH)];
        if (b.join(',') !== before) p.fixes.push('클램프');
      }
      b = quantize(b, B);
      p.box = b; p.ok = true;
      preds.push(p);
    }

    /* 중복 제거 — NMS가 없는 자리를 파서가 대신 메운다 */
    if (doDedup) {
      for (i = 0; i < preds.length; i++) {
        if (!preds[i].ok) continue;
        for (var k = 0; k < i; k++) {
          if (!preds[k].ok || preds[k].dup) continue;
          if (norm(preds[k].label) === norm(preds[i].label) &&
              iou(preds[k].box, preds[i].box) > 0.9) {
            preds[i].dup = true; preds[i].ok = false;
            preds[i].why = '중복(IoU>0.9)';
            break;
          }
        }
      }
    }

    /* 탐욕적 매칭 — 라벨이 다르면 짝이 될 수 없다 */
    var pairs = [];
    for (i = 0; i < preds.length; i++) {
      if (!preds[i].ok) continue;
      for (var g = 0; g < GT.length; g++) {
        if (norm(preds[i].label) && norm(preds[i].label) !== norm(GT[g].label)) continue;
        var v = iou(preds[i].box, GT[g].box);
        if (v > 0) pairs.push([v, i, g]);
      }
    }
    pairs.sort(function (a, b2) { return b2[0] - a[0]; });
    var usedP = {}, usedG = {};
    for (i = 0; i < pairs.length; i++) {
      var pr = pairs[i];
      if (usedP[pr[1]] || usedG[pr[2]]) continue;
      usedP[pr[1]] = 1; usedG[pr[2]] = 1;
      preds[pr[1]].iou = pr[0]; preds[pr[1]].gt = pr[2];
    }

    var tp = 0, fp = 0, sum = 0, parsed = 0;
    for (i = 0; i < preds.length; i++) {
      var q = preds[i];
      if (q.dup) { q.tag = 'dup'; continue; }
      if (!q.ok) { q.tag = 'fail'; continue; }
      parsed++;
      if (q.iou >= 0.5) { tp++; sum += q.iou; q.tag = 'tp'; }
      else {
        fp++; q.tag = 'fp';
        if (!q.why) {
          q.why = q.gt < 0 && norm(q.label) && !hasLabel(q.label)
            ? '정답에 없는 라벨' : 'IoU ' + q.iou.toFixed(2) + ' < 0.5';
        }
      }
    }

    /* 이 bin 수에서 도달 가능한 IoU 상한 = GT를 그대로 양자화했을 때의 IoU */
    var cs = 0, cmin = 1;
    for (i = 0; i < GT.length; i++) {
      var c = iou(GT[i].box, quantize(GT[i].box, B));
      cs += c; if (c < cmin) cmin = c;
    }

    S = {
      preds: preds, tp: tp, fp: fp, fn: GT.length - tp,
      tried: recs.length, parsed: parsed,
      miou: tp ? sum / tp : 0, ceil: cs / GT.length, ceilMin: cmin, B: B
    };
  }

  function hasLabel(l) {
    for (var i = 0; i < GT.length; i++) if (norm(GT[i].label) === norm(l)) return true;
    return false;
  }

  /* --- 그리기 -------------------------------------------------------------- */
  function css(n) {
    return getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  }
  var ctx = null, view = 1;
  function layout() {
    var lab = cvEl.closest ? cvEl.closest('.lab') : null;
    var w = lab ? lab.clientWidth - 48 : 380;
    if (w > 380) w = 380;
    if (w < 210) w = 210;
    view = w / IW;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    cvEl.width = Math.round(w * dpr);
    cvEl.height = Math.round(IH * view * dpr);
    cvEl.style.width = w + 'px';
    cvEl.style.height = Math.round(IH * view) + 'px';
    ctx = cvEl.getContext('2d');
    ctx.setTransform(dpr * view, 0, 0, dpr * view, 0, 0);
  }

  function scene(c) {
    c.fillStyle = '#e7e4d9'; c.fillRect(0, 0, IW, IH);
    c.strokeStyle = 'rgba(90,95,105,0.13)'; c.lineWidth = 1;
    for (var x = 40; x < IW; x += 40) {
      c.beginPath(); c.moveTo(x, 0); c.lineTo(x, IH); c.stroke();
    }
    for (var y = 40; y < IH; y += 40) {
      c.beginPath(); c.moveTo(0, y); c.lineTo(IW, y); c.stroke();
    }
    c.fillStyle = '#3f7bd0';
    c.fillRect(40, 60, 84, 88);
    c.fillRect(150, 189, 12, 12);
    c.fillStyle = '#c9503f';
    c.beginPath(); c.arc(250, 100, 38, 0, 7); c.fill();
    c.fillStyle = '#4e9160';
    c.beginPath(); c.moveTo(334, 168); c.lineTo(372, 240); c.lineTo(296, 240);
    c.closePath(); c.fill();
  }

  function rect(c, b, color, dash, width) {
    c.save();
    c.strokeStyle = color; c.lineWidth = width || 2;
    if (dash) c.setLineDash(dash);
    c.strokeRect(b[0], b[1], b[2] - b[0], b[3] - b[1]);
    c.restore();
  }

  function draw() {
    if (!ctx) return;
    var c = ctx;
    c.clearRect(0, 0, IW, IH);
    scene(c);
    var lang = css('--lang') || '#e5ad4f';
    var ok = css('--ok') || '#7dcf8a';
    var bad = css('--bad') || '#d97e7e';
    var i;
    for (i = 0; i < GT.length; i++) rect(c, GT[i].box, lang, [5, 4], 1.5);
    for (i = 0; i < S.preds.length; i++) {
      var p = S.preds[i];
      if (!p.ok) continue;
      var col = p.tag === 'tp' ? ok : bad;
      rect(c, p.box, col, null, 2);
      c.save();
      c.font = '11px "IBM Plex Mono", monospace';
      c.fillStyle = col;
      var ty = p.box[1] - 4 < 10 ? p.box[3] + 12 : p.box[1] - 4;
      c.fillText((p.label || '?') + (p.tag === 'tp' ? ' ' + p.iou.toFixed(2) : ''),
                 Math.max(2, p.box[0]), ty);
      c.restore();
    }
  }

  function rowsHTML() {
    var h = '', i;
    for (i = 0; i < S.preds.length; i++) {
      var p = S.preds[i], cls, tag;
      if (p.tag === 'tp') { cls = 'tp'; tag = 'TP'; }
      else if (p.tag === 'fp') { cls = 'fp'; tag = 'FP'; }
      else if (p.tag === 'dup') { cls = 'dupt'; tag = '중복제거'; }
      else { cls = 'fail'; tag = '파싱실패'; }
      var extra = p.tag === 'tp' ? 'IoU ' + p.iou.toFixed(3) : p.why;
      if (p.fixes && p.fixes.length) extra += ' · 복구: ' + p.fixes.join('+');
      h += '<div><span class="tag ' + cls + '">' + tag + '</span>' +
           '<span class="src">' + esc(cut(p.raw, 46)) + '</span>' +
           '<span class="ex">' + esc(extra) + '</span></div>';
    }
    if (S.fn > 0) {
      h += '<div><span class="tag fail">미검출</span>' +
           '<span class="ex">정답 ' + S.fn + '개가 짝을 못 찾았습니다 — 파싱 실패도 여기로 집계됩니다.</span></div>';
    }
    return h;
  }
  function cut(s, n) { return s.length > n ? s.slice(0, n) + '…' : s; }
  function esc(s) {
    return String(s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function verdict() {
    if (S.tried === 0) return '출력이 비어 있습니다 — 정답 4개 전부 미검출입니다.';
    if (S.parsed === 0) return '한 줄도 파싱되지 않았습니다. 복구 규칙을 켜 보거나 해석 스케일을 바꿔 보세요.';
    if (S.fp >= 3 && S.miou === 0) return '박스가 엉뚱한 곳에 있습니다 — 해석 스케일이 출력 스케일과 다를 때 나타나는 그림입니다.';
    if (S.ceil < 0.9) return 'bin이 너무 성깁니다 — 정답을 그대로 양자화하기만 해도 IoU 상한이 ' + S.ceil.toFixed(2) + '입니다.';
    if (S.tp === GT.length && S.fp === 0) return '전부 맞았습니다. 이제 복구 규칙을 하나씩 꺼 보세요.';
    return 'TP ' + S.tp + ' · FP ' + S.fp + ' · 미검출 ' + S.fn + ' — 어떤 규칙이 이 결과를 만들었는지 아래 목록에서 확인하세요.';
  }

  function refresh() {
    run();
    draw();
    el.ok.textContent = S.parsed;
    el.tryN.textContent = S.tried;
    el.tp.textContent = S.tp;
    el.fp.textContent = S.fp;
    el.fn.textContent = S.fn;
    el.iouV.textContent = S.tp ? S.miou.toFixed(3) : '—';
    el.ceil.textContent = S.ceil.toFixed(3) + ' (최소 ' + S.ceilMin.toFixed(2) + ')';
    el.binsV.textContent = S.B.toLocaleString() + ' bin';
    el.rows.innerHTML = rowsHTML();
    el.note.textContent = verdict();
  }

  /* --- UI ------------------------------------------------------------------ */
  function selectIn(list, btn) {
    Array.prototype.forEach.call(list, function (x) { x.classList.remove('sel'); });
    if (btn) btn.classList.add('sel');
  }
  function setScale(s) {
    scaleMode = s;
    Array.prototype.forEach.call(scaleBtns, function (b) {
      b.classList.toggle('sel', b.getAttribute('data-s') === s);
    });
  }

  Array.prototype.forEach.call(presetBtns, function (b) {
    b.addEventListener('click', function () {
      var key = b.getAttribute('data-p'), pre = P[key];
      if (!pre) return;
      selectIn(presetBtns, b);
      el.txt.value = pre.text;
      if (!pre.keepScale) setScale(pre.scale);
      refresh();
    });
  });
  Array.prototype.forEach.call(scaleBtns, function (b) {
    b.addEventListener('click', function () {
      setScale(b.getAttribute('data-s'));
      refresh();
    });
  });
  el.txt.addEventListener('input', refresh);
  el.bins.addEventListener('input', refresh);
  ['loose', 'sort', 'clamp', 'dedup'].forEach(function (k) {
    el[k].addEventListener('change', refresh);
  });

  var rt = null;
  window.addEventListener('resize', function () {
    if (rt) clearTimeout(rt);
    rt = setTimeout(function () { layout(); draw(); }, 120);
  });
  new MutationObserver(function () { draw(); }).observe(document.documentElement,
    { attributes: true, attributeFilter: ['data-theme'] });

  el.txt.value = P.int1000.text;
  setScale('1000');
  layout();
  refresh();
})();
