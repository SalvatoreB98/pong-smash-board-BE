const { createClient } = require('@supabase/supabase-js');
const applyCors = require('./cors');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
);

module.exports = (req, res) => {
    applyCors(req, res, async () => {
        if (req.method !== 'POST') {
            return res.status(405).json({ error: 'Method Not Allowed' });
        }

        const { players, competitionId } = req.body;
        if (!players || !competitionId) {
            return res.status(400).json({ error: 'Missing players or competitionId' });
        }

        try {
            const rows = players.map(p => ({
                name: p.name,
                surname: p.surname,
                nickname: p.nickname,
                avatar_url: p.imageUrl,
                competition_id: competitionId,
            }));

            const { data, error } = await supabase
                .from('competition_players')
                .insert(rows)
                .select();

            if (error) throw error;

            return res.status(200).json({ message: 'Players added successfully', players: data });
        } catch (err) {
            console.error('Error inserting players:', err);
            return res.status(500).json({ error: 'Failed to add players' });
        }
    });
};
