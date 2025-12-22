
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { 
  Settings, Zap, Activity, X, 
  Search, Brain, Loader2,
  Clock, Hash, ArrowUpDown, TrendingDown, TrendingUp,
  Cloud, CloudLightning, ChevronRight,
  BarChart2, ShieldCheck, Volume2,
  RefreshCcw, Filter, AlertTriangle
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
  const [scanningData, setScanningData] = useState<MarketTicker[]>([]);
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

  const toggleSort = (key: keyof MarketTicker) => {
    setSortConfig(prev => ({
      key,
      direction: prev.key === key && prev.direction === 'desc' ? 'asc' : 'desc'
    }));
  };

  // Akıllı Potansiyel Hesaplama
  const calculatePotential = (ticker: MarketTicker): number => {
    const absChange = Math.abs(ticker.priceChangePercent);
    // Hacim yoğunluğu: Bu örnekte basitleştirilmiş bir skorlama (fiyat değişimi x hacim logaritması)
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

  const updateTelegram = async (symbol: string, change: number, price: number, score: number) => {
    if (!userSettings.telegramBotToken || !userSettings.telegramChatId || !userSettings.isNotificationEnabled) return;
    
    const now = Date.now();
    const prev = telegramMessageRef.current[symbol];
    
    // Skor yeterince yüksek değilse veya çok sık mesaj geliyorsa engelle
    if (score < 40) return;
    if (prev && (now - prev.time < 30000) && Math.abs(score - prev.lastScore) < 5) return;

    const trendEmoji = change >= 0 ? '🚀' : '📉';
    const trendText = change >= 0 ? 'PUMP POTANSİYELİ' : 'DUMP TEHLİKESİ';
    
    const text = `${trendEmoji} *${symbol} AKILLI ALARM*\n\n` +
                 `📊 Sinyal Gücü: %${score.toFixed(1)}\n` +
                 `📈 Değişim: %${change.toFixed(2)}\n` +
                 `💵 Fiyat: $${price}\n` +
                 `⏰ Zaman: ${new Date().toLocaleTimeString('tr-TR')}\n\n` +
                 `⚡️ Sentinel AI Radar`;

    try {
      const method = prev?.id ? 'editMessageText' : 'sendMessage';
      const payload: any = {
        chat_id: userSettings.telegramChatId,
        text: text,
        parse_mode: 'Markdown'
      };
      if (prev?.id) payload.message_id = prev.id;

      const res = await fetch(`https://api.telegram.org/bot${userSettings.telegramBotToken}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (data.ok) {
        telegramMessageRef.current[symbol] = { 
          id: method === 'sendMessage' ? data.result.message_id : prev!.id, 
          time: now,
          lastScore: score
        };
      }
    } catch (e) {}
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

          // Akıllı Telegram Mantığı
          if (ticker.vScore >= userSettings.buyJumpThreshold) {
            updateTelegram(t.s, change, price, ticker.vScore);
          }
        });
      }
    });

    const loop = setInterval(() => {
      const all = Object.values(tickerBuffer.current) as MarketTicker[];
      setAllFutures(all);
      setScanningData(all
        .filter(c => (c.vScore || 0) >= userSettings.buyJumpThreshold)
        .sort((a,b) => (b.vScore || 0) - (a.vScore || 0))
        .slice(0, 20)
      );
    }, 1000);

    return () => { clearInterval(loop); unsub(); binanceService.disconnect(); };
  }, [userSettings.buyJumpThreshold, userSettings.telegramBotToken, userSettings.telegramChatId]);

  const filteredAndSortedList = useMemo(() => {
    let result = [...allFutures];
    if (searchQuery) result = result.filter(c => c.symbol.toLowerCase().includes(searchQuery.toLowerCase()));
    if (filterType === 'gainers') result = result.filter(c => c.priceChangePercent > 3);
    else if (filterType === 'losers') result = result.filter(c => c.priceChangePercent < -3);
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
    <div className="flex flex-col h-screen bg-[#F8FAFC] text-slate-900 overflow-hidden font-sans select-none">
      {/* HEADER */}
      <header className="h-16 bg-white border-b flex items-center justify-between px-6 shrink-0 z-[100] shadow-sm">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center text-white font-black shadow-lg shadow-indigo-100 rotate-3">S</div>
          <div>
            <span className="font-black text-sm tracking-tight block leading-none">SENTINEL</span>
            <span className="text-[9px] font-extrabold text-indigo-500 uppercase tracking-widest mt-1 block">V3 PRO RADAR</span>
          </div>
        </div>
        <div className="flex items-center space-x-2">
           <div className="hidden sm:flex items-center px-3 py-1.5 bg-indigo-50 text-indigo-600 rounded-full border border-indigo-100 mr-2">
              <div className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-pulse mr-2" />
              <span className="text-[10px] font-black uppercase tracking-widest">Canlı Yayın</span>
           </div>
           <button onClick={() => setIsSettingsOpen(true)} className="p-2.5 bg-slate-50 border border-slate-100 rounded-2xl active:bg-slate-200 transition-colors">
            <Settings size={20} className="text-slate-500" />
          </button>
        </div>
      </header>

      {/* MAIN AREA */}
      <main className="flex-1 overflow-hidden relative">
        <div className={`absolute inset-0 transition-transform duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] flex ${activeTab === 'list' ? '-translate-x-full' : 'translate-x-0'}`}>
          
          {/* RADAR VIEW (SMART SIGNALS) */}
          <div className="w-full flex-shrink-0 overflow-y-auto px-4 pt-4 pb-28 custom-scrollbar">
            <div className="max-w-xl mx-auto space-y-4">
              <div className="flex items-center justify-between px-2 mb-1">
                 <div className="flex items-center space-x-2">
                    <Zap size={14} className="text-amber-500 fill-amber-500" />
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest italic">Yüksek Potansiyel</span>
                 </div>
                 <div className="px-3 py-1 bg-indigo-600/10 text-indigo-600 rounded-full text-[9px] font-black">
                    Sinyal Eşiği: %{userSettings.buyJumpThreshold}
                 </div>
              </div>

              {scanningData.length === 0 ? (
                <div className="py-32 flex flex-col items-center justify-center bg-white rounded-[2.5rem] border border-dashed border-slate-200 shadow-sm">
                  <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mb-4">
                    <RefreshCcw className="animate-spin text-slate-300" size={32} />
                  </div>
                  <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">Derin analiz yapılıyor...</span>
                </div>
              ) : (
                scanningData.map((c) => (
                  <div key={c.symbol} onClick={() => handleQuickAnalysis(c.symbol)} className="group bg-white p-5 rounded-[2rem] border border-slate-100 shadow-sm hover:shadow-xl hover:border-indigo-100 active:scale-[0.98] transition-all flex items-center justify-between relative overflow-hidden">
                    <div className="flex items-center space-x-4 relative z-10">
                       <div className={`w-14 h-14 ${c.priceChangePercent >= 0 ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'} rounded-2xl flex items-center justify-center font-black text-xl`}>
                         {c.priceChangePercent >= 0 ? <TrendingUp size={24}/> : <TrendingDown size={24}/>}
                       </div>
                       <div>
                          <div className="font-black text-lg uppercase tracking-tighter text-slate-900 flex items-center">
                            {c.symbol.replace('USDT','')}
                            {c.vScore! > 70 && <Zap size={12} className="ml-1.5 text-amber-500 fill-amber-500 animate-bounce" />}
                          </div>
                          <div className="text-[11px] font-bold text-slate-400 italic font-mono mt-0.5">${c.lastPrice}</div>
                       </div>
                    </div>
                    <div className="text-right relative z-10">
                       <div className={`text-2xl font-black italic ${c.priceChangePercent >= 0 ? 'text-emerald-500' : 'text-rose-500'} tracking-tighter`}>
                         {c.priceChangePercent >= 0 ? '+' : ''}{c.priceChangePercent.toFixed(1)}%
                       </div>
                       <div className="flex items-center justify-end space-x-1.5 mt-1">
                          <span className="text-[9px] font-black text-slate-300 uppercase">GÜÇ:</span>
                          <div className="w-12 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                            <div className="h-full bg-indigo-500" style={{width: `${c.vScore}%`}} />
                          </div>
                       </div>
                    </div>
                    {/* Background Pattern */}
                    <div className="absolute right-0 top-0 h-full w-32 bg-gradient-to-l from-indigo-50/10 to-transparent pointer-events-none" />
                  </div>
                ))
              )}
            </div>
          </div>

          {/* LIST VIEW (DETAILED DASHBOARD) */}
          <div className="w-full flex-shrink-0 overflow-y-auto px-4 pt-4 pb-28 custom-scrollbar bg-[#F1F5F9]">
            <div className="max-w-3xl mx-auto space-y-4">
               {/* FILTERS TOOLBAR */}
               <div className="bg-white p-4 rounded-3xl shadow-sm border border-slate-200/50 space-y-3">
                  <div className="relative">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                    <input type="text" placeholder="Varlık veya sembol ara..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className="w-full bg-slate-50 border border-slate-100 rounded-2xl py-3 pl-11 pr-4 text-xs font-bold outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all"/>
                  </div>
                  <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
                    {(['all', 'gainers', 'losers', 'potential'] as const).map(type => (
                      <button key={type} onClick={() => setFilterType(type)} className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase whitespace-nowrap transition-all border ${filterType === type ? 'bg-slate-900 text-white border-slate-900 shadow-md' : 'bg-white text-slate-400 border-slate-200 hover:border-slate-300'}`}>
                        {type === 'all' ? 'HEPSİ' : type === 'gainers' ? 'YÜKSELEN' : type === 'losers' ? 'DÜŞEN' : 'YÜKSEK POT.'}
                      </button>
                    ))}
                  </div>
               </div>

               {/* DYNAMIC LIST CARDS */}
               <div className="grid grid-cols-1 gap-2.5">
                  {filteredAndSortedList.slice(0, 50).map(c => (
                    <div 
                      key={c.symbol} 
                      onClick={() => handleQuickAnalysis(c.symbol)} 
                      className="bg-white p-4 rounded-2xl border border-slate-200/50 flex items-center justify-between group active:bg-indigo-50/50 transition-all cursor-pointer"
                    >
                      <div className="flex items-center space-x-4 flex-1">
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-black text-xs ${c.priceChangePercent >= 0 ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'}`}>
                          {c.symbol.substring(0,2)}
                        </div>
                        <div className="min-w-[80px]">
                          <span className="font-black text-sm text-slate-900 block leading-tight">{c.symbol.replace('USDT','')}</span>
                          <span className="text-[10px] font-mono font-bold text-slate-400">${c.lastPrice}</span>
                        </div>
                        <div className="hidden sm:block flex-1">
                           <div className="flex items-center space-x-2">
                              <span className="text-[9px] font-black text-slate-300">POTANSİYEL</span>
                              <div className="flex-1 max-w-[100px] h-1 bg-slate-100 rounded-full overflow-hidden">
                                <div className={`h-full ${c.vScore! > 50 ? 'bg-indigo-500' : 'bg-slate-300'}`} style={{width: `${c.vScore}%`}} />
                              </div>
                           </div>
                        </div>
                      </div>

                      <div className="flex items-center space-x-4">
                        <div className="text-right">
                          <div className={`text-sm font-black italic ${c.priceChangePercent >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                            {c.priceChangePercent >= 0 ? '+' : ''}{c.priceChangePercent.toFixed(2)}%
                          </div>
                          <div className="text-[9px] font-bold text-slate-300 uppercase">${(c.volume/1000000).toFixed(1)}M Hacim</div>
                        </div>
                        <ChevronRight size={16} className="text-slate-200 group-hover:text-indigo-400 transition-colors" />
                      </div>
                    </div>
                  ))}
               </div>
            </div>
          </div>
        </div>
      </main>

      {/* MOBILE NAVIGATION BAR */}
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[100] w-[280px]">
        <div className="bg-white/90 backdrop-blur-xl border border-white/20 p-1.5 rounded-full shadow-2xl flex items-center relative overflow-hidden ring-1 ring-black/5">
           <div 
             className={`absolute top-1.5 bottom-1.5 w-[calc(50%-6px)] bg-slate-900 rounded-full transition-all duration-500 cubic-bezier(0.34, 1.56, 0.64, 1) ${activeTab === 'list' ? 'left-[calc(50%+3px)]' : 'left-1.5'}`} 
           />
           <button onClick={() => setActiveTab('radar')} className={`flex-1 flex items-center justify-center space-x-2 h-10 rounded-full relative z-10 transition-colors duration-300 ${activeTab === 'radar' ? 'text-white' : 'text-slate-400'}`}>
              <Zap size={16} fill={activeTab === 'radar' ? 'currentColor' : 'none'}/>
              <span className="text-[10px] font-black uppercase tracking-widest">RADAR</span>
           </button>
           <button onClick={() => setActiveTab('list')} className={`flex-1 flex items-center justify-center space-x-2 h-10 rounded-full relative z-10 transition-colors duration-300 ${activeTab === 'list' ? 'text-white' : 'text-slate-400'}`}>
              <Hash size={16} />
              <span className="text-[10px] font-black uppercase tracking-widest">LİSTE</span>
           </button>
        </div>
      </div>

      {/* ANALYSIS MODAL */}
      {analyzingSymbol && (
        <div className="fixed inset-0 z-[1000] bg-slate-900/60 backdrop-blur-md flex items-end sm:items-center justify-center p-0 sm:p-4">
           <div className="bg-white w-full max-w-md rounded-t-[3rem] sm:rounded-[2.5rem] overflow-hidden shadow-3xl animate-in slide-in-from-bottom duration-500 flex flex-col max-h-[90vh]">
              <div className="px-8 py-6 border-b flex justify-between items-center bg-white sticky top-0 z-10">
                 <div className="flex items-center space-x-3">
                    <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center text-white font-black">{analyzingSymbol?.replace('USDT','')[0]}</div>
                    <div>
                       <h3 className="font-black text-xl uppercase tracking-tighter text-slate-900 leading-none">{analyzingSymbol}</h3>
                       <span className="text-[9px] font-black text-indigo-500 uppercase tracking-widest mt-1 inline-block">Yapay Zeka Asistanı</span>
                    </div>
                 </div>
                 <button onClick={() => setAnalyzingSymbol(null)} className="p-3 bg-slate-50 rounded-2xl text-slate-400 active:scale-90 transition-transform"><X size={20}/></button>
              </div>

              <div className="flex-1 overflow-y-auto p-8 space-y-8 custom-scrollbar">
                {isAnalyzing ? (
                   <div className="py-20 flex flex-col items-center">
                     <div className="relative mb-6">
                        <Loader2 className="animate-spin text-indigo-600" size={56}/>
                        <Brain className="absolute inset-0 m-auto text-indigo-200" size={24} />
                     </div>
                     <span className="text-[10px] font-black text-slate-400 uppercase tracking-[0.3em]">HÜCRELER ANALİZ EDİLİYOR...</span>
                   </div>
                ) : (
                  <>
                    {/* Market Snapshots */}
                    <div className="grid grid-cols-2 gap-4">
                       <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
                          <span className="text-[9px] font-black text-slate-400 uppercase block mb-1">Düşük (24s)</span>
                          <span className="text-sm font-mono font-bold text-slate-700">${tickerBuffer.current[analyzingSymbol]?.low}</span>
                       </div>
                       <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
                          <span className="text-[9px] font-black text-slate-400 uppercase block mb-1">Yüksek (24s)</span>
                          <span className="text-sm font-mono font-bold text-slate-700">${tickerBuffer.current[analyzingSymbol]?.high}</span>
                       </div>
                    </div>

                    {/* Timeline */}
                    <div className="space-y-4">
                       <div className="flex items-center justify-between text-slate-400 px-1">
                          <span className="text-[10px] font-black uppercase tracking-widest flex items-center"><Clock size={12} className="mr-1.5"/> Fiyat Geçmişi</span>
                       </div>
                       <div className="space-y-2">
                        {history15m.map((k, i) => {
                          const change = ((k.close - k.open) / k.open * 100);
                          return (
                            <div key={i} className="bg-slate-50 p-4 rounded-[1.2rem] border border-slate-100 flex justify-between items-center">
                              <span className="text-[11px] font-black text-slate-400 uppercase italic">{i === 0 ? 'ŞİMDİ' : `${i*15}dk Önce`}</span>
                              <div className="flex items-center space-x-4">
                                 <span className="text-xs font-mono font-bold text-slate-700">${k.close}</span>
                                 <div className={`min-w-[60px] text-right text-[10px] font-black px-2 py-1 rounded-lg ${change >= 0 ? 'bg-emerald-100 text-emerald-600' : 'bg-rose-100 text-rose-600'}`}>
                                   %{change >= 0 ? '+' : ''}{change.toFixed(2)}
                                 </div>
                              </div>
                            </div>
                          );
                        })}
                       </div>
                    </div>

                    {analysisResult && (
                      <div className="bg-slate-900 p-8 rounded-[2.5rem] text-white shadow-2xl relative overflow-hidden group">
                         <div className="flex items-center justify-between mb-5 relative z-10">
                            <div className="flex items-center space-x-2">
                               <Brain size={18} className="text-indigo-400" />
                               <span className="text-[10px] font-black uppercase tracking-widest text-indigo-400">Akıllı Yorum</span>
                            </div>
                            <div className={`px-3 py-1 rounded-lg text-[10px] font-black ${analysisResult.score > 0.6 ? 'bg-amber-500' : 'bg-indigo-600'}`}>
                              SKOR: {(analysisResult.score*100).toFixed(0)}
                            </div>
                         </div>
                         <p className="text-sm leading-relaxed font-medium italic opacity-90 relative z-10">"{analysisResult.rationale_tr}"</p>
                         <Brain size={140} className="absolute -right-8 -bottom-8 opacity-5 rotate-12" />
                      </div>
                    )}
                  </>
                )}
              </div>
              <div className="p-8 bg-white border-t">
                 <button onClick={() => setAnalyzingSymbol(null)} className="w-full py-5 bg-slate-900 text-white rounded-2xl font-black uppercase text-xs tracking-[0.3em] active:scale-95 transition-all">ANALİZİ KAPAT</button>
              </div>
           </div>
        </div>
      )}

      {/* SETTINGS DRAWER */}
      {isSettingsOpen && (
        <div className="fixed inset-0 z-[2000] flex items-end bg-slate-900/60 backdrop-blur-md">
           <div className="bg-white w-full rounded-t-[3.5rem] p-8 pb-12 shadow-3xl animate-in slide-in-from-bottom duration-500 max-h-[90vh] overflow-y-auto custom-scrollbar">
              <div className="flex justify-between items-center mb-8 px-2">
                 <div>
                    <h3 className="font-black text-2xl text-slate-900 tracking-tight leading-none">Ayarlar</h3>
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1 inline-block">Sistem Konfigürasyonu</span>
                 </div>
                 <button onClick={()=>setIsSettingsOpen(false)} className="p-3 bg-slate-50 rounded-2xl text-slate-400"><X size={24}/></button>
              </div>

              <div className="space-y-6">
                 <div className="grid grid-cols-2 gap-4">
                    <div className="bg-slate-50 p-5 rounded-3xl border border-slate-100">
                       <ShieldCheck className="text-indigo-600 mb-2" size={20} />
                       <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">Sinyal Eşiği</label>
                       <div className="flex items-center space-x-2">
                          <input type="number" value={userSettings.buyJumpThreshold} onChange={e=>setUserSettings({...userSettings, buyJumpThreshold: Number(e.target.value)})} className="w-full bg-transparent text-xl font-black outline-none text-slate-900"/>
                          <span className="font-black text-slate-400">%</span>
                       </div>
                    </div>
                    <div className="bg-slate-50 p-5 rounded-3xl border border-slate-100">
                       <Volume2 className="text-slate-400 mb-2" size={20} />
                       <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">Min. Hacim</label>
                       <div className="flex items-center space-x-2">
                          <input type="number" value={minVolume} onChange={e=>setMinVolume(Number(e.target.value))} className="w-full bg-transparent text-xl font-black outline-none text-slate-900"/>
                          <span className="font-black text-slate-400">M</span>
                       </div>
                    </div>
                 </div>

                 <div className="space-y-4">
                    <div className="bg-white p-6 rounded-[2rem] border border-slate-100 shadow-sm space-y-4">
                       <div className="flex items-center space-x-3 mb-1 text-slate-400">
                          <CloudLightning size={18} />
                          <span className="text-[11px] font-black uppercase tracking-widest">Telegram Bildirimleri</span>
                       </div>
                       <input type="password" value={userSettings.telegramBotToken} onChange={e=>setUserSettings({...userSettings, telegramBotToken: e.target.value})} placeholder="Bot Token" className="w-full bg-slate-50 border border-slate-100 rounded-2xl p-4 text-xs font-mono outline-none focus:bg-white focus:ring-2 focus:ring-indigo-500/10 transition-all"/>
                       <input type="text" value={userSettings.telegramChatId} onChange={e=>setUserSettings({...userSettings, telegramChatId: e.target.value})} placeholder="Chat ID" className="w-full bg-slate-50 border border-slate-100 rounded-2xl p-4 text-xs font-mono outline-none focus:bg-white focus:ring-2 focus:ring-indigo-500/10 transition-all"/>
                    </div>
                 </div>

                 <button onClick={()=>setIsSettingsOpen(false)} className="w-full py-6 bg-indigo-600 text-white rounded-[2rem] font-black uppercase text-xs tracking-[0.4em] shadow-xl shadow-indigo-100 active:scale-95 transition-all mt-4">KAYDET VE ÇIK</button>
              </div>
           </div>
        </div>
      )}
    </div>
  );
};

export default App;
