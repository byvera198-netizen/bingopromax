"use client";

import React, { useState, useRef, useMemo } from "react";
import { motion } from "framer-motion";
import {
  X,
  Check,
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Wand2,
  RotateCcw,
  ClipboardPaste,
  Sparkles,
  Grid3X3,
} from "lucide-react";
import {
  validateCardGridDetailed,
  autoFixCardGridColumns,
  generateValidBingoGrid,
  type BingoCard,
} from "@/lib/bingo";

interface CardEditorModalProps {
  isOpen: boolean;
  editingCard: BingoCard | null;
  existingNumbers: Set<string>;
  onClose: () => void;
  onSave: (cardData: {
    number: string;
    serial: string;
    grid: number[];
  }) => Promise<void> | void;
}

export function CardEditorModal({
  isOpen,
  editingCard,
  existingNumbers,
  onClose,
  onSave,
}: CardEditorModalProps) {
  const [number, setNumber] = useState("");
  const [serial, setSerial] = useState("");
  const [isFreeCenter, setIsFreeCenter] = useState(true);
  const [grid, setGrid] = useState<string[]>(Array(25).fill(""));
  const [pasteInput, setPasteInput] = useState("");
  const [showPasteBox, setShowPasteBox] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  const [prevOpenState, setPrevOpenState] = useState<{ isOpen: boolean; cardId: string | null }>({
    isOpen: false,
    cardId: null,
  });

  if (isOpen !== prevOpenState.isOpen || (editingCard?.id ?? null) !== prevOpenState.cardId) {
    setPrevOpenState({ isOpen, cardId: editingCard?.id ?? null });
    setSubmitError(null);
    if (editingCard) {
      setNumber(editingCard.number);
      setSerial(editingCard.serial ?? "");
      const hasFreeCenter = editingCard.grid[12] === 0;
      setIsFreeCenter(hasFreeCenter);
      setGrid(
        editingCard.grid.map((val, idx) =>
          idx === 12 && hasFreeCenter ? "0" : val === 0 ? "0" : String(val),
        ),
      );
    } else {
      setNumber("");
      setSerial("");
      setIsFreeCenter(true);
      setGrid(generateValidBingoGrid(true));
    }
  }

  // Real-time validation computation
  const validation = useMemo(() => {
    return validateCardGridDetailed(grid, isFreeCenter);
  }, [grid, isFreeCenter]);

  // Duplicate card number check
  const isDuplicateCardNumber = useMemo(() => {
    if (!number.trim()) return false;
    const cleanNum = number.trim().toLowerCase();
    const editingNum = editingCard?.number.trim().toLowerCase();
    if (editingNum && cleanNum === editingNum) return false;
    return existingNumbers.has(cleanNum);
  }, [number, editingCard, existingNumbers]);

  if (!isOpen) return null;

  const handleCellChange = (index: number, rawVal: string) => {
    // Only allow digits up to 2 characters
    const cleanDigits = rawVal.replace(/\D/g, "").slice(0, 2);
    const updated = [...grid];
    updated[index] = cleanDigits;
    setGrid(updated);

    // Auto-advance if 2 digits entered
    if (cleanDigits.length === 2 && index < 24) {
      const nextIdx = index === 11 && isFreeCenter ? 13 : index + 1;
      if (nextIdx < 25) {
        setTimeout(() => {
          inputRefs.current[nextIdx]?.focus();
          inputRefs.current[nextIdx]?.select();
        }, 10);
      }
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && !grid[index] && index > 0) {
      const prevIdx = index === 13 && isFreeCenter ? 11 : index - 1;
      inputRefs.current[prevIdx]?.focus();
      return;
    }

    const row = Math.floor(index / 5);
    const col = index % 5;

    if (e.key === "ArrowRight" && col < 4) {
      e.preventDefault();
      inputRefs.current[index + 1]?.focus();
    } else if (e.key === "ArrowLeft" && col > 0) {
      e.preventDefault();
      inputRefs.current[index - 1]?.focus();
    } else if (e.key === "ArrowDown" && row < 4) {
      e.preventDefault();
      inputRefs.current[index + 5]?.focus();
    } else if (e.key === "ArrowUp" && row > 0) {
      e.preventDefault();
      inputRefs.current[index - 5]?.focus();
    }
  };

  const handleToggleFreeCenter = (checked: boolean) => {
    setIsFreeCenter(checked);
    const updated = [...grid];
    if (checked) {
      updated[12] = "0";
    } else if (updated[12] === "0") {
      updated[12] = "";
    }
    setGrid(updated);
  };

  const handleAutoFix = () => {
    const fixed = autoFixCardGridColumns(grid, isFreeCenter);
    setGrid(fixed);
  };

  const handleGenerateRandom = () => {
    const fresh = generateValidBingoGrid(isFreeCenter);
    setGrid(fresh);
  };

  const handleClear = () => {
    const emptyGrid = Array(25).fill("");
    if (isFreeCenter) emptyGrid[12] = "0";
    setGrid(emptyGrid);
  };

  const handleApplyPaste = () => {
    if (!pasteInput.trim()) return;
    const nums = pasteInput
      .split(/[\s,;\n\t]+/)
      .map((s) => s.replace(/\D/g, ""))
      .filter((s) => s.length > 0);

    if (nums.length === 0) return;

    const newGrid = [...grid];
    let numIdx = 0;
    for (let i = 0; i < 25; i++) {
      if (i === 12 && isFreeCenter) {
        newGrid[12] = "0";
        continue;
      }
      if (numIdx < nums.length) {
        newGrid[i] = nums[numIdx].slice(0, 2);
        numIdx++;
      }
    }
    setGrid(newGrid);
    setShowPasteBox(false);
    setPasteInput("");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);

    if (!number.trim()) {
      setSubmitError("Por favor, asigna un número identificador al cartón.");
      return;
    }

    if (isDuplicateCardNumber) {
      setSubmitError(`Ya existe un cartón registrado con el número '${number.trim()}'.`);
      return;
    }

    if (!validation.isValid) {
      if (validation.errors.length > 0) {
        setSubmitError(validation.errors[0]);
      } else if (validation.emptyCellsCount > 0) {
        setSubmitError(`Aún quedan ${validation.emptyCellsCount} casillas vacías en la cuadrícula.`);
      }
      return;
    }

    // Convert grid strings to numbers
    const numericGrid = validation.cells.map((cell) => cell.value ?? 0);

    try {
      setIsSubmitting(true);
      await onSave({
        number: number.trim(),
        serial: serial.trim(),
        grid: numericGrid,
      });
      onClose();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Error al guardar el cartón.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const rangesHelp = [
    { col: "B", range: "1 – 15" },
    { col: "I", range: "16 – 30" },
    { col: "N", range: "31 – 45" },
    { col: "G", range: "46 – 60" },
    { col: "O", range: "61 – 75" },
  ];

  return (
    <motion.div
      animate={{ opacity: 1 }}
      className="modal-backdrop"
      exit={{ opacity: 0 }}
      initial={{ opacity: 0 }}
    >
      <motion.section
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="modal manual-modal wide-card-editor"
        exit={{ opacity: 0, scale: 0.98, y: 12 }}
        initial={{ opacity: 0, scale: 0.98, y: 12 }}
        style={{ maxWidth: "860px", width: "95%" }}
      >
        <header className="flex-between">
          <div>
            <span className="eyebrow">
              <Grid3X3 className="inline-icon" size={14} />{" "}
              {editingCard ? "EDICIÓN DE CARTÓN" : "INGRESO MANUAL DE CARTÓN"}
            </span>
            <h2>{editingCard ? `Editar Cartón #${editingCard.number}` : "Crear un nuevo cartón"}</h2>
          </div>
          <button className="icon-button" onClick={onClose} type="button">
            <X size={19} />
          </button>
        </header>

        <form onSubmit={handleSubmit}>
          <div className="card-editor-grid-layout">
            {/* Left Controls Column */}
            <div className="card-editor-sidebar">
              <div className="form-group">
                <label htmlFor="card-number-input">
                  <strong>Número de Cartón *</strong>
                </label>
                <input
                  className={isDuplicateCardNumber ? "input-error" : ""}
                  id="card-number-input"
                  onChange={(e) => setNumber(e.target.value)}
                  placeholder="Ej. Tab #152920-2"
                  type="text"
                  value={number}
                />
                {isDuplicateCardNumber && (
                  <small className="field-error-msg">
                    <AlertCircle size={12} /> Número de cartón duplicado
                  </small>
                )}
              </div>

              <div className="form-group">
                <label htmlFor="card-serial-input">
                  <strong>Serie / Lote</strong> <small>(opcional)</small>
                </label>
                <input
                  id="card-serial-input"
                  onChange={(e) => setSerial(e.target.value)}
                  placeholder="Ej. SERIE-2026"
                  type="text"
                  value={serial}
                />
              </div>

              <div className="free-toggle-box">
                <label className="free-toggle">
                  <input
                    checked={isFreeCenter}
                    onChange={(e) => handleToggleFreeCenter(e.target.checked)}
                    type="checkbox"
                  />
                  <span />
                  <div>
                    <strong>Casilla Central Libre (0)</strong>
                    <small>Valida &quot;LIBRE&quot; en la columna N (fila 3)</small>
                  </div>
                </label>
              </div>

              {/* Grid Action Toolbar */}
              <div className="editor-quick-actions">
                <span className="section-label">Herramientas de Cuadrícula</span>

                <button
                  className="secondary-button compact full-width"
                  onClick={handleAutoFix}
                  title="Alinea los números ingresados a sus columnas B-I-N-G-O correspondientes"
                  type="button"
                >
                  <Wand2 size={14} /> Auto-corregir por Columna
                </button>

                <button
                  className="secondary-button compact full-width"
                  onClick={handleGenerateRandom}
                  title="Genera un cartón con 25 números aleatorios totalmente válidos"
                  type="button"
                >
                  <Sparkles size={14} /> Generar Cuadrícula Válida
                </button>

                <button
                  className="secondary-button compact full-width"
                  onClick={() => setShowPasteBox(!showPasteBox)}
                  title="Pegar secuencia de 25 números desde el portapapeles"
                  type="button"
                >
                  <ClipboardPaste size={14} /> {showPasteBox ? "Ocultar Pegar" : "Pegar 25 Números"}
                </button>

                <button
                  className="ghost-button compact full-width danger-text"
                  onClick={handleClear}
                  type="button"
                >
                  <RotateCcw size={14} /> Limpiar Casillas
                </button>
              </div>

              {/* Paste Sequence Box */}
              {showPasteBox && (
                <div className="paste-box-popover">
                  <small>Pega texto con 25 números (separados por espacio o coma):</small>
                  <textarea
                    onChange={(e) => setPasteInput(e.target.value)}
                    placeholder="Ej: 5 18 33 48 62 12 24 39..."
                    rows={3}
                    value={pasteInput}
                  />
                  <div className="flex-gap-xs" style={{ marginTop: "6px" }}>
                    <button
                      className="primary-button compact"
                      onClick={handleApplyPaste}
                      type="button"
                    >
                      Aplicar a cuadrícula
                    </button>
                    <button
                      className="ghost-button compact"
                      onClick={() => setShowPasteBox(false)}
                      type="button"
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Right Interactive Grid Column */}
            <div className="card-editor-main">
              {/* Column Range Header Badges */}
              <div className="bingo-header-bar">
                {rangesHelp.map((item) => (
                  <div className="bingo-col-badge" key={item.col}>
                    <strong className="bingo-letter">{item.col}</strong>
                    <small className="bingo-range">{item.range}</small>
                  </div>
                ))}
              </div>

              {/* 5x5 Matrix Inputs */}
              <div className="bingo-editor-grid-5x5">
                {validation.cells.map((cell, idx) => {
                  const isCenterFree = idx === 12 && isFreeCenter;

                  let cellClass = "bingo-cell-input";
                  if (isCenterFree) cellClass += " cell-free";
                  else if (cell.isOutOfRange) cellClass += " cell-error-range";
                  else if (cell.isDuplicate) cellClass += " cell-error-duplicate";
                  else if (cell.value !== null && cell.value > 0) cellClass += " cell-valid";
                  else cellClass += " cell-empty";

                  return (
                    <div className="bingo-cell-wrapper" key={idx}>
                      <input
                        aria-label={`Casilla ${cell.colLetter}${Math.floor(idx / 5) + 1}`}
                        className={cellClass}
                        disabled={isCenterFree}
                        inputMode="numeric"
                        maxLength={2}
                        onChange={(e) => handleCellChange(idx, e.target.value)}
                        onKeyDown={(e) => handleKeyDown(idx, e)}
                        placeholder={isCenterFree ? "LIBRE" : "—"}
                        ref={(el) => {
                          inputRefs.current[idx] = el;
                        }}
                        type="text"
                        value={isCenterFree ? "LIBRE" : cell.rawValue}
                      />

                      {/* Cell Badge Indicator */}
                      {!isCenterFree && cell.isOutOfRange && (
                        <span className="cell-mini-badge badge-err" title={cell.errors[0]}>
                          !
                        </span>
                      )}
                      {!isCenterFree && !cell.isOutOfRange && cell.isDuplicate && (
                        <span className="cell-mini-badge badge-dup" title="Número duplicado">
                          =
                        </span>
                      )}
                      {!isCenterFree && !cell.isOutOfRange && !cell.isDuplicate && cell.value !== null && (
                        <span className="cell-mini-badge badge-ok">
                          ✓
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Live Validation Summary Box */}
              <div className="realtime-validation-panel">
                {validation.isValid && !isDuplicateCardNumber && (
                  <div className="status-banner banner-success">
                    <CheckCircle2 size={18} />
                    <div>
                      <strong>Cuadrícula BINGO Válida (100%)</strong>
                      <span>Todas las casillas cumplen con los rangos B-I-N-G-O sin números repetidos.</span>
                    </div>
                  </div>
                )}

                {(!validation.isValid || isDuplicateCardNumber) && (
                  <div className="status-banner banner-warning">
                    <AlertTriangle size={18} />
                    <div className="banner-content">
                      <strong>Revisión de Integridad de la Cuadrícula</strong>
                      <ul>
                        {isDuplicateCardNumber && (
                          <li className="err-text">
                            El número de cartón &apos;{number}&apos; ya está en uso en esta partida.
                          </li>
                        )}

                        {validation.emptyCellsCount > 0 && (
                          <li>Faltan {validation.emptyCellsCount} casillas por ingresar.</li>
                        )}

                        {validation.outOfRangeCells.length > 0 && (
                          <li className="err-text">
                            {validation.outOfRangeCells.length} casilla(s) fuera de rango de columna (B:1-15, I:16-30, N:31-45, G:46-60, O:61-75).
                          </li>
                        )}

                        {validation.duplicateNumbers.length > 0 && (
                          <li className="err-text">
                            Números repetidos en la cuadrícula: {validation.duplicateNumbers.join(", ")}.
                          </li>
                        )}
                      </ul>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {submitError && (
            <div className="submit-error-banner">
              <AlertCircle size={16} />
              <span>{submitError}</span>
            </div>
          )}

          <footer>
            <button className="ghost-button" onClick={onClose} type="button">
              Cancelar
            </button>
            <button
              className="primary-button"
              disabled={isSubmitting || !validation.isValid || isDuplicateCardNumber}
              type="submit"
            >
              <Check size={17} />
              {isSubmitting
                ? "Guardando..."
                : editingCard
                ? "Guardar Cambios"
                : "Guardar Cartón"}
            </button>
          </footer>
        </form>
      </motion.section>
    </motion.div>
  );
}
