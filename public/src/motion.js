import { LIMB_KEYS, makePose, mix, solvePose } from "./rig.js";
import { dynoPlan, dynoPose, traceDyno } from "./engine.js";

const loose = Object.fromEntries(LIMB_KEYS.map((limb) => [limb, { hold: null, technique: null }]));

export function transitionPose(puzzle, before, after, progress) {
  const start = solvePose(puzzle, before.contacts);
  const finish = solvePose(puzzle, after.contacts);
  const t = 1 - (1 - progress) ** 3;
  const targets = {};
  for (const limb of LIMB_KEYS) {
    targets[limb] = mix(start.limbs[limb].end, finish.limbs[limb].end, t);
    if (before.contacts[limb].hold !== after.contacts[limb].hold) targets[limb].y -= Math.sin(Math.PI * t) * 2;
  }
  return solvePose(puzzle, loose, mix(start.hips, finish.hips, t), targets);
}

export function flightPose(puzzle, state, action, progress, flight = null) {
  const plan = dynoPlan(puzzle, state, action.limb, action.hold);
  const result = flight ?? traceDyno(plan, action.force);
  return progress === 1 ? result.pose : dynoPose(plan, action.force, progress * result.time);
}

export function fallPose(start, progress) {
  const angle = Math.sin(progress * 2.2) * 0.6;
  const drop = Math.max(0, 104 - start.hips.y) * progress * progress;
  const hips = { x: start.hips.x + Math.sin(progress * 2) * 4, y: start.hips.y + drop };
  const targets = {};
  for (const limb of LIMB_KEYS) {
    const end = start.limbs[limb].end;
    const x = end.x - start.hips.x;
    const y = end.y - start.hips.y;
    targets[limb] = { x: hips.x + x * Math.cos(angle) - y * Math.sin(angle), y: hips.y + x * Math.sin(angle) + y * Math.cos(angle) + Math.sin(progress * 8) * 3 };
  }
  return makePose(hips, start.angle + angle, targets);
}

export function settlePose(start, finish, progress) {
  const t = 1 - Math.exp(-6 * progress) * Math.cos(progress * 9);
  const hips = mix(start.hips, finish.hips, t);
  const targets = Object.fromEntries(LIMB_KEYS.map((limb) => [limb, mix(start.limbs[limb].end, finish.limbs[limb].end, Math.min(1, progress * 3))]));
  return makePose(hips, start.angle + (finish.angle - start.angle) * Math.min(1, progress * 2), targets, Math.sin(progress * 10) * (1 - progress) * 0.35);
}
