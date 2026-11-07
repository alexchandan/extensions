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
        availability: 'canLockScreen',
        subtitle: 'System action',
    },
    {
        id: 'suspend',
        title: 'Suspend',
        keywords: 'suspend sleep standby',
        iconName: 'weather-clear-night-symbolic',
        method: 'activateSuspend',
        availability: 'canSuspend',
        subtitle: 'System action',
    },
    {
        id: 'restart',
        title: 'Restart',
        keywords: 'restart reboot',
        iconName: 'system-reboot-symbolic',
        method: 'activateRestart',
        availability: 'canRestart',
        subtitle: 'Opens GNOME confirmation',
        danger: true,
    },
    {
        id: 'power-off',
        title: 'Shut Down',
        keywords: 'shut down shutdown power off poweroff halt stop',
        iconName: 'system-shutdown-symbolic',
        method: 'activatePowerOff',
        availability: 'canPowerOff',
        subtitle: 'Opens GNOME confirmation',
        danger: true,
    },
    {
        id: 'logout',
        title: 'Log Out',
        keywords: 'log out logout sign out sign off',
        iconName: 'system-log-out-symbolic',
        method: 'activateLogout',
        availability: 'canLogout',
        subtitle: 'Opens GNOME confirmation',
        danger: true,
    },
];

export class SystemProvider {
    constructor() {
        this._systemActions = SystemActions.getDefault();
    }

    search(query, limit = 5, {explicit = false} = {}) {
        const term = query.trim();
        if (!term) {
            if (explicit) {
                return ACTIONS
                    .filter(action => this._isAvailable(action))
                    .map((action, index) => ({
                        id: `system:${action.id}`,
                        type: 'system',
                        category: 'SYSTEM',
                        danger: Boolean(action.danger),
                        title: action.title,
                        subtitle: action.subtitle,
                        iconName: action.iconName,
                        shortcutLabel: 'Run ↵',
                        score: 1000 - index,
                        activate: () => this._activate(action),
                    }))
                    .slice(0, limit);
            }
            return [];
        }

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
                    shortcutLabel: 'Run ↵',
                    score: score + 260,
                    activate: () => this._activate(action),
                };
            })
            .filter(Boolean)
            .sort((a, b) => b.score - a.score)
            .slice(0, limit);
    }

    _isAvailable(action) {
        if (typeof this._systemActions?.[action.method] !== 'function')
            return false;
        try {
            // Shell defines these as JavaScript getters; get_property() does
            // not read them correctly through GJS's GObject binding.
            return this._systemActions[action.availability] === true;
        } catch (_error) {
            return false;
        }
    }

    _activate(action) {
        if (!this._isAvailable(action))
            throw new Error('System action is unavailable in this session');
        this._systemActions[action.method]();
    }

    destroy() {
        this._systemActions = null;
    }
}
