(function () {
  'use strict';

  /* ===== Theme ===== */
  var html = document.documentElement;
  var savedTheme = localStorage.getItem('theme') || 'light';
  html.setAttribute('data-theme', savedTheme);

  document.getElementById('themeToggle').addEventListener('click', function () {
    var current = html.getAttribute('data-theme');
    var next = current === 'light' ? 'dark' : 'light';
    html.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
  });

  /* ===== Elements ===== */
  var loading = document.getElementById('loading');
  var errorBox = document.getElementById('error');
  var grid = document.getElementById('contentGrid');
  var slotBadge = document.getElementById('slotBadge');
  var metaDate = document.getElementById('metaDate');
  var metaCount = document.getElementById('metaCount');
  var filterBar = document.getElementById('filterBar');
  var footerInfo = document.getElementById('footerInfo');
  var historyNav = document.getElementById('historyNav');
  var historyScroll = document.getElementById('historyScroll');

  /* ===== Slot 简短标签 ===== */
  function slotShort(key, label) {
    var map = {
      'weekday-morning': '早·同事',
      'weekday-evening': '晚·工作生活',
      'weekend-morning': '早·家庭',
      'weekend-evening': '晚·家庭',
    };
    return map[key] || (label ? label.slice(0, 6) : key);
  }

  /* ===== 加载内容（最新或历史归档） ===== */
  function loadContent(url) {
    loading.style.display = 'flex';
    grid.style.display = 'none';
    errorBox.style.display = 'none';
    return fetch(url + '?t=' + Date.now())
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (data) {
        loading.style.display = 'none';
        grid.style.display = 'grid';
        render(data);
      })
      .catch(function (err) {
        loading.style.display = 'none';
        errorBox.style.display = 'flex';
        console.error('Load error:', err);
      });
  }

  /* ===== 渲染历史导航 ===== */
  function renderHistory(items) {
    if (!items || !items.length) return;
    historyNav.style.display = 'flex';
    historyScroll.innerHTML = '';
    items.forEach(function (it, i) {
      var chip = document.createElement('button');
      chip.className = 'history-chip';
      if (i === 0) chip.classList.add('active');
      var dateParts = (it.date || '').split('-');
      var dateStr = (dateParts[1] || '') + '/' + (dateParts[2] || '');
      var html = '';
      if (i === 0) html += '<span class="latest-badge">最新</span>';
      html += '<span class="chip-date">' + esc(dateStr) + '</span>' +
              '<span class="chip-slot">' + esc(slotShort(it.slot, it.slot_label)) + '</span>';
      chip.innerHTML = html;
      chip.addEventListener('click', function () {
        if (chip.classList.contains('active')) return;
        document.querySelectorAll('.history-chip').forEach(function (c) {
          c.classList.remove('active');
        });
        chip.classList.add('active');
        loadContent('data/' + it.file);
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
      historyScroll.appendChild(chip);
    });
  }

  /* ===== 启动：加载最新内容 + 历史索引 ===== */
  loadContent('data/content.json');
  fetch('data/history.json?t=' + Date.now())
    .then(function (res) { return res.ok ? res.json() : null; })
    .then(function (hist) {
      if (hist && hist.items) renderHistory(hist.items);
    })
    .catch(function () { /* 历史索引加载失败不影响主内容展示 */ });

  function render(data) {
    /* Slot badge */
    if (data.slot_label) slotBadge.textContent = data.slot_label;

    /* Meta */
    if (data.generated_at) {
      var d = new Date(data.generated_at);
      var weekdays = ['日','一','二','三','四','五','六'];
      var dateStr = d.getFullYear() + '年' + (d.getMonth()+1) + '月' + d.getDate() + '日';
      var weekday = '星期' + weekdays[d.getDay()];
      var hh = String(d.getHours()).padStart(2,'0');
      var mm = String(d.getMinutes()).padStart(2,'0');
      metaDate.textContent = dateStr + ' ' + weekday;
      var total = (data.categories || []).reduce(function (s, c) {
        return s + (c.items ? c.items.length : 0);
      }, 0);
      metaCount.textContent = total + ' 个话题';
      footerInfo.textContent = '生成于 ' + dateStr + ' ' + weekday + ' ' + hh + ':' + mm;
    }

    /* Filter bar */
    var categories = data.categories || [];
    filterBar.innerHTML = '';
    var allChip = mkChip('全部', null);
    allChip.classList.add('active');
    filterBar.appendChild(allChip);
    categories.forEach(function (cat) {
      var chip = mkChip((cat.icon || '') + ' ' + cat.name, cat.name);
      filterBar.appendChild(chip);
    });

    /* Cards */
    grid.innerHTML = '';
    var delay = 0;
    categories.forEach(function (cat) {
      (cat.items || []).forEach(function (item) {
        var card = createCard(cat, item, delay);
        grid.appendChild(card);
        delay += 0.04;
      });
    });
  }

  function mkChip(label, catName) {
    var chip = document.createElement('button');
    chip.className = 'filter-chip';
    chip.textContent = label;
    chip.addEventListener('click', function () {
      document.querySelectorAll('.filter-chip').forEach(function (c) {
        c.classList.remove('active');
      });
      chip.classList.add('active');
      document.querySelectorAll('.card').forEach(function (card) {
        if (!catName || card.dataset.category === catName) {
          card.style.display = '';
        } else {
          card.style.display = 'none';
        }
      });
    });
    return chip;
  }

  /* ===== 原文链接：有真实 source 用之，否则降级为搜索 ===== */
  function buildSourceLink(item) {
    var src = item.source || '';
    var isUrl = /^https?:\/\/\S+$/i.test(src.trim());
    var url, label;
    if (isUrl) {
      url = src.trim();
      label = '👉 原文';
    } else {
      var q = ((item.title || '') + ' ' + (item.summary || '')).trim();
      url = 'https://www.bing.com/search?q=' + encodeURIComponent(q);
      label = '👉 搜索原文';
    }
    return '<a class="detail-link" href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">' +
           esc(label) + '</a>';
  }

  function createCard(cat, item, delay) {
    var card = document.createElement('div');
    card.className = 'card';
    card.dataset.category = cat.name;
    card.style.animationDelay = delay + 's';

    var tagsHtml = '';
    if (item.tags && item.tags.length) {
      tagsHtml = '<div class="card-tags">' +
        item.tags.map(function (t) {
          return '<span class="tag">' + esc(t) + '</span>';
        }).join('') + '</div>';
    }

    card.innerHTML =
      '<span class="card-category">' + esc(cat.icon || '') + ' ' + esc(cat.name) + '</span>' +
      '<h3 class="card-title">' + esc(item.title) + '</h3>' +
      '<p class="card-summary">' + esc(item.summary) + '</p>' +
      '<div class="card-detail">' +
        '<div class="detail-section">' +
          '<p class="detail-label">📖 详细</p>' +
          '<p class="detail-text">' + esc(item.detail) + '</p>' +
          buildSourceLink(item) +
        '</div>' +
        '<div class="usage-box">' +
          '<p class="usage-label">💬 怎么聊</p>' +
          '<p class="usage-text">' + esc(item.usage) + '</p>' +
        '</div>' +
        tagsHtml +
      '</div>' +
      '<button class="card-expand-btn"><span class="card-expand-btn-text">展开详情</span></button>';

    card.addEventListener('click', function (e) {
      card.classList.toggle('expanded');
      var btn = card.querySelector('.card-expand-btn-text');
      btn.textContent = card.classList.contains('expanded') ? '收起' : '展开详情';
    });

    /* 点击原文链接不触发卡片折叠 */
    var link = card.querySelector('.detail-link');
    if (link) {
      link.addEventListener('click', function (e) {
        e.stopPropagation();
      });
    }

    return card;
  }

  function esc(str) {
    if (!str) return '';
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
})();
