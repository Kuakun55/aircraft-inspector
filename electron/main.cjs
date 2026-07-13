const { app, BrowserWindow, shell } = require('electron')
const { join } = require('path')
const { existsSync } = require('fs')
const { serveStatic } = require('./static-server.cjs')
const { LOADING_HTML } = require('./screens.cjs')

const isDev = !app.isPackaged
const DEV_URL = 'http://localhost:3000'

process.on('uncaughtException', (err) => {
  console.error('[main] uncaughtException', err)
})
process.on('unhandledRejection', (err) => {
  console.error('[main] unhandledRejection', err)
})

if (!app.requestSingleInstanceLock()) {
  console.error('[main] another instance already holds the lock, quitting')
  app.quit()
  process.exit(0)
}

let splashWindow = null
let mainWindow = null

function resourcePath(name) {
  return isDev ? join(__dirname, '..', name) : join(process.resourcesPath, name)
}

function iconPath() {
  const icon = resourcePath('build/icon.png')
  return existsSync(icon) ? icon : undefined
}

function createSplash() {
  splashWindow = new BrowserWindow({
    width: 420,
    height: 280,
    frame: false,
    resizable: false,
    movable: false,
    backgroundColor: '#0f172a',
    icon: iconPath(),
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  })
  splashWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(LOADING_HTML)}`)
  return splashWindow
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: '#0f172a',
    show: false,
    icon: iconPath(),
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
    if (splashWindow) {
      splashWindow.close()
      splashWindow = null
    }
  })
  mainWindow.on('closed', () => {
    mainWindow = null
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(DEV_URL) && !url.startsWith('http://127.0.0.1')) {
      event.preventDefault()
      shell.openExternal(url)
    }
  })

  return mainWindow
}

app.whenReady().then(async () => {
  try {
    createSplash()
    const win = createMainWindow()

    if (isDev) {
      await win.loadURL(DEV_URL)
      return
    }

    const { port } = await serveStatic(resourcePath('out'))
    console.log('[main] static server listening on', port, 'serving', resourcePath('out'))
    await win.loadURL(`http://127.0.0.1:${port}`)
  } catch (err) {
    console.error('[main] failed to start', err)
  }
})

app.on('window-all-closed', () => {
  console.log('[main] window-all-closed')
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
})
