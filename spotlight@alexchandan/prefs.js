/* SPDX-License-Identifier: GPL-3.0-or-later */

import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const WEB_ENGINES = [
    ['google', 'Google'], ['duckduckgo', 'DuckDuckGo'], ['brave', 'Brave Search'],
    ['bing', 'Bing'], ['custom', 'Custom URL'],
];
const THEME_MODES = [['system', 'Follow system'], ['dark', 'Dark'], ['light', 'Light']];
const DENSITY_MODES = [['comfortable', 'Comfortable'], ['compact', 'Compact']];
const PROVIDERS = new Map([
    ['apps', 'Applications'], ['files', 'Files'], ['windows', 'Open Windows'],
    ['settings', 'GNOME Settings'], ['calculator', 'Calculator'], ['system', 'System Actions'],
    ['clipboard', 'Clipboard'], ['web', 'Web Search'],
]);
const SETTINGS_KEYS = [
    'toggle-shortcut', 'selected-text-shortcut', 'result-count', 'panel-width',
    'result-density', 'show-category-badges', 'web-engine', 'custom-search-url',
    'show-web-search', 'enable-window-search', 'enable-file-search',
    'enable-settings-search', 'enable-clipboard-search', 'file-index-limit',
    'provider-order', 'prefer-exact-matches', 'learn-ranking', 'boost-running-apps',
    'boost-favorite-apps', 'boost-recent-results', 'query-history-enabled',
    'theme-mode', 'blur-enabled', 'blur-strength', 'background-opacity',
    'animations-enabled',
];

export default class SpotlightPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        window.set_default_size(680, 780);

        const page = new Adw.PreferencesPage({title: 'Spotlight', icon_name: 'edit-find-symbolic'});
        window.add(page);

        this._addShortcutGroup(page, window, settings);
        this._addSearchGroup(page, settings);
        this._addRankingGroup(page, settings);
        this._addProvidersGroup(page, settings);
        this._addProviderOrderGroup(page, settings);
        this._addAppearanceGroup(page, settings);
        this._addHistoryGroup(page, window, settings);
        this._addResetGroup(page, window, settings);
        this._addAboutGroup(page);
    }

    _addShortcutGroup(page, window, settings) {
        const group = new Adw.PreferencesGroup({
            title: 'Keyboard Shortcuts',
            description: 'Every global shortcut must contain a modifier plus another key.',
        });
        page.add(group);
        this._addShortcutRow(group, window, settings, 'toggle-shortcut', 'Toggle Spotlight',
            'Open or close Spotlight from anywhere.');
        this._addShortcutRow(group, window, settings, 'selected-text-shortcut', 'Search selected text',
            'Optional shortcut that opens Spotlight with the current primary text selection.');
    }

    _addShortcutRow(group, window, settings, key, title, subtitle) {
        const row = new Adw.ActionRow({title, subtitle});
        group.add(row);
        const label = new Gtk.ShortcutLabel({
            disabled_text: 'Disabled', accelerator: settings.get_strv(key)[0] || '', valign: Gtk.Align.CENTER,
        });
        row.add_suffix(label);

        const reset = new Gtk.Button({icon_name: 'edit-undo-symbolic', tooltip_text: 'Reset shortcut', valign: Gtk.Align.CENTER, css_classes: ['flat']});
        const edit = new Gtk.Button({icon_name: 'document-edit-symbolic', tooltip_text: 'Change shortcut', valign: Gtk.Align.CENTER, css_classes: ['flat']});
        row.add_suffix(reset); row.add_suffix(edit);

        const changedId = settings.connect(`changed::${key}`, () =>
            label.set_accelerator(settings.get_strv(key)[0] || ''));
        window.connect('close-request', () => {
            try { settings.disconnect(changedId); } catch (_error) {}
            return false;
        });
        reset.connect('clicked', () => settings.reset(key));
        edit.connect('clicked', () => this._showShortcutDialog(window, settings, key, title));
    }

    _showShortcutDialog(window, settings, key, title) {
        const original = settings.get_strv(key);
        let pending = original[0] || '';
        settings.set_strv(key, []);

        const dialog = new Gtk.Dialog({title, transient_for: window, modal: true});
        dialog.add_button('Cancel', Gtk.ResponseType.CANCEL);
        dialog.add_button('Apply', Gtk.ResponseType.OK);
        dialog.set_default_response(Gtk.ResponseType.OK);

        const content = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL, spacing: 14,
            margin_top: 24, margin_bottom: 24, margin_start: 24, margin_end: 24,
        });
        content.append(new Gtk.Label({label: 'Press the shortcut you want to use', wrap: true, xalign: 0, css_classes: ['title-3']}));
        content.append(new Gtk.Label({
            label: 'Use at least two keys, such as Super + Space. Backspace disables it; Escape cancels.',
            wrap: true, xalign: 0, css_classes: ['dim-label'],
        }));
        const validation = new Gtk.Label({label: '', wrap: true, xalign: 0, visible: false, css_classes: ['error']});
        content.append(validation);
        const shortcut = new Gtk.ShortcutLabel({disabled_text: 'Disabled', accelerator: pending, halign: Gtk.Align.CENTER, margin_top: 16, margin_bottom: 16});
        content.append(shortcut);
        dialog.get_content_area().append(content);

        const controller = new Gtk.EventControllerKey();
        controller.set_propagation_phase(Gtk.PropagationPhase.CAPTURE);
        dialog.add_controller(controller);
        controller.connect('key-pressed', (_controller, keyval, keycode, state) => {
            if (keyval === Gdk.KEY_Escape) {
                dialog.response(Gtk.ResponseType.CANCEL);
                return Gdk.EVENT_STOP;
            }
            const mask = state & Gtk.accelerator_get_default_mod_mask();
            if (keyval === Gdk.KEY_BackSpace && mask === 0) {
                pending = ''; shortcut.set_accelerator(''); validation.visible = false;
                return Gdk.EVENT_STOP;
            }
            if (!Gtk.accelerator_valid(keyval, mask) || mask === 0) {
                validation.label = 'Use a modifier plus another key, for example Super + Space.';
                validation.visible = true;
                return Gdk.EVENT_STOP;
            }
            validation.visible = false;
            pending = Gtk.accelerator_name_with_keycode(null, keyval, keycode, mask);
            shortcut.set_accelerator(pending);
            return Gdk.EVENT_STOP;
        });
        dialog.connect('response', (_dialog, response) => {
            settings.set_strv(key, response === Gtk.ResponseType.OK && pending ? [pending] :
                response === Gtk.ResponseType.OK ? [] : original);
            dialog.destroy();
        });
        dialog.present();
    }

    _addSearchGroup(page, settings) {
        const group = new Adw.PreferencesGroup({title: 'Search', description: 'General result and web-search behavior.'});
        page.add(group);
        const count = new Adw.SpinRow({
            title: 'Maximum results', subtitle: 'Total visible results, including web search',
            adjustment: new Gtk.Adjustment({lower: 3, upper: 20, step_increment: 1, page_increment: 1, value: settings.get_int('result-count')}),
        });
        group.add(count); settings.bind('result-count', count, 'value', Gio.SettingsBindFlags.DEFAULT);

        const engineModel = Gtk.StringList.new(WEB_ENGINES.map(([, label]) => label));
        const engine = new Adw.ComboRow({title: 'Web search engine', model: engineModel});
        const syncEngine = () => engine.selected = Math.max(0, WEB_ENGINES.findIndex(([id]) => id === settings.get_string('web-engine')));
        syncEngine(); group.add(engine);
        engine.connect('notify::selected', () => settings.set_string('web-engine', WEB_ENGINES[engine.selected]?.[0] ?? 'google'));
        settings.connect('changed::web-engine', syncEngine);

        const custom = new Adw.EntryRow({title: 'Custom search URL', text: settings.get_string('custom-search-url')});
        custom.add_prefix(new Gtk.Image({icon_name: 'insert-link-symbolic'})); group.add(custom);
        settings.bind('custom-search-url', custom, 'text', Gio.SettingsBindFlags.DEFAULT);
        const syncCustom = () => custom.sensitive = settings.get_string('web-engine') === 'custom';
        syncCustom(); settings.connect('changed::web-engine', syncCustom);
        group.add(this._switch(settings, 'show-web-search', 'Always show web search', 'Keep web search as the last normal-search result.'));
        group.add(this._switch(settings, 'show-category-badges', 'Category badges', 'Show APP, FILE, WINDOW, and other small result labels.'));
    }

    _addRankingGroup(page, settings) {
        const group = new Adw.PreferencesGroup({
            title: 'Search Intelligence',
            description: 'Relevance stays primary; these preferences only add small ranking signals.',
        });
        page.add(group);
        group.add(this._switch(settings, 'prefer-exact-matches', 'Prefer exact matches', 'Give exact, word-prefix, and acronym matches a stronger boost.'));
        group.add(this._switch(settings, 'learn-ranking', 'Learn from usage', 'Locally learn which results you choose for similar searches.'));
        group.add(this._switch(settings, 'boost-running-apps', 'Boost running applications', 'Prefer matching apps that already have windows open.'));
        group.add(this._switch(settings, 'boost-favorite-apps', 'Boost favorite applications', 'Prefer matching apps pinned to GNOME favorites.'));
        group.add(this._switch(settings, 'boost-recent-results', 'Boost recent/frequent items', 'Use GNOME app usage plus local recent selections as a small signal.'));
        group.add(this._switch(settings, 'query-history-enabled', 'Query history', 'Use Ctrl + Up/Down in Spotlight to browse recent searches.'));
    }

    _addProvidersGroup(page, settings) {
        const group = new Adw.PreferencesGroup({title: 'Search Providers', description: 'Apps, calculator, system actions, and web modes remain available.'});
        page.add(group);
        group.add(this._switch(settings, 'enable-window-search', 'Open windows', 'Find and focus a window by title or application.'));
        group.add(this._switch(settings, 'enable-file-search', 'Local files', 'Incrementally index common folders locally.'));
        group.add(this._switch(settings, 'enable-settings-search', 'GNOME Settings', 'Search control-center panels.'));
        group.add(this._switch(settings, 'enable-clipboard-search', 'Clipboard history', 'Session-only text history; nothing is written to disk.'));
        const limit = new Adw.SpinRow({
            title: 'File index limit', subtitle: 'Maximum local file and folder names kept in memory',
            adjustment: new Gtk.Adjustment({lower: 500, upper: 10000, step_increment: 250, page_increment: 1000, value: settings.get_int('file-index-limit')}),
        });
        group.add(limit); settings.bind('file-index-limit', limit, 'value', Gio.SettingsBindFlags.DEFAULT);
    }

    _addProviderOrderGroup(page, settings) {
        const group = new Adw.PreferencesGroup({
            title: 'Provider Preference',
            description: 'Move providers up or down. This is a soft preference; a much better match can still outrank it.',
        });
        page.add(group);
        const list = new Gtk.ListBox({selection_mode: Gtk.SelectionMode.NONE, css_classes: ['boxed-list']});
        group.add(list);

        const render = () => {
            let child = list.get_first_child();
            while (child) {
                const next = child.get_next_sibling();
                list.remove(child); child = next;
            }
            const order = settings.get_strv('provider-order').filter(id => PROVIDERS.has(id));
            for (const id of PROVIDERS.keys()) if (!order.includes(id)) order.push(id);

            order.forEach((id, index) => {
                const row = new Adw.ActionRow({title: PROVIDERS.get(id), subtitle: `Priority ${index + 1}`});
                const up = new Gtk.Button({icon_name: 'go-up-symbolic', valign: Gtk.Align.CENTER, sensitive: index > 0, css_classes: ['flat']});
                const down = new Gtk.Button({icon_name: 'go-down-symbolic', valign: Gtk.Align.CENTER, sensitive: index < order.length - 1, css_classes: ['flat']});
                row.add_suffix(up); row.add_suffix(down); list.append(row);
                up.connect('clicked', () => this._moveProvider(settings, order, index, -1));
                down.connect('clicked', () => this._moveProvider(settings, order, index, 1));
            });
        };
        render(); settings.connect('changed::provider-order', render);
    }

    _moveProvider(settings, currentOrder, index, direction) {
        const next = index + direction;
        if (next < 0 || next >= currentOrder.length) return;
        const order = [...currentOrder];
        [order[index], order[next]] = [order[next], order[index]];
        settings.set_strv('provider-order', order);
    }

    _addAppearanceGroup(page, settings) {
        const group = new Adw.PreferencesGroup({title: 'Appearance', description: 'Keep Spotlight compact or make it roomier.'});
        page.add(group);
        this._combo(group, settings, 'theme-mode', 'Theme', THEME_MODES);
        this._combo(group, settings, 'result-density', 'Result density', DENSITY_MODES);
        const width = new Adw.SpinRow({
            title: 'Panel width', subtitle: 'Automatically capped to the current monitor',
            adjustment: new Gtk.Adjustment({lower: 420, upper: 900, step_increment: 20, page_increment: 100, value: settings.get_int('panel-width')}),
        });
        group.add(width); settings.bind('panel-width', width, 'value', Gio.SettingsBindFlags.DEFAULT);
        group.add(this._switch(settings, 'blur-enabled', 'Background blur', 'Use GNOME Shell backdrop blur when available.'));
        const blur = new Adw.SpinRow({title: 'Blur strength', adjustment: new Gtk.Adjustment({lower: 0, upper: 40, step_increment: 1, page_increment: 5, value: settings.get_int('blur-strength')})});
        group.add(blur); settings.bind('blur-strength', blur, 'value', Gio.SettingsBindFlags.DEFAULT);
        const opacity = new Adw.SpinRow({
            title: 'Card opacity', digits: 2,
            adjustment: new Gtk.Adjustment({lower: 0.35, upper: 1, step_increment: 0.05, page_increment: 0.1, value: settings.get_double('background-opacity')}),
        });
        group.add(opacity); settings.bind('background-opacity', opacity, 'value', Gio.SettingsBindFlags.DEFAULT);
        group.add(this._switch(settings, 'animations-enabled', 'Animations', 'Also respects GNOME reduced-motion and animation preferences.'));
    }

    _addHistoryGroup(page, window, settings) {
        const group = new Adw.PreferencesGroup({title: 'Local History', description: 'Ranking/query history stays on this device.'});
        page.add(group);
        const row = new Adw.ActionRow({title: 'Clear learned history', subtitle: 'Removes saved queries and selected-result learning data.'});
        const button = new Gtk.Button({label: 'Clear History', valign: Gtk.Align.CENTER});
        row.add_suffix(button); row.activatable_widget = button; group.add(row);
        button.connect('clicked', () => {
            const dialog = new Adw.MessageDialog({transient_for: window, heading: 'Clear Spotlight history?', body: 'This removes locally stored search learning and query history.'});
            dialog.add_response('cancel', 'Cancel'); dialog.add_response('clear', 'Clear');
            dialog.set_default_response('cancel'); dialog.set_close_response('cancel');
            dialog.set_response_appearance('clear', Adw.ResponseAppearance.DESTRUCTIVE);
            dialog.connect('response', (_d, response) => {
                if (response !== 'clear') return;
                const path = GLib.build_filenamev([GLib.get_user_data_dir(), 'spotlight@alexchandan', 'usage.json']);
                try { Gio.File.new_for_path(path).delete(null); } catch (_error) {}
                settings.set_int('history-clear-token', settings.get_int('history-clear-token') + 1);
            });
            dialog.present();
        });
    }

    _addResetGroup(page, window, settings) {
        const group = new Adw.PreferencesGroup({title: 'Defaults'}); page.add(group);
        const row = new Adw.ActionRow({title: 'Reset all settings', subtitle: 'Restore shortcuts, ranking, providers, web search, and appearance.'});
        const button = new Gtk.Button({label: 'Reset to Defaults', valign: Gtk.Align.CENTER, css_classes: ['destructive-action']});
        row.add_suffix(button); row.activatable_widget = button; group.add(row);
        button.connect('clicked', () => {
            const dialog = new Adw.MessageDialog({transient_for: window, heading: 'Reset all Spotlight settings?', body: 'Your local learned history is not deleted.'});
            dialog.add_response('cancel', 'Cancel'); dialog.add_response('reset', 'Reset');
            dialog.set_default_response('cancel'); dialog.set_close_response('cancel');
            dialog.set_response_appearance('reset', Adw.ResponseAppearance.DESTRUCTIVE);
            dialog.connect('response', (_d, response) => {
                if (response === 'reset') for (const key of SETTINGS_KEYS) settings.reset(key);
            });
            dialog.present();
        });
    }

    _combo(group, settings, key, title, options) {
        const row = new Adw.ComboRow({title, model: Gtk.StringList.new(options.map(([, label]) => label))});
        const sync = () => row.selected = Math.max(0, options.findIndex(([id]) => id === settings.get_string(key)));
        sync(); group.add(row);
        row.connect('notify::selected', () => settings.set_string(key, options[row.selected]?.[0] ?? options[0][0]));
        settings.connect(`changed::${key}`, sync);
        return row;
    }

    _switch(settings, key, title, subtitle) {
        const row = new Adw.ActionRow({title, subtitle});
        const toggle = new Gtk.Switch({valign: Gtk.Align.CENTER});
        row.add_suffix(toggle); row.activatable_widget = toggle;
        settings.bind(key, toggle, 'active', Gio.SettingsBindFlags.DEFAULT);
        return row;
    }

    _addAboutGroup(page) {
        const group = new Adw.PreferencesGroup({title: 'Tips'}); page.add(group);
        group.add(new Adw.ActionRow({title: 'Quick modes', subtitle: '@ apps   # files   ! system   ? web   ~ clipboard   = calculator'}));
        group.add(new Adw.ActionRow({title: 'Result actions', subtitle: 'Enter open/switch · Ctrl+Enter new/reveal · Shift+Enter reveal · Alt+Enter app details'}));
        group.add(new Adw.ActionRow({title: 'Query history', subtitle: 'Ctrl + Up / Down cycles through recent searches.'}));
        group.add(new Adw.ActionRow({title: 'Privacy', subtitle: 'File indexing and learned history stay local; clipboard history is session-only.'}));
    }
}
