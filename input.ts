import {useEffect, useRef, type MutableRefObject, type RefObject} from 'react';

/** Actions that can be triggered by the user across Keyboard, Mouse, and Touch. */
export type InputAction =
  | 'aimLeg'
  | 'aimStraight'
  | 'aimOff'
  | 'lofted'
  | 'grounded'
  | 'defend'
  | 'callRun'
  | 'cancelRun'
  | 'left'
  | 'right'
  | 'up'
  | 'down'
  | 'confirm'
  | 'cancel'
  | 'tap';

/** Represents the state of the pointer (mouse/touch). */
export interface PointerState {
  /** Pointer position in NDC (-1..1) for raycasting. */
  nx: number;
  ny: number;
  /** Pointer position in client pixels (relative to container). */
  clientX: number;
  clientY: number;
  down: boolean;
}

/** Snapshot of the input state at a given frame. */
export interface InputSnapshot {
  actions: Record<InputAction, boolean>;
  pointer: PointerState;
  /** Normalized analog movement vector (-1..1 on x and y; +y is down/backward). */
  analogMove?: {x: number; y: number};
  /** Direct Shot Chart aim sector override (-1 = Leg, 0 = Straight, 1 = Off) from UI or keys. */
  aimLaneOverride?: -1 | 0 | 1 | null;
}

/**
 * Unified keyboard mapping:
 * - Shot Direction (Wagon Wheel): ArrowLeft/KeyA = Leg, ArrowUp/KeyW = Straight, ArrowRight/KeyD = Off
 * - Shot Type (Swing Trigger): Space = Lofted, ArrowDown/KeyS = Grounded, KeyQ/Shift = Defend
 * - Running Between Wickets: KeyR/Enter = Call Run (+1), KeyC = Cancel Run / Return to Crease
 */
const ACTION_KEYS: Record<string, InputAction[]> = {
  // Shot Chart Aiming
  ArrowLeft: ['aimLeg', 'left'],
  a: ['aimLeg', 'left'],
  A: ['aimLeg', 'left'],
  KeyA: ['aimLeg', 'left'],

  ArrowUp: ['aimStraight', 'up'],
  w: ['aimStraight', 'up'],
  W: ['aimStraight', 'up'],
  KeyW: ['aimStraight', 'up'],

  ArrowRight: ['aimOff', 'right'],
  d: ['aimOff', 'right'],
  D: ['aimOff', 'right'],
  KeyD: ['aimOff', 'right'],

  // Shot Swing Triggers
  ' ': ['lofted', 'confirm'],
  Space: ['lofted', 'confirm'],

  ArrowDown: ['grounded', 'down'],
  s: ['grounded', 'down'],
  S: ['grounded', 'down'],
  KeyS: ['grounded', 'down'],

  q: ['defend'],
  Q: ['defend'],
  KeyQ: ['defend'],
  Shift: ['defend'],
  ShiftLeft: ['defend'],
  ShiftRight: ['defend'],

  // Running Between the Wickets
  r: ['callRun'],
  R: ['callRun'],
  KeyR: ['callRun'],
  Enter: ['callRun', 'confirm'],

  c: ['cancelRun'],
  C: ['cancelRun'],
  KeyC: ['cancelRun'],

  // Pause / Menu
  Escape: ['cancel'],
};

function createEmptyActions(): Record<InputAction, boolean> {
  return {
    aimLeg: false,
    aimStraight: false,
    aimOff: false,
    lofted: false,
    grounded: false,
    defend: false,
    callRun: false,
    cancelRun: false,
    left: false,
    right: false,
    up: false,
    down: false,
    confirm: false,
    cancel: false,
    tap: false,
  };
}

/** Creates a fresh, zeroed InputSnapshot for 3D games and on-screen HUD overlays. */
export function createInitialInputSnapshot(): InputSnapshot {
  return {
    actions: createEmptyActions(),
    pointer: {nx: 0, ny: 0, clientX: 0, clientY: 0, down: false},
    analogMove: {x: 0, y: 0},
    aimLaneOverride: null,
  };
}

/**
 * Converts a pointer event on the renderer container to NDC coordinates (-1..1).
 */
function getPointerNDC(
  event: PointerEvent,
  container: HTMLElement,
): {nx: number; ny: number; clientX: number; clientY: number} {
  const rect = container.getBoundingClientRect();
  const width = rect.width || 1;
  const height = rect.height || 1;
  const clientX = event.clientX - rect.left;
  const clientY = event.clientY - rect.top;
  const nx = (clientX / width) * 2 - 1;
  const ny = -(clientY / height) * 2 + 1;
  return {nx, ny, clientX, clientY};
}

/**
 * Unified input hook for 3D games.
 */
export function useInput(
  containerRef: RefObject<HTMLDivElement>,
  options: {
    enabled?: boolean;
    externalInputRef?: MutableRefObject<InputSnapshot>;
  } = {},
): MutableRefObject<InputSnapshot> {
  const {enabled = true, externalInputRef} = options;
  const internalInputRef = useRef<InputSnapshot>(createInitialInputSnapshot());
  const inputRef = externalInputRef ?? internalInputRef;

  useEffect(() => {
    if (!enabled) {
      Object.assign(inputRef.current, createInitialInputSnapshot());
      return;
    }

    const activePointers = new Map<
      number,
      {nx: number; ny: number; clientX: number; clientY: number}
    >();

    const handleKeyDown = (event: KeyboardEvent) => {
      const mapped = ACTION_KEYS[event.code] ?? ACTION_KEYS[event.key];
      if (!mapped) return;

      const hasModal = document.querySelector('[data-overlay-container]');
      const active = document.activeElement;
      const isTextControl =
        active instanceof HTMLElement &&
        active.matches('input, select, textarea, [contenteditable="true"]');

      // During live gameplay (no modal open & not typing in an input), always
      // prevent default browser scrolling/button-activation on Space/Enter/Arrows
      // even if the player previously clicked an on-screen HUD button!
      const isCancelOnly = mapped.length === 1 && mapped[0] === 'cancel';
      if (!hasModal && !isTextControl && !isCancelOnly) {
        if (
          active instanceof HTMLButtonElement &&
          active.dataset.hudControl === 'true'
        ) {
          active.blur();
        }
        event.preventDefault();
      }

      if (hasModal && !isCancelOnly) {
        return;
      }

      for (const act of mapped) {
        inputRef.current.actions[act] = true;
      }
      if (mapped.includes('aimLeg')) {
        inputRef.current.aimLaneOverride = -1;
      } else if (mapped.includes('aimStraight')) {
        inputRef.current.aimLaneOverride = 0;
      } else if (mapped.includes('aimOff')) {
        inputRef.current.aimLaneOverride = 1;
      }
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      const mapped = ACTION_KEYS[event.code] ?? ACTION_KEYS[event.key];
      if (!mapped) return;
      for (const act of mapped) {
        inputRef.current.actions[act] = false;
      }
    };

    const container = containerRef.current;
    const handlePointerDown = (event: PointerEvent) => {
      if (!container) return;
      const pos = getPointerNDC(event, container);
      activePointers.set(event.pointerId, pos);
      inputRef.current.pointer = {...pos, down: true};
      inputRef.current.actions.tap = true;
    };

    const handlePointerMove = (event: PointerEvent) => {
      if (!container) return;
      const pos = getPointerNDC(event, container);
      if (activePointers.has(event.pointerId)) {
        activePointers.set(event.pointerId, pos);
      }
      inputRef.current.pointer = {...pos, down: activePointers.size > 0};
    };

    const handlePointerUp = (event: PointerEvent) => {
      if (!container) return;
      activePointers.delete(event.pointerId);
      inputRef.current.actions.tap = false;
      if (activePointers.size > 0) {
        const latestPos = Array.from(activePointers.values()).pop();
        if (latestPos) {
          inputRef.current.pointer = {...latestPos, down: true};
        }
      } else {
        const pos = getPointerNDC(event, container);
        inputRef.current.pointer = {...pos, down: false};
      }
    };

    const handleBlur = () => {
      activePointers.clear();
      const preservedAim = inputRef.current.aimLaneOverride ?? null;
      Object.assign(inputRef.current, createInitialInputSnapshot());
      inputRef.current.aimLaneOverride = preservedAim;
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        handleBlur();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur);
    window.addEventListener('visibilitychange', handleVisibilityChange);

    if (container) {
      container.addEventListener('pointerdown', handlePointerDown);
      container.addEventListener('pointermove', handlePointerMove);
      container.addEventListener('pointerup', handlePointerUp);
      container.addEventListener('pointercancel', handlePointerUp);
    }

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);
      window.removeEventListener('visibilitychange', handleVisibilityChange);

      if (container) {
        container.removeEventListener('pointerdown', handlePointerDown);
        container.removeEventListener('pointermove', handlePointerMove);
        container.removeEventListener('pointerup', handlePointerUp);
        container.removeEventListener('pointercancel', handlePointerUp);
      }
    };
  }, [containerRef, enabled, inputRef]);

  return inputRef;
}
