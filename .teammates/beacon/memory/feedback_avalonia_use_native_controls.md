---
version: 0.7.2
name: Avalonia native controls first
description: Prefer native Avalonia controls that already match the UX before composing custom control-like structures.
type: feedback
---
# Avalonia native controls first

When building the Avalonia shell, default to the framework control that already models the interaction pattern instead of recreating it from lower-level primitives.

## Why

- Native controls carry the right semantics, keyboard behavior, accessibility expectations, and styling hooks by default.
- Recreating control behavior with `ListBox`, `ItemsControl`, or raw layout containers makes the shell harder to maintain and easier to drift away from platform conventions.
- The shell should spend custom code on product-specific behavior, not on rebuilding standard UI widgets.

## Apply this

- Use `TabControl` for tabbed navigation.
- Use the platform's list, tree, menu, split, flyout, and dialog controls when they fit the UX.
- Only compose a bespoke structure when the built-in control cannot express the needed behavior cleanly, and make that tradeoff explicit.
