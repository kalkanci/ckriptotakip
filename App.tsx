
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { 
  Settings, Zap, Activity, X, Brain, Loader2, Clock, 
  TrendingUp, TrendingDown, ChevronRight, Waves, Target, 
  Calculator, Wallet, AlertCircle, Play, StopCircle, 
  RefreshCw, Gauge, Flame, BarChart3, TrendingUpDown, ArrowUpRight, ArrowDownRight
} from 'lucide-react';
import { MarketTicker, UserSettings, Kline } from './types';
import { binanceService } from './services/binanceService';
import { llmService } from './services/llmService';
import { createChart, IChartApi } from 'lightweight-charts';

interface SimulatedTrade {
  symbol: string;
  entryPrice: number;
  amount: number;
  leverage: number;
  direction: 'LONG' | 'SHORT';
  startTime: number;
}

// Sparkline Component for List View
const Sparkline: React.FC<{ data: number[], isUp: boolean }> = ({ data, isUp }) => {
  if (data.length < 2) return <div className="w-16 h-8 bg-slate-50 rounded animate-pulse" />;
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
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="drop-shadow-[0_0_4px_rgba(0,255,136,0.3)]"
      />
    </svg>
  );
};

const App: React.FC = () => {
  // --- STATES ---
  const [activeTab, setActiveTab] = useState<'radar' | 'list' | 'calc'>('radar');
  const [allFutures, setAllFutures] = useState<MarketTicker[]>([]);
  const [analyzingSymbol, setAnalyzingSymbol] = useState<string | null>(null);
  const [analysisResult, setAnalysisResult] = useState<any | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [minVolume, setMinVolume] = useState(10);
  const [simAmount, setSimAmount] = useState(100);
  const [activeSimTrade, setActiveSimTrade] = useState<SimulatedTrade | null>(null);

  // --- REFS & CACHE ---
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

  // --- SCORING LOGIC ---
  const calculatePotential = (ticker: MarketTicker): number => {
    const absChange = Math.abs(ticker.priceChangePercent);
    const volumeImpact = Math.log10(ticker.volume + 1) / 4;
    const range = ((ticker.high - ticker.low) / ticker.low) * 100;
    const score = (absChange * 0.4) + (volumeImpact * 35) + (range * 2);
    return Math.min(score, 100);
  };

  // --- DATA FLOW ---
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
          if (priceHistory.current[t.s].length > 20) priceHistory.current[t.s].shift();

          tickerBuffer.current[t.s] = { 
            symbol: t.s, lastPrice: price, priceChangePercent: change, 
            high: parseFloat(t.h), low: parseFloat(t.l), volume: parseFloat(t.q),
            vScore: calculatePotential({ symbol: t.s, lastPrice: price, priceChangePercent: change, high: parseFloat(t.h), low: parseFloat(t.l), volume: parseFloat(t.q) })
          };
          lastUpdateRef.current[t.s] = Date.now();
        });
      }
    });
    const loop = setInterval(() => setAllFutures(Object.values(tickerBuffer.current)), 1000);
    return () => { clearInterval(loop); unsub(); binanceService.disconnect(); };
  }, []);

  // --- CHART LOGIC ---
  useEffect(() => {
    if (analyzingSymbol && chartContainerRef.current) {
      chartRef.current = createChart(chartContainerRef.current, {
        layout: { background: { color: 'transparent' }, textColor: '#64748b' },
        grid: { vertLines: { visible: false }, horzLines: { color: '#f1f5f9' } },
        width: chartContainerRef.current.clientWidth,
        height: 200,
        handleScale: false,
        handleScroll: false,
      });
      const areaSeries = chartRef.current.addAreaSeries({
        lineColor: '#4f46e5',
        topColor: 'rgba(79, 70, 229, 0.2)',
        bottomColor: 'rgba(79, 70, 229, 0)',
        lineWidth: 2,
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

  // --- HANDLERS ---
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
  };

  const getActiveSimStats = () => {
    if (!activeSimTrade) return null;
    const ticker = tickerBuffer.current[activeSimTrade.symbol];
    if (!ticker) return null;
    let change = ((ticker.lastPrice - activeSimTrade.entryPrice) / activeSimTrade.entryPrice) * 100;
    if (activeSimTrade.direction === 'SHORT') change = -change;
    const pnl = (activeSimTrade.amount * change * 5) / 100;
    return { currentPrice: ticker.lastPrice, pnlPct: change * 5, pnlUsd: pnl, isProfit: pnl >= 0 };
  };

  // --- FILTERED DATA ---
  const topSignals = useMemo(() => 
    allFutures.filter(c => (c.vScore || 0) > 60).sort((a,b) => (b.vScore || 0) - (a.vScore || 0)).slice(0, 10)
  , [allFutures]);

  const marketList = useMemo(() => 
    allFutures.filter(c => (c.volume/1000000) > minVolume)
      .sort((a,b) => Math.abs(b.priceChangePercent) - Math.abs(a.priceChangePercent))
  , [allFutures, minVolume]);

  return (
    <div className="flex flex-col h-screen bg-[#F8FAFC] text-slate-900 overflow-hidden">
      <style>{`
        @keyframes flashGreen { 0% { color: #00FF88; } 100% { color: inherit; } }
        @keyframes flashRed { 0% { color: #FF0055; } 100% { color: inherit; } }
        @keyframes glowPulse { 0% { box-shadow: 0 0 0px rgba(0, 255, 136, 0); } 50% { box-shadow: 0 0 20px rgba(0, 255, 136, 0.4); } 100% { box-shadow: 0 0 0px rgba(0, 255, 136, 0); } }
        .animate-flash-up { animation: flashGreen 1s ease-out; }
        .animate-flash-down { animation: flashRed 1s ease-out; }
        .pump-glow { animation: glowPulse 2s infinite; border-color: #00FF88 !important; }
      `}</style>

      {/* HEADER */}
      <header className="h-14 bg-white border-b flex items-center justify-between px-4 shrink-0 shadow-sm z-50">
        <div className="flex items-center space-x-2">
          <div className="w-8 h-8 bg-slate-900 rounded-lg flex items-center justify-center text-white font-black">S</div>
          <span className="font-black text-xs tracking-tighter uppercase italic">Sentinel <span className="text-indigo-600">Pro</span></span>
        </div>
        <button onClick={() => setIsSettingsOpen(true)} className="p-2 bg-slate-50 rounded-xl text-slate-400"><Settings size={18}/></button>
      </header>

      {/* MAIN */}
      <main className="flex-1 relative overflow-hidden">
        
        {/* RADAR TAB */}
        <div className={`absolute inset-0 transition-all duration-500 p-4 pb-32 overflow-y-auto custom-scrollbar ${activeTab === 'radar' ? 'translate-x-0 opacity-100' : '-translate-x-full opacity-0'}`}>
           <div className="max-w-4xl mx-auto space-y-6">
              {/* Pump Radar Alert Widget */}
              <div className="bg-slate-900 rounded-[2rem] p-6 text-white relative overflow-hidden shadow-2xl">
                 <div className="relative z-10 flex items-center justify-between">
                    <div>
                       <div className="flex items-center space-x-2 text-orange-400 mb-1">
                          <Flame size={16} className="animate-pulse" />
                          <span className="text-[10px] font-black uppercase tracking-widest">Yüksek Volatilite Alarmı</span>
                       </div>
                       <h2 className="text-2xl font-black italic tracking-tighter uppercase">Fırsat Takibi Aktif</h2>
                    </div>
                    <div className="text-right">
                       <span className="text-[9px] font-black opacity-40 uppercase block">Anlık Veri</span>
                       <div className="flex items-center space-x-2">
                          <span className="w-2 h-2 bg-emerald-500 rounded-full animate-ping" />
                          <span className="text-xs font-mono font-bold">LIVE</span>
                       </div>
                    </div>
                 </div>
                 <Waves className="absolute -bottom-10 -right-10 text-white/5 w-48 h-48 rotate-12" />
              </div>

              {/* Smaller Signal Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                 {topSignals.map(c => {
                    const isPump = c.priceChangePercent > 10;
                    return (
                      <div key={c.symbol} onClick={() => handleQuickAnalysis(c.symbol)} className={`bg-white border border-slate-100 p-4 rounded-3xl flex flex-col justify-between hover:shadow-xl transition-all cursor-pointer relative ${isPump ? 'pump-glow' : ''}`}>
                         <div className="flex justify-between items-start">
                            <div>
                               <span className="text-xs font-black text-slate-900 block">{c.symbol.replace('USDT','')}</span>
                               <span className="text-[9px] font-bold text-slate-400 italic">${c.lastPrice}</span>
                            </div>
                            <div className={`p-1 rounded-lg ${c.priceChangePercent >= 0 ? 'bg-emerald-500' : 'bg-rose-500'} text-white`}>
                               {c.priceChangePercent >= 0 ? <TrendingUp size={10}/> : <TrendingDown size={10}/>}
                            </div>
                         </div>
                         <div className="mt-4">
                            <div className="flex justify-between items-end mb-1">
                               <span className="text-[8px] font-black text-slate-300 uppercase">Alım Gücü</span>
                               <span className="text-[10px] font-black text-indigo-600">%{c.vScore?.toFixed(0)}</span>
                            </div>
                            <div className="h-1 w-full bg-slate-50 rounded-full overflow-hidden">
                               <div className="h-full bg-indigo-500 transition-all duration-1000" style={{ width: `${c.vScore}%` }} />
                            </div>
                         </div>
                      </div>
                    )
                 })}
              </div>
           </div>
        </div>

        {/* LIST TAB (LIVE MOMENTUM DASHBOARD) */}
        <div className={`absolute inset-0 transition-all duration-500 bg-white p-4 pb-32 overflow-y-auto custom-scrollbar ${activeTab === 'list' ? 'translate-x-0 opacity-100' : 'translate-x-full opacity-0'}`}>
           <div className="max-w-4xl mx-auto space-y-4">
              <div className="flex items-center justify-between px-2 mb-4">
                 <h2 className="text-xl font-black italic uppercase tracking-tighter">Canlı Momentum</h2>
                 <div className="text-[9px] font-bold text-slate-400 uppercase">15dk Momentum Sıralı</div>
              </div>
              <div className="space-y-2">
                 {marketList.map(c => {
                    const isUp = c.priceChangePercent >= 0;
                    const isPump = Math.abs(c.priceChangePercent) > 10;
                    return (
                      <div key={c.symbol} onClick={() => handleQuickAnalysis(c.symbol)} className={`flex items-center p-3 rounded-2xl border transition-all hover:bg-slate-50 cursor-pointer ${isPump ? 'border-indigo-100 bg-indigo-50/20' : 'border-slate-50'}`}>
                         <div className="flex-1 flex items-center space-x-3">
                            <div className="w-9 h-9 bg-slate-900 rounded-xl flex items-center justify-center text-white font-black text-xs italic">{c.symbol[0]}</div>
                            <div>
                               <div className="font-black text-xs text-slate-900 uppercase">{c.symbol.replace('USDT','')}</div>
                               <div className="text-[9px] font-bold text-slate-400">${(c.volume/1000000).toFixed(1)}M Vol</div>
                            </div>
                         </div>
                         <div className="hidden sm:block px-4">
                            <Sparkline data={priceHistory.current[c.symbol] || []} isUp={isUp} />
                         </div>
                         <div className="text-right w-24">
                            <div className={`text-xs font-mono font-black ${isUp ? 'text-emerald-500' : 'text-rose-500'}`}>
                               ${c.lastPrice}
                            </div>
                            <div className={`text-[10px] font-black italic flex items-center justify-end ${isUp ? 'text-emerald-500' : 'text-rose-500'}`}>
                               {isUp ? <ArrowUpRight size={10} className="mr-0.5"/> : <ArrowDownRight size={10} className="mr-0.5"/>}
                               %{c.priceChangePercent.toFixed(2)}
                            </div>
                         </div>
                      </div>
                    )
                 })}
              </div>
           </div>
        </div>

        {/* SIM TAB */}
        <div className={`absolute inset-0 transition-all duration-500 bg-[#F8FAFC] p-4 pb-32 overflow-y-auto custom-scrollbar ${activeTab === 'calc' ? 'translate-y-0 opacity-100' : 'translate-y-full opacity-0'}`}>
           <div className="max-w-2xl mx-auto space-y-6">
              {activeSimTrade ? (
                 <div className="bg-white rounded-[3rem] p-8 shadow-2xl border border-slate-100 relative overflow-hidden">
                    {(() => {
                       const stats = getActiveSimStats();
                       if (!stats) return null;
                       return (
                         <div className="space-y-8 relative z-10">
                            <div className="flex justify-between items-center">
                               <div className="flex items-center space-x-4">
                                  <div className="w-14 h-14 bg-slate-900 rounded-2xl flex items-center justify-center text-white font-black text-xl italic">{activeSimTrade.symbol.substring(0,2)}</div>
                                  <span className="font-black text-2xl text-slate-900 tracking-tighter uppercase">{activeSimTrade.symbol}</span>
                               </div>
                               <span className={`px-3 py-1 rounded-xl text-[10px] font-black text-white ${activeSimTrade.direction === 'LONG' ? 'bg-emerald-500' : 'bg-rose-500'}`}>{activeSimTrade.direction} 5X</span>
                            </div>
                            <div className={`p-8 rounded-[2rem] border-4 flex flex-col items-center justify-center space-y-2 ${stats.isProfit ? 'bg-emerald-50 border-emerald-100' : 'bg-rose-50 border-rose-100'}`}>
                               <span className="text-[10px] font-black uppercase opacity-40 tracking-widest">Anlık PNL ($)</span>
                               <div className={`text-6xl font-black italic tracking-tighter ${stats.isProfit ? 'text-emerald-500' : 'text-rose-500'}`}>
                                  {stats.isProfit ? '+' : ''}${stats.pnlUsd.toFixed(2)}
                               </div>
                               <div className="text-xl font-black opacity-50">%{stats.pnlPct.toFixed(2)}</div>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                               <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
                                  <div className="text-[8px] font-black text-slate-400 uppercase mb-1">Giriş Fiyatı</div>
                                  <div className="text-sm font-mono font-bold">${activeSimTrade.entryPrice}</div>
                               </div>
                               <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
                                  <div className="text-[8px] font-black text-slate-400 uppercase mb-1">Güncel Fiyat</div>
                                  <div className="text-sm font-mono font-bold text-indigo-600">${stats.currentPrice}</div>
                               </div>
                            </div>
                            <button onClick={() => setActiveSimTrade(null)} className="w-full py-5 bg-slate-900 text-white rounded-3xl font-black uppercase text-xs tracking-[0.4em] shadow-xl shadow-slate-200 active:scale-95 transition-all">İşlemi Kapat ve Kar Al</button>
                         </div>
                       )
                    })()}
                    <Waves className="absolute -bottom-20 -right-20 text-indigo-50 w-80 h-80 opacity-40 rotate-12" />
                 </div>
              ) : (
                 <div className="space-y-4 py-10 flex flex-col items-center text-center">
                    <div className="w-20 h-20 bg-indigo-50 rounded-[2.5rem] flex items-center justify-center text-indigo-600 mb-4">
                       <Play size={40} fill="currentColor" />
                    </div>
                    <h2 className="text-2xl font-black uppercase italic tracking-tighter">İşlem Başlat</h2>
                    <p className="text-xs font-bold text-slate-400 max-w-xs uppercase leading-relaxed">Radar sayfasından bir coin seçerek simülasyonu başlatabilirsin.</p>
                 </div>
              )}
           </div>
        </div>
      </main>

      {/* NAVIGATION */}
      <nav className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[200] w-[280px] bg-slate-900 p-1.5 rounded-[2rem] shadow-2xl flex items-center">
         <button onClick={() => setActiveTab('radar')} className={`flex-1 flex items-center justify-center space-x-2 h-11 rounded-3xl transition-all ${activeTab === 'radar' ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-500'}`}>
            <Zap size={16}/><span className="text-[9px] font-black uppercase tracking-widest">Radar</span>
         </button>
         <button onClick={() => setActiveTab('list')} className={`flex-1 flex items-center justify-center space-x-2 h-11 rounded-3xl transition-all ${activeTab === 'list' ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-500'}`}>
            <Activity size={16}/><span className="text-[9px] font-black uppercase tracking-widest">Liste</span>
         </button>
         <button onClick={() => setActiveTab('calc')} className={`flex-1 flex items-center justify-center space-x-2 h-11 rounded-3xl transition-all ${activeTab === 'calc' ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-500'}`}>
            <Calculator size={16}/><span className="text-[9px] font-black uppercase tracking-widest">Sim</span>
         </button>
      </nav>

      {/* CENTERED DETAIL MODAL */}
      {analyzingSymbol && (
        <div className="fixed inset-0 z-[1000] bg-slate-900/60 backdrop-blur-md flex items-center justify-center px-4">
           <div className="bg-white w-full max-w-sm rounded-[3rem] overflow-hidden shadow-3xl animate-in zoom-in duration-300 flex flex-col">
              <div className="px-6 py-5 border-b border-slate-100 flex justify-between items-center">
                 <div className="flex items-center space-x-3">
                    <div className="w-10 h-10 bg-slate-900 rounded-xl flex items-center justify-center text-white font-black italic">{analyzingSymbol[0]}</div>
                    <div>
                       <span className="font-black text-sm uppercase block leading-none">{analyzingSymbol}</span>
                       <span className="text-[8px] font-bold text-indigo-500 uppercase tracking-widest mt-1">Smart Engine Analiz</span>
                    </div>
                 </div>
                 <button onClick={() => setAnalyzingSymbol(null)} className="p-2 bg-slate-50 rounded-xl text-slate-400 hover:text-slate-900"><X size={20}/></button>
              </div>

              <div className="p-6 space-y-6 overflow-y-auto max-h-[70vh] custom-scrollbar">
                {isAnalyzing ? (
                   <div className="py-20 flex flex-col items-center space-y-4">
                      <div className="relative">
                         <Loader2 className="animate-spin text-indigo-500" size={40}/>
                         <Brain className="absolute inset-0 m-auto text-indigo-300" size={16}/>
                      </div>
                      <span className="text-[10px] font-black text-slate-400 uppercase tracking-[0.3em] italic animate-pulse">Algoritma İnceliyor...</span>
                   </div>
                ) : (
                   <>
                      {/* Interaktif Grafik */}
                      <div className="space-y-2">
                         <div className="flex justify-between items-end mb-1">
                            <span className="text-[9px] font-black text-slate-400 uppercase flex items-center"><Clock size={10} className="mr-1"/> Son 1 Saat</span>
                            <span className="text-xl font-mono font-black text-slate-900 tracking-tighter">${tickerBuffer.current[analyzingSymbol]?.lastPrice}</span>
                         </div>
                         <div ref={chartContainerRef} className="rounded-2xl overflow-hidden border border-slate-50 bg-slate-50/50" />
                      </div>

                      {analysisResult && (
                        <div className={`p-6 rounded-[2.5rem] text-white relative overflow-hidden shadow-xl ${analysisResult.direction === 'LONG' ? 'bg-emerald-600 shadow-emerald-200' : 'bg-rose-600 shadow-rose-200'}`}>
                           <div className="flex justify-between items-center mb-4 relative z-10">
                              <span className="text-[10px] font-black uppercase tracking-widest opacity-60">AI Tavsiyesi</span>
                              <div className="flex space-x-1">
                                 {Array.from({length: 3}).map((_,i) => <span key={i} className={`w-1 h-3 rounded-full ${i < analysisResult.score*3 ? 'bg-white' : 'bg-white/20'}`} />)}
                              </div>
                           </div>
                           <div className="relative z-10">
                              <h2 className="text-4xl font-black italic mb-2 tracking-tighter">{analysisResult.direction} 5X</h2>
                              <p className="text-[11px] font-medium leading-relaxed italic opacity-90">"{analysisResult.rationale_tr}"</p>
                           </div>
                           <div className="grid grid-cols-2 gap-3 mt-6 relative z-10">
                              <div className="bg-black/10 p-3 rounded-2xl text-center">
                                 <span className="text-[8px] opacity-60 block uppercase mb-0.5">Hedef (TP)</span>
                                 <span className="text-xs font-mono font-black text-emerald-300">${analysisResult.take_profit}</span>
                              </div>
                              <div className="bg-black/10 p-3 rounded-2xl text-center">
                                 <span className="text-[8px] opacity-60 block uppercase mb-0.5">Zarar Durdur</span>
                                 <span className="text-xs font-mono font-black text-rose-300">${analysisResult.stop_loss}</span>
                              </div>
                           </div>
                        </div>
                      )}
                   </>
                )}
              </div>

              <div className="p-6 bg-white border-t flex space-x-2">
                 <button onClick={() => setAnalyzingSymbol(null)} className="flex-1 py-4 bg-slate-50 text-slate-500 rounded-2xl font-black uppercase text-[10px] tracking-widest transition-all">Kapat</button>
                 <button onClick={() => startSimTrade(analyzingSymbol, analysisResult?.direction || 'LONG')} className="flex-[2] py-4 bg-slate-900 text-white rounded-2xl font-black uppercase text-[10px] tracking-widest shadow-xl active:scale-95 transition-all">İşleme Başla</button>
              </div>
           </div>
        </div>
      )}

      {/* SETTINGS (SIMPLIFIED FOR MOBILE) */}
      {isSettingsOpen && (
        <div className="fixed inset-0 z-[2000] bg-slate-900/40 backdrop-blur-md flex items-center justify-center px-4">
           <div className="bg-white w-full max-w-sm rounded-[2.5rem] p-8 shadow-3xl animate-in zoom-in duration-300">
              <div className="flex justify-between items-center mb-8">
                 <h3 className="font-black text-xl italic uppercase tracking-tighter">Sentinel Ayarlar</h3>
                 <button onClick={()=>setIsSettingsOpen(false)} className="p-2 bg-slate-50 rounded-xl text-slate-400"><X size={20}/></button>
              </div>
              <div className="space-y-6">
                 <div className="bg-slate-50 p-5 rounded-3xl">
                    <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-2">Hacim Filtresi (Milyon $)</label>
                    <div className="flex items-center justify-between">
                       <span className="text-2xl font-black italic text-slate-900">${minVolume}M</span>
                       <input type="range" min="1" max="100" value={minVolume} onChange={e=>setMinVolume(Number(e.target.value))} className="w-1/2 h-2 bg-slate-200 rounded-full appearance-none accent-indigo-600"/>
                    </div>
                 </div>
                 <div className="bg-slate-50 p-5 rounded-3xl space-y-4">
                    <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest block">Kasa Miktarı ($)</span>
                    <input type="number" value={simAmount} onChange={e=>setSimAmount(Number(e.target.value))} className="w-full bg-transparent text-2xl font-black outline-none text-slate-900 italic"/>
                 </div>
                 <button onClick={()=>setIsSettingsOpen(false)} className="w-full py-5 bg-indigo-600 text-white rounded-3xl font-black uppercase text-[11px] tracking-widest shadow-xl active:scale-95 transition-all">Uygula ve Kapat</button>
              </div>
           </div>
        </div>
      )}
    </div>
  );
};

export default App;
