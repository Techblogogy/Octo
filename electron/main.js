'use strict';

const { app, BrowserWindow, shell, Menu, ipcMain, nativeImage, session } = require('electron');
const path = require('path');
const fs = require('fs');
const Store = require('electron-store');
const AutoLaunch = require('auto-launch');
const tray = require('./tray');

const isDev = !app.isPackaged;

// Persistent configuration
const config = new Store({
	defaults: {
		always_on_top: false
		, hide_menu_bar: false
		, window_display_behavior: 'taskbar_tray'
		, auto_launch: !isDev
		, flash_frame: true
		, window_close_behavior: 'keep_in_tray'
		, start_minimized: false
		, systemtray_indicator: true
		, master_password: false
		, dont_disturb: false
		, disable_gpu: process.platform === 'linux'
		, proxy: false
		, proxyHost: ''
		, proxyPort: ''
		, locale: 'en'
		, enable_hidpi_support: false

		, x: undefined
		, y: undefined
		, width: 1074
		, height: 660
		, maximized: false
	}
});

// Fix issues with HiDPI scaling on Windows platform
if (config.get('enable_hidpi_support') && (process.platform === 'win32')) {
	app.commandLine.appendSwitch('high-dpi-support', 'true');
	app.commandLine.appendSwitch('force-device-scale-factor', '1');
}

// Squirrel assigns the UserModelId automatically, match it so notifications work on Windows
app.setAppUserModelId('com.squirrel.Octo.Octo');

// Only one instance at a time; a second launch focuses the existing window
if (!app.requestSingleInstanceLock()) {
	app.quit();
	return;
}
app.on('second-instance', function () {
	if (!mainWindow) return;
	if (mainWindow.isMinimized()) mainWindow.restore();
	mainWindow.show();
	mainWindow.focus();
	mainWindow.setSkipTaskbar(false);
	if (app.dock && app.dock.show) app.dock.show();
});

// Auto launch
const appLauncher = new AutoLaunch({
	name: 'Octo'
	, isHidden: config.get('start_minimized')
});
if (config.get('auto_launch') && !isDev) {
	appLauncher.enable().catch(function () {});
} else {
	appLauncher.disable().catch(function () {});
}

// Squirrel (Windows installer) lifecycle events
if (handleSquirrelEvent()) {
	// squirrel event handled and app will exit in 1000ms, so don't do anything else
	return;
}

function handleSquirrelEvent() {
	if (process.platform !== 'win32' || process.argv.length === 1) {
		return false;
	}

	const ChildProcess = require('child_process');

	const appFolder = path.resolve(process.execPath, '..');
	const rootAtomFolder = path.resolve(appFolder, '..');
	const updateDotExe = path.resolve(path.join(rootAtomFolder, 'Update.exe'));
	const exeName = path.basename(process.execPath);

	const spawnUpdate = function (args) {
		try {
			return ChildProcess.spawn(updateDotExe, args, { detached: true });
		} catch (error) { }
	};

	switch (process.argv[1]) {
		case '--squirrel-install':
		case '--squirrel-updated':
			spawnUpdate(['--createShortcut', exeName]);
			setTimeout(app.quit, 1000);
			return true;

		case '--squirrel-uninstall':
			spawnUpdate(['--removeShortcut', exeName]);
			fs.rmSync(app.getPath('userData'), { recursive: true, force: true });
			setTimeout(app.quit, 1000);
			return true;

		case '--squirrel-obsolete':
			app.quit();
			return true;
	}
	return false;
}

// Keep a global reference of the window objects so they are not garbage collected
let mainWindow = null;
let mainMasterPasswordWindow = null;
let isQuitting = false;

// Hosts the user marked as trusted (self-signed certificates on custom services)
const trustedHosts = new Set();

function createWindow() {
	mainWindow = new BrowserWindow({
		title: 'Octo'
		, icon: path.join(__dirname, '..', 'resources', 'Icon.png')
		, x: config.get('x')
		, y: config.get('y')
		, width: config.get('width')
		, height: config.get('height')
		, alwaysOnTop: config.get('always_on_top')
		, autoHideMenuBar: config.get('hide_menu_bar')
		, skipTaskbar: config.get('window_display_behavior') === 'show_trayIcon'
		, show: true
		, acceptFirstMouse: true
		, webPreferences: {
			// The Ext JS renderer talks to Node and hosts <webview> tags directly
			nodeIntegration: true
			, contextIsolation: false
			, sandbox: false
			, webviewTag: true
			, webSecurity: false
			, partition: 'persist:rambox'
			, experimentalFeatures: true
		}
		, titleBarStyle: 'hidden'
		, frame: false
		, transparent: true
		, vibrancy: 'under-window'
		, resizable: true
	});

	if (!config.get('start_minimized') && config.get('maximized')) mainWindow.maximize();

	process.setMaxListeners(10000);

	if (isDev) mainWindow.webContents.openDevTools({ mode: 'detach' });

	mainWindow.loadFile(path.join(__dirname, '..', 'index.html'));

	// The frameless window has no menu bar; on macOS the application menu still
	// provides the Edit shortcuts (copy / paste) and the About entry.
	if (process.platform === 'darwin') {
		Menu.setApplicationMenu(require('./menu')(config));
	} else {
		mainWindow.setMenu(null);
	}

	tray.create(mainWindow, config);

	// Links opened from the main window go to the default browser
	mainWindow.webContents.setWindowOpenHandler(function ({ url }) {
		const protocol = new URL(url).protocol;
		if (protocol === 'http:' || protocol === 'https:' || protocol === 'mailto:') {
			shell.openExternal(url);
		}
		return { action: 'deny' };
	});

	mainWindow.webContents.on('will-navigate', function (event) {
		event.preventDefault();
	});

	// <webview> guests: hand window.open / target=_blank back to the renderer,
	// which decides per service what to do with it
	mainWindow.webContents.on('did-attach-webview', function (event, webContents) {
		webContents.setWindowOpenHandler(function ({ url, disposition }) {
			mainWindow.webContents.send('webview:new-window', webContents.id, url, disposition);
			return { action: 'deny' };
		});
	});

	// BrowserWindow events
	mainWindow.on('page-title-updated', (e, title) => updateBadge(title));
	mainWindow.on('maximize', function () { config.set('maximized', true); });
	mainWindow.on('unmaximize', function () { config.set('maximized', false); });
	mainWindow.on('resize', function () { if (!mainWindow.isMaximized()) config.set(mainWindow.getBounds()); });
	mainWindow.on('move', function () { if (!mainWindow.isMaximized()) config.set(mainWindow.getBounds()); });
	mainWindow.on('app-command', (e, cmd) => {
		// Mouse back / forward buttons navigate the active service
		if (cmd === 'browser-backward') mainWindow.webContents.executeJavaScript('if(Ext.cq1("app-main")) Ext.cq1("app-main").getActiveTab().goBack();');
		if (cmd === 'browser-forward') mainWindow.webContents.executeJavaScript('if(Ext.cq1("app-main")) Ext.cq1("app-main").getActiveTab().goForward();');
	});

	mainWindow.on('close', function (e) {
		if (isQuitting) return;
		e.preventDefault();

		switch (process.platform) {
			case 'darwin':
				app.hide();
				break;
			default:
				switch (config.get('window_close_behavior')) {
					case 'keep_in_tray':
						mainWindow.hide();
						break;
					case 'keep_in_tray_and_taskbar':
						mainWindow.minimize();
						break;
					case 'quit':
						app.quit();
						break;
				}
				break;
		}
	});
	mainWindow.on('closed', function () {
		mainWindow = null;
	});
	mainWindow.once('focus', () => mainWindow.flashFrame(false));
}

function createMasterPasswordWindow() {
	mainMasterPasswordWindow = new BrowserWindow({
		backgroundColor: '#0675A0'
		, frame: false
		, webPreferences: {
			nodeIntegration: true
			, contextIsolation: false
			, sandbox: false
		}
	});
	if (isDev) mainMasterPasswordWindow.webContents.openDevTools({ mode: 'detach' });

	mainMasterPasswordWindow.loadFile(path.join(__dirname, '..', 'masterpassword.html'));
	mainMasterPasswordWindow.on('close', function () { mainMasterPasswordWindow = null; });
}

function updateBadge(title) {
	const messageCount = title.match(/\d+/g) ? parseInt(title.match(/\d+/g).join(''), 10) : 0;

	tray.setBadge(messageCount, config.get('systemtray_indicator'));

	if (process.platform === 'win32') {
		if (messageCount === 0) {
			mainWindow.setOverlayIcon(null, '');
			return;
		}
		mainWindow.webContents.send('setBadge', messageCount);
	} else {
		app.setBadgeCount(messageCount);
	}

	if (messageCount > 0 && !mainWindow.isFocused() && !config.get('dont_disturb') && config.get('flash_frame')) mainWindow.flashFrame(true);
}

// Certificate errors: only accepted for hosts the user marked as trusted
app.on('certificate-error', function (event, webContents, url, error, certificate, callback) {
	let host = '';
	try { host = new URL(url).hostname; } catch (e) { }
	if (trustedHosts.has(host)) {
		event.preventDefault();
		callback(true);
	} else {
		callback(false);
	}
});

// ---- IPC ----

ipcMain.on('getVersion', function (event) {
	event.returnValue = app.getVersion();
});

ipcMain.on('getDirName', function (event) {
	event.returnValue = __dirname;
});

ipcMain.on('quitApp', function () {
	isQuitting = true;
	app.quit();
});

ipcMain.on('showWindow', function () {
	if (!mainWindow) return;
	if (mainWindow.isMinimized()) mainWindow.restore();
	mainWindow.show();
	mainWindow.focus();
});

ipcMain.on('openExternalLink', function (event, url) {
	shell.openExternal(url);
});

ipcMain.on('trustCertificate', function (event, url) {
	try { trustedHosts.add(new URL(url).hostname); } catch (e) { }
});

ipcMain.on('setBadge', function (event, messageCount, value) {
	const img = nativeImage.createFromDataURL(value);
	mainWindow.setOverlayIcon(img, messageCount.toString());
});

ipcMain.on('getConfig', function (event) {
	event.returnValue = config.store;
});

ipcMain.on('setConfig', function (event, values) {
	config.set(values);

	mainWindow.setAutoHideMenuBar(values.hide_menu_bar);
	if (!values.hide_menu_bar) mainWindow.setMenuBarVisibility(true);
	mainWindow.setAlwaysOnTop(values.always_on_top);
	(values.auto_launch ? appLauncher.enable() : appLauncher.disable()).catch(function () {});
	updateBadge(mainWindow.getTitle());

	switch (values.window_display_behavior) {
		case 'show_taskbar':
			mainWindow.setSkipTaskbar(false);
			tray.destroy();
			break;
		case 'show_trayIcon':
			mainWindow.setSkipTaskbar(true);
			tray.create(mainWindow, config);
			break;
		case 'taskbar_tray':
			mainWindow.setSkipTaskbar(false);
			tray.create(mainWindow, config);
			break;
		default:
			break;
	}
});

ipcMain.on('validateMasterPassword', function (event, pass) {
	if (config.get('master_password') === require('crypto').createHash('md5').update(pass).digest('hex')) {
		createWindow();
		mainMasterPasswordWindow.close();
		event.returnValue = true;
		return;
	}
	event.returnValue = false;
});

// Per-service notification permission
ipcMain.on('setServiceNotifications', function (event, partition, op) {
	session.fromPartition(partition).setPermissionRequestHandler(function (webContents, permission, callback) {
		if (permission === 'notifications') return callback(op);
		callback(true);
	});
});

// Wipe cache and storage of a removed service
ipcMain.on('clearServiceData', function (event, partition) {
	const s = session.fromPartition(partition);
	s.clearCache().catch(function () {});
	s.clearStorageData().catch(function () {});
});

ipcMain.on('setDontDisturb', function (event, arg) {
	config.set('dont_disturb', arg);
});

ipcMain.on('reloadApp', function () {
	mainWindow.reload();
});

ipcMain.on('relaunchApp', function () {
	app.relaunch();
	app.exit(0);
});

// Download an image to a temporary file and open it
// Credit: Ghetto Skype (https://github.com/stanfieldr/ghetto-skype)
const tmp = require('tmp');
const mime = require('mime');
const imageCache = {};
ipcMain.on('image:download', function (event, url, partition) {
	let file = imageCache[url];
	if (file) {
		if (file.complete) shell.openPath(file.path);
		// Pending downloads intentionally do not proceed
		return;
	}

	let tmpWindow = new BrowserWindow({
		show: false
		, webPreferences: { partition: partition }
	});

	tmpWindow.webContents.session.once('will-download', (event, downloadItem) => {
		imageCache[url] = file = {
			path: tmp.tmpNameSync() + '.' + mime.getExtension(downloadItem.getMimeType())
			, complete: false
		};

		downloadItem.setSavePath(file.path);
		downloadItem.once('done', () => {
			tmpWindow.destroy();
			tmpWindow = null;
			shell.openPath(file.path);
			file.complete = true;
		});
	});

	tmpWindow.webContents.downloadURL(url);
});

// Hangouts photo albums
ipcMain.on('image:popup', function (event, url, partition) {
	const tmpWindow = new BrowserWindow({
		width: mainWindow.getBounds().width
		, height: mainWindow.getBounds().height
		, parent: mainWindow
		, icon: path.join(__dirname, '..', 'resources', 'Icon.png')
		, backgroundColor: '#FFF'
		, autoHideMenuBar: true
		, skipTaskbar: true
		, webPreferences: { partition: partition }
	});

	tmpWindow.maximize();
	tmpWindow.loadURL(url);
});

ipcMain.on('toggleWin', function (event, alwaysShow) {
	if (!mainWindow) return;
	if (mainWindow.isMinimized()) {
		mainWindow.restore();
	} else if (mainWindow.isVisible() && !alwaysShow) {
		mainWindow.close();
	} else {
		mainWindow.show();
	}
});

// Proxy
if (config.get('proxy')) app.commandLine.appendSwitch('proxy-server', config.get('proxyHost') + ':' + config.get('proxyPort'));

// Disable GPU acceleration on Linux to prevent the white page bug
// https://github.com/electron/electron/issues/6139
if (config.get('disable_gpu')) app.disableHardwareAcceleration();

app.on('ready', function () {
	config.get('master_password') ? createMasterPasswordWindow() : createWindow();
});

app.on('window-all-closed', function () {
	// On macOS the app stays active until the user quits explicitly with Cmd + Q
	if (process.platform !== 'darwin') {
		app.quit();
	}
});

app.on('activate', function () {
	if (mainWindow === null && mainMasterPasswordWindow === null) {
		config.get('master_password') ? createMasterPasswordWindow() : createWindow();
	}

	if (mainWindow !== null) mainWindow.show();
});

app.on('before-quit', function () {
	isQuitting = true;
});
