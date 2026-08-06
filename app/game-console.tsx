"use client";

import { CardEditorModal } from "@/components/card-editor-modal";
import { AnimatePresence, motion } from "framer-motion";
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  Award,
  Bookmark,
  Camera,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleGauge,
  ClipboardList,
  Clock3,
  Copy,
  Download,
  Eye,
  FileCode,
  FileSpreadsheet,
  FileText,
  Gamepad2,
  Grid3X3,
  History,
  Layers,
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
  SHAPE_PRESETS,
  cardProgress,
  formatDuration,
  numberSheetFormForGrid,
  patternsForCard,
  referenceCatalogPatterns,
  specialCardPatternForGrid,
  winningPatternsForCard,
  type AppState,
  type AccessState,
  type BingoCard,
  type BingoPattern,
  type Draw,
  type Game,
  type Membership,
  type ShapePreset,
  type Winner,
  type ImportAuditEntry,
} from "@/lib/bingo";
import {
  isSupportedBingoImportFile,
  parseBingoImportFile,
  type PdfParseProgress,
} from "@/lib/pdf-parser";
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
  const send = async (forceRefresh = false) => {
    const authorization = await authorizationHeaders(forceRefresh);
    const response = await fetch("/api/state", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-device-id": deviceId(),
        ...authorization,
      },
      body: JSON.stringify(body),
    });
    const payload = (await response.json()) as T & { error?: string; access?: AccessState };
    return { response, payload };
  };
  let { response, payload } = await send();
  if (
    (response.status === 401 || response.status === 403) &&
    (!payload.access || (payload.access.role === "anonymous" && !payload.access.email))
  ) {
    ({ response, payload } = await send(true));
  }
  if (!response.ok) throw new Error(payload.error || "No se pudo completar la operación.");
  return payload;
}

function importedCardFingerprint(card: Pick<BingoCard, "grid" | "serial" | "sourceFile" | "sourcePage">) {
  return [
    card.sourceFile.trim().toLowerCase(),
    card.sourcePage,
    card.serial.trim().toLowerCase(),
    card.grid.join(","),
  ].join("|");
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
  if (grid && grid.length !== 25) {
    return (
      <div className={`compact-card-grid ${compact ? "compact" : ""} ${showPending ? "" : "hide-pending"}`}>
        <span className="compact-card-title">{grid.length === 5 ? "SABROSITO" : "CARTÓN ESPECIAL"}</span>
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
  const numberSheetForm = numberSheetFormForGrid(grid ?? []);
  return (
    <div className={`bingo-grid ${compact ? "compact" : ""} ${editable ? "editable" : ""} ${showPending ? "" : "hide-pending"}`}>
      {BINGO.map((letter) => <span className="bingo-head" key={letter}>{letter}</span>)}
      {Array.from({ length: 25 }, (_, index) => {
        const value = grid?.[index] ?? index + 1;
        const isEmpty = grid?.[index] === 0;
        const isFree = Boolean(isEmpty && !numberSheetForm && index === 12);
        const isFormLabel = Boolean(isEmpty && numberSheetForm && index === 12);
        const marked = Boolean(isFree || (grid && value > 0 && called?.has(value)));
        const target = Boolean(pattern?.cells.includes(index) || selected.includes(index));
        return (
          <button
            className={`bingo-cell ${marked ? "marked" : ""} ${target ? "target" : ""} ${isFormLabel ? "sheet-form-label" : ""}`}
            disabled={!editable}
            key={index}
            onClick={() => onCellClick?.(index)}
            type="button"
            aria-label={editable
              ? `Casilla ${index + 1}`
              : isFree
                ? "Casilla libre"
                : isFormLabel
                  ? `Forma ${numberSheetForm}`
                  : isEmpty
                    ? "Casilla vacía"
                    : `Número ${value}`}
          >
            {editable
              ? (selected.includes(index) ? <Check size={16} /> : "")
              : isFree
                ? "LIBRE"
                : isFormLabel
                  ? `FORMA #${numberSheetForm}`
                  : isEmpty
                    ? ""
                    : value}
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
  onEditNumber,
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
  onEditNumber?: (card: BingoCard) => void;
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
          <span>Tabla</span>
          <strong>Tab #{card.number}</strong>
        </div>
        <div className="ticket-actions">
          {onEditNumber && <button className="icon-button small" title="Editar cartón" type="button" onClick={() => onEditNumber(card)}><PencilLine size={15} /></button>}
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
  const [editingCardId, setEditingCardId] = useState<string | null>(null);
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
  const [patternName, setPatternName] = useState("");
  const [patternDescription, setPatternDescription] = useState("");
  const [patternCategory, setPatternCategory] = useState("Personalizado");
  const [patternCells, setPatternCells] = useState<number[]>([10, 11, 12, 13, 14]);
  const [patternColor, setPatternColor] = useState("#d7ff3f");
  const [editingPatternId, setEditingPatternId] = useState<string | null>(null);
  const [replacingPatternId, setReplacingPatternId] = useState<string | null>(null);
  const [patternTab, setPatternTab] = useState<"templates" | "game">("templates");
  const [templateCategoryFilter, setTemplateCategoryFilter] = useState("Todas");
  const [templateSearch, setTemplateSearch] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [gameDraft, setGameDraft] = useState({ name: "", date: "", prize: "", notes: "" });
  const [newGameModalOpen, setNewGameModalOpen] = useState(false);
  const [newGameDraft, setNewGameDraft] = useState({ name: "Nueva partida", date: new Date().toISOString().slice(0, 10), prize: "" });
  const [editCardModal, setEditCardModal] = useState<{ cardId: string; currentNumber: string; number: string } | null>(null);
  const [confirmModal, setConfirmModal] = useState<{
    title: string;
    message: string;
    confirmText?: string;
    onConfirm: () => Promise<void> | void;
  } | null>(null);
  const [membershipName, setMembershipName] = useState("");
  const [activationCode, setActivationCode] = useState("");
  const [membershipMonths, setMembershipMonths] = useState<Record<string, number>>({});
  const [cardLayers, setCardLayers] = useState({ called: true, pattern: true, pending: true });
  const [auditLogs, setAuditLogs] = useState<ImportAuditEntry[]>([]);
  const [auditModalOpen, setAuditModalOpen] = useState(false);
  const [auditFilterFile, setAuditFilterFile] = useState<string>("all");
  const [auditFilterType, setAuditFilterType] = useState<string>("all");
  const [auditSearch, setAuditSearch] = useState<string>("");
  const [selectedAuditGridSnippet, setSelectedAuditGridSnippet] = useState<{ id: string; grid: number[] } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const importBusyRef = useRef(false);

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
      const load = async (forceRefresh = false) => {
        const authorization = await authorizationHeaders(forceRefresh);
        const response = await fetch("/api/state", {
          cache: "no-store",
          headers: { "x-device-id": deviceId(), ...authorization },
        });
        const payload = (await response.json()) as AppState & { error?: string; access?: AccessState };
        return { response, payload };
      };
      let { response, payload } = await load();
      if (
        response.status === 403 &&
        payload.access?.role === "anonymous" &&
        !payload.access.email
      ) {
        ({ response, payload } = await load(true));
      }
      if (response.status === 403 && payload.access) {
        setAccess(payload.access);
        setState(null);
        return;
      }
      if (!response.ok) throw new Error(payload.error || "No se pudo abrir la partida.");
      setState(payload);
      setAccess(payload.access);
      if (payload.auditLogs) {
        setAuditLogs(payload.auditLogs);
      }
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
    if (!membershipName.trim()) {
      setError("Escribe tu nombre para enviar la solicitud.");
      return;
    }
    const memberEmail = access?.email || authUser?.email || "";
    try {
      const result = await api<{ adminEmail: string; subject: string; accessCode: string }>({
        action: "requestMembership",
        name: membershipName.trim(),
      });
      window.open(`mailto:${result.adminEmail}?subject=${encodeURIComponent(result.subject)}&body=${encodeURIComponent(`Nueva solicitud de acceso a Bingo Control.\n\nNombre: ${membershipName.trim()}\nCorreo: ${memberEmail}\nCódigo de acceso: ${result.accessCode}\n\nLa duración de la membresía será definida por el administrador.`)}`, "_blank");
      setAccess({ ...access!, email: memberEmail, role: "pending", reason: "Solicitud enviada. Espera la aprobación del administrador." });
      setError("");
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

  const manageMembership = async (membership: Membership, action: "approveMembership" | "rejectMembership" | "resetMembershipDevice" | "resendMembershipCode" | "deleteMembershipUser") => {
    try {
      const months = membershipMonths[membership.id] ?? membership.months ?? 1;
      const result = await api<{ email?: string; expiresAt?: string; accessCode?: string; months?: number }>({ action, membershipId: membership.id, months });
      await refresh(true);
      if (action === "approveMembership" && result.email) {
        window.open(`mailto:${result.email}?subject=${encodeURIComponent("Membresía aprobada - Bingo Control Pro")}&body=${encodeURIComponent(`Tu membresía fue aprobada por ${result.months} mes(es).\nCódigo de acceso: ${result.accessCode}\nVigencia hasta: ${new Date(result.expiresAt || "").toLocaleDateString("es-EC")}\n\nIngresa el código en Bingo Control Pro. El primer dispositivo quedará vinculado a tu cuenta.`)}`, "_self");
      }
      if (action === "resendMembershipCode" && result.email && result.accessCode) {
        await navigator.clipboard?.writeText(result.accessCode).catch(() => undefined);
        window.open(`mailto:${result.email}?subject=${encodeURIComponent("Código de acceso - Bingo Control Pro")}&body=${encodeURIComponent(`Hola ${membership.name || ""},\n\nTu código permanente de acceso es: ${result.accessCode}\nMembresía: ${result.months || membership.months || 1} mes(es)\nVigencia hasta: ${new Date(result.expiresAt || membership.expiresAt || "").toLocaleDateString("es-EC")}\n\nConserva este código para futuras consultas.`)}`, "_self");
      }
      notify(action === "approveMembership" ? "Usuario aprobado; correo de activación preparado." : action === "resendMembershipCode" ? "Código permanente copiado y correo preparado." : action === "rejectMembership" ? "Solicitud rechazada." : "Dispositivo restablecido.");
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : "No se pudo actualizar el usuario.", "error");
    }
  };

  const manageAdmin = async (action: "addAdmin" | "removeAdmin", email: string) => {
    try {
      await api({ action, email });
      setAdminEmail("");
      await refresh(true);
      notify(action === "addAdmin" ? "Administrador adicional aprobado." : "Administrador adicional eliminado.", action === "addAdmin" ? "success" : "warning");
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : "No se pudo actualizar el administrador.", "error");
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
    };
    void bootstrapAuth();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      setAuthUser(session?.user ?? null);
      if (event === "PASSWORD_RECOVERY") setAuthMode("update");
      if (!session) {
        setState(null);
        setAccess(null);
      }
    });
    return () => subscription.unsubscribe();
  }, [refresh]);

  useEffect(() => {
    if (!authReady || !authUser) return;
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [authReady, authUser, refresh]);

  useEffect(() => {
    if (!authUser || membershipName.trim()) return;
    const registeredName = String(authUser.user_metadata?.name ?? "").trim();
    if (registeredName) {
      const timer = window.setTimeout(() => setMembershipName(registeredName), 0);
      return () => window.clearTimeout(timer);
    }
  }, [authUser, membershipName]);

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
  const availablePatterns = useMemo(() => {
    const customList = (state?.customPatterns ?? []).filter(
      (pattern) => !state?.removedPatternIds?.includes(pattern.id),
    );
    const customIds = new Set(customList.map((p) => p.id));
    const refPatterns = referenceCatalogPatterns(
      state?.customPatterns ?? [],
      state?.removedPatternIds ?? [],
    ).filter((p) => !customIds.has(p.id));

    return [...customList, ...refPatterns].sort((a, b) =>
      a.name.localeCompare(b.name, "es", { numeric: true }),
    );
  }, [state?.customPatterns, state?.removedPatternIds]);
  const gamePatterns = useMemo(
    () =>
      availablePatterns.filter(
        (pattern) => !state?.disabledPatternIds.includes(pattern.id),
      ),
    [availablePatterns, state?.disabledPatternIds],
  );
  const allPatterns = useMemo(
    () => [
      ...gamePatterns,
      ...(state?.cards.some((card) => card.grid.length === 5) &&
      !state?.disabledPatternIds.includes(COMPACT_CARD_PATTERN.id)
        ? [COMPACT_CARD_PATTERN]
        : []),
    ],
    [gamePatterns, state?.cards, state?.disabledPatternIds],
  );

  const templateCatalog = useMemo(() => {
    const userCustoms = state?.customPatterns ?? [];
    const customIds = new Set(userCustoms.map((p) => p.id));
    const shapePresetPatterns: BingoPattern[] = SHAPE_PRESETS.map((preset) => ({
      id: `preset-${preset.id}`,
      name: preset.name,
      description: preset.description,
      color: preset.color,
      category: preset.category,
      difficulty: preset.cells.length > 12 ? "Alta" : preset.cells.length > 7 ? "Media" : "Fácil",
      cells: preset.cells,
      variants: [preset.cells],
      custom: false,
    }));

    return [
      ...userCustoms,
      ...BUILTIN_PATTERNS.filter((p) => !customIds.has(p.id)),
      ...shapePresetPatterns.filter((p) => !customIds.has(p.id)),
    ].sort((a, b) => {
      if (a.custom && !b.custom) return -1;
      if (!a.custom && b.custom) return 1;
      return a.name.localeCompare(b.name, "es", { numeric: true });
    });
  }, [state?.customPatterns]);

  const filteredTemplates = useMemo(() => {
    return templateCatalog.filter((item) => {
      const matchCategory =
        templateCategoryFilter === "Todas" ||
        (templateCategoryFilter === "Personalizados" && item.custom) ||
        item.category === templateCategoryFilter;
      const matchSearch =
        !templateSearch.trim() ||
        item.name.toLowerCase().includes(templateSearch.toLowerCase()) ||
        item.description.toLowerCase().includes(templateSearch.toLowerCase()) ||
        item.category.toLowerCase().includes(templateSearch.toLowerCase());
      return matchCategory && matchSearch;
    });
  }, [templateCatalog, templateCategoryFilter, templateSearch]);
  const patternStatuses = useMemo(
    () =>
      gamePatterns.map((pattern) => {
        const compatibleCards = (state?.cards ?? []).filter(
          (card) =>
            card.status === "active" &&
            (pattern.id === COMPACT_CARD_PATTERN.id
              ? card.grid.length === 5
              : card.grid.length === 25 && !numberSheetFormForGrid(card.grid)),
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

  const resetGame = () => {
    if (!state || !state.draws.length) return;
    setConfirmModal({
      title: "Reiniciar partida",
      message: "¿Reiniciar las bolillas y ganadores de esta partida? Los cartones cargados se conservarán.",
      confirmText: "Reiniciar",
      onConfirm: async () => {
        setConfirmModal(null);
        try {
          await api({ action: "resetGame", gameId: state.game.id });
          await refresh();
          notify("La partida quedó lista para comenzar.");
        } catch (caught) {
          notify(caught instanceof Error ? caught.message : "No se pudo reiniciar.", "error");
        }
      },
    });
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

  const deleteCard = (card: BingoCard) => {
    if (!state) return;
    setConfirmModal({
      title: "Eliminar cartón",
      message: `¿Eliminar definitivamente el cartón #${card.number} de esta partida?`,
      confirmText: "Eliminar",
      onConfirm: async () => {
        setConfirmModal(null);
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
      },
    });
  };

  const deleteVoidedCards = () => {
    if (!state) return;
    const voided = state.cards.filter((card) => card.status === "void");
    if (!voided.length) {
      notify("No hay cartones anulados para eliminar.", "warning");
      return;
    }
    setConfirmModal({
      title: "Eliminar cartones anulados",
      message: `¿Eliminar definitivamente los ${voided.length} cartones anulados?`,
      confirmText: "Eliminar todos",
      onConfirm: async () => {
        setConfirmModal(null);
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
      },
    });
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

  const deletePattern = (pattern: BingoPattern) => {
    if (!state) return;
    setConfirmModal({
      title: "Eliminar patrón",
      message: `¿Eliminar “${pattern.name}” de esta partida?`,
      confirmText: "Eliminar",
      onConfirm: async () => {
        setConfirmModal(null);
        try {
          await api({ action: pattern.custom ? "deletePattern" : "removeBuiltinPattern", gameId: state.game.id, patternId: pattern.id });
          setState({
            ...state,
            customPatterns: state.customPatterns.filter((item) => item.id !== pattern.id),
            disabledPatternIds: state.disabledPatternIds.filter((id) => id !== pattern.id),
            removedPatternIds: pattern.custom ? state.removedPatternIds : [...state.removedPatternIds, pattern.id],
          });
          notify(`Patrón “${pattern.name}” eliminado.`, "warning");
        } catch (caught) {
          notify(caught instanceof Error ? caught.message : "No se pudo eliminar el patrón.", "error");
        }
      },
    });
  };

  const openNewGameModal = () => {
    setNewGameDraft({
      name: "Nueva partida",
      date: new Date().toISOString().slice(0, 10),
      prize: "",
    });
    setNewGameModalOpen(true);
  };

  const handleCreateNewGame = async () => {
    if (!newGameDraft.name.trim()) return;
    try {
      await api({
        action: "createGame",
        name: newGameDraft.name.trim(),
        date: newGameDraft.date || new Date().toISOString().slice(0, 10),
        prize: newGameDraft.prize.trim(),
      });
      setNewGameModalOpen(false);
      await refresh();
      setView("dashboard");
      notify("Nuevo juego creado: cartones, bolillas, ganadores y patrones están listos para la nueva partida.");
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : "No se pudo crear el nuevo juego.", "error");
    }
  };

  const saveManualCard = async ({
    number,
    serial,
    grid,
  }: {
    number: string;
    serial: string;
    grid: number[];
  }) => {
    if (!state) return;
    const currentCard = editingCardId
      ? state.cards.find((card) => card.id === editingCardId)
      : null;
    const card: BingoCard = {
      id: currentCard?.id ?? crypto.randomUUID(),
      number: number.trim(),
      serial: serial.trim(),
      grid,
      sourceFile: currentCard?.sourceFile ?? "Ingreso manual",
      sourcePage: currentCard?.sourcePage ?? 0,
      status: currentCard?.status ?? "active",
    };
    if (currentCard) {
      await api({ action: "updateCard", gameId: state.game.id, card });
      setState({
        ...state,
        cards: state.cards.map((item) => item.id === card.id ? card : item),
        winners: state.winners.filter((winner) => winner.cardId !== card.id),
      });
    } else {
      await api({ action: "saveCards", gameId: state.game.id, cards: [card] });
      setState({ ...state, cards: [card, ...state.cards] });
    }
    setManualOpen(false);
    setEditingCardId(null);
    setImportWarnings([]);
    notify(currentCard ? `Cartón #${card.number} actualizado.` : `Cartón #${card.number} guardado.`);
  };

  const processFiles = async (files: File[]) => {
    if (!state || !files.length) return;
    if (importBusyRef.current) {
      notify("Espera a que termine la importación actual antes de seleccionar otros archivos.", "warning");
      return;
    }
    const invalid = files.find((file) => !isSupportedBingoImportFile(file));
    if (invalid) {
      notify(`${invalid.name} no es un PDF ni una imagen compatible.`, "warning");
      return;
    }
    importBusyRef.current = true;
    setProcessingFiles(true);
    setImportWarnings([]);
    const warnings: string[] = [];
    const newAuditEntries: ImportAuditEntry[] = [];
    const existingFingerprints = new Set(state.cards.map(importedCardFingerprint));
    const existingNumbers = new Set(state.cards.map((c) => c.number.trim().toLowerCase()));
    const targetGameId = state.game.id;
    let imported = 0;
    let duplicateCount = 0;
    try {
      for (const file of files) {
        const parsed = await parseBingoImportFile(file, (progress) =>
          setPdfProgress({ ...progress, file: file.name }),
        );
        warnings.push(...parsed.warnings.map((warning) => `${file.name} · ${warning}`));
        const currentFileAudits: ImportAuditEntry[] = [...(parsed.auditEntries ?? [])];
        const currentFileCards = parsed.cards.filter((card) => card.sourceFile === file.name);
        if (currentFileCards.length !== parsed.cards.length) {
          throw new Error(`${file.name}: se descartó un resultado que no pertenecía al archivo seleccionado.`);
        }
        const newCards: BingoCard[] = [];
        for (const rawCard of currentFileCards) {
          const fingerprint = importedCardFingerprint(rawCard);
          if (existingFingerprints.has(fingerprint)) {
            duplicateCount += 1;
            currentFileAudits.push({
              id: crypto.randomUUID(),
              timestamp: new Date().toISOString(),
              file: file.name,
              page: rawCard.sourcePage ?? 1,
              cardIdentifier: rawCard.number,
              type: "duplicate",
              reason: `Cartón ${rawCard.number}: Omitido por duplicidad (ya registrado previamente en la partida).`,
              gridSnippet: rawCard.grid,
            });
            continue;
          }
          const card = { ...rawCard };
          let numLower = card.number.trim().toLowerCase();
          if (existingNumbers.has(numLower)) {
            let suffix = 2;
            let candidate = `${card.number}-${suffix}`;
            while (existingNumbers.has(candidate.toLowerCase())) {
              suffix += 1;
              candidate = `${card.number}-${suffix}`;
            }
            card.number = candidate;
            numLower = candidate.toLowerCase();
          }

          existingFingerprints.add(importedCardFingerprint(card));
          existingNumbers.add(numLower);
          newCards.push(card);
        }
        const uniqueCards = newCards;
        if (!uniqueCards.length) {
          warnings.push(`${file.name}: todos los cartones ya estaban cargados en esta partida.`);
          currentFileAudits.push({
            id: crypto.randomUUID(),
            timestamp: new Date().toISOString(),
            file: file.name,
            page: 1,
            type: "warning",
            reason: `${file.name}: Todos los cartones extraídos ya figuraban como cargados en esta partida.`,
          });
        }

        // Detect and auto-register any special game forms or shapes in imported cards
        const knownPatternIds = new Set([
          ...BUILTIN_PATTERNS.map((p) => p.id),
          ...(state?.customPatterns ?? []).map((p) => p.id),
        ]);
        const knownPatternNames = new Set([
          ...BUILTIN_PATTERNS.map((p) => p.name.toLowerCase().trim()),
          ...(state?.customPatterns ?? []).map((p) => p.name.toLowerCase().trim()),
        ]);
        const newPatternsToRegister: BingoPattern[] = [];

        for (const card of uniqueCards) {
          const specialPattern = specialCardPatternForGrid(card.grid, card.serial);
          if (specialPattern) {
            const nameLower = specialPattern.name.toLowerCase().trim();
            if (!knownPatternIds.has(specialPattern.id) && !knownPatternNames.has(nameLower)) {
              knownPatternIds.add(specialPattern.id);
              knownPatternNames.add(nameLower);
              newPatternsToRegister.push({
                ...specialPattern,
                custom: true,
              });
            }
          }
        }

        for (const pattern of newPatternsToRegister) {
          try {
            await api({
              action: "savePattern",
              gameId: targetGameId,
              pattern,
            });
            notify(`Nueva forma de juego registrada: ${pattern.name}`);
          } catch {
            // Continuation if already saved
          }
        }
        const result = await api<{ accepted: number; duplicates: number }>({
          action: "saveCards",
          gameId: targetGameId,
          importSource: file.name,
          cards: uniqueCards,
          auditEntries: currentFileAudits,
        });
        imported += result.accepted;
        duplicateCount += result.duplicates;
        newAuditEntries.push(...currentFileAudits);
      }
      await refresh();
      setImportWarnings(warnings);
      if (newAuditEntries.length) {
        setAuditLogs((prev) => [...newAuditEntries, ...prev]);
      }
      if (imported) notify(`${imported} cartones importados correctamente.`);
      if (duplicateCount) notify(`${duplicateCount} elementos duplicados fueron omitidos.`, "warning");
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "No se pudo completar la importación.";
      warnings.push(message);
      setImportWarnings(warnings);
      const errEntry: ImportAuditEntry = {
        id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        file: files[0]?.name ?? "Importación",
        type: "error",
        reason: `Fallo durante el procesamiento del archivo: ${message}`,
      };
      setAuditLogs((prev) => [errEntry, ...prev]);
      api({ action: "saveAuditLogs", gameId: targetGameId, entries: [errEntry] }).catch(() => undefined);
      notify(message, "error");
    } finally {
      importBusyRef.current = false;
      setProcessingFiles(false);
      setPdfProgress(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      if (cameraInputRef.current) cameraInputRef.current.value = "";
    }
  };

  const saveCustomPattern = async () => {
    if (!patternName.trim() || !patternCells.length) {
      notify("Escribe un nombre y selecciona al menos una casilla.", "warning");
      return;
    }
    const pattern: BingoPattern = {
      id: editingPatternId || (replacingPatternId
        ? `custom-${replacingPatternId}-${crypto.randomUUID()}`
        : `custom-user-${crypto.randomUUID()}`),
      name: patternName.trim(),
      description: patternDescription.trim() || "Plantilla personalizada guardada en tu cuenta",
      color: patternColor,
      category: patternCategory || "Personalizado",
      difficulty: patternCells.length > 12 ? "Alta" : patternCells.length > 7 ? "Media" : "Fácil",
      cells: patternCells,
      variants: [patternCells],
      custom: true,
    };
    try {
      await api({ action: editingPatternId ? "updatePattern" : "savePattern", gameId: state?.game?.id, pattern });
      if (replacingPatternId && state?.game?.id) {
        await api({ action: "removeBuiltinPattern", gameId: state.game.id, patternId: replacingPatternId });
      }
      if (state) {
        setState({
          ...state,
          customPatterns: editingPatternId
            ? state.customPatterns.map((item) => item.id === editingPatternId ? pattern : item)
            : [pattern, ...state.customPatterns.filter((item) => item.id !== pattern.id)],
          removedPatternIds: replacingPatternId ? [...state.removedPatternIds, replacingPatternId] : state.removedPatternIds,
        });
      }
      setPatternOpen(false);
      setPatternName("");
      setPatternDescription("");
      setPatternCells([10, 11, 12, 13, 14]);
      setEditingPatternId(null);
      setReplacingPatternId(null);
      notify(`Plantilla “${pattern.name}” guardada en tu cuenta exitosamente.`);
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : "No se pudo guardar la plantilla.", "error");
    }
  };

  const openPatternEditor = (pattern?: BingoPattern, defaultPreset?: ShapePreset) => {
    if (pattern) {
      setEditingPatternId(pattern.custom ? pattern.id : null);
      setReplacingPatternId(pattern && !pattern.custom ? pattern.id : null);
      setPatternName(pattern.name);
      setPatternDescription(pattern.description);
      setPatternColor(pattern.color);
      setPatternCategory(pattern.category || "Personalizado");
      setPatternCells(pattern.cells);
    } else if (defaultPreset) {
      setEditingPatternId(null);
      setReplacingPatternId(null);
      setPatternName(defaultPreset.name);
      setPatternDescription(defaultPreset.description);
      setPatternColor(defaultPreset.color);
      setPatternCategory(defaultPreset.category);
      setPatternCells(defaultPreset.cells);
    } else {
      setEditingPatternId(null);
      setReplacingPatternId(null);
      setPatternName("");
      setPatternDescription("");
      setPatternColor("#d7ff3f");
      setPatternCategory("Personalizado");
      setPatternCells([10, 11, 12, 13, 14]);
    }
    setPatternOpen(true);
  };

  const openEditCardNumberModal = (card: BingoCard) => {
    setEditCardModal({ cardId: card.id, currentNumber: card.number, number: card.number });
  };

  const handleSaveCardNumber = async () => {
    if (!state || !editCardModal) return;
    const value = editCardModal.number.trim().replace(/^Tab\s*#?\s*/i, "");
    if (!value || value === editCardModal.currentNumber) {
      setEditCardModal(null);
      return;
    }
    try {
      await api({ action: "updateCardNumber", gameId: state.game.id, cardId: editCardModal.cardId, number: value });
      setState({
        ...state,
        cards: state.cards.map((item) => item.id === editCardModal.cardId ? { ...item, number: value } : item),
        winners: state.winners.map((winner) => winner.cardId === editCardModal.cardId ? { ...winner, cardNumber: value } : winner),
      });
      setEditCardModal(null);
      notify(`Cartón actualizado a Tab #${value}.`);
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : "No se pudo cambiar el número del cartón.", "error");
    }
  };

  const openCardEditor = (card: BingoCard) => {
    if (card.grid.length !== 25) {
      openEditCardNumberModal(card);
      return;
    }
    setEditingCardId(card.id);
    setManualOpen(true);
  };

  const closeCardEditor = () => {
    setManualOpen(false);
    setEditingCardId(null);
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

  // Conservados temporalmente sin exposición en la interfaz para compatibilidad con partidas antiguas.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
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

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
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
        const pattern = availablePatterns.find((item) => item.id === winner.patternId) ??
          (card ? specialCardPatternForGrid(card.grid, card.serial) : null);
        const compactRows = card && card.grid.length !== 25
          ? Math.ceil(card.grid.length / 5)
          : 5;
        const blockHeight = card?.grid.length !== 25
          ? 20 + compactRows * 8
          : 58;
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
          const numberSheetForm = numberSheetFormForGrid(card.grid);
          const columns = 5;
          const rows = card.grid.length === 25
            ? 5
            : Math.ceil(card.grid.length / columns);
          const cellSize = 8;
          for (let row = 0; row < rows; row += 1) {
            for (let column = 0; column < columns; column += 1) {
              const index = row * columns + column;
              const value = card.grid[index];
              if (value === undefined) continue;
              const target = pattern.cells.includes(index);
              const marked = value > 0
                ? called.has(value)
                : !numberSheetForm && index === 12;
              pdf.setFillColor(target ? 215 : marked ? 220 : 245, target ? 255 : marked ? 235 : 245, target ? 63 : marked ? 220 : 245);
              pdf.rect(16 + column * cellSize, y + row * cellSize, cellSize, cellSize, "FD");
              pdf.setTextColor(target ? 20 : 45, 50, 45);
              const label = value === 0
                ? numberSheetForm && index === 12
                  ? `F${numberSheetForm}`
                  : numberSheetForm
                    ? ""
                    : "L"
                : String(value);
              pdf.text(label, 20 + column * cellSize, y + 5.2 + row * cellSize, { align: "center" });
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

  const filteredAuditLogs = useMemo(() => {
    return auditLogs.filter((entry) => {
      if (auditFilterFile !== "all" && entry.file !== auditFilterFile) return false;
      if (auditFilterType !== "all" && entry.type !== auditFilterType) return false;
      if (auditSearch.trim()) {
        const q = auditSearch.trim().toLowerCase();
        const matchFile = entry.file.toLowerCase().includes(q);
        const matchCard = (entry.cardIdentifier ?? "").toLowerCase().includes(q);
        const matchReason = entry.reason.toLowerCase().includes(q);
        const matchPage = String(entry.page ?? "").includes(q);
        if (!matchFile && !matchCard && !matchReason && !matchPage) return false;
      }
      return true;
    });
  }, [auditLogs, auditFilterFile, auditFilterType, auditSearch]);

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
    const membershipEmail = access.email || authUser?.email || "";
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
          <div className="membership-email"><UserRound size={17} /><span>{membershipEmail || "Correo de la sesión no disponible"}</span></div>
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
          <button className="auth-link" onClick={() => void supabase.auth.signOut()} type="button">Cerrar sesión y volver al inicio</button>
          {error && <div className="membership-error">{error}</div>}
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
            <button className="secondary-button compact" onClick={openNewGameModal} type="button"><RefreshCw size={16} /> Nuevo juego</button>
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
                          <span className={index === 0 ? "latest" : ""} key={`${draw.id}-${index}`}>{draw.number}</span>
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
                  {patternStatuses.map(({ pattern, cards, nearest, winners }, index) => (
                    <article className="live-pattern-card" key={`${pattern.id}-${index}`}>
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
                        .slice(0, 12)
                        .map((card, index) => (
                          <CardPreview
                            called={called}
                            card={card}
                            key={`${card.id}-${index}`}
                            onToggleStatus={toggleCardStatus}
                            onEditNumber={openCardEditor}
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
                      {state.winners.slice(0, 4).map((winner, index) => (
                        <button key={`${winner.id}-${index}`} onClick={() => setWinnerModal([winner])} type="button">
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
                <div><span className="eyebrow">ADMINISTRACIÓN</span><h2>Cartones de la partida.</h2><p>Importa PDFs, imágenes o fotografías; también puedes ingresar cartones manualmente.</p></div>
                <div className="flex-gap-sm">
                  <button className="secondary-button" onClick={() => setAuditModalOpen(true)} type="button">
                    <ClipboardList size={17} /> Auditoría de Importación
                    {auditLogs.some((a) => a.type === "error" || a.type === "warning") && (
                      <span className="audit-badge-pill">
                        {auditLogs.filter((a) => a.type === "error" || a.type === "warning").length}
                      </span>
                    )}
                  </button>
                  <button className="primary-button" onClick={() => setManualOpen(true)} type="button"><SquarePen size={17} /> Ingreso manual</button>
                </div>
              </div>
              <input
                accept="application/pdf,.pdf,image/*,.png,.jpg,.jpeg,.webp,.bmp,.gif,.avif,.heic,.heif"
                className="visually-hidden"
                disabled={processingFiles}
                multiple
                onChange={(event) => {
                  const selectedFiles = Array.from(event.currentTarget.files ?? []);
                  event.currentTarget.value = "";
                  void processFiles(selectedFiles);
                }}
                ref={fileInputRef}
                type="file"
              />
              <input
                accept="image/*"
                capture="environment"
                className="visually-hidden"
                disabled={processingFiles}
                onChange={(event) => {
                  const selectedFiles = Array.from(event.currentTarget.files ?? []);
                  event.currentTarget.value = "";
                  void processFiles(selectedFiles);
                }}
                ref={cameraInputRef}
                type="file"
              />
              <section
                className={`upload-zone ${processingFiles ? "processing" : ""}`}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  if (importBusyRef.current) {
                    notify("Espera a que termine la importación actual antes de seleccionar otros archivos.", "warning");
                    return;
                  }
                  void processFiles(Array.from(event.dataTransfer.files));
                }}
              >
                {processingFiles ? (
                  <>
                    <span className="upload-icon"><LoaderCircle className="spin" size={29} /></span>
                    <div><strong>{pdfProgress?.stage ?? "Preparando archivo"}</strong><p>{pdfProgress?.file} · página {pdfProgress?.page ?? 0} de {pdfProgress?.pages ?? 0}</p></div>
                    <div className="upload-progress"><i style={{ width: `${pdfProgress?.percent ?? 4}%` }} /></div>
                  </>
                ) : (
                  <>
                    <span className="upload-icon"><UploadCloud size={29} /></span>
                    <div><strong>Suelta aquí PDFs o imágenes de bingo</strong><p>Reconocemos tablas 5×5, Sabrosito y hojas de números respetando la serie de la hoja (ej. Tab #152919-1, Tab #152919-2, etc.).</p></div>
                    <div className="upload-actions">
                      <button className="secondary-button" onClick={() => fileInputRef.current?.click()} type="button">Seleccionar archivos</button>
                      <button className="secondary-button" onClick={() => cameraInputRef.current?.click()} type="button"><Camera size={15} /> Usar cámara</button>
                    </div>
                    <small>PDF · PNG · JPG · WEBP · imágenes compatibles · cámara del dispositivo</small>
                  </>
                )}
              </section>
              {importWarnings.length > 0 && (
                <section className="warning-box">
                  <AlertTriangle size={19} />
                  <div style={{ flex: 1 }}>
                    <strong>Revisión de la última importación</strong>
                    {importWarnings.slice(0, 5).map((warning, index) => <p key={`warning-${index}-${warning.slice(0, 20)}`}>{warning}</p>)}
                    <button
                      className="secondary-button compact"
                      style={{ marginTop: 8 }}
                      onClick={() => setAuditModalOpen(true)}
                      type="button"
                    >
                      <ClipboardList size={14} /> Abrir Panel de Auditoría completo ({auditLogs.length} registros)
                    </button>
                  </div>
                  <button onClick={() => setImportWarnings([])} type="button"><X size={17} /></button>
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
                  {filteredCards.map((card, index) => (
                    <CardPreview
                      card={card}
                      called={called}
                      key={`${card.id}-${index}`}
                      onDelete={deleteCard}
                      onEditNumber={openCardEditor}
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
                  action={<div className="empty-actions"><button className="primary-button" onClick={() => fileInputRef.current?.click()} type="button"><UploadCloud size={16} /> Importar archivos</button><button className="secondary-button" onClick={() => cameraInputRef.current?.click()} type="button"><Camera size={16} /> Cámara</button><button className="secondary-button" onClick={() => setManualOpen(true)} type="button"><SquarePen size={16} /> Crear manual</button></div>}
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
                <div>
                  <span className="eyebrow">CONFIGURACIÓN Y PLANTILLAS DE CUENTA</span>
                  <h2>Gestión de Patrones y Formas Predefinidas</h2>
                  <p>Administra los patrones del juego. Configura y predefine figuras (línea, diagonal, cuadro, letras, especial) que se guardarán como plantillas permanentes en tu cuenta.</p>
                </div>
                <button className="primary-button" onClick={() => openPatternEditor()} type="button">
                  <Plus size={17} /> Crear plantilla / patrón
                </button>
              </div>

              {/* Navigation Tabs */}
              <div className="pattern-tabs">
                <button
                  type="button"
                  className={`pattern-tab-btn ${patternTab === "templates" ? "active" : ""}`}
                  onClick={() => setPatternTab("templates")}
                >
                  <Bookmark size={15} /> Plantillas de mi Cuenta ({templateCatalog.length})
                </button>
                <button
                  type="button"
                  className={`pattern-tab-btn ${patternTab === "game" ? "active" : ""}`}
                  onClick={() => setPatternTab("game")}
                >
                  <Layers size={15} /> Patrones en Juego Activo ({gamePatterns.length})
                </button>
              </div>

              {patternTab === "templates" && (
                <>
                  <div className="template-info-banner">
                    <ShieldCheck size={20} />
                    <div>
                      <strong>Plantillas Guardadas en tu Cuenta ({authUser?.email || "Usuario"})</strong>
                      <p>
                        Todas las formas creadas o configuradas aquí quedan guardadas en tu cuenta de usuario.
                        Se utilizarán automáticamente como plantillas seleccionables para tus partidas.
                      </p>
                    </div>
                  </div>

                  <div className="template-filter-bar">
                    <div className="filter-pills">
                      {["Todas", "Líneas", "Diagonales", "Cuadros", "Letras", "Especiales", "Personalizados"].map((cat) => (
                        <button
                          key={cat}
                          type="button"
                          className={`filter-pill ${templateCategoryFilter === cat ? "active" : ""}`}
                          onClick={() => setTemplateCategoryFilter(cat)}
                        >
                          {cat}
                        </button>
                      ))}
                    </div>
                    <div className="search-box" style={{ width: 240 }}>
                      <Search size={15} />
                      <input
                        onChange={(e) => setTemplateSearch(e.target.value)}
                        placeholder="Buscar plantilla…"
                        value={templateSearch}
                      />
                    </div>
                  </div>

                  <div className="pattern-grid">
                    {filteredTemplates.map((pattern, index) => {
                      const enabledInGame = !state?.disabledPatternIds.includes(pattern.id);
                      return (
                        <article className={`pattern-card ${enabledInGame ? "active" : ""}`} key={`${pattern.id}-${index}`}>
                          <div className="pattern-card-top">
                            <PatternMini pattern={pattern} />
                            <span>
                              {enabledInGame ? <Check size={13} /> : <Plus size={13} />}
                              {enabledInGame ? "En partida" : "Plantilla"}
                            </span>
                          </div>
                          <strong>{pattern.name}</strong>
                          <p>{pattern.description}</p>
                          <div className="pattern-actions">
                            <button
                              className={enabledInGame ? "ghost-button" : "secondary-button"}
                              onClick={() => void togglePattern(pattern, !enabledInGame)}
                              type="button"
                            >
                              {enabledInGame ? "Quitar de partida" : "Activar en partida"}
                            </button>
                            <button
                              className="icon-button"
                              onClick={() => openPatternEditor(pattern)}
                              title="Editar / Adaptar plantilla"
                              type="button"
                            >
                              <PencilLine size={15} />
                            </button>
                            {pattern.custom && (
                              <button
                                className="icon-button danger-button"
                                onClick={() => void deletePattern(pattern)}
                                title="Eliminar de mi cuenta"
                                type="button"
                              >
                                <Trash2 size={15} />
                              </button>
                            )}
                          </div>
                          <footer>
                            <span>{pattern.category || "General"}</span>
                            <span>{pattern.difficulty} · {pattern.cells.length} casillas</span>
                          </footer>
                        </article>
                      );
                    })}
                  </div>
                </>
              )}

              {patternTab === "game" && (
                <>
                  <section className="active-pattern-hero all-patterns-hero">
                    <div>
                      <span className="eyebrow"><Zap size={14} /> JUEGO ACTUAL</span>
                      <h3>{gamePatterns.length} patrones habilitados para la partida</h3>
                      <p>Solo las figuras habilitadas se verifican con cada bolilla en los cartones.</p>
                      <div>
                        <b>{availablePatterns.filter((p) => !p.custom).length} estándar</b>
                        <b>{availablePatterns.filter((p) => p.custom).length} personalizados</b>
                        <b>{state.disabledPatternIds.length} inhabilitados</b>
                      </div>
                    </div>
                    <div className="pattern-stack-preview">
                      {gamePatterns.slice(0, 4).map((pattern, index) => <PatternMini key={`mini-${pattern.id}-${index}`} pattern={pattern} />)}
                    </div>
                  </section>
                  <div className="pattern-grid">
                    {availablePatterns.map((pattern, index) => {
                      const enabled = !state.disabledPatternIds.includes(pattern.id);
                      const hasWinner = state.winners.some((winner) => winner.patternId === pattern.id);
                      return (
                        <article className={`pattern-card ${enabled ? "active" : "disabled"}`} key={`${pattern.id}-${index}`}>
                          <div className="pattern-card-top">
                            <PatternMini pattern={pattern} />
                            <span>{enabled ? <Check size={14} /> : <Pause size={14} />} {enabled ? "En juego" : "Inhabilitado"}</span>
                          </div>
                          <strong>{pattern.name}</strong>
                          <p>{pattern.description}</p>
                          {hasWinner && <div className="pattern-winner-note"><Trophy size={13} /> Ya tiene ganador</div>}
                          <div className="pattern-actions">
                            <button className={enabled ? "ghost-button" : "secondary-button"} onClick={() => void togglePattern(pattern, !enabled)} type="button">
                              {enabled ? "Inhabilitar" : "Habilitar"}
                            </button>
                            <button className="icon-button" onClick={() => openPatternEditor(pattern)} title="Editar patrón" type="button"><PencilLine size={15} /></button>
                            <button className="icon-button danger-button" onClick={() => void deletePattern(pattern)} title="Eliminar patrón" type="button"><Trash2 size={15} /></button>
                          </div>
                          <footer><span>{pattern.category}</span><span>{pattern.difficulty}</span></footer>
                        </article>
                      );
                    })}
                  </div>
                </>
              )}
            </motion.div>
          )}

          {view === "reports" && (
            <motion.div animate={{ opacity: 1, y: 0 }} className="view-stack" initial={{ opacity: 0, y: 8 }}>
              <div className="section-heading">
                <div><span className="eyebrow">INFORMES Y CONTROL</span><h2>Todo queda registrado.</h2><p>Exporta la partida actual y consulta sus indicadores clave.</p></div>
              </div>
              <div className="report-grid">
                <button onClick={exportPdf} type="button"><span className="report-icon pdf"><FileText size={23} /></span><div><strong>Reporte PDF</strong><p>Resumen, bolillas, patrones y cartones ganadores completos.</p></div><Download size={18} /></button>
              </div>
              <section className="panel winning-cards-report">
                <div className="panel-heading">
                  <div><span className="eyebrow">CARTONES GANADORES</span><h3>Tabla y patrón premiado</h3></div>
                  <span className="winner-count">{state.winners.length}</span>
                </div>
                {state.winners.length ? (
                  <div className="winning-cards-grid">
                    {state.winners.map((winner, index) => {
                      const card = state.cards.find((item) => item.id === winner.cardId);
                      const pattern = card
                        ? [...availablePatterns, COMPACT_CARD_PATTERN].find((item) => item.id === winner.patternId) ??
                          specialCardPatternForGrid(card.grid, card.serial)
                        : null;
                      if (!card || !pattern) return null;
                      return (
                        <article className="winning-card-report" key={`${winner.id}-${index}`}>
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
                    <div><dt>Procesamiento PDF</dt><dd>Local · sin almacenamiento</dd></div>
                  </dl>
                </section>
                <section className="panel audit-panel">
                  <div className="panel-heading"><div><span className="eyebrow">TRAZABILIDAD</span><h3>Eventos de la partida</h3></div><ShieldCheck size={20} /></div>
                  <div className="audit-list">
                    {state.draws.slice(-6).reverse().map((draw, index) => (
                      <div key={`${draw.id}-${index}`}><i /><div><strong>Bolilla {draw.number} registrada</strong><span>Validación automática completada</span></div><time>{new Date(draw.drawnAt).toLocaleTimeString("es-EC", { hour: "2-digit", minute: "2-digit" })}</time></div>
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
              {state.access.isPrimaryAdmin && (
                <section className="panel membership-admin-panel">
                  <div className="panel-heading"><div><span className="eyebrow">ADMINISTRADORES</span><h3>Administradores adicionales</h3></div><span className="secure-badge"><ShieldCheck size={14} /> Solo propietario</span></div>
                  <div className="admin-manager">
                    <div className="admin-add"><input onChange={(event) => setAdminEmail(event.target.value)} placeholder="correo@ejemplo.com" type="email" value={adminEmail} /><button className="primary-button" disabled={!adminEmail.includes("@") } onClick={() => void manageAdmin("addAdmin", adminEmail)} type="button"><Plus size={16} /> Aprobar administrador</button></div>
                    {(state.admins ?? []).map((admin, index) => <div className="admin-row" key={`${admin.email}-${index}`}><span><strong>{admin.email}</strong><small>Aprobado por {admin.addedBy}</small></span><button className="danger-button compact" onClick={() => window.confirm(`¿Quitar permisos de administrador a ${admin.email}?`) && void manageAdmin("removeAdmin", admin.email)} type="button"><Trash2 size={14} /> Quitar</button></div>)}
                    {!(state.admins ?? []).length && <small className="admin-empty">Todavía no hay administradores adicionales.</small>}
                  </div>
                </section>
              )}
              <section className="panel membership-admin-panel">
                <div className="panel-heading"><div><span className="eyebrow">SOLICITUDES</span><h3>Control de acceso</h3></div><span className="secure-badge"><ShieldCheck size={14} /> Administrador</span></div>
                <div className="membership-list">
                  {(state.memberships ?? []).map((membership, index) => (
                    <article key={`${membership.id}-${index}`}>
                      <span className={`membership-status status-${membership.status}`}>{membership.status}</span>
                      <div><strong>{membership.name || "Sin nombre"}</strong><small>{membership.email}</small></div>
                      <div><b>{membership.months || 1} mes(es)</b><small>{membership.expiresAt ? `Hasta ${new Date(membership.expiresAt).toLocaleDateString("es-EC")}` : "Sin activar"}</small>{membership.accessCode && <code className="membership-code">Código: {membership.accessCode}</code>}</div>
                      <div className="membership-actions">
                        {membership.status !== "approved" && <label className="months-control"><span>Meses</span><input min={1} max={120} onChange={(event) => setMembershipMonths((current) => ({ ...current, [membership.id]: Math.max(1, Math.min(120, Number(event.target.value) || 1)) }))} type="number" value={membershipMonths[membership.id] ?? membership.months ?? 1} /></label>}
                        {membership.status !== "approved" && <button className="primary-button compact" onClick={() => void manageMembership(membership, "approveMembership")} type="button">Aprobar</button>}
                        {membership.status === "approved" && membership.accessCode && <button className="secondary-button compact" onClick={() => { void navigator.clipboard?.writeText(membership.accessCode || ""); notify("Código copiado."); }} type="button">Copiar código</button>}
                        {membership.status === "approved" && <button className="secondary-button compact" onClick={() => void manageMembership(membership, "resendMembershipCode")} type="button">Reenviar código</button>}
                        {membership.deviceBound && <button className="secondary-button compact" onClick={() => void manageMembership(membership, "resetMembershipDevice")} type="button">Cambiar dispositivo</button>}
                        {membership.status === "pending" && <button className="ghost-button compact" onClick={() => void manageMembership(membership, "rejectMembership")} type="button">Rechazar</button>}
                        <button className="danger-button compact" onClick={() => window.confirm(`¿Eliminar a ${membership.email}? Su acceso quedará bloqueado.`) && void manageMembership(membership, "deleteMembershipUser")} type="button"><Trash2 size={14} /> Eliminar</button>
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
        <CardEditorModal
          editingCard={editingCardId ? state?.cards.find((c) => c.id === editingCardId) ?? null : null}
          existingNumbers={new Set((state?.cards ?? []).map((c) => c.number.trim().toLowerCase()))}
          isOpen={manualOpen}
          onClose={closeCardEditor}
          onSave={saveManualCard}
        />

        {patternOpen && (
          <motion.div animate={{ opacity: 1 }} className="modal-backdrop" exit={{ opacity: 0 }} initial={{ opacity: 0 }}>
            <motion.section animate={{ opacity: 1, scale: 1, y: 0 }} className="modal pattern-modal" exit={{ opacity: 0, scale: 0.98, y: 12 }} initial={{ opacity: 0, scale: 0.98, y: 12 }}>
              <header><div><span className="eyebrow">EDITOR VISUAL</span><h2>{editingPatternId || replacingPatternId ? "Editar patrón" : "Nuevo patrón"}</h2></div><button className="icon-button" onClick={() => setPatternOpen(false)} type="button"><X size={19} /></button></header>
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
                {winnerModal.map((winner, index) => {
                  const card = state.cards.find((item) => item.id === winner.cardId);
                  return (
                    <div key={`win-dtl-${winner.id}-${index}`}>
                      <span>#{winner.cardNumber}</span>
                      <div><strong>{winner.patternName}</strong><small>{card?.sourceFile} {card?.sourcePage ? `· página ${card.sourcePage}` : "· ingreso manual"}</small></div>
                      <time>{new Date(winner.validatedAt).toLocaleTimeString("es-EC")}</time>
                    </div>
                  );
                })}
              </div>
              <div className="winner-card-previews">
                {winnerModal.map((winner, index) => {
                  const card = state.cards.find((item) => item.id === winner.cardId);
                  const pattern = card
                    ? [...availablePatterns, COMPACT_CARD_PATTERN].find((item) => item.id === winner.patternId) ??
                      specialCardPatternForGrid(card.grid, card.serial)
                    : null;
                  if (!card) return null;
                  return <article key={`card-preview-${winner.id}-${index}`}><strong>Tab #{card.number} · {winner.patternName}</strong><BingoGrid called={called} compact grid={card.grid} pattern={pattern ?? undefined} /></article>;
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

        {newGameModalOpen && (
          <motion.div animate={{ opacity: 1 }} className="modal-backdrop" exit={{ opacity: 0 }} initial={{ opacity: 0 }}>
            <motion.section animate={{ opacity: 1, scale: 1 }} className="modal small-modal" exit={{ opacity: 0, scale: 0.98 }} initial={{ opacity: 0, scale: 0.98 }}>
              <header>
                <div>
                  <span className="eyebrow">NUEVA PARTIDA</span>
                  <h2>Crear nuevo juego</h2>
                </div>
                <button className="icon-button" onClick={() => setNewGameModalOpen(false)} type="button">
                  <X size={19} />
                </button>
              </header>
              <div className="form-stack">
                <label>Nombre del juego
                  <input onChange={(e) => setNewGameDraft({ ...newGameDraft, name: e.target.value })} value={newGameDraft.name} />
                </label>
                <div className="form-row">
                  <label>Fecha
                    <input onChange={(e) => setNewGameDraft({ ...newGameDraft, date: e.target.value })} type="date" value={newGameDraft.date} />
                  </label>
                  <label>Premio
                    <input onChange={(e) => setNewGameDraft({ ...newGameDraft, prize: e.target.value })} placeholder="Ej. Premio mayor" value={newGameDraft.prize} />
                  </label>
                </div>
              </div>
              <footer>
                <button className="ghost-button" onClick={() => setNewGameModalOpen(false)} type="button">Cancelar</button>
                <button className="primary-button" onClick={() => void handleCreateNewGame()} type="button">Crear partida</button>
              </footer>
            </motion.section>
          </motion.div>
        )}

        {editCardModal && (
          <motion.div animate={{ opacity: 1 }} className="modal-backdrop" exit={{ opacity: 0 }} initial={{ opacity: 0 }}>
            <motion.section animate={{ opacity: 1, scale: 1 }} className="modal small-modal" exit={{ opacity: 0, scale: 0.98 }} initial={{ opacity: 0, scale: 0.98 }}>
              <header>
                <div>
                  <span className="eyebrow">IDENTIFICACIÓN</span>
                  <h2>Número del cartón</h2>
                </div>
                <button className="icon-button" onClick={() => setEditCardModal(null)} type="button"><X size={19} /></button>
              </header>
              <div className="form-stack">
                <label>Número o identificador
                  <input onChange={(e) => setEditCardModal({ ...editCardModal, number: e.target.value })} value={editCardModal.number} />
                </label>
              </div>
              <footer>
                <button className="ghost-button" onClick={() => setEditCardModal(null)} type="button">Cancelar</button>
                <button className="primary-button" onClick={() => void handleSaveCardNumber()} type="button">Guardar número</button>
              </footer>
            </motion.section>
          </motion.div>
        )}

        {confirmModal && (
          <motion.div animate={{ opacity: 1 }} className="modal-backdrop" exit={{ opacity: 0 }} initial={{ opacity: 0 }}>
            <motion.section animate={{ opacity: 1, scale: 1 }} className="modal small-modal" exit={{ opacity: 0, scale: 0.98 }} initial={{ opacity: 0, scale: 0.98 }}>
              <header>
                <div>
                  <span className="eyebrow">CONFIRMACIÓN</span>
                  <h2>{confirmModal.title}</h2>
                </div>
                <button className="icon-button" onClick={() => setConfirmModal(null)} type="button"><X size={19} /></button>
              </header>
              <div className="form-stack">
                <p style={{ margin: 0, fontSize: "0.95rem", color: "var(--text-secondary)" }}>{confirmModal.message}</p>
              </div>
              <footer>
                <button className="ghost-button" onClick={() => setConfirmModal(null)} type="button">Cancelar</button>
                <button className="danger-button" onClick={() => void confirmModal.onConfirm()} type="button">{confirmModal.confirmText || "Confirmar"}</button>
              </footer>
            </motion.section>
          </motion.div>
        )}

        {auditModalOpen && (
          <motion.div animate={{ opacity: 1 }} className="modal-backdrop" exit={{ opacity: 0 }} initial={{ opacity: 0 }}>
            <motion.section animate={{ opacity: 1, scale: 1 }} className="modal wide-modal audit-modal" exit={{ opacity: 0, scale: 0.98 }} initial={{ opacity: 0, scale: 0.98 }}>
              <header>
                <div>
                  <span className="eyebrow"><ClipboardList size={14} className="inline-icon" /> AUDITORÍA DE IMPORTACIÓN</span>
                  <h2>Panel de Auditoría de Importación</h2>
                  <p>Detalle de validación, errores de parsing y causas de rechazo registradas durante la carga de archivos PDF e imágenes.</p>
                </div>
                <button className="icon-button" onClick={() => setAuditModalOpen(false)} type="button"><X size={19} /></button>
              </header>

              <div className="audit-kpi-grid">
                <div className="audit-kpi-card">
                  <span>Total registros</span>
                  <strong>{auditLogs.length}</strong>
                </div>
                <div className="audit-kpi-card error">
                  <span><AlertCircle size={14} /> Errores</span>
                  <strong>{auditLogs.filter((a) => a.type === "error").length}</strong>
                </div>
                <div className="audit-kpi-card warning">
                  <span><AlertTriangle size={14} /> Advertencias</span>
                  <strong>{auditLogs.filter((a) => a.type === "warning").length}</strong>
                </div>
                <div className="audit-kpi-card duplicate">
                  <span><FileCode size={14} /> Duplicados</span>
                  <strong>{auditLogs.filter((a) => a.type === "duplicate").length}</strong>
                </div>
                <div className="audit-kpi-card success">
                  <span><CheckCircle2 size={14} /> Correctos</span>
                  <strong>{auditLogs.filter((a) => a.type === "info").length}</strong>
                </div>
              </div>

              <div className="audit-filters-bar">
                <div className="filter-group">
                  <label>Archivo:</label>
                  <select onChange={(e) => setAuditFilterFile(e.target.value)} value={auditFilterFile}>
                    <option value="all">Todos los archivos ({auditLogs.length})</option>
                    {Array.from(new Set(auditLogs.map((a) => a.file))).map((f, index) => (
                      <option key={`${f}-${index}`} value={f}>{f}</option>
                    ))}
                  </select>
                </div>

                <div className="filter-group">
                  <label>Estado:</label>
                  <select onChange={(e) => setAuditFilterType(e.target.value)} value={auditFilterType}>
                    <option value="all">Todos los estados</option>
                    <option value="error">🔴 Errores ({auditLogs.filter((a) => a.type === "error").length})</option>
                    <option value="warning">🟡 Advertencias ({auditLogs.filter((a) => a.type === "warning").length})</option>
                    <option value="duplicate">🟧 Duplicados ({auditLogs.filter((a) => a.type === "duplicate").length})</option>
                    <option value="info">🟢 Correctos ({auditLogs.filter((a) => a.type === "info").length})</option>
                  </select>
                </div>

                <div className="search-group">
                  <Search size={15} />
                  <input
                    onChange={(e) => setAuditSearch(e.target.value)}
                    placeholder="Buscar por número, página o causa..."
                    type="text"
                    value={auditSearch}
                  />
                  {auditSearch && (
                    <button className="ghost-button icon-only" onClick={() => setAuditSearch("")} type="button">
                      <X size={14} />
                    </button>
                  )}
                </div>
              </div>

              <div className="audit-table-container">
                {filteredAuditLogs.length === 0 ? (
                  <div className="empty-audit">
                    <ClipboardList size={38} />
                    <p>{auditLogs.length === 0 ? "No hay registros de auditoría de importación en esta partida." : "No hay registros que coincidan con los filtros seleccionados."}</p>
                  </div>
                ) : (
                  <table className="audit-table">
                    <thead>
                      <tr>
                        <th>Hora</th>
                        <th>Archivo</th>
                        <th>Pág.</th>
                        <th>Cartón / ID</th>
                        <th>Estado</th>
                        <th>Causa exacta / Detalle de validación</th>
                        <th>Acciones</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredAuditLogs.map((entry, index) => (
                        <tr className={`audit-row ${entry.type}`} key={`audit-${entry.id}-${index}`}>
                          <td className="timestamp-cell">
                            {new Date(entry.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                          </td>
                          <td className="file-cell" title={entry.file}>{entry.file}</td>
                          <td className="page-cell">{entry.page ? `Pág. ${entry.page}` : "-"}</td>
                          <td className="card-id-cell">
                            <strong>{entry.cardIdentifier || "N/A"}</strong>
                          </td>
                          <td className="type-cell">
                            <span className={`badge-pill badge-${entry.type}`}>
                              {entry.type === "error" && "🔴 ERROR"}
                              {entry.type === "warning" && "🟡 ADVERTENCIA"}
                              {entry.type === "duplicate" && "🟧 DUPLICADO"}
                              {entry.type === "info" && "🟢 OK"}
                            </span>
                          </td>
                          <td className="reason-cell">
                            <p style={{ margin: 0 }}>{entry.reason}</p>
                            {entry.gridSnippet && (
                              <button
                                className="text-link-button"
                                onClick={() => setSelectedAuditGridSnippet(selectedAuditGridSnippet?.id === entry.id ? null : { id: entry.id, grid: entry.gridSnippet! })}
                                type="button"
                              >
                                <Eye size={12} /> {selectedAuditGridSnippet?.id === entry.id ? "Ocultar casillas leídas" : "Ver casillas leídas (5x5)"}
                              </button>
                            )}
                            {selectedAuditGridSnippet?.id === entry.id && (
                              <div className="audit-grid-preview">
                                <small>Números extraídos por el parser:</small>
                                <div className="grid-snippet-5x5">
                                  {selectedAuditGridSnippet.grid.map((num, i) => (
                                    <span className={num === 0 ? "free-cell" : num < 1 || num > 75 ? "invalid-cell" : ""} key={`snip-${i}`}>
                                      {num === 0 ? "LIBRE" : num}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}
                          </td>
                          <td className="actions-cell">
                            <div className="flex-gap-sm">
                              {(entry.type === "error" || entry.type === "warning") && (
                                <button
                                  className="secondary-button compact"
                                  onClick={() => {
                                    setAuditModalOpen(false);
                                    setEditingCardId(null);
                                    setManualNumber(entry.cardIdentifier || "");
                                    setManualSerial("");
                                    if (entry.gridSnippet && entry.gridSnippet.length === 25) {
                                      setManualGrid(entry.gridSnippet.map((n) => String(n)));
                                    } else {
                                      setManualGrid(initialGrid);
                                    }
                                    setManualOpen(true);
                                  }}
                                  title="Abrir formulario para ingresar/corregir cartón"
                                  type="button"
                                >
                                  <PencilLine size={13} /> Corregir
                                </button>
                              )}
                              <button
                                className="ghost-button icon-only compact"
                                onClick={() => {
                                  navigator.clipboard.writeText(`${entry.file} [Pág ${entry.page || 1}] ${entry.cardIdentifier ? `Cartón ${entry.cardIdentifier}: ` : ""}${entry.reason}`);
                                  notify("Detalle de auditoría copiado.", "success");
                                }}
                                title="Copiar causa exacta al portapapeles"
                                type="button"
                              >
                                <Copy size={13} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              <footer>
                <div className="flex-between">
                  <div className="flex-gap-sm">
                    {auditLogs.length > 0 && (
                      <button
                        className="ghost-button danger-button"
                        onClick={async () => {
                          if (confirm("¿Deseas limpiar el registro de auditoría de importación de esta partida?")) {
                            setAuditLogs([]);
                            if (state?.game.id) {
                              await api({ action: "clearAuditLogs", gameId: state.game.id });
                            }
                            notify("Auditoría de importación limpiada.");
                          }
                        }}
                        type="button"
                      >
                        <Trash2 size={15} /> Limpiar registros
                      </button>
                    )}
                  </div>

                  <div className="flex-gap-sm">
                    <button
                      className="secondary-button"
                      disabled={!auditLogs.length}
                      onClick={() => {
                        const report = auditLogs.map((a) => `[${new Date(a.timestamp).toLocaleString()}] [${a.type.toUpperCase()}] ${a.file} (Pág. ${a.page || 1}) - ${a.cardIdentifier ? `Cartón ${a.cardIdentifier}: ` : ""}${a.reason}`).join("\n");
                        navigator.clipboard.writeText(report);
                        notify("Reporte completo copiado al portapapeles.");
                      }}
                      type="button"
                    >
                      <Copy size={15} /> Copiar reporte
                    </button>

                    <button
                      className="secondary-button"
                      disabled={!auditLogs.length}
                      onClick={() => {
                        const report = `AUDITORÍA DE IMPORTACIÓN BINGO PRO\nPartida: ${state?.game.name || "Bingo"}\nFecha: ${new Date().toLocaleString()}\n\n` +
                          auditLogs.map((a) => `[${new Date(a.timestamp).toLocaleString()}] [${a.type.toUpperCase()}] Archivo: ${a.file} | Pág: ${a.page || 1} | Cartón: ${a.cardIdentifier || "N/A"}\nCausa: ${a.reason}\n${a.gridSnippet ? `Cuadrícula: ${a.gridSnippet.join(",")}\n` : ""}---`).join("\n");
                        const blob = new Blob([report], { type: "text/plain;charset=utf-8" });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement("a");
                        a.href = url;
                        a.download = `auditoria_importacion_${state?.game.name || "bingo"}.txt`;
                        a.click();
                        URL.revokeObjectURL(url);
                      }}
                      type="button"
                    >
                      <Download size={15} /> Descargar TXT
                    </button>

                    <button className="primary-button" onClick={() => setAuditModalOpen(false)} type="button">
                      Cerrar
                    </button>
                  </div>
                </div>
              </footer>
            </motion.section>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="toast-stack">
        <AnimatePresence>
          {toasts.map((toast, index) => (
            <motion.div animate={{ opacity: 1, x: 0 }} className={`toast toast-${toast.tone}`} exit={{ opacity: 0, x: 24 }} initial={{ opacity: 0, x: 24 }} key={`toast-${toast.id}-${index}`}>
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
