---
version: 0.7.2
name: avalonia-console-host-can-disable-shared-shell-avatars-via-resource
description: Shared shell avatar visibility should be host-controlled so the console host can suppress avatars without forking the shell structure.
type: feedback
---
# Avalonia console host can disable shared shell avatars via resource

When a shared Avalonia shell element should exist on desktop but disappear in the console host, prefer a host-defined resource toggle before splitting the markup.

## Why

- The shell structure stays the same across desktop and console, which matches the left-rail consistency rule.
- The console host can remove visual chrome that does not translate well to character-cell UI without changing view models or routing behavior.
- Desktop and console still share one visual tree, with each host owning presentation details through its `App.axaml`.

## Apply this

- Add a named resource such as `ShowShellAvatars` to every host that loads the shared view.
- Bind the shared element's `IsVisible` to that resource in the shared XAML.
- Use this pattern for simple host-specific presence/absence decisions; reserve `OnPlatformEx` or host-specific templates for true structural divergence.

## Consequence

The console host can suppress avatars cleanly while the desktop host keeps RoboHash persona icons, and the shared shell remains structurally aligned across hosts.
