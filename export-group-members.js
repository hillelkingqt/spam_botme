const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const xlsx = require('xlsx');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');
const { cleanPhoneNumber } = require('./utilities');

const ADMIN_PHONES = ['972535349457@c.us', '972534707309@c.us', '972535352778@c.us']; // הוספת המספר החדש

const userState = new Map(); // שמירת סטייט לכל משתמש

// הגדרת תיקיית אחסון ייחודית לבוט החדש
const BOT_ID = 'export-bot-2';
const STORAGE_DIR = path.join(__dirname, `.wwebjs_auth_${BOT_ID}`);

// יצירת הלקוח עם הגדרות חדשות
const client = new Client({
    authStrategy: new LocalAuth({ 
        clientId: BOT_ID,
        dataPath: STORAGE_DIR
    }),
    puppeteer: {
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--disable-gpu',
            '--no-first-run',
            '--no-default-browser-check',
            '--disable-infobars',
            '--disable-extensions',
            '--disable-popup-blocking',
            '--hide-scrollbars',
            '--disable-notifications',
            '--window-size=1920,1080'
        ]
    }
});

// רשימת מנהלים מורשים - הוספת המספר החדש
const ADMIN_NUMBERS = [
    '972534707309@c.us',  // המספר המקורי
    '972509208807@c.us',  // מספר חדש
    '972529208290@c.us',  // מספר חדש
    '972535352778@c.us'   // המספר החדש
];

// יצירת תיקיית נתונים ייחודית לבוט החדש
const DATA_DIR = path.join(__dirname, `data_${BOT_ID}`);
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR);
}

// בדיקה אם המשתמש הוא מנהל
function isAdmin(userId) {
    return ADMIN_NUMBERS.includes(userId);
}

let adminGroupsCache = [];

client.on('qr', (qr) => {
    qrcode.generate(qr, { small: true });
    console.log('נא לסרוק את קוד ה-QR');
});

client.on('ready', async () => {
    console.log(`[${BOT_ID}] הבוט מוכן לשימוש!`);
});

client.on('message', async message => {
    try {
        // רק הודעות מהאדמין
        if (!ADMIN_PHONES.includes(message.from) && !ADMIN_PHONES.includes(message.author)) return;

        // שלב 1: בקשת קבוצות
        if (message.body.trim() === 'קבוצות') {
            const chats = await client.getChats();
            const groups = chats.filter(chat => chat.isGroup);

            // סנן רק קבוצות שאתה מנהל בהן
            const myId = client.info.wid._serialized;
            const adminGroups = groups.filter(group =>
                group.participants.some(p => p.id._serialized === myId && p.isAdmin)
            );

            if (adminGroups.length === 0) {
                await message.reply('לא נמצאו קבוצות שאתה מנהל בהן.');
                return;
            }

            adminGroupsCache = adminGroups; // שמור בזיכרון
            userState.set(message.from, { step: 'choose-group' });

            let list = '*בחר קבוצה לשליפת משתתפים:*\n';
            list += '1. כל הקבוצות\n';
            adminGroups.forEach((group, idx) => {
                list += `${idx + 2}. ${group.name}\n`;
            });
            list += '\nשלח את המספר של הקבוצה שתרצה לייצא';
            await message.reply(list);
            return;
        }

        // שלב 2: בחירת קבוצה
        const state = userState.get(message.from);
        if (state && state.step === 'choose-group') {
            const idx = parseInt(message.body.trim()) - 1;
            if (isNaN(idx) || idx < 0 || idx > adminGroupsCache.length) {
                await message.reply('בחירה לא חוקית. נסה שוב.');
                return;
            }
            if (idx === 0) {
                // כל הקבוצות
                await sendAllGroupsExcel(adminGroupsCache, message.from);
                userState.delete(message.from);
                return;
            }
            const group = adminGroupsCache[idx - 1];
            await sendGroupExcel(group, message.from);
            userState.delete(message.from);
            return;
        }

        // בדיקה אם ההודעה היא פרטית ומהמנהל המורשה
        if (!message.from.endsWith('@g.us') && isAdmin(message.from)) {
            const messageText = message.body.trim();

            // פקודת ייצוא
            if (messageText === 'ייצוא') {
                const instructions = `הוראות ייצוא חברי קבוצה:

שלח את מזהה הקבוצה (Group ID).
ניתן להשיג את המזהה על ידי:
1. כניסה לקבוצה
2. לחיצה על כותרת הקבוצה
3. גלילה למטה עד המזהה

לדוגמה:
120363418363310078@g.us

אני אייצא קובץ CSV עם:
✓ רשימת כל החברים בקבוצה
✓ המספרים שלהם
✓ השמות שלהם
✓ מי מנהל ומי לא`;
                
                await message.reply(instructions);
                return;
            }

            // בדיקה אם זה מזהה קבוצה
            if (messageText.endsWith('@g.us')) {
                await message.reply('מתחיל בייצוא חברי הקבוצה...');
                
                const result = await exportGroupMembers(messageText);
                
                if (result.success) {
                    const summary = `ייצוא הושלם בהצלחה!
                    
סיכום:
• סה"כ חברים: ${result.totalMembers}
• מתוכם מנהלים: ${result.admins}
• שם הקובץ: ${result.fileName}

הקובץ נשמר בתיקייה: ${result.filePath}`;
                    
                    await message.reply(summary);
                    
                    // שליחת הקובץ
                    const media = MessageMedia.fromFilePath(result.filePath);
                    await message.reply(media);
                } else {
                    await message.reply(`שגיאה בייצוא: ${result.error}`);
                }
                return;
            }
            
            // פקודת עזרה
            else if (messageText === '!help' || messageText === 'עזרה') {
                const help = `פקודות זמינות:
• שלח "ייצוא" לקבלת הוראות לייצוא חברי קבוצה
• או שלח ישירות את מזהה הקבוצה
• !help או עזרה - הצגת עזרה זו`;
                await message.reply(help);
            }
        }
    } catch (err) {
        console.error('שגיאה:', err);
        await message.reply('אירעה שגיאה. נסה שוב.');
    }
});

async function sendGroupExcel(group, to) {
    // שלוף את כל המשתתפים
    const members = group.participants.map(p => ({
        groupName: group.name,
        groupId: group.id._serialized,
        userId: p.id._serialized,
        phone: p.id.user,
        isAdmin: p.isAdmin ? 'admin' : 'member',
        name: p.name || ''
    }));

    // צור קובץ אקסל
    const safeGroupName = group.name.replace(/[^a-zA-Z0-9א-ת]/g, '_');
    const fileName = `קבוצה_${safeGroupName}.xlsx`;
    const ws = xlsx.utils.json_to_sheet(members);
    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, ws, 'Members');
    xlsx.writeFile(wb, fileName);

    // שלח את הקובץ
    const media = MessageMedia.fromFilePath(fileName);
    await client.sendMessage(to, media, { caption: `קובץ משתתפי הקבוצה "${group.name}"` });
    console.log(`נשלח קובץ ${fileName} ל-${to}`);
}

async function sendAllGroupsExcel(groups, to) {
    let allMembers = [];
    const seenPhones = new Set();
    groups.forEach(group => {
        group.participants.forEach(p => {
            if (!seenPhones.has(p.id.user)) {
                allMembers.push({
                    groupName: group.name,
                    groupId: group.id._serialized,
                    userId: p.id._serialized,
                    phone: p.id.user,
                    isAdmin: p.isAdmin ? 'admin' : 'member',
                    name: p.name || ''
                });
                seenPhones.add(p.id.user);
            }
        });
    });

    const fileName = `כל_המשתתפים_בכל_הקבוצות.xlsx`;
    const ws = xlsx.utils.json_to_sheet(allMembers);
    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, ws, 'AllMembers');
    xlsx.writeFile(wb, fileName);

    const media = MessageMedia.fromFilePath(fileName);
    await client.sendMessage(to, media, { caption: `כל המשתתפים בכל הקבוצות שלך (ללא כפילויות)` });
    console.log(`נשלח קובץ ${fileName} ל-${to}`);
}

// פונקציה לייצוא חברי קבוצה
async function exportGroupMembers(groupId) {
    try {
        const chat = await client.getChatById(groupId);
        if (!chat.isGroup) {
            return { success: false, error: 'זה לא מזהה של קבוצה' };
        }

        const participants = await chat.participants;
        const groupName = chat.name;
        
        // מידע על כל משתתף
        const membersInfo = await Promise.all(participants.map(async (participant) => {
            const contact = await client.getContactById(participant.id._serialized);
            return {
                number: participant.id.user,
                name: contact.name || contact.pushname || 'לא ידוע',
                isAdmin: participant.isAdmin
            };
        }));

        // יצירת קובץ CSV
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const fileName = `${groupName}_members_${timestamp}.csv`;
        const filePath = path.join(DATA_DIR, fileName);
        
        // כותרות הקובץ
        const headers = 'מספר טלפון,שם,מנהל\n';
        const content = membersInfo.map(member => 
            `${member.number},${member.name},${member.isAdmin ? 'כן' : 'לא'}`
        ).join('\n');

        fs.writeFileSync(filePath, headers + content, 'utf8');

        return {
            success: true,
            fileName,
            filePath,
            totalMembers: membersInfo.length,
            admins: membersInfo.filter(m => m.isAdmin).length
        };
    } catch (error) {
        console.error(`[${BOT_ID}] שגיאה בייצוא חברי קבוצה:`, error);
        return { success: false, error: error.message };
    }
}

client.initialize();