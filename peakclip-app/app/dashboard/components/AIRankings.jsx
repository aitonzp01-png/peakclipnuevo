'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { motion } from 'framer-motion';
import {
  Trophy,
  Bot,
  Search,
  Zap,
  BarChart3,
  Clapperboard,
  Medal,
  Check,
  Star,
  Sparkles,
  ArrowLeft,
  Play,
  Youtube,
  Globe,
  Music,
  MessageCircle,
  ExternalLink,
  RefreshCw,
  AlertCircle,
} from 'lucide-react';
import { getSupabaseClient } from '../../../lib/supabase';
import '../dashboard.css';

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL;

const SOURCES = [
  { id: 'youtube', label: 'YouTube', icon: Youtube, enabled: true },
  { id: 'tiktok', label: 'TikTok', icon: Music, enabled: false },
  { id: 'reddit', label: 'Reddit', icon: MessageCircle, enabled: false },
  { id: 'mixed', label: 'Mixed Sources', icon: Globe, enabled: false },
];

const RANKING_SIZES = [
  { value: 3, label: 'Top 3' },
  { value: 5, label: 'Top 5' },
  { value: 10, label: 'Top 10' },
];

const VIDEO_LENGTHS = [30, 45, 60];

const LANGUAGES = ['English', 'Spanish', 'Portuguese'];

const STEP_CONFIG = [
  { icon: Bot, label: 'AI Research Agent' },
  { icon: Search, label: 'Analyzing content' },
  { icon: Zap, label: 'Detecting viral moments' },
  { icon: BarChart3, label: 'Ranking clips' },
  { icon: Clapperboard, label: 'Preparing final ranking' },
];

const STEP_MAP = {
  searching: 0,
  downloading: 1,
  analyzing: 1,
  ranking: 3,
  done: 4,
};

const MEDAL_COLORS = ['#ffd700', '#c0c0c0', '#cd7f32'];

function ProgressBar({ progress }) {
  return (
    <div className="ar-progress-track">
      <motion.div
        className="ar-progress-fill"
        initial={{ width: 0 }}
        animate={{ width: `${progress}%` }}
        transition={{ duration: 0.1, ease: 'linear' }}
      />
    </div>
  );
}

function SimulationStep({ step, progress, isActive, isComplete, stepIndex }) {
  const IconComponent = step.icon;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: stepIndex * 0.1 }}
      className={`ar-sim-step ${isActive ? 'active' : ''} ${isComplete ? 'complete' : ''}`}
    >
      <div className="ar-sim-step-content">
        <div className={`ar-sim-step-icon-wrap ${isActive ? 'pulse' : ''} ${isComplete ? 'done' : ''}`}>
          {isComplete ? (
            <motion.span
              initial={{ scale: 0, rotate: -90 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ type: 'spring', stiffness: 300, damping: 15 }}
              className="ar-sim-step-check-icon"
            >
              <Check size={16} strokeWidth={3} />
            </motion.span>
          ) : (
            <IconComponent size={18} strokeWidth={1.5} />
          )}
        </div>
        <div className="ar-sim-step-body">
          <div className="ar-sim-step-label-row">
            <span className="ar-sim-step-label">{step.label}</span>
            {isComplete && <span className="ar-sim-step-check-text">Done</span>}
            {isActive && (
              <span className="ar-sim-step-dots">
                <span className="ar-dot-pulse" />
              </span>
            )}
          </div>
          <span className="ar-sim-step-subtitle">
            {isComplete ? 'Done' : isActive ? 'Working...' : ''}
          </span>
          {isActive && (
            <div className="ar-sim-progress-row">
              <ProgressBar progress={progress} />
              <span className="ar-sim-step-pct">{Math.round(progress)}%</span>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}

function ResultCard({ item, index }) {
  const IconComponent = index < 3 ? Medal : 'span';
  const medalProps = index < 3 ? { size: 22, strokeWidth: 1.5, color: MEDAL_COLORS[index] } : {};
  const rankLabel = index >= 3 ? `#${item.rank}` : '';
  const score = Math.round((item.hook_score || 5) * 10 + (item.retention_prediction || 50) / 10);

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.12, type: 'spring', stiffness: 200, damping: 20 }}
      className="ar-result-card"
      whileHover={{ y: -2, transition: { duration: 0.2 } }}
    >
      <div className="ar-result-rank">
        {index < 3 ? (
          <IconComponent {...medalProps} />
        ) : (
          <span className="ar-result-rank-num">{rankLabel}</span>
        )}
      </div>
      <div className="ar-result-thumb">
        {item.video_thumbnail ? (
          <img src={item.video_thumbnail} alt="" className="ar-result-thumb-img" />
        ) : (
          <div className="ar-result-thumb-bg">
            <Play size={24} strokeWidth={1.5} />
          </div>
        )}
        <span className="ar-result-duration">{Math.round(item.end - item.start)}s</span>
      </div>
      <div className="ar-result-info">
        <span className="ar-result-title">{item.title || item.video_title}</span>
        <span className="ar-result-source">{item.video_title}</span>
        <div className="ar-result-score-row">
          <Star size={12} strokeWidth={1.5} className="ar-result-score-star" />
          <span className="ar-result-score-text">Score {score}/100</span>
          <span className="ar-result-mood">{item.mood}</span>
        </div>
        {item.engagement_factors && item.engagement_factors.length > 0 && (
          <div className="ar-result-tags">
            {item.engagement_factors.slice(0, 3).map((f, i) => (
              <span key={i} className="ar-result-tag">{f.replace(/_/g, ' ')}</span>
            ))}
          </div>
        )}
      </div>
      <a
        href={item.video_url}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        className="ar-result-preview-btn"
      >
        <ExternalLink size={12} strokeWidth={2} />
        Source
      </a>
    </motion.div>
  );
}

export default function AIRankings({ setToast }) {
  const [topic, setTopic] = useState('');
  const [sources, setSources] = useState(['youtube']);
  const [rankingSize, setRankingSize] = useState(5);
  const [videoLength, setVideoLength] = useState(30);
  const [language, setLanguage] = useState('English');
  const [phase, setPhase] = useState('form');
  const [currentStep, setCurrentStep] = useState(0);
  const [stepProgress, setStepProgress] = useState(0);
  const [rankingMessage, setRankingMessage] = useState('');
  const [rankingId, setRankingId] = useState(null);
  const [results, setResults] = useState(null);
  const [error, setError] = useState(null);
  const [genId, setGenId] = useState(null);
  const [genProgress, setGenProgress] = useState(0);
  const [genMessage, setGenMessage] = useState('');
  const timerRef = useRef(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const toggleSource = (id) => {
    if (id !== 'youtube') {
      setToast({ type: 'info', text: `${SOURCES.find((s) => s.id === id).label} coming soon` });
      return;
    }
    setSources((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]));
  };

  const startRanking = useCallback(async () => {
    if (!topic.trim()) {
      setToast({ type: 'error', text: 'Please enter a ranking topic' });
      return;
    }
    setPhase('simulating');
    setCurrentStep(0);
    setStepProgress(0);
    setError(null);
    setResults(null);
    setRankingMessage('Starting AI research...');

    try {
      const { data: { session } } = await getSupabaseClient().auth.getSession();
      if (!session) {
        setToast({ type: 'error', text: 'Please log in first' });
        setPhase('form');
        return;
      }

      const response = await fetch(`${BACKEND_URL}/api/ranking`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          topic: topic.trim(),
          count: rankingSize,
          video_length: videoLength,
          language,
        }),
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.detail || 'Failed to start ranking');
      }

      const data = await response.json();
      setRankingId(data.ranking_id);
    } catch (err) {
      console.error('Ranking start error:', err);
      setToast({ type: 'error', text: err.message || 'Failed to start ranking' });
      setPhase('form');
    }
  }, [topic, rankingSize, videoLength, language, setToast]);

  // Poll for ranking status
  useEffect(() => {
    if (!rankingId || phase !== 'simulating') return;

    let isMounted = true;
    const interval = setInterval(async () => {
      try {
        const { data: { session } } = await getSupabaseClient().auth.getSession();
        if (!session || !isMounted) return;

        const res = await fetch(`${BACKEND_URL}/api/ranking/${rankingId}`, {
          headers: { 'Authorization': `Bearer ${session.access_token}` },
        });
        if (!res.ok) return;
        const data = await res.json();
        if (!isMounted) return;

        const stepKey = data.step || 'searching';
        const stepIdx = STEP_MAP[stepKey] || 0;
        setCurrentStep(stepIdx);
        setStepProgress(data.progress || 0);
        setRankingMessage(data.message || 'Processing...');

        if (data.status === 'done') {
          clearInterval(interval);
          setResults(data.results || []);
          setPhase('results');
        } else if (data.status === 'error') {
          clearInterval(interval);
          setError(data.message || 'Ranking failed');
          setToast({ type: 'error', text: data.message || 'Ranking failed' });
          setPhase('form');
        }
      } catch (err) {
        console.error('Poll error:', err);
      }
    }, 2000);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [rankingId, phase, setToast]);

  const resetForm = useCallback(() => {
    setPhase('form');
    setCurrentStep(0);
    setStepProgress(0);
    setRankingId(null);
    setResults(null);
    setError(null);
    setGenId(null);
    setGenProgress(0);
    setGenMessage('');
    if (timerRef.current) clearInterval(timerRef.current);
  }, []);

  const generateVideo = useCallback(async () => {
    if (!rankingId) return;
    setPhase('generating');
    setGenProgress(0);
    setGenMessage('Starting video generation...');
    try {
      const { data: { session } } = await getSupabaseClient().auth.getSession();
      if (!session) {
        setToast({ type: 'error', text: 'Please log in first' });
        setPhase('results');
        return;
      }
      const response = await fetch(`${BACKEND_URL}/api/ranking/${rankingId}/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
      });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.detail || 'Failed to start generation');
      }
      const data = await response.json();
      setGenId(data.gen_id);
    } catch (err) {
      console.error('Generate error:', err);
      setToast({ type: 'error', text: err.message || 'Failed to generate video' });
      setPhase('results');
    }
  }, [rankingId, setToast]);

  // Poll generation status
  useEffect(() => {
    if (!genId || phase !== 'generating') return;
    let isMounted = true;
    const interval = setInterval(async () => {
      try {
        const { data: { session } } = await getSupabaseClient().auth.getSession();
        if (!session || !isMounted) return;
        const res = await fetch(`${BACKEND_URL}/api/ranking/gen/${genId}`, {
          headers: { 'Authorization': `Bearer ${session.access_token}` },
        });
        if (!res.ok) return;
        const data = await res.json();
        if (!isMounted) return;
        setGenProgress(data.progress || 0);
        setGenMessage(data.message || 'Processing...');
        if (data.status === 'done') {
          clearInterval(interval);
          if (data.clip_id) {
            window.location.href = `/editor?id=${data.clip_id}`;
          } else {
            setToast({ type: 'success', text: 'Video generated!' });
            setPhase('results');
          }
        } else if (data.status === 'error') {
          clearInterval(interval);
          setToast({ type: 'error', text: data.message || 'Generation failed' });
          setPhase('results');
        }
      } catch (err) {
        console.error('Gen poll error:', err);
      }
    }, 2500);
    return () => { isMounted = false; clearInterval(interval); };
  }, [genId, phase, setToast]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      {phase === 'form' && (
        <div className="db-input-card" style={{ maxWidth: '720px' }}>
          <div className="ar-hero">
            <motion.div
              className="ar-hero-icon-wrap"
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: 'spring', stiffness: 200, damping: 15, delay: 0.1 }}
            >
              <Trophy size={36} strokeWidth={1.5} className="ar-hero-icon-svg" />
            </motion.div>
            <h1 className="db-input-card-title">AI Rankings</h1>
            <p className="db-input-card-subtitle">
              Create viral Top 5 and Top 10 videos automatically using AI.
            </p>
            <p className="ar-hero-hint">
              Describe the ranking you want. Our AI will research videos, select
              the best moments and prepare a complete ranking ready to generate.
            </p>
          </div>

          <div className="ar-form">
            <div className="ar-field">
              <label className="ar-field-label">Ranking Topic</label>
              <span className="ar-field-hint">What ranking do you want?</span>
              <div className="ar-input-container">
                <Search size={16} strokeWidth={1.5} className="ar-input-icon" />
                <input
                  type="text"
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  placeholder="Example: Top 10 Football Goals, Top 5 Parkour Fails..."
                  className="ar-input"
                  onKeyDown={(e) => e.key === 'Enter' && startRanking()}
                />
              </div>
            </div>

            <div className="ar-field">
              <label className="ar-field-label">Source</label>
              <div className="ar-checkbox-grid">
                {SOURCES.map((src) => {
                  const SrcIcon = src.icon;
                  return (
                    <label
                      key={src.id}
                      className={`ar-checkbox-label ${!src.enabled ? 'disabled' : ''} ${sources.includes(src.id) ? 'checked' : ''}`}
                    >
                      <input
                        type="checkbox"
                        checked={sources.includes(src.id)}
                        onChange={() => toggleSource(src.id)}
                        disabled={!src.enabled}
                        className="ar-checkbox-input"
                      />
                      <span className="ar-checkbox-custom">
                        {sources.includes(src.id) && (
                          <motion.span
                            initial={{ scale: 0 }}
                            animate={{ scale: 1 }}
                            transition={{ type: 'spring', stiffness: 400, damping: 15 }}
                          >
                            <Check size={10} strokeWidth={4} color="white" />
                          </motion.span>
                        )}
                      </span>
                      <SrcIcon size={16} strokeWidth={1.5} />
                      <span className="ar-checkbox-text">{src.label}</span>
                      {!src.enabled && <span className="ar-coming-soon-tag">Coming Soon</span>}
                    </label>
                  );
                })}
              </div>
            </div>

            <div className="ar-field">
              <label className="ar-field-label">Ranking Size</label>
              <div className="ar-radio-group">
                {RANKING_SIZES.map((size) => (
                  <label
                    key={size.value}
                    className={`ar-radio-label ${rankingSize === size.value ? 'checked' : ''}`}
                  >
                    <input
                      type="radio"
                      name="ranking-size"
                      value={size.value}
                      checked={rankingSize === size.value}
                      onChange={() => setRankingSize(size.value)}
                      className="ar-radio-input"
                    />
                    <span className="ar-radio-custom">
                      {rankingSize === size.value && (
                        <motion.span
                          layoutId="ranking-dot"
                          className="ar-radio-dot"
                          transition={{ type: 'spring', stiffness: 400, damping: 20 }}
                        />
                      )}
                    </span>
                    <span className="ar-radio-text">{size.label}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="ar-field-row">
              <div className="ar-field">
                <label className="ar-field-label">Video Length</label>
                <div className="ar-radio-group">
                  {VIDEO_LENGTHS.map((len) => (
                    <label
                      key={len}
                      className={`ar-radio-label ${videoLength === len ? 'checked' : ''}`}
                    >
                      <input
                        type="radio"
                        name="video-length"
                        value={len}
                        checked={videoLength === len}
                        onChange={() => setVideoLength(len)}
                        className="ar-radio-input"
                      />
                      <span className="ar-radio-custom">
                        {videoLength === len && (
                          <motion.span
                            layoutId="length-dot"
                            className="ar-radio-dot"
                            transition={{ type: 'spring', stiffness: 400, damping: 20 }}
                          />
                        )}
                      </span>
                      <span className="ar-radio-text">{len} sec</span>
                    </label>
                  ))}
                </div>
              </div>
              <div className="ar-field">
                <label className="ar-field-label">Language</label>
                <div className="ar-radio-group">
                  {LANGUAGES.map((lang) => (
                    <label
                      key={lang}
                      className={`ar-radio-label ${language === lang ? 'checked' : ''}`}
                    >
                      <input
                        type="radio"
                        name="language"
                        value={lang}
                        checked={language === lang}
                        onChange={() => setLanguage(lang)}
                        className="ar-radio-input"
                      />
                      <span className="ar-radio-custom">
                        {language === lang && (
                          <motion.span
                            layoutId="lang-dot"
                            className="ar-radio-dot"
                            transition={{ type: 'spring', stiffness: 400, damping: 20 }}
                          />
                        )}
                      </span>
                      <span className="ar-radio-text">{lang}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>

            <motion.button
              onClick={startRanking}
              className="db-primary-btn ar-generate-btn"
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              <Sparkles size={18} strokeWidth={1.5} />
              Generate AI Ranking
            </motion.button>
          </div>
        </div>
      )}

      {phase === 'simulating' && (
        <div className="db-input-card ar-sim-card" style={{ maxWidth: '560px' }}>
          <motion.div
            className="ar-sim-header"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
          >
            <motion.span
              className="ar-sim-title"
              initial={{ scale: 0.9 }}
              animate={{ scale: 1 }}
              transition={{ type: 'spring', stiffness: 200, damping: 15 }}
            >
              <Bot size={28} strokeWidth={1.5} className="ar-sim-title-icon" />
              AI is working on your ranking
            </motion.span>
            <p className="ar-sim-subtitle">
              Researching &ldquo;{topic}&rdquo; — this will just take a moment
            </p>
            <p className="ar-sim-status">{rankingMessage}</p>
          </motion.div>
          <div className="ar-sim-steps">
            {STEP_CONFIG.map((step, idx) => (
              <SimulationStep
                key={idx}
                step={step}
                stepIndex={idx}
                progress={idx === currentStep ? stepProgress : idx < currentStep ? 100 : 0}
                isActive={idx === currentStep}
                isComplete={idx < currentStep}
              />
            ))}
          </div>
        </div>
      )}

      {phase === 'generating' && (
        <div className="db-input-card ar-sim-card" style={{ maxWidth: '560px' }}>
          <motion.div
            className="ar-sim-header"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
          >
            <motion.span
              className="ar-sim-title"
              initial={{ scale: 0.9 }}
              animate={{ scale: 1 }}
              transition={{ type: 'spring', stiffness: 200, damping: 15 }}
            >
              <Clapperboard size={28} strokeWidth={1.5} className="ar-sim-title-icon" />
              Generating your ranking video
            </motion.span>
            <p className="ar-sim-subtitle">
              Creating intro + ranked clips with overlays — this takes a minute
            </p>
            <p className="ar-sim-status">{genMessage}</p>
          </motion.div>
          <div className="ar-sim-progress-row" style={{ padding: '0 20px 20px' }}>
            <ProgressBar progress={genProgress} />
            <span className="ar-sim-step-pct">{Math.round(genProgress)}%</span>
          </div>
        </div>
      )}

      {phase === 'results' && (
        <div className="db-input-card ar-results-card" style={{ maxWidth: '720px' }}>
          <motion.div
            className="ar-results-header"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <motion.div
              className="ar-results-icon-wrap"
              initial={{ scale: 0, rotate: -180 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ type: 'spring', stiffness: 200, damping: 15 }}
            >
              <Trophy size={32} strokeWidth={1.5} className="ar-results-icon-svg" />
            </motion.div>
            <h2 className="ar-results-title">Top {results?.length || rankingSize} Found</h2>
            <p className="ar-results-subtitle">
              Based on AI analysis of &ldquo;{topic}&rdquo;
            </p>
          </motion.div>

          <div className="ar-results-list">
            {(results || []).map((item, idx) => (
              <ResultCard key={idx} item={item} index={idx} />
            ))}
          </div>

          <motion.button
            onClick={generateVideo}
            className="db-primary-btn ar-generate-btn"
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
          >
            <Clapperboard size={18} strokeWidth={1.5} />
            Generate Ranking Video
          </motion.button>

          <button onClick={resetForm} className="ar-back-btn">
            <ArrowLeft size={14} strokeWidth={2} />
            Create another ranking
          </button>
        </div>
      )}
    </motion.div>
  );
}
