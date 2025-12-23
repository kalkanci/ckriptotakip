
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
  Play, StopCircle, RefreshCw, Gauge, Flame, BarChart, ChevronUp, ChevronDown
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
  const [filterType, setFilterType] = useState<'all' | 'gainers' | 'losers' | 'potential'>('all');
  const [minVolume, setMinVolume] = useState(0); 

  // Simülatör State
  const [simAmount, setSimAmount] = useState(100);
  const [activeSimTrade, setActiveSimTrade] = useState<SimulatedTrade | null>(null);

  const [analyzingSymbol, setAnalyzingSymbol] = useState<string | null>(null);
  const [analysisResult, setAnalysisResult] = useState<any | null>(null);
  const [history15m, setHistory15m] = useState<Kline[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  
  const tickerBuffer = useRef<Record<string, MarketTicker>>({});
  const volumeHistory = useRef<Record<string, number[]>>({});

  useEffect(() => {
    localStorage.setItem('sentinel_pro_settings', JSON.stringify(userSettings));
  }, [userSettings]);

  // Gelişmiş Skorlama Mantığı
  const calculatePotential = (ticker: MarketTicker): number => {
    const absChange = Math.abs(ticker.priceChangePercent);
    const volumeImpact = Math.log10(ticker.volume + 1) / 4.5;
    
    // Volatilite (High-Low Farkı)
    const range = ((ticker.high - ticker.low) / ticker.low) * 100;
    const volatilityBonus = Math.min(range * 2, 15);
    
    // Hacim Artış Trendi (Son 10 saniyelik basit momentum simülasyonu)
    if (!volumeHistory.current[ticker.symbol]) volumeHistory.current[ticker.symbol] = [];
    volumeHistory.current[ticker.symbol].push(ticker.volume);
    if (volumeHistory.current[ticker.symbol].length > 10) volumeHistory.current[ticker.symbol].shift();
    
    const avgVol = volumeHistory.current[ticker.symbol].reduce((a, b) => a + b, 0) / volumeHistory.current[ticker.symbol].length;
    const volMomentum = ticker.volume > avgVol ? 10 : 0;

    const score = (absChange * 0.4) + (volumeImpact * 30) + volatilityBonus + volMomentum;
    return Math.min(score, 100);
  };

  const handleQuickAnalysis = async (symbol: string) => {
    setIsAnalyzing(true);
    setAnalyzingSymbol(symbol);
    setAnalysisResult(null);
    setHistory15m([]);
    try {
      const history1m = await binanceService.getHistory(symbol, '1m', 30);
      const h15 = await binanceService.getHistory(symbol, '15m', 8);
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
        });
      }
    });
    const loop = setInterval(() => setAllFutures(Object.values(tickerBuffer.current)), 1000);
    return () => { clearInterval(loop); unsub(); binanceService.disconnect(); };
  }, []);

  const aiSignals = useMemo(() => 
    [...allFutures].filter(c => c.vScore && c.vScore > 60).sort((a,b) => (b.vScore || 0) - (a.vScore || 0)).slice(0, 12)
  , [allFutures]);

  const filteredAndSortedList = useMemo(() => {
    let result = [...allFutures];
    if (searchQuery) result = result.filter(c => c.symbol.toLowerCase().includes(searchQuery.toLowerCase()));
    if (filterType === 'gainers') result = result.filter(c => c.priceChangePercent > 2);
    else if (filterType === 'losers') result = result.filter(c => c.priceChangePercent < -2);
    else if (filterType === 'potential') result = result.filter(c => (c.vScore || 0) > 50);
    if (minVolume > 0) result = result.filter(c => (c.volume / 1000000) >= minVolume);
    result.sort((a, b) => (b.vScore || 0) - (a.vScore || 0));
    return result;
  }, [allFutures, searchQuery, filterType, minVolume]);

  // Fix: Added missing startSimTrade function
  const startSimTrade = useCallback((symbol: string, direction: 'LONG' | 'SHORT') => {
    const ticker = tickerBuffer.current[symbol];
    if (!ticker) return;
    setActiveSimTrade({
      symbol,
      entryPrice: ticker.lastPrice,
      amount: simAmount,
      leverage: 5,
      direction,
      startTime: Date.now()
    });
  }, [simAmount]);

  const getActiveSimStats = () => {
    if (!activeSimTrade) return null;
    const currentTicker = tickerBuffer.current[activeSimTrade.symbol];
    if (!currentTicker) return null;
    const currentPrice = currentTicker.lastPrice;
    const entry = activeSimTrade.entryPrice;
    let priceChangePct = ((currentPrice - entry) / entry) * 100;
    if (activeSimTrade.direction === 'SHORT') priceChangePct = -priceChangePct;
    const pnlUsd = (activeSimTrade.amount * priceChangePct * 5) / 100;
    return { currentPrice, pnlPct: priceChangePct * 5, pnlUsd, isProfit: pnlUsd >= 0 };
  };

  return (
    <div className="flex flex-col h-screen bg-[#F8FAFC] text-slate-900 overflow-hidden font-sans select-none">
      {/* HEADER */}
      <header className="h-14 bg-white border-b border-slate-100 flex items-center justify-between px-4 sm:px-6 shrink-0 z-[100] shadow-sm">
        <div className="flex items-center space-x-2">
          <div className="w-8 h-8 bg-slate-900 rounded-lg flex items-center justify-center text-white font-black text-sm">S</div>
          <span className="font-black text-xs tracking-tight uppercase">Sentinel</span>
        </div>
        <button onClick={() => setIsSettingsOpen(true)} className="p-2 bg-slate-50 border border-slate-200 rounded-xl">
          <Settings size={18} className="text-slate-500" />
        </button>
      </header>

      {/* MAIN VIEWPORT */}
      <main className="flex-1 overflow-hidden relative">
        
        {/* RADAR */}
        <div className={`absolute inset-0 transition-all duration-500 ${activeTab !== 'radar' ? '-translate-x-full opacity-0' : 'translate-x-0 opacity-100'}`}>
          <div className="w-full h-full overflow-y-auto px-4 py-6 pb-32 custom-scrollbar">
            <div className="max-w-5xl mx-auto space-y-6">
              <div className="bg-slate-900 rounded-3xl p-6 text-white relative overflow-hidden flex flex-col sm:flex-row items-center justify-between gap-4">
                <div className="text-center sm:text-left">
                  <span className="text-[10px] font-black opacity-50 tracking-widest uppercase">Piyasa Özeti</span>
                  <h2 className="text-xl font-black italic uppercase">Radar Sinyalleri</h2>
                </div>
                <div className="flex space-x-6">
                  <div className="text-center">
                    <div className="text-xl font-black text-emerald-400">%{((allFutures.filter(c => c.priceChangePercent > 0).length/allFutures.length)*100).toFixed(0)}</div>
                    <div className="text-[8px] font-black opacity-40">BOĞA</div>
                  </div>
                  <div className="text-center">
                    <div className="text-xl font-black text-indigo-400">{allFutures.length}</div>
                    <div className="text-[8px] font-black opacity-40">VARLIK</div>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {aiSignals.map((c) => (
                  <div key={c.symbol} onClick={() => handleQuickAnalysis(c.symbol)} className="bg-white border border-slate-100 p-4 rounded-2xl flex flex-col justify-between hover:shadow-lg transition-all cursor-pointer relative overflow-hidden">
                    <div className="flex justify-between items-start mb-4">
                      <span className="font-black text-sm text-slate-900 uppercase">{c.symbol.replace('USDT','')}</span>
                      <span className={`text-[8px] font-black px-1.5 py-0.5 rounded-md ${c.priceChangePercent >= 0 ? 'bg-emerald-500 text-white' : 'bg-rose-500 text-white'}`}>
                        {c.priceChangePercent >= 0 ? 'LONG' : 'SHORT'}
                      </span>
                    </div>
                    <div className="space-y-2">
                      <div className="flex justify-between items-end">
                        <span className="text-[8px] font-black text-slate-400">SKOR</span>
                        <span className="text-sm font-black text-indigo-600">%{c.vScore?.toFixed(0)}</span>
                      </div>
                      <div className="h-1 w-full bg-slate-50 rounded-full overflow-hidden">
                        <div className="h-full bg-indigo-500" style={{ width: `${c.vScore}%` }} />
                      </div>
                      <div className="text-[9px] font-bold text-slate-500 italic text-right">${c.lastPrice}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* LIST */}
        <div className={`absolute inset-0 transition-all duration-500 bg-white ${activeTab !== 'list' ? 'translate-x-full opacity-0' : 'translate-x-0 opacity-100'}`}>
           <div className="flex-1 overflow-y-auto pb-32 custom-scrollbar">
              <div className="px-4 py-6 max-w-4xl mx-auto space-y-4">
                 <div className="flex items-center justify-between mb-4 px-2">
                    <h1 className="text-xl font-black uppercase italic">Piyasa Listesi</h1>
                    <div className="p-2 bg-slate-50 rounded-xl"><Activity size={16} className="text-indigo-500" /></div>
                 </div>
                 <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden shadow-sm">
                    <div className="flex items-center px-4 py-3 bg-slate-50 text-[9px] font-black text-slate-400 border-b">
                       <div className="flex-1">VARLIK</div><div className="w-20 text-right">FİYAT</div><div className="w-16 text-right">SKOR</div>
                    </div>
                    <div className="divide-y divide-slate-50">
                       {filteredAndSortedList.slice(0, 30).map(c => (
                         <div key={c.symbol} onClick={() => handleQuickAnalysis(c.symbol)} className="flex items-center px-4 py-3 hover:bg-slate-50 transition-colors cursor-pointer">
                           <div className="flex-1 font-black text-xs text-slate-800">{c.symbol.replace('USDT','')}</div>
                           <div className="w-20 text-right font-mono font-bold text-[10px] text-slate-500">${c.lastPrice}</div>
                           <div className="w-16 text-right">
                              <span className={`px-1.5 py-0.5 rounded text-[9px] font-black ${c.vScore! > 70 ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-400'}`}>
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

        {/* SIMULATOR */}
        <div className={`absolute inset-0 transition-all duration-500 bg-[#F8FAFC] ${activeTab !== 'calc' ? 'translate-y-full opacity-0' : 'translate-y-0 opacity-100'}`}>
           <div className="flex-1 overflow-y-auto pb-40 custom-scrollbar">
              <div className="px-4 py-8 max-w-2xl mx-auto space-y-6">
                 <div className="flex items-center justify-between">
                    <h1 className="text-xl font-black uppercase italic">Canlı Kar Takibi</h1>
                    {!activeSimTrade && (
                      <div className="flex items-center space-x-2 bg-white px-3 py-1.5 rounded-xl border border-slate-100 shadow-sm">
                        <span className="text-indigo-600 font-black text-xs">$</span>
                        <input type="number" value={simAmount} onChange={e => setSimAmount(Number(e.target.value))} className="w-12 bg-transparent font-black text-slate-900 text-xs outline-none"/>
                      </div>
                    )}
                 </div>

                 {activeSimTrade ? (
                    <div className="bg-white rounded-3xl p-6 shadow-xl border border-slate-100 relative overflow-hidden">
                       {(() => {
                          const stats = getActiveSimStats();
                          if (!stats) return null;
                          return (
                            <div className="space-y-6 relative z-10">
                               <div className="flex justify-between items-center">
                                  <div className="flex items-center space-x-3">
                                     <div className="w-12 h-12 bg-slate-900 rounded-2xl flex items-center justify-center text-white font-black text-sm italic">{activeSimTrade.symbol.substring(0,2)}</div>
                                     <span className="font-black text-lg text-slate-900">{activeSimTrade.symbol}</span>
                                  </div>
                                  <span className={`px-2 py-1 rounded-lg text-[9px] font-black text-white ${activeSimTrade.direction === 'LONG' ? 'bg-emerald-500' : 'bg-rose-500'}`}>{activeSimTrade.direction} 5X</span>
                               </div>

                               <div className={`p-6 rounded-2xl border flex flex-col items-center space-y-1 ${stats.isProfit ? 'bg-emerald-50 border-emerald-100' : 'bg-rose-50 border-rose-100'}`}>
                                  <span className="text-[10px] font-black uppercase opacity-50 tracking-widest">KAZANÇ / KAYIP</span>
                                  <div className={`text-4xl font-black italic ${stats.isProfit ? 'text-emerald-700' : 'text-rose-700'}`}>{stats.isProfit ? '+' : ''}${stats.pnlUsd.toFixed(2)}</div>
                                  <div className="text-xs font-black opacity-40">%{stats.pnlPct.toFixed(2)}</div>
                               </div>

                               <div className="flex justify-between text-[10px] font-bold text-slate-400 bg-slate-50 p-4 rounded-xl border border-slate-100">
                                  <div>GİRİŞ: <span className="text-slate-900 font-mono">${activeSimTrade.entryPrice}</span></div>
                                  <div>GÜNCEL: <span className="text-indigo-600 font-mono">${stats.currentPrice}</span></div>
                               </div>

                               <button onClick={() => setActiveSimTrade(null)} className="w-full py-4 bg-slate-900 text-white rounded-2xl font-black uppercase text-[10px] tracking-widest shadow-lg">İşlemi Kapat</button>
                            </div>
                          );
                       })()}
                    </div>
                 ) : (
                    <div className="grid grid-cols-1 gap-3">
                       {aiSignals.map((c) => (
                          <div key={c.symbol} className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm flex items-center justify-between">
                             <div className="flex items-center space-x-3">
                                <div className="w-10 h-10 bg-slate-50 rounded-xl flex items-center justify-center font-black text-slate-400 text-xs italic">{c.symbol.substring(0,2)}</div>
                                <div>
                                   <div className="font-black text-sm text-slate-900">{c.symbol}</div>
                                   <div className="text-[9px] font-mono font-bold text-slate-400">${c.lastPrice}</div>
                                </div>
                             </div>
                             <div className="flex space-x-1">
                                <button onClick={() => startSimTrade(c.symbol, 'LONG')} className="px-3 py-2 bg-emerald-500 text-white rounded-xl font-black text-[9px] uppercase tracking-tighter">LONG</button>
                                <button onClick={() => startSimTrade(c.symbol, 'SHORT')} className="px-3 py-2 bg-rose-500 text-white rounded-xl font-black text-[9px] uppercase tracking-tighter">SHORT</button>
                             </div>
                          </div>
                       ))}
                    </div>
                 )}
              </div>
           </div>
        </div>
      </main>

      {/* NAV BAR */}
      <nav className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[200] w-[260px] bg-slate-900 p-1 rounded-2xl shadow-2xl flex items-center">
         <button onClick={() => setActiveTab('radar')} className={`flex-1 flex items-center justify-center space-x-1 h-10 rounded-xl text-[9px] font-black uppercase transition-all ${activeTab === 'radar' ? 'bg-indigo-600 text-white' : 'text-slate-500'}`}><Zap size={14}/><span>Radar</span></button>
         <button onClick={() => setActiveTab('list')} className={`flex-1 flex items-center justify-center space-x-1 h-10 rounded-xl text-[9px] font-black uppercase transition-all ${activeTab === 'list' ? 'bg-indigo-600 text-white' : 'text-slate-500'}`}><Activity size={14}/><span>Liste</span></button>
         <button onClick={() => setActiveTab('calc')} className={`flex-1 flex items-center justify-center space-x-1 h-10 rounded-xl text-[9px] font-black uppercase transition-all ${activeTab === 'calc' ? 'bg-indigo-600 text-white' : 'text-slate-500'}`}><Calculator size={14}/><span>Sim</span></button>
      </nav>

      {/* CENTERED ANALYSIS MODAL */}
      {analyzingSymbol && (
        <div className="fixed inset-0 z-[1000] bg-black/40 backdrop-blur-sm flex items-center justify-center px-4">
           <div className="bg-white w-full max-w-sm rounded-3xl overflow-hidden shadow-2xl animate-in fade-in zoom-in duration-300 flex flex-col max-h-[85vh]">
              <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center">
                 <div className="flex items-center space-x-3">
                    <div className="w-8 h-8 bg-slate-900 rounded-lg flex items-center justify-center text-white font-black italic">{analyzingSymbol[0]}</div>
                    <span className="font-black text-sm uppercase tracking-tight">{analyzingSymbol}</span>
                 </div>
                 <button onClick={() => setAnalyzingSymbol(null)} className="p-1.5 bg-slate-50 rounded-lg text-slate-400"><X size={18}/></button>
              </div>

              <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar">
                {isAnalyzing ? (
                   <div className="py-12 flex flex-col items-center space-y-4">
                      <Loader2 className="animate-spin text-indigo-500" size={32}/>
                      <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest italic">Veriler Analiz Ediliyor...</span>
                   </div>
                ) : (
                  <>
                    {analysisResult && (
                      <div className={`p-6 rounded-2xl text-white relative overflow-hidden ${analysisResult.direction === 'LONG' ? 'bg-emerald-600' : 'bg-rose-600'}`}>
                         <div className="flex justify-between items-center mb-4 relative z-10">
                            <span className="text-[9px] font-black uppercase tracking-widest opacity-60">AI Tavsiyesi</span>
                            <span className="text-[10px] font-black bg-black/20 px-2 py-0.5 rounded-lg border border-white/10 uppercase italic">GÜVEN: %{(analysisResult.score*100).toFixed(0)}</span>
                         </div>
                         <div className="relative z-10">
                            <h2 className="text-3xl font-black italic mb-2 tracking-tighter">{analysisResult.direction} 5X</h2>
                            <p className="text-xs font-medium opacity-90 leading-relaxed italic line-clamp-3">"{analysisResult.rationale_tr}"</p>
                         </div>
                         <div className="grid grid-cols-3 gap-2 mt-6 relative z-10">
                            <div className="bg-black/10 p-2 rounded-xl text-center">
                               <span className="text-[8px] opacity-60 block uppercase">Giriş</span>
                               <span className="text-[10px] font-mono font-black">${analysisResult.entry_price}</span>
                            </div>
                            <div className="bg-black/10 p-2 rounded-xl text-center">
                               <span className="text-[8px] opacity-60 block uppercase">Hedef</span>
                               <span className="text-[10px] font-mono font-black text-emerald-300">${analysisResult.take_profit}</span>
                            </div>
                            <div className="bg-black/10 p-2 rounded-xl text-center">
                               <span className="text-[8px] opacity-60 block uppercase">Stop</span>
                               <span className="text-[10px] font-mono font-black text-rose-300">${analysisResult.stop_loss}</span>
                            </div>
                         </div>
                      </div>
                    )}
                    <div className="space-y-3">
                       <span className="text-[10px] font-black text-slate-400 uppercase flex items-center"><Clock size={12} className="mr-2"/> Fiyat Akışı</span>
                       <div className="space-y-2">
                          {history15m.map((k, i) => (
                            <div key={i} className="flex justify-between items-center text-[10px] font-bold p-2 bg-slate-50 rounded-xl">
                               <span className="text-slate-400 uppercase italic">{i === 0 ? 'Anlık' : `${i*15}d`}</span>
                               <span className="text-slate-700 font-mono">${k.close}</span>
                            </div>
                          ))}
                       </div>
                    </div>
                  </>
                )}
              </div>
              <div className="p-6 bg-white border-t border-slate-100">
                 <button onClick={() => setAnalyzingSymbol(null)} className="w-full py-4 bg-slate-900 text-white rounded-2xl font-black uppercase text-[10px] tracking-widest shadow-xl active:scale-95 transition-all">Analizi Kapat</button>
              </div>
           </div>
        </div>
      )}

      {/* SETTINGS DRAWER */}
      {isSettingsOpen && (
        <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/60 backdrop-blur-md px-4">
           <div className="bg-white w-full max-w-sm rounded-[2rem] p-6 shadow-3xl animate-in zoom-in duration-300 overflow-y-auto max-h-[80vh] custom-scrollbar">
              <div className="flex justify-between items-center mb-8">
                 <h3 className="font-black text-xl italic uppercase">Ayarlar</h3>
                 <button onClick={()=>setIsSettingsOpen(false)} className="p-1.5 bg-slate-50 rounded-lg text-slate-400"><X size={20}/></button>
              </div>
              <div className="space-y-6">
                 <div className="bg-slate-50 p-4 rounded-2xl">
                    <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-2">Hacim Filtresi (Milyon $)</label>
                    <input type="number" value={minVolume} onChange={e=>setMinVolume(Number(e.target.value))} className="w-full bg-transparent text-xl font-black outline-none text-slate-900 italic"/>
                 </div>
                 <div className="bg-slate-50 p-4 rounded-2xl space-y-4">
                    <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest block">Telegram Bildirim</span>
                    <input type="password" value={userSettings.telegramBotToken} onChange={e=>setUserSettings({...userSettings, telegramBotToken: e.target.value})} placeholder="Bot Token" className="w-full bg-white border border-slate-200 rounded-xl p-3 text-xs outline-none"/>
                    <input type="text" value={userSettings.telegramChatId} onChange={e=>setUserSettings({...userSettings, telegramChatId: e.target.value})} placeholder="Chat ID" className="w-full bg-white border border-slate-200 rounded-xl p-3 text-xs outline-none"/>
                 </div>
                 <button onClick={()=>setIsSettingsOpen(false)} className="w-full py-4 bg-indigo-600 text-white rounded-2xl font-black uppercase text-[10px] tracking-[0.2em] shadow-lg">Ayarları Kaydet</button>
              </div>
           </div>
        </div>
      )}
    </div>
  );
};

export default App;
