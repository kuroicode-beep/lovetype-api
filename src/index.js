const express = require('express');
const dotenv = require('dotenv');
dotenv.config();

const corsMiddleware = require('./middlewares/cors');
const resultRouter = require('./routes/result');
const compatibilityRouter = require('./routes/compatibility');
const eventRouter = require('./routes/event');
const statsRouter = require('./routes/stats');
const v1Router = require('./routes/v1');
const renderAdminPage = require('./adminPage');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(corsMiddleware);

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'lovetype-api' }));

app.use('/api/mbti-test', resultRouter);
app.use('/api/mbti-test', compatibilityRouter);
app.use('/api/event', eventRouter);
app.use('/api/stats', statsRouter);
app.use('/api/v1', v1Router);

app.get('/admin', (req, res) => {
  res.type('html').send(renderAdminPage());
});

app.listen(PORT, () => {
  console.log(`LoveType API running on port ${PORT}`);
});
