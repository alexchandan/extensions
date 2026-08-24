/* SPDX-License-Identifier: GPL-3.0-or-later */

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {bestFieldScore, normalizeText} from '../utils/fuzzySearch.js';
import {compactHomePath} from '../utils/format.js';

const INDEX_BATCH_SIZE = 80;
const SKIP_DIRECTORIES = new Set([
    'node_modules',
    '.git',
    '.cache',
    '.npm',
    '.pnpm-store',
    '.cargo',
    '.gradle',
    '.venv',
    'venv',
    '__pycache__',
    'target',
    'dist',
    'build',
]);

export class FileProvider {
    constructor(settings) {
        this._settings = settings;
        this._entries = [];
        this._queue = [];
        this._seenPaths = new Set();
        this._idleId = 0;
        this._enumerator = null;
        this._currentJob = null;
        this._isIndexing = false;
        this._enabled = this._settings.get_boolean('enable-file-search');

        if (this._enabled)
            this.rebuildIndex();
    }

    get isIndexing() {
        return this._isIndexing;
    }

    setEnabled(enabled) {
        this._enabled = Boolean(enabled);
        if (!this._enabled) {
            this._stopIndexer();
            return;
        }

        if (this._entries.length === 0 && !this._isIndexing)
            this.rebuildIndex();
    }

    rebuildIndex() {
        if (!this._enabled)
            return;
        this._stopIndexer();

        this._entries = [];
        this._queue = [];
        this._seenPaths.clear();
        this._isIndexing = true;

        const home = GLib.get_home_dir();
        if (home)
            this._queue.push({file: Gio.File.new_for_path(home), depth: 0, maxDepth: 1});

        const specialDirs = [
            GLib.UserDirectory.DIRECTORY_DESKTOP,
            GLib.UserDirectory.DIRECTORY_DOCUMENTS,
            GLib.UserDirectory.DIRECTORY_DOWNLOAD,
            GLib.UserDirectory.DIRECTORY_PICTURES,
            GLib.UserDirectory.DIRECTORY_MUSIC,
            GLib.UserDirectory.DIRECTORY_VIDEOS,
        ];

        const addedRoots = new Set(home ? [home] : []);
        for (const specialDir of specialDirs) {
            const path = GLib.get_user_special_dir(specialDir);
            if (!path || addedRoots.has(path))
                continue;

            addedRoots.add(path);
            this._queue.push({file: Gio.File.new_for_path(path), depth: 0, maxDepth: 4});
        }

        this._idleId = GLib.idle_add(GLib.PRIORITY_LOW, () => this._indexBatch());
        GLib.Source.set_name_by_id?.(this._idleId, '[spotlight] file indexer');
    }

    _indexBatch() {
        const limit = this._settings.get_int('file-index-limit');
        if (this._entries.length >= limit) {
            this._finishIndexing();
            return GLib.SOURCE_REMOVE;
        }

        let processed = 0;
        while (processed < INDEX_BATCH_SIZE) {
            if (!this._enumerator) {
                this._currentJob = this._queue.shift() ?? null;
                if (!this._currentJob) {
                    this._finishIndexing();
                    return GLib.SOURCE_REMOVE;
                }

                try {
                    this._enumerator = this._currentJob.file.enumerate_children(
                        'standard::name,standard::display-name,standard::type,standard::icon,standard::is-hidden',
                        Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS,
                        null
                    );
                } catch (_error) {
                    this._enumerator = null;
                    this._currentJob = null;
                    continue;
                }
            }

            let info;
            try {
                info = this._enumerator.next_file(null);
            } catch (_error) {
                this._closeEnumerator();
                continue;
            }

            if (!info) {
                this._closeEnumerator();
                continue;
            }

            processed++;
            this._indexInfo(info);

            if (this._entries.length >= limit) {
                this._finishIndexing();
                return GLib.SOURCE_REMOVE;
            }
        }

        return GLib.SOURCE_CONTINUE;
    }

    _indexInfo(info) {
        const name = info.get_name();
        if (!name || name.startsWith('.') || info.get_is_hidden?.())
            return;

        const child = this._currentJob.file.get_child(name);
        const path = child.get_path();
        if (!path || this._seenPaths.has(path))
            return;

        this._seenPaths.add(path);

        const isDirectory = info.get_file_type() === Gio.FileType.DIRECTORY;
        const displayName = info.get_display_name?.() || name;

        this._entries.push({
            id: path,
            file: child,
            path,
            name: displayName,
            normalizedName: normalizeText(displayName),
            normalizedPath: normalizeText(compactHomePath(path)),
            gicon: info.get_icon?.() ?? null,
            isDirectory,
        });

        if (
            isDirectory
            && this._currentJob.depth < this._currentJob.maxDepth
            && !SKIP_DIRECTORIES.has(name)
        ) {
            this._queue.push({
                file: child,
                depth: this._currentJob.depth + 1,
                maxDepth: this._currentJob.maxDepth,
            });
        }
    }

    _closeEnumerator() {
        try {
            this._enumerator?.close(null);
        } catch (_error) {
            // Ignore shutdown errors from inaccessible or disappearing files.
        }

        this._enumerator = null;
        this._currentJob = null;
    }

    _finishIndexing() {
        this._closeEnumerator();
        this._queue = [];
        this._isIndexing = false;
        this._idleId = 0;
    }

    _stopIndexer() {
        if (this._idleId) {
            GLib.Source.remove(this._idleId);
            this._idleId = 0;
        }
        this._closeEnumerator();
        this._queue = [];
        this._isIndexing = false;
    }

    search(query, limit = 6, {explicit = false} = {}) {
        if (!this._enabled)
            return [];

        const term = query.trim();
        if (term.length < 2)
            return [];

        const matches = [];
        for (const entry of this._entries) {
            const score = bestFieldScore(term, [
                {value: entry.normalizedName, weight: 1},
                {value: entry.normalizedPath, weight: 0.68},
            ]);

            if (score < 0)
                continue;

            matches.push({
                id: `file:${entry.id}`,
                type: 'file',
                category: entry.isDirectory ? 'FOLDER' : 'FILE',
                title: entry.name,
                subtitle: compactHomePath(entry.path),
                gicon: entry.gicon,
                iconName: entry.isDirectory ? 'folder-symbolic' : 'text-x-generic-symbolic',
                score: score + (entry.isDirectory ? 20 : 0),
                historyData: {path: entry.path},
                activate: timestamp => Gio.AppInfo.launch_default_for_uri(
                    entry.file.get_uri(),
                    global.create_app_launch_context(timestamp || global.get_current_time(), -1)
                ),
                actions: {
                    new: timestamp => this._openContainingFolder(entry, timestamp),
                    alternate: timestamp => this._openContainingFolder(entry, timestamp),
                },
            });
        }

        const results = matches
            .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
            .slice(0, limit);

        if (explicit && results.length === 0 && this._isIndexing) {
            return [{
                id: 'file:indexing',
                type: 'info',
                title: 'Indexing your files…',
                subtitle: 'Search results will appear as the local index is built.',
                iconName: 'content-loading-symbolic',
                score: 1,
                activate: null,
            }];
        }

        return results;
    }

    getRecentResults(events, limit = 4) {
        return events
            .map((event, index) => {
                const path = event.historyData?.path
                    ?? (event.id?.startsWith('file:') ? event.id.slice(5) : '');
                if (!path)
                    return null;

                const entry = this._entries.find(item => item.path === path);
                if (!entry)
                    return null;

                return {
                    id: `file:${entry.id}`,
                    type: 'file',
                    category: entry.isDirectory ? 'FOLDER' : 'FILE',
                    title: entry.name,
                    subtitle: compactHomePath(entry.path),
                    gicon: entry.gicon,
                    iconName: entry.isDirectory ? 'folder-symbolic' : 'text-x-generic-symbolic',
                    score: 900 - index,
                    historyData: {path: entry.path},
                    activate: timestamp => Gio.AppInfo.launch_default_for_uri(
                        entry.file.get_uri(),
                        global.create_app_launch_context(timestamp || global.get_current_time(), -1)
                    ),
                    actions: {
                        new: timestamp => this._openContainingFolder(entry, timestamp),
                        alternate: timestamp => this._openContainingFolder(entry, timestamp),
                    },
                };
            })
            .filter(Boolean)
            .slice(0, limit);
    }

    _openContainingFolder(entry, timestamp = 0) {
        const parent = entry.file.get_parent();
        if (!parent)
            return;

        Gio.AppInfo.launch_default_for_uri(
            parent.get_uri(),
            global.create_app_launch_context(timestamp || global.get_current_time(), -1)
        );
    }

    destroy() {
        this._stopIndexer();
        this._entries = [];
        this._seenPaths.clear();
        this._settings = null;
    }
}
