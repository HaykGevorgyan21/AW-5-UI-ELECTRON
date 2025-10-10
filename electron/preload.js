// electron/preload.js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    pickZipPath: (suggested) => ipcRenderer.invoke('pick-zip-path', suggested),
    makeZipOne: (payload) => ipcRenderer.invoke('make-zip-one', payload),
    makeZipAll: (payload) => ipcRenderer.invoke('make-zip-all', payload),
    listFolders: (baseUrl) => ipcRenderer.invoke('list-folders', baseUrl),
    listImages: (folderUrl) => ipcRenderer.invoke('list-images', folderUrl),
});
