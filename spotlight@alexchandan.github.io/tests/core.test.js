/* SPDX-License-Identifier: GPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import {fuzzyScore, getMatchTier, normalizeText, parseScopedQuery} from '../utils/fuzzySearch.js';
import {ExpressionParser} from '../utils/expression.js';
import {highlightedMarkup} from '../utils/markup.js';
import {isSafeShortcut} from '../utils/shortcuts.js';

for (const [expression, expected] of [
    ['25 * 18', 450], ['2+3*4', 14], ['(2+3)*4', 20], ['2^3^2', 512],
    ['-2^2', -4], ['2^-2', 0.25], ['5%2', 1], ['.5 + .25', 0.75], ['1,5', null],
]) {
    test(`calculator: ${expression}`, () => {
        if (expected === null)
            assert.throws(() => new ExpressionParser(expression).parse());
        else
            assert.equal(new ExpressionParser(expression).parse(), expected);
    });
}
for (const input of ['1/0', '0/0', '2**3', '1;global.foo=1', '(2', '2foo', '('.repeat(1000), '9^9999'])
    test(`calculator rejects ${input.slice(0, 30)}`, () => assert.throws(() => new ExpressionParser(input).parse()));

test('search ranks exact above prefix, acronym and subsequence', () => {
    assert(fuzzyScore('Firefox', 'firefox') > fuzzyScore('Firefox Browser', 'firefox'));
    assert(fuzzyScore('Visual Studio Code', 'vsc') > 0);
    assert.equal(fuzzyScore('Firefox', 'unrelated'), -1);
});
test('Unicode search preserves Hindi marks and matches non-Latin word boundaries', () => {
    assert.equal(normalizeText('résumé'), 'resume');
    assert.equal(normalizeText('हिन्दी'), 'हिन्दी'.normalize('NFKD'));
    assert.equal(getMatchTier('Мой Документ', 'док'), 'word-prefix');
    assert.equal(getMatchTier('我的 文件', '文件'), 'word-exact');
});
for (const [input, scope, term] of [['@ firefox', 'apps', 'firefox'], ['#résumé', 'files', 'résumé'], ['win:', 'windows', ''], ['=2+2', 'calculator', '2+2'], ['~secret', 'clipboard', 'secret'], ['?gnome', 'web', 'gnome'], ['!', 'system', ''], ['!restart', 'system', 'restart'], ['system: log out', 'system', 'log out'], ['SETTINGS: display', 'settings', 'display'], ['ordinary text', 'all', 'ordinary text']])
    test(`scope ${input}`, () => assert.deepEqual(parseScopedQuery(input), {scope, term, explicit: scope !== 'all'}));

test('highlighting escapes untrusted markup and preserves emoji', () => {
    assert.equal(highlightedMarkup('<b>&', 'b'), '&lt;<b>b</b>&gt;&amp;');
    assert.equal(highlightedMarkup('🚀 Rocket', 'rt'), '🚀 <b>R</b>ocke<b>t</b>');
});
test('global shortcuts cannot steal ordinary typing', () => {
    for (const key of ['a', '<Shift>a', '<Control>', '<Alt><Shift>', '', null])
        assert.equal(isSafeShortcut(key), false);
    for (const key of ['<Control><Super>space', '<Alt>F2', '<Primary>space'])
        assert.equal(isSafeShortcut(key), true);
});

test('ordinary phrases do not accidentally switch providers', () => {
    assert.equal(parseScopedQuery('file manager').scope, 'all');
    assert.equal(parseScopedQuery('windows terminal').scope, 'all');
});
