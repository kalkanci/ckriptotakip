
import { CONFIG } from '../constants';
import { TradeMode, Kline, FuturesMetrics } from '../types';

type MessageHandler = (data: any) => void;

class BinanceService {
  private static instance: BinanceService;
  private ws: WebSocket | null = null;
  private mode: TradeMode = CONFIG.DEFAULT_MODE;
  private handlers: Set<MessageHandler> = new Set();
  private fapiBase = CONFIG.BINANCE_FUTURES_HTTP;

  private constructor() {}

  public static getInstance(): BinanceService {
    if (!BinanceService.instance) {
      BinanceService.instance = new BinanceService();
    }
    return BinanceService.instance;
  }

  public setMode(mode: TradeMode) {
    this.mode = mode;
    this.disconnect();
    this.connect();
  }

  public connect() {
    // USD-M Futures Tüm Market Ticker yayınına bağlan
    this.ws = new WebSocket(`${CONFIG.BINANCE_FUTURES_WS}/!ticker@arr`);
    this.ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      this.handlers.forEach(handler => handler(data));
    };
    this.ws.onclose = () => {
      setTimeout(() => this.connect(), 5000);
    };
  }

  public disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  public onMessage(handler: MessageHandler) {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  public async getFuturesMetrics(symbol: string): Promise<FuturesMetrics | null> {
    try {
      const [fundingRes, oiRes] = await Promise.all([
        fetch(`${this.fapiBase}/premiumIndex?symbol=${symbol}`),
        fetch(`${this.fapiBase}/openInterest?symbol=${symbol}`)
      ]);
      
      const fundingData = await fundingRes.json();
      const oiData = await oiRes.json();

      return {
        fundingRate: parseFloat(fundingData.lastFundingRate || '0'),
        openInterest: parseFloat(oiData.openInterest || '0')
      };
    } catch (e) {
      return null;
    }
  }

  public async getHistory(symbol: string, interval: string = '1m', limit: number = 100): Promise<Kline[]> {
    // Futures Klines endpoint'i kullanılıyor
    const url = `${this.fapiBase}/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
    try {
      const res = await fetch(url);
      const data = await res.json();
      return data.map((d: any) => ({
        time: d[0] / 1000,
        open: parseFloat(d[1]),
        high: parseFloat(d[2]),
        low: parseFloat(d[3]),
        close: parseFloat(d[4]),
        volume: parseFloat(d[5]),
      }));
    } catch (e) { 
      return []; 
    }
  }
}

export const binanceService = BinanceService.getInstance();
