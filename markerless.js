(function () {
  if (!window.AFRAME) return;

  AFRAME.registerComponent("surface-placement", {
    init: function () {
      this.model = document.getElementById("model");
      this.reticle = document.getElementById("reticle");
      this.placed = false;
      this.surfaceVisible = false;
      this.hitTestSource = null;
      this.referenceSpace = null;
      this.raycaster = new THREE.Raycaster();
      this.onSelect = this.onSelect.bind(this);

      this.el.sceneEl.addEventListener("enter-vr", async () => {
        const scene = this.el.sceneEl;
        if (!scene.is("ar-mode")) return;
        // The stall watchdog only arms once this session has rendered its first frame.
        this.lastFrameTime = 0;
        const session = scene.renderer.xr.getSession();
        if (!session) return;
        try {
          const viewerSpace = await session.requestReferenceSpace("viewer");
          this.referenceSpace = scene.renderer.xr.getReferenceSpace();
          this.hitTestSource = await session.requestHitTestSource({ space: viewerSpace });
          session.addEventListener("select", this.onSelect);
          if (window.arUI) window.arUI.scanning();
        } catch (error) {
          if (window.arUI) window.arUI.error("Surface scanning is unavailable on this tablet.");
        }
      });

      // The session can end on its own (back button, notification shade, app switch,
      // screen lock). The old placement belongs to a dead reference space, so start over.
      this.el.sceneEl.addEventListener("exit-vr", () => {
        this.hitTestSource = null;
        this.placed = false;
        this.surfaceVisible = false;
        this.reticle.object3D.visible = false;
        this.model.object3D.visible = false;
      });
    },

    tick: function () {
      this.lastFrameTime = performance.now();
      if (this.placed || !this.hitTestSource) return;
      // An error thrown here would stop the whole render loop and freeze the camera
      // view, so scanning errors are caught and, if they persist, reported instead.
      try {
        this.updateReticle();
      } catch (error) {
        this.tickErrors = (this.tickErrors || 0) + 1;
        if (this.tickErrors > 30) {
          this.hitTestSource = null;
          if (window.arUI) window.arUI.error(`Surface scanning stopped: ${error.message}`);
        }
      }
    },

    updateReticle: function () {
      const frame = this.el.sceneEl.frame;
      if (!frame) return;
      const referenceSpace = this.el.sceneEl.renderer.xr.getReferenceSpace();
      const hits = frame.getHitTestResults(this.hitTestSource);
      const pose = hits.length ? hits[0].getPose(referenceSpace) : null;
      if (pose) {
        const p = pose.transform.position;
        this.reticle.object3D.position.set(p.x, p.y, p.z);
        this.lastHitTime = performance.now();
        this.setSurfaceVisible(true);
      } else if (performance.now() - (this.lastHitTime || 0) > 400) {
        // Hit tests drop out for a frame or two all the time; without this grace
        // period the hint text flips back and forth and the overlay redraws constantly.
        this.setSurfaceVisible(false);
      }
    },

    // Only touch the DOM when the state changes. Updating the DOM overlay on every
    // XR frame forces the browser to redraw it 60 times a second and can freeze taps.
    setSurfaceVisible: function (visible) {
      if (this.surfaceVisible === visible) return;
      this.surfaceVisible = visible;
      this.reticle.object3D.visible = visible;
      if (window.arUI) {
        if (visible) window.arUI.surfaceFound();
        else window.arUI.scanning();
      }
    },

    targetObjects: function () {
      if (!this.targets) {
        this.targets = Array.from(this.model.querySelectorAll(".desk-target")).map((el) => el.object3D);
      }
      return this.targets;
    },

    onSelect: function (event) {
      if (!this.placed) {
        if (!this.surfaceVisible) return;
        this.model.object3D.position.copy(this.reticle.object3D.position);
        this.model.object3D.visible = true;
        this.reticle.object3D.visible = false;
        this.placed = true;
        if (window.arUI) window.arUI.placed();
        return;
      }

      const frame = event.frame;
      const input = event.inputSource;
      const referenceSpace = this.el.sceneEl.renderer.xr.getReferenceSpace();
      if (!frame || !input || !input.targetRaySpace || !referenceSpace) return;
      const pose = frame.getPose(input.targetRaySpace, referenceSpace);
      if (!pose) return;

      const origin = pose.transform.position;
      const orientation = pose.transform.orientation;
      const direction = new THREE.Vector3(0, 0, -1).applyQuaternion(
        new THREE.Quaternion(orientation.x, orientation.y, orientation.z, orientation.w)
      );
      this.raycaster.set(new THREE.Vector3(origin.x, origin.y, origin.z), direction);
      // Make sure the hit boxes are where the desk is now, even if no frame has
      // rendered since it was placed, moved or resized.
      this.model.object3D.updateMatrixWorld(true);
      const intersections = this.raycaster.intersectObjects(this.targetObjects(), true);
      for (const hit of intersections) {
        // selectTarget says no for the sleeping programs; the tap then goes to
        // whatever is behind them.
        const target = window.TechDesk.targetFromObject(hit.object);
        if (target && window.TechDesk.selectTarget(target)) break;
      }
    },

    resetPlacement: function () {
      this.placed = false;
      this.surfaceVisible = false;
      this.model.object3D.visible = false;
      this.reticle.object3D.visible = false;
      if (window.arUI) window.arUI.scanning();
    }
  });

  function initialize() {
    const scene = document.querySelector("a-scene");
    const model = document.getElementById("model");
    const startCard = document.getElementById("startCard");
    const startButton = document.getElementById("startAR");
    const fallback = document.getElementById("fallback");
    const status = document.getElementById("status");
    const placementHint = document.getElementById("placementHint");
    const controls = document.getElementById("controls");
    const overlay = document.getElementById("overlay");
    let modelScale = .2;
    let launchingAR = false;
    let launchTimer = null;
    let inAR = false;

    // The missions and cards live in game.js; this file only places the desk.
    window.DeskGame.start({
      root: document.getElementById("gameUI"),
      mode: "ar",
      onLayout: function (missionHeight) { controls.style.bottom = `${missionHeight + 24}px`; }
    });
    window.DeskGame.show(false);

    function showFallback(message) {
      status.textContent = "Use the 3D version";
      fallback.querySelector("p").textContent = message || "Markerless AR is unavailable on this tablet. The interactive 3D version has the same desk and missions.";
      fallback.hidden = false;
      startCard.hidden = false;
      startButton.disabled = false;
      startButton.dataset.mode = "fallback";
      startButton.textContent = "Open interactive 3D";
    }

    function waitForScene() {
      if (scene.hasLoaded && typeof scene.enterAR === "function") return Promise.resolve();
      return new Promise(function (resolve, reject) {
        const timer = window.setTimeout(function () {
          reject(new Error("The 3D scene took too long to load."));
        }, 10000);
        scene.addEventListener("loaded", function () {
          window.clearTimeout(timer);
          if (typeof scene.enterAR === "function") resolve();
          else reject(new Error("The AR launcher did not load."));
        }, { once: true });
      });
    }

    window.arUI = {
      scanning: function () {
        status.textContent = "Looking for a surface";
        placementHint.textContent = "Move the tablet slowly over a desk or the floor.";
        placementHint.classList.remove("hidden");
        controls.classList.remove("show");
        window.DeskGame.show(false);
      },
      surfaceFound: function () {
        status.textContent = "Surface found";
        placementHint.textContent = "Tap the glowing circle to place the desk.";
      },
      placed: function () {
        status.textContent = "Desk placed";
        placementHint.classList.add("hidden");
        controls.classList.add("show");
        window.DeskGame.show(true);
      },
      error: function (message) {
        status.textContent = "AR unavailable";
        if (scene.is("ar-mode")) scene.exitVR();
        showFallback(message);
      }
    };

    if (!window.isSecureContext) {
      showFallback("Camera AR needs a secure connection. Open the interactive 3D version on this tablet.");
    } else if (!navigator.xr || !navigator.xr.isSessionSupported) {
      showFallback("This browser does not provide markerless WebXR. Use the interactive 3D version, or try Chrome on a compatible Android tablet.");
    } else {
      Promise.all([
        waitForScene(),
        navigator.xr.isSessionSupported("immersive-ar")
      ]).then(function (results) {
        const supported = results[1];
        if (supported) {
          status.textContent = "Camera ready";
          startButton.disabled = false;
          startButton.dataset.mode = "ar";
          startButton.textContent = "Open camera AR";
        } else {
          showFallback("This tablet cannot start markerless AR. Open the interactive 3D version, which has the same missions and badges.");
        }
      }).catch(function (error) {
        showFallback(error && error.message ? error.message : "The markerless AR check failed on this browser.");
      });
    }

    function launchAR(event) {
      if (event && event.cancelable) event.preventDefault();
      if (startButton.dataset.mode === "fallback") {
        window.location.href = "preview.html";
        return;
      }
      if (startButton.dataset.mode !== "ar" || launchingAR) return;
      launchingAR = true;
      startButton.disabled = true;
      startButton.textContent = "Opening camera…";
      status.textContent = "Tap received · opening camera";
      if (navigator.vibrate) navigator.vibrate(35);
      let launch;
      try {
        launch = scene.enterAR();
      } catch (error) {
        launchingAR = false;
        showFallback("Markerless AR could not start on this browser. Open the interactive 3D version instead.");
        return;
      }
      Promise.resolve(launch).catch(function (error) {
        launchingAR = false;
        const detail = error && error.name === "NotAllowedError"
          ? "Camera or motion permission was blocked. Allow permission and try again, or open interactive 3D."
          : "This tablet rejected the markerless AR session. Open interactive 3D, or try Chrome on a compatible Android tablet.";
        showFallback(detail);
      });

      window.clearTimeout(launchTimer);
      launchTimer = window.setTimeout(function () {
        if (!scene.is("ar-mode")) {
          launchingAR = false;
          showFallback("The camera did not open. Try again in Chrome, or use the interactive 3D version.");
        }
      }, 20000);
    }

    scene.addEventListener("enter-vr", function () {
      if (!scene.is("ar-mode")) return;
      window.clearTimeout(launchTimer);
      inAR = true;
      launchingAR = false;
      startCard.hidden = true;
      status.textContent = "Move slowly";
    });

    // Without this, a session that ended on its own left the page on a dark screen
    // with the start card hidden and nothing to tap to get the camera back.
    scene.addEventListener("exit-vr", function () {
      if (!inAR) return;
      inAR = false;
      launchingAR = false;
      window.DeskGame.show(false);
      controls.classList.remove("show");
      placementHint.classList.add("hidden");
      if (startButton.dataset.mode === "fallback") return;
      document.getElementById("startTitle").textContent = "The camera stopped";
      document.getElementById("startText").textContent = "Tap the button to open the camera again and place the desk. Your badges are saved.";
      startCard.hidden = false;
      startButton.disabled = false;
      startButton.dataset.mode = "ar";
      startButton.textContent = "Restart camera AR";
      status.textContent = "Camera paused";
    });

    // Show script errors in the status pill, so a stuck tablet can at least say why.
    window.addEventListener("error", function (event) {
      status.textContent = `Error: ${event.message || "unknown"}`;
    });
    window.addEventListener("unhandledrejection", function (event) {
      const reason = event.reason;
      status.textContent = `Error: ${reason && reason.message ? reason.message : reason}`;
    });

    // If an error stops the XR render loop, the camera picture freezes while the
    // overlay keeps working. The loop cannot be restarted from outside, so end the
    // session instead: the exit-vr handler then shows the "Restart camera AR" card.
    // ar.html?stall=8000 changes the limit in milliseconds; ar.html?stall=0 disables it.
    const stallParam = new URLSearchParams(window.location.search).get("stall");
    const stallLimit = stallParam === null ? 4000 : Number(stallParam);
    window.setInterval(function () {
      const placement = document.getElementById("placement").components["surface-placement"];
      const xrSession = scene.xrSession;
      if (!(stallLimit > 0) || !inAR || !placement || !placement.lastFrameTime || !xrSession) return;
      if (xrSession.visibilityState !== "visible" || document.visibilityState !== "visible") return;
      if (performance.now() - placement.lastFrameTime > stallLimit) {
        placement.lastFrameTime = 0;
        status.textContent = "Camera view stopped";
        scene.exitVR();
      }
    }, 1000);

    startButton.addEventListener("click", launchAR);
    startButton.addEventListener("touchend", launchAR, { passive: false });

    document.addEventListener("touchend", function (event) {
      if (startCard.hidden || launchingAR) return;
      if (event.target === startButton || (event.target.closest && event.target.closest("#startAR"))) return;
      if (startButton.dataset.mode !== "ar" || !event.changedTouches || !event.changedTouches.length) return;
      const touch = event.changedTouches[0];
      const rect = startButton.getBoundingClientRect();
      if (touch.clientX >= rect.left && touch.clientX <= rect.right && touch.clientY >= rect.top && touch.clientY <= rect.bottom) {
        launchAR(event);
      }
    }, { capture: true, passive: false });

    // Taps on panels and buttons stay in the panels; taps on empty screen (or on the
    // see-through hint, toast and confetti layers) go to the desk. Otherwise a tap on
    // a card would also fire an AR tap on whatever is behind it.
    overlay.addEventListener("beforexrselect", function (event) {
      const target = event.target;
      if (target.closest && target.closest(".start-card, .controls, .mission, .card, .back, button, a")) {
        event.preventDefault();
      }
    });

    function setScale(next) {
      modelScale = Math.max(.12, Math.min(.36, next));
      model.object3D.scale.setScalar(modelScale);
      status.textContent = modelScale > .2 ? "Desk made bigger" : modelScale < .2 ? "Desk made smaller" : "Desk size reset";
    }

    document.getElementById("larger").addEventListener("click", () => setScale(modelScale + .04));
    document.getElementById("smaller").addEventListener("click", () => setScale(modelScale - .04));
    document.getElementById("turnLeft").addEventListener("click", () => { model.object3D.rotation.y += THREE.MathUtils.degToRad(20); });
    document.getElementById("turnRight").addEventListener("click", () => { model.object3D.rotation.y -= THREE.MathUtils.degToRad(20); });
    document.getElementById("replace").addEventListener("click", function () {
      const component = document.getElementById("placement").components["surface-placement"];
      if (component) component.resetPlacement();
    });
  }

  window.startMarkerlessUI = initialize;
  if (window.__deferMarkerlessInit) {
    return;
  }
  if (document.readyState === "loading") {
    window.addEventListener("DOMContentLoaded", initialize, { once: true });
  } else {
    initialize();
  }
})();
