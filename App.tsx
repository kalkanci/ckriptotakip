
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { 
  Settings, Zap, Activity, X, 
  Search, Brain, Loader2,
  Clock, Hash, ArrowUpDown, TrendingDown, TrendingUp,
  Cloud, CloudLightning, ChevronRight,
  BarChart2, ShieldCheck, Volume2,
  RefreshCcw, Filter, AlertTriangle, TrendingUpDown,
  PieChart, BarChart3, Globe, Waves, Target, ShieldAlert,
  Calculator, TrendingUpDown as TrendIcon, Wallet, ArrowRight,
  Info, TrendingDown as DownIcon, TrendingUp as UpIcon, AlertCircle,
  Play, StopCircle, RefreshCw, Gauge, Flame, BarChart
} from 'lucide-react';
import { MarketTicker, UserSettings, LLMAnalysis, Kline, FuturesMetrics } from './types';
import { binanceService } from './services/binanceService';
import { llmService } from './services/llmService';

interface SimulatedTrade {
  symbol: string;
  entryPrice: number;
  amount: number;
  leverage: number;
  direction: 'LONG' | 'SHORT';
  startTime: number;
}

const App: React.FC = () => {
  const [userSettings, setUserSettings] = useState<UserSettings>(() => {
    const saved = localStorage.getItem('sentinel_pro_settings');
    return saved ? JSON.parse(saved) : { 
      riskPercent: 10, leverage: 5, maxNotional: 1150, dailyLossLimit: 25,
      buyScoreThreshold: 0.5, buyJumpThreshold: 15, ptpTargets: [], dcaSteps: [],
      autoOptimize: true, liqProtectionThreshold: 5, liqReductionRatio: 25,
      telegramBotToken: '', telegramChatId: '', isNotificationEnabled: true,
      isWebNotificationEnabled: false
    };
  });

  const [activeTab, setActiveTab] = useState<'radar' | 'list' | 'calc'>('radar');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [allFutures, setAllFutures] = useState<MarketTicker[]>([]);
  
  const [searchQuery, setSearchQuery] = useState('');
  const [sortConfig, setSortConfig] = useState<{ key: keyof MarketTicker, direction: 'asc' | 'desc' }>({ key: 'vScore', direction: 'desc' });
  const [filterType, setFilterType] = useState<'all' | 'gainers' | 'losers' | 'potential'>('all');
  const [minVolume, setMinVolume] = useState(0); 

  // Simülatör State
  const [simAmount, setSimAmount] = useState(100);
  const [activeSimTrade, setActiveSimTrade] = useState<SimulatedTrade | null>(null);

  const [analyzingSymbol, setAnalyzingSymbol] = useState<string | null>(null);
  const [analysisResult, setAnalysisResult] = useState<any | null>(null);
  const [history15m, setHistory15m] = useState<Kline[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  
  const telegramMessageRef = useRef<Record<string, { id: number, time: number, lastScore: number }>>({});
  const tickerBuffer = useRef<Record<string, MarketTicker>>({});

  useEffect(() => {
    localStorage.setItem('sentinel_pro_settings', JSON.stringify(userSettings));
  }, [userSettings]);

  // Scoring Logic: Hacim, Fiyat ve Momentum entegrasyonu
  const calculatePotential = (ticker: MarketTicker): number => {
    const absChange = Math.abs(ticker.priceChangePercent);
    const volumeImpact = Math.log10(ticker.volume + 1) / 4.5;
    const trendFactor = ticker.trend === 'UP' || ticker.trend === 'DOWN' ? 15 : 0;
    const score = (absChange * 0.5) + (volumeImpact * 35) + trendFactor;
    return Math.min(score, 100);
  };

  const updateTelegram = async (symbol: string, change: number, price: number, score: number) => {
    if (!userSettings.telegramBotToken || !userSettings.telegramChatId || !userSettings.isNotificationEnabled) return;
    const now = Date.now();
    const prev = telegramMessageRef.current[symbol];
    if (score < 80) return;
    if (prev && (now - prev.time < 300000)) return; 

    const text = `🎯 *SENTINEL: 5X SİNYAL ONAYI*\n\n` +
                 `💎 Varlık: #${symbol.replace('USDT','')}\n` +
                 `🔥 Güç Skoru: %${score.toFixed(0)}\n` +
                 `📊 Değişim: %${change.toFixed(2)}\n` +
                 `💵 Fiyat: $${price}\n\n` +
                 `💡 *Detaylı analiz için uygulamayı açın.*`;

    try {
      const res = await fetch(`https://api.telegram.org/bot${userSettings.telegramBotToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: userSettings.telegramChatId, text, parse_mode: 'Markdown' })
      });
      const data = await res.json();
      if (data.ok) telegramMessageRef.current[symbol] = { id: data.result.message_id, time: now, lastScore: score };
    } catch (e) {}
  };

  const handleQuickAnalysis = async (symbol: string) => {
    setIsAnalyzing(true);
    setAnalyzingSymbol(symbol);
    setAnalysisResult(null);
    setHistory15m([]);
    try {
      const history1m = await binanceService.getHistory(symbol, '1m', 50);
      const h15 = await binanceService.getHistory(symbol, '15m', 10);
      setHistory15m(h15);
      const ticker = tickerBuffer.current[symbol];
      if (ticker) {
        const result = await llmService.analyzePump(ticker, history1m);
        setAnalysisResult(result);
      }
    } catch (error) {
      console.error("Analiz hatası", error);
    } finally {
      setIsAnalyzing(false);
    }
  };

  useEffect(() => {
    binanceService.connect();
    const unsub = binanceService.onMessage((data) => {
      if (Array.isArray(data)) {
        data.forEach(t => {
          if (!t.s.endsWith('USDT')) return;
          const change = parseFloat(t.P);
          const price = parseFloat(t.c);
          const ticker: MarketTicker = { 
            symbol: t.s, lastPrice: price, priceChangePercent: change, 
            high: parseFloat(t.h), low: parseFloat(t.l), volume: parseFloat(t.q),
            trend: change > 2.5 ? 'UP' : (change < -2.5 ? 'DOWN' : 'NEUTRAL')
          };
          ticker.vScore = calculatePotential(ticker);
          tickerBuffer.current[t.s] = ticker;
          updateTelegram(t.s, change, price, ticker.vScore);
        });
      }
    });
    const loop = setInterval(() => setAllFutures(Object.values(tickerBuffer.current) as MarketTicker[]), 1000);
    return () => { clearInterval(loop); unsub(); binanceService.disconnect(); };
  }, [userSettings]);

  const aiSignals = useMemo(() => 
    [...allFutures].filter(c => c.vScore && c.vScore > 65).sort((a,b) => (b.vScore || 0) - (a.vScore || 0)).slice(0, 10)
  , [allFutures]);

  const trendingAssets = useMemo(() => 
    [...allFutures].sort((a,b) => Math.abs(b.priceChangePercent) - Math.abs(a.priceChangePercent)).slice(0, 12)
  , [allFutures]);

  const marketStats = useMemo(() => {
    const total = allFutures.length;
    if (total === 0) return { total: 0, gainers: 0, losers: 0, avgVScore: 0, totalVol: 0 };
    const gainers = allFutures.filter(c => c.priceChangePercent > 0).length;
    const losers = total - gainers;
    const avgVScore = allFutures.reduce((acc, c) => acc + (c.vScore || 0), 0) / total;
    const totalVol = allFutures.reduce((acc, c) => acc + (c.volume || 0), 0) / 1000000;
    return { total, gainers, losers, avgVScore, totalVol };
  }, [allFutures]);

  const filteredAndSortedList = useMemo(() => {
    let result = [...allFutures];
    if (searchQuery) result = result.filter(c => c.symbol.toLowerCase().includes(searchQuery.toLowerCase()));
    if (filterType === 'gainers') result = result.filter(c => c.priceChangePercent > 3);
    else if (filterType === 'losers') result = result.filter(c => c.priceChangePercent < -3);
    else if (filterType === 'potential') result = result.filter(c => (c.vScore || 0) > 50);
    if (minVolume > 0) result = result.filter(c => (c.volume / 1000000) >= minVolume);
    result.sort((a, b) => {
      const valA = a[sortConfig.key] || 0;
      const valB = b[sortConfig.key] || 0;
      return sortConfig.direction === 'desc' ? (valB as number) - (valA as number) : (valA as number) - (valB as number);
    });
    return result;
  }, [allFutures, searchQuery, sortConfig, filterType, minVolume]);

  const getActiveSimStats = () => {
    if (!activeSimTrade) return null;
    const currentTicker = tickerBuffer.current[activeSimTrade.symbol];
    if (!currentTicker) return null;
    const currentPrice = currentTicker.lastPrice;
    const entry = activeSimTrade.entryPrice;
    const lev = activeSimTrade.leverage;
    let priceChangePct = ((currentPrice - entry) / entry) * 100;
    if (activeSimTrade.direction === 'SHORT') priceChangePct = -priceChangePct;
    const pnlPct = priceChangePct * lev;
    const pnlUsd = (activeSimTrade.amount * pnlPct) / 100;
    return { currentPrice, pnlPct, pnlUsd, isProfit: pnlUsd >= 0 };
  };

  const startSimTrade = (symbol: string, direction: 'LONG' | 'SHORT') => {
    const ticker = tickerBuffer.current[symbol];
    if (!ticker) return;
    setActiveSimTrade({
      symbol, entryPrice: ticker.lastPrice, amount: simAmount, leverage: 5, direction, startTime: Date.now()
    });
  };

  return (
    <div className="flex flex-col h-screen bg-[#F1F5F9] text-slate-900 overflow-hidden font-sans select-none">
      {/* HEADER */}
      <header className="h-14 bg-white border-b border-slate-100 flex items-center justify-between px-6 shrink-0 z-[100] shadow-sm">
        <div className="flex items-center space-x-3">
          <div className="w-8 h-8 bg-slate-900 rounded-lg flex items-center justify-center text-white font-black shadow-lg">S</div>
          <div>
            <span className="font-black text-xs tracking-tight block leading-none">SENTINEL</span>
            <span className="text-[8px] font-black text-indigo-500 uppercase tracking-widest mt-0.5 block italic">AI SIGNAL ENGINE</span>
          </div>
        </div>
        <div className="flex items-center space-x-4">
           <button onClick={() => setIsSettingsOpen(true)} className="p-2 bg-slate-50 border border-slate-200 rounded-xl hover:bg-slate-100 transition-colors">
            <Settings size={18} className="text-slate-500" />
          </button>
        </div>
      </header>

      {/* MAIN VIEWPORT */}
      <main className="flex-1 overflow-hidden relative">
        
        {/* TAB 1: RADAR (ENRICHED DESIGN) */}
        <div className={`absolute inset-0 transition-all duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] flex ${activeTab !== 'radar' ? '-translate-x-full opacity-0 scale-95' : 'translate-x-0 opacity-100 scale-100'}`}>
          <div className="w-full flex-shrink-0 overflow-y-auto px-6 py-8 pb-32 custom-scrollbar bg-slate-50">
            <div className="max-w-6xl mx-auto space-y-10">
               
               {/* Market Pulse Header */}
               <div className="bg-slate-900 rounded-[2.5rem] p-8 text-white relative overflow-hidden flex flex-col md:flex-row items-center justify-between gap-6 shadow-2xl">
                  <div className="relative z-10">
                     <div className="flex items-center space-x-2 mb-2">
                        <Gauge size={18} className="text-indigo-400" />
                        <span className="text-[10px] font-black uppercase tracking-[0.3em] opacity-60">SENTINEL PİYASA NABZI</span>
                     </div>
                     <h2 className="text-3xl font-black italic tracking-tighter uppercase">FIRSAT RADARI AKTİF</h2>
                     <p className="text-xs font-bold opacity-40 mt-1 uppercase tracking-widest italic">Binance Futures Canlı Analizi</p>
                  </div>
                  <div className="flex items-center space-x-8 relative z-10">
                     <div className="text-center">
                        <div className="text-3xl font-black text-emerald-400">%{((marketStats.gainers/marketStats.total)*100).toFixed(0)}</div>
                        <div className="text-[9px] font-black uppercase opacity-40">BOĞA GÜCÜ</div>
                     </div>
                     <div className="w-[1px] h-12 bg-white/10" />
                     <div className="text-center">
                        <div className="text-3xl font-black text-indigo-400">{marketStats.total}</div>
                        <div className="text-[9px] font-black uppercase opacity-40">AKTİF VARLIK</div>
                     </div>
                  </div>
                  <Waves className="absolute -bottom-10 -right-10 text-white/5 w-64 h-64 rotate-45" />
               </div>

               {/* Signal Grid */}
               <div className="space-y-6">
                  <div className="flex items-center justify-between px-4">
                     <div className="flex items-center space-x-2">
                        <Flame size={18} className="text-orange-500 animate-pulse" />
                        <span className="text-xs font-black text-slate-600 uppercase tracking-[0.3em]">EN GÜÇLÜ SİNYALLER</span>
                     </div>
                     <span className="text-[10px] font-bold text-slate-400 uppercase italic">Algoritmik Puanlama</span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                     {aiSignals.map((c) => (
                       <div key={c.symbol} onClick={() => handleQuickAnalysis(c.symbol)} className="bg-white border border-slate-200 p-6 rounded-[2.5rem] flex flex-col justify-between group hover:border-indigo-500 shadow-sm hover:shadow-xl transition-all cursor-pointer relative overflow-hidden">
                          <div className="flex justify-between items-start mb-6">
                             <div className="flex items-center space-x-4">
                                <div className="w-12 h-12 bg-slate-900 rounded-2xl flex items-center justify-center text-white font-black text-lg italic tracking-tighter">{c.symbol.replace('USDT','')[0]}</div>
                                <div>
                                   <div className="font-black text-xl text-slate-900 tracking-tight leading-none uppercase">{c.symbol.replace('USDT','')}</div>
                                   <div className="text-[9px] font-bold text-slate-400 uppercase mt-1 italic">${c.lastPrice}</div>
                                </div>
                             </div>
                             <div className={`text-[10px] font-black px-3 py-1 rounded-xl shadow-sm ${c.priceChangePercent >= 0 ? 'bg-emerald-500 text-white' : 'bg-rose-500 text-white'}`}>
                                {c.priceChangePercent >= 0 ? 'LONG' : 'SHORT'}
                             </div>
                          </div>

                          <div className="space-y-4">
                             <div className="flex justify-between items-end">
                                <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">GÜÇ SKORU</span>
                                <span className="text-xl font-black italic text-indigo-600">%{c.vScore?.toFixed(0)}</span>
                             </div>
                             <div className="h-2 w-full bg-slate-50 rounded-full overflow-hidden border border-slate-100">
                                <div className="h-full bg-indigo-500 transition-all duration-1000" style={{ width: `${c.vScore}%` }} />
                             </div>
                          </div>
                          
                          {/* Rich Data Points */}
                          <div className="grid grid-cols-2 gap-2 mt-6 pt-6 border-t border-slate-100">
                             <div className="flex items-center space-x-2">
                                <BarChart size={12} className="text-slate-300" />
                                <span className="text-[9px] font-black text-slate-500 uppercase">HACİM: {(c.volume/1000000).toFixed(1)}M</span>
                             </div>
                             <div className="flex items-center space-x-2">
                                <TrendingUp size={12} className="text-slate-300" />
                                <span className="text-[9px] font-black text-slate-500 uppercase">DĞŞ: %{c.priceChangePercent.toFixed(1)}</span>
                             </div>
                          </div>

                          <div className="absolute top-0 right-0 w-16 h-16 bg-indigo-50/20 rounded-bl-[4rem] flex items-center justify-center group-hover:bg-indigo-600 group-hover:text-white transition-all">
                             <ChevronRight size={18} />
                          </div>
                       </div>
                     ))}
                  </div>
               </div>

               {/* Market Overview List */}
               <div className="bg-white rounded-[3rem] p-8 border border-slate-200">
                  <div className="flex items-center space-x-3 mb-8">
                     <Activity size={20} className="text-indigo-500" />
                     <h3 className="text-lg font-black uppercase tracking-tight italic">Genel Momentum</h3>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-x-8 gap-y-6">
                     {trendingAssets.map((c, i) => (
                       <div key={c.symbol} onClick={() => handleQuickAnalysis(c.symbol)} className="flex items-center justify-between group cursor-pointer border-b border-slate-50 pb-2 hover:border-slate-200 transition-all">
                          <div className="flex items-center space-x-3">
                             <span className="text-[10px] font-black text-slate-300 italic">#{(i+1).toString().padStart(2,'0')}</span>
                             <span className="font-black text-xs text-slate-700 group-hover:text-indigo-600">{c.symbol.replace('USDT','')}</span>
                          </div>
                          <span className={`text-[10px] font-black italic ${c.priceChangePercent >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                             {c.priceChangePercent >= 0 ? '+' : ''}{c.priceChangePercent.toFixed(1)}%
                          </span>
                       </div>
                     ))}
                  </div>
               </div>

            </div>
          </div>
        </div>

        {/* TAB 2: LIST (UNTOUCHED PER USER REQUEST) */}
        <div className={`absolute inset-0 transition-all duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] flex flex-col bg-white ${activeTab !== 'list' ? 'translate-x-full opacity-0' : 'translate-x-0 opacity-100'}`}>
           <div className="flex-1 overflow-y-auto pb-32 custom-scrollbar">
              <div className="px-6 py-8 space-y-6 max-w-5xl mx-auto">
                 <div className="flex items-center justify-between"><div><h1 className="text-3xl font-black text-slate-900 tracking-tighter">Market Özeti</h1><p className="text-slate-400 text-xs font-bold uppercase tracking-widest mt-1">Gerçek zamanlı veriler</p></div><div className="p-3 bg-slate-50 rounded-2xl border border-slate-100"><BarChart3 size={20} className="text-indigo-500" /></div></div>
                 <div className="grid grid-cols-1 md:grid-cols-2 gap-6 relative">
                    <div className="bg-white p-8 rounded-[3rem] shadow-xl shadow-slate-200/40 border border-slate-100 flex items-center justify-between overflow-hidden relative"><div className="relative w-36 h-36 shrink-0"><svg className="w-full h-full -rotate-90" viewBox="0 0 36 36"><circle cx="18" cy="18" r="16" fill="none" className="stroke-slate-50" strokeWidth="4" /><circle cx="18" cy="18" r="16" fill="none" className="stroke-indigo-500" strokeWidth="4" strokeDasharray={`${(marketStats.gainers / marketStats.total) * 100} 100`} strokeLinecap="round" /></svg><div className="absolute inset-0 flex flex-col items-center justify-center"><span className="text-3xl font-black text-slate-900 leading-none">{marketStats.total}</span><span className="text-[9px] font-black text-slate-400 uppercase tracking-widest mt-1">Coin</span></div></div><div className="ml-8 grid grid-cols-1 gap-4 w-full"><div className="p-3 bg-emerald-50 rounded-2xl"><span className="text-[10px] font-black text-emerald-700 uppercase block mb-1">Boğa</span><div className="text-xl font-black text-emerald-900">{marketStats.gainers}</div></div><div className="p-3 bg-rose-50 rounded-2xl"><span className="text-[10px] font-black text-rose-700 uppercase block mb-1">Ayı</span><div className="text-xl font-black text-rose-900">{marketStats.losers}</div></div></div></div>
                    <div className="bg-slate-900 p-8 rounded-[3rem] shadow-2xl text-white relative overflow-hidden flex flex-col justify-between group"><div className="relative z-10"><span className="text-[11px] font-black uppercase tracking-[0.2em] opacity-50">Ortalama Güç Skoru</span><div className="flex items-baseline space-x-2 mt-2"><span className="text-6xl font-black italic">{(marketStats.avgVScore).toFixed(0)}</span><span className="text-sm font-black opacity-40">/ 100</span></div></div><Waves className="absolute -bottom-10 -right-10 text-white/5 w-48 h-48 rotate-12 group-hover:scale-110 transition-transform duration-700" /></div>
                 </div>
              </div>
              <div className="max-w-5xl mx-auto px-6 space-y-4">
                 <div className="bg-white rounded-[2rem] border border-slate-100 overflow-hidden mb-32 shadow-sm"><div className="flex items-center px-8 py-5 bg-slate-50 text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100">
                       <div className="flex-1">VARLIK</div><div className="w-24 text-right">FİYAT</div><div className="w-24 text-right">24S %</div><div className="w-20 text-right">SKOR</div></div>
                    <div className="divide-y divide-slate-50">{filteredAndSortedList.slice(0, 50).map(c => (<div key={c.symbol} onClick={() => handleQuickAnalysis(c.symbol)} className="flex items-center px-8 py-5 hover:bg-slate-50 transition-colors cursor-pointer group"><div className="flex-1 flex items-center space-x-4"><div className="font-black text-sm text-slate-900 tracking-tight">{c.symbol.replace('USDT','')}</div></div><div className="w-24 text-right font-mono font-bold text-xs text-slate-600">${c.lastPrice}</div><div className={`w-24 text-right font-black text-xs italic ${c.priceChangePercent >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>{c.priceChangePercent >= 0 ? '+' : ''}{c.priceChangePercent.toFixed(2)}%</div><div className="w-20 text-right"><span className={`px-2 py-0.5 rounded-lg text-[9px] font-black ${c.vScore! > 70 ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-400'}`}>{(c.vScore || 0).toFixed(0)}</span></div></div>))}</div>
                 </div>
              </div>
           </div>
        </div>

        {/* TAB 3: SIMULATOR (ENHANCED LIVE PNL) */}
        <div className={`absolute inset-0 transition-all duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] flex flex-col bg-[#F8FAFC] ${activeTab !== 'calc' ? 'translate-y-full opacity-0' : 'translate-y-0 opacity-100'}`}>
           <div className="flex-1 overflow-y-auto pb-40 custom-scrollbar">
              <div className="px-6 py-10 space-y-8 max-w-4xl mx-auto">
                 
                 <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-3xl font-black text-slate-900 tracking-tight italic uppercase italic">Kazanç İzleyici</h1>
                        <p className="text-slate-500 text-xs font-bold uppercase tracking-widest mt-1">Cebindeki parayı canlı izle</p>
                    </div>
                    {!activeSimTrade && (
                      <div className="flex flex-col items-end">
                         <label className="text-[9px] font-black text-slate-400 uppercase mb-1">KASA MİKTARI ($)</label>
                         <div className="flex items-center space-x-2 bg-white px-5 py-3 rounded-2xl border-2 border-slate-100 shadow-sm">
                            <span className="text-indigo-600 font-black text-lg">$</span>
                            <input type="number" value={simAmount} onChange={e => setSimAmount(Number(e.target.value))} className="w-20 bg-transparent font-black text-slate-900 text-xl outline-none"/>
                         </div>
                      </div>
                    )}
                 </div>

                 {activeSimTrade ? (
                    /* AKTİF POZİSYON EKRANI */
                    <div className="space-y-6">
                       {(() => {
                          const stats = getActiveSimStats();
                          if (!stats) return null;
                          return (
                            <div className="bg-white rounded-[4rem] p-10 shadow-3xl border border-slate-100 relative overflow-hidden group">
                               <div className="flex justify-between items-start mb-12 relative z-10">
                                  <div className="flex items-center space-x-6">
                                     <div className="w-20 h-20 bg-slate-900 rounded-[2rem] flex items-center justify-center text-white font-black text-3xl italic tracking-tighter shadow-2xl group-hover:scale-105 transition-all">
                                        {activeSimTrade.symbol.replace('USDT','')}
                                     </div>
                                     <div>
                                        <div className="flex items-center space-x-3">
                                           <span className={`px-4 py-1.5 rounded-xl text-[10px] font-black italic uppercase ${activeSimTrade.direction === 'LONG' ? 'bg-emerald-500 text-white' : 'bg-rose-500 text-white'}`}>
                                              {activeSimTrade.direction} 5X KALDIRAÇ
                                           </span>
                                        </div>
                                        <div className="text-4xl font-black text-slate-900 tracking-tighter uppercase mt-2">{activeSimTrade.symbol}</div>
                                     </div>
                                  </div>
                                  <div className="text-right p-4 bg-slate-50 rounded-[2rem] border border-slate-100">
                                     <div className="text-[9px] font-black text-slate-400 uppercase mb-1">GİRİŞ FİYATI</div>
                                     <div className="text-2xl font-mono font-black text-slate-900 italic">${activeSimTrade.entryPrice}</div>
                                  </div>
                               </div>

                               <div className="grid grid-cols-1 md:grid-cols-2 gap-8 relative z-10">
                                  <div className={`p-10 rounded-[3rem] border-4 flex flex-col items-center justify-center space-y-3 transition-all duration-300 ${stats.isProfit ? 'bg-emerald-50 border-emerald-100 shadow-2xl shadow-emerald-500/10' : 'bg-rose-50 border-rose-100 shadow-2xl shadow-rose-500/10'}`}>
                                     <span className={`text-[12px] font-black uppercase tracking-[0.4em] ${stats.isProfit ? 'text-emerald-600' : 'text-rose-600'}`}>NET KAZANÇ ($)</span>
                                     <div className={`text-7xl font-black italic tracking-tighter ${stats.isProfit ? 'text-emerald-700' : 'text-rose-700'}`}>
                                        {stats.isProfit ? '+' : ''}${stats.pnlUsd.toFixed(2)}
                                     </div>
                                     <div className={`text-2xl font-black opacity-60 ${stats.isProfit ? 'text-emerald-600' : 'text-rose-600'}`}>
                                        %{stats.pnlPct.toFixed(2)}
                                     </div>
                                  </div>

                                  <div className="bg-slate-900 p-10 rounded-[3rem] flex flex-col justify-between text-white relative overflow-hidden shadow-2xl">
                                     <div>
                                        <div className="flex justify-between items-center mb-6">
                                           <span className="text-[10px] font-black text-white/40 uppercase tracking-widest">GÜNCEL FİYAT</span>
                                           <RefreshCw size={18} className="text-indigo-400 animate-spin-slow" />
                                        </div>
                                        <div className="text-5xl font-mono font-black text-white tracking-tighter italic">
                                           ${stats.currentPrice}
                                        </div>
                                     </div>
                                     <div className="flex items-center space-x-3 mt-8 pt-8 border-t border-white/10">
                                        <div className="w-8 h-8 bg-indigo-600 rounded-xl flex items-center justify-center">
                                           <Activity size={16} />
                                        </div>
                                        <span className="text-[11px] font-bold text-white/50 italic">Anlık veriler Binance'den geliyor...</span>
                                     </div>
                                     <Waves className="absolute -bottom-10 -right-10 text-white/5 w-48 h-48 rotate-12" />
                                  </div>
                               </div>

                               <button 
                                 onClick={() => setActiveSimTrade(null)}
                                 className="w-full mt-10 py-7 bg-slate-900 text-white rounded-[2.5rem] font-black uppercase text-xs tracking-[0.6em] flex items-center justify-center space-x-4 active:scale-95 transition-all shadow-3xl"
                               >
                                  <StopCircle size={22} className="text-rose-500" />
                                  <span>İşlemi Sonlandır ve Kar Al</span>
                               </button>

                               <Waves className="absolute -top-20 -left-20 text-indigo-50/20 w-80 h-80 opacity-40 rotate-12" />
                            </div>
                          );
                       })()}
                    </div>
                 ) : (
                    /* SEÇİM EKRANI - Sinyallerden Başlat */
                    <div className="space-y-8">
                       <div className="bg-indigo-600 p-8 rounded-[3rem] text-white flex items-center space-x-6 shadow-2xl shadow-indigo-200">
                          <Play size={40} className="shrink-0 fill-white" />
                          <div>
                             <h4 className="text-xl font-black uppercase italic tracking-tight">İşlem Simülatörü</h4>
                             <p className="text-sm font-medium opacity-80 leading-relaxed mt-1">Aşağıdaki potansiyel coinlerden birini seçerek {simAmount}$ ile 5x kaldıraçlı canlı takibi başlatabilirsin.</p>
                          </div>
                       </div>

                       <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          {aiSignals.map((c) => (
                             <div key={c.symbol} className="bg-white p-8 rounded-[3rem] border border-slate-100 shadow-sm flex flex-col items-center justify-between gap-8 hover:shadow-xl transition-all group">
                                <div className="flex flex-col items-center text-center">
                                   <div className="w-16 h-16 bg-slate-50 rounded-[1.5rem] border border-slate-100 flex items-center justify-center font-black text-slate-400 text-xl italic mb-4 group-hover:bg-indigo-600 group-hover:text-white transition-all shadow-inner">{c.symbol.substring(0,2)}</div>
                                   <div>
                                      <div className="font-black text-2xl text-slate-900 tracking-tighter uppercase">{c.symbol}</div>
                                      <div className="text-[11px] font-mono font-bold text-indigo-500 mt-1 italic tracking-widest">${c.lastPrice}</div>
                                   </div>
                                </div>

                                <div className="flex space-x-3 w-full">
                                   <button 
                                     onClick={() => startSimTrade(c.symbol, 'LONG')}
                                     className="flex-1 px-4 py-4 bg-emerald-500 text-white rounded-[1.5rem] font-black text-[11px] uppercase tracking-widest shadow-lg shadow-emerald-500/20 active:scale-95 transition-all"
                                   >
                                      LONG GİR
                                   </button>
                                   <button 
                                     onClick={() => startSimTrade(c.symbol, 'SHORT')}
                                     className="flex-1 px-4 py-4 bg-rose-500 text-white rounded-[1.5rem] font-black text-[11px] uppercase tracking-widest shadow-lg shadow-rose-500/20 active:scale-95 transition-all"
                                   >
                                      SHORT GİR
                                   </button>
                                </div>
                             </div>
                          ))}
                       </div>
                    </div>
                 )}
              </div>
           </div>
        </div>
      </main>

      {/* NAVIGATION BAR */}
      <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[100] w-[300px]">
        <div className="bg-slate-900 border border-slate-800 p-1.5 rounded-[2rem] shadow-2xl flex items-center relative overflow-hidden">
           <div className={`absolute top-1.5 bottom-1.5 w-[calc(33.33%-4px)] bg-indigo-600 rounded-3xl transition-all duration-500 cubic-bezier(0.34, 1.56, 0.64, 1) ${activeTab === 'radar' ? 'left-1.5' : activeTab === 'list' ? 'left-[calc(33.33%+1.33px)]' : 'left-[calc(66.66%+0.66px)]'}`} />
           <button onClick={() => setActiveTab('radar')} className={`flex-1 flex items-center justify-center space-x-2 h-11 rounded-3xl relative z-10 transition-colors ${activeTab === 'radar' ? 'text-white' : 'text-slate-500'}`}><Zap size={14} /><span className="text-[9px] font-black uppercase tracking-widest">RADAR</span></button>
           <button onClick={() => setActiveTab('list')} className={`flex-1 flex items-center justify-center space-x-2 h-11 rounded-3xl relative z-10 transition-colors ${activeTab === 'list' ? 'text-white' : 'text-slate-500'}`}><Activity size={14} /><span className="text-[9px] font-black uppercase tracking-widest">LİSTE</span></button>
           <button onClick={() => setActiveTab('calc')} className={`flex-1 flex items-center justify-center space-x-2 h-11 rounded-3xl relative z-10 transition-colors ${activeTab === 'calc' ? 'text-white' : 'text-slate-500'}`}><Calculator size={14} /><span className="text-[9px] font-black uppercase tracking-widest">SİM</span></button>
        </div>
      </div>

      {/* ANALYSIS MODAL (REMAINS SAME) */}
      {analyzingSymbol && (
        <div className="fixed inset-0 z-[1000] bg-black/40 backdrop-blur-sm flex items-end justify-center">
           <div className="bg-white w-full max-w-2xl rounded-t-[3.5rem] overflow-hidden shadow-3xl animate-in slide-in-from-bottom duration-500 flex flex-col max-h-[95vh]">
              <div className="px-8 py-6 border-b border-slate-100 flex justify-between items-center">
                 <div className="flex items-center space-x-4">
                    <div className="w-12 h-12 bg-slate-900 rounded-2xl flex items-center justify-center text-white font-black text-xl">{analyzingSymbol?.replace('USDT','')[0]}</div>
                    <div>
                        <h3 className="font-black text-2xl uppercase tracking-tighter text-slate-900 leading-none">{analyzingSymbol}</h3>
                        <span className="text-[10px] font-black text-indigo-500 uppercase tracking-widest mt-1.5 inline-block">5X Kaldıraç Sinyali</span>
                    </div>
                 </div>
                 <button onClick={() => setAnalyzingSymbol(null)} className="p-3 bg-slate-50 rounded-2xl text-slate-400 hover:text-slate-900 transition-colors"><X size={24}/></button>
              </div>
              <div className="flex-1 overflow-y-auto p-8 space-y-8 custom-scrollbar">
                {isAnalyzing ? (
                   <div className="py-24 flex flex-col items-center"><Loader2 className="animate-spin text-indigo-500 mb-6" size={32}/><span className="text-[11px] font-black text-slate-400 uppercase tracking-widest">AI ALGORİTMASI ÇALIŞIYOR...</span></div>
                ) : (
                  <>
                    {analysisResult && (
                      <div className={`p-8 rounded-[3rem] shadow-2xl relative overflow-hidden group ${analysisResult.direction === 'LONG' ? 'bg-emerald-600' : 'bg-rose-600'} text-white`}>
                         <div className="flex items-center justify-between mb-6 relative z-10"><div className="flex items-center space-x-3"><Brain size={24} className="text-white" /><span className="text-xs font-black uppercase tracking-widest text-white/80">AI TAVSİYESİ (5X)</span></div><div className="px-4 py-1.5 rounded-full bg-black/20 text-xs font-black border border-white/10 uppercase italic">GÜVEN: %{(analysisResult.score*100).toFixed(0)}</div></div>
                         <div className="relative z-10 mb-8"><h2 className="text-5xl font-black italic mb-2">{analysisResult.direction}</h2><p className="text-sm font-bold opacity-90 leading-relaxed italic">"{analysisResult.rationale_tr}"</p></div>
                         <div className="grid grid-cols-3 gap-4 relative z-10"><div className="bg-black/20 p-4 rounded-2xl border border-white/10"><span className="text-[9px] font-black text-white/60 block mb-1 uppercase tracking-widest">GİRİŞ</span><span className="text-sm font-mono font-black">${analysisResult.entry_price}</span></div><div className="bg-black/20 p-4 rounded-2xl border border-white/10"><span className="text-[9px] font-black text-white/60 block mb-1 uppercase tracking-widest">HEDEF (%5-10)</span><span className="text-sm font-mono font-black text-emerald-300">${analysisResult.take_profit}</span></div><div className="bg-black/20 p-4 rounded-2xl border border-white/10"><span className="text-[9px] font-black text-white/60 block mb-1 uppercase tracking-widest">STOP (STOP)</span><span className="text-sm font-mono font-black text-rose-300">${analysisResult.stop_loss}</span></div></div>
                         <Target size={200} className="absolute -right-16 -bottom-16 opacity-5 rotate-12 group-hover:scale-110 transition-transform duration-700" />
                      </div>
                    )}
                    <div className="space-y-4"><div className="flex items-center space-x-3 text-slate-400 px-1"><Clock size={14} /><span className="text-[11px] font-black uppercase tracking-widest">Fiyat Geçmişi (15dk)</span></div><div className="space-y-2">{history15m.map((k, i) => { const change = ((k.close - k.open) / k.open * 100); return (<div key={i} className="bg-slate-50 p-4 rounded-2xl border border-slate-100 flex justify-between items-center group hover:bg-white transition-all"><span className="text-[11px] font-black text-slate-400 uppercase italic">{i === 0 ? 'ŞİMDİ' : `${i*15}dk Önce`}</span><div className="flex items-center space-x-6"><span className="text-xs font-mono font-bold text-slate-700">${k.close}</span><span className={`min-w-[60px] text-right text-[11px] font-black italic ${change >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>%{change >= 0 ? '+' : ''}{change.toFixed(2)}</span></div></div>); })}</div></div>
                  </>
                )}
              </div>
              <div className="p-8 bg-white border-t border-slate-100 shrink-0"><button onClick={() => setAnalyzingSymbol(null)} className="w-full py-5 bg-slate-900 text-white rounded-3xl font-black uppercase text-xs tracking-[0.4em] active:scale-95 transition-all shadow-xl">ANALİZİ KAPAT</button></div>
           </div>
        </div>
      )}

      {/* SETTINGS DRAWER */}
      {isSettingsOpen && (
        <div className="fixed inset-0 z-[2000] flex items-end bg-black/60 backdrop-blur-md">
           <div className="bg-white w-full rounded-t-[3.5rem] p-8 pb-12 shadow-3xl animate-in slide-in-from-bottom duration-500 max-h-[90vh] overflow-y-auto custom-scrollbar">
              <div className="flex justify-between items-center mb-10"><div><h3 className="font-black text-3xl text-slate-900 tracking-tight leading-none uppercase italic">Ayarlar</h3><span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mt-2">Algoritma Ayarları</span></div><button onClick={()=>setIsSettingsOpen(false)} className="p-3 bg-slate-50 rounded-2xl text-slate-400"><X size={28}/></button></div>
              <div className="space-y-8"><div className="grid grid-cols-1 md:grid-cols-2 gap-6"><div className="bg-slate-50 p-6 rounded-[2.5rem] border border-slate-100 shadow-inner"><label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-4">Sinyal Hassasiyeti (vScore)</label><input type="number" value={userSettings.buyJumpThreshold} onChange={e=>setUserSettings({...userSettings, buyJumpThreshold: Number(e.target.value)})} className="w-full bg-transparent text-3xl font-black outline-none text-slate-900 italic"/></div><div className="bg-slate-50 p-6 rounded-[2.5rem] border border-slate-100 shadow-inner"><label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-4">Min. Hacim (Milyon $)</label><input type="number" value={minVolume} onChange={e=>setMinVolume(Number(e.target.value))} className="w-full bg-transparent text-3xl font-black outline-none text-slate-900 italic"/></div></div><div className="bg-slate-50 p-8 rounded-[3rem] border border-slate-100 space-y-5"><div className="flex items-center space-x-3 text-slate-400 mb-2"><CloudLightning size={20} /><span className="text-[11px] font-black uppercase tracking-widest">Telegram Bildirim Servisi</span></div><input type="password" value={userSettings.telegramBotToken} onChange={e=>setUserSettings({...userSettings, telegramBotToken: e.target.value})} placeholder="Bot Token" className="w-full bg-white border border-slate-200 rounded-2xl p-4 text-xs font-mono outline-none text-slate-700"/><input type="text" value={userSettings.telegramChatId} onChange={e=>setUserSettings({...userSettings, telegramChatId: e.target.value})} placeholder="Chat ID" className="w-full bg-white border border-slate-200 rounded-2xl p-4 text-xs font-mono outline-none text-slate-700"/><p className="text-[10px] text-slate-400 font-bold italic px-2">Sadece vScore &gt; 80 olan yüksek isabetli sinyaller bildirim olarak gönderilir.</p></div><button onClick={()=>setIsSettingsOpen(false)} className="w-full py-6 bg-indigo-600 text-white rounded-[2rem] font-black uppercase text-xs tracking-[0.5em] shadow-xl shadow-indigo-200 active:scale-95 transition-all mt-6">UYGULA VE AKTİFLEŞTİR</button></div>
           </div>
        </div>
      )}
    </div>
  );
};

export default App;
