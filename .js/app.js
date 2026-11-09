// --- CONFIGURATION ---
const SUPABASE_URL = 'https://your-project.supabase.co'; // ЗАМЕНИТЬ НА ВАШ URL
const SUPABASE_ANON_KEY = 'your-anon-key';               // ЗАМЕНИТЬ НА ВАШ KEY

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let currentUser = null;
let currentChatId = null;
let selectedFile = null;

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', async () => {
    const { data: { session }, error } = await supabase.auth.getSession();
    
    if (session) {
        currentUser = session.user;
        showApp();
        loadChatsList(); // Initial load of chat list
    } else {
        showAuthScreen();
    }

    supabase.auth.onAuthStateChange((_event, session) => {
        if (session && !currentUser) {
            currentUser = session.user;
            showApp();
            loadChatsList();
        } else if (!session) {
            currentUser = null;
            showAuthScreen();
        }
    });
});

// --- UI HELPERS ---
function toggleAuthMode() {
    const loginForm = document.getElementById('login-form');
    const registerForm = document.getElementById('register-form');
    if (loginForm.classList.contains('hidden')) {
        loginForm.classList.remove('hidden');
        registerForm.classList.add('hidden');
    } else {
        loginForm.classList.add('hidden');
        registerForm.classList.remove('hidden');
    }
}

function showAuthScreen() {
    document.getElementById('auth-screen').classList.remove('hidden');
    document.getElementById('app-container').classList.add('hidden');
}

function showApp() {
    document.getElementById('auth-screen').classList.add('hidden');
    document.getElementById('app-container').classList.remove('hidden');
}

function switchTab(tabName) {
    // Hide all main views except chat room logic handled separately
    ['view-chats-list', 'view-calls', 'view-profile', 'view-settings'].forEach(v => {
        const el = document.getElementById(v);
        if(el) el.classList.add('hidden');
    });
    
    // Show selected
    const targetView = document.getElementById(`view-${tabName}`);
    if(targetView) targetView.classList.remove('hidden');
    
    // Reset Chat Room visibility if switching tabs away from chats
    document.getElementById('view-chat-room').classList.add('hidden');
    document.getElementById('view-chats-list').classList.remove('hidden'); // Default back to list if clicking Chats tab
    
    // Update Nav Buttons
    const btns = document.querySelectorAll('.nav-btn');
    btns.forEach(btn => btn.classList.remove('active'));
    event.currentTarget.classList.add('active');

    // Load data specific to tab
    if (tabName === 'chats') loadChatsList();
    if (tabName === 'calls') loadCalls();
    if (tabName === 'profile') loadProfile();
}

function openModal(htmlContent) {
    document.getElementById('dynamic-modal-body').innerHTML = htmlContent;
    document.getElementById('modal-overlay').classList.remove('hidden');
}

function closeModal() {
    document.getElementById('modal-overlay').classList.add('hidden');
    selectedFile = null; // Clear selection on close
    document.getElementById('file-input').value = '';
}

// --- MEDIA VIEWER LOGIC ---
function openMediaViewer(url, type) {
    const modal = document.getElementById('media-viewer-modal');
    const content = document.getElementById('media-viewer-content');
    
    let html = '';
    if (type.startsWith('image')) {
        html = `<img src="${url}" alt="Image">`;
    } else if (type.startsWith('video')) {
        html = `<video controls autoplay><source src="${url}" type="${type}"></video>`;
    } else if (type.startsWith('audio')) {
        html = `<div style="color:white; font-size:20px;">Аудио недоступно в превью<br><small>Скачайте или слушайте в чате</small></div>`;
    }
    
    content.innerHTML = html;
    modal.style.display = 'flex';
}

function closeMediaViewer() {
    document.getElementById('media-viewer-modal').style.display = 'none';
    document.getElementById('media-viewer-content').innerHTML = '';
}

// --- AUTHENTICATION LOGIC WITH 2FA SUPPORT ---
async function handleLogin(e) {
    e.preventDefault();
    const email = e.target[0].value;
    const password = e.target[1].value;
    const twoFaCodeInput = document.getElementById('login-2fa-code');
    
    try {
        // Step 1: Sign in with password
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;

        // Step 2: Check if 2FA is enabled for this user
        const { data: secretData, error: secErr } = await supabase.from('user_2fa_secrets')
            .select('*')
            .eq('user_id', data.user.id)
            .single();

        if (secErr && secErr.code !== 'PGRST116') throw secErr; // PGRST116 means no rows found (no 2FA setup yet)

        if (secretData && secretData.enabled) {
            // Require 2FA Code
            if (!twoFaCodeInput.value) {
                twoFaCodeInput.classList.remove('hidden');
                alert("Введите код из приложения Authenticator");
                return;
            }
            
            // NOTE: Real TOTP validation usually happens server-side (Edge Function).
            // For client-only demo, we assume format check or simple match if you stored plain secret (NOT RECOMMENDED FOR PROD).
            // Here we will just proceed if code length is correct, assuming backend validates it in a real scenario via magic link or custom JWT claim.
            // Since we can't run Node crypto easily in browser without libs, we'll simulate success if code looks valid (6 digits).
            if (/^\d{6}$/.test(twoFaCodeInput.value)) {
                 alert("2FA Принят (демо)!");
            } else {
                 throw new Error("Неверный формат кода 2FA");
            }
        }

        alert("Успешный вход!");
        location.reload(); 

    } catch (err) {
        alert(err.message);
    }
}

async function handleRegister(e) {
    e.preventDefault();
    const fullName = document.getElementById('reg-name').value;
    const phone = document.getElementById('reg-phone').value;
    const email = document.getElementById('reg-email').value;
    const password = document.getElementById('reg-pass').value;

    const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
            data: { full_name: fullName, phone_number: phone }
        }
    });

    if (error) {
        alert(error.message);
        return;
    }

    if(data.user) {
        await supabase.from('profiles').insert([{
            id: data.user.id,
            username: email.split('@')[0],
            full_name: fullName,
            phone_number: phone
        }]);
        alert("Регистрация успешна! Проверьте почту.");
    }
}

async function logout() {
    await supabase.auth.signOut();
    location.reload();
}

document.getElementById('login-form').addEventListener('submit', handleLogin);
document.getElementById('register-form').addEventListener('submit', handleRegister);


// --- CHAT FUNCTIONALITY ---

async function loadChatsList() {
    if (!currentUser) return;
    
    const { data, error } = await supabase
        .from('chats')
        .select(`
            *,
            chat_participants(user_id),
            messages(content, created_at, media_type, media_url)
        `)
        .eq('chat_participants.user_id', currentUser.id)
        .order('created_at', { ascending: false });

    if (error) console.error(error);

    const listEl = document.getElementById('chat-list');
    listEl.innerHTML = '';

    if (!data || data.length === 0) {
        listEl.innerHTML = '<p class="text-center text-gray-500 mt-10">Нет активных чатов.</p>';
        return;
    }

    data.forEach(chat => {
        let lastMsg = "Нет сообщений";
        if (chat.messages && chat.messages.length > 0) {
            const msg = chat.messages[chat.messages.length - 1];
            if (msg.media_type) lastMsg = `[${msg.media_type}]`;
            else lastMsg = msg.content.substring(0, 30) + "...";
        }

        const div = document.createElement('div');
        div.className = "glass-panel p-3 flex justify-between items-center cursor-pointer hover:bg-white/10 transition";
        div.onclick = () => enterChatRoom(chat.id, chat.name || 'Диалог');
        
        div.innerHTML = `
            <div class="flex items-center gap-3">
                <div class="w-10 h-10 rounded-full bg-purple-600 flex items-center justify-center font-bold">${(chat.name || '?')[0]}</div>
                <div>
                    <h4 class="font-bold">${chat.name || 'Неизвестный контакт'}</h4>
                    <p class="text-xs text-gray-400 truncate max-w-[150px]">${lastMsg}</p>
                </div>
            </div>
            <i class="fas fa-chevron-right text-gray-500"></i>
        `;
        listEl.appendChild(div);
    });
}

function enterChatRoom(chatId, title) {
    currentChatId = chatId;
    document.getElementById('page-title').innerText = title;
    document.getElementById('view-chats-list').classList.add('hidden');
    document.getElementById('view-chat-room').classList.remove('hidden');
    document.getElementById('back-btn').classList.remove('hidden');
    
    loadMessages(chatId);
}

function goBackFromChat() {
    currentChatId = null;
    document.getElementById('view-chat-room').classList.add('hidden');
    document.getElementById('view-chats-list').classList.remove('hidden');
    document.getElementById('back-btn').classList.add('hidden');
    document.getElementById('page-title').innerText = 'Чаты';
    loadChatsList(); // Refresh list
}

async function loadMessages(chatId) {
    const container = document.getElementById('messages-container');
    container.innerHTML = '<div class="text-center text-gray-500">Загрузка...</div>';

    const { data, error } = await supabase.from('messages')
        .select('*')
        .eq('chat_id', chatId)
        .order('created_at', { ascending: true });

    if (error) {
        container.innerHTML = `<div class="text-red-500">Ошибка: ${error.message}</div>`;
        return;
    }

    container.innerHTML = '';
    if (data.length === 0) {
        container.innerHTML = '<div class="text-center text-gray-500 mt-10">Начните диалог!</div>';
        return;
    }

    data.forEach(msg => {
        renderMessage(container, msg);
    });
    
    scrollToBottom();
}

function renderMessage(container, msg) {
    const isMine = msg.sender_id === currentUser.id;
    const row = document.createElement('div');
    row.className = `msg-row ${isMine ? 'msg-mine' : 'msg-other'}`;
    
    let bubbleContent = '';
    
    if (msg.media_url) {
        // Get Public URL from Storage path
        const { data: urlData } = supabase.storage.from('media').getPublicUrl(msg.media_url);
        const publicUrl = urlData.publicUrl;
        
        if (msg.media_type.startsWith('image')) {
            bubbleContent += `<img src="${publicUrl}" class="media-preview" onclick="openMediaViewer('${publicUrl}', '${msg.media_type}')">`;
        } else if (msg.media_type.startsWith('video')) {
            bubbleContent += `<video src="${publicUrl}" controls class="media-preview" style="max-width:250px;"></video>`;
        } else if (msg.media_type.startsWith('audio')) {
            bubbleContent += `<audio src="${publicUrl}" controls class="audio-player"></audio>`;
        }
    }
    
    if (msg.content) {
        bubbleContent += `<p>${escapeHtml(msg.content)}</p>`;
    }

    const time = new Date(msg.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
    
    row.innerHTML = `
        <div class="bubble ${isMine ? 'mine' : 'other'}">
            ${bubbleContent}
            <div class="text-[10px] opacity-70 mt-1 text-right">${time}</div>
        </div>
    `;
    container.appendChild(row);
}

function escapeHtml(text) {
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
    return text.replace(/[&<>"']/g, m => map[m]);
}

function scrollToBottom() {
    const container = document.getElementById('messages-container');
    container.scrollTop = container.scrollHeight;
}

// --- FILE HANDLING & SENDING ---

function handleFileSelect(input) {
    if (input.files && input.files[0]) {
        selectedFile = input.files[0];
        const fileName = selectedFile.name;
        const fileSizeMB = (selectedFile.size / (1024*1024)).toFixed(2);
        alert(`Выбран файл: ${fileName}\nРазмер: ${fileSizeMB} MB\nНажмите "Отправить" в поле сообщения.`);
    }
}

async function sendMessage() {
    const inputArea = document.getElementById('message-input');
    const text = inputArea.value.trim();
    
    if (!currentChatId) return alert("Вы не в чате");
    if (!text && !selectedFile) return;

    const btn = document.querySelector('.input-area button');
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';

    try {
        let mediaPath = null;
        let mediaType = null;

        // 1. Upload File if exists
        if (selectedFile) {
            const fileExt = selectedFile.name.split('.').pop();
            const filePath = `${currentUser.id}/${Date.now()}.${fileExt}`;
            
            const { error: uploadError } = await supabase.storage
                .from('media')
                .upload(filePath, selectedFile);

            if (uploadError) throw uploadError;
            
            mediaPath = filePath;
            mediaType = selectedFile.type;
        }

        // 2. Insert Message
        const { error: insertError } = await supabase.from('messages').insert({
            chat_id: currentChatId,
            sender_id: currentUser.id,
            content: text || '',
            media_url: mediaPath,
            media_type: mediaType
        });

        if (insertError) throw insertError;

        // 3. Clean up UI
        inputArea.value = '';
        selectedFile = null;
        document.getElementById('file-input').value = '';
        
        // Reload messages to see new one
        loadMessages(currentChatId);

    } catch (err) {
        alert("Ошибка отправки: " + err.message);
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-paper-plane"></i>';
    }
}

// Enter key support
document.getElementById('message-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
});

// --- NEW CHAT MODAL ---
function openNewChatModal() {
    const html = `
        <h3 class="text-xl font-bold mb-4">Новый чат</h3>
        <select id="new-chat-type" class="w-full bg-gray-800 border border-gray-600 rounded p-2 mb-4">
            <option value="dm">Личное сообщение</option>
            <option value="group">Группа</option>
            <option value="channel">Канал</option>
        </select>
        <input type="text" id="new-chat-target" placeholder="Email контакта или Название группы" class="w-full input-glass p-2 rounded mb-4">
        <button onclick="createChatAction()" class="w-full py-2 bg-purple-600 rounded">Создать</button>
    `;
    openModal(html);
}

async function createChatAction() {
    const type = document.getElementById('new-chat-type').value;
    const target = document.getElementById('new-chat-target').value;

    if (!target) return alert("Заполните поле");

    const { data, error } = await supabase.from('chats').insert({
        type: type,
        name: type === 'dm' ? 'DM with ' + target : target,
        created_by: currentUser.id
    }).select().single();

    if (error) return alert(error.message);

    await supabase.from('chat_participants').insert({
        chat_id: data.id,
        user_id: currentUser.id,
        role: 'admin'
    });

    closeModal();
    loadChatsList();
}

// --- CALLS & PROFILE (Same as before but cleaned) ---
async function loadCalls() {
    if (!currentUser) return;
    const { data, error } = await supabase.from('call_history')
        .select('*')
        .or(`caller_id.eq.${currentUser.id},receiver_id.eq.${currentUser.id}`)
        .order('started_at', { ascending: false })
        .limit(20);

    const list = document.getElementById('call-history-list');
    list.innerHTML = '';
    
    if(data && data.length > 0) {
        data.forEach(call => {
            const div = document.createElement('div');
            div.className = "glass-panel p-3 flex justify-between items-center";
            div.innerHTML = `
                <div>
                    <p class="font-bold">${call.status === 'missed' ? 'Пропущенный звонок' : 'Разговор завершен'}</p>
                    <p class="text-xs text-gray-400">${new Date(call.started_at).toLocaleString()}</p>
                </div>
                <i class="fas ${call.status === 'missed' ? 'fa-phone-slash text-red-500' : 'fa-check text-green-500'}"></i>
            `;
            list.appendChild(div);
        });
    } else {
        list.innerHTML = '<p class="text-center text-gray-500">Нет истории звонков</p>';
    }
}

function startCallFlow() {
    const html = `
        <h3 class="text-xl font-bold mb-4">Выберите контакт</h3>
        <input type="text" id="call-contact-id" placeholder="ID пользователя или Телефон" class="w-full input-glass p-2 rounded mb-4">
        <button onclick="initiateCall()" class="w-full py-2 bg-blue-600 rounded"><i class="fas fa-phone mr-2"></i> Позвонить</button>
    `;
    openModal(html);
}

async function initiateCall() {
    const targetId = document.getElementById('call-contact-id').value;
    if(!targetId) return alert("Введите ID/Телефон");
    
    await supabase.from('call_history').insert({
        caller_id: currentUser.id,
        receiver_id: null, 
        status: 'outgoing',
        duration_seconds: 0
    });
    
    alert("Звонок инициирован...");
    closeModal();
    loadCalls();
}

async function loadProfile() {
    if (!currentUser) return;
    
    const { data, error } = await supabase.from('profiles').select('*').eq('id', currentUser.id).single();
    
    if (data) {
        document.getElementById('profile-name').innerText = data.full_name || 'Пользователь';
        document.getElementById('profile-phone').innerText = data.phone_number || '+000';
        document.getElementById('profile-avatar').src = data.avatar_url || 'https://via.placeholder.com/150';
        
        document.getElementById('edit-name').value = data.full_name || '';
        document.getElementById('edit-phone').value = data.phone_number || '';
        document.getElementById('soc-tg').value = data.social_links?.tg || '';
        document.getElementById('soc-vk').value = data.social_links?.vk || '';
    }
}

async function saveProfile() {
    const newName = document.getElementById('edit-name').value;
    const newPhone = document.getElementById('edit-phone').value;
    const tg = document.getElementById('soc-tg').value;
    const vk = document.getElementById('soc-vk').value;
    
    const { error } = await supabase.from('profiles').update({
        full_name: newName,
        phone_number: newPhone,
        social_links: { tg, vk }
    }).eq('id', currentUser.id);
    
    if(error) alert(error.message);
    else alert("Профиль обновлен!");
    loadProfile();
}

function setup2FA() {
    // In production, use a library like speakeasy to generate secret and QR
    // For this demo, we just insert a dummy record to enable the flag
    const secret = Math.random().toString(36).substring(2, 15); // Simple random string
    
    supabase.from('user_2fa_secrets').upsert({
        user_id: currentUser.id,
        secret_key: secret,
        enabled: true
    }).then(({ error }) => {
        if(error) alert("Ошибка настройки 2FA: " + error.message);
        else alert("2FA Включено! Сохраните секрет: " + secret);
    });
}

function changePassword() {
    const newPassword = prompt("Введите новый пароль:");
    if(newPassword) {
        supabase.auth.updateUser({ password: newPassword })
        .then(({ error }) => {
            if(error) alert(error.message);
            else alert("Пароль изменен");
        });
    }
}
