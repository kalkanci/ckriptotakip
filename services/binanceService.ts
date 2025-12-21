
import { CONFIG } from '../constants';
import { TradeMode, Kline } from '../types';

type MessageHandler = (data: any) => void;

class BinanceService {
  private static instance: BinanceService;
  private ws: WebSocket | null = null;
  private mode: TradeMode = CONFIG.DEFAULT_MODE;
  private handlers: Set<MessageHandler> = new Set();

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
    this.ws = new WebSocket(`${CONFIG.BINANCE_SPOT_WS}/!ticker@arr`);
    this.ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      this.handlers.forEach(handler => handler(data));
    };
    this.ws.onclose = () => {
      console.log('WS Connection closed, retrying...');
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

  public async getHistory(symbol: string, interval: string = '1m', limit: number = 100): Promise<Kline[]> {
    const url = `${CONFIG.BINANCE_SPOT_HTTP}/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
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
      console.error('History fetch failed', e);
      return []; 
    }
  }

  public async executeBuy(symbol: string, qty: number) {
    await new Promise(r => setTimeout(r, 400));
    return { id: Math.random().toString(36).substr(2, 9), status: 'FILLED' };
  }

  public async executeSell(symbol: string, qty: number) {
    await new Promise(r => setTimeout(r, 400));
    return { id: Math.random().toString(36).substr(2, 9), status: 'FILLED' };
  }
}

export const binanceService = BinanceService.getInstance();
