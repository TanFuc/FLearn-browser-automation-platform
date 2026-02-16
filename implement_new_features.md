# PROMPT: Implement Auto Post, Comment, and Unfollow Features

**Role:** Senior Python Automation Developer
**Objective:** Extend the `fb-auto-invite` project to include three new automation features: **Auto Post**, **Auto Comment**, and **Auto Unfollow**.

## 1. Context & New Requirements
The current application architecture (Layered: Models, Core, Services, UI) works well for "Group Invitations". The user now wants to perform other actions using the same account/driver infrastructure.

### Feature 1: Auto Unfollow (Priority)
*   **Input:** User provides a link to their "Following" page (e.g., `https://www.facebook.com/username/following`).
*   **Behavior (Based on Screenshot):**
    1.  Navigate to the provided URL (Friend/Following list).
    2.  Scroll down to load valid items.
    3.  Iterate through the list of users.
    4.  Click the **"..." (Options)** button on the user card.
    5.  Wait for the dropdown menu to appear.
    6.  Click the button containing text **"Bỏ theo dõi"** or **"Unfollow"**.
    7.  Click "Update" or "Confirm" if a popup appears.
    8.  Repeat with random human-like delays.

### Feature 2: Auto Comment
*   **Input:** Target Post URL (or list of URLs) and Comment Content.
*   **Behavior:**
    1.  Navigate to the specific Post URL.
    2.  Locate the comment input box.
    3.  Type the content.
    4.  Press Enter or Click the "Send" icon.

### Feature 3: Auto Post
*   **Input:** Post Content (Text).
*   **Behavior:**
    1.  Navigate to the User's Profile or Home Feed.
    2.  Click the "What's on your mind?" (Bạn đang nghĩ gì?) input area.
    3.  Type the content.
    4.  Click "Post" (Đăng).

## 2. Implementation Plan

### Step 1: Update Domain Models (`app/models.py`)
*   Introduce an `ActionType` Enum: `INVITE`, `POST`, `COMMENT`, `UNFOLLOW`.
*   Update `Account` model (or create a transient `TaskContext`) to hold:
    *   `action_type`: The selected action.
    *   `target_url`: The URL to act upon (Group URL, Post URL, Following URL).
    *   `content`: The text to post or comment.

### Step 2: Update Core Automation (`app/core/automation.py`)
*   Extend `FacebookAutomation` class with new methods:
    *   `unfollow_users(max_count: int)`: Logic for the "Following" page.
        *   *Tip:* Use XPATH to find the "..." button relative to user cards.
        *   *Tip:* Handle `StaleElementReferenceException` strictly as the list updates after unfollowing.
        *   *Tip:* XPath for menu item: `//span[contains(text(), 'Bỏ theo dõi') or contains(text(), 'Unfollow')]`.
    *   `post_status(content: str)`: Logic for creating a new post.
    *   `comment_on_post(content: str)`: Logic for commenting.
*   Refactor `process_account` to dispatch to these methods based on `ActionType`.

### Step 3: Update Orchestrator (`app/services/bot_orchestrator.py`)
*   Ensure the `BotOrchestrator` passes the correct configuration (Target URL, Content, Action Type) from the UI/Settings to the `FacebookAutomation` instance.

### Step 4: Update UI (`ui/main_window.py` & `ui/view_models.py`)
*   **Action Selector:** Add a Combobox/Dropdown at the top of the UI to select the "Mode" (e.g., "Invite Friends", "Unfollow", "Comment", "Post").
*   **Dynamic Inputs:**
    *   **Invite Mode:** Show "Group URL" input.
    *   **Unfollow Mode:** Show "Following Page URL" input.
    *   **Comment Mode:** Show "Post URL" input and "Content" Text area.
    *   **Post Mode:** Show "Content" Text area.
*   **Data Binding:** Ensure these inputs update the `Account` or `Task` state before running.

## 3. Specific Logic for "Unfollow" (Detailed)
The user provided a screenshot of the "Following" page.
*   **Structure:** It's a grid/list of cards.
*   **Trigger:** The 3-dot icon (`...`) is the entry point.
*   **Action:** The dropdown menu contains "Bỏ theo dõi".
*   **Constraint:** Must support scrolling ("vẫn kéo xuống này kia").

## 4. Execution
Please modify the project files to integrate these features cleanly. Ensure backward compatibility with the existing "Invite" feature.

**Action:**
Generate the necessary code changes for `models.py`, `automation.py`, `bot_orchestrator.py`, and `main_window.py`.
