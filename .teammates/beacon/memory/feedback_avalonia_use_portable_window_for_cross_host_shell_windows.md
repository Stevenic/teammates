---
version: 0.7.2
name: Avalonia uses PortableWindow for cross-host shell windows
description: Shell windows should target PortableWindow rather than raw Window so desktop and console hosts share one window abstraction.
type: feedback
---
# Avalonia uses PortableWindow for cross-host shell windows

## Feedback

For the Avalonia shell, use `PortableWindow` instead of raw `Window` for shared shell windows and dialogs.

## Why

- The user explicitly wants one UI system that works in both desktop and console hosts.
- Raw `Window` usage invites host-specific regressions to leak into every dialog and top-level shell window.
- A shared `PortableWindow` abstraction gives one seam for future cross-host window behavior without chasing individual windows later.

## Apply this

- Make shared shell windows such as `MainWindow` and About/help dialogs inherit from `PortableWindow`.
- Keep host-specific window styling in the host app resources/themes rather than scattering host conditionals through view code.
- If the window implementation needs to change later, update `PortableWindow` once instead of editing every shell window class.
