// /api/update-profile.js
const applyCors = require('./cors');
const { UserProgressStateEnum } = require('../utils/constants');
const supabase = require('../services/db');

const getBearer = (req) => {
  const h = req.headers?.authorization || req.headers?.Authorization || '';
  return h.startsWith('Bearer ') ? h.slice('Bearer '.length).trim() : null;
};

module.exports = (req, res) => {
  applyCors(req, res, async () => {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

    const token = getBearer(req);
    if (!token) return res.status(401).json({ error: 'Missing Bearer token' });

    const { data: auth, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !auth?.user) return res.status(401).json({ error: 'Invalid token' });
    const user = auth.user;

    const { 
      nickname, imageUrl, name, lastname, surname, birthDate, description, 
      playStyle, racketBlade, racketRubberFh, racketRubberBh, handedness 
    } = req.body || {};
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
      if (imageUrl !== undefined) payload.image_url = imageUrl;
      if (name !== undefined) payload.name = name;
      if (lastname !== undefined) payload.lastname = lastname;
      if (surname !== undefined && lastname === undefined) payload.lastname = surname;
      if (birthDate !== undefined) payload.birth_date = birthDate;
      if (description !== undefined) payload.description = description;
      if (playStyle !== undefined) payload.play_style = playStyle;
      if (racketBlade !== undefined) payload.racket_blade = racketBlade;
      if (racketRubberFh !== undefined) payload.racket_rubber_fh = racketRubberFh;
      if (racketRubberBh !== undefined) payload.racket_rubber_bh = racketRubberBh;
      if (handedness !== undefined) payload.handedness = handedness;

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
      console.error('update-profile error:', e);
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  });
};
