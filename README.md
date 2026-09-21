<div align="center">

# ⚡️ ZCode (AI Proxy Edition)

<p align="center">
  <b>面向企业与个人网关的 ZCode 下游专属发行版 · 纯元仓库架构 · 30分钟官方自动同步 · 全平台安装包自动化发布</b>
</p>

[![Upstream Sync](https://img.shields.io/github/actions/workflow/status/veildawn/ZCode/upstream-sync.yml?branch=main&label=Upstream%20Sync&logo=github)](https://github.com/veildawn/ZCode/actions/workflows/upstream-sync.yml)
[![Build & Release](https://img.shields.io/github/actions/workflow/status/veildawn/ZCode/release.yml?label=Build%20%26%20Release&logo=github)](https://github.com/veildawn/ZCode/actions/workflows/release.yml)
[![GitHub Release](https://img.shields.io/github/v/release/veildawn/ZCode?color=blue&logo=github)](https://github.com/veildawn/ZCode/releases)
[![Platform Support](https://img.shields.io/badge/Platform-macOS%20%7C%20Windows%20%7C%20Linux-brightgreen)](https://github.com/veildawn/ZCode/releases)
[![License](https://img.shields.io/badge/License-Apache%202.0%20%2F%20MIT-orange)](#-开源协议)

[📥 下载安装包](#-下载安装) • [🌟 核心特性](#-核心特性) • [🏗 架构设计](#-元仓库架构与同步机制) • [🛠 本地开发](#-本地开发与补丁管理) • [📂 仓库结构](#-仓库目录树)

</div>

---

## 📖 项目简介

本项目是基于智谱开源代码智能体工作台 [zai-org/ZCode](https://github.com/zai-org/ZCode) 打造的**纯补丁元仓库（Meta-Repository）发行版**。

不同于传统的 Git Fork 仓库侵入式合并，本项目借鉴了 **VSCodium** 与 **Ungoogled-Chromium** 的下游维护哲学：
* **仓库本体零源码冗余**：仅持久化维护标准化的原子 Git 补丁（Patches）、品牌资产与自动化 CI/CD 流水线。
* **官方发版零时差同步**：每 30 分钟自动化探测官方上游发布，一旦官方推出新版本，流水线将自动拉取最新基线、叠加补丁、通过编译门禁，并在云端 4 台虚拟机并发打包全平台安装包发布到 GitHub Releases。
* **企业与私有网关就绪**：原生打通统一 AI Proxy 网关，支持自定义 BaseURL 与 API Key。

---

## 🌟 核心特性

### 1. 🔑 欢迎页原生集成 AI Proxy 网关登录
- **官方渠道零改动**：Z.ai 与 BigModel 官方登录保持原样，下方保留「使用 API key」。
- **专属网关入口**：欢迎页新增 `AI Proxy 网关登录`，搭载官方原生 AI Proxy 品牌标志，一个入口两种接入方式：
  - **API Key**：直接粘贴网关 `aps_` 密钥，并自带 BaseURL 输入框（默认 `https://aps.veildawn.com/v1`，自动智能补齐 `/v1`）。
  - **OAuth 授权（默认）**：浏览器里在网关上完成一次授权码 + PKCE(S256) 登录，宿主机在 `127.0.0.1` 回环端口接收授权码并兑换令牌，无需手动复制密钥，密钥全程不进入前端页面；该选项卡是登录面板的默认项，需要静态密钥时切到 API Key。
- **API Key 表单同样可选网关**：`AI Proxy` 也是 API Key 表单的一级供应商选项，两条入口共用同一份凭据落库逻辑。

### 2. 🛡 严格凭据隔离与防误判
- **保护用户自定义供应商**：彻底消除基于 `baseUrl` 的粗暴归类，用户手动创建的任何自定义供应商（包括自定义的 `APS`）绝对保留在「自定义供应商」分组中，绝不发生误识别或分组覆盖。
- **与官方 GLM 同级展示**：仅通过 AI Proxy 模板创建的网关项，在设置页与智谱官方同级独立展示。

### 3. 🎛 模型端点与 API 协议自由解禁
- **协议格式自由切换**：打破官方预设供应商的只读锁定，允许在 **Anthropic Messages**、**OpenAI Chat Completions** 与 **Responses** 协议格式间自由切换，完美兼容各大中转代理服务。

### 4. 🔄 网关模型目录自动同步（登录后 / 启动时 / 运行中）
- **网关是模型列表的唯一来源**：AI Proxy 模板不再内置预设模型，该供应商下出现的每个模型都来自网关 `GET /v1/models`（非 chat 面目录项不进列表）；用户手动关掉的模型在后续同步里保持关闭。
- **设置页也能 OAuth**：设置 → 模型设置里新建/编辑 AI Proxy 供应商时，卡片上同时提供 API Key 输入与「OAuth 授权」按钮，两条路径写的是同一份凭据（网关 Bearer 令牌）。
- **登录即同步**：API Key 或 OAuth 登录成功后立刻拉取网关 `GET /v1/models`，按网关返回的**上下文窗口、输入模态、思考档位**重写该供应商的模型列表与参数，默认模型取目录中的第一个。
- **每一项参数都来自网关**：上下文窗口、输入模态（文本/图片/视频/音频/PDF）、推理档位（含 `reasoning_effort` 映射）直接取自目录；输出上限取网关发布的 `max_output_tokens`，网关未发布时以该模型的窗口为上界（网关不发布时不虚构更细的值）。
- **手动刷新**：设置页网关供应商的模型列表右上角有「刷新模型列表」，一条命令把成员、顺序与全部参数重写为网关当下的事实，无需重启应用。
- **启动即同步**：软件启动时对已配置凭据的网关供应商自动同步一次，之后每 **30 分钟**再同步一次；网关上新增、下线、改档位的模型无需手动维护。
- **只同步事实，不替用户做决定**：网关不可达时保留上一次的列表，不清空；目录里没有的模型不会留在该供应商下。
- **取数在宿主进程**：目录请求走宿主网络栈（企业代理、自签 CA 与其它 Provider 请求同源），网关密钥不会进入 Renderer。

### 5. ⚡️ 全平台 4 机并发云端构建（极速发布）
- **Matrix 并行打包**：云端 4 台异构虚拟机（macOS ARM64、macOS Intel x64、Windows x64、Ubuntu x64）同时并发编译。
- **双重持久化缓存**：全量接入 `pnpm store` 依赖哈希缓存与 `Electron/Electron-Builder` 运行时缓存，全平台打包发布时间缩短 70% 以上。

---

## 🏷 产品名与身份（下游品牌）

流水线发布的桌面端是**独立的品牌身份** `ZCode Gateway`，不再显示上游的 `ZCode Preview`：

| 项 | 值 |
| :--- | :--- |
| 产品名（安装器 / 应用名 / 关于窗口 / 产物文件名） | `ZCode Gateway` |
| bundle id / AUMID | `dev.veildawn.zcode-gateway` |
| Linux 可执行名 / 包名 | `zcode-gateway` |
| Electron 数据目录 | `~/Library/Application Support/ZCode Gateway`（macOS；其他平台对应 appData） |
| 归属（Linux 包元数据 / 发行说明） | Veildawn · `https://github.com/veildawn/ZCode` |

设计要点：

- **品牌与 flavor 分轴**：`flavor`（`production` / `preview`）决定更新器、签名门与菜单语义；`ZCODE_PRODUCT_BRAND=1` 只替换产品名与包名。于是本发行版既是独立品牌，又保持上游 preview flavor 的语义——**官方 manifest 更新器保持关闭**，不会被官方 feed 升级成另一个 App。
- **改名只改一处**：品牌定义集中在 `packages/desktop/scripts/desktop-product-identity.mjs` 的 `DOWNSTREAM_BRAND`，安装包名、应用名与数据目录都由它派生，不会出现"安装包叫一个名字、数据目录叫另一个名字"。
- **可与官方 ZCode 并排安装**：appId、包名、数据目录都与官方不同。
- **开发态不受影响**：`pnpm dev:desktop` 仍是 `ZCode Dev` 身份，自己的数据目录。
- 升级到旧 `ZCode Preview` 安装包的用户需要重新登录一次（数据目录不同）；老目录可手动迁移：`cp -R "~/Library/Application Support/ZCode Preview/." "~/Library/Application Support/ZCode Gateway/"`。

---

## 🔄 自动更新（本仓库 GitHub Releases）

桌面端内置更新器指向**本仓库自己的 Release**（electron-updater `github` provider，`veildawn/ZCode`），
不再依赖上游的更新通道：

| 环节 | 行为 |
| :--- | :--- |
| 检查 | 应用启动后后台检查一次，之后每小时轮询一次；帮助菜单与托盘也提供「检查更新」 |
| 下载 | 检测到新版本后台自动下载（可在设置里关闭「自动下载并安装更新」；品牌构建默认开启） |
| 安装 | macOS / Linux 在退出应用时安装；Windows 下载完成后提示「重启以更新」，在应用退出时由安装器接管 |
| 回滚 | 旧版本安装包仍在历史 Release 里，可直接重装 |

发布侧必须满足的条件（流水线已处理）：

- Release 资产里除了安装包，还要有 electron-builder 生成的 manifest：`latest.yml`（Windows）、
  `latest-mac.yml`（macOS）、`latest-linux.yml`（Linux），以及同名 `.blockmap`（差分下载用）。
- macOS 两个架构各自只产出半份 `latest-mac.yml`，发布前由
  [`scripts/merge-macos-update-manifest.mjs`](scripts/merge-macos-update-manifest.mjs) 合并成一份同时覆盖
  arm64 与 x64 的 manifest，否则后上传的那份会覆盖前者、让另一个架构拿到不匹配的下载地址。

> ⚠️ macOS 自动更新需要应用已签名（Developer ID + 公证），这是 Squirrel.Mac 的硬性要求。
> 当前流水线在未配置签名身份时产出的是未签名包（`ZCODE_ENABLE_MAC_SIGN` 未打开），
> macOS 侧会自动更新失败并给出错误提示；Windows / Linux 不受影响。
> 想打开 macOS 自动更新，请提供 `CSC_LINK` / `CSC_KEY_PASSWORD`（或 `APPLE_SIGNING_IDENTITY`）
> 与公证凭据后，把 release.yml 里的 `ZCODE_ENABLE_MAC_SIGN` 置为 `1`。

---

## 📥 下载安装

请前往 [GitHub Releases](https://github.com/veildawn/ZCode/releases) 页面获取最新发布的桌面客户端：

| 操作系统 | 支持架构 | 产物包格式 | 说明 |
| :--- | :--- | :--- | :--- |
| **macOS** | **Apple Silicon** (M1 / M2 / M3 / M4) | `.dmg` / `.zip` | 原生 arm64 架构支持，极致能效 |
| **macOS** | **Intel** (x64) | `.dmg` / `.zip` | 兼容旧款 Intel Mac 设备 |
| **Windows** | **x64** (Windows 10 / 11) | `.exe` | NSIS 独立安装程序 |
| **Linux** | **x64** (Ubuntu / Debian / Fedora) | `.AppImage` / `.deb` | 双格式，开箱即用 |

---

## 🏗 元仓库架构与同步机制

```text
┌───────────────────────────────────────────────────────────┐
│              智谱官方上游 (zai-org/ZCode)                   │
└─────────────────────────────┬─────────────────────────────┘
                              │ (30分钟定时轮询 / Webhook)
                              ▼
┌───────────────────────────────────────────────────────────┐
│     upstream-sync 探测流水线 (GitHub Actions)              │
│  - 检测官方新 Release Tag (如 v3.15.0)                      │
│  - 检出官方对应 Tag 纯净代码                                  │
│  - 注入 downstream-patches/ 品牌资产与原子补丁                │
│  - 自动化门禁测试: pnpm typecheck & pnpm lint              │
└─────────────────────────────┬─────────────────────────────┘
                              │ 门禁通过后自动打下游 Tag
                              ▼
┌───────────────────────────────────────────────────────────┐
│         release 全平台并发打包流水线 (4 机并行)              │
├─────────────────┬───────────────────┬─────────────────────┤
│  macOS ARM64    │   macOS Intel     │   Windows x64       │
│  (.dmg / .zip)  │   (.dmg / .zip)   │   (.exe)            │
├─────────────────┴───────────────────┴─────────────────────┤
│                     Linux x64                             │
│                  (.AppImage / .deb)                       │
└─────────────────────────────┬─────────────────────────────┘
                              │ 聚合资产
                              ▼
┌───────────────────────────────────────────────────────────┐
│             GitHub Releases 自动分发最新安装包              │
└─────────────────────────────┴─────────────────────────────┘
```

---

## 🛠 本地开发与补丁管理

本项目采用 Meta-Repo 设计，开发者无需在仓库中跟踪数万个上游源码文件。

### 1. 一键拉起本地开发环境
运行初始化脚本，脚本会自动从官方拉取最新源码并自动应用所有补丁：
```bash
# 初始化开发环境（自动拉取官方源码至 .zcode-src 并打上补丁）
./scripts/setup-dev.sh
```

### 2. 启动桌面应用开发态
```bash
cd .zcode-src
pnpm dev:desktop
```

### 3. 导出与更新补丁
若在 `.zcode-src` 中开发了新特性或修复了问题，在本地 commit 后，执行脚本自动逆向导出补丁至 `downstream-patches/`：
```bash
./scripts/export-patches.sh
```

---

## 📂 仓库目录树

```text
.
├── .github/
│   └── workflows/
│       ├── release.yml             # 4 机并发全平台编译与自动发布流水线（注入 ZCODE_PRODUCT_BRAND=1）
│       └── upstream-sync.yml       # 30 分钟轮询探测官方发版与自动打补丁流水线
├── downstream-patches/             # 核心定制补丁资产
│   ├── assets/                     # 真实品牌高清图标资产
│   ├── 0001-provider-preset-and-brand-logo.patch
│   ├── 0002-login-api-key-with-custom-base-url.patch
│   ├── 0003-settings-unlocked-format-and-isolation.patch
│   └── 0004-gateway-brand-oauth-and-model-sync.patch
├── scripts/
│   ├── apply-downstream-patches.sh  # 3-Way Merge 补丁原子应用脚本
│   ├── setup-dev.sh                 # 本地开发环境一键搭建工具
│   └── export-patches.sh            # 补丁逆向提取工具
├── .gitignore
└── README.md
```

---

## 📄 开源协议

本项目脚本及下游补丁遵循 [MIT License](LICENSE)；上游 ZCode 源码版权归 [zai-org](https://github.com/zai-org/ZCode) 智谱官方所有，遵循其原开源许可证。
