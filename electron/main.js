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

app.commandLine.appendSwitch('enable-logging');

const isDev = !app.isPackaged;
let win;

// ===================== path helpers / icons =====================
function resolveAsset(...parts) {
    const base = isDev ? __dirname : process.resourcesPath;
    return path.join(isDev ? base : path.join(base, 'app'), ...parts);
}
function getPlatformIconPath() {
    if (process.platform === 'win32') return resolveAsset('assets', 'app.ico');
    if (process.platform === 'darwin') return resolveAsset('assets', 'icon.icns');
    return resolveAsset('assets', 'app.png');
}
function getWindowIconForPlatform() {
    if (process.platform === 'win32') {
        const p = getPlatformIconPath();
        return fs.existsSync(p) ? p : undefined;
    }
    const preferred = getPlatformIconPath();
    if (fs.existsSync(preferred)) {
        try { return nativeImage.createFromPath(preferred); } catch {}
    }
    const fallbacks = [resolveAsset('assets', 'app.png'), resolveAsset('assets', 'app.ico')];
    for (const f of fallbacks) {
        if (fs.existsSync(f)) {
            try { return nativeImage.createFromPath(f); } catch {}
        }
    }
    return undefined;
}

// ===================== logger =====================
function initFileLogger() {
    try {
        const logDir = app.getPath('logs');
        const logFile = path.join(logDir, 'main.log');
        const origLog = console.log, origErr = console.error, origWarn = console.warn;
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
        const base = app.isPackaged ? app.getAppPath() : path.resolve(__dirname, '..');
        const indexHtml = path.join(base, 'build', 'index.html');
        if (!fs.existsSync(indexHtml)) {
            const html = `
        <h2>AW5-UI</h2>
        <p><code>build/index.html</code> not found.</p>
        <p>Run <code>npm run build:react</code> before packaging.</p>`;
            win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
            console.error('[LOAD] build/index.html not found at', indexHtml);
            return false;
        }
        win.loadFile(indexHtml).catch(err => console.error('[LOAD][ERR] loadFile failed:', err));
        return true;
    };
    if (!isDev) { loadBuild(); return; }
    win.loadURL(devURL)
        .then(() => console.log('[LOAD] dev server:', devURL))
        .catch(err => { console.warn('[LOAD] dev server failed:', err?.message || err); loadBuild(); });
}

// ===================== window =====================
function createWindow() {
    win = new BrowserWindow({
        width: 1200,
        height: 800,
        show: false,
        icon: resolveAsset('../public/icon.ico'),
        webPreferences: { contextIsolation: true, preload: path.join(__dirname, 'preload.js') }
    });
    win.webContents.on('console-message', (_e, level, message, line, sourceId) => {
        const levels = ['DEBUG','LOG','WARN','ERROR']; console.log(`[renderer:${levels[level] ?? level}] ${message} (${sourceId}:${line})`);
    });
    win.webContents.on('did-finish-load', () => { if (win && !win.isVisible()) win.show(); });
    win.webContents.on('dom-ready', () => { if (!win.isVisible()) win.show(); });
    loadRenderer(win);
    if (isDev) win.webContents.openDevTools({ mode: 'detach' });
}

// ===================== app lifecycle =====================
app.setAppLogsPath();
if (process.platform === 'win32') app.setAppUserModelId('com.airworker.myapps');

app.whenReady().then(() => {
    console.log('[main] ready'); console.log('[main] logs dir:', app.getPath('logs'));
    initFileLogger();
    if (process.platform === 'darwin' && app.dock) {
        const dockIcon = getPlatformIconPath();
        try { if (fs.existsSync(dockIcon)) app.dock.setIcon(dockIcon); } catch (e) { console.warn('[dock] setIcon failed:', e?.message || e); }
    }
    globalShortcut.register('Control+Shift+I', () => { const w = BrowserWindow.getFocusedWindow(); if (w) w.webContents.toggleDevTools(); });
    createWindow();
});

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
else app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
process.on('uncaughtException', (e) => console.error('[main] uncaughtException', e));
process.on('unhandledRejection', (e) => console.error('[main] unhandledRejection', e));
app.on('will-quit', () => { try { globalShortcut.unregisterAll(); } catch {} });
app.on('window-all-closed', async () => { try { await exiftool.end(); } catch {} if (process.platform !== 'darwin') app.quit(); });

// ===================== helpers =====================
async function processImageToZip(zip, url, prefix = '') {
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

    const dir = prefix ? `${prefix}/` : '';
    const txtName = fileName.replace(/\.[^.]+$/, '') + '_meta.txt';

    zip.file(dir + fileName, buf);

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

    zip.file(dir + txtName, lines.join('\n'));
}

async function listImagesOfFolder(folderUrl) {
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
            images.push({ name: decodeURIComponent(href), url: new URL(href, url).toString() });
        }
    });
    return images;
}

// ===================== IPC =====================

// pick save path for zip
ipcMain.handle('pick-zip-path', async (_evt, suggested = 'photo_package.zip') => {
    const { canceled, filePath } = await dialog.showSaveDialog({
        title: 'Save ZIP',
        defaultPath: suggested,
        filters: [{ name: 'ZIP Archive', extensions: ['zip'] }]
    });
    return canceled ? null : filePath;
});

// make zip for one image
ipcMain.handle('make-zip-one', async (_evt, { url, zipPath }) => {
    const zip = new JSZip();
    await processImageToZip(zip, url);
    const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    fs.writeFileSync(zipPath, buf);
    return { ok: true, zipPath };
});

// make zip for all images of one folder
ipcMain.handle('make-zip-all', async (_evt, { folderUrl, zipPath }) => {
    const imgs = await listImagesOfFolder(folderUrl);
    if (!imgs.length) throw new Error('No images found in folder');
    const zip = new JSZip();
    for (const img of imgs) await processImageToZip(zip, img.url);
    const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    fs.writeFileSync(zipPath, buf);
    return { ok: true, count: imgs.length, zipPath };
});

// NEW: make ONE ZIP from MULTIPLE folders (kept from previous step)
ipcMain.handle('make-zip-multi', async (_evt, { entries, zipPath }) => {
    if (!Array.isArray(entries) || !entries.length) throw new Error('No entries provided');
    const zip = new JSZip();
    for (const ent of entries) {
        const folderName = String(ent.name || 'folder').replace(/[\\/:*?"<>|]/g, '_');
        const imgs = await listImagesOfFolder(ent.url);
        for (const img of imgs) await processImageToZip(zip, img.url, folderName);
    }
    const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    fs.writeFileSync(zipPath, buf);
    return { ok: true, zipPath };
});

// NEW: make ONE ZIP from SELECTED PHOTOS
ipcMain.handle('make-zip-photos', async (_evt, { photos, zipPath, prefix = '' }) => {
    if (!Array.isArray(photos) || !photos.length) throw new Error('No photos provided');
    const zip = new JSZip();
    for (const url of photos) await processImageToZip(zip, url, prefix);
    const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    fs.writeFileSync(zipPath, buf);
    return { ok: true, count: photos.length, zipPath };
});

// list folders
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
            const name = decodeURIComponent(href.replace(/\/$/, ''));

            // 🔥 пропускаем сразу все "logs", "log", ".git", "_cache" и т.д.
            if (
                /^(log|logs)$/i.test(name) ||
                name.startsWith('.') ||
                name.startsWith('_')
            ) {
                return; // просто не добавляем в список
            }

            folders.push({ name, url: new URL(href, url).toString() });
        }
    });

    folders.sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { numeric: true })
    );

    return folders;
});


// list images in folder
ipcMain.handle('list-images', async (_evt, folderUrl) => listImagesOfFolder(folderUrl));

// delete folders (as was)
ipcMain.handle('delete-folders-remote', async (_evt, { urls, headers = {} } = {}) => {
    if (!Array.isArray(urls) || !urls.length) return { ok: false, error: 'No URLs provided' };
    const results = [];
    for (const raw of urls) {
        try {
            const u = String(raw);
            const url = u.endsWith('/') ? u : (u + '/');
            const res = await fetch(url, { method: 'DELETE', headers: { 'X-Requested-By': 'AW-5-UI', ...headers } });
            if (!res.ok) {
                const text = await res.text().catch(() => '');
                results.push({ url, ok: false, status: res.status, body: text });
            } else results.push({ url, ok: true, status: res.status });
        } catch (e) {
            results.push({ url: raw, ok: false, error: String(e?.message || e) });
        }
    }
    return { ok: results.every(r => r.ok), results };
});

// NEW: delete images (by direct file URLs)
ipcMain.handle('delete-images-remote', async (_evt, { urls, headers = {} } = {}) => {
    if (!Array.isArray(urls) || !urls.length) return { ok: false, error: 'No URLs provided' };
    const results = [];
    for (const url of urls) {
        try {
            const res = await fetch(String(url), { method: 'DELETE', headers: { 'X-Requested-By': 'AW-5-UI', ...headers } });
            if (!res.ok) {
                const text = await res.text().catch(() => '');
                results.push({ url, ok: false, status: res.status, body: text });
            } else results.push({ url, ok: true, status: res.status });
        } catch (e) {
            results.push({ url, ok: false, error: String(e?.message || e) });
        }
    }
    return { ok: results.every(r => r.ok), results };
});

// save single image
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
