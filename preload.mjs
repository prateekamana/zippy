import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electron', {
  openExternal(url) {
    ipcRenderer.invoke('open-external', url);
  },
});
