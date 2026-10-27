/* SPDX-License-Identifier: GPL-3.0-or-later */

import Gio from 'gi://Gio';

import {bestFieldScore, normalizeText} from '../utils/fuzzySearch.js';

export class SettingsProvider {
    constructor() {
        this._entries = [];
        this._monitor = Gio.AppInfoMonitor.get();
        this._changedId = this._monitor.connect('changed', () => this._rebuild());
        this._rebuild();
    }

    _rebuild() {
        this._entries = Gio.AppInfo.get_all()
            .filter(appInfo => {
                const executable = appInfo.get_executable?.() || '';
                const commandLine = appInfo.get_commandline?.() || '';
                const id = appInfo.get_id?.() || '';

                return executable.includes('gnome-control-center')
                    || commandLine.includes('gnome-control-center')
                    || id.includes('gnome-') && id.includes('panel');
            })
            .map(appInfo => ({
                appInfo,
                id: appInfo.get_id?.() || '',
                name: appInfo.get_display_name?.() || appInfo.get_name?.() || 'Settings',
                description: appInfo.get_description?.() || '',
                executable: normalizeText(appInfo.get_executable?.() || ''),
            }));
    }

    search(query, limit = 6) {
        const term = query.trim();
        if (!term)
            return [];

        return this._entries
            .map(entry => {
                const score = bestFieldScore(term, [
                    {value: entry.name, weight: 1},
                    {value: entry.description, weight: 0.8},
                    {value: entry.executable, weight: 0.55},
                ]);

                if (score < 0)
                    return null;

                return {
                    id: `settings:${entry.id || entry.name}`,
                    type: 'settings',
                    category: 'SETTING',
                    title: entry.name,
                    subtitle: entry.description || 'GNOME Settings',
                    gicon: entry.appInfo.get_icon?.() ?? null,
                    iconName: 'org.gnome.Settings-symbolic',
                    shortcutLabel: 'Open ↵',
                    score: score + 95,
                    activate: () => entry.appInfo.launch(
                        [],
                        global.create_app_launch_context(0, -1)
                    ),
                };
            })
            .filter(Boolean)
            .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
            .slice(0, limit);
    }

    destroy() {
        if (this._changedId) {
            this._monitor.disconnect(this._changedId);
            this._changedId = 0;
        }
        this._entries = [];
        this._monitor = null;
    }
}
