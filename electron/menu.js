'use strict';
const { app, BrowserWindow, Menu, shell } = require('electron');

// Sends an action to the renderer of the main window
function sendAction(action) {
	const win = BrowserWindow.getAllWindows()[0];
	if (!win) return;
	if (process.platform === 'darwin') win.restore();
	win.webContents.send(action);
}

module.exports = function () {
	const isMac = process.platform === 'darwin';

	const template = [
		...(isMac ? [{
			label: app.name,
			submenu: [
				{ label: 'About Octo', click: () => sendAction('showAbout') },
				{ type: 'separator' },
				{ label: 'Preferences', accelerator: 'Cmd+,', click: () => sendAction('showPreferences') },
				{ type: 'separator' },
				{ role: 'services' },
				{ type: 'separator' },
				{ role: 'hide' },
				{ role: 'hideOthers' },
				{ role: 'unhide' },
				{ type: 'separator' },
				{ role: 'quit' }
			]
		}] : [{
			label: 'File',
			submenu: [
				{ label: 'Preferences', accelerator: 'Ctrl+,', click: () => sendAction('showPreferences') },
				{ type: 'separator' },
				{ role: 'quit' }
			]
		}]),
		{
			label: 'Edit',
			submenu: [
				{ role: 'undo' },
				{ role: 'redo' },
				{ type: 'separator' },
				{ role: 'cut' },
				{ role: 'copy' },
				{ role: 'paste' },
				{ role: 'pasteAndMatchStyle' },
				{ role: 'delete' },
				{ role: 'selectAll' }
			]
		},
		{
			label: 'View',
			submenu: [
				{
					label: 'Reload Octo',
					accelerator: 'CmdOrCtrl+Shift+R',
					click: (item, focusedWindow) => { if (focusedWindow) focusedWindow.reload(); }
				},
				{
					label: 'Reload Current Service',
					accelerator: 'CmdOrCtrl+R',
					click: () => sendAction('reloadCurrentService')
				},
				{ type: 'separator' },
				{ role: 'togglefullscreen' },
				{ role: 'toggleDevTools' }
			]
		},
		{
			label: 'Window',
			role: 'window',
			submenu: [
				{ role: 'minimize' },
				{ role: 'close' },
				...(isMac ? [{ type: 'separator' }, { role: 'front' }] : [])
			]
		},
		{
			label: 'Help',
			role: 'help',
			submenu: [
				{ label: 'Octo on GitHub', click: () => shell.openExternal('https://github.com/Techblogogy/Octo') },
				{ type: 'separator' },
				{
					label: 'Clear Cache',
					click: (item, win) => { if (win) win.webContents.session.clearCache().then(() => win.reload()); }
				},
				{
					label: 'Clear Local Storage',
					click: (item, win) => { if (win) win.webContents.session.clearStorageData({ storages: ['localstorage'] }).then(() => win.reload()); }
				},
				...(isMac ? [] : [{ type: 'separator' }, { label: 'About Octo', click: () => sendAction('showAbout') }])
			]
		}
	];

	return Menu.buildFromTemplate(template);
};
