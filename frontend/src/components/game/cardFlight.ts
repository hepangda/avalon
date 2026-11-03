import { animate } from 'framer-motion';

/**
 * The identity card's trips between the dock's face-down chip and the middle of the screen.
 * `pop` is the full-size card frame at rest in the middle; `rotor` turns it over.
 */
const EASE = [0.5, 0, 0.2, 1] as const;
const EASE_OUT = [0.2, 0.8, 0.25, 1] as const;
/** The chip leans a little in the dock (see .identity-chip). */
const CHIP_TILT = -4;

function offset(pop: HTMLElement, chip: HTMLElement) {
  // Measure the card at rest: after a trip it is still parked, shrunk, over the chip.
  const parked = pop.style.transform;
  pop.style.transform = 'none';
  const from = pop.getBoundingClientRect();
  pop.style.transform = parked;
  const to = chip.getBoundingClientRect();
  return {
    dx: to.left + to.width / 2 - (from.left + from.width / 2),
    dy: to.top + to.height / 2 - (from.top + from.height / 2),
    scale: chip.offsetHeight / pop.offsetHeight,
  };
}

/** Bring a card the player already knows out of the chip, turning it over in one motion on the way. */
export async function flyFromChip(pop: HTMLElement, rotor: HTMLElement, chip: HTMLElement | null, duration = 0.55) {
  pop.style.opacity = '1';
  if (!chip || duration === 0) {
    rotor.style.transform = 'rotateY(0deg)';
    return;
  }
  const { dx, dy, scale } = offset(pop, chip);
  void animate(rotor, { rotateY: [180, 0] }, { duration, ease: [0.4, 0, 0.2, 1] });
  await animate(pop, {
    x: [dx, 0],
    y: [dy, 0],
    scale: [scale, 1],
    rotate: [CHIP_TILT, 0],
  }, { duration, ease: EASE_OUT });
}

/** Turn the card face down and slide it back into the chip; resolves when it lands. */
export async function flyToChip(pop: HTMLElement, rotor: HTMLElement, chip: HTMLElement | null, duration = 0.75) {
  if (chip && duration > 0) {
    const { dx, dy, scale } = offset(pop, chip);
    void animate(rotor, { rotateY: [0, 180], rotateX: [0, 0] }, { duration: duration * 0.55, ease: 'easeInOut' });
    await animate(pop, {
      x: [0, dx * 0.08, dx],
      y: [0, -14, dy],
      scale: [1, 1.04, scale],
      rotate: [0, 2, CHIP_TILT],
    }, { duration, times: [0, 0.25, 1], ease: [EASE, EASE] });
  }
  pop.style.opacity = '0';
  if (chip && duration > 0) bounceChip(chip);
}

/** The chip takes the weight of the card just put away. */
export function bounceChip(chip: HTMLElement) {
  chip.animate([
    { transform: `rotate(${CHIP_TILT}deg) scale(1)` },
    { transform: `rotate(${CHIP_TILT}deg) scale(1.22)`, boxShadow: '0 0 0 2px #e6c14a, 0 0 22px 6px #e6c14a99' },
    { transform: `rotate(${CHIP_TILT}deg) scale(1)` },
  ], { duration: 380, easing: 'cubic-bezier(0.3, 1.4, 0.5, 1)' });
}

/** Put the card back in the middle, face up, after a trip that did not go through. */
export function returnToCenter(pop: HTMLElement, rotor: HTMLElement, duration = 0.45) {
  pop.style.opacity = '1';
  void animate(pop, { x: 0, y: 0, scale: 1, rotate: 0 }, { duration, ease: EASE_OUT });
  void animate(rotor, { rotateY: 0 }, { duration, ease: 'easeInOut' });
}
