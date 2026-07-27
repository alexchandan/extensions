'use strict';

import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/shell/extensions/prefs.js';

export default class SpotlightPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        const page = new Adw.PreferencesPage({
            title: 'Spotlight',
            icon_name: 'edit-find-symbolic',
        });
        window.add(page);

        // --- Shortcut group -------------------------------------------------
        const shortcutGroup = new Adw.PreferencesGroup({
            title: 'Keyboard Shortcut',
            description: 'The key combination that opens and closes Spotlight.',
        });
        page.add(shortcutGroup);

        const shortcutRow = new Adw.ActionRow({title: 'Toggle Spotlight'});
        shortcutGroup.add(shortcutRow);

        const shortcutLabel = new Gtk.ShortcutLabel({
            disabled_text: 'Not set',
            accelerator: settings.get_strv('toggle-shortcut')[0] || '',
            valign: Gtk.Align.CENTER,
        });
        shortcutRow.add_suffix(shortcutLabel);

        const editButton = new Gtk.Button({
            icon_name: 'document-edit-symbolic',
            valign: Gtk.Align.CENTER,
            css_classes: ['flat'],
        });
        shortcutRow.add_suffix(editButton);

        editButton.connect('clicked', () => {
            const dialog = new Gtk.Dialog({
                title: 'Set Shortcut',
                transient_for: window,
                modal: true,
                use_header_bar: 1,
            });
            dialog.add_button('Cancel', Gtk.ResponseType.CANCEL);
            dialog.add_button('Save', Gtk.ResponseType.OK);

            const box = new Gtk.Box({
                orientation: Gtk.Orientation.VERTICAL,
                spacing: 8,
                margin_top: 16,
                margin_bottom: 16,
                margin_start: 16,
                margin_end: 16,
            });

            const hint = new Gtk.Label({
                label: 'Use GTK accelerator syntax, e.g. <Super>space or <Control><Alt>s',
                wrap: true,
                xalign: 0,
                css_classes: ['dim-label'],
            });
            box.append(hint);

            const entry = new Gtk.Entry({
                text: settings.get_strv('toggle-shortcut')[0] || '<Super>space',
            });
            box.append(entry);

            dialog.get_content_area().append(box);

            dialog.connect('response', (dlg, response) => {
                if (response === Gtk.ResponseType.OK) {
                    const val = entry.get_text().trim();
                    if (val) {
                        settings.set_strv('toggle-shortcut', [val]);
                        shortcutLabel.set_accelerator(val);
                    }
                }
                dialog.destroy();
            });

            dialog.show();
        });

        // --- Behaviour group --------------------------------------------------
        const behaviourGroup = new Adw.PreferencesGroup({
            title: 'Results',
        });
        page.add(behaviourGroup);

        const countRow = new Adw.SpinRow({
            title: 'Maximum app results',
            subtitle: 'How many application matches to show at once',
            adjustment: new Gtk.Adjustment({
                lower: 3,
                upper: 20,
                step_increment: 1,
                value: settings.get_int('result-count'),
            }),
        });
        behaviourGroup.add(countRow);

        settings.bind('result-count', countRow, 'value', 0 /* Gio.SettingsBindFlags.DEFAULT */);

        // --- About group --------------------------------------------------
        const infoGroup = new Adw.PreferencesGroup({title: 'About'});
        page.add(infoGroup);
        infoGroup.add(new Adw.ActionRow({
            title: 'Spotlight for GNOME',
            subtitle: 'A macOS Spotlight-style launcher: apps, calculator, web search, and system actions.',
        }));
    }
}
