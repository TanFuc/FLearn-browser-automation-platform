import os
import json
import time
import pathlib
import subprocess
import threading
import requests
import shutil
import proxy_checker

# ===== CONFIG =====
CHROMEDRIVER_PATH = r"C:\Tools\ChromeDriver138\chromedriver.exe"
CHROME_BINARY_PATH = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
BASE_PROFILE_DIR = r"C:\ChromeProfiles"
ACCOUNT_FILE = "new_accounts.json"
CHECK_INTERVAL = 60           # giây: kiểm tra proxy
PROXY_UPDATE_INTERVAL = 30    # giây: cập nhật proxy mới
LIVE_PROXY_POOL = []

# ===== DANH SÁCH TÀI KHOẢN MẶC ĐỊNH =====
DEFAULT_ACCOUNTS = [
    {"debugger_address": "127.0.0.1:9237", "proxy": ""},
    {"debugger_address": "127.0.0.1:9238", "proxy": ""},
    {"debugger_address": "127.0.0.1:9239", "proxy": ""},
    {"debugger_address": "127.0.0.1:9240", "proxy": ""}
    # {"debugger_address": "127.0.0.1:9236", "proxy": ""},
    # 👉 Thêm tài khoản khác ở đây nếu cần
]

# ===== Logger =====
class SimpleLogger:
    def log(self, msg):
        print(msg)

logger = SimpleLogger()

# ===== Proxy Test =====
def test_proxy(proxy: str) -> tuple[bool, str]:
    try:
        proxies = {"http": f"http://{proxy}", "https": f"http://{proxy}"}
        r = requests.get("https://api.ipify.org", proxies=proxies, timeout=7)
        return r.status_code == 200, r.text.strip()
    except:
        return False, None

# ===== Load/Save Account =====
def load_accounts():
    if not os.path.exists(ACCOUNT_FILE):
        print(f"📂 File {ACCOUNT_FILE} không tồn tại. Tạo mới từ DEFAULT_ACCOUNTS.")
        save_accounts(DEFAULT_ACCOUNTS)
        return DEFAULT_ACCOUNTS
    with open(ACCOUNT_FILE, "r", encoding="utf-8") as f:
        return json.load(f)

def save_accounts(accounts):
    with open(ACCOUNT_FILE, "w", encoding="utf-8") as f:
        json.dump(accounts, f, indent=2, ensure_ascii=False)

# ===== Khởi chạy Chrome với proxy =====
def start_chrome_with_proxy(acc):
    port = acc["debugger_address"].split(":")[-1]
    profile_path = os.path.join(BASE_PROFILE_DIR, f"acc_{port}")
    pathlib.Path(profile_path).mkdir(parents=True, exist_ok=True)

    cmd = [
        CHROME_BINARY_PATH,
        f"--remote-debugging-port={port}",
        f"--user-data-dir={profile_path}",
        "--new-window",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-popup-blocking",
    ]

    proxy = acc.get("proxy", "").strip()
    if not proxy:
        print(f"⛔ Không mở Chrome cho acc_{port} vì không có proxy.")
        return

    cmd.append(f"--proxy-server=http://{proxy}")
    subprocess.Popen(cmd)
    print(f"🚀 Mở Chrome acc_{port} | Proxy: {proxy}")
    time.sleep(1)

# ===== Liên tục cập nhật proxy sống =====
def keep_updating_proxies():
    global LIVE_PROXY_POOL
    while True:
        try:
            new_proxies = proxy_checker.ensure_alive_proxies(needed=5, logger=logger)
            for p in new_proxies:
                if p not in LIVE_PROXY_POOL:
                    LIVE_PROXY_POOL.append(p)
            if new_proxies:
                print(f"📦 Pool proxy hiện có: {len(LIVE_PROXY_POOL)} → {LIVE_PROXY_POOL}")
        except Exception as e:
            print(f"⚠️ Lỗi cập nhật proxy: {e}")
        time.sleep(PROXY_UPDATE_INTERVAL)

# ===== Kiểm tra proxy liên tục cho từng account =====
def monitor_proxy(acc):
    port = acc["debugger_address"].split(":")[-1]

    while True:
        proxy = acc.get("proxy", "").strip()
        if not proxy:
            print(f"⚠️ [{port}] Chưa có proxy.")
            time.sleep(CHECK_INTERVAL)
            continue

        ok, ip = test_proxy(proxy)
        if ok:
            print(f"✅ [{port}] Proxy OK → IP: {ip}")
        else:
            print(f"❌ [{port}] Proxy die → Đang thay mới...")

            if not LIVE_PROXY_POOL:
                print(f"⏳ [{port}] Proxy pool trống. Chờ cập nhật...")
                time.sleep(CHECK_INTERVAL)
                continue

            new_proxy = LIVE_PROXY_POOL.pop(0)
            acc["proxy"] = new_proxy
            print(f"🔁 [{port}] Đổi proxy mới: {new_proxy}")

            # 🛑 Kill Chrome cũ
            profile_path = os.path.join(BASE_PROFILE_DIR, f"acc_{port}")
            kill_chrome_profile(profile_path)

            # 🧹 Xoá profile
            if os.path.exists(profile_path):
                try:
                    shutil.rmtree(profile_path)
                    print(f"🧹 [{port}] Đã xoá profile cũ")
                except Exception as e:
                    print(f"⚠️ [{port}] Không thể xoá profile: {e}")

            # 🚀 Mở lại Chrome với proxy mới
            start_chrome_with_proxy(acc)
            save_accounts(accounts)

        time.sleep(CHECK_INTERVAL)


def kill_chrome_profile(profile_path):
    try:
        os.system(f'tasklist /FI "IMAGENAME eq chrome.exe" > chrome_list.txt')
        with open("chrome_list.txt", "r") as f:
            chrome_lines = f.readlines()

        # Kill tất cả chrome nếu cần
        os.system(f'taskkill /F /IM chrome.exe /FI "WINDOWTITLE eq {profile_path}"')
        print(f"🔪 Đã kill Chrome với profile {profile_path}")
    except Exception as e:
        print(f"⚠️ Lỗi khi kill Chrome profile {profile_path}: {e}")



# ===== MAIN =====
if __name__ == "__main__":
    accounts = load_accounts()
    if not accounts:
        print("⚠️ Không có tài khoản.")
        exit()

    # Khởi động thread cập nhật proxy
    threading.Thread(target=keep_updating_proxies, daemon=True).start()

    # Đợi đến khi có proxy đầu tiên
    while not LIVE_PROXY_POOL:
        print("⏳ Đang đợi proxy đầu tiên...")
        time.sleep(2)

    # Gán proxy mới cho các account chưa có proxy
    for acc in accounts:
        if not acc.get("proxy", "").strip() and LIVE_PROXY_POOL:
            acc["proxy"] = LIVE_PROXY_POOL.pop(0)
            print(f"🔌 Gán proxy mới cho acc {acc['debugger_address']}: {acc['proxy']}")

    save_accounts(accounts)

    # Mở Chrome với các proxy hợp lệ
    for acc in accounts:
        if acc.get("proxy", "").strip():
            start_chrome_with_proxy(acc)
        else:
            print(f"⛔ Không mở Chrome cho acc {acc['debugger_address']} vì chưa có proxy hợp lệ.")

    # Bắt đầu theo dõi proxy
    for acc in accounts:
        threading.Thread(target=monitor_proxy, args=(acc,), daemon=True).start()

    print("👀 Đang theo dõi proxy. Bấm Ctrl+C để thoát.")
    while True:
        time.sleep(9999)
