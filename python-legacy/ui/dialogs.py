"""
Dialog Windows Module.

Provides modal dialogs for account management and application settings.
Uses ttkbootstrap for modern styling.
"""

import re
import tkinter as tk
from pathlib import Path
from tkinter import filedialog
from typing import Any, Dict, Optional
from datetime import datetime

try:
    import ttkbootstrap as ttk
    from ttkbootstrap.constants import *
    from ttkbootstrap.dialogs import Messagebox
    HAS_BOOTSTRAP = True
except ImportError:
    from tkinter import ttk, messagebox
    HAS_BOOTSTRAP = False

from app.config import settings
from app.models import Account, Proxy


def show_error(title: str, message: str, parent=None):
    """Show error message using appropriate dialog."""
    if HAS_BOOTSTRAP:
        Messagebox.show_error(message, title, parent=parent)
    else:
        from tkinter import messagebox
        messagebox.showerror(title, message, parent=parent)


def show_info(title: str, message: str, parent=None):
    """Show info message using appropriate dialog."""
    if HAS_BOOTSTRAP:
        Messagebox.show_info(message, title, parent=parent)
    else:
        from tkinter import messagebox
        messagebox.showinfo(title, message, parent=parent)


def ask_yesno(title: str, message: str, parent=None) -> bool:
    """Ask yes/no question using appropriate dialog."""
    if HAS_BOOTSTRAP:
        return Messagebox.yesno(message, title, parent=parent) == "Yes"
    else:
        from tkinter import messagebox
        return messagebox.askyesno(title, message, parent=parent)


class AccountDialog:
    """
    Modal dialog for adding or editing an account.

    Provides input fields for debugger address, group URL, proxy,
    and Facebook credentials.
    Returns an Account object on successful save.
    """

    def __init__(
        self,
        parent: tk.Widget,
        account: Optional[Account] = None,
        title: str = "Account"
    ) -> None:
        """
        Initialize AccountDialog.

        Args:
            parent: Parent widget.
            account: Existing account to edit, or None for new account.
            title: Dialog title prefix.
        """
        self.result: Optional[Account] = None
        self.account = account
        self.is_edit = account is not None

        # Create dialog window
        self.top = tk.Toplevel(parent)
        self.top.title(f"{'Sửa' if self.is_edit else 'Thêm'} {title}")
        self.top.geometry("500x350")
        self.top.transient(parent)
        self.top.grab_set()
        self.top.resizable(False, False)

        # Center on parent
        self.top.update_idletasks()
        x = parent.winfo_rootx() + (parent.winfo_width() - 500) // 2
        y = parent.winfo_rooty() + (parent.winfo_height() - 350) // 2
        self.top.geometry(f"+{x}+{y}")

        self._create_widgets()

        # Focus on first entry
        if not self.is_edit:
            self.addr_entry.focus_set()
        else:
            self.url_entry.focus_set()

        # Bind Enter key
        self.top.bind("<Return>", lambda e: self._on_save())
        self.top.bind("<Escape>", lambda e: self.top.destroy())

    def _create_widgets(self) -> None:
        """Create dialog widgets."""
        # Main frame with padding
        main_frame = ttk.Frame(self.top, padding=15)
        main_frame.pack(fill="both", expand=True)

        # Configure grid
        main_frame.columnconfigure(1, weight=1)

        # Debugger Address
        row = 0
        ttk.Label(main_frame, text="Địa chỉ Debugger:").grid(
            row=row, column=0, sticky="e", padx=(0, 10), pady=8
        )

        addr_frame = ttk.Frame(main_frame)
        addr_frame.grid(row=row, column=1, sticky="ew", pady=8)

        default_addr = self.account.debugger_address if self.account else "127.0.0.1:"
        self.addr_var = tk.StringVar(value=default_addr)
        self.addr_entry = ttk.Entry(addr_frame, textvariable=self.addr_var, width=35)
        self.addr_entry.pack(side="left", fill="x", expand=True)

        # Disable address editing for existing accounts
        if self.is_edit:
            self.addr_entry.configure(state="disabled")

        ttk.Label(addr_frame, text="(host:port)", foreground="gray").pack(
            side="left", padx=(5, 0)
        )

        # Group URL
        row += 1
        ttk.Label(main_frame, text="Link Group:").grid(
            row=row, column=0, sticky="e", padx=(0, 10), pady=8
        )

        url_frame = ttk.Frame(main_frame)
        url_frame.grid(row=row, column=1, sticky="ew", pady=8)

        default_url = self.account.group_url if self.account else ""
        self.url_var = tk.StringVar(value=default_url or "")
        self.url_entry = ttk.Entry(url_frame, textvariable=self.url_var, width=45)
        self.url_entry.pack(side="left", fill="x", expand=True)

        # Proxy
        row += 1
        ttk.Label(main_frame, text="Proxy:").grid(
            row=row, column=0, sticky="e", padx=(0, 10), pady=8
        )

        proxy_frame = ttk.Frame(main_frame)
        proxy_frame.grid(row=row, column=1, sticky="ew", pady=8)

        default_proxy = ""
        if self.account and self.account.proxy:
            default_proxy = self.account.proxy.address
        self.proxy_var = tk.StringVar(value=default_proxy)
        self.proxy_entry = ttk.Entry(proxy_frame, textvariable=self.proxy_var, width=35)
        self.proxy_entry.pack(side="left", fill="x", expand=True)

        ttk.Label(proxy_frame, text="(ip:port, optional)", foreground="gray").pack(
            side="left", padx=(5, 0)
        )

        # FB Email
        row += 1
        ttk.Label(main_frame, text="Email Facebook:").grid(
            row=row, column=0, sticky="e", padx=(0, 10), pady=8
        )
        email_frame = ttk.Frame(main_frame)
        email_frame.grid(row=row, column=1, sticky="ew", pady=8)
        
        default_email = self.account.fb_email if self.account else ""
        self.email_var = tk.StringVar(value=default_email)
        self.email_entry = ttk.Entry(email_frame, textvariable=self.email_var, width=45)
        self.email_entry.pack(side="left", fill="x", expand=True)

        # FB Password
        row += 1
        ttk.Label(main_frame, text="Mật khẩu Facebook:").grid(
            row=row, column=0, sticky="e", padx=(0, 10), pady=8
        )
        pass_frame = ttk.Frame(main_frame)
        pass_frame.grid(row=row, column=1, sticky="ew", pady=8)
        
        default_pass = ""
        if self.account and self.account.fb_password_enc:
            from utils.crypto import decrypt_password
            try:
                default_pass = decrypt_password(self.account.fb_password_enc)
            except Exception:
                default_pass = ""
                
        self.pass_var = tk.StringVar(value=default_pass)
        self.pass_entry = ttk.Entry(pass_frame, textvariable=self.pass_var, width=45, show="*")
        self.pass_entry.pack(side="left", fill="x", expand=True)

        # Separator
        row += 1
        ttk.Separator(main_frame, orient="horizontal").grid(
            row=row, column=0, columnspan=2, sticky="ew", pady=15
        )

        # Buttons
        row += 1
        btn_frame = ttk.Frame(main_frame)
        btn_frame.grid(row=row, column=0, columnspan=2, sticky="e")

        ttk.Button(
            btn_frame,
            text="Hủy",
            command=self.top.destroy,
            width=10
        ).pack(side="right", padx=5)

        ttk.Button(
            btn_frame,
            text="Lưu" if self.is_edit else "Thêm",
            command=self._on_save,
            width=10
        ).pack(side="right", padx=5)

    def _validate_address(self, addr: str) -> bool:
        """Validate debugger address format (host:port)."""
        pattern = r'^[\w\.\-]+:\d+$'
        return bool(re.match(pattern, addr))

    def _validate_proxy(self, proxy: str) -> bool:
        """Validate proxy format (ip:port)."""
        if not proxy:
            return True  # Optional field
        pattern = r'^[\d\.]+:\d+$'
        return bool(re.match(pattern, proxy))

    def _on_save(self) -> None:
        """Handle Save button click."""
        addr = self.addr_var.get().strip()
        url = self.url_var.get().strip() or None
        proxy_str = self.proxy_var.get().strip()
        email = self.email_var.get().strip() or None
        password = self.pass_var.get().strip()

        # Validate address
        if not addr:
            show_error("Lỗi", "Yêu cầu phải có Địa chỉ Debugger", parent=self.top)
            self.addr_entry.focus_set()
            return

        if not self._validate_address(addr):
            show_error(
                "Lỗi",
                "Định dạng địa chỉ không hợp lệ. Sử dụng host:port (vd: 127.0.0.1:9222)",
                parent=self.top
            )
            self.addr_entry.focus_set()
            return

        # Validate proxy
        if not self._validate_proxy(proxy_str):
            show_error(
                "Lỗi",
                "Định dạng proxy không hợp lệ. Sử dụng ip:port (vd: 192.168.1.1:8080)",
                parent=self.top
            )
            self.proxy_entry.focus_set()
            return

        # Parse proxy
        proxy = None
        if proxy_str:
            try:
                proxy = Proxy.from_string(proxy_str)
            except Exception:
                show_error("Lỗi", "Định dạng proxy không hợp lệ", parent=self.top)
                self.proxy_entry.focus_set()
                return

        # Encrypt password
        from utils.crypto import encrypt_password
        password_enc = None
        if password:
            try:
                password_enc = encrypt_password(password)
            except Exception as e:
                show_error("Lỗi", f"Không thể mã hóa mật khẩu: {e}", parent=self.top)
                return

        # Create or update account
        if self.is_edit:
            self.account.group_url = url
            self.account.proxy = proxy
            self.account.fb_email = email
            if password_enc:
                self.account.fb_password_enc = password_enc
            elif not password:
                self.account.fb_password_enc = None
            self.result = self.account
        else:
            self.result = Account(
                debugger_address=addr,
                group_url=url,
                proxy=proxy,
                fb_email=email,
                fb_password_enc=password_enc
            )

        self.top.destroy()


class SettingsDialog:
    """
    Modal dialog for application settings.

    Provides tabbed interface for General, Automation, and Proxy settings.
    Saves changes to user_settings.json.
    """

    def __init__(self, parent: tk.Widget) -> None:
        """
        Initialize SettingsDialog.

        Args:
            parent: Parent widget.
        """
        self.result: Optional[Dict[str, Any]] = None

        # Create dialog window
        self.top = tk.Toplevel(parent)
        self.top.title("Cài Đặt Tổng Thể")
        self.top.geometry("650x650")
        self.top.transient(parent)
        self.top.grab_set()
        self.top.resizable(True, True)  # Allow resizing just in case

        # Center on parent
        self.top.update_idletasks()
        x = parent.winfo_rootx() + (parent.winfo_width() - 650) // 2
        y = parent.winfo_rooty() + (parent.winfo_height() - 650) // 2
        self.top.geometry(f"+{x}+{y}")

        # Store setting variables
        self.vars: Dict[str, tk.Variable] = {}

        self._create_widgets()

        # Bind Escape key
        self.top.bind("<Escape>", lambda e: self.top.destroy())

    def _create_widgets(self) -> None:
        """Create dialog widgets."""
        # Main frame
        main_frame = ttk.Frame(self.top, padding=10)
        main_frame.pack(fill="both", expand=True)

        # Button frame (pack first at bottom)
        btn_frame = ttk.Frame(main_frame)
        btn_frame.pack(side="bottom", fill="x", pady=(10, 0))

        ttk.Button(
            btn_frame,
            text="Hủy",
            command=self.top.destroy,
            width=10
        ).pack(side="right", padx=5)

        ttk.Button(
            btn_frame,
            text="Lưu",
            command=self._on_save,
            width=10
        ).pack(side="right", padx=5)

        ttk.Button(
            btn_frame,
            text="Khôi Phục Mặc Định",
            command=self._on_reset,
            width=15
        ).pack(side="left", padx=5)

        # Separator above buttons
        ttk.Separator(main_frame, orient="horizontal").pack(side="bottom", fill="x", pady=5)

        # Notebook for tabs (takes remaining space)
        notebook = ttk.Notebook(main_frame)
        notebook.pack(side="top", fill="both", expand=True)

        # Create tabs
        self._create_general_tab(notebook)
        self._create_automation_tab(notebook)
        self._create_proxy_tab(notebook)

    def _create_general_tab(self, notebook: ttk.Notebook) -> None:
        """Create General settings tab."""
        frame = ttk.Frame(notebook, padding=15)
        notebook.add(frame, text="Chung")

        frame.columnconfigure(1, weight=1)

        # Chrome Binary Path
        row = 0
        ttk.Label(frame, text="Chrome Binary Path:").grid(
            row=row, column=0, sticky="e", padx=(0, 10), pady=8
        )

        chrome_frame = ttk.Frame(frame)
        chrome_frame.grid(row=row, column=1, sticky="ew", pady=8)
        chrome_frame.columnconfigure(0, weight=1)

        self.vars["chrome_binary_path"] = tk.StringVar(
            value=str(settings.chrome_binary_path)
        )
        chrome_entry = ttk.Entry(
            chrome_frame,
            textvariable=self.vars["chrome_binary_path"],
            width=45
        )
        chrome_entry.grid(row=0, column=0, sticky="ew")

        ttk.Button(
            chrome_frame,
            text="Browse",
            command=lambda: self._browse_file(
                self.vars["chrome_binary_path"],
                "Chrome Executable",
                [("Executable", "*.exe"), ("All Files", "*.*")]
            ),
            width=8
        ).grid(row=0, column=1, padx=(5, 0))

        # ChromeDriver Path
        row += 1
        ttk.Label(frame, text="ChromeDriver Path:").grid(
            row=row, column=0, sticky="e", padx=(0, 10), pady=8
        )

        driver_frame = ttk.Frame(frame)
        driver_frame.grid(row=row, column=1, sticky="ew", pady=8)
        driver_frame.columnconfigure(0, weight=1)

        self.vars["chromedriver_path"] = tk.StringVar(
            value=str(settings.chromedriver_path)
        )
        driver_entry = ttk.Entry(
            driver_frame,
            textvariable=self.vars["chromedriver_path"],
            width=45
        )
        driver_entry.grid(row=0, column=0, sticky="ew")

        ttk.Button(
            driver_frame,
            text="Browse",
            command=lambda: self._browse_file(
                self.vars["chromedriver_path"],
                "ChromeDriver Executable",
                [("Executable", "*.exe"), ("All Files", "*.*")]
            ),
            width=8
        ).grid(row=0, column=1, padx=(5, 0))

        # Profile Directory
        row += 1
        ttk.Label(frame, text="Profile Directory:").grid(
            row=row, column=0, sticky="e", padx=(0, 10), pady=8
        )

        profile_frame = ttk.Frame(frame)
        profile_frame.grid(row=row, column=1, sticky="ew", pady=8)
        profile_frame.columnconfigure(0, weight=1)

        self.vars["profile_dir"] = tk.StringVar(value=str(settings.profile_dir))
        profile_entry = ttk.Entry(
            profile_frame,
            textvariable=self.vars["profile_dir"],
            width=45
        )
        profile_entry.grid(row=0, column=0, sticky="ew")

        ttk.Button(
            profile_frame,
            text="Browse",
            command=lambda: self._browse_directory(self.vars["profile_dir"]),
            width=8
        ).grid(row=0, column=1, padx=(5, 0))

        # Separator
        row += 1
        ttk.Separator(frame, orient="horizontal").grid(
            row=row, column=0, columnspan=2, sticky="ew", pady=15
        )

        # Browser Options
        row += 1
        ttk.Label(frame, text="Tùy Chọn Trình Duyệt:", font=("", 10, "bold")).grid(
            row=row, column=0, columnspan=2, sticky="w", pady=(0, 5)
        )

        row += 1
        options_frame = ttk.Frame(frame)
        options_frame.grid(row=row, column=0, columnspan=2, sticky="w")

        self.vars["headless"] = tk.BooleanVar(value=settings.headless)
        ttk.Checkbutton(
            options_frame,
            text="Chế Độ Ẩn (Headless)",
            variable=self.vars["headless"]
        ).pack(side="left", padx=(0, 20))

        self.vars["user_agent_rotate"] = tk.BooleanVar(value=settings.user_agent_rotate)
        ttk.Checkbutton(
            options_frame,
            text="Đổi User-Agent tự động",
            variable=self.vars["user_agent_rotate"]
        ).pack(side="left", padx=(0, 20))

        self.vars["disable_images"] = tk.BooleanVar(value=settings.disable_images)
        ttk.Checkbutton(
            options_frame,
            text="Tắt Hình Ảnh",
            variable=self.vars["disable_images"]
        ).pack(side="left")

        # Window Size
        row += 1
        ttk.Label(frame, text="Kích Cỡ Cửa Sổ:").grid(
            row=row, column=0, sticky="e", padx=(0, 10), pady=8
        )

        self.vars["window_size"] = tk.StringVar(value=settings.window_size)
        size_entry = ttk.Entry(frame, textvariable=self.vars["window_size"], width=15)
        size_entry.grid(row=row, column=1, sticky="w", pady=8)
        ttk.Label(frame, text="(rộng,cao)", foreground="gray").grid(
            row=row, column=1, sticky="w", padx=(120, 0)
        )

        # Debug Mode
        row += 1
        self.vars["debug_mode"] = tk.BooleanVar(value=settings.debug_mode)
        ttk.Checkbutton(
            frame,
            text="Bật Log Debug",
            variable=self.vars["debug_mode"]
        ).grid(row=row, column=0, columnspan=2, sticky="w", pady=8)

    def _create_automation_tab(self, notebook: ttk.Notebook) -> None:
        """Create Automation settings tab."""
        frame = ttk.Frame(notebook, padding=15)
        notebook.add(frame, text="Giới Hạn & Thời Gian")

        frame.columnconfigure(1, weight=1)

        # === Limits Section ===
        row = 0
        ttk.Label(frame, text="Giới Hạn:", font=("", 10, "bold")).grid(
            row=row, column=0, columnspan=2, sticky="w", pady=(0, 10)
        )

        # Batch Size
        row += 1
        ttk.Label(frame, text="Tài khoản mỗi lô:").grid(
            row=row, column=0, sticky="e", padx=(0, 10), pady=5
        )
        limits_frame1 = ttk.Frame(frame)
        limits_frame1.grid(row=row, column=1, sticky="w", pady=5)

        self.vars["batch_size"] = tk.StringVar(value=str(settings.batch_size))
        ttk.Spinbox(
            limits_frame1,
            from_=1, to=20,
            textvariable=self.vars["batch_size"],
            width=8
        ).pack(side="left")
        ttk.Label(limits_frame1, text="tài khoản / đợt", foreground="gray").pack(
            side="left", padx=(10, 0)
        )

        # Max Clicks
        row += 1
        ttk.Label(frame, text="Tối đa mời:").grid(
            row=row, column=0, sticky="e", padx=(0, 10), pady=5
        )
        limits_frame2 = ttk.Frame(frame)
        limits_frame2.grid(row=row, column=1, sticky="w", pady=5)

        self.vars["max_clicks"] = tk.StringVar(value=str(settings.max_clicks))
        ttk.Spinbox(
            limits_frame2,
            from_=1, to=200,
            textvariable=self.vars["max_clicks"],
            width=8
        ).pack(side="left")
        ttk.Label(limits_frame2, text="/ tk / lần chạy", foreground="gray").pack(
            side="left", padx=(10, 0)
        )

        # Daily Max Invites
        row += 1
        ttk.Label(frame, text="Giới hạn 1 ngày:").grid(
            row=row, column=0, sticky="e", padx=(0, 10), pady=5
        )
        limits_frame3 = ttk.Frame(frame)
        limits_frame3.grid(row=row, column=1, sticky="w", pady=5)

        self.vars["daily_max_invites"] = tk.StringVar(
            value=str(settings.daily_max_invites)
        )
        ttk.Spinbox(
            limits_frame3,
            from_=1, to=500,
            textvariable=self.vars["daily_max_invites"],
            width=8
        ).pack(side="left")
        ttk.Label(limits_frame3, text="mời/ngày", foreground="gray").pack(
            side="left", padx=(10, 0)
        )

        # Separator
        row += 1
        ttk.Separator(frame, orient="horizontal").grid(
            row=row, column=0, columnspan=2, sticky="ew", pady=15
        )

        # === Timing Section ===
        row += 1
        ttk.Label(frame, text="Thời Gian (giây):", font=("", 10, "bold")).grid(
            row=row, column=0, columnspan=2, sticky="w", pady=(0, 10)
        )

        # Scroll Delay
        row += 1
        ttk.Label(frame, text="Delay Cuộn:").grid(
            row=row, column=0, sticky="e", padx=(0, 10), pady=5
        )
        scroll_frame = ttk.Frame(frame)
        scroll_frame.grid(row=row, column=1, sticky="w", pady=5)

        self.vars["scroll_pause_min"] = tk.StringVar(
            value=str(settings.scroll_pause_min)
        )
        ttk.Entry(
            scroll_frame,
            textvariable=self.vars["scroll_pause_min"],
            width=6
        ).pack(side="left")
        ttk.Label(scroll_frame, text=" - ").pack(side="left")
        self.vars["scroll_pause_max"] = tk.StringVar(
            value=str(settings.scroll_pause_max)
        )
        ttk.Entry(
            scroll_frame,
            textvariable=self.vars["scroll_pause_max"],
            width=6
        ).pack(side="left")
        ttk.Label(scroll_frame, text="giây", foreground="gray").pack(
            side="left", padx=(10, 0)
        )

        # Click Delay
        row += 1
        ttk.Label(frame, text="Delay Click:").grid(
            row=row, column=0, sticky="e", padx=(0, 10), pady=5
        )
        click_frame = ttk.Frame(frame)
        click_frame.grid(row=row, column=1, sticky="w", pady=5)

        self.vars["click_delay_min"] = tk.StringVar(value=str(settings.click_delay_min))
        ttk.Entry(
            click_frame,
            textvariable=self.vars["click_delay_min"],
            width=6
        ).pack(side="left")
        ttk.Label(click_frame, text=" - ").pack(side="left")
        self.vars["click_delay_max"] = tk.StringVar(value=str(settings.click_delay_max))
        ttk.Entry(
            click_frame,
            textvariable=self.vars["click_delay_max"],
            width=6
        ).pack(side="left")
        ttk.Label(click_frame, text="giây", foreground="gray").pack(
            side="left", padx=(10, 0)
        )

        # Batch Rest
        row += 1
        ttk.Label(frame, text="Nghỉ Giữa Lô:").grid(
            row=row, column=0, sticky="e", padx=(0, 10), pady=5
        )
        rest_frame = ttk.Frame(frame)
        rest_frame.grid(row=row, column=1, sticky="w", pady=5)

        self.vars["batch_rest_min"] = tk.StringVar(value=str(settings.batch_rest_min))
        ttk.Entry(
            rest_frame,
            textvariable=self.vars["batch_rest_min"],
            width=6
        ).pack(side="left")
        ttk.Label(rest_frame, text=" - ").pack(side="left")
        self.vars["batch_rest_max"] = tk.StringVar(value=str(settings.batch_rest_max))
        ttk.Entry(
            rest_frame,
            textvariable=self.vars["batch_rest_max"],
            width=6
        ).pack(side="left")
        ttk.Label(rest_frame, text="giây", foreground="gray").pack(
            side="left", padx=(10, 0)
        )

        # Max Retries
        row += 1
        ttk.Label(frame, text="Thử lại tối đa:").grid(
            row=row, column=0, sticky="e", padx=(0, 10), pady=5
        )
        self.vars["max_retries"] = tk.StringVar(value=str(settings.max_retries))
        ttk.Spinbox(
            frame,
            from_=1, to=10,
            textvariable=self.vars["max_retries"],
            width=8
        ).grid(row=row, column=1, sticky="w", pady=5)

    def _create_proxy_tab(self, notebook: ttk.Notebook) -> None:
        """Create Proxy settings tab."""
        frame = ttk.Frame(notebook, padding=15)
        notebook.add(frame, text="Proxy")

        frame.columnconfigure(1, weight=1)

        # Enable Proxy
        row = 0
        self.vars["use_proxy"] = tk.BooleanVar(value=settings.use_proxy)
        ttk.Checkbutton(
            frame,
            text="Bật Lọc / Check Proxy (Cần Proxy list)",
            variable=self.vars["use_proxy"]
        ).grid(row=row, column=0, columnspan=2, sticky="w", pady=8)

        # Fallback to Direct
        row += 1
        self.vars["proxy_fallback_to_direct"] = tk.BooleanVar(
            value=settings.proxy_fallback_to_direct
        )
        ttk.Checkbutton(
            frame,
            text="Chạy trực tiếp mạng thật khi Lỗi Proxy",
            variable=self.vars["proxy_fallback_to_direct"]
        ).grid(row=row, column=0, columnspan=2, sticky="w", pady=8)

        # Separator
        row += 1
        ttk.Separator(frame, orient="horizontal").grid(
            row=row, column=0, columnspan=2, sticky="ew", pady=15
        )

        # Proxy Settings
        row += 1
        ttk.Label(frame, text="Cài Đặt Proxy:", font=("", 10, "bold")).grid(
            row=row, column=0, columnspan=2, sticky="w", pady=(0, 10)
        )

        # Test Timeout
        row += 1
        ttk.Label(frame, text="Timeout Check:").grid(
            row=row, column=0, sticky="e", padx=(0, 10), pady=5
        )
        timeout_frame = ttk.Frame(frame)
        timeout_frame.grid(row=row, column=1, sticky="w", pady=5)

        self.vars["proxy_test_timeout"] = tk.StringVar(
            value=str(settings.proxy_test_timeout)
        )
        ttk.Spinbox(
            timeout_frame,
            from_=5, to=60,
            textvariable=self.vars["proxy_test_timeout"],
            width=8
        ).pack(side="left")
        ttk.Label(timeout_frame, text="giây", foreground="gray").pack(
            side="left", padx=(10, 0)
        )

        # Max Threads
        row += 1
        ttk.Label(frame, text="Luồng Check (Max):").grid(
            row=row, column=0, sticky="e", padx=(0, 10), pady=5
        )
        self.vars["proxy_max_threads"] = tk.StringVar(
            value=str(settings.proxy_max_threads)
        )
        ttk.Spinbox(
            frame,
            from_=1, to=200,
            textvariable=self.vars["proxy_max_threads"],
            width=8
        ).grid(row=row, column=1, sticky="w", pady=5)

        # Needed Count
        row += 1
        ttk.Label(frame, text="Lấy Proxy Sẵn Sàng (Min):").grid(
            row=row, column=0, sticky="e", padx=(0, 10), pady=5
        )
        self.vars["proxy_needed_count"] = tk.StringVar(
            value=str(settings.proxy_needed_count)
        )
        ttk.Spinbox(
            frame,
            from_=1, to=100,
            textvariable=self.vars["proxy_needed_count"],
            width=8
        ).grid(row=row, column=1, sticky="w", pady=5)

        # Retry Count
        row += 1
        ttk.Label(frame, text="Thử Lại Kết Nối:").grid(
            row=row, column=0, sticky="e", padx=(0, 10), pady=5
        )
        self.vars["proxy_retry_count"] = tk.StringVar(
            value=str(settings.proxy_retry_count)
        )
        ttk.Spinbox(
            frame,
            from_=1, to=10,
            textvariable=self.vars["proxy_retry_count"],
            width=8
        ).grid(row=row, column=1, sticky="w", pady=5)

        # Max Runtime
        row += 1
        ttk.Label(frame, text="Runtime check tối đa:").grid(
            row=row, column=0, sticky="e", padx=(0, 10), pady=5
        )
        runtime_frame = ttk.Frame(frame)
        runtime_frame.grid(row=row, column=1, sticky="w", pady=5)

        self.vars["proxy_max_runtime"] = tk.StringVar(
            value=str(settings.proxy_max_runtime)
        )
        ttk.Entry(
            runtime_frame,
            textvariable=self.vars["proxy_max_runtime"],
            width=8
        ).pack(side="left")
        ttk.Label(runtime_frame, text="giây", foreground="gray").pack(
            side="left", padx=(10, 0)
        )

    def _browse_file(
        self,
        var: tk.StringVar,
        title: str,
        filetypes: list
    ) -> None:
        """Open file browser dialog."""
        initial = var.get()
        initial_dir = Path(initial).parent if initial else None

        path = filedialog.askopenfilename(
            parent=self.top,
            title=f"Chọn {title}",
            filetypes=filetypes,
            initialdir=initial_dir
        )
        if path:
            var.set(path)

    def _browse_directory(self, var: tk.StringVar) -> None:
        """Open directory browser dialog."""
        initial = var.get()

        path = filedialog.askdirectory(
            parent=self.top,
            title="Chọn Thư Mục",
            initialdir=initial if initial else None
        )
        if path:
            var.set(path)

    def _on_save(self) -> None:
        """Handle Save button click."""
        try:
            # Collect all values
            result = {}

            for key, var in self.vars.items():
                value = var.get()

                # Convert numeric fields
                if key in [
                    "batch_size", "max_clicks", "daily_max_invites",
                    "max_retries", "proxy_test_timeout", "proxy_max_threads",
                    "proxy_needed_count", "proxy_retry_count", "proxy_max_runtime",
                    "batch_rest_min", "batch_rest_max"
                ]:
                    value = int(value)
                elif key in [
                    "scroll_pause_min", "scroll_pause_max",
                    "click_delay_min", "click_delay_max"
                ]:
                    value = float(value)

                result[key] = value

            # Validate timing values
            if result["scroll_pause_min"] > result["scroll_pause_max"]:
                show_error(
                    "Lỗi",
                    "Min không thể lớn hơn Max",
                    parent=self.top
                )
                return

            if result["click_delay_min"] > result["click_delay_max"]:
                show_error(
                    "Lỗi",
                    "Min không thể lớn hơn Max",
                    parent=self.top
                )
                return

            if result["batch_rest_min"] > result["batch_rest_max"]:
                show_error(
                    "Lỗi",
                    "Min không thể lớn hơn Max",
                    parent=self.top
                )
                return

            # Update settings
            settings.update_from_dict(result)

            # Save to file
            if settings.save_to_file():
                self.result = result
                self.top.destroy()
            else:
                show_error(
                    "Lỗi",
                    "Không thể lưu cài đặt vào file",
                    parent=self.top
                )

        except ValueError as e:
            show_error(
                "Lỗi",
                f"Giá trị không hợp lệ: {e}",
                parent=self.top
            )

    def _on_reset(self) -> None:
        """Reset settings to defaults."""
        if not ask_yesno(
            "Xác Nhận Reset",
            "Bạn có chắc chắn muốn đặt lại tất cả cài đặt về mặc định?",
            parent=self.top
        ):
            return

        # Create fresh settings without user overrides
        from app.config import AppSettings
        defaults = AppSettings()

        # Update vars with default values
        for key, var in self.vars.items():
            default_value = getattr(defaults, key, None)
            if default_value is not None:
                if isinstance(default_value, Path):
                    var.set(str(default_value))
                else:
                    var.set(default_value)


class FBCredentialsDialog:
    """
    Modal dialog for entering Facebook login credentials.

    Credentials are stored encrypted using Fernet encryption.
    Password is masked by default with option to show.
    """

    # Return codes
    RESULT_CANCELLED = 0
    RESULT_SAVED = 1
    RESULT_CLEARED = 2

    def __init__(
        self,
        parent: tk.Widget,
        account: Account,
        title: str = "Tài Khoản Facebook"
    ) -> None:
        """
        Initialize FBCredentialsDialog.

        Args:
            parent: Parent widget.
            account: Account to set credentials for.
            title: Dialog title.
        """
        self.result_code = self.RESULT_CANCELLED
        self.account = account
        self.email: Optional[str] = None
        self.password: Optional[str] = None

        # Create dialog window
        self.top = tk.Toplevel(parent)
        self.top.title(f"{title} - {account.display_name}")
        self.top.geometry("450x280")
        self.top.transient(parent)
        self.top.grab_set()
        self.top.resizable(False, False)

        # Center on parent
        self.top.update_idletasks()
        x = parent.winfo_rootx() + (parent.winfo_width() - 450) // 2
        y = parent.winfo_rooty() + (parent.winfo_height() - 280) // 2
        self.top.geometry(f"+{x}+{y}")

        self._create_widgets()

        # Focus on email entry
        self.email_entry.focus_set()

        # Bind keys
        self.top.bind("<Return>", lambda e: self._on_save())
        self.top.bind("<Escape>", lambda e: self.top.destroy())

    def _create_widgets(self) -> None:
        """Create dialog widgets."""
        # Main frame with padding
        main_frame = ttk.Frame(self.top, padding=15)
        main_frame.pack(fill="both", expand=True)

        # Configure grid
        main_frame.columnconfigure(1, weight=1)

        # Warning label
        row = 0
        warn_frame = ttk.Frame(main_frame)
        warn_frame.grid(row=row, column=0, columnspan=2, sticky="ew", pady=(0, 10))

        warn_label = ttk.Label(
            warn_frame,
            text="Tài khoản và mật khẩu được mã hóa và chỉ lưu trên máy cục bộ của bạn.",
            foreground="orange",
            font=("", 9, "italic")
        )
        warn_label.pack(anchor="w")

        # Email / Phone
        row += 1
        ttk.Label(main_frame, text="Facebook Email/Phone:").grid(
            row=row, column=0, sticky="e", padx=(0, 10), pady=8
        )

        self.email_var = tk.StringVar(value=self.account.fb_email or "")
        self.email_entry = ttk.Entry(main_frame, textvariable=self.email_var, width=35)
        self.email_entry.grid(row=row, column=1, sticky="ew", pady=8)

        # Password
        row += 1
        ttk.Label(main_frame, text="Facebook Password:").grid(
            row=row, column=0, sticky="e", padx=(0, 10), pady=8
        )

        pass_frame = ttk.Frame(main_frame)
        pass_frame.grid(row=row, column=1, sticky="ew", pady=8)
        pass_frame.columnconfigure(0, weight=1)

        self.password_var = tk.StringVar()
        self.pass_entry = ttk.Entry(pass_frame, textvariable=self.password_var, show="*", width=30)
        self.pass_entry.grid(row=0, column=0, sticky="ew")

        # Show password checkbox
        row += 1
        self.show_pass_var = tk.BooleanVar(value=False)
        show_cb = ttk.Checkbutton(
            main_frame,
            text="Show password",
            variable=self.show_pass_var,
            command=self._toggle_password_visibility
        )
        show_cb.grid(row=row, column=1, sticky="w", pady=(0, 5))

        # Info label if credentials exist
        if self.account.fb_password_enc:
            row += 1
            info_label = ttk.Label(
                main_frame,
                text="Mật khẩu đã được lưu. Bỏ trống nếu không muốn thay đổi.",
                foreground="gray",
                font=("", 9)
            )
            info_label.grid(row=row, column=0, columnspan=2, sticky="w", pady=(0, 5))

        # Separator
        row += 1
        ttk.Separator(main_frame, orient="horizontal").grid(
            row=row, column=0, columnspan=2, sticky="ew", pady=15
        )

        # Buttons
        row += 1
        btn_frame = ttk.Frame(main_frame)
        btn_frame.grid(row=row, column=0, columnspan=2, sticky="ew")

        # Clear button (left)
        ttk.Button(
            btn_frame,
            text="Xóa Mật Khẩu",
            command=self._on_clear,
            width=15,
            bootstyle="danger-outline" if HAS_BOOTSTRAP else None
        ).pack(side="left")

        # Cancel and Save (right)
        ttk.Button(
            btn_frame,
            text="Hủy",
            command=self.top.destroy,
            width=10
        ).pack(side="right", padx=(5, 0))

        ttk.Button(
            btn_frame,
            text="Lưu",
            command=self._on_save,
            width=10,
            bootstyle="success" if HAS_BOOTSTRAP else None
        ).pack(side="right")

    def _toggle_password_visibility(self) -> None:
        """Toggle password field visibility."""
        if self.show_pass_var.get():
            self.pass_entry.configure(show="")
        else:
            self.pass_entry.configure(show="*")

    def _on_save(self) -> None:
        """Handle Save button click."""
        email = self.email_var.get().strip()
        password = self.password_var.get()

        # Validate email
        if not email:
            show_error("Lỗi", "Yêu cầu nhập Email/SĐT", parent=self.top)
            self.email_entry.focus_set()
            return

        # If no new password and no existing, require password
        if not password and not self.account.fb_password_enc:
            show_error("Lỗi", "Yêu cầu nhập mật khẩu", parent=self.top)
            self.pass_entry.focus_set()
            return

        self.email = email
        self.password = password if password else None  # None means keep existing
        self.result_code = self.RESULT_SAVED
        self.top.destroy()

    def _on_clear(self) -> None:
        """Handle Clear Credentials button click."""
        if not ask_yesno(
            "Xóa Mật Khẩu",
            "Bạn có chắc chắn muốn xóa mật khẩu đã lưu của tài khoản này?",
            parent=self.top
        ):
            return

        self.email = None
        self.password = None
        self.result_code = self.RESULT_CLEARED
        self.top.destroy()

    def get_credentials(self) -> tuple:
        """
        Get the entered credentials.

        Returns:
            Tuple of (email, password) or (None, None) if cancelled/cleared.
        """
        return self.email, self.password


class TestLoginResultDialog:
    """
    Dialog to display test login results.

    Uses Toplevel (ttkbootstrap style):
    - Success -> green, "Close" button
    - 2FA -> yellow, "Close" + "Mark as Checkpoint" button
    - Wrong password -> red, "Close" + "Update Credentials" button
    - Timeout / Error -> gray, "Close" button
    """

    # Status -> (title, bootstyle_color, icon)
    STATUS_CONFIG = {
        "success":        ("Đăng Nhập Thành Công",   "success",   ""),
        "2fa":            ("Kiểm tra 2FA/Checkpoint",   "warning",   ""),
        "wrong_pass":     ("Đăng Nhập Thất Bại",       "danger",    ""),
        "timeout":        ("Hết Thời Gian Chờ",      "secondary", ""),
        "error":          ("Lỗi Đăng Nhập",        "danger",    ""),
        "no_credentials": ("Chưa Có Mật Khẩu",     "warning",   ""),
        "chrome_failed":  ("Lỗi Chrome",       "danger",    ""),
    }

    def __init__(
        self,
        parent: tk.Widget,
        account: Account,
        status: str,
        message: str,
        on_set_credentials: Optional[callable] = None,
        on_set_checkpoint: Optional[callable] = None
    ) -> None:
        """
        Initialize TestLoginResultDialog.

        Args:
            parent: Parent tkinter window.
            account: The account that was tested.
            status: One of the STATUS_CONFIG keys.
            message: Detailed message to display.
            on_set_credentials: Callback if user wants to update credentials.
            on_set_checkpoint: Callback if user wants to mark as checkpoint.
        """
        self.account = account
        self.result = None

        config = self.STATUS_CONFIG.get(status, ("Unknown", "secondary", "?"))
        title, color, icon = config

        # Create Toplevel window
        self.top = tk.Toplevel(parent)
        self.top.title(f"Test Đăng Nhập - {account.display_name}")
        self.top.geometry("480x300")
        self.top.resizable(False, False)
        self.top.grab_set()  # Modal
        self.top.focus_set()

        # Center on parent
        self.top.transient(parent)

        # Update window position
        self.top.update_idletasks()
        x = parent.winfo_rootx() + (parent.winfo_width() - 480) // 2
        y = parent.winfo_rooty() + (parent.winfo_height() - 300) // 2
        self.top.geometry(f"+{x}+{y}")

        # ---- Header ----
        header = ttk.Frame(self.top, bootstyle=color, padding=15)
        header.pack(fill=X)

        ttk.Label(
            header,
            text=f"{icon}  {title}",
            font=("Helvetica", 14, "bold"),
            bootstyle=f"inverse-{color}"
        ).pack(side=LEFT)

        ttk.Label(
            header,
            text=f"Tài Khoản: {account.display_name}",
            font=("Helvetica", 9),
            bootstyle=f"inverse-{color}"
        ).pack(side=RIGHT)

        # ---- Message Body ----
        body = ttk.Frame(self.top, padding=15)
        body.pack(fill=BOTH, expand=True)

        msg_lbl = ttk.Label(
            body,
            text=message,
            wraplength=430,
            justify=LEFT,
            font=("Helvetica", 10)
        )
        msg_lbl.pack(anchor=NW)

        # ---- Footer Buttons ----
        footer = ttk.Frame(self.top, padding=(15, 5, 15, 15))
        footer.pack(fill=X)

        # Always: Close button
        ttk.Button(
            footer,
            text="Đóng",
            bootstyle="outline-secondary",
            command=self.top.destroy,
            width=12
        ).pack(side=RIGHT, padx=5)

        # Conditional: "Update Credentials" for wrong_pass / no_credentials
        if status in ("wrong_pass", "no_credentials") and on_set_credentials:
            ttk.Button(
                footer,
                text="Cập Nhật Mật Khẩu",
                bootstyle="outline-warning",
                command=lambda: (self.top.destroy(), on_set_credentials()),
                width=18
            ).pack(side=RIGHT, padx=5)

        # Conditional: "Mark as Checkpoint" for 2fa
        if status == "2fa" and on_set_checkpoint:
            ttk.Button(
                footer,
                text="Đánh Dấu Checkpoint",
                bootstyle="outline-warning",
                command=lambda: (self.top.destroy(), on_set_checkpoint()),
                width=18
            ).pack(side=RIGHT, padx=5)

        # Bind Escape key
        self.top.bind("<Escape>", lambda e: self.top.destroy())

    @classmethod
    def show(
        cls,
        parent: tk.Widget,
        account: Account,
        status: str,
        message: str,
        on_set_credentials: Optional[callable] = None,
        on_set_checkpoint: Optional[callable] = None
    ):
        """
        Convenience classmethod to show dialog.

        Args:
            parent: Parent widget.
            account: Account that was tested.
            status: Result status code.
            message: Message to display.
            on_set_credentials: Callback for updating credentials.
            on_set_checkpoint: Callback for marking as checkpoint.

        Returns:
            Dialog result (if any).
        """
        dialog = cls(
            parent, account, status, message,
            on_set_credentials=on_set_credentials,
            on_set_checkpoint=on_set_checkpoint
        )
        parent.wait_window(dialog.top)
        return dialog.result


# ─────────────────────────────────────────────────────────────────────
#  TestFeatureDialog
# ─────────────────────────────────────────────────────────────────────

class TestFeatureDialog:
    """
    Interactive dialog to test any single automation feature on any Chrome.

    Features:
    - Enter any Chrome debugger address (or pick from list)
    - Select the function to test from a dropdown
    - Configure function-specific parameters dynamically
    - Run in background thread with live log streaming
    - Colored log output (INFO=white, WARNING=yellow, ERROR=red, SUCCESS=green)
    - Stop button to cancel mid-run
    - Copy log to clipboard
    """

    # Registry of all testable functions
    FUNCTIONS = [
        {
            "id": "check_connection",
            "label": "🔌 Kiểm tra kết nối Chrome",
            "description": "Kiểm tra xem Selenium có thể kết nối với port debugger không.",
            "params": [],
            "needs_chrome": True,
        },
        {
            "id": "check_login_status",
            "label": "🔑 Kiểm tra trạng thái đăng nhập",
            "description": "Mở Facebook và kiểm tra xem tài khoản đã đăng nhập chưa.",
            "params": [],
            "needs_chrome": True,
        },
        {
            "id": "check_checkpoint",
            "label": "⚠️ Kiểm tra Checkpoint",
            "description": "Kiểm tra xem tài khoản có bị dính checkpoint hoặc xác minh không.",
            "params": [],
            "needs_chrome": True,
        },
        {
            "id": "test_login",
            "label": "🔐 Tự động đăng nhập",
            "description": "Mở trang đăng nhập và tự động điền mật khẩu / id đã lưu.",
            "params": [
                {"key": "email",    "label": "Email / SĐT", "type": "entry",    "default": ""},
                {"key": "password", "label": "Mật khẩu",      "type": "password", "default": ""},
            ],
            "needs_chrome": True,
        },
        {
            "id": "navigate_url",
            "label": "🌐 Truy cập URL",
            "description": "Điều hướng Chrome đến một URL bất kỳ và đợi trang tải xong.",
            "params": [
                {"key": "url", "label": "URL", "type": "entry", "default": "https://www.facebook.com"},
            ],
            "needs_chrome": True,
        },
        {
            "id": "scroll_page",
            "label": "📜 Cuộn Trang (N lần)",
            "description": "Cuộn trang hiện tại N lần với các khoảng dừng ngẫu nhiên.",
            "params": [
                {"key": "count", "label": "Số lần cuộn", "type": "spinbox", "default": "5", "from_": 1, "to": 50},
            ],
            "needs_chrome": True,
        },
        {
            "id": "find_invite_buttons",
            "label": "🔍 Tìm Nút Thêm Bạn Bè",
            "description": "Đếm số lượng nút 'Thêm bạn bè' đang hiển thị trên trang hiện tại.",
            "params": [],
            "needs_chrome": True,
        },
        {
            "id": "navigate_group",
            "label": "📂 Truy cập thành viên Group",
            "description": "Điều hướng đến trang thành viên của một Group Facebook.",
            "params": [
                {"key": "group_url", "label": "Link Group", "type": "entry", "default": "https://www.facebook.com/groups/"},
            ],
            "needs_chrome": True,
        },
        {
            "id": "dry_run_invite",
            "label": "🧪 Chạy thử Mời (Không Click)",
            "description": "Quét trang thành viên để tìm nút mời NHƯNG KHÔNG CLICK. Chỉ hiển thị số lượng.",
            "params": [
                {"key": "group_url", "label": "Link Group (tuỳ chọn – nếu trống sẽ dùng trang hiện tại)", "type": "entry", "default": ""},
                {"key": "max_scrolls", "label": "Cuộn tối đa", "type": "spinbox", "default": "5", "from_": 1, "to": 30},
            ],
            "needs_chrome": True,
        },
        {
            "id": "invite_members",
            "label": "👥 Mời Thành Viên (Chạy Thật)",
            "description": "Điều hướng tới group và gửi lời mời kết bạn thật. Hãy cẩn thận!",
            "params": [
                {"key": "group_url",   "label": "Link Group",     "type": "entry",   "default": ""},
                {"key": "max_clicks",  "label": "Tối đa mời",   "type": "spinbox", "default": "5", "from_": 1, "to": 100},
                {"key": "max_scrolls", "label": "Cuộn tối đa",   "type": "spinbox", "default": "10", "from_": 1, "to": 50},
            ],
            "needs_chrome": True,
        },
        {
            "id": "post_wall",
            "label": "📝 Đăng lên tường",
            "description": "Đăng nội dung văn bản lên dòng thời gian của tài khoản.",
            "params": [
                {"key": "content", "label": "Nội dung bài viết", "type": "text", "default": "Hello World!"},
            ],
            "needs_chrome": True,
        },
        {
            "id": "post_group",
            "label": "📝 Đăng vào Group",
            "description": "Đăng nội dung văn bản vào một Group Facebook.",
            "params": [
                {"key": "group_url", "label": "Link Group", "type": "entry", "default": ""},
                {"key": "content",   "label": "Nội dung", "type": "text", "default": ""},
            ],
            "needs_chrome": True,
        },
        {
            "id": "share_post",
            "label": "🔗 Chia sẻ bài viết",
            "description": "Chia sẻ một bài viết về dòng thời gian của tài khoản.",
            "params": [
                {"key": "post_url", "label": "Link bài viết", "type": "entry", "default": ""},
            ],
            "needs_chrome": True,
        },
        {
            "id": "comment_post",
            "label": "💬 Bình luận bài viết",
            "description": "Để lại bình luận trên một bài viết cụ thể.",
            "params": [
                {"key": "post_url", "label": "Link bài viết",  "type": "entry", "default": ""},
                {"key": "content",  "label": "Bình luận",   "type": "text",  "default": ""},
            ],
            "needs_chrome": True,
        },
        {
            "id": "get_page_info",
            "label": "📋 Lấy thông tin trang hiện tại",
            "description": "Lấy tiêu đề trang, URL và một số thống kê DOM cơ bản.",
            "params": [],
            "needs_chrome": True,
        },
        {
            "id": "run_js",
            "label": "⚙️ Chạy JavaScript",
            "description": "Thực thi mã JavaScript tùy ý trên trang hiện tại và hiển thị kết quả trả về.",
            "params": [
                {"key": "script", "label": "Mã JavaScript", "type": "text",
                 "default": "return document.title;"},
            ],
            "needs_chrome": True,
        },
    ]

    def __init__(
        self,
        parent: tk.Widget,
        run_callback: callable,  # fn(address, func_id, params, log_fn, stop_event) -> dict
        accounts: list = None,   # list of Account objects for address suggestions
        title: str = "🔬 Test Tính năng trên Chrome"
    ):
        """
        Initialize TestFeatureDialog.

        Args:
            parent: Parent widget.
            run_callback: Callable(address, func_id, params, log_fn, stop_event) -> dict
            accounts: Known accounts for address suggestions.
            title: Dialog title.
        """
        self.run_callback = run_callback
        self.accounts = accounts or []
        self._stop_event = None
        self._run_thread = None

        self.top = tk.Toplevel(parent)
        self.top.title(title)
        self.top.geometry("760x640")
        self.top.minsize(640, 520)
        self.top.transient(parent)
        self.top.grab_set()

        # Center on parent
        self.top.update_idletasks()
        x = parent.winfo_rootx() + (parent.winfo_width() - 760) // 2
        y = parent.winfo_rooty() + (parent.winfo_height() - 640) // 2
        self.top.geometry(f"+{x}+{y}")

        self._param_vars: dict = {}
        self._create_widgets()

        self.top.bind("<Escape>", lambda e: self._on_close())
        self.top.protocol("WM_DELETE_WINDOW", self._on_close)

    # ── Widget Construction ──────────────────────

    def _create_widgets(self):
        from ttkbootstrap.scrolled import ScrolledText as StText
        self._scrolled_text_cls = StText

        root = self.top
        root.columnconfigure(0, weight=1)
        root.rowconfigure(0, weight=0)
        root.rowconfigure(1, weight=0)
        root.rowconfigure(2, weight=1)
        root.rowconfigure(3, weight=0)

        # ── Row 0: Chrome address + connection info ──
        addr_frame = ttk.Labelframe(root, text=" Cửa số Chrome ", padding=(12, 8))
        addr_frame.grid(row=0, column=0, sticky="ew", padx=10, pady=(10, 4))
        addr_frame.columnconfigure(1, weight=1)

        ttk.Label(addr_frame, text="Địa chỉ Debugger:", font=("Helvetica", 9, "bold")).grid(
            row=0, column=0, sticky="w", padx=(0, 8))

        # Combobox pre-populated from known accounts
        addresses = [acc.debugger_address for acc in self.accounts]
        self.addr_var = tk.StringVar(value=addresses[0] if addresses else "127.0.0.1:9222")
        self.addr_combo = ttk.Combobox(
            addr_frame,
            textvariable=self.addr_var,
            values=addresses,
            width=22,
            font=("Courier", 10)
        )
        self.addr_combo.grid(row=0, column=1, sticky="w", padx=(0, 8))

        self.conn_status_var = tk.StringVar(value="⬜ Chưa kiểm tra")
        conn_lbl = ttk.Label(addr_frame, textvariable=self.conn_status_var,
                             font=("Helvetica", 9))
        conn_lbl.grid(row=0, column=2, sticky="w")

        ttk.Button(addr_frame, text="Check Port", bootstyle="outline",
                   command=self._check_port, width=11).grid(row=0, column=3, padx=(8, 0))

        # Account label display
        self.acc_label_var = tk.StringVar(value="")
        ttk.Label(addr_frame, textvariable=self.acc_label_var,
                  font=("Helvetica", 8), bootstyle="secondary").grid(
            row=1, column=0, columnspan=4, sticky="w", pady=(4, 0))

        self.addr_combo.bind("<<ComboboxSelected>>", self._on_addr_change)
        self.addr_combo.bind("<FocusOut>", self._on_addr_change)

        # ── Row 1: Function selector + params ──
        func_frame = ttk.Labelframe(root, text=" Chọn tính năng ", padding=(12, 8))
        func_frame.grid(row=1, column=0, sticky="ew", padx=10, pady=4)
        func_frame.columnconfigure(1, weight=1)

        ttk.Label(func_frame, text="Tính năng:", font=("Helvetica", 9, "bold")).grid(
            row=0, column=0, sticky="w", padx=(0, 8))

        func_labels = [f["label"] for f in self.FUNCTIONS]
        self.func_var = tk.StringVar(value=func_labels[0])
        self.func_combo = ttk.Combobox(
            func_frame,
            textvariable=self.func_var,
            values=func_labels,
            state="readonly",
            width=38
        )
        self.func_combo.grid(row=0, column=1, sticky="w", padx=(0, 8))
        self.func_combo.bind("<<ComboboxSelected>>", self._on_func_change)

        # Description label
        self.desc_var = tk.StringVar(value=self.FUNCTIONS[0]["description"])
        desc_lbl = ttk.Label(func_frame, textvariable=self.desc_var,
                             font=("Helvetica", 8), bootstyle="secondary",
                             wraplength=640)
        desc_lbl.grid(row=1, column=0, columnspan=2, sticky="w", pady=(4, 0))

        # Parameters area
        self.params_frame = ttk.Frame(func_frame)
        self.params_frame.grid(row=2, column=0, columnspan=2, sticky="ew", pady=(8, 0))
        self.params_frame.columnconfigure(1, weight=1)

        self._build_param_widgets(self.FUNCTIONS[0])

        # ── Row 2: Live log output ──
        log_frame = ttk.Labelframe(root, text=" Live Output ", padding=(10, 6))
        log_frame.grid(row=2, column=0, sticky="nsew", padx=10, pady=4)
        log_frame.columnconfigure(0, weight=1)
        log_frame.rowconfigure(0, weight=1)

        try:
            self.log_text = self._scrolled_text_cls(log_frame, height=12, font=("Courier New", 9))
        except Exception:
            self.log_text = tk.Text(log_frame, height=12, font=("Courier New", 9))
        self.log_text.pack(fill="both", expand=True)

        inner = self.log_text.text if hasattr(self.log_text, "text") else self.log_text
        inner.configure(state="disabled", bg="#1e1e1e", fg="#d4d4d4",
                        insertbackground="white")

        # Color tags
        inner.tag_configure("INFO",    foreground="#d4d4d4")
        inner.tag_configure("SUCCESS", foreground="#6a9955")
        inner.tag_configure("WARNING", foreground="#d7ba7d")
        inner.tag_configure("ERROR",   foreground="#f44747")
        inner.tag_configure("SYSTEM",  foreground="#9cdcfe")
        inner.tag_configure("RESULT",  foreground="#4ec9b0")

        # ── Row 3: Action buttons ──
        btn_row = ttk.Frame(root, padding=(10, 6))
        btn_row.grid(row=3, column=0, sticky="ew")

        self.run_btn = ttk.Button(
            btn_row, text="▶  Chạy Thử",
            bootstyle="success", width=14,
            command=self._on_run
        )
        self.run_btn.pack(side="left", padx=4)

        self.stop_btn = ttk.Button(
            btn_row, text="⏹  Dừng Lại",
            bootstyle="danger-outline", width=10,
            command=self._on_stop,
            state="disabled"
        )
        self.stop_btn.pack(side="left", padx=4)

        ttk.Button(
            btn_row, text="🗑 Xóa Log",
            bootstyle="outline-secondary", width=11,
            command=self._clear_log
        ).pack(side="left", padx=4)

        ttk.Button(
            btn_row, text="📋 Copy Log",
            bootstyle="outline-secondary", width=11,
            command=self._copy_log
        ).pack(side="left", padx=4)

        ttk.Button(
            btn_row, text="✖  Đóng",
            bootstyle="outline", width=10,
            command=self._on_close
        ).pack(side="right", padx=4)

    # ── Dynamic param rendering ──────────────────

    def _build_param_widgets(self, func_def: dict):
        """Rebuild parameter widgets for the selected function."""
        for w in self.params_frame.winfo_children():
            w.destroy()
        self._param_vars.clear()

        params = func_def.get("params", [])
        if not params:
            ttk.Label(self.params_frame,
                      text="Chức năng này không cần tham số nào.",
                      bootstyle="secondary", font=("Helvetica", 8)).grid(
                row=0, column=0, columnspan=2, sticky="w")
            return

        for i, p in enumerate(params):
            row_w = ttk.Frame(self.params_frame)
            row_w.grid(row=i, column=0, columnspan=2, sticky="ew", pady=3)
            row_w.columnconfigure(1, weight=1)

            lbl = ttk.Label(row_w, text=f"{p['label']}:", width=26, anchor="w",
                            font=("Helvetica", 9))
            lbl.grid(row=0, column=0, sticky="w", padx=(0, 8))

            ptype = p.get("type", "entry")
            default = p.get("default", "")

            if ptype == "entry":
                var = tk.StringVar(value=default)
                ttk.Entry(row_w, textvariable=var).grid(row=0, column=1, sticky="ew")
                self._param_vars[p["key"]] = var

            elif ptype == "password":
                var = tk.StringVar(value=default)
                ttk.Entry(row_w, textvariable=var, show="*").grid(row=0, column=1, sticky="ew")
                self._param_vars[p["key"]] = var

            elif ptype == "spinbox":
                var = tk.StringVar(value=default)
                ttk.Spinbox(
                    row_w, from_=p.get("from_", 1), to=p.get("to", 100),
                    textvariable=var, width=10
                ).grid(row=0, column=1, sticky="w")
                self._param_vars[p["key"]] = var

            elif ptype == "text":
                var = tk.StringVar()
                text_frame = ttk.Frame(row_w)
                text_frame.grid(row=0, column=1, sticky="ew")
                text_frame.columnconfigure(0, weight=1)
                txt = tk.Text(text_frame, height=3, wrap="word", font=("Helvetica", 9))
                txt.insert("1.0", default)
                txt.grid(row=0, column=0, sticky="ew")
                # Store text widget under key with _textwidget suffix
                self._param_vars[p["key"]] = txt

    # ── Event Handlers ───────────────────────────

    def _on_func_change(self, event=None):
        label = self.func_var.get()
        func_def = next((f for f in self.FUNCTIONS if f["label"] == label), None)
        if func_def:
            self.desc_var.set(func_def["description"])
            self._build_param_widgets(func_def)

    def _on_addr_change(self, event=None):
        addr = self.addr_var.get().strip()
        for acc in self.accounts:
            if acc.debugger_address == addr:
                name = acc.label or addr
                creds = "🔑 Có mật khẩu" if acc.has_credentials else "⚠ Chưa có mật khẩu"
                self.acc_label_var.set(f"Tài khoản: {name}  |  {creds}")
                return
        self.acc_label_var.set("(Địa chỉ không có trong danh sách — kết nối tạm thời)")

    def _check_port(self):
        import socket
        addr = self.addr_var.get().strip()
        try:
            host, port_str = addr.rsplit(":", 1)
            port = int(port_str)
        except Exception:
            self.conn_status_var.set("❌ Địa chỉ lỗi")
            return

        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                s.settimeout(1.5)
                result = s.connect_ex((host, port))
            if result == 0:
                self.conn_status_var.set("✅ Port mở")
            else:
                self.conn_status_var.set("❌ Port đã đóng / chưa mở")
        except Exception as e:
            self.conn_status_var.set(f"❌ Lỗi: {e}")

    def _get_selected_func(self) -> Optional[dict]:
        label = self.func_var.get()
        return next((f for f in self.FUNCTIONS if f["label"] == label), None)

    def _collect_params(self) -> dict:
        params = {}
        func_def = self._get_selected_func()
        if not func_def:
            return params
        for p in func_def.get("params", []):
            key = p["key"]
            var = self._param_vars.get(key)
            if var is None:
                continue
            if isinstance(var, tk.Text):
                params[key] = var.get("1.0", "end-1c").strip()
            else:
                params[key] = var.get().strip()
        return params

    # ── Log Writer (called from background thread) ──

    def _append_log(self, message: str, tag: str = "INFO"):
        """Append a line to the log widget (must be called from main thread via after)."""
        def _do():
            inner = self.log_text.text if hasattr(self.log_text, "text") else self.log_text
            inner.configure(state="normal")
            timestamp = datetime.now().strftime("%H:%M:%S")
            full_line = f"[{timestamp}] {message}\n"
            inner.insert("end", full_line, tag)
            inner.see("end")
            inner.configure(state="disabled")
        try:
            self.top.after(0, _do)
        except Exception:
            pass

    def _log_info(self, msg: str):    self._append_log(msg, "INFO")
    def _log_success(self, msg: str): self._append_log(msg, "SUCCESS")
    def _log_warning(self, msg: str): self._append_log(msg, "WARNING")
    def _log_error(self, msg: str):   self._append_log(msg, "ERROR")
    def _log_system(self, msg: str):  self._append_log(msg, "SYSTEM")
    def _log_result(self, msg: str):  self._append_log(msg, "RESULT")

    def _smart_log(self, message: str):
        """Route log message to appropriate color based on content."""
        low = message.lower()
        if any(k in low for k in ("error", "failed", "exception", "traceback")):
            self._log_error(message)
        elif any(k in low for k in ("warning", "warn", "checkpoint")):
            self._log_warning(message)
        elif any(k in low for k in ("success", "done!", "✓", "✅", "complete")):
            self._log_success(message)
        elif any(k in low for k in ("result:", "→", "port open", "connected")):
            self._log_result(message)
        else:
            self._log_info(message)

    # ── Run / Stop ──────────────────────────────

    def _on_run(self):
        import threading

        func_def = self._get_selected_func()
        if not func_def:
            return

        addr = self.addr_var.get().strip()
        if not addr or ":" not in addr:
            self._log_error("Địa chỉ Chrome sai định dạng. Vui lòng thử host:port")
            return

        params = self._collect_params()

        # Prepare stop event
        import threading as _th
        self._stop_event = _th.Event()

        self.run_btn.configure(state="disabled")
        self.stop_btn.configure(state="normal")

        self._log_system(f"{'─'*55}")
        self._log_system(f"▶  Đang chạy: {func_def['label']}")
        self._log_system(f"   Địa chỉ: {addr}")
        if params:
            for k, v in params.items():
                display_v = "***" if k == "password" else v[:80] if isinstance(v, str) else str(v)
                self._log_system(f"   {k}: {display_v}")
        self._log_system(f"{'─'*55}")

        def _worker():
            try:
                result = self.run_callback(
                    address=addr,
                    func_id=func_def["id"],
                    params=params,
                    log_fn=self._smart_log,
                    stop_event=self._stop_event
                )
                if self._stop_event.is_set():
                    self._log_warning("Chương trình đã bị dừng bởi người dùng.")
                else:
                    # Show result summary
                    self._log_system(f"{'─'*55}")
                    if isinstance(result, dict):
                        status = result.get("status", "done")
                        msg = result.get("message", "")
                        if status == "success":
                            self._log_success(f"✅ KẾT QUẢ: {msg or 'Thành công'}")
                        elif status == "error":
                            self._log_error(f"❌ KẾT QUẢ: {msg or 'Thất bại'}")
                        else:
                            self._log_result(f"→  KẾT QUẢ: {msg or status}")
                        # Extra data
                        for k, v in result.items():
                            if k not in ("status", "message"):
                                self._log_result(f"   {k}: {v}")
                    else:
                        self._log_result(f"→  RESULT: {result}")
                    self._log_system(f"{'─'*55}")
            except Exception as e:
                self._log_error(f"Unhandled error: {e}")
            finally:
                try:
                    self.top.after(0, self._on_run_done)
                except Exception:
                    pass

        self._run_thread = threading.Thread(target=_worker, daemon=True)
        self._run_thread.start()

    def _on_run_done(self):
        self.run_btn.configure(state="normal")
        self.stop_btn.configure(state="disabled")

    def _on_stop(self):
        if self._stop_event:
            self._stop_event.set()
        self.stop_btn.configure(state="disabled")
        self._log_warning("Đã gửi lệnh dừng…")

    def _clear_log(self):
        inner = self.log_text.text if hasattr(self.log_text, "text") else self.log_text
        inner.configure(state="normal")
        inner.delete("1.0", "end")
        inner.configure(state="disabled")

    def _copy_log(self):
        inner = self.log_text.text if hasattr(self.log_text, "text") else self.log_text
        content = inner.get("1.0", "end-1c")
        self.top.clipboard_clear()
        self.top.clipboard_append(content)

    def _on_close(self):
        if self._stop_event:
            self._stop_event.set()
        self.top.destroy()

    # ── Class-level open method ──────────────────

    @classmethod
    def open(cls, parent, run_callback, accounts=None):
        """Open the dialog (non-blocking)."""
        dlg = cls(parent, run_callback=run_callback, accounts=accounts)
        return dlg
