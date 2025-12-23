
import { GoogleGenAI, Type } from "@google/genai";
import { LLMAnalysis, MarketTicker, Kline } from "../types";

export const llmService = {
  analyzePump: async (ticker: MarketTicker, history: Kline[]): Promise<LLMAnalysis | null> => {
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      
      const prompt = `Varlık: ${ticker.symbol}
Son Fiyat: ${ticker.lastPrice}
24s Değişim: %${ticker.priceChangePercent}
Hacim Gücü (vScore): ${ticker.vScore}

Son Mumlar (15dk):
${history.slice(-10).map(k => `Açılış: ${k.open}, Kapanış: ${k.close}, Hacim: ${k.volume}`).join('\n')}

Lütfen bu verileri profesyonel bir trader gözüyle incele. 
5x Kaldıraçlı işlem için en karlı yönü (LONG veya SHORT) belirle.
Kaldıraçlı işlemlerde likidasyon riskini minimize edecek bir Stop-Loss ve %5-10 net kar hedefli bir Take-Profit seviyesi öner.
Sadece JSON formatında yanıt ver.`;

      const response = await ai.models.generateContent({
        model: 'gemini-3-pro-preview',
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              score: { 
                type: Type.NUMBER,
                description: "Sinyal güven skoru (0-1). 0.8 üzeri güçlüdür." 
              },
              direction: {
                type: Type.STRING,
                description: "İşlem yönü: 'LONG' veya 'SHORT'"
              },
              rationale_tr: { 
                type: Type.STRING, 
                description: "Neden bu işlemi önerdiğini açıklayan kısa, net analiz." 
              },
              entry_price: { type: Type.NUMBER },
              stop_loss: { type: Type.NUMBER },
              take_profit: { type: Type.NUMBER },
              confidence: { type: Type.NUMBER },
              risk_estimate: { type: Type.NUMBER },
              top_features: { type: Type.ARRAY, items: { type: Type.STRING } }
            },
            required: ["score", "direction", "rationale_tr", "entry_price", "stop_loss", "take_profit", "confidence", "risk_estimate", "top_features"]
          },
          systemInstruction: "Sen 5x kaldıraçlı işlemler için yüksek isabetli sinyaller üreten bir algoritmasın. Amacın zarar ettirmeyecek, hacim onaylı giriş noktaları bulmaktır. Yanıtlarını sadece JSON olarak ver."
        }
      });

      const text = response.text;
      return text ? JSON.parse(text) : null;
    } catch (error) {
      console.error('LLM Hatası:', error);
      return null;
    }
  }
};
