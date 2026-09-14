const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

const app = express();
app.use(express.json());

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ============ HELPERS ============
function hashValue(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function generateWillId() {
  const num = Math.floor(1000 + Math.random() * 9000);
  return `wetin-${num}`;
}

function formatUserForViewer(user) {
  if (user.mode === 'ghost') {
    return { anonymous: true, display: 'Someone' };
  }
  if (user.mode === 'shadow') {
    return { anonymous: false, will_id: user.will_id, display: user.display_name };
  }
  if (user.mode === 'open') {
    return { anonymous: false, will_id: user.will_id, display: user.real_name, verified: true };
  }
}

// ============ ROUTES ============
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', app: 'WETIN', message: 'Wetin dey happen? Server is live.' });
});

app.get('/api/db-test', async (req, res) => {
  const { count, error } = await supabase.from('users').select('*', { count: 'exact', head: true });
  if (error) return res.status(500).json({ status: 'error', message: error.message });
  res.json({ status: 'ok', message: 'Supabase connected ✅', userCount: count });
});

// STEP 1: Start signup
app.post('/api/auth/start', async (req, res) => {
  try {
    const { email, phone, terms_accepted, privacy_accepted } = req.body;

    if (!email || !phone) {
      return res.status(400).json({ status: 'error', message: 'Email and phone required' });
    }
    if (!terms_accepted || !privacy_accepted) {
      return res.status(400).json({ status: 'error', message: 'Must accept Terms and Privacy Policy' });
    }

    const phone_hash = hashValue(phone);
    const email_hash = hashValue(email);

    // Check phone not used
    const { data: phoneExists } = await supabase
      .from('users').select('id').eq('phone_hash', phone_hash).maybeSingle();
    if (phoneExists) {
      return res.status(400).json({ status: 'error', message: 'This phone number is already registered' });
    }

    // Check email count < 4
    const { count: emailCount } = await supabase
      .from('users').select('*', { count: 'exact', head: true }).eq('email_hash', email_hash);

    if (emailCount >= 4) {
      return res.json({
        status: 'limit_reached',
        message: 'You have reached the maximum of 4 accounts per email.',
        upgrade_available: true,
        upgrade_message: 'Upgrade to WETIN Pro to create more accounts.'
      });
    }

    // TODO: Send OTP to phone + email (Termii + Resend later)
    res.json({
      status: 'ok',
      message: 'Verification code sent to phone and email',
      next: 'POST /api/auth/verify with { email, phone, otp_code }'
    });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// STEP 2: Verify OTP
app.post('/api/auth/verify', async (req, res) => {
  try {
    const { email, phone, otp_code } = req.body;

    if (!email || !phone || !otp_code) {
      return res.status(400).json({ status: 'error', message: 'Email, phone, and OTP required' });
    }

    // TODO: Verify OTP with Termii + Resend later
    // For now: accept any 6-digit code

    const phone_hash = hashValue(phone);
    const email_hash = hashValue(email);

    // Generate default Will ID
    let will_id;
    let attempts = 0;
    while (attempts < 5) {
      will_id = generateWillId();
      const { data: clash } = await supabase.from('users').select('id').eq('will_id', will_id).maybeSingle();
      if (!clash) break;
      attempts++;
    }

    // Create user
    const { data: newUser, error: createErr } = await supabase
      .from('users')
      .insert({
        will_id,
        phone_hash,
        email_hash,
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
      message: 'Verified! Your default anonymous ID is ready.',
      user_id: newUser.id,
      default_will_id: newUser.will_id,
      next: 'POST /api/auth/claim-id with { user_id, will_id }'
    });
  } catch (err) {
res.status(500).json({
  status: 'error',
  message: err.message,
  details: err.details || null,
  hint: err.hint || null,
  code: err.code || null
});
});

// STEP 3: Claim Will ID
app.post('/api/auth/claim-id', async (req, res) => {
  try {
    const { user_id, will_id } = req.body;

    if (!user_id || !will_id) {
      return res.status(400).json({ status: 'error', message: 'user_id and will_id required' });
    }

    // Validate format
    if (!/^wetin-[0-9]{4}$/.test(will_id) && !/^[a-z0-9_-]{3,20}$/.test(will_id)) {
      return res.status(400).json({ status: 'error', message: 'Invalid Will ID format' });
    }

    // Check uniqueness
    const { data: clash } = await supabase.from('users').select('id').eq('will_id', will_id).maybeSingle();
    if (clash) {
      return res.status(400).json({ status: 'error', message: 'That Will ID is taken. Try another.' });
    }

    // Update user
    const { data: updated, error: updateErr } = await supabase
      .from('users')
      .update({ will_id, will_id_locked: true, signup_completed: true })
      .eq('id', user_id)
      .select('id, will_id, mode, created_at')
      .single();

    if (updateErr) throw updateErr;

    res.json({
      status: 'ok',
      message: 'Welcome to WETIN 🚀',
      user: updated
    });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

app.get('/', (req, res) => {
  res.send('WETIN backend is running 🚀');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`WETIN server running on port ${PORT}`));
