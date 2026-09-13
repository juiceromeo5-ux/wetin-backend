const express = require('express');
const app = express();

app.use(express.json());

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    app: 'WETIN',
    message: 'Wetin dey happen? Server is live.',
    time: new Date().toISOString()
  });
});

app.get('/', (req, res) => {
  res.send('WETIN backend is running 🚀');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`WETIN server running on port ${PORT}`);
});
