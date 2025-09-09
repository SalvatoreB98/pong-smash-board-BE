// /api/add-competition.js
const applyCors = require('./cors');
const supabase = require('../lib/supabase');
const { requireUser } = require('../lib/auth');
const normalizeDate = require('../lib/normalizeDate');
const handleError = require('../lib/error');

module.exports = (req, res) => {
  applyCors(req, res, async () => {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
      // 1) Auth via Bearer: servirà per createdBy
      const user = await requireUser(req);

      // (opzionale) prova a ricavare anche playerId dell’autore
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

      const {
        name,
        type,        // 'league' | 'elimination' | altro testo ammesso dalla tabella
        bestOf,      // -> (es. 3, 5, 7)
        pointsTo,    // -> (es. 11, 21)
        startDate,   // opzionale, ISO/string
        endDate,      // opzionale, ISO/string
        management
      } = req.body || {};

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
        management: String(management).trim(),
        sets_type: bestOf,
        points_type: pointsTo,
        start_date: normalizeDate(startDate),
        end_date: normalizeDate(endDate),
      };

      // Inserimento con tentativi per il nome colonna createdBy
      // 1) created_by + created_by_player_id
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
          ...(authorPlayerId ? { createdByPlayerId: authorPlayerId } : {})
        };
        ins = await tryInsert(payloadB);
      }

      if (ins.error) throw ins.error;
      // 1) id competizione creata
      const compId = ins.data.id;

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
      });
    } catch (err) {
      return handleError(res, err, 'Failed to create competition');
    }
  });
};
