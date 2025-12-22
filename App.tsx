
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { 
  Settings, Zap, Activity, X, 
  ListFilter, Search, Brain, Loader2,
  Clock, Hash, ArrowUpDown, TrendingDown,
  Cloud, CloudLightning, ExternalLink, ChevronRight,
  BarChart2, ShieldCheck, BellOff, Volume2,
  PieChart, RefreshCcw
} from 'lucide-react';
import { MarketTicker, UserSettings, LLMAnalysis, Kline, FuturesMetrics } from './types';
import { binanceService } from './services/binanceService';
import { llmService } from './services/llmService';

const App: React.FC = () => {
  const [userSettings, setUserSettings] = useState<UserSettings>(() => {
    const saved = localStorage.getItem('sentinel_pro_settings');
    return saved ? JSON.parse(saved) : { 
      riskPercent: 10, leverage: 5, maxNotional: 1150, dailyLossLimit: 25,
      buyScoreThreshold: 0.5, buyJumpThreshold: 30, ptpTargets: [], dcaSteps: [],
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
  const [sortConfig, setSortConfig] = useState<{ key: keyof MarketTicker, direction: 'asc' | 'desc' }>({ key: 'priceChangePercent', direction: 'desc' });
  const [filterType, setFilterType] = useState<'all' | 'gainers' | 'losers'>('all');
  const [minVolume, setMinVolume] = useState(0); // Milyon cinsinden

  const [analyzingSymbol, setAnalyzingSymbol] = useState<string | null>(null);
  const [analysisResult, setAnalysisResult] = useState<LLMAnalysis | null>(null);
  const [history15m, setHistory15m] = useState<Kline[]>([]);
  const [futuresMetrics, setFuturesMetrics] = useState<FuturesMetrics | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  
  const telegramMessageRef = useRef<Record<string, { id: number, time: number }>>({});
  const tickerBuffer = useRef<Record<string, MarketTicker>>({});

  useEffect(() => {
    localStorage.setItem('sentinel_pro_settings', JSON.stringify(userSettings));
  }, [userSettings]);

  // Fix for error in App.tsx line 233: Added missing toggleSort function
  const toggleSort = (key: keyof MarketTicker) => {
    setSortConfig(prev => ({
      key,
      direction: prev.key === key && prev.direction === 'desc' ? 'asc' : 'desc'
    }));
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

  const updateTelegram = async (symbol: string, change: number, price: number) => {
    if (!userSettings.telegramBotToken || !userSettings.telegramChatId || !userSettings.isNotificationEnabled) return;
    
    const now = Date.now();
    const prev = telegramMessageRef.current[symbol];
    if (prev && (now - prev.time < 10000)) return;

    const text = `🚀 *${symbol} AKTİF TAKİP*\n\n` +
                 `📈 Değişim: %${change.toFixed(2)}\n` +
                 `💵 Fiyat: $${price}\n` +
                 `⏰ Güncelleme: ${new Date().toLocaleTimeString('tr-TR')}\n\n` +
                 `⚡️ Sentinel Radar 24/7`;

    try {
      if (prev?.id) {
        // Mesajı güncelle
        const res = await fetch(`https://api.telegram.org/bot${userSettings.telegramBotToken}/editMessageText`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: userSettings.telegramChatId,
            message_id: prev.id,
            text: text,
            parse_mode: 'Markdown'
          })
        });
        if (res.ok) telegramMessageRef.current[symbol] = { id: prev.id, time: now };
        else delete telegramMessageRef.current[symbol];
      } else {
        // Yeni mesaj
        const res = await fetch(`https://api.telegram.org/bot${userSettings.telegramBotToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: userSettings.telegramChatId, text: text, parse_mode: 'Markdown' })
        });
        const data = await res.json();
        if (data.ok) telegramMessageRef.current[symbol] = { id: data.result.message_id, time: now };
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
          tickerBuffer.current[t.s] = { symbol: t.s, lastPrice: price, priceChangePercent: change, high: parseFloat(t.h), low: parseFloat(t.l), volume: parseFloat(t.q) };
          if (change >= userSettings.buyJumpThreshold) updateTelegram(t.s, change, price);
          else if (telegramMessageRef.current[t.s]) delete telegramMessageRef.current[t.s];
        });
      }
    });
    const loop = setInterval(() => {
      const all = Object.values(tickerBuffer.current) as MarketTicker[];
      setAllFutures(all);
      setScanningData(all.filter(c => c.priceChangePercent >= userSettings.buyJumpThreshold).sort((a,b) => b.priceChangePercent - a.priceChangePercent).slice(0, 30));
    }, 1000);
    return () => { clearInterval(loop); unsub(); binanceService.disconnect(); };
  }, [userSettings.buyJumpThreshold, userSettings.telegramBotToken, userSettings.telegramChatId]);

  const filteredAndSortedList = useMemo(() => {
    let result = [...allFutures];
    if (searchQuery) result = result.filter(c => c.symbol.toLowerCase().includes(searchQuery.toLowerCase()));
    if (filterType === 'gainers') result = result.filter(c => c.priceChangePercent > 0);
    else if (filterType === 'losers') result = result.filter(c => c.priceChangePercent < 0);
    if (minVolume > 0) result = result.filter(c => (c.volume / 1000000) >= minVolume);
    
    result.sort((a, b) => {
      const valA = a[sortConfig.key];
      const valB = b[sortConfig.key];
      return sortConfig.direction === 'desc' ? (valB as number) - (valA as number) : (valA as number) - (valB as number);
    });
    return result;
  }, [allFutures, searchQuery, sortConfig, filterType, minVolume]);

  return (
    <div className="flex flex-col h-screen bg-[#F0F2F5] text-slate-900 overflow-hidden font-sans select-none">
      {/* HEADER */}
      <header className="h-16 bg-white border-b flex items-center justify-between px-6 shrink-0 z-[100] shadow-sm">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center text-white font-black shadow-lg shadow-indigo-100 rotate-3">S</div>
          <div>
            <span className="font-black text-sm tracking-tight block leading-none">SENTINEL</span>
            <span className="text-[9px] font-extrabold text-indigo-500 uppercase tracking-widest mt-1 block">SMART RADAR</span>
          </div>
        </div>
        <div className="flex items-center space-x-2">
           <div className="hidden sm:flex items-center px-3 py-1.5 bg-emerald-50 text-emerald-600 rounded-full border border-emerald-100 mr-2">
              <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse mr-2" />
              <span className="text-[10px] font-black uppercase tracking-widest">Canlı Veri</span>
           </div>
           <button onClick={() => setIsSettingsOpen(true)} className="p-2.5 bg-slate-50 border border-slate-100 rounded-2xl active:bg-slate-200 transition-colors">
            <Settings size={20} className="text-slate-500" />
          </button>
        </div>
      </header>

      {/* TABS CONTAINER WITH SLIDE ANIMATION */}
      <main className="flex-1 overflow-hidden relative">
        <div className={`absolute inset-0 transition-transform duration-500 ease-out flex ${activeTab === 'list' ? '-translate-x-full' : 'translate-x-0'}`}>
          
          {/* RADAR VIEW */}
          <div className="w-full flex-shrink-0 overflow-y-auto px-4 pt-4 pb-28 custom-scrollbar">
            <div className="max-w-xl mx-auto space-y-3">
              <div className="flex items-center justify-between px-1 mb-2">
                 <div className="flex items-center space-x-2">
                    <Zap size={14} className="text-amber-500 fill-amber-500" />
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest italic">Sıcak Sinyaller</span>
                 </div>
                 <span className="text-[10px] font-black text-indigo-500">%{userSettings.buyJumpThreshold}+ Eşik</span>
              </div>
              {scanningData.length === 0 ? (
                <div className="py-32 flex flex-col items-center justify-center bg-white rounded-[2.5rem] border border-dashed border-slate-200 shadow-inner">
                  <RefreshCcw className="animate-spin text-slate-300 mb-4" size={48} />
                  <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">Piyasa taranıyor...</span>
                </div>
              ) : (
                scanningData.map((c) => (
                  <div key={c.symbol} onClick={() => handleQuickAnalysis(c.symbol)} className="bg-white p-6 rounded-[2rem] border border-slate-100 shadow-sm active:scale-[0.97] transition-all flex items-center justify-between group overflow-hidden relative">
                    <div className="flex items-center space-x-4 relative z-10">
                       <div className="w-14 h-14 bg-indigo-50 rounded-[1.2rem] flex items-center justify-center text-indigo-600 font-black text-lg">{c.symbol.replace('USDT','')[0]}</div>
                       <div>
                          <div className="font-black text-lg uppercase tracking-tighter text-slate-900">{c.symbol.replace('USDT','')}</div>
                          <div className="text-[11px] font-bold text-slate-400 italic font-mono mt-0.5">${c.lastPrice}</div>
                       </div>
                    </div>
                    <div className="text-right relative z-10">
                       <div className="text-3xl font-black italic text-indigo-600 tracking-tighter">%{c.priceChangePercent.toFixed(0)}</div>
                       <div className="text-[9px] font-bold text-slate-300 uppercase tracking-widest mt-1">GÖRÜNTÜLE</div>
                    </div>
                    <div className="absolute right-0 top-0 h-full w-24 bg-gradient-to-l from-indigo-50/20 to-transparent pointer-events-none" />
                  </div>
                ))
              )}
            </div>
          </div>

          {/* LIST VIEW */}
          <div className="w-full flex-shrink-0 overflow-y-auto px-4 pt-4 pb-28 custom-scrollbar bg-white">
            <div className="max-w-3xl mx-auto space-y-4">
               {/* FILTERS */}
               <div className="bg-slate-50/80 p-5 rounded-[2rem] border border-slate-100 space-y-4">
                  <div className="relative">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                    <input type="text" placeholder="Sembol ara..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className="w-full bg-white border border-slate-200 rounded-2xl py-3.5 pl-11 pr-4 text-xs font-bold outline-none focus:ring-2 focus:ring-indigo-500/10 shadow-sm"/>
                  </div>
                  <div className="flex gap-2 overflow-x-auto no-scrollbar">
                    {(['all', 'gainers', 'losers'] as const).map(type => (
                      <button key={type} onClick={() => setFilterType(type)} className={`px-5 py-2.5 rounded-xl text-[10px] font-black uppercase whitespace-nowrap transition-all border ${filterType === type ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-400 border-slate-200'}`}>
                        {type === 'all' ? 'Hepsi' : type === 'gainers' ? 'Yükselen' : 'Düşen'}
                      </button>
                    ))}
                    <div className="w-[1px] h-8 bg-slate-200 mx-1 flex-shrink-0" />
                    <button onClick={() => toggleSort('volume')} className="px-5 py-2.5 rounded-xl text-[10px] font-black uppercase bg-white text-slate-400 border border-slate-200 flex items-center space-x-1 whitespace-nowrap">
                       <BarChart2 size={12}/> <span>Hacim</span>
                    </button>
                  </div>
               </div>

               {/* DETAILED CARDS */}
               <div className="space-y-2">
                  {filteredAndSortedList.slice(0, 50).map(c => (
                    <div key={c.symbol} onClick={() => handleQuickAnalysis(c.symbol)} className="bg-white px-5 py-4 rounded-2xl border border-slate-100 flex items-center justify-between active:bg-slate-50 transition-colors hover:shadow-md">
                      <div className="flex-1 grid grid-cols-2 sm:grid-cols-4 gap-4 items-center">
                        <div>
                          <span className="font-black text-sm text-slate-900 tracking-tight block">{c.symbol.replace('USDT','')}</span>
                          <span className="text-[10px] font-mono font-bold text-slate-400">${c.lastPrice}</span>
                        </div>
                        <div className="text-left sm:text-center">
                          <span className={`text-[13px] font-black italic ${c.priceChangePercent >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                            {c.priceChangePercent >= 0 ? '+' : ''}{c.priceChangePercent.toFixed(2)}%
                          </span>
                        </div>
                        <div className="hidden sm:block text-center">
                          <span className="text-[10px] font-black text-slate-300 uppercase block">24S HACİM</span>
                          <span className="text-[11px] font-bold text-slate-500">${(c.volume / 1000000).toFixed(1)}M</span>
                        </div>
                        <div className="hidden sm:block text-right">
                          <span className="text-[10px] font-black text-slate-300 uppercase block">H/L ARALIĞI</span>
                          <span className="text-[10px] font-mono text-slate-500">${c.low} / ${c.high}</span>
                        </div>
                      </div>
                      <ChevronRight size={16} className="text-slate-200 ml-4 shrink-0" />
                    </div>
                  ))}
               </div>
            </div>
          </div>

        </div>
      </main>

      {/* COMPACT DETAIL MODAL */}
      {(analyzingSymbol || isAnalyzing) && (
        <div className="fixed inset-0 z-[1000] bg-slate-900/40 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
           <div className="bg-white w-full max-w-md rounded-t-[3rem] sm:rounded-[2.5rem] overflow-hidden shadow-2xl animate-in slide-in-from-bottom duration-300 flex flex-col max-h-[85vh]">
              <div className="px-8 py-6 border-b flex justify-between items-center bg-white sticky top-0 z-10">
                 <div className="flex items-center space-x-3">
                    <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center text-white font-black">{analyzingSymbol?.replace('USDT','')[0]}</div>
                    <div>
                       <h3 className="font-black text-xl uppercase tracking-tighter text-slate-900 leading-none">{analyzingSymbol}</h3>
                       <span className="text-[9px] font-black text-indigo-500 uppercase tracking-widest mt-1 inline-block">Akıllı Asistan</span>
                    </div>
                 </div>
                 <button onClick={() => setAnalyzingSymbol(null)} className="p-3 bg-slate-50 rounded-2xl text-slate-400 active:scale-90 transition-transform"><X size={20}/></button>
              </div>

              <div className="flex-1 overflow-y-auto p-8 space-y-8 custom-scrollbar">
                {isAnalyzing ? (
                   <div className="py-20 flex flex-col items-center"><Loader2 className="animate-spin text-indigo-600 mb-6" size={48}/><span className="text-[10px] font-black text-slate-400 uppercase tracking-[0.3em]">HÜCRELER İŞLENİYOR...</span></div>
                ) : (
                  <>
                    <div className="space-y-4">
                       <div className="flex items-center justify-between text-slate-400 px-1">
                          <span className="text-[10px] font-black uppercase tracking-widest flex items-center"><Clock size={12} className="mr-1.5"/> Fiyat Akışı (15dk)</span>
                          <span className="text-[9px] font-black uppercase bg-slate-100 px-2 py-0.5 rounded text-slate-500">Geçmiş</span>
                       </div>
                       <div className="space-y-2">
                        {history15m.map((k, i) => {
                          const change = ((k.close - k.open) / k.open * 100);
                          return (
                            <div key={i} className="bg-slate-50 p-4 rounded-[1.2rem] border border-slate-100 flex justify-between items-center hover:bg-slate-100 transition-colors">
                              <span className="text-[11px] font-black text-slate-400 uppercase italic">{i === 0 ? 'ŞİMDİ' : `${i*15}dk`}</span>
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
                               <span className="text-[10px] font-black uppercase tracking-widest text-indigo-400">Yapay Zeka Görüşü</span>
                            </div>
                            <div className="bg-indigo-600 px-3 py-1 rounded-lg text-[10px] font-black">PUAN: {(analysisResult.score*100).toFixed(0)}</div>
                         </div>
                         <p className="text-sm leading-relaxed font-medium italic opacity-90 relative z-10">"{analysisResult.rationale_tr}"</p>
                         <Brain size={140} className="absolute -right-8 -bottom-8 opacity-5 rotate-12 transition-transform group-hover:scale-110 duration-1000" />
                      </div>
                    )}
                  </>
                )}
              </div>
              <div className="p-8 bg-white border-t shrink-0">
                 <button onClick={() => setAnalyzingSymbol(null)} className="w-full py-5 bg-indigo-600 text-white rounded-2xl font-black uppercase text-xs tracking-[0.3em] shadow-xl shadow-indigo-100 active:scale-95 transition-all">PENCEREYİ KAPAT</button>
              </div>
           </div>
        </div>
      )}

      {/* SLIDING BOTTOM NAV */}
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[100] w-[300px]">
        <div className="bg-white/95 backdrop-blur-xl border border-slate-100 p-1.5 rounded-full shadow-2xl flex items-center relative overflow-hidden ring-1 ring-black/5">
           {/* Active Indicator Slider */}
           <div 
             className={`absolute top-1.5 bottom-1.5 w-[calc(50%-6px)] bg-indigo-600 rounded-full transition-all duration-500 ease-in-out ${activeTab === 'list' ? 'left-[calc(50%+3px)]' : 'left-1.5'}`} 
           />
           
           <button onClick={() => setActiveTab('radar')} className={`flex-1 flex items-center justify-center space-x-2 h-11 rounded-full relative z-10 transition-colors duration-300 ${activeTab === 'radar' ? 'text-white' : 'text-slate-400 hover:text-slate-600'}`}>
              <Zap size={18} className={activeTab === 'radar' ? 'fill-white/20' : ''}/>
              <span className="text-[10px] font-black uppercase tracking-widest">RADAR</span>
           </button>
           <button onClick={() => setActiveTab('list')} className={`flex-1 flex items-center justify-center space-x-2 h-11 rounded-full relative z-10 transition-colors duration-300 ${activeTab === 'list' ? 'text-white' : 'text-slate-400 hover:text-slate-600'}`}>
              <Hash size={18} />
              <span className="text-[10px] font-black uppercase tracking-widest">LİSTE</span>
           </button>
        </div>
      </div>

      {/* EXPANDED SETTINGS */}
      {isSettingsOpen && (
        <div className="fixed inset-0 z-[2000] flex items-end bg-slate-900/60 backdrop-blur-md">
           <div className="bg-white w-full rounded-t-[3.5rem] p-8 pb-12 shadow-3xl animate-in slide-in-from-bottom duration-500 max-h-[92vh] overflow-y-auto custom-scrollbar">
              <div className="flex justify-between items-center mb-10 px-2">
                 <div>
                    <h3 className="font-black text-2xl text-slate-900 tracking-tight leading-none">Kontrol Paneli</h3>
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1 inline-block">Sistem Yapılandırması</span>
                 </div>
                 <button onClick={()=>setIsSettingsOpen(false)} className="p-3 bg-slate-50 rounded-2xl text-slate-400 hover:text-red-500 transition-colors"><X size={24}/></button>
              </div>

              <div className="space-y-6">
                 {/* QUICK SETTINGS GRID */}
                 <div className="grid grid-cols-2 gap-4">
                    <div className="bg-indigo-50/50 p-5 rounded-3xl border border-indigo-100">
                       <ShieldCheck className="text-indigo-600 mb-2" size={20} />
                       <label className="text-[10px] font-black text-indigo-400 uppercase tracking-widest block mb-2">Artış Eşiği</label>
                       <div className="flex items-center space-x-2">
                          <input type="number" value={userSettings.buyJumpThreshold} onChange={e=>setUserSettings({...userSettings, buyJumpThreshold: Number(e.target.value)})} className="w-full bg-transparent text-xl font-black outline-none text-indigo-700"/>
                          <span className="font-black text-indigo-400">%</span>
                       </div>
                    </div>
                    <div className="bg-slate-50 p-5 rounded-3xl border border-slate-100">
                       <Volume2 className="text-slate-400 mb-2" size={20} />
                       <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">Min. Hacim</label>
                       <div className="flex items-center space-x-2">
                          <input type="number" value={minVolume} onChange={e=>setMinVolume(Number(e.target.value))} className="w-full bg-transparent text-xl font-black outline-none text-slate-700"/>
                          <span className="font-black text-slate-400">M</span>
                       </div>
                    </div>
                 </div>

                 <div className="space-y-4">
                    <div className="bg-white p-6 rounded-[2rem] border border-slate-100 shadow-sm space-y-4">
                       <div className="flex items-center space-x-3 mb-2 text-slate-400">
                          <CloudLightning size={18} />
                          <span className="text-[11px] font-black uppercase tracking-widest">Bildirim Kanalları</span>
                       </div>
                       <input type="password" value={userSettings.telegramBotToken} onChange={e=>setUserSettings({...userSettings, telegramBotToken: e.target.value})} placeholder="Telegram Bot Token" className="w-full bg-slate-50 border border-slate-100 rounded-2xl p-4 text-xs font-mono outline-none focus:bg-white focus:border-indigo-400 transition-all"/>
                       <input type="text" value={userSettings.telegramChatId} onChange={e=>setUserSettings({...userSettings, telegramChatId: e.target.value})} placeholder="Telegram Chat ID" className="w-full bg-slate-50 border border-slate-100 rounded-2xl p-4 text-xs font-mono outline-none focus:bg-white focus:border-indigo-400 transition-all"/>
                    </div>

                    <div className="bg-slate-900 p-8 rounded-[2.5rem] text-white flex items-center justify-between group overflow-hidden relative">
                       <div className="relative z-10">
                          <span className="text-[10px] font-black text-indigo-400 uppercase tracking-widest block mb-1">Bulut Sunucu Durumu</span>
                          <p className="text-xs font-medium opacity-70">Arka plan tarama dosyası <b>worker.js</b> aktif değil.</p>
                       </div>
                       <Cloud size={32} className="text-indigo-500 opacity-20 relative z-10" />
                       <div className="absolute inset-0 bg-gradient-to-r from-indigo-600/10 to-transparent pointer-events-none" />
                    </div>
                 </div>

                 <button onClick={()=>setIsSettingsOpen(false)} className="w-full py-6 bg-indigo-600 text-white rounded-[1.8rem] font-black uppercase text-xs tracking-[0.4em] shadow-2xl shadow-indigo-200 active:scale-95 transition-all mt-4">TÜMÜNÜ GÜNCELLE</button>
              </div>
           </div>
        </div>
      )}
    </div>
  );
};

export default App;
