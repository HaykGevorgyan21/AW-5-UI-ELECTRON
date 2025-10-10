const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const fetch = require('node-fetch'); // v2
const JSZip = require('jszip');
const cheerio = require('cheerio');
const { exiftool } = require('exiftool-vendored');

function createWindow() {
    const win = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js'),
        },
    });
    win.loadURL('http://localhost:3000');
}

app.whenReady().then(createWindow);

// ---------- общий диалог выбора пути ----------
ipcMain.handle('pick-zip-path', async (_evt, suggested = 'photo_package.zip') => {
    const { canceled, filePath } = await dialog.showSaveDialog({
        title: 'Save ZIP',
        defaultPath: suggested,
        filters: [{ name: 'ZIP Archive', extensions: ['zip'] }],
    });
    return canceled ? null : filePath;
});

// ---------- обработка одного файла ----------
async function processImageToZip(zip, url) {
    const fileName = decodeURIComponent(url.split('/').pop());
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = await res.buffer();

    const tmp = path.join(app.getPath('temp'), fileName);
    fs.writeFileSync(tmp, buf);

    // --- читаем EXIF ---
    const metadata = await exiftool.read(tmp);

    // базовые поля
    const userComment = String(metadata.UserComment || '');
    const dateTime = metadata.DateTimeOriginal || metadata.CreateDate || 'N/A';
    const gpsLat = metadata.GPSLatitude ?? 0;
    const gpsLon = metadata.GPSLongitude ?? 0;
    const gpsAlt = metadata.GPSAltitude ?? 0;

    // парсим углы
    const mPitch = userComment.match(/Pitch\s*=\s*(-?\d+(?:\.\d+)?)/i);
    const mRoll  = userComment.match(/Roll\s*=\s*(-?\d+(?:\.\d+)?)/i);
    const mYaw   = userComment.match(/Yaw\s*=\s*(-?\d+(?:\.\d+)?)/i);

    const tags = {};
    if (mPitch) tags.PitchAngle = parseFloat(mPitch[1]);
    if (mRoll)  tags.RollAngle  = parseFloat(mRoll[1]);
    if (mYaw)   tags.YawAngle   = parseFloat(mYaw[1]);

    // --- записываем в ZIP ---
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
        `Longitude: ${gpsLon} deg`,
    ];
    if (userComment) lines.push('', 'UserComment:', userComment);

    zip.file(txtName, lines.join('\n'));
}

// ---------- download 1 ----------
ipcMain.handle('make-zip-one', async (_evt, { url, zipPath }) => {
    const zip = new JSZip();
    await processImageToZip(zip, url);
    const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    fs.writeFileSync(zipPath, buf);
    return { ok: true, zipPath };
});

// ---------- download all ----------
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
            const abs = new URL(href, folderUrl).toString();
            urls.push(abs);
        }
    });
    if (!urls.length) throw new Error('No images found in folder');

    const zip = new JSZip();
    for (const u of urls) {
        await processImageToZip(zip, u);
    }

    const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    fs.writeFileSync(zipPath, buf);
    return { ok: true, count: urls.length, zipPath };
});

// ---------- 📂 получение списка папок ----------
ipcMain.handle('list-folders', async (_evt, baseUrl) => {
    const url = baseUrl.endsWith('/') ? baseUrl : baseUrl + '/';
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();

    const $ = cheerio.load(html);
    const folders = [];
    $('a[href]').each((_, a) => {
        const href = $(a).attr('href') || '';
        if (href.endsWith('/')) {
            folders.push({
                name: decodeURIComponent(href.replace(/\/$/, '')),
                url: new URL(href, url).toString(),
            });
        }
    });

    folders.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    return folders;
});

// ---------- 📸 получение списка фото в выбранной папке ----------
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
                url: new URL(href, url).toString(),
            });
        }
    });

    return images;
});

// ---------- выход ----------
app.on('window-all-closed', async () => {
    await exiftool.end();
    if (process.platform !== 'darwin') app.quit();
});
