/* SPDX-License-Identifier: GPL-3.0-or-later */

import Atk from 'gi://Atk';
import Pango from 'gi://Pango';
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
import {boxOrientation, setScrollChild, verticalAdjustment} from '../utils/compat.js';
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
    constructor(settings, openPreferences) {
        this._openPreferences = openPreferences;
        this._destroyed = false;
        this._searchId = 0;
        this._indexRefreshId = 0;
        this._activationId = 0;
        this._modeButtons = [];
        this._selectionRequest = 0;
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

        this._providers = {};
        try {
            this._usageStore = new UsageStore({rememberQueries: settings.get_boolean('query-history-enabled'),
                learnRanking: settings.get_boolean('learn-ranking')});
            this._providers.apps = new AppProvider(settings);
            this._providers.calculator = new CalculatorProvider();
            this._providers.clipboard = new ClipboardProvider(settings.get_boolean('enable-clipboard-search'));
            this._providers.files = new FileProvider(settings, () => this._scheduleIndexRefresh());
            this._providers.settings = new SettingsProvider();
            this._providers.system = new SystemProvider();
            this._providers.web = new WebProvider(settings);
            this._providers.windows = new WindowProvider();

            this._interfaceSettings = new Gio.Settings({
                schema_id: 'org.gnome.desktop.interface',
            });
            this._stSettings = St.Settings.get();

            this._buildUI();
            this._connectSignals();
            this._applyAppearance();
            this._applyBlur();
            this._applyDensity();
        } catch (error) {
            const orphans = [this._container, this._dimmer, this._entry,
                this._resultsScroll, this._resultsBox].filter(actor => actor && !actor.get_parent());
            this.destroy();
            for (const actor of orphans)
                actor.destroy();
            throw error;
        }
    }

    _buildUI() {
        this._dimmer = new St.Button({
            style_class: 'spotlight-dimmer',
            reactive: true,
            can_focus: false,
            accessible_name: 'Close Spotlight',
        });
        this._dimmer.connect('clicked', () => this.close());

        this._container = new St.BoxLayout({
            style_class: 'spotlight-container',
            ...boxOrientation(true),
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
        this._entry.clutter_text.set_max_length(500);
        this._entry.set_secondary_icon(new St.Icon({icon_name: 'edit-clear-symbolic',
            icon_size: 16, style_class: 'spotlight-clear-icon',
            accessible_name: 'Clear search'}));
        this._entry.connect('secondary-icon-clicked', () => this._setQuery(''));
        this._entry.clutter_text.connect('text-changed', () => this._scheduleSearch());
        this._entry.clutter_text.connect('key-press-event', (_actor, event) =>
            this._onKeyPress(event));
        this._entry.clutter_text.connect('activate', () =>
            this._activateSelected(global.get_current_time(), 'default'));
        this._container.add_child(this._entry);
        this._buildControls();

        this._resultsScroll = new St.ScrollView({
            style_class: 'spotlight-results-scroll',
            x_expand: true,
        });
        this._resultsBox = new St.BoxLayout({
            style_class: 'spotlight-results',
            ...boxOrientation(true),
            x_expand: true,
        });
        setScrollChild(this._resultsScroll, this._resultsBox);
        this._resultsScroll.set_policy(St.PolicyType.NEVER, St.PolicyType.AUTOMATIC);
        this._container.add_child(this._resultsScroll);
        this._footer = new St.BoxLayout({style_class: 'spotlight-footer', ...boxOrientation()});
        this._status = new St.Label({style_class: 'spotlight-status', x_expand: true,
            y_align: Clutter.ActorAlign.CENTER});
        this._status.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        this._footer.add_child(this._status);
        this._actionButton = new St.Button({style_class: 'spotlight-chip', can_focus: true});
        this._actionButton.connect('clicked', () => this._activateSelected(global.get_current_time(), 'new'));
        this._footer.add_child(this._actionButton);
        this._container.add_child(this._footer);

        this._topActor = new St.Widget({
            layout_manager: new Clutter.FixedLayout(),
            visible: false,
            reactive: true,
            accessible_role: Atk.Role.DIALOG,
            accessible_name: 'Spotlight',
        });
        this._topActor.connect('key-press-event', (_actor, event) =>
            this._onKeyPress(event));
        this._topActor.add_child(this._dimmer);
        this._topActor.add_child(this._container);
        ShellMain.layoutManager.uiGroup.add_child(this._topActor);
    }

    _setQuery(text) {
        this._entry.set_text(text);
        this._entry.clutter_text.set_cursor_position(-1);
        global.stage.set_key_focus(this._entry.clutter_text);
    }

    _buildControls() {
        const bar = new St.BoxLayout({style_class: 'spotlight-modes', ...boxOrientation()});
        for (const [label, prefix, setting] of [
            ['Apps', '@ ', null], ['Files', '# ', 'enable-file-search'],
            ['Windows', 'win: ', 'enable-window-search'], ['Calculator', '= ', null],
        ]) {
            const button = new St.Button({label, style_class: 'spotlight-chip',
                can_focus: true, accessible_name: `Search ${label}`});
            button.connect('clicked', () => this._setQuery(prefix));
            bar.add_child(button);
            this._modeButtons.push({button, setting, label, prefix, scope: parseScopedQuery(prefix).scope});
        }
        const spacer = new St.Widget({x_expand: true});
        bar.add_child(spacer);
        const preferences = new St.Button({style_class: 'spotlight-chip', can_focus: true,
            accessible_name: 'Spotlight preferences', child: new St.Icon({
                icon_name: 'emblem-system-symbolic', icon_size: 16})});
        preferences.connect('clicked', () => {
            this.close({immediate: true});
            this._openPreferences?.();
        });
        bar.add_child(preferences);
        this._container.add_child(bar);
    }

    _scheduleSearch(resetHistory = true) {
        if (resetHistory && !this._restoringHistory) {
            this._historyIndex = -1;
            this._historyDraft = '';
        }
        if (this._searchId)
            GLib.Source.remove(this._searchId);
        this._searchId = 0;
        if (!this._isOpen || this._destroyed)
            return;
        this._searchId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 45, () => {
            this._searchId = 0;
            this._onTextChanged();
            return GLib.SOURCE_REMOVE;
        });
    }

    _scheduleIndexRefresh() {
        if (!this._isOpen || this._destroyed || this._indexRefreshId)
            return;
        this._indexRefreshId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 160, () => {
            this._indexRefreshId = 0;
            if (this._isOpen && !this._searchId)
                this._onTextChanged();
            return GLib.SOURCE_REMOVE;
        });
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
        connectSetting('animations-enabled', () => this._applyAppearance());
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

        connectSetting('enable-clipboard-search', () => {
            this._providers.clipboard.setEnabled(this._settings.get_boolean('enable-clipboard-search'));
            this._refreshVisibleResults();
        });
        for (const key of ['learn-ranking', 'query-history-enabled']) {
            connectSetting(key, () => this._usageStore.setPrivacy({
                rememberQueries: this._settings.get_boolean('query-history-enabled'),
                learnRanking: this._settings.get_boolean('learn-ranking'),
            }));
        }
        connectSetting('file-refresh-token', () => this._providers.files.rebuildIndex());

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
                { this._applyAppearance(); this._applyBlur(); });
            this._signalIds.push([this._stSettings, id]);
        } catch (_error) {
            // Older supported Shell versions may not expose this notification.
        }

        this._signalIds.push([this._interfaceSettings,
            this._interfaceSettings.connect('changed::enable-animations', () => this._applyAppearance())]);
        if (St.Settings.find_property('reduced-motion')) {
            this._signalIds.push([this._stSettings,
                this._stSettings.connect('notify::reduced-motion', () => this._applyAppearance())]);
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

        if (this._shouldAnimate())
            this._topActor.remove_style_class_name('spotlight-no-motion');
        else
            this._topActor.add_style_class_name('spotlight-no-motion');

        const opacity = highContrast ? 1 : Math.max(0.35, Math.min(
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

        const blurKey = [this._settings.get_boolean('blur-enabled'),
            this._settings.get_int('blur-strength'), this._getThemeMode(),
            this._stSettings.high_contrast].join(':');
        if (this._blurKey === blurKey)
            return;
        this._blurKey = blurKey;
        this._dimmer.clear_effects();
        this._container.clear_effects();
        if (!this._settings.get_boolean('blur-enabled') || this._stSettings.high_contrast)
            return;

        const strength = this._settings.get_int('blur-strength');
        if (strength <= 0)
            return;

        const mode = this._getThemeMode();
        const brightness = mode === 'dark' ? 0.72 : 0.9;

        try {
            // GNOME 46+ uses radius, which is twice the sigma used by GNOME 45.
            const usesRadius = typeof Shell.BlurEffect.prototype.set_radius === 'function';
            const blurProperty = usesRadius ? 'radius' : 'sigma';
            const blurScale = usesRadius ? 2 : 1;

            this._container.add_effect(new Shell.BlurEffect({
                [blurProperty]: strength * blurScale,
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
        const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        const width = Math.max(1, Math.min(configuredWidth * scale, monitor.width - 32 * scale));
        this._container.set_width(width);
        for (const {button, label, prefix} of this._modeButtons)
            button.label = width / scale < 560 ? prefix.trim() : label;
        this._resultsScroll.set_style(`max-height: ${Math.floor(monitor.height * 0.48 / scale)}px;`);

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
            const rm = this._stSettings.reduced_motion ?? this._stSettings.reducedMotion;
            if (rm === true || (St.ReducedMotion && rm === St.ReducedMotion.REDUCE))
                return false;
        } catch (_error) {
            // Use the extension preference if the Shell setting is unavailable.
        }

        return true;
    }

    open({initialText = ''} = {}) {
        if (this._destroyed)
            return;
        if (this._isOpen) {
            if (initialText)
                this._entry.set_text(initialText);
            return;
        }

        if (this._closing)
            this._finishClose();

        this._isOpen = true;
        this._providers.files.ensureIndex();
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

        this._providers.clipboard.capture(() => {
            if (this._isOpen && !this._destroyed)
                this._refreshVisibleResults();
        });

        this._grab = ShellMain.pushModal(this._topActor, {
            actionMode: Shell.ActionMode.POPUP,
        });

        if (!this._grab || (typeof this._grab.get_seat_state === 'function' &&
            !(this._grab.get_seat_state() & Clutter.GrabState.KEYBOARD))) {
            this.close({immediate: true});
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
        const request = ++this._selectionRequest;
        this._providers.clipboard.getPrimarySelection(text => {
            if (request !== this._selectionRequest)
                return;
            if (text)
                this.open({initialText: text.slice(0, 500)});
            else
                this.open();
        });
    }

    close({immediate = false} = {}) {
        this._selectionRequest++;
        if (!this._isOpen && !this._closing)
            return;

        this._isOpen = false;
        for (const key of ['_searchId', '_indexRefreshId']) {
            if (this[key])
                GLib.Source.remove(this[key]);
            this[key] = 0;
        }
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
        this._entry?.set_text('');
        this._entry?.get_accessible().set_description('');
        for (const item of this._resultItems)
            item.clearResult();
        this._currentResults = [];
        this._selectedIndex = -1;
        this._activeSearchTerm = '';
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

        if (symbol === Clutter.KEY_Tab || symbol === Clutter.KEY_ISO_Left_Tab) {
            this._topActor.navigate_focus(global.stage.get_key_focus(),
                shift ? St.DirectionType.TAB_BACKWARD : St.DirectionType.TAB_FORWARD, true);
            return Clutter.EVENT_STOP;
        }
        if (ctrl && (symbol === Clutter.KEY_l || symbol === Clutter.KEY_L)) {
            global.stage.set_key_focus(this._entry.clutter_text);
            this._entry.clutter_text.set_selection(0, -1);
            return Clutter.EVENT_STOP;
        }
        if (alt && symbol >= Clutter.KEY_1 && symbol <= Clutter.KEY_9) {
            this._flushSearch();
            const result = this._currentResults.filter(item => typeof item.activate === 'function')[symbol - Clutter.KEY_1];
            if (result)
                this._activateResult(result, event.get_time());
            return Clutter.EVENT_STOP;
        }
        const focus = global.stage.get_key_focus();
        if (focus && focus !== this._entry.clutter_text &&
            !this._resultItems.some(item => item === focus) &&
            symbol !== Clutter.KEY_Escape)
            return Clutter.EVENT_PROPAGATE;

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
            if (!ctrl)
                return Clutter.EVENT_PROPAGATE;
            this._selectBoundary(1);
            return Clutter.EVENT_STOP;
        case Clutter.KEY_End:
            if (!ctrl)
                return Clutter.EVENT_PROPAGATE;
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
            this._activateSelected(global.get_current_time(), action);
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
        const selected = this._currentResults[index];
        this._actionButton.visible = Boolean(selected.actions?.new);
        this._actionButton.label = selected.type === 'file' ? 'Show folder' : 'New window';
        this._actionButton.accessible_name = `${this._actionButton.label}: ${selected.title}`;
        this._entry.get_accessible().set_description(`${selected.title}. ${selected.subtitle ?? ''}`);
        if (ensureVisible) {
            this._ensureVisible(index);
            if (this._resultItems.includes(global.stage.get_key_focus()))
                this._resultItems[index].grab_key_focus();
        }
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

        const adjustment = verticalAdjustment(this._resultsScroll);
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

    _flushSearch() {
        if (this._searchId) {
            GLib.Source.remove(this._searchId);
            this._searchId = 0;
            this._onTextChanged();
        }
    }

    _activateSelected(timestamp = 0, action = 'default') {
        this._flushSearch();
        if (!this._isOpen)
            return;

        let index = this._selectedIndex;
        if (index < 0 || !this._isActivatable(index))
            index = this._currentResults.findIndex(result => typeof result?.activate === 'function');

        if (index < 0 || !this._isActivatable(index))
            return;

        this._activateResult(this._currentResults[index], timestamp, action);
    }

    _activateResult(result, timestamp = 0, action = 'default') {
        if (!this._isOpen || typeof result.activate !== 'function')
            return;

        const fn = action === 'default'
            ? result.activate
            : (result.actions?.[action] ?? result.activate);
        const query = this._activeSearchTerm;
        const rawQuery = this._entry.get_text().trim();

        this.close({immediate: true});
        if (this._activationId)
            GLib.Source.remove(this._activationId);
        this._activationId = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            this._activationId = 0;
            if (this._destroyed)
                return GLib.SOURCE_REMOVE;
            try {
                fn(timestamp || global.get_current_time());
                if (this._destroyed)
                    return GLib.SOURCE_REMOVE;
                // Clipboard content and clipboard queries must never reach disk.
                if (result.type !== 'clipboard' && parseScopedQuery(rawQuery).scope !== 'clipboard') {
                    if (this._settings.get_boolean('learn-ranking'))
                        this._usageStore.recordActivation(query, result, rawQuery);
                    else if (this._settings.get_boolean('query-history-enabled'))
                        this._usageStore.recordQuery(rawQuery || query);
                }
            } catch (error) {
                logError(error, 'Spotlight: activation failed');
                ShellMain.notifyError('Spotlight', `Could not open “${result.title}”.`);
            }
            return GLib.SOURCE_REMOVE;
        });
    }

    _refreshVisibleResults() {
        if (this._isOpen)
            this._scheduleSearch(false);
    }

    _onTextChanged() {
        const text = this._entry.get_text().trim();
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
        if (this._settings.get_boolean('enable-file-search') && this._settings.get_boolean('learn-ranking')) {
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
        if (!term && scope === 'all')
            return [];

        const setting = {files: 'enable-file-search', windows: 'enable-window-search',
            settings: 'enable-settings-search', clipboard: 'enable-clipboard-search'}[scope];
        if (setting && !this._settings.get_boolean(setting))
            return [{id: `${scope}:disabled`, type: 'info', title: 'This search provider is disabled',
                subtitle: 'You can enable it in Spotlight preferences.', iconName: 'changes-prevent-symbolic'}];
        if (scope !== 'all') {
            switch (scope) {
            case 'apps':
                return !term
                    ? this._providers.apps.getQuickResults(maxResults)
                    : this._providers.apps.search(term, maxResults);
            case 'windows':
                return this._providers.windows.search(term, maxResults);
            case 'files':
                if (!term) {
                    const recentEvents = this._usageStore.getRecentEvents('file', maxResults);
                    const recentFiles = this._providers.files.getRecentResults(recentEvents, maxResults);
                    if (recentFiles.length > 0)
                        return recentFiles;
                    return this._providers.files.search('', maxResults, {explicit: true});
                }
                return this._providers.files.search(term, maxResults, {explicit: true});
            case 'settings':
                return this._providers.settings.search(term, maxResults);
            case 'calculator':
                return this._providers.calculator.search(term, {explicit: true});
            case 'system':
                return this._providers.system.search(term, maxResults, {explicit: true});
            case 'clipboard':
                return this._providers.clipboard.search(term, maxResults, {explicit: true});
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

        for (const result of results)
            result.rank = this._globalRank(result, term);
        results.sort((a, b) =>
            b.rank - a.rank
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
        const previousId = this._renderedQuery === this._entry.get_text()
            ? this._currentResults[this._selectedIndex]?.id : null;
        this._renderedQuery = this._entry.get_text();
        const scope = parseScopedQuery(this._entry.get_text()).scope;
        for (const {button, setting, scope: buttonScope} of this._modeButtons) {
            button.visible = !setting || this._settings.get_boolean(setting);
            if (scope === buttonScope)
                button.add_style_pseudo_class('checked');
            else
                button.remove_style_pseudo_class('checked');
        }
        this._actionButton.hide();
        const count = results.filter(result => typeof result.activate === 'function').length;
        this._status.text = this._providers.files.isIndexing && this._settings.get_boolean('enable-file-search')
            ? `${count} ${count === 1 ? 'result' : 'results'} · Indexing files…` : `${count} ${count === 1 ? 'result' : 'results'} · ↑↓ select · Alt+1…9 open`;
        if (results.length === 0)
            results = [{id: 'empty', type: 'info', title: query ? 'No matching results' : 'Ready when you are',
                subtitle: 'Try another search or choose a mode above.', iconName: 'edit-find-symbolic'}];
        this._currentResults = results;
        this._selectedIndex = -1;
        const showCategory = this._settings.get_boolean('show-category-badges');

        for (let index = 0; index < results.length; index++) {
            let item = this._resultItems[index];
            if (!item) {
                item = new ResultItem(
                    (result, timestamp) => this._activateResult(result, timestamp),
                    hoveredItem => this._selectItem(hoveredItem),
                    event => this._onKeyPress(event)
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
        const adjustment = verticalAdjustment(this._resultsScroll);
        adjustment.set_value(adjustment.get_lower());

        const previousIndex = results.findIndex(result => result.id === previousId && typeof result.activate === 'function');
        const firstActivatable = previousIndex >= 0 ? previousIndex : results.findIndex(result =>
            typeof result.activate === 'function');
        if (firstActivatable >= 0)
            this._setSelectedIndex(firstActivatable, {ensureVisible: false});
    }

    destroy() {
        this._destroyed = true;
        if (this._activationId) {
            GLib.Source.remove(this._activationId);
            this._activationId = 0;
        }
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

        for (const provider of Object.values(this._providers ?? {}))
            provider.destroy();
        this._providers = null;

        this._usageStore?.destroy();
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
        this._modeButtons = [];
        this._footer = null;
        this._status = null;
        this._actionButton = null;
        this._openPreferences = null;
    }
}
