/* SPDX-License-Identifier: GPL-3.0-or-later */

import Gio from 'gi://Gio';
import Shell from 'gi://Shell';

import {bestFieldScore, normalizeText} from '../utils/fuzzySearch.js';

export class AppProvider {
    constructor(settings) {
        this._settings = settings;
        this._appSystem = Shell.AppSystem.get_default();
        this._usage = global.get_app_usage?.() ?? Shell.AppUsage?.get_default?.() ?? null;
        this._shellSettings = new Gio.Settings({schema_id: 'org.gnome.shell'});
        this._cache = [];
        this._cacheById = new Map();
        this._favoriteIds = new Set();
        this._usageRanks = new Map();

        this._installedChangedId = this._appSystem.connect(
            'installed-changed',
            () => this._rebuildCache()
        );
        this._favoritesChangedId = this._shellSettings.connect(
            'changed::favorite-apps',
            () => this._refreshFavorites()
        );

        this._refreshFavorites();
        this._rebuildCache();
    }

    _refreshFavorites() {
        this._favoriteIds = new Set(this._shellSettings.get_strv('favorite-apps'));
    }

    _refreshUsageRanks() {
        this._usageRanks.clear();

        try {
            const mostUsed = this._usage?.get_most_used?.('') ?? [];
            mostUsed.slice(0, 30).forEach((app, index) => {
                const id = app?.get_id?.();
                if (id)
                    this._usageRanks.set(id, Math.max(5, 70 - index * 2));
            });
        } catch (_error) {
            // Search remains fully functional without Shell usage statistics.
        }
    }

    _rebuildCache() {
        this._refreshUsageRanks();
        this._cache = [];
        this._cacheById.clear();

        for (const appInfo of this._appSystem.get_installed()) {
            if (!appInfo.should_show())
                continue;

            const id = appInfo.get_id?.() ?? '';
            const name = appInfo.get_display_name?.() || appInfo.get_name?.() || '';
            if (!name)
                continue;

            const genericName = appInfo.get_generic_name?.() || '';
            const executable = appInfo.get_executable?.() || '';
            const description = appInfo.get_description?.() || '';
            const keywords = typeof appInfo.get_keywords === 'function'
                ? (appInfo.get_keywords() ?? []).join(' ')
                : '';

            const entry = {
                id,
                appInfo,
                name,
                description,
                normalizedName: normalizeText(name),
                genericName: normalizeText(genericName),
                executable: normalizeText(executable),
                keywords: normalizeText(keywords),
            };
            this._cache.push(entry);
            if (id)
                this._cacheById.set(id, entry);
        }
    }

    search(query, limit = 8) {
        const term = query.trim();
        if (!term)
            return [];

        const runningIds = new Set(this._appSystem.get_running().map(app => app.get_id()));
        const results = [];

        for (const entry of this._cache) {
            let score = bestFieldScore(term, [
                {value: entry.normalizedName, weight: 1},
                {value: entry.genericName, weight: 0.82},
                {value: entry.keywords, weight: 0.76},
                {value: entry.executable, weight: 0.62},
            ]);
            if (score < 0)
                continue;

            const isRunning = runningIds.has(entry.id);
            const isFavorite = this._favoriteIds.has(entry.id);

            if (isRunning && this._settings.get_boolean('boost-running-apps'))
                score += 115;
            if (isFavorite && this._settings.get_boolean('boost-favorite-apps'))
                score += 85;
            if (this._settings.get_boolean('boost-recent-results'))
                score += this._usageRanks.get(entry.id) ?? 0;

            results.push(this._toResult(entry, score, {isRunning, isFavorite}));
        }

        return results
            .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
            .slice(0, limit);
    }

    getQuickResults(limit = 6) {
        this._refreshUsageRanks();

        const runningApps = this._appSystem.get_running();
        const runningIds = new Set(runningApps.map(app => app.get_id()));
        const orderedIds = [];

        for (const app of runningApps)
            orderedIds.push(app.get_id());
        for (const id of this._favoriteIds) {
            if (!orderedIds.includes(id))
                orderedIds.push(id);
        }
        for (const [id] of [...this._usageRanks.entries()].sort((a, b) => b[1] - a[1])) {
            if (!orderedIds.includes(id))
                orderedIds.push(id);
        }

        return orderedIds
            .map((id, index) => {
                const entry = this._cacheById.get(id);
                if (!entry)
                    return null;

                const isRunning = runningIds.has(id);
                const isFavorite = this._favoriteIds.has(id);
                return this._toResult(entry, 1000 - index, {isRunning, isFavorite, quick: true});
            })
            .filter(Boolean)
            .slice(0, limit);
    }

    getRecentResults(events, limit = 4) {
        const runningIds = new Set(this._appSystem.get_running().map(app => app.get_id()));
        return events
            .map((event, index) => {
                const appId = event.historyData?.appId
                    ?? (event.id?.startsWith('app:') ? event.id.slice(4) : '');
                const entry = this._cacheById.get(appId);
                if (!entry)
                    return null;
                return this._toResult(entry, 950 - index, {
                    isRunning: runningIds.has(appId),
                    isFavorite: this._favoriteIds.has(appId),
                    quick: true,
                });
            })
            .filter(Boolean)
            .slice(0, limit);
    }

    _toResult(entry, score, {isRunning = false, isFavorite = false, quick = false} = {}) {
        let subtitle = isRunning ? 'Running application · Switch to it' : entry.description;
        if (quick) {
            if (isRunning)
                subtitle = 'Running application · Switch to it';
            else if (isFavorite)
                subtitle = 'Favorite application';
            else
                subtitle = 'Frequently used application';
        }

        return {
            id: `app:${entry.id || entry.name}`,
            type: 'app',
            category: 'APP',
            title: entry.name,
            subtitle,
            gicon: entry.appInfo.get_icon?.() ?? null,
            score,
            shortcutLabel: isRunning ? 'Switch ↵' : '',
            historyData: {appId: entry.id},
            activate: timestamp => this._activate(entry, timestamp),
            actions: {
                new: timestamp => this._openNew(entry, timestamp),
                details: timestamp => this._showDetails(entry, timestamp),
            },
        };
    }

    _activate(entry, timestamp = 0) {
        const app = entry.id ? this._appSystem.lookup_app(entry.id) : null;
        const eventTime = timestamp || global.get_current_time();

        if (app) {
            try {
                app.activate_full(-1, eventTime);
                return;
            } catch (error) {
                logError(error, `Spotlight: activate_full failed for ${entry.name}`);
                try {
                    app.activate();
                    return;
                } catch (_fallbackError) {
                    // Fall through to desktop launch.
                }
            }
        }

        entry.appInfo.launch([], global.create_app_launch_context(eventTime, -1));
    }

    _openNew(entry, timestamp = 0) {
        const app = entry.id ? this._appSystem.lookup_app(entry.id) : null;
        try {
            if (app?.can_open_new_window?.()) {
                app.open_new_window(-1);
                return;
            }
        } catch (_error) {
            // Desktop launch below is the compatibility fallback.
        }

        entry.appInfo.launch(
            [],
            global.create_app_launch_context(timestamp || global.get_current_time(), -1)
        );
    }

    _showDetails(entry, timestamp = 0) {
        if (!entry.id)
            return this._activate(entry, timestamp);

        const uri = `appstream://${entry.id}`;
        try {
            Gio.AppInfo.launch_default_for_uri(
                uri,
                global.create_app_launch_context(timestamp || global.get_current_time(), -1)
            );
        } catch (_error) {
            this._activate(entry, timestamp);
        }
    }

    destroy() {
        if (this._installedChangedId) {
            this._appSystem.disconnect(this._installedChangedId);
            this._installedChangedId = 0;
        }
        if (this._favoritesChangedId) {
            this._shellSettings.disconnect(this._favoritesChangedId);
            this._favoritesChangedId = 0;
        }

        this._cache = [];
        this._cacheById.clear();
        this._favoriteIds.clear();
        this._usageRanks.clear();
        this._shellSettings = null;
        this._usage = null;
        this._appSystem = null;
        this._settings = null;
    }
}
