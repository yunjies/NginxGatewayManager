# Nginx Gateway Manager

一个轻量级的 Nginx 反向代理网关管理工具，基于 Electron + ssh2，用于管理远程 Linux 网关上的 SSL 证书更新、Nginx 配置编辑、GitHub Pages 代理链接，以及服务状态监控。

![Nginx Gateway Manager](https://img.shields.io/badge/Electron-28-blue)
![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-green)

---

## 功能模块

### 1. 🔐 SSL 证书更新
- 选择 Let's Encrypt 证书 ZIP 包（自动识别 `.pem` / `.crt` / `.key` 文件）
- SFTP 上传到服务器，自动备份旧证书
- `nginx -t` 测试配置，失败自动回滚

### 2. 🔀 反代配置管理
- 从服务器加载 nginx 配置文件，可视化展示所有端口映射（`listen` → `proxy_pass`）
- 支持可视化表格编辑和原始文本编辑双视图
- 保存前自动 `nginx -t` 测试

### 3. 🔗 GitHub 链接管理
- 通过 GitHub REST API v3 管理 GitHub Pages 代理链接仓库
- 支持 `index.html` 重定向格式（简单）和 `worker.js` Cloudflare Worker 格式
- 增删改查 + 批量同步，无需 Git CLI

### 4. 📊 Nginx 状态监控
- 查看 Nginx 版本、运行状态、worker 进程数
- 一键 reload / restart / start / stop

---

## 目录结构

```
NginxGatewayManager/
├── src/
│   ├── main.js      # Electron 主进程（SSH/GitHub API）
│   ├── preload.js   # 上下文隔离桥接
│   ├── renderer.js  # 前端逻辑（页面切换/表单/状态）
│   ├── index.html   # UI 结构
│   └── style.css    # 样式
├── package.json
└── README.md
```

---

## 快速开始

### 环境要求

- Node.js ≥ 18
- Python ≥ 3.8（用于构建）
- Windows / macOS / Linux
- 服务器端：Nginx + OpenSSH + SFTP

### 安装依赖

```bash
cd NginxGatewayManager
npm install
```

### 开发模式

```bash
npm run start
```

### 构建（输出到 `dist/`）

```bash
npm run build:dir    # 便携版（推荐）
# 或
npm run build        # 安装包版
```

> ⚠️ 构建时需要重新编译 `ssh2` native addon：
> ```bash
> npx @electron/rebuild
> npm run build:dir
> ```

### 运行

```bash
./dist/win-unpacked/NginxSSLUpdater.exe   # Windows 便携版
```

---

## 初始配置

首次运行后，在 **⚙️ 设置** 页面填写：

| 字段 | 说明 | 示例 |
|------|------|------|
| 服务器地址 | Nginx 网关 IP | `YOUR_SERVER_IP` |
| SSH 端口 | 默认 22 | `22` |
| 用户名 | SSH 用户 | `YOUR_USERNAME` |
| 密码 | SSH 密码 | - |
| SSL 目录 | 证书存放路径 | `/home/user/ssl` |
| Nginx 配置路径 | nginx 配置文件路径 | `/etc/nginx/conf.d/domain.conf` |
| GitHub Token | [创建 PAT](https://github.com/settings/tokens)（需要 `repo` 权限） | - |
| GitHub Owner | GitHub 用户名 | `yourusername` |
| GitHub 仓库 | GitHub Pages 代理仓库名 | `yourusername.github.io` |
| GitHub 分支 | 默认 `main` | `main` |

---

## GitHub 链接功能说明

本工具可以管理 GitHub Pages 仓库中每个服务目录下的重定向文件：

### 目录结构示例

```
yourusername.github.io/
├── cctv/
│   └── index.html    → 重定向到 https://yourdomain.com:8081
├── jellyfin/
│   └── index.html    → 重定向到 https://yourdomain.com:8080
└── homeassistant/
    └── worker.js     → Cloudflare Worker 路由
```

### 文件格式

- **index.html**：简单 HTML 重定向，GitHub Pages 原生支持，无需额外配置
- **worker.js**：Cloudflare Worker 格式，适合多域名/多路径路由

---

## 隐私说明

本工具连接配置（服务器 IP、SSH 密码、GitHub Token 等）**仅存储在本地**，不会上传到任何服务器。

脱敏说明：上传到 GitHub 的源码已将所有个人隐私信息替换为占位符（`YOUR_SERVER_IP`、`YOUR_DOMAIN` 等），请在本地使用前替换为真实值。

---

## 技术栈

- **Electron 28** — 跨平台桌面框架
- **ssh2** — SSH2 客户端（Node.js）
- **adm-zip** — ZIP 解压（证书包处理）
- **GitHub REST API v3** — 仓库管理

---

## License

MIT
