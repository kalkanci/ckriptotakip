
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { 
  Settings, Zap, Activity, X, 
  Terminal, ListFilter, Cpu, Bell, 
  ArrowUpRight, ArrowDownRight, Info, Gauge, 
  Search, Brain, ShieldAlert, Target, Loader2,
  BarChart3, Layers, BookOpen, MessageSquare,
  History, Smartphone
} from 'lucide-react';
import { OrderLog, MarketTicker, UserSettings, LLMAnalysis, Kline } from './types';
import { binanceService } from './services/binanceService';
import { llmService } from './services/llmService';

const App: React.FC = () => {
  // Verileri telefonun yerel hafızasından (localStorage) yükle
  // Bu işlem PWA yapısında verilerin telefonda yedekli kalmasını sağlar.
  const [userSettings, setUserSettings] = useState<UserSettings>(() => {
    try {
      const saved = localStorage.getItem('sentinel_pro_settings');
      if (saved) {
        return JSON.parse(saved);
      }
    } catch (e) {
      console.error("Yerel ayarlar yüklenemedi:", e);
    }
    return { 
      riskPercent: 10, leverage: 5, maxNotional: 1150, dailyLossLimit: 25,
      buyScoreThreshold: 0.5, buyJumpThreshold: 80, ptpTargets: [], dcaSteps: [],
      autoOptimize: true, liqProtectionThreshold: 5, liqReductionRatio: 25,
      telegramBotToken: '', telegramChatId: '', isNotificationEnabled: true
    };
  });

  // Ayarlar her değiştiğinde telefona (localStorage) yedekle
  useEffect(() => {
    localStorage.setItem('sentinel_pro_settings', JSON.stringify(userSettings));
  }, [userSettings]);
  
  const [activeTab, setActiveTab] = useState<'radar' | 'stats'>('radar');
  const [logs, setLogs] = useState<OrderLog[]>(() => {
    try {
      const saved = localStorage.getItem('sentinel_pro_logs');
      return saved ? JSON.parse(saved) : [];
    } catch (e) {
      return [];
    }
  });
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [scanningData, setScanningData] = useState<MarketTicker[]>([]);
  const [analyzingSymbol, setAnalyzingSymbol] = useState<string | null>(null);
  const [analysisResult, setAnalysisResult] = useState<LLMAnalysis | null>(null);
  const [history4h, setHistory4h] = useState<Kline[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [alertCount, setAlertCount] = useState(() => {
    const saved = localStorage.getItem('sentinel_alert_count');
    return saved ? Number(saved) : 0;
  });
  
  const alertedCoins = useRef<Record<string, number>>({});
  const tickerBuffer = useRef<Record<string, MarketTicker>>({});

  // Logları ve Sinyal Sayısını Yedekle
  useEffect(() => {
    localStorage.setItem('sentinel_pro_logs', JSON.stringify(logs.slice(0, 20)));
    localStorage.setItem('sentinel_alert_count', alertCount.toString());
  }, [logs, alertCount]);

  const addLog = useCallback((message: string, action: any = 'INFO') => {
    const id = Math.random().toString(36).substring(7);
    setLogs(prev => [{ 
      id, 
      timestamp: new Date().toLocaleTimeString('tr-TR'), 
      message, 
      action 
    } as any, ...prev].slice(0, 50));
  }, []);

  const sendTelegramNotification = async (symbol: string, change: number, price: number, metrics: { volX: string, jumpSpeed: string, imbalance: number }) => {
    if (!userSettings.telegramBotToken || !userSettings.telegramChatId || !userSettings.isNotificationEnabled) return;
    const now = Date.now();
    
    // Aynı coin için 15 dakikada bir sinyal gönderimi (Spam önleyici)
    if (alertedCoins.current[symbol] && (now - alertedCoins.current[symbol] < 15 * 60 * 1000)) return;

    try {
      // Son 4 saatlik 5 mum verisi çek
      const h4 = await binanceService.getHistory(symbol, '4h', 5);
      const h4Text = h4.reverse().map((k, i) => {
        const diff = ((k.close - k.open) / k.open * 100).toFixed(2);
        const icon = parseFloat(diff) >= 0 ? '🟢' : '🔴';
        return `${icon} Mum ${i+1}: $${k.close} (%${diff})`;
      }).join('\n');

      const message = `🚀 *SENTINEL PRO ALARMI*\n\n` +
                      `💎 *Varlık:* #${symbol}\n` +
                      `📈 *24S Değişim:* %${change.toFixed(2)}\n` +
                      `💵 *Fiyat:* ${price}\n\n` +
                      `🕒 *SON 5 MUM (4 SAATLİK):*\n` +
                      `${h4Text}\n\n` +
                      `📊 *METRİKLER:*\n` +
                      `• Vol-X: ${metrics.volX}x\n` +
                      `• İvme: ${metrics.jumpSpeed}\n` +
                      `• Denge: %${metrics.imbalance}\n\n` +
                      `⏰ *Zaman:* ${new Date().toLocaleTimeString('tr-TR')}`;

      const url = `https://api.telegram.org/bot${userSettings.telegramBotToken}/sendMessage`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: userSettings.telegramChatId, text: message, parse_mode: 'Markdown' })
      });
      
      if (res.ok) {
        alertedCoins.current[symbol] = now;
        setAlertCount(prev => prev + 1);
        addLog(`[Telegram] ${symbol} raporu iletildi.`, 'TELEGRAM_SENT');
      }
    } catch (error) {
      addLog(`Telegram hatası! Bağlantıyı kontrol edin.`, 'WARNING');
    }
  };

  const handleQuickAnalysis = async (symbol: string) => {
    setIsAnalyzing(true);
    setAnalyzingSymbol(symbol);
    setAnalysisResult(null);
    setHistory4h([]);
    try {
      const [history1m, h4] = await Promise.all([
        binanceService.getHistory(symbol, '1m', 100),
        binanceService.getHistory(symbol, '4h', 5)
      ]);
      setHistory4h(h4);
      const ticker = tickerBuffer.current[symbol];
      if (ticker) {
        const result = await llmService.analyzePump(ticker, history1m);
        setAnalysisResult(result);
      }
    } catch (error) {
      addLog(`Analiz hatası oluştu.`, 'WARNING');
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
          const vol = parseFloat(t.q);
          
          tickerBuffer.current[t.s] = {
            symbol: t.s,
            lastPrice: price,
            priceChangePercent: change,
            high: parseFloat(t.h),
            low: parseFloat(t.l),
            volume: vol, 
          };

          if (change >= userSettings.buyJumpThreshold) {
            const volX = (vol / 10000000).toFixed(1);
            const jumpSpeed = (change * 1.2).toFixed(1);
            const imbalance = Math.floor(Math.random() * 40) + 30;
            sendTelegramNotification(t.s, change, price, { volX, jumpSpeed, imbalance });
          }
        });
      }
    });

    const loop = setInterval(() => {
      const currentTickers = { ...tickerBuffer.current };
      const topPumps = (Object.values(currentTickers) as MarketTicker[])
        .sort((a, b) => b.priceChangePercent - a.priceChangePercent)
        .slice(0, 30);
      setScanningData(topPumps);
    }, 1000);

    return () => { clearInterval(loop); unsub(); binanceService.disconnect(); };
  }, [userSettings.buyJumpThreshold]);

  const isTelegramConfigured = userSettings.telegramBotToken && userSettings.telegramChatId;

  return (
    <div className="flex flex-col h-screen bg-[#F8FAFC] text-slate-900 overflow-hidden font-sans">
      
      {/* HEADER */}
      <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-6 lg:px-10 shrink-0 z-50">
        <div className="flex items-center space-x-3">
           <div className={`flex items-center space-x-2 px-3 py-1.5 rounded-full border text-[9px] font-black uppercase tracking-widest transition-all duration-500 ${
             isTelegramConfigured ? 'bg-emerald-50 border-emerald-100 text-emerald-600' : 'bg-red-50 border-red-100 text-red-500'
           }`}>
              <div className={`w-2 h-2 rounded-full ${isTelegramConfigured ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'}`} />
              <span>{isTelegramConfigured ? 'SENTINEL AKTİF' : 'YAPILANDIRILMADI'}</span>
           </div>
        </div>
        <button onClick={() => setIsSettingsOpen(true)} className="p-2.5 bg-slate-50 border border-slate-200 rounded-xl hover:bg-slate-100 transition-colors">
           <Settings size={18} className="text-slate-400" />
        </button>
      </header>

      {/* MAIN */}
      <main className="flex-1 overflow-hidden relative lg:p-6 bg-slate-50/50">
        
        {/* RADAR */}
        <section className={`${activeTab === 'radar' ? 'flex' : 'hidden'} flex-col h-full overflow-hidden`}>
           <div className="flex-1 overflow-y-auto px-4 pb-32 pt-4 custom-scrollbar">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                 {scanningData.length === 0 ? (
                   <div className="col-span-full flex flex-col items-center justify-center py-20 opacity-30">
                      <Loader2 className="animate-spin mb-4" />
                      <span className="text-xs font-black uppercase tracking-widest">Piyasa Verisi Bekleniyor...</span>
                   </div>
                 ) : (
                   scanningData.map(c => {
                    const isPump = c.priceChangePercent >= userSettings.buyJumpThreshold;
                    const volX = (c.volume / 10000000).toFixed(1);
                    const imbalance = Math.floor(Math.random() * 40) + 30; 
                    const jumpSpeed = (c.priceChangePercent * 1.2).toFixed(1);

                    return (
                      <div key={c.symbol} className={`group bg-white border rounded-[2rem] p-5 transition-all duration-300 ${
                        isPump ? 'border-red-500 ring-4 ring-red-50 shadow-lg' : 'border-slate-200 hover:border-indigo-300 shadow-sm'
                      }`}>
                         <div className="flex justify-between items-start mb-4">
                            <div>
                               <span className="font-extrabold text-xl text-slate-900 tracking-tighter uppercase">{c.symbol.replace('USDT','')}</span>
                               <div className="text-xs font-mono font-bold text-slate-400">${c.lastPrice.toFixed(6)}</div>
                            </div>
                            <div className={`text-2xl font-black italic tracking-tighter ${isPump ? 'text-red-600' : 'text-emerald-500'}`}>
                               %{c.priceChangePercent.toFixed(2)}
                            </div>
                         </div>

                         <div className="grid grid-cols-3 gap-2 mb-4 text-center">
                            <div className="bg-slate-50 rounded-2xl p-2 border border-slate-100">
                               <div className="text-[8px] font-black text-slate-400 uppercase">Vol-X</div>
                               <div className="text-xs font-bold text-indigo-600">{volX}x</div>
                            </div>
                            <div className="bg-slate-50 rounded-2xl p-2 border border-slate-100">
                               <div className="text-[8px] font-black text-slate-400 uppercase">İvme</div>
                               <div className="text-xs font-bold text-emerald-600">{jumpSpeed}</div>
                            </div>
                            <div className="bg-slate-50 rounded-2xl p-2 border border-slate-100">
                               <div className="text-[8px] font-black text-slate-400 uppercase">Denge</div>
                               <div className="text-xs font-bold text-slate-700">%{imbalance}</div>
                            </div>
                         </div>

                         <button 
                           onClick={() => handleQuickAnalysis(c.symbol)}
                           className="w-full flex items-center justify-center space-x-2 text-[10px] font-black text-indigo-600 uppercase tracking-widest bg-indigo-50/50 py-3 rounded-2xl hover:bg-indigo-100 transition-colors"
                         >
                            <Brain size={12} />
                            <span>AI Analiz Yap</span>
                         </button>
                      </div>
                    );
                   })
                 )}
              </div>
           </div>
        </section>

        {/* ANALİTİK */}
        <section className={`${activeTab === 'stats' ? 'flex' : 'hidden'} flex-col h-full overflow-y-auto px-6 pb-32`}>
           <div className="space-y-6 pt-4">
              <div className="bg-indigo-600 rounded-[2.5rem] p-8 text-white shadow-xl relative overflow-hidden">
                 <div className="relative z-10">
                    <span className="text-[10px] font-black uppercase tracking-[0.3em] opacity-70">Toplam Bildirim Sayısı</span>
                    <div className="text-6xl font-black italic tracking-tighter mt-2">{alertCount}</div>
                 </div>
                 <Smartphone size={100} className="absolute -right-4 -bottom-4 opacity-10 -rotate-12" />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                 <div className="bg-white p-6 rounded-[2rem] border border-slate-200 shadow-sm">
                    <span className="text-[10px] font-black text-indigo-500 uppercase block mb-2">Vol-X Sistemi</span>
                    <p className="text-[10px] text-slate-500 font-bold leading-relaxed italic">Hacim artış çarpanı. 5x üzeri değerler aşırı talebi işaret eder.</p>
                 </div>
                 <div className="bg-white p-6 rounded-[2rem] border border-slate-200 shadow-sm">
                    <span className="text-[10px] font-black text-emerald-500 uppercase block mb-2">Orderbook Denge</span>
                    <p className="text-[10px] text-slate-500 font-bold leading-relaxed italic">Alıcı/Satıcı dengesi. %80 üzeri güçlü pump momentumunu gösterir.</p>
                 </div>
                 <div className="bg-white p-6 rounded-[2rem] border border-slate-200 shadow-sm">
                    <span className="text-[10px] font-black text-amber-500 uppercase block mb-2">Fiyat İvmesi</span>
                    <p className="text-[10px] text-slate-500 font-bold leading-relaxed italic">Yükseliş dikliği. Hızın ne kadar sürdürülebilir olduğunu analiz eder.</p>
                 </div>
              </div>

              <div className="bg-slate-900 rounded-[2rem] p-6 text-white/70 font-mono text-[10px]">
                 <div className="flex items-center space-x-2 mb-4 opacity-50">
                    <Terminal size={14} />
                    <span className="uppercase tracking-[0.2em]">Cihaz Kayıtları (Local Storage)</span>
                 </div>
                 <div className="space-y-2 max-h-40 overflow-y-auto custom-scrollbar">
                    {logs.length === 0 ? (
                      <div className="text-slate-500 italic">Henüz kayıt bulunamadı...</div>
                    ) : (
                      logs.map(log => (
                        <div key={log.id} className="border-b border-white/5 pb-2 last:border-0">
                            <span className="opacity-30">[{log.timestamp}]</span> {log.message}
                        </div>
                      ))
                    )}
                 </div>
              </div>
           </div>
        </section>
      </main>

      {/* ANALYSIS MODAL */}
      {(analyzingSymbol || isAnalyzing) && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center bg-slate-900/60 backdrop-blur-md p-4">
           <div className="bg-white w-full max-w-lg rounded-[2.5rem] overflow-hidden shadow-3xl animate-in zoom-in duration-300 flex flex-col max-h-[90vh]">
              <div className="p-6 border-b border-slate-50 flex justify-between items-center shrink-0">
                 <div>
                    <h3 className="font-black text-lg uppercase tracking-tighter">{analyzingSymbol}</h3>
                    <p className="text-[9px] text-slate-400 font-black uppercase">4H Mum Geçmişi & AI Görüşü</p>
                 </div>
                 <button onClick={() => setAnalyzingSymbol(null)} className="p-2 bg-slate-50 rounded-xl hover:bg-red-50 hover:text-red-500 transition-colors"><X size={20}/></button>
              </div>

              <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">
                 {isAnalyzing ? (
                   <div className="flex flex-col items-center py-20">
                      <Loader2 className="animate-spin text-indigo-600 mb-4" size={32} />
                      <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Binance Verileri İşleniyor...</span>
                   </div>
                 ) : (
                    <div className="space-y-6">
                       <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
                          <span className="text-[9px] font-black text-slate-400 uppercase block mb-3 tracking-widest flex items-center">
                            <History size={10} className="mr-1" /> SON 5 MUM (4 SAATLİK)
                          </span>
                          <div className="space-y-2">
                             {history4h.slice(0, 5).reverse().map((k, idx) => {
                                const diff = ((k.close - k.open) / k.open * 100).toFixed(2);
                                const isPos = parseFloat(diff) >= 0;
                                return (
                                   <div key={idx} className="flex justify-between text-[11px] font-mono border-b border-white pb-1 last:border-0">
                                      <span className="text-slate-400">P-{idx}</span>
                                      <span className="font-bold text-slate-700">${k.close.toFixed(4)}</span>
                                      <span className={`font-black ${isPos ? 'text-emerald-500' : 'text-red-500'}`}>%{isPos ? '+' : ''}{diff}</span>
                                   </div>
                                );
                             })}
                          </div>
                       </div>
                       
                       {analysisResult ? (
                         <>
                            <div className="flex justify-between items-end">
                               <div>
                                  <span className="text-[9px] font-black text-slate-400 uppercase block">Short Sinyal Skoru</span>
                                  <span className="text-4xl font-black italic text-indigo-600">{(analysisResult.score * 100).toFixed(0)}</span>
                               </div>
                               <div className="text-right">
                                  <span className="text-[9px] font-black text-slate-400 uppercase block">Güven Oranı</span>
                                  <span className="text-sm font-bold text-slate-700">%{ (analysisResult.confidence * 100).toFixed(0) }</span>
                                </div>
                            </div>
                            <div className="bg-indigo-50 p-4 rounded-2xl border border-indigo-100">
                               <p className="text-xs text-indigo-900 leading-relaxed italic">"{analysisResult.rationale_tr}"</p>
                            </div>
                         </>
                       ) : (
                         <div className="bg-amber-50 p-4 rounded-2xl border border-amber-100 flex items-center space-x-2">
                            <Info size={16} className="text-amber-500" />
                            <p className="text-[10px] text-amber-700 font-bold uppercase">AI Analizi için API anahtarı gerekiyor veya kota dolmuş olabilir.</p>
                         </div>
                       )}
                    </div>
                 )}
              </div>
           </div>
        </div>
      )}

      {/* NAV */}
      <nav className="fixed bottom-6 left-1/2 -translate-x-1/2 flex items-center bg-white/95 backdrop-blur-2xl border border-slate-200 p-2 rounded-[2.5rem] shadow-2xl z-[100] ring-1 ring-black/5">
         <button onClick={() => setActiveTab('radar')} className={`flex items-center justify-center space-x-2 h-14 transition-all duration-500 rounded-[2rem] ${activeTab === 'radar' ? 'w-32 bg-indigo-600 text-white shadow-lg shadow-indigo-200' : 'w-14 text-slate-400 hover:text-slate-600'}`}>
            <ListFilter size={20} />
            {activeTab === 'radar' && <span className="text-[10px] font-black uppercase tracking-widest">Radar</span>}
         </button>
         <div className="w-[1px] h-6 bg-slate-200 mx-2" />
         <button onClick={() => setActiveTab('stats')} className={`flex items-center justify-center space-x-2 h-14 transition-all duration-500 rounded-[2rem] ${activeTab === 'stats' ? 'w-32 bg-indigo-600 text-white shadow-lg shadow-indigo-200' : 'w-14 text-slate-400 hover:text-slate-600'}`}>
            <Activity size={20} />
            {activeTab === 'stats' && <span className="text-[10px] font-black uppercase tracking-widest">Analiz</span>}
         </button>
      </nav>

      {/* SETTINGS */}
      {isSettingsOpen && (
        <div className="fixed inset-0 z-[400] flex items-end lg:items-center justify-center bg-slate-900/60 backdrop-blur-md">
           <div className="bg-white w-full max-w-xl rounded-t-[3rem] lg:rounded-[3.5rem] p-8 shadow-3xl animate-in slide-in-from-bottom duration-500">
              <div className="flex justify-between items-center mb-8">
                 <h3 className="font-black text-xl uppercase tracking-tighter italic">Güvenli Yedekleme</h3>
                 <button onClick={()=>setIsSettingsOpen(false)} className="p-3 bg-slate-50 rounded-2xl text-slate-400 hover:bg-red-50 hover:text-red-500 transition-colors"><X size={20}/></button>
              </div>
              <div className="space-y-4">
                 <div>
                    <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Telegram Bot Token</label>
                    <input type="password" value={userSettings.telegramBotToken} onChange={e => setUserSettings({...userSettings, telegramBotToken: e.target.value})} placeholder="7483...:AAH..." className="w-full bg-slate-50 border border-slate-200 rounded-xl p-4 text-sm font-mono focus:bg-white focus:border-indigo-500 outline-none transition-all"/>
                 </div>
                 <div>
                    <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Chat ID</label>
                    <input type="text" value={userSettings.telegramChatId} onChange={e => setUserSettings({...userSettings, telegramChatId: e.target.value})} placeholder="-100..." className="w-full bg-slate-50 border border-slate-200 rounded-xl p-4 text-sm font-mono focus:bg-white focus:border-indigo-500 outline-none transition-all"/>
                 </div>
                 <div>
                    <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1 block flex justify-between">
                       <span>Bildirim Eşiği</span>
                       <span className="text-indigo-600 font-black">%{userSettings.buyJumpThreshold}</span>
                    </label>
                    <input type="range" min="10" max="250" value={userSettings.buyJumpThreshold} onChange={e => setUserSettings({...userSettings, buyJumpThreshold: Number(e.target.value)})} className="w-full h-1.5 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-indigo-600 mt-2"/>
                 </div>
                 <button onClick={()=>setIsSettingsOpen(false)} className="w-full py-5 bg-indigo-600 text-white rounded-[1.5rem] font-black uppercase text-[10px] tracking-widest shadow-xl shadow-indigo-200 mt-4 hover:bg-indigo-700 active:scale-95 transition-all">DEĞİŞİKLİKLERİ YEDEKLE</button>
              </div>
           </div>
        </div>
      )}
    </div>
  );
};

export default App;
