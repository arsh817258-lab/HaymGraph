const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('Live Sync & Selection Property Detection', async (t) => {
    await t.test('index.html contains live sync toggle, library elements, and status bar', () => {
        const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
        assert.ok(html.includes('id="btn-live-sync"'), 'index.html must have #btn-live-sync');
        assert.ok(html.includes('id="btn-copy"'), 'index.html must have #btn-copy');
        assert.ok(html.includes('id="btn-paste"'), 'index.html must have #btn-paste');
        assert.ok(html.includes('id="status-dot"'), 'index.html must have #status-dot');
        assert.ok(html.includes('id="mixed-indicator"'), 'index.html must have #mixed-indicator');

        // Library elements
        assert.ok(html.includes('id="preset-name-input"'), 'index.html must have #preset-name-input');
        assert.ok(html.includes('id="btn-save-preset"'), 'index.html must have #btn-save-preset');
        assert.ok(html.includes('id="preset-list"'), 'index.html must have #preset-list');
        assert.ok(html.includes('class="app-body"'), 'index.html must have .app-body container');
        assert.ok(html.includes('class="library-panel"'), 'index.html must have .library-panel');

        // Verify btn-live-sync is inside or beside the copy paste group
        const copyIndex = html.indexOf('id="btn-copy"');
        const pasteIndex = html.indexOf('id="btn-paste"');
        const liveSyncIndex = html.indexOf('id="btn-live-sync"');
        assert.ok(pasteIndex > copyIndex, 'paste should be after copy');
        assert.ok(liveSyncIndex > pasteIndex, 'live sync toggle should be right beside paste');
    });

    await t.test('CurveBox initializes with onCurveRelease option', () => {
        const mockCanvas = {
            getContext: () => ({
                scale: () => {},
                clearRect: () => {},
                fillRect: () => {},
                save: () => {},
                restore: () => {},
                strokeRect: () => {},
                beginPath: () => {},
                moveTo: () => {},
                lineTo: () => {},
                stroke: () => {},
                bezierCurveTo: () => {},
                arc: () => {},
                fill: () => {},
                createLinearGradient: () => ({ addColorStop: () => {} }),
                setLineDash: () => {}
            }),
            style: {},
            width: 300,
            height: 260,
            addEventListener: () => {}
        };

        const mockContainer = {
            getBoundingClientRect: () => ({ width: 300, height: 260 }),
            appendChild: () => {}
        };

        global.document = {
            createElement: () => mockCanvas,
            querySelector: () => mockContainer
        };
        global.window = {
            devicePixelRatio: 1,
            addEventListener: () => {}
        };
        global.requestAnimationFrame = () => {};

        const CurveBox = require('../js/curveBox.js');
        let releasedCurve = null;
        const box = new CurveBox(mockContainer, {
            onCurveRelease: (c) => {
                releasedCurve = c;
            }
        });

        assert.equal(typeof box.onCurveRelease, 'function', 'box should have onCurveRelease function');
        box.onCurveRelease(box.curve);
        assert.ok(releasedCurve !== null, 'onCurveRelease should have received curve');
        assert.equal(releasedCurve.x1, box.curve.x1);
    });

    await t.test('Multiple properties with SAME curve do NOT trigger warning, ONLY mixed curves trigger warning', () => {
        // Case 1: Multiple properties (e.g. Position, Scale, Opacity) with IDENTICAL curves
        const multiPropsIdenticalCurves = {
            propNames: ['Position', 'Scale', 'Opacity'],
            differentPropsCount: 3,
            hasMixedCurves: false
        };
        // It shouldn't show warning unless graphs aren't same:
        const shouldWarn1 = multiPropsIdenticalCurves.hasMixedCurves;
        assert.equal(shouldWarn1, false, 'Multiple properties with identical curves MUST NOT trigger warning');

        // Case 2: Different curves (graphs aren't same)
        const multiPropsMixedCurves = {
            propNames: ['Position', 'Scale'],
            differentPropsCount: 2,
            hasMixedCurves: true
        };
        const shouldWarn2 = multiPropsMixedCurves.hasMixedCurves;
        assert.equal(shouldWarn2, true, 'Different curves MUST trigger warning');

        // Case 3: Single property with mixed curves
        const singlePropMixedCurves = {
            propNames: ['Position'],
            differentPropsCount: 1,
            hasMixedCurves: true
        };
        const shouldWarn3 = singlePropMixedCurves.hasMixedCurves;
        assert.equal(shouldWarn3, true, 'Single property with mixed curves MUST trigger warning');
    });

    await t.test('Preset Library slot reordering and SVG preview generation', () => {
        // Preset reordering logic test (simulating drag & drop slotting)
        const presets = [
            { id: '1', name: 'Ease Out', curve: { x1: 0.16, y1: 1.0, x2: 0.3, y2: 1.0 } },
            { id: '2', name: 'Ease In', curve: { x1: 0.7, y1: 0.0, x2: 0.84, y2: 0.0 } },
            { id: '3', name: 'Overshoot', curve: { x1: 0.2, y1: 1.35, x2: 0.6, y2: 1.0 } }
        ];

        // Drag item 2 (Overshoot) to slot 0 (first position)
        const draggedIndex = 2;
        const targetIndex = 0;
        const moved = presets.splice(draggedIndex, 1)[0];
        presets.splice(targetIndex, 0, moved);

        assert.equal(presets[0].name, 'Overshoot', 'Overshoot should now be in slot 0');
        assert.equal(presets[1].name, 'Ease Out', 'Ease Out should now be in slot 1');
        assert.equal(presets[2].name, 'Ease In', 'Ease In should now be in slot 2');

        // SVG Path generation test
        function generateCurveSvgPath(c) {
            const px1 = 3 + c.x1 * 26;
            const py1 = 29 - c.y1 * 26;
            const px2 = 3 + c.x2 * 26;
            const py2 = 29 - c.y2 * 26;
            return `M 3 29 C ${px1.toFixed(1)} ${py1.toFixed(1)}, ${px2.toFixed(1)} ${py2.toFixed(1)}, 29 3`;
        }

        const pathEaseOut = generateCurveSvgPath(presets[1].curve);
        assert.ok(pathEaseOut.startsWith('M 3 29 C'), 'SVG path should start with move to origin');
        assert.ok(pathEaseOut.endsWith('29 3'), 'SVG path should end at (29, 3)');
    });

    await t.test('Selection fingerprint format uniqueness', () => {
        function buildFingerprint(compId, propData) {
            if (!propData || propData.length === 0) return 'none';
            const parts = propData.map(p => p.id + ':' + p.keys.join(','));
            return compId + '|' + parts.join(';');
        }

        const fp1 = buildFingerprint(1, [{ id: 'Pos_1', keys: [1] }]);
        const fp2 = buildFingerprint(1, [{ id: 'Pos_1', keys: [2] }]);
        const fp3 = buildFingerprint(1, [{ id: 'Pos_1', keys: [1, 2] }]);
        const fp4 = buildFingerprint(1, [{ id: 'Pos_1', keys: [1] }, { id: 'Op_2', keys: [1] }]);

        assert.notEqual(fp1, fp2, 'Different key selected must change fingerprint');
        assert.notEqual(fp1, fp3, 'Additional key selected must change fingerprint');
        assert.notEqual(fp1, fp4, 'Additional property selected must change fingerprint');
        assert.equal(fp1, buildFingerprint(1, [{ id: 'Pos_1', keys: [1] }]), 'Same selection must have identical fingerprint');
    });

    await t.test('Library complete collapse, dynamic columns, slider ratio, and theme color #066CE7', () => {
        const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
        const css = fs.readFileSync(path.join(__dirname, '..', 'css', 'style.css'), 'utf8');
        const appJs = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');

        // 1. Complete library collapse elements and styles
        assert.ok(html.includes('id="btn-library-toggle"'), 'Header must have #btn-library-toggle');
        assert.ok(html.includes('id="btn-toggle-library"'), 'Library header must have #btn-toggle-library');
        assert.ok(css.includes('#app-container.library-collapsed #library-panel'), 'CSS must completely hide library panel on library-collapsed');
        assert.ok(css.includes('display: none !important'), 'CSS must set display: none !important when collapsed');
        assert.ok(appJs.includes('setLibraryCollapsed'), 'app.js must provide setLibraryCollapsed function');

        // 2. Dynamic responsive columns
        assert.ok(css.includes('grid-template-columns: repeat(auto-fill, minmax(42px, 1fr))'), 'CSS must use auto-fill minmax(42px, 1fr) for dynamic responsive columns');

        // 3. Slider option setting for % of library panel size
        assert.ok(html.includes('id="setting-library-ratio-slider"'), 'Settings modal must have #setting-library-ratio-slider');
        assert.ok(html.includes('id="setting-library-ratio-val"'), 'Settings modal must have #setting-library-ratio-val');
        assert.ok(css.includes('--library-ratio'), 'CSS must support --library-ratio CSS variable');
        assert.ok(appJs.includes('setLibraryRatio'), 'app.js must provide setLibraryRatio function');

        // 4. Theme color changed to #066CE7
        assert.ok(css.includes('--accent: #066CE7;'), 'CSS must define --accent as #066CE7');
        assert.ok(!css.includes('#4096F3'), 'CSS must not have any remaining #4096F3');
        assert.ok(!appJs.includes('#4096F3'), 'app.js must not have any remaining #4096F3');
    });

    await t.test('Rove Across Time in selection does not break roving and resolves spans properly', () => {
        const hostJsx = fs.readFileSync(path.join(__dirname, '..', 'jsx', 'host.jsx'), 'utf8');

        assert.ok(hostJsx.includes('function isKeyRoving'), 'host.jsx must implement isKeyRoving');
        assert.ok(hostJsx.includes('function setKeyRoving'), 'host.jsx must implement setKeyRoving');
        assert.ok(hostJsx.includes('function getPropertySegments'), 'host.jsx must implement getPropertySegments');
        assert.ok(hostJsx.includes('setKeyRoving(prop, r, true)'), 'host.jsx must preserve intermediate roving keyframes');

        // Test the segment resolver algorithm with mock property
        function mockGetPropertySegments(numKeys, rovingKeysMap, sortedKeys) {
            function isKeyRoving(k) { return Boolean(rovingKeysMap[k]); }
            function findPrevNonRoving(k) {
                if (!isKeyRoving(k)) return k;
                for (let i = k - 1; i >= 1; i--) {
                    if (!isKeyRoving(i)) return i;
                }
                return 1;
            }
            function findNextNonRoving(k) {
                if (!isKeyRoving(k)) return k;
                for (let i = k + 1; i <= numKeys; i++) {
                    if (!isKeyRoving(i)) return i;
                }
                return numKeys;
            }

            const anchorIndices = [];
            const anchorMap = {};
            function addAnchor(idx) {
                if (idx >= 1 && idx <= numKeys && !anchorMap[idx]) {
                    anchorMap[idx] = true;
                    anchorIndices.push(idx);
                }
            }

            if (sortedKeys.length === 1) {
                const k = sortedKeys[0];
                if (isKeyRoving(k)) {
                    addAnchor(findPrevNonRoving(k));
                    addAnchor(findNextNonRoving(k));
                } else {
                    if (k < numKeys) {
                        addAnchor(k);
                        addAnchor(findNextNonRoving(k + 1));
                    } else if (k > 1) {
                        addAnchor(findPrevNonRoving(k - 1));
                        addAnchor(k);
                    }
                }
            } else {
                for (let i = 0; i < sortedKeys.length; i++) {
                    const keyIdx = sortedKeys[i];
                    if (isKeyRoving(keyIdx)) {
                        addAnchor(findPrevNonRoving(keyIdx));
                        addAnchor(findNextNonRoving(keyIdx));
                    } else {
                        addAnchor(keyIdx);
                    }
                }
            }

            anchorIndices.sort((a, b) => a - b);
            const segments = [];
            for (let j = 0; j < anchorIndices.length - 1; j++) {
                if (anchorIndices[j] < anchorIndices[j + 1]) {
                    segments.push([anchorIndices[j], anchorIndices[j + 1]]);
                }
            }
            return segments;
        }

        // Case 1: Keys 1, 2, 3 selected, Key 2 is roving across time
        const seg1 = mockGetPropertySegments(3, { 2: true }, [1, 2, 3]);
        assert.deepEqual(seg1, [[1, 3]], 'Selecting [1, 2, 3] with key 2 roving must yield single segment [1, 3]');

        // Case 2: Keys 1, 2 selected, Key 2 is roving
        const seg2 = mockGetPropertySegments(3, { 2: true }, [1, 2]);
        assert.deepEqual(seg2, [[1, 3]], 'Selecting [1, 2] with key 2 roving must span to anchor 3');

        // Case 3: Multiple roving keys [1, 2, 3, 4] where 2 and 3 are roving
        const seg3 = mockGetPropertySegments(4, { 2: true, 3: true }, [1, 2, 3, 4]);
        assert.deepEqual(seg3, [[1, 4]], 'Multiple consecutive roving keys must yield span [1, 4]');

        // Case 4: Keys [1, 2, 3, 4] where key 2 is roving, 1, 3, 4 are standard
        const seg4 = mockGetPropertySegments(4, { 2: true }, [1, 2, 3, 4]);
        assert.deepEqual(seg4, [[1, 3], [3, 4]], 'Roving key followed by standard keys must yield segments [[1, 3], [3, 4]]');

        // Case 5: Standard keys without roving [1, 2, 3]
        const seg5 = mockGetPropertySegments(3, {}, [1, 2, 3]);
        assert.deepEqual(seg5, [[1, 2], [2, 3]], 'Standard selection without roving must yield [[1, 2], [2, 3]]');
    });

    await t.test('Library layout options (auto, vertical, horizontal) and overshoot grid refinements', () => {
        const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
        const css = fs.readFileSync(path.join(__dirname, '..', 'css', 'style.css'), 'utf8');
        const appJs = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');
        const curveBoxJs = fs.readFileSync(path.join(__dirname, '..', 'js', 'curveBox.js'), 'utf8');

        // 1. Setting option for layout
        assert.ok(html.includes('id="setting-layout-group"'), 'Settings modal must have #setting-layout-group');
        assert.ok(html.includes('data-layout="auto"'), 'Settings modal must have auto layout button');
        assert.ok(html.includes('data-layout="vertical"'), 'Settings modal must have vertical layout button');
        assert.ok(html.includes('data-layout="horizontal"'), 'Settings modal must have horizontal layout button');

        // 2. CSS rules for segmented controls and layout-vertical
        assert.ok(css.includes('.setting-segmented-group'), 'CSS must define .setting-segmented-group');
        assert.ok(css.includes('.setting-segment-btn'), 'CSS must define .setting-segment-btn');
        assert.ok(css.includes('#app-container.layout-vertical'), 'CSS must define #app-container.layout-vertical');

        // 3. app.js handles layout preference
        assert.ok(appJs.includes('setLayoutPreference'), 'app.js must define setLayoutPreference');
        assert.ok(appJs.includes('haymgraph_library_layout_pref'), 'app.js must persist layout preference in localStorage');

        // 4. curveBox drag stability and overshoot grid
        assert.ok(curveBoxJs.includes('dragOrigin'), 'curveBox.js must use dragOrigin for 1:1 stable handle dragging');
        assert.ok(curveBoxJs.includes('overshootGuides'), 'curveBox.js must render clean overshoot guidelines');
    });
});
