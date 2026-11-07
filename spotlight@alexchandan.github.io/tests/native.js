/* SPDX-License-Identifier: GPL-3.0-or-later */
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {FileProvider} from '../providers/fileProvider.js';
import {customSearchUrl} from '../utils/webSearch.js';
import {WebProvider} from '../providers/webProvider.js';
import {UsageStore} from '../utils/usageStore.js';

let passed = 0;
function assert(condition, message) {
    if (!condition)
        throw new Error(message);
    passed++;
    print(`PASS: ${message}`);
}
const sleep = ms => new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
    resolve();
    return GLib.SOURCE_REMOVE;
}));
async function until(predicate) {
    for (let index = 0; index < 500; index++) {
        if (predicate())
            return;
        await sleep(10);
    }
    throw new Error('Timed out waiting for asynchronous work');
}
assert(customSearchUrl('https://example.com/?q=%s', 'a & b') === 'https://example.com/?q=a%20%26%20b', 'custom web search encodes query safely');
for (const template of ['javascript:%s', 'file:///%s', 'https://example.com/', 'https:///?q=%s', 'https://bad host/?q=%s']) {
    let rejected = false;
    try { customSearchUrl(template, 'test'); } catch (_error) { rejected = true; }
    assert(rejected, 'invalid custom URL rejected: ' + template);
}
const fixture = GLib.getenv('SPOTLIGHT_FIXTURE');
const settings = new Gio.Settings({schema_id: 'org.gnome.shell.extensions.spotlight'});
const web = new WebProvider(settings);
settings.set_string('web-engine', 'custom');
settings.set_string('custom-search-url', 'invalid');
assert(web.search('private')[0].type === 'info', 'invalid custom engine never silently falls back to another provider');
web.destroy();
settings.set_boolean('enable-file-search', false);
const provider = new FileProvider(settings);
const root = Gio.File.new_for_path(`${fixture}/files`);
provider._getRootJobs = () => [
    {file: root, depth: 0, maxDepth: 1},
    {file: root.get_child('special'), depth: 0, maxDepth: 4},
];
provider.setEnabled(true);
await until(() => !provider.isIndexing);
assert(provider.search('deep-report', 5).length === 1, 'overlapping roots still index deep descendants');
assert(provider.search('resume', 5).some(result => result.title === 'résumé.txt'), 'accent-insensitive real file search');
assert(!provider._entries.some(entry => entry.path.includes('secret') || entry.path.includes('dependency')), 'hidden and dependency trees excluded');
assert(new Set(provider._entries.map(entry => entry.path)).size === provider._entries.length, 'paths are deduplicated');
assert(provider._entries.length < 20, 'symlink loops are not followed');
provider.setEnabled(false);
assert(provider._entries.length === 0 && provider.getRecentResults([{id: 'file:test'}]).length === 0, 'disabling file search releases its index');
settings.set_int('file-index-limit', 500);
provider._getRootJobs = () => [{file: Gio.File.new_for_path(`${fixture}/bulk`), depth: 0, maxDepth: 4}];
provider.setEnabled(true);
await until(() => !provider.isIndexing);
assert(provider._entries.length === 500, 'file index obeys configured hard limit');
provider.rebuildIndex();
provider.rebuildIndex();
provider.destroy();
await sleep(100);
assert(provider._entries.length === 0 && !provider.isIndexing, 'cancelled rebuild cannot repopulate destroyed provider');

const store = new UsageStore();
await sleep(50);
store.recordActivation('secret', {id: 'clipboard:secret', type: 'clipboard', title: 'secret'}, '~secret');
assert(store.getQueryHistory().length === 0 && store.getRecentEvents().length === 0, 'clipboard activations cannot enter persistent history');
store.recordActivation('test', {id: 'app:test.desktop', type: 'app', title: 'Test'}, '@test');
await until(() => !store._saving);
assert(store.getQueryHistory()[0] === '@test' && store.getBoost('test', 'app:test.desktop') > 0, 'activation learns ranking and query history');
const info = store._file.query_info('unix::mode', Gio.FileQueryInfoFlags.NONE, null);
assert((info.get_attribute_uint32('unix::mode') & 0o077) === 0, 'saved history is owner-only');
store.setPrivacy({rememberQueries: false, learnRanking: true});
store.recordActivation('private-query', {id: 'app:test.desktop', type: 'app', title: 'Test'}, '@private-query');
await until(() => !store._saving);
assert(store.getQueryHistory().length === 0 && store._data.events.every(event => event.query === ''), 'query-history opt-out also removes queries from ranking events');
store.clear();
await until(() => !store._saving);
assert(store.getRecentEvents().length === 0, 'clear history persists an empty store');
store.destroy();

const legacy = Gio.File.new_for_path(`${GLib.get_user_data_dir()}/spotlight@alexchandan/usage.json`);
legacy.replace_contents(JSON.stringify({events: [{id: 'clipboard:legacy-secret', type: 'clipboard', query: 'legacy-secret', timestamp: Date.now()}], queries: ['legacy-secret']}), null, false, Gio.FileCreateFlags.PRIVATE, null);
const migrated = new UsageStore();
await sleep(100);
await until(() => !migrated._saving);
const [, contents] = legacy.load_contents(null);
assert(!new TextDecoder().decode(contents).includes('legacy-secret'), 'legacy clipboard data is scrubbed from disk');
migrated.destroy();
print(`Native integration assertions: ${passed}`);
