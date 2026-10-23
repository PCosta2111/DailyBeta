import { GRIPS, canMatchHands } from "./rules.js";

export class Queue {
  items = [];

  push(node) {
    const items = this.items;
    items.push(node);
    let index = items.length - 1;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (items[parent].priority <= node.priority) break;
      items[index] = items[parent];
      index = parent;
    }
    items[index] = node;
  }

  pop() {
    const items = this.items;
    const first = items[0], last = items.pop();
    if (items.length) {
      let index = 0;
      while (index * 2 + 1 < items.length) {
        let child = index * 2 + 1;
        if (child + 1 < items.length && items[child + 1].priority < items[child].priority) child++;
        if (last.priority <= items[child].priority) break;
        items[index] = items[child];
        index = child;
      }
      items[index] = last;
    }
    return first;
  }
}

export function candidateMoves(puzzle) {
  const actions = [];
  for (const hold of puzzle.holds) {
    const grip = GRIPS[hold.grip];
    // More expensive compatible grips do not change future moves.
    if (grip.hands.length) {
      const technique = grip.hands[0];
      for (const limb of ["leftHand", "rightHand"]) {
        for (const mode of ["static", "dyno"]) actions.push({ limb, hold: hold.id, technique, mode });
      }
      if (canMatchHands(hold)) actions.push({ limb: "bothHands", hold: hold.id, technique, mode: "dyno" });
    }
    for (const limb of ["leftFoot", "rightFoot"]) {
      for (const technique of ["stand", ...grip.hooks]) actions.push({ limb, hold: hold.id, technique, mode: "static" });
    }
  }
  return actions;
}
