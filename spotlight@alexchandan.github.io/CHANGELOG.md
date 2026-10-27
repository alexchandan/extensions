# Changelog

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
