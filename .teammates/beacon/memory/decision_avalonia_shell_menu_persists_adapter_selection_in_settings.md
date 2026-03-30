---
version: 0.7.2
name: Avalonia shell menu persists adapter selection in settings
description: Persist the desktop shell adapter choice in the shared repo-local settings file and restart the bridge when it changes.
type: decision
---
# Avalonia shell menu persists adapter selection in settings

## Decision

The Avalonia desktop shell should persist its selected agent adapter in `.teammates/settings.json` under `shell.adapterName`, and changing that menu option should restart the Node shell bridge with the new adapter immediately.

## Why

- Adapter choice is project-local shell state, so it belongs with the existing repo-local settings file rather than an app-global preference store.
- The shell already depends on `.teammates/` for bridge startup, so keeping adapter persistence there avoids a second configuration path.
- Restarting the bridge on selection keeps the active shell truthful to the checked menu state instead of requiring a full app restart.

## Apply this

- Keep desktop menu chrome in `MainWindow` and let it drive view-model commands.
- Expose current adapter, working directory, available adapters, and `SetAdapterAsync()` through the shell client interface.
- Preserve unrelated fields when writing `.teammates/settings.json`; only extend it with `shell.adapterName`.

## Consequence

Future shell options should prefer `.teammates/settings.json` too, unless a setting is clearly machine-global rather than repo-local.
