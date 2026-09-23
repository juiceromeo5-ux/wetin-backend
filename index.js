const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const { Resend } = require('resend');
const cloudinary = require('cloudinary').v2;

const app = express();
app.use(express.json());
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const resend = new Resend(process.env.RESEND_API_KEY);
cloudinary.config({ cloud_name: process.env.CLOUDINARY_CLOUD_NAME, api_key: process.env.CLOUDINARY_API_KEY, api_secret: process.env.CLOUDINARY_API_SECRET });

function hashValue(v) { return crypto.createHash('sha256').update(v).digest('hex'); }
function hashPassword(p) { const s = crypto.randomBytes(16).toString('hex'); const h = crypto.pbkdf2Sync(p, s, 10000, 64, 'sha512').toString('hex'); return s + ':' + h; }
function verifyPassword(p, stored) { try { const [s, h] = stored.split(':'); const c = crypto.pbkdf2Sync(p, s, 10000, 64, 'sha512').toString('hex'); return h === c; } catch (e) { return false; } }
function generateWillId() { return 'wetin-' + Math.floor(1000 + Math.random() * 9000); }
function generateOtp() { return Math.floor(100000 + Math.random() * 900000).toString(); }
function formatUserForViewer(user) {
  if (!user) return { anonymous: true, display: 'Someone' };
  if (user.mode === 'ghost') return { anonymous: true, display: 'Someone' };
  if (user.mode === 'shadow') return { anonymous: false, will_id: user.will_id, display: user.display_name };
  if (user.mode === 'open') return { anonymous: false, will_id: user.will_id, display: user.real_name, verified: true };
  return { anonymous: true, display: 'Someone' };
}
function encryptMessage(text) {
  const key = Buffer.from(process.env.MSG_ENCRYPTION_KEY || 'wetin-default-key-change-me-32bytes!', 'utf8').slice(0, 32);
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
}
function decryptMessage(encrypted) {
  try {
    const key = Buffer.from(process.env.MSG_ENCRYPTION_KEY || 'wetin-default-key-change-me-32bytes!', 'utf8').slice(0, 32);
    const parts = encrypted.split(':');
    const iv = Buffer.from(parts[0], 'hex');
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    let decrypted = decipher.update(parts[1], 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (e) { return '[encrypted]'; }
}

app.get('/api/health', (req, res) => res.json({ status: 'ok', app: 'WETIN' }));
app.get('/api/db-test', async (req, res) => {
  const { count, error } = await supabase.from('users').select('*', { count: 'exact', head: true });
  if (error) return res.status(500).json({ status: 'error', message: error.message });
  res.json({ status: 'ok', userCount: count });
});

app.post('/api/auth/start', async (req, res) => {
  try {
    const { email, phone, full_name, password, terms_accepted, privacy_accepted } = req.body;
    if (!email || !phone) return res.status(400).json({ status: 'error', message: 'Email and phone required' });
    if (!password || password.length < 6) return res.status(400).json({ status: 'error', message: 'Password must be at least 6 characters' });
    if (!terms_accepted || !privacy_accepted) return res.status(400).json({ status: 'error', message: 'Must accept Terms and Privacy' });
    const phone_hash = hashValue(phone);
    const email_hash = hashValue(email);
    const { data: phoneExists } = await supabase.from('users').select('id').eq('phone_hash', phone_hash).maybeSingle();
    if (phoneExists) return res.status(400).json({ status: 'error', message: 'Phone already registered' });
    const otp = generateOtp();
    const expires_at = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    await supabase.from('otp_codes').insert({ email_hash, phone_hash, code: otp, purpose: 'signup', expires_at, password_hash: hashPassword(password), full_name: full_name || null });
    let emailError = null;
    try {
      await resend.emails.send({ from: process.env.RESEND_FROM || 'onboarding@resend.dev', to: email, subject: 'Your WETIN verification code', html: '<div style="font-family:sans-serif;padding:24px;background:#0A0A0A;color:#F5F5F5;"><h1 style="color:#C6FF00;">WETIN</h1><p>Your verification code is:</p><h2 style="color:#C6FF00;font-size:32px;letter-spacing:4px;">' + otp + '</h2><p>Expires in 10 minutes.</p></div>' });
    } catch (emailErr) { emailError = emailErr.message || String(emailErr); }
    res.json({ status: 'ok', message: emailError ? 'OTP generated but email failed' : 'Verification code sent', email_error: emailError });
  } catch (err) { res.status(500).json({ status: 'error', message: err.message }); }
});

app.post('/api/auth/verify', async (req, res) => {
  try {
    const { email, phone, otp_code } = req.body;
    if (!email || !phone || !otp_code) return res.status(400).json({ status: 'error', message: 'Missing fields' });
    const phone_hash = hashValue(phone);
    const email_hash = hashValue(email);
    const { data: otpRecord } = await supabase.from('otp_codes').select('*').eq('email_hash', email_hash).eq('code', otp_code).eq('used', false).gte('expires_at', new Date().toISOString()).order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (!otpRecord) return res.status(400).json({ status: 'error', message: 'Invalid or expired OTP' });
    await supabase.from('otp_codes').update({ used: true }).eq('id', otpRecord.id);
    let will_id; let attempts = 0;
    while (attempts < 5) {
      will_id = generateWillId();
      const { data: clash } = await supabase.from('users').select('id').eq('will_id', will_id).maybeSingle();
      if (!clash) break;
      attempts++;
    }
    const { data: newUser, error: createErr } = await supabase.from('users').insert({
      will_id, phone_hash, email_hash, phone_verified: true, email_verified: true, mode: 'ghost', kyc_verified: false,
      signup_completed: false, will_id_locked: false, terms_accepted: true, terms_accepted_at: new Date().toISOString(),
      privacy_accepted: true, privacy_accepted_at: new Date().toISOString(), subscription_tier: 'free', account_status: 'active',
      password_hash: otpRecord.password_hash || null, full_name: otpRecord.full_name || null
    }).select('id, will_id').single();
    if (createErr) throw createErr;
    res.status(201).json({ status: 'ok', user_id: newUser.id, default_will_id: newUser.will_id });
  } catch (err) { res.status(500).json({ status: 'error', message: err.message, details: err.details || null }); }
});

// FIXED LOGIN — handles multiple accounts per email
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ status: 'error', message: 'Email and password required' });
    const email_hash = hashValue(email);

    const { data: users, error } = await supabase
      .from('users')
      .select('id, will_id, mode, display_name, password_hash, account_status, signup_completed')
      .eq('email_hash', email_hash);

    if (error) throw error;
    if (!users || users.length === 0) return res.status(400).json({ status: 'error', message: 'No account with this email' });

    const matchedUser = users.find(u => u.password_hash && verifyPassword(password, u.password_hash));
    if (!matchedUser) return res.status(400).json({ status: 'error', message: 'Wrong password' });
    if (matchedUser.account_status === 'banned') return res.status(403).json({ status: 'error', message: 'Account banned' });

    res.json({
      status: 'ok',
      user: {
        user_id: matchedUser.id,
        will_id: matchedUser.will_id,
        mode: matchedUser.mode,
        display_name: matchedUser.display_name,
        signup_completed: matchedUser.signup_completed
      }
    });
  } catch (err) { res.status(500).json({ status: 'error', message: err.message }); }
});

app.post('/api/auth/claim-id', async (req, res) => {
  try {
    const { user_id, will_id } = req.body;
    if (!user_id || !will_id) return res.status(400).json({ status: 'error', message: 'Missing fields' });
    const { data: clash } = await supabase.from('users').select('id').eq('will_id', will_id).maybeSingle();
    if (clash) return res.status(400).json({ status: 'error', message: 'Will ID taken' });
    const { data: updated, error } = await supabase.from('users').update({ will_id, will_id_locked: true, signup_completed: true }).eq('id', user_id).select('id, will_id, mode, created_at').single();
    if (error) throw error;
    res.json({ status: 'ok', message: 'Welcome to WETIN', user: updated });
  } catch (err) { res.status(500).json({ status: 'error', message: err.message }); }
});

app.get('/api/users/search', async (req, res) => {
  try {
    const { q, user_id } = req.query;
    if (!q || q.length < 2) return res.status(400).json({ status: 'error', message: 'Query min 2 chars' });
    const { data: users } = await supabase.from('users').select('id, will_id, mode, display_name, real_name').or('mode.eq.shadow,mode.eq.open').eq('account_status', 'active').or('will_id.ilike.%' + q + '%,display_name.ilike.%' + q + '%,real_name.ilike.%' + q + '%').limit(20);
    const results = (users || []).filter(u => u.id !== user_id).map(u => ({ ...formatUserForViewer(u), user_id: u.id }));
    res.json({ status: 'ok', count: results.length, results });
  } catch (err) { res.status(500).json({ status: 'error', message: err.message }); }
});

app.post('/api/chats/start', async (req, res) => {
  try {
    const { initiator_id, target_id } = req.body;
    if (!initiator_id || !target_id) return res.status(400).json({ status: 'error', message: 'Missing fields' });
    if (initiator_id === target_id) return res.status(400).json({ status: 'error', message: 'Cannot chat with yourself' });
    const { data: existing } = await supabase.from('chats').select('id, expires_ui_at').or(`and(user_a_id.eq.${initiator_id},user_b_id.eq.${target_id}),and(user_a_id.eq.${target_id},user_b_id.eq.${initiator_id})`).maybeSingle();
    if (existing && new Date(existing.expires_ui_at) > new Date()) return res.json({ status: 'ok', chat_id: existing.id, existing: true });
    const now = new Date();
    const expires_ui_at = new Date(now.getTime() + 14 * 86400000).toISOString();
    const expires_backend_at = new Date(now.getTime() + 170 * 86400000).toISOString();
    const { data: chat, error } = await supabase.from('chats').insert({ user_a_id: initiator_id, user_b_id: target_id, initiator_id, is_locked: true, consecutive_initiator_msgs: 0, expires_ui_at, expires_backend_at }).select('id, created_at, expires_ui_at').single();
    if (error) throw error;
    res.status(201).json({ status: 'ok', chat });
  } catch (err) { res.status(500).json({ status: 'error', message: err.message }); }
});

app.get('/api/chats', async (req, res) => {
  try {
    const { user_id } = req.query;
    if (!user_id) return res.status(400).json({ status: 'error', message: 'user_id required' });
    const { data: chats } = await supabase.from('chats').select('*').or(`user_a_id.eq.${user_id},user_b_id.eq.${user_id}`).gte('expires_ui_at', new Date().toISOString()).order('created_at', { ascending: false }).limit(100);
    const formatted = [];
    for (const chat of chats || []) {
      const other_id = chat.user_a_id === user_id ? chat.user_b_id : chat.user_a_id;
      const { data: otherUser } = await supabase.from('users').select('id, will_id, mode, display_name, real_name').eq('id', other_id).maybeSingle();
      const { data: lastMsg } = await supabase.from('messages').select('content_encrypted, message_type, created_at, sender_id').eq('chat_id', chat.id).order('created_at', { ascending: false }).limit(1).maybeSingle();
      formatted.push({ chat_id: chat.id, other_user: { ...formatUserForViewer(otherUser), user_id: other_id }, is_locked: chat.is_locked, expires_at: chat.expires_ui_at, last_message: lastMsg ? { preview: lastMsg.message_type.startsWith('system') ? lastMsg.content_encrypted : decryptMessage(lastMsg.content_encrypted), type: lastMsg.message_type, created_at: lastMsg.created_at, from_me: lastMsg.sender_id === user_id } : null });
    }
    res.json({ status: 'ok', count: formatted.length, chats: formatted });
  } catch (err) { res.status(500).json({ status: 'error', message: err.message }); }
});

app.get('/api/chats/:id/messages', async (req, res) => {
  try {
    const { user_id } = req.query;
    const { data: chat } = await supabase.from('chats').select('*').eq('id', req.params.id).maybeSingle();
    if (!chat) return res.status(404).json({ status: 'error', message: 'Chat not found' });
    if (chat.user_a_id !== user_id && chat.user_b_id !== user_id) return res.status(403).json({ status: 'error', message: 'Not your chat' });
    if (new Date(chat.expires_ui_at) < new Date()) return res.json({ status: 'ok', expired: true, messages: [] });
    const { data: messages } = await supabase.from('messages').select('id, sender_id, content_encrypted, message_type, created_at').eq('chat_id', req.params.id).order('created_at', { ascending: true }).limit(500);
    const formatted = (messages || []).map(m => ({ id: m.id, from_me: m.sender_id === user_id, content: m.message_type.startsWith('system') ? m.content_encrypted : decryptMessage(m.content_encrypted), type: m.message_type, created_at: m.created_at }));
    res.json({ status: 'ok', is_locked: chat.is_locked, count: formatted.length, messages: formatted });
  } catch (err) { res.status(500).json({ status: 'error', message: err.message }); }
});

app.post('/api/chats/:id/messages', async (req, res) => {
  try {
    const { sender_id, content } = req.body;
    if (!sender_id || !content) return res.status(400).json({ status: 'error', message: 'Missing fields' });
    const { data: chat } = await supabase.from('chats').select('*').eq('id', req.params.id).maybeSingle();
    if (!chat) return res.status(404).json({ status: 'error', message: 'Chat not found' });
    if (chat.user_a_id !== sender_id && chat.user_b_id !== sender_id) return res.status(403).json({ status: 'error', message: 'Not your chat' });
    if (chat.frozen) return res.status(403).json({ status: 'error', message: 'Chat is frozen' });
    if (chat.is_locked && sender_id === chat.initiator_id && chat.consecutive_initiator_msgs >= 3) return res.status(429).json({ status: 'error', message: 'Wait for a reply' });
    const encrypted = encryptMessage(content);
    const { data: message } = await supabase.from('messages').insert({ chat_id: req.params.id, sender_id, content_encrypted: encrypted, message_type: 'text' }).select('id, created_at').single();
    const updates = {};
    if (sender_id === chat.initiator_id) updates.consecutive_initiator_msgs = (chat.consecutive_initiator_msgs || 0) + 1;
    else { updates.consecutive_initiator_msgs = 0; updates.is_locked = false; }
    await supabase.from('chats').update(updates).eq('id', req.params.id);
    res.status(201).json({ status: 'ok', message_id: message.id });
  } catch (err) { res.status(500).json({ status: 'error', message: err.message }); }
});

app.post('/api/panic/report', async (req, res) => {
  try {
    const { reporter_id, target_type, target_id, target_user_id, context, notes } = req.body;
    if (!reporter_id || !target_type || !target_id) return res.status(400).json({ status: 'error', message: 'Missing fields' });
    const { data: existing } = await supabase.from('panic_reports').select('id').eq('reporter_id', reporter_id).eq('target_type', target_type).eq('target_id', target_id).maybeSingle();
    if (existing) return res.status(400).json({ status: 'error', message: 'Already reported' });
    await supabase.from('panic_reports').insert({ reporter_id, target_type, target_id, target_user_id, context, notes, status: 'open' });
    const { count } = await supabase.from('panic_reports').select('*', { count: 'exact', head: true }).eq('target_type', target_type).eq('target_id', target_id);
    const threshold = target_type === 'chat' ? 1 : 5;
    const shouldFreeze = count >= threshold;
    if (shouldFreeze && target_user_id) await supabase.from('users').update({ account_status: 'suspended', suspended_at: new Date().toISOString(), ban_deadline: new Date(Date.now() + 30 * 86400000).toISOString() }).eq('id', target_user_id);
    res.json({ status: 'ok', report_count: count, threshold, frozen: shouldFreeze });
  } catch (err) { res.status(500).json({ status: 'error', message: err.message }); }
});

app.post('/api/panic/appeal', async (req, res) => {
  try {
    const { user_id, appeal_text } = req.body;
    const { data: user } = await supabase.from('users').select('account_status').eq('id', user_id).maybeSingle();
    if (!user || user.account_status !== 'suspended') return res.status(400).json({ status: 'error', message: 'Not suspended' });
    const { data: appeal } = await supabase.from('appeals').insert({ user_id, appeal_text, status: 'pending' }).select('id, created_at').single();
    res.status(201).json({ status: 'ok', appeal });
  } catch (err) { res.status(500).json({ status: 'error', message: err.message }); }
});

app.post('/api/upload/sign', async (req, res) => {
  try {
    const { user_id, content_type } = req.body;
    if (!user_id) return res.status(400).json({ status: 'error', message: 'user_id required' });
    const { data: user } = await supabase.from('users').select('account_status').eq('id', user_id).maybeSingle();
    if (!user || user.account_status !== 'active') return res.status(403).json({ status: 'error', message: 'Account not active' });
    const timestamp = Math.round(Date.now() / 1000);
    const folder = content_type === 'long' ? 'wetin/long' : 'wetin/short';
    const signature = cloudinary.utils.api_sign_request({ timestamp, folder }, process.env.CLOUDINARY_API_SECRET);
    res.json({ status: 'ok', upload_url: 'https://api.cloudinary.com/v1_1/' + process.env.CLOUDINARY_CLOUD_NAME + '/video/upload', signature, timestamp, folder, api_key: process.env.CLOUDINARY_API_KEY });
  } catch (err) { res.status(500).json({ status: 'error', message: err.message }); }
});

app.post('/api/videos', async (req, res) => {
  try {
    const { user_id, video_url, thumbnail_url, caption, duration_seconds, aspect_ratio, orientation, content_type, video_hash } = req.body;
    if (!user_id || !video_url) return res.status(400).json({ status: 'error', message: 'Missing fields' });
    const { data: user } = await supabase.from('users').select('account_status').eq('id', user_id).maybeSingle();
    if (!user || user.account_status !== 'active') return res.status(403).json({ status: 'error', message: 'Account not active' });
    if (content_type === 'short' && duration_seconds > 60) return res.status(400).json({ status: 'error', message: 'Short videos must be ≤ 60s' });
    if (content_type === 'long' && duration_seconds > 1500) return res.status(400).json({ status: 'error', message: 'Long videos must be ≤ 25 min' });
    if (video_hash) {
      const { data: existing } = await supabase.from('videos').select('id').eq('video_hash', video_hash).maybeSingle();
      if (existing) return res.status(400).json({ status: 'error', message: 'Video already exists' });
    }
    const { data: newVideo, error } = await supabase.from('videos').insert({ user_id, video_url, thumbnail_url, caption, duration_sec: duration_seconds, aspect_ratio: aspect_ratio || 'portrait', orientation: orientation || 'vertical', content_type: content_type || 'short', video_hash, moderation_flag: 'clean' }).select('id, created_at').single();
    if (error) throw error;
    res.status(201).json({ status: 'ok', video: newVideo });
  } catch (err) { res.status(500).json({ status: 'error', message: err.message }); }
});

app.get('/api/videos/feed', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;
    const contentType = req.query.type || 'short';
    let query = supabase.from('videos').select('id, user_id, video_url, thumbnail_url, caption, duration_sec, orientation, content_type, resonance_count, comment_count, created_at').eq('is_removed', false).eq('is_frozen', false).eq('moderation_flag', 'clean').order('created_at', { ascending: false }).limit(limit);
    if (contentType !== 'all') query = query.eq('content_type', contentType);
    const { data: videos, error } = await query;
    if (error) throw error;
    const formatted = [];
    for (const v of videos) {
      const { data: user } = await supabase.from('users').select('id, will_id, mode, display_name, real_name').eq('id', v.user_id).maybeSingle();
      formatted.push({ ...v, creator: formatUserForViewer(user) });
    }
    res.json({ status: 'ok', count: formatted.length, videos: formatted });
  } catch (err) { res.status(500).json({ status: 'error', message: err.message }); }
});

app.get('/api/videos/:id/stats', async (req, res) => {
  try {
    const { data: video } = await supabase.from('videos').select('id, resonance_count, comment_count').eq('id', req.params.id).maybeSingle();
    if (!video) return res.status(404).json({ status: 'error', message: 'Not found' });
    res.json({ status: 'ok', stats: { resonance: video.resonance_count || 0, comments: video.comment_count || 0 } });
  } catch (err) { res.status(500).json({ status: 'error', message: err.message }); }
});

app.post('/api/comments', async (req, res) => {
  try {
    const { user_id, video_id, content, parent_id } = req.body;
    if (!user_id || !video_id || !content) return res.status(400).json({ status: 'error', message: 'Missing fields' });
    const { data: user } = await supabase.from('users').select('account_status').eq('id', user_id).maybeSingle();
    if (!user || user.account_status !== 'active') return res.status(403).json({ status: 'error', message: 'Not active' });
    const { data: video } = await supabase.from('videos').select('id, comment_count').eq('id', video_id).maybeSingle();
    if (!video) return res.status(404).json({ status: 'error', message: 'Video not found' });
    const { data: comment } = await supabase.from('comments').insert({ user_id, video_id, content, parent_id: parent_id || null }).select('id, created_at').single();
    await supabase.from('videos').update({ comment_count: (video.comment_count || 0) + 1 }).eq('id', video_id);
    res.status(201).json({ status: 'ok', comment });
  } catch (err) { res.status(500).json({ status: 'error', message: err.message }); }
});

app.get('/api/comments/:video_id', async (req, res) => {
  try {
    const { data: comments } = await supabase.from('comments').select('id, user_id, content, parent_id, created_at').eq('video_id', req.params.video_id).eq('is_removed', false).order('created_at', { ascending: false }).limit(100);
    const formatted = [];
    for (const c of comments || []) {
      const { data: user } = await supabase.from('users').select('id, will_id, mode, display_name, real_name').eq('id', c.user_id).maybeSingle();
      formatted.push({ ...c, author: formatUserForViewer(user) });
    }
    res.json({ status: 'ok', count: formatted.length, comments: formatted });
  } catch (err) { res.status(500).json({ status: 'error', message: err.message }); }
});

app.post('/api/resonance', async (req, res) => {
  try {
    const { user_id, video_id } = req.body;
    if (!user_id || !video_id) return res.status(400).json({ status: 'error', message: 'Missing' });
    const { data: video } = await supabase.from('videos').select('id, resonance_count').eq('id', video_id).maybeSingle();
    if (!video) return res.status(404).json({ status: 'error', message: 'Not found' });
    const { data: existing } = await supabase.from('resonance').select('id').eq('user_id', user_id).eq('video_id', video_id).maybeSingle();
    if (existing) {
      await supabase.from('resonance').delete().eq('id', existing.id);
      const c = Math.max(0, (video.resonance_count || 0) - 1);
      await supabase.from('videos').update({ resonance_count: c }).eq('id', video_id);
      return res.json({ status: 'ok', action: 'unliked', resonance_count: c });
    } else {
      await supabase.from('resonance').insert({ user_id, video_id });
      const c = (video.resonance_count || 0) + 1;
      await supabase.from('videos').update({ resonance_count: c }).eq('id', video_id);
      return res.json({ status: 'ok', action: 'liked', resonance_count: c });
    }
  } catch (err) { res.status(500).json({ status: 'error', message: err.message }); }
});

app.post('/api/follow', async (req, res) => {
  try {
    const { follower_id, following_id } = req.body;
    if (!follower_id || !following_id || follower_id === following_id) return res.status(400).json({ status: 'error', message: 'Invalid' });
    const { data: existing } = await supabase.from('follows').select('id').eq('follower_id', follower_id).eq('following_id', following_id).maybeSingle();
    if (existing) { await supabase.from('follows').delete().eq('id', existing.id); return res.json({ status: 'ok', action: 'unfollowed' }); }
    await supabase.from('follows').insert({ follower_id, following_id });
    res.json({ status: 'ok', action: 'followed' });
  } catch (err) { res.status(500).json({ status: 'error', message: err.message }); }
});

app.get('/api/follow/stats/:user_id', async (req, res) => {
  try {
    const { count: f1 } = await supabase.from('follows').select('*', { count: 'exact', head: true }).eq('following_id', req.params.user_id);
    const { count: f2 } = await supabase.from('follows').select('*', { count: 'exact', head: true }).eq('follower_id', req.params.user_id);
    res.json({ status: 'ok', followers: f1 || 0, following: f2 || 0 });
  } catch (err) { res.status(500).json({ status: 'error', message: err.message }); }
});

app.get('/', (req, res) => res.send('WETIN backend is running'));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('WETIN server running on port ' + PORT));
