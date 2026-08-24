/* SPDX-License-Identifier: GPL-3.0-or-later */

import * as SystemActions from 'resource:///org/gnome/shell/misc/systemActions.js';

import {bestFieldScore} from '../utils/fuzzySearch.js';

const ACTIONS = [
    {
        id: 'lock',
        title: 'Lock Screen',
        keywords: 'lock lock screen secure screen',
        iconName: 'system-lock-screen-symbolic',
        method: 'activateLockScreen',
        availability: 'can-lock-screen',
        subtitle: 'System action',
    },
    {
        id: 'suspend',
        title: 'Suspend',
        keywords: 'suspend sleep standby',
        iconName: 'weather-clear-night-symbolic',
        method: 'activateSuspend',
        availability: 'can-suspend',
        subtitle: 'System action',
    },
    {
        id: 'restart',
        title: 'Restart',
        keywords: 'restart reboot',
        iconName: 'system-reboot-symbolic',
        method: 'activateRestart',
        availability: 'can-restart',
        subtitle: 'Opens GNOME confirmation',
        danger: true,
    },
    {
        id: 'power-off',
        title: 'Shut Down',
        keywords: 'shut down shutdown power off poweroff halt stop',
        iconName: 'system-shutdown-symbolic',
        method: 'activatePowerOff',
        availability: 'can-power-off',
        subtitle: 'Opens GNOME confirmation',
        danger: true,
    },
    {
        id: 'logout',
        title: 'Log Out',
        keywords: 'log out logout sign out sign off',
        iconName: 'system-log-out-symbolic',
        method: 'activateLogout',
        availability: 'can-logout',
        subtitle: 'Opens GNOME confirmation',
        danger: true,
    },
];

export class SystemProvider {
    constructor() {
        this._systemActions = SystemActions.getDefault();
    }

    search(query, limit = 5) {
        const term = query.trim();
        if (term.length < 2)
            return [];

        return ACTIONS
            .map(action => {
                if (!this._isAvailable(action))
                    return null;

                const score = bestFieldScore(term, [
                    {value: action.title, weight: 1},
                    {value: action.keywords, weight: 0.9},
                ]);

                if (score < 0)
                    return null;

                return {
                    id: `system:${action.id}`,
                    type: 'system',
                    category: 'SYSTEM',
                    danger: Boolean(action.danger),
                    title: action.title,
                    subtitle: action.subtitle,
                    iconName: action.iconName,
                    score: score + 260,
                    activate: () => this._activate(action),
                };
            })
            .filter(Boolean)
            .sort((a, b) => b.score - a.score)
            .slice(0, limit);
    }

    _isAvailable(action) {
        try {
            return this._systemActions.get_property(action.availability) !== false;
        } catch (_error) {
            // Keep the action searchable on older Shell versions where a
            // particular availability property may not be exposed.
            return true;
        }
    }

    _activate(action) {
        try {
            const method = this._systemActions[action.method];
            if (typeof method !== 'function')
                throw new Error(`${action.method} is unavailable`);

            method.call(this._systemActions);
        } catch (error) {
            logError(error, `Spotlight: unable to run ${action.title}`);
            global.notify_error?.(
                'Spotlight',
                `${action.title} is not available in the current session.`
            );
        }
    }

    destroy() {
        this._systemActions = null;
    }
}
