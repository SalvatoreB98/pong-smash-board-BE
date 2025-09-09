// /api/update-profile.js
const applyCors = require('./cors');
const { UserProgressStateEnum } = require('../utils/constants');
const supabase = require('../lib/supabase');
const { requireUser } = require('../lib/auth');
const handleError = require('../lib/error');

module.exports = (req, res) => {
  applyCors(req, res, async () => {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

    const user = await requireUser(req);

    const { nickname, imageUrl } = req.body || {};
    if (!nickname || nickname.length < 3 || nickname.length > 32) {
      return res.status(400).json({ error: 'Invalid nickname (3–32 chars)' });
    }

    try {
      // players: upsert by auth_user_id
      const { data: existing, error: selErr } = await supabase
        .from('players')
        .select('id')
        .eq('auth_user_id', user.id)
        .maybeSingle();
      if (selErr) throw selErr;

      const payload = { nickname };
      if (imageUrl) payload.image_url = imageUrl;

      if (existing) {
        const { error: upErr } = await supabase.from('players').update(payload).eq('id', existing.id);
        if (upErr) throw upErr;
      } else {
        const insert = { auth_user_id: user.id, email: user.email || null, ...payload };
        const { error: insErr } = await supabase.from('players').insert(insert);
        if (insErr) throw insErr;
      }

      const NEW_STATE = UserProgressStateEnum.PROFILE_COMPLETED;
      const { error: usErr } = await supabase
        .from('user_state')
        .upsert({ user_id: user.id, state: NEW_STATE, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
      if (usErr) throw usErr;

      return res.status(200).json({ message: 'Profile updated', nickname, imageUrl: imageUrl || null, state: NEW_STATE });
    } catch (e) {
      return handleError(res, e, 'Internal Server Error');
    }
  });
};
