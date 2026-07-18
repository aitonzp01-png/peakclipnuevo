'use client'
import { create } from 'zustand'
import { defaultSubtitleStyle } from '../../../lib/utils'

const useEditorStore = create((set, get) => ({
  clip: null,
  clipId: null,
  user: null,
  isPlaying: false,
  playheadPos: 0,
  volume: 100,
  playbackSpeed: 1,
  timelineZoom: 1,
  currentTime: 0,
  duration: 0,
  videoError: null,
  videoLoading: true,
  videoLoaded: false,

  trimStart: 0,
  trimEnd: 100,
  aspectRatio: '9:16',

  transcript: [],
  subtitleStyle: { ...defaultSubtitleStyle },
  selectedSubtitlePreset: null,
  subtitleEnabled: true,

  textOverlays: [],
  selectedTextId: null,

  audioLayers: [],
  musicTrack: 'none',
  musicVolume: 30,
  audioCleanEnabled: false,
  originalVolume: 100,

  activeTool: 'ai',
  toolsPanelOpen: false,
  selectedTransition: 'none',
  transitionDuration: 0.3,
  activeFilter: 'none',

  faceTrackingEnabled: true,
  faceTrackingSmoothness: 50,
  faceTrackingZoom: 100,
  showFaceBox: true,
  modelsLoaded: false,
  cropX: 0,
  cropY: 0,

  brandSettings: {
    primaryColor: '#c4ff3d',
    secondaryColor: '#f5f5f0',
    logoUrl: null,
    logoPosition: 'bottom-right',
    logoSize: 50,
    applyToAll: false,
  },

  exportRes: '1080p',
  exportFmt: 'MP4',
  includeSubs: true,
  showExportModal: false,
  saving: false,
  exportStatus: '',
  exportUrl: '',

  trackTimelineZoom: 1,
  timelineHidden: false,
  playheadDragging: false,
  aiPending: {},

  addClipToTimeline: (clipId) => {
    set((state) => ({
      textOverlays: [...state.textOverlays, { id: `broll_${Date.now()}`, text: clipId, x: 50, y: 50, fontSize: 24, color: '#ffffff' }],
    }))
  },

  addMediaTrack: (track) => set((state) => ({
    audioLayers: [...state.audioLayers, { id: Date.now().toString(), ...track }],
  })),

  applyAIEnhance: (toolId) => {
    set((state) => ({ aiPending: { ...state.aiPending, [toolId]: true } }))
    setTimeout(() => {
      set((state) => ({ aiPending: { ...state.aiPending, [toolId]: false } }))
    }, 3000)
  },

  undoStack: [],
  redoStack: [],

  keyboardHint: '',
  loading: true,

  setClip: (clip) => set({ clip }),
  setClipId: (clipId) => set({ clipId }),
  setUser: (user) => set({ user }),
  setIsPlaying: (isPlaying) => set({ isPlaying }),
  setPlayheadPos: (playheadPos) => set({ playheadPos }),
  setVolume: (volume) => set({ volume }),
  setPlaybackSpeed: (speed) => set({ playbackSpeed: speed }),
  setTimelineZoom: (zoom) => set({ timelineZoom: zoom }),
  setCurrentTime: (time) => set({ currentTime: time }),
  setDuration: (duration) => set({ duration }),
  setVideoError: (error) => set({ videoError: error, videoLoading: false, videoLoaded: false }),
  setVideoLoading: (loading) => set({ videoLoading: loading }),
  setVideoLoaded: () => set({ videoLoaded: true, videoLoading: false, videoError: null }),

  setTrimStart: (s) => set({ trimStart: s }),
  setTrimEnd: (e) => set({ trimEnd: e }),
  setAspectRatio: (ratio) => set({ aspectRatio: ratio }),

  setTranscript: (t) => set({ transcript: t }),
  updateWord: (wordId, updates) => set((state) => ({
    transcript: state.transcript.map(w => w.id === wordId ? { ...w, ...updates } : w),
  })),
  toggleWordDeleted: (wordId) => set((state) => ({
    transcript: state.transcript.map(w => w.id === wordId ? { ...w, deleted: !w.deleted } : w),
  })),

  setSubtitleStyle: (style) => set({ subtitleStyle: style }),
  updateSubtitleStyle: (updates) => set((state) => ({
    subtitleStyle: { ...state.subtitleStyle, ...updates },
  })),
  setSelectedSubtitlePreset: (id) => set({ selectedSubtitlePreset: id }),
  setSubtitleEnabled: (v) => set({ subtitleEnabled: v }),

  addTextOverlay: (overlay) => set((state) => ({
    textOverlays: [...state.textOverlays, { id: Date.now().toString(), text: 'Texto', x: 50, y: 50, fontSize: 24, color: '#ffffff', ...overlay }],
  })),
  updateTextOverlay: (id, updates) => set((state) => ({
    textOverlays: state.textOverlays.map(t => t.id === id ? { ...t, ...updates } : t),
  })),
  removeTextOverlay: (id) => set((state) => ({
    textOverlays: state.textOverlays.filter(t => t.id !== id),
    selectedTextId: state.selectedTextId === id ? null : state.selectedTextId,
  })),
  setSelectedTextId: (id) => set({ selectedTextId: id }),

  setMusicTrack: (t) => set({ musicTrack: t }),
  setMusicVolume: (v) => set({ musicVolume: v }),
  setAudioCleanEnabled: (v) => set({ audioCleanEnabled: v }),
  setOriginalVolume: (v) => set({ originalVolume: v }),

  setActiveTool: (tool) => set((state) => ({
    activeTool: tool,
    toolsPanelOpen: state.activeTool === tool ? !state.toolsPanelOpen : true,
  })),
  setToolsPanelOpen: (v) => set({ toolsPanelOpen: v }),
  setSelectedTransition: (t) => set({ selectedTransition: t }),
  setTransitionDuration: (d) => set({ transitionDuration: d }),
  setActiveFilter: (f) => set({ activeFilter: f }),

  setFaceTrackingEnabled: (v) => set({ faceTrackingEnabled: v }),
  setFaceTrackingSmoothness: (v) => set({ faceTrackingSmoothness: v }),
  setFaceTrackingZoom: (v) => set({ faceTrackingZoom: v }),
  setShowFaceBox: (v) => set({ showFaceBox: v }),
  setModelsLoaded: (v) => set({ modelsLoaded: v }),
  setCropX: (v) => set({ cropX: v }),
  setCropY: (v) => set({ cropY: v }),

  setBrandSettings: (s) => set({ brandSettings: { ...get().brandSettings, ...s } }),

  setExportRes: (r) => set({ exportRes: r }),
  setExportFmt: (f) => set({ exportFmt: f }),
  setIncludeSubs: (v) => set({ includeSubs: v }),
  setShowExportModal: (v) => set({ showExportModal: v }),
  setSaving: (v) => set({ saving: v }),
  setExportStatus: (s) => set({ exportStatus: s }),
  setExportUrl: (u) => set({ exportUrl: u }),

  setTrackTimelineZoom: (z) => set({ trackTimelineZoom: z }),
  setTimelineHidden: (v) => set({ timelineHidden: v }),
  setPlayheadDragging: (v) => set({ playheadDragging: v }),

  pushUndo: (snapshot) => set((state) => ({
    undoStack: [...state.undoStack.slice(-49), snapshot],
    redoStack: [],
  })),
  undo: () => {
    const { undoStack, redoStack } = get()
    if (!undoStack.length) return
    const prev = undoStack[undoStack.length - 1]
    const current = {
      transcript: get().transcript,
      subtitleStyle: get().subtitleStyle,
      trimStart: get().trimStart,
      trimEnd: get().trimEnd,
      cropX: get().cropX,
      cropY: get().cropY,
    }
    set((state) => ({
      ...prev,
      undoStack: state.undoStack.slice(0, -1),
      redoStack: [...state.redoStack, current],
    }))
  },
  redo: () => {
    const { undoStack, redoStack } = get()
    if (!redoStack.length) return
    const next = redoStack[redoStack.length - 1]
    const current = {
      transcript: get().transcript,
      subtitleStyle: get().subtitleStyle,
      trimStart: get().trimStart,
      trimEnd: get().trimEnd,
      cropX: get().cropX,
      cropY: get().cropY,
    }
    set((state) => ({
      ...next,
      redoStack: state.redoStack.slice(0, -1),
      undoStack: [...state.undoStack, current],
    }))
  },

  setSubtitleText: (text) => {
    if (text && get().transcript.length === 0) {
      set({ transcript: [{ id: 'sub-1', word: text, startTime: 0, endTime: get().duration || 5, deleted: false }] })
    }
  },
  setSubtitles: (subs) => {
    set({ transcript: subs.length > 0 ? subs.map((s, i) => ({
      id: s.id || `sub-${i}`,
      word: s.text || '',
      startTime: s.start || 0,
      endTime: s.end || (get().duration || 5),
      deleted: false,
    })) : [] })
  },
  loadSubtitlesFromSRT: (srtContent) => {
    if (!srtContent) return
    try {
      const { parseSRT } = require('../../../lib/subtitles')
      const subs = parseSRT(srtContent)
      set({ transcript: subs.map((s, i) => ({
        id: `sub-${i}`,
        word: s.text || '',
        startTime: s.start || 0,
        endTime: s.end || (get().duration || 5),
        deleted: false,
      })) })
    } catch (e) {
      console.warn('Failed to parse SRT:', e)
    }
  },
  setMusic: (mood) => {
    set({ musicTrack: mood || 'none' })
  },

  setKeyboardHint: (msg) => {
    set({ keyboardHint: msg })
    if (msg) setTimeout(() => set({ keyboardHint: '' }), 2000)
  },
  showHint: (msg) => {
    set({ keyboardHint: msg })
    if (msg) setTimeout(() => set({ keyboardHint: '' }), 2000)
  },
  setLoading: (v) => set({ loading: v }),

  resetEditor: () => set({
    clip: null, clipId: null, isPlaying: false, playheadPos: 0,
    currentTime: 0, duration: 0, videoError: null, videoLoading: true, videoLoaded: false,
    trimStart: 0, trimEnd: 100, aspectRatio: '9:16',
    transcript: [], subtitleStyle: { ...defaultSubtitleStyle, wordPopEnabled: true },
    selectedSubtitlePreset: null, subtitleEnabled: true,
    textOverlays: [], selectedTextId: null,
    audioLayers: [], musicTrack: 'none', musicVolume: 30,
    audioCleanEnabled: false, originalVolume: 100,
    activeTool: 'ai', toolsPanelOpen: false,
    selectedTransition: 'none', transitionDuration: 0.3, activeFilter: 'none',
    faceTrackingEnabled: true, faceTrackingSmoothness: 50,
    faceTrackingZoom: 100, showFaceBox: true, modelsLoaded: false,
    cropX: 0, cropY: 0,
    brandSettings: { primaryColor: '#c4ff3d', secondaryColor: '#f5f5f0', logoUrl: null, logoPosition: 'bottom-right', logoSize: 50, applyToAll: false },
    exportRes: '1080p', exportFmt: 'MP4', includeSubs: true,
    showExportModal: false, saving: false, exportStatus: '', exportUrl: '',
    trackTimelineZoom: 1, timelineHidden: false, playheadDragging: false,
    volume: 100, playbackSpeed: 1, timelineZoom: 1,
    undoStack: [], redoStack: [], keyboardHint: '', loading: true,
  }),
}))

export default useEditorStore
