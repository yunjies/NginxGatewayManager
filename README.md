# Nginx Gateway Manager

Windows 桌面应用，用于管理 Nginx 反向代理网关。

## 功能特性

### 🔐 SSL 证书更新
- 拖放或选择 Let's Encrypt 证书 ZIP 包
- 自动上传到服务器 SSL 目录
- 自动备份旧证书
- 自动测试并 reload nginx
- 配置失败自动回滚

### 🔀 反向代理配置
- **可视化编辑器**：从服务器加载 nginx.conf，表格展示端口映射
- **原始编辑**：直接编辑 nginx.conf 原始配置
- **自动测试**：保存前自动执行 `nginx -t`

### 📤 配置版本管理
- **导出配置**：将当前 nginx.conf 解析为 `io_config.json`，推送到 GitHub 仓库
- **导入配置**：从 GitHub 拉取 `io_config.json`，预览生成的 nginx.conf
- **版本历史**：查看 GitHub 提交历史，记录每次配置变更
- **一键应用**：将 GitHub 配置应用到服务器

### 📊 Nginx 状态监控
- 查看版本、运行状态、配置测试结果
- 快捷操作：启动/停止/重载/重启
- **一键安装**：检测服务器是否已安装 Nginx，未安装时显示安装按钮

### 🔗 GitHub 链接管理
- 通过 GitHub Pages (`username.github.io`) 管理 Cloudflare Worker 代理链接
- 支持添加/编辑/删除/同步服务
- 无需 Git CLI，直接通过 GitHub REST API 操作

## 配置格式

`io_config.json` 格式（用于版本管理）：
```json
{
  "version": "1.0",
  "generated": "2024-01-01T00:00:00.000Z",
  "description": "Nginx reverse proxy port mappings",
  "items": [
    {
      "name": "homeassistant",
      "port": 8123,
      "source_ip": "192.168.1.100",
      "source_port": 8123,
      "https": false,
      "path": "/",
      "server_name": "ha.example.com"
    }
  ]
}
```

## 使用方法

### 环境要求
- Windows 10/11 x64
- SSH 访问权限（服务器需运行 SSH 服务）
- GitHub Personal Access Token（用于 API 操作）

### 配置步骤

1. **服务器连接**
   - 服务器 IP/主机名
   - SSH 端口（默认 22）
   - 用户名和密码

2. **Nginx 路径配置**
   - SSL 证书目录（如 `/home/user/ssl/example.com/`）
   - nginx.conf 路径（如 `/etc/nginx/conf.d/example.com.conf`）

3. **GitHub 配置**
   - Personal Access Token（需要 repo 权限）
   - 仓库 Owner（你的 GitHub 用户名）
   - 仓库名称（用于存储 io_config.json）

### 常见配置示例

```
服务器: 192.168.1.1:22
用户名: root
SSL 目录: /home/user/ssl/example.com
配置文件: /etc/nginx/conf.d/example.com.conf
```

```nginx
# 示例 nginx.conf
server {
    listen 8123;
    server_name ha.example.com;
    
    location / {
        proxy_pass http://192.168.1.100:8123;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

## 开发

### 构建
```bash
cd electron-app
npm install
npm run build:dir
```

输出目录：`dist/win-unpacked/`

### 运行开发版
```bash
npm start
```

## 技术栈

- **Electron** - 跨平台桌面框架
- **ssh2** - SSH/SFTP 连接
- **electron-builder** - 打包发布
