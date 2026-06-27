// Electron main process for Atlas Studio (ADR-0015).
//
// Boots the companion server in-process and opens the Atlas studio in a native
// window, so the whole "companion server + Atlas" experience is a single
// double-click install with no terminal, Node, or npm required.
const { app, BrowserWindow, Menu, shell, dialog } = require('electron');
const path = require('path');
const net = require('net');

const PREFERRED_PORT = Number(process.env.ATLAS_PORT) || 3000;
let serverPort = PREFERRED_PORT;
let mainWindow = null;

// Where the bundled browser extension lives, so we can help users load it.
// Packaged: shipped as an unpacked folder under resources/ (extraResources);
// dev: the repo's extension/ directory.
function extensionDir() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'extension')
    : path.join(__dirname, '..', 'extension');
}

function showConnectHelp() {
  const dir = extensionDir();
  dialog.showMessageBox(mainWindow, {
    type: 'info',
    title: 'Connect the browser extension',
    message: 'Atlas needs the Folderizer browser extension',
    detail:
      'Atlas reads your folders and notebooks through the Folderizer browser extension.\n\n' +
      '1. Open your browser and go to chrome://extensions (or edge://extensions).\n' +
      '2. Turn on Developer mode.\n' +
      '3. Click "Load unpacked" and select this folder:\n' +
      dir + '\n\n' +
      '4. Open notebooklm.google.com and keep the tab open.\n\n' +
      'The extension connects on port 3000, so Atlas must be the server running there. ' +
      'The status pill turns green ("Connected") once it links up.',
    buttons: ['Open the extension folder', 'OK'],
    defaultId: 0,
    cancelId: 1
  }).then((r) => { if (r.response === 0) shell.openPath(dir); });
}

// Find an open port, starting at `preferred` and walking upward.
function findOpenPort(preferred, attempts) {
  return new Promise((resolve) => {
    const tryPort = (port, left) => {
      const tester = net.createServer()
        .once('error', () => { (left > 0) ? tryPort(port + 1, left - 1) : resolve(preferred); })
        .once('listening', () => { tester.close(() => resolve(port)); })
        .listen(port, '127.0.0.1');
    };
    tryPort(preferred, attempts == null ? 20 : attempts);
  });
}

async function startServer() {
  serverPort = await findOpenPort(PREFERRED_PORT);
  process.env.PORT = String(serverPort);
  // server.js reads PORT and exposes start(); booting it here runs the REST +
  // WebSocket bridge inside the desktop process.
  const { start } = require('..' + path.sep + 'server.js');
  await start(serverPort);
  return serverPort;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 880,
    minWidth: 980,
    minHeight: 640,
    backgroundColor: '#0e0c18',
    title: 'Atlas Studio',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
    show: false
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.loadURL(`http://localhost:${serverPort}/atlas/`);

  // Open external links (e.g. NotebookLM) in the system browser, not in-app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'Open Atlas in Browser',
          accelerator: 'CmdOrCtrl+B',
          click: () => shell.openExternal(`http://localhost:${serverPort}/atlas/`)
        },
        {
          label: 'Open NotebookLM',
          click: () => shell.openExternal('https://notebooklm.google.com/')
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' }
      ]
    },
    { label: 'View', submenu: [{ role: 'reload' }, { role: 'forceReload' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }] },
    {
      role: 'help',
      submenu: [
        { label: 'Connect the extension...', click: () => showConnectHelp() },
        { type: 'separator' },
        {
          label: 'About Atlas Studio',
          click: () => dialog.showMessageBox(mainWindow, {
            type: 'info',
            title: 'About Atlas Studio',
            message: 'Atlas Studio',
            detail: `Research & Podcast Studio for NotebookLM.\nCompanion server + Atlas, bundled as a desktop app.\nServer: http://localhost:${serverPort}\n\nKeep a NotebookLM tab open (with the Folderizer extension) so generation can run.`
          })
        },
        { label: 'NotebookLM Folderizer on GitHub', click: () => shell.openExternal('https://github.com/mlcyclops/notebooklmchrome') }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// Single-instance: focus the existing window instead of opening a second.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); }
  });

  app.whenReady().then(async () => {
    try {
      await startServer();
    } catch (err) {
      dialog.showErrorBox('Atlas Studio failed to start', String(err && err.message || err));
      app.quit();
      return;
    }
    buildMenu();
    createWindow();
    // The browser extension connects on port 3000. If something else already
    // holds 3000, the extension will link to that instead of this app, so warn.
    if (serverPort !== 3000) {
      mainWindow.once('ready-to-show', () => {
        dialog.showMessageBox(mainWindow, {
          type: 'warning',
          title: 'Port 3000 is in use',
          message: 'Atlas is running on port ' + serverPort,
          detail:
            'Something else is already using port 3000 (probably another companion server). ' +
            'The browser extension only connects on port 3000, so it will not link to this ' +
            'window until 3000 is free.\n\nClose the other server, then restart Atlas Studio.',
          buttons: ['OK']
        });
      });
    }
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });

  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}
