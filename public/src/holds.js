export function holdIcon(grip) {
  const shapes = {
    jug: '<path class="hold-solid" d="M8 25Q5 6 24 5Q48 0 55 18L52 40Q47 51 31 50L13 44Z"/><path class="hold-inset" d="M15 21Q17 9 34 12Q46 12 48 20L41 27L20 28Z"/><path class="hold-shine" d="M13 32Q30 39 48 29"/>',
    edge: '<path class="hold-solid" d="M5 23L49 15L56 23L52 34L11 41L4 32Z"/><path class="hold-inset" d="M6 24L49 16L52 22L11 31Z"/><path class="hold-shine" d="M10 33L49 26"/>',
    pinch: '<path class="hold-solid" d="M23 3L42 6L49 16L43 28L49 42L37 54L20 50L12 39L17 25L12 13Z"/><path class="hold-inset" d="M20 14L25 21L23 37L19 43L15 36L19 24L15 15ZM41 14L37 23L39 37L44 42L46 37L40 26L46 17Z"/><path class="hold-shine" d="M28 12L32 44"/>',
    sloper: '<path class="hold-solid" d="M5 39C4 1 51 -6 56 35L54 44Q30 54 6 45Z"/><path class="hold-shine" d="M13 27Q19 9 38 15"/>',
    pocket: '<path class="hold-solid" d="M11 10L38 5L52 17L54 37L39 51L16 47L6 29Z"/><ellipse class="hold-inset" cx="30" cy="25" rx="10" ry="13"/><path class="hold-shine" d="M17 37Q29 46 43 34"/>',
    chip: '<path class="hold-solid" d="M8 37L34 15L51 33L46 41L17 45Z"/><path class="hold-inset" d="M8 37L34 15L32 31Z"/><path class="hold-shine" d="M17 37L43 34"/>',
  };
  return `<svg class="hold-sculpture" viewBox="0 0 60 60" aria-hidden="true">${shapes[grip]}</svg>`;
}
