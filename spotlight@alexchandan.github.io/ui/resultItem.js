/* SPDX-License-Identifier: GPL-3.0-or-later */

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import St from 'gi://St';

function escape(text) {
    return GLib.markup_escape_text(String(text ?? ''), -1);
}

function highlightedMarkup(text, query) {
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

    const matched = new Set();
    let qi = 0;
    for (let i = 0; i < lower.length && qi < q.length; i++) {
        if (lower[i] === q[qi]) {
            matched.add(i);
            qi++;
        }
    }
    if (qi !== q.length)
        return escape(source);

    let markup = '';
    for (let i = 0; i < source.length; i++) {
        const char = escape(source[i]);
        markup += matched.has(i) ? `<b>${char}</b>` : char;
    }
    return markup;
}

export const ResultItem = GObject.registerClass(
class ResultItem extends St.BoxLayout {
    _init(onActivate, onSelect) {
        super._init({
            style_class: 'spotlight-result-item',
            reactive: true,
            track_hover: true,
            can_focus: false,
            orientation: Clutter.Orientation.HORIZONTAL,
            x_expand: true,
        });

        this._result = null;
        this._onActivate = onActivate;
        this._onSelect = onSelect;

        this._icon = new St.Icon({
            style_class: 'spotlight-result-icon',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.add_child(this._icon);

        this._textBox = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            style_class: 'spotlight-result-text',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.add_child(this._textBox);

        this._nameLabel = new St.Label({
            style_class: 'spotlight-result-name',
            x_expand: true,
        });
        this._nameLabel.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        this._textBox.add_child(this._nameLabel);

        this._descLabel = new St.Label({
            style_class: 'spotlight-result-desc',
            x_expand: true,
        });
        this._descLabel.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        this._textBox.add_child(this._descLabel);

        this._rightBox = new St.BoxLayout({
            style_class: 'spotlight-result-meta',
            orientation: Clutter.Orientation.HORIZONTAL,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.add_child(this._rightBox);

        this._categoryLabel = new St.Label({
            style_class: 'spotlight-result-category',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._rightBox.add_child(this._categoryLabel);

        this._shortcutLabel = new St.Label({
            style_class: 'spotlight-result-shortcut',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._rightBox.add_child(this._shortcutLabel);

        this.connect('enter-event', () => {
            if (this.reactive && this._result)
                this._onSelect?.(this);
            return Clutter.EVENT_PROPAGATE;
        });

        this.connect('button-release-event', (_actor, event) => {
            if (event.get_button() !== 1)
                return Clutter.EVENT_PROPAGATE;

            this.activate(event.get_time());
            return Clutter.EVENT_STOP;
        });
    }

    setResult(result, query = '', {showCategory = true} = {}) {
        this._result = result;
        const isSection = result.type === 'section';

        this.remove_style_class_name('spotlight-result-section');
        this.remove_style_class_name('spotlight-result-danger');
        if (isSection)
            this.add_style_class_name('spotlight-result-section');
        if (result.danger)
            this.add_style_class_name('spotlight-result-danger');

        this._nameLabel.clutter_text.set_markup(
            isSection ? escape(result.title ?? '') : highlightedMarkup(result.title, query)
        );
        this._descLabel.text = result.subtitle ?? '';
        this._descLabel.visible = Boolean(result.subtitle) && !isSection;

        this._categoryLabel.text = result.category ?? '';
        this._categoryLabel.visible = showCategory && Boolean(result.category) && !isSection;
        this._shortcutLabel.text = result.shortcutLabel ?? '';
        this._shortcutLabel.visible = Boolean(result.shortcutLabel) && !isSection;
        this._rightBox.visible = this._categoryLabel.visible || this._shortcutLabel.visible;

        this.reactive = typeof result.activate === 'function';
        this._icon.visible = !isSection;

        this.accessible_name = result.subtitle
            ? `${result.title}, ${result.subtitle}`
            : result.title;

        if (!isSection) {
            if (result.gicon) {
                this._icon.gicon = result.gicon;
                this._icon.icon_name = null;
            } else {
                this._icon.gicon = null;
                this._icon.icon_name = result.iconName || 'edit-find-symbolic';
            }
        }

        this.show();
    }

    clearResult() {
        this._result = null;
        this.setSelected(false);
        this.hide();
    }

    activate(timestamp = 0) {
        if (this._result && typeof this._result.activate === 'function')
            this._onActivate(this._result, timestamp);
    }

    setSelected(selected) {
        if (selected)
            this.add_style_pseudo_class('selected');
        else
            this.remove_style_pseudo_class('selected');
    }
});
