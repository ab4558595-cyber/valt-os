/*
 * Copyright (c) 2026 Valt Systems. All Rights Reserved.
 *
 * This software and source code are protected by international copyright laws.
 * Unauthorized copying, decompilation, distribution, or reverse engineering
 * of any part of this system is strictly prohibited.
 */



const { app, BrowserWindow, ipcMain, session, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { exec, spawn } = require('child_process');

app.commandLine.appendSwitch('touch-events', 'enabled');
app.commandLine.appendSwitch('disable-touch-adjustment');

let mainWindow;
let activeWatcher = null;
let currentWatchedPath = null;

// Security Bypass Helper: Strips frame, origin, and CSP barriers on webviews
function applySecurityBypass(targetSession) {
  targetSession.webRequest.onHeadersReceived((details, callback) => {
    const responseHeaders = Object.assign({}, details.responseHeaders);

    for (const key of Object.keys(responseHeaders)) {
      const lower = key.toLowerCase();
      if (
        lower === 'x-frame-options' ||
        lower === 'content-security-policy' ||
        lower === 'content-security-policy-report-only' ||
        lower === 'cross-origin-resource-policy' ||
        lower === 'cross-origin-opener-policy' ||
        lower === 'cross-origin-embedder-policy'
      ) {
        delete responseHeaders[key];
      }
    }

    responseHeaders['Access-Control-Allow-Origin'] = ['*'];
    responseHeaders['Access-Control-Allow-Methods'] = ['*'];
    responseHeaders['Access-Control-Allow-Headers'] = ['*'];

    callback({ cancel: false, responseHeaders });
  });

  targetSession.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
  );
}

function createWindow() {
  mainWindow = new BrowserWindow({
    fullscreen: true,
    frame: false,
    kiosk: false,
    skipTaskbar: true,
    backgroundColor: '#070709',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      webviewTag: true,
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false
    }
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile('index.html');

  // Apply bypass to both default and partitioned webview sessions
  applySecurityBypass(session.defaultSession);
  const userSession = session.fromPartition('persist:valtos_user');
  applySecurityBypass(userSession);

  mainWindow.once('ready-to-show', () => {
    mainWindow.setFullScreen(true);
    mainWindow.show();
    mainWindow.focus();
  });

  // Download Handler
  session.defaultSession.on('will-download', (event, item) => {
    const fileName = item.getFilename();
    const savePath = path.join(os.homedir(), 'Downloads', fileName);
    item.setSavePath(savePath);

    const totalBytes = item.getTotalBytes();

    item.on('updated', (event, state) => {
      if (state === 'progressing') {
        const received = item.getReceivedBytes();
        const percent = totalBytes > 0 ? Math.round((received / totalBytes) * 100) : 0;
        if (mainWindow && mainWindow.webContents) {
          mainWindow.webContents.send('download-progress', { fileName, percent, state: 'downloading' });
        }
      }
    });

    item.once('done', (event, state) => {
      if (state === 'completed') {
        if (mainWindow && mainWindow.webContents) {
          mainWindow.webContents.send('download-progress', { fileName, percent: 100, state: 'completed', savePath });
        }
      } else {
        if (mainWindow && mainWindow.webContents) {
          mainWindow.webContents.send('download-progress', { fileName, state: 'cancelled' });
        }
      }
    });
  });
}

// 1. FILE SYSTEM IPC & REAL-TIME WATCHER
ipcMain.handle('fs-get-quick-locations', async () => {
  const home = os.homedir();
  const locations = [
    { name: 'This PC (C:)', path: 'C:\\', icon: 'fa-hard-drive' },
    { name: 'Desktop', path: path.join(home, 'Desktop'), icon: 'fa-desktop' },
    { name: 'Downloads', path: path.join(home, 'Downloads'), icon: 'fa-download' },
    { name: 'Documents', path: path.join(home, 'Documents'), icon: 'fa-folder-open' },
    { name: 'Pictures', path: path.join(home, 'Pictures'), icon: 'fa-images' }
  ];

  ['D:\\', 'E:\\', 'F:\\'].forEach(drive => {
    if (fs.existsSync(drive)) {
      locations.push({ name: `Drive (${drive[0]}:)`, path: drive, icon: 'fa-hard-drive' });
    }
  });

  return locations;
});

ipcMain.handle('fs-list-directory', async (event, dirPath) => {
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    return entries.map(entry => {
      const fullPath = path.join(dirPath, entry.name);
      let size = '--';
      let date = '--';
      let isDirectory = entry.isDirectory();

      try {
        const stats = fs.statSync(fullPath);
        date = stats.mtime.toLocaleDateString() + ' ' + stats.mtime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        if (!isDirectory) {
          size = stats.size > 1048576 
            ? `${(stats.size / 1048576).toFixed(1)} MB` 
            : `${(stats.size / 1024).toFixed(1)} KB`;
        }
      } catch {}

      const ext = path.extname(entry.name).toLowerCase().replace('.', '');

      return {
        name: entry.name,
        path: fullPath,
        isDirectory: isDirectory,
        ext: ext,
        size: size,
        date: date
      };
    });
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('fs-watch-directory', async (event, dirPath) => {
  try {
    if (activeWatcher) {
      activeWatcher.close();
      activeWatcher = null;
    }
    if (!fs.existsSync(dirPath)) return { success: false };

    currentWatchedPath = dirPath;
    let debounceTimer = null;

    activeWatcher = fs.watch(dirPath, { recursive: false }, (eventType, filename) => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        if (mainWindow && mainWindow.webContents) {
          mainWindow.webContents.send('fs-dir-changed', { dirPath, eventType, filename });
        }
      }, 150);
    });

    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('fs-read-file', async (event, filePath) => {
  try {
    const data = fs.readFileSync(filePath, 'utf8');
    return { success: true, content: data };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('fs-save-file', async (event, { filePath, content }) => {
  try {
    fs.writeFileSync(filePath, content, 'utf8');
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('fs-create-item', async (event, { itemPath, isFolder }) => {
  try {
    if (isFolder) {
      fs.mkdirSync(itemPath, { recursive: true });
    } else {
      fs.writeFileSync(itemPath, '', 'utf8');
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('fs-delete-file', async (event, filePath) => {
  try {
    if (fs.existsSync(filePath)) {
      const stats = fs.statSync(filePath);
      if (stats.isDirectory()) {
        fs.rmSync(filePath, { recursive: true, force: true });
      } else {
        fs.unlinkSync(filePath);
      }
      return { success: true };
    }
    return { success: false, error: 'File not found' };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// 2. EXECUTABLE RUNNER
ipcMain.handle('proc-launch-exe', async (event, exePath) => {
  try {
    const child = spawn(exePath, [], {
      detached: true,
      stdio: 'ignore',
      cwd: path.dirname(exePath),
      windowsHide: false
    });
    child.unref();

    return { 
      success: true, 
      pid: child.pid, 
      name: path.basename(exePath),
      path: exePath
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('proc-kill', async (event, pid) => {
  try {
    exec(`taskkill /PID ${pid} /T /F`);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// 3. HARDWARE WI-FI
ipcMain.handle('wifi-get-status', async () => {
  return new Promise((resolve) => {
    exec('chcp 65001 && netsh wlan show interfaces', { windowsHide: true }, (err, stdout) => {
      let ssid = 'Disconnected';
      let signal = '0%';
      let state = 'disconnected';
      let radio = 'On';

      if (!err && stdout) {
        const ssidMatch = stdout.match(/^\s*SSID\s*:\s*(.+)$/m);
        const signalMatch = stdout.match(/^\s*Signal\s*:\s*(.+)$/m);
        const stateMatch = stdout.match(/^\s*State\s*:\s*(.+)$/m);
        const radioMatch = stdout.match(/^\s*Radio status\s*:\s*(.+)$/m);

        if (ssidMatch) ssid = ssidMatch[1].trim();
        if (signalMatch) signal = signalMatch[1].trim();
        if (stateMatch) state = stateMatch[1].trim();
        if (radioMatch && radioMatch[1].toLowerCase().includes('off')) radio = 'Off';
      }

      exec('chcp 65001 && netsh wlan show networks mode=bssid', { windowsHide: true }, (netErr, netStdout) => {
        let nearby = [];
        if (!netErr && netStdout) {
          const blocks = netStdout.split(/\n\s*SSID \d+ : /);
          blocks.slice(1).forEach(block => {
            const lines = block.split('\n');
            const name = lines[0].trim();
            const sigMatch = block.match(/Signal\s*:\s*(\d+%)/);
            const authMatch = block.match(/Authentication\s*:\s*(.+)/);

            if (name && name !== ssid && !nearby.some(n => n.ssid === name)) {
              nearby.push({
                ssid: name,
                signal: sigMatch ? sigMatch[1] : '60%',
                auth: authMatch ? authMatch[1].trim() : 'WPA2-Personal'
              });
            }
          });
        }

        resolve({
          connected: state.toLowerCase().includes('connected'),
          adapterEnabled: radio !== 'Off',
          ssid: ssid,
          signal: signal,
          nearby: nearby.slice(0, 10)
        });
      });
    });
  });
});

ipcMain.handle('wifi-toggle-adapter', async (event, enable) => {
  return new Promise((resolve) => {
    const cmd = enable 
      ? 'netsh interface set interface "Wi-Fi" enable' 
      : 'netsh interface set interface "Wi-Fi" disable';
    exec(cmd, { windowsHide: true }, (err) => resolve({ success: !err }));
  });
});

ipcMain.handle('wifi-connect', async (event, { ssid, password }) => {
  return new Promise((resolve) => {
    exec(`netsh wlan connect name="${ssid}"`, { windowsHide: true }, (err, stdout) => {
      resolve({ success: !err, output: stdout });
    });
  });
});

// 4. METRICS & FULLSCREEN
ipcMain.handle('sys-get-metrics', () => {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  const cpus = os.cpus();
  
  return {
    platform: `${os.type()} ${os.release()} (${os.arch()})`,
    hostname: os.hostname(),
    cpuModel: cpus.length > 0 ? cpus[0].model : 'Unknown Processor',
    cpuCores: cpus.length,
    ramTotal: (totalMem / 1073741824).toFixed(1) + ' GB',
    ramUsed: (usedMem / 1073741824).toFixed(1) + ' GB',
    ramFree: (freeMem / 1073741824).toFixed(1) + ' GB',
    ramPercent: Math.round((usedMem / totalMem) * 100),
    uptime: (os.uptime() / 3600).toFixed(1) + ' hours'
  };
});

ipcMain.handle('sys-toggle-fullscreen', () => {
  if (!mainWindow) return false;
  const isFs = mainWindow.isFullScreen();
  mainWindow.setFullScreen(!isFs);
  return !isFs;
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
