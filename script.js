// Global variables
let socket;
let currentUser;
let selectedUserId = null;
let selectedUser = null;
let searchTimeout;
let typingTimeout;
let audioRecorder = null;
let audioChunks = [];
let isRecording = false;
let recordingTimer = null;
let recordingStartTime = null;
let currentCall = null;
let localStream = null;
let remoteStream = null;
let peerConnection = null;
let globalAudioPlayer = null; // Audio player ni saqlash uchun

// Initialize app
document.addEventListener('DOMContentLoaded', async () => {
    const token = localStorage.getItem('token');
    if (!token) {
        window.location.href = '/';
        return;
    }

    try {
        currentUser = JSON.parse(localStorage.getItem('user'));
        if (!currentUser) {
            logout();
            return;
        }

        console.log('Current user:', currentUser);

        updateUserUI();
        setupSocket();
        await loadContacts();
        setupEventListeners();
        await setupAudioRecording();

        // Apply saved theme
        applyTheme();

    } catch (error) {
        console.error('Initialization error:', error);
        logout();
    }
});

// Update user UI
function updateUserUI() {
    document.getElementById('current-user-name').textContent = currentUser.username;
    document.getElementById('current-user-avatar').src = currentUser.avatar || getDefaultAvatar(currentUser.username);
    
    document.getElementById('current-user-avatar').onerror = function() {
        this.src = getDefaultAvatar(currentUser.username);
    };
}

// Default avatar generator
function getDefaultAvatar(username) {
    return `https://ui-avatars.com/api/?name=${encodeURIComponent(username)}&background=random&color=fff&bold=true`;
}

// Apply theme from user settings
function applyTheme() {
    if (!currentUser || !currentUser.profile || !currentUser.profile.theme) return;
    
    const theme = currentUser.profile.theme;
    
    // Apply theme mode
    if (theme.mode === 'dark') {
        document.body.classList.add('dark-mode');
        document.body.classList.remove('light-mode');
    } else if (theme.mode === 'light') {
        document.body.classList.add('light-mode');
        document.body.classList.remove('dark-mode');
    } else if (theme.mode === 'auto') {
        if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
            document.body.classList.add('dark-mode');
            document.body.classList.remove('light-mode');
        } else {
            document.body.classList.add('light-mode');
            document.body.classList.remove('dark-mode');
        }
    }
    
    // Apply colors
    if (theme.primaryColor) {
        document.documentElement.style.setProperty('--primary-color', theme.primaryColor);
    }
    if (theme.backgroundColor) {
        document.documentElement.style.setProperty('--bg-color', theme.backgroundColor);
    }
    if (theme.textColor) {
        document.documentElement.style.setProperty('--text-color', theme.textColor);
    }
}

// Setup socket connection
function setupSocket() {
    socket = io();
    
    socket.emit('user-online', currentUser.id);
    console.log('Socket connected, user online:', currentUser.id);
    
    socket.on('connect', () => {
        console.log('Socket connected with ID:', socket.id);
    });
    
    socket.on('receive-message', handleNewMessage);
    socket.on('user-status-changed', handleUserStatusChanged);
    socket.on('contacts-updated', handleContactsUpdated);
    socket.on('user-typing', handleUserTyping);
    socket.on('message-deleted', handleMessageDeleted);
    socket.on('message-edited', handleMessageEdited);
    
    socket.on('incoming-call', handleIncomingCall);
    socket.on('call-accepted', handleCallAccepted);
    socket.on('call-rejected', handleCallRejected);
    socket.on('call-ended', handleCallEnded);
    
    socket.on('disconnect', () => {
        console.log('Socket disconnected');
    });
    
    socket.on('connect_error', (error) => {
        console.error('Socket connection error:', error);
    });
}

// Setup event listeners
function setupEventListeners() {
    document.getElementById('send-button').addEventListener('click', sendMessage);
    
    document.getElementById('message-input').addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });
    
    document.getElementById('message-input').addEventListener('input', () => {
        if (selectedUserId) {
            socket.emit('typing', {
                receiverId: selectedUserId,
                isTyping: true
            });
            
            clearTimeout(typingTimeout);
            typingTimeout = setTimeout(() => {
                socket.emit('typing', {
                    receiverId: selectedUserId,
                    isTyping: false
                });
            }, 1000);
        }
    });
    
    document.getElementById('search-button').addEventListener('click', performSearch);
    
    document.getElementById('search-input').addEventListener('input', (e) => {
        clearTimeout(searchTimeout);
        const query = e.target.value.trim();
        
        if (query.length === 0) {
            hideSearchResults();
            return;
        }
        
        if (query.length >= 1) {
            searchTimeout = setTimeout(() => performSearch(), 300);
        }
    });
    
    const fileUploadBtn = document.getElementById('file-upload-btn');
    const fileInput = document.getElementById('file-input');
    
    if (fileUploadBtn && fileInput) {
        fileUploadBtn.addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', handleFileUpload);
    }
    
    const voiceBtn = document.getElementById('voice-message-btn');
    if (voiceBtn) {
        voiceBtn.addEventListener('mousedown', startVoiceRecording);
        voiceBtn.addEventListener('mouseup', stopVoiceRecording);
        voiceBtn.addEventListener('mouseleave', stopVoiceRecording);
        voiceBtn.addEventListener('touchstart', (e) => {
            e.preventDefault();
            startVoiceRecording();
        });
        voiceBtn.addEventListener('touchend', (e) => {
            e.preventDefault();
            stopVoiceRecording();
        });
    }
    
    document.addEventListener('click', (e) => {
        const searchResults = document.getElementById('search-results');
        const searchInput = document.getElementById('search-input');
        
        if (searchResults && searchResults.classList.contains('active') && 
            !searchResults.contains(e.target) && 
            e.target !== searchInput) {
            hideSearchResults();
        }
    });
}

// Setup audio recording
async function setupAudioRecording() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ 
            audio: {
                channelCount: 1,
                sampleRate: 44100,
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            } 
        });
        
        // Brauzer qo'llab-quvvatlaydigan audio formatlar
        const mimeTypes = [
            'audio/webm;codecs=opus',
            'audio/webm',
            'audio/ogg;codecs=opus',
            'audio/mp4',
            'audio/mpeg'
        ];
        
        let selectedMimeType = 'audio/webm';
        for (const mimeType of mimeTypes) {
            if (MediaRecorder.isTypeSupported(mimeType)) {
                selectedMimeType = mimeType;
                break;
            }
        }
        
        console.log('Selected audio format:', selectedMimeType);
        
        audioRecorder = new MediaRecorder(stream, {
            mimeType: selectedMimeType,
            audioBitsPerSecond: 128000
        });
        
        audioRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
                audioChunks.push(event.data);
            }
        };
        
        audioRecorder.onstop = async () => {
            if (audioChunks.length === 0) return;
            
            const audioBlob = new Blob(audioChunks, { 
                type: selectedMimeType 
            });
            const duration = Date.now() - recordingStartTime;
            
            await sendVoiceMessage(audioBlob, duration);
            audioChunks = [];
        };
        
        audioRecorder.onerror = (event) => {
            console.error('Audio recording error:', event.error);
            showNotification('Audio yozishda xatolik', 'error');
        };
        
        console.log('Audio recording setup complete');
    } catch (error) {
        console.error('Error setting up audio recording:', error);
        showNotification('Microfon ruxsati kerak', 'error');
    }
}

// Start voice recording
function startVoiceRecording() {
    if (!audioRecorder || isRecording) return;
    
    audioChunks = [];
    recordingStartTime = Date.now();
    
    try {
        audioRecorder.start(100); // 100ms interval
        isRecording = true;
        
        const voiceBtn = document.getElementById('voice-message-btn');
        if (voiceBtn) {
            voiceBtn.innerHTML = '<i class="fas fa-stop-circle"></i>';
            voiceBtn.classList.add('recording');
        }
        
        showRecordingUI();
        
        recordingTimer = setInterval(updateRecordingTimer, 1000);
        
        showNotification('Ovoz yozilmoqda... Qo\'yish uchun tugmani qo\'ying', 'info');
    } catch (error) {
        console.error('Error starting recording:', error);
    }
}

// Show recording UI
function showRecordingUI() {
    const recordingUI = document.createElement('div');
    recordingUI.id = 'recording-ui';
    recordingUI.innerHTML = `
        <div class="recording-container">
            <div class="recording-animation">
                <div class="recording-dot"></div>
                <div class="recording-dot"></div>
                <div class="recording-dot"></div>
            </div>
            <div class="recording-timer" id="recording-timer">00:00</div>
            <button class="btn-cancel-recording" onclick="cancelRecording()">
                <i class="fas fa-times"></i> Bekor qilish
            </button>
        </div>
    `;
    recordingUI.style.cssText = `
        position: fixed;
        bottom: 100px;
        left: 50%;
        transform: translateX(-50%);
        background: rgba(0,0,0,0.9);
        color: white;
        padding: 20px;
        border-radius: 10px;
        z-index: 1000;
        display: flex;
        align-items: center;
        gap: 20px;
        box-shadow: 0 5px 20px rgba(0,0,0,0.3);
    `;
    
    document.body.appendChild(recordingUI);
}

// Update recording timer
function updateRecordingTimer() {
    if (!recordingStartTime) return;
    
    const elapsed = Date.now() - recordingStartTime;
    const seconds = Math.floor(elapsed / 1000);
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    
    const timerElement = document.getElementById('recording-timer');
    if (timerElement) {
        timerElement.textContent = 
            `${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
    }
}

// Stop voice recording
function stopVoiceRecording() {
    if (!audioRecorder || !isRecording) return;
    
    try {
        audioRecorder.stop();
        isRecording = false;
        
        const recordingUI = document.getElementById('recording-ui');
        if (recordingUI) {
            recordingUI.remove();
        }
        
        if (recordingTimer) {
            clearInterval(recordingTimer);
            recordingTimer = null;
        }
        
        const voiceBtn = document.getElementById('voice-message-btn');
        if (voiceBtn) {
            voiceBtn.innerHTML = '<i class="fas fa-microphone"></i>';
            voiceBtn.classList.remove('recording');
        }
        
        recordingStartTime = null;
    } catch (error) {
        console.error('Error stopping recording:', error);
    }
}

// Cancel recording
function cancelRecording() {
    if (audioRecorder && isRecording) {
        audioRecorder.stop();
    }
    
    audioChunks = [];
    isRecording = false;
    
    const recordingUI = document.getElementById('recording-ui');
    if (recordingUI) {
        recordingUI.remove();
    }
    
    if (recordingTimer) {
        clearInterval(recordingTimer);
        recordingTimer = null;
    }
    
    const voiceBtn = document.getElementById('voice-message-btn');
    if (voiceBtn) {
        voiceBtn.innerHTML = '<i class="fas fa-microphone"></i>';
        voiceBtn.classList.remove('recording');
    }
    
    recordingStartTime = null;
    
    showNotification('Ovoz yozish bekor qilindi', 'info');
}

// Send voice message
async function sendVoiceMessage(audioBlob, duration) {
    if (!selectedUserId || !selectedUser) {
        showNotification('Avval kontakt tanlang', 'error');
        return;
    }
    
    try {
        const formData = new FormData();
        formData.append('audio', audioBlob, `voice-${Date.now()}.webm`);
        formData.append('duration', Math.round(duration / 1000));
        
        showNotification('Ovozli xabar yuborilmoqda...', 'info');
        
        const uploadResponse = await fetch('/api/upload-audio', {
            method: 'POST',
            body: formData
        });
        
        const uploadData = await uploadResponse.json();
        
        if (uploadData.success) {
            const tempMessageId = 'temp_' + Date.now();
            
            displayTempMessage('Ovozli xabar', tempMessageId, 'audio');
            
            socket.emit('send-message', {
                senderId: currentUser.id,
                receiverId: selectedUserId,
                content: 'Ovozli xabar',
                type: 'audio',
                tempId: tempMessageId,
                file: uploadData.file
            });
            
            showNotification('Ovozli xabar yuborildi', 'success');
        } else {
            showNotification('Ovozli xabar yuborishda xatolik', 'error');
        }
    } catch (error) {
        console.error('Error sending voice message:', error);
        showNotification('Ovozli xabar yuborishda xatolik', 'error');
    }
}

// Handle file upload
async function handleFileUpload(event) {
    const file = event.target.files[0];
    if (!file || !selectedUserId || !selectedUser) {
        showNotification('Avval kontakt tanlang', 'error');
        return;
    }
    
    try {
        if (file.size > 100 * 1024 * 1024) {
            showNotification('Fayl hajmi 100MB dan kichik bo\'lishi kerak', 'error');
            return;
        }
        
        const formData = new FormData();
        formData.append('file', file);
        
        showNotification('Fayl yuklanmoqda...', 'info');
        
        const response = await fetch('/api/upload-file', {
            method: 'POST',
            body: formData
        });
        
        const data = await response.json();
        
        if (data.success) {
            const tempMessageId = 'temp_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
            
            displayTempMessage(`${file.name} (${formatFileSize(file.size)})`, tempMessageId, data.file.type);
            
            socket.emit('send-message', {
                senderId: currentUser.id,
                receiverId: selectedUserId,
                content: `Fayl yuborildi: ${file.name}`,
                type: data.file.type,
                tempId: tempMessageId,
                file: data.file
            });
            
            showNotification('Fayl muvaffaqiyatli yuborildi', 'success');
        } else {
            showNotification('Fayl yuklashda xatolik: ' + (data.error || 'Noma\'lum xatolik'), 'error');
        }
    } catch (error) {
        console.error('Error uploading file:', error);
        showNotification('Fayl yuklashda xatolik', 'error');
    }
    
    event.target.value = '';
}

// Format file size
function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Load contacts
async function loadContacts() {
    try {
        console.log('Loading contacts for user:', currentUser.id);
        
        const response = await fetch(`/api/contacts?userId=${currentUser.id}`);
        const data = await response.json();
        
        if (data.success) {
            console.log(`Loaded ${data.contacts.length} contacts:`, data.contacts);
            displayContacts(data.contacts);
            updateContactsCount(data.contacts.length);
        } else {
            console.error('Failed to load contacts:', data.error);
            showNotification('Kontaktlarni yuklashda xatolik', 'error');
        }
    } catch (error) {
        console.error('Error loading contacts:', error);
        showNotification('Kontaktlarni yuklashda tarmoq xatosi', 'error');
    }
}

// Display contacts
function displayContacts(contacts) {
    const contactsList = document.getElementById('contacts-list');
    const noContacts = document.getElementById('no-contacts');
    
    if (!contactsList) return;
    
    console.log(`Displaying ${contacts.length} contacts`);
    
    if (contacts.length === 0) {
        contactsList.innerHTML = '';
        if (noContacts) noContacts.style.display = 'flex';
        return;
    }
    
    if (noContacts) noContacts.style.display = 'none';
    
    const sortedContacts = [...contacts].sort((a, b) => {
        const timeA = new Date(a.lastSeen || 0);
        const timeB = new Date(b.lastSeen || 0);
        return timeB - timeA;
    });
    
    contactsList.innerHTML = sortedContacts.map(contact => `
        <div class="contact-item" data-user-id="${contact.id}" onclick="selectContactFromList('${contact.id}')">
            <img src="${contact.avatar || getDefaultAvatar(contact.username)}" 
                 alt="${contact.username}" 
                 class="avatar"
                 onerror="this.src='${getDefaultAvatar(contact.username)}'">
            <div class="contact-info">
                <div class="contact-name">${contact.username}</div>
                <div class="contact-status">
                    <span class="status ${contact.status || 'offline'}"></span>
                    ${contact.status || 'offline'}
                </div>
                <div class="contact-actions">
                    <button class="contact-action-btn profile-btn" onclick="viewUserProfile('${contact.id}', event)" title="Profilni ko'rish">
                        <i class="fas fa-user"></i>
                    </button>
                    <button class="contact-action-btn call-btn" onclick="startCall('${contact.id}', 'audio', event)" title="Audio qo'ng'iroq">
                        <i class="fas fa-phone"></i>
                    </button>
                    <button class="contact-action-btn video-btn" onclick="startCall('${contact.id}', 'video', event)" title="Video qo'ng'iroq">
                        <i class="fas fa-video"></i>
                    </button>
                </div>
            </div>
        </div>
    `).join('');
    
    updateActiveContact();
}

// Select contact from list
function selectContactFromList(userId) {
    const contactsList = document.getElementById('contacts-list');
    const contactItems = contactsList.querySelectorAll('.contact-item');
    
    for (const item of contactItems) {
        if (item.dataset.userId === userId) {
            const username = item.querySelector('.contact-name').textContent;
            const avatar = item.querySelector('img').src;
            const status = item.querySelector('.status').className.includes('online') ? 'online' : 'offline';
            
            selectContact({
                id: userId,
                username: username,
                avatar: avatar,
                status: status
            });
            break;
        }
    }
}

// Update active contact styling
function updateActiveContact() {
    document.querySelectorAll('.contact-item').forEach(item => {
        item.classList.remove('active');
        if (selectedUserId && item.dataset.userId === selectedUserId) {
            item.classList.add('active');
        }
    });
}

// Update contacts count
function updateContactsCount(count) {
    const badge = document.getElementById('contacts-count');
    if (badge) {
        badge.textContent = count;
        badge.style.display = count > 0 ? 'inline-block' : 'none';
    }
}

// Select contact
async function selectContact(contact) {
    if (!contact) return;
    
    console.log('Selecting contact:', contact.username);
    selectedUserId = contact.id;
    selectedUser = contact;
    
    updateActiveContact();
    
    const chatPartnerInfo = document.getElementById('chat-partner-info');
    if (chatPartnerInfo) {
        chatPartnerInfo.innerHTML = `
            <img src="${contact.avatar || getDefaultAvatar(contact.username)}" 
                 alt="${contact.username}" 
                 class="avatar"
                 onerror="this.src='${getDefaultAvatar(contact.username)}'"
                 onclick="viewUserProfile('${contact.id}')"
                 style="cursor: pointer;">
            <div>
                <h3 onclick="viewUserProfile('${contact.id}')" style="cursor: pointer;">${contact.username}</h3>
                <div class="contact-status">
                    <span class="status ${contact.status || 'offline'}"></span>
                    ${contact.status || 'offline'}
                </div>
            </div>
            <div class="chat-actions">
                <button class="chat-action-btn call-btn" onclick="startCall('${contact.id}', 'audio', event)" title="Audio qo'ng'iroq">
                    <i class="fas fa-phone"></i>
                </button>
                <button class="chat-action-btn video-btn" onclick="startCall('${contact.id}', 'video', event)" title="Video qo'ng'iroq">
                    <i class="fas fa-video"></i>
                </button>
            </div>
        `;
    }
    
    const messageInputContainer = document.getElementById('message-input-container');
    const messageInput = document.getElementById('message-input');
    const sendButton = document.getElementById('send-button');
    
    if (messageInputContainer) messageInputContainer.style.display = 'flex';
    if (messageInput) {
        messageInput.disabled = false;
        messageInput.focus();
    }
    if (sendButton) sendButton.disabled = false;
    
    await loadMessages(contact.id);
    
    hideSearchResults();
}

// Load messages
async function loadMessages(userId) {
    try {
        console.log('Loading messages with user:', userId);
        
        const response = await fetch(`/api/messages?userId1=${currentUser.id}&userId2=${userId}`);
        const data = await response.json();
        
        if (data.success) {
            console.log(`Loaded ${data.messages.length} messages`);
            displayMessages(data.messages);
        } else {
            console.error('Failed to load messages:', data.error);
            showNotification('Xabarlarni yuklashda xatolik', 'error');
        }
    } catch (error) {
        console.error('Error loading messages:', error);
        showNotification('Xabarlarni yuklashda tarmoq xatosi', 'error');
    }
}

// Display messages
function displayMessages(messages) {
    const container = document.getElementById('messages-container');
    
    if (!container) return;
    
    if (messages.length === 0) {
        container.innerHTML = `
            <div class="no-messages">
                <i class="fas fa-comment-slash fa-3x"></i>
                <h3>Hozircha xabarlar yo'q</h3>
                <p>${selectedUser ? selectedUser.username : 'bu foydalanuvchi'} bilan suhbatni boshlang</p>
            </div>
        `;
        return;
    }
    
    messages.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    
    container.innerHTML = messages.map(message => {
        const isSent = message.senderId === currentUser.id;
        const time = new Date(message.timestamp).toLocaleTimeString([], { 
            hour: '2-digit', 
            minute: '2-digit' 
        });
        
        let messageContent = '';
        
        if (message.isDeleted) {
            messageContent = `
                <div class="message-content deleted">
                    <i class="fas fa-trash"></i> Xabar o'chirilgan
                </div>
            `;
        } else if (message.file) {
            messageContent = createFileMessageElement(message);
        } else {
            messageContent = `
                <div class="message-content">${escapeHtml(message.content)}</div>
                ${message.isEdited ? '<small class="edited-badge">tahrirlangan</small>' : ''}
            `;
        }
        
        const messageActions = isSent && !message.isDeleted ? `
            <div class="message-actions">
                <button class="message-action-btn edit-btn" onclick="editMessage('${message.id}')" title="Tahrirlash">
                    <i class="fas fa-edit"></i>
                </button>
                <button class="message-action-btn delete-btn" onclick="deleteMessage('${message.id}')" title="O'chirish">
                    <i class="fas fa-trash"></i>
                </button>
            </div>
        ` : '';
        
        return `
            <div class="message ${isSent ? 'sent' : 'received'}" data-message-id="${message.id}">
                ${messageContent}
                <div class="message-time">
                    ${time}
                    ${isSent ? (message.read ? '✓✓' : '✓') : ''}
                </div>
                ${messageActions}
            </div>
        `;
    }).join('');
    
    container.scrollTop = container.scrollHeight;
}

// Create file message element
function createFileMessageElement(message) {
    const file = message.file;
    
    if (file.type === 'image') {
        return `
            <div class="message-content file-message">
                <div class="file-preview">
                    <img src="${file.apiUrl || file.url}" 
                         alt="${file.name}" 
                         class="message-image" 
                         onclick="openImageModal('${file.apiUrl || file.url}')">
                    <div class="file-overlay">
                        <button class="btn-download" onclick="downloadFile('${file.folder}', '${file.filename}', '${file.name}')">
                            <i class="fas fa-download"></i>
                        </button>
                    </div>
                </div>
                <div class="file-info">
                    <span class="file-name">${file.name}</span>
                    <small class="file-size">${formatFileSize(file.size)}</small>
                </div>
            </div>
        `;
    } else if (file.type === 'audio') {
        return `
            <div class="message-content audio-message">
                <div class="audio-player">
                    <button class="btn-play-audio" onclick="playAudioFile(${JSON.stringify(file).replace(/"/g, '&quot;')})">
                        <i class="fas fa-play"></i>
                    </button>
                    <div class="audio-info">
                        <span class="file-name">Ovozli xabar</span>
                        <small class="file-size">${formatFileSize(file.size)}</small>
                        ${file.duration ? `<small class="audio-duration">${formatDuration(file.duration)}</small>` : ''}
                    </div>
                    <button class="btn-download" onclick="downloadFile('${file.folder}', '${file.filename}', '${file.name}')">
                        <i class="fas fa-download"></i>
                    </button>
                </div>
            </div>
        `;
    } else if (file.type === 'video') {
        return `
            <div class="message-content video-message">
                <div class="video-preview">
                    <div class="video-thumbnail" onclick="playVideoFile(${JSON.stringify(file).replace(/"/g, '&quot;')})">
                        <i class="fas fa-play-circle fa-3x"></i>
                        <div class="video-info">
                            <span class="file-name">${file.name}</span>
                            <small class="file-size">${formatFileSize(file.size)}</small>
                        </div>
                    </div>
                    <button class="btn-download" onclick="downloadFile('${file.folder}', '${file.filename}', '${file.name}')">
                        <i class="fas fa-download"></i>
                    </button>
                </div>
            </div>
        `;
    } else {
        return `
            <div class="message-content file-message">
                <div class="file-icon">
                    <i class="fas ${getFileIcon(file.mimetype)} fa-2x"></i>
                </div>
                <div class="file-info">
                    <a href="${file.downloadUrl || file.url}" 
                       download="${file.name}" 
                       class="file-name">
                        ${file.name}
                    </a>
                    <small class="file-size">${formatFileSize(file.size)}</small>
                </div>
            </div>
        `;
    }
}

// Get file icon based on mimetype
function getFileIcon(mimetype) {
    if (mimetype.includes('pdf')) return 'fa-file-pdf text-danger';
    if (mimetype.includes('word')) return 'fa-file-word text-primary';
    if (mimetype.includes('excel') || mimetype.includes('spreadsheet')) return 'fa-file-excel text-success';
    if (mimetype.includes('zip') || mimetype.includes('compressed')) return 'fa-file-archive text-warning';
    if (mimetype.includes('audio')) return 'fa-file-audio text-info';
    if (mimetype.includes('video')) return 'fa-file-video text-danger';
    return 'fa-file text-secondary';
}

// Format duration
function formatDuration(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// Play audio file - TO'G'IRLANGAN VERSIYA
function playAudioFile(fileInfo) {
    try {
        console.log('Playing audio file:', fileInfo);
        
        // Agar oldingi audio ijro etilayotgan bo'lsa, to'xtatamiz
        if (globalAudioPlayer && !globalAudioPlayer.paused) {
            globalAudioPlayer.pause();
            globalAudioPlayer.currentTime = 0;
        }
        
        // Yangi audio element yaratamiz
        globalAudioPlayer = new Audio();
        
        // Audio URL ni olish
        const audioUrl = fileInfo.apiUrl || fileInfo.url;
        console.log('Audio URL:', audioUrl);
        
        globalAudioPlayer.src = audioUrl;
        globalAudioPlayer.preload = 'auto';
        
        // Audio error handler
        globalAudioPlayer.onerror = function(e) {
            console.error('Audio error:', e);
            console.error('Audio error code:', globalAudioPlayer.error);
            
            // Agar URL xato bo'lsa, alternative URL sinab ko'rish
            if (audioUrl.includes('/uploads/')) {
                const altUrl = audioUrl.replace('/uploads/', '/api/media/');
                console.log('Trying alternative URL:', altUrl);
                globalAudioPlayer.src = altUrl;
                globalAudioPlayer.load();
            } else {
                showNotification('Audio faylni ochish mumkin emas', 'error');
            }
        };
        
        // Audio play handler
        globalAudioPlayer.oncanplaythrough = function() {
            console.log('Audio ready to play');
        };
        
        // Audio ended handler
        globalAudioPlayer.onended = function() {
            console.log('Audio playback ended');
        };
        
        // Audio timeupdate handler - pauza va davom ettirish uchun
        globalAudioPlayer.ontimeupdate = function() {
            // Audio o'ynayotganda timeupdate event ishlaydi
        };
        
        // Audio play qilish
        globalAudioPlayer.play().catch(error => {
            console.error('Play error:', error);
            
            // Brauzer autoplay siyosati uchun
            if (error.name === 'NotAllowedError') {
                showNotification('Audio ijro etish uchun tugmani bosing', 'info');
                
                // Play tugmasi yaratish
                const playBtn = document.createElement('button');
                playBtn.innerHTML = '<i class="fas fa-play"></i> Audio ijro etish';
                playBtn.style.cssText = `
                    position: fixed;
                    top: 50%;
                    left: 50%;
                    transform: translate(-50%, -50%);
                    padding: 15px 30px;
                    background: #667eea;
                    color: white;
                    border: none;
                    border-radius: 25px;
                    cursor: pointer;
                    z-index: 10000;
                    font-size: 16px;
                    box-shadow: 0 10px 30px rgba(0,0,0,0.3);
                `;
                
                playBtn.onclick = function() {
                    globalAudioPlayer.play().catch(err => {
                        console.error('Manual play error:', err);
                        showNotification('Audio ijro etishda muammo', 'error');
                    });
                    document.body.removeChild(playBtn);
                };
                
                document.body.appendChild(playBtn);
                
                // 5 sekunddan keyin tugmani olib tashlash
                setTimeout(() => {
                    if (document.body.contains(playBtn)) {
                        document.body.removeChild(playBtn);
                    }
                }, 5000);
            } else {
                showNotification('Audio ijro etishda muammo', 'error');
            }
        });
        
    } catch (error) {
        console.error('Error playing audio:', error);
        showNotification('Audio faylni ochishda xato', 'error');
    }
}

// Play video file
function playVideoFile(fileInfo) {
    try {
        console.log('Playing video file:', fileInfo);
        
        const videoUrl = fileInfo.apiUrl || fileInfo.url;
        
        const modal = document.createElement('div');
        modal.className = 'video-modal';
        modal.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0,0,0,0.9);
            display: flex;
            justify-content: center;
            align-items: center;
            z-index: 10000;
            cursor: pointer;
        `;
        
        const video = document.createElement('video');
        video.style.cssText = `
            max-width: 90%;
            max-height: 90%;
            border-radius: 10px;
            box-shadow: 0 0 30px rgba(0,0,0,0.5);
        `;
        video.controls = true;
        video.autoplay = true;
        video.src = videoUrl;
        
        const closeBtn = document.createElement('button');
        closeBtn.innerHTML = '&times;';
        closeBtn.style.cssText = `
            position: absolute;
            top: 20px;
            right: 30px;
            background: transparent;
            border: none;
            color: white;
            font-size: 40px;
            cursor: pointer;
            z-index: 10001;
        `;
        closeBtn.onclick = function() {
            document.body.removeChild(modal);
        };
        
        modal.appendChild(video);
        modal.appendChild(closeBtn);
        
        modal.onclick = function(e) {
            if (e.target === modal) {
                document.body.removeChild(modal);
            }
        };
        
        document.body.appendChild(modal);
        
    } catch (error) {
        console.error('Error playing video:', error);
        showNotification('Video faylni ochishda xato', 'error');
    }
}

// Download file
function downloadFile(folder, filename, originalName) {
    const downloadUrl = `/api/download/${folder}/${filename}`;
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = originalName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}

// Open image in modal
function openImageModal(imageUrl) {
    const modal = document.createElement('div');
    modal.className = 'image-modal';
    modal.innerHTML = `
        <div class="modal-content">
            <span class="close-modal" onclick="this.parentElement.parentElement.remove()">&times;</span>
            <img src="${imageUrl}" alt="Full size image">
        </div>
    `;
    modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0,0,0,0.9);
        display: flex;
        justify-content: center;
        align-items: center;
        z-index: 10000;
    `;
    document.body.appendChild(modal);
}

// Send message
async function sendMessage() {
    const input = document.getElementById('message-input');
    const content = input.value.trim();
    
    if (!content || !selectedUserId || !selectedUser) {
        console.log('Cannot send message: missing content or recipient');
        return;
    }
    
    console.log('Sending message to:', selectedUser.username, 'Content:', content);
    
    const tempMessageId = 'temp_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    
    displayTempMessage(content, tempMessageId, 'text');
    
    input.value = '';
    input.focus();
    
    socket.emit('send-message', {
        senderId: currentUser.id,
        receiverId: selectedUserId,
        content: content,
        type: 'text',
        tempId: tempMessageId
    });
}

// Display temporary message
function displayTempMessage(content, tempId, type = 'text') {
    const container = document.getElementById('messages-container');
    
    if (!container) return;
    
    const noMessages = container.querySelector('.no-messages');
    const newChatStart = container.querySelector('.new-chat-start');
    const welcomeMessage = container.querySelector('.welcome-message');
    
    if (noMessages || newChatStart || welcomeMessage) {
        container.innerHTML = '';
    }
    
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message sent';
    messageDiv.id = tempId;
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    let messageContent = '';
    if (type === 'audio') {
        messageContent = `
            <div class="message-content audio-message">
                <div class="file-info">
                    <span>Ovozli xabar</span>
                    <small>Yuborilmoqda...</small>
                </div>
            </div>
        `;
    } else if (type === 'image' || type === 'file') {
        messageContent = `
            <div class="message-content file-message">
                <div class="file-info">
                    <span>${content}</span>
                    <small>Yuklanmoqda...</small>
                </div>
            </div>
        `;
    } else {
        messageContent = `<div class="message-content">${escapeHtml(content)}</div>`;
    }
    
    messageDiv.innerHTML = `
        ${messageContent}
        <div class="message-time">${time} ✓</div>
    `;
    
    container.appendChild(messageDiv);
    container.scrollTop = container.scrollHeight;
}

// Delete message
function deleteMessage(messageId) {
    if (!confirm('Bu xabarni o\'chirishni xohlaysizmi?')) return;
    
    socket.emit('delete-message', {
        messageId: messageId,
        userId: currentUser.id
    });
}

// Edit message
function editMessage(messageId) {
    const messageElement = document.querySelector(`[data-message-id="${messageId}"]`);
    if (!messageElement) return;
    
    const messageContent = messageElement.querySelector('.message-content');
    const currentText = messageContent.textContent;
    
    const newText = prompt('Xabaringizni tahrirlang:', currentText);
    if (newText !== null && newText.trim() !== '' && newText !== currentText) {
        socket.emit('edit-message', {
            messageId: messageId,
            userId: currentUser.id,
            content: newText.trim()
        });
    }
}

// Handle message deleted event
function handleMessageDeleted(data) {
    const messageElement = document.querySelector(`[data-message-id="${data.messageId}"]`);
    if (messageElement) {
        messageElement.querySelector('.message-content').innerHTML = `
            <i class="fas fa-trash"></i> Xabar o'chirilgan
        `;
        messageElement.querySelector('.message-content').classList.add('deleted');
        
        const messageActions = messageElement.querySelector('.message-actions');
        if (messageActions) {
            messageActions.remove();
        }
    }
}

// Handle message edited event
function handleMessageEdited(data) {
    const messageElement = document.querySelector(`[data-message-id="${data.messageId}"]`);
    if (messageElement) {
        const messageContent = messageElement.querySelector('.message-content');
        if (messageContent && !messageContent.classList.contains('deleted')) {
            messageContent.textContent = data.content;
            
            if (!messageElement.querySelector('.edited-badge')) {
                messageContent.insertAdjacentHTML('afterend', '<small class="edited-badge">tahrirlangan</small>');
            }
        }
    }
}

// Handle new message from server
function handleNewMessage(message) {
    console.log('Received message from server:', message);
    
    if (message.senderId === currentUser.id && message.tempId) {
        const tempElement = document.getElementById(message.tempId);
        if (tempElement) {
            console.log('Updating temporary message with ID:', message.tempId);
            const time = new Date(message.timestamp).toLocaleTimeString([], { 
                hour: '2-digit', 
                minute: '2-digit' 
            });
            tempElement.id = message.id;
            tempElement.dataset.messageId = message.id;
            tempElement.querySelector('.message-time').textContent = `${time} ✓`;
            
            if (message.file) {
                const fileInfo = tempElement.querySelector('.file-info');
                if (fileInfo) {
                    if (message.file.type === 'audio') {
                        fileInfo.innerHTML = `
                            <span>Ovozli xabar</span>
                            <small>${formatFileSize(message.file.size)}</small>
                        `;
                    } else {
                        fileInfo.innerHTML = `
                            <span>${message.file.name}</span>
                            <small>${formatFileSize(message.file.size)}</small>
                        `;
                    }
                }
            }
        }
        return;
    }
    
    const isCurrentConversation = 
        (message.senderId === selectedUserId && message.receiverId === currentUser.id) ||
        (message.senderId === currentUser.id && message.receiverId === selectedUserId);
    
    if (isCurrentConversation) {
        console.log('Message is for current conversation');
        const container = document.getElementById('messages-container');
        
        if (!container) return;
        
        const noMessages = container.querySelector('.no-messages');
        const newChatStart = container.querySelector('.new-chat-start');
        const welcomeMessage = container.querySelector('.welcome-message');
        
        if (noMessages || newChatStart || welcomeMessage) {
            container.innerHTML = '';
        }
        
        const existingMessage = document.querySelector(`[data-message-id="${message.id}"]`);
        if (!existingMessage) {
            const messageElement = createMessageElement(message);
            container.appendChild(messageElement);
            container.scrollTop = container.scrollHeight;
        } else {
            console.log('Message already displayed, skipping');
        }
    }
    
    if (message.senderId !== currentUser.id) {
        console.log('Message from new user, reloading contacts...');
        setTimeout(() => {
            loadContacts();
        }, 100);
    }
}

// Create message element
function createMessageElement(message) {
    const isSent = message.senderId === currentUser.id;
    const time = new Date(message.timestamp).toLocaleTimeString([], { 
        hour: '2-digit', 
        minute: '2-digit' 
    });
    
    let messageContent = '';
    
    if (message.isDeleted) {
        messageContent = `
            <div class="message-content deleted">
                <i class="fas fa-trash"></i> Xabar o'chirilgan
            </div>
        `;
    } else if (message.file) {
        messageContent = createFileMessageElement(message);
    } else {
        messageContent = `
            <div class="message-content">${escapeHtml(message.content)}</div>
            ${message.isEdited ? '<small class="edited-badge">tahrirlangan</small>' : ''}
        `;
    }
    
    const messageActions = isSent && !message.isDeleted ? `
        <div class="message-actions">
            <button class="message-action-btn edit-btn" onclick="editMessage('${message.id}')" title="Tahrirlash">
                <i class="fas fa-edit"></i>
            </button>
            <button class="message-action-btn delete-btn" onclick="deleteMessage('${message.id}')" title="O'chirish">
                <i class="fas fa-trash"></i>
            </button>
        </div>
    ` : '';
    
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${isSent ? 'sent' : 'received'}`;
    messageDiv.dataset.messageId = message.id;
    messageDiv.innerHTML = `
        ${messageContent}
        <div class="message-time">
            ${time}
            ${isSent ? (message.read ? '✓✓' : '✓') : ''}
        </div>
        ${messageActions}
    `;
    
    return messageDiv;
}

// Perform search
async function performSearch() {
    const query = document.getElementById('search-input').value.trim();
    
    if (!query) {
        hideSearchResults();
        return;
    }
    
    console.log('Searching for:', query);
    
    try {
        const response = await fetch(`/api/search?query=${encodeURIComponent(query)}&currentUserId=${currentUser.id}`);
        const data = await response.json();
        
        if (data.success) {
            console.log(`Found ${data.users.length} users`);
            displaySearchResults(data.users);
        } else {
            console.error('Search failed:', data.error);
            showSearchError('Qidiruvda xatolik');
        }
    } catch (error) {
        console.error('Search error:', error);
        showSearchError('Qidiruvda tarmoq xatosi');
    }
}

// Display search results
function displaySearchResults(users) {
    const resultsContainer = document.getElementById('search-results');
    if (!resultsContainer) return;
    
    if (users.length === 0) {
        resultsContainer.innerHTML = `
            <div class="no-results">
                <i class="fas fa-search"></i>
                <p>"${document.getElementById('search-input').value}" uchun foydalanuvchilar topilmadi</p>
            </div>
        `;
        resultsContainer.classList.add('active');
        return;
    }
    
    resultsContainer.innerHTML = users.map(user => `
        <div class="search-result-item" onclick="viewUserProfile('${user.id}')">
            <img src="${user.avatar || getDefaultAvatar(user.username)}" 
                 alt="${user.username}" 
                 onerror="this.src='${getDefaultAvatar(user.username)}'">
            <div class="search-result-info">
                <div class="search-result-name">${user.username}</div>
                <div class="search-result-email">${user.email}</div>
                <div class="search-result-status">
                    <span class="status ${user.status || 'offline'}"></span>
                    ${user.status || 'offline'}
                </div>
            </div>
            <button class="btn-start-chat" data-user-id="${user.id}" data-username="${user.username}">
                <i class="fas fa-comment"></i> Xabar
            </button>
        </div>
    `).join('');
    
    resultsContainer.classList.add('active');
    
    document.querySelectorAll('.btn-start-chat').forEach(button => {
        button.addEventListener('click', (e) => {
            e.stopPropagation();
            const userId = button.dataset.userId;
            const username = button.dataset.username;
            const user = users.find(u => u.id === userId);
            startChatWithUser(user || { id: userId, username: username });
        });
    });
    
    document.querySelectorAll('.search-result-item').forEach(item => {
        item.addEventListener('click', (e) => {
            if (!e.target.classList.contains('btn-start-chat')) {
                const button = item.querySelector('.btn-start-chat');
                if (button) {
                    const userId = button.dataset.userId;
                    const username = button.dataset.username;
                    const user = users.find(u => u.id === userId);
                    startChatWithUser(user || { id: userId, username: username });
                }
            }
        });
    });
}

// Start chat with user
function startChatWithUser(user) {
    if (!user || !user.id) {
        console.error('Cannot start chat: invalid user data');
        return;
    }
    
    console.log('Starting chat with user:', user.username);
    
    const existingContact = document.querySelector(`.contact-item[data-user-id="${user.id}"]`);
    
    if (existingContact) {
        existingContact.click();
    } else {
        selectedUserId = user.id;
        selectedUser = user;
        
        const chatPartnerInfo = document.getElementById('chat-partner-info');
        if (chatPartnerInfo) {
            chatPartnerInfo.innerHTML = `
                <img src="${user.avatar || getDefaultAvatar(user.username)}" 
                     alt="${user.username}" 
                     class="avatar"
                     onerror="this.src='${getDefaultAvatar(user.username)}'"
                     onclick="viewUserProfile('${user.id}')"
                     style="cursor: pointer;">
                <div>
                    <h3 onclick="viewUserProfile('${user.id}')" style="cursor: pointer;">${user.username}</h3>
                    <div class="contact-status">
                        <span class="status ${user.status || 'offline'}"></span>
                        ${user.status || 'offline'}
                    </div>
                </div>
                <div class="chat-actions">
                    <button class="chat-action-btn call-btn" onclick="startCall('${user.id}', 'audio', event)" title="Audio qo'ng'iroq">
                        <i class="fas fa-phone"></i>
                    </button>
                    <button class="chat-action-btn video-btn" onclick="startCall('${user.id}', 'video', event)" title="Video qo'ng'iroq">
                        <i class="fas fa-video"></i>
                    </button>
                </div>
            `;
        }
        
        const messageInputContainer = document.getElementById('message-input-container');
        const messageInput = document.getElementById('message-input');
        const sendButton = document.getElementById('send-button');
        
        if (messageInputContainer) messageInputContainer.style.display = 'flex';
        if (messageInput) {
            messageInput.disabled = false;
            messageInput.focus();
        }
        if (sendButton) sendButton.disabled = false;
        
        const container = document.getElementById('messages-container');
        if (container) {
            container.innerHTML = `
                <div class="new-chat-start">
                    <i class="fas fa-user-plus fa-3x"></i>
                    <h3>${user.username} bilan suhbatni boshlang</h3>
                    <p>${user.username} ni kontaktlaringizga qo'shish uchun birinchi xabaringizni yuboring</p>
                </div>
            `;
        }
    }
    
    hideSearchResults();
    document.getElementById('search-input').value = '';
}

// Hide search results
function hideSearchResults() {
    const resultsContainer = document.getElementById('search-results');
    if (resultsContainer) {
        resultsContainer.classList.remove('active');
    }
}

// ========== USER PROFILINI KO'RISH ==========
async function viewUserProfile(userId, event) {
    if (event) event.stopPropagation();
    
    try {
        if (!userId || userId === currentUser.id) return;
        
        const response = await fetch(`/api/user/${userId}/profile?currentUserId=${currentUser.id}`);
        const data = await response.json();
        
        if (data.success) {
            showUserProfileModal(data);
        } else {
            showNotification('Foydalanuvchi profilini yuklashda xatolik', 'error');
        }
    } catch (error) {
        console.error('Error loading user profile:', error);
        showNotification('Profil yuklashda tarmoq xatosi', 'error');
    }
}

function showUserProfileModal(data) {
    const modal = document.createElement('div');
    modal.className = 'user-profile-modal';
    modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0,0,0,0.8);
        display: flex;
        justify-content: center;
        align-items: center;
        z-index: 10000;
    `;
    
    const profile = data.profile;
    const isContact = data.isContact;
    
    modal.innerHTML = `
        <div class="profile-modal-content" style="
            background: white;
            border-radius: 15px;
            width: 90%;
            max-width: 500px;
            max-height: 90vh;
            overflow-y: auto;
            padding: 30px;
        ">
            <button class="close-modal" onclick="this.parentElement.parentElement.remove()" style="
                position: absolute;
                top: 15px;
                right: 15px;
                background: none;
                border: none;
                font-size: 24px;
                cursor: pointer;
            ">&times;</button>
            
            <div class="profile-header" style="text-align: center; margin-bottom: 30px;">
                <img src="${profile.avatar}" alt="Avatar" style="
                    width: 120px;
                    height: 120px;
                    border-radius: 50%;
                    border: 4px solid #007bff;
                    margin-bottom: 15px;
                ">
                <h2 style="margin-bottom: 10px;">${data.username}</h2>
                
                <div class="profile-status" style="margin-bottom: 20px;">
                    <span class="status ${data.status?.status || 'offline'}" style="
                        display: inline-block;
                        width: 10px;
                        height: 10px;
                        border-radius: 50%;
                        margin-right: 5px;
                        background-color: ${data.status?.status === 'online' ? '#28a745' : '#6c757d'};
                    "></span>
                    <span>${data.status?.status || 'offline'}</span>
                    ${data.status?.lastSeen ? `<div style="font-size: 14px; color: #666;">Oxirgi faol: ${new Date(data.status.lastSeen).toLocaleString()}</div>` : ''}
                </div>
            </div>
            
            <div class="profile-info" style="margin-bottom: 30px;">
                ${profile.bio ? `
                    <div class="info-section" style="margin-bottom: 20px;">
                        <h3 style="color: #007bff; margin-bottom: 10px;">
                            <i class="fas fa-user"></i> Bio
                        </h3>
                        <p>${profile.bio}</p>
                    </div>
                ` : ''}
                
                ${profile.phone ? `
                    <div class="info-section" style="margin-bottom: 20px;">
                        <h3 style="color: #007bff; margin-bottom: 10px;">
                            <i class="fas fa-phone"></i> Telefon
                        </h3>
                        <p>${profile.phone}</p>
                    </div>
                ` : ''}
                
                ${profile.location ? `
                    <div class="info-section" style="margin-bottom: 20px;">
                        <h3 style="color: #007bff; margin-bottom: 10px;">
                            <i class="fas fa-map-marker-alt"></i> Manzil
                        </h3>
                        <p>${profile.location}</p>
                    </div>
                ` : ''}
                
                ${profile.website ? `
                    <div class="info-section" style="margin-bottom: 20px;">
                        <h3 style="color: #007bff; margin-bottom: 10px;">
                            <i class="fas fa-globe"></i> Veb-sayt
                        </h3>
                        <a href="${profile.website}" target="_blank" style="color: #007bff;">${profile.website}</a>
                    </div>
                ` : ''}
            </div>
            
            <div class="profile-actions" style="display: flex; gap: 10px; justify-content: center;">
                <button class="btn btn-primary" onclick="startCall('${data.userId}', 'audio', event)" style="
                    padding: 10px 20px;
                    background: #007bff;
                    color: white;
                    border: none;
                    border-radius: 5px;
                    cursor: pointer;
                ">
                    <i class="fas fa-phone"></i> Qo'ng'iroq
                </button>
                <button class="btn btn-primary" onclick="startCall('${data.userId}', 'video', event)" style="
                    padding: 10px 20px;
                    background: #007bff;
                    color: white;
                    border: none;
                    border-radius: 5px;
                    cursor: pointer;
                ">
                    <i class="fas fa-video"></i> Video
                </button>
                <button class="btn btn-secondary" onclick="sendMessageToUser('${data.userId}')" style="
                    padding: 10px 20px;
                    background: #6c757d;
                    color: white;
                    border: none;
                    border-radius: 5px;
                    cursor: pointer;
                ">
                    <i class="fas fa-comment"></i> Xabar
                </button>
            </div>
            
            ${!isContact ? `
                <div class="add-contact" style="margin-top: 20px; text-align: center;">
                    <button class="btn btn-success" onclick="addToContacts('${data.userId}')" style="
                        padding: 10px 20px;
                        background: #28a745;
                        color: white;
                        border: none;
                        border-radius: 5px;
                        cursor: pointer;
                    ">
                        <i class="fas fa-user-plus"></i> Kontaktlarga qo'shish
                    </button>
                </div>
            ` : ''}
        </div>
    `;
    
    document.body.appendChild(modal);
    
    modal.onclick = function(e) {
        if (e.target === modal) {
            document.body.removeChild(modal);
        }
    };
}

// Add to contacts
async function addToContacts(userId) {
    try {
        const response = await fetch('/api/contacts/add', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                userId: currentUser.id,
                contactId: userId
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            showNotification('Kontakt muvaffaqiyatli qo\'shildi', 'success');
            loadContacts();
            
            const modal = document.querySelector('.user-profile-modal');
            if (modal) {
                modal.remove();
            }
        } else {
            showNotification(data.error, 'error');
        }
    } catch (error) {
        console.error('Error adding contact:', error);
        showNotification('Kontakt qo\'shishda xatolik', 'error');
    }
}

// Send message to user
function sendMessageToUser(userId) {
    const modal = document.querySelector('.user-profile-modal');
    if (modal) {
        document.body.removeChild(modal);
    }
    
    const contactItem = document.querySelector(`.contact-item[data-user-id="${userId}"]`);
    if (contactItem) {
        contactItem.click();
    } else {
        const user = {
            id: userId,
            username: 'Foydalanuvchi'
        };
        startChatWithUser(user);
    }
}

// ========== QO'NG'IROQ FUNKSIYALARI ==========
async function startCall(userId, callType, event) {
    if (event) event.stopPropagation();
    
    if (!userId) {
        showNotification('Avval kontakt tanlang', 'error');
        return;
    }
    
    if (currentCall) {
        showNotification('Sizda allaqachon faol qo\'ng\'iroq bor', 'error');
        return;
    }
    
    try {
        const constraints = {
            audio: true,
            video: callType === 'video'
        };
        
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        localStream = stream;
        
        showCallModal(callType, true);
        
        socket.emit('start-call', {
            receiverId: userId,
            callType: callType,
            fromUserId: currentUser.id,
            callerName: currentUser.username
        });
        
        currentCall = {
            type: callType,
            with: userId,
            status: 'calling',
            localStream: stream
        };
        
        if (callType === 'video') {
            const localVideo = document.getElementById('local-video');
            if (localVideo) {
                localVideo.srcObject = stream;
                localVideo.style.display = 'block';
            }
        }
        
        showNotification(`Qo'ng'iroq qilinmoqda...`, 'info');
        
    } catch (error) {
        console.error('Error starting call:', error);
        showNotification('Qo\'ng\'iroqni boshlashda xatolik. Ruxsatlarni tekshiring.', 'error');
    }
}

function showCallModal(callType, isCaller) {
    const modal = document.getElementById('call-modal');
    const title = document.getElementById('call-title');
    const status = document.getElementById('call-status');
    const videoBtn = document.querySelector('.video-btn');
    
    if (modal && title && status) {
        modal.style.display = 'block';
        title.textContent = `${callType === 'video' ? 'Video' : 'Audio'} qo'ng'iroq ${isCaller ? '' : 'kelmoqda'} ${selectedUser?.username || 'Foydalanuvchi'}`;
        status.textContent = isCaller ? 'Qo\'ng\'iroq qilinmoqda...' : 'Kelayotgan qo\'ng\'iroq...';
        
        if (videoBtn) {
            videoBtn.style.display = callType === 'video' ? 'block' : 'none';
        }
    }
}

function handleIncomingCall(data) {
    if (currentCall) {
        socket.emit('reject-call', { to: data.fromUserId });
        return;
    }
    
    const user = getContactById(data.fromUserId);
    selectedUser = user || { id: data.fromUserId, username: data.callerName };
    
    showCallModal(data.callType, false);
    
    currentCall = {
        type: data.callType,
        with: data.fromUserId,
        status: 'incoming',
        callerSocket: data.from
    };
    
    const status = document.getElementById('call-status');
    if (status) {
        status.innerHTML = `
            Kelayotgan ${data.callType === 'video' ? 'video' : 'audio'} qo'ng'iroq: ${data.callerName}
            <div class="call-response-buttons">
                <button class="btn-accept" onclick="acceptCall()">
                    <i class="fas fa-phone"></i> Qabul qilish
                </button>
                <button class="btn-reject" onclick="rejectCall()">
                    <i class="fas fa-phone-slash"></i> Rad etish
                </button>
            </div>
        `;
    }
}

async function acceptCall() {
    if (!currentCall) return;
    
    try {
        const constraints = {
            audio: true,
            video: currentCall.type === 'video'
        };
        
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        localStream = stream;
        
        currentCall.status = 'active';
        currentCall.localStream = stream;
        
        socket.emit('accept-call', {
            to: currentCall.with
        });
        
        const status = document.getElementById('call-status');
        if (status) {
            status.textContent = 'Qo\'ng\'iroq ulandi';
        }
        
        if (currentCall.type === 'video') {
            const localVideo = document.getElementById('local-video');
            if (localVideo) {
                localVideo.srcObject = stream;
                localVideo.style.display = 'block';
            }
        }
        
        showNotification('Qo\'ng\'iroq ulandi', 'success');
        
    } catch (error) {
        console.error('Error accepting call:', error);
        showNotification('Qo\'ng\'iroqni qabul qilishda xatolik', 'error');
        endCall();
    }
}

function rejectCall() {
    if (!currentCall) return;
    
    socket.emit('reject-call', {
        to: currentCall.with
    });
    
    endCall();
    showNotification('Qo\'ng\'iroq rad etildi', 'info');
}

function handleCallAccepted(data) {
    if (!currentCall) return;
    
    currentCall.status = 'active';
    
    const status = document.getElementById('call-status');
    if (status) {
        status.textContent = 'Qo\'ng\'iroq ulandi';
    }
    
    showNotification('Qo\'ng\'iroq ulandi', 'success');
}

function handleCallRejected() {
    if (!currentCall) return;
    
    const status = document.getElementById('call-status');
    if (status) {
        status.textContent = 'Qo\'ng\'iroq rad etildi';
    }
    
    setTimeout(() => {
        endCall();
    }, 2000);
    
    showNotification('Qo\'ng\'iroq rad etildi', 'info');
}

function handleCallEnded() {
    if (!currentCall) return;
    
    const status = document.getElementById('call-status');
    if (status) {
        status.textContent = 'Qo\'ng\'iroq tugadi';
    }
    
    setTimeout(() => {
        endCall();
    }, 2000);
    
    showNotification('Qo\'ng\'iroq tugadi', 'info');
}

function endCall() {
    if (currentCall) {
        if (localStream) {
            localStream.getTracks().forEach(track => track.stop());
            localStream = null;
        }
        
        if (remoteStream) {
            remoteStream.getTracks().forEach(track => track.stop());
            remoteStream = null;
        }
        
        if (currentCall.status === 'active' || currentCall.status === 'calling') {
            socket.emit('end-call', {
                to: currentCall.with
            });
        }
        
        currentCall = null;
    }
    
    const modal = document.getElementById('call-modal');
    if (modal) {
        modal.style.display = 'none';
    }
    
    const localVideo = document.getElementById('local-video');
    const remoteVideo = document.getElementById('remote-video');
    
    if (localVideo) {
        localVideo.srcObject = null;
        localVideo.style.display = 'none';
    }
    
    if (remoteVideo) {
        remoteVideo.srcObject = null;
        remoteVideo.style.display = 'none';
    }
}

function getContactById(userId) {
    const contactItems = document.querySelectorAll('.contact-item');
    for (const item of contactItems) {
        if (item.dataset.userId === userId) {
            const username = item.querySelector('.contact-name').textContent;
            const avatar = item.querySelector('img').src;
            const status = item.querySelector('.status').className.includes('online') ? 'online' : 'offline';
            
            return {
                id: userId,
                username: username,
                avatar: avatar,
                status: status
            };
        }
    }
    return null;
}

// Handle user status change
function handleUserStatusChanged(data) {
    console.log('User status changed:', data);
    
    const contactItem = document.querySelector(`.contact-item[data-user-id="${data.userId}"]`);
    if (contactItem) {
        const statusSpan = contactItem.querySelector('.status');
        const statusText = contactItem.querySelector('.contact-status');
        
        if (statusSpan) {
            statusSpan.className = `status ${data.status || 'offline'}`;
        }
        if (statusText) {
            statusText.innerHTML = `<span class="status ${data.status || 'offline'}"></span> ${data.status || 'offline'}`;
        }
    }
    
    if (selectedUserId === data.userId) {
        const headerStatus = document.querySelector('#chat-partner-info .status');
        const headerStatusText = document.querySelector('#chat-partner-info .contact-status');
        
        if (headerStatus) {
            headerStatus.className = `status ${data.status || 'offline'}`;
        }
        if (headerStatusText) {
            headerStatusText.innerHTML = `<span class="status ${data.status || 'offline'}"></span> ${data.status || 'offline'}`;
        }
    }
}

// Handle contacts updated
function handleContactsUpdated(data) {
    console.log('Contacts updated event received:', data);
    
    if (data.userId === currentUser.id) {
        console.log('Reloading contacts for current user');
        setTimeout(() => {
            loadContacts();
        }, 300);
    }
}

// Handle typing indicator
function handleUserTyping(data) {
    console.log('Typing indicator:', data);
    
    if (data.senderId === selectedUserId && selectedUser) {
        const indicator = document.getElementById('typing-indicator');
        const typingText = document.getElementById('typing-text');
        
        if (indicator && typingText) {
            if (data.isTyping) {
                typingText.textContent = `${selectedUser.username} yozyapti...`;
                indicator.style.display = 'block';
            } else {
                indicator.style.display = 'none';
            }
        }
    }
}

// Helper functions
function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.innerHTML = `
        <span>${message}</span>
        <button onclick="this.parentElement.remove()">&times;</button>
    `;
    
    // Add styles if not already in CSS
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 15px 20px;
        border-radius: 8px;
        color: white;
        font-weight: 500;
        z-index: 1000;
        display: flex;
        align-items: center;
        gap: 10px;
        animation: slideIn 0.3s ease;
    `;
    
    if (type === 'success') notification.style.background = '#28a745';
    else if (type === 'error') notification.style.background = '#dc3545';
    else if (type === 'info') notification.style.background = '#17a2b8';
    else if (type === 'warning') notification.style.background = '#ffc107';
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
        if (notification.parentNode) {
            notification.remove();
        }
    }, 3000);
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Logout
async function logout() {
    try {
        endCall();
        
        if (currentUser && currentUser.id) {
            await fetch('/api/logout', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ userId: currentUser.id })
            });
        }
    } catch (error) {
        console.error('Logout error:', error);
    } finally {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        window.location.href = '/';
    }
}

// Make functions available globally
window.openImageModal = openImageModal;
window.editMessage = editMessage;
window.deleteMessage = deleteMessage;
window.startCall = startCall;
window.acceptCall = acceptCall;
window.rejectCall = rejectCall;
window.endCall = endCall;
window.viewUserProfile = viewUserProfile;
window.selectContactFromList = selectContactFromList;
window.playAudioFile = playAudioFile;
window.playVideoFile = playVideoFile;
window.downloadFile = downloadFile;
window.cancelRecording = cancelRecording;