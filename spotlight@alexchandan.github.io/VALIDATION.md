# Spotlight verification

This document records checks of the current source tree, including **Unreleased**
changes. The metadata still identifies the build as `3.1.1`; see
[CHANGELOG.md](CHANGELOG.md) for the distinction between released and pending work.

## Latest checks

Checked on **2026-11-06** after moving the tooling into the extension folder.
Runtime: **GNOME Shell 51.1, GJS 1.90.1, isolated headless Wayland**.

| Check | Result |
| --- | --- |
| Core JavaScript assertions | 33 passed |
| Native GJS/Gio assertions | 21 passed |
| GNOME Shell / GTK assertions | 79 passed; none skipped |
| Node and GJS module syntax | Passed for runtime and test modules |
| Strict GSettings schema validation | Passed |
| Archive integrity, runtime-module coverage, and source equality | Passed |
| Development files excluded from the ZIP | Passed |
| Relocated benchmark | Passed; results below |
| Local documentation links, folder layout, and `git diff --check` | Passed |

The ZIP and `SHA256SUMS` are in this folder's `dist/`. Desktop logs and screenshots
are also written there. Generated artifacts are ignored by Git.

Dead-code cleanup used a reference audit of imports, exports, methods, dynamic
imports, and settings signals. The unused overlay `clearLearningHistory()` method
was removed after the full suite passed, then the same checks were run again.
The active Preferences/settings-signal history-clear path remains in place.

## What the tests cover

- **Core:** calculator precedence and invalid input, scoped searches (including
  empty system mode), Unicode matching, markup escaping, and shortcut safety.
- **Native Gio:** file indexing with overlapping roots, depth limits, hidden and
  dependency directories, deduplication, symlink loops, bounded work, cancellation,
  and teardown. History checks cover owner-only permissions, independent privacy
  controls, clearing history, and removal of legacy clipboard data. Web checks cover
  encoding and invalid/custom URLs.
- **GNOME/GTK:** real keyboard input, global shortcuts, panel controls, opening and
  reopening, calculator output, clipboard consent and whitespace preservation,
  provider toggles, disable/re-enable, and preferences opening and cleanup.
- **Application activation:** temporary launch handlers and two real test-helper
  windows verify dispatch and switching. Regression cases cover overview, minimized
  windows, and another workspace, with no duplicate windows created.
- **System actions:** search uses GNOME's native availability getters. Harmless
  fixtures verify dispatch of lock, suspend, restart, shutdown, and logout; the tests
  do not actually lock, suspend, shut down, or end a session.

File, containing-folder, and web launches use temporary desktop handlers. MIME
defaults change only inside disposable XDG directories. These checks verify
Spotlight's dispatch, not the behavior of every installed browser or file manager.
High contrast uses forced settings; narrow layout uses a simulated 360-pixel monitor
rectangle. These are code-path checks, not physical display or screen-reader tests.

## Performance and index limits

The relocated `tests/benchmark.js` searched 10,000 synthetic file entries 15 times.
On 2026-11-06 it measured **7.760 ms median**, **11.942 ms maximum**; raw output is
in `dist/benchmark.json`. This is a local search microbenchmark with cold/JIT effects,
not a disk-I/O, memory, GPU, or end-to-end frame-time measurement.

File indexing starts when Spotlight first opens. It reads names and metadata in
asynchronous batches of 80 entries: home plus one child level, and configured
Desktop, Documents, Downloads, Pictures, Music, and Videos folders to four child
levels. The default limit is 4,000 entries, configurable from 500 to 10,000. Scanning
also stops after examining eight times that limit. Hidden/dependency trees and
symlink traversal are excluded. Refresh is manual; there is no file polling timer.

Typing is debounced by 45 ms, index updates are coalesced, file search text is cached,
and blur is limited to the card. Clipboard snapshots are taken on opening, with
at most 12 entries of 4,000 characters each. Actual performance depends on the desktop
and workload; the implementation does not promise zero impact.

## Reproduce

From the repository root, enter the extension folder once:

```bash
cd spotlight@alexchandan.github.io
npm test
npm run build
npm run test:shell
(cd dist && sha256sum -c SHA256SUMS)
glib-compile-schemas --strict schemas
GSETTINGS_BACKEND=memory \
  GSETTINGS_SCHEMA_DIR="$PWD/schemas" \
  gjs -m tests/benchmark.js
```

`test:shell` requires GNOME 51's test tool, platform libraries, a working private
D-Bus session, and headless Wayland support. It starts a disposable compositor
without replacing the user's desktop. Its wrapper removes the performance tool's
window filter so the isolated session can discover its test windows. Service warnings
can occur inside that session; assertion failures still make the runner fail.

## Checks still required before publishing

- Run on each advertised GNOME version. Versions 45–50 have compatibility code but
  have not been verified in those runtimes.
- Test mixed-DPI/multi-monitor hardware, large text, Orca announcements, touch,
  input-method composition, RTL layout, and lock/unlock and login/logout transitions.
- Check real AppStream details, Settings panels, FileManager1 reveal, browser
  behavior, and native logout/restart/power confirmation dialogs on target distros.
- Review the current GNOME Extensions requirements and complete submission review.
  Local build and test success is not publication approval.

The UI is English; Unicode search support does not imply translated controls.
Follow [RELEASE.md](RELEASE.md) for packaging and submission steps.
