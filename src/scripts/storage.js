class Storage {
    static storeGlobalValue(key, value) {
        let content = {};
        content[key] = JSON.stringify(value);
        browser.storage.local.set(content);
    }

    static async getStoredGlobalValue(key, defaultValue = null) {
        const result = await browser.storage.local.get(key);
        return Object.keys(result).length > 0 ?
            JSON.parse(result[Object.keys(result)[0]]) : defaultValue;
    }

    static deleteGlobalValue(key) {
        browser.storage.local.remove([ key ]);
    }

    static storeValue(url, key, value) {
        let content = {};
        content[this.buildKey(url, key)] = value;
        browser.storage.local.set(content);
    }

    static async getStoredValue(url, key) {
        const result = await browser.storage.local.get(
            [ this.buildKey(url, key) ]
        );
        return result[Object.keys(result)[0]];
    }

    static deleteValue(url, key) {
        browser.storage.local.remove(
            [ this.buildKey(url, key) ]
        );
    }

    static clearAll() {
        browser.storage.local.clear();
    }

    static buildKey(url, key) {
        return key + '--' + url;
    }
}