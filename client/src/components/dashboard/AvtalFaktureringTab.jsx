import { useState } from 'react'
import { FileText, Receipt, DollarSign } from 'lucide-react'
import ContractsTab from './ContractsTab'
import InvoicesTab from './InvoicesTab'
import IntakterTab from './IntakterTab'

export default function AvtalFaktureringTab() {
  const [subTab, setSubTab] = useState('contracts')

  return (
    <div className="space-y-4">
      {/* Sub-navigation */}
      <div className="flex gap-1 bg-gray-800/50 rounded-lg p-1">
        <button
          onClick={() => setSubTab('contracts')}
          className={`flex-1 flex items-center justify-center gap-2 px-3 py-1.5 rounded text-xs font-medium transition-colors ${
            subTab === 'contracts' ? 'bg-purple-600/80 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-700/50'
          }`}
        >
          <FileText className="w-3.5 h-3.5" /> Avtal & Signering
        </button>
        <button
          onClick={() => setSubTab('invoices')}
          className={`flex-1 flex items-center justify-center gap-2 px-3 py-1.5 rounded text-xs font-medium transition-colors ${
            subTab === 'invoices' ? 'bg-purple-600/80 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-700/50'
          }`}
        >
          <Receipt className="w-3.5 h-3.5" /> Utbetalningar
        </button>
        <button
          onClick={() => setSubTab('intakter')}
          className={`flex-1 flex items-center justify-center gap-2 px-3 py-1.5 rounded text-xs font-medium transition-colors ${
            subTab === 'intakter' ? 'bg-green-600/80 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-700/50'
          }`}
        >
          <DollarSign className="w-3.5 h-3.5" /> Intäkter
        </button>
      </div>

      {/* Content */}
      {subTab === 'contracts' && <ContractsTab />}
      {subTab === 'invoices' && <InvoicesTab />}
      {subTab === 'intakter' && <IntakterTab />}
    </div>
  )
}
