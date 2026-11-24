import {useFrame} from '@react-three/fiber';
import React, {forwardRef, useMemo, useRef} from 'react';
import type {MutableRefObject} from 'react';
import * as THREE from 'three';
import {AimDirection, BatSkinId, ShotType} from '../types';

/** Stable defaults so React props don't fight imperative ref updates. */
const DEFAULT_POSITION: [number, number, number] = [0, 0, 0];
const DEFAULT_ROTATION: [number, number, number] = [0, 0, 0];

export type CricketerRole =
  | 'batter'
  | 'nonStriker'
  | 'bowler'
  | 'fielder'
  | 'keeper'
  | 'generic';

export interface HumanoidCharacterProps {
  key?: React.Key;
  position?: [number, number, number];
  rotation?: [number, number, number];
  scale?: number;
  /** Standard template animation state fallback */
  state?: 'idle' | 'walk' | 'run' | 'action';
  /** Standard template tool fallback */
  toolType?: 'none' | 'pickaxe' | 'sword';
  /** Cricket athlete role */
  role?: CricketerRole;
  /** Headwear override for bowlers & outfielders ('helmet' | 'cap' | 'sunhat' | 'none') */
  headgear?: 'helmet' | 'cap' | 'sunhat' | 'none';
  skinColor?: string;
  /** Primary kit jersey color (aliases clothesColor) */
  primaryColor?: string;
  /** Secondary kit accent/trim color */
  secondaryColor?: string;
  clothesColor?: string;
  pantsColor?: string;
  /** Back of shirt squad number (1..99) */
  jerseyNumber?: number;
  /** Selected 3D bat skin for batters */
  batSkin?: BatSkinId;
  batSwingRef?: MutableRefObject<{
    active: boolean;
    progress: number;
    shotType: ShotType;
    aimDir: AimDirection;
  }>;
  locomotionRef?: MutableRefObject<{
    speed: number;
    bowlArmAngle?: number;
    diving?: boolean;
    slidingBat?: boolean;
  }>;
  castShadow?: boolean;
}

// ============================================================================
// PROCEDURAL PBR TEXTURE CACHES (Jersey Numbers & 5 Bat Skins — Zero URLs)
// ============================================================================

const jerseyTextureCache = new Map<string, THREE.CanvasTexture>();

function getJerseyTexture(
  primaryColor: string,
  secondaryColor: string,
  jerseyNumber: number,
): THREE.CanvasTexture {
  const num = Math.max(1, Math.min(99, Math.floor(jerseyNumber)));
  const key = `${primaryColor}|${secondaryColor}|${num}`;
  const cached = jerseyTextureCache.get(key);
  if (cached) return cached;

  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    // Base jersey fabric
    ctx.fillStyle = primaryColor;
    ctx.fillRect(0, 0, 256, 256);

    // Subtle breathable micro-mesh weave
    ctx.fillStyle = 'rgba(255, 255, 255, 0.045)';
    for (let y = 0; y < 256; y += 4) {
      for (let x = (y % 8 === 0 ? 0 : 2); x < 256; x += 4) {
        ctx.fillRect(x, y, 2, 2);
      }
    }

    // In Three.js Cylinder/Capsule UV: u=0.5 faces +Z (Back), u=0.0/1.0 faces -Z (Front)
    // Side athletic panels at u=0.25 and u=0.75
    ctx.fillStyle = secondaryColor;
    ctx.fillRect(54, 0, 18, 256);
    ctx.fillRect(184, 0, 18, 256);

    // Front chest V-chevron & sponsor stripe near u=0 and u=1
    ctx.fillStyle = secondaryColor;
    ctx.fillRect(0, 78, 42, 28);
    ctx.fillRect(214, 78, 42, 28);
    ctx.fillStyle = 'rgba(255,255,255,0.88)';
    ctx.fillRect(0, 90, 38, 6);
    ctx.fillRect(218, 90, 38, 6);

    // Bold Back Jersey Number centered at u = 0.5 (x = 128)
    const numStr = String(num);
    ctx.save();
    ctx.font = '900 84px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 8;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.65)';
    ctx.strokeText(numStr, 128, 118);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(numStr, 128, 118);

    // Thin secondary trim bar above number
    ctx.fillStyle = secondaryColor;
    ctx.fillRect(92, 56, 72, 8);
    ctx.restore();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  jerseyTextureCache.set(key, tex);
  return tex;
}

interface BatMaterialPack {
  bladeMap: THREE.CanvasTexture;
  roughnessMap: THREE.CanvasTexture;
  emissiveMap: THREE.CanvasTexture | null;
  metalness: number;
  roughness: number;
  emissiveColor: string;
  emissiveIntensity: number;
  gripBaseColor: string;
  gripRingColor: string;
  toeGuardColor: string;
}

const batSkinCache = new Map<string, BatMaterialPack>();

function drawCrown(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  w: number,
  h: number,
) {
  ctx.beginPath();
  ctx.moveTo(cx - w * 0.5, cy + h * 0.4);
  ctx.lineTo(cx - w * 0.58, cy - h * 0.35);
  ctx.lineTo(cx - w * 0.22, cy + h * 0.05);
  ctx.lineTo(cx, cy - h * 0.5);
  ctx.lineTo(cx + w * 0.22, cy + h * 0.05);
  ctx.lineTo(cx + w * 0.58, cy - h * 0.35);
  ctx.lineTo(cx + w * 0.5, cy + h * 0.4);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

function getBatMaterialPack(
  skin: BatSkinId,
  primaryColor: string,
  secondaryColor: string,
): BatMaterialPack {
  const key =
    skin === 'FRANCHISE_PRO'
      ? `${skin}|${primaryColor}|${secondaryColor}`
      : skin;
  const existing = batSkinCache.get(key);
  if (existing) return existing;

  const w = 256;
  const h = 512;

  const colorCanvas = document.createElement('canvas');
  colorCanvas.width = w;
  colorCanvas.height = h;
  const ctx = colorCanvas.getContext('2d')!;

  const roughCanvas = document.createElement('canvas');
  roughCanvas.width = w;
  roughCanvas.height = h;
  const rCtx = roughCanvas.getContext('2d')!;

  let emissiveCanvas: HTMLCanvasElement | null = null;
  let metalness = 0.06;
  let roughness = 0.52;
  let emissiveColor = '#000000';
  let emissiveIntensity = 0;
  let gripBaseColor = '#1e293b';
  let gripRingColor = secondaryColor;
  let toeGuardColor = '#18181b';

  // Helper to paint realistic English willow grain
  const paintWillowBase = (lightHex: string, grainHex: string) => {
    const grad = ctx.createLinearGradient(0, 0, w, 0);
    grad.addColorStop(0, grainHex);
    grad.addColorStop(0.22, lightHex);
    grad.addColorStop(0.78, lightHex);
    grad.addColorStop(1, grainHex);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // 9 straight English willow vertical grains
    ctx.strokeStyle = 'rgba(138, 98, 54, 0.28)';
    for (let i = 1; i <= 11; i++) {
      const gx = (w / 12) * i;
      ctx.lineWidth = i % 3 === 0 ? 2.2 : 1.2;
      ctx.beginPath();
      ctx.moveTo(gx, 0);
      for (let y = 0; y <= h; y += 32) {
        ctx.lineTo(gx + Math.sin(y * 0.03 + i) * 1.6, y);
      }
      ctx.stroke();
    }

    rCtx.fillStyle = '#9a9a9a';
    rCtx.fillRect(0, 0, w, h);
    rCtx.strokeStyle = '#b8b8b8';
    for (let i = 1; i <= 11; i++) {
      const gx = (w / 12) * i;
      rCtx.beginPath();
      rCtx.moveTo(gx, 0);
      rCtx.lineTo(gx, h);
      rCtx.stroke();
    }
  };

  if (skin === 'CLASSIC_WILLOW') {
    paintWillowBase('#ebd5ad', '#d4b37f');
    gripBaseColor = '#f8fafc';
    gripRingColor = '#dc2626';
    toeGuardColor = '#1c1917';

    // Classic minimal gold/crimson shoulder crest
    ctx.fillStyle = '#991b1b';
    ctx.beginPath();
    ctx.moveTo(w * 0.2, h * 0.08);
    ctx.lineTo(w * 0.8, h * 0.08);
    ctx.lineTo(w * 0.5, h * 0.22);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#d97706';
    ctx.lineWidth = 4;
    ctx.stroke();

    // Subtle red cherry ball seam marks on the sweet spot (y ~ 0.58..0.74)
    const cherrySpots = [
      {x: w * 0.48, y: h * 0.63, r: 16, rot: 0.25},
      {x: w * 0.57, y: h * 0.69, r: 13, rot: -0.35},
      {x: w * 0.41, y: h * 0.72, r: 11, rot: 0.12},
      {x: w * 0.52, y: h * 0.57, r: 10, rot: -0.18},
    ];
    cherrySpots.forEach((sp) => {
      const rg = ctx.createRadialGradient(
        sp.x,
        sp.y,
        1,
        sp.x,
        sp.y,
        Math.max(2, sp.r),
      );
      rg.addColorStop(0, 'rgba(185, 28, 28, 0.62)');
      rg.addColorStop(0.65, 'rgba(153, 27, 27, 0.28)');
      rg.addColorStop(1, 'rgba(153, 27, 27, 0)');
      ctx.fillStyle = rg;
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, Math.max(2, sp.r), 0, Math.PI * 2);
      ctx.fill();

      // Faint stitched seam impression inside cherry mark
      ctx.save();
      ctx.translate(sp.x, sp.y);
      ctx.rotate(sp.rot);
      ctx.strokeStyle = 'rgba(255, 235, 235, 0.35)';
      ctx.lineWidth = 1.4;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(-sp.r * 0.6, -2);
      ctx.lineTo(sp.r * 0.6, -2);
      ctx.moveTo(-sp.r * 0.6, 2);
      ctx.lineTo(sp.r * 0.6, 2);
      ctx.stroke();
      ctx.restore();
    });
  } else if (skin === 'FRANCHISE_PRO') {
    paintWillowBase('#efe0c2', '#d7ba89');
    gripBaseColor = primaryColor;
    gripRingColor = secondaryColor;
    toeGuardColor = primaryColor;
    roughness = 0.44;

    // Bold Team Primary & Secondary Pro Sticker Chevrons
    ctx.fillStyle = primaryColor;
    ctx.beginPath();
    ctx.moveTo(18, 28);
    ctx.lineTo(w - 18, 28);
    ctx.lineTo(w - 18, 210);
    ctx.lineTo(w * 0.5, 268);
    ctx.lineTo(18, 210);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = secondaryColor;
    ctx.lineWidth = 10;
    ctx.stroke();

    // Lower edge pro decals framing the sweet spot
    ctx.fillStyle = secondaryColor;
    ctx.fillRect(10, 250, 20, 210);
    ctx.fillRect(w - 30, 250, 20, 210);
    ctx.fillStyle = primaryColor;
    ctx.fillRect(16, 270, 8, 175);
    ctx.fillRect(w - 24, 270, 8, 175);

    // Glossy sticker region in roughness map
    rCtx.fillStyle = '#484848';
    rCtx.fillRect(18, 28, w - 36, 240);
  } else if (skin === 'CARBON_VIPER') {
    metalness = 0.45;
    roughness = 0.34;
    gripBaseColor = '#09090b';
    gripRingColor = '#22c55e';
    toeGuardColor = '#16a34a';

    // Matte black woven 3K carbon-fiber pattern
    ctx.fillStyle = '#111317';
    ctx.fillRect(0, 0, w, h);
    rCtx.fillStyle = '#555555';
    rCtx.fillRect(0, 0, w, h);

    const cell = 12;
    for (let y = 0; y < h; y += cell) {
      for (let x = 0; x < w; x += cell) {
        const alt = ((x / cell + y / cell) | 0) % 2 === 0;
        ctx.fillStyle = alt ? '#1e2229' : '#0b0d10';
        ctx.fillRect(x, y, cell - 1, cell - 1);
        rCtx.fillStyle = alt ? '#3a3a3a' : '#787878';
        rCtx.fillRect(x, y, cell - 1, cell - 1);
      }
    }

    // Neon green edge decals & viper fangs
    ctx.fillStyle = '#22c55e';
    ctx.fillRect(8, 16, 16, h - 32);
    ctx.fillRect(w - 24, 16, 16, h - 32);

    ctx.strokeStyle = '#4ade80';
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(w * 0.24, 70);
    ctx.lineTo(w * 0.5, 165);
    ctx.lineTo(w * 0.76, 70);
    ctx.moveTo(w * 0.28, 310);
    ctx.lineTo(w * 0.5, 380);
    ctx.lineTo(w * 0.72, 310);
    ctx.stroke();

    emissiveCanvas = document.createElement('canvas');
    emissiveCanvas.width = w;
    emissiveCanvas.height = h;
    const eCtx = emissiveCanvas.getContext('2d')!;
    eCtx.fillStyle = '#000000';
    eCtx.fillRect(0, 0, w, h);
    eCtx.fillStyle = '#22c55e';
    eCtx.fillRect(10, 24, 10, h - 48);
    eCtx.fillRect(w - 20, 24, 10, h - 48);
    emissiveColor = '#22c55e';
    emissiveIntensity = 0.65;
  } else if (skin === 'ROYAL_GOLD') {
    metalness = 0.86;
    roughness = 0.22;
    gripBaseColor = '#fefce8';
    gripRingColor = '#d97706';
    toeGuardColor = '#78350f';

    // Brushed metallic gold gradient
    const goldGrad = ctx.createLinearGradient(0, 0, w, h);
    goldGrad.addColorStop(0, '#fef08a');
    goldGrad.addColorStop(0.3, '#eab308');
    goldGrad.addColorStop(0.55, '#fef9c3');
    goldGrad.addColorStop(0.8, '#ca8a04');
    goldGrad.addColorStop(1, '#facc15');
    ctx.fillStyle = goldGrad;
    ctx.fillRect(0, 0, w, h);

    // Fine horizontal brushed metal streaks
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
    ctx.lineWidth = 1;
    for (let y = 0; y < h; y += 3) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    // Engraved Royal Crown & Filigree Border
    ctx.strokeStyle = '#78350f';
    ctx.lineWidth = 6;
    ctx.strokeRect(18, 22, w - 36, h - 44);
    ctx.strokeStyle = '#fef9c3';
    ctx.lineWidth = 2;
    ctx.strokeRect(26, 30, w - 52, h - 60);

    ctx.fillStyle = '#92400e';
    ctx.strokeStyle = '#fef08a';
    ctx.lineWidth = 3;
    drawCrown(ctx, w * 0.5, h * 0.34, 110, 74);

    // Sweet-spot royal diamond medallion
    ctx.beginPath();
    ctx.moveTo(w * 0.5, h * 0.54);
    ctx.lineTo(w * 0.72, h * 0.66);
    ctx.lineTo(w * 0.5, h * 0.78);
    ctx.lineTo(w * 0.28, h * 0.66);
    ctx.closePath();
    ctx.stroke();

    rCtx.fillStyle = '#383838';
    rCtx.fillRect(0, 0, w, h);
  } else {
    // INFERNO_BLAZE: Charred volcanic wood with glowing orange/red magma cracks
    metalness = 0.18;
    roughness = 0.72;
    gripBaseColor = '#1c1917';
    gripRingColor = '#f97316';
    toeGuardColor = '#ea580c';

    ctx.fillStyle = '#191513';
    ctx.fillRect(0, 0, w, h);

    // Charred bark grain
    ctx.strokeStyle = '#29221e';
    ctx.lineWidth = 3;
    for (let i = 0; i < 18; i++) {
      const gx = (w / 18) * i;
      ctx.beginPath();
      ctx.moveTo(gx, 0);
      ctx.lineTo(gx + (i % 2 === 0 ? 5 : -5), h);
      ctx.stroke();
    }

    rCtx.fillStyle = '#bdbdbd';
    rCtx.fillRect(0, 0, w, h);

    emissiveCanvas = document.createElement('canvas');
    emissiveCanvas.width = w;
    emissiveCanvas.height = h;
    const eCtx = emissiveCanvas.getContext('2d')!;
    eCtx.fillStyle = '#000000';
    eCtx.fillRect(0, 0, w, h);

    // Jagged glowing magma fissures along center spine & branching outward
    const drawMagmaCrack = (pts: Array<[number, number]>, width: number) => {
      for (const targetCtx of [ctx, eCtx]) {
        targetCtx.save();
        targetCtx.lineCap = 'round';
        targetCtx.lineJoin = 'round';
        targetCtx.strokeStyle = '#ea580c';
        targetCtx.lineWidth = width * 2.1;
        targetCtx.beginPath();
        pts.forEach(([px, py], idx) =>
          idx === 0 ? targetCtx.moveTo(px, py) : targetCtx.lineTo(px, py),
        );
        targetCtx.stroke();

        targetCtx.strokeStyle = '#fde047';
        targetCtx.lineWidth = width * 0.75;
        targetCtx.stroke();
        targetCtx.restore();
      }
    };

    drawMagmaCrack(
      [
        [w * 0.5, 35],
        [w * 0.44, 115],
        [w * 0.55, 195],
        [w * 0.46, 285],
        [w * 0.54, 375],
        [w * 0.49, 465],
      ],
      6,
    );
    drawMagmaCrack(
      [
        [w * 0.44, 115],
        [w * 0.22, 165],
        [w * 0.15, 225],
      ],
      3.5,
    );
    drawMagmaCrack(
      [
        [w * 0.55, 195],
        [w * 0.78, 250],
        [w * 0.84, 320],
      ],
      3.5,
    );
    drawMagmaCrack(
      [
        [w * 0.46, 285],
        [w * 0.24, 345],
        [w * 0.18, 420],
      ],
      4,
    );

    emissiveColor = '#ff5500';
    emissiveIntensity = 2.2;
  }

  const bladeMap = new THREE.CanvasTexture(colorCanvas);
  bladeMap.colorSpace = THREE.SRGBColorSpace;
  const roughnessMap = new THREE.CanvasTexture(roughCanvas);
  const emissiveMap = emissiveCanvas
    ? new THREE.CanvasTexture(emissiveCanvas)
    : null;
  if (emissiveMap) {
    emissiveMap.colorSpace = THREE.SRGBColorSpace;
  }

  const pack: BatMaterialPack = {
    bladeMap,
    roughnessMap,
    emissiveMap,
    metalness,
    roughness,
    emissiveColor,
    emissiveIntensity,
    gripBaseColor,
    gripRingColor,
    toeGuardColor,
  };
  batSkinCache.set(key, pack);
  return pack;
}

// ============================================================================
// AUTHENTIC 3D CRICKET BAT GEOMETRY (Handle Grip Rings, Curved Shoulders, Spine)
// ============================================================================

let sharedSpineGeometry: THREE.BufferGeometry | null = null;
function getBatSpineGeometry(): THREE.BufferGeometry {
  if (sharedSpineGeometry) return sharedSpineGeometry;
  // Triangular ridge cross-section extruded vertically and tapered at top/bottom
  const shape = new THREE.Shape();
  shape.moveTo(-0.068, 0);
  shape.lineTo(0.068, 0);
  shape.lineTo(0, 0.038); // Prominent back spine apex (+Z)
  shape.closePath();

  const extrude = new THREE.ExtrudeGeometry(shape, {
    steps: 8,
    depth: 0.56,
    bevelEnabled: false,
  });
  // Rotate so extrusion runs vertically along Y (from -0.28 to +0.28) and spine points +Z
  extrude.rotateX(-Math.PI / 2);
  extrude.translate(0, -0.28, 0);

  // Taper spine depth smoothly toward shoulders (+Y) and toe (-Y), peaking at sweet spot (-0.06)
  const pos = extrude.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const z = pos.getZ(i);
    if (z > 0.002) {
      const distFromSweetSpot = Math.abs(y - -0.05) / 0.26;
      const swell = Math.max(0.22, 1.0 - distFromSweetSpot * distFromSweetSpot * 0.72);
      pos.setZ(i, z * swell);
    }
  }
  extrude.computeVertexNormals();
  sharedSpineGeometry = extrude;
  return sharedSpineGeometry;
}

export function CricketBat3D({
  skin = 'CLASSIC_WILLOW',
  primaryColor = '#0052cc',
  secondaryColor = '#f5b700',
  castShadow = true,
}: {
  skin?: BatSkinId;
  primaryColor?: string;
  secondaryColor?: string;
  castShadow?: boolean;
}) {
  const matPack = useMemo(
    () => getBatMaterialPack(skin, primaryColor, secondaryColor),
    [skin, primaryColor, secondaryColor],
  );
  const spineGeo = useMemo(() => getBatSpineGeometry(), []);

  return (
    <group>
      {/* Cylindrical Cane Handle with Rubber Grip */}
      <mesh position={[0, -0.5, -0.14]} castShadow={castShadow}>
        <cylinderGeometry args={[0.021, 0.022, 0.28, 12]} />
        <meshStandardMaterial color={matPack.gripBaseColor} roughness={0.75} />
      </mesh>
      {/* Pommel Cap */}
      <mesh position={[0, -0.355, -0.14]}>
        <sphereGeometry args={[0.023, 10, 8]} />
        <meshStandardMaterial color={matPack.gripRingColor} roughness={0.5} />
      </mesh>
      {/* Colored Rubber Grip Rings */}
      {[-0.4, -0.45, -0.5, -0.55, -0.6].map((gy, idx) => (
        <mesh
          key={idx}
          position={[0, gy, -0.14]}
          rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.0225, 0.0038, 6, 14]} />
          <meshStandardMaterial color={matPack.gripRingColor} roughness={0.45} />
        </mesh>
      ))}

      {/* Curved Bat Shoulders Tapering Handle -> Full Blade */}
      <mesh
        position={[0, -0.675, -0.14]}
        scale={[1, 1, 0.34]}
        castShadow={castShadow}>
        <cylinderGeometry args={[0.024, 0.074, 0.09, 12]} />
        <meshStandardMaterial
          map={matPack.bladeMap}
          roughnessMap={matPack.roughnessMap}
          metalness={matPack.metalness}
          roughness={matPack.roughness}
        />
      </mesh>

      {/* Main Flat-Faced Willow Blade (-Z Hitting Face) */}
      <mesh position={[0, -0.97, -0.14]} castShadow={castShadow}>
        <boxGeometry args={[0.148, 0.54, 0.022]} />
        <meshStandardMaterial
          map={matPack.bladeMap}
          roughnessMap={matPack.roughnessMap}
          emissiveMap={matPack.emissiveMap}
          emissive={matPack.emissiveColor}
          emissiveIntensity={matPack.emissiveIntensity}
          metalness={matPack.metalness}
          roughness={matPack.roughness}
        />
      </mesh>

      {/* Thick Peaked Spine & Sweet-Spot Swell Along Back of Blade (+Z) */}
      <mesh
        geometry={spineGeo}
        position={[0, -0.97, -0.129]}
        castShadow={castShadow}>
        <meshStandardMaterial
          map={matPack.bladeMap}
          roughnessMap={matPack.roughnessMap}
          emissiveMap={matPack.emissiveMap}
          emissive={matPack.emissiveColor}
          emissiveIntensity={matPack.emissiveIntensity}
          metalness={matPack.metalness}
          roughness={matPack.roughness}
        />
      </mesh>

      {/* Rounded Rubber Toe Guard */}
      <mesh
        position={[0, -1.248, -0.136]}
        rotation={[0, 0, Math.PI / 2]}
        scale={[1, 1, 0.38]}>
        <cylinderGeometry args={[0.022, 0.022, 0.146, 10]} />
        <meshStandardMaterial color={matPack.toeGuardColor} roughness={0.8} />
      </mesh>
    </group>
  );
}

// ============================================================================
// PROTECTIVE BATTING / KEEPING LEG PADS (3 Cane Ridges + Knee Roll + Team Straps)
// ============================================================================

function ProtectiveLegPad({
  shortKeeperPad,
  primaryColor,
  secondaryColor,
  castShadow,
}: {
  shortKeeperPad: boolean;
  primaryColor: string;
  secondaryColor: string;
  castShadow: boolean;
}) {
  const padH = shortKeeperPad ? 0.34 : 0.44;
  const padY = shortKeeperPad ? -0.2 : -0.17;
  return (
    <group position={[0, padY, -0.055]}>
      {/* Main Contoured White Pad Shell */}
      <mesh castShadow={castShadow}>
        <boxGeometry args={[0.152, padH, 0.055]} />
        <meshStandardMaterial color="#f8fafc" roughness={0.48} />
      </mesh>

      {/* 3 Vertical Cane-Rod Ridges on Front Face (-Z) */}
      {[-0.046, 0, 0.046].map((rx, idx) => (
        <mesh key={idx} position={[rx, -0.02, -0.028]} castShadow={castShadow}>
          <cylinderGeometry args={[0.018, 0.016, padH * 0.82, 8]} />
          <meshStandardMaterial color="#ffffff" roughness={0.42} />
        </mesh>
      ))}

      {/* Segmented Horizontal Knee Roll Bolsters */}
      {[0.11, 0.155].map((ky, idx) => (
        <mesh
          key={idx}
          position={[0, shortKeeperPad ? ky - 0.04 : ky, -0.026]}
          rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.021, 0.021, 0.156, 8]} />
          <meshStandardMaterial
            color={idx === 1 ? secondaryColor : '#f1f5f9'}
            roughness={0.45}
          />
        </mesh>
      ))}

      {/* Top Hat Thigh Wing (Full Batting Pads only) */}
      {!shortKeeperPad && (
        <mesh position={[0, 0.23, -0.018]} rotation={[-0.12, 0, 0]}>
          <boxGeometry args={[0.146, 0.09, 0.045]} />
          <meshStandardMaterial color="#f8fafc" roughness={0.45} />
        </mesh>
      )}

      {/* Team-Colored Calf Straps Wrapping the Shin (+Z) */}
      {[-0.1, 0.04].map((sy, idx) => (
        <mesh key={idx} position={[0, sy, 0.065]}>
          <boxGeometry args={[0.148, 0.032, 0.09]} />
          <meshStandardMaterial
            color={idx === 0 ? primaryColor : secondaryColor}
            roughness={0.55}
          />
        </mesh>
      ))}
    </group>
  );
}

// ============================================================================
// ARTICULATED 3D CRICKETER / HUMANOID COMPONENT
// ============================================================================

export const HumanoidCharacter = forwardRef<
  THREE.Group,
  HumanoidCharacterProps
>(function HumanoidCharacter(
  {
    position = DEFAULT_POSITION,
    rotation = DEFAULT_ROTATION,
    scale = 1,
    state = 'idle',
    toolType = 'none',
    role = 'generic',
    headgear,
    skinColor = '#c68642',
    primaryColor,
    secondaryColor = '#facc15',
    clothesColor = '#0052cc',
    pantsColor,
    jerseyNumber = 18,
    batSkin = 'CLASSIC_WILLOW',
    batSwingRef,
    locomotionRef,
    castShadow = true,
  }: HumanoidCharacterProps,
  ref,
) {
  const kitPrimary = primaryColor ?? clothesColor;
  const kitTrousers = pantsColor ?? kitPrimary;

  const pelvisRef = useRef<THREE.Group>(null);
  const spineRef = useRef<THREE.Group>(null);
  const leftHipRef = useRef<THREE.Group>(null);
  const leftKneeRef = useRef<THREE.Group>(null);
  const rightHipRef = useRef<THREE.Group>(null);
  const rightKneeRef = useRef<THREE.Group>(null);
  const leftShoulderRef = useRef<THREE.Group>(null);
  const leftElbowRef = useRef<THREE.Group>(null);
  const rightShoulderRef = useRef<THREE.Group>(null);
  const rightElbowRef = useRef<THREE.Group>(null);
  const batRigRef = useRef<THREE.Group>(null);

  const isBatterRole = role === 'batter' || role === 'nonStriker';
  const isKeeperRole = role === 'keeper';
  const resolvedHeadgear =
    headgear ??
    (isBatterRole ? 'helmet' : role === 'generic' ? 'none' : 'cap');

  const jerseyMap = useMemo(
    () => getJerseyTexture(kitPrimary, secondaryColor, jerseyNumber),
    [kitPrimary, secondaryColor, jerseyNumber],
  );

  useFrame(({clock}) => {
    const t = clock.getElapsedTime();
    const locoSpeed =
      locomotionRef?.current.speed ??
      (state === 'run' ? 9 : state === 'walk' ? 4 : 0);
    const isRunning = locoSpeed > 0.18;
    const freq = 14;
    const phase = t * freq;
    const stride = Math.min(0.88, locoSpeed * 0.095);

    const pelvis = pelvisRef.current;
    const spine = spineRef.current;
    const lHip = leftHipRef.current;
    const lKnee = leftKneeRef.current;
    const rHip = rightHipRef.current;
    const rKnee = rightKneeRef.current;

    // 1. Lower-Body Articulation (Hips & Knees) + Ground-Planted Crouch Offset
    if (pelvis && lHip && lKnee && rHip && rKnee) {
      if (isRunning) {
        const sL = Math.sin(phase);
        const sR = Math.sin(phase + Math.PI);
        pelvis.position.y = Math.abs(Math.cos(phase)) * 0.035;
        lHip.rotation.x = sL * stride;
        rHip.rotation.x = sR * stride;
        // Realistic knee bend during leg recovery swing (positive X bends shin backward +Z)
        lKnee.rotation.x = Math.max(0.08, -sL * stride * 1.15);
        rKnee.rotation.x = Math.max(0.08, -sR * stride * 1.15);
        lHip.rotation.z = 0;
        rHip.rotation.z = 0;
      } else if (isKeeperRole) {
        // Low wicketkeeper squat behind stumps (feet stay flush on turf)
        pelvis.position.y = -0.22;
        lHip.rotation.x = -0.82;
        rHip.rotation.x = -0.82;
        lHip.rotation.z = -0.16;
        rHip.rotation.z = 0.16;
        lKnee.rotation.x = 1.42;
        rKnee.rotation.x = 1.42;
      } else if (role === 'fielder') {
        // Athletic ready fielding crouch
        const sway = Math.sin(t * 2.4) * 0.02;
        pelvis.position.y = -0.07;
        lHip.rotation.x = -0.34;
        rHip.rotation.x = -0.34;
        lHip.rotation.z = -0.1 + sway;
        rHip.rotation.z = 0.1 + sway;
        lKnee.rotation.x = 0.62;
        rKnee.rotation.x = 0.62;
      } else if (role === 'batter') {
        // Balanced side-on batting knee flex
        pelvis.position.y = -0.04;
        lHip.rotation.x = -0.22;
        rHip.rotation.x = -0.22;
        lHip.rotation.z = -0.06;
        rHip.rotation.z = 0.06;
        lKnee.rotation.x = 0.42;
        rKnee.rotation.x = 0.42;
      } else {
        pelvis.position.y = 0;
        lHip.rotation.x = 0;
        rHip.rotation.x = 0;
        lHip.rotation.z = 0;
        rHip.rotation.z = 0;
        lKnee.rotation.x = 0;
        rKnee.rotation.x = 0;
      }
    }

    // 2. Upper-Body Spine & Articulated Arms / Batting / Bowling Mechanics
    const isSlidingBat = Boolean(locomotionRef?.current.slidingBat);
    if (role === 'batter' && spine && batRigRef.current) {
      const swing = batSwingRef?.current;
      if (swing && swing.active) {
        const p = swing.progress; // 0..1
        const arc = Math.sin(Math.min(1, p * 1.32) * Math.PI);
        if (swing.shotType === 'LOFTED') {
          // Explosive hips-and-shoulders clearing follow-through
          spine.rotation.y = 0.46 - p * 0.85 - swing.aimDir * 0.32 * p;
          spine.rotation.x = -0.12 * (1 - p) - 0.16 * p;
          batRigRef.current.rotation.x = -0.68 + p * 2.68;
          batRigRef.current.rotation.z = -swing.aimDir * 0.48 * arc;
        } else if (swing.shotType === 'GROUNDED') {
          // Crisp head-over-ball cover/straight/on drive
          spine.rotation.y = 0.44 - arc * 0.62 - swing.aimDir * 0.34 * arc;
          spine.rotation.x = 0.22 * arc;
          batRigRef.current.rotation.x = -0.52 + arc * 1.52;
          batRigRef.current.rotation.z = -swing.aimDir * 0.56 * arc;
        } else {
          // Compact forward defensive block
          spine.rotation.y = 0.38 - arc * 0.28;
          spine.rotation.x = 0.28 * arc;
          batRigRef.current.rotation.x = -0.38 + arc * 0.68;
          batRigRef.current.rotation.z = 0;
        }
      } else if (isSlidingBat) {
        // Reaching & sliding willow bat low across the popping crease!
        spine.rotation.y = 0;
        spine.rotation.x = 0.58;
        batRigRef.current.rotation.x = 1.18;
        batRigRef.current.rotation.z = 0;
      } else if (isRunning) {
        // Sprinting hard between the wickets with bat pumped in hand
        spine.rotation.y = 0;
        spine.rotation.x = 0.22;
        batRigRef.current.rotation.x = -0.32 + Math.sin(phase) * 0.32;
        batRigRef.current.rotation.z = 0.08;
      } else {
        // Authentic side-on batting stance with rhythmic backlift tap
        const tap = Math.sin(t * 3.4) * 0.06;
        spine.rotation.y = 0.46; // Left shoulder rotated toward bowler (-Z)
        spine.rotation.x = 0.12;
        batRigRef.current.rotation.x = -0.46 + tap;
        batRigRef.current.rotation.z = 0.1;
      }
    } else if (role === 'nonStriker' && spine && batRigRef.current) {
      if (isSlidingBat) {
        spine.rotation.y = 0;
        spine.rotation.x = 0.58;
        batRigRef.current.rotation.x = 1.18;
        batRigRef.current.rotation.z = 0;
      } else {
        spine.rotation.y = isRunning ? 0 : 0.18;
        spine.rotation.x = isRunning ? 0.22 : 0.04;
        batRigRef.current.rotation.x = isRunning
          ? -0.32 + Math.sin(phase) * 0.32
          : -0.15;
        batRigRef.current.rotation.z = 0.12;
      }
    } else if (
      spine &&
      leftShoulderRef.current &&
      leftElbowRef.current &&
      rightShoulderRef.current &&
      rightElbowRef.current
    ) {
      const lSh = leftShoulderRef.current;
      const lEl = leftElbowRef.current;
      const rSh = rightShoulderRef.current;
      const rEl = rightElbowRef.current;
      const bowlAngle = locomotionRef?.current.bowlArmAngle;

      if (role === 'bowler' && typeof bowlAngle === 'number' && bowlAngle !== 0) {
        // Authentic side-on gather & 360-degree straight-arm over-arm delivery!
        const norm = bowlAngle / (Math.PI * 2); // 0..1
        spine.rotation.y = Math.sin(norm * Math.PI) * 0.52;
        spine.rotation.x = norm > 0.55 ? (norm - 0.55) * 0.85 : -0.12;
        // Bowling arm stays straight at the elbow per cricket laws!
        rSh.rotation.x = -bowlAngle;
        rSh.rotation.z = 0.12;
        rEl.rotation.x = -0.06;
        // Front guide arm reaches skyward then pulls into ribs
        lSh.rotation.x = -2.1 + norm * 2.5;
        lEl.rotation.x = -0.65 - norm * 0.5;
      } else if (locomotionRef?.current.diving) {
        spine.rotation.x = 0.55;
        spine.rotation.y = 0;
        lSh.rotation.x = -2.35;
        rSh.rotation.x = -2.35;
        lEl.rotation.x = -0.2;
        rEl.rotation.x = -0.2;
      } else if (isRunning) {
        spine.rotation.x = 0.16;
        spine.rotation.y = Math.sin(phase) * 0.12;
        lSh.rotation.x = Math.sin(phase + Math.PI) * stride * 0.95;
        rSh.rotation.x = Math.sin(phase) * stride * 0.95;
        lSh.rotation.z = -0.08;
        rSh.rotation.z = 0.08;
        lEl.rotation.x = -1.15; // Athletic 90-deg sprint elbow bend
        rEl.rotation.x = -1.15;
      } else if (isKeeperRole) {
        spine.rotation.x = 0.38;
        spine.rotation.y = 0;
        lSh.rotation.x = -0.68;
        rSh.rotation.x = -0.68;
        lSh.rotation.z = -0.18;
        rSh.rotation.z = 0.18;
        lEl.rotation.x = -0.58;
        rEl.rotation.x = -0.58;
      } else if (role === 'fielder') {
        spine.rotation.x = 0.22;
        spine.rotation.y = 0;
        lSh.rotation.x = -0.42;
        rSh.rotation.x = -0.42;
        lSh.rotation.z = -0.16;
        rSh.rotation.z = 0.16;
        lEl.rotation.x = -0.68;
        rEl.rotation.x = -0.68;
      } else if (state === 'action') {
        spine.rotation.x = 0;
        spine.rotation.y = 0;
        rSh.rotation.x = -Math.abs(Math.sin(t * 12)) * 1.5;
        rEl.rotation.x = -0.35;
        lSh.rotation.x = 0;
        lEl.rotation.x = -0.2;
      } else {
        spine.rotation.x = 0;
        spine.rotation.y = 0;
        lSh.rotation.x = 0;
        rSh.rotation.x = 0;
        lSh.rotation.z = -0.06;
        rSh.rotation.z = 0.06;
        lEl.rotation.x = -0.18;
        rEl.rotation.x = -0.18;
      }
    }
  });

  return (
    <group
      ref={ref}
      position={position}
      rotation={rotation}
      scale={[scale, scale, scale]}>
      <group ref={pelvisRef}>
        {/* Pelvis / Waistband */}
        <mesh position={[0, 0.88, 0]} castShadow={castShadow}>
          <cylinderGeometry args={[0.19, 0.18, 0.14, 10]} />
          <meshStandardMaterial color={kitTrousers} roughness={0.7} />
        </mesh>

        {/* ===============================================================
            UPPER BODY SPINE, JERSEY WITH COLLAR & BACK NUMBER, HEADGEAR
           =============================================================== */}
        <group ref={spineRef} position={[0, 0.92, 0]}>
          {/* Athletic Tapered Jersey Torso with Back Number Texture */}
          <mesh position={[0, 0.3, 0]} castShadow={castShadow}>
            <cylinderGeometry args={[0.235, 0.19, 0.56, 14]} />
            <meshStandardMaterial map={jerseyMap} roughness={0.62} />
          </mesh>

          {/* Rounded Shoulder Deltoid Caps */}
          <mesh position={[0, 0.56, 0]} scale={[1.15, 0.45, 0.88]}>
            <sphereGeometry args={[0.22, 12, 8]} />
            <meshStandardMaterial color={kitPrimary} roughness={0.6} />
          </mesh>

          {/* Sculpted Polo Jersey Collar (Secondary Color) */}
          <mesh
            position={[0, 0.6, 0]}
            rotation={[Math.PI / 2 + 0.12, 0, 0]}>
            <torusGeometry args={[0.105, 0.024, 8, 16]} />
            <meshStandardMaterial color={secondaryColor} roughness={0.5} />
          </mesh>

          {/* Neck */}
          <mesh position={[0, 0.65, 0]}>
            <cylinderGeometry args={[0.072, 0.082, 0.12, 10]} />
            <meshStandardMaterial color={skinColor} roughness={0.72} />
          </mesh>

          {/* Head (Facing -Z) */}
          <group position={[0, 0.81, 0]}>
            <mesh castShadow={castShadow}>
              <sphereGeometry args={[0.185, 14, 14]} />
              <meshStandardMaterial color={skinColor} roughness={0.72} />
            </mesh>
            {/* Subtle Facial Brow & Eyes (-Z) */}
            <mesh position={[-0.06, 0.02, -0.168]}>
              <sphereGeometry args={[0.018, 6, 6]} />
              <meshBasicMaterial color="#1e1b18" />
            </mesh>
            <mesh position={[0.06, 0.02, -0.168]}>
              <sphereGeometry args={[0.018, 6, 6]} />
              <meshBasicMaterial color="#1e1b18" />
            </mesh>

            {/* ROLE-SPECIFIC HEADGEAR */}
            {resolvedHeadgear === 'helmet' && (
              <group position={[0, 0.03, 0]}>
                {/* Glossy Composite Helmet Shell */}
                <mesh castShadow={castShadow}>
                  <sphereGeometry
                    args={[0.212, 14, 12, 0, Math.PI * 2, 0, Math.PI * 0.62]}
                  />
                  <meshStandardMaterial
                    color={kitPrimary}
                    roughness={0.28}
                    metalness={0.25}
                  />
                </mesh>
                {/* Ear Guards */}
                {[-0.19, 0.19].map((ex, idx) => (
                  <mesh key={idx} position={[ex, -0.07, -0.03]}>
                    <boxGeometry args={[0.035, 0.12, 0.13]} />
                    <meshStandardMaterial
                      color={kitPrimary}
                      roughness={0.35}
                    />
                  </mesh>
                ))}
                {/* Secondary-Colored Helmet Visor Peak */}
                <mesh position={[0, 0.01, -0.19]} rotation={[0.18, 0, 0]}>
                  <cylinderGeometry
                    args={[0.21, 0.23, 0.025, 12, 1, false, Math.PI * 0.65, Math.PI * 0.7]}
                  />
                  <meshStandardMaterial
                    color={secondaryColor}
                    roughness={0.4}
                  />
                </mesh>
                {/* Metallic Multi-Bar Steel Face Grille (-Z) */}
                <group position={[0, -0.095, -0.185]}>
                  {[-0.032, 0, 0.032].map((gy, idx) => (
                    <mesh
                      key={idx}
                      position={[0, gy, 0]}
                      rotation={[0, 0, Math.PI / 2]}>
                      <cylinderGeometry args={[0.006, 0.006, 0.22, 6]} />
                      <meshStandardMaterial
                        color="#e2e8f0"
                        metalness={0.88}
                        roughness={0.2}
                      />
                    </mesh>
                  ))}
                  {[-0.1, 0.1].map((gx, idx) => (
                    <mesh key={idx} position={[gx, 0, 0.03]}>
                      <cylinderGeometry args={[0.006, 0.006, 0.1, 6]} />
                      <meshStandardMaterial
                        color="#cbd5e1"
                        metalness={0.88}
                        roughness={0.2}
                      />
                    </mesh>
                  ))}
                </group>
              </group>
            )}

            {resolvedHeadgear === 'cap' && (
              <group position={[0, 0.05, 0]}>
                <mesh castShadow={castShadow}>
                  <sphereGeometry
                    args={[0.192, 12, 10, 0, Math.PI * 2, 0, Math.PI * 0.52]}
                  />
                  <meshStandardMaterial color={kitPrimary} roughness={0.62} />
                </mesh>
                {/* Curved Cap Peak (-Z) */}
                <mesh position={[0, -0.01, -0.18]} rotation={[0.14, 0, 0]}>
                  <boxGeometry args={[0.21, 0.022, 0.15]} />
                  <meshStandardMaterial
                    color={secondaryColor}
                    roughness={0.55}
                  />
                </mesh>
              </group>
            )}

            {resolvedHeadgear === 'sunhat' && (
              <group position={[0, 0.06, 0]}>
                {/* Crown */}
                <mesh position={[0, 0.04, 0]} castShadow={castShadow}>
                  <cylinderGeometry args={[0.16, 0.185, 0.12, 14]} />
                  <meshStandardMaterial color="#f8fafc" roughness={0.7} />
                </mesh>
                {/* Team Hatband */}
                <mesh position={[0, -0.005, 0]}>
                  <cylinderGeometry args={[0.186, 0.188, 0.032, 14]} />
                  <meshStandardMaterial color={kitPrimary} roughness={0.55} />
                </mesh>
                {/* Wide Sun Brim */}
                <mesh position={[0, -0.02, 0]} castShadow={castShadow}>
                  <cylinderGeometry args={[0.31, 0.32, 0.016, 18]} />
                  <meshStandardMaterial color="#f1f5f9" roughness={0.75} />
                </mesh>
              </group>
            )}
          </group>

          {/* =============================================================
              ARMS, BATTING GLOVES + BAT RIG OR KEEPING GLOVES / FIELDING ARMS
             ============================================================= */}
          {isBatterRole ? (
            <group ref={batRigRef} position={[0.14, 0.44, -0.15]}>
              {/* Left & Right Articulated Sleeves + Forearms Converging on Handle */}
              <group position={[-0.24, 0.04, 0.06]} rotation={[0.38, 0, -0.34]}>
                <mesh position={[0, -0.11, 0]} castShadow={castShadow}>
                  <cylinderGeometry args={[0.068, 0.06, 0.22, 8]} />
                  <meshStandardMaterial color={kitPrimary} roughness={0.62} />
                </mesh>
                {/* Secondary Sleeve Trim */}
                <mesh position={[0, -0.21, 0]}>
                  <cylinderGeometry args={[0.063, 0.062, 0.03, 8]} />
                  <meshStandardMaterial color={secondaryColor} />
                </mesh>
                <mesh position={[0, -0.34, -0.03]} rotation={[0.22, 0, 0]}>
                  <cylinderGeometry args={[0.052, 0.045, 0.24, 8]} />
                  <meshStandardMaterial color={skinColor} roughness={0.72} />
                </mesh>
              </group>

              <group position={[0.12, 0.04, 0.06]} rotation={[0.38, 0, 0.2]}>
                <mesh position={[0, -0.11, 0]} castShadow={castShadow}>
                  <cylinderGeometry args={[0.068, 0.06, 0.22, 8]} />
                  <meshStandardMaterial color={kitPrimary} roughness={0.62} />
                </mesh>
                <mesh position={[0, -0.21, 0]}>
                  <cylinderGeometry args={[0.063, 0.062, 0.03, 8]} />
                  <meshStandardMaterial color={secondaryColor} />
                </mesh>
                <mesh position={[0, -0.34, -0.03]} rotation={[0.22, 0, 0]}>
                  <cylinderGeometry args={[0.052, 0.045, 0.24, 8]} />
                  <meshStandardMaterial color={skinColor} roughness={0.72} />
                </mesh>
              </group>

              {/* Padded Batting Gloves (Top & Bottom Hands on Handle) */}
              {[-0.41, -0.51].map((gy, idx) => (
                <group key={idx} position={[0, gy, -0.14]}>
                  <mesh>
                    <boxGeometry args={[0.095, 0.09, 0.095]} />
                    <meshStandardMaterial color="#f8fafc" roughness={0.45} />
                  </mesh>
                  {/* Team Wrist Sweatband */}
                  <mesh position={[0, 0.048, 0.01]}>
                    <cylinderGeometry args={[0.052, 0.052, 0.03, 8]} />
                    <meshStandardMaterial color={secondaryColor} />
                  </mesh>
                </group>
              ))}

              {/* Custom Sculpted 3D Cricket Bat with Selected Unlockable Skin */}
              <CricketBat3D
                skin={batSkin}
                primaryColor={kitPrimary}
                secondaryColor={secondaryColor}
                castShadow={castShadow}
              />
            </group>
          ) : (
            <>
              {/* LEFT SHOULDER + ELBOW */}
              <group ref={leftShoulderRef} position={[-0.29, 0.52, 0]}>
                <mesh position={[0, -0.12, 0]} castShadow={castShadow}>
                  <cylinderGeometry args={[0.068, 0.06, 0.24, 8]} />
                  <meshStandardMaterial color={kitPrimary} roughness={0.62} />
                </mesh>
                <mesh position={[0, -0.23, 0]}>
                  <cylinderGeometry args={[0.063, 0.062, 0.032, 8]} />
                  <meshStandardMaterial color={secondaryColor} />
                </mesh>
                <group ref={leftElbowRef} position={[0, -0.25, 0]}>
                  <mesh position={[0, -0.13, 0]} castShadow={castShadow}>
                    <cylinderGeometry args={[0.054, 0.044, 0.26, 8]} />
                    <meshStandardMaterial color={skinColor} roughness={0.72} />
                  </mesh>
                  {isKeeperRole ? (
                    /* Wicketkeeper Webbed Keeping Glove */
                    <group position={[0, -0.3, -0.02]}>
                      <mesh castShadow={castShadow}>
                        <boxGeometry args={[0.13, 0.15, 0.07]} />
                        <meshStandardMaterial color="#f8fafc" roughness={0.45} />
                      </mesh>
                      <mesh position={[0, -0.01, -0.038]}>
                        <planeGeometry args={[0.11, 0.12]} />
                        <meshStandardMaterial color={secondaryColor} />
                      </mesh>
                      <mesh position={[0, 0.08, 0]}>
                        <boxGeometry args={[0.14, 0.05, 0.08]} />
                        <meshStandardMaterial color={kitPrimary} />
                      </mesh>
                    </group>
                  ) : (
                    <mesh position={[0, -0.27, 0]}>
                      <sphereGeometry args={[0.048, 8, 8]} />
                      <meshStandardMaterial color={skinColor} />
                    </mesh>
                  )}
                </group>
              </group>

              {/* RIGHT SHOULDER + ELBOW */}
              <group ref={rightShoulderRef} position={[0.29, 0.52, 0]}>
                <mesh position={[0, -0.12, 0]} castShadow={castShadow}>
                  <cylinderGeometry args={[0.068, 0.06, 0.24, 8]} />
                  <meshStandardMaterial color={kitPrimary} roughness={0.62} />
                </mesh>
                <mesh position={[0, -0.23, 0]}>
                  <cylinderGeometry args={[0.063, 0.062, 0.032, 8]} />
                  <meshStandardMaterial color={secondaryColor} />
                </mesh>
                <group ref={rightElbowRef} position={[0, -0.25, 0]}>
                  <mesh position={[0, -0.13, 0]} castShadow={castShadow}>
                    <cylinderGeometry args={[0.054, 0.044, 0.26, 8]} />
                    <meshStandardMaterial color={skinColor} roughness={0.72} />
                  </mesh>
                  {isKeeperRole ? (
                    <group position={[0, -0.3, -0.02]}>
                      <mesh castShadow={castShadow}>
                        <boxGeometry args={[0.13, 0.15, 0.07]} />
                        <meshStandardMaterial color="#f8fafc" roughness={0.45} />
                      </mesh>
                      <mesh position={[0, -0.01, -0.038]}>
                        <planeGeometry args={[0.11, 0.12]} />
                        <meshStandardMaterial color={secondaryColor} />
                      </mesh>
                      <mesh position={[0, 0.08, 0]}>
                        <boxGeometry args={[0.14, 0.05, 0.08]} />
                        <meshStandardMaterial color={kitPrimary} />
                      </mesh>
                    </group>
                  ) : (
                    <mesh position={[0, -0.27, 0]}>
                      <sphereGeometry args={[0.048, 8, 8]} />
                      <meshStandardMaterial color={skinColor} />
                    </mesh>
                  )}

                  {/* Legacy toolType compatibility fallback */}
                  {toolType === 'sword' && (
                    <mesh
                      position={[0, -0.35, -0.3]}
                      rotation={[Math.PI / 2, 0, 0]}>
                      <boxGeometry args={[0.04, 0.8, 0.1]} />
                      <meshStandardMaterial
                        color="#cbd5e1"
                        metalness={0.8}
                        roughness={0.2}
                      />
                    </mesh>
                  )}
                  {toolType === 'pickaxe' && (
                    <group
                      position={[0, -0.35, -0.3]}
                      rotation={[Math.PI / 2, 0, 0]}>
                      <mesh>
                        <cylinderGeometry args={[0.02, 0.02, 0.8]} />
                        <meshStandardMaterial color="#8B5A2B" />
                      </mesh>
                      <mesh
                        position={[0, 0.3, 0]}
                        rotation={[0, 0, Math.PI / 2]}>
                        <boxGeometry args={[0.05, 0.5, 0.05]} />
                        <meshStandardMaterial color="#777777" />
                      </mesh>
                    </group>
                  )}
                </group>
              </group>
            </>
          )}
        </group>

        {/* ===============================================================
            ARTICULATED LEGS (HIP -> KNEE -> SPIKED CRICKET SHOES AT Y = 0)
           =============================================================== */}
        {(
          [
            {hipRef: leftHipRef, kneeRef: leftKneeRef, x: -0.12},
            {hipRef: rightHipRef, kneeRef: rightKneeRef, x: 0.12},
          ] as const
        ).map((leg, idx) => (
          <group key={idx} ref={leg.hipRef} position={[leg.x, 0.86, 0]}>
            {/* Thigh */}
            <mesh position={[0, -0.2, 0]} castShadow={castShadow}>
              <cylinderGeometry args={[0.084, 0.072, 0.4, 8]} />
              <meshStandardMaterial color={kitTrousers} roughness={0.72} />
            </mesh>

            {/* Knee Joint & Shin */}
            <group ref={leg.kneeRef} position={[0, -0.4, 0]}>
              <mesh position={[0, -0.19, 0]} castShadow={castShadow}>
                <cylinderGeometry args={[0.07, 0.056, 0.38, 8]} />
                <meshStandardMaterial color={kitTrousers} roughness={0.72} />
              </mesh>

              {/* Contoured Leg Pads for Batter, Non-Striker & Wicketkeeper */}
              {(isBatterRole || isKeeperRole) && (
                <ProtectiveLegPad
                  shortKeeperPad={isKeeperRole}
                  primaryColor={kitPrimary}
                  secondaryColor={secondaryColor}
                  castShadow={castShadow}
                />
              )}

              {/* Spiked Cricket Shoe (Bottom of cleats rests strictly at Y = 0) */}
              <group position={[0, -0.4, 0]}>
                {/* White Athletic Shoe Upper */}
                <mesh position={[0, 0.01, -0.045]} castShadow={castShadow}>
                  <boxGeometry args={[0.125, 0.08, 0.24]} />
                  <meshStandardMaterial color="#f8fafc" roughness={0.45} />
                </mesh>
                {/* Team Heel & Side Stripe */}
                <mesh position={[0, 0.015, 0.03]}>
                  <boxGeometry args={[0.13, 0.05, 0.08]} />
                  <meshStandardMaterial color={secondaryColor} roughness={0.5} />
                </mesh>
                {/* Outsole */}
                <mesh position={[0, -0.035, -0.045]}>
                  <boxGeometry args={[0.13, 0.025, 0.25]} />
                  <meshStandardMaterial color="#334155" roughness={0.8} />
                </mesh>
                {/* Metallic Cricket Spikes / Cleats */}
                {[-0.12, -0.04, 0.04].map((sz, sIdx) => (
                  <mesh key={sIdx} position={[0, -0.052, sz]}>
                    <boxGeometry args={[0.09, 0.016, 0.016]} />
                    <meshStandardMaterial
                      color="#cbd5e1"
                      metalness={0.85}
                      roughness={0.25}
                    />
                  </mesh>
                ))}
              </group>
            </group>
          </group>
        ))}
      </group>
    </group>
  );
});
