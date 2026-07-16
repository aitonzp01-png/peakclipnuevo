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
    fontSize = 26,
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
  } = subtitleStyle || {}

  // Determine colors per preset (YouTube Shorts style: past words dim white, active word highlighted)
  let activeColor = color
  let pastColor = color
  let futureColor = color
  let useStroke = stroke
  let useStrokeColor = strokeColor
  let useStrokeWidth = strokeWidth
  let bgStyle = {}
  let wordSpacing = ' '

  switch (presetId) {
    case 'karaoke':
      activeColor = highlightColor
      pastColor = color
      futureColor = '#ffffff'
      useStroke = true
      useStrokeColor = '#000000'
      useStrokeWidth = 4
      bgStyle = { background: 'rgba(0,0,0,0.4)', borderRadius: '8px', padding: '8px 16px' }
      break
    case 'beasty':
      activeColor = '#000000'
      pastColor = '#ffffff'
      futureColor = '#ffffff'
      bgStyle = { background: 'rgba(0,0,0,0.3)', borderRadius: '6px', padding: '6px 14px' }
      break
    case 'youshaei':
      activeColor = highlightColor
      pastColor = color
      futureColor = color
      useStroke = true
      useStrokeColor = '#000000'
      useStrokeWidth = 3
      break
    case 'popline':
      activeColor = '#000000'
      pastColor = '#ffffff'
      futureColor = '#ffffff'
      useStroke = true
      useStrokeColor = '#000000'
      useStrokeWidth = 3
      bgStyle = { background: 'rgba(0,0,0,0.5)', borderRadius: '4px', padding: '6px 14px' }
      break
    case 'mozi':
      activeColor = '#ffffff'
      pastColor = 'rgba(255,255,255,0.7)'
      futureColor = 'rgba(255,255,255,0.3)'
      useStroke = true
      useStrokeColor = '#000000'
      useStrokeWidth = 4
      bgStyle = { background: 'linear-gradient(135deg, rgba(124,58,237,0.7), rgba(219,39,119,0.7))', borderRadius: '8px', padding: '6px 16px' }
      break
    case 'deepdiver':
    case 'deep_diver':
      activeColor = '#4488ff'
      pastColor = color
      futureColor = color
      useStroke = true
      useStrokeColor = 'rgba(0,0,0,0.6)'
      useStrokeWidth = 3
      bgStyle = { background: 'rgba(10,20,80,0.6)', borderRadius: '6px', padding: '6px 16px', borderLeft: '3px solid #4488ff' }
      break
    case 'podp':
    case 'pod_p':
      activeColor = '#ff1f1f'
      pastColor = '#ffffff'
      futureColor = '#ffffff'
      useStroke = false
      bgStyle = { background: 'rgba(0,0,0,0.6)', borderRadius: '6px', padding: '6px 14px' }
      break
    default:
      // YouTube Shorts default: clean white with red highlight, black outline
      activeColor = highlightColor
      pastColor = 'rgba(255,255,255,0.8)'
      futureColor = 'rgba(255,255,255,0.3)'
      useStroke = true
      useStrokeColor = '#000000'
      useStrokeWidth = 4
      bgStyle = { background: 'rgba(0,0,0,0.35)', borderRadius: '8px', padding: '8px 16px' }
      break
  }

  // Build display lines using canvas measurement for accuracy
  let lines = []
  let currentLine = []
  let currentLineWidth = 0

  // Use a pixel-based max width (approximate)
  const containerMaxWidth = (maxWidth / 100) * 700

  for (const w of wordsToDraw) {
    let wordText = w.word
    if (textTransform === 'uppercase') wordText = wordText.toUpperCase()
    if (textTransform === 'lowercase') wordText = wordText.toLowerCase()
    // Rough char-width based on fontSize (for Arial Black, ~0.65 * fontSize per char)
    const charWidth = fontSize * 0.6
    const wordPixelWidth = wordText.length * charWidth + charWidth * 0.5

    if (currentLineWidth + wordPixelWidth > containerMaxWidth && currentLine.length > 0) {
      lines.push(currentLine)
      currentLine = [{ word: w, text: wordText, pixelWidth: wordPixelWidth }]
      currentLineWidth = wordPixelWidth
    } else {
      currentLine.push({ word: w, text: wordText, pixelWidth: wordPixelWidth })
      currentLineWidth += wordPixelWidth
    }
  }
  if (currentLine.length > 0) lines.push(currentLine)

  const lineHeight = fontSize * 1.35
  const textShadowVal = buildStroke(useStrokeWidth, useStrokeColor)

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
  }

  const wordStyle = {
    display: 'inline',
    fontFamily,
    fontSize: `${fontSize}px`,
    fontWeight,
    fontStyle,
    lineHeight: `${lineHeight}px`,
    textShadow: textShadowVal,
    transition: 'color 0.1s ease, opacity 0.1s ease',
    whiteSpace: 'pre-wrap',
  }

  return (
    <div style={containerStyle}>
      {lines.map((lineWords, li) => (
        <div key={li} style={{ textAlign: 'center', ...bgStyle }}>
          {lineWords.map((lw, wi) => {
            const isPast = currentTime > lw.word.endTime
            const isActive = currentTime >= lw.word.startTime && currentTime <= lw.word.endTime
            const isFuture = currentTime < lw.word.startTime
            let wordColor = futureColor
            let opacity = 0.25
            if (isPast) {
              wordColor = pastColor
              opacity = 0.75
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
                {lw.text}{wordSpacing}
              </span>
            )
          })}
        </div>
      ))}
    </div>
  )
}
