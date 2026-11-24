// tslint:disable
/* eslint-disable */

/** 3D Vector. */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** 3D Position as a tuple. */
export type Position3D = [number, number, number];

/** Represents an object in the 3D scene. */
export interface Entity3D {
  id: string | number;
  type?: string;
  position: Vec3 | Position3D;
  rotation?: Vec3 | Position3D;
  scale?: Vec3 | Position3D;
  velocity?: Vec3;
  active?: boolean;
  [key: string]: any;
}

/** Represents a particle in a particle system. */
export interface Particle {
  id: string | number;
  position: Vec3 | Position3D;
  velocity?: Vec3 | Position3D;
  life: number;
  maxLife: number;
  color?: string;
  size?: number;
  [key: string]: any;
}

export type TeamId =
  | 'MUMBAI'
  | 'CHENNAI'
  | 'BENGALURU'
  | 'KOLKATA'
  | 'DELHI'
  | 'HYDERABAD'
  | 'RAJASTHAN'
  | 'PUNJAB';

export interface TeamInfo {
  id: TeamId;
  name: string;
  shortName: string;
  primaryColor: string;
  secondaryColor: string;
  accentText: string;
}

export type BatSkinId =
  | 'CLASSIC_WILLOW'
  | 'FRANCHISE_PRO'
  | 'CARBON_VIPER'
  | 'ROYAL_GOLD'
  | 'INFERNO_BLAZE';

export interface BatSkinInfo {
  id: BatSkinId;
  name: string;
  shortLabel: string;
  swatchPrimary: string;
  swatchSecondary: string;
  unlockRequirement: 'NONE' | 'TROPHY' | 'CAMPAIGN_25';
  unlockHint: string;
}

export type DeliveryType =
  | 'FAST_STRAIGHT'
  | 'INSWING'
  | 'OUTSWING'
  | 'LEG_SPIN'
  | 'OFF_SPIN'
  | 'YORKER';

export type ShotType = 'LOFTED' | 'GROUNDED' | 'DEFEND';

/** -1 = Leg Side (On-Side / Left), 0 = Straight, 1 = Off Side (Right) */
export type AimDirection = -1 | 0 | 1;

export type TimingGrade = 'PERFECT' | 'GOOD' | 'EARLY' | 'LATE' | 'MISS';

export type ActionControlMode = 'BATTING' | 'RUNNING' | 'LOCKED';

export type GameMode = 'TOURNAMENT' | 'CAMPAIGN';

export interface BracketFixture {
  id: string;
  teamA: TeamId;
  teamB: TeamId;
  scoreA?: string;
  scoreB?: string;
  winner?: TeamId;
}

export interface TournamentSaveData {
  playerTeam: TeamId;
  trophiesWon: number;
  currentRound: 0 | 1 | 2; // 0 = Quarterfinal, 1 = Semifinal, 2 = Grand Final
  quarterfinals: BracketFixture[];
  semifinals: BracketFixture[];
  finalMatch: BracketFixture | null;
  champion: TeamId | null;
}

export interface CampaignSaveData {
  playerTeam: TeamId;
  unlockedLevel: number; // 1..50
  starsByLevel: Record<number, number>; // 1..3 stars
}

export interface MatchConfig {
  mode: GameMode;
  levelNumber: number; // 1..50 in campaign, 1..3 in tournament
  roundLabel: string;
  playerTeam: TeamId;
  opponentTeam: TeamId;
  batSkin?: BatSkinId;
  overs: number;
  totalBalls: number;
  wicketsAllowed: number;
  targetRuns: number;
  paceMultiplier: number;
  swingProb: number;
  spinProb: number;
  yorkerProb: number;
  fielderAgility: number;
}

/** Shared high-frequency ref payload read by the bottom-center Timing Meter HUD */
export interface TimingMeterSnapshot {
  visible: boolean;
  /** 0..1 normalized progress from bowler release (-9.8) past crease (+12.0) */
  progress: number;
  /** Locked progress position when the player swings */
  lockedProgress: number | null;
  /** Resulting timing grade once swung */
  grade: TimingGrade | null;
}

export interface LiveScoreHud {
  runs: number;
  wickets: number;
  wicketsAllowed: number;
  ballsBowled: number;
  totalBalls: number;
  targetRuns: number;
  currentDelivery: DeliveryType;
  deliveryLabel: string;
  deliveryColor: string;
  aimDirection: AimDirection;
  actionMode: ActionControlMode;
  completedRunsThisBall: number;
  isSprintingRun: boolean;
  canCallExtraRun: boolean;
  canCancelRun: boolean;
  throwInFlight: boolean;
  lastOutcomeText: string;
  calloutText: string;
  calloutSubtext: string;
  calloutColor: string;
  calloutId: number;
}
