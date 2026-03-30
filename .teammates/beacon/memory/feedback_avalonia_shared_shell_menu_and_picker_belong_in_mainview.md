---
version: 0.7.2
name: Avalonia shared shell menu and picker belong in MainView
description: Keep menu composition and host-service interactions like folder picking in the shared shell view rather than MainWindow when the shell is meant to target desktop, console, and future mobile hosts.
type: feedback
---
# Avalonia shared shell menu and picker belong in MainView

## Feedback

For the shared Avalonia shell, put the menu structure and UI-bound host interactions such as folder picking in `MainView` or another reusable shell component, not in `MainWindow`.

## Why

- `MainWindow` is a desktop host detail, while the shell command surface is part of the reusable application UI.
- Android and iOS targets may not use the same window type or hosting shape, so menu ownership should stay with the shared shell layer.
- View-level code can resolve host services like `IStorageProvider` from `TopLevel.GetTopLevel(this)` without coupling the interaction to a specific window class.

## Apply This

- Keep `PortableWindow` as the host abstraction where a window exists.
- Keep view models responsible for shell state, command state, and transport calls.
- Put menu XAML and host-service click handlers in the shared view/component layer that is intended to survive across hosts.

## Consequence

Future shell targets can reuse the same menu/action surface without depending on `MainWindow`, and desktop hosts remain thin wrappers instead of owning shell behavior.
