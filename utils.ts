import * as THREE from 'three';

export {
  BackgroundMusic,
  createSeamlessLoopBuffer,
  scanAudioBoundaries,
  type AudioBoundaries,
  type BackgroundMusicProps,
  type SeamlessLoopResult,
} from './utils/BackgroundMusic';
export {
  MenuOverlay,
  Overlay,
  clamp,
  createFixedStepper,
  drawAsset,
  drawBackground,
  formatTime,
  gameAudio,
  prepareCanvas,
  shuffle,
  useAssets,
  useAutoFocus,
  useInput,
  useIsMobile,
  useModalDialog,
  useOverlayFocusNavigation,
  type Entity,
  type GamePhase,
  type GameState,
  type InputAction,
  type InputSnapshot,
  type MenuOverlayProps,
  type MusicTrack,
  type OverlayProps,
  type OverlayTone,
  type PointerState,
  type Position,
  type SpriteConfig,
} from './utils/helper';
export {
  getPlaygroundBootState,
  usePlayground,
  usePlaygroundGameLifecycle,
  usePlaygroundResume,
  useRpc,
  type BaseGameState,
  type BooleanConfigEntry,
  type ColorConfigEntry,
  type ConfigEntry,
  type ConfigValues,
  type GameConfig,
  type HostPlaygroundBootState,
  type NumberConfigEntry,
  type PlaygroundBootState,
  type PlaygroundResumeState,
  type SelectConfigEntry,
  type UsePlaygroundResumeOptions,
  type Vector2ConfigEntry,
} from './utils/usePlayground';

/** Converts degrees to radians. */
export function degToRad(deg: number): number {
  return deg * (Math.PI / 180);
}

/** Converts radians to degrees. */
export function radToDeg(rad: number): number {
  return rad * (180 / Math.PI);
}

/** Random float in [min, max). */
export function randomRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/** Random integer in [min, max] (inclusive). */
export function randomInt(min: number, max: number): number {
  return Math.floor(randomRange(min, max + 1));
}

/**
 * Seeded pseudo-random number generator (Mulberry32).
 * Produces deterministic sequences — useful for procedural generation
 * that must be identical across clients / runs.
 *
 * Usage:
 *   const rng = createSeededRandom(12345);
 *   const val = rng(); // 0..1, deterministic
 */
export function createSeededRandom(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), s | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ============================================================================
// Rapier-safe type conversions
// ============================================================================
// Rapier (WASM) expects plain {x,y,z} / {x,y,z,w} objects. Passing Three.js
// class instances (THREE.Vector3, THREE.Quaternion) directly causes:
//   "recursive use of an object detected which would lead to unsafe aliasing in rust"
// Always use these helpers (or inline object literals) when calling Rapier APIs
// such as setTranslation, setRotation, setLinvel, applyImpulse, etc.
// ============================================================================

interface Vec3 {
  x: number;
  y: number;
  z: number;
}

interface Quat {
  x: number;
  y: number;
  z: number;
  w: number;
}

function finite(n: number): number {
  return Number.isFinite(n) ? n : 0;
}

/**
 * Converts any {x,y,z} object (including THREE.Vector3) to a plain,
 * NaN/Infinity-safe Rapier object literal. Use when calling
 * body.setTranslation(), body.setLinvel(), body.applyImpulse(), etc.
 *
 * Usage:
 *   body.setTranslation(toVec3(mesh.position), true);
 *   body.setLinvel(toVec3(velocity), true);
 */
export function toVec3(v: Vec3): Vec3 {
  return {
    x: finite(v.x),
    y: finite(v.y),
    z: finite(v.z),
  };
}

/**
 * Converts any {x,y,z,w} object (including THREE.Quaternion) to a plain,
 * NaN/Infinity-safe Rapier object literal, falling back to the identity
 * quaternion {x: 0, y: 0, z: 0, w: 1} when any component is non-finite or
 * the length is near zero. Use when calling body.setRotation(),
 * body.setNextKinematicRotation(), etc.
 *
 * Usage:
 *   body.setRotation(toQuat(mesh.quaternion), true);
 *
 *   // From Euler angles:
 *   const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz));
 *   body.setRotation(toQuat(q), true);
 */
export function toQuat(q: Quat): Quat {
  const {x, y, z, w} = q;
  const lenSq = x * x + y * y + z * z + w * w;
  if (!Number.isFinite(lenSq) || lenSq <= 1e-12) {
    return {x: 0, y: 0, z: 0, w: 1};
  }
  const len = Math.sqrt(lenSq);
  return {
    x: x / len,
    y: y / len,
    z: z / len,
    w: w / len,
  };
}

/**
 * Returns false if the RigidBody ref is null, removed from the physics world
 * (avoiding "Invalid RigidBody reference" WASM panics from stale refs after
 * unmount), or belongs to a freed physics world.
 */
export function isBodyAlive(
  body: {isValid(): boolean} | null | undefined,
): boolean {
  try {
    return Boolean(body?.isValid());
  } catch {
    return false;
  }
}

/** Hit result returned by `castProjectileRay`. */
export interface ProjectileRayHit {
  toi: number;
  timeOfImpact: number;
  point: Vec3;
  collider: unknown;
}

interface RapierRayHitLike {
  toi?: number;
  timeOfImpact?: number;
  collider?: unknown;
}

interface RapierWorldLike {
  castRay(
    ray: unknown,
    maxToi: number,
    solid: boolean,
    filterFlags?: number,
    filterGroups?: number,
    filterExcludeCollider?: unknown,
    filterExcludeRigidBody?: unknown,
    filterPredicate?: (collider: unknown) => boolean,
  ): RapierRayHitLike | null;
}

/**
 * Casts a swept continuous-collision ray for fast 3D/FPS projectiles while
 * excluding the shooter's own RigidBody (and offsetting the ray origin slightly
 * forward when no `shooterBody` is provided) so projectiles never self-collide
 * at `toi = 0` or tunnel through thin targets.
 *
 * Accepts either `(world, origin, dir, maxToi, shooterBody?, minSelfClearance?)`
 * or `(world, rapier, origin, dir, maxToi, shooterBody?, minSelfClearance?)`,
 * and normalizes Rapier's `toi` / `timeOfImpact` fields across Rapier versions.
 */
export function castProjectileRay(
  world: RapierWorldLike | null | undefined,
  originOrRapier:
    | Vec3
    | {Ray?: new (origin: Vec3, dir: Vec3) => unknown}
    | null
    | undefined,
  dirOrOrigin: Vec3,
  maxToiOrDir: number | Vec3,
  shooterBodyOrMaxToi?: {isValid?(): boolean} | number | null,
  minSelfClearanceOrShooterBody?: number | {isValid?(): boolean} | null,
  maybeMinSelfClearance = 0.6,
): ProjectileRayHit | null {
  if (!world || !originOrRapier) return null;
  const hasRapierArg = typeof (originOrRapier as Vec3).x !== 'number';
  const rapierCtor = hasRapierArg
    ? (originOrRapier as {Ray?: new (origin: Vec3, dir: Vec3) => unknown}).Ray
    : undefined;
  const origin = hasRapierArg ? dirOrOrigin : (originOrRapier as Vec3);
  const dir = hasRapierArg ? (maxToiOrDir as Vec3) : dirOrOrigin;
  const maxToi = hasRapierArg
    ? (shooterBodyOrMaxToi as number)
    : (maxToiOrDir as number);
  const shooterBody = hasRapierArg
    ? (minSelfClearanceOrShooterBody as
        | {isValid?(): boolean}
        | null
        | undefined)
    : (shooterBodyOrMaxToi as {isValid?(): boolean} | null | undefined);
  const minSelfClearance = hasRapierArg
    ? maybeMinSelfClearance
    : typeof minSelfClearanceOrShooterBody === 'number'
      ? minSelfClearanceOrShooterBody
      : 0.6;

  if (!origin || !dir) return null;
  const safeMaxToi = finite(maxToi);
  if (safeMaxToi <= 0) return null;
  const dx = finite(dir.x);
  const dy = finite(dir.y);
  const dz = finite(dir.z);
  const dirLen = Math.hypot(dx, dy, dz);
  if (dirLen <= 1e-8) return null;
  const nx = dx / dirLen;
  const ny = dy / dirLen;
  const nz = dz / dirLen;
  const validShooter =
    shooterBody &&
    (typeof shooterBody.isValid !== 'function' ||
      isBodyAlive(shooterBody as {isValid(): boolean}))
      ? shooterBody
      : undefined;
  const offset = validShooter ? 0 : Math.max(0, finite(minSelfClearance));
  const start = {
    x: finite(origin.x) + nx * offset,
    y: finite(origin.y) + ny * offset,
    z: finite(origin.z) + nz * offset,
  };
  const rayDir = {x: nx, y: ny, z: nz};
  try {
    const ray = rapierCtor
      ? new rapierCtor(start, rayDir)
      : {origin: start, dir: rayDir};
    const hit = world.castRay(
      ray,
      safeMaxToi,
      true,
      undefined,
      undefined,
      undefined,
      validShooter,
    );
    const rawToi =
      hit && typeof hit.toi === 'number' ? hit.toi : hit?.timeOfImpact;
    if (typeof rawToi !== 'number' || !Number.isFinite(rawToi) || rawToi < 0) {
      return null;
    }
    const resolvedToi = rawToi + offset;
    return {
      toi: resolvedToi,
      timeOfImpact: resolvedToi,
      point: {
        x: start.x + nx * rawToi,
        y: start.y + ny * rawToi,
        z: start.z + nz * rawToi,
      },
      collider: hit?.collider,
    };
  } catch {
    return null;
  }
}

// ============================================================================
// Memory GC Safe Temporary Variables
// ============================================================================
// Exporting pre-allocated memory structures so you do not instantiate objects
// inside useFrame. Import these to do Math locally.

/** Memory GC safe temporary Vector3 for local calculations in useFrame. */
export const tempVec3 = new THREE.Vector3();

/** Secondary memory GC safe temporary Vector3 for local calculations. */
export const tempVec3B = new THREE.Vector3();

/** Memory GC safe temporary Quaternion for local calculations. */
export const tempQuat = new THREE.Quaternion();

/** Memory GC safe temporary Matrix4 for local calculations. */
export const tempMatrix = new THREE.Matrix4();

/** Memory GC safe temporary Euler angles for local calculations. */
export const tempEuler = new THREE.Euler();
// ============================================================================
