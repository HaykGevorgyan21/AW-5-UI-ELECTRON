const { app, BrowserWindow } = require("electron");
const path = require("path");
const net = require("net");

// Force NODE_ENV to "development" when running `npm start`
process.env.NODE_ENV = process.env.NODE_ENV || "development";
const isDev = process.env.NODE_ENV === "development";
const PORT = 3000;

function createWindow() {
    const win = new BrowserWindow({
        width: 1200,
        height: 800,
        show: false, // show only after content loads
        autoHideMenuBar: true,
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
        },
    });

    win.once("ready-to-show", () => {
        win.show();
    });

    if (isDev) {
        const url = `http://localhost:${PORT}`;
        console.log("[Electron] Waiting for React dev server...");

        // Try connecting to React dev server until it’s ready
        const tryConnect = () => {
            const client = net.createConnection({ port: PORT }, () => {
                client.end();
                console.log("[Electron] Connected! Loading React app...");
                win.loadURL(url);
                win.webContents.openDevTools(); // remove if you don’t want auto DevTools
            });

            client.on("error", () => {
                console.log("[Electron] React not ready yet, retrying...");
                setTimeout(tryConnect, 1000);
            });
        };

        tryConnect();
    } else {
        // Load production build (after `npm run build`)
        const indexPath = path.join(__dirname, "../build/index.html");
        console.log("[Electron] Loading production build:", indexPath);
        win.loadFile(indexPath);
    }

    win.on("closed", () => {
        app.quit();
    });
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
