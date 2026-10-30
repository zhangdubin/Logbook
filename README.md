<div align="center">

# 📚 错题本 · 学情智能分析系统

**拍照录入 30 秒 · AI 说清为什么错 · 统计告诉你明天练什么**

面向 **小学高年级与初中** 学生的错题统计分析系统 —— 相机拍下错题，AI 自动识别题目结构并做错因归因，多维统计与学情诊断报告把"错题本"变成可执行的学习计划。

[![React](https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=20232A)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?style=flat-square&logo=typescript&logoColor=3178C6)](https://www.typescriptlang.org)
[![Vite](https://img.shields.io/badge/Vite-8-646CFF?style=flat-square&logo=vite&logoColor=646CFF)](https://vite.dev)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-v4-06B6D4?style=flat-square&logo=tailwindcss&logoColor=06B6D4)](https://tailwindcss.com)
[![Express](https://img.shields.io/badge/Express-5-000000?style=flat-square&logo=express&logoColor=FFFFFF)](https://expressjs.com)
[![Node.js](https://img.shields.io/badge/Node.js-22%2B-5FA04E?style=flat-square&logo=node.js&logoColor=5FA04E)](https://nodejs.org)

</div>

---

## ✨ 功能特性

| | 能力 | 说明 |
| --- | --- | --- |
| 📷 | **拍照分析录入** | 手机摄像头拍摄错题本/试卷 → AI 自动识别学科、题型、知识点、题干、选项、我的答案、正确答案，生成**可编辑草稿**，约 15 秒一道 |
| 🔧 | **模型配置可视化** | 「⚙️ 系统设置 → AI 模型」页直接配置 MiniMax / OpenAI / DeepSeek / 通义千问 / 智谱 / 豆包 / 千帆 / 硅基流动 / **本地 Ollama、vLLM**，一键测试连通性；密钥掩码存储，可随时切换或关闭 |
| ⚙️ | **系统设置中枢** | AI 模型 / 账号管理 / 系统更新三合一，运维入口集中，不再散落在导航两侧 |
| ⬆️ | **GitHub 一键更新** | 在系统设置里填好仓库，点「检查更新」→「一键更新」：自动下载 Release、备份当前版本、覆盖程序文件、记录进度日志；**数据库、上传图片、`.env` 永不覆盖**，出问题可一键回滚 |
| 🌐 | **访问代理** | 系统设置里可填代理地址（如 `http://127.0.0.1:7890`），检查更新 / 下载 / 发布全部走代理，**改完立即生效、无需重启**；只作用于 GitHub 请求，不影响 AI 模型调用 |
| 📦 | **发布新版本** | 把本机源码打包成 tar.gz 作为 GitHub Release 发布出去，其它机器就能「一键更新」拉到它；**打包不含数据库、上传图片、`.env`、`node_modules`**，不泄露任何用户数据 |
| 🔍 | **本地 OCR 提升置信度** | 接入 PaddleOCR / RapidOCR 等本地开源引擎后，识别置信度从 **0.32 → 0.99**（实测），图片不出校；置信度按字段拆分，模糊处自动标红提示人工核对 |
| ✍️ | **手动补录** | 没有试卷时也能记：结构化表单快速录入，支持选项、知识点标签与题图上传 |
| 🤖 | **AI 智能分析机** | 七类错因归因（知识盲点/审题不清/计算失误/方法不当/时间不足/粗心大意/书写不规范）+ 置信度 + 证据 + **根因链** + 正确解法**分步讲解** + 知识点缺口 + 针对性建议 + 同类题 + **7 天练习计划** |
| 📊 | **多维统计分析** | 学科分布、错因构成、知识点掌握雷达、掌握度趋势、活跃热力图、题型分布、**优先突破知识点** |
| 🩺 | **学情诊断报告** | AI 生成学情总评、优势/薄弱项（带数据证据）、高风险学科、行动建议、7 天计划、**家长沟通要点** |
| 🎯 | **订正闭环训练场** | 「今日复习」按到期时间组题：先遮答案自己做 → 对答案 → 标记订正 → 掌握度自动提升并排好下次复习，形成**记录 → 归因 → 订正 → 巩固**的完整闭环 |
| 💬 | **AI 对话助手** | 右下角 🤖 悬浮入口，随时追问「我数学为什么总丢分？本周该复习什么？」，回答全部**基于本机真实错题数据**并附数据引用 |
| 📱 | **双端同构** | PC 端宽屏看板 + 侧边栏；手机端底部导航 + 中央凸起相机按钮 + 摄像头直调，**PWA 可安装到桌面** |
| 🔒 | **隐私优先** | 数据默认全部留在本机/校园内网；未配置大模型密钥时启用**本地启发式引擎**，功能不中断、零调用成本 |
| 🔐 | **登录与分级权限** | 四级角色（系统管理员 / 教师 / 家长 / 学生）分层授权：**16 个权限点**管「能做什么」，**数据范围隔离**管「能对谁做」——家长只看自己孩子、学生只看本人、越权一律 403 |
| 🧑‍💼 | **账号管理** | 管理员可视化建号、改角色、停用、重置密码、**关联学生**（一个家长多个孩子、一个老师一个班），页面底部内置权限矩阵预览 |
| 📤 | **数据导出** | 一键导出 xlsx / csv（带表头与统计汇总），可直接用于讲义与分层作业 |

---

## 🖼️ 截图

> 以下为截图占位说明。将实际截图放入 `docs/images/` 后，把对应路径替换即可。

| 页面 | 说明 | 占位 |
| --- | --- | --- |
| 学情总览（PC） | 指标块 + 学科分布 + 错因构成 + 知识点雷达 + 趋势 + 热力图 | `docs/images/dashboard-desktop.png` |
| 拍照录入（手机） | 取景 → 识别 → 草稿确认三步 | `docs/images/capture-mobile.png` |
| 错题详情 | AI 归因、根因链、分步讲解、同类题、7 天计划 | `docs/images/item-detail.png` |
| 学情诊断报告 | 总评、优势/薄弱、高风险学科、家长沟通要点 | `docs/images/insights-report.png` |
| 错题本（手机） | 筛选栏 + 列表 + 批量订正 | `docs/images/wrong-items-mobile.png` |
| 登录窗口（PC） | 左侧品牌区 + 右侧表单 + 演示账号快捷登录 | `docs/images/login-desktop.png` |
| 账号管理（PC） | 账号列表 + 角色分配 + 关联学生 + 权限矩阵预览 | `docs/images/users-desktop.png` |
| 系统设置（PC） | AI 模型 / 账号管理 / 系统更新 三标签 + 一键更新进度 | `docs/images/system-desktop.png` |

---

## 🚀 5 分钟快速开始

### 环境要求

- **Node.js ≥ 22**（推荐 22.13+ 或 24 LTS —— 后端使用内置 `node:sqlite`，无需任何原生模块）
- npm ≥ 10

### 安装与启动

```bash
# 1) 安装依赖
npm install

# 2) 灌入演示数据（3 名学生，每人 60~90 道错题，可选但强烈建议）
npm run seed

# 3) 同时启动前后端
npm run dev
```

| 服务 | 地址 |
| --- | --- |
| 前端（Vite，已代理 `/api`） | <http://localhost:5180> |
| 后端（Express） | <http://127.0.0.1:5181/api> |
| 健康检查 | <http://127.0.0.1:5181/api/health> |

### 登录账号

首次启动会自动创建系统管理员（用户名 `admin` / 口令 `admin123`，**首次登录后请立即修改**）。
执行 `npm run seed` 会另外创建三个演示账号：

| 账号 | 口令 | 角色 | 能看到什么 |
| --- | --- | --- | --- |
| `admin` | `admin123` | 系统管理员 | 全部学生、全部账号、AI 模型与 OCR 设置 |
| `teacher` | `teacher123` | 教师 | 全部演示学生的错题与班级统计、报表导出 |
| `parent` | `parent123` | 家长 | 只看自己孩子（张梓萱）的错题、统计与报告 |
| `student` | `student123` | 学生 | 只看自己的错题本与今日复习（无报告、无导出） |

> **生产环境注意**：登录页的「演示账号」快捷按钮**只在演示模式下显示**，生产默认关闭 ——
> 那块会把上面这些默认口令公开给所有访问者。要开启见下方「[🎭 演示模式](#-演示模式)」。

> 权限分两个维度强制执行：**能做什么**（15 个权限点）由服务端中间件校验，
> **能对谁做**（数据范围）由 `parent_id` / `teacher_id` / `user_id` 关联过滤。
> 越权访问一律返回 403，不会泄露他人数据。详见 [08 · 登录与分级权限设计](docs/08-登录与分级权限设计.md)。

### 接入大模型（可选）

不配置任何密钥也能**完整使用全部功能**（本地启发式引擎）。想获得更高质量的归因与讲解时：

```bash
export AI_BASE_URL="https://api.minimax.chat/v1"   # 任何 OpenAI 兼容接口
export AI_API_KEY="sk-xxxxxxxxxxxxxxxx"
export AI_MODEL="MiniMax-M2"
npm run dev
```

也可指向本地模型（数据完全不出网）：

```bash
export AI_BASE_URL="http://127.0.0.1:11434/v1"      # Ollama
export AI_MODEL="qwen2.5:7b"
export AI_API_KEY="ollama"                          # 本地无需真实密钥
```

> 拍照识别需要模型支持**视觉能力**（`image_url` 内容块）；不支持时会自动降级为本地引擎，识别结果需人工补录。

---

## 🗂️ 目录结构

```text
学生错题本/
├── index.html                 # Vite 入口（含 PWA meta / viewport-fit）
├── package.json               # 依赖与脚本
├── vite.config.ts             # 端口 5180，/api → 127.0.0.1:5181 代理
├── tsconfig.json
├── public/
│   ├── manifest.webmanifest   # PWA 清单（standalone + 快捷方式）
│   ├── sw.js                  # Service Worker
│   └── icons/                 # icon.svg / 192 / 512
├── src/                       # ── 前端（React 19 + TS + Tailwind v4）
│   ├── main.tsx / App.tsx     # 入口与路由表
│   ├── styles.css             # @theme 设计令牌 + 通用组件类
│   ├── lib/
│   │   ├── api.ts             # ★ 唯一 HTTP 客户端（BASE = /api）
│   │   ├── types.ts           # ★ 前后端共享数据契约（API Contract v1）
│   │   └── format.ts          # 学科色、日期格式化、复习间隔推算
│   ├── pages/                 # Dashboard / Capture / Manual / WrongItems
│   │                          # / ItemDetail / Insights / Students / Settings
│   ├── components/
│   │   ├── ui/                # Card / Badge / StatTile / Progress / Modal / Tabs …
│   │   ├── charts/            # 自研 SVG 图表库（柱/环/折线/雷达/仪表/热力/堆叠）
│   │   └── layout/AppShell.tsx# PC 侧边栏 + 手机底部导航
│   ├── features/
│   │   ├── assistant/         # 🤖 悬浮 AI 对话助手
│   │   ├── auth/              # 🔐 登录守卫 · 权限门控 · 用户菜单
│   │   ├── review/            # 🎯 今日复习（订正闭环）
│   │   ├── settings/          # ⚙️ AI 模型与 OCR 设置页
│   │   ├── system/            # ⬆️ 系统更新（仓库配置 / 一键更新 / 回滚）
│   │   └── users/             # 🧑‍💼 账号管理（建号 / 角色 / 关联学生）
│   └── store/                 # AppProvider（当前学生）/ ToastProvider / AuthProvider
├── server/                    # ── 后端（Express 5 + node:sqlite）
│   ├── index.js               # 入口：/api 路由 + dist 静态托管 + SPA 回退
│   ├── db.js                  # 建表 / 索引 / 行映射 / 查询辅助
│   ├── ai.js                  # 提示词 · 模型调用 · JSON 规整 · 本地启发式兜底
│   ├── auth.js                # 口令哈希 · 会话 · 权限矩阵 · 数据范围 · 登录限流
│   ├── providers.js           # 12 个 AI 供应商预设（含视觉能力判定）
│   ├── settings.js            # settings 表 · 密钥掩码 · 配置校验
│   ├── modelClient.js         # OpenAI 兼容调用封装（含多模态 image_url）
│   ├── ocr.js                 # 本地 OCR 适配器（PaddleOCR Serving v2 契约）
│   ├── vision.js              # 视觉提示词 · 草稿归一化 · 置信度融合
│   ├── systemUpdate.js        # GitHub Release 检查 · 下载 · 备份 · 覆盖 · 回滚
│   ├── tar.js                 # 自研 tar/gzip 解包（含路径穿越防护，零依赖）
│   ├── routes/                # students / questions / analyze / stats / upload / settings / auth / users / system
│   ├── seed.js                # 演示数据 + 演示账号（幂等）
│   ├── data/cuoti.db          # 运行时数据库（WAL）
│   └── uploads/               # 上传图片
├── ocr-service/               # ── 本地 OCR 服务（可选，零框架依赖）
│   ├── ocr_service.py         # 标准库 HTTP 服务，包装 RapidOCR/PaddleOCR/CnOCR
│   └── requirements.txt
├── docs/                      # ── 产品与技术文档
│   ├── 01-产品需求与痛点分析.md
│   ├── 02-功能架构与信息架构.md
│   ├── 03-技术架构设计.md
│   ├── 04-交互与视觉规范.md
│   ├── 05-开发与部署指南.md
│   ├── 06-测试与验收清单.md
│   ├── 07-OCR方案调研与选型.md
│   ├── 08-登录与分级权限设计.md
│   └── 09-系统设置与在线更新.md
└── README.md
```

---

## 📜 常用命令

| 命令 | 说明 |
| --- | --- |
| `npm run dev` | 同时启动前后端（5180 / 5181），后端 `--watch` 自动重启 |
| `npm run dev:web` | 仅启动前端 Vite 开发服务器 |
| `npm run dev:server` | 仅启动后端（`node --watch server/index.js`） |
| `npm run seed` | 生成演示数据（3 名学生 × 60–90 道错题 + **4 个演示账号**；**会清空已有数据**） |
| `npm run typecheck` | TypeScript 类型检查（`tsc --noEmit`） |
| `npm run build` | 类型检查 + 生产构建到 `dist/` |
| `npm run build:deploy` | 生成**生产环境部署版本**到 `deploy-dist/`（含已构建的 `dist/`） |
| `npm run deploy:publish` | 生成部署版本并上传为 GitHub Release 附加资产（需 `GITHUB_TOKEN`） |
| `npm run smoke` | 接口契约自检（102 项断言，需后端已启动） |
| `npm start` | 生产启动：Express 同时托管 API 与前端产物（含 SPA 回退） |
| `npm run preview` | 仅预览 `dist/` 静态产物（不含后端） |

---

## ☁️ 云服务器部署

### 一键安装（从 GitHub 拉取）

```bash
curl -fsSL --retry 5 --retry-delay 3 --retry-all-errors --connect-timeout 30 \
  https://raw.githubusercontent.com/zhangdubin/Logbook/main/deploy/install.sh | sudo bash
```

指定版本与安装目录：

```bash
curl -fsSL --retry 5 --retry-delay 3 --retry-all-errors --connect-timeout 30 \
  https://raw.githubusercontent.com/zhangdubin/Logbook/main/deploy/install.sh \
  | sudo bash -s -- --repo zhangdubin/Logbook --version 1.1.14 --dir /opt/cuoti-analytics
```

安装脚本会自动完成：检查 Node 20+ → 查 GitHub Release → 下载并校验 sha256 → 安装到
`/opt/cuoti-analytics` → 装生产依赖 → 生成 `.env` → 初始化数据库 → 注册 systemd 服务
→ 配置 nginx 反向代理 → 健康检查。

### 升级

```bash
sudo bash /opt/cuoti-analytics/deploy/upgrade.sh          # 升到最新版本
sudo bash /opt/cuoti-analytics/deploy/upgrade.sh --version 1.1.14
```

升级会**保留**数据库（`server/data/`）、上传图片（`server/uploads/`）和 `.env`，
只替换程序文件；升级前自动备份到 `backups/`。

### 常用运维命令

```bash
systemctl status  cuoti-analytics     # 查看状态
systemctl restart cuoti-analytics     # 重启
journalctl -u cuoti-analytics -f      # 实时日志
curl -s http://127.0.0.1:5181/api/health   # 健康检查
curl -s http://127.0.0.1:5181/api/version  # 当前版本号
```

### 两种发布包的分工

| 包 | 文件名 | 内容 | 用途 |
| --- | --- | --- | --- |
| 源码包 | `cuoti-analytics-v1.1.14.tar.gz` | 全部源码（不含 `dist/`） | Git 历史、二次开发 |
| **部署版本** | `cuoti-analytics-v1.1.14-deploy.tar.gz` | 源码 + **已构建好的 `dist/`** + `deploy/` | **服务器直接跑，无需装构建工具链** |

详细的部署步骤、环境变量表、nginx/HTTPS 配置、回滚方法与故障排查见
[docs/05 · 开发与部署指南](docs/05-开发与部署指南.md)。

### Docker 容器部署

**一键安装（推荐）**

```bash
curl -fsSL --retry 5 --retry-delay 3 --retry-all-errors \
  https://raw.githubusercontent.com/zhangdubin/Logbook/main/deploy/install-docker.sh | sudo bash
```

脚本会自动：检查 Docker 环境 → 查最新版本 → 下载发布包（Release 附件失败时自动回退到 API tarball）
→ 生成 `.env` 与 compose 覆盖文件 → 构建镜像 → 启动容器 → 健康检查 → 打印访问地址。

```bash
# 带参数（当前最新 1.1.14）
sudo bash install-docker.sh --version 1.1.14 --dir /opt/cuoti-analytics --port 5181 --ocr
#   --version  指定版本（默认取最新）
#   --dir      安装目录（默认 /opt/cuoti-analytics）
#   --port     对外端口（默认 5181）
#   --bind     端口绑定地址（默认 0.0.0.0；只想本机访问就填 127.0.0.1）
#   --ocr      同时构建并启动本地 OCR 侧车
```

**手动构建（想自定义时用）**

```bash
# 构建镜像（VERSION / COMMIT 会写进容器里的版本信息）
docker build -t cuoti-analytics:1.1.14 \
  --build-arg VERSION=1.1.14 --build-arg COMMIT=HEAD .

# 直接跑
docker run -d --name cuoti -p 5181:5181 \
  -v cuoti-data:/app/server/data \
  -v cuoti-uploads:/app/server/uploads \
  cuoti-analytics:1.1.14

# 或者用 compose
docker compose up -d                          # 只起应用
docker compose --profile ocr up -d            # 连本地 OCR 侧车一起起
SEED_DEMO=true docker compose up -d           # 带演示数据（首次启动自动灌）
docker compose logs -f
docker compose down                          # 停止（数据保留）
docker compose down -v                       # 停止并删卷（⚠️ 数据丢失）
```

镜像基于 `node:24-alpine` **两阶段构建**：builder 阶段编译前端，runtime 阶段只装生产依赖，
以非 root 用户运行，带 `HEALTHCHECK`，数据库与上传图片都在 named volume 里持久化。
镜像 **329 MB**，**不依赖 buildx**（没装 buildx 的服务器用 classic builder 也能构建）。

| 卷 | 内容 |
| --- | --- |
| `cuoti-data` | SQLite 数据库（错题、账号、会话、系统设置） |
| `cuoti-uploads` | 上传的错题原图 |

---

### 🎭 演示模式

登录页有一块「演示账号」面板（管理员 / 教师 / 家长 / 学生，点一下直接登录）。
**它只在演示环境显示，生产环境默认关闭** —— 那块会把 `admin/admin123` 等默认口令
公开给所有访问者。

| 来源 | 优先级 | 说明 |
| --- | --- | --- |
| 系统设置里的「演示模式」开关 | 最高 | 管理员在「系统设置 → 系统更新」里切换，运行时即生效 |
| 环境变量 `DEMO_MODE=true` | 中 | 部署级开关；此时系统设置里的开关会被锁定 |
| 环境变量 `SEED_DEMO=true` | 低 | 演示 compose 配置隐含演示环境 |
| 默认 | — | **关闭** |

```bash
# 临时开启演示模式
DEMO_MODE=true docker compose up -d

# 之后随时在系统设置里切换，或用接口：
curl -X PUT http://127.0.0.1:5181/api/system/demo \
  -H 'Content-Type: application/json' -b 'session=<你的会话 cookie>' \
  -d '{"enabled": true}'      # 关闭用 false；{"reset": true} 交回环境变量决定
```

---

## 📖 文档索引

| 文档 | 内容 |
| --- | --- |
| [01 · 产品需求与痛点分析](docs/01-产品需求与痛点分析.md) | 用户画像与场景、行业痛点逐条拆解（现状→根因→解法→量化收益）、竞品对比、MVP 边界、用户故事、北极星指标 |
| [02 · 功能架构与信息架构](docs/02-功能架构与信息架构.md) | 功能模块树（P0/P1/P2）、端到端业务流程 Mermaid 图、站点地图与页面清单、双端布局与导航结构 |
| [03 · 技术架构设计](docs/03-技术架构设计.md) | 系统架构图、技术选型理由、运行时数据流、数据库设计、**完整 API 规范**、AI 双引擎设计、隐私与安全、部署方案、性能指标 |
| [04 · 交互与视觉规范](docs/04-交互与视觉规范.md) | 设计原则、配色令牌表、排版/间距/圆角/阴影、图表选型规则、移动端断点与触控热区、无障碍要点、关键页面交互 |
| [05 · 开发与部署指南](docs/05-开发与部署指南.md) | 环境要求、安装与脚本、目录结构、环境变量表、模型接入、故障排查、数据库重置、三种部署形态 |
| [06 · 测试与验收清单](docs/06-测试与验收清单.md) | 功能验收勾选清单、边界与异常用例、**5 分钟演示脚本**、回归矩阵、发布前检查单 |
| [07 · OCR 方案调研与选型](docs/07-OCR方案调研与选型.md) | 开源 OCR/VLM 选型对比（PaddleOCR / RapidOCR / MinerU / olmOCR / Qwen3-VL…）、**许可证商用风险速查**、置信度融合算法、**私有化部署步骤** |
| [08 · 登录与分级权限设计](docs/08-登录与分级权限设计.md) | 四级角色模型、**16 权限点矩阵**、数据范围隔离、认证与会话机制、接口鉴权矩阵、安全设计与演进路线 |
| [09 · 系统设置与在线更新](docs/09-系统设置与在线更新.md) | 系统设置三标签信息架构、**GitHub 一键更新**全流程、**发布新版本**（源码打包成 Release）、**代理配置**（CONNECT 隧道 / 免重启生效）、**更新安全边界**（绝不覆盖的数据目录、路径穿越防护、备份与回滚）、自研 tar 读写说明、发版指南 |

---

## 🧭 核心能力一览

| 能力 | 入口 | 接口 |
| --- | --- | --- |
| 拍照上传 | `/capture` | `POST /api/upload/photo` |
| 拍照识别 | `/capture` | `POST /api/analyze/photo` |
| 手动补录 | `/manual` | `POST /api/questions` |
| 错题列表与筛选 | `/questions` | `GET /api/questions` |
| 错题详情与订正 | `/questions/:id` | `GET/PATCH/DELETE /api/questions/:id`、`POST .../corrected` |
| 单题 AI 分析 | `/questions/:id` | `POST /api/questions/:id/analyze` |
| 今日复习（订正闭环） | `/review` | `GET /api/questions`、`POST /api/questions/:id/corrected` |
| AI 对话助手 | 全局悬浮 🤖 | `POST /api/ai/chat` |
| 学情统计 | `/` | `GET /api/stats/overview` |
| 学情诊断报告 | `/insights` | `GET /api/stats/report` |
| 知识点聚合 | `/manual` `/questions` | `GET /api/knowledge/points` |
| 数据导出 | `/` `/insights` | `GET /api/stats/export?format=xlsx\|csv` |
| 学生档案 | `/students` | `/api/students` 系列 |
| 登录 / 登出 | `/login` | `POST /api/auth/login`、`POST /api/auth/logout` |
| 当前身份 | 全局 | `GET /api/auth/me`、`GET /api/auth/permissions` |
| 系统设置 | `/system` | AI 模型 / 账号管理 / 系统更新 三合一（**仅管理员**） |
| 自助改密 | 顶栏用户菜单 | `POST /api/auth/password` |
| 在线更新 | `/system?tab=update` | `GET /api/system/update/info`、`POST /api/system/update/apply` |

> 完整端点表（含参数、响应、错误码）见 [技术架构设计 §4](docs/03-技术架构设计.md#4-api-规范)。

---

## 💡 设计理念

1. **录入成本必须低于放弃成本** —— 超过 30 秒的录入动作，学生一定会放弃。
2. **错因不是标签，是证据链** —— "因为漏看了条件 → 所以用了错误公式"，而不是笼统的"粗心大意"。
3. **统计不是为了好看，是为了下一步动作** —— 每个图表都必须能回答"明天该练什么"。

---

## 🔐 隐私与安全

- 学生档案**最小化采集**：仅姓名（可填昵称）、年级、头像色、学校（选填）、备注；不采集身份证号、住址、联系方式。
- 图片默认保存在本机 `server/uploads/`，题目内容落本地 SQLite。
- **未配置大模型时，照片与文字均不出本机/本校园**。
- 配置大模型后：单题分析只发送题干等**文本**；拍照识别会发送图像，此时应由产品明确告知用户。
- 不接入广告 SDK、不做用户画像、不向第三方共享任何学生数据。
- **账号口令**用 Node 内置 `scrypt` 哈希（`scrypt$salt$hash`），**永不明文存储或回显**；会话为 30 天 `HttpOnly` Cookie，服务端可随时吊销。
- **四级角色 + 数据范围隔离强制执行**：越权一律 403，未登录 401；登录失败 5 次锁定 15 分钟。
- AI 密钥只在服务端保存，接口只回传掩码串；前端也拿不到明文。
- **在线更新安全边界**：更新包解压时拦截路径穿越；数据库、上传图片、`.env`、`node_modules` 永不覆盖；每次更新前自动备份，可一键回滚。

---

## 📄 许可说明

本项目为 **私有项目**（`package.json` 中 `"private": true`），**尚未附带开源许可证**，版权归项目所有者所有。

- 内部演示、教学与研究用途可自由使用；
- 如需对外分发、二次开发或商用，请先补充明确的 `LICENSE` 文件并注明来源；
- 项目中依赖的第三方库均遵循其各自的开源许可证（React、Express、exceljs、Tailwind CSS 等均为 MIT 等宽松许可）。

---

<div align="center">

**📚 错题本 · 学情智能分析系统** — 让每一次错误都变成可执行的下一步。

[产品需求](docs/01-产品需求与痛点分析.md) · [功能架构](docs/02-功能架构与信息架构.md) · [技术架构](docs/03-技术架构设计.md) · [交互规范](docs/04-交互与视觉规范.md) · [开发指南](docs/05-开发与部署指南.md) · [测试清单](docs/06-测试与验收清单.md) · [OCR 选型](docs/07-OCR方案调研与选型.md) · [登录与权限](docs/08-登录与分级权限设计.md) · [系统设置与更新](docs/09-系统设置与在线更新.md)

</div>
