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

export default function WordByWordOverlay({ words, currentTime, subtitleStyle, presetId }) {
  if (!words || words.length === 0 || presetId === 'none') return null

  const phrases = groupWordsIntoPhrases(words)
  const activePhraseIdx = phrases.findIndex(p => p.some(w => !w.deleted && currentTime >= w.startTime && currentTime <= w.endTime))
  if (activePhraseIdx === -1) return null

  const activePhrase = phrases[activePhraseIdx]
  // Show words progressively: only words that have started + 1 upcoming
  const wordsToDraw = activePhrase.filter(w => !w.deleted && w.startTime <= currentTime + 1.0)
  if (!wordsToDraw.length) return null

  const {
    fontFamily = 'Montserrat',
    fontSize = 30,
    fontWeight = '700',
    color = '#ffffff',
    highlightColor = '#ff1f1f',
    stroke = false,
    strokeColor = '#000000',
    strokeWidth = 3,
    positionY = 78,
    fontStyle = 'normal',
    textTransform = 'none',
    maxWidth = 85,
  } = subtitleStyle || {}

  // Preset overrides
  let activeColor = color
  let pastColor = color
  let futureColor = color
  let activeHighlight = highlightColor
  let useStroke = stroke
  let useStrokeColor = strokeColor
  let useStrokeWidth = strokeWidth

  switch (presetId) {
    case 'karaoke':
      activeColor = highlightColor
      pastColor = color
      futureColor = color
      useStroke = true
      useStrokeColor = '#000000'
      useStrokeWidth = 3
      break
    case 'beasty':
      activeColor = '#000000'
      pastColor = '#ffffff'
      futureColor = '#ffffff'
      break
    case 'youshaei':
      activeColor = highlightColor
      pastColor = color
      futureColor = color
      break
    case 'popline':
      activeColor = '#000000'
      pastColor = '#ffffff'
      futureColor = '#ffffff'
      useStroke = true
      useStrokeColor = '#000000'
      useStrokeWidth = 2
      break
    case 'mozi':
      activeColor = color
      pastColor = color
      futureColor = color
      useStroke = true
      useStrokeColor = '#000000'
      useStrokeWidth = 4
      break
    case 'deepdiver':
    case 'deep_diver':
      activeColor = '#ffffff'
      pastColor = '#ffffff'
      futureColor = '#ffffff'
      useStroke = true
      useStrokeColor = 'rgba(0,0,0,0.5)'
      useStrokeWidth = 2
      break
    default:
      break
  }

  // Build display lines
  const lines = []
  let line = []
  let lineWidth = 0
  const maxLineChars = Math.floor((maxWidth / 100) * 30) // rough char estimate

  for (const w of wordsToDraw) {
    let wordText = w.word
    if (textTransform === 'uppercase') wordText = wordText.toUpperCase()
    if (textTransform === 'lowercase') wordText = wordText.toLowerCase()
    const ww = wordText.length + 1
    if (lineWidth + ww > maxLineChars && line.length > 0) {
      lines.push(line)
      line = [{ word: w, text: wordText }]
      lineWidth = ww
    } else {
      line.push({ word: w, text: wordText })
      lineWidth += ww
    }
  }
  if (line.length > 0) lines.push(line)

  const lineHeight = fontSize * 1.3
  const totalHeight = lines.length * lineHeight
  const basePosition = positionY // 0-100
  const topOffset = `${basePosition}%`

  const textShadow = useStroke
    ? `${useStrokeColor} 0px 0px ${useStrokeWidth}px, ${useStrokeColor} 0px 0px ${useStrokeWidth}px, ${useStrokeColor} 0px 0px ${useStrokeWidth}px`
    : 'none'

  const containerStyle = {
    position: 'absolute',
    left: 0,
    right: 0,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    pointerEvents: 'none',
    zIndex: 10,
    top: topOffset,
    transform: 'translateY(-50%)',
    padding: '0 8%',
  }

  const wordStyle = {
    display: 'inline',
    fontFamily,
    fontSize: `${fontSize}px`,
    fontWeight,
    fontStyle,
    lineHeight: `${lineHeight}px`,
    textShadow,
    transition: 'color 0.15s ease',
    whiteSpace: 'pre-wrap',
  }

  return (
    <div style={containerStyle}>
      {lines.map((lineWords, li) => (
        <div key={li} style={{ textAlign: 'center', maxWidth: `${maxWidth}%` }}>
          {lineWords.map((lw, wi) => {
            const isPast = currentTime > lw.word.endTime
            const isActive = currentTime >= lw.word.startTime && currentTime <= lw.word.endTime
            const isFuture = currentTime < lw.word.startTime
            let wordColor = futureColor
            let opacity = 0.2
            if (isPast) {
              wordColor = pastColor
              opacity = 0.6
            }
            if (isActive) {
              wordColor = activeColor
              opacity = 1
            }
            return (
              <span
                key={wi}
                style={{
                  ...wordStyle,
                  color: wordColor,
                  opacity,
                }}
              >
                {lw.text}{' '}
              </span>
            )
          })}
        </div>
      ))}
    </div>
  )
}
