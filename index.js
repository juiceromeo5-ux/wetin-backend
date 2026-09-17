const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const { Resend } = require('resend');

const app = express();
app.use(express.json());

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const resend = new Resend(process.env.RESEND_API_KEY);

function hashValue(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function generateWillId() {
  const num = Math.floor(1000 + Math.random() * 9000);
  return 'wetin-' + num;
}

function generateOtp() {
  return Math.floor(100000 + Math.random() * 900000).toString();
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

app.get('/terms', (req, res) => {
  res.send('WETIN Terms of Service - https://wetin-backend.onrender.com/terms');
});

app.get('/privacy', (req, res) => {
  res.send('WETIN Privacy Policy - https://wetin-backend.onrender.com/privacy');
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

    const otp = generateOtp();
    const expires_at = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    await supabase.from('otp_codes').insert({
      email_hash,
      phone_hash,
      code: otp,
      purpose: 'signup',
      expires_at
    });

    let emailError = null;
    try {
      await resend.emails.send({
        from: process.env.RESEND_FROM || 'onboarding@resend.dev',
        to: email,
        subject: 'Your WETIN verification code',
        html: '<div style="font-family:sans-serif;padding:24px;background:#0A0A0A;color:#F5F5F5;">' +
              '<h1 style="color:#C6FF00;">WETIN</h1>' +
              '<p>Your verification code is:</p>' +
              '<h2 style="color:#C6FF00;font-size:32px;letter-spacing:4px;">' + otp + '</h2>' +
              '<p>This code expires in 10 minutes. Do not share it with anyone.</p>' +
              '</div>'
      });
    } catch (emailErr) {
      emailError = emailErr.message || String(emailErr);
    }

    res.json({
      status: 'ok',
      message: emailError ? 'OTP generated but email failed' : 'Verification code sent to email',
      email_error: emailError,
      next: 'POST /api/auth/verify'
    });
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

    const { data: otpRecord } = await supabase
      .from('otp_codes')
      .select('*')
      .eq('email_hash', email_hash)
      .eq('code', otp_code)
      .eq('used', false)
      .gte('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!otpRecord) {
      return res.status(400).json({ status: 'error', message: 'Invalid or expired OTP' });
    }

    await supabase.from('otp_codes').update({ used: true }).eq('id', otpRecord.id);

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
        subscription_tier: 'free',
        account_status: 'active'
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
      .update({ will_id, will_id_locked: true, signup_completed: true })
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

app.post('/api/panic/report', async (req, res) => {
  try {
    const { reporter_id, target_type, target_id, target_user_id, context, notes } = req.body;

    if (!reporter_id || !target_type || !target_id) {
      return res.status(400).json({ status: 'error', message: 'reporter_id, target_type, target_id required' });
    }

    const { data: existing } = await supabase
      .from('panic_reports')
      .select('id')
      .eq('reporter_id', reporter_id)
      .eq('target_type', target_type)
      .eq('target_id', target_id)
      .maybeSingle();

    if (existing) {
      return res.status(400).json({ status: 'error', message: 'You already reported this' });
    }

    const { error: insertErr } = await supabase.from('panic_reports').insert({
      reporter_id,
      target_type,
      target_id,
      target_user_id,
      context,
      notes,
      status: 'open'
    });

    if (insertErr) throw insertErr;

    const { count: reportCount } = await supabase
      .from('panic_reports')
      .select('*', { count: 'exact', head: true })
      .eq('target_type', target_type)
      .eq('target_id', target_id);

    const threshold = target_type === 'chat' ? 1 : 5;
    const shouldFreeze = reportCount >= threshold;

    const { data: freeze } = await supabase
      .from('freeze_status')
      .select('*')
      .eq('target_type', target_type)
      .eq('target_id', target_id)
      .maybeSingle();

    if (!freeze) {
      await supabase.from('freeze_status').insert({
        target_type,
        target_id,
        target_user_id,
        report_count: reportCount,
        is_frozen: shouldFreeze,
        frozen_at: shouldFreeze ? new Date().toISOString() : null,
        suspend_deadline: shouldFreeze ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() : null
      });
    } else {
      await supabase.from('freeze_status').update({
        report_count: reportCount,
        is_frozen: shouldFreeze || freeze.is_frozen,
        frozen_at: shouldFreeze && !freeze.frozen_at ? new Date().toISOString() : freeze.frozen_at,
        suspend_deadline: shouldFreeze && !freeze.suspend_deadline ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() : freeze.suspend_deadline
      }).eq('id', freeze.id);
    }

    if (shouldFreeze && target_user_id) {
      await supabase.from('users').update({
        account_status: 'suspended',
        suspended_at: new Date().toISOString(),
        ban_deadline: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
      }).eq('id', target_user_id);
    }

    res.json({
      status: 'ok',
      message: shouldFreeze ? 'Report received. Account suspended for review.' : 'Report received. Under review.',
      report_count: reportCount,
      threshold,
      frozen: shouldFreeze,
      remaining_reports_needed: Math.max(0, threshold - reportCount)
    });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message, details: err.details || null });
  }
});

app.post('/api/panic/appeal', async (req, res) => {
  try {
    const { user_id, appeal_text } = req.body;

    if (!user_id || !appeal_text) {
      return res.status(400).json({ status: 'error', message: 'user_id and appeal_text required' });
    }

    const { data: user } = await supabase
      .from('users')
      .select('account_status')
      .eq('id', user_id)
      .maybeSingle();

    if (!user) return res.status(404).json({ status: 'error', message: 'User not found' });
    if (user.account_status !== 'suspended') {
      return res.status(400).json({ status: 'error', message: 'Account is not suspended' });
    }

    const { data: existing } = await supabase
      .from('appeals')
      .select('id')
      .eq('user_id', user_id)
      .eq('status', 'pending')
      .maybeSingle();

    if (existing) {
      return res.status(400).json({ status: 'error', message: 'You already have a pending appeal' });
    }

    const { data: appeal, error } = await supabase
      .from('appeals')
      .insert({ user_id, appeal_text, status: 'pending' })
      .select('id, created_at')
      .single();

    if (error) throw error;

    res.status(201).json({
      status: 'ok',
      message: 'Appeal submitted. We will review within 7 days.',
      appeal
    });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

app.get('/api/panic/status/:user_id', async (req, res) => {
  try {
    const { user_id } = req.params;
    const { data: user } = await supabase
      .from('users')
      .select('id, will_id, account_status, suspended_at, ban_deadline, banned_at, ban_reason')
      .eq('id', user_id)
      .maybeSingle();

    if (!user) return res.status(404).json({ status: 'error', message: 'User not found' });

    res.json({ status: 'ok', user });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

app.get('/api/admin/panic/list', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('panic_reports')
      .select('*')
      .eq('status', 'open')
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json({ status: 'ok', count: data.length, reports: data });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

app.post('/api/admin/panic/review', async (req, res) => {
  try {
    const { user_id, decision, notes } = req.body;

    if (!user_id || !decision) {
      return res.status(400).json({ status: 'error', message: 'user_id and decision required' });
    }

    if (decision === 'release') {
      await supabase.from('users').update({
        account_status: 'active',
        suspended_at: null,
        ban_deadline: null
      }).eq('id', user_id);

      await supabase.from('freeze_status').update({
        is_frozen: false,
        decision: 'released',
        decided_at: new Date().toISOString(),
        decided_by: 'admin',
        decision_notes: notes || null
      }).eq('target_user_id', user_id);
    } else if (decision === 'ban') {
      await supabase.from('users').update({
        account_status: 'banned',
        banned_at: new Date().toISOString(),
        ban_reason: notes || 'Community guidelines violation'
      }).eq('id', user_id);

      await supabase.from('freeze_status').update({
        is_frozen: true,
        decision: 'banned',
        decided_at: new Date().toISOString(),
        decided_by: 'admin',
        decision_notes: notes || null
      }).eq('target_user_id', user_id);
    } else {
      return res.status(400).json({ status: 'error', message: 'decision must be release or ban' });
    }

    await supabase.from('panic_reports').update({
      status: 'resolved',
      resolved_at: new Date().toISOString()
    }).eq('target_user_id', user_id).eq('status', 'open');

    res.json({ status: 'ok', message: 'Decision applied: ' + decision });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

app.get('/', (req, res) => res.send('WETIN backend is running'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('WETIN server running on port ' + PORT));
