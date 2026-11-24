import {
  BatSkinId,
  BatSkinInfo,
  DeliveryType,
  MatchConfig,
  TeamId,
  TeamInfo,
} from './types';
import {MusicTrack} from './utils/helper';

/** Bespoke Floodlight Stadium Arcade Theme */
export const THEME = {
  palette: {
    stadiumSky: '#0f172a',
    twilightHorizon: '#1e293b',
    turfLight: '#388e3c',
    turfDark: '#2e7d32',
    clayPitch: '#d7b889',
    creaseWhite: '#f8fafc',
    ropeRed: '#ef4444',
    goldAccent: '#facc15',
    emeraldWin: '#10b981',
    crimsonDanger: '#f43f5e',
    hudSurface: '#090d16',
  },
  fontFamily: "'Rajdhani', 'Segoe UI', system-ui, sans-serif",
  ui: {
    cardRadius: '16px',
    buttonRadius: '12px',
    borderStroke: '2px',
  },
} as const;

/** Game configuration schema. */
export const CONFIG = {
  // --- GAME ---
  title: {
    value: 'Boundary Blitz 3D',
    type: 'string',
    label: 'Game Title',
    group: 'GAME',
  },
  baseCanvasWidth: {
    value: 1280,
    type: 'number',
    label: 'Base Canvas Width',
    group: 'GAME',
  },
  baseCanvasHeight: {
    value: 720,
    type: 'number',
    label: 'Base Canvas Height',
    group: 'GAME',
  },

  // --- CAMERA ---
  fov: {
    value: 52,
    type: 'number',
    label: 'Field of View',
    group: 'Camera',
    min: 35,
    max: 90,
    step: 1,
  },
  cameraX: {
    value: 0.35,
    type: 'number',
    label: 'Camera X',
    group: 'Camera',
  },
  cameraY: {
    value: 3.45,
    type: 'number',
    label: 'Camera Y',
    group: 'Camera',
  },
  cameraZ: {
    value: 15.8,
    type: 'number',
    label: 'Camera Z',
    group: 'Camera',
  },
  cameraFollowBall: {
    value: true,
    type: 'boolean',
    label: 'Shot Follow Camera',
    group: 'Camera',
  },

  // --- THEME & VISUALS ---
  backgroundColor: {
    value: '#131e33',
    type: 'color',
    label: 'Background Color',
    group: 'THEME',
  },
  primaryColor: {
    value: '#facc15',
    type: 'color',
    label: 'Primary Color',
    group: 'THEME',
  },
  fontFamily: {
    value: "'Rajdhani', 'Segoe UI', system-ui, sans-serif",
    type: 'string',
    label: 'Font Family',
    group: 'THEME',
  },
  ambientColor: {
    value: '#64748b',
    type: 'color',
    label: 'Ambient Light Color',
    group: 'Visuals',
  },
  ambientIntensity: {
    value: 1.6,
    type: 'number',
    label: 'Ambient Intensity',
    group: 'Visuals',
    min: 0.5,
    max: 4,
    step: 0.1,
  },
  sunColor: {
    value: '#fff5e0',
    type: 'color',
    label: 'Floodlight Key Color',
    group: 'Visuals',
  },
  sunIntensity: {
    value: 4.0,
    type: 'number',
    label: 'Floodlight Intensity',
    group: 'Visuals',
    min: 1,
    max: 8,
    step: 0.2,
  },
  hemiSkyColor: {
    value: '#7dd3fc',
    type: 'color',
    label: 'Hemisphere Sky Color',
    group: 'Visuals',
  },
  hemiGroundColor: {
    value: '#4b6b3c',
    type: 'color',
    label: 'Hemisphere Ground Color',
    group: 'Visuals',
  },
  hemiIntensity: {
    value: 1.25,
    type: 'number',
    label: 'Hemisphere Intensity',
    group: 'Visuals',
    min: 0.2,
    max: 3,
    step: 0.1,
  },
  enableFireworks: {
    value: true,
    type: 'boolean',
    label: 'Enable Victory Fireworks',
    group: 'Visuals',
  },

  // --- RULES & GAMEPLAY ---
  wicketsPerMatch: {
    value: 3,
    type: 'number',
    label: 'Wickets Per Match',
    group: 'Rules',
    min: 1,
    max: 10,
    step: 1,
  },
  bowlerPaceBase: {
    value: 23,
    type: 'number',
    label: 'Base Bowler Pace',
    group: 'Physics',
    min: 15,
    max: 34,
    step: 1,
  },
  loftedPowerMultiplier: {
    value: 1.0,
    type: 'number',
    label: 'Lofted Shot Power',
    group: 'Physics',
    min: 0.7,
    max: 1.5,
    step: 0.05,
  },
  groundedPowerMultiplier: {
    value: 1.0,
    type: 'number',
    label: 'Grounded Drive Speed',
    group: 'Physics',
    min: 0.7,
    max: 1.5,
    step: 0.05,
  },
  fielderSpeedBase: {
    value: 7.5,
    type: 'number',
    label: 'Fielder Sprint Speed',
    group: 'Physics',
    min: 4.0,
    max: 13.0,
    step: 0.5,
  },
  sweetSpotRadius: {
    value: 1.15,
    type: 'number',
    label: 'Perfect Timing Window',
    group: 'Rules',
    min: 0.6,
    max: 2.0,
    step: 0.05,
  },
  boundaryRadius: {
    value: 52,
    type: 'number',
    label: 'Boundary Rope Radius',
    group: 'World',
    min: 42,
    max: 62,
    step: 2,
  },
  pitchHalfLength: {
    value: 10,
    type: 'number',
    label: 'Pitch Half Length',
    group: 'World',
    min: 8,
    max: 12,
    step: 1,
  },

  // --- PHYSICS & SYSTEM ---
  gravity: {
    value: -9.81,
    type: 'number',
    label: 'Gravity',
    group: 'Physics',
    min: -25,
    max: -4,
    step: 0.5,
  },
  targetFPS: {
    value: 60,
    type: 'number',
    label: 'Target FPS',
    group: 'SYSTEM',
  },
  stepMs: {
    value: 1000 / 60,
    type: 'number',
    label: 'Step MS',
    group: 'SYSTEM',
  },
  maxSubSteps: {
    value: 5,
    type: 'number',
    label: 'Max Sub Steps',
    group: 'SYSTEM',
  },

  // --- AUDIO ---
  defaultMusicVolume: {
    value: 0.16,
    type: 'number',
    label: 'Default Music Volume',
    group: 'AUDIO',
    min: 0,
    max: 1,
    step: 0.05,
  },
  defaultSfxVolume: {
    value: 0.65,
    type: 'number',
    label: 'Default SFX Volume',
    group: 'AUDIO',
    min: 0,
    max: 1,
    step: 0.05,
  },
  backgroundMusicUrl: {
    value:
      'https://storage.googleapis.com/assets-gen-playground/musiclibrary/stadium_rush.mp3',
    type: 'string',
    label: 'Background Music URL',
    group: 'AUDIO',
  },
};

// Merge customized config values if present (injected by Playground)
const {playgroundConfig} = globalThis as {
  playgroundConfig?: Record<string, unknown>;
};
if (playgroundConfig) {
  for (const [key, value] of Object.entries(playgroundConfig)) {
    if (key in CONFIG) {
      Object.assign(CONFIG[key as keyof typeof CONFIG], {value});
    }
  }
}

/** Type helper for reading values in game code. */
export type ConfigKey = keyof typeof CONFIG;

/**
 * Gets a configuration value by key.
 */
export function getConfig<K extends ConfigKey>(
  key: K,
): (typeof CONFIG)[K]['value'] {
  return CONFIG[key].value;
}

export const PRESETS = {};

export const TOTAL_CAMPAIGN_LEVELS = 50;
export const STORAGE_KEY_TOURNEY = 'cricket_3d_tourney';
export const STORAGE_KEY_CAMPAIGN = 'cricket_3d_campaign';
export const STORAGE_KEY_BAT_SKIN = 'cricket_3d_batskin';

/** Natural South Asian Athlete Skin Tones */
export const SOUTH_ASIAN_SKIN_TONES: readonly string[] = [
  '#d2996c',
  '#c68642',
  '#b87a4b',
  '#9f6438',
  '#8d5524',
  '#dca87e',
  '#ab6f43',
];

/** 8 Custom-Colored Indian City Franchises */
export const TEAMS: Record<TeamId, TeamInfo> = {
  MUMBAI: {
    id: 'MUMBAI',
    name: 'MUMBAI',
    shortName: 'MUM',
    primaryColor: '#0052cc',
    secondaryColor: '#f5b700',
    accentText: '#fde047',
  },
  CHENNAI: {
    id: 'CHENNAI',
    name: 'CHENNAI',
    shortName: 'CHE',
    primaryColor: '#eab308',
    secondaryColor: '#1d4ed8',
    accentText: '#fef08a',
  },
  BENGALURU: {
    id: 'BENGALURU',
    name: 'BENGALURU',
    shortName: 'BLR',
    primaryColor: '#dc2626',
    secondaryColor: '#18181b',
    accentText: '#fca5a5',
  },
  KOLKATA: {
    id: 'KOLKATA',
    name: 'KOLKATA',
    shortName: 'KOL',
    primaryColor: '#581c87',
    secondaryColor: '#facc15',
    accentText: '#fde047',
  },
  DELHI: {
    id: 'DELHI',
    name: 'DELHI',
    shortName: 'DEL',
    primaryColor: '#1e3a8a',
    secondaryColor: '#ef4444',
    accentText: '#93c5fd',
  },
  HYDERABAD: {
    id: 'HYDERABAD',
    name: 'HYDERABAD',
    shortName: 'HYD',
    primaryColor: '#f97316',
    secondaryColor: '#171717',
    accentText: '#fdba74',
  },
  RAJASTHAN: {
    id: 'RAJASTHAN',
    name: 'RAJASTHAN',
    shortName: 'RAJ',
    primaryColor: '#db2777',
    secondaryColor: '#1e40af',
    accentText: '#f9a8d4',
  },
  PUNJAB: {
    id: 'PUNJAB',
    name: 'PUNJAB',
    shortName: 'PUN',
    primaryColor: '#e11d48',
    secondaryColor: '#cbd5e1',
    accentText: '#fda4af',
  },
};

export const TEAM_LIST: TeamInfo[] = Object.values(TEAMS);

/** 5 Selectable & Unlockable 3D Cricket Bat Skins */
export const BAT_SKINS: Record<BatSkinId, BatSkinInfo> = {
  CLASSIC_WILLOW: {
    id: 'CLASSIC_WILLOW',
    name: 'Classic English Willow',
    shortLabel: 'Classic Willow',
    swatchPrimary: '#e6c998',
    swatchSecondary: '#b91c1c',
    unlockRequirement: 'NONE',
    unlockHint: 'Unlocked',
  },
  FRANCHISE_PRO: {
    id: 'FRANCHISE_PRO',
    name: 'Franchise Pro Edition',
    shortLabel: 'Franchise Pro',
    swatchPrimary: '#2563eb',
    swatchSecondary: '#facc15',
    unlockRequirement: 'NONE',
    unlockHint: 'Unlocked',
  },
  CARBON_VIPER: {
    id: 'CARBON_VIPER',
    name: 'Carbon Viper',
    shortLabel: 'Carbon Viper',
    swatchPrimary: '#18181b',
    swatchSecondary: '#22c55e',
    unlockRequirement: 'NONE',
    unlockHint: 'Unlocked',
  },
  ROYAL_GOLD: {
    id: 'ROYAL_GOLD',
    name: 'Royal Gold Championship',
    shortLabel: 'Royal Gold',
    swatchPrimary: '#f59e0b',
    swatchSecondary: '#fef08a',
    unlockRequirement: 'TROPHY',
    unlockHint: 'Win 1 Trophy',
  },
  INFERNO_BLAZE: {
    id: 'INFERNO_BLAZE',
    name: 'Inferno Blaze',
    shortLabel: 'Inferno Blaze',
    swatchPrimary: '#292524',
    swatchSecondary: '#f97316',
    unlockRequirement: 'CAMPAIGN_25',
    unlockHint: 'Stage 25+',
  },
};

export const BAT_SKIN_LIST: BatSkinInfo[] = Object.values(BAT_SKINS);

export function isBatSkinUnlocked(
  skinId: BatSkinId,
  trophiesWon: number,
  unlockedCampaignLevel: number,
): boolean {
  const meta = BAT_SKINS[skinId];
  if (!meta) return true;
  if (meta.unlockRequirement === 'TROPHY') return trophiesWon >= 1;
  if (meta.unlockRequirement === 'CAMPAIGN_25') {
    return unlockedCampaignLevel >= 25;
  }
  return true;
}

/** Wagon-Wheel Shot Chart Sector Definitions (-1 Leg, 0 Straight, 1 Off) */
export const SHOT_CHART_SECTORS: Record<
  -1 | 0 | 1,
  {
    shortLabel: string;
    fullLabel: string;
    zones: string;
    yawRad: number;
    color: string;
  }
> = {
  [-1]: {
    shortLabel: '< LEG',
    fullLabel: 'LEG SIDE',
    zones: 'Mid-Wicket · Square Leg · Fine Leg',
    yawRad: -0.72,
    color: '#fb923c',
  },
  [0]: {
    shortLabel: '^ STRAIGHT',
    fullLabel: 'STRAIGHT',
    zones: 'Straight Drive · Long-On · Long-Off',
    yawRad: -0.06,
    color: '#facc15',
  },
  [1]: {
    shortLabel: 'OFF >',
    fullLabel: 'OFF SIDE',
    zones: 'Extra Cover · Point · Third Man',
    yawRad: 0.72,
    color: '#38bdf8',
  },
};

export const RUNNING_CREASE_SPEED = 15.8; // m/s arcade sprint speed (~1.24s per 19.6m pitch length)
export const FIELDER_THROW_SPEED_BASE = 27.5; // m/s crisp flat throw from outfield to stumps

export const DELIVERY_META: Record<
  DeliveryType,
  {label: string; ringColor: string}
> = {
  FAST_STRAIGHT: {label: 'FAST SEAM', ringColor: '#22d3ee'},
  INSWING: {label: 'INSWING', ringColor: '#f59e0b'},
  OUTSWING: {label: 'OUTSWING', ringColor: '#fb923c'},
  LEG_SPIN: {label: 'LEG SPIN', ringColor: '#a855f7'},
  OFF_SPIN: {label: 'OFF SPIN', ringColor: '#d946ef'},
  YORKER: {label: 'YORKER', ringColor: '#f43f5e'},
};

/** Build Tournament Round MatchConfig */
export function buildTournamentMatchConfig(
  roundIndex: 0 | 1 | 2,
  playerTeam: TeamId,
  opponentTeam: TeamId,
  batSkin: BatSkinId = 'CLASSIC_WILLOW',
): MatchConfig {
  const wickets = Math.max(1, Math.round(getConfig('wicketsPerMatch')));
  if (roundIndex === 0) {
    // Quarterfinal: 2-Over chase, medium pace
    return {
      mode: 'TOURNAMENT',
      levelNumber: 1,
      roundLabel: 'QUARTERFINAL',
      playerTeam,
      opponentTeam,
      batSkin,
      overs: 2,
      totalBalls: 12,
      wicketsAllowed: wickets,
      targetRuns: 22,
      paceMultiplier: 0.96,
      swingProb: 0.25,
      spinProb: 0.15,
      yorkerProb: 0.08,
      fielderAgility: 0.92,
    };
  }
  if (roundIndex === 1) {
    // Semifinal: 3-Over chase, fast pace + swing variations
    return {
      mode: 'TOURNAMENT',
      levelNumber: 2,
      roundLabel: 'SEMIFINAL',
      playerTeam,
      opponentTeam,
      batSkin,
      overs: 3,
      totalBalls: 18,
      wicketsAllowed: wickets,
      targetRuns: 38,
      paceMultiplier: 1.1,
      swingProb: 0.42,
      spinProb: 0.22,
      yorkerProb: 0.14,
      fielderAgility: 1.06,
    };
  }
  // Grand Final: 5-Over chase, pro pace + heavy spin and yorkers
  return {
    mode: 'TOURNAMENT',
    levelNumber: 3,
    roundLabel: 'GRAND FINAL',
    playerTeam,
    opponentTeam,
    batSkin,
    overs: 5,
    totalBalls: 30,
    wicketsAllowed: Math.max(wickets, 4),
    targetRuns: 68,
    paceMultiplier: 1.24,
    swingProb: 0.28,
    spinProb: 0.36,
    yorkerProb: 0.24,
    fielderAgility: 1.2,
  };
}

/** Smoothly scaled 50-Level Progressive Campaign generator */
export function buildCampaignMatchConfig(
  rawLevel: number,
  playerTeam: TeamId,
  batSkin: BatSkinId = 'CLASSIC_WILLOW',
): MatchConfig {
  const level = Math.max(
    1,
    Math.min(TOTAL_CAMPAIGN_LEVELS, Math.floor(rawLevel)),
  );
  const progress = (level - 1) / (TOTAL_CAMPAIGN_LEVELS - 1); // 0..1
  const otherTeams = TEAM_LIST.map((t) => t.id).filter(
    (id) => id !== playerTeam,
  );
  const opponentTeam = otherTeams[(level - 1) % otherTeams.length];

  const overs = level <= 10 ? 1 : level <= 25 ? 2 : level <= 40 ? 3 : 4;
  const totalBalls = overs * 6;
  const rpo = 7.5 + progress * 7.5; // Scales smoothly from ~7.5 RPO at Lv1 to ~15.0 RPO at Lv50
  const targetRuns = Math.max(8, Math.round(overs * rpo));
  const wicketsAllowed = Math.max(
    1,
    Math.round(getConfig('wicketsPerMatch')) + (overs >= 3 ? 1 : 0),
  );

  return {
    mode: 'CAMPAIGN',
    levelNumber: level,
    roundLabel: `STAGE ${level}`,
    playerTeam,
    opponentTeam,
    batSkin,
    overs,
    totalBalls,
    wicketsAllowed,
    targetRuns,
    paceMultiplier: 0.88 + progress * 0.42,
    swingProb: 0.15 + progress * 0.25,
    spinProb: 0.12 + progress * 0.28,
    yorkerProb: 0.05 + progress * 0.25,
    fielderAgility: 0.85 + progress * 0.45,
  };
}

/** Background music tracks available for the game to use. */
export const AVAILABLE_MUSIC_TRACKS: readonly MusicTrack[] = [
  {
    name: 'stadium_rush',
    url: 'https://storage.googleapis.com/assets-gen-playground/musiclibrary/stadium_rush.mp3',
    description:
      'High-energy stadium anthem with stomp-claps, guitar and brass, 140 BPM.',
  },
  {
    name: 'pixel_quest',
    url: 'https://storage.googleapis.com/assets-gen-playground/musiclibrary/pixel_quest.mp3',
    description: 'Cheerful 8-bit chiptune with pulse-wave leads.',
  },
];
