/* SPDX-License-Identifier: GPL-3.0-or-later */

import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const WEB_ENGINES = [
    ['google', 'Google'],
    ['duckduckgo', 'DuckDuckGo'],
    ['brave', 'Brave Search'],
    ['bing', 'Bing'],
    ['custom', 'Custom URL'],
];

const THEME_MODES = [
    ['system', 'Follow system'],
    ['dark', 'Dark'],
    ['light', 'Light'],
];

const SETTINGS_KEYS = [
    'toggle-shortcut',
    'result-count',
    'web-engine',
    'custom-search-url',
    'show-web-search',
    'enable-window-search',
    'enable-file-search',
    'enable-settings-search',
    'file-index-limit',
    'theme-mode',
    'blur-enabled',
    'blur-strength',
    'background-opacity',
    'animations-enabled',
];

export default class SpotlightPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        window.set_default_size(640, 720);

        const page = new Adw.PreferencesPage({
            title: 'Spotlight',
            icon_name: 'edit-find-symbolic',
        });
        window.add(page);

        this._addShortcutGroup(page, window, settings);
        this._addSearchGroup(page, settings);
        this._addProvidersGroup(page, settings);
        this._addAppearanceGroup(page, settings);
        this._addResetGroup(page, window, settings);
        this._addAboutGroup(page);
    }

    _addShortcutGroup(page, window, settings) {
        const group = new Adw.PreferencesGroup({
            title: 'Keyboard Shortcut',
            description: 'Open Spotlight from anywhere in the GNOME session.',
        });
        page.add(group);

        const row = new Adw.ActionRow({
            title: 'Toggle Spotlight',
            subtitle: 'Click the edit button, then press the new key combination.',
        });
        group.add(row);

        const label = new Gtk.ShortcutLabel({
            disabled_text: 'Disabled',
            accelerator: settings.get_strv('toggle-shortcut')[0] || '',
            valign: Gtk.Align.CENTER,
        });
        row.add_suffix(label);

        const resetButton = new Gtk.Button({
            icon_name: 'edit-undo-symbolic',
            tooltip_text: 'Reset shortcut',
            valign: Gtk.Align.CENTER,
            css_classes: ['flat'],
        });
        row.add_suffix(resetButton);

        const editButton = new Gtk.Button({
            icon_name: 'document-edit-symbolic',
            tooltip_text: 'Change shortcut',
            valign: Gtk.Align.CENTER,
            css_classes: ['flat'],
        });
        row.add_suffix(editButton);

        const updateLabel = () =>
            label.set_accelerator(settings.get_strv('toggle-shortcut')[0] || '');
        const changedId = settings.connect('changed::toggle-shortcut', updateLabel);
        window.connect('close-request', () => {
            if (changedId)
                settings.disconnect(changedId);
            return false;
        });

        resetButton.connect('clicked', () => settings.reset('toggle-shortcut'));
        editButton.connect('clicked', () =>
            this._showShortcutDialog(window, settings));
    }

    _showShortcutDialog(window, settings) {
        const original = settings.get_strv('toggle-shortcut');
        let pending = original[0] || '';

        // Temporarily remove the Shell binding so pressing the old shortcut
        // while recording does not open the overlay behind this dialog.
        settings.set_strv('toggle-shortcut', []);

        const dialog = new Gtk.Dialog({
            title: 'Set Spotlight Shortcut',
            transient_for: window,
            modal: true,
        });
        dialog.add_button('Cancel', Gtk.ResponseType.CANCEL);
        dialog.add_button('Apply', Gtk.ResponseType.OK);
        dialog.set_default_response(Gtk.ResponseType.OK);

        const content = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 14,
            margin_top: 24,
            margin_bottom: 24,
            margin_start: 24,
            margin_end: 24,
        });

        content.append(new Gtk.Label({
            label: 'Press the shortcut you want to use',
            wrap: true,
            xalign: 0,
            css_classes: ['title-3'],
        }));
        content.append(new Gtk.Label({
            label: 'Use at least two keys (for example, Super + Space). Press Backspace to disable, or Escape to cancel.',
            wrap: true,
            xalign: 0,
            css_classes: ['dim-label'],
        }));

        const validationLabel = new Gtk.Label({
            label: '',
            wrap: true,
            xalign: 0,
            visible: false,
            css_classes: ['error'],
        });
        content.append(validationLabel);

        const shortcutLabel = new Gtk.ShortcutLabel({
            disabled_text: 'Disabled',
            accelerator: pending,
            halign: Gtk.Align.CENTER,
            margin_top: 16,
            margin_bottom: 16,
        });
        content.append(shortcutLabel);
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
                pending = '';
                shortcutLabel.set_accelerator('');
                return Gdk.EVENT_STOP;
            }

            if (!Gtk.accelerator_valid(keyval, mask)) {
                validationLabel.label = 'That key cannot be used as a shortcut.';
                validationLabel.visible = true;
                return Gdk.EVENT_STOP;
            }

            // Require a real key combination: one modifier plus another key.
            // This prevents single-letter, single-number, function-key, and
            // other one-key global shortcuts from stealing normal input.
            if (mask === 0) {
                validationLabel.label = 'Shortcut must use at least two keys, such as Super + Space.';
                validationLabel.visible = true;
                return Gdk.EVENT_STOP;
            }

            validationLabel.visible = false;
            pending = Gtk.accelerator_name_with_keycode(
                null,
                keyval,
                keycode,
                mask
            );
            shortcutLabel.set_accelerator(pending);
            return Gdk.EVENT_STOP;
        });

        dialog.connect('response', (_dialog, response) => {
            if (response === Gtk.ResponseType.OK)
                settings.set_strv('toggle-shortcut', pending ? [pending] : []);
            else
                settings.set_strv('toggle-shortcut', original);

            dialog.destroy();
        });

        dialog.present();
    }

    _addSearchGroup(page, settings) {
        const group = new Adw.PreferencesGroup({
            title: 'Search',
            description: 'Control ranking output and web fallback behavior.',
        });
        page.add(group);

        const countRow = new Adw.SpinRow({
            title: 'Maximum results',
            subtitle: 'Total number of visible results, including web search',
            adjustment: new Gtk.Adjustment({
                lower: 3,
                upper: 20,
                step_increment: 1,
                page_increment: 1,
                value: settings.get_int('result-count'),
            }),
        });
        group.add(countRow);
        settings.bind(
            'result-count',
            countRow,
            'value',
            Gio.SettingsBindFlags.DEFAULT
        );

        const engineModel = Gtk.StringList.new(WEB_ENGINES.map(([, label]) => label));
        const engineRow = new Adw.ComboRow({
            title: 'Web search engine',
            model: engineModel,
        });
        engineRow.selected = Math.max(
            0,
            WEB_ENGINES.findIndex(([id]) => id === settings.get_string('web-engine'))
        );
        group.add(engineRow);
        engineRow.connect('notify::selected', () => {
            const engine = WEB_ENGINES[engineRow.selected]?.[0] ?? 'google';
            settings.set_string('web-engine', engine);
        });
        settings.connect('changed::web-engine', () => {
            const index = WEB_ENGINES.findIndex(
                ([id]) => id === settings.get_string('web-engine')
            );
            engineRow.selected = Math.max(0, index);
        });

        const customUrlRow = new Adw.EntryRow({
            title: 'Custom search URL',
            text: settings.get_string('custom-search-url'),
        });
        customUrlRow.add_prefix(new Gtk.Image({
            icon_name: 'insert-link-symbolic',
            tooltip_text: 'Use %s where the encoded query should be inserted',
        }));
        group.add(customUrlRow);
        settings.bind(
            'custom-search-url',
            customUrlRow,
            'text',
            Gio.SettingsBindFlags.DEFAULT
        );
        const syncCustomRow = () => {
            customUrlRow.sensitive = settings.get_string('web-engine') === 'custom';
        };
        syncCustomRow();
        engineRow.connect('notify::selected', syncCustomRow);
        customUrlRow.set_tooltip_text('Example: https://search.example/?q=%s');

        group.add(this._createSwitchRow(
            settings,
            'show-web-search',
            'Always show web search',
            'Keep web search as the final result when using normal search.'
        ));
    }

    _addProvidersGroup(page, settings) {
        const group = new Adw.PreferencesGroup({
            title: 'Search Providers',
            description: 'Apps, calculator, and system actions are always enabled.',
        });
        page.add(group);

        group.add(this._createSwitchRow(
            settings,
            'enable-window-search',
            'Open windows',
            'Find a window by its title or application name.'
        ));
        group.add(this._createSwitchRow(
            settings,
            'enable-file-search',
            'Local files',
            'Incrementally index common folders without sending filenames anywhere.'
        ));
        group.add(this._createSwitchRow(
            settings,
            'enable-settings-search',
            'GNOME Settings',
            'Include control-center panels such as Bluetooth and Displays.'
        ));

        const indexLimitRow = new Adw.SpinRow({
            title: 'File index limit',
            subtitle: 'Maximum local file and folder names kept in memory',
            adjustment: new Gtk.Adjustment({
                lower: 500,
                upper: 10000,
                step_increment: 250,
                page_increment: 1000,
                value: settings.get_int('file-index-limit'),
            }),
        });
        group.add(indexLimitRow);
        settings.bind(
            'file-index-limit',
            indexLimitRow,
            'value',
            Gio.SettingsBindFlags.DEFAULT
        );
    }

    _addAppearanceGroup(page, settings) {
        const group = new Adw.PreferencesGroup({
            title: 'Appearance',
            description: 'Tune the translucent Spotlight card and motion.',
        });
        page.add(group);

        const themeModel = Gtk.StringList.new(THEME_MODES.map(([, label]) => label));
        const themeRow = new Adw.ComboRow({
            title: 'Theme',
            model: themeModel,
        });
        themeRow.selected = Math.max(
            0,
            THEME_MODES.findIndex(([id]) => id === settings.get_string('theme-mode'))
        );
        group.add(themeRow);
        themeRow.connect('notify::selected', () => {
            const mode = THEME_MODES[themeRow.selected]?.[0] ?? 'system';
            settings.set_string('theme-mode', mode);
        });
        settings.connect('changed::theme-mode', () => {
            const index = THEME_MODES.findIndex(
                ([id]) => id === settings.get_string('theme-mode')
            );
            themeRow.selected = Math.max(0, index);
        });

        const blurRow = this._createSwitchRow(
            settings,
            'blur-enabled',
            'Background blur',
            'Use GNOME Shell’s native backdrop blur when available.'
        );
        group.add(blurRow);

        const blurStrengthRow = new Adw.SpinRow({
            title: 'Blur strength',
            adjustment: new Gtk.Adjustment({
                lower: 0,
                upper: 40,
                step_increment: 1,
                page_increment: 5,
                value: settings.get_int('blur-strength'),
            }),
        });
        group.add(blurStrengthRow);
        settings.bind(
            'blur-strength',
            blurStrengthRow,
            'value',
            Gio.SettingsBindFlags.DEFAULT
        );

        const opacityRow = new Adw.SpinRow({
            title: 'Card opacity',
            subtitle: 'Lower values reveal more of the blurred background',
            digits: 2,
            adjustment: new Gtk.Adjustment({
                lower: 0.35,
                upper: 1,
                step_increment: 0.05,
                page_increment: 0.1,
                value: settings.get_double('background-opacity'),
            }),
        });
        group.add(opacityRow);
        settings.bind(
            'background-opacity',
            opacityRow,
            'value',
            Gio.SettingsBindFlags.DEFAULT
        );

        group.add(this._createSwitchRow(
            settings,
            'animations-enabled',
            'Animations',
            'Also respects GNOME’s system animation and reduced-motion preferences.'
        ));
    }

    _addResetGroup(page, window, settings) {
        const group = new Adw.PreferencesGroup({
            title: 'Defaults',
            description: 'Restore every Spotlight preference to its original value.',
        });
        page.add(group);

        const row = new Adw.ActionRow({
            title: 'Reset all settings',
            subtitle: 'Shortcut, search providers, appearance, and web search settings',
        });
        group.add(row);

        const button = new Gtk.Button({
            label: 'Reset to Defaults',
            valign: Gtk.Align.CENTER,
            css_classes: ['destructive-action'],
        });
        row.add_suffix(button);
        row.activatable_widget = button;

        button.connect('clicked', () => {
            const dialog = new Adw.MessageDialog({
                transient_for: window,
                heading: 'Reset all Spotlight settings?',
                body: 'This restores every preference to its original default value.',
            });

            dialog.add_response('cancel', 'Cancel');
            dialog.add_response('reset', 'Reset');
            dialog.set_default_response('cancel');
            dialog.set_close_response('cancel');
            dialog.set_response_appearance(
                'reset',
                Adw.ResponseAppearance.DESTRUCTIVE
            );

            dialog.connect('response', (_dialog, response) => {
                if (response !== 'reset')
                    return;

                for (const key of SETTINGS_KEYS)
                    settings.reset(key);
            });

            dialog.present();
        });
    }

    _createSwitchRow(settings, key, title, subtitle) {
        const row = new Adw.ActionRow({title, subtitle});
        const toggle = new Gtk.Switch({
            valign: Gtk.Align.CENTER,
        });
        row.add_suffix(toggle);
        row.activatable_widget = toggle;
        settings.bind(key, toggle, 'active', Gio.SettingsBindFlags.DEFAULT);
        return row;
    }

    _addAboutGroup(page) {
        const group = new Adw.PreferencesGroup({title: 'About'});
        page.add(group);

        group.add(new Adw.ActionRow({
            title: 'Spotlight',
            subtitle: 'Apps · windows · files · settings · calculator · system actions · web',
        }));
        group.add(new Adw.ActionRow({
            title: 'Power-user prefixes',
            subtitle: 'app:  win:  file:  settings:  web:  system:  or = for calculator',
        }));
        group.add(new Adw.ActionRow({
            title: 'Privacy',
            subtitle: 'File search stays local. Calculator results are copied only when you activate them.',
        }));
    }
}
