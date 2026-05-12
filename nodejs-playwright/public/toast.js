(function () {
    const styles = `
        .global-toast-stack {
            position: fixed;
            right: 24px;
            bottom: 24px;
            z-index: 10000;
            display: flex;
            flex-direction: column;
            gap: 10px;
            pointer-events: none;
        }
        .global-toast {
            min-width: 280px;
            max-width: min(420px, calc(100vw - 32px));
            padding: 12px 14px;
            border-radius: 12px;
            border: 1px solid rgba(148, 163, 184, 0.25);
            background: rgba(15, 23, 42, 0.96);
            color: #f8fafc;
            box-shadow: 0 18px 45px rgba(0, 0, 0, 0.36);
            transform: translateY(16px);
            opacity: 0;
            transition: opacity 180ms ease, transform 180ms ease;
            pointer-events: auto;
            font: 500 0.92rem/1.45 Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }
        .global-toast.show {
            opacity: 1;
            transform: translateY(0);
        }
        .global-toast-title {
            font-weight: 700;
            margin-bottom: 2px;
        }
        .global-toast-message {
            color: rgba(226, 232, 240, 0.9);
            word-break: break-word;
        }
        .global-toast.success { border-color: rgba(34, 197, 94, 0.45); }
        .global-toast.error { border-color: rgba(248, 113, 113, 0.5); }
        .global-toast.warning { border-color: rgba(251, 191, 36, 0.5); }
        .global-toast.info { border-color: rgba(96, 165, 250, 0.45); }
        .global-confirm-backdrop {
            position: fixed;
            inset: 0;
            z-index: 10001;
            display: none;
            align-items: center;
            justify-content: center;
            padding: 18px;
            background: rgba(2, 6, 23, 0.68);
            backdrop-filter: blur(10px);
        }
        .global-confirm-backdrop.show {
            display: flex;
        }
        .global-confirm-dialog {
            width: min(420px, 100%);
            border-radius: 16px;
            border: 1px solid rgba(148, 163, 184, 0.22);
            background: #0f172a;
            color: #f8fafc;
            box-shadow: 0 24px 80px rgba(0, 0, 0, 0.5);
            padding: 18px;
            font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }
        .global-confirm-title {
            margin: 0 0 8px;
            font-size: 1rem;
            font-weight: 800;
        }
        .global-confirm-message {
            margin: 0;
            color: rgba(226, 232, 240, 0.82);
            line-height: 1.5;
            font-size: 0.92rem;
        }
        .global-confirm-actions {
            display: flex;
            justify-content: flex-end;
            gap: 10px;
            margin-top: 18px;
        }
        .global-confirm-btn {
            border: 1px solid rgba(148, 163, 184, 0.22);
            border-radius: 10px;
            padding: 10px 14px;
            color: #f8fafc;
            background: rgba(30, 41, 59, 0.82);
            font-weight: 700;
            cursor: pointer;
        }
        .global-confirm-btn.primary {
            border-color: rgba(239, 68, 68, 0.45);
            background: linear-gradient(135deg, #ef4444, #dc2626);
        }
        @media (max-width: 640px) {
            .global-toast-stack {
                right: 16px;
                left: 16px;
                bottom: 16px;
            }
            .global-toast {
                min-width: 0;
                width: 100%;
            }
        }
    `;

    function ensureStyle() {
        if (document.getElementById('globalToastStyles')) return;
        const style = document.createElement('style');
        style.id = 'globalToastStyles';
        style.textContent = styles;
        document.head.appendChild(style);
    }

    function ensureStack() {
        let stack = document.getElementById('globalToastStack');
        if (!stack) {
            stack = document.createElement('div');
            stack.id = 'globalToastStack';
            stack.className = 'global-toast-stack';
            document.body.appendChild(stack);
        }
        return stack;
    }

    function titleFor(type) {
        return {
            success: 'Thành công',
            error: 'Có lỗi',
            warning: 'Cần chú ý',
            info: 'Thông báo'
        }[type] || 'Thông báo';
    }

    function showToast(message, type = 'info', options = {}) {
        ensureStyle();
        const stack = ensureStack();
        const toast = document.createElement('div');
        toast.className = `global-toast ${type}`;
        toast.innerHTML = `
            <div class="global-toast-title">${options.title || titleFor(type)}</div>
            <div class="global-toast-message">${message || ''}</div>
        `;
        stack.appendChild(toast);
        requestAnimationFrame(() => toast.classList.add('show'));
        const duration = options.duration || (type === 'error' ? 5200 : 3200);
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 220);
        }, duration);
    }

    function ensureConfirm() {
        ensureStyle();
        let backdrop = document.getElementById('globalConfirmBackdrop');
        if (!backdrop) {
            backdrop = document.createElement('div');
            backdrop.id = 'globalConfirmBackdrop';
            backdrop.className = 'global-confirm-backdrop';
            document.body.appendChild(backdrop);
        }
        return backdrop;
    }

    function confirmAction(options = {}) {
        const backdrop = ensureConfirm();
        const title = options.title || 'Xác nhận thao tác';
        const message = options.message || 'Bạn có chắc chắn muốn tiếp tục?';
        const confirmText = options.confirmText || 'Xác nhận';
        const cancelText = options.cancelText || 'Hủy';

        return new Promise(resolve => {
            backdrop.innerHTML = `
                <div class="global-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="globalConfirmTitle">
                    <h3 class="global-confirm-title" id="globalConfirmTitle">${title}</h3>
                    <p class="global-confirm-message">${message}</p>
                    <div class="global-confirm-actions">
                        <button type="button" class="global-confirm-btn" data-action="cancel">${cancelText}</button>
                        <button type="button" class="global-confirm-btn primary" data-action="confirm">${confirmText}</button>
                    </div>
                </div>
            `;
            const close = value => {
                backdrop.classList.remove('show');
                backdrop.innerHTML = '';
                resolve(value);
            };
            backdrop.onclick = event => {
                if (event.target === backdrop) close(false);
            };
            backdrop.querySelector('[data-action="cancel"]').onclick = () => close(false);
            backdrop.querySelector('[data-action="confirm"]').onclick = () => close(true);
            backdrop.classList.add('show');
            backdrop.querySelector('[data-action="cancel"]').focus();
        });
    }

    window.AppToast = { show: showToast, confirm: confirmAction };
    window.showToast = showToast;
    window.showConfirm = confirmAction;
})();
