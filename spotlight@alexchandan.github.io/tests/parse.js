/* SPDX-License-Identifier: GPL-3.0-or-later */
import Gio from 'gi://Gio';
for (const path of ARGV) {
    const file = Gio.File.new_for_path(path);
    const [, bytes] = file.load_contents(null);
    Reflect.parse(new TextDecoder().decode(bytes), {target: 'module', source: path});
}
print('PASS: all extension and test modules parse as GJS ES modules');
