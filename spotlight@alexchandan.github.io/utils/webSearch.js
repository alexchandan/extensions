/* SPDX-License-Identifier: GPL-3.0-or-later */
import GLib from 'gi://GLib';

export function customSearchUrl(template, query) {
    const source = template.trim();
    if (!source.includes('%s') || /\s/.test(source))
        throw new Error('Use an HTTP(S) URL containing %s for the query');
    const url = source.replace(/%s/g, encodeURIComponent(query));
    const parsed = GLib.Uri.parse(url, GLib.UriFlags.NONE);
    if (!['http', 'https'].includes(parsed.get_scheme()?.toLowerCase()) || !parsed.get_host())
        throw new Error('Search URLs must use HTTP or HTTPS and include a host');
    return url;
}
