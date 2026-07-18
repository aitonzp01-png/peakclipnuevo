'use client'

import { motion, AnimatePresence } from 'framer-motion'

function seededRandom(seed) {
  const x = Math.sin(seed * 9301 + 49297) * 49297
  return x - Math.floor(x)
}

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
    fontSize = 34,
    fontWeight = '900',
    color = '#ffffff',
    highlightColor = '#FF3040',
    stroke = true,
    strokeColor = '#000000',
    strokeWidth = 4,
    positionY = 78,
    fontStyle = 'normal',
    textTransform = 'uppercase',
    maxWidth = 88,
    shadow = false,
    shadowColor = '#000000',
    shadowBlur = 0,
    frameBorder = false,
    frameBorderColor = '#ffffff',
    frameBorderWidth = 2,
    letterSpacing = 0,
    karaokeHighlight = true,
    backgroundOpacity = 30,
    backgroundColor = '#000000',
    backgroundBorderRadius = 8,
    wordPopEnabled = true,
    wordSizeVariance = 0,
    wordRotationVariance = 0,
    linePopEnabled = false,
    paintOrder = 'normal',
  } = subtitleStyle || {}

  const isImpactVariant = wordSizeVariance > 0 || wordRotationVariance > 0
  let activeColor = karaokeHighlight ? highlightColor : color
  let pastColor = color
  let futureColor = color
  let useStroke = stroke !== false
  let useStrokeColor = strokeColor || '#000000'
  let useStrokeWidth = Math.max(1, strokeWidth || 0)

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
        borderRadius: `${backgroundBorderRadius || 8}px`,
        padding: '8px 16px',
      }
    }
  }

  if (frameBorder && backgroundColor && backgroundColor !== 'transparent') {
    bgStyle = {
      ...bgStyle,
      border: `${frameBorderWidth}px solid ${frameBorderColor}`,
    }
  }

  // Build word entries
  const containerMaxWidth = (maxWidth / 100) * 700
  const charWidth = fontSize * 0.6

  const wordEntries = wordsToDraw.map(w => {
    let text = w.word
    if (textTransform === 'uppercase') text = text.toUpperCase()
    if (textTransform === 'lowercase') text = text.toLowerCase()
    return { word: w, text, pixelWidth: text.length * charWidth + charWidth * 0.5 }
  })

  // Pack into lines: max 3 words per line, fallback to width
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

  // Text shadow: depth shadow for word mode only, glow for both
  const depthShadow = !isImpactVariant && useStroke ? `0 2px 4px rgba(0,0,0,0.35)` : ''
  const glowShadow = (shadow && shadowBlur > 0 && shadowColor)
    ? `0 0 ${shadowBlur}px ${shadowColor}`
    : ''
  const textShadowVal = [glowShadow, depthShadow].filter(Boolean).join(', ') || 'none'

  const wordBaseStyle = {
    display: 'inline-block',
    fontFamily,
    fontSize: `${fontSize}px`,
    fontWeight,
    fontStyle,
    lineHeight: `${lineHeight}px`,
    WebkitTextStroke: useStroke ? `${useStrokeWidth}px ${useStrokeColor}` : 'none',
    paintOrder: paintOrder === 'stroke-fill' ? 'stroke fill' : 'normal',
    textShadow: textShadowVal,
    whiteSpace: 'pre-wrap',
    letterSpacing: letterSpacing ? `${letterSpacing}px` : 'normal',
    wordBreak: 'keep-all',
    overflowWrap: 'normal',
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

  const popTransition = {
    type: 'spring',
    stiffness: 500,
    damping: 18,
    mass: 1,
  }

  // Build subtitle lines content (shared between modes)
  const lineContent = lines.map((lineWords, li) => (
    <div key={li} style={{ textAlign: 'center', ...bgStyle }}>
      {lineWords.map((lw, wi) => {
        // Seeded deterministic variation for impact mode
        const wordSeed = activePhraseIdx * 1000 + li * 100 + wi * 7
        const sizeScale = 1 + (seededRandom(wordSeed) - 0.5) * wordSizeVariance * 2
        const rotation = (seededRandom(wordSeed + 1) - 0.5) * wordRotationVariance * 2
        const wordTransform = isImpactVariant ? `scale(${sizeScale}) rotate(${rotation}deg)` : undefined

        const isPast = currentTime > lw.word.endTime
        const isActive = currentTime >= lw.word.startTime && currentTime <= lw.word.endTime

        let opacity
        if (isImpactVariant) {
          opacity = 1
        } else {
          const isFuture = currentTime < lw.word.startTime
          opacity = isPast ? 0.7 : isActive ? 1 : 0.25
        }

        const wordColor = isImpactVariant
          ? color
          : isActive ? activeColor : (isPast ? pastColor : color)

        if (isImpactVariant) {
          return (
            <span
              key={wi}
              style={{
                ...wordBaseStyle,
                WebkitTextFillColor: wordColor,
                color: wordColor,
                opacity,
                transform: wordTransform,
              }}
            >
              {lw.text}{' '}
            </span>
          )
        }

        return (
          <motion.span
            key={`${wi}-${isActive ? 'act' : 'pas'}`}
            initial={isActive && wordPopEnabled ? { scale: 0.9 } : false}
            animate={isActive && wordPopEnabled ? { scale: 1 } : {}}
            transition={isActive && wordPopEnabled ? popTransition : {}}
            style={{
              ...wordBaseStyle,
              WebkitTextFillColor: wordColor,
              color: wordColor,
              opacity,
            }}
          >
            {lw.text}{' '}
          </motion.span>
        )
      })}
    </div>
  ))

  // Impact variant with line-level entry animation
  if (isImpactVariant && linePopEnabled) {
    return (
      <AnimatePresence mode="wait">
        <motion.div
          key={activePhraseIdx}
          style={containerStyle}
          initial={{ scale: 0.7, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.08 } }}
          transition={{ type: 'spring', stiffness: 400, damping: 14 }}
        >
          {lineContent}
        </motion.div>
      </AnimatePresence>
    )
  }

  return <div style={containerStyle}>{lineContent}</div>
}
