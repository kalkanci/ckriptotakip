
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
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  
  const telegramMessageRef = useRef<Record<string, { id: number, time: number, lastScore: number }>>({});
  const tickerBuffer = useRef<Record<string, MarketTicker>>({});

  useEffect(() => {
    localStorage.setItem('sentinel_pro_settings', JSON.stringify(userSettings));
  }, [userSettings]);

  // Akıllı Potansiyel Hesaplama (vScore)
  const calculatePotential = (ticker: MarketTicker): number => {
    const absChange = Math.abs(ticker.priceChangePercent);
    const volumeImpact = Math.log10(ticker.volume + 1) / 4.5; // Hacim ağırlığı biraz artırıldı
    const score = (absChange * 0.6) + (volumeImpact * 40);
    return Math.min(score, 100);
  };

  const updateTelegram = async (symbol: string, change: number, price: number, score: number) => {
    if (!userSettings.telegramBotToken || !userSettings.telegramChatId || !userSettings.isNotificationEnabled) return;
    
    const now = Date.now();
    const prev = telegramMessageRef.current[symbol];
    
    // FILTRE: Sadece vScore > 75 (Yüksek Potansiyel) VEYA Değişim > %25 ise gönder
    // Ayrıca her sembol için en az 5 dakika bekle (spam engelleme)
    if (score < 75 && Math.abs(change) < 25) return;
    if (prev && (now - prev.time < 300000)) return; 

    const trendEmoji = change >= 0 ? '🚀' : '📉';
    const strengthLevel = score > 85 ? 'KRİTİK' : 'YÜKSEK';
    
    const text = `${trendEmoji} *SENTINEL: ${strengthLevel} FIRSAT*\n\n` +
                 `💎 Varlık: #${symbol.replace('USDT','')}\n` +
                 `📊 Potansiyel Skoru: %${score.toFixed(0)}\n` +
                 `📈 Anlık Değişim: %${change.toFixed(2)}\n` +
                 `💵 Fiyat: $${price}\n\n` +
                 `⚡️ *Hacim destekli hareket tespit edildi.*`;

    try {
      const res = await fetch(`https://api.telegram.org/bot${userSettings.telegramBotToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: userSettings.telegramChatId,
          text: text,
          parse_mode: 'Markdown'
        })
      });
      const data = await res.json();
      if (data.ok) {
        telegramMessageRef.current[symbol] = { id: data.result.message_id, time: now, lastScore: score };
      }
    } catch (e) {}
  };

  const handleQuickAnalysis = async (symbol: string) => {
    setIsAnalyzing(true);
    setAnalyzingSymbol(symbol);
    setAnalysisResult(null);
    setHistory15m([]);
    try {
      const [history1m, h15] = await Promise.all([
        binanceService.getHistory(symbol, '1m', 100),
        binanceService.getHistory(symbol, '15m', 5)
      ]);
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

          // Akıllı Bildirim Kontrolü
          updateTelegram(t.s, change, price, ticker.vScore);
        });
      }
    });

    const loop = setInterval(() => {
      setAllFutures(Object.values(tickerBuffer.current) as MarketTicker[]);
    }, 1000);

    return () => { clearInterval(loop); unsub(); binanceService.disconnect(); };
  }, [userSettings]);

  // Radar Panelleri için Veri Ayrıştırma
  const topGainers = useMemo(() => 
    [...allFutures].sort((a,b) => b.priceChangePercent - a.priceChangePercent).slice(0, 10)
  , [allFutures]);

  const topPotentials = useMemo(() => 
    [...allFutures].sort((a,b) => (b.vScore || 0) - (a.vScore || 0)).slice(0, 10)
  , [allFutures]);

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
    <div className="flex flex-col h-screen bg-[#0F172A] text-slate-100 overflow-hidden font-sans select-none">
      {/* HEADER */}
      <header className="h-14 bg-slate-900 border-b border-slate-800 flex items-center justify-between px-6 shrink-0 z-[100] shadow-2xl">
        <div className="flex items-center space-x-3">
          <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center text-white font-black shadow-lg shadow-indigo-500/20">S</div>
          <div>
            <span className="font-black text-xs tracking-tight block leading-none">SENTINEL</span>
            <span className="text-[8px] font-black text-indigo-400 uppercase tracking-widest mt-0.5 block italic">INTELLIGENCE V3</span>
          </div>
        </div>
        <div className="flex items-center space-x-4">
           <div className="hidden md:flex items-center space-x-2 px-3 py-1 bg-slate-800 rounded-full border border-slate-700">
              <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
              <span className="text-[9px] font-black uppercase text-slate-400">Veri Akışı: Aktif</span>
           </div>
           <button onClick={() => setIsSettingsOpen(true)} className="p-2 bg-slate-800 border border-slate-700 rounded-xl hover:bg-slate-700 transition-colors">
            <Settings size={18} className="text-slate-400" />
          </button>
        </div>
      </header>

      {/* MAIN VIEWPORT */}
      <main className="flex-1 overflow-hidden relative">
        <div className={`absolute inset-0 transition-all duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] flex ${activeTab === 'list' ? '-translate-x-full opacity-0 scale-95' : 'translate-x-0 opacity-100 scale-100'}`}>
          
          {/* RADAR VIEW (SPLIT-SCREEN) */}
          <div className="w-full flex-shrink-0 overflow-y-auto px-4 py-6 pb-32 custom-scrollbar bg-slate-950">
            <div className="max-w-6xl mx-auto flex flex-col md:flex-row gap-6">
               
               {/* RADAR LEFT: TOP GAINERS */}
               <div className="flex-1 space-y-4">
                  <div className="flex items-center justify-between px-2">
                     <div className="flex items-center space-x-2">
                        <TrendingUp size={16} className="text-emerald-500" />
                        <span className="text-[11px] font-black text-slate-400 uppercase tracking-widest">ZİRVE KAZANÇLAR (24S)</span>
                     </div>
                     <span className="text-[10px] font-bold text-slate-500 italic">Piyasa Liderleri</span>
                  </div>
                  <div className="space-y-2">
                     {topGainers.map((c, i) => (
                       <div key={c.symbol} onClick={() => handleQuickAnalysis(c.symbol)} className="bg-slate-900/50 border border-slate-800 p-4 rounded-2xl flex items-center justify-between group hover:border-emerald-500/30 hover:bg-slate-900 transition-all cursor-pointer">
                          <div className="flex items-center space-x-4">
                             <span className="text-[10px] font-black text-slate-600 w-4 italic">{i+1}</span>
                             <span className="font-black text-sm uppercase tracking-tight text-white">{c.symbol.replace('USDT','')}</span>
                          </div>
                          <div className="text-right">
                             <div className="text-base font-black italic text-emerald-400">+{c.priceChangePercent.toFixed(1)}%</div>
                             <div className="text-[10px] font-mono font-bold text-slate-500">${c.lastPrice}</div>
                          </div>
                       </div>
                     ))}
                  </div>
               </div>

               {/* RADAR RIGHT: TOP POTENTIALS (vScore) */}
               <div className="flex-1 space-y-4">
                  <div className="flex items-center justify-between px-2">
                     <div className="flex items-center space-x-2">
                        <Zap size={16} className="text-amber-500 fill-amber-500" />
                        <span className="text-[11px] font-black text-slate-400 uppercase tracking-widest">YÜKSEK POTANSİYEL (vScore)</span>
                     </div>
                     <span className="text-[10px] font-bold text-slate-500 italic">Hacim Destekli</span>
                  </div>
                  <div className="space-y-2">
                     {topPotentials.map((c, i) => (
                       <div key={c.symbol} onClick={() => handleQuickAnalysis(c.symbol)} className="bg-slate-900/50 border border-slate-800 p-4 rounded-2xl flex items-center justify-between group hover:border-indigo-500/30 hover:bg-slate-900 transition-all cursor-pointer">
                          <div className="flex items-center space-x-4">
                             <span className="text-[10px] font-black text-slate-600 w-4 italic">{i+1}</span>
                             <span className="font-black text-sm uppercase tracking-tight text-white">{c.symbol.replace('USDT','')}</span>
                          </div>
                          <div className="flex items-center space-x-4 text-right">
                             <div>
                                <div className="text-base font-black text-indigo-400">{(c.vScore || 0).toFixed(0)}</div>
                                <div className="text-[10px] font-bold text-slate-500 uppercase">${(c.volume/1000000).toFixed(1)}M</div>
                             </div>
                             <div className="w-1.5 h-10 bg-slate-800 rounded-full overflow-hidden">
                                <div className="w-full bg-indigo-500 shadow-[0_0_8px_rgba(99,102,241,0.5)]" style={{height: `${c.vScore}%`, marginTop: `${100- (c.vScore || 0)}%`}} />
                             </div>
                          </div>
                       </div>
                     ))}
                  </div>
               </div>

            </div>
          </div>
        </div>

        {/* LIST VIEW (DENSE ROW TABLE) */}
        <div className={`absolute inset-0 transition-all duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] flex flex-col bg-slate-950 ${activeTab === 'radar' ? 'translate-x-full opacity-0' : 'translate-x-0 opacity-100'}`}>
           {/* ToolBar */}
           <div className="p-4 border-b border-slate-800 flex flex-col sm:flex-row gap-4 items-center justify-between bg-slate-900/40">
              <div className="relative w-full sm:w-80">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={14} />
                <input 
                  type="text" 
                  placeholder="Hızlı arama (örn: BTC, PEPE)..." 
                  value={searchQuery} 
                  onChange={e => setSearchQuery(e.target.value)} 
                  className="w-full bg-slate-800/50 border border-slate-700 rounded-2xl py-2.5 pl-10 pr-4 text-[11px] font-bold text-white outline-none focus:ring-2 focus:ring-indigo-500/20 placeholder:text-slate-600 transition-all"
                />
              </div>
              <div className="flex gap-1.5 overflow-x-auto no-scrollbar w-full sm:w-auto">
                 {(['all', 'gainers', 'losers', 'potential'] as const).map(type => (
                   <button key={type} onClick={() => setFilterType(type)} className={`px-4 py-2 rounded-xl text-[9px] font-black uppercase whitespace-nowrap border transition-all ${filterType === type ? 'bg-indigo-600 text-white border-indigo-500 shadow-lg shadow-indigo-500/20' : 'bg-slate-800 text-slate-400 border-slate-700 hover:border-slate-600'}`}>
                     {type === 'all' ? 'TÜM PİYASA' : type === 'gainers' ? 'YÜKSELENLER' : type === 'losers' ? 'DÜŞENLER' : 'YÜKSEK POT.'}
                   </button>
                 ))}
              </div>
           </div>

           {/* Table Header */}
           <div className="flex items-center px-6 py-4 bg-slate-900 text-[9px] font-black text-slate-500 uppercase tracking-[0.2em] border-b border-slate-800 sticky top-0 z-10 shrink-0">
              <div className="flex-1">VARLIK SEMBOLÜ</div>
              <div className="w-24 text-right">SON FİYAT</div>
              <div className="w-24 text-right">24S DEĞİŞİM</div>
              <div className="w-28 text-right hidden sm:block">24S HACİM</div>
              <div className="w-20 text-right">vSCORE</div>
           </div>

           {/* Table Content */}
           <div className="flex-1 overflow-y-auto pb-32 custom-scrollbar">
              <div className="min-w-full">
                {filteredAndSortedList.length === 0 ? (
                  <div className="py-32 flex flex-col items-center opacity-30">
                    <Loader2 size={32} className="animate-spin mb-4" />
                    <span className="text-[10px] font-black uppercase tracking-widest">Eşleşen Veri Taranıyor...</span>
                  </div>
                ) : (
                  filteredAndSortedList.slice(0, 150).map(c => (
                    <div 
                      key={c.symbol} 
                      onClick={() => handleQuickAnalysis(c.symbol)}
                      className="flex items-center px-6 py-4 border-b border-slate-900 hover:bg-indigo-500/5 transition-colors cursor-pointer group"
                    >
                      <div className="flex-1 flex items-center space-x-4">
                         <div className={`w-8 h-8 rounded-lg flex items-center justify-center font-black text-[9px] ${c.priceChangePercent >= 0 ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'} border border-white/5`}>
                            {c.symbol.substring(0,2)}
                         </div>
                         <div className="font-black text-sm text-white tracking-tight">{c.symbol.replace('USDT','')}</div>
                      </div>
                      <div className="w-24 text-right font-mono font-bold text-xs text-slate-300">${c.lastPrice}</div>
                      <div className={`w-24 text-right font-black text-xs italic ${c.priceChangePercent >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                        {c.priceChangePercent >= 0 ? '+' : ''}{c.priceChangePercent.toFixed(2)}%
                      </div>
                      <div className="w-28 text-right hidden sm:block font-bold text-[10px] text-slate-500 font-mono italic">${(c.volume/1000000).toFixed(1)}M</div>
                      <div className="w-20 text-right">
                         <span className={`px-2.5 py-1 rounded-lg text-[10px] font-black ${c.vScore! > 70 ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/20' : 'bg-slate-800 text-slate-500'}`}>
                           {(c.vScore || 0).toFixed(0)}
                         </span>
                      </div>
                    </div>
                  ))
                )}
              </div>
           </div>
        </div>
      </main>

      {/* NAVIGATION BAR */}
      <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[100] w-[220px]">
        <div className="bg-slate-900 border border-slate-800 p-1 rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.5)] flex items-center relative overflow-hidden ring-1 ring-white/10">
           <div 
             className={`absolute top-1 bottom-1 w-[calc(50%-4px)] bg-indigo-600 rounded-xl transition-all duration-500 cubic-bezier(0.34, 1.56, 0.64, 1) ${activeTab === 'list' ? 'left-[calc(50%+2px)]' : 'left-1'}`} 
           />
           <button onClick={() => setActiveTab('radar')} className={`flex-1 flex items-center justify-center space-x-2 h-9 rounded-xl relative z-10 transition-colors ${activeTab === 'radar' ? 'text-white' : 'text-slate-500'}`}>
              <Zap size={14} fill={activeTab === 'radar' ? 'currentColor' : 'none'}/>
              <span className="text-[9px] font-black uppercase tracking-[0.2em]">RADAR</span>
           </button>
           <button onClick={() => setActiveTab('list')} className={`flex-1 flex items-center justify-center space-x-2 h-9 rounded-xl relative z-10 transition-colors ${activeTab === 'list' ? 'text-white' : 'text-slate-500'}`}>
              <Hash size={14} />
              <span className="text-[9px] font-black uppercase tracking-[0.2em]">LİSTE</span>
           </button>
        </div>
      </div>

      {/* ANALYSIS MODAL (BOTTOM DRAWER) */}
      {analyzingSymbol && (
        <div className="fixed inset-0 z-[1000] bg-black/60 backdrop-blur-md flex items-end justify-center">
           <div className="bg-slate-900 w-full max-w-2xl rounded-t-[3rem] overflow-hidden shadow-3xl animate-in slide-in-from-bottom duration-500 flex flex-col max-h-[90vh] border-t border-white/5">
              <div className="px-8 py-6 border-b border-white/5 flex justify-between items-center">
                 <div className="flex items-center space-x-4">
                    <div className="w-12 h-12 bg-white/5 rounded-2xl flex items-center justify-center text-white font-black text-xl border border-white/10">
                      {analyzingSymbol?.replace('USDT','')[0]}
                    </div>
                    <div>
                       <h3 className="font-black text-2xl uppercase tracking-tighter text-white leading-none">{analyzingSymbol}</h3>
                       <span className="text-[10px] font-black text-indigo-400 uppercase tracking-widest mt-1.5 inline-block italic">Sentinel AI Deep Analysis</span>
                    </div>
                 </div>
                 <button onClick={() => setAnalyzingSymbol(null)} className="p-3 bg-white/5 rounded-2xl text-slate-400 hover:text-white transition-colors"><X size={24}/></button>
              </div>

              <div className="flex-1 overflow-y-auto p-8 space-y-8 custom-scrollbar">
                {isAnalyzing ? (
                   <div className="py-24 flex flex-col items-center">
                      <div className="relative mb-8">
                         <div className="absolute inset-0 bg-indigo-500/20 blur-3xl rounded-full" />
                         <Loader2 className="animate-spin text-indigo-500 relative z-10" size={64}/>
                      </div>
                      <span className="text-[11px] font-black text-slate-500 uppercase tracking-[0.4em] animate-pulse">PİYASA DERİNLİĞİ TARANIYOR...</span>
                   </div>
                ) : (
                  <>
                    <div className="grid grid-cols-2 gap-4">
                       <div className="bg-white/5 p-5 rounded-3xl border border-white/5">
                          <span className="text-[10px] font-black text-slate-500 uppercase block mb-2 tracking-widest">EN DÜŞÜK (24S)</span>
                          <span className="text-sm font-mono font-bold text-slate-200">${tickerBuffer.current[analyzingSymbol]?.low}</span>
                       </div>
                       <div className="bg-white/5 p-5 rounded-3xl border border-white/5">
                          <span className="text-[10px] font-black text-slate-500 uppercase block mb-2 tracking-widest">EN YÜKSEK (24S)</span>
                          <span className="text-sm font-mono font-bold text-slate-200">${tickerBuffer.current[analyzingSymbol]?.high}</span>
                       </div>
                    </div>

                    <div className="space-y-4">
                       <div className="flex items-center space-x-3 text-slate-500 px-1">
                          <Clock size={14} />
                          <span className="text-[11px] font-black uppercase tracking-widest">Fiyat Geçmişi (15dk Aralıklar)</span>
                       </div>
                       <div className="space-y-2">
                        {history15m.map((k, i) => {
                          const change = ((k.close - k.open) / k.open * 100);
                          return (
                            <div key={i} className="bg-white/5 p-4 rounded-2xl border border-white/5 flex justify-between items-center group hover:bg-white/10 transition-all">
                              <span className="text-[11px] font-black text-slate-500 uppercase italic">{i === 0 ? 'ŞİMDİ' : `${i*15}dk Önce`}</span>
                              <div className="flex items-center space-x-6">
                                 <span className="text-xs font-mono font-bold text-slate-200">${k.close}</span>
                                 <span className={`min-w-[60px] text-right text-[11px] font-black italic ${change >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                   %{change >= 0 ? '+' : ''}{change.toFixed(2)}
                                 </span>
                              </div>
                            </div>
                          );
                        })}
                       </div>
                    </div>

                    {analysisResult && (
                      <div className="bg-indigo-600 p-8 rounded-[2.5rem] text-white shadow-2xl relative overflow-hidden group">
                         <div className="flex items-center justify-between mb-5 relative z-10">
                            <div className="flex items-center space-x-3">
                               <Brain size={20} className="text-white" />
                               <span className="text-[11px] font-black uppercase tracking-widest text-white/80">AI Görüşü</span>
                            </div>
                            <div className="px-3 py-1 rounded-lg bg-black/20 text-[10px] font-black border border-white/10 uppercase italic">
                              SKOR: {(analysisResult.score*100).toFixed(0)}/100
                            </div>
                         </div>
                         <p className="text-sm leading-relaxed font-bold italic opacity-100 relative z-10">"{analysisResult.rationale_tr}"</p>
                         <Brain size={160} className="absolute -right-8 -bottom-8 opacity-10 rotate-12 transition-transform group-hover:rotate-0 duration-700" />
                      </div>
                    )}
                  </>
                )}
              </div>
              <div className="p-8 bg-slate-900 border-t border-white/5 shrink-0">
                 <button onClick={() => setAnalyzingSymbol(null)} className="w-full py-5 bg-white text-slate-900 rounded-3xl font-black uppercase text-xs tracking-[0.4em] active:scale-95 transition-all shadow-xl hover:bg-slate-100">KAPAT</button>
              </div>
           </div>
        </div>
      )}

      {/* SETTINGS DRAWER */}
      {isSettingsOpen && (
        <div className="fixed inset-0 z-[2000] flex items-end bg-black/70 backdrop-blur-lg">
           <div className="bg-slate-900 w-full rounded-t-[3.5rem] p-8 pb-12 shadow-3xl animate-in slide-in-from-bottom duration-500 max-h-[90vh] overflow-y-auto custom-scrollbar border-t border-white/5">
              <div className="flex justify-between items-center mb-10">
                 <div>
                    <h3 className="font-black text-3xl text-white tracking-tight leading-none uppercase italic">Ayarlar</h3>
                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.3em] block mt-2">Sistem Konfigürasyonu</span>
                 </div>
                 <button onClick={()=>setIsSettingsOpen(false)} className="p-3 bg-white/5 rounded-2xl text-slate-400"><X size={28}/></button>
              </div>

              <div className="space-y-8">
                 <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="bg-white/5 p-6 rounded-[2.5rem] border border-white/5 shadow-inner">
                       <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-4">Radar Sinyal Eşiği (%)</label>
                       <input type="number" value={userSettings.buyJumpThreshold} onChange={e=>setUserSettings({...userSettings, buyJumpThreshold: Number(e.target.value)})} className="w-full bg-transparent text-3xl font-black outline-none text-white italic"/>
                    </div>
                    <div className="bg-white/5 p-6 rounded-[2.5rem] border border-white/5 shadow-inner">
                       <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-4">Min. Hacim (Milyon $)</label>
                       <input type="number" value={minVolume} onChange={e=>setMinVolume(Number(e.target.value))} className="w-full bg-transparent text-3xl font-black outline-none text-white italic"/>
                    </div>
                 </div>

                 <div className="bg-white/5 p-8 rounded-[3rem] border border-white/5 space-y-5">
                    <div className="flex items-center space-x-3 text-slate-500 mb-2">
                       <CloudLightning size={20} />
                       <span className="text-[11px] font-black uppercase tracking-widest">Telegram Bot Entegrasyonu</span>
                    </div>
                    <input type="password" value={userSettings.telegramBotToken} onChange={e=>setUserSettings({...userSettings, telegramBotToken: e.target.value})} placeholder="Bot Token (HTTP API)" className="w-full bg-black/30 border border-white/5 rounded-2xl p-4 text-xs font-mono outline-none text-white focus:border-indigo-500/50 transition-all"/>
                    <input type="text" value={userSettings.telegramChatId} onChange={e=>setUserSettings({...userSettings, telegramChatId: e.target.value})} placeholder="Sohbet ID (Chat ID)" className="w-full bg-black/30 border border-white/5 rounded-2xl p-4 text-xs font-mono outline-none text-white focus:border-indigo-500/50 transition-all"/>
                    <div className="flex items-center space-x-2 pt-2">
                       <div className="w-2 h-2 bg-indigo-500 rounded-full" />
                       <p className="text-[10px] text-slate-500 font-bold italic">Sadece ekstrem potansiyelli (vScore > 75) varlıklar için bildirim gönderilir.</p>
                    </div>
                 </div>

                 <button onClick={()=>setIsSettingsOpen(false)} className="w-full py-6 bg-indigo-600 text-white rounded-[2rem] font-black uppercase text-xs tracking-[0.5em] shadow-2xl shadow-indigo-600/30 active:scale-95 transition-all mt-6">UYGULA VE AKTİFLEŞTİR</button>
              </div>
           </div>
        </div>
      )}
    </div>
  );
};

export default App;
