# Changelog

## Unreleased

- Removed the unused overlay `clearLearningHistory()` method; Preferences continues to clear history through the existing settings signal.
- Moved Spotlight's build scripts, tests, release documents, package configuration, and generated output into the extension folder. Updated paths and archive checks so each extension can keep its own tooling.
- Simplified the user guide and updated build, release, and verification instructions for the self-contained folder layout.
- Fixed empty `!` system mode and missing system search results by reading GNOME's JavaScript availability getters directly. Added native search regression coverage and safe dispatch checks for all five system actions.

## 3.1.1 — 2026-11-02

- Fixed activation of already-running applications: exit overview, release Shell keyboard focus, and preserve the input timestamp when switching to an existing window.
- Added native GNOME regression coverage for running apps, minimized windows, and apps on another workspace, including checks that switching does not create duplicate windows.

## 3.1.0 — 2026-11-02

- Fixed clipboard opt-in, whitespace preservation, disable-time cleanup, and accidental persistence in learned history. Scrub legacy clipboard history on load.
- Enforced provider settings in scoped searches and separated query-history consent from learned ranking.
- Replaced blocking file enumeration with cancellable asynchronous batches; fixed overlapping roots, added a scan-work bound, lazy startup, and manual refresh.
- Cached normalized file search data and ranked results once; added search debounce and coalesced index updates.
- Added optional panel access, quick-mode buttons, clear search, visible secondary actions, Alt+1…9 activation, and informative empty states.
- Made results keyboard-focusable buttons, restored ordinary Home/End text editing, added Ctrl+L and Ctrl+Home/End, and fixed query-history navigation.
- Improved narrow-screen sizing, scale-aware panel width, high contrast, reduced motion, and Unicode search/highlighting. Blur is limited to the card.
- Added GNOME 45–51 API compatibility paths, pending-work cleanup, and correct GNOME error notifications.
- Prevented unsafe global shortcuts; new installations default to Super+Ctrl+Space. Added duplicate shortcut validation and retained shortcuts while editing.
- Validated custom search URLs without silently falling back to a different search engine; ordinary phrases no longer switch scopes accidentally.
- Bounded calculator expressions and fixed misleading indefinite “Calculating” messages and numeric search takeover.
- Added automated core, native Gio, and GNOME Shell/GTK integration tests, a reproducible archive builder, and release verification documentation.

## 3.0.0

- Added local usage-aware result ranking with bounded on-device history.
- Added exact/word/acronym match boosts and result-title match highlighting.
- Added recent applications and recent files to the empty state.
- Added result category badges and destructive system-action styling.
- Added app actions: switch/open, new instance, and application details.
- Added file actions for opening the containing folder.
- Added Ctrl+Enter, Shift+Enter, and Alt+Enter result actions.
- Added short search modes: `@` apps, `#` files, `!` system, `?` web, `~` clipboard, `=` calculator.
- Added optional session-only clipboard history search.
- Added optional selected-text global shortcut using the primary selection.
- Added local query history with Ctrl+Up / Ctrl+Down navigation.
- Added reorderable provider preference with soft ranking weights.
- Added ranking controls for exact matches, usage learning, running apps, favorites, and recent results.
- Added configurable result density, panel width, and category badges.
- Added clear-history controls separate from Reset to Defaults.
- Preserved all v2 fixes: predictable arrows, scroll reset, hover selection, safe shortcuts, running-app activation, multi-monitor layout, native system actions, and provider architecture.
- Removed stale `gschemas.compiled` from the ZIP; GNOME Shell 44+ compiles extension schemas during installation.
