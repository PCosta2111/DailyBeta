export const MAX_ENERGY = 160;
export const MAX_REACH = 32;

export const LIMBS = {
  leftHand: { label: "Left hand", short: "LH", type: "hand" },
  rightHand: { label: "Right hand", short: "RH", type: "hand" },
  leftFoot: { label: "Left foot", short: "LF", type: "foot" },
  rightFoot: { label: "Right foot", short: "RF", type: "foot" },
  bothHands: { label: "Both hands", short: "2H", type: "hand" },
};

export const TECHNIQUES = {
  open: { label: "Open hand", type: "hand", description: "Wrap a jug or palm a sloper. Less efficient on small edges and pinches." },
  crimp: { label: "Crimp", type: "hand", description: "Fingers over a thin edge. Efficient on edges; slips off rounded holds." },
  pinch: { label: "Pinch", type: "hand", description: "Squeeze opposite sides of a pinch with your thumb and fingers." },
  pocket: { label: "Pocket grip", type: "hand", description: "Fingers in the pocket. A pocket has no surface to crimp or pinch." },
  stand: { label: "Toe edge / stand", type: "foot", description: "Push through your shoe's edge. Keep the foothold below your hands." },
  heel: { label: "Heel hook", type: "foot", description: "Pull on a jug, edge or sloper. Adds 7 reach and saves 2 energy on hand moves." },
  toe: { label: "Toe hook", type: "foot", description: "Pull under a jug or pinch. Adds 3 reach and extra sideways stability." },
};

export const GRIPS = {
  jug: { label: "Jug", cost: 0, hands: ["open"], hooks: ["heel", "toe"], description: "Deep lip, big opening. Wrap your hand around it; either hook works." },
  edge: { label: "Edge", cost: 2, hands: ["crimp", "open"], hooks: ["heel"], description: "Thin horizontal rail. Crimp it, or use a more tiring open hand. A heel can catch the lip." },
  pinch: { label: "Pinch", cost: 3, hands: ["pinch", "open"], hooks: ["toe"], description: "Tall block with two opposing sides. Squeeze it, or pay extra for an open grip. Toe-hook underneath." },
  sloper: { label: "Sloper", cost: 4, hands: ["open"], hooks: ["heel"], description: "Round dome with no lip. Palm it with an open hand, or wrap a heel over it." },
  pocket: { label: "Pocket", cost: 4, hands: ["pocket"], hooks: [], description: "Small finger hole. Use a pocket grip; there is no outer lip for a hook." },
  chip: { label: "Foot chip", cost: 0, hands: [], hooks: [], description: "Tiny shoe edge. Feet only, standing only. Too small for hands or hooks." },
};

export function dayKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

export function canMatchHands(hold) {
  return hold.size === "large" && GRIPS[hold.grip].hands.length > 0;
}

export function parseEndlessSeed(value) {
  if ((typeof value !== "number" && typeof value !== "string") || (typeof value === "string" && !/^[0-9]+$/.test(value))) throw new Error("Route seed must be a whole number from 1 to 4294967295.");
  const seed = Number(value);
  if (!Number.isInteger(seed) || seed < 1 || seed > 0xffffffff) throw new Error("Route seed must be a whole number from 1 to 4294967295.");
  return seed;
}

export function initialState(puzzle) {
  if (!puzzle.starts) throw new Error("This route has no starting contacts.");
  return {
    contacts: structuredClone(puzzle.starts),
    energy: MAX_ENERGY,
    moves: [],
    falls: 0,
    undos: 0,
    status: "climbing",
    failure: null,
    message: "Drag a hand or foot onto a hold.",
    puzzleKey: puzzle.key,
  };
}

export function distance(a, b) {
  return Math.hypot((a.x - b.x) * 0.82, a.y - b.y);
}

export function bodyPosition(puzzle, state) {
  const left = puzzle.holds[state.contacts.leftHand.hold], right = puzzle.holds[state.contacts.rightHand.hold];
  const hands = { x: (left.x + right.x) / 2, y: (left.y + right.y) / 2 };
  const feet = ["leftFoot", "rightFoot"].flatMap((limb) => {
    const contact = state.contacts[limb];
    return contact.hold === null ? [] : [{ ...puzzle.holds[contact.hold], technique: contact.technique }];
  });
  const heels = feet.filter((foot) => foot.technique === "heel").length;
  const toes = feet.filter((foot) => foot.technique === "toe").length;
  const standing = feet.filter((foot) => foot.technique === "stand");
  const standingHeight = standing.length ? standing.reduce((sum, foot) => sum + foot.y, 0) / standing.length - 8 : 93;
  const hips = { x: hands.x * 0.65 + (feet.length ? feet.reduce((sum, foot) => sum + foot.x, 0) / feet.length : hands.x) * 0.35, y: Math.min(standingHeight, hands.y + 20) };
  const shoulders = { x: hands.x, y: Math.max(9, hips.y - 10) };
  return {
    hands, hips, shoulders,
    head: { x: shoulders.x, y: shoulders.y - 3.5 },
    feet,
    reachBonus: heels * 7 + toes * 3,
    balanceBonus: heels * 5 + toes * 14,
    savings: heels * 2 + toes,
  };
}

export function dynoStance(puzzle, state) {
  const body = bodyPosition(puzzle, state);
  if (body.feet.length < 2 || body.feet.some((foot) => foot.technique !== "stand" || foot.y < body.hands.y + 6)) return { supported: false, reason: "A dyno needs two standing feet below your hands. Release hooks and set your launch." };
  const [left, right] = body.feet;
  const width = Math.abs(left.x - right.x);
  if (width < 8 / 0.82) return { supported: false, reason: "Your feet are too close together for a controlled launch. Use two spaced footholds." };
  if (width > 32 / 0.82) return { supported: false, reason: "Your feet are too wide to push together. Bring them closer before a dyno." };
  if (Math.abs(left.y - right.y) > 8) return { supported: false, reason: "Your feet are too uneven for a dyno. Set a more level launch stance." };
  if (body.hips.x < Math.min(left.x, right.x) || body.hips.x > Math.max(left.x, right.x)) return { supported: false, reason: "Your body is outside your foot base. Reposition your feet under your weight before jumping." };
  if ((left.y + right.y) / 2 - body.hands.y > 40) return { supported: false, reason: "You're stretched too far from hands to feet to load a jump. Bring your feet up." };
  return { supported: true, reason: "Two spaced, level standing feet support your launch." };
}

export function assessMove(puzzle, state, action) {
  const invalid = (reason) => ({ outcome: "invalid", cost: 0, reason });
  if (state.status !== "climbing") return invalid(state.status === "fallen" ? "You're on the mats. Start a new attempt." : "This boulder is already sent.");
  const { limb, hold: holdId, technique, mode } = action ?? {};
  if (!Object.hasOwn(LIMBS, limb) || !Object.hasOwn(TECHNIQUES, technique)) return invalid("Choose a limb and a technique.");
  const type = LIMBS[limb].type, bothHands = limb === "bothHands";
  if (TECHNIQUES[technique].type !== type || !["static", "dyno"].includes(mode) || (type === "foot" && mode !== "static")) return invalid("That move doesn't match the selected limb.");
  if (bothHands && mode !== "dyno") return invalid("Moving both hands together requires a dyno.");
  const hold = puzzle.holds.find((candidate) => candidate.id === holdId);
  if (!hold) return invalid("Choose a hold on the wall.");
  if (bothHands && state.contacts.leftHand.hold === holdId && state.contacts.rightHand.hold === holdId) return invalid("Both hands are already on that hold.");
  const current = bothHands ? { hold: null, technique: null } : state.contacts[limb];
  if (current.hold === holdId && current.technique === technique) return invalid("That limb is already there with this technique.");
  if (current.hold === holdId && mode === "dyno") return invalid("Choose a different hold for a dyno.");
  const body = bodyPosition(puzzle, state);
  const from = current.hold === null ? body.hips : puzzle.holds[current.hold];
  const travel = bothHands ? Math.max(distance(puzzle.holds[state.contacts.leftHand.hold], hold), distance(puzzle.holds[state.contacts.rightHand.hold], hold)) : distance(from, hold);
  const grip = GRIPS[hold.grip];
  const cost = type === "foot"
    ? 3 + Math.round(travel * 0.12) + (technique === "stand" ? 0 : 2)
    : Math.max(4, (mode === "dyno" ? 18 + Math.round(travel * 0.35) + (bothHands ? 6 : 0) : 5 + Math.round(travel * 0.18)) + grip.cost + (technique === "open" && ["edge", "pinch"].includes(hold.grip) ? 4 : 0) - body.savings);
  const fall = (reason) => ({ outcome: "fall", cost, reason });
  if (type === "hand") {
    if (!grip.hands.length) return fall("That chip only fits a shoe edge. Your hand slips off.");
    if (bothHands && !canMatchHands(hold)) return fall("A two-hand catch needs a large hold with room for both hands. You miss the catch.");
    if (!grip.hands.includes(technique)) return fall(`${grip.label}: use ${grip.hands.map((name) => TECHNIQUES[name].label.toLowerCase()).join(" or ")}. This grip slips.`);
    const other = puzzle.holds[state.contacts[limb === "leftHand" ? "rightHand" : "leftHand"].hold];
    if (other.id === holdId && !canMatchHands(hold)) return fall("Both hands won't fit on that small hold. The match slips.");
    if (travel > (mode === "dyno" ? 55 : MAX_REACH + body.reachBonus)) return fall(mode === "dyno" ? "The jump is too far. You miss the catch." : "Too far for a static move. Bring your feet up, hook, or set up a dyno.");
    if (!bothHands && distance(other, hold) > 58) return fall("Your hands are too far apart to hold the position.");
    const matchingTop = !bothHands && hold.kind === "finish" && other.id === holdId;
    if (!matchingTop || mode === "dyno") {
      if (mode === "dyno") {
        const stance = dynoStance(puzzle, state);
        if (!stance.supported) return fall(stance.reason);
        if (hold.y >= body.hands.y - 2) return fall("That target isn't above your launch. Move statically instead of jumping down or sideways.");
        const footCenter = (body.feet[0].x + body.feet[1].x) / 2;
        const steering = Math.min(28, 12 + (body.hands.y - hold.y) * 0.45);
        if (Math.abs(hold.x - footCenter) * 0.82 > steering) return fall("That catch is too far sideways for your launch. Move your foot base toward the target.");
        if (Math.max(...body.feet.map((foot) => foot.y)) - hold.y > 65) return fall("Your feet are too low to launch that high.");
      } else {
        if (!body.feet.length) return fall("You're cut loose. Replant a foot before the next hand move.");
        const nextHandsY = (hold.y + other.y) / 2;
        if (body.feet.some((foot) => foot.technique === "stand" && foot.y < nextHandsY + 5)) return fall("That hand move leaves your standing feet too high. Lower your feet or use a suitable hook first.");
        if (Math.max(...body.feet.map((foot) => foot.y)) - hold.y > (body.feet.length === 2 ? 45 : 41) + body.reachBonus) return fall("Your feet are too low. You overextend and peel off the wall.");
      }
      if (body.feet.length) {
        const footCenter = body.feet.reduce((sum, foot) => sum + foot.x, 0) / body.feet.length;
        if (Math.abs(hold.x - footCenter) * 0.82 > (mode === "dyno" ? 47 : 36) + body.balanceBonus) return fall("Your feet are too far to the side. You barn-door off. Reposition or use a toe hook.");
      }
    }
  } else {
    if (hold.y < body.head.y) return fall("That foot is above your head. You lose the position and fall.");
    if (technique === "stand" && hold.y < body.hands.y + 5) return fall("That step is too high to stand on. Use a suitable hook or move your hands up first.");
    if (technique !== "stand") {
      if (!grip.hooks.includes(technique)) return fall(`There's no lip for a ${TECHNIQUES[technique].label.toLowerCase()} on this ${grip.label.toLowerCase()}. Your foot slips.`);
      if (hold.y > body.hands.y + 32) return fall("That hook is too low to keep tension. Your foot pops off.");
    }
    if (travel > (current.hold === null ? 39 : 34) || distance(body.hips, hold) > 45) return fall("That foothold is too far away. Take a smaller step.");
    const otherFoot = state.contacts[limb === "leftFoot" ? "rightFoot" : "leftFoot"];
    if (otherFoot.hold !== null && distance(puzzle.holds[otherFoot.hold], hold) > 45) return fall("Your feet are spread too far apart. You lose tension.");
  }
  if (cost > state.energy) return fall("Pumped out. You can't hold the move and drop to the mats.");
  const otherFoot = limb === "leftFoot" ? "rightFoot" : "leftFoot";
  const releasedLimb = type === "foot" && hold.size === "small" && state.contacts[otherFoot].hold === holdId ? otherFoot : null;
  return {
    outcome: "safe", cost, releasedLimb,
    reason: releasedLimb ? `Foot switch: ${LIMBS[releasedLimb].label.toLowerCase()} comes off and hangs free. The new foot takes the hold.` : mode === "dyno" ? `${bothHands ? "Both hands catch together." : "Catch is in range."} Both feet will cut loose; replant before moving a hand again.` : type === "foot" && technique !== "stand" ? `${TECHNIQUES[technique].label} set: ${technique === "heel" ? "extra reach and lower energy on hand moves" : "extra reach and sideways stability"}.` : "Reach and body position are supported.",
  };
}

export function attemptMove(puzzle, state, action) {
  if (state.status !== "climbing") return state;
  const preview = assessMove(puzzle, state, action);
  if (preview.outcome === "invalid") return { ...state, message: preview.reason };
  if (preview.outcome === "fall") return { ...state, status: "fallen", energy: Math.max(0, state.energy - preview.cost), falls: state.falls + 1, failure: { ...action }, message: preview.reason };
  const contacts = structuredClone(state.contacts);
  if (action.limb === "bothHands") {
    contacts.leftHand = { hold: action.hold, technique: action.technique };
    contacts.rightHand = { hold: action.hold, technique: action.technique };
  } else contacts[action.limb] = { hold: action.hold, technique: action.technique };
  if (preview.releasedLimb) contacts[preview.releasedLimb] = { hold: null, technique: null };
  if (action.mode === "dyno") {
    contacts.leftFoot = { hold: null, technique: null };
    contacts.rightFoot = { hold: null, technique: null };
  }
  const next = {
    ...state, contacts,
    energy: state.energy - preview.cost,
    moves: [...state.moves, { ...action, cost: preview.cost, before: state.contacts }],
    message: `${LIMBS[action.limb].label}: ${TECHNIQUES[action.technique].label.toLowerCase()} on hold ${action.hold + 1}. -${preview.cost} energy.${preview.releasedLimb ? ` Foot switch: ${LIMBS[preview.releasedLimb].label.toLowerCase()} is now hanging.` : action.mode === "dyno" ? " Feet cut loose. Replant them." : ""}`,
  };
  if (["leftHand", "rightHand"].every((limb) => puzzle.holds[contacts[limb].hold].kind === "finish")) {
    next.status = "sent";
    next.message = state.falls === 0 && state.undos === 0 ? "FLASH! Both hands controlled on the top." : "TOP! You found your beta.";
  }
  return next;
}
