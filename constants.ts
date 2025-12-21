
import { TradeMode } from './types';

export const CONFIG = {
  DEFAULT_MODE: TradeMode.DEMO,
  BINANCE_SPOT_HTTP: 'https://api.binance.com/api/v3',
  BINANCE_SPOT_WS: 'wss://stream.binance.com:9443/ws',
  
  STRATEGY: {
    // Maliyet Düşürme Adımları (Düşüş Oranı %) - Ayarlar ekranından ezilebilir
    SCALE_STEPS: [2.5, 5.5, 10.0, 18.0, 28.0, 38.0, 50.0], 
    // Alım Miktarı Çarpanları
    SCALE_SIZES: [1.0, 1.5, 2.5, 4.0, 6.0, 8.5, 12.0],    
    PROFIT_ADD_THRESHOLD: 0.02,           
    MIN_PRICE_ELIGIBILITY: 0.000001,
  },

  RISK: {
    GLOBAL_DRAWDOWN_LIMIT: 15.0,          
    MAX_SYMBOL_EXPOSURE_PCT: 0.40,       
    GLOBAL_EXPOSURE_LIMIT_PCT: 0.80,     
    LIQUIDATION_THRESHOLD_PCT: 0.05,     
    MAX_HOLD_MINUTES: 240,                
    REDUCTION_INTERVAL_MINUTES: 30,       
  },

  SAFETY: {
    MAX_CONCURRENT_TRADES: 2,
  },

  PUMP_RULES: {
    MIN_PRICE_CHANGE_AUTOPILOT: 0.3, 
    AUTOPILOT_SCORE_THRESHOLD: 0.40,
    MOMENTUM_TP_K: 2.5,
  },
  
  UPDATE_INTERVAL_MS: 500,
};
