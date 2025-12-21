
import React from 'react';
import { Zap, TrendingUp, BarChart3, Activity } from 'lucide-react';
import { PumpCandidate } from '../types';

interface PumpScannerProps {
  candidates: PumpCandidate[];
  onSelect: (symbol: string) => void;
  activeSymbol: string;
}

export const PumpScanner: React.FC<PumpScannerProps> = ({ candidates, onSelect, activeSymbol }) => {
  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b border-gray-800 bg-[#1e2329]/50 flex items-center justify-between">
        <div className="flex items-center space-x-2 text-yellow-500">
          <Zap size={16} fill="currentColor" />
          <span className="text-xs font-black uppercase tracking-widest">Pompa Dedektörü ({'<$1'})</span>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {candidates.length === 0 ? (
          <div className="text-[9px] text-gray-600 text-center py-10 italic uppercase font-bold tracking-tighter opacity-50">
            Aktif sinyal taranıyor...
          </div>
        ) : (
          candidates.map(c => (
            <button
              key={c.symbol}
              onClick={() => onSelect(c.symbol)}
              className={`w-full p-3 rounded-xl border transition-all text-left group relative overflow-hidden ${
                activeSymbol === c.symbol 
                  ? 'border-yellow-500/50 bg-yellow-500/10 shadow-lg' 
                  : 'border-gray-800 bg-gray-900/40 hover:border-gray-700'
              }`}
            >
              <div className="flex justify-between items-start mb-2">
                <div>
                  <div className="text-sm font-black flex items-center space-x-1 uppercase tracking-tighter">
                    <span>{c.symbol}</span>
                    <TrendingUp size={12} className="text-green-400" />
                  </div>
                  <div className="text-[10px] text-gray-500 font-mono font-bold">${c.lastPrice.toFixed(4)}</div>
                </div>
                <div className={`text-[10px] font-black px-1.5 py-0.5 rounded ${c.score > 0.7 ? 'bg-red-500 text-white' : 'bg-yellow-500 text-black'}`}>
                  SKOR: {(c.score * 100).toFixed(0)}
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-2 text-[9px] text-gray-500 font-black uppercase">
                <div className="flex items-center space-x-1">
                  <BarChart3 size={10} />
                  <span>Sıçrama: %{(c.priceJump * 100).toFixed(0)}</span>
                </div>
                <div className="flex items-center space-x-1">
                  <Activity size={10} />
                  <span>Güç: {c.volumeMultiplier.toFixed(1)}x</span>
                </div>
              </div>
              
              <div className="mt-2 h-1 w-full bg-gray-800 rounded-full overflow-hidden">
                <div 
                  className={`h-full transition-all duration-1000 ${c.score > 0.7 ? 'bg-red-500' : 'bg-yellow-500'}`} 
                  style={{ width: `${c.score * 100}%` }} 
                />
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );
};
