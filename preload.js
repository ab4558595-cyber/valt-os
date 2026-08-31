const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('valtAPI', {
  getQuickLocations: () => ipcRenderer.invoke('fs-get-quick-locations'),
  listDirectory: (dirPath) => ipcRenderer.invoke('fs-list-directory', dirPath),
  readFileContent: (filePath) => ipcRenderer.invoke('fs-read-file', filePath),
  saveFileContent: (filePath, content) => ipcRenderer.invoke('fs-save-file', { filePath, content }),
  deleteFile: (filePath) => ipcRenderer.invoke('fs-delete-file', filePath),
  createItem: (itemPath, isFolder) => ipcRenderer.invoke('fs-create-item', { itemPath, isFolder }),
  watchDirectory: (dirPath) => ipcRenderer.invoke('fs-watch-directory', dirPath),
  onDirectoryChanged: (callback) => ipcRenderer.on('fs-dir-changed', (event, data) => callback(data)),

  launchExecutable: (exePath) => ipcRenderer.invoke('proc-launch-exe', exePath),
  killProcess: (pid) => ipcRenderer.invoke('proc-kill', pid),

  getWifiStatus: () => ipcRenderer.invoke('wifi-get-status'),
  toggleWifiAdapter: (enable) => ipcRenderer.invoke('wifi-toggle-adapter', enable),
  connectWifi: (ssid, password) => ipcRenderer.invoke('wifi-connect', { ssid, password }),
  getSystemMetrics: () => ipcRenderer.invoke('sys-get-metrics'),
  toggleFullscreen: () => ipcRenderer.invoke('sys-toggle-fullscreen'),

  onDownloadProgress: (callback) => ipcRenderer.on('download-progress', (event, data) => callback(data))
});