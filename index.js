const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

const app = express();
app.use(express.json());

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

function hashValue(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function generateWillId() {
  const num = Math.floor(1000 + Math.random() * 9000);
  return 'wetin-' + num;
}

function formatUserForViewer(user) {
  if (user.mode === 'ghost') return { anonymous: true, display: 'Someone' };
  if (user.mode === 'shadow') return { anonymous: false, will_id: user.will_id, display: user.display_name };
  if (user.mode === 'open') return { anonymous: false, will_id: user.will_id, display: user.real_name, verified: true };
}

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', app: 'WETIN', message: 'Wetin dey happen? Server is live.' });
});

app.get('/api/db-test', async (req, res) => {
  const { count, error } = await supabase.from('users').select('*', { count: 'exact', head: true });
  if (error) return res.status(500).json({ status: 'error', message: error.message, details: error.details });
  res.json({ status: 'ok', message: 'Supabase connected', userCount: count });
});

app.post('/api/auth/start', async (req, res) => {
  try {
    const { email, phone, terms_accepted, privacy_accepted } = req.body;
    if (!email || !phone) return res.status(400).json({ status: 'error', message: 'Email and phone required' });
    if (!terms_accepted || !privacy_accepted) return res.status(400).json({ status: 'error', message: 'Must accept Terms and Privacy' });

    const phone_hash = hashValue(phone);
    const email_hash = hashValue(email);

    const { data: phoneExists } = await supabase.from('users').select('id').eq('phone_hash', phone_hash).maybeSingle();
    if (phoneExists) return res.status(400).json({ status: 'error', message: 'Phone already registered' });

    const { count: emailCount } = await supabase.from('users').select('*', { count: 'exact', head: true }).eq('email_hash', email_hash);
    if (emailCount >= 4) {
      return res.json({ status: 'limit_reached', message: 'Max 4 accounts per email', upgrade_available: true });
    }

    res.json({ status: 'ok', message: 'Verification code sent', next: 'POST /api/auth/verify' });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message, details: err.details || null });
  }
});

app.post('/api/auth/verify', async (req, res) => {
  try {
    const { email, phone, otp_code } = req.body;
    if (!email || !phone || !otp_code) return res.status(400).json({ status: 'error', message: 'Email, phone, OTP required' });

    const phone_hash = hashValue(phone);
    const email_hash = hashValue(email);

    let will_id;
    let attempts = 0;
    while (attempts < 5) {
      will_id = generateWillId();
      const { data: clash } = await supabase.from('users').select('id').eq('will_id', will_id).maybeSingle();
      if (!clash) break;
      attempts++;
    }

    const { data: newUser, error: createErr } = await supabase
      .from('users')
      .insert({
        will_id: will_id,
        phone_hash: phone_hash,
        email_hash: email_hash,
        phone_verified: true,
        email_verified: true,
        mode: 'ghost',
        kyc_verified: false,
        signup_completed: false,
        will_id_locked: false,
        terms_accepted: true,
        terms_accepted_at: new Date().toISOString(),
        privacy_accepted: true,
        privacy_accepted_at: new Date().toISOString(),
        subscription_tier: 'free'
      })
      .select('id, will_id')
      .single();

    if (createErr) throw createErr;

    res.status(201).json({
      status: 'ok',
      message: 'Verified! Your anonymous ID is ready.',
      user_id: newUser.id,
      default_will_id: newUser.will_id,
      next: 'POST /api/auth/claim-id'
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      message: err.message,
      details: err.details || null,
      hint: err.hint || null,
      code: err.code || null
    });
  }
});

app.post('/api/auth/claim-id', async (req, res) => {
  try {
    const { user_id, will_id } = req.body;
    if (!user_id || !will_id) return res.status(400).json({ status: 'error', message: 'user_id and will_id required' });

    const { data: clash } = await supabase.from('users').select('id').eq('will_id', will_id).maybeSingle();
    if (clash) return res.status(400).json({ status: 'error', message: 'Will ID taken' });

    const { data: updated, error: updateErr } = await supabase
      .from('users')
      .update({ will_id: will_id, will_id_locked: true, signup_completed: true })
      .eq('id', user_id)
      .select('id, will_id, mode, created_at')
      .single();

    if (updateErr) throw updateErr;

    res.json({ status: 'ok', message: 'Welcome to WETIN', user: updated });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      message: err.message,
      details: err.details || null,
      hint: err.hint || null,
      code: err.code || null
    });
  }
});

app.get('/', (req, res) => res.send('WETIN backend is running'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('WETIN server running on port ' + PORT));
