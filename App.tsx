
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { 
  Settings, Zap, Activity, X, 
  Terminal, ListFilter, Cpu, Bell, 
  ArrowUpRight, ArrowDownRight, Info, Gauge, 
  Search, Brain, ShieldAlert, Target, Loader2,
  BarChart3, Layers, BookOpen, MessageSquare,
  History, Smartphone, BellRing, Layout, Globe,
  BarChart, TrendingUp, Newspaper, HelpCircle,
  Clock
} from 'lucide-react';
import { OrderLog, MarketTicker, UserSettings, LLMAnalysis, Kline, NewsItem, FuturesMetrics } from './types';
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

  const [activeTab, setActiveTab] = useState<'radar' | 'stats'>('radar');
  const [logs, setLogs] = useState<OrderLog[]>(() => JSON.parse(localStorage.getItem('sentinel_pro_logs') || '[]'));
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [scanningData, setScanningData] = useState<MarketTicker[]>([]);
  const [analyzingSymbol, setAnalyzingSymbol] = useState<string | null>(null);
  const [analysisResult, setAnalysisResult] = useState<LLMAnalysis | null>(null);
  const [history15m, setHistory15m] = useState<Kline[]>([]);
  const [futuresMetrics, setFuturesMetrics] = useState<FuturesMetrics | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [alertCount, setAlertCount] = useState(() => Number(localStorage.getItem('sentinel_alert_count') || 0));
  
  // Telegram mesaj takibi için: Symbol -> MessageID
  const activeTelegramAlerts = useRef<Record<string, number>>({});
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
      new Notification(`🚀 SENTINEL: ${symbol} %${change.toFixed(1)}!`, {
        body: `Fiyat takibi güncellendi.`,
        icon: 'https://cdn-icons-png.flaticon.com/512/2091/2091665.png',
        tag: symbol
      }).onclick = () => { window.focus(); handleQuickAnalysis(symbol); };
    }
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
      addLog(`Analiz hatası: ${symbol}`, 'WARNING');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const updateTelegramMessage = async (symbol: string, change: number, price: number) => {
    if (!userSettings.telegramBotToken || !userSettings.telegramChatId || !userSettings.isNotificationEnabled) return;
    
    const messageId = activeTelegramAlerts.current[symbol];
    const text = `🚨 *${symbol} TAKİBİ GÜNCELLENDİ*\n\n` +
                 `📈 Güncel Artış: %${change.toFixed(2)}\n` +
                 `💵 Anlık Fiyat: $${price}\n` +
                 `⏰ Son Güncelleme: ${new Date().toLocaleTimeString('tr-TR')}\n\n` +
                 `🔥 USD-M Futures Pompalanıyor!`;

    try {
      if (messageId) {
        // Mevcut mesajı güncelle
        const editUrl = `https://api.telegram.org/bot${userSettings.telegramBotToken}/editMessageText`;
        const res = await fetch(editUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: userSettings.telegramChatId,
            message_id: messageId,
            text: text,
            parse_mode: 'Markdown'
          })
        });
        
        // Eğer mesaj silinmişse veya hata varsa (örn. fiyat düştü bitti)
        if (!res.ok) {
           delete activeTelegramAlerts.current[symbol];
        }
      } else {
        // Yeni mesaj gönder
        const sendUrl = `https://api.telegram.org/bot${userSettings.telegramBotToken}/sendMessage`;
        const res = await fetch(sendUrl, {
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
          activeTelegramAlerts.current[symbol] = data.result.message_id;
          setAlertCount(prev => prev + 1);
          triggerWebNotification(symbol, change);
        }
      }
    } catch (e) {
      console.error("Telegram error", e);
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
          
          tickerBuffer.current[t.s] = { 
            symbol: t.s, 
            lastPrice: price, 
            priceChangePercent: change, 
            high: parseFloat(t.h), 
            low: parseFloat(t.l), 
            volume: parseFloat(t.q) 
          };

          // %30 ve üstünde sürekli güncelleme yap
          if (change >= userSettings.buyJumpThreshold) {
            updateTelegramMessage(t.s, change, price);
          } else if (activeTelegramAlerts.current[t.s]) {
            // Fiyat eşiğin altına düşerse takibi bırak (isteğe bağlı olarak final mesajı atılabilir)
            delete activeTelegramAlerts.current[t.s];
          }
        });
      }
    });

    const loop = setInterval(() => {
      const top = (Object.values(tickerBuffer.current) as MarketTicker[])
        .filter(c => c.priceChangePercent >= 30)
        .sort((a, b) => b.priceChangePercent - a.priceChangePercent)
        .slice(0, 50);
      setScanningData(top);
    }, 1000);

    return () => { clearInterval(loop); unsub(); binanceService.disconnect(); };
  }, [userSettings.buyJumpThreshold, userSettings.telegramBotToken, userSettings.telegramChatId]);

  const getCardColor = (percent: number) => {
    if (percent >= 100) return 'from-emerald-700 to-emerald-600 text-white';
    if (percent >= 70) return 'from-emerald-600 to-emerald-500 text-white';
    if (percent >= 50) return 'from-emerald-500 to-emerald-400 text-white';
    return 'from-emerald-400 to-emerald-300 text-emerald-950';
  };

  return (
    <div className="flex flex-col h-screen bg-[#F0F4F8] text-slate-900 overflow-hidden font-sans">
      {/* HEADER */}
      <header className="h-16 bg-white border-b flex items-center justify-between px-6 shrink-0 shadow-sm z-50">
        <div className="flex items-center space-x-2">
          <div className="w-10 h-10 bg-emerald-600 rounded-xl flex items-center justify-center text-white font-black shadow-lg shadow-emerald-200 animate-pulse">S</div>
          <div>
            <span className="font-black text-sm uppercase tracking-tighter block">SENTINEL LIVE</span>
            <span className="text-[9px] font-bold text-emerald-600 uppercase tracking-widest">Anlık Futures Takibi</span>
          </div>
        </div>
        <div className="flex items-center space-x-3">
          <button onClick={() => setIsSettingsOpen(true)} className="p-2.5 bg-slate-50 border rounded-2xl hover:bg-slate-100 transition-all">
            <Settings size={20} className="text-slate-400" />
          </button>
        </div>
      </header>

      {/* RADAR LIST */}
      <main className="flex-1 overflow-y-auto px-4 pt-4 pb-28 custom-scrollbar">
        {activeTab === 'radar' ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {scanningData.length === 0 ? (
              <div className="col-span-full flex flex-col items-center justify-center py-24 text-slate-400 bg-white/50 rounded-[3rem] border-2 border-dashed border-slate-200">
                <Loader2 className="animate-spin mb-4 text-emerald-500" size={40} />
                <span className="text-sm font-black uppercase tracking-widest text-center">BÜYÜK HAREKETLİLİK BEKLENİYOR...<br/><span className="text-[10px] opacity-60 italic">%30 Altındaki Coinler Listelenmez</span></span>
              </div>
            ) : (
              scanningData.map((c) => (
                <div 
                  key={c.symbol} 
                  className={`bg-gradient-to-br ${getCardColor(c.priceChangePercent)} rounded-[2.5rem] p-6 shadow-2xl shadow-emerald-900/10 transition-all active:scale-95 cursor-pointer relative overflow-hidden group`}
                  onClick={() => handleQuickAnalysis(c.symbol)}
                >
                  <div className="flex justify-between items-start relative z-10">
                    <div>
                      <span className="font-black text-2xl uppercase tracking-tighter group-hover:tracking-normal transition-all">{c.symbol.replace('USDT','')}</span>
                      <div className="text-xs font-bold opacity-80 mt-1 italic">${c.lastPrice}</div>
                    </div>
                    <div className="text-4xl font-black italic tracking-tighter animate-in slide-in-from-right duration-500">%{c.priceChangePercent.toFixed(0)}</div>
                  </div>
                  
                  <div className="mt-6 grid grid-cols-2 gap-3 relative z-10">
                    <div className="bg-white/10 backdrop-blur-md px-4 py-3 rounded-2xl border border-white/5">
                      <div className="text-[9px] font-black uppercase opacity-60">Piyasa Hacmi</div>
                      <div className="text-xs font-black">${(c.volume / 1000000).toFixed(1)}M</div>
                    </div>
                    <div className="bg-white/10 backdrop-blur-md px-4 py-3 rounded-2xl border border-white/5 flex items-center justify-center">
                       <Zap size={20} className="animate-bounce" />
                    </div>
                  </div>

                  <div className="mt-4 flex items-center justify-between relative z-10">
                    <div className="text-[10px] font-black uppercase tracking-widest opacity-80 flex items-center">
                      <Clock size={12} className="mr-1" /> CANLI VERİ
                    </div>
                    <div className="flex items-center space-x-1 text-[10px] font-black uppercase bg-black/20 px-3 py-1.5 rounded-full backdrop-blur-md">
                      <Brain size={12} />
                      <span>AKILLI ANALİZ</span>
                    </div>
                  </div>

                  <div className="absolute -right-6 -bottom-6 opacity-5 group-hover:opacity-10 transition-opacity">
                    <TrendingUp size={160} />
                  </div>
                </div>
              ))
            )}
          </div>
        ) : (
          <div className="max-w-md mx-auto space-y-4">
            <div className="bg-white rounded-[3rem] p-10 border border-slate-200 shadow-xl text-center">
              <span className="text-[11px] font-black text-slate-400 uppercase tracking-[0.3em] block mb-2">YAKALANAN PUMP SAYISI</span>
              <div className="text-8xl font-black text-emerald-600 italic tracking-tighter drop-shadow-sm">{alertCount}</div>
            </div>
            <div className="bg-slate-900 rounded-[2.5rem] p-8 text-[11px] font-mono text-emerald-400/70 space-y-4 shadow-2xl">
               <div className="flex items-center justify-between border-b border-white/5 pb-4">
                  <span className="uppercase tracking-widest font-black text-white/40 flex items-center"><Terminal size={14} className="mr-2"/> Sistem Kayıtları</span>
                  <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
               </div>
               <div className="space-y-2 max-h-64 overflow-y-auto custom-scrollbar pr-2">
                {logs.length === 0 ? <div className="italic opacity-30">Henüz bir hareketlilik kaydedilmedi. Radar aktif, büyük yükselişler bekleniyor...</div> : logs.map(log => (
                  <div key={log.id} className="leading-tight border-l-2 border-emerald-500/20 pl-3 py-1">
                    <span className="opacity-30 text-[9px]">[{log.timestamp}]</span> {log.message}
                  </div>
                ))}
               </div>
            </div>
          </div>
        )}
      </main>

      {/* ANALYSIS MODAL (SIMPLIFIED FOR USER) */}
      {(analyzingSymbol || isAnalyzing) && (
        <div className="fixed inset-0 z-[300] bg-slate-900/90 backdrop-blur-2xl flex items-center justify-center p-4">
           <div className="bg-white w-full max-w-lg rounded-[4rem] overflow-hidden shadow-3xl flex flex-col max-h-[90vh] animate-in zoom-in duration-300 border border-white/20">
              <div className="p-10 border-b flex justify-between items-center bg-slate-50/50">
                 <div>
                    <h3 className="font-black text-3xl uppercase tracking-tighter text-slate-900">{analyzingSymbol}</h3>
                    <div className="flex items-center space-x-2 mt-1">
                       <div className="w-2.5 h-2.5 bg-emerald-500 rounded-full animate-ping" />
                       <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">AKILLI RADAR ASİSTANI</span>
                    </div>
                 </div>
                 <button onClick={() => setAnalyzingSymbol(null)} className="p-4 bg-white border border-slate-100 rounded-3xl text-slate-400 hover:text-red-500 hover:rotate-90 transition-all duration-300"><X size={28}/></button>
              </div>

              <div className="flex-1 overflow-y-auto p-10 space-y-10 custom-scrollbar">
                {isAnalyzing ? (
                  <div className="flex flex-col items-center py-24">
                    <Loader2 className="animate-spin text-emerald-600 mb-8" size={60} />
                    <span className="text-base font-black uppercase tracking-[0.3em] text-slate-400">Veriler Hazırlanıyor...</span>
                  </div>
                ) : (
                  <>
                    {/* BASİT 15 DK FİYAT GEÇMİŞİ */}
                    <div className="bg-slate-50 p-8 rounded-[2.5rem] border border-slate-100 shadow-inner">
                       <div className="flex items-center justify-between mb-6 text-slate-400">
                          <div className="flex items-center space-x-2">
                             <Clock size={18} />
                             <span className="text-[11px] font-black uppercase tracking-widest">15 DAKİKALIK FİYAT TAKİBİ</span>
                          </div>
                          <span className="text-[9px] font-black opacity-40 uppercase">SON 5 KAYIT</span>
                       </div>
                       <div className="space-y-4">
                          {history15m.length > 0 ? history15m.map((k, i) => {
                            const change = ((k.close - k.open) / k.open * 100);
                            return (
                              <div key={i} className="flex justify-between items-center bg-white p-5 rounded-2xl border border-slate-50 shadow-sm transform hover:scale-[1.02] transition-transform">
                                <span className="text-[11px] font-black text-slate-400 uppercase italic">{i === 0 ? 'ŞİMDİ' : `${i*15} DK ÖNCE`}</span>
                                <div className="text-right">
                                   <div className="text-sm font-black text-slate-900 font-mono">${k.close}</div>
                                   <span className={`text-[10px] font-black ${change >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                                     %{change >= 0 ? '+' : ''}{change.toFixed(2)}
                                   </span>
                                </div>
                              </div>
                            );
                          }) : (
                             <div className="text-center py-4 text-xs italic text-slate-400">Fiyat bilgisi yüklenemedi.</div>
                          )}
                       </div>
                    </div>

                    <div className="grid grid-cols-2 gap-6">
                       <div className="bg-emerald-50 p-8 rounded-[2.5rem] border border-emerald-100 shadow-sm text-center">
                          <span className="text-[10px] font-black text-emerald-600 uppercase block mb-2 tracking-[0.2em]">PİYASA İLGİSİ</span>
                          <div className="text-2xl font-black text-emerald-900">${(futuresMetrics?.openInterest || 0).toLocaleString()}</div>
                       </div>
                       <div className={`p-8 rounded-[2.5rem] border shadow-sm text-center ${ (futuresMetrics?.fundingRate || 0) > 0 ? 'bg-red-50 border-red-100' : 'bg-blue-50 border-blue-100'}`}>
                          <span className={`text-[10px] font-black uppercase block mb-2 tracking-[0.2em] ${ (futuresMetrics?.fundingRate || 0) > 0 ? 'text-red-600' : 'text-blue-600'}`}>DENGE PUANI</span>
                          <div className={`text-2xl font-black ${ (futuresMetrics?.fundingRate || 0) > 0 ? 'text-red-900' : 'text-blue-900'}`}>
                             %{((futuresMetrics?.fundingRate || 0) * 100).toFixed(4)}
                          </div>
                       </div>
                    </div>

                    {/* AI ANALİZİ (BASİTLEŞTİRİLMİŞ) */}
                    {analysisResult && (
                      <div className="bg-slate-900 rounded-[3rem] p-10 text-white relative overflow-hidden shadow-2xl ring-4 ring-emerald-500/10">
                        <div className="flex justify-between items-center mb-8 relative z-10">
                           <div className="flex items-center space-x-3">
                              <Brain size={24} className="text-emerald-400" />
                              <span className="text-[11px] font-black uppercase tracking-[0.3em]">AI ANALİZ RAPORU</span>
                           </div>
                           <div className="bg-emerald-500 text-white px-5 py-2 rounded-full text-sm font-black shadow-lg shadow-emerald-500/20">
                             SKOR: {(analysisResult.score*100).toFixed(0)}
                           </div>
                        </div>
                        <p className="text-base leading-relaxed italic opacity-90 relative z-10 font-medium">
                          "{analysisResult.rationale_tr}"
                        </p>
                        <div className="mt-8 flex items-center space-x-2 opacity-30 relative z-10">
                           <HelpCircle size={14} />
                           <span className="text-[10px] font-black uppercase tracking-widest italic">Yatırım tavsiyesi değildir.</span>
                        </div>
                        <Brain size={180} className="absolute -right-12 -bottom-12 opacity-5 rotate-12" />
                      </div>
                    )}
                  </>
                )}
              </div>
              <div className="p-10 bg-slate-50 border-t shrink-0">
                 <button onClick={() => setAnalyzingSymbol(null)} className="w-full py-6 bg-emerald-600 text-white rounded-[2rem] font-black uppercase text-xs tracking-[0.4em] shadow-2xl shadow-emerald-500/30 active:scale-95 transition-all hover:bg-emerald-700">TAKİBİ SONLANDIR</button>
              </div>
           </div>
        </div>
      )}

      {/* BOTTOM NAV */}
      <nav className="fixed bottom-8 left-1/2 -translate-x-1/2 flex items-center bg-white/90 backdrop-blur-3xl border border-white/20 p-3 rounded-[3rem] shadow-[0_25px_50px_-12px_rgba(0,0,0,0.15)] z-[100] ring-1 ring-black/5">
         <button onClick={() => setActiveTab('radar')} className={`flex items-center justify-center space-x-3 h-16 rounded-[2.5rem] transition-all duration-500 ${activeTab === 'radar' ? 'w-44 bg-emerald-600 text-white shadow-xl shadow-emerald-500/20' : 'w-16 text-slate-400 hover:text-slate-600'}`}>
            <ListFilter size={24} />
            {activeTab === 'radar' && <span className="text-xs font-black uppercase tracking-widest">Canlı Radar</span>}
         </button>
         <div className="w-[1px] h-8 bg-slate-100 mx-4" />
         <button onClick={() => setActiveTab('stats')} className={`flex items-center justify-center space-x-3 h-16 rounded-[2.5rem] transition-all duration-500 ${activeTab === 'stats' ? 'w-44 bg-emerald-600 text-white shadow-xl shadow-emerald-500/20' : 'w-16 text-slate-400 hover:text-slate-600'}`}>
            <Activity size={24} />
            {activeTab === 'stats' && <span className="text-xs font-black uppercase tracking-widest">Raporlar</span>}
         </button>
      </nav>

      {/* SETTINGS */}
      {isSettingsOpen && (
        <div className="fixed inset-0 z-[400] flex items-end lg:items-center justify-center bg-slate-900/70 backdrop-blur-md">
           <div className="bg-white w-full max-w-xl rounded-t-[4rem] lg:rounded-[4rem] p-12 shadow-3xl animate-in slide-in-from-bottom duration-500 border border-white/20">
              <div className="flex justify-between items-center mb-10">
                 <h3 className="font-black text-3xl uppercase tracking-tighter italic text-slate-900">Ayarlar</h3>
                 <button onClick={()=>setIsSettingsOpen(false)} className="p-4 bg-slate-50 rounded-3xl hover:bg-red-50 hover:text-red-500 hover:rotate-90 transition-all duration-300"><X size={28}/></button>
              </div>
              <div className="space-y-10">
                 <div className="bg-slate-50 p-8 rounded-[2.5rem] border border-slate-100 flex items-center justify-between shadow-inner">
                    <div>
                       <span className="text-sm font-black uppercase block text-slate-900 tracking-wider">Anlık Bildirimler</span>
                       <p className="text-[11px] text-slate-400 font-bold italic mt-1 uppercase tracking-widest">Büyük Hareketlerde Uyar</p>
                    </div>
                    <div 
                      onClick={async () => {
                         const enabled = !userSettings.isWebNotificationEnabled;
                         if (enabled) {
                           const res = await Notification.requestPermission();
                           if (res === "granted") setUserSettings({...userSettings, isWebNotificationEnabled: true});
                         } else setUserSettings({...userSettings, isWebNotificationEnabled: false});
                      }}
                      className={`w-16 h-8 rounded-full cursor-pointer relative transition-all duration-500 ${userSettings.isWebNotificationEnabled ? 'bg-emerald-500 shadow-lg shadow-emerald-500/30' : 'bg-slate-300'}`}
                    >
                       <div className={`absolute top-1 w-6 h-6 bg-white rounded-full shadow-md transition-all duration-500 ${userSettings.isWebNotificationEnabled ? 'left-9' : 'left-1'}`} />
                    </div>
                 </div>
                 <div className="space-y-6">
                    <div className="relative group">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 block px-2">Telegram Bot Token</label>
                        <input type="password" value={userSettings.telegramBotToken} onChange={e=>setUserSettings({...userSettings, telegramBotToken: e.target.value})} placeholder="Bot Token" className="w-full bg-slate-50 border border-slate-100 rounded-3xl p-6 text-sm font-mono focus:bg-white focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/5 outline-none transition-all shadow-sm"/>
                    </div>
                    <div className="relative group">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 block px-2">Sohbet (Chat) ID</label>
                        <input type="text" value={userSettings.telegramChatId} onChange={e=>setUserSettings({...userSettings, telegramChatId: e.target.value})} placeholder="Örn: -1001234567" className="w-full bg-slate-50 border border-slate-100 rounded-3xl p-6 text-sm font-mono focus:bg-white focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/5 outline-none transition-all shadow-sm"/>
                    </div>
                 </div>
                 <button onClick={()=>setIsSettingsOpen(false)} className="w-full py-7 bg-emerald-600 text-white rounded-[2rem] font-black uppercase text-xs tracking-[0.5em] shadow-2xl shadow-emerald-500/30 hover:bg-emerald-700 active:scale-95 transition-all">SİSTEMİ GÜNCELLE</button>
              </div>
           </div>
        </div>
      )}
    </div>
  );
};

export default App;
