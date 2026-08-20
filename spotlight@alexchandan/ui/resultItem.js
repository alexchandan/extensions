/* SPDX-License-Identifier: GPL-3.0-or-later */

import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import St from 'gi://St';

export const ResultItem = GObject.registerClass(
class ResultItem extends St.BoxLayout {
    _init(onActivate, onSelect) {
        super._init({
            style_class: 'spotlight-result-item',
            reactive: true,
            track_hover: true,
            can_focus: false,
            vertical: false,
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
            vertical: true,
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

        this._shortcutLabel = new St.Label({
            style_class: 'spotlight-result-shortcut',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.add_child(this._shortcutLabel);

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

    setResult(result) {
        this._result = result;
        this._nameLabel.text = result.title ?? '';
        this._descLabel.text = result.subtitle ?? '';
        this._descLabel.visible = Boolean(result.subtitle);
        this._shortcutLabel.text = result.shortcutLabel ?? '';
        this._shortcutLabel.visible = Boolean(result.shortcutLabel);
        this.reactive = typeof result.activate === 'function';

        this.accessible_name = result.subtitle
            ? `${result.title}, ${result.subtitle}`
            : result.title;

        if (result.gicon) {
            this._icon.gicon = result.gicon;
            this._icon.icon_name = null;
        } else {
            this._icon.gicon = null;
            this._icon.icon_name = result.iconName || 'edit-find-symbolic';
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
