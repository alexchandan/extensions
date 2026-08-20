/* SPDX-License-Identifier: GPL-3.0-or-later */

import GLib from 'gi://GLib';

export function compactHomePath(path) {
    const home = GLib.get_home_dir();
    if (!path || !home)
        return path ?? '';

    if (path === home)
        return '~';
    if (path.startsWith(`${home}/`))
        return `~/${path.slice(home.length + 1)}`;

    return path;
}
