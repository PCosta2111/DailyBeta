import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { GRIPS, parseEndlessSeed } from "../public/src/rules.js";
import { BONES, LIMB_KEYS, length, makePose, point, solvePose } from "../public/src/rig.js";
import { GRAVITY, initialV2, suggestedPlacement, suggestedDynoForce, dynoPlan, dynoPose, forceFromPull, assessV2, attemptV2, undoV2, retryV2, restoreV2, migrateV2 } from "../public/src/engine.js";
import { transitionPose, flightPose, fallPose, settlePose } from "../public/src/motion.js";
import { generateV2Puzzle, generateV2EndlessPuzzle } from "../public/src/routes.js";

function fixed(pose) {
  const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 0.0001, `${actual} != ${expected}`);
  close(length(pose.hips, pose.shoulders), BONES.torso);
  close(length(pose.head, pose.shoulders), BONES.neck);
  for (const limb of LIMB_KEYS) {
    const bone = pose.limbs[limb];
    close(length(bone.base, bone.joint), limb.endsWith("Hand") ? BONES.upperArm : BONES.thigh);
    close(length(bone.joint, bone.end), limb.endsWith("Hand") ? BONES.forearm : BONES.shin);
  }
}

test("365 Daily walls and 1,000 Endless seeds have distinct playable settings with fixed-length contacts", () => {
  const styles = new Set(), counts = new Set(), lengths = new Set(), geometries = new Set();
  const puzzles = [
    ...Array.from({ length: 365 }, (_, day) => generateV2Puzzle(new Date(Date.UTC(2026, 9, 22 + day)))),
    ...Array.from({ length: 1000 }, (_, seed) => generateV2EndlessPuzzle(seed + 1)),
    ...[0xffffffff, 0x80000000, 0x7fffffff, 123456789, 4000000000].map(generateV2EndlessPuzzle),
  ];
  for (const puzzle of puzzles) {
    let state = initialV2(puzzle);
    assert.deepEqual(state.contacts, puzzle.starts);
    assert.ok(solvePose(puzzle, state.contacts).feasible, puzzle.key);
    for (const hold of puzzle.holds) {
      assert.ok(hold.x >= 7 && hold.x <= 93 && hold.y >= 7 && hold.y <= 96);
      assert.equal(puzzle.holds[hold.id], hold);
      for (const other of puzzle.holds.slice(0, hold.id)) assert.ok(length(point(hold), point(other)) >= 7);
    }
    for (const action of puzzle.beta) {
      assert.equal(assessV2(puzzle, state, action).outcome, "safe", `${puzzle.key}: ${JSON.stringify(action)}`);
      state = attemptV2(puzzle, state, action);
      const pose = solvePose(puzzle, state.contacts);
      assert.ok(pose.feasible, puzzle.key);
      fixed(pose);
    }
    assert.equal(state.status, "sent", puzzle.key);
    assert.ok(state.energy >= 0);
    if (puzzle.mode === "endless" && puzzle.seed <= 1000) {
      styles.add(puzzle.style);
      counts.add(puzzle.holds.length);
      lengths.add(puzzle.beta.length);
      geometries.add(JSON.stringify(puzzle.holds.map(({ x, y }) => [x, y])));
    }
  }
  assert.equal(styles.size, 5);
  assert.ok(counts.size >= 3);
  assert.ok(lengths.size >= 5);
  assert.ok(geometries.size >= 990, `${geometries.size} distinct geometries`);
});

test("seeds are validated, deterministic and independent of the time within a UTC day", () => {
  for (const seed of [1, 2, 3, 4, 5, 12, 42, 0xffffffff]) {
    assert.deepEqual(generateV2EndlessPuzzle(String(seed)), generateV2EndlessPuzzle(seed));
    assert.equal(parseEndlessSeed(String(seed)), seed);
  }
  for (const seed of [0, -1, 4294967296, "", "1.2", "1e2", " 1", null, {}, true]) assert.throws(() => generateV2EndlessPuzzle(seed), /Route seed/);
  assert.deepEqual(generateV2Puzzle(new Date("2026-10-22T00:00:00Z")), generateV2Puzzle(new Date("2026-10-22T23:59:59Z")));
  assert.ok((BONES.upperArm + BONES.forearm) / BONES.torso <= 1.7);
  assert.ok((BONES.thigh + BONES.shin) / BONES.torso <= 1.7);
});

test("snap positions suggest compatible hooks, while above-head feet still cause a fall", () => {
  for (const grip of Object.keys(GRIPS)) {
    assert.equal(suggestedPlacement({ grip }, "leftFoot", 0), "stand");
    assert.equal(suggestedPlacement({ grip }, "leftFoot", -2), GRIPS[grip].hooks.includes("heel") ? "heel" : "stand");
    assert.equal(suggestedPlacement({ grip }, "rightFoot", 2), GRIPS[grip].hooks.includes("toe") ? "toe" : "stand");
    assert.equal(suggestedPlacement({ grip }, "leftHand"), GRIPS[grip].hands[0] ?? "open");
  }
  const puzzle = generateV2EndlessPuzzle(4), state = initialV2(puzzle);
  assert.ok(puzzle.beta.some((action) => action.technique === "heel"));
  const top = puzzle.holds.find((hold) => hold.kind === "finish");
  const result = attemptV2(puzzle, state, { limb: "leftFoot", hold: top.id, technique: "stand", mode: "static" });
  assert.equal(result.status, "fallen");
  assert.match(result.message, /above your head/);
  assert.equal(result.falls, 1);
  assert.deepEqual(retryV2(puzzle, result).contacts, state.contacts);
  assert.equal(retryV2(puzzle, result).falls, 1);
});

test("a foot switch releases the other foot and undo restores both contacts", () => {
  const puzzle = generateV2EndlessPuzzle(2);
  let state = initialV2(puzzle), switches = 0;
  for (const action of puzzle.beta) {
    const preview = assessV2(puzzle, state, action);
    const after = attemptV2(puzzle, state, action);
    if (preview.releasedLimb) {
      switches++;
      assert.equal(after.contacts[preview.releasedLimb].hold, null);
      assert.deepEqual(undoV2(puzzle, after).contacts, state.contacts);
      assert.equal(undoV2(puzzle, after).energy, state.energy);
    }
    state = after;
  }
  assert.ok(switches > 0);
});

test("saves are replayed rather than trusting stored contacts and energy", () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    const puzzle = generateV2EndlessPuzzle(seed), initial = initialV2(puzzle);
    const moved = attemptV2(puzzle, initial, puzzle.beta[0]);
    const saved = JSON.parse(JSON.stringify(moved));
    assert.deepEqual(restoreV2(puzzle, saved), moved);
    assert.deepEqual(restoreV2(puzzle, { ...saved, energy: 999, contacts: {} }), moved);
    assert.deepEqual(undoV2(puzzle, moved).contacts, initial.contacts);
    assert.throws(() => restoreV2(puzzle, { ...saved, puzzleKey: "wrong" }), /Invalid v2 save/);
    assert.throws(() => restoreV2(puzzle, { ...saved, edition: "wrong" }), /Invalid v2 save/);
    assert.throws(() => restoreV2(puzzle, { ...saved, moves: [{ ...saved.moves[0], hold: 999 }] }), /Invalid saved v2 move/);
    const earlier = { ...initial, version: 1, falls: 2, undos: 1 };
    const serialized = JSON.stringify(earlier), migrated = migrateV2(puzzle, earlier);
    assert.equal(migrated.falls, 2);
    assert.equal(migrated.undos, 1);
    assert.equal(JSON.stringify(earlier), serialized);
    assert.deepEqual(restoreV2(puzzle, migrated), migrated);
  }
});

test("moderate power errors catch but weak, strong and sideways launches miss", () => {
  const puzzle = generateV2EndlessPuzzle(5), state = initialV2(puzzle), action = puzzle.beta[0];
  for (const factor of [0.8, 0.9, 1, 1.1, 1.2, 1.3]) {
    assert.equal(assessV2(puzzle, state, { ...action, force: { x: action.force.x * factor, y: action.force.y * factor } }).outcome, "safe");
  }
  for (const [factor, reason] of [[0.1, /Undershot/], [2, /Overshot/]]) {
    const failed = { ...action, force: { x: action.force.x * factor, y: action.force.y * factor } };
    const preview = assessV2(puzzle, state, failed);
    assert.equal(preview.outcome, "fall");
    assert.match(preview.reason, reason);
    const fallen = attemptV2(puzzle, state, failed);
    assert.deepEqual(restoreV2(puzzle, JSON.parse(JSON.stringify(fallen))), fallen);
  }
  assert.match(assessV2(puzzle, state, { ...action, force: { x: 40, y: -35 } }).reason, /Off line/);
  const plan = dynoPlan(puzzle, state, action.limb, action.hold);
  const force = forceFromPull(plan.origin, { x: plan.origin.x + plan.pull.x, y: plan.origin.y + plan.pull.y });
  assert.ok(length(force, plan.velocity) < 1e-8);
});

test("at least 90% of +/-20% power and +/-10 degree aim combinations catch on five dyno walls", () => {
  let caught = 0, total = 0;
  for (const seed of [5, 10, 15, 20, 25]) {
    const puzzle = generateV2EndlessPuzzle(seed), state = initialV2(puzzle), action = puzzle.beta[0];
    for (const factor of [0.8, 0.9, 1, 1.1, 1.2]) for (const degrees of [-10, -5, 0, 5, 10]) {
      const angle = degrees * Math.PI / 180;
      const force = { x: (action.force.x * Math.cos(angle) - action.force.y * Math.sin(angle)) * factor, y: (action.force.x * Math.sin(angle) + action.force.y * Math.cos(angle)) * factor };
      caught += assessV2(puzzle, state, { ...action, force }).outcome === "safe";
      total++;
    }
  }
  assert.ok(caught / total >= 0.9, `${caught}/${total} launches caught`);
});

test("an overshoot can catch on descent but excessive speed still misses", () => {
  const puzzle = structuredClone(generateV2EndlessPuzzle(5)), state = initialV2(puzzle);
  puzzle.holds[2].x = solvePose(puzzle, state.contacts).hips.x / 0.82;
  const action = { ...puzzle.beta[0], force: { x: 0, y: -60 } };
  const preview = assessV2(puzzle, state, action);
  assert.equal(preview.outcome, "safe");
  assert.equal(preview.flight.phase, "falling");
  assert.ok(action.force.y + GRAVITY * preview.flight.time > 0);
  assert.match(assessV2(puzzle, state, { ...action, force: { x: 0, y: -90 } }).reason, /Overshot/);
});

test("all catch types use the rendered hand positions and half-step training suggestions", () => {
  const puzzle = generateV2EndlessPuzzle(4), state = initialV2(puzzle), hold = 2;
  for (const limb of ["leftHand", "rightHand", "bothHands"]) {
    const technique = GRIPS[puzzle.holds[hold].grip].hands[0];
    const force = suggestedDynoForce(puzzle, state, limb, hold, technique);
    assert.ok(force, limb);
    assert.ok(Number.isInteger(force.x * 2) && Number.isInteger(force.y * 2));
    const action = { limb, hold, technique, mode: "dyno", force };
    const preview = assessV2(puzzle, state, action);
    assert.equal(preview.outcome, "safe");
    assert.deepEqual(flightPose(puzzle, state, action, 1, preview.flight), preview.flight.pose);
    fixed(preview.flight.pose);
    const plan = dynoPlan(puzzle, state, limb, hold);
    for (const hand of plan.catching) {
      const bone = preview.flight.pose.limbs[hand];
      const goal = { x: plan.target.x + (limb === "bothHands" ? hand === "leftHand" ? -1.2 : 1.2 : 0), y: plan.target.y };
      assert.ok(length(bone.end, goal) <= plan.radius + 0.025);
      assert.ok(bone.end.y < bone.base.y);
    }
  }
  assert.equal(suggestedDynoForce(puzzle, state, "bothHands", hold, "crimp"), null);
});

test("static, flying, settling and falling frames preserve every bone length", () => {
  const puzzle = generateV2EndlessPuzzle(5);
  let state = initialV2(puzzle);
  for (const action of puzzle.beta) {
    const next = attemptV2(puzzle, state, action);
    for (let frame = 0; frame <= 20; frame++) {
      const progress = frame / 20;
      if (action.mode === "dyno") {
        const pose = flightPose(puzzle, state, action, progress);
        fixed(pose);
        fixed(fallPose(pose, progress));
        fixed(settlePose(pose, solvePose(puzzle, next.contacts), progress));
      } else fixed(transitionPose(puzzle, state, next, progress));
    }
    state = next;
  }
  fixed(makePose({ x: 40, y: 80 }, 0, { leftFoot: { x: 800, y: -800 }, rightHand: { x: -500, y: 500 } }));
});

test("preview rejects unsafe host overrides and old network flags without opening a listener", () => {
  for (const [args, host, reason] of [[[], "0.0.0.0", /local-only/], [["--network"], "127.0.0.1", /local-only/], [[], "127.0.0.1", /PORT/]]) {
    const result = spawnSync(process.execPath, [fileURLToPath(new URL("../scripts/preview.mjs", import.meta.url)), ...args], {
      env: { ...process.env, HOST: host, PORT: "0" }, encoding: "utf8", timeout: 10000,
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, reason);
  }
});
