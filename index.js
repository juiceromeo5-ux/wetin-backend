const express = require('express');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(express.json());

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    app: 'WETIN',
    message: 'Wetin dey happen? Server is live.',
    time: new Date().toISOString()
  });
});

app.get('/api/db-test', async (req, res) => {
  try {
    const { count, error } = await supabase
      .from('users')
      .select('*', { count: 'exact', head: true });

    if (error) throw error;

    res.json({
      status: 'ok',
      message: 'Supabase is connected ✅',
      userCount: count
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      message: err.message
    });
  }
});

app.get('/', (req, res) => {
  res.send('WETIN backend is running 🚀');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`WETIN server running on port ${PORT}`);
});
