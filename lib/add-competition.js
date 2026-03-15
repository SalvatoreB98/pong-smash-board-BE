// /api/add-competition.js
const applyCors = require('./cors');
const supabase = require('../services/db');
const { formatDateForDB } = require('../utils/utils');

const normalizeDate = (d) => {
  if (!d) return null;
  try {
    return formatDateForDB ? formatDateForDB(d) : new Date(d).toISOString().slice(0, 10);
  } catch {
    return null;
  }
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
      // 1) Autenticazione
      const token = getBearer(req);
      if (!token) return res.status(401).json({ error: 'Missing Bearer token' });

      const { data: userData, error: userErr } = await supabase.auth.getUser(token);
      if (userErr || !userData?.user) {
        return res.status(401).json({ error: 'Invalid token' });
      }
      const user = userData.user;

      // 2) Recupero informazioni Player dell'autore
      let authorPlayerId = null;
      const { data: authorData } = await supabase
        .from('players')
        .select('id')
        .or(`auth_user_id.eq.${user.id},user_id.eq.${user.id},uid.eq.${user.id}`)
        .limit(1)
        .maybeSingle();

      if (authorData) authorPlayerId = authorData.id;

      // Recupero dati completi player per eventuale join
      const { data: playerData } = await supabase
        .from('players')
        .select('id, auth_user_id, email, nickname, image_url')
        .or(`auth_user_id.eq.${user.id},email.eq.${user.email}`)
        .limit(1)
        .maybeSingle();

      // 3) Estrazione dati dal body
      const {
        name,
        type,
        bestOf,
        pointsTo,
        startDate,
        endDate,
        management,
        isPartOfCompetition
      } = req.body || {};

      // Flag booleano robusto
      const wantsToJoin =
        isPartOfCompetition === true ||
        isPartOfCompetition === 'true' ||
        isPartOfCompetition === 1 ||
        isPartOfCompetition === '1';

      if (wantsToJoin && !playerData) {
        return res.status(404).json({ error: 'Player record not found for this user' });
      }

      // Validazioni base
      if (!name || !type || bestOf == null || pointsTo == null) {
        return res.status(400).json({ error: 'Missing required fields' });
      }

      // 4) Creazione Competizione
      const basePayload = {
        name: String(name).trim(),
        type: String(type).trim(),
        management: management == null ? null : String(management).trim(),
        sets_type: Number(bestOf),
        points_type: Number(pointsTo),
        start_date: normalizeDate(startDate),
        end_date: normalizeDate(endDate),
      };

      const tryInsert = async (columnName) => {
        const payload = { ...basePayload, [columnName]: user.id };
        if (authorPlayerId) payload.created_by_player_id = authorPlayerId;
        return await supabase.from('competitions').insert([payload]).select().single();
      };

      // Tentativo inserimento (gestisce snake_case o camelCase del DB)
      let ins = await tryInsert('created_by');
      if (ins.error && ins.error.code === '42703') {
        ins = await tryInsert('createdBy');
      }

      if (ins.error) throw ins.error;
      const compId = ins.data.id;

      // 5) Gestione partecipazione (Tabella di relazione)
      let relation = null;
      if (wantsToJoin && playerData.id) {
        const { data: relData, error: relError } = await supabase
          .from('competitions_players')
          .upsert(
            { competition_id: compId, player_id: playerData.id },
            { onConflict: 'competition_id,player_id' }
          )
          .select()
          .maybeSingle();

        if (relError) throw relError;
        relation = relData;
      }

      // 6) AGGIORNA LO STATO UTENTE SOLO SE RICHIESTO
      // Qui era il bug: prima veniva fatto sempre
      if (wantsToJoin) {
        await supabase.from('user_state').upsert(
          {
            user_id: user.id,
            active_competition_id: compId,
            updated_at: new Date().toISOString()
          },
          { onConflict: 'user_id' }
        );
      }

      // Recupero stato finale per la risposta
      const { data: userState } = await supabase
        .from('user_state')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle();

      return res.status(201).json({
        message: 'Competition created successfully',
        competition: ins.data,
        userState: userState || null,
        relation,
        isPartOfCompetition: wantsToJoin,
        players: (wantsToJoin && playerData) ? [playerData] : [],
      });

    } catch (err) {
      console.error('Error:', err?.message || err);
      return res.status(500).json({ error: 'Failed to create competition' });
    }
  });
};