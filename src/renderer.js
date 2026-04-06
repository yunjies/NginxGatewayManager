// ══════════════════════════════════════════════════════════
// 全局状态
// ══════════════════════════════════════════════════════════
let currentSettings = null;
let selectedZipPath = null;
let proxyMappings = [];
let originalConfContent = '';
let isDirty = false;
let ghServices = [];           // GitHub 链接服务列表
let editingServiceId = null;   // 当前编辑的服务 ID（null=新增）
let ghSyncing = false;

// ══════════════════════════════════════════════════════════
// 工具函数
// ══════════════════════════════════════════════════════════
function escHtml(s) {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function appendLog(boxId, msg, type = 'info') {
  const box = document.getElementById(boxId);
  if (!box) return;
  const time = new Date().toLocaleTimeString();
  const div = document.createElement('div');
  div.className = `log-entry log-${type}`;
  div.innerHTML = `<span class="log-time">${time}</span><span class="log-msg">${escHtml(msg)}</span>`;
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
}

function clearLog(boxId) {
  const box = document.getElementById(boxId);
  if (box) box.innerHTML = '';
}

function showCard(boxId) { document.getElementById(boxId)?.classList.remove('hidden'); }
function hideCard(boxId) { document.getElementById(boxId)?.classList.add('hidden'); }

function setConnIndicator(state, text) {
  const dot = document.querySelector('.conn-dot');
  const txt = document.querySelector('.conn-text');
  if (!dot || !txt) return;
  dot.className = `conn-dot ${state}`;
  txt.textContent = text;
}

function showPage(pageId) {
  document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelector(`.nav-item[data-page="${pageId}"]`)?.classList.add('active');
  document.getElementById('page-' + pageId)?.classList.add('active');
}

// ══════════════════════════════════════════════════════════
// 日志监听
// ══════════════════════════════════════════════════════════
window.api.onLog(data => {
  const activePage = document.querySelector('.page.active');
  if (!activePage) return;
  const pageId = activePage.id.replace('page-', '');
  const boxId = pageId + '-log-box';
  if (document.getElementById(boxId)) appendLog(boxId, data.msg, data.type);
});

// ══════════════════════════════════════════════════════════
// 页面导航
// ══════════════════════════════════════════════════════════
document.querySelectorAll('.nav-item').forEach(btn => {
  btn.addEventListener('click', () => showPage(btn.dataset.page));
});

// ══════════════════════════════════════════════════════════
// 初始化
// ══════════════════════════════════════════════════════════
async function init() {
  const res = await window.api.getSettings();
  if (res.ok) {
    currentSettings = res.data;
    updateServerDisplay();
    fillSettingsForm();
  }
}

function updateServerDisplay() {
  if (!currentSettings) return;
  const host = currentSettings.server.host;
  document.querySelectorAll('.sv-host').forEach(el => { el.textContent = host; });
  document.querySelectorAll('.sv-val').forEach(el => { el.textContent = `${host}:${currentSettings.server.port}`; });
  document.querySelectorAll('.path-val').forEach(el => { el.textContent = currentSettings.nginx.sslDir; });
}

// ══════════════════════════════════════════════════════════
// SSL 页面
// ══════════════════════════════════════════════════════════
async function testConnSSL() {
  const el = document.getElementById('sv-status-ssl');
  el.textContent = '测试中...';
  const res = await window.api.testConnection();
  if (res.ok) {
    el.textContent = '✅ 连接成功';
    setConnIndicator('online', currentSettings.server.host);
  } else {
    el.textContent = '❌ ' + res.error;
    setConnIndicator('error', '连接失败');
  }
}

async function selectZip() {
  const path = await window.api.selectFile();
  if (!path) return;
  selectedZipPath = path;
  document.getElementById('selFileName').textContent = path;
  document.querySelector('.selected-file').classList.remove('hidden');
  document.querySelector('.drop-text').textContent = '已选择文件（点击重新选择）';
  document.querySelector('.drop-hint').textContent = path.split('\\').pop().split('/').pop();
  document.querySelector('.zip-val').textContent = path;
  showCard('ssl-confirm-card');
  hideCard('ssl-log-card');
}

function sslBack() {
  hideCard('ssl-confirm-card');
  document.querySelector('.selected-file').classList.add('hidden');
  document.querySelector('.drop-text').textContent = '点击选择或拖放 ZIP 文件';
  document.querySelector('.drop-hint').textContent = '*.zip';
  selectedZipPath = null;
}

async function runSSLUpdate() {
  if (!selectedZipPath) return;
  hideCard('ssl-confirm-card');
  showCard('ssl-log-card');
  clearLog('ssl-log-box');
  document.getElementById('ssl-after-btns').style.display = 'none';
  document.getElementById('btn-start-ssl').disabled = true;

  const res = await window.api.sslUpdate(selectedZipPath);

  document.getElementById('btn-start-ssl').disabled = false;
  document.getElementById('ssl-after-btns').style.display = 'flex';

  if (res.ok) {
    appendLog('ssl-log-box', `✅ 全部完成！备份: ${res.backupDir}`, 'success');
  } else {
    appendLog('ssl-log-box', `❌ 更新失败: ${res.error}`, 'error');
  }
}

function sslRestart() {
  hideCard('ssl-log-card');
  sslBack();
}

// 拖放
const dropZone = document.getElementById('fileDropZone');
if (dropZone) {
  dropZone.addEventListener('click', selectZip);
  dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('dragover'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
  dropZone.addEventListener('drop', e => {
    e.preventDefault(); dropZone.classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    if (file && file.name.endsWith('.zip')) {
      selectedZipPath = file.path;
      document.getElementById('selFileName').textContent = file.name;
      document.querySelector('.selected-file').classList.remove('hidden');
      document.querySelector('.zip-val').textContent = file.path;
      showCard('ssl-confirm-card');
    }
  });
}

// ══════════════════════════════════════════════════════════
// 反代配置页面
// ══════════════════════════════════════════════════════════
async function loadProxyConfig() {
  clearLog('proxy-log-box');
  appendLog('proxy-log-box', '正在从服务器加载 nginx 配置...');
  showCard('proxy-log-card');
  const res = await window.api.loadNginxConf();
  if (!res.ok) { appendLog('proxy-log-box', `加载失败: ${res.error}`, 'error'); return; }
  originalConfContent = res.data.content;
  proxyMappings = res.data.mappings || [];
  isDirty = false;

  const editor = document.getElementById('confEditor');
  editor.value = originalConfContent;
  editor.readOnly = false;

  const tbody = document.getElementById('proxyTableBody');
  const table = document.getElementById('proxyTable');
  tbody.innerHTML = '';

  if (proxyMappings.length === 0) {
    document.querySelector('.proxy-hint').textContent = '配置文件已加载，但未识别到端口映射';
    table.classList.add('hidden');
  } else {
    document.querySelector('.proxy-hint').textContent = `识别到 ${proxyMappings.length} 个反代映射`;
    table.classList.remove('hidden');
    for (const m of proxyMappings) {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><span class="port-badge">${escHtml(m.listenPort)}</span></td>
        <td>${escHtml(m.serverName)}</td>
        <td>${escHtml(m.targetHost)}</td>
        <td>${escHtml(m.targetPort)}</td>
        <td>${escHtml(m.path)}</td>
      `;
      tbody.appendChild(tr);
    }
  }
  appendLog('proxy-log-box', `已加载 ${proxyMappings.length} 个映射`, 'success');
}

async function saveProxyConfig() {
  const content = document.getElementById('confEditor').value;
  if (!isDirty && content === originalConfContent) {
    appendLog('proxy-log-box', '配置未变化，无需保存', 'warn'); return;
  }
  clearLog('proxy-log-box');
  showCard('proxy-log-card');
  appendLog('proxy-log-box', '正在保存配置...');
  const res = await window.api.saveNginxConf(content);
  if (res.ok) {
    originalConfContent = content;
    isDirty = false;
    appendLog('proxy-log-box', '✅ 配置保存并生效', 'success');
  } else {
    appendLog('proxy-log-box', `❌ 保存失败: ${res.error}`, 'error');
  }
}

document.getElementById('confEditor')?.addEventListener('input', function () {
  isDirty = this.value !== originalConfContent;
});

// ══════════════════════════════════════════════════════════
// GitHub 链接页面
// ══════════════════════════════════════════════════════════

// 加载服务列表
async function ghLoadServices() {
  clearLog('ghlinks-log-box');
  showCard('ghlinks-log-card');
  appendLog('ghlinks-log-box', '正在从 GitHub 加载服务列表...');

  const res = await window.api.ghListServices();
  if (!res.ok) {
    appendLog('ghlinks-log-box', `❌ 加载失败: ${res.error}`, 'error');
    document.getElementById('gh-empty-hint').textContent = '加载失败，请检查 GitHub 设置';
    document.getElementById('gh-empty-hint').style.color = 'var(--danger)';
    return;
  }

  ghServices = res.data;
  document.getElementById('gh-empty-hint').style.display = 'none';
  renderServiceList();
  appendLog('ghlinks-log-box', `✅ 加载完成: ${ghServices.length} 个服务`, 'success');
  document.getElementById('gh-info').textContent = `📦 ${ghServices.length} 个服务`;
}

// 渲染服务列表
function renderServiceList() {
  const container = document.getElementById('service-list');
  container.innerHTML = '';

  if (ghServices.length === 0) {
    document.getElementById('gh-empty-hint').style.display = '';
    return;
  }

  // 按名称排序
  const sorted = [...ghServices].sort((a, b) => a.name.localeCompare(b.name));

  for (const svc of sorted) {
    const card = document.createElement('div');
    card.className = 'service-card';
    card.innerHTML = `
      <div class="service-icon">${getServiceEmoji(svc.id)}</div>
      <div class="service-info">
        <div class="service-name">${escHtml(svc.name)}</div>
        <div class="service-url">${escHtml(svc.targetUrl)}</div>
        <div class="service-desc">${escHtml(svc.description || '')}</div>
      </div>
      <span class="service-source">${escHtml(svc.source || 'worker.js')}</span>
      <div class="service-actions">
        <button class="btn btn-outline btn-sm" onclick="editService('${escHtml(svc.id)}')">✏️</button>
        <button class="btn btn-outline btn-sm" onclick="deleteServiceConfirm('${escHtml(svc.id)}')">🗑️</button>
      </div>
    `;
    container.appendChild(card);
  }
}

// 服务图标 emoji
function getServiceEmoji(id) {
  const map = {
    cctv: '📹', jellyfin: '🎬', homeassistant: '🏠', immich: '📷',
    nextcloud: '☁️', photoprism: '🖼️', portainer: '🐳', qb: '⬇️',
    transmission: '📡', unifi: '📶', openclaw: '🦞', openwrt: '🔧',
    filebrowser: '📁', theworld: '🌍',
  };
  return map[id] || '🔗';
}

// 打开新增服务
function openAddService() {
  editingServiceId = null;
  document.getElementById('modal-title').textContent = '➕ 添加链接';
  document.getElementById('svc-id').value = '';
  document.getElementById('svc-id').readOnly = false;
  document.getElementById('svc-name').value = '';
  document.getElementById('svc-url').value = 'https://YOUR_DOMAIN:';
  document.getElementById('svc-desc').value = '';
  document.getElementById('fmt-worker').checked = true;
  document.getElementById('btn-delete-service').classList.add('hidden');
  document.getElementById('btn-save-service').classList.remove('hidden');
  document.getElementById('btn-save-service').textContent = '💾 保存并推送';
  document.getElementById('serviceModal').classList.remove('hidden');
}

// 编辑现有服务
async function editService(id) {
  const svc = ghServices.find(s => s.id === id);
  if (!svc) return;

  editingServiceId = id;
  document.getElementById('modal-title').textContent = `✏️ 编辑: ${id}`;
  document.getElementById('svc-id').value = svc.id;
  document.getElementById('svc-id').readOnly = true; // 不允许改 ID
  document.getElementById('svc-name').value = svc.name;
  document.getElementById('svc-url').value = svc.targetUrl;
  document.getElementById('svc-desc').value = svc.description || '';

  // 尝试获取详情
  const detail = await window.api.ghGetService(id);
  if (detail.ok) {
    const fmt = detail.data.format || 'worker.js';
    document.getElementById(fmt === 'index.html' ? 'fmt-index' : 'fmt-worker').checked = true;
  }

  document.getElementById('btn-delete-service').classList.remove('hidden');
  document.getElementById('btn-save-service').classList.remove('hidden');
  document.getElementById('btn-save-service').textContent = '💾 保存并推送';
  document.getElementById('serviceModal').classList.remove('hidden');
}

// 关闭模态框
function closeServiceModal() {
  document.getElementById('serviceModal').classList.add('hidden');
  editingServiceId = null;
}

// 保存服务（新建或更新）
async function saveService() {
  const id = document.getElementById('svc-id').value.trim();
  const name = document.getElementById('svc-name').value.trim();
  const targetUrl = document.getElementById('svc-url').value.trim();
  const description = document.getElementById('svc-desc').value.trim();
  const format = document.querySelector('input[name="svc-format"]:checked').value;

  if (!id) { alert('请填写服务 ID'); return; }
  if (!targetUrl || !targetUrl.startsWith('http')) { alert('请填写有效的目标 URL（以 http 开头）'); return; }
  if (!name) { alert('请填写服务名称'); return; }

  closeServiceModal();
  showCard('ghlinks-log-card');
  clearLog('ghlinks-log-box');

  const logPrefix = editingServiceId ? `更新 ${id}` : `添加 ${id}`;
  appendLog('ghlinks-log-box', `正在保存 ${logPrefix}...`);

  const res = await window.api.ghSaveService({ id, name, targetUrl, description, format });

  if (res.ok) {
    appendLog('ghlinks-log-box', `✅ ${logPrefix} 成功！`, 'success');
    await ghLoadServices();
  } else {
    appendLog('ghlinks-log-box', `❌ ${logPrefix}失败: ${res.error}`, 'error');
  }
}

// 确认删除
function deleteServiceConfirm(id) {
  if (!confirm(`确定要删除服务「${id}」吗？\n此操作将从 GitHub 仓库中删除该目录。`)) return;
  doDeleteService(id);
}

// 删除服务
async function doDeleteService(id) {
  closeServiceModal();
  showCard('ghlinks-log-card');
  clearLog('ghlinks-log-box');
  appendLog('ghlinks-log-box', `正在删除 ${id}...`);

  const res = await window.api.ghDeleteService(id);
  if (res.ok) {
    appendLog('ghlinks-log-box', `✅ 删除 ${id} 成功`, 'success');
    await ghLoadServices();
  } else {
    appendLog('ghlinks-log-box', `❌ 删除失败: ${res.error}`, 'error');
  }
}

// 删除（从模态框触发）
async function deleteService() {
  const id = editingServiceId;
  if (!id) return;
  closeServiceModal();
  await doDeleteService(id);
}

// 批量同步（刷新所有服务）
async function ghSyncAll() {
  if (ghSyncing) return;
  if (ghServices.length === 0) {
    alert('请先「🔄 刷新列表」加载现有服务');
    return;
  }
  if (!confirm(`将重新推送 ${ghServices.length} 个服务到 GitHub？`)) return;

  ghSyncing = true;
  clearLog('ghlinks-log-box');
  showCard('ghlinks-log-card');
  appendLog('ghlinks-log-box', `🔁 开始同步 ${ghServices.length} 个服务...`);

  const services = ghServices.map(s => ({
    id: s.id, name: s.name, targetUrl: s.targetUrl,
    description: s.description, format: s.source || 'worker.js'
  }));

  const res = await window.api.ghSyncBatch(services);
  if (res.ok) {
    const { success, failed } = res.data;
    appendLog('ghlinks-log-box', `✅ 同步完成: ${success} 成功, ${failed} 失败`, failed > 0 ? 'warn' : 'success');
  } else {
    appendLog('ghlinks-log-box', `❌ 同步失败: ${res.error}`, 'error');
  }
  ghSyncing = false;
  await ghLoadServices();
}

// ══════════════════════════════════════════════════════════
// Nginx 状态页面
// ══════════════════════════════════════════════════════════
async function refreshStatus() {
  clearLog('status-log-box');
  showCard('status-log-card');
  appendLog('status-log-box', '获取 Nginx 状态...');
  const res = await window.api.nginxStatus();
  if (!res.ok) { appendLog('status-log-box', `获取失败: ${res.error}`, 'error'); return; }

  const { version, testOutput, running, workerCount } = res.data;
  document.getElementById('nginx-version').textContent = version.replace('nginx version: ', '').replace('nginx/', '').trim() || '-';

  const iconEl = document.getElementById('status-icon');
  const valEl  = document.getElementById('status-val');
  const detEl  = document.getElementById('status-detail');
  if (running) {
    iconEl.textContent = '✅';
    valEl.textContent = '运行中';
    detEl.textContent = `${workerCount} 个 worker 进程`;
  } else {
    iconEl.textContent = '⏸️';
    valEl.textContent = '已停止';
    detEl.textContent = 'Nginx 未运行';
  }

  const testCard = document.querySelector('.status-test');
  const testEl = document.getElementById('nginx-test');
  if (testOutput.includes('syntax is ok') || testOutput.includes('is successful')) {
    testCard.classList.remove('fail'); testCard.classList.add('ok');
    testEl.textContent = '✅ 正常';
  } else if (testOutput.includes('test failed') || testOutput.includes('error')) {
    testCard.classList.remove('ok'); testCard.classList.add('fail');
    testEl.textContent = '❌ 失败';
  } else {
    testEl.textContent = '—';
  }

  document.getElementById('status-pre').textContent = res.data.runningProcesses || '（无进程）';
  appendLog('status-log-box', '状态已刷新', 'success');
}

async function nginxCtrl(action) {
  clearLog('status-log-box');
  showCard('status-log-card');
  const labels = { start: '启动', stop: '停止', reload: '重载', restart: '重启' };
  appendLog('status-log-box', `${labels[action]} Nginx...`);
  const res = await window.api.nginxControl(action);
  if (res.ok) {
    appendLog('status-log-box', `✅ Nginx ${labels[action]} 成功`, 'success');
    await refreshStatus();
  } else {
    appendLog('status-log-box', `❌ ${res.error}`, 'error');
  }
}

// ══════════════════════════════════════════════════════════
// 设置页面
// ══════════════════════════════════════════════════════════
function fillSettingsForm() {
  if (!currentSettings) return;
  const s = currentSettings;
  document.getElementById('set-host').value = s.server.host || '';
  document.getElementById('set-port').value = s.server.port || 22;
  document.getElementById('set-user').value = s.server.username || '';
  document.getElementById('set-pass').value = '';
  document.getElementById('set-ssl-dir').value = s.nginx.sslDir || '';
  document.getElementById('set-conf-path').value = s.nginx.confPath || '';
  // GitHub
  document.getElementById('set-gh-token').value = '';
  document.getElementById('set-gh-owner').value = s.github.owner || '';
  document.getElementById('set-gh-repo').value = s.github.repo || '';
  document.getElementById('set-gh-branch').value = s.github.branch || 'main';
  // Git 反代
  document.getElementById('set-git-enabled').checked = s.git?.enabled || false;
  document.getElementById('set-git-url').value = s.git?.repoUrl || '';
  document.getElementById('set-git-path').value = s.git?.localPath || '';
  document.getElementById('set-git-branch').value = s.git?.branch || 'main';
  document.getElementById('set-git-msg').value = s.git?.commitMsg || 'Update nginx config';
}

async function saveSettings() {
  clearLog('settings-log-box');
  showCard('settings-log-card');
  appendLog('settings-log-box', '保存设置...');

  const newSettings = {
    server: {
      host: document.getElementById('set-host').value.trim(),
      port: parseInt(document.getElementById('set-port').value) || 22,
      username: document.getElementById('set-user').value.trim(),
      password: document.getElementById('set-pass').value || undefined, // 空=保留原值
    },
    nginx: {
      sslDir: document.getElementById('set-ssl-dir').value.trim(),
      confPath: document.getElementById('set-conf-path').value.trim(),
    },
    github: {
      token: document.getElementById('set-gh-token').value || undefined,
      owner: document.getElementById('set-gh-owner').value.trim() || 'YOUR_USERNAME',
      repo: document.getElementById('set-gh-repo').value.trim() || 'YOUR_GITHUB_PAGES_REPO',
      branch: document.getElementById('set-gh-branch').value.trim() || 'main',
    },
    git: {
      enabled: document.getElementById('set-git-enabled').checked,
      repoUrl: document.getElementById('set-git-url').value.trim(),
      localPath: document.getElementById('set-git-path').value.trim(),
      branch: document.getElementById('set-git-branch').value.trim() || 'main',
      commitMsg: document.getElementById('set-git-msg').value.trim() || 'Update nginx config',
    },
  };

  const res = await window.api.saveSettings(newSettings);
  if (res.ok) {
    currentSettings = { ...currentSettings, ...newSettings };
    // 补回未填的密码/Token
    if (!newSettings.server.password) newSettings.server.password = currentSettings.server.password;
    if (!newSettings.github.token) newSettings.github.token = currentSettings.github.token;
    appendLog('settings-log-box', '✅ 设置已保存', 'success');
    updateServerDisplay();
  } else {
    appendLog('settings-log-box', `❌ 保存失败: ${res.error}`, 'error');
  }
}

async function testConnection() {
  clearLog('settings-log-box');
  showCard('settings-log-card');
  appendLog('settings-log-box', '正在测试连接...');
  const res = await window.api.testConnection();
  if (res.ok) {
    appendLog('settings-log-box', `✅ 连接成功: ${res.output}`, 'success');
    setConnIndicator('online', currentSettings?.server?.host || '已连接');
  } else {
    appendLog('settings-log-box', `❌ 连接失败: ${res.error}`, 'error');
    setConnIndicator('error', '连接失败');
  }
}

async function testGhConnection() {
  clearLog('settings-log-box');
  showCard('settings-log-box');
  appendLog('settings-log-box', '正在测试 GitHub 连接...');

  const token = document.getElementById('set-gh-token').value.trim();
  const owner = document.getElementById('set-gh-owner').value.trim();
  const repo = document.getElementById('set-gh-repo').value.trim();

  if (token) {
    // 先保存测试配置
    const res = await window.api.saveSettings({
      ...currentSettings,
      github: { token, owner: owner || 'YOUR_USERNAME', repo: repo || 'YOUR_GITHUB_PAGES_REPO', branch: 'main' }
    });
    if (!res.ok) { appendLog('settings-log-box', `❌ 保存失败`, 'error'); return; }
    // 重新加载以更新 token
    const r2 = await window.api.getSettings();
    if (r2.ok) currentSettings = r2.data;
  }

  const res = await window.api.ghTest();
  if (res.ok) {
    const { username, repo: r, defaultBranch } = res.data;
    document.getElementById('gh-account-info').textContent =
      `✅ 已登录: @${username} | 仓库: ${r} | 分支: ${defaultBranch}`;
    document.getElementById('gh-account-info').style.color = 'var(--success)';
    appendLog('settings-log-box', `✅ GitHub 连接成功: @${username}`, 'success');
  } else {
    document.getElementById('gh-account-info').textContent = `❌ ${res.error}`;
    document.getElementById('gh-account-info').style.color = 'var(--danger)';
    appendLog('settings-log-box', `❌ GitHub 连接失败: ${res.error}`, 'error');
  }
}

// ══════════════════════════════════════════════════════════
// 启动
// ══════════════════════════════════════════════════════════
init();
