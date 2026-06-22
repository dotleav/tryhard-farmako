import { useState, useEffect, useCallback, useRef, type CSSProperties } from 'react'
import {
  CheckCircle, XCircle, BookOpen, Trophy,
  Filter, Shuffle, RotateCcw, ChevronRight, ImageIcon,
  Play, Zap, Timer, AlertCircle, Clock,
} from 'lucide-react'

// ── Types ──────────────────────────────────────────────────────────────────────

interface Question {
  id: string
  question: string
  options: string[]
  correct: number
  explanation: string
  category: string
  img: string | null
}

type AnswerState = number | 'skipped' | null
type QuizMode = 'biasa' | 'tentamen'
type AppState = 'setup' | 'running' | 'finished'
type QuestionPhase = 'answering' | 'answered_manual' | 'answered_timeout'

// ── Constants ──────────────────────────────────────────────────────────────────

const LETTERS = ['A', 'B', 'C', 'D', 'E']
const EXAM_TIMER = 30

const CATEGORY_COLORS: Record<string, string> = {
  'Ekstraksi Obat':                       'bg-blue-500/20 text-blue-300 border-blue-500/30',
  'Identifikasi Obat Herbal':            'bg-pink-500/20 text-pink-300 border-pink-500/30',
}

// ── Utils ──────────────────────────────────────────────────────────────────────

function shuffleArray<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// ── LocalStorage (Mode Biasa — persists across refresh & tab close) ────────────

const LS_KEY = 'farmako_quiz_biasa_progress'

interface SavedBiasaState {
  selectedCategory: string
  shuffleOn: boolean
  activeQuestions: Question[]
  answers: AnswerState[]
}

function loadBiasa(): SavedBiasaState | null {
  try {
    const raw = localStorage.getItem(LS_KEY)
    return raw ? (JSON.parse(raw) as SavedBiasaState) : null
  } catch {
    return null
  }
}

function saveBiasa(state: SavedBiasaState) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(state))
  } catch { /* quota exceeded — silently ignore */ }
}

function clearBiasa() {
  try { localStorage.removeItem(LS_KEY) } catch { /* noop */ }
}

// ── Root Component ─────────────────────────────────────────────────────────────

export default function Quiz() {
  const [questions, setQuestions] = useState<Question[]>([])
  const [quizMode, setQuizMode]   = useState<QuizMode>('biasa')

  // Mode Biasa state — loaded from localStorage on mount
  const [biasaActive, setBiasaActive]             = useState(false) // true = running biasa
  const [biasaCategory, setBiasaCategory]         = useState('Semua')
  const [biasaShuffleOn, setBiasaShuffleOn]       = useState(false)
  const [biasaQuestions, setBiasaQuestions]       = useState<Question[]>([])
  const [biasaAnswers, setBiasaAnswers]           = useState<AnswerState[]>([])

  // Mode Tentamen state — ephemeral, no storage
  const [tentamenState, setTentamenState]         = useState<AppState>('setup')
  const [tentamenCategory, setTentamenCategory]   = useState('Semua')
  const [tentamenShuffleOn, setTentamenShuffleOn] = useState(false)
  const [tentamenQuestions, setTentamenQuestions] = useState<Question[]>([])
  const [tentamenAnswers, setTentamenAnswers]     = useState<AnswerState[]>([])
  const [currentIdx, setCurrentIdx]               = useState(0)
  const [timeLeft, setTimeLeft]                   = useState(EXAM_TIMER)
  const [qPhase, setQPhase]                       = useState<QuestionPhase>('answering')

  // ── Audio refs (preloaded so browser allows instant play on click) ──
  const audioBenar = useRef<HTMLAudioElement | null>(null)
  const audioSalah = useRef<HTMLAudioElement | null>(null)
  // Bug fix #2: baca status mute dari localStorage agar persist setelah refresh
  const [isMuted, setIsMuted] = useState(() => localStorage.getItem('quiz_muted') === 'true')
  useEffect(() => {
    // Bug fix #1: gunakan path relatif agar benar di GitHub Pages subdirectory
    // Bug fix #3: hapus .load() — browser akan load otomatis saat .play() dipanggil
    audioBenar.current = new Audio('./benar.mp3')
    audioSalah.current = new Audio('./salah.mp3')
  }, [])

  // Ref selalu sinkron dengan isMuted — dibaca oleh playSound
  // agar tidak terjadi stale closure di dalam useCallback.
  // Bug fix #4: init ref dengan nilai awal isMuted (bukan selalu false)
  const isMutedRef = useRef(isMuted)
  useEffect(() => {
    isMutedRef.current = isMuted
    // Bug fix #2: simpan ke localStorage agar persist setelah refresh
    localStorage.setItem('quiz_muted', String(isMuted))
  }, [isMuted])

  const playSound = useCallback((correct: boolean) => {
    if (isMutedRef.current) return
    const audio = correct ? audioBenar.current : audioSalah.current
    if (!audio) return
    audio.currentTime = 0
    audio.play().catch(() => { /* blocked by browser policy */ })
  }, [])

  // Ref for beforeunload
  const isTentamenRunningRef = useRef(false)
  useEffect(() => {
    isTentamenRunningRef.current = quizMode === 'tentamen' && tentamenState === 'running'
  }, [quizMode, tentamenState])

  // ── beforeunload warning only when tentamen is active ──
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!isTentamenRunningRef.current) return
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [])

  // ── Load questions ──
  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}questions.json`)
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then((data: Question[]) => setQuestions(data))
      .catch(err => console.error('Gagal memuat questions.json:', err))
  }, [])

  // ── Restore biasa progress from localStorage once questions are loaded ──
  useEffect(() => {
    if (questions.length === 0) return
    const saved = loadBiasa()
    if (saved && saved.activeQuestions.length > 0) {
      setBiasaCategory(saved.selectedCategory)
      setBiasaShuffleOn(saved.shuffleOn)
      setBiasaQuestions(saved.activeQuestions)
      setBiasaAnswers(saved.answers)
      setBiasaActive(true)
    } else {
      // Auto-start biasa mode with default settings
      autoStartBiasa(questions, 'Semua', false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [questions])

  function autoStartBiasa(allQs: Question[], cat: string, shuffle: boolean) {
    const base = cat === 'Semua' ? allQs : allQs.filter(q => q.category === cat)
    const qs = shuffle ? shuffleArray(base) : base
    if (!qs.length) return
    setBiasaQuestions(qs)
    setBiasaAnswers(new Array(qs.length).fill(null))
    setBiasaActive(true)
  }

  // ── Persist biasa state to localStorage whenever it changes ──
  useEffect(() => {
    if (!biasaActive || biasaQuestions.length === 0) return
    saveBiasa({
      selectedCategory: biasaCategory,
      shuffleOn: biasaShuffleOn,
      activeQuestions: biasaQuestions,
      answers: biasaAnswers,
    })
  }, [biasaActive, biasaCategory, biasaShuffleOn, biasaQuestions, biasaAnswers])

  // ── Tentamen: timer countdown ──
  useEffect(() => {
    if (quizMode !== 'tentamen' || tentamenState !== 'running' || qPhase !== 'answering') return
    if (timeLeft === 0) {
      setTentamenAnswers(prev => { const n = [...prev]; n[currentIdx] = 'skipped'; return n })
      setQPhase('answered_timeout')
      return
    }
    const t = setTimeout(() => setTimeLeft(p => p - 1), 1000)
    return () => clearTimeout(t)
  }, [quizMode, tentamenState, qPhase, timeLeft, currentIdx])

  // ── Tentamen: auto-advance on timeout ──
  useEffect(() => {
    if (quizMode !== 'tentamen' || tentamenState !== 'running' || qPhase !== 'answered_timeout') return
    const t = setTimeout(() => {
      if (currentIdx >= tentamenQuestions.length - 1) {
        setTentamenState('finished')
      } else {
        setCurrentIdx(p => p + 1)
        setTimeLeft(EXAM_TIMER)
        setQPhase('answering')
      }
    }, 1800)
    return () => clearTimeout(t)
  }, [quizMode, tentamenState, qPhase, currentIdx, tentamenQuestions.length])

  // ── Derived ──
  const buildQuestions = useCallback((cat: string, shuffle: boolean, allQs: Question[]): Question[] => {
    const base = cat === 'Semua' ? allQs : allQs.filter(q => q.category === cat)
    return shuffle ? shuffleArray(base) : base
  }, [])

  const categories = ['Semua', ...Array.from(new Set(questions.map(q => q.category))).sort()]

  // ── Mode Biasa handlers ──
  const handleResetBiasa = useCallback(() => {
    clearBiasa()
    const qs = buildQuestions(biasaCategory, biasaShuffleOn, questions)
    if (!qs.length) return
    setBiasaQuestions(qs)
    setBiasaAnswers(new Array(qs.length).fill(null))
    setBiasaActive(true)
  }, [biasaCategory, biasaShuffleOn, buildQuestions, questions])

  const handleBiasaFilterChange = (cat: string) => {
    setBiasaCategory(cat)
    const qs = buildQuestions(cat, biasaShuffleOn, questions)
    if (!qs.length) return
    setBiasaQuestions(qs)
    setBiasaAnswers(new Array(qs.length).fill(null))
    clearBiasa()
  }

  const handleBiasaShuffleToggle = () => {
    const next = !biasaShuffleOn
    setBiasaShuffleOn(next)
    const qs = buildQuestions(biasaCategory, next, questions)
    if (!qs.length) return
    setBiasaQuestions(qs)
    setBiasaAnswers(new Array(qs.length).fill(null))
    clearBiasa()
  }

  const biasaAnswersRef = useRef<AnswerState[]>([])
  useEffect(() => { biasaAnswersRef.current = biasaAnswers }, [biasaAnswers])

  const handleAnswerBiasa = useCallback((qIdx: number, optIdx: number) => {
    // Check BEFORE setState so playSound is called outside the updater
    if (biasaAnswersRef.current[qIdx] !== null) return
    setBiasaAnswers(prev => {
      if (prev[qIdx] !== null) return prev
      const n = [...prev]; n[qIdx] = optIdx
      return n
    })
    playSound(optIdx === biasaQuestions[qIdx]?.correct)
  }, [biasaQuestions, playSound])

  // ── Mode Tentamen handlers ──
  const handleStartTentamen = useCallback(() => {
    const qs = buildQuestions(tentamenCategory, tentamenShuffleOn, questions)
    if (!qs.length) return
    setTentamenQuestions(qs)
    setTentamenAnswers(new Array(qs.length).fill(null))
    setCurrentIdx(0)
    setTimeLeft(EXAM_TIMER)
    setQPhase('answering')
    setTentamenState('running')
  }, [buildQuestions, tentamenCategory, tentamenShuffleOn, questions])

  const handleResetTentamen = useCallback(() => {
    setTentamenState('setup')
    setTentamenQuestions([])
    setTentamenAnswers([])
  }, [])

  const tentamenAnswersRef = useRef<AnswerState[]>([])
  useEffect(() => { tentamenAnswersRef.current = tentamenAnswers }, [tentamenAnswers])

  const handleAnswerTentamen = useCallback((optIdx: number) => {
    // Check BEFORE setState so playSound is called outside the updater
    if (tentamenAnswersRef.current[currentIdx] !== null) return
    setTentamenAnswers(prev => {
      if (prev[currentIdx] !== null) return prev
      const n = [...prev]; n[currentIdx] = optIdx
      return n
    })
    playSound(optIdx === tentamenQuestions[currentIdx]?.correct)
    setQPhase('answered_manual')
  }, [currentIdx, tentamenQuestions, playSound])

  const goNext = useCallback(() => {
    if (currentIdx >= tentamenQuestions.length - 1) {
      setTentamenState('finished')
    } else {
      setCurrentIdx(p => p + 1)
      setTimeLeft(EXAM_TIMER)
      setQPhase('answering')
    }
  }, [currentIdx, tentamenQuestions.length])

  // ── Switch mode ──
  const handleModeChange = (mode: QuizMode) => {
    if (mode === quizMode) return
    setQuizMode(mode)
    // Entering tentamen always starts from setup
    if (mode === 'tentamen') {
      setTentamenState('setup')
      setTentamenQuestions([])
      setTentamenAnswers([])
    }
    // Leaving tentamen back to biasa — biasa state is untouched (persisted in localStorage)
  }

  // ── Computed for display ──
  const biasaAnsweredCount = biasaAnswers.filter(a => a !== null).length
  const biasaCorrectCount  = biasaAnswers.filter((a, i) => typeof a === 'number' && a === biasaQuestions[i]?.correct).length
  const tentamenQCount     = buildQuestions(tentamenCategory, false, questions).length

  return (
    <div style={{ backgroundColor: '#0d1117', minHeight: '100vh' }}>

      {/* ═══ Sticky header + mode bar ═══ */}
      <div style={{ position: 'sticky', top: 0, zIndex: 50 }}>

        {/* Header */}
        <header style={{ backgroundColor: '#161b22', borderBottom: '1px solid #21262d', padding: '12px 0' }}>
          <div className="max-w-3xl mx-auto px-4 flex items-center justify-between">
            <div>
              <h1 style={{
                fontFamily: '"DM Serif Display", Georgia, serif',
                color: '#e8a838',
                fontSize: 'clamp(1.3rem, 4vw, 1.6rem)',
                fontWeight: 700,
                lineHeight: 1.2,
                margin: 0,
              }}>
                Latihan Soal PA
              </h1>
              <p style={{ color: '#6e7681', fontSize: '0.72rem', marginTop: '2px' }}>
                Disclaimer: Soal dbuat mggnkn AI, mhn jgn mmpercayai penjelasan jwbn sepenuhnya
              </p>
            </div>

            {/* Right side: tracker + mute */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              {quizMode === 'biasa' && biasaActive && (
                <div style={{ textAlign: 'right', minWidth: '70px' }}>
                  <div style={{
                    fontFamily: '"JetBrains Mono", monospace',
                    color: '#e8a838',
                    fontSize: '0.9rem',
                    fontWeight: 700,
                  }}>
                    {biasaAnsweredCount}/{biasaQuestions.length}
                  </div>
                  <div style={{ color: '#6e7681', fontSize: '0.65rem', lineHeight: 1.3 }}>
                    dijawab · benar <span style={{ color: '#4ade80' }}>{biasaCorrectCount}</span>
                  </div>
                </div>
              )}
              {quizMode === 'tentamen' && tentamenState === 'running' && (
                <div style={{ textAlign: 'right' }}>
                  <div style={{
                    fontFamily: '"JetBrains Mono", monospace',
                    color: '#e8a838',
                    fontSize: '0.9rem',
                    fontWeight: 700,
                  }}>
                    {currentIdx + 1}/{tentamenQuestions.length}
                  </div>
                  <div style={{ color: '#6e7681', fontSize: '0.65rem' }}>soal</div>
                </div>
              )}
              <button
                onClick={() => setIsMuted(m => !m)}
                title={isMuted ? 'Nyalakan suara' : 'Matikan suara'}
                style={{
                  background: 'none',
                  border: '1px solid #30363d',
                  borderRadius: '6px',
                  padding: '5px 8px',
                  cursor: 'pointer',
                  color: isMuted ? '#6e7681' : '#e8a838',
                  fontSize: '1rem',
                  lineHeight: 1,
                  flexShrink: 0,
                }}
              >
                {isMuted ? '🔇' : '🔊'}
              </button>
            </div>
          </div>
        </header>

        {/* Mode bar */}
        <div style={{ backgroundColor: '#161b22', borderBottom: '1px solid #30363d', padding: '8px 0' }}>
          <div className="max-w-3xl mx-auto px-4 flex items-center gap-2">
            {(['biasa', 'tentamen'] as const).map(m => (
              <button
                key={m}
                onClick={() => handleModeChange(m)}
                style={{
                  padding: '5px 15px',
                  borderRadius: '999px',
                  fontSize: '0.78rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                  lineHeight: 1.4,
                  ...(quizMode === m
                    ? { backgroundColor: '#e8a838', color: '#0d1117', border: 'none' }
                    : { backgroundColor: 'transparent', color: '#8b949e', border: '1px solid #30363d' }),
                }}
              >
                {m === 'biasa' ? 'Mode Biasa' : 'Mode Tentamen'}
              </button>
            ))}

            {/* Reset button — only in biasa mode */}
            {quizMode === 'biasa' && biasaActive && (
              <button
                onClick={handleResetBiasa}
                style={{
                  marginLeft: 'auto',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  fontSize: '0.72rem',
                  color: '#6e7681',
                  background: 'none',
                  border: '1px solid #30363d',
                  cursor: 'pointer',
                  padding: '4px 10px',
                  borderRadius: '999px',
                  transition: 'all 0.15s',
                }}
                onMouseEnter={e => {
                  ;(e.currentTarget as HTMLButtonElement).style.color = '#c9d1d9'
                  ;(e.currentTarget as HTMLButtonElement).style.borderColor = '#484f58'
                }}
                onMouseLeave={e => {
                  ;(e.currentTarget as HTMLButtonElement).style.color = '#6e7681'
                  ;(e.currentTarget as HTMLButtonElement).style.borderColor = '#30363d'
                }}
              >
                <RotateCcw style={{ width: '11px', height: '11px' }} />
                Reset
              </button>
            )}

            {/* Reset button — tentamen when running or finished */}
            {quizMode === 'tentamen' && tentamenState !== 'setup' && (
              <button
                onClick={handleResetTentamen}
                style={{
                  marginLeft: 'auto',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  fontSize: '0.72rem',
                  color: '#6e7681',
                  background: 'none',
                  border: '1px solid #30363d',
                  cursor: 'pointer',
                  padding: '4px 10px',
                  borderRadius: '999px',
                  transition: 'all 0.15s',
                }}
                onMouseEnter={e => {
                  ;(e.currentTarget as HTMLButtonElement).style.color = '#c9d1d9'
                  ;(e.currentTarget as HTMLButtonElement).style.borderColor = '#484f58'
                }}
                onMouseLeave={e => {
                  ;(e.currentTarget as HTMLButtonElement).style.color = '#6e7681'
                  ;(e.currentTarget as HTMLButtonElement).style.borderColor = '#30363d'
                }}
              >
                <RotateCcw style={{ width: '11px', height: '11px' }} />
                Reset
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ═══ Filter bar (scrolls away) ═══ */}
      <div style={{ borderBottom: '1px solid #21262d', backgroundColor: '#0a0e14', padding: '10px 0' }}>
        <div className="max-w-3xl mx-auto px-4">
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
            <span style={{
              display: 'flex', alignItems: 'center', gap: '3px',
              fontSize: '0.68rem', color: '#484f58', flexShrink: 0,
            }}>
              <Filter style={{ width: '11px', height: '11px' }} /> Topik:
            </span>

            {categories.map(cat => {
              const activeCat = quizMode === 'biasa' ? biasaCategory : tentamenCategory
              const active = activeCat === cat
              const label  = cat === 'Semua' ? 'Semua' : cat.replace(' (Bergambar)', ' ⬜').replace('Demografi & Epidemiologi', 'Demografi')
              return (
                <button
                  key={cat}
                  onClick={() => {
                    if (quizMode === 'biasa') handleBiasaFilterChange(cat)
                    else setTentamenCategory(cat)
                  }}
                  style={{
                    padding: '3px 10px',
                    borderRadius: '999px',
                    fontSize: '0.68rem',
                    fontWeight: active ? 700 : 500,
                    cursor: 'pointer',
                    transition: 'all 0.15s',
                    lineHeight: 1.5,
                    ...(active
                      ? { backgroundColor: '#e8a838', color: '#0d1117', border: 'none' }
                      : { backgroundColor: 'transparent', color: '#8b949e', border: '1px solid rgba(255,255,255,0.1)' }),
                  }}
                >
                  {label}
                </button>
              )
            })}

            <button
              onClick={() => {
                if (quizMode === 'biasa') handleBiasaShuffleToggle()
                else setTentamenShuffleOn(p => !p)
              }}
              style={{
                marginLeft: 'auto',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                padding: '3px 10px',
                borderRadius: '999px',
                fontSize: '0.68rem',
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.15s',
                ...((quizMode === 'biasa' ? biasaShuffleOn : tentamenShuffleOn)
                  ? { backgroundColor: '#e8a838', color: '#0d1117', border: 'none' }
                  : { backgroundColor: 'transparent', color: '#8b949e', border: '1px solid rgba(255,255,255,0.1)' }),
              }}
            >
              <Shuffle style={{ width: '11px', height: '11px' }} />
              Acak {(quizMode === 'biasa' ? biasaShuffleOn : tentamenShuffleOn) ? 'ON' : 'OFF'}
            </button>
          </div>
        </div>
      </div>

      {/* ═══ Main content ═══ */}
      <main className="max-w-3xl mx-auto px-4 py-6">

        {/* ── Mode Biasa ── */}
        {quizMode === 'biasa' && biasaActive && (
          <BiasaMode
            questions={biasaQuestions}
            answers={biasaAnswers}
            onAnswer={handleAnswerBiasa}
          />
        )}
        {quizMode === 'biasa' && !biasaActive && (
          <div style={{ color: '#6e7681', textAlign: 'center', marginTop: '60px', fontSize: '0.88rem' }}>
            Memuat soal…
          </div>
        )}

        {/* ── Mode Tentamen ── */}
        {quizMode === 'tentamen' && tentamenState === 'setup' && (
          <SetupCard questionCount={tentamenQCount} onStart={handleStartTentamen} />
        )}

        {quizMode === 'tentamen' && tentamenState === 'running' && tentamenQuestions[currentIdx] && (
          <TentamenMode
            question={tentamenQuestions[currentIdx]}
            questionNum={currentIdx + 1}
            total={tentamenQuestions.length}
            timeLeft={timeLeft}
            phase={qPhase}
            answer={tentamenAnswers[currentIdx]}
            onAnswer={handleAnswerTentamen}
            onNext={goNext}
          />
        )}

        {quizMode === 'tentamen' && tentamenState === 'finished' && (
          <TentamenResults
            questions={tentamenQuestions}
            answers={tentamenAnswers}
            onRestart={handleResetTentamen}
          />
        )}
      </main>
    </div>
  )
}

// ── SetupCard (Tentamen only) ──────────────────────────────────────────────────

function SetupCard({ questionCount, onStart }: {
  questionCount: number
  onStart: () => void
}) {
  const est = `${Math.ceil(questionCount * EXAM_TIMER / 60)} menit`

  return (
    <div className="quiz-fade-in">
      {/* Mode info card */}
      <div style={{ backgroundColor: '#161b22', border: '1px solid #30363d', borderRadius: '16px', padding: '24px', marginBottom: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '14px', marginBottom: '20px' }}>
          <div style={{
            backgroundColor: '#e8a83818',
            border: '1px solid #e8a83835',
            borderRadius: '10px',
            padding: '10px',
            flexShrink: 0,
          }}>
            <Timer style={{ width: '22px', height: '22px', color: '#e8a838' }} />
          </div>
          <div>
            <h2 style={{ color: '#f0f6fc', fontSize: '1.1rem', fontWeight: 700, margin: 0 }}>
              Mode Tentamen
            </h2>
            <p style={{ color: '#8b949e', fontSize: '0.8rem', marginTop: '4px' }}>
              Simulasi ujian dengan timer 30 detik per soal
            </p>
          </div>
        </div>

        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {[
            'Satu soal per layar dengan timer 30 detik',
            'Waktu habis → otomatis lanjut ke soal berikutnya',
            'Setelah menjawab: lihat jawaban benar + penjelasan',
            'Hasil lengkap di akhir: skor, benar, salah, terlewati',
          ].map((item, i) => (
            <li key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', fontSize: '0.82rem', color: '#c9d1d9' }}>
              <Zap style={{ width: '14px', height: '14px', color: '#e8a838', flexShrink: 0, marginTop: '1px' }} />
              {item}
            </li>
          ))}
        </ul>
      </div>

      {/* Stats row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', marginBottom: '20px' }}>
        {[
          { value: questionCount.toString(), label: 'Soal' },
          { value: '5', label: 'Pilihan' },
          { value: est, label: 'Estimasi' },
        ].map(({ value, label }) => (
          <div key={label} style={{
            backgroundColor: '#161b22',
            border: '1px solid #30363d',
            borderRadius: '12px',
            padding: '14px',
            textAlign: 'center',
          }}>
            <div style={{ fontFamily: '"JetBrains Mono", monospace', color: '#e8a838', fontSize: '1.35rem', fontWeight: 700 }}>{value}</div>
            <div style={{ color: '#6e7681', fontSize: '0.72rem', marginTop: '4px' }}>{label}</div>
          </div>
        ))}
      </div>

      {/* Start button */}
      <button
        onClick={onStart}
        disabled={questionCount === 0}
        style={{
          width: '100%',
          padding: '14px',
          backgroundColor: '#e8a838',
          color: '#0d1117',
          fontWeight: 700,
          fontSize: '1rem',
          borderRadius: '12px',
          border: 'none',
          cursor: questionCount === 0 ? 'not-allowed' : 'pointer',
          opacity: questionCount === 0 ? 0.4 : 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '8px',
          transition: 'opacity 0.15s, transform 0.1s',
        }}
        onMouseEnter={e => { if (questionCount > 0) (e.currentTarget as HTMLButtonElement).style.opacity = '0.88' }}
        onMouseLeave={e => { if (questionCount > 0) (e.currentTarget as HTMLButtonElement).style.opacity = '1' }}
        onMouseDown={e => { (e.currentTarget as HTMLButtonElement).style.transform = 'scale(0.98)' }}
        onMouseUp={e => { (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1)' }}
      >
        <Play style={{ width: '18px', height: '18px' }} />
        Mulai Tentamen
      </button>
    </div>
  )
}

// ── BiasaMode ──────────────────────────────────────────────────────────────────

function BiasaMode({ questions, answers, onAnswer }: {
  questions: Question[]
  answers: AnswerState[]
  onAnswer: (qIdx: number, optIdx: number) => void
}) {
  const answeredCount = answers.filter(a => a !== null).length
  const correctCount  = answers.filter((a, i) => typeof a === 'number' && a === questions[i]?.correct).length
  const allDone       = answeredCount === questions.length && questions.length > 0
  const pct           = questions.length > 0 ? Math.round((answeredCount / questions.length) * 100) : 0

  return (
    <div>
      {/* Tracker bar */}
      <div style={{
        backgroundColor: '#161b22',
        border: '1px solid #30363d',
        borderRadius: '12px',
        padding: '12px 16px',
        marginBottom: '16px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
          <span style={{ fontSize: '0.82rem', color: '#8b949e' }}>
            Sudah dijawab:{' '}
            <span style={{ color: '#e8a838', fontFamily: '"JetBrains Mono", monospace', fontWeight: 700 }}>{answeredCount}</span>
            {' '}/ Total:{' '}
            <span style={{ color: '#c9d1d9', fontFamily: '"JetBrains Mono", monospace', fontWeight: 700 }}>{questions.length}</span>
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '0.78rem' }}>
              <span style={{ width: '7px', height: '7px', borderRadius: '50%', backgroundColor: '#4ade80', display: 'inline-block' }} />
              <span style={{ color: '#4ade80', fontWeight: 700 }}>{correctCount}</span>
              <span style={{ color: '#6e7681' }}>benar</span>
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '0.78rem' }}>
              <span style={{ width: '7px', height: '7px', borderRadius: '50%', backgroundColor: '#f87171', display: 'inline-block' }} />
              <span style={{ color: '#f87171', fontWeight: 700 }}>{answeredCount - correctCount}</span>
              <span style={{ color: '#6e7681' }}>salah</span>
            </span>
          </div>
        </div>
        {/* Progress bar */}
        <div style={{ backgroundColor: '#21262d', borderRadius: '999px', height: '5px', overflow: 'hidden' }}>
          <div style={{
            height: '100%',
            borderRadius: '999px',
            backgroundColor: '#e8a838',
            width: `${pct}%`,
            transition: 'width 0.4s ease',
          }} />
        </div>
      </div>

      {/* All-done banner */}
      {allDone && (
        <div style={{
          backgroundColor: '#e8a83812',
          border: '1px solid #e8a83840',
          borderRadius: '12px',
          padding: '12px 16px',
          marginBottom: '20px',
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
        }} className="quiz-fade-in">
          <Trophy style={{ width: '20px', height: '20px', color: '#e8a838', flexShrink: 0 }} />
          <div>
            <span style={{ color: '#e8a838', fontWeight: 700, fontSize: '0.88rem' }}>Selesai! </span>
            <span style={{ color: '#c9d1d9', fontSize: '0.82rem' }}>
              Skor akhir: {correctCount}/{questions.length} ({Math.round((correctCount / questions.length) * 100)}%)
            </span>
          </div>
        </div>
      )}

      {/* Question list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        {questions.map((q, idx) => (
          <div
            key={q.id}
            className="quiz-fade-in"
            style={{ animationDelay: `${Math.min(idx * 25, 350)}ms` }}
          >
            <QuestionCard
              q={q}
              qNum={idx + 1}
              answer={answers[idx]}
              onAnswer={optIdx => onAnswer(idx, optIdx)}
            />
          </div>
        ))}
      </div>
    </div>
  )
}

// ── TentamenMode ───────────────────────────────────────────────────────────────

function TentamenMode({ question, questionNum, total, timeLeft, phase, answer, onAnswer, onNext }: {
  question: Question
  questionNum: number
  total: number
  timeLeft: number
  phase: QuestionPhase
  answer: AnswerState
  onAnswer: (optIdx: number) => void
  onNext: () => void
}) {
  const isAnswering  = phase === 'answering'
  const isManual     = phase === 'answered_manual'
  const isTimeout    = phase === 'answered_timeout'
  const isUrgent     = timeLeft <= 10 && isAnswering
  const timerPct     = (timeLeft / EXAM_TIMER) * 100

  return (
    <div className="quiz-fade-in">
      {/* Progress dots + soal X/Y */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
        <span style={{ fontSize: '0.78rem', color: '#8b949e' }}>
          Soal{' '}
          <span style={{ fontFamily: '"JetBrains Mono", monospace', color: '#e8a838', fontWeight: 700 }}>{questionNum}</span>
          {' '}dari {total}
        </span>
        {/* Mini dot progress */}
        <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
          {Array.from({ length: Math.min(total, 15) }, (_, i) => {
            const done    = i < questionNum - 1
            const current = i === questionNum - 1
            return (
              <div key={i} style={{
                width: current ? '18px' : '8px',
                height: '8px',
                borderRadius: current ? '4px' : '50%',
                backgroundColor: done ? '#e8a838' : current ? '#e8a83870' : '#21262d',
                transition: 'all 0.2s',
              }} />
            )
          })}
          {total > 15 && (
            <span style={{ color: '#484f58', fontSize: '0.65rem', marginLeft: '2px' }}>+{total - 15}</span>
          )}
        </div>
      </div>

      {/* Timer card */}
      <div style={{
        backgroundColor: '#161b22',
        border: `1px solid ${isUrgent ? '#ef444440' : '#30363d'}`,
        borderRadius: '12px',
        padding: '14px 16px',
        marginBottom: '16px',
        transition: 'border-color 0.3s',
      }} className={isTimeout ? 'timeout-flash' : ''}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Clock style={{ width: '15px', height: '15px', color: isUrgent ? '#ef4444' : '#8b949e' }} />
            <span style={{ fontSize: '0.75rem', color: isUrgent ? '#ef4444' : '#8b949e' }}>
              {isAnswering ? 'Waktu tersisa' : isTimeout ? 'Waktu habis!' : 'Selesai'}
            </span>
          </div>
          <span
            style={{
              fontFamily: '"JetBrains Mono", monospace',
              fontSize: '2.2rem',
              fontWeight: 700,
              lineHeight: 1,
              color: isUrgent ? '#ef4444' : '#e8a838',
              transition: 'color 0.3s',
            }}
            className={isUrgent ? 'timer-pulse' : ''}
          >
            {String(isAnswering ? timeLeft : isTimeout ? 0 : timeLeft).padStart(2, '0')}
          </span>
        </div>

        {/* Timer bar */}
        <div style={{ backgroundColor: '#21262d', borderRadius: '999px', height: '6px', overflow: 'hidden' }}>
          <div style={{
            height: '100%',
            borderRadius: '999px',
            backgroundColor: isUrgent ? '#ef4444' : '#e8a838',
            width: isAnswering ? `${timerPct}%` : isTimeout ? '0%' : '100%',
            transition: isAnswering ? 'width 1s linear, background-color 0.3s' : 'width 0.3s ease, background-color 0.3s',
          }} />
        </div>
      </div>

      {/* Question card */}
      <QuestionCard
        q={question}
        qNum={questionNum}
        answer={answer}
        onAnswer={isAnswering ? onAnswer : () => {}}
      />

      {/* Timeout notice */}
      {isTimeout && (
        <div style={{
          backgroundColor: '#ef444418',
          border: '1px solid #ef444440',
          borderRadius: '10px',
          padding: '10px 14px',
          marginTop: '14px',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
        }} className="explanation-slide">
          <AlertCircle style={{ width: '16px', height: '16px', color: '#f87171', flexShrink: 0 }} />
          <span style={{ color: '#f87171', fontSize: '0.82rem', fontWeight: 500 }}>
            Waktu habis! Soal ini dihitung terlewati. Melanjutkan…
          </span>
        </div>
      )}

      {/* Next button (manual only) */}
      {isManual && (
        <div className="explanation-slide" style={{ marginTop: '14px' }}>
          <button
            onClick={onNext}
            style={{
              width: '100%',
              padding: '13px',
              backgroundColor: '#e8a838',
              color: '#0d1117',
              fontWeight: 700,
              fontSize: '0.95rem',
              borderRadius: '12px',
              border: 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '7px',
              transition: 'opacity 0.15s',
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.opacity = '0.88' }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.opacity = '1' }}
          >
            {questionNum < total ? (
              <><ChevronRight style={{ width: '18px', height: '18px' }} /> Soal Berikutnya</>
            ) : (
              <><Trophy style={{ width: '18px', height: '18px' }} /> Lihat Hasil</>
            )}
          </button>
        </div>
      )}
    </div>
  )
}

// ── TentamenResults ────────────────────────────────────────────────────────────

function TentamenResults({ questions, answers, onRestart }: {
  questions: Question[]
  answers: AnswerState[]
  onRestart: () => void
}) {
  const total   = questions.length
  const correct = answers.filter((a, i) => typeof a === 'number' && a === questions[i]?.correct).length
  const skipped = answers.filter(a => a === 'skipped').length
  const wrong   = total - correct - skipped
  const pct     = total > 0 ? Math.round((correct / total) * 100) : 0

  const gradeColor = pct >= 80 ? '#4ade80' : pct >= 60 ? '#e8a838' : '#f87171'
  const gradeLabel = pct >= 80 ? 'Sangat Baik' : pct >= 60 ? 'Cukup Baik' : 'Perlu Belajar Lagi'

  return (
    <div className="quiz-fade-in">
      {/* Score hero */}
      <div style={{
        backgroundColor: '#161b22',
        border: '1px solid #30363d',
        borderRadius: '16px',
        padding: '28px 24px',
        marginBottom: '14px',
        textAlign: 'center',
      }}>
        <Trophy style={{ width: '44px', height: '44px', color: gradeColor, margin: '0 auto 12px' }} />
        <div style={{
          fontFamily: '"DM Serif Display", Georgia, serif',
          fontSize: 'clamp(3.5rem, 15vw, 5rem)',
          fontWeight: 700,
          color: gradeColor,
          lineHeight: 1,
        }}>
          {pct}%
        </div>
        <div style={{ color: gradeColor, fontSize: '0.9rem', fontWeight: 600, marginTop: '6px' }}>{gradeLabel}</div>
        <div style={{ color: '#6e7681', fontSize: '0.78rem', marginTop: '4px' }}>
          {correct} dari {total} soal benar
        </div>
      </div>

      {/* Stats grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px', marginBottom: '14px' }}>
        {[
          { value: correct, label: 'Benar',      bg: '#16a34a20', border: '#16a34a40', color: '#4ade80' },
          { value: wrong,   label: 'Salah',       bg: '#ef444420', border: '#ef444440', color: '#f87171' },
          { value: skipped, label: 'Terlewati',   bg: '#94a3b818', border: '#94a3b835', color: '#94a3b8' },
        ].map(({ value, label, bg, border, color }) => (
          <div key={label} style={{
            backgroundColor: bg,
            border: `1px solid ${border}`,
            borderRadius: '12px',
            padding: '14px',
            textAlign: 'center',
          }}>
            <div style={{ fontFamily: '"JetBrains Mono", monospace', color, fontSize: '1.8rem', fontWeight: 700 }}>{value}</div>
            <div style={{ color, fontSize: '0.7rem', marginTop: '4px', opacity: 0.75 }}>{label}</div>
          </div>
        ))}
      </div>

      {/* Breakdown bar */}
      <div style={{
        backgroundColor: '#161b22',
        border: '1px solid #30363d',
        borderRadius: '12px',
        padding: '14px 16px',
        marginBottom: '20px',
      }}>
        <div style={{ fontSize: '0.75rem', color: '#6e7681', marginBottom: '8px' }}>Distribusi jawaban</div>
        <div style={{ display: 'flex', height: '10px', borderRadius: '999px', overflow: 'hidden', gap: '2px' }}>
          {correct > 0 && (
            <div style={{ flex: correct, backgroundColor: '#4ade80', borderRadius: skipped === 0 && wrong === 0 ? '999px' : '999px 0 0 999px' }} />
          )}
          {wrong > 0 && (
            <div style={{ flex: wrong, backgroundColor: '#f87171', borderRadius: correct === 0 && skipped === 0 ? '999px' : skipped === 0 ? '0 999px 999px 0' : undefined }} />
          )}
          {skipped > 0 && (
            <div style={{ flex: skipped, backgroundColor: '#475569', borderRadius: '0 999px 999px 0' }} />
          )}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '6px', fontSize: '0.68rem', color: '#6e7681' }}>
          <span style={{ color: '#4ade80' }}>{Math.round((correct / total) * 100)}% benar</span>
          <span style={{ color: '#f87171' }}>{Math.round((wrong / total) * 100)}% salah</span>
          <span style={{ color: '#94a3b8' }}>{Math.round((skipped / total) * 100)}% terlewati</span>
        </div>
      </div>

      {/* Restart */}
      <button
        onClick={onRestart}
        style={{
          width: '100%',
          padding: '14px',
          backgroundColor: '#e8a838',
          color: '#0d1117',
          fontWeight: 700,
          fontSize: '1rem',
          borderRadius: '12px',
          border: 'none',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '8px',
          transition: 'opacity 0.15s',
        }}
        onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.opacity = '0.88' }}
        onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.opacity = '1' }}
      >
        <RotateCcw style={{ width: '17px', height: '17px' }} />
        Ulangi Tentamen
      </button>
    </div>
  )
}

// ── QuestionCard ───────────────────────────────────────────────────────────────

function QuestionCard({ q, qNum, answer, onAnswer }: {
  q: Question
  qNum: number
  answer: AnswerState
  onAnswer: (idx: number) => void
}) {
  const catColor  = CATEGORY_COLORS[q.category] ?? 'bg-slate-500/20 text-slate-300 border-slate-500/30'
  const isAnswered = answer !== null

  const optStyle = (idx: number): CSSProperties => {
    if (!isAnswered) {
      return {
        backgroundColor: '#21262d',
        border: '1px solid #30363d',
        color: '#c9d1d9',
        cursor: 'pointer',
      }
    }
    if (idx === q.correct) {
      return { backgroundColor: '#16a34a22', border: '1px solid #16a34a60', color: '#86efac' }
    }
    if (typeof answer === 'number' && idx === answer) {
      return { backgroundColor: '#ef444422', border: '1px solid #ef444460', color: '#fca5a5' }
    }
    return { backgroundColor: '#161b22', border: '1px solid #21262d', color: '#484f58' }
  }

  const letterStyle = (idx: number): CSSProperties => {
    if (!isAnswered) {
      return { border: '1px solid #30363d', color: '#8b949e', backgroundColor: 'transparent' }
    }
    if (idx === q.correct) return { backgroundColor: '#16a34a', border: 'none', color: '#fff' }
    if (typeof answer === 'number' && idx === answer) return { backgroundColor: '#ef4444', border: 'none', color: '#fff' }
    return { border: '1px solid #21262d', color: '#30363d', backgroundColor: 'transparent' }
  }

  return (
    <div style={{
      backgroundColor: '#161b22',
      border: '1px solid #30363d',
      borderRadius: '16px',
      padding: '20px',
    }}>
      {/* Category + image badge */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px', flexWrap: 'wrap' }}>
        <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${catColor}`}>
          {q.category}
        </span>
        {q.img && (
          <span style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.72rem', color: '#58a6ff' }}>
            <ImageIcon style={{ width: '12px', height: '12px' }} /> Bergambar
          </span>
        )}
      </div>

      {/* Question text */}
      <p style={{ color: '#f0f6fc', fontSize: '0.88rem', lineHeight: 1.65, marginBottom: '16px' }}>
        <span style={{ fontFamily: '"JetBrains Mono", monospace', color: '#e8a838', fontWeight: 700, marginRight: '6px' }}>
          {qNum}.
        </span>
        {q.question}
      </p>

      {/* Image */}
      {q.img && (
        <div style={{ borderRadius: '10px', overflow: 'hidden', border: '1px solid #30363d', marginBottom: '14px' }}>
          <img
            src={`./${q.img}`}
            alt={`Gambar soal ${qNum}`}
            style={{ width: '100%', objectFit: 'contain', maxHeight: '280px', backgroundColor: '#fff' }}
          />
        </div>
      )}

      {/* Options */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {q.options.map((opt, idx) => (
          <button
            key={idx}
            onClick={() => !isAnswered && onAnswer(idx)}
            className={!isAnswered ? 'option-hoverable' : ''}
            style={{
              ...optStyle(idx),
              borderRadius: '10px',
              width: '100%',
              textAlign: 'left',
              padding: '10px 13px',
              display: 'flex',
              alignItems: 'flex-start',
              gap: '10px',
              transition: 'all 0.15s',
            }}
          >
            <span style={{
              ...letterStyle(idx),
              borderRadius: '50%',
              width: '24px',
              height: '24px',
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '11px',
              fontWeight: 700,
              marginTop: '1px',
              fontFamily: '"JetBrains Mono", monospace',
              transition: 'all 0.15s',
            }}>
              {LETTERS[idx]}
            </span>
            <span style={{ fontSize: '0.82rem', lineHeight: 1.55, flex: 1 }}>{opt}</span>
            {isAnswered && idx === q.correct && (
              <CheckCircle style={{ width: '15px', height: '15px', color: '#4ade80', flexShrink: 0, marginTop: '2px' }} />
            )}
            {isAnswered && typeof answer === 'number' && idx === answer && idx !== q.correct && (
              <XCircle style={{ width: '15px', height: '15px', color: '#f87171', flexShrink: 0, marginTop: '2px' }} />
            )}
          </button>
        ))}
      </div>

      {/* Explanation */}
      {isAnswered && (
        <div
          style={{
            backgroundColor: '#1f6feb1a',
            border: '1px solid #1f6feb55',
            borderRadius: '10px',
            padding: '14px',
            marginTop: '14px',
          }}
          className="explanation-slide"
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
            <BookOpen style={{ width: '14px', height: '14px', color: '#58a6ff' }} />
            <span style={{ color: '#58a6ff', fontWeight: 600, fontSize: '0.78rem' }}>Penjelasan</span>
          </div>
          <p style={{ color: '#c9d1d9', fontSize: '0.8rem', lineHeight: 1.65, margin: 0 }}>
            {q.explanation}
          </p>
        </div>
      )}
    </div>
  )
}
