import { MAX_ENERGY, GRIPS, assessMove, attemptMove, canMatchHands, distance } from "./rules.js";
import { Queue, candidateMoves } from "./search.js";
import { contactTargets, length, solvePose } from "./rig.js";
import { initialV2, assessV2, attemptV2, suggestedDynoForce } from "./engine.js";

function key(state) {
  const c = state.contacts;
  return `${c.leftHand.hold},${c.rightHand.hold}/${c.leftFoot.hold}:${c.leftFoot.technique},${c.rightFoot.hold}:${c.rightFoot.technique}`;
}

function handBound(puzzle) {
  const hands = puzzle.holds.filter((hold) => GRIPS[hold.grip].hands.length);
  const reverse = new Map(), depths = new Map(), queue = [];
  const code = (a, b, feet) => `${a},${b}/${feet}`;
  const add = (from, to) => { if (!reverse.has(to)) reverse.set(to, []); reverse.get(to).push(from); };
  for (const a of hands) for (const b of hands) for (let feet = 0; feet <= 2; feet++) {
    const from = code(a.id, b.id, feet);
    if (a.kind === "finish" && b.kind === "finish") { depths.set(from, 0); queue.push(from); }
    if (feet < 2) add(from, code(a.id, b.id, feet + 1));
    for (const hold of hands) {
      for (const left of [true, false]) {
        const current = left ? a : b, other = left ? b : a;
        if (current.id === hold.id || (other.id === hold.id && !canMatchHands(hold)) || distance(other, hold) > 42.08) continue;
        const to = code(left ? hold.id : a.id, left ? b.id : hold.id, feet);
        if ((feet > 0 || (hold.kind === "finish" && other.kind === "finish")) && distance(current, hold) <= 46) add(from, to);
        if (feet === 2 && hold.y < (a.y + b.y) / 2 - 2 && distance(current, hold) <= 55) add(from, code(left ? hold.id : a.id, left ? b.id : hold.id, 0));
      }
      if (feet === 2 && canMatchHands(hold) && hold.y < (a.y + b.y) / 2 - 2 && Math.max(distance(a, hold), distance(b, hold)) <= 55) add(from, code(hold.id, hold.id, 0));
    }
  }
  for (let i = 0; i < queue.length; i++) {
    for (const previous of reverse.get(queue[i]) ?? []) {
      if (depths.has(previous)) continue;
      depths.set(previous, depths.get(queue[i]) + 1);
      queue.push(previous);
    }
  }
  return (state) => {
    const c = state.contacts;
    return depths.get(code(c.leftHand.hold, c.rightHand.hold, Number(c.leftFoot.hold !== null) + Number(c.rightFoot.hold !== null))) ?? Infinity;
  };
}

function feasible(puzzle, state, cache) {
  const position = key(state);
  if (cache.has(position)) return cache.get(position);
  const targets = Object.entries(contactTargets(puzzle, state.contacts));
  let possible = true;
  for (let i = 0; i < targets.length; i++) for (let j = 0; j < i; j++) {
    const [a, first] = targets[i], [b, second] = targets[j];
    const bothHands = a.endsWith("Hand") && b.endsWith("Hand");
    const bothFeet = a.endsWith("Foot") && b.endsWith("Foot");
    if (length(first, second) > (bothHands ? 42.08 : bothFeet ? 43.08 : 51.6)) possible = false;
  }
  const result = possible && solvePose(puzzle, state.contacts).feasible;
  cache.set(position, result);
  return result;
}

function launch(puzzle, state, action) {
  const force = suggestedDynoForce(puzzle, state, action.limb, action.hold, action.technique);
  return force ? { ...action, force } : null;
}

function verify(puzzle, actions) {
  let state = initialV2(puzzle);
  const moves = [];
  for (const action of actions) {
    const move = action.mode === "dyno" ? launch(puzzle, state, action) : action;
    if (!move || assessV2(puzzle, state, move).outcome !== "safe") return null;
    state = attemptV2(puzzle, state, move);
    moves.push(move);
  }
  return state.status === "sent" ? { moves, energy: state.energy } : null;
}

export function findOptimalV2Beta(puzzle, progress = () => {}) {
  // Relax launch forces to get a lower bound, then certify the winner with actual hand catches.
  const actions = candidateMoves(puzzle);
  const bound = handBound(puzzle), poses = new Map(), labels = new Map(), queue = new Queue();
  const start = initialV2(puzzle), initial = { depth: 0, energy: MAX_ENERGY };
  const startKey = key(start);
  const verified = verify(puzzle, puzzle.beta ?? []);
  const upper = verified ? verified.moves.length * (MAX_ENERGY + 1) + MAX_ENERGY - verified.energy : Infinity;
  labels.set(startKey, [initial]);
  queue.push({ state: start, depth: 0, parent: null, action: null, key: startKey, label: initial, priority: bound(start) * (MAX_ENERGY + 1) });
  let expanded = 0;
  while (queue.items.length) {
    const node = queue.pop();
    if (!labels.get(node.key).includes(node.label)) continue;
    if (verified && node.priority >= upper) return { ...verified, optimal: true, expanded };
    if (node.state.status === "sent") {
      const path = [];
      for (let step = node; step.parent; step = step.parent) path.push(step.action);
      const result = verify(puzzle, path.reverse());
      if (result) return { ...result, optimal: true, expanded };
      if (!verified) throw new Error("Couldn't verify the relaxed beta's launch forces.");
      return { ...verified, optimal: false, lowerBound: node.depth, expanded };
    }
    expanded++;
    if (expanded % 1000 === 0) progress({ expanded, lowerBound: Math.floor(node.priority / (MAX_ENERGY + 1)) });
    for (const action of actions) {
      if (assessMove(puzzle, node.state, action).outcome !== "safe") continue;
      const next = attemptMove(puzzle, node.state, action);
      next.moves = [];
      const depth = node.depth + 1, position = key(next);
      const previous = labels.get(position) ?? [];
      if (previous.some((entry) => entry.depth <= depth && entry.energy >= next.energy)) continue;
      const priority = (depth + bound(next)) * (MAX_ENERGY + 1) + MAX_ENERGY - next.energy;
      if (priority >= upper || !feasible(puzzle, next, poses)) continue;
      const label = { depth, energy: next.energy };
      labels.set(position, [...previous.filter((entry) => entry.depth < depth || entry.energy > next.energy), label]);
      queue.push({ state: next, depth, parent: node, action, key: position, label, priority });
    }
  }
  if (verified) return { ...verified, optimal: true, expanded };
  throw new Error("No v2 beta reaches the top within the energy budget.");
}
