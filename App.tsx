
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { 
  Settings, Zap, Activity, X, 
  Terminal, ListFilter, Cpu, Bell, 
  ArrowUpRight, ArrowDownRight, Info, Gauge, 
  Search, Brain, ShieldAlert, Target, Loader2,
  BarChart3, Layers, BookOpen, MessageSquare,
  History, Smartphone, BellRing, Layout, Globe,
  BarChart, TrendingUp, Newspaper
} from 'lucide-react';
import { OrderLog, MarketTicker, UserSettings, LLMAnalysis, Kline, NewsItem, FuturesMetrics } from './types';
import { binanceService } from './services/binanceService';
import { llmService } from './services/llmService';

const App: React.FC = () => {
  const [userSettings, setUserSettings] = useState<UserSettings>(() => {
    const saved = localStorage.getItem('sentinel_pro_settings');
    return saved ? JSON.parse(saved) : { 
      riskPercent: 10, leverage: 5, maxNotional: 1150, dailyLossLimit: 25,
      buyScoreThreshold: 0.5, buyJumpThreshold: 80, ptpTargets: [], dcaSteps: [],
      autoOptimize: true, liqProtectionThreshold: 5, liqReductionRatio: 25,
      telegramBotToken: '', telegramChatId: '', isNotificationEnabled: true,
      isWebNotificationEnabled: false
    };
  });

  const [activeTab, setActiveTab] = useState<'radar' | 'stats'>('radar');
  const [logs, setLogs] = useState<OrderLog[]>(() => JSON.parse(localStorage.getItem('sentinel_pro_logs') || '[]'));
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [scanningData, setScanningData] = useState<MarketTicker[]>([]);
  const [analyzingSymbol, setAnalyzingSymbol] = useState<string | null>(null);
  const [analysisResult, setAnalysisResult] = useState<LLMAnalysis | null>(null);
  const [history4h, setHistory4h] = useState<Kline[]>([]);
  const [news, setNews] = useState<NewsItem[]>([]);
  const [futuresMetrics, setFuturesMetrics] = useState<FuturesMetrics | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [alertCount, setAlertCount] = useState(() => Number(localStorage.getItem('sentinel_alert_count') || 0));
  
  const alertedCoins = useRef<Record<string, number>>({});
  const tickerBuffer = useRef<Record<string, MarketTicker>>({});

  useEffect(() => {
    localStorage.setItem('sentinel_pro_settings', JSON.stringify(userSettings));
    localStorage.setItem('sentinel_pro_logs', JSON.stringify(logs.slice(0, 20)));
    localStorage.setItem('sentinel_alert_count', alertCount.toString());
  }, [userSettings, logs, alertCount]);

  const addLog = useCallback((message: string, action: any = 'INFO') => {
    const id = Math.random().toString(36).substring(7);
    setLogs(prev => [{ id, timestamp: new Date().toLocaleTimeString('tr-TR'), message, action } as any, ...prev].slice(0, 50));
  }, []);

  const triggerWebNotification = (symbol: string, change: number) => {
    if (!userSettings.isWebNotificationEnabled || !("Notification" in window)) return;
    if (Notification.permission === "granted") {
      new Notification(`🚀 SENTINEL: ${symbol} %${change.toFixed(1)} PUMP!`, {
        body: `Anlık fiyat hareketliliği tespit edildi.`,
        icon: 'https://cdn-icons-png.flaticon.com/512/2091/2091665.png',
        tag: symbol
      }).onclick = () => { window.focus(); handleQuickAnalysis(symbol); };
    }
  };

  const fetchNews = async (symbol: string) => {
    try {
      // CryptoPanic Ücretsiz API (Key olmadan genel başlıklar çekilebilir veya proxy üzerinden)
      // Alternatif olarak coingecko üzerinden veri simüle edilebilir veya doğrudan Binance haberleri
      const ticker = symbol.replace('USDT', '');
      const res = await fetch(`https://cryptopanic.com/api/v1/posts/?auth_token=PUBLIC&currencies=${ticker}&kind=news`);
      const data = await res.json();
      setNews((data.results || []).slice(0, 3).map((n: any) => ({
        title: n.title,
        source: n.domain,
        url: n.url,
        published_at: n.created_at
      })));
    } catch (e) {
      setNews([]);
    }
  };

  const handleQuickAnalysis = async (symbol: string) => {
    setIsAnalyzing(true);
    setAnalyzingSymbol(symbol);
    setAnalysisResult(null);
    setNews([]);
    setFuturesMetrics(null);
    try {
      const [history1m, h4, futures, _news] = await Promise.all([
        binanceService.getHistory(symbol, '1m', 100),
        binanceService.getHistory(symbol, '4h', 5),
        binanceService.getFuturesMetrics(symbol),
        fetchNews(symbol)
      ]);
      setHistory4h(h4);
      setFuturesMetrics(futures);
      const ticker = tickerBuffer.current[symbol];
      if (ticker) {
        const result = await llmService.analyzePump(ticker, history1m);
        setAnalysisResult(result);
      }
    } catch (error) {
      addLog(`Analiz hatası.`, 'WARNING');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const sendTelegramNotification = async (symbol: string, change: number, price: number, metrics: { volX: string, jumpSpeed: string, imbalance: number }) => {
    triggerWebNotification(symbol, change);
    if (!userSettings.telegramBotToken || !userSettings.telegramChatId || !userSettings.isNotificationEnabled) return;
    const now = Date.now();
    if (alertedCoins.current[symbol] && (now - alertedCoins.current[symbol] < 15 * 60 * 1000)) return;

    try {
      const h4 = await binanceService.getHistory(symbol, '4h', 3);
      const h4Text = h4.reverse().map((k, i) => `${k.close > k.open ? '🟢' : '🔴'} M${i+1}: %${((k.close - k.open)/k.open*100).toFixed(1)}`).join(' | ');
      
      const message = `🚨 *${symbol} PUMP TESPİTİ*\n` +
                      `📈 Değişim: %${change.toFixed(2)}\n` +
                      `💵 Fiyat: ${price}\n` +
                      `📊 ${h4Text}\n` +
                      `🔗 [Analiz Et](https://${window.location.host}/?s=${symbol})`;

      await fetch(`https://api.telegram.org/bot${userSettings.telegramBotToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: userSettings.telegramChatId, text: message, parse_mode: 'Markdown' })
      });
      alertedCoins.current[symbol] = now;
      setAlertCount(prev => prev + 1);
    } catch (e) {}
  };

  useEffect(() => {
    binanceService.connect();
    const unsub = binanceService.onMessage((data) => {
      if (Array.isArray(data)) {
        data.forEach(t => {
          if (!t.s.endsWith('USDT')) return;
          const change = parseFloat(t.P);
          tickerBuffer.current[t.s] = { symbol: t.s, lastPrice: parseFloat(t.c), priceChangePercent: change, high: parseFloat(t.h), low: parseFloat(t.l), volume: parseFloat(t.q) };
          if (change >= userSettings.buyJumpThreshold) {
            sendTelegramNotification(t.s, change, parseFloat(t.c), { volX: 'N/A', jumpSpeed: 'N/A', imbalance: 0 });
          }
        });
      }
    });
    const loop = setInterval(() => {
      const top = (Object.values(tickerBuffer.current) as MarketTicker[]).sort((a, b) => b.priceChangePercent - a.priceChangePercent).slice(0, 30);
      setScanningData(top);
    }, 1000);
    return () => { clearInterval(loop); unsub(); binanceService.disconnect(); };
  }, [userSettings.buyJumpThreshold]);

  return (
    <div className="flex flex-col h-screen bg-[#F8FAFC] text-slate-900 overflow-hidden">
      {/* HEADER */}
      <header className="h-16 bg-white border-b flex items-center justify-between px-6 shrink-0 z-50">
        <div className="flex items-center space-x-2">
          <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center text-white font-black italic">S</div>
          <span className="font-black text-sm uppercase tracking-tighter">Sentinel Pro</span>
        </div>
        <div className="flex items-center space-x-2">
          {userSettings.isWebNotificationEnabled && <BellRing size={16} className="text-indigo-600 animate-pulse" />}
          <button onClick={() => setIsSettingsOpen(true)} className="p-2 bg-slate-50 border rounded-xl hover:bg-slate-100"><Settings size={18} className="text-slate-400" /></button>
        </div>
      </header>

      {/* RADAR LIST */}
      <main className="flex-1 overflow-y-auto px-4 pt-4 pb-28 custom-scrollbar bg-slate-50/50">
        {activeTab === 'radar' ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {scanningData.map(c => (
              <div key={c.symbol} className="bg-white border rounded-[2rem] p-5 shadow-sm hover:border-indigo-400 transition-all cursor-pointer" onClick={() => handleQuickAnalysis(c.symbol)}>
                <div className="flex justify-between items-start">
                  <div>
                    <span className="font-black text-lg uppercase">{c.symbol.replace('USDT','')}</span>
                    <div className="text-[10px] font-mono font-bold text-slate-400">${c.lastPrice}</div>
                  </div>
                  <div className={`text-xl font-black italic ${c.priceChangePercent > 0 ? 'text-emerald-500' : 'text-red-500'}`}>%{c.priceChangePercent.toFixed(2)}</div>
                </div>
                <div className="mt-4 h-1 w-full bg-slate-100 rounded-full overflow-hidden">
                   <div className="h-full bg-indigo-600" style={{width: `${Math.min(c.priceChangePercent, 100)}%`}} />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="max-w-2xl mx-auto space-y-4">
            <div className="bg-indigo-600 rounded-[2rem] p-8 text-white">
              <span className="text-[10px] font-black uppercase opacity-60 tracking-widest">TOPLAM SİNYAL</span>
              <div className="text-5xl font-black italic tracking-tighter">{alertCount}</div>
            </div>
            <div className="bg-slate-900 rounded-[2rem] p-6 text-[10px] font-mono text-white/50 space-y-2">
              {logs.map(log => <div key={log.id}><span className="opacity-30">[{log.timestamp}]</span> {log.message}</div>)}
            </div>
          </div>
        )}
      </main>

      {/* ANALYSIS MODAL (COMPLEMENTARY WIDGETS) */}
      {(analyzingSymbol || isAnalyzing) && (
        <div className="fixed inset-0 z-[300] bg-slate-900/60 backdrop-blur-md flex items-center justify-center p-4">
           <div className="bg-white w-full max-w-2xl rounded-[3rem] overflow-hidden shadow-3xl flex flex-col max-h-[90vh] animate-in zoom-in duration-300">
              <div className="p-6 border-b flex justify-between items-center bg-slate-50/50">
                 <div>
                    <h3 className="font-black text-xl uppercase tracking-tighter">{analyzingSymbol}</h3>
                    <div className="flex items-center space-x-2 mt-1">
                       <span className="text-[9px] font-black text-slate-400 uppercase">AKILLI KARAR DESTEĞİ</span>
                    </div>
                 </div>
                 <button onClick={() => setAnalyzingSymbol(null)} className="p-2 bg-white border rounded-xl hover:text-red-500"><X size={20}/></button>
              </div>

              <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar">
                {isAnalyzing ? (
                  <div className="flex flex-col items-center py-20 opacity-30">
                    <Loader2 className="animate-spin text-indigo-600 mb-4" size={32} />
                    <span className="text-xs font-black uppercase tracking-widest">Veri Kaynakları Taranıyor...</span>
                  </div>
                ) : (
                  <>
                    {/* VADELİ METRİKLER WIDGET */}
                    <div className="grid grid-cols-2 gap-4">
                       <div className="bg-slate-50 p-4 rounded-3xl border border-slate-100 flex items-center space-x-3">
                          <div className="p-2 bg-white rounded-xl shadow-sm"><BarChart className="text-indigo-600" size={18}/></div>
                          <div>
                             <span className="text-[9px] font-black text-slate-400 uppercase">Açık İlgi (OI)</span>
                             <div className="text-sm font-bold">${(futuresMetrics?.openInterest || 0).toLocaleString()}</div>
                          </div>
                       </div>
                       <div className="bg-slate-50 p-4 rounded-3xl border border-slate-100 flex items-center space-x-3">
                          <div className="p-2 bg-white rounded-xl shadow-sm"><Activity className="text-emerald-500" size={18}/></div>
                          <div>
                             <span className="text-[9px] font-black text-slate-400 uppercase">Funding Rate</span>
                             <div className={`text-sm font-bold ${futuresMetrics?.fundingRate && futuresMetrics.fundingRate > 0 ? 'text-red-500' : 'text-emerald-500'}`}>
                                %{( (futuresMetrics?.fundingRate || 0) * 100).toFixed(4)}
                             </div>
                          </div>
                       </div>
                    </div>

                    {/* AI ANALİZ WIDGET */}
                    {analysisResult && (
                      <div className="bg-indigo-600 rounded-[2.5rem] p-6 text-white relative overflow-hidden">
                        <div className="flex justify-between items-start mb-4 relative z-10">
                           <div className="flex items-center space-x-2">
                              <Brain size={18}/>
                              <span className="text-[10px] font-black uppercase tracking-widest">AI Düşüncesi</span>
                           </div>
                           <div className="bg-white/20 px-3 py-1 rounded-full text-[10px] font-black">SKOR: {(analysisResult.score*100).toFixed(0)}</div>
                        </div>
                        <p className="text-sm leading-relaxed italic opacity-90 relative z-10">"{analysisResult.rationale_tr}"</p>
                        <Brain size={120} className="absolute -right-4 -bottom-4 opacity-10 rotate-12" />
                      </div>
                    )}

                    {/* HABERLER WIDGET */}
                    <div className="space-y-3">
                       <div className="flex items-center space-x-2 text-slate-400">
                          <Newspaper size={14}/>
                          <span className="text-[9px] font-black uppercase tracking-widest">İLGİLİ HABERLER</span>
                       </div>
                       {news.length > 0 ? news.map((n, i) => (
                         <a key={i} href={n.url} target="_blank" className="block bg-slate-50 p-4 rounded-2xl border border-slate-100 hover:border-indigo-300 transition-colors">
                            <div className="text-xs font-bold leading-snug line-clamp-2">{n.title}</div>
                            <div className="flex items-center space-x-2 mt-2 opacity-40 text-[9px] font-black">
                               <Globe size={10}/>
                               <span className="uppercase">{n.source}</span>
                            </div>
                         </a>
                       )) : (
                         <div className="text-[10px] italic text-slate-400 font-bold uppercase py-4 text-center border-2 border-dashed border-slate-100 rounded-2xl">Bu varlık için güncel haber bulunamadı.</div>
                       )}
                    </div>
                  </>
                )}
              </div>
              <div className="p-6 bg-slate-50 border-t shrink-0">
                 <button onClick={() => setAnalyzingSymbol(null)} className="w-full py-4 bg-slate-900 text-white rounded-2xl font-black uppercase text-[10px] tracking-widest shadow-xl active:scale-95 transition-all">Anladım</button>
              </div>
           </div>
        </div>
      )}

      {/* BOTTOM NAV */}
      <nav className="fixed bottom-6 left-1/2 -translate-x-1/2 flex items-center bg-white/95 backdrop-blur-2xl border p-2 rounded-[2.5rem] shadow-2xl z-[100]">
         <button onClick={() => setActiveTab('radar')} className={`flex items-center justify-center space-x-2 h-14 rounded-[2rem] transition-all duration-500 ${activeTab === 'radar' ? 'w-32 bg-indigo-600 text-white' : 'w-14 text-slate-400'}`}>
            <ListFilter size={20} />
            {activeTab === 'radar' && <span className="text-[10px] font-black uppercase tracking-widest">Radar</span>}
         </button>
         <div className="w-[1px] h-6 bg-slate-200 mx-2" />
         <button onClick={() => setActiveTab('stats')} className={`flex items-center justify-center space-x-2 h-14 rounded-[2rem] transition-all duration-500 ${activeTab === 'stats' ? 'w-32 bg-indigo-600 text-white' : 'w-14 text-slate-400'}`}>
            <Activity size={20} />
            {activeTab === 'stats' && <span className="text-[10px] font-black uppercase tracking-widest">Analiz</span>}
         </button>
      </nav>

      {/* SETTINGS (NOTIFICATION & WIDGET CONFIG) */}
      {isSettingsOpen && (
        <div className="fixed inset-0 z-[400] flex items-end lg:items-center justify-center bg-slate-900/60 backdrop-blur-md">
           <div className="bg-white w-full max-w-xl rounded-t-[3rem] lg:rounded-[3.5rem] p-8 shadow-3xl animate-in slide-in-from-bottom duration-500">
              <div className="flex justify-between items-center mb-8">
                 <h3 className="font-black text-xl uppercase tracking-tighter italic">Sentinel Ayarlar</h3>
                 <button onClick={()=>setIsSettingsOpen(false)} className="p-3 bg-slate-50 rounded-2xl hover:bg-red-50 hover:text-red-500 transition-colors"><X size={20}/></button>
              </div>
              <div className="space-y-6">
                 <div className="bg-slate-50 p-6 rounded-3xl border flex items-center justify-between">
                    <div>
                       <span className="text-xs font-black uppercase block">Web Bildirim Widget</span>
                       <p className="text-[10px] text-slate-400 font-bold italic">Arka planda anlık sinyaller için.</p>
                    </div>
                    <div 
                      onClick={async () => {
                         const enabled = !userSettings.isWebNotificationEnabled;
                         if (enabled) {
                           const res = await Notification.requestPermission();
                           if (res === "granted") setUserSettings({...userSettings, isWebNotificationEnabled: true});
                         } else setUserSettings({...userSettings, isWebNotificationEnabled: false});
                      }}
                      className={`w-12 h-6 rounded-full cursor-pointer relative transition-all ${userSettings.isWebNotificationEnabled ? 'bg-indigo-600' : 'bg-slate-300'}`}
                    >
                       <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${userSettings.isWebNotificationEnabled ? 'left-7' : 'left-1'}`} />
                    </div>
                 </div>
                 <div className="space-y-4">
                    <input type="password" value={userSettings.telegramBotToken} onChange={e=>setUserSettings({...userSettings, telegramBotToken: e.target.value})} placeholder="Telegram Token" className="w-full bg-slate-50 border rounded-xl p-4 text-sm font-mono focus:bg-white outline-none"/>
                    <input type="text" value={userSettings.telegramChatId} onChange={e=>setUserSettings({...userSettings, telegramChatId: e.target.value})} placeholder="Chat ID" className="w-full bg-slate-50 border rounded-xl p-4 text-sm font-mono focus:bg-white outline-none"/>
                 </div>
                 <button onClick={()=>setIsSettingsOpen(false)} className="w-full py-5 bg-indigo-600 text-white rounded-2xl font-black uppercase text-[10px] tracking-widest shadow-xl">DEĞİŞİKLİKLERİ KAYDET</button>
              </div>
           </div>
        </div>
      )}
    </div>
  );
};

export default App;
