
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { 
  Settings, Zap, Activity, X, Brain, Loader2, Clock, 
  TrendingUp, TrendingDown, ChevronRight, Waves, Target, 
  Calculator, Wallet, AlertCircle, Play, StopCircle, 
  RefreshCw, Gauge, Flame, BarChart3, TrendingUpDown, ArrowUpRight, ArrowDownRight,
  Rocket, Info, TrendingUp as UpIcon, TrendingDown as DownIcon
} from 'lucide-react';
import { MarketTicker, UserSettings, Kline } from './types';
import { binanceService } from './services/binanceService';
import { llmService } from './services/llmService';
import { createChart, IChartApi, ColorType } from 'lightweight-charts';

interface SimulatedTrade {
  symbol: string;
  entryPrice: number;
  amount: number;
  leverage: number;
  direction: 'LONG' | 'SHORT';
  startTime: number;
}

// Sparkline Component for Live Momentum Dashboard
const Sparkline: React.FC<{ data: number[], isUp: boolean }> = ({ data, isUp }) => {
  if (!data || data.length < 2) return <div className="w-16 h-8 bg-slate-100/50 rounded animate-pulse" />;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const width = 80;
  const height = 30;
  const points = data.map((d, i) => ({
    x: (i / (data.length - 1)) * width,
    y: height - ((d - min) / range) * height
  }));
  const path = `M ${points.map(p => `${p.x},${p.y}`).join(' L ')}`;
  
  return (
    <svg width={width} height={height} className="overflow-visible">
      <path
        d={path}
        fill="none"
        stroke={isUp ? '#00FF88' : '#FF0055'}
        strokeWidth={isUp ? "2.5" : "1.5"}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={isUp ? "drop-shadow-[0_0_6px_rgba(0,255,136,0.6)]" : "opacity-40"}
      />
    </svg>
  );
};

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'radar' | 'list' | 'calc'>('radar');
  const [listSubTab, setListSubTab] = useState<'all' | 'pump'>('all');
  const [allFutures, setAllFutures] = useState<MarketTicker[]>([]);
  const [analyzingSymbol, setAnalyzingSymbol] = useState<string | null>(null);
  const [analysisResult, setAnalysisResult] = useState<any | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [minVolume, setMinVolume] = useState(10);
  const [simAmount, setSimAmount] = useState(100);
  const [activeSimTrade, setActiveSimTrade] = useState<SimulatedTrade | null>(null);

  const tickerBuffer = useRef<Record<string, MarketTicker>>({});
  const priceHistory = useRef<Record<string, number[]>>({});
  const lastUpdateRef = useRef<Record<string, number>>({});
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  const [userSettings, setUserSettings] = useState<UserSettings>(() => {
    const saved = localStorage.getItem('sentinel_pro_settings');
    return saved ? JSON.parse(saved) : { 
      riskPercent: 10, leverage: 5, telegramBotToken: '', telegramChatId: '', isNotificationEnabled: true 
    };
  });

  // Gelişmiş Skorlama & Alım Baskısı Mantığı
  const getMetrics = (ticker: MarketTicker) => {
    const absChange = Math.abs(ticker.priceChangePercent);
    // Alım Baskısı Simülasyonu (Fiyat ve Hacim korelasyonu)
    const buyPressure = Math.min(Math.max(50 + (ticker.priceChangePercent * 4), 10), 95);
    const volumeImpact = Math.log10(ticker.volume + 1) / 4;
    const score = (absChange * 0.4) + (volumeImpact * 35);
    return { score: Math.min(score, 100), buyPressure };
  };

  useEffect(() => {
    binanceService.connect();
    const unsub = binanceService.onMessage((data) => {
      if (Array.isArray(data)) {
        data.forEach(t => {
          if (!t.s.endsWith('USDT')) return;
          const price = parseFloat(t.c);
          const change = parseFloat(t.P);
          
          if (!priceHistory.current[t.s]) priceHistory.current[t.s] = [];
          priceHistory.current[t.s].push(price);
          if (priceHistory.current[t.s].length > 15) priceHistory.current[t.s].shift();

          const metrics = getMetrics({
             symbol: t.s, lastPrice: price, priceChangePercent: change, 
             high: parseFloat(t.h), low: parseFloat(t.l), volume: parseFloat(t.q)
          } as any);

          tickerBuffer.current[t.s] = { 
            symbol: t.s, lastPrice: price, priceChangePercent: change, 
            high: parseFloat(t.h), low: parseFloat(t.l), volume: parseFloat(t.q),
            vScore: metrics.score,
            buyPressure: metrics.buyPressure // Custom property for UI
          } as any;
          lastUpdateRef.current[t.s] = Date.now();
        });
      }
    });
    const loop = setInterval(() => setAllFutures(Object.values(tickerBuffer.current)), 1000);
    return () => { clearInterval(loop); unsub(); binanceService.disconnect(); };
  }, []);

  // TradingView Style Chart Logic
  useEffect(() => {
    if (analyzingSymbol && chartContainerRef.current) {
      chartRef.current = createChart(chartContainerRef.current, {
        layout: { 
          background: { type: ColorType.Solid, color: 'transparent' }, 
          textColor: '#94a3b8' 
        },
        grid: { vertLines: { visible: false }, horzLines: { color: '#f1f5f9' } },
        width: chartContainerRef.current.clientWidth,
        height: 220,
        handleScale: false,
        handleScroll: false,
      });
      const areaSeries = chartRef.current.addAreaSeries({
        lineColor: '#00FF88',
        topColor: 'rgba(0, 255, 136, 0.2)',
        bottomColor: 'rgba(0, 255, 136, 0)',
        lineWidth: 3,
      });

      binanceService.getHistory(analyzingSymbol, '1m', 50).then(data => {
        areaSeries.setData(data.map(d => ({ time: d.time as any, value: d.close })));
        chartRef.current?.timeScale().fitContent();
      });

      return () => {
        chartRef.current?.remove();
        chartRef.current = null;
      };
    }
  }, [analyzingSymbol]);

  const handleQuickAnalysis = async (symbol: string) => {
    setIsAnalyzing(true);
    setAnalyzingSymbol(symbol);
    setAnalysisResult(null);
    try {
      const history = await binanceService.getHistory(symbol, '1m', 20);
      const ticker = tickerBuffer.current[symbol];
      if (ticker) {
        const result = await llmService.analyzePump(ticker, history);
        setAnalysisResult(result);
      }
    } catch (e) { console.error(e); } finally { setIsAnalyzing(false); }
  };

  const startSimTrade = (symbol: string, direction: 'LONG' | 'SHORT') => {
    const ticker = tickerBuffer.current[symbol];
    if (ticker) setActiveSimTrade({ symbol, entryPrice: ticker.lastPrice, amount: simAmount, leverage: 5, direction, startTime: Date.now() });
    setActiveTab('calc');
    setAnalyzingSymbol(null);
  };

  // High Volatility Filter for Radar
  const topSignals = useMemo(() => 
    allFutures.filter(c => (c.vScore || 0) > 40).sort((a,b) => (b.vScore || 0) - (a.vScore || 0)).slice(0, 12)
  , [allFutures]);

  // Momentum Dashboard Filter
  const marketList = useMemo(() => {
    let list = allFutures.filter(c => (c.volume/1000000) > minVolume);
    if (listSubTab === 'pump') {
      return list.filter(c => c.priceChangePercent > 5).sort((a,b) => b.priceChangePercent - a.priceChangePercent);
    }
    return list.sort((a,b) => Math.abs(b.priceChangePercent) - Math.abs(a.priceChangePercent));
  }, [allFutures, minVolume, listSubTab]);

  // Implementation of getActiveSimStats to calculate real-time trade statistics
  const getActiveSimStats = useCallback(() => {
    if (!activeSimTrade) return null;
    const ticker = tickerBuffer.current[activeSimTrade.symbol];
    if (!ticker) return null;

    const currentPrice = ticker.lastPrice;
    const entryPrice = activeSimTrade.entryPrice;
    const leverage = activeSimTrade.leverage;
    
    let pnlPct = 0;
    if (activeSimTrade.direction === 'LONG') {
      pnlPct = ((currentPrice - entryPrice) / entryPrice) * 100 * leverage;
    } else {
      pnlPct = ((entryPrice - currentPrice) / entryPrice) * 100 * leverage;
    }

    const pnlUsd = (activeSimTrade.amount * pnlPct) / 100;
    
    return {
      currentPrice,
      pnlPct,
      pnlUsd,
      isProfit: pnlPct >= 0
    };
  }, [activeSimTrade]);

  return (
    <div className="flex flex-col h-screen bg-[#0F172A] text-slate-200 overflow-hidden font-sans">
      <style>{`
        @keyframes flashPrice { 0% { color: #00FF88; transform: scale(1.1); } 100% { color: inherit; transform: scale(1); } }
        @keyframes pumpPulse { 0% { box-shadow: 0 0 0px rgba(0, 255, 136, 0); border-color: transparent; } 50% { box-shadow: 0 0 15px rgba(0, 255, 136, 0.4); border-color: #00FF88; } 100% { box-shadow: 0 0 0px rgba(0, 255, 136, 0); border-color: transparent; } }
        @keyframes rocketShake { 0%, 100% { transform: translateY(0) rotate(0); } 25% { transform: translateY(-2px) rotate(-5deg); } 75% { transform: translateY(2px) rotate(5deg); } }
        .price-flash { animation: flashPrice 0.8s ease-out; }
        .pump-card { animation: pumpPulse 2s infinite; border-width: 2px !important; }
        .rocket-anim { animation: rocketShake 0.5s infinite linear; }
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 10px; }
      `}</style>

      {/* HEADER */}
      <header className="h-16 bg-slate-900/50 backdrop-blur-lg border-b border-white/5 flex items-center justify-between px-6 shrink-0 z-50">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 bg-indigo-600 rounded-2xl flex items-center justify-center text-white font-black shadow-lg shadow-indigo-500/20">S</div>
          <div>
            <span className="font-black text-sm tracking-tight uppercase block leading-none">Sentinel <span className="text-indigo-400">PWA</span></span>
            <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest mt-1">Live Momentum Radar</span>
          </div>
        </div>
        <button onClick={() => setIsSettingsOpen(true)} className="p-2.5 bg-white/5 rounded-2xl text-slate-400 hover:bg-white/10 transition-all border border-white/5">
          <Settings size={20}/>
        </button>
      </header>

      {/* MAIN CONTENT AREA */}
      <main className="flex-1 relative overflow-hidden">
        
        {/* RADAR TAB */}
        <div className={`absolute inset-0 transition-all duration-500 p-6 pb-32 overflow-y-auto custom-scrollbar ${activeTab === 'radar' ? 'translate-x-0 opacity-100' : '-translate-x-full opacity-0'}`}>
           <div className="max-w-4xl mx-auto space-y-8">
              
              {/* Pump Radar Alert Widget */}
              <div className="bg-gradient-to-br from-indigo-900 to-slate-900 rounded-[2.5rem] p-8 text-white relative overflow-hidden shadow-2xl border border-white/5 group">
                 <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
                    <div>
                       <div className="flex items-center space-x-3 text-emerald-400 mb-3">
                          <Rocket size={24} className="rocket-anim" />
                          <span className="text-xs font-black uppercase tracking-[0.3em] opacity-80">Yüksek Volatilite Alarmı</span>
                       </div>
                       <h2 className="text-3xl font-black italic tracking-tighter uppercase leading-none">Anlık Sinyal Aktif</h2>
                       <p className="text-slate-400 text-xs mt-3 font-medium uppercase tracking-widest">Binance Futures Canlı Analiz Verisi</p>
                    </div>
                    <div className="flex items-center space-x-6">
                       <div className="text-center">
                          <div className="text-3xl font-black text-emerald-400">%{((allFutures.filter(c => c.priceChangePercent > 0).length/allFutures.length)*100).toFixed(0)}</div>
                          <div className="text-[9px] font-black uppercase opacity-40">Boğa Baskısı</div>
                       </div>
                       <div className="w-px h-12 bg-white/10" />
                       <div className="text-center">
                          <div className="text-3xl font-black text-indigo-400">{allFutures.length}</div>
                          <div className="text-[9px] font-black uppercase opacity-40">Taranan Varlık</div>
                       </div>
                    </div>
                 </div>
                 <Waves className="absolute -bottom-10 -right-10 text-white/5 w-64 h-64 rotate-45 group-hover:scale-110 transition-transform duration-700" />
              </div>

              {/* Signals Grid */}
              <div className="space-y-4">
                 <div className="flex items-center justify-between px-2">
                    <div className="flex items-center space-x-2">
                       <Flame size={18} className="text-orange-500" />
                       <span className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">En Güçlü Sinyaller</span>
                    </div>
                    <span className="text-[9px] font-bold text-slate-500 uppercase italic">Algoritmik Puanlama</span>
                 </div>
                 <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                    {topSignals.map(c => {
                       const isPump = c.priceChangePercent > 8;
                       return (
                         <div key={c.symbol} onClick={() => handleQuickAnalysis(c.symbol)} 
                           className={`bg-slate-900/50 backdrop-blur-sm border border-white/5 p-4 rounded-3xl flex flex-col justify-between hover:bg-slate-800 transition-all cursor-pointer relative group ${isPump ? 'pump-card' : ''}`}>
                            <div className="flex justify-between items-start mb-4">
                               <div>
                                  <span className="text-xs font-black text-white block uppercase tracking-tight group-hover:text-indigo-400 transition-colors">{c.symbol.replace('USDT','')}</span>
                                  <span className="text-[9px] font-bold text-slate-500 italic mt-0.5 block">${c.lastPrice}</span>
                               </div>
                               <div className={`px-2 py-0.5 rounded-lg text-[9px] font-black uppercase tracking-tighter shadow-lg ${c.priceChangePercent >= 0 ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'}`}>
                                  {c.priceChangePercent >= 0 ? 'LONG' : 'SHORT'}
                               </div>
                            </div>
                            <div className="space-y-3">
                               <div className="flex justify-between items-end">
                                  <span className="text-[8px] font-black text-slate-500 uppercase tracking-widest">Alım Baskısı</span>
                                  <span className={`text-xs font-black italic ${(c as any).buyPressure > 70 ? 'text-emerald-400' : 'text-slate-400'}`}>%{(c as any).buyPressure?.toFixed(0)}</span>
                               </div>
                               <div className="h-1.5 w-full bg-slate-800 rounded-full overflow-hidden border border-white/5">
                                  <div className={`h-full transition-all duration-1000 ${isPump ? 'bg-emerald-400' : 'bg-indigo-500'}`} style={{ width: `${(c as any).buyPressure}%` }} />
                               </div>
                            </div>
                         </div>
                       )
                    })}
                 </div>
              </div>
           </div>
        </div>

        {/* LIST TAB (LIVE MOMENTUM DASHBOARD) */}
        <div className={`absolute inset-0 transition-all duration-500 bg-[#0F172A] p-6 pb-32 overflow-y-auto custom-scrollbar ${activeTab === 'list' ? 'translate-x-0 opacity-100' : 'translate-x-full opacity-0'}`}>
           <div className="max-w-4xl mx-auto space-y-6">
              <div className="flex items-center justify-between">
                 <h2 className="text-2xl font-black italic uppercase tracking-tighter">Piyasa Paneli</h2>
                 <div className="bg-slate-900 p-1 rounded-2xl flex border border-white/5">
                    <button onClick={() => setListSubTab('all')} className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase transition-all ${listSubTab === 'all' ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/20' : 'text-slate-500 hover:text-slate-300'}`}>Tümü</button>
                    <button onClick={() => setListSubTab('pump')} className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase transition-all ${listSubTab === 'pump' ? 'bg-orange-500 text-white shadow-lg shadow-orange-500/20' : 'text-slate-500 hover:text-slate-300'}`}>Pump Listesi</button>
                 </div>
              </div>

              <div className="bg-slate-900/30 rounded-[2.5rem] border border-white/5 overflow-hidden">
                 <div className="flex items-center px-6 py-4 bg-slate-900/50 text-[10px] font-black text-slate-500 uppercase tracking-widest border-b border-white/5">
                    <div className="flex-1">Varlık / Hacim</div>
                    <div className="hidden sm:block w-32 text-center">Son 1 Saat Trend</div>
                    <div className="w-24 text-right">Fiyat / Değişim</div>
                 </div>
                 <div className="divide-y divide-white/5">
                    {marketList.slice(0, 40).map(c => {
                       const isUp = c.priceChangePercent >= 0;
                       const isDormant = Math.abs(c.priceChangePercent) < 0.5;
                       return (
                         <div key={c.symbol} onClick={() => handleQuickAnalysis(c.symbol)} 
                           className={`flex items-center px-6 py-5 transition-all hover:bg-white/5 cursor-pointer group ${isDormant ? 'opacity-40 grayscale-[0.5]' : ''}`}>
                            <div className="flex-1 flex items-center space-x-4">
                               <div className={`w-10 h-10 rounded-2xl flex items-center justify-center font-black text-xs italic transition-all ${isUp ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'} group-hover:scale-110`}>{c.symbol[0]}</div>
                               <div>
                                  <div className="font-black text-sm text-white uppercase tracking-tight">{c.symbol.replace('USDT','')}</div>
                                  <div className="text-[10px] font-bold text-slate-500 uppercase mt-0.5 tracking-tighter">${(c.volume/1000000).toFixed(1)}M Hacim</div>
                               </div>
                            </div>
                            <div className="hidden sm:block w-32 px-4">
                               <Sparkline data={priceHistory.current[c.symbol] || []} isUp={isUp} />
                            </div>
                            <div className="text-right w-24">
                               <div className={`text-sm font-mono font-black ${isUp ? 'text-emerald-400' : 'text-rose-400'} group-hover:animate-pulse`}>
                                  ${c.lastPrice}
                               </div>
                               <div className={`text-[11px] font-black italic flex items-center justify-end mt-1 ${isUp ? 'text-emerald-400' : 'text-rose-400'}`}>
                                  {isUp ? <ArrowUpRight size={12} className="mr-1"/> : <ArrowDownRight size={12} className="mr-1"/>}
                                  %{c.priceChangePercent.toFixed(2)}
                               </div>
                            </div>
                         </div>
                       )
                    })}
                 </div>
              </div>
           </div>
        </div>

        {/* SIMULATION TAB */}
        <div className={`absolute inset-0 transition-all duration-500 bg-[#0F172A] p-6 pb-32 overflow-y-auto custom-scrollbar ${activeTab === 'calc' ? 'translate-y-0 opacity-100' : 'translate-y-full opacity-0'}`}>
           <div className="max-w-xl mx-auto space-y-8">
              {activeSimTrade ? (
                 <div className="bg-slate-900 border border-white/10 rounded-[3rem] p-10 shadow-2xl relative overflow-hidden group">
                    {(() => {
                       const stats = getActiveSimStats();
                       if (!stats) return null;
                       return (
                         <div className="space-y-10 relative z-10">
                            <div className="flex justify-between items-center">
                               <div className="flex items-center space-x-5">
                                  <div className="w-16 h-16 bg-white/5 rounded-[1.5rem] border border-white/10 flex items-center justify-center text-white font-black text-2xl italic tracking-tighter group-hover:scale-105 transition-all">{activeSimTrade.symbol.substring(0,2)}</div>
                                  <div>
                                     <span className="font-black text-3xl text-white tracking-tighter uppercase leading-none">{activeSimTrade.symbol}</span>
                                     <span className={`block mt-2 px-3 py-1 rounded-xl text-[10px] font-black w-fit italic uppercase ${activeSimTrade.direction === 'LONG' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'}`}>{activeSimTrade.direction} 5X KALDIRAÇ</span>
                                  </div>
                               </div>
                            </div>

                            <div className={`p-10 rounded-[2.5rem] border-2 flex flex-col items-center justify-center space-y-3 transition-all duration-300 ${stats.isProfit ? 'bg-emerald-500/5 border-emerald-500/20' : 'bg-rose-500/5 border-rose-500/20'}`}>
                               <span className="text-[11px] font-black uppercase opacity-40 tracking-[0.4em]">Anlık Kar / Zarar ($)</span>
                               <div className={`text-7xl font-black italic tracking-tighter price-flash ${stats.isProfit ? 'text-emerald-400' : 'text-rose-400'}`}>
                                  {stats.isProfit ? '+' : ''}${stats.pnlUsd.toFixed(2)}
                               </div>
                               <div className={`text-2xl font-black opacity-60 ${stats.isProfit ? 'text-emerald-400' : 'text-rose-400'}`}>%{stats.pnlPct.toFixed(2)}</div>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                               <div className="bg-white/5 p-5 rounded-3xl border border-white/5">
                                  <div className="text-[10px] font-black text-slate-500 uppercase mb-2">Giriş Fiyatı</div>
                                  <div className="text-lg font-mono font-black text-slate-300">${activeSimTrade.entryPrice}</div>
                               </div>
                               <div className="bg-white/5 p-5 rounded-3xl border border-white/5">
                                  <div className="text-[10px] font-black text-slate-500 uppercase mb-2">Güncel Fiyat</div>
                                  <div className="text-lg font-mono font-black text-indigo-400">${stats.currentPrice}</div>
                               </div>
                            </div>

                            <button onClick={() => setActiveSimTrade(null)} className="w-full py-6 bg-white text-slate-900 rounded-[2rem] font-black uppercase text-xs tracking-[0.5em] shadow-2xl active:scale-95 transition-all hover:bg-slate-200">Pozisyonu Kapat</button>
                         </div>
                       )
                    })()}
                    <Waves className="absolute -bottom-20 -right-20 text-white/5 w-80 h-80 opacity-40 rotate-12" />
                 </div>
              ) : (
                 <div className="py-20 flex flex-col items-center text-center space-y-6">
                    <div className="w-24 h-24 bg-indigo-500/10 rounded-[3rem] flex items-center justify-center text-indigo-400 border border-indigo-500/20">
                       <Play size={48} fill="currentColor" />
                    </div>
                    <div>
                       <h2 className="text-3xl font-black uppercase italic tracking-tighter">İşlem Simülatörü</h2>
                       <p className="text-slate-500 text-sm font-medium uppercase mt-2 tracking-widest max-w-xs mx-auto leading-relaxed opacity-60">Radar veya Liste üzerinden bir varlık seçerek canlı kar/zarar takibini başlatın.</p>
                    </div>
                 </div>
              )}
           </div>
        </div>
      </main>

      {/* MOBILE NAVIGATION BAR */}
      <nav className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[200] w-[300px] bg-slate-900 border border-white/10 p-1.5 rounded-3xl shadow-[0_20px_50px_rgba(0,0,0,0.5)] flex items-center">
         <button onClick={() => setActiveTab('radar')} className={`flex-1 flex items-center justify-center space-x-2 h-12 rounded-[1.25rem] transition-all duration-300 ${activeTab === 'radar' ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/30 scale-105' : 'text-slate-500 hover:text-slate-300'}`}>
            <Zap size={18}/><span className="text-[10px] font-black uppercase tracking-widest">Radar</span>
         </button>
         <button onClick={() => setActiveTab('list')} className={`flex-1 flex items-center justify-center space-x-2 h-12 rounded-[1.25rem] transition-all duration-300 ${activeTab === 'list' ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/30 scale-105' : 'text-slate-500 hover:text-slate-300'}`}>
            <Activity size={18}/><span className="text-[10px] font-black uppercase tracking-widest">Liste</span>
         </button>
         <button onClick={() => setActiveTab('calc')} className={`flex-1 flex items-center justify-center space-x-2 h-12 rounded-[1.25rem] transition-all duration-300 ${activeTab === 'calc' ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/30 scale-105' : 'text-slate-500 hover:text-slate-300'}`}>
            <Calculator size={18}/><span className="text-[10px] font-black uppercase tracking-widest">Sim</span>
         </button>
      </nav>

      {/* REVAMPED DETAIL MODAL */}
      {analyzingSymbol && (
        <div className="fixed inset-0 z-[1000] bg-slate-900/80 backdrop-blur-xl flex items-center justify-center px-6">
           <div className="bg-slate-900 w-full max-w-md rounded-[3.5rem] overflow-hidden shadow-[0_0_80px_rgba(0,0,0,0.5)] border border-white/10 animate-in zoom-in duration-300 flex flex-col">
              <div className="px-8 py-6 border-b border-white/5 flex justify-between items-center bg-white/5">
                 <div className="flex items-center space-x-4">
                    <div className="w-12 h-12 bg-indigo-600 rounded-2xl flex items-center justify-center text-white font-black text-xl italic shadow-lg shadow-indigo-500/20">{analyzingSymbol[0]}</div>
                    <div>
                       <div className="flex items-center space-x-2">
                          <span className="font-black text-lg uppercase tracking-tight text-white">{analyzingSymbol}</span>
                          <span className="bg-indigo-500/20 text-indigo-400 text-[8px] font-black px-1.5 py-0.5 rounded border border-indigo-500/30 tracking-widest uppercase">PRO AI</span>
                       </div>
                       <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest mt-1">Smart Momentum Analysis</span>
                    </div>
                 </div>
                 <button onClick={() => setAnalyzingSymbol(null)} className="p-3 bg-white/5 rounded-2xl text-slate-400 hover:text-white transition-all"><X size={20}/></button>
              </div>

              <div className="p-8 space-y-8 overflow-y-auto max-h-[75vh] custom-scrollbar">
                {isAnalyzing ? (
                   <div className="py-24 flex flex-col items-center space-y-6">
                      <div className="relative">
                         <Loader2 className="animate-spin text-indigo-500" size={48}/>
                         <Brain className="absolute inset-0 m-auto text-indigo-300/50" size={20}/>
                      </div>
                      <span className="text-xs font-black text-slate-500 uppercase tracking-[0.4em] italic animate-pulse">Algoritma Verileri İşliyor...</span>
                   </div>
                ) : (
                   <>
                      {/* Interactive Momentum Chart Area */}
                      <div className="space-y-4">
                         <div className="flex justify-between items-end px-1">
                            <div>
                               <span className="text-[10px] font-black text-slate-500 uppercase flex items-center mb-1"><Clock size={12} className="mr-1.5 text-indigo-500"/> Canlı Fiyat Akışı</span>
                               <div className="text-4xl font-mono font-black text-white tracking-tighter italic price-flash">${tickerBuffer.current[analyzingSymbol]?.lastPrice}</div>
                            </div>
                            {Math.abs(tickerBuffer.current[analyzingSymbol]?.priceChangePercent || 0) > 15 && (
                              <div className="bg-emerald-500 text-slate-900 text-[10px] font-black px-3 py-1.5 rounded-xl uppercase tracking-widest shadow-lg shadow-emerald-500/20 animate-bounce">Yeni Zirve</div>
                            )}
                         </div>
                         <div ref={chartContainerRef} className="rounded-3xl overflow-hidden border border-white/5 bg-slate-800/20 p-2" />
                      </div>

                      {analysisResult && (
                        <div className={`p-8 rounded-[3rem] text-white relative overflow-hidden shadow-2xl transition-all ${analysisResult.direction === 'LONG' ? 'bg-gradient-to-br from-emerald-600 to-teal-700 shadow-emerald-500/20' : 'bg-gradient-to-br from-rose-600 to-pink-700 shadow-rose-500/20'}`}>
                           <div className="flex justify-between items-center mb-6 relative z-10">
                              <span className="text-[10px] font-black uppercase tracking-widest opacity-60">AI Güven Seviyesi</span>
                              <div className="flex space-x-1.5">
                                 {Array.from({length: 4}).map((_,i) => <div key={i} className={`w-1.5 h-4 rounded-full ${i < Math.round(analysisResult.score*4) ? 'bg-white shadow-[0_0_8px_rgba(255,255,255,0.8)]' : 'bg-white/20'}`} />)}
                              </div>
                           </div>
                           <div className="relative z-10">
                              <h2 className="text-5xl font-black italic mb-3 tracking-tighter leading-none">{analysisResult.direction} 5X</h2>
                              <p className="text-xs font-bold leading-relaxed italic opacity-90 line-clamp-4">"{analysisResult.rationale_tr}"</p>
                           </div>
                           <div className="grid grid-cols-2 gap-4 mt-8 relative z-10">
                              <div className="bg-black/10 backdrop-blur-md p-4 rounded-3xl text-center border border-white/10">
                                 <span className="text-[9px] opacity-60 block uppercase mb-1 tracking-widest">Hedef Fiyat</span>
                                 <span className="text-sm font-mono font-black text-emerald-300 italic">${analysisResult.take_profit}</span>
                              </div>
                              <div className="bg-black/10 backdrop-blur-md p-4 rounded-3xl text-center border border-white/10">
                                 <span className="text-[9px] opacity-60 block uppercase mb-1 tracking-widest">Stop Loss</span>
                                 <span className="text-sm font-mono font-black text-rose-300 italic">${analysisResult.stop_loss}</span>
                              </div>
                           </div>
                        </div>
                      )}
                   </>
                )}
              </div>

              <div className="p-8 bg-slate-900 border-t border-white/5 flex space-x-3">
                 <button onClick={() => setAnalyzingSymbol(null)} className="flex-1 py-5 bg-white/5 text-slate-400 rounded-3xl font-black uppercase text-[10px] tracking-widest hover:bg-white/10 transition-all">İptal</button>
                 <button onClick={() => startSimTrade(analyzingSymbol, analysisResult?.direction || 'LONG')} 
                    className="flex-[2] py-5 bg-white text-slate-900 rounded-3xl font-black uppercase text-[10px] tracking-widest shadow-xl shadow-white/10 active:scale-95 transition-all hover:bg-slate-200">
                    Sinyali Uygula
                 </button>
              </div>
           </div>
        </div>
      )}

      {/* SETTINGS DRAWER */}
      {isSettingsOpen && (
        <div className="fixed inset-0 z-[2000] bg-slate-900/60 backdrop-blur-xl flex items-center justify-center px-6">
           <div className="bg-slate-900 w-full max-w-sm rounded-[3rem] p-8 shadow-3xl animate-in zoom-in duration-300 border border-white/10">
              <div className="flex justify-between items-center mb-10">
                 <h3 className="font-black text-2xl italic uppercase tracking-tighter">Sentinel Radar</h3>
                 <button onClick={()=>setIsSettingsOpen(false)} className="p-2.5 bg-white/5 rounded-2xl text-slate-500 hover:text-white"><X size={20}/></button>
              </div>
              <div className="space-y-8">
                 <div className="bg-white/5 p-6 rounded-[2rem] border border-white/5">
                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-4">Minimum Hacim (Milyon $)</label>
                    <div className="flex items-center justify-between gap-6">
                       <span className="text-3xl font-black italic text-white tracking-tighter">${minVolume}M</span>
                       <input type="range" min="1" max="500" step="5" value={minVolume} onChange={e=>setMinVolume(Number(e.target.value))} className="w-full h-1.5 bg-slate-700 rounded-full appearance-none accent-indigo-500 cursor-pointer"/>
                    </div>
                 </div>
                 <div className="bg-white/5 p-6 rounded-[2rem] border border-white/5 space-y-4">
                    <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest block">Simülasyon Bakiyesi ($)</span>
                    <div className="flex items-center space-x-4">
                       <Wallet size={24} className="text-indigo-400" />
                       <input type="number" value={simAmount} onChange={e=>setSimAmount(Number(e.target.value))} className="w-full bg-transparent text-3xl font-black outline-none text-white italic tracking-tighter"/>
                    </div>
                 </div>
                 <button onClick={()=>setIsSettingsOpen(false)} className="w-full py-6 bg-indigo-600 text-white rounded-3xl font-black uppercase text-[11px] tracking-[0.3em] shadow-xl shadow-indigo-500/20 active:scale-95 transition-all hover:bg-indigo-500">Ayarları Kaydet</button>
              </div>
           </div>
        </div>
      )}
    </div>
  );
};

export default App;
