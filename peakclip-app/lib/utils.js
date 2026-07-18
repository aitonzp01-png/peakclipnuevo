export function formatTime(seconds) {
  if (!seconds || isNaN(seconds)) return '0:00.00'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  const cs = Math.floor((seconds % 1) * 100)
  return `${m}:${s.toString().padStart(2, '0')}.${cs.toString().padStart(2, '0')}`
}

export function clipUrl(url) {
  if (!url) return null
  if (url.startsWith('http')) return url
  return `https://${url}`
}

export function generateId() {
  return Math.random().toString(36).substring(2, 9)
}

export function lerp(a, b, t) {
  return a + (b - a) * t
}

export function hexToRgba(hex, opacity) {
  let h = hex.replace('#', '')
  if (h.length === 3) h = h.split('').map(c => c + c).join('')
  const r = parseInt(h.substring(0, 2), 16)
  const g = parseInt(h.substring(2, 4), 16)
  const b = parseInt(h.substring(4, 6), 16)
  return `rgba(${r},${g},${b},${opacity})`
}

export function groupWordsIntoLines(words, maxWidth, canvasWidth) {
  if (!words.length) return []
  const lines = []
  let current = []
  let currentWidth = 0
  const charWidth = 10
  words.forEach(w => {
    const wordWidth = w.word.length * charWidth
    if (currentWidth + wordWidth > maxWidth * canvasWidth / 100 && current.length > 0) {
      lines.push(current)
      current = [w]
      currentWidth = wordWidth
    } else {
      current.push(w)
      currentWidth += wordWidth + charWidth
    }
  })
  if (current.length) lines.push(current)
  return lines
}

export const subtitlePresets = [
  { id: 'none', label: 'Sin subtítulos' },
  { id: 'word-by-word', label: 'Word by Word', fontFamily: 'Arial Black', fontSize: 34, fontWeight: '900', color: '#ffffff', highlightColor: '#FF3040', stroke: true, strokeColor: '#000000', strokeWidth: 4, karaokeHighlight: true, backgroundColor: '#000000', backgroundOpacity: 30, backgroundBorderRadius: 8, textAlign: 'center', textTransform: 'uppercase', wordPopEnabled: true },
  { id: 'karaoke', label: 'Karaoke', fontFamily: 'Inter', fontSize: 36, fontWeight: '800', color: '#ffffff', backgroundColor: 'transparent', backgroundOpacity: 0, textAlign: 'center', karaokeHighlight: true, highlightColor: '#c4ff3d' },
  { id: 'beasty', label: 'Beasty', fontFamily: 'Inter', fontSize: 38, fontWeight: '900', color: '#000000', backgroundColor: '#ffffff', backgroundOpacity: 100, textAlign: 'center' },
  { id: 'deep-diver', label: 'Deep Diver', fontFamily: 'Inter', fontSize: 32, fontWeight: '700', color: '#ffffff', backgroundColor: '#000000', backgroundOpacity: 60, textAlign: 'center', positionY: 80 },
  { id: 'youshaei', label: 'Youshaei', fontFamily: 'Inter', fontSize: 40, fontWeight: '800', fontStyle: 'italic', color: '#f97316', textAlign: 'center' },
  { id: 'pod-p', label: 'Pod P', fontFamily: 'Inter', fontSize: 28, fontWeight: '600', color: '#f5f5f0', textAlign: 'center', lineHeight: 1.5 },
  { id: 'mozi', label: 'Mozi', fontFamily: 'Inter', fontSize: 34, fontWeight: '900', color: '#c4ff3d', stroke: true, strokeColor: '#000000', strokeWidth: 3, textAlign: 'center' },
  { id: 'popline', label: 'Popline', fontFamily: 'Inter', fontSize: 30, fontWeight: '800', color: '#0f0f0f', backgroundColor: '#c4ff3d', backgroundOpacity: 100, textAlign: 'center' },
  { id: 'impact', label: 'Impact / Meme', fontFamily: 'Impact', fontSize: 36, fontWeight: '900', color: '#ffffff', stroke: true, strokeColor: '#000000', strokeWidth: 5, karaokeHighlight: false, backgroundColor: '#000000', backgroundOpacity: 25, backgroundBorderRadius: 8, textAlign: 'center', textTransform: 'uppercase', wordPopEnabled: false, wordSizeVariance: 0.15, wordRotationVariance: 5, paintOrder: 'stroke-fill' },
]

export const defaultSubtitleStyle = {
  fontFamily: 'Arial Black',
  fontSize: 34,
  fontWeight: '900',
  color: '#ffffff',
  backgroundColor: '#000000',
  backgroundOpacity: 30,
  textAlign: 'center',
  textTransform: 'uppercase',
  letterSpacing: 0,
  lineHeight: 1.2,
  positionY: 78,
  maxWidth: 88,
  stroke: true,
  strokeColor: '#000000',
  strokeWidth: 4,
  karaokeHighlight: true,
  highlightColor: '#FF3040',
  fontStyle: 'normal',
  shadow: false,
  shadowColor: '#000000',
  shadowOffsetX: 1,
  shadowOffsetY: 1,
  shadowBlur: 2,
  backgroundBorderRadius: 8,
  wordPopEnabled: true,
}

export const fontOptions = [
  'Inter', 'Montserrat', 'Oswald', 'Bebas Neue', 'Anton',
  'Roboto Condensed', 'Poppins', 'Arial Black', 'Impact', 'Playfair Display',
]

export const musicTracks = [
  { id: 'none', label: 'Sin m\u00fasica' },
  { id: 'epic', label: 'Epic Cinematic' },
  { id: 'hype', label: 'Hype Beat' },
  { id: 'chill', label: 'Chill Lofi' },
  { id: 'gaming', label: 'Gaming Energy' },
  { id: 'viral', label: 'Viral Pop' },
]

export const filters = [
  { id: 'none', label: 'Original', style: {} },
  { id: 'vivid', label: 'Vivid', style: { filter: 'saturate(1.5) contrast(1.1) brightness(1.05)' } },
  { id: 'cinema', label: 'Cinema', style: { filter: 'contrast(1.2) brightness(0.9) sepia(0.2)' } },
  { id: 'bw', label: 'B&W', style: { filter: 'grayscale(1) contrast(1.1)' } },
  { id: 'warm', label: 'Warm', style: { filter: 'sepia(0.4) saturate(1.3) hue-rotate(-10deg)' } },
  { id: 'cool', label: 'Cool', style: { filter: 'hue-rotate(30deg) saturate(0.9) brightness(1.1)' } },
]

export const transitionOptions = [
  { id: 'none', label: 'Sin transici\u00f3n' },
  { id: 'fade', label: 'Fade' },
  { id: 'slide-left', label: 'Slide izquierda' },
  { id: 'slide-right', label: 'Slide derecha' },
  { id: 'zoom-in', label: 'Zoom in' },
  { id: 'zoom-out', label: 'Zoom out' },
  { id: 'wipe', label: 'Wipe' },
]

export const aspectRatios = [
  { id: '9:16', label: '9:16', icon: 'mobile', desc: 'TikTok / Reels / Shorts' },
  { id: '16:9', label: '16:9', icon: 'monitor', desc: 'YouTube / Desktop' },
  { id: '1:1', label: '1:1', icon: 'camera', desc: 'Instagram Square' },
  { id: '4:5', label: '4:5', icon: 'camera', desc: 'IG Feed Portrait' },
]

export const resolutions = [
  { id: '720p', label: '720p', res: '1280x720' },
  { id: '1080p', label: '1080p', res: '1920x1080' },
  { id: '4k', label: '4K', res: '3840x2160' },
]
