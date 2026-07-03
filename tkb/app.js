const supabaseUrl = 'https://oyumvhldhmjmahohavsp.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im95dW12aGxkaG1qbWFob2hhdnNwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIyMDU0MTEsImV4cCI6MjA5Nzc4MTQxMX0.Wl_SANDz_-FQUaFQwcKXVFVz1Oo1YJNJ-0yMWF_aM1c';
const supabase = window.supabase.createClient(supabaseUrl, supabaseKey);

let currentUser = null;
let currentSubjectId = null;
let allLoadedSubjects = []; 

let semesterStartDate = new Date('2026-05-18'); 

// =========================================
// 0. CUSTOM DIALOG LOGIC (THAY THẾ ALERT/CONFIRM)
// =========================================
window.showCustomDialog = function(message, isConfirm = false, title = "Thông báo") {
    return new Promise((resolve) => {
        const overlay = document.getElementById('custom-dialog-overlay');
        const titleEl = document.getElementById('custom-dialog-title');
        const msgEl = document.getElementById('custom-dialog-msg');
        const cancelBtn = document.getElementById('custom-dialog-cancel');
        const okBtn = document.getElementById('custom-dialog-ok');

        titleEl.innerText = title;
        msgEl.innerHTML = message.replace(/\n/g, '<br>');

        if (isConfirm) {
            cancelBtn.style.display = 'inline-flex';
        } else {
            cancelBtn.style.display = 'none';
        }

        overlay.classList.remove('hidden');

        // Hàm dọn dẹp và đóng popup
        const cleanup = () => {
            overlay.classList.add('hidden');
            // Clone node để xóa bỏ mọi event listener rác của lần mở trước
            cancelBtn.replaceWith(cancelBtn.cloneNode(true));
            okBtn.replaceWith(okBtn.cloneNode(true));
        };

        // Gắn sự kiện cho các nút mới
        const newCancelBtn = document.getElementById('custom-dialog-cancel');
        const newOkBtn = document.getElementById('custom-dialog-ok');

        newCancelBtn.addEventListener('click', () => { cleanup(); resolve(false); });
        newOkBtn.addEventListener('click', () => { cleanup(); resolve(true); });
    });
};

window.showAlert = (msg, title) => window.showCustomDialog(msg, false, title);
window.showConfirm = (msg, title) => window.showCustomDialog(msg, true, title);


// =========================================
// 1. QUẢN LÝ ĐĂNG NHẬP & CHUYỂN TAB
// =========================================
document.addEventListener('DOMContentLoaded', () => {
    supabase.auth.getSession().then(({ data: { session } }) => { handleSession(session); });
    supabase.auth.onAuthStateChange((_event, session) => { handleSession(session); });

    updateDesktopClock();
    setInterval(updateDesktopClock, 1000);
    renderNeonColorButtons();
    
    const themeToggle = document.getElementById('theme-toggle');
    if(themeToggle) {
        if(localStorage.getItem('theme') === 'light') {
            document.body.classList.add('light-mode');
            themeToggle.checked = true;
        } else {
            document.body.classList.remove('light-mode'); 
            themeToggle.checked = false;
        }

        themeToggle.addEventListener('change', function() {
            if(this.checked) {
                document.body.classList.add('light-mode');
                localStorage.setItem('theme', 'light');
            } else {
                document.body.classList.remove('light-mode');
                localStorage.setItem('theme', 'dark');
            }
        });
    }
    
    const savedBg = localStorage.getItem('customBg');
    if(savedBg && document.getElementById('custom-bg-url')) {
        document.body.style.backgroundImage = `url('${savedBg}')`;
        document.body.style.backgroundSize = 'cover';
        document.body.style.backgroundPosition = 'center';
    }

    const shareMenu = document.getElementById("share-menu-widget");
    const shareToggleBtn = document.getElementById("share-toggle-btn");
    
    if (shareToggleBtn && shareMenu) {
        shareToggleBtn.addEventListener("click", () => { shareMenu.classList.toggle("active"); });
        document.addEventListener('click', (e) => {
            if (!shareMenu.contains(e.target)) shareMenu.classList.remove("active");
        });
    }

    const bgFileInput = document.getElementById('custom-bg-file');
    if (bgFileInput) {
        bgFileInput.addEventListener('change', function(e) {
            const file = e.target.files[0];
            if (!file) return;

            if (file.size > 3.5 * 1024 * 1024) { 
                showAlert("Kích thước ảnh quá lớn! Vui lòng chọn ảnh nhẹ hơn (dưới 3.5MB) để trình duyệt không bị giật lag nhé.", "Quá tải dung lượng");
                this.value = ''; 
                return;
            }

            const reader = new FileReader();
            reader.onload = function(event) {
                const base64Image = event.target.result;
                document.body.style.backgroundImage = `url('${base64Image}')`;
                document.body.style.backgroundSize = 'cover';
                document.body.style.backgroundPosition = 'center';
                
                try {
                    localStorage.setItem('customBg', base64Image);
                } catch (err) {
                    showAlert("Bộ nhớ tạm của trình duyệt đã đầy. Bạn hãy dùng ảnh nhẹ hơn hoặc sử dụng dán Link URL nhé!", "Lỗi bộ nhớ");
                }
            };
            reader.readAsDataURL(file);
        });
    }
});

function updateDesktopClock() {
    const timeEl = document.getElementById('live-time');
    const dateEl = document.getElementById('live-date');
    if (!timeEl || !dateEl) return;

    const now = new Date();
    timeEl.innerText = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
    dateEl.innerText = now.toLocaleDateString('en-US', { weekday: 'long', month: '2-digit', day: '2-digit' }).replace(',', '');
}

function escapeHtml(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function handleSession(session) {
    const loader = document.getElementById('global-loader');
    
    // ĐÃ XÓA LỆNH TẮT LOADER SỚM Ở ĐÂY

    if (session) {
        if (currentUser && currentUser.id === session.user.id) {
            if (loader) loader.classList.add('hidden');
            return; 
        }

        currentUser = session.user;
        const meta = currentUser.user_metadata;
        const emailSpan = document.getElementById('user-email-display');
        const profilePill = document.querySelector('.profile-pill');
        const displayArea = document.getElementById('profile-display-area');

        if (emailSpan && profilePill && displayArea) {
            const oldImg = displayArea.querySelector('.custom-avatar-img');
            if (oldImg) oldImg.remove();

            if (meta && meta.avatar) {
                const img = document.createElement('img');
                img.src = meta.avatar;
                img.className = 'custom-avatar-img';
                img.style.cssText = 'width:34px; height:34px; border-radius:50%; object-fit:cover; border: 2px solid #FF3366; margin: 0;';
                
                displayArea.insertBefore(img, emailSpan);
                emailSpan.style.display = 'none'; 
                profilePill.classList.add('avatar-mode'); 
            } else {
                let nameToShow = currentUser.email;
                if (meta && meta.full_name && String(meta.full_name).trim()) {
                    nameToShow = meta.full_name.trim();
                } else if (meta && meta.hide_email) {
                    nameToShow = "Người dùng SGU";
                }
                emailSpan.innerText = nameToShow;
                emailSpan.style.display = 'inline-block';
                profilePill.classList.remove('avatar-mode'); 
            }
        }
        
        applyTargetTabInstant();
        document.getElementById('auth-screen').classList.add('hidden');
        document.getElementById('main-app').style.opacity = '1';
        document.getElementById('main-app').style.pointerEvents = 'auto';
        
        supabase.from('user_settings').select('semester_start_date').eq('user_id', currentUser.id).single()
        .then(async ({data, error}) => { 
            if(data && data.semester_start_date) {
                semesterStartDate = new Date(data.semester_start_date + 'T00:00:00');
            }
            await loadTimetable(); 
            loadExams();

            // ĐÃ SỬA: Đợi tất cả render xong xuôi 100% rồi mới từ từ tắt màng đen
            setTimeout(() => {
                if (loader) loader.classList.add('hidden');
            }, 300);
        });

    } else {
        currentUser = null;
        document.getElementById('auth-screen').classList.remove('hidden');
        document.getElementById('main-app').style.opacity = '0';
        document.getElementById('main-app').style.pointerEvents = 'none';
        
        // Đảm bảo tắt loader nếu đang ở trang đăng nhập
        setTimeout(() => {
            if (loader) loader.classList.add('hidden');
        }, 300);
    }
}

window.maxSemesterWeek = 20; 

let authMode = 'login';
window.switchAuthTab = function(mode) {
    if (authMode === mode) return; 
    authMode = mode;
    document.getElementById('tab-slider').style.transform = mode === 'register' ? 'translateX(100%)' : 'translateX(0)';
    document.getElementById('tab-login').classList.toggle('active', mode === 'login');
    document.getElementById('tab-register').classList.toggle('active', mode === 'register');
    
    const formContent = document.getElementById('auth-form-content');
    formContent.classList.add('fade-out');
    setTimeout(() => {
        document.getElementById('auth-submit-btn').innerText = mode === 'login' ? 'Bắt Đầu' : 'Tạo Tài Khoản';
        document.getElementById('auth-greeting').innerText = mode === 'login' ? 'Mừng bạn quay trở lại' : 'Bắt đầu hành trình mới';
        document.getElementById('auth-icon-login').style.display = mode === 'login' ? 'block' : 'none';
        document.getElementById('auth-icon-register').style.display = mode === 'register' ? 'block' : 'none';
        formContent.classList.remove('fade-out');
    }, 150);
    document.getElementById('auth-error').innerText = ''; 
}

window.handleAuth = async function(e) {
    e.preventDefault();
    const email = document.getElementById('auth-email').value;
    const password = document.getElementById('auth-password').value;
    const errorEl = document.getElementById('auth-error');
    errorEl.innerText = 'Đang xử lý...';

    let result = authMode === 'login' ? await supabase.auth.signInWithPassword({ email, password }) : await supabase.auth.signUp({ email, password });
    if (result.error) errorEl.innerText = result.error.message;
    else { 
        errorEl.innerText = ''; 
        if (authMode === 'register') showAlert('Đăng ký tài khoản thành công! Bạn có thể bắt đầu sử dụng.', 'Thành công'); 
    }
}

// =========================================
// 1.2. LOGIC CHO DROPDOWN MENU KÍNH MỜ
// =========================================
window.toggleProfileDropdown = function(e) {
    e.stopPropagation();
    const dropdown = document.getElementById('profile-dropdown-list');
    const container = document.getElementById('profile-dropdown-container');
    
    dropdown.classList.toggle('hidden-dropdown');
    
    // Đảo chiều mũi tên khi mở menu
    const arrow = container.querySelector('.select-arrow');
    if (arrow) {
        if (!dropdown.classList.contains('hidden-dropdown')) {
            arrow.style.transform = 'rotate(180deg)';
        } else {
            arrow.style.transform = 'none';
        }
    }
};

// Ẩn menu khi click ra ngoài
document.addEventListener('click', function(e) {
    const container = document.getElementById('profile-dropdown-container');
    const dropdown = document.getElementById('profile-dropdown-list');
    if (container && dropdown && !container.contains(e.target)) {
        dropdown.classList.add('hidden-dropdown');
        const arrow = container.querySelector('.select-arrow');
        if (arrow) arrow.style.transform = 'none';
    }
});

window.logout = async function() { 
    // Nhớ Tab hiện tại trước khi Logout
    const activeTabLi = document.querySelector('.nav-links li.active');
    if (activeTabLi) {
        const title = activeTabLi.getAttribute('title');
        let targetName = 'timetable'; 
        
        if (title.includes('Lịch Thi')) targetName = 'exams';
        else if (title.includes('Cài Đặt')) targetName = 'settings';
        
        localStorage.setItem('targetTab', targetName);
    }

    await supabase.auth.signOut(); 
}

window.switchTab = function(tabId, element, titleText) {
    if (element.classList.contains('active')) return; 

    const loader = document.getElementById('global-loader');
    loader.classList.remove('hidden');

    setTimeout(() => {
        document.querySelectorAll('.nav-links li').forEach(li => li.classList.remove('active'));
        element.classList.add('active');

        document.querySelectorAll('.tab-pane').forEach(pane => pane.classList.remove('active'));
        document.getElementById(`tab-${tabId}`).classList.add('active');

        if(titleText) document.getElementById('topbar-title').innerText = titleText;

        const importLabel = document.getElementById('top-import-label');
        const importText = document.getElementById('top-import-text');
        
        if (importLabel && importText) {
            if (tabId === 'timetable') {
                importLabel.style.display = 'inline-flex';
                importLabel.setAttribute('for', 'excel-file');
                importText.innerText = 'Nhập TKB';
            } else if (tabId === 'exams') {
                importLabel.style.display = 'inline-flex';
                importLabel.setAttribute('for', 'excel-exam-file');
                importText.innerText = 'Nhập Lịch Thi';
            } else {
                importLabel.style.display = 'none';
            }
        }

        setTimeout(() => { loader.classList.add('hidden'); }, 150); 
    }, 350); 
}

function applyTargetTabInstant() {
    const target = localStorage.getItem('targetTab');
    localStorage.removeItem('targetTab'); 
    if (!target) return;

    const navTitleMap = { timetable: 'Thời Khóa Biểu', exams: 'Lịch Thi', settings: 'Cài Đặt' };
    const topbarTitleMap = { timetable: 'Thời Khóa Biểu', exams: 'Lịch Thi Học Kỳ', settings: 'Cài Đặt Workspace' };

    const li = Array.from(document.querySelectorAll('.nav-links li')).find(
        el => el.getAttribute('title') && el.getAttribute('title').includes(navTitleMap[target])
    );
    if (!li) return;

    document.querySelectorAll('.nav-links li').forEach(x => x.classList.remove('active'));
    li.classList.add('active');

    document.querySelectorAll('.tab-pane').forEach(pane => pane.classList.remove('active'));
    const pane = document.getElementById(`tab-${target}`);
    if (pane) pane.classList.add('active');

    const topbarTitle = document.getElementById('topbar-title');
    if (topbarTitle) topbarTitle.innerText = topbarTitleMap[target];

    const importLabel = document.getElementById('top-import-label');
    const importText = document.getElementById('top-import-text');
    if (importLabel && importText) {
        if (target === 'timetable') {
            importLabel.style.display = 'inline-flex';
            importLabel.setAttribute('for', 'excel-file');
            importText.innerText = 'Nhập TKB';
        } else if (target === 'exams') {
            importLabel.style.display = 'inline-flex';
            importLabel.setAttribute('for', 'excel-exam-file');
            importText.innerText = 'Nhập Lịch Thi';
        } else {
            importLabel.style.display = 'none';
        }
    }
}

window.navigateWithFade = function(url) {
    const loader = document.getElementById('global-loader');
    if (loader) {
        loader.classList.remove('hidden');
        setTimeout(() => { window.location.href = url; }, 450);
    } else {
        window.location.href = url;
    }
};

// =========================================
// 1.6b. VÀO PROFILE TỪ TKB — nhớ điểm quay về
// =========================================
window.goToProfileFromTkb = function() {
    localStorage.setItem('profileReturnTo', '../tkb/index.html');

    // Ghi nhớ luôn tab đang đứng (Thời Khóa Biểu/Lịch Thi/Cài Đặt) để applyTargetTabInstant()
    // tự khôi phục đúng tab đó khi quay lại, không chỉ mặc định về Thời Khóa Biểu
    const activePane = document.querySelector('.tab-pane.active');
    if (activePane && activePane.id) {
        localStorage.setItem('targetTab', activePane.id.replace('tab-', ''));
    }

    navigateWithFade('../profile/profile.html');
};

// =========================================
// 2. RENDER LƯỚI TKB & IMPORT EXCEL
// =========================================

function initWeekSelector(maxW = 20) {
    window.maxSemesterWeek = maxW;
    const selector = document.getElementById('week-selector');
    const customList = document.getElementById('week-options-list');
    if (!selector) return;

    let currentSelected = parseInt(selector.value);

    selector.innerHTML = '';
    if(customList) customList.innerHTML = '';

    const now = new Date();
    const diffTime = now.getTime() - semesterStartDate.getTime();
    const oneWeekTime = 7 * 24 * 60 * 60 * 1000;

    let autoCurrentWeek = Math.ceil(diffTime / oneWeekTime);
    if (autoCurrentWeek < 1) autoCurrentWeek = 1;
    if (autoCurrentWeek > maxW) autoCurrentWeek = maxW;

    if (!currentSelected || isNaN(currentSelected)) currentSelected = autoCurrentWeek;
    if (currentSelected > maxW) currentSelected = maxW;

    for(let i = 1; i <= maxW; i++) { 
        const weekStart = new Date(semesterStartDate);
        weekStart.setDate(semesterStartDate.getDate() + (i - 1) * 7);

        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekStart.getDate() + 6);

        const startStr = `${weekStart.getDate().toString().padStart(2, '0')}/${(weekStart.getMonth()+1).toString().padStart(2, '0')}`;
        const endStr = `${weekEnd.getDate().toString().padStart(2, '0')}/${(weekEnd.getMonth()+1).toString().padStart(2, '0')}`;

        const text = `Tuần ${i} (Từ ${startStr} đến ${endStr})`;

        const option = document.createElement('option');
        option.value = i; option.text = text;
        selector.appendChild(option);

        if(customList) {
            const li = document.createElement('li');
            li.innerText = text; li.dataset.val = i;
            if (i === currentSelected) li.classList.add('selected');
            
            li.onclick = (e) => { e.stopPropagation(); selectCustomWeek(i); };
            customList.appendChild(li);
        }
    }

    selector.value = currentSelected;
    
    const currentTextEl = document.getElementById('current-week-text');
    if(currentTextEl && selector.options[selector.selectedIndex]) {
        currentTextEl.innerText = selector.options[selector.selectedIndex].text;
    }
}

document.getElementById('excel-file').addEventListener('change', async function(e) {
    if (!currentUser) {
        showAlert("Vui lòng đăng nhập trước khi tải lên TKB!", "Yêu cầu đăng nhập");
        e.target.value = '';
        return;
    }
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async function(event) {
        try {
            const data = new Uint8Array(event.target.result);
            const workbook = XLSX.read(data, { type: 'array' });
            const jsonArray = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);

            const formattedData = [];
            
            const sguStartTime = { 1:"07:00", 2:"07:50", 3:"09:00", 4:"09:50", 5:"10:40", 6:"13:00", 7:"13:50", 8:"15:00", 9:"15:50", 10:"16:40", 11:"17:40", 12:"18:30", 13:"19:20", 14:"20:10" };
            const sguEndTime = { 1:"07:50", 2:"08:40", 3:"09:50", 4:"10:40", 5:"11:30", 6:"13:50", 7:"14:40", 8:"15:50", 9:"16:40", 10:"17:30", 11:"18:30", 12:"19:20", 13:"20:10", 14:"21:00" };
            
            for (let i = 0; i < jsonArray.length; i++) {
                const row = jsonArray[i];
                
                const courseCode = String(row['Mã HP'] || row['Mã MH'] || '').trim();
                const subjectName = String(row['Tên môn'] || row['Tên môn học'] || '').trim();
                const groupId = String(row['Nhóm'] || row['Nhóm tổ'] || '').trim();
                const lecturer = String(row['Giảng viên'] || '').trim();
                const room = String(row['Phòng'] || '').trim();
                const day = parseInt(row['Thứ']);
                
                if (isNaN(day) || !subjectName) continue; 
                
                let timeSlot = String(row['Tiết'] || '').trim();
                let startTiet = 0;
                let endTiet = 0;
                
                if (timeSlot) {
                    const match = timeSlot.match(/Tiết\s*(\d+)\s*-\s*(\d+)/i);
                    if (match) { startTiet = parseInt(match[1]); endTiet = parseInt(match[2]); }
                } else if (row['Tiết bắt đầu'] !== undefined && row['Số tiết'] !== undefined) {
                    startTiet = parseInt(row['Tiết bắt đầu']);
                    endTiet = startTiet + parseInt(row['Số tiết']) - 1;
                    timeSlot = `Tiết ${startTiet}-${endTiet}`;
                }

                let exactTime = String(row['Thời gian'] || '').trim();
                if (!exactTime && startTiet > 0 && endTiet > 0) {
                    if (sguStartTime[startTiet] && sguEndTime[endTiet]) {
                        exactTime = `${sguStartTime[startTiet]} -> ${sguEndTime[endTiet]}`;
                    }
                }

                let weeks = String(row['Tuần'] || row['Tuần học'] || '').trim();
                let dateRangeStr = String(row['Thời gian học'] || '').trim();
                
                if (!weeks && dateRangeStr.includes('đến') && typeof semesterStartDate !== 'undefined') {
                    try {
                        const dates = dateRangeStr.split('đến').map(s => s.trim());
                        if (dates.length === 2 && dates[0].includes('/')) {
                            const parseDate = (dStr) => {
                                const p = dStr.split('/');
                                const y = p[2].length === 2 ? 2000 + parseInt(p[2]) : parseInt(p[2]);
                                return new Date(y, parseInt(p[1]) - 1, parseInt(p[0]));
                            };
                            
                            const sDate = parseDate(dates[0]);
                            const eDate = parseDate(dates[1]);
                            
                            const msPerWeek = 7 * 24 * 60 * 60 * 1000;
                            const diffStart = Math.floor((sDate.getTime() - semesterStartDate.getTime()) / msPerWeek);
                            const diffEnd = Math.floor((eDate.getTime() - semesterStartDate.getTime()) / msPerWeek);
                            
                            let weekArr = Array(20).fill('-');
                            for (let w = Math.max(0, diffStart); w <= Math.min(19, diffEnd); w++) {
                                weekArr[w] = ((w + 1) % 10).toString(); 
                            }
                            weeks = weekArr.join('');
                        }
                    } catch (dateErr) {
                        console.warn("Bỏ qua lỗi dịch ngày tháng ở môn: ", subjectName, dateErr);
                    }
                }

                if (startTiet > 0 && endTiet >= startTiet) {
                    formattedData.push({
                        user_id: currentUser.id, 
                        name: subjectName, 
                        day: day,
                        time_slot: timeSlot, 
                        room: room, 
                        course_code: courseCode,
                        group_id: groupId, 
                        lecturer: lecturer, 
                        exact_time: exactTime, 
                        weeks: weeks
                    });
                }
            }

            if (formattedData.length === 0) {
                showAlert("Không tìm thấy dữ liệu TKB nào hợp lệ trong file.", "Lỗi dữ liệu");
                e.target.value = '';
                return;
            }

            const { error: deleteErr } = await supabase.from('subjects').delete().eq('user_id', currentUser.id); 
            if (deleteErr) throw new Error("Không thể xóa dữ liệu cũ: " + deleteErr.message);

            const { error: insertErr } = await supabase.from('subjects').insert(formattedData);
            if (insertErr) throw new Error("Supabase từ chối lưu dữ liệu: " + insertErr.message);
            
            showAlert("Đã đồng bộ TKB thành công! Giao diện sẽ tự động cập nhật.", "Hoàn tất"); 
            await loadTimetable(); 
            loadExams(); 
            e.target.value = '';
            
        } catch (err) { 
            showAlert(`Lỗi xử lý file:\n${err.message || 'Vui lòng kiểm tra lại định dạng file.'}`, "Lỗi hệ thống"); 
            console.error("Chi tiết lỗi:", err);
        }
    };
    reader.readAsArrayBuffer(file);
});

window.openModalById = function(id) {
    const sub = allLoadedSubjects.find(s => String(s.id) === String(id));
    if (sub) openModal(sub);
};

async function loadTimetable() {
    if (!currentUser) return;
    const { data: subjects, error } = await supabase.from('subjects').select('*').eq('user_id', currentUser.id);
    if (error) return console.error('Lỗi tải TKB:', error);
    
    const safeSubjects = subjects || [];
    allLoadedSubjects = safeSubjects; 

    let actualMaxW = 1;
    if (safeSubjects.length > 0) {
        safeSubjects.forEach(sub => {
            if (sub.weeks) {
                for (let i = sub.weeks.length - 1; i >= 0; i--) {
                    if (sub.weeks[i] !== '-' && sub.weeks[i] !== ' ') {
                        if (i + 1 > actualMaxW) actualMaxW = i + 1;
                        break;
                    }
                }
            }
        });
    } else {
        actualMaxW = 20; 
    }

    let maxW = actualMaxW < 20 ? actualMaxW + 1 : actualMaxW;

    const customList = document.getElementById('week-options-list');
    if (customList && (customList.children.length !== maxW || customList.children.length === 0)) {
        initWeekSelector(maxW);
    }

    const wrapper = document.getElementById('timetable-wrapper'); 
    wrapper.innerHTML = ''; 

    if (safeSubjects.length === 0) {
        wrapper.innerHTML = '<div class="empty-state">Chưa có TKB. Bấm Nhập Excel để đưa lịch học vào khung giữa.</div>';
        return;
    }

    const selector = document.getElementById('week-selector');
    const selectedWeekNum = selector ? parseInt(selector.value) : 1;
    const weekIndex = selectedWeekNum - 1;

    const prevBtn = document.getElementById('prev-week-btn');
    const nextBtn = document.getElementById('next-week-btn');
    if (prevBtn) {
        prevBtn.style.opacity = selectedWeekNum <= 1 ? '0.2' : '1';
        prevBtn.style.pointerEvents = selectedWeekNum <= 1 ? 'none' : 'auto';
    }
    if (nextBtn) {
        nextBtn.style.opacity = selectedWeekNum >= maxW ? '0.2' : '1';
        nextBtn.style.pointerEvents = selectedWeekNum >= maxW ? 'none' : 'auto';
    }

    if (selectedWeekNum > actualMaxW) {
        wrapper.innerHTML = `
            <div style="height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; opacity: 0.95; text-align: center; padding: 20px; animation: fadeInSlide 0.5s ease-out forwards;">
                <div style="width: 100px; height: 100px; border-radius: 50%; background: linear-gradient(135deg, rgba(10, 132, 255, 0.2), rgba(0, 201, 255, 0.05)); display: flex; align-items: center; justify-content: center; margin-bottom: 25px; border: 1px solid rgba(10, 132, 255, 0.3); box-shadow: 0 0 30px rgba(10, 132, 255, 0.15);">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#0A84FF" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path><path d="M9 12l2 2 4-4"></path></svg>
                </div>
                <h4 style="font-size: 1.65rem; font-weight: 700; color: var(--text-main); margin-bottom: 12px; letter-spacing: -0.5px;">Hoàn thành chương trình học!</h4>
                <p style="font-size: 1.05rem; color: var(--text-muted); max-width: 450px; line-height: 1.6;">Lịch học chính thức của bạn đã kết thúc. Hãy theo dõi mục <strong style="color: var(--accent);">Lịch Thi</strong> và dành thời gian ôn tập thật tốt nhé!</p>
            </div>
        `;
        return; 
    }

    const matrix = {};
    for (let t = 1; t <= 14; t++) {
        matrix[t] = {};
        for (let d = 2; d <= 8; d++) {
            matrix[t][d] = { status: 'empty', duration: 1, data: null };
        }
    }

    const renderedCards = new Set();
    safeSubjects.forEach(sub => {
        if (sub.weeks && sub.weeks.length > weekIndex) {
            const weekChar = sub.weeks.charAt(weekIndex);
            if (weekChar === '-' || weekChar === ' ' || !weekChar) { return; }
        }

        const match = (sub.time_slot || '').match(/Tiết\s*(\d+)\s*-\s*(\d+)/i);
        if (match) {
            let startTiet = parseInt(match[1]); 
            let endTiet = parseInt(match[2]);
            if (startTiet > endTiet) { const temp = startTiet; startTiet = endTiet; endTiet = temp; }

            const uniqueKey = `${sub.day}-${startTiet}-${endTiet}-${sub.course_code}`;
            if (renderedCards.has(uniqueKey)) return; 
            renderedCards.add(uniqueKey);

            const duration = endTiet - startTiet + 1;
            matrix[startTiet][sub.day] = { status: 'start', duration: duration, data: sub };
            for (let t = startTiet + 1; t <= endTiet; t++) {
                matrix[t][sub.day] = { status: 'covered' };
            }
        }
    });

    const currentWeekMonday = new Date(semesterStartDate);
    currentWeekMonday.setDate(semesterStartDate.getDate() + weekIndex * 7);

    let tableHtml = `<div class="sticky-glass-bar" id="sticky-header-bg"></div>`;
    tableHtml += `<table class="timetable-table"><thead><tr>`;
    tableHtml += `<th>Tiết</th>`;
    
    for(let d = 2; d <= 8; d++) {
        const currentDate = new Date(currentWeekMonday);
        currentDate.setDate(currentWeekMonday.getDate() + (d - 2));
        const dateStr = `${currentDate.getDate().toString().padStart(2, '0')}/${(currentDate.getMonth()+1).toString().padStart(2, '0')}`;
        
        const dayName = d === 8 ? 'Chủ Nhật' : `Thứ ${d}`;
        tableHtml += `<th>${dayName}<br><span class="date-sub">${dateStr}</span></th>`;
    }
    tableHtml += `<th>Giờ</th></tr></thead><tbody>`;

    const timeMap = { 1:"07:00", 2:"07:50", 3:"09:00", 4:"09:50", 5:"10:40", 6:"13:00", 7:"13:50", 8:"15:00", 9:"15:50", 10:"16:40", 11:"17:40", 12:"18:30", 13:"19:20", 14:"20:10" };
    const gradientColors = [ ['#FF3366', '#FF9933'], ['#00C9FF', '#92FE9D'], ['#7c3aed', '#E100FF'], ['#11998e', '#38ef7d'], ['#FDBB2D', '#22C1C3'] ];
    const subjectColorMap = {}; let colorIndex = 0;
    
    window.globalSubjectColors = {};

    let savedSubjectColors = {};
    try { savedSubjectColors = JSON.parse(localStorage.getItem('subjectCustomColors')) || {}; } catch(e){}

    for (let t = 1; t <= 14; t++) {
        tableHtml += `<tr><td class="grid-time">Tiết ${t}</td>`;

        for (let d = 2; d <= 8; d++) {
            const slot = matrix[t][d];

            if (slot.status === 'start') {
                const sub = slot.data;
                const baseName = sub.name.split('-')[0].split('(')[0].trim().toLowerCase();
                
                if (!subjectColorMap[baseName]) { subjectColorMap[baseName] = gradientColors[colorIndex % gradientColors.length]; colorIndex++; }
                let c1, c2;
                if (savedSubjectColors[baseName]) { c1 = savedSubjectColors[baseName]; c2 = savedSubjectColors[baseName]; } 
                else { c1 = subjectColorMap[baseName][0]; c2 = subjectColorMap[baseName][1]; }
                
                window.globalSubjectColors[baseName] = c1;
                
                const customColorStyle = `style="--c1: ${c1}; --c2: ${c2};"`;
                const rawName = sub.name.split('(')[0].trim();
                const contentLength = rawName.length + (sub.room || '').length + (sub.lecturer || '').length;

                tableHtml += `
                    <td rowspan="${slot.duration}" class="subject-card-td ${contentLength > 70 ? 'large' : 'compact'}" ${customColorStyle} onclick="window.openModalById('${sub.id}')">
                        <div class="card-title-area">
                            <h4 title="${escapeHtml(rawName)}">${escapeHtml(rawName)} <br><span class="course-code">${escapeHtml(sub.course_code || 'N/A')}</span></h4>
                        </div>
                        <p class="info-text">Nhóm: ${escapeHtml(sub.group_id || 'N/A')}</p>
                        <p class="info-text">Phòng: ${escapeHtml(sub.room || 'N/A')}</p>
                        <p class="info-text">GV: ${escapeHtml(sub.lecturer || 'N/A')}</p>
                        <p class="info-text time-text">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                            ${escapeHtml(sub.exact_time ? sub.exact_time : `Tiết ${t}-${t + slot.duration - 1}`)}
                        </p>
                    </td>
                `;
            } else if (slot.status === 'empty') {
                tableHtml += `<td class="empty-td"></td>`;
            }
        }
        tableHtml += `<td class="grid-time time-col"><strong>${timeMap[t]}</strong></td></tr>`;
    }

    tableHtml += `</tbody></table>`;
    wrapper.innerHTML = tableHtml;

    wrapper.onscroll = function() {
        const bar = document.getElementById('sticky-header-bg');
        if (bar) {
            if (this.scrollTop > 2) bar.classList.add('scrolled');
            else bar.classList.remove('scrolled');
        }
    };

    setTimeout(() => {
        const bar = document.getElementById('sticky-header-bg');
        if (bar && wrapper.scrollTop > 2) {
            bar.classList.add('scrolled');
        }
    }, 50);

    const uniqueSubjects = [...new Set(safeSubjects.map(s => s.name.split('-')[0].split('(')[0].trim().toLowerCase()))];
    const selectEl = document.getElementById('subject-color-select');
    if(selectEl) {
        selectEl.innerHTML = '<option value="" style="color:#000;">-- Chọn môn học --</option>';
        uniqueSubjects.forEach(sub => {
            const displayName = sub.charAt(0).toUpperCase() + sub.slice(1);
            selectEl.innerHTML += `<option value="${sub}" style="color:#000;">${displayName}</option>`;
        });
    }
}

// =========================================
// 3. POPUP, ĐỒNG BỘ DỮ LIỆU & LOGIC THÙNG RÁC
// =========================================
async function openModal(subject) {
    currentSubjectId = subject.id; 
    document.getElementById('modal-subject-name').innerText = subject.name;

    let dateRangeText = 'Chưa xác định';
    if (subject.weeks && typeof semesterStartDate !== 'undefined') {
        let startWeekIndex = -1; let endWeekIndex = -1;
        for (let i = 0; i < subject.weeks.length; i++) {
            if (subject.weeks[i] !== '-' && subject.weeks[i] !== ' ') {
                if (startWeekIndex === -1) startWeekIndex = i; 
                endWeekIndex = i; 
            }
        }
        if (startWeekIndex !== -1 && endWeekIndex !== -1) {
            const subjectStartDate = new Date(semesterStartDate);
            subjectStartDate.setDate(semesterStartDate.getDate() + (startWeekIndex * 7) + (subject.day - 2));
            const subjectEndDate = new Date(semesterStartDate);
            subjectEndDate.setDate(semesterStartDate.getDate() + (endWeekIndex * 7) + (subject.day - 2));
            const formatD = (d) => `${d.getDate().toString().padStart(2, '0')}/${(d.getMonth()+1).toString().padStart(2, '0')}/${d.getFullYear()}`;
            dateRangeText = `${formatD(subjectStartDate)} đến ${formatD(subjectEndDate)}`;
        }
    }

    document.getElementById('modal-subject-meta').innerHTML = `
        <div class="meta-badge"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"></path><line x1="7" y1="7" x2="7.01" y2="7"></line></svg> <strong>Mã HP:</strong> ${subject.course_code || 'N/A'}</div>
        <div class="meta-badge"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg> <strong>Nhóm:</strong> ${subject.group_id || 'N/A'}</div>
        <div class="meta-badge"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg> <strong>GV:</strong> ${subject.lecturer || 'N/A'}</div>
        <div class="meta-badge"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg> <strong>Giờ học:</strong> ${subject.exact_time || 'N/A'}</div>
        <div class="meta-badge" style="width: 100%;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg> <strong>Thời hạn:</strong> ${dateRangeText}</div>
        <div class="meta-badge" style="width: 100%;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg> <strong>Phòng:</strong> ${subject.room || 'N/A'}</div>
    `;

    document.getElementById('notes-list').innerHTML = '<li style="opacity: 0.4; justify-content: center; font-style: italic;">Đang đồng bộ...</li>';
    document.getElementById('notes-trash').innerHTML = ''; document.getElementById('tasks-upcoming').innerHTML = ''; document.getElementById('tasks-done').innerHTML = ''; document.getElementById('tasks-trash').innerHTML = '';
    
    document.getElementById('subject-modal').classList.remove('hidden');

    const baseName = subject.name.split('-')[0].split('(')[0].trim().toLowerCase();
    const relatedSubjectIds = allLoadedSubjects.filter(s => s.name.split('-')[0].split('(')[0].trim().toLowerCase() === baseName).map(s => s.id);
    await loadSubjectDetails(relatedSubjectIds);
}

const closeModal = () => { document.getElementById('subject-modal').classList.add('hidden'); currentSubjectId = null; };
document.getElementById('close-modal-btn').addEventListener('click', closeModal);
document.getElementById('subject-modal').addEventListener('click', function(e) { if (e.target === this) closeModal(); });

async function loadSubjectDetails(relatedSubjectIds) {
    const { data, error } = await supabase.from('subject_details').select('*').in('subject_id', relatedSubjectIds).eq('user_id', currentUser.id);
    if (error) return console.error(error);

    const lists = { notes: document.getElementById('notes-list'), notesTrash: document.getElementById('notes-trash'), tasksUp: document.getElementById('tasks-upcoming'), tasksDone: document.getElementById('tasks-done'), tasksTrash: document.getElementById('tasks-trash') };
    Object.values(lists).forEach(el => el.innerHTML = '');
    
    let counts = { notesActive: 0, notesTrash: 0, tasksTrash: 0 }; 

    data.forEach(item => {
        const li = document.createElement('li');
        const originSub = allLoadedSubjects.find(s => s.id === item.subject_id);
        let originHtml = originSub ? `<span class="origin-tag"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg> Ghi tại: Thứ ${originSub.day}, ${originSub.time_slot}</span>` : '';

        const isDeleted = item.status === 'deleted';
        const actionBtn = isDeleted 
            ? `<button class="action-btn restore" onclick="restoreDetail('${item.id}')" title="Khôi phục"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12a9 9 0 109-9 9.75 9.75 0 00-6.74 2.74L3 8"></path><path d="M3 3v5h5"></path></svg></button>
               <button class="action-btn delete" onclick="hardDeleteDetail('${item.id}')" title="Xóa vĩnh viễn"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg></button>`
            : `<button class="action-btn delete" onclick="deleteDetail('${item.id}')" title="Chuyển vào thùng rác"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"></path></svg></button>`;
        const innerContent = `
            <div class="item-content"><span class="text">${item.content}</span>${originHtml}</div>
            <div class="item-actions">${actionBtn}</div>
        `;

        if (item.type === 'note' || item.type === 'notification') {
            li.innerHTML = innerContent;
            if (isDeleted) { 
                lists.notesTrash.appendChild(li); counts.notesTrash++; 
            } else { 
                lists.notes.appendChild(li); counts.notesActive++; 
            }
        } else if (item.type === 'task') {
            if (isDeleted) {
                li.innerHTML = innerContent; lists.tasksTrash.appendChild(li); counts.tasksTrash++;
            } else if (item.status === 'upcoming') {
                li.innerHTML = `
                    <div class="item-content"><span class="text">${item.content}</span>${originHtml}</div>
                    <div class="item-actions" style="opacity: 1;">
                        ${actionBtn}
                        <input type="checkbox" class="mac-checkbox" onchange="markTaskDone('${item.id}')">
                    </div>`;
                lists.tasksUp.appendChild(li);
            } else {
                li.innerHTML = `
                    <div class="item-content"><span class="text" style="text-decoration: line-through; opacity: 0.5;">${item.content}</span>${originHtml}</div>
                    <div class="item-actions" style="opacity: 1;">
                        ${actionBtn}
                        <input type="checkbox" class="mac-checkbox" checked onchange="unmarkTask('${item.id}')">
                    </div>`;
                lists.tasksDone.appendChild(li);
            }
        }
    });

    document.getElementById('notes-trash-count').innerText = `(${counts.notesTrash})`;
    document.getElementById('tasks-trash-count').innerText = `(${counts.tasksTrash})`;

    const noteTrashToggle = document.getElementById('notes-trash-toggle');
    const noteTrashWrapper = document.getElementById('notes-trash-wrapper');
    const noteTrashList = document.getElementById('notes-trash'); 
    const noteTrashActions = document.getElementById('notes-trash-actions');

    if (noteTrashToggle && noteTrashWrapper) {
        if (noteTrashList) noteTrashList.classList.remove('hidden-trash'); 
        if (counts.notesTrash === 0) {
            noteTrashToggle.style.opacity = '0.3';
            noteTrashToggle.style.pointerEvents = 'none'; 
            noteTrashWrapper.classList.add('hidden-trash'); 
            if (noteTrashActions) noteTrashActions.classList.add('hidden-trash');
        } else {
            noteTrashToggle.style.opacity = '1';
            noteTrashToggle.style.pointerEvents = 'auto'; 
        }
    }

    const taskTrashToggle = document.getElementById('tasks-trash-toggle');
    const taskTrashWrapper = document.getElementById('tasks-trash-wrapper');
    const taskTrashList = document.getElementById('tasks-trash');
    const taskTrashActions = document.getElementById('tasks-trash-actions'); 

    if (taskTrashToggle && taskTrashWrapper) {
        if (taskTrashList) taskTrashList.classList.remove('hidden-trash');
        if (counts.tasksTrash === 0) {
            taskTrashToggle.style.opacity = '0.3';
            taskTrashToggle.style.pointerEvents = 'none';
            taskTrashWrapper.classList.add('hidden-trash');
            if (taskTrashActions) taskTrashActions.classList.add('hidden-trash'); 
        } else {
            taskTrashToggle.style.opacity = '1';
            taskTrashToggle.style.pointerEvents = 'auto';
        }
    }

    const notesClearAllBtn = document.getElementById('notes-clear-all-btn');
    if (notesClearAllBtn) {
        if (counts.notesActive === 0) {
            notesClearAllBtn.classList.add('hidden-trash');
        } else {
            notesClearAllBtn.classList.remove('hidden-trash');
        }
    }
}

window.handleEnter = function(e, type) {
    if (e.key === 'Enter') {
        e.preventDefault(); 
        addDetail(type);
    }
}

window.emptyTrashBin = async function(btnElement, type) {
    if (btnElement.classList.contains('delete')) return; 
    
    const isConfirmed = await showConfirm(`Bạn có chắc chắn muốn dọn sạch thùng rác ${type === 'note' ? 'ghi chú' : 'công việc'}? Hành động này không thể hoàn tác!`, 'Xác nhận dọn rác');
    if (!isConfirmed) return;

    btnElement.classList.add('delete');
    
    setTimeout(async () => {
        const { error } = await supabase
            .from('subject_details')
            .delete()
            .eq('subject_id', currentSubjectId)
            .eq('user_id', currentUser.id)
            .eq('type', type)
            .eq('status', 'deleted');
        
        if (error) {
            showAlert("Lỗi khi dọn thùng rác: " + error.message, "Lỗi kết nối");
            btnElement.classList.remove('delete');
        } else {
            reloadCurrentModal();
        }
    }, 2800);
}

window.toggleTrash = function(wrapperId, btnId) { 
    document.getElementById(wrapperId).classList.toggle('hidden-trash'); 
    if (btnId) document.getElementById(btnId).classList.toggle('hidden-trash');
}

window.clearAllActiveItems = async function(btnElement, type) {
    if (btnElement.classList.contains('animating')) return; 

    const typeName = type === 'note' ? 'ghi chú' : 'công việc';
    const isConfirmed = await showConfirm(`Bạn có muốn chuyển TẤT CẢ ${typeName} đang hiển thị vào thùng rác không?`, 'Xác nhận xóa');
    if (!isConfirmed) return;

    btnElement.classList.add('animating');

    setTimeout(async () => {
        const { error } = await supabase
            .from('subject_details')
            .update({ status: 'deleted' }) 
            .eq('subject_id', currentSubjectId)
            .eq('user_id', currentUser.id)
            .eq('type', type)
            .eq('status', 'upcoming');
        
        if (error) showAlert("Lỗi khi dọn dẹp: " + error.message, "Lỗi kết nối");
        btnElement.classList.remove('animating'); 
        reloadCurrentModal(); 
    }, 1200);
}

window.restoreAllTrashItems = async function(btnElement, type) {
    if (btnElement.classList.contains('animating')) return;

    const typeName = type === 'note' ? 'ghi chú' : 'công việc';
    const isConfirmed = await showConfirm(`Bạn có muốn khôi phục TẤT CẢ ${typeName} từ thùng rác không?`, 'Khôi phục hàng loạt');
    if (!isConfirmed) return;

    btnElement.classList.add('animating');

    setTimeout(async () => {
        const { error } = await supabase
            .from('subject_details')
            .update({ status: 'upcoming' }) 
            .eq('subject_id', currentSubjectId)
            .eq('user_id', currentUser.id)
            .eq('type', type)
            .eq('status', 'deleted'); 
        
        if (error) showAlert("Lỗi khi khôi phục: " + error.message, "Lỗi kết nối");
        btnElement.classList.remove('animating'); 
        reloadCurrentModal(); 
    }, 600);
}

window.addDetail = async function(type) {
    const inputId = type === 'note' ? 'new-note' : 'new-task';
    const content = document.getElementById(inputId).value.trim();
    if (!content || !currentSubjectId) return;
    const { error } = await supabase.from('subject_details').insert([{ subject_id: currentSubjectId, user_id: currentUser.id, type: type, content: content, status: 'upcoming' }]);
    if (!error) { document.getElementById(inputId).value = ''; reloadCurrentModal(); }
}

window.deleteDetail = async function(id) {
    const { error } = await supabase.from('subject_details').update({ status: 'deleted' }).eq('id', id);
    if (error) { showAlert("Lỗi khi xóa: " + error.message, "Lỗi kết nối"); console.error(error); } 
    else reloadCurrentModal();
}

window.hardDeleteDetail = async function(id) {
    const isConfirmed = await showConfirm('Bạn có chắc chắn muốn xóa vĩnh viễn mục này không? Dữ liệu sẽ mất hoàn toàn và không thể khôi phục.', 'Cảnh báo xóa vĩnh viễn');
    if (!isConfirmed) return;
    
    const { error } = await supabase.from('subject_details').delete().eq('id', id);
    
    if (error) { 
        showAlert("Lỗi khi xóa vĩnh viễn: " + error.message, "Lỗi kết nối"); 
        console.error(error); 
    } else {
        reloadCurrentModal();
    }
}

window.restoreDetail = async function(id) {
    const { error } = await supabase.from('subject_details').update({ status: 'upcoming' }).eq('id', id);
    if (error) { showAlert("Lỗi khôi phục: " + error.message, "Lỗi kết nối"); console.error(error); } 
    else reloadCurrentModal();
}

window.markTaskDone = async function(id) {
    const { error } = await supabase.from('subject_details').update({ status: 'done' }).eq('id', id);
    if (error) { showAlert("Lỗi cập nhật task: " + error.message, "Lỗi kết nối"); console.error(error); } 
    else reloadCurrentModal();
}

window.unmarkTask = async function(id) {
    const { error } = await supabase.from('subject_details').update({ status: 'upcoming' }).eq('id', id);
    if (error) { showAlert("Lỗi cập nhật task: " + error.message, "Lỗi kết nối"); console.error(error); } 
    else reloadCurrentModal();
}

async function reloadCurrentModal() { 
    const subject = allLoadedSubjects.find(s => s.id === currentSubjectId);
    if (!subject) return;

    const baseName = subject.name.split('-')[0].split('(')[0].trim().toLowerCase();
    const relatedSubjectIds = allLoadedSubjects.filter(s => s.name.split('-')[0].split('(')[0].trim().toLowerCase() === baseName).map(s => s.id);
    
    await loadSubjectDetails(relatedSubjectIds); 
}

// =========================================
// 4. SIÊU CÁ NHÂN HÓA (THEME, BACKGROUND, MÀU MÔN HỌC)
// =========================================
window.applyCustomBG = function() {
    const url = document.getElementById('custom-bg-url').value.trim();
    if (url) {
        document.body.style.backgroundImage = `url('${url}')`;
        document.body.style.backgroundSize = 'cover';
        document.body.style.backgroundPosition = 'center';
        localStorage.setItem('customBg', url);
    }
}

function renderNeonColorButtons() {
    const container = document.getElementById('neon-color-presets');
    if(!container) return;

    const presets = [
        { name: 'HỒNG', color: '#FF3366', soft: 'rgba(255,51,102,0.45)' },
        { name: 'XANH', color: '#00C9FF', soft: 'rgba(0,201,255,0.45)' },
        { name: 'TÍM', color: '#7c3aed', soft: 'rgba(124,58,237,0.45)' },
        { name: 'CAM', color: '#FF9933', soft: 'rgba(255,153,51,0.45)' },
        { name: 'LỤC', color: '#38ef7d', soft: 'rgba(56,239,125,0.45)' }
    ];

    let html = '';
    presets.forEach(p => {
        html += `<button class="neon-color-btn" onclick="applyPresetColor('${p.color}', this)" title="${p.name}" style="background: ${p.color}; --btn-color: ${p.color}; --btn-soft: ${p.soft};"></button>`;
    });
    container.innerHTML = html;
}

window.applyPresetColor = function(color, btnElement) {
    const subject = document.getElementById('subject-color-select').value;
    if(!subject) { showAlert("Vui lòng chọn một môn học từ danh sách ở trên trước khi chọn màu!", "Chưa chọn môn"); return; }

    document.querySelectorAll('.neon-color-btn').forEach(b => b.classList.remove('active'));
    if(btnElement) btnElement.classList.add('active');

    let savedColors = {};
    try { savedColors = JSON.parse(localStorage.getItem('subjectCustomColors')) || {}; } catch(e){}
    
    savedColors[subject] = color;
    localStorage.setItem('subjectCustomColors', JSON.stringify(savedColors));
    
    document.getElementById('custom-subject-color').value = color;
    loadTimetable(); 
}

window.applySubjectColor = function() {
    const subject = document.getElementById('subject-color-select').value;
    const color = document.getElementById('custom-subject-color').value;
    
    if(!subject) { showAlert("Vui lòng chọn một môn học từ danh sách để đổi màu!", "Chưa chọn môn"); return; }

    document.querySelectorAll('.neon-color-btn').forEach(b => b.classList.remove('active'));

    let savedColors = {};
    try { savedColors = JSON.parse(localStorage.getItem('subjectCustomColors')) || {}; } catch(e){}
    
    savedColors[subject] = color;
    localStorage.setItem('subjectCustomColors', JSON.stringify(savedColors));
    localStorage.removeItem('customAccent'); 
    
    loadTimetable(); 
}

window.resetSubjectColors = function() {
    localStorage.removeItem('subjectCustomColors');
    loadTimetable(); 
}

window.resetPersonalization = function() {
    localStorage.removeItem('customBg');
    localStorage.removeItem('customAccent');
    localStorage.removeItem('subjectCustomColors');
    location.reload(); 
}

// =========================================
// 8. LOGIC CHỌN TUẦN CAO CẤP (CUSTOM DROPDOWN)
// =========================================
window.toggleWeekDropdown = function(e) {
    if(e) e.stopPropagation();
    const container = document.getElementById('week-dropdown-container');
    const dropdown = document.getElementById('week-options-list');
    
    dropdown.classList.toggle('hidden-dropdown');
    container.classList.toggle('open'); 
    
    if(!dropdown.classList.contains('hidden-dropdown')) {
        const activeLi = dropdown.querySelector('li.selected');
        if (activeLi) {
            dropdown.scrollTop = activeLi.offsetTop - dropdown.clientHeight / 2 + activeLi.clientHeight / 2;
        }
    }
}

window.selectCustomWeek = function(val) {
    const selector = document.getElementById('week-selector');
    selector.value = val;

    const selectedOption = Array.from(selector.options).find(opt => parseInt(opt.value) === parseInt(val));
    if(selectedOption) {
        document.getElementById('current-week-text').innerText = selectedOption.text;
    }

    const listItems = document.querySelectorAll('#week-options-list li');
    listItems.forEach(li => li.classList.remove('selected'));
    
    const activeLi = Array.from(listItems).find(li => parseInt(li.dataset.val) === parseInt(val));
    if(activeLi) activeLi.classList.add('selected');

    document.getElementById('week-options-list').classList.add('hidden-dropdown');
    document.getElementById('week-dropdown-container').classList.remove('open');
    
    loadTimetable(); 
}

window.changeWeek = function(step) {
    const selector = document.getElementById('week-selector');
    if (!selector) return;
    
    let currentWeek = parseInt(selector.value);
    let newWeek = currentWeek + step;
    const maxW = window.maxSemesterWeek || 20; 
    
    if (newWeek >= 1 && newWeek <= maxW) {
        selectCustomWeek(newWeek);
    }
}

document.addEventListener('click', function(e) {
    const container = document.getElementById('week-dropdown-container');
    const dropdown = document.getElementById('week-options-list');
    if (container && dropdown && !container.contains(e.target)) {
        dropdown.classList.add('hidden-dropdown');
        container.classList.remove('open');
    }
});

// =========================================
// 9. QUẢN LÝ LỊCH THI
// =========================================
document.getElementById('excel-exam-file').addEventListener('change', async function(e) {
    if (!currentUser) {
        showAlert("Vui lòng đăng nhập trước khi tải lên Lịch thi!", "Yêu cầu đăng nhập");
        e.target.value = '';
        return;
    }
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async function(event) {
        try {
            const data = new Uint8Array(event.target.result);
            const workbook = XLSX.read(data, { type: 'array' });
            const jsonArray = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { raw: false, defval: "" });

            const formattedData = [];
            
            for (let i = 0; i < jsonArray.length; i++) {
                const row = jsonArray[i];
                let courseCode = String(row['Mã MH'] || '').trim();
                if (courseCode.endsWith('.0')) courseCode = courseCode.slice(0, -2);
                
                const subjectName = String(row['Tên môn học'] || '').trim();
                let examDate = String(row['Ngày thi'] || '').trim();
                let examTime = String(row['Giờ bắt đầu'] || '').trim();
                const room = String(row['Phòng thi'] || '').trim();
                
                if (!subjectName || subjectName.toLowerCase().includes('kỳ thi')) continue; 
                
                if (examDate.includes('00:00:30') || examDate.includes('-')) {
                    examDate = examDate.split(' ')[0]; 
                    const parts = examDate.split('-');
                    if (parts.length === 3) examDate = `${parts[2]}/${parts[1]}/${parts[0]}`; 
                }

                formattedData.push({
                    user_id: currentUser.id, 
                    subject_name: subjectName, 
                    course_code: courseCode,
                    exam_date: examDate,
                    exam_time: examTime,
                    room: room
                });
            }

            if (formattedData.length === 0) {
                showAlert("Không tìm thấy dữ liệu Lịch Thi hợp lệ.", "Lỗi dữ liệu");
                e.target.value = '';
                return;
            }

            const { error: deleteErr } = await supabase.from('exams').delete().eq('user_id', currentUser.id); 
            if (deleteErr) throw new Error("Lỗi xóa dữ liệu cũ: " + deleteErr.message);

            const { error: insertErr } = await supabase.from('exams').insert(formattedData);
            if (insertErr) throw new Error("Supabase từ chối lưu dữ liệu: " + insertErr.message);
            
            showAlert("Đã đồng bộ Lịch Thi thành công!", "Hoàn tất"); 
            loadExams();
            e.target.value = ''; 
            
        } catch (err) { 
            showAlert(`Lỗi xử lý file:\n${err.message}`, "Lỗi hệ thống"); 
            console.error(err);
        }
    };
    reader.readAsArrayBuffer(file);
});

window.loadExams = async function() {
    if (!currentUser) return;
    const { data: exams, error } = await supabase.from('exams').select('*').eq('user_id', currentUser.id);
    if (error) return console.error('Lỗi tải Lịch Thi:', error);
    
    const wrapper = document.getElementById('exams-wrapper'); 
    if (!wrapper) return;
    wrapper.innerHTML = ''; 

    if (!exams || exams.length === 0) {
        wrapper.innerHTML = `
            <div style="height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; opacity: 0.6; min-height: 400px;">
                <div style="width: 100px; height: 100px; border-radius: 50%; background: rgba(150,150,150,0.05); display: flex; align-items: center; justify-content: center; margin-bottom: 20px; box-shadow: inset 0 0 20px rgba(150,150,150,0.05);">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line><path d="M9 16l2 2 4-4"></path></svg>
                </div>
                <h5 style="font-size: 1.2rem; font-weight: 500; margin-bottom: 8px; color: var(--text-main);">Chưa có lịch thi nào</h5>
                <p style="font-size: 0.95rem; color: var(--text-muted);">Nhấn nút <strong style="color:var(--text-main);">"Nhập Lịch Thi" ở góc trên bên phải</strong> để đồng bộ dữ liệu.</p>
            </div>
        `;
        return;
    }

    exams.sort((a, b) => {
        const parseD = (str) => {
            if(!str) return 0;
            const p = str.split(/[-/]/);
            if(p.length !== 3) return 0;
            let d=p[0], m=p[1], y=p[2];
            if(y.length === 4) return new Date(y, m-1, d).getTime();
            if(d.length === 4) return new Date(d, m-1, y).getTime();
            return 0;
        };
        return parseD(a.exam_date) - parseD(b.exam_date);
    });

    let html = '<div class="exam-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 24px; padding: 10px 4px 40px 4px;">';    
    const today = new Date();
    today.setHours(0,0,0,0);
    
    const gradientColors = [ ['#FF3366', '#FF9933'], ['#00C9FF', '#92FE9D'], ['#7c3aed', '#E100FF'], ['#11998e', '#38ef7d'], ['#FDBB2D', '#22C1C3'] ];
    
    const subjectColorMap = {}; 
    let colorIndex = 0;
    allLoadedSubjects.forEach(sub => {
        const baseName = sub.name.split('-')[0].split('(')[0].trim().toLowerCase();
        if (!subjectColorMap[baseName]) { 
            subjectColorMap[baseName] = gradientColors[colorIndex % gradientColors.length][0]; 
            colorIndex++; 
        }
    });

    let savedSubjectColors = {};
    try { savedSubjectColors = JSON.parse(localStorage.getItem('subjectCustomColors')) || {}; } catch(e){}

    exams.forEach(exam => {
        let examDateObj = null;
        let dateParts = (exam.exam_date || '').split(/[-/]/);
        if (dateParts.length === 3) {
            let d = parseInt(dateParts[0]), m = parseInt(dateParts[1]), y = parseInt(dateParts[2]);
            if (y < 100) y += 2000;
            if (d > 1000) { y = d; d = parseInt(dateParts[2]); }
            examDateObj = new Date(y, m - 1, d);
        }

        let countdownHtml = '';
        if (examDateObj) {
            const diffTime = examDateObj - today;
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            
            if (diffDays === 0) {
                countdownHtml = `<div class="exam-countdown today">Thi vào hôm nay!</div>`;
            } else if (diffDays > 0) {
                countdownHtml = `<div class="exam-countdown upcoming">Còn ${diffDays} ngày</div>`;
            } else {
                countdownHtml = `<div class="exam-countdown past">Đã kết thúc</div>`;
            }
        }
        
        const baseName = exam.subject_name.split('-')[0].split('(')[0].trim().toLowerCase();
        let c1 = '#FF3366'; 
        
        if (savedSubjectColors[baseName]) {
            c1 = savedSubjectColors[baseName]; 
        } else if (window.globalSubjectColors && window.globalSubjectColors[baseName]) {
            c1 = window.globalSubjectColors[baseName];
        } else if (subjectColorMap[baseName]) {
            c1 = subjectColorMap[baseName]; 
        }

        html += `
            <div class="exam-card" style="--c1: ${c1};">
                ${countdownHtml}
                <div class="exam-course-code">Mã MH: ${exam.course_code}</div>
                <h4>${exam.subject_name}</h4>
                
                <div class="exam-info-container">
                    <div class="exam-info-row">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
                        <span><strong>Ngày thi:</strong> ${exam.exam_date}</span>
                    </div>
                    <div class="exam-info-row">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                        <span><strong>Giờ bắt đầu:</strong> <span class="highlight-time">${exam.exam_time}</span></span>
                    </div>
                    <div class="exam-info-row">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>
                        <span><strong>Phòng thi:</strong> <span class="highlight-room">${exam.room}</span></span>
                    </div>
                </div>
            </div>
        `;
    });
    html += '</div>';
    wrapper.innerHTML = html;
}