const API_URL = "https://europe-west3-alphahome-484017.cloudfunctions.net/manage-leaderboard";
let selectedQuestions = [];
let currentStep = 0;
let totalScore = 0;
let attemptsLeft = parseInt(getCookie('cyberAttempts') || '1');
let timerInterval = null;
const QUESTION_TIME = 60; // 60 секунд
let pollInterval = null;


// --- MATRIX ---
const canvas = document.getElementById('matrix-canvas');
const ctx = canvas.getContext('2d');
let drops = [];

function initMatrix() {
    canvas.width = window.innerWidth; canvas.height = window.innerHeight;
    drops = Array(Math.floor(canvas.width / 14)).fill(1);
}

function drawMatrix() {
    ctx.fillStyle = "rgba(5, 11, 24, 0.1)"; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.font = "14px monospace";
    drops.forEach((y, i) => {
        ctx.fillStyle = i % 2 === 0 ? "#00d2ff" : "#9d00ff";
        ctx.fillText("01"[Math.floor(Math.random()*2)], i*14, y*14);
        if (y*14 > canvas.height && Math.random() > 0.975) drops[i] = 0;
        drops[i]++;
    });
}

// --- CORE LOGIC ---
window.onload = () => {
    initMatrix(); setInterval(drawMatrix, 50);
    loadData();
    const nick = getCookie('cyberNick');
    if (nick) document.getElementById('welcome-container').innerHTML = `<div class="welcome-msg">Вітаю хакере, <b>${nick}</b>! <span onclick="deleteProfile()" style="color:var(--error); cursor:pointer; text-decoration:underline; margin-left:10px;">Скинути</span></div>`;
    document.getElementById('attempts-ui').innerText = `Спроби: ${attemptsLeft} / 1`;
};

async function loadData() {
    try {
        const res = await fetch(API_URL);
        const data = await res.json();
        
        // ДЛЯ ТЕБЕ: виведемо в консоль, що саме прислав сервер
        console.log("Дані з сервера:", data);

        const select = document.getElementById('team-select');
        
        // Захист для списку команд
        if (data.allowed_teams) {
            select.innerHTML = '<option value="">-- ОБЕРИ КОМАНДУ --</option>' + 
                data.allowed_teams.map(t => `<option value="${t}">${t}</option>`).join('');
        }

        // ЗАХИСТ ТУТ: додаємо (data.players || [])
        // Це означає: "якщо players немає, бери порожній список"
        const playerList = document.getElementById('player-list');
        if (playerList) {
            playerList.innerHTML = (data.players || []).map(p => 
                `<div class="leader-item"><span>${p.nick}</span><b>${p.score}</b></div>`
            ).join('');
        }

        const teamList = document.getElementById('team-list');
        if (teamList) {
            teamList.innerHTML = (data.teams || []).map(t => 
                `<div class="leader-item"><span>${t.name}</span><b>${t.score}</b></div>`
            ).join('');
        }

    } catch (e) { 
        console.error("Критична помилка завантаження даних:", e); 
    }
}

// async function loadData() {
//     const res = await fetch(API_URL);
//     const data = await res.json();
//     const select = document.getElementById('team-select');
//     select.innerHTML = '<option value="">-- ОБЕРИ КОМАНДУ --</option>' + data.allowed_teams.map(t => `<option value="${t}">${t}</option>`).join('');
//     document.getElementById('player-list').innerHTML = data.players.map(p => `<div class="leader-item"><span>${p.nick}</span><b>${p.score}</b></div>`).join('');
//     document.getElementById('team-list').innerHTML = data.teams.map(t => `<div class="leader-item"><span>${t.name}</span><b>${t.score}</b></div>`).join('');
// }

async function startQuiz() {
    const team = document.getElementById('team-select').value;
    if (!team) return alert("Обери команду!");
    
    const nick = getCookie('cyberNick') || prompt("Введіть ваш нікнейм:");
    if (!nick) return;
    setCookie('cyberNick', nick);

    const res = await fetch(API_URL, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({action: 'join', nick, team})
    });

    const result = await res.json();
    if (res.ok) {
        setCookie('cyberTeam', team);
        document.getElementById('start-screen').classList.remove('active');
        document.getElementById('waiting-screen').classList.add('active');
        pollGameState();
    } else {
        alert(result.error); // Виведе "Нікнейм зайнятий" або "Стіл повний"
    }
}

async function leaveWaitingRoom() {
        if (pollInterval) clearInterval(pollInterval);
        const nick = getCookie('cyberNick');
        const team = getCookie('cyberTeam');

        await fetch(API_URL, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({action: 'leave', nick, team})
        });

        document.getElementById('waiting-screen').classList.remove('active');
        document.getElementById('start-screen').classList.add('active');
    }

function showQuestion() {
    const q = selectedQuestions[currentStep];
    const content = document.getElementById('quiz-content');

    document.getElementById('progress-fill').style.width = `${(currentStep / selectedQuestions.length) * 100}%`;
    const shuffled = [...q.options].sort(() => 0.5 - Math.random());

    let html = `
        <div id="stopwatch" class="stopwatch-display">01:00</div>
        <div style="font-size:3rem; margin-bottom:10px;">${q.icon}</div>
        <h2>${q.q}</h2>
    `;

    if (q.type === "image") {
        // УВАГА: Додано onclick="openModal(...)" до тегів <img>
        html += `
            <div class="image-comparison">
                <div class="img-box">
                    <span>А</span>
                    <img src="${q.imgA}" onclick="openModal('${q.imgA}')" alt="Варіант А">
                </div>
                <div class="img-box">
                    <span>Б</span>
                    <img src="${q.imgB}" onclick="openModal('${q.imgB}')" alt="Варіант Б">
                </div>
            </div>`;
    }

    html += `<div class="options" id="options-grid">
        ${shuffled.map((o, index) => `
            <button onclick="processAnswer(this, ${o.score})">${o.text}</button>
        `).join('')}
    </div>`;
    
    content.innerHTML = html;
    // Скидаємо та запускаємо таймер
    startTimer();
}

// function showQuestion() {
//     const q = selectedQuestions[currentStep];
//     const content = document.getElementById('quiz-content');
    
//     // Скидаємо та запускаємо таймер
//     startTimer();

//     document.getElementById('progress-fill').style.width = `${(currentStep / selectedQuestions.length) * 100}%`;
//     const shuffled = [...q.options].sort(() => 0.5 - Math.random());

//     let html = `
//         <div class="timer-container"><div id="timer-bar"></div></div>
//         <div style="font-size:3rem; margin-bottom:10px;">${q.icon}</div>
//         <h2>${q.q}</h2>
//     `;

//     if (q.type === "image") {
//         html += `
//             <div class="image-comparison">
//                 <div class="img-box"><span>А</span><img src="${q.imgA}"></div>
//                 <div class="img-box"><span>Б</span><img src="${q.imgB}"></div>
//             </div>`;
//     }

//     html += `<div class="options" id="options-grid">
//         ${shuffled.map((o, index) => `
//             <button onclick="processAnswer(this, ${o.score})">${o.text}</button>
//         `).join('')}
//     </div>`;
    
//     content.innerHTML = html;
// }

// function startTimer() {
//     if (timerInterval) clearInterval(timerInterval);
//     let timeLeft = QUESTION_TIME;
//     const bar = document.getElementById('timer-bar');

//     timerInterval = setInterval(() => {
//         timeLeft--;
//         const percentage = (timeLeft / QUESTION_TIME) * 100;
//         if (bar) bar.style.width = percentage + "%";

//         if (timeLeft <= 0) {
//             clearInterval(timerInterval);
//             autoSkip(); // Час вийшов
//         }
//     }, 1000);
// }

function startTimer() {
    if (timerInterval) clearInterval(timerInterval);
    let timeLeft = QUESTION_TIME; // 60
    const display = document.getElementById('stopwatch');

    timerInterval = setInterval(() => {
        timeLeft--;
        
        // Форматування часу (MM:SS)
        const minutes = Math.floor(timeLeft / 60);
        const seconds = timeLeft % 60;
        const formattedTime = 
            (minutes < 10 ? "0" : "") + minutes + ":" + 
            (seconds < 10 ? "0" : "") + seconds;

        if (display) {
            display.innerText = formattedTime;
            
            // Додаємо ефект тривоги на останніх 10 секундах
            if (timeLeft <= 10) {
                display.classList.add('danger');
            }
        }

        if (timeLeft <= 0) {
            clearInterval(timerInterval);
            autoSkip();
        }
    }, 1000);
}

function autoSkip() {
    // Якщо час вийшов, вважаємо, що відповідь неправильна (0 балів)
    const buttons = document.querySelectorAll('#options-grid button');
    buttons.forEach(btn => btn.disabled = true);
    
    // Підсвічуємо всі кнопки червоним на мить, щоб показати провал за часом
    setTimeout(() => {
        nextStep(0);
    }, 1000);
}

window.processAnswer = (clickedBtn, score) => {
    // 1. Зупиняємо таймер
    clearInterval(timerInterval);

    // 2. Блокуємо всі кнопки
    const buttons = document.querySelectorAll('#options-grid button');
    buttons.forEach(btn => btn.disabled = true);

    // 3. Підсвічуємо результат
    if (score > 0) {
        clickedBtn.classList.add('correct');
    } else {
        clickedBtn.classList.add('wrong');
    }

    // 4. Чекаємо 3 секунди і переходимо далі
    setTimeout(() => {
        nextStep(score);
    }, 3000);
};

// Функція очікування старту від адміна
function pollGameState() {
    pollInterval = setInterval(async () => {
        try {
            const res = await fetch(API_URL);
            const data = await res.json();
            
            if (data.game_status === 'started') {
                clearInterval(pollInterval);
                
                // 1. Обираємо 13 випадкових питань з questions.js
                if (typeof allQuestions !== 'undefined' && allQuestions.length > 0) {
                    selectedQuestions = allQuestions.sort(() => 0.5 - Math.random()).slice(0, 13);
                } else {
                    console.error("Помилка: Питання не знайдені в questions.js");
                    return;
                }

                // 2. Скидаємо лічильник кроків та бали (про всяк випадок)
                currentStep = 0;
                totalScore = 0;

                // 3. Перемикаємо екрани
                document.getElementById('waiting-screen').classList.remove('active');
                document.getElementById('quiz-ui').classList.add('active');
                
                // 4. Запускаємо перше питання
                showQuestion();
            }
        } catch (e) {
            console.error("Помилка опитування статусу:", e);
        }
    }, 2000);
}

// Оновлена функція завершення гри (щоб вона коректно виводила ранг)
async function finalizeGame() {
    if (timerInterval) clearInterval(timerInterval); // Зупиняємо таймер, якщо він ішов
    
    attemptsLeft--; 
    setCookie('cyberAttempts', attemptsLeft);
    
    document.getElementById('quiz-ui').classList.remove('active');
    document.getElementById('result-screen').classList.add('active');
    
    const nick = getCookie('cyberNick');
    document.getElementById('nick-display').innerText = nick;
    document.getElementById('final-score').innerText = totalScore;

    // Розрахунок рангу
    const box = document.getElementById('conclusion-box');
    if (totalScore >= 21) {
        box.innerHTML = `<b style="color:var(--accent)">👑 ЛЕГЕНДА</b><br><small>Твій захист непробивний!</small>`;
    } else if (totalScore >= 15) {
        box.innerHTML = `<b style="color:var(--secondary)">⚔️ ЗАХИСНИК</b><br><small>Ти знаєш правила, але будь пильнішим.</small>`;
    } else {
        box.innerHTML = `<b style="color:var(--error)">🐣 СКАУТ</b><br><small>Твоя броня потребує апгрейду!</small>`;
    }

    // Відправка результатів
    try {
        await fetch(API_URL, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                action: 'finalize', 
                nick: nick, 
                score: totalScore, 
                team: getCookie('cyberTeam')
            })
        });
    } catch (e) { 
        console.error("API Error:", e); 
    }
    
    loadData(); // Оновлюємо лідерборд
}

// Функція для відкриття модального вікна
function openModal(imgSrc) {
    const modal = document.getElementById('image-modal');
    const modalImg = document.getElementById('enlarged-image');
    
    // Встановлюємо джерело картинки
    modalImg.src = imgSrc;
    // Показуємо вікно (використовуємо flex для центрування)
    modal.style.display = "flex"; 
}

// Функція для закриття модального вікна
function closeModal() {
    const modal = document.getElementById('image-modal');
    // Ховаємо вікно
    modal.style.display = "none";
    // Очищаємо src, щоб не миготіло при наступному відкритті
    document.getElementById('enlarged-image').src = "";
}

function nextStep(score) {
    totalScore += score;
    currentStep++;
    
    if (currentStep < selectedQuestions.length) {
        showQuestion();
    } else {
        finalizeGame();
    }
}

window.handleAnswer = (score) => {
    totalScore += score; currentStep++;
    if (currentStep < selectedQuestions.length) showQuestion();
    else finalizeGame();
}

// --- HELPERS ---
function switchTab(t) {
    const isPl = t === 'pl';
    document.getElementById('t-pl').classList.toggle('active', isPl);
    document.getElementById('t-tm').classList.toggle('active', !isPl);
    document.getElementById('player-list').classList.toggle('active', isPl);
    document.getElementById('team-list').classList.toggle('active', !isPl);
}
function setCookie(n, v) { document.cookie = `${n}=${encodeURIComponent(v)}; max-age=${10*24*3600}; path=/; SameSite=Lax`; }
function getCookie(n) { let m = document.cookie.match(new RegExp("(?:^|; )" + n.replace(/([\.$?*|{}\(\)\[\]\\\/\+^])/g, '\\$1') + "=([^;]*)")); return m ? decodeURIComponent(m[1]) : ""; }
function deleteProfile() { if(confirm("Скинути?")) { setCookie('cyberNick', '', -1); setCookie('cyberAttempts', '', -1); location.reload(); } }
