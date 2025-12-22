
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { 
  Settings, Zap, Activity, X, 
  Search, Brain, Loader2,
  Clock, Hash, ArrowUpDown, TrendingDown, TrendingUp,
  Cloud, CloudLightning, ChevronRight,
  BarChart2, ShieldCheck, Volume2,
  RefreshCcw, Filter, AlertTriangle, TrendingUpDown
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
  
  // Detaylı Filtreler
  const [searchQuery, setSearchQuery] = useState('');
  const [sortConfig, setSortConfig] = useState<{ key: keyof MarketTicker, direction: 'asc' | 'desc' }>({ key: 'vScore', direction: 'desc' });
  const [filterType, setFilterType] = useState<'all' | 'gainers' | 'losers' | 'potential'>('all');
  const [minVolume, setMinVolume] = useState(0); 

  const [analyzingSymbol, setAnalyzingSymbol] = useState<string | null>(null);
  const [analysisResult, setAnalysisResult] = useState<LLMAnalysis | null>(null);
  const [history15m, setHistory15m] = useState<Kline[]>([]);
  const [futuresMetrics, setFuturesMetrics] = useState<FuturesMetrics | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  
  const telegramMessageRef = useRef<Record<string, { id: number, time: number, lastScore: number }>>({});
  const tickerBuffer = useRef<Record<string, MarketTicker>>({});

  useEffect(() => {
    localStorage.setItem('sentinel_pro_settings', JSON.stringify(userSettings));
  }, [userSettings]);

  // Akıllı Potansiyel Hesaplama
  const calculatePotential = (ticker: MarketTicker): number => {
    const absChange = Math.abs(ticker.priceChangePercent);
    const volumeImpact = Math.log10(ticker.volume + 1) / 5; 
    const score = (absChange * 0.7) + (volumeImpact * 30);
    return Math.min(score, 100);
  };

  const handleQuickAnalysis = async (symbol: string) => {
    setIsAnalyzing(true);
    setAnalyzingSymbol(symbol);
    setAnalysisResult(null);
    setHistory15m([]);
    setFuturesMetrics(null);
    try {
      const [history1m, h15, futures] = await Promise.all([
        binanceService.getHistory(symbol, '1m', 100),
        binanceService.getHistory(symbol, '15m', 5),
        binanceService.getFuturesMetrics(symbol)
      ]);
      setHistory15m(h15);
      setFuturesMetrics(futures);
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
            symbol: t.s, 
            lastPrice: price, 
            priceChangePercent: change, 
            high: parseFloat(t.h), 
            low: parseFloat(t.l), 
            volume: parseFloat(t.q),
            trend: change > 2 ? 'UP' : (change < -2 ? 'DOWN' : 'NEUTRAL')
          };
          ticker.vScore = calculatePotential(ticker);
          tickerBuffer.current[t.s] = ticker;
        });
      }
    });

    const loop = setInterval(() => {
      setAllFutures(Object.values(tickerBuffer.current) as MarketTicker[]);
    }, 1000);

    return () => { clearInterval(loop); unsub(); binanceService.disconnect(); };
  }, []);

  // Radar için ayrıştırılmış veriler
  const radarGainers = useMemo(() => 
    allFutures.sort((a,b) => b.priceChangePercent - a.priceChangePercent).slice(0, 10)
  , [allFutures]);

  const radarPotentials = useMemo(() => 
    allFutures.sort((a,b) => (b.vScore || 0) - (a.vScore || 0)).slice(0, 10)
  , [allFutures]);

  const filteredList = useMemo(() => {
    let result = [...allFutures];
    if (searchQuery) result = result.filter(c => c.symbol.toLowerCase().includes(searchQuery.toLowerCase()));
    if (filterType === 'gainers') result = result.filter(c => c.priceChangePercent > 2);
    else if (filterType === 'losers') result = result.filter(c => c.priceChangePercent < -2);
    else if (filterType === 'potential') result = result.filter(c => (c.vScore || 0) > 40);
    
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
      {/* HEADER */}
      <header className="h-14 bg-white border-b flex items-center justify-between px-6 shrink-0 z-[100] shadow-sm">
        <div className="flex items-center space-x-2">
          <div className="w-8 h-8 bg-slate-900 rounded-lg flex items-center justify-center text-white font-black shadow-sm">S</div>
          <div>
            <span className="font-black text-xs tracking-tight block leading-none">SENTINEL</span>
            <span className="text-[8px] font-black text-indigo-500 uppercase tracking-widest mt-0.5 block italic">V3 PRE-RELEASE</span>
          </div>
        </div>
        <div className="flex items-center space-x-2">
           <button onClick={() => setIsSettingsOpen(true)} className="p-2 bg-slate-50 border border-slate-100 rounded-xl active:bg-slate-200 transition-colors">
            <Settings size={18} className="text-slate-500" />
          </button>
        </div>
      </header>

      {/* MAIN CONTENT AREA */}
      <main className="flex-1 overflow-hidden relative">
        <div className={`absolute inset-0 transition-transform duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] flex ${activeTab === 'list' ? '-translate-x-full' : 'translate-x-0'}`}>
          
          {/* RADAR VIEW (SPLIT SCREEN) */}
          <div className="w-full flex-shrink-0 overflow-y-auto px-4 py-4 pb-28 custom-scrollbar">
            <div className="max-w-4xl mx-auto flex flex-col md:flex-row gap-4 h-full">
              
              {/* LEFT: TOP GAINERS */}
              <div className="flex-1 bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
                 <div className="p-4 bg-slate-50 border-b flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                       <TrendingUp size={16} className="text-emerald-500" />
                       <span className="text-[11px] font-black text-slate-600 uppercase tracking-widest">ZİRVE KAZANÇLAR</span>
                    </div>
                    <span className="text-[10px] font-bold text-slate-400">24s %</span>
                 </div>
                 <div className="divide-y divide-slate-100">
                    {radarGainers.map((c, i) => (
                      <div key={c.symbol} onClick={() => handleQuickAnalysis(c.symbol)} className="flex items-center justify-between p-3.5 hover:bg-slate-50 transition-colors cursor-pointer group">
                        <div className="flex items-center space-x-3">
                           <span className="text-[10px] font-black text-slate-300 w-4">{i+1}</span>
                           <span className="font-black text-sm text-slate-900">{c.symbol.replace('USDT','')}</span>
                        </div>
                        <div className="text-right">
                           <div className="text-sm font-black text-emerald-500 italic">+{c.priceChangePercent.toFixed(1)}%</div>
                           <div className="text-[9px] font-mono font-bold text-slate-400">${c.lastPrice}</div>
                        </div>
                      </div>
                    ))}
                 </div>
              </div>

              {/* RIGHT: HIGH POTENTIAL (vScore) */}
              <div className="flex-1 bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
                 <div className="p-4 bg-slate-50 border-b flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                       <Zap size={16} className="text-amber-500 fill-amber-500" />
                       <span className="text-[11px] font-black text-slate-600 uppercase tracking-widest">YÜKSEK POTANSİYEL</span>
                    </div>
                    <span className="text-[10px] font-bold text-slate-400">GÜÇ (vS)</span>
                 </div>
                 <div className="divide-y divide-slate-100">
                    {radarPotentials.map((c, i) => (
                      <div key={c.symbol} onClick={() => handleQuickAnalysis(c.symbol)} className="flex items-center justify-between p-3.5 hover:bg-slate-50 transition-colors cursor-pointer group">
                        <div className="flex items-center space-x-3">
                           <span className="text-[10px] font-black text-slate-300 w-4">{i+1}</span>
                           <span className="font-black text-sm text-slate-900">{c.symbol.replace('USDT','')}</span>
                        </div>
                        <div className="text-right flex items-center space-x-3">
                           <div>
                              <div className="text-sm font-black text-indigo-500">{(c.vScore || 0).toFixed(0)}</div>
                              <div className="text-[9px] font-bold text-slate-400 uppercase">${(c.volume/1000000).toFixed(1)}M</div>
                           </div>
                           <div className="w-1 h-8 bg-slate-100 rounded-full overflow-hidden">
                              <div className="w-full bg-indigo-500" style={{height: `${c.vScore}%`, marginTop: `${100- (c.vScore || 0)}%`}} />
                           </div>
                        </div>
                      </div>
                    ))}
                 </div>
              </div>

            </div>
          </div>

          {/* LIST VIEW (DENSE ROW TABLE) */}
          <div className="w-full flex-shrink-0 flex flex-col h-full bg-white">
            {/* Filters Toolbar */}
            <div className="p-4 border-b flex flex-col sm:flex-row gap-3 items-center justify-between shrink-0">
               <div className="relative w-full sm:w-64">
                 <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
                 <input 
                   type="text" 
                   placeholder="Sembol ara..." 
                   value={searchQuery} 
                   onChange={e => setSearchQuery(e.target.value)} 
                   className="w-full bg-slate-50 border border-slate-200 rounded-xl py-2 pl-9 pr-3 text-xs font-bold outline-none focus:ring-2 focus:ring-indigo-500/10"
                 />
               </div>
               <div className="flex gap-1.5 overflow-x-auto no-scrollbar w-full sm:w-auto">
                 {(['all', 'gainers', 'losers', 'potential'] as const).map(type => (
                   <button key={type} onClick={() => setFilterType(type)} className={`px-3 py-1.5 rounded-lg text-[9px] font-black uppercase whitespace-nowrap border transition-all ${filterType === type ? 'bg-slate-900 text-white border-slate-900 shadow-md' : 'bg-white text-slate-400 border-slate-200 hover:border-slate-300'}`}>
                     {type === 'all' ? 'HEPSİ' : type === 'gainers' ? 'YÜKSELEN' : type === 'losers' ? 'DÜŞEN' : 'POTANSİYEL'}
                   </button>
                 ))}
               </div>
            </div>

            {/* List Body */}
            <div className="flex-1 overflow-y-auto pb-28 custom-scrollbar">
              <div className="min-w-full">
                {/* Table Header */}
                <div className="flex items-center px-6 py-3 bg-slate-50 text-[10px] font-black text-slate-400 uppercase tracking-widest border-b sticky top-0 z-10">
                   <div className="flex-1">VARLIK</div>
                   <div className="w-24 text-right">FİYAT</div>
                   <div className="w-20 text-right">DEĞİŞİM</div>
                   <div className="w-24 text-right hidden sm:block">HACİM</div>
                   <div className="w-16 text-right">SKOR</div>
                </div>
                {/* Table Content */}
                {filteredList.length === 0 ? (
                  <div className="py-20 text-center">
                    <Loader2 size={24} className="animate-spin text-slate-300 mx-auto mb-2" />
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Eşleşen veri yok...</span>
                  </div>
                ) : (
                  filteredList.slice(0, 100).map(c => (
                    <div 
                      key={c.symbol} 
                      onClick={() => handleQuickAnalysis(c.symbol)}
                      className="flex items-center px-6 py-4 border-b border-slate-50 hover:bg-indigo-50/30 transition-colors cursor-pointer group"
                    >
                      <div className="flex-1 flex items-center space-x-3">
                         <div className={`w-8 h-8 rounded-lg flex items-center justify-center font-black text-[10px] ${c.priceChangePercent >= 0 ? 'bg-emerald-100 text-emerald-600' : 'bg-rose-100 text-rose-600'}`}>
                            {c.symbol.substring(0,2)}
                         </div>
                         <div className="font-black text-sm text-slate-900">{c.symbol.replace('USDT','')}</div>
                      </div>
                      <div className="w-24 text-right font-mono font-bold text-xs text-slate-600">${c.lastPrice}</div>
                      <div className={`w-20 text-right font-black text-xs italic ${c.priceChangePercent >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                        {c.priceChangePercent >= 0 ? '+' : ''}{c.priceChangePercent.toFixed(2)}%
                      </div>
                      <div className="w-24 text-right hidden sm:block font-bold text-[10px] text-slate-400">${(c.volume/1000000).toFixed(1)}M</div>
                      <div className="w-16 text-right">
                         <span className={`px-2 py-0.5 rounded-md text-[9px] font-black ${c.vScore! > 50 ? 'bg-indigo-100 text-indigo-600' : 'bg-slate-100 text-slate-400'}`}>
                           {(c.vScore || 0).toFixed(0)}
                         </span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* COMPACT NAVIGATION */}
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[100] w-[220px]">
        <div className="bg-slate-900 border border-slate-800 p-1 rounded-2xl shadow-2xl flex items-center relative overflow-hidden">
           <div 
             className={`absolute top-1 bottom-1 w-[calc(50%-4px)] bg-indigo-600 rounded-xl transition-all duration-500 cubic-bezier(0.34, 1.56, 0.64, 1) ${activeTab === 'list' ? 'left-[calc(50%+2px)]' : 'left-1'}`} 
           />
           <button onClick={() => setActiveTab('radar')} className={`flex-1 flex items-center justify-center space-x-2 h-9 rounded-xl relative z-10 transition-colors ${activeTab === 'radar' ? 'text-white' : 'text-slate-500'}`}>
              <Zap size={14} fill={activeTab === 'radar' ? 'currentColor' : 'none'}/>
              <span className="text-[9px] font-black uppercase tracking-widest">RADAR</span>
           </button>
           <button onClick={() => setActiveTab('list')} className={`flex-1 flex items-center justify-center space-x-2 h-9 rounded-xl relative z-10 transition-colors ${activeTab === 'list' ? 'text-white' : 'text-slate-500'}`}>
              <Hash size={14} />
              <span className="text-[9px] font-black uppercase tracking-widest">LİSTE</span>
           </button>
        </div>
      </div>

      {/* ANALYSIS MODAL (BOTTOM SHEET) */}
      {analyzingSymbol && (
        <div className="fixed inset-0 z-[1000] bg-slate-900/40 backdrop-blur-sm flex items-end justify-center p-0">
           <div className="bg-white w-full max-w-xl rounded-t-[2.5rem] overflow-hidden shadow-3xl animate-in slide-in-from-bottom duration-400 flex flex-col max-h-[85vh]">
              <div className="px-6 py-4 border-b flex justify-between items-center shrink-0">
                 <div className="flex items-center space-x-3">
                    <div className="w-10 h-10 bg-slate-900 rounded-2xl flex items-center justify-center text-white font-black text-lg">{analyzingSymbol?.replace('USDT','')[0]}</div>
                    <div>
                       <h3 className="font-black text-lg uppercase tracking-tighter text-slate-900 leading-none">{analyzingSymbol}</h3>
                       <span className="text-[9px] font-black text-indigo-500 uppercase tracking-widest mt-1 inline-block">Yapay Zeka Görüşü</span>
                    </div>
                 </div>
                 <button onClick={() => setAnalyzingSymbol(null)} className="p-2.5 bg-slate-50 rounded-xl text-slate-400 active:scale-90 transition-transform"><X size={18}/></button>
              </div>

              <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar">
                {isAnalyzing ? (
                   <div className="py-16 flex flex-col items-center">
                      <Loader2 className="animate-spin text-indigo-600 mb-4" size={40}/>
                      <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">PIYASA VERILERI ISLENIYOR...</span>
                   </div>
                ) : (
                  <>
                    <div className="grid grid-cols-2 gap-3">
                       <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
                          <span className="text-[9px] font-black text-slate-400 uppercase block mb-1">En Düşük (24s)</span>
                          <span className="text-xs font-mono font-bold text-slate-700">${tickerBuffer.current[analyzingSymbol]?.low}</span>
                       </div>
                       <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
                          <span className="text-[9px] font-black text-slate-400 uppercase block mb-1">En Yüksek (24s)</span>
                          <span className="text-xs font-mono font-bold text-slate-700">${tickerBuffer.current[analyzingSymbol]?.high}</span>
                       </div>
                    </div>

                    <div className="space-y-3">
                       <div className="flex items-center space-x-2 text-slate-400">
                          <Clock size={12} />
                          <span className="text-[10px] font-black uppercase tracking-widest">Fiyat Hareketleri (15dk)</span>
                       </div>
                       <div className="space-y-1.5">
                        {history15m.map((k, i) => {
                          const change = ((k.close - k.open) / k.open * 100);
                          return (
                            <div key={i} className="bg-white p-3 rounded-xl border border-slate-100 flex justify-between items-center">
                              <span className="text-[10px] font-black text-slate-400 uppercase italic">{i === 0 ? 'ŞİMDİ' : `${i*15}dk Önce`}</span>
                              <div className="flex items-center space-x-4">
                                 <span className="text-xs font-mono font-bold text-slate-700">${k.close}</span>
                                 <span className={`min-w-[50px] text-right text-[10px] font-black ${change >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                                   %{change >= 0 ? '+' : ''}{change.toFixed(2)}
                                 </span>
                              </div>
                            </div>
                          );
                        })}
                       </div>
                    </div>

                    {analysisResult && (
                      <div className="bg-slate-900 p-6 rounded-3xl text-white shadow-xl relative overflow-hidden">
                         <div className="flex items-center justify-between mb-4 relative z-10">
                            <div className="flex items-center space-x-2">
                               <Brain size={16} className="text-indigo-400" />
                               <span className="text-[10px] font-black uppercase tracking-widest text-indigo-400">AI Analiz</span>
                            </div>
                            <div className="px-2.5 py-1 rounded bg-indigo-600 text-[10px] font-black">
                              {(analysisResult.score*100).toFixed(0)} PUAN
                            </div>
                         </div>
                         <p className="text-xs leading-relaxed font-medium italic opacity-90 relative z-10">"{analysisResult.rationale_tr}"</p>
                         <Brain size={120} className="absolute -right-8 -bottom-8 opacity-5" />
                      </div>
                    )}
                  </>
                )}
              </div>
              <div className="p-6 bg-white border-t shrink-0">
                 <button onClick={() => setAnalyzingSymbol(null)} className="w-full py-4 bg-slate-900 text-white rounded-2xl font-black uppercase text-[10px] tracking-widest active:scale-95 transition-all">PENCEREYI KAPAT</button>
              </div>
           </div>
        </div>
      )}

      {/* SETTINGS DRAWER */}
      {isSettingsOpen && (
        <div className="fixed inset-0 z-[2000] flex items-end bg-slate-900/40 backdrop-blur-sm">
           <div className="bg-white w-full rounded-t-[3rem] p-8 pb-10 shadow-3xl animate-in slide-in-from-bottom duration-400 max-h-[80vh] overflow-y-auto custom-scrollbar">
              <div className="flex justify-between items-center mb-8">
                 <div>
                    <h3 className="font-black text-xl text-slate-900 tracking-tight">Tercihler</h3>
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mt-1">Sistem ve Filtre Ayarları</span>
                 </div>
                 <button onClick={()=>setIsSettingsOpen(false)} className="p-2.5 bg-slate-50 rounded-xl text-slate-400"><X size={20}/></button>
              </div>

              <div className="space-y-6">
                 <div className="grid grid-cols-2 gap-4">
                    <div className="bg-slate-50 p-5 rounded-2xl border border-slate-100">
                       <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-3">Radar Sinyal Eşiği (%)</label>
                       <input type="number" value={userSettings.buyJumpThreshold} onChange={e=>setUserSettings({...userSettings, buyJumpThreshold: Number(e.target.value)})} className="w-full bg-transparent text-xl font-black outline-none text-slate-900"/>
                    </div>
                    <div className="bg-slate-50 p-5 rounded-2xl border border-slate-100">
                       <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-3">Min. Hacim (Milyon $)</label>
                       <input type="number" value={minVolume} onChange={e=>setMinVolume(Number(e.target.value))} className="w-full bg-transparent text-xl font-black outline-none text-slate-900"/>
                    </div>
                 </div>

                 <div className="bg-slate-50 p-6 rounded-3xl border border-slate-100 space-y-4">
                    <div className="flex items-center space-x-2 text-slate-400 mb-1">
                       <CloudLightning size={16} />
                       <span className="text-[10px] font-black uppercase tracking-widest">Telegram Entegrasyonu</span>
                    </div>
                    <input type="password" value={userSettings.telegramBotToken} onChange={e=>setUserSettings({...userSettings, telegramBotToken: e.target.value})} placeholder="Bot Token" className="w-full bg-white border border-slate-200 rounded-xl p-3.5 text-xs font-mono outline-none"/>
                    <input type="text" value={userSettings.telegramChatId} onChange={e=>setUserSettings({...userSettings, telegramChatId: e.target.value})} placeholder="Chat ID" className="w-full bg-white border border-slate-200 rounded-xl p-3.5 text-xs font-mono outline-none"/>
                 </div>

                 <button onClick={()=>setIsSettingsOpen(false)} className="w-full py-5 bg-indigo-600 text-white rounded-2xl font-black uppercase text-[11px] tracking-widest shadow-xl shadow-indigo-100 active:scale-95 transition-all">GÜNCELLE VE UYGULA</button>
              </div>
           </div>
        </div>
      )}
    </div>
  );
};

export default App;
