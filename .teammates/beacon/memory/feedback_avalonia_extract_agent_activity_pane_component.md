---
version: 0.7.2
name: Avalonia extract agent activity pane component
description: Keep the selected-agent chat/activity surface as a reusable component instead of baking it into the root shell view.
type: feedback
---
# Avalonia extract agent activity pane component

When the shell shows an agent's interaction feed plus composer, that surface should live in its own reusable view/component rather than being baked directly into `MainView`.

## Why

- The activity/chat surface is a logical pane with its own markup boundary.
- Desktop and console hosts need the same behavior but may wrap or position that pane differently.
- Extracting the pane lets host-specific shell layout work focus on tab/header composition without duplicating the feed/composer implementation.

## Apply this

- Keep shared shell behavior and routing in the existing view models.
- Put the selected-target header, feed, and composer in a dedicated view or control.
- Pass shell-level state into that component through explicit bindings or control properties rather than reaching back into a giant root view.

## Consequence

Future platform-specific layout work can branch around the shell chrome while reusing a single agent activity pane implementation.
