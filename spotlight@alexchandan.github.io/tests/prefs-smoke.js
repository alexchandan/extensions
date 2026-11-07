/* SPDX-License-Identifier: GPL-3.0-or-later */
import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

Gio.resources_register(Gio.Resource.load('/usr/share/gnome-shell/org.gnome.Shell.Extensions.src.gresource'));
// Register the service resources before loading its ESM base class.
const {default: Preferences} = await import('../prefs.js');
const directory = Gio.File.new_for_uri(import.meta.url).get_parent().get_parent();
const [, bytes] = directory.get_child('metadata.json').load_contents(null);
const metadata = {...JSON.parse(new TextDecoder().decode(bytes)), dir: directory, path: directory.get_path()};
Adw.init();
const preferences = new Preferences(metadata);
const window = new Adw.PreferencesWindow();
preferences.fillPreferencesWindow(window);
window.present();
const loop = new GLib.MainLoop(null, false);
GLib.timeout_add(GLib.PRIORITY_DEFAULT, 300, () => {
    const settings = preferences.getSettings();
    settings.set_string('theme-mode', 'dark');
    settings.set_string('web-engine', 'custom');
    settings.set_strv('provider-order', ['files', 'apps', 'files', 'invalid']);
    if (!window.get_visible())
        throw new Error('Preferences failed to open');
    window.close();
    if (preferences._signalIds.length !== 0)
        throw new Error('Preferences settings signals leaked');
    print('SPOTLIGHT_PREFS_SMOKE_OK');
    loop.quit();
    return GLib.SOURCE_REMOVE;
});
loop.run();
