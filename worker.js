
/**
 * SENTINEL 24/7 BACKGROUND WORKER
 * Bu dosyayı bir Node.js ortamında çalıştırın.
 * npm install ws node-fetch
 */

const WebSocket = require('ws');
const fetch = require('node-fetch');

// AYARLAR (Burayı kendi bilgilerinizle doldurun veya environment variable kullanın)
const TELEGRAM_TOKEN = 'BURAYA_BOT_TOKEN_YAZIN';
const CHAT_ID = 'BURAYA_CHAT_ID_YAZIN';
const PUMP_THRESHOLD = 30; // %30 ve üzeri

let activeAlerts = {}; // symbol -> { messageId, time }

async function updateTelegram(symbol, change, price) {
    const now = Date.now();
    const prev = activeAlerts[symbol];

    // 10 saniyede bir güncelleme kuralı (Sohbeti kirletmemek için)
    if (prev && (now - prev.time < 10000)) return;

    const text = `🚀 *${symbol} AKTİF TAKİP*\n\n` +
                 `📈 Değişim: %${change.toFixed(2)}\n` +
                 `💵 Fiyat: $${price}\n` +
                 `⏰ Sunucu Saati: ${new Date().toLocaleTimeString('tr-TR')}\n\n` +
                 `☁️ Sentinel 24/7 Bulut Modu`;

    const method = prev ? 'editMessageText' : 'sendMessage';
    const body = {
        chat_id: CHAT_ID,
        text: text,
        parse_mode: 'Markdown'
    };
    if (prev) body.message_id = prev.id;

    try {
        const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/${method}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        const data = await response.json();
        
        if (data.ok) {
            activeAlerts[symbol] = { id: prev ? prev.id : data.result.message_id, time: now };
            console.log(`[SENTINEL] ${symbol} %${change.toFixed(2)} - Mesaj Güncellendi.`);
        } else {
            // Eğer mesaj silinmişse veya hata varsa takibi sıfırla ki yeni mesaj atsın
            delete activeAlerts[symbol];
        }
    } catch (err) {
        console.error('Telegram API Hatası:', err);
    }
}

function connect() {
    console.log('Binance Futures Radarı Başlatılıyor...');
    const ws = new WebSocket('wss://fstream.binance.com/ws/!ticker@arr');

    ws.on('open', () => console.log('Bağlantı Kuruldu.'));
    
    ws.on('message', (data) => {
        const tickers = JSON.parse(data);
        tickers.forEach(t => {
            if (!t.s.endsWith('USDT')) return;
            const change = parseFloat(t.P);
            const price = parseFloat(t.c);

            if (change >= PUMP_THRESHOLD) {
                updateTelegram(t.s, change, price);
            } else if (activeAlerts[t.s] && change < (PUMP_THRESHOLD - 5)) {
                // Eşiğin altına düştüyse takibi listeden çıkar
                delete activeAlerts[t.s];
            }
        });
    });

    ws.on('close', () => {
        console.log('Bağlantı koptu, 5sn sonra yeniden denenecek...');
        setTimeout(connect, 5000);
    });

    ws.on('error', (err) => console.error('Bağlantı Hatası:', err));
}

connect();
