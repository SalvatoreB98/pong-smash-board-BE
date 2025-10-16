// /api/update-active-competition.js
const { createClient } = require('@supabase/supabase-js');
const applyCors = require('./cors');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const getBearer = (req) => {
  const h = req.headers?.authorization || req.headers?.Authorization || '';
  if (!h.startsWith('Bearer ')) return null;
  return h.slice('Bearer '.length).trim();
};

module.exports = (req, res) => {
  applyCors(req, res, async () => {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const token = getBearer(req);
    if (!token) return res.status(401).json({ error: 'Missing Bearer token' });

    const { data: auth, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !auth?.user) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    const user = auth.user;
    const { competitionId } = req.body || {};

    if (competitionId === undefined) {
      return res.status(400).json({ error: 'Missing competitionId' });
    }

    const normalizedId =
      competitionId === null || competitionId === '' ? null : Number(competitionId);

    if (normalizedId !== null && Number.isNaN(normalizedId)) {
      return res.status(400).json({ error: 'Invalid competitionId' });
    }

    try {
      if (normalizedId !== null) {
        const { data: competition, error: compErr } = await supabase
          .from('competitions')
          .select('*')
          .eq('id', normalizedId)
          .maybeSingle();

        if (compErr) throw compErr;
        if (!competition) {
          return res.status(404).json({ error: 'Competition not found' });
        }

        const isOwner =
          competition.created_by === user.id || competition.createdBy === user.id;

        if (!isOwner) {
          const { data: profile, error: profileErr } = await supabase
            .from('v_user_profile')
            .select('player_id')
            .eq('user_id', user.id)
            .maybeSingle();

          if (profileErr) throw profileErr;

          const playerId = profile?.player_id;
          if (!playerId) {
            return res
              .status(403)
              .json({ error: 'User is not associated with any player profile' });
          }

          const { data: relation, error: relErr } = await supabase
            .from('competitions_players')
            .select('id')
            .eq('competition_id', normalizedId)
            .eq('player_id', playerId)
            .maybeSingle();

          if (relErr) throw relErr;
          if (!relation) {
            return res
              .status(403)
              .json({ error: 'User is not part of this competition' });
          }
        }
      }

      const { data, error } = await supabase
        .from('user_state')
        .upsert(
          {
            user_id: user.id,
            active_competition_id: normalizedId,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id' }
        )
        .select('id, user_id, state, active_competition_id, updated_at, created_at')
        .single();

      if (error) throw error;

      return res.status(200).json({
        message: 'Active competition updated',
        userState: data,
      });
    } catch (err) {
      console.error('update-active-competition error:', err?.message || err);
      return res.status(500).json({ error: 'Failed to update active competition' });
    }
  });
};
