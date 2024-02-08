class Storage {
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