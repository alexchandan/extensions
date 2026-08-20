/* SPDX-License-Identifier: GPL-3.0-or-later */

import Gio from 'gi://Gio';
import Shell from 'gi://Shell';


import {bestFieldScore, normalizeText} from '../utils/fuzzySearch.js';

export class AppProvider {
    constructor() {
        this._appSystem = Shell.AppSystem.get_default();
        this._usage = global.get_app_usage?.() ?? Shell.AppUsage?.get_default?.() ?? null;
        this._shellSettings = new Gio.Settings({schema_id: 'org.gnome.shell'});
        this._cache = [];
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
        this._favoriteIds = new Set(
            this._shellSettings.get_strv('favorite-apps')
        );
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
            // AppUsage context handling varies between Shell releases.
            // Search remains fully functional without a frequency boost.
        }
    }

    _rebuildCache() {
        this._refreshUsageRanks();
        this._cache = [];

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

            this._cache.push({
                id,
                appInfo,
                name,
                description,
                normalizedName: normalizeText(name),
                genericName: normalizeText(genericName),
                executable: normalizeText(executable),
                keywords: normalizeText(keywords),
            });
        }
    }

    search(query, limit = 8) {
        const term = query.trim();
        if (!term)
            return [];

        const runningIds = new Set(
            this._appSystem.get_running().map(app => app.get_id())
        );

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

            if (isRunning)
                score += 115;
            if (isFavorite)
                score += 85;
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
                const entry = this._cache.find(item => item.id === id);
                if (!entry)
                    return null;

                const isRunning = runningIds.has(id);
                const isFavorite = this._favoriteIds.has(id);
                return this._toResult(entry, 1000 - index, {isRunning, isFavorite, quick: true});
            })
            .filter(Boolean)
            .slice(0, limit);
    }

    _toResult(entry, score, {isRunning = false, isFavorite = false, quick = false} = {}) {
        let subtitle = isRunning
            ? 'Running application · Switch to it'
            : entry.description;

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
            title: entry.name,
            subtitle,
            gicon: entry.appInfo.get_icon?.() ?? null,
            score,
            activate: timestamp => this._activate(entry, timestamp),
        };
    }

    _activate(entry, timestamp = 0) {
        const app = entry.id ? this._appSystem.lookup_app(entry.id) : null;
        const eventTime = timestamp || global.get_current_time();

        if (app) {
            try {
                // Shell.App.activate_full() is GNOME Shell's own high-level
                // activation path: if the app is already running it focuses
                // the most recently used normal window (including switching
                // workspaces); otherwise it launches the application.
                app.activate_full(-1, eventTime);
                return;
            } catch (error) {
                logError(error, `Spotlight: activate_full failed for ${entry.name}`);

                // Older/variant Shell builds still expose activate(), which
                // uses the default workspace and current event timestamp.
                try {
                    app.activate();
                    return;
                } catch (_fallbackError) {
                    // Fall through to launching via the desktop app info.
                }
            }
        }

        entry.appInfo.launch(
            [],
            global.create_app_launch_context(eventTime, -1)
        );
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
        this._favoriteIds.clear();
        this._usageRanks.clear();
        this._shellSettings = null;
        this._usage = null;
        this._appSystem = null;
    }
}
