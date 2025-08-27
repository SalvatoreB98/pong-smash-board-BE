// /api/get-competitions.js
const { createClient } = require('@supabase/supabase-js');
const applyCors = require('./cors');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

// ---- helpers
const getBearer = (req) => {
  const h = req.headers?.authorization || req.headers?.Authorization || '';
  if (!h.startsWith('Bearer ')) return null;
  return h.slice('Bearer '.length).trim();
};

const uniqueBy = (arr, key = 'id') => {
  const map = new Map();
  for (const item of arr || []) {
    if (!item || item[key] == null) continue;
    if (!map.has(item[key])) map.set(item[key], item);
  }
  return Array.from(map.values());
};

module.exports = (req, res) => {
  applyCors(req, res, async () => {
    if (req.method !== 'GET') {
      return res.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
      // 1) Auth via Bearer
      const token = getBearer(req);
      if (!token) return res.status(401).json({ error: 'Missing Bearer token' });

      const { data: userData, error: userErr } = await supabase.auth.getUser(token);
      if (userErr || !userData?.user) {
        return res.status(401).json({ error: 'Invalid token' });
      }
      const user = userData.user;

      // 2) Trova il playerId “associato” a questo utente
      //    Prova più naming comuni: auth_user_id | user_id | uid
      let playerId = null;
      let playerRow = null;

      {
        const { data, error } = await supabase
          .from('players')
          .select('id, id, auth_user_id, user_id, uid, email')
          .or(
            [
              `auth_user_id.eq.${user.id}`,
              `user_id.eq.${user.id}`,
              `uid.eq.${user.id}`,
            ].join(',')
          )
          .limit(1)
          .maybeSingle();

        if (!error && data) {
          playerRow = data;
          playerId = data.playerid ?? data.id ?? null;
        }
      }

      if (!playerId && user.email) {
        const { data, error } = await supabase
          .from('players')
          .select('id, id, email')
          .eq('email', user.email)
          .limit(1)
          .maybeSingle();
        if (!error && data) {
          playerRow = data;
          playerId = data.playerid ?? data.id ?? null;
        }
      }

      const competitions = [];

      {
        const { data, error } = await supabase
          .from('competitions')
          .select('*')
          .eq('created_by', user.id);
        if (!error && data) competitions.push(...data);
      }
      //     Secondo tentativo: createdBy
      {
        const { data, error } = await supabase
          .from('competitions')
          .select('*')
          .eq('createdBy', user.id);
        if (!error && data) competitions.push(...data);
      }

      if (!playerId) {
        return res.status(200).json({
          player: null,
          competitions: uniqueBy(competitions),
          meta: { from: ['created_by/createdBy'], note: 'id non trovato per utente' },
        });
      }

      const collectCompIds = async (tableName) => {
        const out = new Set();
        const { data, error } = await supabase
          .from(tableName)
          .select('competition_id')
          .eq('player_id', playerId);
        if (!error && Array.isArray(data)) {
          for (const r of data) if (r?.competition_id) out.add(r.competition_id);
        } else if (error && error.code === '42P01') {
          console.warn(`Table ${tableName} not found, skipping.`);
        }
        return Array.from(out);
      };

      const compIdsFromPivot = [
        ...(await collectCompIds('competition_players'))];

      if (compIdsFromPivot.length) {
        const { data, error } = await supabase
          .from('competitions')
          .select('*')
          .in('id', compIdsFromPivot);
        if (!error && data) competitions.push(...data);
      }

      {
        const { data: matches, error } = await supabase
          .from('matches')
          .select('competition_id, player1_id, player2_id')
          .or(`player1_id.eq.${playerId},player2_id.eq.${playerId}`);
        if (!error && Array.isArray(matches)) {
          const ids = Array.from(
            new Set(matches.map(m => m.competition_id).filter(Boolean))
          );
          if (ids.length) {
            const { data, error: compErr } = await supabase
              .from('competitions')
              .select('*')
              .in('id', ids);
            if (!compErr && data) competitions.push(...data);
          }
        }
      }

      const final = uniqueBy(competitions).sort((a, b) => {
        const da = a?.start_date || a?.startDate || '';
        const db = b?.start_date || b?.startDate || '';
        return (db || '').localeCompare(da || '');
      });

      for (const comp of final) {
        const { data: players, error: pErr } = await supabase
          .from('competition_players')
          .select('player_id, players(id, name, email)')
          .eq('competition_id', comp.id);

        if (!pErr && players) {
          comp.players = players.map(p => p.players);
        } else {
          comp.players = [];
        }
      }

      return res.status(200).json({
        player: { playerId, playerRow },
        competitions: final,
        meta: { from: ['created_by/createdBy', 'pivot', 'matches'] },
      });
    } catch (err) {
      console.error('Error in get-competitions:', err?.message || err);
      return res.status(500).json({ error: 'Failed to fetch competitions.' });
    }
  });
};
