---
version: 0.7.2
name: avalonia shared shell uses resources for scalars and platform branches for structure
description: Use host resources for scalar density tokens and platform-specific XAML branches or templates for structural shell differences between desktop Avalonia and Consolonia.
type: decision
---
# Avalonia shared shell uses resources for scalars and platform branches for structure

## Decision

For the shared shell, use host-defined resources for scalar presentation values such as spacing, sizing, thickness, corner radius, and font size, but use platform-specific templates or `console:OnPlatformEx` branches when the layout structure itself differs between desktop and console.

## Why

- Consolonia explicitly extends Avalonia's platform-specific XAML support with `console:OnPlatformEx`, including full alternate markup branches for console-specific layout.
- Resource tokens are the right tool for density differences, but they cannot fix a layout whose structure is wrong for the console form factor.
- The current shell already proves the resource pattern works for scalar differences and host-owned `TabStripPlacement`, but the remaining tab/header/feed composition is still desktop-shaped in shared XAML.

## Apply this

- Keep shared MVVM, routing, transport contracts, and behavior shared across hosts.
- Keep scalar values in each host `App.axaml`.
- Extract reusable content components such as the agent activity/chat pane so they are not baked into the root shell view.
- For shell regions whose composition differs by platform, use host-supplied templates or `console:OnPlatformEx` branches instead of forcing one shared visual tree to fit both GUI and TUI.

## Consequence

The next shell refactor should focus on separating shared behavior from host-specific shell composition, starting with an extracted activity/feed component and platform-specific tab/header layouts.
