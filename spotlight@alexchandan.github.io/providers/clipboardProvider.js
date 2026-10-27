/* SPDX-License-Identifier: GPL-3.0-or-later */

import St from 'gi://St';

import {bestFieldScore} from '../utils/fuzzySearch.js';

const MAX_HISTORY = 12;

export class ClipboardProvider {
    constructor() {
        this._clipboard = St.Clipboard.get_default();
        this._history = [];
    }

    capture(callback = null) {
        this._clipboard.get_text((St.ClipboardType.CLIPBOARD ?? 1), (_clipboard, text) => {
            const cleaned = (text ?? '').trim();
            if (cleaned && cleaned.length <= 4000) {
                this._history = [
                    cleaned,
                    ...this._history.filter(item => item !== cleaned),
                ].slice(0, MAX_HISTORY);
            }
            callback?.();
        });
    }

    getPrimarySelection(callback) {
        this._clipboard.get_text((St.ClipboardType.PRIMARY ?? 0), (_clipboard, text) =>
            callback?.((text ?? '').trim()));
    }

    search(query, limit = 5, {explicit = false} = {}) {
        const term = query.trim();
        if (!term && !explicit)
            return [];

        const results = this._history
            .map((text, index) => {
                const score = term
                    ? bestFieldScore(term, [{value: text, weight: 1}])
                    : 1000 - index;
                if (score < 0)
                    return null;

                const oneLine = text.replace(/\s+/g, ' ');
                const title = oneLine.length > 90
                    ? `${oneLine.slice(0, 87)}…`
                    : oneLine;

                return {
                    id: `clipboard:${index}:${text.slice(0, 48)}`,
                    type: 'clipboard',
                    category: 'CLIP',
                    title,
                    subtitle: 'Clipboard history · session only',
                    iconName: 'edit-paste-symbolic',
                    score,
                    shortcutLabel: 'Copy ↵',
                    activate: () => {
                        this._clipboard.set_text(
                            (St.ClipboardType.CLIPBOARD ?? 1),
                            text
                        );
                        try {
                            this._clipboard.set_text(
                                (St.ClipboardType.PRIMARY ?? 0),
                                text
                            );
                        } catch (_e) {}
                    },
                };
            })
            .filter(Boolean)
            .sort((a, b) => b.score - a.score)
            .slice(0, limit);

        if (explicit && results.length === 0) {
            return [{
                id: 'clipboard:empty',
                type: 'info',
                title: 'No clipboard history yet',
                subtitle: 'Copy some text while Spotlight is running, then open Spotlight again.',
                iconName: 'edit-paste-symbolic',
                score: 0,
                activate: null,
            }];
        }

        return results;
    }

    destroy() {
        this._history = [];
        this._clipboard = null;
    }
}
