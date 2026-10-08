// The missions, cards and badges. Shared by camera AR, marker AR and the 3D page:
// each page gives it an empty element and it builds the panels inside.
(function () {
  const missions = [
    { id: "draw", icon: "🎨", prompt: "I want to draw a picture!", goal: "draw", hardware: "mouse", software: "draw", done: "You need both to draw!", badge: "Artist",
      hardwareHint: "Look for the small grey part you move with your hand.", softwareHint: "Look up! Find the program with the paint palette." },
    { id: "write", icon: "📝", prompt: "I want to write words!", goal: "write words", hardware: "keyboard", software: "write", done: "You need both to write words!", badge: "Writer",
      hardwareHint: "Look for the part with lots of letter keys.", softwareHint: "Look up! Find the program with the paper and pencil." },
    { id: "watch", icon: "🎬", prompt: "I want to watch a video!", goal: "watch a video", hardware: "monitor", software: "video", done: "You need both to watch!", badge: "Movie Fan",
      hardwareHint: "Look for the big screen.", softwareHint: "Look up! Find the program with the film clapper." },
    { id: "listen", icon: "🎵", prompt: "I want to listen to music!", goal: "listen to music", hardware: "speaker", software: "music", done: "You need both to listen!", badge: "Music Star",
      hardwareHint: "Look for the tall blue boxes that make sound.", softwareHint: "Look up! Find the program with the music note." },
    { id: "photo", icon: "📷", prompt: "I want to take a picture!", goal: "take a picture", hardware: "tablet", software: "camera", done: "You need both to take a picture!", badge: "Photographer",
      hardwareHint: "Look for the flat screen you can carry.", softwareHint: "Look up! Find the program with the camera." },
    { id: "robot", icon: "🤖", prompt: "I want to move the robot!", goal: "move the robot", hardware: "robot", software: "program", done: "You need both to move the robot!", badge: "Robot Coder",
      hardwareHint: "Look for the machine with six wheels.", softwareHint: "Look up! Find WeDo 2.0, the blue app we use to program the robot." }
  ];
  const BONUS = { id: "condition", icon: "⭐", badge: "Condition Master" };
  const TOTAL = missions.length + 1;

  const MARKUP = `
    <section class="mission" data-ui="mission" aria-live="polite">
      <div class="mission-top"><span data-ui="label"></span><span data-ui="count"></span></div>
      <div class="mission-row">
        <span class="mission-icon" data-ui="icon" aria-hidden="true"></span>
        <p class="mission-text" data-ui="text"></p>
        <button class="pill-button" data-ui="hint" type="button">Hint</button>
        <button class="pill-button" data-ui="wall" type="button" hidden>Put a wall</button>
      </div>
      <div class="slots" data-ui="slots" hidden>
        <div class="slot" data-ui="hardware"><small>✋ Hardware</small><strong>?</strong></div>
        <span class="plus" aria-hidden="true">+</span>
        <div class="slot" data-ui="software"><small>✨ Software</small><strong>?</strong></div>
      </div>
      <div class="progress" data-ui="progress" aria-label="Badges"></div>
    </section>
    <section class="card" data-ui="card" hidden aria-live="assertive">
      <span class="card-icon" data-ui="cardIcon" aria-hidden="true"></span>
      <h2 data-ui="cardTitle"></h2>
      <span class="badge-earned" data-ui="cardBadge"></span>
      <p data-ui="cardMessage"></p>
      <small class="card-note" data-ui="cardNote"></small>
      <div class="card-buttons" data-ui="cardButtons"></div>
    </section>
    <div class="toast" data-ui="toast" role="status"></div>
    <div class="confetti" data-ui="confetti" aria-hidden="true"></div>`;

  let ui = null;

  function start(options) {
    const root = options.root;
    const mode = options.mode || "3d";
    const desk = window.TechDesk;
    root.classList.add("game-ui");
    root.innerHTML = MARKUP;
    const el = {};
    root.querySelectorAll("[data-ui]").forEach((node) => { el[node.dataset.ui] = node; });

    let state = "asleep";
    let index = 0;
    let filled = { hardware: false, software: false };
    let badges = 0;
    let hintsShown = 0;
    let lockedUntil = 0;
    let busy = false;
    let conditionDone = false;
    let wallOn = false;
    let cardAction = null;

    missions.concat([BONUS]).forEach(function (mission) {
      const chip = document.createElement("span");
      chip.textContent = mission.icon;
      chip.dataset.mission = mission.id;
      el.progress.appendChild(chip);
    });

    // "the mouse" / "The mouse"; a product name such as WeDo 2.0 stays as it is.
    function nameOf(id, capital) {
      const item = desk.items[id];
      return item.proper ? item.title : `${capital ? "The" : "the"} ${item.title.toLowerCase()}`;
    }

    function layout() {
      if (options.onLayout) options.onLayout(root.hidden ? 0 : el.mission.offsetHeight);
    }

    function setPanel(label, icon, text) {
      el.label.textContent = label;
      el.icon.textContent = icon;
      el.text.textContent = text;
      el.count.textContent = `${badges} / ${TOTAL} badges`;
      layout();
    }

    function setSlot(name, item) {
      const slot = el[name];
      slot.classList.toggle("filled", !!item);
      const text = slot.querySelector("strong");
      const image = item && desk.items[item.id].image;
      text.textContent = !item ? "?" : image ? item.title : `${item.icon} ${item.title}`;
      if (image) {
        const picture = document.createElement("img");
        picture.src = image;
        picture.alt = "";
        text.prepend(picture);
      }
    }

    function showMission() {
      const mission = missions[index];
      filled = { hardware: false, software: false };
      hintsShown = 0;
      setSlot("hardware", null);
      setSlot("software", null);
      el.slots.hidden = false;
      setPanel(`Mission ${index + 1} of ${missions.length}`, mission.icon, `${mission.prompt} Find the hardware and the software.`);
    }

    function showToast(message) {
      el.toast.textContent = message;
      el.toast.classList.add("show");
      clearTimeout(showToast.timer);
      showToast.timer = setTimeout(() => el.toast.classList.remove("show"), 2600);
    }

    function celebrate(amount) {
      const colors = ["#009fd6", "#003370", "#45e28b", "#f4c843", "#ef5c55", "#b6e02b"];
      for (let i = 0; i < amount; i += 1) {
        const piece = document.createElement("i");
        piece.style.left = `${Math.random() * 100}%`;
        piece.style.background = colors[i % colors.length];
        piece.style.setProperty("--drift", `${Math.round((Math.random() - .5) * 180)}px`);
        piece.style.animationDelay = `${Math.random() * .28}s`;
        el.confetti.appendChild(piece);
        window.setTimeout(() => piece.remove(), 1700);
      }
      if (navigator.vibrate) navigator.vibrate(60);
    }

    function earnBadge(mission) {
      badges += 1;
      desk.markFound(mission.id, mission.icon);
      const chip = el.progress.querySelector(`[data-mission="${mission.id}"]`);
      if (chip) chip.classList.add("found");
      el.count.textContent = `${badges} / ${TOTAL} badges`;
    }

    // buttons: [{ label, action }]. One button makes a "continue" card that the
    // whole card answers to, so a child who taps the text is not stuck. Two
    // buttons make a question; both look the same so the style gives no clue.
    function showCard(card) {
      el.cardIcon.textContent = card.icon;
      el.cardTitle.textContent = card.title;
      el.cardBadge.textContent = card.badge || "";
      el.cardBadge.hidden = !card.badge;
      el.cardMessage.textContent = card.message;
      el.cardNote.textContent = card.note || "";
      el.cardNote.hidden = !card.note;
      el.cardButtons.innerHTML = "";
      el.cardButtons.classList.toggle("choices", card.buttons.length > 1);
      card.buttons.forEach(function (button) {
        const node = document.createElement("button");
        node.type = "button";
        node.textContent = button.label;
        node.addEventListener("click", function (event) {
          event.stopPropagation();
          closeCard(button.action);
        });
        el.cardButtons.appendChild(node);
      });
      cardAction = card.buttons.length === 1 ? card.buttons[0].action : null;
      el.card.hidden = false;
    }

    function closeCard(action) {
      lockedUntil = performance.now() + 400;
      el.card.hidden = true;
      cardAction = null;
      if (action) action();
    }

    el.card.addEventListener("click", function () {
      if (cardAction) closeCard(cardAction);
    });

    // --- Step 1: the desk is asleep --------------------------------------------

    function askAboutPrograms(item) {
      showCard({
        icon: "😴",
        title: `${nameOf(item.id, true)} is not working!`,
        message: "The parts are here, but no program is running. Can the computer parts work without a program?",
        note: "Decide together, then tap!",
        buttons: [
          { label: "Yes", action: () => explainPrograms("🤔", "Let's check…", "We tapped it and nothing happened! Hardware needs software, the programs, to tell it what to do.") },
          { label: "No", action: () => explainPrograms("💡", "That's right!", "Hardware is the parts we can touch. It needs software, the programs, to tell it what to do.") }
        ]
      });
    }

    function explainPrograms(icon, title, message) {
      showCard({ icon, title, message, buttons: [{ label: "Wake up the programs!", action: wakeUp }] });
    }

    function wakeUp() {
      desk.wake();
      state = "missions";
      celebrate(10);
      showMission();
      showToast("Look up! The programs are flying out of the monitor.");
    }

    // --- Step 2: six "you need both" missions ----------------------------------

    function missionTap(item) {
      const mission = missions[index];
      const slot = item.id === mission.hardware ? "hardware" : item.id === mission.software ? "software" : null;
      const missing = filled.hardware ? "software" : "hardware";
      if (!slot) {
        desk.flashTarget(item.element, "#f7a83b");
        if ((filled.hardware || filled.software) && item.kind !== missing) {
          showToast(missing === "software"
            ? `${nameOf(item.id, true)} is hardware too. Now find the software: a program!`
            : `${nameOf(item.id, true)} is software too. Now find the hardware: a part you can touch!`);
        } else {
          showToast(`${nameOf(item.id, true)} is ${item.kind}, but it cannot help us ${mission.goal}. Keep looking!`);
        }
        return;
      }
      if (filled[slot]) {
        showToast(`You already have ${nameOf(item.id)}. Now find the ${missing}!`);
        return;
      }
      filled[slot] = true;
      setSlot(slot, item);
      desk.flashTarget(item.element, "#45e28b");
      desk.bounce(item.id);
      if (!(filled.hardware && filled.software)) {
        desk.sound("right");
        showToast(slot === "hardware"
          ? `Yes! ${nameOf(item.id, true)} is hardware: you can touch it. Now find the software!`
          : `Yes! ${nameOf(item.id, true)} is software: it is a program. Now find the hardware!`);
        layout();
        return;
      }

      // Let the children watch the pair work together before the card covers it.
      busy = true;
      desk.link(mission.hardware, mission.software);
      desk.play(mission.id);
      earnBadge(mission);
      celebrate(14);
      layout();
      window.setTimeout(function () {
        busy = false;
        const last = index === missions.length - 1;
        showCard({
          icon: mission.icon,
          title: mission.done,
          badge: `Badge earned: ${mission.badge}`,
          message: `${nameOf(mission.hardware, true)} is hardware. ${nameOf(mission.software, true)} is software. They work together!`,
          buttons: [{ label: last ? "One more thing…" : "Next mission", action: last ? askAboutCondition : nextMission }]
        });
      }, 1600);
    }

    function nextMission() {
      index += 1;
      showMission();
    }

    // --- Step 3: the condition from last session -------------------------------

    function askAboutCondition() {
      state = "question";
      el.slots.hidden = true;
      el.hint.hidden = true;
      setPanel("Bonus: conditions", "🤖", "Look at the robot's program.");
      showCard({
        icon: "🤖",
        title: "Do you remember conditions?",
        message: "Look at the robot's program. IF the sensor sees something, THEN the robot will…",
        note: "Decide together, then tap!",
        buttons: [
          { label: "Stop", action: () => explainTest("👍", "Good thinking! Let's test it.") },
          { label: "Keep going", action: () => explainTest("🤔", "Hmm… let's test it and see!") }
        ]
      });
    }

    function explainTest(icon, title) {
      showCard({
        icon,
        title,
        message: mode === "ar"
          ? "Walk slowly up to the robot so its sensor can see you. You can also tap Put a wall."
          : "Tap Put a wall to put something in front of the robot.",
        buttons: [{ label: "Test it", action: startTest }]
      });
    }

    function startTest() {
      state = "test";
      el.wall.hidden = false;
      setPanel("Bonus: conditions", "🚧", "IF the sensor sees something, THEN stop. Test it!");
      if (desk.roverSeeing()) conditionSeen();
    }

    function conditionSeen() {
      if (conditionDone) return;
      conditionDone = true;
      busy = true;
      window.setTimeout(function () {
        busy = false;
        earnBadge(BONUS);
        celebrate(14);
        showCard({
          icon: "🛑",
          title: "It stopped!",
          badge: `Badge earned: ${BONUS.badge}`,
          message: "IF the sensor sees something, THEN the robot stops and plays a sound. That is a condition!",
          buttons: [{ label: "Finish", action: finish }]
        });
      }, 1300);
    }

    function finish() {
      celebrate(30);
      showCard({
        icon: "🏆",
        title: "Hardware & Software Expert!",
        badge: `All ${TOTAL} badges collected`,
        message: "Hardware is what we touch. Software is a program we use. They need each other!",
        buttons: [{ label: "Keep exploring", action: function () {
          state = "free";
          setPanel("All done!", "🏆", "Tap anything to hear what it is, or test the robot again.");
        } }]
      });
    }

    document.addEventListener("desk-rover-sense", function (event) {
      if (state !== "test" && state !== "free") return;
      if (event.detail.seeing) {
        showToast("The sensor sees something: STOP!");
        if (state === "test") conditionSeen();
      } else {
        showToast("The sensor sees nothing now, so the robot drives again.");
      }
    });

    el.wall.addEventListener("click", function () {
      wallOn = !wallOn;
      desk.setWall(wallOn);
      el.wall.textContent = wallOn ? "Take the wall away" : "Put a wall";
      layout();
    });

    // --- Taps on the desk ------------------------------------------------------

    document.addEventListener("desk-item-select", function (event) {
      // Cards are modal: ignore desk taps while one is open and briefly after it
      // closes, so fast repeated taps cannot answer the next question by accident.
      if (!el.card.hidden || busy || performance.now() < lockedUntil) return;
      lockedUntil = performance.now() + 400;
      const item = event.detail;
      if (state === "asleep") {
        desk.flashTarget(item.element, "#f7a83b");
        askAboutPrograms(item);
      } else if (state === "missions") {
        missionTap(item);
      } else {
        desk.flashTarget(item.element, "#45e28b");
        desk.bounce(item.id);
        const label = desk.items[item.id].image ? item.title : `${item.icon} ${item.title}`;
        showToast(item.kind === "hardware"
          ? `${label}: hardware. You can touch it!`
          : `${label}: software. It is a program!`);
      }
    });

    // First tap reads the hint; the next taps make the right thing jump.
    el.hint.addEventListener("click", function () {
      if (state === "asleep") {
        showToast("Hint: tap the monitor, the keyboard or the mouse.");
        return;
      }
      if (state !== "missions" || busy) return;
      const mission = missions[index];
      const missing = filled.hardware ? "software" : "hardware";
      hintsShown += 1;
      if (hintsShown === 1) {
        showToast(`Hint: ${mission[missing + "Hint"]}`);
      } else {
        desk.bounce(mission[missing]);
        showToast("Look! Something is jumping. Tap it!");
      }
    });

    setPanel("Wake up the desk", "😴", "The desk is asleep. Tap a computer part to wake it up!");
    window.addEventListener("resize", layout);

    ui = { root, layout };
    return ui;
  }

  window.DeskGame = {
    start,
    missions,
    show: function (visible) {
      if (!ui) return;
      ui.root.hidden = !visible;
      ui.layout();
    }
  };
})();
