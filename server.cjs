const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const fs = require('fs').promises;
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');
const multer = require('multer');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this-in-production';
const USERS_FILE = path.join(__dirname, 'users.json');
const CONTACTS_FILE = path.join(__dirname, 'contacts.json');
const MESSAGES_FILE = path.join(__dirname, 'messages.json');
const BLOCKED_FILE = path.join(__dirname, 'blocked.json');
const UPLOAD_PATH = process.env.UPLOAD_PATH || './uploads';

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static('public'));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ========== MULTER KONFIGURATSIYASI ==========
const storage = multer.diskStorage({
    destination: async function (req, file, cb) {
        let folder = 'files';
        
        if (file.mimetype.startsWith('image/')) {
            folder = 'images';
        } else if (file.mimetype.startsWith('audio/')) {
            folder = 'audio';
        } else if (file.mimetype.startsWith('video/')) {
            folder = 'videos';
        }
        
        const uploadPath = path.join(__dirname, UPLOAD_PATH, folder);
        try {
            await fs.mkdir(uploadPath, { recursive: true });
            cb(null, uploadPath);
        } catch (err) {
            cb(err);
        }
    },
    filename: function (req, file, cb) {
        const safeName = file.originalname.replace(/[^a-zA-Z0-9.]/g, '-');
        const uniqueName = uuidv4() + '-' + safeName;
        cb(null, uniqueName);
    }
});

const upload = multer({
    storage: storage,
    limits: {
        fileSize: parseInt(process.env.MAX_FILE_SIZE) || 100 * 1024 * 1024
    },
    fileFilter: (req, file, cb) => {
        const allowedTypes = [
            'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp',
            'audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/webm', 'audio/mp4', 'audio/x-m4a', 'audio/x-wav',
            'video/mp4', 'video/webm', 'video/ogg', 'video/quicktime', 'video/x-msvideo',
            'application/pdf', 'application/msword',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'text/plain', 'application/zip', 'application/x-rar-compressed'
        ];
        
        if (allowedTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            console.log('Unsupported file type:', file.mimetype);
            cb(new Error(`Unsupported file type: ${file.mimetype}`), false);
        }
    }
});

// ========== FAYLLARNI O'QISH/YOZISH FUNKSIYALARI ==========
async function readUsers() {
    try {
        const data = await fs.readFile(USERS_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        return { users: [] };
    }
}

async function writeUsers(users) {
    await fs.writeFile(USERS_FILE, JSON.stringify(users, null, 2));
}

async function readContacts() {
    try {
        const data = await fs.readFile(CONTACTS_FILE, 'utf8');
        const parsed = JSON.parse(data);
        if (!parsed.contacts) {
            parsed.contacts = {};
        }
        return parsed;
    } catch (error) {
        return { contacts: {} };
    }
}

async function writeContacts(contacts) {
    await fs.writeFile(CONTACTS_FILE, JSON.stringify(contacts, null, 2));
}

async function readMessages() {
    try {
        const data = await fs.readFile(MESSAGES_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        return { messages: [] };
    }
}

async function writeMessages(messages) {
    await fs.writeFile(MESSAGES_FILE, JSON.stringify(messages, null, 2));
}

async function readBlocked() {
    try {
        const data = await fs.readFile(BLOCKED_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        return { blocked: {} };
    }
}

async function writeBlocked(blocked) {
    await fs.writeFile(BLOCKED_FILE, JSON.stringify(blocked, null, 2));
}

// ========== YORDAMCHI FUNKSIYALAR ==========
async function addContact(userId, contactId) {
    try {
        const contactsData = await readContacts();
        
        if (!contactsData.contacts[userId]) {
            contactsData.contacts[userId] = [];
        }
        
        if (!contactsData.contacts[userId].includes(contactId)) {
            contactsData.contacts[userId].push(contactId);
        }
        
        if (!contactsData.contacts[contactId]) {
            contactsData.contacts[contactId] = [];
        }
        
        if (!contactsData.contacts[contactId].includes(userId)) {
            contactsData.contacts[contactId].push(userId);
        }
        
        await writeContacts(contactsData);
        return true;
    } catch (error) {
        console.error('Error adding contact:', error);
        return false;
    }
}

async function getUserContacts(userId) {
    const contactsData = await readContacts();
    return contactsData.contacts[userId] || [];
}

async function isUserBlocked(userId, targetUserId) {
    try {
        const blockedData = await readBlocked();
        return blockedData.blocked[userId]?.includes(targetUserId) || false;
    } catch (error) {
        return false;
    }
}

// ========== MEDIA ENDPOINTLARI ==========
app.get('/api/audio/:filename', (req, res) => {
    const { filename } = req.params;
    const filePath = path.join(__dirname, 'uploads', 'audio', filename);
    
    const ext = path.extname(filename).toLowerCase();
    let contentType = 'audio/webm';
    
    if (ext === '.mp3') contentType = 'audio/mpeg';
    else if (ext === '.wav') contentType = 'audio/wav';
    else if (ext === '.ogg') contentType = 'audio/ogg';
    else if (ext === '.m4a' || ext === '.mp4') contentType = 'audio/mp4';
    else if (ext === '.webm') contentType = 'audio/webm';
    
    console.log('Serving audio file:', filename, 'Content-Type:', contentType);
    
    res.setHeader('Content-Type', contentType);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'public, max-age=31536000');
    
    res.sendFile(filePath, (err) => {
        if (err) {
            console.error('Error sending audio file:', err);
            res.status(404).json({ error: 'Audio file not found' });
        }
    });
});

app.get('/api/media/:folder/:filename', (req, res) => {
    const { folder, filename } = req.params;
    const filePath = path.join(__dirname, 'uploads', folder, filename);
    
    const ext = path.extname(filename).toLowerCase();
    let contentType = 'application/octet-stream';
    
    if (ext === '.mp3') contentType = 'audio/mpeg';
    else if (ext === '.wav') contentType = 'audio/wav';
    else if (ext === '.ogg') contentType = 'audio/ogg';
    else if (ext === '.m4a') contentType = 'audio/mp4';
    else if (ext === '.webm') contentType = 'audio/webm';
    else if (ext === '.mp4') contentType = 'video/mp4';
    else if (ext === '.webm') contentType = 'video/webm';
    else if (ext === '.ogg') contentType = 'video/ogg';
    else if (ext === '.mov') contentType = 'video/quicktime';
    else if (ext === '.avi') contentType = 'video/x-msvideo';
    else if (ext === '.jpg' || ext === '.jpeg') contentType = 'image/jpeg';
    else if (ext === '.png') contentType = 'image/png';
    else if (ext === '.gif') contentType = 'image/gif';
    else if (ext === '.webp') contentType = 'image/webp';
    else if (ext === '.bmp') contentType = 'image/bmp';
    
    res.setHeader('Content-Type', contentType);
    res.sendFile(filePath, (err) => {
        if (err) {
            console.error('Error sending file:', err);
            res.status(404).json({ error: 'File not found' });
        }
    });
});

app.get('/api/download/:folder/:filename', (req, res) => {
    const { folder, filename } = req.params;
    const filePath = path.join(__dirname, 'uploads', folder, filename);
    
    res.download(filePath, filename, (err) => {
        if (err) {
            console.error('Download error:', err);
            res.status(404).json({ error: 'File not found' });
        }
    });
});

// ========== PROFIL VA THEME ENDPOINTLARI ==========
app.get('/api/user/:userId/profile', async (req, res) => {
    try {
        const { userId } = req.params;
        const { currentUserId } = req.query;
        
        const usersData = await readUsers();
        const user = usersData.users.find(u => u.id === userId);
        
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        if (currentUserId === userId) {
            return res.json({
                success: true,
                profile: user.profile,
                fullProfile: true,
                username: user.username,
                avatar: user.avatar
            });
        }
        
        const contactsData = await readContacts();
        const isContact = contactsData.contacts[currentUserId]?.includes(userId) || 
                         contactsData.contacts[userId]?.includes(currentUserId);
        
        const visibility = user.profile?.visibility || {};
        const responseProfile = {
            bio: '',
            phone: '',
            location: '',
            website: '',
            avatar: user.avatar
        };
        
        if (visibility.profileInfo === 'public' || 
            (visibility.profileInfo === 'contacts' && isContact)) {
            responseProfile.bio = user.profile?.bio || '';
            responseProfile.phone = user.profile?.phone || '';
            responseProfile.location = user.profile?.location || '';
            responseProfile.website = user.profile?.website || '';
        }
        
        if (visibility.avatar === 'public' || 
            (visibility.avatar === 'contacts' && isContact)) {
            responseProfile.avatar = user.avatar;
        } else {
            responseProfile.avatar = `https://ui-avatars.com/api/?name=${encodeURIComponent(user.username)}&background=random&color=fff&bold=true`;
        }
        
        let statusInfo = {};
        if (visibility.onlineStatus === 'public' || 
            (visibility.onlineStatus === 'contacts' && isContact)) {
            statusInfo.status = user.status;
        } else if (visibility.onlineStatus === 'private') {
            statusInfo.status = 'unknown';
        }
        
        if (visibility.lastSeen === 'public' || 
            (visibility.lastSeen === 'contacts' && isContact)) {
            statusInfo.lastSeen = user.lastSeen;
        } else if (visibility.lastSeen === 'private') {
            statusInfo.lastSeen = null;
        }
        
        res.json({
            success: true,
            profile: responseProfile,
            status: statusInfo,
            username: user.username,
            userId: user.id,
            isContact: isContact,
            visibility: visibility
        });
    } catch (error) {
        console.error('Error getting user profile:', error);
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/user/:userId/public-status', async (req, res) => {
    try {
        const { userId } = req.params;
        const { currentUserId } = req.query;
        
        const usersData = await readUsers();
        const user = usersData.users.find(u => u.id === userId);
        
        if (!user) {
            return res.json({
                success: true,
                status: 'unknown',
                lastSeen: null
            });
        }
        
        if (currentUserId === userId) {
            return res.json({
                success: true,
                status: user.status,
                lastSeen: user.lastSeen
            });
        }
        
        const visibility = user.profile?.visibility || {};
        const contactsData = await readContacts();
        const isContact = contactsData.contacts[currentUserId]?.includes(userId) || 
                         contactsData.contacts[userId]?.includes(currentUserId);
        
        let status = 'unknown';
        let lastSeen = null;
        
        if (visibility.onlineStatus === 'public') {
            status = user.status;
        } else if (visibility.onlineStatus === 'contacts' && isContact) {
            status = user.status;
        } else if (visibility.onlineStatus === 'private') {
            status = 'unknown';
        }
        
        if (visibility.lastSeen === 'public') {
            lastSeen = user.lastSeen;
        } else if (visibility.lastSeen === 'contacts' && isContact) {
            lastSeen = user.lastSeen;
        } else if (visibility.lastSeen === 'private') {
            lastSeen = null;
        }
        
        res.json({
            success: true,
            status: status,
            lastSeen: lastSeen
        });
    } catch (error) {
        console.error('Error getting public status:', error);
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/theme/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const usersData = await readUsers();
        
        const user = usersData.users.find(u => u.id === userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        res.json({
            success: true,
            theme: user.profile?.theme || {
                mode: 'light',
                primaryColor: '#007bff',
                backgroundColor: '#f8f9fa',
                textColor: '#212529'
            }
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/themes', async (req, res) => {
    try {
        const usersData = await readUsers();
        const themes = usersData.users.map(user => ({
            userId: user.id,
            theme: user.profile?.theme || {
                mode: 'light',
                primaryColor: '#007bff',
                backgroundColor: '#f8f9fa',
                textColor: '#212529'
            }
        }));
        
        res.json({ success: true, themes });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.put('/api/profile/full', async (req, res) => {
    try {
        const { userId, profile } = req.body;
        const usersData = await readUsers();

        const user = usersData.users.find(u => u.id === userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        user.profile = {
            ...user.profile,
            bio: profile.bio || user.profile?.bio || '',
            phone: profile.phone || user.profile?.phone || '',
            location: profile.location || user.profile?.location || '',
            website: profile.website || user.profile?.website || '',
            visibility: {
                onlineStatus: profile.visibility?.onlineStatus || user.profile?.visibility?.onlineStatus || 'public',
                lastSeen: profile.visibility?.lastSeen || user.profile?.visibility?.lastSeen || 'public',
                profileInfo: profile.visibility?.profileInfo || user.profile?.visibility?.profileInfo || 'public',
                avatar: profile.visibility?.avatar || user.profile?.visibility?.avatar || 'public'
            },
            notifications: {
                message: profile.notifications?.message ?? user.profile?.notifications?.message ?? true,
                call: profile.notifications?.call ?? user.profile?.notifications?.call ?? true,
                online: profile.notifications?.online ?? user.profile?.notifications?.online ?? true,
                sound: profile.notifications?.sound ?? user.profile?.notifications?.sound ?? true,
                vibration: profile.notifications?.vibration ?? user.profile?.notifications?.vibration ?? true
            },
            theme: {
                mode: profile.theme?.mode || user.profile?.theme?.mode || 'light',
                primaryColor: profile.theme?.primaryColor || user.profile?.theme?.primaryColor || '#007bff',
                backgroundColor: profile.theme?.backgroundColor || user.profile?.theme?.backgroundColor || '#f8f9fa',
                textColor: profile.theme?.textColor || user.profile?.theme?.textColor || '#212529'
            },
            privacy: {
                showTyping: profile.privacy?.showTyping ?? user.profile?.privacy?.showTyping ?? true,
                readReceipts: profile.privacy?.readReceipts ?? user.profile?.privacy?.readReceipts ?? true,
                groups: profile.privacy?.groups || user.profile?.privacy?.groups || 'everyone'
            }
        };

        if (profile.avatar && profile.avatar.startsWith('http')) {
            user.avatar = profile.avatar;
        }

        await writeUsers(usersData);

        res.json({
            success: true,
            message: 'Profile updated successfully',
            user: {
                id: user.id,
                username: user.username,
                email: user.email,
                avatar: user.avatar,
                profile: user.profile
            }
        });
    } catch (error) {
        console.error('Error updating full profile:', error);
        res.status(500).json({ error: error.message });
    }
});

// ========== CONTACT MANAGEMENT ENDPOINTS ==========
app.post('/api/contacts/add', async (req, res) => {
    try {
        const { userId, contactId } = req.body;
        
        const success = await addContact(userId, contactId);
        
        if (success) {
            res.json({
                success: true,
                message: 'Contact added successfully'
            });
        } else {
            res.status(500).json({ error: 'Failed to add contact' });
        }
    } catch (error) {
        console.error('Error adding contact:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/contacts/remove', async (req, res) => {
    try {
        const { userId, contactId } = req.body;
        const contactsData = await readContacts();
        
        if (contactsData.contacts[userId]) {
            contactsData.contacts[userId] = contactsData.contacts[userId].filter(id => id !== contactId);
        }
        
        if (contactsData.contacts[contactId]) {
            contactsData.contacts[contactId] = contactsData.contacts[contactId].filter(id => id !== userId);
        }
        
        await writeContacts(contactsData);
        
        res.json({
            success: true,
            message: 'Contact removed successfully'
        });
    } catch (error) {
        console.error('Error removing contact:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/block', async (req, res) => {
    try {
        const { userId, blockUserId } = req.body;
        
        let blockedData = await readBlocked();
        
        if (!blockedData.blocked[userId]) {
            blockedData.blocked[userId] = [];
        }
        
        if (!blockedData.blocked[userId].includes(blockUserId)) {
            blockedData.blocked[userId].push(blockUserId);
        }
        
        await writeBlocked(blockedData);
        
        // Also remove from contacts
        const contactsData = await readContacts();
        if (contactsData.contacts[userId]) {
            contactsData.contacts[userId] = contactsData.contacts[userId].filter(id => id !== blockUserId);
        }
        
        await writeContacts(contactsData);
        
        res.json({
            success: true,
            message: 'User blocked successfully'
        });
    } catch (error) {
        console.error('Error blocking user:', error);
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/blocked/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const blockedData = await readBlocked();
        
        res.json({
            success: true,
            blockedUsers: blockedData.blocked[userId] || []
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/unblock', async (req, res) => {
    try {
        const { userId, unblockUserId } = req.body;
        
        const blockedData = await readBlocked();
        
        if (blockedData.blocked[userId]) {
            blockedData.blocked[userId] = blockedData.blocked[userId].filter(id => id !== unblockUserId);
        }
        
        await writeBlocked(blockedData);
        
        res.json({
            success: true,
            message: 'User unblocked successfully'
        });
    } catch (error) {
        console.error('Error unblocking user:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/messages/clear', async (req, res) => {
    try {
        const { userId1, userId2 } = req.body;
        const messagesData = await readMessages();
        
        messagesData.messages = messagesData.messages.filter(msg => 
            !((msg.senderId === userId1 && msg.receiverId === userId2) ||
              (msg.senderId === userId2 && msg.receiverId === userId1))
        );
        
        await writeMessages(messagesData);
        
        res.json({
            success: true,
            message: 'Chat history cleared successfully'
        });
    } catch (error) {
        console.error('Error clearing chat history:', error);
        res.status(500).json({ error: error.message });
    }
});

// ========== ASOSIY ROUTES ==========
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.get('/profile', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'profile.html'));
});

app.get('/call', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'call.html'));
});

// ========== AUTH ENDPOINTS ==========
app.post('/api/register', async (req, res) => {
    try {
        const { username, email, password } = req.body;
        const usersData = await readUsers();

        if (usersData.users.find(u => u.email === email)) {
            return res.status(400).json({ error: 'Email already exists' });
        }
        if (usersData.users.find(u => u.username === username)) {
            return res.status(400).json({ error: 'Username already exists' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const newUser = {
            id: uuidv4(),
            username,
            email,
            password: hashedPassword,
            avatar: `https://ui-avatars.com/api/?name=${encodeURIComponent(username)}&background=random&color=fff&bold=true`,
            status: 'offline',
            lastSeen: new Date().toISOString(),
            createdAt: new Date().toISOString(),
            profile: {
                bio: '',
                phone: '',
                location: '',
                website: '',
                visibility: {
                    onlineStatus: 'public',
                    lastSeen: 'public',
                    profileInfo: 'public',
                    avatar: 'public'
                },
                notifications: {
                    message: true,
                    call: true,
                    online: true,
                    sound: true,
                    vibration: true
                },
                theme: {
                    mode: 'light',
                    primaryColor: '#007bff',
                    backgroundColor: '#f8f9fa',
                    textColor: '#212529'
                },
                privacy: {
                    showTyping: true,
                    readReceipts: true,
                    groups: 'everyone'
                }
            }
        };

        usersData.users.push(newUser);
        await writeUsers(usersData);

        const token = jwt.sign(
            { userId: newUser.id, username: newUser.username },
            JWT_SECRET,
            { expiresIn: '7d' }
        );

        res.status(201).json({
            success: true,
            message: 'User registered successfully',
            token,
            user: {
                id: newUser.id,
                username: newUser.username,
                email: newUser.email,
                avatar: newUser.avatar,
                profile: newUser.profile
            }
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const usersData = await readUsers();

        const user = usersData.users.find(u => u.email === email);
        if (!user) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }

        const isValid = await bcrypt.compare(password, user.password);
        if (!isValid) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }

        const token = jwt.sign(
            { userId: user.id, username: user.username },
            JWT_SECRET,
            { expiresIn: '7d' }
        );

        user.status = 'online';
        user.lastSeen = new Date().toISOString();
        await writeUsers(usersData);

        res.json({
            success: true,
            message: 'Login successful',
            token,
            user: {
                id: user.id,
                username: user.username,
                email: user.email,
                avatar: user.avatar,
                status: user.status,
                profile: user.profile
            }
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ========== FILE UPLOAD ENDPOINTS ==========
app.post('/api/upload-avatar', upload.single('avatar'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        const { userId } = req.body;
        const usersData = await readUsers();

        const user = usersData.users.find(u => u.id === userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const avatarUrl = `/uploads/images/${req.file.filename}`;
        user.avatar = avatarUrl;

        await writeUsers(usersData);

        res.json({
            success: true,
            message: 'Avatar uploaded successfully',
            avatarUrl
        });
    } catch (error) {
        console.error('Avatar upload error:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/upload-audio', upload.single('audio'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No audio file uploaded' });
        }

        console.log('Audio file uploaded:', req.file);
        
        const audioUrl = `/uploads/audio/${req.file.filename}`;
        const apiUrl = `/api/audio/${req.file.filename}`;
        const downloadUrl = `/api/download/audio/${req.file.filename}`;

        res.json({
            success: true,
            message: 'Audio uploaded successfully',
            file: {
                url: audioUrl,
                apiUrl: apiUrl,
                downloadUrl: downloadUrl,
                type: 'audio',
                name: req.file.originalname,
                filename: req.file.filename,
                size: req.file.size,
                mimetype: req.file.mimetype,
                folder: 'audio',
                duration: req.body.duration || 0
            }
        });
    } catch (error) {
        console.error('Audio upload error:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/upload-file', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        let fileType = 'file';
        let folder = 'files';
        let mimeType = req.file.mimetype;
        
        if (mimeType.startsWith('image/')) {
            fileType = 'image';
            folder = 'images';
        } else if (mimeType.startsWith('audio/')) {
            fileType = 'audio';
            folder = 'audio';
        } else if (mimeType.startsWith('video/')) {
            fileType = 'video';
            folder = 'videos';
        }

        const fileUrl = `/uploads/${folder}/${req.file.filename}`;
        const apiUrl = `/api/media/${folder}/${req.file.filename}`;
        const downloadUrl = `/api/download/${folder}/${req.file.filename}`;

        res.json({
            success: true,
            message: 'File uploaded successfully',
            file: {
                url: fileUrl,
                apiUrl: apiUrl,
                downloadUrl: downloadUrl,
                type: fileType,
                name: req.file.originalname,
                filename: req.file.filename,
                size: req.file.size,
                mimetype: mimeType,
                folder: folder,
                duration: req.body.duration || 0
            }
        });
    } catch (error) {
        console.error('File upload error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ========== SEARCH AND CONTACTS ==========
app.get('/api/search', async (req, res) => {
    try {
        const { query, currentUserId } = req.query;
        
        if (!query || query.length < 1) {
            return res.json({ success: true, users: [] });
        }
        
        const usersData = await readUsers();
        
        const searchResults = usersData.users
            .filter(user => 
                user.id !== currentUserId &&
                (user.username.toLowerCase().includes(query.toLowerCase()) ||
                 user.email.toLowerCase().includes(query.toLowerCase()))
            )
            .map(({ password, ...user }) => user);
        
        res.json({ success: true, users: searchResults });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/contacts', async (req, res) => {
    try {
        const { userId } = req.query;
        const contactIds = await getUserContacts(userId);
        
        const usersData = await readUsers();
        const contactUsers = usersData.users
            .filter(user => contactIds.includes(user.id))
            .map(({ password, ...user }) => user);
        
        res.json({ success: true, contacts: contactUsers });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ========== MESSAGES ENDPOINTS ==========
app.get('/api/messages', async (req, res) => {
    try {
        const { userId1, userId2 } = req.query;
        const messagesData = await readMessages();

        const filteredMessages = messagesData.messages.filter(msg =>
            !msg.isDeleted &&
            ((msg.senderId === userId1 && msg.receiverId === userId2) ||
            (msg.senderId === userId2 && msg.receiverId === userId1))
        );

        res.json({ success: true, messages: filteredMessages });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.put('/api/messages/:id/delete', async (req, res) => {
    try {
        const { id } = req.params;
        const { userId } = req.body;
        
        const messagesData = await readMessages();
        const message = messagesData.messages.find(m => m.id === id);
        
        if (!message) {
            return res.status(404).json({ error: 'Message not found' });
        }
        
        if (message.senderId !== userId) {
            return res.status(403).json({ error: 'You can only delete your own messages' });
        }
        
        message.isDeleted = true;
        message.deletedAt = new Date().toISOString();
        
        await writeMessages(messagesData);
        
        res.json({
            success: true,
            message: 'Message deleted successfully'
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.put('/api/messages/:id/edit', async (req, res) => {
    try {
        const { id } = req.params;
        const { userId, content } = req.body;
        
        const messagesData = await readMessages();
        const message = messagesData.messages.find(m => m.id === id);
        
        if (!message) {
            return res.status(404).json({ error: 'Message not found' });
        }
        
        if (message.senderId !== userId) {
            return res.status(403).json({ error: 'You can only edit your own messages' });
        }
        
        message.content = content;
        message.isEdited = true;
        message.editedAt = new Date().toISOString();
        
        await writeMessages(messagesData);
        
        res.json({
            success: true,
            message: 'Message edited successfully',
            updatedMessage: message
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/logout', async (req, res) => {
    try {
        const { userId } = req.body;
        const usersData = await readUsers();
        
        const user = usersData.users.find(u => u.id === userId);
        if (user) {
            user.status = 'offline';
            user.lastSeen = new Date().toISOString();
            await writeUsers(usersData);
        }
        
        res.json({ success: true, message: 'Logged out successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ========== SOCKET.IO HANDLING ==========
const userSocketMap = {};

io.on('connection', (socket) => {
    console.log('New user connected:', socket.id);

    socket.on('user-online', async (userId) => {
        try {
            userSocketMap[userId] = socket.id;
            
            const usersData = await readUsers();
            const user = usersData.users.find(u => u.id === userId);
            if (user) {
                user.status = 'online';
                user.lastSeen = new Date().toISOString();
                await writeUsers(usersData);
                
                io.emit('user-status-changed', {
                    userId: user.id,
                    status: user.status
                });
            }
        } catch (error) {
            console.error('Error updating user status:', error);
        }
    });

    // WebRTC signaling
    socket.on('join-call', (data) => {
        const { roomId, userId } = data;
        socket.join(roomId);
        console.log(`User ${userId} joined room ${roomId}`);
        
        socket.to(roomId).emit('user-joined', { userId: userId });
        
        const clients = io.sockets.adapter.rooms.get(roomId);
        if (clients) {
            const users = Array.from(clients);
            socket.emit('room-users', { users: users });
        }
    });

    socket.on('leave-call', (data) => {
        const { roomId, userId } = data;
        socket.leave(roomId);
        socket.to(roomId).emit('user-left', { userId: userId });
    });

    socket.on('offer', (data) => {
        const { to, offer, roomId } = data;
        socket.to(to).emit('offer', { offer: offer, from: socket.id, roomId: roomId });
    });

    socket.on('answer', (data) => {
        const { to, answer } = data;
        socket.to(to).emit('answer', { answer: answer, from: socket.id });
    });

    socket.on('ice-candidate', (data) => {
        const { to, candidate } = data;
        socket.to(to).emit('ice-candidate', { candidate: candidate, from: socket.id });
    });

    socket.on('send-message', async (data) => {
        try {
            const { senderId, receiverId, content, type = 'text', tempId, file } = data;
            console.log('Sending message from', senderId, 'to', receiverId, 'type:', type);
            
            // Check if blocked
            const isBlocked = await isUserBlocked(receiverId, senderId);
            if (isBlocked) {
                socket.emit('message-blocked', {
                    receiverId: receiverId,
                    message: 'You are blocked by this user'
                });
                return;
            }
            
            await addContact(senderId, receiverId);
            
            const messagesData = await readMessages();
            const newMessage = {
                id: uuidv4(),
                senderId,
                receiverId,
                content,
                type,
                file: file || null,
                timestamp: new Date().toISOString(),
                delivered: true,
                read: false,
                isDeleted: false,
                isEdited: false
            };

            messagesData.messages.push(newMessage);
            await writeMessages(messagesData);
            console.log('Message saved:', newMessage.id);

            socket.emit('receive-message', {
                ...newMessage,
                tempId: tempId
            });

            const receiverSocketId = userSocketMap[receiverId];
            if (receiverSocketId) {
                console.log('Sending to receiver socket:', receiverSocketId);
                io.to(receiverSocketId).emit('receive-message', newMessage);
            } else {
                console.log('Receiver not connected:', receiverId);
            }

            socket.emit('contacts-updated', { userId: senderId });
            if (receiverSocketId) {
                io.to(receiverSocketId).emit('contacts-updated', { userId: receiverId });
            }
        } catch (error) {
            console.error('Error saving message:', error);
        }
    });

    socket.on('delete-message', async (data) => {
        try {
            const { messageId, userId } = data;
            
            const messagesData = await readMessages();
            const message = messagesData.messages.find(m => m.id === messageId);
            
            if (!message) return;
            
            if (message.senderId !== userId) return;
            
            message.isDeleted = true;
            message.deletedAt = new Date().toISOString();
            
            await writeMessages(messagesData);
            
            io.emit('message-deleted', { messageId });
        } catch (error) {
            console.error('Error deleting message:', error);
        }
    });

    socket.on('edit-message', async (data) => {
        try {
            const { messageId, userId, content } = data;
            
            const messagesData = await readMessages();
            const message = messagesData.messages.find(m => m.id === messageId);
            
            if (!message) return;
            
            if (message.senderId !== userId) return;
            
            message.content = content;
            message.isEdited = true;
            message.editedAt = new Date().toISOString();
            
            await writeMessages(messagesData);
            
            io.emit('message-edited', {
                messageId,
                content,
                editedAt: message.editedAt
            });
        } catch (error) {
            console.error('Error editing message:', error);
        }
    });

    socket.on('message-read', async (messageId) => {
        try {
            const messagesData = await readMessages();
            const message = messagesData.messages.find(m => m.id === messageId);
            if (message) {
                message.read = true;
                message.readAt = new Date().toISOString();
                await writeMessages(messagesData);
                
                socket.broadcast.emit('message-read-update', messageId);
            }
        } catch (error) {
            console.error('Error updating message read status:', error);
        }
    });

    socket.on('typing', (data) => {
        const { receiverId, isTyping } = data;
        const receiverSocketId = userSocketMap[receiverId];
        if (receiverSocketId) {
            io.to(receiverSocketId).emit('user-typing', {
                senderId: socket.userId,
                isTyping
            });
        }
    });

    socket.on('start-call', (data) => {
        const { receiverId, callType } = data;
        const receiverSocketId = userSocketMap[receiverId];
        
        if (receiverSocketId) {
            io.to(receiverSocketId).emit('incoming-call', {
                from: socket.id,
                fromUserId: data.fromUserId,
                callType: callType,
                callerName: data.callerName
            });
        }
    });

    socket.on('accept-call', (data) => {
        const { to } = data;
        const receiverSocketId = userSocketMap[to];
        
        if (receiverSocketId) {
            io.to(receiverSocketId).emit('call-accepted', {
                from: socket.id
            });
        }
    });

    socket.on('reject-call', (data) => {
        const { to } = data;
        const receiverSocketId = userSocketMap[to];
        
        if (receiverSocketId) {
            io.to(receiverSocketId).emit('call-rejected');
        }
    });

    socket.on('end-call', (data) => {
        const { to } = data;
        const receiverSocketId = userSocketMap[to];
        
        if (receiverSocketId) {
            io.to(receiverSocketId).emit('call-ended');
        }
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        for (const [userId, socketId] of Object.entries(userSocketMap)) {
            if (socketId === socket.id) {
                delete userSocketMap[userId];
                
                (async () => {
                    try {
                        const usersData = await readUsers();
                        const user = usersData.users.find(u => u.id === userId);
                        if (user) {
                            user.status = 'offline';
                            user.lastSeen = new Date().toISOString();
                            await writeUsers(usersData);
                            io.emit('user-status-changed', {
                                userId: userId,
                                status: 'offline'
                            });
                        }
                    } catch (error) {
                        console.error('Error updating user status on disconnect:', error);
                    }
                })();
                break;
            }
        }
    });
});

// ========== SERVER START ==========
server.listen(PORT, async () => {
    console.log(`Server running on http://localhost:${PORT}`);
    
    // Create necessary files if they don't exist
    const files = [
        { file: USERS_FILE, init: { users: [] } },
        { file: CONTACTS_FILE, init: { contacts: {} } },
        { file: MESSAGES_FILE, init: { messages: [] } },
        { file: BLOCKED_FILE, init: { blocked: {} } }
    ];
    
    for (const { file, init } of files) {
        try {
            await fs.access(file);
        } catch {
            await fs.writeFile(file, JSON.stringify(init, null, 2));
            console.log(`Created ${path.basename(file)}`);
        }
    }
    
    // Create upload directories
    const uploadDirs = ['images', 'audio', 'files', 'videos'];
    for (const dir of uploadDirs) {
        const dirPath = path.join(__dirname, UPLOAD_PATH, dir);
        try {
            await fs.mkdir(dirPath, { recursive: true });
            console.log(`Created upload directory: ${dirPath}`);
        } catch (error) {
            console.log(`Directory already exists: ${dirPath}`);
        }
    }

    require("dotenv").config();
const mongoose = require("mongoose");

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB ulandi"))
  .catch(err => console.log(err));

    
    console.log('Server initialized and ready');
    console.log('Available features:');
    console.log('1. Full theme support (light/dark/auto)');
    console.log('2. Audio messages (FIXED)');
    console.log('3. Message edit/delete for all message types');
    console.log('4. Contact context menu (right-click)');
    console.log('5. Block/Unblock users');
    console.log('6. Clear chat history');
    console.log('7. Remove contacts');
    console.log('8. Privacy settings with "unknown" status');
    console.log('9. Forward messages');
    console.log('10. Video/Audio calls');
});