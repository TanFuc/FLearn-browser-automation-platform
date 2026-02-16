import time
import copy
import os
import random
import threading
import subprocess
import pathlib
import socket
import requests
import json
import tkinter as tk
import proxy_checker
from tkinter.scrolledtext import ScrolledText
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait

# ===== CONFIG =====
chromedriver_path = r"C:\Tools\ChromeDriver142\chromedriver.exe"
chrome_binary_path = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
base_profile_dir = r"C:\ChromeProfiles"
ALIVE_FILE = "proxies_alive.txt"

# ===== Thread-safe per-widget logger =====
class WidgetLogger:
    def __init__(self, text_widget=None):
        self.text_widget = text_widget

    def attach(self, text_widget):
        self.text_widget = text_widget

    def log(self, message):
        if not self.text_widget:
            return
        # ensure insert happens in main thread
        def _insert():
            ts = time.strftime("%Y-%m-%d %H:%M:%S")
            try:
                self.text_widget.insert(tk.END, f"[{ts}] {message}\n")
                self.text_widget.see(tk.END)
            except Exception:
                pass
        try:
            self.text_widget.after(0, _insert)
        except Exception:
            # fallback (shouldn't happen)
            _insert()

# ===== Global main logger (for overall events) =====
main_logger = WidgetLogger()

# ===== Proxy Tools =====
def load_alive_proxies():
    if not os.path.exists(ALIVE_FILE):
        return []
    with open(ALIVE_FILE, "r", encoding="utf-8") as f:
        return list(dict.fromkeys([line.strip() for line in f if line.strip()]))

def save_alive_proxies(proxies):
    with open(ALIVE_FILE, "w", encoding="utf-8") as f:
        for p in proxies:
            f.write(p + "\n")

def test_proxy(proxy):
    try:
        proxy = proxy.strip()
        proxies = {"http": f"http://{proxy}", "https": f"http://{proxy}"}
        r = requests.get("https://api.ipify.org", proxies=proxies, timeout=7)
        return r.status_code == 200, r.text.strip()
    except Exception as e:
        return False, None

# ===== Load Accounts (example) =====
raw_accounts = []
default_accounts = [
    # {"debugger_address": "127.0.0.1:9222", "group_url": "https://www.facebook.com/groups/248133599069412/members"},
    # {"debugger_address": "127.0.0.1:9223", "group_url": "https://www.facebook.com/groups/chosaigongroup/members"},
    {"debugger_address": "127.0.0.1:9224", "group_url": "https://www.facebook.com/groups/330269429696127/members"},
    # {"debugger_address": "127.0.0.1:9225", "group_url": "https://www.facebook.com/groups/4367150640070804/members"},
    # {"debugger_address": "127.0.0.1:9226", "group_url": "https://www.facebook.com/groups/1013281430177764/members"},
    {"debugger_address": "127.0.0.1:9227", "group_url": "https://www.facebook.com/groups/chodianmuaban/members"},
    {"debugger_address": "127.0.0.1:9229", "group_url": "https://www.facebook.com/groups/1892613567828637/members"}, 
    {"debugger_address": "127.0.0.1:9230", "group_url": "https://www.facebook.com/groups/2036049669958818/members"}, 
    # {"debugger_address": "127.0.0.1:9231", "group_url": "https://www.facebook.com/groups/937469108168442/members"}, 
    # {"debugger_address": "127.0.0.1:9232", "group_url": "https://www.facebook.com/groups/756172333360342/members"}, 
]
raw_accounts = copy.deepcopy(default_accounts)

accounts = []  # will be filled by build_accounts()

# ===== Build Proxy for Accounts =====
def build_accounts():
    main_logger.log("🔧 Khởi tạo proxy cho accounts...")
    proxy_needed_count = sum(1 for acc in raw_accounts if acc.get("proxy", None) == "")
    main_logger.log(f"🔍 Cần {proxy_needed_count} proxy sống cho {proxy_needed_count} account.")
    alive_proxies = proxy_checker.ensure_alive_proxies(needed=proxy_needed_count, logger=main_logger)

    need_proxy, keep_proxy, skip_proxy = [], [], []
    for acc in raw_accounts:
        if "proxy" not in acc:
            skip_proxy.append(acc)
        elif acc["proxy"] == "":
            need_proxy.append(acc)
        else:
            ok, ip = test_proxy(acc["proxy"])
            if ok:
                keep_proxy.append(acc)
            else:
                acc["proxy"] = ""
                need_proxy.append(acc)

    proxy_iter = iter(alive_proxies)
    for acc in need_proxy:
        while True:
            try:
                proxy = next(proxy_iter)
            except StopIteration:
                main_logger.log("⚠️ Hết proxy sống để gán!")
                break
            ok, ip = test_proxy(proxy)
            if ok and proxy.strip() not in [a.get("proxy", "").strip() for a in (keep_proxy + need_proxy + skip_proxy)]:
                acc["proxy"] = proxy
                keep_proxy.append(acc)
                break

    accounts.clear()
    accounts.extend(keep_proxy + skip_proxy)
    with open("account_status.json", "w", encoding="utf-8") as f:
        json.dump(accounts, f, indent=2, ensure_ascii=False)
    main_logger.log(f"📄 Đã chuẩn bị {len(accounts)} account.")

# ===== UI helpers: scrollable frame for many account panels =====
class ScrollableFrame(tk.Frame):
    def __init__(self, parent, *args, **kwargs):
        super().__init__(parent, *args, **kwargs)
        canvas = tk.Canvas(self, borderwidth=0, highlightthickness=0)
        vsb = tk.Scrollbar(self, orient="vertical", command=canvas.yview)
        canvas.configure(yscrollcommand=vsb.set)
        self.inner = tk.Frame(canvas)
        self.inner_id = canvas.create_window((0, 0), window=self.inner, anchor="nw")
        canvas.pack(side="left", fill="both", expand=True)
        vsb.pack(side="right", fill="y")

        def _on_configure(event):
            canvas.configure(scrollregion=canvas.bbox("all"))
        self.inner.bind("<Configure>", _on_configure)

        def _on_canvas_resize(event):
            canvas.itemconfig(self.inner_id, width=event.width)
        canvas.bind("<Configure>", _on_canvas_resize)

# ===== Start/stop Chrome instances; wait for debugger port =====
def start_chrome_instances(batch_accounts, chrome_path, base_profile_dir, logger):
    base = pathlib.Path(base_profile_dir)
    base.mkdir(parents=True, exist_ok=True)
    procs = {}
    for acc in batch_accounts:
        port = acc["debugger_address"].split(":")[-1]
        profile_dir = base / f"acc_{port}"
        profile_dir.mkdir(parents=True, exist_ok=True)
        cmd = [
            chrome_path,
            f"--remote-debugging-port={port}",
            f"--user-data-dir={profile_dir}",
            "--new-window",
            "--no-first-run",
            "--no-default-browser-check",
            "--disable-popup-blocking",
        ]
        p = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        procs[acc["debugger_address"]] = p
        logger.log(f"🚀 Mở Chrome {acc['debugger_address']} (PID={p.pid}) | Profile={profile_dir}")
        time.sleep(0.5)
    # wait for ports to listen
    for acc in batch_accounts:
        port = int(acc["debugger_address"].split(":")[-1])
        if wait_for_debugger(port, timeout=10):
            logger.log(f"✅ Debugger ready: {acc['debugger_address']}")
        else:
            logger.log(f"⚠️ Debugger NOT ready within timeout: {acc['debugger_address']}")
    return procs

def shutdown_chrome_instances(process_map, logger, timeout=5):
    for dbg, p in process_map.items():
        try:
            logger.log(f"🛑 Đóng Chrome {dbg} (PID={p.pid})...")
            p.terminate()
            p.wait(timeout=timeout)
        except Exception:
            try:
                p.kill()
            except:
                pass

def wait_for_debugger(port, timeout=10):
    start = time.time()
    while time.time() - start < timeout:
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.settimeout(1.0)
        try:
            s.connect(("127.0.0.1", port))
            s.close()
            return True
        except Exception:
            time.sleep(0.5)
    return False

# ====== Core behaviors (popup, scroll, click) - use account_logger =====
def human_sleep(min_s, max_s):
    time.sleep(random.uniform(min_s, max_s))

def handle_popup_if_exists(driver, account_logger, popup_counter, debugger_address):
    try:
        alert = driver.switch_to.alert
        alert_text = alert.text
        alert.accept()
        popup_counter['count'] += 1
        account_logger.log(f"OK alert: {alert_text} (#{popup_counter['count']})")
        if popup_counter['count'] >= 10:
            raise Exception("⚠️ Vượt quá 10 popup")
        return True
    except:
        pass

    try:
        popup_buttons = driver.find_elements(By.XPATH, "//span[text()='OK' or text()='Đồng ý' or text()='Tiếp tục' or text()='Xác nhận']")
        for btn in popup_buttons:
            try:
                driver.execute_script("""
                    if (arguments[0].scrollIntoViewIfNeeded) {
                        arguments[0].scrollIntoViewIfNeeded(true);
                    } else {
                        arguments[0].scrollIntoView({block: 'center'});
                    }
                """, btn)
                time.sleep(1)
                driver.execute_script("arguments[0].click();", btn)
                popup_counter['count'] += 1
                account_logger.log(f"Click popup: '{btn.text}' (#{popup_counter['count']})")
                time.sleep(2)
                if popup_counter['count'] >= 10:
                    raise Exception("⚠️ Vượt quá 10 popup")
                return True
            except Exception as e:
                account_logger.log(f"Không thể click popup: {e}")
    except Exception as e:
        account_logger.log(f"Không phát hiện popup: {e}")
    return False

def scroll_smoothly(driver, times=5, account_logger=None, debugger_address="", popup_counter=None):
    for i in range(times):
        scroll_amount = random.randint(600, 900)
        try:
            driver.execute_script(f"window.scrollBy(0, {scroll_amount});")
        except Exception as e:
            account_logger.log(f"Scroll script error: {e}")
            return
        account_logger.log(f"Scroll {i+1}/{times} ({scroll_amount}px)")
        human_sleep(3.5, 6)
        handle_popup_if_exists(driver, account_logger, popup_counter, debugger_address)

def click_friends(driver, account_logger, debugger_address, popup_counter):
    clicked_count = 0
    seen_buttons = set()
    scroll_attempts = 0
    MAX_CLICKS = 50
    MAX_SCROLLS = 999

    account_logger.log("Bắt đầu click 'Thêm bạn bè'...")

    while clicked_count < MAX_CLICKS and scroll_attempts < MAX_SCROLLS:
        try:
            buttons = driver.find_elements(By.XPATH, "//span[text()='Thêm bạn bè']")
        except Exception as e:
            account_logger.log(f"Lỗi tìm nút: {e}")
            break

        random.shuffle(buttons)

        for btn in buttons:
            btn_id = btn.get_attribute("id") or str(hash(btn))
            if btn_id in seen_buttons:
                continue
            seen_buttons.add(btn_id)

            try:
                driver.execute_script("""
                    if (arguments[0].scrollIntoViewIfNeeded) {
                        arguments[0].scrollIntoViewIfNeeded(true);
                    } else {
                        arguments[0].scrollIntoView({block: 'center', inline: 'center'});
                    }
                """, btn)
                human_sleep(1.8, 3)
                driver.execute_script("arguments[0].click();", btn)
                clicked_count += 1
                account_logger.log(f"{clicked_count}/{MAX_CLICKS}")
                handle_popup_if_exists(driver, account_logger, popup_counter, debugger_address)
                human_sleep(3, 5)

                if clicked_count % 30 == 0:
                    pause_sec = random.uniform(60, 120)
                    account_logger.log(f"Nghỉ {pause_sec:.1f}s sau 30 click")
                    time.sleep(pause_sec)

                if clicked_count >= MAX_CLICKS:
                    break
            except Exception as e:
                account_logger.log(f"Lỗi click: {e}")
                continue

        if clicked_count >= MAX_CLICKS:
            break

        scroll_attempts += 1
        scroll_amount = random.randint(700, 1000)
        try:
            driver.execute_script(f"window.scrollBy(0, {scroll_amount});")
        except Exception as e:
            account_logger.log(f"Lỗi scroll: {e}")
            break
        account_logger.log(f"Scroll #{scroll_attempts} ({scroll_amount}px)")
        human_sleep(4, 6)
        handle_popup_if_exists(driver, account_logger, popup_counter, debugger_address)

    account_logger.log(f"Xong, đã click {clicked_count} nút.")

# ===== Process a single facebook account (attach to existing chrome) =====
def process_facebook_account(acc, account_logger):
    debugger_address = acc["debugger_address"]
    group_url = acc["group_url"]
    account_logger.log(f"Start {debugger_address}")

    options = Options()
    options.debugger_address = debugger_address

    # Ensure service uses the configured chromedriver file
    service = Service(executable_path=chromedriver_path)

    try:
        driver = webdriver.Chrome(service=service, options=options)
    except Exception as e:
        account_logger.log(f"Lỗi khi khởi tạo WebDriver/attach: {e}")
        acc["status"] = f"Lỗi attach: {e}"
        return

    WebDriverWait(driver, 15)
    popup_counter = {"count": 0}

    try:
        driver.get(group_url)
        human_sleep(7, 10)

        current_url = driver.current_url
        page_source = driver.page_source.lower()
        account_logger.log(f"Current URL preview: {current_url}")

        if "checkpoint" in current_url:
            acc["status"] = "Checkpoint"
            account_logger.log("Bị checkpoint! (URL chứa 'checkpoint')")
            driver.quit()
            return

        if "your account is temporarily locked" in page_source \
           or "account locked" in page_source \
           or "confirm your identity" in page_source:
            acc["status"] = "Checkpoint"
            account_logger.log("Bị checkpoint do nội dung cảnh báo trong trang")
            driver.quit()
            return

        handle_popup_if_exists(driver, account_logger, popup_counter, debugger_address)
        scroll_smoothly(driver, times=5, account_logger=account_logger, debugger_address=debugger_address, popup_counter=popup_counter)
        click_friends(driver, account_logger, debugger_address, popup_counter)

        acc["status"] = "OK"
    except Exception as e:
        account_logger.log(f"Lỗi tổng thể: {e}")
        acc["status"] = f"Lỗi: {e}"
    finally:
        try:
            driver.quit()
        except:
            pass
        account_logger.log("driver.quit()")

# ===== Run accounts in batches =====
def run_accounts_in_batches(accounts_list, account_loggers, batch_size=5, sleep_between_batches=(90, 180)):
    for i in range(0, len(accounts_list), batch_size):
        batch = accounts_list[i:i + batch_size]
        main_logger.log(f"Batch {i // batch_size + 1}: {len(batch)} acc")

        # Check/refresh proxies (logs to main logger)
        for acc in batch:
            check_and_refresh_proxy_for_account(acc, main_logger)

        # Start Chrome instances for this batch
        chrome_procs = start_chrome_instances(batch, chrome_binary_path, base_profile_dir, main_logger)
        time.sleep(1)  # small safety pause

        try:
            threads = []
            for acc in batch:
                acc_logger = account_loggers.get(acc["debugger_address"])
                if not acc_logger:
                    acc_logger = main_logger
                t = threading.Thread(target=process_facebook_account, args=(acc, acc_logger))
                threads.append(t)
                t.start()

            for t in threads:
                t.join()

            main_logger.log(f"Batch {i // batch_size + 1} xong.")
        finally:
            shutdown_chrome_instances(chrome_procs, main_logger)

        pause_between_batches = random.uniform(*sleep_between_batches)
        main_logger.log(f"Nghỉ {pause_between_batches:.1f}s trước batch tiếp theo...")
        time.sleep(pause_between_batches)

def check_and_refresh_proxy_for_account(acc, logger):
    from proxy_checker import ensure_alive_proxies
    if "proxy" not in acc:
        logger.log(f"Bỏ qua kiểm tra proxy vì acc {acc['debugger_address']} không dùng proxy.")
        return

    current_proxy = acc.get("proxy", "").strip()
    if not current_proxy:
        logger.log(f"Proxy rỗng cho acc {acc['debugger_address']}, cần gán proxy mới.")
    else:
        ok, ip = test_proxy(current_proxy)
        if ok:
            logger.log(f"Proxy đang hoạt động: {current_proxy} → IP: {ip}")
            return
        else:
            logger.log(f"Proxy chết: {current_proxy}, đang thay mới...")

    new_proxies = ensure_alive_proxies(needed=1, logger=logger)
    if not new_proxies:
        logger.log("Không tìm được proxy mới!")
        return

    new_proxy = new_proxies[0]
    acc["proxy"] = new_proxy
    logger.log(f"Proxy mới gán: {new_proxy}")

    port = acc["debugger_address"].split(":")[-1]
    profile_path = os.path.join(base_profile_dir, f"acc_{port}")
    if os.path.exists(profile_path):
        try:
            import shutil
            shutil.rmtree(profile_path)
            logger.log(f"Đã xoá profile cũ: {profile_path}")
        except Exception as e:
            logger.log(f"Không thể xoá profile {profile_path}: {e}")

# ===== GUI Runner =====
def start_gui():
    root = tk.Tk()
    root.title("Facebook Proxy Auto Clicker")
    root.geometry("1000x700")

    # Main logger panel on top
    main_frame = tk.Frame(root)
    main_frame.pack(fill="x", padx=6, pady=6)
    tk.Label(main_frame, text="GLOBAL LOG", font=("Arial", 10, "bold")).pack(anchor="w")
    global_log_box = ScrolledText(main_frame, height=6, font=("Consolas", 10))
    global_log_box.pack(fill="x")
    main_logger.attach(global_log_box)

    # Scrollable area for account panels
    panels_frame = ScrollableFrame(root)
    panels_frame.pack(fill="both", expand=True, padx=6, pady=6)

    # Create an account logger per account and UI panel
    account_loggers = {}
    for acc in raw_accounts:
        dbg = acc["debugger_address"]
        panel = tk.LabelFrame(panels_frame.inner, text=dbg, padx=6, pady=6)
        panel.pack(fill="x", padx=6, pady=6)

        info = tk.Label(panel, text=f"Group: {acc.get('group_url')}", anchor="w")
        info.pack(fill="x")

        st = ScrolledText(panel, height=8, font=("Consolas", 10))
        st.pack(fill="both", expand=True)
        logger_obj = WidgetLogger(st)
        account_loggers[dbg] = logger_obj

    # Buttons
    btn_frame = tk.Frame(root)
    btn_frame.pack(fill="x", padx=6, pady=6)
    def on_start():
        threading.Thread(target=run_all, args=(account_loggers,), daemon=True).start()
    tk.Button(btn_frame, text="▶️ Bắt đầu", command=on_start, font=("Arial", 12, "bold"), bg="#2e8b57", fg="white").pack(side="left", padx=6)
    tk.Button(btn_frame, text="Thoát", command=root.destroy, font=("Arial", 12)).pack(side="right", padx=6)

    def run_all(account_loggers_local):
        build_accounts()
        # ensure account_loggers keys align with accounts list
        for acc in accounts:
            if acc["debugger_address"] not in account_loggers_local:
                # create a minimal logger (logs go to global)
                account_loggers_local[acc["debugger_address"]] = main_logger
        run_accounts_in_batches(accounts, account_loggers_local, batch_size=5)
        with open("account_status.json", "w", encoding="utf-8") as f:
            json.dump(accounts, f, indent=2, ensure_ascii=False)
        main_logger.log("🎉 Hoàn tất.")

    root.mainloop()

if __name__ == "__main__":
    start_gui()
