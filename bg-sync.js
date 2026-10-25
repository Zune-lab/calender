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

    // Escape đúng chuẩn CSS string: " \ và ký tự xuống dòng -> \HEX + khoảng trắng kết thúc escape.
    function cssUrl(url) {
        const safe = String(url).replace(/["\\\n\r\f]/g, (c) => '\\' + c.charCodeAt(0).toString(16) + ' ');
        return `url("${safe}")`;
    }

    // Mỗi lần đổi ảnh nền tăng bộ đếm này; mọi bước bất đồng bộ (preload, đo độ sáng, timeout) của
    // yêu cầu CŨ phải tự bỏ khi thấy bộ đếm đã đổi — nếu không, ảnh cũ có thể ĐÈ LẠI lên ảnh mới
    // (hoặc hiện lại ngay sau khi người dùng bấm "Khôi phục mặc định").
    let bgRequestSeq = 0;

    function applyToBody(url) {
        document.body.style.backgroundImage = cssUrl(url);
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
            let timer = null;
            const finish = (val) => { if (!done) { done = true; clearTimeout(timer); resolve(val); } };
            img.onload = () => finish(computeBrightness(img));
            img.onerror = () => finish(null);
            img.src = url;
            timer = setTimeout(() => finish(null), 1500); // đo chậm/treo thì thôi, không xác định được
        });
    }

    // Ngưỡng coi là "ảnh sáng màu" — trên thang 0-255. 165 chọn hơi nghiêng về phía "chữ sáng"
    // (tức ảnh phải khá sáng mới bị coi là nền sáng), vì chữ sáng + đổ bóng tối vốn đã đọc được
    // trên hầu hết ảnh trừ khi ảnh thực sự sáng/trắng.
    const LIGHT_THRESHOLD = 165;

    // Preload ảnh trước khi gán vào body, tránh khoảng trống/vênh lúc ảnh còn đang tải.
    function preloadThenApply(url, seq) {
        return new Promise((resolve) => {
            const img = new Image();
            let finished = false;
            let timer = null;
            const done = () => {
                if (finished) return; // trước đây timeout 2s vẫn chạy lại lần 2 sau khi ảnh đã tải xong
                finished = true;
                clearTimeout(timer);
                if (seq === bgRequestSeq) applyToBody(url); // yêu cầu cũ (đã bị thay/xoá) thì bỏ qua
                resolve();
            };
            img.onload = done;
            img.onerror = done; // ảnh lỗi/hỏng link vẫn không chặn app mãi mãi, cứ gán luôn
            img.src = url;
            timer = setTimeout(done, 2000); // an toàn: mạng quá chậm thì tối đa chờ 2s rồi vẫn cho qua
        });
    }

    // Preload -> gán -> đo độ sáng -> báo; mọi bước tự huỷ nếu có yêu cầu mới hơn xen vào.
    function loadAndNotify(url) {
        const seq = ++bgRequestSeq;
        return preloadThenApply(url, seq)
            .then(() => (seq === bgRequestSeq ? detectBrightness(url) : null))
            .then((brightness) => {
                if (seq !== bgRequestSeq) return;
                notifyChange(true, brightness !== null && brightness > LIGHT_THRESHOLD);
            });
    }

    // Gọi 1 lần lúc trang khởi động để load lại ảnh đã lưu (nếu có).
    window.syncCustomBackground = function () {
        const saved = localStorage.getItem(BG_KEY);
        if (!saved) {
            bgRequestSeq++;
            clearFromBody();
            window._customBgReadyPromise = Promise.resolve();
            notifyChange(false, false);
            return window._customBgReadyPromise;
        }
        window._customBgReadyPromise = loadAndNotify(saved);
        return window._customBgReadyPromise;
    };

    // Lưu ảnh mới (base64 upload hoặc dán link URL) rồi áp dụng ngay trên trang hiện tại.
    // Ném lỗi ra ngoài nếu bộ nhớ đầy để nơi gọi tự hiện thông báo phù hợp với ngữ cảnh trang đó.
    window.setCustomBackground = function (urlOrDataUri) {
        localStorage.setItem(BG_KEY, urlOrDataUri); // ném lỗi đồng bộ nếu bộ nhớ đầy -> nơi gọi bắt
        return loadAndNotify(urlOrDataUri);
    };

    window.clearCustomBackground = function () {
        localStorage.removeItem(BG_KEY);
        bgRequestSeq++; // huỷ mọi yêu cầu nạp ảnh còn đang chạy dở
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

            if (file.type && !file.type.startsWith('image/')) {
                notify("File này không phải ảnh. Hãy chọn ảnh JPG/PNG/WebP nhé!", "Sai định dạng");
                this.value = '';
                return;
            }
            // Ảnh được NÉN lại trước khi lưu nên cho phép file gốc lớn hơn trước (3.5MB). Vẫn chặn
            // file quá nặng để tránh treo trình duyệt lúc giải mã.
            if (file.size > 15 * 1024 * 1024) {
                notify("Ảnh quá lớn (trên 15MB). Vui lòng chọn ảnh nhẹ hơn nhé.", "Quá tải dung lượng");
                this.value = '';
                return;
            }

            const reader = new FileReader();
            reader.onerror = () => notify("Không đọc được file ảnh này. Hãy thử ảnh khác.", "Lỗi đọc ảnh");
            reader.onload = function (event) {
                compressImageDataUrl(event.target.result).then((dataUri) => {
                    try {
                        window.setCustomBackground(dataUri);
                    } catch (err) {
                        notify("Bộ nhớ tạm của trình duyệt đã đầy. Bạn hãy dùng ảnh nhẹ hơn hoặc sử dụng dán Link URL nhé!", "Lỗi bộ nhớ");
                    }
                });
            };
            reader.readAsDataURL(file);
        });
    };

    // Thu nhỏ ảnh về tối đa 1920px cạnh dài + JPEG 0.85 trước khi lưu localStorage. Ảnh gốc 3.5MB
    // (~4.7 triệu ký tự base64) gần như chiếm hết hạn mức ~5MB của localStorage, khiến các lần
    // setItem khác (đổi màu, theme, thông báo...) bắt đầu ném QuotaExceededError; bản nén chỉ
    // ~0.3-0.8MB và cũng tải/giải mã nhanh hơn nhiều. Lỗi giải mã -> giữ nguyên ảnh gốc.
    function compressImageDataUrl(dataUrl, maxSide = 1920, quality = 0.85) {
        return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => {
                try {
                    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
                    const w = Math.max(1, Math.round(img.naturalWidth * scale));
                    const h = Math.max(1, Math.round(img.naturalHeight * scale));
                    const canvas = document.createElement('canvas');
                    canvas.width = w; canvas.height = h;
                    const ctx = canvas.getContext('2d');
                    ctx.fillStyle = '#000';                 // JPEG không có nền trong suốt
                    ctx.fillRect(0, 0, w, h);
                    ctx.drawImage(img, 0, 0, w, h);
                    const out = canvas.toDataURL('image/jpeg', quality);
                    resolve(out.length < dataUrl.length ? out : dataUrl);
                } catch (e) { resolve(dataUrl); }
            };
            img.onerror = () => resolve(dataUrl);
            img.src = dataUrl;
        });
    }

    // Đọc giá trị từ 1 <input type="text"> theo id (link URL ảnh) rồi áp dụng qua setCustomBackground().
    window.applyBgFromUrlInput = function (inputId) {
        const input = document.getElementById(inputId);
        if (!input) return;
        const url = input.value.trim();
        if (!url) return;
        if (!/^(https?:\/\/|data:image\/)/i.test(url)) {
            const msg = "Link ảnh phải bắt đầu bằng http:// hoặc https://";
            if (typeof window.showAlert === 'function') window.showAlert(msg, "Link không hợp lệ"); else alert(msg);
            return;
        }
        try { window.setCustomBackground(url); }
        catch (err) {
            const msg = "Bộ nhớ tạm của trình duyệt đã đầy, không lưu được link ảnh.";
            if (typeof window.showAlert === 'function') window.showAlert(msg, "Lỗi bộ nhớ"); else alert(msg);
        }
    };

    // Nếu người dùng đang mở song song 2 tab (vd Dashboard + Hồ Sơ) và đổi ảnh nền ở 1 tab, tab
    // còn lại tự cập nhật theo ngay, không cần tải lại trang.
    window.addEventListener('storage', function (e) {
        if (e.key === BG_KEY || e.key === null) window.syncCustomBackground();
    });

    // ==========================================
    // CHUYỂN TRANG CÓ LOADER — trước đây bị copy-paste giống hệt nhau ở cả index.js VÀ
    // calendar.js. Gộp về đây (file đã được nạp sẵn ở cả 3 trang) để sửa 1 chỗ là đủ.
    // ==========================================
    // Quay lại trang bằng nút Back (bfcache) — trang được khôi phục NGUYÊN TRẠNG kể cả loader đang
    // hiện từ lúc rời đi -> kẹt màn hình loading. Tắt loader khi trang được khôi phục từ cache.
    window.addEventListener('pageshow', function (e) {
        if (e.persisted) {
            const loader = document.getElementById('global-loader');
            if (loader) loader.classList.add('hidden');
        }
    });

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