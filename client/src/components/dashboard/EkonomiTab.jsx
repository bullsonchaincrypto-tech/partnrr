import { useState } from 'react'
import { DollarSign, Receipt, TrendingDown } from 'lucide-react'
import InvoicesTab from './InvoicesTab'
import IntakterTab from './IntakterTab'
import UtbetalningarTab from './UtbetalningarTab'

export default function EkonomiTab() {
  const [subTab, setSubTab] = useState('intakter')

  return (
    <div className="space-y-4">
      {/* Sub-navigation */}
      <div className="flex gap-1 bg-gray-800/50 rounded-lg p-1">
        <button
          onClick={() => setSubTab('intakter')}
          className={`flex-1 flex items-center justify-center gap-2 px-3 py-1.5 rounded text-xs font-medium transition-colors ${
            subTab === 'intakter' ? 'bg-green-600/80 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-700/50'
          }`}
        >
          <DollarSign className="w-3.5 h-3.5" /> Intäkter
        </button>
        <button
          onClick={() => setSubTab('utbetalningar')}
          className={`flex-1 flex items-center justify-center gap-2 px-3 py-1.5 rounded text-xs font-medium transition-colors ${
            subTab === 'utbetalningar' ? 'bg-purple-600/80 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-700/50'
          }`}
        >
          <TrendingDown className="w-3.5 h-3.5" /> Utbetalningar
        </button>
        <button
          onClick={() => setSubTab('fakturering')}
          className={`flex-1 flex items-center justify-center gap-2 px-3 py-1.5 rounded text-xs font-medium transition-colors ${
            subTab === 'fakturering' ? 'bg-purple-600/80 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-700/50'
          }`}
        >
          <Receipt className="w-3.5 h-3.5" /> Fakturering
        </button>
      </div>

      {/* Content */}
      {subTab === 'intakter' && <IntakterTab />}
      {subTab === 'utbetalningar' && <UtbetalningarTab />}
      {subTab === 'fakturering' && <InvoicesTab />}
    </div>
  )
}
