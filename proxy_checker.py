import requests
import concurrent.futures
import threading
import os
import random
import time
from datetime import datetime

ALIVE_FILE = "proxies_best.txt"
GOOD_FILE = "proxies_good.txt"
BAD_FILE = "proxies_bad.txt"
LOG_FILE = "proxy_log.txt"

TIMEOUT = 12
MAX_THREADS = 60
MAX_RUNTIME = 600  # 10 phút

VALID_PORTS = {80, 8080, 3128}
CHECK_IP_SOURCE = "https://api.ipify.org"

lock = threading.Lock()
stop_flag = threading.Event()


# ========================== FETCH ===========================

def fetch_all_proxies():
    sources = [
        fetch_proxyscrape("http", "VN"),
        fetch_proxyscrape("http", "US"),
        fetch_proxy_list_download("http"),
        fetch_github_raw("https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/http.txt"),
        fetch_github_raw("https://raw.githubusercontent.com/ShiftyTR/Proxy-List/master/http.txt"),
        fetch_github_raw("https://raw.githubusercontent.com/clarketm/proxy-list/master/proxy-list-raw.txt"),
    ]
    merged = set()
    for src in sources:
        merged.update(src)
    filtered = [p for p in merged if is_valid_port(p)]
    random.shuffle(filtered)
    return filtered

def is_valid_port(proxy):
    try:
        port = int(proxy.split(":")[1])
        return port in VALID_PORTS
    except:
        return False

def fetch_proxyscrape(protocol="http", country="all"):
    try:
        url = f"https://api.proxyscrape.com/v2/?request=getproxies&protocol={protocol}&timeout=8000&country={country}&ssl=yes&anonymity=all"
        res = requests.get(url, timeout=10)
        return res.text.strip().splitlines() if res.ok else []
    except:
        return []

def fetch_proxy_list_download(protocol="http"):
    try:
        res = requests.get(f"https://www.proxy-list.download/api/v1/get?type={protocol}", timeout=10)
        return res.text.strip().splitlines() if res.ok else []
    except:
        return []

def fetch_github_raw(url):
    try:
        res = requests.get(url, timeout=10)
        return res.text.strip().splitlines() if res.ok else []
    except:
        return []


# ========================== CHECK ===========================

def is_proxy_usable_for_facebook(proxy, logger=None):
    proxies = {"http": f"http://{proxy}", "https": f"http://{proxy}"}

    try:
        res = requests.get(CHECK_IP_SOURCE, proxies=proxies, timeout=TIMEOUT)
        if not res.ok:
            if logger: logger.log(f"⚠️ Không phản hồi IP: {proxy}")
            return False
        ip_address = res.text.strip()
    except:
        if logger: logger.log(f"⚠️ Không xác định IP: {proxy}")
        return False

    try:
        fb = requests.get("https://www.facebook.com", proxies=proxies, timeout=TIMEOUT)
        if not (fb.ok and "facebook" in fb.text.lower()):
            if logger: logger.log(f"🔴 Facebook từ chối: {proxy}")
            return False
    except Exception as e:
        if logger: logger.log(f"❌ Lỗi truy cập Facebook: {proxy} - {e}")
        return False

    if logger: logger.log(f"🟢 OK: {proxy} → IP: {ip_address}")
    return True


def is_proxy_working(proxy, best_list, good_list, bad_list, limit, logger=None):
    if stop_flag.is_set():
        return

    result = is_proxy_usable_for_facebook(proxy, logger)
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    line = f"{proxy} | {timestamp}"

    with lock:
        if result:
            if len(best_list) < limit:
                best_list.append(line)
            else:
                good_list.append(line)
            if len(best_list) >= limit:
                stop_flag.set()
        else:
            bad_list.append(line)


# ========================== FILE IO ===========================

def save_to_file(filename, lines):
    if not lines:
        return
    with open(filename, "w", encoding="utf-8") as f:
        for line in lines:
            f.write(line + "\n")

def load_alive_proxies():
    if not os.path.exists(ALIVE_FILE):
        return []
    with open(ALIVE_FILE, "r", encoding="utf-8") as f:
        return list(set([line.split("|")[0].strip() for line in f if ":" in line]))


# ========================== MAIN ===========================

def get_working_proxies(proxy_list, needed=5, logger=None):
    best, good, bad = [], [], []
    stop_flag.clear()
    start = time.time()

    with concurrent.futures.ThreadPoolExecutor(max_workers=MAX_THREADS) as executor:
        for proxy in proxy_list:
            if stop_flag.is_set() or (time.time() - start > MAX_RUNTIME):
                break
            executor.submit(is_proxy_working, proxy, best, good, bad, needed, logger)

        while not stop_flag.is_set() and len(best) < needed and (time.time() - start < MAX_RUNTIME):
            time.sleep(1)

    return best, good, bad

def ensure_alive_proxies(needed=5, logger=None):
    old_proxies = load_alive_proxies()
    best, good, bad = [], [], []

    for p in old_proxies:
        if len(best) >= needed:
            break
        if is_proxy_usable_for_facebook(p, logger):
            timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            best.append(f"{p} | {timestamp}")
        else:
            timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            bad.append(f"{p} | {timestamp}")
            if logger: logger.log(f"❌ Proxy chết: {p}")

    missing = needed - len(best)
    if missing > 0:
        if logger: logger.log(f"🔍 Cần thêm {missing} proxy...")
        all_new_proxies = fetch_all_proxies()
        used = [line.split("|")[0].strip() for line in best + bad]
        available = [p for p in all_new_proxies if p not in used]

        new_best, new_good, new_bad = get_working_proxies(available, needed=missing, logger=logger)
        best.extend(new_best)
        good.extend(new_good)
        bad.extend(new_bad)

    save_to_file(ALIVE_FILE, best)
    save_to_file(GOOD_FILE, good)
    save_to_file(BAD_FILE, bad)

    return [b.split("|")[0] for b in best]  # Trả về danh sách proxy thô (không timestamp)


# ========================== LOGGER ===========================

class SimpleLogger:
    def __init__(self):
        self.f = open(LOG_FILE, "a", encoding="utf-8")

    def log(self, msg):
        print(msg)
        self.f.write(msg + "\n")
        self.f.flush()

    def __del__(self):
        self.f.close()


# ========================== ENTRY ===========================

if __name__ == "__main__":
    logger = SimpleLogger()
    result = ensure_alive_proxies(needed=5, logger=logger)
    print("\n🎯 Proxy tốt nhất:")
    for line in result:
        print("➡️", line)
