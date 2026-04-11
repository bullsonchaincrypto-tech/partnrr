import { useState } from 'react'
import { Brain, Loader2 } from 'lucide-react'
import * as api from '../../services/api'

export default function AiAnalysTab() {
  const [aiRecs, setAiRecs] = useState('')
  const [analysis, setAnalysis] = useState('')
  const [analyzing, setAnalyzing] = useState(false)
  const [analysisType, setAnalysisType] = useState('basic')

  const handleAnalyze = async () => {
    setAnalyzing(true)
    try {
      if (analysisType === 'roi') {
        const result = await api.getRoiAiRecommendations()
        setAiRecs(result.recommendations)
        setAnalysis('')
      } else {
        const result = analysisType === 'deep'
          ? await api.deepAnalyze()
          : await api.analyzeConversion()
        setAnalysis(result.analysis)
        setAiRecs('')
      }
    } catch (err) { console.error(err) }
    finally { setAnalyzing(false) }
  }

  return (
    <div className="space-y-6">
      <div className="bg-gray-900 rounded-lg border border-gray-800 p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-medium text-gray-200 flex items-center gap-2">
            <Brain className="w-5 h-5 text-purple-400" /> AI-analys & Rekommendationer
          </h3>
          <div className="flex items-center gap-2">
            <select value={analysisType} onChange={e => setAnalysisType(e.target.value)}
              className="text-xs bg-gray-800 border border-gray-700 rounded px-2 py-1 text-gray-300">
              <option value="basic">Snabbanalys (Utskick)</option>
              <option value="deep">Djupanalys (CTA, plattform)</option>
              <option value="roi">Ekonomi-rekommendationer</option>
            </select>
            <button onClick={handleAnalyze} disabled={analyzing}
              className="flex items-center gap-2 text-sm bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg">
              {analyzing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Brain className="w-4 h-4" />}
              Analysera
            </button>
          </div>
        </div>

        {(analysis || aiRecs) ? (
          <pre className="text-sm text-gray-300 whitespace-pre-wrap font-sans leading-relaxed">
            {analysis || aiRecs}
          </pre>
        ) : (
          <div className="text-center py-12">
            <Brain className="w-16 h-16 mx-auto mb-4 text-purple-500/30" />
            <p className="text-gray-400 text-sm max-w-md mx-auto">
              Välj analystyp och klicka "Analysera" för att få AI-drivna insikter om din kampanjprestanda,
              CTA-kvalitet, plattformsfördelning och rekommendationer.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
