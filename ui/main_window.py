"""
Main Window Module.

Refactored to use ttkbootstrap for a modern UI/UX.
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


class ScrollableFrame(ttk.Frame):
    """
    A scrollable frame container for dynamic content.
    """

    def __init__(self, container, **kwargs):
        super().__init__(container, **kwargs)

        # Create canvas and scrollbar
        self.canvas = ttk.Canvas(self, highlightthickness=0)
        self.scrollbar = ttk.Scrollbar(self, orient="vertical", command=self.canvas.yview)

        # Create inner frame
        self.scrollable_frame = ttk.Frame(self.canvas)
        self.scrollable_frame.bind(
            "<Configure>",
            lambda e: self.canvas.configure(scrollregion=self.canvas.bbox("all"))
        )

        # Create window in canvas
        self.canvas_window = self.canvas.create_window(
            (0, 0),
            window=self.scrollable_frame,
            anchor="nw"
        )

        # Configure canvas
        self.canvas.configure(yscrollcommand=self.scrollbar.set)

        # Bind resize
        self.canvas.bind("<Configure>", self._on_canvas_configure)
        self.canvas.bind_all("<MouseWheel>", self._on_mousewheel)

        # Pack widgets
        self.canvas.pack(side="left", fill="both", expand=True)
        self.scrollbar.pack(side="right", fill="y")

    def _on_canvas_configure(self, event):
        self.canvas.itemconfig(self.canvas_window, width=event.width)

    def _on_mousewheel(self, event):
        self.canvas.yview_scroll(int(-1 * (event.delta / 120)), "units")


class AccountCard(ttk.Labelframe):
    """
    Modern card display for a single account.
    """

    def __init__(self, parent, account: Account, on_double_click=None, on_open_browser=None, **kwargs):
        super().__init__(parent, text=f" {account.debugger_address} ", padding=10, **kwargs)
        self.account = account
        self.on_double_click = on_double_click
        self.on_open_browser = on_open_browser

        # Status & Proxy Row
        self.top_row = ttk.Frame(self)
        self.top_row.pack(fill=X, pady=(0, 5))

        self.status_var = tk.StringVar(value=account.status.value)
        self.status_badge = ttk.Label(
            self.top_row,
            textvariable=self.status_var,
            bootstyle="inverse-secondary",
            padding=(5, 2)
        )
        self.status_badge.pack(side=LEFT)

        proxy_txt = "Proxy: ON" if account.proxy else "No Proxy"
        self.proxy_lbl = ttk.Label(
            self.top_row,
            text=proxy_txt,
            font=("Helvetica", 8),
            foreground="gray"
        )
        self.proxy_lbl.pack(side=RIGHT)

        # Stats / Info Row
        self.info_row = ttk.Frame(self)
        self.info_row.pack(fill=X, pady=5)
        
        # Example stats placeholder
        self.stats_lbl = ttk.Label(self.info_row, text="Invites: 0/0", font=("Helvetica", 9))
        self.stats_lbl.pack(side=LEFT)

        # Actions Row
        self.action_row = ttk.Frame(self)
        self.action_row.pack(fill=X, pady=(5, 0))

        self.log_btn = ttk.Button(
            self.action_row,
            text="Log",
            bootstyle="outline-info",
            width=6,
            command=self._show_log
        )
        self.log_btn.pack(side=RIGHT)

        self.open_btn = ttk.Button(
            self.action_row,
            text="Open",
            bootstyle="outline-primary",
            width=6,
            command=self._open_browser
        )
        self.open_btn.pack(side=RIGHT, padx=5)

    def _open_browser(self):
        if self.on_open_browser:
            self.on_open_browser(self.account)

    def _show_log(self):
        # Placeholder for showing specific log
        pass

        # Bind events
        self.bind("<Double-Button-1>", self._on_double_click)
        for child in self.winfo_children():
            child.bind("<Double-Button-1>", self._on_double_click)

    def update_status(self, status: AccountStatus):
        self.status_var.set(status.value)

        # Map status to bootstyle colors (inverse style for badge appearance)
        style_map = {
            AccountStatus.IDLE: "inverse-secondary",
            AccountStatus.RUNNING: "inverse-primary",
            AccountStatus.OK: "inverse-success",
            AccountStatus.CHECKPOINT: "inverse-warning",
            AccountStatus.ERROR: "inverse-danger",
            AccountStatus.PROXY_DEAD: "inverse-danger",
        }
        self.status_badge.configure(bootstyle=style_map.get(status, "inverse-secondary"))

    def _on_double_click(self, event):
        if self.on_double_click:
            self.on_double_click(self.account)

    def _show_log(self):
        # Placeholder for showing specific log
        pass


class MainWindow:
    """
    Main application window using ttkbootstrap.
    """

    def __init__(self, view_model: MainViewModel):
        self.view_model = view_model
        
        # Initialize the main window with theme
        self.root = ttk.Window(themename=styles.THEME_NAME)
        self.root.title("FB Auto Invite v2.0")
        self.root.geometry("1100x750")
        self.root.minsize(900, 600)

        # State
        self.account_cards: Dict[str, AccountCard] = {}

        # Setup UI
        self._setup_ui()
        self._setup_callbacks()
        
        # Bind close
        self.root.protocol("WM_DELETE_WINDOW", self._on_close)
        
        # Start loops
        self._process_messages()

    def _setup_ui(self):
        """Create the main 2-column layout."""
        # Main container
        main_container = ttk.Frame(self.root)
        main_container.pack(fill=BOTH, expand=True)

        # Sidebar (Left)
        self._create_sidebar(main_container)

        # Content Area (Right)
        self._create_content_area(main_container)

        # Status Bar (Bottom)
        self._create_status_bar()

    def _create_sidebar(self, parent):
        sidebar = ttk.Frame(parent, padding=10, width=styles.SIDEBAR_WIDTH)
        sidebar.pack(side=LEFT, fill=Y)

        # Logo / Title
        title_lbl = ttk.Label(
            sidebar, 
            text="FB Auto Tool", 
            font=("Helvetica", 18, "bold"),
            bootstyle=PRIMARY
        )
        title_lbl.pack(pady=(10, 20))

        # Status Overview
        self.active_threads_var = tk.StringVar(value="Active Threads: 0")
        status_badge = ttk.Label(
            sidebar,
            textvariable=self.active_threads_var,
            bootstyle="inverse-info",
            padding=5,
            font=("Helvetica", 10, "bold")
        )
        status_badge.pack(fill=X, pady=(0, 20))

        # Main Controls
        control_grp = ttk.Labelframe(sidebar, text="Control Panel", padding=10)
        control_grp.pack(fill=X, pady=10)

        self.start_btn = ttk.Button(
            control_grp, text="START", bootstyle=SUCCESS, command=self._on_start, width=15
        )
        self.start_btn.pack(pady=5)
        ToolTip(self.start_btn, text="Start the automation task")

        self.stop_btn = ttk.Button(
            control_grp, text="STOP", bootstyle=DANGER, command=self._on_stop, state=DISABLED, width=15
        )
        self.stop_btn.pack(pady=5)
        ToolTip(self.stop_btn, text="Stop all running tasks")

        # Separator
        ttk.Separator(sidebar).pack(fill=X, pady=10)

        # Auto Loop Controls
        loop_grp = ttk.Labelframe(sidebar, text="Auto Loop", padding=10)
        loop_grp.pack(fill=X, pady=10)

        # Enable Auto Loop
        self.auto_loop_var = tk.BooleanVar(value=self.view_model.get_auto_loop_enabled())
        auto_loop_check = ttk.Checkbutton(
            loop_grp,
            text="Enable Auto Loop",
            variable=self.auto_loop_var,
            command=self._on_auto_loop_toggle,
            bootstyle="round-toggle"
        )
        auto_loop_check.pack(fill=X, pady=2)
        ToolTip(auto_loop_check, text="Run tasks automatically at intervals")

        # Interval Setting
        interval_frame = ttk.Frame(loop_grp)
        interval_frame.pack(fill=X, pady=5)
        ttk.Label(interval_frame, text="Interval:").pack(side=LEFT)
        self.loop_interval_var = tk.StringVar(value=str(self.view_model.get_auto_loop_interval()))
        interval_spin = ttk.Spinbox(
            interval_frame,
            from_=5, to=1440,
            textvariable=self.loop_interval_var,
            width=5
        )
        interval_spin.pack(side=LEFT, padx=5)
        ttk.Label(interval_frame, text="min").pack(side=LEFT)

        # Concurrent Browsers
        browsers_frame = ttk.Frame(loop_grp)
        browsers_frame.pack(fill=X, pady=5)
        ttk.Label(browsers_frame, text="Browsers:").pack(side=LEFT)
        self.concurrent_var = tk.StringVar(value=str(self.view_model.get_concurrent_browsers()))
        browsers_spin = ttk.Spinbox(
            browsers_frame,
            from_=1, to=10,
            textvariable=self.concurrent_var,
            width=5
        )
        browsers_spin.pack(side=LEFT, padx=5)
        ToolTip(browsers_spin, text="Number of Chrome browsers to run at once")

        # Start Auto Loop Button
        self.loop_btn = ttk.Button(
            loop_grp,
            text="START LOOP",
            bootstyle="outline-success",
            command=self._on_start_loop,
            width=15
        )
        self.loop_btn.pack(pady=5)
        ToolTip(self.loop_btn, text="Start auto-loop with configured interval")

        # Separator
        ttk.Separator(sidebar).pack(fill=X, pady=10)

        # Account Management
        acc_grp = ttk.Labelframe(sidebar, text="Accounts", padding=10)
        acc_grp.pack(fill=X, pady=10)

        ttk.Button(acc_grp, text="Add Account", bootstyle=OUTLINE, command=self._on_add_account).pack(fill=X, pady=2)
        ttk.Button(acc_grp, text="Import/Load", bootstyle=OUTLINE, command=self._on_load_accounts).pack(fill=X, pady=2)
        ttk.Button(acc_grp, text="Save Accounts", bootstyle=OUTLINE, command=self._on_save_accounts).pack(fill=X, pady=2)

        # Settings
        ttk.Separator(sidebar).pack(fill=X, pady=10)
        ttk.Button(sidebar, text="Global Settings", bootstyle="link", command=self._on_open_settings).pack(pady=5)
        
    def _create_content_area(self, parent):
        content_frame = ttk.Frame(parent, padding=10)
        content_frame.pack(side=LEFT, fill=BOTH, expand=True)

        # Top Bar: Action Config
        self._create_top_bar(content_frame)

        # Tabs
        self.notebook = ttk.Notebook(content_frame)
        self.notebook.pack(fill=BOTH, expand=True, pady=10)

        self._create_monitor_tab()
        self._create_accounts_tab()
        self._create_logs_tab()

    def _create_top_bar(self, parent):
        bar = ttk.Labelframe(parent, text="Task Configuration", padding=10)
        bar.pack(fill=X)

        # Action Selector
        row1 = ttk.Frame(bar)
        row1.pack(fill=X, pady=5)
        
        ttk.Label(row1, text="Action Mode:").pack(side=LEFT, padx=5)
        self.action_var = tk.StringVar(value="Invite Friends")
        self.action_combo = ttk.Combobox(
            row1, 
            textvariable=self.action_var,
            values=[label for _, label in self.view_model.get_action_types()],
            state="readonly", 
            width=20
        )
        self.action_combo.pack(side=LEFT, padx=5)
        self.action_combo.bind("<<ComboboxSelected>>", self._on_action_change)

        # Dynamic Inputs Area
        self.task_input_frame = ttk.Frame(bar)
        self.task_input_frame.pack(fill=X, pady=5)

        # Initial render
        self._update_task_inputs(ActionType.INVITE)

    def _update_task_inputs(self, action: ActionType):
        # Clear previous widgets
        for widget in self.task_input_frame.winfo_children():
            widget.destroy()
        
        row = ttk.Frame(self.task_input_frame)
        row.pack(fill=X)

        if action == ActionType.INVITE:
            ttk.Label(row, text="Group URL:").pack(side=LEFT, padx=5)
            self.task_url_var = tk.StringVar()
            entry = ttk.Entry(row, textvariable=self.task_url_var)
            entry.pack(side=LEFT, fill=X, expand=True, padx=5)
            
            # Additional hint
            hint = ttk.Label(self.task_input_frame, text="Navigate to Group > Members page", bootstyle="secondary", font=("Helvetica", 8))
            hint.pack(anchor=W, padx=80)
            
        elif action in [ActionType.POST_GROUP, ActionType.POST_WALL]:
            if action == ActionType.POST_GROUP:
                ttk.Label(row, text="Group URL:").pack(side=LEFT, padx=5)
                self.task_url_var = tk.StringVar()
                ttk.Entry(row, textvariable=self.task_url_var).pack(side=LEFT, fill=X, expand=True, padx=5)
            
            # Content Area
            content_row = ttk.Frame(self.task_input_frame)
            content_row.pack(fill=X, pady=5)
            ttk.Label(content_row, text="Content:").pack(side=LEFT, anchor=N, padx=5)
            self.task_content_text = ScrolledText(content_row, height=3, width=50)
            self.task_content_text.pack(side=LEFT, fill=X, expand=True, padx=5)

    def _create_monitor_tab(self):
        self.monitor_frame = ttk.Frame(self.notebook)
        self.notebook.add(self.monitor_frame, text="Live Monitor")
        
        # Scrollable container for cards
        self.cards_scroll = ScrollableFrame(self.monitor_frame)
        self.cards_scroll.pack(fill=BOTH, expand=True)
        
        # Grid container inside the scrollable frame
        self.cards_grid = self.cards_scroll.scrollable_frame

    def _create_accounts_tab(self):
        frame = ttk.Frame(self.notebook)
        self.notebook.add(frame, text="Accounts Manager")

        # Toolbar
        tools = ttk.Frame(frame, padding=5)
        tools.pack(fill=X)
        ttk.Button(tools, text="Refresh List", command=self._refresh_account_list, bootstyle=OUTLINE).pack(side=LEFT)
        ttk.Button(tools, text="Check Proxies", command=self._on_build_proxies, bootstyle=OUTLINE).pack(side=LEFT, padx=5)

        # Table
        cols = ("address", "status", "proxy", "invites")
        self.acc_tree = ttk.Treeview(frame, columns=cols, show="headings")
        self.acc_tree.heading("address", text="Debugger Address")
        self.acc_tree.heading("status", text="Status")
        self.acc_tree.heading("proxy", text="Proxy")
        self.acc_tree.heading("invites", text="Invites")

        self.acc_tree.column("address", width=200)
        self.acc_tree.column("status", width=100)
        self.acc_tree.column("proxy", width=150)
        self.acc_tree.column("invites", width=80)
        
        self.acc_tree.pack(fill=BOTH, expand=True, padx=5, pady=5)

    def _create_logs_tab(self):
        frame = ttk.Frame(self.notebook)
        self.notebook.add(frame, text="Global Logs")
        self.log_text = ScrolledText(frame, height=10)
        self.log_text.pack(fill=BOTH, expand=True)
        # Disable the underlying text widget
        text_widget = self.log_text.text if hasattr(self.log_text, 'text') else self.log_text
        text_widget.configure(state=DISABLED)

    def _create_status_bar(self):
        status = ttk.Frame(self.root, bootstyle=LIGHT)
        status.pack(fill=X, side=BOTTOM)
        
        self.status_lbl = ttk.Label(status, text="Ready", bootstyle="inverse-light", padding=5)
        self.status_lbl.pack(side=LEFT)

        ver = ttk.Label(status, text="v2.0.0", bootstyle="inverse-light", padding=5)
        ver.pack(side=RIGHT)

    # -------------------------------------------------------------------------
    # Logic & Callbacks
    # -------------------------------------------------------------------------

    def _setup_callbacks(self):
        self.view_model.set_ui_callbacks(
            on_log=self._log_message,
            on_status_change=self._on_status_change,
            on_account_update=self._update_account_status
        )

    def _on_start(self):
        # Validate inputs
        action_str = self.action_var.get().upper().replace(" ", "_")
        try:
            action = ActionType[action_str]
        except KeyError:
            action = ActionType.INVITE

        self.view_model.set_current_action(action)

        url = ""
        # Get URL if needed
        if hasattr(self, 'task_url_var'):
            url = self.task_url_var.get().strip()
            self.view_model.set_task_target_url(url)
            
        # Get Content if needed
        if hasattr(self, 'task_content_text'):
             # ScrolledText needs '1.0' to 'end-1c'
            content = self.task_content_text.get('1.0', 'end-1c').strip()
            self.view_model.set_task_content(content)
        
        if self.view_model.start_run():
            self.start_btn.configure(state=DISABLED)
            self.stop_btn.configure(state=NORMAL)
        else:
            Messagebox.show_error("Could not start run. Check logs.", "Start Failed")

    def _on_stop(self):
        self.view_model.stop_run()
        self.start_btn.configure(state=NORMAL)
        self.stop_btn.configure(state=DISABLED)

    def _log_message(self, message: str):
        # ScrolledText from ttkbootstrap uses .text for the underlying Text widget
        text_widget = self.log_text.text if hasattr(self.log_text, 'text') else self.log_text
        text_widget.configure(state=NORMAL)
        text_widget.insert(END, message + "\n")
        text_widget.see(END)
        text_widget.configure(state=DISABLED)
        
    def _on_status_change(self, status: str):
        self.status_lbl.configure(text=status)

    def _update_account_status(self, account: Account):
        # Update Card
        if account.debugger_address in self.account_cards:
            self.account_cards[account.debugger_address].update_status(account.status)
            
        # Update Treeview if needed (simplified refresh for now)
        # In a real app, you'd update specific item
        pass

    def _on_add_account(self):
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
            self._log_message(f"Added account: {account.debugger_address}")

    def _on_load_accounts(self):
        self.view_model.load_accounts()
        self._refresh_account_list()
        self._refresh_monitor_grid()
        
    def _on_save_accounts(self):
        if self.view_model.save_accounts():
            Messagebox.show_info("Saved", "Accounts saved successfully.")
        else:
            Messagebox.show_error("Error saving accounts", "Save Failed")

    def _on_open_settings(self):
        dialog = SettingsDialog(self.root)
        self.root.wait_window(dialog.top)

        if dialog.result:
            # Update view model with new settings
            self.view_model.set_use_proxy(settings.use_proxy)
            self.view_model.set_batch_size(settings.batch_size)
            self.view_model.set_max_clicks(settings.max_clicks)
            self.view_model.set_scroll_delay(
                settings.scroll_pause_min,
                settings.scroll_pause_max
            )
            self._log_message("Settings saved and applied")
        
    def _refresh_account_list(self):
        # Clear tree
        for item in self.acc_tree.get_children():
            self.acc_tree.delete(item)

        for acc in self.view_model.get_accounts():
            self.acc_tree.insert("", END, values=(
                acc.debugger_address,
                acc.status.value,
                acc.proxy.address if acc.proxy else "N/A",
                acc.invites_sent
            ))

    def _on_open_browser_click(self, account: Account):
        self.view_model.open_browser_for_account(account)

    def _refresh_monitor_grid(self):
        # Clear specific widgets
        for w in self.cards_grid.winfo_children():
            w.destroy()
        self.account_cards.clear()

        # Re-populate
        row, col = 0, 0
        cols_per_row = 3

        for acc in self.view_model.get_accounts():
            card = AccountCard(
                self.cards_grid,
                acc,
                on_double_click=self._on_edit_account,  # Reusing edit logic for double click if needed or implement specific
                on_open_browser=self._on_open_browser_click
            )
            card.grid(row=row, column=col, padx=5, pady=5, sticky="nsew")
            self.account_cards[acc.debugger_address] = card

            col += 1
            if col >= cols_per_row:
                col = 0
                row += 1

    def _on_action_change(self, event):
        val = self.action_var.get()
        try:
            enum_name = val.upper().replace(" ", "_")
            if hasattr(ActionType, enum_name):
                action = ActionType[enum_name]
                self._update_task_inputs(action)
        except:
            pass
            
    def _on_build_proxies(self):
        # Proxy build stub
        self.view_model.build_proxies()
        
    def _on_delete_accounts(self):
        pass

    def _on_edit_account(self, *args):
        pass

    def _on_proxy_toggle(self):
        pass

    def _on_apply_settings(self):
        pass

    def _on_auto_loop_toggle(self):
        """Handle auto loop enable/disable toggle."""
        enabled = self.auto_loop_var.get()
        self.view_model.set_auto_loop_enabled(enabled)
        self._log_message(f"Auto Loop {'enabled' if enabled else 'disabled'}")

    def _on_start_loop(self):
        """Start or stop the auto loop."""
        # Check if loop is already running
        if hasattr(self, '_loop_running') and self._loop_running:
            # Stop the loop
            self.view_model.stop_run()
            self._loop_running = False
            self.loop_btn.configure(text="START LOOP", bootstyle="outline-success")
            self.start_btn.configure(state=NORMAL)
            self.stop_btn.configure(state=DISABLED)
            self._log_message("Auto Loop stopped")
            return

        # Validate inputs
        action_str = self.action_var.get().upper().replace(" ", "_")
        try:
            action = ActionType[action_str]
        except KeyError:
            action = ActionType.INVITE

        self.view_model.set_current_action(action)

        # Get URL if needed
        if hasattr(self, 'task_url_var'):
            url = self.task_url_var.get().strip()
            self.view_model.set_task_target_url(url)

        # Get Content if needed
        if hasattr(self, 'task_content_text'):
            content = self.task_content_text.get('1.0', 'end-1c').strip()
            self.view_model.set_task_content(content)

        # Update settings from spinboxes
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

        # Ensure auto loop is enabled when clicking start
        self.auto_loop_var.set(True)
        self.view_model.set_auto_loop_enabled(True)

        # Start the auto loop
        if self.view_model.start_auto_loop():
            self._loop_running = True
            self.loop_btn.configure(text="STOP LOOP", bootstyle="outline-danger")
            self.start_btn.configure(state=DISABLED)
            self.stop_btn.configure(state=DISABLED)
            self._log_message(f"Auto Loop started (interval: {interval} min, browsers: {concurrent})")
        else:
            Messagebox.show_error("Could not start auto loop. Check logs.", "Start Failed")

    def _process_messages(self):
        # Process Queue
        try:
            while not self.view_model.message_queue.empty():
                try:
                    # ViewModel puts tuples: (type, data)
                    msg_type, data = self.view_model.message_queue.get_nowait()

                    if msg_type == "log":
                        self._log_message(data)
                    elif msg_type == "status":
                        self._on_status_change(data)
                    elif msg_type == "account_update":
                        self._update_account_status(data)
                    elif msg_type == "run_complete":
                        self.start_btn.configure(state=NORMAL)
                        self.stop_btn.configure(state=DISABLED)
                        Messagebox.show_info("Run Complete", "The batch run has finished.")
                    elif msg_type == "loop_iteration":
                        # A single loop iteration completed, update UI
                        run_num, next_run_time = data if isinstance(data, tuple) else (data, None)
                        self._log_message(f"Loop iteration {run_num} complete. Next run at {next_run_time}" if next_run_time else f"Loop iteration {run_num} complete")
                    elif msg_type == "loop_complete":
                        # All loop iterations done
                        self._loop_running = False
                        self.loop_btn.configure(text="START LOOP", bootstyle="outline-success")
                        self.start_btn.configure(state=NORMAL)
                        self._log_message("Auto Loop completed all iterations")
                        Messagebox.show_info("Loop Complete", "Auto loop has finished all runs.")
                except:
                    break
        except:
            pass
        self.root.after(100, self._process_messages)

    def _on_close(self):
        self._on_stop()
        self.root.destroy()

    def run(self):
        self.root.mainloop()
