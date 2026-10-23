import test from "node:test";
import assert from "node:assert/strict";
import { GRIPS, MAX_ENERGY } from "../public/src/rules.js";
import { initialV2, assessV2, attemptV2, suggestedDynoForce } from "../public/src/engine.js";
import { generateV2Puzzle, generateV2EndlessPuzzle } from "../public/src/routes.js";
import { findOptimalV2Beta } from "../public/src/solver.js";

test("v2 optimal betas beat the setting witness and replay with actual hand catches across all five styles", () => {
  const puzzles = [
    ...Array.from({ length: 10 }, (_, i) => generateV2EndlessPuzzle(i + 1)),
    generateV2Puzzle(new Date("2026-10-22T00:00:00Z")),
    generateV2EndlessPuzzle(0xffffffff),
  ];
  for (const puzzle of puzzles) {
    const original = JSON.stringify(puzzle);
    const result = findOptimalV2Beta(puzzle);
    assert.equal(result.optimal, true, puzzle.key);
    assert.ok(result.moves.length < puzzle.beta.length, puzzle.key);
    let state = initialV2(puzzle);
    for (const move of result.moves) {
      assert.equal(assessV2(puzzle, state, move).outcome, "safe", `${puzzle.key}: ${JSON.stringify(move)}`);
      if (move.mode === "dyno") assert.ok(Number.isFinite(move.force.x) && Number.isFinite(move.force.y));
      state = attemptV2(puzzle, state, move);
    }
    assert.equal(state.status, "sent");
    assert.equal(state.energy, result.energy);
    assert.equal(JSON.stringify(puzzle), original);
  }
});

function smallWall(hooks) {
  return {
    key: "v2-reference", mode: "endless",
    holds: [
      { id: 0, x: 30, y: 78, grip: "jug", size: "large", kind: "start" },
      { id: 1, x: 50, y: 78, grip: "jug", size: "large", kind: "start" },
      { id: 2, x: 40, y: 65, grip: "edge", size: "large", kind: "finish" },
      { id: 3, x: 30, y: 90, grip: "jug", size: "large", kind: "foot" },
      { id: 4, x: 50, y: 90, grip: "jug", size: "large", kind: "foot" },
    ],
    starts: {
      leftHand: { hold: 0, technique: "open" }, rightHand: { hold: 1, technique: "open" },
      leftFoot: { hold: 3, technique: hooks ? "heel" : "stand" }, rightFoot: { hold: 4, technique: hooks ? "heel" : "stand" },
    },
  };
}

function exhaustive(puzzle, maxDepth) {
  let frontier = [initialV2(puzzle)];
  for (let depth = 1; depth <= maxDepth; depth++) {
    const next = new Map(), sends = [];
    for (const state of frontier) for (const hold of puzzle.holds) {
      for (const limb of ["leftHand", "rightHand", "bothHands", "leftFoot", "rightFoot"]) {
        const techniques = limb.endsWith("Foot") ? ["stand", ...GRIPS[hold.grip].hooks] : GRIPS[hold.grip].hands;
        for (const technique of techniques) for (const mode of limb === "bothHands" ? ["dyno"] : limb.endsWith("Foot") ? ["static"] : ["static", "dyno"]) {
          const action = { limb, hold: hold.id, technique, mode };
          if (mode === "dyno") {
            action.force = suggestedDynoForce(puzzle, state, limb, hold.id, technique);
            if (!action.force) continue;
          }
          if (assessV2(puzzle, state, action).outcome !== "safe") continue;
          const after = attemptV2(puzzle, state, action);
          if (after.status === "sent") sends.push(after);
          else {
            const key = JSON.stringify(after.contacts);
            if (!next.has(key) || next.get(key).energy < after.energy) next.set(key, after);
          }
        }
      }
    }
    if (sends.length) return { depth, energy: Math.max(...sends.map((state) => state.energy)) };
    frontier = [...next.values()];
  }
  return null;
}

test("v2 move-count and energy priorities match an exhaustive reference including alternative grips", () => {
  for (const hooks of [true, false]) {
    const puzzle = smallWall(hooks), result = findOptimalV2Beta(puzzle);
    const reference = exhaustive(puzzle, hooks ? 2 : 1);
    assert.ok(reference);
    assert.equal(result.optimal, true);
    assert.equal(result.moves.length, reference.depth);
    assert.equal(result.energy, reference.energy);
    assert.ok(result.energy <= MAX_ENERGY);
    assert.ok(result.moves.every((move) => move.hold !== 2 || move.technique === "crimp"));
  }
});

test("an impossible v2 finish throws instead of returning an optimal-looking empty result", () => {
  const puzzle = smallWall(false);
  puzzle.holds[2].size = "small";
  assert.throws(() => findOptimalV2Beta(puzzle), /No v2 beta/);
});
