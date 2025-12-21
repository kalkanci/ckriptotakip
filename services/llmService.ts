
import { GoogleGenAI, Type } from "@google/genai";
import { LLMAnalysis, MarketTicker, Kline } from "../types";

export const llmService = {
  analyzePump: async (ticker: MarketTicker, history: Kline[]): Promise<LLMAnalysis | null> => {
    try {
      // Create a new GoogleGenAI instance right before making an API call.
      // Always use process.env.API_KEY directly as per @google/genai guidelines.
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      
      const prompt = `Analiz Edilecek Kripto Varlık: ${ticker.symbol}
Fiyat: ${ticker.lastPrice}
24S Değişim: %${ticker.priceChangePercent}
Hacim: ${ticker.volume}

Son mum verileri:
${history.slice(-30).map(k => `O:${k.open},H:${k.high},L:${k.low},C:${k.close},V:${k.volume}`).join('\n')}

Lütfen bir SHORT pozisyonu için analiz yap. Sadece JSON formatında yanıt ver.`;

      const response = await ai.models.generateContent({
        model: 'gemini-3-pro-preview',
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              score: { type: Type.NUMBER },
              rationale_tr: { type: Type.STRING },
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
          systemInstruction: "Sen profesyonel bir teknik analistsin. Sadece JSON yanıt ver."
        }
      });

      // Directly access .text property from GenerateContentResponse
      const text = response.text;
      return text ? JSON.parse(text) : null;
    } catch (error) {
      console.error('LLM Hatası:', error);
      return null;
    }
  }
};
