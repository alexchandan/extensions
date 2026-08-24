/* SPDX-License-Identifier: GPL-3.0-or-later */

export function normalizeText(value) {
    return String(value ?? '')
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim();
}

function wordPrefixScore(text, query) {
    const words = text.split(/[^a-z0-9]+/).filter(Boolean);
    const matchingWord = words.findIndex(word => word.startsWith(query));
    if (matchingWord < 0)
        return -1;

    return 900 - matchingWord * 8;
}

function initialsScore(text, query) {
    if (query.length < 2)
        return -1;

    const initials = text
        .split(/[^a-z0-9]+/)
        .filter(Boolean)
        .map(word => word[0])
        .join('');

    if (initials === query)
        return 930;
    if (initials.startsWith(query))
        return 900 - (initials.length - query.length) * 3;

    return -1;
}

function subsequenceScore(text, query) {
    let textIndex = 0;
    let queryIndex = 0;
    let gapPenalty = 0;
    let lastMatch = -1;
    let contiguousBonus = 0;

    while (textIndex < text.length && queryIndex < query.length) {
        if (text[textIndex] === query[queryIndex]) {
            if (lastMatch >= 0) {
                const gap = textIndex - lastMatch - 1;
                gapPenalty += gap * 7;
                if (gap === 0)
                    contiguousBonus += 12;
            }

            lastMatch = textIndex;
            queryIndex++;
        }
        textIndex++;
    }

    if (queryIndex !== query.length)
        return -1;

    const startPenalty = Math.max(0, lastMatch - query.length + 1) * 2;
    const lengthPenalty = Math.max(0, text.length - query.length);
    return 610 + contiguousBonus - gapPenalty - startPenalty - lengthPenalty;
}

export function fuzzyScore(value, rawQuery) {
    const text = normalizeText(value);
    const query = normalizeText(rawQuery);

    if (!text || !query)
        return -1;

    if (text === query)
        return 1200;

    if (text.startsWith(query))
        return 1050 - Math.min(120, text.length - query.length);

    const wordScore = wordPrefixScore(text, query);
    if (wordScore >= 0)
        return wordScore;

    const initials = initialsScore(text, query);
    if (initials >= 0)
        return initials;

    const substringIndex = text.indexOf(query);
    if (substringIndex >= 0)
        return 760 - substringIndex * 5 - Math.min(100, text.length - query.length);

    return subsequenceScore(text, query);
}

export function getMatchTier(value, rawQuery) {
    const text = normalizeText(value);
    const query = normalizeText(rawQuery);
    if (!text || !query)
        return 'none';
    if (text === query)
        return 'exact';
    if (text.startsWith(query))
        return 'prefix';

    const words = text.split(/[^a-z0-9]+/).filter(Boolean);
    if (words.some(word => word === query))
        return 'word-exact';
    if (words.some(word => word.startsWith(query)))
        return 'word-prefix';

    const initials = words.map(word => word[0]).join('');
    if (query.length >= 2 && (initials === query || initials.startsWith(query)))
        return 'acronym';
    if (text.includes(query))
        return 'substring';
    return fuzzyScore(text, query) >= 0 ? 'fuzzy' : 'none';
}

export function bestFieldScore(query, fields) {
    let best = -1;

    for (const field of fields) {
        if (!field?.value)
            continue;

        const score = fuzzyScore(field.value, query);
        if (score < 0)
            continue;

        const weighted = Math.round(score * (field.weight ?? 1));
        best = Math.max(best, weighted);
    }

    return best;
}

export function parseScopedQuery(rawText) {
    const text = rawText.trim();

    const shortPrefix = text[0];
    const shortMap = {
        '@': 'apps',
        '#': 'files',
        '!': 'system',
        '?': 'web',
        '~': 'clipboard',
    };
    if (shortMap[shortPrefix])
        return {scope: shortMap[shortPrefix], term: text.slice(1).trim(), explicit: true};

    if (text.startsWith('='))
        return {scope: 'calculator', term: text.slice(1).trim(), explicit: true};

    const prefixes = 'app|apps|win|window|windows|file|files|setting|settings|web|system|power|clip|clipboard';
    const match = text.match(new RegExp(`^(${prefixes})\\s*:\\s*(.*)$`, 'i'))
        ?? text.match(new RegExp(`^(${prefixes})\\s+(.+)$`, 'i'));

    if (!match)
        return {scope: 'all', term: text, explicit: false};

    const prefix = match[1].toLowerCase();
    const term = match[2].trim();

    const scopeMap = {
        app: 'apps',
        apps: 'apps',
        win: 'windows',
        window: 'windows',
        windows: 'windows',
        file: 'files',
        files: 'files',
        setting: 'settings',
        settings: 'settings',
        web: 'web',
        system: 'system',
        power: 'system',
        clip: 'clipboard',
        clipboard: 'clipboard',
    };

    return {scope: scopeMap[prefix], term, explicit: true};
}
