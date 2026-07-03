// DÁN MÃ SUPABASE CỦA BẠN VÀO 2 DÒNG DƯỚI ĐÂY:
const dashUrl = 'https://oyumvhldhmjmahohavsp.supabase.co';
const dashKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im95dW12aGxkaG1qbWFob2hhdnNwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIyMDU0MTEsImV4cCI6MjA5Nzc4MTQxMX0.Wl_SANDz_-FQUaFQwcKXVFVz1Oo1YJNJ-0yMWF_aM1c';

const dashClient = window.supabase.createClient(dashUrl, dashKey);
let dashSubjects = [];
let semesterStartDate = new Date('2026-05-18');

const ACCENT_POOL = ['#FF3366', '#00C9FF', '#7c3aed', '#11998e', '#FDBB2D', '#22C1C3', '#E100FF', '#92FE9D', '#0A84FF', '#f97316'];

// ==========================================
// LƯỚI GIỜ TIẾT HỌC SGU (đồng bộ với sguStartTime/sguEndTime trong tkb/app.js)
// Dùng để biết CHÍNH XÁC một lớp đang diễn ra hay chưa, thay vì chỉ so "cùng ngày"
// ==========================================
const PERIOD_START_MINS = { 1:420, 2:470, 3:540, 4:590, 5:640, 6:780, 7:830, 8:900, 9:950, 10:1000, 11:1060, 12:1110, 13:1160, 14:1210 };
const PERIOD_END_MINS   = { 1:470, 2:520, 3:590, 4:640, 5:690, 6:830, 7:880, 8:950, 9:1000, 10:1050, 11:1110, 12:1160, 13:1210, 14:1260 };

function parsePeriodRange(sub) {
    const match = (sub.time_slot || '').match(/Tiết\s*(\d+)(?:\s*-\s*(\d+))?/i);
    if (!match) return null;
    const startP = parseInt(match[1]);
    const endP = match[2] ? parseInt(match[2]) : startP;
    const startMin = PERIOD_START_MINS[startP];
    const endMin = PERIOD_END_MINS[endP];
    if (startMin === undefined || endMin === undefined) return null;
    return { startMin, endMin };
}

// Tìm buổi học gần nhất trong tương lai, bắt đầu tìm SAU (afterWeek, afterDay) — dùng cho
// cả trường hợp "hết lịch hôm nay" lẫn "lớp đang học xong thì lớp kế tiếp là gì"
function findNearestFutureSession(afterWeek, afterDay) {
    let candidates = [];
    dashSubjects.forEach(sub => {
        if (!sub.weeks) return;
        for (let w = afterWeek; w < sub.weeks.length; w++) {
            const char = sub.weeks.charAt(w);
            if (char !== '-' && char !== ' ') {
                if (w > afterWeek || (w === afterWeek && sub.day > afterDay)) {
                    candidates.push({ sub, w, day: sub.day });
                    break;
                }
            }
        }
    });
    if (!candidates.length) return null;
    candidates.sort((a, b) => {
        if (a.w !== b.w) return a.w - b.w;
        if (a.day !== b.day) return a.day - b.day;
        const ra = parsePeriodRange(a.sub), rb = parsePeriodRange(b.sub);
        return (ra ? ra.startMin : 0) - (rb ? rb.startMin : 0);
    });
    return candidates[0];
}

// ==========================================
// HELPER: QUYẾT ĐỊNH TÊN HIỂN THỊ (đồng bộ với /tkb/app.js)
// ==========================================
function resolveDisplayName(user, meta) {
    if (meta && meta.full_name && String(meta.full_name).trim()) {
        return String(meta.full_name).trim();
    }
    if (meta && meta.hide_email) {
        return "Người dùng SGU";
    }
    return user.email;
}

// ==========================================
// ÁP DỤNG THEME ĐÃ LƯU (chỉnh theme chỉ còn 1 nơi duy nhất: trang Profile,
// Dashboard chỉ đọc lại localStorage('theme') để hiển thị đúng, không có nút bấm riêng)
// ==========================================
if (localStorage.getItem('theme') === 'light') {
    document.body.classList.add('light-mode');
}

// ==========================================
// RENDER Ô PROFILE GÓC TRÊN PHẢI
// ==========================================
// ==========================================
// RENDER Ô PROFILE GÓC TRÊN PHẢI
// ==========================================
function renderProfilePill(user, meta) {
    const profileWrap = document.querySelector('.top-right-profile');
    if (!profileWrap) return;

    meta = meta || {};

    // 1. Chỉ tìm và cập nhật Avatar/Info, tuyệt đối KHÔNG dùng innerHTML ghi đè để bảo toàn nút Toggle
    let avatarDiv = profileWrap.querySelector('.profile-avatar');
    let infoDiv = profileWrap.querySelector('.profile-info');

    if (meta.avatar) {
        // CÓ AVT: hiển thị ảnh, ẩn phần text thông tin đi
        profileWrap.classList.add('avatar-only');
        if (avatarDiv) {
            avatarDiv.innerHTML = `<img src="${meta.avatar}" style="width:100%; height:100%; object-fit:cover; border-radius:50%;">`;
        }
        if (infoDiv) infoDiv.style.display = 'none';
    } else {
        // CHƯA CÓ AVT: hiển thị Icon và Email
        profileWrap.classList.remove('avatar-only');
        const nameToShow = resolveDisplayName(user, meta);
        
        if (avatarDiv) avatarDiv.innerHTML = `<i class="fas fa-user-graduate"></i>`;
        if (infoDiv) {
            infoDiv.style.display = 'flex';
            const emailDisplay = infoDiv.querySelector('#user-email-display');
            if (emailDisplay) emailDisplay.innerText = nameToShow;
        }
    }

    // 2. Click vào khung Avatar/Info -> nhảy sang trang Profile
    profileWrap.style.cursor = 'pointer';
    profileWrap.title = "Sửa Hồ Sơ Của Bạn";
    profileWrap.onclick = () => {
        localStorage.setItem('profileReturnTo', '../dashboard.html');
        navigateWithFade('profile/profile.html');
    };
}

// ==========================================
// CHUYỂN TRANG CÓ LOADER (dùng lại đúng hiệu ứng loading của tkb, tránh cảm giác nhảy trang đột ngột)
// ==========================================
window.navigateWithFade = function(url) {
    const loader = document.getElementById('global-loader');
    if (loader) {
        loader.classList.remove('hidden');
        setTimeout(() => { window.location.href = url; }, 450);
    } else {
        window.location.href = url;
    }
};

async function initDashboard() {
    // 1. Ép bật màn hình Loading ngay khi hàm bắt đầu chạy
    const loader = document.getElementById('global-loader');
    if (loader) loader.classList.remove('hidden');

    const { data: { session } } = await dashClient.auth.getSession();
    if (!session) return window.location.href = 'tkb/index.html';

    const userId = session.user.id;
    const meta = session.user.user_metadata || {};

    renderProfilePill(session.user, meta);

    try {
        const { data: settingsData } = await dashClient
            .from('user_settings')
            .select('semester_start_date')
            .eq('user_id', userId)
            .single();
        if (settingsData && settingsData.semester_start_date) {
            semesterStartDate = new Date(settingsData.semester_start_date + 'T00:00:00');
        }
    } catch (e) {}

    const [subjectsRes, examsRes, detailsRes] = await Promise.all([
        dashClient.from('subjects').select('*').eq('user_id', userId),
        dashClient.from('exams').select('*').eq('user_id', userId),
        dashClient.from('subject_details').select('*').eq('user_id', userId).eq('status', 'upcoming')
    ]);

    dashSubjects = subjectsRes.data || [];
    const allDetails = detailsRes.data || [];
    window.allTasks = allDetails.filter(d => d.type === 'task');
    window.allNotes = allDetails.filter(d => d.type === 'note' || d.type === 'notification');

    const now = new Date();
    const diffDays = Math.floor((now - semesterStartDate) / (1000 * 60 * 60 * 24));
    const weekIndex = diffDays >= 0 ? Math.floor(diffDays / 7) : -1;

    let activeClassesThisWeek = 0;
    if (weekIndex >= 0) {
        activeClassesThisWeek = dashSubjects.filter(sub => {
            if (!sub.weeks || sub.weeks.length <= weekIndex) return false;
            const char = sub.weeks.charAt(weekIndex);
            return char !== '-' && char !== ' ';
        }).length;
    }

    const uniqueSubs = new Set(dashSubjects.map(s => String(s.name || '').split('-')[0].split('(')[0].trim().toLowerCase()));
    document.getElementById('stat-total-subs').innerText = uniqueSubs.size;
    document.getElementById('stat-tkb-count').innerText = activeClassesThisWeek;
    document.getElementById('stat-exam-count').innerText = (examsRes.data || []).length;

    renderHero(now, weekIndex);
    switchWidget(0, document.querySelector('.widget-tabs button.active'));

    const mainUI = document.getElementById('main-dashboard-ui');
    if (mainUI) {
        mainUI.style.opacity = '1';
        mainUI.style.pointerEvents = 'auto';
    }

    // Gỡ bỏ màn hình Loading (Delay thêm một chút để hiệu ứng fade in của UI chạy mượt)
    setTimeout(() => {
        const loader = document.getElementById('global-loader');
        if (loader) loader.classList.add('hidden');
    }, 250);
}

function renderHero(now, weekIndex) {
    const nextLineEl = document.getElementById('tkb-next-line');
    const nextTextEl = document.getElementById('tkb-next-text');
    if (nextLineEl) nextLineEl.style.display = 'none'; // mặc định ẩn, chỉ bật khi có dữ liệu thật

    if (!dashSubjects.length) {
        document.getElementById('mini-tkb-name').innerText = "TRỐNG LỊCH HỌC";
        document.getElementById('mini-tkb-time').innerText = "Click icon TKB bên phải để tải dữ liệu";
        document.getElementById('val-bg-text').innerText = "SGU";
        document.getElementById('hero-status').innerText = "CHƯA CÓ DỮ LIỆU";
        
        // Random màu khi chưa nhập TKB
        const randomColor = ACCENT_POOL[Math.floor(Math.random() * ACCENT_POOL.length)];
        document.documentElement.style.setProperty('--accent', randomColor);
        if(!localStorage.getItem('customBg')) {
            document.body.style.backgroundImage = `radial-gradient(circle at 20% 40%, ${randomColor}25 0%, transparent 60%)`;
        }
        return;
    }

    const curDay = now.getDay() === 0 ? 8 : now.getDay() + 1;
    const curMins = now.getHours() * 60 + now.getMinutes();

    let upcoming = null;
    let status = 'future'; // 'ongoing' (đang học) | 'today' (chưa tới giờ, học hôm nay) | 'future' (ngày khác)
    let nextAfter = null;  // buổi học kế tiếp, để hiển thị khi lớp hiện tại kết thúc

    if (weekIndex >= 0) {
        const activeToday = dashSubjects
            .filter(sub => {
                if (sub.day !== curDay) return false;
                if (!sub.weeks || sub.weeks.length <= weekIndex) return false;
                const char = sub.weeks.charAt(weekIndex);
                return char !== '-' && char !== ' ';
            })
            .map(sub => ({ sub, range: parsePeriodRange(sub) }))
            .filter(x => x.range)
            .sort((a, b) => a.range.startMin - b.range.startMin);

        // 1. Có lớp nào ĐANG diễn ra đúng lúc này không? (so theo giờ thật, không chỉ theo ngày)
        const ongoingIdx = activeToday.findIndex(x => curMins >= x.range.startMin && curMins <= x.range.endMin);
        if (ongoingIdx !== -1) {
            upcoming = activeToday[ongoingIdx].sub;
            status = 'ongoing';
            const nextToday = activeToday[ongoingIdx + 1];
            nextAfter = nextToday ? { sub: nextToday.sub, day: curDay } : findNearestFutureSession(weekIndex, curDay);
        } else {
            // 2. Chưa tới giờ nhưng vẫn còn lớp hôm nay phía trước
            const todayUpcoming = activeToday.find(x => x.range.startMin > curMins);
            if (todayUpcoming) {
                upcoming = todayUpcoming.sub;
                status = 'today';
            }
        }

        // 3. Hôm nay hết lịch (hoặc chưa có lịch hôm nay) -> tìm buổi gần nhất trong tương lai
        if (!upcoming) {
            const found = findNearestFutureSession(weekIndex, curDay);
            if (found) {
                upcoming = found.sub;
                status = 'future';
            }
        }
    }

    // ĐÃ SỬA: Khi lịch học kết thúc, background cũng sẽ random thay vì chỉ là màu Đỏ mặc định
    if (!upcoming) {
        document.getElementById('mini-tkb-name').innerText = "KỲ HỌC KẾT THÚC";
        document.getElementById('mini-tkb-time').innerText = "Lịch học chính thức đã hoàn thành!";
        document.getElementById('mini-tkb-room').innerText = "Tại Gia";
        document.getElementById('mini-tkb-gv').innerText = "Tự Ôn Tập";
        document.getElementById('val-bg-text').innerText = "FINISH";
        document.getElementById('hero-status').innerText = "CHÚC BẠN THI TỐT";
        
        // Cấp phát 1 màu random ngẫu nhiên
        const randomColor = ACCENT_POOL[Math.floor(Math.random() * ACCENT_POOL.length)];
        document.documentElement.style.setProperty('--accent', randomColor);
        
        if(!localStorage.getItem('customBg')) {
            document.body.style.backgroundImage = `radial-gradient(circle at 20% 40%, ${randomColor}25 0%, transparent 60%)`;
        }
        return;
    }

    const rawName = (upcoming.name || 'Môn Ẩn').split('-')[0].split('(')[0].trim();
    document.getElementById('mini-tkb-name').innerText = rawName;
    document.getElementById('mini-tkb-time').innerText = `${upcoming.day === curDay ? "HÔM NAY" : (upcoming.day === 8 ? "CHỦ NHẬT" : "THỨ " + upcoming.day)}  •  ${upcoming.exact_time || upcoming.time_slot || ''}`;
    document.getElementById('mini-tkb-room').innerText = upcoming.room || "N/A";
    document.getElementById('mini-tkb-gv').innerText = upcoming.lecturer || "N/A";
    document.getElementById('val-bg-text').innerText = upcoming.course_code || "SGU";
    document.getElementById('hero-status').innerText =
        status === 'ongoing' ? "ĐANG DIỄN RA" :
        status === 'today' ? "SẮP DIỄN RA" : "LỚP TIẾP THEO";

    // Hiển thị "lớp kế tiếp" khi lớp hiện tại đang diễn ra, để dù hết tiết sớm vẫn biết tiết sau là gì
    if (status === 'ongoing' && nextAfter && nextLineEl && nextTextEl) {
        const nextRawName = (nextAfter.sub.name || 'Môn Ẩn').split('-')[0].split('(')[0].trim();
        const dayLabel = nextAfter.day === curDay ? "hôm nay" : (nextAfter.day === 8 ? "Chủ Nhật" : "Thứ " + nextAfter.day);
        nextTextEl.innerText = `${nextRawName} • ${dayLabel}, ${nextAfter.sub.exact_time || nextAfter.sub.time_slot || ''}`;
        nextLineEl.style.display = 'flex';
    }

    const colors = ['#FF3366', '#00C9FF', '#7c3aed', '#11998e', '#FDBB2D'];
    let colorMap = {}, i = 0;
    dashSubjects.forEach(s => {
        const bn = (s.name || '').split('-')[0].split('(')[0].trim().toLowerCase();
        if (!colorMap[bn]) colorMap[bn] = colors[i++ % colors.length];
    });

    const savedColors = JSON.parse(localStorage.getItem('subjectCustomColors') || '{}');
    const finalColor = savedColors[rawName.toLowerCase()] || colorMap[rawName.toLowerCase()] || '#ff4655';

    document.documentElement.style.setProperty('--accent', finalColor);
    if(!localStorage.getItem('customBg')) {
        document.body.style.backgroundImage = `radial-gradient(circle at 20% 40%, ${finalColor}25 0%, transparent 60%)`;
    }
}

window.switchWidget = function(idx, btn) {
    if(btn) {
        btn.parentElement.querySelectorAll('button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
    }
    const box = document.getElementById('widget-dynamic-content');
    if(!box) return;

    const data = idx === 0 ? (window.allTasks || []) : (window.allNotes || []);
    const icon = idx === 0 ? 'fa-tasks' : 'fa-pen';

    if (!data.length) {
        box.innerHTML = `<div class="empty-state"><i class="fas ${idx === 0 ? 'fa-check-circle' : 'fa-sticky-note'}"></i> ${idx === 0 ? "Xong hết bài tập!" : "Chưa có ghi chú nào."}</div>`;
        return;
    }

    box.innerHTML = data.slice(0, 3).map(item => `
        <div class="list-item" onclick="window.goToTab('timetable')">
            <div class="list-icon" style="color: var(--accent);"><i class="fas ${icon}"></i></div>
            <div class="list-text"><h4>${item.content || "Trống"}</h4><p>Click mở Workspace</p></div>
        </div>
    `).join('');
};

// ==========================================
// CẦU NỐI NHẢY TAB TỪ DASHBOARD VÀO WORKSPACE
// ==========================================
window.goToTab = function(tabName) {
    localStorage.setItem('targetTab', tabName);
    navigateWithFade('tkb/index.html');
};

window.logout = async () => {
    await dashClient.auth.signOut();
    navigateWithFade('tkb/index.html');
};

initDashboard();
