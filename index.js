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
const {
    handleJoinRequest, //Starts the quiz if someone DMs "I want to join"
    handleJoinTestResponse, //Handles their answers during the quiz.
    hasActiveJoinTest //Checks if user is mid-test to avoid duplicate tests.
} = require('./join-requests');
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
console.log('בודק אם קבוצת הטסט כבר מנוהלת...');
if (!botConfig.isManagedGroup(TEST_GROUP_ID)) {
    console.log('מוסיף את קבוצת הטסט לקבוצות מנוהלות...');
    botConfig.addManagedGroup(TEST_GROUP_ID);
} else {
    console.log('קבוצת הטסט כבר מנוהלת');
}

// הוספת הקבוצה השנייה
console.log('בודק אם הקבוצה השנייה כבר מנוהלת...');
if (!botConfig.isManagedGroup(Test2)) {
    console.log('מוסיף את הקבוצה השנייה לקבוצות מנוהלות...');
    botConfig.addManagedGroup(Test2);
} else {
    console.log('הקבוצה השנייה כבר מנוהלת');
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
        console.error('Could not find Chrome executable on Windows');
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
    APPROVED_USERS = new Set(JSON.parse(approvedData));
} catch (error) {
    console.error('שגיאה בטעינת המשתמשים המאושרים:', error);
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
        console.error('botConfig.blacklistedUsers is not a Set, initializing BLACKLIST as a new Set.');
        BLACKLIST = new Set(); // Fallback, though ideally botConfig handles this.
    }
} catch (error) {
    console.error('שגיאה בהפניית הרשימה השחורה מ-botConfig:', error);
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
    console.error('שגיאה בטעינת קובץ המבחנים:', error);
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
function log(message) {
    const timestamp = new Date().toISOString();
    const logMessage = `${timestamp} - ${message}\n`;

    // הדפסה לקונסול
    console.log(message);

    // כתיבה לקובץ
    fs.appendFileSync('bot.log', logMessage);
}

async function initializeClient() {
    try {
        console.log('🚀 מתחיל את הבוט...');
        console.log('Using Chrome path:', chromePath);
        console.log('Puppeteer config:', client.options.puppeteer);

        // Clear session if exists
        const sessionPath = path.join(__dirname, 'wwebjs_auth_custom', 'session-bot_972535349587');
        if (fs.existsSync(sessionPath)) {
            console.log('Deleting existing session directory...');
            fs.rmSync(sessionPath, { recursive: true, force: true });
        }

        await client.initialize();
        console.log('✨ הבוט אותחל בהצלחה!');
        reconnectAttempts = 0;
    } catch (error) {
        console.error('❌ שגיאה באתחול הבוט:', error);
        console.error('Error details:', {
            message: error.message,
            stack: error.stack
        });

        if (error.message.includes('Failed to launch the browser process')) {
            console.error('Browser launch failed. Possible solutions:');
            console.error('1. Install Chrome: https://www.google.com/chrome/');
            console.error('2. Set correct Chrome path in config');
            console.error('3. Run: npm install puppeteer');
        }

        if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
            reconnectAttempts++;
            console.log(`מנסה להתחבר שוב... ניסיון ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}`);
            setTimeout(initializeClient, RECONNECT_DELAY);
        } else {
            console.error('❌ הגענו למספר המקסימלי של ניסיונות התחברות');
            console.error('Try deleting the wwebjs_auth_custom folder and restarting');
        }
    }
}

client.on('disconnected', (reason) => {
    console.log('❌ הבוט התנתק:', reason);
    if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        reconnectAttempts++;
        console.log(`מנסה להתחבר שוב... ניסיון ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}`);
        setTimeout(initializeClient, RECONNECT_DELAY);
    }
});

client.on('authenticated', async () => {
    client.pupBrowser = client.pupBrowser || (await client.pupPage.browser());
});

client.on('qr', qr => {
    console.log('⌛ ממתין לסריקת קוד QR...');
    qrcode.generate(qr, { small: true });
});

client.on('ready', async () => {
    console.log('✅ הבוט מחובר ומוכן!');
    console.log('מספר הבוט:', client.info.wid._serialized);

    await addAllManagedGroups(client);
    await generateGroupLinks(client);

    console.log('מצב נוכחי:', {
        managedGroups: Array.from(botConfig.managedGroups),
        approvedUsers: Array.from(botConfig.approvedUsers)
    });

    isClientReady = true;
    client.isReady = true;

    setInterval(async () => {
        console.log('מתחיל בדיקת הודעות ישנות תקופתית...');
        await checkOldMessages(client);
        console.log('סיים בדיקת הודעות ישנות תקופתית');
    }, 60 * 60 * 1000);
});

client.on('auth_failure', msg => {
    console.error('❌ בעיית אימות:', msg);
});
/*
async function isGroupAdmin(client, groupId) {
    try {
        const chat = await client.getChatById(groupId);
        const botId = client.info.wid._serialized;
        const isAdmin = chat.participants.some(p => p.id._serialized === botId && p.isAdmin);
        return isAdmin;
    } catch (error) {
        console.error('שגיאה בבדיקת הרשאות מנהל:', error);
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
    try {
        console.log(`[ADMIN CHECK] Checking admin status for group: ${groupId}`);
        const botId = client.info.wid._serialized;
        console.log(`[ADMIN CHECK] Bot ID: ${botId}`);

        // Method 1: Standard participant check
        try {
            const chat = await client.getChatById(groupId);
            console.log(`[ADMIN CHECK] Got chat: ${chat.name || groupId}`);

            // Try to refresh metadata if possible
            if (typeof chat.fetchAllMetadata === 'function') {
                await chat.fetchAllMetadata();
                console.log(`[ADMIN CHECK] Refreshed metadata for group`);
            }

            let participants = [];

            // Try different methods to get participants
            if (typeof chat.getParticipants === 'function') {
                participants = await chat.getParticipants();
                console.log(`[ADMIN CHECK] Got ${participants.length} participants using getParticipants()`);
            } else if (Array.isArray(chat.participants)) {
                participants = chat.participants;
                console.log(`[ADMIN CHECK] Got ${participants.length} participants from chat.participants array`);
            }

            if (participants.length > 0) {
                // Log all admins for debugging
                const admins = participants
                    .filter(p => p.isAdmin)
                    .map(p => p.id._serialized || (p.id && p.id._serialized) || 'unknown');
                console.log(`[ADMIN CHECK] Group admins: ${JSON.stringify(admins)}`);

                // Check if bot is in admin list
                const isAdmin = participants.some(p => {
                    const participantId = p.id._serialized || (p.id && p.id._serialized);
                    return participantId === botId && p.isAdmin;
                });

                if (isAdmin) {
                    console.log(`[ADMIN CHECK] Bot found as admin using standard method`);
                    return true;
                }
            }
        } catch (error) {
            console.error(`[ADMIN CHECK] Error in standard admin check:`, error);
            // If Method 1 fails, we will now fall through to the final return false
        }

        // If Method 1 did not return true (either failed or bot is not admin)
        console.log(`[ADMIN CHECK] Method 1 did not confirm admin status for group ${groupId}`);
        return false;

    } catch (error) {
        console.error(`[ADMIN CHECK] Critical error checking admin status for group ${groupId}:`, error);
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
    console.log(BLACKLIST);
    return BLACKLIST.has(userId);
}

// הוספת פונקציה לשליחת הודעה לכל הקבוצות
async function broadcastMessage(client, message, isPinned = false) {
    try {
        console.log(`מתחיל שליחת הודעה ${isPinned ? 'מוצמדת' : 'רגילה'} לכל הקבוצות`);
        const managedGroups = Array.from(botConfig.managedGroups);
        console.log('קבוצות מנוהלות:', managedGroups);

        for (const groupId of managedGroups) {
            try {
                const chat = await client.getChatById(groupId);
                // בדיקה אם הבוט מנהל את הקבוצה בפועל
                const isAdmin = await isGroupAdmin(client, groupId);
                if (!isAdmin) {
                    console.log(`הבוט אינו מנהל את הקבוצה ${chat.name || groupId}, מדלג על שליחת הודעה`);
                    await sendAdminAlert(client, `הבוט אינו מנהל את הקבוצה ${chat.name || groupId}`);
                    continue;
                }

                console.log(`שולח הודעה לקבוצה: ${chat.name || groupId} (${groupId})`);
                const sentMessage = await chat.sendMessage(message);

                if (isPinned) {
                    try {
                        await sentMessage.pin();
                        console.log(`הודעה הוצמדה בקבוצה ${chat.name || groupId}`);
                    } catch (error) {
                        console.error(`שגיאה בהצמדת הודעה בקבוצה ${chat.name || groupId}:`, error);
                        await sendAdminAlert(client, `שגיאה בהצמדת הודעה בקבוצה ${chat.name || groupId}`);
                    }
                }

                console.log(`נשלחה הודעה לקבוצה ${chat.name || groupId}`);
            } catch (error) {
                console.error(`שגיאה בשליחת הודעה לקבוצה ${groupId}:`, error);
                await sendAdminAlert(client, `שגיאה בשליחת הודעה לקבוצה ${groupId}`);
            }
        }

        console.log('סיים שליחת הודעה לכל הקבוצות');
    } catch (error) {
        console.error('שגיאה בשליחת הודעה לכל הקבוצות:', error);
        await sendAdminAlert(client, 'שגיאה בשליחת הודעה לכל הקבוצות');
    }
}

// הוספת פונקציה ליצירת קישורי קבוצות
async function generateGroupLinks(client) {
    try {
        console.log('מתחיל יצירת קישורי קבוצות...');
        const managedGroups = Array.from(botConfig.managedGroups);

        for (const groupId of managedGroups) {
            try {
                // בדיקה אם הקבוצה נמצאת ברשימת הקבוצות המנוהלות
                if (!botConfig.isManagedGroup(groupId)) {
                    console.log(`הקבוצה ${groupId} אינה מנוהלת, מדלג על יצירת קישור`);
                    continue;
                }

                const chat = await client.getChatById(groupId);
                // בדיקה אם הבוט מנהל את הקבוצה בפועל
                const isAdmin = await isGroupAdmin(client, groupId);
                if (!isAdmin) {
                    console.log(`הבוט אינו מנהל את הקבוצה ${chat.name || groupId}, מדלג על יצירת קישור`);
                    continue;
                }

                const inviteCode = await chat.getInviteCode();
                const inviteLink = `https://chat.whatsapp.com/${inviteCode}`;
                groupLinks.set(groupId, inviteLink);
                console.log(`נוצר קישור לקבוצה ${chat.name || groupId}: ${inviteLink}`);
            } catch (error) {
                console.error(`שגיאה ביצירת קישור לקבוצה ${groupId}:`, error);
            }
        }

        console.log('סיים יצירת קישורי קבוצות');
    } catch (error) {
        console.error('שגיאה ביצירת קישורי קבוצות:', error);
    }
}

// הוספת פונקציה לשליחת רשימת קבוצות
async function sendGroupList(client, userId) {
    try {
        const groups = Array.from(botConfig.managedGroups);
        let message = 'רשימת הקבוצות הזמינות:\n';
        if (groups.length === 0) {
            message += 'אין קבוצות מנוהלות כרגע.';
        } else {
            groups.forEach((groupId, index) => {
                message += `${index + 1}. ${groupId}\n`;
            });
            message += '\nכדי לקבל קישור לקבוצה, שלח את מספר הקבוצה המבוקש (למשל: 1, 2, 3).';
        }
        await client.sendMessage(userId, message);
    } catch (error) {
        console.error('Error sending group list:', error);
    }
}


// הוספת פונקציה לשליחת קישור לקבוצה
async function sendGroupLink(client, userId, groupNumber) {
    try {
        if (!groupNumberToId.has(groupNumber)) {
            await client.sendMessage(userId, 'מספר קבוצה לא תקין. אנא שלח מספר קבוצה מהרשימה.');
            return;
        }
        const groupId = groupNumberToId.get(groupNumber);
        if (!botConfig.isManagedGroup(groupId)) {
            await client.sendMessage(userId, 'קבוצה זו אינה מנוהלת.');
            return;
        }
        const isAdmin = await isGroupAdmin(client, groupId);
        if (!isAdmin) {
            await client.sendMessage(userId, 'אין לי גישה לקבוצה זו.');
            return;
        }
        if (!groupLinks.has(groupId)) {
            const chat = await client.getChatById(groupId);
            const inviteCode = await chat.getInviteCode();
            const inviteLink = `https://chat.whatsapp.com/${inviteCode}`;
            groupLinks.set(groupId, inviteLink);
        }
        const link = groupLinks.get(groupId);
        await client.sendMessage(userId, `קישור לקבוצה:\n${link}`);
    } catch (error) {
        console.error('Error sending group link:', error);
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
    const lower = message.toLowerCase();
    return prohibitedWords.some(word => {
        const escaped = escapeRegExp(word.toLowerCase());
        const isMultiWord = word.includes(" ");
        const pattern = isMultiWord
            ? new RegExp(escaped, 'u')  // אין גבולות מילה – רווחים עושים את העבודה
            : new RegExp(`\\b${escaped}\\b`, 'u');  // חייבים גבולות מילה
        return pattern.test(lower);
    });
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

    return blockedRoots.some(root => {
        const word = clean(root);                 // normalise the root too
        const pattern =
            `(?:^|\\P{L})${escapeRegExp(word)}(?:\\P{L}|$)`; // boundaries
        const re = new RegExp(pattern, 'ui');      // u = Unicode, i = ignore-case
        return re.test(cleanMsg);
    });
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
    // נסה לקבל JID ממקורות שונים
    const phoneJid =
        senderId                     // בדרך כלל 972…@c.us
        || testData.originalId          // 1258…@lid
        || message.from                 // fallback – group JID או private
        || message.author;              // fallback נוסף

    //await getAllManagedGroupsParticipants();
    //await sendPrivateMessage(client, "Hello, this is a private message!", "0549232327");




    console.log(`הודעה התקבלה מ-${realJid} (${isGroup ? 'קבוצה' : 'פרטי'})`);
    if (isGroup) {
        console.log(`הודעה התקבלה מ-${realJid} (${isGroup ? 'קבוצה' : 'קבוצה'})`);
        // 1. בדוק אם הבוט הוא מנהל בקבוצה
        const isBotAdmin = await isGroupAdmin(client, chat.id._serialized);
        console.log(`בדיקת מנהל: ${isBotAdmin ? 'הבוט הוא מנהל' : 'הבוט אינו מנהל'}`);
        if (!isBotAdmin) return;
        console.log(`הבוט מנהל בקבוצה ${chat.name || chat.id._serialized}`);
        // 2. blacklist
        if (isBlacklisted(realJid)) {
            try {
                await message.delete(true);
                await chat.removeParticipants([senderId]);
                //await sendAdminAlert(client, ` הועף מהקבוצה  ${realJid}`);
                await alertRemoval(client, 'בלאקליסט', message, chat.name || chat.id._serialized)
            } catch (error) {
                console.error(`שגיאה במחיקת הודעת קישור של ${senderId}:`, error);
            }

            return;
        }

        // 3. פקודות ניהול (אם רלוונטי בקבוצה)
        // (הכנסה/הסרה - אם תרצה לאפשר גם בקבוצה)
        // ...

        // 4. מנהלים/חסינים (למעט פקודות ניהול)
        if (isAdmin(realJid) || isImmune(realJid)) {
            console.log("He is an admin")
            return;
        }
        console.log(`המשתמש ${senderId} אינו מנהל או חסין`);

        // 5. מילים אסורות
        //Changes: From "messageHasSingleWordFromList(" הי " + message.body + " dov "))" to :"messageContainsBlockedRoot(message.body)"
        if (messageHasProhibitedWord(message.body + " dov ") || messageContainsBlockedRoot(message.body)) {
            try {
                console.log(`הודעה עם מילה אסורה: ${message.body}`);
                await message.delete(true);
                await chat.removeParticipants([senderId]);
                //await sendAdminAlert(client, `המשתמש ${senderId} הוסר מהקבוצה ${chat.name || chat.id._serialized} עקב שליחת מילה אסורה: ${message.body}`);
                await alertRemoval(client, 'מילה אסורה', message, chat.name || chat.id._serialized);
                const senderJid = await getRealSenderJid(message);
                const phoneNumber = senderJid;
                console.log(phoneNumber);
                try {
                    await addToBlacklist(phoneNumber);
                    const blacklistResults = await addUserToBlacklistWithLid(message, addToBlacklist);
                }
                catch {
                    await addToBlacklist(senderJid); // הוספה לרשימה השחורה
                    const blacklistResults = await addUserToBlacklistWithLid(message, addToBlacklist);
                }; // הוספה לרשימה השחורה

            }

            // add to the jason file
            catch (error) {
                console.error(`שגיאה במחיקת הודעת קישור של ${senderId}:`, error);
            }
            return;
        }

        // 6. מילים אזהרה
        console.log("Already Here");

        // 7. קישורים (עם הלוגיקה שלך)
        const hasLink = message.body.match(/(?:https?:\/\/|www\.)[^\s]+/i) !== null;
        if (messageHasWarningWord(message.body)) {
            console.log("I am here")
            await message.delete(true);
            console.log("I am here 2")

            await alertDeletion(client, 'מילה אזהרה', message, chat); // 2. alert admins

            return;
        }
        console.log("Passed Here")
        // ───────── 7. קישורים  ─────────────────────────────────────────────
        if (hasLink && !isApproved(realJid) && !isImmune(realJid) && !isAdmin(realJid)) {
            try {
                /* 1️⃣  delete the link message once */
                let deletedOK = false;
                try {
                    await message.delete(true);
                    deletedOK = true;
                } catch (delErr) {
                    console.error(`⚠️ delete failed for ${senderId}:`, delErr);
                }

                /* 2️⃣  alert admins if deletion succeeded */
                if (deletedOK) {
                    await alertDeletion(client, 'קישור ללא אימות', message, chat);
                }

                /* 3️⃣  Get the real JID (phone number based) for this user */
                const realJid = await getRealSenderJid(message);
                console.log(`Original ID: ${senderId}, Real JID: ${realJid}`);

                /* 4️⃣  warn the user inside the group */
                const phoneNumber = senderId.split('@')[0];
                const response =
                    `@${phoneNumber} שלום! זיהיתי שניסית לשלוח קישור והקישור נמחק.\n` +
                    `כדי לשלוח קישורים בקבוצה, עליך לעבור אימות קצר.\n` +
                    `אנא פנה אליי בצ'אט פרטי וכתוב "התחל" תוך 10 דקות – אחרת תוסר מהקבוצה.`;
                await chat.sendMessage(response, { mentions: [senderId] });
                console.log(`שלחתי הודעה למשתמש ${senderId} בקבוצה ${chat.id._serialized}`);

                /* 5️⃣  remember that the user must DM the bot */
                // FIX: Use the real JID as the key in pendingUsers
                pendingUsers.set(realJid, {
                    groupId: chat.id._serialized,
                    timestamp: Date.now(),
                    originalId: senderId // Store the original ID for reference
                });

                console.log(`Added user to pendingUsers with real JID key: ${realJid}`);

                /* 6️⃣  schedule automatic removal after 10 minutes */
                const maxRemovalAttempts = 5;
                const removalInterval = 2 * 60 * 1000;   // 2 min between retries

                const attemptUserRemoval = async (attempt = 0) => {
                    try {
                        // Check if the user has started the test using the real JID
                        if (!pendingUsers.has(realJid) ||
                            (typeof hasActiveJoinTest === 'function' && hasActiveJoinTest(realJid))) return;

                        const { groupId, originalId } = pendingUsers.get(realJid);
                        const rmChat = await client.getChatById(groupId);
                        if (!(await isGroupAdmin(client, groupId))) return; // bot lost admin

                        /* delete recent messages from user */
                        const msgs = await rmChat.fetchMessages({ limit: 100 });
                        for (const m of msgs) {
                            const ids = [m.author, m.from].filter(Boolean);
                            if (ids.includes(originalId)) {
                                try { await m.delete(true); } catch (_) { /* ignore */ }
                            }
                        }

                        /* kick user */
                        await rmChat.removeParticipants([originalId]);
                        await sendAdminAlert(client, `🚫 הועף מהקבוצה ${rmChat.name || groupId} – לא התחיל מבחן תוך 10 דק׳`);
                        addToBlacklist(originalId);
                        const blacklistResults = await addUserToBlacklistWithLid(message, addToBlacklist);
                        pendingUsers.delete(realJid);
                        userStates.delete(originalId);
                        console.log(`✅ המשתמש ${originalId} (${realJid}) הוסר אחרי שלא התחיל מבחן`);
                    } catch (rmErr) {
                        console.error(`❌ attempt ${attempt + 1} to remove ${senderId} failed:`, rmErr);
                        if (attempt < maxRemovalAttempts - 1)
                            setTimeout(() => attemptUserRemoval(attempt + 1), removalInterval);
                        else
                            await sendAdminAlert(client, `⚠️ לא הצלחתי להסיר את ${senderId} לאחר ${maxRemovalAttempts} ניסיונות`);
                    }
                };

                setTimeout(attemptUserRemoval, 10 * 60 * 1000);   // 10 minutes
                console.log(`טופל קישור ממשתמש ${senderId} בקבוצה ${chat.id._serialized}`);
            } catch (err) {
                console.error('שגיאה בטיפול בקישור:', err);
            }
            return;   // stop further processing of this message
        }
        else if (hasLink)


            // טיפול בתשובות למבחן
            if (hasActiveJoinTest(senderId)) {
                await handleJoinTestResponse(client, message, senderId);
                return;
            }

    } else {
        // הודעות בפרטי
        const messageText = message.body.trim();

        // פקודות ניהול בפרטי
        if (isAdmin(senderId)) {
            // Debug command for testing user removal
            if (messageText.startsWith('!debug_remove ')) {
                const phoneNumber = messageText.replace('!debug_remove ', '').trim();
                await message.reply('🔍 מתחיל בדיקת debug...');
                await debugUserRemoval(client, phoneNumber);
                await message.reply('✅ בדיקת Debug הושלמה - ראה פרטים בקונסול');
                return;
            }

            // Direct test command for specific group
            if (messageText.startsWith('!test_remove ')) {
                const parts = messageText.replace('!test_remove ', '').split(' ');
                if (parts.length < 2) {
                    await message.reply('Usage: !test_remove [phone] [group_name]');
                    return;
                }
                const phone = parts[0];
                const groupName = parts.slice(1).join(' ');

                await message.reply(`🔍 Testing removal of ${phone} from "${groupName}"...`);

                try {
                    // Find the group by ID from managed groups
                    let group = null;
                    let groupId = null;

                    // First try to find by exact group ID
                    for (const managedGroupId of botConfig.managedGroups) {
                        try {
                            const chat = await client.getChatById(managedGroupId);
                            if (chat && chat.isGroup && chat.name === groupName) {
                                group = chat;
                                groupId = managedGroupId;
                                break;
                            }
                        } catch (e) {
                            // Skip if can't get this chat
                        }
                    }

                    if (!group) {
                        await message.reply(`❌ Group "${groupName}" not found in managed groups`);
                        return;
                    }

                    // Ensure participants are loaded
                    if (!group.participants || group.participants.length === 0) {
                        await group.fetchParticipants();
                    }

                    // Format phone number
                    const e164 = formatPhoneNumberToE164(phone);
                    const targetJid = `${e164}@c.us`;

                    await message.reply(`📋 Group has ${group.participants.length} participants`);

                    // Find the participant
                    const participant = group.participants.find(p => {
                        return p.id._serialized === targetJid ||
                            p.id.user === e164 ||
                            p.id._serialized.includes(phone.replace(/\D/g, ''));
                    });

                    if (!participant) {
                        await message.reply(`❌ User ${targetJid} not found in group`);

                        // Show some participants for debugging
                        let sampleParticipants = 'Sample participants:\n';
                        group.participants.slice(0, 5).forEach((p, i) => {
                            sampleParticipants += `${i + 1}. ${p.id._serialized}\n`;
                        });
                        await message.reply(sampleParticipants);
                        return;
                    }

                    await message.reply(`✅ Found participant: ${participant.id._serialized}`);

                    // Try to remove
                    try {
                        await group.removeParticipants([participant.id._serialized]);
                        await message.reply(`✅ Successfully removed!`);
                    } catch (err) {
                        await message.reply(`❌ Removal failed: ${err.message}`);

                        // Try alternative approach
                        try {
                            const phoneOnly = participant.id._serialized.replace('@c.us', '').replace('@lid', '');
                            await group.removeParticipants([phoneOnly]);
                            await message.reply(`✅ Removed using phone number only!`);
                        } catch (err2) {
                            await message.reply(`❌ Alternative method also failed: ${err2.message}`);
                        }
                    }

                } catch (error) {
                    await message.reply(`❌ Error: ${error.message}`);
                }
                return;
            }

            // Alternative test command using group ID directly
            if (messageText.startsWith('!test_remove_id ')) {
                const parts = messageText.replace('!test_remove_id ', '').split(' ');
                if (parts.length < 2) {
                    await message.reply('Usage: !test_remove_id [phone] [group_id]');
                    return;
                }
                const phone = parts[0];
                const groupId = parts[1];

                await message.reply(`🔍 Testing removal of ${phone} from group ${groupId}...`);

                try {
                    // Get group directly by ID
                    const group = await client.getChatById(groupId);

                    if (!group || !group.isGroup) {
                        await message.reply(`❌ Group ${groupId} not found or is not a group`);
                        return;
                    }

                    await message.reply(`✅ Found group: ${group.name || groupId}`);

                    // Ensure participants are loaded
                    if (!group.participants || group.participants.length === 0) {
                        await group.fetchParticipants();
                    }

                    // Format phone number
                    const e164 = formatPhoneNumberToE164(phone);
                    const targetJid = `${e164}@c.us`;

                    await message.reply(`📋 Group has ${group.participants.length} participants`);

                    // Find the participant
                    const participant = group.participants.find(p => {
                        return p.id._serialized === targetJid ||
                            p.id.user === e164 ||
                            p.id._serialized.includes(phone.replace(/\D/g, ''));
                    });

                    if (!participant) {
                        await message.reply(`❌ User ${targetJid} not found in group`);
                        return;
                    }

                    await message.reply(`✅ Found participant: ${participant.id._serialized}`);

                    // Try direct Store API removal
                    try {
                        const result = await client.pupPage.evaluate(async (gId, pId) => {
                            try {
                                // Get the chat object
                                const chat = await window.WWebJS.getChat(gId);
                                if (!chat) return { success: false, error: 'Chat not found' };

                                // Try method 1: Direct removal with array
                                try {
                                    await chat.removeParticipants([pId]);
                                    return { success: true, method: 'removeParticipants' };
                                } catch (err1) {
                                    // Try method 2: Using WID
                                    try {
                                        const wid = window.Store.WidFactory.createWid(pId);
                                        await window.Store.GroupParticipants.removeParticipants(chat, [wid]);
                                        return { success: true, method: 'Store.GroupParticipants' };
                                    } catch (err2) {
                                        // Try method 3: Using phone number only
                                        try {
                                            const phoneOnly = pId.replace('@c.us', '').replace('@lid', '');
                                            await chat.removeParticipants([phoneOnly]);
                                            return { success: true, method: 'phoneOnly' };
                                        } catch (err3) {
                                            // Try method 4: Get fresh participant list
                                            try {
                                                await chat.fetchParticipants();
                                                const participant = chat.participants.find(p =>
                                                    p.id._serialized === pId ||
                                                    p.id.user === pId.replace('@c.us', '')
                                                );
                                                if (participant) {
                                                    await chat.removeParticipants([participant.id._serialized]);
                                                    return { success: true, method: 'freshParticipant' };
                                                }
                                                return { success: false, error: 'Participant not found after refresh' };
                                            } catch (err4) {
                                                return {
                                                    success: false,
                                                    errors: {
                                                        method1: err1.message,
                                                        method2: err2.message,
                                                        method3: err3.message,
                                                        method4: err4.message
                                                    }
                                                };
                                            }
                                        }
                                    }
                                }
                            } catch (err) {
                                return { success: false, error: err.message, stack: err.stack };
                            }
                        }, groupId, participant.id._serialized);

                        if (result.success) {
                            await message.reply(`✅ Successfully removed using ${result.method}!`);
                        } else {
                            await message.reply(`❌ Store API failed: ${JSON.stringify(result, null, 2)}`);

                            // Try the simplest approach - just like in working code
                            await message.reply('Trying simple approach...');
                            try {
                                // CRITICAL: Ensure we have a valid participant ID
                                const participantId = participant.id._serialized;
                                if (!participantId) {
                                    await message.reply('❌ Participant ID is empty!');
                                    return;
                                }

                                // Create array and verify it's not empty
                                const participantsArray = [participantId];
                                await message.reply(`Attempting to remove with array: ${JSON.stringify(participantsArray)}`);

                                // Double-check the array
                                if (participantsArray.length === 0 || !participantsArray[0]) {
                                    await message.reply('❌ Participants array is empty or invalid!');
                                    return;
                                }

                                // Try removal
                                await group.removeParticipants(participantsArray);
                                await message.reply('✅ Success with simple removeParticipants!');

                                // If this works, update the main function
                                await message.reply('🎉 Found working method! Update your kickUserFromAllGroups to use this pattern.');

                            } catch (simpleErr) {
                                await message.reply(`❌ Simple approach failed: ${simpleErr.message}`);

                                // Try one more approach - refresh the group and try again
                                try {
                                    await message.reply('Refreshing group data...');
                                    await group.fetchParticipants();

                                    // Find participant again
                                    const freshParticipant = group.participants.find(p =>
                                        p.id._serialized === participant.id._serialized
                                    );

                                    if (freshParticipant) {
                                        await message.reply(`Fresh participant found: ${freshParticipant.id._serialized}`);
                                        await group.removeParticipants([freshParticipant.id._serialized]);
                                        await message.reply('✅ Success after refresh!');
                                    } else {
                                        await message.reply('❌ Participant not found after refresh');
                                    }
                                } catch (refreshErr) {
                                    await message.reply(`❌ Refresh approach failed: ${refreshErr.message}`);
                                }
                            }
                        }
                    } catch (evalErr) {
                        await message.reply(`❌ Evaluation error: ${evalErr.message}`);

                        // Try the absolute simplest approach
                        await message.reply('Trying direct approach outside evaluation...');
                        try {
                            await group.removeParticipants([participant.id._serialized]);
                            await message.reply('✅ Direct removeParticipants worked!');
                        } catch (directErr) {
                            await message.reply(`❌ Direct approach also failed: ${directErr.message}`);
                        }
                    }

                } catch (error) {
                    await message.reply(`❌ Error: ${error.message}`);
                }
                return;
            }

            if (messageText === 'הודעה מוצמדת') {
                userStates.set(senderId, { waitingForMessage: true, isPinned: true });
                await message.reply('אנא שלח את ההודעה שתרצה להצמיד לכל הקבוצות');
                return;
            } else if (messageText === 'הודעה') {
                userStates.set(senderId, { waitingForMessage: true, isPinned: false });
                await message.reply('אנא שלח את ההודעה שתרצה לשלוח לכל הקבוצות');
                return;
            } else if (messageText === 'הסרה') {
                userStates.set(senderId, { waitingForPhoneNumber: true });
                await message.reply('אנא שלח את מספר הטלפון של המשתמש שברצונך להסיר מכל הקבוצות (למשל: 972501234567)');
                return;
            } else if (messageText === 'הכנסה') {
                userStates.set(senderId, { waitingForUnblockPhoneNumber: true });
                await message.reply('אנא שלח את מספר הטלפון של המשתמש שברצונך להחזיר (למשל: 972501234567)');
                return;
            }

            // בדיקה אם המנהל ממתין להודעה או למספר
            const userState = userStates.get(senderId);
            if (userState) {
                if (userState.waitingForMessage) {
                    await broadcastMessage(client, message.body, userState.isPinned);
                    userStates.delete(senderId);
                    await message.reply(`ההודעה נשלחה בהצלחה לכל הקבוצות${userState.isPinned ? ' והוצמדה' : ''}`);
                    return;
                }

                else if (userState.waitingForPhoneNumber) {
                    const rawInput = message.body.trim();

                    await message.reply('⏳ מוסיף לרשימה השחורה...');

                    /**
                     * Normalise almost any phone-number format to bare digits (CC+NSN).
                     * The logic is deliberately minimal – enough for WhatsApp IDs,
                     * not a full ITU-E.164 validator.
                     */
                    const normalisePhone = (input) => {
                        // keep only digits and a leading plus
                        let cleaned = input.replace(/[^\d+]/g, '');

                        // strip leading “+” or international “00”
                        if (cleaned.startsWith('+')) cleaned = cleaned.slice(1);
                        else if (cleaned.startsWith('00')) cleaned = cleaned.slice(2);

                        // special-case: Israel – remove trunk ‘0’ after the CC if present
                        if (cleaned.startsWith('9720')) cleaned = '972' + cleaned.slice(4);

                        // local Israeli number without CC (e.g. 054-… or 02-…)
                        if (/^0\d{8,9}$/.test(cleaned)) {
                            cleaned = '972' + cleaned.slice(1);  // drop trunk 0, add CC
                        }

                        return cleaned;
                    };

                    const phoneDigits = normalisePhone(rawInput);

                    // minimal sanity check: between 8 and 15 digits
                    if (!/^\d{8,15}$/.test(phoneDigits)) {
                        await message.reply('❌ מספר טלפון לא תקין');
                        userStates.delete(senderId);
                        return;
                    }

                    // blacklist entry is simply the digits plus WhatsApp suffix
                    const whatsappId = `${phoneDigits}@c.us`;
                    addToBlacklist(whatsappId);
                    await addUserToBlacklistWithLid(message, addToBlacklist);
                    await message.reply(`✅ ${phoneDigits} נוסף לרשימה השחורה`);
                    userStates.delete(senderId);
                    return;
                }

                else if (userState.waitingForUnblockPhoneNumber) {
                    const rawInput = message.body.trim();

                    // Let the user know we’re working
                    await message.reply('⏳ מסיר מהרשימה השחורה...');

                    /**
                     * Convert almost any phone-number string to bare digits (CC+NSN).
                     *  • keeps only digits, strips "+", "00", spaces, dashes, braces …
                     *  • auto-adds +972 for local Israeli numbers (e.g. 054-…)
                     *  • removes the extra trunk “0” that sometimes sneaks in after 972
                     *  • leaves other international forms (US/CA +1, UK +44, etc.) intact
                     */
                    const normalisePhone = (input) => {
                        let n = input.replace(/[^\d+]/g, '');   // digits + leading +

                        if (n.startsWith('+')) n = n.slice(1);
                        else if (n.startsWith('00')) n = n.slice(2);

                        // Israel: handle stray trunk 0 after CC
                        if (n.startsWith('9720')) n = '972' + n.slice(4);

                        // Local Israeli number without CC
                        if (/^0\d{8,9}$/.test(n)) n = '972' + n.slice(1);

                        return n;
                    };

                    const phoneDigits = normalisePhone(rawInput);

                    // Loose sanity‐check (8-15 digits is enough for WhatsApp)
                    if (!/^\d{8,15}$/.test(phoneDigits)) {
                        await message.reply('❌ מספר הטלפון אינו תקין. אנא שלח מספר בינלאומי תקין.');
                        userStates.delete(senderId);
                        return;
                    }

                    const userId = `${phoneDigits}@c.us`;

                    // If the number isn’t blacklisted, tell the user and exit
                    if (!BLACKLIST.has(userId)) {
                        await message.reply(`ℹ️ ${phoneDigits} אינו נמצא ברשימה השחורה.`);
                        userStates.delete(senderId);
                        return;
                    }

                    // Remove and confirm
                    removeFromBlacklist(userId);
                    userStates.delete(senderId);
                    await message.reply(`✅ ${phoneDigits} הוסר מהרשימה השחורה ויוכל להצטרף שוב לקבוצות.`);
                    return;
                }
            }
        }

        // פקודת קישורים - שליחת רשימת קבוצות והמתנה למספר קבוצה
        if (messageText === 'קישורים') {
            await sendGroupList(client, senderId);
            userStates.set(senderId, { step: 'awaiting_group_number' });
            return;
        }

        // טיפול במספר קבוצה אחרי בקשת קישורים
        const state = userStates.get(senderId);
        if (state && state.step === 'awaiting_group_number') {
            const groupNumber = message.body.trim();
            if (/^[0-9]+$/.test(groupNumber)) {
                await sendGroupLink(client, senderId, groupNumber);
                userStates.delete(senderId);
                return;
            } else {
                await client.sendMessage(senderId, 'אנא שלח מספר קבוצה תקין מהרשימה.');
                return;
            }
        }

        // טיפול במבחן הצטרפות/קישורים (אם יש)
        if (typeof hasActiveJoinTest === 'function' && hasActiveJoinTest(senderId)) {
            await handleJoinTestResponse(client, message, senderId);
            return;
        }



        // טיפול בהודעת "התחל" בפרטי
        if (messageText === 'התחל') {
            // In private messages, the senderId is already the real JID (phone number based)
            // No need to convert it
            console.log(`Checking pendingUsers for התחל command - JID: ${senderId}`);
            console.log(`pendingUsers has JID: ${pendingUsers.has(senderId)}`);

            const pendingData = pendingUsers.get(senderId);
            if (pendingData) {
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
                    type: 'auth',
                    groupId: pendingData.groupId,
                    originalId: pendingData.originalId,
                    realJid: senderId,
                    messageToDelete: pendingData.messageToDelete,
                    timeoutId: setTimeout(async () => {
                        if (!activeTests.has(senderId)) return;
                        await handleTestTimeout(client, senderId, pendingData.groupId, pendingData.messageToDelete);
                    }, TEST_TIMEOUT)
                };
                activeTests.set(senderId, testData);
                console.log(`משתמש ${senderId} התחיל מבחן אימות`);
            } else {
                await message.reply('אין לך בקשת אימות פעילה כרגע.');
            }
            return;
        }

        // Test answer handler invocation
        if (activeTests.has(senderId)) {
            await handleTestAnswer(client, message, senderId);
            return;   // <- ADD THIS
        }
    }
});


// Handle test answers
async function handleTestAnswer(client, message, senderId) {
    const testData = activeTests.get(senderId);
    if (!testData) {
        console.log(`תשובה התקבלה ממשתמש ${senderId} שאינו במבחן פעיל`);
        return;
    }
    const userAnswer = message.body.toLowerCase().trim();
    const correctAnswer = testData.currentQuestion.answer.toLowerCase().trim();

    if (userAnswer === correctAnswer) {
        testData.correctAnswers++;
        if (testData.correctAnswers >= 3) {
            clearTimeout(testData.timeoutId);
            // 1) add private JID
            await addApprovedUser(senderId);
            APPROVED_USERS.add(senderId);

            await client.sendMessage(senderId, '✅ עברת את המבחן בהצלחה!');
            // Removed sending group list after test
            activeTests.delete(senderId);
            updateTestAttempts(senderId, true);
            failedOnceUsers.delete(senderId);
            pendingUsers.delete(senderId);
            console.log(`משתמש ${senderId} עבר את המבחן בהצלחה`);
            await sendAdminAlert(client, `המשתמש ${senderId} עבר את המבחן בהצלחה וכעת הוא Approved User`)
        } else {
            const nextQuestion = generateTestQuestion();
            testData.currentQuestion = nextQuestion;
            await client.sendMessage(senderId,
                `✅ נכון! שאלה ${testData.correctAnswers + 1}/3:\n${nextQuestion.question}`
            );
            activeTests.set(senderId, testData);
        }
    } else {
        testData.wrongAnswers++;
        if (testData.wrongAnswers >= 2) {
            clearTimeout(testData.timeoutId);
            try {
                // נסה לקבל JID ממקורות שונים
                const phoneJid =
                    senderId                     // בדרך כלל 972…@c.us
                    || testData.originalId          // 1258…@lid
                    || message.from                 // fallback – group JID או private
                    || message.author;              // fallback נוסף

                const phoneDisplay3 = extractPhone(phoneJid);

                // Get the specific group chat
                const chat = await client.getChatById(testData.groupId);

                // FIXED: Use the originalId (LID format) instead of senderId (real JID)
                const userToRemove = testData.originalId || senderId;
                console.log(`Attempting to remove user: ${userToRemove} from group: ${testData.groupId}`);

                // Try to remove the user from just this group
                try {
                    await chat.removeParticipants([userToRemove]);
                    console.log(`✅ Successfully removed ${userToRemove} from ${chat.name || testData.groupId}`);

                    // Send message to user
                    await client.sendMessage(
                        senderId,
                        '❌ נכשלת במבחן. הוסרת מהקבוצה.'
                    );

                    // Send admin alert - use the phone number for display
                    const phoneDisplay = userToRemove.split('@')[0];
                    await sendAdminAlert(
                        client,
                        `משתמש ${phoneDisplay} נכשל במבחן והוסר מהקבוצה ${chat.name || testData.groupId}
                        Phone Display: ${phoneDisplay3}`
                    );

                    // Add to blacklist using the real JID for consistency
                    addToBlacklist(senderId);
                    const blacklistResults = await addUserToBlacklistWithLid(message, addToBlacklist);
                } catch (removeError) {
                    console.error(`❌ Error removing ${userToRemove} from group:`, removeError);

                    // Send message to user
                    await client.sendMessage(
                        senderId,
                        '❌ נכשלת במבחן. לא ניתן היה להסיר אותך מהקבוצה.'
                    );

                    // Send admin alert about the error
                    const phoneDisplay = userToRemove.split('@')[0];
                    await sendAdminAlert(
                        client,
                        `שגיאה בהסרת משתמש ${phoneDisplay} מהקבוצה: ${removeError.message}`
                    );
                }
            } catch (err) {
                console.error('Error while removing user from group:', err);

                // Send admin alert about the error
                const phoneDisplay = (testData.originalId || senderId).split('@')[0];
                await sendAdminAlert(
                    client,
                    `שגיאה בהסרת משתמש ${phoneDisplay} מהקבוצה: ${err.message}`
                );
            }

            // Cleanup
            activeTests.delete(senderId);
            updateTestAttempts(senderId, false);
            pendingUsers.delete(senderId);

            const attempts = getTestAttempts(senderId);
            if (attempts.attempts === 1) {
                failedOnceUsers.set(senderId, { timestamp: Date.now(), groupId: testData.groupId });
            } else if (attempts.attempts >= 2) {
                addToBlacklist(senderId);
                const blacklistResults = await addUserToBlacklistWithLid(message, addToBlacklist);
                failedOnceUsers.delete(senderId);
            }
            console.log(`משתמש ${senderId} נכשל במבחן`);
        }
        else {
            const nextQuestion = generateTestQuestion();
            testData.currentQuestion = nextQuestion;

            // how many questions have already been answered?
            const totalAnswered = testData.correctAnswers + testData.wrongAnswers;
            // the next question we are about to ask (1-based)
            const nextIndex = totalAnswered + 1;

            await client.sendMessage(
                senderId,
                `${userAnswer === correctAnswer ? '✅ נכון!' : '❌ לא נכון.'} ` +
                `שאלה ${nextIndex}/3:\n${nextQuestion.question}`
            );
            activeTests.set(senderId, testData);
        }
    }
}

async function handleTestTimeout(client, userId, groupId, messageToDelete) {
    if (activeTests.has(userId)) {
        try {
            const chat = await client.getChatById(groupId);
            if (messageToDelete) {
                await messageToDelete.delete(true);
            }
            await chat.removeParticipants([userId]);
            await client.sendMessage(userId, '❌ הזמן להשיב על השאלות עבר (6 דקות). הוסרת מהקבוצה.');
            console.log(`User ${userId} removed due to timeout`);
            await sendAdminAlert(client, `User ${userId} removed due to timeout. (The test time has been passed)`)
            activeTests.delete(userId);
        } catch (error) {
            console.error('Error during test timeout removal:', error);
        }
    }
}

// הוספת לוגים לכל סוגי האירועים הקשורים לקבוצה
client.on('group_update', (notification) => {
    log('עדכון בקבוצה:');
    log(notification);
});

// הוספת האזנה לכל האירועים כדי לדבג
client.on('**', (event) => {
    log(`[אירוע] התקבל אירוע: ${event.type}`);
});

// הוספת האזנה לאירוע כניסה לקבוצה
client.on('group_join', async (notification) => {
    try {
        const groupId = notification.id._serialized;
        const userId = notification.author;

        // בדיקה אם הקבוצה מנוהלת
        if (!botConfig.isManagedGroup(groupId)) {
            return;
        }

        // בדיקה אם המשתמש ברשימה השחורה
        if (botConfig.isBlacklisted(userId)) {
            console.log(`משתמש ${userId} ברשימה השחורה מנסה להצטרף לקבוצה ${groupId}`);

            try {
                const chat = await client.getChatById(groupId);
                // בדיקה אם הבוט מנהל את הקבוצה
                const isAdmin = await isGroupAdmin(client, groupId);
                if (!isAdmin) {
                    console.log(`הבוט אינו מנהל את הקבוצה ${chat.name || groupId}, לא ניתן להסיר את המשתמש`);
                    return;
                }

                // הסרת המשתמש מהקבוצה
                await chat.removeParticipants([userId]);
                console.log(`המשתמש ${userId} הוסר מהקבוצה ${chat.name || groupId} כי הוא ברשימה השחורה`);

                // שליחת התראה למנהלים
                await sendAdminAlert(client, `משתמש ${userId} שהיה ברשימה השחורה ניסה להצטרף לקבוצה ${chat.name || groupId} והוסר`);
            } catch (error) {
                console.error(`שגיאה בהסרת משתמש ${userId} מהקבוצה ${groupId}:`, error);
            }
        }
    } catch (error) {
        console.error('שגיאה בטיפול באירוע כניסה לקבוצה:', error);
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
    try {
        http.listen(port, () => {
            log(`[שרת] השרת פועל על פורט ${port}`);
        });
    } catch (error) {
        if (error.code === 'EADDRINUSE') {
            log(`[שרת] פורט ${port} תפוס, מנסה פורט ${port + 1}`);
            startServer(port + 1);
        } else {
            log(`[שרת] שגיאה בהפעלת השרת: ${error.message}`);
            process.exit(1);
        }
    }
};

startServer(PORT);

// התחלת הבוט
initializeClient();


// פונקציה לבדיקת הודעות ישנות
async function checkOldMessages(client) {
    try {
        const threeDaysAgo = new Date();
        threeDaysAgo.setDate(threeDaysAgo.getDate() - 3); // הגדלת הטווח ל-3 ימים

        // קבלת כל הקבוצות המנוהלות
        const managedGroups = Array.from(botConfig.managedGroups);
        log(`בודק ${managedGroups.length} קבוצות מנוהלות...`);

        for (const groupId of managedGroups) {
            try {
                log(`בודק הודעות בקבוצה ${groupId}...`);
                const chat = await client.getChatById(groupId);

                // שימוש ב-fetchMessages במקום chat.messages
                const messages = await chat.fetchMessages({ limit: 500 });
                log(`נמצאו ${messages.length} הודעות לבדיקה בקבוצה ${chat.name || 'קבוצה ללא שם'}`);

                let checkedMessages = 0;
                let foundLinks = 0;

                for (const message of messages) {
                    checkedMessages++;

                    // בדיקה אם ההודעה מהעבר
                    if (message.timestamp < threeDaysAgo) {
                        log(`הודעה מהעבר מ: ${message.author}`);
                        foundLinks++;
                    }
                }

                log(`נמצאו ${foundLinks} קישורים בהודעות ישנות בקבוצה ${chat.name || 'קבוצה ללא שם'}`);
            } catch (error) {
                log(`שגיאה בבדיקת הודעות ישנות בקבוצה ${groupId}:`);
                log(error);
            }
        }
    } catch (error) {
        log('שגיאה בבדיקת הודעות ישנות:');
        log(error);
    }
}

// פונקציה לזיהוי והוספת כל הקבוצות שהבוט מנהל בהן
async function addAllManagedGroups(client) {
    try {
        console.log('מתחיל סריקת קבוצות...');
        const chats = await client.getChats();
        let addedGroups = 0;

        for (const chat of chats) {
            if (chat.isGroup) {
                try {
                    // בדיקה אם הבוט מנהל את הקבוצה
                    const isAdmin = await isGroupAdmin(client, chat.id._serialized);
                    if (!isAdmin) {
                        console.log(`הבוט אינו מנהל את הקבוצה ${chat.name || chat.id._serialized}, מדלג`);
                        continue;
                    }

                    // הוספת הקבוצה לרשימת הקבוצות המנוהלות
                    if (botConfig.addManagedGroup(chat.id._serialized)) {
                        console.log(`נוספה קבוצה מנוהלת: ${chat.name || chat.id._serialized}`);
                        addedGroups++;
                    }
                } catch (error) {
                    console.error(`שגיאה בבדיקת קבוצה ${chat.name || chat.id._serialized}:`, error);
                }
            }
        }

        console.log(`סיים סריקת קבוצות. נוספו ${addedGroups} קבוצות מנוהלות.`);
    } catch (error) {
        console.error('שגיאה בסריקת קבוצות:', error);
    }
}

// פונקציה לניקוי תקופתי של משתמשים "תקועים"
async function periodicCleanup() {
    log('מתחיל ניקוי תקופתי של משתמשים...');
    let cleanedCount = 0;

    // בדיקת כל המשתמשים ב-pendingUsers
    for (const [userId, data] of pendingUsers.entries()) {
        // אם המשתמש נשאר יותר מ-24 שעות בלי עדכון
        if (Date.now() - data.timestamp > 24 * 60 * 60 * 1000) {
            log(`משתמש ${userId} נשאר יותר מ-24 שעות - מסיר...`);
            pendingUsers.delete(userId);
            userStates.delete(userId);
            cleanedCount++;
        }
    }

    // בדיקת משתמשים שנכשלו פעם אחת
    for (const [userId, data] of failedOnceUsers.entries()) {
        // אם עברו יותר מ-24 שעות מהכישלון
        if (Date.now() - data.timestamp > 24 * 60 * 60 * 1000) {
            log(`משתמש ${userId} נכשל פעם אחת לפני יותר מ-24 שעות - מסיר מאיזור הביניים...`);
            failedOnceUsers.delete(userId);
            cleanedCount++;
        }
    }

    log(`ניקוי תקופתי הושלם - נוקו ${cleanedCount} משתמשים`);
}

// הפעלת הניקוי כל 24 שעות
setInterval(periodicCleanup, 24 * 60 * 60 * 1000);

// הוספת פונקציה לשליחת התראות למנהלים
async function sendAdminAlert(client, message) {
    try {
        console.log('שולח התראה למנהלים:', message);
        for (const adminId of ALERT_ADMIN_NUMBERS) {
            try {
                await client.sendMessage(adminId, `*התראה למנהל:*\n${message}`);
            } catch (error) {
                console.error(`שגיאה בשליחת התראה למנהל ${adminId}:`, error);
            }
        }
    } catch (error) {
        console.error('שגיאה בשליחת התראות למנהלים:', error);
    }
}

// טיימר ניקוי משתמשים ממתינים כל 15 דקות
setInterval(async () => {
    const now = Date.now();
    for (const [userId, data] of pendingUsers.entries()) {
        if (now - data.timestamp > 10 * 60 * 1000) { // יותר מ-10 דקות
            try {
                const chat = await client.getChatById(data.groupId);
                await chat.removeParticipants([userId]);

                pendingUsers.delete(userId);
                console.log(`משתמש ${userId} הוסר אוטומטית לאחר 10 דקות המתנה`);
            } catch (error) {
                console.error(`שגיאה בהסרת משתמש ${userId} מהקבוצה (ניקוי אוטומטי):`, error);
            }
        }
    }
}, 10 * 60 * 1000); // כל 15 דקות

function isAdmin(userId) {
    return ADMIN_NUMBERS.has(userId);
}

// פונקציה לבדיקה אם משתמש חסין
function isImmune(userId) {
    return IMMUNE_NUMBERS.has(userId);
}

// פונקציה לבדיקה אם משתמש מאושר
function isApproved(userId) {
    return APPROVED_USERS.has(userId) || botConfig.isApprovedUser(userId);
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
        // Log success, potentially getting count from botConfig if needed
        console.log('✅ רשימה שחורה עודכנה בהצלחה דרך botConfig');
    } catch (error) {
        console.error('❌ שגיאה בשמירת הרשימה השחורה דרך botConfig:', error);
    }
}

function addToBlacklist(userId) {
    // Delegate adding to botConfig
    botConfig.addToBlacklist(userId);
    // BLACKLIST variable should automatically reflect this change if it's a reference.
    // If not, BLACKLIST might need to be reassigned: BLACKLIST = botConfig.blacklistedUsers;
}

function removeFromBlacklist(userId) {
    // Delegate removing to botConfig
    botConfig.removeFromBlacklist(userId);
    // BLACKLIST variable should automatically reflect this change.
    // If not, BLACKLIST might need to be reassigned: BLACKLIST = botConfig.blacklistedUsers;
}

// שמירה אוטומטית כל 5 דקות
setInterval(() => {
    console.log('🔄 מבצע שמירה אוטומטית של נתונים...');
    console.log('מצב נוכחי:');
    console.log('- רשימה שחורה:', BLACKLIST.size, 'משתמשים');
    console.log('- משתמשים מאושרים:', APPROVED_USERS.size, 'משתמשים');
    saveBlacklist();
    saveApprovedUsers();
}, 5 * 60 * 1000);

// טעינת המשתמשים המאושרים מהקובץ
try {
    const approvedData = fs.readFileSync(approvedPath, 'utf8');
    APPROVED_USERS = new Set(JSON.parse(approvedData));
    console.log('משתמשים מאושרים נטענו:', Array.from(APPROVED_USERS));
} catch (error) {
    console.error('שגיאה בטעינת המשתמשים המאושרים:', error);
    APPROVED_USERS = new Set();
}

function saveApprovedUsers() {
    try {
        fs.writeFileSync('approved-users.json', JSON.stringify(Array.from(APPROVED_USERS)));
        return true;
    } catch (error) {
        console.error('❌ שגיאה בשמירת המשתמשים המאושרים:', error);
        return false;
    }
}

function removeApprovedUser(userId) {
    APPROVED_USERS.delete(userId);
    const saved = saveApprovedUsers();
    if (saved) {
        console.log(`משתמש ${userId} הוסר מהמשתמשים המאושרים בהצלחה`);
    } else {
        console.error(`שגיאה בהסרת משתמש ${userId} מהמשתמשים המאושרים`);
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

    // 2. If it's a link-preview stub → ask WhatsApp for the contact behind it
    if (jid.endsWith('@lid')) {
        const contact = await msg.getContact();   // whatsapp-web.js helper
        jid = contact.id._serialized;             // e.g. '972501234567@c.us'
    }

    return jid;  // always something@c.us or something@s.whatsapp.net
}


async function kickUserFromGroup(client, userId, groupId) {
    try {
        // Get chat
        const chat = await client.getChatById(groupId);

        // Ensure participants are loaded
        if (!chat.participants || chat.participants.length === 0) {
            console.log('Fetching participants...');
            await chat.fetchParticipants();
        }

        // Extract phone number from userId for matching
        const userPhone = userId.replace('@c.us', '');
        const last9 = userPhone.slice(-9);

        console.log(`Looking for user ${userId} (last 9: ${last9}) in ${chat.name || groupId}`);

        // Find the participant - check multiple formats
        let participantToRemove = null;

        for (const p of chat.participants) {
            const pId = p.id._serialized;
            const pUser = p.id.user || '';
            const pPhoneTail = pUser.replace(/\D/g, '').slice(-9);

            // Check various matching conditions
            if (pId === userId ||
                pUser === userPhone ||
                pPhoneTail === last9 ||
                (p.contact?.number && p.contact.number.replace(/\D/g, '').slice(-9) === last9)) {
                participantToRemove = pId;
                console.log(`Found participant to remove: ${pId}`);
                break;
            }
        }

        if (!participantToRemove) {
            console.log(`ℹ️ user ${userId} not found in ${chat.name || groupId}`);
            // Log first few participants for debugging
            console.log('Sample participants in group:');
            chat.participants.slice(0, 3).forEach((p, i) => {
                console.log(`  ${i + 1}. ${p.id._serialized} (user: ${p.id.user})`);
            });
            return false;
        }

        // Try to remove the participant using different approaches
        console.log(`Attempting to remove ${participantToRemove}...`);

        // Method 1: Standard method with the found participant ID
        try {
            await chat.removeParticipants([participantToRemove]);
            console.log(`✅ Successfully removed ${participantToRemove} from ${chat.name || groupId}`);
            return true;
        } catch (err) {
            console.log(`Method 1 failed: ${err.message}`);
        }

        // Method 2: Try with just the phone number (no @c.us)
        try {
            const phoneOnly = participantToRemove.replace('@c.us', '').replace('@lid', '');
            console.log(`Trying with phone only: ${phoneOnly}`);
            await chat.removeParticipants([phoneOnly]);
            console.log(`✅ Successfully removed using phone number only!`);
            return true;
        } catch (err) {
            console.log(`Method 2 failed: ${err.message}`);
        }

        // Method 3: Get the actual participant object and use its ID
        try {
            const participant = chat.participants.find(p =>
                p.id._serialized === participantToRemove ||
                p.id.user === userPhone ||
                (p.id.user || '').replace(/\D/g, '').slice(-9) === last9
            );

            if (participant && participant.id) {
                console.log(`Found participant object with ID: ${participant.id._serialized}`);
                // Try with the Contact object if available
                if (participant.id.toJid) {
                    const jid = participant.id.toJid();
                    console.log(`Using JID from participant: ${jid}`);
                    await chat.removeParticipants([jid]);
                    console.log(`✅ Successfully removed using participant JID!`);
                    return true;
                }
            }
        } catch (err) {
            console.log(`Method 3 failed: ${err.message}`);
        }

        // Method 4: Use the internal WhatsApp Web API directly
        try {
            console.log('Trying Store API method...');
            const result = await client.pupPage.evaluate(async (chatId, participantId, phoneNumber) => {
                try {
                    const chat = await window.Store.Chat.get(chatId);
                    if (!chat) return { success: false, error: 'Chat not found' };

                    // Try multiple WID formats
                    const wids = [
                        window.Store.WidFactory.createWid(participantId),
                        window.Store.WidFactory.createWid(phoneNumber),
                        window.Store.WidFactory.createWid(phoneNumber + '@c.us')
                    ];

                    for (const wid of wids) {
                        try {
                            await window.Store.GroupParticipants.removeParticipants(chat, [wid]);
                            return { success: true };
                        } catch (e) {
                            // Try next format
                        }
                    }

                    return { success: false, error: 'All WID formats failed' };
                } catch (err) {
                    return { success: false, error: err.message };
                }
            }, groupId, participantToRemove, userPhone);

            if (result.success) {
                console.log(`✅ Successfully removed using Store method!`);
                return true;
            } else {
                console.log(`Method 4 failed: ${result.error}`);
            }
        } catch (evalErr) {
            console.log(`Method 4 evaluation error: ${evalErr.message}`);
        }

        // If all methods fail
        console.error(`❌ All removal methods failed for ${participantToRemove}`);
        console.log('Debug info:');
        console.log(`  User phone: ${userPhone}`);
        console.log(`  Last 9: ${last9}`);
        console.log(`  Participant to remove: ${participantToRemove}`);
        return false;
    } catch (error) {
        console.error(`❌ Error removing ${userId} from ${groupId}:`, error.message);
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

    console.log(`Attempting to remove ${jidCanonical} from ${groups.length} groups`);

    for (const groupId of groups) {
        let groupName = groupId;

        try {
            // Use the working kickUserFromGroup function
            const success = await kickUserFromGroup(client, jidCanonical, groupId);

            // Get chat name for logging
            try {
                const chat = await client.getChatById(groupId);
                groupName = chat.name || groupId;

                // Check if we're admin
                if (!(await isGroupAdmin(client, groupId))) {
                    notAdmin++;
                    perGroup.push({ group: groupName, removed: false, error: 'bot_not_admin' });
                    continue;
                }

                // Try to delete messages
                try {
                    const msgs = await chat.fetchMessages({ limit: 100 });
                    for (const m of msgs) {
                        const msgAuthor = m.author || m.from || m._data?.author || m._data?.from;
                        if (msgAuthor === jidCanonical) {
                            try {
                                await m.delete(true);
                                wipedMsgs++;
                            } catch { /* ignore */ }
                        }
                    }
                } catch (err) {
                    console.error(`msg-wipe error in ${groupId}:`, err.message);
                }
            } catch (chatErr) {
                console.error(`Error getting chat ${groupId}:`, chatErr.message);
            }

            if (success) {
                removed++;
                perGroup.push({ group: groupName, removed: true, error: '' });

                // Alert admins
                if (typeof alertRemoval === 'function') {
                    try {
                        await alertRemoval(
                            client, 'הסרה ידנית',
                            { from: jidCanonical }, groupName
                        );
                    } catch (alertErr) {
                        console.error(`Alert error: ${alertErr.message}`);
                    }
                }
            } else {
                failed++;
                perGroup.push({ group: groupName, removed: false, error: 'kick_failed' });
            }

        } catch (err) {
            console.error(`Error processing group ${groupName}:`, err);
            failed++;
            perGroup.push({ group: groupName, removed: false, error: err.message });
        }
    }

    /* Add to blacklist once – after all groups processed */
    if (typeof addToBlacklist === 'function') {
        try {
            addToBlacklist(jidCanonical);
            const blacklistResults = await addUserToBlacklistWithLid(message, addToBlacklist);
            console.log(`Added ${jidCanonical} to blacklist`);
        } catch (err) {
            console.error(`Failed to add to blacklist: ${err.message}`);
        }
    }

    return {
        success: true,
        phoneNumber: e164,
        removedFromGroups: removed,
        failedGroups: failed,
        groupsNotAdmin: notAdmin,
        totalDeletedMessages: wipedMsgs,
        groupResults: perGroup
    };
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
    console.log('=== DEBUG USER REMOVAL ===');
    console.log(`Input phone number: ${phoneNumber}`);

    // Test phone number formatting
    const e164 = formatPhoneNumberToE164(phoneNumber);
    console.log(`Formatted to E164: ${e164}`);

    if (!e164) {
        console.error('❌ Failed to format phone number');
        return;
    }

    const jidCanonical = `${e164}@c.us`;
    console.log(`Canonical JID: ${jidCanonical}`);

    // Get managed groups
    const groups = Array.from(botConfig.managedGroups || []);
    console.log(`Total managed groups: ${groups.length}`);

    if (groups.length === 0) {
        console.error('❌ No managed groups found');
        return;
    }

    // Test first group only for debugging
    const testGroupId = groups[0];
    console.log(`\nTesting with group: ${testGroupId}`);

    try {
        const chat = await client.getChatById(testGroupId);
        console.log(`✅ Successfully got chat: ${chat.name || testGroupId}`);

        // Check if bot is admin
        const isAdmin = await isGroupAdmin(client, testGroupId);
        console.log(`Bot is admin: ${isAdmin ? '✅ YES' : '❌ NO'}`);

        if (!isAdmin) {
            console.error('Bot needs admin permissions to remove users');
            return;
        }

        // Fetch participants if needed
        if (!chat.participants?.length) {
            console.log('Fetching participants...');
            await chat.fetchParticipants();
        }

        console.log(`Total participants: ${chat.participants?.length || 0}`);

        // Show first 10 participants for debugging
        console.log('\nFirst 10 participants in group:');
        chat.participants?.slice(0, 10).forEach((p, i) => {
            console.log(`${i + 1}. ID: ${p.id._serialized}`);
            console.log(`   User: ${p.id.user}`);
            console.log(`   Server: ${p.id.server}`);
            if (p.contact?.number) {
                console.log(`   Contact number: ${p.contact.number}`);
            }
        });

        // Find matching participants
        const last9 = e164.slice(-9);
        console.log(`\nLooking for participants with phone ending in: ${last9}`);
        console.log(`Looking for exact JID: ${jidCanonical}`);

        const matchingParticipants = [];
        for (const p of chat.participants || []) {
            const participantId = p.id._serialized;
            const phoneTail = (p.id.user || '').replace(/\D/g, '').slice(-9);

            // Check various matching conditions
            const matches = phoneTail === last9 ||
                participantId === jidCanonical ||
                p.id.user === e164 ||
                (p.contact?.number && p.contact.number.replace(/\D/g, '').slice(-9) === last9);

            if (matches) {
                matchingParticipants.push({
                    id: participantId,
                    phoneTail: phoneTail,
                    user: p.id.user,
                    server: p.id.server,
                    isContact: !!p.contact,
                    contactNumber: p.contact?.number
                });
            }
        }

        console.log(`\nFound ${matchingParticipants.length} matching participants:`);
        matchingParticipants.forEach((p, i) => {
            console.log(`${i + 1}. ID: ${p.id}`);
            console.log(`   Phone tail: ${p.phoneTail}`);
            console.log(`   Is contact: ${p.isContact}`);
            if (p.contactNumber) {
                console.log(`   Contact number: ${p.contactNumber}`);
            }
        });

        if (matchingParticipants.length === 0) {
            console.error('❌ No matching participants found in this group');
            console.log('\nSearching for user in all participants...');

            // Search through ALL participants with detailed info
            let foundAnyMatch = false;
            chat.participants?.forEach((p, i) => {
                const pId = p.id._serialized;
                const pUser = p.id.user || '';
                const pServer = p.id.server || '';

                // Check if this participant's phone contains our target number
                if (pUser.includes('509205698') || pId.includes('509205698')) {
                    console.log(`\n🔍 POTENTIAL MATCH FOUND at index ${i}:`);
                    console.log(`   Full ID: ${pId}`);
                    console.log(`   User: ${pUser}`);
                    console.log(`   Server: ${pServer}`);
                    console.log(`   Is Contact: ${!!p.contact}`);
                    if (p.contact) {
                        console.log(`   Contact Name: ${p.contact.name || 'N/A'}`);
                        console.log(`   Contact Number: ${p.contact.number || 'N/A'}`);
                        console.log(`   Contact Short Name: ${p.contact.shortName || 'N/A'}`);
                    }
                    foundAnyMatch = true;
                }
            });

            if (!foundAnyMatch) {
                console.log('\nNo participants found containing "509205698" in their ID');
                console.log('\nShowing ALL participants (first 20):');
                chat.participants?.slice(0, 20).forEach((p, i) => {
                    const pId = p.id._serialized;
                    const pUser = p.id.user || '';
                    console.log(`${i + 1}. ${pId} (user: ${pUser})`);
                });
                if (chat.participants?.length > 20) {
                    console.log(`... and ${chat.participants.length - 20} more participants`);
                }
            }
        } else {
            // Try to remove the first matching participant
            console.log('\nAttempting to remove first matching participant...');
            const targetParticipant = matchingParticipants[0];

            // Try different removal methods
            console.log('\n=== TESTING DIFFERENT REMOVAL METHODS ===');

            // Method 1: Full JID
            try {
                console.log(`\n1. Trying with full JID: ${targetParticipant.id}`);
                await chat.removeParticipants([targetParticipant.id]);
                console.log('✅ Success with full JID!');
                return;
            } catch (err) {
                console.error(`❌ Failed with full JID: ${err.message}`);
            }

            // Method 2: User part only
            if (targetParticipant.user) {
                try {
                    console.log(`\n2. Trying with user part only: ${targetParticipant.user}`);
                    await chat.removeParticipants([targetParticipant.user]);
                    console.log('✅ Success with user part!');
                    return;
                } catch (err) {
                    console.error(`❌ Failed with user part: ${err.message}`);
                }
            }

            // Method 3: Construct @c.us format
            try {
                const cusFormat = `${targetParticipant.user || e164}@c.us`;
                console.log(`\n3. Trying with constructed @c.us: ${cusFormat}`);
                await chat.removeParticipants([cusFormat]);
                console.log('✅ Success with @c.us format!');
                return;
            } catch (err) {
                console.error(`❌ Failed with @c.us format: ${err.message}`);
            }

            // Method 4: Get participant object and use it
            try {
                console.log(`\n4. Trying to find participant object...`);
                const participant = chat.participants.find(p =>
                    p.id._serialized === targetParticipant.id ||
                    p.id.user === targetParticipant.user
                );
                if (participant) {
                    console.log(`Found participant object, using ID: ${participant.id._serialized}`);
                    await chat.removeParticipants([participant.id._serialized]);
                    console.log('✅ Success with participant object!');
                    return;
                }
            } catch (err) {
                console.error(`❌ Failed with participant object: ${err.message}`);
            }
        }

    } catch (err) {
        console.error('❌ Error during debug:', err);
    }

    console.log('=== END DEBUG ===');
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
    try {
        if (!groupId) {
            console.error("Invalid groupId provided");
            return [];
        }

        console.log(`Getting participants for group: ${groupId}`);

        // Use puppeteer to directly access WhatsApp Web's internal store
        const participants = await client.pupPage.evaluate(async (gid) => {
            try {
                // Get the chat directly from the Store
                const chat = await window.Store.Chat.get(gid);

                if (!chat) {
                    return { error: `Chat not found: ${gid}` };
                }

                const groupName = chat.name || "Unknown Group";

                // Make sure we have the latest metadata
                if (chat.groupMetadata && typeof chat.groupMetadata.queryParticipants === 'function') {
                    try {
                        await chat.groupMetadata.queryParticipants();
                    } catch (e) {
                        // Continue with existing data
                    }
                }

                // Get participants
                let participants = [];

                if (chat.groupMetadata && chat.groupMetadata.participants) {
                    participants = chat.groupMetadata.participants.getModelsArray().map(p => {
                        return {
                            id: p.id._serialized || p.id.toString(),
                            isAdmin: p.isAdmin,
                            isSuperAdmin: p.isSuperAdmin
                        };
                    });
                }

                return {
                    name: groupName,
                    participants: participants
                };
            } catch (error) {
                return { error: error.message, stack: error.stack };
            }
        }, groupId);

        if (participants.error) {
            console.error(`Error getting participants: ${participants.error}`);
            console.error(`Stack: ${participants.stack || 'No stack trace'}`);
            return [];
        }

        console.log(`Group: ${participants.name} | Total participants: ${participants.participants.length}`);

        // Log each participant
        participants.participants.forEach((participant, index) => {
            console.log(`User ${index + 1}: ${participant.id} (${participant.isAdmin ? 'Admin' : 'Member'})`);
        });

        return participants.participants;
    } catch (error) {
        console.error(`Error in getGroupParticipants: ${error.message}`);
        console.error(`Stack trace: ${error.stack}`);
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
    try {
        console.log("Starting to get participants for all managed groups...");

        // Get all managed group IDs from botConfig
        const managedGroups = Array.from(botConfig.managedGroups);

        if (!managedGroups || managedGroups.length === 0) {
            console.log("No managed groups found");
            return {};
        }

        console.log(`Found ${managedGroups.length} managed groups`);
        console.log("===================================================");

        // Create a map to store all groups and their participants
        const allGroupParticipants = {};

        // Process each group
        for (let i = 0; i < managedGroups.length; i++) {
            try {
                const groupId = managedGroups[i];

                console.log(`Processing group ${i + 1}/${managedGroups.length}: ${groupId}`);

                // Get group info and participants
                const result = await getGroupParticipants(groupId);

                if (result && result.length > 0) {
                    allGroupParticipants[groupId] = result;
                    console.log(`Successfully processed group ${i + 1}: ${groupId}`);
                } else {
                    console.log(`No participants found for group ${groupId}`);
                }

                console.log("===================================================");
            } catch (groupError) {
                console.error(`Error processing group at index ${i}: ${groupError.message}`);
                continue;
            }
        }

        console.log("Finished getting participants for all managed groups");
        console.log(`Total groups processed: ${Object.keys(allGroupParticipants).length}`);

        return allGroupParticipants;
    } catch (error) {
        console.error(`Error in getAllManagedGroupsParticipants: ${error.message}`);
        console.error(`Stack trace: ${error.stack}`);
        return {};
    }
}

/**
 * Direct method to get participants for a specific group ID
 * This is the simplest approach and should work with any WhatsApp Web.js version
 * 
 * @param {string} groupId - The ID of the group to get users from (e.g., "120363401770902931@g.us")
 */
async function getParticipantsForGroup(groupId) {
    try {
        console.log(`Getting participants for group: ${groupId}`);

        // Get the chat directly
        const chat = await client.getChatById(groupId);

        if (!chat) {
            console.error(`Chat not found: ${groupId}`);
            return;
        }

        console.log(`Found group: ${chat.name}`);

        // Try to fetch participants if the method exists
        if (typeof chat.fetchParticipants === 'function') {
            try {
                console.log("Fetching latest participants data...");
                await chat.fetchParticipants();
            } catch (e) {
                console.error(`Error fetching participants: ${e.message}`);
                // Continue with existing data
            }
        }

        // Get participants
        const participants = chat.participants || [];

        console.log(`Total participants: ${participants.length}`);

        // Log each participant
        participants.forEach((participant, index) => {
            try {
                const id = participant.id._serialized || "Unknown ID";
                const isAdmin = participant.isAdmin ? "Admin" : "Member";

                console.log(`User ${index + 1}: ${id} (${isAdmin})`);
            } catch (e) {
                console.log(`User ${index + 1}: Error getting details - ${e.message}`);
            }
        });

        return participants;
    } catch (error) {
        console.error(`Error in getParticipantsForGroup: ${error.message}`);
        console.error(`Stack trace: ${error.stack}`);
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
    try {
        // Strip any "@c.us" from the client’s ID for matching against Store.Chat.get(...).
        const rawBotId = client.info.wid._serialized;       // e.g. "972535349587@c.us"
        const botUserOnly = rawBotId.replace(/@c\.us$/, "");

        // Use Puppeteer to inspect the internal Store.Chat model
        const adminCheck = await client.pupPage.evaluate(
            async (gid, botUser) => {
                try {
                    const chatStore = window.Store.Chat.get(gid);
                    if (!chatStore || !chatStore.groupMetadata) {
                        return false;
                    }
                    const participantsArray = chatStore.groupMetadata.participants.getModelsArray();
                    // Find the participant entry whose Wid.user matches our bot’s phone
                    const entry = participantsArray.find(p => p.id.user === botUser);
                    if (!entry) {
                        return false;
                    }
                    // Check if that entry has admin or superadmin privileges
                    return Boolean(entry.isAdmin || entry.isSuperAdmin);
                } catch {
                    return false;
                }
            },
            groupId,
            botUserOnly
        );

        return Boolean(adminCheck);
    } catch {
        return false;
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
    try {
        console.log(`Attempting to send private message to ${phoneNumber}`);

        // Format the phone number to ensure it's in the correct format
        const formattedNumber = formatPhoneNumberToE164(phoneNumber);

        // Create the recipient ID in the format expected by WhatsApp
        const recipientId = `${formattedNumber}@c.us`;

        console.log(`Sending message to formatted recipient: ${recipientId}`);

        // Send the message
        const sentMessage = await client.sendMessage(recipientId, message);

        console.log(`Message sent successfully to ${recipientId}`);
        return sentMessage;
    } catch (error) {
        console.error(`Error sending private message to ${phoneNumber}:`, error);
        throw error;
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

    try {
        // Get the sender's JID (could be from your existing function)
        const senderJid = await getRealSenderJid(message);
        results.regularId = senderJid;

        // Add regular JID to blacklist
        try {
            await addToBlacklist(senderJid);
            await addToBlacklist(senderJid.split('@')[0] + "@c.us");

            results.regularIdAdded = true;

            console.log(`Added regular ID to blacklist: ${senderJid}`);
        } catch (error) {
            results.errors.push({ type: 'regular', message: error.message });
            console.error(`Error adding regular ID to blacklist: ${error}`);
        }

        // Handle @lid blacklisting
        if (message.author && message.author.includes('@lid')) {
            // Direct @lid found in message author
            results.lidId = message.author;
            try {
                await addToBlacklist(message.author);
                await addToBlacklist(message.author.split('@')[0] + "@c.us");

                results.lidIdAdded = true;
                console.log(`Added lid ID to blacklist: ${message.author}`);
            } catch (error) {
                results.errors.push({ type: 'lid', message: error.message });
                console.error(`Error adding lid ID to blacklist: ${error}`);
            }
        } else if (senderJid && !senderJid.includes('@lid')) {
            // Generate @lid from regular JID
            const numericPart = senderJid.split('@')[0];
            if (numericPart) {
                const lidId = `${numericPart}@lid`;
                results.lidId = lidId;

                try {
                    await addToBlacklist(lidId);
                    await addToBlacklist(lidId.split('@')[0] + "@c.us");

                    results.lidIdAdded = true;
                    console.log(`Added generated lid ID to blacklist: ${lidId}`);
                } catch (error) {
                    results.errors.push({ type: 'generated-lid', message: error.message });
                    console.error(`Error adding generated lid ID to blacklist: ${error}`);
                }
            }
        }

        return results;
    } catch (error) {
        results.errors.push({ type: 'general', message: error.message });
        console.error('General error in blacklisting user:', error);
        return results;
    }
}
cron.schedule(
    '0 4 * * *',
    async () => {
        try {
            console.log('[CRON] 04:00 job started');

            // 👉 2nd scheduled action
            await approveGroupRequests(null, {}, client);
            //    (replace with whatever you need)

            console.log('[CRON] 04:00 job completed');
        } catch (err) {
            console.error('[CRON] 04:00 job FAILED:', err);
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
        // For this refactor, we assume BLACKLIST is correctly referencing/synced with botConfig.blacklistedUsers
        let currentBlacklist = BLACKLIST;
        if (!(currentBlacklist instanceof Set)) {
            console.error("BLACKLIST is not a Set in approveGroupRequests. Using botConfig.blacklistedUsers directly or falling back.");
            currentBlacklist = botConfig.blacklistedUsers || new Set();
        }

        if (groupId) {
            const chat = await client.getChatById(groupId);
            const botContact = await client.getContactById(client.info.wid._serialized);
            const isAdmin = chat.participants.some(p =>
                p.id._serialized === botContact.id._serialized &&
                (p.isAdmin || p.isSuperAdmin)
            );

            if (!isAdmin) {
                return `❌ Bot is not admin in group ${groupId}`;
            }

            const membershipRequests = await client.getGroupMembershipRequests(groupId);
            if (membershipRequests.length === 0) {
                return `✅ No pending membership requests for group ${groupId}`;
            }

            console.log('Raw membership requests:', JSON.stringify(membershipRequests, null, 2));

            const allowedRequesterIds = [];
            const blockedRequesters = [];

            for (const request of membershipRequests) {
                let requesterId = null;
                try {
                    if (typeof request.author === 'string') {
                        requesterId = request.author;
                    } else if (request.author && request.author._serialized) {
                        requesterId = request.author._serialized;
                    } else if (request.id && typeof request.id === 'string') {
                        requesterId = request.id;
                    } else if (request.id && request.id._serialized) {
                        requesterId = request.id._serialized;
                    } else if (request.requester) {
                        if (typeof request.requester === 'string') {
                            requesterId = request.requester;
                        } else if (request.requester._serialized) {
                            requesterId = request.requester._serialized;
                        }
                    } else if (request.addedBy) {
                        if (typeof request.addedBy === 'string') {
                            requesterId = request.addedBy;
                        } else if (request.addedBy._serialized) {
                            requesterId = request.addedBy._serialized;
                        }
                    }

                    console.log(`Extracted requester ID: ${requesterId} from request:`, request);
                    if (requesterId) {
                        if (!currentBlacklist.has(requesterId)) { // Changed from blacklist.includes to currentBlacklist.has
                            allowedRequesterIds.push(requesterId);
                        } else {
                            blockedRequesters.push(requesterId);
                            console.log(`Blocked requester: ${requesterId} (in blacklist)`);
                        }
                    } else {
                        console.error('Could not extract requester ID from request:', request);
                    }
                } catch (extractionError) {
                    console.error('Error extracting requester ID:', extractionError);
                    console.error('Request object:', request);
                }
            }

            if (allowedRequesterIds.length === 0) {
                const totalBlocked = blockedRequesters.length;
                const totalFailed = membershipRequests.length - blockedRequesters.length;
                return `⚠️ No valid requests to approve. Blacklisted: ${totalBlocked}, Failed to process: ${totalFailed}`;
            }

            console.log(`Approving ${allowedRequesterIds.length} requests:`, allowedRequesterIds);

            try {
                const results = await client.approveGroupMembershipRequests(groupId, {
                    requesterIds: allowedRequesterIds,
                    ...options
                });
                const blockedCount = blockedRequesters.length;
                return `✅ Processed ${results.length} membership requests for group ${groupId}\n` +
                    `📋 Approved: ${allowedRequesterIds.length}\n` +
                    `🚫 Blocked (blacklisted): ${blockedCount}`;
            } catch (approvalError) {
                console.error('Error during approval:', approvalError);
                console.error('Attempted to approve IDs:', allowedRequesterIds);

                let successCount = 0;
                for (const id of allowedRequesterIds) {
                    try {
                        await client.approveGroupMembershipRequests(groupId, {
                            requesterIds: [id]
                        });
                        successCount++;
                    } catch (individualError) {
                        console.error(`Failed to approve ${id}:`, individualError.message);
                    }
                }

                return `⚠️ Partial approval: ${successCount}/${allowedRequesterIds.length} approved\n` +
                    `🚫 Blocked (blacklisted): ${blockedRequesters.length}\n` +
                    `❌ Some requests failed. See console for details.`;
            }
        } else {
            const chats = await client.getChats();
            const groups = chats.filter(chat => chat.isGroup);
            let totalApproved = 0;
            let totalBlocked = 0;
            let adminGroups = 0;
            let nonAdminGroups = 0;
            let processedGroups = [];

            for (const group of groups) {
                try {
                    const botContact = await client.getContactById(client.info.wid._serialized);
                    const isAdmin = group.participants.some(p =>
                        p.id._serialized === botContact.id._serialized &&
                        (p.isAdmin || p.isSuperAdmin)
                    );

                    if (isAdmin) {
                        adminGroups++;
                        const membershipRequests = await client.getGroupMembershipRequests(group.id._serialized);

                        if (membershipRequests.length > 0) {
                            console.log(`Processing ${membershipRequests.length} requests for group ${group.name}`);
                            const allowedRequesterIds = [];
                            const blockedRequesters = [];

                            for (const request of membershipRequests) {
                                let requesterId = null;
                                try {
                                    if (typeof request.author === 'string') {
                                        requesterId = request.author;
                                    } else if (request.author && request.author._serialized) {
                                        requesterId = request.author._serialized;
                                    } else if (request.id && typeof request.id === 'string') {
                                        requesterId = request.id;
                                    } else if (request.id && request.id._serialized) {
                                        requesterId = request.id._serialized;
                                    } else if (request.requester) {
                                        if (typeof request.requester === 'string') {
                                            requesterId = request.requester;
                                        } else if (request.requester._serialized) {
                                            requesterId = request.requester._serialized;
                                        }
                                    } else if (request.addedBy) {
                                        if (typeof request.addedBy === 'string') {
                                            requesterId = request.addedBy;
                                        } else if (request.addedBy._serialized) {
                                            requesterId = request.addedBy._serialized;
                                        }
                                    }

                                    if (requesterId) {
                                        if (!currentBlacklist.has(requesterId)) { // Changed from blacklist.includes to currentBlacklist.has
                                            allowedRequesterIds.push(requesterId);
                                        } else {
                                            blockedRequesters.push(requesterId);
                                        }
                                    }
                                } catch (extractionError) {
                                    console.error(`Error extracting requester ID in group ${group.name}:`, extractionError);
                                }
                            }

                            const blockedCount = blockedRequesters.length;
                            totalBlocked += blockedCount;

                            if (allowedRequesterIds.length > 0) {
                                try {
                                    const results = await client.approveGroupMembershipRequests(group.id._serialized, {
                                        requesterIds: allowedRequesterIds,
                                        ...options
                                    });
                                    totalApproved += results.length;
                                    processedGroups.push(`${group.name}: approved ${results.length}, blocked ${blockedCount}`);
                                    console.log(`Approved ${results.length} requests in ${group.name} (blocked ${blockedCount} blacklisted users)`);
                                } catch (approvalError) {
                                    console.error(`Error approving requests for ${group.name}:`, approvalError.message);
                                    processedGroups.push(`${group.name}: error - ${approvalError.message}`);
                                }
                            } else {
                                processedGroups.push(`${group.name}: no valid requests (${membershipRequests.length} total)`);
                                console.log(`Skipped ${group.name} - no valid requests to approve`);
                            }
                        }
                    } else {
                        nonAdminGroups++;
                        console.log(`Skipped ${group.name} - bot not admin`);
                    }
                } catch (error) {
                    console.error(`Error processing ${group.name}:`, error.message);
                    console.error('Full error:', error);
                }
            }

            let report = `✅ Approved ${totalApproved} total requests across ${adminGroups} groups\n` +
                `🚫 Blocked ${totalBlocked} blacklisted users\n` +
                `⚠️ Skipped ${nonAdminGroups} groups (not admin)`;

            if (processedGroups.length > 0) {
                report += `\n\n📋 Group Details:\n${processedGroups.join('\n')}`;
            }

            return report;
        }
    } catch (error) {
        console.error('Error approving membership requests:', error);
        console.error('Error stack:', error.stack);
        return '❌ Error processing membership requests with blacklist filtering';
    }
}
