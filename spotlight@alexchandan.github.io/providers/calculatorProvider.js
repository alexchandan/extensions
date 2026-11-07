/* SPDX-License-Identifier: GPL-3.0-or-later */

import St from 'gi://St';

import {ExpressionParser} from '../utils/expression.js';

function formatResult(value) {
    if (Number.isInteger(value))
        return String(value);

    return Number(value.toPrecision(12)).toString();
}

export class CalculatorProvider {
    search(query, {explicit = false} = {}) {
        const raw = query.trim();
        if (!raw) {
            if (explicit) {
                return [{
                    id: 'calculator:hint',
                    type: 'calculator',
                    category: 'CALC',
                    title: 'Calculator',
                    subtitle: 'Type a math expression (e.g. = 45 * 12 or (100 - 20) / 4)',
                    iconName: 'accessories-calculator-symbolic',
                    score: 1500,
                    activate: null,
                }];
            }
            return [];
        }

        const expression = raw
            .replace(/[×xX]/g, '*')
            .replace(/÷/g, '/')
            .replace(/,/g, '.');

        if (!explicit && !/[+\-*/%^]/.test(expression))
            return [];

        if (!/\d/.test(expression)) {
            if (explicit) {
                return [{
                    id: 'calculator:hint',
                    type: 'calculator',
                    category: 'CALC',
                    title: 'Calculator',
                    subtitle: 'Type a math expression (e.g. = 45 * 12 or (100 - 20) / 4)',
                    iconName: 'accessories-calculator-symbolic',
                    score: 1500,
                    activate: null,
                }];
            }
            return [];
        }

        if (!/^[\d\s+\-*/%^().]+$/.test(expression))
            return [];

        try {
            const value = new ExpressionParser(expression).parse();
            const formatted = formatResult(value);

            return [{
                id: `calculator:${raw}`,
                type: 'calculator',
                category: 'CALC',
                title: formatted,
                subtitle: `${raw} =`,
                iconName: 'accessories-calculator-symbolic',
                shortcutLabel: 'Copy ↵',
                score: 1500,
                activate: () => {
                    const clipboard = St.Clipboard.get_default();
                    clipboard.set_text(
                        St.ClipboardType.CLIPBOARD ?? 1,
                        formatted
                    );

                },
            }];
        } catch (_error) {
            if (explicit) {
                return [{
                    id: 'calculator:evaluating',
                    type: 'calculator',
                    category: 'CALC',
                    title: 'Calculator',
                    subtitle: 'Enter a valid finite expression (maximum 256 characters)',
                    iconName: 'accessories-calculator-symbolic',
                    score: 1500,
                    activate: null,
                }];
            }
            return [];
        }
    }

    destroy() {}
}
