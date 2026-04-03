import { app, BrowserWindow } from 'electron';

const isDev = process.env.ELECTRON_ENV === 'development';
const APP_URL = isDev ? 'http://localhost:5173' : 'http://localhost:3001';

let mainWindow;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1400,
        height: 900,
        titleBarStyle: 'hiddenInset',
        trafficLightPosition: { x: 16, y: 15 },
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
        }
    });

    // Retry loading in case the server needs a moment to bind
    function tryLoad(attemptsLeft) {
        mainWindow.loadURL(APP_URL).catch(() => {
            if (attemptsLeft > 0) setTimeout(() => tryLoad(attemptsLeft - 1), 300);
        });
    }
    tryLoad(10);

    mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(async () => {
    process.env.USER_DATA_PATH = app.getPath('userData');
    await import('./server.js');
    setTimeout(createWindow, 500);

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});
