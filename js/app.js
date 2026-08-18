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

  /* ================================================================
   * 默认视图规则：
   *   - 周一 ~ 周五白天（周五 18 点前）→ 工作·生活
   *   - 周五 18 点后 + 周六/周日 → 育儿
   * FRIDAY_DEFAULT_HOUR 可调（24 小时制），改这里即可调整切换时刻。
   * ================================================================ */
  var FRIDAY_DEFAULT_HOUR = 18;
  function defaultViewName() {
    var now = new Date();
    var day = now.getDay(); // 0=周日 6=周六
    if (day === 0 || day === 6) return 'parenting';
    if (day === 5 && now.getHours() >= FRIDAY_DEFAULT_HOUR) return 'parenting';
    return 'main';
  }

  /* ===== 通用工具 ===== */
  function esc(str) {
    if (!str) return '';
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function slotShort(key, label) {
    var map = {
      'weekday-morning': '早·同事',
      'weekday-evening': '晚·生活',
      'weekend-morning': '早·家庭',
      'weekend-evening': '晚·家庭',
    };
    return map[key] || (label ? label.slice(0, 6) : key);
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

  /* ===== 卡片 ===== */
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

  /* ================================================================
   * 视图工厂：每个视图独立持有 DOM 引用 + 状态。
   * 关键设计：切换视图只改 display，不销毁 DOM——
   *   已展开的卡片、筛选选中、历史选中天然保留；
   *   滚动位置手动保存/恢复；数据只加载一次，之后走缓存。
   * ================================================================ */
  var VIEW_SPECS = {
    main: {
      latest: 'data/content.json',
      history: 'data/history.json',
      emptyIcon: '💼',
      emptyTitle: '内容加载中…',
      emptyText: '',
      emptySub: '',
    },
    parenting: {
      latest: 'data/parenting.json',
      history: 'data/parenting-history.json',
      emptyIcon: '👨‍👧',
      emptyTitle: '育儿页 · 爸爸的每日“谈话弹药”',
      emptyText: '科学奇人 · 文人风骨 · 兴趣深耕 · 思维启蒙 · 亲子行动 · 育儿心法',
      emptySub: '内容方向已规划，即将每天定时生成推送，敬请期待 👶',
    },
  };

  function createView(name, cfg) {
    var p = name + '-';
    var els = {
      root: document.getElementById('view-' + name),
      loading: document.getElementById(p + 'loading'),
      error: document.getElementById(p + 'error'),
      grid: document.getElementById(p + 'contentGrid'),
      empty: document.getElementById(p + 'empty'),
      emptyIcon: document.getElementById(p + 'emptyIcon'),
      emptyTitle: document.getElementById(p + 'emptyTitle'),
      emptyText: document.getElementById(p + 'emptyText'),
      emptySub: document.getElementById(p + 'emptySub'),
      slotBadge: document.getElementById(p + 'slotBadge'),
      metaDate: document.getElementById(p + 'metaDate'),
      metaCount: document.getElementById(p + 'metaCount'),
      filterBar: document.getElementById(p + 'filterBar'),
      footerInfo: document.getElementById(p + 'footerInfo'),
      costInfo: document.getElementById(p + 'costInfo'),
      sourcesInfo: document.getElementById(p + 'sourcesInfo'),
      historyNav: document.getElementById(p + 'historyNav'),
      historyScroll: document.getElementById(p + 'historyScroll'),
    };
    var state = { loaded: false, scrollTop: 0 };
    var filterCat = null;

    function loadFile(url) {
      state.loaded = true;
      els.loading.style.display = 'flex';
      els.grid.style.display = 'none';
      els.error.style.display = 'none';
      els.empty.style.display = 'none';
      return fetch(url + '?t=' + Date.now())
        .then(function (res) {
          if (res.status === 404) return null;
          if (!res.ok) throw new Error('HTTP ' + res.status);
          return res.json();
        })
        .then(function (data) {
          els.loading.style.display = 'none';
          if (!data || !data.categories || !data.categories.length) {
            showEmpty();
            return;
          }
          render(data);
        })
        .catch(function (err) {
          els.loading.style.display = 'none';
          els.error.style.display = 'flex';
          console.error('[' + name + '] Load error:', err);
        });
    }

    function showEmpty() {
      els.grid.style.display = 'none';
      els.empty.style.display = 'flex';
      els.emptyIcon.textContent = cfg.emptyIcon || '';
      els.emptyTitle.textContent = cfg.emptyTitle || '';
      els.emptyText.textContent = cfg.emptyText || '';
      els.emptySub.textContent = cfg.emptySub || '';
    }

    function render(data) {
      /* Slot badge */
      els.slotBadge.textContent = data.slot_label || '梗日报';

      /* Meta */
      if (data.generated_at) {
        var d = new Date(data.generated_at);
        var weekdays = ['日', '一', '二', '三', '四', '五', '六'];
        var dateStr = d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日';
        var weekday = '星期' + weekdays[d.getDay()];
        var hh = String(d.getHours()).padStart(2, '0');
        var mm = String(d.getMinutes()).padStart(2, '0');
        els.metaDate.textContent = dateStr + ' ' + weekday;
        var total = (data.categories || []).reduce(function (s, c) {
          return s + (c.items ? c.items.length : 0);
        }, 0);
        els.metaCount.textContent = total + ' 个话题';
        els.footerInfo.textContent = '生成于 ' + dateStr + ' ' + weekday + ' ' + hh + ':' + mm;
      }

      /* Cost / token 统计 */
      if (data.meta) {
        var m = data.meta;
        var modelName = m.actual_model || m.model || '';
        var tokens = m.total_tokens != null ? m.total_tokens : 0;
        var isFree = m.free === true || m.cost_usd === 0;
        var text;
        els.costInfo.classList.remove('free', 'costly');
        if (isFree) {
          text = '🎉 本次生成使用 ' + modelName + ' · 消耗 ' + tokens + ' tokens · 花费 $0 —— 免费模型，没花钱！';
          els.costInfo.classList.add('free');
        } else if (m.cost_usd != null) {
          text = '本次生成使用 ' + modelName + ' · 消耗 ' + tokens + ' tokens · 花费 $' + m.cost_usd.toFixed(6);
          els.costInfo.classList.add('costly');
        } else {
          text = '本次生成使用 ' + modelName + ' · 消耗 ' + tokens + ' tokens';
        }
        els.costInfo.textContent = text;
      } else {
        els.costInfo.textContent = '';
        els.costInfo.classList.remove('free', 'costly');
      }

      /* 素材来源小字（工作时段生成时才有） */
      if (data.meta && data.meta.sources && data.meta.sources.total > 0) {
        var names = { hackernews: 'Hacker News', askhn: 'HN Ask', reddit: 'Reddit', lobsters: 'Lobste.rs', devto: 'dev.to', v2ex: 'V2EX', juejin: '掘金', github: 'GitHub Trending' };
        var per = data.meta.sources.per_source || {};
        var srcNames = Object.keys(per).filter(function (k) { return (per[k] || 0) > 0; })
          .map(function (k) { return names[k] || k; });
        els.sourcesInfo.textContent = '📡 素材来源：' + srcNames.join(' · ') + '（共 ' + data.meta.sources.total + ' 条热门帖）';
      } else {
        els.sourcesInfo.textContent = '';
      }

      /* Filter bar（加载新数据集时重置为「全部」） */
      filterCat = null;
      els.filterBar.innerHTML = '';
      var allChip = mkChip('全部', null);
      allChip.classList.add('active');
      els.filterBar.appendChild(allChip);
      (data.categories || []).forEach(function (cat) {
        var chip = mkChip((cat.icon || '') + ' ' + cat.name, cat.name);
        els.filterBar.appendChild(chip);
      });

      /* Cards */
      els.grid.innerHTML = '';
      var delay = 0;
      (data.categories || []).forEach(function (cat) {
        (cat.items || []).forEach(function (item) {
          var card = createCard(cat, item, delay);
          els.grid.appendChild(card);
          delay += 0.04;
        });
      });
      els.empty.style.display = 'none';
      els.grid.style.display = 'grid';
    }

    function mkChip(label, catName) {
      var chip = document.createElement('button');
      chip.className = 'filter-chip';
      chip.textContent = label;
      chip.addEventListener('click', function () {
        els.filterBar.querySelectorAll('.filter-chip').forEach(function (c) {
          c.classList.remove('active');
        });
        chip.classList.add('active');
        filterCat = catName;
        els.grid.querySelectorAll('.card').forEach(function (card) {
          card.style.display = (!filterCat || card.dataset.category === filterCat) ? '' : 'none';
        });
      });
      return chip;
    }

    function renderHistory(items) {
      if (!items || !items.length) return;
      els.historyNav.style.display = 'flex';
      els.historyScroll.innerHTML = '';
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
          els.historyScroll.querySelectorAll('.history-chip').forEach(function (c) {
            c.classList.remove('active');
          });
          chip.classList.add('active');
          loadFile('data/' + it.file);
          window.scrollTo({ top: 0, behavior: 'smooth' });
        });
        els.historyScroll.appendChild(chip);
      });
    }

    /* 加载最新内容 + 历史索引（历史索引失败不影响主内容） */
    function loadLatest() {
      return loadFile(cfg.latest).then(function () {
        return fetch(cfg.history + '?t=' + Date.now())
          .then(function (res) { return res.ok ? res.json() : null; })
          .then(function (hist) { if (hist && hist.items) renderHistory(hist.items); })
          .catch(function () {});
      });
    }

    return { name: name, els: els, state: state, loadLatest: loadLatest };
  }

  /* ===== 构建两个视图 ===== */
  var views = {};
  Object.keys(VIEW_SPECS).forEach(function (name) {
    views[name] = createView(name, VIEW_SPECS[name]);
  });

  /* ===== Tab 切换：状态保持（滚动位置保存/恢复、数据缓存、DOM 不重建） ===== */
  var currentViewName = defaultViewName();
  var currentView = views[currentViewName];

  document.getElementById('viewTabs').addEventListener('click', function (e) {
    var tab = e.target.closest('.view-tab');
    if (!tab) return;
    switchView(tab.dataset.view);
  });

  function switchView(name) {
    if (name === currentViewName) return;
    currentView.state.scrollTop = window.scrollY; // 保存当前视图滚动位置
    currentView.els.root.classList.remove('active');
    document.querySelector('.view-tab[data-view="' + currentViewName + '"]').classList.remove('active');

    currentViewName = name;
    currentView = views[name];
    currentView.els.root.classList.add('active');
    document.querySelector('.view-tab[data-view="' + name + '"]').classList.add('active');

    if (!currentView.state.loaded) currentView.loadLatest(); // 首次进入才加载，之后用缓存
    window.scrollTo(0, currentView.state.scrollTop || 0);    // 恢复该视图上次的滚动位置
  }

  /* ===== 启动：激活按时间算出的默认视图并加载 ===== */
  document.querySelectorAll('.view-tab').forEach(function (t) {
    t.classList.toggle('active', t.dataset.view === currentViewName);
  });
  currentView.els.root.classList.add('active');
  currentView.loadLatest();
})();
