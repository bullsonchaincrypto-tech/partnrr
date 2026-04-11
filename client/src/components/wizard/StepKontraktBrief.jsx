import { useState, useEffect, useRef, useCallback } from 'react'
import { ArrowLeft, Check, FileText, User, CreditCard, PenLine, ArrowRight, Download, Loader2, Eye, Pencil, Save, X } from 'lucide-react'
import * as api from '../../services/api'

// ─── Animering ───
function SlideIn({ children, direction = 'right' }) {
  const ref = useRef(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.opacity = '0'
    el.style.transform = direction === 'right' ? 'translateX(40px)' : 'translateX(-40px)'
    requestAnimationFrame(() => {
      el.style.transition = 'opacity 0.35s ease, transform 0.35s ease'
      el.style.opacity = '1'
      el.style.transform = 'translateX(0)'
    })
  }, [])
  return <div ref={ref}>{children}</div>
}

// ─── Progress dots ───
function ProgressDots({ current, total }) {
  return (
    <div className="flex items-center gap-3 mb-8">
      <span className="text-xs text-gray-500 font-mono">{current + 1}/{total}</span>
      <div className="flex gap-1.5">
        {Array.from({ length: total }).map((_, i) => (
          <div
            key={i}
            className={`h-1.5 rounded-full transition-all duration-300 ${
              i === current ? 'w-6 bg-purple-500' : i < current ? 'w-3 bg-purple-500/40' : 'w-3 bg-gray-700'
            }`}
          />
        ))}
      </div>
    </div>
  )
}

// ─── Val-kort (Ja/Nej) ───
function ChoiceCard({ icon, label, description, selected, onClick, shortcut }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-start gap-4 w-full text-left px-5 py-4 rounded-xl border-2 transition-all ${
        selected
          ? 'border-purple-500 bg-purple-500/10 text-purple-300'
          : 'border-gray-700 text-gray-400 hover:border-gray-600 hover:text-gray-300'
      }`}
    >
      <div className="text-2xl mt-0.5">{icon}</div>
      <div className="flex-1">
        <div className="font-semibold text-white text-base">{label}</div>
        {description && <div className="text-sm text-gray-400 mt-0.5">{description}</div>}
      </div>
      <div className="flex items-center gap-2">
        {shortcut && <span className="text-xs text-gray-600 bg-gray-800 px-2 py-0.5 rounded">{shortcut}</span>}
        {selected && <Check className="w-5 h-5 text-purple-400" />}
      </div>
    </button>
  )
}

// Standard-villkor (influencer)
const DEFAULT_VILLKOR = {
  ersattning_per_video: '300',
  max_videos: '5',
  provision_per_signup: '10',
  avtalstid: '30',
}

// Standard-villkor (sponsor)
const DEFAULT_SPONSOR_VILLKOR = {
  samarbetstyp: '',
  vad_ni_erbjuder: '',
  vad_ni_vill_ha: '',
  pris: '',
  avtalstid: '90',
}

const SAMARBETSTYPER = [
  { id: 'logotyp', label: 'Logotyp på hemsida', icon: '🌐', desc: 'Sponsorns logotyp visas på er webbplats' },
  { id: 'content', label: 'Omnämning i content', icon: '📱', desc: 'Nämns i sociala medier, nyhetsbrev, etc.' },
  { id: 'turnering', label: 'Turneringssponsring', icon: '🏆', desc: 'Sponsorn namnger en turnering eller liga' },
  { id: 'banner', label: 'Bannerplats/annons', icon: '📢', desc: 'Annonsplats på er plattform' },
  { id: 'rabattkod', label: 'Exklusiv rabattkod', icon: '🏷️', desc: 'Sponsorns rabattkod till era användare' },
  { id: 'ovrigt', label: 'Annat', icon: '✨', desc: 'Beskriv ert erbjudande i nästa steg' },
]

export default function StepKontraktBrief({
  kontraktBrief, setKontraktBrief,
  attachContracts, setAttachContracts,
  kontaktperson, setKontaktperson,
  foretag,
  outreachType,
  messages,
  next, prev,
}) {
  const [q, setQ] = useState(0)
  const [direction, setDirection] = useState('right')

  // Brief-svar (med defaults)
  const [villSkapaKontrakt, setVillSkapaKontrakt] = useState(
    kontraktBrief?.vill_skapa ?? (attachContracts ? 'ja' : null)
  )
  const [kontakt, setKontakt] = useState(
    kontraktBrief?.kontaktperson || kontaktperson || foretag?.kontaktperson || ''
  )
  const [ersattningPerVideo, setErsattningPerVideo] = useState(
    kontraktBrief?.ersattning_per_video || DEFAULT_VILLKOR.ersattning_per_video
  )
  const [maxVideos, setMaxVideos] = useState(
    kontraktBrief?.max_videos || DEFAULT_VILLKOR.max_videos
  )
  const [provisionPerSignup, setProvisionPerSignup] = useState(
    kontraktBrief?.provision_per_signup ?? DEFAULT_VILLKOR.provision_per_signup
  )
  const [avtalstid, setAvtalstid] = useState(
    kontraktBrief?.avtalstid || DEFAULT_VILLKOR.avtalstid
  )
  const [deadlineDagar, setDeadlineDagar] = useState(
    kontraktBrief?.deadline_dagar ?? ''
  )
  const [extraVillkor, setExtraVillkor] = useState(
    kontraktBrief?.extra_villkor || ''
  )

  // Sponsor-specifika fält
  const [samarbetstyper, setSamarbetstyper] = useState(
    kontraktBrief?.samarbetstyper || []
  )
  const [vadNiErbjuder, setVadNiErbjuder] = useState(
    kontraktBrief?.vad_ni_erbjuder || ''
  )
  const [vadNiVillHa, setVadNiVillHa] = useState(
    kontraktBrief?.vad_ni_vill_ha || ''
  )
  const [sponsorPris, setSponsorPris] = useState(
    kontraktBrief?.sponsor_pris || ''
  )
  const [sponsorAvtalstid, setSponsorAvtalstid] = useState(
    kontraktBrief?.sponsor_avtalstid || DEFAULT_SPONSOR_VILLKOR.avtalstid
  )

  // Kontraktsgenerering state
  const [generating, setGenerating] = useState(false)
  const [contractsGenerated, setContractsGenerated] = useState(kontraktBrief?.contracts_generated || false)
  const [contractBlobs, setContractBlobs] = useState({}) // msgId -> blob URL
  const [contractErrors, setContractErrors] = useState({}) // msgId -> error message
  const [genProgress, setGenProgress] = useState({ current: 0, total: 0 })
  const [genError, setGenError] = useState('')

  const isSponsor = outreachType === 'sponsor'

  // Antal frågor beror på typ:
  // Influencer: 0=ja/nej, 1=kontaktperson, 2=ersättning, 3=extra, 4=sammanfattning
  // Sponsor:    0=ja/nej, 1=kontaktperson, 2=samarbetstyp, 3=erbjudande+pris, 4=extra, 5=sammanfattning
  const totalQuestions = villSkapaKontrakt === 'ja' ? (isSponsor ? 6 : 5) : 1

  const goNext = useCallback(() => {
    setDirection('right')
    setQ(prev => Math.min(prev + 1, totalQuestions - 1))
  }, [totalQuestions])

  const goBack = useCallback(() => {
    setDirection('left')
    setQ(prev => Math.max(prev - 1, 0))
  }, [])

  // Keyboard
  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'Escape' && q > 0) goBack()
      if (q === 0) {
        if (e.key === '1') handleYes()
        if (e.key === '2') handleNo()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [q, goBack])

  const handleYes = () => {
    setVillSkapaKontrakt('ja')
    setAttachContracts(true)
    setTimeout(() => {
      setDirection('right')
      setQ(1)
    }, 150)
  }

  const handleNo = () => {
    setVillSkapaKontrakt('nej')
    setAttachContracts(false)
    setKontraktBrief({ vill_skapa: 'nej' })
    next()
  }

  // Generera kontrakt-PDFer för alla meddelanden
  const handleGenerateContracts = async () => {
    setGenerating(true)
    setGenError('')
    const total = messages.length
    setGenProgress({ current: 0, total })

    const briefData = isSponsor ? {
      vill_skapa: 'ja',
      typ: 'sponsor',
      kontaktperson: kontakt,
      samarbetstyper,
      vad_ni_erbjuder: vadNiErbjuder,
      vad_ni_vill_ha: vadNiVillHa,
      sponsor_pris: sponsorPris,
      sponsor_avtalstid: sponsorAvtalstid,
      extra_villkor: extraVillkor,
      contracts_generated: true,
    } : {
      vill_skapa: 'ja',
      typ: 'influencer',
      kontaktperson: kontakt,
      ersattning_per_video: ersattningPerVideo,
      max_videos: maxVideos,
      provision_per_signup: provisionPerSignup,
      avtalstid,
      deadline_dagar: deadlineDagar || null,
      extra_villkor: extraVillkor,
      contracts_generated: true,
    }

    try {
      // Spara kontraktvillkor till company_profile INNAN vi genererar PDF:erna
      if (foretag?.id) {
        try {
          await api.saveCompanyProfile(foretag.id, {
            company_profile: { kontrakt_brief: briefData },
            kontrakt_brief: briefData,
          })
        } catch (e) { console.log('Kunde inte spara kontraktvillkor:', e.message) }
      }

      const blobs = {}
      const errors = {}
      for (let i = 0; i < messages.length; i++) {
        const msg = messages[i]
        console.log(`[KontraktBrief] Genererar kontrakt ${i+1}/${messages.length}: influencer=${msg.influencer_namn}`)
        setGenProgress({ current: i + 1, total })
        try {
          // Skicka all data direkt — ingen DB-lookup behövs
          const blob = await api.generateKontraktDirect({
            kontaktperson: kontakt,
            influencer: {
              id: msg.influencer_id || msg.prospect_id,
              namn: msg.influencer_namn || msg.prospect_namn,
              kanalnamn: msg.kanalnamn,
              plattform: msg.plattform,
              kontakt_epost: msg.kontakt_epost || msg.prospect_epost,
              referral_kod: msg.referral_kod,
              // Sponsor-specifika fält
              bransch: msg.prospect_bransch || null,
              hemsida: msg.hemsida || msg.kanalnamn || null,
              telefon: msg.telefon || null,
            },
            foretag,
            kontraktVillkor: briefData,
          })
          const url = URL.createObjectURL(blob)
          blobs[msg.id] = url
        } catch (err) {
          console.error(`Kontrakt-fel för ${msg.influencer_namn}:`, err.message)
          errors[msg.id] = err.message
        }
      }
      setContractBlobs(blobs)
      setContractErrors(errors)
      setContractsGenerated(true)

      setKontraktBrief(briefData)
      setKontaktperson(kontakt)
      setAttachContracts(true)
    } catch (err) {
      setGenError(err.message)
    } finally {
      setGenerating(false)
    }
  }

  const handleDownload = (msgId, influencerName) => {
    const url = contractBlobs[msgId]
    if (!url) return
    const a = document.createElement('a')
    a.href = url
    a.download = `kontrakt_${(influencerName || 'influencer').replace(/\s/g, '_')}.pdf`
    a.click()
  }

  const handlePreview = (msgId) => {
    const url = contractBlobs[msgId]
    if (url) window.open(url, '_blank')
  }

  const handleFinish = () => {
    setKontaktperson(kontakt)
    const brief = isSponsor ? {
      vill_skapa: 'ja',
      typ: 'sponsor',
      kontaktperson: kontakt,
      samarbetstyper,
      vad_ni_erbjuder: vadNiErbjuder,
      vad_ni_vill_ha: vadNiVillHa,
      sponsor_pris: sponsorPris,
      sponsor_avtalstid: sponsorAvtalstid,
      extra_villkor: extraVillkor,
      contracts_generated: true,
    } : {
      vill_skapa: 'ja',
      typ: 'influencer',
      kontaktperson: kontakt,
      ersattning_per_video: ersattningPerVideo,
      max_videos: maxVideos,
      provision_per_signup: provisionPerSignup,
      avtalstid,
      deadline_dagar: deadlineDagar || null,
      extra_villkor: extraVillkor,
      contracts_generated: true,
    }
    setKontraktBrief(brief)
    setAttachContracts(true)
    next()
  }

  const renderQuestion = () => {
    switch (q) {
      // ═══ FRÅGA 0: Vill du skapa ett kontrakt? ═══
      case 0:
        return (
          <SlideIn key="kontrakt-q0" direction={direction}>
            <div className="max-w-xl">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-xl bg-purple-500/10 flex items-center justify-center">
                  <FileText className="w-5 h-5 text-purple-400" />
                </div>
                <h2 className="text-2xl font-bold text-white">Vill du skapa ett kontrakt?</h2>
              </div>
              <p className="text-sm text-gray-400 mb-6">
                Ett kontrakt bifogas automatiskt med ditt outreach-meddelande. Du kan anpassa villkoren i nästa steg.
              </p>
              <div className="space-y-3">
                <ChoiceCard
                  icon="📝"
                  label="Ja, bifoga kontrakt"
                  description="AI skapar ett anpassat kontrakt med dina villkor"
                  selected={villSkapaKontrakt === 'ja'}
                  onClick={handleYes}
                  shortcut="1"
                />
                <ChoiceCard
                  icon="⏭️"
                  label="Nej, hoppa över"
                  description="Skicka bara outreach-meddelandet utan kontrakt"
                  selected={villSkapaKontrakt === 'nej'}
                  onClick={handleNo}
                  shortcut="2"
                />
              </div>
            </div>
          </SlideIn>
        )

      // ═══ FRÅGA 1: Kontaktperson ═══
      case 1:
        return (
          <SlideIn key="kontrakt-q1" direction={direction}>
            <div className="max-w-xl">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-xl bg-purple-500/10 flex items-center justify-center">
                  <User className="w-5 h-5 text-purple-400" />
                </div>
                <h2 className="text-2xl font-bold text-white">Vem är kontaktperson?</h2>
              </div>
              <p className="text-sm text-gray-400 mb-6">
                Namn på den person som representerar företaget i kontraktet.
              </p>
              <input
                autoFocus
                type="text"
                value={kontakt}
                onChange={(e) => setKontakt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && kontakt.trim()) {
                    e.preventDefault()
                    goNext()
                  }
                }}
                className="w-full bg-gray-800/50 border border-gray-700 focus:border-purple-500 rounded-xl text-white text-lg py-3 px-4 placeholder-gray-600 focus:outline-none transition-colors"
                placeholder="T.ex. Jimmy Munter"
              />
              <div className="flex items-center gap-3 mt-5">
                <button type="button" onClick={goNext} disabled={!kontakt.trim()}
                  className="flex items-center gap-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-30 disabled:cursor-not-allowed text-white px-5 py-2.5 rounded-lg font-medium text-sm transition-colors">
                  OK <Check className="w-4 h-4" />
                </button>
                <span className="text-xs text-gray-500">Enter ↵</span>
              </div>
            </div>
          </SlideIn>
        )

      // ═══ FRÅGA 2: Ersättning (influencer) ELLER Samarbetstyp (sponsor) ═══
      case 2:
        if (isSponsor) {
          return (
            <SlideIn key="kontrakt-q2-sponsor" direction={direction}>
              <div className="max-w-xl">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center">
                    <CreditCard className="w-5 h-5 text-blue-400" />
                  </div>
                  <h2 className="text-2xl font-bold text-white">Vilken typ av samarbete?</h2>
                </div>
                <p className="text-sm text-gray-400 mb-6">
                  Välj vad ni vill erbjuda sponsorn. Välj en eller flera.
                </p>
                <div className="space-y-2">
                  {SAMARBETSTYPER.map(typ => {
                    const selected = samarbetstyper.includes(typ.id)
                    return (
                      <button key={typ.id} type="button"
                        onClick={() => setSamarbetstyper(prev =>
                          prev.includes(typ.id) ? prev.filter(t => t !== typ.id) : [...prev, typ.id]
                        )}
                        className={`flex items-center gap-3 w-full text-left px-4 py-3 rounded-xl border-2 transition-all ${
                          selected ? 'border-blue-500 bg-blue-500/10' : 'border-gray-700 hover:border-gray-600'
                        }`}>
                        <span className="text-xl">{typ.icon}</span>
                        <div className="flex-1">
                          <div className="font-medium text-white text-sm">{typ.label}</div>
                          <div className="text-xs text-gray-400">{typ.desc}</div>
                        </div>
                        {selected && <Check className="w-4 h-4 text-blue-400" />}
                      </button>
                    )
                  })}
                </div>
                <div className="flex items-center gap-3 mt-5">
                  <button type="button" onClick={goNext} disabled={samarbetstyper.length === 0}
                    className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-30 disabled:cursor-not-allowed text-white px-5 py-2.5 rounded-lg font-medium text-sm transition-colors">
                    OK <Check className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </SlideIn>
          )
        }
        return (
          <SlideIn key="kontrakt-q2" direction={direction}>
            <div className="max-w-xl">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-xl bg-purple-500/10 flex items-center justify-center">
                  <CreditCard className="w-5 h-5 text-purple-400" />
                </div>
                <h2 className="text-2xl font-bold text-white">Ersättning & villkor</h2>
              </div>
              <p className="text-sm text-gray-400 mb-6">
                Anpassa ersättningen eller behåll standardvillkoren.
              </p>
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-1.5">SEK per video</label>
                    <div className="relative">
                      <input autoFocus type="number" value={ersattningPerVideo}
                        onChange={(e) => setErsattningPerVideo(e.target.value)}
                        className="w-full bg-gray-800/50 border border-gray-700 focus:border-purple-500 rounded-xl text-white text-lg py-3 px-4 placeholder-gray-600 focus:outline-none transition-colors"
                        placeholder="300" />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">SEK</span>
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-1.5">Max antal videos</label>
                    <input type="number" value={maxVideos}
                      onChange={(e) => setMaxVideos(e.target.value)}
                      className="w-full bg-gray-800/50 border border-gray-700 focus:border-purple-500 rounded-xl text-white text-lg py-3 px-4 placeholder-gray-600 focus:outline-none transition-colors"
                      placeholder="5" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-1.5">SEK per signup (referral)</label>
                    <div className="relative">
                      <input type="number" value={provisionPerSignup}
                        onChange={(e) => setProvisionPerSignup(e.target.value)}
                        className="w-full bg-gray-800/50 border border-gray-700 focus:border-purple-500 rounded-xl text-white text-lg py-3 px-4 placeholder-gray-600 focus:outline-none transition-colors"
                        placeholder="10" />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">SEK</span>
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-1.5">Avtalstid (dagar)</label>
                    <div className="relative">
                      <input type="number" value={avtalstid}
                        onChange={(e) => setAvtalstid(e.target.value)}
                        className="w-full bg-gray-800/50 border border-gray-700 focus:border-purple-500 rounded-xl text-white text-lg py-3 px-4 placeholder-gray-600 focus:outline-none transition-colors"
                        placeholder="30" />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">dagar</span>
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-1.5">Deadline för publicering (dagar efter signering)</label>
                    <div className="relative">
                      <input type="number" value={deadlineDagar}
                        onChange={(e) => setDeadlineDagar(e.target.value)}
                        className="w-full bg-gray-800/50 border border-gray-700 focus:border-purple-500 rounded-xl text-white text-lg py-3 px-4 placeholder-gray-600 focus:outline-none transition-colors"
                        placeholder="Valfritt — t.ex. 5" />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">dagar</span>
                    </div>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3 mt-5">
                <button type="button" onClick={goNext} disabled={!ersattningPerVideo || !maxVideos}
                  className="flex items-center gap-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-30 disabled:cursor-not-allowed text-white px-5 py-2.5 rounded-lg font-medium text-sm transition-colors">
                  OK <Check className="w-4 h-4" />
                </button>
                <span className="text-xs text-gray-500">Enter ↵</span>
              </div>
            </div>
          </SlideIn>
        )

      // ═══ FRÅGA 3: Extra villkor (influencer) ELLER Erbjudande & pris (sponsor) ═══
      case 3:
        if (isSponsor) {
          return (
            <SlideIn key="kontrakt-q3-sponsor" direction={direction}>
              <div className="max-w-xl">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center">
                    <CreditCard className="w-5 h-5 text-blue-400" />
                  </div>
                  <h2 className="text-2xl font-bold text-white">Erbjudande & pris</h2>
                </div>
                <p className="text-sm text-gray-400 mb-6">
                  Beskriv vad ni erbjuder och vad ni vill ha i gengäld.
                </p>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-1.5">Vad erbjuder ni sponsorn?</label>
                    <textarea autoFocus value={vadNiErbjuder}
                      onChange={(e) => setVadNiErbjuder(e.target.value)}
                      rows={3}
                      className="w-full bg-gray-800/50 border border-gray-700 focus:border-blue-500 rounded-xl text-white text-base py-3 px-4 placeholder-gray-600 focus:outline-none transition-colors resize-none"
                      placeholder="T.ex. Logotyp i sidfoten på hemsidan + omnämning i 2 sociala medier-inlägg per månad + bannerplats vid turneringar" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-1.5">Vad vill ni ha i gengäld?</label>
                    <textarea value={vadNiVillHa}
                      onChange={(e) => setVadNiVillHa(e.target.value)}
                      rows={2}
                      className="w-full bg-gray-800/50 border border-gray-700 focus:border-blue-500 rounded-xl text-white text-base py-3 px-4 placeholder-gray-600 focus:outline-none transition-colors resize-none"
                      placeholder="T.ex. Månatlig ersättning, produkter till tävlingar, korsmarknadsföring" />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-1.5">Pris / ersättning</label>
                      <input type="text" value={sponsorPris}
                        onChange={(e) => setSponsorPris(e.target.value)}
                        className="w-full bg-gray-800/50 border border-gray-700 focus:border-blue-500 rounded-xl text-white text-lg py-3 px-4 placeholder-gray-600 focus:outline-none transition-colors"
                        placeholder="T.ex. 5 000 SEK/mån" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-1.5">Avtalstid (dagar)</label>
                      <div className="relative">
                        <input type="number" value={sponsorAvtalstid}
                          onChange={(e) => setSponsorAvtalstid(e.target.value)}
                          className="w-full bg-gray-800/50 border border-gray-700 focus:border-blue-500 rounded-xl text-white text-lg py-3 px-4 placeholder-gray-600 focus:outline-none transition-colors"
                          placeholder="90" />
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">dagar</span>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3 mt-5">
                  <button type="button" onClick={goNext} disabled={!vadNiErbjuder.trim()}
                    className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-30 disabled:cursor-not-allowed text-white px-5 py-2.5 rounded-lg font-medium text-sm transition-colors">
                    OK <Check className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </SlideIn>
          )
        }
        return (
          <SlideIn key="kontrakt-q3" direction={direction}>
            <div className="max-w-xl">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-xl bg-purple-500/10 flex items-center justify-center">
                  <PenLine className="w-5 h-5 text-purple-400" />
                </div>
                <h2 className="text-2xl font-bold text-white">Något extra att inkludera?</h2>
              </div>
              <p className="text-sm text-gray-400 mb-6">
                Valfritt — specifika krav, exklusivitet, deadlines eller annat som ska stå i kontraktet.
              </p>
              <textarea
                autoFocus
                value={extraVillkor}
                onChange={(e) => setExtraVillkor(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault()
                    goNext()
                  }
                }}
                rows={3}
                className="w-full bg-gray-800/50 border border-gray-700 focus:border-purple-500 rounded-xl text-white text-base py-3 px-4 placeholder-gray-600 focus:outline-none transition-colors resize-none"
                placeholder="T.ex. Exklusivitet — influencern får inte samarbeta med konkurrerande plattformar under avtalstiden."
              />
              <div className="flex items-center gap-3 mt-5">
                <button type="button" onClick={goNext}
                  className="flex items-center gap-2 bg-purple-600 hover:bg-purple-700 text-white px-5 py-2.5 rounded-lg font-medium text-sm transition-colors">
                  {extraVillkor.trim() ? 'OK' : 'Hoppa över'} <Check className="w-4 h-4" />
                </button>
                <span className="text-xs text-gray-500">Ctrl+Enter</span>
              </div>
            </div>
          </SlideIn>
        )

      // ═══ FRÅGA 4: Sammanfattning (influencer) ELLER Extra villkor (sponsor) ═══
      case 4:
        if (isSponsor) {
          return (
            <SlideIn key="kontrakt-q4-sponsor" direction={direction}>
              <div className="max-w-xl">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center">
                    <PenLine className="w-5 h-5 text-blue-400" />
                  </div>
                  <h2 className="text-2xl font-bold text-white">Något extra att inkludera?</h2>
                </div>
                <p className="text-sm text-gray-400 mb-6">
                  Valfritt — specifika krav, exklusivitet eller annat som ska stå i avtalet.
                </p>
                <textarea
                  autoFocus
                  value={extraVillkor}
                  onChange={(e) => setExtraVillkor(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault()
                      goNext()
                    }
                  }}
                  rows={3}
                  className="w-full bg-gray-800/50 border border-gray-700 focus:border-blue-500 rounded-xl text-white text-base py-3 px-4 placeholder-gray-600 focus:outline-none transition-colors resize-none"
                  placeholder="T.ex. Sponsorn får exklusivitet inom sin bransch — inga konkurrerande sponsorer."
                />
                <div className="flex items-center gap-3 mt-5">
                  <button type="button" onClick={goNext}
                    className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 rounded-lg font-medium text-sm transition-colors">
                    {extraVillkor.trim() ? 'OK' : 'Hoppa över'} <Check className="w-4 h-4" />
                  </button>
                  <span className="text-xs text-gray-500">Ctrl+Enter</span>
                </div>
              </div>
            </SlideIn>
          )
        }
        // Fall through to influencer sammanfattning below
        return (
          <SlideIn key="kontrakt-q4" direction={direction}>
            <div className="max-w-2xl">
              {/* Villkors-sammanfattning */}
              <div className="flex items-center gap-3 mb-3">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${contractsGenerated ? 'bg-green-500/10' : 'bg-purple-500/10'}`}>
                  {contractsGenerated ? <Check className="w-5 h-5 text-green-400" /> : <FileText className="w-5 h-5 text-purple-400" />}
                </div>
                <h2 className="text-2xl font-bold text-white">
                  {contractsGenerated ? 'Kontrakt skapade' : 'Kontraktsvillkor'}
                </h2>
              </div>

              {!contractsGenerated && (
                <p className="text-sm text-gray-400 mb-6">
                  Kontrollera villkoren och klicka på "Skapa kontrakt" för att generera PDF:er.
                </p>
              )}

              {/* Villkors-grid */}
              <div className="bg-gray-800/30 rounded-xl p-5 border border-gray-700 space-y-3 mb-6">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-400">Kontaktperson</span>
                  <span className="text-sm text-white font-medium">{kontakt}</span>
                </div>
                <div className="border-t border-gray-700/50" />
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-400">Ersättning per video</span>
                  <span className="text-sm text-white font-medium">{ersattningPerVideo} SEK</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-400">Max antal videos</span>
                  <span className="text-sm text-white font-medium">{maxVideos} st</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-400">Provision per signup</span>
                  <span className="text-sm text-white font-medium">{parseInt(provisionPerSignup) > 0 ? `${provisionPerSignup} SEK` : 'Ingen'}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-400">Avtalstid</span>
                  <span className="text-sm text-white font-medium">{avtalstid} dagar</span>
                </div>
                {deadlineDagar && (
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-gray-400">Deadline för publicering</span>
                    <span className="text-sm text-white font-medium">{deadlineDagar} dagar efter signering</span>
                  </div>
                )}
                {extraVillkor.trim() && (
                  <>
                    <div className="border-t border-gray-700/50" />
                    <div>
                      <span className="text-sm text-gray-400 block mb-1">Extra villkor</span>
                      <span className="text-sm text-white">{extraVillkor}</span>
                    </div>
                  </>
                )}
              </div>

              {/* Genereringsknapp ELLER genererade kontrakt */}
              {!contractsGenerated && !generating && (
                <button
                  type="button"
                  onClick={handleGenerateContracts}
                  className="flex items-center gap-2 bg-purple-600 hover:bg-purple-700 text-white px-6 py-3 rounded-lg font-medium transition-colors"
                >
                  <FileText className="w-5 h-5" />
                  Skapa kontrakt för {messages.length} {messages.length === 1 ? 'influencer' : 'influencers'}
                </button>
              )}

              {/* Genereringsindikator */}
              {generating && (
                <div className="bg-gray-800/50 rounded-lg p-4 border border-gray-700">
                  <div className="flex items-center gap-3">
                    <Loader2 className="w-5 h-5 animate-spin text-purple-400" />
                    <span className="text-sm text-gray-300">
                      Genererar kontrakt... {genProgress.current}/{genProgress.total}
                    </span>
                  </div>
                  <div className="w-full bg-gray-700 rounded-full h-1.5 mt-3">
                    <div
                      className="bg-purple-500 h-1.5 rounded-full transition-all duration-300"
                      style={{ width: `${genProgress.total > 0 ? (genProgress.current / genProgress.total) * 100 : 0}%` }}
                    />
                  </div>
                </div>
              )}

              {genError && <p className="text-red-400 text-sm mt-3">{genError}</p>}

              {/* Genererade kontrakt — lista */}
              {contractsGenerated && (
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold text-gray-300 mb-2">
                    {Object.keys(contractBlobs).length} kontrakt genererade
                  </h3>

                  {messages.map((msg) => {
                    const hasContract = !!contractBlobs[msg.id]
                    const name = msg.influencer_namn || msg.prospect_namn || 'Okänd'
                    return (
                      <div key={msg.id} className={`flex items-center justify-between p-4 rounded-lg border ${
                        hasContract ? 'bg-green-500/5 border-green-500/20' : 'bg-gray-800/30 border-gray-700'
                      }`}>
                        <div className="flex items-center gap-3">
                          <FileText className={`w-5 h-5 ${hasContract ? 'text-green-400' : 'text-gray-500'}`} />
                          <div>
                            <span className="text-sm text-white font-medium">{name}</span>
                            <span className="text-xs text-gray-500 ml-2">{msg.plattform || 'YouTube'}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {hasContract ? (
                            <>
                              <button
                                onClick={() => handlePreview(msg.id)}
                                className="flex items-center gap-1.5 text-sm text-purple-400 hover:text-purple-300 px-3 py-1.5 rounded-lg hover:bg-purple-500/10 transition-colors"
                              >
                                <Eye className="w-4 h-4" /> Visa
                              </button>
                              <button
                                onClick={() => handleDownload(msg.id, name)}
                                className="flex items-center gap-1.5 text-sm text-green-400 hover:text-green-300 px-3 py-1.5 rounded-lg hover:bg-green-500/10 transition-colors"
                              >
                                <Download className="w-4 h-4" /> Ladda ner
                              </button>
                            </>
                          ) : (
                            <span className="text-xs text-yellow-400" title={contractErrors[msg.id] || ''}>
                              {contractErrors[msg.id] || 'Kunde inte genereras'}
                            </span>
                          )}
                        </div>
                      </div>
                    )
                  })}

                  {/* Fortsätt-knapp */}
                  <div className="flex items-center gap-3 mt-6 pt-4 border-t border-gray-700/50">
                    <button
                      type="button"
                      onClick={handleFinish}
                      className="flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white px-6 py-2.5 rounded-lg font-medium transition-colors"
                    >
                      Fortsätt till granska <ArrowRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          </SlideIn>
        )

      // ═══ FRÅGA 5: Sponsor-sammanfattning + Generering ═══
      case 5:
        if (!isSponsor) return null  // Bara sponsors har 6 frågor
        return (
          <SlideIn key="kontrakt-q5-sponsor" direction={direction}>
            <div className="max-w-2xl">
              <div className="flex items-center gap-3 mb-3">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${contractsGenerated ? 'bg-green-500/10' : 'bg-blue-500/10'}`}>
                  {contractsGenerated ? <Check className="w-5 h-5 text-green-400" /> : <FileText className="w-5 h-5 text-blue-400" />}
                </div>
                <h2 className="text-2xl font-bold text-white">
                  {contractsGenerated ? 'Avtal skapade' : 'Sponsoravtal — sammanfattning'}
                </h2>
              </div>

              {!contractsGenerated && (
                <p className="text-sm text-gray-400 mb-6">
                  Kontrollera villkoren och klicka för att generera avtal.
                </p>
              )}

              <div className="bg-gray-800/30 rounded-xl p-5 border border-gray-700 space-y-3 mb-6">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-400">Kontaktperson</span>
                  <span className="text-sm text-white font-medium">{kontakt}</span>
                </div>
                <div className="border-t border-gray-700/50" />
                <div className="flex justify-between items-start">
                  <span className="text-sm text-gray-400">Samarbetstyper</span>
                  <div className="text-right">
                    {samarbetstyper.map(t => {
                      const typ = SAMARBETSTYPER.find(s => s.id === t)
                      return <span key={t} className="inline-block text-xs bg-blue-500/15 text-blue-300 px-2 py-0.5 rounded ml-1 mb-1">{typ?.icon} {typ?.label}</span>
                    })}
                  </div>
                </div>
                <div className="border-t border-gray-700/50" />
                <div>
                  <span className="text-sm text-gray-400 block mb-1">Vad ni erbjuder</span>
                  <span className="text-sm text-white">{vadNiErbjuder}</span>
                </div>
                {vadNiVillHa.trim() && (
                  <div>
                    <span className="text-sm text-gray-400 block mb-1">Vad ni vill ha i gengäld</span>
                    <span className="text-sm text-white">{vadNiVillHa}</span>
                  </div>
                )}
                <div className="border-t border-gray-700/50" />
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-400">Pris / ersättning</span>
                  <span className="text-sm text-white font-medium">{sponsorPris || 'Ej angivet'}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-400">Avtalstid</span>
                  <span className="text-sm text-white font-medium">{sponsorAvtalstid} dagar</span>
                </div>
                {extraVillkor.trim() && (
                  <>
                    <div className="border-t border-gray-700/50" />
                    <div>
                      <span className="text-sm text-gray-400 block mb-1">Extra villkor</span>
                      <span className="text-sm text-white">{extraVillkor}</span>
                    </div>
                  </>
                )}
              </div>

              {!contractsGenerated && !generating && (
                <button type="button" onClick={handleGenerateContracts}
                  className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-lg font-medium transition-colors">
                  <FileText className="w-5 h-5" />
                  Skapa avtal för {messages.length} {messages.length === 1 ? 'sponsor' : 'sponsorer'}
                </button>
              )}

              {generating && (
                <div className="bg-gray-800/50 rounded-lg p-4 border border-gray-700">
                  <div className="flex items-center gap-3">
                    <Loader2 className="w-5 h-5 animate-spin text-blue-400" />
                    <span className="text-sm text-gray-300">Genererar avtal... {genProgress.current}/{genProgress.total}</span>
                  </div>
                  <div className="w-full bg-gray-700 rounded-full h-1.5 mt-3">
                    <div className="bg-blue-500 h-1.5 rounded-full transition-all duration-300"
                      style={{ width: `${genProgress.total > 0 ? (genProgress.current / genProgress.total) * 100 : 0}%` }} />
                  </div>
                </div>
              )}

              {genError && <p className="text-red-400 text-sm mt-3">{genError}</p>}

              {contractsGenerated && (
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold text-gray-300 mb-2">
                    {Object.keys(contractBlobs).length} avtal genererade
                  </h3>
                  {messages.map((msg) => {
                    const hasContract = !!contractBlobs[msg.id]
                    const name = msg.influencer_namn || msg.prospect_namn || 'Okänd'
                    return (
                      <div key={msg.id} className={`flex items-center justify-between p-4 rounded-lg border ${
                        hasContract ? 'bg-green-500/5 border-green-500/20' : 'bg-gray-800/30 border-gray-700'
                      }`}>
                        <div className="flex items-center gap-3">
                          <FileText className={`w-5 h-5 ${hasContract ? 'text-green-400' : 'text-gray-500'}`} />
                          <div>
                            <span className="text-sm text-white font-medium">{name}</span>
                            <span className="text-xs text-gray-500 ml-2">{msg.prospect_bransch || 'Sponsor'}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {hasContract ? (
                            <>
                              <button onClick={() => handlePreview(msg.id)}
                                className="flex items-center gap-1.5 text-sm text-blue-400 hover:text-blue-300 px-3 py-1.5 rounded-lg hover:bg-blue-500/10 transition-colors">
                                <Eye className="w-4 h-4" /> Visa
                              </button>
                              <button onClick={() => handleDownload(msg.id, name)}
                                className="flex items-center gap-1.5 text-sm text-green-400 hover:text-green-300 px-3 py-1.5 rounded-lg hover:bg-green-500/10 transition-colors">
                                <Download className="w-4 h-4" /> Ladda ner
                              </button>
                            </>
                          ) : (
                            <span className="text-xs text-yellow-400">{contractErrors[msg.id] || 'Kunde inte genereras'}</span>
                          )}
                        </div>
                      </div>
                    )
                  })}
                  <div className="flex items-center gap-3 mt-6 pt-4 border-t border-gray-700/50">
                    <button type="button" onClick={handleFinish}
                      className="flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white px-6 py-2.5 rounded-lg font-medium transition-colors">
                      Fortsätt till granska <ArrowRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          </SlideIn>
        )

      default:
        return null
    }
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-3 mb-2">
        <FileText className="w-6 h-6 text-purple-500" />
        <h2 className="text-xl font-bold">Kontrakt</h2>
      </div>
      <p className="text-sm text-gray-500 mb-6">
        {villSkapaKontrakt === 'ja'
          ? 'Anpassa villkoren för kontraktet som bifogas ditt meddelande.'
          : 'Vill du bifoga ett kontrakt med ditt outreach-meddelande?'}
      </p>

      {/* Progress dots — visa bara om ja valt */}
      {villSkapaKontrakt === 'ja' && (
        <ProgressDots current={q} total={totalQuestions} />
      )}

      {/* Frågor */}
      {renderQuestion()}

      {/* Tillbaka-knapp */}
      <div className="mt-8">
        <button
          onClick={q === 0 ? prev : goBack}
          className="flex items-center gap-2 text-gray-400 hover:text-white text-sm transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          {q === 0 ? 'Tillbaka till meddelanden' : 'Föregående fråga'}
        </button>
      </div>
    </div>
  )
}
