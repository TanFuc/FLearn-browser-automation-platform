const path = require('path');
const fs = require('fs');

const PROFILES_DIR = path.join(__dirname, '..', 'profiles');
const METADATA_FILE = path.join(PROFILES_DIR, 'metadata.json');
const LOGS_DIR = path.join(__dirname, '..', 'logs', 'errors');
const SETTINGS_FILE = path.join(__dirname, '..', 'settings.json');

const defaultSettings = {
    delayMin: 1000,
    delayMax: 3000,
    scrollPauseMin: 2000,
    scrollPauseMax: 5000,
    maxScrolls: 20,
    maxClicks: 50,
    skipAdmins: true,
    skipVerified: true,
    keywordsBlacklist: [],
    browserWindowMode: 'fingerprint',
    browserWindowWidth: 1366,
    browserWindowHeight: 768,
    closeExistingBrowserSession: true
};

function getSettings() {
    if (fs.existsSync(SETTINGS_FILE)) {
        try {
            const data = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
            return { ...defaultSettings, ...data };
        } catch(e) {
            console.error("Error reading settings", e);
            return defaultSettings;
        }
    }
    return defaultSettings;
}

function saveSettings(newSettings) {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(newSettings, null, 2));
}

module.exports = {
    PROFILES_DIR,
    METADATA_FILE,
    LOGS_DIR,
    getSettings,
    saveSettings
};
