// =========================================================================
// NGUỒN DUY NHẤT xử lý ẢNH NỀN TUỲ CHỈNH cho cả 3 trang (Dashboard / TKB / Hồ Sơ).
// -------------------------------------------------------------------------
// Gán ảnh THẲNG lên `document.body.style.backgroundImage` (đúng kiểu tkb/calendar.js đang làm,
// không qua lớp phủ/blur riêng nữa). Preload bằng Image() trước khi gán để tránh "vênh" khung
// hình lúc ảnh còn đang tải qua mạng (nhất là dán link URL).
//
// CÁCH DÙNG: nạp file này SAU shared.js, TRƯỚC script riêng của từng trang. Mỗi trang chỉ cần:
//   1. Gọi syncCustomBackground() một lần lúc khởi động để load lại ảnh đã lưu (nếu có). Hàm này
//      trả về 1 Promise (cũng lưu vào window._customBgReadyPromise) để nơi nào cần đợi ảnh xong
//      mới tắt màn hình loading (vd calendar.js) có thể tự await.
//   2. Nếu trang có UI đổi ảnh nền (input file / URL), gọi attachBgFileInput(id) và
//      applyBgFromUrlInput(id) thay vì tự viết lại logic đọc file / lưu localStorage.
//   3. Nếu trang có phần trang trí RIÊNG cần ẩn/đổi khi có ảnh nền (vd: blob ambient ở
//      Dashboard, gradient accent ở Hồ Sơ), lắng nghe sự kiện 'customBackgroundChange' ở
//      window (event.detail.active: true/false) thay vì tự đọc localStorage rải rác nhiều chỗ.
//
// -> Sửa 1 CHỖ DUY NHẤT ở file này là cả 3 trang đổi theo, không còn 3 bản copy-paste khác
//    nhau nữa (đây là nguyên nhân chính khiến trước đây sửa 1 trang mà quên mất 2 trang kia).
// =========================================================================

(function () {
    const BG_KEY = 'customBg';
    let cachedIsLightBg = false; // mặc định coi ảnh là TỐI cho tới khi đo được (an toàn hơn: chữ
                                  // sáng + bg-scrim tối vốn là hành vi cũ, ít rủi ro hơn nếu đo lỗi)

    function notifyChange(active, isLightBg) {
        cachedIsLightBg = !!active && !!isLightBg;
        window.dispatchEvent(new CustomEvent('customBackgroundChange', { detail: { active: !!active, isLightBg: cachedIsLightBg } }));
    }

    // Cho các trang khác đọc lại kết quả đo mà không cần tự lắng nghe event (vd lúc render lại
    // hero sau khi đổi accent, không phải lúc đổi ảnh nền).
    window.isCustomBackgroundLight = function () { return cachedIsLightBg; };

    function applyToBody(url) {
        document.body.style.backgroundImage = `url('${url}')`;
        document.body.style.backgroundSize = 'cover';
        document.body.style.backgroundPosition = 'center';
    }

    function clearFromBody() {
        document.body.style.backgroundImage = '';
        document.body.style.backgroundSize = '';
        document.body.style.backgroundPosition = '';
    }

    // ---------------------------------------------------------
    // ĐO ĐỘ SÁNG TRUNG BÌNH CỦA ẢNH (để tự chọn chữ sáng/tối cho dễ đọc — xem detectBrightness).
    // Vẽ ảnh xuống 1 canvas rất nhỏ (24x24) rồi tính độ sáng cảm nhận (luminance) trung bình của
    // từng điểm ảnh, bỏ qua điểm trong suốt. Trả về null nếu không đo được (ảnh lỗi, hoặc ảnh dán
    // từ link URL ngoài không cho phép đọc pixel qua CORS — canvas bị "tainted").
    // ---------------------------------------------------------
    function computeBrightness(img) {
        try {
            const w = 24, h = 24;
            const canvas = document.createElement('canvas');
            canvas.width = w; canvas.height = h;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, w, h);
            const data = ctx.getImageData(0, 0, w, h).data;
            let total = 0, count = 0;
            for (let i = 0; i < data.length; i += 4) {
                if (data[i + 3] < 10) continue; // bỏ qua điểm gần như trong suốt
                total += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
                count++;
            }
            return count ? total / count : null;
        } catch (e) {
            return null; // canvas bị tainted (ảnh CORS) hoặc lỗi khác -> không xác định được
        }
    }

    // Đo độ sáng bằng 1 Image() RIÊNG có crossOrigin (không dùng chung Image dùng để preload ở
    // preloadThenApply, vì gắn crossOrigin có thể khiến ảnh KHÔNG tải được nếu server ảnh không
    // hỗ trợ CORS — trong khi dùng làm background CSS thuần thì không cần CORS gì cả). Nếu việc
    // đo thất bại vì bất kỳ lý do gì, coi như "không xác định" -> mặc định là ảnh tối (an toàn).
    function detectBrightness(url) {
        return new Promise((resolve) => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            let done = false;
            const finish = (val) => { if (!done) { done = true; resolve(val); } };
            img.onload = () => finish(computeBrightness(img));
            img.onerror = () => finish(null);
            img.src = url;
            setTimeout(() => finish(null), 1500); // đo chậm/treo thì thôi, không xác định được
        });
    }

    // Ngưỡng coi là "ảnh sáng màu" — trên thang 0-255. 165 chọn hơi nghiêng về phía "chữ sáng"
    // (tức ảnh phải khá sáng mới bị coi là nền sáng), vì chữ sáng + đổ bóng tối vốn đã đọc được
    // trên hầu hết ảnh trừ khi ảnh thực sự sáng/trắng.
    const LIGHT_THRESHOLD = 165;

    // Preload ảnh trước khi gán vào body, tránh khoảng trống/vênh lúc ảnh còn đang tải.
    function preloadThenApply(url) {
        return new Promise((resolve) => {
            const img = new Image();
            const done = () => { applyToBody(url); resolve(); };
            img.onload = done;
            img.onerror = done; // ảnh lỗi/hỏng link vẫn không chặn app mãi mãi, cứ gán luôn
            img.src = url;
            setTimeout(done, 2000); // an toàn: mạng quá chậm thì tối đa chờ 2s rồi vẫn cho qua
        });
    }

    // Gọi 1 lần lúc trang khởi động để load lại ảnh đã lưu (nếu có).
    window.syncCustomBackground = function () {
        const saved = localStorage.getItem(BG_KEY);
        if (!saved) {
            clearFromBody();
            window._customBgReadyPromise = Promise.resolve();
            notifyChange(false, false);
            return window._customBgReadyPromise;
        }
        window._customBgReadyPromise = preloadThenApply(saved)
            .then(() => detectBrightness(saved))
            .then((brightness) => notifyChange(true, brightness !== null && brightness > LIGHT_THRESHOLD));
        return window._customBgReadyPromise;
    };

    // Lưu ảnh mới (base64 upload hoặc dán link URL) rồi áp dụng ngay trên trang hiện tại.
    // Ném lỗi ra ngoài nếu bộ nhớ đầy để nơi gọi tự hiện thông báo phù hợp với ngữ cảnh trang đó.
    window.setCustomBackground = function (urlOrDataUri) {
        localStorage.setItem(BG_KEY, urlOrDataUri);
        return preloadThenApply(urlOrDataUri)
            .then(() => detectBrightness(urlOrDataUri))
            .then((brightness) => notifyChange(true, brightness !== null && brightness > LIGHT_THRESHOLD));
    };

    window.clearCustomBackground = function () {
        localStorage.removeItem(BG_KEY);
        clearFromBody();
        notifyChange(false);
    };

    // Có ảnh nền tuỳ chỉnh đang bật hay không — cho các trang tự quyết định phần trang trí
    // riêng của mình (ẩn blob, bỏ gradient accent...) mà không cần tự đọc localStorage rải rác.
    window.hasCustomBackground = function () {
        return !!localStorage.getItem(BG_KEY);
    };

    // ==========================================
    // GẮN SẴN UI ĐỔI ẢNH NỀN — dùng chung cho mọi trang có input file / URL, trang nào cần
    // chỉ gọi đúng 1-2 dòng dưới đây thay vì tự viết lại FileReader/localStorage riêng.
    // ==========================================

    // Gắn vào 1 <input type="file"> theo id: validate dung lượng (tối đa 3.5MB), đọc base64,
    // rồi lưu + áp dụng qua setCustomBackground(). Dùng window.showAlert() nếu trang có sẵn
    // (TKB), fallback về alert() thường nếu trang chưa có hàm này (Dashboard/Hồ Sơ).
    window.attachBgFileInput = function (inputId) {
        const input = document.getElementById(inputId);
        if (!input) return;

        const notify = (msg, title) => {
            if (typeof window.showAlert === 'function') window.showAlert(msg, title);
            else alert(title ? `${title}: ${msg}` : msg);
        };

        input.addEventListener('change', function (e) {
            const file = e.target.files[0];
            if (!file) return;

            if (file.size > 3.5 * 1024 * 1024) {
                notify("Kích thước ảnh quá lớn! Vui lòng chọn ảnh nhẹ hơn (dưới 3.5MB) để trình duyệt không bị giật lag nhé.", "Quá tải dung lượng");
                this.value = '';
                return;
            }

            const reader = new FileReader();
            reader.onload = function (event) {
                const base64Image = event.target.result;
                try {
                    window.setCustomBackground(base64Image);
                } catch (err) {
                    notify("Bộ nhớ tạm của trình duyệt đã đầy. Bạn hãy dùng ảnh nhẹ hơn hoặc sử dụng dán Link URL nhé!", "Lỗi bộ nhớ");
                }
            };
            reader.readAsDataURL(file);
        });
    };

    // Đọc giá trị từ 1 <input type="text"> theo id (link URL ảnh) rồi áp dụng qua setCustomBackground().
    window.applyBgFromUrlInput = function (inputId) {
        const input = document.getElementById(inputId);
        if (!input) return;
        const url = input.value.trim();
        if (url) window.setCustomBackground(url);
    };

    // Nếu người dùng đang mở song song 2 tab (vd Dashboard + Hồ Sơ) và đổi ảnh nền ở 1 tab, tab
    // còn lại tự cập nhật theo ngay, không cần tải lại trang.
    window.addEventListener('storage', function (e) {
        if (e.key === BG_KEY) window.syncCustomBackground();
    });

    // ==========================================
    // CHUYỂN TRANG CÓ LOADER — trước đây bị copy-paste giống hệt nhau ở cả index.js VÀ
    // calendar.js. Gộp về đây (file đã được nạp sẵn ở cả 3 trang) để sửa 1 chỗ là đủ.
    // ==========================================
    window.navigateWithFade = function (url) {
        const loader = document.getElementById('global-loader');
        if (loader) {
            loader.classList.remove('hidden');
            setTimeout(() => { window.location.href = url; }, 450);
        } else {
            window.location.href = url;
        }
    };
})();