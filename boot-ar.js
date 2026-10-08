(function () {
  const startButton = document.getElementById("startAR");
  const fallback = document.getElementById("fallback");
  const status = document.getElementById("status");
  let preparing = false;

  function showFallback(message) {
    if (startButton.dataset.mode === "ar" || startButton.dataset.mode === "fallback") return;
    preparing = false;
    status.textContent = "Use the 3D version";
    fallback.querySelector("p").textContent = message;
    fallback.hidden = false;
    startButton.disabled = false;
    startButton.dataset.mode = "fallback";
    startButton.textContent = "Open interactive 3D";
  }

  function loadScript(source) {
    return new Promise(function (resolve, reject) {
      const script = document.createElement("script");
      script.src = source;
      script.onload = resolve;
      script.onerror = function () { reject(new Error(`Could not load ${source}`)); };
      document.head.appendChild(script);
    });
  }

  function hasWebGL() {
    try {
      const canvas = document.createElement("canvas");
      return Boolean(canvas.getContext("webgl2") || canvas.getContext("webgl"));
    } catch (error) {
      return false;
    }
  }

  startButton.disabled = true;
  startButton.textContent = "Checking this tablet…";
  startButton.dataset.mode = "checking";
  function prepareAR() {
    if (preparing) return;
    preparing = true;
    status.textContent = "Loading AR";
    startButton.disabled = true;
    startButton.dataset.mode = "loading";
    startButton.textContent = "Preparing camera…";

    window.setTimeout(function () {
      if (startButton.dataset.mode === "loading" || startButton.dataset.mode === "checking") {
        showFallback("AR took too long to prepare. Open the interactive 3D version instead.");
      }
    }, 15000);

    loadScript("vendor/aframe-1.6.0.min.js")
      .then(function () { return loadScript("desk.js?v=3"); })
      .then(function () { return loadScript("game.js?v=3"); })
      .then(function () {
        window.__deferMarkerlessInit = true;
        return loadScript("markerless.js?v=3");
      })
      .then(function () {
        const template = document.getElementById("sceneTemplate");
        document.body.appendChild(template.content.cloneNode(true));
        window.startMarkerlessUI();
      })
      .catch(function () {
        showFallback("AR could not finish loading. Open the interactive 3D version instead.");
      });
  }

  startButton.addEventListener("click", function () {
    if (startButton.dataset.mode === "fallback") {
      window.location.href = "preview.html";
    } else if (startButton.dataset.mode === "prepare") {
      prepareAR();
    }
  });

  if (!window.isSecureContext) {
    showFallback("Camera AR needs a secure connection. Open the interactive 3D version instead.");
    return;
  }

  if (!hasWebGL()) {
    showFallback("This browser cannot open the 3D camera view. Try Chrome or Safari, or open the interactive 3D version.");
    return;
  }

  if (!navigator.xr || typeof navigator.xr.isSessionSupported !== "function") {
    showFallback("Markerless AR is not available in this browser. Open the interactive 3D version, or try Chrome on a compatible Android tablet.");
    return;
  }

  navigator.xr.isSessionSupported("immersive-ar").then(function (supported) {
    if (!supported) {
      showFallback("This tablet cannot start markerless AR. Open the interactive 3D version, which has the same missions and badges.");
      return;
    }

    status.textContent = "Ready to start";
    startButton.disabled = false;
    startButton.dataset.mode = "prepare";
    startButton.textContent = "Start markerless AR";
  }).catch(function () {
    showFallback("The AR check could not finish in this browser. Open the interactive 3D version instead.");
  });

  window.setTimeout(function () {
    if (startButton.dataset.mode === "checking") {
      showFallback("The AR check took too long. Open the interactive 3D version instead.");
    }
  }, 12000);
})();
