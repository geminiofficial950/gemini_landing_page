const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'public');
fs.mkdirSync(output, { recursive: true });
// Only public website files; never copy credentials or server code.
for (const file of ['index.html', 'logo-web.png', 'images']) {
  fs.cpSync(path.join(root, file), path.join(output, file), { recursive: true });
}
