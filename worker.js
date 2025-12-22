
/**
 * SENTINEL 24/7 BACKGROUND WORKER
 * Bu dosyayı bir Node.js ortamında (Railway, Render, VPS) çalıştırın.
 * Gerekli paketler: npm install ws node-fetch
 */

const WebSocket = require('ws');
const fetch = require('node-fetch');

// AYARLAR (Burayı kendi bilgilerinizle doldurun veya environment variable kullanın)
const TELEGRAM_TOKEN = 'BURAYA_BOT_TOKEN_YAZIN';
const CHAT_ID = 'BURAYA_CHAT_ID_YAZIN';
const PUMP_THRESHOLD = 30; // %30 ve üzeri

let tickerBuffer = {};
let activeAlerts = {}; // symbol -> { messageId, lastSentAt }

function updateTelegram(symbol, change, price) {
    const now = Date.now();
    const prev = activeAlerts[symbol];

    // 10 saniyede bir güncelleme kuralı
    if (prev && (now - prev.time < 10000)) return;

    const text = `🚨 *${symbol} 24/7 TAKİBİ*\n\n` +
                 `📈 Artış: %${change.toFixed(2)}\n` +
                 `💵 Fiyat: $${price}\n` +
                 `⏰ Sunucu Saati: ${new Date().toLocaleTimeString('tr-TR')}\n\n` +
                 `☁️ Bulut Sunucu Modu Aktif`;

    const method = prev ? 'editMessageText' : 'sendMessage';
    const body = {
        chat_id: CHAT_ID,
        text: text,
        parse_mode: 'Markdown'
    };
    if (prev) body.message_id = prev.id;

    fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    })
    .then(res => res.json())
    .then(data => {
        if (data.ok) {
            activeAlerts[symbol] = { id: prev ? prev.id : data.result.message_id, time: now };
            console.log(`[SENTINEL] ${symbol} güncellendi: %${change}`);
        } else {
            delete activeAlerts[symbol];
        }
    })
    .catch(err => console.error('Telegram Hatası:', err));
}

function connect() {
    const ws = new WebSocket('wss://fstream.binance.com/ws/!ticker@arr');

    ws.on('open', () => console.log('Binance Futures WebSocket Bağlandı.'));
    
    ws.on('message', (data) => {
        const tickers = JSON.parse(data);
        tickers.forEach(t => {
            if (!t.s.endsWith('USDT')) return;
            const change = parseFloat(t.P);
            const price = parseFloat(t.c);

            if (change >= PUMP_THRESHOLD) {
                updateTelegram(t.s, change, price);
            } else if (activeAlerts[t.s]) {
                delete activeAlerts[t.s];
            }
        });
    });

    ws.on('close', () => {
        console.log('Bağlantı koptu, yeniden bağlanılıyor...');
        setTimeout(connect, 5000);
    });

    ws.on('error', (err) => console.error('WS Hatası:', err));
}

connect();
