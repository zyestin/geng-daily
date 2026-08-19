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

  function fmtTime(ts) {
    var d = new Date(ts);
    var p = function (x) { return String(x).padStart(2, '0'); };
    return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  /* ================================================================
   * 我的笔记：点赞 + 想法碎片。
   * 存 localStorage（key: 视图名|话题标题），刷新/重开浏览器不丢；
   * 头部「📝 我的笔记」面板可汇总查看，并支持导出/导入 JSON 备份。
   * ================================================================ */
  var NOTES_KEY = 'geng-daily-notes-v1';
  var notesStore = {
    data: (function () {
      try { return JSON.parse(localStorage.getItem(NOTES_KEY)) || {}; }
      catch (e) { return {}; }
    })(),
    save: function () {
      try { localStorage.setItem(NOTES_KEY, JSON.stringify(this.data)); } catch (e) {}
      updateNotesBadge();
    },
    toggleLike: function (key, meta) {
      var n = this.data[key] || (this.data[key] = { liked: false, comments: [] });
      n.title = meta.title; n.view = meta.view;
      n.liked = !n.liked;
      if (!n.liked && !(n.comments && n.comments.length)) delete this.data[key];
      this.save();
      return n.liked;
    },
    addComment: function (key, meta, text) {
      var n = this.data[key] || (this.data[key] = { liked: false, comments: [] });
      n.title = meta.title; n.view = meta.view;
      (n.comments = n.comments || []).push({ text: text, ts: Date.now() });
      this.save();
    },
    removeComment: function (key, idx) {
      var n = this.data[key];
      if (!n || !n.comments) return;
      n.comments.splice(idx, 1);
      if (!n.liked && !n.comments.length) delete this.data[key];
      this.save();
    },
  };

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
  function createCard(cat, item, delay, viewName) {
    var card = document.createElement('div');
    card.className = 'card';
    card.dataset.category = cat.name;
    card.style.animationDelay = delay + 's';

    var view = viewName || 'main';
    var noteKey = view + '|' + item.title;
    var note = notesStore.data[noteKey] || { liked: false, comments: [] };
    var noteCount = (note.comments || []).length;

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
      '<div class="card-actions">' +
        '<button class="card-action-btn like-btn' + (note.liked ? ' liked' : '') + '">' +
          '<span class="like-icon">' + (note.liked ? '❤️' : '🤍') + '</span>' +
          '<span class="like-label">' + (note.liked ? '已赞' : '点赞') + '</span>' +
        '</button>' +
        '<button class="card-action-btn comment-btn">' +
          '<span>💭</span><span>想法</span>' +
          '<span class="comment-count' + (noteCount ? '' : ' zero') + '">' + noteCount + '</span>' +
        '</button>' +
      '</div>' +
      '<div class="card-notes-area">' +
        '<div class="note-input-row">' +
          '<textarea class="note-input" placeholder="写点你联想到的思想碎片、聊天跟进、灵感…" rows="2"></textarea>' +
          '<div class="note-input-actions">' +
            '<span class="note-hint">⌘/Ctrl + Enter 保存</span>' +
            '<button class="note-save-btn">保存</button>' +
          '</div>' +
        '</div>' +
        '<div class="note-list"></div>' +
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

    /* ===== 点赞（localStorage 持久化） ===== */
    var likeBtn = card.querySelector('.like-btn');
    likeBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      var liked = notesStore.toggleLike(noteKey, { title: item.title, view: view });
      likeBtn.classList.toggle('liked', liked);
      likeBtn.querySelector('.like-icon').textContent = liked ? '❤️' : '🤍';
      likeBtn.querySelector('.like-label').textContent = liked ? '已赞' : '点赞';
    });

    /* ===== 想法碎片（localStorage 持久化） ===== */
    var commentBtn = card.querySelector('.comment-btn');
    var notesArea = card.querySelector('.card-notes-area');
    var noteInput = card.querySelector('.note-input');
    var noteList = card.querySelector('.note-list');
    var countEl = card.querySelector('.comment-count');

    function renderNoteList() {
      var n = notesStore.data[noteKey];
      var cs = (n && n.comments) || [];
      noteList.innerHTML = cs.map(function (c, i) {
        return '<div class="note-item">' +
          '<div class="note-item-text">' + esc(c.text) + '</div>' +
          '<div class="note-item-meta">' +
            '<span>' + fmtTime(c.ts) + '</span>' +
            '<button class="note-del-btn" data-idx="' + i + '" title="删除这条">删除</button>' +
          '</div>' +
        '</div>';
      }).join('');
      countEl.textContent = cs.length;
      countEl.classList.toggle('zero', !cs.length);
    }

    commentBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      var hidden = notesArea.style.display !== 'block';
      notesArea.style.display = hidden ? 'block' : 'none';
      if (hidden) noteInput.focus();
    });

    /* 笔记区域内的一切点击都不触发卡片折叠 */
    notesArea.addEventListener('click', function (e) { e.stopPropagation(); });

    function saveNote() {
      var text = (noteInput.value || '').trim();
      if (!text) return;
      notesStore.addComment(noteKey, { title: item.title, view: view }, text);
      noteInput.value = '';
      renderNoteList();
    }

    card.querySelector('.note-save-btn').addEventListener('click', saveNote);
    noteInput.addEventListener('keydown', function (e) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.stopPropagation();
        saveNote();
      }
    });

    noteList.addEventListener('click', function (e) {
      var del = e.target.closest('.note-del-btn');
      if (!del) return;
      e.stopPropagation();
      notesStore.removeComment(noteKey, parseInt(del.dataset.idx, 10));
      renderNoteList();
    });

    renderNoteList();
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
        var names = { hackernews: 'Hacker News', askhn: 'HN Ask', reddit: 'Reddit', lobsters: 'Lobste.rs', devto: 'dev.to', v2ex: 'V2EX', juejin: '掘金', github: 'GitHub Trending', qbitai: '量子位', infoq: 'InfoQ' };
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
          var card = createCard(cat, item, delay, name);
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

  /* ================================================================
   * 我的笔记面板：汇总所有点赞与想法碎片，支持导出/导入备份。
   * ================================================================ */
  var notesBtn = document.getElementById('notesBtn');
  var notesOverlay = document.getElementById('notesOverlay');
  var notesListEl = document.getElementById('notesList');
  var notesBadge = document.getElementById('notesBadge');

  function updateNotesBadge() {
    var count = Object.keys(notesStore.data).length;
    if (!notesBadge) return;
    notesBadge.style.display = count ? 'inline-flex' : 'none';
    notesBadge.textContent = count > 99 ? '99+' : String(count);
  }

  function renderNotesPanel() {
    var keys = Object.keys(notesStore.data);
    if (!keys.length) {
      notesListEl.innerHTML = '<div class="notes-empty">还没记录过自己的想法~<br>' +
        '点击卡片上的 🤍 点赞，或 💬 想法 写下思想碎片</div>';
      return;
    }
    var entries = keys.map(function (k) { return notesStore.data[k]; });
    /* 按最近活动排序 */
    entries.sort(function (a, b) {
      var la = (a.comments && a.comments.length) ? a.comments[a.comments.length - 1].ts : 0;
      var lb = (b.comments && b.comments.length) ? b.comments[b.comments.length - 1].ts : 0;
      return lb - la;
    });
    notesListEl.innerHTML = entries.map(function (n) {
      var viewLabel = n.view === 'parenting' ? '👨‍👧 育儿' : '💼 工作·生活';
      var html = '<div class="notes-entry">' +
        '<div class="notes-entry-head">' +
          '<span class="notes-entry-view">' + viewLabel + '</span>' +
          '<span class="notes-entry-title">' + esc(n.title || '') + '</span>' +
          (n.liked ? '<span title="已点赞">❤️</span>' : '') +
        '</div>';
      if (n.comments && n.comments.length) {
        html += n.comments.map(function (c) {
          return '<div class="notes-entry-comment">' +
            '<span class="c-ts">' + fmtTime(c.ts) + '</span>' + esc(c.text) +
          '</div>';
        }).join('');
      }
      return html + '</div>';
    }).join('');
  }

  notesBtn.addEventListener('click', function () {
    renderNotesPanel();
    notesOverlay.classList.add('open');
  });
  document.getElementById('notesCloseBtn').addEventListener('click', function () {
    notesOverlay.classList.remove('open');
  });
  notesOverlay.addEventListener('click', function (e) {
    if (e.target === notesOverlay) notesOverlay.classList.remove('open');
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') notesOverlay.classList.remove('open');
  });

  /* 导出备份（JSON 文件下载） */
  document.getElementById('notesExportBtn').addEventListener('click', function () {
    var blob = new Blob([JSON.stringify(notesStore.data, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    var d = new Date();
    var p = function (x) { return String(x).padStart(2, '0'); };
    a.href = URL.createObjectURL(blob);
    a.download = 'geng-notes-' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  });

  /* 导入备份（合并覆盖同名条目） */
  document.getElementById('notesImportBtn').addEventListener('click', function () {
    document.getElementById('notesImportInput').click();
  });
  document.getElementById('notesImportInput').addEventListener('change', function () {
    var f = this.files && this.files[0];
    if (!f) return;
    var reader = new FileReader();
    var inputEl = this;
    reader.onload = function () {
      try {
        var imported = JSON.parse(reader.result);
        var count = 0;
        Object.keys(imported).forEach(function (k) {
          var v = imported[k];
          if (v && typeof v === 'object' && (v.liked || (v.comments && v.comments.length))) {
            notesStore.data[k] = v;
            count++;
          }
        });
        notesStore.save();
        renderNotesPanel();
        alert(count ? '已导入 ' + count + ' 条笔记' : '文件里没有有效笔记');
      } catch (err) {
        alert('导入失败：不是有效的 JSON 备份文件');
      }
    };
    reader.readAsText(f);
    inputEl.value = '';
  });

  updateNotesBadge();
})();
