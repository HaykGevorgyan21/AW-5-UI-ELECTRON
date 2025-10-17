const { contextBridge, ipcRenderer } = require('electron');

console.log('[preload] loaded');

contextBridge.exposeInMainWorld('electronAPI', {
    pickZipPath: (suggested) => ipcRenderer.invoke('pick-zip-path', suggested),

    makeZipOne:   (payload) => ipcRenderer.invoke('make-zip-one', payload),
    makeZipAll:   (payload) => ipcRenderer.invoke('make-zip-all', payload),
    makeZipMulti: (payload) => ipcRenderer.invoke('make-zip-multi', payload),   // folders -> one ZIP
    makeZipPhotos:(payload) => ipcRenderer.invoke('make-zip-photos', payload),  // photos  -> one ZIP

    listFolders: (baseUrl)   => ipcRenderer.invoke('list-folders', baseUrl),
    listImages:  (folderUrl) => ipcRenderer.invoke('list-images', folderUrl),

    deleteFoldersRemote: (urls, headers = {}) =>
        ipcRenderer.invoke('delete-folders-remote', { urls, headers }),
    deleteImagesRemote: (urls, headers = {}) =>
        ipcRenderer.invoke('delete-images-remote', { urls, headers }),

    saveImage: (url, suggestedName) =>
        ipcRenderer.invoke('save-image', { url, suggestedName }),
});
