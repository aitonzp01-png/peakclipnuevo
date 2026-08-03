'use client'

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { getSupabaseClient } from '../../lib/supabase'
import { exportClip } from '../../lib/api'
import ExportModal from './components/ExportModal'
import ErrorBoundary from '../../lib/error-boundary'
import './editor.css'

let faceapiPromise = null
const getFaceapi = () => {
  if (!faceapiPromise) {
    faceapiPromise = import('face-api.js').then(m => m.default || m).catch(() => null)
  }
  return faceapiPromise
}
import {
  ArrowLeft, Save, Download, Play, Pause, SkipBack, SkipForward,
  Scissors, Trash2, ZoomIn, Type, Music, Film, Wand2,
  Layers, Tag, Shuffle, AlignLeft, Anchor, Palette,
  Sparkles, Smartphone, Eye, EyeOff, Captions,
  Search, Star, Upload, RotateCcw, RotateCw, Zap,
  Home, Plus
} from 'lucide-react'

// --- CONSTANTS ---
const RANK_CLIP_COLORS = ['#FFD700', '#C0C0C0', '#CD7F32', '#c4ff3d', '#60A5FA', '#F59E0B', '#EC4899', '#8B5CF6', '#10B981', '#EF4444']

const FONTS = [
  'Inter', 'Montserrat', 'Oswald', 'Bebas Neue', 'Anton',
  'Roboto Condensed', 'Poppins', 'Arial Black', 'Impact', 'Playfair Display'
]

const PRESET_CATEGORIES = [
  { id: 'sync', name: 'Word by Word' },
  { id: 'boxed', name: 'Background' },
  { id: 'classic', name: 'Classic & Clean' },
  { id: 'bold', name: 'Bold & Impact' },
]

const SUBTITLE_PRESETS = [
  { id: 'none', name: 'No captions', cat: '', isNone: true },
  { id: 'focus', name: 'Focus', cat: 'sync', color: '#ffffff', highlightColor: '#ff1f1f', fontWeight: '900', fontSize: 38, karaokeHighlight: true, stroke: true, strokeColor: '#000000', strokeWidth: 4, fontFamily: 'Montserrat', backgroundColor: '#ff1f1f', backgroundOpacity: 30, backgroundBorderRadius: 18, backgroundPadding: 16 },
  { id: 'viral', name: 'Viral Shorts', cat: 'sync', color: '#ffffff', highlightColor: '#FFD700', fontWeight: '900', fontSize: 38, karaokeHighlight: true, stroke: true, strokeColor: '#000000', strokeWidth: 4, fontFamily: 'Montserrat' },
  { id: 'karaoke', name: 'Karaoke', cat: 'sync', color: '#ffffff', highlightColor: '#ff1f1f', fontWeight: '800', fontSize: 34, karaokeHighlight: true, stroke: true, strokeColor: '#000000', strokeWidth: 4, fontFamily: 'Montserrat' },
  { id: 'typewriter', name: 'Typewriter', cat: 'sync', color: '#ff1f1f', highlightColor: '#ff1f1f', fontWeight: '900', fontSize: 34, fontFamily: 'Courier New', textTransform: 'uppercase', stroke: true, strokeColor: '#000000', strokeWidth: 4, karaokeHighlight: true },
  { id: 'bounce', name: 'Bounce', cat: 'sync', color: '#ffffff', fontWeight: '900', fontSize: 36, fontFamily: 'Montserrat', stroke: true, strokeColor: '#000000', strokeWidth: 4, shadow: true, shadowColor: '#ff1f1f', shadowBlur: 12, shadowOffsetX: 0, shadowOffsetY: 0 },
  { id: 'neon', name: 'Neon Glow', cat: 'sync', color: '#ff1f1f', fontWeight: '900', fontSize: 34, fontFamily: 'Bebas Neue', shadow: true, shadowColor: '#ff1f1f', shadowBlur: 20, shadowOffsetX: 0, shadowOffsetY: 0, stroke: true, strokeColor: '#330000', strokeWidth: 2 },
  { id: 'vhs', name: 'VHS', cat: 'sync', color: '#ffffff', fontWeight: '700', fontSize: 30, fontFamily: 'Courier New', textTransform: 'uppercase', letterSpacing: 2, stroke: true, strokeColor: '#000000', strokeWidth: 3 },
  { id: 'bold_block', name: 'Bold Block', cat: 'boxed', color: '#ffffff', fontWeight: '900', fontSize: 36, backgroundColor: '#000000', backgroundOpacity: 80, backgroundBorderRadius: 12, backgroundPadding: 16 },
  { id: 'bubble', name: 'Bubble Chat', cat: 'boxed', color: '#000000', fontWeight: '700', fontSize: 30, backgroundColor: '#ffffff', backgroundOpacity: 95, backgroundBorderRadius: 24, backgroundPadding: 18, fontFamily: 'Poppins' },
  { id: 'bottom_bar', name: 'Bottom Bar', cat: 'boxed', color: '#ffffff', fontWeight: '800', fontSize: 34, backgroundColor: '#000000', backgroundOpacity: 70, backgroundBorderRadius: 0, backgroundPadding: 20, textTransform: 'uppercase' },
  { id: 'boldpod', name: 'Bold Pod', cat: 'boxed', color: '#ffffff', fontWeight: '900', fontSize: 36, backgroundColor: '#000000', backgroundOpacity: 60, backgroundBorderRadius: 12, stroke: true, strokeColor: '#000000', strokeWidth: 2 },
  { id: 'reels', name: 'Reels Style', cat: 'boxed', color: '#ffffff', fontWeight: '800', fontSize: 32, fontFamily: 'Montserrat', backgroundColor: '#ff1f1f', backgroundOpacity: 85, backgroundBorderRadius: 16, backgroundPadding: 14, stroke: true, strokeColor: '#000000', strokeWidth: 2 },
  { id: 'slide', name: 'Slide In', cat: 'boxed', color: '#ffffff', fontWeight: '800', fontSize: 32, backgroundColor: '#ff1f1f', backgroundOpacity: 90, backgroundBorderRadius: 8, backgroundPadding: 12, fontFamily: 'Montserrat' },
  { id: 'deepdiver', name: 'Deep Diver', cat: 'boxed', color: '#ffffff', backgroundColor: '#1a1a2e', backgroundOpacity: 80, fontWeight: '600', fontSize: 32, fontFamily: 'Inter', stroke: true, strokeColor: '#000000', strokeWidth: 2 },
  { id: 'glass', name: 'Glass', cat: 'boxed', color: '#ffffff', fontWeight: '600', fontSize: 32, backgroundColor: 'rgba(255,255,255,0.1)', backgroundOpacity: 30, backgroundBorderRadius: 16, letterSpacing: 1, shadow: true, shadowColor: '#000000', shadowBlur: 20, shadowOffsetX: 0, shadowOffsetY: 8 },
  { id: 'pastel', name: 'Pastel', cat: 'boxed', color: '#1a1a2e', fontWeight: '700', fontSize: 32, backgroundColor: '#fce4ec', backgroundOpacity: 100, backgroundBorderRadius: 16, backgroundPadding: 14, fontFamily: 'Poppins' },
  { id: 'spotify', name: 'Spotify', cat: 'boxed', color: '#1ed760', fontFamily: 'Inter', fontWeight: '900', fontSize: 32, backgroundColor: '#121212', backgroundOpacity: 80, letterSpacing: 0.5 },
  { id: 'beasty', name: 'Bold Impact', cat: 'boxed', color: '#ffffff', backgroundColor: '#ff1f1f', backgroundOpacity: 100, fontWeight: '900', fontSize: 38, textTransform: 'uppercase', fontFamily: 'Bebas Neue', stroke: true, strokeColor: '#000000', strokeWidth: 2 },
  { id: 'popline', name: 'Pop Line', cat: 'boxed', color: '#ffffff', backgroundColor: '#ff1f1f', backgroundOpacity: 100, fontWeight: '800', fontSize: 34, textTransform: 'uppercase', fontFamily: 'Anton', stroke: true, strokeColor: '#000000', strokeWidth: 2 },
  { id: 'classic', name: 'Classic', cat: 'classic', color: '#ffffff', fontWeight: '700', fontSize: 32, stroke: true, strokeColor: '#000000', strokeWidth: 4, backgroundColor: 'transparent', backgroundOpacity: 0 },
  { id: 'outline', name: 'Outline', cat: 'classic', color: '#ffffff', fontWeight: '800', fontSize: 34, stroke: true, strokeColor: '#000000', strokeWidth: 6, backgroundColor: 'transparent' },
  { id: 'shadow', name: 'Shadow', cat: 'classic', color: '#ffffff', fontWeight: '700', fontSize: 32, shadow: true, shadowColor: '#000000', shadowBlur: 8, shadowOffsetX: 3, shadowOffsetY: 3 },
  { id: 'minimal', name: 'Minimal', cat: 'classic', color: '#000000', fontWeight: '300', fontSize: 28, letterSpacing: 3, textTransform: 'uppercase', fontFamily: 'Inter' },
  { id: 'handwriting', name: 'Handwriting', cat: 'classic', color: '#ffffff', fontWeight: '600', fontSize: 34, fontFamily: 'Dancing Script', fontStyle: 'italic', stroke: true, strokeColor: '#000000', strokeWidth: 3 },
  { id: 'newspaper', name: 'Newspaper', cat: 'classic', color: '#000000', fontFamily: 'Times New Roman', fontWeight: '700', fontSize: 30, backgroundColor: '#f3f4f6', backgroundOpacity: 100, backgroundBorderRadius: 2, lineHeight: 1.1 },
  { id: 'gradient', name: 'Gradient Text', cat: 'classic', color: '#ffffff', fontWeight: '900', fontSize: 38, fontFamily: 'Montserrat', stroke: true, strokeColor: '#000000', strokeWidth: 3 },
  { id: 'shadowdeep', name: 'Deep Shadow', cat: 'classic', color: '#ffffff', fontWeight: '900', fontSize: 34, shadow: true, shadowColor: '#000000', shadowBlur: 16, shadowOffsetX: 4, shadowOffsetY: 4, letterSpacing: 0.5 },
  { id: 'tiktok', name: 'TikTok Style', cat: 'bold', color: '#ffffff', fontWeight: '900', fontSize: 34, fontFamily: 'Montserrat', stroke: true, strokeColor: '#000000', strokeWidth: 4, textTransform: 'uppercase', letterSpacing: 1 },
  { id: 'glitch', name: 'Glitch', cat: 'bold', color: '#ffffff', fontWeight: '800', fontSize: 34, fontFamily: 'Montserrat', stroke: true, strokeColor: '#000000', strokeWidth: 3, letterSpacing: 1 },
  { id: 'meme', name: 'Meme', cat: 'bold', color: '#ffffff', fontFamily: 'Impact', fontWeight: '900', fontSize: 38, stroke: true, strokeColor: '#000000', strokeWidth: 5, textTransform: 'uppercase' },
  { id: 'youshaei', name: 'Red Italic', cat: 'bold', color: '#ff1f1f', fontWeight: '800', fontSize: 32, fontStyle: 'italic', textTransform: 'uppercase', fontFamily: 'Montserrat', stroke: true, strokeColor: '#000000', strokeWidth: 2 },
  { id: 'retro', name: 'Retro', cat: 'bold', color: '#ffcc00', fontFamily: 'Impact', fontWeight: '900', fontSize: 34, stroke: true, strokeColor: '#000000', strokeWidth: 3, textTransform: 'uppercase', letterSpacing: 1 },
  { id: 'vaporwave', name: 'Vaporwave', cat: 'bold', color: '#f472b6', fontWeight: '800', fontSize: 32, fontFamily: 'Orbitron', stroke: true, strokeColor: '#000000', strokeWidth: 2, letterSpacing: 3 },
  { id: 'cinematic', name: 'Cinematic', cat: 'bold', color: '#ffffff', fontWeight: '400', fontSize: 28, letterSpacing: 4, textTransform: 'uppercase', fontFamily: 'Playfair Display', shadow: true, shadowColor: '#000000', shadowBlur: 6, shadowOffsetX: 2, shadowOffsetY: 2 },
  { id: '3d_extrude', name: '3D Extrude', cat: 'bold', color: '#ffffff', fontWeight: '900', fontSize: 36, fontFamily: 'Anton', textTransform: 'uppercase', shadow: true, shadowColor: '#000000', shadowBlur: 0, shadowOffsetX: 3, shadowOffsetY: 3, stroke: true, strokeColor: '#333333', strokeWidth: 2 },
]

const VIRAL_HOOKS = [
  { title: 'The PeakClip secret', text: 'The PeakClip secret revealed in less than a minute...' },
  { title: 'Avoid this big mistake', text: 'Avoid this big mistake when editing your social clips...' },
  { title: '3 retention tricks', text: '3 quick retention tricks creators ignore...' }
]

export default function EditorPage() {
  const router = useRouter()
  const videoRef = useRef(null)
  const mobileVideoRef = useRef(null)
  const subtitleCanvasRef = useRef(null)
  const mobileSubtitleCanvasRef = useRef(null)
  const faceCanvasRef = useRef(null)
  const waveformCanvasRef = useRef(null)
  const synthRef = useRef(null)

  // --- STATE ---
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [toast, setToast] = useState(null)
  const [user, setUser] = useState(null)
  const [credits, setCredits] = useState(0)

  // Clip details
  const [clipId, setClipId] = useState(null)
  const [clipTitle, setClipTitle] = useState('New redesigned clip')
  const [clipDate, setClipDate] = useState('')
  const [videoSrc, setVideoSrc] = useState(null)
  const [displayVideoSrc, setDisplayVideoSrc] = useState(null)
  const [videoError, setVideoError] = useState(null)
  const [duration, setDuration] = useState(60)
  const [clipStart, setClipStart] = useState(0)
  const [currentTime, setCurrentTime] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [subtitleText, setSubtitleText] = useState('')

  // Mobile editor state
  const [mobileTab, setMobileTab] = useState('home')
  const [trimStart, setTrimStart] = useState(0)
  const [trimEnd, setTrimEnd] = useState(0)
  const [playbackSpeed, setPlaybackSpeed] = useState(1)
  const [selectedSubtitleId, setSelectedSubtitleId] = useState(null)
  const [mobilePlaying, setMobilePlaying] = useState(false)
  const [mobileExporting, setMobileExporting] = useState(false)
  const [mobileExportUrl, setMobileExportUrl] = useState(null)

  const effectiveTrimEnd = trimEnd || duration

  // Translation & Dubbing
  const [languageMode, setLanguageMode] = useState('original')
  const [translatingState, setTranslatingState] = useState(false)
  const [translatingProgress, setTranslatingProgress] = useState(0)
  const [dubbingEnabled, setDubbingEnabled] = useState(true)

  // Transcript
  const [transcriptEN, setTranscriptEN] = useState([])
  const [transcriptES, setTranscriptES] = useState([])
  const [activeTranscript, setActiveTranscript] = useState([])
  const [searchTerm, setSearchTerm] = useState('')
  const [filterFavorites, setFilterFavorites] = useState(false)
  const [audioCleanActive, setAudioCleanActive] = useState(false)
  const [contextMenu, setContextMenu] = useState(null)
  const [lastSpokenWordId, setLastSpokenWordId] = useState(null)

  // SRT modal state
  const [srtInputText, setSrtInputText] = useState('')
  const [showSrtModal, setShowSrtModal] = useState(false)

  // Panels & tabs
  const [leftPanelOpen, setLeftPanelOpen] = useState(true)
  const [rightPanelOpen, setRightPanelOpen] = useState(true)
  const [activeRightTab, setActiveRightTab] = useState('presets')
  const [showExportModal, setShowExportModal] = useState(false)

  // View Settings & Crop Boundaries
  const [aspectRatio, setAspectRatio] = useState('9:16')
  const [layoutMode, setLayoutMode] = useState('ajustar')
  const [zoomCanvas, setZoomCanvas] = useState(100)

  // Subtitle Style Settings
  const [selectedPresetId, setSelectedPresetId] = useState('classic')
  const [subtitleStyle, setSubtitleStyle] = useState({
    fontFamily: 'Inter',
    fontSize: 24,
    fontWeight: '700',
    color: '#ffffff',
    backgroundColor: 'transparent',
    backgroundOpacity: 0,
    backgroundBorderRadius: 6,
    textAlign: 'center',
    textTransform: 'none',
    letterSpacing: 0,
    lineHeight: 1.2,
    positionY: 78,
    maxWidth: 82,
    stroke: true,
    strokeColor: '#000000',
    strokeWidth: 4,
    shadow: false,
    shadowColor: '#000000',
    shadowBlur: 4,
    shadowOffsetX: 2,
    shadowOffsetY: 2,
    karaokeHighlight: false,
    highlightColor: '#ff1f1f',
    fontStyle: 'normal',
    backgroundPadding: 8,
    maxWords: 4,
    entryAnimation: 'none',
    entryDuration: 0.3
  })

  // Face Tracking
  const [faceTrackingEnabled, setFaceTrackingEnabled] = useState(true)
  const [faceTrackingSmoothness, setFaceTrackingSmoothness] = useState(50)
  const [faceTrackingZoom, setFaceTrackingZoom] = useState(120)
  const [showFaceBox, setShowFaceBox] = useState(true)
  const [modelsLoaded, setModelsLoaded] = useState(false)
  const [faceState, setFaceState] = useState('SEARCHING...')

  // LERP Coordinates
  const cropX = useRef(0)
  const cropY = useRef(0)

  // Timeline Tracks Items
  const [timelineItems, setTimelineItems] = useState([
    { id: 'vid-main', track: 'video', start: 0, duration: 39, title: 'Original video.mp4', color: '#9ca3af', type: 'video' }
  ])
  const [rankingSegments, setRankingSegments] = useState([])
  const [activeVideoItemId, setActiveVideoItemId] = useState(null)
  const pendingSeekRef = useRef(null)

  // Multi-clip mode: ranking clips are independent video-track elements, each
  // with its own source file (no pre-concatenated video).
  const videoItems = useMemo(
    () => timelineItems.filter(x => x.track === 'video' && x.src),
    [timelineItems]
  )
  const isMultiClipMode = videoItems.length > 0
  const [selectedTimelineItemId, setSelectedTimelineItemId] = useState('vid-main')
  const [draggingTimelineItem, setDraggingTimelineItem] = useState(null)
  const timelineDragMoved = useRef(false)
  const timelineRef = useRef(null)
  const handleTimelineClick = useCallback((e) => {
    if (!timelineRef.current || duration <= 0) return
    const rect = timelineRef.current.getBoundingClientRect()
    const clickX = e.clientX - rect.left
    const pct = Math.max(0, Math.min(1, clickX / rect.width))
    seekTo(pct * duration)
  }, [duration])

  // Text overlays
  const [textOverlays, setTextOverlays] = useState([])
  const [selectedTextId, setSelectedTextId] = useState(null)
  const [draggingTextId, setDraggingTextId] = useState(null)
  const dragOffset = useRef({ x: 0, y: 0 })

  // Audio settings
  const [clipVolume, setClipVolume] = useState(100)
  const [isMuted, setIsMuted] = useState(false)
  const [musicVolume, setMusicVolume] = useState(30)
  const [bgMusicList, setBgMusicList] = useState([
    { id: 'm1', name: 'Lo-Fi Chill Beat.mp3', duration: '02:34' },
    { id: 'm2', name: 'Energetic Vibe.mp3', duration: '03:10' },
    { id: 'm3', name: 'Cinematic Ambient.mp3', duration: '04:15' }
  ])
  const [activeMusicTrack, setActiveMusicTrack] = useState('m1')

  // B-Roll
  const [brollSearch, setBrollSearch] = useState('')
  const [brollResults, setBrollResults] = useState([
    { id: 'br-1', title: 'B-Roll Cafe.mp4', url: 'https://images.pexels.com/photos/7095/people-coffee-notes-tea.jpg?auto=compress&cs=tinysrgb&w=150' },
    { id: 'br-2', title: 'B-Roll Office.mp4', url: 'https://images.pexels.com/photos/3183197/pexels-photo-3183197.jpeg?auto=compress&cs=tinysrgb&w=150' }
  ])

  // Brand Template settings
  const [brandColorPrimary, setBrandColorPrimary] = useState('#ff1f1f')
  const [brandColorSecondary, setBrandColorSecondary] = useState('#18181b')
  const [brandLogoPosition, setBrandLogoPosition] = useState('bottom-right')

  // Timeline zoom
  const [timelineZoom, setTimelineZoom] = useState(50)

  // Export
  const [exportResolution, setExportResolution] = useState('1080p')

  // Undo/Redo stack
  const [history, setHistory] = useState([])
  const [historyIndex, setHistoryIndex] = useState(-1)

  const triggerToast = (type, text) => {
    setToast({ type, text })
    setTimeout(() => setToast(null), 3000)
  }

  const formatDuration = (seconds) => {
    const date = new Date(seconds * 1000)
    return date.toISOString().substr(14, 5)
  }

  const normalizeVideoUrl = (url) => {
    if (!url) return url
    // Some stored URLs have a duplicated bucket folder segment (/clips/clips/...)
    return url.replace(/\/storage\/v1\/object\/public\/clips\/clips\//g, '/storage/v1/object/public/clips/')
  }

  // Sync normalized video URL used by the player
  useEffect(() => {
    setDisplayVideoSrc(normalizeVideoUrl(videoSrc))
    setVideoError(null)
  }, [videoSrc])

  // --- HTML5 SPEECH SYNTHESIS FOR DUBBING ---
  useEffect(() => {
    if (typeof window !== 'undefined') {
      synthRef.current = window.speechSynthesis
    }
  }, [])

  // --- INITIAL CHECK & LOAD ---
  useEffect(() => {
    const init = async () => {
      try {
        const supabase = getSupabaseClient()
        const { data: { user } } = await supabase.auth.getUser()

        if (!user) {
          router.push('/login')
          return
        }
        setUser(user)

        // Load credits
        const { data: profile } = await supabase.from('users').select('credits').eq('id', user.id).single()
        if (profile) setCredits(profile.credits)

        // Parse query params
        const params = new URLSearchParams(window.location.search)
        const id = params.get('id')

        let clipDuration = 39

        if (id) {
          setClipId(id)
          const { data: clipData, error } = await supabase.from('clips').select('*').eq('id', id).single()
          if (error) throw error

          if (clipData) {
            setClipTitle(clipData.title || 'Untitled Clip')
            setVideoSrc(clipData.video_url || 'https://assets.mixkit.co/videos/preview/mixkit-holding-a-retro-game-controller-with-both-hands-41484-large.mp4')
            clipDuration = parseFloat(clipData.duration) || 39
            setDuration(clipDuration)
            setClipDate(clipData.created_at ? new Date(clipData.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '')
            const clipOffset = parseFloat(clipData.start_time) || 0
            setClipStart(clipOffset)

            // Setup multi-lingual transcription (check transcript or words_json or subtitles_srt or srt_url)
            let rawTranscript = []
            const transcriptSource = clipData.transcript || clipData.words_json
            if (transcriptSource) {
              const parsed = typeof transcriptSource === 'string' ? JSON.parse(transcriptSource) : transcriptSource
              if (Array.isArray(parsed) && parsed.length > 0) {
                  rawTranscript = parsed.map((w, i) => ({
                    id: `w-${i}`,
                    word: w.word || '',
                    startTime: Math.max(0, (w.startTime ?? w.start ?? 0) - clipOffset),
                    endTime: Math.max(0, (w.endTime ?? w.end ?? 0) - clipOffset),
                    deleted: false,
                    favorite: false
                  }))
              }
            }
            // Fallback: parse subtitles_srt if words_json was empty/null
            if (rawTranscript.length === 0 && clipData.subtitles_srt) {
              try {
                const { parseSRT } = require('../../lib/subtitles')
                const subs = parseSRT(clipData.subtitles_srt)
                subs.forEach((seg, idx) => {
                  const words = seg.text.split(/\s+/).filter(w => w)
                  const wordDuration = (seg.end - seg.start) / Math.max(words.length, 1)
                  words.forEach((w, wIdx) => {
                    rawTranscript.push({
                      id: `w-${idx}-${wIdx}`,
                      word: w,
                      startTime: seg.start + wIdx * wordDuration,
                      endTime: Math.min(seg.end, seg.start + (wIdx + 1) * wordDuration),
                      deleted: false,
                      favorite: false
                    })
                  })
                })
              } catch (e) {
                console.warn('Failed to parse subtitles_srt fallback:', e)
              }
            }
            // Fallback 2: fetch SRT from srt_url if both words_json and subtitles_srt are null
            if (rawTranscript.length === 0 && clipData.srt_url) {
              try {
                const res = await fetch(clipData.srt_url)
                if (res.ok) {
                  const srtText = await res.text()
                  const { parseSRT } = require('../../lib/subtitles')
                  const subs = parseSRT(srtText)
                  subs.forEach((seg, idx) => {
                    const words = seg.text.split(/\s+/).filter(w => w)
                    const wordDuration = (seg.end - seg.start) / Math.max(words.length, 1)
                    words.forEach((w, wIdx) => {
                      rawTranscript.push({
                        id: `w-${idx}-${wIdx}`,
                        word: w,
                        startTime: seg.start + wIdx * wordDuration,
                        endTime: Math.min(seg.end, seg.start + (wIdx + 1) * wordDuration),
                        deleted: false,
                        favorite: false
                      })
                    })
                  })
                }
              } catch (e) {
                console.warn('Failed to fetch srt_url fallback:', e)
              }
            }
            console.log('TRANSCRIPT LOAD:', { words_json: clipData.words_json, subtitles_srt_len: clipData.subtitles_srt?.length, srt_url: clipData.srt_url, rawTranscriptLen: rawTranscript.length })
            if (rawTranscript.length > 0) {
              setTranscriptEN(rawTranscript)
              setTranscriptES(generateSpanishTranscript(rawTranscript))
              setActiveTranscript(rawTranscript)
            } else {
              const defaultEN = generateEnglishTranscript(clipDuration)
              setTranscriptEN(defaultEN)
              setTranscriptES(generateSpanishTranscript(defaultEN))
              setActiveTranscript(defaultEN)
            }

            if (clipData.subtitle_style) {
              setSubtitleStyle(prev => ({ ...prev, ...clipData.subtitle_style }))
              if (clipData.subtitle_style.presetId) {
                setSelectedPresetId(clipData.subtitle_style.presetId)
              }
            }

            if (clipData.brand_settings && Array.isArray(clipData.brand_settings.ranking_segments)) {
              const segs = clipData.brand_settings.ranking_segments
              setRankingSegments(segs)
              if (segs.some(s => s.video_url)) {
                const total = segs.reduce((acc, s) => Math.max(acc, (s.start || 0) + (s.duration || 0)), 0)
                const items = segs.map((s, i) => ({
                  id: `rankclip-${s.rank ?? i + 1}`,
                  track: 'video',
                  start: s.start || 0,
                  duration: s.duration || 1,
                  title: s.title ? `#${s.rank ?? i + 1} ${s.title}` : `#${s.rank ?? i + 1}`,
                  src: s.video_url,
                  thumb: s.thumbnail_url || '',
                  rank: s.rank ?? i + 1,
                }))
                setTimelineItems(items)
                setSelectedTimelineItemId(items[0]?.id || '')
                setActiveVideoItemId(items[0]?.id || null)
                setDuration(total)
                setVideoSrc(items[0]?.src || clipData.video_url)
                setDisplayVideoSrc(items[0]?.src || clipData.video_url)
                setTrimStart(0)
                setTrimEnd(total)
              }
            }
          }
        } else {
          // Default demo clip
           // Keep the demo playable without requiring storage permissions.
           setVideoSrc('https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4')
          setDuration(39)
          setClipDate(new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }))
          const defaultEN = generateEnglishTranscript(39)
          setTranscriptEN(defaultEN)
          setTranscriptES(generateSpanishTranscript(defaultEN))
          setActiveTranscript(defaultEN)
        }

        // Sync main video duration to timeline item
        setTimelineItems(items => items.map(item => item.id === 'vid-main' ? { ...item, duration: clipDuration } : item))

        // Initialize history stack
        const initialState = {
          title: clipTitle,
          subtitleStyle: { ...subtitleStyle },
          transcript: [...activeTranscript],
          textOverlays: [...textOverlays]
        }
        setHistory([initialState])
        setHistoryIndex(0)

        // Load face-api models
        try {
          const faceapi = await getFaceapi()
          if (faceapi) {
            await faceapi.nets.tinyFaceDetector.loadFromUri('/models')
            await faceapi.nets.faceLandmark68Net.loadFromUri('/models')
            setModelsLoaded(true)
          }
        } catch (e) {
          console.warn('Face models fallback activated:', e.message)
        }

        setLoading(false)
      } catch (err) {
        console.error('Error initializing editor:', err)
        setLoading(false)
      }
    }
    init()
  }, [])

  // Sync activeTranscript to timeline subtitle items
  useEffect(() => {
    if (!activeTranscript.length) return
    const words = activeTranscript.filter(w => !w.deleted)
    const items = words.map((w, i) => ({
      id: `sub-${w.id}`,
      track: 'subtitle',
      start: w.startTime,
      duration: Math.max(0.5, w.endTime - w.startTime),
      title: w.word,
      color: '#ff1f1f',
      type: 'subtitle'
    }))
    setTimelineItems(prev => {
      const filtered = prev.filter(x => x.track !== 'subtitle')
      return [...filtered, ...items]
    })
  }, [activeTranscript])

  // --- TRANSCRIPT GENERATORS ---
  const generateEnglishTranscript = (dur) => {
    const words = [
      'Hello', 'everyone', 'today', 'we', 'are', 'going', 'to', 'see', 'how', 'you',
      'can', 'create', 'viral', 'clips', 'in', 'seconds', 'with', 'PeakClip',
      'This', 'tool', 'is', 'incredible', 'and', 'it', 'will', 'help', 'you', 'grow',
      'on', 'social', 'media', 'like', 'TikTok', 'Instagram', 'and', 'YouTube',
      'You', 'just', 'have', 'to', 'upload', 'your', 'video', 'and', 'the', 'artificial',
      'intelligence', 'will', 'take', 'care', 'of', 'the', 'rest', 'including', 'captions'
    ]
    const list = []
    const step = dur / (words.length + 2)
    for (let i = 0; i < words.length; i++) {
      list.push({
        id: `w-${i}`,
        word: words[i],
        startTime: i * step,
        endTime: (i + 1) * step - 0.05,
        deleted: false,
        favorite: false
      })
    }
    return list
  }

  const generateSpanishTranscript = (englishList) => {
    const translations = [
      'Hola', 'a todos', 'hoy', 'vamos', 'a', 'ver', 'cómo', 'tú',
      'puedes', 'crear', 'clips', 'virales', 'en', 'segundos', 'con', 'PeakClip',
      'Esta', 'herramienta', 'es', 'increíble', 'y', 'te', 'ayudará', 'a', 'crecer',
      'en', 'redes', 'sociales', 'como', 'TikTok', 'Instagram', 'y', 'YouTube',
      'Tú', 'solo', 'tienes', 'que', 'subir', 'tu', 'video', 'y', 'la', 'inteligencia',
      'artificial', 'se', 'encargará', 'de', 'todo', 'el', 'resto', 'incluyendo', 'subtítulos'
    ]
    return englishList.map((item, idx) => ({
      ...item,
      word: translations[idx % translations.length]
    }))
  }

  // --- LANGUAGE DUBBING SWITCHER ---
  const handleLanguageChange = async (lang) => {
    if (lang === languageMode) return
    setTranslatingState(true)
    setTranslatingProgress(10)
    
    const timer1 = setTimeout(() => setTranslatingProgress(45), 300)
    const timer2 = setTimeout(() => setTranslatingProgress(85), 700)
    
    setTimeout(() => {
      setLanguageMode(lang)
      if (lang === 'translated') {
        setActiveTranscript(transcriptES)
        triggerToast('success', 'Spanish translation and dubbing completed')
      } else {
        setActiveTranscript(transcriptEN)
        triggerToast('success', 'Original English audio enabled')
      }
      setTranslatingState(false)
      setTranslatingProgress(0)
    }, 1100)
  }

  // --- SAVE & EXPORT ---
  const saveToHistory = (newState) => {
    const currentHist = history.slice(0, historyIndex + 1)
    const state = {
      title: newState.title || clipTitle,
      subtitleStyle: newState.subtitleStyle ? { ...newState.subtitleStyle, presetId: selectedPresetId } : { ...subtitleStyle, presetId: selectedPresetId },
      transcript: newState.transcript ? [...newState.transcript] : [...activeTranscript],
      textOverlays: newState.textOverlays ? [...newState.textOverlays] : [...textOverlays]
    }
    setHistory([...currentHist, state])
    setHistoryIndex(currentHist.length)
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const supabase = getSupabaseClient()
      if (clipId) {
          const { error } = await supabase
            .from('clips')
            .update({
              title: clipTitle,
              transcript: activeTranscript,
              words_json: activeTranscript,
              subtitle_style: subtitleStyle,
              brand_settings: {
                primary: brandColorPrimary,
                secondary: brandColorSecondary,
                logoPosition: brandLogoPosition,
                ranking_segments: isMultiClipMode
                  ? videoItems.map(x => ({
                      rank: x.rank,
                      title: x.title.replace(/^#\d+ /, ''),
                      start: x.start,
                      duration: x.duration,
                      video_url: x.src,
                      thumbnail_url: x.thumb || '',
                    }))
                  : rankingSegments
              }
            })
            .eq('id', clipId)
        if (error) throw error
      }
      setSaveSuccess(true)
      triggerToast('success', 'Project saved to the cloud!')
      setTimeout(() => setSaveSuccess(false), 2000)
    } catch (e) {
      console.error(e)
      triggerToast('error', 'Error saving changes')
    } finally {
      setSaving(false)
    }
  }

  const triggerExport = async () => {
    if (!clipId || !videoSrc) {
      triggerToast('error', 'No clip available to export')
      return
    }

    // ─── WYSIWYG: validate editor state matches export payload ───
    if (process.env.NODE_ENV !== 'production') {
      const EXPECTED_KEYS = ['fontFamily','fontSize','fontWeight','fontStyle','color','highlightColor','backgroundColor','backgroundOpacity','backgroundPadding','backgroundBorderRadius','stroke','strokeColor','strokeWidth','shadow','shadowColor','shadowBlur','shadowOffsetX','shadowOffsetY','textAlign','textTransform','letterSpacing','lineHeight','positionY','maxWidth','maxWords','karaokeHighlight','entryAnimation','entryDuration']
      for (const k of EXPECTED_KEYS) {
        if (subtitleStyle[k] === undefined && !['maxWords','backgroundPadding','entryAnimation','entryDuration'].includes(k)) {
          console.warn(`⚠️ WYSIWYG: subtitleStyle.${k} is undefined — will be lost during export`)
        }
      }
      console.log('WYSIWYG subtitleStyle snapshot:', JSON.parse(JSON.stringify(subtitleStyle)))
    }
    setMobileExporting(true)
    setMobileExportUrl(null)
    setShowExportModal(false)
    triggerToast('success', 'Video export started.')
    try {
      const trimStartPct = duration ? (trimStart / duration) * 100 : 0
      const trimEndPct = duration ? (effectiveTrimEnd / duration) * 100 : 100
      const subtitleText = activeTranscript.filter(w => !w.deleted).map(w => w.word).join(' ')

      const position = subtitleStyle.positionY < 40 ? 'top' : subtitleStyle.positionY > 60 ? 'bottom' : 'middle'
      const trackMap = { m1: 'chill', m2: 'hype', m3: 'epic' }

      // Measure exact font ascent for WYSIWYG position matching
      let ascentRatio = 0.85
      try {
        const c = document.createElement('canvas')
        const ctx = c.getContext('2d')
        if (ctx) {
          ctx.font = (subtitleStyle.fontStyle || 'normal') + ' ' + (subtitleStyle.fontWeight || '700') + ' ' + (subtitleStyle.fontSize || 32) + 'px "' + (subtitleStyle.fontFamily || 'Inter') + '"'
          const m = ctx.measureText('Ay')
          ascentRatio = Math.max(0.5, Math.min(1.0, m.actualBoundingBoxAscent / (subtitleStyle.fontSize || 32) || 0.85))
        }
      } catch {}

      const subtitleWords = activeTranscript.filter(w => !w.deleted).map(w => ({
        word: w.word,
        start: w.startTime,
        end: w.endTime,
        id: w.id
      }))
      const response = await exportClip(clipId, {
        video_url: videoSrc,
        trim_start: Math.max(0, Math.min(100, trimStartPct)),
        trim_end: Math.max(0, Math.min(100, trimEndPct)),
        subtitle_text: subtitleText || 'PeakClip',
        subtitle_style: selectedPresetId === 'none' ? 'none' : 'custom',
        subtitle_position: position,
        subtitle_style_obj: { ...subtitleStyle, ascentRatio },
        subtitle_words: subtitleWords,
        subtitle_mode: wordByWordPresets.includes(selectedPresetId) ? 'word' : 'phrase',
        font_size: subtitleStyle.fontSize,
        watermark_text: '',
        watermark_position: 'top-right',
        music_track: trackMap[activeMusicTrack] || 'none',
        music_volume: musicVolume,
        filter_style: 'none',
        resolution: exportResolution.toLowerCase(),
        format: 'mp4',
        fps: 30
      })

      if (!response.ok) {
        const err = await response.text().catch(() => 'Export failed')
        throw new Error(err)
      }
      const data = await response.json()
      setMobileExportUrl(data.video_url || null)
      triggerToast('success', 'Export complete!')
    } catch (err) {
      console.error(err)
      triggerToast('error', err.message || 'Export failed')
    } finally {
      setMobileExporting(false)
    }
  }

  // --- UNDO / REDO ---
  const handleUndo = () => {
    if (historyIndex > 0) {
      const prevIndex = historyIndex - 1
      setHistoryIndex(prevIndex)
      const state = history[prevIndex]
      setClipTitle(state.title)
      setSubtitleStyle(state.subtitleStyle)
      setActiveTranscript(state.transcript)
      setTextOverlays(state.textOverlays)
      triggerToast('success', 'Undo completed')
    }
  }

  const handleRedo = () => {
    if (historyIndex < history.length - 1) {
      const nextIndex = historyIndex + 1
      setHistoryIndex(nextIndex)
      const state = history[nextIndex]
      setClipTitle(state.title)
      setSubtitleStyle(state.subtitleStyle)
      setActiveTranscript(state.transcript)
      setTextOverlays(state.textOverlays)
      triggerToast('success', 'Redo completed')
    }
  }

  // --- CANVAS SUBTITLE RENDERING ENGINE ---
  const getSubtitleStyle = (text, presetId, style) => {
    const fs = style?.fontSize || 22
    const presets = {
      focus: {
        color: '#ffffff',
        fontWeight: 900,
        textShadow: '2px 2px 0 #000',
        lineHeight: 1.2,
      },
      viral: {
        color: '#ffffff',
        fontWeight: 900,
        textShadow: '2px 2px 0 #000',
        lineHeight: 1.2,
      },
      karaoke: {
        color: '#ffffff',
        fontWeight: 800,
        textShadow: '2px 2px 0 #000',
        lineHeight: 1.3,
      },
      beasty: {
        color: '#ffffff',
        fontWeight: 900,
        textTransform: 'uppercase',
        textShadow: '2px 2px 0 #000',
        letterSpacing: '0.5px',
        lineHeight: 1.2,
      },
      deepdiver: {
        color: '#ffffff',
        fontWeight: 700,
        background: 'rgba(26,26,46,0.8)',
        padding: '4px 14px',
        borderRadius: '6px',
        lineHeight: 1.3,
        textShadow: '2px 2px 0 #000',
      },
      youshaei: {
        color: '#ff1f1f',
        fontWeight: 700,
        fontStyle: 'italic',
        textTransform: 'uppercase',
        textShadow: '2px 2px 0 #000',
        letterSpacing: '0.5px',
        lineHeight: 1.3,
      },
      popline: {
        color: '#ffffff',
        fontWeight: 900,
        textTransform: 'uppercase',
        textShadow: '2px 2px 0 #000',
        letterSpacing: '0.5px',
        lineHeight: 1.2,
      },
      typewriter: {
        color: style?.highlightColor || '#ff1f1f',
        fontWeight: 900,
        textTransform: 'uppercase',
        textShadow: '2px 2px 0 #000',
        letterSpacing: '0.5px',
      },
      gradient: {
        color: '#ffffff',
        fontWeight: 800,
        textShadow: '2px 2px 4px #000',
        letterSpacing: '0.5px',
      },
      neon: {
        color: '#ffffff',
        fontWeight: 900,
        textShadow: '2px 2px 0 #000, 0 0 20px #ff1f1f',
        letterSpacing: '1px',
      },
      minimal: {
        color: '#ffffff',
        fontWeight: 300,
        textTransform: 'uppercase',
        letterSpacing: '2px',
        textShadow: '2px 2px 0 #000',
      },
      boldpod: {
        color: '#ffffff',
        fontWeight: 900,
        background: 'rgba(0,0,0,0.6)',
        padding: '4px 14px',
        borderRadius: '12px',
        lineHeight: 1.3,
        textShadow: '2px 2px 0 #000',
      },
      retro: {
        color: '#ffcc00',
        fontWeight: 900,
        textTransform: 'uppercase',
        fontFamily: 'Impact',
        textShadow: '2px 2px 0 #000',
        letterSpacing: '0.5px',
      },
      bounce: {
        color: '#ffffff',
        fontWeight: 900,
        textShadow: '2px 2px 0 #000, 0 0 16px #ff1f1f',
        letterSpacing: '0.5px',
      },
      vhs: {
        color: '#ffffff',
        fontWeight: 700,
        fontFamily: 'Courier New',
        textTransform: 'uppercase',
        textShadow: '2px 2px 0 #000',
        letterSpacing: '2px',
      },
      slide: {
        color: '#ffffff',
        fontWeight: 800,
        textShadow: '2px 2px 0 #000',
        letterSpacing: '0.5px',
      },
      tiktok: {
        color: '#ffffff',
        fontWeight: 900,
        textTransform: 'uppercase',
        textShadow: '2px 2px 0 #000',
        letterSpacing: '0.5px',
      },
      reels: {
        color: '#ffffff',
        fontWeight: 800,
        textShadow: '2px 2px 0 #000',
        letterSpacing: '0.5px',
      },
      glitch: {
        color: '#ffffff',
        fontWeight: 800,
        letterSpacing: '1px',
        textShadow: '2px 2px 0 #000',
      },
      cinematic: {
        color: '#ffffff',
        fontWeight: 400,
        textTransform: 'uppercase',
        fontFamily: 'Playfair Display',
        textShadow: '2px 2px 4px #000',
        letterSpacing: '3px',
      },
      meme: {
        color: '#ffffff',
        fontWeight: 900,
        textTransform: 'uppercase',
        fontFamily: 'Impact',
        textShadow: '3px 3px 0 #000',
      },
      shadowdeep: {
        color: '#ffffff',
        fontWeight: 900,
        textShadow: '4px 4px 16px rgba(0,0,0,0.9)',
        letterSpacing: '0.5px',
      },
      vaporwave: {
        color: '#f472b6',
        fontWeight: 800,
        textTransform: 'uppercase',
        fontFamily: 'Orbitron',
        textShadow: '2px 2px 0 #000',
        letterSpacing: '3px',
      },
      spotify: {
        color: '#1ed760',
        fontWeight: 900,
        textShadow: '2px 2px 0 #000',
        background: 'rgba(18,18,18,0.85)',
        padding: '3px 12px',
        borderRadius: '4px',
      },
      glass: {
        color: '#ffffff',
        fontWeight: 600,
        backdropFilter: 'blur(10px)',
        background: 'rgba(255,255,255,0.08)',
        padding: '4px 16px',
        borderRadius: '16px',
        border: '1px solid rgba(255,255,255,0.15)',
        letterSpacing: '1px',
        textShadow: '2px 2px 0 #000',
      },
    }
    const base = presets[presetId] || presets.karaoke
    return {
      ...base,
      fontSize: `${(style?.fontSize || 22) + (presetId === 'beasty' ? 4 : 0)}px`,
      fontFamily: style?.fontFamily || 'Montserrat, sans-serif',
      textAlign: style?.textAlign || 'center',
      color: style?.color || base.color || '#ffffff',
      fontWeight: style?.fontWeight || base.fontWeight || '700',
      wordBreak: 'break-word',
      display: 'block',
    }
  }

  const wordByWordPresets = ['karaoke', 'typewriter', 'bounce', 'vhs', 'neon', 'focus', 'viral']

  function getSubtitleWordsAtTime(time) {
    if (wordByWordPresets.includes(selectedPresetId)) {
      const visible = activeTranscript.filter(w => !w.deleted)
      const idx = visible.findIndex(w => time < Number(w.endTime) + 0.18)
      if (idx === -1) return []
      const word = visible[idx]
      if (time >= Number(word.startTime) - 0.18 && time < Number(word.endTime) + 0.18) {
        return [word]
      }
      return []
    }

    const activeWord = activeTranscript.find(w =>
      !w.deleted && time >= Number(w.startTime) - 0.12 && time < Number(w.endTime)
    )
    if (!activeWord) return []

    const phrase = groupWordsIntoPhrases(activeTranscript).find(words =>
      words.some(w => w.id === activeWord.id)
    )
    return phrase?.filter(w => !w.deleted) || [activeWord]
  }

  const drawSubtitlesOnCanvas = (canvas, timeOverride) => {
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    if (selectedPresetId === 'none') return

    const time = timeOverride != null ? timeOverride : currentTime
    const wordsToDraw = getSubtitleWordsAtTime(time)
    if (!wordsToDraw.length) return
    const activeWord = wordByWordPresets.includes(selectedPresetId)
      ? wordsToDraw[0]
      : wordsToDraw.find(w => time >= Number(w.startTime) - 0.12 && time < Number(w.endTime))
    if (!activeWord) return

    const font = subtitleStyle.fontFamily
    const fontSize = subtitleStyle.fontSize
    const fontWeight = subtitleStyle.fontWeight
    const textTransform = subtitleStyle.textTransform
    const baseY = (canvas.height * subtitleStyle.positionY) / 100

    // Focus and Typewriter use the general multi-word rendering below

    // Group words into display lines for multi-line support
    const charWidth = ctx.measureText('A').width || fontSize * 0.6
    const displayLines = []
    let line = []
    let lineWidth = 0
    const maxLineWidth = canvas.width * (subtitleStyle.maxWidth || 85) / 100

    for (const w of wordsToDraw) {
      let wt = w.word
      if (textTransform === 'uppercase') wt = wt.toUpperCase()
      if (textTransform === 'lowercase') wt = wt.toLowerCase()
      ctx.font = `${subtitleStyle.fontStyle || 'normal'} ${fontWeight} ${fontSize}px ${font}`
      const ww = ctx.measureText(wt + ' ').width
      if (lineWidth + ww > maxLineWidth && line.length > 0) {
        displayLines.push(line)
        line = [{ word: w, text: wt, width: ww }]
        lineWidth = ww
      } else {
        line.push({ word: w, text: wt, width: ww })
        lineWidth += ww
      }
    }
    if (line.length > 0) displayLines.push(line)
    const MAX_LINES = 6
    if (displayLines.length > MAX_LINES) {
      displayLines.splice(MAX_LINES)
      const last = displayLines[MAX_LINES - 1]
      if (last.length > 0) {
        const lastWord = last[last.length - 1]
        lastWord.text = lastWord.text ? lastWord.text + '...' : '...'
      }
    }

    const lineHeight = fontSize * (subtitleStyle.lineHeight || 1.3)
    const totalTextHeight = displayLines.length * lineHeight
    const startY = baseY - totalTextHeight / 2 + lineHeight / 2

    // Draw each line
    for (let li = 0; li < displayLines.length; li++) {
      const lineWords = displayLines[li]
      const totalLineWidth = lineWords.reduce((a, w) => a + w.width, 0)
      const autoScale = totalLineWidth > maxLineWidth ? Math.max(0.7, Math.min(1, maxLineWidth / totalLineWidth)) : 1
      const letterSpacing = (subtitleStyle.letterSpacing || 0)
      const lineY = startY + li * lineHeight

      // Background for entire line
      if (subtitleStyle.backgroundColor && subtitleStyle.backgroundColor !== 'transparent') {
        const bgOpacity = subtitleStyle.backgroundOpacity != null ? subtitleStyle.backgroundOpacity / 100 : 1
        const bgColor = hexToRgba(subtitleStyle.backgroundColor, bgOpacity)
        const pad = (subtitleStyle.backgroundPadding || 10) * autoScale
        const bgH = fontSize * autoScale * 1.3
        const lineW = totalLineWidth * autoScale + (lineWords.length - 1) * letterSpacing * 0.5
        let lineX = 0
        if (subtitleStyle.textAlign === 'left') lineX = pad
        else if (subtitleStyle.textAlign === 'right') lineX = canvas.width - lineW - pad
        else lineX = (canvas.width - lineW) / 2
        ctx.save()
        ctx.fillStyle = bgColor
        ctx.beginPath()
        ctx.roundRect(lineX - pad, lineY - bgH * 0.8, lineW + pad * 2, bgH + pad * 2, subtitleStyle.backgroundBorderRadius || 6)
        ctx.fill()
        ctx.restore()
      }

      let startX = 0
      if (subtitleStyle.textAlign === 'left') startX = 20
      else if (subtitleStyle.textAlign === 'right') startX = canvas.width - totalLineWidth * autoScale - 20
      else startX = (canvas.width - totalLineWidth * autoScale) / 2

      for (const lw of lineWords) {
        ctx.save()
        const isPast = time > lw.word.endTime
        const isActive = time >= lw.word.startTime && time <= lw.word.endTime
        const isFuture = time < lw.word.startTime
        const tw = ctx.measureText(lw.text).width * autoScale

        let color = subtitleStyle.color
        let stroke = subtitleStyle.stroke
        let strokeColor = subtitleStyle.strokeColor
        let strokeWidth = subtitleStyle.strokeWidth

        if (selectedPresetId === 'beasty') {
          color = isActive ? '#000000' : '#ffffff'
        } else if (selectedPresetId === 'youshaei') {
          color = isActive ? '#ff1f1f' : '#ffffff'
        } else if (selectedPresetId === 'popline') {
          color = isActive ? '#000000' : '#ffffff'
          stroke = true
          strokeColor = '#000000'
          strokeWidth = 2
        } else if (selectedPresetId === 'mozi') {
          color = '#ffffff'
          stroke = true
          strokeColor = '#000000'
          strokeWidth = 4
        } else if (selectedPresetId === 'deepdiver') {
          color = '#ffffff'
          stroke = true
          strokeColor = 'rgba(0,0,0,0.5)'
          strokeWidth = 2
        } else if (selectedPresetId === 'karaoke') {
          color = isActive ? (subtitleStyle.highlightColor || '#ff1f1f') : '#ffffff'
        }

        const isWbw = wordByWordPresets.includes(selectedPresetId)

        // Word-by-word: all words in highlight color, no opacity dim for future
        if (isWbw) {
          color = subtitleStyle.highlightColor || '#ff1f1f'
          stroke = true
          strokeColor = '#000000'
          strokeWidth = 3
        } else if (subtitleStyle.karaokeHighlight) {
          color = isActive ? (subtitleStyle.highlightColor || '#ff1f1f') : subtitleStyle.color
          if (isActive) {
            stroke = true
            strokeColor = '#000000'
            strokeWidth = 3
          }
        }

        // Keep the active word prominent in phrase-based presets.
        if (!isWbw && isActive && !['beasty', 'popline'].includes(selectedPresetId)) {
          color = subtitleStyle.highlightColor || '#ff1f1f'
        }

        ctx.font = `${subtitleStyle.fontStyle || 'normal'} ${fontWeight} ${fontSize * autoScale}px ${font}`

        ctx.translate(startX, lineY)

        // Dim inactive words — word-by-word has no dimming, others dim future/past
        if (!isWbw) {
          if (isFuture) ctx.globalAlpha = 0.4
          else if (isPast) ctx.globalAlpha = 0.2
        }

        if (subtitleStyle.shadow) {
          ctx.shadowColor = subtitleStyle.shadowColor || '#000000'
          ctx.shadowBlur = subtitleStyle.shadowBlur || 4
          ctx.shadowOffsetX = subtitleStyle.shadowOffsetX || 2
          ctx.shadowOffsetY = subtitleStyle.shadowOffsetY || 2
        }

        if (stroke) {
          if (subtitleStyle.shadow) {
            ctx.shadowColor = 'transparent'
          }
          ctx.strokeStyle = strokeColor
          ctx.lineWidth = strokeWidth
          ctx.lineJoin = 'round'
          ctx.strokeText(lw.text, 0, 0)
          if (subtitleStyle.shadow) {
            ctx.shadowColor = subtitleStyle.shadowColor || '#000000'
          }
        }

        ctx.fillStyle = color
        ctx.fillText(lw.text, 0, 0)
        ctx.restore()

        startX += lw.width * autoScale + (letterSpacing * 0.5)
      }
    }
  }

  // Keep the same synchronized caption words in the DOM preview as the canvas.
  const subtitleWords = useMemo(() => {
    if (selectedPresetId === 'none' || !activeTranscript.length) return []
    return getSubtitleWordsAtTime(currentTime)
  }, [activeTranscript, currentTime, selectedPresetId])

  const handleTimeUpdate = useCallback(() => {
    if (!videoRef.current) return
    const v = videoRef.current
    if (isMultiClipMode) {
      const active = videoItems.find(i => i.id === activeVideoItemId) || videoItems[0]
      if (active) {
        const clipEnd = active.start + active.duration
        if (v.currentTime >= active.duration - 0.05) {
          if (!v.paused) {
            const next = videoItems.filter(i => i.start >= clipEnd - 0.1).sort((a, b) => a.start - b.start)[0]
            if (next) {
              setActiveVideoItemId(next.id)
              if (next.src !== displayVideoSrc) {
                setDisplayVideoSrc(next.src)
                pendingSeekRef.current = 0
              } else {
                v.currentTime = 0
              }
              setCurrentTime(next.start)
              return
            }
            v.pause()
            setIsPlaying(false)
            setCurrentTime(clipEnd)
            return
          }
        }
        setCurrentTime(Math.min(clipEnd, active.start + v.currentTime))
        return
      }
    }
    setCurrentTime(v.currentTime)
  }, [videoItems, activeVideoItemId, displayVideoSrc, isMultiClipMode])

  const drawSubtitles = useCallback((videoTime) => {
    drawSubtitlesOnCanvas(subtitleCanvasRef.current, videoTime)
    drawSubtitlesOnCanvas(mobileSubtitleCanvasRef.current, videoTime)
  }, [activeTranscript, subtitleStyle, selectedPresetId])

  const hexToRgba = (hex, opacity) => {
    if (hex.startsWith('rgba')) return hex
    let c
    if(/^#([A-Fa-f0-9]{3}){1,2}$/.test(hex)){
        c= hex.substring(1).split('')
        if(c.length== 3){
            c= [c[0], c[0], c[1], c[1], c[2], c[2]]
        }
        c= '0x' + c.join('')
        return 'rgba('+[(c>>16)&255, (c>>8)&255, c&255].join(',')+','+opacity+')'
    }
    return 'rgba(0,0,0,'+opacity+')'
  }

  // --- LERP & FACE DETECTION LOOP ---
  const detectFace = async () => {
    const faceapi = await getFaceapi()
    if (!faceapi || !videoRef.current || !faceTrackingEnabled) return
    const canvas = faceCanvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    const lerpVal = (a, b, t) => a + (b - a) * t

    if (modelsLoaded) {
      const detection = await faceapi
        .detectSingleFace(videoRef.current, new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.5 }))
        .withFaceLandmarks()

      if (detection) {
        setFaceState('TRACKING ACTIVE')
        const { box } = detection.detection
        const targetX = box.x + box.width / 2
        const targetY = box.y + box.height / 2

        const lerpFactorX = (100 - faceTrackingSmoothness) * 0.002
        const lerpFactorY = (100 - faceTrackingSmoothness) * 0.0015

        cropX.current = lerpVal(cropX.current, targetX, Math.max(0.01, lerpFactorX))
        cropY.current = lerpVal(cropY.current, targetY, Math.max(0.01, lerpFactorY))

        if (showFaceBox) {
          ctx.strokeStyle = '#ff1f1f'
          ctx.lineWidth = 3
          ctx.strokeRect(box.x, box.y, box.width, box.height)
        }
      } else {
        setFaceState('SEARCHING...')
      }
    } else {
      setFaceState('TRACKING ACTIVE')
      const targetX = videoRef.current.videoWidth / 2 + Math.sin(currentTime) * 40
      const targetY = videoRef.current.videoHeight / 2 - 20
      cropX.current = lerpVal(cropX.current, targetX, 0.05)
      cropY.current = lerpVal(cropY.current, targetY, 0.04)

      if (showFaceBox) {
        const box = { x: cropX.current - 80, y: cropY.current - 100, width: 160, height: 180 }
        ctx.strokeStyle = '#ff1f1f'
        ctx.lineWidth = 2
        ctx.strokeRect(box.x, box.y, box.width, box.height)
      }
    }
  }

  // Use refs to avoid 60fps re-renders from setCurrentTime in animation loop
  const drawSubtitlesRef = useRef(drawSubtitles)
  drawSubtitlesRef.current = drawSubtitles
  const lastTimeUpdateRef = useRef(0)
  // --- RENDER PLAYBACK LOOP ---
  useEffect(() => {
    let animId
    const update = async () => {
      try {
        const isMobile = window.innerWidth <= 768
        let time = 0
        if (isMobile && mobileVideoRef.current) {
          time = mobileVideoRef.current.currentTime
        } else if (videoRef.current) {
          time = videoRef.current.currentTime
        }
        drawSubtitlesRef.current(time)
        if (Math.abs(time - lastTimeUpdateRef.current) > 0.05) {
          setCurrentTime(time)
          lastTimeUpdateRef.current = time
        }
        if (time > 0 && !isMobile && videoRef.current && faceTrackingEnabled) {
          await detectFace()
        }
      } catch (e) {
        console.warn('Animation loop error:', e)
      }
      animId = requestAnimationFrame(update)
    }
    animId = requestAnimationFrame(update)
    return () => cancelAnimationFrame(animId)
  }, [faceTrackingEnabled, modelsLoaded])

  // --- WAVEFORM TIMELINE GENERATOR ---
  useEffect(() => {
    const drawWaveform = () => {
      const canvas = waveformCanvasRef.current
      if (!canvas) return
      const ctx = canvas.getContext('2d')
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.fillStyle = 'rgba(255, 31, 31, 0.7)'
      
      const barCount = 120
      const barWidth = 3
      const gap = 2

      for (let i = 0; i < barCount; i++) {
        const x = i * (barWidth + gap)
        const centerOffset = Math.sin(i * 0.1) * Math.cos(i * 0.03) * 0.4 + 0.5
        const randomFluct = Math.sin(i * 0.5) * 0.15
        const val = Math.max(0.1, centerOffset + randomFluct)
        const barHeight = val * canvas.height * 0.8
        const y = (canvas.height - barHeight) / 2
        ctx.beginPath()
        ctx.roundRect(x, y, barWidth, barHeight, 1.5)
        ctx.fill()
      }
    }
    drawWaveform()
  }, [waveformCanvasRef, duration])

  // --- TIMELINE INTERACTIVE DRAG ---
  const handleTimelineMouseDown = (e, item, dragType) => {
    e.stopPropagation()
    setSelectedTimelineItemId(item.id)
    timelineDragMoved.current = false
    setDraggingTimelineItem({
      id: item.id,
      initialStart: item.start,
      initialDuration: item.duration,
      dragType: dragType,
      startX: e.clientX
    })
  }

  const handleTimelineMouseMove = (e) => {
    if (!draggingTimelineItem) return
    const deltaX = e.clientX - draggingTimelineItem.startX
    if (Math.abs(deltaX) > 3) {
      timelineDragMoved.current = true
    }
    const pixelsPerSecond = (timelineZoom / 100) * 15 + 5
    const deltaTime = deltaX / pixelsPerSecond

    const item = timelineItems.find(x => x.id === draggingTimelineItem.id)
    if (!item) return

    let nextStart = item.start
    let nextDuration = item.duration

    if (draggingTimelineItem.dragType === 'move') {
      nextStart = Math.max(0, Math.min(duration - item.duration, draggingTimelineItem.initialStart + deltaTime))
    } else if (draggingTimelineItem.dragType === 'resize-left') {
      const targetStart = draggingTimelineItem.initialStart + deltaTime
      const targetDuration = draggingTimelineItem.initialDuration - deltaTime
      const minDur = item.track === 'subtitle' ? 0.3 : 1
      if (targetStart >= 0 && targetDuration >= minDur) {
        nextStart = targetStart
        nextDuration = targetDuration
      }
    } else if (draggingTimelineItem.dragType === 'resize-right') {
      const minDur = item.track === 'subtitle' ? 0.3 : 1
      nextDuration = Math.max(minDur, Math.min(duration - item.start, draggingTimelineItem.initialDuration + deltaTime))
    }

    setTimelineItems(prev => prev.map(x => x.id === draggingTimelineItem.id ? { ...x, start: nextStart, duration: nextDuration } : x))
  }

  const handleTimelineMouseUp = () => {
    if (draggingTimelineItem) {
      const item = timelineItems.find(x => x.id === draggingTimelineItem.id)
      if (item && item.track === 'video') {
        if (timelineDragMoved.current) {
          saveToHistory({ title: clipTitle })
        } else {
          seekTo(item.start)
        }
      } else if (item && item.track === 'subtitle') {
        if (timelineDragMoved.current) {
          const wordId = item.id.replace('sub-', '')
          setActiveTranscript(prev => prev.map(w =>
            w.id === wordId ? { ...w, startTime: item.start, endTime: item.start + item.duration } : w
          ))
          saveToHistory({ title: clipTitle })
        } else {
          setCurrentTime(item.start)
        }
      } else if (timelineDragMoved.current) {
        saveToHistory({ title: clipTitle })
      }
      timelineDragMoved.current = false
      setDraggingTimelineItem(null)
    }
  }

  const handleSplitClip = () => {
    const activeItem = timelineItems.find(x => x.id === selectedTimelineItemId)
    if (!activeItem) {
      triggerToast('error', 'Select a track to split')
      return
    }
    if (currentTime < activeItem.start || currentTime > activeItem.start + activeItem.duration) {
      triggerToast('error', 'Place the red playhead inside the chosen track')
      return
    }

    const firstDuration = currentTime - activeItem.start
    const secondDuration = (activeItem.start + activeItem.duration) - currentTime

    if (firstDuration < 1 || secondDuration < 1) {
      triggerToast('error', 'Clips must be at least 1 second long')
      return
    }

    const newItem = {
      ...activeItem,
      id: `${activeItem.id}-split-${Date.now()}`,
      start: currentTime,
      duration: secondDuration,
      title: `${activeItem.title} (Part 2)`
    }

    setTimelineItems(prev => [
      ...prev.map(x => x.id === activeItem.id ? { ...x, duration: firstDuration } : x),
      newItem
    ])
    triggerToast('success', 'Clip split')
  }

  const handleDeleteSelectedTimelineItem = () => {
    if (isMultiClipMode) {
      if (videoItems.length <= 1) {
        triggerToast('error', 'At least one clip must remain')
        return
      }
      const remaining = timelineItems.filter(x => x.id !== selectedTimelineItemId)
      setTimelineItems(remaining)
      setSelectedTimelineItemId(remaining[0]?.id || '')
      setActiveVideoItemId(remaining[0]?.id || null)
      triggerToast('success', 'Clip deleted')
      return
    }
    if (selectedTimelineItemId === 'vid-main') {
      triggerToast('error', 'You can\'t delete the original video track')
      return
    }
    setTimelineItems(prev => prev.filter(x => x.id !== selectedTimelineItemId))
    setSelectedTimelineItemId('vid-main')
    triggerToast('success', 'Item deleted')
  }

  // Keep the timeline duration in sync with the video clips in multi-clip mode.
  useEffect(() => {
    if (!isMultiClipMode || videoItems.length === 0) return
    const total = videoItems.reduce((acc, x) => Math.max(acc, x.start + x.duration), 0)
    if (Math.abs(total - duration) > 0.05) setDuration(total)
  }, [videoItems, isMultiClipMode])

  const applyPreset = (preset) => {
    setSelectedPresetId(preset.id)
    if (preset.isNone) return
    const nextStyle = {
      ...subtitleStyle,
      color: preset.color || '#ffffff',
      backgroundColor: preset.backgroundColor || 'transparent',
      backgroundOpacity: preset.backgroundOpacity || 0,
      backgroundBorderRadius: preset.backgroundBorderRadius ?? 6,
      fontWeight: preset.fontWeight || '800',
      textTransform: preset.textTransform || 'none',
      stroke: preset.stroke || false,
      strokeColor: preset.strokeColor || '#000000',
      strokeWidth: preset.strokeWidth || 2,
      fontFamily: preset.fontFamily || subtitleStyle.fontFamily,
      fontSize: preset.fontSize || subtitleStyle.fontSize,
      fontStyle: preset.fontStyle || 'normal',
      karaokeHighlight: preset.karaokeHighlight || false,
      highlightColor: preset.highlightColor || '#ff1f1f',
      shadow: preset.shadow || false,
      shadowColor: preset.shadowColor || '#000000',
      shadowBlur: preset.shadowBlur || 4,
      shadowOffsetX: preset.shadowOffsetX || 2,
      shadowOffsetY: preset.shadowOffsetY || 2,
      lineHeight: preset.lineHeight || 1.2,
      letterSpacing: preset.letterSpacing ?? 0,
      textAlign: preset.textAlign || 'center',
    }
    setSubtitleStyle(nextStyle)
    saveToHistory({ subtitleStyle: nextStyle })
  }

  // --- PHRASE GROUPING FOR SUBTITLE TRACKS ---
  function groupWordsIntoPhrases(words) {
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
        if (gap < 0.8 && currentDuration < 3.5 && current.length < 3) {
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

  useEffect(() => {
    const phrases = groupWordsIntoPhrases(activeTranscript)
    const subtitleItems = phrases.map((phrase, i) => {
      const first = phrase[0]
      const last = phrase[phrase.length - 1]
      return {
        id: `phrase-${i}`,
        track: 'subtitle',
        start: first.startTime,
        duration: last.endTime - first.startTime,
        title: phrase.map(w => w.word).join(' '),
        color: '#18181b',
        type: 'subtitle',
        words: phrase,
      }
    })
    setTimelineItems(prev => [...prev.filter(x => !x.id.startsWith('phrase-')), ...subtitleItems])
  }, [activeTranscript])

  const handleWordClick = (w) => {
    seekTo(w.startTime)
    videoRef.current?.play().catch(() => {})
    setIsPlaying(true)
  }

  const toggleWordDeleted = (id) => {
    const nextTranscript = activeTranscript.map(w => w.id === id ? { ...w, deleted: !w.deleted } : w)
    setActiveTranscript(nextTranscript)
    saveToHistory({ transcript: nextTranscript })
  }

  const toggleWordFavorite = (id) => {
    const nextTranscript = activeTranscript.map(w => w.id === id ? { ...w, favorite: !w.favorite } : w)
    setActiveTranscript(nextTranscript)
    saveToHistory({ transcript: nextTranscript })
  }

  const handleWordTextEdit = (id, newText) => {
    const nextTranscript = activeTranscript.map(w => w.id === id ? { ...w, word: newText } : w)
    setActiveTranscript(nextTranscript)
    saveToHistory({ transcript: nextTranscript })
  }

  const handleDownloadSrt = () => {
    let srtText = ''
    activeTranscript.forEach((w, index) => {
      const formatTime = (seconds) => {
        const date = new Date(Math.max(0, seconds) * 1000)
        const hh = String(date.getUTCHours()).padStart(2, '0')
        const mm = String(date.getUTCMinutes()).padStart(2, '0')
        const ss = String(date.getUTCSeconds()).padStart(2, '0')
        const ms = String(date.getUTCMilliseconds()).padStart(3, '0')
        return `${hh}:${mm}:${ss},${ms}`
      }
      srtText += `${index + 1}\n`
      srtText += `${formatTime(w.startTime)} --> ${formatTime(w.endTime)}\n`
      srtText += `${w.word}\n\n`
    })

    const blob = new Blob([srtText], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${clipTitle}_subtitles.srt`
    link.click()
    triggerToast('success', 'Subtitles downloaded in SRT format')
  }

  const handleImportSrt = () => {
    if (!srtInputText) return
    const { parseSRT } = require('../../lib/subtitles')
    const segments = parseSRT(srtInputText)
    const parsedWords = []
    
    segments.forEach((seg, index) => {
      const words = seg.text.split(/\s+/).filter(w => w)
      const wordDuration = (seg.end - seg.start) / Math.max(words.length, 1)
      words.forEach((w, wIdx) => {
        parsedWords.push({
          id: `imported-${index}-${wIdx}`,
          word: w,
          startTime: seg.start + wIdx * wordDuration,
          endTime: Math.min(seg.end, seg.start + (wIdx + 1) * wordDuration),
          deleted: false,
          favorite: false
        })
      })
    })

    if (parsedWords.length > 0) {
      setActiveTranscript(parsedWords)
      triggerToast('success', `Imported ${parsedWords.length} words from SRT`)
    }
    setShowSrtModal(false)
  }

  // --- KEYBOARD LISTENERS ---
  useEffect(() => {
    const h = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return
      const ctrl = e.ctrlKey || e.metaKey
      if (e.key === ' ') { e.preventDefault(); togglePlay() }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); seekTo(Math.max(0, currentTime - 5)) }
      else if (e.key === 'ArrowRight') { e.preventDefault(); seekTo(Math.min(duration, currentTime + 5)) }
      else if (ctrl && (e.key === 'z' || e.key === 'Z') && e.shiftKey) { e.preventDefault(); handleRedo() }
      else if (ctrl && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); handleUndo() }
      else if (!ctrl && (e.key === 'Delete' || e.key === 'Backspace')) { e.preventDefault(); handleDeleteSelectedTimelineItem() }
      else if (ctrl && (e.key === 's' || e.key === 'S')) { e.preventDefault(); handleSave() }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  })

  const togglePlay = () => {
    if (!videoRef.current) return
    if (isPlaying) {
      videoRef.current.pause()
      setIsPlaying(false)
    } else {
      videoRef.current.play()
        .then(() => setIsPlaying(true))
        .catch(() => {
          setIsPlaying(false)
          setVideoError('Unable to play this video')
        })
    }
  }

  const seekTo = (t) => {
    if (!videoRef.current) return
    const boundedTime = Math.max(0, Math.min(duration, t))
    setCurrentTime(boundedTime)
    if (isMultiClipMode) {
      const item = videoItems.find(i => boundedTime >= i.start - 0.01 && boundedTime <= i.start + i.duration + 0.01)
      if (item) {
        setActiveVideoItemId(item.id)
        const vidT = Math.max(0, boundedTime - item.start)
        const sameSrc = videoRef.current.currentSrc
          ? videoRef.current.currentSrc.split('?')[0].endsWith(item.src.split('?')[0])
          : false
        if (sameSrc) {
          videoRef.current.currentTime = vidT
        } else {
          setDisplayVideoSrc(item.src)
          pendingSeekRef.current = vidT
        }
      }
    } else {
      videoRef.current.currentTime = boundedTime
    }
  }

  // --- MOBILE HELPERS ---
  const mobileTogglePlay = () => {
    const v = mobileVideoRef.current
    if (!v) return
    if (v.paused) {
      if (v.currentTime >= effectiveTrimEnd - 0.05) v.currentTime = trimStart
      v.play().catch(() => {})
    } else {
      v.pause()
    }
  }

  const handleMobileTimeUpdate = (e) => {
    const v = e.currentTarget
    if (!v) return
    if (v.currentTime < trimStart - 0.05) {
      v.currentTime = trimStart
    }
    if (v.currentTime >= effectiveTrimEnd) {
      v.currentTime = trimStart
      v.pause()
    }
  }

  const handleTrimPreset = (length) => {
    setTrimStart(0)
    setTrimEnd(Math.min(duration, length))
  }

  const handleAddSubtitle = () => {
    const last = activeTranscript[activeTranscript.length - 1]
    const start = last ? last.endTime + 0.1 : currentTime
    const newWord = {
      id: `subtitle-${Date.now()}`,
      word: 'New caption',
      startTime: start,
      endTime: start + 1,
      deleted: false,
      favorite: false
    }
    const next = [...activeTranscript, newWord]
    setActiveTranscript(next)
    setSelectedSubtitleId(newWord.id)
    saveToHistory({ transcript: next })
  }

  const handleDeleteSubtitle = () => {
    if (!activeSubtitleId) return
    const next = activeTranscript.filter(w => w.id !== activeSubtitleId)
    setActiveTranscript(next)
    setSelectedSubtitleId(null)
    saveToHistory({ transcript: next })
  }

  const handleAddTextOverlay = () => {
    const text = typeof window !== 'undefined' ? window.prompt('Text content:') : ''
    if (text) {
      const next = [...textOverlays, { id: `text-${Date.now()}`, text, x: 50, y: 50, fontSize: 24, color: '#ffffff' }]
      setTextOverlays(next)
      setSelectedTextId(next[next.length - 1].id)
      saveToHistory({ textOverlays: next })
    }
  }

  const handleCanvasMouseDown = (e, overlay) => {
    setSelectedTextId(overlay.id)
    setDraggingTextId(overlay.id)
    const rect = e.target.getBoundingClientRect()
    const clientX = e.clientX - rect.left
    const clientY = e.clientY - rect.top
    dragOffset.current = {
      x: clientX - (overlay.x * rect.width) / 100,
      y: clientY - (overlay.y * rect.height) / 100
    }
  }

  const handleCanvasMouseMove = (e) => {
    if (!draggingTextId) return
    const rect = e.currentTarget.getBoundingClientRect()
    const clientX = e.clientX - rect.left
    const clientY = e.clientY - rect.top
    let newX = ((clientX - dragOffset.current.x) / rect.width) * 100
    let newY = ((clientY - dragOffset.current.y) / rect.height) * 100

    newX = Math.max(0, Math.min(100, newX))
    newY = Math.max(0, Math.min(100, newY))

    const nextOverlays = textOverlays.map(t => t.id === draggingTextId ? { ...t, x: newX, y: newY } : t)
    setTextOverlays(nextOverlays)
  }

  const handleCanvasMouseUp = () => {
    if (draggingTextId) {
      setDraggingTextId(null)
      saveToHistory({ textOverlays })
    }
  }

  const activeSubtitleId = selectedSubtitleId || activeTranscript[0]?.id || null

  // In multi-clip mode, export the currently selected clip.
  const exportVideoItem = isMultiClipMode ? (videoItems.find(x => x.id === selectedTimelineItemId) || videoItems[0]) : null

  const editorContent = loading ? (
    <div style={{
      height: '100vh',
      backgroundColor: 'var(--cream-bg)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: 'var(--cream-text-primary)',
      fontFamily: 'Inter, sans-serif'
    }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
        <div style={{ width: '40px', height: '40px', border: '3px solid color-mix(in srgb, var(--cream-accent) 20%, transparent)', borderTopColor: 'var(--cream-accent)', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
        <span style={{ fontSize: '14px', color: 'var(--cream-text-secondary)' }}>Starting PeakClip editor...</span>
      </div>
    </div>
  ) : (
    <>
    <div className="editor-layout" style={{
      fontFamily: 'Inter, sans-serif'
    }}>
      <style jsx global>{`
        * {
          box-sizing: border-box;
          margin: 0;
          padding: 0;
        }
        input[type="range"] {
          -webkit-appearance: none;
          appearance: none;
          height: 6px;
          border-radius: 100px;
          background: var(--cream-surface-border);
          outline: none;
        }
        input[type="range"]::-webkit-slider-runnable-track {
          background: var(--cream-surface-border);
          height: 6px;
          border-radius: 100px;
        }
        input[type="range"]::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 14px;
          height: 14px;
          border-radius: 50%;
          background: var(--cream-accent);
          cursor: pointer;
          margin-top: -4px;
          border: 2px solid var(--cream-panel);
        }
        .timeline-scroll::-webkit-scrollbar {
          height: 6px;
        }
        .timeline-scroll::-webkit-scrollbar-thumb {
          background-color: var(--cream-surface-border);
          border-radius: 3px;
        }
      `}</style>

      {/* --- TOPBAR (h-14 px-4 bg-zinc-950 border-b border-zinc-800) --- */}
      <header style={{
        height: '56px',
        backgroundColor: 'var(--cream-panel)',
        borderBottom: '1px solid var(--cream-panel-border)',
        padding: '0 16px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexShrink: 0
      }}>
        {/* Left info */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button
            onClick={() => router.back()}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--cream-text-secondary)',
              display: 'flex',
              alignItems: 'center',
              padding: '4px'
            }}
          >
            <ArrowLeft size={18} strokeWidth={1.5} />
          </button>
          
          <input
            type="text"
            value={clipTitle}
            onChange={(e) => setClipTitle(e.target.value)}
            onBlur={handleSave}
            style={{
              border: 'none',
              background: 'transparent',
              color: 'var(--cream-text-primary)',
              fontWeight: '700',
              fontSize: '15px',
              outline: 'none',
              width: '180px'
            }}
          />
          <span style={{
            fontSize: '11px',
            backgroundColor: 'var(--cream-surface)',
            color: 'var(--cream-text-secondary)',
            borderRadius: '4px',
            padding: '2px 6px',
            fontWeight: '600'
          }}>
            Project
          </span>
        </div>

        {/* Center: Language toggle with custom styled pill buttons */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
          backgroundColor: 'var(--cream-surface)',
          border: '1px solid var(--cream-panel-border)',
          borderRadius: '100px',
          padding: '3px'
        }}>
          <button
            onClick={() => handleLanguageChange('original')}
            style={{
              border: 'none',
              borderRadius: '100px',
              padding: '6px 14px',
              fontSize: '12px',
              fontWeight: '700',
              cursor: 'pointer',
              backgroundColor: languageMode === 'original' ? 'var(--cream-accent)' : 'transparent',
              color: languageMode === 'original' ? 'var(--cream-accent-btn-color)' : 'var(--cream-text-secondary)',
              transition: '0.2s'
            }}
          >
            Original (EN)
          </button>
          <button
            onClick={() => handleLanguageChange('translated')}
            style={{
              border: 'none',
              borderRadius: '100px',
              padding: '6px 14px',
              fontSize: '12px',
              fontWeight: '700',
              cursor: 'pointer',
              backgroundColor: languageMode === 'translated' ? 'var(--cream-accent)' : 'transparent',
              color: languageMode === 'translated' ? 'var(--cream-accent-btn-color)' : 'var(--cream-text-secondary)',
              transition: '0.2s',
              display: 'flex',
              alignItems: 'center',
              gap: '4px'
            }}
          >
            Translated (ES)
            <span style={{
              fontSize: '8px',
              backgroundColor: '#0a0a0a',
              color: 'var(--cream-accent)',
              padding: '1px 4px',
              borderRadius: '4px',
              fontWeight: '800'
            }}>AI VOICE</span>
          </button>
        </div>

        {/* Right Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {/* Undo/Redo */}
          <div style={{ display: 'flex', gap: '10px', marginRight: '8px', color: 'var(--cream-text-secondary)' }}>
            <button onClick={handleUndo} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'currentColor' }}>
              <RotateCcw size={16} strokeWidth={1.5} />
            </button>
            <button onClick={handleRedo} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'currentColor' }}>
              <RotateCw size={16} strokeWidth={1.5} />
            </button>
          </div>

          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            backgroundColor: 'color-mix(in srgb, var(--cream-accent) 15%, transparent)',
            border: '1px solid color-mix(in srgb, var(--cream-accent) 25%, transparent)',
            color: 'var(--cream-accent)',
            borderRadius: '100px',
            padding: '6px 12px',
            fontSize: '13px',
            fontWeight: '700'
          }}>
            <Zap size={14} strokeWidth={1.5} />
            <span>+{credits} clips</span>
          </div>

          <button
            onClick={handleSave}
            disabled={saving}
            style={{
              backgroundColor: 'transparent',
              border: '1px solid var(--cream-accent)',
              color: 'var(--cream-accent)',
              borderRadius: '100px',
              padding: '8px 18px',
              fontSize: '13px',
              fontWeight: '600',
              cursor: 'pointer'
            }}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Save size={14} strokeWidth={1.5} />
              {saving ? 'Saving...' : saveSuccess ? 'Saved ✓' : 'Save'}
            </span>
          </button>

          <button
            onClick={() => setShowExportModal(true)}
            style={{
              backgroundColor: 'var(--cream-accent)',
              color: 'var(--cream-bg)',
              borderRadius: '100px',
              padding: '8px 18px',
              fontSize: '13px',
              fontWeight: '800',
              border: 'none',
              cursor: 'pointer'
            }}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Download size={14} strokeWidth={1.5} />
              Export
            </span>
          </button>
        </div>
      </header>

      {/* --- MAIN WORKSPACE --- */}
      <div className="editor-workspace">
        
        {/* PANEL IZQUIERDO: TRANSCRIPIÓN (w-72 bg-zinc-900 border-r border-zinc-800) */}
        {leftPanelOpen && (
          <aside className="editor-left-panel">
            <div style={{ padding: '16px', borderBottom: '1px solid var(--cream-panel-border)', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <button
                onClick={() => setAudioCleanActive(!audioCleanActive)}
                style={{
                  backgroundColor: audioCleanActive ? 'var(--cream-accent)' : 'var(--cream-bg)',
                  color: audioCleanActive ? 'var(--cream-accent-btn-color)' : 'var(--cream-text-primary)',
                  border: 'none',
                  borderRadius: '8px',
                  padding: '10px',
                  fontSize: '13px',
                  fontWeight: '700',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  width: '100%'
                }}
              >
                <Wand2 size={16} strokeWidth={1.5} />
                Audio cleanup
              </button>

              <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                <span style={{ position: 'absolute', left: '10px', color: 'var(--cream-text-secondary)' }}>
                  <Search size={14} strokeWidth={1.5} />
                </span>
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Search transcript..."
                  style={{
                    width: '100%',
                    backgroundColor: 'var(--cream-surface)',
                    border: '1px solid var(--cream-panel-border)',
                    borderRadius: '8px',
                    padding: '8px 10px 8px 32px',
                    fontSize: '12px',
                    color: 'var(--cream-text-primary)',
                    outline: 'none'
                  }}
                />
                <button
                  onClick={() => setFilterFavorites(!filterFavorites)}
                  style={{
                    position: 'absolute',
                    right: '10px',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: filterFavorites ? 'var(--cream-accent)' : 'var(--cream-text-secondary)'
                  }}
                >
                  <Star size={14} strokeWidth={1.5} />
                </button>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px' }}>
                <button onClick={() => setShowSrtModal(true)} style={{ background: 'none', border: 'none', color: 'var(--cream-accent)', cursor: 'pointer', textDecoration: 'underline' }}>
                  <Upload size={12} strokeWidth={1.5} style={{ marginRight: '4px' }} />
                  Import SRT
                </button>
                <button onClick={handleDownloadSrt} style={{ background: 'none', border: 'none', color: 'var(--cream-accent)', cursor: 'pointer', textDecoration: 'underline' }}>
                  <Download size={12} strokeWidth={1.5} style={{ marginRight: '4px' }} />
                  Download SRT
                </button>
              </div>
            </div>

            {/* Scrollable list of transcript lines */}
            <div style={{ flex: 1, padding: '16px', overflowY: 'auto', display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'baseline' }}>
              {activeTranscript.map((w, idx) => {
                const isActive = currentTime >= w.startTime && currentTime <= w.endTime
                const matchesSearch = searchTerm ? w.word.toLowerCase().includes(searchTerm.toLowerCase()) : true
                const matchesFav = filterFavorites ? w.favorite : true

                if (!matchesSearch || !matchesFav) return null

                // Show mini timestamp badge every 5 words
                const showBadge = idx % 5 === 0

                return (
                  <span key={w.id} style={{ display: 'inline-flex', alignItems: 'baseline', gap: '4px' }}>
                    {showBadge && (
                      <span
                        onClick={() => seekTo(w.startTime)}
                        style={{
                          fontSize: '9px',
                          backgroundColor: 'var(--cream-surface)',
                          color: 'var(--cream-text-secondary)',
                          padding: '1px 4px',
                          borderRadius: '4px',
                          cursor: 'pointer',
                          fontWeight: '600',
                          whiteSpace: 'nowrap'
                        }}
                      >
                        {w.startTime.toFixed(2)}s
                      </span>
                    )}
                    <span
                      onClick={() => handleWordClick(w)}
                      onContextMenu={(e) => {
                        e.preventDefault()
                        toggleWordFavorite(w.id)
                        triggerToast('success', 'Favorite toggled')
                      }}
                      style={{
                        fontSize: '13px',
                        color: w.deleted ? 'var(--cream-placeholder)' : isActive ? 'var(--cream-accent)' : 'var(--cream-text-primary)',
                        backgroundColor: isActive ? 'color-mix(in srgb, var(--cream-accent) 20%, transparent)' : 'transparent',
                        fontWeight: isActive ? '800' : '400',
                        padding: '1px 3px',
                        borderRadius: '3px',
                        cursor: 'pointer',
                        textDecoration: w.deleted ? 'line-through' : 'none'
                      }}
                    >
                      {w.word}
                    </span>
                  </span>
                )
              })}
            </div>
          </aside>
        )}

        {/* PANEL CENTRAL: PREVIEW */}
        <main className="editor-preview">
          {/* Preview settings bar */}
          <div style={{
            height: '42px',
            backgroundColor: 'var(--cream-panel)',
            borderBottom: '1px solid var(--cream-panel-border)',
            padding: '0 16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexShrink: 0
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
              <select
                value={aspectRatio}
                onChange={(e) => setAspectRatio(e.target.value)}
                style={{
                  backgroundColor: 'var(--cream-surface)',
                  border: '1px solid var(--cream-panel-border)',
                  borderRadius: '6px',
                  padding: '4px 8px',
                  fontSize: '12px',
                  color: 'var(--cream-text-primary)',
                  outline: 'none',
                  cursor: 'pointer'
                }}
              >
                <option value="9:16">Vertical 9:16</option>
                <option value="1:1">Square 1:1</option>
                <option value="16:9">Landscape 16:9</option>
                <option value="4:5">Portrait 4:5</option>
              </select>

              <span
                onClick={() => setLayoutMode(layoutMode === 'ajustar' ? 'rellenar' : 'ajustar')}
                style={{ fontSize: '12px', color: 'var(--cream-text-secondary)', cursor: 'pointer' }}
              >
                Layout: <span style={{ textDecoration: 'underline' }}>{layoutMode === 'ajustar' ? 'Fit' : 'Fill'}</span>
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <span style={{ fontSize: '11px', color: 'var(--cream-text-secondary)' }}>Face tracking:</span>
              <button
                onClick={() => setFaceTrackingEnabled(!faceTrackingEnabled)}
                style={{
                  backgroundColor: faceTrackingEnabled ? '#ff1f1f' : 'var(--cream-surface)',
                  color: faceTrackingEnabled ? '#0a0a0a' : 'var(--cream-text-secondary)',
                  border: 'none',
                  borderRadius: '100px',
                  padding: '3px 12px',
                  fontSize: '11px',
                  fontWeight: '800',
                  cursor: 'pointer'
                }}
              >
                {faceTrackingEnabled ? 'ON' : 'OFF'}
              </button>
            </div>
          </div>

          {/* Preview box area */}
          <div className="editor-preview-stage">
            <div
              onMouseMove={handleCanvasMouseMove}
              onMouseUp={handleCanvasMouseUp}
              className="editor-preview-box"
              style={{
                '--preview-ratio': aspectRatio === '9:16' ? '9 / 16' : aspectRatio === '16:9' ? '16 / 9' : aspectRatio === '1:1' ? '1 / 1' : '4 / 5'
              }}
            >
              <video
                ref={videoRef}
                src={displayVideoSrc}
                loop={!isMultiClipMode}
                playsInline
                preload="metadata"
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
                onEnded={() => setIsPlaying(false)}
                onError={(e) => {
                  const originalSrc = e?.currentTarget?.src || displayVideoSrc
                  const normalizedSrc = normalizeVideoUrl(originalSrc)
                  if (normalizedSrc !== originalSrc && !videoError) {
                    setDisplayVideoSrc(normalizedSrc)
                  } else {
                    setVideoError('Unable to load this video')
                  }
                }}
                onTimeUpdate={handleTimeUpdate}
                onLoadedMetadata={() => {
                  if (!isMultiClipMode) {
                    if (videoRef.current?.duration) setDuration(videoRef.current.duration)
                  }
                  if (pendingSeekRef.current != null) {
                    const ps = pendingSeekRef.current
                    pendingSeekRef.current = null
                    if (videoRef.current) videoRef.current.currentTime = ps
                  }
                  if (isPlaying && videoRef.current) videoRef.current.play().catch(() => {})
                }}
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: layoutMode === 'ajustar' ? 'contain' : 'cover',
                  transform: faceTrackingEnabled ? `scale(${faceTrackingZoom / 100}) translate(${-cropX.current * 0.05}px, ${-cropY.current * 0.05}px)` : 'none'
                }}
              />
              {videoError && (
                <div style={{ position: 'absolute', inset: 0, zIndex: 20, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '10px', padding: '24px', textAlign: 'center', background: 'rgba(255,255,255,0.94)', color: '#0a0a0a' }}>
                  <strong style={{ fontSize: '14px' }}>Couldn&apos;t load video</strong>
                  <span style={{ fontSize: '12px', color: '#666666' }}>The video URL is unavailable or cannot be played.</span>
                  <button
                    onClick={() => {
                      setVideoError(null)
                      setDisplayVideoSrc(normalizeVideoUrl(videoSrc))
                    }}
                    style={{ background: '#ff1f1f', color: '#ffffff', border: 'none', borderRadius: '999px', padding: '8px 16px', fontWeight: '700', cursor: 'pointer' }}
                  >
                    Retry
                  </button>
                </div>
              )}

        {/* Subtitles overlay */}
              <div style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '0 16px',
                pointerEvents: 'none',
                zIndex: 10,
              }}>
  {selectedPresetId !== 'none' && subtitleWords.length > 0 && (
    <div style={{
      position: 'absolute',
      left: '50%',
      top: `${subtitleStyle.positionY}%`,
      transform: 'translate(-50%, -50%)',
      textAlign: 'center',
      width: '100%',
      maxWidth: '92%',
      minHeight: `${(subtitleStyle.fontSize || 22) * (subtitleStyle.lineHeight || 1.3) * 2}px`,
      whiteSpace: 'normal',
      pointerEvents: 'none',
    }}>
      {subtitleStyle.backgroundColor && subtitleStyle.backgroundColor !== 'transparent' && (
        <div style={{
          position: 'absolute',
          inset: 0,
          background: subtitleStyle.backgroundColor,
          borderRadius: `${subtitleStyle.backgroundBorderRadius || 6}px`,
          opacity: (subtitleStyle.backgroundOpacity ?? 0) / 100,
          pointerEvents: 'none',
        }} />
      )}
      <span style={getSubtitleStyle(subtitleWords.map(word => word.word).join(' '), selectedPresetId, subtitleStyle)}>
        {(() => {
          const hc = subtitleStyle.highlightColor || '#ff1f1f'
          const isWbw = wordByWordPresets.includes(selectedPresetId)
          return subtitleWords.map((word, index) => {
            const isPast = currentTime > Number(word.endTime)
            const isActive = currentTime >= Number(word.startTime) - 0.12 && currentTime < Number(word.endTime)
            return (
              <span key={index}>
                {index > 0 ? ' ' : ''}
                <span
                  key={word.id || `${word.word}-${index}`}
                  style={{
                    position: 'relative',
                    display: 'inline-block',
                    color: isWbw ? hc : (isActive ? hc : `${subtitleStyle.color}99`),
                    fontWeight: isWbw ? '900' : (isActive ? '900' : (subtitleStyle.fontWeight || '700')),
                    opacity: isWbw ? 1 : (isActive ? 1 : 0.45),
                    overflowWrap: 'break-word',
                    wordBreak: 'break-word',
                    whiteSpace: 'normal',
                    transition: isWbw ? 'none' : 'color 0.25s ease-out, opacity 0.25s ease-out',
                  }}
                >
                  {word.word}
                </span>
              </span>
            )
          })
        })()}
      </span>
    </div>
  )}
              </div>

              {/* Face Tracker */}
              <canvas
                ref={faceCanvasRef}
                width={360}
                height={640}
                style={{
                  position: 'absolute',
                  inset: 0,
                  width: '100%',
                  height: '100%',
                  pointerEvents: 'none',
                  zIndex: 9
                }}
              />

              {/* Crop visual brackets */}
              <div style={{
                position: 'absolute',
                left: '12px',
                right: '12px',
                top: '24px',
                bottom: '24px',
                pointerEvents: 'none',
                zIndex: 8
              }}>
                <div style={{ position: 'absolute', left: 0, top: 0, width: '16px', height: '16px', borderLeft: '3px solid var(--cream-accent)', borderTop: '3px solid var(--cream-accent)' }} />
                <div style={{ position: 'absolute', right: 0, top: 0, width: '16px', height: '16px', borderRight: '3px solid var(--cream-accent)', borderTop: '3px solid var(--cream-accent)' }} />
                <div style={{ position: 'absolute', left: 0, bottom: 0, width: '16px', height: '16px', borderLeft: '3px solid var(--cream-accent)', borderBottom: '3px solid var(--cream-accent)' }} />
                <div style={{ position: 'absolute', right: 0, bottom: 0, width: '16px', height: '16px', borderRight: '3px solid var(--cream-accent)', borderBottom: '3px solid var(--cream-accent)' }} />
              </div>

              {/* Drag elements */}
              {textOverlays.map((t) => (
                <div
                  key={t.id}
                  onMouseDown={(e) => handleCanvasMouseDown(e, t)}
                  style={{
                    position: 'absolute',
                    left: `${t.x}%`,
                    top: `${t.y}%`,
                    transform: 'translate(-50%, -50%)',
                    color: t.color || '#ffffff',
                    fontSize: `${t.fontSize || 22}px`,
                    fontWeight: '800',
                    cursor: 'move',
                    padding: '3px 8px',
                    borderRadius: '4px',
                    border: selectedTextId === t.id ? '2px solid var(--cream-accent)' : '1px dashed rgba(255,255,255,0.4)',
                    backgroundColor: 'rgba(10,10,10,0.6)',
                    zIndex: 15,
                    whiteSpace: 'nowrap'
                  }}
                >
                  {t.text}
                </div>
              ))}
            </div>
          </div>
        </main>

        {/* PANEL DERECHO: HERRAMIENTAS (sidebar 40px + contenido 280px) */}
        <aside className={`editor-right-aside ${rightPanelOpen ? 'open' : 'closed'}`}>
          {/* Sidebar vertical de 40px */}
          <div className="editor-right-bar" style={{
            borderRight: rightPanelOpen ? '1px solid var(--cream-panel-border)' : 'none'
          }}>
            {[
              { id: 'presets', label: 'Styles', icon: <Palette size={18} strokeWidth={1.5} /> },
              { id: 'subtitles', label: 'Subtitles', icon: <Captions size={18} strokeWidth={1.5} /> },
              { id: 'ai', label: 'AI Tools', icon: <Wand2 size={18} strokeWidth={1.5} /> },
              { id: 'multimedia', label: 'Media', icon: <Layers size={18} strokeWidth={1.5} /> },
              { id: 'brand', label: 'Brand', icon: <Tag size={18} strokeWidth={1.5} /> },
              { id: 'broll', label: 'B-Roll', icon: <Film size={18} strokeWidth={1.5} /> },
              { id: 'transitions', label: 'Transitions', icon: <Shuffle size={18} strokeWidth={1.5} /> },
              { id: 'text', label: 'Text', icon: <AlignLeft size={18} strokeWidth={1.5} /> },
              { id: 'audio', label: 'Audio', icon: <Music size={18} strokeWidth={1.5} /> },
              { id: 'hook', label: 'Hook', icon: <Anchor size={18} strokeWidth={1.5} /> }
            ].map(tab => {
              const isActive = rightPanelOpen && activeRightTab === tab.id
              return (
                <button
                  key={tab.id}
                  onClick={() => {
                    setActiveRightTab(tab.id)
                    setRightPanelOpen(true)
                  }}
                  style={{
                    background: 'none',
                    border: 'none',
                    width: '32px',
                    height: '32px',
                    borderRadius: '6px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    color: isActive ? 'var(--cream-accent)' : 'var(--cream-text-secondary)',
                    backgroundColor: isActive ? 'var(--cream-surface)' : 'transparent',
                    borderLeft: isActive ? '2px solid var(--cream-accent)' : 'none'
                  }}
                  title={tab.label}
                >
                  {tab.icon}
                </button>
              )
            })}
          </div>

          {/* Panel de Contenido */}
          {rightPanelOpen && (
            <div className="editor-right-content">
              
              {/* Estilos — incluye presets, tipografía y efectos */}
              {activeRightTab === 'presets' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  {/* No captions */}
                  <button
                    type="button"
                    onClick={() => applyPreset(SUBTITLE_PRESETS[0])}
                    style={{
                      background: selectedPresetId === 'none' ? 'var(--cream-accent)' : 'var(--cream-surface)',
                      color: selectedPresetId === 'none' ? '#ffffff' : 'var(--cream-text-primary)',
                      border: selectedPresetId === 'none' ? '2px solid var(--cream-accent)' : '1px solid var(--cream-panel-border)',
                      borderRadius: '10px',
                      padding: '10px 0',
                      fontWeight: '800',
                      fontSize: '13px',
                      cursor: 'pointer',
                      textAlign: 'center',
                      transition: 'background 0.15s, border-color 0.15s',
                    }}
                  >
                    No captions
                  </button>

                  {PRESET_CATEGORIES.map(category => {
                    const catPresets = SUBTITLE_PRESETS.filter(p => p.cat === category.id)
                    if (!catPresets.length) return null
                    return (
                      <div key={category.id}>
                        <h4 style={{ fontSize: '12px', fontWeight: '800', color: 'var(--cream-text-secondary)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                          {category.name}
                        </h4>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                          {catPresets.map(preset => {
                            const isSelected = selectedPresetId === preset.id
                            const previewBg = preset.backgroundColor && !preset.backgroundColor.startsWith('linear-gradient')
                              ? preset.backgroundColor
                              : '#f8f8f5'
                            const previewColor = preset.color === 'transparent' ? '#ff1f1f' : (preset.color || '#ffffff')
                            return (
                              <button
                                key={preset.id}
                                type="button"
                                onClick={() => applyPreset(preset)}
                                style={{
                                  background: 'var(--cream-surface)',
                                  border: isSelected ? '2px solid var(--cream-accent)' : '1px solid var(--cream-panel-border)',
                                  borderRadius: '8px',
                                  padding: '8px',
                                  cursor: 'pointer',
                                  textAlign: 'center',
                                  transition: 'border-color 0.15s, box-shadow 0.15s',
                                  outline: 'none',
                                }}
                                onFocus={e => e.currentTarget.style.boxShadow = isSelected ? '0 0 0 2px var(--cream-accent)' : '0 0 0 2px var(--cream-focus-border)'}
                                onBlur={e => e.currentTarget.style.boxShadow = 'none'}
                              >
                                <div style={{
                                  height: '44px',
                                  background: preset.isNone ? '#f8f8f5' : previewBg,
                                  borderRadius: '4px',
                                  marginBottom: '5px',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  overflow: 'hidden',
                                }}>
                                  <span style={{
                                    color: preset.isNone ? '#9ca3af' : previewColor,
                                    fontFamily: preset.fontFamily || 'Inter',
                                    fontSize: '13px',
                                    fontWeight: preset.fontWeight || '800',
                                    fontStyle: preset.fontStyle || 'normal',
                                    letterSpacing: '0.3px',
                                    textTransform: preset.textTransform || 'none',
                                    WebkitTextStroke: preset.stroke ? `${Math.min(preset.strokeWidth || 1, 2)}px ${preset.strokeColor || '#000000'}` : '0 transparent',
                                    textShadow: preset.shadow ? `1px 1px ${preset.shadowColor || '#000000'}` : 'none',
                                    lineHeight: 1.2,
                                  }}>
                                    {preset.isNone ? '—' : 'Hello'}
                                  </span>
                                </div>
                                <span style={{ fontSize: '11px', fontWeight: '700', color: 'var(--cream-text-primary)' }}>
                                  {preset.name}
                                </span>
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    )
                  })}

                  <div style={{ borderTop: '1px solid var(--cream-panel-border)', paddingTop: '12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                      <h4 style={{ fontSize: '13px', fontWeight: '800', margin: 0 }}>Typography</h4>
                      <button
                        type="button"
                        onClick={() => {
                          const current = SUBTITLE_PRESETS.find(p => p.id === selectedPresetId)
                          if (current && !current.isNone) applyPreset(current)
                        }}
                        style={{
                          background: 'transparent',
                          border: '1px solid var(--cream-panel-border)',
                          borderRadius: '6px',
                          padding: '4px 10px',
                          fontSize: '10px',
                          fontWeight: '700',
                          color: 'var(--cream-text-secondary)',
                          cursor: 'pointer',
                        }}
                      >
                        Reset to preset
                      </button>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      <div>
                        <label style={{ fontSize: '10px', color: 'var(--cream-text-secondary)' }}>Font</label>
                        <select value={subtitleStyle.fontFamily} onChange={(e) => setSubtitleStyle({ ...subtitleStyle, fontFamily: e.target.value })} style={{ width: '100%', backgroundColor: 'var(--cream-surface)', border: '1px solid var(--cream-panel-border)', borderRadius: '6px', padding: '6px', fontSize: '12px', color: 'var(--cream-text-primary)' }}>
                          {FONTS.map(f => <option key={f} value={f}>{f}</option>)}
                        </select>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                        <div>
                          <label style={{ fontSize: '10px', color: 'var(--cream-text-secondary)' }}>Size ({subtitleStyle.fontSize}px)</label>
                          <input type="range" min="12" max="72" value={subtitleStyle.fontSize} onChange={(e) => setSubtitleStyle({ ...subtitleStyle, fontSize: parseInt(e.target.value) })} style={{ width: '100%' }} />
                        </div>
                        <div>
                          <label style={{ fontSize: '10px', color: 'var(--cream-text-secondary)' }}>Weight</label>
                          <select value={subtitleStyle.fontWeight} onChange={(e) => setSubtitleStyle({ ...subtitleStyle, fontWeight: e.target.value })} style={{ width: '100%', backgroundColor: 'var(--cream-surface)', border: '1px solid var(--cream-panel-border)', borderRadius: '6px', padding: '6px', fontSize: '11px', color: 'var(--cream-text-primary)' }}>
                            {['300', '400', '500', '600', '700', '800', '900'].map(w => <option key={w} value={w}>{w}</option>)}
                          </select>
                        </div>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                        <div>
                          <label style={{ fontSize: '10px', color: 'var(--cream-text-secondary)' }}>Style</label>
                          <select value={subtitleStyle.fontStyle || 'normal'} onChange={(e) => setSubtitleStyle({ ...subtitleStyle, fontStyle: e.target.value })} style={{ width: '100%', backgroundColor: 'var(--cream-surface)', border: '1px solid var(--cream-panel-border)', borderRadius: '6px', padding: '6px', fontSize: '11px', color: 'var(--cream-text-primary)' }}>
                            <option value="normal">Normal</option>
                            <option value="italic">Italic</option>
                          </select>
                        </div>
                        <div>
                          <label style={{ fontSize: '10px', color: 'var(--cream-text-secondary)' }}>Transform</label>
                          <select value={subtitleStyle.textTransform || 'none'} onChange={(e) => setSubtitleStyle({ ...subtitleStyle, textTransform: e.target.value })} style={{ width: '100%', backgroundColor: 'var(--cream-surface)', border: '1px solid var(--cream-panel-border)', borderRadius: '6px', padding: '6px', fontSize: '11px', color: 'var(--cream-text-primary)' }}>
                            <option value="none">None</option>
                            <option value="uppercase">UPPERCASE</option>
                            <option value="lowercase">lowercase</option>
                            <option value="capitalize">Capitalize</option>
                          </select>
                        </div>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                        <div>
                          <label style={{ fontSize: '10px', color: 'var(--cream-text-secondary)' }}>Align</label>
                          <select value={subtitleStyle.textAlign || 'center'} onChange={(e) => setSubtitleStyle({ ...subtitleStyle, textAlign: e.target.value })} style={{ width: '100%', backgroundColor: 'var(--cream-surface)', border: '1px solid var(--cream-panel-border)', borderRadius: '6px', padding: '6px', fontSize: '11px', color: 'var(--cream-text-primary)' }}>
                            <option value="left">Left</option>
                            <option value="center">Center</option>
                            <option value="right">Right</option>
                          </select>
                        </div>
                        <div>
                          <label style={{ fontSize: '10px', color: 'var(--cream-text-secondary)' }}>Spacing ({subtitleStyle.letterSpacing}px)</label>
                          <input type="range" min="0" max="8" step="0.5" value={subtitleStyle.letterSpacing || 0} onChange={(e) => setSubtitleStyle({ ...subtitleStyle, letterSpacing: parseFloat(e.target.value) })} style={{ width: '100%' }} />
                        </div>
                      </div>
                      <div>
                        <label style={{ fontSize: '10px', color: 'var(--cream-text-secondary)' }}>Line height ({subtitleStyle.lineHeight})</label>
                        <input type="range" min="0.8" max="2.0" step="0.1" value={subtitleStyle.lineHeight || 1.2} onChange={(e) => setSubtitleStyle({ ...subtitleStyle, lineHeight: parseFloat(e.target.value) })} style={{ width: '100%' }} />
                      </div>
                      <div>
                        <label style={{ fontSize: '10px', color: 'var(--cream-text-secondary)' }}>Max width ({subtitleStyle.maxWidth}%)</label>
                        <input type="range" min="50" max="100" value={subtitleStyle.maxWidth || 85} onChange={(e) => setSubtitleStyle({ ...subtitleStyle, maxWidth: parseInt(e.target.value) })} style={{ width: '100%' }} />
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                        <div>
                          <label style={{ fontSize: '10px', color: 'var(--cream-text-secondary)' }}>Text color</label>
                          <input type="color" value={subtitleStyle.color} onChange={(e) => setSubtitleStyle({ ...subtitleStyle, color: e.target.value })} style={{ width: '100%', height: '30px', border: 'none', cursor: 'pointer' }} />
                        </div>
                        <div>
                          <label style={{ fontSize: '10px', color: 'var(--cream-text-secondary)' }}>Position Y ({subtitleStyle.positionY}%)</label>
                          <input type="range" min="5" max="95" value={subtitleStyle.positionY} onChange={(e) => setSubtitleStyle({ ...subtitleStyle, positionY: parseInt(e.target.value) })} style={{ width: '100%' }} />
                        </div>
                      </div>
                    </div>
                  </div>

                  <div style={{ borderTop: '1px solid var(--cream-panel-border)', paddingTop: '12px' }}>
                    <h4 style={{ fontSize: '13px', fontWeight: '800', marginBottom: '10px' }}>Effects</h4>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {/* Stroke section */}
                      <div>
                        <label style={{ fontSize: '10px', color: 'var(--cream-text-secondary)', display: 'block', marginBottom: '2px' }}>Stroke</label>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                          <div>
                            <input type="range" min="0" max="10" step="0.5" value={subtitleStyle.strokeWidth} onChange={(e) => setSubtitleStyle({ ...subtitleStyle, strokeWidth: parseFloat(e.target.value), stroke: parseFloat(e.target.value) > 0 })} style={{ width: '100%' }} />
                            <span style={{ fontSize: '9px', color: 'var(--cream-text-secondary)' }}>{subtitleStyle.strokeWidth}px</span>
                          </div>
                          <input type="color" value={subtitleStyle.strokeColor} onChange={(e) => setSubtitleStyle({ ...subtitleStyle, strokeColor: e.target.value })} style={{ width: '100%', height: '28px', border: 'none', cursor: 'pointer' }} />
                        </div>
                      </div>
                      {/* Background section */}
                      <div>
                        <label style={{ fontSize: '10px', color: 'var(--cream-text-secondary)', display: 'block', marginBottom: '2px' }}>Background</label>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                          <input type="color" value={subtitleStyle.backgroundColor === 'transparent' ? '#000000' : subtitleStyle.backgroundColor} onChange={(e) => setSubtitleStyle({ ...subtitleStyle, backgroundColor: e.target.value })} style={{ width: '100%', height: '28px', border: 'none', cursor: 'pointer' }} />
                          <div>
                            <label style={{ fontSize: '9px', color: 'var(--cream-text-secondary)' }}>Opacity {subtitleStyle.backgroundOpacity}%</label>
                            <input type="range" min="0" max="100" value={subtitleStyle.backgroundOpacity} onChange={(e) => setSubtitleStyle({ ...subtitleStyle, backgroundOpacity: parseInt(e.target.value) })} style={{ width: '100%' }} />
                          </div>
                        </div>
                        <div style={{ marginTop: '4px' }}>
                          <label style={{ fontSize: '9px', color: 'var(--cream-text-secondary)' }}>Radius {subtitleStyle.backgroundBorderRadius}px</label>
                          <input type="range" min="0" max="24" value={subtitleStyle.backgroundBorderRadius || 6} onChange={(e) => setSubtitleStyle({ ...subtitleStyle, backgroundBorderRadius: parseInt(e.target.value) })} style={{ width: '100%' }} />
                        </div>
                      </div>
                      {/* Shadow section */}
                      <div>
                        <label style={{ fontSize: '10px', color: 'var(--cream-text-secondary)', display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                          <input type="checkbox" checked={subtitleStyle.shadow || false} onChange={(e) => setSubtitleStyle({ ...subtitleStyle, shadow: e.target.checked })} />
                          Shadow
                        </label>
                        {subtitleStyle.shadow && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '4px' }}>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                              <input type="color" value={subtitleStyle.shadowColor || '#000000'} onChange={(e) => setSubtitleStyle({ ...subtitleStyle, shadowColor: e.target.value })} style={{ width: '100%', height: '26px', border: 'none', cursor: 'pointer' }} />
                              <div>
                                <label style={{ fontSize: '9px', color: 'var(--cream-text-secondary)' }}>Blur {subtitleStyle.shadowBlur}px</label>
                                <input type="range" min="0" max="20" value={subtitleStyle.shadowBlur || 4} onChange={(e) => setSubtitleStyle({ ...subtitleStyle, shadowBlur: parseInt(e.target.value) })} style={{ width: '100%' }} />
                              </div>
                            </div>
                            <div>
                              <label style={{ fontSize: '9px', color: 'var(--cream-text-secondary)' }}>Offset Y {subtitleStyle.shadowOffsetY}px</label>
                              <input type="range" min="0" max="10" value={subtitleStyle.shadowOffsetY || 2} onChange={(e) => setSubtitleStyle({ ...subtitleStyle, shadowOffsetY: parseInt(e.target.value) })} style={{ width: '100%' }} />
                            </div>
                          </div>
                        )}
                      </div>
                      {/* Highlight color — contextual for word-by-word */}  
                      {wordByWordPresets.includes(selectedPresetId) && (
                        <div style={{ borderTop: '1px solid var(--cream-panel-border)', paddingTop: '8px' }}>
                          <label style={{ fontSize: '10px', color: 'var(--cream-text-secondary)', display: 'block', marginBottom: '2px' }}>Active word color</label>
                          <input type="color" value={subtitleStyle.highlightColor || '#ff1f1f'} onChange={(e) => setSubtitleStyle({ ...subtitleStyle, highlightColor: e.target.value, karaokeHighlight: true })} style={{ width: '100%', height: '30px', border: 'none', cursor: 'pointer' }} />
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Subtítulos */}
              {activeRightTab === 'subtitles' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <h3 style={{ fontSize: '15px', fontWeight: '800' }}>Subtitle editor</h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '350px', overflowY: 'auto' }}>
                    {activeTranscript.map(w => (
                      <div key={w.id} style={{ display: 'flex', alignItems: 'center', gap: '6px', backgroundColor: 'var(--cream-surface)', padding: '6px', borderRadius: '6px' }}>
                        <span style={{ fontSize: '10px', color: 'var(--cream-text-secondary)' }}>{w.startTime.toFixed(1)}s</span>
                        <input
                          type="text" value={w.word}
                          onChange={(e) => handleWordTextEdit(w.id, e.target.value)}
                          style={{ flex: 1, backgroundColor: 'var(--cream-bg)', border: 'none', color: 'var(--cream-text-primary)', fontSize: '12px', padding: '3px 6px', borderRadius: '4px' }}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* IA Tools */}
              {activeRightTab === 'ai' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <h3 style={{ fontSize: '15px', fontWeight: '800' }}>Enhance with AI</h3>
                  {[
                    { label: 'Enhance audio with AI', fn: () => { setAudioCleanActive(true); triggerToast('success', 'Audio filtered') } },
                    { label: 'Translate automatically', fn: () => handleLanguageChange('translated') },
                    { label: 'Detect viral moments', fn: () => triggerToast('success', '3 viral moments identified!') },
                    { label: 'Generate hook with AI', fn: () => triggerToast('success', 'Hook created') }
                  ].map((btn, idx) => (
                    <button
                      key={idx} onClick={btn.fn}
                      style={{ backgroundColor: 'var(--cream-surface)', color: 'var(--cream-text-primary)', border: '1px solid var(--cream-panel-border)', borderRadius: '8px', padding: '12px', fontSize: '12px', fontWeight: '700', cursor: 'pointer', textAlign: 'left' }}
                    >
                      {btn.label}
                    </button>
                  ))}
                </div>
              )}

              {/* Multimedia */}
              {activeRightTab === 'multimedia' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <h3 style={{ fontSize: '15px', fontWeight: '800' }}>Files</h3>
                  <div style={{ padding: '20px', border: '2.5px dashed var(--cream-panel-border)', borderRadius: '8px', textAlign: 'center', fontSize: '11px', color: 'var(--cream-text-secondary)' }}>
                    Drop your media files here
                  </div>
                </div>
              )}

              {/* Marca */}
              {activeRightTab === 'brand' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <h3 style={{ fontSize: '15px', fontWeight: '800' }}>Brand Template</h3>
                  <div>
                    <label style={{ fontSize: '10px', color: 'var(--cream-text-secondary)' }}>Primary logo color</label>
                    <input
                      type="color" value={brandColorPrimary}
                      onChange={(e) => setBrandColorPrimary(e.target.value)}
                      style={{ width: '100%', height: '30px', border: 'none', cursor: 'pointer' }}
                    />
                  </div>
                </div>
              )}

              {/* B-Roll */}
              {activeRightTab === 'broll' && (
                <div>
                  <h3 style={{ fontSize: '15px', fontWeight: '800', marginBottom: '10px' }}>B-Roll clips</h3>
                  <input
                    type="text" placeholder="Search Pexels..."
                    value={brollSearch} onChange={(e) => setBrollSearch(e.target.value)}
                    style={{ width: '100%', backgroundColor: 'var(--cream-surface)', border: 'none', color: 'var(--cream-text-primary)', borderRadius: '6px', padding: '8px', fontSize: '12px', marginBottom: '10px' }}
                  />
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {brollResults.map(r => (
                      <div
                        key={r.id}
                        onClick={() => {
                          setTimelineItems([...timelineItems, {
                            id: `broll-${Date.now()}`,
                            track: 'video',
                            start: currentTime,
                            duration: 5,
                            title: r.title,
                            color: '#166534',
                            type: 'broll'
                          }])
                          triggerToast('success', 'B-Roll added to timeline')
                        }}
                        style={{ display: 'flex', gap: '8px', backgroundColor: 'var(--cream-surface)', padding: '6px', borderRadius: '6px', cursor: 'pointer' }}
                      >
                        <img src={r.url} alt="br" style={{ width: '50px', height: '35px', objectFit: 'cover', borderRadius: '4px' }} />
                        <span style={{ fontSize: '11px', fontWeight: '700', alignSelf: 'center' }}>{r.title}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Transiciones */}
              {activeRightTab === 'transitions' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <h3 style={{ fontSize: '15px', fontWeight: '800' }}>Transition effects</h3>
                  {['Smooth zoom', 'Dissolve', 'Slide'].map(t => (
                    <button
                      key={t} onClick={() => triggerToast('success', `Transition: ${t}`)}
                      style={{ backgroundColor: 'var(--cream-surface)', color: 'var(--cream-text-primary)', border: '1px solid var(--cream-panel-border)', padding: '10px', borderRadius: '6px', fontSize: '12px', cursor: 'pointer' }}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              )}

              {/* Texto */}
              {activeRightTab === 'text' && (
                <div>
                  <h3 style={{ fontSize: '15px', fontWeight: '800', marginBottom: '10px' }}>Text layers</h3>
                  <button
                    onClick={() => {
                      const txt = prompt('Text content:')
                      if (txt) {
                        setTextOverlays([...textOverlays, { id: `text-${Date.now()}`, text: txt, x: 50, y: 50, fontSize: 24 }])
                      }
                    }}
                    style={{ width: '100%', backgroundColor: 'var(--cream-accent)', color: 'var(--cream-accent-btn-color)', border: 'none', padding: '10px', borderRadius: '6px', fontWeight: '800', fontSize: '12px', cursor: 'pointer' }}
                  >
                    + Add Text
                  </button>
                </div>
              )}

              {/* Audio */}
              {activeRightTab === 'audio' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <h3 style={{ fontSize: '15px', fontWeight: '800' }}>Sounds</h3>
                  <div>
                    <label style={{ fontSize: '10px', color: 'var(--cream-text-secondary)' }}>Background volume ({musicVolume}%)</label>
                    <input
                      type="range" min="0" max="100"
                      value={musicVolume} onChange={(e) => setMusicVolume(parseInt(e.target.value))}
                      style={{ width: '100%' }}
                    />
                  </div>
                </div>
              )}

              {/* Gancho */}
              {activeRightTab === 'hook' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <h3 style={{ fontSize: '15px', fontWeight: '800' }}>Viral hooks</h3>
                  {VIRAL_HOOKS.map((hook, idx) => (
                    <div key={idx} style={{ backgroundColor: 'var(--cream-surface)', padding: '10px', borderRadius: '6px' }}>
                      <div style={{ fontSize: '12px', fontWeight: '700', marginBottom: '4px' }}>{hook.title}</div>
                      <button
                        onClick={() => {
                          setTextOverlays([...textOverlays, { id: `hook-${Date.now()}`, text: hook.text, x: 50, y: 30, fontSize: 24 }])
                          triggerToast('success', 'Hook inserted')
                        }}
                        style={{ backgroundColor: 'var(--cream-accent)', color: 'var(--cream-accent-btn-color)', border: 'none', borderRadius: '4px', padding: '3px 8px', fontSize: '10px', fontWeight: '800', cursor: 'pointer' }}
                      >
                        Apply at start
                      </button>
                    </div>
                  ))}
                </div>
              )}

            </div>
          )}
        </aside>
      </div>

      {/* --- TIMELINE (fluid height, bg-zinc-950 border-t border-zinc-800) --- */}
      <footer
        className="editor-timeline"
        onMouseMove={handleTimelineMouseMove}
        onMouseUp={handleTimelineMouseUp}
        style={{
          position: 'relative',
          userSelect: 'none'
        }}
      >
        {/* Toolbar */}
        <div style={{
          height: '36px',
          backgroundColor: 'var(--cream-panel)',
          borderBottom: '1px solid var(--cream-panel-border)',
          padding: '0 16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexShrink: 0,
          background: '#ffffff',
          borderBottom: '1px solid #e5e5e0',
          minHeight: '44px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <button onClick={handleSplitClip} style={{ background: '#f8f8f5', color: '#0a0a0a', border: '1px solid #e5e5e0', borderRadius: '8px', padding: '4px 10px', fontSize: '11px', fontWeight: '700', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', transition: 'all 0.15s' }}>
              <Scissors size={12} strokeWidth={1.5} />
              Split
            </button>
            <button onClick={handleDeleteSelectedTimelineItem} style={{ background: 'rgba(255,31,31,0.1)', color: '#ff1f1f', border: '1px solid rgba(255,31,31,0.3)', borderRadius: '8px', padding: '4px 10px', fontSize: '11px', fontWeight: '700', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <Trash2 size={12} strokeWidth={1.5} />
              Delete
            </button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <button onClick={() => seekTo(currentTime - 2)} style={{ background: 'none', border: 'none', color: '#71717a', cursor: 'pointer', display: 'flex', padding: '4px', transition: 'color 0.15s' }}>
              <SkipBack size={16} strokeWidth={1.5} />
            </button>
            <button onClick={togglePlay} style={{ width: '32px', height: '32px', borderRadius: '50%', backgroundColor: '#ff1f1f', color: '#ffffff', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: isPlaying ? '0 0 20px rgba(255,31,31,0.3)' : 'none', transition: 'all 0.15s' }}>
              {isPlaying ? <Pause size={16} fill="currentColor" strokeWidth={0} /> : <Play size={16} fill="currentColor" strokeWidth={0} />}
            </button>
            <button onClick={() => seekTo(currentTime + 2)} style={{ background: 'none', border: 'none', color: '#71717a', cursor: 'pointer', display: 'flex', padding: '4px', transition: 'color 0.15s' }}>
              <SkipForward size={16} strokeWidth={1.5} />
            </button>
            <span style={{ fontSize: '12px', fontWeight: '700', color: '#0a0a0a', fontFamily: 'monospace', background: '#f8f8f5', padding: '2px 8px', borderRadius: '4px' }}>
              {new Date(currentTime * 1000).toISOString().substr(14, 5)}
              <span style={{ color: '#9ca3af', fontWeight: '400' }}>
                {' / '}{new Date(duration * 1000).toISOString().substr(14, 5)}
              </span>
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <ZoomIn size={12} strokeWidth={1.5} style={{ color: '#9ca3af' }} />
              <input type="range" min="10" max="100" value={timelineZoom} onChange={(e) => setTimelineZoom(parseInt(e.target.value))} style={{ width: '60px', accentColor: '#ff1f1f' }} />
            </div>
          </div>
        </div>

        {/* Tracks */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#ffffff' }}>

          {/* Playhead line that spans all tracks */}
          <div style={{ position: 'relative', flex: 1 }}>
            <div className="timeline-scroll" style={{ position: 'absolute', inset: 0, overflowY: 'hidden', overflowX: 'auto' }}>
              <div style={{ position: 'relative', minHeight: '100%', display: 'flex', flexDirection: 'column' }}>
                {/* VIDEO track */}
                <div style={{ display: 'flex', alignItems: 'center', borderBottom: '1px solid #e5e5e0', minHeight: '48px' }}>
                  <span style={{ width: '52px', flexShrink: 0, textAlign: 'right', paddingRight: '8px', fontSize: '9px', fontWeight: '700', color: '#71717a', letterSpacing: '0.5px', textTransform: 'uppercase' }}>Video</span>
                  <div ref={timelineRef} onClick={handleTimelineClick} style={{ flex: 1, height: '48px', position: 'relative', cursor: 'pointer', background: '#f8f8f5' }}>
                    {isMultiClipMode ? (
                      videoItems.map(item => {
                        const isSel = selectedTimelineItemId === item.id
                        const isCur = activeVideoItemId === item.id
                        const startPct = duration > 0 ? (item.start / duration) * 100 : 0
                        const widthPct = duration > 0 ? (item.duration / duration) * 100 : 0
                        const color = RANK_CLIP_COLORS[(item.rank - 1) % RANK_CLIP_COLORS.length]
                        return (
                          <div
                            key={item.id}
                            onMouseDown={(e) => handleTimelineMouseDown(e, item, 'move')}
                            onClick={(e) => e.stopPropagation()}
                            title={`#${item.rank} ${item.title.replace(/^#\d+ /, '')} — ${Math.round(item.duration)}s`}
                            style={{
                              position: 'absolute', top: '5px', bottom: '5px',
                              left: `${startPct}%`, width: `${Math.max(widthPct, 1)}%`,
                              borderRadius: '6px', cursor: 'grab', overflow: 'hidden',
                              background: isCur
                                ? `linear-gradient(180deg, ${color}, ${color}66)`
                                : `linear-gradient(180deg, ${color}cc, ${color}55)`,
                              border: `1px solid ${isSel ? '#0a0a0a' : color}88`,
                              boxShadow: isCur ? `0 0 10px ${color}44` : 'none',
                              zIndex: 5, display: 'flex', alignItems: 'center', padding: '0 6px',
                              transition: 'all 0.1s',
                            }}
                          >
                            {item.thumb && (
                              <img src={item.thumb} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', opacity: 0.35, pointerEvents: 'none' }} />
                            )}
                            <span style={{ position: 'relative', fontSize: '9px', fontWeight: '800', color: '#0a0a0a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: 1.1, textShadow: '0 1px 2px rgba(255,255,255,0.5)' }}>
                              #{item.rank}
                            </span>
                            <div
                              onMouseDown={(e) => { e.stopPropagation(); handleTimelineMouseDown(e, item, 'resize-left') }}
                              style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: '8px', cursor: 'ew-resize', background: 'rgba(0,0,0,0.15)', borderRight: '1px solid rgba(0,0,0,0.2)' }}
                            />
                            <div
                              onMouseDown={(e) => { e.stopPropagation(); handleTimelineMouseDown(e, item, 'resize-right') }}
                              style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: '8px', cursor: 'ew-resize', background: 'rgba(0,0,0,0.15)', borderLeft: '1px solid rgba(0,0,0,0.2)' }}
                            />
                          </div>
                        )
                      })
                    ) : (
                      <div style={{ position: 'absolute', top: '6px', bottom: '6px', left: 0, right: 0, background: '#ffffff', borderRadius: '6px', border: '1px solid #e5e5e0', display: 'flex', alignItems: 'center', padding: '0 8px', overflow: 'hidden' }}>
                        <div style={{ display: 'flex', gap: '1px', height: '100%', alignItems: 'center' }}>
                          {Array.from({length: 30}).map((_, i) => (
                            <div key={i} style={{ width: '4px', height: '24px', background: '#d0d0ca', borderRadius: '1px', flexShrink: 0 }} />
                          ))}
                        </div>
                        <span style={{ position: 'absolute', left: '8px', fontSize: '9px', color: '#9ca3af', fontWeight: '600' }}>video.mp4</span>
                      </div>
                    )}
                    {/* Playhead */}
                    <div style={{ position: 'absolute', top: 0, bottom: 0, width: '2px', background: '#ff1f1f', left: `${duration > 0 ? (currentTime / duration) * 100 : 0}%`, zIndex: 20, pointerEvents: 'none', boxShadow: '0 0 8px rgba(255,31,31,0.4)' }}>
                      <div style={{ position: 'absolute', top: '-1px', left: '-4px', width: '10px', height: '10px', background: '#ff1f1f', borderRadius: '50%', boxShadow: '0 0 12px rgba(255,31,31,0.6)' }} />
                    </div>
                  </div>
                </div>

                {/* TEXT track */}
                <div style={{ display: 'flex', alignItems: 'center', borderBottom: '1px solid #e5e5e0', minHeight: '28px' }}>
                  <span style={{ width: '52px', flexShrink: 0, textAlign: 'right', paddingRight: '8px', fontSize: '9px', fontWeight: '700', color: '#71717a', letterSpacing: '0.5px', textTransform: 'uppercase' }}>Text</span>
                  <div style={{ flex: 1, height: '28px', position: 'relative', background: '#f8f8f5', display: 'flex', alignItems: 'center', padding: '0 8px' }}>
                    <span style={{ fontSize: '9px', color: '#9ca3af', fontStyle: 'italic' }}>Add text from the panel</span>
                  </div>
                </div>

                {/* SUBTITLES track */}
                <div style={{ display: 'flex', alignItems: 'center', borderBottom: '1px solid #e5e5e0', minHeight: '36px' }}>
                  <span style={{ width: '52px', flexShrink: 0, textAlign: 'right', paddingRight: '8px', fontSize: '9px', fontWeight: '700', color: '#71717a', letterSpacing: '0.5px', textTransform: 'uppercase' }}>Subs</span>
                  <div style={{ flex: 1, height: '36px', position: 'relative', background: '#ffffff' }}>
                    {timelineItems.filter(x => x.track === 'subtitle').length === 0 && (
                      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '9px', color: '#9ca3af', fontStyle: 'italic' }}>
                        Words from transcript appear here
                      </div>
                    )}
                    {timelineItems.filter(x => x.track === 'subtitle').map((item) => {
                      const isSel = selectedTimelineItemId === item.id
                      const startPct = duration > 0 ? (item.start / duration) * 100 : 0
                      const widthPct = duration > 0 ? (item.duration / duration) * 100 : 0
                      const isCurrent = currentTime >= item.start && currentTime <= item.start + item.duration
                      return (
                        <div key={item.id} onMouseDown={(e) => { e.stopPropagation(); setSelectedTimelineItemId(isSel ? null : item.id) }}
                          style={{
                            position: 'absolute', top: '4px', bottom: '4px',
                            left: `${startPct}%`, width: `${Math.max(widthPct, 0.3)}%`,
                            borderRadius: '4px', cursor: 'pointer', overflow: 'hidden',
                            background: isCurrent ? 'rgba(255,31,31,0.15)' : isSel ? 'rgba(255,31,31,0.15)' : 'rgba(20,20,20,0.8)',
                            border: `1px solid ${isCurrent ? 'rgba(255,31,31,0.4)' : isSel ? 'rgba(255,31,31,0.4)' : '#333'}`,
                            transition: 'all 0.1s',
                            display: 'flex', alignItems: 'center', padding: '0 4px', zIndex: isCurrent ? 10 : 1,
                          }}>
                          <span style={{ fontSize: '8px', color: isCurrent ? '#ff1f1f' : '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: '1.1' }}>
                            {item.title}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </div>

                {/* AUDIO track */}
                <div style={{ display: 'flex', alignItems: 'center', minHeight: '28px' }}>
                  <span style={{ width: '52px', flexShrink: 0, textAlign: 'right', paddingRight: '8px', fontSize: '9px', fontWeight: '700', color: '#71717a', letterSpacing: '0.5px', textTransform: 'uppercase' }}>Audio</span>
                  <div style={{ flex: 1, height: '28px', position: 'relative', background: '#f8f8f5', display: 'flex', alignItems: 'center', padding: '0 8px' }}>
                    <span style={{ fontSize: '9px', color: '#9ca3af', fontStyle: 'italic' }}>Add music from Audio</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </footer>

      {/* --- TRANSLATION MODAL PROGRESS --- */}
      {translatingState && (
        <div style={{
          position: 'fixed',
          inset: 0,
          backgroundColor: 'rgba(10,10,10,0.6)',
          backdropFilter: 'blur(8px)',
          zIndex: 1000,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#ffffff'
        }}>
          <div style={{
            width: '60px',
            height: '60px',
            borderRadius: '50%',
            border: '4px solid color-mix(in srgb, var(--cream-accent) 20%, transparent)',
            borderTop: '4px solid var(--cream-accent)',
            animation: 'spin 1s linear infinite',
            marginBottom: '20px'
          }} />
          <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
          <h3 style={{ fontSize: '18px', fontWeight: '800', marginBottom: '8px' }}>Syncing AI Voice Dubbing</h3>
          <p style={{ fontSize: '13px', color: 'var(--cream-text-secondary)' }}>Translating transcript: {translatingProgress}%</p>
        </div>
      )}

      {/* --- SRT IMPORT MODAL --- */}
      {showSrtModal && (
        <div style={{
          position: 'fixed',
          inset: 0,
          backgroundColor: 'rgba(0,0,0,0.6)',
          backdropFilter: 'blur(6px)',
          zIndex: 500,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}>
          <div style={{
            backgroundColor: 'var(--cream-panel)',
            border: '1px solid var(--cream-panel-border)',
            borderRadius: '20px',
            maxWidth: '500px',
            width: '90vw',
            padding: '28px',
            boxShadow: '0 24px 60px rgba(0,0,0,0.5)'
          }}>
            <h3 style={{ fontSize: '16px', fontWeight: '900', marginBottom: '8px', color: 'var(--cream-text-primary)' }}>Import SRT file</h3>
            <p style={{ fontSize: '12px', color: 'var(--cream-text-secondary)', marginBottom: '14px' }}>Paste the SRT file content to load the words and timings.</p>
            <textarea
              value={srtInputText}
              onChange={(e) => setSrtInputText(e.target.value)}
              placeholder={`1\n00:00:01,000 --> 00:00:04,500\nHello everyone today we are going to see...`}
              style={{
                width: '100%',
                height: '180px',
                backgroundColor: 'var(--cream-bg)',
                border: '1px solid var(--cream-panel-border)',
                borderRadius: '8px',
                padding: '8px 10px 8px 32px',
                fontSize: '12px',
                color: 'var(--cream-text-primary)',
                outline: 'none',
                fontFamily: 'monospace',
                marginBottom: '16px'
              }}
            />
            <div style={{ display: 'flex', gap: '8px' }}>
              <button onClick={() => setShowSrtModal(false)} style={{ flex: 1, backgroundColor: 'var(--cream-surface)', border: '1px solid var(--cream-panel-border)', color: 'var(--cream-text-primary)', borderRadius: '10px', padding: '12px', cursor: 'pointer', fontSize: '12px', fontWeight: '600' }}>Cancel</button>
              <button onClick={handleImportSrt} style={{ flex: 1, backgroundColor: 'var(--cream-accent)', color: 'var(--cream-accent-btn-color)', border: 'none', borderRadius: '10px', padding: '12px', fontWeight: '850', cursor: 'pointer', fontSize: '12px' }}>Import</button>
            </div>
          </div>
        </div>
      )}

      <ExportModal
        show={showExportModal}
        onClose={() => setShowExportModal(false)}
        clipId={clipId}
        videoSrc={exportVideoItem ? exportVideoItem.src : (displayVideoSrc || videoSrc)}
        activeTranscript={activeTranscript}
        subtitleStyle={subtitleStyle}
        trimStart={exportVideoItem ? 0 : trimStart}
        trimEnd={exportVideoItem ? exportVideoItem.duration : effectiveTrimEnd}
        duration={exportVideoItem ? exportVideoItem.duration : duration}
        musicTrack={activeMusicTrack}
        musicVolume={musicVolume}
        subtitleMode={wordByWordPresets.includes(selectedPresetId) ? 'word' : 'phrase'}
      />

      {/* --- TOAST --- */}
      {toast && (
        <div style={{
          position: 'fixed',
          bottom: '24px',
          right: '24px',
          backgroundColor: toast.type === 'success' ? 'var(--cream-accent)' : '#ef4444',
          color: 'var(--cream-accent-btn-color)',
          padding: '12px 24px',
          borderRadius: '10px',
          boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
          zIndex: 500,
          fontSize: '13px',
          fontWeight: '800'
        }}>
          {toast.text}
        </div>
      )}
    </div>

    {/* --- MOBILE EDITOR --- */}
    <div className='editor-mobile-layout'>
      <header className='editor-mobile-header'>
        <button
          className='editor-mobile-back'
          onClick={() => router.back()}
          aria-label='Back to dashboard'
        >
          <ArrowLeft size={22} strokeWidth={1.5} />
        </button>
        <input
          type='text'
          value={clipTitle}
          onChange={(e) => setClipTitle(e.target.value)}
          onBlur={handleSave}
          className='editor-mobile-title-input'
          aria-label='Clip title'
        />
        <button
          className='editor-mobile-save'
          onClick={handleSave}
          disabled={saving}
          aria-label='Save title'
        >
          {saving ? '...' : <Save size={20} strokeWidth={1.5} />}
        </button>
      </header>

      <div className='editor-mobile-video-wrap'>
        <canvas
          ref={mobileSubtitleCanvasRef}
          width={360}
          height={640}
          className='editor-mobile-subtitle-canvas'
        />
        {videoError ? (
          <div className='editor-mobile-video-error'>
            <p className='editor-mobile-error-title'>Couldn&apos;t load video</p>
            <p className='editor-mobile-error-text'>
              The clip file isn&apos;t reachable right now. This usually happens when the upload to storage failed.
            </p>
            {displayVideoSrc && (
              <a
                href={displayVideoSrc}
                target='_blank'
                rel='noopener noreferrer'
                className='editor-mobile-error-link'
              >
                Open original file
              </a>
            )}
            <button
              className='editor-mobile-error-retry'
              onClick={() => {
                setVideoError(null)
                setDisplayVideoSrc(normalizeVideoUrl(videoSrc))
              }}
            >
              Retry
            </button>
          </div>
        ) : (
          <video
            ref={mobileVideoRef}
            src={displayVideoSrc}
            controls
            playsInline
            preload='metadata'
            playbackRate={playbackSpeed}
            className='editor-mobile-video'
            onPlay={() => setMobilePlaying(true)}
            onPause={() => setMobilePlaying(false)}
            onTimeUpdate={handleMobileTimeUpdate}
            onError={(e) => {
              const originalSrc = e?.currentTarget?.src || displayVideoSrc
              const normalizedSrc = normalizeVideoUrl(originalSrc)
              if (normalizedSrc !== originalSrc && !videoError) {
                setDisplayVideoSrc(normalizedSrc)
              } else {
                setVideoError(true)
              }
            }}
            onLoadedMetadata={() => setVideoError(null)}
          />
        )}
      </div>

      <div className='editor-mobile-main'>
        <div className='editor-mobile-tab-content'>
          {mobileTab === 'home' && (
            <div className='editor-mobile-section'>
              <div className='editor-mobile-meta'>
                <span>{formatDuration(duration)}</span>
                <span>{aspectRatio} &bull; {clipDate || 'Just now'}</span>
              </div>
              <button
                className='editor-mobile-play-btn'
                onClick={mobileTogglePlay}
                aria-label={mobilePlaying ? 'Pause' : 'Play'}
              >
                {mobilePlaying ? (
                  <Pause size={28} fill='currentColor' />
                ) : (
                  <Play size={28} fill='currentColor' />
                )}
              </button>
              <button
                className='editor-mobile-btn-primary'
                onClick={() => setShowExportModal(true)}
                disabled={videoError}
              >
                <Download size={18} strokeWidth={1.5} />
                Export
              </button>
            </div>
          )}

          {mobileTab === 'trim' && (
            <div className='editor-mobile-section'>
              <h3 className='editor-mobile-section-title'>Trim clip</h3>
              <div className='editor-mobile-card'>
                <div className='editor-mobile-row-between'>
                  <span className='editor-mobile-label'>Start</span>
                  <span className='editor-mobile-value'>{trimStart.toFixed(2)}s</span>
                </div>
                <input
                  type='range'
                  min={0}
                  max={duration}
                  step={0.1}
                  value={trimStart}
                  onChange={(e) => setTrimStart(Math.min(parseFloat(e.target.value), effectiveTrimEnd - 0.1))}
                  className='editor-mobile-slider'
                />
                <div className='editor-mobile-row-between' style={{ marginTop: '12px' }}>
                  <span className='editor-mobile-label'>End</span>
                  <span className='editor-mobile-value'>{effectiveTrimEnd.toFixed(2)}s</span>
                </div>
                <input
                  type='range'
                  min={0}
                  max={duration}
                  step={0.1}
                  value={effectiveTrimEnd}
                  onChange={(e) => setTrimEnd(Math.max(parseFloat(e.target.value), trimStart + 0.1))}
                  className='editor-mobile-slider'
                />
              </div>

              <div className='editor-mobile-card'>
                <div className='editor-mobile-label' style={{ marginBottom: '10px' }}>Quick length</div>
                <div className='editor-mobile-preset-row'>
                  {[15, 30, 60].map((len) => (
                    <button
                      key={len}
                      className='editor-mobile-chip'
                      onClick={() => handleTrimPreset(len)}
                    >
                      {len}s
                    </button>
                  ))}
                </div>
              </div>

              <div className='editor-mobile-card'>
                <div className='editor-mobile-label' style={{ marginBottom: '10px' }}>Playback speed</div>
                <div className='editor-mobile-preset-row'>
                  {[0.5, 1, 1.5, 2].map((speed) => (
                    <button
                      key={speed}
                      className={`editor-mobile-chip ${playbackSpeed === speed ? 'active' : ''}`}
                      onClick={() => setPlaybackSpeed(speed)}
                    >
                      {speed}x
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {mobileTab === 'subtitles' && (
            <div className='editor-mobile-section'>
              <div className='editor-mobile-section-header'>
                <h3 className='editor-mobile-section-title'>Subtitles</h3>
                <button
                  className='editor-mobile-icon-btn'
                  onClick={handleAddSubtitle}
                  aria-label='Add subtitle'
                >
                  <Plus size={18} strokeWidth={2} />
                </button>
              </div>

              {activeSubtitleId && activeTranscript.find((w) => w.id === activeSubtitleId) && (
                <div className='editor-mobile-card'>
                  <div className='editor-mobile-row-between' style={{ marginBottom: '10px' }}>
                    <span className='editor-mobile-label'>Edit selected</span>
                    <button
                      className='editor-mobile-delete-text'
                      onClick={handleDeleteSubtitle}
                    >
                      <Trash2 size={14} strokeWidth={2} />
                      Delete
                    </button>
                  </div>
                  <textarea
                    value={activeTranscript.find((w) => w.id === activeSubtitleId)?.word || ''}
                    onChange={(e) => handleWordTextEdit(activeSubtitleId, e.target.value)}
                    rows={3}
                    className='editor-mobile-textarea'
                  />
                  <div className='editor-mobile-label' style={{ marginTop: '12px', marginBottom: '8px' }}>Style preset</div>
                  <div className='editor-mobile-preset-grid'>
                    {SUBTITLE_PRESETS.map((preset) => {
                      const isSel = selectedPresetId === preset.id
                      return (
                        <button
                          key={preset.id}
                          className={`editor-mobile-preset-tile ${isSel ? 'active' : ''}`}
                          onClick={() => applyPreset(preset)}
                        >
                          {preset.name}
                        </button>
                      )
                    })}
                  </div>
                  <div className='editor-mobile-label' style={{ marginTop: '12px' }}>Position ({subtitleStyle.positionY}%)</div>
                  <input
                    type='range'
                    min={10}
                    max={90}
                    value={subtitleStyle.positionY}
                    onChange={(e) => setSubtitleStyle({ ...subtitleStyle, positionY: parseInt(e.target.value) })}
                    className='editor-mobile-slider'
                  />
                  <div className='editor-mobile-label' style={{ marginTop: '12px' }}>Font size ({subtitleStyle.fontSize}px)</div>
                  <input
                    type='range'
                    min={12}
                    max={60}
                    value={subtitleStyle.fontSize}
                    onChange={(e) => setSubtitleStyle({ ...subtitleStyle, fontSize: parseInt(e.target.value) })}
                    className='editor-mobile-slider'
                  />
                  <div className='editor-mobile-label' style={{ marginTop: '12px' }}>Font</div>
                  <select
                    value={subtitleStyle.fontFamily}
                    onChange={(e) => setSubtitleStyle({ ...subtitleStyle, fontFamily: e.target.value })}
                    className='editor-mobile-select'
                  >
                    {FONTS.map(f => <option key={f} value={f}>{f}</option>)}
                  </select>
                  <div className='editor-mobile-label' style={{ marginTop: '12px' }}>Text color</div>
                  <input
                    type='color'
                    value={subtitleStyle.color}
                    onChange={(e) => setSubtitleStyle({ ...subtitleStyle, color: e.target.value })}
                    className='editor-mobile-color'
                  />
                  <div className='editor-mobile-label' style={{ marginTop: '12px' }}>Stroke ({subtitleStyle.strokeWidth}px)</div>
                  <input
                    type='range'
                    min={0}
                    max={8}
                    value={subtitleStyle.strokeWidth}
                    onChange={(e) => setSubtitleStyle({ ...subtitleStyle, strokeWidth: parseInt(e.target.value), stroke: parseInt(e.target.value) > 0 })}
                    className='editor-mobile-slider'
                  />
                  <div className='editor-mobile-label' style={{ marginTop: '12px' }}>Outline color</div>
                  <input
                    type='color'
                    value={subtitleStyle.strokeColor}
                    onChange={(e) => setSubtitleStyle({ ...subtitleStyle, strokeColor: e.target.value })}
                    className='editor-mobile-color'
                  />
                </div>
              )}

              <div style={{ display: 'flex', gap: '12px', marginBottom: '12px', fontSize: '12px' }}>
                <button onClick={() => setShowSrtModal(true)} className='editor-mobile-link-btn'>
                  Import SRT
                </button>
                <button onClick={handleDownloadSrt} className='editor-mobile-link-btn'>
                  Download SRT
                </button>
              </div>

              <div className='editor-mobile-list'>
                {activeTranscript.map((w) => (
                  <button
                    key={w.id}
                    className={`editor-mobile-list-item ${activeSubtitleId === w.id ? 'active' : ''} ${w.deleted ? 'deleted' : ''}`}
                        onClick={() => { setSelectedSubtitleId(w.id); setCurrentTime(w.startTime); }}
                  >
                    <span className='editor-mobile-time-badge'>{w.startTime.toFixed(1)}s</span>
                    <span className='editor-mobile-list-text'>{w.deleted ? '[removed]' : w.word}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {mobileTab === 'text' && (
            <div className='editor-mobile-section'>
              <div className='editor-mobile-section-header'>
                <h3 className='editor-mobile-section-title'>Text overlays</h3>
                <button
                  className='editor-mobile-icon-btn'
                  onClick={handleAddTextOverlay}
                  aria-label='Add text overlay'
                >
                  <Plus size={18} strokeWidth={2} />
                </button>
              </div>

              {selectedTextId && textOverlays.find((t) => t.id === selectedTextId) && (
                <div className='editor-mobile-card'>
                  <div className='editor-mobile-row-between' style={{ marginBottom: '10px' }}>
                    <span className='editor-mobile-label'>Edit text</span>
                    <button
                      className='editor-mobile-delete-text'
                      onClick={() => {
                        const next = textOverlays.filter((t) => t.id !== selectedTextId)
                        setTextOverlays(next)
                        setSelectedTextId(null)
                        saveToHistory({ textOverlays: next })
                      }}
                    >
                      <Trash2 size={14} strokeWidth={2} />
                      Delete
                    </button>
                  </div>
                  <input
                    type='text'
                    value={textOverlays.find((t) => t.id === selectedTextId)?.text || ''}
                    onChange={(e) => setTextOverlays(textOverlays.map((t) => t.id === selectedTextId ? { ...t, text: e.target.value } : t))}
                    className='editor-mobile-input'
                  />
                  <div className='editor-mobile-label' style={{ marginTop: '12px' }}>Color</div>
                  <input
                    type='color'
                    value={textOverlays.find((t) => t.id === selectedTextId)?.color || '#ffffff'}
                    onChange={(e) => setTextOverlays(textOverlays.map((t) => t.id === selectedTextId ? { ...t, color: e.target.value } : t))}
                    className='editor-mobile-color-input'
                  />
                  <div className='editor-mobile-label' style={{ marginTop: '12px' }}>Font size ({textOverlays.find((t) => t.id === selectedTextId)?.fontSize || 24}px)</div>
                  <input
                    type='range'
                    min={12}
                    max={80}
                    value={textOverlays.find((t) => t.id === selectedTextId)?.fontSize || 24}
                    onChange={(e) => setTextOverlays(textOverlays.map((t) => t.id === selectedTextId ? { ...t, fontSize: parseInt(e.target.value) } : t))}
                    className='editor-mobile-slider'
                  />
                </div>
              )}

              <div className='editor-mobile-list'>
                {textOverlays.map((t) => (
                  <button
                    key={t.id}
                    className={`editor-mobile-list-item ${selectedTextId === t.id ? 'active' : ''}`}
                    onClick={() => setSelectedTextId(t.id)}
                  >
                    <span className='editor-mobile-list-text' style={{ color: t.color }}>{t.text}</span>
                    <span className='editor-mobile-time-badge'>{t.fontSize}px</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {mobileTab === 'music' && (
            <div className='editor-mobile-section'>
              <h3 className='editor-mobile-section-title'>Music</h3>
              <div className='editor-mobile-card'>
                <div className='editor-mobile-label' style={{ marginBottom: '10px' }}>Background track</div>
                <div className='editor-mobile-list'>
                  {bgMusicList.map((track) => (
                    <button
                      key={track.id}
                      className={`editor-mobile-list-item ${activeMusicTrack === track.id ? 'active' : ''}`}
                      onClick={() => setActiveMusicTrack(track.id)}
                    >
                      <span className='editor-mobile-list-text'>{track.name}</span>
                      <span className='editor-mobile-time-badge'>{track.duration}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div className='editor-mobile-card'>
                <div className='editor-mobile-label'>Music volume ({musicVolume}%)</div>
                <input
                  type='range'
                  min={0}
                  max={100}
                  value={musicVolume}
                  onChange={(e) => setMusicVolume(parseInt(e.target.value))}
                  className='editor-mobile-slider'
                />
              </div>
            </div>
          )}

          {mobileTab === 'export' && (
            <div className='editor-mobile-section'>
              <h3 className='editor-mobile-section-title'>Export</h3>
              <div className='editor-mobile-card'>
                <div className='editor-mobile-label' style={{ marginBottom: '10px' }}>Quality</div>
                <div className='editor-mobile-preset-row'>
                  {['720p', '1080p', '4K'].map((res) => (
                    <button
                      key={res}
                      className={`editor-mobile-chip ${exportResolution === res ? 'active' : ''}`}
                      onClick={() => setExportResolution(res)}
                    >
                      {res}
                    </button>
                  ))}
                </div>
              </div>
              {mobileExportUrl && (
                <div className='editor-mobile-card' style={{ background: 'rgba(34,197,94,0.08)', borderColor: 'rgba(34,197,94,0.3)' }}>
                  <div className='editor-mobile-label' style={{ marginBottom: '8px' }}>Export complete</div>
                  <a
                    href={mobileExportUrl}
                    target='_blank'
                    rel='noopener noreferrer'
                    className='editor-mobile-btn-primary'
                    style={{ textDecoration: 'none' }}
                  >
                    Download video
                  </a>
                </div>
              )}
              <button
                className='editor-mobile-btn-primary'
                onClick={triggerExport}
                disabled={videoError || mobileExporting}
              >
                {mobileExporting ? (
                  'Exporting...'
                ) : (
                  <>
                    <Download size={18} strokeWidth={1.5} />
                    Export now
                  </>
                )}
              </button>
            </div>
          )}
        </div>

        <nav className='editor-mobile-tabs'>
          {[
            { id: 'home', label: 'Home', icon: <Home size={18} strokeWidth={2} /> },
            { id: 'trim', label: 'Trim', icon: <Scissors size={18} strokeWidth={2} /> },
            { id: 'subtitles', label: 'Subtitles', icon: <Captions size={18} strokeWidth={2} /> },
            { id: 'text', label: 'Text', icon: <Type size={18} strokeWidth={2} /> },
            { id: 'music', label: 'Music', icon: <Music size={18} strokeWidth={2} /> },
            { id: 'export', label: 'Export', icon: <Download size={18} strokeWidth={2} /> }
          ].map((tab) => {
            const isActive = mobileTab === tab.id
            return (
              <button
                key={tab.id}
                className={`editor-mobile-tab-btn ${isActive ? 'active' : ''}`}
                onClick={() => setMobileTab(tab.id)}
                aria-label={tab.label}
              >
                {tab.icon}
                <span>{tab.label}</span>
              </button>
            )
          })}
        </nav>
      </div>
    </div>
    </>
  )

  return <ErrorBoundary>{editorContent}</ErrorBoundary>
}
