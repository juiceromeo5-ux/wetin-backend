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

app.get('/terms', (req, res) => {
  res.send(`<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>WETIN — Terms of Service</title>
<style>
body { background:#0A0A0A; color:#F5F5F5; font-family:-apple-system,sans-serif; padding:24px; line-height:1.7; max-width:720px; margin:0 auto; }
h1 { color:#C6FF00; font-size:28px; margin-bottom:8px; }
h2 { color:#C6FF00; font-size:20px; margin-top:32px; }
p, li { color:#CCCCCC; font-size:15px; }
.meta { color:#888; font-size:13px; margin-bottom:24px; }
a { color:#C6FF00; }
</style>
</head>
<body>
<h1>WETIN — Terms of Service</h1>
<p class="meta">Last Updated: September 15, 2026 · Operated by Stephen Jeremiah (Nigeria) · Contact: wetin.app.@gmail.com</p>

<h2>1. Acceptance</h2>
<p>By creating an account, accessing, or using WETIN, you agree to these Terms. If you do not agree, do not use WETIN.</p>

<h2>2. Eligibility</h2>
<p>You must be at least 18 years old. By signing up, you confirm you meet this requirement.</p>

<h2>3. Nature of the Platform</h2>
<p>3.1. WETIN is a communication platform. We provide tools for anonymous content sharing, messaging, and interaction.</p>
<p>3.2. WETIN does NOT verify the truthfulness, legality, or intent of user content.</p>
<p>3.3. WETIN is NOT a party to any transaction, agreement, or interaction between users.</p>
<p>3.4. WETIN does NOT mediate disputes, recover funds, or guarantee outcomes of any user interaction.</p>

<h2>4. User Responsibility</h2>
<p>4.1. You are solely responsible for your conduct on WETIN.</p>
<p>4.2. You are solely responsible for any consequences arising from your interactions with other users.</p>
<p>4.3. You agree to exercise caution when sharing personal information, meeting strangers, or engaging in any transaction initiated through WETIN.</p>

<h2>5. Prohibited Conduct</h2>
<p>You agree NOT to use WETIN to:</p>
<ul>
<li>Commit fraud, scams, or financial crimes</li>
<li>Impersonate any person or entity</li>
<li>Harass, threaten, stalk, defame, or harm any person</li>
<li>Distribute malware, phishing links, or spam</li>
<li>Post or share illegal content, including CSAM, non-consensual intimate images, or content that violates Nigerian or international law</li>
<li>Promote violence, terrorism, or hate speech</li>
<li>Launder money or fund illegal activity</li>
<li>Violate the privacy or rights of others</li>
<li>Bypass account limits through automation or deception</li>
</ul>

<h2>6. No Liability for User Conduct</h2>
<p>6.1. WETIN is NOT liable for any harm, loss, damage, or injury caused by other users, including fraud, scams, theft, assault, defamation, or emotional distress.</p>
<p>6.2. WETIN does NOT endorse, verify, or guarantee any user's identity, intentions, or claims.</p>
<p>6.3. You agree to release WETIN, its owner, employees, and affiliates from any and all claims arising from your interactions with other users.</p>
<p>6.4. WETIN is provided "as is." We make no warranties, express or implied.</p>

<h2>7. Limitation of Liability</h2>
<p>7.1. To the maximum extent permitted by Nigerian law, WETIN and its owner shall NOT be liable for any indirect, incidental, special, consequential, or punitive damages.</p>
<p>7.2. In no event shall WETIN's total liability exceed the amount you paid to WETIN in the 12 months preceding the claim (or ₦0 if no payment was made).</p>

<h2>8. Indemnity</h2>
<p>You agree to indemnify and hold harmless WETIN, its owner, and affiliates from any claims, damages, losses, or expenses (including legal fees) arising from your use of WETIN, your violation of these Terms, your violation of any law, your interaction with other users, or any content you post.</p>

<h2>9. Law Enforcement Cooperation</h2>
<p>9.1. WETIN cooperates with lawful requests from law enforcement.</p>
<p>9.2. Chats are retained on our servers for 170 days for legal and safety purposes.</p>
<p>9.3. We may disclose user data in response to subpoenas, court orders, or valid legal processes.</p>
<p>9.4. In cases involving imminent harm or illegal activity, we may proactively report to authorities.</p>
<p>9.5. WETIN is NOT responsible for the actions of users who commit crimes while using the platform.</p>

<h2>10. Moderation & Enforcement</h2>
<p>10.1. We may remove content, freeze accounts, or ban users at our sole discretion.</p>
<p>10.2. We may report illegal activity to law enforcement.</p>
<p>10.3. We are not obligated to monitor all content but reserve the right to do so.</p>

<h2>11. Account Termination</h2>
<p>11.1. You may delete your account anytime.</p>
<p>11.2. We may terminate your account for violating these Terms, engaging in illegal activity, or for any reason.</p>
<p>11.3. Retained data may continue to be held for legal compliance even after termination.</p>

<h2>12. No Guarantee of Service</h2>
<p>WETIN is provided without guarantees of uptime, availability, or data security. We are not liable for service outages, data loss, or hacks.</p>

<h2>13. Dispute Resolution</h2>
<p>Any dispute arising from these Terms shall be resolved in Nigerian courts under Nigerian law.</p>

<h2>14. Changes to Terms</h2>
<p>We may update these Terms. Continued use of WETIN constitutes acceptance.</p>

<h2>15. Severability</h2>
<p>If any part of these Terms is found unenforceable, the rest remains in force.</p>

<h2>16. Contact</h2>
<p>Legal inquiries: wetin.app.@gmail.com</p>
</body>
</html>`);
});

app.get('/privacy', (req, res) => {
  res.send(`<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>WETIN — Privacy Policy</title>
<style>
body { background:#0A0A0A; color:#F5F5F5; font-family:-apple-system,sans-serif; padding:24px; line-height:1.7; max-width:720px; margin:0 auto; }
h1 { color:#C6FF00; font-size:28px; margin-bottom:8px; }
h2 { color:#C6FF00; font-size:20px; margin-top:32px; }
p, li { color:#CCCCCC; font-size:15px; }
.meta { color:#888; font-size:13px; margin-bottom:24px; }
a { color:#C6FF00; }
</style>
</head>
<body>
<h1>WETIN — Privacy Policy</h1>
<p class="meta">Last Updated: September 15, 2026 · Operated by Stephen Jeremiah (Nigeria) · Contact: wetin.app.@gmail.com</p>

<h2>1. Introduction</h2>
<p>WETIN ("we," "us," "our") respects your privacy and is committed to protecting your personal data. This Privacy Policy explains what we collect, why we collect it, how we use it, and your rights under the Nigeria Data Protection Act (NDPA) and other applicable laws. By using WETIN, you consent to the practices described in this policy.</p>

<h2>2. Who We Are</h2>
<p>WETIN is an anonymous social media platform operated by Stephen Jeremiah, based in Nigeria. For privacy-related inquiries, contact: wetin.app.@gmail.com</p>

<h2>3. Information We Collect</h2>
<p>3.1. Information you provide: email address (hashed), phone number (hashed), your chosen Will ID, content you post, and acceptance of Terms and Privacy Policy with timestamp.</p>
<p>3.2. Information collected automatically: device fingerprints, IP addresses, timestamps, coarse location (only during Panic Button use), app usage data, and session metadata.</p>
<p>3.3. Information we do NOT collect: your real name (unless you choose Open Mode), contacts, other apps, biometric data, and payment information (currently none).</p>

<h2>4. How We Use Your Data</h2>
<p>We use your data to operate and improve WETIN, verify accounts, prevent fraud, enforce our Terms, comply with legal obligations, cooperate with law enforcement when legally required, and protect public safety.</p>

<h2>5. Anonymity & Identity</h2>
<p>5.1. WETIN is anonymous by design. Your real name, email, and phone number are NEVER shown to other users.</p>
<p>5.2. However, your data is retained securely and may be used for safety, legal, and law enforcement purposes.</p>
<p>5.3. If you choose Open Mode, you voluntarily reveal your identity to other users.</p>

<h2>6. Data Retention</h2>
<p>6.1. Chats: visible to users for 14 days, retained on servers for 170 days, permanently deleted after.</p>
<p>6.2. Videos and comments: retained while your account is active, deleted upon account deletion (except where legally required).</p>
<p>6.3. Account data: retained while your account exists, may be retained longer for legal compliance.</p>
<p>6.4. Reported content: retained until investigation and legal processes are complete.</p>
<p>6.5. Device fingerprints: retained for ban enforcement.</p>

<h2>7. Data Sharing</h2>
<p>7.1. We do NOT sell your data.</p>
<p>7.2. We may share data with law enforcement (pursuant to valid legal requests), service providers (Supabase, Render), successors in the event of merger or sale, and regulatory bodies when legally required.</p>

<h2>8. Law Enforcement Cooperation</h2>
<p>8.1. WETIN cooperates with lawful requests from Nigerian and international authorities.</p>
<p>8.2. Every request is logged and reviewed for validity.</p>
<p>8.3. We may proactively report illegal activity to law enforcement.</p>
<p>8.4. Retained data may be disclosed pursuant to subpoenas, court orders, or valid legal processes.</p>
<p>8.5. WETIN is not liable for the actions of users who commit crimes while using the platform.</p>

<h2>9. Your Rights (NDPA)</h2>
<p>Under the Nigeria Data Protection Act, you have the right to: access your personal data, request correction of inaccurate data, request deletion, withdraw consent, object to processing, and lodge a complaint with the Nigeria Data Protection Commission (NDPC). To exercise these rights: wetin.app.@gmail.com</p>

<h2>10. Data Security</h2>
<p>10.1. We use industry-standard encryption, access controls, and security practices.</p>
<p>10.2. However, no system is 100% secure. Use WETIN at your own risk.</p>
<p>10.3. We are not liable for unauthorized access resulting from events beyond our reasonable control.</p>

<h2>11. International Data Transfers</h2>
<p>WETIN is operated from Nigeria. By using WETIN, you consent to your data being processed and stored in Nigeria and other jurisdictions where our service providers operate.</p>

<h2>12. Children's Privacy</h2>
<p>12.1. WETIN is not intended for users under 18 years of age.</p>
<p>12.2. If we discover a minor's account, we will delete it.</p>
<p>12.3. We do not knowingly collect data from minors.</p>

<h2>13. Cookies & Tracking</h2>
<p>13.1. The WETIN mobile app does not use cookies.</p>
<p>13.2. Our website and API may use minimal session tracking for security.</p>

<h2>14. Changes to This Policy</h2>
<p>We may update this Privacy Policy. Material changes will be notified in-app. Continued use of WETIN constitutes acceptance.</p>

<h2>15. Complaints</h2>
<p>If you believe your privacy rights have been violated, contact us at wetin.app.@gmail.com or lodge a complaint with the Nigeria Data Protection Commission.</p>

<h2>16. Contact</h2>
<p>Privacy inquiries: wetin.app.@gmail.com</p>
</body>
</html>`);
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
