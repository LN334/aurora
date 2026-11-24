/* Aurora · 动效实验室
   一套「极光语言」的可交互样本：
   形学极光（帘幕 / 羽化 / 漂移 / 呼吸 / 两段时间尺度），色守自己（外壳无彩，只有封面渗进来）。
   零依赖，file:// 可跑。 */
(function () {
  'use strict';

  /* ============================================================
     0. 数据（封面主色即 --accent 的唯一来源）
     ============================================================ */
  var PLAYLISTS = [
    { id: 'p1', name: '夜航',  sub: '夜里适合一个人听', n: 14, dur: '52 分钟', img: 'cover1.jpg', accent: '#8fb4d9' },
    { id: 'p2', name: '冷杉',  sub: '慢一点，再慢一点', n: 11, dur: '44 分钟', img: 'cover2.jpg', accent: '#7fd4a8' },
    { id: 'p3', name: '缓流',  sub: '无歌词的下午',     n: 18, dur: '78 分钟', img: 'cover3.jpg', accent: '#86c9c4' },
    { id: 'p4', name: '白噪',  sub: '注意力补给',       n: 9,  dur: '36 分钟', img: 'cover4.jpg', accent: '#8ec7a0' },
    { id: 'p5', name: '极夜',  sub: '电子与弦乐',       n: 16, dur: '63 分钟', img: 'cover5.jpg', accent: '#9fb3c4' },
    { id: 'p6', name: '沙丘',  sub: '电影感',           n: 12, dur: '48 分钟', img: 'cover6.jpg', accent: '#8cc9a6' },
    { id: 'p7', name: '铁锈',  sub: '失真与回授',       n: 13, dur: '51 分钟', img: 'cover7.jpg', accent: '#a99bd9' },
    { id: 'p8', name: '晨雾',  sub: '清晨六点',         n: 10, dur: '40 分钟', img: 'cover8.jpg', accent: '#c9b08a' }
  ];

  var TRACKS = [
    { t: '低空飞行',   a: '沈以诚', d: '4:12' },
    { t: '北纬四十度', a: '惘闻',   d: '6:38' },
    { t: '帘幕',       a: 'Aurora', d: '3:47' },
    { t: '雪线下',     a: '袁娅维', d: '4:05' },
    { t: '半衰期',     a: 'Nova',   d: '5:21' },
    { t: '无风的下午', a: '陈粒',   d: '4:44' },
    { t: 'Phosphene',  a: 'Polyn',  d: '3:58' },
    { t: '余烬',       a: '梅卡德尔', d: '5:09' },
    { t: '潮汐锁',     a: 'Luna',   d: '4:26' },
    { t: '白噪 II',    a: 'Aurora', d: '7:02' }
  ];

  /* ============================================================
     1. 小工具
     ============================================================ */
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var html = document.documentElement;
  var SPEED = 1;                       // 慢放系数
  var ms = function (n) { return n * SPEED; };
  var el = function (tag, cls, txt) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt != null) e.textContent = txt;
    return e;
  };
  var clamp = function (v, a, b) { return v < a ? a : v > b ? b : v; };
  // 极光式的场函数：平滑、无过冲
  var smooth = function (t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
  var smoothstep = function (t) { t = clamp(t, 0, 1); return t * t * (10 + t * (-15 + 6 * t)); };

  var cover = function (p) {
    return 'url(assets/' + p.img + ') center / cover no-repeat';
  };
  var hexToRgb = function (h) {
    var n = parseInt(h.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255].join(' ');
  };

  /* ============================================================
     2. 极光天空层（形学极光，色守自己）
     ============================================================ */
  var sky = el('div', 'sky');
  sky.innerHTML =
    '<div class="sky__blob sky__blob--a"></div>' +
    '<div class="sky__blob sky__blob--b"></div>' +
    '<div class="sky__blob sky__blob--c"></div>' +
    '<div class="sky__blob sky__blob--d"></div>' +
    '<div class="sky__src"><div class="sky__source"></div></div>' +
    '<div class="sky__curtain"></div>';
  document.body.insertBefore(sky, document.body.firstChild);

  var sweep = el('div', 'sweep');
  sweep.id = 'sweep';
  document.body.appendChild(sweep);

  /* ============================================================
     3. 渲染：扇形 / 分区 / 网格 / 曲目
     ============================================================ */
  // ---- 三个横排分区：密度是「好看」的一半
  function card(it, onPick) {
    var c = el('div', 'rcard');
    c.innerHTML =
      '<div class="rcard__art" style="--art:url(assets/' + it.img + ')">' +
        (it.src ? '<span class="rcard__src">' + it.src + '</span>' : '') +
      '</div>' +
      '<div class="rcard__t">' + it.t + '</div>' +
      '<div class="rcard__s">' + it.s + '</div>';
    if (onPick) c.addEventListener('click', function () { onPick(it, c.querySelector('.rcard__art')); });
    return c;
  }

  var ALBUMS = [
    { img: 'cover2.jpg', t: 'North of Here',  s: 'Various · 2026' },
    { img: 'cover5.jpg', t: '慢速地球',        s: '惘闻 · 2025' },
    { img: 'cover7.jpg', t: 'Phosphène',      s: 'Pola · 2026' },
    { img: 'cover3.jpg', t: '潮间带',          s: '陈粒 · 2024' },
    { img: 'cover8.jpg', t: 'Quiet Hours',    s: 'Nova · 2026' },
    { img: 'cover6.jpg', t: '沙丘原声',        s: 'H. Zimmer · 2021' }
  ];

  function renderRow(host, items, onPick) {
    host.innerHTML = '';
    items.forEach(function (it) { host.appendChild(card(it, onPick)); });
  }

  function playlistWall() {
    return PLAYLISTS.map(function (p) {
      return { img: p.img, t: p.name, s: p.n + ' 首 · ' + p.dur, src: '本机', p: p };
    });
  }

  renderRow($('#rowPlaylists'), playlistWall(), function (it, artEl) { openDetail(it.p, artEl); });
  renderRow($('#rowAlbums'), ALBUMS, null);
  renderRow($('#rowRecent'), TRACKS.slice(0, 8).map(function (t, i) {
    return { img: PLAYLISTS[i % 8].img, t: t.t, s: t.a + ' · ' + t.d, src: '云' };
  }), function (it, artEl) {
    var idx = TRACKS.findIndex(function (x) { return x.t === it.t; });
    playTrack(TRACKS[idx], PLAYLISTS[idx % 8], null);
  });

  // 舞台电平柱
  var sb = $('#stageBars');
  if (sb) {
    for (var bi = 0; bi < 26; bi++) {
      var bar = document.createElement('i');
      bar.style.animation = 'barJump ' + (0.7 + Math.random() * 0.9).toFixed(2) + 's ease-in-out ' +
                            (-Math.random() * 1.6).toFixed(2) + 's infinite alternate';
      sb.appendChild(bar);
    }
  }

  // 精选栏：五行，右侧常驻，专门用来平衡首屏右侧的重量
  var picksEl = $('#picks');
  [1, 7, 2, 5, 6].forEach(function (idx, i) {
    var p = PLAYLISTS[idx];
    var row = el('li', 'pick');
    row.innerHTML =
      '<span class="pick__art" style="--art:' + cover(p) + '"></span>' +
      '<span class="pick__b"><b>' + p.name + '</b><span>' + p.sub + '</span></span>' +
      '<span class="pick__d">' + String(i + 1).padStart(2, '0') + '</span>';
    row.addEventListener('click', function () { openDetail(p, row.querySelector('.pick__art')); });
    picksEl.appendChild(row);
  });

  // 换一批：真的换顺序，不是假动画
  $$('.sec .link').forEach(function (b) {
    if (b.textContent.indexOf('换一批') < 0) return;
    b.addEventListener('click', function () {
      var wall = playlistWall().sort(function () { return Math.random() - .5; });
      renderRow($('#rowPlaylists'), wall, function (it, artEl) { openDetail(it.p, artEl); });
      $$('#rowPlaylists .rcard').forEach(function (c, i) {
        c.animate(
          [{ opacity: 0, transform: 'translateY(10px) scale(.97)' }, { opacity: 1, transform: 'none' }],
          { duration: ms(420), delay: ms(i * 26), easing: 'cubic-bezier(.22,1,.36,1)', fill: 'backwards' }
        );
      });
    });
  });

  var grid = $('#grid');
  PLAYLISTS.forEach(function (p) {
    var c = el('div', 'card');
    c.style.setProperty('--art', cover(p));
    c.innerHTML = '<div class="card__art"></div>' +
                  '<div class="card__t">' + p.name + '</div>' +
                  '<div class="card__s"><em>' + p.n + ' 首</em>' + p.dur + '</div>';
    c.addEventListener('click', function () { openDetail(p, c.querySelector('.card__art')); });
    // 指针跟随倾斜：位移进 CSS 变量，不写行内 transform
    c.addEventListener('mousemove', function (e) {
      var r = c.getBoundingClientRect();
      var px = (e.clientX - r.left) / r.width - .5;
      var py = (e.clientY - r.top) / r.height - .5;
      c.style.setProperty('--rx', (px * 9).toFixed(2));
      c.style.setProperty('--ry', (-py * 7).toFixed(2));
      c.style.setProperty('--mx', ((px + .5) * 100).toFixed(1) + '%');
      c.style.setProperty('--my', ((py + .5) * 100).toFixed(1) + '%');
    });
    c.addEventListener('mouseleave', function () {
      c.style.setProperty('--rx', '0');
      c.style.setProperty('--ry', '0');
    });
    grid.appendChild(c);
  });

  /* ============================================================
     4. 路由：两层交叉 + 一次扫光
     ============================================================ */
  var current = 'discover';

  function go(name) {
    if (name === current) return;
    var cur = $('.view.is-active');
    var next = $('.view[data-view="' + name + '"]');
    if (!next || !cur) return;

    sweep.classList.remove('is-run');
    void sweep.offsetWidth;
    sweep.classList.add('is-run');

    next.classList.add('is-active', 'is-entering');
    cur.classList.add('is-leaving');
    current = name;

    $$('.rail__item').forEach(function (b) {
      b.classList.toggle('is-active', b.dataset.go === name);
    });

    setTimeout(function () { next.classList.remove('is-entering'); }, ms(900));
    setTimeout(function () { cur.classList.remove('is-active', 'is-leaving'); }, ms(420));
  }

  $$('[data-go]').forEach(function (b) {
    b.addEventListener('click', function () { go(b.dataset.go); });
  });

  /* ============================================================
     5. 轨道：世界 + 相机，不是透视矩阵
     ============================================================ */
  var FAN = PLAYLISTS;
  var pos = 3;          // 连续位置：轨道靠惯性滑，不是一格一格跳
  var target = 3;
  var fanCards = [];
  var fanStage = $('#fanStage');

  FAN.forEach(function (p, i) {
    var c = el('div', 'fan-card');
    c.style.setProperty('--art', 'url(assets/' + p.img + ')');
    c.addEventListener('click', function () { focusOrb(i); });
    fanStage.appendChild(c);
    fanCards.push(c);
  });

  var R = 356;   // 椭圆半长轴
  var H = 124;   // 弧的弓高：中间最高，两侧沿弧下落
  var STEP = 0.285;

  function fanGeom(i) {
    var d = i - pos;
    var a = d * STEP;
    var ad = Math.abs(d);
    return {
      x: Math.sin(a) * R,
      y: (1 - Math.cos(a)) * H,
      ry: -a * 44,                       // 朝环心转，才有纵深
      rz: d * 1.1,
      s: Math.max(0.4, 1 - ad * 0.115),
      op: ad < 4.4 ? Math.max(0, 0.97 - ad * 0.145) : 0,
      z: Math.round(60 - ad * 4),
      ad: ad
    };
  }

  function layoutFan() {
    for (var i = 0; i < fanCards.length; i++) {
      var c = fanCards[i], g = fanGeom(i);
      c.style.transform =
        'translate3d(' + g.x.toFixed(2) + 'px,' + g.y.toFixed(2) + 'px,0) ' +
        'rotateZ(' + g.rz.toFixed(2) + 'deg) rotateY(' + g.ry.toFixed(2) + 'deg) ' +
        'scale(' + g.s.toFixed(3) + ')';
      c.style.opacity = String(g.op);
      c.style.zIndex = String(g.z);
      c.style.pointerEvents = g.ad > 3.2 ? 'none' : 'auto';
      c.classList.toggle('is-center', Math.round(pos) === i && Math.abs(pos - i) < 0.02);
    }
    var near = Math.round(pos);
    var p = FAN[near] || FAN[0];
    $('#fanIdx').textContent = (near + 1) + ' / ' + FAN.length;
    $('#fanTitle').innerHTML = '<b>' + p.name + '</b> · ' + p.sub;
  }

  var raf = 0;
  function tick() {
    var diff = target - pos;
    if (Math.abs(diff) < 0.0015) {
      pos = target;
      layoutFan();
      raf = 0;
      return;
    }
    pos += diff * 0.16;
    layoutFan();
    raf = requestAnimationFrame(tick);
  }
  function kick() { if (!raf) raf = requestAnimationFrame(tick); }

  function focusOrb(i) {
    if (i < 0 || i >= FAN.length) return;
    target = i;
    kick();
    setNow(FAN[i]);
  }

  var fanEl = $('#fan');
  fanEl.addEventListener('wheel', function (ev) {
    ev.preventDefault();
    focusOrb(Math.round(target) + ((ev.deltaY || ev.deltaX) > 0 ? 1 : -1));
  }, { passive: false });

  // 点击距中心一格内的卡 = 播放；更远的 = 挪到中心
  fanStage.addEventListener('click', function () {});

  function setNow(p) {
    html.style.setProperty('--accent', p.accent);
    html.style.setProperty('--accent-rgb', hexToRgb(p.accent));
    var disc = $('#discArt'); if (disc) disc.style.background = cover(p);
    var st = $('#stageTitle'); if (st) st.textContent = p.name;
  }

  var heroPlay = $('#heroPlay');
  heroPlay.addEventListener('click', function () {
    var idx = Math.round(target);
    playTrack(TRACKS[idx % TRACKS.length], FAN[idx], null);
    heroPlay.classList.toggle('is-playing');
  });

  /* ============================================================
     6. 详情：档案头部 + 曲目；封面从卡片飞过来
     ============================================================ */
  var flyingP = null;

  function renderDetail(p) {
    $('#detailCover').style.background = cover(p);
    $('#detailTitle').textContent = p.name;
    $('#detailCount').textContent = p.n + ' 首';
    $('#detailDur').textContent = p.dur;
    var ol = $('#tracks');
    ol.innerHTML = '';
    TRACKS.forEach(function (t, i) {
      var li = el('li', 'trk');
      li.innerHTML = '<span class="trk__i">' + String(i + 1).padStart(2, '0') + '</span>' +
                     '<span class="trk__t">' + t.t + '</span>' +
                     '<span class="trk__a">' + t.a + '</span>' +
                     '<span class="trk__d">' + t.d + '</span>';
      li.addEventListener('click', function () { playTrack(t, p, li); });
      ol.appendChild(li);
    });
  }

  function openDetail(p, fromEl) {
    var from = fromEl.getBoundingClientRect();
    renderDetail(p);
    go('detail');
    // 飞行层：从卡片矩形飞到详情封面矩形（FLIP 的显式版）
    var target = $('#detailCover');
    requestAnimationFrame(function () {
      var to = target.getBoundingClientRect();
      var ghost = el('div', 'fly-ghost');
      ghost.style.background = cover(p);
      ghost.style.left = from.left + 'px';
      ghost.style.top = from.top + 'px';
      ghost.style.width = from.width + 'px';
      ghost.style.height = from.height + 'px';
      ghost.style.borderRadius = '12px';
      document.body.appendChild(ghost);
      var a = ghost.animate(
        [{ transform: 'none', borderRadius: '12px' },
         { transform: 'none', borderRadius: '4px' }],
        { duration: ms(460), easing: 'cubic-bezier(.22,1,.36,1)', fill: 'both' }
      );
      // 位置与尺寸单独补间（避免 scale 造成的模糊与圆角失真）
      ghost.animate(
        [
          { left: from.left + 'px', top: from.top + 'px', width: from.width + 'px', height: from.height + 'px' },
          { left: to.left + 'px', top: to.top + 'px', width: to.width + 'px', height: to.height + 'px' }
        ],
        { duration: ms(460), easing: 'cubic-bezier(.22,1,.36,1)', fill: 'both' }
      ).onfinish = function () {
        target.style.opacity = '1';
        ghost.remove();
      };
      target.style.opacity = '0';
    });
    flyingP = p;
  }

  /* ============================================================
     7. 播放：状态 + 节拍（--beat / --level / --h）
     ============================================================ */
  var playing = false;
  var prog = 0, total = 244;          // 秒
  var beatTimer = 0, bpm = 118;

  function playTrack(t, p, li) {
    $('#pbTitle').textContent = t.t;
    $('#pbArtist').textContent = t.a;
    $('#pbArt').style.background = cover(p);
    $$('.trk').forEach(function (x) { x.classList.remove('is-live'); });
    if (li) li.classList.add('is-live');
    html.style.setProperty('--accent', p.accent);
    html.style.setProperty('--accent-rgb', hexToRgb(p.accent));
    $('#discArt').style.background = cover(p);
    var st = $('#stageTrack'); if (st) st.textContent = t.t;
    var sa = $('#stageArtist'); if (sa) sa.textContent = t.a + ' · ' + p.name;
    playing = true;
    $('#pbPlay').textContent = '❚❚';
    $('#disc').classList.add('is-playing');
    $('.stage').classList.add('is-playing');
    html.style.setProperty('--auro-alpha', '.85');
    tickBeat();
  }

  function tickBeat() {
    clearTimeout(beatTimer);
    if (!playing) { html.style.setProperty('--beat', '0'); return; }
    var period = 60000 / bpm;
    html.style.setProperty('--beat', '1');
    setTimeout(function () {
      html.style.setProperty('--beat', (0.28 + Math.random() * 0.18).toFixed(3));
    }, ms(50));
    beatTimer = setTimeout(tickBeat, ms(period));
  }

  $('#pbPlay').addEventListener('click', function () {
    playing = !playing;
    this.textContent = playing ? '❚❚' : '▶';
    $('#disc').classList.toggle('is-playing', playing);
    $('.stage').classList.toggle('is-playing', playing);
    html.style.setProperty('--auro-alpha', playing ? '.85' : '.5');
    if (playing) tickBeat(); else { clearTimeout(beatTimer); html.style.setProperty('--beat', '0'); }
  });

  // 进度
  setInterval(function () {
    if (!playing) return;
    prog = (prog + 0.5) % total;
    $('#pbFill').style.width = (prog / total * 100) + '%';
    var m = Math.floor(prog / 60), s = Math.floor(prog % 60);
    $('#pbTime').textContent = m + ':' + String(s).padStart(2, '0');
  }, 500);

  // 电平：沿一个安静的随机游走，再被节拍抬起
  var lvl = 0.15, lvlTarget = 0.2;
  setInterval(function () { lvlTarget = 0.1 + Math.random() * 0.7; }, 900);

  /* ============================================================
     8. 舞台可视化：极光下缘的流线
     ============================================================ */
  var viz = $('#viz');
  var vctx = viz.getContext('2d');
  var phase = 0;
  var bars = [];
  for (var i = 0; i < 96; i++) bars.push(0.1);

  function sizeViz() {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    viz.width = Math.floor(viz.clientWidth * dpr);
    viz.height = Math.floor(viz.clientHeight * dpr);
    vctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function drawViz() {
    var w = viz.clientWidth, h = viz.clientHeight;
    if (!w) return;
    vctx.clearRect(0, 0, w, h);
    phase += 0.012;

    var acc = (getComputedStyle(html).getPropertyValue('--accent-rgb').trim() || '125 136 153').replace(/\s+/g, ',');
    var n = bars.length, bw = w / n;

    for (var i = 0; i < n; i++) {
      var t = i / n;
      // 两层噪声叠成一条会蠕动的「光的下缘」
      var wave = Math.sin(t * 6.1 + phase) * .5 + Math.sin(t * 13.7 - phase * .7) * .28 + Math.sin(t * 2.3 + phase * .4) * .22;
      var target = clamp(.18 + wave * .22 + lvl * .5, 0.04, 1);
      bars[i] += (target - bars[i]) * (target > bars[i] ? .34 : .09);   // attack 快、release 慢
      var bh = bars[i] * h * .2;
      var g = vctx.createLinearGradient(0, h, 0, h - bh);
      g.addColorStop(0, 'rgba(' + acc + ',.3)');
      g.addColorStop(.55, 'rgba(' + acc + ',.16)');
      g.addColorStop(1, 'rgba(' + acc + ',0)');
      vctx.fillStyle = g;
      vctx.fillRect(i * bw, h - bh, Math.max(1, bw * .55), bh);
    }
    // 底部一条被压亮的水平光带
    var lg = vctx.createLinearGradient(0, h - 90, 0, h);
    lg.addColorStop(0, 'rgba(' + acc + ',0)');
    lg.addColorStop(1, 'rgba(' + acc + ',.16)');
    vctx.fillStyle = lg;
    vctx.fillRect(0, h - 90, w, 90);
  }

  /* ============================================================
     9. 播放条电平柱
     ============================================================ */
  var pbBars = $('#pbBars');
  var pbEls = [];
  for (var b = 0; b < 22; b++) { var e = document.createElement('i'); pbBars.appendChild(e); pbEls.push(e); }

  function drawBars() {
    for (var i = 0; i < pbEls.length; i++) {
      var t = i / pbEls.length;
      var target = clamp(.12 + Math.abs(Math.sin(t * 5.2 + phase * 1.4)) * (.28 + lvl * .7) + Math.random() * .08, .06, 1);
      pbEls[i].style.setProperty('--h', target.toFixed(3));
    }
  }

  /* ============================================================
     10. 主循环
     ============================================================ */
  function frame() {
    phase += 0.008;
    lvl += (lvlTarget - lvl) * 0.06;
    html.style.setProperty('--level', lvl.toFixed(3));
    var onStage = $('.view[data-view="stage"]').classList.contains('is-active');
    if (onStage) drawViz();
    drawBars();
    requestAnimationFrame(frame);
  }

  /* ============================================================
     11. 面板
     ============================================================ */
  var panel = $('#panel');
  function togglePanel(v) {
    panel.classList.toggle('is-open', v);
    panel.setAttribute('aria-hidden', String(!v));
  }
  $('#openPanel').addEventListener('click', function () { togglePanel(!panel.classList.contains('is-open')); });
  $('#openPanel2').addEventListener('click', function () { togglePanel(!panel.classList.contains('is-open')); });
  $('#closePanel').addEventListener('click', function () { togglePanel(false); });

  $$('.sw input').forEach(function (inp) {
    inp.addEventListener('change', function () {
      var flag = inp.dataset.flag;
      document.body.classList.toggle(flag, inp.checked);
      if (flag === 'slowmo') {
        SPEED = inp.checked ? 4 : 1;
        html.style.setProperty('--sp', SPEED);
      }
      if (flag === 'no-grain') document.body.classList.toggle('no-grain', inp.checked);
    });
  });

  /* ============================================================
     12. 键盘
     ============================================================ */
  document.addEventListener('keydown', function (e) {
    var map = { '1': 'discover', '2': 'playlists', '3': 'stage', '4': 'detail' };
    if (map[e.key]) go(map[e.key]);
    if (e.key === 'Escape') { if (panel.classList.contains('is-open')) togglePanel(false); else go('discover'); }
    if (e.code === 'Space') { e.preventDefault(); $('#pbPlay').click(); }
    if (e.key === 'ArrowRight') { focusOrb(Math.round(target) + 1); }
    if (e.key === 'ArrowLeft') { focusOrb(Math.round(target) - 1); }
  });

  /* ============================================================
     13. 起飞
     ============================================================ */
  sizeViz();
  window.addEventListener('resize', sizeViz);
  var d = new Date();
  $('#dailyDate').textContent = (d.getMonth() + 1) + ' 月 ' + d.getDate() + ' 日';
  layoutFan();
  setNow(FAN[3]);
  layoutFan(true);
  // 播放条初态：一张封面、一个名字，别让左下角空着
  $('#pbTitle').textContent = TRACKS[0].t;
  $('#pbArtist').textContent = TRACKS[0].a;
  $('#pbArt').style.background = cover(PLAYLISTS[0]);
  renderDetail(PLAYLISTS[0]);
  $('.trk') && null;
  // 首帧：让页面从雾里亮起来
  document.body.classList.add('is-born');
  requestAnimationFrame(frame);

  // 给外部的自检句柄（截图脚本用）
  // 直接看某一页：index.html?v=playlists
  var qv = new URLSearchParams(location.search).get('v');
  if (qv && document.querySelector('.view[data-view="' + qv + '"]')) {
    go(qv);
    if (qv === 'detail') { try { openDetail(PLAYLISTS[0], null); } catch (e) {} }
  }

  window.__lab = {
    go: go, focusOrb: focusOrb, play: function () { $('#pbPlay').click(); },
    state: function () { return { view: current, active: Math.round(target), playing: playing, speed: SPEED }; }
  };
})();
