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

/* ---- 育儿方向（独立文件 data/parenting.json） ---- */
const PARENTING_CATEGORIES = {
  sciFigures:  { name: '科学奇人',   icon: '\u{1F52C}', desc: '科学家真实故事（牛顿/爱因斯坦/居里夫人等），突出人物性格细节和有趣轶事，让孩子觉得科学家是活生生的人' },
  litFigures:  { name: '文人风骨',   icon: '\u{1F4DC}', desc: '历史文学家故事（苏轼/李白/鲁迅等），讲他们面对挫折时的态度、人生选择，传递价值观而非背诵知识点' },
  interests:   { name: '兴趣深耕',   icon: '\u{1F3A8}', desc: '艺术/音乐/昆虫/自然等兴趣方向的真实人物故事，展示坚持和热爱的力量，给家长培养孩子兴趣的参考' },
  thinking:    { name: '思维启蒙',   icon: '\u{1F9E0}', desc: '数学/逻辑/科学思维启蒙故事（高斯/费曼/图灵等），用具体事例讲思维方式而非知识灌输' },
  actions:     { name: '亲子行动',   icon: '\u{1F91D}', desc: '适合7岁女孩的亲子活动方案：自然探索/手工实验/阅读计划等，给出具体操作步骤和对话引导技巧' },
  mindset:     { name: '育儿心法',   icon: '\u{1F4A1}', desc: '育儿方法论：表扬技巧/情绪引导/习惯培养等，基于真实研究或教育案例，给家长可操作的沟通话术' },
  foodEdu:     { name: '健康食育',   icon: '\u{1F957}', desc: '食物与营养的真实科学故事：维生素发现史/营养缺乏症案例/饮食与健康关系，用历史实验讲科学道理' },
  sports:      { name: '运动启蒙',   icon: '\u{1F3C3}', desc: '羽毛球/乒乓球/跳绳/足球等适合女孩的运动项目：真实运动员故事+家长如何鼓励和沟通的技巧' },
};

/* ---- 媳妇方向（独立文件 data/wife.json） ---- */
const WIFE_CATEGORIES = {
  drama:     { name: '追剧指南',   icon: '\u{1F3AC}', desc: '最近火的剧/电影/短剧，她可能在追的或会感兴趣的。给出讨论切入点（剧情/演员/槽点），以及如何自然地和她聊起这部戏' },
  food:      { name: '吃喝情报',   icon: '\u{1F35C}', desc: '发现好吃的东西（新店/网红美食/家常菜谱），给出足够细节（具体菜品、口味特点、为什么值得试），让她听了想去' },
  scripts:   { name: '话术急救',   icon: '\u{1F4AC}', desc: '媳妇常见的"挖坑"场景（如"我要减肥了""你觉得那个女生好看吗"等），给出错误回答和正确回答及原因分析' },
  sweet:     { name: '土味情话',   icon: '\u{1F618}', desc: '结合当下热门话题（明星/影视/社会热点）的创意情话，不要太老套，要让她忍不住笑' },
  herWorld:  { name: '她的世界',   icon: '\u{1F31F}', desc: '媳妇关注的领域（美妆/护肤/时尚/明星动态），帮她聊起来时你如何展现同理心和兴趣，给出具体话术' },
  warm:      { name: '暖心行动',   icon: '\u{2764}\uFE0F', desc: '肯定她的劳动成果（打扫/做饭/带娃/妙计），给出具体的感谢方式和行动建议' },
  date:      { name: '约会提案',   icon: '\u{1F381}', desc: '用浪漫幽默的语言提出约会/看电影/活动的建议，给出可以直接发给她的话术' },
  eq:        { name: '情绪价值',   icon: '\u{1F9E0}', desc: '如何倾听、共情、给情绪支持（而非讲道理/论对错），基于真实心理学/沟通技巧，给出具体场景和话术' },
};

/* ---- 科技吃瓜方向（独立文件 data/tech.json） ---- */
const TECH_CATEGORIES = {
  melon:     { name: '头版大瓜',   icon: '\u{1F349}', desc: '当下科技圈最大的热闹事件（人物/公司/大新闻），讲清来龙去脉和各方反应，让吃瓜群众一句话入坑' },
  ceo:       { name: '大佬名场面', icon: '\u{1F3A4}', desc: '科技大佬（罗永浩/雷军/马斯克/余承东/周鸿祎/黄仁勋等）的真实语录、恩怨互怼、跨界新动作' },
  crypto:    { name: '币圈风云',   icon: '\u{1FA99}', desc: '币圈人物（孙宇晨等）和加密货币圈的真实动态，用吃瓜视角调侃，不下任何投资结论' },
  startup:   { name: '创业大戏',   icon: '\u{1F3AC}', desc: '真实的创业故事：融资翻盘/倒闭反转/创始人恩怨，比电视剧精彩的部分' },
  product:   { name: '新品前瞻',   icon: '\u{1F4FA}', desc: '真实的新品/新业务动态（新手机/AI硬件/大佬搞副业如做电视等），给出值得聊的点和槽点' },
  fail:      { name: '翻车现场',   icon: '\u{1F4A5}', desc: '真实的产品/发布会/公关翻车事件，复盘翻车姿势，吐槽有梗有度' },
  ai:        { name: 'AI 江湖',    icon: '\u{1F916}', desc: 'AI 圈真实动态：新模型发布、大厂明争暗斗、OpenAI/DeepSeek/国内大模型圈八卦' },
  workplace: { name: '码农工位',   icon: '\u{1F4BB}', desc: '程序员圈真实热梗：福利八卦、裁员风向、技术圈吐槽（面试造火箭/工作拧螺丝）' },
};

/* ================================================================
 *  时间段配置
 *  cron 已按 GMT+8 换算为 UTC
 * ================================================================ */

const SLOTS = {
  'weekday-morning': {
    label: '工作日早晨 · 同事聊资',
    time: '07:30',
    cron: '30 23 * * 0-4',    // UTC 23:30(周日至周四) = GMT+8 07:30(周一至周五)
    categories: ['frontend', 'rn', 'aiDev', 'tsJs', 'opensource', 'devCulture'],
    scenario: '上班时和同事聊天、技术闲聊',
    useHotSources: true,      // 工作时段：生成前抓取 Hacker News/Reddit/V2EX/掘金/GitHub Trending 热门帖作为素材
  },
  'weekday-evening': {
    label: '工作日傍晚 · 生活时光',
    time: '17:30',
    cron: '30 9 * * 1-5',     // UTC 09:30 = GMT+8 17:30
    categories: ['news', 'parenting', 'entertainment', 'lifehacks', 'pingpong', 'health'],
    scenario: '下班后和家人聊天、陪孩子、和丈母娘聊时事',
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

function buildPrompt(slotKey, hotItems) {
  const slot = SLOTS[slotKey];
  const now = getBeijingNow();
  const { date, weekday, time } = formatDate(now);
  const cats = slot.categories.map(k => CATEGORIES[k]).filter(Boolean);
  const hotSection = buildHotSection(hotItems || []);

  const systemPrompt = `你是一个专业的"梗库"内容策展人。你的任务是为用户生成当天可以用来聊天、破冰、社交的话题和梗。

核心原则：
1. 内容必须真实、新鲜、有信息量——基于最近的真实热点、趋势和事件，不要编造
2. 每个"梗"要能让人聊得起来——有话题点、有观点、有趣味
3. "怎么聊"部分要给出可以直接说出口的话术，像朋友聊天一样自然口语化
4. 适当加入幽默和趣味，但不要低俗
5. 用中文输出，口语化表达
6. 直接输出实际内容的 JSON 对象：字段名用英文双引号包裹，值全部替换为真实内容。严禁输出示例模板、严禁保留 "..." 或 [...] 占位符、严禁附带任何解释说明文字
7. 不要输出任何 markdown 代码块标记（不要写 \`\`\`json），直接输出纯 JSON`;

  const categoryList = cats.map((c, i) =>
    `${i + 1}. ${c.icon} ${c.name}\n   ${c.desc}`
  ).join('\n\n');

  // 周一早间特别提示：周末两天没推工作内容，今天要补上周末积累的技术梗
  const isMonday = now.getUTCDay() === 1;
  const weekendCatchup = (slotKey === 'weekday-morning' && isMonday)
    ? `\n\n⚠️ 特别提示：今天是周一，上个周末（周六、周日）两天没有推送工作内容，但技术圈动态不会停。请重点覆盖这两天（上周六到今天）发生的工作/技术热点，帮用户补上周末的"技术梗"，不要遗漏周末的重要更新。`
    : '';

  const userPrompt = `今天日期：${date}，${weekday}，时间约 ${time}
时间段：${slot.label}
社交场景：${slot.scenario}

用户画像：
- 职业：React Native / App / 前端开发工程师
- 家庭：丈夫，7岁女孩的父亲
- 丈母娘喜欢聊：时事、生活、儿童教育、乒乓球

请围绕以下 ${cats.length} 个方向，每个方向生成 2-3 个最新、最有料的可聊话题：

${categoryList}
${weekendCatchup}
${hotSection}

每个话题包含以下字段：
- title: 话题名/梗名（简洁有力，10字以内）
- summary: 一句话概括（20字以内）
- detail: 详细解释——为什么火/背景/关键信息（50-150字）
- usage: 怎么聊——可以直接说出口的话术、关键观点、有趣切入点（50-150字）
- source: 原文链接（可选）。基于上方"实时素材"生成的话题，必须填对应素材的 url；否则仅当你非常确定该话题对应的真实官方网站/仓库/文档时才填完整 https:// 链接；不确定就填空字符串 ""。严禁编造或猜测链接！
- tags: 2-3个相关标签

请严格按以下 JSON 结构输出（这是结构示例，不是内容示例——必须把每个字段替换成实际生成的内容，严禁输出 "..." 占位符，直接输出可被 JSON.parse 的纯 JSON，前后不要有任何其他文字）：
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
 *  育儿 Prompt 构建
 *  独立于工作·生活内容，生成 data/parenting.json
 *  核心：真实人物故事 + 科学原理 + 家长沟通话术
 * ================================================================ */

function buildParentingPrompt() {
  const now = getBeijingNow();
  const { date, weekday, time } = formatDate(now);
  const cats = Object.values(PARENTING_CATEGORIES);

  const systemPrompt = `你是一个专业的育儿内容策展人，擅长把真实历史人物故事、科学实验和教育研究转化为家长可以和孩子聊的话题。

核心原则：
1. **真实可溯源**——所有人物故事必须基于真实历史事件，不要编造。科学原理必须有据可查（可追溯到具体实验/研究/人物）
2. **故事性优先**——用具体的人物经历、细节、轶事来讲道理，不要空泛说教。孩子记住的是故事，不是道理
3. **家长视角**——每条给出"怎么和孩子聊"的具体话术，像朋友间分享故事一样自然口语化
4. **适合7岁女孩**——内容难度、兴趣方向适配小学低年级女孩
5. **每个分类 2-3 条**——精选有料的内容，不要凑数
6. 用中文输出，口语化表达
7. 直接输出实际内容的 JSON 对象：字段名用英文双引号包裹，值全部替换为真实内容。严禁输出示例模板、严禁保留 "..." 或 [...] 占位符、严禁附带任何解释说明文字
8. 不要输出任何 markdown 代码块标记（不要写 \`\`\`json），直接输出纯 JSON`;

  const categoryList = cats.map((c, i) =>
    `${i + 1}. ${c.icon} ${c.name}\n   ${c.desc}`
  ).join('\n\n');

  const userPrompt = `今天日期：${date}，${weekday}，时间约 ${time}

用户画像：
- 丈夫，7岁女孩的父亲
- 孩子兴趣：画画、昆虫、英语配音、音乐剧
- 家庭运动：羽毛球、乒乓球、跳绳
- 丈母娘也帮忙带孩子，喜欢聊时事和教育

请围绕以下 ${cats.length} 个方向，每个方向生成 2-3 个最新、最有料的育儿话题：

${categoryList}

每个话题包含以下字段：
- title: 话题名（简洁有力，10字以内，要有故事感）
- summary: 一句话概括（20字以内）
- detail: 详细内容——真实人物/事件/科学原理的背景和故事（80-200字）。必须基于真实历史，不要编造
- usage: 怎么和孩子聊——家长可以直接说出口的话术、引导方式（50-150字）
- source: 原文链接（可选）。仅当你非常确定对应的真实资料来源时才填完整 https:// 链接；不确定就填空字符串 ""。严禁编造链接！
- tags: 2-3个相关标签

⚠️ 特别要求：
- 科学奇人/文人风骨/兴趣深耕/思维启蒙/运动启蒙：每条必须是一个**真实人物**的具体故事，不要泛泛而谈
- 健康食育：每条必须包含**真实科学实验或发现史**（如林德柠檬实验、艾克曼发现维B1等），讲清营养原理
- 亲子行动：给出**可执行的具体方案**（步骤、材料、对话引导词）
- 育儿心法：基于**真实教育研究或案例**（如德韦克成长型思维实验），给可操作的沟通话术

请严格按以下 JSON 结构输出（这是结构示例，不是内容示例——必须把每个字段替换成实际生成的内容，严禁输出 "..." 占位符，直接输出可被 JSON.parse 的纯 JSON，前后不要有任何其他文字）：
{
  "categories": [
    {
      "name": "方向名",
      "icon": "emoji",
      "items": [
        {
          "title": "标题",
          "summary": "一句话概括",
          "detail": "详细内容",
          "usage": "怎么和孩子聊",
          "source": "https://确定的链接或空字符串",
          "tags": ["标签1", "标签2"]
        }
      ]
    }
  ]
}`;

  return { systemPrompt, userPrompt };
}

/* ================================================================
 *  媳妇 Prompt 构建
 *  独立文件 data/wife.json — "老公情商教练"
 *  核心：真实热点 + 话术急救 + 土味情话 + 情绪价值
 * ================================================================ */

function buildWifePrompt(trendItems) {
  const now = getBeijingNow();
  const { date, weekday, time } = formatDate(now);
  const cats = Object.values(WIFE_CATEGORIES);
  const trendSection = buildWifeTrendsSection(trendItems || []);

  const systemPrompt = `你是"老公幽默教练"。核心使命：让程序员老公变得好笑，让媳妇忍不住笑出声。

## 第一原则：幽默高于一切
每条内容首要目标是让媳妇会心一笑。有用但不好笑=失败。宁可少一条干巴巴的建议，也要多一条能让她噗嗤一笑的。

## 幽默技巧（每条至少用2种）
反差对比（先铺垫再突然转向夸她）、悬念停顿（"我发现个严重问题……"停顿再说）、自嘲（调侃理工男属性）、夸张（把小事吹到荒诞："你敷完面膜这皮肤，蚊子落脚都打滑"）、双关（"你问我BUG修完没？你才是我最想解的BUG"）、反转（"今天看到一个超好看的小姐姐……等等那是你照片"）、角色扮演（用霸总/客服口吻说话）、日常荒诞化（"你拖个地比特种兵还帅"）。

## 分方向要求
- 话术急救：❌错误示范 + ✅正确示范 + 原因。正确示范必须好笑
- 土味情话：必须结合当下真实热搜。让她笑→甜，不是尬→冷
- 吃喝情报：像美食博主，有画面感（"那口汤汁入口灵魂升了一层"）
- 追剧指南：真实存在的剧，讨论切入点要好笑
- 她的世界：她聊美妆/追剧时，给老公幽默接话话术（"你说口红色号，我虽然色盲但听得很认真"）
- 暖心行动：肯定她打扫/做饭/带娃，感谢要幽默（"厨房被你收拾得像Apple Store，我都不敢进去踩了"）
- 约会提案：浪漫+幽默，可直接复制发微信
- 情绪价值：倾听共情不讲道理。用幽默化解负能量

## 禁忌
讲道理论对错、敷衍回复、"你很好看"这种无聊正确答案、编造不存在的剧/电影

## 输出
中文口语化。直接输出JSON，不要markdown代码块。`;

  const categoryList = cats.map((c, i) =>
    `${i + 1}. ${c.icon} ${c.name}\n   ${c.desc}`
  ).join('\n\n');

  const userPrompt = `今天日期：${date}，${weekday}，时间约 ${time}

用户画像：程序员老公（理工男，容易讲逻辑不太会幽默），7岁女孩的父亲。媳妇日常：化妆、敷面膜、追剧、偶尔做饭、打扫家务、关心明星动态。

请围绕以下 ${cats.length} 个方向，每个方向生成 2 条内容（共 ${cats.length * 2} 条）：

${categoryList}
${trendSection}

⚠️ 必须输出全部 ${cats.length} 个分类，每个分类恰好 2 条，不要遗漏任何分类！

每条内容字段：
- title: 标题（10字以内，有幽默感）
- summary: 一句话概括（20字以内，有趣味）
- detail: 详细内容（80-200字，有画面感、有反转、有金句）
- usage: 用以下三行格式（用 \\n 分隔）：💡 怎么用时机 \\n 💬 可直接发微信的原话 \\n 🔥 关键词1 关键词2
- source: 确定的链接或空字符串 ""
- tags: 2-3个标签

JSON 结构（把每个字段替换为真实内容，直接输出可被JSON.parse的纯JSON）：
{
  "categories": [
    { "name": "方向名", "icon": "emoji", "items": [
      { "title": "", "summary": "", "detail": "", "usage": "💡 \\n💬 \\n🔥 ", "source": "", "tags": [] }
    ]}
  ]
}`;

  return { systemPrompt, userPrompt };
}

/* ================================================================
 *  实时素材采集
 *  生成前并行抓取 Hacker News / HN Ask / Lobste.rs / dev.to / Reddit /
 *  V2EX / 掘金 / GitHub Trending 的热门帖，作为 prompt 注入素材。
 *  任何源失败都静默跳过，不影响主流程。
 *  素材带真实原文链接 → 生成的话题可直连原文（"👉原文"不再只是搜索兜底）。
 * ================================================================ */

/* ================================================================
 * 科技吃瓜 Prompt 构建
 * 独立文件 data/tech.json — "科技圈吃瓜主编"
 * 核心：真实事件 + 段子讲法 + 程序员同事聊资
 * ================================================================ */

function buildTechPrompt(trendItems) {
  const now = getBeijingNow();
  const { date, weekday, time } = formatDate(now);
  const cats = Object.values(TECH_CATEGORIES);
  const trendSection = buildTechTrendsSection(trendItems || []);

  const systemPrompt = `你是"科技圈吃瓜主编"。核心使命：把科技圈的热闹讲成段子，让程序员上班摸鱼有瓜可吃、和同事聊天有梗可用。

## 第一原则：真实 + 好笑
所有事件必须真实发生（结合素材与你的知识，不确定的宁可不写）。但讲法必须好笑——干巴巴念新闻=失败。

## 讲瓜技巧（每条至少用2种）
反差对比（大佬宏大叙事 vs 现实鸡毛蒜皮）、起外号（给事件起个传得开的梗名）、围观口吻（"家人们谁懂啊"式吃瓜）、金句收尾（一句话总结值得发群里）、时间线讲法（"XX又双叒叕..."）、业内吐槽（程序员视角吐槽发布会PPT、跑分、期货功能）

## 分方向要求
- 头版大瓜：讲清来龙去脉+各方反应，一句话让不吃瓜的同事也能接上
- 大佬名场面：真实大佬的真实语录/恩怨/新动作，引用要准确
- 币圈风云：孙宇晨式人物动态，调侃但不站队不下投资结论
- 创业大戏：真实融资/倒闭/反转故事，突出比电视剧精彩的部分
- 新品前瞻：真实新品/新业务，给值得聊的点+槽点
- 翻车现场：真实翻车复盘，吐槽有梗有度不网暴
- AI 江湖：真实模型/大厂动态，可以调侃军备竞赛
- 码农工位：程序员圈真实热梗，职场人一看就懂

## 禁忌
编造不存在的事件/语录、涉刑案细节、攻击外貌、政治敏感

## 输出
中文口语化。直接输出JSON，不要markdown代码块。`;

  const categoryList = cats.map((c, i) =>
    `${i + 1}. ${c.icon} ${c.name}\n   ${c.desc}`
  ).join('\n\n');

  const userPrompt = `今天日期：${date}，${weekday}，时间约 ${time}

用户画像：程序员，上班和同事聊天，爱科技圈八卦和梗，吃瓜图一乐。

请围绕以下 ${cats.length} 个方向，每个方向生成 2 条内容（共 ${cats.length * 2} 条）：

${categoryList}
${trendSection}

⚠️ 必须输出全部 ${cats.length} 个分类，每个分类恰好 2 条，不要遗漏任何分类！
⚠️ 同一热点事件不要跨分类重复使用（一个瓜只在一个分类里讲）！

每条内容字段：
- title: 标题（10字以内，有梗有画面）
- summary: 一句话概括（20字以内，像热搜词条）
- detail: 详细内容（80-200字，有来龙去脉有吐槽有金句）
- usage: 用以下三行格式（用 \\n 分隔）：💡 怎么聊切入时机 \\n 💬 可直接发群里的原话 \\n 🔥 关键词1 关键词2
- source: 确定的链接或空字符串 ""
- tags: 2-3个标签

JSON 结构（把每个字段替换为真实内容，直接输出可被JSON.parse的纯JSON）：
{
  "categories": [
    { "name": "方向名", "icon": "emoji", "items": [
      { "title": "", "summary": "", "detail": "", "usage": "💡 \\n💬 \\n🔥 ", "source": "", "tags": [] }
    ]}
  ]
}`;

  return { systemPrompt, userPrompt };
}

const SOURCE_UA = 'Mozilla/5.0 (compatible; geng-daily-bot/1.0; +https://github.com/zyestin/geng-daily)';

// 素材上限：注入 prompt 的条目数（控制 token 消耗）
const HOT_ITEMS_LIMIT = 20;

// 明显低质/引战标题，直接过滤（素材是给同事聊天的，要干净）
const BAD_TITLE_WORDS = [
  '出轨', '小三', '渣男', '绿茶', '彩礼', '相亲', '处女', '约炮', '嫖',
  '傻逼', '草泥马', 'cnm', 'wcnm', '打炮', '裸聊',
];

function isBadTitle(t) {
  const s = (t || '').toLowerCase();
  if (s.length < 6 || s.length > 140) return true;
  return BAD_TITLE_WORDS.some(w => s.includes(w));
}

/** 抓取 Hacker News 当日 top stories（官方 Firebase API，免费无 key） */
async function fetchHackerNews() {
  const res = await fetch('https://hacker-news.firebaseio.com/v0/topstories.json', {
    headers: { 'Accept': 'application/json' },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const ids = (await res.json()).slice(0, 15);
  const items = await Promise.all(ids.map(async id => {
    try {
      const s = await (await fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`, {
        signal: AbortSignal.timeout(12000),
      })).json();
      return {
        source: 'Hacker News',
        title: s.title,
        url: s.url || `https://news.ycombinator.com/item?id=${s.id}`,
        score: s.score || 0,
        comments: s.descendants || 0,
      };
    } catch { return null; }
  }));
  return items.filter(Boolean);
}

/** 抓取 Reddit 多个技术子版块的当日 top 帖。
 *  注意：Reddit 官方 JSON 对数据中心 IP（GitHub Actions）常返回 403，
 *  本函数失败会自动降级为空数组，由 Lobste.rs / dev.to / HN Ask 等源补位。 */
const REDDIT_SUBS = [
  'programming', 'reactnative', 'webdev', 'javascript',
  'MachineLearning', 'opensource', 'technology', 'ExperiencedDevs',
];

async function fetchReddit() {
  const results = await Promise.allSettled(REDDIT_SUBS.map(async sub => {
    const res = await fetch(`https://www.reddit.com/r/${sub}/top.json?t=day&limit=3`, {
      headers: { 'User-Agent': SOURCE_UA, 'Accept': 'application/json' },
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const d = await res.json();
    return (d.data?.children || []).map(kid => {
      const p = kid.data || {};
      return {
        source: 'Reddit r/' + sub,
        title: p.title,
        url: 'https://www.reddit.com' + (p.permalink || ''),
        score: p.score || 0,
        comments: p.num_comments || 0,
      };
    });
  }));
  const fulfilled = results.filter(r => r.status === 'fulfilled');
  const failed = results.length - fulfilled.length;
  if (failed > 0) {
    console.warn(`[WARN] Reddit ${failed}/${results.length} 个子版块被拒（数据中心 IP 常被 Reddit 封禁，忽略）`);
  }
  return fulfilled.flatMap(r => r.value);
}

/** 抓取 HN Ask 板块（程序员问答/吐槽，类似 Reddit 的讨论帖） */
async function fetchHnAsk() {
  const res = await fetch('https://hacker-news.firebaseio.com/v0/askstories.json', {
    headers: { 'Accept': 'application/json' },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const ids = (await res.json()).slice(0, 8);
  const items = await Promise.all(ids.map(async id => {
    try {
      const s = await (await fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`, {
        signal: AbortSignal.timeout(12000),
      })).json();
      return {
        source: 'HN Ask',
        title: s.title,
        url: `https://news.ycombinator.com/item?id=${s.id}`,
        score: s.score || 0,
        comments: s.descendants || 0,
      };
    } catch { return null; }
  }));
  return items.filter(Boolean);
}

/** 抓取 Lobste.rs 热门（程序员技术社区，官方 JSON 免费无 key） */
async function fetchLobsters() {
  const res = await fetch('https://lobste.rs/hottest.json', {
    headers: { 'Accept': 'application/json' },
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const d = await res.json();
  return (d || []).slice(0, 10).map(s => ({
    source: 'Lobste.rs',
    title: s.title,
    url: s.url || `https://lobste.rs${s.short_id_url || ''}`,
    score: s.score || 0,
    comments: s.comment_count || 0,
  }));
}

/** 抓取 dev.to 热门文章（开发者社区，官方 API 免费无 key） */
async function fetchDevTo() {
  const res = await fetch('https://dev.to/api/articles?per_page=10', {
    headers: { 'Accept': 'application/json', 'User-Agent': SOURCE_UA },
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const d = await res.json();
  return (d || []).map(s => ({
    source: 'dev.to',
    title: s.title,
    url: s.url || '',
    score: s.positive_reactions_count || 0,
    comments: s.comments_count || 0,
  }));
}

/** 抓取 V2EX 热议（中文程序员社区，官方 API 免费无 key） */
async function fetchV2ex() {
  const res = await fetch('https://www.v2ex.com/api/topics/hot.json', {
    headers: { 'User-Agent': SOURCE_UA, 'Accept': 'application/json' },
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const d = await res.json();
  return (d || []).slice(0, 10).map(t => ({
    source: 'V2EX',
    title: t.title,
    url: `https://www.v2ex.com/t/${t.id}`,
    score: t.replies || 0,
    comments: t.replies || 0,
  }));
}

/** 抓取掘金推荐热文（中文技术社区） */
async function fetchJuejin() {
  const res = await fetch('https://api.juejin.cn/recommend_api/v1/article/recommend_all_feed', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': SOURCE_UA },
    body: JSON.stringify({ id_type: 2, sort_type: 3, cursor: '0', limit: 10 }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const d = await res.json();
  return (d.data || []).map(x => {
    const info = x.item_info?.article_info || {};
    return {
      source: '掘金',
      title: info.title,
      url: info.link_url || `https://juejin.cn/post/${info.article_id}`,
      score: info.digg_count || 0,
      comments: info.comment_count || 0,
    };
  });
}

/** 简易 RSS 2.0 解析（零依赖）：提取 title/link/description/pubDate，
 *  先解 CDATA/实体再 strip 标签；按发布时间倒序并过滤超龄条目（默认 7 天）。
 *  注意：部分站点的 feed 会混排历史旧文（如 InfoQ），必须按 pubDate 过滤。 */
function parseRss(xml, sourceName, limit = 10, maxAgeDays = 7) {
  const clean = (raw = '') => raw
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')   // 先解 CDATA
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/<[^>]+>/g, ' ')                       // 再 strip 标签
    .replace(/\s+/g, ' ').trim();
  const items = [];
  const re = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const b = m[1];
    const title = clean(b.match(/<title>([\s\S]*?)<\/title>/)?.[1]);
    const link = clean(b.match(/<link>([\s\S]*?)<\/link>/)?.[1]);
    let desc = clean(b.match(/<description>([\s\S]*?)<\/description>/)?.[1]);
    if (!title || !link) continue;
    if (!desc || /点击查看原文|^.{0,12}$/.test(desc)) desc = ''; // 丢弃无信息量的摘要
    const ts = new Date(clean(b.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1])).getTime() || 0;
    items.push({
      source: sourceName,
      title: desc ? `${title} — ${desc.slice(0, 100)}` : title,
      url: link,
      score: 0,
      comments: 0,
      ts,
      // 编辑部精选权重：仅略高于普通社区帖，避免压过中高分帖；
      // 中文头条靠下方保底配额兜底，不需要高基准分。
      rankScore: sourceName === '量子位' ? 150 : 140,
    });
  }
  items.sort((a, b) => b.ts - a.ts); // 按发布时间倒序（过滤混排旧文）
  const cutoff = Date.now() - maxAgeDays * 864e5;
  return items.filter(i => i.ts >= cutoff).slice(0, limit);
}

/** 抓取量子位（中文 AI 圈头条 RSS，编辑部精选，天然带梗） */
async function fetchQbitai() {
  const res = await fetch('https://www.qbitai.com/feed', {
    headers: { 'User-Agent': SOURCE_UA, 'Accept': 'application/rss+xml, application/xml, text/xml, */*' },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return parseRss(await res.text(), '量子位', 8);
}

/** 抓取 InfoQ 中国（软件工程深度报道 RSS，偏技术向）
 *  注意：InfoQ 对 bot UA 会返回 2019 年的缓存快照 feed，必须用浏览器 UA 才返回最新条目。 */
async function fetchInfoq() {
  const res = await fetch('https://www.infoq.cn/feed', {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
      'Accept': 'application/rss+xml, application/xml, text/xml, */*',
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return parseRss(await res.text(), 'InfoQ', 8);
}

/** 抓取百度热搜榜（JSON API，免费无 key）。
 *  返回实时热搜词条，适合作为"她的世界"/"追剧指南"素材注入媳妇 prompt。
 *  微博热搜 API 需要登录 cookie（403），百度热搜无需认证更可靠。
 *  失败静默跳过——媳妇内容不依赖外部素材也能生成（AI 基于训练知识兜底）。 */
async function fetchBaiduHot() {
  const res = await fetch('https://top.baidu.com/api/board?platform=wise&tab=realtime', {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
      'Accept': 'application/json',
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const d = await res.json();
  const raw = d.data?.cards?.[0]?.content?.[0]?.content || [];
  const items = raw.filter(s => s.word).slice(0, 20).map(s => ({
    source: '百度热搜',
    title: s.word,
    url: s.url || `https://www.baidu.com/s?wd=${encodeURIComponent(s.word)}`,
    score: s.index || 0,
    comments: 0,
    rankScore: 200,
  }));
  return items;
}

/** 抓取今日头条热榜（JSON API，免费无 key）。
 *  覆盖面比百度热搜广（社会+科技+娱乐混合），适合科技吃瓜频道素材。
 *  失败静默跳过——吃瓜内容不依赖外部素材也能生成（AI 基于训练知识兜底）。 */
async function fetchToutiao() {
  const res = await fetch('https://www.toutiao.com/hot-event/hot-board/?origin=toutiao_pc', {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
      'Accept': 'application/json',
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const d = await res.json();
  const raw = d.data || [];
  const items = raw.filter(s => s.Title).slice(0, 20).map(s => ({
    source: '头条热榜',
    title: s.Title,
    url: s.Url || `https://so.toutiao.com/search?keyword=${encodeURIComponent(s.Title)}`,
    score: s.HotValue || 0,
    comments: 0,
    rankScore: 150,
  }));
  return items;
}

/** 抓取 GitHub Trending 今日热门仓库（无官方 API，解析 HTML） */
async function fetchGithubTrending() {
  const res = await fetch('https://github.com/trending?since=daily', {
    headers: { 'User-Agent': SOURCE_UA },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const html = await res.text();
  const blocks = [...html.matchAll(/<article class="Box-row">([\s\S]*?)<\/article>/g)];
  const items = [];
  for (const b of blocks.slice(0, 10)) {
    const href = b[1].match(/<h2[^>]*>[\s\S]*?<a[^>]*href="\/([^"]+)"/)?.[1];
    if (!href || href.includes('/stargazers') || href.includes('/forks')) continue;
    const descRaw = b[1].match(/<p[^>]*class="col-9[^"]*"[^>]*>([\s\S]*?)<\/p>/)?.[1] || '';
    const desc = descRaw.replace(/<[^>]+>/g, '').trim().slice(0, 120);
    const starsRaw = b[1].match(/([\d.,]+)\s*<\/a>\s*<\/span>[\s\S]*?stars/)?.[1]
      || b[1].match(/([\d.,]+)\s+stars/i)?.[1] || '';
    items.push({
      source: 'GitHub Trending',
      title: `${href}${desc ? ' — ' + desc : ''}`,
      url: 'https://github.com/' + href,
      score: parseInt(starsRaw.replace(/[.,]/g, ''), 10) || 0,
      comments: 0,
    });
  }
  return items;
}

/**
 * 并行抓取全部信息源，汇总去重、过滤低质标题、按热度排序。
 * 返回 { items: 标准化素材数组, stats: {源: 条数} }；全部失败时 items 为空。
 */
async function fetchHotItems() {
  const fetchers = {
    hackernews: fetchHackerNews,
    reddit: fetchReddit,
    askhn: fetchHnAsk,
    lobsters: fetchLobsters,
    devto: fetchDevTo,
    v2ex: fetchV2ex,
    juejin: fetchJuejin,
    github: fetchGithubTrending,
    qbitai: fetchQbitai,
    infoq: fetchInfoq,
  };
  const results = await Promise.allSettled(
    Object.entries(fetchers).map(async ([name, fn]) => {
      const items = await fn();
      console.log(`[INFO] 素材源 ${name}: ${items.length} 条`);
      return { name, items };
    })
  );
  const stats = {};
  const all = [];
  for (const r of results) {
    if (r.status === 'fulfilled') {
      stats[r.value.name] = r.value.items.length;
      all.push(...r.value.items);
    } else {
      console.warn(`[WARN] 素材源抓取失败（跳过，不影响生成）: ${r.reason?.message || r.reason}`);
    }
  }
  // 去重（按 url）+ 过滤低质标题 + 按热度排序
  const seen = new Set();
  const deduped = all
    .filter(i => i.title && !isBadTitle(i.title))
    .filter(i => {
      if (seen.has(i.url)) return false;
      seen.add(i.url);
      return true;
    })
    .sort((a, b) => (b.rankScore ?? b.score) - (a.rankScore ?? a.score));

  // 中文精选源保底：量子位 / InfoQ 各至少 3 条进池。
  // 原因：它们没有社区热度分，纯分数竞争会被高分英文帖挤出 Top20；
  // 但中文头条是编辑部精选、可直接用作聊天话题，价值值得保底配额。
  // 注意：受保底的源之间互不挤占（挤掉池尾时只允许删非保底源）。
  const CHINESE_MIN = 3;
  const GUARDED_SOURCES = ['量子位', 'InfoQ'];
  const top = deduped.slice(0, HOT_ITEMS_LIMIT);
  for (const srcName of GUARDED_SOURCES) {
    let inPool = top.filter(i => i.source === srcName).length;
    if (inPool >= CHINESE_MIN) continue;
    const candidates = deduped.filter(i => i.source === srcName && !top.includes(i));
    for (const c of candidates) {
      if (inPool >= CHINESE_MIN) break;
      // 从池尾挤掉一条非保底源的最低分项
      for (let k = top.length - 1; k >= 0; k--) {
        if (!GUARDED_SOURCES.includes(top[k].source)) { top.splice(k, 1); break; }
      }
      top.push(c);
      inPool++;
    }
  }
  top.sort((a, b) => (b.rankScore ?? b.score) - (a.rankScore ?? a.score));
  const items = top;
  return { items, stats };
}

/** 把素材列表拼成注入 prompt 的文本段 */
function buildHotSection(items) {
  if (!items.length) return '';
  const lines = items.map((it, i) =>
    `${i + 1}. [${it.source}] ${it.title}（${it.score ? '↑' + it.score + ' 分' : ''}${it.comments ? ' · ' + it.comments + ' 评论' : ''}）→ ${it.url}`
  ).join('\n');
  return `\n\n## 📡 今日实时素材（抓取自 Hacker News / HN Ask / Lobste.rs / dev.to / V2EX / 掘金 / GitHub Trending / 量子位 / InfoQ）\n\n以下是今天各技术社区的真实热门帖。规则：\n1. 优先从这些素材中挑选生成话题——能选到就尽量用素材，不要凭空编造\n2. 素材标题多为英文，请用中文总结成同事间能聊的话题，并把原帖的"梗点"（评论区高赞观点、槽点、亮点）带出来\n3. 凡基于素材生成的话题，source 字段必须填该素材的 url（用户会点开看原文和评论区）\n4. 若素材中没有合适的，再自由发挥；自由发挥的话题 source 留空 ""\n5. 素材中若有低质、引战、无关内容，直接跳过不用\n\n${lines}`;
}

/* ================================================================
 *  媳妇频道素材采集（微博热搜等女性关注趋势源）
 *  独立于工作时段的技术素材池——媳妇频道需要的是娱乐/明星/生活趋势
 * ================================================================ */

async function fetchWifeTrends() {
  const fetchers = {
    baidu: fetchBaiduHot,
  };
  const results = await Promise.allSettled(
    Object.entries(fetchers).map(async ([name, fn]) => {
      const items = await fn();
      console.log(`[INFO] 媳妇素材源 ${name}: ${items.length} 条`);
      return { name, items };
    })
  );
  const stats = {};
  const all = [];
  for (const r of results) {
    if (r.status === 'fulfilled') {
      stats[r.value.name] = r.value.items.length;
      all.push(...r.value.items);
    } else {
      console.warn(`[WARN] 媳妇素材源抓取失败（跳过，不影响生成）: ${r.reason?.message || r.reason}`);
    }
  }
  const seen = new Set();
  const deduped = all
    .filter(i => i.title && !isBadTitle(i.title))
    .filter(i => {
      if (seen.has(i.url)) return false;
      seen.add(i.url);
      return true;
    })
    .sort((a, b) => (b.rankScore ?? b.score) - (a.rankScore ?? a.score));
  return { items: deduped.slice(0, 15), stats };
}

/** 把媳妇素材列表拼成注入 prompt 的文本段 */
function buildWifeTrendsSection(items) {
  if (!items.length) return '';
  const lines = items.map((it, i) =>
    `${i + 1}. [${it.source}] ${it.title}（${it.score ? '热度' + it.score : ''}）→ ${it.url}`
  ).join('\n');
  return `\n\n## 📡 今日热搜趋势（抓取自 百度热搜 等）\n\n以下是今天女性关注领域的热搜趋势。规则：\n1. 优先从这些素材中挑选生成话题——追剧指南/她的世界/土味情话等方向尽量结合这些热点\n2. 凡基于素材生成的话题，source 字段必须填该素材的 url\n3. 素材中若有无关内容，直接跳过不用\n\n${lines}`;
}

/* ================================================================
 * 科技吃瓜频道素材采集（百度热搜 + 头条热榜）
 *  吃瓜频道需要的是科技圈/大佬/大新闻趋势，双源互补：
 *  百度热搜偏实时事件，头条热榜覆盖面广
 * ================================================================ */

async function fetchTechTrends() {
  const fetchers = {
    baidu: fetchBaiduHot,
    toutiao: fetchToutiao,
  };
  const results = await Promise.allSettled(
    Object.entries(fetchers).map(async ([name, fn]) => {
      const items = await fn();
      console.log(`[INFO] 吃瓜素材源 ${name}: ${items.length} 条`);
      return { name, items };
    })
  );
  const stats = {};
  const all = [];
  for (const r of results) {
    if (r.status === 'fulfilled') {
      stats[r.value.name] = r.value.items.length;
      all.push(...r.value.items);
    } else {
      console.warn(`[WARN] 吃瓜素材源抓取失败（跳过，不影响生成）: ${r.reason?.message || r.reason}`);
    }
  }
  const seen = new Set();
  const deduped = all
    .filter(i => i.title && !isBadTitle(i.title))
    .filter(i => {
      if (seen.has(i.title)) return false;
      seen.add(i.title);
      return true;
    });
  // 两源交替混合（百度1条/头条1条轮流），避免单一热榜霸屏
  const bySrc = {};
  for (const i of deduped) {
    (bySrc[i.source] = bySrc[i.source] || []).push(i);
  }
  const srcArrs = Object.values(bySrc);
  const mixed = [];
  outer: for (let k = 0; k < 40; k++) {
    for (const arr of srcArrs) {
      if (arr[k]) mixed.push(arr[k]);
      if (mixed.length >= 20) break outer;
    }
  }
  return { items: mixed, stats };
}

/** 把吃瓜素材列表拼成注入 prompt 的文本段 */
function buildTechTrendsSection(items) {
  if (!items.length) return '';
  const lines = items.map((it, i) =>
    `${i + 1}. [${it.source}] ${it.title}（${it.score ? '热度' + it.score : ''}）→ ${it.url}`
  ).join('\n');
  return `\n\n## 📡 今日热搜素材（抓取自 百度热搜 / 头条热榜）\n\n以下是今天的全网热搜。规则：\n1. 其中科技圈相关的大瓜/大佬/新品/翻车事件优先选用，source 字段必须填该素材的 url\n2. 热搜之外，你也可以结合你知识库里最近的科技圈大事件（大佬新动作/币圈人物/AI圈动态/程序员热梗）生成，不确定真实性的不写，source 留空 ""\n3. 与科技圈完全无关的纯娱乐/社会新闻跳过不用\n\n${lines}`;
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
  'nvidia/nemotron-3-super-120b-a12b:free',
  'openai/gpt-oss-20b:free',
  'google/gemma-4-26b-a4b-it:free',
  'nvidia/nemotron-3.5-lightning:free',
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

// 付费模型兜底：免费模型全部 429/失败后，自动切到这些模型。
// 选型标准：中文好 + JSON 输出可靠 + 价格极低（每次生成 ~8000 token，费用 < $0.01）
// 顺序：先试最便宜最好的
const PAID_FALLBACK_MODELS = [
  'deepseek/deepseek-chat',     // DeepSeek V3 — 中文顶级，~$0.14/M input, $0.28/M output（每次约 $0.002）
  'openai/gpt-4o-mini',         // GPT-4o mini — JSON 最可靠，~$0.15/M input, $0.60/M output（每次约 $0.004）
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
 * 组装本次模型队列：显式配置优先 → 自动免费模型 → 内置兜底免费模型 → 付费兜底。
 * 队列结构：前 N 个为免费（先省额度），后 M 个为付费（免费全挂时兜底）。
 * 返回 { models: 去重后的模型 id[], maxTokensMap }。
 */
function pickModels(freeInfo) {
  const explicitMain = (process.env.OPENROUTER_MODEL || '').trim();
  const explicitFallbacks = (process.env.OPENROUTER_FALLBACK_MODELS || '')
    .split(',').map(s => s.trim()).filter(Boolean);
  const auto = freeInfo ? freeInfo.ids : [];

  // ---- 免费层：最多 FREE_MODEL_TOP_N 个 ----
  const freeQueue = [];
  if (explicitMain) freeQueue.push(explicitMain);
  for (const id of explicitFallbacks) if (!freeQueue.includes(id)) freeQueue.push(id);
  for (const id of auto) {
    if (freeQueue.length >= FREE_MODEL_TOP_N) break;
    if (!freeQueue.includes(id)) freeQueue.push(id);
  }
  for (const id of DEFAULT_MODELS) {
    if (freeQueue.length >= FREE_MODEL_TOP_N) break;
    if (!freeQueue.includes(id)) freeQueue.push(id);
  }
  if (freeQueue.length === 0) freeQueue.push(...DEFAULT_MODELS);

  // ---- 付费层：追加在免费之后 ----
  const paidQueue = PAID_FALLBACK_MODELS.filter(id => !freeQueue.includes(id));

  const models = [...freeQueue.slice(0, FREE_MODEL_TOP_N), ...paidQueue];

  console.log(`[INFO] 模型队列 (${freeQueue.length} 免费 + ${paidQueue.length} 付费兜底):`);
  console.log('  ' + models.map((m, i) =>
    `${i + 1}. ${m}${i < freeQueue.slice(0, FREE_MODEL_TOP_N).length ? ' [免费]' : ' [付费兜底]'}`
  ).join('\n  '));

  return {
    models,
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
 * @param {string[]} preferredModels 可选。指定的优先模型列表（如媳妇频道首选 DeepSeek 追求中文幽默）。
 *   指定后会插入到队列最前面，原免费+付费队列紧随其后作为兜底。
 */
async function generateContent(systemPrompt, userPrompt, expectedCategories, preferredModels) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    console.error('[ERROR] 环境变量 OPENROUTER_API_KEY 未设置');
    console.error('请在 GitHub Secrets 或本地 .env 中配置');
    process.exit(1);
  }

  // 每次运行拉取 1 次免费模型列表，选性能最好的 3 个作为主备模型
  const freeInfo = await fetchFreeModels(apiKey);
  const { models: defaultModels, maxTokensMap } = pickModels(freeInfo);
  const pricingMap = freeInfo ? freeInfo.pricingMap : {};

  // 如果有指定优先模型，插到队列最前面
  let models = defaultModels;
  if (preferredModels && preferredModels.length > 0) {
    const prefixed = preferredModels.filter(m => !defaultModels.includes(m));
    models = [...preferredModels, ...defaultModels.filter(m => !preferredModels.includes(m))];
    console.log(`[INFO] 本次使用指定优先模型: ${preferredModels.join(', ')}`);
    console.log(`[INFO] 完整模型队列: ${models.join(' → ')}`);
  }

  // 区分免费层和付费层，切到付费时打 WARN 提醒
  const freeCount = models.filter(m => !PAID_FALLBACK_MODELS.includes(m) && !(preferredModels || []).includes(m)).length;

  let lastErr = '';
  for (let i = 0; i < models.length; i++) {
    const model = models[i];
    const isPreferred = (preferredModels || []).includes(model);
    const isPaid = PAID_FALLBACK_MODELS.includes(model);
    if (isPaid && !isPreferred) {
      console.warn(`[WARN] 免费模型全部失败，切换到付费兜底模型: ${model}`);
    } else if (isPreferred && isPaid) {
      console.log(`[INFO] 使用指定优先模型（付费）: ${model}`);
    }
    try {
      const result = await callModel(model, systemPrompt, userPrompt, maxTokensMap[model]);
      const parsed = parseContent(result.content);
      validateContent(parsed, expectedCategories);
      const meta = buildMeta(model, result, pricingMap);
      const shownModel = result.actualModel && result.actualModel !== model
        ? `${model} → ${result.actualModel}` : model;
      const costStr = meta.cost_usd === null ? 'N/A' : `$${meta.cost_usd.toFixed(6)}`;
      const tag = meta.free ? '🎉 免费' : `💰 付费(${costStr})`;
      console.log(`[OK] 生成成功（模型 ${shownModel}，tokens=${meta.total_tokens}，${tag}）`);
      return { content: parsed, meta };
    } catch (e) {
      lastErr = e.message;
      console.warn(`[WARN] 模型 ${model} 生成失败: ${e.message}`);
      await sleep(!isPaid ? 15000 : 5000);
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

  // response_format 可强制 JSON 输出，但部分模型不支持。
  // 首次尝试带 response_format；若报错则降级重试（不带 response_format）。
  let useJsonFormat = true;
  let lastErr = '';
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    console.log(`[INFO] 调用 OpenRouter... 模型: ${model} (第${attempt}次${useJsonFormat ? ', JSON模式' : ''})`);
    try {
      const body = {
        model,
        messages,
        temperature: 0.85,
        max_tokens: maxTokens,
      };
      if (useJsonFormat) {
        body.response_format = { type: 'json_object' };
      }
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://github.com/geng-daily',
          'X-Title': 'geng-daily',
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        lastErr = `HTTP ${response.status} ${response.statusText}`;
        console.warn(`[WARN] ${lastErr}`);
        // 400/422 可能是不支持 response_format，降级重试
        if ((response.status === 400 || response.status === 422) && useJsonFormat) {
          console.warn('[WARN] 可能不支持 response_format，降级重试...');
          useJsonFormat = false;
          continue;
        }
        // 5xx/429 限流或服务抖动：等久一点重试
        if (response.status >= 500 || response.status === 429) {
          await sleep(15000 * attempt);
          continue;
        }
        break;
      }

      const data = await response.json();
      if (data.error) {
        lastErr = JSON.stringify(data.error).substring(0, 200);
        console.warn(`[WARN] API 错误对象: ${lastErr}`);
        // 如果是 response_format 相关错误，降级
        if (useJsonFormat && lastErr.includes('response_format')) {
          console.warn('[WARN] response_format 不支持，降级重试...');
          useJsonFormat = false;
          continue;
        }
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
      await sleep(15000 * attempt);
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
    // 提取 + 截断：输出可能混有思考文字/尾部残段。
    // 从后往前尝试每个 "{" 起点，取括号平衡的完整对象；再从右往左截断到
    // 最后一个 }/] 处理尾部残段，缺失括号自动补全。
    s => {
      const starts = [];
      for (let i = 0; i < s.length; i++) if (s[i] === '{') starts.push(i);
      let lastErr2 = '';
      for (let i = starts.length - 1; i >= 0; i--) {
        const head = s.slice(starts[i]);
        try {
          // 从该起点扫描括号平衡，遇到完整闭合或需要截断/补全
          const stack = [];
          let inStr = false, escaped = false, cut = -1;
          for (let j = 0; j < head.length; j++) {
            const ch = head[j];
            if (inStr) {
              if (escaped) escaped = false;
              else if (ch === '\\') escaped = true;
              else if (ch === '"') inStr = false;
              continue;
            }
            if (ch === '"') inStr = true;
            else if (ch === '{' || ch === '[') stack.push(ch);
            else if (ch === '}' || ch === ']') {
              if (!stack.length) { cut = -1; break; } // 括号不匹配，起点无效
              stack.pop();
              if (stack.length === 0) { cut = j + 1; break; }
            }
          }
          if (cut < 0) { lastErr2 = '起点无效'; continue; }
          // 截断到已闭合处；若提前耗尽，用堆栈补全
          let cand = head.slice(0, cut);
          if (stack.length) {
            let tail = '';
            while (stack.length) tail += stack.pop() === '{' ? '}' : ']';
            cand += tail;
          }
          const parsed = JSON.parse(cand);
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
        } catch (e) { lastErr2 = e.message; }
      }
      throw new Error('无法提取完整 JSON: ' + lastErr2);
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

  // --fetch-only 调试模式：只抓实时素材并打印素材池分布，不调用 AI（不消耗模型额度）
  if (process.argv.includes('--fetch-only')) {
    const slot = SLOTS[slotKey];
    if (!slot.useHotSources) {
      console.log(`[INFO] 时段 ${slotKey} 不使用实时素材，无需抓取`);
      return;
    }
    const hot = await fetchHotItems();
    const bySrc = {};
    hot.items.forEach(i => { bySrc[i.source] = (bySrc[i.source] || 0) + 1; });
    console.log(`\n[INFO] 素材池共 ${hot.items.length} 条（Top20）:`);
    hot.items.forEach((it, i) => console.log(`  ${i + 1}. [${it.source}] ${it.title.slice(0, 60)}`));
    console.log(`\n[INFO] 按源分布: ${JSON.stringify(bySrc)}`);
    return;
  }

  // --wife-sources 调试模式：只抓媳妇频道素材（微博热搜等）
  if (process.argv.includes('--wife-sources')) {
    const trends = await fetchWifeTrends();
    console.log(`\n[INFO] 媳妇素材池共 ${trends.items.length} 条:`);
    trends.items.forEach((it, i) => console.log(`  ${i + 1}. [${it.source}] ${it.title.slice(0, 60)}`));
    console.log(`\n[INFO] 按源分布: ${JSON.stringify(trends.stats)}`);
    return;
  }

  // --tech-sources 调试模式：只抓吃瓜频道素材（百度热搜/头条热榜）
  if (process.argv.includes('--tech-sources')) {
    const techTrends = await fetchTechTrends();
    console.log(`\n[INFO] 吃瓜素材池共 ${techTrends.items.length} 条:`);
    techTrends.items.forEach((it, i) => console.log(`  ${i + 1}. [${it.source}] ${it.title.slice(0, 60)}`));
    console.log(`\n[INFO] 按源分布: ${JSON.stringify(techTrends.stats)}`);
    return;
  }

  const slot = SLOTS[slotKey];

  console.log('====================================');
  console.log('       梗日报 — 内容生成');
  console.log('====================================');
  console.log('时间段:', slotKey);
  console.log('标签:', slot.label);
  console.log('方向:', slot.categories.map(k => CATEGORIES[k].name).join(', '));
  console.log('');

  // 工作时段：先抓一轮实时素材（Hacker News/Reddit/V2EX/掘金/GitHub Trending）
  let hotItems = [];
  let hotStats = {};
  if (slot.useHotSources) {
    console.log('\n[INFO] 抓取实时素材（Hacker News / Reddit / V2EX / 掘金 / GitHub Trending）...');
    const hot = await fetchHotItems();
    hotItems = hot.items;
    hotStats = hot.stats;
    console.log(`[INFO] 素材就绪: ${hotItems.length} 条（${Object.entries(hotStats).map(([k, v]) => k + ':' + v).join(', ') || '无'}）`);
    console.log('[INFO] Top 5 素材:');
    hotItems.slice(0, 5).forEach((it, i) => console.log(`       ${i + 1}. [${it.source}] ${it.title.slice(0, 60)}`));
  }

  const { systemPrompt, userPrompt } = buildPrompt(slotKey, hotItems);
  const { content, meta } = await generateContent(systemPrompt, userPrompt, slot.categories.length);
  const total = validateContent(content);

  // 补充元数据
  content.generated_at = new Date().toISOString();
  content.slot = slotKey;
  content.slot_label = slot.label;
  content.meta = meta; // 模型 / token / 费用统计（网页末尾展示）
  if (slot.useHotSources) {
    content.meta.sources = { per_source: hotStats, total: hotItems.length }; // 素材统计
  }

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

  // 重建历史索引（主内容：排除育儿和媳妇归档）
  const history = rebuildHistory(dataDir, null);
  const historyPath = join(dataDir, 'history.json');
  writeFileSync(historyPath, JSON.stringify(history, null, 2));
  console.log(`[OK] 已更新历史索引: ${historyPath}（${history.items.length} 条记录）`);

  /* ---- 育儿内容生成（evening / weekend 时段） ---- */
  // weekday-morning 是纯工作时段，不生成育儿内容
  if (slotKey !== 'weekday-morning') {
    console.log('\n====================================');
    console.log('  育儿内容生成');
    console.log('====================================');

    const { systemPrompt: pSystem, userPrompt: pUser } = buildParentingPrompt();
    const pCats = Object.keys(PARENTING_CATEGORIES).length;
    const { content: pContent, meta: pMeta } = await generateContent(pSystem, pUser, pCats);
    const pTotal = validateContent(pContent, pCats);

    pContent.generated_at = new Date().toISOString();
    pContent.slot = slotKey;
    pContent.slot_label = slot.label;
    pContent.meta = pMeta;

    // 确保 icon 字段存在
    const pCatMap = {};
    for (const [k, v] of Object.entries(PARENTING_CATEGORIES)) pCatMap[v.name] = v.icon;
    for (const cat of pContent.categories) {
      if (!cat.icon) cat.icon = pCatMap[cat.name] || '';
    }

    const parentingPath = join(dataDir, 'parenting.json');
    writeFileSync(parentingPath, JSON.stringify(pContent, null, 2));
    console.log(`[OK] 已写入: ${parentingPath}`);

    // 育儿归档
    const pArchivePath = join(archiveDir, `${dateStr}-parenting-${slotKey}.json`);
    writeFileSync(pArchivePath, JSON.stringify(pContent, null, 2));
    console.log(`[OK] 已归档: ${pArchivePath}`);

    // 重建育儿历史索引（独立文件 data/parenting-history.json）
    const parentingHistory = rebuildHistory(dataDir, 'parenting');
    const parentingHistoryPath = join(dataDir, 'parenting-history.json');
    writeFileSync(parentingHistoryPath, JSON.stringify(parentingHistory, null, 2));
    console.log(`[OK] 已更新育儿历史索引: ${parentingHistoryPath}（${parentingHistory.items.length} 条记录）`);

    console.log(`\n====================================`);
    console.log(`  育儿完成! 共 ${pTotal} 个话题`);
    console.log(`====================================`);
  }

  /* ---- 媳妇内容生成（evening / weekend 时段） ---- */
  // weekday-morning 是纯工作时段，不生成媳妇内容
  if (slotKey !== 'weekday-morning') {
    console.log('\n====================================');
    console.log('  媳妇内容生成');
    console.log('====================================');

    // 抓取微博热搜等女性关注趋势素材
    let trendItems = [];
    let trendStats = {};
    console.log('[INFO] 抓取媳妇素材（百度热搜 等）...');
    const trends = await fetchWifeTrends();
    trendItems = trends.items;
    trendStats = trends.stats;
    console.log(`[INFO] 媳妇素材就绪: ${trendItems.length} 条（${Object.entries(trendStats).map(([k, v]) => k + ':' + v).join(', ') || '无'}）`);

    const { systemPrompt: wSystem, userPrompt: wUser } = buildWifePrompt(trendItems);
    const wCats = Object.keys(WIFE_CATEGORIES).length;
    // 媳妇频道首选 DeepSeek — 中文幽默最强，非中文模型幽默效果差
    const { content: wContent, meta: wMeta } = await generateContent(wSystem, wUser, wCats, ['deepseek/deepseek-chat']);
    const wTotal = validateContent(wContent, wCats);

    wContent.generated_at = new Date().toISOString();
    wContent.slot = slotKey;
    wContent.slot_label = slot.label;
    wContent.meta = wMeta;
    if (trendItems.length) {
      wContent.meta.sources = { per_source: trendStats, total: trendItems.length };
    }

    // 确保 icon 字段存在
    const wCatMap = {};
    for (const [k, v] of Object.entries(WIFE_CATEGORIES)) wCatMap[v.name] = v.icon;
    for (const cat of wContent.categories) {
      if (!cat.icon) cat.icon = wCatMap[cat.name] || '';
    }

    const wifePath = join(dataDir, 'wife.json');
    writeFileSync(wifePath, JSON.stringify(wContent, null, 2));
    console.log(`[OK] 已写入: ${wifePath}`);

    // 媳妇归档
    const wArchivePath = join(archiveDir, `${dateStr}-wife-${slotKey}.json`);
    writeFileSync(wArchivePath, JSON.stringify(wContent, null, 2));
    console.log(`[OK] 已归档: ${wArchivePath}`);

    // 重建媳妇历史索引（独立文件 data/wife-history.json）
    const wifeHistory = rebuildHistory(dataDir, 'wife');
    const wifeHistoryPath = join(dataDir, 'wife-history.json');
    writeFileSync(wifeHistoryPath, JSON.stringify(wifeHistory, null, 2));
    console.log(`[OK] 已更新媳妇历史索引: ${wifeHistoryPath}（${wifeHistory.items.length} 条记录）`);

    console.log(`\n====================================`);
    console.log(`  媳妇完成! 共 ${wTotal} 个话题`);
    console.log(`====================================`);
  }

  /* ---- 科技吃瓜内容生成（全部时段——早间同事聊瓜，晚间家庭闲聊照样有瓜） ---- */
  {
    console.log('\n====================================');
    console.log('  科技吃瓜内容生成');
    console.log('====================================');

    // 抓取百度热搜 + 头条热榜作为吃瓜素材
    let techTrendItems = [];
    let techTrendStats = {};
    console.log('[INFO] 抓取吃瓜素材（百度热搜 / 头条热榜）...');
    const techTrends = await fetchTechTrends();
    techTrendItems = techTrends.items;
    techTrendStats = techTrends.stats;
    console.log(`[INFO] 吃瓜素材就绪: ${techTrendItems.length} 条（${Object.entries(techTrendStats).map(([k, v]) => k + ':' + v).join(', ') || '无'}）`);

    const { systemPrompt: tSystem, userPrompt: tUser } = buildTechPrompt(techTrendItems);
    const tCats = Object.keys(TECH_CATEGORIES).length;
    // 吃瓜频道首选 DeepSeek — 中文段子手，吃瓜幽默效果最好
    const { content: tContent, meta: tMeta } = await generateContent(tSystem, tUser, tCats, ['deepseek/deepseek-chat']);
    const tTotal = validateContent(tContent, tCats);

    tContent.generated_at = new Date().toISOString();
    tContent.slot = slotKey;
    tContent.slot_label = slot.label;
    tContent.meta = tMeta;
    if (techTrendItems.length) {
      tContent.meta.sources = { per_source: techTrendStats, total: techTrendItems.length };
    }

    // 确保 icon 字段存在
    const tCatMap = {};
    for (const [k, v] of Object.entries(TECH_CATEGORIES)) tCatMap[v.name] = v.icon;
    for (const cat of tContent.categories) {
      if (!cat.icon) cat.icon = tCatMap[cat.name] || '';
    }

    const techPath = join(dataDir, 'tech.json');
    writeFileSync(techPath, JSON.stringify(tContent, null, 2));
    console.log(`[OK] 已写入: ${techPath}`);

    // 吃瓜归档
    const tArchivePath = join(archiveDir, `${dateStr}-tech-${slotKey}.json`);
    writeFileSync(tArchivePath, JSON.stringify(tContent, null, 2));
    console.log(`[OK] 已归档: ${tArchivePath}`);

    // 重建吃瓜历史索引（独立文件 data/tech-history.json）
    const techHistory = rebuildHistory(dataDir, 'tech');
    const techHistoryPath = join(dataDir, 'tech-history.json');
    writeFileSync(techHistoryPath, JSON.stringify(techHistory, null, 2));
    console.log(`[OK] 已更新吃瓜历史索引: ${techHistoryPath}（${techHistory.items.length} 条记录）`);

    console.log(`\n====================================`);
    console.log(`  科技吃瓜完成! 共 ${tTotal} 个话题`);
    console.log(`====================================`);
  }

  console.log(`\n====================================`);
  console.log(`  完成! 共 ${total} 个话题`);
  console.log(`====================================`);
}

/* ================================================================
 *  历史索引：扫描 data/archive/ 重建 data/history.json
 *  每条记录含 date/slot/label/generated_at/file/topic_count 等，
 *  供前端列出"前几日"内容并按需加载对应归档文件。
 * ================================================================ */

function rebuildHistory(dataDir, viewFilter) {
  const archiveDir = join(dataDir, 'archive');
  const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
  if (!existsSync(archiveDir)) {
    return { items: [], updated_at: new Date().toISOString() };
  }

  // viewFilter: null = main (exclude parenting/wife/tech), 'parenting' = only parenting, 'wife' = only wife, 'tech' = only tech
  const files = readdirSync(archiveDir)
    .filter(f => f.endsWith('.json'))
    .filter(f => {
      if (viewFilter === 'parenting') return f.includes('-parenting-');
      if (viewFilter === 'wife') return f.includes('-wife-');
      if (viewFilter === 'tech') return f.includes('-tech-');
      return !f.includes('-parenting-') && !f.includes('-wife-') && !f.includes('-tech-');
    })
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
