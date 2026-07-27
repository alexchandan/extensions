"use strict";

import St from "gi://St";
import Clutter from "gi://Clutter";
import GObject from "gi://GObject";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import Shell from "gi://Shell";
import Meta from "gi://Meta";
import Pango from "gi://Pango";

import { Extension } from "resource:///org/gnome/shell/extensions/extension.js";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import * as Util from "resource:///org/gnome/shell/misc/util.js";

const ANIMATION_TIME = 150;

/* ---------------------------------------------------------------------- */
/* A single row in the results list (app, calculator answer, web search,  */
/* or system action). Kept generic so every result type looks identical. */
/* ---------------------------------------------------------------------- */
const ResultItem = GObject.registerClass(
  class ResultItem extends St.BoxLayout {
    _init(params) {
      super._init({
        style_class: "spotlight-result-item",
        reactive: true,
        track_hover: true,
        can_focus: false,
        vertical: false,
        x_expand: false,
      });

      this._onActivate = params.onActivate;

      const icon = params.gicon
        ? new St.Icon({
            gicon: params.gicon,
            icon_size: 34,
            style_class: "spotlight-result-icon",
          })
        : new St.Icon({
            icon_name: params.iconName || "edit-find-symbolic",
            icon_size: 34,
            style_class: "spotlight-result-icon",
          });
      this.add_child(icon);

      const textBox = new St.BoxLayout({
        vertical: true,
        style_class: "spotlight-result-text",
        x_expand: false,
        y_align: Clutter.ActorAlign.CENTER,
      });

      const nameLabel = new St.Label({
        text: params.title,
        style_class: "spotlight-result-name",
      });
      nameLabel.clutter_text.ellipsize = Pango.EllipsizeMode.END;
      textBox.add_child(nameLabel);

      if (params.subtitle) {
        const descLabel = new St.Label({
          text: params.subtitle,
          style_class: "spotlight-result-desc",
        });
        descLabel.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        textBox.add_child(descLabel);
      }
      this.add_child(textBox);

      if (params.shortcutLabel) {
        const shortcut = new St.Label({
          text: params.shortcutLabel,
          style_class: "spotlight-result-shortcut",
          y_align: Clutter.ActorAlign.CENTER,
        });
        this.add_child(shortcut);
      }

      this.connect("button-press-event", () => {
        this.activate();
        return Clutter.EVENT_STOP;
      });
    }

    activate() {
      if (this._onActivate) this._onActivate();
    }

    setSelected(selected) {
      if (selected) this.add_style_pseudo_class("selected");
      else this.remove_style_pseudo_class("selected");
    }
  },
);

/* ---------------------------------------------------------------------- */
/* Quick system actions, matched by keyword, Spotlight-style              */
/* ---------------------------------------------------------------------- */
const SYSTEM_ACTIONS = [
  {
    keywords: ["lock", "lock screen"],
    title: "Lock Screen",
    icon: "system-lock-screen-symbolic",
    run: () =>
      Main.screenShield?.lock(true) ??
      Util.trySpawnCommandLine("loginctl lock-session"),
  },
  {
    keywords: ["suspend", "sleep"],
    title: "Suspend",
    icon: "weather-clear-night-symbolic",
    run: () => Util.trySpawnCommandLine("systemctl suspend"),
  },
  {
    keywords: ["restart", "reboot"],
    title: "Restart",
    icon: "system-reboot-symbolic",
    run: () => Util.trySpawnCommandLine("systemctl reboot"),
  },
  {
    keywords: ["shut down", "shutdown", "power off", "poweroff"],
    title: "Shut Down",
    icon: "system-shutdown-symbolic",
    run: () => Util.trySpawnCommandLine("systemctl poweroff"),
  },
  {
    keywords: ["log out", "logout", "sign out"],
    title: "Log Out",
    icon: "system-log-out-symbolic",
    run: () =>
      Util.trySpawnCommandLine("gnome-session-quit --logout --no-prompt"),
  },
];

/* ---------------------------------------------------------------------- */
/* The Spotlight overlay itself: dimmer + floating search box + results   */
/* ---------------------------------------------------------------------- */
class SpotlightOverlay {
  constructor(extension) {
    this._extension = extension;
    this._settings = extension.getSettings();
    this._appSystem = Shell.AppSystem.get_default();
    this._isOpen = false;
    this._grab = null;
    this._resultItems = [];
    this._selectedIndex = -1;
    this._monitorsChangedId = null;

    this._buildUI();
  }

  // Applies a real backdrop blur (frosted glass over the desktop, like
  // macOS Spotlight) using Shell.BlurEffect in BACKGROUND mode. Wrapped in
  // try/catch because BlurEffect's exact API has shifted slightly across
  // GNOME versions; if it's unavailable the CSS translucent color alone
  // still looks reasonable.
  _applyBlur(actor, { sigma, brightness }) {
    try {
      const effect = new Shell.BlurEffect({
        sigma,
        brightness,
        mode: Shell.BlurMode.BACKGROUND,
      });
      actor.add_effect(effect);
    } catch (e) {
      logError(
        e,
        "Spotlight: background blur unavailable, using flat translucent fallback",
      );
    }
  }

  _buildUI() {
    // Full-screen backdrop that dims/blurs the desktop and closes on click
    this._dimmer = new St.Widget({
      style_class: "spotlight-dimmer",
      reactive: true,
    });
    this._dimmer.connect("button-press-event", () => {
      this.close();
      return Clutter.EVENT_STOP;
    });
    this._applyBlur(this._dimmer, { sigma: 16, brightness: 0.75 });

    // The floating rounded search card
    this._container = new St.BoxLayout({
      style_class: "spotlight-container",
      vertical: true,
    });
    this._applyBlur(this._container, { sigma: 30, brightness: 0.6 });

    this._entry = new St.Entry({
      style_class: "spotlight-entry",
      can_focus: true,
      hint_text: "Spotlight Search",
      x_expand: false,
    });
    const searchIcon = new St.Icon({
      style_class: "spotlight-search-icon",
      icon_name: "edit-find-symbolic",
    });
    this._entry.set_primary_icon(searchIcon);
    this._entry.clutter_text.connect("text-changed", () =>
      this._onTextChanged(),
    );
    this._entry.clutter_text.connect("key-press-event", (_actor, event) =>
      this._onKeyPress(event),
    );
    this._container.add_child(this._entry);

    this._resultsScroll = new St.ScrollView({
      style_class: "spotlight-results-scroll",
      x_expand: false,
    });
    this._resultsBox = new St.BoxLayout({
      style_class: "spotlight-results",
      vertical: true,
      x_expand: false,
    });
    this._resultsScroll.set_child(this._resultsBox);
    this._resultsScroll.hide();
    this._container.add_child(this._resultsScroll);

    // Top-level actor that hosts everything, added to the UI group
    this._topActor = new St.Widget({
      layout_manager: new Clutter.BinLayout(),
      visible: false,
      reactive: true,
    });
    this._topActor.add_child(this._dimmer);
    this._topActor.add_child(this._container);
    this._topActor.connect("key-press-event", (_actor, event) =>
      this._onKeyPress(event),
    );

    Main.layoutManager.uiGroup.add_child(this._topActor);

    this._monitorsChangedId = Main.layoutManager.connect(
      "monitors-changed",
      () => this._relayout(),
    );
  }

  _relayout() {
    const monitor = Main.layoutManager.primaryMonitor;
    if (!monitor) return;

    this._topActor.set_position(monitor.x, monitor.y);
    this._topActor.set_size(monitor.width, monitor.height);
    this._dimmer.set_size(monitor.width, monitor.height);

    const containerWidth = Math.min(680, Math.floor(monitor.width * 0.55));
    this._container.set_width(containerWidth);
    this._resultsScroll.set_style(
      `max-height: ${Math.floor(monitor.height * 0.45)}px;`,
    );

    const x = monitor.x + Math.floor((monitor.width - containerWidth) / 2);
    const y = monitor.y + Math.floor(monitor.height * 0.16);
    this._container.set_position(x, y);
  }

  open() {
    if (this._isOpen) return;

    this._isOpen = true;
    this._relayout();
    this._topActor.show();
    this._entry.set_text("");
    this._clearResults();

    this._grab = Main.pushModal(this._topActor, {
      actionMode: Shell.ActionMode.POPUP,
    });

    global.stage.set_key_focus(this._entry.clutter_text);

    this._dimmer.opacity = 0;
    this._dimmer.ease({
      opacity: 255,
      duration: ANIMATION_TIME,
      mode: Clutter.AnimationMode.EASE_OUT_QUAD,
    });

    this._container.opacity = 0;
    this._container.set_pivot_point(0.5, 0.3);
    this._container.scale_x = 0.96;
    this._container.scale_y = 0.96;
    this._container.ease({
      opacity: 255,
      scale_x: 1,
      scale_y: 1,
      duration: ANIMATION_TIME,
      mode: Clutter.AnimationMode.EASE_OUT_QUAD,
    });
  }

  close() {
    if (!this._isOpen) return;

    this._isOpen = false;

    if (this._grab) {
      Main.popModal(this._grab);
      this._grab = null;
    }

    this._topActor.hide();
  }

  toggle() {
    if (this._isOpen) this.close();
    else this.open();
  }

  _onKeyPress(event) {
    const symbol = event.get_key_symbol();

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
      case Clutter.KEY_Return:
      case Clutter.KEY_KP_Enter:
      case Clutter.KEY_ISO_Enter:
        this._activateSelected();
        return Clutter.EVENT_STOP;
      default:
        return Clutter.EVENT_PROPAGATE;
    }
  }

  _moveSelection(direction) {
    if (this._resultItems.length === 0) return;

    if (this._selectedIndex >= 0)
      this._resultItems[this._selectedIndex].setSelected(false);

    this._selectedIndex =
      (this._selectedIndex + direction + this._resultItems.length) %
      this._resultItems.length;

    const item = this._resultItems[this._selectedIndex];
    item.setSelected(true);

    const adjustment = this._resultsScroll.vscroll.adjustment;
    const [, itemY] = item.get_transformed_position();
    const [, boxY] = this._resultsBox.get_transformed_position();
    const relativeY = itemY - boxY;
    if (relativeY < adjustment.value) adjustment.value = relativeY;
    else if (relativeY + item.height > adjustment.value + adjustment.page_size)
      adjustment.value = relativeY + item.height - adjustment.page_size;
  }

  _activateSelected() {
    if (
      this._selectedIndex < 0 ||
      this._selectedIndex >= this._resultItems.length
    )
      return;
    this._resultItems[this._selectedIndex].activate();
  }

  _onTextChanged() {
    const text = this._entry.get_text().trim();

    if (text.length === 0) {
      this._clearResults();
      return;
    }

    const calcResult = this._tryCalculate(text);
    const systemActions = this._searchSystemActions(text);
    const apps = this._searchApps(text);

    this._populateResults(text, calcResult, systemActions, apps);
  }

  _tryCalculate(text) {
    // Only allow plain arithmetic expressions through to eval.
    if (!/^[\d\s+\-*/().]+$/.test(text) || !/\d/.test(text)) return null;

    try {
      // eslint-disable-next-line no-new-func
      const result = Function(`"use strict"; return (${text});`)();
      if (typeof result === "number" && Number.isFinite(result)) return result;
    } catch (e) {
      return null;
    }
    return null;
  }

  _searchSystemActions(text) {
    const lower = text.toLowerCase();
    if (lower.length < 3) return [];
    return SYSTEM_ACTIONS.filter((action) =>
      action.keywords.some((k) => k.startsWith(lower) || lower.startsWith(k)),
    );
  }

  _searchApps(text) {
    const lower = text.toLowerCase();
    const maxResults = this._settings.get_int("result-count") || 8;
    const infos = this._appSystem.get_installed();
    const scored = [];

    for (const appInfo of infos) {
      if (!appInfo.should_show()) continue;

      const name = (
        appInfo.get_display_name() ||
        appInfo.get_name() ||
        ""
      ).toLowerCase();
      const generic = (appInfo.get_generic_name() || "").toLowerCase();
      const exec = (appInfo.get_executable() || "").toLowerCase();

      let score = -1;
      if (name === lower) score = 100;
      else if (name.startsWith(lower)) score = 80;
      else if (name.includes(lower)) score = 60;
      else if (generic.includes(lower)) score = 40;
      else if (exec.includes(lower)) score = 20;

      if (score > 0) scored.push({ appInfo, score });
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, maxResults).map((s) => s.appInfo);
  }

  _clearResults() {
    this._resultsBox.destroy_all_children();
    this._resultItems = [];
    this._selectedIndex = -1;
    this._resultsScroll.hide();
  }

  _populateResults(queryText, calcResult, systemActions, apps) {
    this._resultsBox.destroy_all_children();
    this._resultItems = [];

    const addItem = (item) => {
      this._resultsBox.add_child(item);
      this._resultItems.push(item);
    };

    if (calcResult !== null) {
      addItem(
        new ResultItem({
          iconName: "accessories-calculator-symbolic",
          title: String(calcResult),
          subtitle: `${queryText} =`,
          shortcutLabel: "Copy ↵",
          onActivate: () => {
            St.Clipboard.get_default().set_text(
              St.ClipboardType.CLIPBOARD,
              String(calcResult),
            );
            this.close();
          },
        }),
      );
    }

    for (const action of systemActions) {
      addItem(
        new ResultItem({
          iconName: action.icon,
          title: action.title,
          subtitle: "System action",
          onActivate: () => {
            this.close();
            action.run();
          },
        }),
      );
    }

    for (const appInfo of apps) {
      addItem(
        new ResultItem({
          gicon: appInfo.get_icon(),
          title: appInfo.get_display_name() || appInfo.get_name(),
          subtitle: appInfo.get_description() || "",
          onActivate: () => {
            this.close();
            appInfo.launch([], global.create_app_launch_context(0, -1));
          },
        }),
      );
    }

    if (queryText) {
      addItem(
        new ResultItem({
          iconName: "web-browser-symbolic",
          title: `Search the web for "${queryText}"`,
          subtitle: "Open in default browser",
          onActivate: () => {
            this.close();
            Gio.AppInfo.launch_default_for_uri(
              `https://www.google.com/search?q=${encodeURIComponent(queryText)}`,
              global.create_app_launch_context(0, -1),
            );
          },
        }),
      );
    }

    if (this._resultItems.length > 0) {
      this._resultsScroll.show();
      this._selectedIndex = 0;
      this._resultItems[0].setSelected(true);
    } else {
      this._resultsScroll.hide();
      this._selectedIndex = -1;
    }
  }

  destroy() {
    if (this._isOpen) this.close();

    if (this._monitorsChangedId) {
      Main.layoutManager.disconnect(this._monitorsChangedId);
      this._monitorsChangedId = null;
    }

    this._topActor?.destroy();
    this._topActor = null;
    this._settings = null;
  }
}

/* ---------------------------------------------------------------------- */
/* Extension entry point                                                  */
/* ---------------------------------------------------------------------- */
export default class SpotlightExtension extends Extension {
  enable() {
    this._settings = this.getSettings();
    this._overlay = new SpotlightOverlay(this);

    Main.wm.addKeybinding(
      "toggle-shortcut",
      this._settings,
      Meta.KeyBindingFlags.NONE,
      Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW,
      () => this._overlay.toggle(),
    );
  }

  disable() {
    Main.wm.removeKeybinding("toggle-shortcut");

    this._overlay?.destroy();
    this._overlay = null;
    this._settings = null;
  }
}
