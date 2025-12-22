
/**
 * SENTINEL 24/7 BACKGROUND WORKER
 * Bu dosyayı bir Node.js ortamında (Railway, Render, VPS vb.) çalıştırın.
 * Gerekli paketler: npm install ws node-fetch
 */

const WebSocket = require('ws');
const fetch = require('node-fetch');

// AYARLAR (Çalıştırmadan önce doldurun)
const TELEGRAM_TOKEN = 'BURAYA_BOT_TOKEN_YAZIN';
const CHAT_ID = 'BURAYA_CHAT_ID_YAZIN';
const PUMP_THRESHOLD = 30; // %30 sıçrama eşiği

let activeAlerts = {}; // symbol -> { messageId, time }

async function updateTelegram(symbol, change, price) {
    const now = Date.now();
    const prev = activeAlerts[symbol];

    // 10 saniyede bir güncelleme (Sohbeti temiz tutar)
    if (prev && (now - prev.time < 10000)) return;

    const text = `🚀 *${symbol} AKTİF TAKİP*\n\n` +
                 `📈 Değişim: %${change.toFixed(2)}\n` +
                 `💵 Fiyat: $${price}\n` +
                 `⏰ Zaman: ${new Date().toLocaleTimeString('tr-TR')}\n\n` +
                 `☁️ Sentinel Bulut Modu Aktif`;

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
            // Edit olsa da olmasa da message_id'yi sakla
            activeAlerts[symbol] = { id: prev ? prev.id : data.result.message_id, time: now };
            console.log(`[OK] ${symbol} Güncellendi: %${change.toFixed(2)}`);
        } else {
            // Hata durumunda (mesaj silinmişse vb.) takibi sıfırla
            delete activeAlerts[symbol];
        }
    } catch (err) {
        console.error('[HATA] Telegram API:', err);
    }
}

function connect() {
    console.log('--- SENTINEL 24/7 ÇALIŞIYOR ---');
    const ws = new WebSocket('wss://fstream.binance.com/ws/!ticker@arr');

    ws.on('open', () => console.log('Bağlantı kuruldu, piyasa taranıyor...'));
    
    ws.on('message', (data) => {
        const tickers = JSON.parse(data);
        tickers.forEach(t => {
            if (!t.s.endsWith('USDT')) return;
            const change = parseFloat(t.P);
            const price = parseFloat(t.c);

            if (change >= PUMP_THRESHOLD) {
                updateTelegram(t.s, change, price);
            } else if (activeAlerts[t.s] && change < (PUMP_THRESHOLD - 5)) {
                // Fiyat %25 altına düşerse (5 puanlık marj) takibi bitir
                delete activeAlerts[t.s];
            }
        });
    });

    ws.on('close', () => {
        console.log('Bağlantı kesildi, 5 saniye içinde yeniden denenecek...');
        setTimeout(connect, 5000);
    });

    ws.on('error', (err) => console.error('[HATA] WebSocket:', err));
}

connect();
