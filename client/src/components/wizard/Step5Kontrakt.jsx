import { useState } from 'react'
import { FileText, ArrowRight, ArrowLeft, Download, Loader2 } from 'lucide-react'
import * as api from '../../services/api'

export default function Step5Kontrakt({ foretag, outreachType, messages, attachContracts, setAttachContracts, kontaktperson, setKontaktperson, next, prev }) {
  const [downloading, setDownloading] = useState(null)
  const isSponsor = outreachType === 'sponsor'

  const handlePreview = async (msgId) => {
    if (!kontaktperson && !foretag.kontaktperson) {
      alert('Ange kontaktperson först')
      return
    }
    setDownloading(msgId)
    try {
      const blob = await api.generateKontrakt(msgId, kontaktperson || foretag.kontaktperson)
      const url = URL.createObjectURL(blob)
      window.open(url, '_blank')
    } catch (err) {
      console.error(err)
    } finally {
      setDownloading(null)
    }
  }

  // Sponsors: skip contract, just pass through
  if (isSponsor) {
    return (
      <div>
        <div className="flex items-center gap-3 mb-6">
          <FileText className="w-6 h-6 text-blue-500" />
          <h2 className="text-xl font-bold">Steg 4: Kontrakt</h2>
        </div>

        <div className="bg-blue-900/10 border border-blue-700/30 rounded-lg p-4 mb-6">
          <p className="text-blue-300 text-sm">
            Kontrakt är inte tillämpligt för sponsor-outreach. Gå vidare till granskning.
          </p>
        </div>

        <div className="flex gap-3 mt-6">
          <button onClick={prev} className="flex items-center gap-2 text-gray-400 hover:text-white px-4 py-2 rounded-lg border border-gray-700 hover:border-gray-600 transition-colors">
            <ArrowLeft className="w-4 h-4" /> Tillbaka
          </button>
          <button
            onClick={next}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-6 py-2.5 rounded-lg font-medium transition-colors"
          >
            Granska <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <FileText className="w-6 h-6 text-purple-500" />
        <h2 className="text-xl font-bold">Steg 4: Kontrakt</h2>
      </div>

      {/* Toggle */}
      <div className="flex items-center gap-4 mb-6 p-4 bg-gray-800/50 rounded-lg border border-gray-700">
        <label className="flex items-center gap-3 cursor-pointer">
          <div
            onClick={() => setAttachContracts(!attachContracts)}
            className={`w-12 h-6 rounded-full relative transition-colors cursor-pointer ${attachContracts ? 'bg-purple-600' : 'bg-gray-600'}`}
          >
            <div className={`w-5 h-5 rounded-full bg-white absolute top-0.5 transition-all ${attachContracts ? 'left-6' : 'left-0.5'}`} />
          </div>
          <span className="text-white font-medium">Bifoga kontrakt?</span>
        </label>
      </div>

      {attachContracts && (
        <div className="space-y-4">
          <div className="max-w-md">
            <label className="block text-sm font-medium text-gray-300 mb-1">Kontaktperson (obligatoriskt för kontrakt) *</label>
            <input
              type="text"
              value={kontaktperson}
              onChange={(e) => setKontaktperson(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500"
              placeholder="Namn på kontaktperson"
            />
          </div>

          <div className="bg-gray-800/30 rounded-lg p-4 border border-gray-700">
            <h3 className="text-sm font-semibold text-gray-300 mb-2">Kontraktsvillkor som inkluderas:</h3>
            <ul className="text-sm text-gray-400 space-y-1">
              <li>Ersättning: 300 SEK per publicerad video</li>
              <li>Max antal videos: 5 st</li>
              <li>Provision: 10 SEK per registrering via referral-kod</li>
              <li>Krav på hard CTA i varje video</li>
              <li>Rapportering inom 7 dagar efter publicering</li>
              <li>Avtalstid: 30 dagar från signering</li>
            </ul>
          </div>

          <div className="space-y-2">
            <h3 className="text-sm font-medium text-gray-300">Förhandsgranska kontrakt:</h3>
            {messages.map((msg) => (
              <div key={msg.id} className="flex items-center justify-between p-3 bg-gray-800/30 rounded-lg border border-gray-700">
                <span className="text-sm text-white">{msg.influencer_namn || msg.prospect_namn} ({msg.plattform || 'E-post'})</span>
                <button
                  onClick={() => handlePreview(msg.id)}
                  disabled={downloading === msg.id || (!kontaktperson && !foretag.kontaktperson)}
                  className="flex items-center gap-1 text-sm text-purple-400 hover:text-purple-300 disabled:opacity-50"
                >
                  {downloading === msg.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                  PDF
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex gap-3 mt-6">
        <button onClick={prev} className="flex items-center gap-2 text-gray-400 hover:text-white px-4 py-2 rounded-lg border border-gray-700 hover:border-gray-600 transition-colors">
          <ArrowLeft className="w-4 h-4" /> Tillbaka
        </button>
        <button
          onClick={next}
          disabled={attachContracts && !kontaktperson && !foretag.kontaktperson}
          className="flex items-center gap-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white px-6 py-2.5 rounded-lg font-medium transition-colors"
        >
          Granska <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}
