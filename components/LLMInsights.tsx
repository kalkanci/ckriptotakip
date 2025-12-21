
import React from 'react';
import { Brain, TrendingDown, Target, ShieldAlert } from 'lucide-react';
import { LLMAnalysis } from '../types';

interface LLMInsightsProps {
  analysis: LLMAnalysis | null;
  loading: boolean;
}

export const LLMInsights: React.FC<LLMInsightsProps> = ({ analysis, loading }) => {
  if (loading) {
    return (
      <div className="p-4 bg-gray-900 rounded-lg animate-pulse border border-blue-500/20">
        <div className="flex items-center space-x-2 mb-4">
          <Brain className="text-blue-400" size={20} />
          <div className="h-4 w-32 bg-gray-800 rounded"></div>
        </div>
        <div className="space-y-2">
          <div className="h-3 w-full bg-gray-800 rounded"></div>
          <div className="h-3 w-3/4 bg-gray-800 rounded"></div>
        </div>
      </div>
    );
  }

  if (!analysis) {
    return (
      <div className="p-4 bg-gray-900/50 rounded-lg border border-gray-800 flex flex-col items-center justify-center text-gray-500">
        <Brain size={32} className="mb-2 opacity-20" />
        <p className="text-xs text-center">Analiz bekliyor...</p>
      </div>
    );
  }

  const isStrong = analysis.score >= 0.7;

  return (
    <div className={`p-4 rounded-lg border ${isStrong ? 'border-blue-500/40 bg-blue-500/5' : 'border-gray-800 bg-gray-900'}`}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center space-x-2">
          <Brain className="text-blue-400" size={18} />
          <span className="font-semibold text-sm">Yapay Zeka Analizi</span>
        </div>
        <div className="flex items-center space-x-1">
          <div className={`text-xs px-2 py-0.5 rounded font-mono ${isStrong ? 'bg-blue-500/20 text-blue-400' : 'bg-gray-800 text-gray-400'}`}>
            SKOR: {(analysis.score * 100).toFixed(0)}
          </div>
        </div>
      </div>

      <div className="space-y-3">
        <p className="text-xs leading-relaxed text-gray-300">
          {analysis.rationale_tr}
        </p>

        <div className="grid grid-cols-2 gap-2">
          <div className="flex items-center space-x-2 p-2 bg-black/20 rounded">
            <TrendingDown size={14} className="text-red-400" />
            <div>
              <div className="text-[10px] text-gray-500 uppercase">Güven</div>
              <div className="text-xs font-mono font-bold">{(analysis.confidence * 100).toFixed(0)}%</div>
            </div>
          </div>
          <div className="flex items-center space-x-2 p-2 bg-black/20 rounded">
            <ShieldAlert size={14} className="text-yellow-400" />
            <div>
              <div className="text-[10px] text-gray-500 uppercase">Risk</div>
              <div className="text-xs font-mono font-bold">{(analysis.risk_estimate * 100).toFixed(0)}%</div>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-1">
          {analysis.top_features.map(f => (
            <span key={f} className="text-[9px] px-1.5 py-0.5 bg-gray-800 text-gray-400 rounded">
              {f}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
};
