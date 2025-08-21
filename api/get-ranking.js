// /api/ranking.js
const supabase = require('../services/db');

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }
  try {
    const { tournament_id } = req.query;

    let q = supabase
      .from('v_ranking_by_tournament')
      .select('*');

    if (tournament_id !== undefined) {
      const id = Number(tournament_id);
      if (!Number.isFinite(id) || id <= 0) {
        return res.status(400).json({ error: 'tournament_id deve essere un numero > 0' });
      }
      q = q.eq('tournament_id', id).order('rank', { ascending: true });
    } else {
      q = q.order('tournament_id', { ascending: true })
           .order('rank', { ascending: true });
    }

    const { data, error } = await q;
    if (error) throw error;

    res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300');
    res.setHeader('Vary', 'tournament_id');

    return res.status(200).json({
      tournament_id: tournament_id ? Number(tournament_id) : null,
      ranking: data,
      generatedAt: new Date().toISOString(),
    });
  } catch (e) {
    console.error('Ranking API error:', e);
    return res.status(500).json({ error: 'Failed to fetch ranking' });
  }
};
