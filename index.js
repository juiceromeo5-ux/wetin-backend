const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const { Resend } = require('resend');
const cloudinary = require('cloudinary').v2;

const app = express();
app.use(express.json());

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const resend = new Resend(process.env.RESEND_API_KEY);

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

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
  if (!user) return { anonymous: true, display: 'Someone' };
  if (user.mode === 'ghost') return { anonymous: true, display: 'Someone' };
  if (user.mode === 'shadow') return { anonymous: false, will_id: user.will_id, display: user.display_name };
  if (user.mode === 'open') return { anonymous: false, will_id: user.will_id, display: user.real_name, verified: true };
  return { anonymous: true, display: 'Someone' };
}

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', app: 'WETIN', message: 'Wetin dey happen? Server is live.' });
});

app.get('/api/db-test', async (req, res) => {
  const { count, error } = await supabase.from('users').select('*', { count: 'exact', head: true });
  if (error) return res.status(500).json({ status: 'error', message: error.message });
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
    if (emailCount >= 4) return res.json({ status: 'limit_reached', message: 'Max 4 accounts per email', upgrade_available: true });

    const otp = generateOtp();
    const expires_at = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    await supabase.from('otp_codes').insert({ email_hash, phone_hash, code: otp, purpose: 'signup', expires_at });

    let emailError = null;
    try {
      await resend.emails.send({
        from: process.env.RESEND_FROM || 'onboarding@resend.dev',
        to: email,
        subject: 'Your WETIN verification code',
        html: '<div style="font-family:sans-serif;padding:24px;background:#0A0A0A;color:#F5F5F5;"><h1 style="color:#C6FF00;">WETIN</h1><p>Your verification code is:</p><h2 style="color:#C6FF00;font-size:32px;letter-spacing:4px;">' + otp + '</h2><p>This code expires in 10 minutes.</p></div>'
      });
    } catch (emailErr) {
      emailError = emailErr.message || String(emailErr);
    }

    res.json({ status: 'ok', message: emailError ? 'OTP generated but email failed' : 'Verification code sent to email', email_error: emailError, next: 'POST /api/auth/verify' });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

app.post('/api/auth/verify', async (req, res) => {
  try {
    const { email, phone, otp_code } = req.body;
    if (!email || !phone || !otp_code) return res.status(400).json({ status: 'error', message: 'Email, phone, OTP required' });

    const phone_hash = hashValue(phone);
    const email_hash = hashValue(email);

    const { data: otpRecord } = await supabase.from('otp_codes').select('*').eq('email_hash', email_hash).eq('code', otp_code).eq('used', false).gte('expires_at', new Date().toISOString()).order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (!otpRecord) return res.status(400).json({ status: 'error', message: 'Invalid or expired OTP' });

    await supabase.from('otp_codes').update({ used: true }).eq('id', otpRecord.id);

    let will_id;
    let attempts = 0;
    while (attempts < 5) {
      will_id = generateWillId();
      const { data: clash } = await supabase.from('users').select('id').eq('will_id', will_id).maybeSingle();
      if (!clash) break;
      attempts++;
    }

    const { data: newUser, error: createErr } = await supabase.from('users').insert({
      will_id, phone_hash, email_hash, phone_verified: true, email_verified: true, mode: 'ghost', kyc_verified: false,
      signup_completed: false, will_id_locked: false, terms_accepted: true, terms_accepted_at: new Date().toISOString(),
      privacy_accepted: true, privacy_accepted_at: new Date().toISOString(), subscription_tier: 'free', account_status: 'active'
    }).select('id, will_id').single();

    if (createErr) throw createErr;

    res.status(201).json({ status: 'ok', message: 'Verified! Your anonymous ID is ready.', user_id: newUser.id, default_will_id: newUser.will_id, next: 'POST /api/auth/claim-id' });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message, details: err.details || null });
  }
});

app.post('/api/auth/claim-id', async (req, res) => {
  try {
    const { user_id, will_id } = req.body;
    if (!user_id || !will_id) return res.status(400).json({ status: 'error', message: 'user_id and will_id required' });

    const { data: clash } = await supabase.from('users').select('id').eq('will_id', will_id).maybeSingle();
    if (clash) return res.status(400).json({ status: 'error', message: 'Will ID taken' });

    const { data: updated, error: updateErr } = await supabase.from('users').update({ will_id, will_id_locked: true, signup_completed: true }).eq('id', user_id).select('id, will_id, mode, created_at').single();
    if (updateErr) throw updateErr;

    res.json({ status: 'ok', message: 'Welcome to WETIN', user: updated });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

app.post('/api/panic/report', async (req, res) => {
  try {
    const { reporter_id, target_type, target_id, target_user_id, context, notes } = req.body;
    if (!reporter_id || !target_type || !target_id) return res.status(400).json({ status: 'error', message: 'reporter_id, target_type, target_id required' });

    const { data: existing } = await supabase.from('panic_reports').select('id').eq('reporter_id', reporter_id).eq('target_type', target_type).eq('target_id', target_id).maybeSingle();
    if (existing) return res.status(400).json({ status: 'error', message: 'You already reported this' });

    await supabase.from('panic_reports').insert({ reporter_id, target_type, target_id, target_user_id, context, notes, status: 'open' });

    const { count: reportCount } = await supabase.from('panic_reports').select('*', { count: 'exact', head: true }).eq('target_type', target_type).eq('target_id', target_id);
    const threshold = target_type === 'chat' ? 1 : 5;
    const shouldFreeze = reportCount >= threshold;

    const { data: freeze } = await supabase.from('freeze_status').select('*').eq('target_type', target_type).eq('target_id', target_id).maybeSingle();

    if (!freeze) {
      await supabase.from('freeze_status').insert({ target_type, target_id, target_user_id, report_count: reportCount, is_frozen: shouldFreeze, frozen_at: shouldFreeze ? new Date().toISOString() : null, suspend_deadline: shouldFreeze ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() : null });
    } else {
      await supabase.from('freeze_status').update({ report_count: reportCount, is_frozen: shouldFreeze || freeze.is_frozen }).eq('id', freeze.id);
    }

    if (shouldFreeze && target_user_id) {
      await supabase.from('users').update({ account_status: 'suspended', suspended_at: new Date().toISOString(), ban_deadline: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() }).eq('id', target_user_id);
    }

    res.json({ status: 'ok', message: shouldFreeze ? 'Account suspended for review.' : 'Report received. Under review.', report_count: reportCount, threshold, frozen: shouldFreeze, remaining_reports_needed: Math.max(0, threshold - reportCount) });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

app.post('/api/panic/appeal', async (req, res) => {
  try {
    const { user_id, appeal_text } = req.body;
    if (!user_id || !appeal_text) return res.status(400).json({ status: 'error', message: 'user_id and appeal_text required' });

    const { data: user } = await supabase.from('users').select('account_status').eq('id', user_id).maybeSingle();
    if (!user) return res.status(404).json({ status: 'error', message: 'User not found' });
    if (user.account_status !== 'suspended') return res.status(400).json({ status: 'error', message: 'Account is not suspended' });

    const { data: appeal, error } = await supabase.from('appeals').insert({ user_id, appeal_text, status: 'pending' }).select('id, created_at').single();
    if (error) throw error;

    res.status(201).json({ status: 'ok', message: 'Appeal submitted.', appeal });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

app.get('/api/panic/status/:user_id', async (req, res) => {
  try {
    const { data: user } = await supabase.from('users').select('id, will_id, account_status, suspended_at, ban_deadline, banned_at, ban_reason').eq('id', req.params.user_id).maybeSingle();
    if (!user) return res.status(404).json({ status: 'error', message: 'User not found' });
    res.json({ status: 'ok', user });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

app.get('/api/admin/panic/list', async (req, res) => {
  try {
    const { data, error } = await supabase.from('panic_reports').select('*').eq('status', 'open').order('created_at', { ascending: false });
    if (error) throw error;
    res.json({ status: 'ok', count: data.length, reports: data });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

app.post('/api/admin/panic/review', async (req, res) => {
  try {
    const { user_id, decision, notes } = req.body;
    if (!user_id || !decision) return res.status(400).json({ status: 'error', message: 'user_id and decision required' });

    if (decision === 'release') {
      await supabase.from('users').update({ account_status: 'active', suspended_at: null, ban_deadline: null }).eq('id', user_id);
      await supabase.from('freeze_status').update({ is_frozen: false, decision: 'released', decided_at: new Date().toISOString(), decided_by: 'admin', decision_notes: notes || null }).eq('target_user_id', user_id);
    } else if (decision === 'ban') {
      await supabase.from('users').update({ account_status: 'banned', banned_at: new Date().toISOString(), ban_reason: notes || 'Community guidelines violation' }).eq('id', user_id);
      await supabase.from('freeze_status').update({ is_frozen: true, decision: 'banned', decided_at: new Date().toISOString(), decided_by: 'admin', decision_notes: notes || null }).eq('target_user_id', user_id);
    } else {
      return res.status(400).json({ status: 'error', message: 'decision must be release or ban' });
    }

    await supabase.from('panic_reports').update({ status: 'resolved', resolved_at: new Date().toISOString() }).eq('target_user_id', user_id).eq('status', 'open');
    res.json({ status: 'ok', message: 'Decision applied: ' + decision });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

app.post('/api/upload/sign', async (req, res) => {
  try {
    const { user_id, content_type } = req.body;
    if (!user_id) return res.status(400).json({ status: 'error', message: 'user_id required' });

    const { data: user } = await supabase.from('users').select('account_status').eq('id', user_id).maybeSingle();
    if (!user || user.account_status !== 'active') {
      return res.status(403).json({ status: 'error', message: 'Account is not active' });
    }

    const timestamp = Math.round(Date.now() / 1000);
    const folder = content_type === 'long' ? 'wetin/long' : 'wetin/short';

    const signature = cloudinary.utils.api_sign_request(
      { timestamp, folder },
      process.env.CLOUDINARY_API_SECRET
    );

    res.json({
      status: 'ok',
      upload_url: 'https://api.cloudinary.com/v1_1/' + process.env.CLOUDINARY_CLOUD_NAME + '/video/upload',
      signature,
      timestamp,
      folder,
      api_key: process.env.CLOUDINARY_API_KEY
    });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

app.post('/api/videos', async (req, res) => {
  try {
    const { user_id, video_url, thumbnail_url, caption, duration_seconds, aspect_ratio, orientation, content_type, video_hash, is_duet, parent_video_id } = req.body;

    if (!user_id || !video_url) return res.status(400).json({ status: 'error', message: 'user_id and video_url required' });

    const { data: user } = await supabase.from('users').select('account_status').eq('id', user_id).maybeSingle();
    if (!user) return res.status(404).json({ status: 'error', message: 'User not found' });
    if (user.account_status !== 'active') return res.status(403).json({ status: 'error', message: 'Account is not active' });

    if (content_type === 'short' && duration_seconds > 60) return res.status(400).json({ status: 'error', message: 'Short videos must be 60 seconds or less' });
    if (content_type === 'long' && duration_seconds > 1500) return res.status(400).json({ status: 'error', message: 'Long videos must be 25 minutes or less' });

    if (video_hash) {
      const { data: existingVideo } = await supabase.from('videos').select('id').eq('video_hash', video_hash).maybeSingle();
      if (existingVideo) return res.status(400).json({ status: 'error', message: 'This video already exists on WETIN' });
    }

    if (is_duet && parent_video_id) {
      const { data: parent } = await supabase.from('videos').select('id, allow_duets, user_id').eq('id', parent_video_id).maybeSingle();
      if (!parent) return res.status(404).json({ status: 'error', message: 'Original video not found' });
      if (!parent.allow_duets) return res.status(403).json({ status: 'error', message: 'Duets are not allowed on this video' });

      const { data: approval } = await supabase.from('duet_requests').select('status').eq('requester_id', user_id).eq('original_video_id', parent_video_id).maybeSingle();
      if (!approval || approval.status !== 'approved') return res.status(403).json({ status: 'error', message: 'You need approval from the original creator' });
    }

    const { data: newVideo, error: insertErr } = await supabase.from('videos').insert({
      user_id, video_url, thumbnail_url, caption, duration_sec: duration_seconds,
      aspect_ratio: aspect_ratio || 'portrait', orientation: orientation || 'vertical',
      content_type: content_type || 'short', video_hash, is_duet: is_duet || false,
      parent_video_id: parent_video_id || null, moderation_flag: 'clean'
    }).select('id, created_at').single();

    if (insertErr) throw insertErr;
    res.status(201).json({ status: 'ok', message: 'Video posted', video: newVideo });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message, details: err.details || null });
  }
});

app.get('/api/videos/feed', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;
    const contentType = req.query.type || 'short';

    let query = supabase.from('videos').select('id, user_id, video_url, thumbnail_url, caption, duration_sec, orientation, content_type, is_duet, parent_video_id, resonance_count, comment_count, created_at').eq('is_removed', false).eq('is_frozen', false).eq('moderation_flag', 'clean').order('created_at', { ascending: false }).limit(limit);
    if (contentType !== 'all') query = query.eq('content_type', contentType);

    const { data: videos, error } = await query;
    if (error) throw error;

    const formattedVideos = [];
    for (const video of videos) {
      const { data: user } = await supabase.from('users').select('id, will_id, mode, display_name, real_name').eq('id', video.user_id).maybeSingle();
      formattedVideos.push({ ...video, creator: formatUserForViewer(user) });
    }

    res.json({ status: 'ok', count: formattedVideos.length, videos: formattedVideos });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

app.get('/api/videos/:id', async (req, res) => {
  try {
    const { data: video, error } = await supabase.from('videos').select('*').eq('id', req.params.id).maybeSingle();
    if (error) throw error;
    if (!video) return res.status(404).json({ status: 'error', message: 'Video not found' });

    const { data: user } = await supabase.from('users').select('id, will_id, mode, display_name, real_name').eq('id', video.user_id).maybeSingle();
    res.json({ status: 'ok', video: { ...video, creator: formatUserForViewer(user) } });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

app.get('/api/videos/:id/stats', async (req, res) => {
  try {
    const { data: video } = await supabase.from('videos').select('id, resonance_count, comment_count').eq('id', req.params.id).maybeSingle();
    if (!video) return res.status(404).json({ status: 'error', message: 'Video not found' });
    res.json({ status: 'ok', stats: { resonance: video.resonance_count || 0, comments: video.comment_count || 0 } });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

app.post('/api/comments', async (req, res) => {
  try {
    const { user_id, video_id, content, parent_id } = req.body;
    if (!user_id || !video_id || !content) return res.status(400).json({ status: 'error', message: 'user_id, video_id, content required' });
    if (content.length > 500) return res.status(400).json({ status: 'error', message: 'Comment too long (max 500 chars)' });

    const { data: user } = await supabase.from('users').select('account_status').eq('id', user_id).maybeSingle();
    if (!user) return res.status(404).json({ status: 'error', message: 'User not found' });
    if (user.account_status !== 'active') return res.status(403).json({ status: 'error', message: 'Account is not active' });

    const { data: video } = await supabase.from('videos').select('id, comment_count').eq('id', video_id).maybeSingle();
    if (!video) return res.status(404).json({ status: 'error', message: 'Video not found' });

    const { data: comment, error } = await supabase.from('comments').insert({ user_id, video_id, content, parent_id: parent_id || null }).select('id, created_at').single();
    if (error) throw error;

    await supabase.from('videos').update({ comment_count: (video.comment_count || 0) + 1 }).eq('id', video_id);

    res.status(201).json({ status: 'ok', message: 'Comment posted', comment });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

app.get('/api/comments/:video_id', async (req, res) => {
  try {
    const { data: comments, error } = await supabase.from('comments').select('id, user_id, content, parent_id, created_at').eq('video_id', req.params.video_id).eq('is_removed', false).eq('is_frozen', false).order('created_at', { ascending: false }).limit(100);
    if (error) throw error;

    const formatted = [];
    for (const comment of comments) {
      const { data: user } = await supabase.from('users').select('id, will_id, mode, display_name, real_name').eq('id', comment.user_id).maybeSingle();
      formatted.push({ ...comment, author: formatUserForViewer(user) });
    }

    res.json({ status: 'ok', count: formatted.length, comments: formatted });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

app.delete('/api/comments/:id', async (req, res) => {
  try {
    const { user_id } = req.body;
    if (!user_id) return res.status(400).json({ status: 'error', message: 'user_id required' });

    const { data: comment } = await supabase.from('comments').select('user_id, video_id').eq('id', req.params.id).maybeSingle();
    if (!comment) return res.status(404).json({ status: 'error', message: 'Comment not found' });
    if (comment.user_id !== user_id) return res.status(403).json({ status: 'error', message: 'Not your comment' });

    await supabase.from('comments').update({ is_removed: true }).eq('id', req.params.id);
    res.json({ status: 'ok', message: 'Comment deleted' });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

app.post('/api/resonance', async (req, res) => {
  try {
    const { user_id, video_id } = req.body;
    if (!user_id || !video_id) return res.status(400).json({ status: 'error', message: 'user_id and video_id required' });

    const { data: user } = await supabase.from('users').select('account_status').eq('id', user_id).maybeSingle();
    if (!user) return res.status(404).json({ status: 'error', message: 'User not found' });
    if (user.account_status !== 'active') return res.status(403).json({ status: 'error', message: 'Account is not active' });

    const { data: video } = await supabase.from('videos').select('id, user_id, resonance_count').eq('id', video_id).maybeSingle();
    if (!video) return res.status(404).json({ status: 'error', message: 'Video not found' });

    const { data: existing } = await supabase.from('resonance').select('id').eq('user_id', user_id).eq('video_id', video_id).maybeSingle();

    if (existing) {
      await supabase.from('resonance').delete().eq('id', existing.id);
      const newCount = Math.max(0, (video.resonance_count || 0) - 1);
      await supabase.from('videos').update({ resonance_count: newCount }).eq('id', video_id);
      return res.json({ status: 'ok', action: 'unliked', resonance_count: newCount });
    } else {
      await supabase.from('resonance').insert({ user_id, video_id });
      const newCount = (video.resonance_count || 0) + 1;
      await supabase.from('videos').update({ resonance_count: newCount }).eq('id', video_id);
      return res.json({ status: 'ok', action: 'liked', resonance_count: newCount });
    }
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

app.get('/api/resonance/:video_id/:user_id', async (req, res) => {
  try {
    const { data } = await supabase.from('resonance').select('id').eq('user_id', req.params.user_id).eq('video_id', req.params.video_id).maybeSingle();
    res.json({ status: 'ok', has_resonated: !!data });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

app.post('/api/videos/:id/allow-duets', async (req, res) => {
  try {
    const { user_id, allow } = req.body;
    const video_id = req.params.id;
    if (!user_id || typeof allow !== 'boolean') return res.status(400).json({ status: 'error', message: 'user_id and allow (boolean) required' });

    const { data: video } = await supabase.from('videos').select('user_id').eq('id', video_id).maybeSingle();
    if (!video) return res.status(404).json({ status: 'error', message: 'Video not found' });
    if (video.user_id !== user_id) return res.status(403).json({ status: 'error', message: 'Not your video' });

    await supabase.from('videos').update({ allow_duets: allow }).eq('id', video_id);
    res.json({ status: 'ok', message: allow ? 'Duets enabled' : 'Duets disabled', allow_duets: allow });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

app.post('/api/duet/request', async (req, res) => {
  try {
    const { requester_id, original_video_id, message } = req.body;
    if (!requester_id || !original_video_id) return res.status(400).json({ status: 'error', message: 'requester_id and original_video_id required' });

    const { data: video } = await supabase.from('videos').select('user_id, allow_duets').eq('id', original_video_id).maybeSingle();
    if (!video) return res.status(404).json({ status: 'error', message: 'Video not found' });
    if (!video.allow_duets) return res.status(403).json({ status: 'error', message: 'Duets are not allowed on this video' });
    if (video.user_id === requester_id) return res.status(400).json({ status: 'error', message: 'Cannot duet your own video' });

    const { data: existing } = await supabase.from('duet_requests').select('id, status').eq('requester_id', requester_id).eq('original_video_id', original_video_id).maybeSingle();
    if (existing) return res.status(400).json({ status: 'error', message: 'Request already exists', current_status: existing.status });

    const expires_at = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: request, error } = await supabase.from('duet_requests').insert({ requester_id, original_video_id, original_creator_id: video.user_id, message: message || null, expires_at }).select('id, created_at, expires_at').single();

    if (error) throw error;
    res.status(201).json({ status: 'ok', message: 'Duet request sent', request });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

app.get('/api/duet/requests/:user_id', async (req, res) => {
  try {
    const { data: requests, error } = await supabase.from('duet_requests').select('*').eq('original_creator_id', req.params.user_id).eq('status', 'pending').order('requested_at', { ascending: false });
    if (error) throw error;
    res.json({ status: 'ok', count: requests.length, requests });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

app.post('/api/duet/respond', async (req, res) => {
  try {
    const { request_id, user_id, decision } = req.body;
    if (!request_id || !user_id || !decision) return res.status(400).json({ status: 'error', message: 'request_id, user_id, decision required' });
    if (decision !== 'approve' && decision !== 'deny') return res.status(400).json({ status: 'error', message: 'decision must be approve or deny' });

    const { data: request } = await supabase.from('duet_requests').select('*').eq('id', request_id).maybeSingle();
    if (!request) return res.status(404).json({ status: 'error', message: 'Request not found' });
    if (request.original_creator_id !== user_id) return res.status(403).json({ status: 'error', message: 'Not your video' });
    if (request.status !== 'pending') return res.status(400).json({ status: 'error', message: 'Request already ' + request.status });

    const newStatus = decision === 'approve' ? 'approved' : 'denied';
    await supabase.from('duet_requests').update({ status: newStatus, responded_at: new Date().toISOString() }).eq('id', request_id);

    res.json({ status: 'ok', message: 'Duet ' + newStatus, decision: newStatus });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

app.get('/', (req, res) => res.send('WETIN backend is running'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('WETIN server running on port ' + PORT));
