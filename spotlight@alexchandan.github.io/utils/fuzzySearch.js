/* SPDX-License-Identifier: GPL-3.0-or-later */

export function normalizeText(value) {
    return String(value ?? '')
        .normalize('NFKD')
        .replace(/([A-Za-z])[\u0300-\u036f]+/g, '$1')
        .toLowerCase()
        .trim();
}

function wordPrefixScore(words, query) {
    const matchingWord = words.findIndex(word => word.startsWith(query));
    if (matchingWord < 0)
        return -1;

    return 900 - matchingWord * 8;
}

function initialsScore(initials, query) {
    if (query.length < 2)
        return -1;

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

export function prepareSearchText(value) {
    const text = normalizeText(value);
    const words = text.split(/[^\p{L}\p{N}\p{M}]+/gu).filter(Boolean);
    return {text, words, initials: words.map(word => Array.from(word)[0]).join('')};
}

export function fuzzyScore(value, rawQuery) {
    return fuzzyScorePrepared(prepareSearchText(value), normalizeText(rawQuery));
}

// Providers may prepare immutable names once when their cache/index is built.
export function fuzzyScorePrepared(prepared, query) {
    const {text, words, initials} = prepared;
    if (!text || !query || query.length > text.length)
        return -1;

    if (text === query)
        return 1200;

    if (text.startsWith(query))
        return 1050 - Math.min(120, text.length - query.length);

    const wordScore = wordPrefixScore(words, query);
    if (wordScore >= 0)
        return wordScore;

    const acronymScore = initialsScore(initials, query);
    if (acronymScore >= 0)
        return acronymScore;

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

    const words = text.split(/[^\p{L}\p{N}\p{M}]+/gu).filter(Boolean);
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

    const prefixes = 'app|apps|win|window|windows|file|files|setting|settings|web|system|power|clip|clipboard|calc|calculator';
    const match = text.match(new RegExp(`^(${prefixes})\\s*:\\s*(.*)$`, 'i'))
;

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
        calc: 'calculator',
        calculator: 'calculator',
    };

    return {scope: scopeMap[prefix], term, explicit: true};
}
