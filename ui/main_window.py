"""
Main Window Module.

Tkinter-based main application window with account panels, dashboard, and global logging.
"""

import tkinter as tk
from tkinter import ttk, scrolledtext, messagebox
from typing import Dict, List, Optional

from app.database import db
from app.models import Account, AccountStatus, ActionType, BatchResult
from app.scheduler import scheduler
from ui.view_models import MainViewModel


class ScrollableFrame(ttk.Frame):
    """
    A scrollable frame container for dynamic content.

    Provides a canvas with a vertical scrollbar that can contain
    any number of child widgets.
    """

    def __init__(self, container: tk.Widget, **kwargs) -> None:
        """
        Initialize ScrollableFrame.

        Args:
            container: Parent widget.
            **kwargs: Additional frame options.
        """
        super().__init__(container, **kwargs)

        # Create canvas and scrollbar
        self.canvas = tk.Canvas(self, highlightthickness=0)
        scrollbar = ttk.Scrollbar(self, orient="vertical", command=self.canvas.yview)

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
        self.canvas.configure(yscrollcommand=scrollbar.set)

        # Bind resize
        self.canvas.bind("<Configure>", self._on_canvas_configure)

        # Mouse wheel scrolling
        self.canvas.bind_all("<MouseWheel>", self._on_mousewheel)

        # Pack widgets
        self.canvas.pack(side="left", fill="both", expand=True)
        scrollbar.pack(side="right", fill="y")

    def _on_canvas_configure(self, event: tk.Event) -> None:
        """Handle canvas resize."""
        self.canvas.itemconfig(self.canvas_window, width=event.width)

    def _on_mousewheel(self, event: tk.Event) -> None:
        """Handle mouse wheel scrolling."""
        self.canvas.yview_scroll(int(-1 * (event.delta / 120)), "units")


class AccountPanel(ttk.LabelFrame):
    """
    Panel displaying a single account's status and log.

    Shows account address, status indicator, and scrollable log text.
    """

    def __init__(
        self,
        parent: tk.Widget,
        account: Account,
        **kwargs
    ) -> None:
        """
        Initialize AccountPanel.

        Args:
            parent: Parent widget.
            account: Account to display.
            **kwargs: Additional LabelFrame options.
        """
        super().__init__(parent, text=account.debugger_address, **kwargs)

        self.account = account

        # Status label
        self.status_var = tk.StringVar(value=account.status.value)
        self.status_label = ttk.Label(
            self,
            textvariable=self.status_var,
            width=15
        )
        self.status_label.pack(anchor="w", padx=5, pady=2)

        # URL entry
        url_frame = ttk.Frame(self)
        url_frame.pack(fill="x", padx=5, pady=2)

        ttk.Label(url_frame, text="URL:").pack(side="left")
        self.url_var = tk.StringVar(value=account.group_url or "")
        self.url_entry = ttk.Entry(url_frame, textvariable=self.url_var, width=50)
        self.url_entry.pack(side="left", fill="x", expand=True, padx=5)

        # Log text area
        self.log_text = scrolledtext.ScrolledText(
            self,
            height=6,
            width=60,
            wrap=tk.WORD,
            state=tk.DISABLED
        )
        self.log_text.pack(fill="both", expand=True, padx=5, pady=5)

    def log(self, message: str) -> None:
        """
        Add a log message to the panel.

        Args:
            message: Message to log.
        """
        self.log_text.configure(state=tk.NORMAL)
        self.log_text.insert(tk.END, message + "\n")
        self.log_text.see(tk.END)
        self.log_text.configure(state=tk.DISABLED)

    def update_status(self, status: AccountStatus) -> None:
        """
        Update the status display.

        Args:
            status: New status.
        """
        self.status_var.set(status.value)

        # Color coding
        colors = {
            AccountStatus.IDLE: "gray",
            AccountStatus.RUNNING: "blue",
            AccountStatus.OK: "green",
            AccountStatus.CHECKPOINT: "orange",
            AccountStatus.ERROR: "red",
            AccountStatus.PROXY_DEAD: "red",
        }
        self.status_label.configure(foreground=colors.get(status, "black"))

    def get_url(self) -> str:
        """Get the current URL value."""
        return self.url_var.get().strip()

    def clear_log(self) -> None:
        """Clear the log text."""
        self.log_text.configure(state=tk.NORMAL)
        self.log_text.delete("1.0", tk.END)
        self.log_text.configure(state=tk.DISABLED)


class MainWindow:
    """
    Main application window.

    Provides the primary user interface with account management,
    global logging, and control buttons.
    """

    def __init__(self, view_model: MainViewModel) -> None:
        """
        Initialize MainWindow.

        Args:
            view_model: MainViewModel instance.
        """
        self.view_model = view_model
        self.account_panels: Dict[str, AccountPanel] = {}

        # Create main window
        self.root = tk.Tk()
        self.root.title("FB Auto Invite v2.0")
        self.root.geometry("900x700")
        self.root.minsize(800, 600)

        # Configure grid
        self.root.columnconfigure(0, weight=1)
        self.root.rowconfigure(1, weight=1)

        # Create UI components
        self._create_toolbar()
        self._create_main_area()
        self._create_status_bar()

        # Setup callbacks
        self._setup_callbacks()

        # Bind close event
        self.root.protocol("WM_DELETE_WINDOW", self._on_close)

        # Start message processing
        self._process_messages()

    def _create_toolbar(self) -> None:
        """Create the toolbar with control buttons, action selector, and settings."""
        # Main control frame
        control_frame = ttk.Frame(self.root)
        control_frame.grid(row=0, column=0, sticky="ew", padx=5, pady=5)

        # Left side - Action buttons
        toolbar = ttk.LabelFrame(control_frame, text="Controls")
        toolbar.pack(side="left", fill="y", padx=2)

        # Start button
        self.start_btn = ttk.Button(
            toolbar,
            text="Start",
            command=self._on_start
        )
        self.start_btn.pack(side="left", padx=2, pady=2)

        # Stop button
        self.stop_btn = ttk.Button(
            toolbar,
            text="Stop",
            command=self._on_stop,
            state=tk.DISABLED
        )
        self.stop_btn.pack(side="left", padx=2, pady=2)

        ttk.Separator(toolbar, orient="vertical").pack(side="left", fill="y", padx=5)

        # Build Proxies button
        self.proxy_btn = ttk.Button(
            toolbar,
            text="Build Proxies",
            command=self._on_build_proxies
        )
        self.proxy_btn.pack(side="left", padx=2, pady=2)

        # Load Accounts button
        self.load_btn = ttk.Button(
            toolbar,
            text="Load",
            command=self._on_load_accounts
        )
        self.load_btn.pack(side="left", padx=2, pady=2)

        # Save Accounts button
        self.save_btn = ttk.Button(
            toolbar,
            text="Save",
            command=self._on_save_accounts
        )
        self.save_btn.pack(side="left", padx=2, pady=2)

        ttk.Separator(toolbar, orient="vertical").pack(side="left", fill="y", padx=5)

        # Add Account button
        self.add_btn = ttk.Button(
            toolbar,
            text="+ Add",
            command=self._on_add_account
        )
        self.add_btn.pack(side="left", padx=2, pady=2)

        # Action selector panel
        action_frame = ttk.LabelFrame(control_frame, text="Action Mode")
        action_frame.pack(side="left", fill="y", padx=10)

        # Action type combobox
        ttk.Label(action_frame, text="Mode:").pack(side="left", padx=2)
        self.action_var = tk.StringVar(value="Invite Friends")
        self.action_combo = ttk.Combobox(
            action_frame,
            textvariable=self.action_var,
            values=[label for _, label in self.view_model.get_action_types()],
            state="readonly",
            width=15
        )
        self.action_combo.pack(side="left", padx=2, pady=2)
        self.action_combo.bind("<<ComboboxSelected>>", self._on_action_change)

        # Right side - Settings panel
        settings_frame = ttk.LabelFrame(control_frame, text="Settings")
        settings_frame.pack(side="left", fill="y", padx=10)

        # Proxy toggle
        self.use_proxy_var = tk.BooleanVar(value=self.view_model.get_use_proxy())
        proxy_check = ttk.Checkbutton(
            settings_frame,
            text="Enable Proxy",
            variable=self.use_proxy_var,
            command=self._on_proxy_toggle
        )
        proxy_check.pack(side="left", padx=5, pady=2)

        ttk.Separator(settings_frame, orient="vertical").pack(side="left", fill="y", padx=5)

        # Batch size
        ttk.Label(settings_frame, text="Batch:").pack(side="left", padx=2)
        self.batch_size_var = tk.StringVar(value=str(self.view_model.get_batch_size()))
        batch_spin = ttk.Spinbox(
            settings_frame,
            from_=1,
            to=20,
            width=4,
            textvariable=self.batch_size_var
        )
        batch_spin.pack(side="left", padx=2, pady=2)

        ttk.Separator(settings_frame, orient="vertical").pack(side="left", fill="y", padx=5)

        # Max clicks
        ttk.Label(settings_frame, text="Max Invites:").pack(side="left", padx=2)
        self.max_clicks_var = tk.StringVar(value=str(self.view_model.get_max_clicks()))
        clicks_spin = ttk.Spinbox(
            settings_frame,
            from_=1,
            to=200,
            width=5,
            textvariable=self.max_clicks_var
        )
        clicks_spin.pack(side="left", padx=2, pady=2)

        ttk.Separator(settings_frame, orient="vertical").pack(side="left", fill="y", padx=5)

        # Scroll delay
        scroll_min, scroll_max = self.view_model.get_scroll_delay()
        ttk.Label(settings_frame, text="Scroll Delay:").pack(side="left", padx=2)
        self.scroll_min_var = tk.StringVar(value=str(scroll_min))
        scroll_min_entry = ttk.Entry(settings_frame, textvariable=self.scroll_min_var, width=4)
        scroll_min_entry.pack(side="left", padx=1, pady=2)
        ttk.Label(settings_frame, text="-").pack(side="left")
        self.scroll_max_var = tk.StringVar(value=str(scroll_max))
        scroll_max_entry = ttk.Entry(settings_frame, textvariable=self.scroll_max_var, width=4)
        scroll_max_entry.pack(side="left", padx=1, pady=2)
        ttk.Label(settings_frame, text="s").pack(side="left", padx=2)

        ttk.Separator(settings_frame, orient="vertical").pack(side="left", fill="y", padx=5)

        # Apply button
        apply_btn = ttk.Button(
            settings_frame,
            text="Apply",
            command=self._on_apply_settings
        )
        apply_btn.pack(side="left", padx=5, pady=2)

    def _create_main_area(self) -> None:
        """Create the main content area with tabs for Dashboard, Task, Accounts, and Log."""
        # Create notebook for tabs
        self.notebook = ttk.Notebook(self.root)
        self.notebook.grid(row=1, column=0, sticky="nsew", padx=5, pady=5)

        # Dashboard tab
        self._create_dashboard_tab()

        # Task Configuration tab
        self._create_task_tab()

        # Accounts tab
        self._create_accounts_tab()

        # Log tab
        self._create_log_tab()

    def _create_dashboard_tab(self) -> None:
        """Create the Dashboard tab with statistics."""
        dashboard_frame = ttk.Frame(self.notebook)
        self.notebook.add(dashboard_frame, text="Dashboard")

        # Configure grid
        dashboard_frame.columnconfigure(0, weight=1)
        dashboard_frame.columnconfigure(1, weight=1)

        # Statistics cards row
        cards_frame = ttk.Frame(dashboard_frame)
        cards_frame.grid(row=0, column=0, columnspan=2, sticky="ew", padx=10, pady=10)

        # Today's Stats Card
        today_card = ttk.LabelFrame(cards_frame, text="Today")
        today_card.pack(side="left", fill="both", expand=True, padx=5)

        self.today_invites_var = tk.StringVar(value="0")
        ttk.Label(today_card, text="Invites Sent:", font=("", 10)).pack(anchor="w", padx=10, pady=2)
        ttk.Label(today_card, textvariable=self.today_invites_var, font=("", 18, "bold")).pack(anchor="w", padx=10)

        # Total Stats Card
        total_card = ttk.LabelFrame(cards_frame, text="All Time")
        total_card.pack(side="left", fill="both", expand=True, padx=5)

        self.total_invites_var = tk.StringVar(value="0")
        ttk.Label(total_card, text="Total Invites:", font=("", 10)).pack(anchor="w", padx=10, pady=2)
        ttk.Label(total_card, textvariable=self.total_invites_var, font=("", 18, "bold")).pack(anchor="w", padx=10)

        self.total_accounts_var = tk.StringVar(value="0")
        ttk.Label(total_card, text="Accounts Used:", font=("", 10)).pack(anchor="w", padx=10, pady=2)
        ttk.Label(total_card, textvariable=self.total_accounts_var, font=("", 14)).pack(anchor="w", padx=10)

        # Errors Card
        errors_card = ttk.LabelFrame(cards_frame, text="Issues")
        errors_card.pack(side="left", fill="both", expand=True, padx=5)

        self.checkpoints_var = tk.StringVar(value="0")
        ttk.Label(errors_card, text="Checkpoints:", font=("", 10)).pack(anchor="w", padx=10, pady=2)
        ttk.Label(errors_card, textvariable=self.checkpoints_var, font=("", 18, "bold"), foreground="red").pack(anchor="w", padx=10)

        # Scheduler Status Card
        scheduler_card = ttk.LabelFrame(cards_frame, text="Scheduler")
        scheduler_card.pack(side="left", fill="both", expand=True, padx=5)

        self.scheduler_status_var = tk.StringVar(value="Disabled")
        ttk.Label(scheduler_card, text="Status:", font=("", 10)).pack(anchor="w", padx=10, pady=2)
        ttk.Label(scheduler_card, textvariable=self.scheduler_status_var, font=("", 12)).pack(anchor="w", padx=10)

        # Weekly Stats Table
        weekly_frame = ttk.LabelFrame(dashboard_frame, text="Weekly Statistics")
        weekly_frame.grid(row=1, column=0, sticky="nsew", padx=10, pady=10)

        # Create treeview for weekly stats
        columns = ("date", "invites", "accounts", "errors")
        self.weekly_tree = ttk.Treeview(weekly_frame, columns=columns, show="headings", height=7)
        self.weekly_tree.heading("date", text="Date")
        self.weekly_tree.heading("invites", text="Invites")
        self.weekly_tree.heading("accounts", text="Accounts")
        self.weekly_tree.heading("errors", text="Errors")

        self.weekly_tree.column("date", width=100)
        self.weekly_tree.column("invites", width=80)
        self.weekly_tree.column("accounts", width=80)
        self.weekly_tree.column("errors", width=80)

        self.weekly_tree.pack(fill="both", expand=True, padx=5, pady=5)

        # Proxy Status
        proxy_frame = ttk.LabelFrame(dashboard_frame, text="Proxy Status")
        proxy_frame.grid(row=1, column=1, sticky="nsew", padx=10, pady=10)

        self.proxy_status_var = tk.StringVar(value="Not checked")
        ttk.Label(proxy_frame, text="Pool Status:", font=("", 10)).pack(anchor="w", padx=10, pady=5)
        ttk.Label(proxy_frame, textvariable=self.proxy_status_var, font=("", 12)).pack(anchor="w", padx=10)

        self.proxy_count_var = tk.StringVar(value="0 alive")
        ttk.Label(proxy_frame, text="Proxies:", font=("", 10)).pack(anchor="w", padx=10, pady=5)
        ttk.Label(proxy_frame, textvariable=self.proxy_count_var, font=("", 14, "bold")).pack(anchor="w", padx=10)

        # Refresh button
        ttk.Button(
            proxy_frame,
            text="Refresh Dashboard",
            command=self._refresh_dashboard
        ).pack(anchor="w", padx=10, pady=10)

    def _create_task_tab(self) -> None:
        """Create the Task Configuration tab with dynamic inputs."""
        task_frame = ttk.Frame(self.notebook)
        self.notebook.add(task_frame, text="Task Config")

        # Configure grid
        task_frame.columnconfigure(1, weight=1)

        # Action type display
        row = 0
        ttk.Label(task_frame, text="Current Action:", font=("", 11, "bold")).grid(
            row=row, column=0, sticky="w", padx=20, pady=10
        )
        self.task_action_label = ttk.Label(
            task_frame,
            text="Invite Friends",
            font=("", 11)
        )
        self.task_action_label.grid(row=row, column=1, sticky="w", padx=10, pady=10)

        # Separator
        row += 1
        ttk.Separator(task_frame, orient="horizontal").grid(
            row=row, column=0, columnspan=2, sticky="ew", padx=20, pady=10
        )

        # Target URL input
        row += 1
        self.url_label = ttk.Label(task_frame, text="Group URL:")
        self.url_label.grid(row=row, column=0, sticky="nw", padx=20, pady=5)

        self.task_url_var = tk.StringVar()
        self.task_url_entry = ttk.Entry(
            task_frame,
            textvariable=self.task_url_var,
            width=60
        )
        self.task_url_entry.grid(row=row, column=1, sticky="ew", padx=10, pady=5)

        # Hint label for URL
        row += 1
        self.url_hint_label = ttk.Label(
            task_frame,
            text="Enter the Facebook group URL to invite friends from",
            font=("", 9),
            foreground="gray"
        )
        self.url_hint_label.grid(row=row, column=1, sticky="w", padx=10)

        # Content input (for Post/Comment)
        row += 1
        self.content_label = ttk.Label(task_frame, text="Content:")
        self.content_label.grid(row=row, column=0, sticky="nw", padx=20, pady=5)

        self.task_content_text = scrolledtext.ScrolledText(
            task_frame,
            height=8,
            width=60,
            wrap=tk.WORD
        )
        self.task_content_text.grid(row=row, column=1, sticky="ew", padx=10, pady=5)

        # Hint label for content
        row += 1
        self.content_hint_label = ttk.Label(
            task_frame,
            text="",
            font=("", 9),
            foreground="gray"
        )
        self.content_hint_label.grid(row=row, column=1, sticky="w", padx=10)

        # Max count input
        row += 1
        ttk.Label(task_frame, text="Max Actions:").grid(
            row=row, column=0, sticky="w", padx=20, pady=10
        )
        self.task_max_var = tk.StringVar(value="50")
        max_spin = ttk.Spinbox(
            task_frame,
            from_=1,
            to=200,
            width=10,
            textvariable=self.task_max_var
        )
        max_spin.grid(row=row, column=1, sticky="w", padx=10, pady=10)

        # Separator
        row += 1
        ttk.Separator(task_frame, orient="horizontal").grid(
            row=row, column=0, columnspan=2, sticky="ew", padx=20, pady=10
        )

        # Instructions
        row += 1
        instructions_frame = ttk.LabelFrame(task_frame, text="Instructions")
        instructions_frame.grid(row=row, column=0, columnspan=2, sticky="ew", padx=20, pady=10)

        self.instructions_text = tk.Text(
            instructions_frame,
            height=6,
            width=80,
            wrap=tk.WORD,
            state=tk.DISABLED,
            bg="#f5f5f5"
        )
        self.instructions_text.pack(fill="both", expand=True, padx=10, pady=10)

        # Initialize with default action
        self._update_task_inputs(ActionType.INVITE)

    def _update_task_inputs(self, action: ActionType) -> None:
        """Update task input fields based on selected action."""
        self.task_action_label.config(text=action.value.replace("_", " ").title())

        # Define input requirements for each action
        action_configs = {
            ActionType.INVITE: {
                "url_label": "Group URL:",
                "url_hint": "Enter the Facebook group members page URL",
                "show_url": True,
                "show_content": False,
                "instructions": (
                    "INVITE FRIENDS MODE\n\n"
                    "1. Enter the URL of a Facebook group's members page\n"
                    "2. The bot will scroll through and click 'Add Friend' buttons\n"
                    "3. Set Max Actions to limit invites per account\n\n"
                    "Example URL: https://www.facebook.com/groups/123456/members"
                )
            },
            ActionType.POST_WALL: {
                "url_label": "Not needed",
                "url_hint": "",
                "show_url": False,
                "show_content": True,
                "content_hint": "Enter the text you want to post on your wall",
                "instructions": (
                    "POST TO WALL MODE\n\n"
                    "1. Enter the content you want to post\n"
                    "2. The bot will post to your Facebook profile/wall\n"
                    "3. Each account will create one post"
                )
            },
            ActionType.POST_GROUP: {
                "url_label": "Group URL:",
                "url_hint": "Enter the Facebook group URL to post to",
                "show_url": True,
                "show_content": True,
                "content_hint": "Enter the content to post in the group",
                "instructions": (
                    "POST TO GROUP MODE\n\n"
                    "1. Enter the Facebook group URL\n"
                    "2. Enter the content you want to post\n"
                    "3. The bot will create a post in the group\n\n"
                    "Example URL: https://www.facebook.com/groups/123456"
                )
            },
            ActionType.SHARE: {
                "url_label": "Post URL:",
                "url_hint": "Enter the Facebook post URL to share",
                "show_url": True,
                "show_content": False,
                "instructions": (
                    "SHARE POST MODE\n\n"
                    "1. Enter the URL of the post you want to share\n"
                    "2. The bot will share the post to your timeline\n"
                    "3. One share per account\n\n"
                    "Example URL: https://www.facebook.com/user/posts/123456"
                )
            },
            ActionType.COMMENT: {
                "url_label": "Post URL:",
                "url_hint": "Enter the Facebook post URL to comment on",
                "show_url": True,
                "show_content": True,
                "content_hint": "Enter the comment text",
                "instructions": (
                    "COMMENT ON POST MODE\n\n"
                    "1. Enter the URL of the post\n"
                    "2. Enter your comment text\n"
                    "3. The bot will comment on the post\n\n"
                    "Example URL: https://www.facebook.com/user/posts/123456"
                )
            },
            ActionType.UNFOLLOW: {
                "url_label": "Following Page URL:",
                "url_hint": "Enter your Following page URL",
                "show_url": True,
                "show_content": False,
                "instructions": (
                    "UNFOLLOW USERS MODE\n\n"
                    "1. Enter your Facebook Following page URL\n"
                    "2. The bot will scroll and unfollow users\n"
                    "3. Set Max Actions to limit unfollows per account\n\n"
                    "Example URL: https://www.facebook.com/me/following"
                )
            }
        }

        config = action_configs.get(action, action_configs[ActionType.INVITE])

        # Update URL field
        self.url_label.config(text=config["url_label"])
        self.url_hint_label.config(text=config["url_hint"])
        if config["show_url"]:
            self.task_url_entry.grid()
            self.url_hint_label.grid()
        else:
            self.task_url_entry.grid_remove()
            self.url_hint_label.grid_remove()

        # Update content field
        if config["show_content"]:
            self.content_label.grid()
            self.task_content_text.grid()
            self.content_hint_label.config(text=config.get("content_hint", ""))
            self.content_hint_label.grid()
        else:
            self.content_label.grid_remove()
            self.task_content_text.grid_remove()
            self.content_hint_label.grid_remove()

        # Update instructions
        self.instructions_text.config(state=tk.NORMAL)
        self.instructions_text.delete("1.0", tk.END)
        self.instructions_text.insert("1.0", config["instructions"])
        self.instructions_text.config(state=tk.DISABLED)

    def _create_accounts_tab(self) -> None:
        """Create the Accounts tab."""
        # Main paned window
        paned = ttk.PanedWindow(self.notebook, orient="horizontal")
        self.notebook.add(paned, text="Accounts")

        # Accounts frame (left side)
        accounts_frame = ttk.LabelFrame(paned, text="Accounts")
        paned.add(accounts_frame, weight=2)

        self.accounts_scroll = ScrollableFrame(accounts_frame)
        self.accounts_scroll.pack(fill="both", expand=True, padx=5, pady=5)

        # Account log frame (right side)
        log_frame = ttk.LabelFrame(paned, text="Account Logs")
        paned.add(log_frame, weight=1)

        self.global_log = scrolledtext.ScrolledText(
            log_frame,
            height=20,
            width=40,
            wrap=tk.WORD,
            state=tk.DISABLED
        )
        self.global_log.pack(fill="both", expand=True, padx=5, pady=5)

    def _create_log_tab(self) -> None:
        """Create the Log tab."""
        log_frame = ttk.Frame(self.notebook)
        self.notebook.add(log_frame, text="Full Log")

        self.full_log = scrolledtext.ScrolledText(
            log_frame,
            height=30,
            wrap=tk.WORD,
            state=tk.DISABLED
        )
        self.full_log.pack(fill="both", expand=True, padx=5, pady=5)

    def _refresh_dashboard(self) -> None:
        """Refresh dashboard statistics from database."""
        try:
            # Get total stats
            stats = db.get_total_stats()
            self.today_invites_var.set(str(stats.get("today_invites", 0)))
            self.total_invites_var.set(str(stats.get("total_invites", 0)))
            self.total_accounts_var.set(str(stats.get("total_accounts", 0)))
            self.checkpoints_var.set(str(stats.get("total_checkpoints", 0)))

            # Update scheduler status
            self.scheduler_status_var.set(scheduler.get_status_message())

            # Update weekly stats
            self.weekly_tree.delete(*self.weekly_tree.get_children())
            weekly_stats = db.get_weekly_stats()
            for day in weekly_stats:
                self.weekly_tree.insert("", "end", values=(
                    day.get("date", ""),
                    day.get("total_invites", 0),
                    day.get("accounts_used", 0),
                    day.get("errors", 0)
                ))

            # Update proxy status
            proxy_manager = self.view_model.get_proxy_manager()
            if proxy_manager:
                status = proxy_manager.get_status()
                self.proxy_count_var.set(f"{status['alive_count']} alive")
                if status['use_proxy']:
                    if status['fallback_enabled']:
                        self.proxy_status_var.set("Enabled (fallback ON)")
                    else:
                        self.proxy_status_var.set("Enabled")
                else:
                    self.proxy_status_var.set("Disabled")
            else:
                self.proxy_status_var.set("Not initialized")

        except Exception as e:
            self._on_global_log(f"Dashboard refresh error: {e}")

    def _create_status_bar(self) -> None:
        """Create the status bar at the bottom."""
        status_frame = ttk.Frame(self.root)
        status_frame.grid(row=2, column=0, sticky="ew", padx=5, pady=2)

        # Status text
        self.status_var = tk.StringVar(value="Ready")
        status_label = ttk.Label(
            status_frame,
            textvariable=self.status_var,
            relief=tk.SUNKEN,
            anchor="w"
        )
        status_label.pack(side="left", fill="x", expand=True)

        # Statistics
        self.stats_var = tk.StringVar(value="Accounts: 0 | Invites: 0")
        stats_label = ttk.Label(
            status_frame,
            textvariable=self.stats_var,
            relief=tk.SUNKEN,
            anchor="e",
            width=30
        )
        stats_label.pack(side="right")

    def _setup_callbacks(self) -> None:
        """Setup view model callbacks."""
        self.view_model.set_ui_callbacks(
            on_log=self._on_global_log,
            on_status_change=self._on_status_change,
            on_account_update=self._on_account_update,
            on_run_complete=self._on_run_complete
        )

    def _process_messages(self) -> None:
        """Process messages from view model queue."""
        self.view_model.process_messages()
        self._update_statistics()
        self.root.after(100, self._process_messages)

    def _on_global_log(self, message: str) -> None:
        """Handle global log message."""
        # Log to account log panel
        self.global_log.configure(state=tk.NORMAL)
        self.global_log.insert(tk.END, message + "\n")
        self.global_log.see(tk.END)
        self.global_log.configure(state=tk.DISABLED)

        # Also log to full log tab
        self.full_log.configure(state=tk.NORMAL)
        self.full_log.insert(tk.END, message + "\n")
        self.full_log.see(tk.END)
        self.full_log.configure(state=tk.DISABLED)

    def _on_status_change(self, status: str) -> None:
        """Handle status change."""
        self.status_var.set(status)

    def _on_account_update(self, account: Account) -> None:
        """Handle account update."""
        panel = self.account_panels.get(account.debugger_address)
        if panel:
            panel.update_status(account.status)

    def _on_run_complete(self, results: List[BatchResult]) -> None:
        """Handle run completion."""
        self.start_btn.configure(state=tk.NORMAL)
        self.stop_btn.configure(state=tk.DISABLED)
        self._enable_controls(True)

        total_invites = sum(r.total_invites for r in results)
        messagebox.showinfo(
            "Complete",
            f"Run complete!\nTotal invites sent: {total_invites}"
        )

    def _update_statistics(self) -> None:
        """Update statistics display."""
        accounts = self.view_model.get_accounts()
        invites = self.view_model.get_total_invites()
        self.stats_var.set(f"Accounts: {len(accounts)} | Invites: {invites}")

    def _enable_controls(self, enabled: bool) -> None:
        """Enable or disable control buttons."""
        state = tk.NORMAL if enabled else tk.DISABLED
        self.proxy_btn.configure(state=state)
        self.load_btn.configure(state=state)
        self.save_btn.configure(state=state)
        self.add_btn.configure(state=state)

    def _on_action_change(self, event=None) -> None:
        """Handle action type combobox change."""
        selected_label = self.action_var.get()

        # Find the matching ActionType
        for action_type, label in self.view_model.get_action_types():
            if label == selected_label:
                self.view_model.set_current_action(action_type)
                self._update_task_inputs(action_type)
                break

    def _on_start(self) -> None:
        """Handle Start button click."""
        # Get current action type
        current_action = self.view_model.get_current_action()

        # Update task config from UI inputs
        self.view_model.set_task_target_url(self.task_url_var.get().strip())
        self.view_model.set_task_content(self.task_content_text.get("1.0", tk.END).strip())

        # For INVITE action, also update URLs from account panels
        if current_action == ActionType.INVITE:
            for addr, panel in self.account_panels.items():
                url = panel.get_url()
                if url:
                    self.view_model.update_account_url(addr, url)

        # Start the run with task configuration
        if self.view_model.start_run_with_task():
            self.start_btn.configure(state=tk.DISABLED)
            self.stop_btn.configure(state=tk.NORMAL)
            self._enable_controls(False)
            # Switch to log tab to show progress
            self.notebook.select(2)  # Accounts tab

    def _on_stop(self) -> None:
        """Handle Stop button click."""
        self.view_model.stop_run()
        self.start_btn.configure(state=tk.NORMAL)
        self.stop_btn.configure(state=tk.DISABLED)
        self._enable_controls(True)

    def _on_proxy_toggle(self) -> None:
        """Handle proxy checkbox toggle."""
        enabled = self.use_proxy_var.get()
        self.view_model.set_use_proxy(enabled)

        # Update proxy button state
        if enabled:
            self.proxy_btn.configure(state=tk.NORMAL)
        else:
            self.proxy_btn.configure(state=tk.DISABLED)
            # Clear proxies when disabled
            self.view_model.clear_all_proxies()

    def _on_apply_settings(self) -> None:
        """Handle Apply settings button click."""
        try:
            # Apply batch size
            batch_size = int(self.batch_size_var.get())
            self.view_model.set_batch_size(batch_size)

            # Apply max clicks
            max_clicks = int(self.max_clicks_var.get())
            self.view_model.set_max_clicks(max_clicks)

            # Apply scroll delay
            scroll_min = float(self.scroll_min_var.get())
            scroll_max = float(self.scroll_max_var.get())
            self.view_model.set_scroll_delay(scroll_min, scroll_max)

            self._on_global_log("Settings applied successfully")

        except ValueError as e:
            self._on_global_log(f"Invalid settings value: {e}")
            messagebox.showerror("Error", "Please enter valid numeric values")

    def _on_build_proxies(self) -> None:
        """Handle Build Proxies button click."""
        if not self.use_proxy_var.get():
            self._on_global_log("Proxy is disabled. Enable it first.")
            return

        self._on_global_log("Building proxies...")
        # Run in thread to avoid blocking UI
        import threading
        threading.Thread(
            target=self.view_model.build_proxies,
            daemon=True
        ).start()

    def _on_load_accounts(self) -> None:
        """Handle Load Accounts button click."""
        accounts = self.view_model.load_accounts()
        self._refresh_account_panels()
        self._on_global_log(f"Loaded {len(accounts)} accounts")

    def _on_save_accounts(self) -> None:
        """Handle Save Accounts button click."""
        # Update URLs from panels
        for addr, panel in self.account_panels.items():
            url = panel.get_url()
            if url:
                self.view_model.update_account_url(addr, url)

        if self.view_model.save_accounts():
            self._on_global_log("Accounts saved")
        else:
            self._on_global_log("Failed to save accounts")

    def _on_add_account(self) -> None:
        """Handle Add Account button click."""
        dialog = AddAccountDialog(self.root)
        self.root.wait_window(dialog.top)

        if dialog.result:
            addr, url = dialog.result
            account = self.view_model.add_account(addr, url)
            self._add_account_panel(account)
            self._on_global_log(f"Added account: {addr}")

    def _add_account_panel(self, account: Account) -> None:
        """Add a panel for an account."""
        if account.debugger_address in self.account_panels:
            return

        panel = AccountPanel(
            self.accounts_scroll.scrollable_frame,
            account
        )
        panel.pack(fill="x", padx=5, pady=5)

        self.account_panels[account.debugger_address] = panel

        # Setup log callback for this account
        self.view_model.set_account_logger(
            account.debugger_address,
            panel.log
        )

    def _refresh_account_panels(self) -> None:
        """Refresh all account panels."""
        # Clear existing panels
        for panel in self.account_panels.values():
            panel.destroy()
        self.account_panels.clear()

        # Add panels for all accounts
        for account in self.view_model.get_accounts():
            self._add_account_panel(account)

    def _on_close(self) -> None:
        """Handle window close."""
        if self.view_model.is_running:
            if not messagebox.askyesno(
                "Confirm Exit",
                "Bot is still running. Are you sure you want to exit?"
            ):
                return

        self.view_model.shutdown()
        self.root.destroy()

    def run(self) -> None:
        """Start the application main loop."""
        # Load accounts on startup
        self._on_load_accounts()

        # Refresh dashboard on startup
        self._refresh_dashboard()

        # Run main loop
        self.root.mainloop()


class AddAccountDialog:
    """Dialog for adding a new account."""

    def __init__(self, parent: tk.Widget) -> None:
        """
        Initialize AddAccountDialog.

        Args:
            parent: Parent widget.
        """
        self.result: Optional[tuple] = None

        self.top = tk.Toplevel(parent)
        self.top.title("Add Account")
        self.top.geometry("400x150")
        self.top.transient(parent)
        self.top.grab_set()

        # Address entry
        ttk.Label(self.top, text="Debugger Address:").grid(
            row=0, column=0, padx=10, pady=10, sticky="e"
        )
        self.addr_var = tk.StringVar(value="127.0.0.1:")
        self.addr_entry = ttk.Entry(self.top, textvariable=self.addr_var, width=30)
        self.addr_entry.grid(row=0, column=1, padx=10, pady=10)

        # URL entry
        ttk.Label(self.top, text="Group URL:").grid(
            row=1, column=0, padx=10, pady=10, sticky="e"
        )
        self.url_var = tk.StringVar()
        self.url_entry = ttk.Entry(self.top, textvariable=self.url_var, width=30)
        self.url_entry.grid(row=1, column=1, padx=10, pady=10)

        # Buttons
        btn_frame = ttk.Frame(self.top)
        btn_frame.grid(row=2, column=0, columnspan=2, pady=10)

        ttk.Button(btn_frame, text="Add", command=self._on_add).pack(side="left", padx=5)
        ttk.Button(btn_frame, text="Cancel", command=self.top.destroy).pack(side="left", padx=5)

    def _on_add(self) -> None:
        """Handle Add button click."""
        addr = self.addr_var.get().strip()
        url = self.url_var.get().strip() or None

        if not addr:
            messagebox.showerror("Error", "Address is required")
            return

        if ":" not in addr:
            messagebox.showerror("Error", "Address must be in format host:port")
            return

        self.result = (addr, url)
        self.top.destroy()
