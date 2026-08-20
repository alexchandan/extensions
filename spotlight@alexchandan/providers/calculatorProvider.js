/* SPDX-License-Identifier: GPL-3.0-or-later */

import St from 'gi://St';

class ExpressionParser {
    constructor(text) {
        this._text = text;
        this._index = 0;
    }

    parse() {
        const value = this._parseExpression();
        this._skipWhitespace();

        if (this._index !== this._text.length)
            throw new Error('Unexpected token');
        if (!Number.isFinite(value))
            throw new Error('Result is not finite');

        return value;
    }

    _skipWhitespace() {
        while (/\s/.test(this._text[this._index] ?? ''))
            this._index++;
    }

    _peek() {
        this._skipWhitespace();
        return this._text[this._index] ?? '';
    }

    _consume(char) {
        if (this._peek() !== char)
            return false;

        this._index++;
        return true;
    }

    _parseExpression() {
        let value = this._parseTerm();

        while (true) {
            if (this._consume('+'))
                value += this._parseTerm();
            else if (this._consume('-'))
                value -= this._parseTerm();
            else
                return value;
        }
    }

    _parseTerm() {
        let value = this._parseUnary();

        while (true) {
            if (this._consume('*'))
                value *= this._parseUnary();
            else if (this._consume('/'))
                value /= this._parseUnary();
            else if (this._consume('%'))
                value %= this._parseUnary();
            else
                return value;
        }
    }

    _parseUnary() {
        if (this._consume('+'))
            return this._parseUnary();
        if (this._consume('-'))
            return -this._parseUnary();
        return this._parsePower();
    }

    _parsePower() {
        const base = this._parsePrimary();
        if (this._consume('^'))
            return base ** this._parseUnary();
        return base;
    }

    _parsePrimary() {
        if (this._consume('(')) {
            const value = this._parseExpression();
            if (!this._consume(')'))
                throw new Error('Missing closing parenthesis');
            return value;
        }

        return this._parseNumber();
    }

    _parseNumber() {
        this._skipWhitespace();
        const rest = this._text.slice(this._index);
        const match = rest.match(/^(?:\d+(?:\.\d*)?|\.\d+)/);

        if (!match)
            throw new Error('Expected a number');

        this._index += match[0].length;
        return Number(match[0]);
    }
}

function formatResult(value) {
    if (Number.isInteger(value))
        return String(value);

    return Number(value.toPrecision(12)).toString();
}

export class CalculatorProvider {
    search(query) {
        const expression = query.trim();
        if (!expression || !/\d/.test(expression))
            return [];

        if (!/^[\d\s+\-*/%^().]+$/.test(expression))
            return [];

        try {
            const value = new ExpressionParser(expression).parse();
            const formatted = formatResult(value);

            return [{
                id: `calculator:${expression}`,
                type: 'calculator',
                title: formatted,
                subtitle: `${expression} =`,
                iconName: 'accessories-calculator-symbolic',
                shortcutLabel: 'Copy ↵',
                score: 1500,
                activate: () => {
                    St.Clipboard.get_default().set_text(
                        St.ClipboardType.CLIPBOARD,
                        formatted
                    );
                },
            }];
        } catch (_error) {
            return [];
        }
    }

    destroy() {}
}
