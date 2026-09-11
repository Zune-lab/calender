// ===== calendar-6-export-capture.js =====
// Phần 6/6 của calendar.js (tách file riêng vì các file 1-5 đã gần/chạm mốc < 1000 dòng quy
// ước của dự án). Nội dung: tính năng "Chụp TKB" - bấm 1 nút là tự động THU NHỎ toàn bộ bảng
// thời khóa biểu (kể cả trên mobile, nơi các cột phải cuộn ngang mới xem hết) để lộ ra TRỌN VẸN
// mọi cột/tiết trong đúng 1 khung hình, rồi chụp lại khung đó thành file ảnh PNG tải về.
//
// FIX BUG "KHÔNG THẤY HẾT 10 TIẾT + RẤT XẤU" (bản đầu tiên): bản đó chỉnh trực tiếp
// #timetable-wrapper NGAY TRÊN TRANG THẬT (gỡ overflow, tăng height...) rồi chụp tại chỗ. Nhưng
// #timetable-wrapper nằm lồng trong 2 lớp cha đều tự giới hạn cứng chiều cao + overflow:hidden:
//   - .tab-pane.active { height: 100%; overflow: hidden; }
//   - .main-glass-dashboard { height: calc(100vh - 80px); overflow: hidden; }
// (xem calendar-1-base.css mục "0. TAB-PANE" và calendar-3-desktop-settings-dialog.css mục 16)
// -> dù wrapper có tự giãn cao/rộng ra bao nhiêu, 2 khối cha này vẫn CẮT PHẦN DƯ THỪA ở trên lẫn
// dưới như cũ, nên ảnh chụp vẫn thiếu Tiết 1 và Tiết 10 (đúng ảnh lỗi thực tế). Đồng thời việc
// tắt hẳn backdrop-filter (kính mờ) rồi thay bằng 1 màu nền ĐẶC PHẲNG khiến các thẻ môn học (vốn
// chỉ có nền gradient trắng mờ 5-25%, chiều sâu thật nằm ở lớp blur xuyên ảnh nền phía sau) mất
// hết chiều sâu, nhìn bẹt/xám xịt - đúng ý "rất xấu".
//
// Cách xử lý MỚI - KHÔNG động gì vào trang thật, chụp trên 1 BẢN SAO tách rời hoàn toàn khỏi 2
// lớp cha bị giới hạn ở trên:
//   1. cloneNode(true) #timetable-wrapper, nhét bản sao vào 1 div "position: fixed" nhưng đẩy ra
//      khỏi màn hình (left: -99999px) và gắn THẲNG vào <body> - tức ở NGOÀI mọi khung cha có
//      overflow:hidden/height cố định của trang thật, nên không còn gì bị cắt nữa dù bảng cao/
//      rộng bao nhiêu.
//   2. Trên bản sao: gỡ hẳn overflow/height, đo kích thước THẬT (chưa cắt) của bảng, rồi tính hệ
//      số scale = bề ngang khung đang hiển thị / bề ngang thật của bảng (luôn <= 1) và áp
//      transform: scale() - đúng kiểu "Fit to width" khi in trang web - để mọi cột/tiết đều lọt
//      gọn vào 1 khung hình, chiều cao để tự nhiên theo đúng scale đó (không giới hạn theo màn
//      hình như lúc xem trực tiếp).
//   3. Bỏ hẳn .sticky-glass-bar (thanh trang trí position:sticky đồng bộ theo cuộn trang thật -
//      tách khỏi trang thì không còn gì để "sticky" theo, dễ lệch vị trí) khỏi bản sao - không
//      ảnh hưởng gì tới nội dung TKB thật.
//   4. html2canvas(-pro) không vẽ được backdrop-filter -> theo yêu cầu, BỎ HẲN hiệu ứng kính mờ
//      khi chụp thay vì cố mô phỏng lại: đổi nền bản sao qua gradient tối/sáng đặc, và đổi hẳn
//      từng thẻ môn học (.subject-card-td) từ nền trắng mờ 5-25% + backdrop-filter sang MÀU ĐẶC
//      (solid) dùng đúng 2 màu riêng của môn đó (--c1/--c2, vốn trước chỉ dùng cho thanh màu bên
//      trái) - vừa đẹp/rõ ràng hơn hẳn bản "bẹt xám" trước, vừa né hẳn mọi rủi ro render sai liên
//      quan tới backdrop-filter/độ trong suốt (gốc rễ vài bug từng gặp). Quét thêm 1 lượt toàn bộ
//      phần tử còn lại trong bản sao để tắt nốt backdrop-filter ở bất kỳ chỗ nào khác lỡ còn sót.
//   5. Chụp bản sao (không phải trang thật) bằng html2canvas, xuất PNG. THEO YÊU CẦU: không tự
//      tải file ngay - mở modal #capture-preview-overlay cho xem ảnh trước, bấm "Tải ảnh về"
//      (_confirmCaptureDownload) mới thật sự tạo file tải xuống, bấm "Huỷ" (_cancelCapturePreview,
//      cũng kích hoạt khi bấm ra ngoài vùng ảnh) thì huỷ luôn, không lưu gì cả. Xong bước chụp thì
//      xoá hẳn bản sao khỏi DOM ngay - trang thật không hề bị đụng vào nên không có màn hình
//      "giật/xấu" nào lộ ra trước mắt người dùng trong lúc chụp.

let _isCapturingTimetable = false; // guard chống bấm dồn dập / double-click trong lúc đang chụp

function _waitTwoFrames() {
    return new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
    });
}

window.captureFullTimetable = async function () {
    if (_isCapturingTimetable) return;

    const wrapper = document.getElementById('timetable-wrapper');
    const btn = document.getElementById('capture-timetable-btn');
    const btnText = document.getElementById('capture-timetable-text');

    if (!wrapper) return;

    if (typeof html2canvas === 'undefined') {
        showAlert('Không tải được thư viện chụp ảnh (html2canvas) - có thể do mạng yếu hoặc bị chặn CDN. Vui lòng thử lại.', 'Lỗi chụp ảnh');
        return;
    }

    if (!wrapper.querySelector('table')) {
        showAlert('Chưa có dữ liệu thời khóa biểu để chụp.', 'Không có gì để chụp');
        return;
    }

    _isCapturingTimetable = true;
    if (btn) btn.classList.add('is-capturing');
    if (btnText) btnText.textContent = 'Đang chụp...';

    // Bề ngang khung đang hiển thị THẬT trên màn hình người dùng - dùng làm mốc "vừa khung" để
    // tính scale, vì bản sao khi tách ra ngoài màn hình sẽ không còn khung nào giới hạn nữa.
    const targetWidth = wrapper.clientWidth;
    const isLight = document.body.classList.contains('light-mode');

    // Vùng chứa tạm ngoài màn hình - gắn trực tiếp vào <body>, KHÔNG nằm trong
    // .tab-pane.active/.main-glass-dashboard (2 khối overflow:hidden + height cố định gây lỗi
    // cắt hình ở bản trước), nên không bị bất kỳ khung cha nào của trang thật giới hạn kích thước.
    const stage = document.createElement('div');
    stage.style.cssText = 'position:fixed; left:-99999px; top:0; z-index:-1; pointer-events:none;';

    const clone = wrapper.cloneNode(true);
    // Gỡ id trên bản sao (và mọi phần tử con có id bên trong) để tránh trùng id với trang thật
    // trong lúc bản sao còn tồn tại trong DOM (getElementById luôn ưu tiên phần tử THẬT xuất hiện
    // trước trong tài liệu nên không lỗi chức năng gì, nhưng tránh trùng id vẫn sạch hơn).
    clone.removeAttribute('id');
    clone.querySelectorAll('[id]').forEach((el) => el.removeAttribute('id'));
    // .sticky-glass-bar chỉ là thanh nền trang trí (position:sticky, đồng bộ theo cuộn thật của
    // trang) - tách khỏi trang thật thì không còn gì để "sticky" theo nữa, dễ hiện sai vị trí
    // trong ảnh chụp. Bỏ hẳn khỏi bản sao, không ảnh hưởng gì đến nội dung TKB thật sự.
    clone.querySelector('.sticky-glass-bar')?.remove();

    // Gỡ hẳn giới hạn cuộn/kích thước kế thừa từ .timetable-wrapper để bảng được phép giãn ra
    // đúng kích thước thật của nó, không còn gì để cắt bớt nữa.
    clone.style.overflow = 'visible';
    clone.style.maxHeight = 'none';
    clone.style.height = 'auto';
    clone.style.width = `${targetWidth}px`;
    // html2canvas không vẽ được backdrop-filter -> đổi qua nền gradient tối/sáng đặc, gần tông
    // với các khối kính khác trong app (đỡ bẹt hơn hẳn so với 1 màu phẳng đơn sắc).
    clone.style.backdropFilter = 'none';
    clone.style.webkitBackdropFilter = 'none';
    clone.style.background = isLight
        ? 'linear-gradient(160deg, #f4f7fb 0%, #e3e9f2 100%)'
        : 'linear-gradient(160deg, #1b2334 0%, #0a0d16 100%)';

    // THEO YÊU CẦU: bỏ hẳn hiệu ứng "kính mờ" (glass) khi chụp, chuyển thẻ môn học sang MÀU ĐẶC
    // (solid) - dùng luôn 2 màu riêng của từng môn (--c1/--c2, vốn chỉ dùng cho thanh màu bên
    // trái) làm nền gradient đặc cho cả thẻ, thay vì lớp trắng mờ 5-25% + backdrop-filter cũ.
    // Không chỉ đẹp hơn hẳn (mỗi môn 1 màu rõ ràng, dễ phân biệt) mà còn né HẲN mọi rủi ro
    // render sai liên quan tới backdrop-filter/độ trong suốt của html2canvas (gốc rễ nhiều bug
    // đã gặp ở các bản trước) vì giờ không còn phần tử nào cần render trong suốt/mờ nữa.
    clone.querySelectorAll('.subject-card-td').forEach((td) => {
        td.style.background = 'linear-gradient(135deg, var(--c1, #6366f1), var(--c2, #8b5cf6))';
        td.style.border = 'none';
        td.style.boxShadow = 'none';
        td.style.backdropFilter = 'none';
        td.style.webkitBackdropFilter = 'none';
    });
    // Cái "khung giờ" nhỏ (07:00 -> 09:50) bên trong thẻ vẫn còn kiểu chip kính (nền đen mờ 25%
    // + viền sáng mờ + ánh sáng hắt inset) - cùng 1 kiểu "glass" y hệt thẻ lớn, chỉ là thu nhỏ,
    // nên khi đặt trên nền màu rực của thẻ (sau khi đổi solid ở trên) nhìn càng lộ rõ vệt xám bẩn.
    // Đổi luôn qua màu đặc (không viền, không đổ bóng) cho đồng bộ 100% với thẻ lớn.
    clone.querySelectorAll('.subject-card-td .time-text').forEach((el) => {
        el.style.background = 'rgba(0, 0, 0, 0.55)';
        el.style.border = 'none';
        el.style.boxShadow = 'none';
    });
    // Quét thêm 1 lượt TOÀN BỘ phần tử còn lại trong bản sao: phần tử nào còn dính
    // backdrop-filter (theo computed style, phòng trường hợp có chỗ mình chưa biết tới) đều bị
    // tắt hẳn - đảm bảo tuyệt đối không còn "gì kính" sót lại trong ảnh chụp.
    clone.querySelectorAll('*').forEach((el) => {
        const cs = getComputedStyle(el);
        if (cs.backdropFilter && cs.backdropFilter !== 'none') {
            el.style.backdropFilter = 'none';
            el.style.webkitBackdropFilter = 'none';
        }
    });

    stage.appendChild(clone);
    document.body.appendChild(stage);

    try {
        await _waitTwoFrames();

        // Đo kích thước THẬT (chưa scale) của bảng bên trong bản sao - lấy trực tiếp từ chính
        // thẻ <table> (đáng tin hơn scrollWidth của div bọc ngoài, vốn có thể không nhất quán
        // giữa các trình duyệt khi overflow:visible).
        const tableEl = clone.querySelector('.timetable-table');
        const tableContainerClone = tableEl ? tableEl.parentElement : clone;
        const naturalWidth = tableEl ? tableEl.scrollWidth : tableContainerClone.scrollWidth;

        // Chỉ thu nhỏ, không phóng to nếu bảng vốn đã vừa khung (scale tối đa = 1).
        const scale = naturalWidth > 0 ? Math.min(targetWidth / naturalWidth, 1) : 1;

        if (scale < 1) {
            tableContainerClone.style.transformOrigin = 'top left';
            tableContainerClone.style.transform = `scale(${scale})`;
            tableContainerClone.style.width = `${naturalWidth}px`;
            // Bù lại khoảng trống do scale để layout của clone (height: auto) tính đúng chiều
            // cao còn lại sau khi thu nhỏ, không để hụt/dư khoảng trắng phía dưới ảnh.
            const naturalHeight = tableEl ? tableEl.scrollHeight : tableContainerClone.scrollHeight;
            clone.style.height = `${Math.ceil(naturalHeight * scale) + 24}px`;
        }

        await _waitTwoFrames();

        const canvas = await html2canvas(clone, {
            backgroundColor: isLight ? '#eef2f7' : '#0b0f1a',
            scale: Math.min(window.devicePixelRatio || 1, 2), // ảnh nét, không quá nặng
            useCORS: true,
            // Tạm bật logging (thay vì false như trước) để nếu html2canvas-pro âm thầm bỏ qua
            // 1 khai báo CSS nào đó nó không hiểu được (khác hẳn kiểu ném lỗi cứng như vụ
            // color-mix() trước đây), cảnh báo đó sẽ lộ ra ở Console - cần để soi tiếp bug
            // "thẻ môn học mất hết nền/viền/bo góc" đang gặp trên dữ liệu thật.
            logging: true,
        });

        const now = new Date();
        const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
        // THEO YÊU CẦU: không tự tải file ngay nữa - lưu tạm data URL + tên file lại, mở modal
        // cho xem ảnh trước, người dùng ưng ý mới bấm "Tải ảnh về" (xem _confirmCaptureDownload),
        // không thì bấm "Huỷ" (_cancelCapturePreview) là huỷ luôn, không lưu gì cả.
        _pendingCaptureDataUrl = canvas.toDataURL('image/png');
        _pendingCaptureFilename = `TKB_${stamp}.png`;
        _openCapturePreview(_pendingCaptureDataUrl);
    } catch (err) {
        console.error('Lỗi khi chụp toàn bộ TKB:', err);
        showAlert('Đã có lỗi xảy ra khi chụp thời khóa biểu. Vui lòng thử lại.', 'Lỗi chụp ảnh');
    } finally {
        // Dọn hẳn bản sao khỏi DOM - trang thật chưa từng bị đụng vào nên không cần khôi phục gì
        // cả, khác hẳn cách làm (rủi ro) của bản trước.
        stage.remove();
        if (btn) btn.classList.remove('is-capturing');
        if (btnText) btnText.textContent = 'Chụp TKB';
        _isCapturingTimetable = false;
    }
};

// ----- Modal xem trước ảnh trước khi lưu -----
let _pendingCaptureDataUrl = null;
let _pendingCaptureFilename = null;

function _openCapturePreview(dataUrl) {
    const overlay = document.getElementById('capture-preview-overlay');
    const img = document.getElementById('capture-preview-img');
    if (!overlay || !img) return;
    img.src = dataUrl;
    overlay.classList.remove('hidden');
}

function _closeCapturePreview() {
    const overlay = document.getElementById('capture-preview-overlay');
    const img = document.getElementById('capture-preview-img');
    if (overlay) overlay.classList.add('hidden');
    // Gỡ luôn src sau khi đóng để trình duyệt giải phóng data URL (có thể khá nặng vì là ảnh
    // full độ phân giải) khỏi bộ nhớ, không giữ lại trong <img> khi modal đã ẩn.
    if (img) img.src = '';
    _pendingCaptureDataUrl = null;
    _pendingCaptureFilename = null;
}

// Huỷ xem trước - KHÔNG lưu gì cả, chỉ đóng modal và xoá ảnh tạm.
window._cancelCapturePreview = function () {
    _closeCapturePreview();
};

// Bấm "Tải ảnh về" trong modal xem trước - lúc này mới thật sự tạo file cho tải xuống.
window._confirmCaptureDownload = function () {
    if (!_pendingCaptureDataUrl || !_pendingCaptureFilename) return;
    const link = document.createElement('a');
    link.download = _pendingCaptureFilename;
    link.href = _pendingCaptureDataUrl;
    link.click();
    _closeCapturePreview();
};

document.getElementById('capture-preview-cancel')?.addEventListener('click', window._cancelCapturePreview);
document.getElementById('capture-preview-download')?.addEventListener('click', window._confirmCaptureDownload);
// Bấm ra ngoài vùng ảnh (lên nền mờ phía sau) cũng coi như Huỷ, không lưu.
document.getElementById('capture-preview-overlay')?.addEventListener('click', (e) => {
    if (e.target.id === 'capture-preview-overlay') window._cancelCapturePreview();
});