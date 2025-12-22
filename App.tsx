
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { 
  Settings, Zap, Activity, X, 
  Terminal, ListFilter, Cpu, Bell, 
  ArrowUpRight, ArrowDownRight, Info, Gauge, 
  Search, Brain, ShieldAlert, Target, Loader2,
  BarChart3, Layers, BookOpen, MessageSquare,
  History, Smartphone, BellRing, Layout, Globe,
  BarChart, TrendingUp, Newspaper, HelpCircle,
  Clock, Hash, ArrowUpDown, Filter, TrendingDown,
  Cloud, CloudLightning, ExternalLink, ChevronRight
} from 'lucide-react';
import { OrderLog, MarketTicker, UserSettings, LLMAnalysis, Kline, FuturesMetrics } from './types';
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
  
  const [searchQuery, setSearchQuery] = useState('');
  const [sortConfig, setSortConfig] = useState<{ key: keyof MarketTicker, direction: 'asc' | 'desc' }>({ key: 'priceChangePercent', direction: 'desc' });
  const [filterType, setFilterType] = useState<'all' | 'gainers' | 'losers'>('all');

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
                 `⚡️ Sentinel Akıllı Radar (10sn Güncelleme)`;

    try {
      if (prev?.id) {
        // Mesajı güncelle (öncekini silmiş gibi davranır, sohbeti kirletmez)
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
        // Yeni mesaj gönder
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
      setScanningData(all.filter(c => c.priceChangePercent >= 30).sort((a,b) => b.priceChangePercent - a.priceChangePercent).slice(0, 50));
    }, 1000);
    return () => { clearInterval(loop); unsub(); binanceService.disconnect(); };
  }, [userSettings.buyJumpThreshold, userSettings.telegramBotToken, userSettings.telegramChatId]);

  const filteredAndSortedList = useMemo(() => {
    let result = [...allFutures];
    if (searchQuery) result = result.filter(c => c.symbol.toLowerCase().includes(searchQuery.toLowerCase()));
    if (filterType === 'gainers') result = result.filter(c => c.priceChangePercent > 0);
    else if (filterType === 'losers') result = result.filter(c => c.priceChangePercent < 0);
    
    result.sort((a, b) => {
      const valA = a[sortConfig.key];
      const valB = b[sortConfig.key];
      return sortConfig.direction === 'desc' ? (valB as number) - (valA as number) : (valA as number) - (valB as number);
    });
    return result;
  }, [allFutures, searchQuery, sortConfig, filterType]);

  return (
    <div className="flex flex-col h-screen bg-[#F8FAFC] text-slate-900 overflow-hidden font-sans">
      {/* MOBILE HEADER */}
      <header className="h-14 bg-white border-b flex items-center justify-between px-5 shrink-0 z-50">
        <div className="flex items-center space-x-2">
          <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center text-white font-black shadow-lg">S</div>
          <span className="font-bold text-sm tracking-tight">SENTINEL RADAR</span>
        </div>
        <button onClick={() => setIsSettingsOpen(true)} className="p-2 bg-slate-50 border border-slate-100 rounded-xl">
          <Settings size={18} className="text-slate-500" />
        </button>
      </header>

      {/* CONTENT AREA */}
      <main className="flex-1 overflow-y-auto px-4 pt-3 pb-24 custom-scrollbar bg-slate-50/50">
        {activeTab === 'radar' ? (
          <div className="space-y-3">
            <div className="flex items-center space-x-2 px-1 mb-2">
               <Zap size={14} className="text-amber-500 fill-amber-500" />
               <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest italic">Anlık %30+ Sıçramalar</span>
            </div>
            {scanningData.length === 0 ? (
              <div className="py-20 flex flex-col items-center justify-center bg-white rounded-3xl border border-dashed border-slate-200">
                <Loader2 className="animate-spin text-indigo-500 mb-3" size={32} />
                <span className="text-xs font-bold text-slate-400">Piyasada büyük hareket bekleniyor...</span>
              </div>
            ) : (
              scanningData.map((c) => (
                <div key={c.symbol} onClick={() => handleQuickAnalysis(c.symbol)} className="bg-white p-5 rounded-3xl border border-slate-100 shadow-sm active:scale-[0.98] transition-all flex items-center justify-between group">
                  <div className="flex items-center space-x-4">
                     <div className="w-12 h-12 bg-indigo-50 rounded-2xl flex items-center justify-center text-indigo-600 font-black text-sm">{c.symbol.replace('USDT','')[0]}</div>
                     <div>
                        <div className="font-black text-base uppercase tracking-tighter text-slate-900">{c.symbol.replace('USDT','')}</div>
                        <div className="text-[11px] font-bold text-slate-400 italic mt-0.5">${c.lastPrice}</div>
                     </div>
                  </div>
                  <div className="text-right">
                     <div className="text-2xl font-black italic text-indigo-600 tracking-tighter">%{c.priceChangePercent.toFixed(0)}</div>
                     <div className="text-[9px] font-bold text-indigo-400 uppercase tracking-widest flex items-center justify-end"><Clock size={10} className="mr-1"/> ANALİZ ET</div>
                  </div>
                </div>
              ))
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {/* SEARCH & FILTER */}
            <div className="sticky top-0 z-20 bg-[#F8FAFC]/80 backdrop-blur-md pb-2">
              <div className="relative mb-2">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                <input 
                  type="text" 
                  placeholder="Sembol ara..." 
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="w-full bg-white border border-slate-200 rounded-2xl py-3 pl-11 pr-4 text-xs font-bold outline-none focus:ring-2 focus:ring-indigo-500/10 transition-all shadow-sm"
                />
              </div>
              <div className="flex gap-1.5 overflow-x-auto pb-1 no-scrollbar">
                {(['all', 'gainers', 'losers'] as const).map(type => (
                  <button 
                    key={type} 
                    onClick={() => setFilterType(type)} 
                    className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase whitespace-nowrap transition-all border ${filterType === type ? 'bg-indigo-600 text-white border-indigo-600 shadow-md' : 'bg-white text-slate-500 border-slate-200'}`}
                  >
                    {type === 'all' ? 'Hepsi' : type === 'gainers' ? 'Yükselen' : 'Düşen'}
                  </button>
                ))}
                <button onClick={() => setSortConfig(prev => ({ key: 'priceChangePercent', direction: prev.direction === 'desc' ? 'asc' : 'desc' }))} className="px-4 py-2 rounded-xl text-[10px] font-black uppercase bg-white text-slate-500 border border-slate-200 flex items-center space-x-1">
                   <ArrowUpDown size={12} /> <span>Sırala</span>
                </button>
              </div>
            </div>

            {/* MOBILE LIST CARDS */}
            <div className="grid grid-cols-1 gap-2">
              {filteredAndSortedList.slice(0, 100).map(c => (
                <div key={c.symbol} onClick={() => handleQuickAnalysis(c.symbol)} className="bg-white p-4 rounded-2xl border border-slate-100 flex items-center justify-between active:bg-slate-50 transition-colors">
                  <div className="flex items-center space-x-3">
                    <span className="font-black text-sm text-slate-800 tracking-tight">{c.symbol.replace('USDT','')}</span>
                    <span className="text-[10px] font-mono text-slate-400">${c.lastPrice}</span>
                  </div>
                  <div className={`text-sm font-black italic flex items-center space-x-1 ${c.priceChangePercent >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                    <span>%{c.priceChangePercent.toFixed(2)}</span>
                    <ChevronRight size={14} className="opacity-30" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>

      {/* SIMPLIFIED DETAIL MODAL */}
      {(analyzingSymbol || isAnalyzing) && (
        <div className="fixed inset-0 z-[1000] bg-slate-900/40 backdrop-blur-sm flex items-end sm:items-center justify-center">
           <div className="bg-white w-full max-w-md rounded-t-[3rem] sm:rounded-[3rem] overflow-hidden shadow-2xl animate-in slide-in-from-bottom duration-300 flex flex-col max-h-[85vh]">
              <div className="p-6 border-b flex justify-between items-center bg-white sticky top-0 z-10">
                 <div>
                    <h3 className="font-black text-2xl uppercase tracking-tighter text-indigo-600">{analyzingSymbol}</h3>
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">ASİSTAN RAPORU</div>
                 </div>
                 <button onClick={() => setAnalyzingSymbol(null)} className="p-3 bg-slate-50 rounded-2xl text-slate-400"><X size={20}/></button>
              </div>

              <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar">
                {isAnalyzing ? (
                   <div className="py-20 flex flex-col items-center"><Loader2 className="animate-spin text-indigo-600 mb-4" size={40}/><span className="text-xs font-bold text-slate-400 uppercase tracking-widest">Veriler Okunuyor...</span></div>
                ) : (
                  <>
                    {/* 15m PRICE HISTORY LIST */}
                    <div className="space-y-3">
                       <div className="flex items-center space-x-2 text-slate-400 mb-1 px-1">
                          <Clock size={14} />
                          <span className="text-[10px] font-black uppercase tracking-widest">SON 15 DK ARALIKLARI</span>
                       </div>
                       {history15m.map((k, i) => {
                         const change = ((k.close - k.open) / k.open * 100);
                         return (
                           <div key={i} className="bg-slate-50/50 p-4 rounded-2xl border border-slate-100 flex justify-between items-center">
                             <span className="text-[11px] font-bold text-slate-400 uppercase italic">{i === 0 ? 'ŞİMDİ' : `${i*15} DK ÖNCE`}</span>
                             <div className="flex items-center space-x-3">
                                <span className="text-sm font-mono font-bold text-slate-700">${k.close}</span>
                                <span className={`text-[10px] font-black px-2 py-0.5 rounded-lg ${change >= 0 ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'}`}>
                                  %{change >= 0 ? '+' : ''}{change.toFixed(2)}
                                </span>
                             </div>
                           </div>
                         );
                       })}
                    </div>

                    {/* AI ANALİZİ */}
                    {analysisResult && (
                      <div className="bg-indigo-600 p-6 rounded-[2.5rem] text-white shadow-xl shadow-indigo-200 relative overflow-hidden">
                         <div className="flex items-center space-x-2 mb-4 relative z-10">
                            <Brain size={18} />
                            <span className="text-[10px] font-black uppercase tracking-widest">SENTINEL AI</span>
                         </div>
                         <p className="text-sm leading-relaxed font-medium italic opacity-95 relative z-10">
                           "{analysisResult.rationale_tr}"
                         </p>
                         <div className="mt-5 flex items-center justify-between relative z-10">
                            <div className="bg-white/20 backdrop-blur-md px-3 py-1.5 rounded-xl text-[10px] font-black">PUAN: {(analysisResult.score*100).toFixed(0)}</div>
                            <div className="text-[9px] font-bold opacity-40 uppercase italic tracking-widest">Yatırım Tavsiyesi Değildir</div>
                         </div>
                         <Brain size={120} className="absolute -right-6 -bottom-6 opacity-10 rotate-12" />
                      </div>
                    )}
                  </>
                )}
              </div>
              <div className="p-6 bg-white border-t">
                 <button onClick={() => setAnalyzingSymbol(null)} className="w-full py-5 bg-indigo-600 text-white rounded-2xl font-black uppercase text-xs tracking-widest shadow-lg shadow-indigo-200 active:scale-95 transition-all">TAKİBİ KAPAT</button>
              </div>
           </div>
        </div>
      )}

      {/* MOBILE BOTTOM NAV */}
      <nav className="fixed bottom-6 left-1/2 -translate-x-1/2 flex items-center bg-white/90 backdrop-blur-3xl border border-slate-100 p-2 rounded-[2.5rem] shadow-xl z-[100] w-[280px]">
         <button onClick={() => setActiveTab('radar')} className={`flex-1 flex items-center justify-center space-x-2 h-12 rounded-[2rem] transition-all duration-300 ${activeTab === 'radar' ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-200' : 'text-slate-400'}`}>
            <ListFilter size={18} />
            {activeTab === 'radar' && <span className="text-[11px] font-black uppercase tracking-wider">RADAR</span>}
         </button>
         <button onClick={() => setActiveTab('list')} className={`flex-1 flex items-center justify-center space-x-2 h-12 rounded-[2rem] transition-all duration-300 ${activeTab === 'list' ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-200' : 'text-slate-400'}`}>
            <Hash size={18} />
            {activeTab === 'list' && <span className="text-[11px] font-black uppercase tracking-wider">LİSTE</span>}
         </button>
      </nav>

      {/* SETTINGS PANEL */}
      {isSettingsOpen && (
        <div className="fixed inset-0 z-[2000] flex items-end bg-slate-900/50 backdrop-blur-sm">
           <div className="bg-white w-full rounded-t-[3rem] p-8 pb-12 shadow-3xl animate-in slide-in-from-bottom duration-500 max-h-[90vh] overflow-y-auto">
              <div className="flex justify-between items-center mb-8">
                 <h3 className="font-black text-xl text-slate-900">Ayarlar</h3>
                 <button onClick={()=>setIsSettingsOpen(false)} className="p-3 bg-slate-50 rounded-2xl text-slate-400"><X size={20}/></button>
              </div>
              <div className="space-y-6">
                 <div className="bg-slate-50 p-6 rounded-3xl border border-slate-100">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 block">Bildirim Eşiği (%)</label>
                    <input type="number" value={userSettings.buyJumpThreshold} onChange={e=>setUserSettings({...userSettings, buyJumpThreshold: Number(e.target.value)})} className="w-full bg-white border border-slate-200 rounded-2xl p-4 text-sm font-bold outline-none focus:border-indigo-500"/>
                 </div>
                 <div className="bg-slate-50 p-6 rounded-3xl border border-slate-100">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 block">Telegram Bot Token</label>
                    <input type="password" value={userSettings.telegramBotToken} onChange={e=>setUserSettings({...userSettings, telegramBotToken: e.target.value})} placeholder="78234..." className="w-full bg-white border border-slate-200 rounded-2xl p-4 text-xs font-mono outline-none focus:border-indigo-500"/>
                 </div>
                 <div className="bg-slate-50 p-6 rounded-3xl border border-slate-100">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 block">Sohbet ID</label>
                    <input type="text" value={userSettings.telegramChatId} onChange={e=>setUserSettings({...userSettings, telegramChatId: e.target.value})} placeholder="-100..." className="w-full bg-white border border-slate-200 rounded-2xl p-4 text-xs font-mono outline-none focus:border-indigo-500"/>
                 </div>
                 <button onClick={()=>setIsSettingsOpen(false)} className="w-full py-5 bg-indigo-600 text-white rounded-2xl font-black uppercase text-xs tracking-widest shadow-xl shadow-indigo-200">AYARLARI KAYDET</button>
              </div>
           </div>
        </div>
      )}
    </div>
  );
};

export default App;
