/* SPDX-License-Identifier: GPL-3.0-or-later */
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {prepareSearchText} from '../utils/fuzzySearch.js';
import {FileProvider} from '../providers/fileProvider.js';
const settings = new Gio.Settings({schema_id: 'org.gnome.shell.extensions.spotlight'});
settings.set_boolean('enable-file-search', false);
const provider = new FileProvider(settings);
provider._enabled = true;
for (let index = 0; index < 10000; index++) {
    const path = `/tmp/spotlight-benchmark/documents/project-${index}/report-${index}.pdf`;
    provider._entries.push({id: path, path, name: `report-${index}.pdf`, nameSearch: prepareSearchText(`report-${index}.pdf`),
        pathSearch: prepareSearchText(path), file: Gio.File.new_for_path(path), isDirectory: false, gicon: null});
}
const times = [];
for (let index = 0; index < 15; index++) {
    const start = GLib.get_monotonic_time();
    provider.search(index % 2 ? 'report' : 'rpt', 8);
    times.push((GLib.get_monotonic_time() - start) / 1000);
}
times.sort((a, b) => a - b);
print(JSON.stringify({entries: 10000, searches: times.length, median_ms: times[7], max_ms: times.at(-1)}));
provider.destroy();
