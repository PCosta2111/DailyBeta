import { findOptimalV2Beta } from "./solver.js";

self.onmessage = ({ data: puzzle }) => {
  try {
    self.postMessage({ result: findOptimalV2Beta(puzzle, (progress) => self.postMessage({ progress })) });
  } catch (error) {
    console.error("Could not find v2 beta:", error);
    self.postMessage({ error: "Couldn't calculate a v2 beta for this route. Try again." });
  }
};
