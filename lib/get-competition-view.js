// /api/get-competition-view.js
const supabase = require('../services/db');
const parseCompetitionId = (value) => {
  if (value == null) return null;
  const parsed = Number.parseInt(Array.isArray(value) ? value[0] : value, 10);
  return Number.isFinite(parsed) ? parsed : null;
};

const mapPlayerRow = (row) => {
  const basePlayer = row?.players || {};

  return {
    playerId: row?.player_id ?? basePlayer?.id ?? null,
    player: {
      id: basePlayer?.id ?? null,
      nickname: basePlayer?.nickname ?? null,
      name: basePlayer?.name ?? null,
      lastname: basePlayer?.lastname ?? null,
      email: basePlayer?.email ?? null,
      imageUrl: basePlayer?.image_url ?? null,
      birthDate: basePlayer?.birth_date ?? null,
      description: basePlayer?.description ?? null,
      playStyle: basePlayer?.play_style ?? null,
      racketBlade: basePlayer?.racket_blade ?? null,
      racketRubberFh: basePlayer?.racket_rubber_fh ?? null,
      racketRubberBh: basePlayer?.racket_rubber_bh ?? null,
      handedness: basePlayer?.handedness ?? null,
    },
  };
};

const buildPlayerMap = (players = []) => {
  const map = new Map();
  for (const row of players) {
    const player = row?.player || {};
    if (!player?.id) continue;
    map.set(player.id, {
      nickname: player.nickname || null,
      name: player.name || null,
      lastname: player.lastname || null,
      imageUrl: player.imageUrl || null,
      birthDate: player.birthDate || null,
      description: player.description || null,
      playStyle: player.playStyle || null,
      racketBlade: player.racketBlade || null,
      racketRubberFh: player.racketRubberFh || null,
      racketRubberBh: player.racketRubberBh || null,
      handedness: player.handedness || null,
    });
  }
  return map;
};

const ensurePlayersFromMatches = async (matches = [], playerMap) => {
  const missingIds = Array.from(
    new Set(
      matches
        .flatMap((match) => [match.player1_id, match.player2_id])
        .filter((id) => id && !playerMap.has(id))
    )
  );

  console.log('🧩 Missing player IDs:', missingIds);

  if (!missingIds.length) return playerMap;

  const { data: missingPlayers, error } = await supabase
    .from('players')
    .select('id, nickname, name, lastname, image_url, birth_date, description, play_style, racket_blade, racket_rubber_fh, racket_rubber_bh, handedness')
    .in('id', missingIds);

  if (error) {
    console.error('❌ Error fetching missing players:', error.message);
    throw error;
  }

  console.log('✅ Fetched missing players:', missingPlayers?.length);

  for (const player of missingPlayers || []) {
    if (!player?.id) continue;
    playerMap.set(player.id, {
      nickname: player.nickname || null,
      name: player.name || null,
      lastname: player.lastname || null,
      imageUrl: player.image_url || null,
      birthDate: player.birth_date || null,
      description: player.description || null,
      playStyle: player.play_style || null,
      racketBlade: player.racket_blade || null,
      racketRubberFh: player.racket_rubber_fh || null,
      racketRubberBh: player.racket_rubber_bh || null,
      handedness: player.handedness || null,
    });
  }

  return playerMap;
};

const buildStats = (matches = [], players = []) => {
  const completedMatches = matches.filter(
    (match) =>
      match?.player1_score != null && match?.player2_score != null &&
      match?.player1_score !== '' &&
      match?.player2_score !== ''
  );

  const totalPoints = completedMatches.reduce((acc, match) => {
    const p1 = Number(match.player1_score) || 0;
    const p2 = Number(match.player2_score) || 0;
    return acc + p1 + p2;
  }, 0);

  const totalSets = completedMatches.reduce((acc, match) => {
    if (!Array.isArray(match.match_sets)) return acc;
    return acc + match.match_sets.length;
  }, 0);

  const lastPlayedAt = completedMatches
    .map((match) => match.date || match.created)
    .filter(Boolean)
    .sort((a, b) => (b || '').localeCompare(a || ''))[0] || null;

  const upcomingMatches = matches.filter(
    (match) => match?.player1_score == null && match?.player2_score == null
  ).length;

  return {
    totalPlayers: players.length,
    totalMatches: matches.length,
    completedMatches: completedMatches.length,
    upcomingMatches,
    totalPoints,
    totalSets,
    lastPlayedAt,
  };
};

const mapMatchRow = (match, playerMap) => {
  const player1 = playerMap.get(match.player1_id) || {};
  const player2 = playerMap.get(match.player2_id) || {};

  return {
    id: match.id,
    date: match.date || match.created || null,
    created: match.created || null,
    stage: match.stage || null,
    round: match.round || null,
    status: match.status || null,
    player1: {
      id: match.player1_id || null,
      nickname: player1.nickname || null,
      name: player1.name || null,
      imageUrl: player1.imageUrl || null,
    },
    player2: {
      id: match.player2_id || null,
      nickname: player2.nickname || null,
      name: player2.name || null,
      imageUrl: player2.imageUrl || null,
    },
    score:
      match.player1_score != null && match.player2_score != null
        ? {
          player1: Number(match.player1_score),
          player2: Number(match.player2_score),
        }
        : null,
    matchSets: Array.isArray(match.match_sets)
      ? match.match_sets.map((set) => ({
        id: set.id,
        player1Score: Number(set.player1_score),
        player2Score: Number(set.player2_score),
      }))
      : [],
  };
};

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const competitionId = parseCompetitionId(req.query?.competitionId);
  console.log('🏁 Incoming request for competitionId:', competitionId);

  if (!competitionId) {
    return res.status(400).json({ error: 'Missing competitionId parameter' });
  }

  try {
    console.log('🏷️ Final competitionId used in query:', competitionId, typeof competitionId);
    console.log('📦 Fetching competition data...');
    const { data: competition, error: competitionError } = await supabase
      .from('competitions')
      .select('id, name, type, start_date, end_date, updated_at, created_by')
      .eq('id', competitionId)
      .maybeSingle();

    if (competitionError) {
      console.error('❌ Competition fetch error:', competitionError.message);
      throw competitionError;
    }

    console.log('✅ Competition data:', competition);

    if (!competition) {
      console.warn('⚠️ Competition not found for ID:', competitionId);
      return res.status(404).json({ error: 'Competition not found' });
    }

    console.log('👥 Fetching players for competition...');
    const { data: playerRows, error: playersError } = await supabase
      .from('competitions_players')
      .select(`
        player_id,
        players (
          id,
          nickname,
          name,
          lastname,
          email,
          image_url,
          birth_date,
          description,
          play_style,
          racket_blade,
          racket_rubber_fh,
          racket_rubber_bh,
          handedness
        )
      `)
      .eq('competition_id', competitionId)
      .order('id', { ascending: true, nullsFirst: true });

    if (playersError) {
      console.error('❌ Players fetch error:', playersError.message);
      throw playersError;
    }

    console.log('✅ Players fetched:', playerRows?.length);

    const players = (playerRows || []).map(mapPlayerRow);
    let playerMap = buildPlayerMap(players);

    console.log('🎯 Fetching matches...');
    const { data: matchesData, error: matchesError } = await supabase
      .from('matches')
      .select(`
        id,
        competition_id,
        player1_id,
        player2_id,
        player1_score,
        player2_score,
        date,
        created,
        match_sets (
          id,
          player1_score,
          player2_score
        )
      `)
      .eq('competition_id', competitionId)
      .order('date', { ascending: false, nullsFirst: false })
      .order('created', { ascending: false, nullsFirst: false });

    if (matchesError) {
      console.error('❌ Matches fetch error:', matchesError.message);
      throw matchesError;
    }

    console.log('✅ Matches fetched:', matchesData?.length);

    const matches = matchesData || [];
    playerMap = await ensurePlayersFromMatches(matches, playerMap);

    const stats = buildStats(matches, players);
    const latestMatches = matches
      .slice(0, 10)
      .map((match) => mapMatchRow(match, playerMap));

    console.log('📊 Stats built:', stats);
    console.log('🕹️ Returning latest matches:', latestMatches.length);

    return res.status(200).json({
      competition,
      players,
      stats,
      latestMatches,
    });
  } catch (error) {
    console.error('🔥 Error fetching competition view:', error?.message || error);
    console.error('Stack trace:', error?.stack);
    return res.status(500).json({ error: 'Failed to fetch competition details.' });
  }
};
