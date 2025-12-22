
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
  Cloud, CloudLightning, ExternalLink
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
  
  // Arama ve Sıralama
  const [searchQuery, setSearchQuery] = useState('');
  const [sortConfig, setSortConfig] = useState<{ key: keyof MarketTicker, direction: 'asc' | 'desc' }>({ key: 'priceChangePercent', direction: 'desc' });
  const [filterType, setFilterType] = useState<'all' | 'gainers' | 'losers' | 'highVolume'>('all');

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

    const text = `🚨 *${symbol} TAKİBİ* (CANLI)\n\n` +
                 `📈 Artış: %${change.toFixed(2)}\n` +
                 `💵 Fiyat: $${price}\n` +
                 `⏰ Güncelleme: ${new Date().toLocaleTimeString('tr-TR')}\n\n` +
                 `⚡️ Sentinel USD-M Futures Bot`;

    try {
      if (prev?.id) {
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
    else if (filterType === 'highVolume') result = result.filter(c => c.volume > 100000000);
    result.sort((a, b) => {
      const valA = a[sortConfig.key];
      const valB = b[sortConfig.key];
      return sortConfig.direction === 'desc' ? (valB as number) - (valA as number) : (valA as number) - (valB as number);
    });
    return result;
  }, [allFutures, searchQuery, sortConfig, filterType]);

  const toggleSort = (key: keyof MarketTicker) => setSortConfig(prev => ({ key, direction: prev.key === key && prev.direction === 'desc' ? 'asc' : 'desc' }));

  return (
    <div className="flex flex-col h-screen bg-[#F0F4F8] text-slate-900 overflow-hidden font-sans">
      {/* HEADER */}
      <header className="h-16 bg-white border-b flex items-center justify-between px-6 shrink-0 shadow-sm z-50">
        <div className="flex items-center space-x-2">
          <div className="w-10 h-10 bg-emerald-600 rounded-xl flex items-center justify-center text-white font-black shadow-lg">S</div>
          <div>
            <span className="font-black text-sm uppercase tracking-tighter block">SENTINEL LIVE</span>
            <span className="text-[9px] font-bold text-emerald-600 uppercase tracking-widest flex items-center">
              <Cloud size={10} className="mr-1" /> Sunucu Modu Destekli
            </span>
          </div>
        </div>
        <button onClick={() => setIsSettingsOpen(true)} className="p-2.5 bg-slate-50 border rounded-2xl hover:bg-slate-100 transition-all">
          <Settings size={20} className="text-slate-400" />
        </button>
      </header>

      {/* MAIN */}
      <main className="flex-1 overflow-y-auto px-4 pt-4 pb-28 custom-scrollbar">
        {activeTab === 'radar' ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {scanningData.length === 0 ? (
              <div className="col-span-full flex flex-col items-center justify-center py-24 text-slate-400 bg-white/50 rounded-[3rem] border-2 border-dashed border-slate-200">
                <Loader2 className="animate-spin mb-4 text-emerald-500" size={40} />
                <span className="text-sm font-black uppercase tracking-widest text-center italic">Yüksek Hacimli %30+ Pump Bekleniyor...</span>
              </div>
            ) : (
              scanningData.map((c) => (
                <div key={c.symbol} onClick={() => handleQuickAnalysis(c.symbol)} className={`bg-gradient-to-br ${c.priceChangePercent >= 50 ? 'from-emerald-700 to-emerald-600 text-white' : 'from-emerald-400 to-emerald-300 text-emerald-950'} rounded-[2.5rem] p-6 shadow-2xl transition-all active:scale-95 cursor-pointer relative overflow-hidden group`}>
                  <div className="flex justify-between items-start relative z-10">
                    <div><span className="font-black text-2xl uppercase tracking-tighter">{c.symbol.replace('USDT','')}</span><div className="text-xs font-bold opacity-80 mt-1 italic">${c.lastPrice}</div></div>
                    <div className="text-4xl font-black italic tracking-tighter">%{c.priceChangePercent.toFixed(0)}</div>
                  </div>
                  <div className="mt-4 flex items-center justify-between relative z-10 opacity-70">
                    <div className="text-[10px] font-black uppercase flex items-center"><Clock size={12} className="mr-1" /> CANLI</div>
                    <div className="flex items-center space-x-1 text-[10px] font-black uppercase bg-black/10 px-3 py-1.5 rounded-full"><Brain size={12} /><span>ANALİZ</span></div>
                  </div>
                </div>
              ))
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="bg-white p-6 rounded-[2.5rem] shadow-sm border border-slate-200 flex flex-col md:flex-row gap-4">
              <div className="flex-1 relative"><Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} /><input type="text" placeholder="Sembol ara (BTC, PEPE...)" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className="w-full bg-slate-50 border border-slate-100 rounded-2xl py-3 pl-12 pr-4 text-sm font-bold focus:bg-white focus:border-emerald-500 outline-none transition-all"/></div>
              <div className="flex gap-2">
                {(['all', 'gainers', 'losers', 'highVolume'] as const).map(type => (
                  <button key={type} onClick={() => setFilterType(type)} className={`px-4 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all ${filterType === type ? 'bg-emerald-600 text-white' : 'bg-slate-50 text-slate-400 border border-slate-100'}`}>
                    {type === 'all' ? 'Hepsi' : type === 'gainers' ? 'Yükselen' : type === 'losers' ? 'Düşen' : 'Hacimli'}
                  </button>
                ))}
              </div>
            </div>
            <div className="bg-white rounded-[2.5rem] overflow-hidden shadow-xl border border-slate-200">
               <div className="overflow-x-auto">
                 <table className="w-full text-left">
                   <thead className="bg-slate-50 text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] border-b">
                     <tr>
                       <th className="p-6 cursor-pointer" onClick={() => toggleSort('symbol')}>Varlık <ArrowUpDown size={12} className="inline"/></th>
                       <th className="p-6 cursor-pointer" onClick={() => toggleSort('lastPrice')}>Fiyat <ArrowUpDown size={12} className="inline"/></th>
                       <th className="p-6 cursor-pointer" onClick={() => toggleSort('priceChangePercent')}>24S Değişim <ArrowUpDown size={12} className="inline"/></th>
                       <th className="p-6 cursor-pointer" onClick={() => toggleSort('volume')}>Hacim <ArrowUpDown size={12} className="inline"/></th>
                     </tr>
                   </thead>
                   <tbody className="divide-y divide-slate-50">
                      {filteredAndSortedList.map(c => (
                        <tr key={c.symbol} onClick={() => handleQuickAnalysis(c.symbol)} className="group hover:bg-slate-50 cursor-pointer transition-colors">
                           <td className="p-6 font-black text-sm">{c.symbol.replace('USDT','')}</td>
                           <td className="p-6 font-mono text-xs font-bold text-slate-500">${c.lastPrice}</td>
                           <td className={`p-6 text-sm font-black italic ${c.priceChangePercent >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>%{c.priceChangePercent.toFixed(2)}</td>
                           <td className="p-6 text-xs font-black text-slate-400">${(c.volume / 1000000).toFixed(1)}M</td>
                        </tr>
                      ))}
                   </tbody>
                 </table>
               </div>
            </div>
          </div>
        )}
      </main>

      {/* ANALYSIS MODAL */}
      {(analyzingSymbol || isAnalyzing) && (
        <div className="fixed inset-0 z-[300] bg-slate-900/90 backdrop-blur-2xl flex items-center justify-center p-4">
           <div className="bg-white w-full max-w-lg rounded-[4rem] overflow-hidden shadow-3xl flex flex-col max-h-[90vh] animate-in zoom-in duration-300">
              <div className="p-8 border-b flex justify-between items-center bg-slate-50/50">
                 <div><h3 className="font-black text-3xl uppercase tracking-tighter text-slate-900">{analyzingSymbol}</h3><div className="flex items-center space-x-2 mt-1"><div className="w-2.5 h-2.5 bg-emerald-500 rounded-full animate-ping" /><span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">ASİSTAN RAPORU</span></div></div>
                 <button onClick={() => setAnalyzingSymbol(null)} className="p-4 bg-white border border-slate-100 rounded-3xl text-slate-400 hover:text-red-500 transition-all"><X size={28}/></button>
              </div>
              <div className="flex-1 overflow-y-auto p-10 space-y-10 custom-scrollbar">
                {isAnalyzing ? <div className="flex flex-col items-center py-24"><Loader2 className="animate-spin text-emerald-600 mb-8" size={60} /><span className="text-base font-black uppercase tracking-[0.3em] text-slate-400">Veriler İşleniyor...</span></div> : (
                  <>
                    <div className="bg-slate-50 p-8 rounded-[2.5rem] border border-slate-100">
                       <div className="flex items-center justify-between mb-6 text-slate-400"><div className="flex items-center space-x-2"><Clock size={18} /><span className="text-[11px] font-black uppercase tracking-widest">15 DAKİKALIK FİYAT BİLGİSİ</span></div><span className="text-[9px] font-black opacity-40 uppercase italic">CANLI</span></div>
                       <div className="space-y-4">{history15m.map((k, i) => { const change = ((k.close - k.open) / k.open * 100); return ( <div key={i} className="flex justify-between items-center bg-white p-5 rounded-2xl border border-slate-50 shadow-sm"><span className="text-[11px] font-black text-slate-400 uppercase italic">{i === 0 ? 'ŞİMDİ' : `${i*15} DK ÖNCE`}</span><div className="text-right"><div className="text-sm font-black text-slate-900 font-mono">${k.close}</div><span className={`text-[10px] font-black ${change >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>%{change >= 0 ? '+' : ''}{change.toFixed(2)}</span></div></div> ); })}</div>
                    </div>
                    {analysisResult && <div className="bg-slate-900 rounded-[3rem] p-10 text-white relative overflow-hidden shadow-2xl"><div className="flex justify-between items-center mb-8 relative z-10"><div className="flex items-center space-x-3"><Brain size={24} className="text-emerald-400" /><span className="text-[11px] font-black uppercase tracking-[0.3em]">AI YORUMU</span></div><div className="bg-emerald-500 text-white px-5 py-2 rounded-full text-sm font-black shadow-lg shadow-emerald-500/20">PUAN: {(analysisResult.score*100).toFixed(0)}</div></div><p className="text-base leading-relaxed italic opacity-90 relative z-10 font-medium">"{analysisResult.rationale_tr}"</p><Brain size={180} className="absolute -right-12 -bottom-12 opacity-5 rotate-12" /></div>}
                  </>
                )}
              </div>
              <div className="p-10 bg-slate-50 border-t shrink-0"><button onClick={() => setAnalyzingSymbol(null)} className="w-full py-6 bg-emerald-600 text-white rounded-[2rem] font-black uppercase text-xs tracking-[0.4em] shadow-2xl active:scale-95 transition-all">TAKİBİ KAPAT</button></div>
           </div>
        </div>
      )}

      {/* NAV */}
      <nav className="fixed bottom-8 left-1/2 -translate-x-1/2 flex items-center bg-white border p-3 rounded-[3rem] shadow-2xl z-[100]">
         <button onClick={() => setActiveTab('radar')} className={`flex items-center justify-center space-x-3 h-16 rounded-[2.5rem] transition-all duration-500 ${activeTab === 'radar' ? 'w-44 bg-emerald-600 text-white' : 'w-16 text-slate-400'}`}><ListFilter size={24} />{activeTab === 'radar' && <span className="text-xs font-black uppercase tracking-widest">Radar</span>}</button>
         <div className="w-[1px] h-8 bg-slate-100 mx-4" />
         <button onClick={() => setActiveTab('list')} className={`flex items-center justify-center space-x-3 h-16 rounded-[2.5rem] transition-all duration-500 ${activeTab === 'list' ? 'w-44 bg-emerald-600 text-white' : 'w-16 text-slate-400'}`}><Hash size={24} />{activeTab === 'list' && <span className="text-xs font-black uppercase tracking-widest">Piyasa</span>}</button>
      </nav>

      {/* SETTINGS */}
      {isSettingsOpen && (
        <div className="fixed inset-0 z-[400] flex items-end lg:items-center justify-center bg-slate-900/70 backdrop-blur-md">
           <div className="bg-white w-full max-w-xl rounded-t-[4rem] lg:rounded-[4rem] p-12 shadow-3xl animate-in slide-in-from-bottom duration-500 custom-scrollbar overflow-y-auto max-h-[90vh]">
              <div className="flex justify-between items-center mb-10">
                 <h3 className="font-black text-3xl uppercase tracking-tighter italic text-slate-900">Sentinel Yönetim</h3>
                 <button onClick={()=>setIsSettingsOpen(false)} className="p-4 bg-slate-50 rounded-3xl hover:bg-red-50 transition-all"><X size={28}/></button>
              </div>
              
              <div className="space-y-8">
                 {/* BULUT SUNUCU REHBERİ */}
                 <div className="bg-emerald-50 p-8 rounded-[2.5rem] border border-emerald-100 space-y-4">
                    <div className="flex items-center space-x-3 text-emerald-600">
                       <CloudLightning size={24} />
                       <span className="font-black text-sm uppercase">24/7 Bulut Takibi (Önerilir)</span>
                    </div>
                    <p className="text-[11px] text-emerald-800 font-medium leading-relaxed">
                      Vercel "serverless" olduğu için tarayıcıyı kapattığınızda takip durur. 24 saat kesintisiz Telegram bildirimi almak için sistemle birlikte gelen <b>worker.js</b> dosyasını bir sunucuda çalıştırın.
                    </p>
                    <button className="flex items-center space-x-2 text-[10px] font-black text-emerald-600 uppercase bg-white px-4 py-2 rounded-xl shadow-sm border border-emerald-200">
                       <ExternalLink size={14}/> <span>Railway/Render Kurulum Rehberi</span>
                    </button>
                 </div>

                 <div className="space-y-6">
                    <div className="bg-slate-50 p-6 rounded-3xl border">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 block">Telegram Bot Token</label>
                        <input type="password" value={userSettings.telegramBotToken} onChange={e=>setUserSettings({...userSettings, telegramBotToken: e.target.value})} placeholder="Bot Token" className="w-full bg-white border rounded-2xl p-4 text-sm font-mono outline-none"/>
                    </div>
                    <div className="bg-slate-50 p-6 rounded-3xl border">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 block">Telegram Sohbet ID</label>
                        <input type="text" value={userSettings.telegramChatId} onChange={e=>setUserSettings({...userSettings, telegramChatId: e.target.value})} placeholder="Sohbet ID" className="w-full bg-white border rounded-2xl p-4 text-sm font-mono outline-none"/>
                    </div>
                 </div>
                 <button onClick={()=>setIsSettingsOpen(false)} className="w-full py-7 bg-emerald-600 text-white rounded-[2rem] font-black uppercase text-xs tracking-[0.5em] shadow-2xl">AYARLARI KAYDET</button>
              </div>
           </div>
        </div>
      )}
    </div>
  );
};

export default App;
