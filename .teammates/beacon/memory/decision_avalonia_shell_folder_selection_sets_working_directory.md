---
version: 0.7.2
name: Avalonia shell folder selection sets working directory
description: File/Open Folder should select the active project folder, not launch Explorer, and the shell title should reflect that path.
type: decision
---
# Avalonia shell folder selection sets working directory

## Decision

In the Avalonia shell, `File/Open Folder` should use Avalonia storage APIs to pick the active project folder, update the live shell bridge to that working directory, persist the selected path, and surface the chosen folder path in `Window.Title`.

## Why

- The menu action is project selection, not a request to open the current folder in the OS shell.
- The selected working directory affects which `.teammates/` folder, shell settings, and adapter state the bridge should use.
- Showing the active path in the window title makes the current project unambiguous when multiple shells are open.

## Apply this

- Use `IStorageProvider.OpenFolderPickerAsync` from the host window layer, not a platform-specific process launch.
- Keep the selected folder in shell settings so the app can restore it on restart.
- Treat the app repo location and the agents' active working directory as separate concepts in the shell client.

## Consequence

Future shell features that depend on project context should read from the selected working directory rather than assuming the app repo root.
