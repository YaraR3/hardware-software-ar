// Fake handheld-AR WebXR device for headless testing of ar.html.
(function () {
  const W = 800, H = 600;
  function compose(px, py, pz, q) {
    const x2 = q.x + q.x, y2 = q.y + q.y, z2 = q.z + q.z;
    const xx = q.x * x2, xy = q.x * y2, xz = q.x * z2, yy = q.y * y2, yz = q.y * z2, zz = q.z * z2, wx = q.w * x2, wy = q.w * y2, wz = q.w * z2;
    return new Float32Array([1 - (yy + zz), xy + wz, xz - wy, 0, xy - wz, 1 - (xx + zz), yz + wx, 0, xz + wy, yz - wx, 1 - (xx + yy), 0, px, py, pz, 1]);
  }
  function perspective(fov, aspect, near, far) {
    const f = 1 / Math.tan(fov * Math.PI / 360);
    return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) / (near - far), -1, 0, 0, 2 * far * near / (near - far), 0]);
  }
  // Quaternion that rotates (0,0,-1) onto the unit direction d.
  function lookDir(dx, dy, dz) {
    const dot = -dz;
    if (dot > .99999) return { x: 0, y: 0, z: 0, w: 1 };
    if (dot < -.99999) return { x: 0, y: 1, z: 0, w: 0 };
    let ax = dy, ay = -dx;
    const len = Math.hypot(ax, ay); ax /= len; ay /= len;
    const angle = Math.acos(dot), s = Math.sin(angle / 2);
    return { x: ax * s, y: ay * s, z: 0, w: Math.cos(angle / 2) };
  }
  const state = window.__fakeXR = { session: null, hitVisible: false, hit: { x: 0, y: 0, z: -1 }, camera: { x: 0, y: 1.4, z: .6 }, aim: null, frames: 0, log: [] };
  function dirQuat(target) {
    const c = state.camera, d = [target.x - c.x, target.y - c.y, target.z - c.z], l = Math.hypot(d[0], d[1], d[2]);
    return lookDir(d[0] / l, d[1] / l, d[2] / l);
  }
  function pose(p, q) { return { transform: { position: { x: p.x, y: p.y, z: p.z }, orientation: q, matrix: compose(p.x, p.y, p.z, q) } }; }

  class FakeFrame {
    constructor(session) { this.session = session; }
    getViewerPose() {
      const view = pose(state.camera, dirQuat(state.hit));
      view.eye = "none"; view.projectionMatrix = perspective(60, W / H, .1, 100); view.recommendedViewportScale = null;
      return { transform: view.transform, views: [view] };
    }
    getHitTestResults() { return state.hitVisible ? [{ getPose: () => pose(state.hit, { x: 0, y: 0, z: 0, w: 1 }) }] : []; }
    getPose() { return pose(state.camera, dirQuat(state.aim || state.hit)); }
    getDepthInformation() { return null; }
  }

  class FakeSession extends EventTarget {
    constructor(mode, init) {
      super();
      this.mode = mode;
      this.renderState = { depthNear: .1, depthFar: 1000, baseLayer: null, layers: undefined };
      this.inputSources = [];
      this.environmentBlendMode = "alpha-blend";
      this.interactionMode = "screen-space";
      this.visibilityState = "visible";
      this.enabledFeatures = ["local", "hit-test", "dom-overlay"];
      this.domOverlayState = init && init.domOverlay ? { type: "screen" } : null;
      this.ended = false;
    }
    updateRenderState(next) { Object.assign(this.renderState, next); }
    async requestReferenceSpace(type) { return { type, getOffsetReferenceSpace() { return this; } }; }
    async requestHitTestSource() { return { cancel() {} }; }
    // Frames are pumped by the test driver (state.pump) instead of the browser's
    // animation clock, which is unreliable in headless mode.
    requestAnimationFrame(callback) { this.pending = callback; return 1; }
    cancelAnimationFrame() { this.pending = null; }
    async end() { if (this.ended) return; this.ended = true; state.session = null; this.dispatchEvent(new Event("end")); }
  }

  window.XRWebGLLayer = class {
    constructor(session, gl, init) { this.framebuffer = null; this.framebufferWidth = W; this.framebufferHeight = H; this.antialias = !!(init && init.antialias); this.ignoreDepthValues = false; }
    getViewport() { return { x: 0, y: 0, width: W, height: H }; }
  };
  [window.WebGLRenderingContext, window.WebGL2RenderingContext].forEach((C) => { if (C) C.prototype.makeXRCompatible = function () { return Promise.resolve(); }; });

  const xr = new EventTarget();
  xr.isSessionSupported = async (mode) => mode === "immersive-ar";
  xr.requestSession = async (mode, init) => {
    state.log.push("requestSession " + mode + " required=" + (init.requiredFeatures || []).join("|") + " optional=" + (init.optionalFeatures || []).join("|") + " overlay=" + !!(init.domOverlay && init.domOverlay.root));
    state.session = new FakeSession(mode, init);
    return state.session;
  };
  Object.defineProperty(navigator, "xr", { value: xr, configurable: true });

  function describe(el) {
    if (!el) return "null";
    const cls = typeof el.className === "string" && el.className.trim() ? "." + el.className.trim().split(/\s+/).join(".") : "";
    return "<" + el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") + cls + ">";
  }
  state.describe = describe;
  state.time = 0;
  state.pump = function (count) {
    for (let i = 0; i < count; i += 1) {
      const session = state.session;
      if (!session || !session.pending || session.ended) return;
      const callback = session.pending;
      session.pending = null;
      state.frames += 1;
      state.time += 16.7;
      callback(state.time, new FakeFrame(session));
    }
  };
  state.poseFor = (aim) => pose(state.camera, dirQuat(aim));

  // A screen tap, as Chrome does it: beforexrselect on the touched overlay element,
  // the normal DOM click, then (unless cancelled) the XR select on the session.
  state.tap = function (x, y, aim) {
    state.aim = aim || null;
    const el = document.elementFromPoint(x, y) || document.body;
    const before = new Event("beforexrselect", { bubbles: true, cancelable: true });
    el.dispatchEvent(before);
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, clientX: x, clientY: y }));
    if (before.defaultPrevented || !state.session) {
      state.log.push("tap(" + x + "," + y + ") on " + describe(el) + " -> XR select blocked");
      return false;
    }
    const frame = new FakeFrame(state.session);
    const inputSource = { targetRayMode: "screen", targetRaySpace: {}, handedness: "none", profiles: [], gamepad: null };
    ["selectstart", "select", "selectend"].forEach((type) => { const ev = new Event(type); ev.frame = frame; ev.inputSource = inputSource; state.session.dispatchEvent(ev); });
    state.log.push("tap(" + x + "," + y + ") on " + describe(el) + " -> XR select");
    return true;
  };
})();
