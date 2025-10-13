// electron/main.js
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const fetch = require('node-fetch');            // v2 (commonjs)
const JSZip = require('jszip');
const cheerio = require('cheerio');
const { exiftool } = require('exiftool-vendored');

const isDev = !app.isPackaged;
let win;

// ---------- Window ----------
function createWindow() {
    win = new BrowserWindow({
        width: 1200,
        height: 800,
        show: false,
        webPreferences: {
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
        }
    });

    win.webContents.on('did-finish-load', () => win && win.show());
    win.webContents.on('did-fail-load', (_e, code, desc, url) =>
        console.error('did-fail-load:', code, desc, url)
    );
    win.webContents.on('render-process-gone', (_e, details) =>
        console.error('render-process-gone:', details)
    );

    if (isDev) {
        const devURL = process.env.ELECTRON_START_URL || 'http://localhost:3000';
        win.loadURL(devURL);
        win.webContents.openDevTools({ mode: 'detach' });
    } else {
        const indexHtml = path.resolve(__dirname, '..', 'build', 'index.html');
        win.loadFile(indexHtml);
    }
}

app.setAppLogsPath();

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

app.whenReady().then(createWindow);
app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

process.on('uncaughtException', (e) => console.error('uncaughtException', e));
process.on('unhandledRejection', (e) => console.error('unhandledRejection', e));

// ---------- Helpers ----------
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

// ---------- IPC ----------
ipcMain.handle('pick-zip-path', async (_evt, suggested = 'photo_package.zip') => {
    const { canceled, filePath } = await dialog.showSaveDialog({
        title: 'Save ZIP',
        defaultPath: suggested,
        filters: [{ name: 'ZIP Archive', extensions: ['zip'] }]
    });
    return canceled ? null : filePath;
});

ipcMain.handle('make-zip-one', async (_evt, { url, zipPath }) => {
    const zip = new JSZip();
    await processImageToZip(zip, url);
    const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    fs.writeFileSync(zipPath, buf);
    return { ok: true, zipPath };
});

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

ipcMain.handle('list-folders', async (_evt, baseUrl) => {
    const url = baseUrl.endsWith('/') ? baseUrl : baseUrl + '/';
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();

    const $ = cheerio.load(html);
    const folders = [];
    $('a[href]').each((_, a) => {
        const href = $(a).attr('href') || '';
        // только дочерние каталоги в листинге
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

// --- NEW: Delete folders on remote server via HTTP DELETE ---
ipcMain.handle('delete-folders-remote', async (_evt, { urls, headers = {} } = {}) => {
    if (!Array.isArray(urls) || urls.length === 0) {
        return { ok: false, error: 'No URLs provided' };
    }

    const results = [];
    for (const raw of urls) {
        try {
            const u = String(raw);
            const url = u.endsWith('/') ? u : (u + '/');  // обычно папка с завершающим слэшем
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

// --- OPTIONAL: save single image (renderer fallback uses this if exists) ---
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

// ---------- Quit ----------
app.on('window-all-closed', async () => {
    try { await exiftool.end(); } catch {}
    if (process.platform !== 'darwin') app.quit();
});
