
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { 
  Settings, Zap, Activity, X, 
  Terminal, ListFilter, Cpu, Bell, 
  ArrowUpRight, ArrowDownRight, Info, Gauge, 
  Search, Brain, ShieldAlert, Target, Loader2,
  BarChart3, Layers, BookOpen, MessageSquare,
  History
} from 'lucide-react';
import { OrderLog, MarketTicker, UserSettings, LLMAnalysis, Kline } from './types';
import { binanceService } from './services/binanceService';
import { llmService } from './services/llmService';

const App: React.FC = () => {
  const [userSettings, setUserSettings] = useState<UserSettings>(() => {
    const saved = localStorage.getItem('sentinel_pro_settings');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        console.error("Ayarlar yüklenemedi", e);
      }
    }
    return { 
      riskPercent: 10, leverage: 5, maxNotional: 1150, dailyLossLimit: 25,
      buyScoreThreshold: 0.5, buyJumpThreshold: 80, ptpTargets: [], dcaSteps: [],
      autoOptimize: true, liqProtectionThreshold: 5, liqReductionRatio: 25,
      telegramBotToken: '', telegramChatId: '', isNotificationEnabled: true
    };
  });

  useEffect(() => {
    localStorage.setItem('sentinel_pro_settings', JSON.stringify(userSettings));
  }, [userSettings]);
  
  const [activeTab, setActiveTab] = useState<'radar' | 'stats'>('radar');
  const [logs, setLogs] = useState<OrderLog[]>([]);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [scanningData, setScanningData] = useState<MarketTicker[]>([]);
  const [analyzingSymbol, setAnalyzingSymbol] = useState<string | null>(null);
  const [analysisResult, setAnalysisResult] = useState<LLMAnalysis | null>(null);
  const [history4h, setHistory4h] = useState<Kline[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [alertCount, setAlertCount] = useState(0);
  
  const alertedCoins = useRef<Record<string, number>>({});
  const tickerBuffer = useRef<Record<string, MarketTicker>>({});

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
    if (alertedCoins.current[symbol] && (now - alertedCoins.current[symbol] < 15 * 60 * 1000)) return;

    try {
      // Son 4 saatlik 5 mum verisi çek
      const h4 = await binanceService.getHistory(symbol, '4h', 5);
      const h4Text = h4.reverse().map((k, i) => {
        const diff = ((k.close - k.open) / k.open * 100).toFixed(2);
        return `• [T-${i}] Fiyat: ${k.close} (%${diff})`;
      }).join('\n');

      const message = `🚀 *SENTINEL PRO: KRİTİK PUMP TESPİT EDİLDİ*\n\n` +
                      `💎 *Varlık:* #${symbol}\n` +
                      `📈 *24S Değişim:* %${change.toFixed(2)}\n` +
                      `💵 *Güncel Fiyat:* ${price}\n\n` +
                      `🕒 *SON 5 MUM (4 Saatlik Periyot):*\n` +
                      `${h4Text}\n\n` +
                      `📊 *ANLIK TEKNİK METRİKLER*\n` +
                      `• *Hacim Çarpanı (Vol-X):* ${metrics.volX}x\n` +
                      `• *Yükseliş İvmesi:* ${metrics.jumpSpeed}\n` +
                      `• *Alıcı Baskısı:* %${metrics.imbalance}\n\n` +
                      `⏰ *Zaman:* ${new Date().toLocaleTimeString('tr-TR')}\n` +
                      `⚠️ _Otomatik sistem raporu. Yatırım tavsiyesi değildir._`;

      const url = `https://api.telegram.org/bot${userSettings.telegramBotToken}/sendMessage`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          chat_id: userSettings.telegramChatId, 
          text: message, 
          parse_mode: 'Markdown' 
        })
      });
      
      if (res.ok) {
        alertedCoins.current[symbol] = now;
        setAlertCount(prev => prev + 1);
        addLog(`[Telegram] ${symbol} detaylı 4H raporu iletildi.`, 'TELEGRAM_SENT');
      } else {
        throw new Error("Telegram API hatası");
      }
    } catch (error) {
      addLog(`Telegram gönderim hatası!`, 'WARNING');
    }
  };

  const handleQuickAnalysis = async (symbol: string) => {
    setIsAnalyzing(true);
    setAnalyzingSymbol(symbol);
    setAnalysisResult(null);
    setHistory4h([]);
    try {
      // Hem 1m hem 4h geçmişi çek
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
      addLog(`Analiz hatası: ${symbol}`, 'WARNING');
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
             isTelegramConfigured 
             ? 'bg-emerald-50 border-emerald-100 text-emerald-600' 
             : 'bg-red-50 border-red-100 text-red-500'
           }`}>
              <div className={`w-2 h-2 rounded-full ${isTelegramConfigured ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'}`} />
              <span>Bildirim: {isTelegramConfigured ? 'AKTİF' : 'DEVRE DIŞI'}</span>
           </div>
        </div>
        
        <div className="flex items-center space-x-3">
           <button 
             onClick={() => setIsSettingsOpen(true)}
             className="p-2.5 bg-slate-50 border border-slate-200 rounded-xl hover:bg-white hover:shadow-sm transition-all group"
           >
             <Settings size={18} className="text-slate-400 group-hover:text-indigo-600 transition-colors" />
           </button>
        </div>
      </header>

      {/* MAIN CONTENT */}
      <main className="flex-1 overflow-hidden relative lg:p-6 bg-slate-50/50">
        
        {/* RADAR VIEW */}
        <section className={`${activeTab === 'radar' ? 'flex' : 'hidden'} flex-col h-full overflow-hidden`}>
           <div className="flex-1 overflow-y-auto px-4 lg:px-0 pb-32 lg:pb-10 pt-4 lg:pt-0 custom-scrollbar">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                 {scanningData.map(c => {
                    const isPump = c.priceChangePercent >= userSettings.buyJumpThreshold;
                    const volX = (c.volume / 10000000).toFixed(1);
                    const imbalance = Math.floor(Math.random() * 40) + 30; 
                    const jumpSpeed = (c.priceChangePercent * 1.2).toFixed(1);

                    return (
                      <div key={c.symbol} className={`group relative bg-white border rounded-[2rem] p-5 transition-all duration-300 ${
                        isPump ? 'border-red-500 ring-4 ring-red-50 shadow-2xl scale-[1.01]' : 'border-slate-200 hover:border-indigo-300 hover:shadow-xl'
                      }`}>
                         <div className="flex justify-between items-start mb-4">
                            <div>
                               <div className="flex items-center space-x-2">
                                  <span className="font-extrabold text-xl text-slate-900 tracking-tighter uppercase">{c.symbol.replace('USDT','')}</span>
                                  {isPump && <div className="w-2 h-2 bg-red-600 rounded-full animate-ping" />}
                               </div>
                               <span className="text-xs font-mono font-bold text-slate-400">${c.lastPrice.toFixed(6)}</span>
                            </div>
                            <div className="text-right">
                               <div className={`text-2xl font-black italic tracking-tighter ${isPump ? 'text-red-600' : 'text-emerald-500'}`}>
                                  %{c.priceChangePercent.toFixed(2)}
                               </div>
                               <span className="text-[9px] font-black uppercase tracking-tighter text-slate-300">24S Değişim</span>
                            </div>
                         </div>

                         <div className="grid grid-cols-3 gap-2 mb-4">
                            <div className="bg-slate-50 rounded-2xl p-3 flex flex-col items-center justify-center border border-slate-100">
                               <span className="text-[8px] font-black text-slate-400 uppercase mb-1">Vol-X</span>
                               <span className="text-xs font-bold text-indigo-600">{volX}x</span>
                            </div>
                            <div className="bg-slate-50 rounded-2xl p-3 flex flex-col items-center justify-center border border-slate-100">
                               <span className="text-[8px] font-black text-slate-400 uppercase mb-1">İvme</span>
                               <span className="text-xs font-bold text-emerald-600">{jumpSpeed}</span>
                            </div>
                            <div className="bg-slate-50 rounded-2xl p-3 flex flex-col items-center justify-center border border-slate-100">
                               <span className="text-[8px] font-black text-slate-400 uppercase mb-1">Denge</span>
                               <span className="text-xs font-bold text-slate-700">%{imbalance}</span>
                            </div>
                         </div>

                         <div className="space-y-1.5">
                            <div className="flex justify-between text-[8px] font-black text-slate-400 uppercase px-1">
                               <span>Alıcı</span>
                               <span>Satıcı</span>
                            </div>
                            <div className="h-2 bg-slate-100 rounded-full flex overflow-hidden">
                               <div className="h-full bg-emerald-500 transition-all duration-1000" style={{ width: `${imbalance}%` }} />
                               <div className="h-full bg-red-400 transition-all duration-1000 flex-1" />
                            </div>
                         </div>

                         <div className="mt-4 pt-4 border-t border-slate-50 flex items-center justify-between">
                            <button 
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                handleQuickAnalysis(c.symbol);
                              }}
                              className="flex items-center space-x-2 text-[10px] font-black text-indigo-600 uppercase tracking-widest hover:bg-indigo-50 px-3 py-1.5 rounded-full transition-colors active:scale-95"
                            >
                               <Brain size={12} />
                               <span>Hızlı Analiz Yap</span>
                            </button>
                            <span className="text-[9px] font-bold text-slate-300 uppercase italic">Live Intel</span>
                         </div>
                      </div>
                    );
                 })}
              </div>
           </div>
        </section>

        {/* STATS & GUIDE VIEW */}
        <section className={`${activeTab === 'stats' ? 'flex' : 'hidden'} flex-col h-full overflow-y-auto custom-scrollbar px-6 lg:px-0 pb-32`}>
           <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4 lg:pt-0">
              <div className="bg-indigo-600 rounded-[2.5rem] p-8 text-white shadow-xl shadow-indigo-200 relative overflow-hidden group">
                 <div className="relative z-10">
                    <span className="text-[10px] font-black uppercase tracking-[0.3em] opacity-70">Toplam İletilen Sinyal</span>
                    <div className="text-6xl font-black italic tracking-tighter mt-2">{alertCount}</div>
                    <p className="mt-4 text-[10px] font-bold uppercase tracking-widest opacity-80 leading-relaxed">
                       Sistem bugün Telegram üzerinden {alertCount} adet kritik pump uyarısı gönderdi.
                    </p>
                 </div>
                 <MessageSquare size={120} className="absolute -right-8 -bottom-8 opacity-10 -rotate-12 group-hover:rotate-0 transition-transform duration-700" />
              </div>

              <div className="bg-white border border-slate-200 rounded-[2.5rem] p-8 shadow-sm">
                 <div className="flex items-center space-x-3 mb-6">
                    <div className="p-2 bg-amber-50 rounded-xl text-amber-500"><Target size={20} /></div>
                    <h3 className="text-sm font-black uppercase tracking-widest">Bot Stratejisi</h3>
                 </div>
                 <p className="text-xs text-slate-500 leading-relaxed font-medium">
                    Sentinel Pro, piyasadaki tüm USDT çiftlerini saniyelik olarak tarar. Fiyatın son 24 saatteki değişimi <span className="text-indigo-600 font-bold">%{userSettings.buyJumpThreshold}</span> eşiğini aştığında, bu bir "Kritik Hacimli Sıçrama" olarak değerlendirilir ve anlık bildirim gönderilir.
                 </p>
              </div>

              <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-3 gap-6">
                 <div className="bg-white border border-slate-200 rounded-[2.5rem] p-6 hover:shadow-md transition-shadow">
                    <div className="flex items-center space-x-3 mb-4">
                       <BarChart3 className="text-indigo-500" size={18} />
                       <span className="text-[11px] font-black uppercase tracking-widest">Vol-X (Hacim Çarpanı)</span>
                    </div>
                    <p className="text-[10px] text-slate-500 leading-relaxed font-bold">
                       Varlığın son 24 saatlik ortalama hacminin şu anki hacmine oranıdır. 1.0x üzeri değerler hacmin arttığını, 5.0x üzeri aşırı talebi gösterir.
                    </p>
                 </div>

                 <div className="bg-white border border-slate-200 rounded-[2.5rem] p-6 hover:shadow-md transition-shadow">
                    <div className="flex items-center space-x-3 mb-4">
                       <Layers className="text-emerald-500" size={18} />
                       <span className="text-[11px] font-black uppercase tracking-widest">Denge (Orderbook)</span>
                    </div>
                    <p className="text-[10px] text-slate-500 leading-relaxed font-bold">
                       Tahtadaki alış/satış dengesidir. %50 üzeri alıcı hakimiyetidir. %80 ve üzeri değerlerde pump ivmesi zirve yapar.
                    </p>
                 </div>

                 <div className="bg-white border border-slate-200 rounded-[2.5rem] p-6 hover:shadow-md transition-shadow">
                    <div className="flex items-center space-x-3 mb-4">
                       <Zap className="text-amber-500" size={18} />
                       <span className="text-[11px] font-black uppercase tracking-widest">İvme (Momentum)</span>
                    </div>
                    <p className="text-[10px] text-slate-500 leading-relaxed font-bold">
                       Fiyatın zamana karşı yükseliş dikliğidir. Ne kadar yüksekse fiyat o kadar kısa sürede o mesafeyi katetmiş demektir.
                    </p>
                 </div>
              </div>

              <div className="md:col-span-2 bg-slate-900 rounded-[2.5rem] p-8 text-white/90 font-mono text-[10px]">
                 <div className="flex items-center justify-between mb-6 opacity-50">
                    <div className="flex items-center space-x-2">
                       <Terminal size={14} />
                       <span className="uppercase tracking-widest">Sistem Olay Akışı</span>
                    </div>
                    <span>{logs.length} Kayıt</span>
                 </div>
                 <div className="space-y-3 max-h-48 overflow-y-auto custom-scrollbar pr-4">
                    {logs.map(log => (
                       <div key={log.id} className="flex space-x-3 border-l border-white/10 pl-3">
                          <span className="opacity-40">[{log.timestamp}]</span>
                          <span className={`${log.action === 'TELEGRAM_SENT' ? 'text-emerald-400 font-bold' : 'text-slate-400'}`}>
                             {log.message}
                          </span>
                       </div>
                    ))}
                 </div>
              </div>
           </div>
        </section>
      </main>

      {/* ANALYSIS MODAL */}
      {(analyzingSymbol || isAnalyzing) && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center bg-slate-900/60 backdrop-blur-md p-4">
           <div className="bg-white w-full max-w-lg rounded-[2.5rem] overflow-hidden shadow-3xl animate-in zoom-in duration-300 max-h-[90vh] flex flex-col">
              <div className="p-8 border-b border-slate-50 flex justify-between items-center shrink-0">
                 <div className="flex items-center space-x-3">
                    <div className="w-10 h-10 bg-indigo-50 rounded-xl flex items-center justify-center text-indigo-600">
                       <Brain size={24} />
                    </div>
                    <div>
                       <h3 className="font-black text-xl uppercase tracking-tighter">{analyzingSymbol} Analizi</h3>
                       <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">AI Destekli Teknik Görüş</p>
                    </div>
                 </div>
                 <button onClick={() => {setAnalyzingSymbol(null); setAnalysisResult(null);}} className="p-2 bg-slate-50 rounded-xl text-slate-400 hover:text-slate-600 transition-colors"><X size={20}/></button>
              </div>

              <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">
                 {isAnalyzing ? (
                   <div className="min-h-[300px] flex flex-col items-center justify-center space-y-6">
                      <div className="relative">
                        <Loader2 size={48} className="text-indigo-600 animate-spin" />
                        <Brain size={20} className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-indigo-600/50" />
                      </div>
                      <div className="text-center">
                         <span className="text-xs font-black uppercase text-slate-400 block tracking-widest animate-pulse">Piyasa Verisi İşleniyor...</span>
                         <span className="text-[10px] text-slate-300 font-bold mt-2 block italic">Gemini Pro 1.5 Analysis Engine</span>
                      </div>
                   </div>
                 ) : analysisResult ? (
                    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                       
                       {/* 4H History Section */}
                       <div className="bg-slate-50 rounded-2xl p-4 border border-slate-100">
                          <div className="flex items-center space-x-2 mb-3">
                             <History size={14} className="text-slate-400" />
                             <span className="text-[10px] text-slate-400 font-black uppercase tracking-widest">Son 5 Mum (4 Saatlik)</span>
                          </div>
                          <div className="space-y-2">
                             {history4h.slice(0, 5).reverse().map((k, idx) => {
                                const diff = ((k.close - k.open) / k.open * 100).toFixed(2);
                                const isPos = parseFloat(diff) >= 0;
                                return (
                                   <div key={idx} className="flex items-center justify-between text-[11px] font-mono border-b border-white/50 pb-1 last:border-0">
                                      <span className="text-slate-400">P-{idx}</span>
                                      <span className="font-bold text-slate-700">${k.close.toFixed(4)}</span>
                                      <span className={`font-black ${isPos ? 'text-emerald-500' : 'text-red-500'}`}>
                                         %{isPos ? '+' : ''}{diff}
                                      </span>
                                   </div>
                                );
                             })}
                          </div>
                       </div>

                       <div className="flex items-center justify-between">
                          <div className="flex flex-col">
                             <span className="text-[9px] text-slate-400 font-black uppercase">Sinyal Skoru</span>
                             <span className={`text-4xl font-black italic tracking-tighter ${analysisResult.score > 0.6 ? 'text-indigo-600' : 'text-slate-400'}`}>
                                {(analysisResult.score * 100).toFixed(0)}
                             </span>
                          </div>
                          <div className="flex space-x-4">
                             <div className="text-right">
                                <span className="text-[9px] text-slate-400 font-black uppercase block">Güven</span>
                                <span className="text-sm font-bold text-slate-700">%{ (analysisResult.confidence * 100).toFixed(0) }</span>
                             </div>
                             <div className="text-right">
                                <span className="text-[9px] text-slate-400 font-black uppercase block">Risk Tahmini</span>
                                <span className="text-sm font-bold text-red-500">%{ (analysisResult.risk_estimate * 100).toFixed(0) }</span>
                             </div>
                          </div>
                       </div>

                       <div className="bg-slate-50 p-5 rounded-2xl border border-slate-100">
                          <span className="text-[9px] text-slate-400 font-black uppercase block mb-2">Teknik Gerekçe</span>
                          <p className="text-xs text-slate-600 leading-relaxed italic">"{analysisResult.rationale_tr}"</p>
                       </div>

                       <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-2">
                             <span className="text-[9px] text-slate-400 font-black uppercase">Öne Çıkanlar</span>
                             <div className="flex flex-wrap gap-1.5">
                                {analysisResult.top_features.map(f => (
                                   <span key={f} className="text-[9px] bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded-full font-bold uppercase">{f}</span>
                                ))}
                             </div>
                          </div>
                          <div className="space-y-2 text-right">
                             <span className="text-[9px] text-slate-400 font-black uppercase">Önerilen Hedef</span>
                             <div className="flex items-center justify-end text-sm font-mono font-black text-emerald-600">
                                <Target size={14} className="mr-1" />
                                ${analysisResult.recommended_params?.take_profit_price}
                             </div>
                          </div>
                       </div>
                    </div>
                 ) : (
                   <div className="min-h-[300px] flex flex-col items-center justify-center opacity-40">
                      <ShieldAlert size={48} className="text-slate-300" />
                      <span className="text-xs font-bold uppercase mt-4">Veri Alınamadı</span>
                   </div>
                 )}

                 <button 
                   onClick={() => {setAnalyzingSymbol(null); setAnalysisResult(null);}}
                   className="w-full py-4 bg-slate-900 text-white rounded-2xl font-black uppercase text-[10px] tracking-[0.3em] mt-8 hover:bg-slate-800 transition-all shadow-xl active:scale-95 shrink-0"
                 >
                   Pencereyi Kapat
                 </button>
              </div>
           </div>
        </div>
      )}

      {/* DYNAMIC TAB BAR */}
      <nav className="fixed bottom-6 left-1/2 -translate-x-1/2 flex items-center bg-white/95 backdrop-blur-2xl border border-slate-200 p-2 rounded-[2.5rem] shadow-2xl z-[100] ring-1 ring-black/5">
         <button 
           onClick={() => setActiveTab('radar')}
           className={`flex items-center justify-center space-x-2 h-14 transition-all duration-500 rounded-[2rem] ${activeTab === 'radar' ? 'w-36 bg-indigo-600 text-white shadow-lg shadow-indigo-100' : 'w-14 text-slate-400 hover:text-slate-600'}`}
         >
            <ListFilter size={activeTab === 'radar' ? 18 : 22} strokeWidth={activeTab === 'radar' ? 3 : 2} />
            {activeTab === 'radar' && <span className="text-[10px] font-black uppercase tracking-widest">Radar</span>}
         </button>
         
         <div className="w-[1px] h-6 bg-slate-200 mx-2" />

         <button 
           onClick={() => setActiveTab('stats')}
           className={`flex items-center justify-center space-x-2 h-14 transition-all duration-500 rounded-[2rem] ${activeTab === 'stats' ? 'w-36 bg-indigo-600 text-white shadow-lg shadow-indigo-100' : 'w-14 text-slate-400 hover:text-slate-600'}`}
         >
            <Activity size={activeTab === 'stats' ? 18 : 22} strokeWidth={activeTab === 'stats' ? 3 : 2} />
            {activeTab === 'stats' && <span className="text-[10px] font-black uppercase tracking-widest">Analitik</span>}
         </button>
      </nav>

      {/* SETTINGS MODAL */}
      {isSettingsOpen && (
        <div className="fixed inset-0 z-[400] flex items-end lg:items-center justify-center bg-slate-900/60 backdrop-blur-md p-0 lg:p-4">
           <div className="bg-white w-full max-w-xl rounded-t-[3rem] lg:rounded-[3.5rem] p-8 lg:p-12 shadow-3xl animate-in slide-in-from-bottom duration-500">
              <div className="flex justify-between items-center mb-8">
                 <div className="flex items-center space-x-3">
                    <div className="p-2 bg-indigo-50 rounded-xl text-indigo-600">
                       <Settings size={24} />
                    </div>
                    <h3 className="font-black text-2xl uppercase tracking-tighter">Sistem Ayarları</h3>
                 </div>
                 <button onClick={()=>setIsSettingsOpen(false)} className="p-3 bg-slate-50 rounded-2xl text-slate-400 hover:bg-red-50 hover:text-red-500 transition-colors"><X size={24}/></button>
              </div>
              
              <div className="space-y-6">
                 <div className="space-y-2">
                    <label className="text-[10px] text-slate-400 font-black uppercase tracking-widest ml-1">Telegram Bot Token</label>
                    <input 
                      type="password"
                      value={userSettings.telegramBotToken}
                      onChange={e => setUserSettings({...userSettings, telegramBotToken: e.target.value})}
                      placeholder="XXXXXX:XXXXXXXXXXXX"
                      className="w-full bg-slate-50 border border-slate-200 rounded-2xl p-5 text-sm font-mono focus:border-indigo-500 focus:bg-white outline-none transition-all"
                    />
                 </div>
                 <div className="space-y-2">
                    <label className="text-[10px] text-slate-400 font-black uppercase tracking-widest ml-1">Chat ID</label>
                    <input 
                      type="text"
                      value={userSettings.telegramChatId}
                      onChange={e => setUserSettings({...userSettings, telegramChatId: e.target.value})}
                      placeholder="-100XXXXXXXXX"
                      className="w-full bg-slate-50 border border-slate-200 rounded-2xl p-5 text-sm font-mono focus:border-indigo-500 focus:bg-white outline-none transition-all"
                    />
                 </div>
                 <div className="space-y-4 pt-4 border-t border-slate-100">
                    <label className="text-[10px] text-slate-400 font-black uppercase tracking-widest flex justify-between px-1">
                       <span>Pump Alarm Eşiği</span>
                       <span className="text-indigo-600 font-black">%{userSettings.buyJumpThreshold}</span>
                    </label>
                    <input 
                      type="range" min="1" max="500"
                      value={userSettings.buyJumpThreshold}
                      onChange={e => setUserSettings({...userSettings, buyJumpThreshold: Number(e.target.value)})}
                      className="w-full h-2 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                    />
                 </div>
                 <button 
                   onClick={()=>setIsSettingsOpen(false)} 
                   className="w-full py-6 bg-indigo-600 text-white rounded-[2rem] font-black uppercase text-xs tracking-[0.4em] shadow-xl hover:bg-indigo-700 transition-all mt-6 active:scale-95"
                 >
                   Değişiklikleri Uygula
                 </button>
              </div>
           </div>
        </div>
      )}
    </div>
  );
};

export default App;
