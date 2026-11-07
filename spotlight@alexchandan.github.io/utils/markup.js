/* SPDX-License-Identifier: GPL-3.0-or-later */

export function escape(text) {
    return String(text ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

export function highlightedMarkup(text, query) {
    const source = String(text ?? '');
    const needle = String(query ?? '').trim();
    if (!needle)
        return escape(source);

    const lower = source.toLocaleLowerCase();
    const q = needle.toLocaleLowerCase();
    const index = lower.indexOf(q);
    if (index >= 0) {
        return `${escape(source.slice(0, index))}<b>${escape(source.slice(index, index + needle.length))}</b>${escape(source.slice(index + needle.length))}`;
    }

    const points = Array.from(source);
    const foldedPoints = points.map(char => char.toLowerCase());
    const queryPoints = Array.from(q);
    const matched = new Set();
    let qi = 0;
    for (let i = 0; i < foldedPoints.length && qi < queryPoints.length; i++) {
        if (foldedPoints[i] === queryPoints[qi]) {
            matched.add(i);
            qi++;
        }
    }
    if (qi !== queryPoints.length)
        return escape(source);

    let markup = '';
    for (let i = 0; i < points.length; i++) {
        const char = escape(points[i]);
        markup += matched.has(i) ? `<b>${char}</b>` : char;
    }
    return markup;
}

