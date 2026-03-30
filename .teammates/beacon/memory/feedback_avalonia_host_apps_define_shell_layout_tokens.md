---
version: 0.7.2
name: Avalonia host apps define shell layout tokens
description: Shared shell views should consume geometry tokens from resources, and each host app must define those resources in its own App.axaml.
type: feedback
---
# Avalonia host apps define shell layout tokens

When a shared Avalonia view is used by multiple hosts, keep width, height, margin, thickness, and corner-radius values out of the view and require each host application to define the geometry tokens in its own `App.axaml`.

## Why

- The shared shell should describe structure and bindings, not hard-code desktop-centric geometry.
- Different hosts need different density profiles; the desktop app and the console app cannot share the same literal dimensions.
- Putting the resource contract in each host keeps the shared view portable while still allowing platform-appropriate sizing.

## Apply this

- Replace literal layout numbers in shared views with named `DynamicResource` tokens.
- Define the full token set in every host `App.axaml` that can load the shared view.
- Use concrete Avalonia resource types that match the consuming property (`Thickness`, `CornerRadius`, `x:Double`).
