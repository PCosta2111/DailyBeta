import { GRIPS, LIMBS, TECHNIQUES, MAX_ENERGY, canMatchHands, dayKey, parseEndlessSeed } from "./rules.js";
import { holdIcon } from "./holds.js";
import { LIMB_KEYS, WORLD_WIDTH, length, point, solvePose } from "./rig.js";
import { V2_VERSION, SLING_GAIN, MAX_PULL, initialV2, suggestedPlacement, suggestedDynoForce, placementLabel, assessV2, attemptV2, undoV2, retryV2, restoreV2, migrateV2, dynoPlan, dynoPose, traceDyno, forceFromPull, describeV2, shareV2 } from "./engine.js";
import { transitionPose, flightPose, fallPose, settlePose } from "./motion.js";
import { generateV2Puzzle, generateV2EndlessPuzzle } from "./routes.js";

const $ = (selector) => document.querySelector(selector);
const wall = $("#wall");
const popup = $("#placement-popup");
const dynoPopup = $("#dyno-controls");
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
let seed = null;
let notice = "";
const parameter = new URL(location.href).searchParams.get("route");
if (parameter !== null) {
  try { seed = parseEndlessSeed(parameter); }
  catch (error) { console.warn("Invalid v2 route:", error); notice = `${error.message} Loaded the daily instead.`; }
}
const puzzle = seed === null ? generateV2Puzzle() : generateV2EndlessPuzzle(seed);
const storageKey = `daily-beta:physics-v${V2_VERSION}:${puzzle.key}`;
const lastSeedKey = "daily-beta:physics:last-seed";
const easyDynoKey = "daily-beta:physics:easy-dyno";
let state = initialV2(puzzle);
let selectedLimb = null;
let pending = null;
let drag = null;
let busy = false;
let dyno = false;
let easyDyno = false;
let catchLimb = "bothHands";
let targetHold = null;
let catchGrip = "open";
let currentPose = null;
let suppressClick = false;
let suggestionCache = null;
let solverWorker = null;
let optimalBeta = null;
let replayStates = [];
let replayStep = null;
let betaError = "";

try {
  const saved = localStorage.getItem(storageKey);
  if (saved) state = restoreV2(puzzle, JSON.parse(saved));
  else {
    const previous = localStorage.getItem(`daily-beta:physics-v2:${puzzle.key}`) ?? localStorage.getItem(`daily-beta:physics-v1:${puzzle.key}`);
    if (previous) {
      state = migrateV2(puzzle, JSON.parse(previous));
      notice = state.message.startsWith("Climber updated:") ? state.message : "Dyno catches updated. Your progress and counters are restored; the earlier save is kept separately.";
      save();
    }
  }
} catch (error) {
  console.warn("Could not restore v2 progress:", error);
  notice = "Couldn't restore progress. Starting fresh; the earlier save is kept separately.";
}
try {
  const preference = localStorage.getItem(easyDynoKey);
  if (preference !== null && preference !== "true" && preference !== "false") throw new Error("Invalid Easy dyno preference.");
  easyDyno = preference === "true";
} catch (error) { console.warn("Could not restore Easy dyno preference:", error); notice = "Couldn't restore Easy dyno preference. Guidance is off; you can switch it on below."; }
if (seed !== null) {
  try { localStorage.setItem(lastSeedKey, String(seed)); }
  catch (error) { console.warn("Could not remember v2 Endless seed:", error); notice = "Couldn't remember this Endless seed. Bookmark its URL to return to it."; }
}

function save() {
  try { localStorage.setItem(storageKey, JSON.stringify(state)); }
  catch (error) { console.warn("Could not save v2 progress:", error); notice = "Progress couldn't be saved on this device."; }
}

function showNotice(message) {
  notice = message;
  $("#notice").textContent = message;
  $("#notice").hidden = !message;
}

function routeUrl(route) {
  const url = new URL("./", location.href);
  if (route !== null) url.searchParams.set("route", String(route));
  return url.href;
}

function localPoint(event, rect = wall.getBoundingClientRect()) {
  return { x: (event.clientX - rect.left) / rect.width * WORLD_WIDTH, y: (event.clientY - rect.top) / rect.height * 100 };
}

function holdAt(position) {
  const rect = wall.getBoundingClientRect();
  const radius = 25 * WORLD_WIDTH / rect.width;
  return puzzle.holds.map((hold) => ({ hold, distance: length(position, point(hold)) })).filter(({ hold, distance }) => distance < (hold.grip === "chip" ? radius * 0.8 : radius)).sort((a, b) => a.distance - b.distance)[0]?.hold ?? null;
}

function handle(limb) { return $(`.limb-handle[data-limb="${limb}"]`); }

function displayState() { return replayStep === null ? state : replayStates[replayStep]; }

function drawPose(pose) {
  currentPose = pose;
  const pieces = [];
  const path = (className, a, b, c = null) => `<path class="${className}" d="M ${a.x} ${a.y} L ${b.x} ${b.y}${c ? ` L ${c.x} ${c.y}` : ""}"/>`;
  pieces.push(path("climber-body", pose.hips, pose.shoulders));
  pieces.push(path("climber-arm", pose.limbs.leftHand.base, pose.limbs.rightHand.base));
  pieces.push(path("climber-leg", pose.limbs.leftFoot.base, pose.limbs.rightFoot.base));
  for (const limb of LIMB_KEYS) {
    const bone = pose.limbs[limb];
    pieces.push(path(limb.endsWith("Hand") ? "climber-arm" : "climber-leg", bone.base, bone.joint, bone.end));
    pieces.push(`<circle class="joint" cx="${bone.joint.x}" cy="${bone.joint.y}" r=".7"/>`);
    if (limb.endsWith("Foot")) {
      const contact = pending?.limb === limb ? { technique: pending.technique } : displayState().contacts[limb];
      const rotation = contact.technique === "heel" ? -35 : contact.technique === "toe" ? 145 : 0;
      pieces.push(`<ellipse class="shoe" cx="${bone.end.x}" cy="${bone.end.y}" rx="1.65" ry=".7" transform="rotate(${rotation} ${bone.end.x} ${bone.end.y})"/>`);
    }
    const same = LIMB_KEYS.find((other) => other !== limb && length(pose.limbs[other].end, bone.end) < 5);
    const offset = same ? (limb.startsWith("left") ? -14 : 14) : 0;
    const element = handle(limb);
    element.style.left = `calc(${bone.end.x / WORLD_WIDTH * 100}% + ${offset}px)`;
    element.style.top = `${bone.end.y}%`;
    element.disabled = busy || state.status !== "climbing" || replayStep !== null;
    element.setAttribute("aria-pressed", String(selectedLimb === limb));
    element.dataset.catching = String(catchLimb === "bothHands" ? limb.endsWith("Hand") : limb === catchLimb);
    if (offset) {
      const end = { x: bone.end.x + offset / wall.clientWidth * WORLD_WIDTH, y: bone.end.y };
      pieces.push(path("handle-tether", bone.end, end));
    }
  }
  pieces.push(path("climber-arm", pose.shoulders, pose.head));
  pieces.push(`<g transform="translate(${pose.head.x} ${pose.head.y}) rotate(${pose.angle * 180 / Math.PI}) scale(1.12)"><circle r="1.9"/><path class="beanie" d="M -2 -.4 Q -2.4 -3.3 0 -3.3 Q 2.4 -3.3 2 -.4 Z"/><path class="beanie-brim" d="M -2.1 -.4 H 2.1"/><circle class="beanie" cx=".3" cy="-3.3" r=".6"/></g>`);
  $("#climber").innerHTML = pieces.join("");
}

function displayedPose() {
  const displayed = displayState();
  const pose = solvePose(puzzle, displayed.contacts);
  if (displayed.status === "fallen") return fallPose(pose, 1);
  if (!pending) return pose;
  const contacts = structuredClone(state.contacts);
  contacts[pending.limb] = { hold: pending.hold, technique: pending.technique };
  const otherFoot = pending.limb === "leftFoot" ? "rightFoot" : "leftFoot";
  if (pending.limb.endsWith("Foot") && puzzle.holds[pending.hold].size === "small" && contacts[otherFoot].hold === pending.hold) contacts[otherFoot] = { hold: null, technique: null };
  return solvePose(puzzle, contacts, pose.hips);
}

function updateHolds() {
  for (const hold of puzzle.holds) {
    const button = $(`.hold[data-id="${hold.id}"]`);
    button.classList.toggle("selected", pending?.hold === hold.id || (dyno && targetHold === hold.id));
    button.classList.toggle("drop-target", drag?.hold === hold.id);
    button.classList.toggle("beta-target", replayStep > 0 && optimalBeta.moves[replayStep - 1].hold === hold.id);
    const occupants = LIMB_KEYS.filter((limb) => displayState().contacts[limb].hold === hold.id).map((limb) => LIMBS[limb].short);
    button.querySelector(".contact-badges").textContent = occupants.join(" ");
    button.disabled = busy || state.status !== "climbing" || replayStep !== null;
    button.setAttribute("aria-pressed", String(pending?.hold === hold.id || (dyno && targetHold === hold.id)));
    button.setAttribute("aria-label", `Hold ${hold.id + 1}, ${hold.size} ${GRIPS[hold.grip].label}${canMatchHands(hold) ? ", two hands fit" : ""}${hold.kind === "finish" ? ", top" : ""}${occupants.length ? `, ${occupants.join(" and ")}` : ""}. ${dyno ? "Select as dyno target." : "Select a limb first, or drag a limb here."}`);
  }
}

function render() {
  showNotice(notice);
  wall.classList.toggle("busy", busy);
  wall.classList.toggle("aiming", dyno);
  $("#dyno-toggle").setAttribute("aria-pressed", String(dyno));
  $("#dyno-state").textContent = dyno ? "ON" : "OFF";
  $("#dyno-toggle").disabled = busy || state.status !== "climbing";
  $("#dyno-options").disabled = busy || !dyno || state.status !== "climbing";
  if (!dyno || busy || state.status !== "climbing") setDynoOptions(false);
  if (!dyno || !easyDyno || busy || replayStep !== null) $("#dyno-readout").hidden = true;
  $("#easy-dyno").checked = easyDyno;
  $("#easy-dyno").disabled = busy;
  $("#suggested-launch").hidden = !easyDyno;
  if (busy || targetHold === null) $("#suggested-launch").disabled = true;
  $("#interaction-hint").textContent = replayStep !== null ? "Beta replay. Your result is unchanged." : state.status !== "climbing" ? state.status === "sent" ? "Both hands on top." : "Back to the mats." : dyno ? targetHold === null ? "Both hands by default. Pick a target." : `${catchLimb === "bothHands" ? "Both hands" : LIMBS[catchLimb].short}: pull back, then release.` : selectedLimb ? `${LIMBS[selectedLimb].label}: drag or pick a hold.` : "Drag a hand or foot onto a hold.";
  $("#energy-value").textContent = `${state.energy} / ${MAX_ENERGY}`;
  $("#energy-fill").style.width = `${state.energy / MAX_ENERGY * 100}%`;
  $("#energy-track").setAttribute("aria-valuenow", String(state.energy));
  $("#move-count").textContent = String(state.moves.length);
  $("#fall-count").textContent = String(state.falls);
  $("#undo-count").textContent = String(state.undos);
  $("#undo-button").disabled = busy || state.status !== "climbing" || !state.moves.length;
  $("#retry-button").disabled = busy;
  $("#retry-button").textContent = state.status === "fallen" ? "Try again" : "Retry";
  $("#status-card").className = `status-card ${state.status}`;
  $("#status-title").textContent = state.status === "sent" ? "Problem sent." : state.status === "fallen" ? "Missed it." : "";
  $("#status-message").textContent = state.message;
  $("#result-actions").hidden = state.status === "climbing";
  $("#share-button").hidden = state.status !== "sent";
  $("#history-count").textContent = String(state.moves.length);
  $("#move-history").replaceChildren(...state.moves.map((move) => {
    const li = document.createElement("li");
    li.textContent = describeV2(move);
    return li;
  }));
  for (const button of document.querySelectorAll("[data-catch]")) {
    button.setAttribute("aria-pressed", String(button.dataset.catch === catchLimb));
    button.disabled = busy;
  }
  $("#dyno-grip").disabled = busy || targetHold === null;
  for (const element of [$("#launch-x"), $("#launch-y")]) element.disabled = busy;
  $("#launch-button").disabled = busy || targetHold === null;
  $("#next-route").disabled = busy;
  wall.classList.toggle("replaying", replayStep !== null);
  $("#wall-caption").textContent = replayStep === null ? "Snap, choose your placement, then set it." : "Replay only. Your attempt is unchanged.";
  $("#beta-wall-controls").hidden = replayStep === null;
  $("#reveal-beta").disabled = busy;
  if (replayStep !== null) {
    $("#beta-previous").disabled = busy || replayStep === 0;
    $("#beta-next").disabled = busy || replayStep === optimalBeta.moves.length;
    $("#beta-exit").disabled = busy;
    $("#beta-step-label").textContent = `${optimalBeta.optimal ? "OPTIMAL" : "VERIFIED"} BETA / ${replayStep === 0 ? "START" : `MOVE ${replayStep} OF ${optimalBeta.moves.length}`} / ${displayState().energy} ENERGY`;
    $("#beta-step-description").textContent = replayStep === 0 ? "Original starting stance. Your attempt is unchanged." : describeV2(displayState().moves.at(-1));
  }
  for (const button of $("#beta-sequence").querySelectorAll("button")) {
    button.disabled = busy;
    button.setAttribute("aria-pressed", String(Number(button.dataset.step) === replayStep));
  }
  updateHolds();
  if (!busy && !drag) drawPose(displayedPose());
}

function positionDynoOptions() {
  if (!dynoPopup.matches(":popover-open")) return;
  const viewport = visualViewport;
  const left = (viewport?.offsetLeft ?? 0) + 10, top = (viewport?.offsetTop ?? 0) + 10;
  const right = left + (viewport?.width ?? innerWidth) - 20, bottom = top + (viewport?.height ?? innerHeight) - 20;
  const button = $("#dyno-options").getBoundingClientRect(), wallRect = wall.getBoundingClientRect();
  dynoPopup.style.width = `${Math.min(300, right - left)}px`;
  dynoPopup.style.maxHeight = `${bottom - top}px`;
  const bounds = dynoPopup.getBoundingClientRect();
  const outside = wallRect.right + bounds.width + 14 <= right;
  const x = outside ? wallRect.right + 14 : button.right - bounds.width;
  const y = outside ? button.top : button.bottom + 8;
  dynoPopup.style.left = `${Math.max(left, Math.min(x, right - bounds.width))}px`;
  dynoPopup.style.top = `${Math.max(top, Math.min(y, bottom - bounds.height))}px`;
}

function setDynoOptions(open) {
  if (open && !dynoPopup.matches(":popover-open")) dynoPopup.showPopover();
  if (!open && dynoPopup.matches(":popover-open")) dynoPopup.hidePopover();
  $("#dyno-options").setAttribute("aria-expanded", String(open));
  if (open) positionDynoOptions();
}

function positionPopup() {
  if (!pending || !popup.matches(":popover-open")) return;
  const rect = $(`.hold[data-id="${pending.hold}"]`).getBoundingClientRect();
  const viewport = visualViewport;
  const leftEdge = (viewport?.offsetLeft ?? 0) + 10;
  const topEdge = (viewport?.offsetTop ?? 0) + 10;
  const right = leftEdge + (viewport?.width ?? innerWidth) - 20;
  const bottom = topEdge + (viewport?.height ?? innerHeight) - 20;
  if (rect.bottom < topEdge || rect.top > bottom) { cancelPlacement(false); return; }
  popup.style.width = `${Math.min(275, right - leftEdge)}px`;
  const height = $(".popup-content").scrollHeight + 2;
  const above = rect.top - topEdge - 12;
  const below = bottom - rect.bottom - 12;
  const up = above >= height || above > below;
  popup.style.maxHeight = `${Math.max(1, Math.min(height, up ? above : below))}px`;
  const bounds = popup.getBoundingClientRect();
  const center = (rect.left + rect.right) / 2;
  const left = Math.max(leftEdge, Math.min(center - bounds.width / 2, right - bounds.width));
  popup.style.left = `${left}px`;
  popup.style.top = `${Math.max(topEdge, Math.min(up ? rect.top - bounds.height - 12 : rect.bottom + 12, bottom - bounds.height))}px`;
  popup.dataset.placement = up ? "above" : "below";
  popup.style.setProperty("--pointer-x", `${Math.max(16, Math.min(bounds.width - 16, center - left))}px`);
}

function cancelPlacement(focus = true) {
  const limb = pending?.limb ?? selectedLimb;
  popup.hidePopover();
  pending = null;
  selectedLimb = null;
  render();
  if (focus && limb) handle(limb).focus({ preventScroll: true });
}

function renderPlacement() {
  const hold = puzzle.holds[pending.hold];
  $("#placement-title").textContent = `${LIMBS[pending.limb].short} / #${hold.id + 1} ${GRIPS[hold.grip].label}`;
  const preview = assessV2(puzzle, state, pending);
  $("#placement-preview").dataset.outcome = preview.outcome;
  $("#placement-outcome").textContent = preview.outcome === "safe" ? `Supported / ${preview.cost} energy` : preview.outcome === "fall" ? "Will fall" : "Choose another placement";
  $("#placement-reason").textContent = preview.reason;
  $("#set-placement").textContent = preview.outcome === "fall" ? "Set anyway: will fall" : "Set placement";
  $("#set-placement").disabled = preview.outcome === "invalid";
  $("#set-placement").classList.toggle("risky", preview.outcome === "fall");
  for (const button of $("#placement-options").children) button.setAttribute("aria-pressed", String(button.dataset.technique === pending.technique));
  render();
  positionPopup();
}

function openPlacement(limb, hold, offset = 0) {
  pending = { limb, hold: hold.id, technique: suggestedPlacement(hold, limb, offset), mode: "static" };
  selectedLimb = limb;
  const techniques = Object.keys(TECHNIQUES).filter((name) => TECHNIQUES[name].type === LIMBS[limb].type);
  $("#placement-options").replaceChildren(...techniques.map((technique) => {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.technique = technique;
    button.textContent = placementLabel(technique);
    button.title = TECHNIQUES[technique].description;
    button.disabled = limb.endsWith("Hand") ? !GRIPS[hold.grip].hands.includes(technique) : technique !== "stand" && !GRIPS[hold.grip].hooks.includes(technique);
    button.addEventListener("click", () => { pending.technique = technique; renderPlacement(); });
    return button;
  }));
  renderPlacement();
  $(".popup-content").scrollTop = 0;
  if (!popup.matches(":popover-open")) popup.showPopover();
  positionPopup();
  const focus = $(`#placement-options [data-technique="${pending.technique}"]`);
  (focus.disabled ? $("#cancel-placement") : focus).focus({ preventScroll: true });
}

function dynoAction(force) {
  return { limb: catchLimb, hold: targetHold, technique: catchGrip, mode: "dyno", force };
}

function recommendedForce() {
  if (!suggestionCache || suggestionCache.state !== state || suggestionCache.limb !== catchLimb || suggestionCache.hold !== targetHold || suggestionCache.grip !== catchGrip) {
    suggestionCache = { state, limb: catchLimb, hold: targetHold, grip: catchGrip, force: suggestedDynoForce(puzzle, state, catchLimb, targetHold, catchGrip) };
  }
  return suggestionCache.force;
}

function clearAim(guide = true) {
  $("#aim-overlay").replaceChildren();
  $("#dyno-readout").hidden = true;
  $("#force-feedback").textContent = "Pull farther for more power. The short arrow shows direction only. Release to jump; Escape cancels.";
  delete $("#force-feedback").dataset.outcome;
  if (guide && easyDyno && dyno && targetHold !== null && state.status === "climbing" && !busy) drawAim(recommendedForce() ?? dynoPlan(puzzle, state, catchLimb, targetHold).velocity, true);
}

function drawAim(force, suggested = false) {
  const plan = dynoPlan(puzzle, state, catchLimb, targetHold);
  const magnitude = Math.hypot(force.x, force.y);
  if (magnitude < 0.01 && !easyDyno) { clearAim(false); return; }
  const scale = magnitude > 0 ? 30 * WORLD_WIDTH / wall.clientWidth / magnitude : 0;
  const tip = { x: plan.origin.x + force.x * scale, y: plan.origin.y + force.y * scale };
  const angle = Math.atan2(force.y, force.x);
  const head = 7 * WORLD_WIDTH / wall.clientWidth;
  $("#aim-overlay").innerHTML = `<line class="force-arrow" x1="${plan.origin.x}" y1="${plan.origin.y}" x2="${tip.x}" y2="${tip.y}"/><path class="force-arrow" d="M ${tip.x - Math.cos(angle - 0.5) * head} ${tip.y - Math.sin(angle - 0.5) * head} L ${tip.x} ${tip.y} L ${tip.x - Math.cos(angle + 0.5) * head} ${tip.y - Math.sin(angle + 0.5) * head}"/>`;
  $("#force-feedback").textContent = "Direction set. More pull gives more power. Release to jump; Escape cancels.";
  if (easyDyno) {
    const preview = assessV2(puzzle, state, dynoAction(force));
    const flight = preview.flight ?? traceDyno(plan, force);
    const samples = Array.from({ length: 45 }, (_, i) => dynoPose(plan, force, flight.time * i / 44));
    const paths = plan.catching.map((limb) => `<path class="easy-trajectory" d="${samples.map((pose, i) => `${i ? "L" : "M"} ${pose.limbs[limb].end.x} ${pose.limbs[limb].end.y}`).join(" ")}"/>`).join("");
    $("#aim-overlay").insertAdjacentHTML("beforeend", `<defs><clipPath id="flight-guide-clip"><rect width="82" height="100"/></clipPath></defs><g class="easy-guide" data-outcome="${preview.outcome}" clip-path="url(#flight-guide-clip)">${paths}<circle class="easy-catch" cx="${plan.target.x}" cy="${plan.target.y}" r="${plan.radius}"/></g>`);
    const percent = (velocity) => Math.round(Math.hypot(velocity.x, velocity.y) / (MAX_PULL * SLING_GAIN) * 100);
    $("#force-feedback").dataset.outcome = preview.outcome;
    const recommendation = recommendedForce();
    const label = recommendation ? `Suggested ${percent(recommendation)}% power.` : "No suggested launch found.";
    $("#force-feedback").textContent = `${label} ${suggested ? "Preview" : "Your pull"}: ${percent(force)}%. ${preview.reason}`;
    $("#dyno-readout").textContent = `${label} ${suggested ? "Preview" : "Your pull"} ${percent(force)}%: ${preview.outcome === "safe" ? "catch" : "miss"}.`;
    $("#dyno-readout").dataset.outcome = preview.outcome;
    $("#dyno-readout").hidden = false;
    $("#suggested-launch").disabled = !recommendation;
  }
}

function pickTarget(hold) {
  stopDrag();
  targetHold = hold.id;
  catchGrip = suggestedPlacement(hold, "leftHand");
  $("#dyno-target").textContent = `Target #${hold.id + 1} / ${GRIPS[hold.grip].label}`;
  const choices = GRIPS[hold.grip].hands;
  $("#dyno-grip").replaceChildren(...(choices.length ? choices : ["open"]).map((name) => {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = TECHNIQUES[name].label;
    return option;
  }));
  $("#dyno-grip").value = catchGrip;
  clearAim();
  setDynoOptions(false);
  render();
  if (!choices.length) $("#force-feedback").textContent = "Feet-only hold: a hand catch will slip. Choose a handhold.";
}

function toggleDyno() {
  if (busy || state.status !== "climbing") return;
  stopDrag();
  if (pending) cancelPlacement(false);
  selectedLimb = null;
  dyno = !dyno;
  setDynoOptions(false);
  clearAim();
  render();
  if (dyno) $("#dyno-target").textContent = targetHold === null ? "Pick a target on the wall" : `Target #${targetHold + 1} / ${GRIPS[puzzle.holds[targetHold].grip].label}`;
}

function stopDrag() {
  if (!drag) return;
  const element = handle(drag.limb);
  const pointerId = drag.pointerId;
  drag = null;
  wall.classList.remove("dragging");
  if (element.hasPointerCapture(pointerId)) element.releasePointerCapture(pointerId);
}

function cancelInteraction() {
  stopDrag();
  clearAim();
  if (pending) cancelPlacement();
  else { selectedLimb = null; render(); }
}

function onPointerDown(event, limb) {
  if (busy || state.status !== "climbing" || event.button !== 0 || !event.isPrimary || drag) return;
  if (pending) cancelPlacement(false);
  if (dyno && (targetHold === null || (catchLimb !== "bothHands" && catchLimb !== limb) || limb.endsWith("Foot"))) {
    $("#interaction-hint").textContent = targetHold === null ? "Pick a target hold before pulling." : "Pull one of the selected catching hands.";
    return;
  }
  event.preventDefault();
  const rect = wall.getBoundingClientRect();
  const start = localPoint(event, rect);
  drag = { limb, pointerId: event.pointerId, rect, start, position: start, moved: false, hold: null };
  selectedLimb = limb;
  handle(limb).setPointerCapture(event.pointerId);
  handle(limb).focus({ preventScroll: true });
  render();
}

function onPointerMove(event) {
  if (!drag || drag.pointerId !== event.pointerId) return;
  event.preventDefault();
  drag.position = localPoint(event, dyno ? drag.rect : undefined);
  if (length(drag.start, drag.position) > 0.7) drag.moved = true;
  if (!drag.moved) return;
  wall.classList.add("dragging");
  if (dyno) {
    const force = forceFromPull(drag.start, drag.position);
    drawAim(force);
    const pose = solvePose(puzzle, state.contacts);
    const pull = { x: -force.x / SLING_GAIN * 0.12, y: -force.y / SLING_GAIN * 0.12 };
    drawPose(solvePose(puzzle, state.contacts, { x: pose.hips.x + pull.x, y: pose.hips.y + pull.y }));
  } else {
    const hold = holdAt(drag.position);
    drag.hold = hold?.id ?? null;
    const contacts = structuredClone(state.contacts);
    contacts[drag.limb] = { hold: null, technique: null };
    const target = hold ? point(hold) : drag.position;
    drawPose(solvePose(puzzle, contacts, null, { [drag.limb]: target }));
    updateHolds();
  }
}

function onPointerUp(event) {
  if (!drag || drag.pointerId !== event.pointerId) return;
  const gesture = drag;
  const position = localPoint(event, dyno ? gesture.rect : undefined);
  const force = dyno ? forceFromPull(gesture.start, position) : null;
  stopDrag();
  suppressClick = true;
  setTimeout(() => { suppressClick = false; }, 0);
  if (!gesture.moved) { render(); return; }
  if (dyno) perform(dynoAction(force));
  else {
    const hold = holdAt(position);
    if (hold) {
      // Open after the release's native light-dismiss processing.
      setTimeout(() => {
        if (!busy && state.status === "climbing" && selectedLimb === gesture.limb) openPlacement(gesture.limb, hold, position.y - hold.y);
      }, 0);
    }
    else { selectedLimb = null; render(); $("#interaction-hint").textContent = "No hold there. The limb returns to its previous contact."; }
  }
}

function animate(duration, frame) {
  if (reducedMotion.matches) { frame(1); return Promise.resolve(); }
  return new Promise((resolve, reject) => {
    const start = performance.now();
    function tick(now) {
      const progress = Math.min(1, (now - start) / duration);
      try { frame(progress); }
      catch (error) { reject(error); return; }
      if (progress < 1) requestAnimationFrame(tick);
      else resolve();
    }
    requestAnimationFrame(tick);
  });
}

async function animateMove(before, after, action, preview) {
  const start = solvePose(puzzle, before.contacts);
  if (action.mode === "dyno") {
    const flight = preview?.flight ?? traceDyno(dynoPlan(puzzle, before, action.limb, action.hold), action.force);
    await animate(Math.min(2200, Math.max(350, flight.time * 1000)), (t) => drawPose(flightPose(puzzle, before, action, t, flight)));
    if (after.status === "fallen") {
      const miss = currentPose;
      await animate(650, (t) => drawPose(fallPose(miss, t)));
    } else {
      const catchPose = currentPose;
      const finish = solvePose(puzzle, after.contacts);
      await animate(400, (t) => drawPose(settlePose(catchPose, finish, t)));
    }
  } else if (after.status === "fallen") await animate(800, (t) => drawPose(fallPose(start, t)));
  else await animate(450, (t) => drawPose(transitionPose(puzzle, before, after, t)));
}

async function perform(action) {
  if (busy || state.status !== "climbing") return;
  const preview = assessV2(puzzle, state, action);
  if (preview.outcome === "invalid") {
    if (dyno) $("#force-feedback").textContent = preview.reason;
    else showNotice(preview.reason);
    return;
  }
  const before = state;
  if (pending) cancelPlacement(false);
  selectedLimb = null;
  clearAim(false);
  busy = true;
  state = attemptV2(puzzle, state, action);
  save();
  render();
  try {
    await animateMove(before, state, action, preview);
  } catch (error) {
    console.error("Could not animate v2 move:", error);
    showNotice("The animation couldn't finish. Your move is saved; the wall has been reset to that result.");
  } finally {
    busy = false;
    if (state.status !== "climbing") dyno = false;
    render();
    if (state.status === "fallen") $("#retry-button").focus({ preventScroll: true });
    else if (state.status === "sent") $("#share-button").focus({ preventScroll: true });
    else handle(action.limb === "bothHands" ? "leftHand" : action.limb).focus({ preventScroll: true });
  }
}

function hideBeta() {
  solverWorker?.terminate();
  solverWorker = null;
  replayStep = null;
  betaError = "";
  $("#beta-content").hidden = true;
  $("#reveal-beta").textContent = "Show optimal beta";
}

async function watchBeta(step) {
  if (busy || !optimalBeta || state.status === "climbing") return;
  const entering = replayStep === null;
  const before = entering ? null : displayState();
  const previousStep = replayStep;
  replayStep = Math.max(0, Math.min(step, optimalBeta.moves.length));
  clearAim(false);
  dyno = false;
  if (entering) {
    render();
    $("#beta-wall-controls").scrollIntoView({ block: "start" });
    return;
  }
  if (replayStep === previousStep + 1) {
    busy = true;
    render();
    try { await animateMove(before, displayState(), optimalBeta.moves[replayStep - 1]); }
    catch (error) { console.error("Could not animate v2 beta:", error); showNotice("The beta animation couldn't finish. The replay is at the selected stance; your attempt is unchanged."); }
    finally { busy = false; }
  }
  render();
}

function showBeta() {
  $("#beta-summary").textContent = `${optimalBeta.moves.length} moves / ${MAX_ENERGY - optimalBeta.energy} energy used. ${optimalBeta.optimal ? "Proven fewest moves, then lowest energy, using v2 reach and actual hand catches." : `Optimality couldn't be proved for a launch at the ${optimalBeta.lowerBound}-move lower bound. This is a checked beta, not a proven optimum.`} Your attempt and save are unchanged.`;
  $("#beta-playback").hidden = false;
  $("#reveal-beta").textContent = "Hide beta";
  $("#beta-sequence").replaceChildren(...replayStates.slice(1).map((step, index) => {
    const item = document.createElement("li"), button = document.createElement("button");
    button.type = "button";
    button.dataset.step = String(index + 1);
    button.setAttribute("aria-pressed", "false");
    button.textContent = describeV2(step.moves.at(-1));
    button.addEventListener("click", () => watchBeta(index + 1));
    item.append(button);
    return item;
  }));
}

function failBeta(error) {
  console.error("Could not reveal v2 optimal beta:", error);
  solverWorker?.terminate();
  solverWorker = null;
  betaError = "Couldn't calculate the v2 beta. Try again.";
  $("#beta-summary").textContent = betaError;
  $("#reveal-beta").textContent = "Retry optimal beta";
}

for (const hold of puzzle.holds) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `hold hold-${hold.grip} hold-${hold.kind} hold-${hold.size}`;
  button.style.left = `${hold.x}%`;
  button.style.top = `${hold.y}%`;
  button.dataset.id = String(hold.id);
  button.innerHTML = `${holdIcon(hold.grip)}<span class="hold-label">${hold.kind === "finish" ? "TOP" : String(hold.id + 1).padStart(2, "0")} ${GRIPS[hold.grip].label.toUpperCase()}${canMatchHands(hold) ? " 2H" : ""}</span><span class="contact-badges"></span>`;
  button.addEventListener("click", () => {
    if (busy || suppressClick || state.status !== "climbing") return;
    if (dyno) pickTarget(hold);
    else if (selectedLimb) openPlacement(selectedLimb, hold);
    else $("#interaction-hint").textContent = "Grab an LH, RH, LF or RF handle first.";
  });
  $("#holds").append(button);
}
for (const limb of LIMB_KEYS) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "limb-handle";
  button.dataset.limb = limb;
  button.textContent = LIMBS[limb].short;
  button.setAttribute("aria-label", `${LIMBS[limb].label}. Drag onto a hold, or select then choose a hold.`);
  button.setAttribute("aria-pressed", "false");
  button.addEventListener("pointerdown", (event) => onPointerDown(event, limb));
  button.addEventListener("pointermove", onPointerMove);
  button.addEventListener("pointerup", onPointerUp);
  button.addEventListener("pointercancel", cancelInteraction);
  button.addEventListener("lostpointercapture", () => { if (drag) cancelInteraction(); });
  button.addEventListener("click", () => {
    if (suppressClick || busy || dyno || state.status !== "climbing") return;
    selectedLimb = selectedLimb === limb ? null : limb;
    render();
  });
  $("#limb-handles").append(button);
}

$("#daily-link").href = routeUrl(null);
$("#endless-link").href = routeUrl(seed ?? 1);
$(seed === null ? "#daily-link" : "#endless-link").setAttribute("aria-current", "page");
if (seed === null) {
  try {
    const previous = localStorage.getItem(lastSeedKey);
    if (previous !== null) $("#endless-link").href = routeUrl(parseEndlessSeed(previous));
  } catch (error) { console.warn("Could not resume v2 Endless:", error); showNotice("Couldn't resume the last v2 route. Endless starts at seed 1."); }
}
if (parameter !== null && seed === null) history.replaceState(null, "", routeUrl(null));
$("#problem-label").textContent = seed === null ? `DAILY #${puzzle.number}` : `ENDLESS #${seed}`;
$("#puzzle-name").textContent = puzzle.name;
$("#puzzle-note").textContent = puzzle.note;
document.title = `${seed === null ? `Daily ${puzzle.dateKey}` : `Endless #${seed}`} | Daily Beta v2.0`;
$("#wall-label").textContent = `BETA v2.0 / ${seed === null ? puzzle.dateKey : `SEED ${seed}`}`;
$("#next-route").hidden = seed === null;
$("#route-options").hidden = seed === null;
$("#route-seed").value = String(seed ?? 1);
$("#route-seed-form").addEventListener("submit", (event) => {
  event.preventDefault();
  if (busy) return;
  try { location.assign(routeUrl(parseEndlessSeed($("#route-seed").value.trim()))); }
  catch (error) { console.warn("Invalid v2 route seed:", error); showNotice(error.message); }
});
$("#next-route").addEventListener("click", () => location.assign(routeUrl(seed === 0xffffffff ? 1 : seed + 1)));
$("#cancel-placement").addEventListener("click", () => cancelPlacement());
popup.addEventListener("toggle", (event) => {
  if (event.newState === "closed" && !popup.matches(":popover-open") && pending) cancelPlacement();
});
$("#set-placement").addEventListener("click", () => { if (pending) perform({ ...pending }); });
$("#dyno-toggle").addEventListener("click", toggleDyno);
$("#dyno-options").addEventListener("click", () => setDynoOptions(!dynoPopup.matches(":popover-open")));
$("#close-dyno-options").addEventListener("click", () => { setDynoOptions(false); $("#dyno-options").focus({ preventScroll: true }); });
$("#easy-dyno").addEventListener("change", () => {
  stopDrag();
  easyDyno = $("#easy-dyno").checked;
  try { localStorage.setItem(easyDynoKey, String(easyDyno)); }
  catch (error) { console.warn("Could not save Easy dyno preference:", error); showNotice("Easy dyno changed, but this device couldn't remember the preference."); }
  clearAim();
  render();
});
$("#suggested-launch").addEventListener("click", () => {
  if (busy || !easyDyno || targetHold === null) return;
  stopDrag();
  const force = recommendedForce();
  if (!force) { showNotice("Couldn't find a supported launch. Reposition your feet or choose another target."); return; }
  $("#launch-x").value = String(force.x);
  $("#launch-y").value = String(-force.y);
  $(".keyboard-launch").open = true;
  drawAim(sliderForce());
  $("#launch-button").focus({ preventScroll: true });
});
for (const button of document.querySelectorAll("[data-catch]")) button.addEventListener("click", () => {
  stopDrag();
  selectedLimb = null;
  catchLimb = button.dataset.catch;
  clearAim();
  render();
});
$("#dyno-grip").addEventListener("change", () => { stopDrag(); catchGrip = $("#dyno-grip").value; clearAim(); render(); });
function sliderForce() {
  const force = { x: Number($("#launch-x").value), y: -Number($("#launch-y").value) };
  const size = Math.hypot(force.x, force.y);
  return size > MAX_PULL * SLING_GAIN ? { x: force.x * MAX_PULL * SLING_GAIN / size, y: force.y * MAX_PULL * SLING_GAIN / size } : force;
}
for (const id of ["#launch-x", "#launch-y"]) $(id).addEventListener("input", () => { if (targetHold !== null) drawAim(sliderForce()); });
$("#launch-button").addEventListener("click", () => { if (targetHold !== null) perform(dynoAction(sliderForce())); });
$("#undo-button").addEventListener("click", async () => {
  if (busy) return;
  cancelInteraction();
  const before = state;
  state = undoV2(puzzle, state);
  save();
  busy = true;
  render();
  try { await animate(350, (t) => drawPose(transitionPose(puzzle, before, state, t))); }
  catch (error) { console.error("Could not animate v2 undo:", error); showNotice("The undo animation couldn't finish. Your undone position is saved."); }
  finally { busy = false; render(); }
});
$("#retry-button").addEventListener("click", () => {
  if (busy) return;
  cancelInteraction();
  hideBeta();
  dyno = false;
  state = retryV2(puzzle, state);
  $("#share-result").hidden = true;
  save();
  render();
  handle("leftHand").focus({ preventScroll: true });
});
$("#reveal-beta").addEventListener("click", () => {
  if (busy || state.status === "climbing") return;
  if (!$("#beta-content").hidden && !betaError) { hideBeta(); render(); return; }
  $("#beta-content").hidden = false;
  betaError = "";
  if (optimalBeta) { showBeta(); return; }
  $("#beta-playback").hidden = true;
  $("#beta-summary").textContent = "Finding the fewest-move v2 beta, then comparing energy and verifying launch forces...";
  $("#reveal-beta").textContent = "Cancel calculation";
  try {
    const worker = new Worker(new URL("./solver-worker.js", import.meta.url), { type: "module" });
    solverWorker = worker;
    worker.onmessage = ({ data }) => {
      if (solverWorker !== worker) return;
      if (data.error) { failBeta(new Error(data.error)); return; }
      if (data.progress) { $("#beta-summary").textContent = `Searching v2 stances: ${data.progress.expanded.toLocaleString()} checked. Current lower bound: ${data.progress.lowerBound} moves.`; return; }
      try {
        const steps = [initialV2(puzzle)];
        for (const move of data.result.moves) {
          if (assessV2(puzzle, steps.at(-1), move).outcome !== "safe") throw new Error("Invalid v2 beta move.");
          steps.push(attemptV2(puzzle, steps.at(-1), move));
        }
        if (steps.at(-1).status !== "sent" || steps.at(-1).energy !== data.result.energy) throw new Error("Invalid v2 beta result.");
        optimalBeta = data.result;
        replayStates = steps;
        worker.terminate();
        solverWorker = null;
        showBeta();
      } catch (error) { failBeta(error); }
    };
    worker.onerror = (event) => { if (solverWorker === worker) { event.preventDefault(); failBeta(new Error(event.message)); } };
    worker.postMessage(puzzle);
  } catch (error) { failBeta(error); }
});
$("#watch-beta").addEventListener("click", () => watchBeta(0));
$("#beta-previous").addEventListener("click", () => watchBeta(replayStep - 1));
$("#beta-next").addEventListener("click", () => watchBeta(replayStep + 1));
$("#beta-exit").addEventListener("click", () => { if (!busy) { replayStep = null; render(); $("#watch-beta").focus({ preventScroll: true }); } });
$("#share-button").addEventListener("click", async () => {
  const text = shareV2(puzzle, state, routeUrl(seed));
  function manualCopy() {
    $("#share-result").hidden = false;
    $("#share-text").value = text;
    $("#share-text").focus();
    $("#share-text").select();
  }
  try {
    if (navigator.share) await navigator.share({ text });
    else if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); showNotice("Result copied."); }
    else manualCopy();
  } catch (error) {
    if (error.name !== "AbortError") { console.warn("Could not share v2 result:", error); showNotice("Automatic sharing failed. Copy the selected result below."); manualCopy(); }
  }
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !busy) {
    if (replayStep !== null) { replayStep = null; render(); }
    else if (dynoPopup.matches(":popover-open") && !drag) { setDynoOptions(false); $("#dyno-options").focus({ preventScroll: true }); }
    else cancelInteraction();
    return;
  }
  if (event.ctrlKey || event.metaKey || event.altKey || event.repeat || busy || ["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement.tagName)) return;
  const limb = { "1": "leftHand", "2": "rightHand", "3": "leftFoot", "4": "rightFoot" }[event.key];
  if (limb && !dyno && state.status === "climbing") {
    event.preventDefault();
    stopDrag();
    if (pending) cancelPlacement(false);
    selectedLimb = limb;
    render();
    handle(limb).focus({ preventScroll: true });
  }
  if (event.key.toLowerCase() === "d") { event.preventDefault(); toggleDyno(); }
  if (event.key.toLowerCase() === "z") { event.preventDefault(); $("#undo-button").click(); }
});
window.addEventListener("blur", () => { if (drag) cancelInteraction(); });
function positionOverlays() { positionPopup(); positionDynoOptions(); }
new ResizeObserver(positionDynoOptions).observe(dynoPopup);
window.addEventListener("resize", () => { if (drag) cancelInteraction(); positionOverlays(); if (!busy) drawPose(displayedPose()); });
window.addEventListener("scroll", positionOverlays, { passive: true, capture: true });
visualViewport?.addEventListener("resize", positionOverlays);
visualViewport?.addEventListener("scroll", positionOverlays);
window.addEventListener("pagehide", () => { solverWorker?.terminate(); });
if (seed === null) {
  const midnight = Date.parse(`${dayKey(new Date(Date.now() + 86400000))}T00:00:00Z`);
  setTimeout(() => showNotice("A new daily boulder is available. Reload to play it."), midnight - Date.now() + 1000);
}
render();
