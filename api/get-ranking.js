const supabase = require('../services/db');

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }
  try {
    const { competition_id } = req.query;

    let q = supabase
      .from('v_ranking_by_competition')
      .select('*');

    if (competition_id !== undefined) {
      const id = Number(competition_id);
      if (!Number.isFinite(id) || id <= 0) {
        return res.status(400).json({ error: 'competition_id deve essere un numero > 0' });
      }
      q = q.eq('competition_id', id).order('rank', { ascending: true });
    } else {
      q = q.order('competition_id', { ascending: true })
        .order('rank', { ascending: true });
    }

    const { data, error } = await q;
    const ranking = data.map((entry) => ({
      playerid: entry.player_id,
      name: entry.player_name || entry.player_nickname || 'Player',
      image_url: entry.player_image_url,
      played: entry.played,
      wins: entry.wins,
      winrate: Number(entry.winrate),
      rating: Number(entry.rating),
      nickname: entry.player_nickname || 'Player',
    }));

    if (error) throw error;

    res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300');
    res.setHeader('Vary', 'competition_id');

    return res.status(200).json({
      competition_id: competition_id ? Number(competition_id) : null,
      ranking,
      generatedAt: new Date().toISOString(),
    });
  } catch (e) {
    console.error('Ranking API error:', e);
    return res.status(500).json({ error: 'Failed to fetch ranking' });
  }
};
