'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // 日志监听
  onLog: cb => ipcRenderer.on('log', (_, d) => cb(d)),

  // 设置
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: s => ipcRenderer.invoke('save-settings', s),
  testConnection: () => ipcRenderer.invoke('test-connection'),

  // SSL
  selectFile: () => ipcRenderer.invoke('select-file'),
  sslUpdate: zipPath => ipcRenderer.invoke('ssl-update', zipPath),

  // 反代配置
  loadNginxConf: () => ipcRenderer.invoke('load-nginx-conf'),
  saveNginxConf: content => ipcRenderer.invoke('save-nginx-conf', content),

  // Nginx 状态
  nginxStatus: () => ipcRenderer.invoke('nginx-status'),
  nginxControl: action => ipcRenderer.invoke('nginx-control', action),

  // GitHub 链接管理
  ghTest: () => ipcRenderer.invoke('gh-test'),
  ghListServices: () => ipcRenderer.invoke('gh-list-services'),
  ghGetService: id => ipcRenderer.invoke('gh-get-service', id),
  ghSaveService: data => ipcRenderer.invoke('gh-save-service', data),
  ghDeleteService: id => ipcRenderer.invoke('gh-delete-service', id),
  ghSyncBatch: services => ipcRenderer.invoke('gh-sync-batch', services),
});
