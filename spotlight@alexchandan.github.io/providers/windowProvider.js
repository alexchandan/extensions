/* SPDX-License-Identifier: GPL-3.0-or-later */

import Shell from 'gi://Shell';

import * as ShellMain from 'resource:///org/gnome/shell/ui/main.js';

import {bestFieldScore} from '../utils/fuzzySearch.js';

export class WindowProvider {
    constructor() {
        this._tracker = Shell.WindowTracker.get_default();
    }

    search(query, limit = 6) {
        const term = query.trim();

        const results = [];

        for (const actor of global.get_window_actors()) {
            const window = actor.metaWindow ?? actor.meta_window ?? actor.get_meta_window?.();
            if (!window || window.skip_taskbar)
                continue;

            const title = window.get_title?.() || 'Untitled Window';
            const app = this._tracker.get_window_app(window);
            const appName = app?.get_name?.() || '';

            let score = term ? bestFieldScore(term, [
                {value: title, weight: 1},
                {value: appName, weight: 0.86},
            ]) : 1000;
            if (score < 0)
                continue;

            if (global.display.focus_window === window)
                score += 70;

            results.push({
                id: `window:${window.get_id?.() ?? title}`,
                type: 'window',
                category: 'WINDOW',
                title,
                subtitle: appName ? `${appName} · Open window` : 'Open window',
                gicon: app?.get_app_info?.()?.get_icon?.() ?? null,
                iconName: app ? null : 'focus-windows-symbolic',
                score: score + 150,
                historyData: null,
                shortcutLabel: 'Switch ↵',
                activate: timestamp => this._activateWindow(window, timestamp),
                actions: {
                    new: timestamp => {
                        if (app?.can_open_new_window?.())
                            app.open_new_window(-1);
                        else
                            this._activateWindow(window, timestamp);
                    },
                    alternate: timestamp => {
                        if (app?.can_open_new_window?.())
                            app.open_new_window(-1);
                        else
                            this._activateWindow(window, timestamp);
                    },
                },
            });
        }

        return results
            .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
            .slice(0, limit);
    }

    _activateWindow(window, timestamp = 0) {
        const time = timestamp || global.get_current_time();
        const workspace = window.get_workspace?.();
        const workspaceManager = global.workspace_manager;
        const activeWorkspaceNum = workspaceManager?.get_active_workspace_index?.() ?? 0;
        const windowWorkspaceNum = workspace ? workspace.index() : activeWorkspaceNum;

        try {
            // A restored overview control can retain stage focus after hiding.
            // Return keyboard focus to native windows before activating the target.
            global.stage.set_key_focus(null);
            ShellMain.activateWindow(window, time, windowWorkspaceNum);
        } catch (_error) {
            try {
                if (workspace && windowWorkspaceNum !== activeWorkspaceNum)
                    workspace.activate_with_focus(window, time);
                else
                    window.activate(time);
            } catch (err) {
                logError(err, 'Spotlight: failed to activate window');
            }
        }
    }

    destroy() {
        this._tracker = null;
    }
}
