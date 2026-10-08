(function () {
  const X = window.__fakeXR;
  const L = (m) => X.log.push(m);
  window.addEventListener("error", (e) => L("ERROR " + e.message + " @" + (e.filename || "").split("/").pop() + ":" + e.lineno));
  window.addEventListener("unhandledrejection", (e) => L("REJECTION " + (e.reason && (e.reason.message || e.reason))));
  const $ = (id) => document.getElementById(id);
  const ui = (name) => document.querySelector('[data-ui="' + name + '"]');
  const rawWait = (ms) => new Promise((r) => setTimeout(r, ms));
  // Every 50 ms of page time, render 3 XR frames.
  async function wait(ms) { for (let i = 0; i < Math.max(1, Math.round(ms / 50)); i += 1) { X.pump(3); await rawWait(50); } }
  async function until(fn, label, timeout) {
    const t0 = performance.now();
    while (!fn()) { if (performance.now() - t0 > (timeout || 8000)) { L("TIMEOUT waiting: " + label); return false; } await wait(50); }
    return true;
  }
  const mid = (r) => [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)];
  function worldOf(el) { const v = new THREE.Vector3(); el.object3D.getWorldPosition(v); return v; }
  function finish() {
    const pre = document.createElement("pre"); pre.id = "testlog"; pre.textContent = X.log.join("\n"); document.body.appendChild(pre); document.title = "TESTDONE";
  }
  function fail(why) { L("RESULT: FAIL - " + why); finish(); }
  const cardOpen = () => !ui("card").hidden;
  const cardTitle = () => ui("cardTitle").textContent;

  let cx, cy;
  // An AR tap on empty screen, aimed at one item of the desk.
  async function tapItem(id) {
    const target = document.querySelector('.desk-target[data-item="' + id + '"]');
    X.tap(cx, cy, worldOf(target));
    await wait(450);
  }
  // A tap on a DOM element of the overlay (it must not reach the desk).
  async function tapElement(el, label) {
    const [x, y] = mid(el.getBoundingClientRect());
    const reached = X.tap(x, y);
    if (reached) L("  LEAK: tap on " + label + " also reached the desk");
    await wait(450);
    return !reached;
  }
  async function tapCardButton(text) {
    const button = Array.from(ui("cardButtons").querySelectorAll("button")).find((b) => b.textContent === text);
    if (!button) { L("  no card button '" + text + "'"); return false; }
    return tapElement(button, "button " + text);
  }

  async function run() {
    const start = $("startAR");
    await until(() => ["prepare", "fallback"].includes(start.dataset.mode), "prepare");
    L("start: mode=" + start.dataset.mode + ' "' + start.textContent + '"');
    start.click();
    await until(() => ["ar", "fallback"].includes(start.dataset.mode), "scene ready", 15000);
    L("loaded: mode=" + start.dataset.mode + ' "' + start.textContent + '" status="' + $("status").textContent + '"');
    start.click();
    const scene = document.querySelector("a-scene");
    if (!await until(() => scene.is("ar-mode"), "ar-mode")) return finish();
    L("in AR: startCard hidden=" + $("startCard").hidden + " gameUI hidden=" + $("gameUI").hidden + " frames=" + X.frames);
    const placement = $("placement").components["surface-placement"];
    await until(() => placement.hitTestSource, "hit test source");
    await wait(300);
    L('scanning: status="' + $("status").textContent + '" hint="' + $("placementHint").textContent + '"');
    X.hitVisible = true;
    await until(() => placement.surfaceVisible, "surface visible", 20000);
    await wait(100);
    cx = Math.round(innerWidth / 2); cy = Math.round(innerHeight / 3);
    L("tap point is " + X.describe(document.elementFromPoint(cx, cy)));
    X.tap(cx, cy);
    await wait(200);
    L("placed=" + placement.placed + " deskVisible=" + $("model").object3D.visible + " gameUI hidden=" + $("gameUI").hidden + ' controls="' + $("controls").className + '" bottom=' + $("controls").style.bottom);
    if (!placement.placed) return fail("could not place the desk");
    let lastHit = null;
    document.addEventListener("desk-item-select", (e) => { lastHit = e.detail; L("  tap hit " + e.detail.id); });

    // Asleep: the programs are still inside the monitor, so a tap aimed at one
    // lands on the monitor, and a part opens the question.
    await tapItem("draw");
    L("asleep, aimed at a program: hit=" + (lastHit && lastHit.id) + " awake=" + TechDesk.isAwake());
    if (!lastHit || lastHit.kind !== "hardware") return fail("a sleeping program answered a tap");
    L('asleep, tapped a part: card=' + cardOpen() + ' "' + cardTitle() + '"');
    if (!cardOpen()) return fail("no question after tapping a part");
    // Tapping the question text must not answer it.
    await tapElement(ui("cardMessage"), "question text");
    if (!cardOpen() || !/not working/.test(cardTitle())) return fail("question closed by tapping its text");
    await tapCardButton("No");
    L('answered No: "' + cardTitle() + '"');
    await tapElement(ui("cardMessage"), "card text");
    await wait(2200);
    L("woke up: awake=" + TechDesk.isAwake() + " card=" + cardOpen() + ' panel="' + ui("label").textContent + " | " + ui("text").textContent + '"');
    if (!TechDesk.isAwake() || cardOpen()) return fail("desk did not wake up");

    // A wrong tap must not fill a slot.
    await tapItem("keyboard");
    L('wrong tap: hardware slot="' + ui("hardware").textContent.trim() + '" toast="' + ui("toast").textContent + '"');
    if (ui("hardware").classList.contains("filled")) return fail("wrong hardware accepted");

    for (const mission of DeskGame.missions) {
      for (const id of [mission.hardware, mission.software]) {
        const slot = ui(TechDesk.items[id].kind);
        for (let attempt = 1; attempt <= 6 && !slot.classList.contains("filled"); attempt += 1) await tapItem(id);
        if (!slot.classList.contains("filled")) {
          const target = document.querySelector('.desk-target[data-item="' + id + '"]');
          const q = X.poseFor(worldOf(target)).transform.orientation;
          const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(new THREE.Quaternion(q.x, q.y, q.z, q.w));
          const rc = new THREE.Raycaster(new THREE.Vector3(X.camera.x, X.camera.y, X.camera.z), dir);
          const hits = rc.intersectObjects(placement.targetObjects(), true).map((h) => TechDesk.targetFromObject(h.object).dataset.item + "@" + h.distance.toFixed(2));
          L("  miss " + id + ": hits=" + hits.join(" ") + ' toast="' + ui("toast").textContent + '"');
          return fail("mission " + mission.id + " could not find " + id);
        }
      }
      const desk = $("model").components["tech-desk"];
      const proof = { draw: () => desk.monitor.mode === "draw", write: () => desk.monitor.mode === "write", watch: () => desk.monitor.mode === "video", listen: () => desk.now - desk.music.start < 6, photo: () => desk.tablet.mode === "photo", robot: () => desk.rover.mode === "drive" }[mission.id]();
      if (!proof) return fail("the " + mission.id + " pair did not start working");
      await until(cardOpen, "card for " + mission.id, 6000);
      L("mission " + mission.id + ': card="' + cardTitle() + '" ' + ui("cardBadge").textContent + " | " + ui("count").textContent);
      if (!cardOpen()) return fail("no card for mission " + mission.id);
      await tapElement(ui("cardMessage"), "card text");
      if (mission.id !== "robot" && cardOpen()) return fail("card stuck after mission " + mission.id);
    }

    // The condition from last session.
    L('condition question: card=' + cardOpen() + ' "' + cardTitle() + '"');
    await tapCardButton("Stop");
    L('answered Stop: "' + cardTitle() + '" | ' + ui("cardMessage").textContent);
    await tapElement(ui("cardMessage"), "card text");
    const rover = $("model").components["tech-desk"].rover;
    L("test started: wall button hidden=" + ui("wall").hidden + " rover mode=" + rover.mode + " seeing=" + rover.seeing + ' panel="' + ui("text").textContent + '"');
    if (rover.seeing) return fail("the rover sees something before the test");
    const x0 = rover.x;
    await wait(1000);
    L("rover moved " + Math.abs(rover.x - x0).toFixed(2) + " in one second");
    await tapElement(ui("wall"), "wall button");
    L('wall: on=' + rover.wall + " at x=" + rover.wallX + ' button="' + ui("wall").textContent + '"');
    if (!await until(() => rover.seeing, "rover sees the wall", 30000)) return fail("the rover did not stop at the wall");
    const stopX = rover.x;
    await until(cardOpen, "condition card", 6000);
    L("stopped at x=" + stopX.toFixed(2) + ' card="' + cardTitle() + '" ' + ui("cardBadge").textContent);
    if (Math.abs(rover.x - stopX) > .001) return fail("the rover kept moving at the wall");
    await tapElement(ui("cardMessage"), "card text");
    L('trophy: "' + cardTitle() + '" ' + ui("cardBadge").textContent);
    await tapElement(ui("cardMessage"), "card text");
    L("finished: card=" + cardOpen() + ' panel="' + ui("label").textContent + '" ' + ui("count").textContent + " badges=" + Object.keys($("model").components["tech-desk"].badges).join(","));
    if (cardOpen() || ui("count").textContent !== "7 / 7 badges") return fail("did not finish with 7 badges");

    // Take the wall away, then "walk up" to the rover: its sensor should see the tablet.
    await tapElement(ui("wall"), "wall button");
    await until(() => !rover.seeing, "rover drives again", 4000);
    L("wall away: seeing=" + rover.seeing);
    const home = Object.assign({}, X.camera);
    const near = new THREE.Vector3();
    document.querySelector('.desk-target[data-item="robot"]').object3D.getWorldPosition(near);
    Object.assign(X.camera, { x: near.x, y: near.y + .15, z: near.z + .25 });
    const sawYou = await until(() => rover.seeing, "rover sees the tablet", 4000);
    L("walked up to the rover: seeing=" + rover.seeing);
    Object.assign(X.camera, home);
    await until(() => !rover.seeing, "rover drives after stepping back", 4000);
    L("stepped back: seeing=" + rover.seeing);
    if (!sawYou || rover.seeing) return fail("walking up to the rover");

    // Simulate a dead XR render loop: ticks stop, so the watchdog should end the
    // session and the page should offer to restart the camera.
    // (The harness runs with a huge stall limit because the software renderer is slow,
    // so fake a frame timestamp far in the past to trigger the watchdog.)
    scene.renderer.xr.setAnimationLoop(null);
    placement.lastFrameTime = -1e12;
    await wait(2500);
    L("watchdog: still in AR=" + scene.is("ar-mode") + " startCard hidden=" + $("startCard").hidden + ' button="' + start.textContent + '" status="' + $("status").textContent + '"');
    if (scene.is("ar-mode") || $("startCard").hidden) return fail("watchdog");
    L("RESULT: PASS");
    finish();
  }
  window.addEventListener("load", () => run().catch((e) => { L("DRIVER ERROR " + (e && e.stack || e)); finish(); }));
})();
