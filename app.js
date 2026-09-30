const express = require('express');

// Vercel entry point; routes are shared with npm start.
const app = express();
app.use(require('./server/server'));
module.exports = app;
