
import React from 'react';
import { Position } from '../types';

interface PositionListProps {
  positions: Position[];
  onClose: (symbol: string) => void;
}

export const PositionList: React.FC<PositionListProps> = ({ positions, onClose }) => {
  const formatPrice = (symbol: string, price: number) => {
    if (symbol.includes('PEPE')) return price.toFixed(12);
    if (symbol.includes('DOGE')) return price.toFixed(5);
    return price.toFixed(8);
  };

  return (
    <div className="w-full overflow-x-auto overflow-y-hidden custom-scrollbar">
      <table className="w-full text-left border-collapse font-mono min-w-[750px] lg:min-w-full">
        <thead className="bg-[#1e2329]/50 text-gray-500 text-[10px] uppercase tracking-[0.2em] italic">
          <tr>
            <th className="p-4 lg:p-6">Pozisyon / Yön</th>
            <th className="p-4 lg:p-6 text-center">Likidasyon / Marjin</th>
            <th className="p-4 lg:p-6 text-center">Short DCA Durumu</th>
            <th className="p-4 lg:p-6 text-right">Short P&L (5x)</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5">
          {positions.map(pos => (
            <tr key={pos.symbol} className="hover:bg-red-500/5 transition-colors text-[11px] lg:text-[13px]">
              <td className="p-4 lg:p-6">
                <div className="flex items-center space-x-2">
                  <div className="font-black text-white italic tracking-tighter text-sm uppercase">{pos.symbol.replace('USDT','')}</div>
                  <span className="text-[9px] px-1.5 py-0.5 bg-red-600/20 text-red-500 border border-red-500/20 rounded font-black">SHORT 5X</span>
                </div>
                <div className="text-[9px] text-blue-500 font-black italic uppercase tracking-widest mt-1 opacity-70">{pos.stage}</div>
              </td>
              <td className="p-4 lg:p-6 text-center">
                <div className="text-red-400 font-black">{formatPrice(pos.symbol, pos.liqPrice)}</div>
                <div className="text-[10px] text-gray-500 italic uppercase">Risk Eşiği</div>
              </td>
              <td className="p-4 lg:p-6">
                 <div className="flex justify-center space-x-1 mb-2">
                    {[0,1,2,3,4,5,6].map(i => (
                      <div 
                        key={i} 
                        className={`w-3 h-3 rounded-full transition-all duration-700 ${
                          pos.executedSteps.includes(i) 
                            ? i === 0 ? 'bg-red-500' : 'bg-orange-500' 
                            : 'bg-gray-800'
                        }`} 
                      />
                    ))}
                 </div>
                 <div className="text-center text-[10px] text-gray-500 font-black uppercase tracking-widest italic">${(pos.notional/5).toFixed(2)} Marjin</div>
              </td>
              <td className={`p-4 lg:p-6 text-right font-black ${pos.pnlPercentage >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                <div className="text-base lg:text-xl italic tracking-tighter">{pos.pnlPercentage >= 0 ? '+' : ''}{pos.pnlPercentage.toFixed(2)}%</div>
                <div className="text-[10px] opacity-60 font-mono tracking-widest uppercase italic">${(pos.pnl + pos.realizedPnl - pos.totalFees).toFixed(2)} Net</div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
