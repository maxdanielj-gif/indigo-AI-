const fs = require('fs');
const path = 'data/sync.json';

try {
    const data = JSON.parse(fs.readFileSync(path, 'utf8'));
    const targetId = "1772969457324cxo5dyvni";
    let removedCount = 0;

    function clean(obj) {
        if (Array.isArray(obj)) {
            const initialLength = obj.length;
            const filtered = obj.filter(item => {
                if (item && typeof item === 'object' && item.id === targetId) {
                    removedCount++;
                    return false;
                }
                if (item === targetId) {
                    removedCount++;
                    return false;
                }
                return true;
            });
            return filtered.map(clean);
        } else if (obj !== null && typeof obj === 'object') {
            const newObj = {};
            for (const key in obj) {
                if (obj[key] === targetId) {
                    removedCount++;
                    continue;
                }
                newObj[key] = clean(obj[key]);
            }
            return newObj;
        }
        return obj;
    }

    const cleanedData = clean(data);
    fs.writeFileSync(path, JSON.stringify(cleanedData));
    console.log(`Successfully removed ${removedCount} occurrences of ${targetId}`);
} catch (err) {
    console.error('Error processing sync.json:', err);
    process.exit(1);
}
