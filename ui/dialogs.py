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

    Provides input fields for debugger address, group URL, and proxy.
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
        self.top.title(f"{'Edit' if self.is_edit else 'Add'} {title}")
        self.top.geometry("500x220")
        self.top.transient(parent)
        self.top.grab_set()
        self.top.resizable(False, False)

        # Center on parent
        self.top.update_idletasks()
        x = parent.winfo_rootx() + (parent.winfo_width() - 500) // 2
        y = parent.winfo_rooty() + (parent.winfo_height() - 220) // 2
        self.top.geometry(f"+{x}+{y}")

        self._create_widgets()

        # Focus on first entry
        self.addr_entry.focus_set()

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
        ttk.Label(main_frame, text="Debugger Address:").grid(
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
        ttk.Label(main_frame, text="Group URL:").grid(
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
            text="Cancel",
            command=self.top.destroy,
            width=10
        ).pack(side="right", padx=5)

        ttk.Button(
            btn_frame,
            text="Save" if self.is_edit else "Add",
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

        # Validate address
        if not addr:
            show_error("Error", "Debugger Address is required", parent=self.top)
            self.addr_entry.focus_set()
            return

        if not self._validate_address(addr):
            show_error(
                "Error",
                "Invalid address format. Use host:port (e.g., 127.0.0.1:9222)",
                parent=self.top
            )
            self.addr_entry.focus_set()
            return

        # Validate proxy
        if not self._validate_proxy(proxy_str):
            show_error(
                "Error",
                "Invalid proxy format. Use ip:port (e.g., 192.168.1.1:8080)",
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
                show_error("Error", "Invalid proxy format", parent=self.top)
                self.proxy_entry.focus_set()
                return

        # Create or update account
        if self.is_edit:
            self.account.group_url = url
            self.account.proxy = proxy
            self.result = self.account
        else:
            self.result = Account(
                debugger_address=addr,
                group_url=url,
                proxy=proxy
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
        self.top.title("Settings")
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
            text="Cancel",
            command=self.top.destroy,
            width=10
        ).pack(side="right", padx=5)

        ttk.Button(
            btn_frame,
            text="Save",
            command=self._on_save,
            width=10
        ).pack(side="right", padx=5)

        ttk.Button(
            btn_frame,
            text="Reset to Defaults",
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
        notebook.add(frame, text="General")

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
        ttk.Label(frame, text="Browser Options:", font=("", 10, "bold")).grid(
            row=row, column=0, columnspan=2, sticky="w", pady=(0, 5)
        )

        row += 1
        options_frame = ttk.Frame(frame)
        options_frame.grid(row=row, column=0, columnspan=2, sticky="w")

        self.vars["headless"] = tk.BooleanVar(value=settings.headless)
        ttk.Checkbutton(
            options_frame,
            text="Headless Mode",
            variable=self.vars["headless"]
        ).pack(side="left", padx=(0, 20))

        self.vars["user_agent_rotate"] = tk.BooleanVar(value=settings.user_agent_rotate)
        ttk.Checkbutton(
            options_frame,
            text="Rotate User-Agent",
            variable=self.vars["user_agent_rotate"]
        ).pack(side="left", padx=(0, 20))

        self.vars["disable_images"] = tk.BooleanVar(value=settings.disable_images)
        ttk.Checkbutton(
            options_frame,
            text="Disable Images",
            variable=self.vars["disable_images"]
        ).pack(side="left")

        # Window Size
        row += 1
        ttk.Label(frame, text="Window Size:").grid(
            row=row, column=0, sticky="e", padx=(0, 10), pady=8
        )

        self.vars["window_size"] = tk.StringVar(value=settings.window_size)
        size_entry = ttk.Entry(frame, textvariable=self.vars["window_size"], width=15)
        size_entry.grid(row=row, column=1, sticky="w", pady=8)
        ttk.Label(frame, text="(width,height)", foreground="gray").grid(
            row=row, column=1, sticky="w", padx=(120, 0)
        )

        # Debug Mode
        row += 1
        self.vars["debug_mode"] = tk.BooleanVar(value=settings.debug_mode)
        ttk.Checkbutton(
            frame,
            text="Enable Debug Logging",
            variable=self.vars["debug_mode"]
        ).grid(row=row, column=0, columnspan=2, sticky="w", pady=8)

    def _create_automation_tab(self, notebook: ttk.Notebook) -> None:
        """Create Automation settings tab."""
        frame = ttk.Frame(notebook, padding=15)
        notebook.add(frame, text="Limits & Timing")

        frame.columnconfigure(1, weight=1)

        # === Limits Section ===
        row = 0
        ttk.Label(frame, text="Limits:", font=("", 10, "bold")).grid(
            row=row, column=0, columnspan=2, sticky="w", pady=(0, 10)
        )

        # Batch Size
        row += 1
        ttk.Label(frame, text="Batch Size:").grid(
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
        ttk.Label(limits_frame1, text="accounts per batch", foreground="gray").pack(
            side="left", padx=(10, 0)
        )

        # Max Clicks
        row += 1
        ttk.Label(frame, text="Max Invites:").grid(
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
        ttk.Label(limits_frame2, text="per account per run", foreground="gray").pack(
            side="left", padx=(10, 0)
        )

        # Daily Max Invites
        row += 1
        ttk.Label(frame, text="Daily Limit:").grid(
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
        ttk.Label(limits_frame3, text="max invites per day", foreground="gray").pack(
            side="left", padx=(10, 0)
        )

        # Separator
        row += 1
        ttk.Separator(frame, orient="horizontal").grid(
            row=row, column=0, columnspan=2, sticky="ew", pady=15
        )

        # === Timing Section ===
        row += 1
        ttk.Label(frame, text="Timing (seconds):", font=("", 10, "bold")).grid(
            row=row, column=0, columnspan=2, sticky="w", pady=(0, 10)
        )

        # Scroll Delay
        row += 1
        ttk.Label(frame, text="Scroll Delay:").grid(
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
        ttk.Label(scroll_frame, text="seconds", foreground="gray").pack(
            side="left", padx=(10, 0)
        )

        # Click Delay
        row += 1
        ttk.Label(frame, text="Click Delay:").grid(
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
        ttk.Label(click_frame, text="seconds", foreground="gray").pack(
            side="left", padx=(10, 0)
        )

        # Batch Rest
        row += 1
        ttk.Label(frame, text="Batch Rest:").grid(
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
        ttk.Label(rest_frame, text="seconds", foreground="gray").pack(
            side="left", padx=(10, 0)
        )

        # Max Retries
        row += 1
        ttk.Label(frame, text="Max Retries:").grid(
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
            text="Enable Proxy",
            variable=self.vars["use_proxy"]
        ).grid(row=row, column=0, columnspan=2, sticky="w", pady=8)

        # Fallback to Direct
        row += 1
        self.vars["proxy_fallback_to_direct"] = tk.BooleanVar(
            value=settings.proxy_fallback_to_direct
        )
        ttk.Checkbutton(
            frame,
            text="Fallback to Direct Connection (if proxy fails)",
            variable=self.vars["proxy_fallback_to_direct"]
        ).grid(row=row, column=0, columnspan=2, sticky="w", pady=8)

        # Separator
        row += 1
        ttk.Separator(frame, orient="horizontal").grid(
            row=row, column=0, columnspan=2, sticky="ew", pady=15
        )

        # Proxy Settings
        row += 1
        ttk.Label(frame, text="Proxy Settings:", font=("", 10, "bold")).grid(
            row=row, column=0, columnspan=2, sticky="w", pady=(0, 10)
        )

        # Test Timeout
        row += 1
        ttk.Label(frame, text="Test Timeout:").grid(
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
        ttk.Label(timeout_frame, text="seconds", foreground="gray").pack(
            side="left", padx=(10, 0)
        )

        # Max Threads
        row += 1
        ttk.Label(frame, text="Max Test Threads:").grid(
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
        ttk.Label(frame, text="Min Proxies Needed:").grid(
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
        ttk.Label(frame, text="Connection Retries:").grid(
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
        ttk.Label(frame, text="Max Runtime:").grid(
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
        ttk.Label(runtime_frame, text="seconds", foreground="gray").pack(
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
            title=f"Select {title}",
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
            title="Select Directory",
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
                    "Error",
                    "Scroll delay min cannot be greater than max",
                    parent=self.top
                )
                return

            if result["click_delay_min"] > result["click_delay_max"]:
                show_error(
                    "Error",
                    "Click delay min cannot be greater than max",
                    parent=self.top
                )
                return

            if result["batch_rest_min"] > result["batch_rest_max"]:
                show_error(
                    "Error",
                    "Batch rest min cannot be greater than max",
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
                    "Error",
                    "Failed to save settings to file",
                    parent=self.top
                )

        except ValueError as e:
            show_error(
                "Error",
                f"Invalid value: {e}",
                parent=self.top
            )

    def _on_reset(self) -> None:
        """Reset settings to defaults."""
        if not ask_yesno(
            "Confirm Reset",
            "Are you sure you want to reset all settings to defaults?",
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
        title: str = "Facebook Credentials"
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
            text="Credentials are stored encrypted on your local machine only.",
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
                text="Credentials already saved. Leave password empty to keep existing.",
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
            text="Clear Credentials",
            command=self._on_clear,
            width=15,
            bootstyle="danger-outline" if HAS_BOOTSTRAP else None
        ).pack(side="left")

        # Cancel and Save (right)
        ttk.Button(
            btn_frame,
            text="Cancel",
            command=self.top.destroy,
            width=10
        ).pack(side="right", padx=(5, 0))

        ttk.Button(
            btn_frame,
            text="Save",
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
            show_error("Error", "Email/Phone is required", parent=self.top)
            self.email_entry.focus_set()
            return

        # If no new password and no existing, require password
        if not password and not self.account.fb_password_enc:
            show_error("Error", "Password is required", parent=self.top)
            self.pass_entry.focus_set()
            return

        self.email = email
        self.password = password if password else None  # None means keep existing
        self.result_code = self.RESULT_SAVED
        self.top.destroy()

    def _on_clear(self) -> None:
        """Handle Clear Credentials button click."""
        if not ask_yesno(
            "Clear Credentials",
            "Are you sure you want to remove stored credentials for this account?",
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
        "success":        ("Login Successful",   "success",   ""),
        "2fa":            ("2FA / Checkpoint",   "warning",   ""),
        "wrong_pass":     ("Login Failed",       "danger",    ""),
        "timeout":        ("Login Timeout",      "secondary", ""),
        "error":          ("Login Error",        "danger",    ""),
        "no_credentials": ("No Credentials",     "warning",   ""),
        "chrome_failed":  ("Chrome Error",       "danger",    ""),
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
        self.top.title(f"Test Login - {account.display_name}")
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
            text=f"Account: {account.display_name}",
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
            text="Close",
            bootstyle="outline-secondary",
            command=self.top.destroy,
            width=12
        ).pack(side=RIGHT, padx=5)

        # Conditional: "Update Credentials" for wrong_pass / no_credentials
        if status in ("wrong_pass", "no_credentials") and on_set_credentials:
            ttk.Button(
                footer,
                text="Update Credentials",
                bootstyle="outline-warning",
                command=lambda: (self.top.destroy(), on_set_credentials()),
                width=18
            ).pack(side=RIGHT, padx=5)

        # Conditional: "Mark as Checkpoint" for 2fa
        if status == "2fa" and on_set_checkpoint:
            ttk.Button(
                footer,
                text="Mark as Checkpoint",
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
