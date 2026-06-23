import { useState, useEffect, useCallback, useRef, useMemo, type CSSProperties } from 'react'
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
type TentamenDifficulty = 'cheetah' | 'normal' | 'folivora' | 'bekicot'

// ── Constants ──────────────────────────────────────────────────────────────────

const LETTERS = ['A', 'B', 'C', 'D', 'E']
const EXAM_TIMER = 30 // default fallback

const DIFFICULTY_CONFIG: Record<TentamenDifficulty, { label: string; emoji: string; timerSeconds: number; desc: string; color: string }> = {
  cheetah:  { label: 'Cheetah',      emoji: '🐆', timerSeconds: 30,           desc: 'am fast boi',                        color: '#f59e0b' },
  normal:   { label: 'Orang Normal', emoji: '🧍', timerSeconds: 60,           desc: 'dasar normies',                      color: '#58a6ff' },
  folivora: { label: 'Folivora',     emoji: '🦥', timerSeconds: 300,          desc: 'pasti pas ditanya jawabannya "hah?"', color: '#86efac' },
  bekicot:  { label: 'Bekicot',      emoji: '🐌', timerSeconds: 0,            desc: 'mode biasa aja kalau gitu',          color: '#c084fc' },
}

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
const LOAD_BATCH = 15 // jumlah soal yang dimuat sekali render/klik "Lebih banyak"

// answersMap disimpan per-id soal (bukan per-index), sehingga jawaban yang
// dikerjakan di kategori manapun tetap konsisten saat dilihat dari kategori
// "Semua" maupun kategori lain — switch kategori tidak pernah reset progres.
interface SavedBiasaState {
  selectedCategory: string
  shuffleOn: boolean
  answersMap: Record<string, AnswerState>
}

// Format lama (sebelum refactor answersMap) — dipakai untuk migrasi otomatis
// agar progres lama milik user tidak hilang.
interface LegacySavedBiasaState {
  selectedCategory: string
  shuffleOn: boolean
  activeQuestions: Question[]
  answers: AnswerState[]
}

function loadBiasa(): SavedBiasaState | null {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && 'answersMap' in parsed) {
      return parsed as SavedBiasaState
    }
    // Migrasi dari format lama (array activeQuestions + answers sejajar index)
    const legacy = parsed as LegacySavedBiasaState
    if (legacy && Array.isArray(legacy.activeQuestions) && Array.isArray(legacy.answers)) {
      const answersMap: Record<string, AnswerState> = {}
      legacy.activeQuestions.forEach((q, i) => {
        if (legacy.answers[i] !== null && legacy.answers[i] !== undefined) {
          answersMap[q.id] = legacy.answers[i]
        }
      })
      return {
        selectedCategory: legacy.selectedCategory ?? 'Semua',
        shuffleOn: legacy.shuffleOn ?? false,
        answersMap,
      }
    }
    return null
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

  // Header hide state
  const [headerHidden, setHeaderHidden] = useState(false)

  // Mode Biasa state — loaded from localStorage on mount
  const [biasaLoaded, setBiasaLoaded]             = useState(false) // true once restore-from-storage pass has run
  const [biasaCategory, setBiasaCategory]         = useState('Semua')
  const [biasaShuffleOn, setBiasaShuffleOn]       = useState(false)
  // Jawaban disimpan per-id soal (global, lintas kategori) — bukan per-index
  // dari list yang sedang difilter. Ini yang membuat progres "Semua" selalu
  // ikut mencatat apapun yang dikerjakan dari kategori lain.
  const [biasaAnswersMap, setBiasaAnswersMap]     = useState<Record<string, AnswerState>>({})
  // Pagination — hanya render N soal pertama dulu agar tidak lag, terutama
  // di kategori "Semua" yang soalnya banyak.
  const [biasaVisibleCount, setBiasaVisibleCount] = useState(LOAD_BATCH)

  // Mode Tentamen state — ephemeral, no storage
  const [tentamenState, setTentamenState]         = useState<AppState>('setup')
  const [tentamenCategory, setTentamenCategory]   = useState('Semua')
  const [tentamenShuffleOn, setTentamenShuffleOn] = useState(false)
  const [tentamenQuestions, setTentamenQuestions] = useState<Question[]>([])
  const [tentamenAnswers, setTentamenAnswers]     = useState<AnswerState[]>([])
  const [currentIdx, setCurrentIdx]               = useState(0)
  const [tentamenDifficulty, setTentamenDifficulty] = useState<TentamenDifficulty>('normal')
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
    if (saved) {
      setBiasaCategory(saved.selectedCategory || 'Semua')
      setBiasaShuffleOn(!!saved.shuffleOn)
      setBiasaAnswersMap(saved.answersMap || {})
    }
    setBiasaVisibleCount(LOAD_BATCH)
    setBiasaLoaded(true)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [questions])

  // ── Persist biasa state to localStorage whenever it changes ──
  useEffect(() => {
    if (!biasaLoaded) return
    saveBiasa({
      selectedCategory: biasaCategory,
      shuffleOn: biasaShuffleOn,
      answersMap: biasaAnswersMap,
    })
  }, [biasaLoaded, biasaCategory, biasaShuffleOn, biasaAnswersMap])

  // ── Tentamen: timer countdown ──
  useEffect(() => {
    if (quizMode !== 'tentamen' || tentamenState !== 'running' || qPhase !== 'answering') return
    // Bekicot = no timer
    if (tentamenDifficulty === 'bekicot') return
    if (timeLeft === 0) {
      setTentamenAnswers(prev => { const n = [...prev]; n[currentIdx] = 'skipped'; return n })
      setQPhase('answered_timeout')
      return
    }
    const t = setTimeout(() => setTimeLeft(p => p - 1), 1000)
    return () => clearTimeout(t)
  }, [quizMode, tentamenState, qPhase, timeLeft, currentIdx, tentamenDifficulty])

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
  const categories = ['Semua', ...Array.from(new Set(questions.map(q => q.category))).sort()]

  // Simpan urutan soal yang sudah di-shuffle per-kategori agar tidak berubah
  // saat user ganti kategori lalu kembali. Key = `${cat}__shuffle`.
  const shuffleOrderCache = useRef<Record<string, Question[]>>({})

  // Full (unpaginated) list of soal untuk kategori + shuffle yang sedang aktif.
  // Jika shuffle ON, pakai cache sehingga urutan stabil saat ganti kategori & kembali.
  // Jawaban tidak pernah direset di sini — disimpan terpisah di biasaAnswersMap.
  const biasaAllQuestions = useMemo(() => {
    const base = biasaCategory === 'Semua' ? questions : questions.filter(q => q.category === biasaCategory)
    if (!biasaShuffleOn) {
      // Non-shuffle: hapus cache shuffle untuk kategori ini agar fresh kalau shuffle dinyalakan lagi
      delete shuffleOrderCache.current[`${biasaCategory}__shuffle`]
      return base
    }
    const cacheKey = `${biasaCategory}__shuffle`
    const cached = shuffleOrderCache.current[cacheKey]
    // Cek apakah cache masih valid: set id harus sama dengan soal aktif
    const baseIds = new Set(base.map(q => q.id))
    if (cached && cached.length === base.length && cached.every(q => baseIds.has(q.id))) {
      return cached
    }
    // Buat shuffle baru dan simpan ke cache
    const shuffled = shuffleArray(base)
    shuffleOrderCache.current[cacheKey] = shuffled
    return shuffled
  }, [biasaCategory, biasaShuffleOn, questions])

  // Subset yang benar-benar dirender saat ini (pagination, hindari lag).
  const biasaQuestions = useMemo(
    () => biasaAllQuestions.slice(0, biasaVisibleCount),
    [biasaAllQuestions, biasaVisibleCount]
  )

  // ── Mode Biasa handlers ──
  // Reset = satu-satunya cara progres biasa benar-benar dihapus (semua kategori).
  const handleResetBiasa = useCallback(() => {
    clearBiasa()
    setBiasaAnswersMap({})
    setBiasaVisibleCount(LOAD_BATCH)
    // Hapus semua cache shuffle agar urutan baru saat mulai lagi
    shuffleOrderCache.current = {}
  }, [])

  const handleBiasaFilterChange = useCallback((cat: string, currentAnswersMap: Record<string, AnswerState>, allQs: Question[]) => {
    setBiasaCategory(cat)
    // Hitung berapa soal di kategori ini yang sudah dijawab, lalu tampilkan
    // minimal sebanyak itu + satu batch ke depan — sehingga soal yang sudah
    // dikerjakan tetap terlihat dan tidak "menghilang" saat kembali ke kategori.
    const catQuestions = cat === 'Semua' ? allQs : allQs.filter(q => q.category === cat)
    const answeredInCat = catQuestions.filter(q => currentAnswersMap[q.id] !== undefined && currentAnswersMap[q.id] !== null).length
    const minVisible = Math.max(answeredInCat + LOAD_BATCH, LOAD_BATCH)
    setBiasaVisibleCount(Math.min(minVisible, catQuestions.length || LOAD_BATCH))
  }, [])

  const handleBiasaShuffleToggle = () => {
    setBiasaShuffleOn(p => !p)
    // Saat toggle shuffle, reset visibleCount ke batch pertama
    // tapi jangan reset jawaban
    setBiasaVisibleCount(LOAD_BATCH)
  }

  const handleBiasaLoadMore = useCallback(() => {
    setBiasaVisibleCount(p => Math.min(p + LOAD_BATCH, biasaAllQuestions.length))
  }, [biasaAllQuestions.length])

  const biasaAnswersMapRef = useRef<Record<string, AnswerState>>({})
  useEffect(() => { biasaAnswersMapRef.current = biasaAnswersMap }, [biasaAnswersMap])

  const handleAnswerBiasa = useCallback((qId: string, optIdx: number, correct: number) => {
    // Check BEFORE setState so playSound is called outside the updater
    if (biasaAnswersMapRef.current[qId] !== undefined && biasaAnswersMapRef.current[qId] !== null) return
    setBiasaAnswersMap(prev => {
      if (prev[qId] !== undefined && prev[qId] !== null) return prev
      return { ...prev, [qId]: optIdx }
    })
    playSound(optIdx === correct)
  }, [playSound])

  // ── Mode Tentamen handlers ──
  const handleStartTentamen = useCallback((difficulty: TentamenDifficulty) => {
    const base = tentamenCategory === 'Semua' ? questions : questions.filter(q => q.category === tentamenCategory)
    const qs = tentamenShuffleOn ? shuffleArray(base) : base
    if (!qs.length) return
    setTentamenDifficulty(difficulty)
    setTentamenQuestions(qs)
    setTentamenAnswers(new Array(qs.length).fill(null))
    setCurrentIdx(0)
    setTimeLeft(DIFFICULTY_CONFIG[difficulty].timerSeconds)
    setQPhase('answering')
    setTentamenState('running')
  }, [tentamenCategory, tentamenShuffleOn, questions])

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
      setTimeLeft(DIFFICULTY_CONFIG[tentamenDifficulty].timerSeconds)
      setQPhase('answering')
    }
  }, [currentIdx, tentamenQuestions.length, tentamenDifficulty])

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
  // Dihitung dari biasaAllQuestions (seluruh soal kategori aktif), bukan hanya
  // yang sedang dirender — supaya tracker tetap akurat walau sebagian soal
  // belum di-"Lebih banyak"-kan.
  const biasaAnsweredCount = biasaAllQuestions.filter(q => biasaAnswersMap[q.id] !== undefined && biasaAnswersMap[q.id] !== null).length
  const biasaCorrectCount  = biasaAllQuestions.filter(q => biasaAnswersMap[q.id] === q.correct).length
  const tentamenQCount = (tentamenCategory === 'Semua' ? questions : questions.filter(q => q.category === tentamenCategory)).length

  return (
    <div style={{ backgroundColor: '#0d1117', minHeight: '100vh' }}>

      {/* ═══ Sticky header + mode bar ═══ */}
      <div style={{ position: 'sticky', top: 0, zIndex: 50 }}>

        {/* Header — collapsible */}
        <div style={{
          overflow: 'hidden',
          maxHeight: headerHidden ? '0px' : '120px',
          transition: 'max-height 0.35s cubic-bezier(0.4,0,0.2,1)',
        }}>
          <header style={{ backgroundColor: '#161b22', borderBottom: '1px solid #21262d', padding: '12px 0' }}>
            <div className="max-w-3xl mx-auto px-4">
              {/* Dotleav note */}
              <div style={{
                backgroundColor: '#e8a83810',
                border: '1px solid #e8a83830',
                borderRadius: '8px',
                padding: '7px 12px',
                marginBottom: '10px',
                fontSize: '0.7rem',
                color: '#8b949e',
                lineHeight: 1.5,
              }}>
                🗿 <span style={{ color: '#e8a83899', fontWeight: 600 }}>Dotleav's note*:</span>{' '}
                Latihan soal ini dibuat berdasarkan OV, Buku blok, gambar dari google dan praktikum serta mimpi dan harapan untuk masa depan yang kelam. Soal bertujuan untuk dijadikan alat latihan dan tidak menjamin responsi akan sama persis.
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '6px' }}>
                <h1 style={{
                  fontFamily: '"DM Serif Display", Georgia, serif',
                  color: '#e8a838',
                  fontSize: 'clamp(1.1rem, 4vw, 1.6rem)',
                  fontWeight: 700,
                  lineHeight: 1.2,
                  margin: 0,
                }}>
                  Latihan Soal Farmako 2G
                </h1>

                {/* Right side: tracker only (mute dipindah ke mode bar) */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  {quizMode === 'biasa' && biasaLoaded && (
                    <div style={{ textAlign: 'right', minWidth: '70px' }}>
                      <div style={{
                        fontFamily: '"JetBrains Mono", monospace',
                        color: '#e8a838',
                        fontSize: '0.9rem',
                        fontWeight: 700,
                      }}>
                        {biasaAnsweredCount}/{biasaAllQuestions.length}
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
                </div>
              </div>
            </div>
          </header>
        </div>

        {/* Mode bar */}
        <div style={{ backgroundColor: '#161b22', borderBottom: '1px solid #30363d', padding: '8px 0' }}>
          <div className="max-w-3xl mx-auto px-4 flex items-center gap-2">
            {/* Hide header toggle — placed first/leftmost, before mode buttons */}
            <button
              onClick={() => setHeaderHidden(h => !h)}
              title={headerHidden ? 'Tampilkan header' : 'Sembunyikan header'}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                fontSize: '0.72rem',
                color: headerHidden ? '#e8a838' : '#6e7681',
                background: 'none',
                border: `1px solid ${headerHidden ? '#e8a83860' : '#30363d'}`,
                cursor: 'pointer',
                padding: '4px 9px',
                borderRadius: '999px',
                transition: 'all 0.2s',
                flexShrink: 0,
              }}
            >
              <span style={{
                display: 'inline-block',
                transition: 'transform 0.3s',
                transform: headerHidden ? 'rotate(180deg)' : 'rotate(0deg)',
                fontSize: '0.8rem',
              }}>▲</span>
              {headerHidden ? 'Tampilkan' : 'Sembunyikan'}
            </button>

            {/* Mute button — always visible di mode bar */}
            <button
              onClick={() => setIsMuted(m => !m)}
              title={isMuted ? 'Nyalakan suara' : 'Matikan suara'}
              style={{
                background: 'none',
                border: `1px solid ${isMuted ? '#30363d' : '#e8a83860'}`,
                borderRadius: '6px',
                padding: '4px 8px',
                cursor: 'pointer',
                color: isMuted ? '#6e7681' : '#e8a838',
                fontSize: '1rem',
                lineHeight: 1,
                flexShrink: 0,
              }}
            >
              {isMuted ? '🔇' : '🔊'}
            </button>

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
            {quizMode === 'biasa' && biasaLoaded && (
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
                    if (quizMode === 'biasa') handleBiasaFilterChange(cat, biasaAnswersMap, questions)
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
        {quizMode === 'biasa' && biasaLoaded && (
          <BiasaMode
            questions={biasaQuestions}
            totalCount={biasaAllQuestions.length}
            answeredCount={biasaAnsweredCount}
            correctCount={biasaCorrectCount}
            answersMap={biasaAnswersMap}
            onAnswer={handleAnswerBiasa}
            hasMore={biasaVisibleCount < biasaAllQuestions.length}
            onLoadMore={handleBiasaLoadMore}
          />
        )}
        {quizMode === 'biasa' && !biasaLoaded && (
          <div style={{ color: '#6e7681', textAlign: 'center', marginTop: '60px', fontSize: '0.88rem' }}>
            Memuat soal…
          </div>
        )}

        {/* ── Mode Tentamen ── */}
        {quizMode === 'tentamen' && tentamenState === 'setup' && (
          <SetupCard questionCount={tentamenQCount} onStart={handleStartTentamen} difficulty={tentamenDifficulty} onDifficultyChange={setTentamenDifficulty} />
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
            difficulty={tentamenDifficulty}
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

function SetupCard({ questionCount, onStart, difficulty, onDifficultyChange }: {
  questionCount: number
  onStart: (difficulty: TentamenDifficulty) => void
  difficulty: TentamenDifficulty
  onDifficultyChange: (d: TentamenDifficulty) => void
}) {
  const cfg = DIFFICULTY_CONFIG[difficulty]
  const timerSec = cfg.timerSeconds
  const estLabel = (() => {
    if (timerSec === 0) return '∞'
    const totalSec = questionCount * timerSec
    if (totalSec < 60) return `${totalSec} dtk`
    return `${Math.ceil(totalSec / 60)} menit`
  })()
  const timerLabel = timerSec === 0 ? '∞' : `${timerSec}s`

  return (
    <div className="quiz-fade-in">
      {/* Difficulty selector */}
      <div style={{ marginBottom: '16px' }}>
        <div style={{ fontSize: '0.72rem', color: '#6e7681', marginBottom: '10px', textTransform: 'uppercase', letterSpacing: '0.07em' }}>
          Tingkat Kesulitan
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px' }}>
          {(Object.keys(DIFFICULTY_CONFIG) as TentamenDifficulty[]).map(d => {
            const dcfg = DIFFICULTY_CONFIG[d]
            const isActive = difficulty === d
            return (
              <button
                key={d}
                onClick={() => onDifficultyChange(d)}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'flex-start',
                  gap: '8px',
                  padding: '18px 16px',
                  borderRadius: '14px',
                  border: isActive ? `2px solid ${dcfg.color}` : '1px solid #30363d',
                  backgroundColor: isActive ? `${dcfg.color}18` : '#161b22',
                  cursor: 'pointer',
                  transition: 'all 0.18s',
                  textAlign: 'left',
                  minHeight: '110px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '1.5rem', lineHeight: 1 }}>{dcfg.emoji}</span>
                  <span style={{ color: isActive ? dcfg.color : '#e6edf3', fontWeight: 700, fontSize: '1rem' }}>
                    {dcfg.label}
                  </span>
                </div>
                <div style={{ fontSize: '0.82rem', color: isActive ? '#c9d1d9' : '#8b949e', lineHeight: 1.4 }}>{dcfg.desc}</div>
                <div style={{
                  fontSize: '0.75rem',
                  color: isActive ? dcfg.color : '#484f58',
                  fontFamily: '"JetBrains Mono", monospace',
                  fontWeight: 700,
                }}>
                  {dcfg.timerSeconds === 0 ? '5-7 hari kerja' : `${dcfg.timerSeconds}s / soal`}
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* Stats row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', marginBottom: '20px' }}>
        {[
          { value: questionCount.toString(), label: 'Soal' },
          { value: timerLabel, label: 'Timer/soal' },
          { value: estLabel, label: 'Estimasi' },
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
        onClick={() => onStart(difficulty)}
        disabled={questionCount === 0}
        style={{
          width: '100%',
          padding: '14px',
          backgroundColor: cfg.color,
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
        Mulai Tentamen — {cfg.emoji} {cfg.label}
      </button>
    </div>
  )
}

// ── BiasaMode ──────────────────────────────────────────────────────────────────

function BiasaMode({ questions, totalCount, answeredCount, correctCount, answersMap, onAnswer, hasMore, onLoadMore }: {
  questions: Question[]            // subset yang dirender saat ini (sudah dipaginasi)
  totalCount: number               // total soal di kategori aktif (semua, termasuk yang belum dimuat)
  answeredCount: number
  correctCount: number
  answersMap: Record<string, AnswerState>
  onAnswer: (qId: string, optIdx: number, correct: number) => void
  hasMore: boolean
  onLoadMore: () => void
}) {
  const allDone = answeredCount === totalCount && totalCount > 0
  const pct     = totalCount > 0 ? Math.round((answeredCount / totalCount) * 100) : 0
  const remaining = totalCount - questions.length

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
            <span style={{ color: '#c9d1d9', fontFamily: '"JetBrains Mono", monospace', fontWeight: 700 }}>{totalCount}</span>
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
              Skor akhir: {correctCount}/{totalCount} ({Math.round((correctCount / totalCount) * 100)}%)
            </span>
          </div>
        </div>
      )}

      {/* Question list — hanya soal yang sudah dimuat (lihat tombol "Lebih banyak" di bawah) */}
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
              answer={answersMap[q.id] ?? null}
              onAnswer={optIdx => onAnswer(q.id, optIdx, q.correct)}
            />
          </div>
        ))}
      </div>

      {/* Lebih banyak — load soal sisanya, 15 per klik, biar tidak lag */}
      {hasMore && (
        <button
          onClick={onLoadMore}
          style={{
            width: '100%',
            marginTop: '20px',
            padding: '13px',
            backgroundColor: '#161b22',
            border: '1px solid #30363d',
            color: '#e8a838',
            fontWeight: 600,
            fontSize: '0.85rem',
            borderRadius: '12px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
            transition: 'all 0.15s',
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = '#e8a83860' }}
          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = '#30363d' }}
        >
          <ChevronRight style={{ width: '15px', height: '15px' }} />
          Lebih banyak ({Math.min(LOAD_BATCH, remaining)})
        </button>
      )}
    </div>
  )
}

// ── TentamenMode ───────────────────────────────────────────────────────────────

function TentamenMode({ question, questionNum, total, timeLeft, phase, answer, onAnswer, onNext, difficulty }: {
  question: Question
  questionNum: number
  total: number
  timeLeft: number
  phase: QuestionPhase
  answer: AnswerState
  onAnswer: (optIdx: number) => void
  onNext: () => void
  difficulty: TentamenDifficulty
}) {
  const cfg          = DIFFICULTY_CONFIG[difficulty]
  const maxTime      = cfg.timerSeconds || 1 // avoid div-by-zero for bekicot
  const isAnswering  = phase === 'answering'
  const isManual     = phase === 'answered_manual'
  const isTimeout    = phase === 'answered_timeout'
  const isUrgent     = timeLeft <= 10 && isAnswering && difficulty !== 'bekicot'
  const timerPct     = difficulty === 'bekicot' ? 100 : (timeLeft / maxTime) * 100

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
              {difficulty === 'bekicot'
                ? 'No timer 🐌'
                : isAnswering ? 'Waktu tersisa' : isTimeout ? 'Waktu habis!' : 'Selesai'}
            </span>
          </div>
          <span
            style={{
              fontFamily: '"JetBrains Mono", monospace',
              fontSize: '2.2rem',
              fontWeight: 700,
              lineHeight: 1,
              color: isUrgent ? '#ef4444' : cfg.color,
              transition: 'color 0.3s',
            }}
            className={isUrgent ? 'timer-pulse' : ''}
          >
            {difficulty === 'bekicot' ? '∞' : String(isAnswering ? timeLeft : isTimeout ? 0 : timeLeft).padStart(2, '0')}
          </span>
        </div>

        {/* Timer bar */}
        <div style={{ backgroundColor: '#21262d', borderRadius: '999px', height: '6px', overflow: 'hidden' }}>
          <div style={{
            height: '100%',
            borderRadius: '999px',
            backgroundColor: isUrgent ? '#ef4444' : cfg.color,
            width: difficulty === 'bekicot' ? '100%' : isAnswering ? `${timerPct}%` : isTimeout ? '0%' : '100%',
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
