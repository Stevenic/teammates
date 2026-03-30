---
version: 0.7.2
name: Avalonia resource types must match property types
description: Shared XAML resources need to use the exact Avalonia type expected by consuming properties.
type: feedback
---
# Avalonia resource types must match property types

When defining reusable Avalonia resources for styled properties, use the concrete resource type the target property expects rather than assuming Avalonia will coerce a primitive value.

## Why

- `DynamicResource` can flow a raw `double` value into a property lookup without converting it to `CornerRadius`.
- If a `Border.CornerRadius` binding receives an `x:Double`, Avalonia throws `System.InvalidCastException` during template application.
- Shared shell design tokens are reused widely, so a mistyped resource can crash the app at startup instead of failing in one isolated control.

## Apply this

- Use `<CornerRadius>` for corner tokens, `<Thickness>` for padding/margin tokens, and `<x:Double>` only for properties that actually take `double`.
- When introducing a shared resource consumed in control templates, sanity-check the target Avalonia property type before wiring it into `DynamicResource`.
