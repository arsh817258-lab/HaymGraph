/**
 * HaymGraph CurveBox - Interactive Canvas Cubic-Bezier Viewport
 * Implements draggable handles, dynamic zooming viewport,
 * magnetic snapping, Alt-mirroring, double-click flatten, and HiDPI rendering.
 */

(function (root, factory) {
    if (typeof exports === 'object' && typeof module !== 'undefined') {
        module.exports = factory(require('./coreMath.js'));
    } else {
        root.CurveBox = factory(root.HaymMath);
    }
}(typeof self !== 'undefined' ? self : this, function (HaymMath) {
    'use strict';

    function CurveBox(container, options) {
        this.container = typeof container === 'string' ? document.querySelector(container) : container;
        if (!this.container) throw new Error("CurveBox container not found.");

        this.options = options || {};
        this.onCurveChange = this.options.onCurveChange || function () {};

        // Curve state: normalized [0, 1] for x; y is unbounded
        this.curve = {
            x1: 0.333,
            y1: 0.0,
            x2: 0.667,
            y2: 1.0
        };

        // Dynamic Viewport state: animated min/max Y
        this.viewport = {
            currentMinY: -0.15,
            currentMaxY: 1.15,
            targetMinY: -0.15,
            targetMaxY: 1.15
        };

        // Interaction state
        this.activeHandle = null; // 1, 2, or null
        this.hoveredHandle = null;
        this.isDragging = null;
        this.lastClickTime = 0;
        this.lastClickHandle = null;
        this.currentSnapInfo = null;

        // Visual styling configuration
        this.padding = { top: 28, right: 28, bottom: 28, left: 28 };
        this.handleRadius = 7.5;
        this.hitRadius = 18;

        this._initCanvas();
        this._bindEvents();
        this._startAnimationLoop();
        this.updateViewportTargets();
    }

    CurveBox.prototype._initCanvas = function () {
        this.canvas = document.createElement('canvas');
        this.canvas.className = 'haym-curve-canvas';
        this.ctx = this.canvas.getContext('2d');
        this.container.appendChild(this.canvas);
        this.resize();
    };

    CurveBox.prototype.resize = function () {
        var rect = this.container.getBoundingClientRect();
        this.width = rect.width || 300;
        this.height = rect.height || 260;
        this.dpr = window.devicePixelRatio || 1;

        this.canvas.width = Math.round(this.width * this.dpr);
        this.canvas.height = Math.round(this.height * this.dpr);
        this.canvas.style.width = this.width + 'px';
        this.canvas.style.height = this.height + 'px';

        this.ctx.scale(this.dpr, this.dpr);
        this.render();
    };

    /**
     * Converts normalized [x, y] to canvas pixel coordinates [px, py].
     */
    CurveBox.prototype.toPixels = function (x, y) {
        var plotW = this.width - this.padding.left - this.padding.right;
        var plotH = this.height - this.padding.top - this.padding.bottom;

        var px = this.padding.left + (x * plotW);

        // Invert Y: 0 is at bottom (or baseline), 1 is at top of unit box
        var ySpan = this.viewport.currentMaxY - this.viewport.currentMinY;
        if (Math.abs(ySpan) < 0.001) ySpan = 0.001;
        var normYRatio = (y - this.viewport.currentMinY) / ySpan;
        var py = this.padding.top + ((1.0 - normYRatio) * plotH);

        return { px: px, py: py };
    };

    /**
     * Converts canvas pixel coordinates [px, py] to normalized [x, y].
     */
    CurveBox.prototype.toNormalized = function (px, py) {
        var plotW = this.width - this.padding.left - this.padding.right;
        var plotH = this.height - this.padding.top - this.padding.bottom;

        var normX = (px - this.padding.left) / plotW;

        var normYRatio = 1.0 - ((py - this.padding.top) / plotH);
        var ySpan = this.viewport.currentMaxY - this.viewport.currentMinY;
        var normY = this.viewport.currentMinY + (normYRatio * ySpan);

        return {
            x: HaymMath.clamp(normX, 0.0, 1.0),
            y: normY
        };
    };

    /**
     * Calculates extrema and updates target viewport zoom bounds.
     */
    CurveBox.prototype.updateViewportTargets = function () {
        var extrema = HaymMath.computeCurveExtrema(this.curve);

        // Include handle Y values as well so handles are never off-screen
        var rawMin = Math.min(0.0, extrema.minY, this.curve.y1, this.curve.y2);
        var rawMax = Math.max(1.0, extrema.maxY, this.curve.y1, this.curve.y2);

        var span = rawMax - rawMin;
        var pad = Math.max(0.15, span * 0.15);

        this.viewport.targetMinY = rawMin - pad;
        this.viewport.targetMaxY = rawMax + pad;
    };

    /**
     * Animation loop for smooth zooming and dynamic rendering.
     */
    CurveBox.prototype._startAnimationLoop = function () {
        var self = this;
        function loop() {
            var v = self.viewport;
            var lerpSpeed = 0.14;

            var dMin = v.targetMinY - v.currentMinY;
            var dMax = v.targetMaxY - v.currentMaxY;

            if (Math.abs(dMin) > 0.001 || Math.abs(dMax) > 0.001) {
                v.currentMinY += dMin * lerpSpeed;
                v.currentMaxY += dMax * lerpSpeed;
                self.render();
            }

            requestAnimationFrame(loop);
        }
        requestAnimationFrame(loop);
    };

    /**
     * Render the entire viewport, grid, bezier curve, and handles.
     */
    CurveBox.prototype.render = function () {
        var ctx = this.ctx;
        var w = this.width;
        var h = this.height;

        ctx.clearRect(0, 0, w, h);

        var plotW = w - this.padding.left - this.padding.right;
        var plotH = h - this.padding.top - this.padding.bottom;

        // 1. Box background & unit bounds
        var p00 = this.toPixels(0, 0);
        var p11 = this.toPixels(1, 1);
        var unitTop = p11.py;
        var unitBottom = p00.py;
        var unitLeft = p00.px;
        var unitRight = p11.px;

        // Subtle unit square fill
        ctx.fillStyle = "rgba(255, 255, 255, 0.02)";
        ctx.fillRect(unitLeft, unitTop, unitRight - unitLeft, unitBottom - unitTop);

        // 2. Grid lines
        this._renderGrid(ctx, unitLeft, unitRight, unitTop, unitBottom);

        // 3. Diagonal 45° reference line (subtle dotted)
        ctx.save();
        ctx.strokeStyle = "rgba(255, 255, 255, 0.07)";
        ctx.setLineDash([3, 4]);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(unitLeft, unitBottom);
        ctx.lineTo(unitRight, unitTop);
        ctx.stroke();
        ctx.restore();

        // 4. Unit square border
        ctx.save();
        ctx.strokeStyle = "rgba(255, 255, 255, 0.14)";
        ctx.lineWidth = 1.2;
        ctx.strokeRect(unitLeft, unitTop, unitRight - unitLeft, unitBottom - unitTop);
        ctx.restore();

        // 5. Handle lines
        var p1 = this.toPixels(this.curve.x1, this.curve.y1);
        var p2 = this.toPixels(this.curve.x2, this.curve.y2);

        // Handle 1 line (Start -> P1)
        ctx.save();
        ctx.strokeStyle = "rgba(255, 255, 255, 0.4)";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(unitLeft, unitBottom);
        ctx.lineTo(p1.px, p1.py);
        ctx.stroke();
        ctx.restore();

        // Handle 2 line (End -> P2)
        ctx.save();
        ctx.strokeStyle = "rgba(255, 255, 255, 0.4)";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(unitRight, unitTop);
        ctx.lineTo(p2.px, p2.py);
        ctx.stroke();
        ctx.restore();

        // 6. Cubic Bezier Curve (Sleek Monochrome)
        ctx.save();
        var grad = ctx.createLinearGradient(unitLeft, unitBottom, unitRight, unitTop);
        grad.addColorStop(0, "#ffffff");
        grad.addColorStop(1, "#d4d4d8");

        // Subtle glow under curve
        ctx.shadowColor = "rgba(255, 255, 255, 0.25)";
        ctx.shadowBlur = 10;
        ctx.strokeStyle = grad;
        ctx.lineWidth = 2.8;
        ctx.lineCap = "round";

        ctx.beginPath();
        ctx.moveTo(unitLeft, unitBottom);
        ctx.bezierCurveTo(p1.px, p1.py, p2.px, p2.py, unitRight, unitTop);
        ctx.stroke();
        ctx.restore();

        // 7. Endpoints: (0, 0) and (1, 1) key nodes
        this._renderKeyNode(ctx, unitLeft, unitBottom, "#ffffff");
        this._renderKeyNode(ctx, unitRight, unitTop, "#ffffff");

        // 8. Draggable Handles (P1 and P2) - Monochrome
        this._renderHandle(ctx, 1, p1.px, p1.py, "#ffffff", this.activeHandle === 1, this.hoveredHandle === 1);
        this._renderHandle(ctx, 2, p2.px, p2.py, "#e4e4e7", this.activeHandle === 2, this.hoveredHandle === 2);

        // 9. Snapping indicator visual
        if (this.currentSnapInfo && this.currentSnapInfo.snapType) {
            this._renderSnapFeedback(ctx, this.currentSnapInfo);
        }
    };

    CurveBox.prototype._renderGrid = function (ctx, left, right, top, bottom) {
        ctx.save();
        ctx.lineWidth = 1;

        // Horizontal baseline and 100% lines
        ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
        var gridYValues = [-0.5, -0.25, 0.25, 0.5, 0.75, 1.25, 1.5];
        for (var i = 0; i < gridYValues.length; i++) {
            var gy = gridYValues[i];
            if (gy >= this.viewport.currentMinY && gy <= this.viewport.currentMaxY) {
                var pY = this.toPixels(0, gy).py;
                ctx.beginPath();
                ctx.moveTo(left, pY);
                ctx.lineTo(right, pY);
                ctx.stroke();
            }
        }

        // Vertical grid lines (0.25, 0.5, 0.75)
        var gridXValues = [0.25, 0.5, 0.75];
        for (var j = 0; j < gridXValues.length; j++) {
            var gx = gridXValues[j];
            var pX = this.toPixels(gx, 0).px;
            ctx.beginPath();
            ctx.moveTo(pX, top);
            ctx.lineTo(pX, bottom);
            ctx.stroke();
        }

        ctx.restore();
    };

    CurveBox.prototype._renderKeyNode = function (ctx, x, y, color) {
        ctx.save();
        ctx.fillStyle = "#16171d";
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, 4.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
    };

    CurveBox.prototype._renderHandle = function (ctx, index, x, y, color, isActive, isHovered) {
        var radius = this.handleRadius + (isActive ? 2 : (isHovered ? 1 : 0));

        ctx.save();
        if (isActive) {
            ctx.shadowColor = color;
            ctx.shadowBlur = 14;
        }

        // Outer ring
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();

        // Inner core
        ctx.fillStyle = "#0e0f12";
        ctx.beginPath();
        ctx.arc(x, y, radius * 0.45, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();
    };

    CurveBox.prototype._renderSnapFeedback = function (ctx, snapInfo) {
        ctx.save();
        ctx.strokeStyle = "rgba(255, 255, 255, 0.5)";
        ctx.setLineDash([2, 2]);
        ctx.lineWidth = 1;

        var p = this.toPixels(snapInfo.x, snapInfo.y);
        ctx.beginPath();
        ctx.arc(p.px, p.py, 14, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
    };

    /**
     * Hit tests for handles. Returns 1, 2, or null.
     */
    CurveBox.prototype.hitTest = function (px, py) {
        var p1 = this.toPixels(this.curve.x1, this.curve.y1);
        var d1 = Math.sqrt(Math.pow(px - p1.px, 2) + Math.pow(py - p1.py, 2));
        if (d1 <= this.hitRadius) return 1;

        var p2 = this.toPixels(this.curve.x2, this.curve.y2);
        var d2 = Math.sqrt(Math.pow(px - p2.px, 2) + Math.pow(py - p2.py, 2));
        if (d2 <= this.hitRadius) return 2;

        return null;
    };

    /**
     * Event binding for mouse/pointer interactions.
     */
    CurveBox.prototype._bindEvents = function () {
        var self = this;
        var canvas = this.canvas;

        function getCanvasPoint(e) {
            var rect = canvas.getBoundingClientRect();
            return {
                px: e.clientX - rect.left,
                py: e.clientY - rect.top
            };
        }

        canvas.addEventListener('pointerdown', function (e) {
            var pt = getCanvasPoint(e);
            var hit = self.hitTest(pt.px, pt.py);

            var now = Date.now();
            if (hit && self.lastClickHandle === hit && (now - self.lastClickTime < 320)) {
                // Double-click flatten: zero the handle's speed
                self.flattenHandle(hit);
                self.lastClickTime = 0;
                self.lastClickHandle = null;
                return;
            }

            self.lastClickTime = now;
            self.lastClickHandle = hit;

            if (hit) {
                self.activeHandle = hit;
                self.isDragging = true;
                canvas.setPointerCapture(e.pointerId);
                self.render();
            }
        });

        canvas.addEventListener('pointermove', function (e) {
            var pt = getCanvasPoint(e);

            if (!self.isDragging) {
                var hoverHit = self.hitTest(pt.px, pt.py);
                if (hoverHit !== self.hoveredHandle) {
                    self.hoveredHandle = hoverHit;
                    canvas.style.cursor = hoverHit ? 'pointer' : 'default';
                    self.render();
                }
                return;
            }

            // Dragging handle
            var norm = self.toNormalized(pt.px, pt.py);
            var handleIdx = self.activeHandle;

            // Apply magnetic snapping (Shift bypasses)
            var snapResult = HaymMath.snapHandle(handleIdx, norm.x, norm.y, {
                bypassShift: e.shiftKey,
                thresholdX: 0.025,
                thresholdY: 0.035
            });

            self.currentSnapInfo = snapResult.snappedX || snapResult.snappedY ? snapResult : null;

            var newX = snapResult.x;
            var newY = snapResult.y;

            if (handleIdx === 1) {
                self.curve.x1 = Math.round(newX * 1000) / 1000;
                self.curve.y1 = Math.round(newY * 1000) / 1000;

                // Alt-mirror: reflect opposite handle through center (0.5, 0.5)
                if (e.altKey) {
                    var m2 = HaymMath.mirrorHandle(1, self.curve.x1, self.curve.y1);
                    self.curve.x2 = m2.x;
                    self.curve.y2 = m2.y;
                } else if (e.ctrlKey || e.metaKey) {
                    // Ctrl-mirror: reflect across diagonal (y = x)
                    var c2 = HaymMath.mirrorDiagonalHandle(1, self.curve.x1, self.curve.y1);
                    self.curve.x2 = c2.x;
                    self.curve.y2 = c2.y;
                }
            } else if (handleIdx === 2) {
                self.curve.x2 = Math.round(newX * 1000) / 1000;
                self.curve.y2 = Math.round(newY * 1000) / 1000;

                // Alt-mirror: reflect opposite handle through center (0.5, 0.5)
                if (e.altKey) {
                    var m1 = HaymMath.mirrorHandle(2, self.curve.x2, self.curve.y2);
                    self.curve.x1 = m1.x;
                    self.curve.y1 = m1.y;
                } else if (e.ctrlKey || e.metaKey) {
                    // Ctrl-mirror: reflect across diagonal (y = x)
                    var c1 = HaymMath.mirrorDiagonalHandle(2, self.curve.x2, self.curve.y2);
                    self.curve.x1 = c1.x;
                    self.curve.y1 = c1.y;
                }
            }

            self.updateViewportTargets();
            self.render();
            self._notifyChange(handleIdx);
        });

        function endDrag(e) {
            if (self.isDragging) {
                self.isDragging = false;
                self.activeHandle = null;
                self.currentSnapInfo = null;
                try { canvas.releasePointerCapture(e.pointerId); } catch (err) {}
                self.updateViewportTargets();
                self.render();
            }
        }

        canvas.addEventListener('pointerup', endDrag);
        canvas.addEventListener('pointercancel', endDrag);

        window.addEventListener('resize', function () {
            self.resize();
        });
    };

    /**
     * Flattens a handle: zero speed (P1 -> y=0, P2 -> y=1).
     */
    CurveBox.prototype.flattenHandle = function (handleIndex) {
        if (handleIndex === 1) {
            var f1 = HaymMath.flattenHandle(1, this.curve.x1);
            this.curve.x1 = f1.x;
            this.curve.y1 = f1.y;
        } else if (handleIndex === 2) {
            var f2 = HaymMath.flattenHandle(2, this.curve.x2);
            this.curve.x2 = f2.x;
            this.curve.y2 = f2.y;
        }
        this.updateViewportTargets();
        this.render();
        this._notifyChange(handleIndex);
    };

    /**
     * Sets curve programmatically (e.g. from Analyze, Reverse, or Preset).
     */
    CurveBox.prototype.setCurve = function (newCurve) {
        this.curve = {
            x1: HaymMath.clamp(Number(newCurve.x1), 0.0, 1.0),
            y1: Number(newCurve.y1),
            x2: HaymMath.clamp(Number(newCurve.x2), 0.0, 1.0),
            y2: Number(newCurve.y2)
        };
        this.updateViewportTargets();
        this.render();
        this._notifyChange(null);
    };

    /**
     * Reverses (flips) the curve.
     */
    CurveBox.prototype.reverseCurve = function () {
        var rev = HaymMath.reverseCurve(this.curve);
        this.setCurve(rev);
    };

    CurveBox.prototype._notifyChange = function (handleIndex) {
        var extrema = HaymMath.computeCurveExtrema(this.curve);
        this.onCurveChange(this.curve, extrema, handleIndex);
    };

    return CurveBox;
}));
