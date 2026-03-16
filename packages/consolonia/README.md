# @teammates/consolonia

> Part of the [teammates](https://github.com/Stevenic/teammates) monorepo.

Terminal UI rendering engine inspired by Consolonia. Pixel-level compositing with ANSI output.

## Quick Start

```bash
npm install @teammates/consolonia
```

## Features

- Pixel-level terminal buffer with foreground/background compositing
- Box-drawing character merging (single, double, mixed)
- Layout system: Box, Row, Column, Stack with constraint-based sizing
- Clipping regions for nested drawing contexts
- Widget library: Border, Panel, Text, TextInput, ScrollView, ChatView, Markdown, Syntax
- Styled text with inline markup (`*bold*`, `_italic_`, `` `code` ``, `~dim~`)
- Input processing: keyboard, mouse, paste detection, escape sequences
- ANSI output with dirty-region rendering (only redraws what changed)

## Architecture

```
src/
  pixel/        # Buffer, Pixel, Color, Symbol, Foreground, Background
  layout/       # Box, Row, Column, Stack, Control (constraint solver)
  drawing/      # DrawingContext, Clip
  render/       # RenderTarget, Regions (dirty tracking)
  widgets/      # Border, Panel, Text, TextInput, ScrollView, ChatView, Markdown, Syntax
  input/        # Processor, Matchers (text, escape, mouse, paste)
  ansi/         # Escape codes, Output, Strip
  styled.ts     # Inline markup parser
  app.ts        # Application lifecycle
  index.ts      # Public API
```

## Testing

```bash
npm test
```

## Requirements

- Node.js >= 20
