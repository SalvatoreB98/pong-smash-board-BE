// /api/get-competitions.js
const applyCors = require('./cors');
const supabase = require('../services/db');

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

      // 2) Trova il playerId
      let playerId = null;
      let playerRow = null;

      const { data: playerData, error: playerError } = await supabase
        .from('players')
        .select('id, auth_user_id, email')
        .or(
          [
            `auth_user_id.eq.${user.id}`,
            `email.eq.${user.email}`
          ].join(',')
        )
        .limit(1)
        .maybeSingle();

      if (playerError) {
        console.error('Error fetching player:', playerError.message);
      }

      if (playerData) {
        playerRow = playerData;
        playerId = playerData.id;
      }

      // 3) Raccogli competitions in parallelo
      const [byCreated, byCreatedAlt, compFromPivot, compFromMatches] = await Promise.all([
        supabase.from('competitions').select('*').eq('created_by', user.id),
        supabase.from('competitions').select('*').eq('createdBy', user.id),
        playerId
          ? supabase
            .from('competitions_players')
            .select('competition_id')
            .eq('player_id', playerId)
          : { data: [] },
        playerId
          ? supabase
            .from('matches')
            .select('competition_id')
            .or(`player1_id.eq.${playerId},player2_id.eq.${playerId}`)
          : { data: [] }
      ]);

      let competitions = [];
      if (byCreated.data) competitions.push(...byCreated.data);
      if (byCreatedAlt.data) competitions.push(...byCreatedAlt.data);

      // competitions da pivot
      if (compFromPivot.data?.length) {
        const ids = compFromPivot.data.map(r => r.competition_id).filter(Boolean);
        if (ids.length) {
          const { data } = await supabase
            .from('competitions')
            .select('*')
            .in('id', ids);
          if (data) competitions.push(...data);
        }
      }

      // competitions da matches
      if (compFromMatches.data?.length) {
        const ids = Array.from(
          new Set(compFromMatches.data.map(m => m.competition_id).filter(Boolean))
        );
        if (ids.length) {
          const { data } = await supabase
            .from('competitions')
            .select('*')
            .in('id', ids);
          if (data) competitions.push(...data);
        }
      }

      // 4) Deduplica + sort
      const final = uniqueBy(competitions).sort((a, b) => {
        const da = a?.start_date || a?.startDate || '';
        const db = b?.start_date || b?.startDate || '';
        return (db || '').localeCompare(da || '');
      });

      // 5) Carica tutti i players con una sola query
      let playersByCompetition = {};
      if (final.length) {
        const { data: allPlayers } = await supabase
          .from('competitions_players')
          .select('competition_id, players(id, nickname, email, image_url)')
          .in('competition_id', final.map(c => c.id));

        if (allPlayers) {
          for (const row of allPlayers) {
            if (!playersByCompetition[row.competition_id]) {
              playersByCompetition[row.competition_id] = [];
            }
            playersByCompetition[row.competition_id].push(row.players);
          }
        }
      }

      for (const comp of final) {
        comp.players = playersByCompetition[comp.id] || [];
      }
      console.log('Player object from Supabase:', JSON.stringify(playerRow, null, 2));
      console.log('Final competitions array:', JSON.stringify(final, null, 2));

      return res.status(200).json({
        player: playerId ? { playerId, playerRow } : null,
        competitions: final,
        meta: { optimized: true }
      });
    } catch (err) {
      console.error('Error in get-competitions:', err?.message || err);
      return res.status(500).json({ error: 'Failed to fetch competitions.' });
    }
  });
};
