/* SPDX-License-Identifier: GPL-3.0-or-later */

import Gio from 'gi://Gio';

const ENGINES = {
    google: {
        label: 'Google',
        url: query => `https://www.google.com/search?q=${encodeURIComponent(query)}`,
    },
    duckduckgo: {
        label: 'DuckDuckGo',
        url: query => `https://duckduckgo.com/?q=${encodeURIComponent(query)}`,
    },
    brave: {
        label: 'Brave Search',
        url: query => `https://search.brave.com/search?q=${encodeURIComponent(query)}`,
    },
    bing: {
        label: 'Bing',
        url: query => `https://www.bing.com/search?q=${encodeURIComponent(query)}`,
    },
};

export class WebProvider {
    constructor(settings) {
        this._settings = settings;
    }

    search(query, {explicit = false} = {}) {
        const term = query.trim();
        if (!term)
            return [];

        const engineId = this._settings.get_string('web-engine');
        const engine = engineId === 'custom'
            ? {label: 'the web', url: value => this._customUrl(value)}
            : (ENGINES[engineId] ?? ENGINES.google);

        return [{
            id: `web:${engineId}:${term}`,
            type: 'web',
            category: 'WEB',
            title: `Search ${engine.label} for “${term}”`,
            subtitle: 'Open in default browser',
            iconName: 'web-browser-symbolic',
            score: explicit ? 1400 : -1000,
            activate: () => {
                Gio.AppInfo.launch_default_for_uri(
                    engine.url(term),
                    global.create_app_launch_context(0, -1)
                );
            },
        }];
    }

    _customUrl(query) {
        const template = this._settings.get_string('custom-search-url').trim();
        if (!/^https?:\/\//i.test(template))
            return ENGINES.google.url(query);

        const encoded = encodeURIComponent(query);
        return template.includes('%s')
            ? template.split('%s').join(encoded)
            : `${template}${encoded}`;
    }

    destroy() {
        this._settings = null;
    }
}
