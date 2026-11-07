/* SPDX-License-Identifier: GPL-3.0-or-later */

import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import St from 'gi://St';

import {boxOrientation} from '../utils/compat.js';
import {escape, highlightedMarkup} from '../utils/markup.js';

export const ResultItem = GObject.registerClass(
class ResultItem extends St.Button {
    _init(onActivate, onSelect, onKeyPress) {
        super._init({
            style_class: 'spotlight-result-item',
            reactive: true,
            track_hover: true,
            can_focus: true,
            x_expand: true,
        });

        this._content = new St.BoxLayout({style_class: 'spotlight-result-content',
            ...boxOrientation(), x_expand: true});
        this.set_child(this._content);
        this._result = null;
        this._onActivate = onActivate;
        this._onSelect = onSelect;

        this._icon = new St.Icon({
            style_class: 'spotlight-result-icon',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._content.add_child(this._icon);

        this._textBox = new St.BoxLayout({
            ...boxOrientation(true),
            style_class: 'spotlight-result-text',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._content.add_child(this._textBox);

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
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._content.add_child(this._rightBox);

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

        this.connect('key-focus-in', () => this._onSelect?.(this));
        this.connect('key-press-event', (_actor, event) => onKeyPress(event));
        this.connect('clicked', () => this.activate(global.get_current_time()));
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
        this.can_focus = this.reactive;
        this._icon.visible = !isSection;

        this.accessible_name = result.subtitle
            ? `${result.title}, ${result.subtitle}`
            : result.title;

        if (!isSection) {
            if (result.gicon) {
                this._icon.gicon = result.gicon;
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
