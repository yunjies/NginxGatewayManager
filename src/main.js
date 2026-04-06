'use strict';

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const ssh2 = require('ssh2').Client;
const { Readable } = require('stream');

// ══════════════════════════════════════════════════════════
// 全局状态
// ══════════════════════════════════════════════════════════
let mainWindow = null;
let sshClient = null;
let settingsPath = '';

// 默认配置
const defaultSettings = {
  server: { host: 'YOUR_SERVER_IP', port: 22, username: 'root', password: '' },
  nginx:  { sslDir: '/home/YOUR_USERNAME/ssl', confPath: '/etc/nginx/conf.d/YOUR_DOMAIN.conf' },
  git:    { enabled: false, repoUrl: '', localPath: '/tmp/nginx-config', branch: 'main', commitMsg: 'Update nginx config' },
  github: { token: '', owner: 'YOUR_USERNAME', repo: 'YOUR_GITHUB_PAGES_REPO', branch: 'main' }
};

// ══════════════════════════════════════════════════════════
// 设置读写
// ══════════════════════════════════════════════════════════
function getSettingsPath() {
  if (!settingsPath) {
    settingsPath = path.join(app.getPath('userData'), 'settings.json');
  }
  return settingsPath;
}

function loadSettings() {
  const p = getSettingsPath();
  if (fs.existsSync(p)) {
    try {
      const raw = fs.readFileSync(p, 'utf8');
      return { ...defaultSettings, ...JSON.parse(raw) };
    } catch (e) {
      console.error('settings parse error:', e);
    }
  }
  return { ...defaultSettings };
}

function saveSettings(data) {
  const p = getSettingsPath();
  fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf8');
  return { ok: true };
}

// ══════════════════════════════════════════════════════════
// SSH 连接
// ══════════════════════════════════════════════════════════
function getSshClient() {
  if (sshClient) {
    try { sshClient.end(); } catch (e) {}
  }
  sshClient = new ssh2();
  return sshClient;
}

function sshExec(cmd, sudo = false) {
  return new Promise((resolve, reject) => {
    const settings = loadSettings();
    const client = getSshClient();
    const { host, port, username, password } = settings.server;

    client.on('ready', () => {
      const fullCmd = sudo ? `echo '${password}' | sudo -S ${cmd}` : cmd;
      client.exec(fullCmd, (err, stream) => {
        if (err) { client.end(); reject(err); return; }
        let out = '', errOut = '';
        stream.on('close', (code) => {
          client.end();
          resolve({ code, output: out.trim(), error: errOut.trim() });
        });
        stream.on('data', d => { out += d.toString(); sendLog('info', d.toString()); });
        stream.stderr.on('data', d => { errOut += d.toString(); sendLog('error', d.toString()); });
      });
    });

    client.on('error', err => reject(err));
    client.connect({ host, port, username, password, readyTimeout: 10000 });
  });
}

function sshSftp(uploadFiles) {
  return new Promise((resolve, reject) => {
    const settings = loadSettings();
    const client = getSshClient();
    client.on('ready', () => {
      client.sftp((err, sftp) => {
        if (err) { client.end(); reject(err); return; }
        const next = (i) => {
          if (i >= uploadFiles.length) { client.end(); resolve({ ok: true }); return; }
          const { remote, local, backupDir } = uploadFiles[i];
          const remoteBackup = backupDir ? `${backupDir}/${path.basename(local)}` : null;

          const doUpload = () => {
            sftp.fastPut(local, remote, err2 => {
              if (err2) { client.end(); reject(err2); return; }
              sendLog('info', `上传: ${remote}`);
              next(i + 1);
            });
          };

          if (remoteBackup) {
            sftp.fastPut(local, remoteBackup, errB => {
              if (!errB) sendLog('info', `备份: ${remoteBackup}`);
              doUpload();
            });
          } else {
            doUpload();
          }
        };
        next(0);
      });
    });
    client.on('error', err => reject(err));
    client.connect({ host: settings.server.host, port: settings.server.port, username: settings.server.username, password: settings.server.password, readyTimeout: 10000 });
  });
}

// ══════════════════════════════════════════════════════════
// 日志转发
// ══════════════════════════════════════════════════════════
function sendLog(type, msg) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('log', { type, msg: msg.trim() });
  }
}

// ══════════════════════════════════════════════════════════
// GitHub API
// ══════════════════════════════════════════════════════════
async function ghApi(method, endpoint, body = null, isJson = true) {
  const settings = loadSettings();
  const token = settings.github.token;
  if (!token) throw new Error('未配置 GitHub Token，请在设置中填写');

  const url = `https://api.github.com${endpoint}`;
  const opts = {
    method,
    headers: {
      'Authorization': `token ${token}`,
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'Nginx-Gateway-Manager'
    }
  };
  if (body && isJson) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }

  const res = await fetch(url, opts);
  const text = await res.text();
  if (!res.ok) {
    let errMsg = `GitHub API ${res.status}: ${res.statusText}`;
    try { const j = JSON.parse(text); if (j.message) errMsg = j.message; } catch (e) {}
    throw new Error(errMsg);
  }
  return isJson && text ? JSON.parse(text) : text;
}

// 解析 worker.js 内容 → 服务列表
function parseWorkerJs(content) {
  const services = [];
  // 匹配 window.location.href = "..." 或 location.replace("...") 或 fetch
  const redirectRegex = /window\.location\.href\s*=\s*["']([^"']+)["']|location\.replace\s*\(\s*["']([^"']+)["']/g;
  // 匹配路由注释如 /** homeassistant https://... */
  const routeRegex = /\/\*\*\s*(\S+)\s+(https?:\/\/[^\s*]+)\s*\*\//g;
  let match;
  while ((match = routeRegex.exec(content)) !== null) {
    const [, name, url] = match;
    services.push({ name, targetUrl: url, type: 'redirect' });
  }
  if (services.length === 0) {
    while ((match = redirectRegex.exec(content)) !== null) {
      const url = match[1] || match[2];
      if (url && url.startsWith('http')) {
        const name = extractNameFromUrl(url);
        services.push({ name, targetUrl: url, type: 'redirect' });
      }
    }
  }
  return services;
}

function extractNameFromUrl(url) {
  try {
    const u = new URL(url);
    return u.hostname.split('.')[0];
  } catch { return 'unknown'; }
}

// 生成 worker.js 内容
function generateWorkerJs(services) {
  const routes = services.map(s => `  /** ${s.name} ${s.targetUrl} */`).join('\n');
  const firstUrl = services[0]?.targetUrl || 'https://example.com';
  return `addEventListener("fetch", event => {\n${routes}\n  const url = new URL(event.request.url);\n  const subdomain = url.hostname.split('.')[0];\n  const route = routes.find(r => r.includes(subdomain));\n  if (route) {\n    const targetUrl = route.match(/https?:\\/\\/[^\\s*]+/)[0];\n    event.respondWith(fetch(targetUrl + url.pathname + url.search));\n  } else {\n    event.respondWith(new Response("Not Found", { status: 404 }));\n  }\n});`;
}

// 生成 index.html
function generateIndexHtml(targetUrl, serviceName) {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${serviceName}</title>
  <meta http-equiv="refresh" content="0;url=${targetUrl}">
</head>
<body>
  <p>Redirecting to <a href="${targetUrl}">${targetUrl}</a>...</p>
</body>
</html>`;
}

// ══════════════════════════════════════════════════════════
// IPC Handlers
// ══════════════════════════════════════════════════════════
function setupIpcHandlers() {
  // ── 设置 ──
  ipcMain.handle('get-settings', () => {
    const s = loadSettings();
    // 隐藏密码
    s.server._hasPassword = !!s.server.password;
    s.server.password = '';
    s.github._hasToken = !!s.github.token;
    s.github.token = '';
    return { ok: true, data: s };
  });

  ipcMain.handle('save-settings', (_, newSettings) => {
    const old = loadSettings();
    // 保留原密码/Token 如果新值为空
    if (!newSettings.server.password) newSettings.server.password = old.server.password;
    if (!newSettings.github.token) newSettings.github.token = old.github.token;
    saveSettings(newSettings);
    return { ok: true };
  });

  // ── SSH 测试 ──
  ipcMain.handle('test-connection', async () => {
    try {
      const res = await sshExec('echo ok && uname -a');
      return { ok: true, output: res.output };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  // ── SSL 更新 ──
  ipcMain.handle('ssl-update', async (_, zipPath) => {
    try {
      const settings = loadSettings();
      const sslDir = settings.nginx.sslDir;
      const confPath = settings.nginx.confPath;
      const tmpDir = os.tmpdir() + '/ssl-update-' + Date.now();
      fs.mkdirSync(tmpDir, { recursive: true });

      sendLog('info', `解压: ${zipPath}`);
      const { execSync } = require('child_process');
      try {
        execSync(`powershell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${tmpDir}' -Force"`, { stdio: 'pipe' });
      } catch (e) {
        // 尝试用 python
        const AdmZIP = require('adm-zip');
        const zip = new AdmZIP(zipPath);
        zip.extractAllTo(tmpDir, true);
      }

      sendLog('info', `查找证书文件...`);
      const pemFiles = [];
      function findPem(dir) {
        for (const f of fs.readdirSync(dir)) {
          const fp = path.join(dir, f);
          if (fs.statSync(fp).isDirectory()) { findPem(fp); continue; }
          if (/\.(pem|crt|key|cer)$/i.test(f)) pemFiles.push(fp);
        }
      }
      findPem(tmpDir);
      if (pemFiles.length === 0) throw new Error('ZIP 中未找到证书文件（.pem/.crt/.key）');

      sendLog('info', `找到 ${pemFiles.length} 个证书文件`);
      const backupDir = `${sslDir}/.backup_${Date.now()}`;

      // 上传到服务器
      await sshSftp(pemFiles.map(p => ({
        local: p,
        remote: `${sslDir}/${path.basename(p)}`,
        backupDir
      })));

      // nginx reload
      sendLog('info', '重新加载 nginx...');
      const reloadRes = await sshExec('nginx -t && nginx -s reload', true);
      if (reloadRes.code !== 0 && !reloadRes.output.includes('syntax is ok')) {
        // 回滚
        sendLog('error', '配置测试失败，尝试回滚...');
        await sshSftp([{
          local: pemFiles[0],
          remote: `${sslDir}/${path.basename(pemFiles[0])}`,
          backupDir: null
        }]);
        throw new Error(`nginx -t 失败: ${reloadRes.error}`);
      }

      // 清理
      fs.rmSync(tmpDir, { recursive: true, force: true });
      return { ok: true, backupDir };
    } catch (e) {
      sendLog('error', `SSL 更新失败: ${e.message}`);
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('select-file', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [{ name: 'ZIP', extensions: ['zip'] }]
    });
    if (result.canceled || result.filePaths.length === 0) return '';
    return result.filePaths[0];
  });

  // ── 反代配置 ──
  ipcMain.handle('load-nginx-conf', async () => {
    try {
      const settings = loadSettings();
      const confPath = settings.nginx.confPath;
      const cmd = `cat ${confPath}`;
      const res = await sshExec(cmd);

      // 解析端口映射 - 支持 nginx.conf 多 server{} 块
      // 逐 server 块解析，避免不同 server 块的 location 混在一起
      const mappings = [];
      // 把 conf 按 server{} 块拆分
      const serverBlocks = res.output.split(/^server\s*\{/m);
      for (let i = 1; i < serverBlocks.length; i++) {
        const block = 'server { ' + serverBlocks[i];
        const listenMatch = block.match(/^\s*listen\s+(\d+)/m);
        const serverNameMatch = block.match(/^\s*server_name\s+([^;]+);/m);
        const proxyMatch = block.match(/^\s*proxy_pass\s+https?:\/\/([^:\/\s]+):?(\d*)([^\s;]*)/m);
        if (listenMatch && proxyMatch) {
          mappings.push({
            listenPort: listenMatch[1],
            serverName: serverNameMatch ? serverNameMatch[1].trim() : '',
            targetHost: proxyMatch[1],
            targetPort: proxyMatch[2] || '',
            path: proxyMatch[3] ? proxyMatch[3].trim() : '/'
          });
        }
      }
      return { ok: true, data: { content: res.output, mappings } };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('save-nginx-conf', async (_, content) => {
    try {
      const settings = loadSettings();
      const confPath = settings.nginx.confPath;
      const tmpFile = os.tmpdir() + '/nginx-conf-' + Date.now();
      fs.writeFileSync(tmpFile, content, 'utf8');

      await sshSftp([{ local: tmpFile, remote: confPath, backupDir: null }]);
      fs.unlinkSync(tmpFile);

      sendLog('info', '测试 nginx 配置...');
      const testRes = await sshExec('nginx -t', true);
      if (testRes.code !== 0) {
        sendLog('error', `nginx -t 失败: ${testRes.error}`);
        return { ok: false, error: testRes.error };
      }
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  // ── Nginx 状态 ──
  ipcMain.handle('nginx-status', async () => {
    try {
      const vRes = await sshExec('nginx -v 2>&1');
      const ver = vRes.output || vRes.error || '';

      const pRes = await sshExec('ps aux | grep nginx | grep -v grep');
      const running = pRes.output.includes('nginx: master') || pRes.output.includes('nginx: worker');
      const workers = (pRes.output.match(/nginx/g) || []).length;

      const tRes = await sshExec('nginx -t 2>&1');
      const testOut = tRes.output || tRes.error || '';

      return {
        ok: true, data: {
          version: ver.replace('nginx version: ', '').replace(/nginx\/[\d.]+/, '').trim() || ver,
          running, workerCount: workers, testOutput: testOut, runningProcesses: pRes.output
        }
      };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('nginx-control', async (_, action) => {
    try {
      const cmdMap = {
        start: 'nginx',
        stop: 'nginx -s stop',
        reload: 'nginx -s reload',
        restart: 'nginx -s stop && sleep 1 && nginx'
      };
      const res = await sshExec(cmdMap[action] || action, true);
      return { ok: res.code === 0, output: res.output, error: res.error };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  // ══════════════════════════════════════════════════════════
  // GitHub 链接管理（新增）
  // ══════════════════════════════════════════════════════════

  // 加载所有服务
  ipcMain.handle('gh-list-services', async () => {
    try {
      const settings = loadSettings();
      const { owner, repo, branch } = settings.github;

      sendLog('info', `从 GitHub 加载 ${owner}/${repo}...`);

      // 获取目录内容
      let dirs = [];
      try {
        dirs = await ghApi('GET', `/repos/${owner}/${repo}/contents/?ref=${branch}`);
        dirs = dirs.filter(d => d.type === 'dir' && d.name !== '.github' && d.name !== 'assets');
      } catch (e) {
        if (e.message.includes('Not Found')) {
          return { ok: false, error: `仓库 ${owner}/${repo} 未找到，请检查设置` };
        }
        throw e;
      }

      const services = [];
      for (const dir of dirs) {
        try {
          // 尝试获取 worker.js
          const workerFile = await ghApi('GET', `/repos/${owner}/${repo}/contents/${dir.name}/worker.js?ref=${branch}`);
          const content = Buffer.from(workerFile.content, 'base64').toString('utf8');
          const parsed = parseWorkerJs(content);
          if (parsed.length > 0) {
            services.push({
              id: dir.name,
              name: dir.name,
              targetUrl: parsed[0].targetUrl,
              description: parsed[0].name,
              status: 'active',
              source: 'worker.js'
            });
          }
        } catch {
          // 尝试获取 index.html（简单重定向）
          try {
            const indexFile = await ghApi('GET', `/repos/${owner}/${repo}/contents/${dir.name}/index.html?ref=${branch}`);
            const content = Buffer.from(indexFile.content, 'base64').toString('utf8');
            const urlMatch = content.match(/url=(https?[^"]+)/);
            if (urlMatch) {
              services.push({
                id: dir.name,
                name: dir.name,
                targetUrl: urlMatch[1],
                description: dir.name,
                status: 'active',
                source: 'index.html'
              });
            }
          } catch { /* 跳过无法解析的目录 */ }
        }
      }

      sendLog('info', `加载完成: ${services.length} 个服务`);
      return { ok: true, data: services };
    } catch (e) {
      sendLog('error', `加载失败: ${e.message}`);
      return { ok: false, error: e.message };
    }
  });

  // 获取服务详情
  ipcMain.handle('gh-get-service', async (_, id) => {
    try {
      const settings = loadSettings();
      const { owner, repo, branch } = settings.github;

      let content = '', format = 'unknown';
      // 尝试 worker.js
      try {
        const f = await ghApi('GET', `/repos/${owner}/${repo}/contents/${id}/worker.js?ref=${branch}`);
        content = Buffer.from(f.content, 'base64').toString('utf8');
        format = 'worker.js';
      } catch {
        const f = await ghApi('GET', `/repos/${owner}/${repo}/contents/${id}/index.html?ref=${branch}`);
        content = Buffer.from(f.content, 'base64').toString('utf8');
        format = 'index.html';
      }

      return { ok: true, data: { content, format } };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  // 保存服务（创建/更新）
  ipcMain.handle('gh-save-service', async (_, { id, name, targetUrl, description, format }) => {
    try {
      const settings = loadSettings();
      const { owner, repo, branch } = settings.github;
      const fileFormat = format || 'worker.js';

      let content;
      if (fileFormat === 'index.html') {
        content = generateIndexHtml(targetUrl, name || id);
      } else {
        content = generateWorkerJs([{ name: name || id, targetUrl }]);
      }

      // 检查是否已存在
      let sha = null;
      try {
        const existing = await ghApi('GET', `/repos/${owner}/${repo}/contents/${id}/${fileFormat}?ref=${branch}`);
        sha = existing.sha;
      } catch { /* 新建 */ }

      const path_in_repo = `${id}/${fileFormat}`;
      const body = {
        message: `Update ${id}: ${description || targetUrl}`,
        content: Buffer.from(content).toString('base64'),
        branch
      };
      if (sha) body.sha = sha;

      const result = await ghApi('PUT', `/repos/${owner}/${repo}/contents/${path_in_repo}`, body);
      sendLog('info', `已保存 ${id}/${fileFormat}`);
      return { ok: true, data: result.content };
    } catch (e) {
      sendLog('error', `保存失败: ${e.message}`);
      return { ok: false, error: e.message };
    }
  });

  // 删除服务
  ipcMain.handle('gh-delete-service', async (_, { id }) => {
    try {
      const settings = loadSettings();
      const { owner, repo, branch } = settings.github;

      // 获取目录内所有文件
      const contents = await ghApi('GET', `/repos/${owner}/${repo}/contents/${id}?ref=${branch}`);
      const msg = `Remove service: ${id}`;

      for (const file of contents) {
        await ghApi('DELETE', `/repos/${owner}/${repo}/contents/${file.path}`, { message: msg, sha: file.sha, branch });
        sendLog('info', `删除: ${file.path}`);
      }

      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  // 批量同步
  ipcMain.handle('gh-sync-batch', async (_, services) => {
    const results = { success: 0, failed: 0, errors: [] };
    for (const svc of services) {
      sendLog('info', `同步: ${svc.id}`);
      const res = await ipcMain._events['gh-save-service'][0](null, svc);
      if (res.ok) results.success++;
      else { results.failed++; results.errors.push(`${svc.id}: ${res.error}`); }
    }
    return { ok: true, data: results };
  });

  // GitHub 连接测试
  ipcMain.handle('gh-test', async () => {
    try {
      const settings = loadSettings();
      const { owner, repo } = settings.github;
      if (!settings.github.token) return { ok: false, error: '未配置 GitHub Token' };

      const user = await ghApi('GET', '/user');
      const repoInfo = await ghApi('GET', `/repos/${owner}/${repo}`);
      return {
        ok: true,
        data: {
          username: user.login,
          repo: repo,
          defaultBranch: repoInfo.default_branch,
          description: repoInfo.description || ''
        }
      };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
}

// ══════════════════════════════════════════════════════════
// 窗口创建
// ══════════════════════════════════════════════════════════
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200, height: 800, minWidth: 900, minHeight: 600,
    webPreferences: { nodeIntegration: false, contextIsolation: true, preload: path.join(__dirname, 'preload.js') },
    icon: path.join(__dirname, '../icon.png'),
    title: 'Nginx Gateway Manager'
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  mainWindow.on('closed', () => { mainWindow = null; });
}

// ══════════════════════════════════════════════════════════
// 启动
// ══════════════════════════════════════════════════════════
app.whenReady().then(() => {
  setupIpcHandlers();
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
