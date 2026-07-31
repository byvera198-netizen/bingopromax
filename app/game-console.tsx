"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  Award,
  BookOpen,
  Check,
  ChevronRight,
  CircleGauge,
  Clock3,
  Download,
  FileCheck2,
  FileSpreadsheet,
  FileText,
  Gamepad2,
  Grid3X3,
  History,
  LayoutDashboard,
  LoaderCircle,
  Menu,
  MessageCircle,
  Moon,
  MoreHorizontal,
  Pause,
  PencilLine,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  SquarePen,
  Sun,
  Trash2,
  Trophy,
  UploadCloud,
  UserRound,
  Volume2,
  VolumeX,
  X,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import {
  BUILTIN_PATTERNS,
  COMPACT_CARD_PATTERN,
  cardProgress,
  formatDuration,
  patternsForCard,
  validateCardGrid,
  winningPatternsForCard,
  type AppState,
  type AccessState,
  type BingoCard,
  type BingoPattern,
  type Draw,
  type Game,
  type Membership,
  type Winner,
} from "@/lib/bingo";
import { fileChecksum, parseBingoPdf, type PdfParseProgress } from "@/lib/pdf-parser";
import { authorizationHeaders, supabase } from "@/lib/supabase-client";

type View = "dashboard" | "cards" | "patterns" | "reports" | "memberships";
type Toast = { id: string; tone: "success" | "warning" | "error"; message: string };

const initialGrid: string[] = Array.from({ length: 25 }, (_, index) => (index === 12 ? "0" : ""));
const BINGO = ["B", "I", "N", "G", "O"];
const WHATSAPP_NUMBER = "593985280991";

function deviceId() {
  const key = "bingo-device-id";
  let id = localStorage.getItem(key);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(key, id);
  }
  return id;
}

async function api<T>(body: Record<string, unknown>): Promise<T> {
  const authorization = await authorizationHeaders();
  const response = await fetch("/api/state", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-device-id": deviceId(),
      ...authorization,
    },
    body: JSON.stringify(body),
  });
  const payload = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error || "No se pudo completar la operación.");
  return payload;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function StatCard({
  label,
  value,
  detail,
  icon: Icon,
  accent = "lime",
}: {
  label: string;
  value: string | number;
  detail: string;
  icon: typeof Activity;
  accent?: "lime" | "mint" | "amber" | "blue";
}) {
  return (
    <article className={`stat-card stat-${accent}`}>
      <div className="stat-top">
        <span className="stat-icon"><Icon size={18} /></span>
        <span className="live-dot"><i /> En vivo</span>
      </div>
      <strong>{value}</strong>
      <span>{label}</span>
      <small>{detail}</small>
    </article>
  );
}

function BingoGrid({
  grid,
  called,
  pattern,
  compact = false,
  editable = false,
  selected = [],
  showPending = true,
  onCellClick,
}: {
  grid?: number[];
  called?: Set<number>;
  pattern?: BingoPattern;
  compact?: boolean;
  editable?: boolean;
  selected?: number[];
  showPending?: boolean;
  onCellClick?: (index: number) => void;
}) {
  if (grid?.length === 5) {
    return (
      <div className={`compact-card-grid ${compact ? "compact" : ""} ${showPending ? "" : "hide-pending"}`}>
        <span className="compact-card-title">SABROSITO</span>
        <div className="compact-number-grid">
          {grid.map((value, index) => {
            const marked = Boolean(called?.has(value));
            return (
              <button
                aria-label={`Número ${value}`}
                className={`bingo-cell target ${marked ? "marked" : ""}`}
                disabled
                key={`${index}-${value}`}
                type="button"
              >
                {value}
              </button>
            );
          })}
        </div>
      </div>
    );
  }
  return (
    <div className={`bingo-grid ${compact ? "compact" : ""} ${editable ? "editable" : ""} ${showPending ? "" : "hide-pending"}`}>
      {BINGO.map((letter) => <span className="bingo-head" key={letter}>{letter}</span>)}
      {Array.from({ length: 25 }, (_, index) => {
        const value = grid?.[index] ?? index + 1;
        const isFree = grid?.[index] === 0;
        const marked = Boolean(isFree || (grid && called?.has(value)));
        const target = Boolean(pattern?.cells.includes(index) || selected.includes(index));
        return (
          <button
            className={`bingo-cell ${marked ? "marked" : ""} ${target ? "target" : ""}`}
            disabled={!editable}
            key={index}
            onClick={() => onCellClick?.(index)}
            type="button"
            aria-label={editable ? `Casilla ${index + 1}` : isFree ? "Casilla libre" : `Número ${value}`}
          >
            {editable ? (selected.includes(index) ? <Check size={16} /> : "") : isFree ? "LIBRE" : value}
          </button>
        );
      })}
    </div>
  );
}

function nearestPatternForCard(
  card: BingoCard,
  called: Set<number>,
  patterns: BingoPattern[],
  wins: Winner[] = [],
) {
  const applicablePatterns = patternsForCard(card, patterns);
  const wonPatternIds = new Set(wins.map((winner) => winner.patternId));
  const pendingPatterns = applicablePatterns.filter(
    (pattern) => !wonPatternIds.has(pattern.id),
  );
  const progressOptions = (pendingPatterns.length
    ? pendingPatterns
    : applicablePatterns
  ).map((pattern) => ({
    pattern,
    progress: cardProgress(card, called, pattern),
  }));
  return (
    progressOptions.sort(
      (a, b) => b.progress.progress - a.progress.progress,
    )[0] ?? {
      pattern: applicablePatterns[0] ?? BUILTIN_PATTERNS[0],
      progress: { completed: 0, total: 0, progress: 0 },
    }
  );
}

function CardPreview({
  card,
  called,
  patterns,
  wins = [],
  onToggleStatus,
  onDelete,
  showCalled = true,
  showPattern = true,
  showPending = true,
}: {
  card: BingoCard;
  called: Set<number>;
  patterns: BingoPattern[];
  wins?: Winner[];
  onToggleStatus: (card: BingoCard) => void;
  onDelete?: (card: BingoCard) => void;
  showCalled?: boolean;
  showPattern?: boolean;
  showPending?: boolean;
}) {
  const wonPatternIds = new Set(wins.map((winner) => winner.patternId));
  const nearest = nearestPatternForCard(card, called, patterns, wins);
  return (
    <article className={`ticket ${card.status === "void" ? "ticket-void" : ""}`}>
      <header>
        <div>
          <span>Cartón</span>
          <strong>#{card.number}</strong>
        </div>
        <div className="ticket-actions">
          <button className="icon-button small" title={card.status === "active" ? "Anular cartón" : "Reactivar cartón"} type="button" onClick={() => onToggleStatus(card)}>
            <MoreHorizontal size={17} />
          </button>
          {onDelete && (
            <button className="icon-button small danger-button" title="Eliminar cartón" type="button" onClick={() => onDelete(card)}>
              <Trash2 size={15} />
            </button>
          )}
        </div>
      </header>
      {wins.length > 0 && (
        <div className="ticket-wins">
          <Trophy size={12} />
          <span>Ganó {wins.map((winner) => winner.patternName).join(", ")}</span>
          <b>Sigue activo</b>
        </div>
      )}
      <BingoGrid
        grid={card.grid}
        called={showCalled ? called : new Set<number>()}
        pattern={showPattern ? nearest.pattern : undefined}
        compact
        showPending={showPending}
      />
      <div className="ticket-next-pattern">
        <span>{wonPatternIds.size ? "Siguiente" : "Más cerca"}</span>
        <b>{nearest.pattern.name}</b>
      </div>
      <div className="ticket-progress">
        <span><i style={{ width: `${Math.round(nearest.progress.progress * 100)}%` }} /></span>
        <b>{Math.round(nearest.progress.progress * 100)}%</b>
      </div>
      <footer>
        <span>{card.sourceFile}</span>
        <span>{card.sourcePage ? `Pág. ${card.sourcePage}` : "Manual"}</span>
      </footer>
      {card.status === "void" && <div className="void-stamp">ANULADO</div>}
    </article>
  );
}

function PatternMini({ pattern }: { pattern: BingoPattern }) {
  return (
    <div className="pattern-mini" style={{ "--pattern-color": pattern.color } as React.CSSProperties}>
      {Array.from({ length: 25 }, (_, index) => (
        <i className={pattern.cells.includes(index) ? "on" : ""} key={index} />
      ))}
    </div>
  );
}

function EmptyState({
  icon: Icon,
  title,
  text,
  action,
}: {
  icon: typeof Activity;
  title: string;
  text: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty-state">
      <span><Icon size={25} /></span>
      <strong>{title}</strong>
      <p>{text}</p>
      {action}
    </div>
  );
}

export default function GameConsole() {
  const [state, setState] = useState<AppState | null>(null);
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [authMode, setAuthMode] = useState<"login" | "register" | "recover" | "update">("login");
  const [authName, setAuthName] = useState("");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authMessage, setAuthMessage] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [access, setAccess] = useState<AccessState | null>(null);
  const [view, setView] = useState<View>("dashboard");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [ballInput, setBallInput] = useState("");
  const [ballBoardOpen, setBallBoardOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [patternOpen, setPatternOpen] = useState(false);
  const [gameOpen, setGameOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [winnerModal, setWinnerModal] = useState<Winner[]>([]);
  const [search, setSearch] = useState("");
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [nowTick, setNowTick] = useState(0);
  const [theme, setTheme] = useState<"dark" | "light">(() =>
    typeof window !== "undefined" && localStorage.getItem("bingo-theme") === "light" ? "light" : "dark",
  );
  const [sound, setSound] = useState(() =>
    typeof window === "undefined" || localStorage.getItem("bingo-sound") !== "off",
  );
  const [processingFiles, setProcessingFiles] = useState(false);
  const [pdfProgress, setPdfProgress] = useState<(PdfParseProgress & { file: string }) | null>(null);
  const [importWarnings, setImportWarnings] = useState<string[]>([]);
  const [manualNumber, setManualNumber] = useState("");
  const [manualSerial, setManualSerial] = useState("");
  const [manualGrid, setManualGrid] = useState(initialGrid);
  const [patternName, setPatternName] = useState("");
  const [patternDescription, setPatternDescription] = useState("");
  const [patternCells, setPatternCells] = useState<number[]>([10, 11, 12, 13, 14]);
  const [patternColor, setPatternColor] = useState("#d7ff3f");
  const [gameDraft, setGameDraft] = useState({ name: "", date: "", prize: "", notes: "" });
  const [membershipName, setMembershipName] = useState("");
  const [activationCode, setActivationCode] = useState("");
  const [membershipMonths, setMembershipMonths] = useState<Record<string, number>>({});
  const [cardLayers, setCardLayers] = useState({ called: true, pattern: true, pending: true });
  const fileInputRef = useRef<HTMLInputElement>(null);

  const notify = useCallback((message: string, tone: Toast["tone"] = "success") => {
    const id = crypto.randomUUID();
    setToasts((current) => [...current, { id, message, tone }]);
    window.setTimeout(() => setToasts((current) => current.filter((toast) => toast.id !== id)), 4200);
  }, []);

  const refresh = useCallback(async (silent = false) => {
    if (!silent) {
      setLoading(true);
      setError("");
    }
    try {
      const authorization = await authorizationHeaders();
      const response = await fetch("/api/state", {
        cache: "no-store",
        headers: { "x-device-id": deviceId(), ...authorization },
      });
      const payload = (await response.json()) as AppState & { error?: string; access?: AccessState };
      if (response.status === 403 && payload.access) {
        setAccess(payload.access);
        setState(null);
        return;
      }
      if (!response.ok) throw new Error(payload.error || "No se pudo abrir la partida.");
      setState(payload);
      setAccess(payload.access);
      if (!silent) {
        setGameDraft({
          name: payload.game.name,
          date: payload.game.date,
          prize: payload.game.prize,
          notes: payload.game.notes,
        });
      }
    } catch (caught) {
      if (!silent) setError(caught instanceof Error ? caught.message : "No se pudo abrir la partida.");
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  const submitAuth = async () => {
    if (!authEmail.trim() && authMode !== "update") {
      setAuthMessage("Escribe un correo válido.");
      return;
    }
    if ((authMode === "login" || authMode === "register" || authMode === "update") && authPassword.length < 8) {
      setAuthMessage("La contraseña debe tener al menos 8 caracteres.");
      return;
    }
    setAuthBusy(true);
    setAuthMessage("");
    try {
      if (authMode === "login") {
        const { error: authError } = await supabase.auth.signInWithPassword({
          email: authEmail.trim(),
          password: authPassword,
        });
        if (authError) throw authError;
      } else if (authMode === "register") {
        if (!authName.trim()) throw new Error("Escribe tu nombre completo.");
        const { error: authError } = await supabase.auth.signUp({
          email: authEmail.trim(),
          password: authPassword,
          options: {
            emailRedirectTo: window.location.origin,
            data: { name: authName.trim() },
          },
        });
        if (authError) throw authError;
        setAuthMessage("Cuenta creada. Ahora solicita al administrador la activación de tu membresía.");
      } else if (authMode === "recover") {
        const { error: authError } = await supabase.auth.resetPasswordForEmail(
          authEmail.trim(),
          { redirectTo: `${window.location.origin}/?mode=reset` },
        );
        if (authError) throw authError;
        setAuthMessage("Enviamos las instrucciones de recuperación a tu correo.");
      } else {
        const { error: authError } = await supabase.auth.updateUser({
          password: authPassword,
        });
        if (authError) throw authError;
        setAuthMode("login");
        setAuthMessage("Contraseña guardada correctamente.");
      }
    } catch (caught) {
      setAuthMessage(caught instanceof Error ? caught.message : "No se pudo completar el acceso.");
    } finally {
      setAuthBusy(false);
    }
  };

  const requestMembership = async () => {
    if (!access?.email || !membershipName.trim()) {
      setError("Escribe tu nombre para enviar la solicitud.");
      return;
    }
    try {
      const result = await api<{ adminEmail: string; subject: string; accessCode: string }>({
        action: "requestMembership",
        email: access.email,
        name: membershipName.trim(),
      });
      window.open(`mailto:${result.adminEmail}?subject=${encodeURIComponent(result.subject)}&body=${encodeURIComponent(`Nueva solicitud de acceso a Bingo Control.\n\nNombre: ${membershipName.trim()}\nCorreo: ${access.email}\nCódigo de acceso: ${result.accessCode}\n\nLa duración de la membresía será definida por el administrador.`)}`, "_self");
      setAccess({ ...access, role: "pending", reason: "Solicitud enviada. Espera la aprobación del administrador." });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo enviar la solicitud.");
    }
  };

  const activateMembership = async () => {
    if (activationCode.trim().length !== 6) {
      setError("Escribe el código de acceso de 6 dígitos.");
      return;
    }
    try {
      await api({ action: "activateMembership", accessCode: activationCode.trim() });
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo activar la membresía.");
    }
  };

  const manageMembership = async (membership: Membership, action: "approveMembership" | "rejectMembership" | "resetMembershipDevice" | "resendMembershipCode") => {
    try {
      const months = membershipMonths[membership.id] ?? membership.months ?? 1;
      const result = await api<{ email?: string; expiresAt?: string; accessCode?: string; months?: number }>({ action, membershipId: membership.id, months });
      await refresh(true);
      if (action === "approveMembership" && result.email) {
        window.open(`mailto:${result.email}?subject=${encodeURIComponent("Membresía aprobada - Bingo Control Pro")}&body=${encodeURIComponent(`Tu membresía fue aprobada por ${result.months} mes(es).\nCódigo de acceso: ${result.accessCode}\nVigencia hasta: ${new Date(result.expiresAt || "").toLocaleDateString("es-EC")}\n\nIngresa el código en Bingo Control Pro. El primer dispositivo quedará vinculado a tu cuenta.`)}`, "_self");
      }
      if (action === "resendMembershipCode" && result.email && result.accessCode) {
        await navigator.clipboard?.writeText(result.accessCode).catch(() => undefined);
        window.open(`mailto:${result.email}?subject=${encodeURIComponent("Nuevo código de acceso - Bingo Control Pro")}&body=${encodeURIComponent(`Hola ${membership.name || ""},\n\nTu nuevo código de acceso es: ${result.accessCode}\nMembresía: ${result.months || membership.months || 1} mes(es)\nVigencia hasta: ${new Date(result.expiresAt || membership.expiresAt || "").toLocaleDateString("es-EC")}\n\nEl código anterior dejó de funcionar.`)}`, "_self");
      }
      notify(action === "approveMembership" ? "Usuario aprobado; correo de activación preparado." : action === "resendMembershipCode" ? "Código nuevo copiado y correo preparado." : action === "rejectMembership" ? "Solicitud rechazada." : "Dispositivo restablecido.");
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : "No se pudo actualizar el usuario.", "error");
    }
  };

  useEffect(() => {
    const bootstrapAuth = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      setAuthUser(session?.user ?? null);
      setAuthReady(true);
      const recovery =
        window.location.hash.includes("type=invite") ||
        window.location.hash.includes("type=recovery") ||
        new URLSearchParams(window.location.search).get("mode") === "reset";
      if (recovery) setAuthMode("update");
      if (session) void refresh();
    };
    void bootstrapAuth();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      setAuthUser(session?.user ?? null);
      if (event === "PASSWORD_RECOVERY") setAuthMode("update");
      if (session) void refresh();
      else {
        setState(null);
        setAccess(null);
      }
    });
    return () => subscription.unsubscribe();
  }, [refresh]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("bingo-theme", theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem("bingo-sound", sound ? "on" : "off");
  }, [sound]);

  useEffect(() => {
    const timer = window.setInterval(() => setNowTick(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const sync = window.setInterval(() => {
      if (authUser && document.visibilityState === "visible" && !processingFiles) void refresh(true);
    }, 4000);
    return () => window.clearInterval(sync);
  }, [authUser, processingFiles, refresh]);

  const game = state?.game;
  const called = useMemo(() => new Set(state?.draws.map((draw) => draw.number) ?? []), [state?.draws]);
  const availablePatterns = useMemo(
    () => [
      ...BUILTIN_PATTERNS,
      ...(state?.customPatterns ?? []),
      ...(state?.cards.some((card) => card.grid.length === 5)
        ? [COMPACT_CARD_PATTERN]
        : []),
    ],
    [state?.cards, state?.customPatterns],
  );
  const allPatterns = useMemo(
    () =>
      availablePatterns.filter(
        (pattern) => !state?.disabledPatternIds.includes(pattern.id),
      ),
    [availablePatterns, state?.disabledPatternIds],
  );
  const gamePatterns = allPatterns;
  const patternStatuses = useMemo(
    () =>
      gamePatterns.map((pattern) => {
        const compatibleCards = (state?.cards ?? []).filter(
          (card) =>
            card.status === "active" &&
            (pattern.id === COMPACT_CARD_PATTERN.id
              ? card.grid.length === 5
              : card.grid.length !== 5),
        );
        const nearest = compatibleCards.reduce(
          (best, card) =>
            Math.max(best, cardProgress(card, called, pattern).progress),
          0,
        );
        const winners = (state?.winners ?? []).filter(
          (winner) => winner.patternId === pattern.id,
        ).length;
        return {
          pattern,
          cards: compatibleCards.length,
          nearest,
          winners,
        };
      }),
    [called, gamePatterns, state?.cards, state?.winners],
  );
  const lastDraw = state?.draws[state.draws.length - 1];
  const elapsed = game?.startedAt
    ? Math.max(0, Math.floor((nowTick - new Date(game.startedAt).getTime()) / 1000))
    : 0;

  const playTone = useCallback(
    (winner = false) => {
      if (!sound) return;
      const AudioContextClass = window.AudioContext;
      const context = new AudioContextClass();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = winner ? "triangle" : "sine";
      oscillator.frequency.setValueAtTime(winner ? 660 : 440, context.currentTime);
      if (winner) oscillator.frequency.exponentialRampToValueAtTime(990, context.currentTime + 0.35);
      gain.gain.setValueAtTime(0.12, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + (winner ? 0.7 : 0.18));
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + (winner ? 0.7 : 0.2));
    },
    [sound],
  );

  const registerBall = useCallback(
    async (rawNumber: string | number) => {
      if (!state || !game) return;
      const number = Number(rawNumber);
      if (!Number.isInteger(number) || number < 1 || number > 90) {
        notify("Ingresa un número entero entre 1 y 90.", "warning");
        return;
      }
      if (called.has(number)) {
        notify(`La bolilla ${number} ya salió.`, "warning");
        return;
      }
      if (game.status === "paused") {
        notify("La partida está pausada. Reanúdala para continuar.", "warning");
        return;
      }
      try {
        const result = await api<{ draw: Draw }>({ action: "saveDraw", gameId: game.id, number });
        const nextCalled = new Set(called);
        nextCalled.add(number);
        const detected = state.cards.flatMap<Winner>((card) =>
          winningPatternsForCard(
            card,
            nextCalled,
            allPatterns,
            new Set(
              state.winners
                .filter((winner) => winner.cardId === card.id)
                .map((winner) => winner.patternId),
            ),
          ).map<Winner>((pattern) => ({
            id: crypto.randomUUID(),
            cardId: card.id,
            cardNumber: card.number,
            patternId: pattern.id,
            patternName: pattern.name,
            validatedAt: result.draw.drawnAt,
          })),
        );
        setState((current) =>
          current
            ? {
                ...current,
                draws: [...current.draws, result.draw],
                winners: [...detected, ...current.winners],
                game: {
                  ...current.game,
                  status: detected.length && current.game.autoPause ? "paused" : "running",
                  startedAt: current.game.startedAt || result.draw.drawnAt,
                },
              }
            : current,
        );
        setBallInput("");
        playTone(Boolean(detected.length));
        if (detected.length) {
          await api({
            action: "recordWinners",
            gameId: game.id,
            winners: detected,
            autoPause: game.autoPause,
          });
          setWinnerModal(detected);
        }
      } catch (caught) {
        notify(caught instanceof Error ? caught.message : "No se pudo registrar la bolilla.", "error");
      }
    },
    [allPatterns, called, game, notify, playTone, state],
  );

  const undoLastDraw = async () => {
    if (!state || !lastDraw) return;
    try {
      await api({ action: "undoDraw", gameId: state.game.id });
      await refresh();
      notify(`Se retiró la bolilla ${lastDraw.number}.`, "warning");
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : "No se pudo deshacer.", "error");
    }
  };

  const resetGame = async () => {
    if (!state || !state.draws.length) return;
    if (!window.confirm("¿Reiniciar las bolillas y ganadores de esta partida? Los cartones se conservarán.")) return;
    try {
      await api({ action: "resetGame", gameId: state.game.id });
      await refresh();
      notify("La partida quedó lista para comenzar.");
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : "No se pudo reiniciar.", "error");
    }
  };

  const togglePause = async () => {
    if (!state) return;
    const status: Game["status"] = state.game.status === "paused" ? "running" : "paused";
    try {
      await api({
        action: "updateGame",
        gameId: state.game.id,
        fields: { ...state.game, status },
      });
      setState({ ...state, game: { ...state.game, status } });
      notify(status === "paused" ? "Partida pausada." : "Partida reanudada.");
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : "No se pudo cambiar el estado.", "error");
    }
  };

  const continueAfterWin = async () => {
    if (!state) return;
    try {
      if (state.game.status === "paused") {
        const nextGame = { ...state.game, status: "running" as const };
        await api({ action: "updateGame", gameId: state.game.id, fields: nextGame });
        setState({ ...state, game: nextGame });
      }
      setWinnerModal([]);
      notify("El cartón ganador sigue activo para los demás patrones en juego.");
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : "No se pudo reanudar la partida.", "error");
    }
  };

  const disableWinningPatterns = async () => {
    if (!state || !winnerModal.length) return;
    const ids = [...new Set(winnerModal.map((winner) => winner.patternId))];
    try {
      await Promise.all(
        ids.map((patternId) =>
          api({
            action: "togglePattern",
            gameId: state.game.id,
            patternId,
            enabled: false,
          }),
        ),
      );
      setState({
        ...state,
        disabledPatternIds: [...new Set([...state.disabledPatternIds, ...ids])],
      });
      setWinnerModal([]);
      notify(`${ids.length} patrón${ids.length === 1 ? "" : "es"} ganador${ids.length === 1 ? "" : "es"} inhabilitado${ids.length === 1 ? "" : "s"}.`, "warning");
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : "No se pudieron inhabilitar los patrones.", "error");
    }
  };

  const toggleCardStatus = async (card: BingoCard) => {
    if (!state) return;
    const status = card.status === "active" ? "void" : "active";
    try {
      await api({ action: "updateCardStatus", gameId: state.game.id, cardId: card.id, status });
      setState({
        ...state,
        cards: state.cards.map((item) => (item.id === card.id ? { ...item, status } : item)),
      });
      notify(status === "void" ? `Cartón #${card.number} anulado.` : `Cartón #${card.number} reactivado.`, "warning");
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : "No se pudo actualizar el cartón.", "error");
    }
  };

  const deleteCard = async (card: BingoCard) => {
    if (!state || !window.confirm(`¿Eliminar definitivamente el cartón #${card.number} de esta partida?`)) return;
    try {
      await api({ action: "deleteCard", gameId: state.game.id, cardId: card.id });
      setState({
        ...state,
        cards: state.cards.filter((item) => item.id !== card.id),
        winners: state.winners.filter((winner) => winner.cardId !== card.id),
      });
      notify(`Cartón #${card.number} eliminado.`, "warning");
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : "No se pudo eliminar el cartón.", "error");
    }
  };

  const deleteVoidedCards = async () => {
    if (!state) return;
    const voided = state.cards.filter((card) => card.status === "void");
    if (!voided.length) {
      notify("No hay cartones anulados para eliminar.", "warning");
      return;
    }
    if (!window.confirm(`¿Eliminar definitivamente los ${voided.length} cartones anulados?`)) return;
    try {
      await api({ action: "deleteVoidCards", gameId: state.game.id });
      const ids = new Set(voided.map((card) => card.id));
      setState({
        ...state,
        cards: state.cards.filter((card) => !ids.has(card.id)),
        winners: state.winners.filter((winner) => !ids.has(winner.cardId)),
      });
      notify(`${voided.length} cartones anulados eliminados.`, "warning");
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : "No se pudieron eliminar los cartones anulados.", "error");
    }
  };

  const togglePattern = async (pattern: BingoPattern, enabled: boolean) => {
    if (!state) return;
    try {
      await api({
        action: "togglePattern",
        gameId: state.game.id,
        patternId: pattern.id,
        enabled,
      });
      setState({
        ...state,
        disabledPatternIds: enabled
          ? state.disabledPatternIds.filter((id) => id !== pattern.id)
          : [...new Set([...state.disabledPatternIds, pattern.id])],
      });
      notify(
        enabled
          ? `Patrón “${pattern.name}” habilitado.`
          : `Patrón “${pattern.name}” inhabilitado para esta partida.`,
        enabled ? "success" : "warning",
      );
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : "No se pudo actualizar el patrón.", "error");
    }
  };

  const deletePattern = async (pattern: BingoPattern) => {
    if (!state || !pattern.custom || !window.confirm(`¿Eliminar “${pattern.name}” de esta partida?`)) return;
    try {
      await api({ action: "deletePattern", gameId: state.game.id, patternId: pattern.id });
      setState({
        ...state,
        customPatterns: state.customPatterns.filter((item) => item.id !== pattern.id),
        disabledPatternIds: state.disabledPatternIds.filter((id) => id !== pattern.id),
      });
      notify(`Patrón “${pattern.name}” eliminado.`, "warning");
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : "No se pudo eliminar el patrón.", "error");
    }
  };

  const createNewGame = async () => {
    const name = window.prompt("Nombre del nuevo juego:", "Nueva partida");
    if (!name?.trim()) return;
    try {
      await api({
        action: "createGame",
        name: name.trim(),
        date: new Date().toISOString().slice(0, 10),
      });
      await refresh();
      setView("dashboard");
      notify("Nuevo juego creado: cartones, bolillas, ganadores y patrones personalizados están en cero.");
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : "No se pudo crear el nuevo juego.", "error");
    }
  };

  const saveManualCard = async () => {
    if (!state) return;
    const grid = manualGrid.map((value) => Number(value));
    const errors = validateCardGrid(grid);
    if (!manualNumber.trim()) errors.unshift("Asigna un número al cartón.");
    if (state.cards.some((card) => card.number.toLowerCase() === manualNumber.trim().toLowerCase())) {
      errors.unshift("Ya existe un cartón con ese número.");
    }
    if (errors.length) {
      setImportWarnings(errors);
      notify(errors[0], "warning");
      return;
    }
    const card: BingoCard = {
      id: crypto.randomUUID(),
      number: manualNumber.trim(),
      serial: manualSerial.trim(),
      grid,
      sourceFile: "Ingreso manual",
      sourcePage: 0,
      status: "active",
    };
    try {
      await api({ action: "saveCards", gameId: state.game.id, cards: [card] });
      setState({ ...state, cards: [card, ...state.cards] });
      setManualOpen(false);
      setManualNumber("");
      setManualSerial("");
      setManualGrid(initialGrid);
      setImportWarnings([]);
      notify(`Cartón #${card.number} guardado.`);
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : "No se pudo guardar el cartón.", "error");
    }
  };

  const processFiles = async (files: File[]) => {
    if (!state || !files.length) return;
    const invalid = files.find((file) => file.type !== "application/pdf" && !file.name.endsWith(".pdf"));
    if (invalid) {
      notify(`${invalid.name} no es un archivo PDF.`, "warning");
      return;
    }
    setProcessingFiles(true);
    const warnings: string[] = [];
    const signatures = new Set(state.cards.map((card) => card.grid.join(",")));
    const usedNumbers = new Set(state.cards.map((card) => card.number.toLowerCase()));
    let imported = 0;
    let duplicateCount = 0;
    try {
      for (const file of files) {
        const checksum = await fileChecksum(file);
        if (state.files.some((entry) => entry.checksum === checksum)) {
          duplicateCount += 1;
          warnings.push(`${file.name}: el archivo ya había sido importado.`);
          continue;
        }
        const parsed = await parseBingoPdf(file, (progress) =>
          setPdfProgress({ ...progress, file: file.name }),
        );
        warnings.push(...parsed.warnings.map((warning) => `${file.name} · ${warning}`));
        const uniqueCards = parsed.cards
          .filter((card) => !signatures.has(card.grid.join(",")))
          .map((card, index) => {
            signatures.add(card.grid.join(","));
            let number = card.number;
            if (usedNumbers.has(number.toLowerCase())) {
              number = `${number}-${checksum.slice(0, 6).toUpperCase()}${index ? `-${index + 1}` : ""}`;
            }
            while (usedNumbers.has(number.toLowerCase())) number = `${number}-2`;
            usedNumbers.add(number.toLowerCase());
            return { ...card, number };
          });
        duplicateCount += parsed.cards.length - uniqueCards.length;
        if (!uniqueCards.length) {
          warnings.push(`${file.name}: no se encontraron cartones nuevos para guardar.`);
          continue;
        }
        const result = await api<{ accepted: number; duplicates: number }>({
          action: "saveCards",
          gameId: state.game.id,
          cards: uniqueCards,
        });
        imported += result.accepted;
        duplicateCount += result.duplicates;
        const authorization = await authorizationHeaders();
        const upload = await fetch("/api/files", {
          method: "POST",
          headers: {
            "content-type": "application/pdf",
            "x-file-name": encodeURIComponent(file.name),
            "x-checksum": checksum,
            "x-game-id": state.game.id,
            "x-device-id": deviceId(),
            "x-pages": String(parsed.pages),
            "x-cards": String(result.accepted),
            ...authorization,
          },
          body: file,
        });
        if (!upload.ok) {
          const detail = (await upload.json()) as { error?: string };
          warnings.push(`${file.name}: ${detail.error || "no se pudo conservar el archivo original."}`);
        }
      }
      await refresh();
      setImportWarnings(warnings);
      if (imported) notify(`${imported} cartones importados correctamente.`);
      if (duplicateCount) notify(`${duplicateCount} elementos duplicados fueron omitidos.`, "warning");
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "No se pudo completar la importación.";
      warnings.push(message);
      setImportWarnings(warnings);
      notify(message, "error");
    } finally {
      setProcessingFiles(false);
      setPdfProgress(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const saveCustomPattern = async () => {
    if (!state || !patternName.trim() || !patternCells.length) {
      notify("Escribe un nombre y selecciona al menos una casilla.", "warning");
      return;
    }
    const pattern: BingoPattern = {
      id: `custom-${crypto.randomUUID()}`,
      name: patternName.trim(),
      description: patternDescription.trim() || "Patrón personalizado",
      color: patternColor,
      category: "Personalizado",
      difficulty: patternCells.length > 12 ? "Alta" : patternCells.length > 7 ? "Media" : "Fácil",
      cells: patternCells,
      variants: [patternCells],
      custom: true,
    };
    try {
      await api({ action: "savePattern", gameId: state.game.id, pattern });
      setState({ ...state, customPatterns: [pattern, ...state.customPatterns] });
      setPatternOpen(false);
      setPatternName("");
      setPatternDescription("");
      setPatternCells([10, 11, 12, 13, 14]);
      notify(`Patrón “${pattern.name}” guardado y activo en la partida.`);
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : "No se pudo guardar el patrón.", "error");
    }
  };

  const saveGame = async () => {
    if (!state || !gameDraft.name.trim()) {
      notify("La partida necesita un nombre.", "warning");
      return;
    }
    try {
      await api({
        action: "updateGame",
        gameId: state.game.id,
        fields: { ...state.game, ...gameDraft },
      });
      setState({ ...state, game: { ...state.game, ...gameDraft } });
      setGameOpen(false);
      notify("Datos de la partida actualizados.");
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : "No se pudo guardar la partida.", "error");
    }
  };

  const updateAutoPause = async (autoPause: boolean) => {
    if (!state) return;
    const nextGame = { ...state.game, autoPause };
    setState({ ...state, game: nextGame });
    try {
      await api({ action: "updateGame", gameId: state.game.id, fields: nextGame });
      notify(autoPause ? "Pausa automática activada." : "La partida continuará al detectar bingo.");
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : "No se pudo guardar el ajuste.", "error");
    }
  };

  const exportCsv = () => {
    if (!state) return;
    const lines = [
      ["PARTIDA", state.game.name],
      ["PATRONES ACTIVOS", gamePatterns.map((pattern) => pattern.name).join(" · ")],
      ["BOLILLAS", state.draws.map((draw) => draw.number).join(" - ")],
      [],
      ["CARTÓN", "ESTADO", "ORIGEN", "PÁGINA", "NÚMEROS"],
      ...state.cards.map((card) => [
        card.number,
        card.status === "active" ? "Activo" : "Anulado",
        card.sourceFile,
        String(card.sourcePage || ""),
        card.grid.map((number) => number || "LIBRE").join(" "),
      ]),
      [],
      ["GANADORES"],
      ["CARTÓN", "PATRÓN", "VALIDADO"],
      ...state.winners.map((winner) => [
        winner.cardNumber,
        winner.patternName,
        new Date(winner.validatedAt).toLocaleString("es-EC"),
      ]),
    ];
    const csv = lines
      .map((row) => row.map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(","))
      .join("\r\n");
    downloadBlob(new Blob([`\ufeff${csv}`], { type: "text/csv;charset=utf-8" }), "reporte-bingo.csv");
  };

  const exportExcel = async () => {
    if (!state) return;
    const XLSX = await import("xlsx");
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.json_to_sheet(
        state.cards.map((card) => ({
          Cartón: card.number,
          Estado: card.status === "active" ? "Activo" : "Anulado",
          Origen: card.sourceFile,
          Página: card.sourcePage || "",
          Números: card.grid.map((number) => number || "LIBRE").join(" "),
        })),
      ),
      "Cartones",
    );
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.json_to_sheet(
        state.draws.map((draw, index) => ({
          Orden: index + 1,
          Bolilla: draw.number,
          Hora: new Date(draw.drawnAt).toLocaleString("es-EC"),
        })),
      ),
      "Bolillas",
    );
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.json_to_sheet(
        state.winners.map((winner) => ({
          Cartón: winner.cardNumber,
          Patrón: winner.patternName,
          Validado: new Date(winner.validatedAt).toLocaleString("es-EC"),
        })),
      ),
      "Ganadores",
    );
    XLSX.writeFile(workbook, "reporte-bingo.xlsx");
  };

  const exportPdf = async () => {
    if (!state) return;
    const { jsPDF } = await import("jspdf");
    const pdf = new jsPDF();
    pdf.setFontSize(20);
    pdf.text("Reporte de partida — Bingo Control", 16, 20);
    pdf.setFontSize(11);
    pdf.text(`Partida: ${state.game.name}`, 16, 31);
    pdf.text(`Patrones activos: ${gamePatterns.length}`, 16, 38);
    pdf.text(`Cartones: ${state.cards.length}   Bolillas: ${state.draws.length}   Ganadores: ${state.winners.length}`, 16, 45);
    pdf.setFontSize(13);
    pdf.text("Historial de bolillas", 16, 58);
    pdf.setFontSize(10);
    pdf.text(state.draws.map((draw) => draw.number).join(" · ") || "Sin bolillas registradas", 16, 66, {
      maxWidth: 178,
    });
    let y = 88;
    pdf.setFontSize(13);
    pdf.text("Ganadores", 16, y);
    y += 8;
    pdf.setFontSize(10);
    if (!state.winners.length) {
      pdf.text("Aún no hay ganadores.", 16, y);
    } else {
      for (const winner of state.winners) {
        const card = state.cards.find((item) => item.id === winner.cardId);
        const pattern = availablePatterns.find((item) => item.id === winner.patternId);
        const blockHeight = card?.grid.length === 5 ? 28 : 58;
        if (y + blockHeight > 282) {
          pdf.addPage();
          y = 20;
        }
        pdf.setFont("helvetica", "bold");
        pdf.text(`Cartón #${winner.cardNumber} — ${winner.patternName}`, 16, y);
        pdf.setFont("helvetica", "normal");
        pdf.text(new Date(winner.validatedAt).toLocaleString("es-EC"), 128, y);
        y += 5;
        if (card && pattern) {
          const columns = card.grid.length === 5 ? 5 : 5;
          const rows = card.grid.length === 5 ? 1 : 5;
          const cellSize = 8;
          for (let row = 0; row < rows; row += 1) {
            for (let column = 0; column < columns; column += 1) {
              const index = row * columns + column;
              const value = card.grid[index];
              const target = pattern.cells.includes(index);
              const marked = value === 0 || called.has(value);
              pdf.setFillColor(target ? 215 : marked ? 220 : 245, target ? 255 : marked ? 235 : 245, target ? 63 : marked ? 220 : 245);
              pdf.rect(16 + column * cellSize, y + row * cellSize, cellSize, cellSize, "FD");
              pdf.setTextColor(target ? 20 : 45, 50, 45);
              pdf.text(value === 0 ? "L" : String(value), 20 + column * cellSize, y + 5.2 + row * cellSize, { align: "center" });
            }
          }
          pdf.setTextColor(0, 0, 0);
          pdf.text(`Origen: ${card.sourceFile}${card.sourcePage ? ` · pág. ${card.sourcePage}` : ""}`, 62, y + 6, { maxWidth: 125 });
          y += rows * cellSize + 9;
        } else {
          y += 7;
        }
      }
    }
    pdf.save("reporte-bingo.pdf");
  };

  const filteredCards = useMemo(() => {
    if (!state) return [];
    const term = search.trim().toLowerCase();
    return state.cards
      .filter(
        (card) =>
          !term ||
        card.number.toLowerCase().includes(term) ||
        card.sourceFile.toLowerCase().includes(term) ||
        card.serial?.toLowerCase().includes(term),
      )
      .sort(
        (a, b) =>
          nearestPatternForCard(
            b,
            called,
            allPatterns,
            state.winners.filter((winner) => winner.cardId === b.id),
          ).progress.progress -
          nearestPatternForCard(
            a,
            called,
            allPatterns,
            state.winners.filter((winner) => winner.cardId === a.id),
          ).progress.progress,
      );
  }, [allPatterns, called, search, state]);

  const navItems: { id: View; label: string; icon: typeof Activity }[] = [
    { id: "dashboard", label: "Sala de juego", icon: LayoutDashboard },
    { id: "cards", label: "Cartones", icon: Grid3X3 },
    { id: "patterns", label: "Patrones", icon: Sparkles },
    { id: "reports", label: "Reportes", icon: FileSpreadsheet },
    ...(state?.access.role === "admin"
      ? [{ id: "memberships" as View, label: "Usuarios", icon: UserRound }]
      : []),
  ];

  if (!authReady) {
    return (
      <main className="loading-screen">
        <div className="loading-mark"><span>B</span><i /></div>
        <p>Verificando tu cuenta</p>
      </main>
    );
  }

  if (!authUser || authMode === "update") {
    const title =
      authMode === "register"
        ? "Crear una cuenta"
        : authMode === "recover"
          ? "Recuperar acceso"
          : authMode === "update"
            ? "Define tu contraseña"
            : "Bienvenido";
    const description =
      authMode === "register"
        ? "Regístrate con un correo válido. El administrador aprobará tu acceso."
        : authMode === "recover"
          ? "Te enviaremos un enlace seguro para cambiar tu contraseña."
          : authMode === "update"
            ? "Escribe una contraseña nueva para completar la activación."
            : "Inicia sesión para entrar a Bingo Control Pro.";
    return (
      <main className="auth-screen">
        <section className="auth-card">
          <div className="brand auth-brand">
            <div className="brand-mark"><span>B</span><i /></div>
            <div><strong>BINGO</strong><small>CONTROL PRO</small></div>
          </div>
          <span className="eyebrow"><ShieldCheck size={14} /> ACCESO SEGURO</span>
          <h1>{title}</h1>
          <p>{description}</p>
          {authMode !== "update" && (
            <div className="auth-tabs">
              <button className={authMode === "login" ? "active" : ""} onClick={() => { setAuthMode("login"); setAuthMessage(""); }} type="button">Ingresar</button>
              <button className={authMode === "register" ? "active" : ""} onClick={() => { setAuthMode("register"); setAuthMessage(""); }} type="button">Registrarse</button>
            </div>
          )}
          <form className="form-stack auth-form" onSubmit={(event) => { event.preventDefault(); void submitAuth(); }}>
            {authMode === "register" && (
              <label>Nombre completo<input autoComplete="name" onChange={(event) => setAuthName(event.target.value)} placeholder="Nombre y apellido" value={authName} /></label>
            )}
            {authMode !== "update" && (
              <label>Correo electrónico<input autoComplete="email" onChange={(event) => setAuthEmail(event.target.value)} placeholder="nombre@correo.com" type="email" value={authEmail} /></label>
            )}
            {authMode !== "recover" && (
              <label>Contraseña<input autoComplete={authMode === "login" ? "current-password" : "new-password"} minLength={8} onChange={(event) => setAuthPassword(event.target.value)} placeholder="Mínimo 8 caracteres" type="password" value={authPassword} /></label>
            )}
            {authMessage && <div className="auth-message">{authMessage}</div>}
            <button className="primary-button auth-submit" disabled={authBusy} type="submit">
              {authBusy ? "Procesando..." : authMode === "register" ? "Crear cuenta" : authMode === "recover" ? "Enviar enlace" : authMode === "update" ? "Guardar contraseña" : "Iniciar sesión"}
            </button>
          </form>
          {authMode === "login" && <button className="auth-link" onClick={() => { setAuthMode("recover"); setAuthMessage(""); }} type="button">¿Olvidaste tu contraseña?</button>}
          {authMode === "recover" && <button className="auth-link" onClick={() => { setAuthMode("login"); setAuthMessage(""); }} type="button">Volver al inicio de sesión</button>}
          <small>Los registros nuevos son cuentas de usuario. Solo el administrador puede aprobar membresías y cada cuenta funciona en un único dispositivo.</small>
        </section>
      </main>
    );
  }

  if (loading && !state) {
    return (
      <main className="loading-screen">
        <div className="loading-mark"><span>B</span><i /></div>
        <p>Preparando la sala de juego</p>
      </main>
    );
  }

  if (access && !access.allowed) {
    const pending = access.membership?.status === "pending";
    const awaitingCode = access.membership?.status === "approved" && !access.membership.activationVerified;
    const canRequest = !access.membership || access.membership.status === "rejected" || access.membership.status === "expired";
    const whatsappMessage = encodeURIComponent(`Hola, solicito ${access.membership?.status === "expired" ? "renovar" : "activar"} mi cuenta de Bingo Control Pro.\nCorreo: ${access.email}`);
    return (
      <main className="membership-screen">
        <section className="membership-card">
          <div className="brand membership-brand">
            <div className="brand-mark"><span>B</span><i /></div>
            <div><strong>BINGO</strong><small>CONTROL PRO</small></div>
          </div>
          <span className="eyebrow"><ShieldCheck size={14} /> ACCESO POR MEMBRESÍA</span>
          <h1>{awaitingCode ? "Ingresa tu código de acceso" : pending ? "Tu acceso está en revisión" : "Solicita tu acceso"}</h1>
          <p>{access.reason || "El administrador debe aprobar tu cuenta antes de ingresar."}</p>
          <div className="membership-email"><UserRound size={17} /><span>{access.email}</span></div>
          {canRequest && (
            <div className="form-stack">
              <label>Nombre completo<input onChange={(event) => setMembershipName(event.target.value)} placeholder="Tu nombre" value={membershipName} /></label>
              <button className="primary-button" onClick={() => void requestMembership()} type="button">Solicitar aprobación</button>
            </div>
          )}
          {awaitingCode && (
            <div className="form-stack">
              <label>Código de acceso<input inputMode="numeric" maxLength={6} onChange={(event) => setActivationCode(event.target.value.replace(/\D/g, ""))} placeholder="000000" value={activationCode} /></label>
              <button className="primary-button" onClick={() => void activateMembership()} type="button">Activar membresía</button>
            </div>
          )}
          <a className="whatsapp-button" href={`https://wa.me/${WHATSAPP_NUMBER}?text=${whatsappMessage}`} rel="noreferrer" target="_blank">Solicitar activación o renovación por WhatsApp</a>
          {error && <div className="membership-error">{error}</div>}
          <small>WhatsApp de atención: <a href={`https://wa.me/${WHATSAPP_NUMBER}`} rel="noreferrer" target="_blank">+593 98 528 0991</a>. Solo el administrador puede otorgar o renovar membresías.</small>
        </section>
      </main>
    );
  }

  if (error || !state || !game) {
    return (
      <main className="loading-screen error-screen">
        <AlertTriangle size={34} />
        <h1>No pudimos abrir la partida</h1>
        <p>{error || "La información no está disponible."}</p>
        <button className="primary-button" onClick={() => void refresh()} type="button">
          <RefreshCw size={17} /> Reintentar
        </button>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <aside className={`sidebar ${sidebarOpen ? "open" : ""}`}>
        <div className="brand">
          <div className="brand-mark"><span>B</span><i /></div>
          <div><strong>BINGO</strong><small>CONTROL PRO</small></div>
          <button className="sidebar-close" onClick={() => setSidebarOpen(false)} type="button"><X size={20} /></button>
        </div>
        <div className="operator">
          <div className="operator-avatar"><UserRound size={18} /></div>
          <div><strong>{state.access.role === "admin" ? "Administrador" : "Operador"}</strong><span><i /> {authUser.email}</span></div>
          <ChevronRight size={17} />
        </div>
        <nav>
          <span className="nav-label">OPERACIÓN</span>
          {navItems.map(({ id, label, icon: Icon }) => (
            <button
              className={view === id ? "active" : ""}
              key={id}
              onClick={() => { setView(id); setSidebarOpen(false); }}
              type="button"
            >
              <Icon size={19} />
              {label}
              {id === "cards" && <em>{state.cards.length}</em>}
            </button>
          ))}
          <span className="nav-label">SISTEMA</span>
          <button onClick={() => setSettingsOpen(true)} type="button"><Settings2 size={19} /> Configuración</button>
          <button onClick={() => setView("reports")} type="button"><History size={19} /> Auditoría</button>
        </nav>
        <div className="sidebar-pattern">
          <div className="eyebrow"><Zap size={13} /> TODOS ACTIVOS</div>
          <div className="pattern-lockup">
            <span className="pattern-multi-icon"><Sparkles size={20} /></span>
            <div><strong>{gamePatterns.length} patrones</strong><span>Evaluación simultánea</span></div>
          </div>
          <button onClick={() => setView("patterns")} type="button">Ver patrones <ChevronRight size={15} /></button>
        </div>
        <footer className="sidebar-footer"><ShieldCheck size={15} /> Guardado automático activo</footer>
      </aside>
      {sidebarOpen && <button aria-label="Cerrar menú" className="sidebar-backdrop" onClick={() => setSidebarOpen(false)} type="button" />}

      <section className="main-stage">
        <header className="topbar">
          <button className="mobile-menu icon-button" onClick={() => setSidebarOpen(true)} type="button"><Menu size={21} /></button>
          <div className="game-title">
            <span>PARTIDA ACTUAL</span>
            <div>
              <h1>{game.name}</h1>
              <button onClick={() => setGameOpen(true)} type="button"><PencilLine size={14} /></button>
              <b className={`status-pill status-${game.status}`}>
                <i />
                {game.status === "running" ? "En juego" : game.status === "paused" ? "Pausada" : game.status === "finished" ? "Finalizada" : "Lista"}
              </b>
            </div>
          </div>
          <div className="top-actions">
            <div className="game-clock"><Clock3 size={18} /><div><span>TIEMPO DE JUEGO</span><strong>{formatDuration(elapsed)}</strong></div></div>
            <button className="icon-button" onClick={() => setSound(!sound)} title={sound ? "Silenciar" : "Activar sonido"} type="button">
              {sound ? <Volume2 size={19} /> : <VolumeX size={19} />}
            </button>
            <button className="icon-button" onClick={() => setSettingsOpen(true)} type="button"><Settings2 size={19} /></button>
            <button className="secondary-button compact" onClick={() => void createNewGame()} type="button"><RefreshCw size={16} /> Nuevo juego</button>
            <button className="primary-button compact" onClick={() => setManualOpen(true)} type="button"><Plus size={17} /> Cartón</button>
          </div>
        </header>

        <div className="content">
          {view === "dashboard" && (
            <motion.div animate={{ opacity: 1, y: 0 }} className="view-stack" initial={{ opacity: 0, y: 8 }}>
              <div className="section-heading">
                <div><span className="eyebrow">CENTRO DE CONTROL</span><h2>La partida, en un vistazo.</h2></div>
                <div className="heading-actions">
                  {state.draws.length > 0 && (
                    <button className="secondary-button" onClick={togglePause} type="button">
                      {game.status === "paused" ? <Play size={16} /> : <Pause size={16} />}
                      {game.status === "paused" ? "Reanudar" : "Pausar"}
                    </button>
                  )}
                  <button className="ghost-button" onClick={resetGame} type="button"><RotateCcw size={16} /> Reiniciar</button>
                </div>
              </div>

              <div className="stats-grid">
                <StatCard accent="lime" detail={`${state.cards.filter((card) => card.status === "active").length} activos`} icon={Grid3X3} label="Cartones cargados" value={state.cards.length} />
                <StatCard accent="mint" detail={`${90 - state.draws.length} restantes`} icon={CircleGauge} label="Bolillas sorteadas" value={state.draws.length} />
                <StatCard accent="amber" detail={state.winners.length ? "Validación confirmada" : "Sin coincidencias completas"} icon={Trophy} label="Ganadores" value={state.winners.length} />
                <StatCard accent="blue" detail="Evaluación simultánea" icon={Sparkles} label="Patrones activos" value={gamePatterns.length} />
              </div>

              <div className="game-grid">
                <section className="panel caller-panel">
                  <div className="panel-heading">
                    <div><span className="eyebrow"><Activity size={13} /> CONTROL DE BOLILLAS</span><h3>Registrar nueva bolilla</h3></div>
                    <span className="secure-badge"><ShieldCheck size={14} /> Sin duplicados</span>
                  </div>
                  <div className="caller-body">
                    <div className={`last-ball ${lastDraw ? "has-ball" : ""}`}>
                      <span>ÚLTIMA BOLILLA</span>
                      <strong>{lastDraw?.number ?? "—"}</strong>
                      <small>{lastDraw ? new Date(lastDraw.drawnAt).toLocaleTimeString("es-EC", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "Esperando el primer número"}</small>
                    </div>
                    <div className="ball-entry">
                      <label htmlFor="ball-number">Número extraído</label>
                      <div>
                        <input
                          id="ball-number"
                          inputMode="numeric"
                          max="90"
                          min="1"
                          onChange={(event) => setBallInput(event.target.value.replace(/\D/g, "").slice(0, 2))}
                          onKeyDown={(event) => { if (event.key === "Enter") void registerBall(ballInput); }}
                          placeholder="00"
                          value={ballInput}
                        />
                        <button className="draw-button" onClick={() => void registerBall(ballInput)} type="button">
                          Confirmar bolilla <ArrowLeft size={18} />
                        </button>
                      </div>
                      <div className="entry-shortcuts">
                        <button onClick={() => setBallBoardOpen(!ballBoardOpen)} type="button"><Gamepad2 size={15} /> Teclado visual</button>
                        <button disabled={!lastDraw} onClick={undoLastDraw} type="button"><RotateCcw size={15} /> Deshacer última</button>
                      </div>
                    </div>
                  </div>
                  <AnimatePresence>
                    {ballBoardOpen && (
                      <motion.div animate={{ height: "auto", opacity: 1 }} className="number-board-wrap" exit={{ height: 0, opacity: 0 }} initial={{ height: 0, opacity: 0 }}>
                        <div className="number-board">
                          {Array.from({ length: 90 }, (_, index) => index + 1).map((number) => (
                            <button
                              className={called.has(number) ? "called" : ""}
                              disabled={called.has(number) || game.status === "paused"}
                              key={number}
                              onClick={() => void registerBall(number)}
                              type="button"
                            >
                              {number}
                            </button>
                          ))}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </section>

                <section className="panel history-panel">
                  <div className="panel-heading">
                    <div><span className="eyebrow"><History size={13} /> SECUENCIA</span><h3>Historial de bolillas</h3></div>
                    <strong>{Math.round((state.draws.length / 90) * 100)}%</strong>
                  </div>
                  {state.draws.length ? (
                    <>
                      <div className="draw-history">
                        {[...state.draws].reverse().slice(0, 18).map((draw, index) => (
                          <span className={index === 0 ? "latest" : ""} key={draw.id}>{draw.number}</span>
                        ))}
                      </div>
                      <div className="game-progress"><span><i style={{ width: `${(state.draws.length / 90) * 100}%` }} /></span><small>{90 - state.draws.length} números restantes</small></div>
                    </>
                  ) : (
                    <EmptyState icon={CircleGauge} text="Cada bolilla aparecerá aquí en el orden exacto de salida." title="Aún no empieza el sorteo" />
                  )}
                </section>
              </div>

              <section className="panel live-patterns-panel">
                <div className="panel-heading">
                  <div><span className="eyebrow"><Sparkles size={13} /> PATRONES EN JUEGO</span><h3>Todos se verifican con cada bolilla</h3></div>
                  <span className="secure-badge"><Activity size={14} /> {gamePatterns.length} activos</span>
                </div>
                <div className="live-pattern-grid">
                  {patternStatuses.map(({ pattern, cards, nearest, winners }) => (
                    <article className="live-pattern-card" key={pattern.id}>
                      <div>
                        <PatternMini pattern={pattern} />
                        <span><strong>{pattern.name}</strong><small>{pattern.category} · {pattern.difficulty}</small></span>
                      </div>
                      <div className="pattern-live-progress">
                        <span><i style={{ width: `${Math.round(nearest * 100)}%` }} /></span>
                        <b>{Math.round(nearest * 100)}%</b>
                      </div>
                      <footer>
                        <span>{cards} cartones compatibles</span>
                        <strong>{winners ? `${winners} ganador${winners === 1 ? "" : "es"}` : "En juego"}</strong>
                      </footer>
                    </article>
                  ))}
                </div>
              </section>

              <div className="lower-grid">
                <section className="panel">
                  <div className="panel-heading">
                    <div><span className="eyebrow">CARTONES MÁS CERCA</span><h3>Seguimiento en tiempo real</h3></div>
                    <button className="text-button" onClick={() => setView("cards")} type="button">Ver todos <ChevronRight size={15} /></button>
                  </div>
                  {state.cards.length ? (
                    <div className="live-ticket-grid">
                      {[...state.cards]
                        .filter((card) => card.status === "active")
                        .sort(
                          (a, b) =>
                            nearestPatternForCard(
                              b,
                              called,
                              allPatterns,
                              state.winners.filter((winner) => winner.cardId === b.id),
                            ).progress.progress -
                            nearestPatternForCard(
                              a,
                              called,
                              allPatterns,
                              state.winners.filter((winner) => winner.cardId === a.id),
                            ).progress.progress,
                        )
                        .slice(0, 4)
                        .map((card) => (
                          <CardPreview
                            called={called}
                            card={card}
                            key={card.id}
                            onToggleStatus={toggleCardStatus}
                            patterns={allPatterns}
                            wins={state.winners.filter((winner) => winner.cardId === card.id)}
                          />
                        ))}
                    </div>
                  ) : (
                    <EmptyState
                      action={<button className="secondary-button" onClick={() => setView("cards")} type="button"><UploadCloud size={16} /> Cargar cartones</button>}
                      icon={Grid3X3}
                      text="Importa un PDF o crea el primer cartón manualmente."
                      title="Sin cartones en juego"
                    />
                  )}
                </section>
                <section className="panel winners-panel">
                  <div className="panel-heading">
                    <div><span className="eyebrow"><Award size={13} /> VALIDACIONES</span><h3>Ganadores recientes</h3></div>
                    {state.winners.length > 0 && <span className="winner-count">{state.winners.length}</span>}
                  </div>
                  {state.winners.length ? (
                    <div className="winner-list">
                      {state.winners.slice(0, 4).map((winner) => (
                        <button key={winner.id} onClick={() => setWinnerModal([winner])} type="button">
                          <span><Trophy size={17} /></span>
                          <div><strong>Cartón #{winner.cardNumber}</strong><small>{winner.patternName}</small></div>
                          <time>{new Date(winner.validatedAt).toLocaleTimeString("es-EC", { hour: "2-digit", minute: "2-digit" })}</time>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <EmptyState icon={Trophy} text="El motor verificará automáticamente todos los cartones." title="Esperando un bingo" />
                  )}
                </section>
              </div>
            </motion.div>
          )}

          {view === "cards" && (
            <motion.div animate={{ opacity: 1, y: 0 }} className="view-stack" initial={{ opacity: 0, y: 8 }}>
              <div className="section-heading">
                <div><span className="eyebrow">ADMINISTRACIÓN</span><h2>Cartones de la partida.</h2><p>Importa PDFs digitales o escaneados; también puedes completar una tabla manualmente.</p></div>
                <button className="primary-button" onClick={() => setManualOpen(true)} type="button"><SquarePen size={17} /> Ingreso manual</button>
              </div>
              <input
                accept="application/pdf,.pdf"
                className="visually-hidden"
                multiple
                onChange={(event) => void processFiles(Array.from(event.target.files ?? []))}
                ref={fileInputRef}
                type="file"
              />
              <section
                className={`upload-zone ${processingFiles ? "processing" : ""}`}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  void processFiles(Array.from(event.dataTransfer.files));
                }}
              >
                {processingFiles ? (
                  <>
                    <span className="upload-icon"><LoaderCircle className="spin" size={29} /></span>
                    <div><strong>{pdfProgress?.stage ?? "Preparando PDF"}</strong><p>{pdfProgress?.file} · página {pdfProgress?.page ?? 0} de {pdfProgress?.pages ?? 0}</p></div>
                    <div className="upload-progress"><i style={{ width: `${pdfProgress?.percent ?? 4}%` }} /></div>
                  </>
                ) : (
                  <>
                    <span className="upload-icon"><UploadCloud size={29} /></span>
                    <div><strong>Suelta aquí uno o varios archivos PDF</strong><p>Detectamos texto digital y usamos OCR cuando la página es una imagen.</p></div>
                    <button className="secondary-button" onClick={() => fileInputRef.current?.click()} type="button">Seleccionar PDF</button>
                    <small>PDF · múltiples páginas · hasta 4 o más cartones por hoja</small>
                  </>
                )}
              </section>
              {importWarnings.length > 0 && (
                <section className="warning-box">
                  <AlertTriangle size={19} />
                  <div><strong>Revisión de la última importación</strong>{importWarnings.slice(0, 8).map((warning) => <p key={warning}>{warning}</p>)}</div>
                  <button onClick={() => setImportWarnings([])} type="button"><X size={17} /></button>
                </section>
              )}
              {state.files.length > 0 && (
                <section className="file-strip">
                  {state.files.slice(0, 4).map((file) => (
                    <div key={file.id}><span><FileCheck2 size={18} /></span><div><strong>{file.name}</strong><small>{file.pages} páginas · {file.cards} cartones</small></div><Check size={16} /></div>
                  ))}
                </section>
              )}
              <div className="cards-toolbar">
                <div className="search-box"><Search size={17} /><input onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por cartón, serie o archivo…" value={search} /></div>
                <div><span>{filteredCards.length} cartones · ordenados por avance</span><span>{state.cards.filter((card) => card.status === "void").length} anulados</span>{state.cards.some((card) => card.status === "void") && <button className="ghost-button compact danger-button" onClick={() => void deleteVoidedCards()} type="button"><Trash2 size={14} /> Eliminar anulados</button>}</div>
              </div>
              <div className="card-legend" aria-label="Controles de visualización del cartón">
                <button aria-pressed={cardLayers.called} className={cardLayers.called ? "active" : ""} onClick={() => setCardLayers((current) => ({ ...current, called: !current.called }))} type="button"><i className="called-number" /> Número sorteado</button>
                <button aria-pressed={cardLayers.pattern} className={cardLayers.pattern ? "active" : ""} onClick={() => setCardLayers((current) => ({ ...current, pattern: !current.pattern }))} type="button"><i className="pattern-cell" /> Patrón más cercano</button>
                <button aria-pressed={cardLayers.pending} className={cardLayers.pending ? "active" : ""} onClick={() => setCardLayers((current) => ({ ...current, pending: !current.pending }))} type="button"><i /> Pendientes</button>
                <b><Activity size={13} /> Sincronización en vivo cada 4 s</b>
              </div>
              {filteredCards.length ? (
                <div className="ticket-grid">
                  {filteredCards.map((card) => (
                    <CardPreview
                      card={card}
                      called={called}
                      key={card.id}
                      onDelete={deleteCard}
                      onToggleStatus={toggleCardStatus}
                      patterns={allPatterns}
                      showCalled={cardLayers.called}
                      showPattern={cardLayers.pattern}
                      showPending={cardLayers.pending}
                      wins={state.winners.filter((winner) => winner.cardId === card.id)}
                    />
                  ))}
                </div>
              ) : (
                <EmptyState
                  action={<div className="empty-actions"><button className="primary-button" onClick={() => fileInputRef.current?.click()} type="button"><UploadCloud size={16} /> Importar PDF</button><button className="secondary-button" onClick={() => setManualOpen(true)} type="button"><SquarePen size={16} /> Crear manual</button></div>}
                  icon={Grid3X3}
                  text={search ? "Prueba con otro número, serie o nombre de archivo." : "Los cartones aparecerán aquí después de importarlos o crearlos."}
                  title={search ? "No hay coincidencias" : "La colección está vacía"}
                />
              )}
            </motion.div>
          )}

          {view === "patterns" && (
            <motion.div animate={{ opacity: 1, y: 0 }} className="view-stack" initial={{ opacity: 0, y: 8 }}>
              <div className="section-heading">
                <div><span className="eyebrow">MODALIDADES</span><h2>Administra los patrones del juego.</h2><p>Inhabilita figuras ya premiadas, reactívalas o elimina patrones personalizados.</p></div>
                <button className="primary-button" onClick={() => setPatternOpen(true)} type="button"><Plus size={17} /> Crear patrón</button>
              </div>
              <section className="active-pattern-hero all-patterns-hero">
                <div>
                  <span className="eyebrow"><Zap size={14} /> VERIFICACIÓN SIMULTÁNEA</span>
                  <h3>{gamePatterns.length} patrones habilitados</h3>
                  <p>Solo las figuras habilitadas se verifican con cada bolilla. Los cambios afectan únicamente al juego actual.</p>
                  <div><b>{BUILTIN_PATTERNS.length} oficiales</b><b>{state.customPatterns.length} personalizados</b><b>{state.disabledPatternIds.length} inhabilitados</b></div>
                </div>
                <div className="pattern-stack-preview">
                  {gamePatterns.slice(0, 4).map((pattern) => <PatternMini key={pattern.id} pattern={pattern} />)}
                </div>
              </section>
              <div className="pattern-grid">
                {availablePatterns.map((pattern) => {
                  const enabled = !state.disabledPatternIds.includes(pattern.id);
                  const hasWinner = state.winners.some((winner) => winner.patternId === pattern.id);
                  return (
                  <article className={`pattern-card ${enabled ? "active" : "disabled"}`} key={pattern.id}>
                      <div className="pattern-card-top"><PatternMini pattern={pattern} /><span>{enabled ? <Check size={14} /> : <Pause size={14} />} {enabled ? "En juego" : "Inhabilitado"}</span></div>
                      <strong>{pattern.name}</strong>
                      <p>{pattern.description}</p>
                      {hasWinner && <div className="pattern-winner-note"><Trophy size={13} /> Ya tiene ganador</div>}
                      <div className="pattern-actions">
                        <button className={enabled ? "ghost-button" : "secondary-button"} onClick={() => void togglePattern(pattern, !enabled)} type="button">
                          {enabled ? "Inhabilitar" : "Habilitar"}
                        </button>
                        {pattern.custom && <button className="icon-button danger-button" onClick={() => void deletePattern(pattern)} title="Eliminar patrón" type="button"><Trash2 size={15} /></button>}
                      </div>
                      <footer><span>{pattern.category}</span><span>{pattern.difficulty}</span></footer>
                  </article>
                  );
                })}
              </div>
            </motion.div>
          )}

          {view === "reports" && (
            <motion.div animate={{ opacity: 1, y: 0 }} className="view-stack" initial={{ opacity: 0, y: 8 }}>
              <div className="section-heading">
                <div><span className="eyebrow">INFORMES Y CONTROL</span><h2>Todo queda registrado.</h2><p>Exporta la partida actual y consulta sus indicadores clave.</p></div>
              </div>
              <div className="report-grid">
                <button onClick={exportPdf} type="button"><span className="report-icon pdf"><FileText size={23} /></span><div><strong>Reporte PDF</strong><p>Resumen ejecutivo, bolillas y ganadores.</p></div><Download size={18} /></button>
                <button onClick={() => void exportExcel()} type="button"><span className="report-icon excel"><FileSpreadsheet size={23} /></span><div><strong>Libro Excel</strong><p>Hojas separadas para cartones, bolillas y ganadores.</p></div><Download size={18} /></button>
                <button onClick={exportCsv} type="button"><span className="report-icon csv"><BookOpen size={23} /></span><div><strong>Archivo CSV</strong><p>Datos compatibles con cualquier sistema.</p></div><Download size={18} /></button>
              </div>
              <section className="panel winning-cards-report">
                <div className="panel-heading">
                  <div><span className="eyebrow">CARTONES GANADORES</span><h3>Tabla y patrón premiado</h3></div>
                  <span className="winner-count">{state.winners.length}</span>
                </div>
                {state.winners.length ? (
                  <div className="winning-cards-grid">
                    {state.winners.map((winner) => {
                      const card = state.cards.find((item) => item.id === winner.cardId);
                      const pattern = [...availablePatterns, COMPACT_CARD_PATTERN].find((item) => item.id === winner.patternId);
                      if (!card || !pattern) return null;
                      return (
                        <article className="winning-card-report" key={winner.id}>
                          <header><span><Trophy size={15} /> Cartón #{winner.cardNumber}</span><b>{winner.patternName}</b></header>
                          <BingoGrid called={called} compact grid={card.grid} pattern={pattern} />
                          <footer><span>{card.sourceFile}{card.sourcePage ? ` · pág. ${card.sourcePage}` : ""}</span><time>{new Date(winner.validatedAt).toLocaleString("es-EC")}</time></footer>
                        </article>
                      );
                    })}
                  </div>
                ) : (
                  <EmptyState icon={Trophy} text="Cuando exista un bingo se mostrará aquí el cartón completo y la figura ganadora." title="Aún no hay cartones ganadores" />
                )}
              </section>
              <div className="report-summary">
                <section className="panel">
                  <div className="panel-heading"><div><span className="eyebrow">RESUMEN</span><h3>{game.name}</h3></div><span className={`status-pill status-${game.status}`}><i />{game.status}</span></div>
                  <dl>
                    <div><dt>Fecha</dt><dd>{new Date(`${game.date}T12:00:00`).toLocaleDateString("es-EC", { dateStyle: "long" })}</dd></div>
                    <div><dt>Premio</dt><dd>{game.prize || "No especificado"}</dd></div>
                    <div><dt>Patrones activos</dt><dd>{gamePatterns.length}</dd></div>
                    <div><dt>Duración</dt><dd>{formatDuration(elapsed)}</dd></div>
                    <div><dt>Cartones activos</dt><dd>{state.cards.filter((card) => card.status === "active").length}</dd></div>
                    <div><dt>PDF importados</dt><dd>{state.files.length}</dd></div>
                  </dl>
                </section>
                <section className="panel audit-panel">
                  <div className="panel-heading"><div><span className="eyebrow">TRAZABILIDAD</span><h3>Eventos de la partida</h3></div><ShieldCheck size={20} /></div>
                  <div className="audit-list">
                    {state.draws.slice(-6).reverse().map((draw) => (
                      <div key={draw.id}><i /><div><strong>Bolilla {draw.number} registrada</strong><span>Validación automática completada</span></div><time>{new Date(draw.drawnAt).toLocaleTimeString("es-EC", { hour: "2-digit", minute: "2-digit" })}</time></div>
                    ))}
                    {!state.draws.length && <EmptyState icon={History} text="Los movimientos aparecerán al comenzar el juego." title="Sin actividad todavía" />}
                  </div>
                </section>
              </div>
            </motion.div>
          )}

          {view === "memberships" && state.access.role === "admin" && (
            <motion.div animate={{ opacity: 1, y: 0 }} className="view-stack" initial={{ opacity: 0, y: 8 }}>
              <div className="section-heading">
                <div><span className="eyebrow">ADMINISTRACIÓN</span><h2>Usuarios y membresías</h2><p>Aprueba solicitudes, controla la vigencia y restablece el dispositivo autorizado.</p></div>
                <a className="secondary-button" href={`https://wa.me/${WHATSAPP_NUMBER}`} rel="noreferrer" target="_blank"><MessageCircle size={16} /> WhatsApp de soporte</a>
              </div>
              <div className="membership-stats">
                <StatCard accent="amber" detail="Requieren revisión" icon={Clock3} label="Pendientes" value={(state.memberships ?? []).filter((item) => item.status === "pending").length} />
                <StatCard accent="mint" detail="Con vigencia" icon={ShieldCheck} label="Aprobados" value={(state.memberships ?? []).filter((item) => item.status === "approved").length} />
                <StatCard accent="blue" detail="Un equipo por cuenta" icon={UserRound} label="Dispositivos vinculados" value={(state.memberships ?? []).filter((item) => item.deviceBound).length} />
              </div>
              <section className="panel membership-admin-panel">
                <div className="panel-heading"><div><span className="eyebrow">SOLICITUDES</span><h3>Control de acceso</h3></div><span className="secure-badge"><ShieldCheck size={14} /> Administrador</span></div>
                <div className="membership-list">
                  {(state.memberships ?? []).map((membership) => (
                    <article key={membership.id}>
                      <span className={`membership-status status-${membership.status}`}>{membership.status}</span>
                      <div><strong>{membership.name || "Sin nombre"}</strong><small>{membership.email}</small></div>
                      <div><b>{membership.months || 1} mes(es)</b><small>{membership.expiresAt ? `Hasta ${new Date(membership.expiresAt).toLocaleDateString("es-EC")}` : "Sin activar"}</small>{membership.accessCode && !membership.activationVerified && <code className="membership-code">Código: {membership.accessCode}</code>}</div>
                      <div className="membership-actions">
                        {membership.status !== "approved" && <label className="months-control"><span>Meses</span><input min={1} max={120} onChange={(event) => setMembershipMonths((current) => ({ ...current, [membership.id]: Math.max(1, Math.min(120, Number(event.target.value) || 1)) }))} type="number" value={membershipMonths[membership.id] ?? membership.months ?? 1} /></label>}
                        {membership.status !== "approved" && <button className="primary-button compact" onClick={() => void manageMembership(membership, "approveMembership")} type="button">Aprobar</button>}
                        {membership.status === "approved" && membership.accessCode && !membership.activationVerified && <button className="secondary-button compact" onClick={() => { void navigator.clipboard?.writeText(membership.accessCode || ""); notify("Código copiado."); }} type="button">Copiar código</button>}
                        {membership.status === "approved" && <button className="secondary-button compact" onClick={() => void manageMembership(membership, "resendMembershipCode")} type="button">Reenviar código</button>}
                        {membership.deviceBound && <button className="secondary-button compact" onClick={() => void manageMembership(membership, "resetMembershipDevice")} type="button">Cambiar dispositivo</button>}
                        {membership.status === "pending" && <button className="ghost-button compact" onClick={() => void manageMembership(membership, "rejectMembership")} type="button">Rechazar</button>}
                      </div>
                    </article>
                  ))}
                  {!(state.memberships ?? []).length && <EmptyState icon={UserRound} text="Las solicitudes nuevas aparecerán aquí para su aprobación." title="No hay usuarios registrados" />}
                </div>
              </section>
            </motion.div>
          )}
        </div>
      </section>

      <AnimatePresence>
        {manualOpen && (
          <motion.div animate={{ opacity: 1 }} className="modal-backdrop" exit={{ opacity: 0 }} initial={{ opacity: 0 }}>
            <motion.section animate={{ opacity: 1, scale: 1, y: 0 }} className="modal manual-modal" exit={{ opacity: 0, scale: 0.98, y: 12 }} initial={{ opacity: 0, scale: 0.98, y: 12 }}>
              <header><div><span className="eyebrow">INGRESO MANUAL</span><h2>Crear un cartón</h2></div><button className="icon-button" onClick={() => setManualOpen(false)} type="button"><X size={19} /></button></header>
              <div className="manual-layout">
                <div className="manual-fields">
                  <label>Número del cartón<input onChange={(event) => setManualNumber(event.target.value)} placeholder="Ej. A-001" value={manualNumber} /></label>
                  <label>Serie <small>opcional</small><input onChange={(event) => setManualSerial(event.target.value)} placeholder="Ej. LOTE-2026" value={manualSerial} /></label>
                  <div className="manual-note"><ShieldCheck size={17} /><p><strong>Validación automática</strong>Comprobaremos casillas vacías, duplicados y números fuera de rango.</p></div>
                  <label className="free-toggle"><input checked={manualGrid[12] === "0"} onChange={(event) => setManualGrid((current) => current.map((value, index) => index === 12 ? (event.target.checked ? "0" : "") : value))} type="checkbox" /><span /><div><strong>Centro libre</strong><small>La casilla central contará como marcada.</small></div></label>
                </div>
                <div className="manual-grid">
                  <div className="manual-bingo-head">{BINGO.map((letter) => <span key={letter}>{letter}</span>)}</div>
                  <div>
                    {manualGrid.map((value, index) => (
                      <input
                        aria-label={`Casilla ${index + 1}`}
                        className={index === 12 && value === "0" ? "free" : ""}
                        disabled={index === 12 && value === "0"}
                        inputMode="numeric"
                        key={index}
                        max="90"
                        min="1"
                        onChange={(event) => setManualGrid((current) => current.map((item, cell) => cell === index ? event.target.value.replace(/\D/g, "").slice(0, 2) : item))}
                        placeholder={index === 12 ? "LIBRE" : "—"}
                        value={index === 12 && value === "0" ? "LIBRE" : value}
                      />
                    ))}
                  </div>
                </div>
              </div>
              <footer><button className="ghost-button" onClick={() => setManualOpen(false)} type="button">Cancelar</button><button className="primary-button" onClick={() => void saveManualCard()} type="button"><Check size={17} /> Guardar cartón</button></footer>
            </motion.section>
          </motion.div>
        )}

        {patternOpen && (
          <motion.div animate={{ opacity: 1 }} className="modal-backdrop" exit={{ opacity: 0 }} initial={{ opacity: 0 }}>
            <motion.section animate={{ opacity: 1, scale: 1, y: 0 }} className="modal pattern-modal" exit={{ opacity: 0, scale: 0.98, y: 12 }} initial={{ opacity: 0, scale: 0.98, y: 12 }}>
              <header><div><span className="eyebrow">EDITOR VISUAL</span><h2>Nuevo patrón</h2></div><button className="icon-button" onClick={() => setPatternOpen(false)} type="button"><X size={19} /></button></header>
              <div className="pattern-editor">
                <div>
                  <BingoGrid editable onCellClick={(index) => setPatternCells((current) => current.includes(index) ? current.filter((cell) => cell !== index) : [...current, index])} selected={patternCells} />
                  <p>Selecciona todas las casillas necesarias para ganar.</p>
                </div>
                <div className="form-stack">
                  <label>Nombre<input onChange={(event) => setPatternName(event.target.value)} placeholder="Ej. La flecha" value={patternName} /></label>
                  <label>Descripción<textarea onChange={(event) => setPatternDescription(event.target.value)} placeholder="Describe la figura y sus reglas…" rows={3} value={patternDescription} /></label>
                  <label>Color de acento<div className="color-field"><input onChange={(event) => setPatternColor(event.target.value)} type="color" value={patternColor} /><span>{patternColor.toUpperCase()}</span></div></label>
                  <div className="selection-count"><Sparkles size={18} /><div><strong>{patternCells.length} casillas seleccionadas</strong><span>Dificultad estimada: {patternCells.length > 12 ? "Alta" : patternCells.length > 7 ? "Media" : "Fácil"}</span></div></div>
                </div>
              </div>
              <footer><button className="ghost-button" onClick={() => setPatternOpen(false)} type="button">Cancelar</button><button className="primary-button" onClick={() => void saveCustomPattern()} type="button"><Check size={17} /> Guardar patrón</button></footer>
            </motion.section>
          </motion.div>
        )}

        {winnerModal.length > 0 && (
          <motion.div animate={{ opacity: 1 }} className="modal-backdrop winner-backdrop" exit={{ opacity: 0 }} initial={{ opacity: 0 }}>
            <motion.section animate={{ opacity: 1, scale: 1, y: 0 }} className="winner-modal" exit={{ opacity: 0, scale: 0.92, y: 24 }} initial={{ opacity: 0, scale: 0.92, y: 24 }}>
              <div className="winner-rays" />
              <span className="winner-trophy"><Trophy size={38} /></span>
              <span className="eyebrow">VALIDACIÓN COMPLETA</span>
              <h2>¡BINGO!</h2>
              <p>{winnerModal.length > 1 ? `Existen ${winnerModal.length} cartones ganadores.` : "Tenemos un cartón ganador."}</p>
              <div className="winner-details">
                {winnerModal.map((winner) => {
                  const card = state.cards.find((item) => item.id === winner.cardId);
                  return (
                    <div key={winner.id}>
                      <span>#{winner.cardNumber}</span>
                      <div><strong>{winner.patternName}</strong><small>{card?.sourceFile} {card?.sourcePage ? `· página ${card.sourcePage}` : "· ingreso manual"}</small></div>
                      <time>{new Date(winner.validatedAt).toLocaleTimeString("es-EC")}</time>
                    </div>
                  );
                })}
              </div>
              <div className="winner-actions">
                <button className="ghost-button" onClick={() => { setWinnerModal([]); setView("reports"); }} type="button"><FileText size={16} /> Ver reporte</button>
                <button className="secondary-button" onClick={() => { setWinnerModal([]); setView("patterns"); }} type="button"><Sparkles size={16} /> Ver patrones</button>
                <button className="secondary-button" onClick={() => void disableWinningPatterns()} type="button"><Pause size={16} /> Inhabilitar patrón</button>
                <button className="primary-button" onClick={() => void continueAfterWin()} type="button"><Play size={17} /> Continuar jugando</button>
              </div>
            </motion.section>
          </motion.div>
        )}

        {gameOpen && (
          <motion.div animate={{ opacity: 1 }} className="modal-backdrop" exit={{ opacity: 0 }} initial={{ opacity: 0 }}>
            <motion.section animate={{ opacity: 1, scale: 1 }} className="modal small-modal" exit={{ opacity: 0, scale: 0.98 }} initial={{ opacity: 0, scale: 0.98 }}>
              <header><div><span className="eyebrow">PARTIDA ACTUAL</span><h2>Editar información</h2></div><button className="icon-button" onClick={() => setGameOpen(false)} type="button"><X size={19} /></button></header>
              <div className="form-stack">
                <label>Nombre<input onChange={(event) => setGameDraft({ ...gameDraft, name: event.target.value })} value={gameDraft.name} /></label>
                <div className="form-row"><label>Fecha<input onChange={(event) => setGameDraft({ ...gameDraft, date: event.target.value })} type="date" value={gameDraft.date} /></label><label>Premio<input onChange={(event) => setGameDraft({ ...gameDraft, prize: event.target.value })} placeholder="Ej. Premio mayor" value={gameDraft.prize} /></label></div>
                <label>Observaciones<textarea onChange={(event) => setGameDraft({ ...gameDraft, notes: event.target.value })} rows={3} value={gameDraft.notes} /></label>
              </div>
              <footer><button className="ghost-button" onClick={() => setGameOpen(false)} type="button">Cancelar</button><button className="primary-button" onClick={() => void saveGame()} type="button">Guardar cambios</button></footer>
            </motion.section>
          </motion.div>
        )}

        {settingsOpen && (
          <>
            <motion.button animate={{ opacity: 1 }} aria-label="Cerrar configuración" className="drawer-backdrop" exit={{ opacity: 0 }} initial={{ opacity: 0 }} onClick={() => setSettingsOpen(false)} type="button" />
            <motion.aside animate={{ x: 0 }} className="settings-drawer" exit={{ x: "100%" }} initial={{ x: "100%" }}>
              <header><div><span className="eyebrow">PREFERENCIAS</span><h2>Configuración</h2></div><button className="icon-button" onClick={() => setSettingsOpen(false)} type="button"><X size={19} /></button></header>
              <section><span className="settings-label">APARIENCIA</span><div className="theme-picker"><button className={theme === "dark" ? "active" : ""} onClick={() => setTheme("dark")} type="button"><Moon size={18} /> Oscuro</button><button className={theme === "light" ? "active" : ""} onClick={() => setTheme("light")} type="button"><Sun size={18} /> Claro</button></div></section>
              <section><span className="settings-label">COMPORTAMIENTO</span><label className="setting-row"><span><Volume2 size={18} /></span><div><strong>Sonidos</strong><small>Bolillas y anuncio de ganador</small></div><input checked={sound} onChange={(event) => setSound(event.target.checked)} type="checkbox" /></label><label className="setting-row"><span><Pause size={18} /></span><div><strong>Pausa automática</strong><small>Detener al detectar un bingo</small></div><input checked={game.autoPause} onChange={(event) => void updateAutoPause(event.target.checked)} type="checkbox" /></label></section>
              <section className="system-status"><span className="settings-label">ESTADO DEL SISTEMA</span><div><ShieldCheck size={20} /><p><strong>Todo operativo</strong><small>Datos persistentes y validación en tiempo real.</small></p></div></section>
              <section><span className="settings-label">CUENTA</span><div className="account-summary"><UserRound size={18} /><div><strong>{authUser.email}</strong><small>{state.access.role === "admin" ? "Administrador" : "Usuario aprobado"}</small></div></div><button className="secondary-button account-signout" onClick={() => void supabase.auth.signOut()} type="button">Cerrar sesión</button></section>
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      <div className="toast-stack">
        <AnimatePresence>
          {toasts.map((toast) => (
            <motion.div animate={{ opacity: 1, x: 0 }} className={`toast toast-${toast.tone}`} exit={{ opacity: 0, x: 24 }} initial={{ opacity: 0, x: 24 }} key={toast.id}>
              {toast.tone === "success" ? <Check size={17} /> : <AlertTriangle size={17} />}
              <span>{toast.message}</span>
              <button onClick={() => setToasts((current) => current.filter((item) => item.id !== toast.id))} type="button"><X size={15} /></button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </main>
  );
}
