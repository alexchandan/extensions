/* SPDX-License-Identifier: GPL-3.0-or-later */

import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as ShellMain from 'resource:///org/gnome/shell/ui/main.js';

import {SpotlightOverlay} from './ui/overlay.js';

export default class SpotlightExtension extends Extension {
    enable() {
        console.log('[Spotlight 3.0.0] enabling');
        this._settings = this.getSettings();
        this._ensureSafeShortcut('toggle-shortcut');
        this._ensureSafeShortcut('selected-text-shortcut');
        this._overlay = new SpotlightOverlay(this._settings);

        ShellMain.wm.addKeybinding(
            'toggle-shortcut',
            this._settings,
            Meta.KeyBindingFlags.NONE,
            Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW,
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
        const shortcut = this._settings.get_strv(key)[0] ?? '';
        if (!shortcut)
            return;

        const hasModifier = /<(?:Super|Control|Ctrl|Alt|Shift|Meta|Hyper)>/i.test(shortcut);
        if (!hasModifier) {
            console.warn(`Spotlight: rejected unsafe one-key shortcut “${shortcut}”; restoring default.`);
            this._settings.reset(key);
        }
    }

    disable() {
        console.log('[Spotlight 3.0.0] disabling');
        ShellMain.wm.removeKeybinding('toggle-shortcut');
        ShellMain.wm.removeKeybinding('selected-text-shortcut');

        this._overlay?.destroy();
        this._overlay = null;
        this._settings = null;
    }
}
