/* SPDX-License-Identifier: GPL-3.0-or-later */

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as ShellMain from 'resource:///org/gnome/shell/ui/main.js';

import {AppProvider} from '../providers/appProvider.js';
import {CalculatorProvider} from '../providers/calculatorProvider.js';
import {ClipboardProvider} from '../providers/clipboardProvider.js';
import {FileProvider} from '../providers/fileProvider.js';
import {SettingsProvider} from '../providers/settingsProvider.js';
import {SystemProvider} from '../providers/systemProvider.js';
import {WebProvider} from '../providers/webProvider.js';
import {WindowProvider} from '../providers/windowProvider.js';
import {getMatchTier, parseScopedQuery} from '../utils/fuzzySearch.js';
import {UsageStore} from '../utils/usageStore.js';
import {ResultItem} from './resultItem.js';

const ANIMATION_TIME = 150;

const RESULT_TYPE_BASE_OFFSET = new Map([
    ['window', 150],
    ['settings', 95],
    ['system', 260],
]);

const TYPE_TO_PROVIDER = new Map([
    ['app', 'apps'],
    ['file', 'files'],
    ['window', 'windows'],
    ['settings', 'settings'],
    ['calculator', 'calculator'],
    ['system', 'system'],
    ['clipboard', 'clipboard'],
    ['web', 'web'],
]);

const TYPE_PREFERENCE = new Map([
    ['app', 70],
    ['file', 30],
    ['window', 20],
    ['settings', 10],
    ['calculator', 0],
    ['system', 0],
    ['clipboard', 0],
    ['web', -1000],
]);

function exactMatchBonus(result, query, enabled) {
    if (!enabled || !query || !result?.title)
        return 0;

    switch (getMatchTier(result.title, query)) {
    case 'exact':
        return 150;
    case 'word-exact':
        return 110;
    case 'prefix':
        return 80;
    case 'word-prefix':
        return 55;
    case 'acronym':
        return 50;
    default:
        return 0;
    }
}

export class SpotlightOverlay {
    constructor(settings) {
        this._settings = settings;
        this._isOpen = false;
        this._closing = false;
        this._grab = null;
        this._selectedIndex = -1;
        this._currentResults = [];
        this._resultItems = [];
        this._signalIds = [];
        this._blurFailureLogged = false;
        this._activeSearchTerm = '';
        this._historyIndex = -1;
        this._historyDraft = '';
        this._restoringHistory = false;

        this._usageStore = new UsageStore();
        this._providers = {
            apps: new AppProvider(settings),
            calculator: new CalculatorProvider(),
            clipboard: new ClipboardProvider(),
            files: new FileProvider(settings),
            settings: new SettingsProvider(),
            system: new SystemProvider(),
            web: new WebProvider(settings),
            windows: new WindowProvider(),
        };

        this._interfaceSettings = new Gio.Settings({
            schema_id: 'org.gnome.desktop.interface',
        });
        this._stSettings = St.Settings.get();

        this._buildUI();
        this._connectSignals();
        this._applyAppearance();
        this._applyBlur();
        this._applyDensity();
    }

    _buildUI() {
        this._dimmer = new St.Widget({
            style_class: 'spotlight-dimmer',
            reactive: true,
        });
        this._dimmer.connect('button-release-event', (_actor, event) => {
            if (event.get_button() === 1) {
                this.close();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });

        this._container = new St.BoxLayout({
            style_class: 'spotlight-container',
            vertical: true,
        });

        this._entry = new St.Entry({
            style_class: 'spotlight-entry',
            can_focus: true,
            hint_text: 'Search apps, windows, files, settings…',
            x_expand: true,
            accessible_name: 'Spotlight search',
        });
        this._entry.set_primary_icon(new St.Icon({
            style_class: 'spotlight-search-icon',
            icon_name: 'edit-find-symbolic',
        }));
        this._entry.clutter_text.connect('text-changed', () => this._onTextChanged());
        this._entry.clutter_text.connect('key-press-event', (_actor, event) =>
            this._onKeyPress(event));
        this._container.add_child(this._entry);

        this._resultsScroll = new St.ScrollView({
            style_class: 'spotlight-results-scroll',
            x_expand: true,
        });
        this._resultsBox = new St.BoxLayout({
            style_class: 'spotlight-results',
            vertical: true,
            x_expand: true,
        });
        this._resultsScroll.set_child(this._resultsBox);
        this._container.add_child(this._resultsScroll);

        this._topActor = new St.Widget({
            layout_manager: new Clutter.FixedLayout(),
            visible: false,
            reactive: true,
        });
        this._topActor.add_child(this._dimmer);
        this._topActor.add_child(this._container);
        ShellMain.layoutManager.uiGroup.add_child(this._topActor);
    }

    _connectSignals() {
        const connectSetting = (key, callback) => {
            const id = this._settings.connect(`changed::${key}`, callback);
            this._signalIds.push([this._settings, id]);
        };

        connectSetting('theme-mode', () => {
            this._applyAppearance();
            this._applyBlur();
        });
        connectSetting('background-opacity', () => this._applyAppearance());
        connectSetting('blur-enabled', () => this._applyBlur());
        connectSetting('blur-strength', () => this._applyBlur());
        connectSetting('result-density', () => this._applyDensity());
        connectSetting('panel-width', () => this._relayout());

        for (const key of [
            'result-count',
            'show-web-search',
            'web-engine',
            'custom-search-url',
            'enable-window-search',
            'enable-settings-search',
            'enable-clipboard-search',
            'provider-order',
            'prefer-exact-matches',
            'learn-ranking',
            'boost-running-apps',
            'boost-favorite-apps',
            'boost-recent-results',
            'show-category-badges',
        ]) {
            connectSetting(key, () => this._refreshVisibleResults());
        }

        connectSetting('enable-file-search', () => {
            this._providers.files.setEnabled(
                this._settings.get_boolean('enable-file-search')
            );
            this._refreshVisibleResults();
        });
        connectSetting('file-index-limit', () => {
            if (this._settings.get_boolean('enable-file-search'))
                this._providers.files.rebuildIndex();
        });
        connectSetting('history-clear-token', () => {
            this._usageStore.clear();
            if (this._isOpen && !this._entry.get_text().trim())
                this._showQuickResults();
        });

        this._signalIds.push([
            this._interfaceSettings,
            this._interfaceSettings.connect('changed::color-scheme', () => {
                if (this._settings.get_string('theme-mode') === 'system') {
                    this._applyAppearance();
                    this._applyBlur();
                }
            }),
        ]);

        try {
            const id = this._stSettings.connect('notify::high-contrast', () =>
                this._applyAppearance());
            this._signalIds.push([this._stSettings, id]);
        } catch (_error) {
            // Older supported Shell versions may not expose this notification.
        }

        this._monitorsChangedId = ShellMain.layoutManager.connect(
            'monitors-changed',
            () => this._relayout()
        );
    }

    _getThemeMode() {
        const configured = this._settings.get_string('theme-mode');
        if (configured === 'dark' || configured === 'light')
            return configured;

        const colorScheme = this._interfaceSettings.get_string('color-scheme');
        return colorScheme === 'prefer-dark' ? 'dark' : 'light';
    }

    _applyAppearance() {
        if (!this._topActor)
            return;

        const mode = this._getThemeMode();
        this._topActor.remove_style_class_name('spotlight-dark');
        this._topActor.remove_style_class_name('spotlight-light');
        this._topActor.add_style_class_name(`spotlight-${mode}`);

        let highContrast = false;
        try {
            highContrast = Boolean(this._stSettings.high_contrast);
        } catch (_error) {
            highContrast = false;
        }
        if (highContrast)
            this._topActor.add_style_class_name('spotlight-high-contrast');
        else
            this._topActor.remove_style_class_name('spotlight-high-contrast');

        const opacity = Math.max(0.35, Math.min(
            1,
            this._settings.get_double('background-opacity')
        ));
        const rgb = mode === 'dark' ? '24, 24, 26' : '248, 248, 250';
        const dimmer = mode === 'dark' ? 0.28 : 0.16;

        this._container.set_style(`background-color: rgba(${rgb}, ${opacity});`);
        this._dimmer.set_style(`background-color: rgba(0, 0, 0, ${dimmer});`);
    }

    _applyDensity() {
        if (!this._topActor)
            return;

        this._topActor.remove_style_class_name('spotlight-compact');
        this._topActor.remove_style_class_name('spotlight-comfortable');
        this._topActor.add_style_class_name(
            this._settings.get_string('result-density') === 'compact'
                ? 'spotlight-compact'
                : 'spotlight-comfortable'
        );
    }

    _applyBlur() {
        if (!this._dimmer || !this._container)
            return;

        this._dimmer.clear_effects();
        this._container.clear_effects();
        if (!this._settings.get_boolean('blur-enabled'))
            return;

        const strength = this._settings.get_int('blur-strength');
        if (strength <= 0)
            return;

        const mode = this._getThemeMode();
        const brightness = mode === 'dark' ? 0.72 : 0.9;

        try {
            this._dimmer.add_effect(new Shell.BlurEffect({
                sigma: Math.max(1, Math.round(strength * 0.55)),
                brightness: Math.min(1, brightness + 0.08),
                mode: Shell.BlurMode.BACKGROUND,
            }));
            this._container.add_effect(new Shell.BlurEffect({
                sigma: strength,
                brightness,
                mode: Shell.BlurMode.BACKGROUND,
            }));
        } catch (error) {
            if (!this._blurFailureLogged) {
                logError(error, 'Spotlight: background blur unavailable; using translucent fallback');
                this._blurFailureLogged = true;
            }
        }
    }

    _getTargetMonitor() {
        const monitors = ShellMain.layoutManager.monitors ?? [];
        const focusedWindow = global.display.focus_window;
        const focusedMonitorIndex = focusedWindow?.get_monitor?.() ?? -1;
        if (focusedMonitorIndex >= 0 && monitors[focusedMonitorIndex])
            return monitors[focusedMonitorIndex];

        const [pointerX, pointerY] = global.get_pointer();
        const pointerMonitor = monitors.find(monitor =>
            pointerX >= monitor.x
            && pointerX < monitor.x + monitor.width
            && pointerY >= monitor.y
            && pointerY < monitor.y + monitor.height);

        return pointerMonitor ?? ShellMain.layoutManager.primaryMonitor;
    }

    _relayout() {
        if (!this._topActor)
            return;

        const monitor = this._getTargetMonitor();
        if (!monitor)
            return;

        this._topActor.set_position(monitor.x, monitor.y);
        this._topActor.set_size(monitor.width, monitor.height);
        this._dimmer.set_position(0, 0);
        this._dimmer.set_size(monitor.width, monitor.height);

        const configuredWidth = this._settings.get_int('panel-width');
        const width = Math.max(360, Math.min(configuredWidth, monitor.width - 32));
        this._container.set_width(width);
        this._resultsScroll.set_style(`max-height: ${Math.floor(monitor.height * 0.5)}px;`);

        const x = Math.floor((monitor.width - width) / 2);
        const y = Math.floor(monitor.height * 0.14);
        this._container.set_position(Math.max(16, x), Math.max(16, y));
    }

    _shouldAnimate() {
        if (!this._settings.get_boolean('animations-enabled'))
            return false;

        try {
            if (this._stSettings.enable_animations === false)
                return false;
            if ('reduced_motion' in this._stSettings && this._stSettings.reduced_motion)
                return false;
        } catch (_error) {
            // Use the extension preference if the Shell setting is unavailable.
        }

        return true;
    }

    open({initialText = ''} = {}) {
        if (this._isOpen) {
            if (initialText)
                this._entry.set_text(initialText);
            return;
        }

        if (this._closing)
            this._finishClose();

        this._isOpen = true;
        this._historyIndex = -1;
        this._historyDraft = '';
        this._relayout();
        this._applyAppearance();
        this._applyDensity();
        this._applyBlur();
        this._topActor.show();
        this._entry.set_text(initialText);
        if (!initialText)
            this._showQuickResults();

        if (this._settings.get_boolean('enable-clipboard-search')) {
            this._providers.clipboard.capture(() => {
                if (this._isOpen && this._activeSearchTerm)
                    this._refreshVisibleResults();
            });
        }

        this._grab = ShellMain.pushModal(this._topActor, {
            actionMode: Shell.ActionMode.POPUP,
        });

        if (!this._grab) {
            this._isOpen = false;
            this._topActor.hide();
            return;
        }

        global.stage.set_key_focus(this._entry.clutter_text);
        this._dimmer.remove_all_transitions();
        this._container.remove_all_transitions();

        if (!this._shouldAnimate()) {
            this._dimmer.opacity = 255;
            this._container.opacity = 255;
            this._container.scale_x = 1;
            this._container.scale_y = 1;
            return;
        }

        this._dimmer.opacity = 0;
        this._dimmer.ease({
            opacity: 255,
            duration: ANIMATION_TIME,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });

        this._container.opacity = 0;
        this._container.set_pivot_point(0.5, 0.25);
        this._container.scale_x = 0.965;
        this._container.scale_y = 0.965;
        this._container.ease({
            opacity: 255,
            scale_x: 1,
            scale_y: 1,
            duration: ANIMATION_TIME,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
    }

    openWithSelectedText() {
        this._providers.clipboard.getPrimarySelection(text => {
            if (text)
                this.open({initialText: text.slice(0, 500)});
            else
                this.open();
        });
    }

    close({immediate = false} = {}) {
        if (!this._isOpen && !this._closing)
            return;

        this._isOpen = false;
        if (immediate || !this._shouldAnimate()) {
            this._finishClose();
            return;
        }

        this._closing = true;
        this._dimmer.remove_all_transitions();
        this._container.remove_all_transitions();
        this._dimmer.ease({
            opacity: 0,
            duration: ANIMATION_TIME,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
        this._container.ease({
            opacity: 0,
            scale_x: 0.98,
            scale_y: 0.98,
            duration: ANIMATION_TIME,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => this._finishClose(),
        });
    }

    _finishClose() {
        this._dimmer?.remove_all_transitions();
        this._container?.remove_all_transitions();

        if (this._grab) {
            ShellMain.popModal(this._grab);
            this._grab = null;
        }

        this._topActor?.hide();
        this._closing = false;
    }

    toggle() {
        if (this._isOpen)
            this.close();
        else
            this.open();
    }

    _onKeyPress(event) {
        const symbol = event.get_key_symbol();
        const state = event.get_state();
        const ctrl = Boolean(state & Clutter.ModifierType.CONTROL_MASK);
        const shift = Boolean(state & Clutter.ModifierType.SHIFT_MASK);
        const alt = Boolean(state & Clutter.ModifierType.MOD1_MASK);

        if (ctrl && (symbol === Clutter.KEY_Up || symbol === Clutter.KEY_Down)) {
            this._navigateQueryHistory(symbol === Clutter.KEY_Up ? 1 : -1);
            return Clutter.EVENT_STOP;
        }

        switch (symbol) {
        case Clutter.KEY_Escape:
            this.close();
            return Clutter.EVENT_STOP;
        case Clutter.KEY_Down:
            this._moveSelection(1);
            return Clutter.EVENT_STOP;
        case Clutter.KEY_Up:
            this._moveSelection(-1);
            return Clutter.EVENT_STOP;
        case Clutter.KEY_Home:
            this._selectBoundary(1);
            return Clutter.EVENT_STOP;
        case Clutter.KEY_End:
            this._selectBoundary(-1);
            return Clutter.EVENT_STOP;
        case Clutter.KEY_Return:
        case Clutter.KEY_KP_Enter:
        case Clutter.KEY_ISO_Enter: {
            let action = 'default';
            if (alt)
                action = 'details';
            else if (shift)
                action = 'alternate';
            else if (ctrl)
                action = 'new';
            this._activateSelected(event.get_time(), action);
            return Clutter.EVENT_STOP;
        }
        default:
            return Clutter.EVENT_PROPAGATE;
        }
    }

    _navigateQueryHistory(direction) {
        if (!this._settings.get_boolean('query-history-enabled'))
            return;

        const history = this._usageStore.getQueryHistory();
        if (history.length === 0)
            return;

        if (this._historyIndex < 0)
            this._historyDraft = this._entry.get_text();

        if (direction > 0)
            this._historyIndex = Math.min(history.length - 1, this._historyIndex + 1);
        else
            this._historyIndex = Math.max(-1, this._historyIndex - 1);

        this._restoringHistory = true;
        this._entry.set_text(
            this._historyIndex >= 0 ? history[this._historyIndex] : this._historyDraft
        );
        this._entry.clutter_text.set_cursor_position(-1);
        this._restoringHistory = false;
    }

    _isActivatable(index) {
        return typeof this._currentResults[index]?.activate === 'function';
    }

    _moveSelection(direction) {
        if (this._currentResults.length === 0)
            return;

        let next = this._selectedIndex;
        while (true) {
            next += direction;
            if (next < 0 || next >= this._currentResults.length)
                return;
            if (this._isActivatable(next))
                break;
        }
        this._setSelectedIndex(next);
    }

    _selectItem(item) {
        const index = this._resultItems.indexOf(item);
        if (index < 0 || !this._isActivatable(index))
            return;
        this._setSelectedIndex(index, {ensureVisible: false});
    }

    _setSelectedIndex(index, {ensureVisible = true} = {}) {
        if (index < 0 || index >= this._currentResults.length || !this._isActivatable(index))
            return;

        if (this._selectedIndex >= 0 && this._selectedIndex !== index)
            this._resultItems[this._selectedIndex]?.setSelected(false);

        this._selectedIndex = index;
        this._resultItems[index]?.setSelected(true);
        if (ensureVisible)
            this._ensureVisible(index);
    }

    _selectBoundary(direction) {
        const indexes = direction > 0
            ? [...this._currentResults.keys()]
            : [...this._currentResults.keys()].reverse();
        const target = indexes.find(index => this._isActivatable(index));
        if (target !== undefined)
            this._setSelectedIndex(target);
    }

    _ensureVisible(index) {
        const item = this._resultItems[index];
        if (!item)
            return;

        const adjustment = this._resultsScroll.get_vadjustment();
        const [, itemY] = item.get_transformed_position();
        const [, boxY] = this._resultsBox.get_transformed_position();
        const relativeY = itemY - boxY;
        const value = adjustment.get_value();
        const pageSize = adjustment.get_page_size();

        if (relativeY < value)
            adjustment.set_value(relativeY);
        else if (relativeY + item.height > value + pageSize)
            adjustment.set_value(relativeY + item.height - pageSize);
    }

    _activateSelected(timestamp = 0, action = 'default') {
        if (this._selectedIndex < 0 || !this._isActivatable(this._selectedIndex))
            return;
        this._activateResult(this._currentResults[this._selectedIndex], timestamp, action);
    }

    _activateResult(result, timestamp = 0, action = 'default') {
        if (typeof result.activate !== 'function')
            return;

        const fn = action === 'default'
            ? result.activate
            : (result.actions?.[action] ?? result.activate);
        const query = this._activeSearchTerm;

        if (this._settings.get_boolean('learn-ranking'))
            this._usageStore.recordActivation(query, result);
        else if (this._settings.get_boolean('query-history-enabled'))
            this._usageStore.recordQuery(query);

        this.close({immediate: true});

        GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            try {
                fn(timestamp);
            } catch (error) {
                logError(error, `Spotlight: failed to activate ${result.title}`);
                global.notify_error?.('Spotlight', `Could not open “${result.title}”.`);
            }
            return GLib.SOURCE_REMOVE;
        });
    }

    _refreshVisibleResults() {
        if (this._isOpen)
            this._onTextChanged();
    }

    _onTextChanged() {
        const text = this._entry.get_text().trim();
        if (!this._restoringHistory) {
            this._historyIndex = -1;
            this._historyDraft = '';
        }

        if (!text) {
            this._activeSearchTerm = '';
            this._showQuickResults();
            return;
        }

        const parsed = parseScopedQuery(text);
        this._activeSearchTerm = parsed.term;
        const results = this._search(parsed);
        this._renderResults(results, parsed.term);
    }

    _showQuickResults() {
        const maxResults = this._settings.get_int('result-count');
        const results = [];

        let fileResults = [];
        if (this._settings.get_boolean('enable-file-search')) {
            const recentEvents = this._usageStore.getRecentEvents('file', 4);
            const fileLimit = Math.min(3, Math.max(0, Math.floor(maxResults / 3)));
            fileResults = this._providers.files.getRecentResults(recentEvents, fileLimit);
        }

        const appLimit = Math.max(0, maxResults - fileResults.length);
        const appResults = this._providers.apps.getQuickResults(appLimit);
        if (appResults.length > 0) {
            results.push({id: 'section:apps', type: 'section', title: 'Applications', score: 0});
            results.push(...appResults);
        }
        if (fileResults.length > 0) {
            results.push({id: 'section:files', type: 'section', title: 'Recent Files', score: 0});
            results.push(...fileResults);
        }

        this._renderResults(results, '');
    }

    _providerOrderBonus(result) {
        const provider = TYPE_TO_PROVIDER.get(result.type);
        if (!provider)
            return 0;

        const order = this._settings.get_strv('provider-order');
        const index = order.indexOf(provider);
        if (index < 0)
            return 0;
        return Math.max(0, (order.length - index - 1) * 12);
    }

    _globalRank(result, query) {
        const normalizedScore = result.score - (RESULT_TYPE_BASE_OFFSET.get(result.type) ?? 0);
        let rank = normalizedScore
            + (TYPE_PREFERENCE.get(result.type) ?? 0)
            + this._providerOrderBonus(result)
            + exactMatchBonus(
                result,
                query,
                this._settings.get_boolean('prefer-exact-matches')
            );

        if (this._settings.get_boolean('learn-ranking'))
            rank += this._usageStore.getBoost(query, result.id);

        return rank;
    }

    _search({scope, term, explicit}) {
        const maxResults = this._settings.get_int('result-count');
        if (!term && scope !== 'clipboard')
            return [];

        if (scope !== 'all') {
            switch (scope) {
            case 'apps':
                return this._providers.apps.search(term, maxResults);
            case 'windows':
                return this._providers.windows.search(term, maxResults);
            case 'files':
                return this._providers.files.search(term, maxResults, {explicit: true});
            case 'settings':
                return this._providers.settings.search(term, maxResults);
            case 'calculator':
                return this._providers.calculator.search(term);
            case 'system':
                return this._providers.system.search(term, maxResults);
            case 'clipboard':
                return this._settings.get_boolean('enable-clipboard-search')
                    ? this._providers.clipboard.search(term, maxResults, {explicit: true})
                    : [];
            case 'web':
                return this._providers.web.search(term, {explicit: true});
            default:
                return [];
            }
        }

        const results = [
            ...this._providers.calculator.search(term),
            ...this._providers.system.search(term, maxResults),
            ...this._providers.apps.search(term, maxResults),
        ];

        if (this._settings.get_boolean('enable-window-search'))
            results.push(...this._providers.windows.search(term, maxResults));
        if (this._settings.get_boolean('enable-file-search'))
            results.push(...this._providers.files.search(term, maxResults, {explicit}));
        if (this._settings.get_boolean('enable-settings-search'))
            results.push(...this._providers.settings.search(term, maxResults));
        if (this._settings.get_boolean('enable-clipboard-search'))
            results.push(...this._providers.clipboard.search(term, Math.min(4, maxResults)));

        results.sort((a, b) =>
            this._globalRank(b, term) - this._globalRank(a, term)
            || b.score - a.score
            || a.title.localeCompare(b.title)
        );

        if (!this._settings.get_boolean('show-web-search'))
            return results.slice(0, maxResults);

        const webResult = this._providers.web.search(term, {explicit: false})[0];
        if (!webResult)
            return results.slice(0, maxResults);
        if (maxResults <= 1)
            return [webResult];

        return [...results.slice(0, maxResults - 1), webResult];
    }

    _renderResults(results, query = '') {
        this._currentResults = results;
        this._selectedIndex = -1;
        const showCategory = this._settings.get_boolean('show-category-badges');

        for (let index = 0; index < results.length; index++) {
            let item = this._resultItems[index];
            if (!item) {
                item = new ResultItem(
                    (result, timestamp) => this._activateResult(result, timestamp),
                    hoveredItem => this._selectItem(hoveredItem)
                );
                this._resultItems.push(item);
                this._resultsBox.add_child(item);
            }

            item.setSelected(false);
            item.setResult(results[index], query, {showCategory});
        }

        for (let index = results.length; index < this._resultItems.length; index++)
            this._resultItems[index].clearResult();

        this._resultsScroll.visible = results.length > 0;
        const adjustment = this._resultsScroll.get_vadjustment();
        adjustment.set_value(adjustment.get_lower());

        const firstActivatable = results.findIndex(result =>
            typeof result.activate === 'function');
        if (firstActivatable >= 0)
            this._setSelectedIndex(firstActivatable, {ensureVisible: false});
    }

    clearLearningHistory() {
        this._usageStore.clear();
        if (this._isOpen)
            this._showQuickResults();
    }

    destroy() {
        this.close({immediate: true});

        if (this._monitorsChangedId) {
            ShellMain.layoutManager.disconnect(this._monitorsChangedId);
            this._monitorsChangedId = 0;
        }

        for (const [object, signalId] of this._signalIds) {
            try {
                object.disconnect(signalId);
            } catch (_error) {
                // The object may already have been disposed during Shell teardown.
            }
        }
        this._signalIds = [];

        for (const provider of Object.values(this._providers))
            provider.destroy();
        this._providers = null;

        this._usageStore.destroy();
        this._usageStore = null;

        this._topActor?.destroy();
        this._topActor = null;
        this._dimmer = null;
        this._container = null;
        this._entry = null;
        this._resultsBox = null;
        this._resultsScroll = null;
        this._resultItems = [];
        this._currentResults = [];
        this._interfaceSettings = null;
        this._stSettings = null;
        this._settings = null;
    }
}
