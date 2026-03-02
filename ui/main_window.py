"""
Main Window Module.

Refactored for:
- Fully responsive layout (resize up and down)
- Dynamic sidebar collapse/expand
- Test Any Chrome/Account feature (arbitrary port/address)
- All CRUD operations driven by ViewModel - no hardcoded data
- PanedWindow-based layout for drag-resizable panels
"""

import tkinter as tk
from tkinter import messagebox
from typing import Dict, List, Optional
import ttkbootstrap as ttk
from ttkbootstrap.constants import *
from ttkbootstrap.scrolled import ScrolledText
from ttkbootstrap.dialogs import Messagebox
from ttkbootstrap.tooltip import ToolTip

from app.config import settings
from app.models import Account, AccountStatus, ActionType, BatchResult
from ui.dialogs import AccountDialog, SettingsDialog
from ui.view_models import MainViewModel
import ui.styles as styles


# ─────────────────────────────────────────────
#  Helpers
# ─────────────────────────────────────────────

class ScrollableFrame(ttk.Frame):
    """Scrollable frame with mouse-wheel support."""

    def __init__(self, container, **kwargs):
        super().__init__(container, **kwargs)

        self.canvas = ttk.Canvas(self, highlightthickness=0)
        self.scrollbar = ttk.Scrollbar(self, orient="vertical", command=self.canvas.yview)

        self.scrollable_frame = ttk.Frame(self.canvas)
        self.scrollable_frame.bind(
            "<Configure>",
            lambda e: self.canvas.configure(scrollregion=self.canvas.bbox("all"))
        )

        self.canvas_window = self.canvas.create_window((0, 0), window=self.scrollable_frame, anchor="nw")

        self.canvas.configure(yscrollcommand=self.scrollbar.set)
        self.canvas.bind("<Configure>", self._on_canvas_configure)
        self.canvas.bind_all("<MouseWheel>", self._on_mousewheel)

        self.canvas.pack(side="left", fill="both", expand=True)
        self.scrollbar.pack(side="right", fill="y")

    def _on_canvas_configure(self, event):
        self.canvas.itemconfig(self.canvas_window, width=event.width)

    def _on_mousewheel(self, event):
        self.canvas.yview_scroll(int(-1 * (event.delta / 120)), "units")


# ─────────────────────────────────────────────
#  Account Card (responsive: adjusts to width)
# ─────────────────────────────────────────────

class AccountCard(ttk.Labelframe):
    """Responsive card display for a single account."""

    STATUS_STYLES = {
        AccountStatus.IDLE:       "inverse-secondary",
        AccountStatus.RUNNING:    "inverse-primary",
        AccountStatus.OK:         "inverse-success",
        AccountStatus.CHECKPOINT: "inverse-warning",
        AccountStatus.ERROR:      "inverse-danger",
        AccountStatus.PROXY_DEAD: "inverse-danger",
        AccountStatus.LOGGED_OUT: "inverse-warning",
    }

    STATUS_ICONS = {
        AccountStatus.IDLE:       "⏸",
        AccountStatus.RUNNING:    "🔄",
        AccountStatus.OK:         "✅",
        AccountStatus.CHECKPOINT: "⚠️",
        AccountStatus.ERROR:      "❌",
        AccountStatus.PROXY_DEAD: "💀",
        AccountStatus.LOGGED_OUT: "🚪",
    }

    def __init__(self, parent, account: Account,
                 on_double_click=None,
                 on_open_browser=None,
                 on_test_login=None,
                 on_edit=None,
                 on_remove=None,
                 **kwargs):
        label = account.display_name
        super().__init__(parent, text=f" {label} ", padding=8, **kwargs)
        self.account = account
        self.on_double_click = on_double_click
        self.on_open_browser = on_open_browser
        self.on_test_login = on_test_login
        self.on_edit = on_edit
        self.on_remove = on_remove

        # ── Status row ──
        top_row = ttk.Frame(self)
        top_row.pack(fill=X, pady=(0, 4))

        self.status_var = tk.StringVar(value=self._status_text(account.status))
        self.status_badge = ttk.Label(
            top_row,
            textvariable=self.status_var,
            bootstyle=self.STATUS_STYLES.get(account.status, "inverse-secondary"),
            padding=(4, 2),
            font=("Helvetica", 9, "bold")
        )
        self.status_badge.pack(side=LEFT)

        proxy_txt = "🔒 Proxy" if account.proxy else "🌐 Direct"
        ttk.Label(top_row, text=proxy_txt, font=("Helvetica", 8), bootstyle="secondary").pack(side=RIGHT)

        # ── Address row ──
        addr_row = ttk.Frame(self)
        addr_row.pack(fill=X, pady=2)
        addr_txt = account.debugger_address
        ttk.Label(addr_row, text=addr_txt, font=("Courier", 9), bootstyle="info").pack(side=LEFT)

        # ── Stats row ──
        stats_row = ttk.Frame(self)
        stats_row.pack(fill=X, pady=2)
        self.invites_var = tk.StringVar(value=f"Invites: {account.invites_sent}")
        ttk.Label(stats_row, textvariable=self.invites_var, font=("Helvetica", 9)).pack(side=LEFT)
        if account.last_run:
            run_text = account.last_run.strftime("%H:%M")
            ttk.Label(stats_row, text=f"Last: {run_text}", font=("Helvetica", 8), bootstyle="secondary").pack(side=RIGHT)

        # ── Error tooltip ──
        if account.error_message:
            err_lbl = ttk.Label(self, text=f"⚠ {account.error_message[:50]}…" if len(account.error_message) > 50 else f"⚠ {account.error_message}",
                                font=("Helvetica", 8), bootstyle="danger", wraplength=200)
            err_lbl.pack(fill=X, pady=2)

        # ── Action buttons ──
        btn_row = ttk.Frame(self)
        btn_row.pack(fill=X, pady=(4, 0))

        ttk.Button(btn_row, text="Open", bootstyle="outline-primary", width=5,
                   command=self._open_browser).pack(side=LEFT, padx=2)
        ttk.Button(btn_row, text="Test", bootstyle="outline-info", width=5,
                   command=self._test_login).pack(side=LEFT, padx=2)
        ttk.Button(btn_row, text="Edit", bootstyle="outline-secondary", width=5,
                   command=self._edit).pack(side=LEFT, padx=2)
        ttk.Button(btn_row, text="Del", bootstyle="outline-danger", width=4,
                   command=self._remove).pack(side=RIGHT, padx=2)

        # Bind double-click
        self.bind("<Double-Button-1>", lambda e: self.on_double_click(self.account) if self.on_double_click else None)

    def _status_text(self, status: AccountStatus) -> str:
        icon = self.STATUS_ICONS.get(status, "?")
        return f"{icon} {status.value.upper()}"

    def _open_browser(self):
        if self.on_open_browser:
            self.on_open_browser(self.account)

    def _test_login(self):
        if self.on_test_login:
            self.on_test_login(self.account)

    def _edit(self):
        if self.on_edit:
            self.on_edit(self.account)

    def _remove(self):
        if self.on_remove:
            self.on_remove(self.account)

    def update_status(self, status: AccountStatus, invites: int = None):
        self.status_var.set(self._status_text(status))
        style = self.STATUS_STYLES.get(status, "inverse-secondary")
        self.status_badge.configure(bootstyle=style)
        if invites is not None:
            self.invites_var.set(f"Invites: {invites}")


# ─────────────────────────────────────────────
#  Main Window
# ─────────────────────────────────────────────

class MainWindow:
    """
    Main application window using ttkbootstrap.

    Layout:
    ┌──────────────────────────────────────────┐
    │  [Sidebar]  │  [Content Area (PanedWin)] │
    │             │  ┌────────────────────────┐ │
    │  Controls   │  │  Task Config Bar        │ │
    │  Auto Loop  │  ├────────────────────────┤ │
    │  Accounts   │  │  Notebook Tabs          │ │
    │             │  │  - Live Monitor         │ │
    │             │  │  - Accounts Manager     │ │
    │             │  │  - Global Logs          │ │
    └──────────────────────────────────────────┘
    │  [Status Bar]                             │
    └───────────────────────────────────────────┘
    """

    MIN_SIDEBAR = 220
    MAX_SIDEBAR = 320
    COLS_BREAKPOINTS = {900: 2, 1200: 3, 1600: 4}  # window_width -> card columns

    def __init__(self, view_model: MainViewModel):
        self.view_model = view_model

        self.root = ttk.Window(themename=styles.THEME_NAME)
        self.root.title("FB Auto Invite v3.0")
        self.root.geometry("1200x780")
        self.root.minsize(780, 520)

        # State
        self.account_cards: Dict[str, AccountCard] = {}
        self._cols_per_row: int = 3
        self._sidebar_collapsed = False

        # Build UI
        self._setup_ui()
        self._setup_callbacks()
        self.root.protocol("WM_DELETE_WINDOW", self._on_close)

        # Start message loop
        self._process_messages()

        # Bind resize so cards re-grid
        self.root.bind("<Configure>", self._on_window_resize)

    # ─────────── UI Construction ───────────

    def _setup_ui(self):
        # Outer paned window (sidebar | content)
        # Use tk.PanedWindow (tkinter core) — ttkbootstrap uses lowercase 'Panedwindow'
        bg = self.root.style.colors.bg if hasattr(self.root, "style") else "#222222"
        self._outer_pane = tk.PanedWindow(
            self.root,
            orient=tk.HORIZONTAL,
            sashrelief=tk.FLAT,
            sashwidth=4,
            bg=bg
        )
        self._outer_pane.pack(fill=tk.BOTH, expand=True)

        # Sidebar frame
        self._sidebar_frame = ttk.Frame(self._outer_pane, width=styles.SIDEBAR_WIDTH)
        self._outer_pane.add(self._sidebar_frame, minsize=180, stretch="never")
        self._create_sidebar(self._sidebar_frame)

        # Content frame
        content_frame = ttk.Frame(self._outer_pane)
        self._outer_pane.add(content_frame, minsize=400, stretch="always")
        self._create_content_area(content_frame)

        # Status bar
        self._create_status_bar()

    def _create_sidebar(self, parent):
        parent.pack_propagate(False)

        # Scrollable inner sidebar (handles small heights)
        sb_scroll = ScrollableFrame(parent)
        sb_scroll.pack(fill=BOTH, expand=True)
        sb = sb_scroll.scrollable_frame

        # ── Title ──
        title_frame = ttk.Frame(sb, padding=(10, 10, 10, 5))
        title_frame.pack(fill=X)
        ttk.Label(title_frame, text="🤖 FB Auto Tool",
                  font=("Helvetica", 16, "bold"), bootstyle=PRIMARY).pack()
        ttk.Label(title_frame, text="v3.0 – Tự Động Facebook",
                  font=("Helvetica", 8), bootstyle="secondary").pack()

        ttk.Separator(sb).pack(fill=X, pady=5, padx=10)

        # ── Active Threads badge ──
        self.active_threads_var = tk.StringVar(value="● Luồng Đang Chạy: 0")
        ttk.Label(sb, textvariable=self.active_threads_var,
                  bootstyle="inverse-info", padding=(8, 4),
                  font=("Helvetica", 9, "bold")).pack(fill=X, padx=10, pady=(0, 5))

        # ── Control Panel ──
        ctrl = ttk.Labelframe(sb, text=" Trình Điều Khiển ", padding=10)
        ctrl.pack(fill=X, padx=10, pady=5)

        self.start_btn = ttk.Button(ctrl, text="▶  BẮT ĐẦU", bootstyle=SUCCESS,
                                    command=self._on_start, width=16)
        self.start_btn.pack(pady=3, fill=X)
        ToolTip(self.start_btn, text="Bắt đầu chạy tự động")

        self.pause_btn = ttk.Button(ctrl, text="⏸  TẠM DỪNG", bootstyle=WARNING,
                                    command=self._on_pause, state=DISABLED, width=16)
        self.pause_btn.pack(pady=3, fill=X)
        ToolTip(self.pause_btn, text="Tạm dừng / Tiếp tục quá trình chạy")

        self.stop_btn = ttk.Button(ctrl, text="⏹  DỪNG LẠI", bootstyle=DANGER,
                                   command=self._on_stop, state=DISABLED, width=16)
        self.stop_btn.pack(pady=3, fill=X)
        ToolTip(self.stop_btn, text="Dừng lại tất cả các luồng đang chạy")

        ttk.Separator(sb).pack(fill=X, pady=5, padx=10)

        # ── Auto Loop ──
        loop = ttk.Labelframe(sb, text=" Lặp Tự Động ", padding=10)
        loop.pack(fill=X, padx=10, pady=5)

        loop.columnconfigure(1, weight=1)

        self.auto_loop_var = tk.BooleanVar(value=self.view_model.get_auto_loop_enabled())
        ttk.Checkbutton(loop, text="Bật Vòng Lặp",
                        variable=self.auto_loop_var,
                        command=self._on_auto_loop_toggle,
                        bootstyle="round-toggle").grid(row=0, column=0, columnspan=2, sticky=W, pady=3)

        ttk.Label(loop, text="Mỗi:").grid(row=1, column=0, sticky=W, pady=3)
        self.loop_interval_var = tk.StringVar(value=str(self.view_model.get_auto_loop_interval()))
        ttk.Spinbox(loop, from_=5, to=1440, textvariable=self.loop_interval_var, width=7
                    ).grid(row=1, column=1, sticky=W, padx=(5, 0), pady=3)
        ttk.Label(loop, text="phút", bootstyle="secondary").grid(row=1, column=2, sticky=W)

        ttk.Label(loop, text="Trình duyệt:").grid(row=2, column=0, sticky=W, pady=3)
        self.concurrent_var = tk.StringVar(value=str(self.view_model.get_concurrent_browsers()))
        ttk.Spinbox(loop, from_=1, to=10, textvariable=self.concurrent_var, width=7
                    ).grid(row=2, column=1, sticky=W, padx=(5, 0), pady=3)

        self.loop_btn = ttk.Button(loop, text="▶  BẮT ĐẦU LẶP", bootstyle="outline-success",
                                   command=self._on_start_loop)
        self.loop_btn.grid(row=3, column=0, columnspan=3, sticky=EW, pady=(8, 0))

        ttk.Separator(sb).pack(fill=X, pady=5, padx=10)

        # ── Account Management ──
        acc = ttk.Labelframe(sb, text=" Tài Khoản ", padding=10)
        acc.pack(fill=X, padx=10, pady=5)

        ttk.Button(acc, text="➕ Thêm Tài Khoản",    bootstyle=OUTLINE,
                   command=self._on_add_account).pack(fill=X, pady=2)
        ttk.Button(acc, text="📂 File Dữ Liệu",  bootstyle=OUTLINE,
                   command=self._on_load_accounts).pack(fill=X, pady=2)
        ttk.Button(acc, text="💾 Lưu Lại",  bootstyle=OUTLINE,
                   command=self._on_save_accounts).pack(fill=X, pady=2)

        ttk.Separator(acc).pack(fill=X, pady=6)

        ttk.Button(acc, text="🏥 Kiểm Tra Trạng Thái",   bootstyle="outline-info",
                   command=self._on_health_check).pack(fill=X, pady=2)
        ttk.Button(acc, text="🔄 Reset Lỗi Đỏ",   bootstyle="outline-warning",
                   command=self._on_reset_errors).pack(fill=X, pady=2)
        ttk.Button(acc, text="🔄 Reset Checkpoint", bootstyle="outline-warning",
                   command=self._on_reset_checkpoints).pack(fill=X, pady=2)

        ttk.Separator(sb).pack(fill=X, pady=5, padx=10)

        # ── Quick Test (Test Any Chrome) ──
        test = ttk.Labelframe(sb, text=" Test Nhanh Chrome ", padding=10)
        test.pack(fill=X, padx=10, pady=5)

        test.columnconfigure(1, weight=1)

        ttk.Label(test, text="Địa chỉ:", font=("Helvetica", 9)).grid(row=0, column=0, sticky=W, pady=3)
        self.test_addr_var = tk.StringVar(value="127.0.0.1:9222")
        self.test_addr_entry = ttk.Entry(test, textvariable=self.test_addr_var, width=16)
        self.test_addr_entry.grid(row=0, column=1, sticky=EW, padx=(5, 0), pady=3)
        ToolTip(self.test_addr_entry, text="Nhập địa chỉ Chrome (host:port)")

        self.quick_test_btn = ttk.Button(
            test, text="🧪 Đăng Nhập",
            bootstyle="outline-info",
            command=self._on_quick_test_login
        )
        self.quick_test_btn.grid(row=1, column=0, columnspan=2, sticky=EW, pady=(5, 0))
        ToolTip(self.quick_test_btn, text="Đăng nhập tự động cho Chrome (cần lưu mật khẩu)")

        self.open_any_btn = ttk.Button(
            test, text="🌐 Mở Trình Duyệt",
            bootstyle="outline-primary",
            command=self._on_open_any_chrome
        )
        self.open_any_btn.grid(row=2, column=0, columnspan=2, sticky=EW, pady=(3, 0))
        ToolTip(self.open_any_btn, text="Bật trình duyệt cho chrome này")

        self.test_feature_btn = ttk.Button(
            test, text="🔬 Chức Năng Test…",
            bootstyle="outline-warning",
            command=self._on_test_feature
        )
        self.test_feature_btn.grid(row=3, column=0, columnspan=2, sticky=EW, pady=(3, 0))
        ToolTip(self.test_feature_btn,
                text="Mở cửa sổ test nhanh chức năng lẻ")

        ttk.Separator(sb).pack(fill=X, pady=5, padx=10)

        # ── Bottom ──
        ttk.Button(sb, text="⚙ Cài Đặt Chung", bootstyle="link",
                   command=self._on_open_settings).pack(pady=5)

    def _create_content_area(self, parent):
        parent.columnconfigure(0, weight=1)
        parent.rowconfigure(1, weight=1)

        # Task Configuration bar
        self._create_top_bar(parent)

        # Notebook
        self.notebook = ttk.Notebook(parent)
        self.notebook.grid(row=1, column=0, sticky=NSEW, padx=5, pady=5)

        self._create_monitor_tab()
        self._create_accounts_tab()
        self._create_logs_tab()

    def _create_top_bar(self, parent):
        bar = ttk.Labelframe(parent, text=" Cấu Hình Nhiệm Vụ ", padding=(10, 8))
        bar.grid(row=0, column=0, sticky=EW, padx=5, pady=(5, 0))
        bar.columnconfigure(1, weight=1)
        bar.columnconfigure(3, weight=2)

        # Action Selector
        ttk.Label(bar, text="Hành Động:").grid(row=0, column=0, sticky=W, padx=(0, 5))
        self.action_var = tk.StringVar(value="Invite Friends")
        self.action_combo = ttk.Combobox(
            bar,
            textvariable=self.action_var,
            values=[label for _, label in self.view_model.get_action_types()],
            state="readonly",
            width=18
        )
        self.action_combo.grid(row=0, column=1, sticky=W, padx=5)
        self.action_combo.bind("<<ComboboxSelected>>", self._on_action_change)

        # Dynamic inputs area
        self.task_input_frame = ttk.Frame(bar)
        self.task_input_frame.grid(row=0, column=2, columnspan=3, sticky=EW, padx=5)
        self.task_input_frame.columnconfigure(1, weight=1)

        self._update_task_inputs(ActionType.INVITE)

    def _update_task_inputs(self, action: ActionType):
        for widget in self.task_input_frame.winfo_children():
            widget.destroy()

        if action == ActionType.INVITE:
            ttk.Label(self.task_input_frame, text="Link Group:").grid(row=0, column=0, sticky=W, padx=(0, 5))
            self.task_url_var = tk.StringVar()
            ttk.Entry(self.task_input_frame, textvariable=self.task_url_var).grid(
                row=0, column=1, sticky=EW, padx=5)
            ttk.Label(self.task_input_frame, text="Điều hướng đến trang Thành viên của Nhóm",
                      bootstyle="secondary", font=("Helvetica", 8)).grid(row=1, column=1, sticky=W, padx=5)

        elif action in [ActionType.POST_GROUP, ActionType.POST_WALL]:
            if action == ActionType.POST_GROUP:
                ttk.Label(self.task_input_frame, text="Link Group:").grid(row=0, column=0, sticky=W, padx=(0, 5))
                self.task_url_var = tk.StringVar()
                ttk.Entry(self.task_input_frame, textvariable=self.task_url_var).grid(
                    row=0, column=1, sticky=EW, padx=5)
            ttk.Label(self.task_input_frame, text="Nội dung:").grid(row=1, column=0, sticky=NW, padx=(0, 5), pady=5)
            self.task_content_text = ScrolledText(self.task_input_frame, height=3)
            self.task_content_text.grid(row=1, column=1, sticky=EW, padx=5, pady=5)

        elif action in [ActionType.SHARE, ActionType.COMMENT, ActionType.UNFOLLOW]:
            ttk.Label(self.task_input_frame, text="Link Đích:").grid(row=0, column=0, sticky=W, padx=(0, 5))
            self.task_url_var = tk.StringVar()
            ttk.Entry(self.task_input_frame, textvariable=self.task_url_var).grid(
                row=0, column=1, sticky=EW, padx=5)
            if action == ActionType.COMMENT:
                ttk.Label(self.task_input_frame, text="Bình luận:").grid(row=1, column=0, sticky=NW, padx=(0, 5))
                self.task_content_text = ScrolledText(self.task_input_frame, height=2)
                self.task_content_text.grid(row=1, column=1, sticky=EW, padx=5, pady=3)

    # ─────────── Tabs ───────────

    def _create_monitor_tab(self):
        self.monitor_frame = ttk.Frame(self.notebook)
        self.notebook.add(self.monitor_frame, text="📊 Giám Sát Live")
        self.monitor_frame.columnconfigure(0, weight=1)
        self.monitor_frame.rowconfigure(0, weight=1)

        self.cards_scroll = ScrollableFrame(self.monitor_frame)
        self.cards_scroll.grid(row=0, column=0, sticky=NSEW)
        self.cards_grid = self.cards_scroll.scrollable_frame

    def _create_accounts_tab(self):
        frame = ttk.Frame(self.notebook)
        self.notebook.add(frame, text="👥 Quản Lý Tài Khoản")
        frame.columnconfigure(0, weight=1)
        frame.rowconfigure(1, weight=1)

        # ── Toolbar ──
        tools = ttk.Frame(frame, padding=5)
        tools.grid(row=0, column=0, sticky=EW)

        ttk.Button(tools, text="🔄 Tải Lại", command=self._refresh_account_list,
                   bootstyle=OUTLINE).pack(side=LEFT, padx=2)
        ttk.Button(tools, text="🌐 Kiểm Tra Proxy", command=self._on_build_proxies,
                   bootstyle=OUTLINE).pack(side=LEFT, padx=2)

        ttk.Separator(tools, orient=VERTICAL).pack(side=LEFT, fill=Y, padx=8, pady=2)

        # Test Login (for selected row)
        self.test_login_btn = ttk.Button(
            tools, text="🧪 Đăng Nhập",
            bootstyle="outline-info",
            command=self._on_test_login
        )
        self.test_login_btn.pack(side=LEFT, padx=2)
        ToolTip(self.test_login_btn, text="Kiểm tra đăng nhập cho tài khoản đã chọn")

        ttk.Separator(tools, orient=VERTICAL).pack(side=LEFT, fill=Y, padx=8, pady=2)

        # Add / Edit / Remove (fully dynamic via ViewModel)
        ttk.Button(tools, text="➕ Thêm",    bootstyle="outline-success",
                   command=self._on_add_account).pack(side=LEFT, padx=2)
        ttk.Button(tools, text="✏ Sửa",   bootstyle="outline-warning",
                   command=self._on_edit_selected).pack(side=LEFT, padx=2)
        ttk.Button(tools, text="🗑 Xóa", bootstyle="outline-danger",
                   command=self._on_remove_selected).pack(side=LEFT, padx=2)

        # ── Accounts Table ──
        cols = ("address", "label", "status", "proxy", "invites", "last_run")
        self.acc_tree = ttk.Treeview(frame, columns=cols, show="headings", selectmode="browse")

        self.acc_tree.heading("address",  text="Địa Chỉ Debugger")
        self.acc_tree.heading("label",    text="Tên / Nhãn")
        self.acc_tree.heading("status",   text="Trạng Thái")
        self.acc_tree.heading("proxy",    text="Proxy")
        self.acc_tree.heading("invites",  text="Đã Mời")
        self.acc_tree.heading("last_run", text="Lần Chạy Cuối")

        self.acc_tree.column("address",  width=160, minwidth=120)
        self.acc_tree.column("label",    width=140, minwidth=80)
        self.acc_tree.column("status",   width=100, minwidth=80)
        self.acc_tree.column("proxy",    width=140, minwidth=80)
        self.acc_tree.column("invites",  width=70,  minwidth=50)
        self.acc_tree.column("last_run", width=110, minwidth=80)

        # Color-tag rows by status
        self.acc_tree.tag_configure("ok",         foreground="#2ecc71")
        self.acc_tree.tag_configure("error",      foreground="#e74c3c")
        self.acc_tree.tag_configure("checkpoint", foreground="#f39c12")
        self.acc_tree.tag_configure("running",    foreground="#3498db")
        self.acc_tree.tag_configure("idle",       foreground="#95a5a6")

        # Scrollbar
        vsb = ttk.Scrollbar(frame, orient=VERTICAL, command=self.acc_tree.yview)
        self.acc_tree.configure(yscrollcommand=vsb.set)

        self.acc_tree.grid(row=1, column=0, sticky=NSEW, padx=(5, 0), pady=5)
        vsb.grid(row=1, column=1, sticky=NS, pady=5)

        self._create_account_context_menu()
        self.acc_tree.bind("<Button-3>", self._show_account_context_menu)
        self.acc_tree.bind("<Double-1>", lambda e: self._on_edit_selected())

    def _create_account_context_menu(self):
        self.account_menu = tk.Menu(self.acc_tree, tearoff=0)
        self.account_menu.add_command(label="🧪 Thử Đăng Nhập",         command=self._on_test_login)
        self.account_menu.add_command(label="🌐 Mở Trình Duyệt",       command=self._on_open_browser_selected)
        self.account_menu.add_separator()
        self.account_menu.add_command(label="🔑 Lưu Mật Khẩu FB", command=self._on_set_credentials)
        self.account_menu.add_command(label="🗑 Xóa Mật Khẩu FB",  command=self._on_clear_credentials)
        self.account_menu.add_separator()
        self.account_menu.add_command(label="✏ Chỉnh Sửa",        command=self._on_edit_selected)
        self.account_menu.add_command(label="🔄 Đặt Lại Trạng Thái → NGHỈ", command=self._on_reset_status)
        self.account_menu.add_separator()
        self.account_menu.add_command(label="❌ Xóa Tài Khoản",      command=self._on_remove_selected)

    def _show_account_context_menu(self, event):
        item = self.acc_tree.identify_row(event.y)
        if item:
            self.acc_tree.selection_set(item)
            self.account_menu.post(event.x_root, event.y_root)

    def _create_logs_tab(self):
        frame = ttk.Frame(self.notebook)
        self.notebook.add(frame, text="📋 Nhật Ký Tổng Hợp")
        frame.columnconfigure(0, weight=1)
        frame.rowconfigure(0, weight=1)

        self.log_text = ScrolledText(frame, height=10)
        self.log_text.grid(row=0, column=0, sticky=NSEW, padx=5, pady=5)

        text_widget = self.log_text.text if hasattr(self.log_text, "text") else self.log_text
        text_widget.configure(state="disabled", bg="#1a1a2e", fg="#e0e0e0",
                              font=("Courier New", 9))

        # Clear button
        btn_row = ttk.Frame(frame)
        btn_row.grid(row=1, column=0, sticky=EW, padx=5, pady=(0, 5))
        ttk.Button(btn_row, text="🗑 Xóa Nhật Ký", bootstyle="outline-secondary",
                   command=self._clear_logs).pack(side=RIGHT)

    def _create_status_bar(self):
        status = ttk.Frame(self.root, bootstyle=LIGHT)
        status.pack(fill=X, side=BOTTOM)

        self.status_lbl = ttk.Label(status, text="● Sẵn sàng", bootstyle="inverse-light", padding=(8, 4))
        self.status_lbl.pack(side=LEFT)

        self.invites_total_lbl = ttk.Label(status, text="Tổng Đã Mời: 0", bootstyle="inverse-light", padding=(8, 4))
        self.invites_total_lbl.pack(side=LEFT)

        ttk.Label(status, text="FB Auto Invite v3.0", bootstyle="inverse-light", padding=(8, 4)).pack(side=RIGHT)

    # ─────────── Callbacks Setup ───────────

    def _setup_callbacks(self):
        self.view_model.set_ui_callbacks(
            on_log=self._log_message,
            on_status_change=self._on_status_change,
            on_account_update=self._update_account_status
        )

    # ─────────── Responsive Layout ───────────

    def _on_window_resize(self, event):
        if event.widget is not self.root:
            return
        w = event.width
        if w < 900:
            new_cols = 2
        elif w < 1300:
            new_cols = 3
        else:
            new_cols = 4

        if new_cols != self._cols_per_row:
            self._cols_per_row = new_cols
            self._refresh_monitor_grid()

    # ─────────── Control Handlers ───────────

    def _on_start(self):
        action_str = self.action_var.get().upper().replace(" ", "_")
        try:
            action = ActionType[action_str]
        except KeyError:
            action = ActionType.INVITE

        self.view_model.set_current_action(action)

        if hasattr(self, "task_url_var"):
            self.view_model.set_task_target_url(self.task_url_var.get().strip())
        if hasattr(self, "task_content_text"):
            content = self.task_content_text.get("1.0", "end-1c").strip()
            self.view_model.set_task_content(content)

        if self.view_model.start_run():
            self.start_btn.configure(state=DISABLED)
            self.pause_btn.configure(state=NORMAL)
            self.stop_btn.configure(state=NORMAL)
        else:
            Messagebox.show_error("Could not start run. Check logs.", "Start Failed")

    def _on_pause(self):
        if self.view_model.is_paused():
            self.view_model.resume_run()
            self.pause_btn.configure(text="⏸  TẠM DỪNG", bootstyle=WARNING)
        else:
            self.view_model.pause_run()
            self.pause_btn.configure(text="▶  TIẾP TỤC", bootstyle=SUCCESS)

    def _on_stop(self):
        self.view_model.stop_run()
        self.start_btn.configure(state=NORMAL)
        self.pause_btn.configure(state=DISABLED, text="⏸  TẠM DỪNG", bootstyle=WARNING)
        self.stop_btn.configure(state=DISABLED)

    def _on_auto_loop_toggle(self):
        self.view_model.set_auto_loop_enabled(self.auto_loop_var.get())

    def _on_start_loop(self):
        if hasattr(self, "_loop_running") and self._loop_running:
            self.view_model.stop_run()
            self._loop_running = False
            self.loop_btn.configure(text="▶  BẮT ĐẦU LẶP", bootstyle="outline-success")
            self.start_btn.configure(state=NORMAL)
            self.stop_btn.configure(state=DISABLED)
            return

        action_str = self.action_var.get().upper().replace(" ", "_")
        try:
            action = ActionType[action_str]
        except KeyError:
            action = ActionType.INVITE

        self.view_model.set_current_action(action)

        if hasattr(self, "task_url_var"):
            self.view_model.set_task_target_url(self.task_url_var.get().strip())
        if hasattr(self, "task_content_text"):
            self.view_model.set_task_content(self.task_content_text.get("1.0", "end-1c").strip())

        try:
            interval = int(self.loop_interval_var.get())
            self.view_model.set_auto_loop_interval(interval)
        except ValueError:
            Messagebox.show_error("Invalid interval value", "Error")
            return

        try:
            concurrent = int(self.concurrent_var.get())
            self.view_model.set_concurrent_browsers(concurrent)
        except ValueError:
            Messagebox.show_error("Invalid concurrent browsers value", "Error")
            return

        self.auto_loop_var.set(True)
        self.view_model.set_auto_loop_enabled(True)

        if self.view_model.start_auto_loop():
            self._loop_running = True
            self.loop_btn.configure(text="⏹  DỪNG LẶP", bootstyle="outline-danger")
            self.start_btn.configure(state=DISABLED)
            self.stop_btn.configure(state=DISABLED)
        else:
            Messagebox.show_error("Could not start auto loop. Check logs.", "Start Failed")

    def _on_health_check(self):
        import threading

        def run_check():
            try:
                result = self.view_model.check_account_health(quick=True)
                summary = result.get("summary", {})
                self.view_model.message_queue.put(("log",
                    f"Health Check: {summary.get('healthy', 0)}/{summary.get('total', 0)} accounts healthy"))
                for addr, status in result.get("results", {}).items():
                    if not status.ok:
                        self.view_model.message_queue.put(("log", f"  ❌ {addr}: {status.issue}"))
            except Exception as e:
                self.view_model.message_queue.put(("log", f"Health check error: {e}"))

        threading.Thread(target=run_check, daemon=True).start()
        self._log_message("Starting health check...")

    def _on_reset_errors(self):
        count = self.view_model.reset_error_accounts()
        self._refresh_account_list()
        self._refresh_monitor_grid()
        msg = f"Reset {count} error accounts to IDLE." if count > 0 else "No error accounts to reset."
        Messagebox.show_info(msg, "Reset Errors")

    def _on_reset_checkpoints(self):
        count = self.view_model.reset_checkpoint_accounts()
        self._refresh_account_list()
        self._refresh_monitor_grid()
        msg = f"Reset {count} checkpoint accounts to IDLE." if count > 0 else "No checkpoint accounts to reset."
        Messagebox.show_info(msg, "Reset Checkpoints")

    # ─────────── Account CRUD (ViewModel-driven, no hardcoded data) ───────────

    def _get_selected_account(self) -> Optional[Account]:
        """Get currently selected account from Treeview via ViewModel."""
        selection = self.acc_tree.selection()
        if not selection:
            return None
        item = selection[0]
        values = self.acc_tree.item(item, "values")
        if not values:
            return None
        address = values[0]  # column 0 = debugger_address
        return self.view_model.get_account_by_address(address)

    def _on_add_account(self):
        """Add new account - data comes from dialog, saved via ViewModel."""
        dialog = AccountDialog(self.root, account=None, title="Account")
        self.root.wait_window(dialog.top)
        if dialog.result:
            account = dialog.result
            self.view_model.add_account(
                account.debugger_address,
                account.group_url,
                account.proxy
            )
            self._refresh_account_list()
            self._refresh_monitor_grid()
            self._log_message(f"✅ Added account: {account.debugger_address}")

    def _on_edit_selected(self, account: Account = None):
        """Edit selected account - reads from ViewModel, writes back via ViewModel."""
        acc = account or self._get_selected_account()
        if not acc:
            self._log_message("⚠ No account selected")
            return
        dialog = AccountDialog(self.root, account=acc, title="Account")
        self.root.wait_window(dialog.top)
        if dialog.result:
            self.view_model.update_account(acc)
            self.view_model.save_accounts()
            self._refresh_account_list()
            self._refresh_monitor_grid()
            self._log_message(f"✅ Updated: {acc.display_name}")

    def _on_remove_selected(self):
        """Remove selected account via ViewModel."""
        acc = self._get_selected_account()
        if not acc:
            self._log_message("⚠ No account selected")
            return
        if Messagebox.yesno(f"Remove account {acc.display_name}?", "Confirm Remove") == "Yes":
            self.view_model.remove_account(acc.debugger_address)
            self._refresh_account_list()
            self._refresh_monitor_grid()
            self._log_message(f"🗑 Removed: {acc.display_name}")

    def _on_reset_status(self):
        """Reset selected account status to IDLE via ViewModel."""
        acc = self._get_selected_account()
        if not acc:
            self._log_message("⚠ No account selected")
            return
        acc.status = AccountStatus.IDLE
        acc.error_message = None
        acc.login_attempts = 0
        self.view_model.save_accounts()
        self._refresh_account_list()
        self._log_message(f"🔄 Reset status to IDLE: {acc.display_name}")

    def _on_load_accounts(self):
        """Load accounts from file via ViewModel."""
        self.view_model.load_accounts()
        self._refresh_account_list()
        self._refresh_monitor_grid()
        self._log_message("📂 Accounts loaded")

    def _on_save_accounts(self):
        """Save accounts via ViewModel."""
        if self.view_model.save_accounts():
            Messagebox.show_info("Accounts saved successfully.", "Saved")
        else:
            Messagebox.show_error("Error saving accounts", "Save Failed")

    def _on_open_settings(self):
        dialog = SettingsDialog(self.root)
        self.root.wait_window(dialog.top)
        if dialog.result:
            self.view_model.set_use_proxy(settings.use_proxy)
            self.view_model.set_batch_size(settings.batch_size)
            self.view_model.set_max_clicks(settings.max_clicks)
            self.view_model.set_scroll_delay(settings.scroll_pause_min, settings.scroll_pause_max)
            self._log_message("⚙ Settings saved and applied")

    def _on_set_credentials(self):
        from ui.dialogs import FBCredentialsDialog
        acc = self._get_selected_account()
        if not acc:
            self._log_message("⚠ No account selected")
            return
        dialog = FBCredentialsDialog(self.root, acc)
        self.root.wait_window(dialog.top)
        if dialog.result_code == FBCredentialsDialog.RESULT_SAVED:
            email, password = dialog.get_credentials()
            if self.view_model.set_account_credentials(acc, email, password):
                self._refresh_account_list()
        elif dialog.result_code == FBCredentialsDialog.RESULT_CLEARED:
            self.view_model.clear_account_credentials(acc)
            self._refresh_account_list()

    def _on_clear_credentials(self):
        from ui.dialogs import ask_yesno
        acc = self._get_selected_account()
        if not acc:
            self._log_message("⚠ No account selected")
            return
        if not acc.has_credentials:
            self._log_message("⚠ Account has no stored credentials")
            return
        if ask_yesno("Clear Credentials", f"Clear credentials for {acc.display_name}?", parent=self.root):
            self.view_model.clear_account_credentials(acc)
            self._refresh_account_list()

    def _on_open_browser_selected(self):
        acc = self._get_selected_account()
        if acc:
            self.view_model.open_browser_for_account(acc)

    def _on_build_proxies(self):
        self.view_model.build_proxies()

    # ─────────── Test Login (Selected Account) ───────────

    def _on_test_login(self):
        """
        Test Login for the selected account in the Treeview.
        Flow: select row → validate → call ViewModel → result shown in dialog.
        """
        acc = self._get_selected_account()
        if not acc:
            Messagebox.show_warning("Please select an account from the list first.", "No Account Selected")
            return

        if hasattr(self, "test_login_btn"):
            self.test_login_btn.configure(state=DISABLED, text="Testing…")

        self._log_message(f"[TEST LOGIN] Starting for: {acc.display_name}")

        def on_result(status: str, message: str):
            self.view_model.message_queue.put(("test_login_done", {
                "account": acc,
                "status": status,
                "message": message
            }))

        self.view_model.test_login_for_account(acc, on_result=on_result)

    # ─────────── Test Any Chrome (Sidebar Quick Test) ───────────

    def _on_quick_test_login(self):
        """
        Test login for an arbitrary Chrome address entered in sidebar.
        This allows testing any Chrome/account without it being in the accounts list.
        """
        addr = self.test_addr_var.get().strip()
        if not addr or ":" not in addr:
            Messagebox.show_warning("Please enter a valid Chrome debugger address (e.g., 127.0.0.1:9222).", "Invalid Address")
            return

        # Try to find existing account first; if not found, create a temporary one
        acc = self.view_model.get_account_by_address(addr)

        if acc is None:
            # Create a temporary in-memory account for testing (NOT added to ViewModel list)
            from app.models import Account as AccModel
            acc = AccModel(debugger_address=addr)
            self._log_message(f"[QUICK TEST] Address {addr} not in accounts list — creating temp account for test")

        if not acc.has_credentials:
            Messagebox.show_warning(
                f"No credentials stored for {addr}.\n\n"
                "To test login:\n"
                "1. Add the account to the Accounts list first\n"
                "2. Right-click → Set FB Credentials\n"
                "3. Then use Quick Test",
                "No Credentials"
            )
            return

        self.quick_test_btn.configure(state=DISABLED, text="Testing…")
        self.open_any_btn.configure(state=DISABLED)

        self._log_message(f"[QUICK TEST] Starting for: {addr}")

        def on_result(status: str, message: str):
            self.view_model.message_queue.put(("test_login_done", {
                "account": acc,
                "status": status,
                "message": message,
                "is_quick_test": True
            }))

        self.view_model.test_login_for_account(acc, on_result=on_result)

    def _on_open_any_chrome(self):
        """Open browser for arbitrary address in sidebar."""
        addr = self.test_addr_var.get().strip()
        if not addr or ":" not in addr:
            Messagebox.show_warning("Please enter a valid Chrome debugger address.", "Invalid Address")
            return
        acc = self.view_model.get_account_by_address(addr)
        if acc is None:
            from app.models import Account as AccModel
            acc = AccModel(debugger_address=addr)
        self.view_model.open_browser_for_account(acc)
        self._log_message(f"[OPEN] Opening browser for {addr}")

    def _on_test_feature(self):
        """
        Open the Test Feature dialog.
        Wires TestFeatureDialog → view_model.run_feature_test().
        The dialog manages its own thread; we just pass the callback.
        """
        from ui.dialogs import TestFeatureDialog
        accounts = self.view_model.get_accounts()
        TestFeatureDialog.open(
            parent=self.root,
            run_callback=self.view_model.run_feature_test,
            accounts=accounts
        )

    # ─────────── Action Selector ───────────

    def _on_action_change(self, event):
        val = self.action_var.get()
        try:
            enum_name = val.upper().replace(" ", "_")
            if hasattr(ActionType, enum_name):
                action = ActionType[enum_name]
                self._update_task_inputs(action)
        except Exception:
            pass

    # ─────────── Refresh / Update UI ───────────

    def _refresh_account_list(self):
        """Rebuild Accounts Manager tree from ViewModel - no hardcoded data."""
        for item in self.acc_tree.get_children():
            self.acc_tree.delete(item)

        for acc in self.view_model.get_accounts():
            status_str = acc.status.value
            proxy_str = acc.proxy.address if acc.proxy else "—"
            last_run_str = acc.last_run.strftime("%Y-%m-%d %H:%M") if acc.last_run else "—"
            label_str = acc.label or "—"
            tag = self._get_status_tag(acc.status)

            self.acc_tree.insert("", END, values=(
                acc.debugger_address,
                label_str,
                status_str,
                proxy_str,
                acc.invites_sent,
                last_run_str
            ), tags=(tag,))

    def _get_status_tag(self, status: AccountStatus) -> str:
        return {
            AccountStatus.OK:         "ok",
            AccountStatus.ERROR:      "error",
            AccountStatus.CHECKPOINT: "checkpoint",
            AccountStatus.RUNNING:    "running",
            AccountStatus.IDLE:       "idle",
            AccountStatus.PROXY_DEAD: "error",
            AccountStatus.LOGGED_OUT: "error",
        }.get(status, "idle")

    def _refresh_monitor_grid(self):
        """Rebuild Live Monitor card grid from ViewModel - no hardcoded data."""
        for w in self.cards_grid.winfo_children():
            w.destroy()
        self.account_cards.clear()

        cols = self._cols_per_row
        for i, acc in enumerate(self.view_model.get_accounts()):
            row, col = divmod(i, cols)
            card = AccountCard(
                self.cards_grid,
                acc,
                on_double_click=self._on_edit_selected,
                on_open_browser=lambda a: self.view_model.open_browser_for_account(a),
                on_test_login=self._on_test_login_from_card,
                on_edit=self._on_edit_selected,
                on_remove=self._on_remove_from_card,
            )
            card.grid(row=row, column=col, padx=6, pady=6, sticky="nsew")
            self.cards_grid.columnconfigure(col, weight=1)
            self.account_cards[acc.debugger_address] = card

    def _on_test_login_from_card(self, account: Account):
        """Test login triggered from a monitor card."""
        if account.has_credentials:
            def on_result(status: str, message: str):
                self.view_model.message_queue.put(("test_login_done", {
                    "account": account,
                    "status": status,
                    "message": message
                }))
            self.view_model.test_login_for_account(account, on_result=on_result)
        else:
            Messagebox.show_warning(
                f"No credentials for {account.display_name}.\nRight-click in Accounts Manager → Set FB Credentials.",
                "No Credentials"
            )

    def _on_remove_from_card(self, account: Account):
        if Messagebox.yesno(f"Remove {account.display_name}?", "Confirm") == "Yes":
            self.view_model.remove_account(account.debugger_address)
            self._refresh_account_list()
            self._refresh_monitor_grid()

    def _update_account_status(self, account: Account):
        if account.debugger_address in self.account_cards:
            self.account_cards[account.debugger_address].update_status(
                account.status, account.invites_sent)

    # ─────────── Log / Status ───────────

    def _log_message(self, message: str):
        """Write message to the global log text widget (main thread only)."""
        try:
            # ttkbootstrap ScrolledText wraps the real Text widget in `.text`
            text_widget = self.log_text.text if hasattr(self.log_text, "text") else self.log_text
            text_widget.configure(state="normal")
            text_widget.insert("end", message + "\n")
            text_widget.see("end")
            text_widget.configure(state="disabled")
        except Exception as e:
            # Last-resort: print to stderr so dev can debug without crashing
            import sys
            print(f"[log_message error] {e}: {message}", file=sys.stderr)

    def _clear_logs(self):
        text_widget = self.log_text.text if hasattr(self.log_text, "text") else self.log_text
        text_widget.configure(state=NORMAL)
        text_widget.delete("1.0", END)
        text_widget.configure(state=DISABLED)

    def _on_status_change(self, status: str):
        self.status_lbl.configure(text=f"● {status}")

    # ─────────── Message Queue ───────────

    def _process_messages(self):
        """Drain the ViewModel's message queue and update UI (runs on main thread via after())."""
        try:
            while not self.view_model.message_queue.empty():
                msg_type, data = self.view_model.message_queue.get_nowait()

                if msg_type == "log":
                    self._log_message(data)

                elif msg_type == "status":
                    self._on_status_change(data)

                elif msg_type == "account_update":
                    self._update_account_status(data)

                elif msg_type == "run_complete":
                    self.start_btn.configure(state="normal")
                    self.stop_btn.configure(state="disabled")
                    self.pause_btn.configure(state="disabled", text="⏸  PAUSE", bootstyle=WARNING)
                    self._refresh_account_list()
                    total = self.view_model.get_total_invites()
                    self.invites_total_lbl.configure(text=f"Total Invites: {total}")
                    Messagebox.show_info("The batch run has finished.", "Run Complete")

                elif msg_type == "loop_iteration":
                    run_num, next_run_time = data if isinstance(data, tuple) else (data, None)
                    msg = (f"Loop #{run_num} complete. Next: {next_run_time}"
                           if next_run_time else f"Loop #{run_num} complete")
                    self._log_message(msg)

                elif msg_type == "loop_complete":
                    self._loop_running = False
                    self.loop_btn.configure(text="▶  START LOOP", bootstyle="outline-success")
                    self.start_btn.configure(state="normal")
                    Messagebox.show_info("Auto loop has finished all runs.", "Loop Complete")

                elif msg_type == "test_login_done":
                    self._handle_test_login_done(data)

        except Exception as exc:
            # Log but don't crash — the loop must continue running
            import sys
            print(f"[_process_messages error] {exc}", file=sys.stderr)

        # Re-schedule regardless of exceptions
        self.root.after(100, self._process_messages)

    def _handle_test_login_done(self, data: dict):
        from ui.dialogs import TestLoginResultDialog

        account = data["account"]
        status = data["status"]
        message = data["message"]
        is_quick = data.get("is_quick_test", False)

        # Re-enable buttons
        if hasattr(self, "test_login_btn"):
            self.test_login_btn.configure(state=NORMAL, text="🧪 Test Login")
        if is_quick:
            self.quick_test_btn.configure(state=NORMAL, text="🧪 Test Login")
            self.open_any_btn.configure(state=NORMAL)

        self._log_message(f"[TEST LOGIN] {account.display_name}: {status}")

        def _on_set_credentials():
            # Select account in tree if exists, then open credentials
            acc = self.view_model.get_account_by_address(account.debugger_address)
            if acc:
                self._on_set_credentials_for(acc)

        def _on_set_checkpoint():
            account.status = AccountStatus.CHECKPOINT
            self.view_model.save_accounts()
            self._refresh_account_list()

        TestLoginResultDialog.show(
            parent=self.root,
            account=account,
            status=status,
            message=message,
            on_set_credentials=_on_set_credentials if status in ("wrong_pass", "no_credentials") else None,
            on_set_checkpoint=_on_set_checkpoint if status == "2fa" else None
        )

        self._refresh_account_list()

    def _on_set_credentials_for(self, acc: Account):
        from ui.dialogs import FBCredentialsDialog
        dialog = FBCredentialsDialog(self.root, acc)
        self.root.wait_window(dialog.top)
        if dialog.result_code == FBCredentialsDialog.RESULT_SAVED:
            email, password = dialog.get_credentials()
            self.view_model.set_account_credentials(acc, email, password)
            self._refresh_account_list()
        elif dialog.result_code == FBCredentialsDialog.RESULT_CLEARED:
            self.view_model.clear_account_credentials(acc)
            self._refresh_account_list()

    # ─────────── Window Close ───────────

    def _on_close(self):
        try:
            self.view_model.shutdown()
        except Exception:
            pass
        self.root.destroy()

    def run(self):
        self.root.mainloop()
