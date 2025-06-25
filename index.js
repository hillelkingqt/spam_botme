const fs = require('fs'); //The file system module in Node.js
const path = require('path'); //Path manipulator. 
const qrcode = require('qrcode-terminal'); //Displays a QR code in the terminal, usually for logging in to WhatsApp Web. 
//The WhatsApp bot uses this to log in when it first runs. We scan the QR code with my phone to link your WhatsApp account. 
const { Client, LocalAuth } = require('whatsapp-web.js'); //This is the core Whatsapp Automation library. 
//Client: The main bot class we create an instance of to listen to and send messages. 
//LocalAuth: Stores our session so we don't have to scan the QR every time.
const express = require('express'); //This creates a simple web server. Used in our bot to: 1. Host a dashboard. 2. Expose APIs (e.g, get bot status or statistics.)
//app is our web server object where we define routes like: app.get('/status', (req, res) => res.send('Bot is online'));
const app = express();
const http = require('http').createServer(app); //Wraps the Express app in raw HTTP server. This is required when we want to attach Socket.IO to our web server
const io = require('socket.io')(http); //Adds real-time communication on top of HTTP. We can now send data instantly from the bot to the browser(dashboard UI).
//Example: Show live messages, online status, or test progress updates.
const botConfig = require('./config'); //Loads our shared configurtaion manager. A singleton object that holds:
// * Approved Users.
// * Group List.
// * Blacklist
// * Admins
// And it persists these settings to disk.
const cron = require('node-cron');
const TelegramBot = require('node-telegram-bot-api');
const {
    hasPassedTest, //Checks if a user passed the verification quiz.
    addApprovedUser,//Marks user as approved (Writes to JSON via botConfig)
    generateTestQuestion, //Returns a random question(Text or emoji style)
    addSuspiciousActivity, /// Logs suspicious behavior(e.g., spam or links)
    checkInappropriateLanguage, //Detects bad words in a message. 
    addLanguageWarning, //Increments user's strike count
    shouldRemoveForLanguage, //Checks if user should be removed (based on warnings)
    analyzeSuspiciousContent, //Parses for risky Pattersn(e.g., URLs + keywords)
    getApprovedUsers //Returns the full list of verified users. 
} = require('./test-logic');
const joinRequestsModule = require('./join-requests');
//const statistics = require('./statistics'); //Likely tracks: 1. "How many users were tested", 2. "How many were banned" 3. "How many messages were handled"
const os = require('os'); //Proivdes system-level info such as: 1. Hostname, CPU load. 2. memory usage. 3. Platform(win32, linux, etc.)
//Useful for debug logs or dispaying server health in a web dashboard. 
//const {handleAdminMessage} = require('./admin-logic'); //That gives your trusted admins power to control the bot remotely via Whatsapp. 
const { group } = require('console');

// הגדרת תיקיית הview
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// הגדרת תיקיית הstatic files
app.use(express.static(path.join(__dirname, 'public')));

// הגדרת middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const TEST_GROUP_ID = '120363346219705470@g.us';
const Test2 = '120363400062535302@g.us';

// הגדרת נתיבים
const approvedPath = path.join(__dirname, 'approved-users.json');

// מיד אחרי טעינת הקונפיגורציה, נוסיף את קבוצת הטסט לקבוצות המנוהלות
log('בודק אם קבוצת הטסט כבר מנוהלת...', 'CONFIG');
if (!botConfig.isManagedGroup(TEST_GROUP_ID)) {
    log('מוסיף את קבוצת הטסט לקבוצות מנוהלות...', 'CONFIG');
    botConfig.addManagedGroup(TEST_GROUP_ID);
} else {
    log('קבוצת הטסט כבר מנוהלת', 'CONFIG');
}

// הוספת הקבוצה השנייה
log('בודק אם הקבוצה השנייה כבר מנוהלת...', 'CONFIG');
if (!botConfig.isManagedGroup(Test2)) {
    log('מוסיף את הקבוצה השנייה לקבוצות מנוהלות...', 'CONFIG');
    botConfig.addManagedGroup(Test2);
} else {
    log('הקבוצה השנייה כבר מנוהלת', 'CONFIG');
}

// מערך הקבוצות המנוהלות - עדכון להכיל את שתי הקבוצות
const managedGroups = new Set([TEST_GROUP_ID, Test2]);

// קביעת נתיב הדפדפן לפי מערכת ההפעלה
let chromePath = null;
if (os.platform() === 'darwin') {
    chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
} else if (os.platform() === 'linux') {
    if (fs.existsSync('/usr/bin/chromium-browser')) {
        chromePath = '/usr/bin/chromium-browser';
    } else if (fs.existsSync('/usr/bin/chromium')) {
        chromePath = '/usr/bin/chromium';
    } else if (fs.existsSync('/usr/bin/google-chrome')) {
        chromePath = '/usr/bin/google-chrome';
    } else {
        chromePath = null;
    }
} else if (os.platform() === 'win32') {
    // Common Chrome paths on Windows
    const winPaths = [
        process.env.LOCALAPPDATA + '\\Google\\Chrome\\Application\\chrome.exe',
        process.env.PROGRAMFILES + '\\Google\\Chrome\\Application\\chrome.exe',
        process.env['PROGRAMFILES(X86)'] + '\\Google\\Chrome\\Application\\chrome.exe'
    ];
    for (const path of winPaths) {
        if (fs.existsSync(path)) {
            chromePath = path;
            break;
        }
    }
    if (!chromePath) {
        logError('Could not find Chrome executable on Windows', 'SETUP');
    }
}

const client = new Client({
    authStrategy: new LocalAuth({
        dataPath: './wwebjs_auth_custom',
        clientId: "bot_972535349587" // כאן משנים את מספר הטלפון - צריך להחליף את המספר אחרי bot_ למספר החדש שתרצה
    }),
    puppeteer: {
        headless: true,
        ...(chromePath ? { executablePath: chromePath } : {}),
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--disable-gpu',
            '--window-size=1920x1080',
            '--user-data-dir=./wwebjs_auth_custom'
        ]
    },
    qrMaxRetries: 3,
    takeoverOnConflict: true,
    takeoverTimeoutMs: 0,
    restartOnAuthFail: true,
    session: {
        path: './wwebjs_auth_custom/session.json',
        save: true
    }
});

// מפת המבחנים הפעילים
const activeTests = new Map();
const TEST_TIMEOUT = 6 * 60 * 1000; // 6 דקות
const MAX_RETRIES = 1; // מספר מקסימלי של ניסיונות למבחן
let botNumber = ''; // נשמור את המספר של הבוט
let isClientReady = false;

// הוספת מנגנון התאוששות
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_DELAY = 5000; // 5 שניות

// תור גלובלי להודעות
const messageQueue = [];
let isProcessingQueue = false;

// מפת מצב המשתמשים
const userStates = new Map();

// ----- Telegram Bot Setup -----
const telegramToken = '7693708409:AAF8USuKgxpJbTHI1juO_aWlhUIqew8bhmc';
const telegramBot = new TelegramBot(telegramToken, { polling: true });
const telegramStates = new Map(); // chatId -> state

// הוספת מפת משתמשים שצריכים לפנות לבוט
const pendingUsers = new Map(); // userId -> {groupId, timestamp, messageId}

// הוספת מפות חדשות
const retryUsers = new Map(); // userId -> {groupId, timestamp, attempts}
const blacklistedUsers = new Set(); // userIds

// הוספת מפה לשמירת הודעות קישור
const linkMessages = new Map(); // userId -> {groupId, messageId, timestamp}

// הוספת מפה לשמירת מספר הניסיונות של כל משתמש
const testAttempts = new Map(); // userId -> {attempts: number, lastAttempt: timestamp}

// הוספת רשימת מנהלים מורשים
const ADMIN_NUMBERS = new Set([
    '972535349457@c.us', // 0535349457 - מנהל
    '972584828855@c.us', // 0584828855 - מנהל
    '972542332128@c.us',
    '972535349587@c.us',  // 0535349587 - מספר הבוט
    //'972549232327@c.us', //מספר הפאלפון האישי שלי
    //New Numbers:
    '972535349457@c.us',
    '972535352778@c.us'
]);

const IMMUNE_NUMBERS = new Set([
    '972528828855@c.us',
    '972535352778@c.us',
    '972542332128@c.us',
    //'972535349818@c.us',
    '972544606004@c.us',
    '972535349425@c.us',
    '972506572632@c.us',
    '972535349409@c.us',
    '972504745554@c.us',
    // המנהלים גם חסינים
    '972535349457@c.us',
    '972584828855@c.us',
    '972535349587@c.us',  // 0535349587 - מספר הבוט
    //New Numbers:
    '972584828855@c.us',
    '972527828855@c.us',
    '972542332128@c.us',
    '972535349425@c.us',
    '972535349409@c.us'
]);

// מאושרים (דינאמי)
let APPROVED_USERS;
try {
    const approvedData = fs.readFileSync(path.join(__dirname, 'approved-users.json'), 'utf8');
    APPROVED_USERS = new Set(JSON.parse(approvedData).map(normalizeId));
} catch (error) {
    logError('שגיאה בטעינת המשתמשים המאושרים:', 'CONFIG_LOAD', error);
    APPROVED_USERS = new Set();
}

// רשימה שחורה (נטען מקובץ/זיכרון)
// The BLACKLIST variable will now reference the Set managed by botConfig.
let BLACKLIST = botConfig.blacklistedUsers;
// Ensure botConfig is initialized and blacklistedUsers is available before this line.
// If botConfig.blacklistedUsers is not a Set or needs different handling, this will need adjustment.
try {
    // Verify that BLACKLIST is a Set, if not, initialize or log error
    if (!(BLACKLIST instanceof Set)) {
        logError('botConfig.blacklistedUsers is not a Set, initializing BLACKLIST as a new Set.', 'CONFIG_LOAD');
        BLACKLIST = new Set(); // Fallback, though ideally botConfig handles this.
    }
} catch (error) {
    logError('שגיאה בהפניית הרשימה השחורה מ-botConfig:', 'CONFIG_LOAD', error);
    BLACKLIST = new Set(); // Fallback
}

// רשימת מנהלים לקבלת התראות
const ALERT_ADMIN_NUMBERS = new Set([
    '972535349457@c.us'    // +972 50-566-7709
]);

// הוספת מפה לשמירת משתמשים שנכשלו פעם אחת
const failedOnceUsers = new Map(); // userId -> {timestamp, groupId}

// הוספת מפה לשמירת קישורי קבוצות
const groupLinks = new Map(); // groupId -> inviteLink

// הוספת מפה לשמירת מיפוי בין מספרים סידוריים למזהי קבוצות
const groupNumberToId = new Map();

// טעינת מבחנים מקובץ
let tests = {};
try {
    const testsPath = path.join(__dirname, 'tests.json');
    tests = JSON.parse(fs.readFileSync(testsPath, 'utf8'));
} catch (error) {
    logError('שגיאה בטעינת קובץ המבחנים:', 'CONFIG_LOAD', error);
    tests = {
        basic_verification: {
            title: "מבחן אימות בסיסי",
            questions: [
                {
                    question: "מהי מטרת הקבוצה?",
                    options: ["שיתוף תוכן ומידע", "שיחות חברתיות בלבד", "שיווק מוצרים", "הפצת ספאם"],
                    correct: 0
                },
                {
                    question: "האם אתה מסכים לכללי הקבוצה?",
                    options: ["כן, אני מסכים לכללים", "לא, אני לא מסכים", "אני לא בטוח", "אני אקרא את הכללים אחר כך"],
                    correct: 0
                }
            ],
            passing_score: 1
        }
    };
}

// הוספת פונקציית לוג לקובץ
function log(message, stage = "GENERAL") {
    const timestamp = new Date().toISOString();
    const stageString = `[${stage.toUpperCase()}]`;
    const logMessage = `${timestamp} ${stageString} - ${message}\n`;
    const consoleMessage = `${stageString} ${message}`;

    // הדפסה לקונסול
    console.log(consoleMessage);

    // כתיבה לקובץ
    fs.appendFileSync('bot.log', logMessage);
}

// הוספת פונקציית לוג שגיאות לקובץ
function logError(message, stage = "ERROR", errorObject = null) {
    const timestamp = new Date().toISOString();
    const stageString = `[${stage.toUpperCase()}]`;
    const logMessage = `${timestamp} ${stageString} - ${message}\n`;
    const consoleMessage = `${stageString} ${message}`;

    // הדפסה לקונסול
    console.error(consoleMessage);
    if (errorObject && errorObject.stack) {
        console.error(errorObject.stack);
    }

    // כתיבה לקובץ
    fs.appendFileSync('bot.error.log', logMessage);
    if (errorObject && errorObject.stack) {
        fs.appendFileSync('bot.error.log', errorObject.stack + '\n');
    }
}

// Initialize modules that require logging functions
const joinRequestsFunctions = joinRequestsModule(log, logError);
const { handleJoinRequest, handleJoinTestResponse, hasActiveJoinTest } = joinRequestsFunctions;

const removeUserFixModule = require('./remove-user-fix');
const { removeUserFromGroupFixed, kickUserFromAllGroupsFixed } = removeUserFixModule({
    log,
    logError,
    formatPhoneNumberToE164,
    isGroupAdmin,
    addToBlacklist,
    botConfig
});


async function initializeClient() {
    try {
        log('🚀 מתחיל את הבוט...', 'INITIALIZATION');
        log(`Using Chrome path: ${chromePath}`, 'INITIALIZATION');
        log(`Puppeteer config: ${JSON.stringify(client.options.puppeteer)}`, 'INITIALIZATION');

        // Clear session if exists
        const sessionPath = path.join(__dirname, 'wwebjs_auth_custom', 'session-bot_972535349587');
        if (fs.existsSync(sessionPath)) {
            log('Deleting existing session directory...', 'INITIALIZATION');
            fs.rmSync(sessionPath, { recursive: true, force: true });
        }

        await client.initialize();
        log('✨ הבוט אותחל בהצלחה!', 'INITIALIZATION');
        reconnectAttempts = 0;
    } catch (error) {
        logError('❌ שגיאה באתחול הבוט:', 'INITIALIZATION', error);
        logError(`Error details: Message: ${error.message}`, 'INITIALIZATION_DETAIL');

        if (error.message.includes('Failed to launch the browser process')) {
            logError('Browser launch failed. Possible solutions:', 'INITIALIZATION_BROWSER_ERROR');
            logError('1. Install Chrome: https://www.google.com/chrome/', 'INITIALIZATION_BROWSER_ERROR');
            logError('2. Set correct Chrome path in config', 'INITIALIZATION_BROWSER_ERROR');
            logError('3. Run: npm install puppeteer', 'INITIALIZATION_BROWSER_ERROR');
        }

        if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
            reconnectAttempts++;
            log(`מנסה להתחבר שוב... ניסיון ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}`, 'RECONNECTION');
            setTimeout(initializeClient, RECONNECT_DELAY);
        } else {
            logError('❌ הגענו למספר המקסימלי של ניסיונות התחברות', 'RECONNECTION_FAILURE');
            logError('Try deleting the wwebjs_auth_custom folder and restarting', 'RECONNECTION_FAILURE');
        }
    }
}

client.on('disconnected', (reason) => {
    logError(`❌ הבוט התנתק: ${reason}`, 'CONNECTION');
    if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        reconnectAttempts++;
        log(`מנסה להתחבר שוב... ניסיון ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}`, 'RECONNECTION');
        setTimeout(initializeClient, RECONNECT_DELAY);
    }
});

client.on('authenticated', async () => {
    log('🔒 הבוט אומת בהצלחה.', 'AUTHENTICATION');
    client.pupBrowser = client.pupBrowser || (await client.pupPage.browser());
});

client.on('qr', qr => {
    log('⌛ ממתין לסריקת קוד QR...', 'QR_CODE');
    qrcode.generate(qr, { small: true });
});

client.on('ready', async () => {
    log('✅ הבוט מחובר ומוכן!', 'READY');
    log(`מספר הבוט: ${client.info.wid._serialized}`, 'INFO');

    await addAllManagedGroups(client);
    await generateGroupLinks(client);

    log(`מצב נוכחי: מנוהלות ${botConfig.managedGroups.size} קבוצות, מאושרים ${botConfig.approvedUsers.size} משתמשים.`, 'STATE');

    isClientReady = true;
    client.isReady = true;

    setInterval(async () => {
        log('מתחיל בדיקת הודעות ישנות תקופתית...', 'MAINTENANCE_OLD_MESSAGES');
        await checkOldMessages(client);
        log('סיים בדיקת הודעות ישנות תקופתית', 'MAINTENANCE_OLD_MESSAGES');
    }, 60 * 60 * 1000);
});

client.on('auth_failure', msg => {
    logError(`❌ בעיית אימות: ${msg}`, 'AUTHENTICATION_FAILURE');
});
/*
async function isGroupAdmin(client, groupId) {
    try {
        const chat = await client.getChatById(groupId);
        const botId = client.info.wid._serialized;
        const isAdmin = chat.participants.some(p => p.id._serialized === botId && p.isAdmin);
        return isAdmin;
    } catch (error) {
        logError(`שגיאה בבדיקת הרשאות מנהל עבור קבוצה ${groupId}:`, 'ADMIN_CHECK', error);
        return false;
    }
}*/
/**
 * True iff the bot is currently an admin in the given group.
 * Works with every whatsapp-web.js release (old and new schemas).
 */
/**
 * Reliable admin check for whatsapp-web.js 1.30.x
 * (1) pulls the live admin list
 * (2) compares against the bot JID
 */
/**
 * Enhanced function to reliably check if the bot is an admin in a group
 * Includes multiple detection methods, detailed logging, and error handling
 * @param {Object} client - The WhatsApp client instance
 * @param {String} groupId - The ID of the group to check
 * @returns {Promise<boolean>} - True if bot is admin, false otherwise
 */
async function isGroupAdmin(client, groupId) {
    const stage = "ADMIN_CHECK";
    try {
        log(`Checking admin status for group: ${groupId}`, stage);
        const botId = client.info.wid._serialized;
        log(`Bot ID: ${botId}`, stage);

        // Method 1: Standard participant check
        try {
            if (!groupId) {
                logError(`Invalid groupId passed to isGroupAdmin: ${groupId}`, stage);
                throw new Error("Invalid groupId provided to isGroupAdmin");
            }
            const chat = await client.getChatById(groupId);
            if (!chat || !chat.id || !chat.id._serialized) {
                logError(`getChatById returned invalid chat object or chat.id for groupId: ${groupId}. Chat object: ${JSON.stringify(chat)}`, stage);
                throw new Error("Invalid chat object or chat.id received from getChatById");
            }
            log(`Got chat: ${chat.name || groupId}`, stage);

            // Try to refresh metadata if possible
            if (typeof chat.fetchAllMetadata === 'function') {
                await chat.fetchAllMetadata();
                log(`Refreshed metadata for group`, stage);
            }

            let participants = [];

            // Try different methods to get participants
            if (typeof chat.getParticipants === 'function') {
                participants = await chat.getParticipants();
                log(`Got ${participants.length} participants using getParticipants()`, stage);
            } else if (Array.isArray(chat.participants)) {
                participants = chat.participants;
                log(`Got ${participants.length} participants from chat.participants array`, stage);
            }

            if (participants.length > 0) {
                // Log all admins for debugging
                const admins = participants
                    .filter(p => p.isAdmin)
                    .map(p => p.id._serialized || (p.id && p.id._serialized) || 'unknown');
                log(`Group admins: ${JSON.stringify(admins)}`, stage);

                // Check if bot is in admin list
                const isAdmin = participants.some(p => {
                    const participantId = p.id._serialized || (p.id && p.id._serialized);
                    return participantId === botId && p.isAdmin;
                });

                if (isAdmin) {
                    log(`Bot found as admin using standard method`, stage);
                    return true;
                }
            }
        } catch (error) {
            logError(`Error in standard admin check for group ${groupId}:`, stage, error);
            // If Method 1 fails, we will now fall through to the final return false
        }

        // If Method 1 did not return true (either failed or bot is not admin)
        log(`Method 1 did not confirm admin status for group ${groupId}`, stage);
        return false;

    } catch (error) {
        logError(`Critical error checking admin status for group ${groupId}:`, stage, error);
        return false;
    }
}





// הוספת פונקציה לבדיקת מספר הניסיונות
function getTestAttempts(userId) {
    if (!testAttempts.has(userId)) {
        testAttempts.set(userId, { attempts: 0, lastAttempt: 0 });
    }
    return testAttempts.get(userId);
}

// הוספת פונקציה לעדכון מספר הניסיונות
function updateTestAttempts(userId, passed) {
    const attempts = getTestAttempts(userId);
    if (passed) {
        attempts.attempts = 0; // איפוס הניסיונות אם עבר
    } else {
        attempts.attempts++;
    }
    attempts.lastAttempt = Date.now();
    testAttempts.set(userId, attempts);
}

// הוספת פונקציה לבדיקת רשימה שחורה
function isBlacklisted(userId) {
    const id = normalizeId(userId);
    log(`Checking blacklist for user: ${id}. Blacklist size: ${BLACKLIST.size}`, "BLACKLIST_CHECK");
    return BLACKLIST.has(id);
}

// הוספת פונקציה לשליחת הודעה לכל הקבוצות
async function broadcastMessage(client, message, isPinned = false) {
    const stage = "BROADCAST";
    try {
        log(`מתחיל שליחת הודעה ${isPinned ? 'מוצמדת' : 'רגילה'} לכל הקבוצות`, stage);
        const managedGroupsArray = Array.from(botConfig.managedGroups);
        log(`Managed groups for broadcast: ${JSON.stringify(managedGroupsArray)}`, stage);

        for (const groupId of managedGroupsArray) {
            try {
                const chat = await client.getChatById(groupId);
                log(`Preparing to send to group: ${chat.name || groupId} (${groupId})`, stage);
                const isAdmin = await isGroupAdmin(client, groupId);
                if (!isAdmin) {
                    log(`הבוט אינו מנהל את הקבוצה ${chat.name || groupId}, מדלג על שליחת הודעה`, stage);
                    await sendAdminAlert(client, `הבוט אינו מנהל את הקבוצה ${chat.name || groupId} ולכן לא יכול לשלוח הודעה משודרת.`);
                    continue;
                }

                log(`שולח הודעה לקבוצה: ${chat.name || groupId} (${groupId})`, stage);
                const sentMessage = await chat.sendMessage(message);
                log(`Message sent to ${chat.name || groupId}. Message ID: ${sentMessage.id._serialized}`, stage);

                if (isPinned) {
                    try {
                        await sentMessage.pin();
                        log(`הודעה הוצמדה בקבוצה ${chat.name || groupId}`, stage);
                    } catch (error) {
                        logError(`שגיאה בהצמדת הודעה בקבוצה ${chat.name || groupId}:`, stage, error);
                        await sendAdminAlert(client, `שגיאה בהצמדת הודעה בקבוצה ${chat.name || groupId}`);
                    }
                }
                log(`נשלחה והושלמה הודעה לקבוצה ${chat.name || groupId}`, stage);
            } catch (error) {
                logError(`שגיאה בשליחת הודעה לקבוצה ${groupId}:`, stage, error);
                await sendAdminAlert(client, `שגיאה בשליחת הודעה לקבוצה ${groupId}`);
            }
        }
        log('סיים שליחת הודעה לכל הקבוצות', stage);
    } catch (error) {
        logError('שגיאה קריטית בפונקציית broadcastMessage:', stage, error);
        await sendAdminAlert(client, 'שגיאה קריטית בשליחת הודעה לכל הקבוצות');
    }
}

// הוספת פונקציה ליצירת קישורי קבוצות
async function generateGroupLinks(client) {
    const stage = "GROUP_LINKS";
    try {
        log('מתחיל יצירת קישורי קבוצות...', stage);
        const managedGroupsArray = Array.from(botConfig.managedGroups);
        log(`Generating links for managed groups: ${JSON.stringify(managedGroupsArray)}`, stage);

        for (const groupId of managedGroupsArray) {
            try {
                if (!botConfig.isManagedGroup(groupId)) {
                    log(`הקבוצה ${groupId} אינה מנוהלת, מדלג על יצירת קישור`, stage);
                    continue;
                }

                const chat = await client.getChatById(groupId);
                log(`Processing group for link: ${chat.name || groupId}`, stage);
                const isAdmin = await isGroupAdmin(client, groupId);
                if (!isAdmin) {
                    log(`הבוט אינו מנהל את הקבוצה ${chat.name || groupId}, מדלג על יצירת קישור`, stage);
                    continue;
                }

                const inviteCode = await chat.getInviteCode();
                const inviteLink = `https://chat.whatsapp.com/${inviteCode}`;
                groupLinks.set(groupId, inviteLink);
                log(`נוצר קישור לקבוצה ${chat.name || groupId}: ${inviteLink}`, stage);
            } catch (error) {
                logError(`שגיאה ביצירת קישור לקבוצה ${groupId}:`, stage, error);
            }
        }
        log('סיים יצירת קישורי קבוצות', stage);
    } catch (error) {
        logError('שגיאה קריטית בפונקציית generateGroupLinks:', stage, error);
    }
}

// הוספת פונקציה לשליחת רשימת קבוצות
async function sendGroupList(client, userId) {
    const stage = "SEND_GROUP_LIST";
    try {
        log(`Preparing to send group list to user ${userId}`, stage);
        const groups = Array.from(botConfig.managedGroups);
        let message = 'רשימת הקבוצות הזמינות:\n';
        if (groups.length === 0) {
            message += 'אין קבוצות מנוהלות כרגע.';
            log(`No managed groups to send for user ${userId}`, stage);
        } else {
            groups.forEach((groupId, index) => {
                // Attempt to get group name for a more user-friendly list
                const groupChat = groupNumberToId.get(index + 1) ? client.getChatById(groupNumberToId.get(index + 1)) : null; // This is a bit of a guess
                const groupName = groupChat && groupChat.name ? groupChat.name : groupId;
                message += `${index + 1}. ${groupName}\n`;
            });
            message += '\nכדי לקבל קישור לקבוצה, שלח את מספר הקבוצה המבוקש (למשל: 1, 2, 3).';
            log(`Sending group list to ${userId}: ${groups.length} groups.`, stage);
        }
        await client.sendMessage(userId, message);
        log(`Group list sent to ${userId}`, stage);
    } catch (error) {
        logError(`Error sending group list to ${userId}:`, stage, error);
    }
}


// הוספת פונקציה לשליחת קישור לקבוצה
async function sendGroupLink(client, userId, groupNumber) {
    const stage = "SEND_GROUP_LINK";
    try {
        log(`Attempting to send group link for group number ${groupNumber} to user ${userId}`, stage);
        if (!groupNumberToId.has(groupNumber)) {
            log(`Invalid group number ${groupNumber} requested by ${userId}`, stage);
            await client.sendMessage(userId, 'מספר קבוצה לא תקין. אנא שלח מספר קבוצה מהרשימה.');
            return;
        }
        const groupId = groupNumberToId.get(groupNumber);
        log(`Group ID for number ${groupNumber} is ${groupId}`, stage);

        if (!botConfig.isManagedGroup(groupId)) {
            log(`Group ${groupId} is not managed. Cannot send link to ${userId}.`, stage);
            await client.sendMessage(userId, 'קבוצה זו אינה מנוהלת.');
            return;
        }
        const isAdmin = await isGroupAdmin(client, groupId);
        if (!isAdmin) {
            log(`Bot is not admin in group ${groupId}. Cannot send link to ${userId}.`, stage);
            await client.sendMessage(userId, 'אין לי גישה לקבוצה זו.');
            return;
        }
        if (!groupLinks.has(groupId)) {
            log(`Link for group ${groupId} not cached. Generating now.`, stage);
            const chat = await client.getChatById(groupId);
            const inviteCode = await chat.getInviteCode();
            const inviteLink = `https://chat.whatsapp.com/${inviteCode}`;
            groupLinks.set(groupId, inviteLink);
            log(`Generated and cached link for group ${groupId}: ${inviteLink}`, stage);
        }
        const link = groupLinks.get(groupId);
        await client.sendMessage(userId, `קישור לקבוצה ${groupNumberToId.get(groupNumber) || groupId}:\n${link}`);
        log(`Sent group link for ${groupId} to user ${userId}`, stage);
    } catch (error) {
        logError(`Error sending group link for group number ${groupNumber} to user ${userId}:`, stage, error);
        await client.sendMessage(userId, 'שגיאה בשליחת הקישור. אנא נסה שוב מאוחר יותר.');
    }
}


const prohibitedWords = [
    // אלישע קליימן
    "אלישע קליימן", "שאלישע קליימן", "באלישע קליימן", "לאלישע קליימן", "מאלישע קליימן", "כאלישע קליימן",
    "ואלישע קליימן", "האלישע קליימן", "מהאלישע קליימן", "שלהאלישע קליימן", "שבאלישע קליימן", 'שב"אלישע קליימן"',

    // קורס חיצוני
    "קורס חיצוני", "שקורס חיצוני", "בקורס חיצוני", "לקורס חיצוני", "מק ורס חיצוני", "כקורס חיצוני",
    "וקורס חיצוני", "הקורס חיצוני", "מהקורס חיצוני", "שלקורס חיצוני", "שבקורס חיצוני", 'שב"קורס חיצוני"',

    // לפרסם
    "לפרסם",

    // בקרו באתר שלי
    "בקרו באתר שלי", "שבקרו באתר שלי", "בבקרו באתר שלי", "לבקרו באתר שלי", "מבקרו באתר שלי",
    "כבקרו באתר שלי", "ובקרו באתר שלי", "הבקרו באתר שלי", "מהבקרו באתר שלי", "שלבקרו באתר שלי",
    'שב"בקרו באתר שלי"',

    // פרטים נוספים בפרטי
    "פרטים נוספים בפרטי", "שפרטים נוספים בפרטי", "בפרטים נוספים בפרטי", "לפרטים נוספים בפרטי",
    "מפרטים נוספים בפרטי", "כפרטים נוספים בפרטי", "ופרטים נוספים בפרטי", "הפרטים נוספים בפרטי",
    "מהפרטים נוספים בפרטי", "שלפרטים נוספים בפרטי", 'שב"פרטים נוספים בפרטי"',

    // עזרה במבחן
    "עזרה במבחן", "שעזרה במבחן", "בעזרה במבחן", "לעזרה במבחן", "מעזרה במבחן", "כעזרה במבחן",
    "ועזרה במבחן", "העזרה במבחן", "מהעזרה במבחן", "שלעזרה במבחן", 'שב"עזרה במבחן"',

    // סטטיסטיקל
    "סטטיסטיקל", "שסטטיסטיקל", "בסטטיסטיקל", "לסטטיסטיקל", "מסטטיסטיקל", "כסטטיסטיקל",
    "וסטטיסטיקל", "הסטטיסטיקל", "מהסטטיסטיקל", "שלסטטיסטיקל", "שבסטטיסטיקל",

    // רגב גוטמן
    "רגב גוטמן", "שרגב גוטמן", "ברגב גוטמן", "לרגב גוטמן", "מרגב גוטמן", "כרגב גוטמן",
    "ורגב גוטמן", "הרגב גוטמן", "מהרגב גוטמן", "שלרגב גוטמן",

    // רגב גורטמן
    "רגב גורטמן", "שרגב גורטמן", "ברגב גורטמן", "לרגב גורטמן", "מרגב גורטמן", "כרגב גורטמן",
    "ורגב גורטמן", "הרגב גורטמן", "מהרגב גורטמן", "שלרגב גורטמן"
];

const singleWords = [
    "סטטיסטיקל", "שסטטיסטיקל", "בסטטיסטיקל", "לסטטיסטיקל", "מסטטיסטיקל", "כסטטיסטיקל",
    "וסטטיסטיקל", "הסטטיסטיקל", "מהסטטיסטיקל", "שלסטטיסטיקל", "שבסטטיסטיקל"
];


const warningWords = [
    "מי אתה שתגיד לי", "לא אכפת לי", "אגודת הסטודנטים", "האגודה", "סטודנטופ", "יום הסטודנט", "מאוים",
];



function messageHasProhibitedWord(message) {
    const lowerMessage = message.toLowerCase();
    // Ensure 'clean' function is accessible here or defined globally/imported
    // For now, assuming 'clean' is available in this scope.
    // If not, it's defined around line 641: function clean(text) { ... }
    const cleanedLowerMessage = clean(lowerMessage);

    for (const word of prohibitedWords) {
        const lowerWord = word.toLowerCase();
        // escapeRegExp is defined around line 649
        const escapedCleanWord = escapeRegExp(clean(lowerWord)); // Clean the prohibited word for pattern
        const escapedRawWord = escapeRegExp(lowerWord); // Raw escaped word for multi-word phrases

        const isMultiWord = word.includes(" ");

        const pattern = isMultiWord
            ? new RegExp(escapedRawWord, 'u') // Multi-word phrases match against raw lowerMessage
            : new RegExp(`(?:^|\\P{L})${escapedCleanWord}(?:\\P{L}|$)`, 'ui'); // Single words match against cleanedLowerMessage

        if (pattern.test(isMultiWord ? lowerMessage : cleanedLowerMessage)) {
            return word; // Return the original matched word (not the lowercased/cleaned version)
        }
    }
    return null; // No match
}

// עוזר: מוציא את כל "המילים" כ-tokens על בסיס אותיות Unicode
function getTokens(text) {
    // \p{L} = Letter,  \p{N} = Number  — שנה לפי הצורך
    return text.match(/\p{L}+/gu) || [];
}

// מחלצים את כל הרצפים של אותיות יוניקוד (ו/או ספרות – הוסף \p{N} אם נדרש)
function tokenize(text) { //Breaks a string into individual "word-like" tokens using Unicode-aware regular expression.
    return text.match(/\p{L}+/gu) || []; //"+" Means "1 or more letters" - so it groups letters into words.
    //\p{L} Means "1 or more letters" - so it groups letters into words.
    //"g"(global flag) Finds all matches not just the first. 
    //"u"(Unicode flag) Makes the regex Unicode-aware (so Hebrew, Arabic, etc. Are matched correctly)
    //|| [] if "match(...)" returns null,fallback to [] so the functions always returns an array. 

    //For example - tokenize("הסטטיסטיקל הוא אתר נהדר") → ["הסטטיסטיקל", "הוא", "אתר", "נהדר"]
}

function messageHasSingleWordFromList(message) {
    const tokens = new Set(tokenize(message.toLowerCase()));
    return singleWords.some(w =>
        !w.includes(" ") && tokens.has(w.toLowerCase())
    );
}


//My own code from here instead of "messageHasSingleWordFromList"
// Keep the Unicode clean-up you already had
function clean(text) {
    return text
        .normalize('NFKC')           // canonical form
        .replace(/[\p{M}\p{Cf}]/gu, '') // strip diacritics + zero-width chars
        .toLowerCase();
}

// Normalize WhatsApp IDs by keeping digits only
function normalizeId(jid) {
    return jid ? jid.toString().replace(/\D/g, '') : '';
}

// Normalize phone numbers for Telegram interactions
function normalizePhone(phone) {
    const digits = phone ? phone.toString().replace(/\D/g, '') : '';
    if (digits.startsWith('972')) return digits;
    if (digits.length === 10 && digits.startsWith('0')) return '972' + digits.slice(1);
    return digits;
}

// Escape characters that are special in RegExp
function escapeRegExp(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ─────────────────────── main matcher ───────────────────────

/**
 * Returns TRUE iff the message contains a *whole-word* match
 * to any item in `blockedRoots` (default: `singleWords`).
 *
 * Works for every Unicode script (Hebrew, Arabic, Cyrillic …)
 * because we define our own “letter boundaries” with \p{L}.
 */
function messageContainsBlockedRoot(message, blockedRoots = singleWords) {
    const cleanMsg = clean(message);

    for (const root of blockedRoots) {
        const word = clean(root); // normalise the root too
        const pattern = `(?:^|\\P{L})${escapeRegExp(word)}(?:\\P{L}|$)`; // boundaries
        const re = new RegExp(pattern, 'ui'); // u = Unicode, i = ignore-case
        if (re.test(cleanMsg)) {
            return root; // Return the matched root
        }
    }
    return null; // No match
}



//-----------------------------------------------------------
// 1) literal phrases you care about
//-----------------------------------------------------------




//-----------------------------------------------------------
// 3) build one regexp per phrase (once, at start-up)
//    – works for any script because we rely on \p{L}
//-----------------------------------------------------------
//--------------------------------------------------------------------
// 2) escape all regexp metacharacters (new name: quoteForRx)
//--------------------------------------------------------------------
function quoteForRx(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

//--------------------------------------------------------------------
// 3) build ONE “contains” regexp that covers every phrase
//    – done only once, at start-up
//--------------------------------------------------------------------
const warningRegex = (() => {
    const parts = warningWords.map(phrase => {
        // ➊ lower-case + trim
        // ➋ escape meta chars
        // ➌ collapse every run of spaces to “any whitespace OR punctuation”
        return quoteForRx(phrase.trim().toLowerCase())
            .replace(/\s+/g, '[\\s\\p{P}]+');
    });

    // join them with “|” →  (phrase1|phrase2|…)
    return new RegExp(parts.join('|'), 'iu');   // i = ignore-case, u = Unicode
})();

/**
 * Returns true iff the message contains ANY of the warning phrases
 * as a raw substring (flexible about in-between spaces & punctuation).
 */
function messageHasWarningWord(message) {
    return warningRegex.test(message.toLowerCase());
}




const handledMsgIds = new Set();

client.on('message', async message => {
    /* ── ADD THESE 6 LINES ── */
    const msgId = message.id._serialized;
    if (handledMsgIds.has(msgId)) {
        return;                 // הודעה זו כבר טופלה
    }
    handledMsgIds.add(msgId);
    /* ──────────────────────── */
    const messageText = message.body.trim();
    const senderId = message.author || message.from;
    const chat = await message.getChat();
    const isGroup = chat.isGroup;
    const realJid = await getRealSenderJid(message);
    const phoneJid = senderId || testData.originalId || message.from || message.author; // Simplified
    const groupNameForLog = isGroup ? (chat.name || chat.id._serialized) : 'N/A';
    const stagePrefix = isGroup ? `GROUP_MSG[${groupNameForLog}]` : `PRIVATE_MSG[${senderId}]`;

    log(`>>> Message Handler START for msg ID ${msgId} from ${realJid} in ${isGroup ? `group ${groupNameForLog}` : 'private chat'}. Raw senderId: ${senderId}. Body: "${messageText}"`, stagePrefix);

    if (isGroup) {
        log(`Processing group message flow for group ${groupNameForLog}, sender ${realJid}.`, stagePrefix);
        if (chat.id && chat.id._serialized) {
            const isBotAdmin = await isGroupAdmin(client, chat.id._serialized);
            log(`בדיקת מנהל בקבוצה ${chat.name || chat.id._serialized}: ${isBotAdmin ? 'הבוט הוא מנהל' : 'הבוט אינו מנהל'}`, `${stagePrefix}_ADMIN_CHECK`);
            if (!isBotAdmin) {
                log(`הבוט אינו מנהל בקבוצה ${chat.name || chat.id._serialized}, עוצר עיבוד הודעה זו.`, `${stagePrefix}_ADMIN_CHECK`);
                return;
            }
            log(`הבוט מנהל בקבוצה ${chat.name || chat.id._serialized}, ממשיך עיבוד.`, `${stagePrefix}_ADMIN_CHECK`);
        } else {
            logError(`Invalid chat.id or chat.id._serialized for group in message handler. Chat ID: ${chat.id}, Chat Name: ${chat.name}`, `${stagePrefix}_ERROR`);
            return;
        }

        if (isBlacklisted(realJid)) {
            log(`User ${realJid} is blacklisted. Attempting to remove from group ${chat.name || chat.id._serialized}.`, `${stagePrefix}_BLACKLIST`);
            try {
                await message.delete(true);
                log(`Deleted message from blacklisted user ${realJid}.`, `${stagePrefix}_BLACKLIST`);
                await chat.removeParticipants([senderId]); // Original senderId might be LID
                log(`Removed blacklisted user ${senderId} (original ID) from group.`, `${stagePrefix}_BLACKLIST`);
                await alertRemoval(client, 'בלאקליסט - הוסר אוטומטית', message, chat.name || chat.id._serialized);
            } catch (error) {
                logError(`שגיאה בפעולות נגד משתמש ${senderId} מהרשימה השחורה:`, `${stagePrefix}_BLACKLIST_ERROR`, error);
            }
            return;
        }

        if (isAdmin(realJid) || isImmune(realJid)) {
            log(`User ${realJid} is an admin or immune. Skipping further checks for this message.`, `${stagePrefix}_USER_PRIVILEGE`);
            return;
        }
        log(`המשתמש ${realJid} (senderId: ${senderId}) אינו מנהל או חסין. ממשיך בבדיקות תוכן.`, `${stagePrefix}_USER_PRIVILEGE`);

        let matchedForbiddenWord = messageHasProhibitedWord(message.body);
        if (!matchedForbiddenWord) {
            matchedForbiddenWord = messageContainsBlockedRoot(message.body);
        }

        if (matchedForbiddenWord) {
            log(`הודעה מ-${realJid} עם מילה אסורה "${matchedForbiddenWord}": "${message.body}". נוקט פעולה.`, `${stagePrefix}_FORBIDDEN_WORD`);
            try {
                const realJidForAction = await getRealSenderJid(message);
                await message.delete(true);
                log(`Deleted message from ${realJidForAction} due to forbidden word.`, `${stagePrefix}_FORBIDDEN_WORD`);

                const participantToRemove = realJidForAction || senderId;
                await chat.removeParticipants([participantToRemove]);
                log(`Removed user ${participantToRemove} from group due to forbidden word.`, `${stagePrefix}_FORBIDDEN_WORD`);

                await alertRemoval(client, `מילה אסורה: "${matchedForbiddenWord}"`, message, chat.name || chat.id._serialized);

                if (realJidForAction) {
                    const phoneNumber = realJidForAction.split('@')[0];
                    log(`משתמש ${phoneNumber} (${realJidForAction}) ביצע עבירת מילה אסורה. מוסיף לרשימה שחורה.`, `${stagePrefix}_FORBIDDEN_WORD`);
                    await addToBlacklist(realJidForAction);
                    await addUserToBlacklistWithLid(message, addToBlacklist); // Ensures LID is also blacklisted
                } else {
                    logError(`Could not determine realJid for blacklisting sender: ${senderId} after forbidden word. Blacklisting senderId.`, `${stagePrefix}_FORBIDDEN_WORD_ERROR`);
                    await addToBlacklist(senderId);
                    await addUserToBlacklistWithLid(message, addToBlacklist);
                }
            } catch (error) {
                logError(`שגיאה בטיפול במילה אסורה (${matchedForbiddenWord}) ממשתמש ${senderId}:`, `${stagePrefix}_FORBIDDEN_WORD_ERROR`, error);
            }
            return;
        }

        log(`Message from ${realJid} passed forbidden word checks.`, `${stagePrefix}_CONTENT_CHECK`);

        const hasLink = message.body.match(/(?:https?:\/\/|www\.)[^\s]+/i) !== null;
        if (messageHasWarningWord(message.body)) {
            log(`Message from ${realJid} contains warning word(s). Deleting message: "${message.body}"`, `${stagePrefix}_WARNING_WORD`);
            await message.delete(true);
            log(`Deleted message from ${realJid} due to warning word.`, `${stagePrefix}_WARNING_WORD`);
            await alertDeletion(client, 'מילה אזהרה', message, chat);
            return;
        }
        log(`Message from ${realJid} passed warning word checks.`, `${stagePrefix}_CONTENT_CHECK`);

        if (hasLink && !isApproved(realJid) && !isImmune(realJid) && !isAdmin(realJid)) {
            log(`User ${realJid} (not approved/immune/admin) sent a link. Initiating verification process. Link message: "${message.body}"`, `${stagePrefix}_UNVERIFIED_LINK`);
            try {
                let deletedOK = false;
                try {
                    await message.delete(true);
                    deletedOK = true;
                    log(`Deleted link message from ${realJid}.`, `${stagePrefix}_UNVERIFIED_LINK`);
                } catch (delErr) {
                    logError(`⚠️ Delete failed for link message from ${senderId}:`, `${stagePrefix}_UNVERIFIED_LINK_ERROR`, delErr);
                }

                if (deletedOK) {
                    await alertDeletion(client, 'קישור ללא אימות', message, chat);
                }

                const currentRealJid = await getRealSenderJid(message); // Re-fetch in case it was LID
                log(`Original ID for link sender: ${senderId}, Real JID: ${currentRealJid}`, `${stagePrefix}_UNVERIFIED_LINK`);

                const phoneNumber = senderId.split('@')[0]; // Use original senderId for @mention if it's LID
                const response =
                    `@${phoneNumber} שלום! זיהיתי שניסית לשלוח קישור והקישור נמחק.\n` +
                    `כדי לשלוח קישורים בקבוצה, עליך לעבור אימות קצר.\n` +
                    `אנא פנה אליי בצ'אט פרטי וכתוב "התחל" תוך 10 דקות – אחרת תוסר מהקבוצה.`;
                await chat.sendMessage(response, { mentions: [senderId] });
                log(`Sent warning message to user ${senderId} in group ${chat.id._serialized} about link.`, `${stagePrefix}_UNVERIFIED_LINK`);

                pendingUsers.set(currentRealJid, { // Use real JID for pendingUsers map
                    groupId: chat.id._serialized,
                    timestamp: Date.now(),
                    originalId: senderId
                });
                log(`Added user ${currentRealJid} (original: ${senderId}) to pendingUsers for link verification.`, `${stagePrefix}_UNVERIFIED_LINK`);

                const maxRemovalAttempts = 5;
                const removalInterval = 2 * 60 * 1000;

                const attemptUserRemoval = async (attempt = 0) => {
                    const removalStage = `${stagePrefix}_AUTO_REMOVE_LINK_SENDER`;
                    try {
                        log(`Attempt ${attempt + 1} to check/remove user ${currentRealJid} (original: ${senderId}) for not starting test.`, removalStage);
                        if (!pendingUsers.has(currentRealJid) || (typeof hasActiveJoinTest === 'function' && hasActiveJoinTest(currentRealJid))) {
                            log(`User ${currentRealJid} is no longer pending or has started a test. Removal check aborted.`, removalStage);
                            return;
                        }

                        const { groupId: userGroupId, originalId: userOriginalId } = pendingUsers.get(currentRealJid);
                        const rmChat = await client.getChatById(userGroupId);
                        if (!(await isGroupAdmin(client, userGroupId))) {
                            log(`Bot lost admin in group ${userGroupId}. Cannot remove user ${userOriginalId}.`, removalStage);
                            pendingUsers.delete(currentRealJid); // Clean up if bot can't act
                            return;
                        }

                        log(`Fetching recent messages from ${userOriginalId} in ${rmChat.name || userGroupId} for deletion.`, removalStage);
                        const msgs = await rmChat.fetchMessages({ limit: 100 });
                        for (const m of msgs) {
                            const ids = [m.author, m.from].filter(Boolean);
                            if (ids.includes(userOriginalId)) {
                                try {
                                    await m.delete(true);
                                    log(`Deleted message ${m.id._serialized} from ${userOriginalId}.`, removalStage);
                                } catch (_) { /* ignore delete error for individual messages */ }
                            }
                        }

                        log(`Kicking user ${userOriginalId} from ${rmChat.name || userGroupId}.`, removalStage);
                        await rmChat.removeParticipants([userOriginalId]);
                        await sendAdminAlert(client, `🚫 המשתמש ${userOriginalId} (${currentRealJid}) הועף מהקבוצה ${rmChat.name || userGroupId} – לא התחיל מבחן אימות קישור תוך 10 דק׳`);
                        addToBlacklist(userOriginalId); // Blacklist original ID
                        await addUserToBlacklistWithLid(message, addToBlacklist); // Blacklist real JID and LID

                        pendingUsers.delete(currentRealJid);
                        userStates.delete(userOriginalId); // Also clear general state if any
                        log(`✅ המשתמש ${userOriginalId} (${currentRealJid}) הוסר בהצלחה לאחר שלא התחיל מבחן.`, removalStage);
                    } catch (rmErr) {
                        logError(`❌ Attempt ${attempt + 1} to remove ${userOriginalId} (real: ${currentRealJid}) failed:`, removalStage, rmErr);
                        if (attempt < maxRemovalAttempts - 1) {
                            log(`Scheduling retry for user ${userOriginalId} removal.`, removalStage);
                            setTimeout(() => attemptUserRemoval(attempt + 1), removalInterval);
                        } else {
                            logError(`⚠️ לא הצלחתי להסיר את ${userOriginalId} (real: ${currentRealJid}) לאחר ${maxRemovalAttempts} ניסיונות.`, removalStage);
                            await sendAdminAlert(client, `⚠️ לא הצלחתי להסיר את ${userOriginalId} (${currentRealJid}) לאחר ${maxRemovalAttempts} ניסיונות`);
                            pendingUsers.delete(currentRealJid); // Clean up to prevent loop
                        }
                    }
                };

                setTimeout(attemptUserRemoval, 10 * 60 * 1000);
                log(`Scheduled automatic removal check for ${currentRealJid} (original: ${senderId}) in 10 minutes.`, `${stagePrefix}_UNVERIFIED_LINK`);
            } catch (err) {
                logError('שגיאה בטיפול בקישור לא מאומת:', `${stagePrefix}_UNVERIFIED_LINK_ERROR`, err);
            }
            return;
        }
        else if (hasLink) {
            log(`User ${realJid} sent a link and is approved/immune/admin. Link allowed. Message: "${message.body}"`, `${stagePrefix}_VERIFIED_LINK`);
        }


        if (hasActiveJoinTest(senderId)) {
            log(`User ${senderId} has an active join test. Passing message to handleJoinTestResponse.`, `${stagePrefix}_ACTIVE_TEST`);
            await handleJoinTestResponse(client, message, senderId);
            return;
        }
        log(`Message from ${realJid} passed all group checks or did not trigger specific handlers.`, stagePrefix);

    } else {
        // Private messages
        const privateStage = `PRIVATE_MSG[${senderId}]`;
        log(`Processing private message from ${senderId}. Content: "${messageText}"`, privateStage);

        if (isAdmin(senderId)) {
            const adminCommandStage = `${privateStage}_ADMIN_CMD`;
            log(`Message from admin ${senderId}. Checking for admin commands.`, adminCommandStage);
            if (messageText.startsWith('!debug_remove ')) {
                const phoneNumber = messageText.replace('!debug_remove ', '').trim();
                log(`Admin ${senderId} initiated !debug_remove for phone: ${phoneNumber}`, adminCommandStage);
                await message.reply('🔍 מתחיל בדיקת debug...');
                await debugUserRemoval(client, phoneNumber);
                await message.reply('✅ בדיקת Debug הושלמה - ראה פרטים בקונסול');
                return;
            }

            if (messageText.startsWith('!test_remove ')) {
                const parts = messageText.replace('!test_remove ', '').split(' ');
                if (parts.length < 2) {
                    log(`Admin ${senderId} sent invalid !test_remove command. Usage: !test_remove [phone] [group_name]`, adminCommandStage);
                    await message.reply('Usage: !test_remove [phone] [group_name]');
                    return;
                }
                const phone = parts[0];
                const groupName = parts.slice(1).join(' ');
                log(`Admin ${senderId} initiated !test_remove for phone ${phone} from group "${groupName}"`, adminCommandStage);
                await message.reply(`🔍 Testing removal of ${phone} from "${groupName}"...`);

                try {
                    let group = null;
                    let groupId = null;
                    log(`Searching for group "${groupName}" among managed groups.`, adminCommandStage);
                    for (const managedGroupId of botConfig.managedGroups) {
                        try {
                            const chat = await client.getChatById(managedGroupId);
                            if (chat && chat.isGroup && chat.name === groupName) {
                                group = chat;
                                groupId = managedGroupId;
                                log(`Found group "${groupName}" with ID ${groupId}`, adminCommandStage);
                                break;
                            }
                        } catch (e) { /* Skip if can't get this chat */ }
                    }

                    if (!group) {
                        logError(`Group "${groupName}" not found in managed groups for !test_remove.`, adminCommandStage);
                        await message.reply(`❌ Group "${groupName}" not found in managed groups`);
                        return;
                    }

                    if (!group.participants || group.participants.length === 0) {
                        log(`Fetching participants for group "${groupName}".`, adminCommandStage);
                        await group.fetchParticipants();
                    }

                    const e164 = formatPhoneNumberToE164(phone);
                    const targetJid = `${e164}@c.us`;
                    log(`Target JID for removal: ${targetJid}. Group has ${group.participants.length} participants.`, adminCommandStage);

                    const participant = group.participants.find(p =>
                        p.id._serialized === targetJid ||
                        p.id.user === e164 ||
                        p.id._serialized.includes(phone.replace(/\D/g, ''))
                    );

                    if (!participant) {
                        logError(`User ${targetJid} not found in group "${groupName}" for !test_remove.`, adminCommandStage);
                        await message.reply(`❌ User ${targetJid} not found in group`);
                        let sampleParticipants = 'Sample participants:\n';
                        group.participants.slice(0, 5).forEach((p, i) => { sampleParticipants += `${i + 1}. ${p.id._serialized}\n`; });
                        await message.reply(sampleParticipants);
                        return;
                    }

                    log(`Found participant for removal: ${participant.id._serialized}`, adminCommandStage);
                    await message.reply(`✅ Found participant: ${participant.id._serialized}`);

                    try {
                        await group.removeParticipants([participant.id._serialized]);
                        log(`Successfully removed ${participant.id._serialized} from "${groupName}" using standard method.`, adminCommandStage);
                        await message.reply(`✅ Successfully removed!`);
                    } catch (err) {
                        logError(`Removal of ${participant.id._serialized} from "${groupName}" failed: ${err.message}`, adminCommandStage, err);
                        await message.reply(`❌ Removal failed: ${err.message}`);
                        try {
                            const phoneOnly = participant.id._serialized.replace('@c.us', '').replace('@lid', '');
                            log(`Attempting alternative removal with phoneOnly: ${phoneOnly}`, adminCommandStage);
                            await group.removeParticipants([phoneOnly]);
                            log(`Successfully removed ${phoneOnly} using alternative method.`, adminCommandStage);
                            await message.reply(`✅ Removed using phone number only!`);
                        } catch (err2) {
                            logError(`Alternative removal of ${phoneOnly} also failed: ${err2.message}`, adminCommandStage, err2);
                            await message.reply(`❌ Alternative method also failed: ${err2.message}`);
                        }
                    }
                } catch (error) {
                    logError(`Error in !test_remove command execution:`, adminCommandStage, error);
                    await message.reply(`❌ Error: ${error.message}`);
                }
                return;
            }

            if (messageText.startsWith('!test_remove_id ')) {
                const parts = messageText.replace('!test_remove_id ', '').split(' ');
                if (parts.length < 2) {
                    log(`Admin ${senderId} sent invalid !test_remove_id command. Usage: !test_remove_id [phone] [group_id]`, adminCommandStage);
                    await message.reply('Usage: !test_remove_id [phone] [group_id]');
                    return;
                }
                const phone = parts[0];
                const groupId = parts[1];
                log(`Admin ${senderId} initiated !test_remove_id for phone ${phone} from group ID ${groupId}`, adminCommandStage);
                await message.reply(`🔍 Testing removal of ${phone} from group ${groupId}...`);

                try {
                    const group = await client.getChatById(groupId);
                    if (!group || !group.isGroup) {
                        logError(`Group ${groupId} not found or is not a group for !test_remove_id.`, adminCommandStage);
                        await message.reply(`❌ Group ${groupId} not found or is not a group`);
                        return;
                    }
                    log(`Found group: ${group.name || groupId} for !test_remove_id.`, adminCommandStage);
                    await message.reply(`✅ Found group: ${group.name || groupId}`);

                    if (!group.participants || group.participants.length === 0) {
                        log(`Fetching participants for group ${group.name || groupId}.`, adminCommandStage);
                        await group.fetchParticipants();
                    }

                    const e164 = formatPhoneNumberToE164(phone);
                    const targetJid = `${e164}@c.us`;
                    log(`Target JID for removal: ${targetJid}. Group has ${group.participants.length} participants.`, adminCommandStage);

                    const participant = group.participants.find(p =>
                        p.id._serialized === targetJid ||
                        p.id.user === e164 ||
                        p.id._serialized.includes(phone.replace(/\D/g, ''))
                    );

                    if (!participant) {
                        logError(`User ${targetJid} not found in group ${group.name || groupId} for !test_remove_id.`, adminCommandStage);
                        await message.reply(`❌ User ${targetJid} not found in group`);
                        return;
                    }
                    log(`Found participant for removal: ${participant.id._serialized}`, adminCommandStage);
                    await message.reply(`✅ Found participant: ${participant.id._serialized}`);

                    // ... (rest of the !test_remove_id logic with added logs for each step)
                    // For brevity, not repeating all the nested try-catch blocks here, but they should be instrumented similarly.
                    // Example for one Store API call:
                    try {
                        log(`Attempting Store API removal for ${participant.id._serialized} from ${groupId}`, adminCommandStage);
                        const result = await client.pupPage.evaluate(async (gId, pId) => { /* ... */ }, groupId, participant.id._serialized);
                        if (result.success) {
                            log(`Store API removal successful using method: ${result.method}`, adminCommandStage);
                            await message.reply(`✅ Successfully removed using ${result.method}!`);
                        } else {
                            logError(`Store API removal failed: ${JSON.stringify(result, null, 2)}`, adminCommandStage);
                            await message.reply(`❌ Store API failed: ${JSON.stringify(result, null, 2)}`);
                            // ... further fallbacks with logging ...
                        }
                    } catch (evalErr) {
                        logError(`Store API evaluation error: ${evalErr.message}`, adminCommandStage, evalErr);
                        await message.reply(`❌ Evaluation error: ${evalErr.message}`);
                        // ... further fallbacks with logging ...
                    }

                } catch (error) {
                    logError(`Error in !test_remove_id command execution:`, adminCommandStage, error);
                    await message.reply(`❌ Error: ${error.message}`);
                }
                return;
            }

            if (messageText === 'הודעה מוצמדת') {
                log(`Admin ${senderId} wants to send a pinned broadcast. Setting state.`, adminCommandStage);
                userStates.set(senderId, { waitingForMessage: true, isPinned: true });
                await message.reply('אנא שלח את ההודעה שתרצה להצמיד לכל הקבוצות');
                return;
            } else if (messageText === 'הודעה') {
                log(`Admin ${senderId} wants to send a regular broadcast. Setting state.`, adminCommandStage);
                userStates.set(senderId, { waitingForMessage: true, isPinned: false });
                await message.reply('אנא שלח את ההודעה שתרצה לשלוח לכל הקבוצות');
                return;
            } else if (messageText === 'הסרה') {
                log(`Admin ${senderId} wants to remove and blacklist a user. Setting state.`, adminCommandStage);
                userStates.set(senderId, { waitingForPhoneNumber: true });
                await message.reply('אנא שלח את מספר הטלפון של המשתמש שברצונך להסיר מכל הקבוצות (למשל: 972501234567)');
                return;
            } else if (messageText === 'הכנסה') {
                log(`Admin ${senderId} wants to unblacklist a user. Setting state.`, adminCommandStage);
                userStates.set(senderId, { waitingForUnblockPhoneNumber: true });
                await message.reply('אנא שלח את מספר הטלפון של המשתמש שברצונך להחזיר (למשל: 972501234567)');
                return;
            }

            const userState = userStates.get(senderId);
            if (userState) {
                const adminActionStage = `${adminCommandStage}_ACTION`;
                if (userState.waitingForMessage) {
                    log(`Admin ${senderId} provided message for broadcast (pinned: ${userState.isPinned}): "${message.body}"`, adminActionStage);
                    await broadcastMessage(client, message.body, userState.isPinned);
                    userStates.delete(senderId);
                    await message.reply(`ההודעה נשלחה בהצלחה לכל הקבוצות${userState.isPinned ? ' והוצמדה' : ''}`);
                    return;
                }

                else if (userState.waitingForPhoneNumber) {
                    const rawInput = message.body.trim();
                    log(`Admin ${senderId} provided phone number for removal/blacklisting: "${rawInput}"`, adminActionStage);
                    await message.reply('⏳ מוסיף לרשימה השחורה...');
                    const normalisePhone = (input) => { /* ... */ return input.replace(/[^\d+]/g, ''); }; // Simplified for brevity
                    const phoneDigits = normalisePhone(rawInput);
                    log(`Normalized phone for blacklisting: ${phoneDigits}`, adminActionStage);

                    if (!/^\d{8,15}$/.test(phoneDigits)) {
                        logError(`Invalid phone number format for blacklisting: ${phoneDigits}`, adminActionStage);
                        await message.reply('❌ מספר טלפון לא תקין');
                        userStates.delete(senderId);
                        return;
                    }

                    const whatsappId = `${phoneDigits}@c.us`;
                    addToBlacklist(whatsappId);
                    await addUserToBlacklistWithLid(message, addToBlacklist); // Ensure LID is also handled
                    log(`User ${whatsappId} added to blacklist by admin ${senderId}.`, adminActionStage);
                    await message.reply(`✅ ${phoneDigits} נוסף לרשימה השחורה`);
                    userStates.delete(senderId);
                    return;
                }

                else if (userState.waitingForUnblockPhoneNumber) {
                    const rawInput = message.body.trim();
                    log(`Admin ${senderId} provided phone number for unblacklisting: "${rawInput}"`, adminActionStage);
                    await message.reply('⏳ מסיר מהרשימה השחורה...');
                    const normalisePhone = (input) => { /* ... */ return input.replace(/[^\d+]/g, ''); }; // Simplified
                    const phoneDigits = normalisePhone(rawInput);
                    log(`Normalized phone for unblacklisting: ${phoneDigits}`, adminActionStage);

                    if (!/^\d{8,15}$/.test(phoneDigits)) {
                        logError(`Invalid phone number format for unblacklisting: ${phoneDigits}`, adminActionStage);
                        await message.reply('❌ מספר הטלפון אינו תקין. אנא שלח מספר בינלאומי תקין.');
                        userStates.delete(senderId);
                        return;
                    }

                    const userIdToUnblock = `${phoneDigits}@c.us`;
                    if (!BLACKLIST.has(userIdToUnblock)) {
                        log(`User ${userIdToUnblock} is not in blacklist. Informing admin ${senderId}.`, adminActionStage);
                        await message.reply(`ℹ️ ${phoneDigits} אינו נמצא ברשימה השחורה.`);
                        userStates.delete(senderId);
                        return;
                    }

                    removeFromBlacklist(userIdToUnblock);
                    // Also attempt to remove potential LID variant from blacklist if your logic supports it
                    const lidVariant = `${phoneDigits}@lid`;
                    if (BLACKLIST.has(lidVariant)) {
                        removeFromBlacklist(lidVariant);
                        log(`Also removed LID variant ${lidVariant} from blacklist.`, adminActionStage);
                    }
                    userStates.delete(senderId);
                    log(`User ${userIdToUnblock} (and potential LID) removed from blacklist by admin ${senderId}.`, adminActionStage);
                    await message.reply(`✅ ${phoneDigits} הוסר מהרשימה השחורה ויוכל להצטרף שוב לקבוצות.`);
                    return;
                }
            }
        }

        if (messageText === 'קישורים') {
            log(`User ${senderId} requested group links. Sending list.`, privateStage);
            await sendGroupList(client, senderId);
            userStates.set(senderId, { step: 'awaiting_group_number' });
            return;
        }

        const state = userStates.get(senderId);
        if (state && state.step === 'awaiting_group_number') {
            const groupNumber = message.body.trim();
            log(`User ${senderId} provided group number "${groupNumber}" for link request.`, privateStage);
            if (/^[0-9]+$/.test(groupNumber)) {
                await sendGroupLink(client, senderId, groupNumber);
                userStates.delete(senderId);
            } else {
                log(`Invalid group number "${groupNumber}" from ${senderId}. Requesting valid number.`, privateStage);
                await client.sendMessage(senderId, 'אנא שלח מספר קבוצה תקין מהרשימה.');
            }
            return;
        }

        if (typeof hasActiveJoinTest === 'function' && hasActiveJoinTest(senderId)) {
            log(`User ${senderId} has an active join/link test. Passing message to handleJoinTestResponse.`, privateStage);
            await handleJoinTestResponse(client, message, senderId);
            return;
        }

        if (messageText === 'התחל') {
            const startTestStage = `${privateStage}_START_TEST`;
            log(`User ${senderId} sent "התחל". Checking for pending verification.`, startTestStage);
            log(`Current pendingUsers map for ${senderId}: ${JSON.stringify(pendingUsers.get(senderId))}`, startTestStage);

            const pendingData = pendingUsers.get(senderId); // senderId should be real JID in private chat
            if (pendingData) {
                log(`Pending verification found for ${senderId} from group ${pendingData.groupId}. Starting test.`, startTestStage);
                const firstQuestion = generateTestQuestion();
                const testMessage =
                    `*ברוך הבא למבחן אימות!*\n\n` +
                    'עליך לענות נכון על 3 שאלות כדי להישאר בקבוצה.\n' +
                    'יש לך 6 דקות לסיים את המבחן.\n' +
                    'מותרות לך 2 טעויות בלבד.\n\n' +
                    `שאלה 1/3:\n${firstQuestion.question}`;
                await message.reply(testMessage);
                const testData = {
                    currentQuestion: firstQuestion,
                    correctAnswers: 0,
                    wrongAnswers: 0,
                    startTime: Date.now(),
                    type: 'auth', // Link auth test
                    groupId: pendingData.groupId,
                    originalId: pendingData.originalId, // This is the ID from the group (could be LID)
                    realJid: senderId, // This is the private chat ID (real JID)
                    messageToDelete: pendingData.messageToDelete, // Not used in current flow but kept
                    questionAttempts: 0,
                    timeoutId: setTimeout(async () => {
                        if (!activeTests.has(senderId)) return;
                        log(`Test timeout for user ${senderId}.`, `${startTestStage}_TIMEOUT`);
                        await handleTestTimeout(client, senderId, pendingData.groupId, pendingData.messageToDelete);
                    }, TEST_TIMEOUT)
                };
                activeTests.set(senderId, testData);
                log(`User ${senderId} (originalId: ${pendingData.originalId}) started link authentication test for group ${pendingData.groupId}.`, startTestStage);
            } else {
                log(`User ${senderId} sent "התחל" but no pending verification found.`, startTestStage);
                await message.reply('אין לך בקשת אימות פעילה כרגע. אם שלחת קישור בקבוצה, אנא המתן להודעת האימות שם.');
            }
            return;
        }

        if (activeTests.has(senderId)) {
            log(`User ${senderId} has an active test. Passing message to handleTestAnswer.`, privateStage);
            await handleTestAnswer(client, message, senderId);
            return;
        }
        log(`Private message from ${senderId} did not match any specific handlers.`, privateStage);
    }
});


// Handle test answers
async function handleTestAnswer(client, message, senderId) {
    const testStage = `TEST_ANSWER[${senderId}]`;
    const testData = activeTests.get(senderId);
    if (!testData) {
        log(`Answer received from user ${senderId} who is not in an active test. Ignoring.`, testStage);
        return;
    }
    const userAnswer = message.body.toLowerCase().trim();
    const correctAnswer = testData.currentQuestion.answer.toLowerCase().trim();
    log(`User ${senderId} answered "${userAnswer}". Correct answer is "${correctAnswer}". Question: "${testData.currentQuestion.question}"`, testStage);

    if (userAnswer === correctAnswer) {
        testData.correctAnswers++;
        testData.questionAttempts = 0;
        log(`Correct answer from ${senderId}. Correct: ${testData.correctAnswers}, Wrong: ${testData.wrongAnswers}.`, testStage);
        if (testData.correctAnswers >= 3) {
            clearTimeout(testData.timeoutId);
            log(`User ${senderId} passed the test! (3 correct answers). Original ID: ${testData.originalId}, Real JID: ${testData.realJid}`, testStage);

            // Use realJid (private chat ID) for approved list
            const approvedId = normalizeId(testData.realJid);
            await addApprovedUser(approvedId);
            APPROVED_USERS.add(approvedId);
            log(`User ${approvedId} added to approved users.`, testStage);

            await client.sendMessage(senderId, '✅ עברת את המבחן בהצלחה! כעת תוכל לשלוח קישורים בקבוצה.');
            activeTests.delete(senderId);
            updateTestAttempts(senderId, true); // senderId here is realJid
            failedOnceUsers.delete(senderId);
            pendingUsers.delete(testData.realJid); // Ensure pending user (link sender) is cleared using realJid
            log(`User ${senderId} test completed successfully. Cleaned up state.`, testStage);
            await sendAdminAlert(client, `המשתמש ${testData.realJid} (מקורי: ${testData.originalId}) עבר את מבחן אימות הקישור והוא כעת Approved User.`);
        } else {
            const nextQuestion = generateTestQuestion();
            testData.currentQuestion = nextQuestion;
            log(`Sending next question to ${senderId}. Question ${testData.correctAnswers + 1}/3.`, testStage);
            await client.sendMessage(senderId,
                `✅ נכון! שאלה ${testData.correctAnswers + 1}/3:\n${nextQuestion.question}`
            );
            activeTests.set(senderId, testData);
        }
    } else {
        testData.questionAttempts = (testData.questionAttempts || 0) + 1;
        log(`Incorrect answer from ${senderId}. Attempt ${testData.questionAttempts} for this question.`, testStage);

        if (testData.questionAttempts === 1) {
            log(`First incorrect attempt for this question by ${senderId}. Sending warning.`, testStage);
            await client.sendMessage(senderId, "לא נכון. ניסיון אחרון לשאלה זו:");
            activeTests.set(senderId, testData);
            return;
        } else if (testData.questionAttempts === 2) {
            testData.wrongAnswers++;
            testData.questionAttempts = 0; // Reset for the next question
            log(`Second incorrect attempt for this question by ${senderId}. Total wrong answers: ${testData.wrongAnswers}.`, testStage);

            if (testData.wrongAnswers >= 2) {
                clearTimeout(testData.timeoutId);
                log(`User ${senderId} failed the test (2 wrong answers). Original ID: ${testData.originalId}, Group: ${testData.groupId}.`, `${testStage}_FAIL`);
                try {
                    const phoneJid = senderId || testData.originalId || message.from || message.author;
                    const phoneDisplay3 = extractPhone(phoneJid); // For admin alert

                    const chat = await client.getChatById(testData.groupId);
                    const userToRemove = testData.originalId || senderId; // Use originalId for removal from group (might be LID)
                    log(`Attempting to remove user ${userToRemove} from group ${testData.groupId} due to test failure.`, `${testStage}_FAIL`);

                    try {
                        await chat.removeParticipants([userToRemove]);
                        log(`✅ Successfully removed ${userToRemove} from ${chat.name || testData.groupId}.`, `${testStage}_FAIL`);
                        await client.sendMessage(senderId, '❌ נכשלת במבחן. הוסרת מהקבוצה.');
                        const phoneDisplay = userToRemove.split('@')[0];
                        await sendAdminAlert(client, `משתמש ${phoneDisplay} (RealJID: ${senderId}) נכשל במבחן אימות קישור והוסר מהקבוצה ${chat.name || testData.groupId}. Phone Display for alert: ${phoneDisplay3}`);

                        addToBlacklist(senderId); // Blacklist the real JID
                        await addUserToBlacklistWithLid(message, addToBlacklist); // Also blacklist LID if applicable
                        log(`User ${senderId} (and potential LID ${testData.originalId}) blacklisted after failing test.`, `${testStage}_FAIL`);

                    } catch (removeError) {
                        logError(`❌ Error removing ${userToRemove} from group after test failure:`, `${testStage}_FAIL_REMOVAL_ERROR`, removeError);
                        await client.sendMessage(senderId, '❌ נכשלת במבחן. לא ניתן היה להסיר אותך מהקבוצה כעת.');
                        const phoneDisplay = userToRemove.split('@')[0];
                        await sendAdminAlert(client, `שגיאה בהסרת משתמש ${phoneDisplay} (RealJID: ${senderId}) מהקבוצה ${chat.name || testData.groupId} לאחר כישלון במבחן: ${removeError.message}`);
                    }
                } catch (err) {
                    logError('General error while handling user removal after test failure:', `${testStage}_FAIL_ERROR`, err);
                    const phoneDisplay = (testData.originalId || senderId).split('@')[0];
                    await sendAdminAlert(client, `שגיאה כללית בהסרת משתמש ${phoneDisplay} (RealJID: ${senderId}) מהקבוצה לאחר כישלון במבחן: ${err.message}`);
                }

                activeTests.delete(senderId);
                updateTestAttempts(senderId, false);
                pendingUsers.delete(senderId); // Clear from pending link verification

                const attempts = getTestAttempts(senderId);
                if (attempts.attempts === 1 && !isBlacklisted(senderId)) { // Check not already blacklisted from this failure
                    log(`User ${senderId} failed once. Recording in failedOnceUsers.`, `${testStage}_FAIL`);
                    failedOnceUsers.set(senderId, { timestamp: Date.now(), groupId: testData.groupId });
                } else if (attempts.attempts >= 2) {
                    log(`User ${senderId} failed multiple times. Ensuring blacklist.`, `${testStage}_FAIL`);
                    addToBlacklist(senderId);
                    await addUserToBlacklistWithLid(message, addToBlacklist);
                    failedOnceUsers.delete(senderId);
                }
                log(`User ${senderId} test processing finished after failure.`, `${testStage}_FAIL`);
            } else {
                // Failed this question, but not the whole test yet.
                const nextQuestion = generateTestQuestion();
                testData.currentQuestion = nextQuestion;
                const totalAnswered = testData.correctAnswers + testData.wrongAnswers;
                const nextIndex = totalAnswered + 1;
                log(`Sending next question to ${senderId} after incorrect answer. Question ${nextIndex}/3.`, testStage);
                await client.sendMessage(senderId, `❌ לא נכון. שאלה ${nextIndex}/3:\n${nextQuestion.question}`);
                activeTests.set(senderId, testData);
            }
        }
    }
}

async function handleTestTimeout(client, userId, groupId, messageToDelete) {
    const stage = `TEST_TIMEOUT[${userId}]`;
    log(`Test timeout for user ${userId} in group ${groupId}.`, stage);
    if (activeTests.has(userId)) {
        const testData = activeTests.get(userId);
        const userToRemove = testData.originalId || userId; // Prefer originalId (LID) for removal
        try {
            const chat = await client.getChatById(groupId);
            if (messageToDelete) { // This messageToDelete is likely from an older test flow, may not be relevant
                // await messageToDelete.delete(true);
                // log(`Deleted initial message for user ${userId} due to timeout.`, stage);
            }
            await chat.removeParticipants([userToRemove]);
            log(`Removed user ${userToRemove} from group ${groupId} due to test timeout.`, stage);
            await client.sendMessage(userId, '❌ הזמן להשיב על שאלות המבחן עבר (6 דקות). הוסרת מהקבוצה.');
            await sendAdminAlert(client, `המשתמש ${userToRemove} (RealJID: ${userId}) הוסר מהקבוצה ${chat.name || groupId} עקב חריגה מזמן המבחן.`);

            addToBlacklist(userId); // Blacklist real JID
            // Consider using a generic message object or fetching one to use addUserToBlacklistWithLid
            // For now, just blacklisting the real JID.
            log(`User ${userId} (original: ${userToRemove}) blacklisted due to test timeout.`, stage);

            activeTests.delete(userId);
            pendingUsers.delete(userId); // Clear from pending link verification
            updateTestAttempts(userId, false); // Mark as failed attempt

        } catch (error) {
            logError(`Error during test timeout removal for user ${userToRemove} (RealJID: ${userId}) from group ${groupId}:`, stage, error);
            await sendAdminAlert(client, `שגיאה בהסרת משתמש ${userToRemove} (RealJID: ${userId}) עקב חריגה מזמן: ${error.message}`);
            // Still clean up states to prevent issues
            activeTests.delete(userId);
            pendingUsers.delete(userId);
            updateTestAttempts(userId, false);
        }
    } else {
        log(`Test timeout triggered for user ${userId}, but no active test found.`, stage);
    }
}

// הוספת לוגים לכל סוגי האירועים הקשורים לקבוצה
client.on('group_update', (notification) => {
    log(`Group update event received: ${JSON.stringify(notification)}`, "GROUP_EVENT_UPDATE");
});

// הוספת האזנה לכל האירועים כדי לדבג
// This might be too verbose for production, consider conditional logging or removing if not needed.
// client.on('**', (event) => {
//     log(`[RAW_EVENT] Type: ${event.type}, Data: ${JSON.stringify(event)}`, "RAW_EVENT");
// });

// הוספת האזנה לאירוע כניסה לקבוצה
client.on('group_join', async (notification) => {
    const stage = "GROUP_EVENT_JOIN";
    try {
        log(`Group join event: ${JSON.stringify(notification)}`, stage);
        if (!notification.id || !notification.id._serialized) {
            logError(`Invalid notification.id or notification.id._serialized in group_join. Notification: ${JSON.stringify(notification)}`, stage);
            return;
        }
        const groupId = notification.id._serialized;
        const userId = notification.author; // This is the user who added, or the user themselves if they joined via link
        const recipientIds = notification.recipientIds; // Array of users who actually joined

        log(`Processing group join for group ${groupId}. Author: ${userId}. Joined users: ${JSON.stringify(recipientIds)}`, stage);

        if (!botConfig.isManagedGroup(groupId)) {
            log(`Group ${groupId} is not managed. Ignoring join event.`, stage);
            return;
        }

        for (const joinedUserId of recipientIds) {
            log(`Checking user ${joinedUserId} who joined group ${groupId}.`, stage);
            if (botConfig.isBlacklisted(joinedUserId)) {
                log(`User ${joinedUserId} is blacklisted and joined group ${groupId}. Attempting removal.`, `${stage}_BLACKLIST_JOIN`);
                try {
                    const chat = await client.getChatById(groupId);
                    const isAdmin = await isGroupAdmin(client, groupId);
                    if (!isAdmin) {
                        log(`Bot is not admin in group ${chat.name || groupId}. Cannot remove blacklisted user ${joinedUserId}.`, `${stage}_BLACKLIST_JOIN`);
                        await sendAdminAlert(client, `המשתמש ${joinedUserId} (רשימה שחורה) הצטרף לקבוצה ${chat.name || groupId} אך הבוט אינו מנהל שם.`);
                        continue;
                    }
                    await chat.removeParticipants([joinedUserId]);
                    log(`Removed blacklisted user ${joinedUserId} from group ${chat.name || groupId}.`, `${stage}_BLACKLIST_JOIN`);
                    await sendAdminAlert(client, `משתמש ${joinedUserId} (רשימה שחורה) הצטרף לקבוצה ${chat.name || groupId} והוסר בהצלחה.`);
                } catch (error) {
                    logError(`שגיאה בהסרת משתמש ${joinedUserId} (רשימה שחורה) מהקבוצה ${groupId}:`, `${stage}_BLACKLIST_JOIN_ERROR`, error);
                    await sendAdminAlert(client, `שגיאה בהסרת משתמש ${joinedUserId} (רשימה שחורה) מהקבוצה ${groupId}.`);
                }
            } else {
                log(`User ${joinedUserId} joined group ${groupId} and is not blacklisted.`, stage);
                // Potentially trigger a welcome message or verification if that's a desired flow for new joins.
            }
        }
    } catch (error) {
        logError('שגיאה בטיפול באירוע כניסה לקבוצה (group_join):', stage, error);
    }
});

// עדכון הגדרות החיבור לאתר
const WP_SITE = 'https://ofec.co.il';
const WP_ENDPOINT = '/wp-json/whatsapp-bot/v1/update';

// פונקציה לשליחת עדכונים לדשבורד
async function sendDashboardUpdate(data) {
    // io.emit('stats', data);
}

// הפעלת השרת
const PORT = process.env.PORT || 3003;
const startServer = async (port) => {
    const stage = "SERVER_STARTUP";
    try {
        http.listen(port, () => {
            log(`השרת פועל על פורט ${port}`, stage);
        });
    } catch (error) {
        if (error.code === 'EADDRINUSE') {
            logError(`פורט ${port} תפוס, מנסה פורט ${port + 1}`, stage, error);
            startServer(port + 1);
        } else {
            logError(`שגיאה קריטית בהפעלת השרת: ${error.message}. יוצא מהתהליך.`, stage, error);
            process.exit(1);
        }
    }
};

startServer(PORT);

// התחלת הבוט
initializeClient();


// פונקציה לבדיקת הודעות ישנות
async function checkOldMessages(client) {
    const stage = "OLD_MESSAGE_CHECK";
    try {
        log("Starting periodic check for old messages.", stage);
        const threeDaysAgo = new Date();
        threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
        log(`Checking messages older than ${threeDaysAgo.toISOString()}`, stage);

        const managedGroupsArray = Array.from(botConfig.managedGroups);
        log(`Checking ${managedGroupsArray.length} managed groups...`, stage);

        for (const groupId of managedGroupsArray) {
            const groupStage = `${stage}[${groupId}]`;
            try {
                log(`Checking messages in group ${groupId}...`, groupStage);
                const chat = await client.getChatById(groupId);
                const messages = await chat.fetchMessages({ limit: 500 }); // Consider if 500 is too many/few
                log(`Found ${messages.length} messages to check in group ${chat.name || 'Unnamed Group'} (${groupId})`, groupStage);

                let checkedMessages = 0;
                let foundOldLinks = 0; // Changed variable name for clarity

                for (const message of messages) {
                    checkedMessages++;
                    // Check if the message is older than the threshold
                    // Note: message.timestamp is in seconds, Date.now() is in milliseconds
                    if ((message.timestamp * 1000) < threeDaysAgo.getTime()) {
                        log(`Old message found from: ${message.author || message.from} in group ${groupId}. Content (first 50 chars): ${message.body.substring(0,50)}`, groupStage);
                        // Further processing for old messages can be added here if needed
                        // For now, just logging it.
                        // If it's specifically about links:
                        if (message.body.match(/(?:https?:\/\/|www\.)[^\s]+/i)) {
                            foundOldLinks++;
                        }
                    }
                }
                log(`Finished checking ${checkedMessages} messages. Found ${foundOldLinks} old messages containing links in group ${chat.name || groupId}`, groupStage);
            } catch (error) {
                logError(`Error checking old messages in group ${groupId}:`, groupStage, error);
            }
        }
        log("Finished periodic check for old messages.", stage);
    } catch (error) {
        logError('Critical error during checkOldMessages:', stage, error);
    }
}

// פונקציה לזיהוי והוספת כל הקבוצות שהבוט מנהל בהן
async function addAllManagedGroups(client) {
    const stage = "GROUP_SCAN_MANAGED";
    try {
        log('מתחיל סריקת קבוצות לגילוי קבוצות מנוהלות על ידי הבוט...', stage);
        const chats = await client.getChats();
        log(`Found ${chats.length} total chats to scan.`, stage);
        let addedGroups = 0;

        for (const chat of chats) {
            if (chat.isGroup) {
                const groupStage = `${stage}[${chat.id._serialized}]`;
                log(`Checking group: ${chat.name || chat.id._serialized}`, groupStage);
                try {
                    const isAdmin = await isGroupAdmin(client, chat.id._serialized);
                    if (!isAdmin) {
                        log(`הבוט אינו מנהל את הקבוצה ${chat.name || chat.id._serialized}, מדלג`, groupStage);
                        continue;
                    }
                    log(`Bot is admin in group: ${chat.name || chat.id._serialized}. Attempting to add to managed list.`, groupStage);
                    if (botConfig.addManagedGroup(chat.id._serialized)) {
                        log(`נוספה קבוצה מנוהלת: ${chat.name || chat.id._serialized}`, groupStage);
                        addedGroups++;
                    } else {
                        log(`הקבוצה ${chat.name || chat.id._serialized} כבר רשומה כמנוהלת.`, groupStage);
                    }
                } catch (error) {
                    logError(`שגיאה בבדיקת קבוצה ${chat.name || chat.id._serialized}:`, groupStage, error);
                }
            }
        }
        log(`סיים סריקת קבוצות. נוספו ${addedGroups} קבוצות מנוהלות חדשות. סה"כ קבוצות מנוהלות: ${botConfig.managedGroups.size}`, stage);
    } catch (error) {
        logError('שגיאה קריטית בסריקת קבוצות מנוהלות:', stage, error);
    }
}

// פונקציה לניקוי תקופתי של משתמשים "תקועים"
async function periodicCleanup() {
    const stage = "PERIODIC_CLEANUP";
    log('מתחיל ניקוי תקופתי של משתמשים תקועים...', stage);
    let cleanedCount = 0;

    const now = Date.now();
    const twentyFourHoursMs = 24 * 60 * 60 * 1000;

    log(`Checking ${pendingUsers.size} users in pendingUsers.`, stage);
    for (const [userId, data] of pendingUsers.entries()) {
        if (now - data.timestamp > twentyFourHoursMs) {
            log(`משתמש ${userId} ב-pendingUsers נשאר יותר מ-24 שעות (Timestamp: ${new Date(data.timestamp).toISOString()}). מסיר...`, `${stage}_PENDING`);
            pendingUsers.delete(userId);
            userStates.delete(userId); // Also clear general state
            cleanedCount++;
            log(`Removed ${userId} from pendingUsers and userStates.`, `${stage}_PENDING`);
        }
    }

    log(`Checking ${failedOnceUsers.size} users in failedOnceUsers.`, stage);
    for (const [userId, data] of failedOnceUsers.entries()) {
        if (now - data.timestamp > twentyFourHoursMs) {
            log(`משתמש ${userId} ב-failedOnceUsers נכשל לפני יותר מ-24 שעות (Timestamp: ${new Date(data.timestamp).toISOString()}). מסיר מאיזור הביניים...`, `${stage}_FAILED_ONCE`);
            failedOnceUsers.delete(userId);
            cleanedCount++;
            log(`Removed ${userId} from failedOnceUsers.`, `${stage}_FAILED_ONCE`);
        }
    }

    log(`ניקוי תקופתי הושלם - נוקו ${cleanedCount} רשומות משתמשים תקועים.`, stage);
}

// הפעלת הניקוי כל 24 שעות
setInterval(periodicCleanup, 24 * 60 * 60 * 1000);
log("Periodic cleanup job scheduled to run every 24 hours.", "SCHEDULER");

// הוספת פונקציה לשליחת התראות למנהלים
async function sendAdminAlert(client, message) {
    const stage = "ADMIN_ALERT";
    try {
        log(`שולח התראה למנהלים: "${message}"`, stage);
        let sentToCount = 0;
        for (const adminId of ALERT_ADMIN_NUMBERS) {
            try {
                log(`Attempting to send alert to admin ${adminId}.`, stage);
                await client.sendMessage(adminId, `*🔔 התראה למנהל הבוט 🔔:*\n${message}`);
                log(`Alert sent successfully to admin ${adminId}.`, stage);
                sentToCount++;
            } catch (error) {
                logError(`שגיאה בשליחת התראה למנהל ${adminId}:`, stage, error);
            }
        }
        log(`Admin alert process finished. Sent to ${sentToCount}/${ALERT_ADMIN_NUMBERS.size} admins.`, stage);
    } catch (error) {
        logError('שגיאה קריטית בפונקציית sendAdminAlert:', stage, error);
    }
}

// טיימר ניקוי משתמשים ממתינים (ששלחו קישור ולא התחילו מבחן)
setInterval(async () => {
    const stage = "PENDING_USER_LINK_CLEANUP";
    const now = Date.now();
    const tenMinutesMs = 10 * 60 * 1000;
    log(`Running pending user link cleanup. Checking ${pendingUsers.size} users.`, stage);

    for (const [userId, data] of pendingUsers.entries()) {
        // This cleanup is specifically for the 10-minute timeout for users who sent a link
        // and were asked to start a test.
        if (now - data.timestamp > tenMinutesMs && !activeTests.has(userId)) {
            const userStage = `${stage}[${userId}]`;
            log(`User ${userId} (Original ID: ${data.originalId}) in group ${data.groupId} exceeded 10 min wait time for link verification test. Timestamp: ${new Date(data.timestamp).toISOString()}. Attempting removal.`, userStage);
            try {
                const chat = await client.getChatById(data.groupId);
                // Double check bot is still admin before removing
                if (await isGroupAdmin(client, data.groupId)) {
                    await chat.removeParticipants([data.originalId || userId]); // Use originalId (LID) if available for removal
                    log(`User ${data.originalId || userId} הוסר אוטומטית מהקבוצה ${chat.name || data.groupId} לאחר 10 דקות המתנה למבחן קישור.`, userStage);
                    await sendAdminAlert(client, `המשתמש ${data.originalId || userId} (RealJID: ${userId}) הוסר אוטומטית מהקבוצה ${chat.name || data.groupId} לאחר 10 דקות המתנה למבחן קישור.`);
                    addToBlacklist(userId); // Blacklist the real JID
                    // Consider using addUserToBlacklistWithLid if a message object is available or can be constructed
                } else {
                    log(`Bot is no longer admin in group ${data.groupId}. Cannot remove ${data.originalId || userId}.`, userStage);
                }
                pendingUsers.delete(userId); // Remove from pending list regardless of removal success if bot not admin
                userStates.delete(data.originalId || userId); // Clear state
                log(`User ${userId} processed for link cleanup.`, userStage);
            } catch (error) {
                logError(`שגיאה בהסרת משתמש ${data.originalId || userId} (RealJID: ${userId}) מהקבוצה ${data.groupId} (ניקוי אוטומטי של קישור):`, userStage, error);
                // Still remove from pending to avoid repeated attempts if error is persistent
                pendingUsers.delete(userId);
            }
        }
    }
    log("Pending user link cleanup finished.", stage);
}, 10 * 60 * 1000); // כל 10 דקות (לא 15 כפי שהיה כתוב בהערה המקורית)
log("Pending user link cleanup job scheduled to run every 10 minutes.", "SCHEDULER");


function isAdmin(userId) {
    return ADMIN_NUMBERS.has(userId);
}

// פונקציה לבדיקה אם משתמש חסין
function isImmune(userId) {
    return IMMUNE_NUMBERS.has(userId);
}

// פונקציה לבדיקה אם משתמש מאושר
function isApproved(userId) {
    const id = normalizeId(userId);
    return APPROVED_USERS.has(id) || botConfig.isApprovedUser(id);
}

//
// // טעינת הרשימה השחורה מהקובץ
// try {
//     const blacklistData = fs.readFileSync(blacklistPath, 'utf8');
//     BLACKLIST = new Set(JSON.parse(blacklistData));
//     console.log('רשימה שחורה נטענה:', Array.from(BLACKLIST));
// } catch (error) {
//     console.error('שגיאה בטעינת הרשימה השחורה:', error);
//     BLACKLIST = new Set();
// }

function saveBlacklist() {
    try {
        // Delegate saving to botConfig
        botConfig.saveBlacklistedUsers();
        log(`✅ רשימה שחורה (${BLACKLIST.size} משתמשים) עודכנה בהצלחה דרך botConfig`, "DATA_SAVE_BLACKLIST");
    } catch (error) {
        logError('❌ שגיאה בשמירת הרשימה השחורה דרך botConfig:', "DATA_SAVE_BLACKLIST_ERROR", error);
    }
}

function addToBlacklist(userId) {
    const id = normalizeId(userId);
    log(`Attempting to add user ${id} to blacklist. Current size: ${BLACKLIST.size}`, "BLACKLIST_ADD");
    botConfig.addToBlacklist(id);
    log(`User ${id} processed for blacklist addition. New size: ${BLACKLIST.size}. User is on blacklist: ${BLACKLIST.has(id)}`, "BLACKLIST_ADD");
}

function removeFromBlacklist(userId) {
    const id = normalizeId(userId);
    log(`Attempting to remove user ${id} from blacklist. Current size: ${BLACKLIST.size}`, "BLACKLIST_REMOVE");
    botConfig.removeFromBlacklist(id);
    log(`User ${id} processed for blacklist removal. New size: ${BLACKLIST.size}. User is on blacklist: ${BLACKLIST.has(id)}`, "BLACKLIST_REMOVE");
}

// שמירה אוטומטית כל 5 דקות
setInterval(() => {
    const stage = "AUTO_SAVE";
    log('🔄 מבצע שמירה אוטומטית של נתונים...', stage);
    log(`מצב נוכחי לפני שמירה: רשימה שחורה: ${BLACKLIST.size} משתמשים, משתמשים מאושרים: ${APPROVED_USERS.size} משתמשים`, stage);
    saveBlacklist();
    saveApprovedUsers();
    log('🔄 שמירה אוטומטית הושלמה.', stage);
}, 5 * 60 * 1000);
log("Automatic data saving job scheduled every 5 minutes.", "SCHEDULER");


// טעינת המשתמשים המאושרים מהקובץ
try {
    const approvedData = fs.readFileSync(approvedPath, 'utf8');
    APPROVED_USERS = new Set(JSON.parse(approvedData).map(normalizeId));
    log(`משתמשים מאושרים נטענו (${APPROVED_USERS.size} משתמשים): ${Array.from(APPROVED_USERS).join(', ')}`, "CONFIG_LOAD_APPROVED");
} catch (error) {
    logError('שגיאה בטעינת המשתמשים המאושרים:', "CONFIG_LOAD_APPROVED_ERROR", error);
    APPROVED_USERS = new Set();
}

function saveApprovedUsers() {
    const stage = "DATA_SAVE_APPROVED";
    try {
        fs.writeFileSync('approved-users.json', JSON.stringify(Array.from(APPROVED_USERS)));
        log(`✅ משתמשים מאושרים (${APPROVED_USERS.size}) נשמרו בהצלחה.`, stage);
        return true;
    } catch (error) {
        logError('❌ שגיאה בשמירת המשתמשים המאושרים:', `${stage}_ERROR`, error);
        return false;
    }
}

function removeApprovedUser(userId) {
    const stage = "APPROVED_USER_REMOVE";
    log(`Attempting to remove user ${userId} from approved users. Currently ${APPROVED_USERS.size} approved.`, stage);
    APPROVED_USERS.delete(userId);
    const saved = saveApprovedUsers();
    if (saved) {
        log(`משתמש ${userId} הוסר מהמשתמשים המאושרים בהצלחה. ${APPROVED_USERS.size} remaining.`, stage);
    } else {
        logError(`שגיאה בהסרת משתמש ${userId} מהמשתמשים המאושרים (שמירה נכשלה).`, `${stage}_ERROR`);
    }
    return saved;
}


/**
 * Send a detailed “user removed” alert to all admins.
 * Returns a Promise you can await.
 */
async function alertRemoval(client, reason, message, group_name) {
    const textPart =
        message?.body?.trim() ? `\n📝 תוכן: ${message.body.trim()}` : '';
    const senderJid = await getRealSenderJid(message);
    const phoneNumber = senderJid.split('@')[0];

    // build the alert text
    const alertText =
        `🚫 המשתמש ${phoneNumber} ` +
        `הועף מהקבוצה ${message._chat?.name || message._chat?.id._serialized}\n` +
        `סיבה: ${reason}${textPart}
    הקבוצה היא: ${group_name}`;

    await sendAdminAlert(client, alertText);   // <-- await here
}

async function alertDeletion(client, reason, message, chat = null) {
    // if you didn’t pass the chat, fetch it once:
    if (!chat) chat = await message.getChat();

    const groupName = chat.name || chat.id._serialized;

    const senderJid = await getRealSenderJid(message);
    const phoneNumber = senderJid.split('@')[0];

    const bodyPart = message.body?.trim()
        ? `\n📝 תוכן: ${message.body.trim()}`
        : '';                                             // empty for stickers/media

    const alertText =
        `🗑️ *הודעה נמחקה*\n` +
        `קבוצה: ${groupName}\n` +
        `משתמש: ${phoneNumber}\n` +
        `סיבה: ${reason}${bodyPart}`;

    await sendAdminAlert(client, alertText);
}




/*****************************************************************
 *  Universal phone-number normaliser for WhatsApp JIDs
 *  ------------------------------------------------------
 *  • Strips every non-digit
 *  • Accepts prefixes written as  +44…, 0044…, 44…
 *  • For local Israeli numbers starting with a single 0
 *    (e.g. 054-1234567) it prepends 972.
 *  • Ensures the final string is 8-15 digits (E.164 length range)
 *****************************************************************/
/*
function formatPhoneNumber(raw) {
  let n = raw.trim();

  // 1. handle +CC…  → drop ‘+’
  if (n.startsWith('+')) n = n.slice(1);

  // 2. handle 00CC… → drop leading 00
  if (n.startsWith('00')) n = n.slice(2);

  // 3. keep only digits
  n = n.replace(/\D/g, '');

  // 4. local IL fallback: 05x… or 0x…  (one leading zero only)
  if (/^0\d{8,9}$/.test(n)) n = '972' + n.slice(1);

  return n;
}*/

/** Returns TRUE iff the number is 8-to-15 digits (E.164 safe range) */
function isValidE164(num) {
    return /^\d{8,15}$/.test(num);
}

/**
 * Returns the real sender JID, never @lid
 * (works in groups and private chats)
 */
async function getRealSenderJid(msg) {
    // 1. Prefer explicit author (group), else from (private chat)
    let jid = msg.author || msg.from;
    const initialJid = jid;

    // 2. If it's a link-preview stub → ask WhatsApp for the contact behind it
    if (jid && jid.endsWith('@lid')) {
        log(`Original JID ${jid} is an LID. Fetching contact...`, "JID_RESOLUTION");
        const contact = await msg.getContact();   // whatsapp-web.js helper
        jid = contact.id._serialized;             // e.g. '972501234567@c.us'
        log(`Resolved LID ${initialJid} to ${jid}`, "JID_RESOLUTION");
    } else {
        // log(`JID ${jid} is not an LID or is undefined.`, "JID_RESOLUTION");
    }

    if (!jid) {
        logError(`Could not determine a valid JID from message. Initial: ${initialJid}, msg.author: ${msg.author}, msg.from: ${msg.from}`, "JID_RESOLUTION_ERROR");
        // Fallback to a generic unknown if absolutely necessary, though this indicates a problem.
        return "unknown@c.us";
    }

    return jid;  // always something@c.us or something@s.whatsapp.net
}


async function kickUserFromGroup(client, userId, groupId) {
    const stage = `KICK_USER[${userId}_FROM_${groupId}]`;
    log(`Attempting to kick user ${userId} from group ${groupId}`, stage);
    try {
        const chat = await client.getChatById(groupId);
        log(`Fetched chat object for group ${groupId}. Name: ${chat.name || 'N/A'}`, stage);

        if (!chat.participants || chat.participants.length === 0) {
            log('Fetching participants as current list is empty or missing...', stage);
            await chat.fetchParticipants();
            log(`Fetched ${chat.participants.length} participants for group ${groupId}.`, stage);
        }

        const userPhone = userId.replace(/@c\.us$|@lid$/, ''); // Handle both @c.us and @lid
        const last9 = userPhone.slice(-9);
        log(`Normalized userPhone: ${userPhone}, last9: ${last9}. Searching for user in ${chat.participants.length} participants.`, stage);

        let participantToRemove = null;
        for (const p of chat.participants) {
            const pId = p.id._serialized;
            const pUser = p.id.user || '';
            const pPhoneTail = pUser.replace(/\D/g, '').slice(-9);

            if (pId === userId || pUser === userPhone || pPhoneTail === last9 || (p.contact?.number && p.contact.number.replace(/\D/g, '').slice(-9) === last9)) {
                participantToRemove = pId;
                log(`Found participant to remove: ${pId} (Matched by various checks)`, stage);
                break;
            }
        }

        if (!participantToRemove) {
            logError(`ℹ️ User ${userId} (phone: ${userPhone}) not found in group ${chat.name || groupId}.`, stage);
            log('Sample participants in group for debugging:', stage);
            chat.participants.slice(0, 5).forEach((p, i) => { // Log more for debugging
                log(`  ${i + 1}. ID: ${p.id._serialized} (user: ${p.id.user}, name: ${p.name || p.pushname || 'N/A'})`, stage);
            });
            return false;
        }

        log(`Attempting to remove ${participantToRemove} using various methods...`, stage);

        // Method 1: Standard method with the found participant ID
        try {
            log(`Method 1: Removing with ID ${participantToRemove}`, stage);
            await chat.removeParticipants([participantToRemove]);
            log(`✅ Successfully removed ${participantToRemove} from ${chat.name || groupId} using Method 1.`, stage);
            return true;
        } catch (err) {
            logError(`Method 1 (ID: ${participantToRemove}) failed: ${err.message}`, `${stage}_METHOD_1_FAIL`, err);
        }

        // Method 2: Try with just the phone number (no @c.us or @lid)
        try {
            const phoneOnly = participantToRemove.replace(/@c\.us$|@lid$/, '');
            log(`Method 2: Trying with phone only: ${phoneOnly}`, stage);
            await chat.removeParticipants([phoneOnly]);
            log(`✅ Successfully removed ${phoneOnly} from ${chat.name || groupId} using Method 2.`, stage);
            return true;
        } catch (err) {
            logError(`Method 2 (phoneOnly: ${participantToRemove.replace(/@c\.us$|@lid$/, '')}) failed: ${err.message}`, `${stage}_METHOD_2_FAIL`, err);
        }

        // Method 3: Get the actual participant object and use its ID again (if resolution changed)
        try {
            log(`Method 3: Refetching participant object...`, stage);
            const participantObj = chat.participants.find(p =>
                p.id._serialized === participantToRemove ||
                p.id.user === userPhone ||
                (p.id.user || '').replace(/\D/g, '').slice(-9) === last9
            );

            if (participantObj && participantObj.id) {
                log(`Found participant object with ID: ${participantObj.id._serialized}. Trying with this ID.`, stage);
                if (participantObj.id.toJid) { // Check if toJid method exists
                    const jidFromObj = participantObj.id.toJid();
                    log(`Using JID from participant object: ${jidFromObj}`, stage);
                    await chat.removeParticipants([jidFromObj]);
                    log(`✅ Successfully removed ${jidFromObj} from ${chat.name || groupId} using Method 3 (participant.id.toJid()).`, stage);
                    return true;
                } else {
                     log(`Participant object found, but no toJid method. Trying with _serialized ID: ${participantObj.id._serialized}`, stage);
                     await chat.removeParticipants([participantObj.id._serialized]);
                     log(`✅ Successfully removed ${participantObj.id._serialized} from ${chat.name || groupId} using Method 3 (participant.id._serialized).`, stage);
                     return true;
                }
            } else {
                log(`Method 3: Participant object not found for ${participantToRemove}.`, stage);
            }
        } catch (err) {
            logError(`Method 3 (participant object) failed: ${err.message}`, `${stage}_METHOD_3_FAIL`, err);
        }

        // Method 4: Use the internal WhatsApp Web API directly (Store API)
        try {
            log('Method 4: Trying Store API method...', stage);
            const result = await client.pupPage.evaluate(async (chatId, pIdToRemove, phNumber) => {
                // This internal evaluate function cannot use the outer `log` or `logError`
                // console.log inside evaluate will go to browser console, not Node console.
                try {
                    const chatObj = await window.Store.Chat.get(chatId);
                    if (!chatObj) return { success: false, error: 'Store: Chat not found' };

                    const widsToTry = [
                        window.Store.WidFactory.createWid(pIdToRemove), // Original ID (could be @c.us or @lid)
                        window.Store.WidFactory.createWid(phNumber + '@c.us'), // Phone number + @c.us
                        window.Store.WidFactory.createWid(phNumber + '@lid')   // Phone number + @lid
                    ];

                    // Deduplicate WIDs in case pIdToRemove already matches one of the constructed ones
                    const uniqueWids = [...new Set(widsToTry.map(wid => wid.toString()))].map(strWid => window.Store.WidFactory.createWid(strWid));


                    for (const wid of uniqueWids) {
                        try {
                            // console.log(`Store: Attempting to remove WID: ${wid.toString()}`);
                            await window.Store.GroupParticipants.removeParticipants(chatObj, [wid]);
                            return { success: true, removedWid: wid.toString() };
                        } catch (e) {
                            // console.log(`Store: Failed to remove WID ${wid.toString()}: ${e.message}`);
                        }
                    }
                    return { success: false, error: 'Store: All WID formats failed' };
                } catch (err) {
                    return { success: false, error: `Store: ${err.message}`, stack: err.stack };
                }
            }, groupId, participantToRemove, userPhone);

            if (result.success) {
                log(`✅ Successfully removed via Store method! Removed WID: ${result.removedWid}`, stage);
                return true;
            } else {
                logError(`Method 4 (Store API) failed: ${result.error}. Stack (if any): ${result.stack}`, `${stage}_METHOD_4_FAIL`);
            }
        } catch (evalErr) {
            logError(`Method 4 (Store API) evaluation error: ${evalErr.message}`, `${stage}_METHOD_4_EVAL_ERROR`, evalErr);
        }

        logError(`❌ All removal methods failed for ${participantToRemove} (user: ${userId}) from group ${groupId}.`, stage);
        log(`Debug info for failed removal: User phone: ${userPhone}, Last 9: ${last9}, Participant ID tried: ${participantToRemove}`, stage);
        return false;
    } catch (error) {
        logError(`❌ Critical error in kickUserFromGroup for ${userId} from ${groupId}:`, stage, error);
        return false;
    }
}

/**
 * Kick a user from all groups using individual removal calls
 * This avoids the issues with looping through groups in a single function
 * 
 * @param {Object} client - The WhatsApp client instance
 * @param {String} phoneNumber - The phone number of the user to kick (without @c.us)
 * @param {Array} skipGroupIds - Optional array of group IDs to skip (default: [])
 * @returns {Promise<Object>} - Results of the kick operation
 */

/**
 * Helper function to format phone number to a consistent format
 * 
 * @param {String} number - The phone number to format
 * @returns {String} - Formatted phone number without @c.us suffix
 */
function formatPhoneNumber(number) {
    // Remove @c.us suffix if present
    let phoneNumber = String(number).replace(/@c\.us$/, '');

    // Remove all non-digit characters
    let cleanNumber = phoneNumber.replace(/\D/g, '');

    // Handle US numbers
    if (cleanNumber.startsWith('1') && cleanNumber.length === 11) {
        return cleanNumber;
    }

    // Remove leading zeros
    cleanNumber = cleanNumber.replace(/^0+/, '');

    // Add country code for Israel if not present
    if (!cleanNumber.startsWith('972')) {
        cleanNumber = '972' + cleanNumber;
    }

    return cleanNumber;
}
function extractPhone(jidLike) {
    if (!jidLike) return '';
    const match = jidLike.toString().match(/(\d{6,})/); // רצף ספרות
    return match ? '+' + match[1] : '';
}
/**
 * Remove a user from all managed WhatsApp groups based on their phone number
 * @param {Object} client - WhatsApp client instance
 * @param {string} phoneNumber - Phone number in any format (e.g., "+1-234-567-8900", "972501234567", "05012345678")
 * @param {Set|Array} managedGroups - Set or Array of group IDs that the bot manages
 * @returns {Object} Result object with statistics
 */
// ──────────────────────────────────────────────────────────────
//  UNIVERSAL “KICK-EVERYONE” HELPER
//  works with whatsapp-web.js ≥ 1.30 and the new LID format
// ──────────────────────────────────────────────────────────────
// ───────────────────────────────────────────────────────────────
//  removeUserFromAllGroups – aggressive “no-one left behind” mode
// ───────────────────────────────────────────────────────────────
/**
 * Kick a phone number from every managed group
 * ------------------------------------------------------------
 * – works with @c.us and the new @lid IDs
 * – tries each candidate JID until one works
 * – deletes last 100 messages authored by that user
 */
async function kickUserFromAllGroups(client, rawNumber) {
    /* ------- canonicalize + validate number ------- */
    const e164 = formatPhoneNumberToE164(rawNumber);      // '972549232327'
    if (!e164) {
        return { success: false, error: 'invalid_number' };
    }
    const jidCanonical = `${e164}@c.us`;                  // '972549232327@c.us'

    /* ---------- result counters ---------- */
    let removed = 0;
    let failed = 0;
    let notAdmin = 0;
    let wipedMsgs = 0;
    const perGroup = [];

    /* turn the Set that you store in botConfig into an array once */
    const groups = Array.from(botConfig.managedGroups || []);
    const stage = `KICK_ALL[${e164}]`;

    log(`Attempting to remove ${jidCanonical} from ${groups.length} managed groups.`, stage);

    for (const groupId of groups) {
        let groupName = groupId;
        const groupStage = `${stage}_GROUP[${groupId}]`;
        log(`Processing group ${groupId} for user removal ${jidCanonical}.`, groupStage);

        try {
            const success = await kickUserFromGroup(client, jidCanonical, groupId); // This function now has its own detailed logging

            // Get chat details for richer logging and admin check
            let chat;
            try {
                chat = await client.getChatById(groupId);
                groupName = chat.name || groupId;
                log(`Fetched chat details for ${groupName}.`, groupStage);
            } catch (chatErr) {
                logError(`Error getting chat details for ${groupId}: ${chatErr.message}`, groupStage, chatErr);
                failed++; // Count as failed if we can't even get chat details for admin check
                perGroup.push({ group: groupName, removed: false, error: `Chat details error: ${chatErr.message}` });
                continue; // Skip to next group if chat details fail
            }

            if (!(await isGroupAdmin(client, groupId))) {
                log(`Bot is not admin in group ${groupName}. Skipping removal and message wipe.`, groupStage);
                notAdmin++;
                perGroup.push({ group: groupName, removed: false, error: 'bot_not_admin' });
                continue;
            }

            if (success) {
                log(`Successfully removed ${jidCanonical} from group ${groupName}.`, groupStage);
                removed++;
                perGroup.push({ group: groupName, removed: true, error: '' });

                // Try to delete messages
                log(`Attempting to wipe messages for ${jidCanonical} in ${groupName}.`, `${groupStage}_MSG_WIPE`);
                try {
                    const msgs = await chat.fetchMessages({ limit: 100 }); // Consider if 100 is appropriate
                    let currentWiped = 0;
                    for (const m of msgs) {
                        const msgAuthor = m.author || m.from || m._data?.author || m._data?.from;
                        if (msgAuthor === jidCanonical || (m.author && m.author.endsWith('@lid') && msg.author.startsWith(e164))) { // Check for LID match too
                            try {
                                await m.delete(true);
                                wipedMsgs++;
                                currentWiped++;
                            } catch (delErr) {
                                logError(`Failed to delete message ${m.id._serialized} from ${msgAuthor}: ${delErr.message}`, `${groupStage}_MSG_WIPE_ERROR`, delErr);
                            }
                        }
                    }
                    log(`Wiped ${currentWiped} messages for ${jidCanonical} in ${groupName}. Total wiped so far: ${wipedMsgs}.`, `${groupStage}_MSG_WIPE`);
                } catch (err) {
                    logError(`Message wipe process error in ${groupName} for ${jidCanonical}: ${err.message}`, `${groupStage}_MSG_WIPE_ERROR`, err);
                }

                log(`Sending admin alert for manual removal of ${jidCanonical} from ${groupName}.`, groupStage);
                if (typeof alertRemoval === 'function') {
                    try {
                        // Construct a minimal message-like object for alertRemoval if needed
                        const pseudoMessage = { from: jidCanonical, _chat: { name: groupName, id: { _serialized: groupId } } };
                        await alertRemoval(client, 'הסרה ידנית', pseudoMessage, groupName);
                        log(`Admin alert sent for removal from ${groupName}.`, groupStage);
                    } catch (alertErr) {
                        logError(`Admin alert sending error for ${groupName}: ${alertErr.message}`, `${groupStage}_ALERT_ERROR`, alertErr);
                    }
                }

            } else {
                logError(`Failed to remove ${jidCanonical} from group ${groupName} (kickUserFromGroup returned false).`, groupStage);
                failed++;
                perGroup.push({ group: groupName, removed: false, error: 'kick_failed_see_kickUserFromGroup_logs' });
            }

        } catch (err) { // Catch errors from the loop itself, e.g., if getChatById fails badly
            logError(`Critical error processing group ${groupName} for user ${jidCanonical} removal: ${err.message}`, groupStage, err);
            failed++;
            perGroup.push({ group: groupName, removed: false, error: err.message });
        }
    }

    log(`Finished attempt to remove ${jidCanonical} from all groups. Results - Removed: ${removed}, Failed: ${failed}, NotAdmin: ${notAdmin}, WipedMsgs: ${wipedMsgs}`, stage);

    if (typeof addToBlacklist === 'function') {
        log(`Adding ${jidCanonical} to global blacklist after processing all groups.`, stage);
        try {
            addToBlacklist(jidCanonical); // This function now logs internally
            // If addUserToBlacklistWithLid needs a message object, we might not have one here directly.
            // Consider if just blacklisting jidCanonical is sufficient or if LID handling is needed here.
            // For now, just jidCanonical. If a message object is available from the command source, pass it.
            // const blacklistResults = await addUserToBlacklistWithLid(message, addToBlacklist); // This 'message' is undefined here
            log(`User ${jidCanonical} added to blacklist successfully.`, stage);
        } catch (err) {
            logError(`Failed to add ${jidCanonical} to blacklist: ${err.message}`, `${stage}_BLACKLIST_ERROR`, err);
        }
    }

    const finalResults = {
        success: true, // Indicates the overall process ran, check individual results for specifics
        phoneNumber: e164,
        removedFromGroups: removed,
        failedGroups: failed,
        groupsNotAdmin: notAdmin,
        totalDeletedMessages: wipedMsgs,
        groupResults: perGroup
    };
    log(`Final results for kickUserFromAllGroups for ${e164}: ${JSON.stringify(finalResults, null, 2)}`, stage);
    return finalResults;
}


/**
 * Format phone number to E.164 international format
 * @param {string} phoneNumber - Phone number in any format
 * @returns {string|null} Formatted phone number or null if invalid
 */
function formatPhoneNumberToE164(phoneNumber) {
    if (!phoneNumber || typeof phoneNumber !== 'string') {
        return null;
    }

    // Remove all non-digit characters
    let cleaned = phoneNumber.replace(/\D/g, '');

    if (!cleaned) {
        return null;
    }

    // If it starts with 00, remove it (international prefix)
    if (cleaned.startsWith('00')) {
        cleaned = cleaned.substring(2);
    }

    // If it already starts with a country code (length > 10), keep as is
    if (cleaned.length > 10) {
        return cleaned;
    }

    // Handle Israeli numbers (common case from your code)
    if (cleaned.startsWith('0')) {
        // Remove leading 0 and add 972 (Israel country code)
        return '972' + cleaned.substring(1);
    }

    // If it's exactly 10 digits, assume it's missing country code
    // You might want to modify this logic based on your primary user base
    if (cleaned.length === 10) {
        // Default to Israel (972) - modify this based on your needs
        return '972' + cleaned;
    }

    // If it's 9 digits, might be Israeli without leading 0
    if (cleaned.length === 9) {
        return '972' + cleaned;
    }

    // For other cases, assume it's already in correct format
    return cleaned;
}

/**
 * Debug function to test user removal from groups
 * @param {Object} client - WhatsApp client instance
 * @param {string} phoneNumber - Phone number to test
 */
async function debugUserRemoval(client, phoneNumber) {
    const stage = `DEBUG_USER_REMOVAL[${phoneNumber}]`;
    log('=== START DEBUG USER REMOVAL ===', stage);
    log(`Input phone number for debug removal: ${phoneNumber}`, stage);

    const e164 = formatPhoneNumberToE164(phoneNumber);
    log(`Formatted phone to E164: ${e164}`, stage);

    if (!e164) {
        logError('❌ Failed to format phone number for debug removal. Aborting.', stage);
        log('=== END DEBUG USER REMOVAL ===', stage);
        return;
    }

    const jidCanonical = `${e164}@c.us`;
    log(`Canonical JID for debug removal: ${jidCanonical}`, stage);

    const groups = Array.from(botConfig.managedGroups || []);
    log(`Total managed groups for debug check: ${groups.length}`, stage);

    if (groups.length === 0) {
        logError('❌ No managed groups found for debug removal. Aborting.', stage);
        log('=== END DEBUG USER REMOVAL ===', stage);
        return;
    }

    const testGroupId = groups[0]; // Using only the first group for this debug function
    log(`Will test removal from the first managed group: ${testGroupId}`, stage);
    const groupDebugStage = `${stage}_GROUP_TEST[${testGroupId}]`;

    try {
        const chat = await client.getChatById(testGroupId);
        log(`Successfully got chat object for group: ${chat.name || testGroupId}`, groupDebugStage);

        const isBotCurrentlyAdmin = await isGroupAdmin(client, testGroupId);
        log(`Bot admin status in test group ${chat.name || testGroupId}: ${isBotCurrentlyAdmin ? '✅ YES' : '❌ NO'}`, groupDebugStage);

        if (!isBotCurrentlyAdmin) {
            logError('Bot is not an admin in this test group. Cannot perform removal test.', groupDebugStage);
            log('=== END DEBUG USER REMOVAL ===', stage);
            return;
        }

        if (!chat.participants?.length) {
            log('Participants list is initially empty or undefined. Fetching participants...', groupDebugStage);
            await chat.fetchParticipants();
            log(`Fetched ${chat.participants.length} participants for group ${chat.name || testGroupId}.`, groupDebugStage);
        }
        log(`Total participants in test group ${chat.name || testGroupId}: ${chat.participants?.length || 0}`, groupDebugStage);

        log('Listing first 5-10 participants for context:', groupDebugStage);
        chat.participants?.slice(0, 10).forEach((p, i) => {
            log(`  Participant ${i + 1}: ID=${p.id._serialized}, User=${p.id.user}, Server=${p.id.server}, ContactNum=${p.contact?.number || 'N/A'}, Name=${p.name || p.pushname || 'N/A'}`, groupDebugStage);
        });

        const last9DigitsOfTarget = e164.slice(-9);
        log(`Searching for target user in group. Matching criteria: last 9 digits = ${last9DigitsOfTarget} OR full JID = ${jidCanonical}`, groupDebugStage);

        const matchingParticipants = [];
        for (const p of chat.participants || []) {
            const participantId = p.id._serialized;
            const participantUserPart = p.id.user || '';
            const phoneTail = participantUserPart.replace(/\D/g, '').slice(-9);
            const contactNumberLast9 = (p.contact?.number || '').replace(/\D/g, '').slice(-9);

            const matchesCriteria =
                phoneTail === last9DigitsOfTarget ||
                participantId === jidCanonical ||
                participantUserPart === e164 ||
                contactNumberLast9 === last9DigitsOfTarget;

            if (matchesCriteria) {
                matchingParticipants.push({
                    id: participantId, phoneTail, user: participantUserPart,
                    server: p.id.server, isContact: !!p.contact, contactNumber: p.contact?.number
                });
            }
        }

        log(`Found ${matchingParticipants.length} participants matching criteria:`, groupDebugStage);
        matchingParticipants.forEach((p, i) => {
            log(`  Match ${i + 1}: ID=${p.id}, PhoneTail=${p.phoneTail}, User=${p.user}, IsContact=${p.isContact}, ContactNum=${p.contactNumber || 'N/A'}`, groupDebugStage);
        });

        if (matchingParticipants.length === 0) {
            logError('❌ No matching participants found in this group for the debug removal test.', groupDebugStage);
        } else {
            const targetParticipantForRemoval = matchingParticipants[0];
            log(`Attempting to remove the first matching participant: ${targetParticipantForRemoval.id}`, groupDebugStage);
            log('=== TESTING VARIOUS REMOVAL METHODS (DEBUG) ===', groupDebugStage);

            // Method 1: Full JID from match
            try {
                log(`Debug Method 1: Trying with full JID: ${targetParticipantForRemoval.id}`, groupDebugStage);
                await chat.removeParticipants([targetParticipantForRemoval.id]);
                log('✅ Debug Success with full JID!', groupDebugStage);
                log('=== END DEBUG USER REMOVAL ===', stage);
                return;
            } catch (err) {
                logError(`❌ Debug Method 1 (Full JID ${targetParticipantForRemoval.id}) Failed: ${err.message}`, groupDebugStage, err);
            }

            // Method 2: User part only from match
            if (targetParticipantForRemoval.user) {
                try {
                    log(`Debug Method 2: Trying with user part only: ${targetParticipantForRemoval.user}`, groupDebugStage);
                    await chat.removeParticipants([targetParticipantForRemoval.user]);
                    log('✅ Debug Success with user part!', groupDebugStage);
                    log('=== END DEBUG USER REMOVAL ===', stage);
                    return;
                } catch (err) {
                    logError(`❌ Debug Method 2 (User part ${targetParticipantForRemoval.user}) Failed: ${err.message}`, groupDebugStage, err);
                }
            }

            // Method 3: Construct @c.us format using E164
            try {
                const cusFormat = `${e164}@c.us`; // Use the original E164 for this
                log(`Debug Method 3: Trying with constructed @c.us from E164: ${cusFormat}`, groupDebugStage);
                await chat.removeParticipants([cusFormat]);
                log('✅ Debug Success with constructed @c.us format!', groupDebugStage);
                log('=== END DEBUG USER REMOVAL ===', stage);
                return;
            } catch (err) {
                logError(`❌ Debug Method 3 (Constructed @c.us ${e164}@c.us) Failed: ${err.message}`, groupDebugStage, err);
            }

            logError('All debug removal methods failed for the first matched participant.', groupDebugStage);
        }
    } catch (err) {
        logError(`❌ Error during debugUserRemoval main try block (group ${testGroupId}): ${err.message}`, stage, err);
    }
    log('=== END DEBUG USER REMOVAL ===', stage);
}

/**
 * Validate if a phone number is in valid E.164 format
 * @param {string} phoneNumber - Phone number to validate
 * @returns {boolean} True if valid E.164 format
 */
function isValidE164(phoneNumber) {
    if (!phoneNumber || typeof phoneNumber !== 'string') {
        return false;
    }

    // E.164 format: 1-15 digits, starting with country code
    const e164Regex = /^[1-9]\d{1,14}$/;
    return e164Regex.test(phoneNumber);
}

// Example usage:
/*
// Using with your existing managedGroups set
const result = await removeUserFromAllGroups(client, "+1-234-567-8900", botConfig.managedGroups);

// Or with an array of group IDs
const groupIds = ['120363401770902931@g.us', 'another-group-id@g.us'];
const result = await removeUserFromAllGroups(client, "972501234567", groupIds);

console.log(`User removed from ${result.removedFromGroups} groups`);
console.log(`Failed to remove from ${result.failedGroups} groups`);
console.log(`Deleted ${result.totalDeletedMessages} messages`);
console.log(`Bot is not admin in ${result.groupsNotAdmin} groups`);

// Detailed results
result.groupResults.forEach(group => {
    console.log(`Group: ${group.groupName}, Status: ${group.status}, Messages deleted: ${group.messagesDeleted}`);
});
*/
function normalise(d) {
    if (!d) return null;
    if (d.startsWith('00')) d = d.slice(2);
    if (d.startsWith('0') && d.length >= 9) d = '972' + d.slice(1);
    return /^\d{8,15}$/.test(d) ? d : null;
}



/**
 * Simplified solution for getting group participants
 * This approach avoids using client.getChats() which is causing the error
 */

/**
 * Gets all users in a specific WhatsApp group using direct puppeteer evaluation
 * 
 * @param {string} groupId - The ID of the group to get users from
 * @returns {Promise<Array>} - Array of participants
 */
async function getGroupParticipants(groupId) {
    const stage = `GET_GROUP_PARTICIPANTS[${groupId}]`;
    try {
        if (!groupId) {
            logError("Invalid groupId provided to getGroupParticipants", stage);
            return [];
        }

        log(`Getting participants for group: ${groupId}`, stage);

        const evalResult = await client.pupPage.evaluate(async (gid) => {
            // This internal evaluate function cannot use the outer `log` or `logError`
            try {
                const chat = await window.Store.Chat.get(gid);
                if (!chat) return { error: `Store: Chat not found: ${gid}` };

                const groupName = chat.name || "Unknown Group";
                // console.log(`Store: Found group ${groupName}`);

                if (chat.groupMetadata && typeof chat.groupMetadata.queryParticipants === 'function') {
                    try {
                        // console.log(`Store: Querying participants for ${groupName}`);
                        await chat.groupMetadata.queryParticipants();
                    } catch (e) { /* console.log(`Store: queryParticipants failed (continuing): ${e.message}`); */ }
                }

                let participantsArray = [];
                if (chat.groupMetadata && chat.groupMetadata.participants) {
                    participantsArray = chat.groupMetadata.participants.getModelsArray().map(p => ({
                        id: p.id._serialized || p.id.toString(),
                        isAdmin: p.isAdmin,
                        isSuperAdmin: p.isSuperAdmin
                    }));
                }
                // console.log(`Store: Found ${participantsArray.length} participants for ${groupName}`);
                return { name: groupName, participants: participantsArray };
            } catch (error) {
                return { error: `Store: ${error.message}`, stack: error.stack };
            }
        }, groupId);

        if (evalResult.error) {
            logError(`Error getting participants from pupPage.evaluate: ${evalResult.error}`, stage);
            if (evalResult.stack) logError(`Stack: ${evalResult.stack}`, stage);
            return [];
        }

        log(`Group: ${evalResult.name} | Total participants from eval: ${evalResult.participants.length}`, stage);

        evalResult.participants.forEach((participant, index) => {
            log(`User ${index + 1}/${evalResult.participants.length}: ${participant.id} (${participant.isAdmin ? 'Admin' : 'Member'}${participant.isSuperAdmin ? '/SuperAdmin' : ''})`, `${stage}_DETAILS`);
        });

        return evalResult.participants;
    } catch (error) {
        logError(`Critical error in getGroupParticipants for ${groupId}: ${error.message}`, stage, error);
        return [];
    }
}

/**
 * Gets all managed groups and their participants
 * This approach uses the botConfig.managedGroups set that already exists in your code
 * 
 * @returns {Promise<Object>} - Object with group IDs as keys and participant arrays as values
 */
async function getAllManagedGroupsParticipants() {
    const stage = "GET_ALL_MANAGED_PARTICIPANTS";
    try {
        log("Starting to get participants for ALL managed groups...", stage);

        const managedGroupsArray = Array.from(botConfig.managedGroups);

        if (!managedGroupsArray || managedGroupsArray.length === 0) {
            log("No managed groups found. Cannot fetch participants.", stage);
            return {};
        }

        log(`Found ${managedGroupsArray.length} managed groups to process. Groups: ${JSON.stringify(managedGroupsArray)}`, stage);
        log("===================================================", stage);

        const allGroupParticipants = {};
        let processedCount = 0;

        for (let i = 0; i < managedGroupsArray.length; i++) {
            const groupId = managedGroupsArray[i];
            const groupStage = `${stage}_GROUP[${groupId}]`;
            try {
                log(`Processing group ${i + 1}/${managedGroupsArray.length}: ${groupId}`, groupStage);

                // getGroupParticipants already has detailed logging
                const participants = await getGroupParticipants(groupId);

                if (participants && participants.length > 0) {
                    allGroupParticipants[groupId] = participants;
                    log(`Successfully processed and stored ${participants.length} participants for group ${groupId}.`, groupStage);
                    processedCount++;
                } else {
                    log(`No participants found or returned for group ${groupId}. It will not be included in the final map.`, groupStage);
                }
                log("===================================================", groupStage);
            } catch (groupError) {
                logError(`Error processing group ${groupId} at index ${i}: ${groupError.message}`, groupStage, groupError);
                // Continue to the next group even if one fails
            }
        }

        log(`Finished getting participants for all managed groups. Successfully processed ${processedCount} groups out of ${managedGroupsArray.length}.`, stage);
        log(`Total groups in final participant map: ${Object.keys(allGroupParticipants).length}`, stage);

        return allGroupParticipants;
    } catch (error) {
        logError(`Critical error in getAllManagedGroupsParticipants: ${error.message}`, stage, error);
        return {}; // Return empty object on critical failure
    }
}

/**
 * Direct method to get participants for a specific group ID
 * This is the simplest approach and should work with any WhatsApp Web.js version
 * 
 * @param {string} groupId - The ID of the group to get users from (e.g., "120363401770902931@g.us")
 */
async function getParticipantsForGroup(groupId) {
    const stage = `GET_PARTICIPANTS_SINGLE_GROUP[${groupId}]`;
    try {
        log(`Getting participants for specific group: ${groupId}`, stage);

        const chat = await client.getChatById(groupId);
        if (!chat) {
            logError(`Chat not found: ${groupId}`, stage);
            return null; // Return null or empty array as appropriate
        }
        log(`Found group: ${chat.name || groupId}`, stage);

        if (typeof chat.fetchParticipants === 'function') {
            try {
                log("Fetching latest participants data...", stage);
                await chat.fetchParticipants();
                log("Fetched latest participants data successfully.", stage);
            } catch (e) {
                logError(`Error fetching participants for ${groupId}: ${e.message}`, stage, e);
            }
        }

        const participants = chat.participants || [];
        log(`Total participants in group ${groupId}: ${participants.length}`, stage);

        participants.forEach((participant, index) => {
            try {
                const id = participant.id._serialized || "Unknown ID";
                const isAdminText = participant.isAdmin ? "Admin" : "Member";
                const isSuperAdminText = participant.isSuperAdmin ? "/SuperAdmin" : "";
                log(`User ${index + 1}/${participants.length}: ${id} (${isAdminText}${isSuperAdminText})`, `${stage}_DETAILS`);
            } catch (e) {
                logError(`Error getting details for participant at index ${index} in group ${groupId}: ${e.message}`, `${stage}_DETAILS_ERROR`, e);
            }
        });

        return participants;
    } catch (error) {
        logError(`Critical error in getParticipantsForGroup for ${groupId}: ${error.message}`, stage, error);
        return null; // Return null or empty array
    }
}



/**
 * Checks whether the bot is an admin in the specified WhatsApp group,
 * by directly querying the internal Store models via Puppeteer.
 *
 * @param {import('whatsapp-web.js').Client} client  The whatsapp-web.js Client instance.
 * @param {string} groupId                            The group ID (e.g. "12345@g.us").
 * @returns {Promise<boolean>}                        True if the bot is admin or superadmin.
 */
async function isGroupAdmin1(client, groupId) {
    const stage = `IS_GROUP_ADMIN_STORE[${groupId}]`;
    try {
        const rawBotId = client.info.wid._serialized;
        const botUserOnly = rawBotId.replace(/@c\.us$/, "");
        log(`Checking admin status (Store method) for bot ${botUserOnly} in group ${groupId}`, stage);

        const adminCheckResult = await client.pupPage.evaluate(
            async (gid, bUser) => {
                // console.log inside pupPage.evaluate goes to browser console
                try {
                    const chat = window.Store.Chat.get(gid);
                    if (!chat || !chat.groupMetadata) return { isAdmin: false, error: "Chat or groupMetadata not found in Store" };

                    const participants = chat.groupMetadata.participants.getModelsArray();
                    const botParticipant = participants.find(p => p.id.user === bUser);

                    if (!botParticipant) return { isAdmin: false, error: "Bot not found in participants via Store" };
                    return { isAdmin: Boolean(botParticipant.isAdmin || botParticipant.isSuperAdmin), error: null };
                } catch (e) {
                    return { isAdmin: false, error: `Store evaluation error: ${e.message}` };
                }
            },
            groupId,
            botUserOnly
        );

        if (adminCheckResult.error) {
            logError(`Store-based admin check failed for group ${groupId}: ${adminCheckResult.error}`, stage);
            return false;
        }
        log(`Store-based admin check for group ${groupId}: Bot is ${adminCheckResult.isAdmin ? '' : 'not '}admin.`, stage);
        return adminCheckResult.isAdmin;
    } catch (error) {
        logError(`Critical error in isGroupAdmin1 (Store method) for group ${groupId}: ${error.message}`, stage, error);
        return false; // Fallback on critical error
    }
}

/**
 * Send a private message to a specific user based on their phone number.
 * 
 * @param {Object} client - The WhatsApp client instance
 * @param {String} message - The message text to send
 * @param {String} phoneNumber - The phone number of the recipient (can be with or without country code)
 * @returns {Promise<Object>} - A promise that resolves with the sent message object or rejects with an error
 */
async function sendPrivateMessage(client, message, phoneNumber) {
    const stage = `SEND_PRIVATE_MESSAGE[${phoneNumber}]`;
    try {
        log(`Attempting to send private message to ${phoneNumber}. Message: "${message.substring(0, 50)}..."`, stage);

        const formattedNumber = formatPhoneNumberToE164(phoneNumber); // Assumes this function is robust
        if (!formattedNumber) {
            logError(`Invalid phone number format for private message: ${phoneNumber}. Cannot format to E164.`, stage);
            throw new Error(`Invalid phone number format: ${phoneNumber}`);
        }
        const recipientId = `${formattedNumber}@c.us`;
        log(`Formatted recipient ID for private message: ${recipientId}`, stage);

        const sentMessage = await client.sendMessage(recipientId, message);
        log(`Private message sent successfully to ${recipientId}. Message ID: ${sentMessage.id._serialized}`, stage);
        return sentMessage;
    } catch (error) {
        logError(`Error sending private message to ${phoneNumber} (formatted: ${formatPhoneNumberToE164(phoneNumber)}@c.us): ${error.message}`, stage, error);
        throw error; // Re-throw to allow caller to handle
    }
}

/**
 * Format a phone number to E.164 format for WhatsApp
 * 
 * @param {String} phoneNumber - The phone number to format
 * @returns {String} - The formatted phone number
 */
function formatPhoneNumberToE164(phoneNumber) {
    let number = phoneNumber.trim();

    // Remove any non-digit characters
    number = number.replace(/\D/g, '');

    // Handle +CC prefix (remove the +)
    if (phoneNumber.startsWith('+')) {
        number = number;
    }

    // Handle 00CC prefix (remove the leading 00)
    else if (number.startsWith('00')) {
        number = number.substring(2);
    }

    // Handle local Israeli numbers (starting with 0)
    else if (number.startsWith('0') && (number.length === 9 || number.length === 10)) {
        number = '972' + number.substring(1);
    }

    // If no country code and not starting with 0, assume it's already formatted correctly

    return number;
}


/**
 * Adds a user to the blacklist using both their regular JID and @lid identifier
 * @param {Object} message - The WhatsApp message object
 * @param {Function} addToBlacklist - The function used to add users to blacklist
 * @returns {Promise<Object>} - Results of blacklisting operations
 */
async function addUserToBlacklistWithLid(message, addToBlacklist) {
    // Track results for debugging and verification
    const results = {
        regularIdAdded: false,
        lidIdAdded: false,
        regularId: null,
        lidId: null,
        errors: []
    };

    const stage = `BLACKLIST_LID_HANDLER`;
    log(`Starting blacklist process for message sender. Message ID: ${message.id._serialized}`, stage);
    try {
        const senderJid = await getRealSenderJid(message); // This function now logs
        results.regularId = senderJid;
        log(`Real JID resolved to: ${senderJid}`, stage);

        try {
            log(`Adding regular JID ${senderJid} to blacklist.`, stage);
            await addToBlacklist(senderJid); // addToBlacklist has its own logging
            // The line below might be redundant if addToBlacklist handles variations, but keeping for now.
            // await addToBlacklist(senderJid.split('@')[0] + "@c.us");
            results.regularIdAdded = true;
            log(`Successfully processed regular JID ${senderJid} for blacklist.`, stage);
        } catch (error) {
            results.errors.push({ type: 'regular', message: error.message });
            logError(`Error adding regular JID ${senderJid} to blacklist: ${error.message}`, `${stage}_REGULAR_ERROR`, error);
        }

        const originalAuthor = message.author; // The ID as it appeared on the message object
        if (originalAuthor && originalAuthor.includes('@lid')) {
            results.lidId = originalAuthor;
            log(`Original message author ${originalAuthor} is an LID. Adding to blacklist.`, stage);
            try {
                await addToBlacklist(originalAuthor);
                // await addToBlacklist(originalAuthor.split('@')[0] + "@c.us"); // Potentially redundant
                results.lidIdAdded = true;
                log(`Successfully processed LID ${originalAuthor} for blacklist.`, stage);
            } catch (error) {
                results.errors.push({ type: 'lid', message: error.message });
                logError(`Error adding direct LID ${originalAuthor} to blacklist: ${error.message}`, `${stage}_LID_ERROR`, error);
            }
        } else if (senderJid && !senderJid.includes('@lid')) {
            // Attempt to construct and blacklist a potential LID variant if the real JID is @c.us
            const numericPart = senderJid.split('@')[0];
            if (numericPart) {
                const potentialLid = `${numericPart}@lid`;
                results.lidId = potentialLid; // Record the LID we attempted to blacklist
                log(`Real JID ${senderJid} is @c.us. Attempting to also blacklist potential LID: ${potentialLid}`, stage);
                try {
                    await addToBlacklist(potentialLid);
                    results.lidIdAdded = true; // Mark as added even if it was already there or addToBlacklist handles duplicates
                    log(`Successfully processed potential LID ${potentialLid} for blacklist.`, stage);
                } catch (error) {
                    results.errors.push({ type: 'generated-lid', message: error.message });
                    logError(`Error adding generated LID ${potentialLid} to blacklist: ${error.message}`, `${stage}_GENERATED_LID_ERROR`, error);
                }
            }
        } else {
            log(`No direct LID found on message.author, and real JID ${senderJid} is either already LID or could not derive numeric part.`, stage);
        }
        log(`Finished blacklist process for message. Results: ${JSON.stringify(results)}`, stage);
        return results;
    } catch (error) {
        results.errors.push({ type: 'general', message: error.message });
        logError(`General error in addUserToBlacklistWithLid: ${error.message}`, `${stage}_GENERAL_ERROR`, error);
        return results;
    }
}
cron.schedule(
    '0 4 * * *',
    async () => {
        const cronStage = "CRON_APPROVE_REQUESTS";
        try {
            log('CRON job "approveGroupRequests" at 04:00 Asia/Jerusalem started.', cronStage);
            // The approveGroupRequests function should have its own internal logging
            await approveGroupRequests(null, {}, client);
            log('CRON job "approveGroupRequests" completed successfully.', cronStage);
        } catch (err) {
            logError('CRON job "approveGroupRequests" FAILED.', cronStage, err);
        }
    },
    {
        scheduled: true,
        timezone: 'Asia/Jerusalem',   // guarantees “4 AM” is local Israeli time
    }
);
async function approveGroupRequests(groupId = null, options = {}, client) {
    try {
        // Use the BLACKLIST variable which should be synced with botConfig.blacklistedUsers
        // Ensure BLACKLIST is up-to-date if it's not a direct reference
        const stage = groupId ? `APPROVE_REQUESTS_SINGLE[${groupId}]` : "APPROVE_REQUESTS_ALL";
        log(`Starting approveGroupRequests. Group ID: ${groupId || 'ALL'}. Options: ${JSON.stringify(options)}`, stage);

        let currentBlacklist = BLACKLIST;
        if (!(currentBlacklist instanceof Set)) {
            logError("BLACKLIST is not a Set in approveGroupRequests. Using botConfig.blacklistedUsers directly or falling back.", stage);
            currentBlacklist = botConfig.blacklistedUsers || new Set();
        }
        log(`Using blacklist with ${currentBlacklist.size} entries.`, stage);

        if (groupId) {
            // Logic for single group
            const chat = await client.getChatById(groupId);
            log(`Fetched chat details for single group processing: ${chat.name || groupId}`, stage);
            const botContact = await client.getContactById(client.info.wid._serialized);
            const isBotAdminInGroup = chat.participants.some(p =>
                p.id._serialized === botContact.id._serialized && (p.isAdmin || p.isSuperAdmin)
            );

            if (!isBotAdminInGroup) {
                logError(`Bot is not admin in group ${groupId}. Cannot approve requests.`, stage);
                return `❌ Bot is not admin in group ${groupId}`;
            }
            log(`Bot is admin in group ${groupId}. Proceeding with requests.`, stage);

            const membershipRequests = await client.getGroupMembershipRequests(groupId);
            log(`Found ${membershipRequests.length} membership requests for group ${groupId}.`, stage);
            if (membershipRequests.length === 0) {
                return `✅ No pending membership requests for group ${groupId}`;
            }

            // log(`Raw membership requests for ${groupId}: ${JSON.stringify(membershipRequests, null, 2)}`, `${stage}_RAW_REQUESTS`);

            const allowedRequesterIds = [];
            const blockedRequesters = [];

            for (const request of membershipRequests) {
                let requesterId = null;
                const reqStage = `${stage}_REQUEST_PROCESS[${request.id?.toString() || 'unknown_req_id'}]`;
                try {
                    // Simplified requester ID extraction
                    requesterId = request.author?._serialized || request.author || request.id?._serialized || request.id || request.requester?._serialized || request.requester || request.addedBy?._serialized || request.addedBy;
                    log(`Extracted requester ID: ${requesterId} from request.`, reqStage);

                    if (requesterId) {
                        if (!currentBlacklist.has(requesterId)) {
                            allowedRequesterIds.push(requesterId);
                            log(`Requester ${requesterId} is NOT blacklisted. Added to allowed list.`, reqStage);
                        } else {
                            blockedRequesters.push(requesterId);
                            log(`Requester ${requesterId} IS blacklisted. Added to blocked list.`, reqStage);
                        }
                    } else {
                        logError('Could not extract a valid requester ID from request object.', reqStage);
                    }
                } catch (extractionError) {
                    logError('Error extracting requester ID:', reqStage, extractionError);
                }
            }

            log(`Total allowed: ${allowedRequesterIds.length}, Total blocked: ${blockedRequesters.length} for group ${groupId}.`, stage);

            if (allowedRequesterIds.length === 0) {
                const msg = `⚠️ No valid (non-blacklisted) requests to approve for group ${groupId}. Blacklisted: ${blockedRequesters.length}, Failed to process/extract ID: ${membershipRequests.length - allowedRequesterIds.length - blockedRequesters.length}`;
                log(msg, stage);
                return msg;
            }

            log(`Attempting to approve ${allowedRequesterIds.length} requests for group ${groupId}: ${JSON.stringify(allowedRequesterIds)}`, stage);
            try {
                const approvalResults = await client.approveGroupMembershipRequests(groupId, { requesterIds: allowedRequesterIds, ...options });
                log(`WA-Web.js approveGroupMembershipRequests returned: ${JSON.stringify(approvalResults)}`, stage);
                // The return from approveGroupMembershipRequests might not be a simple count or array of successes.
                // We assume it throws on complete failure for this group.
                // For more detailed success/failure per user, individual approvals would be needed.
                const numApproved = Array.isArray(approvalResults) ? approvalResults.filter(r => r.success || r.status === 200 || typeof r === 'string').length : (typeof approvalResults === 'object' ? Object.keys(approvalResults).length : allowedRequesterIds.length); // Approximation

                const successMsg = `✅ Processed membership requests for group ${groupId}.\n` +
                                 `📋 Approved: ${numApproved} (attempted: ${allowedRequesterIds.length})\n` +
                                 `🚫 Blocked (blacklisted): ${blockedRequesters.length}`;
                log(successMsg, stage);
                return successMsg;
            } catch (approvalError) {
                logError(`Error during bulk approval for group ${groupId}:`, `${stage}_APPROVAL_ERROR`, approvalError);
                log(`Attempted to approve IDs: ${JSON.stringify(allowedRequesterIds)}`, `${stage}_APPROVAL_ERROR`);

                // Fallback to individual approvals for more granular error reporting / partial success
                let individualSuccessCount = 0;
                log("Attempting individual approvals as fallback...", `${stage}_INDIVIDUAL_APPROVAL`);
                for (const id of allowedRequesterIds) {
                    try {
                        await client.approveGroupMembershipRequests(groupId, { requesterIds: [id], ...options });
                        individualSuccessCount++;
                        log(`Successfully approved ${id} individually.`, `${stage}_INDIVIDUAL_APPROVAL`);
                    } catch (individualError) {
                        logError(`Failed to approve ${id} individually: ${individualError.message}`, `${stage}_INDIVIDUAL_APPROVAL_ERROR`, individualError);
                    }
                }
                const fallbackMsg = `⚠️ Partial approval for group ${groupId}: ${individualSuccessCount}/${allowedRequesterIds.length} approved individually.\n` +
                                  `🚫 Blocked (blacklisted): ${blockedRequesters.length}\n` +
                                  `❌ Some requests may have failed. See console for details.`;
                log(fallbackMsg, stage);
                return fallbackMsg;
            }
        } else {
            // Logic for ALL groups
            log("Processing requests for ALL managed groups.", stage);
            const chats = await client.getChats();
            const groupsToProcess = chats.filter(chat => chat.isGroup && botConfig.isManagedGroup(chat.id._serialized));
            log(`Found ${groupsToProcess.length} managed groups to iterate for approvals.`, stage);

            let totalApprovedCount = 0;
            let totalBlockedCount = 0;
            let groupsWhereBotIsAdmin = 0;
            let groupsWhereBotNotAdmin = 0;
            let summaryPerGroup = [];

            for (const group of groupsToProcess) {
                const singleGroupStage = `APPROVE_REQUESTS_ALL_SUB[${group.id._serialized}]`;
                log(`Processing group: ${group.name || group.id._serialized}`, singleGroupStage);
                try {
                    const botContact = await client.getContactById(client.info.wid._serialized);
                    const isBotAdminInThisGroup = group.participants.some(p =>
                        p.id._serialized === botContact.id._serialized && (p.isAdmin || p.isSuperAdmin)
                    );

                    if (isBotAdminInThisGroup) {
                        groupsWhereBotIsAdmin++;
                        log(`Bot is admin in ${group.name}. Fetching requests.`, singleGroupStage);
                        const requestsInGroup = await client.getGroupMembershipRequests(group.id._serialized);
                        log(`Found ${requestsInGroup.length} requests for group ${group.name}.`, singleGroupStage);

                        if (requestsInGroup.length > 0) {
                            const allowedInThisGroup = [];
                            const blockedInThisGroup = [];
                            for (const req of requestsInGroup) {
                                const reqId = req.author?._serialized || req.author || req.id?._serialized || req.id || req.requester?._serialized || req.requester || req.addedBy?._serialized || req.addedBy;
                                if (reqId) {
                                    if (!currentBlacklist.has(reqId)) {
                                        allowedInThisGroup.push(reqId);
                                    } else {
                                        blockedInThisGroup.push(reqId);
                                    }
                                }
                            }
                            totalBlockedCount += blockedInThisGroup.length;

                            if (allowedInThisGroup.length > 0) {
                                log(`Attempting to approve ${allowedInThisGroup.length} non-blacklisted requests in ${group.name}.`, singleGroupStage);
                                try {
                                    const approvalResultsThisGroup = await client.approveGroupMembershipRequests(group.id._serialized, { requesterIds: allowedInThisGroup, ...options });
                                    const numApprovedThisGroup = Array.isArray(approvalResultsThisGroup) ? approvalResultsThisGroup.filter(r=>r.success || r.status === 200).length : (typeof approvalResultsThisGroup === 'object' ? Object.keys(approvalResultsThisGroup).length : allowedInThisGroup.length); // Approximation
                                    totalApprovedCount += numApprovedThisGroup;
                                    summaryPerGroup.push(`${group.name}: approved ${numApprovedThisGroup}, blocked ${blockedInThisGroup.length}`);
                                    log(`Approved ${numApprovedThisGroup} requests in ${group.name}. Blocked ${blockedInThisGroup.length} (blacklisted).`, singleGroupStage);
                                } catch (approvalErrAll) {
                                    logError(`Error approving requests for ${group.name} during ALL groups processing: ${approvalErrAll.message}`, `${singleGroupStage}_ERROR`, approvalErrAll);
                                    summaryPerGroup.push(`${group.name}: error during approval - ${approvalErrAll.message}`);
                                }
                            } else {
                                summaryPerGroup.push(`${group.name}: no valid (non-blacklisted) requests (${requestsInGroup.length} total, ${blockedInThisGroup.length} blacklisted)`);
                                log(`Skipped ${group.name} - no valid (non-blacklisted) requests to approve. Total found: ${requestsInGroup.length}, Blacklisted: ${blockedInThisGroup.length}`, singleGroupStage);
                            }
                        } else {
                             summaryPerGroup.push(`${group.name}: no pending requests.`);
                        }
                    } else {
                        groupsWhereBotNotAdmin++;
                        log(`Skipped ${group.name} - bot not admin.`, singleGroupStage);
                        summaryPerGroup.push(`${group.name}: skipped (bot not admin).`);
                    }
                } catch (error) {
                    logError(`Error processing group ${group.name || group.id._serialized} for mass approval: ${error.message}`, `${singleGroupStage}_ERROR`, error);
                    summaryPerGroup.push(`${group.name || group.id._serialized}: general processing error - ${error.message}`);
                }
            }

            let report = `✅ Approved ${totalApprovedCount} total requests across ${groupsWhereBotIsAdmin} groups where bot is admin.\n` +
                         `🚫 Blocked ${totalBlockedCount} blacklisted users across all checked groups.\n` +
                         `⚠️ Skipped ${groupsWhereBotNotAdmin} groups (bot not admin).`;
            if (summaryPerGroup.length > 0) {
                report += `\n\n📋 Group Details:\n${summaryPerGroup.join('\n')}`;
            }
            log(report, stage);
            return report;
        }
    } catch (error) {
        logError(`Critical error in approveGroupRequests (top level): ${error.message}`, stage, error);
        return `❌ Error processing membership requests: ${error.message}. Check logs.`;
    }
}

// ----------------------- Telegram Bot Logic -----------------------

function sendStart(chatId) {
    const text = 'ברוכים הבאים לבוט הניהול!\n' +
        'הבוט מאפשר להוסיף או להסיר מספרים מהרשימה השחורה המשותפת לבוט הוואצאפ.\n' +
        'פקודות זמינות:\n' +
        '/blacklist - צפיה ברשימת החסומים\n' +
        '/add - הוספת מספר לרשימה השחורה\n' +
        '/remove - הסרת מספר מהרשימה השחורה';
    telegramBot.sendMessage(chatId, text);
}

function formatBlacklistPage(page, pageSize) {
    const ids = Array.from(botConfig.blacklistedUsers);
    const totalPages = Math.max(1, Math.ceil(ids.length / pageSize));
    const pageIndex = Math.min(Math.max(page, 1), totalPages);
    const start = (pageIndex - 1) * pageSize;
    const entries = ids.slice(start, start + pageSize);
    const text = entries.map((id, i) => `${start + i + 1}. ${id}`).join('\n') || 'ההרשימה ריקה';
    const buttons = [];
    if (pageIndex > 1) buttons.push({ text: '⬅️ הקודם', callback_data: `bl_${pageIndex - 1}` });
    if (pageIndex < totalPages) buttons.push({ text: 'הבא ➡️', callback_data: `bl_${pageIndex + 1}` });
    return { text, buttons };
}

telegramBot.onText(/\/start/, (msg) => {
    sendStart(msg.chat.id);
});

telegramBot.onText(/\/blacklist/, (msg) => {
    const chatId = msg.chat.id;
    const { text, buttons } = formatBlacklistPage(1, 20);
    telegramBot.sendMessage(chatId, text, {
        reply_markup: { inline_keyboard: [buttons] }
    });
});

telegramBot.onText(/\/add/, (msg) => {
    telegramStates.set(msg.chat.id, { action: 'add' });
    telegramBot.sendMessage(msg.chat.id, 'אנא שלח את המספר שתרצה להוסיף לרשימה השחורה');
});

telegramBot.onText(/\/remove/, (msg) => {
    telegramStates.set(msg.chat.id, { action: 'remove' });
    telegramBot.sendMessage(msg.chat.id, 'אנא שלח את המספר שתרצה להסיר מהרשימה השחורה');
});

telegramBot.on('message', (msg) => {
    const state = telegramStates.get(msg.chat.id);
    if (!state || msg.text.startsWith('/')) return;
    if (!state.phone) {
        const phone = normalizePhone(msg.text);
        state.phone = phone;
        telegramStates.set(msg.chat.id, state);
        const actionWord = state.action === 'add' ? 'להוסיף' : 'להסיר';
        telegramBot.sendMessage(msg.chat.id, `אתה בטוח שברצונך ${actionWord} את ${phone}?`, {
            reply_markup: {
                inline_keyboard: [[
                    { text: 'אישור', callback_data: `${state.action}_${phone}` },
                    { text: 'ביטול', callback_data: 'cancel' }
                ]]
            }
        });
    }
});

telegramBot.on('callback_query', (query) => {
    const data = query.data;
    const chatId = query.message.chat.id;

    if (data.startsWith('bl_')) {
        const page = parseInt(data.split('_')[1], 10) || 1;
        const { text, buttons } = formatBlacklistPage(page, 20);
        telegramBot.editMessageText(text, {
            chat_id: chatId,
            message_id: query.message.message_id,
            reply_markup: { inline_keyboard: [buttons] }
        });
        telegramBot.answerCallbackQuery(query.id);
        return;
    }

    if (data === 'cancel') {
        telegramBot.editMessageText('הפעולה בוטלה.', {
            chat_id: chatId,
            message_id: query.message.message_id
        });
        telegramStates.delete(chatId);
        telegramBot.answerCallbackQuery(query.id);
        return;
    }

    const [action, phone] = data.split('_');
    if (action === 'add') {
        addToBlacklist(phone);
        telegramBot.editMessageText(`✅ המספר ${phone} נוסף לרשימה השחורה`, {
            chat_id: chatId,
            message_id: query.message.message_id
        });
        telegramStates.delete(chatId);
    } else if (action === 'remove') {
        removeFromBlacklist(phone);
        telegramBot.editMessageText(`✅ המספר ${phone} הוסר מהרשימה השחורה`, {
            chat_id: chatId,
            message_id: query.message.message_id
        });
        telegramStates.delete(chatId);
    }

    telegramBot.answerCallbackQuery(query.id);
});

// -----------------------------------------------------------------
