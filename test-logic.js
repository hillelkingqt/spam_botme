// פונקציה שמחזירה true אם המשתמש עבר את המבחן
const fs = require('fs');
const botConfig = require('./config');

// Load suspicious users list
let suspiciousUsers = [];
try {
    suspiciousUsers = JSON.parse(fs.readFileSync('suspicious-users.json'));
} catch (err) {
    suspiciousUsers = [];
    fs.writeFileSync('suspicious-users.json', JSON.stringify(suspiciousUsers));
}

// Load inappropriate language warnings
let languageWarnings = {};
try {
    languageWarnings = JSON.parse(fs.readFileSync('language-warnings.json'));
} catch (err) {
    languageWarnings = {};
    fs.writeFileSync('language-warnings.json', JSON.stringify(languageWarnings));
}

// List of inappropriate words (in Hebrew)
const inappropriateWords = [
    'קללה1', 'קללה2', 'קללה3' // Add your list of inappropriate words here
];

// List of suspicious keywords
const suspiciousKeywords = [
    // מילים בעברית
    'השקעה', 'רווח', 'כסף', 'הכנסה', 'עבודה מהבית', 'משרה חלקית',
    'מבצע', 'הנחה', 'חינם', 'הזדמנות', 'מהיר', 'רווחים',
    // מילים באנגלית
    'investment', 'profit', 'income', 'work from home', 'part time',
    'promotion', 'offer', 'discount', 'free', 'limited time'
];

// הוספת שאלות ויזואליות עם אימוג'ים
const visualQuestions = [
    {
        question: "מה החיה הזו? 🐘",
        answer: "פיל"
    },
    {
        question: "מה החפץ הזה? 🏠",
        answer: "בית"
    },
    {
        question: "מה החפץ הזה? ✈️",
        answer: "מטוס"
    },
    {
        question: "מה החיה הזו? 🐶",
        answer: "כלב"
    },
    {
        question: "מה החפץ הזה? ⌚",
        answer: "שעון"
    },
    {
        question: "מה החפץ הזה? 🚲",
        answer: "אופניים"
    },
    {
        question: "מה המאכל הזה? 🍕",
        answer: "פיצה"
    },
    {
        question: "מה הפרי הזה? 🍎",
        answer: "תפוח"
    }
];

// מאגר שאלות למבחן
const testQuestions = [
    {
        question: 'כמה זה 2+2?',
        answer: '4'
    },
    {
        question: 'כמה ימים יש בשבוע?',
        answer: '7'
    },
    {
        question: 'מהי בירת ישראל?',
        answer: 'ירושלים'
    },
    {
        question: 'האם מותר לקלל בקבוצה? (כן/לא)',
        answer: 'לא'
    },
    {
        question: 'כמה חודשים יש בשנה?',
        answer: '12'
    },
    {
        question: 'האם מותר לשתף תוכן לא הולם בקבוצה? (כן/לא)',
        answer: 'לא'
    },
    {
        question: 'מהו היום הראשון בשבוע?',
        answer: 'ראשון'
    },
    {
        question: 'האם מותר לפרסם פרסומות בקבוצה? (כן/לא)',
        answer: 'לא'
    },
    {
        question: 'כמה זה 5+5?',
        answer: '10'
    },
    {
        question: 'האם מותר לשלוח ספאם בקבוצה? (כן/לא)',
        answer: 'לא'
    },
    {
        question: 'מהו החודש הראשון בשנה?',
        answer: 'ינואר'
    },
    {
        question: 'כמה זה 3×3?',
        answer: '9'
    },
    {
        question: 'האם מותר לאיים על משתתפים אחרים? (כן/לא)',
        answer: 'לא'
    },
    {
        question: 'מהו היום האחרון בשבוע?',
        answer: 'שבת'
    },
    {
        question: 'האם חובה לכבד את חוקי הקבוצה? (כן/לא)',
        answer: 'כן'
    }
];

// מפת מבחנים פעילים
const activeTests = new Map();

// פונקציה ליצירת שאלה רנדומלית
function generateTestQuestion() {
    const useVisual = Math.random() < 0.5;
    if (useVisual) {
        const randomIndex = Math.floor(Math.random() * visualQuestions.length);
        return visualQuestions[randomIndex];
    } else {
        const questions = [
            {question: "כמה זה 5+5?", answer: "10"},
            {question: "כמה זה 8+7?", answer: "15"},
            {question: "כמה זה 12+8?", answer: "20"},
            {question: "כמה זה 6+9?", answer: "15"},
            {question: "כמה זה 11+4?", answer: "15"}
        ];
        const randomIndex = Math.floor(Math.random() * questions.length);
        return questions[randomIndex];
    }
}
// פונקציה להתחלת מבחן
async function startTest(client, userId, groupId, reason = '', message = null, groupNumber = null) {
    try {
        if (activeTests.has(userId)) {
            console.log(`User ${userId} already in test`);
            return;
        }
        const firstQuestion = generateTestQuestion();
        let testMessage = `*ברוך הבא למבחן הצטרפות!*\n\n`;
        if (reason === 'קישור') {
            testMessage += 'שלחת הודעה עם קישור. ';
        }
        testMessage += 'עליך לענות נכון על 3 שאלות כדי להישאר בקבוצה.\n';
        testMessage += 'יש לך 5 דקות לסיים את המבחן.\n\n';
        testMessage += `שאלה 1/3:\n${firstQuestion.question}`;
        await client.sendMessage(userId, testMessage);
        const testData = {
            groupId,
            groupNumber,
            currentQuestion: firstQuestion,
            correctAnswers: 0,
            wrongAnswers: 0,
            originalMessage: message,
            timeoutId: setTimeout(async () => {
                try {
                    console.log(`Time's up for user ${userId}`);
                    const chat = await client.getChatById(groupId);
                    await chat.removeParticipants([userId]);
                    await client.sendMessage(userId, '❌ תם הזמן! נכשלת במבחן והוסרת מהקבוצה.');
                    activeTests.delete(userId);
                } catch (error) {
                    console.error('Error handling test timeout:', error);
                }
            }, 10 * 60 * 1000)
        };
        activeTests.set(userId, testData);
        console.log(`Started test for user ${userId}`);
    } catch (error) {
        console.error('Error starting test:', error);
    }
}

// פונקציה לבדיקה אם משתמש עבר מבחן
function hasPassedTest(userId) {
    return botConfig.isApprovedUser(userId);
}

// פונקציה להוספת משתמש לרשימת המאושרים
function addApprovedUser(userId) {
    return botConfig.approveUser(userId);
}

// פונקציה לקבלת מבחן פעיל
function getActiveTest(userId) {
    return activeTests.get(userId);
}

// פונקציה להסרת מבחן פעיל
function removeActiveTest(userId) {
    return activeTests.delete(userId);
}

// פונקציה לטיפול בתשובות למבחן
async function handleTestResponse(client, message, userId) {
    const testData = activeTests.get(userId);
    if (!testData) {
        console.log(`Answer from user ${userId} not in active test`);
        return;
    }
    const userAnswer = message.body.toLowerCase().trim();
    const correctAnswer = testData.currentQuestion.answer.toLowerCase().trim();

    if (userAnswer === correctAnswer) {
        testData.correctAnswers++;
        if (testData.correctAnswers >= 3) {
            clearTimeout(testData.timeoutId);
            await addApprovedUser(userId);
            await client.sendMessage(userId, '✅ עברת את המבחן בהצלחה!');
            // Removed sending group list after test
            activeTests.delete(userId);
            updateTestAttempts(userId, true);
            if (typeof failedOnceUsers !== 'undefined' && failedOnceUsers.has(userId)) {
                failedOnceUsers.delete(userId);
            }
            if (typeof pendingUsers !== 'undefined' && pendingUsers.has(userId)) {
                pendingUsers.delete(userId);
            }
            console.log(`משתמש ${userId} עבר את המבחן בהצלחה`);
        } else {
            const nextQuestion = generateTestQuestion();
            testData.currentQuestion = nextQuestion;
            await client.sendMessage(userId,
                `✅ נכון! שאלה ${testData.correctAnswers + 1}/3:\n${nextQuestion.question}`
            );
            activeTests.set(userId, testData);
        }
    } else {
        testData.wrongAnswers++;
        if (testData.wrongAnswers >= 2) {
            clearTimeout(testData.timeoutId);
            try {
                const chat = await client.getChatById(testData.groupId);
                await chat.removeParticipants([userId]);
                if (typeof sendAdminAlert === 'function') {
                    await sendAdminAlert(client, `הועף מהקבוצה ${userId}`);
                }
                if (testData.originalMessage) {
                    await testData.originalMessage.delete(true);
                }
                await client.sendMessage(userId, '❌ נכשלת במבחן. הוסרת מהקבוצה.');
                if (typeof sendAdminAlert === 'function') {
                    await sendAdminAlert(client, `משתמש ${userId} נכשל במבחן אימות והוסר מהקבוצה`);
                }
            } catch (error) {
                console.error('Error removing user:', error);
            }
            activeTests.delete(userId);
            if (typeof updateTestAttempts === 'function') {
                updateTestAttempts(userId, false);
            }
            if (typeof pendingUsers !== 'undefined' && pendingUsers.has(userId)) {
                pendingUsers.delete(userId);
            }
            if (typeof getTestAttempts === 'function' && typeof failedOnceUsers !== 'undefined') {
                const attempts = getTestAttempts(userId);
                if (attempts.attempts === 1) {
                    failedOnceUsers.set(userId, {
                        timestamp: Date.now(),
                        groupId: testData.groupId
                    });
                    console.log(`משתמש ${userId} נכשל פעם אחת ונשמר באיזור ביניים`);
                } else if (attempts.attempts >= 2) {
                    botConfig.addToBlacklist(userId);
                    failedOnceUsers.delete(userId);
                    console.log(`משתמש ${userId} נכשל פעמיים במבחן והוכנס לרשימה שחורה`);
                }
            }
            console.log(`משתמש ${userId} נכשל במבחן`);
        } else {
            const nextQuestion = generateTestQuestion();
            testData.currentQuestion = nextQuestion;
            await client.sendMessage(userId,
                `❌ לא נכון. שאלה ${testData.correctAnswers + 1}/3:\n${nextQuestion.question}`
            );
            activeTests.set(userId, testData);
        }
    }
}

// Add suspicious activity
function addSuspiciousActivity(userId, data = {}) {
    const activity = {
        userId,
        timestamp: new Date().toISOString(),
        type: data.type || 'unknown',
        content: data.content || '',
        groupId: data.groupId || '',
        analysis: analyzeSuspiciousContent(data.content || '')
    };

    if (!suspiciousUsers) {
        suspiciousUsers = [];
    }

    suspiciousUsers.push(activity);
    try {
        fs.writeFileSync('suspicious-users.json', JSON.stringify(suspiciousUsers, null, 2));
    } catch (error) {
        console.error('שגיאה בשמירת פעילות חשודה:', error);
    }
    return activity;
}

// Check for inappropriate language
function checkInappropriateLanguage(message) {
    const words = message.toLowerCase().split(' ');
    return words.some(word => inappropriateWords.includes(word));
}

// Add language warning
function addLanguageWarning(userId) {
    if (!languageWarnings[userId]) {
        languageWarnings[userId] = 0;
    }
    languageWarnings[userId]++;
    fs.writeFileSync('language-warnings.json', JSON.stringify(languageWarnings));
    return languageWarnings[userId];
}

// Check if user should be removed due to language violations
function shouldRemoveForLanguage(userId) {
    return languageWarnings[userId] >= 3;
}

// Check for suspicious content
function isSuspiciousContent(message) {
    const hasLink = /(https?:\/\/|www\.)\S*\.(com|net|org|io|info|co)\b/i.test(message);
    const hasSuspiciousKeyword = suspiciousKeywords.some(keyword =>
        message.toLowerCase().includes(keyword.toLowerCase())
    );
    return hasLink && hasSuspiciousKeyword;
}

function analyzeSuspiciousContent(message = '') {
    if (!message || typeof message !== 'string') {
        return {
            hasLink: false,
            hasSuspiciousWords: false,
            suspiciousWords: [],
            isHighRisk: false
        };
    }

    // ביטוי רגולרי משופר לזיהוי קישורים
    const linkRegex = /(https?:\/\/|www\.|chat\.whatsapp\.com\/)[^\s\n<>[\](){}]+/gi;
    const matches = message.match(linkRegex);
    const hasLink = Boolean(matches && matches.length > 0);

    // בדיקת מילים חשודות רק אם יש תוכן
    const foundSuspiciousWords = suspiciousKeywords.filter(keyword =>
        message.toLowerCase().includes(keyword.toLowerCase())
    );

    const result = {
        hasLink,
        hasSuspiciousWords: foundSuspiciousWords.length > 0,
        suspiciousWords: foundSuspiciousWords,
        isHighRisk: hasLink && foundSuspiciousWords.length > 0
    };

    console.log('ניתוח תוכן:', {
        messageLength: message.length,
        ...result
    });

    return result;
}

// פונקציה לקבלת רשימת המשתמשים המאושרים
function getApprovedUsers() {
    return Array.from(botConfig.approvedUsers);
}

// פונקציה לבדיקה אם יש מבחן פעיל למשתמש
function hasActiveTest(userId) {
    return activeTests.has(userId);
}

module.exports = {
    startTest,
    hasPassedTest,
    addApprovedUser,
    generateTestQuestion,
    getActiveTest,
    removeActiveTest,
    handleTestResponse, // פונקציה חדשה לטיפול בתשובות למבחן
    hasActiveTest,      // פונקציה חדשה לבדיקה אם יש מבחן פעיל
    addSuspiciousActivity,
    checkInappropriateLanguage,
    addLanguageWarning,
    shouldRemoveForLanguage,
    isSuspiciousContent,
    analyzeSuspiciousContent,
    getApprovedUsers
};
