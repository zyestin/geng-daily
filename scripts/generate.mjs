#!/usr/bin/env node

/**
 * 梗日报 — AI 内容生成脚本
 *
 * 通过 OpenRouter API 调用 AI 模型，根据当前时间段生成聊天话题和梗，
 * 输出为 data/content.json 供网页展示。
 *
 * 用法：
 *   OPENROUTER_API_KEY=xxx node scripts/generate.mjs
 *   OPENROUTER_API_KEY=xxx SLOT=weekday-morning node scripts/generate.mjs
 *
 * 环境变量：
 *   OPENROUTER_API_KEY          — OpenRouter API 密钥（必需）
 *   OPENROUTER_MODEL            — 可选。指定主模型；不设置时自动从免费模型中挑选
 *   OPENROUTER_FALLBACK_MODELS  — 可选。逗号分隔的备用模型，自动免费模型会补足队列
 *   SLOT                        — 时间段，可选值见下方 SLOTS
 *
 * 模型策略（默认）：
 *   每次运行时调用 GET /api/v1/models 拉取一次免费模型列表（pricing 全为 0），
 *   按"质量白名单 + 上下文长度"排序，取性能最好的 3 个作为 主模型 + 2 个备用；
 *   拉取失败则回退到内置兜底模型（均为长期在线的免费模型）。
 *
 * 成本统计：
 *   每次成功生成后，把实际使用的模型、token 消耗、费用（$）写入 content.json 的
 *   meta 字段，供网页末尾小字展示。免费模型费用恒为 $0。
 *
 * 零依赖：仅使用 Node.js 内置模块（fs/path/url）和全局 fetch（Node 18+）。
 */

import { writeFileSync, readFileSync, readdirSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

/* ================================================================
 *  分类定义
 * ================================================================ */

const CATEGORIES = {
  // ---- 工作方向 ----
  frontend:   { name: '前端框架',      icon: '\u{1F680}', desc: 'React/Vue/Next.js/Svelte 等前端框架最新动态、新版本、重要更新' },
  rn:         { name: 'React Native',  icon: '\u{1F4F1}', desc: 'RN 新版本、新架构(Fabric/New Architecture)、跨端方案、性能优化' },
  aiDev:      { name: 'AI编程',        icon: '\u{1F916}', desc: 'AI 编程助手(Cursor/Copilot/Codeium)、AI 生成UI、AI 辅助测试等前沿动态' },
  tsJs:       { name: 'TS & JS',       icon: '\u{1F4D8}', desc: 'TypeScript 新特性、JS 提案、Node/Bun/Deno 运行时动态' },
  build:      { name: '工程化',        icon: '\u2699\uFE0F',  desc: 'Vite/Webpack/Turbopack/esbuild 构建工具最新进展、工程化最佳实践' },
  cssAnim:    { name: 'CSS & 动效',    icon: '\u{1F3A8}', desc: '新 CSS 特性、动画库、设计趋势、UI 交互新玩法' },
  opensource: { name: '开源热门',      icon: '\u{1F31F}', desc: 'GitHub trending 项目、新开源项目、star 暴涨的项目' },
  devCulture: { name: '开发者梗',      icon: '\u{1F604}', desc: '程序员段子、技术社区热帖、开发者文化、Stack Overflow 梗' },

  // ---- 生活方向 ----
  news:          { name: '时事热点',   icon: '\u{1F4F0}', desc: '当天热门新闻、社会话题、国际动态（适合和家人、同事聊）' },
  edu:           { name: '儿童教育',   icon: '\u{1F4DA}', desc: '7岁孩子(小学低年级)教育方法、学习资源、教育政策热点' },
  parenting:     { name: '亲子时光',   icon: '\u{1F468}\u200D\u{1F467}', desc: '适合7岁女孩的亲子活动、游戏、手工、出行建议' },
  pingpong:      { name: '乒乓球',     icon: '\u{1F3D3}', desc: '乒乓球赛事(WTT等)、国乒球星动态、技术术语、装备推荐' },
  lifehacks:     { name: '生活妙招',   icon: '\u{1F4A1}', desc: '实用生活技巧、家居整理、烹饪窍门、省钱妙招' },
  entertainment: { name: '热门影视',   icon: '\u{1F3AC}', desc: '最近火的剧、综艺、动画、电影（适合全家看）' },
  health:        { name: '健康养生',   icon: '\u{1F957}', desc: '家庭健康知识、运动健身、饮食营养、养生小贴士' },
};

/* ================================================================
 *  时间段配置
 *  cron 已按 GMT+8 换算为 UTC
 * ================================================================ */

const SLOTS = {
  'weekday-morning': {
    label: '工作日早晨 · 同事聊资',
    time: '09:30',
    cron: '30 1 * * 1-5',     // UTC 01:30 = GMT+8 09:30
    categories: ['frontend', 'rn', 'aiDev', 'tsJs', 'opensource', 'devCulture'],
    scenario: '上班时和同事聊天、技术闲聊',
  },
  'weekday-evening': {
    label: '工作日傍晚 · 工作生活各半',
    time: '18:00',
    cron: '0 10 * * 1-5',     // UTC 10:00 = GMT+8 18:00
    categories: ['aiDev', 'build', 'news', 'parenting', 'entertainment', 'lifehacks'],
    scenario: '下班后关心下工作动态，也和家人聊天',
  },
  'weekend-morning': {
    label: '周末早晨 · 家庭时光',
    time: '09:00',
    cron: '0 1 * * 6,0',      // UTC 01:00 = GMT+8 09:00
    categories: ['news', 'edu', 'parenting', 'pingpong', 'entertainment', 'health'],
    scenario: '周末和家人、孩子、附近孩子家长聊天',
  },
  'weekend-evening': {
    label: '周末傍晚 · 家庭闲聊',
    time: '18:00',
    cron: '0 10 * * 6,0',    // UTC 10:00 = GMT+8 18:00
    categories: ['news', 'edu', 'lifehacks', 'pingpong', 'entertainment', 'health'],
    scenario: '周末傍晚和家人闲聊、和丈母娘聊时事',
  },
};

/* ================================================================
 *  工具函数
 * ================================================================ */

function getBeijingNow() {
  return new Date(Date.now() + 8 * 3600 * 1000);
}

function formatDate(d) {
  const weekdays = ['日','一','二','三','四','五','六'];
  return {
    date: `${d.getUTCFullYear()}年${d.getUTCMonth() + 1}月${d.getUTCDate()}日`,
    weekday: `星期${weekdays[d.getUTCDay()]}`,
    time: `${String(d.getUTCHours()).padStart(2,'0')}:${String(d.getUTCMinutes()).padStart(2,'0')}`,
  };
}

function determineSlot() {
  const envSlot = process.env.SLOT;
  if (envSlot && envSlot !== 'auto') {
    if (!SLOTS[envSlot]) {
      console.error(`[ERROR] 未知时间段: ${envSlot}`);
      console.error(`可选值: ${Object.keys(SLOTS).join(', ')}`);
      process.exit(1);
    }
    return envSlot;
  }
  // 根据当前北京时间自动判断
  const now = getBeijingNow();
  const day = now.getUTCDay();
  const hour = now.getUTCHours();
  const isWeekend = day === 0 || day === 6;
  const isMorning = hour >= 6 && hour < 13;
  if (isWeekend) return isMorning ? 'weekend-morning' : 'weekend-evening';
  return isMorning ? 'weekday-morning' : 'weekday-evening';
}

/* ================================================================
 *  构建 Prompt
 * ================================================================ */

function buildPrompt(slotKey) {
  const slot = SLOTS[slotKey];
  const now = getBeijingNow();
  const { date, weekday, time } = formatDate(now);
  const cats = slot.categories.map(k => CATEGORIES[k]).filter(Boolean);

  const systemPrompt = `你是一个专业的"梗库"内容策展人。你的任务是为用户生成当天可以用来聊天、破冰、社交的话题和梗。

核心原则：
1. 内容必须真实、新鲜、有信息量——基于最近的真实热点、趋势和事件，不要编造
2. 每个"梗"要能让人聊得起来——有话题点、有观点、有趣味
3. "怎么聊"部分要给出可以直接说出口的话术，像朋友聊天一样自然口语化
4. 适当加入幽默和趣味，但不要低俗
5. 用中文输出，口语化表达
6. 不要输出任何 markdown 代码块标记（不要写 \`\`\`json），直接输出纯 JSON`;

  const categoryList = cats.map((c, i) =>
    `${i + 1}. ${c.icon} ${c.name}\n   ${c.desc}`
  ).join('\n\n');

  const userPrompt = `今天日期：${date}，${weekday}，时间约 ${time}
时间段：${slot.label}
社交场景：${slot.scenario}

用户画像：
- 职业：React Native / App / 前端开发工程师
- 家庭：丈夫，7岁女孩的父亲
- 丈母娘喜欢聊：时事、生活、儿童教育、乒乓球

请围绕以下 ${cats.length} 个方向，每个方向生成 2-3 个最新、最有料的可聊话题：

${categoryList}

每个话题包含以下字段：
- title: 话题名/梗名（简洁有力，10字以内）
- summary: 一句话概括（20字以内）
- detail: 详细解释——为什么火/背景/关键信息（50-150字）
- usage: 怎么聊——可以直接说出口的话术、关键观点、有趣切入点（50-150字）
- source: 原文链接（可选）。仅当你非常确定该话题对应的真实官方网站/仓库/文档时才填完整 https:// 链接（如 https://github.com/xxx/xxx、官方文档地址）；不确定就填空字符串 ""。严禁编造或猜测链接！
- tags: 2-3个相关标签

请严格按以下 JSON 格式输出（直接输出纯 JSON，不要 markdown 代码块）：
{
  "categories": [
    {
      "name": "方向名",
      "icon": "emoji",
      "items": [
        {
          "title": "标题",
          "summary": "一句话概括",
          "detail": "详细解释",
          "usage": "怎么聊",
          "source": "https://确定的官方链接或空字符串",
          "tags": ["标签1", "标签2"]
        }
      ]
    }
  ]
}`;

  return { systemPrompt, userPrompt };
}

/* ================================================================
 *  免费模型发现
 *  每次运行先拉取一次 OpenRouter 模型列表，筛选免费模型（pricing 全为 0），
 *  按"质量白名单 + 上下文长度"排序，取性能最好的几个作为本次主备模型。
 * ================================================================ */

const FREE_MODEL_TOP_N = 3; // 自动挑选的模型数量（1 主 + 2 备）

// 明显不适合文本话题生成的任务型模型，直接排除
const EXCLUDE_KEYWORDS = [
  'lyria', 'music', 'audio', 'image', 'video', 'art', 'embed',
  'rerank', 'content-safety', 'moderation', 'ocr', '-vl', 'search',
];

// 质量白名单（按偏好排序；中文聊天话题生成优先选中文能力强的模型，
// 兼顾速度与稳定性 —— 输出慢/易截断的巨型模型放后面）
const QUALITY_PRIORITY = [
  'z-ai/glm-5.2:free',
  'google/gemma-4-31b-it:free',
  'nvidia/nemotron-3.5-lightning:free',
  'nvidia/nemotron-3-super-120b-a12b:free',
  'openai/gpt-oss-20b:free',
  'google/gemma-4-26b-a4b-it:free',
  'nvidia/nemotron-3-ultra-550b-a55b:free',
  'cohere/north-mini-code:free',
  'poolside/laguna-s-2.1:free',
  'dots-studio/dots-3-note-preview:free',
];

// 拉取失败时的内置兜底（均为长期在线的免费模型）
const DEFAULT_MODELS = [
  'z-ai/glm-5.2:free',
  'nvidia/nemotron-3-super-120b-a12b:free',
  'openai/gpt-oss-20b:free',
];

/**
 * 拉取免费模型列表，返回 {
 *   ids: 按质量排序的免费模型 id[],
 *   pricingMap: id → pricing,
 *   maxTokensMap: id → 最大输出 token 数（用于动态设置 max_tokens）
 * }
 * 失败返回 null（调用方回退到内置兜底模型）。
 */
async function fetchFreeModels(apiKey) {
  try {
    const res = await fetch('https://openrouter.ai/api/v1/models', {
      headers: apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {},
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    const all = data.data || [];
    const pricingMap = {};
    const maxTokensMap = {};
    for (const m of all) {
      pricingMap[m.id] = m.pricing || {};
      maxTokensMap[m.id] = m.top_provider?.max_completion_tokens || null;
    }

    const free = all.filter(m => {
      const p = parseFloat(m.pricing?.prompt);
      const c = parseFloat(m.pricing?.completion);
      return p === 0 && c === 0;
    });

    const pool = free.filter(m =>
      !EXCLUDE_KEYWORDS.some(k => m.id.toLowerCase().includes(k))
    );

    const prio = {};
    QUALITY_PRIORITY.forEach((id, i) => { prio[id] = i; });
    pool.sort((a, b) => {
      const pa = prio[a.id], pb = prio[b.id];
      if (pa !== undefined && pb !== undefined) return pa - pb;
      if (pa !== undefined) return -1;
      if (pb !== undefined) return 1;
      return (b.context_length || 0) - (a.context_length || 0);
    });

    console.log(`[INFO] 免费模型发现: 免费 ${free.length} 个 / 可用 ${pool.length} 个`);
    console.log('[INFO] 免费候选(按优先级): ' + pool.slice(0, 6).map(m => m.id).join(', '));
    return { ids: pool.map(m => m.id), pricingMap, maxTokensMap };
  } catch (e) {
    console.warn('[WARN] 获取免费模型列表失败，回退内置兜底: ' + e.message);
    return null;
  }
}

/**
 * 组装本次模型队列：显式配置优先，其次自动免费模型，最后内置兜底。
 * 返回 { models: 去重后的 [主, 备1, 备2], maxTokensMap }。
 */
function pickModels(freeInfo) {
  const explicitMain = (process.env.OPENROUTER_MODEL || '').trim();
  const explicitFallbacks = (process.env.OPENROUTER_FALLBACK_MODELS || '')
    .split(',').map(s => s.trim()).filter(Boolean);
  const auto = freeInfo ? freeInfo.ids : [];

  const models = [];
  if (explicitMain) models.push(explicitMain);
  for (const id of explicitFallbacks) if (!models.includes(id)) models.push(id);
  for (const id of auto) {
    if (models.length >= FREE_MODEL_TOP_N) break;
    if (!models.includes(id)) models.push(id);
  }
  for (const id of DEFAULT_MODELS) {
    if (models.length >= FREE_MODEL_TOP_N) break;
    if (!models.includes(id)) models.push(id);
  }
  if (models.length === 0) models.push(...DEFAULT_MODELS);

  console.log('[INFO] 本次模型队列: ' + models.join(' → '));
  return {
    models: models.slice(0, FREE_MODEL_TOP_N),
    maxTokensMap: freeInfo ? freeInfo.maxTokensMap : {},
  };
}

/** 根据响应 usage 与模型定价计算费用（$）。免费模型返回 0。 */
function buildMeta(requestedModel, result, pricingMap) {
  const usage = result.usage || {};
  const model = result.actualModel || requestedModel;
  const price = pricingMap[requestedModel] || pricingMap[model];
  let cost = null;
  let free = false;
  if (price) {
    const pp = parseFloat(price.prompt);
    const cp = parseFloat(price.completion);
    if (pp === 0 && cp === 0) {
      cost = 0;
      free = true;
    } else if (!isNaN(pp) && !isNaN(cp)) {
      cost = (usage.prompt_tokens || 0) * pp + (usage.completion_tokens || 0) * cp;
    }
  }
  return {
    model: requestedModel,
    actual_model: model,
    prompt_tokens: usage.prompt_tokens || 0,
    completion_tokens: usage.completion_tokens || 0,
    total_tokens: usage.total_tokens || 0,
    cost_usd: cost,
    free,
  };
}

/* ================================================================
 *  调用 OpenRouter API
 * ================================================================ */

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 生成内容：每次运行先自动发现免费模型，组成 [主模型, 备用×2] 队列；
 * 循环尝试，每次成功则解析验证（要求分类齐全）；解析/验证失败也视为
 * 该模型失败，自动切换到下一个，直到全部耗尽。返回 { content, meta }。
 * @param {number} expectedCategories 本次 prompt 要求的方向数，输出必须齐全
 */
async function generateContent(systemPrompt, userPrompt, expectedCategories) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    console.error('[ERROR] 环境变量 OPENROUTER_API_KEY 未设置');
    console.error('请在 GitHub Secrets 或本地 .env 中配置');
    process.exit(1);
  }

  // 每次运行拉取 1 次免费模型列表，选性能最好的 3 个作为主备模型
  const freeInfo = await fetchFreeModels(apiKey);
  const { models, maxTokensMap } = pickModels(freeInfo);
  const pricingMap = freeInfo ? freeInfo.pricingMap : {};

  let lastErr = '';
  for (const model of models) {
    try {
      const result = await callModel(model, systemPrompt, userPrompt, maxTokensMap[model]);
      const parsed = parseContent(result.content);
      validateContent(parsed, expectedCategories); // 残缺/字段缺失会抛错 → 换下一个模型
      const meta = buildMeta(model, result, pricingMap);
      const shownModel = result.actualModel && result.actualModel !== model
        ? `${model} → ${result.actualModel}` : model;
      const costStr = meta.cost_usd === null ? 'N/A' : `$${meta.cost_usd.toFixed(6)}`;
      console.log(`[OK] 生成成功（模型 ${shownModel}，tokens=${meta.total_tokens}，花费 ${costStr}${meta.free ? ' 🎉' : ''}）`);
      return { content: parsed, meta };
    } catch (e) {
      lastErr = e.message;
      console.warn(`[WARN] 模型 ${model} 生成失败: ${e.message}`);
      await sleep(3000);
    }
  }

  console.error(`[ERROR] 所有模型均失败。最后错误: ${lastErr}`);
  process.exit(1);
}

/**
 * 调用单个模型，返回 { content, usage, actualModel }。
 * usage = OpenRouter 返回的 token 消耗；actualModel = 实际执行模型 id。
 * @param {number|null} maxOutTokens 该模型的最大输出 token 限额（未知时用默认）
 */
async function callModel(model, systemPrompt, userPrompt, maxOutTokens) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  const MAX_ATTEMPTS = 2;
  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];
  // 中文 6 分类完整输出约需 6000+ token；按模型限额取 min，避免超限被截断
  const maxTokens = Math.min(10000, maxOutTokens && maxOutTokens > 0 ? maxOutTokens : 10000);

  let lastErr = '';
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    console.log(`[INFO] 调用 OpenRouter... 模型: ${model} (第${attempt}次)`);
    try {
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://github.com/geng-daily',
          'X-Title': 'geng-daily',
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: 0.85,
          max_tokens: maxTokens,
        }),
      });

      if (!response.ok) {
        lastErr = `HTTP ${response.status} ${response.statusText}`;
        console.warn(`[WARN] ${lastErr}`);
        // 5xx/429 可重试；其他 4xx 换模型
        if (response.status >= 500 || response.status === 429) {
          await sleep(8000 * attempt);
          continue;
        }
        break;
      }

      const data = await response.json();
      if (data.error) {
        lastErr = JSON.stringify(data.error).substring(0, 200);
        console.warn(`[WARN] API 错误对象: ${lastErr}`);
        await sleep(8000 * attempt);
        continue;
      }

      const content = data.choices?.[0]?.message?.content;
      if (!content) {
        lastErr = 'API 返回空内容';
        console.warn(`[WARN] ${lastErr}`);
        await sleep(5000);
        continue;
      }

      return {
        content,
        usage: data.usage || null,
        actualModel: data.model || model,
      };
    } catch (e) {
      lastErr = e.message;
      console.warn(`[WARN] 请求异常: ${e.message}`);
      await sleep(8000 * attempt);
    }
  }
  throw new Error(lastErr || '请求失败');
}

/* ================================================================
 *  解析 & 验证
 * ================================================================ */

/**
 * 解析 AI 返回内容为 JSON，带容错修复链：
 * 1. 直接解析
 * 2. 去掉尾逗号（,} / ,]）
 * 3. 从右往左截断到每个 }（处理输出被截断/尾部多余说明文字）
 * 4. 给未加引号的键补引号 + 单引号转双引号（最后手段）
 */
function parseContent(text) {
  let cleaned = text.trim();

  // 去除 markdown 代码块标记
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?\s*```$/, '');
  }

  // 提取 JSON 对象主体
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (jsonMatch) cleaned = jsonMatch[0];

  const strategies = [
    s => JSON.parse(s),
    // 尾逗号：{ "a": 1, } / ["a", ]
    s => JSON.parse(s.replace(/,\s*([}\]])/g, '$1')),
    // 截断修复：取最后一个完整 token（} 或 ]），丢弃后面的残段，
    // 扫描括号深度自动补全缺失的 ] }（处理输出被截断的情况）
    s => {
      let cut = -1;
      for (let i = s.length - 1; i >= 0; i--) {
        if (s[i] === '}' || s[i] === ']') { cut = i + 1; break; }
      }
      if (cut < 0) throw new Error('无可截断点');
      const head = s.slice(0, cut);
      const stack = [];
      let inStr = false, escaped = false;
      for (let i = 0; i < head.length; i++) {
        const ch = head[i];
        if (inStr) {
          if (escaped) escaped = false;
          else if (ch === '\\') escaped = true;
          else if (ch === '"') inStr = false;
          continue;
        }
        if (ch === '"') inStr = true;
        else if (ch === '{' || ch === '[') stack.push(ch);
        else if (ch === '}' || ch === ']') stack.pop();
      }
      let tail = '';
      while (stack.length) tail += stack.pop() === '{' ? '}' : ']';
      return JSON.parse(head + tail);
    },
    // 键补引号 + 单引号转双引号：{ name: 'x' } → { "name": "x" }
    s => {
      const fixed = s
        .replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:/g, '$1"$2":')
        .replace(/'/g, '"');
      return JSON.parse(fixed);
    },
  ];

  let lastErr = '';
  for (const fn of strategies) {
    try {
      return fn(cleaned);
    } catch (e) {
      lastErr = e.message;
    }
  }

  console.error('[ERROR] 无法解析 JSON');
  console.error('清理后文本前500字符:', cleaned.substring(0, 500));
  throw new Error('JSON 解析失败: ' + lastErr);
}

function validateContent(content, expectedCategories) {
  if (!content.categories || !Array.isArray(content.categories)) {
    throw new Error('内容缺少 categories 数组');
  }
  if (expectedCategories && content.categories.length < expectedCategories) {
    throw new Error(`分类不齐全: 期望 ${expectedCategories} 个，实际 ${content.categories.length} 个（模型输出被截断或漏写）`);
  }
  let total = 0;
  for (const cat of content.categories) {
    if (!cat.name || !cat.items || !Array.isArray(cat.items) || cat.items.length === 0) {
      throw new Error('分类结构无效: ' + JSON.stringify(cat).substring(0, 100));
    }
    total += cat.items.length;
    for (const item of cat.items) {
      if (!item.title || !item.summary || !item.detail || !item.usage) {
        throw new Error(`话题缺少必填字段 (${cat.name}): ` + JSON.stringify(item).substring(0, 100));
      }
    }
  }
  console.log(`[INFO] 验证通过: ${content.categories.length} 个分类, ${total} 个话题`);
  return total;
}

/* ================================================================
 *  主流程
 * ================================================================ */

async function main() {
  const slotKey = determineSlot();
  const slot = SLOTS[slotKey];

  console.log('====================================');
  console.log('       梗日报 — 内容生成');
  console.log('====================================');
  console.log('时间段:', slotKey);
  console.log('标签:', slot.label);
  console.log('方向:', slot.categories.map(k => CATEGORIES[k].name).join(', '));
  console.log('');

  const { systemPrompt, userPrompt } = buildPrompt(slotKey);
  const { content, meta } = await generateContent(systemPrompt, userPrompt, slot.categories.length);
  const total = validateContent(content);

  // 补充元数据
  content.generated_at = new Date().toISOString();
  content.slot = slotKey;
  content.slot_label = slot.label;
  content.meta = meta; // 模型 / token / 费用统计（网页末尾展示）

  // 确保 icon 字段存在
  for (const cat of content.categories) {
    if (!cat.icon) {
      const catKey = Object.keys(CATEGORIES).find(k => CATEGORIES[k].name === cat.name);
      if (catKey) cat.icon = CATEGORIES[catKey].icon;
    }
  }

  // 写入 data/content.json
  const dataDir = join(ROOT, 'data');
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });

  const contentPath = join(dataDir, 'content.json');
  writeFileSync(contentPath, JSON.stringify(content, null, 2));
  console.log(`\n[OK] 已写入: ${contentPath}`);

  // 归档
  const archiveDir = join(dataDir, 'archive');
  if (!existsSync(archiveDir)) mkdirSync(archiveDir, { recursive: true });

  const bj = getBeijingNow();
  const dateStr = `${bj.getUTCFullYear()}-${String(bj.getUTCMonth() + 1).padStart(2, '0')}-${String(bj.getUTCDate()).padStart(2, '0')}`;
  const archivePath = join(archiveDir, `${dateStr}-${slotKey}.json`);
  writeFileSync(archivePath, JSON.stringify(content, null, 2));
  console.log(`[OK] 已归档: ${archivePath}`);

  // 重建历史索引
  const history = rebuildHistory(dataDir);
  const historyPath = join(dataDir, 'history.json');
  writeFileSync(historyPath, JSON.stringify(history, null, 2));
  console.log(`[OK] 已更新历史索引: ${historyPath}（${history.items.length} 条记录）`);

  console.log(`\n====================================`);
  console.log(`  完成! 共 ${total} 个话题`);
  console.log(`====================================`);
}

/* ================================================================
 *  历史索引：扫描 data/archive/ 重建 data/history.json
 *  每条记录含 date/slot/label/generated_at/file/topic_count 等，
 *  供前端列出"前几日"内容并按需加载对应归档文件。
 * ================================================================ */

function rebuildHistory(dataDir) {
  const archiveDir = join(dataDir, 'archive');
  const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
  if (!existsSync(archiveDir)) {
    return { items: [], updated_at: new Date().toISOString() };
  }

  const files = readdirSync(archiveDir)
    .filter(f => f.endsWith('.json'))
    .sort()
    .reverse(); // 最新的在前

  const items = [];
  const seen = new Set();

  for (const f of files) {
    let c;
    try {
      c = JSON.parse(readFileSync(join(archiveDir, f), 'utf-8'));
    } catch {
      continue;
    }
    const m = f.match(/^(\d{4})-(\d{2})-(\d{2})-(.+)\.json$/);
    const dateStr = m ? `${m[1]}-${m[2]}-${m[3]}` : '';
    const slotKey = m ? m[4] : (c.slot || 'unknown');
    const key = `${dateStr}-${slotKey}`;
    if (seen.has(key)) continue; // 同日同时段只保留一份
    seen.add(key);

    const d = c.generated_at ? new Date(c.generated_at) : null;
    const weekday = d ? '星期' + weekdays[d.getDay()] : '';
    const topicCount = (c.categories || []).reduce(
      (s, cat) => s + (cat.items ? cat.items.length : 0), 0
    );

    items.push({
      key,
      date: dateStr,
      slot: slotKey,
      slot_label: c.slot_label || slotKey,
      generated_at: c.generated_at || '',
      weekday,
      file: `archive/${f}`,
      topic_count: topicCount,
      category_names: (c.categories || []).map(cat => cat.name),
    });
  }

  return { items, updated_at: new Date().toISOString() };
}

main().catch(err => {
  console.error('[FATAL]', err);
  process.exit(1);
});
