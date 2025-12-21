
export enum TradeMode {
  DEMO = 'DEMO',
  LIVE = 'CANLI'
}

export interface PTPTarget {
  target: number;
  ratio: number;
}

export interface Kline {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface NewsItem {
  title: string;
  source: string;
  url: string;
  published_at: string;
}

export interface FuturesMetrics {
  fundingRate: number;
  openInterest: number;
  liquidations24h?: number;
}

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

export interface UserSettings {
  riskPercent: number;
  leverage: number;
  maxNotional: number;
  dailyLossLimit: number;
  buyScoreThreshold: number;
  buyJumpThreshold: number;
  ptpTargets: PTPTarget[];
  dcaSteps: number[];
  autoOptimize: boolean;
  liqProtectionThreshold: number;
  liqReductionRatio: number;
  telegramBotToken: string;
  telegramChatId: string;
  isNotificationEnabled: boolean;
  isWebNotificationEnabled: boolean;
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

// Added Position interface to resolve compilation error in PositionList.tsx
export interface Position {
  symbol: string;
  stage: string;
  liqPrice: number;
  executedSteps: number[];
  notional: number;
  pnlPercentage: number;
  pnl: number;
  realizedPnl: number;
  totalFees: number;
}

// Added PumpCandidate interface to resolve compilation error in PumpScanner.tsx
export interface PumpCandidate {
  symbol: string;
  lastPrice: number;
  score: number;
  priceJump: number;
  volumeMultiplier: number;
}
