import { GRIPS, dayKey, parseEndlessSeed } from "./rules.js";
import { initialV2, attemptV2, dynoPlan } from "./engine.js";
import { length, point, solvePose } from "./rig.js";

const limbs = { LH: "leftHand", RH: "rightHand", LF: "leftFoot", RF: "rightFoot", "2H": "bothHands" };
const patterns = [
  {
    name: "The Switchback", style: "switchback", note: "Follow the zigzag. Matching can free the hand you need next.",
    hands: [["sL", 60, 83], ["sR", 74, 82], ["a", 43, 75], ["b", 32, 60], ["c", 55, 48], ["d", 29, 40], ["e", 39, 24], ["f", 65, 24], ["top", 69, 10]],
    feet: [["fL", 59, 94], ["fR", 78, 93], ["p", 44, 89], ["r", 26, 76], ["v", 47, 53], ["w", 50, 38]],
    beta: [["LH", "a"], ["RH", "a"], ["LF", "p"], ["RF", "sL"], ["LH", "b"], ["LF", "r"], ["RH", "c"], ["RF", "a"], ["LH", "d"], ["LF", "b"], ["RF", "v"], ["RH", "e"], ["LH", "e"], ["LH", "f"], ["LF", "w"], ["RH", "top"], ["LH", "top"]],
  },
  {
    name: "Cross Town", style: "traverse", note: "Travel across the wall before turning up. Move your base with you.",
    hands: [["sL", 22, 84], ["sR", 38, 83], ["a", 53, 74], ["b", 75, 62], ["c", 63, 45], ["d", 40, 27], ["top", 24, 11]],
    feet: [["fL", 20, 94], ["fR", 42, 94], ["p", 51, 91], ["q", 70, 80], ["r", 83, 76], ["t", 59, 63], ["u", 46, 47], ["v", 28, 35]],
    beta: [["RH", "a"], ["RF", "p"], ["LH", "a"], ["LF", "sR"], ["RH", "b"], ["LF", "q"], ["RF", "r"], ["LH", "c"], ["LF", "t"], ["RH", "c"], ["RF", "b"], ["LH", "d"], ["RF", "u"], ["RH", "d"], ["LF", "u"], ["LF", "v"], ["LH", "top"], ["RH", "top"]],
  },
  {
    name: "Squeeze Play", style: "compression", note: "Opposing hands, staggered feet. Get compact before reaching out.",
    hands: [["sL", 30, 83], ["sR", 51, 79], ["a", 67, 66, "pinch", "small"], ["b", 39, 54], ["c", 65, 40], ["d", 37, 30], ["top", 54, 11]],
    feet: [["fL", 27, 94], ["fR", 53, 94], ["p", 61, 85], ["q", 38, 72], ["t", 56, 51], ["u", 58, 33]],
    beta: [["RH", "a"], ["RF", "p"], ["LH", "b"], ["LF", "q"], ["RH", "c"], ["RF", "a"], ["LH", "d"], ["LF", "b"], ["RF", "t"], ["RH", "top"], ["RF", "u"], ["LH", "top"]],
  },
  {
    name: "Heel Turn", style: "hook", note: "That jug can be a handhold, then a heel. Keep your feet working.",
    hands: [["sL", 26, 84], ["sR", 42, 84], ["a", 45, 65, "jug"], ["b", 66, 50], ["c", 43, 34], ["d", 73, 29], ["top", 60, 12]],
    feet: [["fL", 25, 94], ["fR", 46, 94], ["p", 34, 81], ["q", 63, 71], ["t", 42, 49], ["u", 59, 32]],
    beta: [["RH", "a"], ["LF", "p"], ["LH", "a"], ["RF", "q"], ["RH", "b"], ["LF", "a", "heel"], ["LH", "c"], ["RF", "b"], ["LF", "t"], ["RH", "d"], ["LH", "top"], ["RF", "u"], ["RH", "top"]],
  },
  {
    name: "Air Time", style: "dyno", note: "A real gap. Load the launch, trust the jump, then find your feet.",
    hands: [["sL", 34, 85], ["sR", 49, 85], ["a", 60, 41, "jug"], ["b", 35, 25], ["top", 57, 10]],
    feet: [["fL", 32, 94], ["fR", 54, 94], ["p", 49, 63], ["q", 70, 60], ["r", 38, 46]],
    beta: [["2H", "a"], ["LF", "p"], ["RF", "q"], ["LH", "b"], ["LF", "r"], ["RH", "b"], ["RF", "a"], ["RH", "top"], ["LH", "top"]],
  },
];

function random(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let mixed = Math.imul(value ^ value >>> 15, value | 1);
    mixed ^= mixed + Math.imul(mixed ^ mixed >>> 7, mixed | 61);
    return ((mixed ^ mixed >>> 14) >>> 0) / 4294967296;
  };
}

function setting(identity, seed) {
  const pattern = patterns[((seed - 1) % patterns.length + patterns.length) % patterns.length];
  const rng = random(seed);
  const mirror = rng() > 0.5;
  const mappedLimb = (short) => {
    const limb = limbs[short];
    if (!mirror || limb === "bothHands") return limb;
    return limb.startsWith("left") ? limb.replace("left", "right") : limb.replace("right", "left");
  };
  let failure = "";
  for (let variation = 0; variation < 33; variation++) {
    const jitter = variation === 32 ? 0 : 4 * (1 - variation / 36);
    const width = 1 + (rng() - 0.5) * jitter * 0.06;
    const shift = (rng() - 0.5) * jitter * 3;
    const ids = new Map();
    const holds = [...pattern.hands, ...pattern.feet].map(([label, x, y, prescribed, size], id) => {
      ids.set(label, id);
      const start = ["sL", "sR", "fL", "fR"].includes(label);
      const foot = id >= pattern.hands.length;
      const grip = foot ? "chip" : start || label === "top" ? "jug" : prescribed ?? ["jug", "edge", "sloper", "pocket"][Math.floor(rng() * 4)];
      const across = 50 + (x - 50) * width + shift + (rng() - 0.5) * jitter;
      return { id, x: Number((mirror ? 100 - across : across).toFixed(2)), y: Number((y + (rng() - 0.5) * jitter).toFixed(2)), grip, size: foot ? "small" : size ?? "large", kind: start ? "start" : label === "top" ? "finish" : "route" };
    });
    const starts = Object.fromEntries([["LH", "sL"], ["RH", "sR"], ["LF", "fL"], ["RF", "fR"]].map(([limb, label]) => [mappedLimb(limb), { hold: ids.get(label), technique: limb.endsWith("H") ? "open" : "stand" }]));
    const puzzle = { ...identity, name: pattern.name, note: pattern.note, style: pattern.style, holds, starts };
    if (holds.some((hold, i) => hold.x < 7 || hold.x > 93 || hold.y < 7 || hold.y > 96 || holds.slice(0, i).some((other) => length(point(hold), point(other)) < 7))) continue;
    let state = initialV2(puzzle);
    if (!solvePose(puzzle, state.contacts).feasible) continue;
    const beta = [];
    for (const [short, label, technique] of pattern.beta) {
      const limb = mappedLimb(short);
      const hold = ids.get(label);
      const mode = limb === "bothHands" ? "dyno" : "static";
      const action = { limb, hold, mode, technique: technique ?? (limb.endsWith("Foot") ? "stand" : GRIPS[holds[hold].grip].hands[0]) };
      if (mode === "dyno") action.force = dynoPlan(puzzle, state, limb, hold).velocity;
      const next = attemptV2(puzzle, state, action);
      if (next.moves.length !== state.moves.length + 1) {
        failure = `${short} to ${label}: ${next.message}`;
        break;
      }
      beta.push(action);
      state = next;
    }
    if (state.status === "sent") return { ...puzzle, beta };
  }
  throw new Error(`Couldn't set a playable ${pattern.style} boulder: ${failure}`);
}

export function generateV2Puzzle(date = new Date()) {
  const dateKey = dayKey(date);
  const day = Math.floor(Date.parse(`${dateKey}T00:00:00Z`) / 86400000);
  return setting({ mode: "daily", key: `v2-setting-v1-${dateKey}`, dateKey, number: day - Math.floor(Date.UTC(2026, 0, 1) / 86400000) + 1 }, day);
}

export function generateV2EndlessPuzzle(value) {
  const seed = parseEndlessSeed(value);
  return setting({ mode: "endless", key: `v2-setting-v1-endless-${seed}`, seed, number: seed }, seed);
}
