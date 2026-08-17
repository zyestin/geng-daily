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
 *   OPENROUTER_API_KEY  — OpenRouter API 密钥（必需）
 *   OPENROUTER_MODEL    — 模型名称（默认 google/gemini-2.0-flash-exp:free）
 *   SLOT                — 时间段，可选值见下方 SLOTS
 *
 * 零依赖：仅使用 Node.js 内置模块（fs/path/url）和全局 fetch（Node 18+）。
 */

import { writeFileSync, mkdirSync, existsSync } from 'fs';
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
          "tags": ["标签1", "标签2"]
        }
      ]
    }
  ]
}`;

  return { systemPrompt, userPrompt };
}

/* ================================================================
 *  调用 OpenRouter API
 * ================================================================ */

async function callOpenRouter(systemPrompt, userPrompt) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  const model = process.env.OPENROUTER_MODEL || 'google/gemini-2.0-flash-exp:free';

  if (!apiKey) {
    console.error('[ERROR] 环境变量 OPENROUTER_API_KEY 未设置');
    console.error('请在 GitHub Secrets 或本地 .env 中配置');
    process.exit(1);
  }

  console.log('[INFO] 调用 OpenRouter API...');
  console.log('  模型:', model);

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
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.85,
      max_tokens: 4000,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[ERROR] API 返回错误: ${response.status} ${response.statusText}`);
    console.error('响应内容:', errorText);
    process.exit(1);
  }

  const data = await response.json();

  if (data.error) {
    console.error('[ERROR] API 返回错误对象:', JSON.stringify(data.error, null, 2));
    process.exit(1);
  }

  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    console.error('[ERROR] API 返回空内容');
    console.error('完整响应:', JSON.stringify(data, null, 2).substring(0, 500));
    process.exit(1);
  }

  console.log('[INFO] API 调用成功，响应长度:', content.length, '字符');
  return content;
}

/* ================================================================
 *  解析 & 验证
 * ================================================================ */

function parseContent(text) {
  let cleaned = text.trim();

  // 去除 markdown 代码块标记
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?\s*```$/, '');
  }

  // 尝试提取 JSON 对象
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    cleaned = jsonMatch[0];
  }

  try {
    return JSON.parse(cleaned);
  } catch (e) {
    console.error('[ERROR] 无法解析 JSON');
    console.error('清理后文本前500字符:', cleaned.substring(0, 500));
    console.error('错误信息:', e.message);
    process.exit(1);
  }
}

function validateContent(content) {
  if (!content.categories || !Array.isArray(content.categories)) {
    console.error('[ERROR] 内容缺少 categories 数组');
    process.exit(1);
  }
  let total = 0;
  for (const cat of content.categories) {
    if (!cat.name || !cat.items || !Array.isArray(cat.items)) {
      console.error('[ERROR] 分类结构无效:', JSON.stringify(cat).substring(0, 100));
      process.exit(1);
    }
    total += cat.items.length;
    for (const item of cat.items) {
      if (!item.title || !item.summary || !item.detail || !item.usage) {
        console.error(`[ERROR] 话题缺少必填字段 (${cat.name}):`, JSON.stringify(item).substring(0, 100));
        process.exit(1);
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
  const responseText = await callOpenRouter(systemPrompt, userPrompt);
  const content = parseContent(responseText);

  const total = validateContent(content);

  // 补充元数据
  content.generated_at = new Date().toISOString();
  content.slot = slotKey;
  content.slot_label = slot.label;

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

  console.log(`\n====================================`);
  console.log(`  完成! 共 ${total} 个话题`);
  console.log(`====================================`);
}

main().catch(err => {
  console.error('[FATAL]', err);
  process.exit(1);
});
