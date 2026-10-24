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
│   ├── update.js         # Auto-updater & GitHub release manager
│   ├── curveBox.js       # Layer 2: Interactive canvas cubic-bezier UI
│   └── app.js            # Frontend UI controller & event binder
├── jsx/
│   ├── json2.js          # ES3 JSON polyfill for ExtendScript
│   └── host.jsx          # Layer 3: ExtendScript host engine for AE
├── css/
│   └── style.css         # Dark theme styling, glassmorphism, micro-animations
├── test/
│   ├── coreMath.test.js  # Node.js unit tests for bezier <-> ease math
│   ├── update.test.js    # Unit tests for semver & GitHub update logic
│   ├── server.test.js    # Web server & panel asset integration tests
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
  - **Transformations**: Reverse (flip), Alt-mirror (point symmetry through center), Ctrl-mirror (mirrors horizontal X position only to pull handles closer/apart), and double-click flatten

### Layer 2: UI Viewport (`js/curveBox.js` & `js/app.js`)
- Retina/HiDPI canvas rendering with glowing bezier paths.
- Dynamic animated zooming: viewport smoothly animates $Y$-range when overshoot curves expand past $[0, 1]$.
- Clean, minimal UI: only icon buttons (Reverse, Analyze, Enter), with double-click handle flattening.
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

## Auto-Update & GitHub Setup

HaymGraph includes built-in auto-update checking via [`js/update.js`](file:///e:/Antigravity/HaymGraph/js/update.js). Whenever you push a new release or update to GitHub, your users and friends will automatically be notified inside the panel with an update indicator (⚙️🔴) and can update without manual reinstallation.

### 1. GitHub Repository
Repository: [https://github.com/arsh817258-lab/HaymGraph](https://github.com/arsh817258-lab/HaymGraph)

```bash
git remote add origin https://github.com/arsh817258-lab/HaymGraph.git
git push -u origin main
```

### 2. Publishing a New Version
When you want your friends to get an update:
1. Update the version in `package.json` and `js/update.js` (e.g. from `1.0.0` to `1.1.0`).
2. Commit and push:
   ```bash
   git add .
   git commit -m "release: v1.1.0"
   git tag v1.1.0
   git push origin main --tags
   ```
3. (Optional) Create a GitHub Release for tag `v1.1.0`.
4. Anyone opening HaymGraph will automatically receive the update alert in their panel!

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
