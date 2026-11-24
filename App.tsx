// tslint:disable
/* eslint-disable */
import {
  Home,
  Info,
  Play,
  RotateCw,
  Settings,
  Trophy,
  Volume2,
  VolumeX,
  Zap,
} from 'lucide-react';
import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  BAT_SKIN_LIST,
  BAT_SKINS,
  SHOT_CHART_SECTORS,
  STORAGE_KEY_BAT_SKIN,
  STORAGE_KEY_CAMPAIGN,
  STORAGE_KEY_TOURNEY,
  TEAM_LIST,
  TEAMS,
  TOTAL_CAMPAIGN_LEVELS,
  buildCampaignMatchConfig,
  buildTournamentMatchConfig,
  getConfig,
  isBatSkinUnlocked,
} from './constants';
import {Game} from './Game';
import {
  createInitialInputSnapshot,
  type InputAction,
  type InputSnapshot,
} from './input';
import {
  ActionControlMode,
  AimDirection,
  BatSkinId,
  BracketFixture,
  CampaignSaveData,
  GameMode,
  LiveScoreHud,
  MatchConfig,
  TeamId,
  TimingMeterSnapshot,
  TournamentSaveData,
} from './types';
import BackgroundMusic from './utils/BackgroundMusic';
import {
  GameState,
  MenuOverlay,
  gameAudio,
  shuffle,
  useIsMobile,
} from './utils/helper';
import {
  usePlayground,
  usePlaygroundGameLifecycle,
  usePlaygroundResume,
  useRpc,
} from './utils/usePlayground';

// ============================================================================
// PERSISTENCE & TOURNAMENT BRACKET HELPERS
// ============================================================================

function createFreshTournamentBracket(
  playerTeam: TeamId,
  trophiesWon = 0,
): TournamentSaveData {
  const others = shuffle(
    TEAM_LIST.map((t) => t.id).filter((id) => id !== playerTeam),
  );
  const quarterfinals: BracketFixture[] = [
    {id: 'QF1', teamA: playerTeam, teamB: others[0]},
    {id: 'QF2', teamA: others[1], teamB: others[2]},
    {id: 'QF3', teamA: others[3], teamB: others[4]},
    {id: 'QF4', teamA: others[5], teamB: others[6]},
  ];
  return {
    playerTeam,
    trophiesWon,
    currentRound: 0,
    quarterfinals,
    semifinals: [],
    finalMatch: null,
    champion: null,
  };
}

function simulateAiFixture(fix: BracketFixture, overs: number): BracketFixture {
  const baseRuns = overs * (7 + Math.floor(Math.random() * 5));
  const winMargin = 2 + Math.floor(Math.random() * 9);
  const aWins = Math.random() < 0.5;
  const runsWinner = baseRuns + winMargin;
  const runsLoser = Math.max(overs * 4, baseRuns - 1);
  const wktsA = Math.min(4, Math.floor(Math.random() * 4));
  const wktsB = Math.min(4, Math.floor(Math.random() * 4));
  return {
    ...fix,
    scoreA: `${aWins ? runsWinner : runsLoser}/${wktsA}`,
    scoreB: `${aWins ? runsLoser : runsWinner}/${wktsB}`,
    winner: aWins ? fix.teamA : fix.teamB,
  };
}

function loadTournamentSave(): TournamentSaveData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_TOURNEY);
    if (raw) {
      const parsed = JSON.parse(raw) as TournamentSaveData;
      if (
        parsed &&
        parsed.playerTeam &&
        TEAMS[parsed.playerTeam] &&
        Array.isArray(parsed.quarterfinals) &&
        parsed.quarterfinals.length === 4
      ) {
        return parsed;
      }
    }
  } catch {
    // Ignore storage errors in restricted sandboxes
  }
  return createFreshTournamentBracket('MUMBAI', 0);
}

function saveTournamentData(data: TournamentSaveData): void {
  try {
    localStorage.setItem(STORAGE_KEY_TOURNEY, JSON.stringify(data));
  } catch {
    // Ignore storage errors
  }
}

function loadCampaignSave(minUnlockedLevel: number): CampaignSaveData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_CAMPAIGN);
    if (raw) {
      const parsed = JSON.parse(raw) as CampaignSaveData;
      if (parsed && parsed.playerTeam && TEAMS[parsed.playerTeam]) {
        return {
          playerTeam: parsed.playerTeam,
          unlockedLevel: Math.min(
            TOTAL_CAMPAIGN_LEVELS,
            Math.max(1, parsed.unlockedLevel || 1, minUnlockedLevel),
          ),
          starsByLevel: parsed.starsByLevel || {},
        };
      }
    }
  } catch {
    // Ignore storage errors
  }
  return {
    playerTeam: 'MUMBAI',
    unlockedLevel: Math.min(TOTAL_CAMPAIGN_LEVELS, Math.max(1, minUnlockedLevel)),
    starsByLevel: {},
  };
}

function saveCampaignData(data: CampaignSaveData): void {
  try {
    localStorage.setItem(STORAGE_KEY_CAMPAIGN, JSON.stringify(data));
  } catch {
    // Ignore storage errors
  }
}

function loadSavedBatSkin(): BatSkinId {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_BAT_SKIN) as BatSkinId | null;
    if (raw && BAT_SKINS[raw]) {
      return raw;
    }
  } catch {
    // Ignore storage errors
  }
  return 'CLASSIC_WILLOW';
}

function saveBatSkin(skinId: BatSkinId): void {
  try {
    localStorage.setItem(STORAGE_KEY_BAT_SKIN, skinId);
  } catch {
    // Ignore storage errors
  }
}

function formatOvers(balls: number): string {
  const completedOvers = Math.floor(balls / 6);
  const remBalls = balls % 6;
  return `${completedOvers}.${remBalls}`;
}

// ============================================================================
// COMPACT 60FPS TIMING METER HUD (Bottom-Center — Zero React Re-Renders)
// ============================================================================

function TimingMeterBar({
  timingMeterRef,
}: {
  timingMeterRef: React.MutableRefObject<TimingMeterSnapshot>;
}) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const needleRef = useRef<HTMLDivElement>(null);
  const badgeRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    let rafId = 0;
    const tick = () => {
      const snap = timingMeterRef.current;
      const wrap = wrapperRef.current;
      const needle = needleRef.current;
      const badge = badgeRef.current;
      if (wrap && needle && badge) {
        wrap.style.opacity = snap.visible ? '1' : '0';
        const p =
          snap.lockedProgress !== null ? snap.lockedProgress : snap.progress;
        needle.style.left = `${Math.max(2, Math.min(98, p * 100))}%`;

        if (snap.grade === 'PERFECT') {
          badge.textContent = 'PERFECT!';
          badge.style.color = '#34d399';
        } else if (snap.grade === 'GOOD') {
          badge.textContent = 'SOLID';
          badge.style.color = '#38bdf8';
        } else if (snap.grade === 'EARLY') {
          badge.textContent = 'EARLY';
          badge.style.color = '#facc15';
        } else if (snap.grade === 'LATE') {
          badge.textContent = 'LATE';
          badge.style.color = '#fb923c';
        } else if (snap.grade === 'MISS') {
          badge.textContent = 'MISS';
          badge.style.color = '#f43f5e';
        } else {
          badge.textContent = 'TIMING';
          badge.style.color = '#cbd5e1';
        }
      }
      rafId = window.requestAnimationFrame(tick);
    };
    rafId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(rafId);
  }, [timingMeterRef]);

  // Sweet spot is around ~89.7% along [-9.8 .. +12.0]:
  // Early zone ~77%..84.5%, Perfect green zone ~84.5%..94.8%, Late zone ~94.8%..99%
  return (
    <div
      ref={wrapperRef}
      style={{transition: 'opacity 140ms ease-out'}}
      className="pointer-events-none flex flex-col items-center gap-0.5 bg-slate-950/85 border border-slate-700/90 rounded-xl px-2.5 py-1 shadow-xl w-44 sm:w-56">
      <div className="w-full flex items-center justify-between text-[10px] font-black tracking-wider uppercase leading-none">
        <span className="text-slate-400">RELEASE</span>
        <span ref={badgeRef} className="text-slate-200">
          TIMING
        </span>
        <span className="text-emerald-400">CREASE</span>
      </div>
      <div className="relative w-full h-2.5 rounded-full bg-slate-800 overflow-hidden border border-slate-600/80">
        {/* Early Timing Band (Yellow) */}
        <div
          style={{left: '75%', width: '9.5%'}}
          className="absolute inset-y-0 bg-amber-400/85"
        />
        {/* Perfect Sweet-Spot Zone (Bright Green) */}
        <div
          style={{left: '84.5%', width: '10.3%'}}
          className="absolute inset-y-0 bg-emerald-400 shadow-[0_0_8px_#34d399]"
        />
        {/* Late Timing Band (Yellow/Orange) */}
        <div
          style={{left: '94.8%', width: '5.2%'}}
          className="absolute inset-y-0 bg-amber-400/85"
        />
        {/* Live Ball Marker Needle */}
        <div
          ref={needleRef}
          style={{left: '0%'}}
          className="absolute top-0 bottom-0 w-1.5 -ml-[3px] bg-white rounded-full shadow-[0_0_6px_#ffffff]"
        />
      </div>
    </div>
  );
}

// ============================================================================
// UNIFIED ON-SCREEN TOUCH, MOUSE & KEYBOARD CONTROL OVERLAY
// (Always visible on Desktop & Mobile during PLAYING so mouse/touch & keyboard work 100%)
// ============================================================================

function InteractiveHudControls({
  inputRef,
  timingMeterRef,
  activeAim,
  actionMode,
  completedRunsThisBall,
  canCallExtraRun,
  canCancelRun,
  throwInFlight,
  onSelectAim,
}: {
  inputRef: React.MutableRefObject<InputSnapshot>;
  timingMeterRef: React.MutableRefObject<TimingMeterSnapshot>;
  activeAim: AimDirection;
  actionMode: ActionControlMode;
  completedRunsThisBall: number;
  canCallExtraRun: boolean;
  canCancelRun: boolean;
  throwInFlight: boolean;
  onSelectAim: (dir: AimDirection) => void;
}) {
  useEffect(() => {
    const clearAll = () => {
      inputRef.current.actions.lofted = false;
      inputRef.current.actions.grounded = false;
      inputRef.current.actions.defend = false;
      inputRef.current.actions.callRun = false;
      inputRef.current.actions.cancelRun = false;
    };
    window.addEventListener('blur', clearAll);
    return () => {
      window.removeEventListener('blur', clearAll);
      clearAll();
    };
  }, [inputRef]);

  const bindActionButton = (actionKey: InputAction) => ({
    onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => {
      e.preventDefault();
      e.stopPropagation();
      e.currentTarget.setPointerCapture?.(e.pointerId);
      inputRef.current.actions[actionKey] = true;
    },
    onPointerUp: (e: React.PointerEvent<HTMLButtonElement>) => {
      e.stopPropagation();
      inputRef.current.actions[actionKey] = false;
    },
    onPointerLeave: (e: React.PointerEvent<HTMLButtonElement>) => {
      e.stopPropagation();
      inputRef.current.actions[actionKey] = false;
    },
    onPointerCancel: (e: React.PointerEvent<HTMLButtonElement>) => {
      e.stopPropagation();
      inputRef.current.actions[actionKey] = false;
    },
    onLostPointerCapture: () => {
      inputRef.current.actions[actionKey] = false;
    },
  });

  const bindAimButton = (dir: AimDirection) => ({
    onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => {
      e.preventDefault();
      e.stopPropagation();
      inputRef.current.aimLaneOverride = dir;
      onSelectAim(dir);
    },
    onPointerUp: (e: React.PointerEvent<HTMLButtonElement>) => {
      e.stopPropagation();
    },
    onPointerLeave: (e: React.PointerEvent<HTMLButtonElement>) => {
      e.stopPropagation();
    },
    onPointerCancel: (e: React.PointerEvent<HTMLButtonElement>) => {
      e.stopPropagation();
    },
  });

  const isRunningPhase = actionMode === 'RUNNING';

  return (
    <div className="absolute inset-x-0 bottom-0 pointer-events-none z-20 select-none px-4 sm:px-8 pb-3 flex flex-col gap-2">
      {/* Center Timing Meter Row (floats cleanly above bottom control bar) */}
      <div className="w-full flex justify-center pointer-events-none">
        {!isRunningPhase ? (
          <TimingMeterBar timingMeterRef={timingMeterRef} />
        ) : (
          <div className="bg-slate-950/85 border border-emerald-400/60 rounded-full px-3 py-1 text-xs font-black tracking-wider uppercase text-emerald-300 shadow-lg">
            RUNS COMPLETED: {completedRunsThisBall}
            {throwInFlight ? ' · THROW INCOMING!' : ' · BALL IN OUTFIELD'}
          </div>
        )}
      </div>

      {/* Bottom Left & Right Tactile Controls Row */}
      <div className="w-full flex flex-wrap items-end justify-between gap-2 pointer-events-none">
        {/* Bottom-Left: 3 Wagon-Wheel Shot Chart Aim Buttons */}
        <div className="flex items-center gap-1.5 pointer-events-none">
          {(
            [
              {dir: -1 as AimDirection, text: '< LEG', hint: 'A / ←'},
              {dir: 0 as AimDirection, text: '^ STRAIGHT', hint: 'W / ↑'},
              {dir: 1 as AimDirection, text: 'OFF >', hint: 'D / →'},
            ] as const
          ).map((btn) => {
            const isSelected = activeAim === btn.dir;
            return (
              <button
                key={btn.dir}
                type="button"
                data-hud-control="true"
                aria-label={`Aim ${SHOT_CHART_SECTORS[btn.dir].fullLabel}`}
                {...bindAimButton(btn.dir)}
                className={`min-w-[64px] sm:min-w-[82px] min-h-[48px] px-2.5 py-1.5 rounded-xl font-black text-xs tracking-wide pointer-events-auto touch-none select-none flex flex-col items-center justify-center border-2 transition-colors shadow-lg ${
                  isSelected
                    ? 'bg-amber-400 text-slate-950 border-white'
                    : 'bg-slate-900/85 text-slate-200 border-slate-600 hover:border-amber-300/70 active:bg-slate-700'
                }`}>
                <span>{btn.text}</span>
                <span
                  className={`text-[9px] font-bold leading-none mt-0.5 hidden sm:inline ${
                    isSelected ? 'text-slate-900' : 'text-slate-400'
                  }`}>
                  {btn.hint}
                </span>
              </button>
            );
          })}
        </div>

        {/* Bottom-Right: Dynamic Batting Shot Triggers OR Running Between Wickets Controls */}
        {!isRunningPhase ? (
          <div className="flex items-center gap-1.5 pointer-events-none">
            <button
              type="button"
              data-hud-control="true"
              aria-label="Defensive Block"
              {...bindActionButton('defend')}
              className="min-w-[74px] sm:min-w-[92px] min-h-[48px] px-3 py-1.5 rounded-xl bg-sky-600/95 hover:bg-sky-500 active:bg-sky-400 border-2 border-sky-200 text-white font-black text-xs tracking-wide pointer-events-auto touch-none select-none flex flex-col items-center justify-center shadow-lg">
              <span>DEFEND</span>
              <span className="text-[9px] font-bold text-sky-100 leading-none mt-0.5 hidden sm:inline">
                Q / Shift
              </span>
            </button>
            <button
              type="button"
              data-hud-control="true"
              aria-label="Grounded Drive"
              {...bindActionButton('grounded')}
              className="min-w-[82px] sm:min-w-[104px] min-h-[48px] px-3 py-1.5 rounded-xl bg-emerald-600/95 hover:bg-emerald-500 active:bg-emerald-400 border-2 border-emerald-200 text-white font-black text-xs tracking-wide pointer-events-auto touch-none select-none flex flex-col items-center justify-center shadow-lg">
              <span>GROUND (Drive)</span>
              <span className="text-[9px] font-bold text-emerald-100 leading-none mt-0.5 hidden sm:inline">
                S / ↓
              </span>
            </button>
            <button
              type="button"
              data-hud-control="true"
              aria-label="Lofted Power Shot"
              {...bindActionButton('lofted')}
              className="min-w-[88px] sm:min-w-[112px] min-h-[48px] px-3 py-1.5 rounded-xl bg-amber-400 hover:bg-amber-300 active:bg-yellow-200 border-2 border-yellow-100 text-slate-950 font-black text-xs tracking-wide pointer-events-auto touch-none select-none flex flex-col items-center justify-center shadow-lg">
              <span>LOFTED (6/4)</span>
              <span className="text-[9px] font-bold text-slate-800 leading-none mt-0.5 hidden sm:inline">
                Space
              </span>
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2 pointer-events-none">
            <button
              type="button"
              data-hud-control="true"
              disabled={!canCancelRun}
              aria-label="Cancel Run and Return to Crease"
              {...bindActionButton('cancelRun')}
              className={`min-w-[92px] sm:min-w-[110px] min-h-[48px] px-3 py-1.5 rounded-xl border-2 font-black text-xs tracking-wide pointer-events-auto touch-none select-none flex flex-col items-center justify-center shadow-lg transition-opacity ${
                canCancelRun
                  ? 'bg-rose-600 hover:bg-rose-500 active:bg-rose-400 border-rose-200 text-white'
                  : 'bg-slate-900/70 border-slate-700 text-slate-500 opacity-60'
              }`}>
              <span>CANCEL</span>
              <span className="text-[9px] font-bold leading-none mt-0.5 hidden sm:inline">
                Key C
              </span>
            </button>
            <button
              type="button"
              data-hud-control="true"
              disabled={!canCallExtraRun}
              aria-label="Call Extra Run"
              {...bindActionButton('callRun')}
              className={`min-w-[100px] sm:min-w-[122px] min-h-[48px] px-3.5 py-1.5 rounded-xl border-2 font-black text-xs tracking-wide pointer-events-auto touch-none select-none flex flex-col items-center justify-center shadow-lg transition-opacity ${
                canCallExtraRun
                  ? 'bg-emerald-500 hover:bg-emerald-400 active:bg-emerald-300 border-emerald-100 text-slate-950'
                  : 'bg-slate-900/70 border-slate-700 text-slate-500 opacity-60'
              }`}>
              <span>RUN (+1)</span>
              <span className="text-[9px] font-bold leading-none mt-0.5 hidden sm:inline">
                Key R / Enter
              </span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// MAIN APPLICATION
// ============================================================================

export default function App() {
  // --- PLAYGROUND SDK INTEGRATION ---
  const {sdk, isReady} = usePlayground();
  const [exitChat] = useRpc<Record<string, unknown>, void>('ExitChat');
  const isMobile = useIsMobile();
  const sharedInputRef = useRef<InputSnapshot>(createInitialInputSnapshot());
  const timingMeterRef = useRef<TimingMeterSnapshot>({
    visible: false,
    progress: 0,
    lockedProgress: null,
    grade: null,
  });

  // Do not remove: Playground save/resume
  const {initialLevel, initialScore, persistenceEnabled, autoStartPending} =
    usePlaygroundResume({
      isReady,
      onAutoStart: () => {
        if (gameStateRef.current.status === 'START') {
          initGame();
        }
      },
    });

  const startLevel = Math.min(initialLevel, TOTAL_CAMPAIGN_LEVELS);
  const startScore = initialScore;

  const levelStartScoreRef = useRef(startScore);
  const prevLevelRef = useRef(startLevel);
  const runWonRef = useRef(false);

  const [gameState, setGameState] = useState<GameState>({
    status: 'START',
    score: startScore,
    level: startLevel,
  });

  const gameStateRef = useRef(gameState);
  gameStateRef.current = gameState;

  const [gameKey, setGameKey] = useState(0);

  // Persistent Mode States
  const [selectedMode, setSelectedMode] = useState<GameMode>('TOURNAMENT');
  const [tourneyData, setTourneyData] =
    useState<TournamentSaveData>(loadTournamentSave);
  const [campaignData, setCampaignData] = useState<CampaignSaveData>(() =>
    loadCampaignSave(startLevel),
  );
  const [selectedCampaignStage, setSelectedCampaignStage] =
    useState<number>(startLevel);
  const [campaignTierTab, setCampaignTierTab] = useState<number>(() =>
    Math.floor((startLevel - 1) / 10),
  );
  const [selectedBatSkin, setSelectedBatSkin] =
    useState<BatSkinId>(loadSavedBatSkin);

  const effectiveBatSkin: BatSkinId = isBatSkinUnlocked(
    selectedBatSkin,
    tourneyData.trophiesWon,
    campaignData.unlockedLevel,
  )
    ? selectedBatSkin
    : 'CLASSIC_WILLOW';

  // Menu & Audio States (Pause overlays keep gameState.status === 'PLAYING')
  const [isGameMenuOpen, setIsGameMenuOpen] = useState(false);
  const [isHowToPlayOpen, setIsHowToPlayOpen] = useState(false);
  const [isControlsLegendOpen, setIsControlsLegendOpen] = useState(false);
  const [isMusicMuted, setIsMusicMuted] = useState(false);
  const [isSfxMuted, setIsSfxMuted] = useState(() => gameAudio.getMuteState());

  // Match Summary Info for Post-Match Overlay
  const [lastMatchSummary, setLastMatchSummary] = useState<{
    runs: number;
    wickets: number;
    ballsBowled: number;
    starsEarned: number;
    headline: string;
    detail: string;
  }>({
    runs: 0,
    wickets: 0,
    ballsBowled: 0,
    starsEarned: 0,
    headline: '',
    detail: '',
  });

  // Active Match Configuration
  const [activeMatchConfig, setActiveMatchConfig] = useState<MatchConfig>(() =>
    buildCampaignMatchConfig(startLevel, 'MUMBAI'),
  );

  // Live Scoreboard HUD State
  const [hud, setHud] = useState<LiveScoreHud>({
    runs: 0,
    wickets: 0,
    wicketsAllowed: 3,
    ballsBowled: 0,
    totalBalls: 12,
    targetRuns: 22,
    currentDelivery: 'FAST_STRAIGHT',
    deliveryLabel: 'FAST SEAM',
    deliveryColor: '#22d3ee',
    aimDirection: 0,
    actionMode: 'BATTING',
    completedRunsThisBall: 0,
    isSprintingRun: false,
    canCallExtraRun: false,
    canCancelRun: false,
    throwInFlight: false,
    lastOutcomeText: '',
    calloutText: '',
    calloutSubtext: '',
    calloutColor: '#facc15',
    calloutId: 0,
  });

  const [visibleCalloutId, setVisibleCalloutId] = useState(0);

  // Auto-fade callout banner cleanly after 1.3s
  useEffect(() => {
    if (!hud.calloutId || !hud.calloutText) return;
    setVisibleCalloutId(hud.calloutId);
    const timer = window.setTimeout(() => {
      setVisibleCalloutId((cur) => (cur === hud.calloutId ? 0 : cur));
    }, 1350);
    return () => window.clearTimeout(timer);
  }, [hud.calloutId, hud.calloutText]);

  // Sync SFX default volume on boot
  useEffect(() => {
    gameAudio.setVolume(getConfig('defaultSfxVolume'));
  }, []);

  // Win/Lose audio stingers tied to terminal gameState.status
  useEffect(() => {
    if (gameState.status === 'GAME_OVER') {
      gameAudio.playDefeatMotif();
    } else if (gameState.status === 'VICTORY') {
      gameAudio.playVictoryFanfare();
      runWonRef.current = true;
    } else if (gameState.status === 'LEVEL_COMPLETE') {
      gameAudio.playLevelUpStinger();
    }
  }, [gameState.status]);

  useEffect(() => {
    if (gameState.level !== prevLevelRef.current) {
      prevLevelRef.current = gameState.level;
      levelStartScoreRef.current = gameStateRef.current.score;
    }
  }, [gameState.level]);

  useEffect(() => {
    const canHandleBackKey =
      ['PLAYING', 'PAUSED'].includes(gameState.status) ||
      isGameMenuOpen ||
      isHowToPlayOpen;
    (window as unknown as Record<string, unknown>).canHandleBackKey =
      canHandleBackKey;
    if (window.parent && window.parent !== window) {
      window.parent.postMessage(
        {
          type: 'PLAYGROUND_CAN_HANDLE_BACK_KEY',
          value: canHandleBackKey,
        },
        '*',
      );
    }
  }, [gameState.status, isGameMenuOpen, isHowToPlayOpen]);

  // Escape handler when overlays are open (so Escape closes HowToPlay first, then GameMenu)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (isHowToPlayOpen) {
        e.preventDefault();
        setIsHowToPlayOpen(false);
      } else if (isGameMenuOpen) {
        e.preventDefault();
        setIsGameMenuOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isHowToPlayOpen, isGameMenuOpen]);

  // Current Opponent Resolver for Tournament Mode
  const getCurrentTourneyOpponent = useCallback(
    (tData: TournamentSaveData): TeamId => {
      const pTeam = tData.playerTeam;
      if (tData.currentRound === 0) {
        const qf =
          tData.quarterfinals.find(
            (f) => f.teamA === pTeam || f.teamB === pTeam,
          ) ?? tData.quarterfinals[0];
        return qf.teamA === pTeam ? qf.teamB : qf.teamA;
      }
      if (tData.currentRound === 1) {
        const sf = tData.semifinals.find(
          (f) => f.teamA === pTeam || f.teamB === pTeam,
        );
        if (sf) return sf.teamA === pTeam ? sf.teamB : sf.teamA;
      }
      if (tData.currentRound === 2 && tData.finalMatch) {
        return tData.finalMatch.teamA === pTeam
          ? tData.finalMatch.teamB
          : tData.finalMatch.teamA;
      }
      return pTeam === 'CHENNAI' ? 'MUMBAI' : 'CHENNAI';
    },
    [],
  );

  // Build MatchConfig for a given level & current mode
  const resolveMatchConfig = useCallback(
    (
      mode: GameMode,
      level: number,
      tData: TournamentSaveData,
      cData: CampaignSaveData,
    ): MatchConfig => {
      if (mode === 'TOURNAMENT') {
        const activeTourney = tData.champion
          ? createFreshTournamentBracket(tData.playerTeam, tData.trophiesWon)
          : tData;
        const opp = getCurrentTourneyOpponent(activeTourney);
        return buildTournamentMatchConfig(
          activeTourney.currentRound,
          activeTourney.playerTeam,
          opp,
        );
      }
      return buildCampaignMatchConfig(level, cData.playerTeam);
    },
    [getCurrentTourneyOpponent],
  );

  // --- Game Init / Run Control ---
  const startRun = useCallback(
    (level: number, score: number, explicitConfig?: MatchConfig) => {
      const clampedLevel = Math.max(
        1,
        Math.min(TOTAL_CAMPAIGN_LEVELS, Math.floor(level)),
      );
      const cfg =
        explicitConfig ??
        resolveMatchConfig(
          selectedMode,
          clampedLevel,
          tourneyData,
          campaignData,
        );

      setActiveMatchConfig(cfg);
      setIsGameMenuOpen(false);
      setIsHowToPlayOpen(false);
      setIsControlsLegendOpen(false);
      setVisibleCalloutId(0);
      setHud({
        runs: 0,
        wickets: 0,
        wicketsAllowed: cfg.wicketsAllowed,
        ballsBowled: 0,
        totalBalls: cfg.totalBalls,
        targetRuns: cfg.targetRuns,
        currentDelivery: 'FAST_STRAIGHT',
        deliveryLabel: 'FAST SEAM',
        deliveryColor: '#22d3ee',
        aimDirection: 0,
        actionMode: 'BATTING',
        completedRunsThisBall: 0,
        isSprintingRun: false,
        canCallExtraRun: false,
        canCancelRun: false,
        throwInFlight: false,
        lastOutcomeText: '',
        calloutText: '',
        calloutSubtext: '',
        calloutColor: '#facc15',
        calloutId: 0,
      });

      levelStartScoreRef.current = score;
      prevLevelRef.current = clampedLevel;
      runWonRef.current = false;
      Object.assign(sharedInputRef.current, createInitialInputSnapshot());

      setGameState((prev) => ({
        ...prev,
        status: 'PLAYING',
        level: clampedLevel,
        score,
      }));
      setGameKey((prev) => prev + 1);

      if (sdk) {
        sdk.startGame();
      }
    },
    [campaignData, resolveMatchConfig, sdk, selectedMode, tourneyData],
  );

  const initGame = useCallback(() => {
    // If Tournament champion was crowned, start a fresh bracket preserving trophiesWon
    let currentTourney = tourneyData;
    if (selectedMode === 'TOURNAMENT' && tourneyData.champion) {
      currentTourney = createFreshTournamentBracket(
        tourneyData.playerTeam,
        tourneyData.trophiesWon,
      );
      setTourneyData(currentTourney);
      saveTournamentData(currentTourney);
    }

    const targetLevel =
      selectedMode === 'CAMPAIGN'
        ? selectedCampaignStage
        : currentTourney.currentRound + 1;

    const cfg = resolveMatchConfig(
      selectedMode,
      targetLevel,
      currentTourney,
      campaignData,
    );

    if (persistenceEnabled && !runWonRef.current) {
      startRun(targetLevel, levelStartScoreRef.current, cfg);
    } else {
      startRun(
        targetLevel,
        gameStateRef.current.status === 'START' ? startScore : 0,
        cfg,
      );
    }
  }, [
    campaignData,
    persistenceEnabled,
    resolveMatchConfig,
    selectedCampaignStage,
    selectedMode,
    startRun,
    startScore,
    tourneyData,
  ]);

  const resetGame = useCallback(() => {
    if (selectedMode === 'TOURNAMENT') {
      const fresh = createFreshTournamentBracket(
        tourneyData.playerTeam,
        tourneyData.trophiesWon,
      );
      setTourneyData(fresh);
      saveTournamentData(fresh);
      const cfg = resolveMatchConfig('TOURNAMENT', 1, fresh, campaignData);
      startRun(1, 0, cfg);
    } else {
      setSelectedCampaignStage(1);
      const cfg = resolveMatchConfig('CAMPAIGN', 1, tourneyData, campaignData);
      startRun(1, 0, cfg);
    }
  }, [campaignData, resolveMatchConfig, selectedMode, startRun, tourneyData]);

  // Handle Match Conclusion from 3D Scene
  const handleMatchEnd = useCallback(
    (
      outcome: 'WIN' | 'LOSS',
      runs: number,
      wickets: number,
      ballsBowled: number,
    ) => {
      const cfg = activeMatchConfig;
      const ballsLeft = Math.max(0, cfg.totalBalls - ballsBowled);
      const wicketsLeft = Math.max(0, cfg.wicketsAllowed - wickets);

      if (outcome === 'LOSS') {
        const runsShort = Math.max(1, cfg.targetRuns - runs);
        setLastMatchSummary({
          runs,
          wickets,
          ballsBowled,
          starsEarned: 0,
          headline: `${TEAMS[cfg.opponentTeam].name} WON BY ${runsShort} RUN${runsShort === 1 ? '' : 'S'}`,
          detail: `Scored ${runs}/${wickets} in ${formatOvers(ballsBowled)} overs (Target ${cfg.targetRuns})`,
        });
        setGameState((prev) => ({...prev, status: 'GAME_OVER'}));
        return;
      }

      // Match Won! Compute Star Rating & Win Bonus
      const stars =
        wickets === 0 || (ballsLeft >= Math.ceil(cfg.totalBalls * 0.25) && wickets <= 1)
          ? 3
          : wickets <= 1 || ballsLeft >= 2
            ? 2
            : 1;
      const winBonus = 100 + wicketsLeft * 30 + ballsLeft * 15;

      if (cfg.mode === 'TOURNAMENT') {
        const pTeam = tourneyData.playerTeam;
        const playerScoreStr = `${runs}/${wickets}`;
        const oppScoreStr = `${cfg.targetRuns - 1}/${Math.min(4, 2 + Math.floor(Math.random() * 3))}`;

        if (tourneyData.currentRound === 0) {
          // Advance Quarterfinals -> Semifinals (simulate 3 AI Quarterfinals)
          const updatedQF = tourneyData.quarterfinals.map((fix) => {
            if (fix.teamA === pTeam || fix.teamB === pTeam) {
              const pIsA = fix.teamA === pTeam;
              return {
                ...fix,
                scoreA: pIsA ? playerScoreStr : oppScoreStr,
                scoreB: pIsA ? oppScoreStr : playerScoreStr,
                winner: pTeam,
              };
            }
            return simulateAiFixture(fix, 2);
          });
          const semifinals: BracketFixture[] = [
            {
              id: 'SF1',
              teamA: updatedQF[0].winner!,
              teamB: updatedQF[1].winner!,
            },
            {
              id: 'SF2',
              teamA: updatedQF[2].winner!,
              teamB: updatedQF[3].winner!,
            },
          ];
          const nextTourney: TournamentSaveData = {
            ...tourneyData,
            currentRound: 1,
            quarterfinals: updatedQF,
            semifinals,
          };
          setTourneyData(nextTourney);
          saveTournamentData(nextTourney);
          setLastMatchSummary({
            runs,
            wickets,
            ballsBowled,
            starsEarned: stars,
            headline: 'QUARTERFINAL WON — INTO THE SEMIS!',
            detail: `${pTeam} ${playerScoreStr} chased ${cfg.targetRuns} with ${ballsLeft} balls left`,
          });
          setGameState((prev) => ({
            ...prev,
            score: prev.score + winBonus,
            status: 'LEVEL_COMPLETE',
          }));
        } else if (tourneyData.currentRound === 1) {
          // Advance Semifinals -> Grand Final (simulate other AI Semifinal)
          const updatedSF = tourneyData.semifinals.map((fix) => {
            if (fix.teamA === pTeam || fix.teamB === pTeam) {
              const pIsA = fix.teamA === pTeam;
              return {
                ...fix,
                scoreA: pIsA ? playerScoreStr : oppScoreStr,
                scoreB: pIsA ? oppScoreStr : playerScoreStr,
                winner: pTeam,
              };
            }
            return simulateAiFixture(fix, 3);
          });
          const finalMatch: BracketFixture = {
            id: 'FINAL',
            teamA: updatedSF[0].winner!,
            teamB: updatedSF[1].winner!,
          };
          const nextTourney: TournamentSaveData = {
            ...tourneyData,
            currentRound: 2,
            semifinals: updatedSF,
            finalMatch,
          };
          setTourneyData(nextTourney);
          saveTournamentData(nextTourney);
          setLastMatchSummary({
            runs,
            wickets,
            ballsBowled,
            starsEarned: stars,
            headline: 'SEMIFINAL WON — GRAND FINAL AWAITS!',
            detail: `${pTeam} ${playerScoreStr} booked a Grand Final clash vs ${
              finalMatch.teamA === pTeam ? finalMatch.teamB : finalMatch.teamA
            }`,
          });
          setGameState((prev) => ({
            ...prev,
            score: prev.score + winBonus,
            status: 'LEVEL_COMPLETE',
          }));
        } else {
          // GRAND FINAL WON -> CROWN CHAMPION & INCREMENT TROPHIES!
          const pIsA = tourneyData.finalMatch?.teamA === pTeam;
          const completedFinal: BracketFixture = tourneyData.finalMatch
            ? {
                ...tourneyData.finalMatch,
                scoreA: pIsA ? playerScoreStr : oppScoreStr,
                scoreB: pIsA ? oppScoreStr : playerScoreStr,
                winner: pTeam,
              }
            : {
                id: 'FINAL',
                teamA: pTeam,
                teamB: cfg.opponentTeam,
                scoreA: playerScoreStr,
                scoreB: oppScoreStr,
                winner: pTeam,
              };
          const nextTourney: TournamentSaveData = {
            ...tourneyData,
            finalMatch: completedFinal,
            champion: pTeam,
            trophiesWon: tourneyData.trophiesWon + 1,
          };
          setTourneyData(nextTourney);
          saveTournamentData(nextTourney);
          setLastMatchSummary({
            runs,
            wickets,
            ballsBowled,
            starsEarned: 3,
            headline: `${pTeam} CHAMPIONS! TROPHY #${nextTourney.trophiesWon}`,
            detail: `Grand Final chased! ${playerScoreStr} (${formatOvers(ballsBowled)} ov)`,
          });
          // Final tournament round ends directly with VICTORY
          setGameState((prev) => ({
            ...prev,
            score: prev.score + winBonus + 250,
            status: 'VICTORY',
          }));
        }
      } else {
        // CAMPAIGN MODE (50 Levels)
        const stage = cfg.levelNumber;
        const prevBestStars = campaignData.starsByLevel[stage] || 0;
        const nextUnlocked = Math.min(
          TOTAL_CAMPAIGN_LEVELS,
          Math.max(campaignData.unlockedLevel, stage + 1),
        );
        const updatedCampaign: CampaignSaveData = {
          ...campaignData,
          unlockedLevel: nextUnlocked,
          starsByLevel: {
            ...campaignData.starsByLevel,
            [stage]: Math.max(prevBestStars, stars),
          },
        };
        setCampaignData(updatedCampaign);
        saveCampaignData(updatedCampaign);

        setLastMatchSummary({
          runs,
          wickets,
          ballsBowled,
          starsEarned: stars,
          headline:
            stage >= TOTAL_CAMPAIGN_LEVELS
              ? 'ALL 50 CAMPAIGN STAGES CONQUERED!'
              : `STAGE ${stage} COMPLETE!`,
          detail: `${runs}/${wickets} in ${formatOvers(ballsBowled)} ov · ${wicketsLeft} wkts & ${ballsLeft} balls spared`,
        });

        if (stage >= TOTAL_CAMPAIGN_LEVELS) {
          // Final level ends directly in VICTORY without advancing level past 50
          setGameState((prev) => ({
            ...prev,
            score: prev.score + winBonus + 300,
            status: 'VICTORY',
          }));
        } else {
          setSelectedCampaignStage(stage + 1);
          setCampaignTierTab(Math.floor(stage / 10));
          setGameState((prev) => ({
            ...prev,
            score: prev.score + winBonus,
            status: 'LEVEL_COMPLETE',
          }));
        }
      }
    },
    [activeMatchConfig, campaignData, tourneyData],
  );

  // Proceed to Next Match after LEVEL_COMPLETE
  const handleNextMatch = useCallback(() => {
    gameAudio.playConfirmSelect();
    if (selectedMode === 'TOURNAMENT') {
      const nextRoundLevel = tourneyData.currentRound + 1;
      const cfg = resolveMatchConfig(
        'TOURNAMENT',
        nextRoundLevel,
        tourneyData,
        campaignData,
      );
      startRun(nextRoundLevel, gameStateRef.current.score, cfg);
    } else {
      const nextStage = Math.min(
        TOTAL_CAMPAIGN_LEVELS,
        activeMatchConfig.levelNumber + 1,
      );
      setSelectedCampaignStage(nextStage);
      const cfg = resolveMatchConfig(
        'CAMPAIGN',
        nextStage,
        tourneyData,
        campaignData,
      );
      startRun(nextStage, gameStateRef.current.score, cfg);
    }
  }, [
    activeMatchConfig.levelNumber,
    campaignData,
    resolveMatchConfig,
    selectedMode,
    startRun,
    tourneyData,
  ]);

  // Select Franchise Team
  const handleSelectTeam = (teamId: TeamId) => {
    gameAudio.playCrispClick();
    if (selectedMode === 'TOURNAMENT') {
      const fresh = createFreshTournamentBracket(teamId, tourneyData.trophiesWon);
      setTourneyData(fresh);
      saveTournamentData(fresh);
    } else {
      const updated = {...campaignData, playerTeam: teamId};
      setCampaignData(updated);
      saveCampaignData(updated);
    }
  };

  // --- PLAYGROUND SDK SCORE & LIFECYCLE REPORTING ---
  usePlaygroundGameLifecycle(gameState, sdk);

  // Auto-start when ?autoplay is in the URL
  const hasAutoplayed = useRef(false);
  useEffect(() => {
    if (
      !hasAutoplayed.current &&
      new URLSearchParams(window.location.search).has('autoplay')
    ) {
      hasAutoplayed.current = true;
      initGame();
    }
  }, [initGame]);

  const isMusicPlaying =
    ['PLAYING', 'LEVEL_COMPLETE'].includes(gameState.status) && !isGameMenuOpen;

  // Derived Scoreboard Metrics
  const ballsRemaining = Math.max(0, hud.totalBalls - hud.ballsBowled);
  const runsNeeded = Math.max(0, hud.targetRuns - hud.runs);
  const reqRunRate =
    ballsRemaining > 0 ? ((runsNeeded / ballsRemaining) * 6).toFixed(2) : '0.00';

  const activeTeamId =
    selectedMode === 'TOURNAMENT'
      ? tourneyData.playerTeam
      : campaignData.playerTeam;
  const totalStarsEarned = useMemo(
    () =>
      Object.values(campaignData.starsByLevel).reduce((sum, v) => sum + v, 0),
    [campaignData.starsByLevel],
  );

  const playerMatchTeam = TEAMS[activeMatchConfig.playerTeam];
  const oppMatchTeam = TEAMS[activeMatchConfig.opponentTeam];

  return (
    <div
      style={{fontFamily: getConfig('fontFamily')}}
      className="fixed inset-0 overflow-hidden touch-none flex flex-col bg-zinc-950 text-white select-none">
      {/* Google Fonts Import for Broadcast Sports Aesthetic */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Rajdhani:wght@600;700&family=Teko:wght@600;700&display=swap');
      `}</style>

      <BackgroundMusic
        url={getConfig('backgroundMusicUrl')}
        isPlaying={isMusicPlaying}
        isMuted={isMusicMuted}
        volume={getConfig('defaultMusicVolume')}
      />

      {/* =====================================================================
          MINIMAL BROADCAST TOP SCOREBOARD HUD (Strict text-xs / text-sm caps,
          top-right corner reserved exclusively for Menu button)
         ===================================================================== */}
      {gameState.status === 'PLAYING' && (
        <div className="w-full shrink-0 flex flex-wrap items-center justify-between gap-2 px-3 py-1.5 bg-slate-950/95 border-b border-slate-800 z-20 pointer-events-none">
          {/* Left & Center Broadcast Readouts */}
          <div className="flex flex-wrap items-center gap-1.5">
            {/* Franchise Matchup & Score */}
            <div className="flex items-center gap-1.5 bg-slate-900 border border-slate-700 rounded-lg px-2 py-1">
              <span
                style={{backgroundColor: playerMatchTeam.primaryColor}}
                className="w-2.5 h-2.5 rounded-full inline-block shrink-0"
              />
              <span className="text-xs font-bold tracking-wide text-white">
                {playerMatchTeam.shortName}
              </span>
              <span className="text-sm font-black text-amber-400">
                {hud.runs}/{hud.wickets}
              </span>
              <span className="text-[10px] text-slate-400">vs</span>
              <span
                style={{backgroundColor: oppMatchTeam.primaryColor}}
                className="w-2.5 h-2.5 rounded-full inline-block shrink-0"
              />
              <span className="text-xs font-bold text-slate-300">
                {oppMatchTeam.shortName}
              </span>
            </div>

            {/* Target & Equation */}
            <div className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-xs font-bold text-slate-200">
              TGT <span className="text-emerald-400">{hud.targetRuns}</span>
              <span className="text-slate-400 mx-1">·</span>
              Need <span className="text-amber-300">{runsNeeded}</span> ({ballsRemaining}b)
            </div>

            {/* Overs & Required Run Rate */}
            <div className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-xs font-bold text-slate-300">
              OV {formatOvers(hud.ballsBowled)}/{activeMatchConfig.overs}.0
              <span className="text-slate-500 mx-1">·</span>
              RRR <span className="text-sky-400">{reqRunRate}</span>
            </div>

            {/* Delivery Telegraph Indicator */}
            <div className="flex items-center gap-1.5 bg-slate-900 border border-slate-700 rounded-lg px-2 py-1">
              <span
                style={{backgroundColor: hud.deliveryColor}}
                className="w-2 h-2 rounded-full inline-block shrink-0"
              />
              <span className="text-[10px] font-bold tracking-wider uppercase text-slate-200">
                {hud.deliveryLabel}
              </span>
            </div>

            {/* Collapsible Controls Quick Legend Toggle (?) */}
            <button
              type="button"
              data-hud-control="true"
              aria-label="Toggle Controls Legend"
              onClick={() => {
                gameAudio.playCrispClick();
                setIsControlsLegendOpen((prev) => !prev);
              }}
              className={`pointer-events-auto min-w-[40px] min-h-[36px] px-2.5 py-1 rounded-lg border text-xs font-black tracking-wide transition-colors flex items-center gap-1 ${
                isControlsLegendOpen
                  ? 'bg-sky-400 text-slate-950 border-white'
                  : 'bg-slate-900 hover:bg-slate-800 text-sky-300 border-slate-600'
              }`}>
              <span>?</span>
              <span className="hidden sm:inline">Controls</span>
            </button>
          </div>

          {/* Top-Right Corner Reserved Exclusively for Game Menu Button */}
          <div className="pl-2 pr-1 py-0.5 shrink-0">
            <button
              type="button"
              aria-label="Open Game Menu"
              onClick={() => {
                gameAudio.playCrispClick();
                setIsGameMenuOpen(true);
              }}
              className="pointer-events-auto min-w-[48px] min-h-[48px] px-3 py-2 rounded-xl bg-slate-800 hover:bg-amber-400 hover:text-slate-950 border border-slate-600 text-xs font-black tracking-wider uppercase transition-colors flex items-center justify-center gap-1.5 shadow-md">
              <Settings size={15} />
              Menu
            </button>
          </div>
        </div>
      )}

      {/* =====================================================================
          3D STADIUM VIEWPORT + CALLOUTS + UNIFIED HUD CONTROLS + LEGEND POPOVER
         ===================================================================== */}
      <div className="flex-1 w-full min-h-0 relative bg-slate-950 overflow-hidden flex items-center justify-center">
        <Game
          key={gameKey}
          gameState={gameState}
          setGameState={setGameState}
          exitChat={exitChat}
          gameStateRef={gameStateRef}
          externalInputRef={sharedInputRef}
          timingMeterRef={timingMeterRef}
          matchConfig={activeMatchConfig}
          batSkin={effectiveBatSkin}
          isPaused={isGameMenuOpen || isHowToPlayOpen}
          onTogglePauseMenu={() => setIsGameMenuOpen((prev) => !prev)}
          onHudUpdate={setHud}
          onMatchEnd={handleMatchEnd}
        />

        {/* Collapsible Top-Left Quick Controls Legend Card */}
        {gameState.status === 'PLAYING' &&
          isControlsLegendOpen &&
          !isGameMenuOpen &&
          !isHowToPlayOpen && (
            <div className="absolute top-2.5 left-3 z-30 w-72 bg-slate-950/92 border border-sky-400/70 rounded-xl p-3 shadow-2xl text-xs text-slate-200 pointer-events-auto">
              <div className="flex items-center justify-between border-b border-slate-800 pb-1.5 mb-2">
                <span className="font-black text-sky-300 tracking-wider uppercase">
                  Shot Chart &amp; Running Keys
                </span>
                <button
                  type="button"
                  onClick={() => setIsControlsLegendOpen(false)}
                  className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold">
                  Close
                </button>
              </div>
              <div className="flex flex-col gap-1.5 leading-snug">
                <div>
                  <span className="text-amber-300 font-black">
                    A / ← · W / ↑ · D / →
                  </span>{' '}
                  — Aim Shot Chart (Leg · Straight · Off)
                </div>
                <div>
                  <span className="text-amber-400 font-black">Space</span> —
                  Lofted Power Shot (6s &amp; 4s)
                </div>
                <div>
                  <span className="text-emerald-400 font-black">S / ↓</span> —
                  Grounded Drive (Safe turf gaps)
                </div>
                <div>
                  <span className="text-sky-400 font-black">Q / Shift</span> —
                  Defensive Block (Survive yorkers)
                </div>
                <div className="border-t border-slate-800 pt-1.5 mt-0.5">
                  <span className="text-emerald-300 font-black">R / Enter</span>{' '}
                  — Call Extra Run (+1) in outfield
                </div>
                <div>
                  <span className="text-rose-400 font-black">C</span> — Cancel
                  Run &amp; dive back to crease
                </div>
              </div>
            </div>
          )}

        {/* Slim Non-Obstructing Broadcast Callout Banner (SIX!, FOUR!, BOWLED!, RUN OUT!) */}
        {gameState.status === 'PLAYING' &&
          visibleCalloutId > 0 &&
          hud.calloutText && (
            <div className="absolute top-3 inset-x-0 flex justify-center pointer-events-none z-10 px-4">
              <div
                style={{borderColor: hud.calloutColor}}
                className="bg-slate-950/85 border-2 rounded-xl px-3 py-1 shadow-xl flex items-center gap-2">
                <span
                  style={{color: hud.calloutColor}}
                  className="text-sm font-black tracking-wider uppercase">
                  {hud.calloutText}
                </span>
                {hud.calloutSubtext && (
                  <span className="text-xs font-bold text-slate-300">
                    {hud.calloutSubtext}
                  </span>
                )}
              </div>
            </div>
          )}

        {/* Unified On-Screen Touch, Mouse & Keyboard Control Bar (Always Active in PLAYING) */}
        {gameState.status === 'PLAYING' &&
          !isGameMenuOpen &&
          !isHowToPlayOpen && (
            <InteractiveHudControls
              inputRef={sharedInputRef}
              timingMeterRef={timingMeterRef}
              activeAim={hud.aimDirection}
              actionMode={hud.actionMode}
              completedRunsThisBall={hud.completedRunsThisBall}
              canCallExtraRun={hud.canCallExtraRun}
              canCancelRun={hud.canCancelRun}
              throwInFlight={hud.throwInFlight}
              onSelectAim={(dir) => {
                gameAudio.playCrispClick();
                setHud((prev) => ({...prev, aimDirection: dir}));
              }}
            />
          )}
      </div>

      {/* =====================================================================
          START SCREEN: MODE SELECTOR, 8-TEAM FRANCHISE PICKER & BRACKET/LADDER
         ===================================================================== */}
      {gameState.status === 'START' && !autoStartPending && (
        <MenuOverlay tone="neutral" zIndex={40}>
          <div className="w-full max-w-xl bg-slate-900 border-2 border-amber-400/60 rounded-2xl p-5 md:p-6 shadow-2xl flex flex-col gap-4 text-white">
            {/* Title Header */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3">
              <div>
                <h1
                  style={{fontFamily: "'Teko', sans-serif"}}
                  className="text-4xl md:text-5xl font-bold tracking-wide text-amber-400 leading-none">
                  {getConfig('title')}
                </h1>
                <p className="text-xs text-slate-300 mt-0.5">
                  3D Floodlit Stadium Cricket · Read Swing &amp; Spin · Smash Sixes
                </p>
              </div>
              <div className="flex items-center gap-2">
                <div className="bg-slate-800 border border-amber-400/40 rounded-lg px-2.5 py-1 text-xs font-bold text-amber-300 flex items-center gap-1">
                  <Trophy size={14} />
                  {tourneyData.trophiesWon} Trophies
                </div>
                <button
                  type="button"
                  onClick={() => {
                    gameAudio.playCrispClick();
                    setIsHowToPlayOpen(true);
                  }}
                  className="min-w-[48px] min-h-[48px] px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-600 text-xs font-bold text-sky-300 flex items-center gap-1">
                  <Info size={15} />
                  Guide
                </button>
              </div>
            </div>

            {/* Mode Tabs: 8-Team Knockout Tournament vs 50-Level Campaign */}
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => {
                  gameAudio.playCrispClick();
                  setSelectedMode('TOURNAMENT');
                }}
                className={`min-h-[48px] px-3 py-2 rounded-xl font-black text-sm tracking-wide border-2 transition-colors flex items-center justify-center gap-1.5 ${
                  selectedMode === 'TOURNAMENT'
                    ? 'bg-amber-400 text-slate-950 border-amber-200'
                    : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'
                }`}>
                <Trophy size={16} />
                8-TEAM TOURNAMENT
              </button>
              <button
                type="button"
                onClick={() => {
                  gameAudio.playCrispClick();
                  setSelectedMode('CAMPAIGN');
                }}
                className={`min-h-[48px] px-3 py-2 rounded-xl font-black text-sm tracking-wide border-2 transition-colors flex items-center justify-center gap-1.5 ${
                  selectedMode === 'CAMPAIGN'
                    ? 'bg-emerald-400 text-slate-950 border-emerald-200'
                    : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'
                }`}>
                <Zap size={16} />
                50-LEVEL CAMPAIGN ({totalStarsEarned}★)
              </button>
            </div>

            {/* 8 Franchise Kit Picker */}
            <div>
              <div className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-1">
                Select Your Squad Kit
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                {TEAM_LIST.map((team) => {
                  const active = activeTeamId === team.id;
                  return (
                    <button
                      key={team.id}
                      type="button"
                      onClick={() => handleSelectTeam(team.id)}
                      className={`min-h-[48px] px-2.5 py-1.5 rounded-xl border-2 text-left transition-transform flex items-center gap-2 ${
                        active
                          ? 'bg-slate-800 border-amber-400 scale-[1.02]'
                          : 'bg-slate-950/70 border-slate-800 hover:border-slate-600'
                      }`}>
                      <span
                        style={{
                          background: `linear-gradient(135deg, ${team.primaryColor} 55%, ${team.secondaryColor} 55%)`,
                        }}
                        className="w-5 h-5 rounded-full shrink-0 border border-white/40"
                      />
                      <span className="text-xs font-black tracking-wide truncate text-white">
                        {team.name}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Compact 5-Option 3D Bat Skin Selector Pill Strip */}
            <div>
              <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-slate-400 mb-1">
                <span>3D Willow Bat Skin</span>
                <span className="text-amber-300 font-black">
                  {BAT_SKINS[effectiveBatSkin].name}
                </span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-1.5">
                {BAT_SKIN_LIST.map((skin) => {
                  const unlocked = isBatSkinUnlocked(
                    skin.id,
                    tourneyData.trophiesWon,
                    campaignData.unlockedLevel,
                  );
                  const isActive = effectiveBatSkin === skin.id;
                  const activeTeamMeta = TEAMS[activeTeamId];
                  const swatchA =
                    skin.id === 'FRANCHISE_PRO'
                      ? activeTeamMeta.primaryColor
                      : skin.swatchPrimary;
                  const swatchB =
                    skin.id === 'FRANCHISE_PRO'
                      ? activeTeamMeta.secondaryColor
                      : skin.swatchSecondary;
                  return (
                    <button
                      key={skin.id}
                      type="button"
                      disabled={!unlocked}
                      onClick={() => {
                        if (!unlocked) return;
                        gameAudio.playCrispClick();
                        setSelectedBatSkin(skin.id);
                        saveBatSkin(skin.id);
                      }}
                      className={`min-h-[48px] px-2 py-1 rounded-full border text-left transition-colors flex items-center gap-1.5 ${
                        isActive
                          ? 'bg-amber-400/20 border-amber-400 text-white'
                          : unlocked
                            ? 'bg-slate-950/80 border-slate-700 hover:border-slate-500 text-slate-200'
                            : 'bg-slate-950/40 border-slate-800/80 text-slate-500 cursor-not-allowed'
                      }`}>
                      <span
                        style={{
                          background: `linear-gradient(135deg, ${swatchA} 55%, ${swatchB} 55%)`,
                        }}
                        className="w-4 h-4 rounded-full shrink-0 border border-white/40"
                      />
                      <span className="flex flex-col min-w-0 leading-tight">
                        <span className="text-[11px] font-black truncate">
                          {skin.shortLabel}
                        </span>
                        {!unlocked && (
                          <span className="text-[9px] font-bold text-amber-400/80 truncate">
                            {skin.unlockHint}
                          </span>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Mode Content Panel: Visual 8-Team Bracket OR 50-Stage Ladder */}
            {selectedMode === 'TOURNAMENT' ? (
              <div className="bg-slate-950/90 border border-slate-800 rounded-xl p-3 flex flex-col gap-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-black uppercase tracking-wider text-amber-300">
                    Knockout Bracket ·{' '}
                    {tourneyData.champion
                      ? `${tourneyData.champion} Champions!`
                      : tourneyData.currentRound === 0
                        ? 'Quarterfinals (2 Overs)'
                        : tourneyData.currentRound === 1
                          ? 'Semifinals (3 Overs)'
                          : 'Grand Final (5 Overs)'}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      gameAudio.playCrispClick();
                      const fresh = createFreshTournamentBracket(
                        tourneyData.playerTeam,
                        tourneyData.trophiesWon,
                      );
                      setTourneyData(fresh);
                      saveTournamentData(fresh);
                    }}
                    className="min-w-[48px] min-h-[48px] px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-bold text-slate-300">
                    Reset Draw
                  </button>
                </div>

                {/* 3-Column Visual Bracket: QF -> SF -> FINAL */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                  {/* Quarterfinals */}
                  <div className="flex flex-col gap-1.5">
                    <div className="text-[11px] font-bold text-slate-400 uppercase">
                      Quarterfinals
                    </div>
                    {tourneyData.quarterfinals.map((qf) => {
                      const involvesPlayer =
                        qf.teamA === tourneyData.playerTeam ||
                        qf.teamB === tourneyData.playerTeam;
                      return (
                        <div
                          key={qf.id}
                          className={`rounded-lg px-2 py-1 border ${
                            involvesPlayer
                              ? 'bg-slate-800/90 border-amber-400/60'
                              : 'bg-slate-900 border-slate-800'
                          }`}>
                          <div className="flex justify-between font-bold">
                            <span
                              className={
                                qf.winner === qf.teamA
                                  ? 'text-emerald-400'
                                  : 'text-slate-200'
                              }>
                              {TEAMS[qf.teamA].shortName}
                            </span>
                            <span className="text-slate-400">
                              {qf.scoreA ?? '-'}
                            </span>
                          </div>
                          <div className="flex justify-between font-bold">
                            <span
                              className={
                                qf.winner === qf.teamB
                                  ? 'text-emerald-400'
                                  : 'text-slate-200'
                              }>
                              {TEAMS[qf.teamB].shortName}
                            </span>
                            <span className="text-slate-400">
                              {qf.scoreB ?? '-'}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Semifinals */}
                  <div className="flex flex-col gap-1.5 justify-center">
                    <div className="text-[11px] font-bold text-slate-400 uppercase">
                      Semifinals
                    </div>
                    {[0, 1].map((idx) => {
                      const sf = tourneyData.semifinals[idx];
                      return (
                        <div
                          key={idx}
                          className="rounded-lg px-2 py-1.5 bg-slate-900 border border-slate-800">
                          {sf ? (
                            <>
                              <div className="flex justify-between font-bold">
                                <span
                                  className={
                                    sf.winner === sf.teamA
                                      ? 'text-emerald-400'
                                      : 'text-slate-200'
                                  }>
                                  {TEAMS[sf.teamA].shortName}
                                </span>
                                <span className="text-slate-400">
                                  {sf.scoreA ?? '-'}
                                </span>
                              </div>
                              <div className="flex justify-between font-bold">
                                <span
                                  className={
                                    sf.winner === sf.teamB
                                      ? 'text-emerald-400'
                                      : 'text-slate-200'
                                  }>
                                  {TEAMS[sf.teamB].shortName}
                                </span>
                                <span className="text-slate-400">
                                  {sf.scoreB ?? '-'}
                                </span>
                              </div>
                            </>
                          ) : (
                            <div className="text-slate-500 text-center py-1">
                              TBD vs TBD
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* Grand Final */}
                  <div className="flex flex-col gap-1.5 justify-center">
                    <div className="text-[11px] font-bold text-amber-400 uppercase">
                      Grand Final
                    </div>
                    <div className="rounded-lg px-2.5 py-2 bg-slate-900 border-2 border-amber-400/40">
                      {tourneyData.finalMatch ? (
                        <>
                          <div className="flex justify-between font-black">
                            <span className="text-white">
                              {TEAMS[tourneyData.finalMatch.teamA].shortName}
                            </span>
                            <span className="text-amber-300">
                              {tourneyData.finalMatch.scoreA ?? '-'}
                            </span>
                          </div>
                          <div className="flex justify-between font-black mt-0.5">
                            <span className="text-white">
                              {TEAMS[tourneyData.finalMatch.teamB].shortName}
                            </span>
                            <span className="text-amber-300">
                              {tourneyData.finalMatch.scoreB ?? '-'}
                            </span>
                          </div>
                        </>
                      ) : (
                        <div className="text-slate-500 text-center py-2">
                          Awaiting Finalists
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              /* 50-Level Progressive Campaign Stage Selector */
              <div className="bg-slate-950/90 border border-slate-800 rounded-xl p-3 flex flex-col gap-2.5">
                <div className="flex flex-wrap items-center justify-between gap-1">
                  <span className="text-xs font-black uppercase tracking-wider text-emerald-400">
                    Stage {selectedCampaignStage} / 50 ·Unlocked:{' '}
                    {campaignData.unlockedLevel}
                  </span>
                  <div className="flex flex-wrap gap-1">
                    {[0, 1, 2, 3, 4].map((tier) => {
                      const label = `${tier * 10 + 1}-${(tier + 1) * 10}`;
                      return (
                        <button
                          key={tier}
                          type="button"
                          onClick={() => {
                            gameAudio.playCrispClick();
                            setCampaignTierTab(tier);
                          }}
                          className={`min-w-[48px] min-h-[48px] px-2 py-1 rounded-lg text-xs font-bold border ${
                            campaignTierTab === tier
                              ? 'bg-emerald-500 text-slate-950 border-emerald-200'
                              : 'bg-slate-800 text-slate-300 border-slate-700'
                          }`}>
                          {label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="grid grid-cols-5 gap-1.5">
                  {Array.from({length: 10}, (_, i) => {
                    const lvl = campaignTierTab * 10 + i + 1;
                    const unlocked = lvl <= campaignData.unlockedLevel;
                    const stars = campaignData.starsByLevel[lvl] || 0;
                    const selected = selectedCampaignStage === lvl;
                    return (
                      <button
                        key={lvl}
                        type="button"
                        disabled={!unlocked}
                        onClick={() => {
                          gameAudio.playCrispClick();
                          setSelectedCampaignStage(lvl);
                        }}
                        className={`min-h-[48px] rounded-lg border flex flex-col items-center justify-center p-1 transition-colors ${
                          selected
                            ? 'bg-emerald-500 text-slate-950 border-white font-black'
                            : unlocked
                              ? 'bg-slate-800 text-white border-slate-600 hover:bg-slate-700 font-bold'
                              : 'bg-slate-900/50 text-slate-600 border-slate-800 cursor-not-allowed'
                        }`}>
                        <span className="text-xs leading-none">{lvl}</span>
                        <span className="text-[10px] mt-0.5 text-amber-300">
                          {unlocked
                            ? `${'★'.repeat(stars)}${'☆'.repeat(3 - stars)}`
                            : 'LOCKED'}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Primary Start Match Action Button */}
            <button
              type="button"
              onClick={() => {
                gameAudio.playConfirmSelect();
                initGame();
              }}
              autoFocus
              data-testid="start-button"
              className="w-full min-h-[52px] bg-amber-400 hover:bg-amber-300 text-slate-950 px-6 py-3 rounded-xl font-black text-xl tracking-wider uppercase transition-colors flex items-center justify-center gap-2 shadow-lg">
              <Play size={22} />
              {selectedMode === 'TOURNAMENT'
                ? tourneyData.champion
                  ? 'START NEW TOURNAMENT'
                  : `PLAY ${
                      tourneyData.currentRound === 0
                        ? 'QUARTERFINAL'
                        : tourneyData.currentRound === 1
                          ? 'SEMIFINAL'
                          : 'GRAND FINAL'
                    }`
                : `PLAY STAGE ${selectedCampaignStage}`}
            </button>
          </div>
        </MenuOverlay>
      )}

      {/* =====================================================================
          GAME MENU OVERLAY (Paused while keeping gameState.status === 'PLAYING')
          Music & SFX Toggles reside strictly inside this Game Menu!
         ===================================================================== */}
      {gameState.status === 'PLAYING' && isGameMenuOpen && (
        <MenuOverlay tone="neutral" zIndex={1000}>
          <div className="w-full max-w-md bg-slate-900 border-2 border-amber-400/70 rounded-2xl p-6 shadow-2xl flex flex-col items-center gap-3.5 text-white">
            <h2
              style={{fontFamily: "'Teko', sans-serif", fontSize: '48px'}}
              className="font-bold text-amber-400 leading-none tracking-wide text-center">
              GAME MENU
            </h2>
            <p className="text-sm text-slate-300 text-center -mt-1">
              {activeMatchConfig.roundLabel} · {playerMatchTeam.name} vs{' '}
              {oppMatchTeam.name}
            </p>

            {/* Resume */}
            <button
              type="button"
              autoFocus
              onClick={() => {
                gameAudio.playCrispClick();
                setIsGameMenuOpen(false);
              }}
              style={{fontSize: '22px'}}
              className="w-full min-h-[48px] bg-amber-400 hover:bg-amber-300 text-slate-950 font-black rounded-xl py-2.5 px-5 flex items-center justify-center gap-2 transition-colors">
              <Play size={20} />
              Resume Match
            </button>

            {/* Independent Music & SFX Toggles (Strictly inside Game Menu) */}
            <div className="w-full grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => {
                  setIsMusicMuted((prev) => !prev);
                }}
                className="min-h-[48px] bg-slate-800 hover:bg-slate-700 border border-slate-600 rounded-xl px-3 py-2 font-bold text-base text-sky-300 flex items-center justify-center gap-2">
                {isMusicMuted ? <VolumeX size={18} /> : <Volume2 size={18} />}
                Music: {isMusicMuted ? 'Off' : 'On'}
              </button>
              <button
                type="button"
                onClick={() => {
                  const mutedNow = gameAudio.toggleMute();
                  setIsSfxMuted(mutedNow);
                  if (!mutedNow) gameAudio.playCrispClick();
                }}
                className="min-h-[48px] bg-slate-800 hover:bg-slate-700 border border-slate-600 rounded-xl px-3 py-2 font-bold text-base text-emerald-300 flex items-center justify-center gap-2">
                {isSfxMuted ? <VolumeX size={18} /> : <Volume2 size={18} />}
                SFX: {isSfxMuted ? 'Off' : 'On'}
              </button>
            </div>

            {/* Try Level Again */}
            <button
              type="button"
              onClick={() => {
                gameAudio.playConfirmSelect();
                setIsGameMenuOpen(false);
                startRun(
                  gameStateRef.current.level,
                  levelStartScoreRef.current,
                  activeMatchConfig,
                );
              }}
              style={{fontSize: '20px'}}
              className="w-full min-h-[48px] bg-slate-800 hover:bg-slate-700 border border-slate-600 text-white font-bold rounded-xl py-2.5 px-5 flex items-center justify-center gap-2">
              <RotateCw size={18} />
              Try Level Again
            </button>

            {/* How to Play */}
            <button
              type="button"
              onClick={() => {
                gameAudio.playCrispClick();
                setIsHowToPlayOpen(true);
              }}
              style={{fontSize: '20px'}}
              className="w-full min-h-[48px] bg-slate-800 hover:bg-slate-700 border border-slate-600 text-amber-200 font-bold rounded-xl py-2.5 px-5 flex items-center justify-center gap-2">
              <Info size={18} />
              How to Play
            </button>

            {/* Quit to Menu */}
            <button
              type="button"
              onClick={() => {
                gameAudio.playCrispClick();
                setIsGameMenuOpen(false);
                setIsHowToPlayOpen(false);
                setGameState((prev) => ({...prev, status: 'START'}));
              }}
              style={{fontSize: '20px'}}
              className="w-full min-h-[48px] bg-rose-950/90 hover:bg-rose-800 border border-rose-500/60 text-rose-200 font-bold rounded-xl py-2.5 px-5 flex items-center justify-center gap-2">
              <Home size={18} />
              Quit to Menu
            </button>
          </div>
        </MenuOverlay>
      )}

      {/* =====================================================================
          HOW TO PLAY GUIDE (z-index 1001 with heavy 0.92 backdrop darkening;
          returns cleanly to whichever screen opened it)
         ===================================================================== */}
      {isHowToPlayOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="how-to-play-heading"
          data-overlay-container=""
          data-playground-modal="true"
          style={{zIndex: 1001, backgroundColor: 'rgba(0, 0, 0, 0.92)'}}
          className="fixed inset-0 overflow-y-auto touch-auto">
          <div className="min-h-full flex flex-col items-center p-4">
            <div className="m-auto w-full max-w-md bg-slate-900 border-2 border-sky-400/70 rounded-2xl p-6 shadow-2xl flex flex-col gap-4 text-white">
              <h2
                id="how-to-play-heading"
                style={{fontFamily: "'Teko', sans-serif"}}
                className="text-4xl font-bold text-sky-300 tracking-wide text-center leading-none">
                HOW TO PLAY
              </h2>

              <div className="flex flex-col gap-2.5 text-sm text-slate-200">
                <div className="bg-slate-950 border border-slate-800 rounded-xl p-3">
                  <div className="font-black text-amber-400 mb-1">
                    1. READ THE PITCH RING
                  </div>
                  Watch the glowing 3D ring on the clay strip: Cyan = Fast Seam,
                  Amber = Swing in the air, Violet = Sharp Spin after bounce,
                  Crimson = Toe-crushing Yorker!
                </div>

                <div className="bg-slate-950 border border-slate-800 rounded-xl p-3">
                  <div className="font-black text-emerald-400 mb-1">
                    2. SHOT CHART &amp; SWING CONTROLS
                  </div>
                  {isMobile ? (
                    <span>
                      Tap <b>&lt; LEG</b>, <b>^ STRAIGHT</b>, or{' '}
                      <b>OFF &gt;</b> to aim your 3D Shot Chart, then tap{' '}
                      <b>LOFTED (6/4)</b>, <b>GROUND (Drive)</b>, or{' '}
                      <b>DEFEND</b> right in the green <b>PERFECT</b> timing
                      zone!
                    </span>
                  ) : (
                    <span>
                      Aim your 3D Shot Chart with <b>A / ←</b> (Leg),{' '}
                      <b>W / ↑</b> (Straight), or <b>D / →</b> (Off). Swing with{' '}
                      <b>Space</b> (Lofted 6/4), <b>S / ↓</b> (Grounded Drive),
                      or <b>Q / Shift</b> (Defend)!
                    </span>
                  )}
                </div>

                <div className="bg-slate-950 border border-slate-800 rounded-xl p-3">
                  <div className="font-black text-sky-400 mb-1">
                    3. RUNNING BETWEEN THE WICKETS
                  </div>
                  Batters sprint the 1st run automatically on outfield hits.
                  Press <b>R / Enter</b> (or tap <b>RUN (+1)</b>) to push for a
                  2nd or 3rd run, or <b>C / CANCEL</b> to dive back before the
                  fielder&apos;s throw hits the stumps for a <b>RUN OUT!</b>
                </div>
              </div>

              <button
                type="button"
                autoFocus
                onClick={() => {
                  gameAudio.playCrispClick();
                  setIsHowToPlayOpen(false);
                }}
                className="w-full min-h-[48px] bg-sky-400 hover:bg-sky-300 text-slate-950 font-black text-lg rounded-xl py-2.5 px-5 transition-colors">
                CLOSE
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          MATCH COMPLETE (INTERMEDIATE STAGE / BRACKET ROUND ADVANCEMENT)
         ===================================================================== */}
      {gameState.status === 'LEVEL_COMPLETE' && (
        <MenuOverlay tone="victory" zIndex={50}>
          <div className="w-full max-w-md bg-slate-900 border-2 border-emerald-400 rounded-2xl p-6 shadow-2xl flex flex-col items-center gap-4 text-white">
            <h2
              style={{fontFamily: "'Teko', sans-serif"}}
              className="text-4xl font-bold text-emerald-400 text-center leading-none">
              {lastMatchSummary.headline}
            </h2>
            <div className="text-2xl text-amber-400 tracking-widest">
              {'★'.repeat(lastMatchSummary.starsEarned)}
              {'☆'.repeat(3 - lastMatchSummary.starsEarned)}
            </div>
            <p className="text-sm text-slate-200 text-center">
              {lastMatchSummary.detail}
            </p>
            <div className="text-xs font-bold text-slate-400">
              Total Score: {gameState.score} pts
            </div>

            <button
              type="button"
              autoFocus
              data-testid="start-button"
              onClick={handleNextMatch}
              className="w-full min-h-[50px] bg-emerald-400 hover:bg-emerald-300 text-slate-950 font-black text-lg rounded-xl py-3 px-6 flex items-center justify-center gap-2">
              <Play size={20} />
              {selectedMode === 'TOURNAMENT' ? 'NEXT ROUND' : 'NEXT STAGE'}
            </button>
            <button
              type="button"
              onClick={() => {
                gameAudio.playCrispClick();
                setGameState((prev) => ({...prev, status: 'START'}));
              }}
              className="w-full min-h-[48px] bg-slate-800 hover:bg-slate-700 border border-slate-600 text-slate-200 font-bold text-sm rounded-xl py-2.5 px-5">
              Back to Hub &amp; Bracket
            </button>
          </div>
        </MenuOverlay>
      )}

      {/* =====================================================================
          GAME OVER (CHASE FAILED)
         ===================================================================== */}
      {gameState.status === 'GAME_OVER' && (
        <MenuOverlay tone="danger" zIndex={50}>
          <div className="w-full max-w-md bg-slate-900 border-2 border-rose-500 rounded-2xl p-6 shadow-2xl flex flex-col items-center gap-4 text-white">
            <h2
              style={{fontFamily: "'Teko', sans-serif"}}
              className="text-4xl font-bold text-rose-400 text-center leading-none">
              INNINGS ENDED
            </h2>
            <p className="text-base font-bold text-amber-300 text-center">
              {lastMatchSummary.headline}
            </p>
            <p className="text-sm text-slate-300 text-center">
              {lastMatchSummary.detail}
            </p>
            <div className="text-xs font-bold text-slate-400">
              Total Score: {gameState.score} pts
            </div>

            <button
              type="button"
              autoFocus
              data-testid="start-button"
              onClick={() => {
                gameAudio.playConfirmSelect();
                initGame();
              }}
              className="w-full min-h-[50px] bg-white hover:bg-amber-400 text-slate-950 font-black text-lg rounded-xl py-3 px-6 flex items-center justify-center gap-2 transition-colors">
              <RotateCw size={20} />
              TRY AGAIN
            </button>
            <button
              type="button"
              onClick={() => {
                gameAudio.playCrispClick();
                setGameState((prev) => ({...prev, status: 'START'}));
              }}
              className="w-full min-h-[48px] bg-slate-800 hover:bg-slate-700 border border-slate-600 text-slate-200 font-bold text-sm rounded-xl py-2.5 px-5">
              Main Menu
            </button>
          </div>
        </MenuOverlay>
      )}

      {/* =====================================================================
          VICTORY (CHAMPIONSHIP TROPHY / STAGE 50 CONQUERED)
         ===================================================================== */}
      {gameState.status === 'VICTORY' && (
        <MenuOverlay tone="victory" zIndex={50}>
          <div className="w-full max-w-md bg-slate-900 border-2 border-amber-400 rounded-2xl p-6 shadow-2xl flex flex-col items-center gap-4 text-white">
            <Trophy size={48} className="text-amber-400" />
            <h2
              style={{fontFamily: "'Teko', sans-serif"}}
              className="text-5xl font-bold text-amber-400 text-center leading-none">
              CHAMPIONS!
            </h2>
            <p className="text-base font-bold text-emerald-300 text-center">
              {lastMatchSummary.headline}
            </p>
            <p className="text-sm text-slate-300 text-center">
              {lastMatchSummary.detail}
            </p>
            <div className="text-sm font-black text-amber-200">
              Final Score: {gameState.score} pts · Trophies:{' '}
              {tourneyData.trophiesWon}
            </div>

            <button
              type="button"
              autoFocus
              data-testid="start-button"
              onClick={() => {
                gameAudio.playConfirmSelect();
                resetGame();
              }}
              className="w-full min-h-[50px] bg-amber-400 hover:bg-amber-300 text-slate-950 font-black text-lg rounded-xl py-3 px-6 flex items-center justify-center gap-2 transition-colors">
              <RotateCw size={20} />
              PLAY AGAIN
            </button>
            <button
              type="button"
              onClick={() => {
                gameAudio.playCrispClick();
                setGameState((prev) => ({...prev, status: 'START'}));
              }}
              className="w-full min-h-[48px] bg-slate-800 hover:bg-slate-700 border border-slate-600 text-slate-200 font-bold text-sm rounded-xl py-2.5 px-5">
              Main Menu
            </button>
          </div>
        </MenuOverlay>
      )}
    </div>
  );
}
