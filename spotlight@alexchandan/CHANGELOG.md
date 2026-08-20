# Changelog

## 2.0.6

- Restored relevance-driven global search ordering instead of rigid provider grouping.
- Added a modest installed-app preference boost so equally relevant app matches usually win.
- Strong exact/prefix file and window matches can now outrank weak fuzzy app matches.
- Scoped searches such as `app:`, `file:`, and `win:` remain unchanged.

## 2.0.5

- Fixed switching to already-running applications by using `Shell.App.activate_full()`, GNOME Shell's native high-level app activation path.
- Preserve the actual keyboard/mouse event timestamp through result activation so Mutter accepts the focus request as user initiated.
- Kept a compatibility fallback to `Shell.App.activate()` and desktop-file launch.

## 2.0.4

- Require global shortcuts to use at least two keys (modifier + key).
- Group normal search results by provider: installed apps, files, windows, Settings, calculator, system actions, then web search.
- Selecting a running application now switches to its most recently used window.


## 2.0.3

- Reset the results viewport to the top whenever a new result set is rendered.
- Unified mouse hover and keyboard navigation into one active selection state.
- Kept keyboard scrolling explicit through the public `St.Adjustment` API.

## 2.0.2

- Fixed keyboard result navigation so a single arrow press advances exactly one selectable result.
- Removed the duplicate overlay-level key handler and stopped arrow navigation from wrapping unexpectedly.
- Added a confirmed **Reset to Defaults** action for all preferences.
- Kept Theme and Web Search Engine combo rows synchronized after a reset.
- Switched result scrolling to the public `St.ScrollView.get_vadjustment()` API.
- Hardened SystemActions availability checks by reading the declared GObject properties directly.

## 2.0.1

- Renamed the GNOME Shell main-module alias from `Main` to `ShellMain` everywhere.
- Added a journal marker (`[Spotlight 2.0.1] enabling`) to make stale installs easy to identify.
- Repacked after a reported `ReferenceError: Main is not defined`.

## 2.0.0

- Refactored the extension into UI, provider, and utility modules.
- Added fuzzy application ranking with running/favorite/usage boosts.
- Added window, local-file, GNOME Settings, and scoped provider search.
- Added safe arithmetic parsing and clipboard copy-on-activation.
- Replaced spawned power/session commands with GNOME Shell system actions.
- Added multi-monitor targeting and positioning fixes.
- Added reusable result rows instead of rebuilding the result UI on each keystroke.
- Added web engine selection and custom HTTP/HTTPS search templates.
- Added theme, blur, opacity, animation, result-count, provider, and index-size preferences.
- Added a graphical shortcut recorder and reset action.
- Fixed GNOME 45+ preferences import path and GSettings validation.
- Added GPL-3.0-or-later licensing and updated privacy/compatibility documentation.
