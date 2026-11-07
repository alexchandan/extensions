/* SPDX-License-Identifier: GPL-3.0-or-later */
export function isSafeShortcut(value) {
    // Shift alone can steal ordinary typing. Require a command modifier.
    return typeof value === 'string'
        && /<(?:Super|Control|Ctrl|Primary|Alt|Meta|Hyper)>/i.test(value)
        && /^(?:<[^<>]+>)+[^<>]+$/.test(value);
}
