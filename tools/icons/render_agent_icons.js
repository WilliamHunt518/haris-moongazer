// Rasterise server/web/icons/modern/src/*.svg to 60x60 PNGs in server/web/icons/modern/.
// Usage: node tools/icons/render_agent_icons.js   (needs Playwright with Chromium)
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const dir = path.join(__dirname, "..", "..", "server", "web", "icons", "modern");
(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 60, height: 60 }, deviceScaleFactor: 1 });
    const files = fs.readdirSync(path.join(dir, "src")).filter(f => f.endsWith(".svg")).sort();
    for (const f of files) {
        const svg = fs.readFileSync(path.join(dir, "src", f), "utf8");
        await page.setContent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`);
        await page.locator("svg").screenshot({ path: path.join(dir, f.replace(/\.svg$/, ".png")), omitBackground: true });
    }
    await browser.close();
    console.log(`rendered ${files.length} icons`);
})();
