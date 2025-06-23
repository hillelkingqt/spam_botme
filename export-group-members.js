module.exports = (log, logError, mainClient) => {
    const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
    const xlsx = require('xlsx');
    const qrcode = require('qrcode-terminal');
    const fs = require('fs');
    const path = require('path');
    // const { cleanPhoneNumber } = require('./utilities'); // Assuming utilities.js might also need loggers or is simple enough

    const STAGE_PREFIX = "EXPORT_MEMBERS";
    const BOT_ID = 'export-bot-2'; // This seems specific to this bot instance
    log(`Initializing export-group-members module with BOT_ID: ${BOT_ID}`, STAGE_PREFIX);

    const ADMIN_PHONES = ['972535349457@c.us', '972534707309@c.us', '972535352778@c.us'];
    const userState = new Map();

    const STORAGE_DIR = path.join(__dirname, `.wwebjs_auth_${BOT_ID}`);
    log(`Storage directory for ${BOT_ID}: ${STORAGE_DIR}`, `${STAGE_PREFIX}_SETUP`);

    const client = new Client({
        authStrategy: new LocalAuth({ clientId: BOT_ID, dataPath: STORAGE_DIR }),
        puppeteer: {
            args: [
                '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas', '--disable-gpu', '--no-first-run',
                '--no-default-browser-check', '--disable-infobars', '--disable-extensions',
                '--disable-popup-blocking', '--hide-scrollbars', '--disable-notifications',
                '--window-size=1920,1080'
            ]
        }
    });
    log(`WhatsApp client instance for ${BOT_ID} created.`, `${STAGE_PREFIX}_SETUP`);

    const ADMIN_NUMBERS = ['972534707309@c.us', '972509208807@c.us', '972529208290@c.us', '972535352778@c.us'];
    log(`Admin numbers for ${BOT_ID}: ${ADMIN_NUMBERS.join(', ')}`, `${STAGE_PREFIX}_SETUP`);

    const DATA_DIR = path.join(__dirname, `data_${BOT_ID}`);
    if (!fs.existsSync(DATA_DIR)) {
        log(`Data directory ${DATA_DIR} does not exist, creating it.`, `${STAGE_PREFIX}_SETUP`);
        fs.mkdirSync(DATA_DIR);
    } else {
        log(`Data directory ${DATA_DIR} already exists.`, `${STAGE_PREFIX}_SETUP`);
    }

    function isAdmin(userId) {
        const isAdminUser = ADMIN_NUMBERS.includes(userId);
        log(`Checking if user ${userId} is admin for ${BOT_ID}: ${isAdminUser}`, `${STAGE_PREFIX}_AUTH`);
        return isAdminUser;
    }

    let adminGroupsCache = [];

    client.on('qr', (qr) => {
        const stage = `${STAGE_PREFIX}_QR`;
        log(`QR code received for ${BOT_ID}. Waiting for scan.`, stage);
        qrcode.generate(qr, { small: true });
        log('Please scan the QR code with WhatsApp.', stage);
    });

    client.on('ready', async () => {
        log(`[${BOT_ID}] הבוט מוכן לשימוש! Bot is ready!`, `${STAGE_PREFIX}_READY`);
    });

    client.on('message', async message => {
        const messageStage = `${STAGE_PREFIX}_MESSAGE[${message.id._serialized}]`;
        log(`Message received by ${BOT_ID} from ${message.from}. Author: ${message.author}. Body: "${message.body.substring(0,30)}..."`, messageStage);
        try {
            if (!ADMIN_PHONES.includes(message.from) && !ADMIN_PHONES.includes(message.author)) {
                log(`Message from non-admin ${message.from}/${message.author}. Ignoring for ${BOT_ID}.`, messageStage);
                return;
            }
            log(`Message from admin ${message.from}/${message.author} for ${BOT_ID}. Processing...`, messageStage);

            if (message.body.trim() === 'קבוצות') {
                const cmdStage = `${messageStage}_CMD_GROUPS`;
                log(`Admin command "קבוצות" received. Fetching groups.`, cmdStage);
                const chats = await client.getChats();
                const groups = chats.filter(chat => chat.isGroup);
                log(`Found ${groups.length} total groups. Filtering for admin groups.`, cmdStage);

                const myId = client.info.wid._serialized;
                const adminOnlyGroups = groups.filter(group =>
                    group.participants.some(p => p.id._serialized === myId && p.isAdmin)
                );
                log(`Found ${adminOnlyGroups.length} groups where ${BOT_ID} is admin.`, cmdStage);

                if (adminOnlyGroups.length === 0) {
                    log(`No groups found where ${BOT_ID} is admin. Replying to user.`, cmdStage);
                    await message.reply('לא נמצאו קבוצות שאתה מנהל בהן.');
                    return;
                }

                adminGroupsCache = adminOnlyGroups;
                userState.set(message.from, { step: 'choose-group' });
                log(`Cached ${adminOnlyGroups.length} admin groups. Set user state to 'choose-group'.`, cmdStage);

                let list = '*בחר קבוצה לשליפת משתתפים:*\n1. כל הקבוצות\n';
                adminOnlyGroups.forEach((group, idx) => { list += `${idx + 2}. ${group.name}\n`; });
                list += '\nשלח את המספר של הקבוצה שתרצה לייצא';
                await message.reply(list);
                log(`Sent group selection list to admin.`, cmdStage);
                return;
            }

            const state = userState.get(message.from);
            if (state && state.step === 'choose-group') {
                const choiceStage = `${messageStage}_CHOOSE_GROUP`;
                const idx = parseInt(message.body.trim()) - 1;
                log(`Admin selected option ${idx + 1}. Validating choice.`, choiceStage);
                if (isNaN(idx) || idx < 0 || idx > adminGroupsCache.length) {
                    logError(`Invalid group choice ${idx + 1} by admin. Max allowed: ${adminGroupsCache.length +1}. Replying.`, choiceStage);
                    await message.reply('בחירה לא חוקית. נסה שוב.');
                    return;
                }
                if (idx === 0) {
                    log(`Admin chose to export all groups.`, choiceStage);
                    await sendAllGroupsExcel(adminGroupsCache, message.from);
                } else {
                    const group = adminGroupsCache[idx - 1];
                    log(`Admin chose to export group: ${group.name} (ID: ${group.id._serialized})`, choiceStage);
                    await sendGroupExcel(group, message.from);
                }
                userState.delete(message.from);
                log(`User state deleted after choice.`, choiceStage);
                return;
            }

            if (!message.from.endsWith('@g.us') && isAdmin(message.from)) {
                const privateCmdStage = `${messageStage}_PRIVATE_CMD`;
                const messageText = message.body.trim();
                log(`Processing private command from admin ${message.from}: "${messageText}"`, privateCmdStage);

                if (messageText === 'ייצוא') {
                    log(`Admin requested export instructions.`, privateCmdStage);
                    // Instructions text...
                    await message.reply("הוראות ייצוא..."); // Shortened for brevity
                    return;
                }

                if (messageText.endsWith('@g.us')) {
                    log(`Admin provided group ID for export: ${messageText}`, privateCmdStage);
                    await message.reply('מתחיל בייצוא חברי הקבוצה...');
                    const result = await exportGroupMembers(messageText);
                    if (result.success) {
                        log(`Export successful for group ${messageText}. Total: ${result.totalMembers}, Admins: ${result.admins}. File: ${result.fileName}`, privateCmdStage);
                        // Summary text...
                        await message.reply(`ייצוא הושלם...`); // Shortened
                        const media = MessageMedia.fromFilePath(result.filePath);
                        await message.reply(media);
                        log(`Sent Excel file ${result.fileName} to admin.`, privateCmdStage);
                    } else {
                        logError(`Export failed for group ${messageText}: ${result.error}`, privateCmdStage);
                        await message.reply(`שגיאה בייצוא: ${result.error}`);
                    }
                    return;
                }

                if (messageText === '!help' || messageText === 'עזרה') {
                    log(`Admin requested help.`, privateCmdStage);
                    // Help text...
                    await message.reply("פקודות זמינות..."); // Shortened
                }
            }
        } catch (err) {
            logError(`Error in message handler for ${BOT_ID}: ${err.message}`, messageStage, err);
            await message.reply('אירעה שגיאה. נסה שוב.');
        }
    });

    async function sendGroupExcel(group, to) {
        const stage = `${STAGE_PREFIX}_SEND_EXCEL_SINGLE[${group.id._serialized}]`;
        log(`Preparing Excel for single group: ${group.name} for user ${to}`, stage);
        const members = group.participants.map(p => ({
            groupName: group.name, groupId: group.id._serialized, userId: p.id._serialized,
            phone: p.id.user, isAdmin: p.isAdmin ? 'admin' : 'member', name: p.name || ''
        }));
        log(`Processed ${members.length} members for Excel sheet.`, stage);

        const safeGroupName = (group.name || 'UnnamedGroup').replace(/[^a-zA-Z0-9א-ת]/g, '_');
        const fileName = `קבוצה_${safeGroupName}.xlsx`;
        const filePath = path.join(DATA_DIR, fileName); // Ensure DATA_DIR is used
        log(`Excel filename: ${fileName}, Path: ${filePath}`, stage);

        const ws = xlsx.utils.json_to_sheet(members);
        const wb = xlsx.utils.book_new();
        xlsx.utils.book_append_sheet(wb, ws, 'Members');
        xlsx.writeFile(wb, filePath);
        log(`Excel file written to ${filePath}`, stage);

        const media = MessageMedia.fromFilePath(filePath);
        await client.sendMessage(to, media, { caption: `קובץ משתתפי הקבוצה "${group.name}"` });
        log(`Sent Excel file ${fileName} to ${to}`, stage);
        fs.unlinkSync(filePath); // Clean up the file after sending
        log(`Deleted temporary Excel file ${filePath}`, stage);
    }

    async function sendAllGroupsExcel(groups, to) {
        const stage = `${STAGE_PREFIX}_SEND_EXCEL_ALL`;
        log(`Preparing Excel for all ${groups.length} admin groups for user ${to}`, stage);
        let allMembers = [];
        const seenPhones = new Set();
        groups.forEach(group => {
            const groupProcStage = `${stage}_GROUP_PROC[${group.id._serialized}]`;
            log(`Processing group ${group.name} for all-groups export.`, groupProcStage);
            group.participants.forEach(p => {
                if (!seenPhones.has(p.id.user)) {
                    allMembers.push({
                        groupName: group.name, groupId: group.id._serialized, userId: p.id._serialized,
                        phone: p.id.user, isAdmin: p.isAdmin ? 'admin' : 'member', name: p.name || ''
                    });
                    seenPhones.add(p.id.user);
                }
            });
            log(`Added ${group.participants.filter(p => !seenPhones.has(p.id.user)).length} new unique members from ${group.name}. Total unique members so far: ${allMembers.length}`, groupProcStage);
        });
        log(`Total ${allMembers.length} unique members compiled for all-groups Excel.`, stage);

        const fileName = `כל_המשתתפים_בכל_הקבוצות.xlsx`;
        const filePath = path.join(DATA_DIR, fileName);
        log(`All-groups Excel filename: ${fileName}, Path: ${filePath}`, stage);
        
        const ws = xlsx.utils.json_to_sheet(allMembers);
        const wb = xlsx.utils.book_new();
        xlsx.utils.book_append_sheet(wb, ws, 'AllMembers');
        xlsx.writeFile(wb, filePath);
        log(`All-groups Excel file written to ${filePath}`, stage);

        const media = MessageMedia.fromFilePath(filePath);
        await client.sendMessage(to, media, { caption: `כל המשתתפים בכל הקבוצות שלך (ללא כפילויות)` });
        log(`Sent all-groups Excel file ${fileName} to ${to}`, stage);
        fs.unlinkSync(filePath); // Clean up
        log(`Deleted temporary all-groups Excel file ${filePath}`, stage);
    }

    async function exportGroupMembers(groupId) {
        const stage = `${STAGE_PREFIX}_EXPORT_SINGLE_CSV[${groupId}]`;
        log(`Starting CSV export for group ID: ${groupId}`, stage);
        try {
            const chat = await client.getChatById(groupId);
            if (!chat.isGroup) {
                logError(`Provided ID ${groupId} is not a group.`, stage);
                return { success: false, error: 'זה לא מזהה של קבוצה' };
            }
            log(`Fetched chat: ${chat.name || groupId}. It is a group.`, stage);

            const participants = await chat.participants; // This might already be populated
            log(`Found ${participants.length} participants in group ${chat.name}. Fetching contact details.`, stage);
            const groupName = chat.name || 'UnnamedGroup';

            const membersInfo = await Promise.all(participants.map(async (participant) => {
                const contact = await client.getContactById(participant.id._serialized);
                return {
                    number: participant.id.user,
                    name: contact.name || contact.pushname || 'לא ידוע',
                    isAdmin: participant.isAdmin
                };
            }));
            log(`Processed contact details for all ${membersInfo.length} members.`, stage);

            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const safeGroupName = groupName.replace(/[^a-zA-Z0-9א-ת]/g, '_');
            const fileName = `${safeGroupName}_members_${timestamp}.csv`;
            const filePath = path.join(DATA_DIR, fileName);
            log(`CSV filename: ${fileName}, Path: ${filePath}`, stage);

            const headers = 'מספר טלפון,שם,מנהל\n';
            const content = membersInfo.map(member =>
                `${member.number},"${(member.name || '').replace(/"/g, '""')}",${member.isAdmin ? 'כן' : 'לא'}` // Added quotes for names
            ).join('\n');

            fs.writeFileSync(filePath, headers + content, 'utf8');
            log(`CSV file written to ${filePath}`, stage);

            return {
                success: true, fileName, filePath,
                totalMembers: membersInfo.length,
                admins: membersInfo.filter(m => m.isAdmin).length
            };
        } catch (error) {
            logError(`Error during CSV export for group ${groupId}: ${error.message}`, stage, error);
            return { success: false, error: error.message };
        }
    }

    client.initialize().then(() => {
        log(`Client for ${BOT_ID} initialized successfully.`, `${STAGE_PREFIX}_INIT`);
    }).catch(err => {
        logError(`Client initialization failed for ${BOT_ID}: ${err.message}`, `${STAGE_PREFIX}_INIT_FAIL`, err);
    });

    // Return any methods this module needs to expose, if any.
    // For now, it seems self-contained after initialization.
    return {
        clientInstance: client // Expose client if needed by other parts, though it seems to run independently
    };
};