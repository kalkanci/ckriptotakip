
import React, { useState, useEffect } from 'react';
import { AlertCircle, Target, TrendingDown } from 'lucide-react';
import { TradeMode, LLMAnalysis, UserSettings } from '../types';

interface OrderFormProps {
  mode: TradeMode;
  equity: number;
  lastPrice: number;
  onExecute: (params: { qty: number; sl: number; tp: number }) => void;
  analysis: LLMAnalysis | null;
  settings: UserSettings;
}

export const OrderForm: React.FC<OrderFormProps> = ({ mode, equity, lastPrice, onExecute, analysis, settings }) => {
  const calculatedNotional = equity * (settings.riskPercent / 100) * 5;
  const quantity = Number((calculatedNotional / Math.max(lastPrice, 0.0001)).toFixed(2));
  const [tp, setTp] = useState(lastPrice * 0.9);

  useEffect(() => {
    if (analysis?.recommended_params) {
      setTp(analysis.recommended_params.take_profit_price);
    } else {
      setTp(lastPrice * 0.9);
    }
  }, [analysis, lastPrice]);

  return (
    <div className="bg-[#0b0e11] border border-gray-800 rounded-3xl p-5 shadow-2xl space-y-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-black text-gray-500 uppercase">Manuel/Yarı-Oto Emir</span>
        <div className={`px-2 py-0.5 rounded text-[9px] font-black ${mode === TradeMode.LIVE ? 'bg-red-500' : 'bg-gray-700'}`}>{mode}</div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="bg-[#161a1e] p-3 rounded-2xl border border-gray-800">
          <span className="text-[9px] text-gray-500 font-black block">MİKTAR</span>
          <span className="text-sm font-mono font-black">{quantity}</span>
        </div>
        <div className="bg-[#161a1e] p-3 rounded-2xl border border-gray-800">
          <span className="text-[9px] text-gray-500 font-black block">RİSK (5x)</span>
          <span className="text-sm font-mono font-black text-blue-400">{calculatedNotional.toFixed(1)} $</span>
        </div>
      </div>

      <div className="space-y-3">
        <div>
          <label className="text-[9px] text-gray-500 font-black block mb-1">KÂR AL (TAKE PROFIT)</label>
          <div className="relative">
            <input 
              type="number" 
              value={tp.toFixed(4)} 
              onChange={e=>setTp(Number(e.target.value))}
              className="w-full bg-[#161a1e] border border-gray-800 rounded-xl p-3 text-sm font-mono focus:border-green-500 outline-none" 
            />
            <Target size={14} className="absolute right-3 top-3.5 text-green-500 opacity-50" />
          </div>
        </div>
      </div>

      <button 
        onClick={() => onExecute({ qty: quantity, sl: 0, tp })}
        disabled={lastPrice <= 0}
        className="w-full py-4 bg-red-600 hover:bg-red-700 disabled:opacity-50 transition-all rounded-2xl font-black text-sm uppercase shadow-xl shadow-red-600/20 flex items-center justify-center space-x-2"
      >
        <TrendingDown size={18} />
        <span>Short İşlemi Aç</span>
      </button>

      <div className="flex items-start space-x-2 p-3 bg-red-500/5 rounded-xl border border-red-500/10">
        <AlertCircle size={14} className="text-red-500 shrink-0 mt-0.5" />
        <p className="text-[9px] text-red-400 font-bold uppercase leading-tight italic">
          Stop-Loss devre dışı. İşlem likidasyon riski taşır. AI sadece %80+ pump sonrası düzeltme bekler.
        </p>
      </div>
    </div>
  );
};
