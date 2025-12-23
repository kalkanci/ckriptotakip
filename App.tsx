
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { 
  Settings, Zap, Activity, X, 
  Search, Brain, Loader2,
  Clock, Hash, ArrowUpDown, TrendingDown, TrendingUp,
  Cloud, CloudLightning, ChevronRight,
  BarChart2, ShieldCheck, Volume2,
  RefreshCcw, Filter, AlertTriangle, TrendingUpDown,
  PieChart, BarChart3, Globe, Waves, Target, ShieldAlert
} from 'lucide-react';
import { MarketTicker, UserSettings, LLMAnalysis, Kline, FuturesMetrics } from './types';
import { binanceService } from './services/binanceService';
import { llmService } from './services/llmService';

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

  const [activeTab, setActiveTab] = useState<'radar' | 'list'>('radar');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [allFutures, setAllFutures] = useState<MarketTicker[]>([]);
  
  const [searchQuery, setSearchQuery] = useState('');
  const [sortConfig, setSortConfig] = useState<{ key: keyof MarketTicker, direction: 'asc' | 'desc' }>({ key: 'vScore', direction: 'desc' });
  const [filterType, setFilterType] = useState<'all' | 'gainers' | 'losers' | 'potential'>('all');
  const [minVolume, setMinVolume] = useState(0); 

  const [analyzingSymbol, setAnalyzingSymbol] = useState<string | null>(null);
  const [analysisResult, setAnalysisResult] = useState<any | null>(null);
  const [history15m, setHistory15m] = useState<Kline[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  
  const telegramMessageRef = useRef<Record<string, { id: number, time: number, lastScore: number }>>({});
  const tickerBuffer = useRef<Record<string, MarketTicker>>({});

  useEffect(() => {
    localStorage.setItem('sentinel_pro_settings', JSON.stringify(userSettings));
  }, [userSettings]);

  const calculatePotential = (ticker: MarketTicker): number => {
    const absChange = Math.abs(ticker.priceChangePercent);
    const volumeImpact = Math.log10(ticker.volume + 1) / 4.5;
    const score = (absChange * 0.6) + (volumeImpact * 40);
    return Math.min(score, 100);
  };

  const updateTelegram = async (symbol: string, change: number, price: number, score: number) => {
    if (!userSettings.telegramBotToken || !userSettings.telegramChatId || !userSettings.isNotificationEnabled) return;
    const now = Date.now();
    const prev = telegramMessageRef.current[symbol];
    if (score < 80) return; // Sadece çok yüksek potansiyelliler
    if (prev && (now - prev.time < 300000)) return; 

    const trendEmoji = change >= 0 ? '📈' : '📉';
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
            trend: change > 2 ? 'UP' : (change < -2 ? 'DOWN' : 'NEUTRAL')
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
    [...allFutures].sort((a,b) => Math.abs(b.priceChangePercent) - Math.abs(a.priceChangePercent)).slice(0, 10)
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

  return (
    <div className="flex flex-col h-screen bg-[#F1F5F9] text-slate-900 overflow-hidden font-sans select-none">
      <header className="h-14 bg-white border-b border-slate-100 flex items-center justify-between px-6 shrink-0 z-[100] shadow-sm">
        <div className="flex items-center space-x-3">
          <div className="w-8 h-8 bg-slate-900 rounded-lg flex items-center justify-center text-white font-black shadow-lg">S</div>
          <div>
            <span className="font-black text-xs tracking-tight block leading-none">SENTINEL</span>
            <span className="text-[8px] font-black text-indigo-500 uppercase tracking-widest mt-0.5 block italic">AI SIGNAL ENGINE</span>
          </div>
        </div>
        <div className="flex items-center space-x-4">
           <div className="hidden sm:flex items-center bg-emerald-50 text-emerald-600 px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest">
              <Activity size={10} className="mr-1" /> Canlı Veri
           </div>
           <button onClick={() => setIsSettingsOpen(true)} className="p-2 bg-slate-50 border border-slate-200 rounded-xl hover:bg-slate-100 transition-colors">
            <Settings size={18} className="text-slate-500" />
          </button>
        </div>
      </header>

      <main className="flex-1 overflow-hidden relative">
        <div className={`absolute inset-0 transition-all duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] flex ${activeTab === 'list' ? '-translate-x-full opacity-0 scale-95' : 'translate-x-0 opacity-100 scale-100'}`}>
          <div className="w-full flex-shrink-0 overflow-y-auto px-4 py-6 pb-32 custom-scrollbar bg-slate-50">
            <div className="max-w-6xl mx-auto flex flex-col md:flex-row gap-6">
               <div className="flex-1 space-y-4">
                  <div className="flex items-center justify-between px-2">
                     <div className="flex items-center space-x-2">
                        <Zap size={16} className="text-amber-500 fill-amber-500" />
                        <span className="text-[11px] font-black text-slate-600 uppercase tracking-widest">5X AI TAHMİNLERİ</span>
                     </div>
                     <span className="text-[10px] font-bold text-slate-400">Giriş Bölgesi</span>
                  </div>
                  <div className="space-y-3">
                     {aiSignals.length === 0 ? (
                        <div className="py-10 text-center text-[10px] font-black text-slate-400 uppercase tracking-widest bg-white rounded-3xl border border-dashed border-slate-200">Uygun sinyal taranıyor...</div>
                     ) : aiSignals.map((c, i) => (
                       <div key={c.symbol} onClick={() => handleQuickAnalysis(c.symbol)} className="bg-white border border-slate-200 p-5 rounded-[2rem] flex items-center justify-between group hover:border-indigo-500 shadow-sm hover:shadow-xl hover:shadow-indigo-500/5 transition-all cursor-pointer">
                          <div className="flex items-center space-x-4">
                             <div className={`w-10 h-10 rounded-2xl flex items-center justify-center font-black text-xs ${c.priceChangePercent >= 0 ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'}`}>
                                {c.symbol.replace('USDT','')[0]}
                             </div>
                             <div>
                                <span className="font-black text-base uppercase tracking-tight text-slate-900">{c.symbol.replace('USDT','')}</span>
                                <div className="text-[9px] font-black text-indigo-500 uppercase tracking-widest mt-0.5">Potansiyel: %{c.vScore?.toFixed(0)}</div>
                             </div>
                          </div>
                          <div className="text-right">
                             <div className={`text-xs font-black px-2 py-0.5 rounded-lg mb-1 inline-block ${c.priceChangePercent >= 0 ? 'bg-emerald-500 text-white' : 'bg-rose-500 text-white'}`}>
                                {c.priceChangePercent >= 0 ? 'LONG' : 'SHORT'}
                             </div>
                             <div className="text-sm font-black text-slate-900 italic">${c.lastPrice}</div>
                          </div>
                       </div>
                     ))}
                  </div>
               </div>

               <div className="flex-1 space-y-4">
                  <div className="flex items-center justify-between px-2">
                     <div className="flex items-center space-x-2">
                        <TrendingUpDown size={16} className="text-slate-400" />
                        <span className="text-[11px] font-black text-slate-600 uppercase tracking-widest">PİYASA MOMENTUMU</span>
                     </div>
                     <span className="text-[10px] font-bold text-slate-400">Volatilite</span>
                  </div>
                  <div className="space-y-2">
                     {trendingAssets.map((c, i) => (
                       <div key={c.symbol} onClick={() => handleQuickAnalysis(c.symbol)} className="bg-white border border-slate-100 p-4 rounded-2xl flex items-center justify-between group hover:bg-slate-900 hover:text-white transition-all cursor-pointer">
                          <div className="flex items-center space-x-4">
                             <span className="text-[10px] font-black text-slate-300 w-4 italic">{i+1}</span>
                             <span className="font-black text-sm uppercase tracking-tight">{c.symbol.replace('USDT','')}</span>
                          </div>
                          <div className="flex items-center space-x-4 text-right">
                             <div>
                                <div className={`text-sm font-black ${c.priceChangePercent >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                                   {c.priceChangePercent >= 0 ? '+' : ''}{c.priceChangePercent.toFixed(1)}%
                                </div>
                                <div className="text-[9px] font-bold text-slate-400 uppercase">${(c.volume/1000000).toFixed(1)}M</div>
                             </div>
                          </div>
                       </div>
                     ))}
                  </div>
               </div>
            </div>
          </div>
        </div>

        <div className={`absolute inset-0 transition-all duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] flex flex-col bg-white ${activeTab === 'radar' ? 'translate-x-full opacity-0' : 'translate-x-0 opacity-100'}`}>
           <div className="flex-1 overflow-y-auto pb-32 custom-scrollbar">
              <div className="px-6 py-8 space-y-6 max-w-5xl mx-auto">
                 <div className="flex items-center justify-between">
                    <div>
                      <h1 className="text-3xl font-black text-slate-900 tracking-tighter">Market Özeti</h1>
                      <p className="text-slate-400 text-xs font-bold uppercase tracking-widest mt-1">Gerçek zamanlı piyasa verileri</p>
                    </div>
                    <div className="p-3 bg-slate-50 rounded-2xl border border-slate-100">
                      <BarChart3 size={20} className="text-indigo-500" />
                    </div>
                 </div>

                 <div className="grid grid-cols-1 md:grid-cols-2 gap-6 relative">
                    <div className="bg-white p-8 rounded-[3rem] shadow-xl shadow-slate-200/40 border border-slate-100 flex flex-col items-center sm:flex-row sm:items-center justify-between overflow-hidden relative">
                       <div className="relative w-36 h-36 shrink-0">
                          <svg className="w-full h-full -rotate-90" viewBox="0 0 36 36">
                            <circle cx="18" cy="18" r="16" fill="none" className="stroke-slate-50" strokeWidth="4" />
                            <circle cx="18" cy="18" r="16" fill="none" className="stroke-indigo-500" strokeWidth="4" 
                              strokeDasharray={`${(marketStats.gainers / marketStats.total) * 100} 100`} strokeLinecap="round" />
                          </svg>
                          <div className="absolute inset-0 flex flex-col items-center justify-center">
                             <span className="text-3xl font-black text-slate-900 leading-none">{marketStats.total}</span>
                             <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest mt-1">Coin</span>
                          </div>
                       </div>
                       <div className="mt-8 sm:mt-0 sm:ml-8 grid grid-cols-2 gap-4 w-full">
                          <div className="p-3 bg-emerald-50 rounded-2xl">
                             <span className="text-[10px] font-black text-emerald-700 uppercase block mb-1">Boğa</span>
                             <div className="text-xl font-black text-emerald-900">{marketStats.gainers}</div>
                          </div>
                          <div className="p-3 bg-rose-50 rounded-2xl">
                             <span className="text-[10px] font-black text-rose-700 uppercase block mb-1">Ayı</span>
                             <div className="text-xl font-black text-rose-900">{marketStats.losers}</div>
                          </div>
                       </div>
                    </div>

                    <div className="bg-slate-900 p-8 rounded-[3rem] shadow-2xl text-white relative overflow-hidden flex flex-col justify-between group">
                       <div className="relative z-10">
                          <span className="text-[11px] font-black uppercase tracking-[0.2em] opacity-50">Ortalama Güç Skoru</span>
                          <div className="flex items-baseline space-x-2 mt-2">
                             <span className="text-6xl font-black italic">{(marketStats.avgVScore).toFixed(0)}</span>
                             <span className="text-sm font-black opacity-40">/ 100</span>
                          </div>
                       </div>
                       <Waves className="absolute -bottom-10 -right-10 text-white/5 w-48 h-48 rotate-12 group-hover:scale-110 transition-transform duration-700" />
                    </div>
                 </div>
              </div>

              <div className="max-w-5xl mx-auto px-6 space-y-4">
                 <div className="flex flex-col sm:flex-row gap-4 items-center justify-between py-6 border-t border-slate-100">
                    <div className="relative w-full sm:w-80">
                      <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300" size={14} />
                      <input type="text" placeholder="Sembol ara..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} 
                        className="w-full bg-slate-50 border border-slate-200 rounded-2xl py-3 pl-11 pr-4 text-xs font-bold text-slate-700 outline-none focus:ring-4 focus:ring-indigo-500/5 transition-all shadow-sm"/>
                    </div>
                    <div className="flex gap-1.5 overflow-x-auto no-scrollbar w-full sm:w-auto">
                       {(['all', 'gainers', 'losers', 'potential'] as const).map(type => (
                         <button key={type} onClick={() => setFilterType(type)} className={`px-4 py-2.5 rounded-xl text-[9px] font-black uppercase border transition-all ${filterType === type ? 'bg-slate-900 text-white border-slate-900 shadow-lg' : 'bg-white text-slate-400 border-slate-100 hover:bg-slate-50'}`}>
                           {type === 'all' ? 'TÜMÜ' : type === 'gainers' ? 'YÜKSELEN' : type === 'losers' ? 'DÜŞEN' : 'POTANSİYEL'}
                         </button>
                       ))}
                    </div>
                 </div>

                 <div className="bg-white rounded-[2rem] border border-slate-100 overflow-hidden mb-32 shadow-sm">
                    <div className="flex items-center px-8 py-5 bg-slate-50 text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100 sticky top-0 z-10">
                       <div className="flex-1">VARLIK</div>
                       <div className="w-24 text-right">FİYAT</div>
                       <div className="w-24 text-right">24S %</div>
                       <div className="w-20 text-right">SKOR</div>
                    </div>
                    <div className="divide-y divide-slate-50">
                       {filteredAndSortedList.slice(0, 50).map(c => (
                         <div key={c.symbol} onClick={() => handleQuickAnalysis(c.symbol)} className="flex items-center px-8 py-5 hover:bg-slate-50 transition-colors cursor-pointer group">
                           <div className="flex-1 flex items-center space-x-4">
                              <div className="font-black text-sm text-slate-900 tracking-tight">{c.symbol.replace('USDT','')}</div>
                           </div>
                           <div className="w-24 text-right font-mono font-bold text-xs text-slate-600">${c.lastPrice}</div>
                           <div className={`w-24 text-right font-black text-xs italic ${c.priceChangePercent >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                             {c.priceChangePercent >= 0 ? '+' : ''}{c.priceChangePercent.toFixed(2)}%
                           </div>
                           <div className="w-20 text-right">
                              <span className={`px-2 py-0.5 rounded-lg text-[9px] font-black ${c.vScore! > 70 ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-400'}`}>
                                {(c.vScore || 0).toFixed(0)}
                              </span>
                           </div>
                         </div>
                       ))}
                    </div>
                 </div>
              </div>
           </div>
        </div>
      </main>

      <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[100] w-[240px]">
        <div className="bg-slate-900 border border-slate-800 p-1.5 rounded-[2rem] shadow-2xl flex items-center relative overflow-hidden">
           <div className={`absolute top-1.5 bottom-1.5 w-[calc(50%-6px)] bg-indigo-600 rounded-3xl transition-all duration-500 cubic-bezier(0.34, 1.56, 0.64, 1) ${activeTab === 'list' ? 'left-[calc(50%+3px)]' : 'left-1.5'}`} />
           <button onClick={() => setActiveTab('radar')} className={`flex-1 flex items-center justify-center space-x-2 h-11 rounded-3xl relative z-10 transition-colors ${activeTab === 'radar' ? 'text-white' : 'text-slate-500'}`}><Zap size={14} /><span className="text-[10px] font-black uppercase tracking-widest">RADAR</span></button>
           <button onClick={() => setActiveTab('list')} className={`flex-1 flex items-center justify-center space-x-2 h-11 rounded-3xl relative z-10 transition-colors ${activeTab === 'list' ? 'text-white' : 'text-slate-500'}`}><Activity size={14} /><span className="text-[10px] font-black uppercase tracking-widest">ANALİZ</span></button>
        </div>
      </div>

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
                   <div className="py-24 flex flex-col items-center">
                      <div className="w-16 h-16 bg-indigo-50 rounded-3xl flex items-center justify-center mb-6">
                         <Loader2 className="animate-spin text-indigo-500" size={32}/>
                      </div>
                      <span className="text-[11px] font-black text-slate-400 uppercase tracking-widest">AI ALGORİTMASI ÇALIŞIYOR...</span>
                   </div>
                ) : (
                  <>
                    {analysisResult && (
                      <div className={`p-8 rounded-[3rem] shadow-2xl relative overflow-hidden group ${analysisResult.direction === 'LONG' ? 'bg-emerald-600' : 'bg-rose-600'} text-white`}>
                         <div className="flex items-center justify-between mb-6 relative z-10">
                            <div className="flex items-center space-x-3">
                               <Brain size={24} className="text-white" />
                               <span className="text-xs font-black uppercase tracking-widest text-white/80">AI TAVSİYESİ (5X)</span>
                            </div>
                            <div className="px-4 py-1.5 rounded-full bg-black/20 text-xs font-black border border-white/10 uppercase italic">
                               GÜVEN: %{(analysisResult.score*100).toFixed(0)}
                            </div>
                         </div>
                         
                         <div className="relative z-10 mb-8">
                            <h2 className="text-5xl font-black italic mb-2">{analysisResult.direction}</h2>
                            <p className="text-sm font-bold opacity-90 leading-relaxed italic">"{analysisResult.rationale_tr}"</p>
                         </div>

                         <div className="grid grid-cols-3 gap-4 relative z-10">
                            <div className="bg-black/20 p-4 rounded-2xl border border-white/10">
                               <span className="text-[9px] font-black text-white/60 block mb-1 uppercase tracking-widest">GİRİŞ</span>
                               <span className="text-sm font-mono font-black">${analysisResult.entry_price}</span>
                            </div>
                            <div className="bg-black/20 p-4 rounded-2xl border border-white/10">
                               <span className="text-[9px] font-black text-white/60 block mb-1 uppercase tracking-widest">HEDEF (%5-10)</span>
                               <span className="text-sm font-mono font-black text-emerald-300">${analysisResult.take_profit}</span>
                            </div>
                            <div className="bg-black/20 p-4 rounded-2xl border border-white/10">
                               <span className="text-[9px] font-black text-white/60 block mb-1 uppercase tracking-widest">STOP (STOP)</span>
                               <span className="text-sm font-mono font-black text-rose-300">${analysisResult.stop_loss}</span>
                            </div>
                         </div>
                         <Target size={200} className="absolute -right-16 -bottom-16 opacity-5 rotate-12 group-hover:scale-110 transition-transform duration-700" />
                      </div>
                    )}

                    <div className="space-y-4">
                       <div className="flex items-center space-x-3 text-slate-400 px-1">
                          <Clock size={14} />
                          <span className="text-[11px] font-black uppercase tracking-widest">Fiyat Geçmişi (15dk)</span>
                       </div>
                       <div className="space-y-2">
                        {history15m.map((k, i) => {
                          const change = ((k.close - k.open) / k.open * 100);
                          return (
                            <div key={i} className="bg-slate-50 p-4 rounded-2xl border border-slate-100 flex justify-between items-center group hover:bg-white transition-all">
                              <span className="text-[11px] font-black text-slate-400 uppercase italic">{i === 0 ? 'ŞİMDİ' : `${i*15}dk Önce`}</span>
                              <div className="flex items-center space-x-6">
                                 <span className="text-xs font-mono font-bold text-slate-700">${k.close}</span>
                                 <span className={`min-w-[60px] text-right text-[11px] font-black italic ${change >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                                   %{change >= 0 ? '+' : ''}{change.toFixed(2)}
                                 </span>
                              </div>
                            </div>
                          );
                        })}
                       </div>
                    </div>
                  </>
                )}
              </div>
              <div className="p-8 bg-white border-t border-slate-100 shrink-0">
                 <button onClick={() => setAnalyzingSymbol(null)} className="w-full py-5 bg-slate-900 text-white rounded-3xl font-black uppercase text-xs tracking-[0.4em] active:scale-95 transition-all shadow-xl">ANALİZİ KAPAT</button>
              </div>
           </div>
        </div>
      )}

      {isSettingsOpen && (
        <div className="fixed inset-0 z-[2000] flex items-end bg-black/60 backdrop-blur-md">
           <div className="bg-white w-full rounded-t-[3.5rem] p-8 pb-12 shadow-3xl animate-in slide-in-from-bottom duration-500 max-h-[90vh] overflow-y-auto custom-scrollbar">
              <div className="flex justify-between items-center mb-10">
                 <div>
                    <h3 className="font-black text-3xl text-slate-900 tracking-tight leading-none uppercase italic">Ayarlar</h3>
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.3em] block mt-2">Algoritma Ayarları</span>
                 </div>
                 <button onClick={()=>setIsSettingsOpen(false)} className="p-3 bg-slate-50 rounded-2xl text-slate-400"><X size={28}/></button>
              </div>

              <div className="space-y-8">
                 <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="bg-slate-50 p-6 rounded-[2.5rem] border border-slate-100 shadow-inner">
                       <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-4">Sinyal Hassasiyeti (vScore)</label>
                       <input type="number" value={userSettings.buyJumpThreshold} onChange={e=>setUserSettings({...userSettings, buyJumpThreshold: Number(e.target.value)})} className="w-full bg-transparent text-3xl font-black outline-none text-slate-900 italic"/>
                    </div>
                    <div className="bg-slate-50 p-6 rounded-[2.5rem] border border-slate-100 shadow-inner">
                       <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-4">Min. Hacim (Milyon $)</label>
                       <input type="number" value={minVolume} onChange={e=>setMinVolume(Number(e.target.value))} className="w-full bg-transparent text-3xl font-black outline-none text-slate-900 italic"/>
                    </div>
                 </div>

                 <div className="bg-slate-50 p-8 rounded-[3rem] border border-slate-100 space-y-5">
                    <div className="flex items-center space-x-3 text-slate-400 mb-2">
                       <CloudLightning size={20} />
                       <span className="text-[11px] font-black uppercase tracking-widest">Telegram Bildirim Servisi</span>
                    </div>
                    <input type="password" value={userSettings.telegramBotToken} onChange={e=>setUserSettings({...userSettings, telegramBotToken: e.target.value})} placeholder="Bot Token" className="w-full bg-white border border-slate-200 rounded-2xl p-4 text-xs font-mono outline-none text-slate-700"/>
                    <input type="text" value={userSettings.telegramChatId} onChange={e=>setUserSettings({...userSettings, telegramChatId: e.target.value})} placeholder="Chat ID" className="w-full bg-white border border-slate-200 rounded-2xl p-4 text-xs font-mono outline-none text-slate-700"/>
                    <p className="text-[10px] text-slate-400 font-bold italic px-2">Sadece vScore &gt; 80 olan yüksek isabetli sinyaller bildirim olarak gönderilir.</p>
                 </div>

                 <button onClick={()=>setIsSettingsOpen(false)} className="w-full py-6 bg-indigo-600 text-white rounded-[2rem] font-black uppercase text-xs tracking-[0.5em] shadow-xl shadow-indigo-200 active:scale-95 transition-all mt-6">UYGULA VE AKTİFLEŞTİR</button>
              </div>
           </div>
        </div>
      )}
    </div>
  );
};

export default App;
