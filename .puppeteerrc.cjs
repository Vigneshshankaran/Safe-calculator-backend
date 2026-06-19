const { join } = require('path');

/**
 * @type {import("puppeteer").Configuration}
 */
module.exports = {
  // Specifies the directory where Puppeteer will download browsers.
  // Using a path within the workspace ensures it is bundled and deployed by Render.
  cacheDirectory: join(__dirname, '.cache', 'puppeteer'),
};
