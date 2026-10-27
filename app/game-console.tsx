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
import type { Session, User } from "@supabase/supabase-js";
import {
  BUILTIN_PATTERNS,
  COMPACT_CARD_PATTERN,
  additionalPatternForCard,
  cardContentSignature,
  deduplicateBingoCards,
  cardProgress,
  cardLayoutFor,
  createCardLayout,
  formatDuration,
  patternsForCard,
  validateBingoCard,
  winningPatternsForCard,
  type AppState,
  type AccessState,
  type BingoCard,
  type CardLayout,
  type CardType,
  type BingoPattern,
  type Draw,
  type Game,
  type Membership,
  type Winner,
} from "@/lib/bingo";
import { getBingoSourcePageCount, identifyBingoSource, parseBingoFile, parseBingoPdf, type BingoSourceKind, type PdfParseProgress } from "@/lib/pdf-parser";
import { parseProMaxPackage, type ProMaxImportResult } from "@/lib/promax-package";
import { authorizationHeaders, supabase } from "@/lib/supabase-client";

type View = "dashboard" | "cards" | "patterns" | "reports" | "memberships";
type Toast = { id: string; tone: "success" | "warning" | "error"; message: string };
type PatternFilter = "all" | "cartones" | "numeros" | "adicionales";
type CardFilter = "all" | "5x5" | "sabrositos" | "numeros" | "adicionales";
type PageSelectionDraft = { id: string; file: File; kind: BingoSourceKind; pageCount: number; selectedPages: number[] };
const ACCENT_THEMES = [
  { id: "lime", label: "Lima neón", color: "#d7ff3f" },
  { id: "cyan", label: "Cian eléctrico", color: "#35f2ff" },
  { id: "pink", label: "Magenta láser", color: "#ff4fd8" },
  { id: "violet", label: "Violeta neón", color: "#b46bff" },
  { id: "blue", label: "Azul plasma", color: "#4d91ff" },
  { id: "emerald", label: "Verde radioactivo", color: "#43ff91" },
  { id: "celestial-gold", label: "Dorado celestial · 36 quilates", color: "#ffd34e" },
] as const;
type AccentTheme = typeof ACCENT_THEMES[number]["id"];

const initialGrid: string[] = Array.from({ length: 25 }, (_, index) => (index === 12 ? "0" : ""));
const BINGO = ["B", "I", "N", "G", "O"];
const ADMIN_EMAIL = "byvera198@gmail.com";
const ADMIN_EMAILS = ["byvera198@gmail.com", "bveraalvear@gmail.com"];
const ADMIN_WHATSAPP = "593985280991";
const PROMAX_IMPORT_CHUNK_SIZE = 500;

function sortPatternsNaturally(patterns: BingoPattern[]) {
  return [...patterns].sort((left, right) =>
    left.name.localeCompare(right.name, "es", { numeric: true, sensitivity: "base" })
    || left.id.localeCompare(right.id, "es", { numeric: true, sensitivity: "base" }),
  );
}

function temporaryCardsStorageKey(email: string, gameId: string) {
  return `bingopromax:temporary-cards:v1:${email.trim().toLowerCase()}:${gameId}`;
}

function readTemporaryCards(storageKey: string): BingoCard[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(storageKey) ?? "null");
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((value): BingoCard[] => {
      if (!value || typeof value !== "object") return [];
      const card = value as Partial<BingoCard>;
      if (
        typeof card.id !== "string" || !card.id ||
        typeof card.number !== "string" ||
        !Array.isArray(card.grid) || card.grid.length < 5 ||
        !card.grid.every((cell) => Number.isInteger(cell) && cell >= 0 && cell <= 90)
      ) return [];
      return [{
        ...card,
        serial: card.serial ?? "",
        sourceFile: card.sourceFile ?? "Importación temporal",
        sourcePage: card.sourcePage ?? 0,
        status: card.status === "void" ? "void" : "active",
        layout: cardLayoutFor(card as BingoCard),
      } as BingoCard];
    });
  } catch {
    return [];
  }
}

const CARD_TYPE_OPTIONS: Array<{ value: CardType; label: string }> = [
  { value: "classic-5x5", label: "Tradicional 5×5" },
  { value: "linea-5", label: "Línea de 5 números" },
  { value: "loco-10", label: "Llena el loco (10 números)" },
  { value: "loco-11", label: "Llena el loco (11 números)" },
  { value: "yapa-3x3", label: "Yapa 3×3" },
  { value: "sabrosito-5", label: "Sabrosito (5 números)" },
  { value: "eche-leche-7", label: "Eche leche (7 números)" },
  { value: "bom-bom-8", label: "Bom bom bum (8 números)" },
  { value: "keke-keke-6", label: "Keke Keke (6 números)" },
  { value: "avion-9", label: "Avión (9 números)" },
  { value: "flecha-9", label: "Flecha (9 números)" },
  { value: "espada-7", label: "Espada (7 números)" },
  { value: "pesa-7", label: "Pesa (7 números)" },
  { value: "rombo-8", label: "Rombo (8 números)" },
  { value: "bomba-8", label: "Bomba (8 números)" },
  { value: "custom", label: "Estructura personalizada" },
];

type CardEditorMode = "import" | "saved";

function resizeCardGrid(grid: number[], size: number, type: CardType) {
  return Array.from({ length: size }, (_, index) => {
    if (type === "classic-5x5" && index === 12) return grid[index] === 0 ? 0 : grid[index] ?? 0;
    return grid[index] && grid[index] > 0 ? grid[index] : 0;
  });
}

function cardFilterFor(card: BingoCard): Exclude<CardFilter, "all"> {
  if (card.grid.length === 25) return "5x5";
  const layoutType = String(card.layout?.type ?? "").toLowerCase();
  if (layoutType.includes("sabrosito")) return "sabrositos";
  // Number sheets are imported as sparse custom layouts (their grid contains
  // only the occupied cells), so they cannot be identified by grid length.
  // Use the canonical layout name as the classification source and keep the
  // numbered glyphs out of the generic additional-games filter.
  const layoutName = String(card.layout?.name ?? "").trim().toLocaleLowerCase("es");
  if (/^n[uú]mero\s+[1-9]\b/.test(layoutName) || /^forma\s+(?:[134579]|[+=])\b/.test(layoutName)) {
    return "numeros";
  }
  const additional = additionalPatternForCard(card);
  const category = additional?.category.toLocaleLowerCase("es") ?? "";
  if (category === "números" || category === "numeros" || additional?.name.toLocaleLowerCase("es").startsWith("número")) return "numeros";
  return "adicionales";
}

function cardEditorCanvas(card: BingoCard) {
  const layout = cardLayoutFor(card);
  if (card.grid.length === 25) return Array.from({ length: 25 }, (_, index) => card.grid[index] ?? 0);
  const canvas = Array.from({ length: 25 }, () => 0);
  layout.cells.forEach((cell, index) => {
    const position = cell.row * 5 + cell.column;
    if (position >= 0 && position < canvas.length) canvas[position] = card.grid[index] ?? 0;
  });
  return canvas;
}

function cardGridForLayout(canvas: number[], layout: CardLayout) {
  if (layout.type === "classic-5x5" || (layout.rows === 5 && layout.columns === 5)) {
    return Array.from({ length: 25 }, (_, index) => canvas[index] ?? 0);
  }
  return layout.cells.map((cell) => canvas[cell.row * 5 + cell.column] ?? 0);
}

function deviceId() {
  const key = "bingo-device-id";
  let id = localStorage.getItem(key);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(key, id);
  }
  return id;
}

function createDemoState(): AppState {
  const now = new Date().toISOString();
  const pattern = BUILTIN_PATTERNS[0];
  return {
    game: { id: "demo", name: "Partida demo", date: now.slice(0, 10), prize: "Demostración", status: "ready", notes: "", activePatternId: pattern.id, activePatternName: pattern.name, activePatternCells: pattern.cells, autoPause: true, startedAt: null, createdAt: now, updatedAt: now },
    cards: [], draws: [], winners: [], customPatterns: [], disabledPatternIds: [], deletedPatternIds: [], files: [],
    access: { allowed: true, role: "member", email: "demo@bingocontrol.local", reason: "Modo demostración: máximo 20 bolillas." }, memberships: [],
  };
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
  layout,
  called,
  pattern,
  compact = false,
  editable = false,
  selected = [],
  showPending = true,
  onCellClick,
}: {
  grid?: number[];
  layout?: CardLayout;
  called?: Set<number>;
  pattern?: BingoPattern;
  compact?: boolean;
  editable?: boolean;
  selected?: number[];
  showPending?: boolean;
  onCellClick?: (index: number) => void;
}) {
  if (grid?.length === 5 && (!layout || layout.type === "sabrosito-5")) {
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
  if (layout && layout.type !== "classic-5x5") {
    return (
      <div
        className={`variable-card-grid ${layout.cellShape ? `cell-${layout.cellShape}` : ""} ${compact ? "compact" : ""} ${showPending ? "" : "hide-pending"}`}
        style={{ gridTemplateColumns: `repeat(${layout.columns}, minmax(0, 1fr))` }}
      >
        {layout.cells.map((cell, index) => {
          const value = grid?.[index] ?? 0;
          const marked = Boolean(called?.has(value));
          const target = Boolean(pattern?.cells.includes(index) || selected.includes(index));
          return (
            <button
              aria-label={`Casilla ${index + 1}`}
              className={`bingo-cell ${marked ? "marked" : ""} ${target ? "target" : ""}`}
              disabled={!editable}
              key={index}
              onClick={() => onCellClick?.(index)}
              style={{ gridColumn: cell.column + 1, gridRow: cell.row + 1 }}
              type="button"
            >
              {editable ? (selected.includes(index) ? <Check size={16} /> : "") : value > 0 ? value : "?"}
            </button>
          );
        })}
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
  onEdit,
  showCalled = true,
  showPattern = true,
  showPending = true,
}: {
  card: BingoCard;
  called: Set<number>;
  patterns: BingoPattern[];
  wins?: Winner[];
  onToggleStatus?: (card: BingoCard) => void;
  onDelete?: (card: BingoCard) => void;
  onEdit?: (card: BingoCard) => void;
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
          <span>Número del cartón</span>
          <strong className="ticket-number" title={card.number}>#{card.number}</strong>
          <small className="ticket-page">{card.sourcePage ? `Página ${card.sourcePage}` : "Página no indicada"}</small>
        </div>
        <div className="ticket-actions">
          {onEdit && (
            <button className="icon-button small" title="Editar cartón" type="button" onClick={() => onEdit(card)}>
              <PencilLine size={15} />
            </button>
          )}
          {onToggleStatus && <button className="icon-button small" title={card.status === "active" ? "Anular cartón" : "Reactivar cartón"} type="button" onClick={() => onToggleStatus(card)}>
            <MoreHorizontal size={17} />
          </button>}
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
        layout={card.layout}
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
  const [demoMode, setDemoMode] = useState(false);
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
  const [cardFilter, setCardFilter] = useState<CardFilter>("all");
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [nowTick, setNowTick] = useState(0);
  const [theme, setTheme] = useState<"dark" | "light">(() =>
    typeof window !== "undefined" && localStorage.getItem("bingo-theme") === "light" ? "light" : "dark",
  );
  const [accentTheme, setAccentTheme] = useState<AccentTheme>(() => {
    if (typeof window === "undefined") return "lime";
    const saved = localStorage.getItem("bingo-accent-theme");
    return ACCENT_THEMES.some((option) => option.id === saved) ? saved as AccentTheme : "lime";
  });
  const [sound, setSound] = useState(() =>
    typeof window === "undefined" || localStorage.getItem("bingo-sound") !== "off",
  );
  const [processingFiles, setProcessingFiles] = useState(false);
  const [preparingPageSelection, setPreparingPageSelection] = useState(false);
  const [pageSelectionOpen, setPageSelectionOpen] = useState(false);
  const [pageSelectionDrafts, setPageSelectionDrafts] = useState<PageSelectionDraft[]>([]);
  const [pdfProgress, setPdfProgress] = useState<(PdfParseProgress & { file: string }) | null>(null);
  const [importWarnings, setImportWarnings] = useState<string[]>([]);
  const [importDrafts, setImportDrafts] = useState<BingoCard[]>([]);
  const [importPages, setImportPages] = useState(0);
  const [importReviewOpen, setImportReviewOpen] = useState(false);
  const [proMaxImport, setProMaxImport] = useState<ProMaxImportResult | null>(null);
  const [proMaxImportBusy, setProMaxImportBusy] = useState(false);
  const [proMaxImportProgress, setProMaxImportProgress] = useState<{ completed: number; total: number } | null>(null);
  const [syncProMaxPatterns, setSyncProMaxPatterns] = useState(true);
  const [cardEditorMode, setCardEditorMode] = useState<CardEditorMode>("saved");
  const [cardDraft, setCardDraft] = useState<BingoCard | null>(null);
  const [manualNumber, setManualNumber] = useState("");
  const [manualSerial, setManualSerial] = useState("");
  const [manualGrid, setManualGrid] = useState(initialGrid);
  const [patternName, setPatternName] = useState("");
  const [patternDescription, setPatternDescription] = useState("");
  const [patternCells, setPatternCells] = useState<number[]>([10, 11, 12, 13, 14]);
  const [patternColor, setPatternColor] = useState("#d7ff3f");
  const [editingPattern, setEditingPattern] = useState<BingoPattern | null>(null);
  const [selectedPatternIds, setSelectedPatternIds] = useState<string[]>([]);
  const [patternFilter, setPatternFilter] = useState<PatternFilter>("all");
  const [patternLimit, setPatternLimit] = useState(60);
  const [gameDraft, setGameDraft] = useState({ name: "", date: "", prize: "", notes: "" });
  const [membershipName, setMembershipName] = useState("");
  const [membershipPlan, setMembershipPlan] = useState<Membership["plan"]>("monthly");
  const [membershipReceipt, setMembershipReceipt] = useState("");
  const [membershipPhone, setMembershipPhone] = useState("");
  const [membershipChannel, setMembershipChannel] = useState<"email" | "whatsapp">("email");
  const [cardLayers, setCardLayers] = useState({ called: true, pattern: true, pending: true });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const proMaxFileInputRef = useRef<HTMLInputElement>(null);
  const temporaryCardsRef = useRef(new Map<string, BingoCard>());
  const temporaryGameIdRef = useRef<string | null>(null);
  const temporaryOwnerEmailRef = useRef<string | null>(null);
  const temporaryStorageKeyRef = useRef<string | null>(null);

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
      const ownerEmail = (payload.access?.email ?? "").trim().toLowerCase();
      const storageKey = temporaryCardsStorageKey(ownerEmail, payload.game.id);
      const identityChanged =
        temporaryGameIdRef.current !== payload.game.id ||
        temporaryOwnerEmailRef.current !== ownerEmail;
      if (identityChanged) {
        if (
          temporaryStorageKeyRef.current &&
          temporaryOwnerEmailRef.current === ownerEmail &&
          temporaryGameIdRef.current !== payload.game.id
        ) {
          localStorage.removeItem(temporaryStorageKeyRef.current);
        }
        temporaryCardsRef.current.clear();
        temporaryGameIdRef.current = payload.game.id;
        temporaryOwnerEmailRef.current = ownerEmail;
        temporaryStorageKeyRef.current = storageKey;
        if (payload.game.status !== "finished") {
          for (const card of readTemporaryCards(storageKey)) temporaryCardsRef.current.set(card.id, card);
        } else {
          localStorage.removeItem(storageKey);
        }
      } else if (payload.game.status === "finished") {
        temporaryCardsRef.current.clear();
        localStorage.removeItem(storageKey);
      }
      const temporaryCards = deduplicateBingoCards(
        [...temporaryCardsRef.current.values()].filter((card) => !payload.cards.some((saved) => saved.id === card.id)),
        payload.cards,
      ).cards;
      temporaryCardsRef.current = new Map(temporaryCards.map((card) => [card.id, card]));
      setState({ ...payload, cards: [...payload.cards, ...temporaryCards] });
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

  useEffect(() => {
    if (!state) return;
    const storageKey = temporaryCardsStorageKey(state.access?.email ?? "", state.game.id);
    const temporaryIds = new Set(temporaryCardsRef.current.keys());
    const visibleTemporaryCards = state.cards.filter((card) => temporaryIds.has(card.id));
    if (state.game.status === "finished") {
      localStorage.removeItem(storageKey);
      temporaryCardsRef.current.clear();
      if (visibleTemporaryCards.length) {
        setState((current) => current
          ? { ...current, cards: current.cards.filter((card) => !temporaryIds.has(card.id)) }
          : current);
      }
      return;
    }
    try {
      if (visibleTemporaryCards.length) localStorage.setItem(storageKey, JSON.stringify(visibleTemporaryCards));
      else localStorage.removeItem(storageKey);
    } catch {
      // Local cache is best-effort; the PDFs themselves are never stored.
    }
  }, [state]);

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
        const domain = authEmail.trim().toLowerCase().split("@").pop() || "";
        if (["mailinator.com", "10minutemail.com", "guerrillamail.com", "tempmail.com", "yopmail.com", "sharklasers.com", "getnada.com", "emailondeck.com", "trashmail.com"].includes(domain)) throw new Error("Usa tu correo personal real; no se aceptan correos temporales.");
        const { error: authError } = await supabase.auth.signUp({
          email: authEmail.trim(),
          password: authPassword,
          options: {
            emailRedirectTo: window.location.origin,
            data: { name: authName.trim() },
          },
        });
        if (authError) throw authError;
        setAuthMessage("Revisa tu correo para confirmar la cuenta. Después podrás solicitar la aprobación del administrador.");
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

  const signInWithGoogle = async () => {
    setAuthBusy(true);
    setAuthMessage("");
    const { error: authError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin },
    });
    if (authError) {
      setAuthMessage(authError.message || "No se pudo iniciar sesión con Google.");
      setAuthBusy(false);
    }
  };

  const sendDeveloperLink = async () => {
    const email = authEmail.trim().toLowerCase();
    if (!ADMIN_EMAILS.includes(email)) {
      setAuthMessage("El enlace de desarrollador está disponible para las cuentas autorizadas.");
      return;
    }
    setAuthBusy(true);
    setAuthMessage("");
    const { error: authError } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.origin } });
    setAuthBusy(false);
    setAuthMessage(authError ? authError.message : "Enlace enviado. Revisa ese mismo correo y ábrelo para entrar como desarrollador.");
  };

  const requestMembership = async () => {
    if (!access?.email || !membershipName.trim()) {
      setError("Escribe tu nombre para enviar la solicitud.");
      return;
    }
    if (!membershipReceipt.trim()) {
      setError("Ingresa el número de comprobante de la transferencia.");
      return;
    }
    try {
      const result = await api<{ adminEmail: string; subject: string }>({
        action: "requestMembership",
        email: access.email,
        name: membershipName.trim(),
        plan: membershipPlan,
        receiptNumber: membershipReceipt.trim(),
        contactChannel: membershipChannel,
        phone: membershipPhone.trim(),
      });
      const planLabel = membershipPlan === "annual" ? "1 año ($80)" : membershipPlan === "six-months" ? "6 meses ($50)" : "1 mes ($10)";
      const message = `Solicito activar mi cuenta de Bingo Control.\n\nNombre: ${membershipName.trim()}\nCorreo: ${access.email}\nPlan: ${planLabel}\nComprobante: ${membershipReceipt.trim()}\nWhatsApp: ${membershipPhone.trim() || "No indicado"}`;
      if (membershipChannel === "whatsapp") {
        window.open(`https://wa.me/${ADMIN_WHATSAPP}?text=${encodeURIComponent(message)}`, "_blank", "noopener,noreferrer");
      } else {
        window.open(`mailto:${result.adminEmail}?subject=${encodeURIComponent(result.subject)}&body=${encodeURIComponent(message)}`, "_self");
      }
      setAccess({ ...access, role: "pending", reason: "Solicitud enviada. Espera la aprobación del administrador." });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo enviar la solicitud.");
    }
  };

  const manageMembership = async (membership: Membership, action: "approveMembership" | "rejectMembership" | "resetMembershipDevice") => {
    try {
      const result = await api<{ email?: string; phone?: string; expiresAt?: string; activationCode?: string; contactChannel?: string }>({ action, membershipId: membership.id });
      await refresh(true);
      if (action === "approveMembership" && result.email) {
        const planLabel = membership.plan === "annual" ? "1 año ($80)" : membership.plan === "six-months" ? "6 meses ($50)" : "1 mes ($10)";
        const activationMessage = `Tu cuenta fue aprobada.\nPlan: ${planLabel}\nVigencia hasta: ${new Date(result.expiresAt || "").toLocaleDateString("es-EC")}\nCódigo de activación: ${result.activationCode || "Se activa al iniciar sesión"}\n\nIngresa a Bingo Control Pro con este mismo correo. El primer dispositivo quedará vinculado a tu cuenta.`;
        if (result.contactChannel === "whatsapp") window.open(`https://wa.me/${String(result.phone || "").replace(/\D/g, "") || ADMIN_WHATSAPP}?text=${encodeURIComponent(activationMessage)}`, "_blank", "noopener,noreferrer");
        else window.open(`mailto:${result.email}?subject=${encodeURIComponent("Cuenta activada - Bingo Control Pro")}&body=${encodeURIComponent(activationMessage)}`, "_self");
      }
      notify(action === "approveMembership" ? "Usuario aprobado; correo de activación preparado." : action === "rejectMembership" ? "Solicitud rechazada." : "Dispositivo restablecido.");
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : "No se pudo actualizar el usuario.", "error");
    }
  };

  const startDemo = () => {
    setDemoMode(true);
    setState(createDemoState());
    setAccess(createDemoState().access);
    setLoading(false);
  };

  useEffect(() => {
    const bootstrapAuth = async () => {
      let session: Session | null = null;
      try {
        const result = await Promise.race([
          supabase.auth.getSession(),
          new Promise<never>((_, reject) => window.setTimeout(() => reject(new Error("timeout")), 8000)),
        ]);
        session = result.data.session;
      } catch {
        // A stale browser lock must not leave the application on the
        // verification screen forever; show the normal sign-in screen.
      }
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
    document.documentElement.dataset.accentTheme = accentTheme;
    localStorage.setItem("bingo-accent-theme", accentTheme);
  }, [theme, accentTheme]);

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
    () => sortPatternsNaturally([
      ...BUILTIN_PATTERNS,
      ...(state?.customPatterns ?? []),
      ...(state?.cards.some((card) => card.grid.length === 5)
        ? [COMPACT_CARD_PATTERN]
        : []),
    ].filter((pattern) => !(state?.deletedPatternIds ?? []).includes(pattern.id))),
    [state?.cards, state?.customPatterns, state?.deletedPatternIds],
  );
  const patternBucket = useCallback((pattern: BingoPattern): Exclude<PatternFilter, "all"> => {
    const category = pattern.category.toLocaleLowerCase("es");
    if (category === "números" || category === "numeros") return "numeros";
    if (category === "juegos adicionales" || pattern.id === COMPACT_CARD_PATTERN.id) return "adicionales";
    return "cartones";
  }, []);
  const filteredPatterns = useMemo(
    () => patternFilter === "all"
      ? availablePatterns
      : availablePatterns.filter((pattern) => patternBucket(pattern) === patternFilter),
    [availablePatterns, patternBucket, patternFilter],
  );
  const allPatterns = useMemo(
    () => sortPatternsNaturally(availablePatterns.filter(
      (pattern) => !state?.disabledPatternIds.includes(pattern.id),
    )),
    [availablePatterns, state?.disabledPatternIds],
  );
  const gamePatterns = allPatterns;
  const visiblePatterns = useMemo(() => filteredPatterns.slice(0, patternLimit), [filteredPatterns, patternLimit]);
  const patternStatuses = useMemo(
    () =>
      gamePatterns.map((pattern) => {
        const compatibleCards = (state?.cards ?? []).filter(
          (card) => {
            if (card.status !== "active") return false;
            if (pattern.id === COMPACT_CARD_PATTERN.id) return cardLayoutFor(card).type === "sabrosito-5";
            return patternsForCard(card, [pattern]).some((candidate) => candidate.id === pattern.id);
          },
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
      if (demoMode && state.draws.length >= 20) {
        notify("La demostración permite un máximo de 20 bolillas.", "warning");
        setDemoMode(false);
        setState(null);
        setAccess(null);
        setAuthMessage("Terminó tu demostración. Regístrate con tu correo personal para solicitar una membresía.");
        return;
      }
      const number = Number(rawNumber);
      if (!Number.isInteger(number) || number < 1 || number > 75) {
        notify("Ingresa un número entero entre 1 y 75.", "warning");
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
        const result = demoMode
          ? { draw: { id: crypto.randomUUID(), number, drawnAt: new Date().toISOString() } }
          : await api<{ draw: Draw }>({ action: "saveDraw", gameId: game.id, number });
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
          if (!demoMode) await api({ action: "recordWinners", gameId: game.id, winners: detected, autoPause: game.autoPause });
          setWinnerModal(detected);
        }
      } catch (caught) {
        notify(caught instanceof Error ? caught.message : "No se pudo registrar la bolilla.", "error");
      }
    },
    [allPatterns, called, demoMode, game, notify, playTone, state],
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
      if (temporaryCardsRef.current.has(card.id)) {
        temporaryCardsRef.current.set(card.id, { ...card, status });
      } else {
        await api({ action: "updateCardStatus", gameId: state.game.id, cardId: card.id, status });
      }
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
      temporaryCardsRef.current.delete(card.id);
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

  const openCardEditor = (card: BingoCard, mode: CardEditorMode = "saved") => {
    if (mode === "import" && state) {
      const existing = [
        ...state.cards,
        ...importDrafts.filter((candidate) => candidate.id !== card.id),
      ];
      if (!deduplicateBingoCards([card], existing).cards.length) {
        const remaining = importDrafts.filter((candidate) => candidate.id !== card.id);
        setImportDrafts(remaining);
        if (!remaining.length) setImportReviewOpen(false);
        notify("Este cartón ya está cargado o repetido; se omitió sin pedir corrección.", "warning");
        return;
      }
    }
    const layout = cardLayoutFor(card);
    setCardEditorMode(mode);
    setCardDraft({ ...card, layout, grid: cardEditorCanvas(card) });
  };

  const updateCardDraftType = (type: CardType) => {
    if (!cardDraft) return;
    const previous = cardLayoutFor(cardDraft);
    const layout = type === "custom"
      ? (previous.type === "custom" ? previous : createCardLayout("custom", 5, 5))
      : createCardLayout(type);
    setCardDraft((current) => current ? { ...current, layout, grid: cardEditorCanvas(current) } : current);
  };

  const saveCardEdit = async () => {
    if (!state || !cardDraft) return;
    const layout = cardLayoutFor(cardDraft);
    const grid = cardGridForLayout(cardDraft.grid, layout);
    const number = cardDraft.number.trim();
    const errors = validateBingoCard({ grid, layout });
    if (!number) errors.unshift("Asigna un número al cartón.");
    const updated = { ...cardDraft, number, grid, layout, reviewStatus: "ready" as const, reviewNotes: [] };
    if (cardEditorMode === "import") {
      const existing = [
        ...state.cards,
        ...importDrafts.filter((candidate) => candidate.id !== updated.id),
      ];
      if (!deduplicateBingoCards([updated], existing).cards.length) {
        const remaining = importDrafts.filter((card) => card.id !== updated.id);
        setImportDrafts(remaining);
        if (!remaining.length) setImportReviewOpen(false);
        setCardDraft(null);
        notify("Este cartón ya está cargado o repetido; se omitió sin pedir corrección.", "warning");
        return;
      }
    }
    if (state.cards.some((card) => card.id !== cardDraft.id && card.number.trim().toLowerCase() === number.toLowerCase())) {
      errors.unshift("Ya existe un cartón con ese número en esta partida.");
    }
    if (errors.length) {
      setImportWarnings(errors);
      notify(errors[0], "warning");
      return;
    }
    try {
      if (cardEditorMode === "import") {
        setImportDrafts((current) => current.map((card) => card.id === updated.id ? updated : card));
        setCardDraft(null);
        notify(`Cartón #${number} corregido. Revisa y guárdalo en la partida.`);
        return;
      }
      if (temporaryCardsRef.current.has(updated.id)) {
        temporaryCardsRef.current.set(updated.id, updated);
      } else {
        await api({ action: "updateCard", gameId: state.game.id, card: updated });
      }
      setState({ ...state, cards: state.cards.map((card) => card.id === updated.id ? updated : card) });
      setCardDraft(null);
      notify(`Cartón #${number} actualizado como ${layout.name}.`);
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : "No se pudo actualizar el cartón.", "error");
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
      const ids = new Set(voided.map((card) => card.id));
      ids.forEach((id) => temporaryCardsRef.current.delete(id));
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
        deletedPatternIds: (state.deletedPatternIds ?? []).filter((id) => id !== pattern.id),
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
    if (!state || !window.confirm(`¿Eliminar “${pattern.name}” de esta partida? Podrás usarlo en otras partidas.`)) return;
    try {
      await api({ action: "deletePattern", gameId: state.game.id, patternId: pattern.id });
      setState({
        ...state,
        customPatterns: pattern.custom
          ? state.customPatterns.filter((item) => item.id !== pattern.id)
          : state.customPatterns,
        disabledPatternIds: state.disabledPatternIds.filter((id) => id !== pattern.id),
        deletedPatternIds: [...new Set([...(state.deletedPatternIds ?? []), pattern.id])],
      });
      notify(`Patrón “${pattern.name}” eliminado de esta partida.`, "warning");
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : "No se pudo eliminar el patrón.", "error");
    }
  };

  const deleteSelectedPatterns = async () => {
    if (!state || !selectedPatternIds.length) return;
    const selected = availablePatterns.filter((pattern) => selectedPatternIds.includes(pattern.id));
    if (!selected.length || !window.confirm(`¿Eliminar ${selected.length} patrones seleccionados de esta partida?`)) return;
    try {
      await api({ action: "deletePatterns", gameId: state.game.id, patternIds: selected.map((pattern) => pattern.id) });
      const ids = new Set(selected.map((pattern) => pattern.id));
      setState({ ...state, customPatterns: state.customPatterns.filter((pattern) => !ids.has(pattern.id)), disabledPatternIds: state.disabledPatternIds.filter((id) => !ids.has(id)), deletedPatternIds: [...new Set([...(state.deletedPatternIds ?? []), ...ids])] });
      setSelectedPatternIds([]);
      notify(`${selected.length} patrones eliminados.`, "warning");
    } catch (caught) { notify(caught instanceof Error ? caught.message : "No se pudieron eliminar los patrones.", "error"); }
  };

  const createNewGame = async () => {
    // Creating a new game must be a single click operation. Browser prompts
    // can be blocked by embedded browsers and used to leave the previous game
    // visible when the prompt was dismissed or never rendered.
    const date = new Date().toISOString().slice(0, 10);
    const name = `Nueva partida ${date}`;
    try {
      await api({
        action: "createGame",
        name,
        date,
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
    const layout = createCardLayout("classic-5x5");
    const errors = validateBingoCard({ grid, layout });
    if (!manualNumber.trim()) errors.unshift("Asigna un número al cartón.");
    if (state.cards.some((card) => card.number.toLowerCase() === manualNumber.trim().toLowerCase())) {
      errors.unshift("Ya existe un cartón con ese número.");
    }
    const manualSignature = cardContentSignature({ grid, layout });
    if (state.cards.some((card) => cardContentSignature(card) === manualSignature)) {
      errors.unshift("Este cartón ya está cargado en la partida.");
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
      layout,
      reviewStatus: "ready",
    };
    try {
      setState({ ...state, cards: [card, ...state.cards] });
      temporaryCardsRef.current.set(card.id, card);
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

  const legacyProcessFiles = async (files: File[]) => {
    if (!state || !files.length) return;
    const invalid = files.find((file) => file.type !== "application/pdf" && !file.name.endsWith(".pdf"));
    if (invalid) {
      notify(`${invalid.name} no es un archivo PDF.`, "warning");
      return;
    }
    setProcessingFiles(true);
    const warnings: string[] = [];
    const signatures = new Set(state.cards.map(cardContentSignature));
    const usedNumbers = new Set(state.cards.map((card) => card.number.toLowerCase()));
    let imported = 0;
    let duplicateCount = 0;
    try {
      for (const file of files) {
        const parsed = await parseBingoPdf(file, (progress) =>
          setPdfProgress({ ...progress, file: file.name }),
        );
        warnings.push(...parsed.warnings.map((warning) => `${file.name} · ${warning}`));
        const uniqueCards = parsed.cards.filter((card) => {
          const signature = cardContentSignature(card);
          const numberKey = card.number.trim().toLowerCase();
          if (signatures.has(signature) || (numberKey && usedNumbers.has(numberKey))) return false;
          signatures.add(signature);
          if (numberKey) usedNumbers.add(numberKey);
          return true;
        });
        duplicateCount += parsed.cards.length - uniqueCards.length;
        if (!uniqueCards.length) {
          warnings.push(`${file.name}: no se encontraron cartones nuevos para guardar.`);
          continue;
        }
        uniqueCards.forEach((card) => temporaryCardsRef.current.set(card.id, card));
        setState((current) => current
          ? { ...current, cards: [...current.cards, ...uniqueCards] }
          : current);
        imported += uniqueCards.length;
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

  const prepareFilesForImport = async (files: File[]) => {
    if (!state || !files.length || preparingPageSelection || processingFiles) return;
    setPreparingPageSelection(true);
    const warnings: string[] = [];
    const selections: PageSelectionDraft[] = [];
    try {
      for (const file of files) {
        if (file.size > 50 * 1024 * 1024) {
          warnings.push(`${file.name}: excede el límite de 50 MB.`);
          continue;
        }
        try {
          const kind = await identifyBingoSource(file);
          const pageCount = await getBingoSourcePageCount(file);
          selections.push({
            id: crypto.randomUUID(),
            file,
            kind,
            pageCount,
            selectedPages: Array.from({ length: pageCount }, (_, index) => index + 1),
          });
        } catch (caught) {
          warnings.push(`${file.name}: ${caught instanceof Error ? caught.message : "formato no compatible"}`);
        }
      }
      setImportWarnings(warnings);
      setPageSelectionDrafts(selections);
      setPageSelectionOpen(selections.length > 0);
      if (!selections.length && !warnings.length) notify("No se seleccionaron archivos válidos.", "warning");
    } finally {
      setPreparingPageSelection(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const updateSelectedPages = (id: string, nextPages: number[]) => {
    setPageSelectionDrafts((current) => current.map((entry) => entry.id === id
      ? { ...entry, selectedPages: [...new Set(nextPages)].filter((page) => page >= 1 && page <= entry.pageCount).sort((a, b) => a - b) }
      : entry));
  };

  const processSelectedFiles = async () => {
    if (!state) return;
    const filesToProcess = pageSelectionDrafts.filter((entry) => entry.selectedPages.length > 0);
    if (!filesToProcess.length) {
      notify("Selecciona al menos una página para cargar.", "warning");
      return;
    }
    setPageSelectionOpen(false);
    setProcessingFiles(true);
    const warnings: string[] = [];
    const drafts: BingoCard[] = [];
    let pages = 0;
    let duplicateCount = 0;
    try {
      for (const entry of filesToProcess) {
        const parsed = await parseBingoFile(
          entry.file,
          (progress) => setPdfProgress({ ...progress, file: entry.file.name }),
          entry.selectedPages,
        );
        pages += parsed.pages;
        warnings.push(...parsed.warnings.map((warning) => `${entry.file.name} · ${warning}`));
        parsed.cards.forEach((card) => {
          drafts.push({
            ...card,
            reviewStatus: card.reviewStatus === "needs-review" ? "needs-review" : "ready",
            reviewNotes: card.reviewNotes ?? [],
          });
        });
      }
      const unique = deduplicateBingoCards(drafts, state.cards);
      duplicateCount = unique.duplicates;
      const readyDrafts = unique.cards.filter((card) => card.reviewStatus !== "needs-review");
      const pendingDrafts = unique.cards.filter((card) => card.reviewStatus === "needs-review");
      if (readyDrafts.length) {
        // Imported PDF cards are intentionally session-only. Keep them in the
        // active game state without sending the PDF or card rows to D1/R2.
        readyDrafts.forEach((card) => temporaryCardsRef.current.set(card.id, card));
        setState((current) => current
          ? { ...current, cards: [...current.cards, ...readyDrafts] }
          : current);
        notify(`${readyDrafts.length} cartón(es) cargados temporalmente en la partida.`);
      }
      setImportWarnings(warnings);
      setImportDrafts(pendingDrafts);
      setImportPages(pages);
      if (pendingDrafts.length) {
        setImportReviewOpen(true);
        notify(`${pendingDrafts.length} cartón(es) requieren revisión antes de guardarse.`, "warning");
      } else {
        setImportReviewOpen(false);
        if (!readyDrafts.length) notify("No se detectaron cartones válidos para guardar.", "warning");
      }
      if (duplicateCount) {
        warnings.push(`${duplicateCount} cartón(es) repetidos fueron omitidos; no se agregaron a la partida.`);
        setImportWarnings([...warnings]);
        notify(`${duplicateCount} cartón(es) repetidos omitidos.`, "warning");
      }
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "No se pudo completar la importación.";
      warnings.push(message);
      setImportWarnings(warnings);
      notify(message, "error");
    } finally {
      setProcessingFiles(false);
      setPdfProgress(null);
      setPageSelectionDrafts([]);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const inspectProMaxPackage = async (file: File) => {
    setProMaxImportBusy(true);
    try {
      const result = parseProMaxPackage(await file.text());
      setProMaxImport(result);
      setImportWarnings([...result.warnings, ...result.rejected].slice(0, 12));
      notify(`${result.cards.length} cartón(es) listos para importar desde Studio.`);
    } catch (caught) {
      setProMaxImport(null);
      notify(caught instanceof Error ? caught.message : "No se pudo leer el paquete de Studio.", "error");
    } finally {
      setProMaxImportBusy(false);
      if (proMaxFileInputRef.current) proMaxFileInputRef.current.value = "";
    }
  };

  const importProMaxPackage = async () => {
    if (!state || !proMaxImport) return;
    setProMaxImportBusy(true);
    setProMaxImportProgress({ completed: 0, total: proMaxImport.cards.length });
    try {
      const uniqueImport = deduplicateBingoCards(proMaxImport.cards, state.cards);
      const uniqueCards = uniqueImport.cards;
      setState((current) => current
        ? { ...current, cards: [...current.cards, ...uniqueCards] }
        : current);
      uniqueCards.forEach((card) => temporaryCardsRef.current.set(card.id, card));
      setProMaxImportProgress({ completed: uniqueCards.length, total: proMaxImport.cards.length });
      let syncedPatterns = 0;
      if (syncProMaxPatterns && proMaxImport.patterns.length && access?.role === "admin") {
        const patternResult = await api<{ synced: number }>({
          action: "syncPatterns",
          gameId: state.game.id,
          patterns: proMaxImport.patterns,
          activePatternId: proMaxImport.game?.activePatternId ?? "",
        });
        syncedPatterns = patternResult.synced;
      }
      setProMaxImport(null);
      const messages = [...proMaxImport.warnings, ...proMaxImport.rejected];
      setImportWarnings(messages.slice(0, 12));
      if (uniqueCards.length) notify(`${uniqueCards.length} cartón(es) únicos cargados temporalmente desde Studio.`);
      if (uniqueImport.duplicates) notify(`${uniqueImport.duplicates} cartón(es) repetidos de Studio fueron omitidos.`, "warning");
      if (syncedPatterns) notify(`${syncedPatterns} patrón(es) de Studio sincronizados para la partida.`);
    } catch (caught) {
      setImportWarnings((current) => [`La importación temporal se detuvo: ${caught instanceof Error ? caught.message : "error desconocido"}`, ...current]);
      notify(caught instanceof Error ? caught.message : "No se pudo importar el paquete de Studio.", "error");
    } finally {
      setProMaxImportBusy(false);
      setProMaxImportProgress(null);
    }
  };

  const saveImportedCards = async () => {
    if (!state || !importDrafts.length) return;
    // Opening the review is the explicit confirmation for cards that OCR
    // flagged. The API still validates every grid and rejects invalid cards.
    const uniqueReview = deduplicateBingoCards(importDrafts, state.cards);
    const readyCards = uniqueReview.cards.map((card) => ({ ...card, reviewStatus: "ready" as const }));
    const skippedDuplicates = uniqueReview.duplicates;
    try {
      setState((current) => current
        ? { ...current, cards: [...current.cards, ...readyCards] }
        : current);
      readyCards.forEach((card) => temporaryCardsRef.current.set(card.id, card));
      setImportReviewOpen(false);
      setImportDrafts([]);
      const followUp: string[] = [];
      setImportWarnings((current) => [...current, ...followUp]);
      if (readyCards.length) notify(`${readyCards.length} cartón(es) únicos cargados temporalmente en la partida.`);
      if (skippedDuplicates) notify(`${skippedDuplicates} cartón(es) repetidos fueron omitidos y no se agregaron.`, "warning");
      if (followUp.length) notify(followUp[0], "warning");
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : "No se pudieron guardar los cartones.", "error");
    }
  };

  const openPatternEditor = (pattern?: BingoPattern) => {
    setEditingPattern(pattern ?? null);
    setPatternName(pattern?.name ?? "");
    setPatternDescription(pattern?.description ?? "");
    setPatternColor(pattern?.color ?? "#d7ff3f");
    setPatternCells(pattern?.cells ?? [10, 11, 12, 13, 14]);
    setPatternOpen(true);
  };

  const saveCustomPattern = async () => {
    if (!state || !patternName.trim() || !patternCells.length) {
      notify("Escribe un nombre y selecciona al menos una casilla.", "warning");
      return;
    }
    const editingOfficial = Boolean(editingPattern && !editingPattern.custom);
    const pattern: BingoPattern = {
      id: editingOfficial ? `custom-${crypto.randomUUID()}` : (editingPattern?.id ?? `custom-${crypto.randomUUID()}`),
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
      await api({
        action: editingOfficial ? "replacePattern" : (editingPattern ? "updatePattern" : "savePattern"),
        gameId: state.game.id,
        pattern,
        ...(editingOfficial ? { replacesPatternId: editingPattern?.id } : {}),
      });
      setState({
        ...state,
        customPatterns: editingPattern && !editingOfficial
          ? state.customPatterns.map((item) => item.id === pattern.id ? pattern : item)
          : [pattern, ...state.customPatterns],
        deletedPatternIds: editingOfficial && editingPattern
          ? [...new Set([...(state.deletedPatternIds ?? []), editingPattern.id])]
          : state.deletedPatternIds,
        disabledPatternIds: editingOfficial && editingPattern
          ? state.disabledPatternIds.filter((id) => id !== editingPattern.id)
          : state.disabledPatternIds,
      });
      setPatternOpen(false);
      setEditingPattern(null);
      setPatternName("");
      setPatternDescription("");
      setPatternCells([10, 11, 12, 13, 14]);
      notify(`Patrón “${pattern.name}” ${editingPattern ? "actualizado" : "guardado y activo"} en la partida.`);
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
        (card) => {
          const matchesFilter = cardFilter === "all" || cardFilterFor(card) === cardFilter;
          const matchesSearch = !term
            || card.number.toLowerCase().includes(term)
            || card.sourceFile.toLowerCase().includes(term)
            || card.serial?.toLowerCase().includes(term);
          return matchesFilter && matchesSearch;
        },
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
  }, [allPatterns, called, cardFilter, search, state]);

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

  if ((!authUser && !demoMode) || authMode === "update") {
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
          {authMode === "login" && (
            <>
              <div className="auth-divider"><span>o</span></div>
              <button className="secondary-button auth-google" disabled={authBusy} onClick={() => void signInWithGoogle()} type="button">
                Continuar con Google
              </button>
              {ADMIN_EMAILS.includes(authEmail.trim().toLowerCase()) && <button className="secondary-button" disabled={authBusy} onClick={() => void sendDeveloperLink()} type="button">Enviar enlace de desarrollador</button>}
            </>
          )}
          {authMode === "login" && <button className="auth-link" onClick={() => { setAuthMode("recover"); setAuthMessage(""); }} type="button">¿Olvidaste tu contraseña?</button>}
          {authMode === "recover" && <button className="auth-link" onClick={() => { setAuthMode("login"); setAuthMessage(""); }} type="button">Volver al inicio de sesión</button>}
          {authMode === "login" && <button className="secondary-button" onClick={startDemo} type="button">Probar demo — máximo 20 bolillas</button>}
          <small>Desarrolladores: <strong>{ADMIN_EMAILS.join(" y ")}</strong>. Sus enlaces de correo dan control total; los demás registros requieren membresía.</small>
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
    const pending = access.role === "pending";
    return (
      <main className="membership-screen">
        <section className="membership-card">
          <div className="brand membership-brand">
            <div className="brand-mark"><span>B</span><i /></div>
            <div><strong>BINGO</strong><small>CONTROL PRO</small></div>
          </div>
          <span className="eyebrow"><ShieldCheck size={14} /> ACCESO POR MEMBRESÍA</span>
          <h1>{pending ? "Tu acceso está en revisión" : "Solicita tu acceso"}</h1>
          <p>{access.reason || "El administrador debe aprobar tu cuenta antes de ingresar."}</p>
          <div className="membership-email"><UserRound size={17} /><span>{access.email}</span></div>
          {!pending && (
            <div className="form-stack">
              <label>Nombre completo<input onChange={(event) => setMembershipName(event.target.value)} placeholder="Tu nombre" value={membershipName} /></label>
              <label>Número de comprobante<input onChange={(event) => setMembershipReceipt(event.target.value)} placeholder="Ej. 0012345678" value={membershipReceipt} /></label>
              <label>WhatsApp <small>opcional</small><input onChange={(event) => setMembershipPhone(event.target.value)} placeholder="593999999999" value={membershipPhone} /></label>
              <div className="membership-plans">
                <button className={membershipPlan === "monthly" ? "active" : ""} onClick={() => setMembershipPlan("monthly")} type="button"><strong>1 mes</strong><span>$10</span></button>
                <button className={membershipPlan === "six-months" ? "active" : ""} onClick={() => setMembershipPlan("six-months")} type="button"><strong>6 meses</strong><span>$50</span></button>
                <button className={membershipPlan === "annual" ? "active" : ""} onClick={() => setMembershipPlan("annual")} type="button"><strong>1 año</strong><span>$80</span></button>
              </div>
              <div className="membership-payment"><strong>Datos para la transferencia</strong><small>Titular: Byron Vera</small><small>Banco Pichincha · Ahorros 2210107606</small><small>Banco Internacional · Ahorros 1950703151</small><small>Banco Guayaquil · Ahorros 0061962064</small></div>
              <div className="membership-channel"><button className={membershipChannel === "email" ? "active" : ""} onClick={() => setMembershipChannel("email")} type="button">Solicitar por correo</button><button className={membershipChannel === "whatsapp" ? "active" : ""} onClick={() => setMembershipChannel("whatsapp")} type="button">Solicitar por WhatsApp</button></div>
              <button className="primary-button" onClick={() => void requestMembership()} type="button">Solicitar aprobación</button>
            </div>
          )}
          {error && <div className="membership-error">{error}</div>}
          <small>Administración y pagos: <a href={`mailto:${ADMIN_EMAIL}`}>{ADMIN_EMAIL}</a>. Cada cuenta funciona en un solo dispositivo.</small>
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
          <div><strong>{state.access.role === "admin" ? "Administrador" : "Operador"}</strong><span><i /> {authUser?.email || "Modo demo"}</span></div>
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
                <StatCard accent="mint" detail={`${75 - state.draws.length} restantes`} icon={CircleGauge} label="Bolillas sorteadas" value={state.draws.length} />
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
                          max="75"
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
                          {Array.from({ length: 75 }, (_, index) => index + 1).map((number) => (
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
                    <strong>{Math.round((state.draws.length / 75) * 100)}%</strong>
                  </div>
                  {state.draws.length ? (
                    <>
                      <div className="draw-history">
                        {[...state.draws].reverse().slice(0, 18).map((draw, index) => (
                          <span className={index === 0 ? "latest" : ""} key={draw.id}>{draw.number}</span>
                        ))}
                      </div>
                      <div className="game-progress"><span><i style={{ width: `${(state.draws.length / 75) * 100}%` }} /></span><small>{75 - state.draws.length} números restantes</small></div>
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
                <div className="section-actions">{access?.role === "admin" && <><button className="secondary-button" onClick={() => proMaxFileInputRef.current?.click()} type="button"><FileText size={17} /> Importar Studio</button><button className="primary-button" onClick={() => setManualOpen(true)} type="button"><SquarePen size={17} /> Ingreso manual</button></>}</div>
              </div>
              <input
                accept="application/pdf,.pdf,image/jpeg,.jpg,.jpeg,image/png,.png"
                className="visually-hidden"
                multiple
                onChange={(event) => void prepareFilesForImport(Array.from(event.target.files ?? []))}
                ref={fileInputRef}
                type="file"
              />
              {access?.role === "admin" && <input
                accept="application/json,.json"
                className="visually-hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void inspectProMaxPackage(file);
                }}
                ref={proMaxFileInputRef}
                type="file"
              />}
              <section
                className={`upload-zone ${processingFiles ? "processing" : ""}`}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  void prepareFilesForImport(Array.from(event.dataTransfer.files));
                }}
              >
                {preparingPageSelection ? (
                  <>
                    <span className="upload-icon"><LoaderCircle className="spin" size={29} /></span>
                    <div><strong>Preparando selección de páginas</strong><p>Leyendo la cantidad de páginas de cada archivo; todavía no inicia el OCR.</p></div>
                  </>
                ) : processingFiles ? (
                  <>
                    <span className="upload-icon"><LoaderCircle className="spin" size={29} /></span>
                    <div><strong>{pdfProgress?.stage ?? "Preparando PDF"}</strong><p>{pdfProgress?.file} · página {pdfProgress?.page ?? 0} de {pdfProgress?.pages ?? 0}</p></div>
                    <div className="upload-progress"><i style={{ width: `${pdfProgress?.percent ?? 4}%` }} /></div>
                  </>
                ) : (
                  <>
                    <span className="upload-icon"><UploadCloud size={29} /></span>
                    <div><strong>Suelta aquí PDF o imágenes JPG/PNG</strong><p>Detectamos texto digital y usamos OCR cuando la página es una imagen.</p></div>
                    <button className="secondary-button" onClick={() => fileInputRef.current?.click()} type="button">Seleccionar archivos</button>
                    <small>PDF multipágina, JPG o PNG · hasta 50 MB por archivo</small>
                  </>
                )}
              </section>
              {proMaxImport && (
                <section className="promax-import-panel">
                  <div className="promax-import-head">
                    <div><span className="eyebrow">PAQUETE VALIDADO</span><h3>Importación desde Bingo ProMax Studio</h3><p>Se incorporarán estos cartones a la partida actual. La partida y los cartones existentes no se reemplazarán.</p></div>
                    <span className="secure-badge">v{proMaxImport.schemaVersion}</span>
                  </div>
                  <div className="promax-import-summary">
                    <span><strong>{proMaxImport.cards.length}</strong><small>cartones válidos</small></span>
                    <span><strong>{proMaxImport.rejected.length}</strong><small>pendientes</small></span>
                    <span><strong>{proMaxImport.blocks}</strong><small>bloques</small></span>
                    <span><strong>{proMaxImport.campaigns}</strong><small>campañas</small></span>
                    <span><strong>{proMaxImport.patterns.length}</strong><small>patrones incluidos</small></span>
                  </div>
                  {proMaxImport.game && <div className="promax-import-game"><strong>{proMaxImport.game.name}</strong><span>{proMaxImport.game.date || "Fecha no indicada"} · patrón sugerido: {proMaxImport.game.activePatternName || "no indicado"}</span></div>}
                  {access?.role === "admin" && proMaxImport.patterns.length > 0 && <label className="promax-import-option"><input checked={syncProMaxPatterns} disabled={proMaxImportBusy} onChange={(event) => setSyncProMaxPatterns(event.target.checked)} type="checkbox" /><span><strong>Sincronizar patrones del paquete</strong><small>Crea o actualiza los patrones de Studio y habilita los que estén marcados como activos.</small></span></label>}
                  {proMaxImportProgress && <div className="promax-import-progress"><div><span>Importando por lotes de {PROMAX_IMPORT_CHUNK_SIZE} cartones</span><b>{proMaxImportProgress.completed.toLocaleString("es-EC")} / {proMaxImportProgress.total.toLocaleString("es-EC")}</b></div><i><em style={{ width: `${(proMaxImportProgress.completed / proMaxImportProgress.total) * 100}%` }} /></i></div>}
                  <div className="promax-import-actions"><button className="ghost-button" disabled={proMaxImportBusy} onClick={() => setProMaxImport(null)} type="button">Cancelar</button><button className="primary-button" disabled={proMaxImportBusy || !proMaxImport.cards.length} onClick={() => void importProMaxPackage()} type="button">{proMaxImportBusy ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />} {proMaxImportBusy ? "Importando…" : "Importar en la partida actual"}</button></div>
                </section>
              )}
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
              <div className="pattern-filter-bar card-filter-bar" aria-label="Filtrar cartones por formato">
                <span>Filtrar cartones:</span>
                {([
                  ["all", "Todos"],
                  ["5x5", "Cartones 5×5"],
                  ["sabrositos", "Sabrositos"],
                  ["numeros", "Números"],
                  ["adicionales", "Juegos adicionales"],
                ] as Array<[CardFilter, string]>).map(([value, label]) => {
                  const count = value === "all" ? state.cards.length : state.cards.filter((card) => cardFilterFor(card) === value).length;
                  return <button aria-pressed={cardFilter === value} className={cardFilter === value ? "active" : ""} key={value} onClick={() => setCardFilter(value)} type="button">{label} <b>{count}</b></button>;
                })}
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
                      onDelete={access?.role === "admin" ? deleteCard : undefined}
                      onEdit={access?.role === "admin" ? openCardEditor : undefined}
                      onToggleStatus={access?.role === "admin" ? toggleCardStatus : undefined}
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
                  action={<div className="empty-actions"><button className="primary-button" onClick={() => fileInputRef.current?.click()} type="button"><UploadCloud size={16} /> Importar PDF</button>{access?.role === "admin" && <button className="secondary-button" onClick={() => setManualOpen(true)} type="button"><SquarePen size={16} /> Crear manual</button>}</div>}
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
                <div><span className="eyebrow">MODALIDADES</span><h2>Administra los patrones del juego.</h2><p>Inhabilita figuras ya premiadas, reactívalas o elimina patrones de esta partida.</p></div>
                <div className="section-actions"><button className="ghost-button" onClick={() => setSelectedPatternIds((current) => { const visibleIds = filteredPatterns.map((pattern) => pattern.id); const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => current.includes(id)); return allVisibleSelected ? current.filter((id) => !visibleIds.includes(id)) : [...new Set([...current, ...visibleIds])]; })} type="button">{filteredPatterns.length > 0 && filteredPatterns.every((pattern) => selectedPatternIds.includes(pattern.id)) ? "Deseleccionar todos" : "Seleccionar todos los patrones"}</button><button className="secondary-button" disabled={!selectedPatternIds.length} onClick={() => void deleteSelectedPatterns()} type="button"><Trash2 size={16} /> Eliminar seleccionados ({selectedPatternIds.length})</button><button className="primary-button" onClick={() => openPatternEditor()} type="button"><Plus size={17} /> Crear patrón</button></div>
              </div>
              <div className="pattern-filter-bar" aria-label="Filtrar patrones">
                <span>Filtrar patrones:</span>
                {([
                  ["all", "Todos"],
                  ["cartones", "Cartones"],
                  ["numeros", "Números"],
                  ["adicionales", "Adicionales"],
                ] as Array<[PatternFilter, string]>).map(([value, label]) => {
                  const count = value === "all" ? availablePatterns.length : availablePatterns.filter((pattern) => patternBucket(pattern) === value).length;
                  return <button aria-pressed={patternFilter === value} className={patternFilter === value ? "active" : ""} key={value} onClick={() => { setPatternFilter(value); setPatternLimit(60); }} type="button">{label} <b>{count}</b></button>;
                })}
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
                {visiblePatterns.map((pattern) => {
                  const enabled = !state.disabledPatternIds.includes(pattern.id);
                  const hasWinner = state.winners.some((winner) => winner.patternId === pattern.id);
                  return (
                  <article className={`pattern-card ${enabled ? "active" : "disabled"}`} key={pattern.id}>
                      <div className="pattern-card-top"><PatternMini pattern={pattern} /><span><input aria-label={`Seleccionar ${pattern.name}`} checked={selectedPatternIds.includes(pattern.id)} onChange={(event) => setSelectedPatternIds((current) => event.target.checked ? [...new Set([...current, pattern.id])] : current.filter((id) => id !== pattern.id))} type="checkbox" /> {enabled ? <Check size={14} /> : <Pause size={14} />} {enabled ? "En juego" : "Inhabilitado"}</span></div>
                      <strong>{pattern.name}</strong>
                      <p>{pattern.description}</p>
                      {hasWinner && <div className="pattern-winner-note"><Trophy size={13} /> Ya tiene ganador</div>}
                      <div className="pattern-actions">
                        <button className={enabled ? "ghost-button" : "secondary-button"} onClick={() => void togglePattern(pattern, !enabled)} type="button">
                          {enabled ? "Inhabilitar" : "Habilitar"}
                        </button>
                        <button className="icon-button" onClick={() => openPatternEditor(pattern)} title="Editar patrón en esta partida" type="button"><SquarePen size={15} /></button>
                        <button className="icon-button danger-button" onClick={() => void deletePattern(pattern)} title="Eliminar patrón de esta partida" type="button"><Trash2 size={15} /></button>
                      </div>
                      <footer><span>{pattern.category}</span><span>{pattern.difficulty}</span></footer>
                  </article>
                  );
                })}
              </div>
              {visiblePatterns.length < filteredPatterns.length && <button className="secondary-button" onClick={() => setPatternLimit((current) => current + 60)} type="button">Cargar más patrones ({filteredPatterns.length - visiblePatterns.length} restantes)</button>}
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
                <a className="secondary-button" href={`mailto:${ADMIN_EMAIL}`}><FileText size={16} /> Correo administrador</a>
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
                      <div><b>{membership.plan === "annual" ? "1 año · $80" : membership.plan === "six-months" ? "6 meses · $50" : "1 mes · $10"}</b><small>Comprobante: {membership.receiptNumber || "No indicado"} · {membership.expiresAt ? `Hasta ${new Date(membership.expiresAt).toLocaleDateString("es-EC")}` : "Sin activar"}</small></div>
                      <div className="membership-actions">
                        {membership.status !== "approved" && <button className="primary-button compact" onClick={() => void manageMembership(membership, "approveMembership")} type="button">Aprobar</button>}
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
        {pageSelectionOpen && (
          <motion.div animate={{ opacity: 1 }} className="modal-backdrop" exit={{ opacity: 0 }} initial={{ opacity: 0 }}>
            <motion.section animate={{ opacity: 1, scale: 1, y: 0 }} className="modal page-selection-modal" exit={{ opacity: 0, scale: 0.98, y: 12 }} initial={{ opacity: 0, scale: 0.98, y: 12 }}>
              <header>
                <div><span className="eyebrow">IMPORTACIÓN TEMPORAL</span><h2>Selecciona las páginas a cargar</h2></div>
                <button aria-label="Cerrar selección de páginas" className="icon-button" onClick={() => { setPageSelectionOpen(false); setPageSelectionDrafts([]); }} type="button"><X size={19} /></button>
              </header>
              <p className="page-selection-help">Por defecto están seleccionadas todas las páginas. Ajusta cada archivo por separado; solo las páginas marcadas pasarán al reconocimiento de cartones.</p>
              <div className="page-selection-files">
                {pageSelectionDrafts.map((entry) => (
                  <section className="page-selection-file" key={entry.id}>
                    <div className="page-selection-heading">
                      <div><strong title={entry.file.name}>{entry.file.name}</strong><small>{entry.pageCount} {entry.pageCount === 1 ? "página" : "páginas"} · {entry.selectedPages.length} seleccionadas</small></div>
                      <div><button className="ghost-button compact" onClick={() => updateSelectedPages(entry.id, Array.from({ length: entry.pageCount }, (_, index) => index + 1))} type="button">Todas</button><button className="ghost-button compact" onClick={() => updateSelectedPages(entry.id, [])} type="button">Ninguna</button></div>
                    </div>
                    <div aria-label={`Páginas de ${entry.file.name}`} className="page-selection-grid">
                      {Array.from({ length: entry.pageCount }, (_, index) => index + 1).map((page) => (
                        <label className={entry.selectedPages.includes(page) ? "selected" : ""} key={page}>
                          <input checked={entry.selectedPages.includes(page)} onChange={(event) => updateSelectedPages(entry.id, event.target.checked ? [...entry.selectedPages, page] : entry.selectedPages.filter((value) => value !== page))} type="checkbox" />
                          <span>Página {page}</span>
                        </label>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
              <footer><button className="ghost-button" onClick={() => { setPageSelectionOpen(false); setPageSelectionDrafts([]); }} type="button">Cancelar</button><button className="primary-button" disabled={!pageSelectionDrafts.some((entry) => entry.selectedPages.length)} onClick={() => void processSelectedFiles()} type="button"><UploadCloud size={16} /> Cargar {pageSelectionDrafts.reduce((total, entry) => total + entry.selectedPages.length, 0)} páginas</button></footer>
            </motion.section>
          </motion.div>
        )}
        {importReviewOpen && (
          <motion.div animate={{ opacity: 1 }} className="modal-backdrop" exit={{ opacity: 0 }} initial={{ opacity: 0 }}>
            <motion.section animate={{ opacity: 1, scale: 1, y: 0 }} className="modal import-review-modal" exit={{ opacity: 0, scale: 0.98, y: 12 }} initial={{ opacity: 0, scale: 0.98, y: 12 }}>
              <header>
                <div><span className="eyebrow">REVISIÓN ANTES DE GUARDAR</span><h2>Cartones detectados</h2></div>
                <button className="icon-button" onClick={() => setImportReviewOpen(false)} type="button"><X size={19} /></button>
              </header>
              <div className="import-review-summary">
                <span><strong>{importPages}</strong> página(s)</span>
                <span><strong>{importDrafts.length}</strong> cartón(es)</span>
                <span><strong>{importDrafts.filter((card) => card.reviewStatus !== "needs-review").length}</strong> listos para guardar</span>
                <span><strong>{importDrafts.filter((card) => card.reviewStatus === "needs-review").length}</strong> pendientes</span>
              </div>
              <p className="import-review-help">Confirma la numeración y el tipo de cartón. Solo los cartones listos se guardarán en la partida actual; los archivos PDF se procesan localmente y no se conservan.</p>
              <div className="import-review-list">
                {importDrafts.map((card) => {
                  const needsReview = card.reviewStatus === "needs-review";
                  return (
                    <article className={needsReview ? "needs-review" : "ready-to-save"} key={card.id}>
                      <div><strong>Cartón #{card.number || "sin número"}</strong><small>{card.sourceFile} · {card.sourcePage ? `pág. ${card.sourcePage}` : "ingreso"}</small></div>
                      <span>{needsReview ? "Revisión requerida" : "Listo para guardar"}</span>
                      <button className="secondary-button compact" onClick={() => openCardEditor(card, "import")} type="button"><SquarePen size={13} /> Editar casillas y forma</button>
                      {card.reviewNotes?.length ? <p>{card.reviewNotes.join(" · ")}</p> : null}
                    </article>
                  );
                })}
              </div>
              <footer>
                <button className="ghost-button" onClick={() => { setImportReviewOpen(false); setImportDrafts([]); }} type="button">Cancelar</button>
                <button className="primary-button" disabled={!importDrafts.length} onClick={() => void saveImportedCards()} type="button"><Check size={17} /> Guardar cartones revisados</button>
              </footer>
            </motion.section>
          </motion.div>
        )}

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

        {cardDraft && (
          <motion.div animate={{ opacity: 1 }} className="modal-backdrop" exit={{ opacity: 0 }} initial={{ opacity: 0 }}>
            <motion.section animate={{ opacity: 1, scale: 1, y: 0 }} className="modal card-editor-modal" exit={{ opacity: 0, scale: 0.98, y: 12 }} initial={{ opacity: 0, scale: 0.98, y: 12 }}>
              <header>
                <div><span className="eyebrow">EDICIÓN DE CARTÓN</span><h2>{cardEditorMode === "import" ? "Corregir cartón detectado" : "Editar cartón"}</h2></div>
                <button className="icon-button" onClick={() => setCardDraft(null)} type="button"><X size={19} /></button>
              </header>
              <div className="card-editor-layout">
                <div className="card-editor-fields">
                  <label>Número del cartón<input onChange={(event) => setCardDraft((current) => current ? { ...current, number: event.target.value } : current)} value={cardDraft.number} /></label>
                  <label>Serie <small>opcional</small><input onChange={(event) => setCardDraft((current) => current ? { ...current, serial: event.target.value } : current)} value={cardDraft.serial ?? ""} /></label>
                  <label>Tipo de juego
                    <select onChange={(event) => updateCardDraftType(event.target.value as CardType)} value={cardDraft.layout?.type ?? "classic-5x5"}>
                      {CARD_TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </select>
                  </label>
                  <div className="manual-note"><PencilLine size={17} /><p><strong>Corrección manual</strong>Completa las casillas faltantes o cambia la forma detectada. Al guardar se validan rangos, repetidos y duplicados.</p></div>
                </div>
                <div className="card-editor-grid">
                  <div className="manual-bingo-head">{BINGO.map((letter) => <span key={letter}>{letter}</span>)}</div>
                  <div>
                    {Array.from({ length: 25 }, (_, index) => {
                      const layout = cardLayoutFor(cardDraft);
                      const allowed = layout.type === "classic-5x5" || layout.rows === 5 && layout.columns === 5
                        ? true
                        : layout.cells.some((cell) => cell.row * 5 + cell.column === index);
                      const free = index === 12 && layout.type === "classic-5x5" && cardDraft.grid[index] === 0;
                      return <input
                        aria-label={`Casilla ${index + 1}`}
                        className={free ? "free" : ""}
                        disabled={!allowed || free}
                        inputMode="numeric"
                        key={index}
                        max="90"
                        min="1"
                        onChange={(event) => setCardDraft((current) => current ? { ...current, grid: current.grid.map((value, cell) => cell === index ? Number(event.target.value.replace(/\D/g, "").slice(0, 2) || 0) : value) } : current)}
                        placeholder={free ? "LIBRE" : allowed ? "—" : "·"}
                        value={free ? "LIBRE" : cardDraft.grid[index] || ""}
                      />;
                    })}
                  </div>
                </div>
              </div>
              <p className="card-editor-help">Si el cartón fue clasificado como Sonrisa por error, selecciona «Tradicional 5×5» y completa las 25 casillas. Las casillas vacías de formatos adicionales quedan protegidas para no alterar su figura.</p>
              <footer><button className="ghost-button" onClick={() => setCardDraft(null)} type="button">Cancelar</button><button className="primary-button" onClick={() => void saveCardEdit()} type="button"><Check size={17} /> Guardar corrección</button></footer>
            </motion.section>
          </motion.div>
        )}

        {patternOpen && (
          <motion.div animate={{ opacity: 1 }} className="modal-backdrop" exit={{ opacity: 0 }} initial={{ opacity: 0 }}>
            <motion.section animate={{ opacity: 1, scale: 1, y: 0 }} className="modal pattern-modal" exit={{ opacity: 0, scale: 0.98, y: 12 }} initial={{ opacity: 0, scale: 0.98, y: 12 }}>
              <header><div><span className="eyebrow">EDITOR VISUAL</span><h2>{editingPattern ? "Editar patrón" : "Nuevo patrón"}</h2></div><button className="icon-button" onClick={() => { setPatternOpen(false); setEditingPattern(null); }} type="button"><X size={19} /></button></header>
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
              <footer><button className="ghost-button" onClick={() => { setPatternOpen(false); setEditingPattern(null); }} type="button">Cancelar</button><button className="primary-button" onClick={() => void saveCustomPattern()} type="button"><Check size={17} /> {editingPattern ? "Guardar cambios" : "Guardar patrón"}</button></footer>
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
              <section>
                <span className="settings-label">APARIENCIA</span>
                <div className="theme-picker"><button aria-pressed={theme === "dark"} className={theme === "dark" ? "active" : ""} onClick={() => setTheme("dark")} type="button"><Moon size={18} /> Oscuro</button><button aria-pressed={theme === "light"} className={theme === "light" ? "active" : ""} onClick={() => setTheme("light")} type="button"><Sun size={18} /> Claro</button></div>
                <span className="settings-label accent-theme-label">COLOR NEÓN</span>
                <div aria-label="Tema de color" className="accent-theme-picker">
                  {ACCENT_THEMES.map((option) => (
                    <button aria-pressed={accentTheme === option.id} className={`accent-theme-option ${accentTheme === option.id ? "active" : ""}`} key={option.id} onClick={() => setAccentTheme(option.id)} type="button">
                      <i aria-hidden="true" style={{ backgroundColor: option.color, boxShadow: `0 0 12px ${option.color}88` }} />
                      <span>{option.label}</span>
                    </button>
                  ))}
                </div>
              </section>
              <section><span className="settings-label">COMPORTAMIENTO</span><label className="setting-row"><span><Volume2 size={18} /></span><div><strong>Sonidos</strong><small>Bolillas y anuncio de ganador</small></div><input checked={sound} onChange={(event) => setSound(event.target.checked)} type="checkbox" /></label><label className="setting-row"><span><Pause size={18} /></span><div><strong>Pausa automática</strong><small>Detener al detectar un bingo</small></div><input checked={game.autoPause} onChange={(event) => void updateAutoPause(event.target.checked)} type="checkbox" /></label></section>
              <section className="system-status"><span className="settings-label">ESTADO DEL SISTEMA</span><div><ShieldCheck size={20} /><p><strong>Todo operativo</strong><small>Datos persistentes y validación en tiempo real.</small></p></div></section>
              <section><span className="settings-label">CUENTA</span><div className="account-summary"><UserRound size={18} /><div><strong>{authUser?.email || "Modo demo"}</strong><small>{state.access.role === "admin" ? "Administrador" : demoMode ? "Demostración" : "Usuario aprobado"}</small></div></div><button className="secondary-button account-signout" onClick={() => demoMode ? (setDemoMode(false), setState(null), setAccess(null)) : void supabase.auth.signOut()} type="button">Cerrar sesión</button></section>
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
