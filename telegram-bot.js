const TelegramBot = require('node-telegram-bot-api');
const botConfig = require('./config');

const TOKEN = '7693708409:AAF8USuKgxpJbTHI1juO_aWlhUIqew8bhmc';

function normalizeNumber(input) {
    const digits = (input || '').toString().replace(/\D/g, '');
    if (digits.startsWith('972')) {
        return digits;
    }
    if (digits.length === 10 && digits.startsWith('0')) {
        return '972' + digits.slice(1);
    }
    return digits;
}

function startTelegramBot() {
    const bot = new TelegramBot(TOKEN, { polling: true });
    const states = new Map(); // chatId -> { action: 'add'|'remove', number, confirmMsgId }

    const HELP_TEXT = 'ברוכים הבאים לבוט הניהול. כאן ניתן להוסיף או להסיר מספרים מהרשימה השחורה.\n' +
        'פקודות:\n' +
        '/blacklist - צפייה ברשימה השחורה\n' +
        '/add - הוספת מספר לרשימה\n' +
        '/remove - הסרת מספר מהרשימה';

    bot.onText(/\/start/, (msg) => {
        bot.sendMessage(msg.chat.id, HELP_TEXT);
    });

    bot.onText(/\/blacklist/, (msg) => {
        sendBlacklist(msg.chat.id, 0, bot);
    });

    bot.onText(/\/add/, (msg) => {
        states.set(msg.chat.id, { action: 'add' });
        bot.sendMessage(msg.chat.id, 'אנא שלח את מספר הטלפון שברצונך להוסיף לרשימה השחורה');
    });

    bot.onText(/\/remove/, (msg) => {
        states.set(msg.chat.id, { action: 'remove' });
        bot.sendMessage(msg.chat.id, 'אנא שלח את מספר הטלפון שברצונך להסיר מהרשימה השחורה');
    });

    bot.on('message', (msg) => {
        if (msg.text.startsWith('/')) return; // ignore commands handled above
        const state = states.get(msg.chat.id);
        if (!state || state.number) return;

        const num = normalizeNumber(msg.text);
        if (!num) {
            bot.sendMessage(msg.chat.id, 'מספר לא תקין, נסה שוב.');
            return;
        }
        state.number = num;
        const confirmKeyboard = {
            reply_markup: {
                inline_keyboard: [[
                    { text: 'אישור', callback_data: 'confirm' },
                    { text: 'ביטול', callback_data: 'cancel' }
                ]]
            }
        };
        bot.sendMessage(msg.chat.id, `האם אתה בטוח שברצונך ${state.action === 'add' ? 'להוסיף' : 'להסיר'} את ${num}?`, confirmKeyboard)
            .then(m => state.confirmMsgId = m.message_id);
    });

    bot.on('callback_query', (query) => {
        const state = states.get(query.message.chat.id);
        if (!state) return bot.answerCallbackQuery(query.id);

        if (query.data === 'cancel') {
            bot.editMessageText('פעולה בוטלה', { chat_id: query.message.chat.id, message_id: state.confirmMsgId });
            states.delete(query.message.chat.id);
        } else if (query.data === 'confirm') {
            const phone = state.number;
            if (state.action === 'add') {
                botConfig.addToBlacklist(phone);
                bot.editMessageText(`✅ ${phone} נוסף לרשימה השחורה`, { chat_id: query.message.chat.id, message_id: state.confirmMsgId });
            } else if (state.action === 'remove') {
                botConfig.removeFromBlacklist(phone);
                bot.editMessageText(`✅ ${phone} הוסר מהרשימה השחורה`, { chat_id: query.message.chat.id, message_id: state.confirmMsgId });
            }
            states.delete(query.message.chat.id);
        }
        bot.answerCallbackQuery(query.id);
    });
}

function sendBlacklist(chatId, page, bot) {
    const list = Array.from(botConfig.blacklistedUsers);
    if (list.length === 0) {
        bot.sendMessage(chatId, 'הרשימה השחורה ריקה');
        return;
    }
    const pageSize = 10;
    const totalPages = Math.ceil(list.length / pageSize);
    const start = page * pageSize;
    const items = list.slice(start, start + pageSize)
        .map((n, idx) => `${start + idx + 1}. ${n}`)
        .join('\n');
    const keyboard = [];
    const row = [];
    if (page > 0) row.push({ text: '⬅️', callback_data: `bl_${page - 1}` });
    if (page < totalPages - 1) row.push({ text: '➡️', callback_data: `bl_${page + 1}` });
    if (row.length) keyboard.push(row);
    bot.sendMessage(chatId, items, { reply_markup: { inline_keyboard: keyboard } });
}

module.exports = startTelegramBot;
