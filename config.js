const fs = require('fs');
const path = require('path');

// Helper to keep ids consistent (strip any non digit characters)
function normalizeId(id) {
    return id ? id.toString().replace(/\D/g, '') : '';
}

// מאגר נתונים משותף לכל המערכת
class BotConfig {
    constructor() {
        // יצירת תיקיית data אם לא קיימת
        const dataDir = path.join(__dirname, 'data_admin-bot');
        if (!fs.existsSync(dataDir)) {
            console.log('יוצר תיקיית data_admin-bot...');
            fs.mkdirSync(dataDir);
        }

        // קבוצות מנוהלות
        this.managedGroups = new Set();

        // משתמשים מאושרים
        this.approvedUsers = new Set();

        // רשימה שחורה
        this.blacklistedUsers = new Set();

        // מבחנים פעילים
        this.activeTests = new Map();

        // מנהלי מערכת
        this.adminUsers = new Set([
            "972505667709@c.us"
        ]);

        // טעינת נתונים מהקבצים
        this.loadManagedGroups();
        this.loadApprovedUsers();
        this.loadBlacklistedUsers();
    }

    // טעינת קבוצות מנוהלות מהקובץ
    loadManagedGroups() {
        try {
            const filePath = path.join(__dirname, 'managed-groups.json');
            if (fs.existsSync(filePath)) {
                const data = fs.readFileSync(filePath, 'utf8');
                const groups = JSON.parse(data);
                this.managedGroups = new Set(groups.groups);
                console.log('נטענו קבוצות מנוהלות:', {
                    count: this.managedGroups.size,
                    groups: Array.from(this.managedGroups)
                });
                return {
                    count: this.managedGroups.size,
                    groups: Array.from(this.managedGroups)
                };
            } else {
                console.log('קובץ קבוצות מנוהלות לא קיים, יוצר קובץ חדש...');
                this.managedGroups = new Set([]);
                this.saveManagedGroups();
                return {
                    count: 0,
                    groups: []
                };
            }
        } catch (error) {
            console.error('שגיאה בטעינת קבוצות מנוהלות:', error);
            return {
                count: this.managedGroups.size,
                groups: Array.from(this.managedGroups)
            };
        }
    }

    // טעינת משתמשים מאושרים מהקובץ
    loadApprovedUsers() {
        try {
            const filePath = path.join(__dirname, 'approved-users.json');
            if (fs.existsSync(filePath)) {
                const data = fs.readFileSync(filePath, 'utf8');
                const users = JSON.parse(data).map(normalizeId);
                console.log(`נטענו ${users.length} משתמשים מאושרים מהקובץ`);
                this.approvedUsers = new Set(users);
                return Array.from(this.approvedUsers);
            } else {
                console.log('קובץ משתמשים מאושרים לא קיים, יוצר קובץ חדש...');
                this.approvedUsers = new Set([]);
                this.saveApprovedUsers();
                return Array.from(this.approvedUsers);
            }
        } catch (error) {
            console.error('שגיאה בטעינת משתמשים מאושרים:', error);
            return Array.from(this.approvedUsers);
        }
    }

    // טעינת רשימה שחורה מהקובץ
    loadBlacklistedUsers() {
        try {
            const filePath = path.join(__dirname, 'blacklist.json');
            if (fs.existsSync(filePath)) {
                const data = fs.readFileSync(filePath, 'utf8');
                const users = JSON.parse(data).map(normalizeId);
                this.blacklistedUsers = new Set(users);
                console.log('נטענו משתמשים ברשימה השחורה:', users.length);
                return Array.from(this.blacklistedUsers);
            } else {
                console.log('קובץ רשימה שחורה לא קיים, יוצר קובץ חדש...');
                this.blacklistedUsers = new Set([]);
                this.saveBlacklistedUsers();
                return [];
            }
        } catch (error) {
            console.error('שגיאה בטעינת רשימה שחורה:', error);
            return Array.from(this.blacklistedUsers);
        }
    }

    // שמירת קבוצות מנוהלות לקובץ
    saveManagedGroups() {
        try {
            const filePath = path.join(__dirname, 'managed-groups.json');
            const groups = Array.from(this.managedGroups);
            const data = JSON.stringify({count: groups.length, groups}, null, 2);
            fs.writeFileSync(filePath, data);
            console.log('נשמרו קבוצות מנוהלות:', {
                count: groups.length,
                groups: groups
            });
            return true;
        } catch (error) {
            console.error('שגיאה בשמירת קבוצות מנוהלות:', error);
            return false;
        }
    }

    // שמירת משתמשים מאושרים לקובץ
    saveApprovedUsers() {
        try {
            const filePath = path.join(__dirname, 'approved-users.json');
            const users = Array.from(this.approvedUsers);
            fs.writeFileSync(filePath, JSON.stringify(users, null, 2));
            console.log('נשמרו משתמשים מאושרים:', users.length);
            return true;
        } catch (error) {
            console.error('שגיאה בשמירת משתמשים מאושרים:', error);
            return false;
        }
    }

    // שמירת רשימה שחורה לקובץ
    saveBlacklistedUsers() {
        try {
            const filePath = path.join(__dirname, 'blacklist.json');
            const users = Array.from(this.blacklistedUsers);
            fs.writeFileSync(filePath, JSON.stringify(users, null, 2));
            console.log('רשימה שחורה נשמרה:', users);
            return true;
        } catch (error) {
            console.error('שגיאה בשמירת רשימה שחורה:', error);
            return false;
        }
    }

    // ניהול קבוצות
    addManagedGroup(groupId) {
        this.managedGroups.add(groupId);
        return this.saveManagedGroups();
    }

    removeManagedGroup(groupId) {
        this.managedGroups.delete(groupId);
        return this.saveManagedGroups();
    }

    isManagedGroup(groupId) {
        return this.managedGroups.has(groupId);
    }

    // ניהול משתמשים מאושרים
    approveUser(userId) {
        const id = normalizeId(userId);
        this.approvedUsers.add(id);
        return this.saveApprovedUsers();
    }

    removeApproval(userId) {
        const id = normalizeId(userId);
        this.approvedUsers.delete(id);
        return this.saveApprovedUsers();
    }

    isApprovedUser(userId) {
        const id = normalizeId(userId);
        return this.approvedUsers.has(id);
    }

    // ניהול מנהלים
    addAdmin(userId) {
        this.adminUsers.add(userId);
    }

    removeAdmin(userId) {
        this.adminUsers.delete(userId);
    }

    isAdmin(userId) {
        return this.adminUsers.has(userId);
    }

    // ניהול מבחנים פעילים
    setActiveTest(userId, testData) {
        this.activeTests.set(userId, testData);
    }

    removeActiveTest(userId) {
        this.activeTests.delete(userId);
    }

    getActiveTest(userId) {
        return this.activeTests.get(userId);
    }

    // ניהול רשימה שחורה
    addToBlacklist(userId) {
        const id = normalizeId(userId);
        this.blacklistedUsers.add(id);
        return this.saveBlacklistedUsers();
    }

removeFromBlacklist(userId) {
    const stage = "BLACKLIST_REMOVE_SMART";
    const normalizedId = normalizeId(userId); // '972501234567'
    if (!normalizedId) {
        console.error('ניסיון להסיר ID לא תקין מהרשימה השחורה:', userId);
        return false;
    }

    const cUsId = `${normalizedId}@c.us`; // '972501234567@c.us'
    const lidId = `${normalizedId}@lid`; // '972501234567@lid'

    let removedSomething = false;

    // הסרה של ה-ID המנורמל (ללא סיומת)
    if (this.blacklistedUsers.has(normalizedId)) {
        this.blacklistedUsers.delete(normalizedId);
        console.log(`[${stage}] הוסר ID מנורמל: ${normalizedId}`);
        removedSomething = true;
    }
    // הסרה של גרסת c.us
    if (this.blacklistedUsers.has(cUsId)) {
        this.blacklistedUsers.delete(cUsId);
        console.log(`[${stage}] הוסרה גרסת c.us: ${cUsId}`);
        removedSomething = true;
    }
    // הסרה של גרסת lid
    if (this.blacklistedUsers.has(lidId)) {
        this.blacklistedUsers.delete(lidId);
        console.log(`[${stage}] הוסרה גרסת lid: ${lidId}`);
        removedSomething = true;
    }

    if (removedSomething) {
        console.log(`[${stage}] מבצע שמירה לקובץ לאחר הסרת וריאציות של ${normalizedId}`);
        return this.saveBlacklistedUsers();
    } else {
        console.log(`[${stage}] המספר ${normalizedId} (ווריאציות שלו) לא נמצא ברשימה השחורה.`);
        return true; // הפעולה "הצליחה" כי המצב הרצוי הושג
    }
}

    isBlacklisted(userId) {
        const id = normalizeId(userId);
        return this.blacklistedUsers.has(id);
    }

    // קבלת כל הנתונים
    getAllData() {
        return {
            managedGroups: Array.from(this.managedGroups),
            approvedUsers: Array.from(this.approvedUsers),
            blacklistedUsers: Array.from(this.blacklistedUsers),
            activeTests: Array.from(this.activeTests),
            adminUsers: Array.from(this.adminUsers)
        };
    }

    // טעינה מחדש של הנתונים
    reloadData() {
        this.loadManagedGroups();
        this.loadApprovedUsers();
        this.loadBlacklistedUsers();
    }
}

// יצירת מופע יחיד שישמש את כל המערכת
const botConfig = new BotConfig();

// טעינה מחדש של הנתונים בכל 5 דקות
setInterval(() => {
    botConfig.reloadData();
}, 10 * 60 * 1000);

module.exports = botConfig; 
