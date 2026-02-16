import time
import copy
import os
import random
import threading
import subprocess
import pathlib
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

# ====== CONFIG ======
chromedriver_path = r"C:\Tools\ChromeDriver138\chromedriver.exe"
chrome_binary_path = r"C:\Program Files\Google\Chrome\Application\chrome.exe"  # chỉnh lại nếu khác
base_profile_dir = r"C:\ChromeProfiles"

# accounts = [
#     {"debugger_address": "127.0.0.1:9222", "group_url": "https://www.facebook.com/groups/2036049669958818/members"},
#     {"debugger_address": "127.0.0.1:9223", "group_url": "https://www.facebook.com/groups/chosaigongroup/members"},
#     {"debugger_address": "127.0.0.1:9224", "group_url": "https://www.facebook.com/groups/3603063009973428/members"},
#     {"debugger_address": "127.0.0.1:9225", "group_url": "https://www.facebook.com/groups/4367150640070804/members"},
#     {"debugger_address": "127.0.0.1:9226", "group_url": "https://www.facebook.com/groups/1013281430177764/members"},
#     {"debugger_address": "127.0.0.1:9227", "group_url": "https://www.facebook.com/groups/3603063009973428/members"},
#     {"debugger_address": "127.0.0.1:9228", "group_url": "https://www.facebook.com/groups/268703359880148/members"},
#     {"debugger_address": "127.0.0.1:9229", "group_url": "https://www.facebook.com/groups/134788135130559/members"},
#     {"debugger_address": "127.0.0.1:9230", "group_url": "https://www.facebook.com/groups/2355259718065799/members"},
#     {"debugger_address": "127.0.0.1:9231", "group_url": "https://www.facebook.com/groups/937469108168442/members"},
#     {"debugger_address": "127.0.0.1:9232", "group_url": "https://www.facebook.com/groups/756172333360342/members"},
#     {"debugger_address": "127.0.0.1:9233", "group_url": "https://www.facebook.com/groups/hochiminhnews/members"},
#     {"debugger_address": "127.0.0.1:9234", "group_url": "https://www.facebook.com/groups/chosgonline/members"},
# ]

# ===== Logger with GUI =====
class GuiLogger:
    def __init__(self):
        self.text_widget = None

    def attach(self, widget):
        self.text_widget = widget

    def log(self, message):
        print(message)
        if self.text_widget:
            self.text_widget.insert(tk.END, message + '\n')
            self.text_widget.see(tk.END)

logger = GuiLogger()

# ===== CONFIG =====
chromedriver_path = r"C:\\Tools\\ChromeDriver138\\chromedriver.exe"
chrome_binary_path = r"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
base_profile_dir = r"C:\\ChromeProfiles"
ALIVE_FILE = "proxies_alive.txt"

# ===== Proxy Tools =====
def load_alive_proxies():
    if not os.path.exists(ALIVE_FILE):
        return []
    with open(ALIVE_FILE, "r") as f:
        return list(set([line.strip() for line in f if line.strip()]))

def save_alive_proxies(proxies):
    with open(ALIVE_FILE, "w") as f:
        for p in proxies:
            f.write(p + "\n")

def test_proxy(proxy):
    try:
        proxy = proxy.strip()  # Làm sạch proxy tránh lỗi "Failed to parse"
        proxies = {"http": f"http://{proxy}", "https": f"http://{proxy}"}
        r = requests.get("https://api.ipify.org", proxies=proxies, timeout=7)
        return r.status_code == 200, r.text.strip()
    except Exception as e:
        print(f"⚠️ Proxy test fail ({proxy}): {e}")
        return False, None

# ===== Load Accounts =====
raw_accounts = []
default_accounts = [
    {"debugger_address": "127.0.0.1:9222", "group_url": "https://www.facebook.com/groups/2036049669958818/members"},
    {"debugger_address": "127.0.0.1:9223", "group_url": "https://www.facebook.com/groups/chosaigongroup/members"},
    {"debugger_address": "127.0.0.1:9224", "group_url": "https://www.facebook.com/groups/3603063009973428/members"},
    {"debugger_address": "127.0.0.1:9225", "group_url": "https://www.facebook.com/groups/4367150640070804/members"},
    {"debugger_address": "127.0.0.1:9226", "group_url": "https://www.facebook.com/groups/1013281430177764/members"},
    {"debugger_address": "127.0.0.1:9227", "group_url": "https://www.facebook.com/groups/3603063009973428/members"},
    {"debugger_address": "127.0.0.1:9228", "group_url": "https://www.facebook.com/groups/268703359880148/members"},
    {"debugger_address": "127.0.0.1:9229", "group_url": "https://www.facebook.com/groups/134788135130559/members"},
    {"debugger_address": "127.0.0.1:9230", "group_url": "https://www.facebook.com/groups/2355259718065799/members"},
    {"debugger_address": "127.0.0.1:9231", "group_url": "https://www.facebook.com/groups/937469108168442/members"},
    {"debugger_address": "127.0.0.1:9232", "group_url": "https://www.facebook.com/groups/756172333360342/members"},
    {"debugger_address": "127.0.0.1:9233", "group_url": "https://www.facebook.com/groups/hochiminhnews/members"},
    {"debugger_address": "127.0.0.1:9234", "group_url": "https://www.facebook.com/groups/chosgonline/members"},
    {"debugger_address": "127.0.0.1:9235", "group_url": "https://www.facebook.com/groups/2069180176631802/members"},
    {"debugger_address": "127.0.0.1:9236", "group_url": "https://www.facebook.com/groups/792145229679865/members"},
    {"debugger_address": "127.0.0.1:9237", "group_url": "https://www.facebook.com/groups/390944483355395/members"},
]

raw_accounts = copy.deepcopy(default_accounts)

logger.log(f"📄 Luôn sử dụng danh sách account mặc định ({len(raw_accounts)} tài khoản)")

accounts = []

# ===== Build Proxy for Accounts =====
def build_accounts():
    logger.log("🔧 Đang khởi tạo proxy cho accounts...")

    # ===== 1. Đếm số lượng account cần proxy =====
    proxy_needed_count = sum(1 for acc in raw_accounts if acc.get("proxy", None) == "")
    logger.log(f"🔍 Cần {proxy_needed_count} proxy sống cho {proxy_needed_count} account.")

    # ===== 2. Gọi proxy_checker để đảm bảo đủ proxy sống =====
    alive_proxies = proxy_checker.ensure_alive_proxies(
        needed=proxy_needed_count,
        logger=logger
    )

    # ===== 3. Tiếp tục xử lý proxy cho account như trước =====
    need_proxy, keep_proxy, skip_proxy = [], [], []

    for acc in raw_accounts:
        if "proxy" not in acc:
            # ✅ Account không có field proxy thì chạy bình thường
            skip_proxy.append(acc)
        elif acc["proxy"] == "":
            # ✅ Account có proxy rỗng → cần gán mới
            need_proxy.append(acc)
        else:
            ok, ip = test_proxy(acc["proxy"])
            if ok:
                logger.log(f"✅ Proxy OK: {acc['proxy']} → IP: {ip}")
                keep_proxy.append(acc)
            else:
                logger.log(f"❌ Proxy lỗi: {acc['proxy']}")
                acc["proxy"] = ""
                need_proxy.append(acc)


    logger.log(f"📊 {len(keep_proxy)} giữ proxy | {len(need_proxy)} cần proxy mới | {len(skip_proxy)} bỏ qua proxy")

    proxy_iter = iter(alive_proxies)
    for acc in need_proxy:
        while True:
            try:
                proxy = next(proxy_iter)
            except StopIteration:
                logger.log("⚠️ Hết proxy sống để gán!")
                break

            ok, ip = test_proxy(proxy)
            if ok and proxy.strip() not in [a.get("proxy", "").strip() for a in (keep_proxy + need_proxy + skip_proxy)]:
                acc["proxy"] = proxy
                logger.log(f"✅ Proxy mới gán: {proxy} → IP: {ip}")
                keep_proxy.append(acc)
                break
            else:
                logger.log(f"❌ Proxy lỗi (dự phòng): {proxy}")

    accounts.clear()
    accounts.extend(keep_proxy + skip_proxy)

    with open("account_status.json", "w", encoding="utf-8") as f:
        json.dump(accounts, f, indent=2, ensure_ascii=False)

# ===== GUI Runner =====
def start_gui():
    root = tk.Tk()
    root.title("Facebook Proxy Auto Clicker")
    root.geometry("720x500")

    log_box = ScrolledText(root, font=("Consolas", 10), bg="#1e1e1e", fg="#dcdcdc")
    log_box.pack(fill=tk.BOTH, expand=True)
    logger.attach(log_box)

    def start():
        threading.Thread(target=run_all, daemon=True).start()

    def run_all():
        build_accounts()
        run_accounts_in_batches(accounts)
        with open("account_status.json", "w", encoding="utf-8") as f:
            json.dump(accounts, f, indent=2, ensure_ascii=False)
        logger.log("🎉 Hoàn tất.")

    tk.Button(root, text="▶️ Bắt đầu", command=start, font=("Arial", 12, "bold"), bg="#2e8b57", fg="white").pack(pady=10)
    root.mainloop()


# ====== MỞ / ĐÓNG CHROME CHO 1 BATCH ======
def start_chrome_instances(batch_accounts, chrome_path, base_profile_dir):
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
        print(f"🚀 Mở Chrome {acc['debugger_address']} (PID={p.pid}) | Profile={profile_dir}")
        time.sleep(1)
    return procs

def shutdown_chrome_instances(process_map, timeout=5):
    for dbg, p in process_map.items():
        try:
            print(f"🛑 Đóng Chrome {dbg} (PID={p.pid})...")
            p.terminate()
            p.wait(timeout=timeout)
        except Exception:
            try: p.kill()
            except: pass

# ====== LOGIC CỦA TOOL ======
def human_sleep(min_s, max_s):
    time.sleep(random.uniform(min_s, max_s))

def handle_popup_if_exists(driver, debugger_address, popup_counter):
    try:
        alert = driver.switch_to.alert
        alert_text = alert.text
        alert.accept()
        popup_counter['count'] += 1
        print(f"🛑 [{debugger_address}] OK alert: {alert_text} (#{popup_counter['count']})")
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
                print(f"🛑 [{debugger_address}] Click popup: '{btn.text}' (#{popup_counter['count']})")
                time.sleep(2)
                if popup_counter['count'] >= 10:
                    raise Exception("⚠️ Vượt quá 10 popup")
                return True
            except Exception as e:
                print(f"⚠️ [{debugger_address}] Không thể click popup: {e}")
    except Exception as e:
        print(f"⚠️ [{debugger_address}] Không phát hiện popup: {e}")
    return False

def scroll_smoothly(driver, times=5, debugger_address="", popup_counter=None):
    for i in range(times):
        scroll_amount = random.randint(600, 900)
        driver.execute_script(f"window.scrollBy(0, {scroll_amount});")
        print(f"🔄 [{debugger_address}] Scroll {i + 1}/{times} ({scroll_amount}px)")
        human_sleep(3.5, 6)
        handle_popup_if_exists(driver, debugger_address, popup_counter)

def click_friends(driver, debugger_address, popup_counter):
    clicked_count = 0
    seen_buttons = set()
    scroll_attempts = 0
    MAX_CLICKS = 30
    MAX_SCROLLS = 999

    print(f"🔁 [{debugger_address}] Bắt đầu click 'Thêm bạn bè'...")

    while clicked_count < MAX_CLICKS and scroll_attempts < MAX_SCROLLS:
        buttons = driver.find_elements(By.XPATH, "//span[text()='Thêm bạn bè']")
        print(f"👀 [{debugger_address}] Thấy {len(buttons)} nút")

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
                print(f"✅ [{debugger_address}] {clicked_count}/{MAX_CLICKS}")
                handle_popup_if_exists(driver, debugger_address, popup_counter)
                human_sleep(3, 5)

                if clicked_count % 30 == 0:
                    pause_sec = random.uniform(60, 120)
                    print(f"⏸ [{debugger_address}] Nghỉ {pause_sec:.1f}s sau 30 click")
                    time.sleep(pause_sec)

                if clicked_count >= MAX_CLICKS:
                    break
            except Exception as e:
                print(f"❌ [{debugger_address}] Lỗi click: {e}")
                continue

        if clicked_count >= MAX_CLICKS:
            break

        scroll_attempts += 1
        scroll_amount = random.randint(700, 1000)
        driver.execute_script(f"window.scrollBy(0, {scroll_amount});")
        print(f"🔄 [{debugger_address}] Scroll #{scroll_attempts} ({scroll_amount}px)")
        human_sleep(4, 6)
        handle_popup_if_exists(driver, debugger_address, popup_counter)

    print(f"🎯 [{debugger_address}] Xong, đã click {clicked_count} nút.")

def process_facebook_account(acc):
    debugger_address = acc["debugger_address"]
    group_url = acc["group_url"]

    print(f"\n🚀 Start {debugger_address}")

    options = Options()
    options.debugger_address = debugger_address

    service = Service(executable_path=chromedriver_path)
    driver = webdriver.Chrome(service=service, options=options)
    WebDriverWait(driver, 15)

    popup_counter = {"count": 0}

    try:
        driver.get(group_url)
        human_sleep(7, 10)

        # ===== KIỂM TRA CHECKPOINT =====
        current_url = driver.current_url
        page_source = driver.page_source

        if "checkpoint" in current_url or "checkpoint" in page_source.lower():
            acc["status"] = "Checkpoint"
            print(f"⚠️ [{debugger_address}] Bị checkpoint! URL: {current_url}")
            driver.quit()
            return

        handle_popup_if_exists(driver, debugger_address, popup_counter)
        scroll_smoothly(driver, times=5, debugger_address=debugger_address, popup_counter=popup_counter)
        click_friends(driver, debugger_address, popup_counter)

        acc["status"] = "OK"
    except Exception as e:
        print(f"❌ [{debugger_address}] Lỗi tổng thể: {e}")
        acc["status"] = f"Lỗi: {str(e)}"
    finally:
        driver.quit()
        print(f"🚪 [{debugger_address}] driver.quit()")


def run_accounts_in_batches(accounts, batch_size=2, sleep_between_batches=(90, 180)):
    for i in range(0, len(accounts), batch_size):
        batch = accounts[i:i + batch_size]
        print(f"\n🚦 Batch {i // batch_size + 1}: {len(batch)} acc")

        # ✅ Kiểm tra và làm mới proxy nếu cần
        for acc in batch:
            check_and_refresh_proxy_for_account(acc, logger)

        # 1) Mở Chrome cho đúng batch này
        chrome_procs = start_chrome_instances(batch, chrome_binary_path, base_profile_dir)

        try:
            # 2) Chạy các thread trong batch
            threads = []
            for acc in batch:
                t = threading.Thread(
                    target=process_facebook_account,
                    args=(acc,)
                )
                threads.append(t)
                t.start()

            for t in threads:
                t.join()

            print(f"✅ Batch {i // batch_size + 1} xong.")
        finally:
            # 3) Đóng các Chrome của batch này
            shutdown_chrome_instances(chrome_procs)
            print("🧹 Đã đóng các Chrome của batch này.")

        # 4) Nghỉ giữa các batch
        pause_between_batches = random.uniform(*sleep_between_batches)
        print(f"⏳ Nghỉ {pause_between_batches:.1f}s trước batch tiếp theo...")
        time.sleep(pause_between_batches)

def check_and_refresh_proxy_for_account(acc, logger):
    from proxy_checker import ensure_alive_proxies

    current_proxy = acc.get("proxy", "").strip()
    ok, ip = test_proxy(current_proxy)

    if ok:
        logger.log(f"✅ Proxy đang hoạt động: {current_proxy} → IP: {ip}")
        return

    logger.log(f"❌ Proxy chết: {current_proxy}, đang thay mới...")

    # Lấy proxy mới
    new_proxies = ensure_alive_proxies(needed=1, logger=logger)
    if not new_proxies:
        logger.log("⚠️ Không tìm được proxy mới!")
        return

    new_proxy = new_proxies[0]
    acc["proxy"] = new_proxy
    logger.log(f"✅ Proxy mới gán: {new_proxy}")

    # Tự động xóa profile cũ (tuỳ chọn, tránh cache IP)
    port = acc["debugger_address"].split(":")[-1]
    profile_path = os.path.join(base_profile_dir, f"acc_{port}")
    if os.path.exists(profile_path):
        try:
            import shutil
            shutil.rmtree(profile_path)
            logger.log(f"🧹 Đã xoá profile cũ: {profile_path}")
        except Exception as e:
            logger.log(f"⚠️ Không thể xoá profile {profile_path}: {e}")

# ====== MAIN ======
if __name__ == "__main__":
    # run_accounts_in_batches(accounts, batch_size=2)
    # print("🎉 Tất cả tài khoản đã chạy xong.")

    start_gui()
