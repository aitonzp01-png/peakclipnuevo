'use client'

export function groupWordsIntoPhrases(words) {
  const active = words.filter(w => !w.deleted).sort((a, b) => a.startTime - b.startTime)
  const phrases = []
  let current = []
  for (const w of active) {
    if (current.length === 0) {
      current.push(w)
    } else {
      const last = current[current.length - 1]
      const gap = w.startTime - last.endTime
      const currentDuration = last.endTime - current[0].startTime
      if (gap < 1.2 && currentDuration < 8 && current.length < 8) {
        current.push(w)
      } else {
        phrases.push(current)
        current = [w]
      }
    }
  }
  if (current.length > 0) phrases.push(current)
  return phrases
}

function buildStroke(width, color) {
  if (!width || width === 0 || !color) return 'none'
  const c = color
  const w = Math.max(1, Math.round(width))
  return [
    `${c} -${w}px -${w}px 0`,
    `${c} 0 -${w}px 0`,
    `${c} ${w}px -${w}px 0`,
    `${c} -${w}px 0 0`,
    `${c} ${w}px 0 0`,
    `${c} -${w}px ${w}px 0`,
    `${c} 0 ${w}px 0`,
    `${c} ${w}px ${w}px 0`,
  ].join(', ')
}

export default function WordByWordOverlay({ words, currentTime, subtitleStyle, presetId }) {
  if (!words || words.length === 0 || presetId === 'none') return null

  const phrases = groupWordsIntoPhrases(words)
  const activePhraseIdx = phrases.findIndex(p => p.some(w => !w.deleted && currentTime >= w.startTime && currentTime <= w.endTime))
  if (activePhraseIdx === -1) return null

  const activePhrase = phrases[activePhraseIdx]
  const wordsToDraw = activePhrase.filter(w => !w.deleted && w.startTime <= currentTime + 1.0)
  if (!wordsToDraw.length) return null

  const {
    fontFamily = 'Arial Black',
    fontSize = 32,
    fontWeight = '900',
    color = '#ffffff',
    highlightColor = '#ff1f1f',
    stroke = true,
    strokeColor = '#000000',
    strokeWidth = 4,
    positionY = 85,
    fontStyle = 'normal',
    textTransform = 'none',
    maxWidth = 88,
    shadow = false,
    shadowColor = '#000000',
    shadowBlur = 0,
    frameBorder = false,
    frameBorderColor = '#ffffff',
    frameBorderWidth = 2,
    letterSpacing = 0,
    karaokeHighlight = false,
    backgroundOpacity = 0,
    backgroundColor = 'transparent',
    backgroundBorderRadius = 6,
    wordPopEnabled = true,
  } = subtitleStyle || {}

  let activeColor = karaokeHighlight ? highlightColor : color
  let pastColor = color
  let futureColor = color
  let useStrokeColor = strokeColor || '#000000'
  let useStrokeWidth = Math.max(1, strokeWidth || 0)
  let useStroke = stroke !== false

  // Background plate
  let bgStyle = {}
  if (backgroundColor && backgroundColor !== 'transparent' && backgroundOpacity > 0) {
    const a = Math.min(1, Math.max(0, backgroundOpacity / 100))
    const hex = backgroundColor.replace('#', '')
    const r = parseInt(hex.substring(0, 2), 16)
    const g = parseInt(hex.substring(2, 4), 16)
    const b = parseInt(hex.substring(4, 6), 16)
    if (!isNaN(r)) {
      bgStyle = {
        background: `rgba(${r},${g},${b},${a})`,
        borderRadius: `${backgroundBorderRadius || 6}px`,
        padding: '6px 14px',
      }
    }
  }

  // Frame border
  if (frameBorder && backgroundColor && backgroundColor !== 'transparent') {
    bgStyle = {
      ...bgStyle,
      border: `${frameBorderWidth}px solid ${frameBorderColor}`,
    }
  }

  // Build word entries with text transforms
  const containerMaxWidth = (maxWidth / 100) * 700
  const charWidth = fontSize * 0.6

  const wordEntries = wordsToDraw.map(w => {
    let text = w.word
    if (textTransform === 'uppercase') text = text.toUpperCase()
    if (textTransform === 'lowercase') text = text.toLowerCase()
    return { word: w, text, pixelWidth: text.length * charWidth + charWidth * 0.5 }
  })

  // Pack into lines: max 3 words per line (CapCut style), fallback to width
  const maxWordsPerLine = 3
  let lines = []
  let cur = []
  let curW = 0
  for (const e of wordEntries) {
    if ((cur.length >= maxWordsPerLine || curW + e.pixelWidth > containerMaxWidth) && cur.length > 0) {
      lines.push(cur)
      cur = [e]
      curW = e.pixelWidth
    } else {
      cur.push(e)
      curW += e.pixelWidth
    }
  }
  if (cur.length > 0) lines.push(cur)

  const lineHeight = fontSize * 1.35
  const textShadowVal = buildStroke(useStrokeWidth, useStrokeColor)

  // Glow
  let extraGlow = ''
  if (shadow && shadowBlur > 0 && shadowColor) {
    extraGlow = `0 0 ${shadowBlur}px ${shadowColor}`
  }

  const containerStyle = {
    position: 'absolute',
    left: '50%',
    bottom: `${100 - positionY}%`,
    transform: 'translateX(-50%)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    pointerEvents: 'none',
    zIndex: 10,
    width: `${maxWidth}%`,
    maxWidth: '700px',
    overflow: 'visible',
    wordBreak: 'normal',
    overflowWrap: 'normal',
    WebkitHyphens: 'none',
    hyphens: 'none',
  }

  const wordStyle = {
    display: 'inline-block',
    fontFamily,
    fontSize: `${fontSize}px`,
    fontWeight,
    fontStyle,
    lineHeight: `${lineHeight}px`,
    textShadow: extraGlow ? `${extraGlow}, ${textShadowVal}` : textShadowVal,
    transition: 'color 0.05s ease, opacity 0.05s ease',
    whiteSpace: 'pre-wrap',
    letterSpacing: letterSpacing ? `${letterSpacing}px` : 'normal',
    wordBreak: 'keep-all',
    overflowWrap: 'normal',
    willChange: 'transform',
  }

  return (
    <div style={containerStyle}>
      {lines.map((lineWords, li) => (
        <div key={li} style={{ textAlign: 'center', ...bgStyle }}>
          {lineWords.map((lw, wi) => {
            const isPast = currentTime > lw.word.endTime
            const isActive = currentTime >= lw.word.startTime && currentTime <= lw.word.endTime
            const isFuture = currentTime < lw.word.startTime
            let opacity = 0.25
            if (isPast) opacity = 0.7
            if (isActive) opacity = 1
            if (isFuture) opacity = 0.25

            const wordColor = isActive ? activeColor : (isPast ? pastColor : futureColor)

            const popAnim = wordPopEnabled && isActive
              ? 'wordPop 0.15s cubic-bezier(0.34, 1.56, 0.64, 1) forwards'
              : 'none'

            return (
              <span
                key={`${wi}-${isActive ? 'act' : 'pas'}`}
                style={{
                  ...wordStyle,
                  color: wordColor,
                  opacity,
                  animation: popAnim,
                }}
              >
                {lw.text}{' '}
              </span>
            )
          })}
        </div>
      ))}
      <style>{`@keyframes wordPop { 0% { transform: scale(0.9); } 60% { transform: scale(1.05); } 100% { transform: scale(1); } }`}</style>
    </div>
  )
}
