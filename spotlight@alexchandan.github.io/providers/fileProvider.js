/* SPDX-License-Identifier: GPL-3.0-or-later */

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {fuzzyScorePrepared, normalizeText, prepareSearchText} from '../utils/fuzzySearch.js';
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
    constructor(settings, onChanged = null) {
        this._onChanged = onChanged;
        this._destroyed = false;
        this._run = null;
        this._launchCancellable = new Gio.Cancellable();
        this._settings = settings;
        this._entries = [];
        this._queue = [];
        this._seenPaths = new Set();
        this._isIndexing = false;
        this._enabled = this._settings.get_boolean('enable-file-search');

    }

    ensureIndex() {
        if (this._enabled && !this._started)
            this.rebuildIndex();
    }

    get isIndexing() {
        return this._isIndexing;
    }

    setEnabled(enabled) {
        this._enabled = Boolean(enabled);
        if (!this._enabled) {
            this._stopIndexer();
            this._entries = [];
            this._started = false;
            this._seenPaths.clear();
            return;
        }

        if (this._entries.length === 0 && !this._isIndexing)
            this.rebuildIndex();
    }

    rebuildIndex() {
        if (!this._enabled || this._destroyed)
            return;
        this._stopIndexer();
        this._started = true;

        this._entries = [];
        this._queue = [];
        this._seenPaths.clear();
        this._isIndexing = true;

        this._queue = this._getRootJobs();

        const run = {cancellable: new Gio.Cancellable(), enumerator: null,
            visited: new Set(), scanned: 0, limit: this._settings.get_int('file-index-limit')};
        this._run = run;
        this._indexNextDirectory(run);
    }

    _getRootJobs() {
        const jobs = [];
        const home = GLib.get_home_dir();
        if (home)
            jobs.push({file: Gio.File.new_for_path(home), depth: 0, maxDepth: 1});

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
            jobs.push({file: Gio.File.new_for_path(path), depth: 0, maxDepth: 4});
        }

        return jobs;
    }

    _isCurrent(run) {
        return !this._destroyed && this._run === run && !run.cancellable.is_cancelled();
    }

    _indexNextDirectory(run) {
        if (!this._isCurrent(run))
            return;
        const job = this._queue.shift();
        if (!job || this._entries.length >= run.limit) {
            this._finishIndexing(run);
            return;
        }
        const path = job.file.get_path();
        // A special directory can also be reached through HOME. Visit it at
        // its deepest requested depth, while deduplicating indexed entries.
        const remaining = job.maxDepth - job.depth;
        const visitKey = `${path}:${remaining}`;
        if (run.visited.has(visitKey)) {
            this._indexNextDirectory(run);
            return;
        }
        run.visited.add(visitKey);
        job.file.enumerate_children_async(
            'standard::name,standard::display-name,standard::type,standard::icon,standard::is-hidden',
            Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, GLib.PRIORITY_LOW,
            run.cancellable, (file, result) => {
                let enumerator;
                try {
                    enumerator = file.enumerate_children_finish(result);
                } catch (_error) {
                    if (this._isCurrent(run))
                        this._indexNextDirectory(run);
                    return;
                }
                if (!this._isCurrent(run)) {
                    this._closeEnumerator(enumerator);
                    return;
                }
                run.enumerator = enumerator;
                this._readBatch(run, job);
            });
    }

    _readBatch(run, job) {
        const enumerator = run.enumerator;
        enumerator.next_files_async(INDEX_BATCH_SIZE, GLib.PRIORITY_LOW,
            run.cancellable, (source, result) => {
                let infos = [];
                try {
                    infos = source.next_files_finish(result);
                } catch (_error) {
                    // Missing/unreadable files must not stop the rest of the index.
                }
                if (!this._isCurrent(run)) {
                    this._closeEnumerator(source);
                    return;
                }
                run.scanned += infos.length;
                for (const info of infos) {
                    if (this._entries.length >= run.limit)
                        break;
                    this._indexInfo(info, job);
                }
                this._onChanged?.();
                if (this._entries.length >= run.limit || run.scanned >= run.limit * 8) {
                    this._finishIndexing(run);
                } else if (infos.length === 0) {
                    this._closeEnumerator(enumerator);
                    run.enumerator = null;
                    this._indexNextDirectory(run);
                } else {
                    this._readBatch(run, job);
                }
            });
    }

    _indexInfo(info, job) {
        const name = info.get_name();
        if (!name || name.startsWith('.') || info.get_is_hidden?.())
            return;

        const child = job.file.get_child(name);
        const path = child.get_path();
        if (!path)
            return;

        const isDirectory = info.get_file_type() === Gio.FileType.DIRECTORY;
        const displayName = info.get_display_name?.() || name;

        if (!this._seenPaths.has(path)) {
            this._seenPaths.add(path);
            this._entries.push({
                id: path,
                file: child,
                path,
                name: displayName,
                nameSearch: prepareSearchText(displayName),
                pathSearch: prepareSearchText(compactHomePath(path)),
                gicon: info.get_icon?.() ?? null,
                isDirectory,
            });
        }

        if (
            isDirectory
            && job.depth < job.maxDepth
            && !SKIP_DIRECTORIES.has(name)
        ) {
            this._queue.push({
                file: child,
                depth: job.depth + 1,
                maxDepth: job.maxDepth,
            });
        }
    }

    _closeEnumerator(enumerator) {
        if (!enumerator || enumerator.is_closed() || enumerator.has_pending())
            return;
        enumerator.close_async(GLib.PRIORITY_LOW, null, (source, result) => {
            try {
                source.close_finish(result);
            } catch (_error) {
                // The directory may have disappeared.
            }
        });
    }

    _finishIndexing(run) {
        this._closeEnumerator(run.enumerator);
        this._run = null;
        this._queue = [];
        this._isIndexing = false;
        this._onChanged?.();
    }

    _stopIndexer() {
        if (this._run) {
            this._run.cancellable.cancel();
            this._closeEnumerator(this._run.enumerator);
            this._run = null;
        }
        this._queue = [];
        this._isIndexing = false;
    }

    search(query, limit = 6, {explicit = false} = {}) {
        if (!this._enabled) {
            if (explicit) {
                return [{
                    id: 'file:disabled',
                    type: 'info',
                    title: 'File search is disabled',
                    subtitle: 'Enable “Search local files” in Spotlight Preferences to search files.',
                    iconName: 'folder-symbolic',
                    score: 0,
                    activate: null,
                }];
            }
            return [];
        }

        const term = query.trim();
        const minLength = explicit ? 1 : 2;
        if (term.length < minLength) {
            if (explicit) {
                if (this._isIndexing) {
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
                return [{
                    id: 'file:hint',
                    type: 'info',
                    title: 'Search local files',
                    subtitle: 'Type a filename or path to search indexed files (e.g. # report or # .pdf)',
                    iconName: 'folder-saved-search-symbolic',
                    score: 1,
                    activate: null,
                }];
            }
            return [];
        }

        const normalizedQuery = normalizeText(term);
        const matches = [];
        for (const entry of this._entries) {
            const nameScore = fuzzyScorePrepared(entry.nameSearch, normalizedQuery);
            const pathScore = fuzzyScorePrepared(entry.pathSearch, normalizedQuery);
            const score = Math.max(nameScore, pathScore < 0 ? -1 : Math.round(pathScore * 0.68));

            if (score < 0)
                continue;

            matches.push({entry, score: score + (entry.isDirectory ? 20 : 0)});
        }

        const results = matches
            .sort((a, b) => b.score - a.score || a.entry.name.localeCompare(b.entry.name))
            .slice(0, limit)
            .map(({entry, score}) => this._toResult(entry, score));

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

    _toResult(entry, score) {
        return {
            id: `file:${entry.id}`,
            type: 'file',
            category: entry.isDirectory ? 'FOLDER' : 'FILE',
            title: entry.name,
            subtitle: compactHomePath(entry.path),
            gicon: entry.gicon,
            iconName: entry.isDirectory ? 'folder-symbolic' : 'text-x-generic-symbolic',
            score,
            historyData: {path: entry.path},
            activate: timestamp => Gio.AppInfo.launch_default_for_uri(
                entry.file.get_uri(),
                global.create_app_launch_context(timestamp || global.get_current_time(), -1)
            ),
            shortcutLabel: 'Open ↵',
            actions: {
                new: timestamp => this._revealFile(entry, timestamp),
                alternate: timestamp => this._revealFile(entry, timestamp),
            },
        };
    }

    getRecentResults(events, limit = 4) {
        if (!this._enabled || limit <= 0)
            return [];
        return events
            .map((event, index) => {
                const path = event.historyData?.path
                    ?? (event.id?.startsWith('file:') ? event.id.slice(5) : '');
                if (!path)
                    return null;

                const entry = this._entries.find(item => item.path === path);
                if (!entry)
                    return null;

                return this._toResult(entry, 900 - index);
            })
            .filter(Boolean)
            .slice(0, limit);
    }

    _revealFile(entry, timestamp = 0) {
        try {
            const bus = Gio.DBus.session;
            const uri = entry.file.get_uri();
            bus.call(
                'org.freedesktop.FileManager1',
                '/org/freedesktop/FileManager1',
                'org.freedesktop.FileManager1',
                'ShowItems',
                new GLib.Variant('(ass)', [[uri], '']),
                null,
                Gio.DBusCallFlags.NONE,
                3000,
                this._launchCancellable,
                (connection, result) => {
                    try {
                        connection.call_finish(result);
                    } catch (_err) {
                        if (!this._destroyed) {
                            try {
                                this._openContainingFolder(entry, timestamp);
                            } catch (error) {
                                console.error(`Spotlight: could not reveal file: ${error.message}`);
                            }
                        }
                    }
                }
            );
        } catch (_e) {
            this._openContainingFolder(entry, timestamp);
        }
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
        this._destroyed = true;
        this._launchCancellable.cancel();
        this._onChanged = null;
        this._stopIndexer();
        this._entries = [];
        this._seenPaths.clear();
        this._settings = null;
    }
}
