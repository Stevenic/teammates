---
version: 0.7.2
name: Console menus should use explicit items, not templated view models
description: Consolonia menu rendering is more reliable when menu items are explicit controls with direct bindings instead of dynamically templated submenu view models.
type: feedback
---
# Console menus should use explicit items, not templated view models

## Feedback

For shared desktop/console menus, prefer explicit `MenuItem` definitions with direct bindings over dynamic submenu generation through `ItemsSource` + `ItemTemplate`.

## Why

- The console host rendered templated adapter submenu items as view-model type names instead of the intended labels.
- Static `MenuItem` definitions keep labels, commands, and checkbox state identical across desktop and console hosts.
- The adapter catalog is small and stable, so the extra indirection does not buy enough to justify the rendering risk.

## Apply this

- For small stable menus, declare each `MenuItem` directly in XAML and bind command parameters explicitly.
- Use view-model state for selection/checked values, but do not rely on templated submenu item materialization unless it has been verified in both hosts.
- If a menu must become dynamic later, test the console host specifically before standardizing on the templated approach.
