/* SPDX-License-Identifier: GPL-3.0-or-later */

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {normalizeText} from './fuzzySearch.js';

const MAX_EVENTS = 240;
const MAX_QUERIES = 40;
const MAX_EVENT_AGE_MS = 45 * 24 * 60 * 60 * 1000;

function nowMs() {
    return Date.now();
}

export class UsageStore {
    constructor() {
        this._data = {events: [], queries: []};
        const dir = GLib.build_filenamev([GLib.get_user_data_dir(), 'spotlight@alexchandan']);
        this._dir = Gio.File.new_for_path(dir);
        this._file = this._dir.get_child('usage.json');
        this._load();
    }

    _load() {
        try {
            const [ok, contents] = this._file.load_contents(null);
            if (!ok)
                return;

            const parsed = JSON.parse(new TextDecoder().decode(contents));
            if (Array.isArray(parsed?.events))
                this._data.events = parsed.events;
            if (Array.isArray(parsed?.queries))
                this._data.queries = parsed.queries;
            this._prune();
        } catch (_error) {
            this._data = {events: [], queries: []};
        }
    }

    _ensureDir() {
        try {
            this._dir.make_directory_with_parents(null);
        } catch (error) {
            if (!error.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.EXISTS))
                throw error;
        }
    }

    _save() {
        try {
            this._ensureDir();
            const bytes = new TextEncoder().encode(JSON.stringify(this._data));
            this._file.replace_contents(
                bytes,
                null,
                false,
                Gio.FileCreateFlags.REPLACE_DESTINATION,
                null
            );
        } catch (error) {
            logError(error, 'Spotlight: could not save local ranking history');
        }
    }

    _prune() {
        const cutoff = nowMs() - MAX_EVENT_AGE_MS;
        this._data.events = this._data.events
            .filter(event => Number(event?.timestamp) >= cutoff && event?.id)
            .slice(-MAX_EVENTS);
        this._data.queries = this._data.queries
            .filter(query => typeof query === 'string' && query.trim())
            .slice(0, MAX_QUERIES);
    }

    recordQuery(query) {
        const cleaned = (query ?? '').trim();
        if (cleaned.length < 1)
            return;

        this._rememberQuery(cleaned);
        this._save();
    }


    _rememberQuery(cleaned) {
        const normalized = normalizeText(cleaned);
        this._data.queries = [
            cleaned,
            ...this._data.queries.filter(item => normalizeText(item) !== normalized),
        ].slice(0, MAX_QUERIES);
    }

    recordActivation(query, result, rawQuery = '') {
        if (!result?.id)
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
            query: normalizeText(cleanedQuery || queryToSave),
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
            if (event.id !== resultId)
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
        this._data = {events: [], queries: []};
        this._dir = null;
        this._file = null;
    }
}
