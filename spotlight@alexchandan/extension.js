/* SPDX-License-Identifier: GPL-3.0-or-later */

import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as ShellMain from 'resource:///org/gnome/shell/ui/main.js';

import {SpotlightOverlay} from './ui/overlay.js';

export default class SpotlightExtension extends Extension {
    enable() {
        console.log('[Spotlight 2.0.6] enabling');
        this._settings = this.getSettings();
        this._ensureSafeShortcut();
        this._overlay = new SpotlightOverlay(this._settings);

        ShellMain.wm.addKeybinding(
            'toggle-shortcut',
            this._settings,
            Meta.KeyBindingFlags.NONE,
            Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW,
            () => this._overlay.toggle()
        );
    }


    _ensureSafeShortcut() {
        const shortcut = this._settings.get_strv('toggle-shortcut')[0] ?? '';
        if (!shortcut)
            return;

        // Preferences only allow modifier + key combinations. Also repair
        // older/manual one-key values so they cannot survive an upgrade via
        // dconf/GSettings and become a global single-key binding.
        const hasModifier = /<(?:Super|Control|Ctrl|Alt|Shift|Meta|Hyper)>/i.test(shortcut);
        if (!hasModifier) {
            console.warn(`Spotlight: rejected unsafe one-key shortcut “${shortcut}”; restoring default.`);
            this._settings.reset('toggle-shortcut');
        }
    }

    disable() {
        console.log('[Spotlight 2.0.6] disabling');
        ShellMain.wm.removeKeybinding('toggle-shortcut');

        this._overlay?.destroy();
        this._overlay = null;
        this._settings = null;
    }
}
