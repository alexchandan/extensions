/* SPDX-License-Identifier: GPL-3.0-or-later */
import Clutter from 'gi://Clutter';
import St from 'gi://St';

// St gained orientation in 48 and removed vertical in 51.
export function boxOrientation(vertical = false) {
    return St.BoxLayout.find_property('orientation')
        ? {orientation: vertical ? Clutter.Orientation.VERTICAL : Clutter.Orientation.HORIZONTAL}
        : {vertical};
}

export function setScrollChild(scroll, child) {
    if (typeof scroll.set_child === 'function')
        scroll.set_child(child);
    else
        scroll.add_actor(child);
}

export function verticalAdjustment(scroll) {
    return scroll.get_vadjustment?.() ?? scroll.vscroll.adjustment;
}
