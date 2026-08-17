# 🗣️ 梗日报

> 每天给你好聊的 — AI 自动生成工作 & 生活聊天话题

灵感来自一位编剧的方法论：日常坚持记录"梗"，创作时随时调用，提升内容质量和爆款概率。

本项目把这个方法论自动化了：**AI 定时生成当天可聊的话题和梗，展示在精美网页上**，让你上班有料和同事聊、下班有话题和家人聊、周末有内容陪孩子和丈母娘聊。

## ✨ 功能特性

- **4 个时间段**，内容方向各不同：
  | 时间 | 标签 | 内容 |
  |------|------|------|
  | 工作日 09:30 | 同事聊资 | 100% 工作相关（前端/RN/AI编程/TS/开源/开发者梗）|
  | 工作日 18:00 | 工作生活各半 | 50% 工作 + 50% 生活 |
  | 周末 09:00 | 家庭时光 | 100% 生活（时事/教育/亲子/乒乓/影视/健康）|
  | 周末 18:00 | 家庭闲聊 | 100% 生活 |
- **15 个内容方向**，覆盖你的工作和生活：
  - 工作：前端框架、React Native、AI编程、TS & JS、工程化、CSS & 动效、开源热门、开发者梗
  - 生活：时事热点、儿童教育、亲子时光、乒乓球、生活妙招、热门影视、健康养生
- **精美网页**：卡片式布局、深色/浅色主题、分类筛选、展开详情、响应式
- **全自动**：GitHub Actions 定时生成 → Vercel 自动部署，零本地依赖

## 🏗️ 架构

```
GitHub Actions (cron)  →  Node.js 脚本  →  OpenRouter AI  →  data/content.json  →  Vercel 部署
     定时触发            调用 AI API      生成结构化 JSON      提交到仓库           自动部署网页
```

**零依赖**：生成脚本仅用 Node.js 内置模块 + 全局 fetch，无需 npm install。

## 🚀 快速开始（5 分钟）

### 第 1 步：创建 GitHub 仓库

1. 在 GitHub 上新建仓库（如 `geng-daily`）
2. 将本项目所有文件推送到仓库

```bash
git init
git add .
git commit -m "feat: 梗日报初始化"
git remote add origin https://github.com/<你的用户名>/geng-daily.git
git push -u origin main
```

### 第 2 步：获取 OpenRouter API Key

1. 访问 [openrouter.ai](https://openrouter.ai/) 注册
2. 进入 Keys 页面创建 API Key
3. 复制 Key（格式 `sk-or-v1-...`）

> OpenRouter 提供免费模型（如 `z-ai/glm-5.2:free`），注册即用，无需绑卡。

### 第 3 步：配置 GitHub Secrets

1. 在 GitHub 仓库 → **Settings** → **Secrets and variables** → **Actions**
2. 点击 **New repository secret**，添加：
   - Name: `OPENROUTER_API_KEY`
   - Value: 你的 API Key

### 第 4 步：（可选）配置模型

如果想用非默认模型，在 **Settings** → **Secrets and variables** → **Variables** 中添加：
- Name: `OPENROUTER_MODEL`
- Value: 如 `anthropic/claude-3.5-haiku`、`openai/gpt-4o-mini` 等

> 默认使用 `z-ai/glm-5.2:free`（免费，中文能力强），可选模型列表见 [openrouter.ai/models](https://openrouter.ai/models)

### 第 5 步：部署到 GitHub Pages（已自动配置 ✅）

本项目已配置 **GitHub Pages 自动部署**（`.github/workflows/generate.yml` 内置 deploy job）：

- 每次内容生成后自动部署，无需任何手动操作
- 免费、无限流量、全球 CDN，所有人可访问
- 线上地址：`https://<用户名>.github.io/geng-daily/`

> 若仓库初始是私有，需先在 Settings → General → Danger Zone → **Change visibility** 改为 Public（Pages 免费版要求）。
> 也可以用 **Vercel**（支持私有仓库）：[vercel.com](https://vercel.com) 用 GitHub 登录 → Add New Project → 选择 `geng-daily` → Framework 选 Other → Deploy。

### 第 6 步：验证

1. 在 GitHub 仓库 → **Actions** 页面，找到 `Generate Daily Content`
2. 点击 **Run workflow** → 选 `auto` → **Run**
3. 等待执行完成（约 1-2 分钟），检查 `data/content.json` 是否更新
4. GitHub Pages 自动重新部署，打开网站即可看到内容

## ⏰ 定时任务说明

GitHub Actions cron 使用 UTC 时间，已按 GMT+8 换算：

| 你的时间 (GMT+8) | GitHub Actions cron (UTC) | 内容类型 |
|---|---|---|
| 工作日 09:30 | `30 1 * * 1-5` | 100% 工作 |
| 工作日 18:00 | `0 10 * * 1-5` | 工作 50% + 生活 50% |
| 周末 09:00 | `0 1 * * 6,0` | 100% 生活 |
| 周末 18:00 | `0 10 * * 6,0` | 100% 生活 |

> ⚠️ GitHub Actions cron 可能有 5-15 分钟延迟（高峰期更久），属正常现象。

## 🎨 自定义

### 修改内容方向

编辑 `scripts/generate.mjs` 中的 `CATEGORIES` 和 `SLOTS` 对象：
- `CATEGORIES`：添加/修改方向定义
- `SLOTS`：修改每个时间段的分类组合

### 修改时间安排

编辑 `.github/workflows/generate.yml` 中的 `cron` 字段。

### 修改网页样式

- 布局/颜色：`css/style.css`
- 交互逻辑：`js/app.js`
- 页面结构：`index.html`

### 本地运行生成脚本

```bash
export OPENROUTER_API_KEY="sk-or-v1-..."
node scripts/generate.mjs
# 或指定时间段
SLOT=weekday-morning node scripts/generate.mjs
```

### 本地预览网页

```bash
python3 -m http.server 8080
# 浏览器打开 http://localhost:8080
```

## 📁 项目结构

```
geng-daily/
├── index.html                  # 网页入口
├── css/style.css               # 样式（深色/浅色主题）
├── js/app.js                   # 前端逻辑（渲染/筛选/主题）
├── data/
│   ├── content.json            # 当前内容（AI 生成，自动更新）
│   └── archive/                # 历史归档
├── scripts/generate.mjs        # AI 内容生成脚本（零依赖）
├── .github/workflows/
│   └── generate.yml            # GitHub Actions 定时任务
├── package.json
├── .gitignore
└── README.md
```

## ❓ 常见问题

**Q: 免费模型够用吗？**
A: `z-ai/glm-5.2:free` 中文生成质量高，足以覆盖每天 4 次生成。如需更稳定可换付费模型如 `openai/gpt-4o-mini`（极便宜，约 $0.001/次）。免费模型列表会变动，可在 [openrouter.ai/models](https://openrouter.ai/models) 查看最新可用模型。

**Q: GitHub Actions 免费额度够吗？**
A: 公开仓库无限免费；私有仓库每月 2000 分钟，本项目每次约 1 分钟，绰绰有余。

**Q: Vercel 免费吗？**
A: 个人版免费，静态站无限部署。也可用 GitHub Pages 完全免费。

**Q: 内容不准确怎么办？**
A: AI 生成内容仅供参考，建议聊到具体事件时自行核实。可在 prompt 中调整 `systemPrompt` 来提高准确性要求。

## 📝 License

MIT
