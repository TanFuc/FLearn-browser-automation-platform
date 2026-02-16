# PROMPT: Implement Advanced Facebook Automation Features (Post, Share, Group, Unfollow)

**Role:** Senior Python Automation Developer
**Objective:** Significantly extend the `fb-auto-invite` project to support a full suite of Facebook interactions. The goal is to implement robust, working features for **Posting (Wall & Group)**, **Sharing**, **Commenting**, and **Unfollowing**.

## 1. Feature Specifications

### Feature 1: Auto Post to Wall (Profile)
*   **Input:** None (Target is own profile) + Content (Text).
*   **Behavior:**
    1.  Navigate to `https://www.facebook.com/`.
    2.  Click the input field **"What's on your mind?"** (Bạn đang nghĩ gì?).
    3.  Type the content.
    4.  Wait for the **"Post"** (Đăng) button to become active.
    5.  Click **"Post"**.

### Feature 2: Auto Post to Group
*   **Input:** Group URL + Content (Text).
*   **Behavior:**
    1.  Navigate to the specific Group URL.
    2.  Find the **"Write something..."** (Bạn viết gì đi...) input area.
    3.  Click to open the post dialog.
    4.  Type the content.
    5.  Click **"Post"** (Đăng).

### Feature 3: Auto Share Post
*   **Input:** Source Post URL.
*   **Behavior:**
    1.  Navigate to the Source Post URL.
    2.  Find the **"Share"** (Chia sẻ) button.
    3.  Click it to open the menu.
    4.  Select **"Share now (Public)"** (Chia sẻ ngay - Công khai) or **"Share to Feed"**.
    5.  *Constraint:* Must handle cases where the post is not sharable (log warning).

### Feature 4: Auto Comment
*   **Input:** Post URL + Comment Content.
*   **Behavior:**
    1.  Navigate to the Post URL.
    2.  Find the comment input box (often `role="textbox"` or `aria-label="Write a comment"`).
    3.  Click and type content.
    4.  Press **Enter** or click the send icon.

### Feature 5: Auto Unfollow (From "Following" List)
*   **Input:** Link to "Following" page (e.g., `facebook.com/me/following`).
*   **Behavior:**
    1.  Navigate to the provided URL.
    2.  Scroll down incrementally to load items.
    3.  Identify user cards.
    4.  Click the **Three Dots (...)** button on a card.
    5.  Select **"Unfollow"** (Bỏ theo dõi) from the dropdown.
    6.  Confirm if a popup appears.

## 2. Implementation Requirements (Robustness)

To ensure these features "actually work" (hoạt động được) despite Facebook's dynamic DOM:

1.  **Robust Selectors:** using `XPATH` that relies on **ARIA labels** and **Text Content** (bilingual: English & Vietnamese).
    *   *Example:* `//div[@aria-label="Post" or @aria-label="Đăng"]`
2.  **Smart Waiting:** Use `WebDriverWait` with `EC.element_to_be_clickable` before every interaction. Never rely solely on `time.sleep`.
3.  **Human Simulation:**
    *   Type text with small random delays between keystrokes.
    *   Random cursor movements or small scrolls before clicking.
4.  **Error Handling:** If a selector fails (e.g., "Share" button not found), log the specific error and move to the next account/task without crashing.

## 3. Architecture Updates

### A. `app/models.py`
Update `Account` or create a new `TaskConfig` class to hold the operation mode:
```python
class ActionType(str, Enum):
    INVITE = "invite"
    POST_WALL = "post_wall"
    POST_GROUP = "post_group"
    SHARE = "share"
    COMMENT = "comment"
    UNFOLLOW = "unfollow"
```

### B. `app/core/automation.py`
Add methods to `FacebookAutomation`:
- `post_to_wall(content: str)`
- `post_to_group(group_url: str, content: str)`
- `share_post(post_url: str)`
- `comment_on_post(post_url: str, content: str)`
- `unfollow_users(target_url: str, count: int)`

### C. UI Updates (`ui/main_window.py`)
Refactor the GUI to be **Task-Oriented**:
1.  **Action Dropdown:** "Select Action: [Post to Wall / Share / ...]"
2.  **Dynamic Input Area:**
    *   If *Share* -> Show "Post Link" input.
    *   If *Post Group* -> Show "Group Link" + "Content" input.
    *   If *Unfollow* -> Show "Following Link" input.

## 4. Execution Plan
Please generate the code to implement these features, prioritizing the stability of the Selenium interactions (selectors and waits).

**Action:**
Generate code updates for `app/models.py`, `app/core/automation.py`, `app/services/bot_orchestrator.py`, and `ui/main_window.py`.
