const applyCors = require('./cors');
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

        // 🔹 Verifica autenticazione utente
        const { data: auth, error: authErr } = await supabase.auth.getUser(token);
        if (authErr || !auth?.user) return res.status(401).json({ error: 'Invalid token' });

        const { matchId, date } = req.body || {};

        // 🔹 Validazioni base
        if (!matchId) return res.status(400).json({ error: 'Missing matchId' });

        const finalDate = date || new Date().toISOString(); // es: "2025-10-30T21:58:00.123Z"

        try {
            // 🔹 Aggiorna la data della partita (tabella matches)
            const { data: updated, error: upErr } = await supabase
                .from('matches')
                .update({ date: finalDate })
                .eq('id', matchId)
                .select();

            if (upErr) throw upErr;

            if (updated && updated.length > 0) {
                return res.status(200).json({
                    message: `Data della partita ${matchId} aggiornata con successo`,
                    match: updated[0]
                });
            }

            // 🔹 Fallback: prova knockout_matches
            const { data: koUpdated, error: koErr } = await supabase
                .from('knockout_matches')
                .update({ date: finalDate })
                .eq('id', matchId)
                .select();

            if (koErr) throw koErr;

            if (!koUpdated || koUpdated.length === 0) {
                return res.status(404).json({ error: `Match con id ${matchId} non trovato` });
            }

            return res.status(200).json({
                message: `Data del knockout match ${matchId} aggiornata con successo`,
                match: koUpdated[0]
            });
        } catch (e) {
            console.error('set-match-date error:', e);
            return res.status(500).json({ error: 'Internal Server Error' });
        }
    });
};
