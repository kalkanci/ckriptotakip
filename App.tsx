
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { 
  Settings, Zap, Activity, X, 
  Terminal, ListFilter, Cpu, Bell, 
  ArrowUpRight, ArrowDownRight, Info, Gauge, 
  Search, Brain, ShieldAlert, Target, Loader2,
  BarChart3, Layers, BookOpen, MessageSquare,
  History, Smartphone, BellRing, Layout, Globe,
  BarChart, TrendingUp, Newspaper, HelpCircle
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
  const [history4h, setHistory4h] = useState<Kline[]>([]);
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
      new Notification(`🚀 SENTINEL: ${symbol} %${change.toFixed(1)} FIRLADI!`, {
        body: `Futures marketinde sert yükseliş var!`,
        icon: 'https://cdn-icons-png.flaticon.com/512/2091/2091665.png',
        tag: symbol
      }).onclick = () => { window.focus(); handleQuickAnalysis(symbol); };
    }
  };

  const handleQuickAnalysis = async (symbol: string) => {
    setIsAnalyzing(true);
    setAnalyzingSymbol(symbol);
    setAnalysisResult(null);
    setFuturesMetrics(null);
    try {
      const [history1m, h4, futures] = await Promise.all([
        binanceService.getHistory(symbol, '1m', 100),
        binanceService.getHistory(symbol, '4h', 5),
        binanceService.getFuturesMetrics(symbol)
      ]);
      setHistory4h(h4);
      setFuturesMetrics(futures);
      const ticker = tickerBuffer.current[symbol];
      if (ticker) {
        const result = await llmService.analyzePump(ticker, history1m);
        setAnalysisResult(result);
      }
    } catch (error) {
      addLog(`Analiz sırasında bir sorun çıktı.`, 'WARNING');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const sendTelegramNotification = async (symbol: string, change: number, price: number) => {
    triggerWebNotification(symbol, change);
    if (!userSettings.telegramBotToken || !userSettings.telegramChatId || !userSettings.isNotificationEnabled) return;
    const now = Date.now();
    if (alertedCoins.current[symbol] && (now - alertedCoins.current[symbol] < 15 * 60 * 1000)) return;

    try {
      const message = `🚨 *${symbol} FUTURES FIRLADI*\n` +
                      `📈 Artış: %${change.toFixed(1)}\n` +
                      `💵 Fiyat: ${price}\n` +
                      `🔥 USD-M Vadeli İşlemler Radarı`;

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
          const change = parseFloat(t.P); // Price change percent
          tickerBuffer.current[t.s] = { 
            symbol: t.s, 
            lastPrice: parseFloat(t.c), 
            priceChangePercent: change, 
            high: parseFloat(t.h), 
            low: parseFloat(t.l), 
            volume: parseFloat(t.q) // Futures quote volume
          };
          if (change >= userSettings.buyJumpThreshold) {
            sendTelegramNotification(t.s, change, parseFloat(t.c));
          }
        });
      }
    });
    const loop = setInterval(() => {
      // Sadece %30 ve üzeri yükselenleri göster
      const top = (Object.values(tickerBuffer.current) as MarketTicker[])
        .filter(c => c.priceChangePercent >= 30)
        .sort((a, b) => b.priceChangePercent - a.priceChangePercent)
        .slice(0, 50);
      setScanningData(top);
    }, 1000);
    return () => { clearInterval(loop); unsub(); binanceService.disconnect(); };
  }, [userSettings.buyJumpThreshold]);

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
          <div className="w-10 h-10 bg-emerald-600 rounded-xl flex items-center justify-center text-white font-black shadow-lg shadow-emerald-200">F</div>
          <div>
            <span className="font-black text-sm uppercase tracking-tighter block">USD-M FUTURES RADAR</span>
            <span className="text-[9px] font-bold text-emerald-600 uppercase tracking-widest">Vadeli Pump Takibi (%30+)</span>
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
              <div className="col-span-full flex flex-col items-center justify-center py-20 text-slate-400">
                <Loader2 className="animate-spin mb-4" size={32} />
                <span className="text-xs font-black uppercase tracking-widest text-center">FUTURES MARKETİ TARANIYOR...<br/>HENÜZ %30 ÜSTÜ PUMP YOK</span>
              </div>
            ) : (
              scanningData.map((c) => (
                <div 
                  key={c.symbol} 
                  className={`bg-gradient-to-br ${getCardColor(c.priceChangePercent)} rounded-[2rem] p-6 shadow-xl shadow-emerald-900/10 transition-all active:scale-95 cursor-pointer relative overflow-hidden`}
                  onClick={() => handleQuickAnalysis(c.symbol)}
                >
                  <div className="flex justify-between items-start relative z-10">
                    <div>
                      <span className="font-black text-2xl uppercase tracking-tighter">{c.symbol.replace('USDT','')}</span>
                      <div className="text-xs font-bold opacity-80 mt-1">Fiyat: ${c.lastPrice}</div>
                    </div>
                    <div className="text-3xl font-black italic tracking-tighter">%{c.priceChangePercent.toFixed(0)}</div>
                  </div>
                  
                  {/* KART ÜZERİ BİLGİLERİ */}
                  <div className="mt-4 grid grid-cols-2 gap-2 relative z-10">
                    <div className="bg-white/20 backdrop-blur-md px-3 py-2 rounded-xl">
                      <div className="text-[8px] font-black uppercase opacity-60">Hacim</div>
                      <div className="text-[10px] font-black">${(c.volume / 1000000).toFixed(1)}M</div>
                    </div>
                    <div className="bg-white/20 backdrop-blur-md px-3 py-2 rounded-xl">
                      <div className="text-[8px] font-black uppercase opacity-60">Durum</div>
                      <div className="text-[10px] font-black">Sert Yükseliş</div>
                    </div>
                  </div>

                  <div className="mt-4 flex items-center justify-between relative z-10">
                    <div className="text-[9px] font-black uppercase tracking-widest opacity-70">USD-M Vadeli</div>
                    <div className="flex items-center space-x-1 text-[9px] font-black uppercase bg-black/10 px-2 py-1 rounded-lg">
                      <Brain size={10} />
                      <span>Analiz</span>
                    </div>
                  </div>

                  <div className="absolute -right-4 -bottom-4 opacity-10">
                    <TrendingUp size={120} />
                  </div>
                </div>
              ))
            )}
          </div>
        ) : (
          <div className="max-w-md mx-auto space-y-4">
            <div className="bg-white rounded-[2.5rem] p-8 border border-slate-200 shadow-sm text-center">
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">FUTURES ALARMLARI</span>
              <div className="text-7xl font-black text-emerald-600 italic tracking-tighter">{alertCount}</div>
            </div>
            <div className="bg-slate-900 rounded-[2rem] p-6 text-[11px] font-mono text-emerald-400/60 space-y-3">
              {logs.map(log => (
                <div key={log.id} className="leading-tight border-b border-white/5 pb-2 last:border-0">
                  <span className="opacity-30">[{log.timestamp}]</span> {log.message}
                </div>
              ))}
            </div>
          </div>
        )}
      </main>

      {/* ANALYSIS MODAL */}
      {(analyzingSymbol || isAnalyzing) && (
        <div className="fixed inset-0 z-[300] bg-slate-900/80 backdrop-blur-xl flex items-center justify-center p-4">
           <div className="bg-white w-full max-w-lg rounded-[3.5rem] overflow-hidden shadow-3xl flex flex-col max-h-[90vh] animate-in zoom-in duration-300 border border-white/20">
              <div className="p-8 border-b flex justify-between items-center bg-slate-50/80">
                 <div>
                    <h3 className="font-black text-2xl uppercase tracking-tighter text-slate-900">{analyzingSymbol}</h3>
                    <div className="flex items-center space-x-2 mt-1">
                       <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
                       <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">AKILLI RADAR</span>
                    </div>
                 </div>
                 <button onClick={() => setAnalyzingSymbol(null)} className="p-3 bg-white border border-slate-100 rounded-2xl text-slate-400 hover:text-red-500 transition-all"><X size={24}/></button>
              </div>

              <div className="flex-1 overflow-y-auto p-8 space-y-8 custom-scrollbar">
                {isAnalyzing ? (
                  <div className="flex flex-col items-center py-20">
                    <Loader2 className="animate-spin text-emerald-600 mb-6" size={48} />
                    <span className="text-sm font-black uppercase tracking-[0.2em] text-slate-400">Futures Verileri Çekiliyor...</span>
                  </div>
                ) : (
                  <>
                    <div className="bg-slate-50 p-6 rounded-[2rem] border border-slate-100">
                       <div className="flex items-center space-x-2 mb-4 text-slate-400">
                          <History size={16} />
                          <span className="text-[10px] font-black uppercase tracking-widest">4 SAATLİK MUM ÖZETİ</span>
                       </div>
                       <div className="space-y-3">
                          {history4h.slice(0, 5).reverse().map((k, i) => {
                            const change = ((k.close - k.open) / k.open * 100);
                            return (
                              <div key={i} className="flex justify-between items-center bg-white p-3 rounded-xl border border-slate-50 shadow-sm">
                                <span className="text-[10px] font-bold text-slate-400 uppercase italic">{i === 0 ? 'ŞİMDİ' : `${i*4}S Önce`}</span>
                                <span className={`text-xs font-black ${change >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                                  %{change >= 0 ? '+' : ''}{change.toFixed(1)}
                                </span>
                              </div>
                            );
                          })}
                       </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                       <div className="bg-emerald-50 p-6 rounded-3xl border border-emerald-100 shadow-sm">
                          <span className="text-[9px] font-black text-emerald-600 uppercase block mb-1 tracking-widest">AÇIK POZİSYONLAR</span>
                          <div className="text-lg font-black text-emerald-900">${(futuresMetrics?.openInterest || 0).toLocaleString()}</div>
                          <p className="text-[8px] font-bold text-emerald-700/60 uppercase mt-1 italic">VADELİ İLGİSİ</p>
                       </div>
                       <div className={`p-6 rounded-3xl border shadow-sm ${ (futuresMetrics?.fundingRate || 0) > 0 ? 'bg-red-50 border-red-100' : 'bg-blue-50 border-blue-100'}`}>
                          <span className={`text-[9px] font-black uppercase block mb-1 tracking-widest ${ (futuresMetrics?.fundingRate || 0) > 0 ? 'text-red-600' : 'text-blue-600'}`}>FONLAMA ORANI</span>
                          <div className={`text-lg font-black ${ (futuresMetrics?.fundingRate || 0) > 0 ? 'text-red-900' : 'text-blue-900'}`}>
                             %{((futuresMetrics?.fundingRate || 0) * 100).toFixed(4)}
                          </div>
                          <p className={`text-[8px] font-bold uppercase mt-1 italic ${ (futuresMetrics?.fundingRate || 0) > 0 ? 'text-red-700/60' : 'text-blue-700/60'}`}>DENGE PUANI</p>
                       </div>
                    </div>

                    {analysisResult && (
                      <div className="bg-slate-900 rounded-[2.5rem] p-8 text-white relative overflow-hidden shadow-2xl">
                        <div className="flex justify-between items-center mb-6 relative z-10">
                           <div className="flex items-center space-x-2">
                              <Brain size={20} className="text-emerald-400" />
                              <span className="text-[10px] font-black uppercase tracking-widest">AI GÖRÜŞÜ</span>
                           </div>
                           <div className="bg-emerald-500 text-white px-4 py-1.5 rounded-full text-xs font-black shadow-lg">
                             {(analysisResult.score*100).toFixed(0)}
                           </div>
                        </div>
                        <p className="text-sm leading-relaxed italic opacity-90 relative z-10 font-medium">
                          "{analysisResult.rationale_tr}"
                        </p>
                        <Brain size={150} className="absolute -right-8 -bottom-8 opacity-5 rotate-12" />
                      </div>
                    )}
                  </>
                )}
              </div>
              <div className="p-8 bg-slate-50 border-t shrink-0">
                 <button onClick={() => setAnalyzingSymbol(null)} className="w-full py-5 bg-emerald-600 text-white rounded-[1.5rem] font-black uppercase text-[11px] tracking-[0.2em] shadow-xl shadow-emerald-200 active:scale-95 transition-all">TAKİBİ KAPAT</button>
              </div>
           </div>
        </div>
      )}

      {/* BOTTOM NAV */}
      <nav className="fixed bottom-6 left-1/2 -translate-x-1/2 flex items-center bg-white/95 backdrop-blur-2xl border border-slate-100 p-2.5 rounded-[2.5rem] shadow-2xl z-[100]">
         <button onClick={() => setActiveTab('radar')} className={`flex items-center justify-center space-x-2 h-14 rounded-[2rem] transition-all duration-300 ${activeTab === 'radar' ? 'w-36 bg-emerald-600 text-white shadow-lg' : 'w-14 text-slate-400'}`}>
            <ListFilter size={20} />
            {activeTab === 'radar' && <span className="text-[11px] font-black uppercase tracking-widest">Radar</span>}
         </button>
         <div className="w-[1px] h-6 bg-slate-100 mx-3" />
         <button onClick={() => setActiveTab('stats')} className={`flex items-center justify-center space-x-2 h-14 rounded-[2rem] transition-all duration-300 ${activeTab === 'stats' ? 'w-36 bg-emerald-600 text-white shadow-lg' : 'w-14 text-slate-400'}`}>
            <Activity size={20} />
            {activeTab === 'stats' && <span className="text-[11px] font-black uppercase tracking-widest">Alarmlar</span>}
         </button>
      </nav>

      {/* SETTINGS */}
      {isSettingsOpen && (
        <div className="fixed inset-0 z-[400] flex items-end lg:items-center justify-center bg-slate-900/60 backdrop-blur-md">
           <div className="bg-white w-full max-w-xl rounded-t-[3.5rem] lg:rounded-[3.5rem] p-10 shadow-3xl animate-in slide-in-from-bottom duration-500">
              <div className="flex justify-between items-center mb-8">
                 <h3 className="font-black text-2xl uppercase tracking-tighter italic text-slate-900">Radar Ayarları</h3>
                 <button onClick={()=>setIsSettingsOpen(false)} className="p-3 bg-slate-50 rounded-2xl hover:bg-red-50 hover:text-red-500 transition-all"><X size={24}/></button>
              </div>
              <div className="space-y-8">
                 <div className="bg-slate-50 p-6 rounded-[2rem] border border-slate-100 flex items-center justify-between">
                    <div>
                       <span className="text-xs font-black uppercase block text-slate-900">Bildirimler</span>
                       <p className="text-[10px] text-slate-400 font-bold italic mt-1 uppercase tracking-widest">Sinyal Geldiğinde Uyar</p>
                    </div>
                    <div 
                      onClick={async () => {
                         const enabled = !userSettings.isWebNotificationEnabled;
                         if (enabled) {
                           const res = await Notification.requestPermission();
                           if (res === "granted") setUserSettings({...userSettings, isWebNotificationEnabled: true});
                         } else setUserSettings({...userSettings, isWebNotificationEnabled: false});
                      }}
                      className={`w-14 h-7 rounded-full cursor-pointer relative transition-all duration-300 ${userSettings.isWebNotificationEnabled ? 'bg-emerald-500' : 'bg-slate-300'}`}
                    >
                       <div className={`absolute top-1 w-5 h-5 bg-white rounded-full shadow-sm transition-all duration-300 ${userSettings.isWebNotificationEnabled ? 'left-8' : 'left-1'}`} />
                    </div>
                 </div>
                 <div className="space-y-4">
                    <input type="password" value={userSettings.telegramBotToken} onChange={e=>setUserSettings({...userSettings, telegramBotToken: e.target.value})} placeholder="Telegram Bot Token" className="w-full bg-slate-50 border border-slate-100 rounded-2xl p-5 text-sm font-mono focus:bg-white outline-none"/>
                    <input type="text" value={userSettings.telegramChatId} onChange={e=>setUserSettings({...userSettings, telegramChatId: e.target.value})} placeholder="Sohbet ID" className="w-full bg-slate-50 border border-slate-100 rounded-2xl p-5 text-sm font-mono focus:bg-white outline-none"/>
                 </div>
                 <button onClick={()=>setIsSettingsOpen(false)} className="w-full py-6 bg-emerald-600 text-white rounded-[1.5rem] font-black uppercase text-xs tracking-[0.3em] shadow-2xl shadow-emerald-200 active:scale-95 transition-all">AYARLARI KAYDET</button>
              </div>
           </div>
        </div>
      )}
    </div>
  );
};

export default App;
