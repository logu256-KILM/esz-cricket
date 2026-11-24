import {Canvas, useFrame, useThree} from '@react-three/fiber';
import {Bloom, EffectComposer} from '@react-three/postprocessing';
import {CuboidCollider, Physics, RigidBody} from '@react-three/rapier';
import type {MutableRefObject} from 'react';
import React, {
  Component,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import * as THREE from 'three';
import {HumanoidCharacter} from './components/HumanoidCharacter';
import {
  DELIVERY_META,
  FIELDER_THROW_SPEED_BASE,
  RUNNING_CREASE_SPEED,
  SHOT_CHART_SECTORS,
  SOUTH_ASIAN_SKIN_TONES,
  TEAMS,
  getConfig,
} from './constants';
import {InputSnapshot, useInput} from './input';
import {
  ActionControlMode,
  AimDirection,
  BatSkinId,
  DeliveryType,
  LiveScoreHud,
  MatchConfig,
  ShotType,
  TimingGrade,
  TimingMeterSnapshot,
} from './types';
import {createSeededRandom} from './utils';
import {GameState, gameAudio} from './utils/helper';

// ============================================================================
// MODULE-SCOPE STATIC CONFIGS & SCRATCH VECTORS (Zero GC in useFrame)
// ============================================================================

const STATIC_CAMERA_PROPS = {
  fov: 52,
  near: 0.1,
  far: 420,
  position: [0.35, 3.45, 15.8] as [number, number, number],
};

const sunFocus = new THREE.Vector3();
const sunForward = new THREE.Vector3();
const camTargetPos = new THREE.Vector3();
const camTargetLook = new THREE.Vector3();
const currentLookAt = new THREE.Vector3(0, 1.0, -4);
const scratchObj = new THREE.Object3D();
const scratchColor = new THREE.Color();

const SUN_FOCUS_DISTANCE = 14;
const SUN_OFFSET: readonly [number, number, number] = [16, 34, 18];
const SUN_SHADOW_EXTENT = 40;

const PITCH_SURFACE_Y = 0.045;

/** 9 Standard Fielding Positions [x, z] (Batter at +10 facing -Z; -X = Leg Side, +X = Off Side) */
const BASE_FIELDER_SPOTS: ReadonlyArray<readonly [number, number]> = [
  [-13.5, 4.5], // Square Leg (Inner Ring)
  [-16.0, -7.5], // Mid-Wicket (Inner Ring)
  [-26.0, -34.0], // Long-On (Boundary)
  [25.5, -34.5], // Long-Off (Boundary)
  [15.5, -6.5], // Extra Cover (Inner Ring)
  [14.5, 5.5], // Point (Inner Ring)
  [37.0, 16.0], // Deep Backward Point / Third Man
  [-38.0, 14.5], // Deep Fine / Backward Square Leg
  [-39.0, -14.0], // Deep Mid-Wicket Sweeper
];

const FIELDER_JERSEY_NUMBERS = [8, 12, 33, 45, 17, 24, 99, 3, 63];

const TRAIL_COUNT = 22;
const FIREWORK_PARTICLES = 120;
const CROWD_COUNT = 380;
const DUST_COUNT = 75;

// ============================================================================
// PROCEDURAL CANVAS PBR TEXTURES (Zero External Image URLs)
// ============================================================================

function makeCanvasTexture(
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
  w = 512,
  h = 512,
  repeatX = 1,
  repeatY = 1,
  isColor = true,
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    draw(ctx, w, h);
  }
  const tex = new THREE.CanvasTexture(canvas);
  if (isColor) {
    tex.colorSpace = THREE.SRGBColorSpace;
  }
  if (repeatX > 1 || repeatY > 1) {
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeatX, repeatY);
  }
  return tex;
}

let cachedGrassPack: {
  map: THREE.CanvasTexture;
  roughnessMap: THREE.CanvasTexture;
} | null = null;

/**
 * Generates radial + striped mowed grass PBR textures (#2e7d32 and #388e3c)
 * with subtle grass-grain roughness across the stadium outfield.
 */
function getOutfieldGrassTextures() {
  if (cachedGrassPack) return cachedGrassPack;
  const rng = createSeededRandom(90210);
  const size = 1024;
  const cx = size * 0.5;
  const cy = size * 0.5;

  const map = makeCanvasTexture(
    (ctx, w, h) => {
      ctx.fillStyle = '#2e7d32';
      ctx.fillRect(0, 0, w, h);

      // Alternating radial mowed sectors
      const sectors = 24;
      for (let s = 0; s < sectors; s++) {
        const a0 = (s / sectors) * Math.PI * 2;
        const a1 = ((s + 1) / sectors) * Math.PI * 2;
        ctx.fillStyle = s % 2 === 0 ? '#388e3c' : '#2e7d32';
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, w * 0.72, a0, a1);
        ctx.closePath();
        ctx.fill();
      }

      // Concentric stadium mower rings & linear cross-stripes
      for (let r = 48; r < w * 0.68; r += 38) {
        ctx.strokeStyle =
          ((r / 38) | 0) % 2 === 0
            ? 'rgba(255, 255, 255, 0.055)'
            : 'rgba(0, 0, 0, 0.055)';
        ctx.lineWidth = 19;
        ctx.beginPath();
        ctx.arc(cx, cy, Math.max(4, r), 0, Math.PI * 2);
        ctx.stroke();
      }

      const stripes = 32;
      const stripeW = w / stripes;
      for (let i = 0; i < stripes; i++) {
        ctx.fillStyle =
          i % 2 === 0 ? 'rgba(255,255,255,0.038)' : 'rgba(0,0,0,0.038)';
        ctx.fillRect(i * stripeW, 0, stripeW, h);
      }

      // Fine organic grass-blade speckles
      for (let i = 0; i < 14000; i++) {
        const gx = rng() * w;
        const gy = rng() * h;
        ctx.fillStyle =
          rng() < 0.5 ? 'rgba(102, 187, 106, 0.16)' : 'rgba(27, 94, 32, 0.18)';
        ctx.fillRect(gx, gy, 2, 2);
      }
    },
    size,
    size,
    1,
    1,
    true,
  );

  const roughnessMap = makeCanvasTexture(
    (ctx, w, h) => {
      ctx.fillStyle = '#c8c8c8';
      ctx.fillRect(0, 0, w, h);
      const stripes = 32;
      const stripeW = w / stripes;
      for (let i = 0; i < stripes; i++) {
        ctx.fillStyle = i % 2 === 0 ? '#bcbcbc' : '#dadada';
        ctx.fillRect(i * stripeW, 0, stripeW, h);
      }
      for (let i = 0; i < 9000; i++) {
        const gx = rng() * w;
        const gy = rng() * h;
        ctx.fillStyle = rng() < 0.5 ? '#a8a8a8' : '#eaeaea';
        ctx.fillRect(gx, gy, 2, 2);
      }
    },
    512,
    512,
    4,
    4,
    false,
  );

  cachedGrassPack = {map, roughnessMap};
  return cachedGrassPack;
}

let cachedPitchPack: {
  map: THREE.CanvasTexture;
  roughnessMap: THREE.CanvasTexture;
} | null = null;

/**
 * Generates raised 22-yard clay pitch PBR textures (#d7b889) with worn good-length
 * scuff patches, dry clay grain, and crisp white bowling/popping/return creases.
 */
function getClayPitchTextures() {
  if (cachedPitchPack) return cachedPitchPack;
  const rng = createSeededRandom(4242);

  const map = makeCanvasTexture(
    (ctx, w, h) => {
      // Base rolled clay #d7b889
      ctx.fillStyle = '#d7b889';
      ctx.fillRect(0, 0, w, h);

      // Rolled clay grain & fine dry cracks
      for (let i = 0; i < 7500; i++) {
        const x = rng() * w;
        const y = rng() * h;
        ctx.fillStyle =
          rng() < 0.5
            ? 'rgba(150, 112, 66, 0.22)'
            : 'rgba(247, 228, 192, 0.22)';
        ctx.fillRect(x, y, 2, 3);
      }

      ctx.strokeStyle = 'rgba(120, 86, 48, 0.18)';
      ctx.lineWidth = 1;
      for (let c = 0; c < 85; c++) {
        const sx = rng() * w;
        const sy = rng() * h;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(sx + (rng() - 0.5) * 26, sy + (rng() - 0.5) * 26);
        ctx.stroke();
      }

      // Worn good-length landing zones & bowler follow-through footmarks
      const scuffZones = [
        {x: w * 0.5, y: h * 0.26, r: w * 0.3},
        {x: w * 0.32, y: h * 0.18, r: w * 0.18},
        {x: w * 0.5, y: h * 0.74, r: w * 0.3},
        {x: w * 0.68, y: h * 0.82, r: w * 0.18},
      ];
      scuffZones.forEach((z) => {
        const g = ctx.createRadialGradient(
          z.x,
          z.y,
          4,
          z.x,
          z.y,
          Math.max(8, z.r),
        );
        g.addColorStop(0, 'rgba(112, 79, 42, 0.36)');
        g.addColorStop(0.6, 'rgba(135, 98, 56, 0.16)');
        g.addColorStop(1, 'rgba(135, 98, 56, 0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
      });

      // Individual dark leather ball & spike scuff marks on good length
      for (let s = 0; s < 75; s++) {
        const topEnd = s % 2 === 0;
        const sx = w * (0.28 + rng() * 0.44);
        const sy = h * (topEnd ? 0.2 + rng() * 0.16 : 0.64 + rng() * 0.16);
        ctx.fillStyle = 'rgba(92, 64, 34, 0.35)';
        ctx.beginPath();
        ctx.ellipse(sx, sy, 4 + rng() * 5, 8 + rng() * 10, 0, 0, Math.PI * 2);
        ctx.fill();
      }

      // Crisp White Bowling, Popping, and Return Creases (both ends)
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 7;

      // Bowling end (-Z / top)
      const bowlStumpY = h * 0.065;
      const bowlPopY = h * 0.12;
      ctx.beginPath();
      ctx.moveTo(w * 0.13, bowlStumpY);
      ctx.lineTo(w * 0.87, bowlStumpY);
      ctx.moveTo(w * 0.05, bowlPopY);
      ctx.lineTo(w * 0.95, bowlPopY);
      ctx.moveTo(w * 0.13, 0);
      ctx.lineTo(w * 0.13, bowlPopY);
      ctx.moveTo(w * 0.87, 0);
      ctx.lineTo(w * 0.87, bowlPopY);
      ctx.stroke();

      // Wide guideline ticks
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(w * 0.22, bowlStumpY);
      ctx.lineTo(w * 0.22, bowlPopY);
      ctx.moveTo(w * 0.78, bowlStumpY);
      ctx.lineTo(w * 0.78, bowlPopY);
      ctx.stroke();

      // Batting end (+Z / bottom)
      ctx.lineWidth = 7;
      const batStumpY = h * 0.935;
      const batPopY = h * 0.88;
      ctx.beginPath();
      ctx.moveTo(w * 0.13, batStumpY);
      ctx.lineTo(w * 0.87, batStumpY);
      ctx.moveTo(w * 0.05, batPopY);
      ctx.lineTo(w * 0.95, batPopY);
      ctx.moveTo(w * 0.13, batPopY);
      ctx.lineTo(w * 0.13, h);
      ctx.moveTo(w * 0.87, batPopY);
      ctx.lineTo(w * 0.87, h);
      ctx.stroke();

      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(w * 0.22, batPopY);
      ctx.lineTo(w * 0.22, batStumpY);
      ctx.moveTo(w * 0.78, batPopY);
      ctx.lineTo(w * 0.78, batStumpY);
      ctx.stroke();
    },
    512,
    1024,
    1,
    1,
    true,
  );

  const roughnessMap = makeCanvasTexture(
    (ctx, w, h) => {
      ctx.fillStyle = '#cfcfcf';
      ctx.fillRect(0, 0, w, h);
      // Rougher matte texture over scuffed good-length patches
      ctx.fillStyle = '#efefef';
      ctx.fillRect(w * 0.2, h * 0.18, w * 0.6, h * 0.18);
      ctx.fillRect(w * 0.2, h * 0.64, w * 0.6, h * 0.18);
    },
    256,
    512,
    1,
    1,
    false,
  );

  cachedPitchPack = {map, roughnessMap};
  return cachedPitchPack;
}

/** Stepped concrete seating + colorful procedural crowd dot-pattern texture */
function createGrandstandTierTexture(
  primaryColor: string,
  secondaryColor: string,
  opponentColor: string,
): THREE.CanvasTexture {
  const rng = createSeededRandom(5150);
  const crowdPalette = [
    primaryColor,
    secondaryColor,
    opponentColor,
    '#facc15',
    '#f8fafc',
    '#38bdf8',
    '#fb7185',
    '#fb923c',
  ];
  return makeCanvasTexture(
    (ctx, w, h) => {
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(0, 0, w, h);

      const rows = 10;
      const rowH = h / rows;
      for (let r = 0; r < rows; r++) {
        const y = r * rowH;
        // Stepped concrete riser & tread shadow
        ctx.fillStyle = r % 2 === 0 ? '#334155' : '#283548';
        ctx.fillRect(0, y, w, rowH - 2);
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(0, y + rowH - 3, w, 3);

        // Colorful procedural spectator dot-pattern along each seating row
        for (let x = 6; x < w - 6; x += 9) {
          if (rng() > 0.12) {
            ctx.fillStyle =
              crowdPalette[Math.floor(rng() * crowdPalette.length)];
            ctx.beginPath();
            ctx.arc(
              x + (rng() - 0.5) * 2,
              y + rowH * 0.52,
              3.1,
              0,
              Math.PI * 2,
            );
            ctx.fill();
          }
        }
      }
    },
    512,
    256,
    8,
    1,
    true,
  );
}

function createAdBoardTexture(
  label: string,
  bgHex: string,
  fgHex: string,
  accentHex: string,
): THREE.CanvasTexture {
  return makeCanvasTexture((ctx, w, h) => {
    ctx.fillStyle = bgHex;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = accentHex;
    ctx.fillRect(0, 0, 26, h);
    ctx.fillRect(w - 26, 0, 26, h);
    ctx.strokeStyle = fgHex;
    ctx.lineWidth = 6;
    ctx.strokeRect(6, 6, w - 12, h - 12);
    ctx.fillStyle = fgHex;
    ctx.font = '900 38px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, w / 2, h / 2);
  }, 512, 96);
}

let cachedBeamAlphaTex: THREE.CanvasTexture | null = null;
function getVolumetricBeamTexture(): THREE.CanvasTexture {
  if (cachedBeamAlphaTex) return cachedBeamAlphaTex;
  cachedBeamAlphaTex = makeCanvasTexture(
    (ctx, w, h) => {
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, 'rgba(255, 250, 220, 0.34)');
      g.addColorStop(0.35, 'rgba(254, 243, 199, 0.14)');
      g.addColorStop(0.8, 'rgba(254, 243, 199, 0.03)');
      g.addColorStop(1, 'rgba(254, 243, 199, 0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    },
    64,
    256,
    1,
    1,
    true,
  );
  return cachedBeamAlphaTex;
}

// ============================================================================
// STADIUM ARCHITECTURAL LANDMARKS (Members Pavilion, 3D Scoreboard, Lattice Towers)
// ============================================================================

/**
 * Two-story Glass-Fronted Members Pavilion behind the bowler's arm (-Z),
 * incorporating a crisp white Sightscreen at field level.
 */
const MembersPavilion = React.memo(function MembersPavilion({
  zPos,
  primaryColor,
  secondaryColor,
}: {
  zPos: number;
  primaryColor: string;
  secondaryColor: string;
}) {
  return (
    <group position={[0, 0, zPos]}>
      {/* Ground-Level Clean White Sightscreen Behind Bowler's Arm */}
      <group position={[0, 2.25, 2.8]}>
        <mesh castShadow receiveShadow>
          <boxGeometry args={[13.6, 4.5, 0.36]} />
          <meshStandardMaterial color="#f8fafc" roughness={0.55} />
        </mesh>
        {/* Sightscreen Side Support Slats */}
        {[-6.5, 6.5].map((sx, idx) => (
          <mesh key={idx} position={[sx, 0, -0.25]}>
            <boxGeometry args={[0.35, 4.5, 0.6]} />
            <meshStandardMaterial color="#475569" metalness={0.5} />
          </mesh>
        ))}
      </group>

      {/* Raised Sandstone & Concrete Pavilion Base Plinth */}
      <mesh position={[0, 1.4, -2.5]} castShadow receiveShadow>
        <boxGeometry args={[24.0, 2.8, 9.0]} />
        <meshStandardMaterial color="#e2e8f0" roughness={0.78} />
      </mesh>

      {/* Story 1: Lower Members Glass Lounge (y = 2.8 .. 6.6) */}
      <mesh position={[0, 4.7, -2.2]} castShadow>
        <boxGeometry args={[22.4, 3.8, 7.6]} />
        <meshStandardMaterial
          color="#38bdf8"
          emissive="#fef3c7"
          emissiveIntensity={0.42}
          roughness={0.16}
          metalness={0.72}
        />
      </mesh>

      {/* Mid-Tier VIP Balcony Slab & Team Trim */}
      <mesh position={[0, 6.75, -1.6]} castShadow receiveShadow>
        <boxGeometry args={[23.6, 0.45, 9.2]} />
        <meshStandardMaterial color="#f8fafc" roughness={0.6} />
      </mesh>
      <mesh position={[0, 7.25, 2.9]}>
        <boxGeometry args={[23.4, 0.65, 0.18]} />
        <meshStandardMaterial color={primaryColor} roughness={0.45} />
      </mesh>

      {/* Story 2: Upper Executive Glass Hospitality Suite (y = 7.0 .. 10.8) */}
      <mesh position={[0, 8.9, -2.4]} castShadow>
        <boxGeometry args={[21.2, 3.8, 7.0]} />
        <meshStandardMaterial
          color="#7dd3fc"
          emissive="#fde68a"
          emissiveIntensity={0.48}
          roughness={0.14}
          metalness={0.76}
        />
      </mesh>

      {/* Architectural Classical Columns Across Both Glass Stories */}
      {[-9.5, -5.7, -1.9, 1.9, 5.7, 9.5].map((cx, idx) => (
        <mesh key={idx} position={[cx, 6.8, 1.5]} castShadow>
          <cylinderGeometry args={[0.26, 0.3, 8.2, 10]} />
          <meshStandardMaterial color="#f1f5f9" roughness={0.55} />
        </mesh>
      ))}

      {/* Pavilion Crown Eaves & Heritage Peaked Roof */}
      <mesh position={[0, 11.05, -2.0]} castShadow>
        <boxGeometry args={[23.8, 0.55, 8.6]} />
        <meshStandardMaterial color="#f8fafc" roughness={0.5} />
      </mesh>
      <mesh
        position={[0, 12.6, -2.0]}
        rotation={[0, Math.PI / 4, 0]}
        scale={[1.9, 1, 0.72]}
        castShadow>
        <coneGeometry args={[9.2, 2.8, 4]} />
        <meshStandardMaterial
          color={secondaryColor}
          roughness={0.55}
          metalness={0.2}
        />
      </mesh>
    </group>
  );
});

/**
 * Tall Lattice-Steel LED Floodlight Tower with Cross-Bracing, Emissive LED Panels
 * and Volumetric Light Cones.
 */
const FloodlightTower = React.memo(function FloodlightTower({
  position,
  yaw,
}: {
  position: [number, number, number];
  yaw: number;
}) {
  const beamTex = useMemo(() => getVolumetricBeamTexture(), []);
  const bays = [0, 1, 2, 3, 4];

  return (
    <group position={position} rotation={[0, yaw, 0]}>
      {/* Concrete Foundation Pad */}
      <mesh position={[0, 0.4, 0]} receiveShadow>
        <boxGeometry args={[3.6, 0.8, 3.6]} />
        <meshStandardMaterial color="#475569" roughness={0.85} />
      </mesh>

      {/* 4 Tapered Lattice-Steel Corner Angles */}
      {[
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
      ].map(([sx, sz], idx) => (
        <mesh
          key={idx}
          position={[sx * 0.85, 15.2, sz * 0.85]}
          rotation={[sz * -0.028, 0, sx * 0.028]}
          castShadow>
          <cylinderGeometry args={[0.11, 0.2, 29.6, 6]} />
          <meshStandardMaterial
            color="#cbd5e1"
            metalness={0.72}
            roughness={0.32}
          />
        </mesh>
      ))}

      {/* Horizontal Steel Girts & Diagonal X-Bracing Lattice Bays */}
      {bays.map((bay) => {
        const yBase = 2.5 + bay * 5.4;
        const halfW = 1.15 - bay * 0.11;
        return (
          <group key={bay} position={[0, yBase, 0]}>
            {/* Horizontal Girt Frame */}
            <mesh position={[0, 2.6, halfW]}>
              <boxGeometry args={[halfW * 2, 0.12, 0.12]} />
              <meshStandardMaterial color="#94a3b8" metalness={0.68} />
            </mesh>
            <mesh position={[0, 2.6, -halfW]}>
              <boxGeometry args={[halfW * 2, 0.12, 0.12]} />
              <meshStandardMaterial color="#94a3b8" metalness={0.68} />
            </mesh>
            {/* Diagonal Lattice Struts (Front & Side Faces) */}
            <mesh position={[0, 0, halfW]} rotation={[0, 0, 0.42]}>
              <boxGeometry args={[0.08, 5.6, 0.08]} />
              <meshStandardMaterial color="#94a3b8" metalness={0.65} />
            </mesh>
            <mesh position={[0, 0, -halfW]} rotation={[0, 0, -0.42]}>
              <boxGeometry args={[0.08, 5.6, 0.08]} />
              <meshStandardMaterial color="#94a3b8" metalness={0.65} />
            </mesh>
            <mesh position={[halfW, 0, 0]} rotation={[0.42, 0, 0]}>
              <boxGeometry args={[0.08, 5.6, 0.08]} />
              <meshStandardMaterial color="#94a3b8" metalness={0.65} />
            </mesh>
            <mesh position={[-halfW, 0, 0]} rotation={[-0.42, 0, 0]}>
              <boxGeometry args={[0.08, 5.6, 0.08]} />
              <meshStandardMaterial color="#94a3b8" metalness={0.65} />
            </mesh>
          </group>
        );
      })}

      {/* Maintenance Catwalk Platform at 29.8m */}
      <mesh position={[0, 29.8, 0]}>
        <boxGeometry args={[4.4, 0.3, 2.4]} />
        <meshStandardMaterial color="#334155" metalness={0.6} roughness={0.4} />
      </mesh>

      {/* Multi-Bank Emissive LED Floodlight Head & Subtle Volumetric Light Cone */}
      <group position={[0, 32.0, 0.2]} rotation={[0.42, 0, 0]}>
        <mesh castShadow>
          <boxGeometry args={[7.4, 4.2, 0.65]} />
          <meshStandardMaterial
            color="#0f172a"
            metalness={0.65}
            roughness={0.35}
          />
        </mesh>

        {/* 12 Individual High-Output LED Matrix Pods */}
        {[-2.4, -0.8, 0.8, 2.4].map((lx) =>
          [-1.15, 0, 1.15].map((ly) => (
            <mesh key={`${lx}-${ly}`} position={[lx, ly, 0.36]}>
              <planeGeometry args={[1.35, 0.92]} />
              <meshStandardMaterial
                color="#fffbeb"
                emissive="#fef3c7"
                emissiveIntensity={3.2}
              />
            </mesh>
          )),
        )}

        {/* Subtle Volumetric Twilight Light Cone Slanting Toward Pitch */}
        <mesh position={[0, -1.2, 16.5]} rotation={[-Math.PI / 2, 0, 0]}>
          <coneGeometry args={[12.5, 33, 24, 1, true]} />
          <meshBasicMaterial
            map={beamTex}
            transparent
            opacity={0.42}
            depthWrite={false}
            side={THREE.DoubleSide}
            blending={THREE.AdditiveBlending}
            fog={false}
          />
        </mesh>
      </group>
    </group>
  );
});

/**
 * Digital 3D Stadium Scoreboard Jumbotron displaying live Runs, Wickets, Overs & Target.
 */
function DigitalScoreboard3D({
  position,
  rotation,
  scoreboardTex,
}: {
  position: [number, number, number];
  rotation: [number, number, number];
  scoreboardTex: THREE.CanvasTexture;
}) {
  return (
    <group position={position} rotation={rotation}>
      {/* Steel Support Columns */}
      {[-5.2, 5.2].map((sx, idx) => (
        <mesh key={idx} position={[sx, -4.2, -0.4]} castShadow>
          <cylinderGeometry args={[0.3, 0.38, 9.5, 8]} />
          <meshStandardMaterial
            color="#334155"
            metalness={0.7}
            roughness={0.35}
          />
        </mesh>
      ))}
      {/* Jumbotron Housing */}
      <mesh castShadow>
        <boxGeometry args={[15.6, 7.2, 0.9]} />
        <meshStandardMaterial
          color="#090d16"
          metalness={0.55}
          roughness={0.4}
        />
      </mesh>
      {/* Top Gold Trim Header */}
      <mesh position={[0, 3.75, 0.1]}>
        <boxGeometry args={[15.8, 0.35, 1.0]} />
        <meshStandardMaterial color="#facc15" metalness={0.6} roughness={0.3} />
      </mesh>
      {/* Live Emissive LED Matrix Screen */}
      <mesh position={[0, 0, 0.48]}>
        <planeGeometry args={[14.8, 6.4]} />
        <meshStandardMaterial
          map={scoreboardTex}
          emissiveMap={scoreboardTex}
          emissive="#ffffff"
          emissiveIntensity={0.95}
          roughness={0.25}
        />
      </mesh>
    </group>
  );
}

function HazeWall({
  radius = 86,
  height = 28,
  color = '#131e33',
}: {
  radius?: number;
  height?: number;
  color?: string;
}) {
  const texture = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = 16;
    c.height = 256;
    const ctx = c.getContext('2d');
    if (ctx) {
      const gr = ctx.createLinearGradient(0, 256, 0, 0);
      const col = new THREE.Color(color);
      const r = Math.round(col.r * 255);
      const g = Math.round(col.g * 255);
      const b = Math.round(col.b * 255);
      gr.addColorStop(0, `rgba(${r}, ${g}, ${b}, 1)`);
      gr.addColorStop(0.65, `rgba(${r}, ${g}, ${b}, 0)`);
      gr.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
      ctx.fillStyle = gr;
      ctx.fillRect(0, 0, 16, 256);
    }
    return new THREE.CanvasTexture(c);
  }, [color]);

  return (
    <mesh position={[0, height * 0.38, 0]}>
      <cylinderGeometry args={[radius, radius, height, 48, 1, true]} />
      <meshBasicMaterial
        map={texture}
        transparent
        side={THREE.DoubleSide}
        fog={false}
        depthWrite={false}
      />
    </mesh>
  );
}

// ============================================================================
// COMPLETE 3D STADIUM ARENA
// ============================================================================

const StadiumArena = React.memo(function StadiumArena({
  playerPrimary,
  playerSecondary,
  opponentPrimary,
  crowdExcitementRef,
  scoreboardTex,
}: {
  playerPrimary: string;
  playerSecondary: string;
  opponentPrimary: string;
  crowdExcitementRef: MutableRefObject<number>;
  scoreboardTex: THREE.CanvasTexture;
}) {
  const boundaryR = getConfig('boundaryRadius');
  const grassPack = useMemo(() => getOutfieldGrassTextures(), []);
  const pitchPack = useMemo(() => getClayPitchTextures(), []);
  const grandstandTex = useMemo(
    () =>
      createGrandstandTierTexture(
        playerPrimary,
        playerSecondary,
        opponentPrimary,
      ),
    [playerPrimary, playerSecondary, opponentPrimary],
  );

  // Outfield terrain with flat playable grass and banked outer stadium apron
  const groundGeo = useMemo(() => {
    const geo = new THREE.PlaneGeometry(176, 176, 56, 56);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getY(i);
      const dist = Math.hypot(x, z);
      let h = 0;
      if (dist > boundaryR + 3.5 && dist <= 76) {
        const t = (dist - (boundaryR + 3.5)) / 18;
        h = Math.min(2.4, t * t * 1.8);
      } else if (dist > 76) {
        const t = (dist - 76) / 14;
        h = 1.8 - t * t * 4.5;
      }
      pos.setZ(i, h);
    }
    geo.computeVertexNormals();
    return geo;
  }, [boundaryR]);

  const adTextures = useMemo(
    () => [
      createAdBoardTexture(
        'BOUNDARY BLITZ 3D',
        '#0f172a',
        '#facc15',
        playerPrimary,
      ),
      createAdBoardTexture(
        'SIXER POWER',
        playerPrimary,
        '#ffffff',
        playerSecondary,
      ),
      createAdBoardTexture(
        'CHAMPIONSHIP ARENA',
        '#064e3b',
        '#34d399',
        '#facc15',
      ),
      createAdBoardTexture(
        'PRO ENGLISH WILLOW',
        opponentPrimary,
        '#f8fafc',
        '#f59e0b',
      ),
    ],
    [playerPrimary, playerSecondary, opponentPrimary],
  );

  // Rotating Perimeter Sponsor Boards
  const adMeshRefs = useRef<Array<THREE.Mesh | null>>([]);
  const adBoards = useMemo(() => {
    const count = 28;
    const ringR = boundaryR + 2.15;
    const segWidth = (2 * Math.PI * ringR) / count - 0.32;
    return Array.from({length: count}, (_, i) => {
      const angle = (i / count) * Math.PI * 2;
      return {
        key: i,
        x: Math.sin(angle) * ringR,
        z: Math.cos(angle) * ringR,
        rotY: angle + Math.PI,
        width: segWidth,
        texIndex: i % 4,
      };
    });
  }, [boundaryR]);

  // Crisp White 30-Yard Inner Fielding Circle Dashes
  const innerCircleDashes = useMemo(() => {
    const dashCount = 36;
    const r = 24.0;
    return Array.from({length: dashCount}, (_, i) => {
      const a = (i / dashCount) * Math.PI * 2;
      return {
        key: i,
        x: Math.sin(a) * r,
        z: Math.cos(a) * r,
        rotY: a,
      };
    });
  }, []);

  // Instanced cheering spectators across 3 stadium tiers (leaving gap for Members Pavilion at -Z)
  const crowdMeshRef = useRef<THREE.InstancedMesh>(null);
  const crowdBaseData = useMemo(() => {
    const rng = createSeededRandom(777);
    const palette = [
      playerPrimary,
      playerSecondary,
      opponentPrimary,
      '#facc15',
      '#38bdf8',
      '#f43f5e',
      '#ffffff',
    ];
    return Array.from({length: CROWD_COUNT}, (_, i) => {
      const tier = i % 3;
      const r = boundaryR + 6.9 + tier * 3.6 + (rng() - 0.5) * 1.1;
      // Map angles across the horseshoe bowl excluding [-0.26, +0.26] around PI (-Z Members Pavilion)
      const usableArc = Math.PI * 2 - 0.56;
      const angle = -Math.PI + 0.28 + (i / CROWD_COUNT) * usableArc;
      const baseY = 2.0 + tier * 2.3;
      return {
        x: Math.sin(angle) * r,
        y: baseY,
        z: Math.cos(angle) * r,
        rotY: angle + Math.PI,
        phase: rng() * Math.PI * 2,
        scale: 0.85 + rng() * 0.3,
        color: palette[Math.floor(rng() * palette.length)],
      };
    });
  }, [boundaryR, playerPrimary, playerSecondary, opponentPrimary]);

  useEffect(() => {
    const mesh = crowdMeshRef.current;
    if (!mesh) return;
    crowdBaseData.forEach((c, i) => {
      scratchObj.position.set(c.x, c.y, c.z);
      scratchObj.rotation.set(0, c.rotY, 0);
      scratchObj.scale.set(c.scale, c.scale, c.scale);
      scratchObj.updateMatrix();
      mesh.setMatrixAt(i, scratchObj.matrix);
      scratchColor.set(c.color);
      mesh.setColorAt(i, scratchColor);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [crowdBaseData]);

  // Atmospheric twilight dust motes
  const dustRef = useRef<THREE.InstancedMesh>(null);
  const dustData = useMemo(() => {
    const rng = createSeededRandom(31415);
    return Array.from({length: DUST_COUNT}, () => ({
      x: (rng() - 0.5) * 78,
      y: 1.5 + rng() * 14,
      z: (rng() - 0.5) * 78,
      phase: rng() * Math.PI * 2,
      speed: 0.4 + rng() * 0.7,
    }));
  }, []);

  useFrame(({clock}) => {
    const t = clock.getElapsedTime();
    const excitement = crowdExcitementRef.current;

    // Smooth Tri-Vision / Digital Flip Rotation on Sponsor Perimeter Boards every 5s
    const cycle = t % 5.0;
    const flipAngle =
      cycle > 4.4 ? ((cycle - 4.4) / 0.6) * Math.PI : 0;
    for (let i = 0; i < adBoards.length; i++) {
      const m = adMeshRefs.current[i];
      if (m) {
        const waveFlip =
          ((t + i * 0.08) % 5.0) > 4.4
            ? ((((t + i * 0.08) % 5.0) - 4.4) / 0.6) * Math.PI
            : flipAngle * 0;
        m.rotation.x = waveFlip;
      }
    }

    const mesh = crowdMeshRef.current;
    if (mesh) {
      const amp = 0.08 + excitement * 0.44;
      const freq = 3.2 + excitement * 7.5;
      for (let i = 0; i < CROWD_COUNT; i++) {
        const c = crowdBaseData[i];
        const hop = Math.abs(Math.sin(t * freq + c.phase)) * amp;
        scratchObj.position.set(c.x, c.y + hop, c.z);
        scratchObj.rotation.set(0, c.rotY, 0);
        scratchObj.scale.set(c.scale, c.scale, c.scale);
        scratchObj.updateMatrix();
        mesh.setMatrixAt(i, scratchObj.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
    }

    const dust = dustRef.current;
    if (dust) {
      for (let i = 0; i < DUST_COUNT; i++) {
        const d = dustData[i];
        scratchObj.position.set(
          d.x + Math.sin(t * d.speed + d.phase) * 1.4,
          d.y + Math.cos(t * 0.6 + d.phase) * 0.5,
          d.z,
        );
        scratchObj.scale.setScalar(0.06);
        scratchObj.updateMatrix();
        dust.setMatrixAt(i, scratchObj.matrix);
      }
      dust.instanceMatrix.needsUpdate = true;
    }
  });

  const pylonCoords: ReadonlyArray<readonly [number, number]> = [
    [-48, -48],
    [48, -48],
    [-48, 48],
    [48, 48],
  ];

  // Horseshoe stadium bowl arc (leaves architectural bay open at -Z for Members Pavilion)
  const bowlThetaStart = -Math.PI + 0.25;
  const bowlThetaLength = Math.PI * 2 - 0.5;

  return (
    <group>
      {/* Physics Flat Ground Slab & Outer Stadium Perimeter Colliders */}
      <RigidBody type="fixed" colliders={false} friction={0.85}>
        <CuboidCollider args={[88, 0.5, 88]} position={[0, -0.5, 0]} />
        <CuboidCollider args={[88, 8, 1]} position={[0, 4, -78]} />
        <CuboidCollider args={[88, 8, 1]} position={[0, 4, 78]} />
        <CuboidCollider args={[1, 8, 88]} position={[-78, 4, 0]} />
        <CuboidCollider args={[1, 8, 88]} position={[78, 4, 0]} />
      </RigidBody>

      {/* Lush Radial & Striped Mowed Grass Outfield (#2e7d32 & #388e3c PBR) */}
      <mesh
        geometry={groundGeo}
        rotation={[-Math.PI / 2, 0, 0]}
        receiveShadow>
        <meshStandardMaterial
          map={grassPack.map}
          roughnessMap={grassPack.roughnessMap}
          roughness={0.86}
          metalness={0.02}
        />
      </mesh>

      {/* Crisp White 30-Yard Inner Fielding Circle */}
      <group position={[0, 0.018, 0]}>
        {innerCircleDashes.map((d) => (
          <mesh
            key={d.key}
            position={[d.x, 0, d.z]}
            rotation={[-Math.PI / 2, 0, d.rotY]}>
            <planeGeometry args={[1.35, 0.16]} />
            <meshBasicMaterial color="#ffffff" />
          </mesh>
        ))}
      </group>

      {/* Raised, Slightly Worn 22-Yard Clay Pitch Strip (#d7b889) */}
      <group position={[0, 0, 0]}>
        {/* Subtle Rolled Turf Apron Border */}
        <mesh position={[0, 0.012, 0]} receiveShadow>
          <boxGeometry args={[3.65, 0.024, 23.6]} />
          <meshStandardMaterial color="#2e7d32" roughness={0.9} />
        </mesh>
        {/* Raised Clay Pitch Slab (Top surface at y = PITCH_SURFACE_Y = 0.045) */}
        <mesh position={[0, PITCH_SURFACE_Y * 0.5, 0]} receiveShadow>
          <boxGeometry args={[3.28, PITCH_SURFACE_Y, 23.2]} />
          <meshStandardMaterial
            map={pitchPack.map}
            roughnessMap={pitchPack.roughnessMap}
            roughness={0.88}
          />
        </mesh>
      </group>

      {/* Padded Red & White Boundary Rope Cushion */}
      <group position={[0, 0.16, 0]}>
        <mesh rotation={[-Math.PI / 2, 0, 0]} castShadow>
          <torusGeometry args={[boundaryR, 0.17, 12, 96]} />
          <meshStandardMaterial
            color="#ef4444"
            emissive="#7f1d1d"
            emissiveIntensity={0.28}
            roughness={0.42}
          />
        </mesh>
        {/* Boundary Cushion Sponsor Pads every 30 deg */}
        {Array.from({length: 12}, (_, i) => {
          const a = (i / 12) * Math.PI * 2;
          return (
            <mesh
              key={i}
              position={[Math.sin(a) * boundaryR, 0.04, Math.cos(a) * boundaryR]}
              rotation={[0, a, 0]}>
              <boxGeometry args={[1.6, 0.32, 0.42]} />
              <meshStandardMaterial color="#f8fafc" roughness={0.45} />
            </mesh>
          );
        })}
      </group>

      {/* Rotating Sponsor Perimeter Boards */}
      {adBoards.map((b, idx) => (
        <group
          key={b.key}
          position={[b.x, 0.62, b.z]}
          rotation={[0, b.rotY, 0]}>
          <mesh
            ref={(el) => {
              adMeshRefs.current[idx] = el;
            }}
            castShadow
            receiveShadow>
            <boxGeometry args={[b.width, 1.12, 0.24]} />
            <meshStandardMaterial
              map={adTextures[b.texIndex]}
              roughness={0.4}
              metalness={0.14}
            />
          </mesh>
        </group>
      ))}

      {/* Two-Story Glass-Fronted Members Pavilion & Sightscreen (-Z) */}
      <MembersPavilion
        zPos={-(boundaryR + 7.2)}
        primaryColor={playerPrimary}
        secondaryColor={playerSecondary}
      />

      {/* Live 3D Digital Stadium Scoreboard */}
      <DigitalScoreboard3D
        position={[-24.5, 12.6, -(boundaryR + 10.5)]}
        rotation={[0, 0.38, 0]}
        scoreboardTex={scoreboardTex}
      />

      {/* Multi-Tiered Circular Grandstand Bowl with Stepped Concrete & Crowd Dot Texture */}
      <group>
        {[0, 1, 2].map((tier) => {
          const rInner = boundaryR + 5.2 + tier * 3.8;
          const h = 1.9 + tier * 2.35;
          return (
            <group key={tier}>
              <mesh position={[0, h * 0.5, 0]} receiveShadow>
                <cylinderGeometry
                  args={[
                    rInner + 3.2,
                    rInner,
                    h,
                    56,
                    1,
                    true,
                    bowlThetaStart,
                    bowlThetaLength,
                  ]}
                />
                <meshStandardMaterial
                  map={grandstandTex}
                  side={THREE.DoubleSide}
                  roughness={0.84}
                />
              </mesh>
              {/* Concrete Concourse Balustrade Ring */}
              <mesh position={[0, h + 0.15, 0]}>
                <cylinderGeometry
                  args={[
                    rInner + 3.25,
                    rInner + 3.25,
                    0.42,
                    56,
                    1,
                    true,
                    bowlThetaStart,
                    bowlThetaLength,
                  ]}
                />
                <meshStandardMaterial
                  color={tier === 1 ? playerPrimary : '#cbd5e1'}
                  side={THREE.DoubleSide}
                  roughness={0.6}
                />
              </mesh>
            </group>
          );
        })}

        {/* Outer Concrete Stadium Colonnade Wall */}
        <mesh position={[0, 5.6, 0]}>
          <cylinderGeometry
            args={[
              boundaryR + 17.6,
              boundaryR + 18.2,
              11.2,
              56,
              1,
              true,
              bowlThetaStart,
              bowlThetaLength,
            ]}
          />
          <meshStandardMaterial
            color="#0f172a"
            side={THREE.DoubleSide}
            roughness={0.82}
          />
        </mesh>

        {/* Cantilevered Stadium Roof Canopy */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 11.2, 0]}>
          <ringGeometry
            args={[
              boundaryR + 8.2,
              boundaryR + 18.4,
              56,
              1,
              bowlThetaStart + Math.PI / 2,
              bowlThetaLength,
            ]}
          />
          <meshStandardMaterial
            color="#e2e8f0"
            side={THREE.DoubleSide}
            roughness={0.48}
            metalness={0.28}
          />
        </mesh>
      </group>

      {/* Instanced Animated 3D Spectators */}
      <instancedMesh
        ref={crowdMeshRef}
        args={[undefined, undefined, CROWD_COUNT]}>
        <capsuleGeometry args={[0.25, 0.52, 4, 6]} />
        <meshStandardMaterial roughness={0.7} />
      </instancedMesh>

      {/* 4 Tall Lattice-Steel LED Floodlight Towers with Volumetric Cones */}
      {pylonCoords.map(([px, pz], idx) => (
        <FloodlightTower
          key={idx}
          position={[px, 0, pz]}
          yaw={Math.atan2(-px, -pz)}
        />
      ))}

      {/* Atmospheric Horizon Haze & Drifting Floodlight Motes */}
      <HazeWall radius={88} height={28} color={getConfig('backgroundColor')} />
      <instancedMesh ref={dustRef} args={[undefined, undefined, DUST_COUNT]}>
        <sphereGeometry args={[1, 6, 6]} />
        <meshBasicMaterial color="#fef9c3" transparent opacity={0.45} />
      </instancedMesh>
    </group>
  );
});

// ============================================================================
// VISUAL 3D WAGON-WHEEL SHOT CHART GUIDE ON PITCH
// ============================================================================

const ShotChart3D = React.memo(function ShotChart3D({
  aimDir,
  shotChartRef,
}: {
  aimDir: AimDirection;
  shotChartRef: MutableRefObject<THREE.Group | null>;
}) {
  // Three wagon-wheel sectors (-1 = Leg Side, 0 = Straight, +1 = Off Side)
  // Note: Right-handed Three.js rotation around +Y turns -Z toward -X (Leg) for positive angle!
  const sectors: ReadonlyArray<{
    dir: AimDirection;
    rotY: number;
    thetaStart: number;
    thetaLength: number;
    color: string;
  }> = [
    {
      dir: -1,
      rotY: 0.72,
      thetaStart: Math.PI * 0.5 + 0.36,
      thetaLength: 0.68,
      color: SHOT_CHART_SECTORS[-1].color,
    },
    {
      dir: 0,
      rotY: 0.05,
      thetaStart: Math.PI * 0.5 - 0.32,
      thetaLength: 0.64,
      color: SHOT_CHART_SECTORS[0].color,
    },
    {
      dir: 1,
      rotY: -0.72,
      thetaStart: Math.PI * 0.5 - 1.04,
      thetaLength: 0.68,
      color: SHOT_CHART_SECTORS[1].color,
    },
  ];

  const activeColor = SHOT_CHART_SECTORS[aimDir].color;

  return (
    <group ref={shotChartRef} position={[0, PITCH_SURFACE_Y + 0.014, 9.75]}>
      {/* Semi-transparent Wagon-Wheel Sector Arcs */}
      {sectors.map((sec) => {
        const selected = sec.dir === aimDir;
        return (
          <mesh
            key={sec.dir}
            rotation={[-Math.PI / 2, 0, 0]}
            position={[0, selected ? 0.004 : 0, 0]}>
            <ringGeometry
              args={[
                selected ? 1.55 : 1.75,
                selected ? 6.6 : 4.6,
                20,
                1,
                sec.thetaStart,
                sec.thetaLength,
              ]}
            />
            <meshBasicMaterial
              color={sec.color}
              transparent
              opacity={selected ? 0.28 : 0.07}
              side={THREE.DoubleSide}
              depthWrite={false}
            />
          </mesh>
        );
      })}

      {/* Smoothly Pivoting Active Directional Shot Shaft & Arrowhead */}
      <group
        rotation={[
          0,
          aimDir === -1 ? 0.72 : aimDir === 1 ? -0.72 : 0.05,
          0,
        ]}>
        {/* Dashed / Tapered Direction Beam */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.008, -3.4]}>
          <planeGeometry args={[0.24, 5.2]} />
          <meshBasicMaterial
            color={activeColor}
            transparent
            opacity={0.62}
            depthWrite={false}
          />
        </mesh>
        {/* Crisp Tip Arrowhead Pointing into Selected Gap */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, -6.35]}>
          <coneGeometry args={[0.48, 1.35, 3]} />
          <meshBasicMaterial
            color={activeColor}
            transparent
            opacity={0.85}
            depthWrite={false}
          />
        </mesh>
      </group>
    </group>
  );
});

// ============================================================================
// INNER 3D CRICKET SCENE & GAMEPLAY LOOP
// ============================================================================

interface SceneProps {
  gameState: GameState;
  setGameState: React.Dispatch<React.SetStateAction<GameState>>;
  inputRef: MutableRefObject<InputSnapshot>;
  timingRef: MutableRefObject<TimingMeterSnapshot>;
  exitChat: (payload: Record<string, unknown>) => Promise<void>;
  gameStateRef: MutableRefObject<GameState>;
  matchConfig: MatchConfig;
  batSkin: BatSkinId;
  isPaused: boolean;
  onTogglePauseMenu: () => void;
  onHudUpdate: (hud: LiveScoreHud) => void;
  onMatchEnd: (
    outcome: 'WIN' | 'LOSS',
    runs: number,
    wickets: number,
    ballsBowled: number,
  ) => void;
}

type DeliveryPhase =
  | 'PRE_BALL'
  | 'RUNUP'
  | 'BOWLED_FLIGHT'
  | 'BALL_IN_PLAY'
  | 'CELEBRATE_BALL'
  | 'MATCH_OVER';

interface StumpPieceState {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  rot: THREE.Euler;
  angVel: THREE.Vector3;
}

function Scene({
  gameState,
  setGameState,
  inputRef,
  timingRef,
  gameStateRef,
  matchConfig,
  batSkin,
  isPaused,
  onTogglePauseMenu,
  onHudUpdate,
  onMatchEnd,
}: SceneProps) {
  const {camera} = useThree();
  const playerTeamInfo = TEAMS[matchConfig.playerTeam];
  const opponentTeamInfo = TEAMS[matchConfig.opponentTeam];
  const boundaryR = getConfig('boundaryRadius');

  // Dynamic 3D Stadium Digital Scoreboard Canvas & Texture
  const {scoreboardCanvas, scoreboardTex} = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 256;
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return {scoreboardCanvas: c, scoreboardTex: t};
  }, []);

  const update3DScoreboard = useCallback(
    (runs: number, wickets: number, ballsBowled: number, statusLine: string) => {
      const ctx = scoreboardCanvas.getContext('2d');
      if (!ctx) return;
      const w = scoreboardCanvas.width;
      const h = scoreboardCanvas.height;

      // LED Matrix Background
      ctx.fillStyle = '#070b14';
      ctx.fillRect(0, 0, w, h);

      // Subtle LED scanlines
      ctx.fillStyle = 'rgba(255,255,255,0.03)';
      for (let y = 0; y < h; y += 4) {
        ctx.fillRect(0, y, w, 1);
      }

      // Header Banner
      ctx.fillStyle = playerTeamInfo.primaryColor;
      ctx.fillRect(12, 12, w - 24, 46);
      ctx.fillStyle = '#ffffff';
      ctx.font = '900 26px sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(
        `${playerTeamInfo.shortName} vs ${opponentTeamInfo.shortName}`,
        26,
        35,
      );
      ctx.textAlign = 'right';
      ctx.fillStyle = '#fde047';
      ctx.fillText(`TARGET ${matchConfig.targetRuns}`, w - 26, 35);

      // Center Live Runs / Wickets & Overs
      ctx.textAlign = 'left';
      ctx.fillStyle = '#facc15';
      ctx.font = '900 84px sans-serif';
      ctx.fillText(`${runs}/${wickets}`, 26, 126);

      const ovStr = `${Math.floor(ballsBowled / 6)}.${ballsBowled % 6} / ${matchConfig.overs}.0 OV`;
      ctx.textAlign = 'right';
      ctx.fillStyle = '#38bdf8';
      ctx.font = '900 34px sans-serif';
      ctx.fillText(ovStr, w - 26, 118);

      const need = Math.max(0, matchConfig.targetRuns - runs);
      const ballsLeft = Math.max(0, matchConfig.totalBalls - ballsBowled);
      ctx.fillStyle = '#94a3b8';
      ctx.font = '700 22px sans-serif';
      ctx.fillText(`NEED ${need} IN ${ballsLeft} BALLS`, w - 26, 156);

      // Bottom Live Callout Ticker
      ctx.fillStyle = '#111827';
      ctx.fillRect(12, h - 54, w - 24, 42);
      ctx.strokeStyle = playerTeamInfo.secondaryColor;
      ctx.lineWidth = 2;
      ctx.strokeRect(12, h - 54, w - 24, 42);
      ctx.textAlign = 'center';
      ctx.fillStyle = '#34d399';
      ctx.font = '900 24px sans-serif';
      ctx.fillText(statusLine || 'LIVE STADIUM BROADCAST', w / 2, h - 32);

      scoreboardTex.needsUpdate = true;
    },
    [matchConfig, opponentTeamInfo, playerTeamInfo, scoreboardCanvas, scoreboardTex],
  );

  // Visual Refs
  const ballMeshRef = useRef<THREE.Group>(null);
  const ballShadowRef = useRef<THREE.Mesh>(null);
  const pitchRingRef = useRef<THREE.Group>(null);
  const pitchRingMatRef = useRef<THREE.MeshStandardMaterial>(null);
  const aimArrowRef = useRef<THREE.Group>(null);
  const trailInstRef = useRef<THREE.InstancedMesh>(null);
  const trailMatRef = useRef<THREE.MeshBasicMaterial>(null);
  const fireworksRef = useRef<THREE.InstancedMesh>(null);

  const batterGroupRef = useRef<THREE.Group>(null);
  const nonStrikerGroupRef = useRef<THREE.Group>(null);
  const bowlerGroupRef = useRef<THREE.Group>(null);
  const keeperGroupRef = useRef<THREE.Group>(null);
  const fielderRefs = useRef<Array<THREE.Group | null>>([]);
  const stumpRefs = useRef<Array<THREE.Group | null>>([]);
  const bailRefs = useRef<Array<THREE.Group | null>>([]);
  const bowlStumpRefs = useRef<Array<THREE.Group | null>>([]);
  const bowlBailRefs = useRef<Array<THREE.Group | null>>([]);

  const [visualAimDir, setVisualAimDir] = useState<AimDirection>(0);

  const batSwingRef = useRef({
    active: false,
    progress: 0,
    shotType: 'LOFTED' as ShotType,
    aimDir: 0 as AimDirection,
  });
  const batterLocoRef = useRef({speed: 0, slidingBat: false});
  const nonStrikerLocoRef = useRef({speed: 0, slidingBat: false});
  const bowlerLocoRef = useRef({speed: 0, bowlArmAngle: 0});
  const keeperLocoRef = useRef({speed: 0});
  const fielderLocoRefs = useMemo(
    () =>
      Array.from({length: 9}, () => ({
        current: {speed: 0, diving: false},
      })),
    [],
  );
  const crowdExcitementRef = useRef(0);

  // Trail history ring buffer
  const trailHistory = useMemo(
    () => Array.from({length: TRAIL_COUNT}, () => new THREE.Vector3(0, -10, 0)),
    [],
  );

  // Fireworks particle pool
  const fireworksPool = useMemo(
    () =>
      Array.from({length: FIREWORK_PARTICLES}, () => ({
        active: false,
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        life: 0,
        maxLife: 1.5,
        color: new THREE.Color('#facc15'),
      })),
    [],
  );

  // Dynamic batting (+10.8) & bowling (-10.8) stumps & independent physics-enabled bails
  const stumpsState = useMemo<{
    dislodged: boolean;
    stumps: StumpPieceState[];
    bails: StumpPieceState[];
    bowlDislodged: boolean;
    bowlStumps: StumpPieceState[];
    bowlBails: StumpPieceState[];
  }>(
    () => ({
      dislodged: false,
      stumps: [-0.11, 0, 0.11].map((x) => ({
        pos: new THREE.Vector3(x, PITCH_SURFACE_Y + 0.355, 10.8),
        vel: new THREE.Vector3(),
        rot: new THREE.Euler(0, 0, 0),
        angVel: new THREE.Vector3(),
      })),
      bails: [-0.055, 0.055].map((x) => ({
        pos: new THREE.Vector3(x, PITCH_SURFACE_Y + 0.735, 10.8),
        vel: new THREE.Vector3(),
        rot: new THREE.Euler(0, 0, Math.PI / 2),
        angVel: new THREE.Vector3(),
      })),
      bowlDislodged: false,
      bowlStumps: [-0.11, 0, 0.11].map((x) => ({
        pos: new THREE.Vector3(x, PITCH_SURFACE_Y + 0.355, -10.8),
        vel: new THREE.Vector3(),
        rot: new THREE.Euler(0, 0, 0),
        angVel: new THREE.Vector3(),
      })),
      bowlBails: [-0.055, 0.055].map((x) => ({
        pos: new THREE.Vector3(x, PITCH_SURFACE_Y + 0.735, -10.8),
        vel: new THREE.Vector3(),
        rot: new THREE.Euler(0, 0, Math.PI / 2),
        angVel: new THREE.Vector3(),
      })),
    }),
    [],
  );

  // Mutable high-frequency cricket simulation state
  const simRef = useRef({
    phase: 'PRE_BALL' as DeliveryPhase,
    phaseTimer: 0,
    runs: 0,
    wickets: 0,
    ballsBowled: 0,
    calloutSeq: 0,
    aimDir: 0 as AimDirection,

    deliveryType: 'FAST_STRAIGHT' as DeliveryType,
    bouncePos: new THREE.Vector3(0, PITCH_SURFACE_Y + 0.01, 5.2),
    hasBounced: false,
    spinPostBounceVx: 0,
    airSwingAx: 0,

    ballPos: new THREE.Vector3(0.45, 2.0, -10.0),
    ballVel: new THREE.Vector3(0, 0, 0),
    ballVisible: false,
    ballInAirAfterHit: false,
    isPerfectHit: false,
    lastTimingGrade: null as TimingGrade | null,
    shotPlayedThisBall: false,
    queuedShot: null as ShotType | null,

    predictedLanding: new THREE.Vector3(0, 0, 0),
    fielderPositions: BASE_FIELDER_SPOTS.map(
      ([x, z]) => new THREE.Vector3(x, 0, z),
    ),

    // Active Running Between the Wickets & Fielder Throw State
    batterPosZ: 9.8,
    batterHomeZ: 9.8,
    batterTargetZ: 9.8,
    nonStrikerPosZ: -9.8,
    nonStrikerHomeZ: -9.8,
    nonStrikerTargetZ: -9.8,
    isRunningSprint: false,
    isRetreatingCrease: false,
    completedRunsThisBall: 0,
    queuedExtraRuns: 0,

    fielderHasBall: false,
    holdingFielderIdx: -1,
    pickupDelayTimer: 0,
    throwInFlight: false,
    throwTargetEndZ: 10.8 as 10.8 | -10.8,
    ballReturnedToStumps: false,
    postReturnSettleTimer: 0,

    shakeIntensity: 0,
    fireworkTimer: 0,

    prevAimLeg: false,
    prevAimStraight: false,
    prevAimOff: false,
    prevLoft: false,
    prevDrive: false,
    prevDefend: false,
    prevCallRun: false,
    prevCancelRun: false,
    prevCancel: false,
  });

  const scatterStumpSet = useCallback(
    (endZ: 10.8 | -10.8, impactX = 0) => {
      const isBattingEnd = endZ > 0;
      const targetStumps = isBattingEnd
        ? stumpsState.stumps
        : stumpsState.bowlStumps;
      const targetBails = isBattingEnd
        ? stumpsState.bails
        : stumpsState.bowlBails;
      if (isBattingEnd) {
        stumpsState.dislodged = true;
      } else {
        stumpsState.bowlDislodged = true;
      }
      const pushDirZ = isBattingEnd ? 1 : -1;
      targetStumps.forEach((st, idx) => {
        const stumpX = -0.11 + idx * 0.11;
        const hitScale = Math.abs(impactX - stumpX) < 0.16 ? 1.0 : 0.4;
        st.vel.set(
          (idx - 1) * 2.2 + (Math.random() - 0.5) * 1.4,
          3.4 * hitScale + Math.random() * 1.4,
          pushDirZ * (6.2 * hitScale + Math.random() * 2.2),
        );
        st.angVel.set(
          pushDirZ * (-9 - Math.random() * 5),
          (Math.random() - 0.5) * 8,
          (idx - 1) * 5.5,
        );
      });
      targetBails.forEach((bl, idx) => {
        bl.vel.set(
          (idx === 0 ? -2.6 : 2.6) + (Math.random() - 0.5) * 1.4,
          6.0 + Math.random() * 2.4,
          pushDirZ * (7.5 + Math.random() * 3.0),
        );
        bl.angVel.set(16 + Math.random() * 8, 12, idx === 0 ? -14 : 14);
      });
    },
    [stumpsState],
  );

  const resetStumps = useCallback(() => {
    stumpsState.dislodged = false;
    stumpsState.bowlDislodged = false;
    [-0.11, 0, 0.11].forEach((x, idx) => {
      const s = stumpsState.stumps[idx];
      s.pos.set(x, PITCH_SURFACE_Y + 0.355, 10.8);
      s.vel.set(0, 0, 0);
      s.rot.set(0, 0, 0);
      s.angVel.set(0, 0, 0);

      const bs = stumpsState.bowlStumps[idx];
      bs.pos.set(x, PITCH_SURFACE_Y + 0.355, -10.8);
      bs.vel.set(0, 0, 0);
      bs.rot.set(0, 0, 0);
      bs.angVel.set(0, 0, 0);
    });
    [-0.055, 0.055].forEach((x, idx) => {
      const b = stumpsState.bails[idx];
      b.pos.set(x, PITCH_SURFACE_Y + 0.735, 10.8);
      b.vel.set(0, 0, 0);
      b.rot.set(0, 0, Math.PI / 2);
      b.angVel.set(0, 0, 0);

      const bb = stumpsState.bowlBails[idx];
      bb.pos.set(x, PITCH_SURFACE_Y + 0.735, -10.8);
      bb.vel.set(0, 0, 0);
      bb.rot.set(0, 0, Math.PI / 2);
      bb.angVel.set(0, 0, 0);
    });
  }, [stumpsState]);

  const spawnFireworkBurst = useCallback(
    (cx: number, cy: number, cz: number) => {
      if (!getConfig('enableFireworks')) return;
      const palette = [
        playerTeamInfo.primaryColor,
        playerTeamInfo.secondaryColor,
        '#facc15',
        '#34d399',
        '#38bdf8',
      ];
      let spawned = 0;
      for (let i = 0; i < fireworksPool.length && spawned < 36; i++) {
        const p = fireworksPool[i];
        if (!p.active) {
          p.active = true;
          p.pos.set(cx, cy, cz);
          const theta = Math.random() * Math.PI * 2;
          const phi = Math.acos(2 * Math.random() - 1);
          const spd = 8 + Math.random() * 14;
          p.vel.set(
            Math.sin(phi) * Math.cos(theta) * spd,
            Math.abs(Math.cos(phi)) * spd + 3,
            Math.sin(phi) * Math.sin(theta) * spd,
          );
          p.life = 0;
          p.maxLife = 1.0 + Math.random() * 0.7;
          p.color.set(palette[Math.floor(Math.random() * palette.length)]);
          spawned++;
        }
      }
    },
    [fireworksPool, playerTeamInfo],
  );

  const emitHud = useCallback(
    (
      calloutText = '',
      calloutSubtext = '',
      calloutColor = '#facc15',
      lastOutcomeText = '',
    ) => {
      const s = simRef.current;
      if (calloutText) {
        s.calloutSeq += 1;
      }
      const meta = DELIVERY_META[s.deliveryType];
      const actionMode: ActionControlMode =
        s.phase === 'BALL_IN_PLAY'
          ? 'RUNNING'
          : s.phase === 'RUNUP' || s.phase === 'BOWLED_FLIGHT'
            ? 'BATTING'
            : 'LOCKED';

      const canCallExtraRun =
        s.phase === 'BALL_IN_PLAY' &&
        !s.ballReturnedToStumps &&
        s.completedRunsThisBall +
          (s.isRunningSprint && !s.isRetreatingCrease ? 1 : 0) +
          s.queuedExtraRuns <
          4;
      const canCancelRun =
        s.phase === 'BALL_IN_PLAY' &&
        ((s.isRunningSprint && !s.isRetreatingCrease) || s.queuedExtraRuns > 0);

      update3DScoreboard(
        s.runs + s.completedRunsThisBall,
        s.wickets,
        s.ballsBowled,
        calloutText ? `${calloutText}  ${calloutSubtext}` : meta.label,
      );
      onHudUpdate({
        runs: s.runs + s.completedRunsThisBall,
        wickets: s.wickets,
        wicketsAllowed: matchConfig.wicketsAllowed,
        ballsBowled: s.ballsBowled,
        totalBalls: matchConfig.totalBalls,
        targetRuns: matchConfig.targetRuns,
        currentDelivery: s.deliveryType,
        deliveryLabel: meta.label,
        deliveryColor: meta.ringColor,
        aimDirection: s.aimDir,
        actionMode,
        completedRunsThisBall: s.completedRunsThisBall,
        isSprintingRun: s.isRunningSprint,
        canCallExtraRun,
        canCancelRun,
        throwInFlight: s.throwInFlight || s.fielderHasBall,
        lastOutcomeText,
        calloutText,
        calloutSubtext,
        calloutColor,
        calloutId: s.calloutSeq,
      });
    },
    [matchConfig, onHudUpdate, update3DScoreboard],
  );

  /** Initiate a crease-to-crease sprint between the striker and non-striker */
  const triggerNextCreaseRun = useCallback(() => {
    const s = simRef.current;
    if (s.ballReturnedToStumps) return;
    s.isRunningSprint = true;
    s.isRetreatingCrease = false;
    s.batterTargetZ = s.batterHomeZ > 0 ? -9.8 : 9.8;
    s.nonStrikerTargetZ = s.nonStrikerHomeZ > 0 ? -9.8 : 9.8;
    gameAudio.playCrispClick();
    emitHud();
  }, [emitHud]);

  /** Cancel an active/queued run and send both batters diving back to their safe crease */
  const cancelActiveCreaseRun = useCallback(() => {
    const s = simRef.current;
    s.queuedExtraRuns = 0;
    if (s.isRunningSprint && !s.isRetreatingCrease) {
      s.isRetreatingCrease = true;
      s.batterTargetZ = s.batterHomeZ;
      s.nonStrikerTargetZ = s.nonStrikerHomeZ;
      gameAudio.playFootstepWood();
    }
    emitHud();
  }, [emitHud]);

  // Choose next AI delivery variation and compute physics parameters
  const prepareNextDelivery = useCallback(() => {
    const s = simRef.current;
    resetStumps();
    s.phase = 'RUNUP';
    s.phaseTimer = 0;
    s.hasBounced = false;
    s.ballVisible = false;
    s.ballInAirAfterHit = false;
    s.isPerfectHit = false;
    s.lastTimingGrade = null;
    s.shotPlayedThisBall = false;
    s.queuedShot = null;

    s.batterPosZ = 9.8;
    s.batterHomeZ = 9.8;
    s.batterTargetZ = 9.8;
    s.nonStrikerPosZ = -9.8;
    s.nonStrikerHomeZ = -9.8;
    s.nonStrikerTargetZ = -9.8;
    s.isRunningSprint = false;
    s.isRetreatingCrease = false;
    s.completedRunsThisBall = 0;
    s.queuedExtraRuns = 0;
    s.fielderHasBall = false;
    s.holdingFielderIdx = -1;
    s.pickupDelayTimer = 0;
    s.throwInFlight = false;
    s.ballReturnedToStumps = false;
    s.postReturnSettleTimer = 0;

    batterLocoRef.current.speed = 0;
    batterLocoRef.current.slidingBat = false;
    nonStrikerLocoRef.current.speed = 0;
    nonStrikerLocoRef.current.slidingBat = false;

    timingRef.current.visible = true;
    timingRef.current.progress = 0;
    timingRef.current.lockedProgress = null;
    timingRef.current.grade = null;

    batSwingRef.current.active = false;
    batSwingRef.current.progress = 0;

    BASE_FIELDER_SPOTS.forEach(([fx, fz], idx) => {
      s.fielderPositions[idx].set(fx, 0, fz);
      fielderLocoRefs[idx].current.speed = 0;
      fielderLocoRefs[idx].current.diving = false;
    });

    const roll = Math.random();
    let dType: DeliveryType = 'FAST_STRAIGHT';
    if (roll < matchConfig.yorkerProb) {
      dType = 'YORKER';
    } else if (roll < matchConfig.yorkerProb + matchConfig.spinProb) {
      dType = Math.random() < 0.5 ? 'LEG_SPIN' : 'OFF_SPIN';
    } else if (
      roll <
      matchConfig.yorkerProb + matchConfig.spinProb + matchConfig.swingProb
    ) {
      dType = Math.random() < 0.5 ? 'INSWING' : 'OUTSWING';
    } else {
      dType = 'FAST_STRAIGHT';
    }
    s.deliveryType = dType;

    const targetStumpX = (Math.random() - 0.5) * 0.44;
    let bounceZ = 4.6 + Math.random() * 2.4;
    let bounceX = targetStumpX;
    s.airSwingAx = 0;
    s.spinPostBounceVx = 0;

    if (dType === 'YORKER') {
      bounceZ = 9.45 + Math.random() * 0.45;
      bounceX = (Math.random() - 0.5) * 0.28;
    } else if (dType === 'INSWING') {
      bounceZ = 5.4 + Math.random() * 2.0;
      bounceX = targetStumpX + 0.35;
      s.airSwingAx = -2.2 * matchConfig.paceMultiplier;
    } else if (dType === 'OUTSWING') {
      bounceZ = 5.4 + Math.random() * 2.0;
      bounceX = targetStumpX - 0.35;
      s.airSwingAx = 2.2 * matchConfig.paceMultiplier;
    } else if (dType === 'LEG_SPIN') {
      bounceZ = 5.8 + Math.random() * 1.6;
      bounceX = -0.38 + (Math.random() - 0.5) * 0.16;
      s.spinPostBounceVx = 2.35 * matchConfig.paceMultiplier;
    } else if (dType === 'OFF_SPIN') {
      bounceZ = 5.8 + Math.random() * 1.6;
      bounceX = 0.42 + (Math.random() - 0.5) * 0.16;
      s.spinPostBounceVx = -2.45 * matchConfig.paceMultiplier;
    }

    s.bouncePos.set(bounceX, PITCH_SURFACE_Y + 0.008, bounceZ);
    for (let i = 0; i < TRAIL_COUNT; i++) {
      trailHistory[i].set(0, -10, 0);
    }
    if (trailMatRef.current) {
      trailMatRef.current.color.set('#f8fafc');
    }
    emitHud();
  }, [emitHud, fielderLocoRefs, matchConfig, resetStumps, trailHistory]);

  // Launch delivery from bowler's hand at Z = -9.8 onto raised pitch (y = PITCH_SURFACE_Y + 0.105)
  const releaseDeliveryBall = useCallback(() => {
    const s = simRef.current;
    const gravity = Math.abs(getConfig('gravity'));
    const basePace = getConfig('bowlerPaceBase') * matchConfig.paceMultiplier;

    const releaseX = 0.42;
    const releaseY = 2.12;
    const releaseZ = -9.8;
    const bounceContactY = PITCH_SURFACE_Y + 0.105;

    const isSpin =
      s.deliveryType === 'LEG_SPIN' || s.deliveryType === 'OFF_SPIN';
    const speedZ = isSpin
      ? basePace * 0.76
      : s.deliveryType === 'YORKER'
        ? basePace * 1.08
        : basePace;

    const distZ = s.bouncePos.z - releaseZ;
    const flightTime = Math.max(0.28, distZ / speedZ);

    const vx =
      (s.bouncePos.x - releaseX - 0.5 * s.airSwingAx * flightTime * flightTime) /
      flightTime;
    const vy =
      (bounceContactY - releaseY + 0.5 * gravity * flightTime * flightTime) /
      flightTime;

    s.ballPos.set(releaseX, releaseY, releaseZ);
    s.ballVel.set(vx, vy, speedZ);
    s.ballVisible = true;
    for (let i = 0; i < TRAIL_COUNT; i++) {
      trailHistory[i].copy(s.ballPos);
    }
  }, [matchConfig.paceMultiplier, trailHistory]);

  const concludeBall = useCallback(
    (
      runsAdded: number,
      isWicket: boolean,
      calloutTitle: string,
      calloutSub: string,
      calloutColor: string,
    ) => {
      const s = simRef.current;
      if (s.phase === 'CELEBRATE_BALL' || s.phase === 'MATCH_OVER') return;

      s.runs += runsAdded;
      if (isWicket) {
        s.wickets += 1;
      }
      s.ballsBowled += 1;
      s.completedRunsThisBall = 0;
      s.queuedExtraRuns = 0;
      s.isRunningSprint = false;
      s.isRetreatingCrease = false;
      s.phase = 'CELEBRATE_BALL';
      s.phaseTimer = 0;
      timingRef.current.visible = false;

      if (runsAdded > 0) {
        const bonus =
          runsAdded === 6 ? 40 : runsAdded === 4 ? 20 : s.isPerfectHit ? 10 : 0;
        setGameState((prev) => ({
          ...prev,
          score: prev.score + runsAdded * 10 + bonus,
        }));
      }

      emitHud(calloutTitle, calloutSub, calloutColor, calloutTitle);

      if (runsAdded === 6 || s.runs >= matchConfig.targetRuns) {
        crowdExcitementRef.current = 1.0;
        spawnFireworkBurst(-18, 18, -35);
        spawnFireworkBurst(18, 20, -35);
        if (s.runs >= matchConfig.targetRuns) {
          spawnFireworkBurst(0, 22, -30);
        }
      } else if (runsAdded === 4 || isWicket) {
        crowdExcitementRef.current = 0.75;
      }
    },
    [emitHud, matchConfig.targetRuns, setGameState, spawnFireworkBurst],
  );

  // Execute immediate batter swing animation & contact physics evaluation
  const executeBatSwing = useCallback(
    (shotType: ShotType) => {
      const s = simRef.current;
      if (s.shotPlayedThisBall) return;
      s.shotPlayedThisBall = true;

      // Trigger HumanoidCharacter bat-swing animation immediately!
      batSwingRef.current.active = true;
      batSwingRef.current.progress = 0;
      batSwingRef.current.shotType = shotType;
      batSwingRef.current.aimDir = s.aimDir;

      // If swung during bowler's runup before ball release, lock early miss
      if (s.phase !== 'BOWLED_FLIGHT') {
        s.lastTimingGrade = 'MISS';
        timingRef.current.lockedProgress = 0.08;
        timingRef.current.grade = 'MISS';
        gameAudio.playCrispClick();
        return;
      }

      const sweetSpotZ = 9.75;
      const zDelta = s.ballPos.z - sweetSpotZ; // negative = Early, positive = Late
      const absZ = Math.abs(zDelta);
      const lateralDist = Math.abs(s.ballPos.x - 0.05);
      const perfectWin = getConfig('sweetSpotRadius');

      const normProgress = THREE.MathUtils.clamp(
        (s.ballPos.z - -9.8) / (12.0 - -9.8),
        0,
        1,
      );

      let grade: TimingGrade = 'MISS';
      if (shotType === 'DEFEND') {
        if (absZ <= perfectWin * 1.35 && lateralDist < 1.65) {
          grade = 'PERFECT';
        } else if (absZ <= perfectWin * 2.85 && lateralDist < 2.05) {
          grade = 'GOOD';
        }
      } else {
        if (absZ <= perfectWin * 1.0 && lateralDist < 1.55) {
          grade = 'PERFECT';
        } else if (absZ <= perfectWin * 2.45 && lateralDist < 1.95) {
          grade = zDelta < 0 ? 'EARLY' : 'LATE';
        }
      }

      s.lastTimingGrade = grade;
      timingRef.current.lockedProgress = normProgress;
      timingRef.current.grade = grade;

      if (grade === 'MISS') {
        gameAudio.playCrispClick();
        return;
      }

      // Ball struck cleanly or off an Early/Late edge!
      s.phase = 'BALL_IN_PLAY';
      s.phaseTimer = 0;
      s.isPerfectHit = grade === 'PERFECT';

      let shotYaw = SHOT_CHART_SECTORS[s.aimDir].yawRad;

      if (shotType === 'DEFEND') {
        gameAudio.playShieldBlock();
        s.ballInAirAfterHit = false;
        const dropSpeed = grade === 'PERFECT' ? 8.2 : 4.2;
        const nudgeYaw = s.aimDir !== 0 ? s.aimDir * 0.92 : 0.55;
        s.ballVel.set(
          Math.sin(nudgeYaw) * dropSpeed,
          1.6,
          -Math.cos(nudgeYaw) * dropSpeed,
        );
        s.predictedLanding.set(
          s.ballPos.x + s.ballVel.x * 0.8,
          0,
          s.ballPos.z + s.ballVel.z * 0.8,
        );
        if (trailMatRef.current) trailMatRef.current.color.set('#94a3b8');
        // Defensive block stays safely in crease unless player manually calls a quick single (R)
        emitHud('DEFENDED', 'SOFT HANDS — PRESS R FOR QUICK SINGLE', '#38bdf8');
        return;
      }

      if (shotType === 'LOFTED') {
        const loftMult = getConfig('loftedPowerMultiplier');
        if (grade === 'PERFECT') {
          gameAudio.playBatCrack(1.35);
          s.shakeIntensity = 0.28;
          const horizSpd = (27.0 + Math.random() * 3.5) * loftMult;
          const vy = (16.4 + Math.random() * 2.0) * loftMult;
          s.ballVel.set(
            Math.sin(shotYaw) * horizSpd,
            vy,
            -Math.cos(shotYaw) * horizSpd,
          );
          s.ballInAirAfterHit = true;
          if (trailMatRef.current) trailMatRef.current.color.set('#facc15');
        } else {
          // Early (leading edge skews Leg) or Late (thick outside edge skews Off) with reduced exit speed
          gameAudio.playBatCrack(0.88);
          const timingSkew = grade === 'EARLY' ? -0.32 : 0.32;
          shotYaw += timingSkew;
          const horizSpd = (14.8 + Math.random() * 5.2) * loftMult;
          const vy = 14.8 + Math.random() * 2.6;
          s.ballVel.set(
            Math.sin(shotYaw) * horizSpd,
            vy,
            -Math.cos(shotYaw) * horizSpd,
          );
          s.ballInAirAfterHit = true;
          if (trailMatRef.current) trailMatRef.current.color.set('#fb923c');
        }

        const g = Math.abs(getConfig('gravity'));
        const tAir =
          (s.ballVel.y +
            Math.sqrt(
              Math.max(0, s.ballVel.y * s.ballVel.y + 2 * g * s.ballPos.y),
            )) /
          g;
        s.predictedLanding.set(
          s.ballPos.x + s.ballVel.x * tAir,
          0,
          s.ballPos.z + s.ballVel.z * tAir,
        );

        // Automatically initiate first single run if shot won't carry all the way for 6!
        const estRadial = Math.hypot(
          s.predictedLanding.x,
          s.predictedLanding.z,
        );
        if (estRadial < boundaryR - 1.5) {
          triggerNextCreaseRun();
        } else {
          emitHud(
            grade === 'PERFECT' ? 'PERFECT TIMING!' : `${grade} TIMING`,
            SHOT_CHART_SECTORS[s.aimDir].fullLabel,
            grade === 'PERFECT' ? '#34d399' : '#facc15',
          );
        }
      } else {
        // GROUNDED DRIVE: Skims along turf through gaps, automatically starting 1st single run!
        const driveMult = getConfig('groundedPowerMultiplier');
        if (grade === 'PERFECT') {
          gameAudio.playBatCrack(1.22);
          s.shakeIntensity = 0.16;
          const spd = (32.5 + Math.random() * 3.0) * driveMult;
          s.ballVel.set(
            Math.sin(shotYaw) * spd,
            1.45,
            -Math.cos(shotYaw) * spd,
          );
          if (trailMatRef.current) trailMatRef.current.color.set('#facc15');
        } else {
          gameAudio.playBatCrack(0.92);
          shotYaw += grade === 'EARLY' ? -0.28 : 0.28;
          const spd = (20.8 + Math.random() * 4.5) * driveMult;
          s.ballVel.set(
            Math.sin(shotYaw) * spd,
            1.3,
            -Math.cos(shotYaw) * spd,
          );
          if (trailMatRef.current) trailMatRef.current.color.set('#38bdf8');
        }
        s.ballInAirAfterHit = false;
        s.predictedLanding.set(
          s.ballPos.x + s.ballVel.x * 1.4,
          0,
          s.ballPos.z + s.ballVel.z * 1.4,
        );
        // Automatically initiate the first single run!
        triggerNextCreaseRun();
      }
    },
    [boundaryR, emitHud, timingRef, triggerNextCreaseRun],
  );

  useEffect(() => {
    camera.position.set(
      getConfig('cameraX'),
      getConfig('cameraY'),
      getConfig('cameraZ'),
    );
    currentLookAt.set(0, 1.1, -3);
    camera.lookAt(currentLookAt);
    prepareNextDelivery();
  }, [camera, prepareNextDelivery]);

  // --- MAIN 60FPS STADIUM SIMULATION LOOP ---
  useFrame(({clock}, rawDelta) => {
    const dt = Math.min(rawDelta, 0.05);
    const s = simRef.current;
    const input = inputRef.current;

    if (input) {
      const cancelNow = input.actions.cancel;
      if (
        cancelNow &&
        !s.prevCancel &&
        gameStateRef.current.status === 'PLAYING'
      ) {
        onTogglePauseMenu();
      }
      s.prevCancel = cancelNow;
    }

    if (isPaused || gameState.status !== 'PLAYING') {
      return;
    }

    const t = clock.getElapsedTime();
    const gravity = Math.abs(getConfig('gravity'));
    crowdExcitementRef.current = Math.max(
      0,
      crowdExcitementRef.current - dt * 0.45,
    );

    // 1. Process Unified Shot Chart Aiming, Swing Triggers & Running Between Wickets
    if (input) {
      // A) Direct Wagon-Wheel Sector Aiming:
      //    ArrowLeft/KeyA = LEG (-1), ArrowUp/KeyW = STRAIGHT (0), ArrowRight/KeyD = OFF (+1)
      const aimLegNow = input.actions.aimLeg;
      const aimStrNow = input.actions.aimStraight;
      const aimOffNow = input.actions.aimOff;

      let targetAim = s.aimDir;
      if (
        input.aimLaneOverride !== undefined &&
        input.aimLaneOverride !== null
      ) {
        targetAim = input.aimLaneOverride;
      } else if (aimLegNow && !s.prevAimLeg) {
        targetAim = -1;
      } else if (aimStrNow && !s.prevAimStraight) {
        targetAim = 0;
      } else if (aimOffNow && !s.prevAimOff) {
        targetAim = 1;
      }

      s.prevAimLeg = aimLegNow;
      s.prevAimStraight = aimStrNow;
      s.prevAimOff = aimOffNow;

      if (targetAim !== s.aimDir) {
        s.aimDir = targetAim;
        setVisualAimDir(targetAim);
        gameAudio.playCrispClick();
        emitHud();
      }

      // B) Shot Swing Triggers:
      //    Space = LOFTED, ArrowDown/KeyS = GROUNDED, KeyQ/Shift = DEFEND
      const loftNow = input.actions.lofted;
      const driveNow = input.actions.grounded;
      const defendNow = input.actions.defend;

      let requestedShot: ShotType | null = null;
      if (loftNow && !s.prevLoft) requestedShot = 'LOFTED';
      else if (driveNow && !s.prevDrive) requestedShot = 'GROUNDED';
      else if (defendNow && !s.prevDefend) requestedShot = 'DEFEND';

      s.prevLoft = loftNow;
      s.prevDrive = driveNow;
      s.prevDefend = defendNow;

      if (
        requestedShot &&
        (s.phase === 'RUNUP' || s.phase === 'BOWLED_FLIGHT') &&
        !s.shotPlayedThisBall
      ) {
        // Trigger immediate batter swing & evaluate Z-distance timing right now!
        executeBatSwing(requestedShot);
      }

      // C) Active Running Between the Wickets:
      //    KeyR / Enter = Call Extra Run (+1), KeyC = Cancel Run / Return to Crease
      const callRunNow = input.actions.callRun;
      const cancelRunNow = input.actions.cancelRun;

      if (
        callRunNow &&
        !s.prevCallRun &&
        s.phase === 'BALL_IN_PLAY' &&
        !s.ballReturnedToStumps
      ) {
        if (!s.isRunningSprint && s.completedRunsThisBall < 4) {
          triggerNextCreaseRun();
        } else if (s.isRetreatingCrease) {
          // Reverse retreat and push forward again!
          s.isRetreatingCrease = false;
          s.batterTargetZ = s.batterHomeZ > 0 ? -9.8 : 9.8;
          s.nonStrikerTargetZ = s.nonStrikerHomeZ > 0 ? -9.8 : 9.8;
          gameAudio.playCrispClick();
          emitHud();
        } else if (
          s.completedRunsThisBall + 1 + s.queuedExtraRuns < 4 &&
          s.queuedExtraRuns < 1
        ) {
          s.queuedExtraRuns += 1;
          gameAudio.playCrispClick();
          emitHud();
        }
      }

      if (
        cancelRunNow &&
        !s.prevCancelRun &&
        s.phase === 'BALL_IN_PLAY'
      ) {
        cancelActiveCreaseRun();
      }

      s.prevCallRun = callRunNow;
      s.prevCancelRun = cancelRunNow;
    }

    if (batSwingRef.current.active) {
      batSwingRef.current.progress += dt * 4.2;
      if (batSwingRef.current.progress >= 1.0) {
        batSwingRef.current.active = false;
        batSwingRef.current.progress = 0;
      }
    }

    // 2. Delivery State Machine
    s.phaseTimer += dt;

    if (s.phase === 'RUNUP') {
      const runupDuration = 0.95;
      const progress = Math.min(1, s.phaseTimer / runupDuration);
      const bowlerZ = -18.2 + progress * 8.4;
      bowlerLocoRef.current.speed = 9.2;
      bowlerLocoRef.current.bowlArmAngle =
        progress > 0.7 ? ((progress - 0.7) / 0.3) * Math.PI * 2 : 0;
      if (bowlerGroupRef.current) {
        bowlerGroupRef.current.position.set(0.42, PITCH_SURFACE_Y, bowlerZ);
        bowlerGroupRef.current.rotation.y = Math.PI;
      }
      if (progress >= 1) {
        s.phase = 'BOWLED_FLIGHT';
        s.phaseTimer = 0;
        bowlerLocoRef.current.bowlArmAngle = 0;
        releaseDeliveryBall();
      }
    } else if (s.phase === 'BOWLED_FLIGHT') {
      bowlerLocoRef.current.speed = Math.max(0, 5.2 - s.phaseTimer * 10);
      if (bowlerGroupRef.current && s.phaseTimer < 0.35) {
        bowlerGroupRef.current.position.z += dt * 2.5;
      }

      const subSteps = 3;
      const subDt = dt / subSteps;
      const pitchBounceY = PITCH_SURFACE_Y + 0.105;

      // Update live Timing Meter progress (0 at bowler release -9.8, ~0.897 at sweet spot +9.75, 1.0 at +12.0)
      timingRef.current.visible = true;
      if (timingRef.current.lockedProgress === null) {
        timingRef.current.progress = THREE.MathUtils.clamp(
          (s.ballPos.z - -9.8) / (12.0 - -9.8),
          0,
          1,
        );
      }

      for (let step = 0; step < subSteps; step++) {
        if (s.phase !== 'BOWLED_FLIGHT') break;

        if (!s.hasBounced) {
          s.ballVel.x += s.airSwingAx * subDt;
        }
        s.ballVel.y -= gravity * subDt;
        s.ballPos.addScaledVector(s.ballVel, subDt);

        if (!s.hasBounced && s.ballPos.y <= pitchBounceY) {
          s.ballPos.y = pitchBounceY;
          s.hasBounced = true;
          const restitution =
            s.deliveryType === 'YORKER'
              ? 0.42
              : s.deliveryType === 'FAST_STRAIGHT'
                ? 0.64
                : 0.58;
          s.ballVel.y = Math.abs(s.ballVel.y) * restitution;
          s.ballVel.x += s.spinPostBounceVx;
          gameAudio.playJumpLandingThud();
        }

        if (s.queuedShot && !s.shotPlayedThisBall && s.ballPos.z >= 8.25) {
          const qs = s.queuedShot;
          s.queuedShot = null;
          executeBatSwing(qs);
          break;
        }

        // Stump & Independent Bails Impact Check at Z = 10.8!
        if (
          !stumpsState.dislodged &&
          s.ballPos.z >= 10.68 &&
          s.ballPos.z <= 11.18
        ) {
          if (
            Math.abs(s.ballPos.x) <= 0.23 &&
            s.ballPos.y <= PITCH_SURFACE_Y + 0.78
          ) {
            s.shakeIntensity = 0.55;
            gameAudio.playStumpClatter();
            gameAudio.playCrowdRoar(0.95);
            scatterStumpSet(10.8, s.ballPos.x);
            concludeBall(0, true, 'BOWLED!', 'BAILS FLYING!', '#f43f5e');
            break;
          }
        }

        if (s.ballPos.z >= 12.8) {
          s.ballVisible = false;
          gameAudio.playFootstepWood();
          concludeBall(
            0,
            false,
            'DOT BALL',
            s.shotPlayedThisBall ? 'SWING & MISS' : 'THROUGH TO KEEPER',
            '#94a3b8',
          );
          break;
        }
      }
    } else if (s.phase === 'BALL_IN_PLAY') {
      // ------------------------------------------------------------------
      // A) Advance Sprinting Batters Between the Two Creases (+9.8 & -9.8)
      // ------------------------------------------------------------------
      if (s.isRunningSprint) {
        const sprintStep = RUNNING_CREASE_SPEED * dt;

        const bDiff = s.batterTargetZ - s.batterPosZ;
        if (Math.abs(bDiff) <= sprintStep) {
          s.batterPosZ = s.batterTargetZ;
        } else {
          s.batterPosZ += Math.sign(bDiff) * sprintStep;
        }

        const nsDiff = s.nonStrikerTargetZ - s.nonStrikerPosZ;
        if (Math.abs(nsDiff) <= sprintStep) {
          s.nonStrikerPosZ = s.nonStrikerTargetZ;
        } else {
          s.nonStrikerPosZ += Math.sign(nsDiff) * sprintStep;
        }

        batterLocoRef.current.speed = 9.5;
        nonStrikerLocoRef.current.speed = 9.5;
        // Slide willow bat across the popping crease over the final 2.8m!
        batterLocoRef.current.slidingBat = Math.abs(bDiff) < 2.8;
        nonStrikerLocoRef.current.slidingBat = Math.abs(nsDiff) < 2.8;

        // Orient batters toward the crease they are sprinting to
        if (batterGroupRef.current && Math.abs(bDiff) > 0.05) {
          batterGroupRef.current.rotation.y = bDiff < 0 ? 0 : Math.PI;
        }
        if (nonStrikerGroupRef.current && Math.abs(nsDiff) > 0.05) {
          nonStrikerGroupRef.current.rotation.y = nsDiff < 0 ? 0 : Math.PI;
        }

        // Check if both batters reached their destination crease!
        if (
          Math.abs(s.batterTargetZ - s.batterPosZ) < 0.02 &&
          Math.abs(s.nonStrikerTargetZ - s.nonStrikerPosZ) < 0.02
        ) {
          s.batterHomeZ = s.batterTargetZ;
          s.nonStrikerHomeZ = s.nonStrikerTargetZ;
          s.isRunningSprint = false;
          batterLocoRef.current.speed = 0;
          batterLocoRef.current.slidingBat = false;
          nonStrikerLocoRef.current.speed = 0;
          nonStrikerLocoRef.current.slidingBat = false;

          if (!s.isRetreatingCrease) {
            s.completedRunsThisBall += 1;
            gameAudio.playCoinPickup();
            // If player pre-queued an extra run and ball hasn't settled at stumps yet, fire immediately!
            if (s.queuedExtraRuns > 0 && !s.ballReturnedToStumps) {
              s.queuedExtraRuns -= 1;
              triggerNextCreaseRun();
            } else {
              emitHud(
                `${s.completedRunsThisBall} RUN${s.completedRunsThisBall > 1 ? 'S' : ''} SAFE!`,
                s.ballReturnedToStumps
                  ? 'BALL DEAD'
                  : 'PRESS R / RUN (+1) FOR EXTRA!',
                '#34d399',
              );
            }
          } else {
            s.isRetreatingCrease = false;
            emitHud('SAFE IN CREASE!', 'RUN CANCELLED', '#38bdf8');
          }
        }
      } else {
        batterLocoRef.current.speed = 0;
        batterLocoRef.current.slidingBat = false;
        nonStrikerLocoRef.current.speed = 0;
        nonStrikerLocoRef.current.slidingBat = false;
      }

      // ------------------------------------------------------------------
      // B) Outfield Ball Physics, Fielder Chase, Throw to Stumps & RUN OUT!
      // ------------------------------------------------------------------
      if (!s.fielderHasBall && !s.throwInFlight && !s.ballReturnedToStumps) {
        s.ballVel.y -= gravity * dt;
        s.ballPos.addScaledVector(s.ballVel, dt);
      }

      const radialDist = Math.hypot(s.ballPos.x, s.ballPos.z);
      const fSpeed = getConfig('fielderSpeedBase') * matchConfig.fielderAgility;
      let closestFielderDist = 999;
      let closestFielderIdx = -1;

      for (let i = 0; i < 9; i++) {
        const fp = s.fielderPositions[i];
        if (s.fielderHasBall && s.holdingFielderIdx === i) {
          fielderLocoRefs[i].current.speed = 0;
          continue;
        }
        if (s.throwInFlight || s.ballReturnedToStumps) {
          fielderLocoRefs[i].current.speed = 0;
          continue;
        }

        const targetX = s.ballInAirAfterHit
          ? s.predictedLanding.x
          : s.ballPos.x;
        const targetZ = s.ballInAirAfterHit
          ? s.predictedLanding.z
          : s.ballPos.z;
        const dx = targetX - fp.x;
        const dz = targetZ - fp.z;
        const dToTarget = Math.hypot(dx, dz);

        if (dToTarget < 36 && dToTarget > 0.3) {
          const stepSpd = Math.min(dToTarget, fSpeed * dt);
          fp.x += (dx / dToTarget) * stepSpd;
          fp.z += (dz / dToTarget) * stepSpd;
          const fr = Math.hypot(fp.x, fp.z);
          if (fr > boundaryR - 1.0) {
            fp.x = (fp.x / fr) * (boundaryR - 1.0);
            fp.z = (fp.z / fr) * (boundaryR - 1.0);
          }
          fielderLocoRefs[i].current.speed = fSpeed;
          if (fielderRefs.current[i]) {
            fielderRefs.current[i]!.rotation.y = Math.atan2(dx, dz) + Math.PI;
          }
        } else {
          fielderLocoRefs[i].current.speed = 0;
        }

        const dBall = Math.hypot(s.ballPos.x - fp.x, s.ballPos.z - fp.z);
        if (dBall < closestFielderDist) {
          closestFielderDist = dBall;
          closestFielderIdx = i;
        }
      }

      // 1. Check Boundary SIX! (Clears rope on the full)
      if (
        !s.fielderHasBall &&
        !s.throwInFlight &&
        !s.ballReturnedToStumps &&
        s.ballInAirAfterHit &&
        radialDist >= boundaryR
      ) {
        s.shakeIntensity = 0.45;
        gameAudio.playPowerupChime();
        gameAudio.playCrowdRoar(1.25);
        s.completedRunsThisBall = 0;
        concludeBall(
          6,
          false,
          'SIX!',
          s.isPerfectHit ? 'PERFECT SWEET SPOT!' : 'MASSIVE MAXIMUM!',
          '#facc15',
        );
      } else if (
        // 2. Check Aerial CAUGHT OUT! inside boundary rope
        !s.fielderHasBall &&
        !s.throwInFlight &&
        !s.ballReturnedToStumps &&
        s.ballInAirAfterHit &&
        s.phaseTimer > 0.35 &&
        s.ballPos.y <= 1.65 &&
        s.ballVel.y < 0 &&
        radialDist < boundaryR - 0.8 &&
        closestFielderDist <= 1.85
      ) {
        if (closestFielderIdx >= 0) {
          fielderLocoRefs[closestFielderIdx].current.diving = true;
        }
        s.ballVisible = false;
        s.shakeIntensity = 0.32;
        s.completedRunsThisBall = 0;
        gameAudio.playErrorBuzz();
        gameAudio.playCrowdRoar(0.85);
        concludeBall(
          0,
          true,
          'CAUGHT OUT!',
          'SNARED IN THE OUTFIELD',
          '#f43f5e',
        );
      } else if (
        !s.fielderHasBall &&
        !s.throwInFlight &&
        !s.ballReturnedToStumps
      ) {
        // 3. Outfield Turf Bounce & Rolling Friction
        const onPitchStrip =
          Math.abs(s.ballPos.x) < 1.65 && Math.abs(s.ballPos.z) < 11.6;
        const groundSurfaceY = (onPitchStrip ? PITCH_SURFACE_Y : 0) + 0.105;

        if (s.ballPos.y <= groundSurfaceY) {
          s.ballPos.y = groundSurfaceY;
          if (s.ballInAirAfterHit) {
            s.ballInAirAfterHit = false;
            gameAudio.playJumpLandingThud();
          }
          if (Math.abs(s.ballVel.y) > 1.2) {
            s.ballVel.y = Math.abs(s.ballVel.y) * 0.42;
          } else {
            s.ballVel.y = 0;
          }
          const drag = Math.max(0, 1 - dt * 0.82);
          s.ballVel.x *= drag;
          s.ballVel.z *= drag;
        }

        const groundSpd = Math.hypot(s.ballVel.x, s.ballVel.z);

        // Check Boundary FOUR! (Crosses rope along the ground)
        if (!s.ballInAirAfterHit && radialDist >= boundaryR) {
          s.shakeIntensity = 0.28;
          s.completedRunsThisBall = 0;
          gameAudio.playPowerupChime();
          gameAudio.playCrowdRoar(1.0);
          concludeBall(
            4,
            false,
            'FOUR!',
            s.isPerfectHit ? 'CRACKING PERFECT DRIVE!' : 'RACES TO THE ROPE!',
            '#34d399',
          );
        } else if (
          // Fielder intercepts ground ball OR bowler/keeper gathers near pitch!
          !s.ballInAirAfterHit &&
          ((s.phaseTimer > 0.35 && closestFielderDist <= 1.55) ||
            (groundSpd < 1.2 && radialDist <= 11.5 && s.phaseTimer > 0.9) ||
            s.phaseTimer > 5.5)
        ) {
          if (closestFielderDist <= 1.6 && closestFielderIdx >= 0) {
            s.fielderHasBall = true;
            s.holdingFielderIdx = closestFielderIdx;
            s.pickupDelayTimer = 0.32; // Brief gather & crow-hop before throwing
            const fp = s.fielderPositions[closestFielderIdx];
            s.ballPos.set(fp.x, 1.15, fp.z);
            s.ballVel.set(0, 0, 0);
            gameAudio.playFootstepWood();
            emitHud('FIELDED!', 'THROW INCOMING — WATCH CREASE!', '#f59e0b');
          } else {
            // Ball stopped dead on the pitch near bowler/keeper
            s.ballReturnedToStumps = true;
            s.postReturnSettleTimer = 0.35;
            s.ballVel.set(0, 0, 0);
            emitHud();
          }
        }
      } else if (s.fielderHasBall) {
        // 4. Fielder Gathers & Launches Flat Relay Throw to Vulnerable Stumps End!
        s.pickupDelayTimer -= dt;
        const fIdx = s.holdingFielderIdx;
        if (fIdx >= 0) {
          const fp = s.fielderPositions[fIdx];
          s.ballPos.set(fp.x, 1.35, fp.z);
          if (fielderRefs.current[fIdx]) {
            fielderRefs.current[fIdx]!.rotation.y =
              Math.atan2(-fp.x, -fp.z) + Math.PI;
          }
        }
        if (s.pickupDelayTimer <= 0) {
          s.fielderHasBall = false;
          s.throwInFlight = true;

          // Choose which stumps end to throw at:
          // If batters are sprinting, aim at the end where the incoming runner has further to go (or nearest end)
          let aimEndZ: 10.8 | -10.8 =
            Math.abs(s.ballPos.z - 10.8) < Math.abs(s.ballPos.z - -10.8)
              ? 10.8
              : -10.8;
          if (s.isRunningSprint) {
            const distToBatCrease = Math.min(
              Math.abs(9.8 - s.batterPosZ),
              Math.abs(9.8 - s.nonStrikerPosZ),
            );
            const distToBowlCrease = Math.min(
              Math.abs(-9.8 - s.batterPosZ),
              Math.abs(-9.8 - s.nonStrikerPosZ),
            );
            aimEndZ = distToBatCrease >= distToBowlCrease ? 10.8 : -10.8;
          }
          s.throwTargetEndZ = aimEndZ;

          const dx = 0 - s.ballPos.x;
          const dz = aimEndZ - s.ballPos.z;
          const horizDist = Math.max(1, Math.hypot(dx, dz));
          const throwSpd =
            FIELDER_THROW_SPEED_BASE * (0.92 + matchConfig.fielderAgility * 0.16);
          const flightT = horizDist / throwSpd;
          const vy =
            (PITCH_SURFACE_Y + 0.52 - s.ballPos.y + 0.5 * gravity * flightT * flightT) /
            flightT;

          s.ballVel.set((dx / horizDist) * throwSpd, vy, (dz / horizDist) * throwSpd);
          if (trailMatRef.current) trailMatRef.current.color.set('#ef4444');
          gameAudio.playCrispClick();
          emitHud();
        }
      } else if (s.throwInFlight) {
        // 5. Flat Outfield Throw Flying Toward Stumps!
        s.ballVel.y -= gravity * dt;
        s.ballPos.addScaledVector(s.ballVel, dt);
        const dToStumps = Math.hypot(
          s.ballPos.x,
          s.ballPos.z - s.throwTargetEndZ,
        );
        if (dToStumps <= 0.85 || s.phaseTimer > 8.0) {
          s.throwInFlight = false;
          s.ballReturnedToStumps = true;
          s.ballPos.set(0, PITCH_SURFACE_Y + 0.55, s.throwTargetEndZ);
          s.ballVel.set(0, 0, 0);

          // Check RUN OUT! Is either batter currently outside their safe popping crease (|z| < 9.55)?
          const batterShort = Math.abs(s.batterPosZ) < 9.55;
          const nonStrikerShort = Math.abs(s.nonStrikerPosZ) < 9.55;

          if (batterShort || nonStrikerShort) {
            s.shakeIntensity = 0.48;
            gameAudio.playStumpClatter();
            gameAudio.playCrowdRoar(0.95);
            scatterStumpSet(s.throwTargetEndZ, 0);
            const bankedRuns = s.completedRunsThisBall;
            concludeBall(
              bankedRuns,
              true,
              'RUN OUT!',
              bankedRuns > 0
                ? `CAUGHT SHORT GOING FOR ${bankedRuns + 1}! (+${bankedRuns} RUN${bankedRuns > 1 ? 'S' : ''})`
                : 'CAUGHT SHORT OF THE CREASE!',
              '#f43f5e',
            );
          } else {
            // Safe! Keeper/bowler collects cleanly over the bails
            gameAudio.playFootstepWood();
            s.postReturnSettleTimer = 0.45;
            emitHud();
          }
        }
      } else if (s.ballReturnedToStumps) {
        // 6. Ball Settled in Keeper/Bowler Gloves — Conclude Delivery Cleanly
        s.postReturnSettleTimer -= dt;
        if (!s.isRunningSprint && s.postReturnSettleTimer <= 0) {
          const totalRuns = s.completedRunsThisBall;
          if (totalRuns > 0) {
            concludeBall(
              totalRuns,
              false,
              totalRuns === 1 ? '1 RUN' : `${totalRuns} RUNS!`,
              s.isPerfectHit ? 'CRISP RUNNING BETWEEN WICKETS' : 'GOOD HUSTLE',
              '#38bdf8',
            );
          } else {
            concludeBall(
              0,
              false,
              batSwingRef.current.shotType === 'DEFEND'
                ? 'SOLID BLOCK'
                : 'DOT BALL',
              'NO RUN TAKEN',
              '#cbd5e1',
            );
          }
        }
      }
    } else if (s.phase === 'CELEBRATE_BALL') {
      batterLocoRef.current.speed = 0;
      nonStrikerLocoRef.current.speed = 0;
      bowlerLocoRef.current.speed = 0;
      for (let i = 0; i < 9; i++) {
        fielderLocoRefs[i].current.speed = 0;
      }

      if (s.ballVisible) {
        s.ballVel.y -= gravity * dt;
        s.ballPos.addScaledVector(s.ballVel, dt);
        if (s.ballPos.y < 0.11) {
          s.ballPos.y = 0.11;
          s.ballVel.y = Math.abs(s.ballVel.y) * 0.3;
          s.ballVel.x *= 0.92;
          s.ballVel.z *= 0.92;
        }
      }

      if (s.phaseTimer >= 1.55) {
        if (s.runs >= matchConfig.targetRuns) {
          s.phase = 'MATCH_OVER';
          onMatchEnd('WIN', s.runs, s.wickets, s.ballsBowled);
        } else if (
          s.wickets >= matchConfig.wicketsAllowed ||
          s.ballsBowled >= matchConfig.totalBalls
        ) {
          s.phase = 'MATCH_OVER';
          onMatchEnd('LOSS', s.runs, s.wickets, s.ballsBowled);
        } else {
          prepareNextDelivery();
        }
      }
    }

    // 3. Update Scattered Stumps & Independent Physics-Enabled Bails (Both Ends)
    const stepPieces = (stList: StumpPieceState[], blList: StumpPieceState[]) => {
      stList.forEach((st) => {
        st.vel.y -= gravity * dt;
        st.pos.addScaledVector(st.vel, dt);
        const floorY = PITCH_SURFACE_Y + 0.04;
        if (st.pos.y < floorY) {
          st.pos.y = floorY;
          st.vel.y = Math.abs(st.vel.y) * 0.36;
          st.vel.x *= 0.8;
          st.vel.z *= 0.8;
          st.angVel.multiplyScalar(0.82);
        }
        st.rot.x += st.angVel.x * dt;
        st.rot.y += st.angVel.y * dt;
        st.rot.z += st.angVel.z * dt;
      });
      blList.forEach((bl) => {
        bl.vel.y -= gravity * dt;
        bl.pos.addScaledVector(bl.vel, dt);
        const floorY = PITCH_SURFACE_Y + 0.02;
        if (bl.pos.y < floorY) {
          bl.pos.y = floorY;
          bl.vel.y = Math.abs(bl.vel.y) * 0.46;
          bl.vel.x *= 0.82;
          bl.vel.z *= 0.82;
          bl.angVel.multiplyScalar(0.85);
        }
        bl.rot.x += bl.angVel.x * dt;
        bl.rot.y += bl.angVel.y * dt;
        bl.rot.z += bl.angVel.z * dt;
      });
    };

    if (stumpsState.dislodged) {
      stepPieces(stumpsState.stumps, stumpsState.bails);
    }
    if (stumpsState.bowlDislodged) {
      stepPieces(stumpsState.bowlStumps, stumpsState.bowlBails);
    }

    for (let i = 0; i < 3; i++) {
      const m = stumpRefs.current[i];
      const st = stumpsState.stumps[i];
      if (m && st) {
        m.position.copy(st.pos);
        m.rotation.copy(st.rot);
      }
      const bm = bowlStumpRefs.current[i];
      const bst = stumpsState.bowlStumps[i];
      if (bm && bst) {
        bm.position.copy(bst.pos);
        bm.rotation.copy(bst.rot);
      }
    }
    for (let i = 0; i < 2; i++) {
      const m = bailRefs.current[i];
      const bl = stumpsState.bails[i];
      if (m && bl) {
        m.position.copy(bl.pos);
        m.rotation.copy(bl.rot);
      }
      const bm = bowlBailRefs.current[i];
      const bbl = stumpsState.bowlBails[i];
      if (bm && bbl) {
        bm.position.copy(bbl.pos);
        bm.rotation.copy(bbl.rot);
      }
    }

    // 4. Sync Character, Ball, Bounce Ring, Shot Chart, Trail & Fireworks Transforms
    if (batterGroupRef.current) {
      batterGroupRef.current.position.set(
        s.phase === 'BALL_IN_PLAY' ? 0.55 : 0.38,
        PITCH_SURFACE_Y,
        s.batterPosZ,
      );
      if (s.phase !== 'BALL_IN_PLAY') {
        batterGroupRef.current.rotation.y = 0;
      }
    }
    if (nonStrikerGroupRef.current) {
      nonStrikerGroupRef.current.position.set(
        -1.08,
        PITCH_SURFACE_Y,
        s.nonStrikerPosZ,
      );
      if (s.phase !== 'BALL_IN_PLAY') {
        nonStrikerGroupRef.current.rotation.y = Math.PI;
      }
    }
    for (let i = 0; i < 9; i++) {
      const fg = fielderRefs.current[i];
      if (fg) {
        fg.position.copy(s.fielderPositions[i]);
      }
    }

    if (ballMeshRef.current && ballShadowRef.current) {
      ballMeshRef.current.visible = s.ballVisible;
      ballShadowRef.current.visible = s.ballVisible;
      if (s.ballVisible) {
        ballMeshRef.current.position.copy(s.ballPos);
        ballMeshRef.current.rotation.x += dt * 18;
        ballMeshRef.current.rotation.z += dt * 9;

        const onStrip =
          Math.abs(s.ballPos.x) < 1.65 && Math.abs(s.ballPos.z) < 11.6;
        ballShadowRef.current.position.set(
          s.ballPos.x,
          (onStrip ? PITCH_SURFACE_Y : 0) + 0.012,
          s.ballPos.z,
        );
        const shadowScale = Math.max(0.35, 1.1 - s.ballPos.y * 0.06);
        ballShadowRef.current.scale.set(shadowScale, shadowScale, 1);

        for (let i = TRAIL_COUNT - 1; i > 0; i--) {
          trailHistory[i].copy(trailHistory[i - 1]);
        }
        trailHistory[0].copy(s.ballPos);
      }
    }

    if (trailInstRef.current) {
      for (let i = 0; i < TRAIL_COUNT; i++) {
        const tp = trailHistory[i];
        if (!s.ballVisible || tp.y < -5) {
          scratchObj.position.set(0, -20, 0);
          scratchObj.scale.setScalar(0.001);
        } else {
          const frac = 1 - i / TRAIL_COUNT;
          scratchObj.position.copy(tp);
          scratchObj.scale.setScalar((s.isPerfectHit ? 0.14 : 0.09) * frac);
        }
        scratchObj.updateMatrix();
        trailInstRef.current.setMatrixAt(i, scratchObj.matrix);
      }
      trailInstRef.current.instanceMatrix.needsUpdate = true;
    }

    if (pitchRingRef.current && pitchRingMatRef.current) {
      const showRing = s.phase === 'RUNUP' || s.phase === 'BOWLED_FLIGHT';
      pitchRingRef.current.visible = showRing;
      if (showRing) {
        pitchRingRef.current.position.copy(s.bouncePos);
        const pulse = 0.88 + Math.sin(t * 9) * 0.14;
        pitchRingRef.current.scale.set(pulse, 1, pulse);
        const col = DELIVERY_META[s.deliveryType].ringColor;
        pitchRingMatRef.current.color.set(col);
        pitchRingMatRef.current.emissive.set(col);
      }
    }

    if (aimArrowRef.current) {
      const showAim = s.phase === 'RUNUP' || s.phase === 'BOWLED_FLIGHT';
      aimArrowRef.current.visible = showAim;
    }

    if (fireworksRef.current) {
      for (let i = 0; i < FIREWORK_PARTICLES; i++) {
        const fp = fireworksPool[i];
        if (fp.active) {
          fp.life += dt;
          if (fp.life >= fp.maxLife) {
            fp.active = false;
            scratchObj.position.set(0, -30, 0);
            scratchObj.scale.setScalar(0.001);
          } else {
            fp.vel.y -= 5.5 * dt;
            fp.pos.addScaledVector(fp.vel, dt);
            const alpha = 1 - fp.life / fp.maxLife;
            scratchObj.position.copy(fp.pos);
            scratchObj.scale.setScalar(0.26 * alpha);
            fireworksRef.current.setColorAt(i, fp.color);
          }
        } else {
          scratchObj.position.set(0, -30, 0);
          scratchObj.scale.setScalar(0.001);
        }
        scratchObj.updateMatrix();
        fireworksRef.current.setMatrixAt(i, scratchObj.matrix);
      }
      fireworksRef.current.instanceMatrix.needsUpdate = true;
      if (fireworksRef.current.instanceColor) {
        fireworksRef.current.instanceColor.needsUpdate = true;
      }
    }

    // 5. Dynamic Broadcast & Shot-Follow Camera
    const baseCamX = getConfig('cameraX');
    const baseCamY = getConfig('cameraY');
    const baseCamZ = getConfig('cameraZ');

    if (
      (s.phase === 'BALL_IN_PLAY' ||
        (s.phase === 'CELEBRATE_BALL' &&
          s.ballVisible &&
          !stumpsState.dislodged &&
          !stumpsState.bowlDislodged)) &&
      getConfig('cameraFollowBall')
    ) {
      // Elevated Stadium Shot & Running Camera so player sees both the ball AND sprinting batters!
      camTargetPos.set(
        s.ballPos.x * 0.32,
        Math.max(6.8, 7.2 + s.ballPos.y * 0.42),
        Math.min(26, Math.max(12.5, s.ballPos.z * 0.35 + 18.5)),
      );
      camTargetLook.set(
        s.ballPos.x * 0.68,
        Math.max(0.6, s.ballPos.y * 0.55),
        s.ballPos.z * 0.65,
      );
      camera.position.lerp(camTargetPos, Math.min(1, dt * 3.8));
      currentLookAt.lerp(camTargetLook, Math.min(1, dt * 6.5));
    } else if (s.phase === 'BOWLED_FLIGHT') {
      const approach = THREE.MathUtils.clamp((s.ballPos.z + 10) / 20, 0, 1);
      camTargetPos.set(
        baseCamX,
        baseCamY - approach * 0.28,
        baseCamZ - approach * 1.35,
      );
      camTargetLook.set(0, 1.05, -3.5 + approach * 5.2);
      camera.position.lerp(camTargetPos, Math.min(1, dt * 5.5));
      currentLookAt.lerp(camTargetLook, Math.min(1, dt * 7.5));
    } else {
      camTargetPos.set(baseCamX, baseCamY, baseCamZ);
      camTargetLook.set(0, 1.15, -4.5);
      camera.position.lerp(camTargetPos, Math.min(1, dt * 4.5));
      currentLookAt.lerp(camTargetLook, Math.min(1, dt * 5.5));
    }

    if (s.shakeIntensity > 0.005) {
      camera.position.x += (Math.random() - 0.5) * s.shakeIntensity;
      camera.position.y += (Math.random() - 0.5) * s.shakeIntensity;
      s.shakeIntensity = Math.max(0, s.shakeIntensity - dt * 1.6);
    }

    camera.lookAt(currentLookAt);
  });

  return (
    <group>
      {/* Atmospheric Stadium Fog */}
      <fog attach="fog" args={[getConfig('backgroundColor'), 72, 178]} />

      {/* Batter Crease Highlight Aura PointLight */}
      <pointLight
        position={[0, 4.6, 9.5]}
        intensity={28}
        distance={16}
        decay={1.2}
        color="#fffbeb"
        castShadow={false}
      />

      {/* Custom 3D Stadium Arena with Grandstands, Members Pavilion, Floodlights & 3D Scoreboard */}
      <StadiumArena
        playerPrimary={playerTeamInfo.primaryColor}
        playerSecondary={playerTeamInfo.secondaryColor}
        opponentPrimary={opponentTeamInfo.primaryColor}
        crowdExcitementRef={crowdExcitementRef}
        scoreboardTex={scoreboardTex}
      />

      {/* Bowling End Dynamic Sculpted Ash Stumps & Bails (-Z) */}
      <group>
        {[0, 1, 2].map((idx) => (
          <group
            key={`bowl-stump-${idx}`}
            ref={(el) => {
              bowlStumpRefs.current[idx] = el;
            }}
            position={[-0.11 + idx * 0.11, PITCH_SURFACE_Y + 0.355, -10.8]}>
            <mesh castShadow>
              <cylinderGeometry args={[0.02, 0.021, 0.71, 10]} />
              <meshStandardMaterial color="#e8b878" roughness={0.48} />
            </mesh>
            <mesh position={[0, 0.365, 0]}>
              <sphereGeometry args={[0.019, 8, 8]} />
              <meshStandardMaterial color="#d4a059" roughness={0.48} />
            </mesh>
          </group>
        ))}
        {[0, 1].map((idx) => (
          <group
            key={`bowl-bail-${idx}`}
            ref={(el) => {
              bowlBailRefs.current[idx] = el;
            }}
            position={[-0.055 + idx * 0.11, PITCH_SURFACE_Y + 0.735, -10.8]}
            rotation={[0, 0, Math.PI / 2]}>
            <mesh castShadow>
              <cylinderGeometry args={[0.0095, 0.0095, 0.106, 8]} />
              <meshStandardMaterial color="#fef3c7" roughness={0.42} />
            </mesh>
            <mesh>
              <cylinderGeometry args={[0.0145, 0.0145, 0.046, 8]} />
              <meshStandardMaterial color="#deb887" roughness={0.42} />
            </mesh>
          </group>
        ))}
      </group>

      {/* Batting End Sculpted Ash Stumps & Independent Physics-Enabled Bails (+Z) */}
      <group>
        {[0, 1, 2].map((idx) => (
          <group
            key={`stump-${idx}`}
            ref={(el) => {
              stumpRefs.current[idx] = el;
            }}
            position={[-0.11 + idx * 0.11, PITCH_SURFACE_Y + 0.355, 10.8]}>
            <mesh castShadow>
              <cylinderGeometry args={[0.02, 0.021, 0.71, 10]} />
              <meshStandardMaterial color="#e8b878" roughness={0.48} />
            </mesh>
            <mesh position={[0, 0.365, 0]}>
              <sphereGeometry args={[0.019, 8, 8]} />
              <meshStandardMaterial color="#d4a059" roughness={0.48} />
            </mesh>
          </group>
        ))}
        {[0, 1].map((idx) => (
          <group
            key={`bail-${idx}`}
            ref={(el) => {
              bailRefs.current[idx] = el;
            }}
            position={[-0.055 + idx * 0.11, PITCH_SURFACE_Y + 0.735, 10.8]}
            rotation={[0, 0, Math.PI / 2]}>
            <mesh castShadow>
              <cylinderGeometry args={[0.0095, 0.0095, 0.106, 8]} />
              <meshStandardMaterial color="#fef3c7" roughness={0.42} />
            </mesh>
            <mesh>
              <cylinderGeometry args={[0.0145, 0.0145, 0.046, 8]} />
              <meshStandardMaterial color="#deb887" roughness={0.42} />
            </mesh>
          </group>
        ))}
      </group>

      {/* Glowing 3D Pitch Bounce Indicator Ring */}
      <group ref={pitchRingRef} position={[0, PITCH_SURFACE_Y + 0.008, 5.5]}>
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.32, 0.48, 32]} />
          <meshStandardMaterial
            ref={pitchRingMatRef}
            color="#22d3ee"
            emissive="#22d3ee"
            emissiveIntensity={2.2}
            transparent
            opacity={0.92}
          />
        </mesh>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.003, 0]}>
          <circleGeometry args={[0.28, 24]} />
          <meshBasicMaterial color="#ffffff" transparent opacity={0.28} />
        </mesh>
      </group>

      {/* Visual 3D Wagon-Wheel Shot Chart Guide on Raised Pitch */}
      <ShotChart3D aimDir={visualAimDir} shotChartRef={aimArrowRef} />

      {/* Leather Cricket Ball + Seam + Drop Shadow + Ribbon Trail */}
      <group ref={ballMeshRef} visible={false}>
        <mesh castShadow>
          <sphereGeometry args={[0.105, 16, 16]} />
          <meshStandardMaterial
            color="#dc2626"
            emissive="#7f1d1d"
            emissiveIntensity={0.35}
            roughness={0.3}
            metalness={0.1}
          />
        </mesh>
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.106, 0.012, 6, 20]} />
          <meshBasicMaterial color="#ffffff" />
        </mesh>
      </group>

      <mesh
        ref={ballShadowRef}
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, PITCH_SURFACE_Y + 0.012, 0]}
        visible={false}>
        <circleGeometry args={[0.18, 16]} />
        <meshBasicMaterial color="#000000" transparent opacity={0.48} />
      </mesh>

      <instancedMesh
        ref={trailInstRef}
        args={[undefined, undefined, TRAIL_COUNT]}>
        <sphereGeometry args={[1, 8, 8]} />
        <meshBasicMaterial
          ref={trailMatRef}
          color="#f8fafc"
          transparent
          opacity={0.55}
        />
      </instancedMesh>

      {/* Victory & Boundary Fireworks Instanced Burst */}
      <instancedMesh
        ref={fireworksRef}
        args={[undefined, undefined, FIREWORK_PARTICLES]}>
        <sphereGeometry args={[1, 8, 8]} />
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>

      {/* Striker Batter (Articulated HumanoidCharacter + Helmet + Cane Leg Pads + Selected Bat Skin) */}
      <HumanoidCharacter
        ref={batterGroupRef}
        role="batter"
        primaryColor={playerTeamInfo.primaryColor}
        secondaryColor={playerTeamInfo.secondaryColor}
        skinColor={SOUTH_ASIAN_SKIN_TONES[0]}
        jerseyNumber={18}
        batSkin={batSkin}
        position={[0.38, PITCH_SURFACE_Y, 10.0]}
        rotation={[0, 0, 0]}
        batSwingRef={batSwingRef}
        locomotionRef={batterLocoRef}
      />

      {/* Non-Striker (Player Franchise Kit + Helmet + Pads + Selected Bat Skin) */}
      <HumanoidCharacter
        ref={nonStrikerGroupRef}
        role="nonStriker"
        primaryColor={playerTeamInfo.primaryColor}
        secondaryColor={playerTeamInfo.secondaryColor}
        skinColor={SOUTH_ASIAN_SKIN_TONES[2]}
        jerseyNumber={45}
        batSkin={batSkin}
        position={[-1.12, PITCH_SURFACE_Y, -9.6]}
        rotation={[0, Math.PI, 0]}
        scale={0.98}
        locomotionRef={nonStrikerLocoRef}
      />

      {/* Animated Bowler (Opponent Franchise Kit, Cap, Smooth Run-up & Over-arm Action) */}
      <HumanoidCharacter
        ref={bowlerGroupRef}
        role="bowler"
        headgear="cap"
        primaryColor={opponentTeamInfo.primaryColor}
        secondaryColor={opponentTeamInfo.secondaryColor}
        skinColor={SOUTH_ASIAN_SKIN_TONES[1]}
        jerseyNumber={93}
        position={[0.42, PITCH_SURFACE_Y, -18.2]}
        rotation={[0, Math.PI, 0]}
        scale={1.03}
        locomotionRef={bowlerLocoRef}
      />

      {/* Wicketkeeper (Low Crouch behind Striker's Stumps, Keeping Gloves & Short Pads) */}
      <HumanoidCharacter
        ref={keeperGroupRef}
        role="keeper"
        headgear="cap"
        primaryColor={opponentTeamInfo.primaryColor}
        secondaryColor={opponentTeamInfo.secondaryColor}
        skinColor={SOUTH_ASIAN_SKIN_TONES[3]}
        jerseyNumber={7}
        position={[0, 0, 12.8]}
        rotation={[0, 0, 0]}
        scale={0.97}
        locomotionRef={keeperLocoRef}
      />

      {/* 9 Animated Outfielders (Opponent Kit, Caps & Sun Hats, Ready Crouch & Sprint) */}
      {BASE_FIELDER_SPOTS.map(([fx, fz], idx) => {
        const faceCenterYaw = Math.atan2(-fx, 9.75 - fz) + Math.PI;
        return (
          <HumanoidCharacter
            key={`fielder-${idx}`}
            ref={(el) => {
              fielderRefs.current[idx] = el;
            }}
            role="fielder"
            headgear={idx % 3 === 1 ? 'sunhat' : 'cap'}
            primaryColor={opponentTeamInfo.primaryColor}
            secondaryColor={opponentTeamInfo.secondaryColor}
            skinColor={
              SOUTH_ASIAN_SKIN_TONES[idx % SOUTH_ASIAN_SKIN_TONES.length]
            }
            jerseyNumber={FIELDER_JERSEY_NUMBERS[idx]}
            position={[fx, 0, fz]}
            rotation={[0, faceCenterYaw, 0]}
            scale={0.96 + (idx % 3) * 0.035}
            locomotionRef={fielderLocoRefs[idx]}
          />
        );
      })}
    </group>
  );
}

// ============================================================================
// CAMERA & LIGHTING RIG
// ============================================================================

function CameraSetup() {
  const {camera, scene} = useThree();

  useEffect(() => {
    scene.background = new THREE.Color(getConfig('backgroundColor'));
    if (camera instanceof THREE.PerspectiveCamera) {
      camera.fov = getConfig('fov');
      camera.updateProjectionMatrix();
    }
  }, [camera, scene]);

  return null;
}

function SunLight() {
  const lightRef = useRef<THREE.DirectionalLight>(null);
  const {camera} = useThree();

  useFrame(() => {
    const light = lightRef.current;
    if (!light) return;

    camera.getWorldDirection(sunForward);
    sunFocus
      .copy(camera.position)
      .addScaledVector(sunForward, SUN_FOCUS_DISTANCE);
    sunFocus.y = 0;

    light.position.set(
      sunFocus.x + SUN_OFFSET[0],
      sunFocus.y + SUN_OFFSET[1],
      sunFocus.z + SUN_OFFSET[2],
    );
    light.target.position.copy(sunFocus);
    light.target.updateMatrixWorld();
  });

  return (
    <directionalLight
      ref={lightRef}
      intensity={getConfig('sunIntensity')}
      color={getConfig('sunColor')}
      castShadow
      shadow-mapSize={[1024, 1024]}
      shadow-camera-near={0.5}
      shadow-camera-far={115}
      shadow-camera-left={-SUN_SHADOW_EXTENT}
      shadow-camera-right={SUN_SHADOW_EXTENT}
      shadow-camera-top={SUN_SHADOW_EXTENT}
      shadow-camera-bottom={-SUN_SHADOW_EXTENT}
      shadow-bias={-0.0005}
      shadow-normalBias={0.02}
    />
  );
}

// ============================================================================
// WEBGL AVAILABILITY & ERROR BOUNDARY
// ============================================================================

function canCreateWebGLContext(): boolean {
  if (typeof document === 'undefined') return true;
  try {
    const probeCanvas = document.createElement('canvas');
    probeCanvas.width = 1;
    probeCanvas.height = 1;
    const gl = probeCanvas.getContext('webgl2');
    if (!gl) return false;
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    probeCanvas.width = 0;
    probeCanvas.height = 0;
    return true;
  } catch {
    return false;
  }
}

function WebGlUnavailableFallback() {
  return (
    <div
      role="alert"
      className="w-full h-full flex items-center justify-center bg-zinc-950 text-zinc-300 p-6 text-center text-sm">
      3D graphics unavailable on this device or browser tab.
    </div>
  );
}

const WEBGL_CONTEXT_ERROR_RE = /webgl2? context/i;

interface CanvasErrorBoundaryProps {
  readonly children: React.ReactNode;
}

interface CanvasErrorBoundaryState {
  readonly error: Error | null;
}

class CanvasErrorBoundary extends Component {
  declare readonly props: CanvasErrorBoundaryProps;
  state: CanvasErrorBoundaryState = {error: null};

  static getDerivedStateFromError(error: Error): CanvasErrorBoundaryState {
    return {error};
  }

  componentDidCatch(error: Error): void {
    if (WEBGL_CONTEXT_ERROR_RE.test(error?.message ?? '')) {
      console.error(error);
    }
  }

  render(): React.ReactNode {
    const {error} = this.state;
    if (error) {
      if (!WEBGL_CONTEXT_ERROR_RE.test(error.message ?? '')) {
        throw error;
      }
      return <WebGlUnavailableFallback />;
    }
    return this.props.children;
  }
}

// ============================================================================
// MAIN EXPORTED GAME COMPONENT
// ============================================================================

const DEFAULT_TIMING_SNAPSHOT: TimingMeterSnapshot = {
  visible: false,
  progress: 0,
  lockedProgress: null,
  grade: null,
};

export function Game({
  gameState,
  setGameState,
  exitChat,
  gameStateRef,
  externalInputRef,
  timingMeterRef,
  matchConfig,
  batSkin = 'CLASSIC_WILLOW',
  isPaused,
  onTogglePauseMenu,
  onHudUpdate,
  onMatchEnd,
}: {
  gameState: GameState;
  setGameState: React.Dispatch<React.SetStateAction<GameState>>;
  exitChat: (payload: Record<string, unknown>) => Promise<void>;
  gameStateRef: React.MutableRefObject<GameState>;
  externalInputRef?: React.MutableRefObject<InputSnapshot>;
  timingMeterRef?: React.MutableRefObject<TimingMeterSnapshot>;
  matchConfig: MatchConfig;
  batSkin?: BatSkinId;
  isPaused: boolean;
  onTogglePauseMenu: () => void;
  onHudUpdate: (hud: LiveScoreHud) => void;
  onMatchEnd: (
    outcome: 'WIN' | 'LOSS',
    runs: number,
    wickets: number,
    ballsBowled: number,
  ) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const fallbackTimingRef = useRef<TimingMeterSnapshot>({
    ...DEFAULT_TIMING_SNAPSHOT,
  });
  const activeTimingRef = timingMeterRef ?? fallbackTimingRef;
  const inputRef = useInput(containerRef, {enabled: true, externalInputRef});
  const [webGlAvailable, setWebGlAvailable] = useState(canCreateWebGLContext);

  const createGlRenderer = useCallback(
    (defaultProps: Record<string, unknown>) => {
      try {
        const renderer = new THREE.WebGLRenderer({
          ...defaultProps,
          antialias: true,
        });
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.1;
        return renderer;
      } catch (err) {
        console.error(err);
        setWebGlAvailable(false);
        return new Promise<never>(() => {});
      }
    },
    [],
  );

  return (
    <div
      ref={containerRef}
      className="w-full h-full canvas-wrapper overflow-hidden">
      {webGlAvailable ? (
        <CanvasErrorBoundary>
          <Canvas
            shadows
            dpr={[1, 1.5]}
            camera={STATIC_CAMERA_PROPS}
            gl={createGlRenderer}
            className="w-full h-full block">
            <Suspense fallback={null}>
              <CameraSetup />

              {/* High-Intensity Floodlight & Hemisphere Rig */}
              <hemisphereLight
                color={getConfig('hemiSkyColor')}
                groundColor={getConfig('hemiGroundColor')}
                intensity={getConfig('hemiIntensity')}
              />
              <SunLight />

              <Physics
                gravity={[0, getConfig('gravity'), 0]}
                paused={isPaused || gameState.status !== 'PLAYING'}
                timeStep="vary">
                <Scene
                  gameState={gameState}
                  setGameState={setGameState}
                  inputRef={inputRef}
                  timingRef={activeTimingRef}
                  exitChat={exitChat}
                  gameStateRef={gameStateRef}
                  matchConfig={matchConfig}
                  batSkin={batSkin}
                  isPaused={isPaused}
                  onTogglePauseMenu={onTogglePauseMenu}
                  onHudUpdate={setHudProxy(onHudUpdate)}
                  onMatchEnd={onMatchEnd}
                />
              </Physics>

              <EffectComposer>
                <Bloom
                  luminanceThreshold={1.05}
                  luminanceSmoothing={0.85}
                  intensity={0.48}
                  mipmapBlur
                />
              </EffectComposer>
            </Suspense>
          </Canvas>
        </CanvasErrorBoundary>
      ) : (
        <WebGlUnavailableFallback />
      )}
    </div>
  );
}

function setHudProxy(cb: (hud: LiveScoreHud) => void) {
  return cb;
}
