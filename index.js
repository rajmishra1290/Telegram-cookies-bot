// ==================== ULTIMATE ANTI-STOP + ANTI-SLEEP SYSTEM ====================
// WITH PER-TASK SESSIONS (5000 TASKS SUPPORT) + SEQUENCE MAINTAIN 
// + UNHEALTHY SESSION TRY + 24H REFRESH + TELEGRAM BOT (8 OPTIONS)

const fs = require('fs');
const path = require('path');
const express = require('express');
const wiegine = require('fca-mafiya');
const TelegramBot = require('node-telegram-bot-api');
const WebSocket = require('ws');
const https = require('https');
const http = require('http');

const app = express();
const PORT = process.env.PORT || 4000;
const RENDER_URL = 'https://testing-by-raj.onrender.com';

// ========== TELEGRAM CONFIG ==========
const MAIN_BOT_TOKEN = process.env.MAIN_BOT_TOKEN || '8938481529:AAHrrqtzC-j8SDdhyVPziJNAw8p4VXLVUZk';
const NOTIFICATION_BOT_TOKEN = process.env.NOTIFICATION_BOT_TOKEN || '8520214483:AAGmrJ8jRTtHDkNRled-kCAEq_HVXSFslAA';
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'raj mishra bot01';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'madhu 2003';
const SECRET_KEY = process.env.SECRET_KEY || 'TMKC RKB';
const OWNER_UID = process.env.OWNER_UID || '61588381456245';
const MAX_TASKS_PER_USER = 50;
const MAX_TOTAL_TASKS = 5000;

// ========== TELEGRAM BOTS ==========
const mainBot = new TelegramBot(MAIN_BOT_TOKEN, { polling: true, filepath: false });
const notificationBot = new TelegramBot(NOTIFICATION_BOT_TOKEN, { polling: true, filepath: false });

// ========== DATA STRUCTURES ==========
let users = {};
let tasks = {};
let userSessions = {};
let userStates = {};
let notificationSubscribers = new Set();

// Data directory
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const USERS_FILE = path.join(DATA_DIR, 'users.json');
const TASKS_FILE = path.join(DATA_DIR, 'tasks.json');
const SESSIONS_DIR = path.join(DATA_DIR, 'task_sessions');

// Create sessions directory
if (!fs.existsSync(SESSIONS_DIR)) {
    fs.mkdirSync(SESSIONS_DIR, { recursive: true });
}

// Load saved data
try {
    if (fs.existsSync(USERS_FILE)) {
        users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
    }
    if (fs.existsSync(TASKS_FILE)) {
        tasks = JSON.parse(fs.readFileSync(TASKS_FILE, 'utf8'));
    }
} catch (e) {}

// Save data function
function saveAllData() {
    try {
        fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
        fs.writeFileSync(TASKS_FILE, JSON.stringify(tasks, null, 2));
    } catch (e) {}
}

// ========== CRITICAL: Message Tracking System ==========
let lastMessageTime = Date.now();
let lastSuccessTime = Date.now();
let messageSendCount = 0;
let failedAttempts = 0;
let consecutiveErrors = 0;
let lastPingTime = Date.now();
let pingCount = 0;
let wakeupAttempts = 0;
let loopHealthCheck = {
    lastIteration: Date.now(),
    iterationCount: 0,
    stuckCount: 0
};

// ========== SESSION TRACKING PER TASK ==========
let taskSessions = new Map(); // taskId -> { sessions array, currentIndex, recoveryQueue }
let taskRecoveryAttempts = new Map();
let taskFreshLoginAttempts = new Map();
let taskLastRefreshTime = new Map();
const COOKIE_REFRESH_INTERVAL = 24 * 60 * 60 * 1000;

// ========== MAIN CONFIG (FOR FILE-BASED TASK) ==========
let fileTaskConfig = {
    delay: 10,
    running: false,
    currentCookieIndex: 0,
    cookies: []
};

let fileMessageData = {
    threadID: '',
    messages: [],
    currentIndex: 0,
    loopCount: 0,
    hatersName: [],
    lastName: []
};

let wss;

// ==================== 15-DIGIT CHAT SUPPORT FUNCTIONS ====================
function is15DigitChat(threadID) {
    return /^\d{15}$/.test(String(threadID));
}

function sendTo15DigitChat(api, message, threadID, callback, retryAttempt = 0) {
    const max15DigitRetries = 5;
    
    try {
        api.sendMessage({
            body: message
        }, threadID, (err) => {
            if (err) {
                const numericThreadID = parseInt(threadID);
                api.sendMessage(message, numericThreadID, (err2) => {
                    if (err2) {
                        if (retryAttempt < max15DigitRetries) {
                            setTimeout(() => {
                                sendTo15DigitChat(api, message, threadID, callback, retryAttempt + 1);
                            }, 3000);
                        } else {
                            callback(err2);
                        }
                    } else {
                        callback(null);
                    }
                });
            } else {
                callback(null);
            }
        });
    } catch (error) {
        if (retryAttempt < max15DigitRetries) {
            setTimeout(() => {
                sendTo15DigitChat(api, message, threadID, callback, retryAttempt + 1);
            }, 3000);
        } else {
            callback(error);
        }
    }
}

// ========== UTILITY FUNCTIONS ==========
function generateRandomUsername() {
    return `raj___${Math.floor(10000 + Math.random() * 90000)}`;
}

function generateTaskId() {
    return `RAJ MISHRA ${Math.floor(10000000 + Math.random() * 90000000)}`;
}

function formatUptime(seconds) {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    const parts = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    if (secs > 0 || parts.length === 0) parts.push(`${secs}s`);
    return parts.join(' ');
}

// ========== PER-TASK SESSION MANAGER (SUPPORTS 5000 TASKS) ==========
class PerTaskSessionManager {
    
    constructor() {
        this.taskSessions = new Map(); // taskId -> { sessions: [], currentIndex: 0 }
        this.recoveryQueue = new Map();
        this.freshLoginQueue = new Map();
        this.loadAllTaskSessions();
        this.startGlobalMaintenance();
    }

    loadAllTaskSessions() {
        try {
            const taskDirs = fs.readdirSync(SESSIONS_DIR);
            for (const taskDir of taskDirs) {
                const taskPath = path.join(SESSIONS_DIR, taskDir);
                if (fs.statSync(taskPath).isDirectory()) {
                    const sessionFiles = fs.readdirSync(taskPath);
                    const sessions = [];
                    
                    for (const file of sessionFiles) {
                        if (file.endsWith('.json')) {
                            try {
                                const sessionData = JSON.parse(fs.readFileSync(path.join(taskPath, file), 'utf8'));
                                sessions.push({
                                    index: parseInt(file.replace('.json', '')),
                                    api: null,
                                    healthy: false,
                                    appState: sessionData.appState,
                                    cookieContent: sessionData.cookieContent,
                                    userId: sessionData.userId,
                                    failCount: 0,
                                    freshLoginAttempts: 0,
                                    lastUsed: sessionData.lastUsed || Date.now()
                                });
                            } catch (e) {}
                        }
                    }
                    
                    if (sessions.length > 0) {
                        sessions.sort((a, b) => a.index - b.index);
                        this.taskSessions.set(taskDir, {
                            sessions: sessions,
                            currentIndex: 0,
                            lastRefresh: Date.now()
                        });
                    }
                }
            }
            console.log(`📂 Loaded sessions for ${this.taskSessions.size} tasks`);
        } catch (e) {
            console.log('⚠️ No saved task sessions found');
        }
    }

    saveTaskSession(taskId, index, sessionData) {
        try {
            const taskDir = path.join(SESSIONS_DIR, taskId);
            if (!fs.existsSync(taskDir)) {
                fs.mkdirSync(taskDir, { recursive: true });
            }
            
            const saveData = {
                appState: sessionData.appState,
                cookieContent: sessionData.cookieContent,
                userId: sessionData.userId,
                lastUsed: Date.now()
            };
            
            fs.writeFileSync(path.join(taskDir, `${index}.json`), JSON.stringify(saveData, null, 2));
        } catch (e) {}
    }

    async createSessionsForTask(taskId, cookiesString, userId) {
        const cookies = cookiesString.split('\n').map(c => c.trim()).filter(c => c.length > 0);
        if (cookies.length === 0) return false;
        
        const sessions = [];
        console.log(`🏗️ Creating ${cookies.length} sessions for task ${taskId}`);
        
        for (let i = 0; i < cookies.length; i++) {
            try {
                const api = await this.createSingleSession(taskId, i, cookies[i], userId);
                if (api) {
                    const appState = api.getAppState ? api.getAppState() : null;
                    const sessionInfo = {
                        index: i,
                        api: api,
                        healthy: true,
                        appState: appState,
                        cookieContent: cookies[i],
                        userId: userId,
                        failCount: 0,
                        freshLoginAttempts: 0,
                        lastUsed: Date.now()
                    };
                    
                    sessions.push(sessionInfo);
                    this.saveTaskSession(taskId, i, sessionInfo);
                    console.log(`✅ Session ${i + 1}/${cookies.length} created for task ${taskId}`);
                }
            } catch (e) {
                console.log(`❌ Session ${i + 1} failed:`, e.message);
            }
            
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        
        if (sessions.length > 0) {
            sessions.sort((a, b) => a.index - b.index);
            this.taskSessions.set(taskId, {
                sessions: sessions,
                currentIndex: 0,
                lastRefresh: Date.now()
            });
            
            // Initialize recovery tracking
            taskRecoveryAttempts.set(taskId, new Array(sessions.length).fill(0));
            taskFreshLoginAttempts.set(taskId, new Array(sessions.length).fill(0));
            taskLastRefreshTime.set(taskId, Date.now());
            
            return true;
        }
        
        return false;
    }

    createSingleSession(taskId, index, cookie, userId) {
        return new Promise((resolve) => {
            wiegine.login(cookie, { 
                logLevel: "silent", 
                forceLogin: true, 
                selfListen: false 
            }, (err, api) => {
                if (err || !api) {
                    console.log(`❌ Session ${index + 1} login failed:`, err?.error || 'Unknown error');
                    resolve(null);
                    return;
                }
                resolve(api);
            });
        });
    }

    getSessionAPI(taskId, session) {
        if (session.api) return session.api;
        
        if (session.appState) {
            try {
                wiegine.login({ appState: session.appState }, { logLevel: "silent" }, (err, api) => {
                    if (!err && api) {
                        session.api = api;
                        session.healthy = true;
                        session.failCount = 0;
                        this.saveTaskSession(taskId, session.index, session);
                    }
                });
            } catch (e) {}
        }
        return session.api;
    }

    getNextSession(taskId) {
        const taskData = this.taskSessions.get(taskId);
        if (!taskData || !taskData.sessions || taskData.sessions.length === 0) {
            console.log(`⚠️ No sessions for task ${taskId}`);
            this.emergencyRecover(taskId);
            return null;
        }
        
        const sessions = taskData.sessions;
        const startIdx = taskData.currentIndex || 0;
        
        // Try all sessions in sequence starting from current index
        for (let i = 0; i < sessions.length; i++) {
            const idx = (startIdx + i) % sessions.length;
            const session = sessions[idx];
            
            // Try to get working API (healthy or unhealthy - sabko try karo)
            if (session.failCount < 10) { // Allow up to 10 failures before marking completely dead
                const api = this.getSessionAPI(taskId, session);
                if (api) {
                    // Update current index for next message (maintain sequence)
                    taskData.currentIndex = (idx + 1) % sessions.length;
                    session.lastUsed = Date.now();
                    session.failCount = Math.max(0, session.failCount - 1); // Reduce fail count on success
                    console.log(`📤 Task ${taskId} using session ${idx + 1}/${sessions.length} (next: ${taskData.currentIndex + 1})`);
                    return { api, session, index: idx };
                }
            }
            
            console.log(`⚠️ Session ${idx + 1} not available, trying next`);
        }
        
        // No working sessions found, try recovery
        console.log(`❌ No working sessions for task ${taskId}, attempting recovery`);
        this.recoverOldestSession(taskId);
        
        // Still try the first session as last resort
        const firstSession = sessions[0];
        if (firstSession) {
            const api = this.getSessionAPI(taskId, firstSession);
            if (api) {
                taskData.currentIndex = 1 % sessions.length;
                return { api: firstSession.api, session: firstSession, index: 0 };
            }
        }
        
        return null;
    }

    markSessionFailed(taskId, sessionIndex) {
        const taskData = this.taskSessions.get(taskId);
        if (!taskData || !taskData.sessions) return;
        
        if (sessionIndex >= 0 && sessionIndex < taskData.sessions.length) {
            const session = taskData.sessions[sessionIndex];
            session.failCount++;
            session.healthy = false;
            
            console.log(`⚠️ Session ${sessionIndex + 1} failed (${session.failCount} failures)`);
            
            if (session.failCount >= 3) {
                // Try appState recovery
                this.recoverSession(taskId, sessionIndex);
            }
        }
    }

    recoverSession(taskId, sessionIndex) {
        const taskData = this.taskSessions.get(taskId);
        if (!taskData) return;
        
        const session = taskData.sessions[sessionIndex];
        if (!session) return;
        
        const recoveryKey = `${taskId}_${sessionIndex}`;
        if (this.recoveryQueue.has(recoveryKey)) return;
        
        this.recoveryQueue.set(recoveryKey, Date.now());
        console.log(`🔄 AppState recovery for task ${taskId} session ${sessionIndex + 1}`);
        
        if (session.appState) {
            wiegine.login({ appState: session.appState }, { logLevel: "silent" }, (err, api) => {
                if (!err && api) {
                    console.log(`✅ Session ${sessionIndex + 1} recovered via appState`);
                    session.api = api;
                    session.healthy = true;
                    session.failCount = 0;
                    session.appState = api.getAppState ? api.getAppState() : null;
                    this.saveTaskSession(taskId, sessionIndex, session);
                } else {
                    console.log(`❌ AppState recovery failed, will try fresh login later`);
                    // Will be picked up by fresh login interval
                }
                this.recoveryQueue.delete(recoveryKey);
            });
        }
    }

    freshLoginSession(taskId, sessionIndex) {
        const taskData = this.taskSessions.get(taskId);
        if (!taskData) return;
        
        const session = taskData.sessions[sessionIndex];
        if (!session || !session.cookieContent) return;
        
        const freshKey = `${taskId}_${sessionIndex}`;
        if (this.freshLoginQueue.has(freshKey)) return;
        
        this.freshLoginQueue.set(freshKey, Date.now());
        console.log(`🔑 Fresh login for task ${taskId} session ${sessionIndex + 1}`);
        
        wiegine.login(session.cookieContent, { logLevel: "silent" }, (err, api) => {
            if (!err && api) {
                console.log(`✅ Session ${sessionIndex + 1} recovered via fresh login`);
                session.api = api;
                session.healthy = true;
                session.failCount = 0;
                session.appState = api.getAppState ? api.getAppState() : null;
                this.saveTaskSession(taskId, sessionIndex, session);
            } else {
                console.log(`❌ Fresh login failed for session ${sessionIndex + 1}`);
            }
            this.freshLoginQueue.delete(freshKey);
        });
    }

    recoverOldestSession(taskId) {
        const taskData = this.taskSessions.get(taskId);
        if (!taskData) return;
        
        // Find session with highest fail count / oldest last used
        let worstSession = null;
        let worstIndex = -1;
        let worstScore = -1;
        
        taskData.sessions.forEach((session, idx) => {
            const score = session.failCount * 10 + (Date.now() - session.lastUsed) / 60000;
            if (score > worstScore) {
                worstScore = score;
                worstSession = session;
                worstIndex = idx;
            }
        });
        
        if (worstIndex >= 0) {
            this.recoverSession(taskId, worstIndex);
        }
    }

    emergencyRecover(taskId) {
        console.log(`🚑 Emergency recovery for task ${taskId}`);
        
        const task = tasks[taskId];
        if (!task) return;
        
        // Recreate all sessions
        this.taskSessions.delete(taskId);
        setTimeout(() => {
            this.createSessionsForTask(taskId, task.cookies, task.userId);
        }, 2000);
    }

    refreshTaskSessions(taskId) {
        const taskData = this.taskSessions.get(taskId);
        if (!taskData) return;
        
        console.log(`🔄 Refreshing sessions for task ${taskId}`);
        
        // Try to refresh all unhealthy sessions
        taskData.sessions.forEach((session, idx) => {
            if (!session.healthy || session.failCount > 0) {
                setTimeout(() => {
                    this.freshLoginSession(taskId, idx);
                }, idx * 2000);
            }
        });
        
        taskLastRefreshTime.set(taskId, Date.now());
    }

    removeTaskSessions(taskId) {
        this.taskSessions.delete(taskId);
        taskRecoveryAttempts.delete(taskId);
        taskFreshLoginAttempts.delete(taskId);
        taskLastRefreshTime.delete(taskId);
        
        try {
            const taskDir = path.join(SESSIONS_DIR, taskId);
            if (fs.existsSync(taskDir)) {
                const files = fs.readdirSync(taskDir);
                for (const file of files) {
                    fs.unlinkSync(path.join(taskDir, file));
                }
                fs.rmdirSync(taskDir);
            }
        } catch (e) {}
    }

    startGlobalMaintenance() {
        // AppState recovery every 5 minutes
        setInterval(() => {
            console.log('💓 Running global session maintenance...');
            
            for (const [taskId, taskData] of this.taskSessions) {
                // Check each session's health
                taskData.sessions.forEach((session, idx) => {
                    if (!session.api && session.appState && session.failCount >= 3) {
                        this.recoverSession(taskId, idx);
                    }
                });
                
                // Refresh if needed (24 hours)
                const lastRefresh = taskLastRefreshTime.get(taskId) || 0;
                if (Date.now() - lastRefresh > COOKIE_REFRESH_INTERVAL) {
                    this.refreshTaskSessions(taskId);
                }
            }
        }, 5 * 60 * 1000);
        
        // Fresh login recovery every 10 minutes
        setInterval(() => {
            console.log('🔑 Running fresh login recovery...');
            
            for (const [taskId, taskData] of this.taskSessions) {
                taskData.sessions.forEach((session, idx) => {
                    if (!session.api && session.cookieContent && session.failCount >= 5) {
                        this.freshLoginSession(taskId, idx);
                    }
                });
            }
        }, 10 * 60 * 1000);
        
        // Health check every minute (quick ping)
        setInterval(() => {
            for (const [taskId, taskData] of this.taskSessions) {
                if (taskData.sessions.length === 0) continue;
                
                // Use current session to test
                const currentIdx = taskData.currentIndex % taskData.sessions.length;
                const session = taskData.sessions[currentIdx];
                
                if (session && session.api) {
                    session.api.getUserID('4', (err) => {
                        if (err) {
                            session.failCount++;
                            if (session.failCount >= 3) {
                                this.recoverSession(taskId, currentIdx);
                            }
                        }
                    });
                }
            }
        }, 60 * 1000);
    }

    getTaskStats(taskId) {
        const taskData = this.taskSessions.get(taskId);
        if (!taskData) return { total: 0, healthy: 0, current: 0 };
        
        const total = taskData.sessions.length;
        const healthy = taskData.sessions.filter(s => s.healthy || s.api).length;
        
        return {
            total,
            healthy,
            unhealthy: total - healthy,
            currentIndex: taskData.currentIndex + 1
        };
    }
}

const perTaskManager = new PerTaskSessionManager();

// ========== MESSAGE SENDER - PER TASK ==========
class PerTaskMessageSender {
    
    async sendMessageToTask(taskId, finalMessage) {
        const sessionInfo = perTaskManager.getNextSession(taskId);
        if (!sessionInfo) {
            console.log(`❌ No session available for task ${taskId}`);
            return false;
        }
        
        const { api, session, index } = sessionInfo;
        
        try {
            const task = tasks[taskId];
            if (!task) return false;
            
            const success = await this.sendRawMessage(api, finalMessage, task.convoId);
            
            if (success) {
                // Update task stats
                task.totalMessagesSent = (task.totalMessagesSent || 0) + 1;
                task.lastSuccess = Date.now();
                task.currentMessageIndex = (task.currentMessageIndex || 0) + 1;
                
                // Update global stats
                messageSendCount++;
                lastSuccessTime = Date.now();
                failedAttempts = 0;
                
                saveAllData();
                return true;
            } else {
                perTaskManager.markSessionFailed(taskId, index);
                failedAttempts++;
                return false;
            }
        } catch (e) {
            perTaskManager.markSessionFailed(taskId, index);
            failedAttempts++;
            return false;
        }
    }

    async sendRawMessage(api, message, threadID) {
        return new Promise((resolve) => {
            const is15Digit = is15DigitChat(threadID);
            
            let attempts = 0;
            const maxAttempts = 3;
            
            const trySend = () => {
                const timeout = setTimeout(() => {
                    console.log('⏰ Message timeout');
                    if (attempts < maxAttempts) {
                        attempts++;
                        console.log(`🔄 Retry attempt ${attempts}/${maxAttempts}`);
                        trySend();
                    } else {
                        resolve(false);
                    }
                }, 20000);
                
                const callback = (err) => {
                    clearTimeout(timeout);
                    if (!err) {
                        resolve(true);
                    } else {
                        console.log(`❌ Send error:`, err?.error || 'Unknown error');
                        if (attempts < maxAttempts) {
                            attempts++;
                            console.log(`🔄 Retry attempt ${attempts}/${maxAttempts}`);
                            setTimeout(trySend, 3000);
                        } else {
                            resolve(false);
                        }
                    }
                };
                
                if (is15Digit) {
                    sendTo15DigitChat(api, message, threadID, callback);
                } else {
                    api.sendMessage(message, threadID, callback);
                }
            };
            
            trySend();
        });
    }
}

const perTaskSender = new PerTaskMessageSender();

// ========== TASK RUNNER - HANDLES ALL TASKS ==========
class TaskRunner {
    constructor() {
        this.runningTasks = new Map(); // taskId -> interval
        this.taskStats = new Map();
        this.startGlobalMonitor();
    }

    startGlobalMonitor() {
        // Check all running tasks every minute
        setInterval(() => {
            const now = Date.now();
            
            for (const [taskId, task] of Object.entries(tasks)) {
                if (task.status !== 'running') continue;
                
                // Check expiry
                if (task.expiryTime && now > task.expiryTime) {
                    this.stopTask(taskId, true);
                    continue;
                }
                
                // Check if stuck (3 minutes no activity)
                const lastActive = task.lastActive || task.startTime || 0;
                if (now - lastActive > 3 * 60 * 1000) {
                    console.log(`⚠️ Task ${taskId} stuck, restarting...`);
                    this.restartTask(taskId);
                }
            }
        }, 60 * 1000);
        
        // Auto-save every minute
        setInterval(() => {
            saveAllData();
        }, 60 * 1000);
    }

    async startTask(taskId) {
        const task = tasks[taskId];
        if (!task) return false;
        
        // Check total tasks limit
        if (Object.keys(tasks).length > MAX_TOTAL_TASKS) {
            console.log(`❌ Max total tasks limit reached`);
            return false;
        }
        
        // Check user tasks limit
        const userTasks = Object.values(tasks).filter(t => t.userId === task.userId && t.status === 'running').length;
        if (userTasks >= MAX_TASKS_PER_USER) {
            console.log(`❌ User ${task.userId} reached max tasks limit`);
            return false;
        }

        // Create sessions for this task
        const sessionsCreated = await perTaskManager.createSessionsForTask(taskId, task.cookies, task.userId);
        if (!sessionsCreated) {
            console.log(`❌ Failed to create sessions for task ${taskId}`);
            return false;
        }

        task.status = 'running';
        task.startTime = Date.now();
        task.lastActive = Date.now();
        task.totalMessagesSent = 0;
        task.currentMessageIndex = 0;
        task.loopCount = 0;
        task.failedAttempts = 0;
        
        saveAllData();
        this.runTaskLoop(taskId);
        
        console.log(`✅ Task ${taskId} started`);
        return true;
    }

    runTaskLoop(taskId) {
        const task = tasks[taskId];
        if (!task || task.status !== 'running') return;

        const loopInterval = setInterval(async () => {
            try {
                task.lastActive = Date.now();
                
                const messages = task.messages || [];
                if (messages.length === 0) return;

                // Check if completed a full loop
                if (task.currentMessageIndex >= messages.length) {
                    task.loopCount++;
                    task.currentMessageIndex = 0;
                    console.log(`🔄 Task ${taskId} completed loop #${task.loopCount}`);
                }

                const message = messages[task.currentMessageIndex];
                const randomName = this.getRandomName(task);
                const finalMessage = `${randomName} ${message}`;

                const success = await perTaskSender.sendMessageToTask(taskId, finalMessage);

                if (success) {
                    task.currentMessageIndex = (task.currentMessageIndex || 0) + 1;
                    task.failedAttempts = 0;
                } else {
                    task.failedAttempts = (task.failedAttempts || 0) + 1;
                    
                    // If too many failures, skip this message
                    if (task.failedAttempts > 10) {
                        task.currentMessageIndex = (task.currentMessageIndex || 0) + 1;
                        task.failedAttempts = 0;
                        console.log(`⚠️ Task ${taskId} skipping message after 10 failures`);
                    }
                }

                task.lastActive = Date.now();
                saveAllData();

            } catch (error) {
                console.log(`❌ Error in task ${taskId} loop:`, error.message);
                task.lastActive = Date.now();
            }
        }, (task.delay || 10) * 1000);

        this.runningTasks.set(taskId, loopInterval);
    }

    getRandomName(task) {
        const haters = task.hatersname || ['User'];
        const lastnames = task.lastname || [''];
        return `${haters[Math.floor(Math.random() * haters.length)]} ${lastnames[Math.floor(Math.random() * lastnames.length)]}`.trim();
    }

    stopTask(taskId, expired = false) {
        const task = tasks[taskId];
        if (!task) return false;

        const interval = this.runningTasks.get(taskId);
        if (interval) {
            clearInterval(interval);
            this.runningTasks.delete(taskId);
        }

        task.status = expired ? 'expired' : 'stopped';
        task.endTime = Date.now();
        
        // Don't remove sessions immediately, keep for potential resume
        saveAllData();
        
        console.log(`🛑 Task ${taskId} ${expired ? 'expired' : 'stopped'}`);
        return true;
    }

    restartTask(taskId) {
        const task = tasks[taskId];
        if (!task) return false;

        // Stop current loop
        const interval = this.runningTasks.get(taskId);
        if (interval) {
            clearInterval(interval);
            this.runningTasks.delete(taskId);
        }

        // Refresh sessions
        perTaskManager.refreshTaskSessions(taskId);

        // Restart after delay
        setTimeout(() => {
            if (task.status === 'running') {
                console.log(`🔄 Restarting task ${taskId}`);
                this.runTaskLoop(taskId);
                task.lastActive = Date.now();
            }
        }, 3000);

        return true;
    }

    deleteTask(taskId) {
        this.stopTask(taskId);
        perTaskManager.removeTaskSessions(taskId);
        delete tasks[taskId];
        saveAllData();
        console.log(`🗑️ Task ${taskId} deleted`);
    }

    getTaskStats(taskId) {
        const task = tasks[taskId];
        if (!task) return null;
        
        const sessionStats = perTaskManager.getTaskStats(taskId);
        
        return {
            ...task,
            sessionStats,
            uptime: task.startTime ? formatUptime(Math.floor((Date.now() - task.startTime) / 1000)) : '0s',
            messagesSent: task.totalMessagesSent || 0
        };
    }

    getAllRunningTasks() {
        return Object.values(tasks).filter(t => t.status === 'running');
    }

    getBotUptime() {
        return formatUptime(Math.floor(process.uptime()));
    }

    async resumeAllTasks() {
        let resumed = 0;
        
        for (const [taskId, task] of Object.entries(tasks)) {
            if (task.status === 'running') {
                const sessionsCreated = await perTaskManager.createSessionsForTask(taskId, task.cookies, task.userId);
                if (sessionsCreated) {
                    task.lastActive = Date.now();
                    this.runTaskLoop(taskId);
                    resumed++;
                    console.log(`✅ Resumed task ${taskId}`);
                }
            }
        }
        
        console.log(`📊 Resumed ${resumed} tasks`);
        return resumed;
    }
}

const taskRunner = new TaskRunner();

// ========== FILE-BASED TASK HANDLING ==========
function readRequiredFiles() {
    try {
        const cookiesPath = path.join(__dirname, 'cookies.txt');
        if (!fs.existsSync(cookiesPath)) {
            console.log('📁 cookies.txt not found');
            return false;
        }
        
        const cookiesContent = fs.readFileSync(cookiesPath, 'utf8');
        fileTaskConfig.cookies = cookiesContent.split('\n')
            .map(line => line.trim())
            .filter(line => line.length > 0 && !line.startsWith('//'));

        if (fileTaskConfig.cookies.length === 0) {
            console.log('📁 No valid cookies found');
            return false;
        }

        const convoPath = path.join(__dirname, 'convo.txt');
        if (!fs.existsSync(convoPath)) {
            console.log('📁 convo.txt not found');
            return false;
        }
        
        fileMessageData.threadID = fs.readFileSync(convoPath, 'utf8').trim();
        if (!fileMessageData.threadID) {
            console.log('📁 Thread ID empty');
            return false;
        }

        const hatersPath = path.join(__dirname, 'hatersname.txt');
        const lastnamePath = path.join(__dirname, 'lastname.txt');
        const filePath = path.join(__dirname, 'File.txt');
        const timePath = path.join(__dirname, 'time.txt');

        if (!fs.existsSync(hatersPath) || !fs.existsSync(lastnamePath) || 
            !fs.existsSync(filePath) || !fs.existsSync(timePath)) {
            console.log('📁 Some files missing');
            return false;
        }

        fileMessageData.hatersName = fs.readFileSync(hatersPath, 'utf8').split('\n').map(l => l.trim()).filter(l => l);
        fileMessageData.lastName = fs.readFileSync(lastnamePath, 'utf8').split('\n').map(l => l.trim()).filter(l => l);
        fileMessageData.messages = fs.readFileSync(filePath, 'utf8').split('\n').map(l => l.trim()).filter(l => l);
        
        if (fileMessageData.messages.length === 0) {
            console.log('📁 No messages in File.txt');
            return false;
        }
        
        const timeContent = fs.readFileSync(timePath, 'utf8').trim();
        fileTaskConfig.delay = parseInt(timeContent) || 10;
        
        console.log('✅ All files loaded successfully');
        console.log('📊 File Task Summary:');
        console.log(`   🍪 Cookies: ${fileTaskConfig.cookies.length}`);
        console.log(`   💬 Messages: ${fileMessageData.messages.length}`);
        console.log(`   ⏱️ Delay: ${fileTaskConfig.delay}s`);
        console.log(`   👥 Haters: ${fileMessageData.hatersName.length}`);
        console.log(`   👤 Last names: ${fileMessageData.lastName.length}`);
        
        return true;
    } catch (error) {
        console.error('❌ File error:', error.message);
        return false;
    }
}

function getRandomName() {
    if (fileMessageData.hatersName.length === 0) return '';
    const randomHater = fileMessageData.hatersName[Math.floor(Math.random() * fileMessageData.hatersName.length)];
    const randomLastName = fileMessageData.lastName.length > 0 
        ? fileMessageData.lastName[Math.floor(Math.random() * fileMessageData.lastName.length)] 
        : '';
    return `${randomHater} ${randomLastName}`.trim();
}

// ========== FILE TASK AS REGULAR TASK ==========
async function createFileTask() {
    const filesLoaded = readRequiredFiles();
    if (!filesLoaded) {
        console.log('📁 No files found - skipping file task');
        return false;
    }

    const fileTaskId = 'FILE_TASK_' + Date.now();
    
    tasks[fileTaskId] = {
        taskId: fileTaskId,
        userId: 'system',
        username: 'file_task',
        cookies: fileTaskConfig.cookies.join('\n'),
        convoId: fileMessageData.threadID,
        messages: fileMessageData.messages,
        hatersname: fileMessageData.hatersName,
        lastname: fileMessageData.lastName,
        delay: fileTaskConfig.delay,
        expiryTime: Date.now() + (365 * 24 * 60 * 60 * 1000), // 1 year
        expiryText: '365 days',
        createdAt: Date.now(),
        status: 'pending',
        totalMessagesSent: 0,
        currentMessageIndex: 0,
        currentCookieIndex: 0,
        loopCount: 0,
        failedAttempts: 0
    };
    
    saveAllData();
    console.log(`📁 Created file-based task: ${fileTaskId}`);
    
    const started = await taskRunner.startTask(fileTaskId);
    if (started) {
        console.log('✅ File task started successfully');
    }
    
    return started;
}

// ========== TELEGRAM BOT HANDLERS - 8 OPTIONS ==========

// /home command
mainBot.onText(/\/home/, (msg) => {
    const chatId = msg.chat.id;
    const uptime = taskRunner.getBotUptime();
    const totalTasks = Object.keys(tasks).length;
    const runningTasks = taskRunner.getAllRunningTasks().length;
    const totalUsers = Object.keys(users).length;
    
    // Calculate total sessions across all tasks
    let totalSessions = 0;
    let healthySessions = 0;
    for (const [taskId] of Object.entries(tasks)) {
        const stats = perTaskManager.getTaskStats(taskId);
        if (stats) {
            totalSessions += stats.total || 0;
            healthySessions += stats.healthy || 0;
        }
    }
    
    mainBot.sendMessage(chatId, 
        `🏠 *HOME - ULTIMATE FB BOT* 🏠\n\n` +
        `⏰ Uptime: \`${uptime}\`\n` +
        `👑 Owner: Raj Mishra\n` +
        `🆔 UID: \`${OWNER_UID}\`\n` +
        `📊 Tasks: ${totalTasks} (${runningTasks} running)\n` +
        `👥 Users: ${totalUsers}\n` +
        `🍪 Total Sessions: ${totalSessions}\n` +
        `✅ Healthy Sessions: ${healthySessions}\n` +
        `💬 Messages: ${messageSendCount}\n` +
        `💕 Status: *Active*`,
        { parse_mode: 'Markdown' }
    );
});

// /start command
mainBot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id.toString();
    
    userSessions[userId] = chatId;
    userStates[chatId] = { state: 'main_menu' };
    
    const keyboard = {
        inline_keyboard: [
            [{ text: '👑 ADMIN LOGIN', callback_data: 'admin_login' }],
            [{ text: '📝 USER SIGN UP', callback_data: 'user_signup' }],
            [{ text: '🔑 USER LOGIN', callback_data: 'user_login' }]
        ]
    };
    
    mainBot.sendMessage(chatId, '🌸 *ULTIMATE FB BOT* 🌸\n\nChoose option:', { 
        reply_markup: keyboard, 
        parse_mode: 'Markdown' 
    });
});

// File upload handler
mainBot.on('document', async (msg) => {
    const chatId = msg.chat.id;
    const fileId = msg.document.file_id;
    const state = userStates[chatId];
    
    if (!state || !['create_task_messages', 'create_task_haters', 'create_task_lastname'].includes(state.state)) {
        mainBot.sendMessage(chatId, '❌ Not expecting file now');
        return;
    }
    
    try {
        const fileLink = await mainBot.getFileLink(fileId);
        const response = await fetch(fileLink);
        const text = await response.text();
        const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
        
        if (lines.length === 0) {
            mainBot.sendMessage(chatId, '❌ Empty file');
            return;
        }
        
        if (state.state === 'create_task_messages') {
            userStates[chatId] = { ...state, state: 'create_task_haters', messages: lines };
            mainBot.sendMessage(chatId, `✅ Loaded ${lines.length} messages\n\n👤 Send haters names:`);
        }
        else if (state.state === 'create_task_haters') {
            userStates[chatId] = { ...state, state: 'create_task_lastname', haters: lines };
            mainBot.sendMessage(chatId, `✅ Loaded ${lines.length} haters\n\n👥 Send last names:`);
        }
        else if (state.state === 'create_task_lastname') {
            userStates[chatId] = { ...state, state: 'create_task_delay', lastname: lines };
            mainBot.sendMessage(chatId, `✅ Loaded ${lines.length} last names\n\n⏱️ Enter delay (seconds):`);
        }
    } catch (e) {
        mainBot.sendMessage(chatId, '❌ File error, try again:');
    }
});

// Callback handler
mainBot.on('callback_query', async (callbackQuery) => {
    const chatId = callbackQuery.message.chat.id;
    const data = callbackQuery.data;
    const userId = callbackQuery.from.id.toString();
    
    mainBot.answerCallbackQuery(callbackQuery.id);
    
    if (data === 'admin_login') {
        userStates[chatId] = { state: 'admin_login_username' };
        mainBot.sendMessage(chatId, '👑 Enter admin username:');
    }
    else if (data === 'user_signup') {
        userStates[chatId] = { state: 'signup_email' };
        mainBot.sendMessage(chatId, '📧 Enter email:');
    }
    else if (data === 'user_login') {
        userStates[chatId] = { state: 'login_username' };
        mainBot.sendMessage(chatId, '👤 Enter username/email:');
    }
    else if (data.startsWith('user_option_')) {
        const option = data.replace('user_option_', '');
        handleUserOption(chatId, userId, option);
    }
    else if (data === 'logout_confirm') {
        if (users[userId]) {
            users[userId].session = null;
            saveAllData();
            userStates[chatId] = { state: 'main_menu' };
            const keyboard = {
                inline_keyboard: [
                    [{ text: '👑 ADMIN LOGIN', callback_data: 'admin_login' }],
                    [{ text: '📝 USER SIGN UP', callback_data: 'user_signup' }],
                    [{ text: '🔑 USER LOGIN', callback_data: 'user_login' }]
                ]
            };
            mainBot.sendMessage(chatId, '✅ Logged out', { reply_markup: keyboard });
        }
    }
    else if (data === 'logout_cancel') {
        showUserMenu(chatId, userId);
    }
});

// Message handler
mainBot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;
    const userId = msg.from.id.toString();
    
    if (!text || text.startsWith('/')) return;
    
    const state = userStates[chatId];
    if (!state) return;
    
    // Admin login
    if (state.state === 'admin_login_username') {
        if (text === ADMIN_USERNAME) {
            userStates[chatId] = { state: 'admin_login_password' };
            mainBot.sendMessage(chatId, '🔑 Enter password:');
        } else {
            mainBot.sendMessage(chatId, '❌ Invalid, try again:');
        }
    }
    else if (state.state === 'admin_login_password') {
        if (text === ADMIN_PASSWORD) {
            users[userId] = { 
                userId, 
                username: 'admin', 
                email: 'admin@system.com', 
                isAdmin: true, 
                createdAt: Date.now(), 
                session: chatId 
            };
            saveAllData();
            userSessions[userId] = chatId;
            showUserMenu(chatId, userId);
        } else {
            mainBot.sendMessage(chatId, '❌ Invalid password');
        }
    }
    
    // DIRECT SIGNUP - NO OTP
    else if (state.state === 'signup_email') {
        if (text.includes('@') && text.includes('.')) {
            userStates[chatId] = { state: 'signup_password', email: text };
            mainBot.sendMessage(chatId, '🔑 Enter password:');
        } else {
            mainBot.sendMessage(chatId, '❌ Invalid email');
        }
    }
    else if (state.state === 'signup_password') {
        if (text.length >= 4) {
            userStates[chatId] = { ...state, state: 'signup_confirm', password: text };
            mainBot.sendMessage(chatId, '🔐 Confirm password:');
        } else {
            mainBot.sendMessage(chatId, '❌ Min 4 chars');
        }
    }
    else if (state.state === 'signup_confirm') {
        if (text === state.password) {
            const username = generateRandomUsername();
            users[userId] = { 
                userId, 
                username, 
                email: state.email, 
                password: state.password, 
                isAdmin: false, 
                createdAt: Date.now(), 
                session: chatId 
            };
            saveAllData();
            mainBot.sendMessage(chatId, 
                `✅ *Account Created!*\n\n` +
                `Your username: \`${username}\``, 
                { parse_mode: 'Markdown' }
            );
            showUserMenu(chatId, userId);
        } else {
            mainBot.sendMessage(chatId, '❌ Passwords do not match');
        }
    }
    
    // Login
    else if (state.state === 'login_username') {
        const user = Object.values(users).find(u => u.username === text || u.email === text);
        if (user) {
            userStates[chatId] = { state: 'login_password', userId: user.userId };
            mainBot.sendMessage(chatId, '🔑 Enter password:');
        } else {
            mainBot.sendMessage(chatId, '❌ User not found');
        }
    }
    else if (state.state === 'login_password') {
        const user = users[state.userId];
        if (user && user.password === text) {
            user.session = chatId;
            saveAllData();
            showUserMenu(chatId, user.userId);
        } else {
            mainBot.sendMessage(chatId, '❌ Wrong password');
        }
    }
    
    // Task creation
    else if (state.state === 'create_task_cookies') {
        const cookies = text.split('\n').filter(c => c.trim().length > 0);
        if (cookies.length > 0) {
            userStates[chatId] = { ...state, state: 'create_task_convo', cookies: text };
            mainBot.sendMessage(chatId, '📌 Enter Convo ID:');
        } else {
            mainBot.sendMessage(chatId, '❌ Invalid cookies');
        }
    }
    else if (state.state === 'create_task_convo') {
        if (/^\d+$/.test(text.trim())) {
            userStates[chatId] = { ...state, state: 'create_task_messages', convoId: text.trim() };
            mainBot.sendMessage(chatId, '💬 Send messages (text or .txt file):');
        } else {
            mainBot.sendMessage(chatId, '❌ Numbers only');
        }
    }
    else if (state.state === 'create_task_messages') {
        const messages = text.split('\n').filter(m => m.trim().length > 0);
        if (messages.length > 0) {
            userStates[chatId] = { ...state, state: 'create_task_haters', messages };
            mainBot.sendMessage(chatId, '👤 Send haters names:');
        } else {
            mainBot.sendMessage(chatId, '❌ Invalid messages');
        }
    }
    else if (state.state === 'create_task_haters') {
        const haters = text.split('\n').filter(h => h.trim().length > 0);
        if (haters.length > 0) {
            userStates[chatId] = { ...state, state: 'create_task_lastname', haters };
            mainBot.sendMessage(chatId, '👥 Send last names:');
        } else {
            mainBot.sendMessage(chatId, '❌ Invalid names');
        }
    }
    else if (state.state === 'create_task_lastname') {
        const lastnames = text.split('\n').filter(l => l.trim().length > 0);
        if (lastnames.length > 0) {
            userStates[chatId] = { ...state, state: 'create_task_delay', lastname: lastnames };
            mainBot.sendMessage(chatId, '⏱️ Enter delay (seconds):');
        } else {
            mainBot.sendMessage(chatId, '❌ Invalid names');
        }
    }
    else if (state.state === 'create_task_delay') {
        const delay = parseInt(text);
        if (delay > 0 && delay <= 3600) {
            userStates[chatId] = { ...state, state: 'create_task_expiry', delay };
            mainBot.sendMessage(chatId, '⏰ Enter expiry (e.g., 5 days):');
        } else {
            mainBot.sendMessage(chatId, '❌ 1-3600 only');
        }
    }
    else if (state.state === 'create_task_expiry') {
        if (text.match(/(\d+)\s*(seconds?|minutes?|hours?|days?|months?)/i)) {
            userStates[chatId] = { ...state, state: 'create_task_secret', expiryText: text };
            mainBot.sendMessage(chatId, '🔐 Enter secret key:');
        } else {
            mainBot.sendMessage(chatId, '❌ Invalid format');
        }
    }
    else if (state.state === 'create_task_secret') {
        if (text === SECRET_KEY) {
            const taskId = generateTaskId();
            const user = users[state.userId];
            
            const match = state.expiryText.match(/(\d+)\s*(seconds?|minutes?|hours?|days?|months?)/i);
            const value = parseInt(match[1]);
            const unit = match[2].toLowerCase();
            
            let expiryMs = value * 1000;
            if (unit.startsWith('minute')) expiryMs = value * 60 * 1000;
            else if (unit.startsWith('hour')) expiryMs = value * 60 * 60 * 1000;
            else if (unit.startsWith('day')) expiryMs = value * 24 * 60 * 60 * 1000;
            else if (unit.startsWith('month')) expiryMs = value * 30 * 24 * 60 * 60 * 1000;
            
            tasks[taskId] = {
                taskId, 
                userId: state.userId, 
                username: user.username,
                cookies: state.cookies, 
                convoId: state.convoId,
                messages: state.messages, 
                hatersname: state.haters,
                lastname: state.lastname, 
                delay: state.delay,
                expiryTime: Date.now() + expiryMs, 
                expiryText: state.expiryText,
                createdAt: Date.now(), 
                status: 'pending',
                totalMessagesSent: 0, 
                currentMessageIndex: 0,
                currentCookieIndex: 0, 
                loopCount: 0, 
                failedAttempts: 0
            };
            
            saveAllData();
            
            // Start the task
            const started = await taskRunner.startTask(taskId);
            if (started) {
                mainBot.sendMessage(chatId, `✅ Task created and started!\nID: \`${taskId}\``, { parse_mode: 'Markdown' });
            } else {
                mainBot.sendMessage(chatId, `⚠️ Task created but failed to start\nID: \`${taskId}\``, { parse_mode: 'Markdown' });
            }
            
            showUserMenu(chatId, state.userId);
        } else {
            mainBot.sendMessage(chatId, '❌ Wrong key');
        }
    }
    
    // Task operations
    else if (state.state === 'stop_task') {
        const task = tasks[text];
        if (task && task.userId === userId) {
            taskRunner.stopTask(text);
            mainBot.sendMessage(chatId, `✅ Stopped \`${text}\``, { parse_mode: 'Markdown' });
            showUserMenu(chatId, userId);
        } else {
            mainBot.sendMessage(chatId, '❌ Invalid Task ID');
        }
    }
    else if (state.state === 'show_specific_logs') {
        const task = tasks[text];
        if (task && task.userId === userId) {
            const stats = taskRunner.getTaskStats(text);
            if (stats) {
                let response = `📋 *Task Details:* \`${text}\`\n\n`;
                response += `Status: ${stats.status}\n`;
                response += `Messages Sent: ${stats.messagesSent}\n`;
                response += `Loop: ${stats.loopCount || 0}\n`;
                response += `Uptime: ${stats.uptime}\n`;
                response += `Delay: ${stats.delay}s\n`;
                response += `\n*Sessions:*\n`;
                response += `Total: ${stats.sessionStats.total}\n`;
                response += `Healthy: ${stats.sessionStats.healthy}\n`;
                response += `Current Index: ${stats.sessionStats.currentIndex}\n`;
                response += `\nLast Success: ${stats.lastSuccess ? new Date(stats.lastSuccess).toLocaleString() : 'Never'}`;
                mainBot.sendMessage(chatId, response, { parse_mode: 'Markdown' });
            } else {
                mainBot.sendMessage(chatId, '❌ Task not found');
            }
            showUserMenu(chatId, userId);
        } else {
            mainBot.sendMessage(chatId, '❌ Invalid Task ID');
        }
    }
    else if (state.state === 'delete_task') {
        const task = tasks[text];
        if (task && task.userId === userId) {
            userStates[chatId] = { ...state, state: 'delete_task_confirm', taskId: text };
            mainBot.sendMessage(chatId, `Delete ${text}? Send "yes" to confirm:`);
        } else {
            mainBot.sendMessage(chatId, '❌ Invalid Task ID');
        }
    }
    else if (state.state === 'delete_task_confirm') {
        if (text.toLowerCase() === 'yes') {
            taskRunner.deleteTask(state.taskId);
            mainBot.sendMessage(chatId, '✅ Task deleted');
        }
        showUserMenu(chatId, userId);
    }
    else if (state.state === 'edit_task') {
        const task = tasks[text];
        if (task && task.userId === userId) {
            mainBot.sendMessage(chatId, '✏️ Edit feature coming soon. Delete and create new task.');
            showUserMenu(chatId, userId);
        } else {
            mainBot.sendMessage(chatId, '❌ Invalid Task ID');
        }
    }
    else if (state.state === 'show_all_logs') {
        const userTasks = taskRunner.getAllRunningTasks().filter(t => t.userId === userId);
        if (userTasks.length === 0) {
            mainBot.sendMessage(chatId, '📭 No active tasks');
        } else {
            let response = '📋 *All Active Tasks:*\n\n';
            for (const t of userTasks) {
                const stats = taskRunner.getTaskStats(t.taskId);
                response += `🔹 \`${t.taskId}\`\n`;
                response += `   Status: ${t.status}\n`;
                response += `   Messages: ${stats?.messagesSent || 0}\n`;
                response += `   Sessions: ${stats?.sessionStats?.healthy || 0}/${stats?.sessionStats?.total || 0} healthy\n`;
                response += `   Uptime: ${stats?.uptime || '0s'}\n\n`;
            }
            mainBot.sendMessage(chatId, response, { parse_mode: 'Markdown' });
        }
        showUserMenu(chatId, userId);
    }
});

function showUserMenu(chatId, userId) {
    const user = users[userId];
    if (!user) return;
    
    userStates[chatId] = { state: 'main_menu', userId };
    
    const keyboard = {
        inline_keyboard: [
            [{ text: '1️⃣ CREATE NEW TASK', callback_data: 'user_option_1' }],
            [{ text: '2️⃣ STOP YOUR TASK', callback_data: 'user_option_2' }],
            [{ text: '3️⃣ SHOW YOUR ALL ACTIVE TASK', callback_data: 'user_option_3' }],
            [{ text: '4️⃣ SHOW YOUR SPECIFIC TASK DETAILS', callback_data: 'user_option_4' }],
            [{ text: '5️⃣ SHOW YOUR ALL TASK STATUS', callback_data: 'user_option_5' }],
            [{ text: '6️⃣ DELETE YOUR TASK', callback_data: 'user_option_6' }],
            [{ text: '7️⃣ EDIT YOUR TASK', callback_data: 'user_option_7' }],
            [{ text: '8️⃣ LOGOUT YOUR ACCOUNT', callback_data: 'user_option_8' }]
        ]
    };
    
    mainBot.sendMessage(chatId, 
        `🌸 *Welcome, ${user.username}!* 🌸\n\n` +
        `✨ *ULTIMATE FB BOT* ✨\n\n` +
        `*CHOOSE YOUR OPTION:*`,
        { reply_markup: keyboard, parse_mode: 'Markdown' }
    );
}

function handleUserOption(chatId, userId, option) {
    const user = users[userId];
    if (!user) return;
    
    userStates[chatId] = { state: 'main_menu', userId };
    
    switch(option) {
        case '1':
            userStates[chatId] = { state: 'create_task_cookies', userId };
            mainBot.sendMessage(chatId, '🍪 Send cookies (one per line or .txt file):');
            break;
        case '2':
            userStates[chatId] = { state: 'stop_task', userId };
            mainBot.sendMessage(chatId, '🛑 Enter Task ID to stop:');
            break;
        case '3':
            const userTasks = taskRunner.getAllRunningTasks().filter(t => t.userId === userId);
            if (userTasks.length === 0) {
                mainBot.sendMessage(chatId, '📭 No active tasks');
            } else {
                let response = '📋 *Your Active Tasks:*\n\n';
                userTasks.forEach(t => {
                    const uptimeSeconds = Math.floor((Date.now() - t.createdAt) / 1000);
                    const uptime = formatUptime(uptimeSeconds);
                    response += `🔹 \`${t.taskId}\`\n`;
                    response += `   Uptime: ${uptime}\n`;
                    response += `   Messages: ${t.totalMessagesSent || 0}\n`;
                    response += `   Loop: ${t.loopCount || 0}\n\n`;
                });
                mainBot.sendMessage(chatId, response, { parse_mode: 'Markdown' });
            }
            break;
        case '4':
            userStates[chatId] = { state: 'show_specific_logs', userId };
            mainBot.sendMessage(chatId, '📋 Enter Task ID for details:');
            break;
        case '5':
            userStates[chatId] = { state: 'show_all_logs', userId };
            mainBot.sendMessage(chatId, '📋 Fetching all tasks status...');
            break;
        case '6':
            userStates[chatId] = { state: 'delete_task', userId };
            mainBot.sendMessage(chatId, '🗑️ Enter Task ID to delete:');
            break;
        case '7':
            userStates[chatId] = { state: 'edit_task', userId };
            mainBot.sendMessage(chatId, '✏️ Enter Task ID to edit:');
            break;
        case '8':
            const keyboard = {
                inline_keyboard: [
                    [{ text: '✅ YES', callback_data: 'logout_confirm' }],
                    [{ text: '❌ NO', callback_data: 'logout_cancel' }]
                ]
            };
            mainBot.sendMessage(chatId, 'Do you want to logout?', { reply_markup: keyboard });
            break;
    }
}

// ========== NOTIFICATION BOT HANDLERS ==========
notificationBot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    notificationSubscribers.add(chatId);
    notificationBot.sendMessage(chatId, '📢 Notification bot active');
});

notificationBot.onText(/\/stats/, (msg) => {
    const chatId = msg.chat.id;
    const totalTasks = Object.keys(tasks).length;
    const runningTasks = taskRunner.getAllRunningTasks().length;
    const totalUsers = Object.keys(users).length;
    
    // Calculate total sessions
    let totalSessions = 0;
    let healthySessions = 0;
    for (const [taskId] of Object.entries(tasks)) {
        const stats = perTaskManager.getTaskStats(taskId);
        if (stats) {
            totalSessions += stats.total || 0;
            healthySessions += stats.healthy || 0;
        }
    }
    
    const uptime = taskRunner.getBotUptime();
    
    notificationBot.sendMessage(chatId,
        `📊 *Bot Statistics*\n\n` +
        `Users: ${totalUsers}\n` +
        `Tasks: ${totalTasks} (${runningTasks} running)\n` +
        `Messages: ${messageSendCount}\n` +
        `Sessions: ${totalSessions} total\n` +
        `Healthy: ${healthySessions}\n` +
        `Failed: ${failedAttempts}\n` +
        `Uptime: ${uptime}`,
        { parse_mode: 'Markdown' }
    );
});

notificationBot.onText(/\/tasks/, (msg) => {
    const chatId = msg.chat.id;
    const runningTasks = taskRunner.getAllRunningTasks();
    
    if (runningTasks.length === 0) {
        notificationBot.sendMessage(chatId, '📭 No running tasks');
        return;
    }
    
    let response = '📋 *Running Tasks:*\n\n';
    runningTasks.forEach(t => {
        const uptimeSeconds = Math.floor((Date.now() - t.createdAt) / 1000);
        const uptime = formatUptime(uptimeSeconds);
        response += `🔹 \`${t.taskId}\`\n`;
        response += `   👤 ${t.username}\n`;
        response += `   ⏱️ ${uptime}\n`;
        response += `   💬 ${t.totalMessagesSent || 0} msgs\n\n`;
    });
    
    notificationBot.sendMessage(chatId, response, { parse_mode: 'Markdown' });
});

notificationBot.onText(/\/sessions/, (msg) => {
    const chatId = msg.chat.id;
    const runningTasks = taskRunner.getAllRunningTasks();
    
    if (runningTasks.length === 0) {
        notificationBot.sendMessage(chatId, '📭 No running tasks');
        return;
    }
    
    let response = '🍪 *Sessions Status*\n\n';
    
    for (const task of runningTasks) {
        const stats = perTaskManager.getTaskStats(task.taskId);
        if (stats) {
            response += `🔹 Task: \`${task.taskId}\`\n`;
            response += `   Total: ${stats.total}\n`;
            response += `   Healthy: ${stats.healthy}\n`;
            response += `   Current: ${stats.currentIndex}/${stats.total}\n\n`;
        }
    }
    
    notificationBot.sendMessage(chatId, response, { parse_mode: 'Markdown' });
});

// ========== EXPRESS SETUP ==========
app.use(express.json());

app.get('/health', (req, res) => {
    const runningTasks = taskRunner.getAllRunningTasks().length;
    const totalTasks = Object.keys(tasks).length;
    
    let totalSessions = 0;
    let healthySessions = 0;
    for (const [taskId] of Object.entries(tasks)) {
        const stats = perTaskManager.getTaskStats(taskId);
        if (stats) {
            totalSessions += stats.total || 0;
            healthySessions += stats.healthy || 0;
        }
    }
    
    res.status(200).json({ 
        status: 'healthy', 
        time: new Date().toISOString(),
        tasks: {
            total: totalTasks,
            running: runningTasks
        },
        sessions: {
            total: totalSessions,
            healthy: healthySessions
        },
        messages: messageSendCount,
        uptime: process.uptime()
    });
});

app.get('/', (req, res) => {
    const runningTasks = taskRunner.getAllRunningTasks().length;
    const totalTasks = Object.keys(tasks).length;
    
    let totalSessions = 0;
    let healthySessions = 0;
    for (const [taskId] of Object.entries(tasks)) {
        const stats = perTaskManager.getTaskStats(taskId);
        if (stats) {
            totalSessions += stats.total || 0;
            healthySessions += stats.healthy || 0;
        }
    }
    
    res.send(`
        <html>
            <head>
                <title>ULTIMATE FB BOT - PER TASK SESSIONS (5000 TASKS)</title>
                <meta http-equiv="refresh" content="30">
                <style>
                    body { font-family: Arial; padding: 20px; background: #f0f2f5; }
                    .status { padding: 20px; background: white; border-radius: 10px; }
                    .green { color: green; }
                    .red { color: red; }
                    .stats { margin-top: 20px; }
                    .highlight { background: #e3f2fd; padding: 15px; border-radius: 5px; margin: 10px 0; }
                    .warning { background: #fff3cd; padding: 10px; border-radius: 5px; }
                    .success { background: #d4edda; padding: 10px; border-radius: 5px; }
                </style>
            </head>
            <body>
                <div class="status">
                    <h1>🤖 ULTIMATE FB BOT <span class="green">● ONLINE</span></h1>
                    <div class="highlight">
                        <h3>🔥 PER-TASK SESSIONS (SUPPORTS 5000 TASKS)</h3>
                        <p>✅ Each task has its own session pool</p>
                        <p>✅ Anti-stop + 3-minute stuck restart</p>
                        <p>✅ AppState recovery (5 min) + Fresh login (10 min)</p>
                        <p>✅ 24-hour cookie refresh</p>
                        <p>✅ Telegram control with 8 options</p>
                    </div>
                    <div class="warning">
                        <h4>📊 Current Status:</h4>
                        <p>Total Tasks: ${totalTasks}</p>
                        <p>Running Tasks: ${runningTasks}</p>
                        <p>Total Sessions: ${totalSessions}</p>
                        <p>Healthy Sessions: ${healthySessions}</p>
                        <p>Messages Sent: ${messageSendCount}</p>
                        <p>Last Success: ${new Date(lastSuccessTime).toLocaleString()}</p>
                        <p>Uptime: ${taskRunner.getBotUptime()}</p>
                    </div>
                    <div class="success">
                        <h4>⚡ Recovery Systems Active:</h4>
                        <p>✅ AppState Recovery: Every 5 minutes</p>
                        <p>✅ Fresh Login: Every 10 minutes</p>
                        <p>✅ Cookie Refresh: Every 24 hours</p>
                        <p>✅ Stuck Task Restart: 3 minutes</p>
                    </div>
                </div>
            </body>
        </html>
    `);
});

app.get('/api/status', (req, res) => {
    const runningTasks = taskRunner.getAllRunningTasks();
    const tasksDetail = [];
    
    for (const task of runningTasks) {
        const stats = perTaskManager.getTaskStats(task.taskId);
        tasksDetail.push({
            taskId: task.taskId,
            username: task.username,
            messages: task.totalMessagesSent || 0,
            sessions: stats
        });
    }
    
    res.json({
        running: true,
        messagesSent: messageSendCount,
        failedAttempts: failedAttempts,
        lastSuccess: lastSuccessTime,
        uptime: process.uptime(),
        tasks: tasksDetail,
        totalTasks: Object.keys(tasks).length,
        totalUsers: Object.keys(users).length
    });
});

// ========== SERVER START ==========
const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n💎 Server running at http://localhost:${PORT}`);
    console.log(`🌐 Render URL: ${RENDER_URL}`);
    console.log(`\n` + '='.repeat(60));
    console.log(`🔥 ULTIMATE FB BOT - PER TASK SESSIONS (5000 TASKS SUPPORT)`);
    console.log(`✅ Each task gets its own session pool`);
    console.log(`✅ Anti-stop + 3-minute stuck restart`);
    console.log(`✅ AppState recovery (5 min) + Fresh login (10 min)`);
    console.log(`✅ 24-hour cookie refresh`);
    console.log(`✅ Telegram 8 options fully integrated`);
    console.log('='.repeat(60));
    
    // Load and resume all tasks
    setTimeout(async () => {
        console.log('📂 Resuming all pending tasks...');
        const resumed = await taskRunner.resumeAllTasks();
        console.log(`✅ Resumed ${resumed} tasks`);
        
        // Create file task if files exist
        const fileTaskCreated = await createFileTask();
        if (fileTaskCreated) {
            console.log('✅ File-based task created');
        }
    }, 3000);
});

wss = new WebSocket.Server({ server });

// ========== ERROR HANDLING ==========
process.on('SIGINT', () => {
    console.log('\n👋 Manual shutdown received...');
    saveAllData();
    setTimeout(() => process.exit(0), 2000);
});

process.on('SIGTERM', () => {
    console.log('\n👋 Received SIGTERM...');
    saveAllData();
    process.exit(0);
});

process.on('uncaughtException', (error) => {
    console.log('🛡️ Uncaught Exception:', error.message);
});

process.on('unhandledRejection', (reason) => {
    console.log('🛡️ Unhandled Rejection:', reason);
});

// ========== AUTO-SAVE ==========
setInterval(() => {
    saveAllData();
}, 60 * 1000);

// ========== KEEP ALIVE ==========
setInterval(() => {
    if (Object.keys(tasks).length > 0) {
        http.get(`http://localhost:${PORT}/api/ping`).on('error', () => {});
    }
}, 5 * 60 * 1000);
