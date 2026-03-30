---
version: 0.7.2
name: avalonia shared view must externalize typography and platform shell layout
description: Shared Avalonia shell views must leave typography and platform-sensitive shell chrome to the host app instead of baking in desktop assumptions.
type: feedback
---
# Avalonia shared view must externalize typography and platform shell layout

When one Avalonia view is shared between desktop and Consolonia hosts, the shared XAML cannot own typography scale or assume the same shell chrome layout in both environments.

## Why

- Consolonia uses a character-cell model where font size, borders, and spacing collapse to discrete units, so desktop typography values do not translate cleanly.
- The console host may need different shell structure choices, such as a top tab strip instead of a left rail, even when the underlying MVVM and routing rules stay the same.
- Keeping these concerns host-owned preserves a single shared interaction model without forcing the TUI to mimic desktop presentation badly.

## Apply this

- Put font sizes, dense spacing, margins, borders, and similar presentational values behind host-defined resources.
- Move platform-sensitive shell control settings, such as `TabStripPlacement`, into host styles rather than hard-coding them in the shared view.
- If resource-only adaptation is not enough, add host-specific templates or `Consolonia` platform branches while keeping the view model and transport contract shared.
