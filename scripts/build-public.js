const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'public');
fs.mkdirSync(output, { recursive: true });
// Only public website files; never copy credentials or server code.
for (const file of ['index.html', 'logo-web.png', 'herosection-web.jpg', 'course-1.jpg', 'course-2.jpg', 'course-3.jpg']) {
  fs.copyFileSync(path.join(root, file), path.join(output, file));
}
