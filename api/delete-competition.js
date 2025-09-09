// /api/delete-competition.js
const applyCors = require('./cors');
const supabase = require('../lib/supabase');
const { requireUser } = require('../lib/auth');
const handleError = require('../lib/error');

module.exports = (req, res) => {
    applyCors(req, res, async () => {
        if (req.method === 'OPTIONS') {
            return res.status(200).end(); // preflight
        }
        if (req.method !== 'DELETE') {
            return res.status(405).json({ error: 'Method Not Allowed' });
        }

        try {
            // 1) Auth
            const user = await requireUser(req);

            const { competitionId } = req.body || {};
            if (!competitionId) {
                return res.status(400).json({ error: 'Missing competitionId' });
            }

            // 2) Recupera competizione per verificare proprietario
            const { data: comp, error: compErr } = await supabase
                .from('competitions')
                .select('*')
                .eq('id', competitionId)
                .single();

            if (compErr || !comp) {
                return res.status(404).json({ error: 'Competition not found' });
            }

            // Controlla che l’utente sia il creatore
            const isOwner =
                comp.created_by === user.id ||
                comp.createdBy === user.id; // nel caso camelCase
            if (!isOwner) {
                return res.status(403).json({ error: 'Not authorized to delete this competition' });
            }

            // 3) Elimina competizione
            const { error: delErr } = await supabase
                .from('competitions')
                .delete()
                .eq('id', competitionId);

            if (delErr) throw delErr;

            // 4) Aggiorna user_state se era la competizione attiva
            const { data: ustate } = await supabase
                .from('user_state')
                .select('*')
                .eq('user_id', user.id)
                .maybeSingle();

            if (ustate?.active_competition_id === competitionId) {
                await supabase
                    .from('user_state')
                    .update({
                        active_competition_id: null,
                        updated_at: new Date().toISOString(),
                    })
                    .eq('user_id', user.id);
            }

            return res.status(200).json({
                message: 'Competition deleted successfully',
                competitionId,
            });
        } catch (err) {
            return handleError(res, err, 'Failed to delete competition');
        }
    });
};
