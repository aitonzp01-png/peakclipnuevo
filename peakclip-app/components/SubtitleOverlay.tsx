// SubtitleOverlay.tsx
// Subtítulos estilo YouTube Shorts virales - palabra por palabra animada

import { useEffect, useState, useRef } from "react";

// ─── Tipos ───────────────────────────────────────────────────────────────────

interface Word {
  word: string;
  start: number;
  end: number;
}

interface SRTSegment {
  start: number;
  end: number;
  text: string;
  words?: Word[];
}

export type SubtitleStyle =
  | "karaoke"
  | "beasty"
  | "deep_diver"
  | "youshaei"
  | "pod_p"
  | "mozi"
  | "popline"
  | "typewriter"
  | "none";

interface SubtitleOverlayProps {
  parsedSRT: SRTSegment[];
  currentTime: number;
  style?: SubtitleStyle;
  fontSize?: number;
  position?: "top" | "middle" | "bottom";
  color?: string;
  bold?: boolean;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Parsear SRT correctamente, incluye timestamps negativos y texto unido sin espacios.
 */
export function parseSRT(srt: string): SRTSegment[] {
  if (!srt || !srt.trim()) return [];

  const blocks = srt.trim().split(/\n\s*\n/);
  const result: SRTSegment[] = [];

  for (const block of blocks) {
    const lines = block.trim().split("\n");
    if (lines.length < 2) continue;

    // Saltar número de bloque
    let timeLineIdx = 0;
    if (/^\d+$/.test(lines[0].trim())) {
      timeLineIdx = 1;
    }

    const timeLine = lines[timeLineIdx];
    if (!timeLine || !timeLine.includes("-->")) continue;

    const [startStr, endStr] = timeLine.split("-->").map((s) => s.trim());

    const textLines = lines.slice(timeLineIdx + 1);
    const text = textLines
      .join(" ")
      .trim()
      .replace(/\s+/g, " ")
      // Quitar tags HTML como <i>, <b>, etc.
      .replace(/<[^>]+>/g, "");

    if (!text || text === " ") continue;

    result.push({
      start: srtTimeToSeconds(startStr),
      end: srtTimeToSeconds(endStr),
      text,
    });
  }

  // Corregir timestamps negativos (offset del video original)
  if (result.length > 0 && result[0].start < 0) {
    const offset = Math.abs(Math.min(...result.map((s) => s.start)));
    return result
      .map((s) => ({ ...s, start: s.start + offset, end: s.end + offset }))
      .filter((s) => s.start >= 0 && s.end > s.start);
  }

  return result.filter((s) => s.start >= 0 && s.end > s.start);
}

export function srtTimeToSeconds(timeStr: string): number {
  if (!timeStr) return 0;
  const clean = timeStr.trim().replace(",", ".");
  const parts = clean.split(":");
  if (parts.length !== 3) return 0;
  const [h, m, s] = parts.map(Number);
  return h * 3600 + m * 60 + s;
}

export function secondsToSRTTime(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  const ms = Math.round((s % 1) * 1000);
  return `${pad(h)}:${pad(m)}:${pad(sec)},${pad(ms, 3)}`;
}

function pad(n: number, len = 2) {
  return String(Math.floor(n)).padStart(len, "0");
}

export function srtToString(segments: SRTSegment[]): string {
  return segments
    .map((seg, idx) => {
      return `${idx + 1}\n${secondsToSRTTime(seg.start)} --> ${secondsToSRTTime(seg.end)}\n${seg.text}`;
    })
    .join("\n\n");
}

// ─── Estilos de subtítulos ────────────────────────────────────────────────────

const STYLE_CONFIGS: Record<
  SubtitleStyle,
  {
    wrapper: React.CSSProperties;
    text: React.CSSProperties;
    highlight?: React.CSSProperties;
    label: string;
    preview: string;
  }
> = {
  none: {
    label: "No captions",
    preview: "∅",
    wrapper: { display: "none" },
    text: {},
  },

  // ── Karaoke: palabra resaltada en amarillo, fondo negro semitransparente ──
  karaoke: {
    label: "Karaoke",
    preview: "Abc",
    wrapper: {
      background: "rgba(0,0,0,0.75)",
      borderRadius: "6px",
      padding: "6px 14px",
      textAlign: "center",
      maxWidth: "85%",
    },
    text: {
      fontFamily: '"Arial Black", "Arial Bold", Arial, sans-serif',
      fontSize: "22px",
      fontWeight: 900,
      color: "white",
      lineHeight: 1.25,
      letterSpacing: "0.3px",
    },
    highlight: {
      color: "#FFE500",
    },
  },

  // ── Beasty (MrBeast): texto amarillo grande, sombra negra gruesa ──
  beasty: {
    label: "Beasty",
    preview: "Abc",
    wrapper: { textAlign: "center", maxWidth: "90%" },
    text: {
      fontFamily: '"Arial Black", Impact, sans-serif',
      fontSize: "28px",
      fontWeight: 900,
      color: "#FFE500",
      textTransform: "uppercase",
      letterSpacing: "1px",
      lineHeight: 1.1,
      WebkitTextStroke: "2.5px black",
      textShadow:
        "-3px -3px 0 #000, 3px -3px 0 #000, -3px 3px 0 #000, 3px 3px 0 #000, 0 4px 8px rgba(0,0,0,0.8)",
    },
  },

  // ── Deep Diver: fondo azul oscuro, texto blanco ──
  deep_diver: {
    label: "Deep Diver",
    preview: "Abc",
    wrapper: {
      background: "rgba(10,20,80,0.82)",
      borderRadius: "5px",
      padding: "5px 16px",
      textAlign: "center",
      maxWidth: "85%",
      borderLeft: "3px solid #4488ff",
    },
    text: {
      fontFamily: '"Arial", sans-serif',
      fontSize: "21px",
      fontWeight: 700,
      color: "white",
      lineHeight: 1.3,
    },
  },

  // ── Youshaei: texto blanco limpio con sombra suave (minimalista viral) ──
  youshaei: {
    label: "Youshaei",
    preview: "Abc",
    wrapper: { textAlign: "center", maxWidth: "88%" },
    text: {
      fontFamily: '"Helvetica Neue", Arial, sans-serif',
      fontSize: "22px",
      fontWeight: 600,
      color: "white",
      lineHeight: 1.35,
      textShadow:
        "0 1px 0 #000, 0 -1px 0 #000, 1px 0 0 #000, -1px 0 0 #000, 0 3px 10px rgba(0,0,0,0.9)",
      letterSpacing: "0.2px",
    },
  },

  // ── Pod P: texto negro sobre fondo blanco ──
  pod_p: {
    label: "Pod P",
    preview: "Abc",
    wrapper: {
      background: "white",
      borderRadius: "5px",
      padding: "5px 14px",
      textAlign: "center",
      maxWidth: "85%",
    },
    text: {
      fontFamily: '"Arial Black", Arial, sans-serif',
      fontSize: "21px",
      fontWeight: 800,
      color: "#0a0a0a",
      lineHeight: 1.25,
    },
  },

  // ── Mozi: gradiente morado/rosa ──
  mozi: {
    label: "Mozi",
    preview: "Abc",
    wrapper: {
      background: "linear-gradient(135deg, #7c3aed, #db2777)",
      borderRadius: "8px",
      padding: "6px 16px",
      textAlign: "center",
      maxWidth: "85%",
      boxShadow: "0 4px 20px rgba(124,58,237,0.4)",
    },
    text: {
      fontFamily: '"Arial Black", Arial, sans-serif',
      fontSize: "22px",
      fontWeight: 900,
      color: "white",
      textTransform: "uppercase",
      letterSpacing: "0.5px",
      lineHeight: 1.2,
    },
  },

  // ── Popline: borde amarillo sobre negro (estilo clásico viral) ──
  popline: {
    label: "Popline",
    preview: "Abc",
    wrapper: {
      background: "black",
      border: "2.5px solid #FFE500",
      borderRadius: "5px",
      padding: "5px 14px",
      textAlign: "center",
      maxWidth: "85%",
    },
    text: {
      fontFamily: "Impact, 'Arial Black', sans-serif",
      fontSize: "23px",
      fontWeight: 900,
      color: "#FFE500",
      textTransform: "uppercase",
      letterSpacing: "1.5px",
      lineHeight: 1.15,
    },
  },

  // ── Typewriter: aparece letra a letra ──
  typewriter: {
    label: "Typewriter",
    preview: "Abc",
    wrapper: { textAlign: "center", maxWidth: "88%" },
    text: {
      fontFamily: '"Courier New", Courier, monospace',
      fontSize: "21px",
      fontWeight: 700,
      color: "white",
      textShadow: "0 2px 8px rgba(0,0,0,0.9)",
      lineHeight: 1.35,
      letterSpacing: "0.5px",
    },
  },
};

// ─── Componente principal ─────────────────────────────────────────────────────

export function SubtitleOverlay({
  parsedSRT,
  currentTime,
  style = "youshaei",
  fontSize,
  position = "bottom",
  bold,
}: SubtitleOverlayProps) {
  const [displayText, setDisplayText] = useState("");
  const [typewriterText, setTypewriterText] = useState("");
  const typewriterRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Encontrar segmento actual
  const currentSeg = parsedSRT.find(
    (seg) => currentTime >= seg.start && currentTime <= seg.end
  );

  // Para karaoke: encontrar palabra actual dentro del segmento
  const currentWord = currentSeg?.words?.find(
    (w) => currentTime >= w.start && currentTime <= w.end
  );

  useEffect(() => {
    if (!currentSeg) {
      setDisplayText("");
      setTypewriterText("");
      return;
    }

    if (style === "typewriter") {
      // Animación typewriter
      if (typewriterRef.current) clearTimeout(typewriterRef.current);
      let i = 0;
      const txt = currentSeg.text;
      setTypewriterText("");
      const tick = () => {
        i++;
        setTypewriterText(txt.slice(0, i));
        if (i < txt.length) {
          typewriterRef.current = setTimeout(tick, 40);
        }
      };
      tick();
    } else {
      setDisplayText(currentSeg.text);
    }

    return () => {
      if (typewriterRef.current) clearTimeout(typewriterRef.current);
    };
  }, [currentSeg?.text, style]);

  if (style === "none") return null;
  if (!currentSeg) {
    console.log('SubtitleOverlay: no currentSeg for time', currentTime, 'segments:', parsedSRT.length, parsedSRT.slice(0, 2))
    return null;
  }

  const cfg = STYLE_CONFIGS[style] || STYLE_CONFIGS.youshaei;

  const positionStyle: React.CSSProperties = {
    position: "absolute",
    left: 0,
    right: 0,
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    pointerEvents: "none",
    zIndex: 10,
    ...(position === "bottom" && { bottom: "8%" }),
    ...(position === "top" && { top: "8%" }),
    ...(position === "middle" && { top: "50%", transform: "translateY(-50%)" }),
  };

  const textStyle: React.CSSProperties = {
    ...cfg.text,
    ...(fontSize ? { fontSize: `${fontSize}px` } : {}),
    ...(bold !== undefined ? { fontWeight: bold ? 900 : 400 } : {}),
  };

  // ── Karaoke: resaltar palabra actual ──
  if (style === "karaoke" && currentWord) {
    const words = (currentSeg.text || "").split(" ");
    return (
      <div style={positionStyle}>
        <div style={cfg.wrapper}>
          <span style={textStyle}>
            {words.map((w, i) => {
              const isHighlighted =
                currentWord && w.trim() === currentWord.word.trim();
              return (
                <span
                  key={i}
                  style={isHighlighted ? { ...cfg.highlight } : {}}
                >
                  {w}
                  {i < words.length - 1 ? " " : ""}
                </span>
              );
            })}
          </span>
        </div>
      </div>
    );
  }

  // ── Typewriter ──
  if (style === "typewriter") {
    return (
      <div style={positionStyle}>
        <div style={cfg.wrapper}>
          <span style={textStyle}>{typewriterText}</span>
        </div>
      </div>
    );
  }

  // ── Resto de estilos ──
  console.log(`SubtitleOverlay: RENDERING style="${style}" text="${displayText.slice(0, 50)}" time=${currentTime}`)
  return (
    <div style={positionStyle}>
      <div style={cfg.wrapper}>
        <span style={textStyle}>{displayText}</span>
      </div>
    </div>
  );
}

// ─── Panel selector de estilos ────────────────────────────────────────────────

interface StyleSelectorProps {
  selected: SubtitleStyle;
  onChange: (style: SubtitleStyle) => void;
}

export function StyleSelector({ selected, onChange }: StyleSelectorProps) {
  const styles = Object.entries(STYLE_CONFIGS) as [
    SubtitleStyle,
    (typeof STYLE_CONFIGS)[SubtitleStyle]
  ][];

  return (
    <div className="grid grid-cols-2 gap-2 p-3">
      {styles.map(([key, cfg]) => {
        const isSelected = selected === key;
        return (
          <button
            key={key}
            onClick={() => onChange(key)}
            style={{
              position: "relative",
              borderRadius: "12px",
              border: isSelected ? "2px solid #c8ff00" : "2px solid #2a2a2a",
              background: "#111",
              height: "76px",
              cursor: "pointer",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: "4px",
              overflow: "hidden",
              transition: "all 0.15s",
              boxShadow: isSelected
                ? "0 0 12px rgba(200,255,0,0.25)"
                : "none",
            }}
          >
            {/* Preview */}
            {key === "none" ? (
              <span style={{ fontSize: "22px", color: "#555" }}>∅</span>
            ) : (
              <span
                style={{
                  ...cfg.text,
                  fontSize: "16px",
                  ...(cfg.wrapper.background
                    ? {
                        background: cfg.wrapper.background,
                        padding: "2px 8px",
                        borderRadius: "4px",
                      }
                    : {}),
                }}
              >
                {cfg.preview}
              </span>
            )}
            <span
              style={{
                fontSize: "10px",
                color: isSelected ? "#c8ff00" : "#666",
                fontWeight: 500,
              }}
            >
              {cfg.label}
            </span>
            {/* Check */}
            {isSelected && (
              <div
                style={{
                  position: "absolute",
                  top: "6px",
                  right: "6px",
                  width: "16px",
                  height: "16px",
                  borderRadius: "50%",
                  background: "#c8ff00",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "9px",
                  fontWeight: 900,
                  color: "black",
                }}
              >
                ✓
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ─── Panel editor de un segmento SRT ─────────────────────────────────────────

interface SubtitleEditorProps {
  segment: SRTSegment;
  index: number;
  onUpdate: (idx: number, updated: SRTSegment) => void;
  onDelete: (idx: number) => void;
  onClose: () => void;
}

export function SubtitleEditor({
  segment,
  index,
  onUpdate,
  onDelete,
  onClose,
}: SubtitleEditorProps) {
  const [text, setText] = useState(segment.text);
  const [start, setStart] = useState(segment.start.toFixed(2));
  const [end, setEnd] = useState(segment.end.toFixed(2));

  const handleSave = () => {
    onUpdate(index, {
      ...segment,
      text,
      start: parseFloat(start),
      end: parseFloat(end),
    });
    onClose();
  };

  return (
    <div
      style={{
        position: "fixed",
        bottom: "180px",
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 100,
        background: "white",
        border: "1px solid #e5e5e0",
        borderRadius: "16px",
        boxShadow: "0 8px 40px rgba(0,0,0,0.15)",
        padding: "16px",
        width: "360px",
        fontFamily: "sans-serif",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "12px",
        }}
      >
        <span style={{ fontWeight: 700, fontSize: "14px", color: "#0a0a0a" }}>
          Edit Subtitle #{index + 1}
        </span>
        <button
          onClick={onClose}
          style={{
            background: "none",
            border: "none",
            fontSize: "18px",
            cursor: "pointer",
            color: "#888",
            lineHeight: 1,
          }}
        >
          ×
        </button>
      </div>

      {/* Texto */}
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        style={{
          width: "100%",
          border: "1px solid #e5e5e0",
          borderRadius: "10px",
          padding: "10px",
          fontSize: "14px",
          color: "#0a0a0a",
          outline: "none",
          resize: "vertical",
          fontFamily: "inherit",
          boxSizing: "border-box",
          marginBottom: "10px",
        }}
      />

      {/* Timing */}
      <div style={{ display: "flex", gap: "8px", marginBottom: "12px" }}>
        <div style={{ flex: 1 }}>
          <label
            style={{
              fontSize: "10px",
              fontWeight: 700,
              color: "#888",
              display: "block",
              marginBottom: "4px",
              textTransform: "uppercase",
              letterSpacing: "0.5px",
            }}
          >
            Start (s)
          </label>
          <input
            type="number"
            step="0.1"
            min="0"
            value={start}
            onChange={(e) => setStart(e.target.value)}
            style={{
              width: "100%",
              border: "1px solid #e5e5e0",
              borderRadius: "8px",
              padding: "8px 10px",
              fontSize: "14px",
              outline: "none",
              boxSizing: "border-box",
            }}
          />
        </div>
        <div style={{ flex: 1 }}>
          <label
            style={{
              fontSize: "10px",
              fontWeight: 700,
              color: "#888",
              display: "block",
              marginBottom: "4px",
              textTransform: "uppercase",
              letterSpacing: "0.5px",
            }}
          >
            End (s)
          </label>
          <input
            type="number"
            step="0.1"
            min="0"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
            style={{
              width: "100%",
              border: "1px solid #e5e5e0",
              borderRadius: "8px",
              padding: "8px 10px",
              fontSize: "14px",
              outline: "none",
              boxSizing: "border-box",
            }}
          />
        </div>
      </div>

      {/* Acciones */}
      <div style={{ display: "flex", gap: "8px" }}>
        <button
          onClick={() => {
            onDelete(index);
            onClose();
          }}
          style={{
            flex: 1,
            padding: "10px",
            borderRadius: "10px",
            border: "1px solid #fca5a5",
            background: "#fff5f5",
            color: "#ef4444",
            fontSize: "13px",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Delete
        </button>
        <button
          onClick={handleSave}
          style={{
            flex: 2,
            padding: "10px",
            borderRadius: "10px",
            border: "none",
            background: "#0a0a0a",
            color: "white",
            fontSize: "13px",
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          Save changes
        </button>
      </div>
    </div>
  );
}

// ─── Export de utilidades ─────────────────────────────────────────────────────

export { STYLE_CONFIGS };
export type { SRTSegment, Word };
