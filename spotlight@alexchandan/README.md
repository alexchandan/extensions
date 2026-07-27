# Spotlight for GNOME

A macOS-Spotlight-style search overlay for GNOME Shell: a centered, rounded,
translucent search box with blurred/dimmed backdrop, live-filtered results,
full keyboard navigation, quick calculator, web-search fallback, and a
handful of system actions (lock, suspend, restart, shut down, log out).

Compatible with GNOME Shell **45, 46, 47, 48, 49, and 50** (the modern ESM extension
API — Wayland and X11 both work).

## Features

- `Super+Space` (configurable) opens/closes the overlay, like `⌘+Space` on macOS
- Fuzzy, ranked app search over every installed `.desktop` entry
- Inline calculator — type `12*7+4` and press Enter to copy the result
- System actions — type `lock`, `restart`, `shut down`, `log out`, `suspend`
- Falls back to "Search the web for …" when nothing else matches
- Full keyboard control: `↑`/`↓` to move, `Enter` to activate, `Esc` to close
- Click outside the box, or press Escape, to dismiss
- Preferences panel to change the shortcut and the number of results shown

## Installation

1. Copy this whole folder into your GNOME extensions directory, using the
   exact UUID as the folder name:

   ```bash
   mkdir -p ~/.local/share/gnome-shell/extensions
   cp -r spotlight@alexchandan ~/.local/share/gnome-shell/extensions/
   ```

2. Compile the settings schema (only needed once, and again if you edit the
   `.gschema.xml` file — a pre-compiled copy is already included, but it's
   good practice to rebuild it locally):

   ```bash
   glib-compile-schemas ~/.local/share/gnome-shell/extensions/spotlight@alexchandan/schemas/
   ```

3. Reload GNOME Shell:
   - **X11**: press `Alt+F2`, type `r`, press Enter.
   - **Wayland**: log out and log back in (Shell can't be reloaded live on Wayland).

4. Enable the extension:

   ```bash
   gnome-extensions enable spotlight@alexchandan
   ```

   Or open the **Extensions** app (or the **Extension Manager** app) and
   toggle "Spotlight" on.

5. Press `Super+Space` anywhere on the desktop to try it.

## Changing the shortcut

Open **Extensions** → **Spotlight** → the settings/gear icon, or run:

```bash
gnome-extensions prefs spotlight@alexchandan
```

`Super+Space` is the default. If it conflicts with your input-source switcher
or another binding, change it in the preferences window (GTK accelerator
syntax, e.g. `<Super>space`, `<Control><Alt>s`) — or via dconf directly:

```bash
gsettings --schemadir ~/.local/share/gnome-shell/extensions/spotlight@alexchandan/schemas/ \
  set org.gnome.shell.extensions.spotlight toggle-shortcut "['<Super>space']"
```

## Project layout

```
spotlight@alexchandan/
├── metadata.json      # extension identity + supported shell versions
├── extension.js       # overlay UI, search logic, keybinding (ESM, GNOME 45+ API)
├── prefs.js           # Adwaita preferences window
├── stylesheet.css      # the Spotlight "vibe": rounded card, blur/dim, selection highlight
└── schemas/
    └── org.gnome.shell.extensions.spotlight.gschema.xml
```

## Troubleshooting

- **Nothing happens on Super+Space** — something else may already claim that
  binding (many distros bind it to input-source switching). Change it in
  prefs, or check `gnome-extensions info spotlight@alexchandan` for errors.
- **Extension shows as "Error"** — run `journalctl -f -o cat /usr/bin/gnome-shell`
  (or `looking-glass` → Extensions tab) while reloading to see the stack trace.
- **Schema errors in prefs** — re-run the `glib-compile-schemas` command above
  after any edit to the `.gschema.xml` file.
