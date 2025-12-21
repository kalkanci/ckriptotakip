
// Fix: Implemented llmService using GoogleGenAI to provide technical analysis of market pumps
import { GoogleGenAI, Type } from "@google/genai";
import { LLMAnalysis, MarketTicker, Kline } from "../types";

export const llmService = {
  /**
   * Analyzes a market pump using Gemini model to determine reversal potential (SHORT opportunity)
   */
  analyzePump: async (ticker: MarketTicker, history: Kline[]): Promise<LLMAnalysis | null> => {
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });
      
      const prompt = `Analiz Edilecek Kripto Varlık: ${ticker.symbol}
Güncel Fiyat: ${ticker.lastPrice}
24 Saatlik Değişim: %${ticker.priceChangePercent}
Hacim: ${ticker.volume}

Son 100 dakikalık mum verileri (OHLCV formatında):
${history.slice(-50).map(k => `T:${k.time},O:${k.open},H:${k.high},L:${k.low},C:${k.close},V:${k.volume}`).join('\n')}

Lütfen bu verileri bir SHORT pozisyonu (düşüş beklentisi) için teknik analiz süzgecinden geçir. 
Fiyatın aşırı şişip şişmediğini, hacimli bir satış baskısı olup olmadığını ve olası dönüş seviyelerini belirle.`;

      const response = await ai.models.generateContent({
        model: 'gemini-3-pro-preview',
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              score: { type: Type.NUMBER, description: "0-1 arası short sinyal gücü" },
              rationale_tr: { type: Type.STRING, description: "Türkçe teknik analiz gerekçesi" },
              confidence: { type: Type.NUMBER, description: "Analize duyulan güven (0-1)" },
              risk_estimate: { type: Type.NUMBER, description: "İşlem risk tahmini (0-1)" },
              top_features: { 
                type: Type.ARRAY, 
                items: { type: Type.STRING },
                description: "Analizde öne çıkan teknik göstergeler"
              },
              recommended_params: {
                type: Type.OBJECT,
                properties: {
                  take_profit_price: { type: Type.NUMBER, description: "Önerilen kar alma fiyat seviyesi" }
                },
                required: ["take_profit_price"]
              }
            },
            required: ["score", "rationale_tr", "confidence", "risk_estimate", "top_features"]
          },
          systemInstruction: "Sen uzman bir kripto para teknik analistisin. Verileri soğukkanlılıkla analiz et ve sadece JSON formatında yanıt ver."
        }
      });

      const analysisText = response.text;
      if (!analysisText) return null;

      return JSON.parse(analysisText) as LLMAnalysis;
    } catch (error) {
      console.error('LLM Analysis failed:', error);
      return null;
    }
  }
};
