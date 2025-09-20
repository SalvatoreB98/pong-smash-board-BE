// /api/add-competition.js
const { createClient } = require('@supabase/supabase-js');
const applyCors = require('./cors');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const { formatDateForDB } = require('../utils/utils');

const normalizeDate = (d) => {
  if (!d) return null;
  try { return formatDateForDB ? formatDateForDB(d) : new Date(d).toISOString().slice(0, 10); }
  catch { return null; }
};

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

    try {
      // 1) Auth via Bearer: servirà per createdBy
      const token = getBearer(req);
      if (!token) return res.status(401).json({ error: 'Missing Bearer token' });

      const { data: userData, error: userErr } = await supabase.auth.getUser(token);
      if (userErr || !userData?.user) {
        return res.status(401).json({ error: 'Invalid token' });
      }
      const user = userData.user;

      let authorPlayerId = null;

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

        if (!error && data) authorPlayerId = data.id ?? data.id ?? null;
      }

      const { data: playerData, error: playerError } = await supabase
        .from('players')
        .select('id, auth_user_id, email, nickname, image_url')
        .or(
          [
        `auth_user_id.eq.${user.id}`,
        `email.eq.${user.email}`,
          ].join(',')
        )
        .limit(1)
        .maybeSingle();


      const {
        name,
        type,        // 'league' | 'elimination' | altro testo ammesso dalla tabella
        bestOf,      // -> (es. 3, 5, 7)
        pointsTo,    // -> (es. 11, 21)
        startDate,   // opzionale, ISO/string
        endDate,      // opzionale, ISO/string
        management,
        isPartOfCompetition
      } = req.body || {};

      const wantsToJoin =
        isPartOfCompetition === true ||
        isPartOfCompetition === 'true' ||
        isPartOfCompetition === 1 ||
        isPartOfCompetition === '1';

      if (wantsToJoin && !playerData) {
        return res.status(404).json({ error: 'Player not found for this user' });
      }

      // ✅ Validazioni base
      if (!name || !type || bestOf == null || pointsTo == null) {
        return res.status(400).json({
          error: 'Invalid data. Required: name, type, bestOf, pointsTo.'
        });
      }
      if (typeof bestOf !== 'number' || typeof pointsTo !== 'number') {
        return res.status(400).json({ error: 'bestOf and pointsTo must be numbers.' });
      }

      // ✅ Prepara record
      const basePayload = {
        name: String(name).trim(),
        type: String(type).trim(),
        management: management == null ? null : String(management).trim(),
        sets_type: bestOf,
        points_type: pointsTo,
        start_date: normalizeDate(startDate),
        end_date: normalizeDate(endDate),
      };

      // Inserimento con tentativi per il nome colonna createdBy
      const tryInsert = async (payload) => {
        return await supabase
          .from('competitions')
          .insert([payload])
          .select()
          .single();
      };

      // Tentativo A: snake_case
      let payloadA = {
        ...basePayload,
        created_by: user.id,
        ...(authorPlayerId ? { created_by_player_id: authorPlayerId } : {})
      };

      let ins = await tryInsert(payloadA);

      // Se fallisce per colonna inesistente, riprova in camelCase
      if (ins.error && ins.error.code === '42703') {
        const payloadB = {
          ...basePayload,
          createdBy: user.id,
          ...(authorPlayerId ? { created_by_player_id: authorPlayerId } : {})
        };
        ins = await tryInsert(payloadB);
      }

      if (ins.error) throw ins.error;
      // 1) id competizione creata
      const compId = ins.data.id;
      let relation = null;

      if (wantsToJoin && playerData.id) {
        const { data: relData, error: relError } = await supabase
          .from('competitions_players')
          .upsert(
            {
              competition_id: compId,
              player_id: playerData.id,
            },
            { onConflict: 'competition_id,player_id' }
          )
          .select()
          .maybeSingle();

        if (relError) throw relError;
        relation = relData || null;
      }

      // 2) set/aggiorna la active_competition_id dello user
      await supabase.from('user_state').upsert(
        { user_id: user.id, active_competition_id: compId, updated_at: new Date().toISOString() },
        { onConflict: 'user_id' } // ← upsert per chiave user_id
      );

      const { data: userState, error: usErr } = await supabase
        .from('user_state')
        .select('*')
        .eq('user_id', user.id)
        .single();
      if (usErr) throw usErr;

      return res.status(201).json({
        message: 'Competition created successfully',
        competition: ins.data,
        userState,
        relation,
        isPartOfCompetition: wantsToJoin,
        players: playerData ? [playerData] : [],
      });
    } catch (err) {
      console.error('Error inserting competition:', err?.message || err);
      return res.status(500).json({ error: 'Failed to create competition' });
    }
  });
};
