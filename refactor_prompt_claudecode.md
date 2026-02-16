# PROMPT: Refactoring `fb-auto-invite` Codebase

**Role:** Senior Python Architect & Automation Specialist
**Objective:** Refactor the existing legacy Python codebase (`fb-auto-invite`) into a scalable, maintainable, and production-ready architecture.

## 1. Project Context
The current project automates Facebook interactions (fetching members, inviting) using Selenium + Chrome with a Proxy rotation mechanism.
**Current Issues:**
- **Monolithic Design:** Logic, UI, and IO are tightly coupled in `main.py`.
- **Code Duplication:** Proxy checking logic is repeated across `main.py`, `proxy_checker.py`, and `monitor.py`.
- **Hardcoded Configuration:** Paths and settings are scattered throughout the code.
- **Concurrency Issues:** Poor thread management and global state usage.
- **Lack of Type Safety:** No data validation or type hinting.

## 2. Refactoring Goals
1.  **Modular Architecture:** Implement a clean Separation of Concerns (SoC) using a layered architecture (Domain, Infrastructure, Application, Presentation).
2.  **Scalability:** Decouple the UI from the Business Logic so the bot can run in Headless/CLI mode or GUI mode easily.
3.  **Robustness:** Implement proper Exception Handling, centralized Logging, and Pydantic Data Models.
4.  **Configuration Management:** Remove all hardcoded paths/settings.

## 3. Desired Architecture

Please refactor the project into the following structure:

```text
fb_auto_invite/
├── app/
│   ├── __init__.py
│   ├── config.py           # Pydantic BaseSettings (loads .env)
│   ├── log_setup.py        # Centralized logging configuration
│   ├── models.py           # Domain models (Account, Proxy, TaskStatus)
│   ├── core/
│   │   ├── browser.py      # BrowserFactory & WebDriver manager (Selenium wrapper)
│   │   ├── automation.py   # Core Facebook logic (Scroll, Click, Popup handling)
│   │   └── proxy.py        # ProxyManager (Fetch, Check, Rotate logic)
│   └── services/
│       ├── account_manager.py # Manages account state, file IO
│       └── bot_orchestrator.py # Manages threads, assigns tasks to workers
├── ui/
│   ├── __init__.py
│   ├── main_window.py      # Tkinter Layout (View only)
│   └── view_models.py      # Connects UI events to BotOrchestrator
├── utils/
│   ├── file_io.py          # Safe JSON/TXT reading/writing
│   └── helpers.py          # Random delays, text processing
├── main.py                 # Entry point (Setup Config -> Init Services -> Launch UI)
└── requirements.txt        # Updated dependencies
```

## 4. Implementation Details

### A. Configuration & Models (`app/config.py`, `app/models.py`)
-   Use `pydantic-settings` to manage `CHROMEDRIVER_PATH`, `CHROME_BINARY_PATH`, `PROFILE_DIR`, `TIMEOUTS`.
-   Define `Account` model: `debugger_address`, `group_url`, `proxy`, `status`.
-   Define `Proxy` model: `ip`, `port`, `protocol`, `last_checked`, `is_alive`.

### B. Core Logic (`app/core/`)
-   **`proxy.py`**: Consolidate all proxy fetching (from `proxy_checker.py`) and checking logic here. Implement a `ProxyProvider` interface.
-   **`browser.py`**: Create a `BrowserManager` class.
    -   Encapsulate `subprocess.Popen` for Chrome debugging port.
    -   Ensure robust process cleanup (kill zombies on exit).
    -   Manage `webdriver.Chrome` connection.
-   **`automation.py`**: Isolate Facebook interactions.
    -   `scroll_and_invite()`: Generic method accepting a driver instance.
    -   Decorators for retry logic and error handling.

### C. Service Layer (`app/services/`)
-   **`BotOrchestrator`**:
    -   Manages a thread pool for running accounts parallelly.
    -   Exposes events/callbacks for UI updates (e.g., `on_log`, `on_status_change`).
    -   **CRITICAL**: Must not depend on Tkinter directly. Use callbacks or a queue.

### D. User Interface (`ui/`)
-   Refactor `main.py` GUI code into `ui/main_window.py`.
-   The UI should initiate actions via `BotOrchestrator` and listen for updates.
-   Implement a thread-safe logging mechanism (QueueHandler) to update the `ScrolledText` widget without freezing the UI.

## 5. Coding Standards
-   **Type Hinting**: strict `typing` usage for all functions.
-   **Docstrings**: Google-style docstrings for classes and critical functions.
-   **Error Handling**: specific `try-except` blocks, never bare `except:`.
-   **Logging**: Use the standard `logging` library, not print statements.

## 6. Execution Plan
1.  **Analyze**: Verify the current directory structure.
2.  **Scaffold**: Create the new directory structure.
3.  **Migrate**: Move logic piece by piece, starting with Config & Models, then Core, then Services, finally UI.
4.  **Verify**: Ensure the refactored code runs with the existing `main.py` entry point (adapted).

**Action:**
Generate the complete refactored codebase following the structure above.
