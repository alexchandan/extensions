/* SPDX-License-Identifier: GPL-3.0-or-later */

import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';
import GLib from 'gi://GLib';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as ShellMain from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';

import {isSafeShortcut} from './utils/shortcuts.js';

import {SpotlightOverlay} from './ui/overlay.js';

export default class SpotlightExtension extends Extension {
    enable() {
        try {
            this._enable();
        } catch (error) {
            this.disable();
            throw error;
        }
    }

    _enable() {
        this._settings = this.getSettings();
        this._ensureSafeShortcut('toggle-shortcut');
        this._ensureSafeShortcut('selected-text-shortcut');
        this._shortcutSignals = ['toggle-shortcut', 'selected-text-shortcut'].map(key =>
            this._settings.connect(`changed::${key}`, () => this._ensureSafeShortcut(key)));
        this._overlay = new SpotlightOverlay(this._settings, () => this.openPreferences());
        this._shortcutSignals.push(this._settings.connect('changed::show-panel-button',
            () => this._syncPanelButton()));
        this._syncPanelButton();

        ShellMain.wm.addKeybinding(
            'toggle-shortcut',
            this._settings,
            Meta.KeyBindingFlags.NONE,
            Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW | Shell.ActionMode.POPUP,
            () => this._overlay.toggle()
        );

        ShellMain.wm.addKeybinding(
            'selected-text-shortcut',
            this._settings,
            Meta.KeyBindingFlags.NONE,
            Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW,
            () => this._overlay.openWithSelectedText()
        );
    }

    _ensureSafeShortcut(key) {
        const shortcuts = this._settings.get_strv(key);
        if (shortcuts.some(shortcut => !isSafeShortcut(shortcut))) {
            console.warn(`Spotlight: restoring unsafe shortcut in ${key}`);
            this._settings.reset(key);
        }
    }

    _syncPanelButton() {
        this._indicator?.destroy();
        this._indicator = null;
        if (!this._settings.get_boolean('show-panel-button'))
            return;
        this._indicator = new PanelMenu.Button(0, 'Spotlight');
        this._indicator.add_child(new St.Icon({icon_name: 'edit-find-symbolic',
            style_class: 'system-status-icon'}));
        this._indicator.menu.addAction('Open Spotlight', () => this._afterMenuClose(() => this._overlay.open()));
        this._indicator.menu.addAction('Preferences', () => this._afterMenuClose(() => this.openPreferences()));
        ShellMain.panel.addToStatusArea(this.uuid, this._indicator);
    }

    _afterMenuClose(action) {
        if (this._menuIdleId)
            GLib.Source.remove(this._menuIdleId);
        this._menuIdleId = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            this._menuIdleId = 0;
            action();
            return GLib.SOURCE_REMOVE;
        });
    }

    disable() {
        if (this._menuIdleId) {
            GLib.Source.remove(this._menuIdleId);
            this._menuIdleId = 0;
        }
        this._indicator?.destroy();
        this._indicator = null;
        ShellMain.wm.removeKeybinding('toggle-shortcut');
        ShellMain.wm.removeKeybinding('selected-text-shortcut');

        for (const id of this._shortcutSignals ?? [])
            this._settings.disconnect(id);
        this._shortcutSignals = [];
        this._overlay?.destroy();
        this._overlay = null;
        this._settings = null;
    }
}
