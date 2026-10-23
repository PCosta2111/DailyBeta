export const LIMB_KEYS = ["leftHand", "rightHand", "leftFoot", "rightFoot"];
export const BONES = Object.freeze({ upperArm: 9.5, forearm: 9.5, thigh: 10, shin: 10, torso: 12, neck: 2.8 });
export const WORLD_WIDTH = 82;
export const point = (hold) => ({ x: hold.x * 0.82, y: hold.y });
export const length = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export const mix = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

export function limit(base, end, reach) {
  const distance = length(base, end);
  return distance <= reach ? { ...end } : mix(base, end, reach / distance);
}

export function joint(base, end, first, second, side) {
  const distance = length(base, end);
  if (distance === 0) return { x: base.x + first * side, y: base.y };
  const along = (first * first - second * second + distance * distance) / (2 * distance);
  const height = Math.sqrt(Math.max(0, first * first - along * along));
  const x = (end.x - base.x) / distance;
  const y = (end.y - base.y) / distance;
  return { x: base.x + x * along - y * height * side, y: base.y + y * along + x * height * side };
}

function armJoint(base, end, first, second, side, angle) {
  const down = { x: -Math.sin(angle), y: Math.cos(angle) };
  const raised = (end.x - base.x) * down.x + (end.y - base.y) * down.y < 0;
  const weight = raised ? 2 : 0.2;
  const preference = { x: Math.cos(angle) * side + down.x * weight, y: Math.sin(angle) * side + down.y * weight };
  const a = joint(base, end, first, second, -1);
  const b = joint(base, end, first, second, 1);
  return (a.x - b.x) * preference.x + (a.y - b.y) * preference.y >= 0 ? a : b;
}

function bases(hips, angle, bones) {
  const across = { x: Math.cos(angle), y: Math.sin(angle) };
  const shoulders = { x: hips.x + Math.sin(angle) * bones.torso, y: hips.y - Math.cos(angle) * bones.torso };
  const offset = (base, side, width) => ({ x: base.x + across.x * side * width, y: base.y + across.y * side * width });
  return {
    shoulders,
    leftHand: offset(shoulders, -1, 2),
    rightHand: offset(shoulders, 1, 2),
    leftFoot: offset(hips, -1, 1.5),
    rightFoot: offset(hips, 1, 1.5),
  };
}

export function contactTargets(puzzle, contacts) {
  const targets = {};
  for (const limb of LIMB_KEYS) {
    const contact = contacts[limb];
    if (contact.hold === null) continue;
    const hold = puzzle.holds[contact.hold];
    const target = point(hold);
    const other = limb.startsWith("left") ? limb.replace("left", "right") : limb.replace("right", "left");
    if (contacts[other].hold === contact.hold) target.x += limb.startsWith("left") ? -1.2 : 1.2;
    if (limb.endsWith("Foot")) target.y += contact.technique === "heel" ? -1 : contact.technique === "toe" ? 1 : -0.5;
    targets[limb] = target;
  }
  return targets;
}

export function makePose(hips, angle, targets = {}, swing = 0, bones = BONES) {
  const base = bases(hips, angle, bones);
  const pose = {
    hips: { ...hips }, angle, shoulders: base.shoulders,
    head: { x: base.shoulders.x + Math.sin(angle) * bones.neck, y: base.shoulders.y - Math.cos(angle) * bones.neck },
    limbs: {},
  };
  for (const limb of LIMB_KEYS) {
    const hand = limb.endsWith("Hand");
    const side = limb.startsWith("left") ? -1 : 1;
    const first = hand ? bones.upperArm : bones.thigh;
    const second = hand ? bones.forearm : bones.shin;
    const reach = first + second;
    const hanging = { x: base[limb].x + side * reach * 0.2 + swing * (hand ? 2 : 6), y: base[limb].y + reach * 0.82 - Math.abs(swing) * 2 };
    const end = limit(base[limb], targets[limb] ?? hanging, first + second - 0.00001);
    pose.limbs[limb] = { base: base[limb], joint: hand ? armJoint(base[limb], end, first, second, side, angle) : joint(base[limb], end, first, second, -side), end };
  }
  return pose;
}

export function solvePose(puzzle, contacts, preferred = null, overrides = {}, bones = BONES, hipClearance = BONES.torso) {
  const targets = { ...contactTargets(puzzle, contacts), ...overrides };
  const hands = ["leftHand", "rightHand"].map((limb) => targets[limb]).filter(Boolean);
  const feet = ["leftFoot", "rightFoot"].map((limb) => targets[limb]).filter(Boolean);
  const center = (items, axis) => items.reduce((sum, item) => sum + item[axis], 0) / items.length;
  const desired = preferred ?? {
    x: hands.length ? center(hands, "x") * 0.65 + (feet.length ? center(feet, "x") : center(hands, "x")) * 0.35 : 41,
    y: hands.length ? Math.min(center(hands, "y") + 21, feet.length ? center(feet, "y") - hipClearance : 95) : 85,
  };
  let best = null;
  for (const angle of [0, -0.2, 0.2, -0.4, 0.4, -0.6, 0.6]) {
    let hips = { ...desired };
    for (let iteration = 0; iteration < 90; iteration++) {
      for (const limb of LIMB_KEYS) {
        if (!targets[limb]) continue;
        const base = bases(hips, angle, bones)[limb];
        const reach = limb.endsWith("Hand") ? bones.upperArm + bones.forearm : bones.thigh + bones.shin;
        const offset = { x: base.x - hips.x, y: base.y - hips.y };
        const center = { x: targets[limb].x - offset.x, y: targets[limb].y - offset.y };
        hips = limit(center, hips, reach - 0.01);
      }
    }
    const pose = makePose(hips, angle, targets, 0, bones);
    const error = Math.max(0, ...LIMB_KEYS.filter((limb) => targets[limb]).map((limb) => length(pose.limbs[limb].end, targets[limb])));
    const score = error * 1000 + length(hips, desired) + Math.abs(angle) * 2;
    if (!best || score < best.score) best = { ...pose, feasible: error < 0.04, error, score };
    if (best.feasible && best.score < 0.1) break;
  }
  return best;
}
