
import { GoogleGenAI, Type } from "@google/genai";
import { LLMAnalysis, MarketTicker, Kline } from "../types";

export const llmService = {
  analyzePump: async (ticker: MarketTicker, history: Kline[]): Promise<LLMAnalysis | null> => {
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      
      const prompt = `Varlık: ${ticker.symbol}
Şu anki fiyat: ${ticker.lastPrice}
Yükseliş oranı: %${ticker.priceChangePercent}

Mum Verileri:
${history.slice(-30).map(k => `${k.close > k.open ? 'Yükseliş' : 'Düşüş'} Fiyat:${k.close}`).join('\n')}

Lütfen bu durumu çok basit, finansal terimlerden uzak, sanki bir arkadaşına anlatıyormuş gibi yorumla. 
Yükselişin yorulup yorulmadığını ve fiyatın aşağı düşme ihtimalini (SHORT) değerlendir.
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
                description: "0 ile 1 arası düşüş ihtimali puanı. 1 çok yüksek ihtimal." 
              },
              rationale_tr: { 
                type: Type.STRING, 
                description: "Yeni başlayanlar için basit, samimi ve anlaşılır analiz açıklaması." 
              },
              confidence: { type: Type.NUMBER },
              risk_estimate: { type: Type.NUMBER },
              top_features: { type: Type.ARRAY, items: { type: Type.STRING } },
              recommended_params: {
                type: Type.OBJECT,
                properties: { take_profit_price: { type: Type.NUMBER } },
                required: ["take_profit_price"]
              }
            },
            required: ["score", "rationale_tr", "confidence", "risk_estimate", "top_features"]
          },
          systemInstruction: "Sen kripto para dünyasını yeni öğrenen birine rehberlik eden, samimi ve teknik terimlerden kaçınan bir analiz uzmanısın. Yanıtlarını sadece JSON olarak ver."
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
