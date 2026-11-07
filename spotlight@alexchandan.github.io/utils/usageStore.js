/* SPDX-License-Identifier: GPL-3.0-or-later */

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {normalizeText, parseScopedQuery} from './fuzzySearch.js';

const MAX_EVENTS = 240;
const MAX_QUERIES = 40;
const MAX_EVENT_AGE_MS = 45 * 24 * 60 * 60 * 1000;

function nowMs() {
    return Date.now();
}

export class UsageStore {
    constructor({rememberQueries = true, learnRanking = true} = {}) {
        this._rememberQueries = rememberQueries;
        this._learnRanking = learnRanking;
        this._destroyed = false;
        this._revision = 0;
        this._saving = false;
        this._dirty = false;
        this._cancellable = new Gio.Cancellable();
        this._data = {events: [], queries: []};
        const dir = GLib.build_filenamev([GLib.get_user_data_dir(), 'spotlight@alexchandan']);
        this._dir = Gio.File.new_for_path(dir);
        this._file = this._dir.get_child('usage.json');
        this._load();
    }

    _load() {
        const revision = this._revision;
        this._file.load_contents_async(this._cancellable, (file, result) => {
            try {
                const [ok, contents] = file.load_contents_finish(result);
                if (!ok || this._destroyed || revision !== this._revision || contents.length > 1024 * 1024)
                    return;
                const parsed = JSON.parse(new TextDecoder().decode(contents));
                this._data.events = this._learnRanking && Array.isArray(parsed?.events) ? parsed.events : [];
                this._data.queries = this._rememberQueries && Array.isArray(parsed?.queries) ? parsed.queries : [];
                // Older releases accidentally persisted clipboard text. Remove it.
                const containedClipboard = Array.isArray(parsed?.events) &&
                    parsed.events.some(event => event?.type === 'clipboard');
                if (containedClipboard)
                    this._data.queries = [];
                this._prune();
                if (containedClipboard || !this._rememberQueries || !this._learnRanking)
                    this._save();
            } catch (_error) {
                // First run, cancellation, or corrupt history: start empty.
            }
        });
    }

    setPrivacy({rememberQueries, learnRanking}) {
        this._rememberQueries = rememberQueries;
        this._learnRanking = learnRanking;
        if (!rememberQueries) {
            this._data.queries = [];
            this._data.events = this._data.events
                .filter(event => !['web', 'calculator'].includes(event.type))
                .map(event => ({...event, query: ''}));
        }
        if (!learnRanking)
            this._data.events = [];
        if (!rememberQueries || !learnRanking)
            this._save();
    }

    async _ensureDir() {
        if (this._dirReady)
            return;
        const create = async directory => {
            try {
                await new Promise((resolve, reject) => directory.make_directory_async(
                    GLib.PRIORITY_LOW, this._cancellable, (file, result) => {
                        try { file.make_directory_finish(result); resolve(); } catch (error) { reject(error); }
                    }));
            } catch (error) {
                if (error.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.EXISTS))
                    return;
                const parent = directory.get_parent();
                if (parent && error.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND)) {
                    await create(parent);
                    await create(directory);
                    return;
                }
                throw error;
            }
        };
        await create(this._dir);
        this._dirReady = true;
    }

    async _save() {
        if (this._destroyed)
            return;
        this._revision++;
        this._dirty = true;
        if (this._saving)
            return;
        this._saving = true;
        this._dirty = false;
        try {
            await this._ensureDir();
            if (this._destroyed)
                return;
            const bytes = new TextEncoder().encode(JSON.stringify(this._data));
            await new Promise((resolve, reject) => this._file.replace_contents_bytes_async(
                new GLib.Bytes(bytes), null, false,
                Gio.FileCreateFlags.REPLACE_DESTINATION | Gio.FileCreateFlags.PRIVATE,
                this._cancellable, (file, result) => {
                    try { file.replace_contents_finish(result); resolve(); } catch (error) { reject(error); }
                }));
        } catch (error) {
            if (!this._destroyed)
                console.error(`Spotlight: could not save history: ${error.message}`);
        } finally {
            this._saving = false;
            if (this._dirty && !this._destroyed)
                this._save();
        }
    }

    _prune() {
        if (!this._rememberQueries) {
            this._data.events = this._data.events
                .filter(event => !['web', 'calculator'].includes(event?.type))
                .map(event => ({...event, query: ''}));
        }
        const cutoff = nowMs() - MAX_EVENT_AGE_MS;
        this._data.events = this._data.events
            .filter(event => Number(event?.timestamp) >= cutoff
                && typeof event?.id === 'string' && event.id.length <= 4096
                && ['app', 'file', 'settings', 'system', 'web', 'window', 'calculator'].includes(event.type)
                && typeof event.query === 'string')
            .slice(-MAX_EVENTS);
        this._data.queries = this._data.queries
            .filter(query => typeof query === 'string' && query.trim() && query.length <= 500)
            .slice(0, MAX_QUERIES);
    }

    recordQuery(query) {
        if (this._destroyed || !this._rememberQueries)
            return;
        const cleaned = (query ?? '').trim().slice(0, 500);
        if (cleaned.length < 1 || parseScopedQuery(cleaned).scope === 'clipboard')
            return;

        this._rememberQuery(cleaned);
        this._save();
    }


    _rememberQuery(cleaned) {
        if (!this._rememberQueries)
            return;
        cleaned = cleaned.slice(0, 500);
        const normalized = normalizeText(cleaned);
        this._data.queries = [
            cleaned,
            ...this._data.queries.filter(item => normalizeText(item) !== normalized),
        ].slice(0, MAX_QUERIES);
    }

    recordActivation(query, result, rawQuery = '') {
        if (this._destroyed || !this._learnRanking || !result?.id || result.type === 'clipboard'
            || parseScopedQuery(rawQuery || query).scope === 'clipboard'
            || (!this._rememberQueries && ['web', 'calculator'].includes(result.type)))
            return;

        const queryToSave = (rawQuery || query || '').trim();
        if (queryToSave.length >= 1)
            this._rememberQuery(queryToSave);

        const cleanedQuery = (query || '').trim();
        this._data.events.push({
            id: result.id,
            type: result.type ?? '',
            title: result.title ?? '',
            subtitle: result.subtitle ?? '',
            query: this._rememberQueries ? normalizeText(cleanedQuery || queryToSave).slice(0, 500) : '',
            timestamp: nowMs(),
            historyData: result.historyData ?? null,
        });
        this._prune();
        this._save();
    }

    getBoost(query, resultId) {
        const normalizedQuery = normalizeText(query);
        if (!normalizedQuery || !resultId)
            return 0;

        const now = nowMs();
        let exactQueryCount = 0;
        let broaderCount = 0;
        let newest = 0;

        for (const event of this._data.events) {
            if (event.id !== resultId || Number(event.timestamp) < now - MAX_EVENT_AGE_MS)
                continue;

            newest = Math.max(newest, Number(event.timestamp) || 0);
            if (event.query === normalizedQuery)
                exactQueryCount++;
            else if (
                event.query
                && (event.query.startsWith(normalizedQuery) || normalizedQuery.startsWith(event.query))
            ) {
                broaderCount++;
            }
        }

        let boost = Math.min(150, exactQueryCount * 34 + broaderCount * 12);
        if (newest) {
            const ageDays = (now - newest) / (24 * 60 * 60 * 1000);
            boost += Math.max(0, Math.round(55 - ageDays * 4));
        }

        return boost;
    }

    getRecentEvents(type = null, limit = 8) {
        this._prune();
        const seen = new Set();
        const results = [];

        for (let index = this._data.events.length - 1; index >= 0; index--) {
            const event = this._data.events[index];
            if (type && event.type !== type)
                continue;
            if (seen.has(event.id))
                continue;

            seen.add(event.id);
            results.push(event);
            if (results.length >= limit)
                break;
        }

        return results;
    }

    getQueryHistory() {
        return [...this._data.queries];
    }

    clear() {
        this._data = {events: [], queries: []};
        this._save();
    }

    destroy() {
        this._destroyed = true;
        this._cancellable.cancel();
        this._data = {events: [], queries: []};
        this._dir = null;
        this._file = null;
    }
}
