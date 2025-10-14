// ===================== bootstrap logging early =====================
process.env.ELECTRON_ENABLE_LOGGING = 'true';
process.env.ELECTRON_ENABLE_STACK_DUMPING = 'true';

// ===================== imports =====================
const { app, BrowserWindow, ipcMain, dialog, nativeImage, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs');
const fetch = require('node-fetch');            // v2 (commonjs)
const JSZip = require('jszip');
const cheerio = require('cheerio');
const { exiftool } = require('exiftool-vendored');

// Enable Chromium logging (helps on Windows packaged runs)
app.commandLine.appendSwitch('enable-logging');

// ===================== globals =====================
const isDev = !app.isPackaged;
let win;

// ===================== path helpers / icons =====================
function resolveAsset(...parts) {
    // Dev: resolve from this folder (electron/)
    // Prod: resolve from <app>/resources/app (unpacked app.asar) or asar path
    const base = isDev ? __dirname : process.resourcesPath; // points to .../resources
    return path.join(isDev ? base : path.join(base, 'app'), ...parts);
}

// Return a path that actually exists for the OS-specific app icon
function getPlatformIconPath() {
    if (process.platform === 'win32') return resolveAsset('assets', 'app.ico');   // .ico
    if (process.platform === 'darwin') return resolveAsset('assets', 'icon.icns'); // .icns
    return resolveAsset('assets', 'app.png');                                      // .png
}

function getWindowIconForPlatform() {
    // Windows strictly wants .ico path, other platforms can take nativeImage
    if (process.platform === 'win32') {
        const p = getPlatformIconPath();
        return fs.existsSync(p) ? p : undefined;
    }

    const preferred = getPlatformIconPath();
    if (fs.existsSync(preferred)) {
        try { return nativeImage.createFromPath(preferred); } catch {}
    }

    // Fallbacks: try .png then .ico without crashing if missing
    const fallbacks = [
        resolveAsset('assets', 'app.png'),
        resolveAsset('assets', 'app.ico')
    ];
    for (const f of fallbacks) {
        if (fs.existsSync(f)) {
            try { return nativeImage.createFromPath(f); } catch {}
        }
    }
    return undefined;
}

// ===================== persistent file logger (optional but useful) =====================
function initFileLogger() {
    try {
        const logDir = app.getPath('logs'); // Electron decides OS-specific path
        const logFile = path.join(logDir, 'main.log');

        const origLog = console.log;
        const origErr = console.error;
        const origWarn = console.warn;

        const write = (tag, args) => {
            const line = `[${new Date().toISOString()}] [${tag}] ` + args.map(v => {
                try { return typeof v === 'string' ? v : JSON.stringify(v); }
                catch { return String(v); }
            }).join(' ') + '\n';
            fs.appendFileSync(logFile, line);
        };

        console.log = (...a) => { write('LOG', a); origLog(...a); };
        console.warn = (...a) => { write('WARN', a); origWarn(...a); };
        console.error = (...a) => { write('ERR', a); origErr(...a); };

        console.log('[logger] writing to', logFile);
    } catch (e) {
        console.error('[logger] init failed:', e);
    }
}

// ===================== dev/prod loader =====================
function loadRenderer(win) {
    const devURL = process.env.ELECTRON_START_URL || 'http://localhost:3000';

    const loadBuild = () => {
        // In prod, app.getAppPath() -> <resources>/app
        const base = app.isPackaged ? app.getAppPath() : path.resolve(__dirname, '..');
        const indexHtml = path.join(base, 'build', 'index.html');

        if (!fs.existsSync(indexHtml)) {
            const html = `
        <h2>AW5-UI</h2>
        <p><code>build/index.html</code> not found.</p>
        <p>Run <code>npm run build:react</code> before packaging.</p>
      `;
            win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
            console.error('[LOAD] build/index.html not found at', indexHtml);
            return false;
        }
        win.loadFile(indexHtml).catch(err => console.error('[LOAD][ERR] loadFile failed:', err));
        return true;
    };

    if (!isDev) {
        loadBuild();
        return;
    }

    // dev: try dev server first; if it fails, fallback to local build
    win.loadURL(devURL)
        .then(() => console.log('[LOAD] dev server:', devURL))
        .catch(err => {
            console.warn('[LOAD] dev server failed, fallback to build. Error:', err?.message || err);
            loadBuild();
        });
}

// ===================== window =====================
function createWindow() {
    const iconForWindow = getWindowIconForPlatform();

    win = new BrowserWindow({
        width: 1200,
        height: 800,
        show: false,
        // icon: iconForWindow,
        icon: resolveAsset('../public/icon.ico'),
        webPreferences: {
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
        }
    });

    // Forward renderer console logs into main terminal/file
    win.webContents.on('console-message', (_e, level, message, line, sourceId) => {
        const levels = ['DEBUG','LOG','WARN','ERROR'];
        console.log(`[renderer:${levels[level] ?? level}] ${message} (${sourceId}:${line})`);
    });

    win.webContents.on('did-finish-load', () => {
        console.log('[window] did-finish-load');
        if (win && !win.isVisible()) win.show();
    });

    win.webContents.on('dom-ready', () => {
        console.log('[window] dom-ready');
        // In case load fails but DOM renders some fallback, ensure the window shows
        if (!win.isVisible()) win.show();
    });

    win.webContents.on('did-fail-load', (_e, code, desc, url) => {
        console.error('[window] did-fail-load:', code, desc, url);
    });

    win.webContents.on('render-process-gone', (_e, details) => {
        console.error('[window] render-process-gone:', details);
    });

    loadRenderer(win);

    if (isDev) win.webContents.openDevTools({ mode: 'detach' });
}

// ===================== app lifecycle =====================
app.setAppLogsPath();

if (process.platform === 'win32') {
    // Ensure taskbar uses your icon/ID (must match your packager's appId)
    app.setAppUserModelId('com.airworker.myapps');
}

app.whenReady().then(() => {
    console.log('[main] ready');
    console.log('[main] logs dir:', app.getPath('logs'));
    initFileLogger();

    // macOS Dock icon
    if (process.platform === 'darwin' && app.dock) {
        const dockIcon = getPlatformIconPath(); // prefer .icns
        try {
            if (fs.existsSync(dockIcon)) app.dock.setIcon(dockIcon);
        } catch (e) {
            console.warn('[dock] setIcon failed:', e?.message || e);
        }
    }

    // Hotkey to toggle DevTools in packaged builds
    globalShortcut.register('Control+Shift+I', () => {
        const w = BrowserWindow.getFocusedWindow();
        if (w) w.webContents.toggleDevTools();
    });

    createWindow();
});

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
    app.quit();
} else {
    app.on('second-instance', () => {
        if (win) {
            if (win.isMinimized()) win.restore();
            win.focus();
        }
    });
}

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

process.on('uncaughtException', (e) => console.error('[main] uncaughtException', e));
process.on('unhandledRejection', (e) => console.error('[main] unhandledRejection', e));

app.on('will-quit', () => {
    try { globalShortcut.unregisterAll(); } catch {}
});

app.on('window-all-closed', async () => {
    try { await exiftool.end(); } catch {}
    if (process.platform !== 'darwin') app.quit();
});

// ===================== ZIP/EXIF/HTTP helpers & IPC =====================
async function processImageToZip(zip, url) {
    const fileName = decodeURIComponent(url.split('/').pop());
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = await res.buffer();

    const tmp = path.join(app.getPath('temp'), fileName);
    fs.writeFileSync(tmp, buf);

    const metadata = await exiftool.read(tmp);

    const userComment = String(metadata.UserComment || '');
    const dateTime = metadata.DateTimeOriginal || metadata.CreateDate || 'N/A';
    const gpsLat = metadata.GPSLatitude ?? 0;
    const gpsLon = metadata.GPSLongitude ?? 0;
    const gpsAlt = metadata.GPSAltitude ?? 0;

    const mPitch = userComment.match(/Pitch\s*=\s*(-?\d+(?:\.\d+)?)/i);
    const mRoll  = userComment.match(/Roll\s*=\s*(-?\d+(?:\.\d+)?)/i);
    const mYaw   = userComment.match(/Yaw\s*=\s*(-?\d+(?:\.\d+)?)/i);

    const tags = {};
    if (mPitch) tags.PitchAngle = parseFloat(mPitch[1]);
    if (mRoll)  tags.RollAngle  = parseFloat(mRoll[1]);
    if (mYaw)   tags.YawAngle   = parseFloat(mYaw[1]);

    zip.file(fileName, buf);

    const txtName = fileName.replace(/\.[^.]+$/, '') + '_meta.txt';
    const lines = [
        `File: ${fileName}`,
        `DateTimeOriginal: ${dateTime}`,
        `Pitch: ${tags.PitchAngle ?? 'N/A'}`,
        `Roll: ${tags.RollAngle ?? 'N/A'}`,
        `Yaw: ${tags.YawAngle ?? 'N/A'}`,
        '',
        'Location:',
        `Altitude: ${gpsAlt} m`,
        `Latitude: ${gpsLat} deg`,
        `Longitude: ${gpsLon} deg`
    ];
    if (userComment) lines.push('', 'UserComment:', userComment);

    zip.file(txtName, lines.join('\n'));
}

// --- IPC: pick save path for zip ---
ipcMain.handle('pick-zip-path', async (_evt, suggested = 'photo_package.zip') => {
    const { canceled, filePath } = await dialog.showSaveDialog({
        title: 'Save ZIP',
        defaultPath: suggested,
        filters: [{ name: 'ZIP Archive', extensions: ['zip'] }]
    });
    return canceled ? null : filePath;
});

// --- IPC: make zip for single image ---
ipcMain.handle('make-zip-one', async (_evt, { url, zipPath }) => {
    const zip = new JSZip();
    await processImageToZip(zip, url);
    const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    fs.writeFileSync(zipPath, buf);
    return { ok: true, zipPath };
});

// --- IPC: make zip for all images in folder listing ---
ipcMain.handle('make-zip-all', async (_evt, { folderUrl, zipPath }) => {
    const res = await fetch(folderUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();

    const $ = cheerio.load(html);
    const exts = ['.jpg', '.jpeg', '.png', '.webp', '.bmp'];
    const urls = [];

    $('a[href]').each((_, a) => {
        const href = $(a).attr('href') || '';
        const lower = href.toLowerCase();
        if (exts.some(e => lower.endsWith(e))) {
            urls.push(new URL(href, folderUrl).toString());
        }
    });

    if (!urls.length) throw new Error('No images found in folder');

    const zip = new JSZip();
    for (const u of urls) await processImageToZip(zip, u);

    const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    fs.writeFileSync(zipPath, buf);
    return { ok: true, count: urls.length, zipPath };
});

// --- IPC: list folders on a simple HTTP directory index ---
ipcMain.handle('list-folders', async (_evt, baseUrl) => {
    const url = baseUrl.endsWith('/') ? baseUrl : baseUrl + '/';
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();

    const $ = cheerio.load(html);
    const folders = [];
    $('a[href]').each((_, a) => {
        const href = $(a).attr('href') || '';
        if (href.endsWith('/') && !href.startsWith('../')) {
            folders.push({
                name: decodeURIComponent(href.replace(/\/$/, '')),
                url: new URL(href, url).toString()
            });
        }
    });

    folders.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    return folders;
});

// --- IPC: list images in a folder (simple HTTP directory index) ---
ipcMain.handle('list-images', async (_evt, folderUrl) => {
    const url = folderUrl.endsWith('/') ? folderUrl : folderUrl + '/';
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();

    const $ = cheerio.load(html);
    const exts = ['.jpg', '.jpeg', '.png', '.webp', '.bmp'];
    const images = [];

    $('a[href]').each((_, a) => {
        const href = $(a).attr('href') || '';
        const lower = href.toLowerCase();
        if (exts.some(e => lower.endsWith(e))) {
            images.push({
                name: decodeURIComponent(href),
                url: new URL(href, url).toString()
            });
        }
    });

    return images;
});

// --- IPC: DELETE folders on remote server (expects server support) ---
ipcMain.handle('delete-folders-remote', async (_evt, { urls, headers = {} } = {}) => {
    if (!Array.isArray(urls) || urls.length === 0) {
        return { ok: false, error: 'No URLs provided' };
    }

    const results = [];
    for (const raw of urls) {
        try {
            const u = String(raw);
            const url = u.endsWith('/') ? u : (u + '/');
            const res = await fetch(url, {
                method: 'DELETE',
                headers: { 'X-Requested-By': 'AW-5-UI', ...headers },
            });
            if (!res.ok) {
                const text = await res.text().catch(() => '');
                results.push({ url, ok: false, status: res.status, body: text });
            } else {
                results.push({ url, ok: true, status: res.status });
            }
        } catch (e) {
            results.push({ url: raw, ok: false, error: String(e?.message || e) });
        }
    }

    return { ok: results.every(r => r.ok), results };
});

// --- IPC: save a single image to disk ---
ipcMain.handle('save-image', async (_evt, { url, suggestedName }) => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = await res.buffer();

    const { canceled, filePath } = await dialog.showSaveDialog({
        title: 'Save image',
        defaultPath: suggestedName || path.basename(new URL(url).pathname)
    });
    if (canceled || !filePath) return { ok: false };

    fs.writeFileSync(filePath, buf);
    return { ok: true, filePath };
});
