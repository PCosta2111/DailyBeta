import { GRIPS, LIMBS, TECHNIQUES, MAX_ENERGY, assessMove, attemptMove, initialState } from "./rules.js";
import { BONES, WORLD_WIDTH, length, limit, makePose, mix, point, solvePose } from "./rig.js";

export const V2_VERSION = 3;
const legacyBones = Object.freeze({ upperArm: 10.5, forearm: 10.5, thigh: 11, shin: 11, torso: 10, neck: 3.5 });
const recordedFallMessage = "This fall was recorded with the previous climber proportions. Retry to climb with the shorter limbs.";
export const FLIGHT_TIME = 0.65;
export const GRAVITY = 32;
export const SLING_GAIN = 3;
export const MAX_PULL = 34;
export const MAX_FLIGHT_TIME = 3.8;
export const ARM_RAISE_TIME = 0.18;
export const RISING_CATCH_SPEED = 42;
export const FALLING_CATCH_SPEED = 64;
export const placementLabel = (technique) => technique === "stand" ? "Toe tap / stand" : TECHNIQUES[technique].label;

export function initialV2(puzzle) {
  return { ...initialState(puzzle), version: V2_VERSION, edition: "v2", message: "Drag a hand or foot onto a hold. Choose its placement after it snaps." };
}

export function suggestedPlacement(hold, limb, verticalOffset = 0) {
  const grip = GRIPS[hold.grip];
  if (limb.endsWith("Hand")) return grip.hands[0] ?? "open";
  if (verticalOffset < -0.6 && grip.hooks.includes("heel")) return "heel";
  if (verticalOffset > 0.6 && grip.hooks.includes("toe")) return "toe";
  return "stand";
}

export function dynoPlan(puzzle, state, limb, holdId) {
  if (!["leftHand", "rightHand", "bothHands"].includes(limb) || !puzzle.holds[holdId]) throw new Error("Choose a hand and a target hold for the dyno.");
  return planFromPose(puzzle, solvePose(puzzle, state.contacts), limb, holdId);
}

function planFromPose(puzzle, pose, limb, holdId, revision = V2_VERSION) {
  const origin = limb === "bothHands" ? mix(pose.limbs.leftHand.end, pose.limbs.rightHand.end, 0.5) : pose.limbs[limb].end;
  const target = point(puzzle.holds[holdId]);
  const reference = revision < 3 ? origin : pose.hips;
  const aim = revision < 3 ? target : { x: target.x - (limb === "leftHand" ? -2 : limb === "rightHand" ? 2 : 0), y: target.y + BONES.torso + (BONES.upperArm + BONES.forearm) * 0.9 };
  const velocity = { x: (aim.x - reference.x) / FLIGHT_TIME, y: (aim.y - reference.y) / FLIGHT_TIME - GRAVITY * FLIGHT_TIME / 2 };
  if (revision >= 3) velocity.y = Math.min(-12, velocity.y);
  const large = puzzle.holds[holdId].size === "large";
  return { origin, target, aim, velocity, pull: { x: -velocity.x / SLING_GAIN, y: -velocity.y / SLING_GAIN }, radius: revision < 3 ? large ? 2.5 : 1.6 : large ? 3 : 2, start: pose, limb, catching: limb === "bothHands" ? ["leftHand", "rightHand"] : [limb] };
}

export function shotPoint(plan, force, time) {
  return { x: plan.origin.x + force.x * time, y: plan.origin.y + force.y * time + GRAVITY * time * time / 2 };
}

export function forceFromPull(start, end) {
  const distance = length(start, end);
  const scale = distance > MAX_PULL ? MAX_PULL / distance : 1;
  return { x: (start.x - end.x) * scale * SLING_GAIN, y: (start.y - end.y) * scale * SLING_GAIN };
}

export function dynoPose(plan, force, time) {
  const start = plan.start;
  const reach = BONES.upperArm + BONES.forearm - 0.00001;
  let hips = { x: start.hips.x + force.x * time, y: start.hips.y + force.y * time + GRAVITY * time * time / 2 };
  const angle = start.angle * Math.exp(-time * 3) + Math.max(-0.2, Math.min(0.2, force.x / 100)) * Math.sin(Math.min(1, time / MAX_FLIGHT_TIME) * Math.PI);
  let body = makePose(hips, angle);
  const targets = {};
  if (plan.limb !== "bothHands") {
    const other = plan.limb === "leftHand" ? "rightHand" : "leftHand";
    const anchor = start.limbs[other].end;
    const base = body.limbs[other].base;
    const center = { x: anchor.x - base.x + hips.x, y: anchor.y - base.y + hips.y };
    hips = limit(center, hips, reach);
    body = makePose(hips, angle);
    targets[other] = anchor;
  }
  const raised = Math.min(1, time / ARM_RAISE_TIME);
  const blend = raised * raised * (3 - 2 * raised);
  for (const limb of plan.catching) {
    const base = body.limbs[limb].base;
    const goal = { x: plan.target.x + (plan.limb === "bothHands" ? limb === "leftHand" ? -1.2 : 1.2 : 0), y: plan.target.y };
    const inFront = goal.y <= base.y - 2;
    const direction = { x: goal.x - base.x, y: inFront ? goal.y - base.y : Math.min(-6, goal.y - base.y) };
    const distance = Math.hypot(direction.x, direction.y);
    const extension = inFront ? Math.min(reach, distance) : reach;
    const extended = { x: base.x + direction.x / distance * extension, y: base.y + direction.y / distance * extension };
    const resting = { x: base.x + start.limbs[limb].end.x - start.limbs[limb].base.x, y: base.y + start.limbs[limb].end.y - start.limbs[limb].base.y };
    targets[limb] = mix(resting, extended, blend);
  }
  return makePose(hips, angle, targets, Math.sin(time * 6) * 0.5);
}

function contactInterval(from, to, target, radius) {
  const dx = to.x - from.x, dy = to.y - from.y;
  const x = from.x - target.x, y = from.y - target.y;
  const a = dx * dx + dy * dy;
  const c = x * x + y * y - radius * radius;
  if (a < 1e-12) return c <= 0 ? [0, 1] : null;
  const b = 2 * (x * dx + y * dy);
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return null;
  const enter = Math.max(0, (-b - Math.sqrt(discriminant)) / (2 * a));
  const exit = Math.min(1, (-b + Math.sqrt(discriminant)) / (2 * a));
  return enter <= exit ? [enter, exit] : null;
}

export function traceDyno(plan, force) {
  const step = 1 / 120;
  let previous = dynoPose(plan, force, 0), pose = previous, time = 0;
  let highestReach = Infinity, tooFast = false;
  for (let frame = 1; frame <= MAX_FLIGHT_TIME / step; frame++) {
    time = frame * step;
    pose = dynoPose(plan, force, time);
    highestReach = Math.min(highestReach, Math.max(...plan.catching.map((limb) => pose.limbs[limb].base.y - BONES.upperArm - BONES.forearm)));
    if (time >= ARM_RAISE_TIME) {
      let enter = 0, exit = 1;
      for (const limb of plan.catching) {
        const goal = { x: plan.target.x + (plan.limb === "bothHands" ? limb === "leftHand" ? -1.2 : 1.2 : 0), y: plan.target.y };
        const interval = contactInterval(previous.limbs[limb].end, pose.limbs[limb].end, goal, plan.radius);
        if (!interval) { enter = 2; break; }
        enter = Math.max(enter, interval[0]);
        exit = Math.min(exit, interval[1]);
      }
      if (enter <= exit) {
        const contactTime = Math.max(ARM_RAISE_TIME, time - step + enter * step);
        const verticalSpeed = force.y + GRAVITY * contactTime;
        const speed = Math.hypot(force.x, verticalSpeed);
        const contact = dynoPose(plan, force, contactTime);
        const touching = plan.catching.every((limb) => length(contact.limbs[limb].end, { x: plan.target.x + (plan.limb === "bothHands" ? limb === "leftHand" ? -1.2 : 1.2 : 0), y: plan.target.y }) <= plan.radius + 0.025);
        if (touching && speed <= (verticalSpeed > 0 ? FALLING_CATCH_SPEED : RISING_CATCH_SPEED)) return { caught: true, time: contactTime, pose: contact, phase: verticalSpeed > 0 ? "falling" : "rising" };
        tooFast ||= touching;
      }
    }
    if (time > ARM_RAISE_TIME && (pose.hips.x < -15 || pose.hips.x > WORLD_WIDTH + 15 || (force.y + GRAVITY * time > 0 && Math.max(pose.limbs.leftFoot.end.y, pose.limbs.rightFoot.end.y) > 101))) break;
    previous = pose;
  }
  const stillAbove = plan.catching.every((limb) => pose.limbs[limb].end.y < plan.target.y - plan.radius);
  const reason = force.y >= 0 || highestReach > plan.target.y + plan.radius
    ? "Undershot: your outstretched hands never get high enough. Try a little more upward power."
    : tooFast || (time >= MAX_FLIGHT_TIME - step && stillAbove)
      ? "Overshot: you fly past too quickly to hold the catch. Ease off the power."
      : "Off line: your outstretched hands miss the hold. Adjust the launch direction.";
  return { caught: false, time, pose, phase: "miss", reason };
}

function nextContacts(puzzle, state, action) {
  return attemptMove(puzzle, state, action).contacts;
}

export function assessV2(puzzle, state, action) {
  return assessWithProportions(puzzle, state, action, V2_VERSION);
}

export function suggestedDynoForce(puzzle, state, limb, hold, technique = GRIPS[puzzle.holds[hold].grip].hands[0]) {
  const action = { limb, hold, technique, mode: "dyno" };
  if (assessMove(puzzle, state, action).outcome !== "safe") return null;
  const { velocity } = dynoPlan(puzzle, state, limb, hold);
  for (const factor of [1, 0.8, 1.2, 0.6, 1.4]) for (const degrees of [0, -15, 15, -30, 30]) {
    const angle = degrees * Math.PI / 180;
    const force = {
      x: Math.round((velocity.x * Math.cos(angle) - velocity.y * Math.sin(angle)) * factor * 2) / 2,
      y: Math.round((velocity.x * Math.sin(angle) + velocity.y * Math.cos(angle)) * factor * 2) / 2,
    };
    if (Math.hypot(force.x, force.y) > MAX_PULL * SLING_GAIN) continue;
    if (assessV2(puzzle, state, { ...action, force }).outcome === "safe") return force;
  }
  return null;
}

function assessWithProportions(puzzle, state, action, revision) {
  const legacy = revision === 1;
  const poseFor = (contacts) => solvePose(puzzle, contacts, null, {}, legacy ? legacyBones : BONES, legacy ? 8 : BONES.torso);
  if (action?.mode === "dyno" && (!action.force || !Number.isFinite(action.force.x) || !Number.isFinite(action.force.y) || Math.hypot(action.force.x, action.force.y) > (legacy ? 28 : MAX_PULL) * SLING_GAIN + 0.00001)) return { outcome: "invalid", cost: 0, reason: "Pull back on a selected hand to set a finite launch force." };
  const preview = assessMove(puzzle, state, action);
  if (preview.outcome !== "safe") return preview;
  let flight = null;
  if (action.mode === "dyno") {
    const force = action.force;
    const plan = planFromPose(puzzle, poseFor(state.contacts), action.limb, action.hold, revision);
    if (revision >= 3) {
      flight = traceDyno(plan, force);
      if (!flight.caught) return { outcome: "fall", cost: preview.cost, reason: flight.reason, flight };
    } else {
      const end = shotPoint(plan, force, FLIGHT_TIME);
      if (length(end, plan.target) > plan.radius) {
        const direction = { x: plan.target.x - plan.origin.x, y: plan.target.y - plan.origin.y };
        const error = { x: end.x - plan.target.x, y: end.y - plan.target.y };
        const along = (error.x * direction.x + error.y * direction.y) / Math.max(0.01, Math.hypot(direction.x, direction.y));
        const reason = Math.abs(along) < plan.radius ? "Off line: the launch misses the side of the hold." : along > 0 ? "Overshot: too much force. Your hands fly past the catch." : "Undershot: not enough force. You drop before reaching the catch.";
        return { outcome: "fall", cost: preview.cost, reason, landing: end };
      }
    }
  }
  const pose = poseFor(nextContacts(puzzle, state, action));
  if (!pose.feasible) return { outcome: "fall", cost: preview.cost, reason: "That stance is beyond your fixed arm or leg length. Your contact peels off; bring the other limbs closer first." };
  return { ...preview, pose, ...(flight ? { flight } : {}), reason: action.mode === "dyno" ? flight?.phase === "falling" ? "Caught on the way down. Your outstretched hands find the hold; feet cut loose." : "Hands on the hold. You catch with arms extended; feet cut loose." : preview.reason };
}

export function attemptV2(puzzle, state, action) {
  return attemptWithProportions(puzzle, state, action, V2_VERSION);
}

function attemptWithProportions(puzzle, state, action, revision) {
  if (state.status !== "climbing") return state;
  const preview = assessWithProportions(puzzle, state, action, revision);
  if (preview.outcome === "invalid") return { ...state, message: preview.reason };
  if (preview.outcome === "fall") return { ...state, status: "fallen", failure: structuredClone(action), falls: state.falls + 1, energy: Math.max(0, state.energy - preview.cost), message: preview.reason };
  const next = attemptMove(puzzle, state, action);
  return { ...next, edition: "v2", version: V2_VERSION, message: next.status === "sent" ? "TOP! Both hands controlled on the finish." : preview.reason };
}

export function undoV2(puzzle, state) {
  if (state.status !== "climbing" || !state.moves.length) return state;
  const move = state.moves.at(-1);
  return { ...state, contacts: structuredClone(move.before), energy: state.energy + move.cost, moves: state.moves.slice(0, -1), undos: state.undos + 1, message: "Move undone. All four contacts restored." };
}

export function retryV2(puzzle, state) {
  return { ...initialV2(puzzle), falls: state.falls + (state.status === "climbing" && state.moves.length ? 1 : 0), undos: state.undos };
}

export function restoreV2(puzzle, saved) {
  return restoreWithProportions(puzzle, saved, V2_VERSION);
}

function restoreWithProportions(puzzle, saved, revision) {
  if (!saved || saved.edition !== "v2" || saved.version !== revision || saved.puzzleKey !== puzzle.key || !Array.isArray(saved.moves) || saved.moves.length > 1000 || !Number.isSafeInteger(saved.falls) || saved.falls < 0 || !Number.isSafeInteger(saved.undos) || saved.undos < 0) throw new Error("Invalid v2 save.");
  let restored = initialV2(puzzle);
  for (const action of saved.moves) {
    if (assessWithProportions(puzzle, restored, action, revision).outcome !== "safe") throw new Error("Invalid saved v2 move.");
    restored = attemptWithProportions(puzzle, restored, action, revision);
  }
  if (saved.status === "fallen") {
    const preview = assessWithProportions(puzzle, restored, saved.failure, revision);
    const recordedRevision = saved.recordedFallVersion ?? (saved.message === recordedFallMessage ? 1 : revision);
    const recordedFall = preview.outcome === "safe" && Number.isInteger(recordedRevision) && recordedRevision >= 1 && recordedRevision < revision && assessWithProportions(puzzle, restored, saved.failure, recordedRevision).outcome === "fall";
    if (saved.falls < 1 || (!recordedFall && preview.outcome !== "fall")) throw new Error("Invalid saved v2 fall.");
    restored = recordedFall
      ? { ...restored, status: "fallen", failure: saved.failure, energy: Math.max(0, restored.energy - preview.cost), recordedFallVersion: recordedRevision, message: "This fall was recorded under the earlier dyno or climber rules. Retry to use the updated catches." }
      : attemptWithProportions(puzzle, restored, saved.failure, revision);
  }
  if (restored.status !== saved.status) throw new Error("Saved v2 result doesn't match its moves.");
  return { ...restored, falls: saved.falls, undos: saved.undos };
}

export function migrateV2(puzzle, saved) {
  if (![1, 2].includes(saved?.version)) throw new Error("Invalid earlier v2 save.");
  const previous = restoreWithProportions(puzzle, saved, saved.version);
  let restored = { ...initialV2(puzzle), falls: saved.falls, undos: saved.undos };
  for (const action of saved.moves) {
    if (assessV2(puzzle, restored, action).outcome !== "safe") return { ...restored, undos: restored.undos + 1, message: "Climber updated: rewound to the last reachable stance (one undo). Your original progress is kept separately." };
    restored = attemptV2(puzzle, restored, action);
  }
  if (saved.status === "fallen") {
    const preview = assessV2(puzzle, restored, saved.failure);
    if (preview.outcome === "fall") restored = attemptV2(puzzle, restored, saved.failure);
    else if (preview.outcome !== "safe") throw new Error("Invalid saved v2 fall.");
    else restored = { ...restored, status: "fallen", failure: saved.failure, energy: previous.energy, recordedFallVersion: previous.recordedFallVersion ?? saved.version, message: "This fall was recorded under the earlier dyno or climber rules. Retry to use the updated catches." };
  }
  return { ...restored, falls: saved.falls, undos: saved.undos };
}

export function describeV2(move) {
  return `${LIMBS[move.limb].short} to #${move.hold + 1}: ${placementLabel(move.technique)}${move.mode === "dyno" ? " / dyno" : ""} (-${move.cost})`;
}

export function shareV2(puzzle, state, url) {
  return `DAILY BETA v2.0 / ${puzzle.mode === "endless" ? `ENDLESS #${puzzle.seed}` : puzzle.dateKey ?? puzzle.key}\nTOP in ${state.moves.length} moves\n${state.energy}/${MAX_ENERGY} energy / ${state.falls} falls / ${state.undos} undos\n${url}`;
}
