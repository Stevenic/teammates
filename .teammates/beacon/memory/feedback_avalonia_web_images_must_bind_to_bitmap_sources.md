---
version: 0.7.2
name: Avalonia web images must bind to bitmap sources
description: Raw URL properties are not a reliable binding shape for Avalonia Image controls; expose Bitmap or Task<Bitmap?> instead.
type: feedback
---
# Avalonia web images must bind to bitmap sources

## Rule

When an Avalonia `Image` needs to show a remote image, do not bind `Source` directly to a URL or `Uri` property from the view model.

Expose a `Bitmap` or `Task<Bitmap?>` from the view model and bind with Avalonia's supported pattern instead:

- synchronous: `Source="{Binding SomeBitmap}"`
- asynchronous: `Source="{Binding SomeBitmapTask^}"`

## Why

- Avalonia's image-binding guidance documents `Bitmap` and `Task<Bitmap?>` as the supported binding shapes for remote images.
- A raw URL may be a valid literal in XAML in some contexts, but it is not the safe view-model contract for dynamic remote avatars.
- The async `^` binding keeps image loading out of the XAML layer and makes failures explicit and recoverable.

## Apply this

- Put URL construction and download logic in the view model or a helper/service layer.
- Cache remote avatar downloads by stable key when the same image can appear in multiple places.
- Keep the shared shell templates bound to image objects, not transport-facing URLs.
