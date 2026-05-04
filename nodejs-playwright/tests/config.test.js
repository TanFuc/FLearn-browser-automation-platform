const fs = require('fs');
const { getSettings, saveSettings } = require('../src/config');

// Mock fs
jest.mock('fs');

describe('Config Module', () => {
    afterEach(() => {
        jest.clearAllMocks();
    });

    it('should return default settings if file does not exist', () => {
        fs.existsSync.mockReturnValue(false);
        const settings = getSettings();
        expect(settings.maxScrolls).toBe(20); // default is 20
        expect(settings.maxClicks).toBe(50);
    });

    it('should read from file if it exists', () => {
        fs.existsSync.mockReturnValue(true);
        fs.readFileSync.mockReturnValue(JSON.stringify({ maxScrolls: 15 }));
        const settings = getSettings();
        expect(settings.maxScrolls).toBe(15);
    });

    it('should save settings to file', () => {
        const newSettings = { maxScrolls: 30 };
        saveSettings(newSettings);
        expect(fs.writeFileSync).toHaveBeenCalledWith(
            expect.any(String),
            JSON.stringify(newSettings, null, 2)
        );
    });
});
