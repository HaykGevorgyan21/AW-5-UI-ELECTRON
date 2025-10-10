const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    pickZipPath: (name) => ipcRenderer.invoke('pick-zip-path', name),
    makeZipOne: (payload) => ipcRenderer.invoke('make-zip-one', payload),
    makeZipAll: (payload) => ipcRenderer.invoke('make-zip-all', payload),

    listFolders: (baseUrl) => ipcRenderer.invoke('list-folders', baseUrl),
    listImages: (folderUrl) => ipcRenderer.invoke('list-images', folderUrl),  // 🔥 добавили

});
