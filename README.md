# HaymGraph

**HaymGraph** is a high-performance Adobe After Effects CEP extension for curve-based keyframe easing, temporal ease manipulation, and spatial position overshoot resolution.

---

## Architecture

HaymGraph is architected in three strictly decoupled layers:

```
HaymGraph/
├── js/
│   ├── coreMath.js       # Layer 1: Pure JS core math engine (Node & browser)
│   ├── csInterface.js    # CEP / Dev fallback bridge
│   ├── curveBox.js       # Layer 2: Interactive canvas cubic-bezier UI
│   └── app.js            # Frontend UI controller & event binder
├── jsx/
│   ├── json2.js          # ES3 JSON polyfill for ExtendScript
│   └── host.jsx          # Layer 3: ExtendScript host engine for AE
├── css/
│   └── style.css         # Dark theme styling, glassmorphism, micro-animations
├── test/
│   ├── coreMath.test.js  # Node.js unit tests for bezier <-> ease math
│   └── syntax.test.js    # Syntax validation tests for ExtendScript
├── CSXS/
│   └── manifest.xml      # CEP 11 / CSXS 9 manifest for AEFT 22.0+
├── .debug                # Remote debugging port (8089)
├── install.bat           # 1-click Windows installer (Registry & junction)
├── install.sh            # 1-click macOS installer
└── package.json
```

### Layer 1: Core Math Engine (`js/coreMath.js`)
- Pure JavaScript with zero DOM or CEP dependencies.
- Tested with `node --test` in Node.js.
- Implements:
  - **Forward Conversion**: Cubic Bezier $(x_1, y_1, x_2, y_2) \to$ AE `KeyframeEase(speed, influence)`
  - **Inverse Conversion**: AE `KeyframeEase` $\to$ Cubic Bezier $(x_1, y_1, x_2, y_2)$
  - **Extrema & Overshoot Detection**: Analytical roots of derivative $y'(t) = 0$ for exact curve peak/valley bounds
  - **Magnetic Snapping**: Flat, 45° diagonal, 0%, 100%, and grid lines (Shift bypasses)
  - **Transformations**: Reverse (flip), Alt-mirror, and double-click flatten

### Layer 2: UI Viewport (`js/curveBox.js` & `js/app.js`)
- Retina/HiDPI canvas rendering.
- Dynamic animated zooming: viewport smoothly animates $Y$-range when overshoot curves expand past $[0, 1]$.
- Live numeric readout of handles, influence %, and velocity slopes.
- CEP keyboard interest registration for `Enter` key.

### Layer 3: Host Layer (`jsx/host.jsx`)
- Single round-trip `evalScript` with JSON payload.
- All actions enclosed in single undo groups (`app.beginUndoGroup` / `app.endUndoGroup`).
- Segment rule: applies eases across consecutive selected keys; lone key defaults to next segment.
- Value types handled:
  - 1D properties (Opacity, Rotation, Slider Controls)
  - Multi-dimensional non-spatial (Scale `[x, y, z]`): one ease per dimension
  - Spatial properties (Position): single ease along path distance
- Interpolation: forces `KeyframeInterpolationType.BEZIER` and turns off roving (`setRovingAtKey(i, false)`).
- **Position Overshoot Fixer**:
  - Detects non-separated spatial Position keyframes when curve has overshoot ($y < 0$ or $y > 1$).
  - Shows 🔒 Locked badge.
  - One-click "Separate Dimensions & Apply" creates separated X/Y properties, remaps key times, and applies the curve in a single undo group.

---

## Getting Started

### 1. Installation into After Effects
- **Windows**: Double-click `install.bat` (or run in PowerShell/cmd).
- **macOS**: Run `./install.sh` in Terminal.
- Restart After Effects, then navigate to:
  `Window` → `Extensions` → `HaymGraph`.

### 2. Running Unit Tests
```bash
node --test test/**/*.test.js
```

### 3. Local Browser Preview / Dev Server
```bash
node server.js
```
Open `http://localhost:3000` in any browser.

---

## Known Limitations & Design Decisions
- **Single Cubic Bezier vs Multi-Bounce**: A single cubic bezier can produce anticipation and overshoot (a single bounce/settle), but cannot express multiple oscillations. True multi-bounce is treated as a separate follow-up feature (e.g. keyframe insertion or expression baking).
- **Spatial Position Path Curvature**: For unified spatial Position, $\Delta V$ is calculated as straight-line distance between keyframes. Curved motion paths are resolved cleanly when using the Position Overshoot Fixer's Separate Dimensions workflow.
