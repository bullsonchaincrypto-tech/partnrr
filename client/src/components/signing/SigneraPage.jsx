import { useState, useEffect } from 'react'
import { FileText, Check, CheckCircle, AlertCircle, Loader2, Download, Shield, Clock, ArrowRight } from 'lucide-react'
import * as api from '../../services/api'

export default function SigneraPage({ token }) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [contract, setContract] = useState(null)
  const [signing, setSigning] = useState(false)
  const [signed, setSigned] = useState(false)
  const [namn, setNamn] = useState('')
  const [accepterar, setAccepterar] = useState(false)

  useEffect(() => {
    loadContract()
  }, [token])

  const loadContract = async () => {
    try {
      setLoading(true)
      const data = await api.getSigningInfo(token)
      setContract(data)
      setNamn(data.influencer_namn || '')
      if (data.already_signed) setSigned(true)
    } catch (err) {
      setError(err.message || 'Kunde inte ladda kontraktet')
    } finally {
      setLoading(false)
    }
  }

  const handleSign = async () => {
    if (!accepterar || !namn.trim()) return
    try {
      setSigning(true)
      const result = await api.submitSignature(token, { namn: namn.trim(), accepterar: true })
      if (result.signed || result.already_signed) {
        setSigned(true)
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setSigning(false)
    }
  }

  // Laddar...
  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin text-purple-400 mx-auto mb-3" />
          <p className="text-gray-400">Laddar avtal...</p>
        </div>
      </div>
    )
  }

  // Fel
  if (error && !contract) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center px-4">
        <div className="max-w-md w-full bg-gray-900 border border-red-500/30 rounded-2xl p-8 text-center">
          <AlertCircle className="w-12 h-12 text-red-400 mx-auto mb-4" />
          <h1 className="text-xl font-bold text-white mb-2">Kunde inte ladda avtalet</h1>
          <p className="text-gray-400 text-sm">{error}</p>
          <p className="text-gray-500 text-xs mt-4">Om du tror att detta är ett fel, kontakta avsändaren.</p>
        </div>
      </div>
    )
  }

  // Redan signerat
  if (signed) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center px-4">
        <div className="max-w-md w-full bg-gray-900 border border-green-500/30 rounded-2xl p-8 text-center">
          <div className="w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center mx-auto mb-4">
            <CheckCircle className="w-10 h-10 text-green-400" />
          </div>
          <h1 className="text-2xl font-bold text-white mb-2">Avtalet är signerat!</h1>
          <p className="text-gray-400 text-sm mb-6">
            Tack {contract?.influencer_namn}! Ditt samarbetsavtal med {contract?.foretag_namn} är nu aktivt.
          </p>
          <div className="bg-gray-800/50 rounded-lg p-4 text-left space-y-2 text-sm mb-6">
            <div className="flex justify-between">
              <span className="text-gray-500">Avtalstid</span>
              <span className="text-gray-300">30 dagar</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Videos</span>
              <span className="text-gray-300">Max {contract?.videos_required || 5} st</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Ersättning</span>
              <span className="text-gray-300">300 SEK/video + 10 SEK/signup</span>
            </div>
          </div>
          <a
            href={api.getSigningPdfUrl(token)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 text-purple-400 hover:text-purple-300 text-sm"
          >
            <Download className="w-4 h-4" /> Ladda ner avtal som PDF
          </a>
        </div>
      </div>
    )
  }

  // Signeringsformulär
  return (
    <div className="min-h-screen bg-gray-950 py-8 px-4">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center mx-auto mb-4 shadow-lg shadow-purple-500/25">
            <FileText className="w-6 h-6 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white">Samarbetsavtal</h1>
          <p className="text-gray-400 mt-1">{contract.foretag_namn} × {contract.influencer_namn}</p>
        </div>

        {/* Avtalsöversikt */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 mb-6">
          <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <FileText className="w-5 h-5 text-purple-400" />
            Avtalsvillkor
          </h2>

          <div className="space-y-4">
            {/* Parter */}
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-gray-800/50 rounded-lg p-3">
                <p className="text-xs text-gray-500 mb-1">Företag</p>
                <p className="text-sm font-medium text-white">{contract.foretag_namn}</p>
                {contract.kontaktperson && <p className="text-xs text-gray-400">{contract.kontaktperson}</p>}
              </div>
              <div className="bg-gray-800/50 rounded-lg p-3">
                <p className="text-xs text-gray-500 mb-1">Influencer</p>
                <p className="text-sm font-medium text-white">{contract.influencer_namn}</p>
                <p className="text-xs text-gray-400">@{contract.kanalnamn} · {contract.plattform}</p>
              </div>
            </div>

            {/* Ersättning */}
            <div className="bg-purple-500/10 border border-purple-500/20 rounded-lg p-4">
              <h3 className="text-sm font-medium text-purple-300 mb-3">Ersättning</h3>
              <div className="grid grid-cols-3 gap-3">
                <div className="text-center">
                  <p className="text-2xl font-bold text-white">300</p>
                  <p className="text-xs text-gray-400">SEK / video</p>
                </div>
                <div className="text-center">
                  <p className="text-2xl font-bold text-white">10</p>
                  <p className="text-xs text-gray-400">SEK / signup</p>
                </div>
                <div className="text-center">
                  <p className="text-2xl font-bold text-white">{contract.videos_required || 5}</p>
                  <p className="text-xs text-gray-400">max videos</p>
                </div>
              </div>
            </div>

            {/* Krav */}
            <div>
              <h3 className="text-sm font-medium text-gray-300 mb-2">Krav & villkor</h3>
              <ul className="space-y-2">
                {(contract.villkor?.krav || []).map((krav, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-gray-400">
                    <ArrowRight className="w-4 h-4 text-purple-400 mt-0.5 flex-shrink-0" />
                    {krav}
                  </li>
                ))}
              </ul>
            </div>

            {/* Avtalstid */}
            <div className="flex items-center gap-2 text-sm text-gray-400">
              <Clock className="w-4 h-4 text-gray-500" />
              <span>Avtalstid: <strong className="text-white">30 dagar</strong> från signering</span>
            </div>

            {/* PDF */}
            <a
              href={api.getSigningPdfUrl(token)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-purple-400 hover:text-purple-300 text-sm"
            >
              <Download className="w-4 h-4" /> Visa fullständigt avtal (PDF)
            </a>
          </div>
        </div>

        {/* Signera */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
          <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <Shield className="w-5 h-5 text-green-400" />
            Digital signering
          </h2>

          {error && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-2 mb-4 text-sm text-red-400">
              {error}
            </div>
          )}

          <div className="space-y-4">
            {/* Namn */}
            <div>
              <label className="block text-sm text-gray-400 mb-1">Ditt fullständiga namn</label>
              <input
                type="text"
                value={namn}
                onChange={(e) => setNamn(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none"
                placeholder="Skriv ditt namn..."
              />
            </div>

            {/* Acceptera */}
            <label className="flex items-start gap-3 cursor-pointer">
              <div
                className={`w-5 h-5 rounded border flex items-center justify-center flex-shrink-0 mt-0.5 transition-colors ${
                  accepterar ? 'bg-purple-600 border-purple-600' : 'border-gray-600 hover:border-gray-500'
                }`}
                onClick={() => setAccepterar(!accepterar)}
              >
                {accepterar && <Check className="w-3 h-3 text-white" />}
              </div>
              <span className="text-sm text-gray-300" onClick={() => setAccepterar(!accepterar)}>
                Jag har läst och godkänner avtalsvillkoren ovan. Jag förstår att detta utgör en juridiskt bindande överenskommelse mellan mig och {contract.foretag_namn}.
              </span>
            </label>

            {/* Signeringsknapp */}
            <button
              onClick={handleSign}
              disabled={signing || !accepterar || !namn.trim()}
              className={`w-full flex items-center justify-center gap-2 py-3 rounded-lg font-medium text-white transition-all ${
                accepterar && namn.trim()
                  ? 'bg-green-600 hover:bg-green-700 shadow-lg shadow-green-600/20'
                  : 'bg-gray-700 cursor-not-allowed opacity-50'
              }`}
            >
              {signing ? (
                <><Loader2 className="w-5 h-5 animate-spin" /> Signerar...</>
              ) : (
                <><CheckCircle className="w-5 h-5" /> Signera avtal</>
              )}
            </button>

            <p className="text-xs text-gray-600 text-center">
              Genom att signera godkänner du villkoren ovan. Din IP-adress och tidpunkt loggas för verifiering.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
