(function () {
  if (!window.AFRAME) return;
  const THREE = window.THREE;
  const DEG = Math.PI / 180;

  // Colours are taken from the "Hardware Vs Software" and "New Rover" lesson slides.
  const palette = {
    navy: "#003370",
    brand: "#009fd6",
    cyan: "#27b5e8",
    lightBlue: "#8fd8f5",
    white: "#f8fbff",
    desk: "#b4d2e8",
    mat: "#0b3f7d",
    silver: "#d6dde3",
    grey: "#9aa0a6",
    dark: "#2b3138",
    speaker: "#3d6fe0",
    speakerDark: "#1f3f9c",
    lime: "#b6e02b",
    orange: "#f5a623",
    hubWhite: "#f4f6f8",
    motor: "#8e969c",
    tyre: "#16191c",
    red: "#e2412f",
    yellow: "#f4c843",
    green: "#2fae5a"
  };

  // Hardware is built as solid 3D objects. Software is drawn as flat glowing tiles
  // that float above the monitor, so "can I touch it?" is visible in the model.
  const items = {
    mouse: { id: "mouse", kind: "hardware", title: "Mouse", icon: "🖱️" },
    keyboard: { id: "keyboard", kind: "hardware", title: "Keyboard", icon: "⌨️" },
    monitor: { id: "monitor", kind: "hardware", title: "Monitor", icon: "🖥️" },
    speaker: { id: "speaker", kind: "hardware", title: "Speaker", icon: "🔊" },
    tablet: { id: "tablet", kind: "hardware", title: "Tablet", icon: "📱" },
    robot: { id: "robot", kind: "hardware", title: "Robot", icon: "🤖" },
    draw: { id: "draw", kind: "software", title: "Drawing app", icon: "🎨", tile: "#ffe9a8" },
    write: { id: "write", kind: "software", title: "Writing app", icon: "📝", tile: "#cfe0ff" },
    video: { id: "video", kind: "software", title: "Video app", icon: "🎬", tile: "#ffd0d6" },
    music: { id: "music", kind: "software", title: "Music app", icon: "🎵", tile: "#d9ccff" },
    program: { id: "program", kind: "software", title: "WeDo 2.0", proper: true, icon: "🧩", image: "assets/wedo-icon.png", tile: "#bfe6f6" },
    camera: { id: "camera", kind: "software", title: "Camera app", icon: "📷", tile: "#ffd4e6" }
  };

  const desks = [];

  function add(parent, tag, attrs) {
    const node = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([name, value]) => node.setAttribute(name, value));
    parent.appendChild(node);
    return node;
  }

  function isAwake() {
    return desks.some((desk) => desk.awake);
  }

  // Returns false when the tap should fall through to whatever is behind it
  // (the programs cannot be tapped while the desk is asleep).
  function selectTarget(target) {
    if (!target) return false;
    const item = items[target.dataset.item];
    if (!item) return false;
    if (item.kind === "software" && !isAwake()) return false;
    unlockSound();
    document.dispatchEvent(new CustomEvent("desk-item-select", {
      detail: { id: item.id, kind: item.kind, title: item.title, icon: item.icon, element: target }
    }));
    return true;
  }

  // Hit boxes are never drawn (visible: false) but can still be tapped, because
  // THREE.Raycaster ignores material visibility. Drawing them cost a lot of
  // transparent overdraw on tablets.
  const HITBOX_MATERIAL = "color: #45e28b; opacity: 0.33; transparent: true; depthWrite: false; visible: false";

  function targetBox(parent, item, attrs) {
    const hitbox = add(parent, "a-box", Object.assign({
      class: "desk-target",
      material: HITBOX_MATERIAL
    }, attrs));
    hitbox.dataset.item = item.id;
    hitbox.addEventListener("click", function () { selectTarget(hitbox); });
    return hitbox;
  }

  // ---------------------------------------------------------------------------
  // Sounds. Short beeps made with WebAudio, so there are no audio files.
  // ---------------------------------------------------------------------------

  let audio = null;

  function unlockSound() {
    try {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) return;
      audio = audio || new Ctor();
      if (audio.state === "suspended") audio.resume();
    } catch (error) {
      audio = null;
    }
  }

  const TUNES = {
    wake: [[523, 0, .12], [659, .12, .12], [784, .24, .2]],
    right: [[659, 0, .1], [880, .1, .18]],
    beep: [[988, 0, .12], [988, .2, .12]],
    click: [[1400, 0, .04]],
    tune: [[523, 0, .2], [587, .22, .2], [659, .44, .2], [523, .66, .2], [659, .88, .2], [784, 1.1, .4], [659, 1.54, .2], [784, 1.76, .5]]
  };

  function sound(name) {
    const notes = TUNES[name];
    if (!notes || !audio || audio.state !== "running") return;
    try {
      const now = audio.currentTime + .02;
      notes.forEach(([frequency, start, length]) => {
        const osc = audio.createOscillator();
        const gain = audio.createGain();
        osc.type = "triangle";
        osc.frequency.value = frequency;
        gain.gain.setValueAtTime(0, now + start);
        gain.gain.linearRampToValueAtTime(.16, now + start + .015);
        gain.gain.linearRampToValueAtTime(0, now + start + length);
        osc.connect(gain).connect(audio.destination);
        osc.start(now + start);
        osc.stop(now + start + length + .03);
      });
    } catch (error) { /* sound is a bonus; never let it break the activity */ }
  }

  // ---------------------------------------------------------------------------
  // Geometry batching. Scenery is built with plain three.js and merged into one
  // mesh per material, so the whole desk draws in a few dozen calls instead of
  // hundreds of separate A-Frame entities.
  // ---------------------------------------------------------------------------

  const G = {
    box: (w, h, d) => new THREE.BoxGeometry(w, h, d),
    cyl: (top, bottom, h, segments) => new THREE.CylinderGeometry(top, bottom, h, segments || 12),
    sphere: (r, segments) => new THREE.SphereGeometry(r, segments || 12, Math.max(6, Math.round((segments || 12) / 2))),
    ground: (w, d) => new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2)
  };

  function canvasTexture(width, height, draw) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    if (draw) draw(canvas.getContext("2d"), width, height);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    return texture;
  }

  function once(make) {
    let value = null;
    return function () { return value || (value = make()); };
  }

  const FONT = "Montserrat, system-ui, 'Segoe UI', Roboto, 'Noto Sans', Arial, sans-serif";
  const EMOJI = "'Segoe UI Emoji', 'Apple Color Emoji', 'Noto Color Emoji', sans-serif";

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function hexagonPath(ctx, cx, cy, r) {
    ctx.beginPath();
    for (let i = 0; i < 6; i += 1) {
      const angle = (60 * i - 90) * DEG;
      ctx[i ? "lineTo" : "moveTo"](cx + r * Math.cos(angle), cy + r * Math.sin(angle));
    }
    ctx.closePath();
  }

  // The rover program from last session, block for block as on the lesson slide:
  // start, motor power 8, motor this way, wait for the motion sensor, motor off,
  // play sound 1.
  const BLOCKS = [
    { color: "#f2c417", glyph: "start", ink: "#2f9e44" },
    { color: "#2f9e44", glyph: "gauge", ink: "#ffffff", number: "8" },
    { color: "#2f9e44", glyph: "↻", ink: "#ffffff" },
    { color: "#f2c417", glyph: "⏳", ink: "#3a2a00", sensor: true },
    { color: "#2f9e44", glyph: "✖", ink: "#ffffff" },
    { color: "#e03131", glyph: "♪", ink: "#ffffff", number: "1" }
  ];

  function blocksTexture(active) {
    return canvasTexture(768, 176, (ctx) => {
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      BLOCKS.forEach((block, i) => {
        const x = 12 + i * 125;
        const cx = x + 59;
        const lit = active.includes(i);
        ctx.globalAlpha = lit ? 1 : .5;
        ctx.fillStyle = block.color;
        roundRect(ctx, x, 12, 118, 118, 18);
        ctx.fill();
        if (block.number) {
          // The white number box that hangs under a block.
          ctx.fillStyle = "#1c9be6";
          roundRect(ctx, x + 20, 120, 78, 46, 10);
          ctx.fill();
          ctx.fillStyle = "#ffffff";
          roundRect(ctx, x + 26, 126, 66, 34, 6);
          ctx.fill();
          ctx.fillStyle = "#10253e";
          ctx.font = `800 28px ${FONT}`;
          ctx.fillText(block.number, cx, 144);
        }
        if (block.sensor) {
          // The orange motion-sensor tab: a little sensor brick with two eyes.
          ctx.fillStyle = palette.orange;
          roundRect(ctx, x + 14, 120, 90, 46, 10);
          ctx.fill();
          ctx.fillStyle = "#ffffff";
          roundRect(ctx, x + 26, 131, 42, 24, 6);
          ctx.fill();
          ctx.fillStyle = "#10253e";
          [x + 54, x + 63].forEach((ex) => { ctx.beginPath(); ctx.arc(ex, 143, 3.5, 0, Math.PI * 2); ctx.fill(); });
          ctx.fillStyle = "#ffffff";
          ctx.font = `800 26px ${FONT}`;
          ctx.fillText("↔", x + 86, 143);
        }
        if (lit) {
          ctx.lineWidth = 7;
          ctx.strokeStyle = "#ffffff";
          roundRect(ctx, x + 3, 15, 112, 112, 16);
          ctx.stroke();
        }
        ctx.fillStyle = block.ink;
        ctx.strokeStyle = block.ink;
        if (block.glyph === "gauge") {
          // Motor power: a speedometer.
          ctx.lineWidth = 11;
          ctx.lineCap = "round";
          ctx.beginPath(); ctx.arc(cx, 88, 34, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke();
          ctx.lineWidth = 8;
          ctx.beginPath(); ctx.moveTo(cx, 90); ctx.lineTo(cx + 20, 60); ctx.stroke();
          ctx.beginPath(); ctx.arc(cx, 90, 8, 0, Math.PI * 2); ctx.fill();
        } else if (block.glyph === "start") {
          // Drawn by hand: the "▶" character turns into a blue emoji on tablets.
          ctx.beginPath(); ctx.moveTo(cx - 20, 42); ctx.lineTo(cx + 30, 71); ctx.lineTo(cx - 20, 100); ctx.closePath(); ctx.fill();
        } else {
          ctx.font = `800 70px ${FONT}, ${EMOJI}`;
          ctx.fillText(block.glyph, cx, 74);
        }
      });
      ctx.globalAlpha = 1;
    });
  }

  const textures = {
    shadow: once(() => canvasTexture(128, 128, (ctx) => {
      const g = ctx.createRadialGradient(64, 64, 2, 64, 64, 64);
      g.addColorStop(0, "rgba(10,30,60,.42)");
      g.addColorStop(.5, "rgba(10,30,60,.24)");
      g.addColorStop(1, "rgba(10,30,60,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 128, 128);
    })),
    // The pale hexagon network from the slide backgrounds.
    hexes: once(() => canvasTexture(512, 512, (ctx) => {
      const rand = seeded(11);
      ctx.lineWidth = 3;
      for (let row = 0; row < 7; row += 1) {
        for (let col = 0; col < 7; col += 1) {
          const cx = 40 + col * 78 + (row % 2) * 39;
          const cy = 40 + row * 68;
          const edge = Math.max(Math.abs(cx - 256), Math.abs(cy - 256)) / 256;
          if (rand() > edge * edge + .12) continue;
          ctx.strokeStyle = `rgba(0,159,214,${.16 + rand() * .22})`;
          hexagonPath(ctx, cx, cy, 44);
          ctx.stroke();
          ctx.fillStyle = "rgba(0,159,214,.45)";
          ctx.beginPath();
          ctx.arc(cx, cy - 44, 5, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    })),
    boardLabel: once(() => canvasTexture(1024, 52, (ctx, w, h) => {
      ctx.fillStyle = "#ffffff";
      ctx.font = `800 32px ${FONT}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("MINDSCAPE  ·  HARDWARE & SOFTWARE", w / 2, h / 2 + 2);
    })),
    note: once(() => canvasTexture(96, 96, (ctx) => {
      ctx.font = `800 80px ${FONT}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.lineWidth = 10;
      ctx.strokeStyle = "#ffffff";
      ctx.strokeText("♪", 48, 52);
      ctx.fillStyle = palette.navy;
      ctx.fillText("♪", 48, 52);
    })),
    tile: (item) => {
      const texture = canvasTexture(256, 320, (ctx) => {
        ctx.shadowColor = "rgba(0,159,214,.95)";
        ctx.shadowBlur = 26;
        ctx.fillStyle = "#ffffff";
        roundRect(ctx, 30, 26, 196, 196, 44);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.fillStyle = item.tile;
        roundRect(ctx, 44, 40, 168, 168, 34);
        ctx.fill();
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        if (!item.image) {
          ctx.font = `112px ${EMOJI}`;
          ctx.fillText(item.icon, 128, 130);
        }
        ctx.fillStyle = palette.navy;
        roundRect(ctx, 14, 244, 228, 56, 28);
        ctx.fill();
        ctx.fillStyle = "#ffffff";
        ctx.font = `700 27px ${FONT}`;
        ctx.fillText(item.title, 128, 273);
      });
      // An app with a real icon (WeDo 2.0): the picture is painted over the tile
      // as soon as it has loaded.
      if (item.image) {
        const picture = new Image();
        picture.onload = function () {
          const ctx = texture.image.getContext("2d");
          ctx.save();
          roundRect(ctx, 44, 40, 168, 168, 34);
          ctx.clip();
          ctx.drawImage(picture, 44, 40, 168, 168);
          ctx.restore();
          texture.needsUpdate = true;
        };
        picture.src = item.image;
      }
      return texture;
    },
    badge: (icon) => canvasTexture(256, 256, (ctx) => {
      ctx.shadowColor = "rgba(0,40,70,.35)";
      ctx.shadowBlur = 14;
      ctx.fillStyle = palette.brand;
      hexagonPath(ctx, 128, 128, 112);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.lineWidth = 12;
      ctx.strokeStyle = "#ffffff";
      hexagonPath(ctx, 128, 128, 100);
      ctx.stroke();
      ctx.font = `110px ${EMOJI}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(icon, 128, 136);
    })
  };

  const MATERIALS = {
    matte: { make: () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .86, metalness: 0 }) },
    shiny: { make: () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .35, metalness: .25 }) },
    glow: { make: () => new THREE.MeshBasicMaterial({ vertexColors: true }) },
    shadow: { uv: true, make: () => new THREE.MeshBasicMaterial({ map: textures.shadow(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }) }
  };
  const materialCache = {};
  function sharedMaterial(kind) {
    return materialCache[kind] || (materialCache[kind] = MATERIALS[kind].make());
  }

  const tmpMatrix = new THREE.Matrix4();
  const tmpQuat = new THREE.Quaternion();
  const tmpEuler = new THREE.Euler();
  const tmpPos = new THREE.Vector3();
  const tmpScale = new THREE.Vector3();
  const tmpColor = new THREE.Color();
  const tmpA = new THREE.Vector3();
  const tmpB = new THREE.Vector3();
  const UP = new THREE.Vector3(0, 1, 0);

  function Batch() { this.parts = {}; }

  // options: p = [x, y, z], r = [rx, ry, rz] in degrees, s = number or [sx, sy, sz],
  // kind = material name.
  Batch.prototype.add = function (geometry, color, options) {
    const o = options || {};
    const g = geometry.index ? geometry.toNonIndexed() : geometry;
    if (g !== geometry) geometry.dispose();
    const p = o.p || [0, 0, 0];
    const r = o.r || [0, 0, 0];
    const s = o.s == null ? 1 : o.s;
    tmpPos.set(p[0], p[1], p[2]);
    tmpQuat.setFromEuler(tmpEuler.set(r[0] * DEG, r[1] * DEG, r[2] * DEG));
    if (Array.isArray(s)) tmpScale.set(s[0], s[1], s[2]); else tmpScale.set(s, s, s);
    g.applyMatrix4(tmpMatrix.compose(tmpPos, tmpQuat, tmpScale));
    const count = g.attributes.position.count;
    const colors = new Float32Array(count * 3);
    tmpColor.set(color || "#ffffff");
    for (let i = 0; i < count; i += 1) {
      colors[i * 3] = tmpColor.r;
      colors[i * 3 + 1] = tmpColor.g;
      colors[i * 3 + 2] = tmpColor.b;
    }
    g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    const kind = o.kind || "matte";
    (this.parts[kind] = this.parts[kind] || []).push(g);
    return this;
  };

  Batch.prototype.shadow = function (x, z, w, d, y) {
    return this.add(G.ground(w, d), "#ffffff", { kind: "shadow", p: [x, (y || 0) + .004, z] });
  };

  Batch.prototype.build = function () {
    const group = new THREE.Group();
    Object.keys(this.parts).forEach((kind) => {
      group.add(new THREE.Mesh(mergeGeometries(this.parts[kind], MATERIALS[kind].uv), sharedMaterial(kind)));
    });
    this.parts = {};
    return group;
  };

  function mergeGeometries(list, withUv) {
    let total = 0;
    list.forEach((g) => { total += g.attributes.position.count; });
    const position = new Float32Array(total * 3);
    const normal = new Float32Array(total * 3);
    const color = new Float32Array(total * 3);
    const uv = withUv ? new Float32Array(total * 2) : null;
    let offset = 0;
    list.forEach((g) => {
      position.set(g.attributes.position.array, offset * 3);
      normal.set(g.attributes.normal.array, offset * 3);
      color.set(g.attributes.color.array, offset * 3);
      if (uv && g.attributes.uv) uv.set(g.attributes.uv.array, offset * 2);
      offset += g.attributes.position.count;
      g.dispose();
    });
    const merged = new THREE.BufferGeometry();
    merged.setAttribute("position", new THREE.BufferAttribute(position, 3));
    merged.setAttribute("normal", new THREE.BufferAttribute(normal, 3));
    merged.setAttribute("color", new THREE.BufferAttribute(color, 3));
    if (uv) merged.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    merged.computeBoundingSphere();
    return merged;
  }

  function place(object, o) {
    const p = o.p || [0, 0, 0];
    const r = o.r || [0, 0, 0];
    object.position.set(p[0], p[1], p[2]);
    object.rotation.set(r[0] * DEG, r[1] * DEG, r[2] * DEG);
    if (o.s) object.scale.setScalar(o.s);
    return object;
  }

  function seeded(seed) {
    let a = seed;
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function sprite(texture, width, height) {
    const mesh = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }));
    mesh.scale.set(width, height, 1);
    return mesh;
  }

  // A screen whose picture is redrawn while the desk is running.
  function liveScreen(pixelsWide, pixelsHigh, width, height) {
    const texture = canvasTexture(pixelsWide, pixelsHigh);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshBasicMaterial({ map: texture }));
    return { mesh, ctx: texture.image.getContext("2d"), w: pixelsWide, h: pixelsHigh, texture, mode: "", start: 0, drawn: -1 };
  }

  function clamp01(value) { return Math.max(0, Math.min(1, value)); }

  function wheel(b, x, y, z, r) {
    b.add(G.cyl(r, r, .16, 14), palette.tyre, { p: [x, y, z], r: [90, 0, 0] });
    b.add(G.cyl(r * .5, r * .5, .17, 10), "#e9edf0", { p: [x, y, z], r: [90, 0, 0] });
  }

  // ---------------------------------------------------------------------------
  // What the screens show
  // ---------------------------------------------------------------------------

  function wallpaper(ctx, w, h, top, bottom) {
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, top);
    g.addColorStop(1, bottom);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "rgba(255,255,255,.18)";
    ctx.beginPath(); ctx.moveTo(w * .18, 0); ctx.lineTo(w * .42, 0); ctx.lineTo(w * .12, h); ctx.lineTo(-w * .12, h); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(w * .5, 0); ctx.lineTo(w * .58, 0); ctx.lineTo(w * .28, h); ctx.lineTo(w * .2, h); ctx.closePath(); ctx.fill();
  }

  function asleep(ctx, w, h) {
    ctx.fillStyle = "#0c1826";
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#42566e";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `700 ${Math.round(h * .22)}px ${FONT}`;
    ctx.fillText("z z z", w / 2, h / 2);
  }

  // The picture the drawing app makes: a house, its roof and a sun.
  const SKETCH = (function () {
    const sun = [];
    for (let i = 0; i <= 20; i += 1) sun.push([.78 + Math.cos(i * Math.PI / 10) * .08, .3 + Math.sin(i * Math.PI / 10) * .15]);
    return [
      { color: "#0b78c9", points: [[.3, .82], [.3, .5], [.58, .5], [.58, .82], [.3, .82]] },
      { color: "#e2412f", points: [[.26, .5], [.44, .22], [.62, .5]] },
      { color: "#f5a623", points: sun },
      { color: "#2fae5a", points: [[.1, .86], [.25, .82], [.45, .87], [.7, .82], [.92, .86]] }
    ];
  })();

  function sketchPoint(k) {
    const total = SKETCH.reduce((sum, stroke) => sum + stroke.points.length, 0);
    let index = Math.min(total - 1, Math.floor(clamp01(k) * total));
    for (const stroke of SKETCH) {
      if (index < stroke.points.length) return stroke.points[index];
      index -= stroke.points.length;
    }
    return [.5, .5];
  }

  function paintDrawing(ctx, w, h, k) {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#e8eef4";
    ctx.fillRect(0, 0, w * .09, h);
    ["#e2412f", "#f5a623", "#2fae5a", "#0b78c9", "#7b4bd8"].forEach((color, i) => {
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(w * .045, h * (.16 + i * .17), h * .05, 0, Math.PI * 2); ctx.fill();
    });
    const total = SKETCH.reduce((sum, stroke) => sum + stroke.points.length, 0);
    let budget = Math.floor(clamp01(k) * total) + 1;
    ctx.lineWidth = Math.max(4, h * .028);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    SKETCH.forEach((stroke) => {
      if (budget <= 1) { budget -= stroke.points.length; return; }
      ctx.strokeStyle = stroke.color;
      ctx.beginPath();
      stroke.points.slice(0, budget).forEach(([x, y], i) => ctx[i ? "lineTo" : "moveTo"](x * w, y * h));
      ctx.stroke();
      budget -= stroke.points.length;
    });
    if (k < 1) {
      const [x, y] = sketchPoint(k);
      ctx.fillStyle = "#10253e";
      ctx.beginPath(); ctx.moveTo(x * w, y * h); ctx.lineTo(x * w + h * .09, y * h + h * .05); ctx.lineTo(x * w + h * .03, y * h + h * .1); ctx.closePath(); ctx.fill();
    }
  }

  const TYPED = "Hello, robot!";

  function paintWriting(ctx, w, h, k, t) {
    ctx.fillStyle = "#dfe7ef";
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#1e5fd0";
    ctx.fillRect(0, 0, w, h * .14);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(w * .14, h * .22, w * .72, h * .78);
    const text = TYPED.slice(0, Math.round(clamp01(k) * TYPED.length));
    ctx.fillStyle = "#10253e";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.font = `700 ${Math.round(h * .16)}px ${FONT}`;
    ctx.fillText(text, w * .2, h * .46);
    if (Math.floor(t * 3) % 2 === 0) ctx.fillRect(w * .2 + ctx.measureText(text).width + 4, h * .38, 4, h * .17);
    ctx.fillStyle = "#c9d5e1";
    [.66, .78].forEach((y) => ctx.fillRect(w * .2, h * y, w * .6, h * .035));
  }

  function paintVideo(ctx, w, h, t) {
    const k = (t % 6) / 6;
    ctx.fillStyle = "#8fd8f5";
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#ffd23f";
    ctx.beginPath(); ctx.arc(w * .82, h * .22, h * .11, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#6cc04a";
    ctx.fillRect(0, h * .68, w, h * .32);
    // A little car driving across the film.
    const x = -w * .15 + k * w * 1.3;
    const y = h * .62 - Math.abs(Math.sin(t * 7)) * h * .015;
    ctx.fillStyle = "#e2412f";
    roundRect(ctx, x, y - h * .1, w * .17, h * .11, h * .03);
    ctx.fill();
    roundRect(ctx, x + w * .035, y - h * .17, w * .09, h * .09, h * .03);
    ctx.fill();
    ctx.fillStyle = "#16191c";
    [x + w * .04, x + w * .13].forEach((cx) => { ctx.beginPath(); ctx.arc(cx, y + h * .01, h * .045, 0, Math.PI * 2); ctx.fill(); });
    ctx.fillStyle = "rgba(0,20,45,.72)";
    ctx.fillRect(0, h * .88, w, h * .12);
    ctx.fillStyle = "#ffffff";
    ctx.beginPath(); ctx.moveTo(w * .03, h * .905); ctx.lineTo(w * .03, h * .975); ctx.lineTo(w * .06, h * .94); ctx.closePath(); ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,.4)";
    ctx.fillRect(w * .09, h * .93, w * .86, h * .02);
    ctx.fillStyle = "#ff4d5e";
    ctx.fillRect(w * .09, h * .93, w * .86 * k, h * .02);
    ctx.beginPath(); ctx.arc(w * .09 + w * .86 * k, h * .94, h * .025, 0, Math.PI * 2); ctx.fill();
  }

  function paintPhoto(ctx, w, h, k) {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
    const m = h * .07;
    ctx.fillStyle = "#bfe9fb";
    ctx.fillRect(m, m, w - 2 * m, h - 2 * m);
    ctx.fillStyle = "#6cc04a";
    ctx.fillRect(m, h * .7, w - 2 * m, h * .3 - m);
    // A smiling robot face: the "photo" the camera app took.
    const cx = w / 2;
    const cy = h * .5;
    ctx.fillStyle = "#f4f6f8";
    roundRect(ctx, cx - h * .26, cy - h * .22, h * .52, h * .42, h * .08);
    ctx.fill();
    ctx.fillStyle = palette.brand;
    [-1, 1].forEach((side) => { ctx.beginPath(); ctx.arc(cx + side * h * .11, cy - h * .04, h * .055, 0, Math.PI * 2); ctx.fill(); });
    ctx.strokeStyle = "#10253e";
    ctx.lineWidth = h * .03;
    ctx.lineCap = "round";
    ctx.beginPath(); ctx.arc(cx, cy + h * .04, h * .1, .15 * Math.PI, .85 * Math.PI); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx, cy - h * .22); ctx.lineTo(cx, cy - h * .32); ctx.stroke();
    ctx.fillStyle = palette.red;
    ctx.beginPath(); ctx.arc(cx, cy - h * .34, h * .035, 0, Math.PI * 2); ctx.fill();
    if (k < 1) {
      ctx.fillStyle = `rgba(255,255,255,${1 - k})`;
      ctx.fillRect(0, 0, w, h);
    }
  }

  // ---------------------------------------------------------------------------
  // Desk pieces
  // ---------------------------------------------------------------------------

  const TRACK_Z = 3.15;

  function buildGround(desk) {
    const b = new Batch();
    // Toy-like plinth in the Mindscape blue so the desk looks like a model.
    b.add(G.box(8.4, .22, 8.4), palette.brand, { p: [0, -.17, 0] });
    b.add(G.box(8.5, .05, 8.5), "#0284b8", { p: [0, -.255, 0] });
    b.add(G.box(8.4, .06, 8.4), palette.desk, { p: [0, -.03, 0] });
    // Desk mat under the keyboard and mouse, and the rover's test track.
    b.add(G.box(5.7, .02, 2.1), palette.mat, { p: [.45, .01, -.1] });
    b.add(G.box(7.7, .014, 1.2), "#d3ecf8", { p: [0, .007, TRACK_Z] });
    for (let x = -3.4; x <= 3.4; x += .68) b.add(G.box(.34, .006, .07), palette.brand, { p: [x, .017, TRACK_Z] });
    desk.content.add(b.build());

    const hexes = new THREE.Mesh(G.ground(8.4, 8.4), new THREE.MeshBasicMaterial({ map: textures.hexes(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
    hexes.position.y = .002;
    desk.content.add(hexes);

    const labelMaterial = new THREE.MeshBasicMaterial({ map: textures.boardLabel(), transparent: true, alphaTest: .05 });
    [[0, 4.202, 0], [0, -4.202, 180], [4.202, 0, 90], [-4.202, 0, -90]].forEach(([x, z, ry]) => {
      desk.content.add(place(new THREE.Mesh(new THREE.PlaneGeometry(4.6, .23), labelMaterial), { p: [x, -.16, z], r: [0, ry, 0] }));
    });
  }

  function buildMonitor(desk) {
    const el = desk.itemEntity("monitor", 0, 0, -2.4);
    const b = new Batch();
    b.add(G.cyl(.62, .7, .06, 24), palette.silver, { p: [0, .03, 0], kind: "shiny" });
    b.add(G.box(.26, .95, .1), palette.silver, { p: [0, .5, -.04], kind: "shiny" });
    b.add(G.box(3.7, 2.25, .14), "#39424c", { p: [0, 2.0, 0] });
    b.add(G.box(3.7, .3, .16), palette.silver, { p: [0, 1.03, 0], kind: "shiny" });
    b.shadow(0, .1, 2.6, 1.5);
    el.object3D.add(b.build());

    const screen = liveScreen(512, 270, 3.46, 1.82);
    place(screen.mesh, { p: [0, 2.13, .073] });
    el.object3D.add(screen.mesh);
    desk.monitor = screen;
    targetBox(el, items.monitor, { position: "0 1.6 0", width: "3.9", height: "3.2", depth: ".9" });
    desk.badgeSpots.watch = { p: [2.5, 3.5, -2.4] };

    desk.life.push((t) => {
      const mode = screen.mode;
      const k = (t - screen.start);
      // Still pictures are painted once; moving ones about 12 times a second.
      const moving = mode === "video" || (mode === "draw" && k < 5.2) || (mode === "write" && k < 6);
      const stamp = moving ? Math.floor(t * 12) : 0;
      if (screen.drawn === mode + stamp) return;
      screen.drawn = mode + stamp;
      if (mode === "home") wallpaper(screen.ctx, screen.w, screen.h, "#3fb6f2", "#1783d4");
      else if (mode === "draw") paintDrawing(screen.ctx, screen.w, screen.h, k / 5);
      else if (mode === "write") paintWriting(screen.ctx, screen.w, screen.h, k / 3.2, t);
      else if (mode === "video") paintVideo(screen.ctx, screen.w, screen.h, k);
      else asleep(screen.ctx, screen.w, screen.h);
      screen.texture.needsUpdate = true;
    });
  }

  function buildKeyboard(desk) {
    const el = desk.itemEntity("keyboard", -.5, .02, -.1);
    const b = new Batch();
    b.add(G.box(2.7, .1, .98), "#9fabb6", { p: [0, .05, 0], kind: "shiny" });
    const keys = [];
    for (let row = 0; row < 4; row += 1) {
      for (let col = 0; col < 12; col += 1) {
        const x = -1.2 + col * .218;
        const z = -.33 + row * .215;
        if (row === 3 && col >= 3 && col <= 8) continue;
        b.add(G.box(.17, .05, .17), "#f6f8fa", { p: [x, .12, z] });
        keys.push([x, z]);
      }
    }
    b.add(G.box(1.26, .05, .17), "#f6f8fa", { p: [-.001, .12, .315] });
    b.shadow(0, 0, 3.2, 1.5);
    el.object3D.add(b.build());

    const press = new THREE.Mesh(G.box(.18, .06, .18), new THREE.MeshBasicMaterial({ color: palette.cyan }));
    press.visible = false;
    el.object3D.add(press);
    targetBox(el, items.keyboard, { position: "0 .25 0", width: "2.9", height: ".6", depth: "1.2" });
    desk.badgeSpots.write = { p: [-.5, 1.3, -.1] };

    const rand = seeded(3);
    let last = -1;
    desk.life.push((t) => {
      const typing = desk.monitor.mode === "write" && t - desk.monitor.start < 3.4;
      press.visible = typing;
      if (!typing) return;
      const step = Math.floor(t * 6);
      if (step === last) return;
      last = step;
      const key = keys[Math.floor(rand() * keys.length)];
      press.position.set(key[0], .125, key[1]);
    });
  }

  function buildMouse(desk) {
    const home = [2.25, .02, -.05];
    const el = desk.itemEntity("mouse", home[0], home[1], home[2]);
    const b = new Batch();
    b.add(G.sphere(.34, 18), palette.grey, { p: [0, .12, 0], s: [1, .5, 1.45], kind: "shiny" });
    b.add(G.cyl(.05, .05, .07, 10), "#3b5bdb", { p: [0, .265, -.2], r: [0, 0, 90] });
    b.add(G.box(.015, .02, .32), "#5d646b", { p: [0, .262, -.34] });
    b.add(G.box(.04, .03, 1.0), "#6b7177", { p: [0, .02, -.98] });
    b.shadow(0, 0, 1.1, 1.5);
    el.object3D.add(b.build());
    targetBox(el, items.mouse, { position: "0 .3 0", width: "1", height: ".7", depth: "1.3" });
    desk.badgeSpots.draw = { p: [home[0], 1.4, home[2]] };

    // While the drawing app is busy, the mouse follows the pen.
    desk.life.push((t) => {
      const k = (t - desk.monitor.start) / 5;
      const drawing = desk.monitor.mode === "draw" && k < 1;
      const [x, y] = drawing ? sketchPoint(k) : [.5, .5];
      el.object3D.position.set(home[0] + (x - .5) * .7, home[1], home[2] + (y - .5) * .7);
    });
  }

  function buildSpeakers(desk) {
    const cones = [];
    [[-3.15, 18], [3.15, -18]].forEach(([x, ry]) => {
      const el = desk.itemEntity("speaker", x, 0, -2.45, ry);
      const b = new Batch();
      b.add(G.box(.86, .06, .8), palette.speakerDark, { p: [0, .03, 0] });
      b.add(G.box(.8, 1.75, .74), palette.speaker, { p: [0, .93, 0] });
      b.add(G.box(.7, 1.62, .03), palette.speakerDark, { p: [0, .93, .375] });
      b.add(G.cyl(.035, .035, .04, 10), palette.lightBlue, { p: [.26, .2, .39], r: [90, 0, 0], kind: "glow" });
      b.shadow(0, 0, 1.3, 1.3);
      el.object3D.add(b.build());
      [[.62, .27], [1.33, .18]].forEach(([y, r]) => {
        const cone = new THREE.Group();
        cone.position.set(0, y, .395);
        const cb = new Batch();
        cb.add(G.cyl(r, r, .04, 20), "#16307a", { r: [90, 0, 0] });
        cb.add(G.cyl(r * .78, r * .78, .05, 20), "#5d86ee", { r: [90, 0, 0] });
        cb.add(G.cyl(r * .36, r * .36, .07, 14), "#16307a", { r: [90, 0, 0] });
        cone.add(cb.build());
        el.object3D.add(cone);
        cones.push(cone);
      });
      targetBox(el, items.speaker, { position: "0 .95 0", width: "1.05", height: "2", depth: "1.05" });
    });
    desk.badgeSpots.listen = { p: [-3.15, 2.6, -2.45] };

    const notes = [0, 1, 2, 3].map((i) => {
      const note = sprite(textures.note(), .5, .5);
      note.visible = false;
      note.userData.x = i % 2 ? 3.15 : -3.15;
      desk.content.add(note);
      return note;
    });
    desk.music = { start: -100 };
    desk.life.push((t) => {
      const age = t - desk.music.start;
      const playing = age >= 0 && age < 6;
      const beat = playing ? Math.abs(Math.sin(t * 9)) : 0;
      cones.forEach((cone, i) => cone.scale.setScalar(1 + beat * (i % 2 ? .22 : .14)));
      notes.forEach((note, i) => {
        note.visible = playing;
        if (!playing) return;
        const phase = (age * .55 + i / 4) % 1;
        note.position.set(note.userData.x + Math.sin(phase * 6 + i) * .35, 2.0 + phase * 1.7, -2.2);
        note.material.opacity = 1 - phase;
      });
    });
  }

  function buildTablet(desk) {
    const el = desk.itemEntity("tablet", -2.9, 0, 1.1, 28);
    const b = new Batch();
    b.add(G.box(1.0, .06, .6), palette.silver, { p: [0, .03, -.12], kind: "shiny" });
    b.add(G.box(.1, .7, .08), palette.silver, { p: [0, .36, -.3], r: [16, 0, 0], kind: "shiny" });
    b.shadow(0, 0, 2.0, 1.4);
    el.object3D.add(b.build());

    const tilt = new THREE.Group();
    tilt.position.set(0, .06, .12);
    tilt.rotation.x = -20 * DEG;
    const tb = new Batch();
    tb.add(G.box(1.62, 1.1, .08), "#3a3f4a", { p: [0, .55, 0], kind: "shiny" });
    tb.add(G.cyl(.022, .022, .02, 10), "#1b1e24", { p: [-.75, .55, .042], r: [90, 0, 0] });
    tilt.add(tb.build());
    const screen = liveScreen(384, 250, 1.4, .92);
    place(screen.mesh, { p: [.02, .55, .042] });
    tilt.add(screen.mesh);
    el.object3D.add(tilt);
    desk.tablet = screen;
    targetBox(el, items.tablet, { position: "0 .6 0", width: "1.8", height: "1.4", depth: "1.1" });
    desk.badgeSpots.photo = { p: [-2.9, 2.0, 1.1] };

    desk.life.push((t) => {
      const mode = screen.mode;
      const k = (t - screen.start) / .7;
      const stamp = mode === "photo" && k < 1.1 ? Math.floor(t * 12) : 0;
      if (screen.drawn === mode + stamp) return;
      screen.drawn = mode + stamp;
      if (mode === "home") wallpaper(screen.ctx, screen.w, screen.h, "#a2a8f0", "#7178d8");
      else if (mode === "photo") paintPhoto(screen.ctx, screen.w, screen.h, k);
      else asleep(screen.ctx, screen.w, screen.h);
      screen.texture.needsUpdate = true;
    });
  }

  function buildRover(desk) {
    // The WeDo rover from last session: brain, motor and a motion sensor on an arm.
    const el = desk.itemEntity("robot", 1.6, .014, TRACK_Z);
    const rover = el.object3D;
    const b = new Batch();
    [-1, 1].forEach((side) => {
      wheel(b, -.55, .25, side * .44, .25);
      wheel(b, .08, .2, side * .44, .2);
      wheel(b, .56, .2, side * .44, .2);
    });
    b.add(G.box(1.5, .12, .62), palette.lime, { p: [0, .34, 0] });
    b.add(G.box(.5, .1, .62), palette.orange, { p: [-.5, .45, 0] });
    b.add(G.box(.8, .42, .58), palette.hubWhite, { p: [.3, .61, 0] });
    b.add(G.box(.82, .1, .6), "#cfd6dc", { p: [.3, .47, 0] });
    [-1, 1].forEach((side) => b.add(G.box(.3, .1, .02), "#3a424a", { p: [.42, .64, side * .295] }));
    b.add(G.box(.16, .02, .16), palette.green, { p: [.3, .825, 0], kind: "glow" });
    [[.02, .2], [.58, .2], [.02, -.2], [.58, -.2]].forEach(([x, z]) => b.add(G.cyl(.05, .05, .04, 10), "#cfd6dc", { p: [x, .84, z] }));
    b.add(G.box(.5, .16, .5), palette.orange, { p: [-.05, .9, 0] });
    b.add(G.box(.46, .4, .46), palette.motor, { p: [-.5, .7, 0], kind: "shiny" });
    b.add(G.box(.16, .44, .5), "#20262b", { p: [-.8, .7, 0] });
    b.add(G.cyl(.16, .16, .05, 14), "#5d646b", { p: [-.5, .62, .27], r: [90, 0, 0] });
    b.add(G.cyl(.028, .028, .72, 8), "#aab2b8", { p: [.27, 1.2, 0], r: [0, 0, -42] });
    b.add(G.box(.36, .2, .34), "#7d858c", { p: [.62, 1.54, 0] });
    b.add(G.box(.3, .12, .3), palette.lightBlue, { p: [.6, 1.38, 0], kind: "shiny" });
    [-.08, .08].forEach((z) => b.add(G.cyl(.045, .045, .02, 10), "#11151a", { p: [.805, 1.54, z], r: [0, 0, 90] }));
    b.shadow(0, 0, 2.0, 1.4);
    rover.add(b.build());

    const eyeMaterial = new THREE.MeshBasicMaterial({ color: palette.lightBlue, transparent: true, opacity: .85, side: THREE.DoubleSide, depthWrite: false });
    const eye = place(new THREE.Mesh(new THREE.RingGeometry(.13, .17, 24), eyeMaterial), { p: [.83, 1.54, 0], r: [0, 90, 0] });
    rover.add(eye);

    const blockTextures = { drive: blocksTexture([0, 1, 2, 3]), stop: blocksTexture([4, 5]) };
    const blocks = sprite(blockTextures.drive, 2.7, .62);
    blocks.position.set(0, 2.3, 0);
    blocks.visible = false;
    blocks.renderOrder = 2;
    rover.add(blocks);

    targetBox(el, items.robot, { position: "0 .95 0", width: "1.9", height: "2", depth: "1.3" });
    desk.badgeSpots.robot = { parent: rover, p: [0, 3.1, 0] };
    desk.badgeSpots.condition = { parent: rover, p: [0, 3.95, 0] };

    const wall = new THREE.Group();
    const wb = new Batch();
    [palette.red, palette.yellow, palette.red, palette.yellow, palette.red].forEach((color, i) => {
      wb.add(G.box(.3, .3, 1.0), color, { p: [0, .15 + i * .3, 0] });
      [-.3, 0, .3].forEach((z) => wb.add(G.cyl(.07, .07, .05, 10), color, { p: [0, .32 + i * .3, z] }));
    });
    wb.shadow(0, 0, .9, 1.5);
    wall.add(wb.build());
    wall.visible = false;
    desk.content.add(wall);

    const END = 3.0;
    const SPEED = .8;
    const state = desk.rover = { mode: "parked", x: 1.6, dir: 1, turn: -1, seeing: false, near: false, wall: false, wallX: 0, wallStart: 0 };
    const camera = new THREE.Vector3();

    // The wall goes on the nearest free spot in front of the rover.
    desk.setWall = function (on) {
      state.wall = !!on;
      wall.visible = state.wall;
      if (!state.wall) return;
      const spots = [-2.2, 0, 2.2];
      const ahead = spots.filter((x) => (x - state.x) * state.dir >= 1.7).sort((a, c) => Math.abs(a - state.x) - Math.abs(c - state.x));
      state.wallX = ahead.length ? ahead[0] : spots.sort((a, c) => Math.abs(c - state.x) - Math.abs(a - state.x))[0];
      state.wallStart = desk.now;
      wall.position.set(state.wallX, .014, TRACK_Z);
    };

    desk.life.push((t, dt) => {
      const pop = clamp01((t - state.wallStart) / .35);
      wall.scale.setScalar(.2 + .8 * pop + .25 * Math.sin(pop * Math.PI));

      if (state.mode !== "drive") {
        eye.scale.setScalar(1 + .22 * Math.sin(t * 4));
        return;
      }

      // In camera AR the child is the obstacle: walk up to the rover and its
      // sensor "sees" the tablet. Two distances so it does not flicker at the edge.
      const scene = desk.el.sceneEl;
      if (scene && scene.is("ar-mode") && scene.camera) {
        camera.setFromMatrixPosition(scene.camera.matrixWorld);
        const reach = desk.el.object3D.scale.x / .2;
        const distance = camera.distanceTo(rover.localToWorld(tmpA.set(0, .9, 0)));
        state.near = distance < (state.near ? .62 : .48) * reach;
      } else {
        state.near = false;
      }
      const gap = (state.wallX - state.x) * state.dir;
      const seesWall = state.wall && state.turn < 0 && gap > 0 && gap < 1.55;
      const seeing = seesWall || state.near;

      if (seeing !== state.seeing) {
        state.seeing = seeing;
        blocks.material.map = seeing ? blockTextures.stop : blockTextures.drive;
        eyeMaterial.color.set(seeing ? "#ffb02e" : palette.lightBlue);
        if (seeing) sound("beep");
        document.dispatchEvent(new CustomEvent("desk-rover-sense", { detail: { seeing, cause: seesWall ? "wall" : "you" } }));
      }
      eye.scale.setScalar(seeing ? 1.5 + .5 * Math.sin(t * 16) : 1 + .22 * Math.sin(t * 4));
      if (seeing) return;

      if (state.turn >= 0) {
        state.turn = Math.min(1, state.turn + dt / 1.2);
        rover.rotation.y = (state.dir === 1 ? 0 : Math.PI) + state.turn * Math.PI;
        if (state.turn >= 1) { state.dir = -state.dir; state.turn = -1; }
        return;
      }
      state.x += state.dir * SPEED * dt;
      if (state.dir * state.x >= END) { state.x = state.dir * END; state.turn = 0; }
      rover.position.x = state.x;
      rover.rotation.y = state.dir === 1 ? 0 : Math.PI;
    });

    desk.startRover = function () {
      if (state.mode === "drive") return;
      state.mode = "drive";
      blocks.visible = true;
    };
  }

  function buildApps(desk) {
    // The programs live inside the computer. When the desk wakes up they fly out
    // of the monitor and float above it, so the children can see and tap them.
    const order = ["music", "draw", "program", "video", "camera", "write"];
    const origin = [0, 2.1, -2.3];
    order.forEach((id, i) => {
      const x = -3.4 + i * 1.36;
      const home = [x, 4.2 + .55 * Math.cos(x / 3.4 * Math.PI / 2), -2.2];
      const el = desk.itemEntity(id, origin[0], origin[1], origin[2]);
      const tile = sprite(textures.tile(items[id]), 1.24, 1.55);
      tile.renderOrder = 1;
      el.object3D.add(tile);
      el.object3D.scale.setScalar(.001);
      targetBox(el, items[id], { position: "0 0 0", width: "1.25", height: "1.55", depth: "1.25" });
      desk.life.push((t) => {
        if (!desk.awake) return;
        const k = clamp01((t - desk.wakeTime - i * .12) / .9);
        const ease = 1 - Math.pow(1 - k, 3);
        el.object3D.position.set(
          origin[0] + (home[0] - origin[0]) * ease,
          origin[1] + (home[1] - origin[1]) * ease + (k >= 1 ? Math.sin(t * 1.6 + i) * .07 : 0),
          origin[2] + (home[2] - origin[2]) * ease
        );
        if (k < 1) el.object3D.scale.setScalar(Math.max(.001, ease * (1 + .3 * Math.sin(k * Math.PI))));
        else if (!desk.bounces.some((item) => item.object === el.object3D)) el.object3D.scale.setScalar(1);
      });
    });
  }

  function buildLink(desk) {
    // A glowing line that joins the hardware and the software of a finished pair.
    const material = new THREE.MeshBasicMaterial({ color: palette.cyan, transparent: true, opacity: .9, depthWrite: false });
    const beam = new THREE.Mesh(G.cyl(.04, .04, 1, 8), material);
    beam.visible = false;
    desk.content.add(beam);
    desk.linkState = { a: null, b: null, start: -100 };
    desk.life.push((t) => {
      const link = desk.linkState;
      const age = t - link.start;
      beam.visible = !!link.a && age < 3.2;
      if (!beam.visible) return;
      desk.content.worldToLocal(link.a.localToWorld(tmpA.set(0, .5, 0)));
      desk.content.worldToLocal(link.b.getWorldPosition(tmpB));
      const length = tmpA.distanceTo(tmpB);
      beam.position.copy(tmpA).add(tmpB).multiplyScalar(.5);
      beam.quaternion.setFromUnitVectors(UP, tmpB.sub(tmpA).normalize());
      beam.scale.set(1, Math.max(.01, length * clamp01(age / .35)), 1);
      material.opacity = .55 + .35 * Math.sin(t * 12);
    });
  }

  AFRAME.registerComponent("tech-desk", {
    init: function () {
      this.life = [];
      this.groups = {};
      this.badges = {};
      this.badgeSpots = {};
      this.bounces = [];
      this.now = 0;
      this.awake = false;
      this.wakeTime = 0;
      desks.push(this);
      this.build = this.build.bind(this);
      if (this.el.sceneEl && this.el.sceneEl.hasLoaded) {
        this.build();
      } else if (this.el.sceneEl) {
        this.el.sceneEl.addEventListener("loaded", this.build, { once: true });
      }
    },

    remove: function () {
      const index = desks.indexOf(this);
      if (index >= 0) desks.splice(index, 1);
    },

    itemEntity: function (id, x, y, z, ry) {
      const el = add(this.contentEl, "a-entity", { position: `${x} ${y} ${z}`, rotation: `0 ${ry || 0} 0` });
      (this.groups[id] = this.groups[id] || []).push(el.object3D);
      return el;
    },

    build: function () {
      if (this.built) return;
      this.built = true;
      // The plinth is .28 thick; lift everything so the desk sits on the surface.
      this.contentEl = add(this.el, "a-entity", { position: "0 .28 0" });
      this.content = this.contentEl.object3D;
      buildGround(this);
      buildMonitor(this);
      buildKeyboard(this);
      buildMouse(this);
      buildSpeakers(this);
      buildTablet(this);
      buildRover(this);
      buildApps(this);
      buildLink(this);
      this.life.push((t) => this.animateRewards(t));
      this.el.emit("desk-ready", {}, false);
    },

    tick: function (time, delta) {
      if (!this.built) return;
      const dt = Math.min(delta || 16, 100) / 1000;
      this.now = time / 1000;
      for (let i = 0; i < this.life.length; i += 1) {
        // A broken animation removes itself instead of stopping the whole render loop.
        try {
          this.life[i](this.now, dt);
        } catch (error) {
          this.life.splice(i, 1);
          i -= 1;
          console.error("tech-desk animation stopped:", error);
        }
      }
    },

    wake: function () {
      if (this.awake || !this.built) return;
      this.awake = true;
      this.wakeTime = this.now;
      this.monitor.mode = "home";
      this.tablet.mode = "home";
    },

    // Shows what a finished hardware + software pair can do together.
    // (Not called "play": A-Frame keeps that name for its own component lifecycle.)
    runActivity: function (activity) {
      if (!this.built) return;
      if (activity === "draw" || activity === "write") {
        this.monitor.mode = activity;
        this.monitor.start = this.now;
      } else if (activity === "watch") {
        this.monitor.mode = "video";
        this.monitor.start = this.now;
      } else if (activity === "listen") {
        this.music.start = this.now;
      } else if (activity === "photo") {
        this.tablet.mode = "photo";
        this.tablet.start = this.now;
      } else if (activity === "robot") {
        this.startRover();
      }
    },

    link: function (hardwareId, softwareId) {
      const a = (this.groups[hardwareId] || [])[0];
      const b = (this.groups[softwareId] || [])[0];
      if (a && b) this.linkState = { a, b, start: this.now };
    },

    bounce: function (id) {
      (this.groups[id] || []).forEach((object) => {
        this.bounces = this.bounces.filter((item) => item.object !== object);
        this.bounces.push({ object, start: this.now });
      });
    },

    markFound: function (id, icon) {
      if (this.badges[id] || !this.badgeSpots[id]) return;
      const spot = this.badgeSpots[id];
      const badge = sprite(textures.badge(icon), 1, 1);
      badge.position.set(spot.p[0], spot.p[1], spot.p[2]);
      badge.scale.setScalar(.001);
      badge.renderOrder = 3;
      (spot.parent || this.content).add(badge);
      this.badges[id] = { sprite: badge, start: this.now, baseY: spot.p[1] };
    },

    animateRewards: function (t) {
      this.bounces = this.bounces.filter((item) => {
        const k = (t - item.start) / .8;
        if (k >= 1) { item.object.scale.setScalar(1); return false; }
        item.object.scale.setScalar(1 + .22 * Math.sin(k * Math.PI * 3) * (1 - k));
        return true;
      });
      Object.values(this.badges).forEach((badge) => {
        const k = Math.min(1, (t - badge.start) / .6);
        const pop = k < 1 ? Math.sin(k * Math.PI * .5) * (1 + .35 * Math.sin(k * Math.PI)) : 1;
        badge.sprite.scale.setScalar(.75 * pop);
        badge.sprite.position.y = badge.baseY + Math.sin(t * 2 + badge.baseY) * .08;
      });
    }
  });

  const ACTIVITY_SOUNDS = { listen: "tune", photo: "click" };

  window.TechDesk = {
    items,
    palette,
    selectTarget,
    isAwake,
    sound,
    targetFromObject: function (object) {
      let current = object;
      while (current) {
        if (current.el && current.el.classList && current.el.classList.contains("desk-target")) return current.el;
        current = current.parent;
      }
      return null;
    },
    flashTarget: function (target, color) {
      if (!target) return;
      // Always restore to the fixed hidden material. getAttribute("material") returns
      // A-Frame's live data object, so "saving" it does not work and quick repeated
      // taps would leave big coloured boxes stuck on the desk.
      window.clearTimeout(target.flashTimer);
      target.setAttribute("material", `color: ${color || "#45e28b"}; opacity: .33; transparent: true; depthWrite: false; visible: true`);
      target.flashTimer = window.setTimeout(function () { target.setAttribute("material", HITBOX_MATERIAL); }, 1050);
    },
    // Turns the screens on and lets the programs fly out of the monitor.
    wake: function () {
      desks.forEach((desk) => desk.wake());
      sound("wake");
    },
    // Makes an item jump (used for hints and correct taps).
    bounce: function (id) { desks.forEach((desk) => desk.bounce(id)); },
    link: function (hardwareId, softwareId) { desks.forEach((desk) => desk.link(hardwareId, softwareId)); },
    play: function (activity) {
      desks.forEach((desk) => desk.runActivity(activity));
      sound(ACTIVITY_SOUNDS[activity] || "right");
    },
    // Floats a badge above the desk for a finished mission.
    markFound: function (id, icon) { desks.forEach((desk) => desk.markFound(id, icon)); },
    setWall: function (on) { desks.forEach((desk) => { if (desk.setWall) desk.setWall(on); }); },
    roverSeeing: function () { return desks.some((desk) => desk.rover && desk.rover.seeing); }
  };
})();
