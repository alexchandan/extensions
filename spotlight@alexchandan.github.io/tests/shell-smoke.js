/* SPDX-License-Identifier: GPL-3.0-or-later */
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';

function assert(condition, message) {
    if (!condition)
        throw new Error(message);
    console.log(`PASS: ${message}`);
}

export async function run() {
    await Scripting.sleep(1000);
    const extension = Main.extensionManager.lookup('spotlight@alexchandan.github.io');
    assert(extension?.stateObj?._overlay, 'extension enabled without exceptions');
    const instance = extension.stateObj;
    const overlay = instance._overlay;
    overlay._settings.set_boolean('animations-enabled', false);
    assert(instance._indicator !== null, 'panel entry is available for mouse and touch users');
    overlay._settings.set_boolean('show-panel-button', false);
    assert(instance._indicator === null, 'panel entry can be disabled');
    overlay._settings.set_boolean('show-panel-button', true);
    assert(instance._indicator !== null, 'panel entry can be restored');
    overlay.open();
    await Scripting.sleep(150);
    assert(overlay._isOpen && overlay._grab, 'overlay opens with modal keyboard grab');
    const systemProvider = overlay._providers.system;
    const nativeSystemActions = systemProvider._systemActions;
    const alwaysShowLogout = global.settings.get_boolean('always-show-log-out');
    global.settings.set_boolean('always-show-log-out', true);
    try {
        assert(nativeSystemActions.canLogout === true, 'GNOME exposes logout availability through its JavaScript getter');
        overlay._setQuery('!');
        overlay._flushSearch();
        assert(overlay._currentResults.some(result => result.id === 'system:logout'),
            'bare ! mode displays an available native system action');
        for (const query of ['!log out', 'system: log out', 'log out']) {
            overlay._setQuery(query);
            overlay._flushSearch();
            assert(overlay._currentResults.some(result => result.id === 'system:logout'),
                `${query} finds the available native logout action`);
        }
    } finally {
        global.settings.set_boolean('always-show-log-out', alwaysShowLogout);
    }
    // Dispatch to harmless fixtures so this suite never locks or ends a session.
    const systemFixture = {};
    const dispatched = [];
    const systemActions = [
        ['lock', 'canLockScreen', 'activateLockScreen'],
        ['suspend', 'canSuspend', 'activateSuspend'],
        ['restart', 'canRestart', 'activateRestart'],
        ['power-off', 'canPowerOff', 'activatePowerOff'],
        ['logout', 'canLogout', 'activateLogout'],
    ];
    for (const [id, property, method] of systemActions) {
        systemFixture[property] = true;
        systemFixture[method] = function () {
            assert(this === systemFixture, `${id} dispatch preserves the native receiver`);
            dispatched.push(id);
        };
    }
    systemProvider._systemActions = systemFixture;
    try {
        const results = systemProvider.search('', 10, {explicit: true});
        assert(results.length === systemActions.length, 'system mode lists all five available actions');
        for (const [id, property, method] of systemActions) {
            const result = results.find(item => item.id === `system:${id}`);
            result.activate();
            assert(dispatched.at(-1) === id, `${id} invokes the matching native action`);
            systemFixture[property] = false;
            assert(!systemProvider.search('', 10, {explicit: true}).some(item => item.id === result.id),
                `${id} is omitted when unavailable`);
            let refused = false;
            try { result.activate(); } catch (_error) { refused = true; }
            assert(refused && dispatched.length === systemActions.findIndex(action => action[0] === id) + 1,
                `${id} rechecks availability before activation`);
            systemFixture[property] = true;
            const activate = systemFixture[method];
            delete systemFixture[method];
            assert(!systemProvider.search('', 10, {explicit: true}).some(item => item.id === result.id),
                `${id} is omitted when the native method is missing`);
            systemFixture[method] = activate;
        }
    } finally {
        systemProvider._systemActions = nativeSystemActions;
    }
    const keyboard = global.stage.context.get_backend().get_default_seat().create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
    const press = key => {
        keyboard.notify_keyval(GLib.get_monotonic_time(), key, Clutter.KeyState.PRESSED);
        keyboard.notify_keyval(GLib.get_monotonic_time(), key, Clutter.KeyState.RELEASED);
    };
    press(Clutter.KEY_Tab);
    await Scripting.sleep(80);
    assert(global.stage.get_key_focus() !== overlay._entry.clutter_text, 'real Tab key moves focus to controls');
    overlay._setQuery('=25 * 18');
    await Scripting.sleep(120);
    assert(overlay._currentResults[0].title === '450', 'calculator search renders correct result');
    assert(overlay._resultItems[0].can_focus, 'result is keyboard focusable');
    const screenshotDir = GLib.getenv('SPOTLIGHT_SCREENSHOT_DIR');
    if (screenshotDir) {
        for (const theme of ['dark', 'light']) {
            overlay._settings.set_string('theme-mode', theme);
            await Scripting.sleep(200);
            const file = Gio.File.new_for_path(`${screenshotDir}/${theme}.png`);
            const stream = file.replace(null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
            await new Shell.Screenshot().screenshot(false, stream);
            stream.close(null);
        }
    }
    const realStSettings = overlay._stSettings;
    overlay._stSettings = {high_contrast: true, enable_animations: false};
    overlay._applyAppearance();
    overlay._applyBlur();
    assert(overlay._topActor.has_style_class_name('spotlight-high-contrast') &&
        overlay._container.get_style().includes(', 1)') && overlay._container.get_effects().length === 0,
        'high-contrast rendering is opaque and disables blur');
    overlay._stSettings = realStSettings;
    overlay._applyAppearance();
    overlay._applyBlur();
    overlay._settings.set_boolean('enable-window-search', false);
    overlay._entry.set_text('win:');
    await Scripting.sleep(120);
    assert(overlay._currentResults[0].id === 'windows:disabled', 'disabled windows provider cannot be bypassed');
    overlay._settings.set_boolean('enable-window-search', true);
    overlay._entry.set_text('~private');
    await Scripting.sleep(120);
    assert(overlay._currentResults[0].type === 'info', 'clipboard disabled by default, including explicit mode');
    overlay._settings.set_boolean('enable-clipboard-search', true);
    const clipboard = St.Clipboard.get_default();
    clipboard.set_text(St.ClipboardType.CLIPBOARD, '  private clipboard fixture  ');
    await new Promise(resolve => overlay._providers.clipboard.capture(resolve));
    const clipResult = overlay._providers.clipboard.search('', 5, {explicit: true})[0];
    assert(clipResult.type === 'clipboard', 'opt-in clipboard capture works');
    overlay._entry.set_text('~');
    overlay._flushSearch();
    overlay._activateSelected();
    await Scripting.sleep(100);
    const copied = await new Promise(resolve => clipboard.get_text(St.ClipboardType.CLIPBOARD, (_clip, text) => resolve(text)));
    assert(copied === '  private clipboard fixture  ', 'clipboard round-trip preserves whitespace');
    assert(!JSON.stringify(overlay._usageStore._data).includes('private clipboard fixture'), 'clipboard content is not learned or persisted');
    overlay._settings.set_boolean('enable-clipboard-search', false);
    assert(overlay._providers.clipboard._history.length === 0, 'disabling clipboard immediately clears its buffer');
    overlay.open();
    overlay._entry.set_text('win:');
    await Scripting.sleep(120);
    assert(overlay._currentResults.length > 0, 'window mode displays results or an empty state');
    overlay._entry.set_text('=2+2');
    press(Clutter.KEY_Return);
    await Scripting.sleep(120);
    assert(!overlay._isOpen, 'immediate Enter flushes pending search and closes');
    overlay.open();
    press(Clutter.KEY_Escape);
    await Scripting.sleep(80);
    assert(!overlay._isOpen && !overlay._grab, 'Escape releases modal grab');
    const toggleShortcut = async () => {
        keyboard.notify_keyval(GLib.get_monotonic_time(), Clutter.KEY_Super_L, Clutter.KeyState.PRESSED);
        keyboard.notify_keyval(GLib.get_monotonic_time(), Clutter.KEY_Control_L, Clutter.KeyState.PRESSED);
        press(Clutter.KEY_space);
        keyboard.notify_keyval(GLib.get_monotonic_time(), Clutter.KEY_Control_L, Clutter.KeyState.RELEASED);
        keyboard.notify_keyval(GLib.get_monotonic_time(), Clutter.KEY_Super_L, Clutter.KeyState.RELEASED);
        await Scripting.sleep(150);
    };
    await toggleShortcut();
    assert(overlay._isOpen, 'real global shortcut opens Spotlight');
    await toggleShortcut();
    assert(!overlay._isOpen, 'real global shortcut closes Spotlight while modal');
    overlay.open();
    const originalMonitor = overlay._getTargetMonitor;
    overlay._getTargetMonitor = () => ({x: 0, y: 0, width: 360, height: 640});
    overlay._relayout();
    await Scripting.sleep(100);
    assert(overlay._container.width <= 328, 'panel fits a narrow monitor');
    overlay._getTargetMonitor = originalMonitor;
    overlay._relayout();
    overlay._settings.set_boolean('animations-enabled', true);
    overlay.close();
    overlay.open();
    await Scripting.sleep(200);
    assert(overlay._isOpen && overlay._topActor.visible, 'reopening during close animation remains visible');
    overlay._entry.set_text('pending');
    instance.disable();
    await Scripting.sleep(250);
    assert(overlay._destroyed && !overlay._searchId && !overlay._activationId,
        'disable cancels pending work');
    instance.enable();
    instance._overlay.open();
    assert(instance._overlay._isOpen, 'extension can be enabled again');
    instance.disable();
    // All launch handlers and MIME preferences live in the test tool's
    // temporary XDG directories; this never changes the real user's defaults.
    const fixtureDirectory = Gio.File.new_for_path(GLib.get_user_data_dir()).get_child('spotlight-fixture');
    fixtureDirectory.make_directory_with_parents(null);
    const script = fixtureDirectory.get_child('handler.py');
    script.replace_contents('import pathlib,sys\npathlib.Path(sys.argv[1]).write_text(sys.argv[-1])\n',
        null, false, Gio.FileCreateFlags.NONE, null);
    const marker = fixtureDirectory.get_child('launched.txt');
    const applications = Gio.File.new_for_path(GLib.get_user_data_dir()).get_child('applications');
    try { applications.make_directory_with_parents(null); } catch (error) {
        if (!error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.EXISTS)) throw error;
    }
    const desktop = applications.get_child('spotlight-fixture.desktop');
    desktop.replace_contents(`[Desktop Entry]\nType=Application\nName=Spotlight Fixture\nExec=/usr/bin/python3 ${script.get_path()} ${marker.get_path()} %u\nMimeType=text/plain;inode/directory;x-scheme-handler/https;\nNoDisplay=true\n`,
        null, false, Gio.FileCreateFlags.NONE, null);
    const appInfo = Gio.DesktopAppInfo.new_from_filename(desktop.get_path());
    for (const type of ['text/plain', 'inode/directory', 'x-scheme-handler/https']) {
        appInfo.set_as_default_for_type(type);
        for (let attempt = 0; attempt < 100 && Gio.AppInfo.get_default_for_type(type, false)?.get_id() !== appInfo.get_id(); attempt++)
            await Scripting.sleep(30);
        assert(Gio.AppInfo.get_default_for_type(type, false)?.get_id() === appInfo.get_id(),
            `temporary handler registered for ${type}`);
    }
    instance.enable();
    const providers = instance._overlay._providers;
    const waitForLaunch = async () => {
        for (let index = 0; index < 100 && !marker.query_exists(null); index++)
            await Scripting.sleep(30);
        assert(marker.query_exists(null), 'native launch handler completed');
        const [, data] = marker.load_contents(null);
        marker.delete(null);
        return new TextDecoder().decode(data);
    };
    const appResult = providers.apps._toResult({id: 'spotlight-fixture.desktop', name: 'Spotlight Fixture', appInfo}, 100);
    appResult.activate();
    await waitForLaunch();
    appResult.actions.new();
    await waitForLaunch();
    assert(true, 'application launch and new-instance fallback execute successfully');
    const document = fixtureDirectory.get_child('test-document.txt');
    document.replace_contents('Spotlight fixture', null, false, Gio.FileCreateFlags.NONE, null);
    const entry = {id: document.get_path(), file: document, path: document.get_path(), name: 'test-document.txt', isDirectory: false};
    providers.files._toResult(entry, 100).activate();
    assert((await waitForLaunch()).includes('test-document.txt'), 'file result opens through the default application');
    providers.files._openContainingFolder(entry);
    assert((await waitForLaunch()).includes('spotlight-fixture'), 'containing-folder fallback opens through its handler');
    instance._settings.set_string('web-engine', 'duckduckgo');
    providers.web.search('hello & world')[0].activate();
    assert((await waitForLaunch()) === 'https://duckduckgo.com/?q=hello%20%26%20world', 'web activation sends the encoded query to the selected engine');
    const runningDesktop = applications.get_child('org.gnome.Shell.PerfHelper.desktop');
    runningDesktop.replace_contents('[Desktop Entry]\nType=Application\nName=Spotlight Running Fixture\nExec=/usr/lib/gnome-shell-perf-helper\nStartupWMClass=org.gnome.Shell.PerfHelper\n',
        null, false, Gio.FileCreateFlags.NONE, null);
    for (let attempt = 0; attempt < 400 && !providers.apps._cacheById.has('org.gnome.Shell.PerfHelper.desktop'); attempt++)
        await Scripting.sleep(30);
    assert(providers.apps._cacheById.has('org.gnome.Shell.PerfHelper.desktop'), 'running-app fixture is discoverable through app search');
    await Scripting.createTestWindow({width: 400, height: 300, textInput: true});
    await Scripting.createTestWindow({width: 420, height: 320, textInput: true});
    await Scripting.waitTestWindows();
    Main.overview.hide();
    await Scripting.sleep(250);
    const targetWindow = global.get_window_actors().map(actor => actor.meta_window)
        .find(window => window.get_wm_class() === 'org.gnome.Shell.PerfHelper' && window !== global.display.focus_window);
    assert(Boolean(targetWindow), 'two real windows provide a switch target');
    const targetId = `window:${targetWindow.get_id()}`;
    const windowResult = providers.windows.search('', 20).find(result => result.id === targetId);
    assert(Boolean(windowResult), 'window provider discovers a real test window');
    instance._settings.set_boolean('animations-enabled', false);
    instance._overlay.open({initialText: 'win:'});
    await Scripting.sleep(150);
    instance._overlay._setSelectedIndex(instance._overlay._currentResults.findIndex(result => result.id === targetId));
    press(Clutter.KEY_Return);
    await Scripting.sleep(600);

    assert(global.display.focus_window === targetWindow, 'window activation switches focus to the selected window');
    const runningApp = Shell.AppSystem.get_default().lookup_app('org.gnome.Shell.PerfHelper.desktop');
    assert(runningApp.get_windows().length === 2, 'app result resolves to its two existing windows');
    Main.overview.show();
    await Scripting.sleep(350);
    instance._overlay.open({initialText: '@Spotlight Running Fixture'});
    await Scripting.sleep(150);
    const appIndex = instance._overlay._currentResults.findIndex(result => result.id === 'app:org.gnome.Shell.PerfHelper.desktop');
    assert(appIndex >= 0, 'running application can be selected from Apps mode');
    instance._overlay._setSelectedIndex(appIndex);
    press(Clutter.KEY_Return);
    await Scripting.sleep(600);
    assert(!Main.overview.visible && runningApp.get_windows().includes(global.display.focus_window),
        'activating a running app exits overview and focuses an existing window');
    assert(runningApp.get_windows().length === 2, 'default app activation does not create another window');
    const activateRunningApp = async () => {
        instance._overlay.open({initialText: '@Spotlight Running Fixture'});
        await Scripting.sleep(150);
        const index = instance._overlay._currentResults.findIndex(result => result.id === 'app:org.gnome.Shell.PerfHelper.desktop');
        if (index < 0)
            throw new Error('Running app disappeared from search');
        instance._overlay._setSelectedIndex(index);
        press(Clutter.KEY_Return);
        await Scripting.sleep(600);
    };
    for (const window of runningApp.get_windows())
        window.minimize();
    await Scripting.sleep(150);
    await activateRunningApp();
    assert(runningApp.get_windows().includes(global.display.focus_window) && !global.display.focus_window.minimized,
        'activating a minimized app restores and focuses its window');
    const originalWorkspace = global.workspace_manager.get_active_workspace();
    const otherWorkspace = global.workspace_manager.get_workspace_by_index(originalWorkspace.index() + 1)
        ?? global.workspace_manager.append_new_workspace(false, global.get_current_time());
    for (const window of runningApp.get_windows())
        window.change_workspace(otherWorkspace);
    originalWorkspace.activate(global.get_current_time());
    await Scripting.sleep(250);
    await activateRunningApp();
    assert(global.workspace_manager.get_active_workspace() === otherWorkspace
        && runningApp.get_windows().includes(global.display.focus_window),
    'activating an app on another workspace switches workspace and focuses its window');
    assert(runningApp.get_windows().length === 2, 'restoring and switching workspaces reuse existing app windows');
    await Scripting.destroyTestWindows();
    if (instance._overlay)
        instance.disable();
    const launcher = new Gio.SubprocessLauncher({flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE});
    launcher.setenv('GSETTINGS_BACKEND', 'memory', true);
    launcher.setenv('GI_TYPELIB_PATH', '/usr/lib/gnome-shell/girepository-1.0', true);
    launcher.setenv('LD_LIBRARY_PATH', '/usr/lib/gnome-shell', true);
    const extensionDirectory = Gio.File.new_for_uri(import.meta.url).get_parent().get_parent();
    launcher.set_cwd(extensionDirectory.get_path());
    const process = launcher.spawnv(['gjs', '-m', extensionDirectory.get_child('tests/prefs-smoke.js').get_path()]);
    const [, stdout, stderr] = await new Promise((resolve, reject) => {
        process.communicate_utf8_async(null, null, (source, result) => {
            try { resolve(source.communicate_utf8_finish(result)); } catch (error) { reject(error); }
        });
    });
    if (!process.get_successful())
        throw new Error(`Preferences failed: ${stderr}`);
    assert(stdout.includes('SPOTLIGHT_PREFS_SMOKE_OK'), 'GTK preferences open, update, and clean up');
    console.log('SPOTLIGHT_SHELL_SMOKE_OK');
}
