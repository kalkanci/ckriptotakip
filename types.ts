
export enum TradeMode {
  DEMO = 'DEMO',
  LIVE = 'CANLI'
}

export interface PTPTarget {
  target: number;
  ratio: number;
}

// Added Kline interface for Binance history data
export interface Kline {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// Added LLMAnalysis interface for AI insights and parameter recommendations
export interface LLMAnalysis {
  score: number;
  rationale_tr: string;
  confidence: number;
  risk_estimate: number;
  top_features: string[];
  recommended_params?: {
    take_profit_price: number;
  };
}

// Added PumpCandidate interface for market scanner
export interface PumpCandidate {
  symbol: string;
  lastPrice: number;
  score: number;
  priceJump: number;
  volumeMultiplier: number;
}

export interface UserSettings {
  riskPercent: number;
  leverage: number;
  maxNotional: number;
  dailyLossLimit: number;
  buyScoreThreshold: number;
  buyJumpThreshold: number; // Pump Bildirim Eşiği (%)
  ptpTargets: PTPTarget[];
  dcaSteps: number[];
  autoOptimize: boolean;
  liqProtectionThreshold: number;
  liqReductionRatio: number;
  // Telegram Ayarları
  telegramBotToken: string;
  telegramChatId: string;
  isNotificationEnabled: boolean;
}

export interface Position {
  symbol: string;
  entryPrice: number;
  markPrice: number;
  size: number;
  notional: number;
  initialNotional: number;
  executedSteps: number[];
  stage: string;
  pnl: number;
  pnlPercentage: number;
  realizedPnl: number;
  timestamp: number;
  lastHigh: number;
  liqPrice: number;
  isPartialSold: boolean;
  soldRatios: number[];
  totalFees: number;
  liqDistance: number;
}

export interface MarketTicker {
  symbol: string;
  lastPrice: number;
  priceChangePercent: number;
  high: number;
  low: number;
  volume: number;
}

export interface OrderLog {
  id: string;
  timestamp: string;
  symbol?: string;
  action: 'SCANNING' | 'ALERT' | 'INFO' | 'SUCCESS' | 'WARNING' | 'TELEGRAM_SENT';
  message: string;
}
